# Hollow Valley Windows server scripts

## HollowValley-AutoRestart.ps1

Production scheduled restart script for the existing **Hollow Valley 12 Hour Restart** Windows Scheduled Task.

The task should continue to start this script at **11:51 AM and 11:51 PM Australia/Brisbane** so the in-game 10-minute warning completes before the **12:01 PM / 12:01 AM** restart.

Install the file as:

`C:\HollowValley\Scripts\HollowValley-AutoRestart.ps1`

The script:

1. sends the RCON announcement `Game is restarting in 10 minutes`;
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

## Deliver-HollowValleyNotices.ps1

Polls CommandBridge `results.ndjson` for `"verb":"prime_request"` and writes EventAI zone / `!prime` toasts. It does not replace `Send-HollowValleyPresence.ps1`. Nothing in this repository registers the task or copies the file to the VPS. Do that only after the automation change is reviewed and the notice endpoint is deployed.

Copy to:

`C:\HollowValley\Scripts\Deliver-HollowValleyNotices.ps1`

The script is a loop every 5 seconds. `-Once` runs a single pass for a repeating task. `-DryRun` and `-WhatIf` print the prime requests that would be posted and do not contact automation, write the inbox, or move the saved tail offset.

Defaults:

- results: `C:\HollowValley\TheIsleServer\TheIsle\Binaries\Win64\ue4ss\Mods\CommandBridge\Saved\results.ndjson`
- inbox: `C:\HollowValley\TheIsleServer\TheIsle\Binaries\Win64\ue4ss\Mods\EventAI\Saved\inbox.ndjson`
- state: `C:\HollowValley\State\notices-tail.json`
- token: `C:\HollowValley\Secrets\presence-feed-token.txt` (`-TokenPath`; plaintext or DPAPI SecureString; never logged)
- service: `https://hollow-valley-automation.onrender.com`
- log: `C:\HollowValley\Logs\notices-YYYYMMDD.log`

The first time the results file is seen, the tail starts at the current end so old lines are not replayed. If the file later shrinks, the offset resets to the start of the new file. Each pass still posts, even with no new prime lines, so zone notices are collected. Prime requests are posted 20 at a time, matching the number of notices one response can return. The saved tail moves only after every batch in that pass succeeds, so a large backlog cannot stall zone toasts or drop replies. Inbox lines are appended one at a time, UTF-8 without a BOM, and the file is not held open.

`!prime` lines with `"ok": false` are ignored. Steam IDs must be 17 digits.

Ready-to-paste registration. Run this on the VPS in an elevated PowerShell 5.1 window after the script is copied. It is not run by the repo:

```powershell
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\HollowValley\Scripts\Deliver-HollowValleyNotices.ps1'
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName 'Hollow Valley Notice Delivery' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
```

The task runs as SYSTEM at startup and restarts after a failure. The script loops, so the execution time limit is unlimited. Stop the task to roll back delivery. The automation flags are independent: `PLAYER_MILESTONES_EVENTAI_NOTIFY=false` stops zone toasts, and `PRIME_CHAT_NOTIFY_ENABLED=false` stops `!prime` replies.
