const { api, escapeHtml } = window.HDS;

let speciesById = {};
let catalog = [];
let activeFilter = "all";
let marketplaceState = { p2pBuyEnabled: false };

async function loadSpeciesMap() {
  const list = await api("/api/species");
  speciesById = Object.fromEntries(list.map((s) => [s.id, s]));
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
        <div class="actions" style="padding:0 15px 15px"><button class="small-button buy-catalog-btn" data-id="${entry.id}">Buy (${entry.size_percent}% Size)</button></div>
      </article>`;
    })
    .join("");

  grid.querySelectorAll(".buy-catalog-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const me = await window.HDS.loadMe();
      if (!me.loggedIn) return alert("Log in with Discord or Steam to buy a dino.");
      const origText = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Purchasing...";
      try {
        await api(`/api/marketplace/catalog/${btn.dataset.id}/buy`, { method: "POST" });
        alert("Purchased! Your dino (75% Size) has been placed in your 'My Dinos' storage and can be redeemed in-game at any time.");
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
        const buyEnabled = marketplaceState.p2pBuyEnabled === true;
        return `<div class="storage-card">
          <h3>${escapeHtml(listing.nickname || species.name)}</h3>
          <small>Size ${listing.size_percent}%</small>
          <div class="stat-row"><span>${listing.price.toLocaleString()} Valley Coin</span></div>
          <div class="actions"><button class="small-button buy-listing-btn" data-id="${listing.id}" ${buyEnabled ? "" : "disabled"}>${buyEnabled ? "Buy" : "Buying Coming Online"}</button></div>
        </div>`;
      })
      .join("");
    grid.querySelectorAll(".buy-listing-btn").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!marketplaceState.p2pBuyEnabled) return;
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
    marketplaceState = { p2pBuyEnabled: false };
  }
  catalog = await api("/api/marketplace/catalog");
  renderCatalog();
  await loadListings();
}

init();
