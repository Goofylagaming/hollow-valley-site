const { api, escapeHtml } = window.HDS;

let supporters = [];
let activeFilter = "attention";

function text(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value ?? "—";
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function copyText(value, label = "Copied") {
  if (!value) return;
  navigator.clipboard?.writeText(String(value)).then(() => {
    text("supporter-admin-status", label);
  }).catch(() => {
    text("supporter-admin-status", "Could not copy automatically.");
  });
}

function rowMatchesFilter(entry) {
  if (activeFilter === "attention") return entry.needsDiscord || entry.needsReconcile || entry.needsWebsiteLink;
  if (activeFilter === "active") return entry.entitled;
  if (activeFilter === "linked") return entry.entitled && entry.discordLinked;
  if (activeFilter === "cancelling") return entry.entitled && !entry.autoRenew;
  return true;
}

function rowMatchesSearch(entry, query) {
  if (!query) return true;
  const haystack = [
    entry.username,
    entry.steamId,
    entry.discordId,
    entry.tierLabel,
    entry.stripeStatus,
    entry.stripeCustomerId,
    entry.stripeSubscriptionId,
    entry.stripeCustomerEmail,
    entry.stripeCustomerName,
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function statusBadge(entry) {
  if (entry.needsWebsiteLink) return '<span class="supporter-admin-badge danger">PAID · WEBSITE ACCOUNT NOT MATCHED</span>';
  if (entry.needsReconcile) return '<span class="supporter-admin-badge danger">PAID · MEMBERSHIP REPAIR NEEDED</span>';
  if (entry.needsDiscord) return '<span class="supporter-admin-badge danger">PAID · DISCORD NOT LINKED</span>';
  if (entry.entitled && entry.discordLinked) return '<span class="supporter-admin-badge good">PAID · DISCORD LINKED</span>';
  if (entry.stripeStatus === "past_due" || entry.stripeStatus === "unpaid") {
    return '<span class="supporter-admin-badge warning">PAYMENT ATTENTION</span>';
  }
  return `<span class="supporter-admin-badge">${escapeHtml(String(entry.stripeStatus || "unknown").toUpperCase())}</span>`;
}

function renderRows() {
  const tbody = document.getElementById("supporter-admin-rows");
  const query = document.getElementById("supporter-admin-search")?.value.trim() || "";
  const visible = supporters.filter((entry) => rowMatchesFilter(entry) && rowMatchesSearch(entry, query));

  if (!visible.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="admin-supporter-empty">No supporter records match this view.</td></tr>';
    return;
  }

  tbody.innerHTML = visible.map((entry) => {
    const steam = entry.steamId || "Not linked";
    const discord = entry.discordId || "Not linked";
    const renewal = entry.autoRenew
      ? (entry.renewsAt ? `Renews ${formatDate(entry.renewsAt)}` : "Auto-renew on")
      : (entry.renewsAt ? `Ends ${formatDate(entry.renewsAt)}` : "Cancelling");

    let primaryAction = "";
    if (entry.needsReconcile && entry.websiteMatched && entry.userId && entry.stripeSubscriptionId) {
      primaryAction = `<button type="button" class="small-button supporter-repair-membership" data-user-id="${entry.userId}" data-subscription-id="${escapeHtml(entry.stripeSubscriptionId)}">Repair membership</button>`;
    } else if (entry.needsWebsiteLink) {
      primaryAction = '<button type="button" class="small-button" disabled>Website account needed</button>';
    } else if (entry.discordLinked && entry.entitled && entry.localSubscriptionRecorded) {
      primaryAction = `<button type="button" class="small-button supporter-sync-role" data-user-id="${entry.userId}">Sync Discord role</button>`;
    } else if (entry.entitled && !entry.discordLinked) {
      primaryAction = '<button type="button" class="small-button" disabled>Discord needed</button>';
    }

    return `<tr class="${entry.needsDiscord ? "needs-attention" : ""}">
      <td>
        <strong>${escapeHtml(entry.username || "Unknown player")}</strong>
        ${entry.stripeCustomerName && entry.stripeCustomerName !== entry.username ? `<small>Stripe: ${escapeHtml(entry.stripeCustomerName)}</small>` : ""}
        ${entry.stripeCustomerEmail ? `<small>${escapeHtml(entry.stripeCustomerEmail)}</small>` : ""}
        <small>${statusBadge(entry)}</small>
      </td>
      <td>
        <code>${escapeHtml(steam)}</code>
        ${entry.steamId ? `<button type="button" class="supporter-copy" data-copy="${escapeHtml(entry.steamId)}">COPY</button>` : ""}
      </td>
      <td>
        <span>${escapeHtml(discord)}</span>
        ${entry.discordId ? `<button type="button" class="supporter-copy" data-copy="${escapeHtml(entry.discordId)}">COPY</button>` : ""}
      </td>
      <td><strong>${escapeHtml(entry.tierLabel || entry.tier || "Unknown")}</strong></td>
      <td>
        <strong>${escapeHtml(String(entry.stripeStatus || "unknown"))}</strong>
        <small>${escapeHtml(entry.stripeCustomerId || "No Stripe customer ID")}</small>
        <small>${escapeHtml(entry.stripeSubscriptionId || "No subscription ID")}</small>
      </td>
      <td>
        <span>${escapeHtml(renewal)}</span>
        <small>Started ${escapeHtml(formatDate(entry.startedAt))}</small>
      </td>
      <td>
        <div class="admin-supporter-actions">
          ${primaryAction}
          ${entry.steamId ? `<button type="button" class="small-button supporter-copy" data-copy="${escapeHtml(entry.steamId)}">Copy Steam ID</button>` : ""}
        </div>
      </td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll(".supporter-copy").forEach((button) => {
    button.addEventListener("click", () => copyText(button.dataset.copy, "Copied to clipboard."));
  });

  tbody.querySelectorAll(".supporter-repair-membership").forEach((button) => {
    button.addEventListener("click", async () => {
      const original = button.textContent;
      button.disabled = true;
      button.textContent = "Repairing…";
      text("supporter-admin-status", "Repairing website membership from the verified Stripe subscription…");
      try {
        const result = await api(`/api/admin-supporters/${encodeURIComponent(button.dataset.userId)}/repair-stripe`, {
          method: "POST",
          body: JSON.stringify({ subscriptionId: button.dataset.subscriptionId }),
        });
        const discordMessage = result.discordSyncError
          ? ` Membership repaired, but Discord sync reported: ${result.discordSyncError}`
          : result.discordSync?.linked
            ? " Membership repaired and Discord role sync completed."
            : " Membership repaired.";
        text("supporter-admin-status", discordMessage.trim());
        await loadSupporters();
      } catch (error) {
        text("supporter-admin-status", error.message || "Membership repair failed.");
        button.disabled = false;
        button.textContent = original;
      }
    });
  });

  tbody.querySelectorAll(".supporter-sync-role").forEach((button) => {
    button.addEventListener("click", async () => {
      const original = button.textContent;
      button.disabled = true;
      button.textContent = "Syncing…";
      text("supporter-admin-status", "Syncing Discord supporter role…");
      try {
        const result = await api(`/api/admin-supporters/${encodeURIComponent(button.dataset.userId)}/sync-discord`, {
          method: "POST",
        });
        text(
          "supporter-admin-status",
          result.changed
            ? `Discord role updated to ${result.roleName || result.tier || "supporter tier"}.`
            : "Discord role was already correct."
        );
        button.textContent = "Synced ✓";
      } catch (error) {
        text("supporter-admin-status", error.message || "Discord role sync failed.");
        button.disabled = false;
        button.textContent = original;
      }
    });
  });
}

async function loadSupporters() {
  const refresh = document.getElementById("supporter-admin-refresh");
  if (refresh) refresh.disabled = true;
  text("supporter-admin-status", "Loading supporter records…");
  try {
    const result = await api("/api/admin-supporters");
    supporters = Array.isArray(result.supporters) ? result.supporters : [];
    text("supporter-count-total", Number(result.summary?.total || 0));
    text("supporter-count-active", Number(result.summary?.entitled || 0));
    text("supporter-count-missing", Number(result.summary?.missingDiscord || 0));
    text("supporter-count-repair", Number(result.summary?.needsReconcile || 0));
    text("supporter-count-cancelling", Number(result.summary?.cancelling || 0));
    const stripeState = result.stripeLive
      ? "Live Stripe subscriptions loaded."
      : result.stripeConfigured
        ? "Stripe live lookup failed; showing website records."
        : "Stripe is not configured; showing website records.";
    const discordState = result.discordRoleSyncConfigured
      ? "Discord role repair is available for linked accounts."
      : "Discord role sync is not configured.";
    text("supporter-admin-status", `${stripeState} ${discordState}`);
    renderRows();
  } catch (error) {
    text("supporter-admin-status", error.message || "Could not load supporter records.");
    document.getElementById("supporter-admin-rows").innerHTML =
      '<tr><td colspan="7" class="admin-supporter-empty">Supporter records are unavailable.</td></tr>';
  } finally {
    if (refresh) refresh.disabled = false;
  }
}

document.querySelectorAll("[data-supporter-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-supporter-filter]").forEach((item) => item.classList.toggle("active", item === button));
    activeFilter = button.dataset.supporterFilter || "all";
    renderRows();
  });
});

document.getElementById("supporter-admin-search")?.addEventListener("input", renderRows);
document.getElementById("supporter-admin-refresh")?.addEventListener("click", loadSupporters);

async function init() {
  const me = await window.HDS.loadMe();
  const guard = document.getElementById("supporter-admin-guard");
  const content = document.getElementById("supporter-admin-content");

  if (!me.loggedIn || !me.user?.is_admin) {
    guard.hidden = false;
    guard.innerHTML = '<p class="section-intro">Admin access is required.</p>';
    content.hidden = true;
    return;
  }

  guard.hidden = true;
  content.hidden = false;
  await loadSupporters();
}

init();
