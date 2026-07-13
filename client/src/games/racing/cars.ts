import * as THREE from "three";

export interface CarVisual {
  root: THREE.Group;
  wheels: THREE.Mesh[];
  frontWheels: THREE.Mesh[];
  brakeLight: THREE.Mesh;
  speedTrail: THREE.Mesh;
  underglow: THREE.Mesh;
  marker: THREE.Mesh;
}

const CARBON = new THREE.MeshStandardMaterial({ color: "#111827", roughness: 0.42, metalness: 0.18 });
const RUBBER = new THREE.MeshStandardMaterial({ color: "#09090b", roughness: 0.64, metalness: 0.04 });
const RIM = new THREE.MeshStandardMaterial({ color: "#c7f9ff", roughness: 0.2, metalness: 0.5, emissive: "#0ea5e9", emissiveIntensity: 0.08 });
const ACCENT = new THREE.MeshPhysicalMaterial({ color: "#fbbf24", roughness: 0.18, metalness: 0.12, clearcoat: 0.6 });
const VISOR = new THREE.MeshBasicMaterial({ color: "#7dd3fc", transparent: true, opacity: 0.82 });
const HELMET = new THREE.MeshStandardMaterial({ color: "#fef3c7", roughness: 0.36, metalness: 0.02 });
const MIRROR = new THREE.MeshStandardMaterial({ color: "#e0f2fe", roughness: 0.22, metalness: 0.55 });
const HEADLIGHT = new THREE.MeshBasicMaterial({ color: "#dffbff", transparent: true, opacity: 0.88 });
const MARKER_MATERIAL = new THREE.MeshBasicMaterial({ color: "#ffffff" });

const TUB_GEOMETRY = new THREE.CylinderGeometry(0.5, 0.66, 3.1, 8, 1);
const NOSE_GEOMETRY = new THREE.ConeGeometry(0.46, 1.7, 8);
const COCKPIT_GEOMETRY = new THREE.CylinderGeometry(0.4, 0.5, 0.62, 8);
const HELMET_GEOMETRY = new THREE.SphereGeometry(0.26, 12, 8);
const VISOR_GEOMETRY = new THREE.SphereGeometry(0.32, 12, 8);
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
const SPEED_TRAIL_GEOMETRY = new THREE.PlaneGeometry(2.2, 7.8);
const UNDERGLOW_GEOMETRY = new THREE.CircleGeometry(1.5, 24);
const SHADOW_GEOMETRY = new THREE.CircleGeometry(1.7, 20);
const MARKER_GEOMETRY = new THREE.ConeGeometry(0.42, 0.88, 3);

const WHEEL_OFFSETS: Array<[number, number]> = [
  [1.18, 1.0],
  [-1.18, 1.0],
  [1.18, -1.15],
  [-1.18, -1.15]
];

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
 * Builds an original open-wheel arcade car. The tub/nose use low radial-segment
 * (faceted) geometry rather than spheres so hard edges survive the non-uniform
 * scaling needed for a low, wide silhouette - a sphere just rounds into a blob
 * under that scale. Wheels sit outside the tub's half-width so they read as
 * exposed open wheels from chase distance instead of hiding inside the body.
 */
