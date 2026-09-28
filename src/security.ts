import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getSetting, setSetting } from "./db";

const MAX_FAIL = 3;
const LOCK_MS = 15 * 60 * 1000;
const SESSION_MS =
  Math.max(1, Number(process.env.TELEGRAM_SESSION_MINUTES ?? 15)) * 60 * 1000;

const K_SALT = "pin_salt";
const K_HASH = "pin_hash";
const K_FAIL = "pin_fail";
const K_LOCK = "pin_lock_until";

export const PIN_RE = /^\d{6}$/;

export function hasPin(): boolean {
  return !!getSetting(K_HASH);
}

function hash(pin: string, salt: Buffer): Buffer {
  return scryptSync(pin, salt, 32);
}

export function setPin(pin: string): void {
  const salt = randomBytes(16);
  const h = hash(pin, salt);
  setSetting(K_SALT, salt.toString("hex"));
  setSetting(K_HASH, h.toString("hex"));
  resetFail();
}

export function clearPin(): void {
  setSetting(K_SALT, null);
  setSetting(K_HASH, null);
  resetFail();
}

export function verifyPin(pin: string): boolean {
  const saltHex = getSetting(K_SALT);
  const hashHex = getSetting(K_HASH);
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const got = hash(pin, Buffer.from(saltHex, "hex"));
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}

export function failCount(): number {
  return Number(getSetting(K_FAIL) ?? 0);
}

export function lockRemainMs(): number {
  const until = Number(getSetting(K_LOCK) ?? 0);
  return Math.max(0, until - Date.now());
}

export function isLocked(): boolean {
  return lockRemainMs() > 0;
}

export function registerFail(): { count: number; locked: boolean; remainMs: number } {
  const count = failCount() + 1;
  if (count >= MAX_FAIL) {
    setSetting(K_LOCK, String(Date.now() + LOCK_MS));
    setSetting(K_FAIL, "0");
    return { count, locked: true, remainMs: LOCK_MS };
  }
  setSetting(K_FAIL, String(count));
  return { count, locked: false, remainMs: 0 };
}

export function resetFail(): void {
  setSetting(K_FAIL, null);
  setSetting(K_LOCK, null);
}

const sessions = new Map<string, number>();

export function startSession(userId: string): void {
  sessions.set(userId, Date.now() + SESSION_MS);
}

export function isAuthed(userId: string): boolean {
  const exp = sessions.get(userId);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(userId);
    return false;
  }
  return true;
}

export function touchSession(userId: string): void {
  if (sessions.has(userId)) sessions.set(userId, Date.now() + SESSION_MS);
}

export function endSession(userId: string): void {
  sessions.delete(userId);
}

export function sessionMinutes(): number {
  return Math.round(SESSION_MS / 60000);
}

export function minutesLeft(userId: string): number {
  const exp = sessions.get(userId);
  if (!exp) return 0;
  return Math.max(0, Math.ceil((exp - Date.now()) / 60000));
}

export function lockInfoText(): string {
  const remain = Math.ceil(lockRemainMs() / 60000);
  return `Terkunci. Coba lagi dalam ${remain} menit.`;
}

export { MAX_FAIL };