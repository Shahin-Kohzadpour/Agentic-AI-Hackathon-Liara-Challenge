"""Package an explicit allowlist; never include local state or credentials."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'artifacts'
ART.mkdir(exist_ok=True)
secrets = []
env = ROOT / '.env'
if env.exists():
    for line in env.read_text().splitlines():
        name, separator, value = line.partition('=')
        if separator and any(word in name.upper() for word in ('TOKEN', 'SECRET', 'PASSWORD', 'KEY')):
            value = value.strip().strip('\"\'')
            if len(value) >= 12:
                secrets.append(value.encode())
for name in ('human-key', 'mcp-key'):
    path = ROOT / '.data' / name
    if path.exists():
        secrets.append(path.read_bytes().strip())

def checked(path):
    assert path.is_file() and not path.is_symlink(), f'Invalid file: {path.name}'
    data = path.read_bytes()
    assert not any(secret and secret in data for secret in secrets), f'Private value detected: {path.name}'
    assert not re.search(rb'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}', data), f'JWT detected: {path.name}'
    return data

files = subprocess.check_output(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], cwd=ROOT).split(b'\0')
source = {}
for item in files:
    if not item:
        continue
    relative = Path(item.decode())
    assert not relative.is_absolute() and '..' not in relative.parts
    if relative.parts[0] == 'submission':
        continue
    assert relative.parts[0] not in ('.git', '.data', 'artifacts', 'node_modules', 'dist')
    assert relative.name != '.env'
    source[relative.as_posix()] = checked(ROOT / relative)

evidence_names = [
    'live-recovery-report.json', 'live-repair-proposal.json', 'mcp-check.json',
    'mcp-check-readonly.json', 'browser-check.json', 'liara-spike.json',
    'refreshed-live-evidence.json', 'presentation-manifest.json',
    'live-request-before.png', 'live-request-after.png', 'live-recovery-report.png',
]
evidence = {name: checked(ART / name) for name in evidence_names}
videos = {name: checked(ART / name) for name in ('DEMO.fa.mp4', 'LIVE-RUN.silent.mp4')}

def archive(name, entries):
    target = ART / name
    with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
        for relative, data in sorted(entries.items()):
            output.writestr(relative, data)
    with zipfile.ZipFile(target) as output:
        assert output.testzip() is None
        assert set(output.namelist()) == set(entries)
    return {'file': name, 'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'entries': len(entries)}

manifest = [archive('negahban-source.zip', {f'liara-sre-agent/{name}': data for name, data in source.items()})]
submission = {f'source/{name}': data for name, data in source.items()}
submission.update({f'evidence/{name}': data for name, data in evidence.items()})
submission.update(videos)
manifest.append(archive('negahban-submission.zip', submission))
(ART / 'package-manifest.json').write_text(json.dumps({'knownLocalSecretValuesChecked': True, 'archives': manifest}, indent=2))
print(json.dumps(manifest, indent=2))
