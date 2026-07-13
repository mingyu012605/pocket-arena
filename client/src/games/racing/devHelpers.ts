import * as THREE from "three";

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

  dispose(scene: THREE.Scene): void {
    for (const helper of this.boxHelpers.values()) {
      helper.geometry.dispose();
      (helper.material as THREE.Material).dispose();
    }
    this.boxHelpers.clear();
    this.sampleMarker.geometry.dispose();
    (this.sampleMarker.material as THREE.Material).dispose();
    scene.remove(this.group);
  }
}
