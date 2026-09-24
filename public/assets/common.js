// Shared helpers used by every page: API wrapper, auth state, and the injected nav partial.
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
    return me;
  }

  function applyAuthUi(me) {
    const authArea = document.getElementById("auth-area");
    if (!authArea) return;

    if (me.loggedIn && me.user) {
      authArea.innerHTML = `<a class="steam-signin logged-in" href="/dashboard"><span class="steam-icon">●</span> Logged in as: ${escapeHtml(me.user.username)}</a><a class="logout-link" id="auth-action" href="#">Logout</a>`;
    } else {
      const steamLabel = me.steamLoginConfigured ? "Sign in with Steam" : "Steam login not configured";
      const href = me.steamLoginConfigured ? "/auth/steam" : "#";
      authArea.innerHTML = `<a class="steam-signin" id="auth-steam" href="${href}"><span class="steam-icon">◈</span> ${steamLabel}</a>`;
    }
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

  function wireNavInteractions() {
    const menuButton = document.querySelector(".menu-toggle");
    const navLinks = document.querySelector(".main-nav");

    menuButton?.addEventListener("click", () => {
      const isOpen = navLinks.classList.toggle("open");
      menuButton.setAttribute("aria-expanded", String(isOpen));
    });

    navLinks?.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        navLinks.classList.remove("open");
        menuButton?.setAttribute("aria-expanded", "false");
      });
    });

    navLinks?.querySelectorAll(".nav-group > button").forEach((button) => {
      button.addEventListener("click", () => {
        const group = button.parentElement;
        const isOpen = group.classList.toggle("open");
        button.setAttribute("aria-expanded", String(isOpen));
        navLinks.querySelectorAll(".nav-group").forEach((other) => {
          if (other !== group) {
            other.classList.remove("open");
            other.querySelector("button")?.setAttribute("aria-expanded", "false");
          }
        });
      });
    });
  }

  async function initNav() {
    const slot = document.getElementById("nav-slot");
    if (!slot) return;
    try {
      const response = await fetch("/partials/nav.html");
      slot.innerHTML = await response.text();
    } catch (err) {
      console.error("Failed to load nav partial", err);
      return;
    }
    wireNavInteractions();
    const me = await loadMe();
    const isAdmin = Boolean(me?.user?.is_admin);
    const adminNavGroup = document.getElementById("admin-nav-group");
    if (adminNavGroup) adminNavGroup.hidden = !isAdmin;
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
      if (!href || href === "#") {
        event.preventDefault();
      }
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
    } catch (err) {
      // Leave static fallback
    }
  }

  return { api, escapeHtml, loadMe, loadServerStatus, initNav, claimDailyLoginBonus };
})();

document.addEventListener("DOMContentLoaded", () => {
  window.HDS.initNav().then(() => {
    document.dispatchEvent(new CustomEvent("hds:nav-ready"));
  });
  window.HDS.loadServerStatus();
});