import * as THREE from "three";
import { TEST_OVAL_TRACK, centerlinePoint, centerlineTangentAngle } from "../../../../shared/racingTrack";
import { buildSponsorTexture } from "./track";

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
  const legsMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.18, 0.9, 8), legMaterial, marshalCount);
  const torsoMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.2, 0.7, 8), vestMaterial, marshalCount);
  const headMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 10, 8), skinMaterial, marshalCount);
  const poleMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 6), poleMaterial, marshalCount);
  const flagMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.5, 0.34), flagMaterial, marshalCount);

  const bodyMatrix = new THREE.Matrix4();
  const localMatrix = new THREE.Matrix4();
  const instanceMatrix = new THREE.Matrix4();
  const identityScale = new THREE.Vector3(1, 1, 1);
  const parts: Array<{ mesh: THREE.InstancedMesh; localPosition: THREE.Vector3 }> = [
    { mesh: legsMesh, localPosition: new THREE.Vector3(0, 0.45, 0) },
    { mesh: torsoMesh, localPosition: new THREE.Vector3(0, 1.25, 0) },
    { mesh: headMesh, localPosition: new THREE.Vector3(0, 1.72, 0) },
    { mesh: poleMesh, localPosition: new THREE.Vector3(0.22, 1.3, 0) },
    { mesh: flagMesh, localPosition: new THREE.Vector3(0.5, 1.85, 0) }
  ];

  for (let i = 0; i < marshalCount; i++) {
    const progress = ((i + 0.6) / marshalCount) * TEST_OVAL_TRACK.trackLength;
    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const side = i % 2 === 0 ? 1 : -1;
    const marshalRotationY = -angle + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
    const marshalQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, marshalRotationY, 0));
    bodyMatrix.compose(
      new THREE.Vector3(center.x + nx * side * (halfWidth + 4.4), 0, center.z + nz * side * (halfWidth + 4.4)),
      marshalQuaternion,
      identityScale
    );
    for (const part of parts) {
      localMatrix.makeTranslation(part.localPosition.x, part.localPosition.y, part.localPosition.z);
      instanceMatrix.multiplyMatrices(bodyMatrix, localMatrix);
      part.mesh.setMatrixAt(i, instanceMatrix);
    }
  }
  group.add(legsMesh, torsoMesh, headMesh, poleMesh, flagMesh);
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

