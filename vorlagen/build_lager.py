import json, re
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.comments import Comment
from openpyxl.utils import get_column_letter as L
from openpyxl.worksheet.hyperlink import Hyperlink

F = "Arial"; BLUE = "009FDA"
HEAD = PatternFill("solid", fgColor=BLUE); HF = Font(name=F, bold=True, color="FFFFFF")
INPUT = PatternFill("solid", fgColor="FFF7CC"); FREE = PatternFill("solid", fgColor="FFFBE6")
GREY = PatternFill("solid", fgColor="5B6B7A"); thin = Side(style="thin", color="D0D7DE")
NROWS = 400      # Artikelzeilen je Blatt
SLOTS = 30       # max. Unterkategorien je Kategorie
def link(c, sheet): c.hyperlink = Hyperlink(ref=c.coordinate, location=f"'{sheet}'!A1")

# (Kategorie, Blatt, Kürzel, Symbol, Unterkategorien, zusätzlich vorgesehene leere Plätze)
KAT = [
 ("Kupfer Kälte", "Kupfer Kälte", "KK", "🟠", ["Rollenrohr", "Stangenrohr", "Fittinge"], 5),
 ("Elektro", "Elektro", "EL", "⚡", ["Kabel", "Kabelbühne", "PG-Rohr", "Wellrohr", "Bauteile"], 5),
 ("Abfluss", "Abfluss", "AB", "💧", ["HI-Rohr", "Fittinge", "Kondensatpumpen", "Schlauch", "Siphons", "Kleber & Reiniger", "Verschraubungen & Schellen"], 3),
 ("Schrauben", "Schrauben", "SC", "🔩", [], 10),
 ("Montagematerial", "Montagematerial", "MO", "🛠️", ["Schiene", "Zubehör Schiene", "Konsolen", "Rohrschellen", "P-Schellen", "Kälteschellen"], 10),
 ("Isolierung", "Isolierung", "IS", "🧱", ["Kautschuk endlos", "Kautschuk 2 m", "Kautschuk Matte"], 10),
 ("Kältezubehör", "Kältezubehör", "KZ", "❄️", ["Dachdurchführungen", "Aufstellfüße", "Ölprotektoren", "Schrader", "Bördel", "Hartlot & Löten"], 19),
 ("Kältemittel", "Kältemittel", "KM", "🧪", ["Kältemittel", "Entsorgung", "Gase"], 7),
] + [(None, f"Frei {i}", f"R{i}", "▫️", [], 10) for i in range(1, 6)]
NK = len(KAT)

# Mosecker-Artikel neu zuordnen
MAP = {"Kupferrohr Stange (hart)": ("Kupfer Kälte", "Stangenrohr"), "Kupferrohr vorisoliert": ("Kupfer Kälte", "Rollenrohr"),
       "Hartlot": ("Kältezubehör", "Hartlot & Löten"), "Boden- & Dachständer": ("Kältezubehör", "Aufstellfüße"),
       "Rohrschellen": ("Montagematerial", "Kälteschellen")}
src = json.load(open("quellen/mosecker_1.json"))
by = {k[1]: [] for k in KAT}
for r in src:
    kat, sub = MAP[r[2]]; r[1], r[2] = kat, sub; by[kat].append(r)
for f in ["quellen/mosecker_2.json", "quellen/mosecker_3.json"]:   # weitere Mosecker-Listen (Kategorie schon gesetzt)
    for r in json.load(open(f)): by[r[1]].append(r)
for k in by:                                   # Reihenfolge der Quelle merken
    for n, r in enumerate(by[k]): r.append(n)
num = lambda t: float(re.search(r"\d+", t)[0]) if re.search(r"\d+", t) else 0

COLS = ["Art.-Nr", "Unterkategorie", "Bezeichnung", "Größe / Typ", "Hersteller", "Lieferant", "Bestellnummer Lieferant",
        "Einheit", "Verpackungsgröße (VE)", "Standard-Bestellmenge", "Lagerort", "Häufig (x)", "Suchbegriffe", "Aktiv (x)", "Bemerkung"]
WID = [10, 26, 38, 18, 15, 14, 20, 9, 15, 13, 12, 10, 28, 9, 46]

wb = Workbook(); ov = wb.active; ov.title = "Übersicht"
KROW = lambda i: 2 + i   # Zeile der Kategorie i im Blatt „Kategorien“

