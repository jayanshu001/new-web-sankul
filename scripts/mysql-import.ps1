# Import websankul_staging.sql into the ws-mysql Docker container.
# Run from repo root:  .\scripts\mysql-import.ps1

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Dump = Join-Path $Root "..\websankul-staging\database\websankul_staging.sql"
$Password = if ($env:MYSQL_ROOT_PASSWORD) { $env:MYSQL_ROOT_PASSWORD } else { "websankul_dev" }

if (-not (Test-Path $Dump)) {
    Write-Error "Dump not found: $Dump"
}

Set-Location $Root

Write-Host "Starting ws-mysql (if not running)..."
docker compose up -d ws-mysql

Write-Host "Waiting for MySQL to accept connections..."
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    cmd /c "docker compose exec -T ws-mysql mysql -uroot -p$Password -e `"SELECT 1`" 2>nul" | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $ready = $true
        break
    }
    Start-Sleep -Seconds 2
}
if (-not $ready) {
    Write-Error "MySQL did not become ready in time. Check: docker compose logs ws-mysql"
}

Write-Host "Recreating database websankul_staging..."
$initSql = @"
DROP DATABASE IF EXISTS websankul_staging;
CREATE DATABASE websankul_staging CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
"@
$initSql | cmd /c "docker compose exec -T ws-mysql mysql -uroot -p$Password 2>nul"

Write-Host "Importing dump (this may take a few minutes)..."
cmd /c "docker compose exec -T ws-mysql mysql -uroot -p$Password websankul_staging < `"$Dump`""
if ($LASTEXITCODE -ne 0) {
    Write-Error "Import failed with exit code $LASTEXITCODE"
}

Write-Host "Import complete. Run: yarn db:verify"
