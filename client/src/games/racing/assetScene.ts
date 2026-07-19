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
    position: new THREE.Vector3(center.x + nx * side * offset, center.y ?? 0, center.z + nz * side * offset),
    angle
  };
}

function makeToonMaterial(color: string, emissive = "#000000", emissiveIntensity = 0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.58,
    metalness: 0.04,
    emissive,
    emissiveIntensity
  });
}

function createAdTexture(title: string, subtitle: string, background: string, accent: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, background);
  gradient.addColorStop(1, accent);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#ffffff";
  for (let x = -40; x < canvas.width; x += 54) {
    ctx.beginPath();
    ctx.arc(x, 56, 24, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(12,18,36,0.22)";
  ctx.fillRect(0, 190, canvas.width, 66);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "900 48px Arial, sans-serif";
  ctx.strokeStyle = "rgba(19,24,46,0.42)";
  ctx.lineWidth = 8;
  ctx.strokeText(title, canvas.width / 2, 112);
  ctx.fillText(title, canvas.width / 2, 112);

  ctx.font = "800 24px Arial, sans-serif";
  ctx.fillStyle = "#fff7db";
  ctx.fillText(subtitle, canvas.width / 2, 222);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function createLabelTexture(label: string, background: string, accent = "#ffffff"): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    for (let i = 0; i < 8; i++) ctx.fillRect(i * 58 - 20, 0, 18, canvas.height);
    ctx.fillStyle = accent;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 42px Arial, sans-serif";
    ctx.strokeStyle = "rgba(15,23,42,0.38)";
    ctx.lineWidth = 6;
    ctx.strokeText(label, canvas.width / 2, canvas.height / 2);
    ctx.fillText(label, canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function createFunPosterTexture(title: string, background: string, accent: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      ctx.arc((i * 73) % canvas.width, 54 + (i % 4) * 92, 32, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#fff7ed";
    ctx.beginPath();
    ctx.arc(256, 218, 108, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.roundRect(168, 248, 176, 122, 54);
    ctx.fill();
    ctx.fillStyle = "#111827";
    for (const x of [218, 294]) {
      ctx.beginPath();
      ctx.ellipse(x, 210, 17, 28, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(256, 240, 48, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 50px Arial, sans-serif";
    ctx.strokeStyle = "rgba(15,23,42,0.45)";
    ctx.lineWidth = 8;
    ctx.strokeText(title, canvas.width / 2, 420);
    ctx.fillText(title, canvas.width / 2, 420);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function addWindowGrid(building: THREE.Group, width: number, height: number, depth: number, columns: number, rows: number): void {
  const lit = new THREE.MeshBasicMaterial({ color: "#fff4a8" });
  const dim = new THREE.MeshBasicMaterial({ color: "#94e2ff" });
  const pink = new THREE.MeshBasicMaterial({ color: "#f9a8d4" });
  const windowGeometry = new THREE.PlaneGeometry(1.02, 0.68);
  const startX = -width * 0.34;
  const stepX = (width * 0.68) / Math.max(1, columns - 1);
  const startY = height * 0.24;
  const stepY = (height * 0.56) / Math.max(1, rows - 1);

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const material = (row + column) % 5 === 0 ? pink : (row + column) % 3 === 0 ? lit : dim;
      const window = new THREE.Mesh(windowGeometry, material);
      window.position.set(startX + column * stepX, startY + row * stepY, -depth / 2 - 0.04);
      window.rotation.x = 0;
      building.add(window);
    }
  }
}

function buildReadablePanel(width: number, height: number, texture: THREE.Texture): THREE.Group {
  const panel = new THREE.Group();
  const front = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
  );
  front.position.z = 0.04;
  panel.add(front);

  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
  );
  back.position.z = -0.04;
  back.rotation.y = Math.PI;
  panel.add(back);

  return panel;
}

function addBuildingDetails(building: THREE.Group, width: number, height: number, depth: number, detailIndex: number): void {
  const trimColors = ["#facc15", "#38bdf8", "#fb7185", "#a78bfa", "#22c55e"];
  const trimMaterial = new THREE.MeshBasicMaterial({ color: trimColors[detailIndex % trimColors.length], toneMapped: false });
  const sideWindow = new THREE.MeshBasicMaterial({ color: "#dff7ff", transparent: true, opacity: 0.86 });
  const balconyMaterial = makeToonMaterial("#e2e8f0");

  for (let y = 6; y < height - 2; y += 5.5) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(width * 0.92, 0.12, 0.12), trimMaterial);
    band.position.set(0, y, -depth / 2 - 0.09);
    building.add(band);
  }

  for (const side of [-1, 1] as const) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(depth * 0.54, height * 0.55), sideWindow);
    panel.position.set(side * (width / 2 + 0.04), height * 0.52, -depth * 0.08);
    panel.rotation.y = side * Math.PI / 2;
    building.add(panel);

    for (let y = 7; y < height * 0.85; y += 7.2) {
      const balcony = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, depth * 0.44), balconyMaterial);
      balcony.position.set(side * (width / 2 + 0.2), y, -depth * 0.08);
      building.add(balcony);
      const neon = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.95, depth * 0.28),
        new THREE.MeshBasicMaterial({ color: trimColors[(detailIndex + Math.round(y)) % trimColors.length], toneMapped: false })
      );
      neon.position.set(side * (width / 2 + 0.42), y + 0.75, -depth * 0.08);
      building.add(neon);
    }

    const sidePoster = buildReadablePanel(
      Math.min(depth * 0.78, 6.2),
      Math.min(height * 0.16, 5.4),
      createLabelTexture(["SEOUL", "NITRO", "RALLY", "BOOST", "DRIFT"][detailIndex % 5]!, trimColors[(detailIndex + 1) % trimColors.length]!)
    );
    sidePoster.position.set(side * (width / 2 + 0.22), height * 0.72, -depth * 0.18);
    sidePoster.rotation.y = side * Math.PI / 2;
    building.add(sidePoster);

    const blade = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, Math.min(9, height * 0.34), 0.22),
      new THREE.MeshBasicMaterial({ color: trimColors[(detailIndex + 2) % trimColors.length], toneMapped: false })
    );
    blade.position.set(side * (width / 2 + 0.18), height * 0.48, -depth / 2 - 0.35);
    building.add(blade);
  }

  const roofSign = buildReadablePanel(
    Math.min(width * 0.72, 10),
    1.55,
    createLabelTexture(["CAFE", "PC BANG", "K-DRIFT", "MART", "ARCADE"][detailIndex % 5]!, trimColors[detailIndex % trimColors.length]!)
  );
  roofSign.position.set(0, height + 1.45, -depth * 0.18);
  building.add(roofSign);

  const hvacMaterial = makeToonMaterial("#cbd5e1");
  for (let i = 0; i < 2 + (detailIndex % 2); i++) {
    const unit = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.55, 1), hvacMaterial);
    unit.position.set(-width * 0.25 + i * 2.2, height + 0.55, depth * 0.12);
    unit.castShadow = true;
    building.add(unit);
  }
}

function buildCityBuilding(
  width: number,
  height: number,
  depth: number,
  color: string,
  signTexture: THREE.Texture,
  signWidth: number,
  signHeight: number,
  detailIndex = 0
): THREE.Group {
  const building = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), makeToonMaterial(color));
  body.position.y = height / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  building.add(body);

  const trim = new THREE.Mesh(new THREE.BoxGeometry(width + 0.8, 0.45, depth + 0.8), makeToonMaterial("#2f3b66"));
  trim.position.y = height + 0.22;
  trim.castShadow = true;
  building.add(trim);

  addWindowGrid(building, width, height, depth, Math.max(4, Math.floor(width / 2.7)), Math.max(3, Math.floor(height / 4.6)));

  const sign = buildReadablePanel(signWidth, signHeight, signTexture);
  sign.position.set(0, height * 0.72, -depth / 2 - 0.09);
  building.add(sign);

  const awning = new THREE.Mesh(new THREE.BoxGeometry(width * 0.82, 0.55, 1.1), makeToonMaterial("#ffbe3d"));
  awning.position.set(0, 2.7, -depth / 2 - 0.45);
  awning.castShadow = true;
  building.add(awning);
  addBuildingDetails(building, width, height, depth, detailIndex);

  return building;
}

function buildStreetLight(color = "#6edcff"): THREE.Group {
  const light = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 7.2, 8), makeToonMaterial("#60a5fa"));
  pole.position.y = 3.6;
  pole.castShadow = true;
  light.add(pole);

  const arm = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.16, 0.16), makeToonMaterial("#facc15"));
  arm.position.set(1.65, 7, 0);
  arm.castShadow = true;
  light.add(arm);

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.36, 12, 8),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 })
  );
  bulb.position.set(3.35, 6.85, 0);
  light.add(bulb);

  return light;
}

function buildTrafficLight(): THREE.Group {
  const traffic = new THREE.Group();
  const poleMaterial = makeToonMaterial("#60a5fa");
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 5.4, 8), poleMaterial);
  pole.position.y = 2.7;
  traffic.add(pole);

  const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.55, 0.38), makeToonMaterial("#7c3aed"));
  box.position.set(0, 5.55, 0);
  traffic.add(box);

  const colors = ["#ef4444", "#facc15", "#22c55e"];
  for (let i = 0; i < colors.length; i++) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), new THREE.MeshBasicMaterial({ color: colors[i] }));
    lamp.position.set(0, 6.04 - i * 0.45, -0.22);
    traffic.add(lamp);
  }

  return traffic;
}

