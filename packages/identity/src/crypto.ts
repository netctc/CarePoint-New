import { createHash, createHmac, randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const randomId = (prefix: string): string => `${prefix}_${randomBytes(12).toString("hex")}`;
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");
export const tokenHash = (value: string): string => createHash("sha256").update(value).digest("hex");

function validatePasswordLength(password: string): void {
  if (password.length < 12) throw new Error("Password must contain at least 12 characters.");
}

function scryptAsync(password: string, salt: Buffer, keyLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export function hashPassword(password: string): string {
  validatePasswordLength(password);
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function hashPasswordAsync(password: string): Promise<string> {
  validatePasswordLength(password);
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, 32);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, saltValue, hashValue] = stored.split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64url");
  const actual = scryptSync(password, Buffer.from(saltValue, "base64url"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function verifyPasswordAsync(password: string, stored: string): Promise<boolean> {
  const [algorithm, saltValue, hashValue] = stored.split("$");
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64url");
  const actual = await scryptAsync(password, Buffer.from(saltValue, "base64url"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function toBase32(buffer: Buffer): string {
  let bits = "";
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let i = 0; i < bits.length; i += 5) output += BASE32[Number.parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)] ?? "";
  return output;
}

function fromBase32(value: string): Buffer {
  let bits = "";
  for (const char of value.replace(/=+$/g, "").toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error("Invalid base32 secret.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export const generateTotpSecret = (): string => toBase32(randomBytes(20));

export function totpCode(secret: string, now = Date.now()): string {
  const counter = Math.floor(now / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", fromBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24) | ((digest[offset + 1]! & 0xff) << 16) | ((digest[offset + 2]! & 0xff) << 8) | (digest[offset + 3]! & 0xff);
  return (binary % 1_000_000).toString().padStart(6, "0");
}

export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return [-30_000, 0, 30_000].some((delta) => {
    const candidate = totpCode(secret, now + delta);
    return timingSafeEqual(Buffer.from(candidate), Buffer.from(code));
  });
}
