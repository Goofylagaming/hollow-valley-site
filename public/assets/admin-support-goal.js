(function (root, factory) {
  const editor = factory();
  if (typeof module === "object" && module.exports) module.exports = editor;
  else editor.mount(root);
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";

  const ENDPOINT = "/api/admin/finance/support-goal";
  const MAX_COSTS = 8;
  const MAX_CENTS = 100000000;
  const MAX_FILE_BYTES = 16 * 1024;
  const aud = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
  const money = cents => aud.format(cents / 100) + " AUD";
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);

  function amountToCents(value) {
    const text = String(value ?? "").trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
      throw new Error("Enter each monthly cost in AUD using up to two decimal places.");
    }
    const [whole, decimal = ""] = text.split(".");
    const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
    if (!Number.isSafeInteger(cents) || cents < 1 || cents > MAX_CENTS) {
      throw new Error("Each cost must be greater than zero and no more than $1,000,000 AUD.");
    }
    return cents;
  }

  function draftOf({ enabled, version, rows }) {
    if (!Number.isSafeInteger(version) || version < 0) throw new Error("Reload the saved settings before making changes.");
    if (!Array.isArray(rows) || rows.length > MAX_COSTS) throw new Error("Use no more than eight monthly cost items.");
    const categories = [];
    const ids = new Set();
    for (const row of rows) {
      const label = String(row.label ?? "").trim();
      const amount = String(row.amount ?? "").trim();
      if (!label && !amount) continue;
      if (!label || label.length > 60 || /[<>\u0000-\u001f\u007f]/.test(label)) {
        throw new Error("Give each cost a name of 1–60 characters, without angle brackets or control characters.");
      }
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(row.id || "") || ids.has(row.id)) {
        throw new Error("A cost identifier is invalid. Reload the saved settings and try again.");
      }
      ids.add(row.id);
      categories.push({ id: row.id, label, amountCents: amountToCents(amount) });
    }
    if (enabled && !categories.length) throw new Error("Add at least one monthly cost before showing the Subscriber Bar.");
    const total = categories.reduce((sum, item) => sum + item.amountCents, 0);
    if (!Number.isSafeInteger(total) || total > MAX_CENTS) throw new Error("The monthly target cannot exceed $1,000,000 AUD.");
    return { enabled: enabled === true, categories, version };
  }

  // Validate the complete file before replacing a single input. Importing uses
  // the editor's saved revision, never a revision or visibility from the file.
  async function readBudgetFile(file, version) {
    if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_FILE_BYTES) {
      throw new Error("Choose a budget JSON file no larger than 16 KB.");
    }
    let input;
    try { input = JSON.parse(await file.text()); }
    catch { throw new Error("This file could not be read as budget JSON. Your edits are unchanged."); }
    if (input?.currency !== "aud" || input.enabled !== false || !Array.isArray(input.categories) ||
        input.categories.length < 1 || input.categories.length > MAX_COSTS) {
      throw new Error("Use an unpublished AUD budget file with one to eight cost items.");
    }
    const rows = input.categories.map(item => {
      if (typeof item?.id !== "string" || typeof item.label !== "string" ||
          !Number.isSafeInteger(item.amountCents) || item.amountCents < 1 || item.amountCents > MAX_CENTS) {
        throw new Error("Each budget item needs a cost ID, name and positive whole-cent amount.");
      }
      const cents = item.amountCents;
      return { id: item.id, label: item.label, amount: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}` };
    });
    return draftOf({ enabled: false, version, rows });
  }

  function milestonesFor(targetCents) {
    return [50, 75].map(percent => ({ percent, amountCents: Math.ceil(targetCents * percent / 100) }));
  }

  function rowMarkup(row) {
    const id = escape(row.id);
    const amount = Number.isSafeInteger(row.amountCents) ? (row.amountCents / 100).toFixed(2) : "";
    return `<div class="subscriber-goal-row" data-cost-id="${id}">
      <label for="goal-label-${id}"><span>Cost name</span><input id="goal-label-${id}" data-goal-label type="text" maxlength="60" value="${escape(row.label || "")}" placeholder="e.g. Game hosting" autocomplete="off"></label>
      <label for="goal-amount-${id}"><span>Monthly cost · AUD</span><input id="goal-amount-${id}" data-goal-amount type="text" inputmode="decimal" maxlength="12" value="${escape(amount)}" placeholder="Enter amount" autocomplete="off"></label>
      <div class="subscriber-goal-row-actions"><button type="button" class="small-button" data-goal-action="up" aria-label="Move cost up">↑</button><button type="button" class="small-button" data-goal-action="down" aria-label="Move cost down">↓</button><button type="button" class="small-button" data-goal-action="remove">Remove</button></div>
    </div>`;
  }

  function mount(win) {
    const doc = win.document;
    const host = doc.getElementById("subscriber-goal");
    if (!host) return;
    const form = doc.getElementById("subscriber-goal-form");
    const fields = doc.getElementById("subscriber-goal-fields");
    const rowsHost = doc.getElementById("subscriber-goal-costs");
    const enabled = doc.getElementById("subscriber-goal-enabled");
    const total = doc.getElementById("subscriber-goal-total");
    const thresholds = doc.getElementById("subscriber-goal-thresholds");
    const received = doc.getElementById("subscriber-goal-received");
    const fileInput = doc.getElementById("subscriber-goal-import");
    const status = doc.getElementById("subscriber-goal-status");
    const add = doc.getElementById("subscriber-goal-add");
    const reload = doc.getElementById("subscriber-goal-reload");
    const refresh = doc.getElementById("subscriber-goal-refresh");
    const preview = doc.getElementById("subscriber-goal-preview");
    const previewState = doc.getElementById("subscriber-goal-preview-state");
    const refreshError = doc.getElementById("subscriber-goal-refresh-error");
    let version = null;
    let published = false;
    let busy = false;
    let count = 0;

    function setStatus(message, isError = false) {
      status.textContent = message;
      status.classList.toggle("is-error", isError);
    }

    function setBusy(value) {
      busy = value;
      fields.disabled = value;
      reload.disabled = value;
      refresh.disabled = value || !published || version === null;
      host.setAttribute("aria-busy", String(value));
    }

    function readRows() {
      return Array.from(rowsHost.querySelectorAll("[data-cost-id]"), (row) => ({
        id: row.dataset.costId,
        label: row.querySelector("[data-goal-label]").value,
        amount: row.querySelector("[data-goal-amount]").value,
      }));
    }

    function updateRows() {
      const rows = Array.from(rowsHost.querySelectorAll("[data-cost-id]"));
      rows.forEach((row, index) => {
        row.querySelector('[data-goal-action="up"]').disabled = index === 0;
        row.querySelector('[data-goal-action="down"]').disabled = index === rows.length - 1;
        row.querySelector('[data-goal-action="remove"]').setAttribute("aria-label", "Remove cost " + (index + 1));
      });
      add.disabled = rows.length >= MAX_COSTS;
      try {
        const draft = draftOf({ enabled: false, version: version ?? 0, rows: readRows() });
        const cents = draft.categories.reduce((sum, row) => sum + row.amountCents, 0);
        total.textContent = cents ? money(cents) : "Not set";
        thresholds.textContent = cents ? milestonesFor(cents).map(item => `${item.percent}%: ${money(item.amountCents)}`).join(" · ") : "Not set";
      } catch {
        total.textContent = "Complete the cost items to calculate the target";
        thresholds.textContent = "Not set";
      }
    }

    function addRow(row) {
      if (rowsHost.querySelectorAll("[data-cost-id]").length >= MAX_COSTS) return;
      const item = row || {
        id: "cost-" + (win.crypto?.randomUUID ? win.crypto.randomUUID() : Date.now().toString(36) + "-" + (++count)),
        label: "", amountCents: null,
      };
      rowsHost.insertAdjacentHTML("beforeend", rowMarkup(item));
      updateRows();
    }

    function renderPreview(result) {
      // Only this separate projection may be passed to the public renderer.
      const markup = win.HVSubscriberProgress.render(result?.publicProgress, { idPrefix: "subscriber-goal-preview", showLink: false });
      preview.innerHTML = markup;
      preview.hidden = !markup;
      previewState.hidden = !!markup;
      previewState.textContent = result?.config?.enabled
        ? "A public preview is unavailable. Reload the saved settings to check its status."
        : "The Subscriber Bar is hidden from the homepage and membership page.";
      const progress = result?.progress;
      const at = typeof progress?.updatedAt === "string" ? Date.parse(progress.updatedAt) : NaN;
      received.textContent = progress?.available === true && progress.currency === "aud" && Number.isSafeInteger(progress.amountMinor) && Number.isFinite(at)
        ? `${money(progress.amountMinor)} · verified ${new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", timeZone: "Australia/Brisbane" }).format(at)} QLD`
        : "No verified total for this month.";
      refreshError.textContent = result?.lastRefreshError || "";
      refreshError.hidden = !result?.lastRefreshError;
    }

    function apply(result) {
      const config = result?.config;
      if (!config || !Number.isSafeInteger(config.version) || config.version < 0 ||
          config.currency !== "aud" || !Array.isArray(config.categories) || config.categories.length > MAX_COSTS) {
        throw new Error("The saved goal could not be read. Reload the settings and try again.");
      }
      version = config.version;
      published = config.enabled === true;
      enabled.checked = published;
      rowsHost.innerHTML = "";
      for (const row of config.categories) addRow(row);
      if (!config.categories.length) addRow();
      updateRows();
      form.hidden = false;
      renderPreview(result);
    }

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (busy || version === null || !file) return;
      setBusy(true);
      try {
        const draft = await readBudgetFile(file, version);
        enabled.checked = false;
        rowsHost.innerHTML = "";
        for (const row of draft.categories) addRow(row);
        setStatus("Budget loaded into the form with publication switched off. The saved settings are unchanged until you save.");
      } catch (error) {
        setStatus(error.message || "The budget could not be loaded. Your edits are unchanged.", true);
      } finally {
        fileInput.value = "";
        setBusy(false);
      }
    });

    async function load() {
      if (busy) return;
      setBusy(true);
      setStatus("Loading saved goal settings…");
      try {
        apply(await win.HDS.api(ENDPOINT));
        setStatus("The monthly target is the sum of your cost items. Changes are only applied when you save.");
      } catch (error) {
        setStatus(error.message || "Could not load the monthly goal.", true);
      } finally { setBusy(false); }
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      let draft;
      try { draft = draftOf({ enabled: enabled.checked, version, rows: readRows() }); }
      catch (error) { setStatus(error.message, true); return; }
      setBusy(true);
      setStatus("Saving goal settings…");
      try {
        apply(await win.HDS.api(ENDPOINT, { method: "PUT", body: JSON.stringify(draft) }));
        setStatus(draft.enabled ? "Goal settings saved. The public preview below reflects the saved goal." : "Goal settings saved. The public Subscriber Bar is hidden.");
      } catch (error) {
        setStatus(error.status === 409
          ? "These settings changed in another session. Your edits remain here; use Reload saved settings before trying again."
          : error.message || "The goal could not be saved. Your edits remain here.", true);
      } finally { setBusy(false); }
    });

    refresh.addEventListener("click", async () => {
      if (busy || version === null) return;
      setBusy(true);
      setStatus("Checking subscription payments and refunds for this Brisbane calendar month…");
      try {
        const result = await win.HDS.api(ENDPOINT + "/refresh", { method: "POST", body: "{}" });
        renderPreview(result);
        setStatus(result?.progress?.available
          ? "Verified subscription support refreshed. Any unsaved goal edits are unchanged."
          : "The current total is awaiting verification. Any unsaved goal edits are unchanged.");
      } catch (error) {
        // A failed collection invalidates its stored snapshot. Re-read only the
        // saved preview while retaining every unsaved cost edit in the form.
        try { renderPreview(await win.HDS.api(ENDPOINT)); }
        catch {
          preview.innerHTML = "";
          preview.hidden = true;
          previewState.hidden = false;
          previewState.textContent = "Current progress could not be verified. Reload the saved settings to check its status.";
          received.textContent = "No verified total for this month.";
        }
        setStatus(error.message || "Could not refresh subscription support. Goal settings were not changed.", true);
      } finally { setBusy(false); }
    });

    add.addEventListener("click", () => {
      if (busy) return;
      addRow();
      rowsHost.lastElementChild?.querySelector("[data-goal-label]")?.focus();
    });
    rowsHost.addEventListener("input", updateRows);
    rowsHost.addEventListener("click", (event) => {
      const button = event.target.closest("[data-goal-action]");
      const row = button?.closest("[data-cost-id]");
      if (busy || !row || !rowsHost.contains(row)) return;
      const action = button.dataset.goalAction;
      if (action === "remove") row.remove();
      if (action === "up" && row.previousElementSibling) rowsHost.insertBefore(row, row.previousElementSibling);
      if (action === "down" && row.nextElementSibling) rowsHost.insertBefore(row.nextElementSibling, row);
      updateRows();
    });
    reload.addEventListener("click", load);

    (async () => {
      const me = await win.HDS.loadMe().catch(() => null);
      if (!me?.financeOwnerAccess) return;
      host.hidden = false;
      await load();
    })();
  }

  return { amountToCents, draftOf, readBudgetFile, milestonesFor, rowMarkup, mount };
});
