import sys, re, json, warnings, openpyxl
warnings.filterwarnings("ignore")
rows = []
for f in sys.argv[1:]:
    ws = openpyxl.load_workbook(f, read_only=True).worksheets[0]
    rows += [r for r in ws.iter_rows(min_row=2, values_only=True) if r[0]]
EIN = {"Meter": "m", "Stück": "Stk", "Rolle": "Rolle", "Kilo": "kg"}
NEUTRAL = {"Fabrikatsneutrales Zubehör", "allgemeiner Kabellieferant", None}
out = []
def add(kat, sub, bez, gr, herst, nr, einh, ve, such, orig):
    out.append(["", kat, sub, bez, gr, "" if herst in NEUTRAL else herst, "Mosecker", nr, einh, ve, "", "", "", such, "x", "Mosecker: " + orig])
for r in rows:
    nr, b1, b2, herst, me = r[0], (r[1] or "").strip(), (r[2] or "").strip(), r[4], EIN.get(r[10], r[10])
    orig = (b1 + " " + b2).strip(); t = orig.lower()
    if b1.startswith("Mantelleitung NYM"):
        q = re.search(r"(\d+x[\d,]+)qmm", b2).group(1)
        add("Elektro", "Kabel", f"Mantelleitung NYM-J {q} mm²", f"{q} mm² grau", herst, nr, "m", "Ring 50 m", f"nym kabel mantelleitung {q.replace(',', '.')} {q}", orig)
    elif "LIYCY" in b1:
        q = re.search(r"(\d+x[\d,]+)", b2).group(1)
        add("Elektro", "Kabel", f"Steuerleitung LiYCY {q} mm² (geschirmt)", f"{q} mm² grau, flexibel", herst, nr, "m", "Ring 100 m", f"liycy steuerleitung datenleitung bus abgeschirmt {q}", orig)
    elif b1.startswith("EATON"):
        typ = re.search(r"(P\d-\d+|T0?O?-\d-\d+)", b1.replace("TO-", "T0-")); typ = typ.group(1) if typ else ""
        amp = re.search(r"(\d+)A", b2); amp = amp.group(1) + " A" if amp else ""
        art = re.search(r"EATON (\d{6})", b1); art = art.group(1) if art else ""
        rep = "Reparaturschalter" if "Reparatur" in b1 else "Hauptschalter"
        extra = " 3+N" if "3+N" in b2 else ""
        add("Elektro", "Bauteile", f"{rep} Eaton {typ}{extra} (Aufbau)", ", ".join(x for x in [amp, "IP65" if "IP65" in orig else "", "Art. " + art if art else ""] if x), "Eaton", nr, "Stk", "1 Stk",
            f"hauptschalter reparaturschalter revisionsschalter eaton moeller {typ.lower()} {amp.replace(' ', '').lower()}", orig)
    elif b1.startswith("PVC-U-Rohr"):
        d = re.search(r"PVC-U-Rohr (\d+) x ([\d,]+)mm", b1); D, s = d.groups()
        add("Abfluss", "HI-Rohr", f"HI-Rohr PVC-U {D} mm PN 16", f"{D} x {s} mm, gemufft", herst, nr, "m", "Rohr 5 m", f"hi rohr pvc kleberohr druckrohr {D}mm", orig)
    elif b1.startswith("HI-") or "HI-T-Stueck" in b1:
        d = re.search(r"d=([\dx ]+?)(?:mm|a|,)", b2) or re.search(r"d=(\d+)mm", b1); D = (d.group(1).strip() if d else "")
        if "Winkel" in b1:
            g = "45°" if "45 Grad" in b1 else "90°"; bez = f"HI-Winkel {g} d {D} mm"; such = f"winkel bogen hi pvc {D} {g.strip('°')}"
        elif "T-Stueck" in b1:
            red = "reduziert" in b1; bez = f"HI-T-Stück {'reduziert ' if red else ''}d {D} mm"; such = f"t-stück abzweig hi pvc {D.replace(' ', '')}"
        elif "Muffennippel" in b1:
            bez = "HI-Übergangs-Muffennippel 32/25 x 3/4\" AG"; D = "32a/25i x 3/4\" AG"; such = "übergang nippel gewinde hi pvc 3/4"
        elif "Reduzier-Nippel" in b1:
            bez = "HI-Reduzier-Nippel 25/20 x 1/2\" IG"; D = "25a/20i x 1/2\" IG"; such = "reduzier nippel gewinde hi pvc 1/2"
        else:
            bez = f"HI-Muffe d {D} mm"; such = f"muffe hi pvc {D}"
        add("Abfluss", "Fittinge", bez, (D + (" mm" if D.isdigit() else "")) + ", PN 16", herst, nr, "Stk", "1 Stk", such, orig)
    elif "Siphon" in b1:
        add("Abfluss", "Siphons", "Kondensat-Siphon Wandeinbau Dallmer 138 DN32", "DN32, Nr. 26200", herst, nr, "Stk", "1 Stk", "siphon kondensat wand unterputz dallmer 138 geruchsverschluss", orig)
    elif "Reiniger" in b1:
        add("Abfluss", "Kleber & Reiniger", "PVC-Reiniger Griffon", "125 ml Dose", herst, nr, "Stk", "1 Dose", "reiniger pvc griffon kleber vorbereitung", orig)
    elif "Kleber" in b1:
        g = "Tube 125 g" if "Tube" in b2 else "Dose 250 ml"
        add("Abfluss", "Kleber & Reiniger", "PVC-Kleber Griffon Uni-100 XT", g, herst, nr, "Stk", "1 " + g.split()[0], "kleber pvc griffon uni100 hi rohr", orig)
    elif "Schlauchverschraubung" in b1:
        add("Abfluss", "Verschraubungen & Schellen", "Schlauchverschraubung 1/2\" Messing", "2-teilig, flachdichtend", herst, nr, "Stk", "1 Stk", "verschraubung schlauch messing 1/2", orig)
    elif "Schlauchtuelle" in b1:
        add("Abfluss", "Verschraubungen & Schellen", "Schlauchtülle Messing 1/4\" AG", "1/4\" x 1/4\"", herst, nr, "Stk", "1 Stk", "tülle schlauchtülle messing 1/4 kondensat", orig)
    elif "Reduzierstueck" in b1:
        add("Abfluss", "Verschraubungen & Schellen", "Reduzierstück Rotguss 1/2\" x 1/4\"", "3241", herst, nr, "Stk", "1 Stk", "reduzierung reduzierstück rotguss 1/2 1/4", orig)
    elif "Schlauchschelle" in b1:
        add("Abfluss", "Verschraubungen & Schellen", "Schlauchschelle 12–20 mm", "verzinkt, Kreuzschlitz", herst, nr, "Stk", "1 Stk", "schelle schlauchschelle 12-20", orig)
    elif "Kondensat" in b1 or "Delta Pack" in b1:
        if "Delta Pack" in b1: bez, gr = "Kondensatpumpe Delta Pack mit Kabelkanal", "20 l/h, L750 x B80 x H60 mm, weiß"
        elif "Max Hi-Flow" in b1: bez, gr = "Kondensat-Behälterpumpe Aspen Max Hi-Flow", "230 V, 550 l/h"
        else:
            name = re.search(r"Mini (Lime|Aqua|Orange)", b1).group(1); bez, gr = f"Kondensatpumpe Aspen Mini {name} Silent+", "Version 5" + (", " + b2.split(",")[-1].strip() if "FP" in b2 else "")
        add("Abfluss", "Kondensatpumpen", bez, gr, herst, nr, "Stk", "1 Stk", "kondensatpumpe pumpe " + bez.lower().replace("kondensatpumpe ", ""), orig)
    elif "schlauch" in t:
        if "1/4" in b1: bez, gr, ve = "PVC-Schlauch 1/4\" klar", "6,3 x 10 mm", "Rolle 30 m"
        else:
            m = re.search(r"(\d+)x(\d+)", b2); bez = ("PVC-Gewebeschlauch " if "Gewebe" in b1 else "PVC-Schlauch ") + f"{m.group(1)} x {m.group(2)} mm"
            gr, ve = "transparent" + (", gewebeverstärkt" if "Gewebe" in b1 else ", ohne Verstärkung"), "Rolle 50 m"
        add("Abfluss", "Schlauch", bez, gr, herst, nr, "Rolle", ve, "schlauch kondensat pvc klar " + bez.lower(), orig)
    else:
        print("NICHT ZUGEORDNET:", orig, file=sys.stderr)
print(json.dumps(out, ensure_ascii=False))
