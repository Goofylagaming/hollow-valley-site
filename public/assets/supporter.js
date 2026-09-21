const { api, escapeHtml } = window.HDS;

let currentStatus = null;
let currentMe = { loggedIn: false, user: null };
let reconcileAttempted = false;
let discordSyncAttemptedKey = null;
let discordSyncState = null;

function activeManagedSubscription(status) {
  return Boolean(
    status?.managed &&
    !["canceled", "incomplete_expired"].includes(status.stripe_status)
  );
}

function queueStatusRefresh() {
  setTimeout(loadPage, 1200);
  setTimeout(loadPage, 3500);
}

function renderAccountStatus(me = currentMe, syncState = discordSyncState) {
  const host = document.getElementById("supporter-account-status");
  if (!host) return;

  if (!me?.loggedIn || !me?.user) {
    host.innerHTML = `
      <div class="summary-tile"><small>STEAM ACCOUNT</small><b>Not signed in</b><span>Steam is required for supporter rewards.</span></div>
      <div class="summary-tile"><small>DISCORD ACCOUNT</small><b>Not linked</b><span>Discord linking enables automatic supporter roles.</span></div>
    `;
    return;
  }

  const steamLinked = Boolean(me.user.steam_id);
  const discordLinked = Boolean(me.user.discord_id);

  let roleLabel = "Waiting for Discord";
  let roleDetail = "Link Discord to sync supporter roles.";
  if (discordLinked && syncState?.error) {
    roleLabel = "Sync unavailable";
    roleDetail = syncState.error;
  } else if (discordLinked && syncState?.configured === false) {
    roleLabel = "Not configured";
    roleDetail = "Discord role automation is not configured.";
  } else if (discordLinked && syncState?.linked) {
    roleLabel = syncState.roleName || "No supporter role";
    roleDetail = syncState.changed ? "Role updated from your current membership." : "Discord role is already in sync.";
  } else if (discordLinked) {
    roleLabel = "Checking…";
    roleDetail = "Checking supporter role sync.";
  }

  const steamAction = steamLinked
    ? '<span>Rewards are attached to this Steam-linked account.</span>'
    : '<a class="small-button" href="/auth/steam?returnTo=/supporter">Link Steam</a>';
  const discordAction = discordLinked
    ? '<span>Discord identity is linked to this portal account.</span>'
    : me.discordLoginConfigured
      ? '<a class="small-button" href="/auth/discord">Link Discord</a>'
      : '<span>Discord linking is not configured.</span>';

  host.innerHTML = `
    <div class="summary-tile"><small>STEAM ACCOUNT</small><b>${steamLinked ? "Linked" : "Required"}</b>${steamAction}</div>
    <div class="summary-tile"><small>DISCORD ACCOUNT</small><b>${discordLinked ? "Linked" : "Not linked"}</b>${discordAction}</div>
    <div class="summary-tile"><small>DISCORD SUPPORTER ROLE</small><b>${escapeHtml(roleLabel)}</b><span>${escapeHtml(roleDetail)}</span></div>
  `;
}

async function loadStatus() {
  const me = await window.HDS.loadMe();
  currentMe = me;
  renderAccountStatus(me, discordSyncState);
  const statusEl = document.getElementById("supporter-status");

  if (!me.loggedIn) {
    currentStatus = null;
    statusEl.innerHTML = `<div class="summary-tile"><small>STATUS</small><b>Log in to see your membership status</b></div>`;
    return null;
  }

  try {
    const status = await api("/api/supporter");
    currentStatus = status;

    if (!status?.tier) {
      if (!reconcileAttempted) {
        reconcileAttempted = true;
        statusEl.innerHTML = `<div class="summary-tile"><small>CURRENT TIER</small><b>Checking membership…</b></div>`;
        try {
          const recovered = await api("/api/supporter/reconcile", { method: "POST" });
          if (recovered?.recovered) {
            document.getElementById("checkout-message").textContent =
              "Recovered your existing membership.";
            return loadStatus();
          }
        } catch (err) {
          console.error("Membership recovery failed", err);
        }
      }
      statusEl.innerHTML = `<div class="summary-tile"><small>CURRENT TIER</small><b>None</b></div>`;
      return null;
    }

    const state = status.stripe_status || "pending";
    const renewText = status.auto_renew ? "On" : "Off";
    const managementButton = status.managed
      ? status.auto_renew
        ? `<div class="summary-tile"><button class="small-button" id="cancel-supporter">Cancel at renewal</button></div>`
        : activeManagedSubscription(status)
          ? `<div class="summary-tile"><button class="small-button" id="resume-supporter">Keep membership</button></div>`
          : ""
      : "";

    statusEl.innerHTML = `
      <div class="summary-tile"><small>CURRENT TIER</small><b>${escapeHtml(status.tierLabel || status.tier)}</b></div>
      <div class="summary-tile"><small>REWARD MULTIPLIER</small><b>×${Number(status.multiplier || 1)}</b></div>
      <div class="summary-tile"><small>STRIPE STATUS</small><b>${escapeHtml(state)}</b></div>
      <div class="summary-tile"><small>AUTO-RENEW</small><b>${renewText}</b></div>
      <div class="summary-tile"><small>BENEFITS</small><b>${status.entitled ? "Active on eligible rewards" : "Inactive / pending"}</b></div>
      ${managementButton}
    `;

    document.getElementById("cancel-supporter")?.addEventListener("click", async () => {
      if (!confirm("Cancel this membership at the end of the current billing period?")) return;
      const button = document.getElementById("cancel-supporter");
      button.disabled = true;
      button.textContent = "Updating…";
      try {
        await api("/api/supporter/cancel", { method: "POST" });
        document.getElementById("checkout-message").textContent =
          "Cancellation scheduled. Your membership stays active until the billing period ends.";
        queueStatusRefresh();
      } catch (err) {
        alert(err.message);
        button.disabled = false;
        button.textContent = "Cancel at renewal";
      }
    });

    document.getElementById("resume-supporter")?.addEventListener("click", async () => {
      const button = document.getElementById("resume-supporter");
      button.disabled = true;
      button.textContent = "Updating…";
      try {
        await api("/api/supporter/resume", { method: "POST" });
        document.getElementById("checkout-message").textContent =
          "Auto-renew has been restored.";
        queueStatusRefresh();
      } catch (err) {
        alert(err.message);
        button.disabled = false;
        button.textContent = "Keep membership";
      }
    });

    return status;
  } catch (err) {
    console.error("Failed to load supporter status", err);
    return null;
  }
}

