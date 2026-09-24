const dinoStorage = require('./dinoStorageService');

const SLOT_KEYS = Object.freeze(['Slot1', 'Slot2', 'Slot3', 'Slot4']);

const MUTATION_RULES = Object.freeze({
  'Advanced Gestation': { femaleOnly: true },
  'Gastronomic Regeneration': { slots: ['Slot2', 'Slot4'] },
  'Tactile Endurance': { slots: ['Slot2', 'Slot4'] },
  'Cannibalistic': { slots: ['Slot2', 'Slot4'] },
  'Hypermetabolic Inanition': { slots: ['Slot2', 'Slot4'] },
  'Enhanced Digestion': { slots: ['Slot2', 'Slot3'] },
  'Heightened Ghrelin': { slots: ['Slot2'] },
  'Multichambered Lungs': { slots: ['Slot2', 'Slot3'] },
  'Reniculate Kidneys': { slots: ['Slot2', 'Slot3'] },
  'Augmented Tapetum': { slots: ['Slot2'] },
  'Parthenogenesis': { slots: ['Slot2'], femaleOnly: true },
  'Prolific Reproduction': { slots: ['Slot2'], femaleOnly: true },
});

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
  'Parthenogenesis',
  'Prolific Reproduction',
  'Reabsorption',
  'Reinforced Tendons',
  'Reniculate Kidneys',
  'Sequential Hermaphroditism',
  'Social Behavior',
  'Submerged Optical Retention',
  'Sustained Hydration',
  'Tactile Endurance',
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

function mutationAllowedInSlot(name, slotKey, { isFemale = null } = {}) {
  if (!name) return true;
  const rules = MUTATION_RULES[name] || {};
  if (Array.isArray(rules.slots) && !rules.slots.includes(slotKey)) return false;
  if (rules.femaleOnly && isFemale !== true) return false;
  return true;
}

function normalizeSlots(input = {}, { isFemale = null } = {}) {
  const result = {};
  for (const key of SLOT_KEYS) {
    const value = normalizeMutation(input?.[key]);
    if (value && !mutationAllowedInSlot(value, key, { isFemale })) {
      const rules = MUTATION_RULES[value] || {};
      const reason = rules.femaleOnly && isFemale !== true
        ? `${value} is female-only`
        : `${value} cannot be equipped in ${key}`;
      const error = new Error(reason);
      error.code = 'MUTATION_SLOT_NOT_ALLOWED';
      throw error;
    }
    result[key] = value;
  }
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
  const isFemale = state?.isFemale === true ? true : state?.isFemale === false ? false : null;
  return {
    slot,
    mutations: Object.fromEntries(SLOT_KEYS.map((key) => [key, mutations[key] || ''])),
    catalog: [...MUTATION_CATALOG],
    slotCatalog: Object.fromEntries(SLOT_KEYS.map((key) => [
      key,
      MUTATION_CATALOG.filter((name) => mutationAllowedInSlot(name, key, { isFemale })),
    ])),
    isFemale,
    writeEnabled: writeEnabled(),
  };
}

async function getMutationEditor(steamId, slot) {
  const steam = dinoStorage.validateSteamId(steamId);
  const selectedSlot = dinoStorage.validateSlot(slot);
  const state = await dinoStorage.getStoredDino(steam, selectedSlot);
  return editorState(state, selectedSlot);
}

async function updateMutations({ steamId, slot, mutations }) {
  if (!writeEnabled()) {
    const error = new Error('Parked dinosaur mutation editing is disabled');
    error.code = 'PARKED_DINO_EDIT_DISABLED';
    throw error;
  }

  const steam = dinoStorage.validateSteamId(steamId);
  const selectedSlot = dinoStorage.validateSlot(slot);
  const state = await dinoStorage.getStoredDino(steam, selectedSlot);
  const nextSlots = normalizeSlots(mutations, { isFemale: state?.isFemale === true });

  await dinoStorage.editStoredDino({
    steamId: steam,
    slot: selectedSlot,
    mode: 'mutations',
    values: nextSlots,
  });

  const updated = await dinoStorage.getStoredDino(steam, selectedSlot);
  return editorState(updated, selectedSlot);
}

module.exports = {
  SLOT_KEYS,
  MUTATION_RULES,
  MUTATION_CATALOG,
  writeEnabled,
  normalizeMutation,
  mutationAllowedInSlot,
  normalizeSlots,
  editorState,
  getMutationEditor,
  updateMutations,
};
