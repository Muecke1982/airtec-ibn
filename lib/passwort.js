// Passwörter werden nie im Klartext gespeichert, sondern als PBKDF2-Prüfwert:
//   „pbkdf2$<runden>$<salt base64>$<hash base64>“
// (Cloudflare Workers erlauben höchstens 100 000 Runden.)
const ENC = new TextEncoder();
const RUNDEN = 100000;
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function derive(pw, salt, runden) {
  const key = await crypto.subtle.importKey("raw", ENC.encode(String(pw)), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: runden }, key, 256);
}

export async function hashPasswort(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${RUNDEN}$${b64(salt)}$${b64(await derive(pw, salt, RUNDEN))}`;
}

export async function pruefePasswort(pw, gespeichert) {
  const [art, runden, salt, hash] = String(gespeichert || "").split("$");
  if (art !== "pbkdf2" || !salt || !hash || !pw) return false;
  const ist = b64(await derive(pw, unb64(salt), +runden));
  let d = ist.length ^ hash.length;
  for (let i = 0; i < Math.max(ist.length, hash.length); i++) d |= (ist.charCodeAt(i) || 0) ^ (hash.charCodeAt(i) || 0);
  return d === 0;
}
