"use strict";

(async function dailyRewards() {
  const panel = document.getElementById("daily-rewards");
  const url = "/api/supporter/rewards/daily";
  const response = await fetch(url);
  if (!response.ok) return;
  function render(state) {
    const current = state.claim || state;
    panel.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = "Daily Login Rewards";
    const list = document.createElement("ol");
    for (const [i,amount] of state.amounts.entries()) {
      const li = document.createElement("li");
      const claimed = i+1 < current.cycleDay || (!state.eligible && i+1 === current.cycleDay);
      li.textContent = amount + " VC · " + (claimed ? "Claimed" : i+1 === current.cycleDay ? "Available" : "Upcoming");
      list.append(li);
    }
    const status = document.createElement("p");
    status.textContent = "Day " + current.cycleDay + " of 7 · " + current.amount + " VC including " + current.bonus +
      " bonus VC · Grace " + (current.graceUsed ? "used" : "available");
    panel.append(heading,list,status);
    if (state.eligible) {
      const button = document.createElement("button");
      button.textContent = "Claim today's reward";
      button.onclick = async () => {
        button.disabled = true;
        try {
          const result = await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({day:state.day})});
          if (!result.ok) throw new Error();
          render(await result.json());
        } catch { status.textContent = "Claim status unavailable. Retry to check your receipt."; button.disabled = false; }
      };
      panel.append(button);
    } else {
      const next = document.createElement("p");
      next.textContent = "Next claim " + new Date(state.nextEligible).toLocaleString();
      panel.append(next);
    }
    panel.hidden = false;
  }
  render(await response.json());
})().catch(() => {});
