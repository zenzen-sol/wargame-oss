// AES-256-GCM symmetric encryption for user-supplied API keys.
//
// Server-only by virtue of importing node:crypto + reading server
// env vars. The parent packages/agents package has no runtime guard
// against client imports; protection is structural — any importer
// pulling this into a client bundle fails at build because
// node:crypto isn't available in the browser.
//
// Why GCM: authenticated encryption — the auth tag detects any
// tampering of the ciphertext before we try to decrypt. The triple
// (ciphertext, iv, auth_tag) is what's stored in `user_api_keys`;
// the IV is randomized per encryption so the same plaintext key
// yields different ciphertexts across users.
//
// API_KEY_ENCRYPTION_SECRET is a 32-byte master key, hex-encoded in
// env. Generate with `openssl rand -hex 32`. Rotation invalidates
// every encrypted row — there is no migration path. If you ever
// need to rotate, plan to wipe user_api_keys and force re-entry.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12; // standard for GCM
const KEY_LENGTH_BYTES = 32; // AES-256

function getMasterKey(): Buffer {
  const hex = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!hex) {
    throw new Error(
      "API_KEY_ENCRYPTION_SECRET is not set. Generate one with `openssl rand -hex 32` and add to Vercel + .env.local.",
    );
  }
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== KEY_LENGTH_BYTES) {
    throw new Error(
      `API_KEY_ENCRYPTION_SECRET must be ${KEY_LENGTH_BYTES} bytes (got ${buf.length}). It should be the hex output of \`openssl rand -hex 32\` — 64 hex chars.`,
    );
  }
  return buf;
}

export interface EncryptedKey {
  /** Hex-encoded AES-GCM ciphertext. */
  encryptedKey: string;
  /** Hex-encoded 12-byte initialization vector. Unique per encryption. */
  iv: string;
  /** Hex-encoded GCM authentication tag (16 bytes). */
  authTag: string;
}

export function encryptApiKey(plaintext: string): EncryptedKey {
  if (!plaintext) {
    throw new Error("encryptApiKey: plaintext is empty");
  }
  const key = getMasterKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedKey: encrypted.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

export function decryptApiKey(parts: EncryptedKey): string {
  const key = getMasterKey();
  const iv = Buffer.from(parts.iv, "hex");
  const ciphertext = Buffer.from(parts.encryptedKey, "hex");
  const authTag = Buffer.from(parts.authTag, "hex");
  if (iv.length !== IV_LENGTH_BYTES) {
    throw new Error(
      `decryptApiKey: iv is ${iv.length} bytes, expected ${IV_LENGTH_BYTES}.`,
    );
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
