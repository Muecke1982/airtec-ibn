import json, re
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.comments import Comment
from openpyxl.utils import get_column_letter as L
from openpyxl.worksheet.hyperlink import Hyperlink
def link(c, sheet):
    c.hyperlink = Hyperlink(ref=c.coordinate, location=f"'{sheet}'!A1")

F = "Arial"
BLUE = "009FDA"
HEAD = PatternFill("solid", fgColor=BLUE); HF = Font(name=F, bold=True, color="FFFFFF")
INPUT = PatternFill("solid", fgColor="FFF7CC")
GREY = PatternFill("solid", fgColor="5B6B7A")
thin = Side(style="thin", color="D0D7DE")
NROWS = 400   # Zeilen je Kategorie-Blatt mit Auswahllisten

# (Kategorie, Blattname, Kürzel für Art.-Nr, Symbol, Unterkategorien)
KAT = [
 ("Kupferrohr & Formteile", "Kupfer", "KU", "🟠", ["Kupferrohr Ring (weich)", "Kupferrohr Stange (hart)", "Kupferrohr vorisoliert", "Bögen", "T-Stücke", "Muffen & Reduzierungen", "Bördelmuttern & Verschraubungen", "Lötfittings sonstige"]),
 ("Isolierung", "Isolierung", "IS", "🧱", ["Kautschuk-Schlauch", "Kautschuk-Platte & Band", "Kleber & Reiniger", "Isolierband & Klebeband"]),
 ("Kältemittel & Öle", "Kältemittel", "KM", "🧪", ["Kältemittel Einweg/Pfand", "Kältemaschinenöl", "Lecksuchmittel", "Zusätze & Dichtmittel"]),
 ("Löten & Gase", "Löten", "LG", "🔥", ["Hartlot", "Flussmittel", "Stickstoff / Formiergas", "Brenngas (Propan/Acetylen)"]),
 ("Elektro", "Elektro", "EL", "⚡", ["Leitungen", "Busleitungen", "Klemmen & Verbinder", "Kabelbinder & Befestigung", "Schutzschlauch & Rohr", "Sicherungen & Schutz"]),
 ("Kondensat", "Kondensat", "KO", "💧", ["Kondensatpumpen", "Kondensatschlauch", "PVC-Rohr & Formteile", "Siphons & Geruchsverschlüsse", "Heizband"]),
 ("Befestigung & Montage", "Befestigung", "BF", "🔩", ["Wandkonsolen", "Boden- & Dachständer", "Schwingungsdämpfer", "Montageschienen & Zubehör", "Rohrschellen", "Dübel & Schrauben", "Gewindestangen & Muttern"]),
 ("Leitungsabdeckung", "Abdeckung", "LA", "📏", ["Kanal gerade", "Bögen & Winkel", "Wanddurchführungen & Endstücke", "Zubehör Kanal"]),
 ("Ventile & Regelung", "Ventile", "VR", "🔧", ["Schrader-Ventile & Einsätze", "Ventilkappen", "Kugelhähne", "Filtertrockner", "Schaugläser", "Druckschalter & Sensoren", "Fernbedienungen"]),
 ("Lüftung", "Lüftung", "LU", "🌀", ["Wickelfalzrohr", "Formteile", "Flexrohr", "Gitter & Ventile", "Dichtband & Schellen", "Filter"]),
 ("Verbrauchsmaterial", "Verbrauch", "VB", "📦", ["Silikon & Dichtstoff", "Reiniger & Klimareiniger", "Schutzausrüstung (PSA)", "Bohrer & Kronen", "Trennscheiben & Sägeblätter", "Sonstiges"]),
]
COLS = ["Art.-Nr", "Unterkategorie", "Bezeichnung", "Größe / Typ", "Hersteller", "Lieferant", "Bestellnummer Lieferant",
        "Einheit", "Verpackungsgröße (VE)", "Standard-Bestellmenge", "Lagerort", "Häufig (x)", "Suchbegriffe", "Aktiv (x)", "Bemerkung"]
WID = [10, 28, 36, 18, 15, 14, 20, 9, 15, 13, 12, 10, 28, 9, 40]
EINH = ["Stk", "m", "Rolle", "Ring", "Karton", "Paket", "Flasche", "Dose", "Kartusche", "Satz", "kg", "l"]
LIEF = [("Mosecker", "", "", "", "", "", "E-Mail-Adresse und Kundennummer bitte eintragen")]

# Artikel aus der Mosecker-Liste (Kategorie in Spalte 1 → Blatt)
src = json.load(open("../mos/rows.json"))
by = {k[0]: [] for k in KAT}
for r in src: by[r[1]].append(r)
num = lambda t: float(re.search(r"\d+", t)[0]) if re.search(r"\d+", t) else 0

