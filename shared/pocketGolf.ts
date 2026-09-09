import type {
  GolfClubDefinition,
  GolfShotShape,
  GolfShotStatistics,
  GolfSwingResult,
  GolfSwingSubmission,
  GolfTerrainType,
  GolfTimingLabel,
  GolfVec3
} from "./protocol";

export const GOLF_PHYSICS_STEP = 1 / 60;

export const GOLF_CLUBS: GolfClubDefinition[] = [
  {
    id: "driver",
    displayName: "Driver",
    maximumCarryMetres: 230,
    launchAngleDegrees: 11,
    accuracy: 0.62,
    forgiveness: 0.5,
    backspin: 0.18,
    rollMultiplier: 1.35,
    powerCurve: 0.72,
    allowedTerrain: ["tee", "fairway", "light-rough"]
  },
  {
    id: "3-wood",
    displayName: "3 Wood",
    maximumCarryMetres: 205,
    launchAngleDegrees: 14,
    accuracy: 0.67,
    forgiveness: 0.56,
    backspin: 0.24,
    rollMultiplier: 1.16,
    powerCurve: 0.76,
    allowedTerrain: ["tee", "fairway", "light-rough"]
  },
  {
    id: "5-iron",
    displayName: "5 Iron",
    maximumCarryMetres: 170,
    launchAngleDegrees: 18,
    accuracy: 0.72,
    forgiveness: 0.62,
    backspin: 0.32,
    rollMultiplier: 0.9,
    powerCurve: 0.82,
    allowedTerrain: ["tee", "fairway", "light-rough", "deep-rough"]
  },
  {
    id: "7-iron",
    displayName: "7 Iron",
    maximumCarryMetres: 145,
    launchAngleDegrees: 23,
    accuracy: 0.78,
    forgiveness: 0.68,
    backspin: 0.44,
    rollMultiplier: 0.68,
    powerCurve: 0.86,
    allowedTerrain: ["tee", "fairway", "light-rough", "deep-rough"]
  },
  {
    id: "9-iron",
    displayName: "9 Iron",
    maximumCarryMetres: 115,
    launchAngleDegrees: 30,
    accuracy: 0.82,
    forgiveness: 0.72,
    backspin: 0.58,
    rollMultiplier: 0.48,
    powerCurve: 0.9,
    allowedTerrain: ["tee", "fairway", "light-rough", "deep-rough"]
  },
  {
    id: "pitching-wedge",
    displayName: "Pitching Wedge",
    maximumCarryMetres: 82,
    launchAngleDegrees: 38,
    accuracy: 0.84,
    forgiveness: 0.76,
    backspin: 0.72,
    rollMultiplier: 0.28,
    powerCurve: 0.94,
    allowedTerrain: ["tee", "fairway", "light-rough", "deep-rough", "bunker"]
  },
  {
    id: "sand-wedge",
    displayName: "Sand Wedge",
    maximumCarryMetres: 58,
    launchAngleDegrees: 45,
    accuracy: 0.8,
    forgiveness: 0.82,
    backspin: 0.82,
    rollMultiplier: 0.2,
    powerCurve: 0.98,
    allowedTerrain: ["tee", "fairway", "light-rough", "deep-rough", "bunker"]
  },
  {
    id: "putter",
    displayName: "Putter",
    maximumCarryMetres: 28,
    launchAngleDegrees: 1.5,
    accuracy: 0.94,
    forgiveness: 0.88,
    backspin: 0,
    rollMultiplier: 1.7,
    powerCurve: 1.1,
    allowedTerrain: ["green"]
  }
];

export interface GolfShotSimulationInput {
  club: GolfClubDefinition;
  swing: GolfSwingResult;
  aimDegrees: number;
  distanceToHole: number;
  terrain: GolfTerrainType;
  wind: { speed: number; directionDegrees: number };
  holeDistance?: number;
  waterZones?: Array<{ xMin: number; xMax: number; zMin: number; zMax: number }>;
  bunkerZones?: Array<{ xMin: number; xMax: number; zMin: number; zMax: number }>;
  fairwayHalfWidth?: number;
  lightRoughHalfWidth?: number;
  greenRadius?: number;
  outOfBoundsX?: number;
  arcadeObstacles?: GolfArcadeObstacle[];
}

