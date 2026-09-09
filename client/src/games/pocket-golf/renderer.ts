import * as THREE from "three";
import type { GameRenderer } from "../gameRenderer";
import type {
  GolfClubPosePayload,
  PocketGolfGameStatePayload,
  PocketGolfPlayerStatePayload,
  PocketGolfShotPayload,
  PublicRoomState
} from "../../../../shared/protocol";
import { clubById } from "../../../../shared/pocketGolf";
import "./pocketGolf.css";

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose();
  });
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function degToRad(value: number): number {
  return (value * Math.PI) / 180;
}

function sampleTrajectory(points: THREE.Vector3[], t: number): THREE.Vector3 {
  if (points.length === 0) return new THREE.Vector3();
  if (points.length === 1) return points[0]!.clone();
  const scaled = clamp01(t) * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(scaled));
  const local = scaled - index;
  return points[index]!.clone().lerp(points[index + 1]!, local);
}

interface GolfAddressTransform {
  ball: THREE.Vector3;
  marker: THREE.Vector3;
  forward: THREE.Vector3;
  right: THREE.Vector3;
  golferPosition: THREE.Vector3;
  golferYaw: number;
  cameraPosition: THREE.Vector3;
  cameraTarget: THREE.Vector3;
}

function makeMat(color: string, roughness = 0.72, metalness = 0.02): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function makeFlatMat(color: string, roughness = 0.72, opacity = 1): THREE.MeshStandardMaterial {
  const material = makeMat(color, roughness);
  if (opacity < 1) {
    material.transparent = true;
    material.opacity = opacity;
  }
  return material;
}

function buildLimbBetween(
  start: [number, number, number],
  end: [number, number, number],
  radius: number,
  material: THREE.Material,
  segments = 12
): THREE.Group {
  const from = new THREE.Vector3(...start);
  const to = new THREE.Vector3(...end);
  const direction = to.clone().sub(from);
  const length = Math.max(0.01, direction.length());
  const root = new THREE.Group();
  root.position.copy(from.clone().lerp(to, 0.5));
  root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, segments), material);
  shaft.castShadow = true;
  root.add(shaft);
  for (const y of [-length / 2, length / 2]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, 8), material);
    cap.position.y = y;
    cap.castShadow = true;
    root.add(cap);
  }
  return root;
}

function buildFlatEllipse(x: number, z: number, width: number, depth: number, color: string, y = 0.04, opacity = 1): THREE.Mesh {
  const patch = new THREE.Mesh(new THREE.CircleGeometry(1, 64), makeFlatMat(color, 0.76, opacity));
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(x, y, z);
  patch.scale.set(width / 2, depth / 2, 1);
  patch.receiveShadow = true;
  return patch;
}

function buildFlatStrip(x: number, z: number, width: number, depth: number, color: string, y = 0.055, opacity = 1): THREE.Mesh {
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), makeFlatMat(color, 0.72, opacity));
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(x, y, z);
  strip.receiveShadow = true;
  return strip;
}

function buildPalm(x: number, z: number, scale = 1): THREE.Group {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  root.scale.setScalar(scale);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 4.2, 8), makeMat("#9b6a3a", 0.82));
  trunk.position.y = 2.1;
  trunk.rotation.z = 0.12;
  trunk.castShadow = true;
  root.add(trunk);
  const leafMat = makeMat("#24b86f", 0.68);
  for (let i = 0; i < 7; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.36, 2.7, 8), leafMat);
    leaf.position.y = 4.25;
    leaf.rotation.z = Math.PI / 2.7;
    leaf.rotation.y = (i / 7) * Math.PI * 2;
    leaf.position.x = Math.sin(leaf.rotation.y) * 0.7;
    leaf.position.z = Math.cos(leaf.rotation.y) * 0.7;
    leaf.castShadow = true;
    root.add(leaf);
  }
  return root;
}

function buildCloud(x: number, y: number, z: number, scale = 1): THREE.Group {
  const cloud = new THREE.Group();
  cloud.position.set(x, y, z);
  cloud.scale.setScalar(scale);
  const mat = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.86 });
  for (const [cx, cy, cz, r] of [
    [-0.9, 0, 0, 0.55],
    [-0.25, 0.08, 0, 0.78],
    [0.58, 0, 0, 0.62],
    [1.1, -0.08, 0, 0.42]
  ] as Array<[number, number, number, number]>) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 8), mat);
    puff.position.set(cx, cy, cz);
    cloud.add(puff);
  }
  return cloud;
}

function buildRoundTree(x: number, z: number, scale = 1, color = "#54c86f"): THREE.Group {
  const tree = new THREE.Group();
  tree.position.set(x, 0, z);
  tree.scale.setScalar(scale);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 2.1, 8), makeMat("#9b6a3a", 0.8));
  trunk.position.y = 1.05;
  trunk.castShadow = true;
  tree.add(trunk);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.05, 16, 12), makeMat(color, 0.74));
  canopy.position.y = 2.35;
  canopy.scale.set(1.18, 0.92, 1.08);
  canopy.castShadow = true;
  tree.add(canopy);
  return tree;
}

function buildPine(x: number, z: number, scale = 1): THREE.Group {
  const pine = new THREE.Group();
  pine.position.set(x, 0, z);
  pine.scale.setScalar(scale);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 2.8, 8), makeMat("#8a5a32", 0.82));
  trunk.position.y = 1.4;
  trunk.castShadow = true;
  pine.add(trunk);
  const needles = makeMat("#1f9d62", 0.78);
  for (let i = 0; i < 3; i++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.05 - i * 0.18, 2.1, 10), needles);
    cone.position.y = 2.2 + i * 0.85;
    cone.castShadow = true;
    pine.add(cone);
  }
  return pine;
}

function buildPlant(x: number, z: number, scale = 1): THREE.Group {
  const plant = new THREE.Group();
  plant.position.set(x, 0.05, z);
  plant.scale.setScalar(scale);
  const leafMat = makeMat("#16a34a", 0.8);
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.25, 7), leafMat);
    leaf.position.y = 0.46;
    leaf.rotation.z = 0.9;
    leaf.rotation.y = (i / 6) * Math.PI * 2;
    leaf.position.x = Math.sin(leaf.rotation.y) * 0.2;
    leaf.position.z = Math.cos(leaf.rotation.y) * 0.2;
    plant.add(leaf);
  }
  const flower = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), makeMat("#fb7185", 0.62));
  flower.position.y = 0.92;
  plant.add(flower);
  return plant;
}

function buildSpectator(x: number, z: number, color: string, scale = 1): THREE.Group {
  const spectator = new THREE.Group();
  spectator.position.set(x, 0, z);
  spectator.scale.setScalar(scale);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.46, 5, 10), makeMat(color, 0.68));
  body.position.y = 0.74;
  body.castShadow = true;
  spectator.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), makeMat("#f6c89f", 0.72));
  head.position.y = 1.18;
  spectator.add(head);
  const armMat = makeMat("#f6c89f", 0.72);
  for (const xOffset of [-0.22, 0.22]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.42, 4, 8), armMat);
    arm.position.set(xOffset, 0.88, -0.03);
    arm.rotation.z = xOffset > 0 ? -0.9 : 0.9;
    spectator.add(arm);
  }
  return spectator;
}

function buildBalloon(x: number, y: number, z: number, color: string, scale = 1): THREE.Group {
  const balloon = new THREE.Group();
  balloon.position.set(x, y, z);
  balloon.scale.setScalar(scale);
  const envelope = new THREE.Mesh(new THREE.SphereGeometry(0.8, 18, 12), makeMat(color, 0.55));
  envelope.scale.set(0.86, 1.12, 0.86);
  balloon.add(envelope);
  const string = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 6), makeMat("#f8fafc", 0.4));
  string.position.y = -1.2;
  balloon.add(string);
  return balloon;
}

function buildAirship(x: number, y: number, z: number): THREE.Group {
  const ship = new THREE.Group();
  ship.position.set(x, y, z);
  const envelope = new THREE.Mesh(new THREE.SphereGeometry(2.6, 24, 12), makeMat("#fff7d6", 0.52));
  envelope.scale.set(1.9, 0.55, 0.55);
  ship.add(envelope);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.18, 0.14), makeMat("#38bdf8", 0.44));
  stripe.position.z = -0.55;
  ship.add(stripe);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.42, 0.72), makeMat("#fb923c", 0.58));
  cabin.position.set(0, -0.74, 0);
  ship.add(cabin);
  return ship;
}

function buildRockGroup(x: number, z: number, scale = 1): THREE.Group {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.scale.setScalar(scale);
  const mat = makeMat("#94a3b8", 0.86);
  for (const [rx, rz, s] of [
    [0, 0, 1],
    [0.75, 0.22, 0.72],
    [-0.58, -0.18, 0.62]
  ] as const) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), mat);
    rock.position.set(rx, 0.22 * s, rz);
    rock.scale.y = 0.42;
    rock.castShadow = true;
    group.add(rock);
  }
  return group;
}

function buildLowMound(x: number, z: number, width: number, depth: number, color = "#69d858"): THREE.Group {
  const mound = new THREE.Group();
  mound.position.set(x, -0.08, z);
  const base = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 12), makeMat(color, 0.84));
  base.scale.set(width, 1.08, depth);
  base.position.y = 0.16;
  base.receiveShadow = true;
  mound.add(base);
  const highlight = new THREE.Mesh(new THREE.CircleGeometry(1, 36), makeFlatMat("#b7f56f", 0.78, 0.42));
  highlight.rotation.x = -Math.PI / 2;
  highlight.position.set(-width * 0.2, 0.72, -depth * 0.1);
  highlight.scale.set(width * 0.42, depth * 0.22, 1);
  mound.add(highlight);
  return mound;
}