# ---------------- Blatt je Kategorie ----------------
for i, (kat, sheet, pre, sym, subs, extra) in enumerate(KAT):
    ws = wb.create_sheet(sheet); ws.append(COLS)
    for c in ws[1]: c.font = HF; c.fill = HEAD; c.alignment = Alignment(vertical="center", wrap_text=True)
    ws.row_dimensions[1].height = 30
    for j, w in enumerate(WID, 1): ws.column_dimensions[L(j)].width = w
    ws.freeze_panes = "C2"; ws.sheet_properties.tabColor = BLUE if kat else "C8D1DA"
    if kat:
        def width(r):
            m = re.search(r"x\s*(\d+)\s*mm|(\d+)\s*mm", r[3]); return float(next(g for g in m.groups() if g)) if m else 0
        if kat in ("Kupfer Kälte", "Kältezubehör", "Montagematerial"):
            rows = sorted(by[kat], key=lambda r: (subs.index(r[2]), num(r[4] if kat == "Kupfer Kälte" else r[3])))
        else:   # Elektro, Abfluss …: Reihenfolge der Lieferantenliste, Kabelbahnen vor Deckeln nach Breite
            rows = sorted(by[kat], key=lambda r: (subs.index(r[2]), ("Deckel" in r[3]), width(r) if r[2] == "Kabelbühne" else r[-1]))
        for n, r in enumerate(rows, 1):
            ws.append([f"{pre}-{n:03d}", r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[12], r[13], r[14], r[15]])
    for row in ws.iter_rows(min_row=2, max_row=NROWS, max_col=len(COLS)):
        for c in row: c.font = Font(name=F, size=10); c.fill = INPUT; c.border = Border(bottom=thin)
    for row in ws.iter_rows(min_row=2, max_row=NROWS, min_col=7, max_col=7):
        for c in row: c.number_format = "@"
    ws.auto_filter.ref = f"A1:{L(len(COLS))}{NROWS}"
    for dv, rng in [
        (DataValidation(type="list", formula1=f"U_{i+1:02d}", allow_blank=True, showErrorMessage=True, errorTitle="Unterkategorie",
                        error="Bitte aus der Liste wählen. Neue Unterkategorien im Blatt „Kategorien“ eintragen."), f"B2:B{NROWS}"),
        (DataValidation(type="list", formula1="LiefListe", allow_blank=True, showErrorMessage=True, errorTitle="Lieferant",
                        error="Lieferant zuerst im Blatt „Lieferanten“ anlegen."), f"F2:F{NROWS}"),
        (DataValidation(type="list", formula1="EinheitListe", allow_blank=True), f"H2:H{NROWS}"),
        (DataValidation(type="list", formula1='"x"', allow_blank=True), f"L2:L{NROWS}"),
        (DataValidation(type="list", formula1='"x"', allow_blank=True), f"N2:N{NROWS}")]:
        ws.add_data_validation(dv); dv.add(rng)
    ws["A1"].comment = Comment(f"Art.-Nr mit Kürzel „{pre}-“ (z. B. {pre}-001). Nächste freie Nummer: siehe Übersicht. Später nicht mehr ändern.", "Airtec")
    ws["L1"].comment = Comment("x = erscheint in der App ganz oben unter „Häufig“.", "Airtec")
    ws["M1"].comment = Comment("Weitere Wörter für die Suche in der App (Marken, Abkürzungen).", "Airtec")
    ws["N1"].comment = Comment("x = in der App sichtbar. Leer = ausgeblendet.", "Airtec")
    ws["Q1"] = "← Übersicht"; link(ws["Q1"], "Übersicht"); ws["Q1"].font = Font(name=F, bold=True, color=BLUE, underline="single")
    ws.column_dimensions["Q"].width = 14
    if not kat:
        ws["Q3"] = "Reserve-Blatt: im Blatt „Kategorien“ Namen eintragen und dieses Blatt genauso umbenennen wie in Spalte „Blatt“."
        ws["Q3"].font = Font(name=F, italic=True, color="888888")

# ---------------- Kategorien (mit Anzahl je Unterkategorie) ----------------
k = wb.create_sheet("Kategorien")
k.append(["Kategorie", "Blatt", "Kürzel", "Symbol", "Sortierung"])
for c in k[1]: c.font = HF; c.fill = HEAD
for col, w in zip("ABCDE", [22, 18, 8, 8, 11]): k.column_dimensions[col].width = w
for i, (kat, sheet, pre, sym, subs, extra) in enumerate(KAT):
    k.append([kat, sheet, pre, sym, i + 1])
