$ErrorActionPreference = "Stop"
$Gallery = Split-Path -Parent $PSScriptRoot
Set-Location $Gallery

Write-Host "Deploying from: $Gallery"

python "$Gallery\scripts\prepare_deploy.py"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm install
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$env:GIT_DIR = $null
$env:GIT_WORK_TREE = $null
$env:NETLIFY_SITE_ID = "0778e75e-0da7-4f9c-9c71-e64daafec66c"

Write-Host ""
Write-Host "Step 1: Upload build (draft deploy)..."
$deployOut = npx netlify deploy --dir . --functions netlify/functions --message "Gallery update" --json 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host $deployOut
  exit $LASTEXITCODE
}

$deployId = $null
foreach ($line in ($deployOut -split "`n")) {
  if ($line -match '"deploy_id"\s*:\s*"([^"]+)"') { $deployId = $Matches[1] }
  if ($line -match '"id"\s*:\s*"([a-f0-9]{32})"') { $deployId = $Matches[1] }
}
if (-not $deployId -and ($deployOut -match 'https://([a-f0-9]+)--1000-l7in\.netlify\.app')) {
  $deployId = $Matches[1]
}

if (-not $deployId) {
  Write-Host $deployOut
  Write-Host "Could not read deploy id from Netlify output."
  exit 1
}

Write-Host "Draft deploy: $deployId"
Write-Host ""
Write-Host "Step 2: Publish to production URL..."
node "$Gallery\scripts\restore_deploy.mjs" $deployId
exit $LASTEXITCODE