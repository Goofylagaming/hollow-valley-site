# Hollow Valley Windows server scripts

## HollowValley-AutoRestart.ps1

Production scheduled restart script for the existing **Hollow Valley 12 Hour Restart** Windows Scheduled Task.

The task should continue to start this script at **11:51 AM and 11:51 PM Australia/Brisbane** so the in-game 10-minute warning completes before the **12:01 PM / 12:01 AM** restart.

Install the file as:

`C:\HollowValley\Scripts\HollowValley-AutoRestart.ps1`

The script:

1. sends the RCON announcement `Server is restarting in 10 minutes, please find a safe place whilst the restart takes place.`;
2. waits 590 seconds;
3. sends the authenticated RCON save command;
4. aborts the restart if the save command cannot be sent;
5. waits 10 seconds and stops only `TheIsleServer-Win64-Shipping`;
6. waits for the existing Hollow Valley watchdog to create a new game-server PID;
7. waits until RCON authentication succeeds on the new process;
8. records the run as `SUCCESS` or `FAILURE` locally and, when bridge credentials are available, in the Hollow Valley automation service.

The script deliberately does **not** launch `StartHollowValley.bat`; the existing watchdog owns relaunching the server and this avoids duplicate game processes.

### Credentials

RCON password defaults to:

`C:\HollowValley\Secrets\rcon-password.txt`

Restart telemetry reuses the already-authenticated BinaryLane CommandBridge channel. It looks for its token in this order:

- `BINARYLANE_COMMAND_TOKEN` environment variable;
- `HOLLOW_VALLEY_COMMAND_TOKEN` environment variable;
- `C:\HollowValley\Secrets\binarylane-command-token.txt`;
- `C:\HollowValley\Secrets\command-bridge-token.txt`.

Secret files may be plaintext or the existing Administrator/DPAPI SecureString format. Do not commit any secret file or token.

If telemetry credentials are unavailable, the restart still proceeds safely and writes local evidence to:

`C:\HollowValley\Logs\scheduled-restart.log`

The Admin Hub only shows remote restart evidence after the telemetry event reaches the automation service.


## Informational RCON announcements

Files:

- **HollowValley-RconAnnouncements.ps1** - one-shot announcement sender. Uses the localhost RCON service on port 8888 and the existing password file. It only sends opcode 0x10 (server-wide **announcement**); it cannot write into ordinary local/species player chat.
- **Install-HollowValley-RconAnnouncements.ps1** - controlled one-time task installer on BinaryLane. Must run from elevated PowerShell.

Schedule (Windows **server-local** time, same clock as the existing restart task):

| Task | Local trigger times | Actual message |
| --- | --- | --- |
| Hollow Valley RCON Links | 00:15, 01:45, 03:15, and every 90 minutes through 22:45 | Website + Discord every 90 minutes |
| Hollow Valley RCON Tips | 00:55, 03:55, and every 3 hours through 21:55 | Rotates Dino School, Saturday events, and feature list |
| Hollow Valley 12 Hour Restart | Existing 11:51 and 23:51 | Requested 10-minute safety warning; existing save and watchdog behavior stays unchanged |

All RCON messages are plain text (no Markdown), at most 240 UTF-8 bytes, and recorded in C:\HollowValley\Logs\rcon-announcements.log. A per-message-type 15-minute cooldown plus a Windows mutex reduce duplicate messages. The scripts do **not** change Game.ini, the watchdog, save cadence, or RCON access settings.

### Safe installation on the Windows game server

1. Review and merge the feature PR. Repository files do **not** automatically update scripts on BinaryLane.
2. Run the following in an elevated PowerShell window on BinaryLane. The existing restart file is **not downloaded or replaced**; only its current warning sentence is replaced in place, after backing it up and checking PowerShell syntax.

~~~powershell
$root = 'https://raw.githubusercontent.com/Goofylagaming/hollow-valley-site/master/scripts/windows'
$target = 'C:\HollowValley\Scripts'
New-Item -ItemType Directory -Force -Path $target | Out-Null
Invoke-WebRequest "$root/HollowValley-RconAnnouncements.ps1" -OutFile "$target\HollowValley-RconAnnouncements.ps1"
Invoke-WebRequest "$root/Install-HollowValley-RconAnnouncements.ps1" -OutFile "$target\Install-HollowValley-RconAnnouncements.ps1"
& "$target\Install-HollowValley-RconAnnouncements.ps1"
~~~

The installer refuses to overwrite existing announcement tasks or an unrecognised restart warning. It never restarts The Isle. Its tasks run as SYSTEM: confirm that SYSTEM can read and decrypt C:\HollowValley\Secrets\rcon-password.txt (a DPAPI secret stored under an unrelated account will fail). The current RCON implementation only confirms that an authenticated announcement packet was sent; verify message visibility with a connected player.

### Preview and verification

~~~powershell
& 'C:\HollowValley\Scripts\HollowValley-RconAnnouncements.ps1' -Mode Links -Preview
& 'C:\HollowValley\Scripts\HollowValley-RconAnnouncements.ps1' -Mode Tips -Preview
Get-ScheduledTask -TaskName 'Hollow Valley RCON Links', 'Hollow Valley RCON Tips'
Get-Content 'C:\HollowValley\Logs\rcon-announcements.log' -Tail 20
~~~

To send one real test broadcast deliberately (with a player online), omit -Preview on the Links invocation. Do not use the experimental local-chat injection path on production without a staging test. To disable recurring messages without affecting any other Hollow Valley tasks:

~~~powershell
Disable-ScheduledTask -TaskName 'Hollow Valley RCON Links', 'Hollow Valley RCON Tips'
~~~
