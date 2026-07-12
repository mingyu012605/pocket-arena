import { MotionInputSource } from "../controller/inputs/motion";
import type { MotionReading, MotionState } from "../controller/inputs/motion";
import { createButton } from "../components/button";
import type { CleanupFn, RouteContext } from "../networking/router";

const STATE_COPY: Record<MotionState, string> = {
  "insecure-context": "Motion controls need a secure connection — this page was opened over plain HTTP.",
  unavailable: "Motion sensors are not available in this browser.",
  "permission-required": "Tap Enable Motion to grant sensor access.",
  "permission-denied": "Motion access was denied. Check browser permissions and reload.",
  "await-landscape": "Rotate your phone sideways to use it as a steering wheel.",
  "await-calibration": "Calibrating…",
  "sensor-timeout": "No motion data was detected. Check browser permissions or try recalibrating.",
  ready: "Motion controls are live."
};

export function renderMotionDebugPage({ container }: RouteContext): CleanupFn | void {
  container.innerHTML = `
    <section class="page-section centered">
      <h1>Motion Debug</h1>
      <p id="motion-state-copy" class="hero-copy"></p>
      <div id="motion-action-slot"></div>
      <div id="motion-calibration-slot"></div>
      <pre id="motion-readout" class="motion-readout" hidden></pre>
    </section>
  `;

  const stateCopyEl = container.querySelector<HTMLParagraphElement>("#motion-state-copy")!;
  const actionSlot = container.querySelector<HTMLDivElement>("#motion-action-slot")!;
  const calibrationSlot = container.querySelector<HTMLDivElement>("#motion-calibration-slot")!;
  const readoutEl = container.querySelector<HTMLPreElement>("#motion-readout")!;

  const motion = new MotionInputSource();

  function renderForState(state: MotionState): void {
    stateCopyEl.textContent = STATE_COPY[state];
    actionSlot.innerHTML = "";
    calibrationSlot.innerHTML = "";
    readoutEl.hidden = state !== "ready";

    if (state === "permission-required") {
      actionSlot.appendChild(
        createButton({ label: "Enable Motion", variant: "primary", onClick: () => void motion.requestPermission() })
      );
    } else if (state === "sensor-timeout" || state === "permission-denied") {
      actionSlot.appendChild(
        createButton({ label: "Try Again", variant: "primary", onClick: () => motion.recalibrate() })
      );
    } else if (state === "await-calibration") {
      const step = motion.getCalibrationStep();
      if (step === "center") {
        calibrationSlot.innerHTML = `<p>Hold the phone comfortably like a steering wheel.</p>`;
        calibrationSlot.appendChild(
          createButton({ label: "Center", variant: "primary", onClick: () => { motion.confirmCalibrationCenter(); renderForState(motion.getState()); } })
        );
      } else if (step === "confirm-right") {
        calibrationSlot.innerHTML = `<p>Turn the phone slightly right, then tap Next.</p>`;
        calibrationSlot.appendChild(
          createButton({ label: "Next", variant: "primary", onClick: () => { motion.confirmCalibrationRight(); renderForState(motion.getState()); } })
        );
      } else if (step === "confirm-tilt") {
        calibrationSlot.innerHTML = `<p>Tilt the top edge away from you, then tap Next.</p>`;
        calibrationSlot.appendChild(
          createButton({ label: "Next", variant: "primary", onClick: () => { motion.confirmCalibrationTilt(); renderForState(motion.getState()); } })
        );
      }
    } else if (state === "ready") {
      calibrationSlot.appendChild(
        createButton({ label: "Recalibrate", variant: "secondary", onClick: () => motion.recalibrate() })
      );
    }
  }

  const offState = motion.onStateChange((state) => renderForState(state));
  const offReading = motion.onReading((reading: MotionReading) => {
    readoutEl.textContent = `steering: ${reading.steering.toFixed(2)}\nthrottle: ${reading.throttle.toFixed(2)}\nbrake:    ${reading.brake.toFixed(2)}`;
  });

  renderForState(motion.getState());

  return () => {
    offState();
    offReading();
    motion.destroy();
  };
}
