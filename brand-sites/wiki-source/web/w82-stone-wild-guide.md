# W82 and Stone & Wild guide addendum

## Newer Web Preview features: W82 — Season Challenges and Saved Rewards

W82 shipped on **18 November 2026** at Web build **22fca6ae6ae9a8a9755440d2c7949ad4ae209e1c**. It adds daily and weekly challenges to the existing optional Season Zero pilot. Shipping these controls does not schedule or launch a season. W83 event controls remain a future update.

### W82 challenge access and enrollment

Open **Expedition Operations → Discoveries & Relics → Season Zero**. When an operator has scheduled Season Zero and its enrollment window is open, review and confirm its free enrollment. The **Season challenges** section shows eligible daily and weekly discovery goals, progress, rewards and exact dispatch windows in AEST. An unscheduled season has nothing to enroll in; opening the board gives no rewards.

| Challenge | Requirement | Explicit reward | New period begins |
|---|---|---|---|
| Daily discoveries | Fully extract three eligible world discoveries | 300 Bones and 3 Herbs | Every day at 00:00 AEST |
| Weekly discoveries | Fully extract twelve eligible world discoveries | 1,200 Bones, 3 Prime Essence and 2 Shards | Monday at 00:00 AEST |

One eligible discovery advances both goals. Win all three encounters and extract the cargo. Ordinary operations, partial extraction, pre-enrollment dispatches and discoveries dispatched after the season closes do not earn challenge progress. Existing discovery eligibility and region/window duplicate protections still apply.

### W82 dispatch windows and saved rewards

The dispatch time determines the day and week. A discovery dispatched on Sunday at 23:59 AEST still belongs to Sunday's daily goal and the ending week if extracted on Monday. An eligible held expedition can also finish after the season closes. The server calendar determines dispatch eligibility; changing the device clock does not select a new challenge period.

Completed rewards remain under **Earned rewards from previous periods** or **Saved rewards ready to claim** after a reset or season close. Review a reward and confirm it once. Claimed records remain in challenge history. No login streak is required, and unfinished past periods only accept eligible expeditions already dispatched during those periods.

The existing 3-, 9- and 18-point Season Zero milestone rewards remain separate. Eligible discoveries can continue advancing the daily and weekly goals after the milestone-point cap. Challenge rewards do not backfill from lifetime discovery totals or existing season points.

If the server calendar is unavailable or stale, refresh it before relying on the current period. Saved earned rewards remain reviewable offline. A confirmed unscheduled season is shown separately from a failed calendar request. If the server's season configuration changes, saved rewards are retained and the board asks for a refresh.

### W82 save compatibility

**Web save format 34** preserves supported older progress, currencies, held expeditions and the existing Season Zero ledger. An eligible held format-33 discovery can earn its first challenge evidence when fully extracted after upgrading. Plain and compact backups retain evidence and claim history. Normal cloud synchronization protects recorded challenge evidence and claims against erased receipts, changed period assignment and older-format uploads; explicit archived recovery retains the displaced save in history.

Export a recovery copy before manually importing or replacing progress, and avoid using a format-34 save in an older tab. The interface update below keeps format 34 and adds no further migration. These checks protect save consistency and duplicate claims within the existing local-save progression model. World/Desktop profiles remain separate.

## Newer Web Preview features: W82.1 — Stone & Wild UI

**Release status:** The Stone & Wild interface is verified live at the official **primalboundgame.com/web/** game address on **18 November 2026**, at Web build **f5c57b5c588e0bd7bf20b3ca1a75bbabd3e80cdf**. W82 Season Challenges shipped separately earlier that day. W82.1 is the first UI integration; W83 remains the next planned gameplay milestone.

This first pass adds forest colours, parchment panels, painted portraits and a field-journal layout to the shared shell, Sanctuary, companion records, DNA Lab and selected encounters. Other activities use the shared styling and navigation while retaining their existing page structure. Later page redesigns and W83 event controls are not included.

### W82.1 finding every activity

Use the quick navigation for **Outpost**, **Expedition**, **Sanctuary**, **DNA Lab**, **Expedition Operations** and **Expedition Journal**. Choose **Open navigation** in the header, or **Browse all activities** in the desktop rail, to open **All activities**. The complete drawer retains all 23 activities and their existing availability requirements on desktop and phones.

Tab and Shift+Tab move within the open drawer. **Close navigation**, Escape, or the backdrop returns to the game; focus returns to the opening control. If activity content cannot load, use **Try loading activities again** or **Return to game**. Opening the drawer does not change the selected activity, spend resources or alter your save.

### W82.1 Sanctuary and individual companion records

Search, filter or sort the Sanctuary portrait gallery, then choose a companion to inspect it. Browsing remains limited to 24 cards per page. Choose **View [name] companion record** to open the larger individual dossier. Existing favourite, name, growth, training, talents, family, behaviour, bonds, history and retirement controls retain their normal rules.

Companions with the same species or name remain separate owned individuals. The selected record shows its **Individual ID**; renaming one companion does not rename another or change family relationships. Close the record or press Escape to return to its opening control. Mission and habitat views remain available.

### W82.1 DNA Lab dossiers and artwork

Choose one of the six existing hybrid blueprints in **DNA Lab** to see its portrait, lineage, role, base stats, signature ability, source guardian and exact DNA/material requirements together. All six hybrids remain available: **Veilstalker, Tidefang, Ironhide, Bicephalon, Nightfall and Frostbane**. Requirements and progression locks come from the game catalog; the new artwork does not change costs, abilities or Bicephalon's Apex role.

Review your current DNA, Bones, Shards and unlock requirements before using the existing evolution control. Successful evolution still deducts the real costs and creates the actual hybrid. Selecting a blueprint or inspecting its artwork does not evolve it or spend anything.

Choose **View artwork** for a larger view of the selected blueprint. Use **Close artwork** or Escape to close it and return focus to the opener. Tab and Shift+Tab remain inside the artwork dialog. Account and battle dialogs take precedence, so navigation or artwork does not remain open behind them.

### W82.1 portrait coverage and encounters

| Painted portrait | Where it is used |
|---|---|
| Velociraptor | Existing Velociraptor species and owned companions |
| Triceratops | Existing Triceratops species and owned companions |
| Ankylosaurus | Existing Ankylosaurus species and owned companions |
| Veilstalker | Its hybrid blueprint, owned hybrid and matching mutant encounter |
| Tidefang | Its hybrid blueprint, owned hybrid and matching mutant encounter |
| Ironhide | Its hybrid blueprint, owned hybrid and matching mutant encounter |
| Bicephalon | Its hybrid blueprint, owned hybrid and matching mutant encounter |

**Nightfall and Frostbane retain their existing composite artwork.** The selected Expedition encounter uses the correct creature or mutant identity, alongside its existing briefing, loot and active-pack controls. Matching mutant battle portraits use the same identity. Artwork is presentation only; it does not change enemy strength, combat, loot, recruitment or progression.

If a portrait fails to load, the companion or blueprint remains identifiable and its existing controls stay available. Existing saves, earned records, named companions, equipment and resources remain intact. This UI pass retains W82's **save format 34** and makes no World/Desktop changes.
