const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const exportPath = path.resolve(__dirname, '..', 'cav_env', 'CAV-Photostudio-and-Cafe-frontend.env');
const publicKeys = new Set([
  'REACT_APP_API_BASE_URL',
  'REACT_APP_GOOGLE_CLIENT_ID',
  'REACT_APP_RECAPTCHA_SITE_KEY',
  'REACT_APP_MOBILE_API_BASE_URL',
  'REACT_APP_LOCAL_PRINT_BRIDGE_URL',
  'FAST_REFRESH',
]);

const runtimeValues = Object.fromEntries(
  [...publicKeys]
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]),
);

for (const key of Object.keys(process.env)) {
  if (key.startsWith('REACT_APP_') || key === 'FAST_REFRESH') {
    delete process.env[key];
  }
}

if (fs.existsSync(exportPath)) {
  const exportedValues = dotenv.parse(fs.readFileSync(exportPath));
  for (const [key, value] of Object.entries(exportedValues)) {
    if (publicKeys.has(key)) process.env[key] = value;
  }
}

Object.assign(process.env, runtimeValues);

const command = process.argv[2];
if (!['start', 'build'].includes(command)) {
  throw new Error('Usage: node load-render-env.cjs <start|build>');
}

const reactScripts = require.resolve('react-scripts/scripts/' + command, { paths: [__dirname] });
require(reactScripts);
