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
