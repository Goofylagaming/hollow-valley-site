/* Hollow Valley Skin Studio: provisional, geometry-based UV colour-zone proposals.
 * No external libraries, source mesh distribution or network access required.
 * This is NOT an EVRIMA texture or pattern extractor. All suggestions are unverified.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HVSkinAutoMap = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ZONES = Object.freeze([
    'body', 'markings', 'flank', 'underbelly', 'detail1',
    'eyes', 'teeth', 'mouth', 'claws', 'maleDisplay',
  ]);
  const MAX_FACES = 160000;
  const MAX_RASTER_BOX = 65536;

  function wrap(value) {
    return ((value % 1) + 1) % 1;
  }

  function unwrapTriangle(values) {
    const out = values.map(wrap);
    const lo = Math.min(...out), hi = Math.max(...out);
    return hi - lo > 0.5 ? out.map(value => value < 0.5 ? value + 1 : value) : out;
  }

  function edge(ax, ay, bx, by, px, py) {
    return (px - ax) * (by - ay) - (py - ay) * (bx - ax);
  }

  function materialZone(name) {
    const material = String(name || '').toLowerCase();
    if (/(^|[^a-z])eyes?([^a-z]|$)/.test(material)) return 6;
    if (/(^|[^a-z])(teeth|tooth|fangs?)([^a-z]|$)/.test(material)) return 7;
    if (/(^|[^a-z])(mouth|tongue)([^a-z]|$)/.test(material)) return 8;
    if (/(^|[^a-z])(claws?|nails?)([^a-z]|$)/.test(material)) return 9;
    return 0;
  }

  function geometryZone(x, y, normalX, normalY, bounds) {
    const height = Math.max(1e-6, bounds.maxY - bounds.minY);
    const width = Math.max(1e-6, bounds.maxX - bounds.minX);
    const relativeHeight = (y - bounds.minY) / height;
    const lateralDistance = Math.abs(x - (bounds.minX + bounds.maxX) / 2) / (width / 2);
    // Upward normals: the dorsal stripe is a useful *suggestion* for markings,
    // not an EVRIMA pattern. Downward-facing surfaces are underbelly candidates.
    if (normalY < -0.26 && relativeHeight < 0.76) return 4;
    if (Math.abs(normalX) > 0.46 && relativeHeight < 0.87 && normalY < 0.5) return 3;
    if (normalY > 0.44 && relativeHeight > 0.56 && lateralDistance < 0.43) return 2;
    return 1;
  }

  function generate({ meshes, size = 256, flipV = false } = {}) {
    if (!Number.isInteger(size) || size < 16 || size > 256 || (size & (size - 1)) !== 0) {
      throw new Error('Auto-map UV atlas size must be 16, 32, 64, 128 or 256.');
    }
    if (!Array.isArray(meshes) || !meshes.length || meshes.length > 200) {
      throw new Error('Load a valid 3D dinosaur model with UV coordinates before auto-mapping.');
    }

    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    let faceLimit = 0;
    for (const mesh of meshes) {
      if (!mesh || !mesh.positions || !mesh.uvs || mesh.positions.length % 3 !== 0 || mesh.uvs.length * 3 !== mesh.positions.length * 2) {
        throw new Error('Auto-map needs matching mesh positions and primary UV coordinates.');
      }
      const position = mesh.positions;
      for (let v = 0; v < position.length; v += 3) {
        const x = position[v], y = position[v + 1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Mesh contains non-finite geometry.');
        if (x < bounds.minX) bounds.minX = x;
        if (x > bounds.maxX) bounds.maxX = x;
        if (y < bounds.minY) bounds.minY = y;
        if (y > bounds.maxY) bounds.maxY = y;
      }
      faceLimit += Math.floor((mesh.indices ? mesh.indices.length : position.length / 3) / 3);
    }
    if (faceLimit > MAX_FACES) throw new Error('Model is too detailed for automatic browser UV mapping.');

    const total = size * size;
    const votes = new Uint16Array(total * ZONES.length);
    const touched = new Uint8Array(total);
    let faces = 0;
    let rejected = 0;
    let samples = 0;

    for (const mesh of meshes) {
      const pos = mesh.positions, uv = mesh.uvs;
      const indices = mesh.indices;
      const vertexCount = pos.length / 3;
      const elementCount = indices ? indices.length : vertexCount;
      const groups = Array.isArray(mesh.groups) && mesh.groups.length
        ? mesh.groups : [{ start: 0, count: elementCount, materialName: mesh.materialName || '' }];

      for (const group of groups) {
        const role = materialZone(group.materialName || mesh.materialName);
        // PSK-derived eyes use independent materials but often re-use almost
        // the entire Body UV atlas. Never let their UV votes repaint the body.
        // Calibrated preview colours dedicated eye material separately.
        if (role) continue;
        const start = Math.max(0, Math.floor(Number(group.start) || 0));
        const end = Math.min(elementCount, start + Math.max(0, Math.floor(Number(group.count) || 0)));
        for (let base = start; base + 2 < end; base += 3) {
          const a = indices ? indices[base] : base;
          const b = indices ? indices[base + 1] : base + 1;
          const c = indices ? indices[base + 2] : base + 2;
          if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c) ||
              Math.min(a, b, c) < 0 || Math.max(a, b, c) >= vertexCount) { rejected++; continue; }
          const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
          const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
          const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
          const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
          const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
          let nx = e1y * e2z - e1z * e2y;
          let ny = e1z * e2x - e1x * e2z;
          const nz = e1x * e2y - e1y * e2x;
          const length = Math.hypot(nx, ny, nz);
          if (!Number.isFinite(length) || length < 1e-10) { rejected++; continue; }
          nx /= length; ny /= length;
          const u = unwrapTriangle([uv[a * 2], uv[b * 2], uv[c * 2]]);
          const v = unwrapTriangle([uv[a * 2 + 1], uv[b * 2 + 1], uv[c * 2 + 1]]);
          if (![...u, ...v].every(Number.isFinite)) { rejected++; continue; }
          const signedArea = edge(u[0], v[0], u[1], v[1], u[2], v[2]);
          if (Math.abs(signedArea) < 1e-12) { rejected++; continue; }
          const minPx = Math.max(0, Math.floor(Math.min(...u) * size) - 1);
          const maxPx = Math.min(size * 2, Math.ceil(Math.max(...u) * size) + 1);
          const minPy = Math.max(0, Math.floor(Math.min(...v) * size) - 1);
          const maxPy = Math.min(size * 2, Math.ceil(Math.max(...v) * size) + 1);
          if ((maxPx - minPx + 1) * (maxPy - minPy + 1) > MAX_RASTER_BOX) { rejected++; continue; }
          faces++;
          for (let py = minPy; py <= maxPy; py++) {
            const sv = (py + 0.5) / size;
            for (let px = minPx; px <= maxPx; px++) {
              const su = (px + 0.5) / size;
              const w0 = edge(u[1], v[1], u[2], v[2], su, sv) / signedArea;
              const w1 = edge(u[2], v[2], u[0], v[0], su, sv) / signedArea;
              const w2 = 1 - w0 - w1;
              if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
              const x = ax * w0 + bx * w1 + cx * w2;
              const y = ay * w0 + by * w1 + cy * w2;
              const zone = geometryZone(x, y, nx, ny, bounds);
              const tx = px % size;
              const ty = flipV ? size - 1 - (py % size) : py % size;
              const pixel = ty * size + tx;
              const offset = pixel * ZONES.length + zone - 1;
              votes[offset] = Math.min(65535, votes[offset] + 1);
              touched[pixel] = 1;
              samples++;
            }
          }
        }
      }
    }

    const lookup = new Uint8Array(total);
    const counts = Object.fromEntries(ZONES.map(key => [key, 0]));
    let coveredPixels = 0;
    let ambiguousPixels = 0;
    for (let pixel = 0; pixel < total; pixel++) {
      if (!touched[pixel]) continue;
      let winner = 1, high = 0, all = 0;
      for (let zone = 0; zone < ZONES.length; zone++) {
        const score = votes[pixel * ZONES.length + zone];
        if (score > high) { winner = zone + 1; high = score; }
        all += score;
      }
      if (high <= 0) continue;
      lookup[pixel] = winner;
      counts[ZONES[winner - 1]]++;
      if (all - high > 0) ambiguousPixels++;
      coveredPixels++;
    }
    return { lookup, size, counts, coveredPixels, ambiguousPixels, faces, rejected, samples, verified: false };
  }

  return Object.freeze({ ZONES, generate, materialZone, geometryZone });
});
