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
ballot slots; nine ideas remain eligible. Homepage planning asset version is 116.

## Reviewed website schedules

`EVENT_ENGINE_SCHEDULES_ENABLED=0` separately gates scheduling. With both this and
the general Event Engine flag enabled, staff can create a private event draft
from the exact displayed template revision. The database freezes that definition,
template ID/revision, planned start and derived end. A changed or archived source
blocks a new draft against its old revision. Later template edits/archival never
rewrite existing events. New instances can still be made from a current draft
template; each has its own durable event ID.

Staff separately review publishing a saved draft. The review explicitly includes
the public rules and Brisbane schedule. Only `scheduled` website plans enter the
public calendar. Drafts, staff reasons, actor identities and template metadata
remain private. Public descriptions/rules are the text staff explicitly publish.
Registration and rewards remain unavailable. Countdown text uses the server's
read time plus elapsed browser time, so a wrong client wall clock does not change
it. Passing a planned start/end never changes status to live/completed or supplies
attendance/outcome evidence; the page labels the lack of game confirmation.

Future schedules can be rescheduled with a revision and staff reason. Cancellation
removes a listing from the public calendar but preserves its frozen rules, times,
history and receipts. It records a website listing decision, not an in-game
outcome. Cancelled identities cannot be reused or revived. Rescheduling after a
planned start is blocked. Fresh drafts/edits/publication must start in the future
within 366 days. Exact committed retries remain recoverable after those times or
later edits/cancellation, without applying their action again.

Schedule changes and audit/receipt writes share one transaction. The same current
staff, same-origin JSON, preview/read-only and rate protections as templates apply.
Lists and histories have bounded 25-record pages. Public pages use start-time/ID
cursors, include scheduled plans whose end is within the past 24 hours or later,
and never expose private draft/history fields. The staff screen shows the latest
25 history entries; the private history API provides older pages. Calendar
refreshes remove cancelled listings, discard older overlapping replies and clear
unavailable data rather than retaining a supposedly current schedule.

The browser retains an uncertain request only in page memory for explicit retry;
reload requires inspecting the saved list. No private browser storage, automatic
POST retry, official Discord event, bot announcement, game action or wallet change
is installed. The new Events scheduling assets are v1.

## Steam-bound event registration

`EVENT_ENGINE_REGISTRATION_ENABLED=0` independently gates new registration.
When enabled along with templates and schedules, the public calendar offers
registration management. Linked Steam players review the exact published event
revision, times and rules before reserving a place. The private API rechecks the
current website user ID/Steam binding, exact-origin JSON and preview protections;
client-supplied player identities and additional mutation fields are rejected.

Seats are reserved atomically in SQLite with consent revisions, immutable request
receipts and private history. Concurrent independent workers cannot take the same
last place. Full events reject new signups explicitly; this version has no
waitlist, automatic enrollment or promotion. Actual attendance, group/individual
Discord RSVPs and paid group-event registrations remain separate. No wallet,
attendance evidence, reward or game command is changed by registration.

A reschedule preserves a player's place and original accepted snapshot, then
labels it as needing review. It does not silently accept the new time. Explicit
reconfirmation accepts the current event revision without reserving another seat,
including when capacity is full. Cancelled schedules are displayed as cancelled;
stored signup history remains. Fresh signup/reconfirmation is blocked at the
planned start and after cancellation. Players may still withdraw after a start,
while rollout flags are paused, after cancellation or if source data is missing.
Preview/read-only restrictions still block writes.

Exact committed retries recover the saved result and current choice, even after
rescheduling, cancellation, a later choice or rollout pause. They never overwrite
that later choice. Thirty schedule edits and twenty player registration changes
per minute have separate limits; a real withdrawal and exact receipt recovery are
not blocked by the player change limit. Source/evidence, history and receipt
failures roll back registration and seat changes together.

Players see only their own registration list/history and aggregate reserved-place
counts for a visible event. There is no public participant roster or endpoint for
reading another player's history. Private APIs use no-store responses and bounded
25-record pages. The screen shows recent history; older pages remain available
through the private API. History and replay receipts remain after withdrawal, as
stated in the confirmation review. No private browser storage is used; a lost
mutation reply can be manually retried in the page. Reload requires reading the
saved choice. Delayed replies cannot reveal a prior account's registration.
Unhandled read/access failures clear private display data.

The Events registration assets are v1 and public schedule script is v2. All flags
remain off in example configuration. This is local development only.

## Staff rosters and reviewed planned teams

