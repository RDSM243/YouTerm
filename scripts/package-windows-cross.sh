#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# Match Cargo's local pkg-config overrides when the CLI probes host libraries.
if [[ -d "$PROJECT_ROOT/src-tauri/pkgconfig" ]]; then
  export PKG_CONFIG_PATH="$PROJECT_ROOT/src-tauri/pkgconfig${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
fi

if [[ "${1:-}" != "--skip-build" ]]; then
  npm run build
  cargo xwin build --locked --release --target x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml
fi

# The Windows-specific configuration selects NSIS and includes the dist resources.
npm exec --yes --package=@tauri-apps/cli@2.12.4 -- tauri bundle --ci --target x86_64-pc-windows-msvc

python3 - <<'PY'
import hashlib
import json
from pathlib import Path
import shutil
import zipfile

root = Path.cwd()
version = json.loads((root / 'package.json').read_text())['version']
native = root / 'src-tauri/target/x86_64-pc-windows-msvc/release'
stage = root / f'build/windows/YouTerm-{version}-windows-x64'
releases = root / 'build/releases'
if stage.exists():
    shutil.rmtree(stage)
stage.mkdir(parents=True)
releases.mkdir(parents=True, exist_ok=True)
shutil.copy2(native / 'youterm.exe', stage / 'YouTerm.exe')
shutil.copytree(root / 'dist', stage / 'dist')
for name in ['LICENSE', 'COPYRIGHT']:
    shutil.copy2(root / name, stage / name)
shutil.copy2(root / '.env.example', stage / 'config.example.env')
(stage / 'README.txt').write_text(f'''YouTerm {version} - Windows x64

Extract the entire ZIP, then open YouTerm.exe. Keep the dist folder next to it.
Requires Windows 10/11 and Microsoft Edge WebView2 Runtime.
The setup.exe installer installs WebView2 automatically when it is missing.

Settings and backgrounds are stored in your Windows user profile.
Optional fallback audio extractor: place yt-dlp.exe next to YouTerm.exe,
install yt-dlp on PATH, or set YTDLP_BINARY to its executable path.

Source code and build scripts (GNU GPLv3):
https://github.com/RDSM243/YouTerm/tree/v{version}
https://github.com/RDSM243/YouTerm/archive/refs/tags/v{version}.tar.gz
''', encoding='utf-8')
installers = list((native / 'bundle/nsis').glob('*-setup.exe'))
if len(installers) != 1:
    raise SystemExit('Expected exactly one NSIS installer.')
installer = releases / f'YouTerm-{version}-windows-x64-setup.exe'
shutil.copy2(installers[0], installer)
archive = releases / f'YouTerm-{version}-windows-x64.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as output:
    for path in sorted(stage.rglob('*')):
        if path.is_file():
            output.write(path, path.relative_to(stage.parent))
checksums = ''.join(f'{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n' for path in [installer, archive])
(releases / 'SHA256SUMS-windows.txt').write_text(checksums, encoding='ascii')
print(checksums, end='')
PY
