# Hollow Valley Update Log — 22 September 2026

## Roadmap continuation

### Completed
- Cleaned the roadmap queue by closing superseded PRs #55 and #56.
  - Discord scheduled-event sync is now represented by merged PR #66 using the safer HerbyBot → automation → website bridge.
  - Supporter Discord link / role-sync status is now represented by merged PR #62.
- Added and merged PR #67: guarded 76% Triceratops recovery preset in Admin Restore.
  - Loads the known Triceratops class path at 76% growth.
  - Includes recovery values for health, stamina, hunger and thirst.
  - Enables Prime eligibility and full normal nutrients in the preset.
  - Only fills the admin builder; it does not upload, overwrite or auto-redeem.
  - Existing admin authorization, validation, no-overwrite protection and ADMIN_RESTORE_WRITE_ENABLED safety gate remain unchanged.
- Website regression workflow passed before PR #67 was merged.
- Added and merged PR #68: generic Admin Restore recovery builder.
  - Builds guarded restore JSON from dinosaur class path and growth percentage.
  - Optional Prime eligibility, full health/stamina/hunger/thirst recovery, and full nutrients.
  - Keeps server-side validation and all existing write protections.
- Added and merged PR #69: validation-lock safety hardening for Admin Restore.
  - Upload remains locked until the exact JSON, nutrient setting, and slot pass validation.
  - Any edit after validation immediately locks Upload again.
  - Successful upload requires revalidation before another upload attempt.
- Website regression workflow passed for PRs #68 and #69 before merge.
- Added and merged PR #70: external server skin-code import.
  - Auto-detects current Fangs & Ferns seven-zone HEX share codes.
  - Parses Dino Den-style JSON customizer codes, including pattern/variation/theme when supplied.
  - Loads compatible values into Hollow Valley Skin Studio for review before saving.
  - Requires an explicit target species rather than guessing cross-server species mappings.
  - Preserves Hollow Valley values for fields a foreign format does not carry, such as teeth, mouth or claws.
  - Native Hollow Valley share-code import remains unchanged.
- Website Automation Regression Tests and Validate Skin Studio both passed before PR #70 was merged.
- Added and merged PR #71: admin External Skin Library.
  - Batch-imports up to 50 supported external skin codes at once.
  - Supports multiple Fangs & Ferns lines plus Dino Den-style JSON arrays or separated JSON blocks.
  - Provides queued previews with colour swatches and pattern/theme/variation values before saving.
  - Lets admins rename every queued draft before import.
  - Saves through the existing unpublished Skin Studio preset path; nothing is published automatically.
  - Keeps source metadata attached to imported skins so they remain visible in the external catalogue after publishing.
  - Adds a dedicated External Library tab with refresh, catalogue cards, Open in Studio, and Publish controls.
  - Stops safely on partial batch failures and leaves unsaved queue items in place.
- Website Automation Regression Tests and Validate Skin Studio both passed before PR #71 was merged.

### Current roadmap baseline
- Website and automation deployment source is unified on master.
- Wallet and Quests remain separate pages.
- Duplicate Body Drop UI remains removed from My Dinos.
- Skin Studio remains admin-only while live testing continues.
- Discord scheduled events use the HerbyBot automation bridge rather than direct website bot-token access.
- Live Map supports verified offline/history context without presenting stale coordinates as live.
- Playtime leaderboard uses verified presence data.
- Combat ingestion groundwork is present but remains disabled until an authoritative feed is available.
- Supporter/account linking, role-sync state, and official reward multipliers are integrated.
- Event rewards and other write-sensitive features remain behind explicit safety gates where configured.

### Next
- Continue Admin Restore live workflow testing and expand recovery presets only after class paths are verified.
- Continue Skin Studio live-test hardening, including real-world external-code samples as they are collected.
- Continue combat/stat feed integration once an authoritative server feed is available.
- Continue dashboard and admin UX cleanup.
- Continue hosting-migration readiness work independently of the current Isle server being online.

- Added and merged PR #72: Admin **Deploy Server Mods** control.
  - Added to Admin → Operations with live version inspection.
  - Uses the automation service's existing VeryGames FTP connection; browser never receives FTP credentials.
  - Approved deployment list currently contains SkinStudio v002 and CommandBridge v006.1 only.
  - Installs SkinStudio before CommandBridge so a partial failure cannot activate a bridge route with no skin handler.
  - Creates missing UE4SS mod/Scripts folders and safe enabled.txt markers without editing shared mods.txt.
  - Stages and byte-verifies uploads, timestamp-backs up replaced main.lua files, and rolls back failed replacements.
  - Never writes to mod Saved/ folders.
  - Requires admin authentication, automation admin token, exact deployment confirmation, and SERVER_MOD_DEPLOY_ENABLED=true.
  - Automation Platform Tests, Website Automation Regression Tests, Validate Skin Studio, and Membership Tests all passed before merge.
