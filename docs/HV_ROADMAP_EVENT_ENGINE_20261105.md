# Event Engine — staff template builder

Roadmap #14 is Building / Testing. Local branch
`feature/hv-roadmap-event-engine-20261105` starts from the challenge implementation
at `010caec7`; nothing from this branch has been published or deployed.

## Implemented staff workflow

The Events page includes a staff-only template builder, behind
`EVENT_ENGINE_ENABLED=0` by default. It supports Fight Night, Migration, Hide &
Seek, Last Dino Standing, King of the Hill, Herbivore Migration, Territory
Tournament and Scavenger Hunt. Staff enter a title, description, rules, planned
duration, participant capacity and team count. A single pool uses one team.
Capacity and team count are planning limits, not assigned or registered players.

An explicit review freezes the exact request in memory before confirmation.
Creating or editing saves a draft revision; archiving retains its rules and
history and removes it from active lists. Archived plans cannot be edited or
revived by retrying an old save. Staff can include archived records and expand
earlier revision history to inspect its rules. Lists and history have bounded
25-record pages. Definitions, audit attribution and retry receipts commit in one
SQLite transaction, without writing any wallet/game/Discord tables or outboxes.

Concurrent editors use the displayed revision. A stale editor gets a conflict,
then must load current details and review again. Request keys bind the actor,
target, expected revision, action and canonical definition. An exact retry returns
its original saved revision plus the current record, so it cannot overwrite a
later edit. A lost reply retains a manual retry in the current page; no automatic
POST retry or private browser storage is used. Reload loses that in-memory review;
staff must inspect the saved list before creating another plan. Thirty new changes
per minute per staff account are allowed; exact receipt recovery remains available.

`/api/event-templates` checks the current users table for ID, linked Steam identity
and admin access on every operation, including duplicate reads/requests. Writes
require same-origin JSON and reject cross-site requests, a disabled builder,
`EVENT_ENGINE_READ_ONLY=1` and deployment previews forced read-only by the shared
site guard. The browser checks current identity and staff availability around
delayed reads/writes and clears private drafts/history on account or access changes.
All API responses are private/no-store. User text is rendered as text.

The public release register retains the original #14 description and shows the
unfinished scope. Historical votes remain stored and no longer consume active
ballot slots; nine ideas remain eligible. Homepage planning asset version is 113.

## Remaining full Event Engine requirements

- Version-bound event instances and reviewed scheduling, including lifecycle,
  cancellation, timezone and frozen-template rules.
- Registration, participant permission/eligibility, capacity and waitlist policy,
  team allocation and countdowns.
- Appropriate evidence and results for each event type, with staff review and
  contradiction/recovery handling. Registration is not attendance or victory.
- Reward policy and authenticated staging. This roadmap does not authorize new
  automatic payouts, restores or game commands. Existing event rewards remain
  separate and unchanged.
- Official Discord/website/map delivery, shared bot ownership coordination and
  real lifecycle feed verification. A saved template never starts a game event,
  creates an official Discord event or sends an announcement.

Production authentication, live data, hosted staging and actual delivery remain
unverified. No completion date is assigned to this feature.

## Local verification

53 affected tests pass across the template service/private HTTP routes, staff
attendance, group event rosters, preserved production scripts, roadmap ballots,
homepage integration and navigation. Tests cover all eight kinds, validation,
conflicting editors, exact retries after later edits, archive immutability,
current staff identity, failed-history/receipt rollback, bounded pages and limits.
An unrelated synthetic wallet balance is unchanged by template work.

The actual Events page passes at 1440px and 390px for template review/save,
lost-reply recovery, conflicts, revision history, archive, previews, text escaping,
account changes and staff demotion while a list response is delayed. The existing
staff attendance review fixture also passes both widths with the added template
script present. Browser fixtures use local synthetic accounts/data and do not
establish real Steam authentication or hosted staging. `git diff --check` passes.
The dedicated Event Engine workflow is prepared but has not run on GitHub for
this unpublished branch.
