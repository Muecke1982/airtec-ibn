from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.comments import Comment
from openpyxl.utils import get_column_letter as L

F = "Arial"
HEAD = PatternFill("solid", fgColor="009FDA"); HF = Font(name=F, bold=True, color="FFFFFF")
INPUT = PatternFill("solid", fgColor="FFF7CC")   # vom Büro zu pflegen
APP = PatternFill("solid", fgColor="E8EEF3")     # schreibt die App
thin = Side(style="thin", color="D0D7DE")
def head(ws, cols, widths, fill=HEAD):
    ws.append(cols)
    for c in ws[1]:
        c.font = HF; c.fill = fill; c.alignment = Alignment(vertical="center", wrap_text=True)
    ws.row_dimensions[1].height = 30
    for i, w in enumerate(widths, 1): ws.column_dimensions[L(i)].width = w
    ws.freeze_panes = "A2"

KAT = [
 ("Kupferrohr & Formteile", "🟠", ["Kupferrohr Ring (weich)", "Kupferrohr Stange (hart)", "Kupferrohr vorisoliert", "Bögen", "T-Stücke", "Muffen & Reduzierungen", "Bördelmuttern & Verschraubungen", "Lötfittings sonstige"]),
 ("Isolierung", "🧱", ["Kautschuk-Schlauch", "Kautschuk-Platte & Band", "Kleber & Reiniger", "Isolierband & Klebeband"]),
 ("Kältemittel & Öle", "🧪", ["Kältemittel Einweg/Pfand", "Kältemaschinenöl", "Lecksuchmittel", "Zusätze & Dichtmittel"]),
 ("Löten & Gase", "🔥", ["Hartlot", "Flussmittel", "Stickstoff / Formiergas", "Brenngas (Propan/Acetylen)"]),
 ("Elektro", "⚡", ["Leitungen", "Busleitungen", "Klemmen & Verbinder", "Kabelbinder & Befestigung", "Schutzschlauch & Rohr", "Sicherungen & Schutz"]),
 ("Kondensat", "💧", ["Kondensatpumpen", "Kondensatschlauch", "PVC-Rohr & Formteile", "Siphons & Geruchsverschlüsse", "Heizband"]),
 ("Befestigung & Montage", "🔩", ["Wandkonsolen", "Boden- & Dachständer", "Schwingungsdämpfer", "Montageschienen & Zubehör", "Rohrschellen", "Dübel & Schrauben", "Gewindestangen & Muttern"]),
 ("Leitungsabdeckung", "📏", ["Kanal gerade", "Bögen & Winkel", "Wanddurchführungen & Endstücke", "Zubehör Kanal"]),
 ("Ventile & Regelung", "🔧", ["Schrader-Ventile & Einsätze", "Ventilkappen", "Kugelhähne", "Filtertrockner", "Schaugläser", "Druckschalter & Sensoren", "Fernbedienungen"]),
 ("Lüftung", "🌀", ["Wickelfalzrohr", "Formteile", "Flexrohr", "Gitter & Ventile", "Dichtband & Schellen", "Filter"]),
 ("Verbrauchsmaterial", "📦", ["Silikon & Dichtstoff", "Reiniger & Klimareiniger", "Schutzausrüstung (PSA)", "Bohrer & Kronen", "Trennscheiben & Sägeblätter", "Sonstiges"]),
]
LIEF = [("Mosecker", "", "", "", "", "", "Beispiel – E-Mail-Adresse und Kundennummer bitte eintragen")]
EINH = ["Stk", "m", "Rolle", "Ring", "Karton", "Paket", "Flasche", "Dose", "Kartusche", "Satz", "kg", "l"]

