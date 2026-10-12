#Requires -Version 5.1
<#
Phase 0 environment discovery for the Roznama ERP program.
Read-only: does not install, modify, start, or stop anything.
Run this ON THE MACHINE that hosts Onfinity and PostgreSQL, then
review the generated report for secrets before committing it.

Usage:
    .\phase0-discovery.ps1 [-OutputDir <path>]
#>

param(
    [string]$OutputDir = "$PSScriptRoot\..\docs\discovery"
)

if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$reportPath = Join-Path $OutputDir "$timestamp-system-inventory.local.md"

function Try-Run {
    param([string]$Label, [scriptblock]$Block)
    try {
        $result = & $Block
        if ($null -eq $result -or $result -eq "") { return "$Label`: (no result)" }
        return "$Label`: $result"
    } catch {
        return "$Label`: ERROR — $($_.Exception.Message)"
    }
}

$lines = @()
$lines += "# System Inventory — Phase 0 Discovery"
$lines += ""
$lines += "Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
$lines += ""
$lines += "**This file may contain host paths, service names, and configuration"
$lines += "values. Review and redact before committing** — see"
$lines += "`docs/01-system-inventory.md` for the sign-off checklist."
$lines += ""

$lines += "## Host environment"
$lines += ""
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$lines += "- OS: $($os.Caption) $($os.Version) ($($os.OSArchitecture))"
$lines += "- CPU: $($cpu.Name) — $($cpu.NumberOfCores) cores / $($cpu.NumberOfLogicalProcessors) logical"
$lines += "- RAM: $([math]::Round($os.TotalVisibleMemorySize/1MB,1)) GB total, $([math]::Round($os.FreePhysicalMemory/1MB,1)) GB free"
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
    $lines += "- Disk $($_.DeviceID) $([math]::Round($_.Size/1GB,1)) GB total, $([math]::Round($_.FreeSpace/1GB,1)) GB free"
}
$lines += "- " + (Try-Run "Java" { (java -version 2>&1 | Select-Object -First 1).ToString() })
$lines += "- " + (Try-Run "JAVA_HOME" { $env:JAVA_HOME })
$lines += "- " + (Try-Run ".NET SDKs" { (dotnet --list-sdks 2>&1) -join "; " })
$lines += "- " + (Try-Run ".NET Runtimes" { (dotnet --list-runtimes 2>&1) -join "; " })
$lines += "- " + (Try-Run "Node.js" { (node -v 2>&1) })
$lines += "- " + (Try-Run "npm" { (npm -v 2>&1) })
$lines += "- " + (Try-Run "Git" { (git --version 2>&1) })
$lines += "- " + (Try-Run "Docker" { (docker --version 2>&1) })
$lines += "- " + (Try-Run "Docker daemon status" { (docker info --format '{{.ServerVersion}}' 2>&1) })
$lines += "- " + (Try-Run "PowerShell" { $PSVersionTable.PSVersion.ToString() })
$lines += "- " + (Try-Run "Python" { (python --version 2>&1) })
$lines += "- " + (Try-Run "Maven" { (mvn -v 2>&1 | Select-Object -First 1) })
$lines += "- " + (Try-Run "IIS" { (Get-Service W3SVC -ErrorAction Stop).Status })
$lines += ""

$lines += "## Onfinity installation"
$lines += ""
$lines += "Common install roots searched (adjust the list in this script if your"
$lines += "install lives elsewhere):"
$lines += ""
$searchRoots = @("C:\Onfinity", "C:\Program Files\Onfinity", "C:\Program Files (x86)\Onfinity", "D:\Onfinity", "C:\apps\onfinity")
foreach ($root in $searchRoots) {
    if (Test-Path $root) {
        $lines += "- FOUND: $root"
    } else {
        $lines += "- not present: $root"
    }
}
$lines += ""
$lines += "### Services matching 'onfinity' (case-insensitive)"
$svc = Get-Service | Where-Object { $_.Name -match 'onfinity' -or $_.DisplayName -match 'onfinity' }
if ($svc) {
    $svc | ForEach-Object { $lines += "- $($_.Name) — $($_.DisplayName) — $($_.Status)" }
} else {
    $lines += "- none found by name; check Task Manager / `services.msc` manually if Onfinity runs under a generic service name"
}
$lines += ""

$lines += "## PostgreSQL"
$lines += ""
$lines += "- " + (Try-Run "psql" { (psql --version 2>&1) })
$pgSvc = Get-Service | Where-Object { $_.Name -match 'postgres' -or $_.DisplayName -match 'postgres' }
if ($pgSvc) {
    $pgSvc | ForEach-Object { $lines += "- Service: $($_.Name) — $($_.DisplayName) — $($_.Status)" }
} else {
    $lines += "- No PostgreSQL Windows service found by name"
}
$lines += "- " + (Try-Run "Listening on 5432" {
    $conn = Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue
    if ($conn) { "yes — PID(s): $($conn.OwningProcess -join ', ')" } else { "no listener on 5432" }
})
$lines += ""

$lines += "## Listening ports (common ERP/DB/web range)"
$lines += ""
$ports = 80,443,5432,8080,8443,1433,3306,9990
foreach ($p in $ports) {
    $conn = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        $procNames = ($conn.OwningProcess | Sort-Object -Unique | ForEach-Object { (Get-Process -Id $_ -ErrorAction SilentlyContinue).ProcessName }) -join ", "
        $lines += "- Port $p`: LISTENING (process: $procNames)"
    } else {
        $lines += "- Port $p`: not in use"
    }
}
$lines += ""

$lines += "## Manual follow-up required"
$lines += ""
$lines += "- Confirm Onfinity version (expected: Community 6.4.1.0) from its About screen or install manifest"
$lines += "- Locate and redact-review Onfinity config file(s) for DB connection string, then record non-secret settings in `docs/01-system-inventory.md`"
$lines += "- Confirm the PostgreSQL database name and user Onfinity connects as"
$lines += "- Note existing backup/restore procedure, if any"
$lines += ""

$lines -join "`n" | Out-File -FilePath $reportPath -Encoding utf8

Write-Host "Report written to: $reportPath"
Write-Host "Review it for secrets before committing or pasting into docs/01-system-inventory.md."
