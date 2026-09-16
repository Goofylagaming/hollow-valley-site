const { api, escapeHtml } = window.HDS;

let speciesById = {};
let mySkinsBySpecies = {};

async function loadSpeciesMap() {
  const list = await api("/api/species");
  speciesById = Object.fromEntries(list.map((s) => [s.id, s]));
}

async function loadMySkins() {
  const skins = await api("/api/skins/mine");
  mySkinsBySpecies = {};
  skins.forEach((skin) => {
    (mySkinsBySpecies[skin.species_id] ||= []).push(skin);
  });
}

async function loadActiveCharacter() {
  const container = document.getElementById("active-character-card");
  if (!container) return;

  try {
    const res = await api("/api/mydinos/active-character");
    if (res && res.active && res.character) {
      const char = res.character;
      const growthPct = Math.round((char.growth || 1) * 100);
      container.innerHTML = `
        <div class="active-char-banner">
          <div class="active-char-info">
            <span class="tag-pill active-tag">LIVE IN GAME</span>
            <h3>${escapeHtml(char.species || "Unknown")} (${growthPct}% Growth)${char.isPrime ? " • PRIME" : ""}</h3>
            <small>Playing in-game on Hollow Valley as ${escapeHtml(char.name || "Survivor")}</small>
          </div>
          <button id="park-active-btn" class="primary-button green">Store Current In-Game Dino</button>
        </div>
      `;
      container.hidden = false;

      document.getElementById("park-active-btn")?.addEventListener("click", async () => {
        const btn = document.getElementById("park-active-btn");
        btn.disabled = true;
        btn.textContent = "Sending store command...";
        try {
          const response = await api("/api/mydinos/park-active", { method: "POST" });
          alert(response.message);
          await refresh();
        } catch (err) {
          alert(err.message || "Failed to park active character");
          btn.disabled = false;
          btn.textContent = "Store Current In-Game Dino";
        }
      });
    } else {
      container.innerHTML = "";
      container.hidden = true;
    }
  } catch (err) {
    container.innerHTML = "";
    container.hidden = true;
  }
}

function formatCooldown(seconds) {
  if (seconds === null || seconds === undefined) return "pending";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins <= 0) return `${secs}s`;
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
}

function renderBodyDropStatus(data) {
  const container = document.getElementById("bodydrop-content");
  if (!container) return;

  const status = !data.steamLinked
    ? "Sign in with Steam first"
    : !data.serverOnline
      ? "Server sync offline"
      : data.cooldown?.active
        ? data.cooldown.reason === "pending"
          ? data.latest?.status === "queued"
            ? "Outcome unconfirmed"
            : "Request pending"
          : `Cooldown ${formatCooldown(data.cooldown.remainingSeconds)}`
        : "Available now";

  const disabled = !data.steamLinked || !data.serverOnline || data.cooldown?.active;
  const options = (data.options || [])
    .map((option) => `
      <button class="bodydrop-option" data-drop-type="${escapeHtml(option.id)}" ${disabled ? "disabled" : ""}>
        <strong>${escapeHtml(option.name)}</strong>
        <span>${escapeHtml(option.description)}</span>
      </button>
    `)
    .join("");

  const recent = (data.recent || [])
    .slice(0, 3)
    .map((request) => `<li><b>${escapeHtml(request.drop_type)}</b><span>${escapeHtml(request.status)}</span><small>${escapeHtml(request.created_at)}</small></li>`)
    .join("");

  container.innerHTML = `
    <div class="bodydrop-status ${disabled ? "blocked" : "ready"}">
      <b>${escapeHtml(status)}</b>
      <span>${data.cooldownSeconds ? `Cooldown: ${Math.round(data.cooldownSeconds / 60)} minutes` : "No cooldown"}</span>
    </div>
    <div class="bodydrop-options">${options}</div>
    ${data.latest?.status === "queued" ? `<small class="section-intro">${escapeHtml(data.latest.error || "Outcome unconfirmed. Ask an operator to reconcile the queued command and results before retrying.")}</small>` : ""}
    ${recent ? `<ul class="bodydrop-history">${recent}</ul>` : ""}
  `;

  container.querySelectorAll(".bodydrop-option").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Request this body drop on the live server?")) return;
      button.disabled = true;
      button.querySelector("strong").textContent = "Requesting...";
      try {
        const response = await api("/api/bodydrop", {
          method: "POST",
          body: JSON.stringify({ dropType: button.dataset.dropType }),
        });
        alert(response.result.message);
        await loadBodyDropStatus();
      } catch (err) {
        alert(err.message || "Failed to request body drop");
        await loadBodyDropStatus();
      }
    });
  });
}

async function loadBodyDropStatus() {
  const container = document.getElementById("bodydrop-content");
  if (!container) return;
  try {
    renderBodyDropStatus(await api("/api/bodydrop"));
  } catch (err) {
    container.innerHTML = `<p class="section-intro" style="color:#ef9a8a;">${escapeHtml(err.message || "Body Drop is unavailable right now.")}</p>`;
  }
}

