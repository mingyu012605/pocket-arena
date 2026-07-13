import * as THREE from "three";
import { TEST_OVAL_TRACK, centerlinePoint, centerlineTangentAngle } from "../../../../shared/racingTrack";
import { buildSponsorTexture } from "./track";

const racingKeyArtUrl = new URL("../../assets/launcher/card-racing.webp", import.meta.url).href;

function buildCrowdTexture(seed = 0): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const colors = ["#f97316", "#22c55e", "#38bdf8", "#ec4899", "#facc15", "#a855f7", "#ffffff"];
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, "#1d4ed8");
  sky.addColorStop(1, "#0f172a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let row = 0; row < 5; row++) {
    const y = 38 + row * 38;
    ctx.fillStyle = row % 2 === 0 ? "rgba(255,255,255,.16)" : "rgba(15,23,42,.35)";
    ctx.fillRect(0, y + 16, canvas.width, 12);
    for (let i = 0; i < 70; i++) {
      const x = ((i * 37 + row * 19 + seed * 23) % canvas.width) + 5;
      const color = colors[(i + row + seed) % colors.length]!;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 8 + ((i + row) % 4), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(x - 7, y + 8, 14, 17);
      if ((i + row + seed) % 5 === 0) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x - 11, y + 12);
        ctx.lineTo(x - 22, y - 4);
        ctx.moveTo(x + 11, y + 12);
        ctx.lineTo(x + 22, y - 4);
        ctx.stroke();
      }
    }
  }
  ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.font = "900 32px Arial";
  ctx.textAlign = "center";
  ctx.fillText("RALLY CROWD", canvas.width / 2, 232);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function buildFenceTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.strokeStyle = "rgba(226,232,240,0.8)";
  ctx.lineWidth = 2;
  for (let x = -64; x < canvas.width + 64; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 64, canvas.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, canvas.height);
    ctx.lineTo(x + 64, 0);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 1);
  return texture;
}

/**
 * Sponsor boards on the "left" side of the track are rotated an extra 180deg
 * so their front faces the road (matching the right-side boards' inward
 * orientation). A DoubleSide material renders the same UV mapping on both
 * faces, so after that flip the camera sees the texture's back - which reads
 * as mirrored text. Flipping the U coordinate on that texture instance
 * un-mirrors it without touching the rotation math used to aim every other
 * trackside prop.
 */
function mirrorTextureU(texture: THREE.CanvasTexture): THREE.CanvasTexture {
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.x = -1;
  return texture;
}

function buildMarshals(density: number): THREE.Group {
  const group = new THREE.Group();
  const halfWidth = TEST_OVAL_TRACK.trackHalfWidth;
  const skinMaterial = new THREE.MeshStandardMaterial({ color: "#f5c9a0", roughness: 0.7 });
  const vestMaterial = new THREE.MeshStandardMaterial({ color: "#f97316", roughness: 0.55, emissive: "#7c2d12", emissiveIntensity: 0.08 });
  const legMaterial = new THREE.MeshStandardMaterial({ color: "#1e293b", roughness: 0.6 });
  const flagMaterial = new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.4, side: THREE.DoubleSide });
  const poleMaterial = new THREE.MeshStandardMaterial({ color: "#334155", roughness: 0.4, metalness: 0.2 });

  const marshalCount = Math.max(4, Math.round(9 * density));
  for (let i = 0; i < marshalCount; i++) {
    const progress = ((i + 0.6) / marshalCount) * TEST_OVAL_TRACK.trackLength;
    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const side = i % 2 === 0 ? 1 : -1;
    const marshal = new THREE.Group();

    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.9, 8), legMaterial);
    legs.position.y = 0.45;
    marshal.add(legs);
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.7, 8), vestMaterial);
    torso.position.y = 1.25;
    marshal.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), skinMaterial);
    head.position.y = 1.72;
    marshal.add(head);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 6), poleMaterial);
    pole.position.set(0.22, 1.3, 0);
    marshal.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.34), flagMaterial);
    flag.position.set(0.5, 1.85, 0);
    marshal.add(flag);

    marshal.position.set(center.x + nx * side * (halfWidth + 4.4), 0, center.z + nz * side * (halfWidth + 4.4));
    marshal.rotation.y = -angle + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
    group.add(marshal);
  }
  return group;
}

