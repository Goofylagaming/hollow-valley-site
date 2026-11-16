const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}
const sender = read('scripts/windows/HollowValley-RconAnnouncements.ps1');
const installer = read('scripts/windows/Install-HollowValley-RconAnnouncements.ps1');
const restart = read('scripts/windows/HollowValley-AutoRestart.ps1');

test('announcements contain the requested links, calendar and feature details', () => {
  for (const text of [
    'hollowvalleyisle.com',
    'https://discord.gg/hollowvalley',
    '4pm onwards on Fridays',
    '7pm every Saturday',
    'Parking',
    'Live Map with Prime Tracker',
    'Custom Skin Creation',
    'Marketplace',
    'Body Drops',
    'Daily Rewards',
    'Achievements & Quests',
  ]) {
    assert.ok(sender.includes(text), 'Missing requested content: ' + text);
  }
});

test('the sender uses announced RCON packets and cannot manipulate game state', () => {
  assert.match(sender, /0x01/);
  assert.match(sender, /Password Accepted/);
  assert.match(sender, /ConnectAsync/);
  assert.doesNotMatch(sender, /\$client\.EndConnect\(/);
  assert.match(sender, /0x02,\s*\[byte\]0x10/);
  assert.match(sender, /240 UTF-8 bytes/);
  assert.match(sender, /\[switch\]\$Preview/);
  assert.match(sender, /Global\\HollowValleyRconAnnouncements/);
  assert.match(sender, /TotalMinutes -lt 15/);
  assert.doesNotMatch(sender, /Stop-Process|Restart-Computer|toggleglobalchat|0x50/);
});

test('installer creates only two timed announcement tasks, preserves restart logic', () => {
  assert.match(installer, /15 \+ \(90 \* \$_\)/);
  assert.match(installer, /55 \+ \(180 \* \$_\)/);
  assert.match(installer, /New-ScheduledTaskTrigger -Daily/);
  assert.match(installer, /Copy-Item -LiteralPath \$RestartScriptPath -Destination \$backup/);
  assert.match(installer, /Assert-PowershellParses/);
  assert.match(installer, /SYSTEM/);
  assert.doesNotMatch(installer, /Stop-Process|Restart-Computer|Stop-ScheduledTask/);
});

test('scheduled restart warning is updated without changing save/restart flow', () => {
  const warning = 'Server is restarting in 10 minutes, please find a safe place whilst the restart takes place.';
  assert.ok(restart.includes(warning));
  assert.ok(installer.includes(warning));
  assert.match(restart, /Send-RconCommand -Code \(\[byte\]0x50\)/);
  assert.match(restart, /Stop-Process -Force/);
  assert.match(restart, /Test-RconReady/);
});

test('in-place BinaryLane restart patch is fail-closed, two-save safe, and preview-first', () => {
  const patch = read('scripts/windows/Enable-HollowValley-ExtraRestartWarnings.ps1');
  assert.match(patch, /\[switch\]\$Apply/);
  assert.match(patch, /500-second countdown/);
  assert.match(patch, /Start-Sleep -Seconds 295/);
  assert.match(patch, /Start-Sleep -Seconds 205/);
  assert.match(patch, /Start-Sleep -Seconds 60/);
  assert.match(patch, /Sending 5-minute restart warning/);
  assert.match(patch, /Sending 1-minute restart warning/);
  assert.match(patch, /after.*two verified saves succeed/);
  assert.match(patch, /Assert-PowerShellSyntax -Source \$revised/);
  assert.match(patch, /Copy-Item -LiteralPath \$RestartScriptPath -Destination \$backup/);
  assert.match(patch, /\[System\.IO\.File\]::Replace/);
  assert.match(patch, /\$atomicBackup = /);
  assert.match(patch, /\[System\.IO\.File\]::Replace\(\$temp, \$RestartScriptPath, \$atomicBackup\)/);
  assert.doesNotMatch(patch, /\[System\.IO\.File\]::Replace\(\$temp, \$RestartScriptPath, \$null\)/);
  assert.match(patch, /Both 5-minute and 1-minute warning blocks are already installed/);
  assert.doesNotMatch(patch, /Stop-Process|StartHollowValley\.bat|Restart-Computer/);
});