function buildDecorBridge(x: number, z: number, rotation = 0, scale = 1): THREE.Group {
  const bridge = new THREE.Group();
  bridge.position.set(x, 0, z);
  bridge.rotation.y = rotation;
  bridge.scale.setScalar(scale);
  const deckMat = makeMat("#facc15", 0.5);
  const railMat = makeMat("#0ea5e9", 0.42);
  for (let i = -3; i <= 3; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.16, 4.5), deckMat);
    plank.position.set(i * 0.88, 0.38 + Math.cos(i / 3) * 0.28, 0);
    plank.rotation.z = -i * 0.035;
    plank.castShadow = true;
    plank.receiveShadow = true;
    bridge.add(plank);
  }
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.18, 0.14), railMat);
    rail.position.set(0, 1.04, side * 2.25);
    bridge.add(rail);
    for (let i = -3; i <= 3; i += 2) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.0, 8), railMat);
      post.position.set(i * 0.88, 0.68, side * 2.25);
      bridge.add(post);
    }
  }
  return bridge;
}

function buildCourseKiosk(x: number, z: number, color = "#38bdf8", rotation = 0): THREE.Group {
  const kiosk = new THREE.Group();
  kiosk.position.set(x, 0, z);
  kiosk.rotation.y = rotation;
  const body = new THREE.Mesh(new THREE.BoxGeometry(5.4, 3.2, 3.6), makeMat(color, 0.58));
  body.position.y = 1.6;
  body.castShadow = true;
  body.receiveShadow = true;
  kiosk.add(body);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(4.35, 1.65, 4), makeMat("#fff7d6", 0.5));
  roof.position.y = 4.02;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  kiosk.add(roof);
  const counter = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.26, 0.34), makeMat("#12314c", 0.42));
  counter.position.set(0, 1.44, -1.96);
  kiosk.add(counter);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.72, 0.16), makeMat("#f97316", 0.46));
  sign.position.set(0, 2.58, -1.92);
  kiosk.add(sign);
  return kiosk;
}

function buildWindSpinner(x: number, z: number, color = "#22c55e", scale = 1): THREE.Group {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  root.scale.setScalar(scale);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.9, 8), makeMat("#f8fafc", 0.42));
  pole.position.y = 1.95;
  root.add(pole);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), makeMat("#facc15", 0.48));
  hub.position.y = 3.9;
  root.add(hub);
  const bladeMat = makeMat(color, 0.54);
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.25, 0.08), bladeMat);
    blade.position.y = 3.9;
    blade.rotation.z = (i * Math.PI) / 2;
    blade.position.x = Math.cos(blade.rotation.z) * 0.54;
    blade.position.y += Math.sin(blade.rotation.z) * 0.54;
    root.add(blade);
  }
  return root;
}

function buildTeePlaza(): THREE.Group {
  const plaza = new THREE.Group();
  plaza.name = "pocket-golf-tee-plaza";
  plaza.position.z = -5.2;
  const colors = ["#dff8ff", "#8eddf2", "#fffdf4"];
  for (let x = -4; x <= 4; x++) {
    for (let z = -2; z <= 2; z++) {
      const tile = new THREE.Mesh(new THREE.BoxGeometry(2.35, 0.045, 2.35), makeMat(colors[Math.abs(x + z) % colors.length]!, 0.62));
      tile.position.set(x * 2.35, 0.052, z * 2.35);
      tile.receiveShadow = true;
      plaza.add(tile);
    }
  }
  const backRail = new THREE.Mesh(new THREE.BoxGeometry(22.4, 0.22, 0.18), makeMat("#12314c", 0.44));
  backRail.position.set(0, 0.18, -6.4);
  plaza.add(backRail);
  const teeMarkerMat = makeMat("#ffca3a", 0.55);
  for (const x of [-2.8, 2.8]) {
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), teeMarkerMat);
    marker.position.set(x, 0.3, -1.6);
    marker.castShadow = true;
    plaza.add(marker);
  }
  return plaza;
}

function buildUmbrella(x: number, z: number, color = "#38bdf8", scale = 1): THREE.Group {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  root.scale.setScalar(scale);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 2.4, 8), makeMat("#f8fafc", 0.42));
  pole.position.y = 1.2;
  root.add(pole);
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.25, 0.55, 16), makeMat(color, 0.58));
  canopy.position.y = 2.55;
  canopy.scale.z = 0.78;
  canopy.castShadow = true;
  root.add(canopy);
  const table = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.08, 18), makeMat("#fff7d6", 0.58));
  table.position.y = 0.86;
  root.add(table);
  return root;
}

function buildBench(x: number, z: number, rotation = 0): THREE.Group {
  const bench = new THREE.Group();
  bench.position.set(x, 0, z);
  bench.rotation.y = rotation;
  const wood = makeMat("#d97706", 0.66);
  const legMat = makeMat("#12314c", 0.52);
  for (const y of [0.56, 0.82]) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.18, 0.18), wood);
    slat.position.y = y;
    slat.castShadow = true;
    bench.add(slat);
  }
  for (const xOffset of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.6, 0.18), legMat);
    leg.position.set(xOffset, 0.3, 0);
    bench.add(leg);
  }
  return bench;
}

function buildResortVilla(x: number, z: number, width: number, depth: number, height: number, color: string, roofColor: string): THREE.Group {
  const villa = new THREE.Group();
  villa.position.set(x, 0, z);
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), makeMat(color, 0.72));
  body.position.y = height / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  villa.add(body);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(width, depth) * 0.74, 3.6, 4), makeMat(roofColor, 0.58));
  roof.position.y = height + 1.8;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  villa.add(roof);

  const windowMat = makeMat("#bff3ff", 0.34, 0.06);
  const trimMat = makeMat("#ffffff", 0.42);
  const rows = Math.max(2, Math.floor(height / 3.1));
  for (let row = 0; row < rows; row++) {
    for (let column = -1; column <= 1; column++) {
      const window = new THREE.Mesh(new THREE.BoxGeometry(width * 0.18, 0.72, 0.08), windowMat);
      window.position.set(column * width * 0.24, 1.8 + row * 2.35, -depth / 2 - 0.045);
      villa.add(window);
      const awning = new THREE.Mesh(new THREE.BoxGeometry(width * 0.22, 0.1, 0.22), trimMat);
      awning.position.set(column * width * 0.24, 2.25 + row * 2.35, -depth / 2 - 0.12);
      villa.add(awning);
    }
  }
  const door = new THREE.Mesh(new THREE.BoxGeometry(width * 0.2, 1.65, 0.1), makeMat("#38bdf8", 0.44));
  door.position.set(0, 0.83, -depth / 2 - 0.07);
  villa.add(door);
  return villa;
}

function buildGardenBed(x: number, z: number, width: number, depth: number, color = "#22c55e"): THREE.Group {
  const bed = new THREE.Group();
  bed.position.set(x, 0.05, z);
  bed.add(buildFlatEllipse(0, 0, width, depth, "#3fcf64", 0.025));
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const flower = buildPlant(Math.sin(angle) * width * 0.34, Math.cos(angle) * depth * 0.34, 0.42);
    flower.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.material && i % 3 === 0) mesh.material = makeMat(color, 0.72);
    });
    bed.add(flower);
  }
  return bed;
}

function buildBunkerHazard(x: number, z: number, width: number, depth: number): THREE.Mesh {
  const bunker = new THREE.Mesh(new THREE.CircleGeometry(1, 38), makeMat("#fff0bd", 0.92));
  bunker.rotation.x = -Math.PI / 2;
  bunker.position.set(x, 0.045, z);
  bunker.scale.set(width / 2, depth / 2, 1);
  bunker.receiveShadow = true;
  return bunker;
}

function buildWaterHazard(x: number, z: number, width: number, depth: number): THREE.Group {
  const water = new THREE.Group();
  water.position.set(x, 0.035, z);
  const surface = new THREE.Mesh(new THREE.CircleGeometry(1, 42), makeMat("#25b9ff", 0.34, 0.02));
  surface.rotation.x = -Math.PI / 2;
  surface.scale.set(width / 2, depth / 2, 1);
  water.add(surface);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 8, 64), makeMat("#ffffff", 0.44));
  rim.rotation.x = Math.PI / 2;
  rim.scale.set(width / 2, depth / 2, 1);
  water.add(rim);
  return water;
}

function buildGolfCartObstacle(x: number, z: number, color = "#fb923c"): THREE.Group {
  const cart = new THREE.Group();
  cart.position.set(x, 0, z);
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.1, 2.1), makeMat(color, 0.58));
  body.position.y = 0.78;
  body.castShadow = true;
  cart.add(body);
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.18, 2.45), makeMat("#f8fafc", 0.4));
  canopy.position.y = 1.68;
  cart.add(canopy);
  for (const [wx, wz] of [
    [-1.55, -0.95],
    [1.55, -0.95],
    [-1.55, 0.95],
    [1.55, 0.95]
  ] as const) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.28, 16), makeMat("#111827", 0.6));
    wheel.position.set(wx, 0.34, wz);
    wheel.rotation.z = Math.PI / 2;
    wheel.castShadow = true;
    cart.add(wheel);
  }
  return cart;
}