function buildCone(): THREE.Group {
  const cone = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.38, 1.05, 16), makeToonMaterial("#ff7a1a"));
  body.position.y = 0.55;
  body.castShadow = true;
  cone.add(body);
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.29, 0.12, 16), new THREE.MeshBasicMaterial({ color: "#ffffff" }));
  stripe.position.y = 0.68;
  cone.add(stripe);
  return cone;
}

function buildParkedVehicle(color: string, accent: string): THREE.Group {
  const vehicle = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.65, 2.7), makeToonMaterial(color));
  body.position.y = 1.05;
  body.castShadow = true;
  vehicle.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.25, 2.2), makeToonMaterial(accent, accent, 0.08));
  cabin.position.set(-0.25, 2.08, 0);
  cabin.castShadow = true;
  vehicle.add(cabin);
  const tireMaterial = makeToonMaterial("#111827");
  for (const x of [-1.9, 1.9]) {
    for (const z of [-1.45, 1.45]) {
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.36, 16), tireMaterial);
      tire.rotation.x = Math.PI / 2;
      tire.position.set(x, 0.48, z);
      tire.castShadow = true;
      vehicle.add(tire);
    }
  }
  return vehicle;
}

function buildBusStop(texture: THREE.Texture): THREE.Group {
  const stop = new THREE.Group();
  const metal = makeToonMaterial("#334155");
  const glass = new THREE.MeshBasicMaterial({ color: "#c7f7ff", transparent: true, opacity: 0.58, side: THREE.DoubleSide });
  const roof = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.32, 2.2), makeToonMaterial("#2563eb", "#38bdf8", 0.08));
  roof.position.y = 3.2;
  stop.add(roof);
  for (const x of [-2.25, 2.25]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 8), metal);
    post.position.set(x, 1.6, 0.7);
    stop.add(post);
  }
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 2.2), glass);
  pane.position.set(0, 1.7, 0.86);
  stop.add(pane);
  const ad = buildReadablePanel(2.5, 1.3, texture);
  ad.position.set(-1.15, 1.7, 0.93);
  stop.add(ad);
  const bench = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.28, 0.72), makeToonMaterial("#facc15"));
  bench.position.set(0.6, 0.75, -0.25);
  bench.castShadow = true;
  stop.add(bench);
  return stop;
}

function buildCafePatio(): THREE.Group {
  const patio = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.2, 8), makeToonMaterial("#475569"));
  pole.position.y = 1.1;
  patio.add(pole);
  const umbrella = new THREE.Mesh(new THREE.ConeGeometry(1.55, 0.72, 18), makeToonMaterial("#fb7185", "#fb7185", 0.08));
  umbrella.position.y = 2.45;
  patio.add(umbrella);
  for (const x of [-0.82, 0.82]) {
    const table = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.12, 16), makeToonMaterial("#f8fafc"));
    table.position.set(x, 0.72, 0.7);
    patio.add(table);
    const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.32, 12), makeToonMaterial("#38bdf8"));
    stool.position.set(x, 0.28, 1.32);
    patio.add(stool);
  }
  return patio;
}

function buildSubwayEntrance(): THREE.Group {
  const entrance = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.28, 3.2), makeToonMaterial("#94a3b8"));
  base.position.y = 0.14;
  entrance.add(base);
  const stair = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.15, 2.2), makeToonMaterial("#1f2937"));
  stair.position.y = 0.68;
  entrance.add(stair);
  const sign = buildReadablePanel(3.8, 1.4, createLabelTexture("METRO", "#22c55e"));
  sign.position.set(0, 2.35, -1.25);
  entrance.add(sign);
  for (const x of [-1.9, 1.9]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.4, 8), makeToonMaterial("#334155"));
    post.position.set(x, 1.22, -1.22);
    entrance.add(post);
  }
  return entrance;
}

function buildMascotStatue(color: string): THREE.Group {
  const mascot = new THREE.Group();
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.45, 0.55, 18), makeToonMaterial("#e5e7eb"));
  plinth.position.y = 0.28;
  mascot.add(plinth);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 0.75, 4, 12), makeToonMaterial(color, color, 0.06));
  body.position.y = 1.45;
  mascot.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 12), makeToonMaterial("#fff7ed"));
  head.position.y = 2.38;
  mascot.add(head);
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: "#111827" });
  for (const x of [-0.22, 0.22]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), eyeMaterial);
    eye.position.set(x, 2.44, -0.55);
    mascot.add(eye);
  }
  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.78, 8), makeToonMaterial("#334155"));
  antenna.position.set(0, 3.04, 0);
  mascot.add(antenna);
  return mascot;
}

function buildStreetTree(): THREE.Group {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.7, 8), makeToonMaterial("#8b5e34"));
  trunk.position.y = 0.85;
  tree.add(trunk);
  const crown = new THREE.Mesh(new THREE.SphereGeometry(1.05, 14, 10), makeToonMaterial("#22c55e"));
  crown.scale.set(1.2, 0.95, 1);
  crown.position.y = 2.05;
  tree.add(crown);
  return tree;
}

function buildPalmTree(): THREE.Group {
  const palm = new THREE.Group();
  const trunkMaterial = makeToonMaterial("#b7793a");
  const leafMaterial = makeToonMaterial("#22c55e");
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.34, 5.6, 9), trunkMaterial);
  trunk.position.y = 2.8;
  trunk.rotation.z = 0.08;
  trunk.castShadow = true;
  palm.add(trunk);

  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.42, 3.4, 8), leafMaterial);
    const angle = (i / 7) * Math.PI * 2;
    leaf.position.set(Math.cos(angle) * 1.1, 5.8, Math.sin(angle) * 1.1);
    leaf.rotation.z = Math.PI / 2;
    leaf.rotation.y = -angle;
    leaf.scale.set(0.72, 1, 0.28);
    palm.add(leaf);
  }

  return palm;
}

function buildBalloonCluster(): THREE.Group {
  const cluster = new THREE.Group();
  const colors = ["#facc15", "#fb7185", "#38bdf8", "#22c55e", "#a78bfa"];
  for (let i = 0; i < 7; i++) {
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 2.8 + (i % 3) * 0.35, 5), makeToonMaterial("#94a3b8"));
    string.position.set((i - 3) * 0.34, 1.65, (i % 2) * 0.24);
    cluster.add(string);
    const balloon = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 12, 8),
      new THREE.MeshBasicMaterial({ color: colors[i % colors.length]!, toneMapped: false })
    );
    balloon.scale.set(0.88, 1.18, 0.88);
    balloon.position.set((i - 3) * 0.34, 3.15 + (i % 3) * 0.35, (i % 2) * 0.24);
    cluster.add(balloon);
  }
  return cluster;
}

function buildFoodTruck(): THREE.Group {
  const truck = buildLargeBus("#fb7185");
  truck.scale.set(0.72, 0.82, 0.78);
  const awning = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.25, 1.15), makeToonMaterial("#facc15"));
  awning.position.set(0.45, 2.75, -1.95);
  truck.add(awning);
  const menu = buildReadablePanel(2.8, 1.2, createLabelTexture("SNACK", "#f97316"));
  menu.position.set(1.1, 2.05, -2.02);
  truck.add(menu);
  return truck;
}

function buildFountain(): THREE.Group {
  const fountain = new THREE.Group();
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.4, 0.45, 24), makeToonMaterial("#e5e7eb"));
  basin.position.y = 0.22;
  fountain.add(basin);
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(1.75, 1.9, 0.08, 24),
    new THREE.MeshBasicMaterial({ color: "#38bdf8", transparent: true, opacity: 0.82 })
  );
  water.position.y = 0.5;
  fountain.add(water);
  for (let i = 0; i < 5; i++) {
    const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.6 + (i % 2) * 0.4, 8), new THREE.MeshBasicMaterial({ color: "#bae6fd", toneMapped: false }));
    const a = (i / 5) * Math.PI * 2;
    jet.position.set(Math.cos(a) * 0.72, 1.18, Math.sin(a) * 0.72);
    fountain.add(jet);
  }
  return fountain;
}

function buildMarketStall(color: string): THREE.Group {
  const stall = new THREE.Group();
  const counter = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.1, 1.7), makeToonMaterial("#fde68a"));
  counter.position.y = 0.55;
  stall.add(counter);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(4.3, 0.36, 2.35), makeToonMaterial(color, color, 0.08));
  roof.position.y = 2.65;
  stall.add(roof);
  for (const x of [-1.8, 1.8]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 2.4, 8), makeToonMaterial("#475569"));
    post.position.set(x, 1.45, -0.72);
    stall.add(post);
  }
  const sign = buildReadablePanel(2.6, 0.95, createLabelTexture("POP", color));
  sign.position.set(0, 2.08, -0.92);
  stall.add(sign);
  return stall;
}

function buildPlanter(color: string): THREE.Group {
  const planter = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.62, 0.95), makeToonMaterial(color));
  pot.position.y = 0.31;
  pot.castShadow = true;
  planter.add(pot);
  for (const x of [-0.8, 0, 0.8]) {
    const shrub = new THREE.Mesh(new THREE.SphereGeometry(0.48, 12, 8), makeToonMaterial("#22c55e"));
    shrub.scale.set(1.05, 0.7, 0.9);
    shrub.position.set(x, 0.9, 0);
    planter.add(shrub);
  }
  return planter;
}

