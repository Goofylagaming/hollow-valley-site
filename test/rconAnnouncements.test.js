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