function buildMascotObstacle(x: number, z: number, color = "#fb7185"): THREE.Group {
  const mascot = new THREE.Group();
  mascot.position.set(x, 0, z);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.2, 8, 16), makeMat(color, 0.62));
  body.position.y = 1.05;
  body.castShadow = true;
  mascot.add(body);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.36, 18, 12), makeMat("#fff7dd", 0.48));
  face.position.set(0, 1.54, -0.35);
  mascot.add(face);
  for (const xOffset of [-0.13, 0.13]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), makeMat("#111827", 0.5));
    eye.position.set(xOffset, 1.58, -0.68);
    mascot.add(eye);
  }
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.54, 0.08), makeMat("#facc15", 0.5));
  sign.position.set(0, 2.08, -0.16);
  mascot.add(sign);
  return mascot;
}

function buildArcadeBumper(x: number, z: number, color = "#fb7185", scale = 1): THREE.Group {
  const bumper = new THREE.Group();
  bumper.position.set(x, 0, z);
  bumper.scale.setScalar(scale);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.45, 0.34, 36), makeMat("#fff7d6", 0.48));
  base.position.y = 0.17;
  base.castShadow = true;
  base.receiveShadow = true;
  bumper.add(base);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.82, 0.2, 10, 42), makeMat(color, 0.38, 0.08));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.43;
  ring.castShadow = true;
  bumper.add(ring);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.84, 1.04, 0.7, 28), makeMat("#0ea5e9", 0.44, 0.04));
  core.position.y = 0.72;
  core.castShadow = true;
  bumper.add(core);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.78, 24, 12), makeMat("#facc15", 0.4, 0.02));
  cap.position.y = 1.16;
  cap.scale.y = 0.46;
  cap.castShadow = true;
  bumper.add(cap);
  for (let i = 0; i < 5; i++) {
    const spark = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.56), makeMat("#ffffff", 0.32));
    spark.position.y = 1.36;
    spark.rotation.y = (i / 5) * Math.PI * 2;
    spark.position.x = Math.sin(spark.rotation.y) * 1.2;
    spark.position.z = Math.cos(spark.rotation.y) * 1.2;
    bumper.add(spark);
  }
  return bumper;
}

function buildSpinnerGate(x: number, z: number, color = "#38bdf8", rotation = 0, scale = 1): { root: THREE.Group; rotor: THREE.Object3D } {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  root.rotation.y = rotation;
  root.scale.setScalar(scale);
  const postMat = makeMat("#12314c", 0.46);
  const armMat = makeMat(color, 0.36, 0.06);
  const padMat = makeMat("#fff7d6", 0.52);
  for (const xOffset of [-2.1, 2.1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 2.9, 10), postMat);
    post.position.set(xOffset, 1.45, 0);
    post.castShadow = true;
    root.add(post);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.16, 18), padMat);
    foot.position.set(xOffset, 0.08, 0);
    foot.castShadow = true;
    root.add(foot);
  }
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.38, 18, 12), makeMat("#facc15", 0.38, 0.08));
  hub.position.y = 1.68;
  hub.castShadow = true;
  root.add(hub);
  const rotor = new THREE.Group();
  rotor.position.y = 1.68;
  for (let i = 0; i < 3; i++) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.2, 0.34), armMat);
    arm.rotation.y = (i / 3) * Math.PI * 2;
    arm.castShadow = true;
    rotor.add(arm);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), makeMat("#fb7185", 0.4));
    bulb.position.x = 2.35;
    bulb.rotation.y = arm.rotation.y;
    bulb.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), arm.rotation.y);
    rotor.add(bulb);
  }
  root.add(rotor);
  return { root, rotor };
}

function buildBlockerGate(x: number, z: number, color = "#a78bfa", rotation = 0, scale = 1): THREE.Group {
  const gate = new THREE.Group();
  gate.position.set(x, 0, z);
  gate.rotation.y = rotation;
  gate.scale.setScalar(scale);
  const baseMat = makeMat("#fff7d6", 0.54);
  const blockMat = makeMat(color, 0.44, 0.04);
  for (const [xOffset, height] of [
    [-2.6, 2.2],
    [0, 1.35],
    [2.6, 2.2]
  ] as const) {
    const block = new THREE.Mesh(new THREE.BoxGeometry(1.12, height, 1.05), blockMat);
    block.position.set(xOffset, height / 2, 0);
    block.castShadow = true;
    block.receiveShadow = true;
    gate.add(block);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.18, 1.28), baseMat);
    cap.position.set(xOffset, height + 0.1, 0);
    cap.castShadow = true;
    gate.add(cap);
  }
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.18, 0.16), makeMat("#facc15", 0.42));
  stripe.position.set(0, 1.18, -0.62);
  gate.add(stripe);
  return gate;
}

function buildGolfer(color: string, variant = 0): THREE.Group {
  const root = new THREE.Group();
  root.name = "pocket-golf-golfer";
  const skin = makeMat(["#f6c89f", "#f1b891", "#ffe0b5", "#d9a779"][variant % 4]!, 0.7);
  const shirt = makeMat(color, 0.58);
  const shirtShadow = makeMat("#0694a8", 0.64);
  const navy = makeMat("#12314c", 0.54);
  const white = makeMat("#fffdf4", 0.46);
  const black = makeMat("#111827", 0.48);
  const cheekMat = makeMat("#fb9aaa", 0.58);
  const accent = makeMat(["#0ea5e9", "#fb7185", "#facc15", "#8b5cf6"][variant % 4]!, 0.5);
  const shorts = makeMat(["#ffffff", "#14324a", "#fef3c7", "#1f2937"][variant % 4]!, 0.56);
  const hair = makeMat(["#16b7d6", "#5b341d", "#f59e0b", "#4b5563"][variant % 4]!, 0.64);
  const glove = makeMat("#f8fafc", 0.42);

  const hips = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.36, 0.48), shorts);
  hips.position.set(0, 0.72, -0.02);
  hips.castShadow = true;
  root.add(hips);

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.48, 0.78, 10, 20), shirt);
  body.position.set(0, 1.22, -0.02);
  body.scale.set(0.9, 1.06, 0.72);
  body.rotation.z = -0.04;
  body.castShadow = true;
  root.add(body);

  const shirtPanel = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.74, 0.045), shirtShadow);
  shirtPanel.position.set(0, 1.17, -0.37);
  root.add(shirtPanel);
  const shirtBadge = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.045), makeMat("#facc15", 0.5));
  shirtBadge.position.set(0.18, 1.28, -0.405);
  shirtBadge.rotation.z = 0.1;
  root.add(shirtBadge);
  const sideStripe = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.64, 0.052), white);
  sideStripe.position.set(-0.31, 1.14, -0.38);
  sideStripe.rotation.z = -0.06;
  root.add(sideStripe);
  const collar = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.09, 0.18), white);
  collar.position.set(0, 1.67, -0.38);
  collar.rotation.x = -0.08;
  root.add(collar);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.1, 0.5), navy);
  belt.position.set(0, 0.92, -0.03);
  root.add(belt);
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.13, 0.055), makeMat("#facc15", 0.38, 0.12));
  buckle.position.set(0, 0.93, -0.31);
  root.add(buckle);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.22, 12), skin);
  neck.position.set(0, 1.68, -0.01);
  root.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.54, 30, 18), skin);
  head.position.set(0, 2.1, -0.03);
  head.scale.set(0.96, 1.03, 0.92);
  head.castShadow = true;
  root.add(head);

  for (const x of [-0.52, 0.52]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), skin);
    ear.position.set(x, 2.08, -0.02);
    ear.scale.set(0.72, 1.05, 0.48);
    root.add(ear);
  }

  const hairClumps: Array<[number, number, number, number, number]> =
    variant % 4 === 0
      ? [
          [-0.32, 2.48, -0.2, 0.2, -0.62],
          [-0.1, 2.58, -0.25, 0.24, -0.24],
          [0.14, 2.56, -0.21, 0.22, 0.28],
          [0.34, 2.45, -0.12, 0.19, 0.7],
          [-0.42, 2.34, -0.05, 0.16, -0.95]
        ]
      : [
          [-0.3, 2.42, -0.14, 0.18, -0.4],
          [-0.06, 2.5, -0.18, 0.2, 0],
          [0.22, 2.44, -0.12, 0.18, 0.45]
        ];
  for (const [x, y, z, radius, rotation] of hairClumps) {
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(radius, radius * 1.95, 9), hair);
    tuft.position.set(x, y, z);
    tuft.rotation.x = -0.48;
    tuft.rotation.z = rotation;
    tuft.castShadow = true;
    root.add(tuft);
  }
  const sideHair = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 10), hair);
  sideHair.position.set(0, 2.3, 0.1);
  sideHair.scale.set(1.05, 0.5, 0.82);
  root.add(sideHair);
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.5, 22, 12), hair);
  hairCap.position.set(0, 2.39, 0);
  hairCap.scale.set(1.02, 0.34, 0.9);
  hairCap.castShadow = true;
  root.add(hairCap);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.08, 0.34), accent);
  visor.position.set(0, 2.34, -0.45);
  visor.rotation.x = -0.12;
  visor.castShadow = true;
  root.add(visor);

  for (const x of [-0.17, 0.17]) {
    const eyeWhite = new THREE.Mesh(new THREE.SphereGeometry(0.095, 14, 10), white);
    eyeWhite.position.set(x, 2.12, -0.48);
    eyeWhite.scale.set(1, 1.16, 0.32);
    root.add(eyeWhite);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), black);
    pupil.position.set(x + 0.018, 2.1, -0.535);
    pupil.scale.set(1, 1, 0.4);
    root.add(pupil);
    const sparkle = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), white);
    sparkle.position.set(x + 0.036, 2.122, -0.565);
    sparkle.scale.set(1, 1, 0.34);
    root.add(sparkle);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.035, 0.035), hair);
    brow.position.set(x, 2.25, -0.51);
    brow.rotation.z = x < 0 ? 0.18 : -0.18;
    root.add(brow);
  }
  for (const x of [-0.3, 0.3]) {
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), cheekMat);
    cheek.position.set(x, 1.98, -0.505);
    cheek.scale.set(1, 0.72, 0.28);
    root.add(cheek);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), skin);
  nose.position.set(0, 2.02, -0.55);
  nose.scale.set(0.72, 0.72, 0.38);
  root.add(nose);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.014, 6, 20, Math.PI), black);
  smile.position.set(0, 1.92, -0.51);
  smile.rotation.z = Math.PI;
  smile.scale.y = 0.6;
  root.add(smile);

  root.add(buildLimbBetween([-0.47, 1.48, -0.12], [-0.31, 1.25, -0.45], 0.105, shirt, 12));
  root.add(buildLimbBetween([0.47, 1.46, -0.12], [0.39, 1.17, -0.46], 0.105, shirt, 12));
  root.add(buildLimbBetween([-0.31, 1.25, -0.45], [0.12, 1.17, -0.57], 0.073, skin, 12));
  root.add(buildLimbBetween([0.39, 1.17, -0.46], [0.26, 1.08, -0.57], 0.073, skin, 12));

  for (const [x, y, z] of [
    [0.14, 1.16, -0.6],
    [0.3, 1.07, -0.59]
  ] as const) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), glove);
    hand.position.set(x, y, z);
    hand.scale.set(1, 0.82, 0.82);
    hand.castShadow = true;
    root.add(hand);
  }

  root.add(buildLimbBetween([-0.22, 0.58, -0.02], [-0.28, 0.16, -0.02], 0.13, shorts, 12));
  root.add(buildLimbBetween([0.22, 0.58, -0.02], [0.3, 0.16, -0.02], 0.13, shorts, 12));
  for (const [x, z] of [
    [-0.28, -0.08],
    [0.3, -0.08]
  ] as const) {
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.24, 10), white);
    sock.position.set(x, 0.21, z);
    sock.castShadow = true;
    root.add(sock);
    const sockStripe = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.036, 0.22), accent);
    sockStripe.position.set(x, 0.28, z - 0.01);
    root.add(sockStripe);
  }
  for (const [x, z, rot] of [
    [-0.3, -0.18, -0.08],
    [0.32, -0.18, 0.08]
  ] as const) {
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.58), black);
    shoe.position.set(x, 0.07, z);
    shoe.rotation.y = rot;
    shoe.castShadow = true;
    root.add(shoe);
  }

  const club = new THREE.Group();
  club.name = "club";
  club.position.set(0.23, 1.18, -0.58);
  club.rotation.set(0.08, -0.08, -0.12);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.42, 10), makeMat("#0f172a", 0.4));
  grip.position.set(0.02, 0.03, 0);
  grip.rotation.z = Math.PI / 2;
  club.add(grip);
  const shaft = buildLimbBetween([0, 0, 0], [0.72, -1.16, -0.08], 0.024, makeMat("#e2e8f0", 0.28, 0.28), 8);
  club.add(shaft);
  const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.16, 0.24), makeMat("#26384d", 0.34, 0.28));
  headMesh.position.set(0.86, -1.22, -0.08);
  headMesh.rotation.set(0.05, 0.18, -0.22);
  headMesh.castShadow = true;
  club.add(headMesh);
  root.add(club);
  return root;
}

