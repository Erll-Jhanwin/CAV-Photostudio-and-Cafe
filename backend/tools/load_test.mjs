import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const baseUrl = (process.env.LOAD_TEST_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const concurrency = Math.max(1, Number(process.env.LOAD_TEST_VUS || 1000));
const durationSeconds = Math.max(1, Number(process.env.LOAD_TEST_DURATION_SECONDS || 30));
const timeoutMs = Math.max(1000, Number(process.env.LOAD_TEST_TIMEOUT_MS || 15000));
const userFile = process.env.LOAD_TEST_USERS_FILE;
const users = userFile ? JSON.parse(await readFile(userFile, 'utf8')) : [];
const bearerToken = process.env.LOAD_TEST_BEARER_TOKEN || '';
const packageId = process.env.LOAD_TEST_PACKAGE_ID || '';
const errors = [];
const samples = [];
const statuses = new Map();
const paths = new Map();

if (!userFile && !bearerToken) {
  throw new Error('Set LOAD_TEST_USERS_FILE to synthetic staging accounts or LOAD_TEST_BEARER_TOKEN for read-only endpoint load.');
}
if (userFile && users.length < concurrency) {
  throw new Error(`The user file must contain at least LOAD_TEST_VUS (${concurrency}) distinct synthetic accounts.`);
}

async function request(path, { method = 'GET', body, cookie = '', token = '' } = {}) {
  const started = performance.now();
  let status = 0;
  try {
    const response = await fetch(new URL(path, `${baseUrl}/`), {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    status = response.status;
    let responseBody;
    if (method === 'POST' && path === '/api/auth/login/') {
      responseBody = await response.json().catch(() => ({}));
    } else {
      await response.arrayBuffer();
    }
    const elapsed = performance.now() - started;
    samples.push(elapsed);
    statuses.set(status, (statuses.get(status) || 0) + 1);
    const parsed = new URL(path, `${baseUrl}/`).pathname;
    const entry = paths.get(parsed) || { requests: 0, totalMs: 0, maxMs: 0, statuses: new Map() };
    entry.requests += 1;
    entry.totalMs += elapsed;
    entry.maxMs = Math.max(entry.maxMs, elapsed);
    entry.statuses.set(status, (entry.statuses.get(status) || 0) + 1);
    paths.set(parsed, entry);
    return { response, responseBody };
  } catch (error) {
    const elapsed = performance.now() - started;
    samples.push(elapsed);
    errors.push({ status, path, type: error.name, message: error.message });
    return { response: null, responseBody: null };
  }
}

function cookieHeader(response) {
  const setCookies = response?.headers.getSetCookie?.() || [];
  return setCookies
    .map((value) => value.split(';', 1)[0])
    .filter((value) => /^(cav_access|cav_refresh|csrftoken)=/.test(value))
    .join('; ');
}

function requestPaths(role) {
  const result = ['/api/auth/profile/'];
  if (role === 'ADMIN' || role === 'STAFF') {
    result.push('/api/dashboard/analytics/', '/api/bookings/?limit=100', '/api/notifications/?limit=100');
  } else {
    result.push('/api/bookings/?limit=100', '/api/notifications/?limit=100');
  }
  if (packageId) {
    const month = new Date().toISOString().slice(0, 7);
    result.push(`/api/bookings/availability/?package=${encodeURIComponent(packageId)}&month=${month}`);
  }
  result.push('/api/bookings/services/', '/api/bookings/packages/', '/api/gallery/images/');
  return result;
}

async function virtualUser(index) {
  const user = users[index];
  let cookie = '';
  let token = user?.token || bearerToken;
  let role = user?.role || process.env.LOAD_TEST_ROLE || 'CUSTOMER';

  if (user && !user.token) {
    const payload = { username: user.username, password: user.password };
    if (user.mfa_token) payload.mfa_token = user.mfa_token;
    if (user.mfa_code) payload.mfa_code = user.mfa_code;
    const { response, responseBody } = await request('/api/auth/login/', { method: 'POST', body: payload });
    if (!response || response.status !== 200) {
      errors.push({ status: response?.status || 0, path: '/api/auth/login/', type: 'LoginFailure', message: responseBody?.detail || 'Synthetic account login failed.' });
      return;
    }
    cookie = cookieHeader(response);
    role = String(responseBody?.role || role).toUpperCase();
    if (!cookie) {
      errors.push({ status: response.status, path: '/api/auth/login/', type: 'MissingCookie', message: 'Login response did not set an access cookie.' });
      return;
    }
  }

  const endpointList = requestPaths(role);
  const until = performance.now() + durationSeconds * 1000;
  while (performance.now() < until) {
    for (const path of endpointList) {
      if (performance.now() >= until) break;
      await request(path, { cookie, token });
    }
  }
}

const started = performance.now();
await Promise.all(Array.from({ length: concurrency }, (_, index) => virtualUser(index)));
samples.sort((a, b) => a - b);
const percentile = (ratio) => samples.length ? Math.round(samples[Math.min(samples.length - 1, Math.ceil(samples.length * ratio) - 1)]) : 0;
const elapsed = (performance.now() - started) / 1000;
const statusObject = (map) => Object.fromEntries([...map.entries()].sort((a, b) => a[0] - b[0]));
const report = {
  baseUrl,
  virtualUsers: concurrency,
  durationSeconds,
  wallSeconds: Number(elapsed.toFixed(2)),
  attemptedRequests: samples.length,
  completedResponses: [...statuses.values()].reduce((total, count) => total + count, 0),
  requestsPerSecond: Number((samples.length / elapsed).toFixed(2)),
  latencyMs: {
    p50: percentile(0.50),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: samples.length ? Math.round(samples.at(-1)) : 0,
  },
  statusCounts: statusObject(statuses),
  networkErrors: errors.filter((error) => error.status === 0).length,
  http5xx: [...statuses.entries()].filter(([status]) => status >= 500).reduce((total, [, count]) => total + count, 0),
  http429: statuses.get(429) || 0,
  loginFailures: errors.filter((error) => error.type === 'LoginFailure').length,
  paths: Object.fromEntries([...paths.entries()].map(([path, value]) => [path, {
    requests: value.requests,
    averageMs: Number((value.totalMs / value.requests).toFixed(2)),
    maxMs: Number(value.maxMs.toFixed(2)),
    statuses: statusObject(value.statuses),
  }])),
};
console.log(JSON.stringify(report, null, 2));
if (errors.length) console.error(JSON.stringify({ sampleErrors: errors.slice(0, 20) }, null, 2));