export function buildCarMesh(color: string): CarVisual {
  const group = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.2,
    metalness: 0.2,
    clearcoat: 0.85,
    clearcoatRoughness: 0.15
  });

  const tub = new THREE.Mesh(TUB_GEOMETRY, paint);
  tub.rotation.x = Math.PI / 2;
  tub.scale.set(1, 0.56, 1);
  tub.position.set(0, 0.56, 0.15);
  tub.castShadow = true;
  group.add(tub);

  const nose = new THREE.Mesh(NOSE_GEOMETRY, paint);
  nose.rotation.x = -Math.PI / 2;
  nose.scale.set(0.86, 1, 0.62);
  nose.position.set(0, 0.42, -2.05);
  nose.castShadow = true;
  group.add(nose);

  for (const x of [-0.62, 0.62]) {
    const sidepod = new THREE.Mesh(SIDEPOD_GEOMETRY, paint);
    sidepod.rotation.x = Math.PI / 2;
    sidepod.scale.set(1, 1, 0.85);
    sidepod.position.set(x, 0.44, 0.35);
    sidepod.castShadow = true;
    group.add(sidepod);
  }

  for (const z of [-0.85, 1.15]) {
    const line = new THREE.Mesh(CHARACTER_LINE_GEOMETRY, ACCENT);
    line.position.set(0.51, 0.62, z);
    group.add(line);
    const lineOpposite = line.clone();
    lineOpposite.position.x = -0.51;
    group.add(lineOpposite);
  }

  const cockpit = new THREE.Mesh(COCKPIT_GEOMETRY, CARBON);
  cockpit.rotation.x = Math.PI / 2;
  cockpit.position.set(0, 0.92, -0.35);
  cockpit.castShadow = true;
  group.add(cockpit);

  const helmet = new THREE.Mesh(HELMET_GEOMETRY, HELMET);
  helmet.scale.set(0.92, 1, 0.96);
  helmet.position.set(0, 1.14, -0.4);
  group.add(helmet);

  const visor = new THREE.Mesh(VISOR_GEOMETRY, VISOR);
  visor.scale.set(1, 0.4, 0.5);
  visor.position.set(0, 1.16, -0.66);
  group.add(visor);

  const halo = new THREE.Mesh(HALO_GEOMETRY, CARBON);
  halo.rotation.set(Math.PI / 2, 0, Math.PI * 0.82);
  halo.position.set(0, 1.08, -0.28);
  group.add(halo);
  const haloStrut = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.36, 0.06), CARBON);
  haloStrut.position.set(0, 0.92, -0.72);
  group.add(haloStrut);

  for (const x of [-0.72, 0.72]) {
    const mirrorArm = new THREE.Mesh(MIRROR_ARM_GEOMETRY, CARBON);
    mirrorArm.position.set(x, 0.98, -0.7);
    mirrorArm.rotation.y = x > 0 ? -0.28 : 0.28;
    group.add(mirrorArm);
    const mirror = new THREE.Mesh(MIRROR_GEOMETRY, MIRROR);
    mirror.position.set(x * 1.18, 1, -0.78);
    mirror.rotation.y = mirrorArm.rotation.y;
    group.add(mirror);
  }

  const frontWing = new THREE.Mesh(FRONT_WING_GEOMETRY, CARBON);
  frontWing.position.set(0, 0.32, -2.85);
  frontWing.castShadow = true;
  group.add(frontWing);
  const frontWingAccent = new THREE.Mesh(FRONT_WING_ACCENT_GEOMETRY, ACCENT);
  frontWingAccent.position.set(0, 0.42, -3.04);
  group.add(frontWingAccent);
  for (const x of [-1.78, 1.78]) {
    const endplate = new THREE.Mesh(FRONT_ENDPLATE_GEOMETRY, CARBON);
    endplate.position.set(x, 0.38, -2.85);
    group.add(endplate);
  }

  const rearWing = new THREE.Mesh(REAR_WING_GEOMETRY, CARBON);
  rearWing.position.set(0, 1.14, 1.78);
  rearWing.castShadow = true;
  group.add(rearWing);
  const rearWingAccent = new THREE.Mesh(REAR_WING_ACCENT_GEOMETRY, ACCENT);
  rearWingAccent.position.set(0, 1.28, 1.54);
  group.add(rearWingAccent);
  for (const x of [-1.28, 1.28]) {
    const endplate = new THREE.Mesh(REAR_ENDPLATE_GEOMETRY, CARBON);
    endplate.position.set(x, 1.1, 1.78);
    group.add(endplate);
  }
  const rearWingStrut = new THREE.Mesh(REAR_STRUT_GEOMETRY, CARBON);
  rearWingStrut.position.set(0, 0.76, 1.68);
  rearWingStrut.castShadow = true;
  group.add(rearWingStrut);

  for (const x of [-0.32, 0.32]) {
    const headlight = new THREE.Mesh(HEADLIGHT_GEOMETRY, HEADLIGHT);
    headlight.position.set(x, 0.5, -2.88);
    group.add(headlight);
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
    group.add(wheel);
    const rim = new THREE.Mesh(RIM_GEOMETRY, RIM);
    rim.rotation.z = Math.PI / 2;
    rim.position.copy(wheel.position);
    group.add(rim);
    for (let spoke = 0; spoke < 3; spoke++) {
      const spokeMesh = new THREE.Mesh(RIM_SPOKE_GEOMETRY, RIM);
      spokeMesh.rotation.z = Math.PI / 2;
      spokeMesh.rotation.x = (spoke / 3) * Math.PI;
      spokeMesh.position.copy(wheel.position);
      group.add(spokeMesh);
    }
    const groove = new THREE.Mesh(TIRE_GROOVE_GEOMETRY, CARBON);
    groove.rotation.y = Math.PI / 2;
    groove.position.copy(wheel.position);
    group.add(groove);
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
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  underglow.rotation.x = -Math.PI / 2;
  underglow.scale.set(1, 1.8, 1);
  underglow.position.y = 0.06;
  group.add(underglow);

  const shadow = new THREE.Mesh(SHADOW_GEOMETRY, new THREE.MeshBasicMaterial({ color: "#14532d", transparent: true, opacity: 0.18, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(1, 1.55, 1);
  shadow.position.y = 0.045;
  group.add(shadow);

  const marker = new THREE.Mesh(MARKER_GEOMETRY, MARKER_MATERIAL);
  marker.position.set(0, 2.55, 0);
  marker.rotation.x = Math.PI;
  marker.visible = false;
  group.add(marker);

  group.scale.setScalar(1.7);
  return { root: group, wheels, frontWheels, brakeLight, speedTrail, underglow, marker };
}