for row in k.iter_rows(min_row=2, max_row=1 + NK, max_col=5):
    for c in row: c.fill = INPUT; c.font = Font(name=F, size=10)
k["A"+str(2+NK+1)] = "Freie Zeilen = vorgesehene Hauptkategorien: Namen eintragen und das Blatt „Frei …“ genauso umbenennen wie in Spalte „Blatt“."
k["A"+str(2+NK+1)].font = Font(name=F, italic=True, size=9, color="777777")
# Unterkategorien: je Kategorie zwei Spalten (Name | Anzahl Artikel), ab Spalte G
k["G1"] = "Unterkategorien je Kategorie – gelbe Felder = vorgesehene Plätze, von oben nach unten ohne Lücke füllen"
k["G1"].font = Font(name=F, bold=True, italic=True, color="555555")
for i, (kat, sheet, pre, sym, subs, extra) in enumerate(KAT):
    cn, cc = 7 + 2 * i, 8 + 2 * i
    ln, lc = L(cn), L(cc)
    k.column_dimensions[ln].width = 24; k.column_dimensions[lc].width = 6
    h = k.cell(row=2, column=cn, value=f'=IF(A{KROW(i)}="","(frei – "&B{KROW(i)}&")",A{KROW(i)})'); h.font = HF; h.fill = HEAD
    hc = k.cell(row=2, column=cc, value="Anz."); hc.font = HF; hc.fill = HEAD
    for j in range(SLOTS):
        r = 3 + j
        c = k.cell(row=r, column=cn, value=subs[j] if j < len(subs) else None); c.font = Font(name=F, size=10)
        if j < len(subs) + extra: c.fill = INPUT if j < len(subs) else FREE
        c.border = Border(bottom=thin)
        cnt = k.cell(row=r, column=cc, value=f'=IF({ln}{r}="","",IFERROR(COUNTIF(\'{sheet}\'!$B$2:$B${NROWS},{ln}{r}),0))')
        cnt.font = Font(name=F, size=9, color="555555"); cnt.alignment = Alignment(horizontal="center")
    # Auswahlliste: nur die ausgefüllten Plätze (ohne leere Einträge)
    wb.defined_names[f"U_{i+1:02d}"] = DefinedName(f"U_{i+1:02d}", attr_text=f"OFFSET(Kategorien!${ln}$3,0,0,MAX(1,COUNTA(Kategorien!${ln}$3:${ln}${2+SLOTS})),1)")
k.freeze_panes = "G3"

# ---------------- Lieferanten / Einheiten ----------------
l = wb.create_sheet("Lieferanten")
l.append(["Lieferant", "Bestell-E-Mail", "Kopie an (CC)", "Kundennummer", "Ansprechpartner", "Telefon", "Bemerkung"])
for c in l[1]: c.font = HF; c.fill = HEAD
for col, w in zip("ABCDEFG", [22, 32, 28, 16, 22, 18, 40]): l.column_dimensions[col].width = w
l.append(["Mosecker", "", "", "", "", "", "E-Mail-Adresse und Kundennummer bitte eintragen"])
for row in l.iter_rows(min_row=2, max_row=40, max_col=7):
    for c in row: c.fill = INPUT; c.font = Font(name=F, size=10)
l.freeze_panes = "A2"
wb.defined_names["LiefListe"] = DefinedName("LiefListe", attr_text="OFFSET(Lieferanten!$A$2,0,0,MAX(1,COUNTA(Lieferanten!$A$2:$A$40)),1)")
e = wb.create_sheet("Einheiten"); e.append(["Einheit"]); e["A1"].font = HF; e["A1"].fill = HEAD; e.column_dimensions["A"].width = 14
for x in ["Stk", "m", "Rolle", "Ring", "Karton", "Paket", "Flasche", "Dose", "Kartusche", "Satz", "kg", "l"]: e.append([x])
for row in e.iter_rows(min_row=2, max_row=40, max_col=1):
    for c in row: c.fill = INPUT; c.font = Font(name=F, size=10)
wb.defined_names["EinheitListe"] = DefinedName("EinheitListe", attr_text="OFFSET(Einheiten!$A$2,0,0,MAX(1,COUNTA(Einheiten!$A$2:$A$40)),1)")

