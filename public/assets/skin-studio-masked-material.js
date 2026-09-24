import {
  DEFAULT_SKIN_PALETTE,
  SKIN_ZONE_DEFINITIONS,
} from "./skin-studio-zones.js";

const CHANNEL_COMPONENT = Object.freeze({
  r: "r",
  g: "g",
  b: "b",
  a: "a",
});

function hexToThreeColor(THREE, value) {
  return new THREE.Color(String(value || "#ffffff"));
}

function uniformName(key) {
  return `hvZone_${key}`;
}

function buildBlendShader() {
  const reads = [
    "vec4 hvMask0Sample = texture2D(hvMask0, vMapUv);",
    "vec4 hvMask1Sample = texture2D(hvMask1, vMapUv);",
    "vec4 hvMask2Sample = texture2D(hvMask2, vMapUv);",
  ];

  const blends = SKIN_ZONE_DEFINITIONS.map((zone) => {
    const component = CHANNEL_COMPONENT[zone.channel];
    return `diffuseColor.rgb = mix(diffuseColor.rgb, ${uniformName(zone.key)}, clamp(hvMask${zone.atlas}Sample.${component}, 0.0, 1.0));`;
  });

  return [
    ...reads,
    ...blends,
  ].join("\n");
}

export function createMaskedSkinController(THREE, {
  material,
  maskTextures,
  initialPalette = DEFAULT_SKIN_PALETTE,
} = {}) {
  if (!THREE) throw new Error("THREE is required");
  if (!material) throw new Error("A base material is required");
  if (!Array.isArray(maskTextures) || maskTextures.length < 3) {
    throw new Error("Three RGBA mask textures are required");
  }

  const masked = material.clone();
  masked.userData = { ...(masked.userData || {}) };

  const uniforms = {
    hvMask0: { value: maskTextures[0] },
    hvMask1: { value: maskTextures[1] },
    hvMask2: { value: maskTextures[2] },
  };

  for (const zone of SKIN_ZONE_DEFINITIONS) {
    uniforms[uniformName(zone.key)] = {
      value: hexToThreeColor(THREE, initialPalette[zone.key] || DEFAULT_SKIN_PALETTE[zone.key]),
    };
  }

  masked.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
uniform sampler2D hvMask0;
uniform sampler2D hvMask1;
uniform sampler2D hvMask2;
${SKIN_ZONE_DEFINITIONS.map((zone) => `uniform vec3 ${uniformName(zone.key)};`).join("\n")}`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
${buildBlendShader()}`
    );

    masked.userData.hvShader = shader;
  };

  masked.customProgramCacheKey = () => "hollow-valley-skin-mask-v1";
  masked.needsUpdate = true;

  function setPalette(palette = {}) {
    for (const zone of SKIN_ZONE_DEFINITIONS) {
      const value = palette[zone.key];
      if (!value) continue;
      uniforms[uniformName(zone.key)].value.set(value);
    }
  }

  function setZoneColor(zoneKey, hex) {
    const uniform = uniforms[uniformName(zoneKey)];
    if (!uniform) return false;
    uniform.value.set(hex);
    return true;
  }

  return {
    material: masked,
    setPalette,
    setZoneColor,
    uniforms,
    dispose() {
      masked.dispose();
    },
  };
}
