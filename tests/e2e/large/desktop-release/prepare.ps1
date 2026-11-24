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

$root = Join-Path $env:RUNNER_TEMP 'book-props-desktop'
New-Item -ItemType Directory $root | Out-Null
Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $root 'bundle')
$browser = Join-Path $root 'chrome.zip'
Invoke-WebRequest 'https://storage.googleapis.com/chrome-for-testing-public/157.0.8103.79/win64/chrome-win64.zip' -OutFile $browser
Expand-Archive -LiteralPath $browser -DestinationPath $root
# A ZIP extraction lacks the AppContainer read/execute ACL the Chrome installer sets.
icacls (Join-Path $root 'chrome-win64') /grant '*S-1-15-2-2:(OI)(CI)(RX)'
if ($LASTEXITCODE -ne 0) { throw 'Could not set Chrome AppContainer read/execute ACL' }

$migration = Join-Path $env:RUNNER_TEMP 'book-props-migration'
New-Item -ItemType Directory $migration | Out-Null
Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $migration 'bundle')
$previous = Join-Path $migration 'book-props-v0.1.0.zip'
Invoke-WebRequest 'https://github.com/YukiIto1999/book-props/releases/download/v0.1.0/book-props-v0.1.0.zip' -OutFile $previous
if ((Get-FileHash -LiteralPath $previous -Algorithm SHA256).Hash.ToLowerInvariant() -cne 'bf4a01a64226eb8c9b8766d04ced089a84e2e9ace1424330b8046f0bee53a6d3') {
    throw 'The immutable v0.1.0 ZIP does not match the migration fixture digest'
}
Expand-Archive -LiteralPath $previous -DestinationPath (Join-Path $migration 'legacy')