# ---------------- Meldungen / Bestellungen (schreibt die App) ----------------
for name, cols, wid in [("Meldungen", ["Art.-Nr", "Artikel", "Lieferant", "Status", "Gemeldet von", "Gemeldet am", "Bestellt am", "Bestellt von", "Bemerkung"], [10, 34, 16, 14, 20, 17, 17, 20, 30]),
                        ("Bestellungen", ["Bestellt am", "Lieferant", "An E-Mail", "Bestellt von", "Positionen", "Anzahl Pos."], [17, 16, 30, 20, 70, 11])]:
    s = wb.create_sheet(name); s.append(cols)
    for c in s[1]: c.font = HF; c.fill = GREY
    for j, w in enumerate(wid, 1): s.column_dimensions[L(j)].width = w
    s.freeze_panes = "A2"; s.sheet_properties.tabColor = "5B6B7A"

# ---------------- Übersicht (alles über das Blatt „Kategorien“ – passt sich Umbenennungen an) ----------------
ov.column_dimensions["A"].width = 3
for col, w in zip("BCDEFG", [30, 10, 11, 12, 16, 34]): ov.column_dimensions[col].width = w
ov["B1"] = "Airtec Lager – Übersicht"; ov["B1"].font = Font(name=F, size=16, bold=True)
ov["B2"] = "Kategorie anklicken → springt in das Blatt. Gelbe Felder pflegt das Büro, graue Blätter schreibt die App."
ov["B2"].font = Font(name=F, size=10, italic=True, color="555555")
for j, hname in enumerate(["Kategorie (Link)", "Artikel", "davon aktiv", "nächste Nr.", "Unterkat. belegt", "Lieferanten ohne Bestellnummer"]):
    c = ov.cell(row=4, column=2 + j, value=hname); c.font = HF; c.fill = HEAD; c.alignment = Alignment(wrap_text=True, vertical="center")
ov.row_dimensions[4].height = 30
r0 = 5
for i, (kat, sheet, pre, sym, subs, extra) in enumerate(KAT):
    r, kr = r0 + i, KROW(i)
    rng = lambda col: f"'{sheet}'!${col}$2:${col}${NROWS}"
    ov.cell(row=r, column=2, value=f'=HYPERLINK("#\'"&Kategorien!$B${kr}&"\'!A1",Kategorien!$D${kr}&"  "&IF(Kategorien!$A${kr}="","(frei) "&Kategorien!$B${kr},Kategorien!$A${kr}))')
    ov.cell(row=r, column=2).font = Font(name=F, color=BLUE if kat else "999999", underline="single", bold=bool(kat))
    ov.cell(row=r, column=3, value=f"=IFERROR(COUNTA({rng('A')}),0)")
    ov.cell(row=r, column=4, value=f'=IFERROR(COUNTIF({rng("N")},"x"),0)')
    ov.cell(row=r, column=5, value=f'=Kategorien!$C${kr}&"-"&TEXT(SUMPRODUCT(MAX(IFERROR(VALUE(MID({rng("A")},LEN(Kategorien!$C${kr})+2,4)),0)))+1,"000")')
    cn = L(7 + 2 * i)
    ov.cell(row=r, column=6, value=f'=SUMPRODUCT((Kategorien!{L(8+2*i)}3:{L(8+2*i)}{2+SLOTS}<>"")*(Kategorien!{L(8+2*i)}3:{L(8+2*i)}{2+SLOTS}>0))&" von "&COUNTA(Kategorien!{cn}3:{cn}{2+SLOTS})')
    ov.cell(row=r, column=7, value=f'=IF(SUMPRODUCT(({rng("C")}<>"")*({rng("G")}=""))=0,"–",SUMPRODUCT(({rng("C")}<>"")*({rng("G")}=""))&" Artikel")')
    for col in range(2, 8):
        ov.cell(row=r, column=col).border = Border(bottom=thin)
        if col > 2: ov.cell(row=r, column=col).alignment = Alignment(horizontal="center"); ov.cell(row=r, column=col).font = Font(name=F, size=10)
rt = r0 + NK
ov.cell(row=rt, column=2, value="Summe").font = Font(name=F, bold=True)
for col in "CD": ov[f"{col}{rt}"] = f"=SUM({col}{r0}:{col}{rt-1})"; ov[f"{col}{rt}"].font = Font(name=F, bold=True); ov[f"{col}{rt}"].alignment = Alignment(horizontal="center")
# Lieferanten
rl = rt + 3
for j, hname in enumerate(["Lieferant", "Artikel", "", "", "Bestell-E-Mail"]):
    c = ov.cell(row=rl, column=2 + j, value=hname or None); c.font = HF; c.fill = HEAD
