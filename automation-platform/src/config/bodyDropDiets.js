const DIET_VERSION = 'hollow-valley-2026-09-26-v2';
const DIET_SOURCE_UPDATED_AT = '2026-09-04';

const NUTRIENTS = {
  protein: { id: 'protein', label: 'Protein', symbol: 'β' },
  carbohydrate: { id: 'carbohydrate', label: 'Carbohydrate', symbol: 'α' },
  lipid: { id: 'lipid', label: 'Lipid', symbol: 'γ' },
};

// Clam is a current diet item, but the dedicated-server build still does not
// expose a verified pawn class that BodyDrop can safely turn into a corpse.
const UNSPAWNABLE_PREY = new Set(['Clam']);

const DIETS = {
  tyrannosaurus: {
    species: 'Tyrannosaurus',
    groups: {
      protein: ['Diabloceratops', 'Triceratops', 'Hypsilophodon', 'Deer', 'Chicken', 'Rabbit'],
      carbohydrate: ['Stegosaurus', 'Tenontosaurus', 'Pachycephalosaurus', 'Boar', 'Crab', 'Kentrosaurus'],
      lipid: ['Maiasaura', 'Gallimimus', 'Dryosaurus', 'Beipiaosaurus', 'Goat', 'Psittacosaurus', 'Sea Turtle'],
    },
  },
  allosaurus: {
    species: 'Allosaurus',
    groups: {
      protein: ['Diabloceratops', 'Triceratops', 'Deer'],
      carbohydrate: ['Stegosaurus', 'Tenontosaurus', 'Boar', 'Kentrosaurus'],
      lipid: ['Maiasaura', 'Dryosaurus', 'Goat'],
    },
  },
  austroraptor: {
    species: 'Austroraptor',
    groups: {
      protein: ['Bullfrog', 'Chicken', 'Rabbit', 'Deinosuchus', 'Hypsilophodon'],
      carbohydrate: ['Crab', 'Schooling Fish', 'Clam'],
      lipid: ['Beipiaosaurus', 'Elite Fish', 'Psittacosaurus', 'Sea Turtle'],
    },
  },
  carnotaurus: {
    species: 'Carnotaurus',
    groups: {
      protein: ['Omniraptor', 'Diabloceratops', 'Troodon', 'Deer'],
      carbohydrate: ['Pachycephalosaurus', 'Tenontosaurus', 'Herrerasaurus', 'Boar'],
      lipid: ['Dryosaurus', 'Gallimimus', 'Maiasaura'],
    },
  },
  ceratosaurus: {
    species: 'Ceratosaurus',
    groups: {
      protein: ['Carnotaurus', 'Deinosuchus', 'Omniraptor', 'Diabloceratops', 'Deer'],
      carbohydrate: ['Stegosaurus', 'Tenontosaurus', 'Pachycephalosaurus', 'Ceratosaurus', 'Kentrosaurus'],
      lipid: ['Dilophosaurus', 'Beipiaosaurus', 'Goat'],
    },
  },
  deinosuchus: {
    species: 'Deinosuchus',
    groups: {
      protein: ['Carnotaurus', 'Omniraptor', 'Diabloceratops', 'Deinosuchus', 'Troodon', 'Bullfrog'],
      carbohydrate: ['Stegosaurus', 'Tenontosaurus', 'Pachycephalosaurus', 'Ceratosaurus', 'Kentrosaurus'],
      lipid: ['Elite Fish', 'Gallimimus', 'Beipiaosaurus', 'Maiasaura', 'Sea Turtle'],
    },
  },
  dilophosaurus: {
    species: 'Dilophosaurus',
    groups: {
      protein: ['Diabloceratops', 'Carnotaurus', 'Hypsilophodon', 'Deer', 'Chicken'],
      carbohydrate: ['Boar', 'Tenontosaurus', 'Herrerasaurus', 'Ceratosaurus'],
      lipid: ['Gallimimus', 'Maiasaura', 'Goat', 'Sea Turtle', 'Dryosaurus'],
    },
  },
  herrerasaurus: {
    species: 'Herrerasaurus',
    groups: {
      protein: ['Bullfrog', 'Omniraptor', 'Hypsilophodon', 'Chicken'],
      carbohydrate: ['Crab', 'Schooling Fish', 'Tenontosaurus', 'Pachycephalosaurus', 'Boar'],
      lipid: ['Dryosaurus', 'Pteranodon', 'Beipiaosaurus', 'Goat', 'Sea Turtle', 'Gallimimus'],
    },
  },
  omniraptor: {
    species: 'Omniraptor',
    aliases: ['Omnoraptor'],
    groups: {
      protein: ['Carnotaurus', 'Diabloceratops', 'Troodon', 'Deer', 'Rabbit'],
      carbohydrate: ['Boar', 'Herrerasaurus', 'Pachycephalosaurus', 'Ceratosaurus', 'Stegosaurus', 'Kentrosaurus'],
      lipid: ['Dryosaurus', 'Psittacosaurus', 'Gallimimus', 'Maiasaura'],
    },
  },
  pteranodon: {
    species: 'Pteranodon',
    groups: {
      protein: ['Chicken', 'Hypsilophodon', 'Bullfrog', 'Rabbit', 'Troodon'],
      carbohydrate: ['Schooling Fish', 'Crab', 'Clam'],
      lipid: ['Sea Turtle', 'Psittacosaurus', 'Beipiaosaurus', 'Pterodactylus'],
    },
  },
  troodon: {
    species: 'Troodon',
    groups: {
      protein: ['Bullfrog', 'Chicken', 'Deer', 'Rabbit', 'Compsognathus', 'Hypsilophodon'],
      carbohydrate: ['Stegosaurus', 'Crab', 'Pachycephalosaurus', 'Tenontosaurus', 'Kentrosaurus'],
      lipid: ['Goat', 'Psittacosaurus', 'Dryosaurus', 'Pteranodon', 'Maiasaura'],
    },
  },
};

