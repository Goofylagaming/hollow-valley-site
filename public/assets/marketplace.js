const { api, escapeHtml } = window.HDS;

let speciesById = {};
let catalog = [];
let activeFilter = "all";
let marketplaceState = { officialWritesEnabled: false, p2pWritesEnabled: false, p2pBuyEnabled: false };
let myListingIds = new Set();
let currentUser = null;


function renderMarketplaceState() {
  const banner = document.getElementById("market-state-banner");
  const detail = document.getElementById("market-state-detail");
  if (!banner || !detail) return;

  const official = marketplaceState.officialWritesEnabled === true;
  const p2p = marketplaceState.p2pWritesEnabled === true;
  banner.classList.toggle("online", official || p2p);
  banner.classList.toggle("offline", !official && !p2p);
  const label = banner.querySelector("b");
  if (official && p2p) {
    label.textContent = "Marketplace fully online";
    detail.textContent = "Official purchases and survivor trading are enabled.";
  } else if (official) {
    label.textContent = "Official catalog online";
    detail.textContent = "Survivor trading is temporarily read-only.";
  } else if (p2p) {
    label.textContent = "Survivor trading online";
    detail.textContent = "Official catalog purchases are temporarily disabled.";
  } else {
    label.textContent = "Marketplace read-only";
    detail.textContent = "Browse only — purchases and listings are temporarily disabled.";
  }
}

async function loadSpeciesMap() {
  const list = await api("/api/species");
  speciesById = Object.fromEntries(list.map((s) => [s.id, s]));
}

function listingSkinColor(color) {
  if (!color || typeof color !== "object") return "";
  const clamp = (value) => Math.max(0, Math.min(255, Math.round((Number(value) || 0) * 255)));
  return `rgb(${clamp(color.r)}, ${clamp(color.g)}, ${clamp(color.b)})`;
}

function listingSkinPreview(skin) {
  if (!skin || typeof skin !== "object") return "";
  const colors = ["body", "markings", "flank", "underbelly", "eyes"]
    .map((key) => listingSkinColor(skin[key]))
    .filter(Boolean);
  if (!colors.length) return "";
  return `<div class="dino-skin-row market-skin-preview">
    <div class="dino-skin-swatches">${colors.map((color) => `<i style="background:${escapeHtml(color)}"></i>`).join("")}</div>
    <small>Pattern ${Number(skin.patternIndex ?? 0)} · Theme ${Number(skin.themeIndex ?? 0)}</small>
  </div>`;
}

async function loadMyListingIds() {
  myListingIds = new Set();
  try {
    const me = await window.HDS.loadMe();
    if (!me?.loggedIn) return;
    const mine = await api("/api/marketplace/listings/mine");
    myListingIds = new Set((Array.isArray(mine) ? mine : []).map((listing) => String(listing.id)));
  } catch (err) {
    console.warn("Could not identify own marketplace listings", err);
  }
}

function sortCatalog(list) {
  const mode = document.getElementById("sort-select").value;
  const copy = [...list];
  if (mode === "price-asc") copy.sort((a, b) => a.price - b.price);
  if (mode === "price-desc") copy.sort((a, b) => b.price - a.price);
  if (mode === "size-desc") copy.sort((a, b) => b.size_percent - a.size_percent);
  return copy;
}

