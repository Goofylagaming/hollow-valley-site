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
      throw new Error(message);
    }
    return body;
  }

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value ?? "";
    return div.innerHTML;
  }

  let cachedMe = null;

  async function loadMe(force = false) {
    if (cachedMe && !force) return cachedMe;
    try {
      cachedMe = await api("/api/me");
    } catch (err) {
      cachedMe = { loggedIn: false, user: null, discordLoginConfigured: false };
    }
    applyAuthUi(cachedMe);
    return cachedMe;
  }

  function applyAuthUi(me) {
    const authAction = document.getElementById("auth-action");
    if (!authAction) return;
    if (me.loggedIn && me.user) {
      authAction.textContent = "Logout";
      authAction.href = "/auth/logout";
      authAction.classList.add("logged-in");
    } else {
      const label = me.discordLoginConfigured ? "Login with Discord" : "Discord login not configured";
      authAction.innerHTML = `<span class="online-dot"></span> ${label} <b>↗</b>`;
      authAction.href = me.discordLoginConfigured ? "/auth/discord" : "#";
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
    await loadMe();

    document.getElementById("auth-action")?.addEventListener("click", (event) => {
      if (event.currentTarget.getAttribute("href") === "#") event.preventDefault();
      if (event.currentTarget.getAttribute("href") === "/auth/logout") {
        event.preventDefault();
        api("/auth/logout", { method: "POST" }).finally(() => window.location.reload());
      }
    });
  }

  return { api, escapeHtml, loadMe, initNav };
})();

document.addEventListener("DOMContentLoaded", () => {
  window.HDS.initNav().then(() => {
    document.dispatchEvent(new CustomEvent("hds:nav-ready"));
  });
});
