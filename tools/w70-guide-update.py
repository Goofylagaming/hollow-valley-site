"""Insert verified W66-W70 instructions while preserving earlier chapters/history."""
import argparse, json, re
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--commit',required=True);p.add_argument('--published-at',required=True);p.add_argument('--release-info',required=True);a=p.parse_args()
assert re.fullmatch('[0-9a-f]{40}',a.commit)
info=json.loads(Path(a.release_info).read_text());manifest='eebdbfbd252ad046be6a3152bd4dd893212a1a74137bb0687b230e73e69d47ee'
assert info['version']==a.commit and info['manifest_sha256']==manifest
assert info['notes_commit']=='c95cc19f22a5d665c268731f11a7c18232a2cb25' and len(info['notes'])==14
at=datetime.fromisoformat(a.published_at.replace('Z','+00:00')).astimezone(ZoneInfo('Australia/Brisbane'))
root=Path('brand-sites/wiki-source');file=root/'web/wiki/index.html';old=file.read_text();assert 'id="w70-player-guide"' not in old
assert 'Latest verified Web Preview: W65' in old
sections=[('w66-player-guide','W66 Legacy Progression','''
<p>Open <strong>Expedition Journal → Legacy &amp; Collections → Legacy</strong>. The phone Journal section selector opens the same screen. Fifteen permanent progression milestones grant up to <strong>15 Legacy points</strong>, one when each goal is earned. Existing recorded progress counts. The original thirty Journey goals remain, bringing the total to 45.</p>
<p>Choose one of three capped tracks and review the displayed before/after allocation before confirming. Each track takes at most five points: <strong>Expedition Ferocity</strong> adds 1% innate battle Attack per point; <strong>Expedition Vitality</strong> adds 1% innate Health; <strong>Nursery Knowledge</strong> shortens newly created egg incubation by 1%.</p>
<p>These percentages affect innate stats, not equipment. They do not rewrite the creature's base stats. <strong>Free reviewed respec</strong> returns allocated points without resetting the campaign, deleting companions, removing earned goals or paying milestone currency again. Legacy record titles progress at 0, 3, 6, 10 and 15 new goals; the titles themselves add no power.</p>
<p>Points travel with this Web save and cloud account. They are not cashable, transferable or shared with World. Milestone Bones, Prime Essence and Shards still require their own explicit, one-time claim. Viewing the page or spending/respeccing points never duplicates those rewards.</p>
'''),('w67-player-guide','W67 Species Mastery Trees','''
<p>Open <strong>Legacy &amp; Collections → Species Mastery</strong>, select a non-hybrid species and review its tree. The existing 10, 25, 50, 100 and 250 recorded-win ranks grant one point each: <strong>five points per species</strong>, shared by all its individuals including hatchlings. Duplicate companions do not multiply points. Hybrid species remain excluded.</p>
<table><thead><tr><th>Branch</th><th>Root</th><th>Second node</th><th>Final node</th></tr></thead><tbody><tr><td>Predator</td><td>+2% Attack</td><td>Pursuit: +3% Attack</td><td>Apex Focus: +4% Attack</td></tr><tr><td>Warden</td><td>+3% Health</td><td>Bulwark: +4% Health</td><td>Ancient Guard: +6% Health</td></tr><tr><td>Adaptation</td><td>+1% Attack and Health</td><td>Versatility: +2% each</td><td>Natural Balance: +3% each</td></tr></tbody></table>
<p>Learn each branch in order. Spend at most five points across the nine nodes; mixed builds are allowed. Node bonuses add to Legacy percentages before multiplying innate stats. A reviewed, free species respec preserves all recorded wins.</p>
<p>Actual combat, previews, estimated pack power, Training Grounds and newly frozen expedition crews use these modifiers. An already frozen encounter keeps its original stats. The mastery planner still shows the next rank and wins needed; the new tree adds functional choices rather than merely renaming the planner.</p>
'''),('w68-player-guide','W68 Sanctuary Habitat Upgrades','''
<p>Use <strong>Sanctuary → Habitats</strong> to assign reserve companions, then open <strong>Legacy &amp; Collections → Habitats</strong> to review and buy upgrades. Forest, Wetlands, Plains, Desert and Alpine each have three levels. Existing assignments and unlocked decorations remain.</p>
<table><thead><tr><th>Upgrade</th><th>Bones</th><th>Stone</th></tr></thead><tbody><tr><td>Level 0 → 1</td><td>2,000</td><td>10</td></tr><tr><td>Level 1 → 2</td><td>6,000</td><td>30</td></tr><tr><td>Level 2 → 3</td><td>12,000</td><td>60</td></tr></tbody></table>
<p>Buying an upgrade requires <strong>three available reserve residents</strong>. Active party members, retired companions and creatures reserved in a mission, operation, dungeon, Ancient Hunt, Rift or Ascent are unavailable. The review shows exact costs and the resulting level; a stale or underfunded confirmation changes nothing.</p>
<p>Each purchased level provides <strong>1% shorter new-egg incubation</strong> while that habitat has three eligible residents. Five fully upgraded habitats provide up to 15%, plus up to 5% Legacy Nursery Knowledge. This care reduction follows the existing Nursery Shelter reduction and retains the <strong>15-minute incubation minimum</strong>.</p>
<p>Paid levels stay purchased when residents leave; only their passive care pauses. Upgrades are not refundable. <strong>Eggs already incubating never have their ready time changed</strong> by an upgrade, assignment or respec. Browsing the planner never moves a companion or spends resources.</p>
'''),('w69-player-guide','W69 Recessive Genetics and Bloodlines','''
<p>Open <strong>Legacy &amp; Collections → Genetics</strong>. At 25% natural Growth, an owned, non-retired companion can be <strong>sequenced for free after review</strong>. A previously unsequenced individual receives a stable identity-based dominant or carrier result, never an immediately expressed two-recessive result. This is a game rule, not a claim about a previously recorded hidden trait. Sequencing an already recorded genome never rerolls it.</p>
<table><thead><tr><th>Locus</th><th>Dominant / carrier</th><th>Expressed recessive</th></tr></thead><tbody><tr><td>Keen Instinct: K/k</td><td>KK / Kk: no bonus</td><td>kk: +2% innate Attack</td></tr><tr><td>Deep Vitality: V/v</td><td>VV / Vv: no bonus</td><td>vv: +3% innate Health</td></tr></tbody></table>
<p>A new egg inherits one allele from each parent at each locus. Two carriers give <strong>25% dominant, 50% carrier and 25% expressed</strong> chances for that locus. Unsequenced parents count as dominant. The egg records its genome when created; reopening, reloading and hatching do not reroll it. Existing unsequenced companions and eggs are not rewritten.</p>
<p>The Hatchery preview shows the exact dominant/carrier/expressed distribution for the chosen parents. The partner adviser can combine a target offspring species, the original one- or two-copy gene target and an expressed recessive trait. These independent probabilities combine; a forecast is not a guarantee. Check the eligibility, costs and incubation shown by the actual breeding review before creating an egg.</p>
<p>Existing Apex Instinct, Ancient Hide and Adaptive Nature gene rolls, parental mutation inheritance, close-relative rules, cooldowns, egg and offspring limits remain in force. JSON, compact saves, cloud persistence and lineage records retain genomes. No paid random breeding reward or extra currency is introduced.</p>
'''),('w70-player-guide','W70 Collection Journal and Save Safety','''
<p><strong>Expedition Journal → Legacy &amp; Collections → Collection</strong> lists the canonical species catalogue. Search by species, diet or rarity and filter by group or owned/missing status. Each species counts once toward collection goals; individual, fully grown and retired counts remain visible. Retired owned companions still belong to the collection. Hybrids are evolved through the Genetic Lab rather than ordinary recruitment.</p>
<p>The fifteen new milestones cover Legacy, mastery, habitat decorations, lineage and collections. Track them on the existing Outpost display. Use <strong>Claim ready progression rewards</strong> to collect only these new goals, or claim individually. Rewards are paid once per save and earned goals stay recorded after changing gear, teams or assignments.</p>
<h3>W70 verified save compatibility — format 32</h3>
<p>Web saves now use <strong>format 32</strong>. Older supported saves import conservatively: missing new data never invents purchases, allocated points or genomes. Invalid new fields are rejected instead of being silently removed. Ordinary cloud saving cannot downgrade the format, remove earned/claimed progression milestones, erase purchased habitat levels or erase/reroll recorded genomes. Explicit archived recovery remains separate and retains the displaced save.</p>
<p>Progression mutations are reviewed against the latest save at confirmation. Duplicate, modified, changed or underfunded reviews fail without partial spending, while unrelated wallet accrual is preserved. Changes are blocked during an active/preparing battle, a prepared Offline Journey, or a pending mission, expedition, hunt, Rift or Ascent. Finish and collect the assignment first.</p>
<p>New frozen expedition snapshots capture the current perks. Existing frozen encounters and incubating eggs keep their original terms. <strong>Web and World saves remain separate</strong>; this release adds no automatic migration between them. Keep a JSON backup before switching versions, and do not use an older Web client to overwrite newer progress.</p>
''')]
nav=''.join(f'<a data-wiki-nav href="#{i}">{title}</a>' for i,title,_ in sections)
body='\n'.join(f'<section class="wiki-topic" id="{i}"><h2>{title}</h2>{text}</section>' for i,title,text in sections)+'\n'
new=old.replace('<summary>Recent updates</summary>','<summary>Recent updates</summary>'+nav,1)
new=new.replace('<section class="wiki-topic" id="w65-player-guide">',body+'<section class="wiki-topic" id="w65-player-guide">',1)
new=new.replace('Latest verified Web Preview: W65','Previous verified Web Preview: W65',1)
intro=(f'<p><strong>Latest verified Web Preview: W70 — Legacy, Mastery &amp; Bloodlines (W66–W70 bundled release).</strong> '
       f'Verified LIVE build <code>{a.commit}</code>, published <strong>{at.strftime("%d %B %Y, %H:%M AEST")}</strong>. '
       f'The complete candidate passed <strong>1,587 Web tests, 61 cloud tests and 100 desktop/mobile browser cases</strong>. '
       f'Fourteen ordered player notes match gameplay manifest <code>{manifest}</code>. '
       'The five chapters below cover spendable Legacy points, branching species mastery, purchasable habitat care, recessive inheritance and collection rewards. '
       'W66–W69 are increments bundled into this W70 release, not separately claimed LIVE versions. All earlier guide chapters and release history remain below.</p>\n')