function renderCatalog() {
  const grid = document.getElementById("catalog-grid");
  let filtered = catalog.filter((entry) => {
    const species = speciesById[entry.species_id];
    return activeFilter === "all" || species?.category === activeFilter;
  });
  filtered = sortCatalog(filtered);
  if (!filtered.length) {
    grid.innerHTML = '<p class="section-intro">No dinos match that filter.</p>';
    return;
  }

  const groups = new Map();
  filtered.forEach((entry) => {
    if (!groups.has(entry.species_id)) groups.set(entry.species_id, []);
    groups.get(entry.species_id).push(entry);
  });

  grid.innerHTML = [...groups.entries()].map(([speciesId, entries]) => {
    const species = speciesById[speciesId] || { name: speciesId, art: "carno", role: "" };
    const options = entries.map((entry) => `
      <div class="market-tier ${entry.is_prime ? "prime" : ""}" data-id="${entry.id}">
        <div class="market-tier-title"><b>${escapeHtml(entry.growth_tier_label || (entry.is_prime ? "Prime" : entry.size_percent + "%"))}</b>${entry.is_prime ? '<span class="prime-badge">PRIME</span>' : ""}</div>
        <div class="market-tier-meta"><span>${entry.price.toLocaleString()} Valley Coin</span><span>${entry.size_percent}% growth</span></div>
        <div class="market-tier-actions">
          <button class="small-button buy-catalog-btn" data-id="${entry.id}" data-size="${entry.size_percent}" ${marketplaceState.officialWritesEnabled === true ? "" : "disabled"}>${marketplaceState.officialWritesEnabled === true ? "Buy" : "Offline"}</button>
          ${currentUser?.is_admin ? `<button class="small-button admin-catalog-edit" data-id="${entry.id}">Edit</button>` : ""}
        </div>
      </div>`).join("");

    return `<article class="dino-card market-species-card" data-species="${escapeHtml(speciesId)}">
      <div class="market-dino-thumb dino-art ${escapeHtml(species.art || "carno")}" role="img" aria-label="${escapeHtml(species.name)} thumbnail"></div>
      <div class="dino-info"><div><small>${escapeHtml((species.role || "").toUpperCase())}</small><h3>${escapeHtml(species.name)}</h3></div></div>
      <div class="market-tier-list">${options}</div>
    </article>`;
  }).join("");

  grid.querySelectorAll(".buy-catalog-btn").forEach((btn) => btn.addEventListener("click", async () => {
    if (marketplaceState.officialWritesEnabled !== true) return;
    const me = await window.HDS.loadMe();
    if (!me.loggedIn) return alert("Log in with Discord or Steam to buy a dino.");
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Purchasing...";
    try {
      const result = await api(`/api/marketplace/catalog/${btn.dataset.id}/buy`, { method: "POST" });
      if (result.fulfilled || result.order?.status === "fulfilled") {
        alert("Purchased! The dino is now available in My Dinos.");
        window.location.href = "/mydinos";
        return;
      }
      alert("Order accepted. DinoStorage delivery is processing. Track it under Your Store Orders.");
      btn.textContent = "Processing";
      await loadMyOrders();
    } catch (err) {
      alert(err.message || "Failed to purchase dino");
      btn.disabled = false;
      btn.textContent = origText;
    }
  }));

  grid.querySelectorAll(".admin-catalog-edit").forEach((btn) => btn.addEventListener("click", async () => {
    const entry = catalog.find((item) => String(item.id) === String(btn.dataset.id));
    if (!entry) return;
    const priceRaw = prompt("Valley Coin price:", String(entry.price));
    if (priceRaw === null) return;
    const growthRaw = prompt("Exact growth percentage:", String(entry.size_percent));
    if (growthRaw === null) return;
    const active = confirm("Keep this marketplace option enabled?\nOK = enabled · Cancel = disabled");
    const isPrime = entry.growth_tier === "prime" ? true : confirm("Grant Prime status for this option?\nOK = Prime · Cancel = normal");
    btn.disabled = true;
    try {
      const result = await api(`/api/marketplace/catalog/${encodeURIComponent(entry.id)}`, {
        method: "PUT",
        body: JSON.stringify({ price: Number(priceRaw), growthPercent: Number(growthRaw), active, isPrime }),
      });
      const updated = result.item;
      if (updated) {
        entry.price = Number(updated.price);
        entry.size_percent = Number(updated.payload?.growthPercent ?? updated.payload?.sizePercent ?? entry.size_percent);
        entry.is_prime = Boolean(updated.payload?.isPrime);
      }
      if (!active) catalog = catalog.filter((item) => item.id !== entry.id);
      renderCatalog();
    } catch (err) {
      alert(err.message || "Could not update marketplace option.");
      btn.disabled = false;
    }
  }));
}

