const files = require('./parkedDinoFileService');

const SLOT_KEYS = Object.freeze(['Slot1', 'Slot2', 'Slot3', 'Slot4']);

const MUTATION_CATALOG = Object.freeze([
  'Accelerated Prey Drive',
  'Advanced Gestation',
  'Augmented Tapetum',
  'Barometric Sensitivity',
  'Cannibalistic',
  'Cellular Regeneration',
  'Congenital Hypoalgesia',
  'Efficient Digestion',
  'Enhanced Digestion',
  'Enlarged Meniscus',
  'Epidermal Fibrosis',
  'Featherweight',
  'Gastronomic Regeneration',
  'Hematophagy',
  'Hemomania',
  'Heightened Ghrelin',
  'Hydrodynamic',
  'Hydroregenerative',
  'Hypermetabolic Inanition',
  'Hypervigilance',
  'Increased Inspiratory Capacity',
  'Infrasound Communication',
  'Multichambered Lungs',
  'Nocturnal',
  'Osteophagic',
  'Osteosclerosis',
  'Photosynthetic Regeneration',
  'Photosynthetic Tissue',
  'Prolific Reproduction',
  'Reabsorption',
  'Reinforced Tendons',
  'Reniculate Kidneys',
  'Social Behavior',
  'Submerged Optical Retention',
  'Sustained Hydration',
  'Tactile Endurance',
  'Traumatic Thrombosis',
  'Truculency',
  'Wader',
  'Xerocole Adaptation',
]);

const CATALOG_BY_KEY = new Map(MUTATION_CATALOG.map((name) => [name.toLowerCase(), name]));

function writeEnabled() {
  return String(process.env.PARKED_DINO_EDIT_ENABLED || '').toLowerCase() === 'true';
}

function normalizeMutation(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.toLowerCase() === 'none') return '';
  const canonical = CATALOG_BY_KEY.get(raw.toLowerCase());
  if (!canonical) {
    const error = new Error(`Unknown or unsupported mutation: ${raw}`);
    error.code = 'MUTATION_NOT_ALLOWED';
    throw error;
  }
  return canonical;
}

function normalizeSlots(input = {}) {
  const result = {};
  for (const key of SLOT_KEYS) result[key] = normalizeMutation(input?.[key]);
  const chosen = SLOT_KEYS.map((key) => result[key]).filter(Boolean);
  if (new Set(chosen.map((name) => name.toLowerCase())).size !== chosen.length) {
    const error = new Error('The same mutation cannot be equipped in more than one active slot');
    error.code = 'DUPLICATE_MUTATION';
    throw error;
  }
  return result;
}

function editorState(state, slot) {
  const mutations = state?.mutations && typeof state.mutations === 'object' ? state.mutations : {};
  return {
    slot,
    mutations: Object.fromEntries(SLOT_KEYS.map((key) => [key, mutations[key] || ''])),
    catalog: [...MUTATION_CATALOG],
    writeEnabled: writeEnabled(),
  };
}

async function getMutationEditor(steamId, slot) {
  const steam = files.validateSteamId(steamId);
  const selectedSlot = files.validateSlot(slot);
  const state = await files.readStoredDino(steam, selectedSlot);
  return editorState(state, selectedSlot);
}

async function updateMutations({ steamId, slot, mutations }) {
  if (!writeEnabled()) {
    const error = new Error('Parked dinosaur mutation editing is disabled');
    error.code = 'PARKED_DINO_EDIT_DISABLED';
    throw error;
  }

  const steam = files.validateSteamId(steamId);
  const selectedSlot = files.validateSlot(slot);
  const nextSlots = normalizeSlots(mutations);

  const updated = await files.updateStoredDino(steam, selectedSlot, (state) => {
    if (!state.mutations || typeof state.mutations !== 'object' || Array.isArray(state.mutations)) {
      state.mutations = {};
    }
    for (const key of SLOT_KEYS) state.mutations[key] = nextSlots[key];
    state.websiteEdits = {
      ...(state.websiteEdits && typeof state.websiteEdits === 'object' ? state.websiteEdits : {}),
      mutationsEditedAt: new Date().toISOString(),
    };
    return state;
  });

  return editorState(updated, selectedSlot);
}

module.exports = {
  SLOT_KEYS,
  MUTATION_CATALOG,
  writeEnabled,
  normalizeMutation,
  normalizeSlots,
  editorState,
  getMutationEditor,
  updateMutations,
};
