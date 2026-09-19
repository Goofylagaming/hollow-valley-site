const { api, escapeHtml } = window.HDS;

let currentStatus = null;
let reconcileAttempted = false;

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

async function loadStatus() {
  const me = await window.HDS.loadMe();
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
        statusEl.innerHTML = `<div class="summary-tile"><small>CURRENT TIER</small><b>Checking Stripe Sandbox…</b></div>`;
        try {
          const recovered = await api("/api/supporter/reconcile", { method: "POST" });
          if (recovered?.recovered) {
            document.getElementById("checkout-message").textContent =
              "Recovered your existing Stripe Sandbox membership after the database move.";
            return loadStatus();
          }
        } catch (err) {
          console.error("Sandbox membership recovery failed", err);
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
      <div class="summary-tile"><small>STRIPE STATUS</small><b>${escapeHtml(state)}</b></div>
      <div class="summary-tile"><small>AUTO-RENEW</small><b>${renewText}</b></div>
      <div class="summary-tile"><small>BENEFITS</small><b>${status.entitled ? "Membership verified" : "Inactive / pending"}</b></div>
      ${managementButton}
    `;

    document.getElementById("cancel-supporter")?.addEventListener("click", async () => {
      if (!confirm("Cancel this Stripe Sandbox membership at the end of the current billing period?")) return;
      const button = document.getElementById("cancel-supporter");
      button.disabled = true;
      button.textContent = "Updating…";
      try {
        await api("/api/supporter/cancel", { method: "POST" });
        document.getElementById("checkout-message").textContent =
          "Cancellation scheduled in Stripe Sandbox. Your membership stays active until the billing period ends.";
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
          "Auto-renew has been restored in Stripe Sandbox.";
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

async function loadTiers(status = currentStatus) {
  const grid = document.getElementById("tier-grid");
  const { tiers, checkoutConfigured } = await api("/api/supporter/tiers");
  const managing = activeManagedSubscription(status);

  grid.innerHTML = Object.entries(tiers)
    .map(([key, tier]) => {
      const isCurrent = managing && status?.tier === key;
      let label;
      let action;
      let disabled = false;

      if (!checkoutConfigured) {
        label = "Checkout not yet available";
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
        <p class="price">A$${tier.priceAud.toFixed(2)} / month</p>
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
      if (!me.loggedIn) return alert("Sign in with Steam first.");

      const tier = btn.dataset.tier;
      const tierLabel = tiers[tier]?.label || tier;
      const action = btn.dataset.action;

      if (action === "change") {
        const confirmed = confirm(
          `Change your Stripe Sandbox membership to ${tierLabel}? Stripe may create a prorated test adjustment. No real money is charged.`
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
            `Stripe Sandbox is changing your membership to ${tierLabel}. The status will update automatically.`;
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
}

loadPage().catch(() => {
  document.getElementById("tier-grid").textContent =
    "Unable to load memberships. Please refresh to try again.";
});

const checkoutState = new URLSearchParams(window.location.search).get("checkout");
if (checkoutState === "success" || checkoutState === "cancelled") {
  document.getElementById("checkout-message").textContent = checkoutState === "success"
    ? "Payment completed in Stripe Sandbox. Membership status will sync automatically; refresh in a few seconds if it still shows pending."
    : "Checkout cancelled. No membership was activated.";
  if (checkoutState === "success") queueStatusRefresh();
}