async function loadListings() {
  const grid = document.getElementById("listings-grid");
  try {
    const listings = await api("/api/marketplace/listings");
    if (!listings.length) {
      grid.innerHTML = `<div class="empty-roster"><strong>No listings yet</strong><span>Players can list their own dinos for sale from My Dinos.</span></div>`;
      return;
    }
    grid.innerHTML = listings
      .map((listing) => {
        const species = speciesById[listing.species_id] || { name: listing.species_id };
        const isMine = myListingIds.has(String(listing.id));
        const buyEnabled = marketplaceState.p2pBuyEnabled === true && !isMine;
        const buttonText = isMine ? "Your Listing" : marketplaceState.p2pBuyEnabled === true ? "Buy" : "Buying Coming Online";
        const mutations = Array.isArray(listing.mutations) ? listing.mutations : [];
        return `<div class="storage-card">
          <h3>${escapeHtml(listing.nickname || species.name)}</h3>
          <small>${Number(listing.size_percent || 0)}% growth${listing.gender ? ` · ${escapeHtml(listing.gender)}` : ""}${listing.is_prime ? " · PRIME" : ""}</small>
          ${mutations.length ? `<div class="market-listing-meta">${mutations.slice(0,4).map((mutation) => `<span>${escapeHtml(mutation)}</span>`).join("")}</div>` : ""}
          ${listingSkinPreview(listing.skin)}
          <div class="stat-row"><span>${Number(listing.price || 0).toLocaleString()} Valley Coin</span></div>
          <div class="actions"><button class="small-button buy-listing-btn" data-id="${listing.id}" ${buyEnabled ? "" : "disabled"}>${buttonText}</button></div>
        </div>`;
      })
      .join("");
    grid.querySelectorAll(".buy-listing-btn").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!marketplaceState.p2pBuyEnabled || myListingIds.has(String(btn.dataset.id))) return;
        const me = await window.HDS.loadMe();
        if (!me.loggedIn) return alert("Log in with Discord or Steam to buy a dino.");
        const origText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Purchasing...";
        try {
          await api(`/api/marketplace/listings/${btn.dataset.id}/buy`, { method: "POST" });
          alert("Purchased! The dino has been transferred straight to your 'My Dinos' storage and can be redeemed in-game at any time.");
          window.location.href = "/mydinos";
        } catch (err) {
          alert(err.message || "Failed to buy listing");
          btn.disabled = false;
          btn.textContent = origText;
        }
      })
    );
  } catch (err) {
    console.error("Failed to load listings", err);
  }
}

async function loadMyOrders() {
  const section = document.getElementById("my-orders-section");
  const grid = document.getElementById("my-orders-grid");
  if (!section || !grid) return;
  const me = await window.HDS.loadMe();
  if (!me.loggedIn) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  try {
    const orders = await api("/api/marketplace/orders/mine");
    if (!Array.isArray(orders) || !orders.length) {
      grid.innerHTML = `<div class="empty-roster"><strong>No official store orders</strong><span>Official catalog purchases will appear here while DinoStorage delivers them.</span></div>`;
      return;
    }
    grid.innerHTML = orders.map((order) => {
      const item = order.itemSnapshot || {};
      const payload = item.payload || {};
      const status = String(order.status || "unknown");
      const detail = status === "fulfilled"
        ? `Available in My Dinos${order.fulfillment?.slot ? ` · ${escapeHtml(order.fulfillment.slot)}` : ""}`
        : status === "pending"
          ? "DinoStorage delivery processing"
          : status === "refunded"
            ? "Valley Coin refunded"
            : status === "failed"
              ? escapeHtml(order.error || "Delivery failed")
              : escapeHtml(status);
      return `<div class="storage-card">
        <h3>${escapeHtml(item.name || payload.species || order.catalog_id || "Official dino")}</h3>
        <small>${Number(payload.growthPercent ?? payload.sizePercent ?? 75)}% growth</small>
        <div class="market-listing-meta">
          <span>${Number(order.price || 0).toLocaleString()} Valley Coin</span>
          <span class="listing-status-pill">${escapeHtml(status)}</span>
        </div>
        <p class="section-intro">${detail}</p>
      </div>`;
    }).join("");
  } catch (error) {
    grid.innerHTML = `<div class="empty-roster"><strong>Store orders unavailable</strong><span>${escapeHtml(error.message || "Could not load orders.")}</span></div>`;
  }
}

