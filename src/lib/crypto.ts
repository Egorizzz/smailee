import crypto from "node:crypto";

/**
 * Шифрование чувствительных доступов (SMTP/IMAP-пароли ящиков) — AES-256-GCM.
 * Ключ берётся из env MAILBOX_ENC_KEY (32 байта в hex = 64 симв., или base64).
 * В БД пароли лежат только зашифрованными (ТЗ §8.2). Расшифровка — только в
 * движках отправки/приёма.
 *
 * НЕ импортирует "server-only": этот модуль вызывается и из standalone-воркера
 * (npm run worker), который работает вне Next-рантайма — там нет
 * react-server-условия, под которым server-only не бросает исключение.
 *
 * Формат зашифрованной строки: v1:<iv_hex>:<tag_hex>:<ciphertext_hex>.
 */

const ALG = "aes-256-gcm";

function getKey(): Buffer {
  const raw = process.env.MAILBOX_ENC_KEY;
  if (!raw) {
    throw new Error(
      "MAILBOX_ENC_KEY не задан. Сгенерируйте 32-байтный ключ: `openssl rand -hex 32` и положите в .env"
    );
  }
  // hex (64 симв.) или base64
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("MAILBOX_ENC_KEY должен быть 32 байта (hex-64 или base64).");
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Неверный формат зашифрованного значения.");
  }
  const [, ivHex, tagHex, dataHex] = parts;
  const decipher = crypto.createDecipheriv(ALG, getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

/** Есть ли валидный ключ шифрования (для проверок в UI/actions). */
export function hasEncKey(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}
