param(
    [Parameter(Mandatory)][string]$AssetDirectory,
    [Parameter(Mandatory)][ValidatePattern('^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')][string]$Tag,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{64}$')][string]$Digest
)

$ErrorActionPreference = 'Stop'
$filename = "book-props-$Tag.zip"
$archive = Join-Path $AssetDirectory $filename
$expected = (Get-Content (Join-Path $AssetDirectory 'SHA256SUMS') -Raw).Trim()
$actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -cne $Digest -or $expected -cne "$Digest  $filename") { throw 'ZIP hash mismatch' }
Write-Host "Input SHA-256: $actual"

$root = Join-Path $env:RUNNER_TEMP 'book-props-windows-acceptance'
New-Item -ItemType Directory $root | Out-Null
Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $root 'bundle')
$browser = Join-Path $root 'chrome.zip'
Invoke-WebRequest 'https://storage.googleapis.com/chrome-for-testing-public/157.0.8103.79/win64/chrome-win64.zip' -OutFile $browser
Expand-Archive -LiteralPath $browser -DestinationPath $root
# A ZIP extraction lacks the AppContainer read/execute ACL the Chrome installer sets.
icacls (Join-Path $root 'chrome-win64') /grant '*S-1-15-2-2:(OI)(CI)(RX)'
if ($LASTEXITCODE -ne 0) { throw 'Could not set Chrome AppContainer read/execute ACL' }
