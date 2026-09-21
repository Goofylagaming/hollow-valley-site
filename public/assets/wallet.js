const { api, escapeHtml } = window.HDS;

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return `${total}s`;
}

function walletActivityLabel(transaction) {
  const kind = String(transaction?.kind || "");
  if (kind === "playtime_reward") return "Playtime reward";
  if (kind === "daily_login") return "Daily login";
  if (kind === "event_reward") return "Event reward";
  if (kind === "marketplace_purchase") return "Marketplace purchase";
  if (kind === "marketplace_refund") return "Marketplace refund";
  if (kind === "marketplace_p2p_hold") return "Dino purchase";
  if (kind === "marketplace_p2p_refund") return "Dino purchase refund";
  if (kind === "marketplace_p2p_sale") return "Dino sold";
  if (kind === "skin_preset_create") return "Skin preset";
  if (kind === "admin_credit") return "Admin credit";
  return transaction?.reason || "Valley Coin activity";
}

async function loadWallet() {
  const me = await window.HDS.loadMe();
  const guard = document.getElementById("wallet-guard");
  const content = document.getElementById("wallet-content");

  if (!me.loggedIn) {
    guard.hidden = false;
    content.hidden = true;
    return;
  }

  guard.hidden = true;
  content.hidden = false;

  try {
    const wallet = await api("/api/wallet");
    const earning = wallet?.earning || {};

    document.getElementById("wallet-balance").textContent = Number(wallet.balance || 0).toLocaleString();

    const base = Number(earning.coinsPer5Minutes || 0);
    const boost = Number(earning.activeBoostPercent || 0);
    const supporterMultiplier = Number(earning.supporterMultiplier || 1);
    const payout = Number(earning.boostedCoinsPer5Minutes || earning.questBoostedCoinsPer5Minutes || base);
    const configured = Boolean(earning.configured);
    const intervalSeconds = Math.max(1, Number(earning.intervalSeconds || 300));
    const accruedSeconds = Math.max(0, Math.min(intervalSeconds, Number(earning.accruedSeconds || 0)));
    const percent = Math.round((accruedSeconds / intervalSeconds) * 100);

    document.getElementById("wallet-base-rate").textContent = configured ? `${base.toLocaleString()} / 5 min` : "Not enabled";
    document.getElementById("wallet-active-boost").textContent = `+${boost}%`;
    document.getElementById("wallet-supporter-multiplier").textContent = `×${supporterMultiplier}`;
    document.getElementById("wallet-current-payout").textContent = configured ? `${payout.toLocaleString()} / 5 min` : "—";
    document.getElementById("wallet-progress-fill").style.width = `${percent}%`;
    document.getElementById("wallet-progress-text").textContent = configured
      ? `${formatDuration(accruedSeconds)} / 5m verified`
      : "Playtime rewards are currently unavailable";
    document.getElementById("wallet-next-payout").textContent =
      configured && Number.isFinite(Number(earning.nextRewardInSeconds))
        ? `Next payout in ${formatDuration(earning.nextRewardInSeconds)}`
        : "Waiting for verified playtime";

    const txEl = document.getElementById("wallet-transactions");
    const transactions = Array.isArray(wallet.transactions) ? wallet.transactions : [];
    if (!transactions.length) {
      txEl.innerHTML = '<div class="empty-roster"><strong>No transactions yet</strong><span>Your Valley Coin earnings and spending will appear here.</span></div>';
      return;
    }

    txEl.innerHTML = transactions.map((transaction) => {
      const amount = Number(transaction.amount) || 0;
      const when = transaction.created_at ? new Date(transaction.created_at).toLocaleString() : "";
      return `<div class="activity-row">
        <span><strong>${escapeHtml(walletActivityLabel(transaction))}</strong><small>${escapeHtml(transaction.reason || "")}</small></span>
        <b>${amount > 0 ? "+" : ""}${amount.toLocaleString()}</b>
        <small>${escapeHtml(when)}</small>
      </div>`;
    }).join("");
  } catch (error) {
    const txEl = document.getElementById("wallet-transactions");
    txEl.innerHTML = `<div class="empty-roster"><strong>Could not load wallet</strong><span>${escapeHtml(error.message || "Wallet unavailable.")}</span></div>`;
  }
}

loadWallet();