function buildFencing(density: number): THREE.InstancedMesh {
  const halfWidth = TEST_OVAL_TRACK.trackHalfWidth;
  const geometry = new THREE.PlaneGeometry(4.4, 1.6);
  const material = new THREE.MeshBasicMaterial({
    map: buildFenceTexture(),
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const segmentsPerSide = Math.max(20, Math.round(44 * density));
  const mesh = new THREE.InstancedMesh(geometry, material, segmentsPerSide * 2);
  const matrix = new THREE.Matrix4();
  let index = 0;
  for (let i = 0; i < segmentsPerSide; i++) {
    const progress = (i / segmentsPerSide) * TEST_OVAL_TRACK.trackLength;
    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    for (const side of [-1, 1]) {
      const offset = side * (halfWidth + 3.1);
      matrix.compose(
        new THREE.Vector3(center.x + nx * offset, 1.05, center.z + nz * offset),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -angle, 0)),
        new THREE.Vector3(1, 1, 1)
      );
      mesh.setMatrixAt(index, matrix);
      index += 1;
    }
  }
  return mesh;
}

export function buildHarborEnvironment(density: number): THREE.Group {
  const group = new THREE.Group();
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(360, 150),
    new THREE.MeshStandardMaterial({ color: "#38bdf8", roughness: 0.48, metalness: 0.08, emissive: "#0ea5e9", emissiveIntensity: 0.08 })
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.035, 70);
  group.add(water);

  const buildingMaterial = new THREE.MeshStandardMaterial({ color: "#bfdbfe", roughness: 0.7, metalness: 0.02 });
  const windowMaterial = new THREE.MeshBasicMaterial({ color: "#fff7ed" });
  const count = Math.max(8, Math.round(22 * density));
  for (let i = 0; i < count; i++) {
    const height = 8 + ((i * 17) % 26);
    const width = 5 + (i % 4);
    const building = new THREE.Mesh(new THREE.BoxGeometry(width, height, 7), buildingMaterial);
    building.position.set(-125 + i * (250 / count), height / 2 - 0.02, -245 - (i % 3) * 9);
    building.castShadow = true;
    building.receiveShadow = true;
    group.add(building);
    const windows = new THREE.Mesh(new THREE.BoxGeometry(width * 0.78, height * 0.72, 0.04), windowMaterial);
    windows.position.set(building.position.x, height * 0.54, building.position.z + 3.52);
    group.add(windows);
  }

  const grandstandMaterial = new THREE.MeshStandardMaterial({ color: "#2563eb", roughness: 0.48, metalness: 0.08 });
  for (const side of [-1, 1]) {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(38, 5, 7), grandstandMaterial);
    stand.position.set(side * 54, 2.5, -22);
    stand.rotation.y = side * 0.28;
    stand.castShadow = true;
    group.add(stand);
    const crowd = new THREE.Mesh(
      new THREE.PlaneGeometry(36, 7.2),
      new THREE.MeshBasicMaterial({ map: buildCrowdTexture(side > 0 ? 1 : 2), side: THREE.DoubleSide })
    );
    crowd.position.set(side * 54, 6.5, -18.3);
    crowd.rotation.y = stand.rotation.y;
    group.add(crowd);
  }

  const foregroundStandMaterial = new THREE.MeshStandardMaterial({ color: "#2563eb", roughness: 0.48, metalness: 0.06 });
  const foregroundSeatMaterial = new THREE.MeshBasicMaterial({ color: "#fbbf24" });
  const foregroundCrowdColors = ["#f97316", "#22c55e", "#38bdf8", "#ec4899", "#facc15"];
  const foregroundStand = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(46, 7, 10), foregroundStandMaterial);
  base.position.set(0, 3.5, 0);
  foregroundStand.add(base);
  for (let row = 0; row < 4; row++) {
    const seats = new THREE.Mesh(new THREE.BoxGeometry(42, 0.5, 0.7), foregroundSeatMaterial);
    seats.position.set(0, 4.6 + row * 0.65, -3.5 + row * 1.8);
    foregroundStand.add(seats);
    for (let i = 0; i < 14; i++) {
      const fan = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 8, 6),
        new THREE.MeshBasicMaterial({ color: foregroundCrowdColors[(i + row) % foregroundCrowdColors.length]! })
      );
      fan.position.set(-19 + i * 2.9, 5.1 + row * 0.65, -3.1 + row * 1.8);
      foregroundStand.add(fan);
    }
  }
  foregroundStand.position.set(48, 0, -28);
  foregroundStand.rotation.y = -0.48;
  const foregroundCrowd = new THREE.Mesh(
    new THREE.PlaneGeometry(43, 10),
    new THREE.MeshBasicMaterial({ map: buildCrowdTexture(7), side: THREE.DoubleSide })
  );
  foregroundCrowd.position.set(0, 7.7, -1.8);
  foregroundCrowd.rotation.x = -0.04;
  foregroundStand.add(foregroundCrowd);
  group.add(foregroundStand);

  const megaStandMaterial = new THREE.MeshStandardMaterial({ color: "#1e40af", roughness: 0.45, metalness: 0.12 });
  for (const [x, z, rotationY, seed] of [
    [-88, -70, 0.42, 11],
    [88, -120, -0.42, 13]
  ] as const) {
    const stand = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(58, 12, 16), megaStandMaterial);
    base.position.set(0, 6, 0);
    stand.add(base);
    const crowd = new THREE.Mesh(
      new THREE.PlaneGeometry(56, 13),
      new THREE.MeshBasicMaterial({ map: buildCrowdTexture(seed), side: THREE.DoubleSide })
    );
    crowd.position.set(0, 12.8, -8.2);
    stand.add(crowd);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(64, 1.2, 20), new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.32, metalness: 0.04 }));
    roof.position.set(0, 20, -2);
    roof.rotation.x = 0.16;
    stand.add(roof);
    stand.position.set(x, 0, z);
    stand.rotation.y = rotationY;
    group.add(stand);
  }

  const boardMaterial = new THREE.MeshStandardMaterial({ color: "#fb7185", roughness: 0.42 });
  const poleMaterial = new THREE.MeshStandardMaterial({ color: "#0f766e", roughness: 0.38, metalness: 0.12 });
  for (let i = 0; i < Math.round(18 * density); i++) {
    const progress = (i / 18) * TEST_OVAL_TRACK.trackLength;
    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const side = i % 2 === 0 ? 1 : -1;
    const board = new THREE.Mesh(new THREE.BoxGeometry(5.2, 1.35, 0.16), boardMaterial);
    board.position.set(center.x + nx * side * 11, 1.35, center.z + nz * side * 11);
    board.rotation.y = -angle;
    group.add(board);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 8), poleMaterial);
    pole.position.set(board.position.x, 1.6, board.position.z);
    group.add(pole);
  }

  const palmTrunkMaterial = new THREE.MeshStandardMaterial({ color: "#b45309", roughness: 0.8 });
  const palmLeafMaterial = new THREE.MeshStandardMaterial({ color: "#22c55e", roughness: 0.82 });
  const palmCount = Math.round(16 * density);
  for (let i = 0; i < palmCount; i++) {
    const jitterX = ((i * 53) % 11) - 5;
    const jitterZ = ((i * 29) % 9) - 4;
    const x = -120 + i * 16 + jitterX;
    const z = (i % 2 === 0 ? 34 : -228) + jitterZ;
    const scale = 0.85 + ((i * 7) % 5) * 0.08;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 6, 8), palmTrunkMaterial);
    trunk.scale.set(scale, scale, scale);
    trunk.position.set(x, 3 * scale, z);
    group.add(trunk);
    const leaves = new THREE.Group();
    for (let j = 0; j < 5; j++) {
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 4.8), palmLeafMaterial);
      leaf.position.y = 6.25 * scale;
      leaf.rotation.y = (j / 5) * Math.PI * 2 + (i % 4) * 0.15;
      leaf.rotation.x = 0.36;
      leaves.add(leaf);
    }
    leaves.position.set(x, 0, z);
    leaves.scale.set(scale, scale, scale);
    group.add(leaves);
  }

  group.add(buildKeyArtBackdrop());

  return group;
}

