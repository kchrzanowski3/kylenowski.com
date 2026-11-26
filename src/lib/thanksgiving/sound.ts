// Subtle Web Audio chimes for the TV scoreboard (no audio files or external requests).
// Only plays when the user explicitly enables sound in the TV header.

export type ChimeKind = 'banked' | 'final' | 'confirm';

let sharedCtx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    if (!sharedCtx) sharedCtx = new Ctor();
    if (sharedCtx.state === 'suspended') void sharedCtx.resume().catch(() => {});
    return sharedCtx;
  } catch {
    return null;
  }
}

const NOTES: Record<ChimeKind, { freq: number; delay: number; duration: number; gain: number }[]> = {
  // Soft single-note click confirmation when unmuting.
  confirm: [{ freq: 587.33, delay: 0, duration: 0.16, gain: 0.08 }], // D5
  // Crisp two-note upward fifth when points get banked mid-game.
  banked: [
    { freq: 523.25, delay: 0, duration: 0.22, gain: 0.1 }, // C5
    { freq: 783.99, delay: 0.11, duration: 0.34, gain: 0.11 }, // G5
  ],
  // Warm three-note major triad when a game goes final.
  final: [
    { freq: 523.25, delay: 0, duration: 0.22, gain: 0.1 }, // C5
    { freq: 659.25, delay: 0.11, duration: 0.24, gain: 0.1 }, // E5
    { freq: 783.99, delay: 0.22, duration: 0.44, gain: 0.12 }, // G5
  ],
};

/** Plays a soft chime; safe no-op when audio is unsupported or blocked. */
export function playChime(kind: ChimeKind): void {
  const ctx = audioContext();
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime + 0.01;
    for (const note of NOTES[kind]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(note.freq, t0 + note.delay);
      gain.gain.setValueAtTime(0.0001, t0 + note.delay);
      gain.gain.linearRampToValueAtTime(note.gain, t0 + note.delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.delay + note.duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + note.delay);
      osc.stop(t0 + note.delay + note.duration + 0.02);
    }
  } catch {
    // Ignore autoplay / hardware audio failures.
  }
}