function buildVendingKiosk(texture: THREE.Texture): THREE.Group {
  const kiosk = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.35, 3.7, 1.25), makeToonMaterial("#2563eb", "#38bdf8", 0.08));
  body.position.y = 1.85;
  body.castShadow = true;
  kiosk.add(body);
  const screen = buildReadablePanel(1.55, 1.2, texture);
  screen.position.set(0, 2.55, -0.68);
  kiosk.add(screen);
  const slot = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.28, 0.08), new THREE.MeshBasicMaterial({ color: "#facc15", toneMapped: false }));
  slot.position.set(0, 1.18, -0.72);
  kiosk.add(slot);
  return kiosk;
}

function buildPhotoBooth(color: string): THREE.Group {
  const booth = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(3, 3.8, 1.8), makeToonMaterial(color, color, 0.06));
  body.position.y = 1.9;
  body.castShadow = true;
  booth.add(body);
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 2.55), new THREE.MeshBasicMaterial({ color: "#111827", transparent: true, opacity: 0.86 }));
  curtain.position.set(-0.45, 1.85, -0.94);
  booth.add(curtain);
  const sign = buildReadablePanel(2.3, 0.9, createLabelTexture("PHOTO", "#db2777"));
  sign.position.set(0, 3.55, -0.98);
  booth.add(sign);
  return booth;
}

function buildMiniStage(texture: THREE.Texture): THREE.Group {
  const stage = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.55, 3.4), makeToonMaterial("#334155"));
  base.position.y = 0.28;
  base.castShadow = true;
  stage.add(base);
  const backdrop = buildReadablePanel(5.2, 2.2, texture);
  backdrop.position.set(0, 2.1, 1.75);
  backdrop.rotation.y = Math.PI;
  stage.add(backdrop);
  for (const x of [-2.4, 2.4]) {
    const speaker = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.25, 0.75), makeToonMaterial("#111827"));
    speaker.position.set(x, 1.05, -0.75);
    stage.add(speaker);
  }
  return stage;
}

function buildFunPlazaCluster(index: number, texture: THREE.Texture): THREE.Group {
  const cluster = new THREE.Group();
  const palette = [
    ["#fbcfe8", "#db2777"],
    ["#bbf7d0", "#16a34a"],
    ["#fed7aa", "#f97316"],
    ["#bfdbfe", "#2563eb"],
    ["#ddd6fe", "#7c3aed"]
  ] as const;
  const [baseColor, accent] = palette[index % palette.length]!;
  const pad = buildPaintedPlaza(baseColor, accent);
  pad.scale.set(1.15, 1, 0.95);
  cluster.add(pad);

  const main =
    index % 5 === 0
      ? buildMiniStage(texture)
      : index % 5 === 1
        ? buildPhotoBooth(accent)
        : index % 5 === 2
          ? buildVendingKiosk(texture)
          : index % 5 === 3
            ? buildMarketStall(accent)
            : buildCafePatio();
  main.position.set(-1.4, 0, -0.35);
  main.scale.setScalar(index % 5 === 0 ? 0.82 : 1.05);
  cluster.add(main);

  const planterA = buildPlanter(index % 2 === 0 ? "#facc15" : "#38bdf8");
  planterA.position.set(3.25, 0, -2.05);
  planterA.rotation.y = 0.18;
  cluster.add(planterA);

  const planterB = buildPlanter(index % 2 === 0 ? "#fb7185" : "#f97316");
  planterB.position.set(2.8, 0, 2.05);
  planterB.rotation.y = -0.28;
  cluster.add(planterB);

  if (index % 2 === 0) {
    const balloons = buildBalloonCluster();
    balloons.position.set(-3.55, 0, 2.2);
    balloons.scale.setScalar(0.92);
    cluster.add(balloons);
  } else {
    const mascot = buildMascotStatue(index % 3 === 0 ? "#fb7185" : "#f97316");
    mascot.position.set(-3.2, 0, 2.1);
    mascot.scale.setScalar(0.72);
    cluster.add(mascot);
  }

  return cluster;
}

function buildSkateRamp(): THREE.Group {
  const ramp = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.35, 2.4), makeToonMaterial("#a78bfa"));
  deck.position.y = 0.45;
  deck.rotation.z = -0.18;
  ramp.add(deck);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.06, 0.28), new THREE.MeshBasicMaterial({ color: "#facc15", toneMapped: false }));
  stripe.position.set(0, 0.7, -0.62);
  stripe.rotation.z = -0.18;
  ramp.add(stripe);
  return ramp;
}

function buildPaintedPlaza(color: string, accent: string): THREE.Group {
  const plaza = new THREE.Group();
  const base = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 7.2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.72 }));
  base.rotation.x = -Math.PI / 2;
  base.position.y = 0.13;
  plaza.add(base);
  for (let i = 0; i < 5; i++) {
    const circle = new THREE.Mesh(new THREE.CircleGeometry(0.55 + (i % 2) * 0.25, 20), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.76 }));
    circle.rotation.x = -Math.PI / 2;
    circle.position.set(-3.2 + i * 1.6, 0.15, (i % 2 === 0 ? -1 : 1) * 1.7);
    plaza.add(circle);
  }
  return plaza;
}

function buildGiantVideoWall(texture: THREE.Texture): THREE.Group {
  const wall = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(16, 10, 1.4), makeToonMaterial("#172554"));
  base.position.y = 5;
  base.castShadow = true;
  wall.add(base);
  const screen = buildReadablePanel(14.2, 7.4, texture);
  screen.position.set(0, 5.6, -0.78);
  wall.add(screen);
  const marquee = buildReadablePanel(10.5, 1.8, createLabelTexture("LIVE KART", "#f97316"));
  marquee.position.set(0, 10.9, -0.84);
  wall.add(marquee);
  return wall;
}

function buildSeoulTowerIcon(): THREE.Group {
  const icon = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 0.8, 18), makeToonMaterial("#e5e7eb"));
  base.position.y = 0.4;
  icon.add(base);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 8.5, 12), makeToonMaterial("#334155"));
  mast.position.y = 4.8;
  icon.add(mast);
  const deck = new THREE.Mesh(new THREE.SphereGeometry(1.2, 18, 10), makeToonMaterial("#38bdf8", "#38bdf8", 0.15));
  deck.scale.set(1.25, 0.55, 1.25);
  deck.position.y = 8.2;
  icon.add(deck);
  const needle = new THREE.Mesh(new THREE.ConeGeometry(0.22, 2.2, 12), makeToonMaterial("#fb7185", "#fb7185", 0.1));
  needle.position.y = 10.1;
  icon.add(needle);
  return icon;
}

function buildFeatureMall(texture: THREE.Texture): THREE.Group {
  const mall = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(18, 13, 9), makeToonMaterial("#7c3aed", "#7c3aed", 0.04));
  body.position.y = 6.5;
  body.castShadow = true;
  mall.add(body);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(15.5, 8.2), new THREE.MeshBasicMaterial({ color: "#bff6ff", transparent: true, opacity: 0.78 }));
  glass.position.set(0, 7.2, -4.56);
  mall.add(glass);
  const sign = buildReadablePanel(12.5, 3.2, texture);
  sign.position.set(0, 11.4, -4.65);
  mall.add(sign);
  for (const x of [-6, -2, 2, 6]) {
    const banner = new THREE.Mesh(new THREE.BoxGeometry(1.2, 5.8, 0.22), new THREE.MeshBasicMaterial({ color: x < 0 ? "#facc15" : "#fb7185", toneMapped: false }));
    banner.position.set(x, 5.4, -4.75);
    mall.add(banner);
  }
  return mall;
}

function buildLargeBus(color: string): THREE.Group {
  const bus = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(9.2, 2.8, 3.1), makeToonMaterial(color));
  body.position.y = 1.6;
  body.castShadow = true;
  bus.add(body);
  const windows = new THREE.Mesh(new THREE.PlaneGeometry(7.7, 1.1), new THREE.MeshBasicMaterial({ color: "#dff7ff", transparent: true, opacity: 0.9 }));
  windows.position.set(0, 2.15, -1.58);
  bus.add(windows);
  const route = buildReadablePanel(3.8, 0.82, createLabelTexture("SEOUL", "#111827"));
  route.position.set(-2.3, 2.98, -1.62);
  bus.add(route);
  const tireMaterial = makeToonMaterial("#111827");
  for (const x of [-3.2, 3.2]) {
    for (const z of [-1.65, 1.65]) {
      const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 16), tireMaterial);
      tire.rotation.x = Math.PI / 2;
      tire.position.set(x, 0.55, z);
      tire.castShadow = true;
      bus.add(tire);
    }
  }
  return bus;
}

function buildLandmark(index: number, texture: THREE.Texture): THREE.Group {
  switch (index % 4) {
    case 0:
      return buildGiantVideoWall(texture);
    case 1:
      return buildFeatureMall(texture);
    case 2:
      return buildSeoulTowerIcon();
    default:
      return buildLargeBus(index % 2 === 0 ? "#2563eb" : "#facc15");
  }
}