function buildVenueZones(density: number): THREE.Group {
  const group = new THREE.Group();
  const halfWidth = TEST_OVAL_TRACK.trackHalfWidth;
  const trackLength = TEST_OVAL_TRACK.trackLength;

  const garageMaterial = new THREE.MeshStandardMaterial({ color: "#f8fafc", roughness: 0.62, metalness: 0.04 });
  const garageDoorMaterial = new THREE.MeshStandardMaterial({ color: "#0ea5e9", roughness: 0.38, metalness: 0.1 });
  for (let i = 0; i < 10; i++) {
    const { position, angle } = tracksidePosition(12 + i * 7, 1, halfWidth + 18);
    const garage = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.BoxGeometry(9, 5, 8), garageMaterial);
    shell.position.y = 2.5;
    const door = new THREE.Mesh(new THREE.BoxGeometry(5.8, 2.7, 0.2), garageDoorMaterial);
    door.position.set(0, 1.6, -4.12);
    garage.add(shell, door);
    garage.position.copy(position);
    garage.rotation.y = -angle + Math.PI;
    group.add(garage);
  }

  const cityMaterial = new THREE.MeshStandardMaterial({ color: "#c7d2fe", roughness: 0.74, metalness: 0.02 });
  const glassMaterial = new THREE.MeshBasicMaterial({ color: "#e0f2fe", transparent: true, opacity: 0.72 });
  const cityCount = Math.max(14, Math.round(24 * density));
  for (let i = 0; i < cityCount; i++) {
    const progress = trackLength * (0.56 + (i / cityCount) * 0.19);
    const { position, angle } = tracksidePosition(progress, i % 2 === 0 ? 1 : -1, halfWidth + 32 + (i % 3) * 8);
    const height = 12 + ((i * 11) % 34);
    const width = 7 + (i % 4) * 2;
    const tower = new THREE.Mesh(new THREE.BoxGeometry(width, height, width * 0.8), cityMaterial);
    tower.position.set(position.x, height / 2 - 0.05, position.z);
    tower.rotation.y = -angle + (i % 2 === 0 ? 0.18 : -0.18);
    tower.castShadow = true;
    tower.receiveShadow = true;
    group.add(tower);
    const windows = new THREE.Mesh(new THREE.BoxGeometry(width * 0.78, height * 0.72, 0.05), glassMaterial);
    windows.position.set(position.x, height * 0.55, position.z);
    windows.rotation.y = tower.rotation.y;
    group.add(windows);
  }

  const dockMaterial = new THREE.MeshStandardMaterial({ color: "#b45309", roughness: 0.66, metalness: 0.02 });
  const buoyMaterial = new THREE.MeshStandardMaterial({ color: "#fb7185", roughness: 0.45, metalness: 0.02 });
  const dockCount = Math.max(8, Math.round(15 * density));
  for (let i = 0; i < dockCount; i++) {
    const progress = trackLength * (0.43 + (i / dockCount) * 0.12);
    const { position, angle } = tracksidePosition(progress, -1, halfWidth + 18);
    const dock = new THREE.Mesh(new THREE.BoxGeometry(8, 0.38, 2.4), dockMaterial);
    dock.position.set(position.x, 0.22, position.z);
    dock.rotation.y = -angle + Math.PI / 2;
    group.add(dock);
    const buoy = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 1.2, 12), buoyMaterial);
    buoy.position.set(position.x, 0.62, position.z - 5 - (i % 2) * 3);
    group.add(buoy);
  }

  const flagMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", vertexColors: true, side: THREE.DoubleSide });
  const poleMaterial = new THREE.MeshStandardMaterial({ color: "#334155", roughness: 0.42, metalness: 0.22 });
  const flagCount = Math.max(36, Math.round(72 * density));
  const flags = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.2, 0.72), flagMaterial, flagCount);
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.04, 3.2, 6), poleMaterial, flagCount);
  const matrix = new THREE.Matrix4();
  const flagColors = ["#f97316", "#facc15", "#22c55e", "#38bdf8", "#ec4899", "#8b5cf6"];
  for (let i = 0; i < flagCount; i++) {
    const progress = (i / flagCount) * trackLength;
    const side = i % 2 === 0 ? 1 : -1;
    const { position, angle } = tracksidePosition(progress, side, halfWidth + 8 + (i % 3) * 2);
    matrix.compose(
      new THREE.Vector3(position.x, 1.6, position.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -angle, 0)),
      new THREE.Vector3(1, 1, 1)
    );
    poles.setMatrixAt(i, matrix);
    matrix.compose(
      new THREE.Vector3(position.x, 3.1, position.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -angle + Math.PI / 2, 0)),
      new THREE.Vector3(1, 1, 1)
    );
    flags.setMatrixAt(i, matrix);
    flags.setColorAt(i, new THREE.Color(flagColors[i % flagColors.length]!));
  }
  group.add(flags, poles);

  const balloonMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", vertexColors: true });
  const balloonCount = Math.max(10, Math.round(18 * density));
  const balloons = new THREE.InstancedMesh(new THREE.SphereGeometry(1.8, 14, 10), balloonMaterial, balloonCount);
  for (let i = 0; i < balloonCount; i++) {
    const progress = (i / balloonCount) * trackLength;
    const side = i % 2 === 0 ? 1 : -1;
    const { position } = tracksidePosition(progress, side, halfWidth + 38 + (i % 4) * 7);
    matrix.compose(new THREE.Vector3(position.x, 18 + (i % 5) * 3, position.z), new THREE.Quaternion(), new THREE.Vector3(1, 1.2, 1));
    balloons.setMatrixAt(i, matrix);
    balloons.setColorAt(i, new THREE.Color(flagColors[(i * 2) % flagColors.length]!));
  }
  group.add(balloons);

  const bridgeMaterial = new THREE.MeshStandardMaterial({ color: "#bae6fd", roughness: 0.36, metalness: 0.08 });
  for (const progress of [trackLength * 0.18, trackLength * 0.52, trackLength * 0.84]) {
    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    const bridge = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(halfWidth * 2 + 18, 0.55, 3.2), bridgeMaterial);
    deck.position.y = 10.4;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(halfWidth * 2 + 19, 1.1, 0.3), bridgeMaterial);
    rail.position.set(0, 11.05, -1.75);
    const rail2 = rail.clone();
    rail2.position.z = 1.75;
    bridge.add(deck, rail, rail2);
    for (const x of [-halfWidth - 8, halfWidth + 8]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.45, 10, 0.45), bridgeMaterial);
      post.position.set(x, 5, -1.2);
      const post2 = post.clone();
      post2.position.z = 1.2;
      bridge.add(post, post2);
    }
    bridge.position.set(center.x, 0, center.z);
    bridge.rotation.y = -angle;
    group.add(bridge);
  }

  return group;
}

