// Loud, broadcast-style Web Audio fanfares for the TV scoreboard (no external audio files).
// Built with a dynamics compressor + bright brass/chime harmonics so alerts cut through a loud
// TV and Thanksgiving living room. Only plays when sound is enabled in the TV header.

export type ChimeKind = 'confirm' | 'swing' | 'scoring' | 'banked' | 'final';

export interface ChimeOptions {
  /** Adds a turkey gobble + enthusiastic "BOOM! Turducken!" callout via Web Speech. */
  turducken?: boolean;
}

let sharedCtx: AudioContext | null = null;
let masterBus: AudioNode | null = null;

function audioGraph(): { ctx: AudioContext; out: AudioNode } | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    if (!sharedCtx) {
      sharedCtx = new Ctor();
      const comp = sharedCtx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 10;
      comp.ratio.value = 8;
      comp.attack.value = 0.003;
      comp.release.value = 0.14;

      const master = sharedCtx.createGain();
      master.gain.value = 0.92;
      comp.connect(master);
      master.connect(sharedCtx.destination);
      masterBus = comp;
    }
    if (sharedCtx.state === 'suspended') void sharedCtx.resume().catch(() => {});
    return { ctx: sharedCtx, out: masterBus! };
  } catch {
    return null;
  }
}

/** Punchy NFL-broadcast-style brass horn note (detuned saws + sub square through a bright filter sweep). */
function brassNote(ctx: AudioContext, out: AudioNode, freq: number, start: number, duration: number, level = 0.55): void {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 2.4;
  filter.frequency.setValueAtTime(900, start);
  filter.frequency.exponentialRampToValueAtTime(3800, start + 0.045);
  filter.frequency.exponentialRampToValueAtTime(2100, start + duration);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.linearRampToValueAtTime(level, start + 0.018);
  env.gain.setValueAtTime(level * 0.88, start + Math.max(0.03, duration * 0.65));
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  filter.connect(env);
  env.connect(out);

  const voices: { type: OscillatorType; mult: number; detune: number; gain: number }[] = [
    { type: 'sawtooth', mult: 1, detune: -7, gain: 0.45 },
    { type: 'sawtooth', mult: 1, detune: 7, gain: 0.45 },
    { type: 'square', mult: 0.5, detune: 0, gain: 0.35 },
  ];

  for (const v of voices) {
    const osc = ctx.createOscillator();
    const vg = ctx.createGain();
    osc.type = v.type;
    osc.frequency.setValueAtTime(freq * v.mult, start);
    osc.detune.setValueAtTime(v.detune, start);
    vg.gain.value = v.gain;
    osc.connect(vg);
    vg.connect(filter);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  }
}

/** Crisp high-presence broadcast chime / bell hit that cuts cleanly over room chatter. */
function bellNote(ctx: AudioContext, out: AudioNode, freq: number, start: number, duration: number, level = 0.42): void {
  const partials: { mult: number; gain: number; decay: number }[] = [
    { mult: 1, gain: 1.0, decay: duration },
    { mult: 2, gain: 0.48, decay: duration * 0.72 },
    { mult: 2.756, gain: 0.25, decay: duration * 0.45 },
  ];
  for (const p of partials) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = p.mult === 1 ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(freq * p.mult, start);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.linearRampToValueAtTime(level * p.gain, start + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, start + p.decay);
    osc.connect(env);
    env.connect(out);
    osc.start(start);
    osc.stop(start + p.decay + 0.02);
  }
}

/** Synthesized loud turkey gobble (rapid FM wobble through a nasal vocal formant filter). */
function playGobble(ctx: AudioContext, out: AudioNode, start: number): void {
  const duration = 0.58;
  const carrier = ctx.createOscillator();
  carrier.type = 'sawtooth';
  carrier.frequency.setValueAtTime(780, start);
  carrier.frequency.exponentialRampToValueAtTime(520, start + duration);

  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(17, start);
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.setValueAtTime(145, start);
  lfo.connect(lfoDepth);
  lfoDepth.connect(carrier.frequency);

  const formant = ctx.createBiquadFilter();
  formant.type = 'bandpass';
  formant.frequency.setValueAtTime(1250, start);
  formant.Q.value = 3.2;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.linearRampToValueAtTime(0.75, start + 0.03);
  env.gain.setValueAtTime(0.68, start + duration * 0.72);
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  carrier.connect(formant);
  formant.connect(env);
  env.connect(out);

  carrier.start(start);
  lfo.start(start);
  carrier.stop(start + duration + 0.03);
  lfo.stop(start + duration + 0.03);
}

/** Enthusiastic Web Speech shout for Turducken mode (safe no-op if unsupported). */
function speakTurducken(kind: ChimeKind): void {
  if (typeof window === 'undefined' || typeof window.speechSynthesis === 'undefined') return;
  try {
    const phrase =
      kind === 'final'
        ? 'Boom! Game over! Turducken!'
        : kind === 'banked' || kind === 'scoring' || kind === 'confirm'
          ? 'Boom! Turducken!'
          : 'Turducken!';
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(phrase);
    utter.volume = 1;
    utter.rate = 1.05;
    utter.pitch = 0.85;
    window.speechSynthesis.speak(utter);
  } catch {
    // Ignore speech synthesis errors on restricted browsers.
  }
}