function buildRoadsidePoster(title: string, color: string, accent: string): THREE.Group {
  const poster = new THREE.Group();
  const panel = buildReadablePanel(4.8, 5.4, createFunPosterTexture(title, color, accent));
  panel.position.y = 4.4;
  poster.add(panel);
  const frameMaterial = makeToonMaterial("#172554");
  const base = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.32, 0.35), frameMaterial);
  base.position.y = 1.55;
  poster.add(base);
  for (const x of [-2.25, 2.25]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.6, 8), frameMaterial);
    pole.position.set(x, 2.35, 0.15);
    pole.castShadow = true;
    poster.add(pole);
  }
  return poster;
}

function buildStreetProp(index: number, texture: THREE.Texture): THREE.Group {
  switch (index % 11) {
    case 0:
      return buildBusStop(texture);
    case 1:
      return buildCafePatio();
    case 2:
      return buildSubwayEntrance();
    case 3:
      return buildMascotStatue("#fb7185");
    case 4:
      return buildParkedVehicle("#facc15", "#bae6fd");
    case 5:
      return buildStreetTree();
    case 6:
      return buildBalloonCluster();
    case 7:
      return buildFoodTruck();
    case 8:
      return buildFountain();
    case 9:
      return buildMarketStall("#38bdf8");
    default:
      return buildSkateRamp();
  }
}

function buildStartStorefront(width: number, height: number, color: string, roofColor: string, signTexture: THREE.Texture): THREE.Group {
  const store = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, 7.4), makeToonMaterial(color));
  body.position.y = height / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  store.add(body);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(width + 1.2, 1.2, 8.2), makeToonMaterial(roofColor));
  roof.position.y = height + 0.6;
  roof.castShadow = true;
  store.add(roof);

  const sign = buildReadablePanel(width * 0.68, 2.2, signTexture);
  sign.position.set(0, height * 0.72, -3.78);
  store.add(sign);

  const door = new THREE.Mesh(new THREE.BoxGeometry(2.1, 3.3, 0.12), makeToonMaterial("#15324a", "#38bdf8", 0.08));
  door.position.set(0, 1.65, -3.86);
  store.add(door);

  const windowMaterial = new THREE.MeshBasicMaterial({ color: "#fff2a8" });
  for (const x of [-width * 0.28, width * 0.28]) {
    const window = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.5), windowMaterial);
    window.position.set(x, 3.1, -3.93);
    store.add(window);
  }

  const awning = new THREE.Mesh(new THREE.BoxGeometry(width * 0.84, 0.42, 1.45), makeToonMaterial("#facc15"));
  awning.position.set(0, 4.05, -4.25);
  awning.castShadow = true;
  store.add(awning);

  return store;
}

function buildKartBarrier(width: number, color: string): THREE.Group {
  const barrier = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(width, 0.75, 0.55), makeToonMaterial(color));
  top.position.y = 0.85;
  top.castShadow = true;
  barrier.add(top);
  const base = new THREE.Mesh(new THREE.BoxGeometry(width, 0.38, 0.75), makeToonMaterial("#f8fafc"));
  base.position.y = 0.28;
  base.castShadow = true;
  barrier.add(base);
  return barrier;
}

function buildStartGate(texture: THREE.Texture): THREE.Group {
  const gate = new THREE.Group();
  const stone = makeToonMaterial("#f3e4c7");
  const trim = makeToonMaterial("#facc15", "#f97316", 0.14);
  for (const x of [-18.5, 18.5]) {
    const tower = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(3.2, 8.2, 3), stone);
    base.position.y = 4.1;
    base.castShadow = true;
    tower.add(base);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.55, 2.15, 4), makeToonMaterial("#3b82f6"));
    cap.position.y = 9.35;
    cap.rotation.y = Math.PI / 4;
    cap.castShadow = true;
    tower.add(cap);
    const window = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 1.8), new THREE.MeshBasicMaterial({ color: "#fff1a8" }));
    window.position.set(0, 5.35, -1.55);
    tower.add(window);
    tower.position.x = x;
    gate.add(tower);
  }

  const arch = new THREE.Mesh(new THREE.BoxGeometry(24.5, 0.52, 1.08), trim);
  arch.position.y = 9.45;
  arch.castShadow = true;
  gate.add(arch);

  for (let i = 0; i < 10; i++) {
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 10, 8),
      new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? "#38bdf8" : "#fb7185", toneMapped: false })
    );
    bulb.position.set(-10.2 + i * 2.28, 9.83, -0.66);
    gate.add(bulb);
  }

  const banner = buildReadablePanel(15.8, 2.35, texture);
  banner.position.set(0, 9.36, -0.72);
  gate.add(banner);

  return gate;
}

function buildOverheadBanner(width: number, label: string, color: string, accent: string): THREE.Group {
  const banner = new THREE.Group();
  const railMaterial = makeToonMaterial("#24435f");
  for (const x of [-width / 2, width / 2]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 8.8, 8), railMaterial);
    post.position.set(x, 4.4, 0);
    post.castShadow = true;
    banner.add(post);
  }

  const bar = new THREE.Mesh(new THREE.BoxGeometry(width + 1.2, 0.34, 0.32), railMaterial);
  bar.position.y = 8.65;
  bar.castShadow = true;
  banner.add(bar);

  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 180;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = accent;
    for (let x = -60; x < canvas.width; x += 92) {
      ctx.beginPath();
      ctx.arc(x, 0, 58, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "900 54px Arial, sans-serif";
    ctx.strokeStyle = "rgba(15,23,42,0.35)";
    ctx.lineWidth = 8;
    ctx.strokeText(label, canvas.width / 2, 92);
    ctx.fillText(label, canvas.width / 2, 92);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  const sign = buildReadablePanel(width * 0.72, 2.1, texture);
  sign.position.y = 8.55;
  banner.add(sign);

  return banner;
}

function addOverheadBanner(group: THREE.Group, progress: number, banner: THREE.Group): void {
  const center = centerlinePoint(TEST_OVAL_TRACK, progress);
  const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
  banner.position.set(center.x, center.y ?? 0, center.z);
  banner.rotation.y = -angle;
  group.add(banner);
}

function buildSeoulSkyBridge(texture: THREE.Texture): THREE.Group {
  const bridge = new THREE.Group();
  const towerMaterial = makeToonMaterial("#fef3c7");
  const blueTrim = makeToonMaterial("#2563eb", "#38bdf8", 0.08);
  const gold = makeToonMaterial("#facc15", "#facc15", 0.12);
  const pink = makeToonMaterial("#fb7185", "#fb7185", 0.12);
  const glass = new THREE.MeshBasicMaterial({ color: "#bff6ff", transparent: true, opacity: 0.62 });
  const halfWidth = TEST_OVAL_TRACK.trackHalfWidth;
  const towerX = halfWidth + 12;

  for (const side of [-1, 1] as const) {
    const tower = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(5.4, 15.5, 5.2), towerMaterial);
    base.position.y = 7.75;
    base.castShadow = true;
    tower.add(base);

    const cap = new THREE.Mesh(new THREE.ConeGeometry(4.4, 3.2, 4), blueTrim);
    cap.rotation.y = Math.PI / 4;
    cap.position.y = 17.1;
    cap.castShadow = true;
    tower.add(cap);

    const screen = buildReadablePanel(3.6, 2.2, createLabelTexture(side === 1 ? "SEOUL" : "RALLY", side === 1 ? "#2563eb" : "#db2777"));
    screen.position.set(0, 9.2, -2.68);
    tower.add(screen);

    tower.position.x = side * towerX;
    bridge.add(tower);
  }

  const deck = new THREE.Mesh(new THREE.BoxGeometry(halfWidth * 2 + 30, 1.15, 8.2), gold);
  deck.position.y = 13.1;
  deck.castShadow = true;
  bridge.add(deck);

  const walkway = new THREE.Mesh(new THREE.BoxGeometry(halfWidth * 2 + 23, 3.8, 3.4), glass);
  walkway.position.y = 15.2;
  bridge.add(walkway);

  const banner = buildReadablePanel(24, 3.1, texture);
  banner.position.set(0, 15.25, -4.2);
  bridge.add(banner);

  for (let i = 0; i < 14; i++) {
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 10, 8),
      new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? "#38bdf8" : "#fb7185", toneMapped: false })
    );
    bulb.position.set(-halfWidth - 7 + i * ((halfWidth * 2 + 14) / 13), 17.35, -4.42);
    bridge.add(bulb);
  }

  for (const side of [-1, 1] as const) {
    const cable = new THREE.Mesh(new THREE.BoxGeometry(halfWidth + 12, 0.22, 0.22), pink);
    cable.position.set(side * (halfWidth * 0.52), 19.2, -3.7);
    cable.rotation.z = side * 0.34;
    bridge.add(cable);
  }

  return bridge;
}

