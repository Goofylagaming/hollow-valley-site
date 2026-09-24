(() => {
  const MODEL_UID = "939e5dd6af554fccb986db94a85116a1";
  const iframe = document.getElementById("skin-model-frame");
  const loaderEl = document.getElementById("skin-model-loader");
  const statusEl = document.getElementById("skin-model-status");
  const statusDot = document.getElementById("skin-model-status-dot");
  const lightInput = document.getElementById("skin-model-light");
  const resetButton = document.getElementById("skin-model-reset");
  const zoneStrip = document.getElementById("skin-model-zone-strip");

  if (!iframe) return;

  let api = null;
  let homeCamera = null;
  let materials = [];
  let originalMaterials = [];
  let environment = null;
  let pendingPalette = null;
  let paletteTimer = null;

  function setStatus(ok, message) {
    if (loaderEl) loaderEl.hidden = ok;
    if (statusEl) statusEl.textContent = message;
    statusDot?.classList.toggle("ready", ok);
  }

  function hexToRgb01(hex) {
    const clean = String(hex || "#777777").replace("#", "").padEnd(6, "0").slice(0, 6);
    return [
      parseInt(clean.slice(0, 2), 16) / 255,
      parseInt(clean.slice(2, 4), 16) / 255,
      parseInt(clean.slice(4, 6), 16) / 255,
    ];
  }

  function mixRgb(base, tint, amount) {
    return [
      base[0] * (1 - amount) + tint[0] * amount,
      base[1] * (1 - amount) + tint[1] * amount,
      base[2] * (1 - amount) + tint[2] * amount,
    ];
  }

  function materialZone(material, index) {
    const name = String(material?.name || "").toLowerCase();
    if (/eye|pupil|iris/.test(name)) return ["eyes", 0.82];
    if (/belly|under|throat|chest|ventral/.test(name)) return ["underbelly", 0.56];
    if (/stripe|mark|pattern|spot|patch/.test(name)) return ["markings", 0.55];
    if (/flank|side|body_side/.test(name)) return ["flank", 0.50];
    if (/detail|crest|accent|face|head/.test(name)) return ["detail1", 0.46];
    const fallback = ["body", "markings", "flank", "underbelly", "detail1"];
    return [fallback[index % fallback.length], index === 0 ? 0.38 : 0.30];
  }

  function colorChannel(channel, target, strength) {
    if (!channel) return false;

    const base = Array.isArray(channel.color) && channel.color.length >= 3
      ? channel.color.slice(0, 3)
      : [1, 1, 1];

    // Sketchfab models can use any of the classic Diffuse, specular-PBR
    // DiffusePBR, or metalness-PBR AlbedoPBR channels. Keep the source
    // texture/normal detail, but make the selected colour factor obvious.
    channel.enable = true;
    channel.color = mixRgb(base, target, strength);
    return true;
  }

  function applyPaletteNow(palette) {
    if (!api || !materials.length || !palette) return;

    const oneMaterialModel = materials.length === 1;

    materials.forEach((material, index) => {
      const original = originalMaterials[index];
      if (!original) return;

      const [mappedZone, mappedStrength] = materialZone(material, index);
      // If the model is a single textured material, separate Body/Flank/etc.
      // cannot be addressed independently without a custom UV mask. Make Body
      // visibly control the whole rex instead of silently doing nothing.
      const zone = oneMaterialModel ? "body" : mappedZone;
      const strength = oneMaterialModel ? 0.86 : Math.max(mappedStrength, 0.68);
      const target = hexToRgb01(palette[zone] || palette.body || "#6f7652");
      const clone = JSON.parse(JSON.stringify(original));
      const channels = clone.channels || {};

      let changed = false;
      changed = colorChannel(channels.AlbedoPBR, target, strength) || changed;
      changed = colorChannel(channels.DiffusePBR, target, strength) || changed;
      changed = colorChannel(channels.DiffuseColor, target, strength) || changed;

      // Some uploads expose only an emissive colour channel as a tintable
      // surface. Use it as a fallback, but keep it subtle so the model does
      // not look self-illuminated.
      if (!changed && channels.EmitColor) {
        channels.EmitColor.enable = true;
        channels.EmitColor.color = mixRgb(
          Array.isArray(channels.EmitColor.color) ? channels.EmitColor.color.slice(0, 3) : [0, 0, 0],
          target,
          0.35
        );
        changed = true;
      }

      if (changed) api.setMaterial(clone);
    });
  }

  function queuePalette(palette) {
    pendingPalette = { ...(pendingPalette || {}), ...(palette || {}) };
    window.clearTimeout(paletteTimer);
    paletteTimer = window.setTimeout(() => {
      applyPaletteNow(pendingPalette);
      pendingPalette = null;
    }, 90);
  }

  function syncZoneStrip() {
    if (!zoneStrip) return;
    const inputs = [...document.querySelectorAll("#skin-colors .skin-color-control input[type=color]")];
    if (!inputs.length) return;
    zoneStrip.innerHTML = inputs.map((input) => {
      const label = input.closest(".skin-color-control")?.querySelector("span")?.textContent || input.id;
      return '<button type="button" class="skin-model-zone" data-input="' + input.id + '">' +
        '<i style="background:' + input.value + '"></i>' +
        '<span>' + label + '</span>' +
        '<b>' + input.value.toUpperCase() + '</b></button>';
    }).join("");
    zoneStrip.querySelectorAll(".skin-model-zone").forEach((button) => {
      button.addEventListener("click", () => document.getElementById(button.dataset.input)?.click());
    });
  }

  function currentPalette() {
    const get = (key, fallback) => document.getElementById("skin-color-" + key)?.value || fallback;
    return {
      body: get("body", "#6f7652"),
      markings: get("markings", "#232713"),
      flank: get("flank", "#59613d"),
      underbelly: get("underbelly", "#b7ae8d"),
      detail1: get("detail1", "#9c7b46"),
      eyes: get("eyes", "#b7ff35"),
    };
  }

  document.addEventListener("hds:skin-preview-change", (event) => {
    syncZoneStrip();
    queuePalette(event.detail?.skin || currentPalette());
  });

  document.addEventListener("input", (event) => {
    if (event.target?.matches?.("#skin-colors input[type=color]")) {
      syncZoneStrip();
      queuePalette(currentPalette());
    }
  });

  resetButton?.addEventListener("click", () => {
    if (!api) return;
    if (homeCamera?.position && homeCamera?.target) api.setCameraLookAt(homeCamera.position, homeCamera.target, 0.6);
    else api.recenterCamera();
  });

  lightInput?.addEventListener("input", () => {
    if (!api || !environment) return;
    const factor = Number(lightInput.value || 105) / 105;
    api.setEnvironment({
      ...environment,
      exposure: Number(environment.exposure || 1) * factor,
      lightIntensity: Math.max(0.15, Math.min(2.5, Number(environment.lightIntensity || 1) * factor)),
    });
  });

  syncZoneStrip();

  if (!window.Sketchfab) {
    setStatus(false, "Tyrannosaurus · viewer unavailable");
    if (loaderEl) loaderEl.innerHTML = "<strong>3D viewer failed to load</strong><span>Refresh the page to retry.</span>";
    return;
  }

  const client = new window.Sketchfab("1.12.1", iframe);
  client.init(MODEL_UID, {
    autostart: 1,
    preload: 1,
    autospin: 0,
    ui_theme: "dark",
    ui_controls: 1,
    ui_infos: 0,
    ui_help: 0,
    ui_hint: 0,
    ui_stop: 0,
    success(viewerApi) {
      api = viewerApi;
      api.start(() => {
        api.addEventListener("viewerready", () => {
          setStatus(true, "Tyrannosaurus rex · palaeo-accurate 3D preview");
          api.setTextureQuality("hd");
          api.getCameraLookAt((err, camera) => { if (!err && camera) homeCamera = camera; });
          api.getEnvironment((err, env) => { if (!err && env) environment = env; });
          api.getMaterialList((err, list) => {
            if (err || !Array.isArray(list)) return;
            materials = list;
            originalMaterials = list.map((material) => JSON.parse(JSON.stringify(material)));

            const materialCount = materials.length;
            if (statusEl) {
              statusEl.textContent = materialCount === 1
                ? "Tyrannosaurus rex · live body tint"
                : "Tyrannosaurus rex · live material colours";
            }

            // Apply immediately after materials are available so the current
            // picker values are reflected on the actual 3D rex on first load.
            applyPaletteNow(currentPalette());
            window.setTimeout(() => applyPaletteNow(currentPalette()), 250);
          });
        });
      });
    },
    error() {
      setStatus(false, "Tyrannosaurus · viewer unavailable");
      if (loaderEl) loaderEl.innerHTML = "<strong>3D viewer failed to load</strong><span>The skin editor still works. Refresh to retry the model.</span>";
    },
  });
})();