export class PocketGolfRenderer implements GameRenderer<PocketGolfGameStatePayload> {
  private readonly room: PublicRoomState;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private container: HTMLElement | null = null;
  private hud: HTMLElement | null = null;
  private golfer: THREE.Group | null = null;
  private ball: THREE.Mesh | null = null;
  private club: THREE.Object3D | null = null;
  private trail: THREE.Line | null = null;
  private ocean: THREE.Mesh | null = null;
  private fairway: THREE.Mesh | null = null;
  private green: THREE.Mesh | null = null;
  private flagPole: THREE.Mesh | null = null;
  private flag: THREE.Mesh | null = null;
  private courseObstacleGroup: THREE.Group | null = null;
  private aimGuide: THREE.Group | null = null;
  private aimGuideGlow: THREE.Mesh | null = null;
  private aimGuideLine: THREE.Mesh | null = null;
  private aimGuideDots: THREE.Mesh[] = [];
  private aimGuideArrow: THREE.Mesh | null = null;
  private ballMarker: THREE.Mesh | null = null;
  private state: PocketGolfGameStatePayload | null = null;
  private activeGolferPlayerNumber: number | null = null;
  private addressGolferYaw = Math.PI;
  private activeCourseKey = "";
  private latestShotSequence = 0;
  private shot: { payload: PocketGolfShotPayload; startedAt: number; points: THREE.Vector3[]; finishing?: boolean } | null = null;
  private liveClubPose: GolfClubPosePayload | null = null;
  private clouds: THREE.Group[] = [];
  private airborneDecor: THREE.Group[] = [];
  private movingObstacles: Array<{ object: THREE.Group; baseX: number; amplitude: number; speed: number; phase: number }> = [];
  private spinningObstacles: Array<{ object: THREE.Object3D; speed: number; phase: number }> = [];

  constructor(room: PublicRoomState) {
    this.room = room;
  }

