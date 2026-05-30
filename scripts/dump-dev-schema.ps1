$ErrorActionPreference = 'Stop'
$ref = 'ftryuvfdihmhlzvbpfeu'
$outDir = 'C:\Users\yonatanam\Desktop\wc2026-backup-2026-05-30'
$outFile = Join-Path $outDir 'dev-schema-2026-05-30.sql'

Write-Host ''
Write-Host '======================================' -ForegroundColor Cyan
Write-Host '   Dev Supabase Schema Dump'             -ForegroundColor Cyan
Write-Host '======================================' -ForegroundColor Cyan
Write-Host ''
Write-Host "  Project: $ref"
Write-Host "  Output:  $outFile"
Write-Host ''

if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

# Hidden password prompt
Write-Host 'Get your DB password from dashboard: Reset database password if needed.'
$securePw = Read-Host '>>> Paste your dev DB password (chars hidden)' -AsSecureString
$bstr     = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePw)
$plainPw  = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr).Trim()
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) | Out-Null

if ([string]::IsNullOrWhiteSpace($plainPw)) {
    Write-Host ''
    Write-Host 'ERROR: empty password, aborting.' -ForegroundColor Red
    Write-Host 'Press Enter to close...'
    Read-Host | Out-Null
    exit 1
}

# Guard against the dashboard placeholder text
if ($plainPw -eq '[YOUR-PASSWORD]' -or $plainPw -like '*YOUR-PASSWORD*') {
    Write-Host ''
    Write-Host 'ERROR: you pasted the placeholder, not the real password.' -ForegroundColor Red
    Write-Host 'Reset the password in Supabase dashboard and try again.' -ForegroundColor Red
    Write-Host 'Press Enter to close...'
    Read-Host | Out-Null
    exit 1
}

Write-Host ('Password length: ' + $plainPw.Length + ' chars') -ForegroundColor DarkGray

# RFC 3986 percent-encoding for URI components
$encPw = [System.Uri]::EscapeDataString($plainPw)

# Session pooler URL (IPv4, region ap-northeast-1)
$dbUrl = "postgresql://postgres.${ref}:${encPw}@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"

$pgDump = 'C:\Program Files\PostgreSQL\17\bin\pg_dump.exe'
if (-not (Test-Path $pgDump)) {
    Write-Host "ERROR: pg_dump.exe not found at $pgDump" -ForegroundColor Red
    Write-Host 'Make sure PostgreSQL 17 install completed.' -ForegroundColor Red
    Write-Host 'Press Enter to close...'
    Read-Host | Out-Null
    exit 1
}

Write-Host ''
Write-Host '>>> Running pg_dump against Session pooler...' -ForegroundColor Yellow
Write-Host ''

try {
    & $pgDump --dbname=$dbUrl --schema-only --no-owner --no-privileges --schema=public --file=$outFile
} catch {
    Write-Host ''
    Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
}

# Clear password from memory
$plainPw = $null
$encPw   = $null
$dbUrl   = $null
[GC]::Collect()

Write-Host ''
Write-Host '======================================' -ForegroundColor Cyan
if (Test-Path $outFile) {
    $size = (Get-Item $outFile).Length
    if ($size -gt 1000) {
        Write-Host '  SUCCESS' -ForegroundColor Green
        Write-Host ('  File:  ' + $outFile)
        Write-Host ('  Size:  ' + $size + ' bytes')
        Write-Host ''
        Write-Host '  First 10 lines:'
        Get-Content $outFile -TotalCount 10 | ForEach-Object { Write-Host ('    ' + $_) -ForegroundColor DarkGray }
    } else {
        Write-Host ('  FAILED: file is empty or near-empty (' + $size + ' bytes)') -ForegroundColor Red
        Write-Host '  pg_dump connected but produced no usable output.' -ForegroundColor Red
        Write-Host '  Check the error message above this banner.' -ForegroundColor Red
        Remove-Item $outFile -Force
    }
} else {
    Write-Host '  FAILED: file not created' -ForegroundColor Red
}
Write-Host '======================================' -ForegroundColor Cyan
Write-Host ''
Write-Host '>>> Press Enter to close this window...'
Read-Host | Out-Null
