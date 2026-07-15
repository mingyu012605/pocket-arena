import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { TEST_OVAL_TRACK, centerlinePoint, centerlineTangentAngle } from "../../../../shared/racingTrack";

const carUrl = new URL("../../assets/racing/models/kenney-race-car.glb", import.meta.url).href;
const grandstandUrl = new URL("../../assets/racing/models/kenney-grandstand.glb", import.meta.url).href;
const flagUrl = new URL("../../assets/racing/models/kenney-flag-checkers.glb", import.meta.url).href;
const treeLargeUrl = new URL("../../assets/racing/models/kenney-tree-large.glb", import.meta.url).href;
const treeSmallUrl = new URL("../../assets/racing/models/kenney-tree-small.glb", import.meta.url).href;
const lightpostUrl = new URL("../../assets/racing/models/kenney-lightpost.glb", import.meta.url).href;

export interface RacingAssetLibrary {
  carScene: THREE.Group;
  grandstandScene: THREE.Group;
  flagScene: THREE.Group;
  treeLargeScene: THREE.Group;
  treeSmallScene: THREE.Group;
  lightpostScene: THREE.Group;
}

export interface ImportedCarVisual {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  frontWheels: THREE.Object3D[];
}

let assetPromise: Promise<RacingAssetLibrary> | null = null;
let carScenePromise: Promise<THREE.Group> | null = null;

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

/**
 * All Kenney Racing Kit (CC0) - a single consistent, bright, low-poly arcade
 * style for the car and every venue prop, so they read as one coherent
 * design rather than several unrelated projects stitched together.
 */
export function loadRacingCarScene(): Promise<THREE.Group> {
  if (!carScenePromise) {
    const loader = new GLTFLoader();
    carScenePromise = loadGltfScene(loader, carUrl).then((scene) => prepareScene(scene));
  }
  return carScenePromise;
}

