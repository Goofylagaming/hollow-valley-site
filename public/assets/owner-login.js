document.addEventListener("DOMContentLoaded", async () => {
  const message = document.getElementById("owner-message");
  const loginCard = document.getElementById("owner-login-card");
  const setupCard = document.getElementById("owner-setup-card");
  const unavailable = document.getElementById("owner-unavailable");

  try {
    const status = await window.HDS.api("/auth/owner/status");
    setupCard.hidden = !status.canSetUp;
    loginCard.hidden = status.canSetUp || !status.configured;
    unavailable.hidden = status.canSetUp || status.configured;
  } catch {
    message.textContent = "Could not load owner sign-in. Please try again.";
  }

  document.getElementById("owner-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    message.textContent = "Signing in…";
    try {
      const result = await window.HDS.api("/auth/owner/login", {
        method: "POST",
        body: JSON.stringify({ email: form.elements.email.value, password: form.elements.password.value }),
      });
      location.assign(result.returnTo || "/admin");
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
    }
  });

  document.getElementById("owner-setup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.elements.password.value !== form.elements.confirm.value) {
      message.textContent = "Passwords do not match.";
      return;
    }
    const button = form.querySelector("button");
    button.disabled = true;
    message.textContent = "Saving…";
    try {
      await window.HDS.api("/auth/owner/setup", {
        method: "POST",
        body: JSON.stringify({ email: form.elements.email.value, password: form.elements.password.value }),
      });
      form.elements.password.value = "";
      form.elements.confirm.value = "";
      message.textContent = "Owner email login is ready. You can use it on your phone or iPad.";
      setupCard.hidden = true;
      loginCard.hidden = false;
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
});
