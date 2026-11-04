/* Hollow Valley staff changelog, with explicit save/publish separation. */
(function () {
  "use strict";
  const { api, loadMe } = window.HDS;
  const $ = id => document.getElementById(id);
  const stages = {building:"In Development",testing:"Testing",blocked:"Blocked",ready:"Ready to Deploy",live:"Live",fixed:"Fix Released"};
  let selectedDraft = null;
  let saved = [], busy = false;

  function node(tag, text, cls) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = String(text);
    if (cls) el.className = cls;
    return el;
  }
  function fieldValues() {
    return {
      category:$("hv-editor-category").value,
      stage:$("hv-editor-stage").value,
      milestone:$("hv-editor-milestone").value.trim(),
      title:$("hv-editor-title-input").value.trim(),
      summary:$("hv-editor-summary").value.trim(),
      referenceUrl:$("hv-editor-reference").value.trim(),
    };
  }
  function currentDate(value) {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime())
      ? date.toLocaleString("en-AU",{timeZone:"Australia/Brisbane",dateStyle:"medium",timeStyle:"short"}) + " AEST"
      : "Unpublished";
  }
  function setFeedback(value) { $("hv-editor-feedback").textContent = String(value || ""); }
  function reset() {
    selectedDraft = null;
    $("hv-update-editor").reset();
    $("hv-editor-title").textContent = "Create a private draft";
    $("hv-editor-save").textContent = "Save private draft";
    $("hv-editor-confirm").value = "";
    $("hv-editor-publish").disabled = true;
    setFeedback("Ready to create a private development update.");
  }
  function select(entry) {
    if (entry.publishedAt || entry.source !== "staff") return;
    selectedDraft = {id:entry.id,revision:entry.revision};
    for(const [name,value] of Object.entries({
      category:entry.category,stage:entry.stage,milestone:entry.milestone,
      title:entry.title,summary:entry.summary,reference:entry.referenceUrl,
    })){
      const map = {category:"hv-editor-category",stage:"hv-editor-stage",
        milestone:"hv-editor-milestone",title:"hv-editor-title-input",summary:"hv-editor-summary",
        reference:"hv-editor-reference"};
      $(map[name]).value = String(value||"");
    }
    $("hv-editor-title").textContent = "Edit saved draft";
    $("hv-editor-save").textContent = "Save draft changes";
    $("hv-editor-confirm").value = "";
    $("hv-editor-publish").disabled = false;
    setFeedback("Editing draft revision " + entry.revision + ". Save changes before publishing.");
    $("hv-update-editor").scrollIntoView({behavior:"smooth",block:"start"});
  }
  function renderList() {
    const host = $("hv-admin-update-list");
    host.replaceChildren();
    if (!saved.length) {
      host.append(node("p","No changes drafted or published yet."));
      return;
    }
    for (const entry of saved) {
      const card = node("article",undefined,"hv-admin-update-entry");
      const head = node("div",undefined,"hv-update-card-head");
      const isPublished = Boolean(entry.publishedAt);
      const stage = node("span",stages[entry.stage] || "Unknown","hv-update-stage");
      stage.dataset.stage = entry.stage;
      head.append(stage, node("small",
        (isPublished ? "Published " + currentDate(entry.publishedAt) : "PRIVATE DRAFT") +
        " · " + entry.milestone + " · revision " + entry.revision,"hv-update-card-meta"));
      card.append(head, node("strong", entry.title),
        node("p", entry.summary));
      if (!isPublished && entry.source === "staff") {
        const button = node("button","Edit this draft");
        button.type = "button";
        button.addEventListener("click",()=>select(entry));
        card.append(button);
      } else {
        const link = node("a","View published note ↗");
        link.href="/updates#update-" + String(entry.id || "").replace(/[^a-z0-9-]/gi, "");
        card.append(link);
      }
      host.append(card);
    }
  }
  async function loadList() {
    const data=await api("/api/site-updates/admin");
    saved=Array.isArray(data.updates) ? data.updates : [];
    renderList();
  }
  function toggleBusy(on) {
    busy = on;
    $("hv-editor-save").disabled = on;
    $("hv-editor-reset").disabled = on;
    $("hv-editor-reload").disabled = on;
    $("hv-editor-publish").disabled = on || !selectedDraft;
  }
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    const values=fieldValues();
    toggleBusy(true);
    setFeedback("Saving private draft…");
    try {
      const isEdit=Boolean(selectedDraft);
      const data=await api(isEdit
        ? "/api/site-updates/admin/" + encodeURIComponent(selectedDraft.id)
        : "/api/site-updates/admin", {
        method:isEdit ? "PUT" : "POST",
        body:JSON.stringify(isEdit
          ? {update:values,expectedRevision:selectedDraft.revision}
          : values),
      });
      selectedDraft={id:data.update.id,revision:data.update.revision};
      $("hv-editor-title").textContent = "Edit saved draft";
      $("hv-editor-save").textContent = "Save draft changes";
      $("hv-editor-confirm").value = "";
      setFeedback("Private draft saved at revision " + data.update.revision +
        ". Publishing is a separate confirmed action.");
      await loadList();
    } catch(error) {
      setFeedback(error.message || "Unable to save this draft.");
    } finally { toggleBusy(false); }
  }
  async function publish() {
    if(busy) return;
    if (!selectedDraft) {setFeedback("Save a draft before publishing.");return;}
    if ($("hv-editor-confirm").value !== "PUBLISH") {
      setFeedback('Type PUBLISH exactly to make this entry public.');
      return;
    }
    // Discourage accidental publication of unsaved form edits.
    const original=saved.find(entry=>entry.id===selectedDraft.id);
    if (!original || JSON.stringify(fieldValues()) !== JSON.stringify({
      category:original.category,stage:original.stage,milestone:original.milestone,
      title:original.title,summary:original.summary,referenceUrl:original.referenceUrl || "",
    })) {
      setFeedback("You have unsaved edits. Save the private draft before publishing.");
      return;
    }
    toggleBusy(true);
    setFeedback("Publishing approved development update…");
    try {
      const published=await api("/api/site-updates/admin/" + encodeURIComponent(selectedDraft.id) + "/publish", {
        method:"POST",body:JSON.stringify({
          expectedRevision:selectedDraft.revision,confirm:"PUBLISH",
        }),
      });
      const title=published.update.title;
      reset();
      await loadList();
      setFeedback("Published: " + title + ". This is a development update, not a verified live release.");
    } catch(error) {
      setFeedback(error.message || "Unable to publish.");
    } finally { toggleBusy(false); }
  }
  async function reload() {
    if(busy) return;
    try { await loadList(); setFeedback("Latest staff updates loaded."); }
    catch { setFeedback("Could not load changelog records."); }
  }
  async function init() {
    const me=await loadMe();
    const authorized=Boolean(me?.loggedIn && me.user?.is_admin);
    $("hv-update-guard").hidden=authorized;
    $("hv-update-admin-content").hidden=!authorized;
    if(!authorized)return;
    reset();
    $("hv-update-editor").addEventListener("submit",save);
    $("hv-editor-reset").addEventListener("click",reset);
    $("hv-editor-publish").addEventListener("click",publish);
    $("hv-editor-reload").addEventListener("click",reload);
    $("hv-update-editor").addEventListener("input",()=>{
      if (selectedDraft) $("hv-editor-publish").disabled=true;
    });
    try {await loadList();}
    catch {setFeedback("Unable to load the existing update history.");}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",()=>init().catch(()=>{
    $("hv-update-guard").hidden=false;$("hv-update-admin-content").hidden=true;
  }));
  else init().catch(()=>{
    $("hv-update-guard").hidden=false;$("hv-update-admin-content").hidden=true;
  });
})();
