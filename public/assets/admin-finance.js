const { api, escapeHtml } = window.HDS;
const ZERO_DECIMAL = new Set(["bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"]);
const TIMEZONE = "Australia/Brisbane";
let financeData = null;

function put(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value ?? "—";
}

function dateOf(value, dateOnly = false) {
  if (!value || Number.isNaN(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: TIMEZONE, dateStyle: "medium", ...(dateOnly ? {} : { timeStyle: "short" }),
  }).format(new Date(value)) + (dateOnly ? "" : " QLD");
}

function money(amount, currency) {
  if (!Number.isSafeInteger(amount) || !/^[a-z]{3}$/i.test(String(currency || ""))) return "Variable / unavailable";
  try {
    return new Intl.NumberFormat("en-AU", {
      style: "currency", currency: currency.toUpperCase(),
    }).format(amount / (ZERO_DECIMAL.has(currency.toLowerCase()) ? 1 : 100));
  } catch {
    return "—";
  }
}

function humanStatus(status) {
  return String(status || "unknown").replaceAll("_", " ").replace(/\b[a-z]/g, (m) => m.toUpperCase());
}

function isAttention(s) {
  return ["past_due", "unpaid", "incomplete"].includes(s.status);
}

function upcoming30(s) {
  const ts = Date.parse(s.periodEndAt || "");
  return s.autoRenew && s.status === "active" && s.collectionMethod !== "send_invoice" &&
    Number.isFinite(ts) && ts >= Date.now() && ts <= Date.now() + 30 * 86400000;
}

function visibleSubscriptions() {
  if (!financeData) return [];
  const filter = document.getElementById("finance-filter")?.value || "all";
  const search = (document.getElementById("finance-search")?.value || "").trim().toLowerCase();
  return financeData.subscriptions.filter((s) => {
    if (filter === "next30" && !upcoming30(s)) return false;
    if (filter === "attention" && !isAttention(s)) return false;
    if (filter === "cancelling" && !(s.cancelAt || (!s.autoRenew && s.status === "active"))) return false;
    return !search || [s.player, s.customer, s.email, s.tier, s.status].some((v) =>
      String(v || "").toLowerCase().includes(search));
  });
}

function renderSubscriptions() {
  const rows = visibleSubscriptions();
  const tbody = document.getElementById("finance-subscription-rows");
  tbody.innerHTML = rows.length ? rows.map((s) => {
    const customer = [s.customer, s.email].filter(Boolean).join(" · ");
    const price = s.amount === null ? "Variable / unavailable" : money(s.amount, s.currency);
    const renewal = s.cancelAt ? "Cancelling" : s.autoRenew ? "Renews" : "Not renewing";
    const date = s.cancelAt || s.periodEndAt;
    const label = s.status === "trialing" ? "Trial ends" : (s.cancelAt ? "Ends" : "Period ends");
    return '<tr>' +
      '<td><strong>' + escapeHtml(s.player || s.customer || s.email || "Stripe customer") + '</strong>' +
      (customer ? '<small>' + escapeHtml(customer) + '</small>' : "") + '</td>' +
      '<td>' + escapeHtml(s.tier) + '</td>' +
      '<td>' + escapeHtml(price) + '<small>' + escapeHtml(s.interval ? "per " + s.interval : "Price unavailable") + '</small></td>' +
      '<td><span class="finance-status ' + (isAttention(s) ? "finance-warning" : "") + '">' + escapeHtml(humanStatus(s.status)) + '</span></td>' +
      '<td>' + escapeHtml(label) + ": " + escapeHtml(dateOf(date)) + '</td>' +
      '<td>' + escapeHtml(renewal) + '</td>' +
      '</tr>';
  }).join("") : '<tr><td colspan="6" class="finance-empty">No matching subscriptions.</td></tr>';
  put("finance-subscription-count", rows.length + " shown of " + financeData.subscriptions.length + " Hollow Valley subscriptions · QLD time.");
}