function normalizeSpecies(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function dietForSpecies(value) {
  const normalized = normalizeSpecies(value);
  if (!normalized) return null;
  for (const diet of Object.values(DIETS)) {
    const names = [diet.species, ...(diet.aliases || [])].map(normalizeSpecies);
    if (names.some((name) => normalized === name || normalized.includes(name))) return diet;
  }
  return null;
}

function scaleCorpseGrowth(requesterGrowth) {
  const raw = Number(requesterGrowth);
  if (!Number.isFinite(raw) || raw < 0) return null;
  const fraction = raw > 1 ? raw / 100 : raw;
  return Math.round(Math.max(0.15, Math.min(0.40, fraction * 0.75)) * 1000) / 1000;
}

function optionId(nutrient, species) {
  return `${nutrient}-${normalizeSpecies(species)}`;
}

function optionsForSpecies(requesterSpecies, requesterGrowth) {
  const diet = dietForSpecies(requesterSpecies);
  if (!diet) return [];
  const growth = scaleCorpseGrowth(requesterGrowth);
  return Object.entries(diet.groups).flatMap(([nutrient, speciesList]) => {
    const meta = NUTRIENTS[nutrient];
    return speciesList.map((species) => ({
      id: optionId(nutrient, species),
      nutrient,
      nutrientLabel: meta?.label || nutrient,
      nutrientSymbol: meta?.symbol || '',
      species,
      name: species,
      available: !UNSPAWNABLE_PREY.has(species),
      unavailableReason: UNSPAWNABLE_PREY.has(species)
        ? `${species} is in the live diet but does not have a verified BodyDrop pawn class yet.`
        : null,
      description: `${meta?.label || nutrient} diet body`,
      growth,
      growthPercent: growth === null ? null : Math.round(growth * 100),
    }));
  });
}

function catalog() {
  return Object.values(DIETS).map((diet) => ({
    species: diet.species,
    aliases: diet.aliases || [],
    groups: Object.fromEntries(Object.entries(diet.groups).map(([nutrient, species]) => [
      nutrient,
      { ...NUTRIENTS[nutrient], species: [...species] },
    ])),
  }));
}

module.exports = {
  DIET_VERSION,
  DIET_SOURCE_UPDATED_AT,
  NUTRIENTS,
  DIETS,
  UNSPAWNABLE_PREY,
  normalizeSpecies,
  dietForSpecies,
  scaleCorpseGrowth,
  optionId,
  optionsForSpecies,
  catalog,
};
