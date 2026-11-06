"use strict";

(async function renderCollection() {
  const panel = document.getElementById("membership-collection");
  const response = await fetch("/api/supporter/rewards/collection");
  if (!response.ok) return;
  const book = await response.json();
  function section(name, entries) {
    const heading = document.createElement("h3");
    heading.textContent = name;
    panel.append(heading);
    const list = document.createElement("ul");
    for (const entry of entries) {
      const item = document.createElement("li");
      item.textContent = entry;
      list.append(item);
    }
    panel.append(list);
  }
  section("Passport", [book.passport.lifetime + " lifetime verified paid months", book.passport.consecutive + " consecutive paid months"]);
  section("Permanently claimed premium skins", book.skins.length ? book.skins.map(s => s.skin_id) : ["No claims recorded"]);
  section("Loyalty titles", book.milestones.map(m => m.title + (book.loyalty.some(l => l.months === m.months) ? " · Owned" : " · Locked")));
  if (book.collectibles.length) section("Collectibles", book.collectibles.map(c => c.name + (c.earned_at ? " · Owned" : " · Locked")));
  panel.hidden = false;
})().catch(() => {});
