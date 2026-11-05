const { createHmac, timingSafeEqual } = require('node:crypto');
const DOMAIN = 'hollow-valley:treasury:territory-delivery:v1';
const fields = ['id', 'requestId', 'groupId', 'cost', 'purpose', 'targetKey', 'outcome'];
function canonical(value, signed = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length + Number(signed) ||
      Object.keys(value).some(key => !fields.includes(key) && !(signed && key === 'signature')) ||
      typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value.id) || typeof value.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value.requestId) ||
      !Number.isSafeInteger(value.groupId) || value.groupId < 1 || !Number.isSafeInteger(value.cost) || value.cost < 1 ||
      value.purpose !== 'territory_entry' || typeof value.targetKey !== 'string' || !/^[1-9]\d*$/.test(value.targetKey) ||
      !Number.isSafeInteger(Number(value.targetKey)) || !['delivered', 'not_delivered'].includes(value.outcome)) throw new Error('Invalid Territory delivery proof');
  return Object.fromEntries(fields.map(key => [key, value[key]]));
}
const configured = secret => typeof secret === 'string' && Buffer.byteLength(secret, 'utf8') >= 32;
function signature(value, secret) {
  if (!configured(secret)) throw new Error('A dedicated Territory delivery proof secret of at least 32 bytes is required');
  return createHmac('sha256', secret).update(DOMAIN + '\n' + JSON.stringify(value)).digest('hex');
}
function sign(value, secret) { const body = canonical(value); return { ...body, signature: signature(body, secret) }; }
function verify(value, secret) {
  try {
    const body = canonical(value, true);
    if (typeof value.signature !== 'string' || !/^[a-f0-9]{64}$/.test(value.signature)) return false;
    return timingSafeEqual(Buffer.from(value.signature, 'hex'), Buffer.from(signature(body, secret), 'hex'));
  } catch { return false; }
}
module.exports = { sign, verify, configured };
