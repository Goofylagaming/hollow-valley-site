const test = require("node:test");
const assert = require("node:assert/strict");
const client = require("../public/assets/membership-rewards");

test("subscriber loyalty explains automatic permanent roles and progress at each threshold", () => {
  for (const [months, nextMonths, nextTitle] of [[2, 3, "Valley Companion"], [5, 6, "Ancient Guardian"], [11, 12, "Heart of the Valley"]]) {
    const milestones = [[3, "Valley Companion"], [6, "Ancient Guardian"], [12, "Heart of the Valley"]]
      .map(([threshold, title]) => ({ months: threshold, title, earned: months >= threshold }));
    const markup = client.renderRewards(rewards({ entitled: false, loyalty: { paidMonths: months, milestones } }));
    assert.ok(markup.includes(`${months} / ${nextMonths} paid months towards ${nextTitle}`));
    assert.ok(markup.includes(`1 more paid month to ${nextTitle}`));
    assert.match(markup, /Roles are awarded automatically/);
    assert.match(markup, /stays permanently, even if you cancel/);
    assert.match(markup, /Free trials and unpaid periods do not add progress/);
  }
  const milestones = [3, 6, 12].map(months => ({ months, earned: true }));
  assert.match(client.renderRewards(rewards({ loyalty: { paidMonths: 12, milestones } })), /All loyalty milestones earned/);
  assert.doesNotMatch(client.renderRewards(rewards({ loyalty: { milestones } })), /role="progressbar"/);
});

function rewards(overrides = {}) {
  return {
    enabled: true,
    entitled: true,
    tier: "guardian",
    tierLabel: "Valley Guardian",
    benefitsUntil: "2026-12-02T00:00:00.000Z",
    monthly: { enabled: true, catalogueReady: true, allowance: 2, used: 1, remaining: 1, periodEnd: "2026-12-02T00:00:00.000Z" },
    storage: { enabled: true, configured: true, bonusSlots: 2, totalSlots: 7, usedSlots: 4, withdrawOnly: false },
    appearance: {
      badgeVisible: true,
      badge: { id: "guardian", label: "Valley Guardian" },
      selectedFrameId: "guardian-river",
      frames: [
        { id: "none", label: "Classic", available: true, permanent: true },
        { id: "guardian-river", label: "River Guardian", available: true, permanent: false },
        { id: "loyalty-3", label: "Three-month loyalty", available: true, permanent: true },
        { id: "legend-gold", label: "Valley Legend", available: false, permanent: false },
      ],
    },
    loyalty: {
      paidMonths: 4,
      milestones: [
        { months: 3, title: "Valley Rooted", earned: true },
        { months: 6, title: "Valley Veteran", earned: false },
        { months: 12, title: "Valley Ancient", earned: false },
      ],
    },
    ...overrides,
  };
}

test("membership panel does not advertise unactivated rewards", () => {
  const markup = client.renderRewards(rewards({ enabled: false }), "Goofy");
  assert.match(markup, /being prepared/);
  assert.doesNotMatch(markup, /choices remaining|membership slots|Save appearance/);
});

test("monthly choices require a published collection and a verified paid cycle", () => {
  const pending = client.renderRewards(rewards({ monthly: { enabled: true, catalogueReady: false, allowance: 2 } }), "Goofy");
  assert.match(pending, /Collection in preparation/);
  assert.doesNotMatch(pending, /choices remaining/);
  const unpaid = client.renderRewards(rewards({ monthly: { enabled: true, allowance: 0, catalogueReady: true } }), "Goofy");
  assert.match(unpaid, /Awaiting a paid membership cycle/);
  const active = client.renderRewards(rewards(), "Goofy");
  assert.match(active, /1 choice remaining/);
  assert.match(active, /1 of 2 choices used/);
  assert.match(active, /href="\/skins#premium-collection"/);
});

test("active and expired memberships never advertise dinosaur storage or quotas, including with legacy capacity data", () => {
  for (const entitled of [true, false]) {
    const withoutStorage = rewards({ entitled, storage: undefined });
    const markup = client.renderRewards(withoutStorage, "Goofy");
    assert.doesNotMatch(markup, /storage|slots used|withdraw.only|new deposits|membership slots/i);
    for (const storage of [
      { enabled: false },
      { enabled: true, configured: true, usedSlots: 4, totalSlots: 8, bonusSlots: 4 },
      { enabled: true, configured: true, usedSlots: 7, totalSlots: 5, bonusSlots: 0, withdrawOnly: true },
    ]) {
      assert.equal(client.renderRewards({ ...withoutStorage, storage }, "Goofy"), markup);
    }
  }
});

test("the guest sign-in prompt promotes actual membership rewards without offering storage", async () => {
  const host = { innerHTML: "", setAttribute() {} };
  await client.loadRewards({ host, me: { loggedIn: false }, api: () => assert.fail("guest rewards lookup") });
  assert.match(host.innerHTML, /skin choices, profile frames and loyalty progress/);
  assert.doesNotMatch(host.innerHTML, /storage|slot|quota/i);
});