export interface GolfArcadeObstacle {
  kind: "bumper" | "spinner" | "gate";
  x: number;
  z: number;
  radius: number;
  strength?: number;
}

export interface GolfShotSimulation {
  stats: GolfShotStatistics;
  end: GolfVec3;
  trajectory: GolfVec3[];
  penalty: "water" | "out-of-bounds" | null;
  holed: boolean;
}

const TERRAIN = {
  tee: { power: 1, bounce: 0.34, friction: 0.82, lateralPenalty: 1 },
  fairway: { power: 1, bounce: 0.28, friction: 0.92, lateralPenalty: 1 },
  "light-rough": { power: 0.86, bounce: 0.18, friction: 1.42, lateralPenalty: 1.25 },
  "deep-rough": { power: 0.68, bounce: 0.1, friction: 2.1, lateralPenalty: 1.55 },
  bunker: { power: 0.52, bounce: 0.06, friction: 3.4, lateralPenalty: 1.5 },
  green: { power: 0.94, bounce: 0.18, friction: 0.52, lateralPenalty: 0.75 },
  water: { power: 0.3, bounce: 0, friction: 8, lateralPenalty: 2 },
  "out-of-bounds": { power: 0.3, bounce: 0, friction: 8, lateralPenalty: 2 }
} satisfies Record<GolfTerrainType, { power: number; bounce: number; friction: number; lateralPenalty: number }>;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function degToRad(value: number): number {
  return (value * Math.PI) / 180;
}

function horizontalDistance(position: GolfVec3): number {
  return Math.hypot(position.x, position.z);
}

function cupDistance(position: GolfVec3, distanceToHole: number): number {
  return Math.hypot(position.x, distanceToHole - position.z);
}

function segmentCupDistance(start: GolfVec3, end: GolfVec3, distanceToHole: number): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq <= 0.000001) return cupDistance(end, distanceToHole);
  const t = clamp(((-start.x * dx) + (distanceToHole - start.z) * dz) / lengthSq, 0, 1);
  return Math.hypot(start.x + dx * t, distanceToHole - (start.z + dz * t));
}

function speed3(velocity: GolfVec3): number {
  return Math.hypot(velocity.x, velocity.y, velocity.z);
}

function inZone(position: GolfVec3, zone: { xMin: number; xMax: number; zMin: number; zMax: number }): boolean {
  return position.x >= zone.xMin && position.x <= zone.xMax && position.z >= zone.zMin && position.z <= zone.zMax;
}

function arcadeObstacleAt(position: GolfVec3, input: GolfShotSimulationInput, usedObstacleIndexes: Set<number>): { obstacle: GolfArcadeObstacle; index: number } | null {
  if (position.y > 2.8) return null;
  const obstacles = input.arcadeObstacles ?? [];
  for (let index = 0; index < obstacles.length; index++) {
    if (usedObstacleIndexes.has(index)) continue;
    const obstacle = obstacles[index]!;
    if (Math.hypot(position.x - obstacle.x, position.z - obstacle.z) <= obstacle.radius) return { obstacle, index };
  }
  return null;
}

function terrainAt(
  position: GolfVec3,
  distanceToHole: number,
  penalty: "water" | "out-of-bounds" | null,
  input?: Pick<GolfShotSimulationInput, "bunkerZones" | "fairwayHalfWidth" | "greenRadius" | "lightRoughHalfWidth">
): GolfTerrainType {
  if (penalty === "water") return "water";
  if (penalty === "out-of-bounds") return "out-of-bounds";
  const remaining = Math.hypot(position.x, distanceToHole - position.z);
  const lateral = Math.abs(position.x);
  if (remaining < (input?.greenRadius ?? 13)) return "green";
  if (input?.bunkerZones?.some((zone) => inZone(position, zone))) return "bunker";
  if (position.z > distanceToHole * 0.55 && position.z < distanceToHole * 0.78 && lateral > 16 && lateral < 34) return "bunker";
  if (lateral < (input?.fairwayHalfWidth ?? 18)) return "fairway";
  if (lateral < (input?.lightRoughHalfWidth ?? 34)) return "light-rough";
  return "deep-rough";
}

