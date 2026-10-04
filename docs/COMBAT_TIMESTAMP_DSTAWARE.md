# Combat timestamp handling

Combat ingestion uses the outer Unreal log timestamp (for example `[2026.10.04-03.26.00:123]`) as UTC. The inner `LogTheIsleKillData` timestamp is host-local time and can move between UTC+10 and UTC+11 when the Windows host observes daylight saving time.

Using the outer timestamp prevents combat events being interpreted one hour into the future at the daylight-saving boundary and avoids `COMBAT_EVENT_INVALID` rejections.
