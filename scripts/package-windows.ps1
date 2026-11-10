[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'Run this script on Windows with the MSVC Rust toolchain installed.'
}

$projectRoot = Split-Path $PSScriptRoot -Parent
Push-Location $projectRoot
try {
    $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
    $target = 'x86_64-pc-windows-msvc'
    $releaseDir = Join-Path $projectRoot 'build/releases'
    $stage = Join-Path $projectRoot "build/windows/YouTerm-$version-windows-x64"
    $binaryDir = Join-Path $projectRoot "src-tauri/target/$target/release"

    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    & cargo build --locked --release --target $target --manifest-path src-tauri/Cargo.toml
    if ($LASTEXITCODE -ne 0) { throw 'Windows native build failed.' }
    & npx.cmd --yes '@tauri-apps/cli@2.12.4' bundle --ci --target $target --bundles nsis
    if ($LASTEXITCODE -ne 0) { throw 'Windows installer packaging failed.' }

    if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
    New-Item $stage, $releaseDir -ItemType Directory -Force | Out-Null
    Copy-Item (Join-Path $binaryDir 'youterm.exe') (Join-Path $stage 'YouTerm.exe')
    Copy-Item dist (Join-Path $stage 'dist') -Recurse
    Copy-Item LICENSE, COPYRIGHT $stage
    Copy-Item .env.example (Join-Path $stage 'config.example.env')
    @"
YouTerm $version - Windows x64

Extract the entire ZIP, then open YouTerm.exe. Keep the dist folder next to it.
Requires Windows 10/11 and Microsoft Edge WebView2 Runtime.
The setup.exe installer installs WebView2 automatically when it is missing.

Settings and backgrounds are stored in your Windows user profile.
Optional fallback audio extractor: place yt-dlp.exe next to YouTerm.exe,
install yt-dlp on PATH, or set YTDLP_BINARY to its executable path.

Source code and build scripts (GNU GPLv3):
https://github.com/RDSM243/YouTerm/tree/v$version
https://github.com/RDSM243/YouTerm/archive/refs/tags/v$version.tar.gz
"@ | Set-Content (Join-Path $stage 'README.txt') -Encoding utf8

    $installers = @(Get-ChildItem (Join-Path $binaryDir 'bundle/nsis') -Filter '*-setup.exe')
    if ($installers.Count -ne 1) { throw 'Expected exactly one NSIS installer.' }
    $installerName = "YouTerm-$version-windows-x64-setup.exe"
    Copy-Item $installers[0].FullName (Join-Path $releaseDir $installerName) -Force
    $zipName = "YouTerm-$version-windows-x64.zip"
    Compress-Archive -Path $stage -DestinationPath (Join-Path $releaseDir $zipName) -Force
    $checksums = foreach ($name in @($installerName, $zipName)) {
        $hash = (Get-FileHash (Join-Path $releaseDir $name) -Algorithm SHA256).Hash.ToLowerInvariant()
        "$hash  $name"
    }
    $checksums | Set-Content (Join-Path $releaseDir 'SHA256SUMS-windows.txt') -Encoding ascii
    Get-ChildItem $releaseDir -Filter "*-$version-windows-*"
} finally {
    Pop-Location
}