wb = Workbook()
ov = wb.active; ov.title = "Übersicht"

# ---------------- Kategorie-Blätter ----------------
for idx, (kat, sheet, pre, sym, subs) in enumerate(KAT, 1):
    ws = wb.create_sheet(sheet)
    ws.append(COLS)
    for c in ws[1]:
        c.font = HF; c.fill = HEAD; c.alignment = Alignment(vertical="center", wrap_text=True)
    ws.row_dimensions[1].height = 30
    for i, w in enumerate(WID, 1): ws.column_dimensions[L(i)].width = w
    ws.freeze_panes = "C2"
    ws.sheet_properties.tabColor = BLUE
    rows = sorted(by[kat], key=lambda r: (subs.index(r[2]) if r[2] in subs else 99, num(r[4] if sheet != "Befestigung" else r[3])))
    for n, r in enumerate(rows, 1):
        ws.append([f"{pre}-{n:03d}", r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[12], r[13], r[14], r[15]])
    for row in ws.iter_rows(min_row=2, max_row=NROWS, max_col=len(COLS)):
        for c in row:
            c.font = Font(name=F, size=10); c.fill = INPUT; c.border = Border(bottom=thin)
    for row in ws.iter_rows(min_row=2, max_row=NROWS, min_col=7, max_col=7):
        for c in row: c.number_format = "@"
    ws.auto_filter.ref = f"A1:{L(len(COLS))}{NROWS}"
    # Auswahllisten
    key = f"U_{pre}"
    dvs = [
        (DataValidation(type="list", formula1=key, allow_blank=True, showErrorMessage=True, errorTitle="Unterkategorie",
                        error="Bitte eine Unterkategorie aus der Liste wählen (neue im Blatt „Kategorien“ eintragen)."), f"B2:B{NROWS}"),
        (DataValidation(type="list", formula1="LiefListe", allow_blank=True, showErrorMessage=True, errorTitle="Lieferant",
                        error="Lieferant zuerst im Blatt „Lieferanten“ anlegen."), f"F2:F{NROWS}"),
        (DataValidation(type="list", formula1="EinheitListe", allow_blank=True), f"H2:H{NROWS}"),
        (DataValidation(type="list", formula1='"x"', allow_blank=True), f"L2:L{NROWS}"),
        (DataValidation(type="list", formula1='"x"', allow_blank=True), f"N2:N{NROWS}"),
    ]
    for dv, rng in dvs: ws.add_data_validation(dv); dv.add(rng)
    ws["A1"].comment = Comment(f"Eindeutige Nummer – in diesem Blatt mit „{pre}-“ (z. B. {pre}-001). Die nächste freie Nummer steht in der Übersicht. Später nicht mehr ändern.", "Airtec")
    ws["L1"].comment = Comment("x = erscheint in der App ganz oben unter „Häufig“.", "Airtec")
    ws["M1"].comment = Comment("Weitere Wörter für die Suche in der App (Marken, Abkürzungen).", "Airtec")
    ws["N1"].comment = Comment("x = in der App sichtbar. Leer = ausgeblendet.", "Airtec")
    # Link zurück zur Übersicht
    ws["Q1"] = "← Übersicht"; link(ws["Q1"], "Übersicht"); ws["Q1"].font = Font(name=F, bold=True, color=BLUE, underline="single")
    ws.column_dimensions["Q"].width = 14

# ---------------- Kategorien ----------------
k = wb.create_sheet("Kategorien")
k.append(["Kategorie", "Blatt", "Kürzel", "Symbol", "Sortierung", "", "Unterkategorien je Kategorie (eine Spalte je Kategorie) →"])
for c in k[1][:5]: c.font = HF; c.fill = HEAD
k["G1"].font = Font(name=F, bold=True, italic=True, color="555555")
for col, w in zip("ABCDE", [26, 14, 8, 8, 11]): k.column_dimensions[col].width = w
for i, (kat, sheet, pre, sym, subs) in enumerate(KAT, 1):
    k.append([kat, sheet, pre, sym, i])
    col = 6 + i; cl = L(col)
    k.column_dimensions[cl].width = 30
    hc = k.cell(row=2, column=col, value=kat); hc.font = HF; hc.fill = HEAD
    for j in range(20):
        c = k.cell(row=3 + j, column=col, value=subs[j] if j < len(subs) else None); c.fill = INPUT; c.font = Font(name=F, size=10)
    wb.defined_names[f"U_{pre}"] = DefinedName(f"U_{pre}", attr_text=f"Kategorien!${cl}$3:${cl}$22")
