const test = require('node:test');
const assert = require('node:assert/strict');

const { redactShareCodes } = require('../server/middleware/skinShareCodeRedaction');

test('redactShareCodes removes nested HV share-code fields from API payloads', () => {
  const input = {
    preset: { id: 'one', share_code: 'HV-AAAAA-BBBBB' },
    presets: [
      { id: 'two', shareCode: 'HV-CCCCC-DDDDD' },
      { id: 'three', nested: { share_code: 'HV-EEEEE-FFFFF' } },
    ],
  };

  const output = redactShareCodes(input);
  assert.equal(output.preset.share_code, null);
  assert.equal(output.presets[0].shareCode, null);
  assert.equal(output.presets[1].nested.share_code, null);
});