export function buildHarborEnvironment(density: number): THREE.Group {
  const group = new THREE.Group();
  const halfWidth = TEST_OVAL_TRACK.trackHalfWidth;
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
    stand.position.set(side * (halfWidth + 48), 2.5, -24);
    stand.rotation.y = side * 0.28;
    stand.castShadow = true;
    group.add(stand);
    const crowd = new THREE.Mesh(
      new THREE.PlaneGeometry(36, 7.2),
      new THREE.MeshBasicMaterial({ map: buildCrowdTexture(side > 0 ? 1 : 2), side: THREE.DoubleSide })
    );
    crowd.position.set(side * (halfWidth + 48), 6.5, -18.3);
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
  const fanGeometry = new THREE.SphereGeometry(0.34, 8, 6);
  const fanMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", vertexColors: true });
  const fans = new THREE.InstancedMesh(fanGeometry, fanMaterial, 4 * 14);
  const fanMatrix = new THREE.Matrix4();
  let fanIndex = 0;
  for (let row = 0; row < 4; row++) {
    const seats = new THREE.Mesh(new THREE.BoxGeometry(42, 0.5, 0.7), foregroundSeatMaterial);
    seats.position.set(0, 4.6 + row * 0.65, -3.5 + row * 1.8);
    foregroundStand.add(seats);
    for (let i = 0; i < 14; i++) {
      fanMatrix.setPosition(-19 + i * 2.9, 5.1 + row * 0.65, -3.1 + row * 1.8);
      fans.setMatrixAt(fanIndex, fanMatrix);
      fans.setColorAt(fanIndex, new THREE.Color(foregroundCrowdColors[(i + row) % foregroundCrowdColors.length]!));
      fanIndex += 1;
    }
  }
  foregroundStand.add(fans);
  foregroundStand.position.set(halfWidth + 78, 0, -42);
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
    [-(halfWidth + 82), -78, 0.42, 11],
    [halfWidth + 92, -132, -0.42, 13]
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
    board.position.set(center.x + nx * side * (halfWidth + 10), 1.35, center.z + nz * side * (halfWidth + 10));
    board.rotation.y = -angle;
    group.add(board);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 8), poleMaterial);
    pole.position.set(board.position.x, 1.6, board.position.z);
    group.add(pole);
  }

  const palmTrunkMaterial = new THREE.MeshStandardMaterial({ color: "#b45309", roughness: 0.8 });
  const palmLeafMaterial = new THREE.MeshStandardMaterial({ color: "#22c55e", roughness: 0.82 });
  const palmCount = Math.round(16 * density);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.32, 6, 8), palmTrunkMaterial, palmCount);
  const leaves = new THREE.InstancedMesh(new THREE.BoxGeometry(0.28, 0.08, 4.8), palmLeafMaterial, palmCount * 5);
  const trunkMatrix = new THREE.Matrix4();
  const groupMatrix = new THREE.Matrix4();
  const localMatrix = new THREE.Matrix4();
  const leafMatrix = new THREE.Matrix4();
  let leafIndex = 0;
  for (let i = 0; i < palmCount; i++) {
    const jitterX = ((i * 53) % 11) - 5;
    const jitterZ = ((i * 29) % 9) - 4;
    const x = -120 + i * 16 + jitterX;
    const z = (i % 2 === 0 ? 34 : -228) + jitterZ;
    const scale = 0.85 + ((i * 7) % 5) * 0.08;
    trunkMatrix.compose(new THREE.Vector3(x, 3 * scale, z), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
    trunks.setMatrixAt(i, trunkMatrix);

    groupMatrix.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
    for (let j = 0; j < 5; j++) {
      const rotationY = (j / 5) * Math.PI * 2 + (i % 4) * 0.15;
      localMatrix.compose(
        new THREE.Vector3(0, 6.25 * scale, 0),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.36, rotationY, 0)),
        new THREE.Vector3(1, 1, 1)
      );
      leafMatrix.multiplyMatrices(groupMatrix, localMatrix);
      leaves.setMatrixAt(leafIndex, leafMatrix);
      leafIndex += 1;
    }
  }
  group.add(trunks, leaves);

  return group;
}