new=new.replace('<section class="wiki-topic" id="overview"><h2>Overview</h2>','<section class="wiki-topic" id="overview"><h2>Overview</h2>\n'+intro,1)
new=new.replace('Preview W65</span>','Preview W70</span>',1).replace('verified Web Preview through W65.','verified Web Preview through W70.',1)
oldids=re.findall(r'<section class="wiki-topic" id="([^"]+)"',old)
newids=re.findall(r'<section class="wiki-topic" id="([^"]+)"',new)
assert len(newids)==len(oldids)+5 and len(set(newids))==len(newids)
assert [x for x in newids if x in oldids]==oldids
assert re.findall(r'data-wiki-nav href="#([^"]+)"',new)==newids
for sid in oldids:
    if sid=='overview':continue
    pattern=rf'<section class="wiki-topic" id="{re.escape(sid)}">.*?(?=<section class="wiki-topic"|</article>)'
    assert re.search(pattern,old,re.S).group()==re.search(pattern,new,re.S).group(),sid
file.write_text(new)
archivepath=root/'release-archive.json';archive=json.loads(archivepath.read_text());history=json.dumps(archive,sort_keys=True)
assert all(x['version']!='W70' for x in archive['web'])
entry={'version':'W70','title':info['title'],'notes':info['notes'],'published':at.strftime('%Y-%m-%d'),'commit':a.commit,'source':'https://primalboundgame.com/web/release-info.json','save_compatibility':'Web save format 32; conservative import of older supported saves, protected Legacy/milestone records, purchased habitat levels and persistent genomes. Existing eggs and frozen assignments retain their terms. Explicit archived recovery remains separate. World schema 330 and World saves are unchanged.'}
archive['web'].insert(0,entry);assert json.dumps({**archive,'web':archive['web'][1:]},sort_keys=True)==history
archivepath.write_text(json.dumps(archive,ensure_ascii=False,indent=2)+'\n')
readme=root/'README.md';r=readme.read_text();readme.write_text(f'## Verified W70 completion — {at.strftime("%d %B %Y, %H:%M AEST")}\n\nLIVE game commit `{a.commit}`, manifest `{manifest}`, fourteen ordered notes and Web save format **32**. The five W66–W70 how-to chapters document actual Legacy investments, mastery branches, habitat upgrades, recessive genomes and collection rewards. Candidate verification: 1,587 Web, 61 cloud and 100 browser cases. All earlier chapters, archives and the separate World guide remain unchanged. This documentation update does not modify gameplay, player data, DNS or other services.\n\n'+r)
print('Added five chapters and one verified bundled W70 archive entry; all previous chapters/history preserved.')
