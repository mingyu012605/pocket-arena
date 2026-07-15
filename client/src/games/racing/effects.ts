import * as THREE from "three";

interface PooledParticle {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  scale: number;
}

function makePool(count: number): PooledParticle[] {
  return Array.from({ length: count }, () => ({
    active: false,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 0,
    maxLife: 1,
    scale: 1
  }));
}

interface SkidMark {
  active: boolean;
  x: number;
  z: number;
  heading: number;
  life: number;
  maxLife: number;
}

const SKID_FADE_WINDOW = 0.3;
const SKID_Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Pooled particle systems for speed/surface feedback. Both pools allocate
 * their InstancedMesh and particle records once; spawning reuses an
 * inactive slot and updating just rewrites transforms on the existing
 * instances, so steady-state play never allocates.
 */
export class RacingEffects {
  private readonly group: THREE.Group;
  private readonly dustMesh: THREE.InstancedMesh;
  private readonly dustParticles: PooledParticle[];
  private readonly burstMesh: THREE.InstancedMesh;
  private readonly burstParticles: PooledParticle[];
  private readonly burstColors: THREE.Color[];
  private readonly skidMesh: THREE.InstancedMesh;
  private readonly skidMarks: SkidMark[];
  private skidCursor = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly zeroScale = new THREE.Vector3(0, 0, 0);
  private readonly quaternion = new THREE.Quaternion();
  private lastUpdateAt = 0;

