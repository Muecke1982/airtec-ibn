// Test: Urlaub aus dem Wochenplan (Zeiträume bilden, Arbeitstage zählen, Namen zuordnen)
// Aufruf:  node test/urlaubplan.test.mjs
import assert from "node:assert/strict";
import { zeitraeume, istUrlaub } from "../lib/urlaubplan.js";
import { parseWeek, mondayOf } from "../lib/wochenplan.js";

// zwei Wochen: Peter Mo–Fr KW 46 Urlaub + Mo KW 47 → ein Zeitraum über das Wochenende
// Anna: Di Urlaub, Mi Baustelle, Do halber Tag Urlaub → zwei Zeiträume
const blatt = (kw, zeilen) => parseWeek([["", "Peter", "Anna"], ...zeilen], ["Peter", "Anna"], mondayOf(2026, kw));
const w46 = blatt(46, [["Mo", "Urlaub", "Bau A"], ["Di", "Urlaub", "Urlaub"], ["Mi", "Urlaub", "Bau A"], ["Do", "Urlaub", "Urlaub ½"], ["Fr", "Urlaub", ""]]);
const w47 = blatt(47, [["Mo", "urlaub", "Bau B"], ["Di", "Bau B", "Bau B"], ["Mi", "", ""], ["Do", "", ""], ["Fr", "Feiertag", "Urlaub"]]);
const w48 = blatt(48, [["Mo", "Urlaub", "Urlaub"], ["Di", "", ""], ["Mi", "", ""], ["Do", "", ""], ["Fr", "", ""]]);
const z = zeitraeume([w46, w47, w48], "2026");

assert.deepEqual(z.Peter, [
  { von: "2026-11-09", bis: "2026-11-16", tage: 6 },
  { von: "2026-11-23", bis: "2026-11-23", tage: 1 },
], "über Wochenende verbunden, Baustellentag trennt");
assert.deepEqual(z.Anna, [
  { von: "2026-11-10", bis: "2026-11-10", tage: 1 },
  { von: "2026-11-12", bis: "2026-11-12", tage: 0.5 },
  { von: "2026-11-20", bis: "2026-11-23", tage: 2 },
], "halber Tag, Fr + Mo über Wochenende verbunden");

// Feiertag dazwischen verbindet: Peter Do Urlaub, Fr Feiertag, Mo Urlaub
const w49 = blatt(49, [["Mo", "", ""], ["Di", "", ""], ["Mi", "", ""], ["Do", "Urlaub", ""], ["Fr", "Feiertag", ""]]);
const w50 = blatt(50, [["Mo", "Urlaub", ""], ["Di", "", ""], ["Mi", "", ""], ["Do", "", ""], ["Fr", "", ""]]);
assert.deepEqual(zeitraeume([w49, w50], "2026").Peter, [{ von: "2026-12-03", bis: "2026-12-07", tage: 2 }]);

// Jahresgrenze: Tage aus dem Vorjahr in KW 1 zählen nicht
const k1 = parseWeek([["", "Peter"], ["Mo", "Urlaub"], ["Di", "Urlaub"], ["Mi", "Urlaub"], ["Do", "Urlaub"], ["Fr", "Urlaub"]], ["Peter"], mondayOf(2026, 1));
assert.equal(zeitraeume([k1], "2026").Peter[0].von, "2026-01-01");

assert.ok(istUrlaub("URLAUB") && istUrlaub("Urlaub (halber Tag)") && !istUrlaub("Bau Müller") && !istUrlaub(""));
console.log("Urlaub aus Wochenplan: alle Prüfungen bestanden.");
