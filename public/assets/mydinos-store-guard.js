(() => {
  const STORAGE_KEY = "hv-dino-store-pending";
  const LOCK_MS = 30000;
  const FAST_POLL_MS = 500;
  const FAST_POLL_WINDOW_MS = 10000;
  const SAFE_REDIRECT = "/";
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

  function redirectAwayFromStore() {
    // Replace the history entry so Back does not immediately return the player
    // to My Dinos while the store operation is still completing in-game.
    window.location.replace(SAFE_REDIRECT);
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

      // Keep the lock if the live transition was never confirmed. A later visit
      // to My Dinos still cannot expose a second Store action during this window.
      if (readLock()) window.location.reload();
    } finally {
      pollRunning = false;
    }
  }

  // Take ownership of Store Dino before the older page handler can run. This gives
  // us a true one-shot action: confirm -> disappear immediately -> submit once ->
  // leave My Dinos as soon as the website accepts the request.
  document.addEventListener("click", async (event) => {
    const button = event.target.closest?.("#park-active-btn");
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (readLock()) {
      hideStoreButton();
      redirectAwayFromStore();
      return;
    }

    if (!confirm("Store your current live dino? The mod will save its state, then return you to the spawn screen.")) {
      return;
    }

    writeLock();
    button.remove();

    try {
      await window.HDS.api("/api/mydinos/park-active", { method: "POST" });
      redirectAwayFromStore();
    } catch (error) {
      // A duplicate-lock response means the first store is already underway.
      // Leave My Dinos rather than exposing another chance to interact with Store.
      if (Number(error?.status) === 409 || error?.code === "DINOSTORAGE_STORE_LOCKED") {
        redirectAwayFromStore();
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

  // If the player manually returns to My Dinos while the 30-second lock is still
  // active, keep Store hidden and use only the lightweight live-dino check until
  // the transition is confirmed or the lock expires.
  if (readLock()) {
    hideStoreButton();
    fastPollStoreState();
  }
})();
