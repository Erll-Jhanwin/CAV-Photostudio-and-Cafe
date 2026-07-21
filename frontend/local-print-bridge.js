const http = require('http');
const { spawn } = require('child_process');

const PORT = Number(process.env.LOCAL_PRINT_BRIDGE_PORT || 8765);
const HOST = '127.0.0.1';

const sendJson = (res, status, data) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Private-Network': 'true',
  });
  res.end(JSON.stringify(data));
};

const readBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 1024 * 1024) {
      req.destroy();
      reject(new Error('Request body is too large.'));
    }
  });
  req.on('end', () => resolve(body ? JSON.parse(body) : {}));
  req.on('error', reject);
});

const run = (command, args, options = {}) => new Promise((resolve) => {
  const child = spawn(command, args, { windowsHide: true, ...options });
  let stdout = '';
  let stderr = '';
  const timer = setTimeout(() => {
    child.kill();
    resolve({ code: 1, stdout, stderr: stderr || 'Command timed out.' });
  }, options.timeoutMs || 7000);
  child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
  child.on('error', error => {
    clearTimeout(timer);
    resolve({ code: 1, stdout, stderr: error.message });
  });
  child.on('close', code => {
    clearTimeout(timer);
    resolve({ code, stdout, stderr });
  });
});

const cleanPowerShellError = (value) => (
  String(value || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line && !/^(At line:|\+|~|\+ CategoryInfo|\+ FullyQualifiedErrorId)/.test(line))
);

const listWindowsPrinters = async () => {
  const script = [
    'Get-CimInstance Win32_Printer',
    'Select-Object Name,Default,PrinterStatus,WorkOffline,PortName',
    'ConvertTo-Json -Compress',
  ].join(' | ');
  const result = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeoutMs: 20000 });
  if (result.code !== 0) throw new Error(result.stderr || 'Could not read installed printers.');
  const parsed = result.stdout.trim() ? JSON.parse(result.stdout.trim()) : [];
  return (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean).map(printer => ({
    name: printer.Name,
    default: !!printer.Default,
    status: printer.WorkOffline ? 'offline' : printer.PrinterStatus,
  }));
};

const listPosixPrinters = async () => {
  const result = await run('lpstat', ['-e']);
  if (result.code !== 0) return [];
  return result.stdout.split(/\r?\n/).map(name => name.trim()).filter(Boolean).map((name, index) => ({
    name,
    default: index === 0,
    status: '',
  }));
};

const escposReceiptPayload = (content) => {
  const printableWidthDots = 384;
  const widthLow = printableWidthDots & 0xff;
  const widthHigh = (printableWidthDots >> 8) & 0xff;
  return Buffer.concat([
    Buffer.from([
      0x1b, 0x40,       // Initialize printer
      0x1b, 0x21, 0x00, // Font A 12x24, normal size
      0x1b, 0x4d, 0x00, // Font A
      0x1d, 0x21, 0x00, // Normal character width/height
      0x1b, 0x45, 0x00, // Emphasis off
      0x1b, 0x47, 0x00, // Double-strike off
      0x1b, 0x2d, 0x00, // Underline off
      0x1b, 0x32,       // Default ESC/POS line spacing
      0x1d, 0x4c, 0x00, 0x00, // Left margin 0 dots
      0x1d, 0x57, widthLow, widthHigh, // Printable width 384 dots
      0x12, 0x23, 0xff, // High POS58 density/darkness
      0x1b, 0x37, 0x0b, 0x80, 0x40, // Higher heat/time, controlled interval
      0x1b, 0x61, 0x00, // Left align body text
    ]),
    Buffer.from(String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'), 'ascii'),
    Buffer.from([
      0x0a, 0x0a, 0x0a,
      0x1d, 0x56, 0x42, 0x00, // Partial cut
    ]),
  ]);
};

const printWindows = async ({ printerName, content }) => {
  const command = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

  [DllImport("winspool.Drv", SetLastError = true, ExactSpelling = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In] DOCINFOA di);

  [DllImport("winspool.Drv", SetLastError = true, ExactSpelling = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", SetLastError = true, ExactSpelling = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", SetLastError = true, ExactSpelling = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);

  [DllImport("winspool.Drv", SetLastError = true, ExactSpelling = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

  public static void SendBytesToPrinter(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
      throw new Exception("Printer could not be opened: " + printerName);
    }

    DOCINFOA di = new DOCINFOA();
    di.pDocName = "CAV POS Receipt";
    di.pDataType = "RAW";

    try {
      if (!StartDocPrinter(hPrinter, 1, di)) throw new Exception("RAW print job could not be started.");
      try {
        if (!StartPagePrinter(hPrinter)) throw new Exception("RAW print page could not be started.");
        IntPtr unmanagedBytes = Marshal.AllocHGlobal(bytes.Length);
        try {
          Marshal.Copy(bytes, 0, unmanagedBytes, bytes.Length);
          int written;
          if (!WritePrinter(hPrinter, unmanagedBytes, bytes.Length, out written) || written != bytes.Length) {
            throw new Exception("Receipt bytes could not be sent to the printer.");
          }
        } finally {
          Marshal.FreeHGlobal(unmanagedBytes);
          EndPagePrinter(hPrinter);
        }
      } finally {
        EndDocPrinter(hPrinter);
      }
    } finally {
      ClosePrinter(hPrinter);
    }
  }
}
"@
$printerName = $env:PRINTER_NAME
if (-not $printerName) {
  throw 'Printer name is required for RAW ESC/POS printing.'
}
$bytes = [Convert]::FromBase64String($env:RECEIPT_PAYLOAD)
[RawPrinterHelper]::SendBytesToPrinter($printerName, $bytes)
`;
  const payload = escposReceiptPayload(content);
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    windowsHide: true,
    env: { ...process.env, PRINTER_NAME: printerName || '', RECEIPT_PAYLOAD: payload.toString('base64') },
  });
  let stderr = '';
  child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
  const code = await new Promise(resolve => child.on('close', resolve));
  if (code !== 0) throw new Error(cleanPowerShellError(stderr) || 'Printer command failed.');
};

const printPosix = async ({ printerName, content }) => {
  const args = printerName ? ['-d', printerName] : [];
  const child = spawn('lp', args, { windowsHide: true });
  let stderr = '';
  child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
  child.stdin.write(content);
  child.stdin.end();
  const code = await new Promise(resolve => child.on('close', resolve));
  if (code !== 0) throw new Error(stderr || 'Printer command failed.');
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  try {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true, mode: 'local-print-bridge' });
      return;
    }

    if (req.method === 'GET' && req.url === '/printers') {
      const printers = process.platform === 'win32' ? await listWindowsPrinters() : await listPosixPrinters();
      sendJson(res, 200, { printers });
      return;
    }

    if (req.method === 'POST' && req.url === '/print') {
      const body = await readBody(req);
      if (!body.content || typeof body.content !== 'string') {
        sendJson(res, 400, { printed: false, error: 'Receipt content is required.' });
        return;
      }
      if (process.platform === 'win32') {
        await printWindows(body);
      } else {
        await printPosix(body);
      }
      sendJson(res, 200, { printed: true, printer: body.printerName || 'default' });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(res, 500, { printed: false, error: error.message || 'Local printing failed.' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`CAV local print bridge running at http://${HOST}:${PORT}`);
});
