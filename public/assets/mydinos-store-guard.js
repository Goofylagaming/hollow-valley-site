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

  function saveLock(lock) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(lock));
    } catch {
      // The backend still enforces the duplicate-store lock if session storage is unavailable.
    }
  }

  function writeLock() {
    const now = Date.now();
    const lock = {
      startedAt: now,
      expiresAt: now + LOCK_MS,
      storageRefreshed: false,
    };
    saveLock(lock);
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
        const lock = readLock();
        if (!lock) return;
        hideStoreButton();

        const [activeResult, dinosResult] = await Promise.allSettled([
          window.HDS.api("/api/mydinos/active-character"),
          window.HDS.api("/api/mydinos"),
        ]);

        const active = activeResult.status === "fulfilled" ? activeResult.value : null;
        const dinos = dinosResult.status === "fulfilled" && Array.isArray(dinosResult.value)
          ? dinosResult.value
          : [];

        // Once the game no longer reports this live pawn, the transition is complete.
        // Clear the UI lock and refresh immediately so the page shows the final state.
        if (active && active.active === false) {
          clearLock();
          window.location.reload();
          return;
        }

        // DinoStorage writes the stored slot before the delayed in-game transition.
        // As soon as that new slot is visible, refresh the page once so the stored card
        // appears immediately. Keep the lock across that refresh so Store cannot return.
        const startedAtSec = Math.floor(Number(lock.startedAt || Date.now()) / 1000);
        const freshStoredDino = dinos.some((dino) => Number(dino?.capturedAt || 0) >= startedAtSec - 2);
        if (freshStoredDino && !lock.storageRefreshed) {
          lock.storageRefreshed = true;
          saveLock(lock);
          window.location.reload();
          return;
        }

        await delay(FAST_POLL_MS);
      }

      // Do one final visual refresh if the game/automation path is unusually slow.
      // The 30-second lock remains in place, so Store still cannot reappear yet.
      if (readLock()) window.location.reload();
    } finally {
      pollRunning = false;
    }
  }

  // Take ownership of Store Dino before the older page handler can run. This gives
  // us a true one-shot button: confirm -> disappear -> submit once -> fast poll.
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

  // If another page render recreates the live-dino card while a Store is pending,
  // remove the Store option immediately before the player can click it again.
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
