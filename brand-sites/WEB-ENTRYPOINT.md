# Primalbound Web play entry

Primary Play on the web / Enter Primalbound Web buttons use `https://primalboundgame.com/web/`, the stable branded game gateway. A public preflight must confirm that it serves the same release commit, gameplay manifest and actual entry asset as the deployed cloud game before changing or publishing these links. A Render hostname alone does not prove a game is outdated.

The static-only `/web/` landing page retains an explicitly labelled hosted fallback instead of linking to itself; normal branded traffic is served by the existing game gateway. No gateway, DNS, authentication cookie, cloud save or deployment branch changes are made by this link fix. Browser-local saves remain origin-specific: use the existing cloud account or export a JSON backup from the original address rather than starting a new save accidentally.

The static validator checks all primary Web play buttons and rejects direct preview-host homepage destinations. This marketing-link fix is not a new gameplay release and must not trigger a duplicate HerbyBot announcement.
