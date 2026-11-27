// pin.ts — atur/cek PIN lewat worker (dipanggil UI keypad, bukan chat).
import { getSetting, setSetting } from "./db";
import { hashPin, safeEqual } from "./crypto";

const valid = (pin: string): boolean => /^\d{4,8}$/.test(pin);
const MAX_PIN_FAILS = 5;
const PIN_COOLDOWN_MS = 30_000;

export function hasPin(): boolean {
  return !!getSetting("pin_hash");
}

function resetPinFails(): void {
  setSetting("pin_fails", null);
  setSetting("pin_lock_until", null);
}

export async function checkPin(
  pin: string
): Promise<{ ok: boolean; pinSet: boolean; retryAfterMs?: number; error?: string }> {
  const h = getSetting("pin_hash");
  if (!h) return { ok: true, pinSet: false };

  const until = Number(getSetting("pin_lock_until") ?? 0);
  const now = Date.now();
  if (Number.isFinite(until) && until > now) {
    const retryAfterMs = until - now;
    return {
      ok: false,
      pinSet: true,
      retryAfterMs,
      error: `Terlalu banyak percobaan salah. Tunggu ${Math.ceil(retryAfterMs / 1000)} detik.`,
    };
  }

  const c = await hashPin(
    pin,
    getSetting("pin_salt") ?? undefined,
    Number(getSetting("pin_iter") ?? 120000)
  );
  if (safeEqual(c.hash, h)) {
    resetPinFails();
    return { ok: true, pinSet: true };
  }

  const fails = (Number(getSetting("pin_fails") ?? 0) || 0) + 1;
  if (fails >= MAX_PIN_FAILS) {
    setSetting("pin_fails", "0");
    setSetting("pin_lock_until", String(Date.now() + PIN_COOLDOWN_MS));
    return {
      ok: false,
      pinSet: true,
      retryAfterMs: PIN_COOLDOWN_MS,
      error: "Terlalu banyak percobaan salah. Tunggu 30 detik.",
    };
  }
  setSetting("pin_fails", String(fails));
  return { ok: false, pinSet: true };
}

export async function setPin(pin: string): Promise<{ ok: boolean; error?: string }> {
  if (!valid(pin)) return { ok: false, error: "PIN harus 4-8 digit angka." };
  const h = await hashPin(pin);
  setSetting("pin_hash", h.hash);
  setSetting("pin_salt", h.salt);
  setSetting("pin_iter", String(h.iter));
  resetPinFails();
  return { ok: true };
}

export async function changePin(
  oldPin: string,
  newPin: string
): Promise<{ ok: boolean; error?: string }> {
  if (!hasPin()) return { ok: false, error: "Belum ada PIN." };
  if (!valid(newPin)) return { ok: false, error: "PIN baru harus 4-8 digit angka." };
  const c = await checkPin(oldPin);
  if (!c.ok) return { ok: false, error: c.error ?? "PIN lama salah." };
  return setPin(newPin);
}

export async function removePin(pin: string): Promise<{ ok: boolean; error?: string }> {
  if (!hasPin()) return { ok: false, error: "Belum ada PIN." };
  const c = await checkPin(pin);
  if (!c.ok) return { ok: false, error: c.error ?? "PIN salah. PIN tidak dihapus." };
  setSetting("pin_hash", null);
  setSetting("pin_salt", null);
  setSetting("pin_iter", null);
  resetPinFails();
  return { ok: true };
}
