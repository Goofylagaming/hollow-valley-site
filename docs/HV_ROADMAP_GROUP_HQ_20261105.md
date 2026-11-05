# Group Headquarters — roadmap #16

Local implementation begins with additive group profile metadata. Description edits reuse active group membership and current owner authority from groupsStore. Each edit checks the expected revision and writes the profile plus retained audit entry in one transaction. Members can read their own group's profile and its latest 20 edits. An audit-write failure rolls back the profile update.

Existing groups begin with an empty description and revision zero. This service currently has no website route or UI. Still required are session-bound APIs, same-origin and preview protections, website controls, emblems, expanded member ranks, shared screenshots, verified Territory/battle history integration and staging verification. Group Treasury and diplomacy remain separate incomplete roadmap requirements.

Private /api/group-headquarters routes now expose current-group profile reads and owner updates behind GROUP_HQ_ENABLED=1. Session Steam identity selects the group, with same-origin JSON writes and GROUP_HQ_READ_ONLY/preview restrictions. Responses are private/no-store. HTTP tests cover forged actors, outsiders, members, revisions, cross-origin requests, group isolation, owner succession and disbanding with retained audit entries. Browser controls and remaining Headquarters scope still require implementation.
