import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface CarVisual {
  root: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Object3D[];
  frontWheels: THREE.Object3D[];
  brakeLight: THREE.Mesh;
  speedTrail: THREE.Mesh;
  underglow: THREE.Mesh;
  marker: THREE.Mesh;
  importedRoot?: THREE.Group;
}

const CARBON = new THREE.MeshStandardMaterial({ color: "#111827", roughness: 0.42, metalness: 0.18 });
const RUBBER = new THREE.MeshStandardMaterial({ color: "#09090b", roughness: 0.64, metalness: 0.04 });
const RIM = new THREE.MeshStandardMaterial({ color: "#c7f9ff", roughness: 0.2, metalness: 0.5, emissive: "#0ea5e9", emissiveIntensity: 0.08 });
const ACCENT = new THREE.MeshPhysicalMaterial({ color: "#fbbf24", roughness: 0.18, metalness: 0.12, clearcoat: 0.6 });
const DRIVER_FACE = new THREE.MeshStandardMaterial({ color: "#ffe0b5", roughness: 0.48, metalness: 0.01 });
const DRIVER_HAIR = new THREE.MeshToonMaterial({ color: "#0ea5e9" });
const DRIVER_SHIRT = new THREE.MeshToonMaterial({ color: "#5fbf72" });
const DRIVER_MOUTH = new THREE.MeshBasicMaterial({ color: "#7f1d1d" });
const DRIVER_EYE = new THREE.MeshBasicMaterial({ color: "#0f172a" });
const DRIVER_CHEEK = new THREE.MeshBasicMaterial({ color: "#fb7185", transparent: true, opacity: 0.78 });
const MIRROR = new THREE.MeshStandardMaterial({ color: "#e0f2fe", roughness: 0.22, metalness: 0.55 });
const HEADLIGHT = new THREE.MeshBasicMaterial({ color: "#dffbff", transparent: true, opacity: 0.88 });
const MARKER_MATERIAL = new THREE.MeshBasicMaterial({ color: "#ffffff" });
const KART_TOON_BLACK = new THREE.MeshToonMaterial({ color: "#111827" });
const KART_SEAT = new THREE.MeshToonMaterial({ color: "#1f2937" });
const KART_HIGHLIGHT = new THREE.MeshToonMaterial({ color: "#fff7ed" });