wb = Workbook()
# ---------------- Artikel ----------------
a = wb.active; a.title = "Artikel"
ACOLS = ["Art.-Nr", "Kategorie", "Unterkategorie", "Bezeichnung", "Größe / Typ", "Hersteller", "Lieferant", "Bestellnummer Lieferant",
         "Einheit", "Verpackungsgröße (VE)", "Standard-Bestellmenge", "Lagerort", "Häufig (x)", "Suchbegriffe", "Aktiv (x)", "Bemerkung"]
head(a, ACOLS, [10, 24, 28, 34, 16, 16, 16, 20, 9, 14, 13, 12, 10, 26, 9, 30])
import json, re
EX = json.load(open("../mos/rows.json"))
ORDER = {k[0]: n for n, k in enumerate(KAT)}
SUBORD = {sub: n for _, _, subs in KAT for n, sub in enumerate(subs)}
num = lambda t: float((re.search(r"\d+", t) or [0])[0]) if re.search(r"\d+", t) else 0
EX.sort(key=lambda r: (ORDER.get(r[1], 99), SUBORD.get(r[2], 99), num(r[4] if r[1] != "Befestigung & Montage" else r[3])))
for n, r in enumerate(EX, 1): r[0] = f"L-{n:04d}"

for r in EX: a.append(list(r))
NROWS = 1000
for row in a.iter_rows(min_row=2, max_row=NROWS, max_col=len(ACOLS)):
    for c in row:
        c.font = Font(name=F, size=10); c.fill = INPUT
        c.border = Border(bottom=thin)
for row in a.iter_rows(min_row=2, max_row=NROWS, min_col=8, max_col=8):
    for c in row: c.number_format = "@"      # Bestellnummern als Text (führende Nullen)
a.auto_filter.ref = f"A1:{L(len(ACOLS))}{NROWS}"
a["A1"].comment = Comment("Eindeutige Nummer je Artikel (z. B. L-0001). Bitte nicht mehr ändern – Meldungen aus der App hängen daran.", "Airtec")
a["G1"].comment = Comment("Aus der Liste im Blatt „Lieferanten“ wählen – danach werden Bestellungen gruppiert.", "Airtec")
a["M1"].comment = Comment("x = erscheint in der App oben unter „Häufig“ – für schnelles Melden.", "Airtec")
a["N1"].comment = Comment("Weitere Wörter, unter denen die Monteure suchen (z. B. Markennamen, Abkürzungen).", "Airtec")
a["O1"].comment = Comment("x = in der App sichtbar. Leer = ausgeblendet (z. B. Auslaufartikel).", "Airtec")

# ---------------- Kategorien ----------------
k = wb.create_sheet("Kategorien")
k.append(["Kategorie", "Schlüssel", "Symbol", "Sortierung", "", "Unterkategorien je Kategorie → (Spalten ab F)"])
for c in k[1][:4]: c.font = HF; c.fill = HEAD
k["F1"].font = Font(name=F, bold=True, italic=True, color="555555")
for col, w in zip("ABCD", [28, 10, 8, 11]): k.column_dimensions[col].width = w
for i, (name, sym, subs) in enumerate(KAT, 1):
    key = f"K{i:02d}"
    k.append([name, key, sym, i])
    col = 5 + i                       # F, G, H …
    cl = L(col)
    k.column_dimensions[cl].width = 30
    k.cell(row=2, column=col, value=name).font = HF; k.cell(row=2, column=col).fill = HEAD
    k.cell(row=3, column=col, value=key).font = Font(name=F, size=9, color="888888")
    for j, s in enumerate(subs):
        c = k.cell(row=4 + j, column=col, value=s); c.fill = INPUT; c.font = Font(name=F, size=10)
    for j in range(len(subs), 20):
        k.cell(row=4 + j, column=col).fill = INPUT
    wb.defined_names[key] = DefinedName(key, attr_text=f"Kategorien!${cl}$4:${cl}$23")
for row in k.iter_rows(min_row=2, max_row=1 + len(KAT), max_col=4):
    for c in row: c.fill = INPUT; c.font = Font(name=F, size=10)