export function buildTracksideDetails(density: number): THREE.Group {
  const group = new THREE.Group();
  const halfWidth = TEST_OVAL_TRACK.trackHalfWidth;
  const matrix = new THREE.Matrix4();

  const coneCount = Math.max(24, Math.round(64 * density));
  const coneGeometry = new THREE.CylinderGeometry(0.06, 0.3, 0.82, 12);
  const coneMaterial = new THREE.MeshStandardMaterial({ color: "#fb6b21", roughness: 0.5, metalness: 0.02, emissive: "#7c2d12", emissiveIntensity: 0.08 });
  const cones = new THREE.InstancedMesh(coneGeometry, coneMaterial, coneCount);
  for (let i = 0; i < coneCount; i++) {
    const progress = (i / coneCount) * TEST_OVAL_TRACK.trackLength;
    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const side = i % 2 === 0 ? 1 : -1;
    matrix.compose(
      new THREE.Vector3(center.x + nx * side * (halfWidth + 3.2), 0.42, center.z + nz * side * (halfWidth + 3.2)),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -angle, 0)),
      new THREE.Vector3(1, 1, 1)
    );
    cones.setMatrixAt(i, matrix);
  }
  group.add(cones);

  const stackCount = Math.max(10, Math.round(18 * density));
  const tireGeometry = new THREE.CylinderGeometry(0.62, 0.62, 0.28, 18);
  const tireMaterial = new THREE.MeshStandardMaterial({ color: "#111827", roughness: 0.74, metalness: 0.02 });
  const tires = new THREE.InstancedMesh(tireGeometry, tireMaterial, stackCount * 3);
  let tireIndex = 0;
  for (let i = 0; i < stackCount; i++) {
    const progress = ((i + 0.35) / stackCount) * TEST_OVAL_TRACK.trackLength;
    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const side = i % 2 === 0 ? 1 : -1;
    for (let stack = 0; stack < 3; stack++) {
      matrix.compose(
        new THREE.Vector3(center.x + nx * side * (halfWidth + 5.3), 0.18 + stack * 0.28, center.z + nz * side * (halfWidth + 5.3)),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, -angle, 0)),
        new THREE.Vector3(1, 1, 1)
      );
      tires.setMatrixAt(tireIndex, matrix);
      tireIndex += 1;
    }
  }
  group.add(tires);

  const boardSpecs = [
    ["BOOST", "#f97316", "#0f172a"],
    ["TILT", "#38bdf8", "#1d4ed8"],
    ["RALLY", "#facc15", "#7c3aed"],
    ["PHONE POWER", "#22c55e", "#0f766e"],
    ["ARENA", "#ec4899", "#be123c"],
    ["GO!", "#ffffff", "#f97316"]
  ] as const;
  for (let i = 0; i < boardSpecs.length; i++) {
    const [title, accent, bg] = boardSpecs[i]!;
    const progress = ((i + 0.5) / boardSpecs.length) * TEST_OVAL_TRACK.trackLength;
    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const side = i % 2 === 0 ? 1 : -1;
    const texture = buildSponsorTexture(title, accent, bg);
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(9.5, 3),
      new THREE.MeshBasicMaterial({ map: side < 0 ? mirrorTextureU(texture) : texture, side: THREE.DoubleSide })
    );
    board.position.set(center.x + nx * side * (halfWidth + 8.2), 2.5, center.z + nz * side * (halfWidth + 8.2));
    board.rotation.y = -angle + (side > 0 ? -0.22 : Math.PI + 0.22);
    group.add(board);
  }

  const poleMaterial = new THREE.MeshStandardMaterial({ color: "#164e63", roughness: 0.36, metalness: 0.2 });
  const lampMaterial = new THREE.MeshBasicMaterial({ color: "#fff7ad" });
  for (let i = 0; i < Math.round(10 * density); i++) {
    const progress = (i / 10) * TEST_OVAL_TRACK.trackLength + 14;
    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const side = i % 2 === 0 ? 1 : -1;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 8, 10), poleMaterial);
    pole.position.set(center.x + nx * side * (halfWidth + 7), 4, center.z + nz * side * (halfWidth + 7));
    group.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), lampMaterial);
    lamp.position.set(pole.position.x, 8.1, pole.position.z);
    group.add(lamp);
  }

  group.add(buildFencing(density));
  group.add(buildMarshals(density));

  return group;
}