function buildArcadeCourseSetPieces(density: number): THREE.Group {
  const group = new THREE.Group();
  const halfWidth = TEST_OVAL_TRACK.trackHalfWidth;
  const trackLength = TEST_OVAL_TRACK.trackLength;
  const wallCount = Math.max(54, Math.round((trackLength / 34) * density));
  const wallGeometry = new THREE.BoxGeometry(1, 1, 1);
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: "#28566f",
    roughness: 0.72,
    metalness: 0.04,
    emissive: "#102d3b",
    emissiveIntensity: 0.18
  });
  const walls = new THREE.InstancedMesh(wallGeometry, wallMaterial, wallCount * 2);

  const glowGeometry = new THREE.BoxGeometry(1, 1, 1);
  const glowMaterial = new THREE.MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.24,
    metalness: 0.08,
    emissive: "#31e5ff",
    emissiveIntensity: 1.05,
    vertexColors: true
  });
  const glowPanels = new THREE.InstancedMesh(glowGeometry, glowMaterial, wallCount * 2);

  const matrix = new THREE.Matrix4();
  const glowMatrix = new THREE.Matrix4();
  const glowColors = ["#22d3ee", "#fb7185", "#facc15", "#a78bfa", "#34d399"];
  let index = 0;
  for (let i = 0; i < wallCount; i++) {
    const progress = (i / wallCount) * trackLength;
    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    const nx = Math.cos(angle);
    const nz = Math.sin(angle);
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -angle, 0));
    for (const side of [-1, 1] as const) {
      const height = 3.8 + ((i + (side > 0 ? 1 : 3)) % 5) * 0.75;
      const length = 7 + ((i * 5) % 5) * 1.2;
      const offset = halfWidth + 11 + ((i + (side > 0 ? 0 : 2)) % 3) * 1.9;
      matrix.compose(
        new THREE.Vector3(center.x + nx * side * offset, height / 2 - 0.04, center.z + nz * side * offset),
        rotation,
        new THREE.Vector3(2.5, height, length)
      );
      walls.setMatrixAt(index, matrix);

      glowMatrix.compose(
        new THREE.Vector3(center.x + nx * side * (offset - 1.35), 2.4 + (i % 3) * 0.36, center.z + nz * side * (offset - 1.35)),
        rotation,
        new THREE.Vector3(0.16, 0.52, 2.2 + (i % 3) * 0.5)
      );
      glowPanels.setMatrixAt(index, glowMatrix);
      glowPanels.setColorAt(index, new THREE.Color(glowColors[(i + (side > 0 ? 0 : 2)) % glowColors.length]!));
      index += 1;
    }
  }
  walls.castShadow = true;
  walls.receiveShadow = true;
  glowPanels.instanceColor!.needsUpdate = true;
  group.add(walls, glowPanels);

  const gatePostMaterial = new THREE.MeshStandardMaterial({
    color: "#23415b",
    roughness: 0.52,
    metalness: 0.12,
    emissive: "#102d3b",
    emissiveIntensity: 0.12
  });
  const gateGlowMaterial = new THREE.MeshBasicMaterial({ color: "#40f0ff" });
  const gateCount = Math.max(7, Math.round(11 * density));
  for (let i = 0; i < gateCount; i++) {
    const progress = ((i + 0.45) / gateCount) * trackLength;
    const center = centerlinePoint(TEST_OVAL_TRACK, progress);
    const angle = centerlineTangentAngle(TEST_OVAL_TRACK, progress);
    const gate = new THREE.Group();
    const postLeft = new THREE.Mesh(new THREE.BoxGeometry(0.7, 9.5, 0.7), gatePostMaterial);
    const postRight = postLeft.clone();
    postLeft.position.set(-halfWidth - 6.5, 4.75, 0);
    postRight.position.set(halfWidth + 6.5, 4.75, 0);
    const top = new THREE.Mesh(new THREE.BoxGeometry(halfWidth * 2 + 14, 0.72, 0.9), gatePostMaterial);
    top.position.set(0, 9.7, 0);
    const light = new THREE.Mesh(new THREE.BoxGeometry(halfWidth * 2 + 10, 0.18, 1.08), gateGlowMaterial);
    light.position.set(0, 9.26, 0);
    gate.add(postLeft, postRight, top, light);
    gate.position.set(center.x, 0, center.z);
    gate.rotation.y = -angle;
    group.add(gate);
  }

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
  group.add(buildVenueZones(density));
  group.add(buildArcadeCourseSetPieces(density));

  return group;
}

