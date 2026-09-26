(() => {
  const STORAGE_KEY = "hv-dino-store-pending";
  const LOCK_MS = 30000;
  const FAST_POLL_MS = 500;
  const FAST_POLL_WINDOW_MS = 10000;
  let pollRunning = false;

  function readLock() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const lock = JSON.parse(raw);
      if (!Number.isFinite(lock?.expiresAt) || Date.now() >= lock.expiresAt) {
        sessionStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return lock;
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
  }

  function writeLock() {
    const now = Date.now();
    const lock = {
      startedAt: now,
      expiresAt: now + LOCK_MS,
    };
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(lock)); } catch {}
    return lock;
  }

  function clearLock() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  }

  function hideStoreButton() {
    const button = document.getElementById("park-active-btn");
    if (!button || !readLock()) return;
    button.remove();
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function fastPollStoreState() {
    if (pollRunning || !readLock()) return;
    pollRunning = true;
    const deadline = Date.now() + FAST_POLL_WINDOW_MS;

    try {
      while (Date.now() < deadline) {
        if (!readLock()) return;
        hideStoreButton();

        try {
          // This endpoint reads the cached live server snapshot and is normally
          // very fast. Do not poll /api/mydinos here: listing DinoStorage can wait
          // several seconds for a game-side dino_list response.
          const active = await window.HDS.api("/api/mydinos/active-character");
          if (active && active.active === false) {
            clearLock();
            window.location.reload();
            return;
          }
        } catch {
          // Keep the one-shot UI lock in place and try again on the next tick.
        }

        await delay(FAST_POLL_MS);
      }

      // One final page refresh after the short polling window. The Store lock is
      // intentionally retained until it expires if the live transition was never
      // confirmed, preventing a duplicate Store request from reappearing.
      if (readLock()) window.location.reload();
    } finally {
      pollRunning = false;
    }
  }

  // Take ownership of Store Dino before the older page handler can run. This gives
  // us a true one-shot action: confirm -> disappear immediately -> submit once.
  document.addEventListener("click", async (event) => {
    const button = event.target.closest?.("#park-active-btn");
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (readLock()) {
      hideStoreButton();
      fastPollStoreState();
      return;
    }

    if (!confirm("Store your current live dino? The mod will save its state, then return you to the spawn screen.")) {
      return;
    }

    writeLock();
    button.remove();

    try {
      await window.HDS.api("/api/mydinos/park-active", { method: "POST" });
      fastPollStoreState();
    } catch (error) {
      // A duplicate-lock response means the first store is already underway; keep
      // the button hidden and continue polling. Any other failure restores the UI.
      if (Number(error?.status) === 409 || error?.code === "DINOSTORAGE_STORE_LOCKED") {
        fastPollStoreState();
        return;
      }
      clearLock();
      alert(error?.message || "Failed to store active dinosaur");
      window.location.reload();
    }
  }, true);

  // If a render recreates the live-dino card while a Store is pending, remove the
  // Store option immediately before the player can click it a second time.
  const activeCard = document.getElementById("active-character-card");
  if (activeCard) {
    new MutationObserver(() => hideStoreButton()).observe(activeCard, {
      childList: true,
      subtree: true,
    });
  }

  if (readLock()) {
    hideStoreButton();
    fastPollStoreState();
  }
})();