async function loadMyListings() {
  const section = document.getElementById("my-listings-section");
  const grid = document.getElementById("my-listings-grid");
  if (!section || !grid) return;
  const me = await window.HDS.loadMe();
  if (!me.loggedIn) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  try {
    const listings = await api("/api/marketplace/listings/mine");
    if (!Array.isArray(listings) || !listings.length) {
      grid.innerHTML = `<div class="empty-roster"><strong>No marketplace listings</strong><span>List a parked dinosaur from My Dinos.</span></div>`;
      return;
    }
    grid.innerHTML = listings.map((listing) => {
      const mutations = Array.isArray(listing.mutations) ? listing.mutations : [];
      const active = String(listing.status || "") === "active";
      const cancelEnabled = active && marketplaceState.p2pCancelEnabled === true;
      return `<div class="storage-card">
        <h3>${escapeHtml(listing.species_id || "Unknown dino")}</h3>
        <small>${Number(listing.size_percent || 0)}% growth${listing.gender ? ` · ${escapeHtml(listing.gender)}` : ""}${listing.is_prime ? " · PRIME" : ""}</small>
        <div class="market-listing-meta">
          <span>${Number(listing.price || 0).toLocaleString()} Valley Coin</span>
          <span class="listing-status-pill">${escapeHtml(listing.status || "unknown")}</span>
        </div>
        ${mutations.length ? `<div class="market-listing-meta">${mutations.slice(0,4).map((mutation) => `<span>${escapeHtml(mutation)}</span>`).join("")}</div>` : ""}
        ${listingSkinPreview(listing.skin)}
        <div class="actions">${active ? `<button class="small-button cancel-listing-btn" data-id="${escapeHtml(listing.id)}" ${cancelEnabled ? "" : "disabled"}>${cancelEnabled ? "Cancel listing" : "Cancellation locked"}</button>` : ""}</div>
      </div>`;
    }).join("");

    grid.querySelectorAll(".cancel-listing-btn:not([disabled])").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!confirm("Cancel this listing and return the dino from escrow to My Dinos?")) return;
        button.disabled = true;
        button.textContent = "Returning...";
        try {
          await api(`/api/marketplace/listings/${encodeURIComponent(button.dataset.id)}/cancel`, { method: "POST" });
          await Promise.all([loadMyListingIds(), loadListings(), loadMyListings()]);
        } catch (error) {
          alert(error.message || "Could not cancel listing.");
          button.disabled = false;
          button.textContent = "Cancel listing";
        }
      });
    });
  } catch (error) {
    grid.innerHTML = `<div class="empty-roster"><strong>Your listings are unavailable</strong><span>${escapeHtml(error.message || "Could not load listings.")}</span></div>`;
  }
}

document.querySelectorAll(".filter").forEach((filter) => {
  filter.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach((f) => f.classList.toggle("active", f === filter));
    activeFilter = filter.dataset.filter;
    renderCatalog();
  });
});

document.getElementById("sort-select")?.addEventListener("change", renderCatalog);

async function init() {
  await loadSpeciesMap();
  currentUser = await window.HDS.loadMe();
  try {
    marketplaceState = await api("/api/marketplace/state");
  } catch {
    marketplaceState = { officialWritesEnabled: false, p2pWritesEnabled: false, p2pBuyEnabled: false };
  }
  renderMarketplaceState();
  await loadMyListingIds();
  catalog = await api("/api/marketplace/catalog");
  renderCatalog();
  await loadListings();
  await loadMyOrders();
  await loadMyListings();
}

init();
