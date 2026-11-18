# Build the standalone inspection panel: dist\dsh-netops-gui.exe
# Usage: powershell -ExecutionPolicy Bypass -File scripts\build-gui.ps1
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'dist'

if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist | Out-Null

# Everything the panel needs at runtime. The exe only launches node; logic stays in lib/.
foreach ($item in @('gui', 'lib', 'profiles', 'scripts', 'package.json', 'icon.svg', 'README.md')) {
  $source = Join-Path $root $item
  if (Test-Path $source) {
    Copy-Item -Path $source -Destination $dist -Recurse -Force
  }
}

# Build-only files do not belong in dist.
Remove-Item (Join-Path $dist 'scripts\build-gui.ps1') -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $dist 'scripts\dev-run.mjs') -Force -ErrorAction SilentlyContinue

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
  throw "csc.exe not found: $csc (needs .NET Framework 4.x, bundled with Windows 10/11)"
}

$exe = Join-Path $dist 'dsh-netops-gui.exe'
& $csc /nologo /target:winexe /r:System.Windows.Forms.dll /out:$exe (Join-Path $root 'gui\launcher.cs')
if ($LASTEXITCODE -ne 0) { throw "compile failed (exit $LASTEXITCODE)" }

$size = [math]::Round((Get-Item $exe).Length / 1KB, 1)
Write-Host "Built: $exe ($size KB)"
Write-Host "Copy the whole dist folder to another machine; drop node.exe next to the exe if node is not installed."