for row in k.iter_rows(min_row=2, max_row=1 + len(KAT), max_col=5):
    for c in row: c.fill = INPUT; c.font = Font(name=F, size=10)
k.freeze_panes = "A2"

# ---------------- Lieferanten / Einheiten ----------------
l = wb.create_sheet("Lieferanten")
l.append(["Lieferant", "Bestell-E-Mail", "Kopie an (CC)", "Kundennummer", "Ansprechpartner", "Telefon", "Bemerkung"])
for c in l[1]: c.font = HF; c.fill = HEAD
for col, w in zip("ABCDEFG", [22, 32, 28, 16, 22, 18, 40]): l.column_dimensions[col].width = w
for r in LIEF: l.append(list(r))
for row in l.iter_rows(min_row=2, max_row=40, max_col=7):
    for c in row: c.fill = INPUT; c.font = Font(name=F, size=10)
l.freeze_panes = "A2"
wb.defined_names["LiefListe"] = DefinedName("LiefListe", attr_text="Lieferanten!$A$2:$A$40")
e = wb.create_sheet("Einheiten")
e.append(["Einheit"]); e["A1"].font = HF; e["A1"].fill = HEAD; e.column_dimensions["A"].width = 14
for x in EINH: e.append([x])
for row in e.iter_rows(min_row=2, max_row=40, max_col=1):
    for c in row: c.fill = INPUT; c.font = Font(name=F, size=10)
wb.defined_names["EinheitListe"] = DefinedName("EinheitListe", attr_text="Einheiten!$A$2:$A$40")

# ---------------- Meldungen / Bestellungen (schreibt die App) ----------------
for name, cols, wid in [("Meldungen", ["Art.-Nr", "Artikel", "Lieferant", "Status", "Gemeldet von", "Gemeldet am", "Bestellt am", "Bestellt von", "Bemerkung"], [10, 34, 16, 14, 20, 17, 17, 20, 30]),
                        ("Bestellungen", ["Bestellt am", "Lieferant", "An E-Mail", "Bestellt von", "Positionen", "Anzahl Pos."], [17, 16, 30, 20, 70, 11])]:
    s = wb.create_sheet(name); s.append(cols)
    for c in s[1]: c.font = HF; c.fill = GREY
    for i, w in enumerate(wid, 1): s.column_dimensions[L(i)].width = w
    s.freeze_panes = "A2"; s.sheet_properties.tabColor = "5B6B7A"

# ---------------- Übersicht ----------------
ov.column_dimensions["A"].width = 3
for col, w in zip("BCDEFG", [30, 12, 10, 12, 16, 50]): ov.column_dimensions[col].width = w
ov["B1"] = "Airtec Lager – Übersicht"; ov["B1"].font = Font(name=F, size=16, bold=True)
ov["B2"] = "Kategorie anklicken → springt in das Blatt. Gelbe Felder pflegt das Büro, graue Blätter schreibt die App."; ov["B2"].font = Font(name=F, size=10, italic=True, color="555555")
hdr = ["Kategorie (Link)", "Artikel", "davon aktiv", "nächste Nr.", "Unterkategorien – Anzahl Artikel"]
for i, h in enumerate(hdr):
    c = ov.cell(row=4, column=2 + i, value=h); c.font = HF; c.fill = HEAD
r0 = 5
for i, (kat, sheet, pre, sym, subs) in enumerate(KAT):
    r = r0 + i
    q = f"'{sheet}'"
    c = ov.cell(row=r, column=2, value=f"{sym}  {kat}"); link(c, sheet); c.font = Font(name=F, color=BLUE, underline="single", bold=True)
    ov.cell(row=r, column=3, value=f"=COUNTA({q}!A2:A{NROWS})")
    ov.cell(row=r, column=4, value=f'=COUNTIF({q}!N2:N{NROWS},"x")')
    ov.cell(row=r, column=5, value=f'="{pre}-"&TEXT(SUMPRODUCT(MAX(IFERROR(VALUE(MID({q}!A2:A{NROWS},4,4)),0)))+1,"000")')
    # Unterkategorien mit Anzahl als Text, z. B. "Stange (hart): 10 · vorisoliert: 7"
    parts = [f'IF(COUNTIF({q}!B2:B{NROWS},"{s}")>0,"{s}: "&COUNTIF({q}!B2:B{NROWS},"{s}")&"   ","")' for s in subs]
    ov.cell(row=r, column=6, value="=" + "&".join(parts))
    for col in range(2, 7): ov.cell(row=r, column=col).border = Border(bottom=thin)
    for col in range(3, 6): ov.cell(row=r, column=col).alignment = Alignment(horizontal="center")
