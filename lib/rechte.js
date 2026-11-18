// Rechte je Mitarbeiter. Gespeichert als Liste in der Spalte „rechte“ (z. B. "wochenplan,protokolle,hinweise").
// Der Admin (genau eine Person) hat immer alle Rechte.
// Die gleiche Liste steht für die Anzeige in app/admin.js – bei Änderungen beide anpassen.

// Bereiche (Reiter in der App)
export const BEREICHE = ["wochenplan", "protokolle", "maschinen", "lager", "autos"];
// Zusatzrechte (früher alles im Häkchen „Büro“). „hinweise“ = Büro: bekommt Nachrichten ans Büro, an alle, anpinnen, Abstimmungen
export const ZUSATZ = ["hinweise", "plan_aendern", "urlaub", "maschinen_buero", "lager_bestellen", "autos_verwalten", "personal", "stammdaten", "mitarbeiter"];
export const ALLE = [...BEREICHE, ...ZUSATZ];
export const MONTEUR = BEREICHE;

export const rechteAus = s => [...new Set(String(s || "").split(",").map(x => x.trim()).filter(x => ALLE.includes(x)))];
export const rechteText = list => ALLE.filter(r => (list || []).includes(r)).join(",");

// darf(me, "hinweise") – Admin darf alles
export function darf(me, recht) {
  if (!me) return false;
  if (me.admin) return true;
  return Array.isArray(me.rechte) && me.rechte.includes(recht);
}
// mindestens ein Zusatzrecht (für Anzeigen wie „Schönen Tag im Büro“)
export const istBuero = me => ZUSATZ.some(r => darf(me, r));
