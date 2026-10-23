"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const labels = {
    survival_seconds: "Longest observed life",
    journey_metres: "Longest journey",
    offspring: "Most verified offspring",
    kill_streak: "Highest kill streak",
    rex_seconds: "Oldest observed Rex",
    territory_captures: "Most Territory captures",
    gameplay_coins: "Most gameplay coins",
    group_battle: "Largest group battle",
  };
  let overview;
  function el(tag, value, className) {
    const node = document.createElement(tag);
    if (value != null) node.textContent = value;
    if (className) node.className = className;
    return node;
  }
  function status(message, error = false) {
    $("legacy-status").textContent = message;
    $("legacy-status").dataset.error = String(error);
  }
  async function api(path = "", body) {
    const response = await fetch(`/api/legacy${path}`, {
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Valley-Legacy": "1" },
      ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");
    return data;
  }
  function card(title) {
    const node = el("article", null, "legacy-card");
    node.append(el("h3", title));
    return node;
  }
  function button(label, action) {
    const b = el("button", label);
    b.type = "button";
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        await action();
        await refresh();
        status("Saved.");
      } catch (e) {
        status(e.message, true);
      } finally {
        b.disabled = false;
      }
    });
    return b;
  }
  function value(metric, n) {
    return metric.endsWith("_seconds")
      ? `${(n / 3600).toFixed(1)} hours`
      : metric === "journey_metres"
        ? `${(n / 1000).toFixed(2)} km`
        : Number(n).toLocaleString();
  }
  function records() {
    const scope =
      $("record-scope").value === "all" ? "all" : overview.seasons[0].id;
    $("record-cards").replaceChildren();
    for (const record of overview.rankings[scope]) {
      const c = card(labels[record.metric]);
      const top = record.leaders[0];
      c.append(
        el("strong", top ? value(record.metric, top.value) : "No record yet"),
      );
      c.append(
        el(
          "p",
          top
            ? top.name
            : ["territory_captures", "group_battle"].includes(record.metric)
              ? "Awaiting an authoritative event connection."
              : "Your next journey could start the story.",
        ),
      );
      if (record.leaders.length > 1) {
        const list = el("ol");
        for (const row of record.leaders.slice(1, 5))
          list.append(
            el("li", `${row.name} · ${value(record.metric, row.value)}`),
          );
        c.append(list);
      }
      $("record-cards").append(c);
    }
  }
  async function refresh() {
    overview = await api();
    records();
    $("tracking-note").textContent =
      `${overview.seasons[0].name} · Tracking began ${new Date(overview.trackingSince).toLocaleDateString()}. Only verified time and plausible movement count.`;
    $("hall").replaceChildren();
    if (!overview.hallOfFame.length)
      $("hall").append(
        el("p", "The Hall of Fame opens when the first season closes."),
      );
    for (const season of overview.hallOfFame) {
      const c = card(season.name);
      for (const w of season.winners.filter((w) => w.value > 0))
        c.append(
          el(
            "p",
            `${labels[w.metric]}: ${w.name} · ${value(w.metric, w.value)}`,
          ),
        );
      $("hall").append(c);
    }
    $("nest-cards").replaceChildren();
    for (const nest of overview.nests) {
      const c = card(nest.name);
      c.append(
        el(
          "p",
          `${nest.species} · ${nest.remaining}/${nest.eggs} eggs available`,
        ),
        button("Request an egg", () => api(`/nests/${nest.id}/request`, {})),
      );
      $("nest-cards").append(c);
    }
    if (!overview.nests.length)
      $("nest-cards").append(
        el("p", "No open nests yet. Sign in to register yours."),
      );
    let me;
    try {
      me = await api("/me");
    } catch (e) {
      $("nest-tools").hidden = true;
      return;
    }
    $("nest-tools").hidden = false;
    $("mastery-cards").replaceChildren();
    for (const m of me.mastery) {
      const c = card(m.species);
      c.append(
        el("strong", `Level ${m.level} / 50`),
        el(
          "p",
          `${m.xp.toLocaleString()} XP · ${(m.seconds / 3600).toFixed(1)} verified hours`,
        ),
      );
      for (const u of m.unlocks) c.append(el("p", u.title));
      $("mastery-cards").append(c);
    }
    if (!me.mastery.length)
      $("mastery-cards").append(
        el("p", "Play on Hollow Valley to begin your species mastery."),
      );
    $("life-cards").replaceChildren();
    $("nest-parent").replaceChildren();
    for (const life of me.lives) {
      const c = card(`${life.species} · Generation ${life.generation}`);
      c.append(
        el(
          "p",
          `${life.ended_at ? "Past observed life" : "Currently observed"} · ${new Date(life.started_at).toLocaleString()}`,
        ),
        el(
          "p",
          `Parents: ${life.parents.map((p) => p.name).join(", ") || "Not verified"}`,
        ),
        el(
          "p",
          `Offspring: ${life.offspring.map((p) => p.name).join(", ") || "None verified"}`,
        ),
        el(
          "p",
          `Observed mutations: ${
            JSON.parse(life.mutations)
              .map((m) => (typeof m === "string" ? m : JSON.stringify(m)))
              .join(", ") || "None recorded"
          }`,
        ),
      );
      $("life-cards").append(c);
      if (!life.ended_at) {
        const o = el("option", life.species);
        o.value = life.id;
        $("nest-parent").append(o);
      }
    }
    if (!me.lives.length)
      $("life-cards").append(
        el(
          "p",
          "Your dinosaur history will appear after a verified game snapshot.",
        ),
      );
    $("my-nests").replaceChildren();
    for (const nest of me.nests) {
      const c = card(nest.name);
      c.append(el("p", `${nest.status} · ${nest.remaining}/${nest.eggs} eggs`));
      if (nest.status === "open")
        c.append(
          button("Close listing", () =>
            api(`/nests/${nest.id}/manage`, { action: "close" }),
          ),
        );
      for (const r of nest.requests) {
        c.append(el("p", `${r.name}: ${r.status}`));
        if (r.status === "pending" && nest.status === "open")
          for (const action of ["accept", "reject"])
            c.append(
              button(
                `${action === "accept" ? "Accept" : "Decline"} ${r.name}`,
                () =>
                  api(`/nests/${nest.id}/manage`, { action, requestId: r.id }),
              ),
            );
      }
      $("my-nests").append(c);
    }
    $("my-requests").replaceChildren();
    for (const r of me.requests)
      $("my-requests").append(el("p", `${r.name} (${r.species}): ${r.status}`));
  }
  $("record-scope").addEventListener("change", () => overview && records());
  $("nest-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const submit = e.target.querySelector("button");
    submit.disabled = true;
    try {
      const data = Object.fromEntries(new FormData(e.target));
      await api("/nests", data);
      await refresh();
      status("Nest listing opened.");
    } catch (error) {
      status(error.message, true);
    } finally {
      submit.disabled = false;
    }
  });
  refresh()
    .then(() => status(""))
    .catch((e) => status(e.message, true));
})();
