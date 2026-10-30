(function () {
  const $ = (id) => document.getElementById(id);

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function formatNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString() : "—";
  }

  async function loadHome() {
    if (!window.HDS) return;

    try {
      const me = await window.HDS.loadMe();
      if (me?.loggedIn && me?.user) {
        setText("home-player-label", me.user.username || "Player");
        setText("home-player-sub", "Open your Hollow Valley profile");
      }

      if (me?.loggedIn) {
        try {
          const dashboard = await window.HDS.api("/api/dashboard");
          setText("home-dino-count", `${Number(dashboard?.dinoCount || 0)} stored / known`);
          if (dashboard?.supporter?.tierLabel || dashboard?.supporter?.tier) {
            setText("home-supporter-state", dashboard.supporter.tierLabel || dashboard.supporter.tier);
          }
        } catch (err) {
          console.warn("[home-v2] dashboard summary unavailable", err);
        }

        try {
          const wallet = await window.HDS.api("/api/wallet");
          setText("home-wallet-balance", formatNumber(wallet?.balance || 0));
          const payout = Number(wallet?.earning?.boostedCoinsPer5Minutes || wallet?.earning?.questBoostedCoinsPer5Minutes || wallet?.earning?.coinsPer5Minutes || 0);
          setText("home-wallet-rate", payout > 0 ? `${formatNumber(payout)} / 5 min` : "Verified playtime rewards");
        } catch (err) {
          console.warn("[home-v2] wallet unavailable", err);
        }

        // Read-only progression: the Profile page remains authoritative. This
        // preview label never awards XP, Valley Coins or achievements.
        try {
          const data = await window.HDS.api("/api/progression");
          const profile = data?.profile || {};
          const level = Number(profile.level);
          const rank = String(profile.rank?.name || "").trim();
          if (Number.isSafeInteger(level) && level > 0 && rank) {
            setText("home-profile-progress",
              `Level ${level} · ${rank}${data.stale ? " · Saved progress" : ""}`);
          } else if (data?.stale) {
            setText("home-profile-progress", "Progression is temporarily unavailable");
          }
        } catch (err) {
          console.warn("[home-v2] progression summary unavailable", err);
          setText("home-profile-progress", "See your latest progression in My Profile");
        }
      }
    } catch (err) {
      console.warn("[home-v2] player summary unavailable", err);
    }

    try {
      const status = await window.HDS.api("/api/server-status");
      const dot = $("home-server-dot");
      if (status?.configured && status?.online && !status?.stale) {
        dot?.classList.remove("offline");
        setText("home-server-state", "ONLINE");
        setText("home-player-count", `${Number(status.playerCount || 0)} / ${Number(status.maxPlayers || 0) || "—"}`);
        setText("home-map-players", `${Number(status.playerCount || 0)} online`);
      } else {
        dot?.classList.add("offline");
        setText("home-server-state", status?.stale ? "STATUS DELAYED" : status?.configured ? "OFFLINE" : "STATUS UNAVAILABLE");
        setText("home-player-count", "— / —");
        setText("home-map-players", "Server status unavailable");
      }
    } catch (err) {
      $("home-server-dot")?.classList.add("offline");
      setText("home-server-state", "STATUS UNAVAILABLE");
    }
  }

  document.addEventListener("DOMContentLoaded", loadHome);
})();