`EVENT_ENGINE_TEAMS_ENABLED=0` separately controls new planned-team changes. Staff
can read published/cancelled event rosters and retained team history during a
rollout pause. The roster contains reserved registrations, current linked-account
availability and confirmation for the current schedule. Pending reschedule
confirmations and unavailable accounts are shown but excluded from assignment.
This does not verify species, age, actual presence or event-specific game rules.

A deterministic round-robin proposal distributes confirmed registrants among the
frozen template's team count. Staff can change individual team numbers before
reviewing. Every currently confirmed registrant must appear exactly once; unknown,
missing and duplicate players fail. Team numbers must be within the planned count,
and no team may exceed `ceil(capacity / teamCount)`. Saving teams changes no seat,
wallet, attendance evidence, Discord role or actual game group.

The review binds event revision, previous team-plan revision, explicit assignments
and a digest of every reserved Steam identity, registration/accepted-event revision
and current linked website account ID. Display names are presentation, not identity.
A changed registration, withdrawal, reconfirmation, linked-account loss or schedule
invalidates the old plan for current display. There is no automatic reshuffle.
Staff must inspect the refreshed roster and explicitly save a new plan. Cancellation
suppresses planned-team display. Existing history remains immutable.

Plan, full frozen roster/event audit and request receipt commit atomically. Current
staff access, same-origin JSON and preview/read-only guards protect all writes.
Thirty new changes per staff account per minute are allowed; exact receipts remain
recoverable after a rollout pause or roster change, returning original saved data
plus current validity without repeating the change. Fresh edits stop at planned
start. Saved planned teams may still be read afterward, without implying an actual
game event. Lists/history use bounded 25-record pages; an inspected roster is bounded
by the template's maximum 500 places. The screen shows recent history and the API
provides older pages.

Players see only their own current planned team through private registration
reads. Public calendar output and member APIs do not return other registrants or
staff rosters. Stale or damaged team evidence produces an unassigned/unavailable
state rather than a fabricated team; damaged evidence does not prevent withdrawal.
The staff browser checks current access around delayed reads and clears private
names, Steam IDs, review details and history after an account/access change.
Reviews and uncertain retry requests remain only in page memory, with no browser
storage or automatic POST retry. Reload requires inspecting saved plans.

The staff team assets are v1 and private registration script is v2. All rollout
flags remain off in example configuration. Hosted staging, real authentication
and in-game validation remain unfinished.

## Remaining full Event Engine requirements

- Verified event lifecycle beyond website plans, including actual start/end and
  outcome evidence, operational rehearsal and authenticated staging.
- Event-type-specific participant eligibility, actual game-team integration,
  operational capacity review and any later waitlist policy. Website signup is
  not proof that a player meets in-game event rules or is actually present.
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

After the website scheduling integration, 61 affected tests pass. The real Events
schedule workflow passes at 1440px and 390px for frozen drafts, explicit public
publication, lost replies/retries, conflicting reschedules, member privacy,
incorrect client clocks, elapsed planned starts, cancellation, delayed stale
calendar replies and staff demotion. These are local synthetic plans and do not
establish hosted/publication or real game behavior.
The existing template and staff attendance browser fixtures also pass both widths
with the schedule assets installed. The prepared workflow runs all three browser
fixtures. No hosted run, merge, deployment or real schedule publication occurred.

Registration raises the affected set to 71 passing tests, including two independent
SQLite workers competing for the last place, failed-audit/receipt rollback,
reconfirmation at full capacity, paused/cancelled/past-start withdrawal, bounded
private pages and missing-source recovery. The actual Events registration screen
passes at 1440px and 390px for explicit review, lost replies and exact retries,
reschedule consent, preview restrictions, paused withdrawal, private history,
account changes and text escaping. Schedule, template and staff attendance browser
fixtures also pass both widths with registration installed. All identities/events
and balances in these checks are synthetic. The workflow now includes all four
browser fixtures. Real Steam sessions, hosted staging and production remain gates.

Reviewed team plans raise the affected set to 80 passing tests. These include
staff access/revocation, stale roster/event/plan conflicts, complete unique member
sets, team size limits, changed-account exclusion, audit/receipt rollback,
paused retry recovery, planned-start boundaries and damaged evidence without
blocking player withdrawal. Team history pagination and rate limits pass.

The actual Events team workflow passes at 1440px and 390px for staff-only rosters,
manual proposal changes, explicit review, lost-response retry, stale-roster
recovery, own-team player display, paused history and delayed-read demotion.
Registration, schedule, template and existing staff attendance browser fixtures
also pass both widths with team assets installed. The prepared workflow includes
all five browser fixtures. All checks use synthetic accounts/events; no real
players were assigned teams, and nothing was published, merged or deployed.