function buildNeonTunnel(texture: THREE.Texture): THREE.Group {
  const tunnel = new THREE.Group();
  const halfWidth = TEST_OVAL_TRACK.trackHalfWidth;
  const roofMaterial = makeToonMaterial("#7c3aed", "#a78bfa", 0.16);
  const sideMaterial = makeToonMaterial("#0f766e", "#38bdf8", 0.1);
  const ringColors = ["#38bdf8", "#fb7185", "#facc15", "#22c55e"];

  for (let i = 0; i < 7; i++) {
    const z = -21 + i * 7;
    const frame = new THREE.Group();
    for (const side of [-1, 1] as const) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(1.1, 8.6, 1.45), sideMaterial);
      wall.position.set(side * (halfWidth + 3.8), 4.3, z);
      wall.castShadow = true;
      frame.add(wall);

      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 5.8, 1.62),
        new THREE.MeshBasicMaterial({ color: ringColors[(i + (side === 1 ? 0 : 2)) % ringColors.length]!, toneMapped: false })
      );
      stripe.position.set(side * (halfWidth + 3.15), 4.9, z);
      frame.add(stripe);
    }

    const roof = new THREE.Mesh(new THREE.BoxGeometry(halfWidth * 2 + 8.8, 1.08, 1.7), roofMaterial);
    roof.position.set(0, 9.35, z);
    roof.castShadow = true;
    frame.add(roof);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(halfWidth + 4.2, 0.18, 8, 48, Math.PI),
      new THREE.MeshBasicMaterial({ color: ringColors[i % ringColors.length]!, toneMapped: false })
    );
    ring.position.set(0, 8.55, z - 0.06);
    ring.rotation.z = Math.PI;
    frame.add(ring);
    tunnel.add(frame);
  }

  const roofSign = buildReadablePanel(22, 3, texture);
  roofSign.position.set(0, 11.25, -24.5);
  tunnel.add(roofSign);

  return tunnel;
}

function buildHillChevron(color: string): THREE.Group {
  const chevrons = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  for (let i = 0; i < 5; i++) {
    const left = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.18, 0.55), material);
    left.position.set(-1.1, 0.2, i * 5);
    left.rotation.y = 0.55;
    chevrons.add(left);
    const right = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.18, 0.55), material);
    right.position.set(1.1, 0.2, i * 5);
    right.rotation.y = -0.55;
    chevrons.add(right);
  }
  return chevrons;
}

function buildLoopBackdrop(texture: THREE.Texture): THREE.Group {
  const loop = new THREE.Group();
  const orange = makeToonMaterial("#f97316", "#facc15", 0.18);
  const purple = makeToonMaterial("#7c3aed", "#38bdf8", 0.12);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(17, 1.05, 14, 72), orange);
  rail.rotation.y = Math.PI / 2;
  rail.position.set(0, 18, 0);
  rail.castShadow = true;
  loop.add(rail);

  const inner = new THREE.Mesh(new THREE.TorusGeometry(13.4, 0.45, 10, 72), purple);
  inner.rotation.y = Math.PI / 2;
  inner.position.set(0, 18, 0);
  loop.add(inner);

  const approach = new THREE.Mesh(new THREE.BoxGeometry(9, 1.35, 44), orange);
  approach.position.set(-10, 2.3, 23);
  approach.rotation.x = -0.28;
  approach.castShadow = true;
  loop.add(approach);

  const exit = approach.clone();
  exit.position.set(10, 2.3, 23);
  exit.rotation.x = -0.28;
  loop.add(exit);

  const sign = buildReadablePanel(12, 3, texture);
  sign.position.set(0, 35.2, -0.9);
  loop.add(sign);

  return loop;
}

function buildCrowdStand(texture: THREE.Texture): THREE.Group {
  const stand = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(22, 5.8, 8), makeToonMaterial("#2563eb"));
  base.position.y = 2.9;
  base.castShadow = true;
  stand.add(base);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(25, 1.1, 9.5), makeToonMaterial("#facc15", "#facc15", 0.08));
  roof.position.y = 8.2;
  roof.castShadow = true;
  stand.add(roof);

  const crowd = buildReadablePanel(19, 4, texture);
  crowd.position.set(0, 5.2, -4.1);
  stand.add(crowd);

  return stand;
}

function buildCurvedSideRoad(color: string, accent: string): THREE.Group {
  const road = new THREE.Group();
  const material = makeToonMaterial(color);
  const accentMaterial = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.9 });
  for (let i = 0; i < 13; i++) {
    const z = -30 + i * 5;
    const x = Math.sin(i * 0.55) * 8;
    const segment = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.16, 5.8), material);
    segment.position.set(x, 0.08, z);
    segment.rotation.y = Math.sin(i * 0.55) * 0.35;
    segment.receiveShadow = true;
    road.add(segment);

    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 4.2), accentMaterial);
    stripe.rotation.x = -Math.PI / 2;
    stripe.rotation.z = segment.rotation.y;
    stripe.position.set(x, 0.18, z);
    road.add(stripe);
  }
  return road;
}

function addAmusementTrackDressing(group: THREE.Group, adTextures: THREE.Texture[], halfWidth: number, density: number): void {
  const trackLength = TEST_OVAL_TRACK.trackLength;
  const loopPlacements = [
    { progress: 135, side: -1 as const, offset: halfWidth + 33, scale: 1.15 },
    { progress: trackLength * 0.47, side: 1 as const, offset: halfWidth + 35, scale: 1.0 }
  ];
  for (const [index, item] of loopPlacements.entries()) {
    const { position, angle } = tracksidePosition(item.progress, item.side, item.offset);
    const loop = buildLoopBackdrop(adTextures[(index + 1) % adTextures.length]!);
    loop.position.copy(position);
    loop.rotation.y = -angle + (item.side === 1 ? Math.PI : 0);
    loop.scale.setScalar(item.scale);
    group.add(loop);
  }

  const sideRoadCount = Math.max(8, Math.round(12 * density));
  for (let i = 0; i < sideRoadCount; i++) {
    const progress = 60 + (i / sideRoadCount) * (trackLength - 120);
    const side = i % 2 === 0 ? -1 : 1;
    const { position, angle } = tracksidePosition(progress, side, halfWidth + 16 + (i % 2) * 5);
    const road = buildCurvedSideRoad(i % 2 === 0 ? "#e879f9" : "#f97316", i % 3 === 0 ? "#facc15" : "#38bdf8");
    road.position.copy(position);
    road.rotation.y = -angle + (side === 1 ? Math.PI : 0) + (i % 2 === 0 ? 0.35 : -0.35);
    road.scale.setScalar(0.72 + (i % 3) * 0.08);
    group.add(road);
  }

  const crowdTexture = createFunPosterTexture("FANS", "#2563eb", "#fb7185");
  for (let i = 0; i < 10; i++) {
    const progress = 42 + (i / 10) * (trackLength - 84);
    const side = i % 2 === 0 ? 1 : -1;
    const { position, angle } = tracksidePosition(progress, side, halfWidth + 27 + (i % 3) * 3);
    const stand = buildCrowdStand(crowdTexture);
    stand.position.copy(position);
    stand.rotation.y = -angle + (side === 1 ? Math.PI : 0);
    stand.scale.setScalar(0.8 + (i % 3) * 0.08);
    group.add(stand);
  }

  for (let i = 0; i < 22; i++) {
    const progress = 28 + (i / 22) * (trackLength - 56);
    const side = i % 2 === 0 ? -1 : 1;
    const { position, angle } = tracksidePosition(progress, side, halfWidth + 13 + (i % 4) * 3);
    const palm = buildPalmTree();
    palm.position.copy(position);
    palm.rotation.y = -angle + (i % 5) * 0.3;
    palm.scale.setScalar(0.82 + (i % 4) * 0.08);
    group.add(palm);
  }
}

function addCourseLandmarks(group: THREE.Group, adTextures: THREE.Texture[], halfWidth: number): void {
  const landmarks = [
    { progress: 74, object: buildSeoulSkyBridge(createAdTexture("SEOUL SKY BRIDGE", "UPHILL CITY RALLY", "#2563eb", "#fb7185")), scale: 1.2 },
    { progress: 126, object: buildNeonTunnel(createAdTexture("NEON TUNNEL", "DOWNTOWN BOOST", "#7c3aed", "#38bdf8")), scale: 1.08 },
    { progress: TEST_OVAL_TRACK.trackLength * 0.38, object: buildNeonTunnel(createAdTexture("CITY TUBE", "FAST CORNER", "#db2777", "#facc15")), scale: 0.96 },
    { progress: TEST_OVAL_TRACK.trackLength * 0.62, object: buildSeoulSkyBridge(createAdTexture("HANGANG BRIDGE", "DOWNHILL RUN", "#f97316", "#facc15")), scale: 1.05 }
  ] as const;

  for (const item of landmarks) {
    const center = centerlinePoint(TEST_OVAL_TRACK, item.progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, item.progress);
    item.object.position.set(center.x, center.y ?? 0, center.z);
    item.object.rotation.y = -angle;
    item.object.scale.setScalar(item.scale);
    group.add(item.object);
  }

  for (const item of [
    { progress: 152, side: -1 as const, color: "#facc15" },
    { progress: 210, side: 1 as const, color: "#38bdf8" },
    { progress: 455, side: -1 as const, color: "#fb7185" },
    { progress: TEST_OVAL_TRACK.trackLength * 0.74, side: 1 as const, color: "#22c55e" }
  ]) {
    const { position, angle } = tracksidePosition(item.progress, item.side, halfWidth + 3.1);
    const chevron = buildHillChevron(item.color);
    chevron.position.copy(position);
    chevron.rotation.y = -angle + (item.side === 1 ? Math.PI : 0);
    chevron.scale.setScalar(1.18);
    group.add(chevron);
  }

  void adTextures;
}

