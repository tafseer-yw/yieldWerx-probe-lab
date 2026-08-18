$base = 'http://127.0.0.1:5000'
$ErrorActionPreference = 'Stop'
$uploadId = $null

try {
  Write-Host '=== health ==='
  $health = Invoke-RestMethod "$base/health" -TimeoutSec 5
  if ($health.status -ne 'ok') { throw "Health returned '$($health.status)'." }

  Write-Host '=== login dev ==='
  $login = Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType 'application/json' -Body '{"username":"dev","password":"dev"}' -TimeoutSec 10
  $headers = @{ Authorization = "Bearer $($login.accessToken)" }

  Write-Host '=== reference data ==='
  $devices = Invoke-RestMethod "$base/api/reference/devices" -Headers $headers -TimeoutSec 10
  if ('PROBE-DEV-1' -notin $devices.code) { throw 'PROBE-DEV-1 is missing.' }

  Write-Host '=== upload CSV ==='
  $lot = "LOT-SMOKE-$(Get-Date -Format 'yyyyMMddHHmmss')"
  $csv = (Get-Content -Raw 'database\sample-wafer.csv') -replace 'LOT-DEMO-01', $lot
  $upload = Invoke-RestMethod "$base/api/uploads?device=PROBE-DEV-1&program=PROBE-PGM-1" -Method Post -Headers $headers -ContentType 'text/csv' -Body $csv -TimeoutSec 20
  $uploadId = $upload.uploadId

  Write-Host '=== upload status and exact wafer ==='
  $summary = Invoke-RestMethod "$base/api/uploads/$uploadId" -Headers $headers -TimeoutSec 10
  if ($summary.status -ne 'Succeeded' -or $summary.rowsAccepted -ne 25 -or -not $summary.waferSequence) {
    throw "Unexpected upload result: status=$($summary.status), accepted=$($summary.rowsAccepted)."
  }
  $wafer = Invoke-RestMethod "$base/api/wafers/$($summary.waferSequence)" -Headers $headers -TimeoutSec 10
  if ($wafer.lot -ne $lot -or $wafer.partCount -ne 25 -or $wafer.passCount -ne 20) {
    throw 'The landed wafer does not match the uploaded CSV.'
  }

  Write-Host '=== RBAC: viewer upload must return 403 ==='
  $viewer = Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType 'application/json' -Body '{"username":"viewer","password":"viewer"}' -TimeoutSec 10
  $viewerHeaders = @{ Authorization = "Bearer $($viewer.accessToken)" }
  try {
    Invoke-RestMethod "$base/api/uploads?device=PROBE-DEV-1&program=PROBE-PGM-1" -Method Post -Headers $viewerHeaders -ContentType 'text/csv' -Body $csv -TimeoutSec 20
    throw 'Viewer upload unexpectedly succeeded.'
  }
  catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    if ($statusCode -ne 403) { throw }
  }

  Write-Host '=== PASS ==='
}
catch {
  Write-Error "Smoke test failed: $($_.Exception.Message)"
  exit 1
}
finally {
  if ($uploadId) {
    try {
      $admin = Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType 'application/json' -Body '{"username":"admin","password":"admin"}' -TimeoutSec 10
      $adminHeaders = @{ Authorization = "Bearer $($admin.accessToken)" }
      Invoke-RestMethod "$base/api/uploads/$uploadId" -Method Delete -Headers $adminHeaders -TimeoutSec 10
      Write-Host 'Removed smoke-test upload.'
    }
    catch {
      Write-Warning "Could not remove smoke-test upload $uploadId."
    }
  }
}

exit 0
