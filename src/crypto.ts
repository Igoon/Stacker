// crypto.ts — PBKDF2 (PIN) + AES-GCM (backup terenkripsi) via WebCrypto.
// Semua berjalan lokal di worker; tak ada data keluar perangkat.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const PIN_ITER = 120_000;
export const BACKUP_ITER = 150_000;

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

async function derive(pass: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, [
    "deriveBits",
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: iter, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function hashPin(pin: string, saltB64?: string, iter = PIN_ITER): Promise<{ salt: string; hash: string; iter: number }> {
  const salt = saltB64 ? fromB64(saltB64) : randomBytes(16);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: iter, hash: "SHA-256" },
    await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]),
    256
  );
  return { salt: toB64(salt), hash: toB64(bits), iter };
}

// Perbandingan waktu-konstan sederhana (hindari short-circuit).
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface EncEnvelope {
  format: "stacker-enc";
  v: 1;
  kdf: "PBKDF2-SHA256";
  iter: number;
  salt: string;
  iv: string;
  data: string;
}

export function isEncrypted(json: string): boolean {
  return /^\s*\{\s*"format"\s*:\s*"stacker-enc"/.test(json);
}

export async function encryptJson(plain: string, pass: string, iter = BACKUP_ITER): Promise<string> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await derive(pass, salt, iter);
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    enc.encode(plain)
  );
  const env: EncEnvelope = {
    format: "stacker-enc",
    v: 1,
    kdf: "PBKDF2-SHA256",
    iter,
    salt: toB64(salt),
    iv: toB64(iv),
    data: toB64(data),
  };
  return JSON.stringify(env);
}

export async function decryptJson(envelope: string, pass: string): Promise<string> {
  const env = JSON.parse(envelope) as Partial<EncEnvelope>;
  if (env.format !== "stacker-enc" || !env.salt || !env.iv || !env.data) {
    throw new Error("File bukan backup terenkripsi Stacker.");
  }
  const key = await derive(pass, fromB64(env.salt), env.iter ?? BACKUP_ITER);
  try {
    const buf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(env.iv) as unknown as BufferSource },
      key,
      fromB64(env.data) as unknown as BufferSource
    );
    return dec.decode(buf);
  } catch {
    throw new Error("Kata sandi salah atau file rusak.");
  }
}