function addStartCheckerPlaza(group: THREE.Group, progress: number, halfWidth: number): void {
  const frame = new THREE.Group();
  const stone = new THREE.MeshBasicMaterial({ color: "#d8d4c8", transparent: true, opacity: 0.96 });
  const cream = new THREE.MeshBasicMaterial({ color: "#f5eddc", transparent: true, opacity: 0.98 });
  const tileW = 3.2;
  const tileD = 2.2;
  const cols = 10;
  const rows = 6;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tile = new THREE.Mesh(new THREE.PlaneGeometry(tileW, tileD), (row + col) % 2 === 0 ? stone : cream);
      tile.rotation.x = -Math.PI / 2;
      tile.position.set((col - (cols - 1) / 2) * tileW, 0.08, (row - 2.8) * tileD);
      frame.add(tile);
    }
  }

  for (const side of [-1, 1] as const) {
    const barrier = buildKartBarrier(32, side === 1 ? "#2563eb" : "#facc15");
    barrier.position.set(side * (halfWidth + 2.4), 0, -2.5);
    barrier.rotation.y = Math.PI / 2;
    frame.add(barrier);
  }

  const plazaFeatures = [
    { object: buildGiantVideoWall(createAdTexture("SEOUL RUN", "CITY KART NIGHT", "#2563eb", "#fb7185")), x: -halfWidth - 8.2, z: -3.2, scale: 0.78, yaw: Math.PI * 0.08 },
    { object: buildLargeBus("#facc15"), x: halfWidth + 7.3, z: -4.7, scale: 0.94, yaw: -Math.PI * 0.5 },
    { object: buildMascotStatue("#f97316"), x: -halfWidth - 5.8, z: 6.5, scale: 1.35, yaw: Math.PI * 0.12 },
    { object: buildCafePatio(), x: halfWidth + 5.8, z: 5.3, scale: 1.45, yaw: -Math.PI * 0.1 },
    { object: buildSubwayEntrance(), x: -halfWidth - 8.6, z: 12.5, scale: 1.12, yaw: Math.PI * 0.1 },
    { object: buildBusStop(createLabelTexture("KART BUS", "#7c3aed")), x: halfWidth + 7.8, z: 12.2, scale: 1.2, yaw: -Math.PI * 0.08 },
    { object: buildFoodTruck(), x: -halfWidth - 6.4, z: -12.8, scale: 1.05, yaw: Math.PI * 0.12 },
    { object: buildFountain(), x: halfWidth + 5.6, z: -12.1, scale: 1.35, yaw: -Math.PI * 0.08 },
    { object: buildMarketStall("#fb7185"), x: -halfWidth - 5.2, z: 18.4, scale: 1.32, yaw: Math.PI * 0.04 },
    { object: buildBalloonCluster(), x: halfWidth + 4.8, z: 18.1, scale: 1.45, yaw: -Math.PI * 0.05 },
    { object: buildFunPlazaCluster(0, createAdTexture("STAGE", "SEOUL BEAT", "#db2777", "#facc15")), x: -halfWidth - 8.5, z: -23.2, scale: 1.12, yaw: Math.PI * 0.08 },
    { object: buildFunPlazaCluster(1, createAdTexture("PHOTO", "KART CREW", "#7c3aed", "#38bdf8")), x: halfWidth + 8.2, z: -22.5, scale: 1.08, yaw: -Math.PI * 0.08 },
    { object: buildFunPlazaCluster(2, createAdTexture("SNACK", "BUBBLE POP", "#f97316", "#fb7185")), x: -halfWidth - 8.1, z: 26.2, scale: 1.06, yaw: Math.PI * 0.03 },
    { object: buildFunPlazaCluster(3, createAdTexture("ARCADE", "WIN PRIZES", "#2563eb", "#22c55e")), x: halfWidth + 8.4, z: 26.6, scale: 1.06, yaw: -Math.PI * 0.05 }
  ];
  for (const item of plazaFeatures) {
    item.object.position.set(item.x, 0, item.z);
    item.object.scale.setScalar(item.scale);
    item.object.rotation.y = item.yaw;
    frame.add(item.object);
  }

  const leftSwoop = buildCurvedSideRoad("#f97316", "#facc15");
  leftSwoop.position.set(-halfWidth - 16.2, 0.12, 0.5);
  leftSwoop.rotation.y = Math.PI * 0.24;
  leftSwoop.scale.set(1.05, 1, 0.82);
  frame.add(leftSwoop);

  const rightSwoop = buildCurvedSideRoad("#7c3aed", "#fb7185");
  rightSwoop.position.set(halfWidth + 15.4, 0.12, 2.2);
  rightSwoop.rotation.y = -Math.PI * 0.22;
  rightSwoop.scale.set(0.95, 1, 0.78);
  frame.add(rightSwoop);

  for (const side of [-1, 1] as const) {
    const palmA = buildPalmTree();
    palmA.position.set(side * (halfWidth + 12.2), 0, -18.5);
    palmA.scale.setScalar(0.9);
    frame.add(palmA);

    const palmB = buildPalmTree();
    palmB.position.set(side * (halfWidth + 17.8), 0, 16.5);
    palmB.scale.setScalar(0.78);
    palmB.rotation.y = side * 0.4;
    frame.add(palmB);
  }

  for (let i = 0; i < 10; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = -15 + Math.floor(i / 2) * 7.2;
    const extra =
      i % 5 === 0
        ? buildVendingKiosk(createLabelTexture("BOOST", "#f97316"))
        : i % 5 === 1
          ? buildPhotoBooth("#db2777")
          : i % 5 === 2
            ? buildPlanter("#38bdf8")
            : i % 5 === 3
              ? buildBalloonCluster()
              : buildMascotStatue("#f97316");
    extra.position.set(side * (halfWidth + 4.25 + (i % 3) * 0.85), 0, z);
    extra.scale.setScalar(i % 5 === 3 ? 0.82 : i % 5 === 4 ? 0.72 : 0.9);
    extra.rotation.y = side === 1 ? Math.PI : 0;
    frame.add(extra);
  }

  const edgeLabels = [
    ["K-DRIFT", "#db2777"],
    ["CAFE", "#f97316"],
    ["MART", "#16a34a"],
    ["ARCADE", "#7c3aed"]
  ] as const;
  for (let i = 0; i < 8; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const label = edgeLabels[i % edgeLabels.length]!;
    const sign = buildReadablePanel(3.8, 2.2, createLabelTexture(label[0], label[1]));
    sign.position.set(side * (halfWidth + 3.4), 4.6 + (i % 2) * 0.8, -10 + Math.floor(i / 2) * 7);
    sign.rotation.y = side === 1 ? Math.PI : 0;
    frame.add(sign);

    const balloonMaterial = new THREE.MeshBasicMaterial({ color: ["#facc15", "#fb7185", "#38bdf8", "#22c55e"][i % 4]!, toneMapped: false });
    for (let b = 0; b < 3; b++) {
      const balloon = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 8), balloonMaterial);
      balloon.position.set(side * (halfWidth + 3.2 + b * 0.42), 6.2 + b * 0.35, -9.4 + Math.floor(i / 2) * 7);
      frame.add(balloon);
    }
  }

  const posterColors = [
    ["DRIFT", "#2563eb", "#fb7185"],
    ["BOOST", "#f97316", "#facc15"],
    ["SEOUL", "#7c3aed", "#38bdf8"],
    ["KART", "#16a34a", "#facc15"]
  ] as const;
  for (let i = 0; i < 6; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const [title, color, accent] = posterColors[i % posterColors.length]!;
    const poster = buildRoadsidePoster(title, color, accent);
    poster.position.set(side * (halfWidth + 2.15), 0, -5 + Math.floor(i / 2) * 8);
    poster.rotation.y = side === 1 ? Math.PI : 0;
    poster.scale.setScalar(1.08);
    frame.add(poster);
  }

  const center = centerlinePoint(TEST_OVAL_TRACK, progress);
  const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
  frame.position.set(center.x, 0, center.z);
  frame.rotation.y = -angle;
  group.add(frame);
}