for r in range(2 + len(KAT), 31):
    for c in "ABCD": k[f"{c}{r}"].fill = INPUT
k.freeze_panes = "A2"
wb.defined_names["KatListe"] = DefinedName("KatListe", attr_text="Kategorien!$A$2:$A$30")
wb.defined_names["KatTabelle"] = DefinedName("KatTabelle", attr_text="Kategorien!$A$2:$B$30")

# ---------------- Lieferanten ----------------
l = wb.create_sheet("Lieferanten")
head(l, ["Lieferant", "Bestell-E-Mail", "Kopie an (CC)", "Kundennummer", "Ansprechpartner", "Telefon", "Bemerkung"], [22, 32, 28, 16, 22, 18, 40])
for r in LIEF: l.append(list(r))
for row in l.iter_rows(min_row=2, max_row=60, max_col=7):
    for c in row: c.fill = INPUT; c.font = Font(name=F, size=10)
wb.defined_names["LiefListe"] = DefinedName("LiefListe", attr_text="Lieferanten!$A$2:$A$60")

# ---------------- Einheiten (Hilfsliste) ----------------
e = wb.create_sheet("Einheiten")
e.append(["Einheit"]); e["A1"].font = HF; e["A1"].fill = HEAD; e.column_dimensions["A"].width = 14
for x in EINH: e.append([x])
for row in e.iter_rows(min_row=2, max_row=40, max_col=1):
    for c in row: c.fill = INPUT; c.font = Font(name=F, size=10)
wb.defined_names["EinheitListe"] = DefinedName("EinheitListe", attr_text="Einheiten!$A$2:$A$40")

# ---------------- Meldungen (schreibt die App) ----------------
m = wb.create_sheet("Meldungen")
head(m, ["Art.-Nr", "Artikel", "Lieferant", "Status", "Gemeldet von", "Gemeldet am", "Bestellt am", "Bestellt von", "Bemerkung"],
     [10, 34, 16, 14, 20, 17, 17, 20, 30], fill=PatternFill("solid", fgColor="5B6B7A"))
m["D1"].comment = Comment("„Nur noch wenig“ oder „Leer“ – kommt aus der App. Nach der Bestellung trägt die App „Bestellt am“ ein.", "Airtec")

# ---------------- Bestellungen (schreibt die App) ----------------
b = wb.create_sheet("Bestellungen")
head(b, ["Bestellt am", "Lieferant", "An E-Mail", "Bestellt von", "Positionen", "Anzahl Pos."],
     [17, 16, 30, 20, 70, 11], fill=PatternFill("solid", fgColor="5B6B7A"))

# ---------------- Auswahllisten in „Artikel“ ----------------
dv_k = DataValidation(type="list", formula1="=KatListe", allow_blank=True, showErrorMessage=True,
                      errorTitle="Kategorie", error="Bitte eine Kategorie aus der Liste wählen (Blatt „Kategorien“).")
dv_u = DataValidation(type="list", formula1="=INDIRECT(VLOOKUP($B2,KatTabelle,2,FALSE))", allow_blank=True, showErrorMessage=True,
                      errorTitle="Unterkategorie", error="Bitte zuerst die Kategorie wählen, dann eine passende Unterkategorie.")
dv_l = DataValidation(type="list", formula1="=LiefListe", allow_blank=True, showErrorMessage=True,
                      errorTitle="Lieferant", error="Lieferant zuerst im Blatt „Lieferanten“ anlegen.")
dv_e = DataValidation(type="list", formula1="=EinheitListe", allow_blank=True)
dv_x = DataValidation(type="list", formula1='"x"', allow_blank=True)
for dv, rng in [(dv_k, f"B2:B{NROWS}"), (dv_u, f"C2:C{NROWS}"), (dv_l, f"G2:G{NROWS}"), (dv_e, f"I2:I{NROWS}"), (dv_x, f"M2:M{NROWS} O2:O{NROWS}")]:
    a.add_data_validation(dv)
    for part in rng.split(): dv.add(part)

