// Renders the generated map data to a standalone SVG so the inferred
// coastline can be eyeballed before it goes near the site.
const fs = require("node:fs");
const path = require("node:path");

const data = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "public", "assets", "map-data.json"), "utf8")
);
const B = data.bounds;
const SIZE = 900;

const X = (long) => ((long - B.minY) / (B.maxY - B.minY)) * SIZE;
const Y = (lat) => ((lat - B.minX) / (B.maxX - B.minX)) * SIZE;

const parts = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`,
  `<rect width="${SIZE}" height="${SIZE}" fill="#0d1b2a"/>`,
];

for (const ring of data.islands) {
  const d = ring.map((p, i) => `${i ? "L" : "M"}${X(p.long).toFixed(1)} ${Y(p.lat).toFixed(1)}`).join("");
  parts.push(`<path d="${d}Z" fill="#2f4a2c" stroke="#d8a928" stroke-width="1.5"/>`);
}

for (const road of data.roads) {
  const d = road.points.map((p, i) => `${i ? "L" : "M"}${X(p.long).toFixed(1)} ${Y(p.lat).toFixed(1)}`).join("");
  parts.push(`<path d="${d}" fill="none" stroke="${road.trail ? "#8a7a5c" : "#c9a86c"}" stroke-width="${road.trail ? 0.8 : 1.4}" opacity="0.9"/>`);
}

for (const w of data.water) {
  parts.push(`<circle cx="${X(w.long).toFixed(1)}" cy="${Y(w.lat).toFixed(1)}" r="3" fill="#4a90d9"/>`);
}
for (const l of data.land) {
  parts.push(`<circle cx="${X(l.long).toFixed(1)}" cy="${Y(l.lat).toFixed(1)}" r="2.5" fill="#d8a928"/>`);
}
for (const c of data.caves) {
  parts.push(`<circle cx="${X(c.long).toFixed(1)}" cy="${Y(c.lat).toFixed(1)}" r="2" fill="#c4553a"/>`);
}
for (const a of data.areas) {
  parts.push(
    `<text x="${X(a.long).toFixed(1)}" y="${Y(a.lat).toFixed(1)}" fill="#fff" font-size="11" font-family="sans-serif" text-anchor="middle">${a.name.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`
  );
}

parts.push("</svg>");
const out = path.join(__dirname, "..", "map-preview.svg");
fs.writeFileSync(out, parts.join("\n"));
console.log("wrote", out);
console.log(`islands=${data.islands.length} roads=${data.roads.length} water=${data.water.length} land=${data.land.length} caves=${data.caves.length}`);
