(function attachExternalSkinImport(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.HDSSkinImport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function externalSkinImportFactory() {
  const COLOR_MAP = Object.freeze({
    BodyColor: "body",
    MarkingsColor: "markings",
    FlankColor: "flank",
    UnderbellyColor: "underbelly",
    Detail1Color: "detail1",
    EyesColor: "eyes",
    TeethColor: "teeth",
    MouthColor: "mouth",
    ClawsColor: "claws",
    MaleDisplayColor: "maleDisplay",
  });

  function clamp01(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error("Skin colour contains a non-numeric channel.");
    const normalized = number > 1 ? number / 255 : number;
    if (normalized < 0 || normalized > 1) throw new Error("Skin colour channels must be between 0-1 or 0-255.");
    return normalized;
  }

  function colorStruct(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Skin colour entry is invalid.");
    }
    const read = (lower, upper, fallback) => {
      if (Object.hasOwn(value, lower)) return value[lower];
      if (Object.hasOwn(value, upper)) return value[upper];
      return fallback;
    };
    return {
      r: clamp01(read("r", "R", 0)),
      g: clamp01(read("g", "G", 0)),
      b: clamp01(read("b", "B", 0)),
      a: clamp01(read("a", "A", 1)),
    };
  }

  function hexColor(hex) {
    const value = String(hex || "").replace("#", "").toUpperCase();
    if (!/^[0-9A-F]{6}$/.test(value)) throw new Error("Invalid hexadecimal skin colour.");
    return {
      r: parseInt(value.slice(0, 2), 16) / 255,
      g: parseInt(value.slice(2, 4), 16) / 255,
      b: parseInt(value.slice(4, 6), 16) / 255,
      a: 1,
    };
  }

  function integerIndex(value, field) {
    if (value === undefined || value === null || value === "") return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0 || number > 65535) {
      throw new Error(`${field} must be a non-negative integer.`);
    }
    return number;
  }

  function parseJsonCode(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("External skin JSON must be an object.");
    }

    const source = parsed.skin && typeof parsed.skin === "object" ? parsed.skin : parsed;
    const skinPatch = {};
    let recognized = 0;

    for (const [foreignKey, hollowKey] of Object.entries(COLOR_MAP)) {
      if (Object.hasOwn(source, foreignKey)) {
        skinPatch[hollowKey] = colorStruct(source[foreignKey]);
        recognized += 1;
      }
    }

    for (const hollowKey of Object.values(COLOR_MAP)) {
      if (Object.hasOwn(source, hollowKey)) {
        skinPatch[hollowKey] = colorStruct(source[hollowKey]);
        recognized += 1;
      }
    }

    if (!recognized) return null;

    const patternIndex = integerIndex(source.PatternIndex ?? source.patternIndex, "Pattern index");
    const skinVariation = integerIndex(source.SkinVariation ?? source.skinVariation, "Skin variation");
    const themeIndex = integerIndex(source.ThemeIndex ?? source.themeIndex, "Theme index");

    return {
      source: "dino-den-json",
      sourceLabel: "Dino Den / JSON customizer",
      skinPatch,
      indices: {
        ...(patternIndex === null ? {} : { patternIndex }),
        ...(skinVariation === null ? {} : { skinVariation }),
        ...(themeIndex === null ? {} : { themeIndex }),
      },
      warnings: [
        "Teeth, mouth or claws are kept from the current Hollow Valley editor when the source code does not include them.",
      ],
    };
  }

  function parseFangsAndFerns(raw) {
    if (!/\bFNF-/i.test(raw)) return null;
    const speciesMatch = /\bFNF-([A-Z0-9]+)-/i.exec(raw);
    const speciesCode = speciesMatch ? speciesMatch[1].toUpperCase() : null;
    const matches = raw.match(/(?<![0-9A-F])[0-9A-F]{6}(?![0-9A-F])/gi) || [];
    if (matches.length < 7) {
      throw new Error("Fangs & Ferns code was detected, but seven colour zones could not be read.");
    }
    const colors = matches.slice(-7);
    const keys = ["maleDisplay", "markings", "body", "flank", "underbelly", "detail1", "eyes"];
    const skinPatch = {};
    keys.forEach((key, index) => {
      skinPatch[key] = hexColor(colors[index]);
    });

    return {
      source: "fangs-ferns",
      sourceLabel: "Fangs & Ferns",
      speciesCode,
      skinPatch,
      indices: {},
      warnings: [
        "Fangs & Ferns share codes expose seven colour zones. The FNF species prefix is source metadata only; choose any Hollow Valley target species and review the palette before saving.",
        "Teeth, mouth and claws remain unchanged because they are not present in this code format.",
      ],
    };
  }

  function parseExternalSkinCode(value) {
    const raw = String(value || "").trim();
    if (!raw) throw new Error("Paste an external skin code first.");
    if (raw.length > 12000) throw new Error("External skin code is too large.");

    const json = parseJsonCode(raw);
    if (json) return json;

    const fnf = parseFangsAndFerns(raw);
    if (fnf) return fnf;

    throw new Error("Unsupported skin code. Current adapters support Fangs & Ferns share codes and Dino Den-style JSON customizer codes.");
  }

  function parseExternalSkinBatch(value) {
    const raw = String(value || "").trim();
    if (!raw) throw new Error("Paste one or more external skin codes first.");
    if (raw.length > 60000) throw new Error("External skin batch is too large.");

    try {
      const parsedJson = JSON.parse(raw);
      if (Array.isArray(parsedJson)) {
        if (!parsedJson.length) throw new Error("External skin JSON array is empty.");
        if (parsedJson.length > 50) throw new Error("Import batches are limited to 50 skins at a time.");
        return parsedJson.map((entry) => parseExternalSkinCode(JSON.stringify(entry)));
      }
      if (parsedJson && typeof parsedJson === "object") {
        return [parseExternalSkinCode(raw)];
      }
    } catch (error) {
      if (!/Unexpected|JSON/i.test(String(error?.message || ""))) throw error;
    }

    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const fnfLines = lines.filter((line) => /\bFNF-/i.test(line));
    if (fnfLines.length > 1 && fnfLines.length === lines.length) {
      if (fnfLines.length > 50) throw new Error("Import batches are limited to 50 skins at a time.");
      return fnfLines.map((line) => parseExternalSkinCode(line));
    }

    const blocks = raw.split(/\n\s*(?:---+|\*\*\*)\s*\n|\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean);
    if (blocks.length > 1) {
      if (blocks.length > 50) throw new Error("Import batches are limited to 50 skins at a time.");
      return blocks.map((block) => parseExternalSkinCode(block));
    }

    return [parseExternalSkinCode(raw)];
  }

  function mergeWithSkin(baseSkin, parsed) {
    if (!baseSkin || typeof baseSkin !== "object") throw new Error("Current editor skin is unavailable.");
    if (!parsed || typeof parsed !== "object") throw new Error("Parsed skin data is unavailable.");
    return {
      ...baseSkin,
      ...(parsed.skinPatch || {}),
      ...(parsed.indices || {}),
    };
  }

  return {
    parseExternalSkinCode,
    parseExternalSkinBatch,
    mergeWithSkin,
  };
});
