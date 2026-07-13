import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const chassisUrl = new URL("../../assets/racing/models/chassis-draco.glb", import.meta.url).href;
const wheelUrl = new URL("../../assets/racing/models/wheel-draco.glb", import.meta.url).href;
const trackUrl = new URL("../../assets/racing/models/track-draco.glb", import.meta.url).href;

export interface RacingAssetLibrary {
  chassisScene: THREE.Group;
  wheelScene: THREE.Group;
  trackScene: THREE.Group;
}

export interface ImportedCarVisual {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  frontWheels: THREE.Object3D[];
  brakeLight?: THREE.Object3D;
}

let assetPromise: Promise<RacingAssetLibrary> | null = null;

function createLoader(): GLTFLoader {
  const draco = new DRACOLoader();
  draco.setDecoderPath("/draco/");
  draco.setDecoderConfig({ type: "wasm" });
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  return loader;
}

async function loadGltfScene(loader: GLTFLoader, url: string): Promise<THREE.Group> {
  const gltf = await loader.loadAsync(url);
  return gltf.scene;
}

function prepareScene(scene: THREE.Group): THREE.Group {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
        material.roughness = Math.min(1, Math.max(material.roughness, 0.36));
        material.needsUpdate = true;
      }
    }
  });
  return scene;
}

export function loadRacingAssetLibrary(): Promise<RacingAssetLibrary> {
  if (!assetPromise) {
    assetPromise = (async () => {
      const loader = createLoader();
      const [chassisScene, wheelScene, trackScene] = await Promise.all([
        loadGltfScene(loader, chassisUrl),
        loadGltfScene(loader, wheelUrl),
        loadGltfScene(loader, trackUrl)
      ]);
      return {
        chassisScene: prepareScene(chassisScene),
        wheelScene: prepareScene(wheelScene),
        trackScene: prepareScene(trackScene)
      };
    })();
  }
  return assetPromise;
}

function cloneWithUniqueMaterials(source: THREE.Object3D, paintColor?: string): THREE.Object3D {
  const clone = source.clone(true);
  clone.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (Array.isArray(object.material)) {
      object.material = object.material.map((material) => material.clone());
    } else {
      object.material = object.material.clone();
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const named = material as THREE.Material & { color?: THREE.Color; emissive?: THREE.Color; opacity?: number; transparent?: boolean };
      if (paintColor && /bodypaint/i.test(material.name) && named.color) {
        named.color.set(paintColor);
      }
      if (/brakelight/i.test(material.name) && named.emissive) {
        named.emissive.set("#ef4444");
      }
      if (/glass/i.test(material.name)) {
        named.transparent = true;
        named.opacity = 0.62;
      }
      material.needsUpdate = true;
    }
  });
  return clone;
}

function cloneWheel(source: THREE.Group, x: number, z: number, leftSide: boolean): THREE.Group {
  const wheel = cloneWithUniqueMaterials(source) as THREE.Group;
  wheel.position.set(x, 0.5, z);
  wheel.scale.setScalar(1.55);
  wheel.rotation.z = leftSide ? Math.PI : 0;
  return wheel;
}

export function buildImportedCarVisual(library: RacingAssetLibrary, color: string): ImportedCarVisual {
  const root = new THREE.Group();
  root.name = "imported-racing-car";
  const chassis = cloneWithUniqueMaterials(library.chassisScene, color);
  chassis.scale.setScalar(0.95);
  chassis.position.set(0, 0.35, 0);
  root.add(chassis);

  const frontLeft = cloneWheel(library.wheelScene, -1.35, -1.6, true);
  const frontRight = cloneWheel(library.wheelScene, 1.35, -1.6, false);
  const rearLeft = cloneWheel(library.wheelScene, -1.35, 1.45, true);
  const rearRight = cloneWheel(library.wheelScene, 1.35, 1.45, false);
  root.add(frontLeft, frontRight, rearLeft, rearRight);

  return {
    root,
    wheels: [frontLeft, frontRight, rearLeft, rearRight],
    frontWheels: [frontLeft, frontRight]
  };
}

// The source scene is an entire miniature race-track diorama (terrain, track
// surface, water, a train, windmill blades, birds, clouds) at ~120k
// triangles total - reasonable for a drivable scene, but this is used only
// as a distant background landmark, and rendering all of it tanked frame
// rate to ~16fps (confirmed via the dev metrics overlay). The ground-level
// infrastructure (terrain/track/water/strip/tube/train) is what a driving
// game would need; a landmark only needs the skyline silhouette, so only
// the mountain backdrop and small decorative accents are kept.
const LANDMARK_NODE_ALLOWLIST = /^(mountains|blade|bird|cloud)/i;

export function buildImportedTrackLandmark(library: RacingAssetLibrary): THREE.Group {
  const landmark = cloneWithUniqueMaterials(library.trackScene) as THREE.Group;
  landmark.name = "imported-desert-track-landmark";
  landmark.scale.setScalar(2.4);
  landmark.position.set(-185, -1.2, -280);
  landmark.rotation.y = 0.34;
  for (const child of [...landmark.children]) {
    if (!LANDMARK_NODE_ALLOWLIST.test(child.name)) landmark.remove(child);
  }
  landmark.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = false;
      object.receiveShadow = false;
    }
  });
  return landmark;
}
