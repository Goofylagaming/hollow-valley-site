/* Public planning content only. This does not enable or modify game features. */
(function () {
  // Update this release register whenever a roadmap item ships. Dates are the
  // verified production release date in Brisbane, never the date of a draft.
  const releases = {
    7: { status: 'complete', added: '2026-10-23', note: 'Live: species XP, 50 mastery levels, statistics and milestone titles. Additional skins and profile cosmetics remain future extensions.' },
    9: { status: 'complete', added: '2026-10-23', note: 'Live: nest listings, egg availability, requests, host approval and automatic closure. An accepted request reserves an advertised egg; it does not verify an in-game hatch.' },
    8: { status: 'partial', note: 'Available in Valley Legacy: verified parent/child links and lineage display. Automatic hatch detection and inherited-mutation verification are still pending.' },
    13: { status: 'partial', note: 'Available: seasonal and all-time records, Hall of Fame, presence, combat and gameplay-coin connections. Territory capture and group-battle connections are still pending.' },
    25: { status: 'building', note: 'HV-W01.2: protected incident timeline is in development, with recent operator audits and automation request outcomes. Game chat/combat correlation and long-term historical search remain planned.' },
    26: { status: 'building', note: 'HV-W01.3: authenticated private reports, bounded media links and admin-only moderation are in development behind an opt-in runtime flag. Automated chat/combat evidence correlation remains planned.' },
    29: { status: 'building', note: 'HV-W01.1: public read-only status page in development. Independent RCON, Discord, Marketplace, Steam and Live Map monitors, plus incident history, are not yet available.' },
    31: { status: 'building', note: 'Building / Testing. Completion has not yet been verified.' }
  };
  const stages = [
    { title: 'Progression & identity', subtitle: 'Build a lasting place in the Valley', features: [
      [1, 'Player Reputation + Titles', 'Persistent reputation for completing quests, Territory Wars participation, events, helping new players, winning fights and surviving long periods. Unlock titles such as Valley Veteran, Apex Hunter, Warden, Nomad and Prime Survivor. Titles could appear on profiles, leaderboards, Discord and eventually the overlay.'],
      [2, 'Achievements / Badges', 'Permanent account achievements: survive 10 hours on one dinosaur, reach Prime, win a Territory War, kill 5 different species, raise a nested baby to adult, visit every major biome or own 10 skins. Some could award Valley Coins, exclusive skins or profile badges.'],
      [3, 'Daily + Weekly Challenges', 'Dynamic challenges beyond normal quests: survive 90 minutes, travel 12 km, visit Highlands, participate in an event, grow a herbivore, play as three species or survive a Territory battle. Streak bonuses should avoid punishing players who miss a day.'],
      [4, 'Hollow Valley Battle Pass / Season Track', 'Free seasonal progression rather than pay-to-win. Earn XP through playing, quests, achievements and events. Rewards could include Valley Coins, cosmetic skins, profile frames, titles, badges and marketplace discounts. A season such as Season 1: Rise of the Valley could run for 8–12 weeks.'],
      [7, 'Species Mastery', 'Each dinosaur species gets progression independent of an individual dinosaur. Playing Rex earns Rex Mastery; playing Trike earns Trike Mastery. Levels could unlock profile cosmetics, skins, species statistics and titles rather than gameplay advantages.'],
      [13, 'Server Records', 'Records for longest-lived dinosaur, longest journey, most offspring, highest kill streak, oldest Rex, most Territory captures, most coins earned through gameplay and largest group battle. Reset some each season while keeping an all-time Hall of Fame.']
    ] },
    { title: 'Life in the Valley', subtitle: 'Every dinosaur has a story', features: [
      [8, 'Dinosaur Family Trees', 'Permanently record parent → child relationships. My Dinos could show parents, offspring, inherited mutations, generation number and lineage, creating famous Hollow Valley bloodlines.'],
      [9, 'Nest Management', 'Register nests through the website, advertise available eggs, set species and parent information, and let other players request an egg. Display availability such as 3/6 eggs and automatically close the listing when the nest is finished.'],
      [10, 'Live Map Points of Interest Discovery', 'Hide map locations until a player visits them. Discover waterfalls, caves, nesting areas, landmarks and Territory locations. Completing a region could award a badge or coins, giving footsteps tracking a gameplay purpose.'],
      [11, 'Player Journey Map', 'Store a dinosaur’s life journey as a simplified trail. After death, a “Life of Rex #483” summary could show lifespan, distance travelled, territories visited, battles, kills, nesting, mutations and final death location.'],
      [12, 'Death Recap', 'Use combat logs to show what happened when a dinosaur dies: attacker, species, growth, location or region, dinosaur age, survival time and recent combat events. Avoid exposing information that gives players an unfair live advantage.']
    ] },
    { title: 'Groups & Territory', subtitle: 'Shared history, rivalries and prestige', features: [
      [5, 'Dynamic Bounties', 'Players could place Valley Coin bounties on another player, or the server could generate bounties for high-performing killers. Example: Goofy — 2,500 V bounty — last seen Highlands. Rewards should require legitimate PvP combat and exclude repeatedly killing friends.'],
      [6, 'Heat / Wanted System', 'Repeated player kills increase threat level: Unknown → Dangerous → Wanted → Notorious → Most Wanted. An approximate region could appear on the Live Map instead of exact coordinates. Surviving while Most Wanted could award special achievements.'],
      [16, 'Group Headquarters', 'Expand Groups into clans with a profile, emblem, description, member ranks, Territory history, battle record, achievements and shared screenshots. Territory Wars would sit within this system.'],
      [17, 'Group Treasury', 'Members could donate Valley Coins into a group wallet for Territory War entry fees, group cosmetics, event registrations or cosmetic upgrades. Keep this away from anything that directly purchases combat power.'],
      [18, 'Rivalries / Alliances', 'Group leaders could formally declare another group an ally or rival. Territory Wars could preserve historical stats such as Herby Death Squad 7–3 Valley Raiders.'],
      [19, 'Territory Seasons', 'Every few months, reset Territory control while preserving historical winners. Display Season 1 Champion, total territory time, attacks won and defensive streaks to prevent permanent domination by one group.'],
      [20, 'Territory Upgrades', 'Controlling territory could generate cosmetic or progression benefits: a group banner, website border, Territory level or increased prestige. Avoid stat buffs so stronger groups do not gain increasing combat advantages.'],
      [31, 'Territory Wars', 'Territory Wars brings group competition for control of the Valley into the roadmap, alongside group history, rivalries and seasonal prestige.']
    ] },
    { title: 'Trading & collections', subtitle: 'Make the Valley your own', features: [
      [21, 'Player Trading / Marketplace Listings', 'Players could sell cosmetic skins or certain earned items to each other for Valley Coins, with transaction history, anti-scam controls and restrictions on what can be traded.'],
      [22, 'Skin Rarity + Collections', 'Extend Skin Studio into a collecting system with Common, Rare, Epic, Legendary and Event skins. Collections such as Halloween 2026, Founders Collection and Territory Champions could appear on profiles.'],
      [23, 'Skin Codes / Gifting', 'Let a player gift an owned skin or redeem a one-time promotional skin code for Discord competitions and events.'],
      [24, 'Screenshot / Dino Gallery', 'Players could upload screenshots to their dinosaur profile or account. Feature screenshots on the website, potentially with monthly community voting and Valley Coin rewards.']
    ] },
    { title: 'Events & a living world', subtitle: 'More reasons to come together', features: [
      [14, 'Event Engine', 'Admins could build templates for Fight Night, Migration, Hide & Seek, Last Dino Standing, King of the Hill, Herbivore Migration, Territory Tournament and Scavenger Hunt. Registration, teams, countdown, rewards and results could be automated.'],
      [15, 'World Events', 'Automatic server-wide events: “Migration has begun”, “Double Valley Coins for herbivores for 2 hours”, “Highlands Territory is contested” or “Predator Hunt active”. Feed Discord, the website, Live Map and eventually the overlay simultaneously.']
    ] },
    { title: 'Support & companion', subtitle: 'A clearer, more connected experience', features: [
      [25, 'Admin Incident Timeline', 'Combine chat logs, combat logs, player connections, dinosaur actions, marketplace redemption and admin commands into a searchable timeline. Admins could open a player and see what happened around a report.'],
      [26, 'Player Reports With Evidence', 'Website reports could include the accused player, category, approximate time, explanation and screenshot or video links. The admin panel could automatically attach relevant chat and combat logs from that period.'],
      [27, 'Admin Spectator Dashboard', 'One page for online population, species distribution, regions, FPS and server health, current battles, pending body drops, failed marketplace redemptions, suspicious combat patterns and recent errors.'],
      [28, 'Automatic Compensation System', 'After a verified server failure kills or corrupts a dinosaur, an admin could restore growth, mutations, nutrients and Prime state from the most recent valid snapshot with one action.'],
      [29, 'Server Health Status Page', 'A public status page for Game Server, Website, RCON Bridge, Discord Bot, Marketplace, Steam linking and Live Map, including incident history without exposing sensitive server information.'],
      [30, 'Hollow Valley Companion App', 'Eventually combine VOIP, Territory overlay, notifications, server status, friends and groups, and event alerts in the planned Windows companion, connecting the game with Hollow Valley’s community features.']
    ] }
  ];
  const container = document.getElementById('home-roadmap-stages');
  if (!container) return;
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  stages.forEach((stage, index) => {
    const section = element('details', 'roadmap-stage');
    const summary = element('summary');
    summary.append(element('span', 'roadmap-stage-number', String(index + 1).padStart(2, '0')));
    const label = element('span', 'roadmap-stage-label');
      label.append(element('strong', '', stage.title), element('small', '', `${stage.subtitle} · ${stage.features.length} features`));
    summary.append(label, element('span', 'roadmap-chevron', '+'));
    const list = element('div', 'roadmap-feature-list');
    stage.features.forEach(([id, title, description]) => {
      const feature = element('details', 'roadmap-feature');
      feature.id = `roadmap-feature-${id}`;
      const featureSummary = element('summary');
      featureSummary.append(element('span', 'roadmap-feature-number', `#${id}`), element('span', '', title));
      const release = releases[id];
      feature.dataset.roadmapStatus = release ? release.status : 'idea';
      let statusText = 'Idea Stage';
      if (release?.status === 'complete') statusText = '✓ Complete, added ' + release.added.split('-').reverse().join('/');
      if (release?.status === 'partial') statusText = 'Partially available';
      if (release?.status === 'building') statusText = 'Building / Testing';
      featureSummary.append(element('span', 'roadmap-feature-status is-' + feature.dataset.roadmapStatus, statusText));
      feature.append(featureSummary, element('p', '', description));
      if (release) {
        const note = element('p', 'roadmap-release-note', release.note);
        if ([7, 8, 9, 13].includes(id)) {
          const link = element('a', '', 'Open Valley Legacy →');
          link.href = '/legacy';
          note.append(' ', link);
        } else if (id === 26) {
          const link = element('a', '', 'Player Reports →');
          link.href = '/reports';
          note.append(' ', link);
        } else if (id === 29) {
          const link = element('a', '', 'View status page →');
          link.href = '/status';
          note.append(' ', link);
        }
        feature.append(note);
      }
      list.append(feature);
    });
    section.append(summary, list);
    container.append(section);
  });
  document.getElementById('roadmap-expand-all').addEventListener('click', () => {
    container.querySelectorAll('details').forEach(detail => { detail.open = true; });
  });
  document.getElementById('roadmap-collapse-all').addEventListener('click', () => {
    container.querySelectorAll('details').forEach(detail => { detail.open = false; });
  });
})();
