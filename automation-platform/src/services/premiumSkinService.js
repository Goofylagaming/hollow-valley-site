const { randomUUID, createHash } = require('node:crypto');
const store = require('./economyStore');
const skins = require('./skinPresetService');

store.db.exec(`
  CREATE TABLE IF NOT EXISTS economy_membership_skin_catalog (
    id TEXT PRIMARY KEY,
    preset_id TEXT NOT NULL UNIQUE,
    collection_key TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','reviewed','published','archived')),
    verification_note TEXT NOT NULL DEFAULT '',
    verified_by_steam_id TEXT,
    verified_at TEXT,
    published_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(preset_id) REFERENCES economy_skin_presets(id)
  );
  CREATE TABLE IF NOT EXISTS economy_membership_skin_claims (
    claim_id TEXT PRIMARY KEY,
    steam_id TEXT NOT NULL,
    skin_id TEXT NOT NULL,
    preset_id TEXT NOT NULL,
    granted_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY(steam_id) REFERENCES economy_wallets(steam_id),
    FOREIGN KEY(skin_id) REFERENCES economy_membership_skin_catalog(id)
  );
`);

function enabled(env = process.env) {
  return /^(1|true|yes)$/i.test(String(env.MEMBERSHIP_PREMIUM_SKINS_ENABLED || '').trim());
}
function fail(message, code, status = 400) {
  const error = new Error(message); error.code = code; error.status = status; throw error;
}
function collectionKey(value) {
  const key = String(value || '').trim();
  if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(key)) fail('Use a collection key of 3–60 lowercase letters, numbers or hyphens.', 'PREMIUM_COLLECTION_INVALID');
  return key;
}
function find(id) {
  const entry = store.db.prepare('SELECT * FROM economy_membership_skin_catalog WHERE id = ?').get(String(id || ''));
  if (!entry) fail('Premium skin not found.', 'PREMIUM_SKIN_NOT_FOUND', 404);
  const preset = store.getSkinPreset(entry.preset_id);
  if (!preset || !preset.active) fail('Premium skin not found.', 'PREMIUM_SKIN_NOT_FOUND', 404);
  return { entry, preset };
}
function hex(color) {
  return '#' + ['r','g','b'].map((key) => Math.round(Math.max(0, Math.min(1, Number(color?.[key]) || 0)) * 255).toString(16).padStart(2, '0')).join('');
}
function draftVersion(preset) {
  return createHash('sha256').update(JSON.stringify([preset.species,preset.name,preset.description,preset.skin])).digest('hex');
}
function card(entry, preset, steamId, admin = false) {
  const owned = Boolean(steamId && (store.hasSkinUnlock(steamId, preset.id) || preset.owner_steam_id === steamId));
  return {
    id: entry.id, presetId: preset.id, name: preset.name, description: preset.description,
    species: preset.species, collectionKey: entry.collection_key,
    state: entry.state, published: entry.state === 'published', owned,
    premium: true, previewType: 'palette',
    verifiedSpecies: preset.membershipVerifiedSpecies,
    swatches: ['body','markings','flank','underbelly','maleDisplay','eyes'].map((zone) => ({ zone, color: hex(preset.skin[zone]) })),
    ...(admin ? { skin: preset.skin, version: draftVersion(preset), verificationNote: entry.verification_note, verifiedAt: entry.verified_at, publishedAt: entry.published_at } : {}),
  };
}
function listCatalog(steamId = null, { admin = false } = {}) {
  const steam = steamId ? store.validateSteamId(steamId) : null;
  const rows = store.db.prepare(`SELECT * FROM economy_membership_skin_catalog ${admin ? '' : "WHERE state = 'published'"} ORDER BY created_at DESC, id ASC`).all();
  const catalogue = rows.map((entry) => ({ entry, preset: store.getSkinPreset(entry.preset_id) }))
    .filter(({preset}) => preset?.active)
    .map(({entry,preset}) => card(entry, preset, steam, admin));
  return { enabled: enabled() && skins.systemEnabled(), skins: catalogue, publishedCount: catalogue.filter((item) => item.published).length };
}
function profileCollections(steamId) {
  const steam=store.validateSteamId(steamId),collections=new Map();
  const rows=store.db.prepare("SELECT * FROM economy_membership_skin_catalog WHERE state='published' OR (state='archived' AND published_at IS NOT NULL) ORDER BY created_at DESC,id").all();
  for(const entry of rows) {
    const preset=store.getSkinPreset(entry.preset_id);if(!preset?.active)continue;
    const ownership=preset.owner_steam_id===steam?'created':store.hasSkinUnlock(steam,preset.id)?'unlocked':store.hasSkinGrant(steam,preset.id)?'granted':null;
    if(entry.state==='archived'&&!ownership)continue;
    const skin=card(entry,preset,steam);
    if(!collections.has(skin.collectionKey))collections.set(skin.collectionKey,{key:skin.collectionKey,total:0,owned:0,skins:[]});
    const group=collections.get(skin.collectionKey);group.total++;if(ownership)group.owned++;
    group.skins.push({id:skin.id,name:skin.name,species:skin.species,owned:Boolean(ownership),ownership,archived:entry.state==='archived',swatches:skin.swatches});
  }
  return {enabled:enabled()&&skins.systemEnabled(),collections:[...collections.values()].sort((a,b)=>a.key.localeCompare(b.key))};
}
function createDraft({ ownerSteamId, species = 'Universal', name, description = '', skin, collection = 'valley-premium', sourceKey = null }) {
  const owner = store.validateSteamId(ownerSteamId);
  const key = collectionKey(collection);
  const data = skins.sanitizeSkin(skin);
  const safeName = skins.validateName(name);
  const safeSpecies = skins.validateSpecies(species);
  const desc = String(description || '').trim().slice(0, 240);
  if (sourceKey) {
    const existing = store.db.prepare('SELECT c.* FROM economy_membership_skin_catalog c JOIN economy_skin_presets p ON p.id = c.preset_id WHERE p.create_key = ?').get(sourceKey);
    if (existing) return { duplicate: true, skin: card(existing, store.getSkinPreset(existing.preset_id), owner, true) };
  }
  const id = randomUUID(); const presetId = randomUUID();
  store.db.exec('BEGIN IMMEDIATE');
  try {
    store.ensureWallet(owner);
    store.db.prepare(`INSERT INTO economy_skin_presets
      (id,owner_steam_id,species,name,description,skin_json,is_premium,active,published,exclusive,price,share_code,create_key,membership_premium)
      VALUES (?,?,?,?,?,?,0,1,0,1,0,NULL,?,1)`)
      .run(presetId, owner, safeSpecies, safeName, desc, JSON.stringify(data), sourceKey);
    store.db.prepare('INSERT INTO economy_membership_skin_catalog (id,preset_id,collection_key) VALUES (?,?,?)').run(id,presetId,key);
    store.db.exec('COMMIT');
  } catch(error) { try { store.db.exec('ROLLBACK'); } catch {} throw error; }
  const { entry, preset } = find(id);
  return { duplicate: false, skin: card(entry,preset,owner,true) };
}
function draftFromPreset({ ownerSteamId, presetId, collection }) {
  const owner = store.validateSteamId(ownerSteamId);
  const source = store.getSkinPreset(presetId);
  if (!source?.active || source.owner_steam_id !== owner || source.membershipPremium) fail('Choose one of your own ordinary saved Skin Studio designs.', 'PREMIUM_SOURCE_INVALID', 403);
  return createDraft({ ownerSteamId:owner, species:source.species, name:source.name, description:source.description, skin:source.skin, collection,
    sourceKey:`membership-premium-source:${source.id}:${draftVersion(source)}:${collectionKey(collection)}` });
}
function updateDraft({ skinId, actorSteamId, species, name, description, skin }) {
  store.validateSteamId(actorSteamId);
  const safeSkin = skins.sanitizeSkin(skin);
  const safeSpecies = skins.validateSpecies(species);
  const safeName = skins.validateName(name);
  store.db.exec('BEGIN IMMEDIATE');
  try {
    // Check the state after acquiring the write lock: another worker may have
    // verified this draft while this request was waiting to write.
    const { entry,preset } = find(skinId);
    if (entry.state !== 'draft') fail('Create a new draft version to change a reviewed or published skin.', 'PREMIUM_SKIN_IMMUTABLE', 409);
    store.db.prepare(`UPDATE economy_skin_presets SET species=?, name=?, description=?, skin_json=?, membership_verified_species_json='[]', updated_at=datetime('now') WHERE id=?`)
      .run(safeSpecies,safeName,String(description||'').trim().slice(0,240),JSON.stringify(safeSkin),preset.id);
    const result = card(entry,store.getSkinPreset(preset.id),actorSteamId,true);
    store.db.exec('COMMIT');
    return result;
  } catch(error) {try{store.db.exec('ROLLBACK');}catch{}throw error;}
}
function verifyDraft({ skinId, actorSteamId, verifiedSpecies, note, confirmedInGame, expectedVersion }) {
  const actor = store.validateSteamId(actorSteamId);
  if (confirmedInGame !== true) fail('Confirm this exact draft was applied and checked in-game.', 'PREMIUM_VERIFICATION_REQUIRED', 409);
  const list = Array.isArray(verifiedSpecies) ? [...new Set(verifiedSpecies.map((item) => skins.validateSpecies(item)))] : [];
  const verificationNote = String(note || '').trim();
  if (!list.length || list.length > 40 || list.some((item) => /^(universal|unknown)$/i.test(item))) fail('List the specific dinosaur species checked in-game.', 'PREMIUM_SPECIES_REQUIRED');
  if (verificationNote.length < 15 || verificationNote.length > 1000) fail('Record a 15–1000 character note describing the in-game check.', 'PREMIUM_VERIFICATION_NOTE_REQUIRED');
  store.db.exec('BEGIN IMMEDIATE');
  try {
    // Verification is tied to the exact version protected by this transaction,
    // not a snapshot read before another worker acquired the write lock.
    const { entry,preset } = find(skinId);
    if (entry.state !== 'draft') fail('Only a draft can be submitted for verification.', 'PREMIUM_SKIN_IMMUTABLE', 409);
    if (expectedVersion !== draftVersion(preset)) fail('This draft changed since it was loaded. Refresh and verify the current version in-game.', 'PREMIUM_DRAFT_CHANGED',409);
    if (!/^universal$/i.test(preset.species) && !list.some((species) => species.toLowerCase() === preset.species.toLowerCase())) fail('Verification must include the preset dinosaur species.', 'PREMIUM_SPECIES_REQUIRED');
    store.db.prepare('UPDATE economy_skin_presets SET membership_verified_species_json=? WHERE id=?').run(JSON.stringify(list),preset.id);
    store.db.prepare("UPDATE economy_membership_skin_catalog SET state='reviewed', verification_note=?, verified_by_steam_id=?, verified_at=datetime('now'), updated_at=datetime('now') WHERE id=?")
      .run(verificationNote,actor,entry.id);
    const current = find(skinId);
    const result = card(current.entry,current.preset,actor,true);
    store.db.exec('COMMIT');
    return result;
  } catch(error) {try{store.db.exec('ROLLBACK');}catch{}throw error;}
}
function setPublished({ skinId, actorSteamId, published }) {
  const actor = store.validateSteamId(actorSteamId);
  if (typeof published !== 'boolean') fail('Choose whether to publish this skin.', 'PREMIUM_PUBLICATION_INVALID');
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const { entry,preset } = find(skinId);
    if (published === true && (!['reviewed','published','archived'].includes(entry.state) || !entry.verified_at || !preset.membershipVerifiedSpecies.length)) {
      fail('Complete the in-game verification before publishing this premium skin.', 'PREMIUM_VERIFICATION_REQUIRED',409);
    }
    if (!published && entry.state === 'draft') {
      const result = card(entry,preset,actor,true);
      store.db.exec('COMMIT');
      return result;
    }
    store.db.prepare("UPDATE economy_membership_skin_catalog SET state=?, published_at=CASE WHEN ? THEN COALESCE(published_at,datetime('now')) ELSE published_at END, updated_at=datetime('now') WHERE id=?")
      .run(published ? 'published' : 'archived',published ? 1 : 0,entry.id);
    const current=find(skinId);
    const result = card(current.entry,current.preset,actor,true);
    store.db.exec('COMMIT');
    return result;
  } catch(error) {try{store.db.exec('ROLLBACK');}catch{}throw error;}
}
function fulfillClaim({ claimId, steamId, skinId }) {
  const steam = store.validateSteamId(steamId);
  const claim = String(claimId || '').trim();
  if (!/^[A-Za-z0-9:_-]{8,120}$/.test(claim)) fail('Invalid membership claim identifier.', 'PREMIUM_CLAIM_INVALID');
  const existing = store.db.prepare('SELECT * FROM economy_membership_skin_claims WHERE claim_id=?').get(claim);
  if (existing) {
    if (existing.steam_id !== steam || existing.skin_id !== String(skinId)) fail('Claim identifier belongs to a different reward.', 'PREMIUM_CLAIM_CONFLICT',409);
    return { claimId:claim,skinId:String(skinId),presetId:existing.preset_id,duplicate:true,alreadyOwned:false,preset:skins.getPresetForPlayer(steam,existing.preset_id) };
  }
  if (!enabled() || !skins.systemEnabled()) fail('Monthly premium skin claims are not enabled yet.', 'PREMIUM_SKINS_DISABLED',503);
  let grantedPreset;
  store.db.exec('BEGIN IMMEDIATE');
  try {
    store.ensureWallet(steam);
    // A second automation worker may have committed this same receipt while
    // this request was waiting for the write lock.
    const committed = store.db.prepare('SELECT * FROM economy_membership_skin_claims WHERE claim_id=?').get(claim);
    if (committed) {
      if (committed.steam_id !== steam || committed.skin_id !== String(skinId)) fail('Claim identifier belongs to a different reward.', 'PREMIUM_CLAIM_CONFLICT',409);
      store.db.exec('COMMIT');
      return {claimId:claim,skinId:String(skinId),presetId:committed.preset_id,duplicate:true,alreadyOwned:false,preset:skins.getPresetForPlayer(steam,committed.preset_id)};
    }
    // Publication can be revoked by another worker while a claim waits. Read
    // the catalogue under the same lock as the permanent unlock insertion.
    const {entry,preset}=find(skinId);
    if (entry.state !== 'published' || !entry.verified_at || !preset.membershipVerifiedSpecies.length) fail('This skin is not available for membership claims.', 'PREMIUM_SKIN_UNAVAILABLE',409);
    if (store.hasSkinUnlock(steam,preset.id) || preset.owner_steam_id === steam) {
      store.db.exec('COMMIT'); return { claimId:claim,skinId:entry.id,presetId:preset.id,duplicate:true,alreadyOwned:true };
    }
    store.db.prepare('INSERT INTO economy_skin_unlocks (steam_id,preset_id,purchase_price,idempotency_key) VALUES (?,?,0,?)').run(steam,preset.id,`membership:${claim}`);
    store.db.prepare('INSERT INTO economy_membership_skin_claims (claim_id,steam_id,skin_id,preset_id) VALUES (?,?,?,?)').run(claim,steam,entry.id,preset.id);
    grantedPreset = skins.getPresetForPlayer(steam,preset.id);
    store.db.exec('COMMIT');
  } catch(error) {try{store.db.exec('ROLLBACK');}catch{}throw error;}
  return { claimId:claim,skinId:String(skinId),presetId:grantedPreset.id,duplicate:false,alreadyOwned:false,preset:grantedPreset };
}
function color(value) { const x = value.replace('#','');return {r:parseInt(x.slice(0,2),16)/255,g:parseInt(x.slice(2,4),16)/255,b:parseInt(x.slice(4,6),16)/255,a:1}; }
const STARTER_PALETTES = Object.freeze([
  { key:'ashfall',name:'Ashfall',description:'Charcoal and volcanic ash with burnt-orange accents.',colors:['#343638','#17191b','#5c5149','#b7aa92','#dccdb1','#743e3e','#262322','#a6542e','#c88a40','#bb6633'] },
  { key:'moonlit-marsh',name:'Moonlit Marsh',description:'Deep blue, muted teal and pale moonlit highlights.',colors:['#233a4a','#152735','#365b59','#a5b8af','#d4d6be','#593b48','#243038','#597c75','#c6ba72','#4d777c'] },
  { key:'valley-royalty',name:'Valley Royalty',description:'Dark plum, warm cream and subdued gold accents.',colors:['#3d2d47','#241d2e','#675064','#d3c3a1','#e1d8be','#713e50','#302833','#a58b53','#c5ad65','#ab9258'] },
]);
function seedDrafts({ ownerSteamId }) {
  return { skins: STARTER_PALETTES.map((palette) => {
    const skin = Object.fromEntries(skins.COLOR_KEYS.map((zone,index)=>[zone,color(palette.colors[index])]));
    Object.assign(skin,{skinVariation:0,patternIndex:0,themeIndex:0});
    return createDraft({ownerSteamId,name:palette.name,description:palette.description,skin,collection:'valley-origins',sourceKey:`membership-starter:v1:${palette.key}`}).skin;
  }) };
}
module.exports={enabled,listCatalog,profileCollections,createDraft,draftFromPreset,updateDraft,verifyDraft,setPublished,fulfillClaim,seedDrafts,STARTER_PALETTES};
