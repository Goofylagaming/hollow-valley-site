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
    const choices = document.getElementById('premium-draft-choices');
    if (choices) {
      let selected = 0;
      const sex = document.getElementById('premium-preview-sex');
      const buttons = [];
      const show = (index) => {
        selected = index;
        const entry = pack.skins[index];
        const detail = { name: entry.name, species: 'tyrannosaurus', sex: sex.value === 'female' ? 'female' : 'male', skin: { ...entry.colors } };
        window.__HV_STUDIO_PREVIEW = detail;
        document.getElementById('premium-preview-name').textContent = entry.name;
        buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
        document.dispatchEvent(new CustomEvent('hds:skin-preview-change', { detail }));
      };
      pack.skins.forEach((entry, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'hv-button';
        button.textContent = entry.name;
        button.addEventListener('click', () => show(index));
        buttons.push(button);
        choices.append(button);
      });
      sex.addEventListener('change', () => show(selected));
      show(0);
    }
    status.textContent = 'Three palette drafts loaded. In-game appearance has not been verified.';
  } catch (error) {
    status.textContent = `Could not load draft palettes: ${error.message}`;
  }
})();
