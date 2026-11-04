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
      const entries = window.HVRexCalibration ? [...pack.skins, window.HVRexCalibration.reference] : pack.skins;
      const sex = document.getElementById('premium-preview-sex');
      const buttons = [];
      const calibration=window.HVRexCalibration;
      const pattern=document.getElementById('premium-pattern');
      const variation=document.getElementById('premium-variation');
      const diagnostic=document.getElementById('premium-diagnostic');
      const code=document.getElementById('premium-game-code');
      const show = (index) => {
        selected = index;
        const entry = entries[index];
        const detail = { patternIndex:Number(pattern?.value||0), skinVariation:Number(variation?.value||0), themeIndex:0, name: entry.name, species: 'tyrannosaurus', sex: sex.value === 'female' ? 'female' : 'male', colorSpace: entry.colorSpace || 'native-linear', skin: { ...entry.colors } };
        if(diagnostic && diagnostic.value!=='off'){
          if(diagnostic.value!=='all'&&!calibration.patterns[detail.patternIndex].channels.includes(diagnostic.value))diagnostic.value='all';
          detail.skin=calibration.diagnostic(detail.patternIndex,diagnostic.value);detail.colorSpace='srgb';
        }
        if(code)code.value=calibration.gameCode(detail);
        window.__HV_STUDIO_PREVIEW = detail;
        document.getElementById('premium-preview-name').textContent = entry.name;
        buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
        document.dispatchEvent(new CustomEvent('hds:skin-preview-change', { detail }));
      };
      entries.forEach((entry, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'hv-button';
        button.textContent = entry.name;
        button.addEventListener('click', () => {
          if(pattern)pattern.value=String(entry.patternIndex||0);
          if(variation)variation.value=String(entry.skinVariation||0);
          if(diagnostic)diagnostic.value='off';
          show(index);
        });
        buttons.push(button);
        choices.append(button);
      });
      for(const control of [pattern,variation,diagnostic])control?.addEventListener('change',()=>show(selected));
      sex.addEventListener('change', () => show(selected));
      show(0);
    }
    status.textContent = 'Three palette drafts loaded. In-game appearance has not been verified.';
  } catch (error) {
    status.textContent = `Could not load draft palettes: ${error.message}`;
  }
})();
