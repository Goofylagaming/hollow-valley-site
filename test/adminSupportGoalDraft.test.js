"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { readBudgetFile, milestonesFor } = require("../public/assets/admin-support-goal");

test("a budget file preserves integer cents and the owner's saved version, and can only produce an unpublished draft", async () => {
  const categories = [
    { id: "example-a", label: "Sample A", amountCents: 1 },
    { id: "example-b", label: "Sample B", amountCents: 2 },
  ];
  const input = { currency: "aud", enabled: false, categories };
  const file = data => new Blob([JSON.stringify(data)]);
  const loaded = await readBudgetFile(file({ ...input, version: 99 }), 4);
  assert.deepEqual(loaded, { enabled: false, version: 4, categories });
  assert.deepEqual(milestonesFor(3), [{ percent: 50, amountCents: 2 }, { percent: 75, amountCents: 3 }]);
  for (const invalid of [
    { ...input, enabled: true }, { ...input, currency: "usd" }, { ...input, categories: [] },
    { ...input, categories: [categories[0], categories[0]] },
    ...[0, -1, 1.2, "2", 100000001].map(amountCents => ({ ...input, categories: [{ ...categories[0], amountCents }] })),
    { ...input, categories: [{ ...categories[0], amountCents: 100000000 }, categories[1]] },
  ]) await assert.rejects(readBudgetFile(file(invalid), 4));
  await assert.rejects(readBudgetFile(new Blob(["{"]), 4));
  await assert.rejects(readBudgetFile({ size: 16385, text: () => assert.fail("Oversized files must not be read") }, 4), /16 KB/);
});
