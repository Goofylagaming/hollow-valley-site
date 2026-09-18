const { api, escapeHtml } = window.HDS;

let speciesById = {};
let catalog = [];
let activeFilter = "all";

async function loadSpeciesMap() {
  const list = await api("/api/species");
  speciesById = {};
  for (const species of list) {
    speciesById[String(species.id || "").toLowerCase()] = species;
    speciesById[String(species.name || "").toLowerCase()] = species;
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
    const species = speciesById[String(entry.species_id || "").toLowerCase()];
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
      grid.innerHTML = `<div class="empty-roster"><strong>No listings yet</strong><span>Players can list their own parked dinos for sale from My Dinos.</span></div>`;
      return;
    }
    grid.innerHTML = listings
      .map((listing) => {
        const species = speciesById[String(listing.species_id || "").toLowerCase()] || { name: listing.species_id || "Unknown" };
        const mutations = Array.isArray(listing.mutations) ? listing.mutations : [];
        return `<div class="storage-card">
          <h3>${escapeHtml(listing.nickname || species.name)}</h3>
          <small>${listing.size_percent || 0}% growth${listing.gender ? ` · ${escapeHtml(listing.gender)}` : ""}${listing.is_prime ? " · PRIME" : ""}</small>
          ${mutations.length ? `<div class="market-listing-meta">${mutations.slice(0,4).map((mutation) => `<span>${escapeHtml(mutation)}</span>`).join("")}</div>` : ""}
          <div class="stat-row"><span>${Number(listing.price || 0).toLocaleString()} Valley Coin</span></div>
          <div class="actions"><button class="small-button buy-listing-btn" data-id="${escapeHtml(listing.id)}">Buy</button></div>
        </div>`;
      })
      .join("");
    grid.querySelectorAll(".buy-listing-btn").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const me = await window.HDS.loadMe();
        if (!me.loggedIn) return alert("Log in with Steam to buy a parked dino.");
        const origText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Purchasing...";
        try {
          await api(`/api/marketplace/listings/${encodeURIComponent(btn.dataset.id)}/buy`, { method: "POST" });
          alert("Purchased! The parked dino has been transferred into your My Dinos storage.");
          window.location.href = "/mydinos";
        } catch (err) {
          alert(err.message || "Failed to buy listing");
          btn.disabled = false;
          btn.textContent = origText;
        }
      })
    );
  } catch (err) {
    grid.innerHTML = `<div class="empty-roster"><strong>Listings unavailable</strong><span>${escapeHtml(err.message || "Could not load marketplace listings.")}</span></div>`;
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
      const snapshot = listing.snapshot || {};
      const growth = Math.round((Number(snapshot.growth) || 0) * 100);
      return `<div class="storage-card">
        <h3>${escapeHtml(snapshot.species || "Unknown dino")}</h3>
        <small>${growth}% growth${snapshot.gender ? ` · ${escapeHtml(snapshot.gender)}` : ""}${snapshot.isPrime ? " · PRIME" : ""}</small>
        <div class="market-listing-meta">
          <span>${Number(listing.price || 0).toLocaleString()} Valley Coin</span>
          <span class="listing-status-pill">${escapeHtml(listing.status || "unknown")}</span>
        </div>
        ${(snapshot.mutationList || []).length ? `<div class="market-listing-meta">${snapshot.mutationList.slice(0,4).map((mutation) => `<span>${escapeHtml(mutation)}</span>`).join("")}</div>` : ""}
        <div class="actions">${listing.status === "active" ? `<button class="small-button cancel-listing-btn" data-id="${escapeHtml(listing.id)}">Cancel listing</button>` : ""}</div>
      </div>`;
    }).join("");
    grid.querySelectorAll(".cancel-listing-btn").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!confirm("Cancel this listing and return the dino from escrow to My Dinos?")) return;
        button.disabled = true;
        button.textContent = "Returning...";
        try {
          await api(`/api/marketplace/listings/${encodeURIComponent(button.dataset.id)}/cancel`, { method: "POST" });
          await loadListings();
          await loadMyListings();
        } catch (error) {
          alert(error.message || "Could not cancel listing.");
          button.disabled = false;
          button.textContent = "Cancel listing";
        }
      });
    });
  } catch (error) {
    grid.innerHTML = `<div class="empty-roster"><strong>Your listings are unavailable</strong><span>${escapeHtml(error.message)}</span></div>`;
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
  catalog = await api("/api/marketplace/catalog");
  renderCatalog();
  await loadListings();
  await loadMyListings();
}

init();
