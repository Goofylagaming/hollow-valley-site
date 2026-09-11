const menuButton = document.querySelector(".menu-toggle");
const navLinks = document.querySelector(".main-nav");

menuButton?.addEventListener("click", () => {
  const isOpen = navLinks.classList.toggle("open");
  menuButton.setAttribute("aria-expanded", String(isOpen));
});

navLinks?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    navLinks.classList.remove("open");
    menuButton?.setAttribute("aria-expanded", "false");
  });

  navLinks?.querySelectorAll(".nav-group > button").forEach((button) => {
    button.addEventListener("click", () => {
      const group = button.parentElement;
      const isOpen = group.classList.toggle("open");
      button.setAttribute("aria-expanded", String(isOpen));
      navLinks.querySelectorAll(".nav-group").forEach((other) => {
        if (other !== group) {
          other.classList.remove("open");
          other.querySelector("button")?.setAttribute("aria-expanded", "false");
        }
      });
    });
  });
});

const filters = document.querySelectorAll(".filter");
const dinoCards = document.querySelectorAll(".dino-card");

filters.forEach((filter) => {
  filter.addEventListener("click", () => {
    const category = filter.dataset.filter;
    filters.forEach((button) => button.classList.toggle("active", button === filter));
    dinoCards.forEach((card) => {
      card.hidden = category !== "all" && card.dataset.category !== category;
    });

    const dinoDialog = document.querySelector(".dino-dialog");
    const dialogTitle = dinoDialog?.querySelector("#dialog-title");
    const dialogRole = dinoDialog?.querySelector(".dialog-role");
    const dialogDescription = dinoDialog?.querySelector(".dialog-description");
    const dialogSocial = dinoDialog?.querySelector(".dialog-social strong");

    dinoCards.forEach((card) => {
      card.tabIndex = 0;
      const openDetails = () => {
        if (!dinoDialog) return;
        dialogTitle.textContent = card.dataset.dino;
        dialogRole.textContent = card.dataset.role;
        dialogDescription.textContent = card.dataset.description;
        dialogSocial.textContent = card.dataset.social;
        dinoDialog.showModal();
      };
      card.addEventListener("click", openDetails);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openDetails();
        }
      });
    });

    dinoDialog?.querySelector(".dialog-close").addEventListener("click", () => dinoDialog.close());
    dinoDialog?.addEventListener("click", (event) => {
      if (event.target === dinoDialog) dinoDialog.close();
    });
  });
});

const walletSection = document.getElementById("wallet");

document.querySelectorAll('a[href="#wallet"]').forEach((link) => {
  link.addEventListener("click", () => {
    if (!walletSection) return;
    walletSection.hidden = false;
    walletSection.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

const marketplaceSection = document.getElementById("marketplace");

document.querySelectorAll('a[href="#marketplace"]').forEach((link) => {
  link.addEventListener("click", () => {
    if (!marketplaceSection) return;
    marketplaceSection.hidden = false;
    marketplaceSection.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

const speciesSection = document.getElementById("species");

document.querySelectorAll(".species-nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    if (!speciesSection) return;
    speciesSection.hidden = false;
    const targetFilter = document.querySelector(`.filter[data-filter="${link.dataset.filter}"]`);
    targetFilter?.click();
    speciesSection.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});
