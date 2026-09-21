const { api, escapeHtml } = window.HDS;

let restoreState = null;

const TRIKE_76_RECOVERY = Object.freeze({
  version: 2,
  slot: "admin_restore_trike_76",
  capturedAt: 0,
  classPath: "/Game/TheIsle/Core/Characters/Dinosaurs/Triceratops/BP_Triceratops.BP_Triceratops_C",
  growth: 0.76,
  health: 99999,
  stamina: 99999,
  thirst: 99999,
  hunger: 99999,
  isPrime: true,
  fullNutrients: true,
});

function setMessage(message, isError = false) {
  const el = document.getElementById("restore-message");
  if (!el) return;
  el.textContent = message || "";
  el.classList.toggle("error", Boolean(isError));
}

function parseRestoreJson() {
  const raw = document.getElementById("restore-json").value.trim();
  if (!raw) throw new Error("Paste or enter the restore JSON first.");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Restore JSON is invalid: ${error.message}`);
  }
}

function renderRestoreJson(value) {
  document.getElementById("restore-json").value = JSON.stringify(value, null, 2);
}

function loadTrikeRecoveryPreset() {
  renderRestoreJson(TRIKE_76_RECOVERY);
  document.getElementById("restore-slot").value = TRIKE_76_RECOVERY.slot;
  document.getElementById("restore-full-nutrients").checked = true;
  setMessage("Loaded the 76% Triceratops recovery preset. Review it, then use Validate & build JSON. Nothing has been uploaded.");
}

function clearRestoreJson() {
  document.getElementById("restore-json").value = "";
  document.getElementById("restore-slot").value = "admin_restore";
  document.getElementById("restore-full-nutrients").checked = false;
  setMessage("Restore builder cleared.");
}

function renderState(result) {
  restoreState = result?.adminRestore || null;
  const state = restoreState || {};
  document.getElementById("restore-builder-state").textContent = state.builderReady ? "Ready" : "Unavailable";
  document.getElementById("restore-write-state").textContent = state.writeEnabled ? "Enabled" : "Locked";
  document.getElementById("restore-ftp-state").textContent = state.ftpConfigured ? "Ready" : "Unavailable";

  const upload = document.getElementById("restore-upload");
  upload.disabled = !(state.builderReady && state.writeEnabled && state.ftpConfigured);

  if (!state.ftpConfigured && state.ftpError) {
    setMessage(state.ftpError, true);
  } else if (!state.writeEnabled) {
    setMessage("Validation is available. Uploads are locked by the automation write gate.");
  } else {
    setMessage("Admin Restore is ready. Validate the JSON before uploading.");
  }
}

async function loadState() {
  const me = await window.HDS.loadMe();
  const guard = document.getElementById("admin-restore-guard");
  const content = document.getElementById("admin-restore-content");

  if (!me.loggedIn || !me.user?.is_admin) {
    guard.hidden = false;
    guard.innerHTML = '<p class="section-intro">Admin access is required.</p>';
    content.hidden = true;
    return;
  }

  guard.hidden = true;
  content.hidden = false;

  try {
    renderState(await api("/api/admin-restore"));
  } catch (error) {
    setMessage(error.message || "Admin Restore is unavailable.", true);
    document.getElementById("restore-builder-state").textContent = "Unavailable";
    document.getElementById("restore-write-state").textContent = "Locked";
    document.getElementById("restore-ftp-state").textContent = "Unavailable";
  }
}

document.getElementById("restore-preset-trike-76")?.addEventListener("click", loadTrikeRecoveryPreset);
document.getElementById("restore-clear")?.addEventListener("click", clearRestoreJson);

document.getElementById("restore-build")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "Validating…";
  try {
    const restore = parseRestoreJson();
    const result = await api("/api/admin-restore/build", {
      method: "POST",
      body: JSON.stringify({
        restore,
        fullNutrients: document.getElementById("restore-full-nutrients").checked,
      }),
    });
    const built = result?.restore;
    if (built?.json) document.getElementById("restore-json").value = built.json;
    setMessage(`Valid restore JSON · slot ${built?.state?.slot || "not set"} · ${built?.fullNutrients ? "full nutrients enabled" : "nutrients unchanged"}.`);
  } catch (error) {
    setMessage(error.message || "Restore validation failed.", true);
  } finally {
    button.disabled = false;
    button.textContent = "Validate & build JSON";
  }
});

document.getElementById("restore-upload")?.addEventListener("click", async (event) => {
  if (!restoreState?.writeEnabled || !restoreState?.ftpConfigured) return;
  const button = event.currentTarget;

  try {
    const steamId = document.getElementById("restore-steam-id").value.trim();
    const slot = document.getElementById("restore-slot").value.trim();
    const restore = parseRestoreJson();

    if (!/^\d{17}$/.test(steamId)) throw new Error("Enter a valid 17-digit Steam ID.");
    if (slot && !/^[A-Za-z0-9_-]{1,80}$/.test(slot)) throw new Error("Slot may contain only letters, numbers, underscores and hyphens.");

    if (!confirm(`Upload this restore to Steam ID ${steamId} in slot "${slot || restore.slot || "unspecified"}"? Existing slots will not be overwritten.`)) {
      return;
    }

    button.disabled = true;
    button.innerHTML = "Uploading…";
    const result = await api("/api/admin-restore/upload", {
      method: "POST",
      body: JSON.stringify({
        steamId,
        slot,
        restore,
        fullNutrients: document.getElementById("restore-full-nutrients").checked,
      }),
    });
    const upload = result?.upload;
    setMessage(`Uploaded ${escapeHtml(upload?.fileName || "restore file")} to guarded DinoStorage. Auto-redeem is disabled.`);
  } catch (error) {
    setMessage(error.message || "Restore upload failed.", true);
  } finally {
    button.disabled = !(restoreState?.writeEnabled && restoreState?.ftpConfigured);
    button.innerHTML = 'Upload restore <b>→</b>';
  }
});

loadState();
