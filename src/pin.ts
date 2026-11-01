// pin.ts — atur/cek PIN lewat worker (dipanggil UI keypad, bukan chat).
import { getSetting, setSetting } from "./db";
import { hashPin, safeEqual } from "./crypto";

const valid = (pin: string): boolean => /^\d{4,8}$/.test(pin);

export function hasPin(): boolean {
  return !!getSetting("pin_hash");
}

export async function checkPin(pin: string): Promise<{ ok: boolean; pinSet: boolean }> {
  const h = getSetting("pin_hash");
  if (!h) return { ok: true, pinSet: false };
  const c = await hashPin(
    pin,
    getSetting("pin_salt") ?? undefined,
    Number(getSetting("pin_iter") ?? 120000)
  );
  return { ok: safeEqual(c.hash, h), pinSet: true };
}

export async function setPin(pin: string): Promise<{ ok: boolean; error?: string }> {
  if (!valid(pin)) return { ok: false, error: "PIN harus 4-8 digit angka." };
  const h = await hashPin(pin);
  setSetting("pin_hash", h.hash);
  setSetting("pin_salt", h.salt);
  setSetting("pin_iter", String(h.iter));
  return { ok: true };
}

export async function changePin(
  oldPin: string,
  newPin: string
): Promise<{ ok: boolean; error?: string }> {
  if (!hasPin()) return { ok: false, error: "Belum ada PIN." };
  if (!valid(newPin)) return { ok: false, error: "PIN baru harus 4-8 digit angka." };
  const c = await checkPin(oldPin);
  if (!c.ok) return { ok: false, error: "PIN lama salah." };
  return setPin(newPin);
}

export async function removePin(pin: string): Promise<{ ok: boolean; error?: string }> {
  if (!hasPin()) return { ok: false, error: "Belum ada PIN." };
  const c = await checkPin(pin);
  if (!c.ok) return { ok: false, error: "PIN salah. PIN tidak dihapus." };
  setSetting("pin_hash", null);
  setSetting("pin_salt", null);
  setSetting("pin_iter", null);
  return { ok: true };
}