export function loadRacingAssetLibrary(): Promise<RacingAssetLibrary> {
  if (!assetPromise) {
    assetPromise = (async () => {
      const loader = new GLTFLoader();
      const [carScene, grandstandScene, flagScene, treeLargeScene, treeSmallScene, lightpostScene] = await Promise.all([
        loadRacingCarScene(),
        loadGltfScene(loader, grandstandUrl),
        loadGltfScene(loader, flagUrl),
        loadGltfScene(loader, treeLargeUrl),
        loadGltfScene(loader, treeSmallUrl),
        loadGltfScene(loader, lightpostUrl)
      ]);
      return {
        carScene,
        grandstandScene: prepareScene(grandstandScene),
        flagScene: prepareScene(flagScene),
        treeLargeScene: prepareScene(treeLargeScene),
        treeSmallScene: prepareScene(treeSmallScene),
        lightpostScene: prepareScene(lightpostScene)
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
      const named = material as THREE.Material & { color?: THREE.Color; opacity?: number; transparent?: boolean };
      // The Kenney kit's "grey" material slot is reused for two different
      // things depending on which mesh it's on: the car's main body panels
      // (node "body"), and the wheel hub/rim (node "wheel*"). GLTFLoader
      // splits a multi-material node into one sub-mesh per material slot,
      // named "Mesh_<nodeName>" with a numeric suffix per slot (e.g.
      // "Mesh_body_1") rather than keeping the plain node name - an exact
      // `=== "body"` match never fired, so the body's own paint slot fell
      // through to the wheel-hub branch and rendered as a neutral grey
      // instead of the player's color. Match the "Mesh_body"/"Mesh_wheel*"
      // prefix instead of exact node-name equality.
      const isBodyPaint = /^grey$/i.test(material.name) && /^Mesh_body(_\d+)?$/.test(object.name);
      const isWheelHub = /^grey$/i.test(material.name) && /^Mesh_wheel/i.test(object.name);
      if (paintColor && isBodyPaint && named.color) {
        named.color.set(paintColor);
        if (material instanceof THREE.MeshStandardMaterial) {
          // Moderate roughness/metalness so the paint reads as a physically
          // lit, shaded surface rather than a flat wash - and only a faint
          // emissive fraction (was 0.65, which made the paint look pale and
          // self-lit rather than reading contrast from the scene's actual
          // lighting like every other material on the car does).
          material.roughness = 0.45;
          material.metalness = 0.25;
          material.emissive = new THREE.Color(paintColor);
          material.emissiveIntensity = 0.08;
        }
      } else if (isWheelHub && named.color) {
        // Wheel hub/rim: neutral dark metal, distinct from both the body
        // paint and the tire rubber - previously inherited the same
        // near-white "grey" default as an unlit, oddly pale wheel center.
        named.color.set("#6b7280");
        if (material instanceof THREE.MeshStandardMaterial) {
          material.roughness = 0.32;
          material.metalness = 0.72;
          material.emissiveIntensity = 0;
        }
      }
      if (/^carTire$/i.test(material.name) && named.color) {
        // Tire rubber: near-black, rough, non-metallic.
        named.color.set("#0c0c0e");
        if (material instanceof THREE.MeshStandardMaterial) {
          material.roughness = 0.92;
          material.metalness = 0;
          material.emissiveIntensity = 0;
        }
      }
      if (/glass/i.test(material.name)) {
        // Dark tinted cockpit glass, low opacity - was a mid-toned blue
        // semi-transparent panel that read as a pale patch rather than a
        // proper dark visor/windshield.
        named.color?.set("#12181f");
        named.transparent = true;
        named.opacity = 0.45;
        if (material instanceof THREE.MeshStandardMaterial) {
          material.roughness = 0.15;
          material.metalness = 0.2;
        }
      }
      if (material instanceof THREE.MeshStandardMaterial) {
        material.envMapIntensity = 0.35;
      }
      material.needsUpdate = true;
    }
  });
  return clone;
}

// Tuned so the car's wheelbase/track width visually matches the space the
// server-authoritative physics (car width, barrier offsets) expects - the
// source model is modeled at real-world-ish meters, much smaller than the
// scene's own unit scale.
const CAR_SCALE = 6.4;

// The Kenney kit's race car is an empty shell - no driver mesh at all, which
// reads as lifeless next to the launcher's cute character art. A small
// original driver bust (round helmet + visor + shoulders, no licensing
// concerns since it's built from primitives) seated in the cockpit closes
// that gap cheaply. Coordinates are in the model's own native units (pre
// CAR_SCALE), matching where the body/wheel node offsets already sit.
function buildDriverBust(color: string): THREE.Group {
  const driver = new THREE.Group();
  driver.name = "driver-bust";

  const suit = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.068, 0.045, 4, 10),
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.02 })
  );
  suit.position.set(0, 0.25, 0.08);
  suit.castShadow = true;
  driver.add(suit);

  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.078, 16, 12),
    new THREE.MeshStandardMaterial({ color: "#fff8ec", roughness: 0.4, metalness: 0.02 })
  );
  helmet.scale.set(1, 0.96, 1.02);
  helmet.position.set(0, 0.34, 0.09);
  helmet.castShadow = true;
  driver.add(helmet);

  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.057, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
    // Dark tinted visor (was a pale sky-blue) to match the car's own
    // cockpit glass treatment.
    new THREE.MeshStandardMaterial({ color: "#171c22", roughness: 0.22, metalness: 0.25 })
  );
  visor.rotation.x = Math.PI * 0.92;
  visor.position.set(0, 0.335, 0.03);
  driver.add(visor);

  const eyeMaterial = new THREE.MeshBasicMaterial({ color: "#f8fafc" });
  const cheekMaterial = new THREE.MeshBasicMaterial({ color: "#fb7185", transparent: true, opacity: 0.78 });
  for (const x of [-0.024, 0.024]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 8, 6), eyeMaterial);
    eye.position.set(x, 0.344, -0.026);
    driver.add(eye);

    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), cheekMaterial);
    cheek.position.set(x * 1.55, 0.326, -0.02);
    driver.add(cheek);
  }

  return driver;
}

export function buildImportedCarVisual(library: Pick<RacingAssetLibrary, "carScene">, color: string): ImportedCarVisual {
  const root = cloneWithUniqueMaterials(library.carScene, color) as THREE.Group;
  root.name = "imported-arcade-car";
  root.scale.setScalar(CAR_SCALE);
  root.rotation.y = Math.PI;
  root.add(buildDriverBust(color));
  const bounds = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  bounds.getCenter(center);
  root.position.x = -center.x;
  root.position.z = -center.z;

  const wheels: THREE.Object3D[] = [];
  const frontWheels: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.name === "wheelBackLeft" || object.name === "wheelBackRight") {
      wheels.push(object);
    } else if (object.name === "wheelFrontLeft" || object.name === "wheelFrontRight") {
      wheels.push(object);
      frontWheels.push(object);
    }
  });

  return { root, wheels, frontWheels };
}

