import * as THREE from "three";
import { centerlinePoint, centerlineTangentAngle } from "../../../../shared/racingTrack";
import type { TrackDefinition } from "../../../../shared/racingTrack";

/**
 * Dev-only (`?dev=1`) 3D visual debug aids: a bounding-box wireframe per car
 * (to spot clipping/scale bugs) and a marker at the raw, non-interpolated
 * server sample point for the focused car (to make interpolation drift or
 * a stale/extrapolated car visible instead of inferred from numbers alone).
 * Never constructed outside of dev mode - see RacingRenderer.mount.
 */
export class RacingDevHelpers {
  private readonly group: THREE.Group;
  private readonly boxHelpers = new Map<number, THREE.BoxHelper>();
  private readonly sampleMarker: THREE.Mesh;
  private importedBounds: THREE.BoxHelper | null = null;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    this.group.name = "racing-dev-helpers";
    scene.add(this.group);

    this.sampleMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 10, 8),
      new THREE.MeshBasicMaterial({ color: "#ff00ff" })
    );
    this.sampleMarker.visible = false;
    this.group.add(this.sampleMarker);
  }

  addTrackAlignmentGuides(track: TrackDefinition, barrierOffset: number): void {
    this.group.add(this.buildTrackLine(track, 0, 0x004cff, "authoritative-centerline"));
    this.group.add(this.buildTrackLine(track, track.trackHalfWidth, 0x22c55e, "authoritative-road-right"));
    this.group.add(this.buildTrackLine(track, -track.trackHalfWidth, 0x22c55e, "authoritative-road-left"));
    this.group.add(this.buildTrackLine(track, track.trackHalfWidth + barrierOffset, 0xef4444, "server-barrier-right"));
    this.group.add(this.buildTrackLine(track, -track.trackHalfWidth - barrierOffset, 0xef4444, "server-barrier-left"));
  }

  private buildTrackLine(track: TrackDefinition, lateralOffset: number, color: number, name: string): THREE.LineLoop {
    const points: THREE.Vector3[] = [];
    const samples = 240;
    for (let i = 0; i < samples; i++) {
      const progress = (i / samples) * track.trackLength;
      const center = centerlinePoint(track, progress);
      const angle = centerlineTangentAngle(track, progress);
      const nx = Math.cos(angle);
      const nz = Math.sin(angle);
      points.push(new THREE.Vector3(center.x + nx * lateralOffset, 0.22, center.z + nz * lateralOffset));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color }));
    line.name = name;
    return line;
  }

  updateCarBounds(playerNumber: number, target: THREE.Object3D): void {
    let helper = this.boxHelpers.get(playerNumber);
    if (!helper) {
      helper = new THREE.BoxHelper(target, 0x00ff88);
      this.boxHelpers.set(playerNumber, helper);
      this.group.add(helper);
    }
    helper.update();
  }

  removeCarBounds(playerNumber: number): void {
    const helper = this.boxHelpers.get(playerNumber);
    if (!helper) return;
    helper.geometry.dispose();
    (helper.material as THREE.Material).dispose();
    this.group.remove(helper);
    this.boxHelpers.delete(playerNumber);
  }

  showSamplePoint(x: number, y: number, z: number): void {
    this.sampleMarker.visible = true;
    this.sampleMarker.position.set(x, y, z);
  }

  hideSamplePoint(): void {
    this.sampleMarker.visible = false;
  }

  showImportedAssetBounds(target: THREE.Object3D): void {
    if (!this.importedBounds) {
      this.importedBounds = new THREE.BoxHelper(target, 0xfacc15);
      this.group.add(this.importedBounds);
    }
    this.importedBounds.update();
  }

  dispose(scene: THREE.Scene): void {
    for (const helper of this.boxHelpers.values()) {
      helper.geometry.dispose();
      (helper.material as THREE.Material).dispose();
    }
    this.boxHelpers.clear();
    if (this.importedBounds) {
      this.importedBounds.geometry.dispose();
      (this.importedBounds.material as THREE.Material).dispose();
      this.importedBounds = null;
    }
    for (const child of [...this.group.children]) {
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    this.sampleMarker.geometry.dispose();
    (this.sampleMarker.material as THREE.Material).dispose();
    scene.remove(this.group);
  }
}
