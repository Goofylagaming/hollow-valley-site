// Shared helpers used by every page: API wrapper, auth state, injected navigation and test UI shell.
window.HDS = (function () {
  const PUBLIC_TAGLINE = "WELCOME TO THE AUSTRALIAN ISLE SERVER - HOLLOW VALLEY";
  const DISCORD_INVITE = "https://discord.gg/hollowvalleyisle";

  function normalizePublicBranding() {
    document.querySelectorAll('a[href*="discord.gg/herbydeathsquadgames"]').forEach((link) => {
      link.setAttribute("href", DISCORD_INVITE);
    });

    const replacements = [
      [/ISLE SERVER · HOME OF THE HERBY DEATH SQUAD/gi, PUBLIC_TAGLINE],
      [/ISLE SERVER · HOME OF HDS/gi, PUBLIC_TAGLINE],
      [/Herby Death Squad Games/gi, "Hollow Valley"],
      [/Herby Death Squad/gi, "Hollow Valley"],
      [/everything happening in the HDS valley/gi, "everything happening in Hollow Valley"],
    ];

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    for (const node of textNodes) {
      if (node.parentElement?.closest("script, style")) continue;
      let next = node.nodeValue;
      for (const [pattern, replacement] of replacements) next = next.replace(pattern, replacement);
      if (next !== node.nodeValue) node.nodeValue = next;
      if (node.nodeValue.trim() === "HDS") node.nodeValue = node.nodeValue.replace("HDS", "HV");
    }

    if (/Herby Death Squad/i.test(document.title)) {
      document.title = document.title
        .replace(/Herby Death Squad Games/gi, "Hollow Valley")
        .replace(/Herby Death Squad/gi, "Hollow Valley");
    }

    const description = document.querySelector('meta[name="description"]');
    if (description) {
      let content = description.getAttribute("content") || "";
      content = content
        .replace(/home of the Herby Death Squad community/gi, "the Australian Isle Server community")
        .replace(/Herby Death Squad Games/gi, "Hollow Valley")
        .replace(/Herby Death Squad/gi, "Hollow Valley");
      description.setAttribute("content", content);
    }
  }

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
    // Pages now preload the theme in <head>. Do not append the same CSS again
    // after the legacy layout has rendered, which causes a visible theme flash.
    if (document.querySelector('link[href*="/assets/snapshot-ui.css"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/assets/snapshot-ui.css?v=4";
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
    const legacyLink = document.getElementById("valley-legacy-nav");
    if (legacyLink) legacyLink.hidden = !me.valleyLegacyEnabled;
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
      authArea.innerHTML = `<a class="steam-signin" id="auth-steam" href="${href}"><span class="snapshot-avatar">HV</span>${steamLabel}</a><a class="logout-link" href="/owner-login" title="Owner login" aria-label="Owner login">⚙</a>`;
    }
  }

  function updateWelcomeName(me) {
    const target = document.getElementById("snapshot-welcome-name");
    if (!target) return;
    target.textContent = me?.loggedIn && me?.user?.username ? me.user.username : "Survivor";
  }

  async function claimDailyLoginBonus(me) {
    if (!me?.loggedIn) return null;
    // A design/review workspace should not make account writes on page load.
    if (document.body.dataset.suppressDailyClaim === "true") return null;
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
    const nav = document.querySelector(".main-nav");
    if (!nav) return;

    // Only highlight the destination representing the current route. In the
    // grouped layout, Wallet/Quests remain independent, not aliases of Profile.
    const aliases = [
      ["/dashboard", "/wallet"],
      ["/mydinos/", "/mydinos"],
      ["/dinostorage/", "/dinostorage"],
      ["/groups/", "/groups"],
      ["/marketplace/", "/marketplace"],
    ];
    const candidateLinks = Array.from(nav.querySelectorAll("a"));
    let selected = null;
    let selectedPriority = 0;

    for (const link of candidateLinks) {
      const href = link.getAttribute("href") || "";
      if (!href || href.startsWith("#") || href.startsWith("/#") || /^https?:/i.test(href)) continue;
      let linkPath;
      try { linkPath = normalizePath(new URL(href, window.location.origin).pathname); }
      catch { continue; }
      const exactMatch = currentPath === linkPath;
      const aliasMatch = aliases.some(([prefix, destination]) =>
        currentPath.startsWith(prefix) && linkPath === destination
      );
      const priority = exactMatch ? 2 : aliasMatch ? 1 : 0;
      if (priority > selectedPriority) {
        selected = link;
        selectedPriority = priority;
      }
    }

    if (!selected) return;
    selected.classList.add("is-active");
    selected.setAttribute("aria-current", "page");
    const group = selected.closest(".nav-group");
    if (group) {
      group.classList.add("has-current");
      group.querySelector(":scope > button")?.classList.add("is-active");
    }
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
    if (cleanHref === "/groups" && path.startsWith("/groups")) return true;
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
    aside.innerHTML = `<h3>My Stuff</h3><nav class="my-stuff-nav">${items}<div class="rail-divider"></div><a href="/quests"><span class="rail-icon">▤</span><span>My Quests</span></a><a href="/profile#account-links"><span class="rail-icon">⚙</span><span>Settings</span></a></nav>`;
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

    const closeGroups = () => {
      navLinks?.querySelectorAll(".nav-group").forEach((group) => {
        group.classList.remove("open");
        group.querySelector(":scope > button")?.setAttribute("aria-expanded", "false");
      });
    };
    const setMenuOpen = (open) => {
      navLinks?.classList.toggle("open", open);
      menuButton?.setAttribute("aria-expanded", String(open));
      menuButton?.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
      if (!open) closeGroups();
    };

    menuButton?.addEventListener("click", () => {
      setMenuOpen(!navLinks?.classList.contains("open"));
    });

    navLinks?.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => setMenuOpen(false));
    });

    navLinks?.querySelectorAll(".nav-group > button").forEach((button) => {
      button.addEventListener("click", () => {
        const group = button.closest(".nav-group");
        const open = !group?.classList.contains("open");
        closeGroups();
        if (open && group && !group.hidden) {
          group.classList.add("open");
          button.setAttribute("aria-expanded", "true");
        }
      });
    });

    // Desktop dropdowns should also close when clicking outside them.
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".nav-group")) closeGroups();
      if (navLinks?.classList.contains("open") &&
          !navLinks.contains(event.target) && !menuButton?.contains(event.target)) {
        setMenuOpen(false);
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const openGroup = navLinks?.querySelector(".nav-group.open");
      if (openGroup) {
        const button = openGroup.querySelector(":scope > button");
        closeGroups();
        button?.focus();
        event.preventDefault();
      } else if (navLinks?.classList.contains("open")) {
        setMenuOpen(false);
        menuButton?.focus();
        event.preventDefault();
      }
    });

    wireGlobalSearch();
  }

  async function initNav() {
    ensureSnapshotStyles();
    // Reserve the sidebar layout before the asynchronous navigation fetch.
    // Otherwise the main content jumps when the rail is finally injected.
    if (railEnabled(normalizePath(window.location.pathname))) {
      document.body.classList.add("has-my-stuff-rail");
      injectMyStuffRail();
    }
    const slot = document.getElementById("nav-slot");
    if (!slot) return;
    try {
      const response = await fetch("/partials/nav.html?v=primalbound6", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(`Navigation returned HTTP ${response.status}`);
      slot.innerHTML = await response.text();
      // Correct old PRIMALBOUND links even if a stale partial escapes an intermediary cache.
      const primalboundLink = slot.querySelector("#primalbound-nav-link");
      if (primalboundLink) primalboundLink.setAttribute("href", "/primalbound/");
    } catch (err) {
      console.error("Failed to load nav partial", err);
      return;
    }
    wireNavInteractions();
    applyActiveNavState();
    const me = await loadMe();
    const isAdmin = Boolean(me?.user?.is_admin);
    const adminNavGroup = document.getElementById("admin-nav-group");
    if (adminNavGroup) adminNavGroup.hidden = !isAdmin;
    const adminNavLink = document.getElementById("admin-nav-link");
    const territoryAdminNavLink = document.getElementById("territory-admin-nav-link");
    if (adminNavLink) adminNavLink.hidden = !isAdmin;
    if (territoryAdminNavLink) territoryAdminNavLink.hidden = !Boolean(me?.territoryWarsAdminAccess);
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
      if (status.configured && status.stale) {
        el.innerHTML = `<span class="status-dot offline"></span> Server name: <b>Hollow Valley</b> <span class="status-note">— live status temporarily unavailable (last update ${escapeHtml(status.lastChecked || 'unknown')})</span>`;
      } else if (status.configured && status.online) {
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
    normalizePublicBranding,
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  window.HDS.normalizePublicBranding();
  window.HDS.initNav().then(() => {
    window.HDS.normalizePublicBranding();
    document.dispatchEvent(new CustomEvent("hds:nav-ready"));
  });
  window.HDS.loadServerStatus();
});
