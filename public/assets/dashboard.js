const { api, escapeHtml } = window.HDS;

async function loadDashboard() {
  const me = await window.HDS.loadMe();
  const guard = document.getElementById("dashboard-guard");
  const content = document.getElementById("dashboard-content");
  if (!me.loggedIn) {
    guard.hidden = false;
    content.hidden = true;
    return;
  }
  guard.hidden = true;
  content.hidden = false;

  try {
    const summary = await api("/api/dashboard");
    document.getElementById("dash-dino-count").textContent = summary.dinoCount;
    document.getElementById("dash-wallet").textContent = summary.walletBalance;
    document.getElementById("dash-supporter").textContent = summary.supporter
      ? `${summary.supporter.tier} ${summary.supporter.auto_renew ? "(auto-renews)" : "(ending)"}`
      : "None";

    const activityEl = document.getElementById("dash-activity");
    if (summary.recentActivity.length) {
      activityEl.innerHTML = summary.recentActivity
        .map(
          (t) =>
            `<div><span>${escapeHtml(t.reason)}</span><b>${t.amount > 0 ? "+" : ""}${t.amount}</b><small>${new Date(t.created_at).toLocaleString()}</small></div>`
        )
        .join("");
    }
  } catch (err) {
    console.error("Failed to load dashboard", err);
  }

  try {
    const bonus = await api("/api/daily-bonus");
    const bonusState = document.getElementById("dash-bonus-state");
    const bonusButton = document.getElementById("claim-daily-bonus");
    if (bonus.claimed) {
      bonusState.textContent = "Claimed";
      bonusButton.disabled = true;
      bonusButton.textContent = "Come back tomorrow";
    }
  } catch (err) {
    console.error("Failed to load daily bonus state", err);
  }
}

document.getElementById("claim-daily-bonus")?.addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "Rolling…";
  try {
    const result = await api("/api/daily-bonus/claim", { method: "POST" });
    document.getElementById("dash-wallet").textContent = result.wallet.balance;
    document.getElementById("dash-bonus-state").textContent = "Claimed";
    button.textContent = `+${result.amount} Valley Coin!`;
    setTimeout(loadDashboard, 1200);
  } catch (err) {
    button.disabled = false;
    button.textContent = "Roll daily bonus";
    alert(err.message);
  }
});

loadDashboard();