ov.merge_cells(start_row=4, start_column=6, end_row=4, end_column=7)
for i in range(len(KAT)): ov.merge_cells(start_row=r0 + i, start_column=6, end_row=r0 + i, end_column=7)
rt = r0 + len(KAT)
ov.cell(row=rt, column=2, value="Summe").font = Font(name=F, bold=True)
ov.cell(row=rt, column=3, value=f"=SUM(C{r0}:C{rt-1})").font = Font(name=F, bold=True)
ov.cell(row=rt, column=4, value=f"=SUM(D{r0}:D{rt-1})").font = Font(name=F, bold=True)

# Lieferanten-Übersicht
rl = rt + 3
for i, h in enumerate(["Lieferant", "Artikel", "", "", "Bestell-E-Mail"]):
    c = ov.cell(row=rl, column=2 + i, value=h or None); c.font = HF; c.fill = HEAD
for i in range(15):
    r = rl + 1 + i
    ov.cell(row=r, column=2, value=f'=IF(Lieferanten!A{2+i}="","",Lieferanten!A{2+i})')
    cnt = "+".join(f"COUNTIF('{s}'!F2:F{NROWS},B{r})" for _, s, *_ in KAT)
    ov.cell(row=r, column=3, value=f'=IF(B{r}="","",{cnt})').alignment = Alignment(horizontal="center")
    ov.cell(row=r, column=6, value=f'=IF(B{r}="","",IF(Lieferanten!B{2+i}="","– fehlt –",Lieferanten!B{2+i}))')
# weitere Links
rlk = rl + 18
for j, (txt, tgt) in enumerate([("Kategorien & Unterkategorien bearbeiten", "Kategorien"), ("Lieferanten bearbeiten", "Lieferanten"),
                                 ("Meldungen aus der App ansehen", "Meldungen"), ("Bestellungen ansehen", "Bestellungen")]):
    c = ov.cell(row=rlk + j, column=2, value="→ " + txt); link(c, tgt); c.font = Font(name=F, color=BLUE, underline="single")
ov.sheet_properties.tabColor = "1F2937"
for row in ov.iter_rows(min_row=4, max_row=rlk + 4, min_col=2, max_col=7):
    for c in row:
        if c.font is None or c.font.name != F: c.font = Font(name=F, size=10, bold=c.font.b if c.font else False, color=c.font.color if c.font else None, underline=c.font.u if c.font else None)

# ---------------- Anleitung ----------------
h = wb.create_sheet("Anleitung", 1)
h.column_dimensions["A"].width = 3; h.column_dimensions["B"].width = 110
lines = [("So pflegt ihr die Lagerliste", "t"), ("", ""),
 ("Jede Hauptkategorie hat ein eigenes Blatt (Kupfer, Isolierung, Elektro …) – dort nur die Artikel dieser Gruppe.", ""),
 ("In jedem Blatt: oben in der Kopfzeile über die Filterpfeile z. B. nur eine Unterkategorie oder einen Lieferanten anzeigen.", ""),
 ("Neuer Artikel: im passenden Blatt unten anhängen. Art.-Nr = nächste freie Nr. aus der Übersicht (z. B. KU-018).", ""),
 ("Unterkategorie, Lieferant, Einheit: aus der Auswahlliste wählen.", ""),
 ("Lieferant + Bestellnummer: daraus baut die App die Bestell-Mail je Lieferant.", ""),
 ("Häufig (x): oben in der App. Aktiv (x): nur aktive Artikel erscheinen in der App.", ""), ("", ""),
 ("Kategorien ändern", "h"),
 ("Neue Unterkategorie: im Blatt „Kategorien“ in der Spalte der Kategorie unten eintragen – erscheint sofort in der Auswahlliste.", ""),
 ("Neue Hauptkategorie oder Blatt umbenennen: bitte kurz Bescheid geben, damit Auswahllisten und App angepasst werden.", ""), ("", ""),
 ("Was die App damit macht", "h"),
 ("Monteur meldet „Nur noch wenig“ oder „Leer“ → Blatt „Meldungen“.", ""),
 ("Büro: Vorschau „Was muss bei Mosecker bestellt werden?“ → Bestell-Mail an die E-Mail aus „Lieferanten“ → Blatt „Bestellungen“.", "")]
for i, (t, s) in enumerate(lines, 1):
    c = h.cell(row=i, column=2, value=t)
    c.font = Font(name=F, size=16 if s == "t" else 11, bold=s in ("t", "h"), color=BLUE if s == "h" else "000000")
    c.alignment = Alignment(wrap_text=True)
wb.active = 0
wb.save("Airtec_Lager.xlsx")
print("ok")
