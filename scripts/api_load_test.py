#!/usr/bin/env python3
"""Read-only API load probe for an explicitly authorized test deployment.

The only write performed by the workflow is the authentication endpoint itself.
Use disposable test accounts; this script never performs business mutations.
"""

import argparse
import concurrent.futures
import http.cookiejar
import json
import math
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict


ROLE_PATHS = {
    'customer': [
        '/api/auth/profile/',
        '/api/bookings/',
        '/api/bookings/services/',
        '/api/notifications/?limit=50',
    ],
    'staff': [
        '/api/auth/profile/',
        '/api/dashboard/analytics/',
        '/api/bookings/?limit=100',
        '/api/inventory/products/?limit=100',
        '/api/pos/orders/?limit=50',
        '/api/bookings/payments/?search=loadtest&limit=50',
    ],
}


def percentile(values, percent):
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[max(0, math.ceil(percent * len(ordered)) - 1)], 2)


def request(opener, base_url, path, method='GET', payload=None, headers=None):
    body = json.dumps(payload).encode('utf-8') if payload is not None else None
    request_headers = {'Accept': 'application/json'}
    if body is not None:
        request_headers['Content-Type'] = 'application/json'
    if headers:
        request_headers.update(headers)
    req = urllib.request.Request(
        urllib.parse.urljoin(base_url.rstrip('/') + '/', path.lstrip('/')),
        data=body,
        headers=request_headers,
        method=method,
    )
    started = time.perf_counter()
    status = 0
    csrf_token = ''
    try:
        with opener.open(req, timeout=30) as response:
            status = response.status
            response_body = response.read()
            if path == '/api/auth/csrf/':
                try:
                    csrf_token = json.loads(response_body.decode('utf-8')).get('csrf_token', '')
                except (ValueError, AttributeError):
                    csrf_token = ''
            else:
                csrf_token = ''
    except urllib.error.HTTPError as error:
        status = error.code
        error.read()
    except Exception as error:  # transport failures count as failed requests
        status = 0
        path = f'{path} [transport: {type(error).__name__}]'
    result = {
        'path': path,
        'status': status,
        'elapsed_ms': (time.perf_counter() - started) * 1000,
    }
    if path == '/api/auth/csrf/':
        result['csrf_token'] = csrf_token
    return result


def virtual_user(base_url, username, password, role, start_barrier, iterations):
    cookie_jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))
    records = []
    start_barrier.wait(timeout=30)

    csrf = request(opener, base_url, '/api/auth/csrf/')
    csrf_token = csrf.pop('csrf_token', '')
    records.append(csrf)
    if csrf['status'] != 200:
        return records

    login = request(
        opener,
        base_url,
        '/api/auth/login/',
        method='POST',
        payload={'username': username, 'password': password},
        headers={'X-CSRFToken': csrf_token} if csrf_token else None,
    )
    records.append(login)
    if login['status'] != 200:
        return records

    for _ in range(iterations):
        records.extend(request(opener, base_url, path) for path in ROLE_PATHS[role])
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default=os.environ.get('PERF_BASE_URL', 'http://127.0.0.1:8000'))
    parser.add_argument('--role', choices=ROLE_PATHS, default=os.environ.get('PERF_ROLE', 'customer'))
    parser.add_argument('--stages', default='5,10,25,50,100')
    parser.add_argument('--iterations', type=int, default=1, help='read-only dashboard/search passes after login')
    parser.add_argument('--username', default=os.environ.get('PERF_TEST_USERNAME', ''))
    parser.add_argument('--username-prefix', default=os.environ.get('PERF_TEST_USERNAME_PREFIX', ''))
    parser.add_argument('--password', default=os.environ.get('PERF_TEST_PASSWORD', ''))
    parser.add_argument('--allow-remote', action='store_true', help='required to send requests outside localhost')
    args = parser.parse_args()

    parsed = urllib.parse.urlparse(args.base_url)
    if parsed.scheme not in {'http', 'https'} or not parsed.hostname:
        parser.error('--base-url must be an http(s) URL')
    if parsed.hostname not in {'localhost', '127.0.0.1', '::1'} and not args.allow_remote:
        parser.error('remote targets require --allow-remote and explicit authorization')
    if not (args.username or args.username_prefix) or not args.password:
        parser.error('provide PERF_TEST_PASSWORD and either PERF_TEST_USERNAME or PERF_TEST_USERNAME_PREFIX')
    try:
        stages = [int(value.strip()) for value in args.stages.split(',')]
    except ValueError:
        parser.error('--stages must be comma-separated positive integers')
    if not stages or any(value < 1 or value > 1000 for value in stages):
        parser.error('--stages values must be in the range 1..1000')
    if args.iterations < 1 or args.iterations > 50:
        parser.error('--iterations must be in the range 1..50')

    account_mode = f'prefix {args.username_prefix}###' if args.username_prefix else 'one shared account'
    print(f"Target: {parsed.scheme}://{parsed.netloc} | role: {args.role} | account mode: {account_mode} | iterations: {args.iterations}")
    print('Only login and GET requests are sent. Server CPU, memory, and database connections require host-side metrics.')
    for users in stages:
        barrier = threading.Barrier(users)
        stage_started = time.perf_counter()
        results = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=users) as executor:
            futures = [
                executor.submit(
                    virtual_user, args.base_url,
                    f'{args.username_prefix}{user_index + 1:03d}' if args.username_prefix else args.username,
                    args.password,
                    args.role, barrier, args.iterations,
                )
                for user_index in range(users)
            ]
            for future in concurrent.futures.as_completed(futures):
                try:
                    results.extend(future.result())
                except Exception as error:
                    results.append({'path': '[virtual user]', 'status': 0, 'elapsed_ms': 0, 'error': type(error).__name__})
        elapsed = time.perf_counter() - stage_started
        statuses = Counter(row['status'] for row in results)
        by_path = defaultdict(list)
        for row in results:
            by_path[row['path'].split(' [transport:', 1)[0]].append(row)
        durations = [row['elapsed_ms'] for row in results]
        errors = sum(count for status, count in statuses.items() if status < 200 or status >= 400)
        print(
            f'users={users} requests={len(results)} throughput={len(results) / elapsed:.2f}/s '
            f'p50={percentile(durations, .50)}ms p95={percentile(durations, .95)}ms '
            f'p99={percentile(durations, .99)}ms errors={errors} '
            f'error_rate={errors / max(len(results), 1) * 100:.2f}% statuses={dict(statuses)}'
        )
        for path, rows in sorted(by_path.items()):
            print(
                f'  {path}: n={len(rows)} p95={percentile([row["elapsed_ms"] for row in rows], .95)}ms '
                f'failures={sum(row["status"] < 200 or row["status"] >= 400 for row in rows)}'
            )


if __name__ == '__main__':
    main()
