// Shared helpers used by every page: API wrapper, auth state, injected navigation and test UI shell.
window.HDS = (function () {
  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? await response.json() : null;
    if (!response.ok) {
      const message = body?.error || `Request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value ?? "";
    return div.innerHTML;
  }

  function ensureSnapshotStyles() {
    if (document.querySelector('link[data-hv-snapshot-ui]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/assets/snapshot-ui.css?v=1";
    link.dataset.hvSnapshotUi = "true";
    document.head.appendChild(link);
  }

  let cachedMe = null;
  let mePromise = null;

  async function loadMe(force = false) {
    if (cachedMe && !force) {
      applyAuthUi(cachedMe);
      return cachedMe;
    }
    if (mePromise && !force) {
      const me = await mePromise;
      applyAuthUi(me);
      return me;
    }

    mePromise = (async () => {
      try {
        cachedMe = await api("/api/me");
      } catch (err) {
        try {
          await new Promise((resolve) => setTimeout(resolve, 600));
          cachedMe = await api("/api/me");
        } catch {
          cachedMe = cachedMe || { loggedIn: false, user: null, steamLoginConfigured: true };
        }
      } finally {
        mePromise = null;
      }
      return cachedMe;
    })();

    const me = await mePromise;
    applyAuthUi(me);
    updateWelcomeName(me);
    return me;
  }

  function playerInitial(name) {
    const value = String(name || "HV").trim();
    return escapeHtml((value[0] || "H").toUpperCase());
  }

  function applyAuthUi(me) {
    const authArea = document.getElementById("auth-area");
    if (!authArea) return;

    if (me.loggedIn && me.user) {
      const username = escapeHtml(me.user.username || "Player");
      authArea.innerHTML = `
        <a class="player-chip" href="/profile" title="Open My Profile">
          <span class="snapshot-avatar">${playerInitial(me.user.username)}</span>
          <strong>${username}</strong><span aria-hidden="true">⌄</span>
        </a>
        <a class="logout-link" id="auth-action" href="#" title="Log out" aria-label="Log out">↪</a>`;
    } else {
      const steamLabel = me.steamLoginConfigured ? "Sign in" : "Steam unavailable";
      const href = me.steamLoginConfigured ? "/auth/steam" : "#";
      authArea.innerHTML = `<a class="steam-signin" id="auth-steam" href="${href}"><span class="snapshot-avatar">HV</span>${steamLabel}</a>`;
    }
  }

  function updateWelcomeName(me) {
    const target = document.getElementById("snapshot-welcome-name");
    if (!target) return;
    target.textContent = me?.loggedIn && me?.user?.username ? me.user.username : "Survivor";
  }

  async function claimDailyLoginBonus(me) {
    if (!me?.loggedIn) return null;
    try {
      const result = await api("/api/wallet/daily-login/claim", { method: "POST" });
      if (!result?.duplicate && Number(result?.amount) > 0) {
        document.dispatchEvent(new CustomEvent("hds:daily-login-bonus", { detail: result }));
      }
      return result;
    } catch (err) {
      if (![400, 503].includes(Number(err?.status))) {
        console.warn("Daily login bonus check failed", err);
      }
      return null;
    }
  }

  function normalizePath(pathname) {
    const normalized = String(pathname || "/").replace(/\/+$/, "");
    return normalized || "/";
  }

  function applyActiveNavState() {
    const currentPath = normalizePath(window.location.pathname);
    const links = Array.from(document.querySelectorAll(".main-nav a"));
    let activeLink = null;

    const sectionAliases = [
      ["/marketplace", "/marketplace"],
      ["/leaderboard", "/leaderboard"],
      ["/mydinos", "/profile"],
      ["/dinostorage", "/profile"],
      ["/wallet", "/profile"],
      ["/friends", "/profile"],
      ["/groups", "/profile"],
      ["/bodydrop", "/profile"],
      ["/adminoperations", "/admin"],
      ["/admincomms", "/admin"],
      ["/adminrestore", "/admin"],
    ];

    links.forEach((link) => {
      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || /^https?:/i.test(href)) return;
      let linkPath;
      try {
        linkPath = normalizePath(new URL(href, window.location.origin).pathname);
      } catch {
        return;
      }

      const exactMatch = linkPath === currentPath;
      const aliasMatch = sectionAliases.some(([currentPrefix, navPrefix]) =>
        currentPath.startsWith(currentPrefix) && linkPath.startsWith(navPrefix)
      );

      if (exactMatch || aliasMatch) {
        link.classList.add("is-active");
        link.setAttribute("aria-current", "page");
        if (!activeLink || exactMatch) activeLink = link;
      }
    });
  }

  const RAIL_ITEMS = [
    ["/profile", "♟", "My Profile"],
    ["/wallet", "V", "Wallet"],
    ["/skins?tab=mine", "◆", "My Skins"],
    ["/skins", "⚒", "Skin Studio"],
    ["/friends", "♟", "Friends"],
    ["/groups", "♣", "Groups"],
    ["/mydinos", "♟", "My Characters"],
    ["/dinostorage/", "▣", "Dino Storage"],
    ["/bodydrop", "◉", "Body Drop"],
  ];

  function railEnabled(path) {
    return path === "/" || [
      "/profile", "/wallet", "/skins", "/friends", "/groups", "/mydinos",
      "/dinostorage", "/bodydrop", "/marketplace"
    ].some((prefix) => path.startsWith(prefix));
  }

  function railItemMatches(href, path) {
    const cleanHref = normalizePath(String(href).split("?")[0]);
    if (cleanHref === "/skins" && path === "/skins") return true;
    if (cleanHref === "/mydinos" && path.startsWith("/mydinos")) return true;
    if (cleanHref === "/dinostorage" && path.startsWith("/dinostorage")) return true;
    return cleanHref !== "/skins" && cleanHref === path;
  }

  function injectMyStuffRail() {
    const path = normalizePath(window.location.pathname);
    if (!railEnabled(path) || document.querySelector(".my-stuff-rail")) return;
    const shell = document.querySelector(".app-shell");
    const navSlot = document.getElementById("nav-slot");
    if (!shell || !navSlot) return;

    const aside = document.createElement("aside");
    aside.className = "my-stuff-rail";
    aside.setAttribute("aria-label", "My Stuff");
    const items = RAIL_ITEMS.map(([href, icon, label]) => {
      const active = railItemMatches(href, path) ? " is-active" : "";
      return `<a class="${active.trim()}" href="${href}"><span class="rail-icon">${icon}</span><span>${label}</span></a>`;
    }).join("");
    aside.innerHTML = `<h3>My Stuff</h3><nav class="my-stuff-nav">${items}<div class="rail-divider"></div><a href="/quests"><span class="rail-icon">▤</span><span>My Reports</span></a><a href="/profile#account-links"><span class="rail-icon">⚙</span><span>Settings</span></a></nav>`;
    navSlot.insertAdjacentElement("afterend", aside);
    document.body.classList.add("has-my-stuff-rail");
  }

  function wireGlobalSearch() {
    const form = document.getElementById("global-player-search");
    const input = document.getElementById("global-player-search-input");
    if (!form || !input) return;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const query = String(input.value || "").trim();
      if (!query) return;
      try { sessionStorage.setItem("hv:player-search", query); } catch {}
      window.location.href = `/friends?search=${encodeURIComponent(query)}`;
    });
  }

  function wireNavInteractions() {
    const menuButton = document.querySelector(".menu-toggle");
    const navLinks = document.querySelector(".main-nav");

    menuButton?.addEventListener("click", () => {
      const isOpen = navLinks?.classList.toggle("open");
      menuButton.setAttribute("aria-expanded", String(Boolean(isOpen)));
    });

    navLinks?.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        navLinks.classList.remove("open");
        menuButton?.setAttribute("aria-expanded", "false");
      });
    });

    wireGlobalSearch();
  }

  async function initNav() {
    ensureSnapshotStyles();
    const slot = document.getElementById("nav-slot");
    if (!slot) return;
    try {
      const response = await fetch("/partials/nav.html?v=3", { cache: "no-store" });
      slot.innerHTML = await response.text();
    } catch (err) {
      console.error("Failed to load nav partial", err);
      return;
    }
    wireNavInteractions();
    applyActiveNavState();
    injectMyStuffRail();
    const me = await loadMe();
    const isAdmin = Boolean(me?.user?.is_admin);
    const adminNavLink = document.getElementById("admin-nav-link");
    if (adminNavLink) adminNavLink.hidden = !isAdmin;
    await claimDailyLoginBonus(me);

    document.getElementById("auth-area")?.addEventListener("click", (event) => {
      const link = event.target.closest("a");
      if (!link) return;

      if (link.id === "auth-action") {
        event.preventDefault();
        api("/auth/logout", { method: "POST" }).finally(() => window.location.reload());
        return;
      }

      const href = link.getAttribute("href");
      if (!href || href === "#") event.preventDefault();
    });
  }

  async function loadServerStatus() {
    const el = document.querySelector(".server-status");
    if (!el) return;
    try {
      const status = await api("/api/server-status");
      const dot = el.querySelector(".status-dot");
      if (status.configured && status.online) {
        dot?.classList.remove("offline");
        el.querySelector(".status-count")?.remove();
        el.innerHTML = `<span class="status-dot"></span> Server name: <b>Hollow Valley</b> <span class="status-count">— ${status.playerCount}/${status.maxPlayers} online now</span>`;
      } else if (status.configured && !status.online) {
        el.innerHTML = `<span class="status-dot offline"></span> Server name: <b>Hollow Valley</b> <span class="status-note">— currently offline</span>`;
      }
    } catch {
      // Leave static fallback.
    }
  }

  return {
    api,
    escapeHtml,
    loadMe,
    loadServerStatus,
    initNav,
    claimDailyLoginBonus,
    injectMyStuffRail,
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  window.HDS.initNav().then(() => {
    document.dispatchEvent(new CustomEvent("hds:nav-ready"));
  });
  window.HDS.loadServerStatus();
});
