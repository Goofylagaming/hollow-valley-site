/* Hollow Valley pack guide: species reference != official group restrictions. */
(function () {
  "use strict";
  const { api } = window.HDS;
  const $ = id => document.getElementById(id);
  let species = [], policy = { packs:[], compatibility:[], published:false };

  function node(tag, text, cls) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = String(text);
    if (cls) el.className = cls;
    return el;
  }
  function humanCategory(value) {
    return { carnivore:"Carnivore",herbivore:"Herbivore",omnivore:"Omnivore",flying:"Flying" }[value] || "Species";
  }
  function populateSpecies() {
    const active = species.filter(item => item.releasedInEvrima);
    for (const item of active) {
      for (const selectId of ["hv-pack-species-a", "hv-pack-species-b"]) {
        const option = node("option", item.name);
        option.value = item.id;
        $(selectId).append(option);
      }
    }
  }
  function renderSpecies() {
    const query = $("hv-species-search").value.trim().toLowerCase();
    const category = $("hv-species-category").value;
    const visible = species.filter(item => (!query ||
      item.name.toLowerCase().includes(query)) && (!category || item.category === category));
    const host = $("hv-species-list");
    host.replaceChildren();
    $("hv-species-count").textContent = visible.length + " species in the directory";
    for (const item of visible) {
      const card = node("article", undefined, "hv-species-card");
      const title = node("h3",item.name);
      const label = node("small",humanCategory(item.category) +
        (item.releasedInEvrima ? " · EVRIMA reference" : " · not in the listed roster"));
      const social = node("p", "Social style: " + (item.social || "Not specified"));
      const ref = node("p", "Reference pack size: " +
        (item.referencePackLimit == null ? "not listed" : item.referencePackLimit) +
        " · informational only", "hv-species-reference");
      const approved = policy.packs.find(p => p.speciesId === item.id);
      const verdict = node("p", approved && policy.published
        ? "Published limit: " + approved.maxMembers + " players" + (approved.note ? " · " + approved.note : "")
        : "No staff-published group-size limit", approved && policy.published
          ? "hv-species-policy" : "hv-species-policy missing");
      card.append(label,title,social,ref,verdict);
      host.append(card);
    }
    if(!visible.length)host.append(node("p","No species match your search.","hv-guide-empty"));
  }
  async function check(event) {
    event.preventDefault();
    const speciesA = $("hv-pack-species-a").value;
    const speciesB = $("hv-pack-species-b").value || speciesA;
    const count = Number($("hv-pack-count").value);
    const output = $("hv-pack-result");
    if (!speciesA || !Number.isSafeInteger(count) || count < 1 || count > 100) {
      output.dataset.status = "unverified";
      output.textContent = "Choose playable species and a group size between 1 and 100.";
      return;
    }
    output.dataset.status = "unverified";
    output.textContent = "Checking current published policy…";
    try {
      const result = await api("/api/community-guides/check", {
        method:"POST", body:JSON.stringify({ speciesA,speciesB,count }),
      });
      output.dataset.status = result.status || "unverified";
      output.textContent = result.message + (result.note ? "\nStaff note: " + result.note : "") +
        (result.published ? "\nPolicy version " + result.policyVersion : "\nNo official website policy is published yet.");
    } catch {
      output.textContent = "Unable to check official policy right now. Ask an admin on Discord.";
    }
  }
  async function init() {
    $("hv-species-search").addEventListener("input",renderSpecies);
    $("hv-species-category").addEventListener("change",renderSpecies);
    $("hv-pack-checker").addEventListener("submit",check);
    try {
      const data = await api("/api/community-guides");
      species = Array.isArray(data.species) ? data.species.slice().sort((a,b)=>a.name.localeCompare(b.name)) : [];
      policy = { packs:Array.isArray(data.packs)?data.packs:[],
        compatibility:Array.isArray(data.compatibility)?data.compatibility:[],
        published:data.published===true };
      $("hv-packs-status").dataset.status = policy.published ? "ready" : "attention";
      $("hv-packs-status").textContent = policy.published
        ? "A Hollow Valley policy is published. Only items marked 'Published limit' are approved restrictions."
        : "No official pack policies are published yet. Species reference numbers below are not enforceable rules.";
      $("hv-packs-version").textContent = policy.published
        ? "Published policy v" + data.version
        : "No approved policy published";
      populateSpecies();
      renderSpecies();
    } catch {
      $("hv-packs-status").dataset.status = "attention";
      $("hv-packs-status").textContent = "Species reference and policy information are unavailable. Please check with a Hollow Valley admin.";
      $("hv-species-list").textContent = "Species list unavailable.";
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded",init);
  else init();
})();
