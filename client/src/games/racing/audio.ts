/**
 * Racing audio: entirely Web Audio synthesis (oscillators + generated noise
 * buffers), no imported audio files - consistent with the art bible's
 * procedural-only asset strategy and the "no copyrighted game audio" rule.
 *
 * AudioContext creation is deferred to `start()`, which callers must invoke
 * from a real user gesture (a click handler), per browser autoplay policy.
 * If AudioContext construction or any node setup throws, every method
 * becomes a silent no-op instead of breaking the race.
 */
export class RacingAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private noiseSource: AudioBufferSourceNode | null = null;
  private tireGain: GainNode | null = null;
  private rumbleGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private muted = false;
  private volume = 0.16;
  private failed = false;

  start(): void {
    if (this.context || this.failed) return;
    try {
      const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        this.failed = true;
        return;
      }
      const context = new AudioContextCtor();
      const master = context.createGain();
      master.gain.value = this.muted ? 0 : this.volume;
      master.connect(context.destination);

      const engineOsc = context.createOscillator();
      engineOsc.type = "triangle";
      engineOsc.frequency.value = 48;
      const engineGain = context.createGain();
      engineGain.gain.value = 0.018;
      engineOsc.connect(engineGain).connect(master);
      engineOsc.start();

      const bufferSize = context.sampleRate * 2;
      const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      const noiseSource = context.createBufferSource();
      noiseSource.buffer = buffer;
      noiseSource.loop = true;

      const tireFilter = context.createBiquadFilter();
      tireFilter.type = "highpass";
      tireFilter.frequency.value = 1400;
      const tireGain = context.createGain();
      tireGain.gain.value = 0;
      noiseSource.connect(tireFilter).connect(tireGain).connect(master);

      const rumbleFilter = context.createBiquadFilter();
      rumbleFilter.type = "lowpass";
      rumbleFilter.frequency.value = 110;
      const rumbleGain = context.createGain();
      rumbleGain.gain.value = 0;
      noiseSource.connect(rumbleFilter).connect(rumbleGain).connect(master);
      noiseSource.start();

      this.context = context;
      this.master = master;
      this.engineOsc = engineOsc;
      this.engineGain = engineGain;
      this.noiseSource = noiseSource;
      this.tireGain = tireGain;
      this.rumbleGain = rumbleGain;
      this.startMusicLoop();
    } catch {
      this.failed = true;
    }
  }

  /** Called each render frame (or state update) with the focused car's live telemetry. */
  update(input: { speed: number; maxSpeed: number; offTrack: boolean; steeringMagnitude: number; braking: boolean }): void {
    const { context, engineOsc, engineGain, tireGain, rumbleGain } = this;
    if (!context || !engineOsc || !engineGain || !tireGain || !rumbleGain) return;
    const now = context.currentTime;
    const speedRatio = Math.min(1, Math.abs(input.speed) / Math.max(1, input.maxSpeed));
    const targetFreq = 48 + speedRatio * 135 + (input.braking ? -5 : 0);
    engineOsc.frequency.setTargetAtTime(targetFreq, now, 0.12);
    engineGain.gain.setTargetAtTime(0.018 + speedRatio * 0.034, now, 0.16);
    const scrubbing = input.steeringMagnitude > 0.5 && Math.abs(input.speed) > 4;
    tireGain.gain.setTargetAtTime(scrubbing ? 0.014 : 0, now, 0.08);
    rumbleGain.gain.setTargetAtTime(input.offTrack ? 0.02 : 0, now, 0.12);
  }

  private startMusicLoop(): void {
    if (!this.context || !this.master || this.musicTimer !== null) return;
    this.playMusicNote();
    this.musicTimer = window.setInterval(() => this.playMusicNote(), 430);
  }

  private playMusicNote(): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    const melody = [0, 4, 7, 12, 9, 7, 4, 2, 0, 7, 9, 12, 14, 12, 7, 4];
    const semitone = melody[this.musicStep % melody.length]!;
    const frequency = 261.63 * 2 ** (semitone / 12);
    this.musicStep += 1;
    this.blip(frequency, 0.34, 0.012, "sine");
    if (this.musicStep % 4 === 0) this.blip(frequency / 2, 0.55, 0.007, "triangle");
  }

  private blip(frequency: number, durationSeconds: number, gainValue: number, type: OscillatorType = "sine"): void {
    const context = this.context;
    const master = this.master;
    if (!context || !master) return;
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    const gain = context.createGain();
    const now = context.currentTime;
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationSeconds);
    osc.connect(gain).connect(master);
    osc.start(now);
    osc.stop(now + durationSeconds + 0.02);
  }

  playCountdownTick(): void {
    this.blip(440, 0.1, 0.045, "triangle");
  }

  playCountdownGo(): void {
    this.blip(880, 0.22, 0.075, "triangle");
  }

  playIntroRise(): void {
    this.blip(330, 0.22, 0.034, "sine");
    window.setTimeout(() => this.blip(392, 0.22, 0.038, "sine"), 150);
    window.setTimeout(() => this.blip(523, 0.36, 0.045, "triangle"), 310);
  }

  playFinish(): void {
    this.blip(660, 0.14, 0.06, "triangle");
    window.setTimeout(() => this.blip(880, 0.26, 0.07, "triangle"), 130);
  }

  playUiClick(): void {
    this.blip(320, 0.05, 0.03, "sine");
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.context) this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.context.currentTime, 0.05);
  }

  isMuted(): boolean {
    return this.muted;
  }

  destroy(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    try {
      this.engineOsc?.stop();
      this.noiseSource?.stop();
    } catch {
      // already stopped
    }
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.noiseSource = null;
    this.tireGain = null;
    this.rumbleGain = null;
    this.musicStep = 0;
  }
}