const TUB_GEOMETRY = new THREE.CylinderGeometry(0.5, 0.66, 3.1, 8, 1);
const NOSE_GEOMETRY = new THREE.ConeGeometry(0.46, 1.7, 8);
const COCKPIT_GEOMETRY = new THREE.CylinderGeometry(0.4, 0.5, 0.62, 8);
const HELMET_GEOMETRY = new THREE.SphereGeometry(0.26, 12, 8);
const DRIVER_FACE_GEOMETRY = new THREE.SphereGeometry(0.27, 18, 12);
const DRIVER_HAIR_GEOMETRY = new THREE.SphereGeometry(0.275, 18, 8, 0, Math.PI * 2, 0, Math.PI * 0.52);
const DRIVER_HAIR_SPIKE_GEOMETRY = new THREE.ConeGeometry(0.075, 0.26, 8);
const DRIVER_EAR_GEOMETRY = new THREE.SphereGeometry(0.055, 10, 8);
const DRIVER_MOUTH_GEOMETRY = new THREE.BoxGeometry(0.13, 0.026, 0.018);
const DRIVER_HAND_GEOMETRY = new THREE.SphereGeometry(0.07, 10, 8);
const STEERING_WHEEL_GEOMETRY = new THREE.TorusGeometry(0.24, 0.025, 8, 24);
const DRIVER_EYE_GEOMETRY = new THREE.SphereGeometry(0.035, 8, 6);
const DRIVER_CHEEK_GEOMETRY = new THREE.SphereGeometry(0.045, 8, 6);
const DRIVER_EYE_HIGHLIGHT_GEOMETRY = new THREE.SphereGeometry(0.012, 6, 4);
const DRIVER_HAIR_LOCK_GEOMETRY = new THREE.ConeGeometry(0.045, 0.2, 8);
const HALO_GEOMETRY = new THREE.TorusGeometry(0.44, 0.045, 8, 16, Math.PI * 1.35);
const SIDEPOD_GEOMETRY = new THREE.CylinderGeometry(0.16, 0.24, 1.5, 6);
const FRONT_WING_GEOMETRY = new THREE.BoxGeometry(3.6, 0.1, 0.44);
const FRONT_WING_ACCENT_GEOMETRY = new THREE.BoxGeometry(3.3, 0.045, 0.09);
const FRONT_ENDPLATE_GEOMETRY = new THREE.BoxGeometry(0.08, 0.42, 0.5);
const REAR_WING_GEOMETRY = new THREE.BoxGeometry(2.5, 0.16, 0.46);
const REAR_WING_ACCENT_GEOMETRY = new THREE.BoxGeometry(2.15, 0.05, 0.09);
const REAR_ENDPLATE_GEOMETRY = new THREE.BoxGeometry(0.08, 0.52, 0.5);
const REAR_STRUT_GEOMETRY = new THREE.BoxGeometry(0.16, 0.68, 0.16);
const CHARACTER_LINE_GEOMETRY = new THREE.BoxGeometry(0.05, 0.06, 2.5);
const MIRROR_ARM_GEOMETRY = new THREE.BoxGeometry(0.44, 0.05, 0.05);
const MIRROR_GEOMETRY = new THREE.BoxGeometry(0.17, 0.11, 0.04);
const HEADLIGHT_GEOMETRY = new THREE.BoxGeometry(0.2, 0.07, 0.05);
const WHEEL_GEOMETRY = new THREE.CylinderGeometry(0.44, 0.44, 0.32, 20);
const RIM_GEOMETRY = new THREE.CylinderGeometry(0.24, 0.24, 0.35, 16);
const RIM_SPOKE_GEOMETRY = new THREE.BoxGeometry(0.04, 0.42, 0.04);
const TIRE_GROOVE_GEOMETRY = new THREE.TorusGeometry(0.44, 0.03, 6, 20);
const BRAKE_LIGHT_GEOMETRY = new THREE.BoxGeometry(1.1, 0.12, 0.08);
// Shrunk from 2.2x7.8 (which, after the car root's 1.7 scale, worked out to
// a ~3.7x13.3-unit semi-transparent plane behind every car - large enough,
// especially with several cars bunched at a start grid, to read as big
// stray transparent quads filling much of the frame instead of a subtle
// motion streak).
const SPEED_TRAIL_GEOMETRY = new THREE.PlaneGeometry(1.1, 3.6);
// A thin ring rather than a filled disc - reads as "this is your car"
// without looking like the car is floating over a puddle of light.
const UNDERGLOW_GEOMETRY = new THREE.RingGeometry(0.62, 0.78, 28);
// Shrunk from radius 1.7 (which, combined with the 1x1.55 stretch below and
// the car root's 1.7 scale, worked out to an ~5.8x9-unit ellipse - visibly
// larger than the car's own ~4x3.7-unit footprint, reading as a big flat
// disc floating under the car rather than a grounded contact shadow).
const SHADOW_GEOMETRY = new THREE.CircleGeometry(1.15, 24);
const MARKER_GEOMETRY = new THREE.ConeGeometry(0.34, 0.7, 3);

const WHEEL_OFFSETS: Array<[number, number]> = [
  [1.05, 0.86],
  [-1.05, 0.86],
  [1.05, -0.92],
  [-1.05, -0.92]
];

interface DriverPalette {
  hair: string;
  shirt: string;
  cap: string;
  skin: string;
  cheek: string;
  accent: string;
  style: "spiky-boy" | "ponytail-girl" | "bowling-girl" | "tennis-girl" | "dance-boy";
}

interface Transform {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
}

/** Clones `geometry` and bakes the given local transform into its vertices, so it can be safely merged with other parts into one static mesh. */
function bake(geometry: THREE.BufferGeometry, transform: Transform = {}): THREE.BufferGeometry {
  const geo = geometry.clone();
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...(transform.position ?? [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(transform.rotation ?? [0, 0, 0]))),
    new THREE.Vector3(...(transform.scale ?? [1, 1, 1]))
  );
  geo.applyMatrix4(matrix);
  return geo;
}

/**
 * Every car shares the same relative layout for its non-player-colored,
 * non-animated parts (carbon trim, accent trim, wheel rims/spokes, mirrors,
 * headlights), so those get merged into a handful of static geometries
 * once at module load instead of once per car. Before this, each car
 * contributed ~57 individual draw calls (most of them one box/cylinder
 * each for trim details and wheel rim spokes that never even animate);
 * merging brings that down to ~17 per car without changing what's drawn.
 * The player-colored tub/nose/sidepods still merge per car (they can't
 * share geometry across cars since the paint material differs), and
 * wheels/lights/marker stay separate because those animate per frame.
 */