function tracksidePosition(progress: number, side: -1 | 1, offset: number): { position: THREE.Vector3; angle: number } {
  const center = centerlinePoint(TEST_OVAL_TRACK, progress);
  const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
  const nx = Math.cos(angle);
  const nz = Math.sin(angle);
  return {
    position: new THREE.Vector3(center.x + nx * side * offset, 0, center.z + nz * side * offset),
    angle
  };
}

/**
 * Stadium dressing built from the same Kenney asset family as the car, so
 * the venue reads as one coherent design instead of a grab bag of styles.
 * Spread around the *entire* lap (not just the start straight) - the track
 * was later extended to a much longer circuit, and props clustered only
 * near start/finish left the rest of the lap reading as empty/unfinished.
 */
export function buildStadiumProps(library: RacingAssetLibrary, density: number): THREE.Group {
  const group = new THREE.Group();
  group.name = "kenney-stadium-props";
  const halfWidth = TEST_OVAL_TRACK.trackHalfWidth;
  const trackLength = TEST_OVAL_TRACK.trackLength;
  const GRANDSTAND_SCALE = 5.2;
  const FLAG_SCALE = 4.2;
  const TREE_SCALE = 4.6;
  const LIGHTPOST_SCALE = 4.8;

  // Grandstands stay concentrated near the start straight (a real venue has
  // one main stand, not stands wrapping the whole circuit). Kept well clear
  // of where the chase camera actually trails behind a car starting at
  // progress 0 - a closer offset had the camera clipping into the stand's
  // own geometry right at the start line.
  const grandstandCount = Math.max(2, Math.round(6 * density));
  for (let i = 0; i < grandstandCount; i++) {
    const progress = -60 - i * 26;
    const side = i % 2 === 0 ? 1 : -1;
    const { position, angle } = tracksidePosition(progress, side, halfWidth + 17);
    const stand = cloneWithUniqueMaterials(library.grandstandScene) as THREE.Group;
    stand.scale.setScalar(GRANDSTAND_SCALE);
    stand.position.copy(position);
    stand.rotation.y = -angle + (side === 1 ? Math.PI : 0);
    group.add(stand);
  }

  // Trees, flags, and light posts wrap the full lap so every corner has
  // trackside presence, not just the start/finish zone.
  const treeSpacing = 26;
  const treeCount = Math.max(20, Math.round((trackLength / treeSpacing) * density));
  for (let i = 0; i < treeCount; i++) {
    const progress = (i / treeCount) * trackLength;
    const side = i % 2 === 0 ? 1 : -1;
    const { position, angle } = tracksidePosition(progress, side, halfWidth + 7 + (i % 3) * 3);
    const tree = cloneWithUniqueMaterials(i % 3 === 0 ? library.treeSmallScene : library.treeLargeScene) as THREE.Group;
    tree.scale.setScalar(TREE_SCALE * (0.85 + (i % 4) * 0.08));
    tree.position.copy(position);
    tree.rotation.y = -angle;
    group.add(tree);
  }

  const flagSpacing = 20;
  const flagCount = Math.max(16, Math.round((trackLength / flagSpacing) * density));
  for (let i = 0; i < flagCount; i++) {
    const progress = (i / flagCount) * trackLength;
    const side = i % 2 === 0 ? 1 : -1;
    const { position, angle } = tracksidePosition(progress, side, halfWidth + 5);
    const flag = cloneWithUniqueMaterials(library.flagScene) as THREE.Group;
    flag.scale.setScalar(FLAG_SCALE);
    flag.position.copy(position);
    flag.rotation.y = -angle;
    group.add(flag);
  }

  const lightSpacing = 40;
  const lightCount = Math.max(10, Math.round((trackLength / lightSpacing) * density));
  for (let i = 0; i < lightCount; i++) {
    const progress = (i / lightCount) * trackLength;
    const side = i % 2 === 0 ? 1 : -1;
    const { position, angle } = tracksidePosition(progress, side, halfWidth + 3.6);
    const post = cloneWithUniqueMaterials(library.lightpostScene) as THREE.Group;
    post.scale.setScalar(LIGHTPOST_SCALE);
    post.position.copy(position);
    post.rotation.y = -angle;
    group.add(post);
  }

  return group;
}
