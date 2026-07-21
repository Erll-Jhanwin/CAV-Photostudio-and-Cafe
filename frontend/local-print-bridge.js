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

const listWindowsPrinters = async () => {
  const script = [
    'Get-Printer',
    "Select-Object Name,@{Name='Default';Expression={$false}},PrinterStatus",
    'ConvertTo-Json -Compress',
  ].join(' | ');
  const result = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  if (result.code !== 0) throw new Error(result.stderr || 'Could not read installed printers.');
  const parsed = result.stdout.trim() ? JSON.parse(result.stdout.trim()) : [];
  return (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean).map(printer => ({
    name: printer.Name,
    default: !!printer.Default,
    status: printer.PrinterStatus,
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
  const command = printerName
    ? 'if ($env:PRINTER_NAME) { $input | Out-Printer -Name $env:PRINTER_NAME } else { $input | Out-Printer }'
    : '$input | Out-Printer';
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    windowsHide: true,
    env: { ...process.env, PRINTER_NAME: printerName || '' },
  });
  let stderr = '';
  child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
  child.stdin.write(content);
  child.stdin.end();
  const code = await new Promise(resolve => child.on('close', resolve));
  if (code !== 0) throw new Error(stderr || 'Printer command failed.');
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
