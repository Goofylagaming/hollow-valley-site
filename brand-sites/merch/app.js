"use strict";
(() => {
  const buttons = [...document.querySelectorAll(".filter[data-category]")];
  const cards = [...document.querySelectorAll(".product-card[data-category]")];
  const search = document.getElementById("product-search");
  const counter = document.getElementById("result-count");
  const empty = document.getElementById("empty-results");
  const clear = document.getElementById("clear-filters");
  const year = document.getElementById("year");
  let category = "all";

  function applyFilters() {
    const term = (search.value || "").trim().toLocaleLowerCase("en-AU");
    let visible = 0;
    for (const card of cards) {
      const matchesCategory = category === "all" || card.dataset.category === category;
      const matchesSearch = !term || (card.dataset.search || "").toLocaleLowerCase("en-AU").includes(term) ||
        (card.textContent || "").toLocaleLowerCase("en-AU").includes(term);
      card.hidden = !(matchesCategory && matchesSearch);
      if (!card.hidden) visible += 1;
    }
    for (const button of buttons) {
      const selected = button.dataset.category === category;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    }
    counter.textContent = "Showing " + visible + " " + (visible === 1 ? "preview" : "previews");
    empty.hidden = visible > 0;
  }

  function setCategory(next) {
    category = buttons.some((b) => b.dataset.category === next) ? next : "all";
    applyFilters();
  }

  for (const button of buttons) {
    button.addEventListener("click", () => setCategory(button.dataset.category));
  }
  for (const link of document.querySelectorAll("[data-jump-category]")) {
    link.addEventListener("click", () => {
      search.value = "";
      setCategory(link.dataset.jumpCategory);
    });
  }
  search.addEventListener("input", applyFilters);
  clear.addEventListener("click", () => {
    search.value = "";
    setCategory("all");
    search.focus();
  });
  if (year) year.textContent = String(new Date().getFullYear());
  applyFilters();
})();