function addStartVillage(group: THREE.Group, adTextures: THREE.Texture[], halfWidth: number): void {
  addStartCheckerPlaza(group, TEST_OVAL_TRACK.trackLength - 3, halfWidth);

  const gateFrame = new THREE.Group();
  gateFrame.add(buildStartGate(createAdTexture("SEOUL SKY BRIDGE", "CITY TUNNEL RUN", "#2563eb", "#fb7185")));
  const gateCenter = centerlinePoint(TEST_OVAL_TRACK, 18);
  const gateAngle = centerlineTangentAngle(TEST_OVAL_TRACK, 18);
  gateFrame.position.set(gateCenter.x, 0, gateCenter.z);
  gateFrame.rotation.y = -gateAngle;
  group.add(gateFrame);

  const storeColors = [
    ["#f8d66d", "#ef4444"],
    ["#93c5fd", "#2563eb"],
    ["#fbcfe8", "#db2777"],
    ["#bbf7d0", "#16a34a"],
    ["#fde68a", "#f97316"],
    ["#c4b5fd", "#7c3aed"]
  ] as const;

  for (let i = 0; i < 12; i++) {
    const progress = -18 + i * 7;
    const side = i % 2 === 0 ? -1 : 1;
    const frame = new THREE.Group();
    const [body, roof] = storeColors[i % storeColors.length]!;
    const store = buildStartStorefront(10.5 + (i % 3) * 1.9, 10.5 + (i % 2) * 2.4, body, roof, adTextures[i % adTextures.length]!);
    store.position.x = side * (halfWidth + 10.2 + (i % 2) * 1.6);
    store.rotation.y = side === 1 ? Math.PI : 0;
    frame.add(store);

    if (i % 3 === 0) {
      const vehicle = buildParkedVehicle("#facc15", "#bae6fd");
      vehicle.scale.setScalar(0.86);
      vehicle.position.set(side * (halfWidth + 6.8), 0, 1.2);
      vehicle.rotation.y = side === 1 ? -Math.PI / 2 : Math.PI / 2;
      frame.add(vehicle);
    }

    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    frame.position.set(center.x, 0, center.z);
    frame.rotation.y = -angle;
    group.add(frame);
  }

  const featurePlacements = [
    { progress: -10, side: -1, offset: halfWidth + 7.2, kind: 0, scale: 1.08 },
    { progress: -4, side: 1, offset: halfWidth + 7.2, kind: 1, scale: 1.02 },
    { progress: 8, side: -1, offset: halfWidth + 5.4, kind: 2, scale: 1.25 },
    { progress: 14, side: 1, offset: halfWidth + 4.9, kind: 3, scale: 1.45 },
    { progress: 28, side: -1, offset: halfWidth + 4.7, kind: 4, scale: 1.35 },
    { progress: 32, side: 1, offset: halfWidth + 5.2, kind: 5, scale: 1.32 }
  ] as const;

  for (const [index, item] of featurePlacements.entries()) {
    const side = item.side as -1 | 1;
    const { position, angle } = tracksidePosition(item.progress, side, item.offset);
    const feature =
      item.kind === 0
        ? buildGiantVideoWall(adTextures[0]!)
        : item.kind === 1
          ? buildFeatureMall(adTextures[1]!)
          : item.kind === 2
            ? buildSeoulTowerIcon()
            : item.kind === 3
              ? buildMascotStatue("#f97316")
              : item.kind === 4
                ? buildLargeBus("#2563eb")
                : buildCafePatio();
    feature.scale.setScalar(item.scale);
    feature.position.copy(position);
    feature.rotation.y = -angle + (side === 1 ? Math.PI : 0) + (index % 2 === 0 ? 0.08 : -0.08);
    group.add(feature);
  }
}

function addUrbanGround(group: THREE.Group, halfWidth: number, density: number): void {
  const concrete = makeToonMaterial("#d7d2c6");
  const warmConcrete = makeToonMaterial("#e8d7b4");
  const parkGround = makeToonMaterial("#b9d89a");
  const curbPink = new THREE.MeshBasicMaterial({ color: "#fb7185", transparent: true, opacity: 0.78 });
  const curbYellow = new THREE.MeshBasicMaterial({ color: "#facc15", transparent: true, opacity: 0.82 });
  const trackLength = TEST_OVAL_TRACK.trackLength;
  const segmentCount = Math.max(34, Math.round(52 * density));

  for (let i = 0; i < segmentCount; i++) {
    const progress = (i / segmentCount) * trackLength;
    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    const patch = new THREE.Group();
    for (const side of [-1, 1] as const) {
      const plaza = new THREE.Mesh(
        new THREE.BoxGeometry(23, 0.08, 18),
        (i + side) % 5 === 0 ? warmConcrete : concrete
      );
      plaza.position.set(side * (halfWidth + 19), 0.025, 0);
      plaza.receiveShadow = true;
      patch.add(plaza);

      if (i % 3 === 0) {
        const park = new THREE.Mesh(new THREE.BoxGeometry(22, 0.07, 15), parkGround);
        park.position.set(side * (halfWidth + 43), 0.015, 1.5);
        park.receiveShadow = true;
        patch.add(park);
      }

      const curb = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 22), side === 1 ? curbPink : curbYellow);
      curb.rotation.x = -Math.PI / 2;
      curb.position.set(side * (halfWidth + 1.65), 0.095, 0);
      patch.add(curb);

      for (let lane = 0; lane < 3; lane++) {
        const seam = new THREE.Mesh(
          new THREE.PlaneGeometry(0.08, 15),
          new THREE.MeshBasicMaterial({ color: "#f8fafc", transparent: true, opacity: 0.45 })
        );
        seam.rotation.x = -Math.PI / 2;
        seam.position.set(side * (halfWidth + 7 + lane * 3.6), 0.105, 0);
        patch.add(seam);
      }
    }
    patch.position.set(center.x, center.y ?? 0, center.z);
    patch.rotation.y = -angle;
    group.add(patch);
  }
}

function addNeonBladeSign(building: THREE.Group, x: number, y: number, z: number, color: string): void {
  const sign = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 5.8, 0.18),
    new THREE.MeshBasicMaterial({ color, toneMapped: false })
  );
  sign.position.set(x, y, z);
  building.add(sign);

  const cap = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.32, 0.2), new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }));
  cap.position.set(x, y + 2.9, z - 0.02);
  building.add(cap);
}

function addSeoulBoulevard(group: THREE.Group, adTextures: THREE.Texture[], halfWidth: number, density: number): void {
  const trackLength = TEST_OVAL_TRACK.trackLength;
  const facadeColors = ["#174ea6", "#5b21b6", "#0f766e", "#be123c", "#c2410c", "#334155", "#155e75"];
  const roofColors = ["#facc15", "#fb7185", "#a78bfa", "#22c55e", "#f97316"];
  const blockCount = Math.max(48, Math.round(76 * density));

  for (let i = 0; i < blockCount; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const progress = (i / blockCount) * trackLength + 54;
    if ((progress > trackLength - 42 && progress < trackLength + 18) || (progress > -18 && progress < 46)) continue;

    const closeOffset = halfWidth + 7.6 + (i % 2) * 2.2;
    const farOffset = halfWidth + 20 + (i % 3) * 4.4;
    const { position, angle } = tracksidePosition(progress, side, closeOffset);
    const street = new THREE.Group();
    const isTower = i % 3 === 0;
    const width = isTower ? 15 + (i % 3) * 3.5 : 15 + (i % 3) * 3;
    const height = isTower ? 48 + ((i * 7) % 36) : 20 + (i % 3) * 5;
    const depth = isTower ? 12 : 10;

    const building = buildCityBuilding(
      width,
      height,
      depth,
      facadeColors[i % facadeColors.length]!,
      adTextures[(i + 1) % adTextures.length]!,
      width * 0.78,
      isTower ? 4.4 : 2.5,
      i
    );
    addNeonBladeSign(building, -width * 0.42, height * 0.58, -depth / 2 - 0.22, roofColors[i % roofColors.length]!);
    addNeonBladeSign(building, width * 0.42, height * 0.46, -depth / 2 - 0.22, "#38bdf8");
    street.add(building);

    if (!isTower) {
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(width * 1.02, 0.45, 1.7), makeToonMaterial(roofColors[i % roofColors.length]!));
      canopy.position.set(0, 5.15, -depth / 2 - 0.65);
      canopy.castShadow = true;
      street.add(canopy);
    }

    street.position.copy(position);
    street.rotation.y = -angle + (side === 1 ? Math.PI : 0);
    group.add(street);

    if (i % 2 === 0) {
      const propFrame = new THREE.Group();
      const propPos = tracksidePosition(progress + 2.2, side, halfWidth + 3.6);
      const prop = buildStreetProp(i, adTextures[i % adTextures.length]!);
      prop.scale.setScalar(i % 6 === 4 ? 1.05 : 1.35);
      prop.position.set(0, 0, 0);
      propFrame.add(prop);
      propFrame.position.copy(propPos.position);
      propFrame.rotation.y = -propPos.angle + (side === 1 ? Math.PI : 0);
      group.add(propFrame);
    }

    if (i % 3 === 0) {
      const skyline = new THREE.Group();
      const skyPos = tracksidePosition(progress + 4.5, side, farOffset);
      const towerWidth = 12 + (i % 4) * 2.4;
      const towerHeight = 70 + ((i * 11) % 52);
      const tower = new THREE.Mesh(
        new THREE.BoxGeometry(towerWidth, towerHeight, towerWidth * 0.78),
        makeToonMaterial(facadeColors[(i + 3) % facadeColors.length]!, "#60a5fa", 0.02)
      );
      tower.position.y = towerHeight / 2;
      tower.castShadow = true;
      tower.receiveShadow = true;
      skyline.add(tower);

      const sign = buildReadablePanel(towerWidth * 0.82, 3.1, adTextures[(i + 2) % adTextures.length]!);
      sign.position.set(0, towerHeight * 0.58, -towerWidth * 0.4 - 0.08);
      skyline.add(sign);

      skyline.position.copy(skyPos.position);
      skyline.rotation.y = -skyPos.angle + (side === 1 ? Math.PI : 0);
      group.add(skyline);
    }
  }

  const funCount = Math.max(24, Math.round(38 * density));
  for (let i = 0; i < funCount; i++) {
    const progress = (i / funCount) * trackLength + 26;
    const side = i % 2 === 0 ? -1 : 1;
    const { position, angle } = tracksidePosition(progress, side, halfWidth + 4.6 + (i % 3) * 1.3);
    const prop =
      i % 4 === 0
        ? buildFunPlazaCluster(i, adTextures[(i + 2) % adTextures.length]!)
        : buildStreetProp(i + 3, adTextures[(i + 2) % adTextures.length]!);
    prop.scale.setScalar(i % 4 === 0 ? 0.9 : 1.15 + (i % 3) * 0.12);
    prop.position.copy(position);
    prop.rotation.y = -angle + (side === 1 ? Math.PI : 0);
    group.add(prop);
  }

  const fillerCount = Math.max(46, Math.round(70 * density));
  const plazaColors = [
    ["#fbcfe8", "#db2777"],
    ["#bbf7d0", "#16a34a"],
    ["#fed7aa", "#f97316"],
    ["#bfdbfe", "#2563eb"],
    ["#ddd6fe", "#7c3aed"]
  ] as const;
  for (let i = 0; i < fillerCount; i++) {
    const progress = (i / fillerCount) * trackLength + 12;
    const side = i % 2 === 0 ? -1 : 1;
    const { position, angle } = tracksidePosition(progress, side, halfWidth + 7.2 + (i % 4) * 2.7);
    const [color, accent] = plazaColors[i % plazaColors.length]!;
    const filler =
      i % 5 === 0
        ? buildFunPlazaCluster(i + 5, adTextures[(i + 1) % adTextures.length]!)
        : i % 3 === 0
          ? buildPaintedPlaza(color, accent)
          : buildStreetProp(i + 6, adTextures[(i + 1) % adTextures.length]!);
    filler.scale.setScalar(i % 5 === 0 ? 0.82 : i % 3 === 0 ? 1.2 : 1.28);
    filler.position.copy(position);
    filler.rotation.y = -angle + (side === 1 ? Math.PI : 0) + (i % 2 === 0 ? 0.12 : -0.12);
    group.add(filler);
  }

  const landmarkCount = Math.max(12, Math.round(17 * density));
  for (let i = 0; i < landmarkCount; i++) {
    const progress = 44 + (i / landmarkCount) * (trackLength - 75);
    const side = i % 2 === 0 ? 1 : -1;
    const { position, angle } = tracksidePosition(progress, side, halfWidth + 9.8 + (i % 2) * 2.8);
    const landmark = buildLandmark(i, adTextures[(i + 3) % adTextures.length]!);
    landmark.scale.setScalar(i % 4 === 2 ? 1.25 : 1);
    landmark.position.copy(position);
    landmark.rotation.y = -angle + (side === 1 ? Math.PI : 0);
    group.add(landmark);
  }

  const posterCount = Math.max(26, Math.round(38 * density));
  const posterPalette = [
    ["DRIFT", "#2563eb", "#fb7185"],
    ["BOOST", "#f97316", "#facc15"],
    ["SEOUL", "#7c3aed", "#38bdf8"],
    ["CAFE", "#16a34a", "#facc15"],
    ["ARCADE", "#db2777", "#a78bfa"]
  ] as const;
  for (let i = 0; i < posterCount; i++) {
    const progress = (i / posterCount) * trackLength + 18;
    const side = i % 2 === 0 ? 1 : -1;
    const { position, angle } = tracksidePosition(progress, side, halfWidth + 2.8);
    const [title, color, accent] = posterPalette[i % posterPalette.length]!;
    const poster = buildRoadsidePoster(title, color, accent);
    poster.scale.setScalar(0.95 + (i % 3) * 0.08);
    poster.position.copy(position);
    poster.rotation.y = -angle + (side === 1 ? Math.PI : 0);
    group.add(poster);
  }
}

