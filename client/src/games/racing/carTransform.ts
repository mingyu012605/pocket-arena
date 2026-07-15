import { TEST_OVAL_TRACK, sampleRacingTrackFrame } from "../../../../shared/racingTrack";

export interface CarFrame {
  progress: number;
  lateralOffset: number;
  headingError: number;
  airborne?: boolean;
  worldX?: number;
  worldY?: number;
  worldZ?: number;
}

export interface WorldCarTransform {
  x: number;
  y: number;
  z: number;
  heading: number;
}

/**
 * Grounded frames derive x/y/z/heading from the shared track sampler, same
 * as always. Airborne frames use the server's own world-space position
 * directly - re-deriving x/z from `progress` while airborne would silently
 * reproduce the "curves through the air following the centerline" bug the
 * server-side world-space flight physics exists to fix, since `progress` is
 * frozen at takeoff and no longer describes where the car actually is.
 */
export function computeRacingCarWorldTransform(frame: CarFrame): WorldCarTransform {
  if (frame.airborne && frame.worldX !== undefined && frame.worldY !== undefined && frame.worldZ !== undefined) {
    // `progress` is frozen at takeoff while airborne, so it no longer
    // tracks true heading - but it's still a reasonable "facing direction
    // at launch" fallback, and the renderer's existing per-car yaw easing
    // (visualYaw) smooths toward whatever heading is returned each frame,
    // so holding this steady through the flight reads fine rather than
    // snapping. Exact airborne yaw dynamics are left as a Cycle 5+ polish
    // item, not a Cycle 4 physics/rendering requirement.
    const heading = sampleRacingTrackFrame(TEST_OVAL_TRACK, frame.progress, 0).heading;
    return { x: frame.worldX, y: frame.worldY, z: frame.worldZ, heading };
  }
  const sample = sampleRacingTrackFrame(TEST_OVAL_TRACK, frame.progress, frame.lateralOffset);
  return { x: sample.x, y: sample.y, z: sample.z, heading: sample.heading };
}
