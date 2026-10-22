# Homepage redesign

The homepage presents 31 feature ideas in six proposed stages, with native keyboard-accessible disclosures for stages and individual descriptions. Full-roadmap and collapse controls expose or close all details. The original feature numbering is retained. Stages are editorial groupings, not delivery dates or claims of live availability.

The existing logo sits beside the roadmap on desktop and above it on narrow screens. Wallet, Quests, Skin Studio and Marketplace retain their existing routes and summary hooks; Live Map and Events have additional homepage links. The species section and its dialog are removed from the homepage only. Shared player search is removed from the navigation; the dedicated Friends player search remains available. Authorized Admin navigation can wrap on desktop and remains in the existing mobile menu.

No backend, database, deployment configuration, game automation, Territory Wars implementation or Skin Studio backend files are changed. Production baseline inspected: `5149212a33c0090814b1b33166f660b2a9f5a47d` (Render deploy `dep-dbcnkbej5dgc739oo010`).

## Illustration assets

Created using the built-in image generation tool; converted to 760px-wide WebP at quality 84 for delivery. Files are under `public/assets/images/`:

- `home-wallet.webp`: antique leather coin pouch spilling gold coins onto mossy stone among ferns.
- `home-quests.webp`: ancient parchment quest scroll, brass compass and feather quill on mossy stone among ferns.
- `home-skins.webp`: beautifully patterned emerald and amber dinosaur head in profile, colorful intricate skin markings and lush ferns.
- `home-marketplace.webp`: wooden jungle trading stall displaying dinosaur eggs, leather bags, gold coins and lush ferns.

Shared prompt direction: wide 3:2 fantasy game illustration for a Hollow Valley navigation card; detailed painterly prehistoric fantasy world, dark forest green and warm antique gold, atmospheric light; full bleed illustration only, no text, letters, interface or border.

The previous conversation exposed the original screenshots but did not expose its final generated mockup. Implementation follows the user's explicit layout description and the roadmap descriptions supplied in this task.

## Validation

- 51 focused frontend, routing and production feature-preservation checks passed locally.
- Browser preview uses the real Express app with an isolated SQLite database and intercepted local API fixtures; no production player data is involved.
- Checked all 31 disclosures, expand/collapse, keyboard operation and Admin submenu access.
- Checked 390px phone, 768px tablet, 1051px breakpoint and 1440px desktop layouts for horizontal overflow.
- Production deployment and public-domain verification are required before declaring the release complete.
