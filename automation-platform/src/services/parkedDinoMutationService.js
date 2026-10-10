const dinoStorage = require('./dinoStorageService');

const SLOT_KEYS = Object.freeze(['Slot1', 'Slot2', 'Slot3', 'Slot4']);

// Website eligibility policy: this is not a game-derived, per-patch mutation table.
// Keep unknown species fail-closed rather than granting all mutations to them.
// DinoStorage normalizes the stored BP_ class path into state.species.
const SPECIES_DIETS = Object.freeze({
  tyrannosaurus: 'carnivore',
  allosaurus: 'carnivore',
  austroraptor: 'carnivore',
  carnotaurus: 'carnivore',
  ceratosaurus: 'carnivore',
  deinosuchus: 'carnivore',
  dilophosaurus: 'carnivore',
  herrerasaurus: 'carnivore',
  omniraptor: 'carnivore',
  pteranodon: 'carnivore',
  troodon: 'carnivore',
  diabloceratops: 'herbivore',
  dryosaurus: 'herbivore',
  hypsilophodon: 'herbivore',
  kentrosaurus: 'herbivore',
  maiasaura: 'herbivore',
  pachycephalosaurus: 'herbivore',
  stegosaurus: 'herbivore',
  tenontosaurus: 'herbivore',
  triceratops: 'herbivore',
  beipiaosaurus: 'omnivore',
  gallimimus: 'omnivore',
});

// Restrict only documented diet-specific mutations. All other catalog entries
// retain their existing slot/sex policy pending a versioned per-species audit.
const MUTATION_DIETS = Object.freeze({
  'Accelerated Prey Drive': ['carnivore'],
  'Augmented Tapetum': ['carnivore'],
  'Cannibalistic': ['carnivore'],
  'Hematophagy': ['carnivore'],
  'Hemomania': ['carnivore'],
  'Hypermetabolic Inanition': ['carnivore'],
  'Osteophagic': ['carnivore'],
  'Barometric Sensitivity': ['herbivore'],
  'Hypervigilance': ['herbivore'],
  'Photosynthetic Regeneration': ['herbivore'],
  'Tactile Endurance': ['herbivore'],
  'Truculency': ['herbivore'],
  'Xerocole Adaptation': ['herbivore'],
  'Social Behavior': ['herbivore', 'omnivore'],
});

// Species with innate cannibalism do not need/cannot select this mutation.
const MUTATION_SPECIES_EXCLUSIONS = Object.freeze({
  Cannibalistic: ['ceratosaurus', 'deinosuchus'],
});

function speciesContext(state) {
  const raw = String(state?.species || '').trim();
  const fromPath = /BP_([A-Za-z]+)(?:_C)?(?:\.|$)/i.exec(String(state?.classPath || ''))?.[1];
  const species = raw && raw.toLowerCase() !== 'unknown' ? raw : (fromPath || '');
  const speciesKey = species.toLowerCase().replace(/[^a-z]/g, '');
  return { species, speciesKey, diet: SPECIES_DIETS[speciesKey] || null };
}

function mutationAllowedForSpecies(name, { speciesKey, diet } = {}) {
  if (!name) return true;
  if (!diet || !speciesKey) return false;
  const allowedDiets = MUTATION_DIETS[name];
  if (allowedDiets && !allowedDiets.includes(diet)) return false;
  if (MUTATION_SPECIES_EXCLUSIONS[name]?.includes(speciesKey)) return false;
  return true;
}

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

function mutationAllowedInSlot(name, slotKey, context = {}) {
  if (!name) return true;
  if (!mutationAllowedForSpecies(name, context)) return false;
  const rules = MUTATION_RULES[name] || {};
  if (Array.isArray(rules.slots) && !rules.slots.includes(slotKey)) return false;
  if (rules.femaleOnly && context.isFemale !== true) return false;
  return true;
}

function normalizeSlots(input = {}, context = {}) {
  // Never write to an unrecognised dinosaur; otherwise slot checks alone
  // would permit a carnivore to receive herbivore-only mutations.
  if (!context.diet || !context.speciesKey) {
    const error = new Error('Cannot edit mutations: this dinosaur species is not recognised');
    error.code = 'MUTATION_SPECIES_UNKNOWN';
    throw error;
  }
  const result = {};
  for (const key of SLOT_KEYS) {
    const value = normalizeMutation(input?.[key]);
    if (value && !mutationAllowedInSlot(value, key, context)) {
      const rules = MUTATION_RULES[value] || {};
      const reason = !mutationAllowedForSpecies(value, context)
        ? `${value} is not available for ${context.species} (${context.diet})`
        : rules.femaleOnly && context.isFemale !== true
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
  const species = speciesContext(state);
  const context = { ...species, isFemale };
  return {
    slot,
    species: species.species || 'Unknown',
    diet: species.diet,
    mutations: Object.fromEntries(SLOT_KEYS.map((key) => [key, mutations[key] || ''])),
    catalog: MUTATION_CATALOG.filter((name) => mutationAllowedForSpecies(name, context)),
    slotCatalog: Object.fromEntries(SLOT_KEYS.map((key) => [
      key,
      MUTATION_CATALOG.filter((name) => mutationAllowedInSlot(name, key, context)),
    ])),
    isFemale,
    writeEnabled: writeEnabled() && Boolean(species.diet),
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
  const nextSlots = normalizeSlots(mutations, { ...speciesContext(state), isFemale: state?.isFemale === true });

  await dinoStorage.editStoredDino({
    steamId: steam,
    slot: selectedSlot,
    mode: 'mutations',
    values: nextSlots,
  });

  const updated = {
    ...state,
    mutations: {
      ...(state.mutations && typeof state.mutations === 'object' ? state.mutations : {}),
      ...nextSlots,
    },
  };
  return editorState(updated, selectedSlot);
}

module.exports = {
  SLOT_KEYS,
  MUTATION_RULES,
  MUTATION_CATALOG,
  SPECIES_DIETS,
  MUTATION_DIETS,
  speciesContext,
  mutationAllowedForSpecies,
  writeEnabled,
  normalizeMutation,
  mutationAllowedInSlot,
  normalizeSlots,
  editorState,
  getMutationEditor,
  updateMutations,
};