async function syncDiscordAccount(status = currentStatus) {
  if (!currentMe?.loggedIn || !currentMe?.user) {
    discordSyncState = null;
    renderAccountStatus(currentMe, discordSyncState);
    return;
  }

  if (!currentMe.user.discord_id) {
    discordSyncState = {
      configured: Boolean(currentMe.discordLoginConfigured),
      linked: false,
      changed: false,
    };
    renderAccountStatus(currentMe, discordSyncState);
    return;
  }

  const key = `${status?.tier || "none"}:${status?.stripe_status || "none"}:discord-linked`;
  if (discordSyncAttemptedKey === key && discordSyncState) {
    renderAccountStatus(currentMe, discordSyncState);
    return;
  }

  discordSyncAttemptedKey = key;
  discordSyncState = null;
  renderAccountStatus(currentMe, discordSyncState);

  try {
    discordSyncState = await api("/api/supporter/sync-discord", { method: "POST" });
  } catch (err) {
    console.warn("Discord membership role sync failed", err);
    discordSyncState = { error: err.message || "Discord role sync failed." };
  }
  renderAccountStatus(currentMe, discordSyncState);
}

async function loadTiers(status = currentStatus) {
  const grid = document.getElementById("tier-grid");
  const { tiers, checkoutConfigured } = await api("/api/supporter/tiers");
  const managing = activeManagedSubscription(status);
  const steamLinked = Boolean(currentMe?.user?.steam_id);

  grid.innerHTML = Object.entries(tiers)
    .map(([key, tier]) => {
      const isCurrent = managing && status?.tier === key;
      let label;
      let action;
      let disabled = false;

      if (!checkoutConfigured) {
        label = "Checkout not yet available";
        disabled = true;
      } else if (!steamLinked) {
        label = "Link Steam first";
        disabled = true;
      } else if (isCurrent) {
        label = status.auto_renew ? "Current membership" : "Current until renewal";
        disabled = true;
      } else if (managing) {
        label = `Change to ${tier.label}`;
        action = "change";
      } else {
        label = `Join ${tier.label}`;
        action = "checkout";
      }

      return `<div class="tier-card">
        <h3>${escapeHtml(tier.label)}</h3>
        <p class="price">A${tier.priceAud.toFixed(2)} / month</p>
        <p class="section-intro">×${Number(tier.multiplier || 1)} on eligible Valley Coin rewards</p>
        <button
          class="small-button"
          data-tier="${key}"
          data-action="${action || ""}"
          ${disabled ? "disabled" : ""}
        >${escapeHtml(label)}</button>
      </div>`;
    })
    .join("");

  grid.querySelectorAll("button[data-tier]:not([disabled])").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const me = await window.HDS.loadMe();
      currentMe = me;
      if (!me.loggedIn || !me.user?.steam_id) return alert("Link your Steam account before starting or changing a membership.");

      const tier = btn.dataset.tier;
      const tierLabel = tiers[tier]?.label || tier;
      const action = btn.dataset.action;

      if (action === "change") {
        const confirmed = confirm(
          `Change your membership to ${tierLabel}? Stripe may create a prorated adjustment.`
        );
        if (!confirmed) return;
      }

      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = action === "change" ? "Changing…" : "Opening checkout…";

      try {
        if (action === "change") {
          await api(`/api/supporter/${tier}/change`, { method: "POST" });
          document.getElementById("checkout-message").textContent =
            `Stripe is changing your membership to ${tierLabel}. The status will update automatically.`;
          queueStatusRefresh();
        } else {
          const result = await api(`/api/supporter/${tier}/checkout`, { method: "POST" });
          if (result.url) window.location.href = result.url;
        }
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
        btn.textContent = original;
      }
    })
  );
}

async function loadPage() {
  const status = await loadStatus();
  await loadTiers(status);
  await syncDiscordAccount(status);
}

loadPage().catch(() => {
  document.getElementById("tier-grid").textContent =
    "Unable to load memberships. Please refresh to try again.";
});

const checkoutState = new URLSearchParams(window.location.search).get("checkout");
if (checkoutState === "success" || checkoutState === "cancelled") {
  document.getElementById("checkout-message").textContent = checkoutState === "success"
    ? "Payment completed. Membership status will sync automatically; refresh in a few seconds if it still shows pending."
    : "Checkout cancelled. No membership was activated.";
  if (checkoutState === "success") queueStatusRefresh();
}
