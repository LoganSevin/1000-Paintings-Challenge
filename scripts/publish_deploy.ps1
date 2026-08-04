$Gallery = Split-Path -Parent $PSScriptRoot
Set-Location $Gallery

$deployId = "6a25c03f7dbaa45b2bf680aa"
$siteId = "0778e75e-0da7-4f9c-9c71-e64daafec66c"

Write-Host "Publishing deploy $deployId to production..."
npx netlify api restoreSiteDeploy --data "{`"site_id`":`"$siteId`",`"deploy_id`":`"$deployId`"}"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Done. Production URL: https://1000-l7in.netlify.app"
exit 0