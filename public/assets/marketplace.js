const { api, escapeHtml } = window.HDS;

let speciesById = {};
let catalog = [];
let activeFilter = "all";

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
        <div class="actions" style="padding:0 15px 15px"><button class="small-button buy-catalog-btn" data-id="${entry.id}">Buy</button></div>
      </article>`;
    })
    .join("");

  grid.querySelectorAll(".buy-catalog-btn").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const me = await window.HDS.loadMe();
      if (!me.loggedIn) return alert("Log in with Discord to buy a dino.");
      try {
        await api(`/api/marketplace/catalog/${btn.dataset.id}/buy`, { method: "POST" });
        alert("Purchased! Check My Dinos to see it in storage.");
      } catch (err) {
        alert(err.message);
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
        return `<div class="storage-card">
          <h3>${escapeHtml(listing.nickname || species.name)}</h3>
          <small>Sold by ${escapeHtml(listing.seller_username)} • Size ${listing.size_percent}%</small>
          <div class="stat-row"><span>${listing.price.toLocaleString()} Valley Coin</span></div>
          <div class="actions"><button class="small-button buy-listing-btn" data-id="${listing.id}">Buy</button></div>
        </div>`;
      })
      .join("");
    grid.querySelectorAll(".buy-listing-btn").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const me = await window.HDS.loadMe();
        if (!me.loggedIn) return alert("Log in with Discord to buy a dino.");
        try {
          await api(`/api/marketplace/listings/${btn.dataset.id}/buy`, { method: "POST" });
          alert("Purchased! Check My Dinos to see it in storage.");
          await loadListings();
        } catch (err) {
          alert(err.message);
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
  catalog = await api("/api/marketplace/catalog");
  renderCatalog();
  await loadListings();
}

init();
