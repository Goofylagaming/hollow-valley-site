"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { present, presentRecent, publicName } = require("../server/services/arcadePublicBoard");

test("public names keep real display names and hide steam placeholders", () => {
  const steam = "76561198000012345";
  assert.equal(publicName("Josh", steam), "Josh");
  assert.match(publicName("", steam), /^Survivor #\d{4}$/);
  assert.match(publicName("Survivor12345", steam), /^Survivor #\d{4}$/);
  assert.equal(publicName("Survivor12345", steam).includes("12345"), false);
  assert.equal(publicName(steam, steam).includes(steam), false);
  assert.match(publicName("  Hollow   Scout  ", steam), /^Hollow Scout$/);
});

test("weekly payload shows names and rank without steam ids", () => {
  const you = "76561198000000111";
  const hidden = "76561198000000222";
  const names = new Map([[you, "Josh"], [hidden, "Survivor98000"]]);
  const payload = present({
    weekStart: "2026-11-23",
    weekEnd: "2026-11-29",
    resetAt: Date.parse("2026-11-29T14:00:00.000Z"),
    entries: [
      { rank: 1, steamId: hidden, score: 12 },
      { rank: 2, steamId: you, score: 4 }
    ],
    you: { rank: 2, steamId: you, score: 4 }
  }, names);
  assert.equal(payload.entries[1].name, "Josh");
  assert.match(payload.entries[0].name, /^Survivor #\d{4}$/);
  assert.equal(payload.entries[0].name.includes("98000"), false);
  assert.equal(payload.you.rank, 2);
  assert.equal(payload.you.score, 4);
  const encoded = JSON.stringify(payload);
  assert.equal(encoded.includes(you), false);
  assert.equal(encoded.includes(hidden), false);
  assert.equal(/\d{17}/.test(encoded), false);
  assert.equal(Object.hasOwn(payload.entries[0], "steamId"), false);
});

test("recent wins keep the reward name and swap steam ids for display names", () => {
  const you = "76561198000000111";
  const hidden = "76561198000000222";
  const names = new Map([[you, "Rex"], [hidden, ""]]);
  const payload = presentRecent({
    entries: [
      { steamId: you, type: "crate", name: "Emberwake", rarity: "Legendary", timestamp: "2026-11-26T09:00:00.000Z" },
      { steamId: hidden, type: "crate", name: "Frostveil skin", rarity: "Rare", timestamp: "2026-11-26T08:00:00.000Z" },
      { steamId: you, type: "crate", name: "500 Valley Coins", rarity: "Legendary", timestamp: "2026-11-26T07:00:00.000Z", amount: 500 },
      { steamId: "not-a-steam-id", type: "crate", name: "Injected", rarity: "Rare", timestamp: "2026-11-26T07:00:00.000Z" },
      { steamId: you, type: "signal", name: "Verdant Warden", rarity: "Epic", timestamp: "2026-11-26T06:00:00.000Z" }
    ]
  }, names);
  assert.equal(payload.entries.length, 3);
  assert.equal(payload.entries[0].player, "Rex");
  assert.equal(payload.entries[0].name, "Emberwake");
  assert.equal(payload.entries[0].type, "crate");
  assert.equal(payload.entries[0].rarity, "Legendary");
  assert.match(payload.entries[1].player, /^Survivor #\d{4}$/);
  assert.equal(payload.entries[1].player.includes(hidden), false);
  assert.equal(payload.entries[2].type, "signal");
  assert.equal(payload.entries.some(row => row.name === "Injected" || /coin/i.test(row.name)), false);
  const encoded = JSON.stringify(payload);
  assert.equal(encoded.includes(you), false);
  assert.equal(encoded.includes(hidden), false);
  assert.equal(encoded.includes("steamId"), false);
  assert.equal(encoded.includes("amount"), false);
  assert.equal(Object.hasOwn(payload.entries[0], "steamId"), false);
});
