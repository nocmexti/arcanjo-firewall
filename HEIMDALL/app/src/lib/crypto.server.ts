/**
 * Criptografia das credenciais dos pfSense (API keys).
 * AES-256-GCM com chave derivada de PFSENSE_CRED_ENCRYPTION_KEY.
 * O valor em claro nunca é enviado ao frontend.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

async function getKey(): Promise<CryptoKey> {
  const raw = process.env["PFSENSE_CRED_ENCRYPTION_KEY"];
  if (!raw) throw new Error("PFSENSE_CRED_ENCRYPTION_KEY não configurada.");
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(raw));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(value: string): Uint8Array<ArrayBuffer> {
  const bin = atob(value);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function encryptSecret(plain: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain)),
  );
  return `v1.${toB64(iv)}.${toB64(cipher)}`;
}

export async function decryptSecret(payload: string | null): Promise<string | null> {
  if (!payload) return null;
  const [version, ivB64, dataB64] = payload.split(".");
  if (version !== "v1" || !ivB64 || !dataB64) return null;
  try {
    const key = await getKey();
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64(ivB64) },
      key,
      fromB64(dataB64),
    );
    return dec.decode(plain);
  } catch {
    return null;
  }
}
