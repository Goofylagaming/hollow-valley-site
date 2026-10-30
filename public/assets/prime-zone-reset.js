/* Hollow Valley Prime Tracker: deliberate player-scoped zone reset.
 * The server checks Steam session, current life and an idempotent request ID.
 */
(() => {
  "use strict";
  const api = window.HDS?.api;
  if (typeof api !== "function") return;
  let busy = false;
  let retryRequest = null;

  function clearManualZoneChecks(lifeId) {
    try {
      const key = "hollow-valley-prime-checks:" + lifeId;
      const saved = JSON.parse(localStorage.getItem(key) || "{}");
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) return;
      // Only reset zone-specific browser confirmations. Keep diet, nesting,
      // growth and health claims, plus all server-side Prime records.
      delete saved.sanctuary;
      delete saved.migration;
      delete saved.patrol;
      localStorage.setItem(key, JSON.stringify(saved));
    } catch { /* Browser storage can be unavailable. */ }
  }

  document.addEventListener("click", async (event) => {
    const button = event.target?.closest?.("[data-prime-zone-reset]");
    if (!button || busy || button.disabled) return;
    const lifeId = button.getAttribute("data-prime-zone-reset");
    if (!lifeId) return;

    const approved = window.confirm(
      "Reset the migration, patrol and sanctuary visits for this tracked dinosaur?\n\n" +
      "Old zone visits will be archived. Your Prime status, tracked Prime time, " +
      "mutations, dinos and Valley Coins will not change.\n\n" +
      "After Entomb, make sure the tracker is showing your NEW dinosaur life first. " +
      "Any zone you are currently standing in must be left and revisited to count again."
    );
    if (!approved) return;

    const feedback = button.closest(".prime-reset-controls")?.querySelector("[data-prime-reset-feedback]");
    if (!retryRequest || retryRequest.lifeId !== lifeId) {
      if (!window.crypto || typeof window.crypto.randomUUID !== "function") {
        if (feedback) feedback.textContent = "Your browser cannot create a secure reset request. Try an updated browser.";
        return;
      }
      retryRequest = { lifeId, requestId: window.crypto.randomUUID() };
    }

    busy = true;
    button.disabled = true;
    button.textContent = "Resetting tracked zones…";
    if (feedback) feedback.textContent = "Saving your old zone history and starting a new tracking window…";
    try {
      const result = await api("/api/mydinos/prime-tracker/reset-zones", {
        method: "POST",
        body: JSON.stringify({
          lifeId, requestId: retryRequest.requestId, confirm: "RESET ZONES",
        }),
      });
      if (result?.ok !== true || result?.lifeId !== lifeId) {
        throw new Error("The tracker could not verify this dinosaur's reset.");
      }
      retryRequest = null;
      clearManualZoneChecks(lifeId);
      if (feedback) {
        feedback.textContent =
          "Zones reset to 0. " + Number(result.clearedZones || 0) +
          " previous zone visit(s) archived. Prime status unchanged.";
      }
      // Both the compact Live Map and detailed DinoStorage panels refresh.
      window.dispatchEvent(new CustomEvent("hv-prime-zones-reset", {
        detail: { lifeId, resetAt: result.resetAt },
      }));
    } catch (error) {
      const message = error?.message || "Could not reset your tracked zones. Try again.";
      if (feedback) feedback.textContent = message;
      if ([400,401,403,409,415,429].includes(error?.status)) retryRequest = null;
    } finally {
      busy = false;
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = "Reset tracked zones";
      }
    }
  });
})();