/** Maps a TV alert to its sound cue. */
export function alertChimeKind(alert: { kind: 'final' | 'banked' | 'scoring' | 'swing'; banked: readonly unknown[] }): ChimeKind {
  if (alert.kind === 'final') return 'final';
  if (alert.kind === 'banked' || alert.banked.length > 0) return 'banked';
  if (alert.kind === 'scoring') return 'scoring';
  return 'swing';
}

/** Plays a prominent stadium broadcast alert; safe no-op when audio is unsupported or blocked. */
export function playChime(kind: ChimeKind, opts: ChimeOptions = {}): void {
  const graph = audioGraph();
  if (!graph) return;
  const { ctx, out } = graph;
  try {
    const t0 = ctx.currentTime + 0.015;
    switch (kind) {
      case 'confirm':
        // Punchy 2-hit stadium test sting so you can set TV volume right away.
        brassNote(ctx, out, 392.0, t0, 0.18, 0.62); // G4
        bellNote(ctx, out, 783.99, t0, 0.24, 0.45); // G5
        brassNote(ctx, out, 523.25, t0 + 0.16, 0.36, 0.72); // C5
        bellNote(ctx, out, 1046.5, t0 + 0.16, 0.48, 0.5); // C6
        break;

      case 'swing':
        // Bright triple broadcast alert bell + brass stab (turnovers, 3-pt swings, 1st overall).
        brassNote(ctx, out, 392.0, t0, 0.22, 0.6); // G4
        bellNote(ctx, out, 783.99, t0, 0.26, 0.55); // G5
        bellNote(ctx, out, 987.77, t0 + 0.13, 0.26, 0.58); // B5
        brassNote(ctx, out, 587.33, t0 + 0.26, 0.42, 0.68); // D5
        bellNote(ctx, out, 1174.66, t0 + 0.26, 0.56, 0.6); // D6
        break;

      case 'scoring':
        // Bold 4-note NFL-style scoring brass fanfare (TDs, FGs, safeties).
        brassNote(ctx, out, 392.0, t0, 0.16, 0.65); // G4
        brassNote(ctx, out, 523.25, t0 + 0.14, 0.16, 0.7); // C5
        brassNote(ctx, out, 659.25, t0 + 0.28, 0.18, 0.72); // E5
        brassNote(ctx, out, 783.99, t0 + 0.44, 0.58, 0.8); // G5
        brassNote(ctx, out, 523.25, t0 + 0.44, 0.58, 0.5); // C5 harmony
        bellNote(ctx, out, 1567.98, t0 + 0.44, 0.72, 0.52); // G6 shimmer
        break;

      case 'banked':
        // Celebratory rising stadium horn fanfare + chime chord when points lock in!
        brassNote(ctx, out, 523.25, t0, 0.15, 0.68); // C5
        bellNote(ctx, out, 1046.5, t0, 0.22, 0.5); // C6
        brassNote(ctx, out, 659.25, t0 + 0.14, 0.15, 0.72); // E5
        bellNote(ctx, out, 1318.51, t0 + 0.14, 0.22, 0.52); // E6
        brassNote(ctx, out, 783.99, t0 + 0.28, 0.18, 0.76); // G5
        bellNote(ctx, out, 1567.98, t0 + 0.28, 0.28, 0.55); // G6
        brassNote(ctx, out, 1046.5, t0 + 0.46, 0.68, 0.82); // C6
        brassNote(ctx, out, 523.25, t0 + 0.46, 0.68, 0.55); // C5
        bellNote(ctx, out, 2093.0, t0 + 0.46, 0.85, 0.52); // C7
        break;

      case 'final':
        // Big full victory brass + bell fanfare on Game Final.
        brassNote(ctx, out, 392.0, t0, 0.14, 0.68); // G4
        brassNote(ctx, out, 523.25, t0 + 0.13, 0.14, 0.72); // C5
        brassNote(ctx, out, 659.25, t0 + 0.26, 0.14, 0.74); // E5
        brassNote(ctx, out, 783.99, t0 + 0.39, 0.22, 0.78); // G5
        brassNote(ctx, out, 659.25, t0 + 0.62, 0.16, 0.72); // E5
        brassNote(ctx, out, 783.99, t0 + 0.78, 0.82, 0.85); // G5
        brassNote(ctx, out, 523.25, t0 + 0.78, 0.82, 0.65); // C5
        brassNote(ctx, out, 1046.5, t0 + 0.78, 0.82, 0.72); // C6
        bellNote(ctx, out, 1567.98, t0 + 0.78, 1.0, 0.55); // G6
        bellNote(ctx, out, 2093.0, t0 + 0.78, 1.0, 0.45); // C7
        break;
    }

    if (opts.turducken) {
      const gobbleDelay = kind === 'confirm' ? 0.22 : kind === 'swing' ? 0.35 : 0.52;
      playGobble(ctx, out, t0 + gobbleDelay);
      speakTurducken(kind);
    }
  } catch {
    // Ignore autoplay / hardware audio failures.
  }
}