function buildKeyArtBackdrop(): THREE.Group {
  const group = new THREE.Group();
  const texture = new THREE.TextureLoader().load(racingKeyArtUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  const screenSpecs: Array<[number, number, number, number, number]> = [
    [42, 22, -46, -0.72, 44],
    [-58, 22, -82, 0.34, 58],
    [62, 19, -132, -0.36, 48],
    [-92, 18, -178, 0.42, 46]
  ];

  const frameMaterial = new THREE.MeshStandardMaterial({ color: "#0f6fcb", roughness: 0.35, metalness: 0.18 });
  for (const [x, y, z, rotationY, width] of screenSpecs) {
    const height = width * 0.5625;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    board.position.set(x, y, z);
    board.rotation.y = rotationY;
    group.add(board);

    const top = new THREE.Mesh(new THREE.BoxGeometry(width + 2, 0.8, 0.8), frameMaterial);
    const bottom = top.clone();
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.8, height + 2, 0.8), frameMaterial);
    const right = left.clone();
    top.position.set(x, y + height / 2 + 0.8, z);
    bottom.position.set(x, y - height / 2 - 0.8, z);
    left.position.set(x - width / 2 - 0.8, y, z);
    right.position.set(x + width / 2 + 0.8, y, z);
    for (const item of [top, bottom, left, right]) item.rotation.y = rotationY;
    group.add(top, bottom, left, right);
  }
  return group;
}

