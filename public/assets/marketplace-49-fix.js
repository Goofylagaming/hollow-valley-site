(() => {
  // The official catalog backend already exposes the current 49% standard tier.
  // The legacy renderer still accepts only 50% + 75% Prime, so adapt the
  // 49% entries only for that legacy filter, then restore their real value
  // before the page is shown or any purchase/admin action runs.
  const baseRenderCatalog = renderCatalog;

  renderCatalog = function renderCatalogWith49PercentTier() {
    const adapted = [];

    if (Array.isArray(catalog)) {
      for (const entry of catalog) {
        if (Number(entry?.size_percent) === 49 && entry?.is_prime !== true) {
          adapted.push(entry);
          entry.size_percent = 50;
        }
      }
    }

    try {
      baseRenderCatalog();
    } finally {
      for (const entry of adapted) entry.size_percent = 49;
    }

    if (!adapted.length) return;

    const byId = new Map(adapted.map((entry) => [String(entry.id), entry]));
    document.querySelectorAll('.market-tier[data-id]').forEach((tier) => {
      const entry = byId.get(String(tier.dataset.id));
      if (!entry) return;

      const title = tier.querySelector('.market-tier-title b');
      if (title) title.textContent = entry.growth_tier_label || '49%';

      const meta = tier.querySelectorAll('.market-tier-meta span');
      if (meta[1]) meta[1].textContent = '49% growth';

      const buy = tier.querySelector('.buy-catalog-btn');
      if (buy) buy.dataset.size = '49';
    });
  };

  // If the catalog finished loading before this compatibility layer ran,
  // redraw it once using the corrected tier handling.
  if (Array.isArray(catalog) && catalog.some((entry) => Number(entry?.size_percent) === 49)) {
    renderCatalog();
  }
})();