function addCrosswalk(group: THREE.Group, progress: number): void {
  const center = centerlinePoint(TEST_OVAL_TRACK, progress);
  const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
  const stripeMaterial = new THREE.MeshBasicMaterial({ color: "#f8fafc", transparent: true, opacity: 0.92 });
  for (let i = -3; i <= 3; i++) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(2.3, TEST_OVAL_TRACK.trackHalfWidth * 1.6), stripeMaterial);
    stripe.rotation.x = -Math.PI / 2;
    stripe.rotation.z = -angle + Math.PI / 2;
    stripe.position.set(center.x + Math.cos(angle) * i * 3.2, (center.y ?? 0) + 0.035, center.z + Math.sin(angle) * i * 3.2);
    group.add(stripe);
  }
}

/**
 * Kart-style city dressing: bold buildings, glowing billboards, crosswalks,
 * cones, traffic lights, and parked cartoon vehicles placed around the lap.
 */
export function buildStadiumProps(library: RacingAssetLibrary | null, density: number): THREE.Group {
  const group = new THREE.Group();
  group.name = "pocket-city-kart-props";
  const halfWidth = TEST_OVAL_TRACK.trackHalfWidth;
  const trackLength = TEST_OVAL_TRACK.trackLength;

  void library;

  const adTextures = [
    createAdTexture("POCKET CITY", "RALLY FESTIVAL", "#149dff", "#5eead4"),
    createAdTexture("BOOST MART", "NITRO TONIGHT", "#ff9f1c", "#f97316"),
    createAdTexture("BUBBLE CHILL", "SMOOTH DRIFT", "#38bdf8", "#a78bfa"),
    createAdTexture("RALLY LEAGUE", "SATURDAY NIGHT", "#243bff", "#fb7185"),
    createAdTexture("NEON GARAGE", "KART SERVICE", "#22c55e", "#facc15")
  ];

  addUrbanGround(group, halfWidth, density);
  addStartVillage(group, adTextures, halfWidth);
  addCourseLandmarks(group, adTextures, halfWidth);
  addAmusementTrackDressing(group, adTextures, halfWidth, density);
  addSeoulBoulevard(group, adTextures, halfWidth, density);

  const buildingColors = ["#1d4ed8", "#0f766e", "#7c3aed", "#e11d48", "#f97316", "#0891b2"];
  const buildingCount = Math.max(16, Math.round(24 * density));
  for (let i = 0; i < buildingCount; i++) {
    const progress = 95 + (i / buildingCount) * Math.max(1, trackLength - 190);
    const side = i % 2 === 0 ? 1 : -1;
    const width = 13 + (i % 3) * 4;
    const height = 26 + (i % 5) * 7;
    const depth = 8 + (i % 2) * 3;
    const { position, angle } = tracksidePosition(progress, side, halfWidth + 38 + (i % 3) * 7);
    const building = buildCityBuilding(
      width,
      height,
      depth,
      buildingColors[i % buildingColors.length]!,
      adTextures[i % adTextures.length]!,
      width * 0.78,
      Math.min(6.2, height * 0.28)
    );
    building.position.copy(position);
    building.rotation.y = -angle + (side === 1 ? Math.PI : 0);
    group.add(building);
  }

  const billboardCount = Math.max(4, Math.round(6 * density));
  for (let i = 0; i < billboardCount; i++) {
    const progress = 120 + (i / billboardCount) * Math.max(1, trackLength - 230);
    const side = i % 2 === 0 ? 1 : -1;
    const { position, angle } = tracksidePosition(progress, side, halfWidth + 24);
    const frame = new THREE.Group();
    const board = buildReadablePanel(13, 6, adTextures[(i + 2) % adTextures.length]!);
    board.position.y = 8.2;
    frame.add(board);
    const back = new THREE.Mesh(new THREE.BoxGeometry(13.8, 6.7, 0.45), makeToonMaterial("#24304f"));
    back.position.set(0, 8.2, 0.25);
    back.castShadow = true;
    frame.add(back);
    for (const x of [-4.8, 4.8]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 8.2, 8), makeToonMaterial("#334155"));
      post.position.set(x, 4.1, 0.45);
      post.castShadow = true;
      frame.add(post);
    }
    frame.position.copy(position);
    frame.rotation.y = -angle + (side === 1 ? Math.PI : 0);
    group.add(frame);
  }

  const lightCount = Math.max(12, Math.round((trackLength / 36) * density));
  for (let i = 0; i < lightCount; i++) {
    const progress = (i / lightCount) * trackLength;
    const side = i % 2 === 0 ? 1 : -1;
    const { position, angle } = tracksidePosition(progress, side, halfWidth + 9.5);
    const light = i % 4 === 0 ? buildTrafficLight() : buildStreetLight(i % 3 === 0 ? "#fef08a" : "#7dd3fc");
    light.position.copy(position);
    light.rotation.y = -angle + (side === 1 ? Math.PI : 0);
    group.add(light);
  }

  const coneCount = Math.max(18, Math.round(30 * density));
  for (let i = 0; i < coneCount; i++) {
    const progress = (i / coneCount) * trackLength + 9;
    const side = i % 2 === 0 ? 1 : -1;
    const { position, angle } = tracksidePosition(progress, side, halfWidth + 1.4);
    const cone = buildCone();
    cone.position.copy(position);
    cone.rotation.y = -angle;
    group.add(cone);
  }

  const vehicleColors = [
    ["#facc15", "#38bdf8"],
    ["#22c55e", "#fef3c7"],
    ["#fb7185", "#93c5fd"],
    ["#60a5fa", "#fde68a"]
  ] as const;
  for (let i = 0; i < 10; i++) {
    const progress = (i / 10) * trackLength + 52;
    const side = i % 2 === 0 ? 1 : -1;
    const { position, angle } = tracksidePosition(progress, side, halfWidth + 20.5);
    const [color, accent] = vehicleColors[i % vehicleColors.length]!;
    const vehicle = buildParkedVehicle(color, accent);
    vehicle.position.copy(position);
    vehicle.rotation.y = -angle + Math.PI / 2 + (side === 1 ? 0 : Math.PI);
    group.add(vehicle);
  }

  for (const progress of [0, trackLength * 0.25, trackLength * 0.5, trackLength * 0.75]) {
    addCrosswalk(group, progress);
  }

  return group;
}
