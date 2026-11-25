// ui/sound.ts — bunyi pengingat (Web Audio) & getar haptik opsional.
export const SOUND_KEY = "stacker-sound";
export const HAPTIC_KEY = "stacker-haptic";

function readFlag(key: string): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

let soundOn = readFlag(SOUND_KEY);
let hapticOn = readFlag(HAPTIC_KEY);
let audioCtx: AudioContext | null = null;

export const isSoundOn = (): boolean => soundOn;
export const isHapticOn = (): boolean => hapticOn;

export function setSoundOn(val: boolean): void {
  soundOn = val;
  try {
    localStorage.setItem(SOUND_KEY, val ? "1" : "0");
  } catch {
    // abaikan
  }
}

export function setHapticOn(val: boolean): void {
  hapticOn = val;
  try {
    localStorage.setItem(HAPTIC_KEY, val ? "1" : "0");
  } catch {
    // abaikan
  }
}

export function haptic(pattern: number | number[] = 12): void {
  if (!hapticOn) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // abaikan
  }
}

export function unlockAudio(): void {
  try {
    if (!audioCtx) {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === "suspended") void audioCtx.resume();
  } catch {
    // Web Audio tak tersedia; abaikan.
  }
}

export function playTing(): void {
  const ctx = audioCtx;
  if (!soundOn || !ctx || ctx.state !== "running") return;
  try {
    const t0 = ctx.currentTime + 0.005;
    const fund = 1174.66; // D6
    const partials: { r: number; g: number; d: number }[] = [
      { r: 1, g: 0.22, d: 1.6 },
      { r: 2.0, g: 0.12, d: 1.2 },
      { r: 2.76, g: 0.08, d: 0.9 },
      { r: 5.4, g: 0.05, d: 0.6 },
      { r: 8.93, g: 0.03, d: 0.4 },
      { r: 13.34, g: 0.015, d: 0.25 },
    ];
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    for (const p of partials) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = fund * p.r;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(p.g, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + p.d);
      o.connect(g).connect(master);
      o.start(t0);
      o.stop(t0 + p.d + 0.05);
    }
    const len = Math.ceil(ctx.sampleRate * 0.03);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3000;
    const ng = ctx.createGain();
    ng.gain.value = 0.06;
    src.connect(hp).connect(ng).connect(master);
    src.start(t0);
  } catch {
    // abaikan
  }
}

export function initAudioUnlock(): void {
  for (const ev of ["pointerdown", "keydown", "touchstart"] as const) {
    window.addEventListener(ev, unlockAudio, { passive: true });
  }
}
