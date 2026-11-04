'use strict';
(async function () {
  const status = document.getElementById('status');
  try {
    const response = await fetch('/assets/premium-skin-drafts.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Draft file unavailable (${response.status}).`);
    const pack = await response.json();
    const core = window.HVSkinStudioCore;
    const cards = pack.skins.map((entry) => {
      // Use the actual editor validator before showing a palette as a usable draft.
      const skin = Object.fromEntries(core.COLOR_KEYS.map((key) => [key, core.hexToColor(entry.colors[key])]));
      for (const key of core.INDEX_KEYS) skin[key] = entry[key];
      core.validateDocument(core.createDocument({ name: entry.name, description: entry.description, species: pack.species, skin }));
      const card = document.createElement('article');
      const title = document.createElement('h2');
      title.textContent = entry.name;
      const description = document.createElement('p');
      description.textContent = entry.description;
      const palette = document.createElement('div');
      palette.className = 'palette';
      for (const field of core.COLORS) {
        const figure = document.createElement('figure');
        const swatch = document.createElement('span');
        swatch.className = 'swatch';
        swatch.style.backgroundColor = entry.colors[field.key];
        const caption = document.createElement('figcaption');
        caption.textContent = `${field.label} ${entry.colors[field.key]}`;
        figure.append(swatch, caption);
        palette.append(figure);
      }
      card.append(title, description, palette);
      return card;
    });
    document.getElementById('drafts').replaceChildren(...cards);
    status.textContent = 'Three palette drafts loaded. In-game appearance has not been verified.';
  } catch (error) {
    status.textContent = `Could not load draft palettes: ${error.message}`;
  }
})();
