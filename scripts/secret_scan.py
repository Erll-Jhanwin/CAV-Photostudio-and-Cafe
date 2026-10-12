"""Small CI guard for known secret/demo credential regressions."""

from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
tracked = subprocess.check_output(['git', 'ls-files'], cwd=ROOT, text=True).splitlines()
excluded = {'package-lock.json', 'frontend/package-lock.json', 'scripts/secret_scan.py'}
findings = []
known_bad = re.compile(r'(Customer123!|Staff123!|Admin123!|d7f87d0abfb8c4e9fd8cfcd028a12411e2dde2f6|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)')
provider_assignment = re.compile(r"(?i)^(?:IPROG_SMS_API_TOKEN|RESEND_API_KEY|OCR_API_KEY)\s*=\s*(['\"])(?!replace-with|your-|re_your_|$)[^'\"]{12,}\1\s*$")

for relative in tracked:
    if relative in excluded or '/tests.' in f'/{relative}' or relative.endswith('_test.py'):
        continue
    path = ROOT / relative
    if not path.is_file():
        continue
    try:
        text = path.read_text(encoding='utf-8')
    except UnicodeDecodeError:
        continue
    if known_bad.search(text):
        findings.append(f'{relative}: known credential/token pattern')
    for line_number, line in enumerate(text.splitlines(), 1):
        if provider_assignment.search(line.strip()):
            findings.append(f'{relative}:{line_number}: provider secret assignment')

if findings:
    print('\n'.join(findings))
    sys.exit(1)
print('Secret scan passed: no known committed credentials or provider tokens found.')
