const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Produce a review document. Runtime catalog registration requires explicit
// region, category, visit radius and version decisions after review.
function buildCandidates(source, bounds) {
  const candidates = new Map();
  const rejected = [];
  for (const layer of ['water', 'land', 'caves']) {
    for (const point of source[layer] || []) {
      const x = point.lat * 1000;
      const y = point.long * 1000;
      if (typeof point.lat !== 'number' || typeof point.long !== 'number' ||
          !Number.isFinite(x) || !Number.isFinite(y) || x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY ||
          typeof point.name !== 'string' || !point.name.trim()) {
        rejected.push({ layer, name: point.name || null, reason: 'Invalid source name or coordinates' });
        continue;
      }
      const identity = JSON.stringify([layer, point.name, x, y]);
      const id = 'candidate-' + createHash('sha256').update(identity).digest('hex').slice(0, 24);
      candidates.set(id, {
        id, name: point.name, sourceLayer: layer, x, y, enabled: false,
        category: layer === 'caves' ? 'cave' : null,
        regionId: null, radiusMetres: null,
        reviewRequired: ['Verify in-game location and accessibility', 'Assign catalog region', 'Define visit area', ...(layer === 'caves' ? [] : ['Confirm discovery category'])]
      });
    }
  }
  return {
    format: 'discovery-candidate-review-v1',
    bounds,
    candidates: [...candidates.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    rejected
  };
}

if (require.main === module) {
  const input = path.join(__dirname, '../public/assets/map-data.json');
  const raw = fs.readFileSync(input);
  const source = JSON.parse(raw);
  const result = buildCandidates(source, require('../server/evrimaMap').BOUNDS);
  result.source = { path: 'public/assets/map-data.json', sha256: createHash('sha256').update(raw).digest('hex'), map: source.map, attribution: source.attribution, generated: source.generated };
  fs.writeFileSync(path.join(__dirname, '../docs/HV_DISCOVERY_CANDIDATES.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`Prepared ${result.candidates.length} disabled discovery candidates; ${result.rejected.length} rejected source points.`);
}
module.exports = { buildCandidates };