function timingLabel(timing: number, confidence: number): GolfTimingLabel {
  if (confidence < 0.34) return "MISHIT";
  const abs = Math.abs(timing);
  if (abs <= 0.08) return "PERFECT";
  if (abs <= 0.22) return "GREAT";
  if (abs <= 0.42) return "GOOD";
  return timing < 0 ? "EARLY" : "LATE";
}

function shotShape(lateralError: number, timing: number): GolfShotShape {
  const abs = Math.abs(lateralError);
  if (abs < 7) return "straight";
  if (abs < 20) return lateralError < 0 || timing < -0.24 ? "draw" : "fade";
  return lateralError < 0 || timing < -0.42 ? "hook" : "slice";
}

export function clubById(id: string | undefined): GolfClubDefinition {
  return GOLF_CLUBS.find((club) => club.id === id) ?? GOLF_CLUBS[3]!;
}

export function normalizeGolfSwingSubmission(input: GolfSwingSubmission): GolfSwingResult {
  return {
    swingId: String(input.swingId ?? ""),
    turnId: String(input.turnId ?? ""),
    power: clamp(finite(input.power, 0), 0, 1),
    timing: clamp(finite(input.timing, 0), -1, 1),
    faceAngle: clamp(finite(input.faceAngle, 0), -1, 1),
    swingPath: clamp(finite(input.swingPath, 0), -1, 1),
    attackAngle: clamp(finite(input.attackAngle, 0), -1, 1),
    smoothness: clamp(finite(input.smoothness, 0), 0, 1),
    confidence: clamp(finite(input.confidence, 0), 0, 1),
    source: input.source === "motion" ? "motion" : "touch"
  };
}

export function recommendGolfClub(distanceToHole: number, terrain: GolfTerrainType, windSpeed = 0): GolfClubDefinition {
  if (terrain === "green" || distanceToHole < 26) return clubById("putter");
  if (terrain === "bunker") return clubById("sand-wedge");
  const adjusted = Math.max(20, distanceToHole + windSpeed * 0.8);
  const allowed = GOLF_CLUBS.filter((club) => club.id !== "putter" && club.allowedTerrain.includes(terrain)).sort(
    (a, b) => a.maximumCarryMetres - b.maximumCarryMetres
  );
  return allowed.find((club) => club.maximumCarryMetres >= adjusted * 1.04) ?? allowed.at(-1) ?? clubById("7-iron");
}

