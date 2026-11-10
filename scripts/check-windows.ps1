[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Package,
    [Parameter(Mandatory)][string]$Installer,
    [Parameter(Mandatory)][string]$TestRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Package = (Resolve-Path $Package).Path
$Installer = (Resolve-Path $Installer).Path
New-Item $TestRoot -ItemType Directory -Force | Out-Null
Expand-Archive -Path $Package -DestinationPath (Join-Path $TestRoot 'portable') -Force
$portable = @(Get-ChildItem (Join-Path $TestRoot 'portable') -Recurse -Filter 'YouTerm.exe')
if ($portable.Count -ne 1) { throw 'Expected exactly one portable executable.' }

function Invoke-PackageCheck([string]$Executable, [string]$Mode, [string]$Name) {
    $stdout = Join-Path $TestRoot "$Name.stdout.log"
    $stderr = Join-Path $TestRoot "$Name.stderr.log"
    $dataDir = Join-Path $TestRoot "$Name-data"
    $process = Start-Process -FilePath $Executable -WorkingDirectory $TestRoot `
        -ArgumentList @($Mode, '--data-dir', "`"$dataDir`"") -PassThru `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    if (-not $process.WaitForExit(60000)) {
        Stop-Process -Id $process.Id -Force
        throw "$Name timed out."
    }
    # Refresh redirected handles before reading output and ExitCode.
    $process.WaitForExit()
    Get-Content $stderr | Write-Host
    $output = Get-Content $stdout -Raw
    Write-Host $output
    if ($process.ExitCode -ne 0) { throw "$Name exited with code $($process.ExitCode)." }
    return ($output | ConvertFrom-Json)
}

$report = Invoke-PackageCheck $portable[0].FullName '--check' 'portable-check'
if (-not $report.built -or $report.platform -ne 'windows' -or $report.webview -ne 'webview2') {
    throw 'Portable executable did not find its frontend or Windows platform.'
}

$installDir = Join-Path $TestRoot 'installed'
$setup = Start-Process -FilePath $Installer -ArgumentList "/S /D=$installDir" -PassThru
if (-not $setup.WaitForExit(120000)) {
    Stop-Process -Id $setup.Id -Force
    throw 'Silent installation timed out.'
}
$setup.WaitForExit()
if ($setup.ExitCode -ne 0) { throw "Installer exited with code $($setup.ExitCode)." }
$installedExe = Join-Path $installDir 'youterm.exe'
if (-not (Test-Path $installedExe)) { throw 'Installed executable is missing.' }
$report = Invoke-PackageCheck $installedExe '--check' 'installed-check'
if (-not $report.built) { throw 'Installed application did not find its frontend resources.' }
$report = Invoke-PackageCheck $installedExe '--smoke-test' 'native-smoke'
if ($report.native.platform -ne 'windows' -or -not $report.native.bridge -or `
    -not $report.native.settings -or -not $report.native.themes -or -not $report.native.audio) {
    throw 'Installed application failed the Windows native smoke test.'
}
Write-Host 'Portable package, NSIS installer, frontend resources and Windows native smoke test passed.'