const CARBON_MERGED_GEOMETRY = mergeGeometries([
  bake(COCKPIT_GEOMETRY, { position: [0, 0.92, -0.35], rotation: [Math.PI / 2, 0, 0] }),
  bake(HALO_GEOMETRY, { position: [0, 1.08, -0.28], rotation: [Math.PI / 2, 0, Math.PI * 0.82] }),
  bake(new THREE.BoxGeometry(0.06, 0.36, 0.06), { position: [0, 0.92, -0.72] }),
  bake(MIRROR_ARM_GEOMETRY, { position: [-0.72, 0.98, -0.7], rotation: [0, 0.28, 0] }),
  bake(MIRROR_ARM_GEOMETRY, { position: [0.72, 0.98, -0.7], rotation: [0, -0.28, 0] }),
  bake(FRONT_WING_GEOMETRY, { position: [0, 0.32, -2.85] }),
  bake(FRONT_ENDPLATE_GEOMETRY, { position: [-1.78, 0.38, -2.85] }),
  bake(FRONT_ENDPLATE_GEOMETRY, { position: [1.78, 0.38, -2.85] }),
  bake(REAR_WING_GEOMETRY, { position: [0, 1.14, 1.78] }),
  bake(REAR_ENDPLATE_GEOMETRY, { position: [-1.28, 1.1, 1.78] }),
  bake(REAR_ENDPLATE_GEOMETRY, { position: [1.28, 1.1, 1.78] }),
  bake(REAR_STRUT_GEOMETRY, { position: [0, 0.76, 1.68] }),
  ...WHEEL_OFFSETS.map(([x, z]) => bake(TIRE_GROOVE_GEOMETRY, { position: [x, 0.44, z], rotation: [0, Math.PI / 2, 0] }))
]);

const ACCENT_MERGED_GEOMETRY = mergeGeometries([
  bake(CHARACTER_LINE_GEOMETRY, { position: [0.51, 0.62, -0.85] }),
  bake(CHARACTER_LINE_GEOMETRY, { position: [-0.51, 0.62, -0.85] }),
  bake(CHARACTER_LINE_GEOMETRY, { position: [0.51, 0.62, 1.15] }),
  bake(CHARACTER_LINE_GEOMETRY, { position: [-0.51, 0.62, 1.15] }),
  bake(FRONT_WING_ACCENT_GEOMETRY, { position: [0, 0.42, -3.04] }),
  bake(REAR_WING_ACCENT_GEOMETRY, { position: [0, 1.28, 1.54] })
]);

const RIM_MERGED_GEOMETRY = mergeGeometries(
  WHEEL_OFFSETS.flatMap(([x, z]) => [
    bake(RIM_GEOMETRY, { position: [x, 0.44, z], rotation: [0, 0, Math.PI / 2] }),
    bake(RIM_SPOKE_GEOMETRY, { position: [x, 0.44, z], rotation: [0, 0, Math.PI / 2] }),
    bake(RIM_SPOKE_GEOMETRY, { position: [x, 0.44, z], rotation: [Math.PI / 3, 0, Math.PI / 2] }),
    bake(RIM_SPOKE_GEOMETRY, { position: [x, 0.44, z], rotation: [(2 * Math.PI) / 3, 0, Math.PI / 2] })
  ])
);

const MIRROR_MERGED_GEOMETRY = mergeGeometries([
  bake(MIRROR_GEOMETRY, { position: [-0.72 * 1.18, 1, -0.78], rotation: [0, 0.28, 0] }),
  bake(MIRROR_GEOMETRY, { position: [0.72 * 1.18, 1, -0.78], rotation: [0, -0.28, 0] })
]);

const HEADLIGHT_MERGED_GEOMETRY = mergeGeometries([
  bake(HEADLIGHT_GEOMETRY, { position: [-0.32, 0.5, -2.88] }),
  bake(HEADLIGHT_GEOMETRY, { position: [0.32, 0.5, -2.88] })
]);

