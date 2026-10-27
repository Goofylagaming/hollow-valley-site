/* Admin-authorized editor for Hollow Valley's versioned published policies. */
(function () {
  "use strict";
  const { api, loadMe } = window.HDS;
  const $ = id => document.getElementById(id);
  const CATEGORIES = [
    ["general", "General"], ["conduct", "Player conduct"], ["combat", "Combat"],
    ["grouping", "Grouping"], ["nesting", "Nesting"], ["events", "Events"], ["other", "Other"],
  ];
  let species = [];
  let currentDraftVersion = null;
  let dirty = false;

  function make(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = String(text);
    return el;
  }
  function field(labelText, prop, value, { textarea = false, type = "text", options = null,
    maxLength = 300, min = null, max = null } = {}) {
    const wrapper = make("label");
    wrapper.append(make("span", "", labelText));
    let input;
    if (Array.isArray(options)) {
      input = make("select");
      for (const [key, name] of options) {
        const option = make("option", "", name);
        option.value = key;
        input.append(option);
      }
    } else {
      input = make(textarea ? "textarea" : "input");
      if (!textarea) input.type = type;
      input.maxLength = maxLength;
      if (min !== null) input.min = String(min);
      if (max !== null) input.max = String(max);
    }
    input.dataset.field = prop;
    input.value = String(value ?? "");
    wrapper.append(input);
    return wrapper;
  }
  function removeButton() {
    const button = make("button", "hv-admin-remove", "Remove from draft");
    button.type = "button";
    button.addEventListener("click", () => {
      button.closest(".hv-admin-rule-row")?.remove();
      markDirty();
    });
    return button;
  }
  function playableOptions() {
    return [["", "Choose playable species"],
      ...species.filter(s => s.releasedInEvrima)
        .sort((a,b) => a.name.localeCompare(b.name)).map(s => [s.id,s.name])];
  }
  function addRow(kind, data = {}) {
    const el = make("div", "hv-admin-rule-row");
    el.dataset.kind = kind;
    const grid = make("div", "hv-admin-rule-fields");
    if (kind === "rule") {
      const slug = data.id || "rule-" + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
      grid.append(
        field("Rule ID (immutable key)", "id", slug, { maxLength:40 }),
        field("Category", "category", data.category || "general", { options:CATEGORIES }),
        field("Title", "title", data.title || "", { maxLength:100 })
      );
      el.append(grid,field("Published rule text (15–1,500 characters)", "body",
        data.body || "", { textarea:true,maxLength:1500 }));
    } else if (kind === "pack") {
      grid.append(
        field("Species", "speciesId", data.speciesId || "", { options:playableOptions() }),
        field("Maximum players", "maxMembers", data.maxMembers ?? "", { type:"number",min:1,max:100 }),
        field("Approved limitation note (optional)", "note", data.note || "", { maxLength:300 })
      );
      el.append(grid);
    } else if (kind === "mix") {
      grid.append(
        field("Species A", "speciesA", data.speciesA || "", { options:playableOptions() }),
        field("Species B", "speciesB", data.speciesB || "", { options:playableOptions() }),
        field("Compatibility", "allowed", data.allowed === undefined ? "" : String(data.allowed), {
          options:[["","Select decision"],["true","Permitted"],["false","Prohibited"]]
        })
      );
      el.append(grid,field("Specific rule note (optional)", "note", data.note || "", { maxLength:300 }));
    }
    el.append(removeButton());
    $({rule:"hv-admin-rule-list",pack:"hv-admin-pack-list",mix:"hv-admin-mix-list"}[kind]).append(el);
  }

  function collectRow(el) {
    const record = {};
    for (const input of el.querySelectorAll("[data-field]")) {
      record[input.dataset.field] = input.value.trim();
    }
    if (el.dataset.kind === "pack") record.maxMembers = Number(record.maxMembers);
    if (el.dataset.kind === "mix") {
      if (!["true", "false"].includes(record.allowed)) record.allowed = null;
      else record.allowed = record.allowed === "true";
    }
    return record;
  }
  function collectDraft() {
    return {
      rules:Array.from($("hv-admin-rule-list").children,collectRow),
      packs:Array.from($("hv-admin-pack-list").children,collectRow),
      compatibility:Array.from($("hv-admin-mix-list").children,collectRow),
    };
  }
  function markDirty() {
    dirty = true;
    $("hv-admin-publish").disabled = true;
    $("hv-admin-action-status").textContent = "Unsaved changes. Save the private draft before publishing.";
  }
  function renderDraft(data) {
    species = Array.isArray(data.species) ? data.species : [];
    currentDraftVersion = data.draftVersion;
    for (const id of ["hv-admin-rule-list","hv-admin-pack-list","hv-admin-mix-list"]) $(id).replaceChildren();
    for (const rule of data.draft?.rules || []) addRow("rule",rule);
    for (const pack of data.draft?.packs || []) addRow("pack",pack);
    for (const pair of data.draft?.compatibility || []) addRow("mix",pair);
    dirty = false;
    $("hv-admin-draft-version").textContent = "Private draft #" + data.draftVersion;
    $("hv-admin-published").textContent = data.publishedVersion
      ? "Published policy v" + data.publishedVersion : "No official website policy published yet";
    $("hv-admin-status").textContent = "Draft is private. Published policies remain unchanged until approval.";
    $("hv-admin-publish").disabled = false;
    $("hv-admin-confirm").value = "";
    $("hv-admin-action-status").textContent = "Draft loaded. Review and type PUBLISH before releasing it.";
    const history = $("hv-admin-history");
    history.replaceChildren();
    if (!Array.isArray(data.history) || !data.history.length) {
      history.append(make("p","", "No policy publications recorded."));
    } else {
      for (const row of data.history) {
        const entry = make("article");
        entry.append(
          make("strong","", "Version " + row.version),
          make("span","", new Date(row.publishedAt).toLocaleString("en-AU")),
          make("small","", "Published by " + row.publishedBySteamId)
        );
        history.append(entry);
      }
    }
  }
  async function reload() {
    const data = await api("/api/community-guides/admin");
    renderDraft(data);
  }
  function setBusy(busy) {
    for (const id of ["hv-admin-save-draft","hv-admin-reload","hv-admin-publish"]) {
      $(id).disabled = busy || (id === "hv-admin-publish" && dirty);
    }
  }
  async function save() {
    setBusy(true);
    $("hv-admin-action-status").textContent = "Validating and saving the private draft…";
    try {
      const data = await api("/api/community-guides/admin/draft", {
        method:"PUT",
        body:JSON.stringify({ document:collectDraft(), expectedDraftVersion:currentDraftVersion }),
      });
      renderDraft(data);
      $("hv-admin-action-status").textContent = "Private draft saved. No public policy has changed.";
    } catch(error) {
      $("hv-admin-action-status").textContent = error.message || "Could not save draft.";
    } finally {setBusy(false);}
  }
  async function publish() {
    if (dirty) {
      $("hv-admin-action-status").textContent = "Save the private draft before publishing.";
      return;
    }
    if ($("hv-admin-confirm").value !== "PUBLISH") {
      $("hv-admin-action-status").textContent = 'Type PUBLISH exactly to approve this release.';
      return;
    }
    setBusy(true);
    $("hv-admin-action-status").textContent = "Publishing approved rules…";
    try {
      const result = await api("/api/community-guides/admin/publish", {
        method:"POST",body:JSON.stringify({
          expectedDraftVersion:currentDraftVersion,confirm:"PUBLISH",
        }),
      });
      await reload();
      $("hv-admin-action-status").textContent =
        "Published version " + result.version + ". Only approved rules and pack policies are now visible publicly.";
    } catch(error) {
      $("hv-admin-action-status").textContent = error.message || "Publishing failed.";
    } finally {setBusy(false);}
  }
  async function init() {
    const me = await loadMe();
    const isAdmin = Boolean(me?.loggedIn && me.user?.is_admin);
    $("hv-admin-guide-guard").hidden = isAdmin;
    $("hv-admin-guide-content").hidden = !isAdmin;
    if (!isAdmin) return;
    for (const [id,kind] of [
      ["hv-admin-add-rule","rule"],["hv-admin-add-pack","pack"],["hv-admin-add-mix","mix"],
    ]) {
      $(id).addEventListener("click",()=>{addRow(kind);markDirty();});
    }
    for (const id of ["hv-admin-rule-list","hv-admin-pack-list","hv-admin-mix-list"]) {
      $(id).addEventListener("input",markDirty);
      $(id).addEventListener("change",markDirty);
    }
    $("hv-admin-save-draft").addEventListener("click",save);
    $("hv-admin-reload").addEventListener("click", async()=>{
      if (dirty && !window.confirm("Discard unsaved changes and reload the latest private draft?"))return;
      try {await reload();} catch{ $("hv-admin-action-status").textContent="Unable to reload draft."; }
    });
    $("hv-admin-publish").addEventListener("click",publish);
    try {await reload();}
    catch {
      $("hv-admin-status").textContent = "Unable to access the policy editor.";
      $("hv-admin-publish").disabled=true;
      $("hv-admin-save-draft").disabled=true;
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",()=>init().catch(()=>{
    $("hv-admin-guide-guard").hidden=false; $("hv-admin-guide-content").hidden=true;
  }));
  else init().catch(()=>{
    $("hv-admin-guide-guard").hidden=false; $("hv-admin-guide-content").hidden=true;
  });
})();
