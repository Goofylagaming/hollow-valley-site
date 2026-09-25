(() => {
  const MODEL_UID = "939e5dd6af554fccb986db94a85116a1";
  const iframe = document.getElementById("skin-model-frame");
  const loaderEl = document.getElementById("skin-model-loader");
  const statusEl = document.getElementById("skin-model-status");
  const statusDot = document.getElementById("skin-model-status-dot");
  const lightInput = document.getElementById("skin-model-light");
  const resetButton = document.getElementById("skin-model-reset");
  const zoneStrip = document.getElementById("skin-model-zone-strip");
  const maskData = window.HV_REX_MASK_RLE;

  if (!iframe) return;

  const OUTPUT_SIZE = 256;
  const ZONE_ORDER = [
    "flank",
    "underbelly",
    "markings",
    "detail1",
    "maleDisplay",
    "mouth",
    "teeth",
    "claws",
    "eyes",
  ];
  const FALLBACKS = {
    body: "#6f7652",
    markings: "#232713",
    flank: "#59613d",
    underbelly: "#b7ae8d",
    detail1: "#9c7b46",
    eyes: "#b7ff35",
    teeth: "#ded6b8",
    mouth: "#6d2e34",
    claws: "#28251e",
    maleDisplay: "#a6732b",
  };

  let api = null;
  let homeCamera = null;
  let materials = [];
  let originalMaterials = [];
  let environment = null;
  let liveTextureUid = null;
  let activePalette = { ...FALLBACKS };
  let updateTimer = null;
  let textureBusy = false;
  let textureDirty = false;
  let masks = null;
  let textureCanvas = null;
  let textureCtx = null;

  function setStatus(ok, message) {
    if (loaderEl) loaderEl.hidden = ok;
    if (statusEl) statusEl.textContent = message;
    statusDot?.classList.toggle("ready", ok);
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function currentPalette() {
    const get = (key) => document.getElementById("skin-color-" + key)?.value || FALLBACKS[key];
    return {
      body: get("body"),
      markings: get("markings"),
      flank: get("flank"),
      underbelly: get("underbelly"),
      detail1: get("detail1"),
      eyes: get("eyes"),
      teeth: get("teeth"),
      mouth: get("mouth"),
      claws: get("claws"),
      maleDisplay: get("maleDisplay"),
    };
  }

  function hexRgb(hex) {
    const clean = String(hex || "#000000").replace("#", "").padEnd(6, "0").slice(0, 6);
    return [
      parseInt(clean.slice(0, 2), 16) || 0,
      parseInt(clean.slice(2, 4), 16) || 0,
      parseInt(clean.slice(4, 6), 16) || 0,
    ];
  }

  function unpackMasks() {
    if (!maskData?.size || !maskData?.zones) return null;

    const total = maskData.size * maskData.size;
    const decoded = {};

    for (const [zone, runs] of Object.entries(maskData.zones)) {
      const pixels = new Uint8Array(total);
      for (let i = 0; i < runs.length; i += 2) {
        const start = runs[i];
        const length = runs[i + 1];
        pixels.fill(255, start, Math.min(total, start + length));
      }
      decoded[zone] = pixels;
    }
    return decoded;
  }

  function maskAt(zone, x, y) {
    const source = masks?.[zone];
    if (!source || !maskData?.size) return 0;

    const sx = Math.min(maskData.size - 1, Math.floor((x / OUTPUT_SIZE) * maskData.size));
    const sy = Math.min(maskData.size - 1, Math.floor((y / OUTPUT_SIZE) * maskData.size));
    return source[sy * maskData.size + sx] / 255;
  }

  function deterministicNoise(x, y) {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }

  function blendRgb(base, over, weight) {
    const w = Math.max(0, Math.min(1, weight));
    return [
      base[0] * (1 - w) + over[0] * w,
      base[1] * (1 - w) + over[1] * w,
      base[2] * (1 - w) + over[2] * w,
    ];
  }

  function buildTextureDataUrl(palette) {
    if (!textureCanvas) {
      textureCanvas = document.createElement("canvas");
      textureCanvas.width = OUTPUT_SIZE;
      textureCanvas.height = OUTPUT_SIZE;
      textureCtx = textureCanvas.getContext("2d", { alpha: false });
    }

    const image = textureCtx.createImageData(OUTPUT_SIZE, OUTPUT_SIZE);
    const body = hexRgb(palette.body);

    for (let y = 0; y < OUTPUT_SIZE; y++) {
      for (let x = 0; x < OUTPUT_SIZE; x++) {
        const pixel = y * OUTPUT_SIZE + x;
        const i = pixel * 4;

        const broad = 0.94 + Math.sin(x * 0.085) * 0.025 + Math.cos(y * 0.071) * 0.02;
        const grain = (deterministicNoise(x, y) - 0.5) * 0.085;
        const scale = Math.max(0.72, Math.min(1.12, broad + grain));

        let rgb = [
          body[0] * scale,
          body[1] * scale,
          body[2] * scale,
        ];

        for (const zone of ZONE_ORDER) {
          const mask = maskAt(zone, x, y);
          if (mask <= 0) continue;

          const color = hexRgb(palette[zone]);
          let weight = mask;

          if (zone === "markings") weight *= 0.92;
          else if (zone === "flank" || zone === "underbelly") weight *= 0.88;
          else weight *= 0.98;

          rgb = blendRgb(rgb, color, weight);
        }

        const micro = 0.97 + (deterministicNoise(x + 193, y + 47) - 0.5) * 0.045;
        image.data[i] = Math.max(0, Math.min(255, Math.round(rgb[0] * micro)));
        image.data[i + 1] = Math.max(0, Math.min(255, Math.round(rgb[1] * micro)));
        image.data[i + 2] = Math.max(0, Math.min(255, Math.round(rgb[2] * micro)));
        image.data[i + 3] = 255;
      }
    }

    textureCtx.putImageData(image, 0, 0);
    return textureCanvas.toDataURL("image/png");
  }

  function albedoChannel(material) {
    return material?.channels?.AlbedoPBR
      ? ["AlbedoPBR", material.channels.AlbedoPBR]
      : material?.channels?.DiffusePBR
        ? ["DiffusePBR", material.channels.DiffusePBR]
        : material?.channels?.DiffuseColor
          ? ["DiffuseColor", material.channels.DiffuseColor]
          : [null, null];
  }

  function attachTexture(uid, done) {
    let remaining = originalMaterials.length;
    if (!remaining) {
      done?.();
      return;
    }

    originalMaterials.forEach((source, index) => {
      const material = deepClone(source);
      const [channelName, channel] = albedoChannel(material);

      if (!channelName || !channel) {
        remaining -= 1;
        if (!remaining) done?.();
        return;
      }

      channel.enable = true;
      channel.factor = 1;
      channel.color = [1, 1, 1, 1];

      const texture = channel.texture && typeof channel.texture === "object"
        ? { ...channel.texture }
        : {};
      texture.uid = uid;
      channel.texture = texture;

      api.setMaterial(material, () => {
        materials[index] = material;
        remaining -= 1;
        if (!remaining) done?.();
      });
    });
  }

  function finishTextureUpdate(error) {
    textureBusy = false;

    if (error) {
      console.error("Skin Studio live texture update failed", error);
      setStatus(false, "Tyrannosaurus rex · live skin update failed");
    } else {
      setStatus(true, "Tyrannosaurus rex · 10-zone live skin");
    }

    if (textureDirty) {
      textureDirty = false;
      pushLiveTexture();
    }
  }

  function pushLiveTexture() {
    if (!api || !originalMaterials.length || !masks) return;

    if (textureBusy) {
      textureDirty = true;
      return;
    }

    textureBusy = true;
    const dataUrl = buildTextureDataUrl(activePalette);

    if (!liveTextureUid) {
      api.addTexture(dataUrl, (err, uid) => {
        if (err || !uid) {
          finishTextureUpdate(err || new Error("No texture UID returned"));
          return;
        }

        liveTextureUid = uid;
        attachTexture(uid, () => finishTextureUpdate(null));
      });
      return;
    }

    api.updateTexture(dataUrl, liveTextureUid, (err) => {
      finishTextureUpdate(err || null);
    });
  }

  function queuePalette(palette) {
    activePalette = { ...activePalette, ...(palette || {}) };
    syncZoneStrip();

    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(pushLiveTexture, 100);
  }

  function syncZoneStrip() {
    if (!zoneStrip) return;

    const inputs = [...document.querySelectorAll("#skin-colors .skin-color-control input[type=color]")];
    if (!inputs.length) return;

    zoneStrip.innerHTML = inputs.map((input) => {
      const label = input.closest(".skin-color-control")?.querySelector("span")?.textContent || input.id;
      return '<button type="button" class="skin-model-zone skin-zone-live" data-input="' + input.id + '">' +
        '<i style="background:' + input.value + '"></i>' +
        '<span>' + label + '</span>' +
        '<b>' + input.value.toUpperCase() + '</b></button>';
    }).join("");

    zoneStrip.querySelectorAll(".skin-model-zone").forEach((button) => {
      button.addEventListener("click", () => document.getElementById(button.dataset.input)?.click());
    });

    document.querySelectorAll("#skin-colors .skin-color-control").forEach((control) => {
      control.classList.add("skin-zone-live-control");
      control.classList.remove("skin-zone-saved-only");
      control.title = "Live on the 3D preview.";
    });
  }

  document.addEventListener("hds:skin-preview-change", (event) => {
    queuePalette(event.detail?.skin || currentPalette());
  });

  document.addEventListener("input", (event) => {
    if (event.target?.matches?.("#skin-colors input[type=color]")) {
      queuePalette(currentPalette());
    }
  });

  resetButton?.addEventListener("click", () => {
    if (!api) return;
    if (homeCamera?.position && homeCamera?.target) {
      api.setCameraLookAt(homeCamera.position, homeCamera.target, 0.6);
    } else {
      api.recenterCamera();
    }
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

  masks = unpackMasks();
  activePalette = currentPalette();
  syncZoneStrip();

  if (!masks) {
    setStatus(false, "Tyrannosaurus rex · UV masks unavailable");
    return;
  }

  if (!window.Sketchfab) {
    setStatus(false, "Tyrannosaurus rex · viewer unavailable");
    if (loaderEl) {
      loaderEl.innerHTML = "<strong>3D viewer failed to load</strong><span>Refresh the page to retry.</span>";
    }
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
          setStatus(true, "Tyrannosaurus rex · preparing 10-zone skin");
          api.setTextureQuality("hd");

          api.getCameraLookAt((err, camera) => {
            if (!err && camera) homeCamera = camera;
          });

          api.getEnvironment((err, env) => {
            if (!err && env) environment = env;
          });

          api.getMaterialList((err, list) => {
            if (err || !Array.isArray(list) || !list.length) {
              setStatus(false, "Tyrannosaurus rex · materials unavailable");
              return;
            }

            materials = list;
            originalMaterials = list.map(deepClone);
            activePalette = currentPalette();
            syncZoneStrip();
            pushLiveTexture();
          });
        });
      });
    },
    error() {
      setStatus(false, "Tyrannosaurus rex · viewer unavailable");
      if (loaderEl) {
        loaderEl.innerHTML = "<strong>3D viewer failed to load</strong><span>The skin editor still works. Refresh to retry the model.</span>";
      }
    },
  });
})();