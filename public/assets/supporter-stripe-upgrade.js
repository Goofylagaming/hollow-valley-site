(() => {
  const api = window.HDS?.api;
  if (!api) return;

  document.addEventListener("click", async (event) => {
    const button = event.target?.closest?.('button[data-action="change"][data-tier]');
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (button.disabled) return;

    const tier = button.dataset.tier;
    const tierLabel = button.closest(".tier-card")?.querySelector("h3")?.textContent?.trim() || tier;
    const confirmed = confirm(
      `Continue to Stripe to review the prorated adjustment and confirm the change to ${tierLabel}?`
    );
    if (!confirmed) return;

    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Opening Stripe…";

    try {
      const result = await api(`/api/supporter/${encodeURIComponent(tier)}/change`, { method: "POST" });
      if (!result?.url) throw new Error("Stripe did not return a billing confirmation link.");
      window.location.assign(result.url);
    } catch (error) {
      alert(error?.message || "Unable to open Stripe membership change.");
      button.disabled = false;
      button.textContent = original;
    }
  }, true);

  const changeState = new URLSearchParams(window.location.search).get("membership_change");
  if (changeState === "success") {
    const message = document.getElementById("checkout-message");
    if (message) {
      message.textContent = "Membership change confirmed in Stripe. Your new tier and rewards will sync automatically.";
    }
  }
})();
