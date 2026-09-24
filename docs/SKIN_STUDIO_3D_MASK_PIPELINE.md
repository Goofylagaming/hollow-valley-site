# Hollow Valley Skin Studio — Full Live 3D Mask Pipeline

This is the production path for making all ten Skin Studio colour zones affect the real 3D dinosaur preview.

## Current state

The TEST site currently embeds a downloadable CC BY Tyrannosaurus model through Sketchfab. That viewer exposes one main body material, so Body can be painted live, but the remaining EVRIMA zones cannot be isolated independently from the embed.

The multi-zone engine in `public/assets/skin-studio-masked-material.js` is ready for a self-hosted GLB with UV-aligned masks. It is deliberately not enabled yet, so the working TEST Skin Studio is not broken while the asset is prepared.

## Zone layout

Mask atlas 0:
- R = Body
- G = Markings
- B = Flank
- A = Underbelly

Mask atlas 1:
- R = Detail
- G = Eyes
- B = Teeth
- A = Mouth

Mask atlas 2:
- R = Claws
- G = Male display
- B/A = reserved

Masks are grayscale weights from 0 to 1. Black means the zone does not affect that texel; white means full colour replacement. Soft gray edges are allowed for blending.

## Required Tyrannosaurus asset

Place the final web-ready assets under:

`public/assets/skin-models/tyrannosaurus/`

Required files:
- `rex.glb`
- `mask0-body-markings-flank-underbelly.png`
- `mask1-detail-eyes-teeth-mouth.png`
- `mask2-claws-display.png`

The GLB must use UV0 consistently for the body material. Normal/roughness maps can stay untouched. The three mask textures must use the same UV layout as the base colour texture.

## Recommended authoring workflow

1. Download/export the legally licensed source rex as GLB.
2. Open it in Blender.
3. Keep the existing UV layout if it is clean.
4. Paint the ten zone masks as separate black/white images.
5. Pack those masks into the three RGBA atlases above.
6. Export a web GLB without baking the zone colours into albedo.
7. Put the GLB + masks into the Tyrannosaurus folder.
8. Set `MASKED_SKIN_MODELS.tyrannosaurus.enabled = true`.
9. Replace the Sketchfab-only preview loader with the Three.js masked loader.
10. Bind the existing Hollow Valley colour pickers to `controller.setPalette()`.

## Runtime architecture

`skin-studio-zones.js`
Defines the ten Hollow Valley/EVRIMA zones and their RGBA mask channels.

`skin-studio-masked-material.js`
Clones a normal Three.js material and injects the three mask atlases into the fragment shader. It preserves the underlying material maps, lighting, roughness and normals, then blends each selected zone colour only where its mask is present.

`skin-studio-model-config.js`
Species/model manifest. This lets us add Triceratops, Deinosuchus, Stegosaurus, etc. later without rewriting the shader.

## Integration sketch

```js
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createMaskedSkinController } from "./skin-studio-masked-material.js";
import { MASKED_SKIN_MODELS } from "./skin-studio-model-config.js";

const cfg = MASKED_SKIN_MODELS.tyrannosaurus;

const textureLoader = new THREE.TextureLoader();
const masks = await Promise.all(cfg.masks.map((url) => textureLoader.loadAsync(url)));
for (const texture of masks) texture.colorSpace = THREE.NoColorSpace;

const gltf = await new GLTFLoader().loadAsync(cfg.modelUrl);
const rexMesh = gltf.scene.getObjectByProperty("isMesh", true);

const controller = createMaskedSkinController(THREE, {
  material: rexMesh.material,
  maskTextures: masks,
});

rexMesh.material = controller.material;

document.addEventListener("hds:skin-preview-change", (event) => {
  controller.setPalette(event.detail?.skin || {});
});
```

## Why masks instead of separate materials

A mask-based material keeps the rex as one clean body material and lets us paint precise areas like the underbelly, flank, face display and markings without splitting the mesh. It also scales better to future species and stays fast enough for the website.

## Blocker before all ten zones can be live

We need the actual downloadable source GLB (or another licensed GLB we are happy with) in a form we can edit. The current Sketchfab embed does not expose the geometry/UVs required to author accurate masks from the website alone.
