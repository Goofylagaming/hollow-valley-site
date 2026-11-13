const crypto = require('node:crypto');

function signature(payload, secret) {
  return crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
}

function settle(payload, suppliedSignature, { env = process.env, economy, progression }) {
  const secret = env.HERBYBOT_REWARD_SIGNING_SECRET || (env.HERBYBOT_REWARD_SIGNING_SECRET_FILE
    ? require('node:fs').readFileSync(env.HERBYBOT_REWARD_SIGNING_SECRET_FILE,'utf8').trim() : '');
  if (env.HERBYBOT_REWARDS_ENABLED !== 'true' || secret.length < 32) throw new Error('DISABLED');
  const supplied = Buffer.from(String(suppliedSignature || ''));
  const expected = Buffer.from(signature(payload, secret));
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) throw new Error('UNAUTHORIZED');
  const { guild, reward, recipient, amount, proposedBy, approvedBy } = payload;
  if (guild !== env.HERBY_GAME_GUILD_ID || !/^[a-f0-9]{16}$/.test(reward) ||
      ![recipient, proposedBy, approvedBy].every(id => /^[0-9]{8,32}$/.test(id)) ||
      proposedBy === approvedBy || !Number.isSafeInteger(amount) || amount < 1 || amount > 100000) throw new Error('INVALID');
  const key = `herby-reward:${guild}:${reward}`;
  const existing = economy.getLedgerByIdempotency(key);
  if (existing) {
    if (existing.metadata?.recipientDiscord !== recipient || Number(existing.amount) !== amount) throw new Error('CONFLICT');
    return { transactionId: existing.id, amount, duplicate: true };
  }
  const steamId = progression.steamIdForDiscord(recipient);
  if (!steamId) throw new Error('NOT_LINKED');
  const result = economy.applyWalletTransaction({ steamId, amount, kind:'event_reward',
    reason:'Approved HerbyBot tournament reward', idempotencyKey:key,
    referenceType:'herbybot_reward', referenceId:reward,
    metadata:{guild, reward, recipientDiscord:recipient, proposedBy, approvedBy} });
  return {transactionId:result.transaction.id, amount, duplicate:Boolean(result.duplicate)};
}
module.exports = { settle, signature };