function buildSpeedTrailTexture(color: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(0.18, "rgba(255,255,255,.45)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(22, 0, 20, canvas.height);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/**
 * Soft radial falloff instead of a hard-edged flat disc - a uniform-opacity
 * circle reads as a "fake dark circle" floating under the car regardless of
 * how close its edge sits to the wheels; a feathered center-to-edge fade
 * reads as a grounded contact shadow instead.
 */
function buildContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(8,10,14,0.55)");
  gradient.addColorStop(0.55, "rgba(8,10,14,0.32)");
  gradient.addColorStop(1, "rgba(8,10,14,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}
const CONTACT_SHADOW_TEXTURE = buildContactShadowTexture();

function colorHash(color: string): number {
  let hash = 0;
  for (let i = 0; i < color.length; i++) hash = (hash * 31 + color.charCodeAt(i)) >>> 0;
  return hash;
}

function driverPaletteFor(color: string): DriverPalette {
  const normalized = color.toLowerCase();
  if (normalized === "#facc15") {
    return { hair: "#0ea5e9", shirt: "#5fbf72", cap: "#f8fafc", skin: "#ffd7a8", cheek: "#fb7185", accent: "#ffffff", style: "spiky-boy" };
  }
  if (normalized === "#f97316") {
    return { hair: "#7c2d12", shirt: "#facc15", cap: "#ffffff", skin: "#ffd7a8", cheek: "#fb7185", accent: "#ef4444", style: "ponytail-girl" };
  }
  if (normalized === "#22c55e") {
    return { hair: "#7c2d12", shirt: "#facc15", cap: "#a855f7", skin: "#ffd7a8", cheek: "#fb7185", accent: "#a855f7", style: "bowling-girl" };
  }
  if (normalized === "#a855f7") {
    return { hair: "#fbbf24", shirt: "#fb923c", cap: "#ffffff", skin: "#ffe0b5", cheek: "#fb7185", accent: "#ffffff", style: "tennis-girl" };
  }
  if (normalized === "#38bdf8") {
    return { hair: "#7c2d12", shirt: "#2563eb", cap: "#2563eb", skin: "#e8b786", cheek: "#ec4899", accent: "#ffffff", style: "dance-boy" };
  }

  const palettes: DriverPalette[] = [
    { hair: "#ec4899", shirt: "#7c3aed", cap: "#facc15", skin: "#ffd7a8", cheek: "#fb7185", accent: "#38bdf8", style: "ponytail-girl" },
    { hair: "#111827", shirt: "#38bdf8", cap: "#fb7185", skin: "#f6c69d", cheek: "#f97316", accent: "#fef3c7", style: "dance-boy" },
    { hair: "#22c55e", shirt: "#f97316", cap: "#2563eb", skin: "#f3bf91", cheek: "#fb7185", accent: "#facc15", style: "spiky-boy" },
    { hair: "#a855f7", shirt: "#facc15", cap: "#22c55e", skin: "#ffe0b5", cheek: "#fb7185", accent: "#ffffff", style: "bowling-girl" },
    { hair: "#f97316", shirt: "#2563eb", cap: "#f8fafc", skin: "#e8b786", cheek: "#ec4899", accent: "#22c55e", style: "tennis-girl" }
  ];
  return palettes[colorHash(color) % palettes.length]!;
}

function buildCuteDriver(color: string): THREE.Group {
  const driver = new THREE.Group();
  const palette = driverPaletteFor(color);
  const hero = palette.style === "spiky-boy";
  const faceMaterial = new THREE.MeshStandardMaterial({ color: palette.skin, roughness: 0.5, metalness: 0.01 });
  const hairMaterial = new THREE.MeshToonMaterial({ color: palette.hair });
  const shirtMaterial = new THREE.MeshToonMaterial({ color: palette.shirt });
  const capMaterial = new THREE.MeshToonMaterial({ color: palette.cap });
  const cheekMaterial = new THREE.MeshBasicMaterial({ color: palette.cheek, transparent: true, opacity: 0.78 });
  const sleeveMaterial = shirtMaterial;
  const hairShadowMaterial = new THREE.MeshToonMaterial({ color: hero ? "#0369a1" : palette.hair });
  const eyeHighlightMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false });

  const shirt = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.18, 4, 14), shirtMaterial);
  shirt.scale.set(hero ? 1.06 : 1, hero ? 0.74 : 0.72, 0.86);
  shirt.position.set(0, 1.04, 0.08);
  shirt.castShadow = true;
  driver.add(shirt);

  const chestPanel = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.025), new THREE.MeshBasicMaterial({ color: hero ? "#eafff2" : palette.accent, toneMapped: false }));
  chestPanel.position.set(0, 1.08, -0.2);
  driver.add(chestPanel);

  const face = new THREE.Mesh(DRIVER_FACE_GEOMETRY, faceMaterial);
  face.scale.set(hero ? 1.16 : 1.04, hero ? 1.14 : 1.06, hero ? 1.04 : 0.98);
  face.position.set(0, hero ? 1.51 : 1.48, -0.02);
  face.castShadow = true;
  driver.add(face);

  const hair = new THREE.Mesh(DRIVER_HAIR_GEOMETRY, hairMaterial);
  hair.rotation.x = Math.PI;
  hair.scale.set(hero ? 1.34 : 1.08, hero ? 0.88 : 0.72, hero ? 1.18 : 1.02);
  hair.position.set(0, hero ? 1.62 : 1.57, -0.01);
  driver.add(hair);

  const rearHair = new THREE.Mesh(new THREE.SphereGeometry(0.23, 16, 8), hairShadowMaterial);
  rearHair.scale.set(hero ? 1.05 : 0.82, hero ? 0.72 : 0.58, hero ? 0.48 : 0.42);
  rearHair.position.set(0, hero ? 1.57 : 1.54, 0.19);
  rearHair.castShadow = true;
  driver.add(rearHair);

  const spikeLayout: Array<[number, number, number, number, number, number]> =
    palette.style === "tennis-girl"
      ? [
          [-0.1, 1.78, -0.12, -0.28, -0.48, 0.92],
          [0.08, 1.82, -0.1, 0.24, -0.42, 1.0],
          [0.24, 1.76, 0.04, 0.78, 0.06, 1.2]
        ]
      : palette.style === "dance-boy"
        ? [
            [-0.12, 1.76, -0.08, -0.22, -0.24, 0.8],
            [0.08, 1.74, -0.08, 0.2, -0.2, 0.76],
            [0.21, 1.68, 0.05, 0.52, 0.15, 0.7]
          ]
        : [
            [-0.2, 1.76, -0.16, -0.42, -0.54, hero ? 1.1 : 0.96],
            [0, 1.82, -0.17, 0, -0.66, hero ? 1.22 : 1.08],
            [0.2, 1.76, -0.16, 0.42, -0.54, hero ? 1.1 : 0.96],
            [-0.21, 1.72, 0.02, -0.5, 0.02, hero ? 0.94 : 0.84],
            [0.21, 1.72, 0.02, 0.5, 0.02, hero ? 0.94 : 0.84],
            [-0.1, 1.69, 0.18, -0.28, 0.42, hero ? 0.82 : 0.74],
            [0.1, 1.69, 0.18, 0.28, 0.42, hero ? 0.82 : 0.74]
          ];
  for (const [x, y, z, rz, rx, scale] of spikeLayout) {
    const spike = new THREE.Mesh(DRIVER_HAIR_SPIKE_GEOMETRY, hairMaterial);
    spike.position.set(x, y, z);
    spike.rotation.set(rx, 0, rz);
    spike.scale.setScalar(scale);
    spike.castShadow = true;
    driver.add(spike);
  }

  const rearLockLayout: Array<[number, number, number, number]> = [
    [-0.16, 1.6, 0.21, -0.42],
    [0, 1.62, 0.23, 0],
    [0.16, 1.6, 0.21, 0.42]
  ];
  for (const [x, y, z, rz] of rearLockLayout) {
    const lock = new THREE.Mesh(DRIVER_HAIR_LOCK_GEOMETRY, hairShadowMaterial);
    lock.position.set(x, y, z);
    lock.rotation.set(0.7, 0, rz);
    lock.scale.setScalar(hero ? 0.82 : 0.72);
    lock.castShadow = true;
    driver.add(lock);
  }

  if (!hero) {
    const headband = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.055, 0.1), capMaterial);
    headband.position.set(0, 1.6, -0.29);
    headband.castShadow = true;
    driver.add(headband);
  }

  if (palette.style === "ponytail-girl" || palette.style === "bowling-girl" || palette.style === "tennis-girl") {
    const ponytail = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), hairMaterial);
    ponytail.scale.set(0.9, 1.25, 0.75);
    ponytail.position.set(palette.style === "tennis-girl" ? 0.24 : 0.2, 1.54, 0.23);
    ponytail.castShadow = true;
    driver.add(ponytail);

    const hairTie = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 8, 6),
      new THREE.MeshBasicMaterial({ color: palette.accent, toneMapped: false })
    );
    hairTie.position.set(ponytail.position.x, 1.63, 0.16);
    driver.add(hairTie);
  }

  if (palette.style === "dance-boy") {
    const cap = new THREE.Mesh(HELMET_GEOMETRY, capMaterial);
    cap.scale.set(1.08, 0.34, 0.92);
    cap.position.set(0, 1.64, 0.01);
    cap.castShadow = true;
    driver.add(cap);

    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.055, 0.18), capMaterial);
    brim.position.set(0.08, 1.57, -0.31);
    brim.rotation.x = -0.08;
    brim.rotation.z = -0.18;
    driver.add(brim);
  }

  if (palette.style === "bowling-girl") {
    const wrist = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.045, 0.07),
      new THREE.MeshBasicMaterial({ color: "#a855f7", toneMapped: false })
    );
    wrist.position.set(0.22, 1.11, -0.54);
    wrist.rotation.z = 0.25;
    driver.add(wrist);
  }

  if (palette.style === "tennis-girl") {
    const racket = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.018, 8, 20), new THREE.MeshBasicMaterial({ color: "#f8fafc" }));
    racket.position.set(0.42, 1.22, -0.42);
    racket.rotation.set(0.55, 0.2, -0.5);
    driver.add(racket);

    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.2, 0.035), new THREE.MeshBasicMaterial({ color: "#92400e" }));
    handle.position.set(0.32, 1.1, -0.45);
    handle.rotation.z = -0.55;
    driver.add(handle);
  }

  const hairShine = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.025, 0.035),
    new THREE.MeshBasicMaterial({ color: "#dffbff", transparent: true, opacity: 0.85 })
  );
  hairShine.position.set(-0.1, 1.67, -0.27);
  hairShine.rotation.z = -0.4;
  driver.add(hairShine);

  const rearHairShine = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.026, 0.035),
    new THREE.MeshBasicMaterial({ color: "#dffbff", transparent: true, opacity: hero ? 0.72 : 0.5 })
  );
  rearHairShine.position.set(-0.08, 1.63, 0.33);
  rearHairShine.rotation.z = -0.28;
  driver.add(rearHairShine);

  for (const x of [-0.29, 0.29]) {
    const ear = new THREE.Mesh(DRIVER_EAR_GEOMETRY, faceMaterial);
    ear.scale.set(0.75, 1, 0.62);
    ear.position.set(x, 1.47, -0.02);
    driver.add(ear);

    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), sleeveMaterial);
    shoulder.scale.set(1.05, 0.72, 0.82);
    shoulder.position.set(x * 0.34, 1.12, -0.05);
    shoulder.castShadow = true;
    driver.add(shoulder);
  }

  for (const x of [-0.085, 0.085]) {
    const eye = new THREE.Mesh(DRIVER_EYE_GEOMETRY, DRIVER_EYE);
    eye.scale.set(hero ? 1.15 : 0.9, hero ? 1.6 : 1.35, 0.8);
    eye.position.set(x, 1.5, -0.275);
    driver.add(eye);

    const eyeHighlight = new THREE.Mesh(DRIVER_EYE_HIGHLIGHT_GEOMETRY, eyeHighlightMaterial);
    eyeHighlight.position.set(x - 0.012, 1.515, -0.302);
    driver.add(eyeHighlight);

    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.022, 0.018), DRIVER_EYE);
    brow.position.set(x, 1.58, -0.286);
    brow.rotation.z = x < 0 ? -0.22 : 0.22;
    driver.add(brow);

    const cheek = new THREE.Mesh(DRIVER_CHEEK_GEOMETRY, cheekMaterial);
    cheek.scale.set(1.15, 0.7, 0.65);
    cheek.position.set(x * 2.15, 1.4, -0.265);
    driver.add(cheek);
  }

  const mouth = new THREE.Mesh(DRIVER_MOUTH_GEOMETRY, DRIVER_MOUTH);
  mouth.position.set(0, 1.39, -0.29);
  mouth.rotation.x = 0.08;
  driver.add(mouth);

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), faceMaterial);
  nose.scale.set(0.8, 1, 0.65);
  nose.position.set(0, 1.45, -0.295);
  driver.add(nose);

  const scarf = new THREE.Mesh(
    new THREE.BoxGeometry(0.48, 0.08, 0.16),
    new THREE.MeshPhysicalMaterial({ color: palette.accent, roughness: 0.18, metalness: 0.08, clearcoat: 0.5 })
  );
  scarf.position.set(0, 1.23, -0.17);
  driver.add(scarf);

  const scarfTail = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.05, 0.34),
    new THREE.MeshPhysicalMaterial({ color: palette.accent, roughness: 0.18, metalness: 0.08, clearcoat: 0.5 })
  );
  scarfTail.position.set(hero ? -0.16 : 0.16, 1.2, 0.23);
  scarfTail.rotation.y = hero ? -0.32 : 0.32;
  scarfTail.rotation.z = hero ? -0.12 : 0.12;
  driver.add(scarfTail);

  const collar = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.14), new THREE.MeshBasicMaterial({ color: "#f8fafc" }));
  collar.position.set(0, 1.28, -0.21);
  driver.add(collar);

  return driver;
}

