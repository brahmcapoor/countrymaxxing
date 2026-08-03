// Synthesized entirely via Web Audio — no audio assets to fetch or bundle.
let audioContext: AudioContext | null = null;

function getContext(): AudioContext {
  if (!audioContext) audioContext = new AudioContext();
  return audioContext;
}

const SOUND_PREF_KEY = "countrymaxxing:sound-enabled";

export function isSoundEnabled(): boolean {
  try {
    const raw = localStorage.getItem(SOUND_PREF_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  localStorage.setItem(SOUND_PREF_KEY, String(enabled));
}

function tone(
  ctx: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  type: OscillatorType,
  gainPeak: number,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(gainPeak, startTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

export function playCorrect(): void {
  if (!isSoundEnabled()) return;
  const ctx = getContext();
  const now = ctx.currentTime;
  tone(ctx, 523.25, now, 0.12, "sine", 0.15);
  tone(ctx, 659.25, now + 0.08, 0.15, "sine", 0.15);
  tone(ctx, 783.99, now + 0.16, 0.22, "sine", 0.15);
}

export function playIncorrect(): void {
  if (!isSoundEnabled()) return;
  const ctx = getContext();
  const now = ctx.currentTime;
  tone(ctx, 220, now, 0.18, "sine", 0.1);
  tone(ctx, 196, now + 0.1, 0.24, "sine", 0.1);
}

export function playFanfare(): void {
  if (!isSoundEnabled()) return;
  const ctx = getContext();
  const now = ctx.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
    tone(ctx, freq, now + i * 0.1, 0.3, "triangle", 0.13);
  });
}