test("reward labels, names, errors and frame IDs cannot inject markup", () => {
  const payload = rewards();
  payload.tierLabel = '<img src=x onerror="alert(1)">';
  payload.monthly.claimError = '<script>alert(1)</script>';
  payload.appearance.frames.push({ id: '" onmouseover="alert(1)', available: true, label: "bad" });
  payload.appearance.frames[1].label = '<img src=x onerror="alert(2)">';
  const markup = client.renderRewards(payload, '<svg onload="alert(3)">');
  assert.doesNotMatch(markup, /<script>|<img|<svg|value="" onmouseover/);
  assert.match(markup, /&lt;img/);
  assert.match(markup, /&lt;script&gt;/);
  assert.match(markup, /&lt;svg/);
});

test("membership frames expire while earned loyalty frames remain selectable", () => {
  const payload = rewards({ entitled: false });
  payload.appearance.frames[1].available = false;
  assert.equal(client.appearanceFor(payload).selectedFrameId, "none");
  payload.appearance.selectedFrameId = "loyalty-3";
  assert.equal(client.appearanceFor(payload).selectedFrameId, "loyalty-3");
});

test("loyalty progress does not infer paid months from membership activity", () => {
  const markup = client.renderRewards(rewards({ loyalty: { paidMonths: 0, milestones: [] } }), "Goofy");
  assert.match(markup, /No verified paid months are recorded yet/);
  assert.doesNotMatch(markup, /Valley Veteran|Valley Ancient/);
  const unavailable = client.renderRewards(rewards({ loyalty: {} }), "Goofy");
  assert.match(unavailable, /Paid history unavailable/);
});

test("paid history verification is offered only when a linked subscription can be checked", () => {
  const payload = rewards();
  payload.loyalty.canSyncHistory = true;
  payload.loyalty.historySyncedAt = "2026-11-02 18:00:00";
  const markup = client.renderRewards(payload, "Goofy");
  assert.match(markup, /Verify paid history/);
  assert.match(markup, /Checks payments on your current subscription/);
  assert.match(markup, /Last checked 3 Nov 2026/);
  payload.loyalty.canSyncHistory = false;
  assert.doesNotMatch(client.renderRewards(payload, "Goofy"), /Verify paid history/);
});

test("earned loyalty profile badge uses the named milestone reward", () => {
  const avatar = { attributes: {}, removeAttribute(key) { delete this.attributes[key]; }, setAttribute(key, value) { this.attributes[key] = value; } };
  const badge = { hidden: false, textContent: "" };
  const loyalty = { hidden: true, textContent: "", title: "" };
  const document = { querySelector() { return avatar; }, getElementById(id) { return id === "profile-supporter-badge" ? badge : loyalty; } };
  client.applyProfileAppearance(document, rewards());
  assert.equal(loyalty.hidden, false);
  assert.equal(loyalty.textContent, "Valley Rooted");
  assert.equal(loyalty.title, "3 verified paid months");
});

test("private badge preference hides both membership and loyalty badges on profile", () => {
  const avatar = { attributes: {}, removeAttribute(key) { delete this.attributes[key]; }, setAttribute(key, value) { this.attributes[key] = value; } };
  const badge = { hidden: false, textContent: "Valley Guardian" };
  const loyalty = { hidden: false, textContent: "Old milestone" };
  const document = { querySelector() { return avatar; }, getElementById(id) { return id === "profile-supporter-badge" ? badge : loyalty; } };
  const payload = rewards();
  payload.appearance.badgeVisible = false;
  client.applyProfileAppearance(document, payload);
  assert.equal(badge.hidden, true);
  assert.equal(loyalty.hidden, true);
  assert.equal(avatar.attributes["data-membership-frame"], "guardian-river");
});

test("a slow old rewards response cannot overwrite a newer membership state", async () => {
  const host = { innerHTML: "", attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, querySelector() { return null; } };
  let resolveOld;
  const old = new Promise((resolve) => { resolveOld = resolve; });
  let request = 0;
  const api = () => ++request === 1 ? old : Promise.resolve(rewards({ entitled: false }));
  const me = { loggedIn: true, user: { username: "Goofy" } };
  const first = client.loadRewards({ host, me, api });
  await client.loadRewards({ host, me, api });
  resolveOld(rewards());
  await first;
  assert.match(host.innerHTML, /No verified active benefits/);
  assert.doesNotMatch(host.innerHTML, /Benefits active/);
  assert.equal(host.attributes["aria-busy"], "false");
});

test("failed rewards lookup has a retry and never fabricates an active benefit", async () => {
  let retryRegistered = false;
  const host = {
    innerHTML: "", setAttribute() {},
    querySelector(selector) { return selector === "[data-membership-retry]" ? { addEventListener() { retryRegistered = true; } } : null; },
  };
  await client.loadRewards({ host, me: { loggedIn: true }, api: async () => { throw new Error("Temporarily unavailable"); } });
  assert.match(host.innerHTML, /Rewards temporarily unavailable/);
  assert.equal(retryRegistered, true);
  assert.doesNotMatch(host.innerHTML, /Benefits active|remaining/);
});
