const { api, escapeHtml } = window.HDS;

async function loadStatus() {
  const me = await window.HDS.loadMe();
  const statusEl = document.getElementById("supporter-status");
  if (!me.loggedIn) {
    statusEl.innerHTML = `<div class="summary-tile"><small>STATUS</small><b>Log in to see your membership status</b></div>`;
    return;
  }
  try {
    const status = await api("/api/supporter");
    if (!status?.tier) {
      statusEl.innerHTML = `<div class="summary-tile"><small>CURRENT TIER</small><b>None</b></div>`;
      return;
    }

    const state = status.stripe_status || "pending";
    statusEl.innerHTML = `
      <div class="summary-tile"><small>CURRENT TIER</small><b>${escapeHtml(status.tierLabel || status.tier)}</b></div>
      <div class="summary-tile"><small>STRIPE STATUS</small><b>${escapeHtml(state)}</b></div>
      <div class="summary-tile"><small>AUTO-RENEW</small><b>${status.auto_renew ? "On" : "Off"}</b></div>
      <div class="summary-tile"><small>BENEFITS</small><b>${status.entitled ? "Membership verified" : "Inactive / pending"}</b></div>
    `;
  } catch (err) {
    console.error("Failed to load supporter status", err);
  }
}

async function loadTiers() {
  const grid = document.getElementById("tier-grid");
  const { tiers, checkoutConfigured } = await api("/api/supporter/tiers");
  grid.innerHTML = Object.entries(tiers)
    .map(
      ([key, tier]) => `<div class="tier-card">
        <h3>${escapeHtml(tier.label)}</h3>
        <p class="price">A$${tier.priceAud.toFixed(2)} / month</p>
        <button class="small-button" data-tier="${key}" ${checkoutConfigured ? "" : "disabled"}>${checkoutConfigured ? `Join ${escapeHtml(tier.label)}` : "Checkout not yet available"}</button>
      </div>`
    )
    .join("");

  grid.querySelectorAll("button[data-tier]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const me = await window.HDS.loadMe();
      if (!me.loggedIn) return alert("Sign in with Steam first.");
      btn.disabled = true;
      try {
        const result = await api(`/api/supporter/${btn.dataset.tier}/checkout`, { method: "POST" });
        if (result.url) window.location.href = result.url;
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    })
  );
}

loadStatus();
loadTiers().catch(() => {
  document.getElementById("tier-grid").textContent = "Unable to load memberships. Please refresh to try again.";
});

const checkoutState = new URLSearchParams(window.location.search).get("checkout");
if (checkoutState === "success" || checkoutState === "cancelled") {
  document.getElementById("checkout-message").textContent = checkoutState === "success"
    ? "Payment completed in Stripe Sandbox. Membership status will sync automatically; refresh in a few seconds if it still shows pending."
    : "Checkout cancelled. No membership was activated.";
  if (checkoutState === "success") {
    setTimeout(loadStatus, 1500);
    setTimeout(loadStatus, 4000);
  }
}
