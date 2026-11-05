# Reviewing challenge map rules

This workflow prepares the travel/Highlands configuration for roadmap #3. No
real Highlands geometry is bundled. Keep collection disabled until actual map
geometry, units, feed identity/cadence, policy and authenticated staging are reviewed.

Use Node 24 from the repository root. The host-operator tool never loads `.env`,
infers a database path, creates a new database file or changes collection flags.
It is not a browser authorization boundary: access to the host and database is
the operator's authority. The reviewer Steam ID is an audit attribution supplied
by that operator, not an independently authenticated Steam login.

## Review the actual geometry first

Prepare a JSON catalog with `version`, `mapVersion`, `units` set explicitly to
`unreal-centimetres`, integer `bounds`, `highlands.polygon` and `reviewNote`.
Versions are lower-case identifiers. Bounds/vertices must fit within ±10,000,000
raw units. Polygons have 3–100 unique vertices, enclose a non-zero area and cannot
intersect themselves. `reviewNote` records the evidence used to verify the map.
It is evidence supplied by the reviewer; validation cannot establish its truth.

The command examples below use placeholder filenames and IDs. Supply the actual
reviewed catalog, existing authoritative database and operator identity.

```powershell
node scripts/review-challenge-map.cjs review --file REVIEWED_MAP.json --preview NEW_REVIEW.html
```

Review opens no database. The output includes the canonical rules and exact
SHA-256 digest. The optional new HTML artifact displays the polygon, bounds,
numbered vertices, units, map version, review note and digest. It works offline
with no scripts or network resources. Raw X is drawn right and raw Y down; no
compass direction or basemap alignment is invented. Compare the diagram and
coordinates with verified game-map evidence. A valid polygon is not automatically
a valid Highlands boundary.

Existing review artifacts cannot be overwritten. Changing any effective rule or
review note changes the digest and requires a new review. Windows UTF-8 BOM input
is accepted without changing the canonical meaning.

## Stage without activation

```powershell
node scripts/review-challenge-map.cjs stage --file REVIEWED_MAP.json --database EXISTING_AUTOMATION.sqlite --reviewer OPERATOR_STEAM_ID --digest REVIEWED_SHA256
```

Without `--write`, staging is a read-only check. It does not create tables or
register the catalog. The existing file must contain initialized Legacy/challenge
tables; an unrelated wallet or website database is rejected before modification.
The target's resolved path is included in the result for review.

After reviewing the exact path, file and digest, repeat with `--write` to register
the immutable version. Registration records its reviewer and creation time and
does not select it for collection. A reused version with different rules fails.

```powershell
node scripts/review-challenge-map.cjs inspect --database EXISTING_AUTOMATION.sqlite --version CATALOG_VERSION
```

Inspection opens the file read-only and performs no migrations, including on older
catalog audit schemas. It shows the selected canonical rules, saved reviewer,
active version and recent audit entries. Saved rules are revalidated against their
digest; damaged geometry is rejected rather than repaired or silently trusted.

## Activate only the reviewed version

```powershell
node scripts/review-challenge-map.cjs activate --database EXISTING_AUTOMATION.sqlite --version CATALOG_VERSION --digest REVIEWED_SHA256 --active-version none --reviewer OPERATOR_STEAM_ID
```

This is also a read-only check unless `--write` is supplied. Use the exact current
version from inspection instead of `none` when replacing an active catalog. A
changed active version or digest fails; inspect again rather than forcing it.
The source repeats the active-version check inside its SQLite write transaction.
Activation, audit and removal of old position baselines commit together. Previous
progress receipts remain associated with their own immutable catalog version.

Activation can affect future collection if the running service already has both
challenge/location flags enabled and the matching map version configured. This
tool does not toggle those settings. Keep them disabled for preparation. Changing
live configuration or deploying the feature remains a separate release action.

If a command's outcome is uncertain, use read-only inspection to verify its
active version, digest and audit. Do not force a stale expected version or rewrite
the saved rules to make a retry succeed.

## Stop an active catalog

```powershell
node scripts/review-challenge-map.cjs deactivate --database EXISTING_AUTOMATION.sqlite --version CURRENT_VERSION --digest CURRENT_SHA256 --reviewer OPERATOR_STEAM_ID
```

The default is read-only. With `--write`, the exact reviewed current version is
deactivated and audited. Position baselines and activation cursors are removed
atomically. Even a stop/restart between two observations cannot bridge a location
pair. Deactivation does not refund, pay coins, erase unrelated history or change
general/location consent. Retained progress is subject to its normal expiry.

An exact known version/digest can be stopped even if its saved payload fails
integrity validation; stopping does not use or repair that geometry. Inspection
afterward must establish the resulting state. A repeated stop with a stale active
version fails safely, so inspect rather than assuming a second mutation is needed.

## Local evidence and outstanding gates

Operator tests cover read-only defaults/schema preservation, wrong/missing files,
changed digests, immutable versions, activation/deactivation, audit migration,
coordinate-baseline clearing, payload integrity and preservation of unrelated
wallet data. A synthetic offline artifact was rendered and visually inspected.
No real catalog or live database was staged/activated during these checks.

Real Highlands boundaries, current-map alignment/units, source sampling at most
120 seconds apart, teleport/anti-farming rules, staff policy, authenticated staging
and deployment verification remain required. The full roadmap goal is not complete.
