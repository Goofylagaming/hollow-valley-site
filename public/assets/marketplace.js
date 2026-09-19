const { api, escapeHtml } = window.HDS;

let speciesById = {};
let catalog = [];
let activeFilter = "all";
let marketplaceState = { officialWritesEnabled: false, p2pWritesEnabled: false, p2pBuyEnabled: false };
let myListingIds = new Set();


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
  grid.innerHTML = filtered
    .map((entry) => {
      const species = speciesById[entry.species_id] || { name: entry.species_id, art: "carno", role: "" };
      return `<article class="dino-card" data-id="${entry.id}">
        <div class="dino-art ${species.art}"><span>${species.name.toUpperCase()}</span></div>
        <div class="dino-info"><div><small>${(species.role || "").toUpperCase()}</small><h3>${escapeHtml(species.name)}</h3></div></div>
        <div class="dino-meta"><span>${entry.price.toLocaleString()} Valley Coin</span><span>Size ${entry.size_percent}%</span></div>
        <div class="actions" style="padding:0 15px 15px"><button class="small-button buy-catalog-btn" data-id="${entry.id}" data-size="${entry.size_percent}" ${marketplaceState.officialWritesEnabled === true ? "" : "disabled"}>${marketplaceState.officialWritesEnabled === true ? `Buy (${entry.size_percent}% Size)` : "Purchases Offline"}</button></div>
      </article>`;
    })
    .join("");

  grid.querySelectorAll(".buy-catalog-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (marketplaceState.officialWritesEnabled !== true) return;
      const me = await window.HDS.loadMe();
      if (!me.loggedIn) return alert("Log in with Discord or Steam to buy a dino.");
      const origText = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Purchasing...";
      try {
        await api(`/api/marketplace/catalog/${btn.dataset.id}/buy`, { method: "POST" });
        alert(`Purchased! Your dino (${btn.dataset.size}% Size) has been placed in your 'My Dinos' storage and can be redeemed in-game at any time.`);
        window.location.href = "/mydinos";
      } catch (err) {
        alert(err.message || "Failed to purchase dino");
        btn.disabled = false;
        btn.textContent = origText;
      }
    })
  );
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
        return `<div class="storage-card">
          <h3>${escapeHtml(listing.nickname || species.name)}</h3>
          <small>Size ${listing.size_percent}%</small>
          <div class="stat-row"><span>${listing.price.toLocaleString()} Valley Coin</span></div>
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
}

init();