export function buildSkyDome(): THREE.Group {
  const group = new THREE.Group();
  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = 64;
  skyCanvas.height = 512;
  const skyCtx = skyCanvas.getContext("2d")!;
  const skyGradient = skyCtx.createLinearGradient(0, 0, 0, skyCanvas.height);
  skyGradient.addColorStop(0, "#21a7ff");
  skyGradient.addColorStop(0.38, "#62d8ff");
  skyGradient.addColorStop(0.72, "#b9f7ff");
  skyGradient.addColorStop(1, "#fff1c2");
  skyCtx.fillStyle = skyGradient;
  skyCtx.fillRect(0, 0, skyCanvas.width, skyCanvas.height);
  const skyTexture = new THREE.CanvasTexture(skyCanvas);
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide })
  );
  group.add(dome);

  const sunGlow = new THREE.Mesh(
    new THREE.CircleGeometry(54, 48),
    new THREE.MeshBasicMaterial({ color: "#fff176", transparent: true, opacity: 0.28, side: THREE.DoubleSide })
  );
  sunGlow.position.set(-150, 118, -350);
  sunGlow.rotation.y = 0.3;
  group.add(sunGlow);

  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(24, 48),
    new THREE.MeshBasicMaterial({ color: "#fff9a8", transparent: true, opacity: 0.96, side: THREE.DoubleSide })
  );
  sun.position.set(-150, 120, -350);
  sun.rotation.y = 0.3;
  group.add(sun);

  const mountainMaterial = new THREE.MeshBasicMaterial({ color: "#6bb7dd", transparent: true, opacity: 0.45, side: THREE.DoubleSide });
  for (let i = 0; i < 8; i++) {
    const mountain = new THREE.Mesh(new THREE.ConeGeometry(22 + (i % 3) * 9, 38 + (i % 4) * 8, 4), mountainMaterial);
    mountain.position.set(-170 + i * 48, 18, -330 - (i % 2) * 18);
    mountain.rotation.y = Math.PI / 4;
    mountain.scale.z = 0.62;
    group.add(mountain);
  }

  const cloudMaterial = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.95, transparent: true, opacity: 0.9 });
  for (let i = 0; i < 28; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + (i % 3);
    for (let j = 0; j < puffs; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(3 + ((i + j) % 3), 12, 8), cloudMaterial);
      puff.scale.set(1.8, 0.42, 0.8);
      puff.position.set(j * 4.2, 0, (j % 2) * 1.4);
      cloud.add(puff);
    }
    cloud.position.set(-210 + i * 17, 46 + (i % 6) * 5, -230 - (i % 5) * 26);
    cloud.rotation.y = (i % 3) * 0.2;
    group.add(cloud);
  }

  const ribbonColors = ["#ff6b6b", "#ffd93d", "#38bdf8", "#a78bfa", "#22c55e"];
  for (let i = 0; i < 16; i++) {
    const ribbon = new THREE.Mesh(
      new THREE.PlaneGeometry(8 + (i % 4) * 2.5, 0.8),
      new THREE.MeshBasicMaterial({
        color: ribbonColors[i % ribbonColors.length],
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide
      })
    );
    ribbon.position.set(-190 + i * 26, 82 + (i % 5) * 7, -210 - (i % 4) * 30);
    ribbon.rotation.set(0.18 + (i % 3) * 0.08, -0.35 + (i % 4) * 0.22, -0.25 + (i % 5) * 0.13);
    group.add(ribbon);
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
