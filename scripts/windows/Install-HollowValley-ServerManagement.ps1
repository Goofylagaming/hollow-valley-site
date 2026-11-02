# One-time operator installation after the website management API is deployed.
# Does not restart The Isle or modify existing scheduled tasks.
[CmdletBinding()]
param(
    [string]$AgentPath = 'C:\HollowValley\Scripts\HollowValley-ServerManagementAgent.ps1',
    [string]$TaskName = 'Hollow Valley Server Management Agent'
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $AgentPath)) {
    throw "First copy the agent to $AgentPath"
}
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this installer in an elevated Administrator PowerShell window.'
}

$secretDir = 'C:\HollowValley\Secrets'
$secretPath = Join-Path $secretDir 'management-agent-token.txt'
New-Item -ItemType Directory -Path $secretDir -Force | Out-Null

Write-Host 'Enter the dedicated HV_MANAGEMENT_AGENT_TOKEN from Render. Input will be hidden.'
$inputSecret = Read-Host 'Management token' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($inputSecret)
try {
    $secretText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    if ($secretText.Length -lt 32) { throw 'Management token must be at least 32 characters.' }

    if (-not (Test-Path -LiteralPath $secretPath)) {
        New-Item -ItemType File -Path $secretPath -Force | Out-Null
    }
    # Remove inherited access BEFORE writing the secret.
    $acl = New-Object System.Security.AccessControl.FileSecurity
    $acl.SetAccessRuleProtection($true, $false)
    $system = New-Object System.Security.Principal.NTAccount('NT AUTHORITY', 'SYSTEM')
    $admins = New-Object System.Security.Principal.NTAccount('BUILTIN', 'Administrators')
    $read = New-Object System.Security.AccessControl.FileSystemAccessRule($system, 'Read', 'Allow')
    $full = New-Object System.Security.AccessControl.FileSystemAccessRule($admins, 'FullControl', 'Allow')
    $acl.AddAccessRule($read)
    $acl.AddAccessRule($full)
    Set-Acl -LiteralPath $secretPath -AclObject $acl
    [System.IO.File]::WriteAllText($secretPath, $secretText, [System.Text.Encoding]::ASCII)
} finally {
    if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    $secretText = $null
}

$action = New-ScheduledTaskAction -Execute 'PowerShell.exe' -Argument (
    '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $AgentPath + '"'
)
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Outbound-only owner management heartbeat and allowlisted task enable/start' -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Installed and started: $TaskName" -ForegroundColor Green
Write-Host 'No game-server restart was requested. Verify the owner management page heartbeat.'
