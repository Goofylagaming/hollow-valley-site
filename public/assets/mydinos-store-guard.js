(() => {
  const STORAGE_KEY = "hv-dino-store-pending";
  const LOCK_MS = 30000;

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
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        startedAt: Date.now(),
        expiresAt: Date.now() + LOCK_MS,
      }));
    } catch {
      // The backend still enforces the duplicate-store lock if session storage is unavailable.
    }
  }

  function applyLockToButton() {
    const button = document.getElementById("park-active-btn");
    if (!button || !readLock()) return;
    button.disabled = true;
    button.textContent = "Store already requested…";
    button.setAttribute("aria-disabled", "true");
  }

  // Stop a recreated Store button before its own click handler can submit a
  // second request. This covers the page refresh that happens while the game
  // is still waiting to transition the first stored pawn back to spawn.
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("#park-active-btn");
    if (!button || !readLock()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    applyLockToButton();
  }, true);

  // The existing My Dinos handler disables the button synchronously only after
  // the player confirms the Store action. Record the lock afterwards so a
  // cancelled confirmation does not accidentally lock the player out.
  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("#park-active-btn");
    if (!button || !button.disabled) return;
    writeLock();
    applyLockToButton();
  });

  const activeCard = document.getElementById("active-character-card");
  if (activeCard) {
    new MutationObserver(applyLockToButton).observe(activeCard, {
      childList: true,
      subtree: true,
    });
  }

  applyLockToButton();
})();
