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

const printWindows = async ({ printerName, content }) => {
  const command = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$content = [Console]::In.ReadToEnd()
$printerName = $env:PRINTER_NAME
$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.DocumentName = 'CAV Receipt'
$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
if ($printerName) {
  $doc.PrinterSettings.PrinterName = $printerName
}
if (-not $doc.PrinterSettings.IsValid) {
  throw "Printer is not available: $($doc.PrinterSettings.PrinterName)"
}
$font = New-Object System.Drawing.Font('Consolas', 8)
$brush = [System.Drawing.Brushes]::Black
$lines = ($content -replace "\`r\`n", "\`n" -replace "\`r", "\`n").Split("\`n")
$script:lineIndex = 0
$doc.add_PrintPage({
  param($sender, $eventArgs)
  $y = [float]0
  $lineHeight = $font.GetHeight($eventArgs.Graphics)
  while ($script:lineIndex -lt $lines.Length) {
    if (($y + $lineHeight) -gt $eventArgs.PageBounds.Height) {
      $eventArgs.HasMorePages = $true
      return
    }
    $eventArgs.Graphics.DrawString($lines[$script:lineIndex], $font, $brush, 0, $y)
    $y += $lineHeight
    $script:lineIndex += 1
  }
  $eventArgs.HasMorePages = $false
})
$doc.Print()
$font.Dispose()
$doc.Dispose()
`;
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    windowsHide: true,
    env: { ...process.env, PRINTER_NAME: printerName || '' },
  });
  let stderr = '';
  child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
  child.stdin.write(content);
  child.stdin.end();
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
