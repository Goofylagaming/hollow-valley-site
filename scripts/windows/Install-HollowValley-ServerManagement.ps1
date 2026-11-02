# One-time operator installation after the website management API is deployed.
# Does not restart The Isle or modify existing scheduled tasks.
[CmdletBinding()]
param(
    # Require an explicit environment; never default the background task to production.
    [Parameter(Mandatory = $true)]
    [ValidateSet(
        'https://hollow-valley-management-staging.onrender.com',
        'https://hollowvalleyisle.com'
    )]
    [string]$SiteUrl,
    [string]$AgentPath = 'C:\HollowValley\Scripts\HollowValley-ServerManagementAgent.ps1',
    [string]$TaskName = 'Hollow Valley Server Management Agent'
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $AgentPath)) {
    throw "First copy the agent to $AgentPath"
}
# Verify the local agent syntax before storing credentials or registering tasks.
$tokens = $null
$parseErrors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile(
    (Resolve-Path -LiteralPath $AgentPath).Path,
    [ref]$tokens,
    [ref]$parseErrors
)
if ($parseErrors.Count -gt 0) {
    throw 'The management agent has PowerShell parse errors. No task was created.'
}
if ((Get-Content -LiteralPath $AgentPath -Raw) -notmatch 'function Invoke-ApprovedTaskAction') {
    throw 'The management agent file does not contain the expected allowlisted action function.'
}
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$currentPrincipal = [Security.Principal.WindowsPrincipal]::new($currentIdentity)
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this installer in an elevated Administrator PowerShell window.'
}

$secretDir = 'C:\HollowValley\Secrets'
$secretPath = Join-Path $secretDir 'management-agent-token.txt'
New-Item -ItemType Directory -Path $secretDir -Force | Out-Null

# Reuse the token that already passed the one-shot staging HTTPS test.
# Never overwrite a working token merely because the scheduled task is installed.
$tokenExists = Test-Path -LiteralPath $secretPath
$newTokenText = $null
if ($tokenExists) {
    $existingToken = (Get-Content -LiteralPath $secretPath -Raw).Trim()
    if ($existingToken.Length -lt 32) {
        throw 'Existing management token file is too short. Resolve it manually before installing.'
    }
    $existingToken = $null
    Write-Host 'Using the existing management-agent-token.txt (token not displayed).'
} else {
    Write-Host 'Enter the dedicated HV_MANAGEMENT_AGENT_TOKEN from staging. Input will be hidden.'
    $inputSecret = Read-Host 'Management token' -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($inputSecret)
    try {
        $newTokenText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
        if ($newTokenText.Length -lt 32) { throw 'Management token must be at least 32 characters.' }
    } finally {
        if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    }
    New-Item -ItemType File -Path $secretPath -Force | Out-Null
}

# Restrict existing/new secret file permissions to SYSTEM and Administrators.
$acl = Get-Acl -LiteralPath $secretPath
$acl.SetAccessRuleProtection($true, $false)
foreach ($rule in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($rule) }
$systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$adminsSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$read = [Security.AccessControl.FileSystemAccessRule]::new($systemSid, 'Read', 'Allow')
$full = [Security.AccessControl.FileSystemAccessRule]::new($adminsSid, 'FullControl', 'Allow')
$acl.AddAccessRule($read)
$acl.AddAccessRule($full)
Set-Acl -LiteralPath $secretPath -AclObject $acl
if (-not $tokenExists) {
    [System.IO.File]::WriteAllText($secretPath, $newTokenText, [System.Text.Encoding]::ASCII)
    $newTokenText = $null
}

# Avoid silently replacing an existing production/staging task configuration.
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    throw "A management task named '$TaskName' already exists. Inspect it before replacing."
}

$action = New-ScheduledTaskAction -Execute 'PowerShell.exe' -Argument (
    '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $AgentPath + '" -SiteUrl "' + $SiteUrl + '"'
)
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Outbound-only owner management heartbeat and allowlisted task enable/start' -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Installed and started: $TaskName" -ForegroundColor Green
Write-Host "Outbound management endpoint: $SiteUrl"
Write-Host 'No game-server restart was requested. Verify the owner management page heartbeat.'