export function buildSkyDome(): THREE.Group {
  const group = new THREE.Group();
  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = 64;
  skyCanvas.height = 512;
  const skyCtx = skyCanvas.getContext("2d")!;
  const skyGradient = skyCtx.createLinearGradient(0, 0, 0, skyCanvas.height);
  skyGradient.addColorStop(0, "#38bdf8");
  skyGradient.addColorStop(0.44, "#b9f2ff");
  skyGradient.addColorStop(1, "#f8fbff");
  skyCtx.fillStyle = skyGradient;
  skyCtx.fillRect(0, 0, skyCanvas.width, skyCanvas.height);
  const skyTexture = new THREE.CanvasTexture(skyCanvas);
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide })
  );
  group.add(dome);

  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(24, 48),
    new THREE.MeshBasicMaterial({ color: "#fde68a", transparent: true, opacity: 0.92, side: THREE.DoubleSide })
  );
  sun.position.set(-145, 110, -350);
  sun.rotation.y = 0.3;
  group.add(sun);

  const mountainMaterial = new THREE.MeshBasicMaterial({ color: "#7dd3fc", transparent: true, opacity: 0.42, side: THREE.DoubleSide });
  for (let i = 0; i < 8; i++) {
    const mountain = new THREE.Mesh(new THREE.ConeGeometry(22 + (i % 3) * 9, 38 + (i % 4) * 8, 4), mountainMaterial);
    mountain.position.set(-170 + i * 48, 18, -330 - (i % 2) * 18);
    mountain.rotation.y = Math.PI / 4;
    mountain.scale.z = 0.62;
    group.add(mountain);
  }

  const cloudMaterial = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95, transparent: true, opacity: 0.9 });
  for (let i = 0; i < 18; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + (i % 3);
    for (let j = 0; j < puffs; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(3 + ((i + j) % 3), 12, 8), cloudMaterial);
      puff.scale.set(1.8, 0.42, 0.8);
      puff.position.set(j * 4.2, 0, (j % 2) * 1.4);
      cloud.add(puff);
    }
    cloud.position.set(-160 + i * 19, 42 + (i % 5) * 4, -260 - (i % 4) * 22);
    cloud.rotation.y = (i % 3) * 0.2;
    group.add(cloud);
  }
  return group;
}

export function buildConfettiField(count: number): THREE.InstancedMesh {
  const geometry = new THREE.PlaneGeometry(0.28, 0.75);
  const material = new THREE.MeshBasicMaterial({ color: "#ffffff", side: THREE.DoubleSide, vertexColors: true });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const matrix = new THREE.Matrix4();
  const colors = ["#f97316", "#facc15", "#22c55e", "#38bdf8", "#ec4899", "#8b5cf6"];
  for (let i = 0; i < count; i++) {
    const x = -120 + Math.random() * 240;
    const y = 5 + Math.random() * 40;
    const z = -250 + Math.random() * 210;
    matrix.compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)),
      new THREE.Vector3(1, 1, 1)
    );
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, new THREE.Color(colors[i % colors.length]!));
  }
  return mesh;
}
