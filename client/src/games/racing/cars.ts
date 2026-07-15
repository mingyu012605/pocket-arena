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
const VISOR = new THREE.MeshBasicMaterial({ color: "#7dd3fc", transparent: true, opacity: 0.82 });
const HELMET = new THREE.MeshStandardMaterial({ color: "#fef3c7", roughness: 0.36, metalness: 0.02 });
const DRIVER_EYE = new THREE.MeshBasicMaterial({ color: "#0f172a" });
const DRIVER_CHEEK = new THREE.MeshBasicMaterial({ color: "#fb7185", transparent: true, opacity: 0.78 });
const MIRROR = new THREE.MeshStandardMaterial({ color: "#e0f2fe", roughness: 0.22, metalness: 0.55 });
const HEADLIGHT = new THREE.MeshBasicMaterial({ color: "#dffbff", transparent: true, opacity: 0.88 });
const MARKER_MATERIAL = new THREE.MeshBasicMaterial({ color: "#ffffff" });

const TUB_GEOMETRY = new THREE.CylinderGeometry(0.5, 0.66, 3.1, 8, 1);
const NOSE_GEOMETRY = new THREE.ConeGeometry(0.46, 1.7, 8);
const COCKPIT_GEOMETRY = new THREE.CylinderGeometry(0.4, 0.5, 0.62, 8);
const HELMET_GEOMETRY = new THREE.SphereGeometry(0.26, 12, 8);
const VISOR_GEOMETRY = new THREE.SphereGeometry(0.32, 12, 8);
const DRIVER_EYE_GEOMETRY = new THREE.SphereGeometry(0.035, 8, 6);
const DRIVER_CHEEK_GEOMETRY = new THREE.SphereGeometry(0.045, 8, 6);
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
const MARKER_GEOMETRY = new THREE.ConeGeometry(0.42, 0.88, 3);

const WHEEL_OFFSETS: Array<[number, number]> = [
  [1.18, 1.0],
  [-1.18, 1.0],
  [1.18, -1.15],
  [-1.18, -1.15]
];

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
  const paint = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.2,
    metalness: 0.2,
    clearcoat: 0.85,
    clearcoatRoughness: 0.15
  });

  const paintMergedGeometry = mergeGeometries([
    bake(TUB_GEOMETRY, { position: [0, 0.56, 0.15], rotation: [Math.PI / 2, 0, 0], scale: [1, 0.56, 1] }),
    bake(NOSE_GEOMETRY, { position: [0, 0.42, -2.05], rotation: [-Math.PI / 2, 0, 0], scale: [0.86, 1, 0.62] }),
    bake(SIDEPOD_GEOMETRY, { position: [-0.62, 0.44, 0.35], rotation: [Math.PI / 2, 0, 0], scale: [1, 1, 0.85] }),
    bake(SIDEPOD_GEOMETRY, { position: [0.62, 0.44, 0.35], rotation: [Math.PI / 2, 0, 0], scale: [1, 1, 0.85] })
  ]);
  const paintMesh = new THREE.Mesh(paintMergedGeometry, paint);
  paintMesh.castShadow = true;
  body.add(paintMesh);

  const carbonMesh = new THREE.Mesh(CARBON_MERGED_GEOMETRY, CARBON);
  carbonMesh.castShadow = true;
  body.add(carbonMesh);

  const accentMesh = new THREE.Mesh(ACCENT_MERGED_GEOMETRY, ACCENT);
  body.add(accentMesh);

  const rimMesh = new THREE.Mesh(RIM_MERGED_GEOMETRY, RIM);
  body.add(rimMesh);

  const mirrorMesh = new THREE.Mesh(MIRROR_MERGED_GEOMETRY, MIRROR);
  body.add(mirrorMesh);

  const headlightMesh = new THREE.Mesh(HEADLIGHT_MERGED_GEOMETRY, HEADLIGHT);
  body.add(headlightMesh);

  const helmet = new THREE.Mesh(HELMET_GEOMETRY, HELMET);
  helmet.scale.set(0.92, 1, 0.96);
  helmet.position.set(0, 1.14, -0.4);
  body.add(helmet);

  const visor = new THREE.Mesh(VISOR_GEOMETRY, VISOR);
  visor.scale.set(1, 0.4, 0.5);
  visor.position.set(0, 1.16, -0.66);
  body.add(visor);

  for (const x of [-0.09, 0.09]) {
    const eye = new THREE.Mesh(DRIVER_EYE_GEOMETRY, DRIVER_EYE);
    eye.position.set(x, 1.18, -0.96);
    body.add(eye);

    const cheek = new THREE.Mesh(DRIVER_CHEEK_GEOMETRY, DRIVER_CHEEK);
    cheek.position.set(x * 1.55, 1.1, -0.91);
    body.add(cheek);
  }

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
  marker.position.set(0, 2.55, 0);
  marker.rotation.x = Math.PI;
  marker.visible = false;
  group.add(marker);

  group.scale.setScalar(1.7);
  return { root: group, body, wheels, frontWheels, brakeLight, speedTrail, underglow, marker };
}