function renderPayouts() {
  const rows = financeData.payouts;
  document.getElementById("finance-payout-rows").innerHTML = rows.length ? rows.map((p) =>
    '<tr><td>' + escapeHtml(dateOf(p.createdAt)) + '</td>' +
    '<td><strong>' + escapeHtml(money(p.amount, p.currency)) + '</strong></td>' +
    '<td><span class="finance-status ' + (p.status === "failed" || p.status === "canceled" ? "finance-warning" : "") + '">' + escapeHtml(humanStatus(p.status)) + '</span></td>' +
    '<td>' + escapeHtml(dateOf(p.arrivalAt, true)) + '</td>' +
    '<td>' + (p.automatic ? "Automatic" : "Manual") + '</td></tr>'
  ).join("") : '<tr><td colspan="5" class="finance-empty">No Stripe bank payouts returned.</td></tr>';
  put("finance-payout-note", financeData.payoutHistoryLimited
    ? "Showing the most recent 500 Stripe payouts; older transactions are available in Stripe."
    : rows.length + " Stripe bank payouts retrieved. A paid Stripe payout is not confirmation of bank receipt.");
}

function renderAmounts(id, entries, emptyMessage) {
  const target = document.getElementById(id);
  target.replaceChildren();
  if (!entries?.length) {
    const item = document.createElement("p");
    item.className = "finance-muted";
    item.textContent = emptyMessage;
    target.append(item);
    return;
  }
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "finance-amount";
    const label = document.createElement("span");
    label.textContent = entry.label;
    const value = document.createElement("strong");
    value.textContent = money(entry.amount, entry.currency);
    row.append(label, value);
    target.append(row);
  }
}

function render() {
  const d = financeData;
  put("finance-updated", "Stripe " + d.mode.toUpperCase() + " · Refreshed " + dateOf(d.asOf));
  put("finance-active", d.summary.active);
  put("finance-renewals", d.summary.upcomingRenewals30Days);
  put("finance-attention", d.summary.paymentAttention);
  const payout = d.summary.nextStripePayout;
  put("finance-next-payout", payout ? money(payout.amount, payout.currency) : "Not scheduled");
  put("finance-next-payout-date", payout
    ? humanStatus(payout.status) + " · Estimated " + dateOf(payout.arrivalAt, true)
    : "Stripe has not reported an outgoing bank payout.");

  renderAmounts("finance-balances", d.balance.map((b) => ({
    ...b, label: b.kind === "available" ? "Available · " + b.currency.toUpperCase() : "Pending · " + b.currency.toUpperCase(),
  })), "No balance amounts provided by Stripe.");
  renderAmounts("finance-projection", d.summary.estimatedRenewalGross30Days.map((b) => ({
    ...b, label: "Estimated gross · " + b.currency.toUpperCase(),
  })), "No priced automatic renewals due in the next 30 days.");

  renderSubscriptions();
  renderPayouts();
}

async function refresh() {
  const button = document.getElementById("finance-refresh");
  const errorBox = document.getElementById("finance-error");
  button.disabled = true;
  errorBox.hidden = true;
  put("finance-updated", "Fetching Stripe financial data…");
  try {
    const result = await api("/api/admin/finance");
    financeData = result;
    render();
    document.getElementById("finance-content").hidden = false;
  } catch (error) {
    errorBox.textContent = error.message || "Could not load financial information.";
    errorBox.hidden = false;
    put("finance-updated", "Stripe finance view unavailable.");
    if (!financeData) document.getElementById("finance-content").hidden = true;
  } finally {
    button.disabled = false;
  }
}

// Spreadsheet CSV formula injection must be neutralised for external customer names.
function csvCell(value) {
  let s = String(value ?? "").replace(/[\r\n]+/g, " ");
  if (/^\s*[=+\-@\t]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
function exportCsv() {
  if (!financeData) return;
  const keys = ["Player", "Customer", "Email", "Tier", "Status", "Recurring price", "Period end (QLD)", "Auto renew"];
  const records = visibleSubscriptions().map((s) => [
    s.player, s.customer, s.email, s.tier, s.status,
    s.amount === null ? "" : money(s.amount, s.currency),
    dateOf(s.periodEndAt), s.autoRenew ? "Yes" : "No",
  ]);
  const content = [keys, ...records].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "hollow-valley-finance-renewals.csv";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.getElementById("finance-refresh")?.addEventListener("click", refresh);
document.getElementById("finance-filter")?.addEventListener("change", () => financeData && renderSubscriptions());
document.getElementById("finance-search")?.addEventListener("input", () => financeData && renderSubscriptions());
document.getElementById("finance-export")?.addEventListener("click", exportCsv);

(async () => {
  const me = await window.HDS.loadMe().catch(() => null);
  if (!me?.financeOwnerAccess) {
    put("finance-updated", "Owner access required.");
    return;
  }
  await refresh();
})();