function renderStorage(roster) {
  const grid = document.getElementById("storage-grid");
  document.getElementById("mydinos-count").textContent = `${roster.length} in storage`;
  if (!roster.length) {
    grid.innerHTML = `<div class="empty-roster"><b>◇</b><strong>Website roster is empty</strong><span>DinoStorage slots are stored by the game mod and are not listed here.</span></div>`;
    return;
  }
  grid.innerHTML = roster
    .map((dino) => {
      const species = speciesById[dino.species_id];
      const name = species ? species.name : dino.species_id;
      const skinOptions = (mySkinsBySpecies[dino.species_id] || [])
        .map((skin) => `<option value="${skin.id}" ${dino.skin_id === skin.id ? "selected" : ""}>${escapeHtml(skin.name)}</option>`)
        .join("");
      return `<div class="storage-card" data-id="${dino.id}">
        <span class="tag-pill">${escapeHtml(dino.status)}${dino.is_prime ? " • PRIME" : ""}</span>
        <h3>${escapeHtml(dino.nickname || name)}</h3>
        <small>${escapeHtml(name)} • Size ${dino.size_percent}%</small>
        <div class="stat-row">
          <span>HP ${dino.health}</span><span>Stamina ${dino.stamina}</span><span>Water ${dino.water}</span>
          <span>Food ${dino.food}</span><span>Blood ${dino.blood}</span>
        </div>
        ${skinOptions ? `<div class="form-row"><select class="skin-select" data-id="${dino.id}"><option value="">No skin</option>${skinOptions}</select></div>` : ""}
        <div class="actions">
          <button class="small-button prime-btn" data-id="${dino.id}">${dino.is_prime ? "Unset prime" : "Set prime"}</button>
          <button class="small-button sell-btn" data-id="${dino.id}">Scrap for coin</button>
          <button class="small-button list-btn" data-id="${dino.id}">List for sale</button>
          <button class="small-button gift-btn" data-id="${dino.id}">Gift</button>
        </div>
      </div>`;
    })
    .join("");

  wireCardActions();
}

function wireCardActions() {
  document.querySelectorAll(".prime-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const isCurrentlyPrime = btn.textContent.includes("Unset");
      await runAction(btn.dataset.id, "set-prime", { prime: !isCurrentlyPrime });
    })
  );
  document.querySelectorAll(".sell-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (confirm("Scrap this dino for Valley Coin? This cannot be undone.")) runAction(btn.dataset.id, "sell");
    })
  );
  document.querySelectorAll(".skin-select").forEach((select) =>
    select.addEventListener("change", () => runAction(select.dataset.id, "apply-skin", { skinId: select.value || null }))
  );

  const giftDialog = document.getElementById("gift-dialog");
  document.querySelectorAll(".gift-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      giftDialog.dataset.rosterId = btn.dataset.id;
      giftDialog.showModal();
    })
  );

  const listDialog = document.getElementById("list-dialog");
  document.querySelectorAll(".list-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      listDialog.dataset.rosterId = btn.dataset.id;
      listDialog.showModal();
    })
  );
}

async function runDinoStorageRedeem() {
  try {
    const response = await api("/api/dinostorage/redeem", { method: "POST" });
    alert(response.message);
    await refresh();
  } catch (err) {
    alert(err.message || "DinoStorage redeem failed");
  }
}

async function runDinoStorageStore() {
  try {
    const response = await api("/api/dinostorage/store", { method: "POST" });
    alert(response.message);
    await refresh();
  } catch (err) {
    alert(err.message || "DinoStorage store failed");
  }
}

for (const [id, handler] of [["dinostorage-store", runDinoStorageStore], ["dinostorage-redeem", runDinoStorageRedeem]]) {
  document.getElementById(id)?.addEventListener("click", async (event) => {
    if (!confirm("Use DinoStorage's default slot? Do not retry an unconfirmed request; ask an operator to check its results first.")) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await handler();
    } finally {
      button.disabled = false;
    }
  });
}

async function runAction(id, action, body) {
  try {
    await api(`/api/mydinos/${id}/${action}`, { method: "POST", body: body ? JSON.stringify(body) : undefined });
    await refresh();
  } catch (err) {
    alert(err.message);
  }
}

document.querySelectorAll(".dialog-close").forEach((btn) => btn.addEventListener("click", () => btn.closest("dialog").close()));

document.getElementById("gift-confirm")?.addEventListener("click", async () => {
  const dialog = document.getElementById("gift-dialog");
  const username = document.getElementById("gift-username").value.trim();
  if (!username) return;
  try {
    await api(`/api/mydinos/${dialog.dataset.rosterId}/gift`, {
      method: "POST",
      body: JSON.stringify({ username }),
    });
    dialog.close();
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("list-confirm")?.addEventListener("click", async () => {
  const dialog = document.getElementById("list-dialog");
  const price = Number(document.getElementById("list-price").value);
  if (!price || price <= 0) return alert("Enter a valid price");
  try {
    await api("/api/marketplace/listings", {
      method: "POST",
      body: JSON.stringify({ rosterId: Number(dialog.dataset.rosterId), price }),
    });
    dialog.close();
    await refresh();
    alert("Listed on the marketplace.");
  } catch (err) {
    alert(err.message);
  }
});

async function refresh() {
  await loadActiveCharacter();
  await loadBodyDropStatus();
  const roster = await api("/api/mydinos");
  renderStorage(roster);
}

async function init() {
  const me = await window.HDS.loadMe();
  const guard = document.getElementById("mydinos-guard");
  const content = document.getElementById("mydinos-content");
  if (!me.loggedIn) {
    guard.hidden = false;
    content.hidden = true;
    return;
  }
  guard.hidden = true;
  content.hidden = false;
  await loadSpeciesMap();
  await loadMySkins();
  await refresh();
}

init();