ov.merge_cells(start_row=rl, start_column=6, end_row=rl, end_column=7)
for i in range(12):
    r = rl + 1 + i
    ov.cell(row=r, column=2, value=f'=IF(Lieferanten!A{2+i}="","",Lieferanten!A{2+i})').font = Font(name=F, size=10)
    cnt = "+".join(f"COUNTIF('{KAT[j][1]}'!$F$2:$F${NROWS},B{r})" for j in range(NK))
    c = ov.cell(row=r, column=3, value=f'=IF(B{r}="","",{cnt})'); c.alignment = Alignment(horizontal="center"); c.font = Font(name=F, size=10)
    ov.cell(row=r, column=6, value=f'=IF(B{r}="","",IF(Lieferanten!B{2+i}="","– fehlt –",Lieferanten!B{2+i}))').font = Font(name=F, size=10)
    ov.merge_cells(start_row=r, start_column=6, end_row=r, end_column=7)
rlk = rl + 15
for j, (txt, tgt) in enumerate([("Kategorien & Unterkategorien bearbeiten (mit Anzahl je Unterkategorie)", "Kategorien"), ("Lieferanten bearbeiten", "Lieferanten"),
                                 ("Meldungen aus der App ansehen", "Meldungen"), ("Bestellungen ansehen", "Bestellungen")]):
    c = ov.cell(row=rlk + j, column=2, value="→ " + txt); link(c, tgt); c.font = Font(name=F, color=BLUE, underline="single")
ov.sheet_properties.tabColor = "1F2937"

# ---------------- Anleitung ----------------
h = wb.create_sheet("Anleitung", 1)
h.column_dimensions["A"].width = 3; h.column_dimensions["B"].width = 115
lines = [("So pflegt ihr die Lagerliste", "t"), ("", ""),
 ("Jede Hauptkategorie hat ein eigenes Blatt – dort nur die Artikel dieser Gruppe. In der Übersicht die Kategorie anklicken.", ""),
 ("Im Blatt über die Filterpfeile der Kopfzeile z. B. nur eine Unterkategorie oder einen Lieferanten anzeigen.", ""),
 ("Neuer Artikel: im passenden Blatt unten anhängen. Art.-Nr = nächste freie Nr. aus der Übersicht (z. B. KK-018).", ""),
 ("Unterkategorie, Lieferant, Einheit: aus der Auswahlliste wählen. Lieferant + Bestellnummer = Grundlage für die Bestell-Mail.", ""),
 ("Häufig (x): oben in der App. Aktiv (x): nur aktive Artikel erscheinen in der App.", ""), ("", ""),
 ("Unterkategorien", "h"),
 ("Im Blatt „Kategorien“ hat jede Hauptkategorie eine Spalte. Hellgelbe Felder sind vorgesehene, noch freie Plätze.", ""),
 ("Neue Unterkategorie: in das nächste freie Feld der Spalte eintragen (von oben ohne Lücke) – erscheint sofort in der Auswahlliste.", ""),
 ("Daneben steht, wie viele Artikel in jeder Unterkategorie sind.", ""), ("", ""),
 ("Weitere Hauptkategorien (6 vorgesehen)", "h"),
 ("Im Blatt „Kategorien“ in einer freien Zeile den Namen in Spalte A eintragen, z. B. „Werkzeug“.", ""),
 ("Dann das passende Reserve-Blatt („Frei 1“ …) umbenennen und den neuen Blattnamen auch in Spalte B eintragen (für den Link in der Übersicht). Kürzel in Spalte C ggf. anpassen.", ""),
 ("Übersicht, Links und Zähler passen sich automatisch an.", ""), ("", ""),
 ("Was die App damit macht", "h"),
 ("Monteur meldet „Nur noch wenig“ oder „Leer“ → Blatt „Meldungen“.", ""),
 ("Büro: Vorschau „Was muss bei Mosecker bestellt werden?“ → Bestell-Mail an die E-Mail aus „Lieferanten“ → Blatt „Bestellungen“.", "")]
for i, (t, s) in enumerate(lines, 1):
    c = h.cell(row=i, column=2, value=t)
    c.font = Font(name=F, size=16 if s == "t" else 11, bold=s in ("t", "h"), color=BLUE if s == "h" else "000000")
wb.active = 0
wb.save("Airtec_Lager.xlsx"); print("ok")
