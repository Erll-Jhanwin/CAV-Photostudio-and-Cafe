"""CI guard for committed environment files and credential-shaped literals.

Only file paths and variable names are reported. Secret values are never printed.
"""

from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
tracked = subprocess.check_output(['git', 'ls-files'], cwd=ROOT, text=True).splitlines()
excluded = {'package-lock.json', 'frontend/package-lock.json', 'scripts/secret_scan.py'}
findings = []
known_bad = re.compile(r'(Customer123!|Staff123!|Admin123!|d7f87d0abfb8c4e9fd8cfcd028a12411e2dde2f6|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)')
assignment = re.compile(
    r"(?im)^\s*(?:export\s+)?(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*"
    r"(?P<value>[^\r\n]+)$"
)
sensitive_name = re.compile(
    r"(?i)(?:^|_)(?:SECRET|SECRET_KEY|PASSWORD|PASSWD|TOKEN|API_KEY|PRIVATE_KEY|"
    r"SERVICE_ROLE_KEY|ACCESS_KEY|DATABASE_URL|CONNECTION_STRING|CLIENT_SECRET|SIGNING_KEY)$"
)
placeholder = re.compile(
    r"(?i)(?:^|[\s_\-<'\"])(?:your|replace|placeholder|example|dummy|"
    r"test.only|test.secret|not.for.deployment|local.development|change.me|set.me)(?:$|[\s_\->'\"])"
)
credential_formats = [
    ('AWS access key', re.compile(r'\bAKIA[0-9A-Z]{16}\b')),
    ('GitHub token', re.compile(r'\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b')),
    ('GitLab token', re.compile(r'\bglpat-[A-Za-z0-9_-]{20,}\b')),
    ('OpenAI or OpenRouter key', re.compile(r'\bsk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{24,}\b')),
    ('Supabase secret key', re.compile(r'\bsb_secret_[A-Za-z0-9_-]{24,}\b')),
    ('Stripe secret key', re.compile(r'\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b')),
    ('private key material', re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')),
]

for relative in tracked:
    path_parts = Path(relative).parts
    filename = path_parts[-1] if path_parts else ''
    is_test_fixture = (
        'tests' in path_parts
        or filename == 'tests.py'
        or filename.startswith('test_')
        or '.test.' in filename
        or filename.endswith('_test.py')
    )
    if relative in excluded:
        continue
    if filename.lower() == '.env' or filename.lower().startswith('.env.') or filename.lower().endswith('.env'):
        findings.append(f'{relative}: tracked environment file')
        continue
    path = ROOT / relative
    if not path.is_file():
        continue
    try:
        text = path.read_text(encoding='utf-8')
    except UnicodeDecodeError:
        continue
    if not is_test_fixture and known_bad.search(text):
        findings.append(f'{relative}: known credential/token pattern')
    for label, pattern in credential_formats:
        if pattern.search(text):
            findings.append(f'{relative}: {label} pattern')
    for line_number, line in enumerate(text.splitlines(), 1):
        match = assignment.match(line)
        if is_test_fixture or not match or not sensitive_name.search(match.group('name')):
            continue
        raw_value = match.group('value').strip()
        if raw_value.startswith(('"', "'", '`')):
            quote = raw_value[0]
            closing_quote = raw_value.find(quote, 1)
            if closing_quote < 0 or raw_value[closing_quote + 1:].strip().rstrip(',;').strip():
                continue
            value = raw_value[1:closing_quote]
        elif path.suffix.lower() in {'.yaml', '.yml', '.toml', '.ini', '.cfg'} and not re.search(r'\s', raw_value):
            value = raw_value.split('#', 1)[0].strip().rstrip(',;')
        else:
            continue
        if not value or placeholder.search(value):
            continue
        if match.group('name').upper() == 'DATABASE_URL' and value.lower().startswith(('sqlite:', 'postgres://localhost', 'postgresql://localhost')):
            continue
        # Ignore values sourced from an environment/secret manager or template.
        if re.search(r'(?i)(?:os\.environ|process\.env|getenv\(|secrets\.|\$\{\{|\$\{[A-Z_])', value):
            continue
        findings.append(f'{relative}:{line_number}: literal assigned to {match.group("name")}')

if findings:
    print('\n'.join(findings))
    sys.exit(1)
print('Secret scan passed: no known committed credentials or provider tokens found.')
