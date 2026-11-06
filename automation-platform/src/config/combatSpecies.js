// Canonical names from the website species catalog. Unknown labels do not
// contribute to permanent achievements; expand this registry deliberately.
const species = new Set([
  'tyrannosaurus', 'allosaurus', 'carnotaurus', 'ceratosaurus', 'deinosuchus',
  'dilophosaurus', 'herrerasaurus', 'omniraptor', 'troodon', 'pteranodon',
  'diabloceratops', 'dryosaurus', 'tenontosaurus', 'maiasaura',
  'pachycephalosaurus', 'stegosaurus', 'triceratops', 'deinocheirus',
  'gallimimus', 'hypsilophodon', 'beipiaosaurus',
]);
function canonicalCombatSpecies(value) {
  if (typeof value !== 'string' || value.length > 100) return null;
  const key = value.trim().toLowerCase().replace(/^bp_/, '').replace(/_c$/, '');
  return species.has(key) ? key : null;
}
module.exports = { canonicalCombatSpecies };
