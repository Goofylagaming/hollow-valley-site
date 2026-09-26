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
      try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
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

  function normalize(value) {
    return String(value || "").trim().toLowerCase();
  }

  function growthPercent(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return n <= 1 ? Math.round(n * 100) : Math.round(n);
  }

  function mutationList(dino) {
    const list = Array.isArray(dino?.mutations)
      ? dino.mutations
      : Array.isArray(dino?.mutationList)
        ? dino.mutationList
        : [];
    return list.map(normalize).filter(Boolean).sort();
  }

  function sameMutationSet(a, b) {
    if (!a.length || !b.length) return true;
    if (a.length !== b.length) return false;
    return a.every((value, index) => value === b[index]);
  }

  function sameDino(active, stored) {
    if (!active || !stored) return false;
    if (!normalize(active.species) || normalize(active.species) !== normalize(stored.species)) return false;

    const activeGender = normalize(active.gender);
    const storedGender = normalize(stored.gender);
    if (activeGender && storedGender && activeGender !== storedGender) return false;

    const activeName = normalize(active.name);
    const storedName = normalize(stored.name);
    if (activeName && storedName && activeName !== storedName) return false;

    const activeGrowth = growthPercent(active.growth);
    const storedGrowth = growthPercent(stored.growth);
    if (activeGrowth !== null && storedGrowth !== null && Math.abs(activeGrowth - storedGrowth) > 1) return false;

    if (typeof active.isPrime === "boolean" && typeof stored.isPrime === "boolean" && active.isPrime !== stored.isPrime) {
      return false;
    }

    if (!sameMutationSet(mutationList(active), mutationList(stored))) return false;
    return true;
  }

  function liveData() {
    try {
      return typeof activeCharacter !== "undefined" ? activeCharacter : null;
    } catch {
      return null;
    }
  }

  function storedData() {
    try {
      return typeof storedDinos !== "undefined" && Array.isArray(storedDinos) ? storedDinos : [];
    } catch {
      return [];
    }
  }

  function findParkedDataMatch() {
    const active = liveData();
    if (!active) return null;
    return storedData()
      .filter((dino) => sameDino(active, dino))
      .sort((a, b) => Number(b?.capturedAt || 0) - Number(a?.capturedAt || 0))[0] || null;
  }

  function parseGrowth(text) {
    const match = String(text || "").match(/(\d+)\s*%/);
    return match ? Number(match[1]) : null;
  }

  function findParkedDomMatch() {
    const banner = document.querySelector("#active-character-card .active-char-banner");
    if (!banner) return null;
    const heading = banner.querySelector(".active-char-info h3")?.textContent || "";
    const subtitle = banner.querySelector(".active-char-info small")?.textContent || "";
    const activeSpecies = normalize(heading.split("·")[0]);
    const activeGrowth = parseGrowth(heading);
    const activeGender = normalize(subtitle.split("·")[0]);
    if (!activeSpecies) return null;

    const cards = Array.from(document.querySelectorAll("#storage-grid .storage-dino-card"));
    const matches = cards.filter((card) => {
      const species = normalize(card.querySelector(".dino-main-info h2")?.textContent);
      const sub = card.querySelector(".dino-sub")?.textContent || "";
      const growth = parseGrowth(card.querySelector(".growth-highlight")?.textContent);
      const gender = normalize(sub.split("·").pop());
      if (species !== activeSpecies) return false;
      if (activeGender && gender && activeGender !== gender) return false;
      if (activeGrowth !== null && growth !== null && Math.abs(activeGrowth - growth) > 1) return false;
      return true;
    });

    if (!matches.length) return null;
    return { element: matches[0], slot: matches[0].querySelector("[data-slot]")?.dataset?.slot || null };
  }

  function storageState() {
    const grid = document.getElementById("storage-grid");
    if (!grid) return { ready: false, available: false };
    if (grid.querySelector(".storage-dino-card")) return { ready: true, available: true };
    const empty = grid.querySelector(".empty-roster");
    if (!empty) return { ready: false, available: false };
    const text = normalize(empty.textContent);
    if (text.includes("storage unavailable")) return { ready: true, available: false };
    return { ready: true, available: true };
  }

  function findCardForDataMatch(match) {
    if (!match?.slot) return null;
    const action = Array.from(document.querySelectorAll("#storage-grid [data-slot]"))
      .find((node) => node.dataset.slot === String(match.slot));
    return action?.closest?.(".storage-dino-card") || null;
  }

  function clearMatchHighlight() {
    document.querySelectorAll("[data-hv-parked-match='true']").forEach((node) => {
      node.style.outline = "";
      node.style.boxShadow = "";
      node.style.background = "";
      delete node.dataset.hvParkedMatch;
      node.querySelectorAll(".hv-parked-match-label").forEach((label) => label.remove());
    });
    const banner = document.querySelector("#active-character-card .active-char-banner");
    if (banner) {
      banner.style.outline = "";
      banner.style.boxShadow = "";
      banner.style.background = "";
      delete banner.dataset.hvParkedMatch;
      banner.querySelectorAll(".hv-parked-status").forEach((node) => node.remove());
    }
  }

  function highlightParkedMatch(card) {
    clearMatchHighlight();

    const banner = document.querySelector("#active-character-card .active-char-banner");
    if (banner) {
      banner.dataset.hvParkedMatch = "true";
      banner.style.outline = "2px solid #d39b24";
      banner.style.boxShadow = "0 0 0 3px rgba(211, 155, 36, 0.12)";
      banner.style.background = "rgba(211, 155, 36, 0.06)";
      const liveTag = banner.querySelector(".active-tag");
      if (liveTag) liveTag.textContent = "ALREADY STORED / PARKED";
      if (!banner.querySelector(".hv-parked-status")) {
        const status = document.createElement("div");
        status.className = "hv-parked-status tag-pill";
        status.textContent = "✓ STORE DISABLED — DINO IS ALREADY PARKED";
        status.style.marginLeft = "auto";
        status.style.borderColor = "#d39b24";
        status.style.color = "#e6bd55";
        banner.appendChild(status);
      }
    }

    if (card) {
      card.dataset.hvParkedMatch = "true";
      card.style.outline = "2px solid #d39b24";
      card.style.boxShadow = "0 0 0 3px rgba(211, 155, 36, 0.12)";
      card.style.background = "rgba(211, 155, 36, 0.04)";
      if (!card.querySelector(".hv-parked-match-label")) {
        const label = document.createElement("div");
        label.className = "hv-parked-match-label tag-pill";
        label.textContent = "CURRENT PARKED DINO";
        label.style.display = "inline-flex";
        label.style.margin = "16px 16px 0";
        label.style.borderColor = "#d39b24";
        label.style.color = "#e6bd55";
        card.prepend(label);
      }
    }
  }

  function reconcileStoreAvailability() {
    const button = document.getElementById("park-active-btn");

    if (readLock()) {
      if (button) button.remove();
      return true;
    }

    const storage = storageState();
    if (!storage.ready || !storage.available) {
      if (button) {
        button.style.visibility = "hidden";
        button.setAttribute("aria-hidden", "true");
      }
      return false;
    }

    const dataMatch = findParkedDataMatch();
    const domMatch = findParkedDomMatch();
    const card = findCardForDataMatch(dataMatch) || domMatch?.element || null;

    if (dataMatch || domMatch) {
      if (button) button.remove();
      highlightParkedMatch(card);
      return true;
    }

    clearMatchHighlight();
    if (button) {
      button.style.visibility = "";
      button.removeAttribute("aria-hidden");
    }
    return false;
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
          const active = await window.HDS.api("/api/mydinos/active-character");
          if (active && active.active === false) {
            clearLock();
            window.location.reload();
            return;
          }
        } catch {}

        await delay(FAST_POLL_MS);
      }

      if (readLock()) window.location.reload();
    } finally {
      pollRunning = false;
    }
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest?.("#park-active-btn");
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (reconcileStoreAvailability()) return;

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
      if (Number(error?.status) === 409 || error?.code === "DINOSTORAGE_STORE_LOCKED") {
        redirectAwayFromStore();
        return;
      }
      clearLock();
      alert(error?.message || "Failed to store active dinosaur");
      window.location.reload();
    }
  }, true);

  const activeCard = document.getElementById("active-character-card");
  const storageGrid = document.getElementById("storage-grid");

  if (activeCard) {
    new MutationObserver(() => reconcileStoreAvailability()).observe(activeCard, {
      childList: true,
      subtree: true,
    });
  }

  if (storageGrid) {
    new MutationObserver(() => reconcileStoreAvailability()).observe(storageGrid, {
      childList: true,
      subtree: true,
    });
  }

  if (readLock()) {
    hideStoreButton();
    fastPollStoreState();
  }

  queueMicrotask(reconcileStoreAvailability);
})();
