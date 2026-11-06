"use strict";
// Deterministic fixture only: no credentials, production database or network.
process.env.DB_PATH = ":memory:";
const service = require("../server/services/subscriberCommunity");
const now = Date.parse("2026-11-05T00:00:00Z");
const env = { SUBSCRIBER_COMMUNITY_ENABLED: "1", MEMBERSHIP_REWARDS_ENABLED: "1", SUBSCRIBER_COMMUNITY_MODE: "dry-run" };
const progress = { enabled:true, configured:true, available:true, month:"2026-11", coveragePercent:75, updatedAt:new Date(now).toISOString(), periodEnd:"2026-11-30T14:00:00.000Z" };
console.log(JSON.stringify({ source:"synthetic staging fixture", discordWrites:0, posts:service.monthly({env,now,progress}), supportUpdate:service.publish({is_admin:1},{kind:"support-update",text:"Your support helped us improve community tools and prepare new skin previews."},{env,now}) },null,2));