/**
 * Builds an original open-wheel arcade car. The tub/nose use low radial-segment
 * (faceted) geometry rather than spheres so hard edges survive the non-uniform
 * scaling needed for a low, wide silhouette - a sphere just rounds into a blob
 * under that scale. Wheels sit outside the tub's half-width so they read as
 * exposed open wheels from chase distance instead of hiding inside the body.
 */
export function buildCarMesh(color: string): CarVisual {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const isHeroKart = color.toLowerCase() === "#facc15";
  const paint = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.2,
    metalness: 0.2,
    clearcoat: 0.85,
    clearcoatRoughness: 0.15
  });
  const toonPaint = new THREE.MeshToonMaterial({ color });
  const stripeMaterial = new THREE.MeshToonMaterial({ color: isHeroKart ? "#fffaf2" : "#f8fafc" });
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: "#38bdf8",
    roughness: 0.12,
    metalness: 0.05,
    clearcoat: 0.75,
    transparent: true,
    opacity: 0.82
  });
  const rimMaterial = new THREE.MeshStandardMaterial({
    color: isHeroKart ? "#f97316" : color,
    roughness: 0.24,
    metalness: 0.36,
    emissive: isHeroKart ? "#f97316" : color,
    emissiveIntensity: 0.08
  });

  const kartBase = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.58, 1.9), toonPaint);
  kartBase.position.set(0, 0.5, 0.03);
  kartBase.castShadow = true;
  body.add(kartBase);

  const roundedHood = new THREE.Mesh(new THREE.SphereGeometry(0.78, 18, 12), toonPaint);
  roundedHood.scale.set(1.18, 0.36, 0.86);
  roundedHood.position.set(0, 0.78, -0.62);
  roundedHood.castShadow = true;
  body.add(roundedHood);

  const noseCone = new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 12), toonPaint);
  noseCone.scale.set(0.92, 0.26, 1.2);
  noseCone.position.set(0, 0.67, -1.08);
  noseCone.castShadow = true;
  body.add(noseCone);

  const rearPod = new THREE.Mesh(new THREE.SphereGeometry(0.72, 18, 12), toonPaint);
  rearPod.scale.set(1.08, 0.4, 0.72);
  rearPod.position.set(0, 0.74, 0.72);
  rearPod.castShadow = true;
  body.add(rearPod);

  const cockpitSeat = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.42, 0.72), KART_SEAT);
  cockpitSeat.position.set(0, 0.86, 0.38);
  body.add(cockpitSeat);

  const steeringWheel = new THREE.Mesh(STEERING_WHEEL_GEOMETRY, KART_TOON_BLACK);
  steeringWheel.position.set(0, 1.03, -0.48);
  steeringWheel.rotation.x = Math.PI * 0.34;
  steeringWheel.castShadow = true;
  body.add(steeringWheel);

  const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.08, 0.28), glassMaterial);
  windshield.position.set(0, 1.1, -0.82);
  windshield.rotation.x = -0.22;
  windshield.castShadow = true;
  body.add(windshield);

  const noseStripe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.078, 1.55), stripeMaterial);
  noseStripe.position.set(0, 1.035, -0.55);
  body.add(noseStripe);

  for (const x of [-0.22, 0.22]) {
    const thinStripe = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.08, 1.22), stripeMaterial);
    thinStripe.position.set(x, 1.04, -0.58);
    body.add(thinStripe);
  }

  const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.22, 0.2), KART_TOON_BLACK);
  frontBumper.position.set(0, 0.42, -1.25);
  body.add(frontBumper);

  const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.24, 0.2), KART_TOON_BLACK);
  rearBumper.position.set(0, 0.46, 1.22);
  body.add(rearBumper);

  const rearStripe = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.07, 0.64), stripeMaterial);
  rearStripe.position.set(0, 1.02, 0.72);
  body.add(rearStripe);

  const licensePlate = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.18, 0.035), new THREE.MeshBasicMaterial({ color: "#f8fafc" }));
  licensePlate.position.set(0, 0.68, 1.33);
  body.add(licensePlate);

  for (const x of [-1.2, 1.2]) {
    const sideGuard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 1.4), KART_TOON_BLACK);
    sideGuard.position.set(x, 0.43, 0.08);
    body.add(sideGuard);

    const sidePanel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.38, 0.78), toonPaint);
    sidePanel.position.set(x * 0.93, 0.64, -0.2);
    sidePanel.castShadow = true;
    body.add(sidePanel);

    const sideDecal = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.48), stripeMaterial);
    sideDecal.position.set(x * 0.99, 0.76, -0.2);
    body.add(sideDecal);
  }

  const driver = buildCuteDriver(color);
  if (isHeroKart) {
    driver.scale.setScalar(1.22);
    driver.position.set(0, -0.08, -0.1);
    driver.rotation.y = -0.16;
  }
  body.add(driver);

  const wheels: THREE.Mesh[] = [];
  const frontWheels: THREE.Mesh[] = [];
  for (const [x, z] of WHEEL_OFFSETS) {
    const wheel = new THREE.Mesh(WHEEL_GEOMETRY, RUBBER);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.44, z);
    wheel.castShadow = true;
    wheels.push(wheel);
    if (z < 0) frontWheels.push(wheel);
    body.add(wheel);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.36, 16), rimMaterial);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(x + (x > 0 ? 0.02 : -0.02), 0.44, z);
    hub.castShadow = true;
    body.add(hub);

    const fender = new THREE.Mesh(new THREE.SphereGeometry(0.48, 14, 8), toonPaint);
    fender.scale.set(0.75, 0.26, 0.62);
    fender.position.set(x, 0.78, z);
    fender.castShadow = true;
    body.add(fender);
  }

  for (const x of [-0.48, 0.48]) {
    const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.05), HEADLIGHT);
    headlight.position.set(x, 0.72, -1.52);
    body.add(headlight);

    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.36, 10), CARBON);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.set(x * 0.58, 0.56, 1.45);
    body.add(exhaust);
  }

  const brakeLight = new THREE.Mesh(BRAKE_LIGHT_GEOMETRY, new THREE.MeshBasicMaterial({ color: "#ef4444", transparent: true, opacity: 0.2 }));
  brakeLight.position.set(0, 0.74, 1.72);
  group.add(brakeLight);

  const trailTexture = buildSpeedTrailTexture(color);
  const speedTrail = new THREE.Mesh(
    SPEED_TRAIL_GEOMETRY,
    new THREE.MeshBasicMaterial({
      map: trailTexture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  speedTrail.rotation.x = -Math.PI / 2;
  speedTrail.position.set(0, 0.08, 3.6);
  group.add(speedTrail);

  const underglow = new THREE.Mesh(
    UNDERGLOW_GEOMETRY,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  underglow.rotation.x = -Math.PI / 2;
  underglow.position.y = 0.06;
  group.add(underglow);

  // Soft, neutral-dark contact shadow (was a flat, oversized, oddly
  // green-tinted disc) - the radial falloff texture fades to fully
  // transparent well inside the mesh's own edge, so there's no hard rim
  // reading as a shadow "floating" separate from the car.
  const shadow = new THREE.Mesh(
    SHADOW_GEOMETRY,
    new THREE.MeshBasicMaterial({ map: CONTACT_SHADOW_TEXTURE, transparent: true, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1.05, 1.3, 1);
  shadow.position.y = 0.045;
  group.add(shadow);

  const marker = new THREE.Mesh(MARKER_GEOMETRY, MARKER_MATERIAL);
  marker.position.set(0, 3.25, -0.15);
  marker.rotation.x = Math.PI;
  marker.visible = false;
  group.add(marker);

  group.scale.setScalar(1.85);
  return { root: group, body, wheels, frontWheels, brakeLight, speedTrail, underglow, marker };
}