  constructor(scene: THREE.Scene, maxDust: number, maxBurst: number, maxSkid = 160) {
    this.group = new THREE.Group();
    this.group.name = "racing-effects";
    scene.add(this.group);

    const dustGeometry = new THREE.SphereGeometry(0.16, 6, 5);
    const dustMaterial = new THREE.MeshBasicMaterial({ color: "#c2b280", transparent: true, opacity: 0.55, depthWrite: false });
    this.dustMesh = new THREE.InstancedMesh(dustGeometry, dustMaterial, Math.max(1, maxDust));
    this.dustParticles = makePool(Math.max(1, maxDust));
    for (let i = 0; i < this.dustParticles.length; i++) this.dustMesh.setMatrixAt(i, this.matrix.makeScale(0, 0, 0));
    this.group.add(this.dustMesh);

    const burstGeometry = new THREE.PlaneGeometry(0.3, 0.3);
    const burstMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", side: THREE.DoubleSide, vertexColors: true });
    this.burstMesh = new THREE.InstancedMesh(burstGeometry, burstMaterial, Math.max(1, maxBurst));
    this.burstParticles = makePool(Math.max(1, maxBurst));
    this.burstColors = ["#f97316", "#facc15", "#22c55e", "#38bdf8", "#ec4899", "#8b5cf6"].map((color) => new THREE.Color(color));
    for (let i = 0; i < this.burstParticles.length; i++) {
      this.burstMesh.setMatrixAt(i, this.matrix.makeScale(0, 0, 0));
      this.burstMesh.setColorAt(i, this.burstColors[i % this.burstColors.length]!);
    }
    this.group.add(this.burstMesh);

    // Skid marks lay flat on the track surface as a fixed-size ring buffer:
    // spawning always overwrites the oldest slot rather than waiting for a
    // free one, so a car cornering continuously naturally leaves a rolling
    // trail behind it instead of running out of instances mid-corner.
    const skidGeometry = new THREE.PlaneGeometry(0.42, 1.05).rotateX(-Math.PI / 2);
    const skidMaterial = new THREE.MeshBasicMaterial({
      color: "#15151a",
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
    this.skidMesh = new THREE.InstancedMesh(skidGeometry, skidMaterial, Math.max(1, maxSkid));
    this.skidMarks = Array.from({ length: Math.max(1, maxSkid) }, () => ({ active: false, x: 0, z: 0, heading: 0, life: 0, maxLife: 1 }));
    for (let i = 0; i < this.skidMarks.length; i++) this.skidMesh.setMatrixAt(i, this.matrix.makeScale(0, 0, 0));
    this.group.add(this.skidMesh);
  }

  /** Lays down one skid-mark segment at the given ground position, oriented along the car's heading. Call at most a few times per second per car - the caller is responsible for spacing/throttling spawns. */
  spawnSkid(x: number, z: number, heading: number, maxLife = 4.5): void {
    const slot = this.skidMarks[this.skidCursor]!;
    this.skidCursor = (this.skidCursor + 1) % this.skidMarks.length;
    slot.active = true;
    slot.x = x;
    slot.z = z;
    slot.heading = heading;
    slot.maxLife = maxLife;
    slot.life = maxLife;
  }

  /** Off-track dust/rumble feedback. Safe to call every frame; internally throttled per spawn caller via `intensity`. */
  spawnDust(x: number, z: number, intensity: number): void {
    const count = Math.min(3, Math.round(intensity * 3));
    for (let i = 0; i < count; i++) {
      const slot = this.dustParticles.find((particle) => !particle.active);
      if (!slot) return;
      slot.active = true;
      slot.x = x + (Math.random() - 0.5) * 0.6;
      slot.y = 0.1;
      slot.z = z + (Math.random() - 0.5) * 0.6;
      slot.vx = (Math.random() - 0.5) * 1.2;
      slot.vy = 0.6 + Math.random() * 0.8;
      slot.vz = (Math.random() - 0.5) * 1.2;
      slot.maxLife = 0.5 + Math.random() * 0.4;
      slot.life = slot.maxLife;
      slot.scale = 0.6 + Math.random() * 0.6;
    }
  }

  /** A one-shot celebratory confetti burst, e.g. when a car crosses the finish line. */
  triggerFinishBurst(x: number, z: number): void {
    for (const slot of this.burstParticles) {
      if (slot.active) continue;
      slot.active = true;
      slot.x = x;
      slot.y = 1.5 + Math.random() * 1.5;
      slot.z = z;
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 3;
      slot.vx = Math.cos(angle) * speed;
      slot.vy = 3 + Math.random() * 3;
      slot.vz = Math.sin(angle) * speed;
      slot.maxLife = 1.2 + Math.random() * 0.8;
      slot.life = slot.maxLife;
      slot.scale = 0.7 + Math.random() * 0.6;
    }
  }

  /** Short celebratory pop at race start, lighter than the finish burst. */
  triggerStartBurst(x: number, z: number): void {
    let spawned = 0;
    for (const slot of this.burstParticles) {
      if (slot.active) continue;
      slot.active = true;
      slot.x = x + (Math.random() - 0.5) * 2.8;
      slot.y = 0.75 + Math.random() * 0.8;
      slot.z = z + (Math.random() - 0.5) * 2.8;
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 2.1;
      slot.vx = Math.cos(angle) * speed;
      slot.vy = 2 + Math.random() * 2.2;
      slot.vz = Math.sin(angle) * speed;
      slot.maxLife = 0.7 + Math.random() * 0.45;
      slot.life = slot.maxLife;
      slot.scale = 0.55 + Math.random() * 0.35;
      spawned += 1;
      if (spawned >= 18) return;
    }
  }

  update(timestamp: number): void {
    const dt = this.lastUpdateAt === 0 ? 1 / 60 : Math.min(0.1, (timestamp - this.lastUpdateAt) / 1000);
    this.lastUpdateAt = timestamp;

    this.stepPool(this.dustParticles, this.dustMesh, dt, -2.2);
    this.stepPool(this.burstParticles, this.burstMesh, dt, -6);
    this.stepSkidMarks(dt);
  }

  private stepSkidMarks(dt: number): void {
    let dirty = false;
    for (let i = 0; i < this.skidMarks.length; i++) {
      const mark = this.skidMarks[i]!;
      if (!mark.active) continue;
      mark.life -= dt;
      if (mark.life <= 0) {
        mark.active = false;
        this.skidMesh.setMatrixAt(i, this.matrix.makeScale(0, 0, 0));
        dirty = true;
        continue;
      }
      const t = mark.life / mark.maxLife;
      const fade = t > SKID_FADE_WINDOW ? 1 : t / SKID_FADE_WINDOW;
      this.quaternion.setFromAxisAngle(SKID_Y_AXIS, -mark.heading);
      this.skidMesh.setMatrixAt(
        i,
        this.matrix.compose(new THREE.Vector3(mark.x, 0.015, mark.z), this.quaternion, new THREE.Vector3(1, 1, fade))
      );
      dirty = true;
    }
    if (dirty) this.skidMesh.instanceMatrix.needsUpdate = true;
  }

  private stepPool(particles: PooledParticle[], mesh: THREE.InstancedMesh, dt: number, gravity: number): void {
    let dirty = false;
    for (let i = 0; i < particles.length; i++) {
      const particle = particles[i]!;
      if (!particle.active) continue;
      particle.life -= dt;
      if (particle.life <= 0) {
        particle.active = false;
        mesh.setMatrixAt(i, this.matrix.compose(new THREE.Vector3(particle.x, particle.y, particle.z), this.quaternion, this.zeroScale));
        dirty = true;
        continue;
      }
      particle.vy += gravity * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.z += particle.vz * dt;
      const fade = particle.scale * Math.max(0, particle.life / particle.maxLife);
      mesh.setMatrixAt(
        i,
        this.matrix.compose(new THREE.Vector3(particle.x, Math.max(0, particle.y), particle.z), this.quaternion, new THREE.Vector3(fade, fade, fade))
      );
      dirty = true;
    }
    if (dirty) mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(scene: THREE.Scene): void {
    this.dustMesh.geometry.dispose();
    (this.dustMesh.material as THREE.Material).dispose();
    this.burstMesh.geometry.dispose();
    (this.burstMesh.material as THREE.Material).dispose();
    this.skidMesh.geometry.dispose();
    (this.skidMesh.material as THREE.Material).dispose();
    scene.remove(this.group);
  }
}
