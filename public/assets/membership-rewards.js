(function (root, factory) {
  const membership = factory();
  if (typeof module === "object" && module.exports) module.exports = membership;
  else root.HVMembership = membership;
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";

  const FRAME_IDS = new Set([
    "none", "supporter-fern", "guardian-river", "legend-gold",
    "loyalty-3", "loyalty-6", "loyalty-12",
  ]);
  const loadVersions = new WeakMap();

  function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
  }

  function count(value) {
    if (value === undefined || value === null || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
  }

  function date(value) {
    if (!value) return "";
    const timestamp = typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
      ? value.replace(" ", "T") + "Z" : value;
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? "" : new Intl.DateTimeFormat("en-AU", {
      dateStyle: "medium", timeZone: "Australia/Brisbane",
    }).format(parsed);
  }

  function frameId(value) {
    return FRAME_IDS.has(value) ? value : "none";
  }

  function appearanceFor(rewards) {
    const appearance = rewards?.appearance || {};
    const frames = (Array.isArray(appearance.frames) ? appearance.frames : [])
      .filter((frame) => FRAME_IDS.has(frame?.id));
    const selected = frameId(appearance.selectedFrameId || appearance.frameId);
    const available = frames.some((frame) => frame.id === selected && frame.available === true);
    return {
      ...appearance,
      frames,
      selectedFrameId: selected === "none" || available ? selected : "none",
      badgeVisible: appearance.badgeVisible !== false,
    };
  }

  function state(message, detail, retry = false) {
    return `<div class="membership-empty"><strong>${escape(message)}</strong><p>${escape(detail)}</p>${retry ? '<button type="button" class="small-button" data-membership-retry>Try again</button>' : ""}</div>`;
  }

  function renderMonthly(monthly = {}) {
    const remaining = count(monthly.remaining);
    const allowance = count(monthly.allowance);
    const used = count(monthly.used);
    const pending = (Array.isArray(monthly.claims) ? monthly.claims : []).filter((claim) => claim.status === "pending").length;
    const end = date(monthly.periodEnd);
    let heading = "Awaiting a paid membership cycle";
    let detail = "Your monthly choices will appear after an eligible payment is verified. Claimed skins stay in your collection.";
    if (monthly.enabled === true) {
      if (!allowance) {
        heading = "Awaiting a paid membership cycle";
        detail = "Your monthly choices will appear after an eligible payment is verified.";
      } else if (monthly.catalogueReady !== true) {
        heading = "Collection in preparation";
        detail = `${allowance} ${allowance === 1 ? "choice" : "choices"} in this paid cycle. The collection will appear once it is ready to claim.`;
      } else {
        heading = remaining === null ? "Choices available in Skin Studio" : `${remaining} ${remaining === 1 ? "choice" : "choices"} remaining`;
        detail = `${used ?? 0} of ${allowance} choices used${end ? ` · cycle ends ${end}` : ""}. Claimed skins stay in your collection.`;
      }
    }
    return `<article class="membership-benefit"><span class="membership-kicker">MONTHLY SKINS</span><h3>${escape(heading)}</h3><p>${escape(detail)}</p>${pending ? `<p class="membership-notice">${pending} ${pending === 1 ? "choice is" : "choices are"} being delivered. Repeating a claim will not use another choice.</p>` : ""}${monthly.claimError ? `<p class="membership-notice">${escape(monthly.claimError)}</p>` : ""}<a href="/skins#premium-collection">Open Skin Studio <span aria-hidden="true">→</span></a></article>`;
  }

  function renderLoyalty(loyalty = {}) {
    const months = count(loyalty.paidMonths);
    const milestones = (Array.isArray(loyalty.milestones) ? loyalty.milestones : [])
      .filter((milestone) => [3, 6, 12].includes(Number(milestone.months)))
      .sort((left, right) => Number(left.months) - Number(right.months));
    const next = milestones.find((milestone) => milestone.earned !== true);
    const progress = next ? Math.min(100, Math.round((months || 0) / Number(next.months) * 100)) : milestones.length ? 100 : 0;
    const heading = months === null ? "Paid history unavailable" : `${months} verified paid ${months === 1 ? "month" : "months"}`;
    const detail = months === null ? "Your loyalty history could not be confirmed yet." : months === 0
      ? loyalty.historyVerified === true ? "No eligible paid months were found in the checked history. Your earned rewards remain in your collection."
        : "No verified paid months are recorded yet. Earlier payments count once they have been verified."
      : next ? `${Math.max(0, Number(next.months) - months)} more paid ${Number(next.months) - months === 1 ? "month" : "months"} to ${next.title || "your next reward"}. Your progress stays with you if you take a break.`
        : "Your earned rewards stay with you. Thank you for supporting the Valley.";
    const history = loyalty.canSyncHistory === true ? `<div class="membership-history"><div><button type="button" class="small-button" data-membership-history-sync>Verify paid history</button><p class="membership-history-message" role="status" aria-live="polite"></p></div><small>Checks payments on your current subscription. Previously recorded paid months are kept.${date(loyalty.historySyncedAt) ? ` Last checked ${date(loyalty.historySyncedAt)}.` : ""}</small></div>` : "";
    return `<section class="membership-loyalty" aria-labelledby="membership-loyalty-title"><div class="membership-section-title"><div><span class="membership-kicker">LOYALTY REWARDS</span><h3 id="membership-loyalty-title">${escape(heading)}</h3></div>${next && months !== null ? `<span class="membership-next">Next: ${Number(next.months)} months</span>` : ""}</div><p>${escape(detail)}</p>${milestones.length ? `<div class="membership-progress" role="progressbar" aria-label="Progress towards the next loyalty reward" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><span style="width:${progress}%"></span></div><ol class="membership-milestones">${milestones.map((milestone) => `<li class="${milestone.earned === true ? "is-earned" : "is-locked"}"><span class="membership-milestone-icon" aria-hidden="true">${milestone.earned === true ? "✓" : "◇"}</span><div><b>${Number(milestone.months)} months</b><strong>${escape(milestone.title || "Loyalty reward")}</strong><small>${milestone.earned === true ? `Earned${date(milestone.earnedAt) ? ` · ${date(milestone.earnedAt)}` : ""}` : "Permanent reward when earned"}</small></div></li>`).join("")}</ol>` : '<div class="membership-note">Loyalty milestones will appear when the rewards programme is available.</div>'}${history}</section>`;
  }

  function renderAppearance(rewards, username = "Valley member") {
    const appearance = appearanceFor(rewards);
    const hasBadge = rewards.entitled === true && appearance.badge?.label;
    const label = hasBadge && appearance.badgeVisible ? appearance.badge.label : "Hollow Valley player";
    const frames = appearance.frames;
    return `<section class="membership-appearance" aria-labelledby="membership-appearance-title"><div class="membership-section-title"><div><span class="membership-kicker">YOUR LOOK</span><h3 id="membership-appearance-title">Make the Valley yours.</h3></div><a href="/profile">View profile <span aria-hidden="true">→</span></a></div><div class="membership-appearance-layout"><div class="membership-profile-preview"><span class="membership-avatar-preview" data-membership-frame="${appearance.selectedFrameId}" aria-hidden="true">${escape(String(username || "HV").trim().slice(0, 2).toUpperCase())}</span><strong>${escape(username)}</strong><span class="membership-badge${hasBadge && appearance.badgeVisible ? " is-active" : ""}">${escape(label)}</span><small>Profile preview</small></div><form id="membership-appearance-form"><fieldset><legend>Profile frame</legend><div class="membership-frame-options">${frames.length ? frames.map((frame) => `<label class="membership-frame-choice${frame.available !== true ? " is-unavailable" : ""}"><input type="radio" name="frameId" value="${frame.id}"${frame.id === appearance.selectedFrameId ? " checked" : ""}${frame.available !== true ? " disabled" : ""}><span class="membership-frame-swatch" data-membership-frame="${frame.id}" aria-hidden="true"></span><span><b>${escape(frame.label || "Profile frame")}</b><small>${frame.available !== true ? "Locked" : frame.permanent === true ? "Yours to keep" : frame.id === "none" ? "Classic profile" : "Active membership"}</small></span></label>`).join("") : '<p class="membership-note">No frames are available yet.</p>'}</div></fieldset><label class="membership-badge-toggle"><input type="checkbox" name="badgeVisible"${appearance.badgeVisible ? " checked" : ""}> Show my membership badge</label><div class="membership-form-actions"><button type="submit" class="small-button"${!frames.some((frame) => frame.available === true) ? " disabled" : ""}>Save appearance</button><p id="membership-appearance-message" role="status" aria-live="polite"></p></div></form></div></section>`;
  }

  function renderRewards(rewards, username) {
    if (!rewards || typeof rewards !== "object") return state("Rewards unavailable", "Please try again to load your membership rewards.", true);
    if (rewards.enabled !== true) return state("Membership rewards are being prepared", "Your existing membership and Valley Coin rewards continue as shown above. New benefits will appear here when they are available.");
    const until = date(rewards.benefitsUntil);
    const label = rewards.entitled === true ? rewards.tierLabel || "Active membership" : "Your membership collection";
    const note = rewards.entitled === true
      ? `Your active membership rewards${until ? ` · current paid period ends ${until}` : ""}.`
      : "Earned cosmetics and loyalty progress stay with you. Active membership benefits appear when your paid access is verified.";
    return `<div class="membership-overview"><div><span class="membership-kicker">MY MEMBERSHIP</span><h2>${escape(label)}</h2><p>${escape(note)}</p></div><span class="membership-status${rewards.entitled === true ? " is-active" : ""}">${rewards.entitled === true ? "Benefits active" : "No verified active benefits"}</span></div><div class="membership-benefits-grid">${renderMonthly(rewards.monthly)}</div>${renderLoyalty(rewards.loyalty)}${renderAppearance(rewards, username)}`;
  }

  function applyProfileAppearance(document, rewards) {
    const avatar = document.querySelector(".profile-avatar-wrap");
    if (avatar) avatar.removeAttribute("data-membership-frame");
    const badge = document.getElementById("profile-supporter-badge");
    const loyalty = document.getElementById("profile-loyalty-badge");
    if (loyalty) { loyalty.hidden = true; loyalty.textContent = ""; }
    if (rewards?.enabled !== true) return;
    const appearance = appearanceFor(rewards);
    if (avatar) avatar.setAttribute("data-membership-frame", appearance.selectedFrameId);
    if (badge) {
      badge.hidden = !appearance.badgeVisible || rewards.entitled !== true || !appearance.badge?.label;
      if (!badge.hidden) badge.textContent = appearance.badge.label;
    }
    const highest = (Array.isArray(rewards.loyalty?.milestones) ? rewards.loyalty.milestones : []).filter((milestone) => milestone.earned === true)
      .sort((left, right) => Number(right.months) - Number(left.months))[0];
    if (loyalty && highest && appearance.badgeVisible) {
      loyalty.textContent = `${Number(highest.months)}-month supporter`;
      loyalty.hidden = false;
    }
  }

  async function loadRewards({ host, me, api, document, onUpdated } = {}) {
    if (!host) return null;
    const loadVersion = (loadVersions.get(host) || 0) + 1;
    loadVersions.set(host, loadVersion);
    if (!me?.loggedIn) {
      host.innerHTML = state("Your rewards, in one place", "Sign in to see your skin choices, profile frames and loyalty progress.") + '<a class="small-button membership-signin" href="/auth/steam?returnTo=/supporter">Sign in with Steam</a>';
      host.setAttribute("aria-busy", "false");
      return null;
    }
    host.setAttribute("aria-busy", "true");
    try {
      const rewards = await api("/api/supporter/rewards");
      if (loadVersions.get(host) !== loadVersion) return null;
      host.innerHTML = renderRewards(rewards, me.user?.username || "Valley member");
      const historyButton = host.querySelector("[data-membership-history-sync]");
      historyButton?.addEventListener("click", async () => {
        if (historyButton.disabled) return;
        historyButton.disabled = true;
        const historyMessage = host.querySelector(".membership-history-message");
        historyMessage.textContent = "Checking paid history…";
        try {
          const result = await api("/api/supporter/rewards/sync-history", { method: "POST" });
          await loadRewards({ host, me, api, document, onUpdated });
          const refreshedMessage = host.querySelector(".membership-history-message");
          if (refreshedMessage) refreshedMessage.textContent = result?.historySync?.complete === true
            ? "Paid history checked. Your recorded rewards are up to date."
            : "Available payments verified. Some earlier history still needs review.";
        } catch (error) {
          historyMessage.textContent = error?.message || "Could not verify your paid history. Please try again.";
          historyButton.disabled = false;
        }
      });
      const form = host.querySelector("#membership-appearance-form");
      form?.addEventListener("change", () => {
        const selectedFrame = form.querySelector('input[name="frameId"]:checked');
        const preview = host.querySelector(".membership-avatar-preview");
        if (preview && selectedFrame && !selectedFrame.disabled) preview.setAttribute("data-membership-frame", frameId(selectedFrame.value));
        const badge = host.querySelector(".membership-profile-preview .membership-badge");
        if (badge) {
          const showBadge = form.querySelector('input[name="badgeVisible"]')?.checked === true && rewards.entitled === true && rewards.appearance?.badge?.label;
          badge.textContent = showBadge ? rewards.appearance.badge.label : "Hollow Valley player";
          badge.classList.toggle("is-active", Boolean(showBadge));
        }
      });
      form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submit = form.querySelector('button[type="submit"]');
        const message = form.querySelector("#membership-appearance-message");
        const selectedFrame = form.querySelector('input[name="frameId"]:checked');
        if (!selectedFrame || selectedFrame.disabled || submit.disabled) return;
        const selected = frameId(selectedFrame.value);
        const badgeVisible = form.querySelector('input[name="badgeVisible"]')?.checked === true;
        submit.disabled = true;
        message.textContent = "Saving…";
        try {
          await api("/api/supporter/appearance", {
            method: "POST", body: JSON.stringify({ frameId: selected, badgeVisible }),
          });
          await loadRewards({ host, me, api, document, onUpdated });
          const refreshedMessage = host.querySelector("#membership-appearance-message");
          if (refreshedMessage) refreshedMessage.textContent = "Appearance saved.";
        } catch (error) {
          message.textContent = error?.message || "Could not save your appearance. Please try again.";
          submit.disabled = false;
        }
      });
      if (document) applyProfileAppearance(document, rewards);
      if (typeof onUpdated === "function") onUpdated(rewards);
      return rewards;
    } catch (error) {
      if (loadVersions.get(host) !== loadVersion) return null;
      host.innerHTML = state("Rewards temporarily unavailable", error?.message || "Your membership is safe. Please try again shortly.", true);
      host.querySelector("[data-membership-retry]")?.addEventListener("click", () => loadRewards({ host, me, api, document, onUpdated }));
      return null;
    } finally {
      if (loadVersions.get(host) === loadVersion) host.setAttribute("aria-busy", "false");
    }
  }

  return { FRAME_IDS, escape, count, date, frameId, appearanceFor, renderRewards, applyProfileAppearance, loadRewards };
});