  mount(container: HTMLElement): void {
    this.container = container;
    container.classList.add("pocket-golf-viewport");
    container.innerHTML = `<div class="pocket-golf-hud" id="pocket-golf-hud"></div>`;
    this.hud = container.querySelector("#pocket-golf-hud");
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#78dcff");
    scene.fog = new THREE.Fog("#d8fbff", 160, 420);
    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / Math.max(1, container.clientHeight), 0.1, 600);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.prepend(renderer.domElement);
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.buildScene();
    window.addEventListener("resize", this.onResize);
  }

  private buildScene(): void {
    if (!this.scene) return;
    const scene = this.scene;
    const sun = new THREE.DirectionalLight("#fff5c9", 3.4);
    sun.position.set(-45, 80, -28);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun, new THREE.HemisphereLight("#bcefff", "#7ccf75", 2.1));

    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(560, 560, 24, 24), makeMat("#31b8e8", 0.38, 0.03));
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(0, -0.12, 150);
    scene.add(ocean);
    this.ocean = ocean;
    const sand = new THREE.Mesh(new THREE.CircleGeometry(118, 96), makeMat("#ffe3a3", 0.84));
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(0, -0.035, 82);
    sand.scale.set(1.26, 2.16, 1);
    sand.receiveShadow = true;
    scene.add(sand);
    const rough = new THREE.Mesh(new THREE.CircleGeometry(86, 96), makeMat("#55c85b", 0.8));
    rough.rotation.x = -Math.PI / 2;
    rough.position.set(0, -0.005, 78);
    rough.scale.set(1.06, 2.2, 1);
    rough.receiveShadow = true;
    scene.add(rough);
    const sidePathLeft = buildFlatStrip(-48, 74, 6.8, 168, "#fff7d6", 0.018);
    sidePathLeft.rotation.z = -0.08;
    scene.add(sidePathLeft);
    const sidePathRight = buildFlatStrip(48, 92, 6.2, 174, "#fff7d6", 0.018);
    sidePathRight.rotation.z = 0.1;
    scene.add(sidePathRight);
    const fairway = new THREE.Mesh(new THREE.PlaneGeometry(66, 154, 8, 18), makeMat("#91e86b", 0.76));
    fairway.rotation.x = -Math.PI / 2;
    fairway.position.set(0, 0.028, 56);
    fairway.receiveShadow = true;
    scene.add(fairway);
    this.fairway = fairway;
    const green = new THREE.Mesh(new THREE.CircleGeometry(19, 64), makeMat("#bdfb75", 0.62));
    green.rotation.x = -Math.PI / 2;
    green.position.set(0, 0.07, 112);
    green.scale.set(1.25, 0.86, 1);
    green.receiveShadow = true;
    scene.add(green);
    this.green = green;
    scene.add(buildTeePlaza());
    scene.add(buildLowMound(-55, 52, 18, 28, "#73dd5f"));
    scene.add(buildLowMound(58, 72, 16, 32, "#5ecf5a"));
    scene.add(buildLowMound(-62, 132, 20, 34, "#84e071"));
    scene.add(buildLowMound(64, 148, 18, 31, "#6bd664"));
    scene.add(buildDecorBridge(-33, 86, 0.38, 0.86));
    scene.add(buildDecorBridge(35, 140, -0.42, 0.74));
    scene.add(buildCourseKiosk(-45, 28, "#38bdf8", 0.26));
    scene.add(buildCourseKiosk(46, 48, "#fb7185", -0.3));
    scene.add(buildWindSpinner(-24, 46, "#22c55e", 0.95));
    scene.add(buildWindSpinner(28, 68, "#0ea5e9", 0.82));

    const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 7.4, 10), makeMat("#ffffff", 0.38));
    flagPole.position.set(0, 3.7, 112);
    flagPole.castShadow = true;
    scene.add(flagPole);
    this.flagPole = flagPole;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 2.1), makeMat("#ff5964", 0.5));
    flag.position.set(2.42, 6.2, 112);
    flag.rotation.y = -0.18;
    scene.add(flag);
    this.flag = flag;

    for (const [x, z, s] of [
      [-34, 22, 1],
      [31, 34, 0.88],
      [-43, 92, 1.1],
      [39, 122, 0.92],
      [-26, 158, 0.8]
    ] as const) scene.add(buildPalm(x, z, s));

    for (const [x, z, s, color] of [
      [-18, 34, 0.82, "#4ade80"],
      [18, 46, 0.72, "#86efac"],
      [-30, 118, 0.9, "#22c55e"],
      [32, 152, 0.76, "#65a30d"],
      [-52, 188, 0.68, "#84cc16"]
    ] as const) scene.add(buildRoundTree(x, z, s, color));

    for (const [x, z, s] of [
      [-74, 118, 0.88],
      [-66, 132, 0.72],
      [68, 138, 0.84],
      [76, 152, 0.68]
    ] as const) scene.add(buildPine(x, z, s));

    for (const [x, z, s] of [
      [-9, 12, 0.82],
      [12, 18, 0.74],
      [-24, 64, 0.86],
      [25, 88, 0.7],
      [-16, 138, 0.78],
      [18, 158, 0.72]
    ] as const) scene.add(buildPlant(x, z, s));

    for (const [x, z, color] of [
      [-15, 150, "#38bdf8"],
      [-12, 152, "#f97316"],
      [-9, 151, "#facc15"],
      [13, 151, "#a78bfa"],
      [16, 149, "#fb7185"],
      [19, 152, "#22c55e"]
    ] as const) {
      const spectator = buildSpectator(x, z, color, 0.9);
      spectator.rotation.y = Math.PI;
      scene.add(spectator);
    }

    for (const [x, z, s] of [
      [-86, 78, 1.4],
      [84, 96, 1.1],
      [-70, 172, 1.2],
      [72, 206, 1.35]
    ] as const) scene.add(buildRockGroup(x, z, s));

    scene.add(buildResortVilla(-58, 154, 12, 10, 10, "#fff7d6", "#26a6d1"));
    scene.add(buildResortVilla(55, 176, 13, 10, 13, "#fef3c7", "#38bdf8"));
    scene.add(buildResortVilla(-74, 208, 11, 9, 9, "#e0f2fe", "#f97316"));
    scene.add(buildUmbrella(-50, 112, "#38bdf8", 1.1));
    scene.add(buildUmbrella(47, 126, "#fb7185", 0.95));
    scene.add(buildBench(-41, 42, 0.28));
    scene.add(buildBench(43, 62, -0.34));
    scene.add(buildGardenBed(-28, 22, 6, 3.2, "#fb7185"));
    scene.add(buildGardenBed(29, 30, 5.2, 3, "#facc15"));
    scene.add(buildGardenBed(-44, 74, 7.4, 4.2, "#a78bfa"));
    scene.add(buildGardenBed(44, 104, 7.8, 4.5, "#fb7185"));

    this.clouds = [buildCloud(-52, 30, 54, 4.4), buildCloud(44, 42, 116, 3.2), buildCloud(-10, 50, 214, 5)];
    this.clouds.forEach((cloud) => scene.add(cloud));
    this.airborneDecor = [
      buildBalloon(-42, 24, 88, "#fb7185", 0.72),
      buildBalloon(-38, 27, 93, "#facc15", 0.58),
      buildBalloon(52, 30, 136, "#38bdf8", 0.66),
      buildAirship(22, 34, 194)
    ];
    this.airborneDecor.forEach((item) => scene.add(item));

    const active = this.room.players[0];
    this.syncGolfer(active?.playerNumber ?? 1);

    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 16), makeMat("#ffffff", 0.36));
    this.ball.position.set(0, 0.32, 0);
    this.ball.castShadow = true;
    scene.add(this.ball);
    this.ballMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.86, 36),
      new THREE.MeshBasicMaterial({ color: "#facc15", transparent: true, opacity: 0.72, depthWrite: false })
    );
    this.ballMarker.rotation.x = -Math.PI / 2;
    this.ballMarker.position.set(0, 0.085, 0);
    this.ballMarker.renderOrder = 3;
    scene.add(this.ballMarker);
    this.buildAimGuide();
    this.updateCameraSetup(1);
  }

  private buildAimGuide(): void {
    if (!this.scene) return;
    const group = new THREE.Group();
    group.name = "pocket-golf-aim-guide";
    group.visible = false;
    const lineMat = new THREE.MeshBasicMaterial({ color: "#006dff", transparent: true, opacity: 0.82, depthWrite: false, depthTest: false });
    const glowMat = new THREE.MeshBasicMaterial({ color: "#7dd3fc", transparent: true, opacity: 0.38, depthWrite: false, depthTest: false });
    const dotMat = new THREE.MeshBasicMaterial({ color: "#00aaff", transparent: true, opacity: 0.96, depthWrite: false, depthTest: false });
    const arrowMat = new THREE.MeshBasicMaterial({ color: "#006dff", transparent: true, opacity: 0.98, depthWrite: false, depthTest: false });
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 1, 14), glowMat);
    glow.rotation.x = Math.PI / 2;
    glow.position.y = 0.52;
    glow.renderOrder = 5;
    group.add(glow);
    this.aimGuideGlow = glow;
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 1, 10), lineMat);
    line.rotation.x = Math.PI / 2;
    line.position.y = 0.58;
    line.renderOrder = 6;
    group.add(line);
    this.aimGuideLine = line;
    this.aimGuideDots = [];
    for (let i = 0; i < 12; i++) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 8), dotMat.clone());
      dot.position.y = 0.66;
      dot.renderOrder = 7;
      group.add(dot);
      this.aimGuideDots.push(dot);
    }
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.86, 1.85, 3), arrowMat);
    arrow.position.y = 0.82;
    arrow.rotation.x = Math.PI / 2;
    arrow.renderOrder = 8;
    group.add(arrow);
    this.aimGuideArrow = arrow;
    this.aimGuide = group;
    this.scene.add(group);
  }

  private syncCourseForState(state: PocketGolfGameStatePayload): void {
    if (!this.scene) return;
    const key = `${state.holeNumber}:${state.holeDistance}:${state.holeDifficulty}`;
    if (this.activeCourseKey === key) return;
    this.activeCourseKey = key;
    if (this.courseObstacleGroup) {
      this.scene.remove(this.courseObstacleGroup);
      disposeObject(this.courseObstacleGroup);
    }
    this.movingObstacles = [];
    this.spinningObstacles = [];

    const width = state.holeDifficulty === "Easy" ? 66 : state.holeDifficulty === "Medium" ? 50 : 36;
    const length = Math.max(142, state.holeDistance + 44);
    const greenScale = state.holeDifficulty === "Easy" ? 1.24 : state.holeDifficulty === "Medium" ? 1.02 : 0.82;
    if (this.fairway) {
      this.fairway.geometry.dispose();
      this.fairway.geometry = new THREE.PlaneGeometry(width, length, 8, 18);
      this.fairway.position.z = state.holeDistance / 2;
    }
    if (this.green) {
      this.green.position.z = state.holeDistance;
      this.green.scale.set(1.25 * greenScale, 0.86 * greenScale, 1);
    }
    if (this.flagPole) this.flagPole.position.z = state.holeDistance;
    if (this.flag) this.flag.position.z = state.holeDistance;

    const group = new THREE.Group();
    group.name = "pocket-golf-hole-obstacles";
    group.add(buildFlatEllipse(0, state.holeDistance, 49 * greenScale, 34 * greenScale, "#8fe76a", 0.055));
    group.add(buildFlatEllipse(0, state.holeDistance, 29 * greenScale, 20 * greenScale, "#c9ff82", 0.082));
    const cup = new THREE.Group();
    cup.position.set(0, 0, state.holeDistance);
    const cupShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.84, 48),
      new THREE.MeshBasicMaterial({ color: "#07111f", transparent: true, opacity: 0.94, depthWrite: false })
    );
    cupShadow.rotation.x = -Math.PI / 2;
    cupShadow.position.y = 0.135;
    cupShadow.renderOrder = 2;
    cup.add(cupShadow);
    const cupRim = new THREE.Mesh(new THREE.TorusGeometry(0.84, 0.07, 8, 48), makeMat("#fffdf4", 0.38));
    cupRim.rotation.x = Math.PI / 2;
    cupRim.position.y = 0.155;
    cupRim.castShadow = true;
    cup.add(cupRim);
    const cupLip = new THREE.Mesh(new THREE.TorusGeometry(0.53, 0.035, 8, 36), makeMat("#1f2937", 0.46));
    cupLip.rotation.x = Math.PI / 2;
    cupLip.position.y = 0.17;
    cup.add(cupLip);
    group.add(cup);

    for (let i = 0; i < Math.ceil(length / 9); i++) {
      const z = 4.5 + i * 9;
      if (z > state.holeDistance + 28) break;
      const stripeWidth = width * (i % 2 === 0 ? 0.94 : 0.82);
      const stripeColor = i % 2 === 0 ? "#a7f37d" : "#7fdd5e";
      group.add(buildFlatStrip(Math.sin(i * 0.65) * 1.2, z, stripeWidth, 4.2, stripeColor, 0.064, 0.86));
    }
    for (const side of [-1, 1]) {
      const edge = buildFlatStrip(side * (width / 2 + 0.7), state.holeDistance / 2, 0.45, length, "#f8fafc", 0.092, 0.78);
      edge.rotation.z = side * 0.018;
      group.add(edge);
      const roughFlowers = buildGardenBed(side * (width / 2 + 10), state.holeDistance * 0.36, 6.5, 3.2, side < 0 ? "#fb7185" : "#facc15");
      roughFlowers.scale.setScalar(0.78);
      group.add(roughFlowers);
    }
    for (const [x, z, w, d] of [
      [-30, 66, 13, 23],
      [30, 82, 15, 25],
      [-24, state.holeDistance - 24, 13, 19],
      [23, state.holeDistance - 18, 12, 18]
    ] as const) {
      group.add(buildBunkerHazard(x, z, w, d));
    }
    const yardagePost = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.9, 8), makeMat("#ffffff", 0.5));
    yardagePost.position.set(width / 2 + 5, 1.45, state.holeDistance * 0.52);
    group.add(yardagePost);
    const yardageBoard = new THREE.Mesh(new THREE.BoxGeometry(4.8, 1.2, 0.16), makeMat("#0ea5e9", 0.44));
    yardageBoard.position.set(width / 2 + 5, 2.9, state.holeDistance * 0.52);
    yardageBoard.rotation.y = -0.18;
    group.add(yardageBoard);
    const addSpinner = (x: number, z: number, color: string, rotation: number, scale: number, speed: number, phase = 0) => {
      const spinner = buildSpinnerGate(x, z, color, rotation, scale);
      group.add(spinner.root);
      this.spinningObstacles.push({ object: spinner.rotor, speed, phase });
    };
    const addBumper = (x: number, z: number, color: string, scale: number) => {
      group.add(buildArcadeBumper(x, z, color, scale));
    };
    const addGate = (x: number, z: number, color: string, rotation: number, scale: number) => {
      group.add(buildBlockerGate(x, z, color, rotation, scale));
    };

    if (state.holeNumber === 1) {
      const starterSign = new THREE.Mesh(new THREE.BoxGeometry(8.5, 2.2, 0.18), makeMat("#22c55e", 0.48));
      starterSign.position.set(-31, 2.2, 38);
      starterSign.rotation.y = 0.22;
      group.add(starterSign);
      group.add(buildWaterHazard(-42, 92, 18, 12));
      group.add(buildDecorBridge(-42, 92, 0.24, 0.62));
      group.add(buildCourseKiosk(38, 74, "#facc15", -0.42));
      group.add(buildWindSpinner(-35, 112, "#fb7185", 0.72));
      group.add(buildGardenBed(34, 112, 8.4, 4.4, "#38bdf8"));
      group.add(buildBench(-28, 96, 0.78));
      addBumper(-17, 48, "#fb7185", 0.9);
      addBumper(18, 69, "#38bdf8", 0.86);
      addSpinner(-8, 91, "#facc15", 0.24, 0.72, 1.6);
      addGate(10, 101, "#22c55e", -0.28, 0.58);
      for (const [x, z, color] of [
        [-36, 74, "#38bdf8"],
        [36, 88, "#f97316"],
        [-28, 118, "#a78bfa"]
      ] as const) {
        const mascot = buildMascotObstacle(x, z, color);
        mascot.scale.setScalar(0.68);
        mascot.rotation.y = x < 0 ? 0.55 : -0.55;
        group.add(mascot);
      }
      const paradeMascot = buildMascotObstacle(24, 72, "#22c55e");
      paradeMascot.scale.setScalar(0.56);
      paradeMascot.rotation.y = -0.45;
      group.add(paradeMascot);
      this.movingObstacles.push({ object: paradeMascot, baseX: 24, amplitude: 7, speed: 1.25, phase: 0.2 });
    } else if (state.holeNumber === 2) {
      group.add(buildWaterHazard(46, 103, 48, 58));
      group.add(buildBunkerHazard(-28.5, 108, 19, 40));
      group.add(buildBunkerHazard(27, 145, 22, 26));
      addSpinner(-7, 68, "#38bdf8", -0.18, 0.88, 2.25);
      addGate(12, 105, "#a78bfa", 0.34, 0.82);
      addBumper(-16, 137, "#f97316", 0.82);
      addBumper(22, 124, "#facc15", 0.72);
      const cart = buildGolfCartObstacle(0, 82, "#fb923c");
      cart.rotation.y = Math.PI / 2;
      group.add(cart);
      this.movingObstacles.push({ object: cart, baseX: 0, amplitude: 23, speed: 0.9, phase: 0.4 });
      const mascot = buildMascotObstacle(-39, 143, "#38bdf8");
      mascot.rotation.y = 0.55;
      group.add(mascot);
    } else {
      group.add(buildWaterHazard(-49, 90, 50, 68));
      group.add(buildWaterHazard(56, 147, 52, 62));
      group.add(buildBunkerHazard(-18, 151, 16, 38));
      group.add(buildBunkerHazard(19.5, 164, 19, 40));
      group.add(buildBunkerHazard(-33.5, 192, 17, 32));
      addGate(0, 64, "#fb7185", -0.1, 0.9);
      addSpinner(-14, 111, "#facc15", 0.45, 0.96, 2.7);
      addSpinner(13, 151, "#38bdf8", -0.38, 0.96, -2.45, 0.8);
      addBumper(-4, 181, "#a78bfa", 0.9);
      addBumper(24, 94, "#22c55e", 0.76);
      const cartA = buildGolfCartObstacle(-12, 76, "#facc15");
      const cartB = buildGolfCartObstacle(16, 132, "#a78bfa");
      cartA.rotation.y = Math.PI / 2;
      cartB.rotation.y = Math.PI / 2;
      group.add(cartA, cartB);
      this.movingObstacles.push({ object: cartA, baseX: -12, amplitude: 25, speed: 1.15, phase: 0.1 });
      this.movingObstacles.push({ object: cartB, baseX: 16, amplitude: 18, speed: 1.35, phase: 2.1 });
      for (const [x, z, color, phase] of [
        [-39, 122, "#fb7185", 1.2],
        [40, 174, "#22c55e", 2.8]
      ] as const) {
        const mascot = buildMascotObstacle(x, z, color);
        mascot.rotation.y = x < 0 ? 0.65 : -0.65;
        group.add(mascot);
        this.movingObstacles.push({ object: mascot, baseX: x, amplitude: 6, speed: 1.8, phase });
      }
    }

    this.courseObstacleGroup = group;
    this.scene.add(group);
  }

  private activeAddressPlayer(): PocketGolfPlayerStatePayload | undefined {
    return this.state?.players.find((player) => player.active) ?? this.state?.players[0];
  }

  private directionToPinFrom(ball: { x: number; z: number }): THREE.Vector3 {
    const holeZ = this.state?.holeDistance ?? 112;
    const direction = new THREE.Vector3(-ball.x, 0, holeZ - ball.z);
    if (direction.lengthSq() < 0.0001) return new THREE.Vector3(0, 0, 1);
    return direction.normalize();
  }

  private addressFromBall(
    ball: { x: number; y: number; z: number },
    distanceToHole?: number,
    forwardOverride?: THREE.Vector3
  ): GolfAddressTransform {
    const forward = forwardOverride?.clone() ?? this.directionToPinFrom(ball);
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) forward.set(0, 0, 1);
    forward.normalize();
    const right = new THREE.Vector3(forward.z, 0, -forward.x).normalize();
    const ground = new THREE.Vector3(ball.x, ball.y, ball.z);
    const remaining = clamp(distanceToHole ?? Math.hypot(ball.x, (this.state?.holeDistance ?? 112) - ball.z), 4, 220);
    const golferPosition = ground.clone().addScaledVector(forward, -1.42).addScaledVector(right, -1.16);
    golferPosition.y = 0.08;
    const golferYaw = Math.atan2(-forward.x, -forward.z) + 0.16;
    const cameraBack = clamp(remaining * 0.12 + 8.4, 9.8, 21);
    const cameraHeight = clamp(remaining * 0.035 + 4.6, 5.1, 8.6);
    const lookAhead = clamp(remaining * 0.46, 14, 58);
    const cameraPosition = ground.clone().addScaledVector(forward, -cameraBack).addScaledVector(right, -5.8);
    cameraPosition.y += cameraHeight;
    const cameraTarget = ground.clone().addScaledVector(forward, lookAhead).addScaledVector(right, 0.35);
    cameraTarget.y += 1.1;

    return {
      ball: new THREE.Vector3(ball.x, ball.y + 0.26, ball.z),
      marker: new THREE.Vector3(ball.x, 0.085, ball.z),
      forward,
      right,
      golferPosition,
      golferYaw,
      cameraPosition,
      cameraTarget
    };
  }

  private syncAddress(address: GolfAddressTransform, immediate = true): void {
    if (this.ball) this.ball.position.copy(address.ball);
    if (this.ballMarker) this.ballMarker.position.copy(address.marker);
    this.addressGolferYaw = address.golferYaw;
    if (!this.golfer) return;
    if (immediate) {
      this.golfer.position.copy(address.golferPosition);
      this.golfer.rotation.set(0, address.golferYaw, 0);
      return;
    }
    this.golfer.position.lerp(address.golferPosition, 0.36);
    this.golfer.rotation.y = lerp(this.golfer.rotation.y, address.golferYaw, 0.36);
  }

  private syncAddressForPlayer(player: PocketGolfPlayerStatePayload, immediate = true): void {
    this.syncAddress(this.addressFromBall(player.ball, player.distanceToHole), immediate);
  }

  private syncAddressForShot(shot: PocketGolfShotPayload): void {
    const shotDirection = new THREE.Vector3(shot.end.x - shot.start.x, 0, shot.end.z - shot.start.z);
    const forward = shotDirection.lengthSq() > 0.0001 ? shotDirection.normalize() : this.directionToPinFrom(shot.start);
    const startDistance = this.state ? Math.hypot(shot.start.x, this.state.holeDistance - shot.start.z) : undefined;
    this.syncAddress(this.addressFromBall(shot.start, startDistance, forward), true);
  }

  private settleAtNextAddress(): void {
    const active = this.activeAddressPlayer();
    if (active) {
      this.syncGolfer(active.playerNumber);
      this.syncAddressForPlayer(active, true);
      this.updateCameraSetup(0.5);
      return;
    }
    const lastShot = this.state?.lastShot;
    if (lastShot) this.syncAddress(this.addressFromBall(lastShot.end, lastShot.stats.distanceToHole), true);
  }

  applyState(state: PocketGolfGameStatePayload): void {
    this.state = state;
    this.syncCourseForState(state);
    if (state.clubPose && state.clubPose.roundId === state.roundId && state.clubPose.turnId === state.turnId) {
      this.liveClubPose = state.clubPose;
    } else if (!state.clubPose || state.clubPose.turnId !== state.turnId) {
      this.liveClubPose = null;
    }
    const active = state.players.find((player) => player.active) ?? state.players[0];
    const incomingShot = state.lastShot?.sequence !== this.latestShotSequence ? state.lastShot : null;
    if (incomingShot) {
      this.syncGolfer(incomingShot.playerNumber);
      this.syncAddressForShot(incomingShot);
    } else if (!this.shot && active) {
      this.syncGolfer(active.playerNumber);
      this.syncAddressForPlayer(active, true);
    }
    if (incomingShot) {
      this.latestShotSequence = incomingShot.sequence;
      this.shot = {
        payload: incomingShot,
        startedAt: performance.now(),
        points: incomingShot.trajectory.map((point) => new THREE.Vector3(point.x, point.y + 0.26, point.z))
      };
      this.buildTrail(this.shot.points);
    }
    this.renderHud();
  }

  applyClubPose(pose: GolfClubPosePayload): void {
    if (!this.state) {
      this.liveClubPose = pose;
      return;
    }
    if (pose.roundId !== this.state.roundId || pose.turnId !== this.state.turnId || pose.playerNumber !== this.state.activePlayerNumber) return;
    this.liveClubPose = pose;
  }

  private activeClubPose(): GolfClubPosePayload | null {
    if (!this.state || !this.liveClubPose) return null;
    if (this.liveClubPose.roundId !== this.state.roundId || this.liveClubPose.turnId !== this.state.turnId) return null;
    if (this.liveClubPose.playerNumber !== this.state.activePlayerNumber) return null;
    return this.liveClubPose;
  }

  private freshClubPose(): GolfClubPosePayload | null {
    const pose = this.activeClubPose();
    return pose && Date.now() - pose.timestamp < 900 ? pose : null;
  }

  private displayAimDegrees(): number {
    const pose = this.activeClubPose();
    return typeof pose?.aimDegrees === "number" ? pose.aimDegrees : this.state?.aimDegrees ?? 0;
  }

  private updateScreenAimGuide(visible: boolean, aimDegrees = 0): void {
    const guide = this.hud?.querySelector<HTMLElement>(".golf-screen-aim-guide");
    if (!guide) return;
    guide.classList.toggle("is-visible", visible);
    guide.style.setProperty("--aim-angle", `${aimDegrees}deg`);
  }

  private updateAimGuide(timestamp: number): void {
    if (!this.aimGuide || !this.state) return;
    const pose = this.activeClubPose();
    const active = this.state.players.find((player) => player.active) ?? this.state.players[0];
    const visible = Boolean(active && pose?.armed && !this.shot);
    this.aimGuide.visible = visible;
    const aim = visible ? this.displayAimDegrees() : 0;
    this.updateScreenAimGuide(visible, aim);
    if (!visible || !active) return;

    const address = this.addressFromBall(active.ball, active.distanceToHole);
    const distance = clamp(active.distanceToHole, 0.5, 220);
    const distanceScale = clamp01(distance / 72);
    const length = clamp(2.2 + distance * lerp(0.26, 0.5, distanceScale), 2.4, 58);
    const guideWidth = lerp(0.48, 1, clamp01(distance / 48));
    const arcHeight = lerp(0.16, 1.55, clamp01(distance / 52));
    const dotCount = Math.round(clamp(4 + distance / 8, 4, this.aimGuideDots.length));
    const startOffset = clamp(distance * 0.12, 0.55, 2);
    this.aimGuide.position.copy(new THREE.Vector3(active.ball.x, active.ball.y + 0.12, active.ball.z).addScaledVector(address.forward, startOffset));
    this.aimGuide.rotation.y = Math.atan2(address.forward.x, address.forward.z) + degToRad(aim);

    const pulse = 0.85 + Math.sin(timestamp * 0.008) * 0.15;
    if (this.aimGuideGlow) {
      this.aimGuideGlow.position.z = length / 2;
      this.aimGuideGlow.position.y = 0.14 + pulse * 0.022;
      this.aimGuideGlow.scale.set(guideWidth, length, guideWidth);
      const material = this.aimGuideGlow.material as THREE.MeshBasicMaterial;
      material.opacity = 0.18 + pulse * 0.08;
    }
    if (this.aimGuideLine) {
      this.aimGuideLine.position.z = length / 2;
      this.aimGuideLine.position.y = 0.24 + pulse * 0.02;
      this.aimGuideLine.scale.set(guideWidth, length, guideWidth);
      const material = this.aimGuideLine.material as THREE.MeshBasicMaterial;
      material.opacity = 0.68 + pulse * 0.14;
    }
    this.aimGuideDots.forEach((dot, index) => {
      dot.visible = index < dotCount;
      if (!dot.visible) return;
      const t = (index + 1) / (dotCount + 1);
      dot.position.set(0, 0.28 + Math.sin(t * Math.PI) * arcHeight + Math.sin(timestamp * 0.006 + index) * 0.028, length * t);
      dot.scale.setScalar((0.34 + guideWidth * 0.34 + t * 0.28) * pulse);
      const material = dot.material as THREE.MeshBasicMaterial;
      material.opacity = 0.5 + t * 0.38;
    });
    if (this.aimGuideArrow) {
      this.aimGuideArrow.position.z = length;
      this.aimGuideArrow.position.y = 0.34 + arcHeight * 0.16 + pulse * 0.04;
      this.aimGuideArrow.scale.setScalar(lerp(0.38, 0.82, guideWidth) * pulse);
    }
  }

  render(timestamp: number): void {
    if (!this.scene || !this.camera || !this.renderer) return;
    const seconds = timestamp / 1000;
    this.clouds.forEach((cloud, index) => {
      cloud.position.x += Math.sin(seconds * 0.12 + index) * 0.004;
      cloud.position.z += 0.004;
      if (cloud.position.z > 250) cloud.position.z = 35;
    });
    this.airborneDecor.forEach((item, index) => {
      item.position.y += Math.sin(seconds * 0.9 + index) * 0.002;
      item.rotation.y += 0.0008 + index * 0.0002;
    });
    this.movingObstacles.forEach((item) => {
      item.object.position.x = item.baseX + Math.sin(seconds * item.speed + item.phase) * item.amplitude;
      item.object.position.y = 0.03 + Math.abs(Math.sin(seconds * item.speed + item.phase)) * 0.05;
    });
    this.spinningObstacles.forEach((item) => {
      item.object.rotation.y = seconds * item.speed + item.phase;
    });
    if (this.ocean) this.ocean.position.y = -0.08 + Math.sin(seconds * 1.1) * 0.012;
    if (this.flag) this.flag.rotation.z = Math.sin(seconds * 3.4) * 0.06;
    if (this.shot) this.renderShot(timestamp);
    else this.updateCameraSetup(0.08);
    this.updateAimGuide(timestamp);
    this.animateGolfer(timestamp);
    this.renderer.render(this.scene, this.camera);
  }

  private renderShot(timestamp: number): void {
    if (!this.shot || !this.ball) return;
    const elapsed = (timestamp - this.shot.startedAt) / 1000;
    const impactDelay = 0.48;
    const flightDuration = Math.max(2.2, Math.min(7.5, this.shot.payload.stats.totalDistance / 34));
    if (elapsed < impactDelay) {
      this.ball.position.copy(this.shot.points[0] ?? new THREE.Vector3());
      if (this.ballMarker) this.ballMarker.position.set(this.ball.position.x, 0.085, this.ball.position.z);
      this.updateImpactCamera(clamp01(elapsed / impactDelay));
      return;
    }
    const t = clamp01((elapsed - impactDelay) / flightDuration);
    const position = sampleTrajectory(this.shot.points, t);
    this.ball.position.copy(position);
    if (this.ballMarker) this.ballMarker.position.set(position.x, 0.085, position.z);
    this.updateChaseCamera(position, t);
    if (t >= 1 && !this.shot.finishing) {
      this.shot.finishing = true;
      window.setTimeout(() => {
        this.shot = null;
        this.settleAtNextAddress();
        this.renderHud();
      }, 900);
    }
  }

  private syncGolfer(playerNumber: number): void {
    if (!this.scene || this.activeGolferPlayerNumber === playerNumber) return;
    const player = this.room.players.find((item) => item.playerNumber === playerNumber);
    if (this.golfer) {
      this.scene.remove(this.golfer);
      disposeObject(this.golfer);
    }
    this.golfer = buildGolfer(player?.color ?? "#22d3ee", Math.max(0, playerNumber - 1));
    this.golfer.position.set(-1.65, 0.08, -1.25);
    this.golfer.rotation.y = -0.08;
    this.golfer.scale.setScalar(1.36);
    this.scene.add(this.golfer);
    this.club = this.golfer.getObjectByName("club") ?? null;
    this.activeGolferPlayerNumber = playerNumber;
    if (this.liveClubPose?.playerNumber !== playerNumber) this.liveClubPose = null;
  }

  private animateGolfer(timestamp: number): void {
    if (!this.golfer || !this.club) return;
    const neutralClubY = 1.18;
    const shotElapsed = this.shot ? (timestamp - this.shot.startedAt) / 1000 : 0;
    if (!this.shot) {
      const pose = this.activeClubPose();
      const poseFresh = pose && Date.now() - pose.timestamp < 1800 && pose.playerNumber === this.activeGolferPlayerNumber;
      if (poseFresh) {
        const handed = pose.handedness === "left" ? -1 : 1;
        const swingT = clamp01((pose.swing + 1) / 2);
        const targetZ = lerp(-1.28, 1.36, swingT) + pose.pitch * 0.32;
        const targetX = -0.24 + pose.roll * 0.78 * handed;
        const targetY = pose.yaw * 0.58 * handed;
        const speedKick = pose.armed ? pose.velocity * 0.34 : pose.velocity * 0.12;
        this.club.rotation.x = lerp(this.club.rotation.x, clamp(targetX, -1.05, 0.9), 0.38);
        this.club.rotation.y = lerp(this.club.rotation.y, clamp(targetY, -0.92, 0.92), 0.38);
        this.club.rotation.z = lerp(this.club.rotation.z, clamp(targetZ + speedKick, -1.42, 1.56), 0.4);
        this.club.position.y = lerp(this.club.position.y, neutralClubY + Math.abs(pose.swing) * 0.12 + pose.velocity * 0.16, 0.28);
        this.golfer.rotation.y = lerp(this.golfer.rotation.y, this.addressGolferYaw + clamp(pose.yaw * 0.16 * handed, -0.18, 0.18), 0.22);
        this.golfer.rotation.z = lerp(this.golfer.rotation.z, clamp(-pose.roll * 0.12 * handed - pose.velocity * 0.07, -0.24, 0.24), 0.22);
        this.golfer.rotation.x = lerp(this.golfer.rotation.x, clamp(-pose.pitch * 0.09, -0.14, 0.14), 0.22);
        return;
      }
      this.golfer.rotation.x = lerp(this.golfer.rotation.x, 0, 0.08);
      this.golfer.rotation.y = lerp(this.golfer.rotation.y, this.addressGolferYaw, 0.08);
      this.golfer.rotation.z = lerp(this.golfer.rotation.z, Math.sin(timestamp * 0.002) * 0.012, 0.08);
      this.club.rotation.x = lerp(this.club.rotation.x, 0, 0.12);
      this.club.rotation.y = lerp(this.club.rotation.y, 0, 0.12);
      this.club.rotation.z = lerp(this.club.rotation.z, -0.24 + Math.sin(timestamp * 0.003) * 0.03, 0.12);
      this.club.position.y = lerp(this.club.position.y, neutralClubY, 0.12);
      return;
    }
    const swing = clamp01(shotElapsed / 0.9);
    this.golfer.rotation.z = Math.sin(swing * Math.PI) * -0.09;
    this.golfer.rotation.x = 0;
    this.club.rotation.x = lerp(this.club.rotation.x, 0, 0.24);
    this.club.rotation.y = lerp(this.club.rotation.y, 0, 0.24);
    this.club.rotation.z = lerp(-0.95, 1.25, Math.min(1, swing * 1.25));
    this.club.position.y = lerp(this.club.position.y, neutralClubY, 0.2);
  }

  private updateCameraSetup(alpha: number): void {
    if (!this.camera) return;
    const active = this.activeAddressPlayer();
    const address = active ? this.addressFromBall(active.ball, active.distanceToHole) : this.addressFromBall({ x: 0, y: 0.042, z: 0 }, 112);
    this.camera.position.lerp(address.cameraPosition, alpha);
    this.camera.lookAt(address.cameraTarget);
  }

  private updateImpactCamera(t: number): void {
    if (!this.camera) return;
    const start = this.shot?.points[0] ?? new THREE.Vector3(0, 0.3, 0);
    const next = this.shot?.points[Math.min(5, Math.max(0, (this.shot?.points.length ?? 1) - 1))] ?? start.clone().add(new THREE.Vector3(0, 0, 1));
    const forward = next.clone().sub(start);
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) forward.copy(this.directionToPinFrom({ x: start.x, z: start.z }));
    forward.normalize();
    const right = new THREE.Vector3(forward.z, 0, -forward.x).normalize();
    const desired = start
      .clone()
      .addScaledVector(forward, lerp(-9.5, -5.8, t))
      .addScaledVector(right, lerp(-5.6, -3.4, t));
    desired.y += lerp(5.6, 3.5, t);
    const target = start.clone().addScaledVector(forward, lerp(1.8, 9, t));
    target.y = lerp(1, 1.5, t);
    this.camera.position.lerp(desired, 0.18);
    this.camera.lookAt(target);
  }

  private updateChaseCamera(position: THREE.Vector3, t: number): void {
    if (!this.camera) return;
    const next = this.shot ? sampleTrajectory(this.shot.points, Math.min(1, t + 0.025)) : position.clone().add(new THREE.Vector3(0, 0, 1));
    const velocity = next.clone().sub(position).normalize();
    if (!Number.isFinite(velocity.x)) velocity.set(0, 0, 1);
    const highFlight = position.y > 16;
    const desired = position.clone().sub(velocity.multiplyScalar(highFlight ? 18 : 9)).add(new THREE.Vector3(0, highFlight ? 10 : 4.2, 0));
    this.camera.position.lerp(desired, 0.08);
    const forwardLook = next.clone().sub(position);
    forwardLook.y = 0;
    if (forwardLook.lengthSq() < 0.0001) forwardLook.set(0, 0, 1);
    forwardLook.normalize();
    this.camera.lookAt(position.clone().addScaledVector(forwardLook, 7).add(new THREE.Vector3(0, 1.3, 0)));
  }

  private buildTrail(points: THREE.Vector3[]): void {
    if (!this.scene) return;
    if (this.trail) {
      this.scene.remove(this.trail);
      this.trail.geometry.dispose();
      (this.trail.material as THREE.Material).dispose();
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.72 });
    this.trail = new THREE.Line(geometry, material);
    this.scene.add(this.trail);
  }

  private renderHud(): void {
    if (!this.hud || !this.state) return;
    const state = this.state;
    const active = state.players.find((player) => player.active) ?? state.players[0];
    const club = clubById(state.clubId);
    const last = state.lastShot;
    const displayAim = this.displayAimDegrees();
    this.hud.innerHTML = `
      <section class="golf-hud-panel golf-hud-left">
        <p>Cloudshore Golf Resort</p>
        <h1>Hole ${state.holeNumber} · ${state.holeName}</h1>
        <span>${state.holeDifficulty} · Par ${state.par} · ${Math.round(state.holeDistance)} m</span>
      </section>
      <section class="golf-hud-panel golf-hud-right">
        <p>${active?.displayName ?? "Waiting"}</p>
        <h2>${club.displayName}</h2>
        <span>${Math.round(active?.distanceToHole ?? 0)} m to pin · ${active?.lie ?? "tee"}</span>
        <span>Wind ${state.wind.speed} km/h · ${state.wind.directionDegrees}°</span>
      </section>
      <section class="golf-aim-strip">
        <i style="--aim-offset:${displayAim * 4}px"></i>
        <span>Aim ${displayAim.toFixed(1)}° · Recommended ${clubById(state.recommendedClubId).displayName}</span>
      </section>
      ${
        last
          ? `<section class="golf-shot-card">
              <strong>${last.stats.timingLabel}</strong>
              <span>Carry ${Math.round(last.stats.carryDistance)} m</span>
              <span>Roll ${Math.round(last.stats.rollDistance)} m</span>
              <span>Total ${Math.round(last.stats.totalDistance)} m</span>
              <span>Remaining ${Math.round(last.stats.distanceToHole)} m</span>
            </section>`
          : ""
      }
    `;
  }

  private onResize = (): void => {
    if (!this.container || !this.renderer || !this.camera) return;
    const width = this.container.clientWidth;
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  destroy(): void {
    window.removeEventListener("resize", this.onResize);
    if (this.scene) disposeObject(this.scene);
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.container?.classList.remove("pocket-golf-viewport");
    this.container = null;
    this.hud = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
  }
}
