"use strict";
// Arcade menu: a side rail on desktop and a focus-trapped drawer on small screens.
(() => {
  const toggle = document.getElementById("arcade-drawer-toggle");
  const rail = document.getElementById("arcade-rail");
  const closeButton = document.getElementById("arcade-drawer-close");
  const backdrop = document.getElementById("arcade-drawer-backdrop");
  if (!toggle || !rail) return;

  const mobileQuery = window.matchMedia("(max-width: 899px)");
  let desktopOpen = true;

  function mobile() { return mobileQuery.matches; }
  function drawerOpen() { return document.body.classList.contains("arcade-drawer-open"); }

  function apply() {
    const open = mobile() ? drawerOpen() : desktopOpen;
    document.documentElement.classList.toggle("arcade-rail-collapsed", !mobile() && !desktopOpen);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Close arcade menu" : "Open arcade menu");
    rail.setAttribute("aria-hidden", open ? "false" : "true");
    rail.inert = !open;
    if (mobile() && open) {
      rail.setAttribute("role", "dialog");
      rail.setAttribute("aria-modal", "true");
    } else {
      rail.removeAttribute("role");
      rail.removeAttribute("aria-modal");
    }
    if (backdrop) backdrop.hidden = !(mobile() && open);
  }

  function openMobile() {
    document.body.classList.add("arcade-drawer-open");
    apply();
    if (closeButton) closeButton.focus();
  }

  function closeMobile(restore) {
    document.body.classList.remove("arcade-drawer-open");
    apply();
    if (restore) toggle.focus();
  }

  function focusable(root) {
    return [...root.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])")].filter((node) => {
      if (node.hidden || node.closest("[hidden]")) return false;
      const style = window.getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden";
    });
  }

  toggle.addEventListener("click", () => {
    if (mobile()) {
      if (drawerOpen()) closeMobile(false);
      else openMobile();
      return;
    }
    desktopOpen = !desktopOpen;
    apply();
  });

  closeButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    closeMobile(true);
  });

  backdrop?.addEventListener("click", () => closeMobile(true));

  rail.addEventListener("click", (event) => {
    const link = event.target.closest("a[href^='#']");
    if (link) {
      const target = document.getElementById(link.getAttribute("href").slice(1));
      const content = document.getElementById("arcade-content");
      if (target && content && content.hidden && content.contains(target)) {
        event.preventDefault();
        const status = document.getElementById("arcade-status");
        if (status) status.textContent = "Sign in with Steam to play Valley Arcade.";
        document.getElementById("arcade-signin")?.focus();
        if (mobile()) closeMobile(false);
        return;
      }
    }
    if (mobile() && event.target.closest("a, button")) closeMobile(false);
  });

  // Focus trap: Tab stays inside the mobile drawer. Escape closes it.
  document.addEventListener("keydown", (event) => {
    if (!mobile() || !drawerOpen()) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMobile(true);
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = focusable(rail);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !rail.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !rail.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }, true);

  mobileQuery.addEventListener("change", () => {
    document.body.classList.remove("arcade-drawer-open");
    apply();
  });

  apply();
})();
