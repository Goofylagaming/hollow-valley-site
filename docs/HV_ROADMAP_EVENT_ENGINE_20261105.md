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
ballot slots; nine ideas remain eligible. Homepage planning asset version is 114.

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

## Remaining full Event Engine requirements

- Verified event lifecycle beyond website plans, including actual start/end and
  outcome evidence, operational rehearsal and authenticated staging.
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

After the website scheduling integration, 61 affected tests pass. The real Events
schedule workflow passes at 1440px and 390px for frozen drafts, explicit public
publication, lost replies/retries, conflicting reschedules, member privacy,
incorrect client clocks, elapsed planned starts, cancellation, delayed stale
calendar replies and staff demotion. These are local synthetic plans and do not
establish hosted/publication or real game behavior.
The existing template and staff attendance browser fixtures also pass both widths
with the schedule assets installed. The prepared workflow runs all three browser
fixtures. No hosted run, merge, deployment or real schedule publication occurred.
