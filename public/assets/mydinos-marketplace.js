(() => {
  const { api, escapeHtml } = window.HDS || {};
  if (typeof api !== "function") return;

  const ACTIVE_STATUSES = new Set(["escrowing", "active", "reserved", "transfer_uncertain", "cancelling"]);
  const HISTORY_STATUSES = new Set(["sold", "cancelled", "failed"]);

  function ensurePanel() {
    let panel = document.getElementById("my-marketplace-listings");
    if (panel) return panel;

    const bodyDrop = document.getElementById("bodydrop-panel");
    const content = document.getElementById("mydinos-content");
    if (!content) return null;

    panel = document.createElement("section");
    panel.id = "my-marketplace-listings";
    panel.className = "bodydrop-panel";
    panel.style.marginTop = "28px";
    panel.innerHTML = `
      <div>
        <p class="overline green">MARKETPLACE</p>
        <h2>Your survivor listings.</h2>
        <p class="section-intro">Dinos listed for sale are held safely in marketplace escrow until sold or cancelled.</p>
      </div>
      <div id="my-marketplace-listings-content" class="bodydrop-content">
        <p class="section-intro">Loading your listings…</p>
      </div>`;

    if (bodyDrop) content.insertBefore(panel, bodyDrop);
    else content.appendChild(panel);
    return panel;
  }

  function renderActiveListing(listing, cancelEnabled) {
    const status = String(listing.status || "unknown");
    const canCancel = cancelEnabled && status === "active";
    const buttonText = status === "cancelling"
      ? "Cancelling…"
      : canCancel
        ? "Cancel Listing"
        : "Cancel unavailable";

    return `
      <article class="storage-card" style="margin-bottom:12px" data-listing-id="${escapeHtml(listing.id)}">
        <h3>${escapeHtml(listing.species_id || "Unknown dinosaur")}</h3>
        <small>Size ${Number(listing.size_percent) || 0}% · ${escapeHtml(status)}</small>
        <div class="stat-row"><span>${Number(listing.price || 0).toLocaleString()} Valley Coin</span></div>
        <div class="actions">
          <button class="small-button cancel-listing-btn" data-id="${escapeHtml(listing.id)}" ${canCancel ? "" : "disabled"}>${buttonText}</button>
        </div>
      </article>`;
  }

  function renderHistoryListing(listing) {
    const status = String(listing.status || "unknown");
    const price = Number(listing.price || 0);
    const detail = status === "sold"
      ? `Sold · +${price.toLocaleString()} Valley Coin`
      : status === "cancelled"
        ? "Cancelled · Dino returned to My Dinos"
        : "Failed · Review may be required";

    return `
      <article class="storage-card" style="margin-bottom:12px;opacity:.82" data-listing-id="${escapeHtml(listing.id)}">
        <h3>${escapeHtml(listing.species_id || "Unknown dinosaur")}</h3>
        <small>Size ${Number(listing.size_percent) || 0}% · ${escapeHtml(status)}</small>
        <div class="stat-row"><span>${escapeHtml(detail)}</span></div>
      </article>`;
  }

  async function load() {
    const panel = ensurePanel();
    if (!panel) return;
    const target = document.getElementById("my-marketplace-listings-content");
    if (!target) return;

    try {
      const me = await window.HDS.loadMe();
      if (!me?.loggedIn) {
        panel.hidden = true;
        return;
      }

      const [state, mine] = await Promise.all([
        api("/api/marketplace/state"),
        api("/api/marketplace/listings/mine"),
      ]);
      const all = Array.isArray(mine) ? mine : [];
      const listings = all.filter((listing) => ACTIVE_STATUSES.has(String(listing.status || "")));
      const history = all
        .filter((listing) => HISTORY_STATUSES.has(String(listing.status || "")))
        .slice(0, 5);
      const cancelEnabled = state?.p2pCancelEnabled === true;

      const activeHtml = listings.length
        ? listings.map((listing) => renderActiveListing(listing, cancelEnabled)).join("")
        : '<p class="section-intro">You have no active survivor listings.</p>';
      const historyHtml = history.length
        ? `<div class="list-heading" style="margin-top:24px"><span>RECENT LISTING HISTORY</span></div>${history.map(renderHistoryListing).join("")}`
        : "";

      target.innerHTML = activeHtml + historyHtml;
      target.querySelectorAll(".cancel-listing-btn").forEach((button) => {
        button.addEventListener("click", async () => {
          const id = button.dataset.id;
          const listing = listings.find((item) => item.id === id);
          if (!listing || !cancelEnabled) return;
          if (!confirm(`Cancel your ${listing.species_id || "dino"} listing? The dino will be moved from escrow back into My Dinos.`)) return;

          button.disabled = true;
          button.textContent = "Cancelling…";
          try {
            await api(`/api/marketplace/listings/${encodeURIComponent(id)}/cancel`, { method: "POST" });
            alert("Listing cancelled. Your dino has been returned to My Dinos.");
            window.location.reload();
          } catch (err) {
            alert(err.message || "Failed to cancel listing. Do not retry until the listing status is checked.");
            await load();
          }
        });
      });
    } catch (err) {
      target.innerHTML = `<p class="section-intro">Marketplace listings unavailable: ${escapeHtml(err.message || "Unknown error")}</p>`;
    }
  }

  window.addEventListener("load", () => {
    setTimeout(load, 250);
  });
})();
