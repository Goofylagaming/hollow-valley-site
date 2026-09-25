const DIET_VERSION = '2026-09-26-v3';

const NUTRIENTS = {
  protein: { id: 'protein', label: 'Protein', symbol: 'S' },
  carbohydrate: { id: 'carbohydrate', label: 'Carbohydrate', symbol: '∴' },
  lipid: { id: 'lipid', label: 'Lipid', symbol: '//' },
};

const DIETS = {
  tyrannosaurus: {
    species: 'Tyrannosaurus',
    groups: {
      protein: ['Stegosaurus', 'Tenontosaurus', 'Pachycephalosaurus'],
      carbohydrate: ['Diabloceratops', 'Triceratops', 'Hypsilophodon'],
      lipid: ['Maiasaura', 'Gallimimus', 'Dryosaurus', 'Beipiaosaurus'],
    },
    emergency: ['lipid', 'Dryosaurus'],
  },
  allosaurus: {
    species: 'Allosaurus',
    groups: {
      protein: ['Stegosaurus', 'Tenontosaurus'],
      carbohydrate: ['Diabloceratops', 'Triceratops'],
      lipid: ['Maiasaura', 'Dryosaurus'],
    },
    emergency: ['lipid', 'Dryosaurus'],
  },
  austroraptor: {
    species: 'Austroraptor',
    groups: {
      protein: ['Deinosuchus', 'Hypsilophodon'],
      carbohydrate: [],
      lipid: ['Beipiaosaurus'],
    },
    emergency: ['protein', 'Hypsilophodon'],
  },
  carnotaurus: {
    species: 'Carnotaurus',
    groups: {
      protein: ['Pachycephalosaurus', 'Tenontosaurus', 'Herrerasaurus'],
      carbohydrate: ['Omniraptor', 'Diabloceratops', 'Troodon'],
      lipid: ['Dryosaurus', 'Gallimimus', 'Dilophosaurus'],
    },
    emergency: ['protein', 'Herrerasaurus'],
  },
  ceratosaurus: {
    species: 'Ceratosaurus',
    groups: {
      protein: ['Tenontosaurus', 'Pachycephalosaurus', 'Ceratosaurus'],
      carbohydrate: ['Carnotaurus', 'Deinosuchus', 'Omniraptor', 'Diabloceratops'],
      lipid: ['Dilophosaurus', 'Stegosaurus', 'Beipiaosaurus'],
    },
    emergency: ['carbohydrate', 'Omniraptor'],
  },
  deinosuchus: {
    species: 'Deinosuchus',
    groups: {
      protein: ['Tenontosaurus', 'Pachycephalosaurus', 'Ceratosaurus'],
      carbohydrate: ['Carnotaurus', 'Omniraptor', 'Diabloceratops', 'Deinosuchus', 'Troodon'],
      lipid: ['Gallimimus', 'Stegosaurus', 'Beipiaosaurus', 'Maiasaura'],
    },
    emergency: ['lipid', 'Beipiaosaurus'],
  },
  dilophosaurus: {
    species: 'Dilophosaurus',
    groups: {
      protein: ['Tenontosaurus', 'Herrerasaurus', 'Ceratosaurus'],
      carbohydrate: ['Diabloceratops', 'Carnotaurus', 'Hypsilophodon'],
      lipid: ['Gallimimus', 'Maiasaura', 'Dryosaurus'],
    },
    emergency: ['lipid', 'Dryosaurus'],
  },
  herrerasaurus: {
    species: 'Herrerasaurus',
    groups: {
      protein: ['Tenontosaurus', 'Pachycephalosaurus'],
      carbohydrate: ['Omniraptor', 'Hypsilophodon'],
      lipid: ['Dryosaurus', 'Pteranodon', 'Beipiaosaurus', 'Gallimimus'],
    },
    emergency: ['lipid', 'Dryosaurus'],
  },
  omniraptor: {
    species: 'Omniraptor',
    aliases: ['Omnoraptor'],
    groups: {
      protein: ['Herrerasaurus', 'Pachycephalosaurus', 'Ceratosaurus'],
      carbohydrate: ['Carnotaurus', 'Diabloceratops', 'Troodon'],
      lipid: ['Dryosaurus', 'Gallimimus', 'Stegosaurus'],
    },
    emergency: ['protein', 'Herrerasaurus'],
  },
  troodon: {
    species: 'Troodon',
    groups: {
      protein: ['Tenontosaurus', 'Herrerasaurus'],
      carbohydrate: ['Compsognathus', 'Hypsilophodon', 'Omniraptor'],
      lipid: ['Dryosaurus', 'Pteranodon'],
    },
    emergency: ['carbohydrate', 'Hypsilophodon'],
  },
  pteranodon: {
    species: 'Pteranodon',
    groups: {
      protein: [],
      carbohydrate: ['Hypsilophodon', 'Troodon'],
      lipid: ['Beipiaosaurus', 'Pteranodon'],
    },
    emergency: ['carbohydrate', 'Hypsilophodon'],
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
      description: `${meta?.label || nutrient} diet body`,
      growth,
      growthPercent: growth === null ? null : Math.round(growth * 100),
    }));
  });
}

function emergencyOptionForSpecies(requesterSpecies, requesterGrowth) {
  const diet = dietForSpecies(requesterSpecies);
  if (!diet?.emergency) return null;
  const [nutrient, species] = diet.emergency;
  return optionsForSpecies(requesterSpecies, requesterGrowth)
    .find((option) => option.nutrient === nutrient && option.species === species) || null;
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
  NUTRIENTS,
  DIETS,
  normalizeSpecies,
  dietForSpecies,
  scaleCorpseGrowth,
  optionId,
  optionsForSpecies,
  emergencyOptionForSpecies,
  catalog,
};
