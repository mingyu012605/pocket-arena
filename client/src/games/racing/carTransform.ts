import { TEST_OVAL_TRACK, centerlinePoint, centerlineTangentAngle } from "../../../../shared/racingTrack";

export interface CarFrame {
  progress: number;
  lateralOffset: number;
  headingError: number;
}

export interface WorldCarTransform {
  x: number;
  z: number;
  heading: number;
}

export function computeRacingCarWorldTransform(frame: CarFrame): WorldCarTransform {
  const center = centerlinePoint(TEST_OVAL_TRACK, frame.progress);
  const trackAngle = centerlineTangentAngle(TEST_OVAL_TRACK, frame.progress);
  const perpendicularX = Math.cos(trackAngle);
  const perpendicularZ = Math.sin(trackAngle);
  return {
    x: center.x + perpendicularX * frame.lateralOffset,
    z: center.z + perpendicularZ * frame.lateralOffset,
    heading: trackAngle + frame.headingError
  };
}