export function simulateGolfShot(input: GolfShotSimulationInput): GolfShotSimulation {
  const terrain = TERRAIN[input.terrain] ?? TERRAIN.fairway;
  const launchAngle = degToRad(clamp(input.club.launchAngleDegrees + input.swing.attackAngle * 6, 0.5, 52));
  const idealSpeed =
    input.club.id === "putter"
      ? Math.sqrt(Math.max(4, input.club.maximumCarryMetres)) * 1.05
      : Math.sqrt(Math.max(8, input.club.maximumCarryMetres) * 9.81 / Math.max(0.18, Math.sin(launchAngle * 2)));
  const timingPenalty = 1 - Math.abs(input.swing.timing) * 0.2;
  const confidencePenalty = 0.48 + input.swing.confidence * 0.52;
  const contactQuality = clamp((0.45 + input.swing.smoothness * 0.38 + input.club.forgiveness * 0.2) * timingPenalty * confidencePenalty, 0.24, 1.08);
  const putterLimit = 1;
  const power = Math.pow(clamp(input.swing.power, 0, 1), input.club.powerCurve) * terrain.power * contactQuality * putterLimit;
  const faceError = input.swing.faceAngle * (16 - input.club.accuracy * 8);
  const pathError = input.swing.swingPath * 9;
  const timingError = input.swing.timing * 14 * terrain.lateralPenalty;
  const direction = degToRad(input.aimDegrees + faceError + pathError + timingError);
  const ballSpeed = idealSpeed * power;
  const velocity: GolfVec3 = {
    x: Math.sin(direction) * ballSpeed * Math.cos(launchAngle),
    y: Math.sin(launchAngle) * ballSpeed,
    z: Math.cos(direction) * ballSpeed * Math.cos(launchAngle)
  };
  const position: GolfVec3 = { x: 0, y: 0.042, z: 0 };
  const windRad = degToRad(input.wind.directionDegrees);
  const wind = {
    x: Math.sin(windRad) * input.wind.speed * 0.012 * (1 + input.club.launchAngleDegrees / 45),
    z: Math.cos(windRad) * input.wind.speed * 0.012 * (1 + input.club.launchAngleDegrees / 45)
  };
  const trajectory: GolfVec3[] = [{ ...position }];
  const outX = input.outOfBoundsX ?? 68;
  const isCupShot = input.club.id === "putter" || input.terrain === "green" || input.distanceToHole < 9;
  const cupCaptureRadius = isCupShot ? 1.08 : 0.78;
  const cupSettleRadius = isCupShot ? 1.18 : 0.86;
  const cupCaptureSpeed = isCupShot ? 6.8 : 3.1;
  let maxHeight = position.y;
  let maxSpeed = speed3(velocity);
  let carryDistance = 0;
  let firstBounce = false;
  let penalty: "water" | "out-of-bounds" | null = null;
  let holed = false;
  const usedObstacleIndexes = new Set<number>();

  for (let step = 0; step < 60 * 18; step++) {
    const previousPosition = { ...position };
    const airborne = position.y > 0.046 || velocity.y > 0.1;
    if (airborne) {
      velocity.y -= 9.81 * GOLF_PHYSICS_STEP;
      velocity.x += wind.x;
      velocity.z += wind.z;
      const drag = Math.max(0.986, 0.996 - input.club.backspin * 0.002);
      velocity.x *= drag;
      velocity.z *= drag;
      velocity.y += input.club.backspin * 0.018 * GOLF_PHYSICS_STEP;
    } else {
      const rollingSpeed = Math.hypot(velocity.x, velocity.z);
      const friction = terrainAt(position, input.distanceToHole, penalty, input) === "green" ? TERRAIN.green.friction : terrain.friction / input.club.rollMultiplier;
      const nextSpeed = Math.max(0, rollingSpeed - friction * GOLF_PHYSICS_STEP);
      const factor = rollingSpeed > 0 ? nextSpeed / rollingSpeed : 0;
      velocity.x *= factor;
      velocity.z *= factor;
      velocity.y = 0;
      if (cupDistance(position, input.distanceToHole) < cupCaptureRadius && rollingSpeed < cupCaptureSpeed) {
        position.x = 0;
        position.z = input.distanceToHole;
        velocity.x = 0;
        velocity.z = 0;
        holed = true;
      }
    }

    position.x += velocity.x * GOLF_PHYSICS_STEP;
    position.y += velocity.y * GOLF_PHYSICS_STEP;
    position.z += velocity.z * GOLF_PHYSICS_STEP;
    maxHeight = Math.max(maxHeight, position.y);
    maxSpeed = Math.max(maxSpeed, speed3(velocity));

    const obstacleHit = arcadeObstacleAt(position, input, usedObstacleIndexes);
    if (obstacleHit && !penalty && !holed) {
      usedObstacleIndexes.add(obstacleHit.index);
      const { obstacle } = obstacleHit;
      let normalX = position.x - obstacle.x;
      let normalZ = position.z - obstacle.z;
      const normalLength = Math.hypot(normalX, normalZ);
      if (normalLength < 0.001) {
        normalX = velocity.x === 0 ? 0 : -Math.sign(velocity.x);
        normalZ = velocity.z === 0 ? -1 : -Math.sign(velocity.z);
      } else {
        normalX /= normalLength;
        normalZ /= normalLength;
      }
      const tangentX = -normalZ;
      const tangentZ = normalX;
      const incoming = velocity.x * normalX + velocity.z * normalZ;
      const spin = (obstacle.strength ?? 1) * (obstacle.kind === "spinner" ? 0.46 : obstacle.kind === "gate" ? 0.16 : 0);
      const rebound = obstacle.kind === "bumper" ? 1.04 : obstacle.kind === "spinner" ? 0.86 : 0.58;
      velocity.x = (velocity.x - 2 * incoming * normalX) * rebound + tangentX * spin;
      velocity.z = (velocity.z - 2 * incoming * normalZ) * rebound + tangentZ * spin;
      velocity.y = Math.max(velocity.y, obstacle.kind === "bumper" ? 0.18 : 0);
      position.x = obstacle.x + normalX * (obstacle.radius + 0.18);
      position.z = obstacle.z + normalZ * (obstacle.radius + 0.18);
    }

    if (
      !airborne &&
      segmentCupDistance(previousPosition, position, input.distanceToHole) < cupCaptureRadius &&
      Math.hypot(velocity.x, velocity.z) < cupCaptureSpeed
    ) {
      position.x = 0;
      position.y = 0.042;
      position.z = input.distanceToHole;
      velocity.x = 0;
      velocity.y = 0;
      velocity.z = 0;
      holed = true;
    }

    if (position.y <= 0.042 && velocity.y < 0) {
      position.y = 0.042;
      if (!firstBounce) {
        carryDistance = horizontalDistance(position);
        firstBounce = true;
      }
      velocity.y = -velocity.y * terrain.bounce;
      velocity.x *= 0.82 + terrain.bounce * 0.18;
      velocity.z *= 0.82 + terrain.bounce * 0.18;
      if (Math.abs(velocity.y) < 0.6) velocity.y = 0;
    }

    if (Math.abs(position.x) > outX || position.z < -18 || position.z > (input.holeDistance ?? input.distanceToHole) + 90) {
      penalty = "out-of-bounds";
      break;
    }
    if (input.waterZones?.some((zone) => inZone(position, zone))) {
      penalty = "water";
      break;
    }
    if (step % 8 === 0) trajectory.push({ ...position });
    if (holed || (!airborne && Math.hypot(velocity.x, velocity.z) < 0.22 && step > 45)) break;
  }

  if (!penalty && !holed && cupDistance(position, input.distanceToHole) <= cupSettleRadius) {
    position.x = 0;
    position.y = 0.042;
    position.z = input.distanceToHole;
    velocity.x = 0;
    velocity.y = 0;
    velocity.z = 0;
    holed = true;
  }
  if (!firstBounce) carryDistance = horizontalDistance(position);
  trajectory.push({ ...position });
  const totalDistance = horizontalDistance(position);
  const finalTerrain = terrainAt(position, input.distanceToHole, penalty, input);
  const distanceToHole = holed ? 0 : Math.hypot(position.x, input.distanceToHole - position.z);
  const lateralError = position.x;
  const stats: GolfShotStatistics = {
    carryDistance,
    rollDistance: Math.max(0, totalDistance - carryDistance),
    totalDistance,
    maximumHeight: Math.max(0, maxHeight),
    maximumBallSpeed: maxSpeed,
    lateralError,
    distanceToHole,
    finalTerrain,
    timingLabel: timingLabel(input.swing.timing, input.swing.confidence),
    shotShape: shotShape(lateralError, input.swing.timing)
  };

  return {
    stats,
    end: penalty ? { x: 0, y: 0.042, z: Math.max(0, Math.min(input.distanceToHole - 32, position.z - 18)) } : { ...position },
    trajectory,
    penalty,
    holed
  };
}
