# Sign a release with minisign: download its draft, check every file
# against the SHA256SUMS the Release workflow wrote, sign that list as
# it is and upload the signature.
# The secret key never leaves this machine. CI only ever builds.
#
# The Release workflow built each file twice, compared the two builds
# and wrote SHA256SUMS; anyone can rebuild the files with
# reproducible/verify.sh and compare them with that list. This script
# signs the list only if the draft holds exactly the five files of a
# release and each one has the hash the list gives it.
#
# Usage:  pwsh scripts/sign-release.ps1 v0.1.0
#         (works on the draft release before you click Publish)

param([Parameter(Mandatory)][string]$Tag)
$ErrorActionPreference = "Stop"
$repo = "gerfaut-wallet/gerfaut-desktop"

if ($Tag -notmatch '^v(\d+\.\d+\.\d+)$') { throw "not a release tag: $Tag" }
$version = $Matches[1]
if (-not (Get-Command minisign -ErrorAction SilentlyContinue)) {
    throw "minisign not found - install it first (https://jedisct1.github.io/minisign/)"
}

$dir = Join-Path ([System.IO.Path]::GetTempPath()) "gerfaut-desktop-sign-$Tag"
if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
New-Item -ItemType Directory $dir | Out-Null

Write-Output "downloading $Tag from the draft..."
gh release download $Tag --repo $repo --dir $dir
if ($LASTEXITCODE -ne 0) { throw "gh release download failed" }

# The five files of a release, named as reproducible/ builds them.
$expected = @(
    "Gerfaut-$version-1.x86_64.rpm",
    "Gerfaut_${version}_amd64.AppImage",
    "Gerfaut_${version}_amd64.deb",
    "Gerfaut_${version}_universal.zip",
    "Gerfaut_${version}_x64-setup.exe"
) | Sort-Object
$present = Get-ChildItem $dir -File |
    Where-Object { $_.Name -ne "SHA256SUMS" -and $_.Name -ne "SHA256SUMS.minisig" } |
    ForEach-Object Name | Sort-Object
$difference = Compare-Object $expected $present
if ($difference) {
    $difference | ForEach-Object {
        $side = if ($_.SideIndicator -eq "<=") { "missing" } else { "unexpected" }
        Write-Output "  $side : $($_.InputObject)"
    }
    throw "the draft does not hold exactly the five files of $Tag"
}

# The list the workflow wrote: one "<hash>  <name>" line per file, LF,
# nothing else. It is signed byte for byte as it is.
$sums = Join-Path $dir "SHA256SUMS"
if (-not (Test-Path $sums)) { throw "the draft has no SHA256SUMS: was it made by the Release workflow?" }
$bytes = [System.IO.File]::ReadAllBytes($sums)
if ($bytes -contains 13) { throw "SHA256SUMS has a carriage return" }
$lines = [System.Text.Encoding]::ASCII.GetString($bytes).TrimEnd("`n").Split("`n")
$listed = @{}
foreach ($line in $lines) {
    if ($line -notmatch '^([0-9a-f]{64})  (\S+)$') { throw "unexpected line in SHA256SUMS: $line" }
    $listed[$Matches[2]] = $Matches[1]
}
if (Compare-Object $expected ($listed.Keys | Sort-Object)) { throw "SHA256SUMS does not list exactly the five files" }
foreach ($name in $expected) {
    $have = (Get-FileHash (Join-Path $dir $name) -Algorithm SHA256).Hash.ToLower()
    if ($have -ne $listed[$name]) { throw "$name does not match SHA256SUMS: $have" }
    Write-Output "  ok  $($listed[$name])  $name"
}

Write-Output "signing (minisign will ask for your key password)..."
minisign -Sm $sums -t "Gerfaut $Tag"
if ($LASTEXITCODE -ne 0) { throw "minisign failed" }

gh release upload $Tag "$sums.minisig" --repo $repo --clobber
if ($LASTEXITCODE -ne 0) { throw "gh release upload failed" }
Write-Output "done: SHA256SUMS.minisig attached to $Tag, next to the SHA256SUMS the workflow wrote."
Write-Output "review the draft on GitHub, then click Publish."
