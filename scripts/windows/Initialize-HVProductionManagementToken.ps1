# Generate one separate production management token on BinaryLane.
# Never overwrites the already working staging token.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$tokenFile = 'C:\HollowValley\Secrets\management-agent-production-token.txt'
$directory = Split-Path -Parent $tokenFile

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run in elevated Windows PowerShell.'
}
if (Test-Path -LiteralPath $tokenFile) {
    throw 'Production token file already exists. Refusing to overwrite or rotate it.'
}
New-Item -ItemType Directory -Path $directory -Force | Out-Null

$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$token = ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()

New-Item -ItemType File -Path $tokenFile -Force | Out-Null
try {
    $acl = Get-Acl -LiteralPath $tokenFile
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($rule) }
    $system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $admin = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($system, 'Read', 'Allow'))
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($admin, 'FullControl', 'Allow'))
    Set-Acl -LiteralPath $tokenFile -AclObject $acl

    [System.IO.File]::WriteAllText($tokenFile, $token, [System.Text.Encoding]::ASCII)
    Set-Clipboard -Value $token
    Write-Host 'New production token stored with restricted ACL and copied to clipboard.' -ForegroundColor Green
    Write-Host 'Paste it into the Render PRODUCTION website HV_MANAGEMENT_AGENT_TOKEN secret.'
    Write-Host 'Do not paste it in chat, logs or GitHub. Clear the clipboard after saving Render.'
} catch {
    # The generated token must not be partially left on disk after failure.
    Remove-Item -LiteralPath $tokenFile -Force -ErrorAction SilentlyContinue
    throw
} finally {
    $token = $null
    [Array]::Clear($bytes, 0, $bytes.Length)
}