# ---------------- Anleitung ----------------
h = wb.create_sheet("Anleitung", 0)
h.column_dimensions["A"].width = 4; h.column_dimensions["B"].width = 110
lines = [
 ("Airtec Lager – Artikelliste für die App", "t"), ("", ""),
 ("Gelbe Felder pflegt das Büro. Graue Blätter (Meldungen, Bestellungen) schreibt die App – bitte nicht von Hand ändern.", "b"), ("", ""),
 ("Blatt „Artikel“ – eine Zeile je Artikel", "h"),
 ("Art.-Nr: eindeutig (L-0001, L-0002 …), später nicht mehr ändern.", ""),
 ("Kategorie / Unterkategorie: aus der Auswahlliste wählen. Die Unterkategorien passen sich der Kategorie an.", ""),
 ("Bezeichnung + Größe/Typ: so, wie der Monteur den Artikel kennt (z. B. „Kupferrohr weich 1/4\"“ + „6,35 mm“).", ""),
 ("Lieferant + Bestellnummer: daraus baut die App später die Bestell-Mail je Lieferant.", ""),
 ("Einheit, Verpackungsgröße (VE), Standard-Bestellmenge: erscheinen in der Bestell-Vorschau.", ""),
 ("Häufig (x): erscheint in der App ganz oben – für die Artikel, die ständig gemeldet werden.", ""),
 ("Suchbegriffe: zusätzliche Wörter für die Suche (Marken, Abkürzungen, z. B. „armaflex“, „cu“).", ""),
 ("Aktiv (x): nur aktive Artikel erscheinen in der App.", ""),
 ("Eingetragen sind die Mosecker-Artikel aus deiner Liste (Bestellnummer = Mosecker-Artikelnummer). Die Original-Bezeichnung steht in „Bemerkung“.", ""), ("", ""),
 ("Blatt „Kategorien“", "h"),
 ("Spalte A–D: die Hauptkategorien (Name, Schlüssel K01 …, Symbol für die App, Sortierung).", ""),
 ("Ab Spalte F: je Kategorie eine Spalte mit ihren Unterkategorien (bis zu 20). Neue Unterkategorie = einfach darunter eintragen.", ""),
 ("Neue Kategorie: unten in A–D anhängen mit dem nächsten Schlüssel (K12 …) – dann sag Bescheid, damit die Auswahlliste dafür ergänzt wird.", ""), ("", ""),
 ("Blatt „Lieferanten“", "h"),
 ("Name (genau so wie in der Artikel-Spalte „Lieferant“), Bestell-E-Mail, ggf. Kopie, Kundennummer und Ansprechpartner.", ""), ("", ""),
 ("So wird die App arbeiten", "h"),
 ("Monteur sucht den Artikel (Kategorie antippen oder Suche) und meldet „Nur noch wenig“ oder „Leer“ → Zeile im Blatt „Meldungen“.", ""),
 ("Büro: „Was muss bei Mosecker bestellt werden?“ → Vorschau aller offenen Meldungen dieses Lieferanten mit Bestellnummer, VE und Menge.", ""),
 ("„Bestellen“ → Mail an die Bestell-E-Mail des Lieferanten, Eintrag im Blatt „Bestellungen“, Meldungen werden als bestellt markiert.", ""),
]
for i, (t, s) in enumerate(lines, 1):
    c = h.cell(row=i, column=2, value=t)
    c.font = Font(name=F, size=16 if s == "t" else 11, bold=s in ("t", "h", "b"), color="009FDA" if s == "h" else "000000")
    c.alignment = Alignment(wrap_text=True, vertical="top")
h.cell(row=3, column=2).fill = INPUT

wb.active = 1
wb.save("Airtec_Lager.xlsx")
print("ok")
