# Airtec Inbetriebnahme-App

Module (getrennt gebaut, nur über Anmeldung und Monteurliste verbunden):

| Modul | Dateien | Inhalt |
|---|---|---|
| Anmeldung | `app/login.js`, `lib/auth.js`, `functions/api/login.js` | Name + Passwort für die ganze App, Zugangsliste in SharePoint |
| Wochenplan | `app/wochenplan.js`, `lib/wochenplan.js`, `lib/google.js`, `functions/api/wochenplan.js` | Liest die Google-Tabelle (ein Blatt je KW) |
| Protokolle | `app/index.html`, `functions/api/upload.js`, `stamm.js` | Inbetriebnahme- und Abnahmeprotokolle |
| Krankmeldung (Büro) | `app/krank.js`, `functions/api/plan.js` | Tagesbrett: krank melden, Teams per Antippen neu einteilen, Baustellen streichen |
| Start (Begrüßung + Hinweise, Hinweis ans Büro) | `app/hinweise.js`, `lib/hinweise.js`, `functions/api/hinweise.js` | Begrüßung, Maschinen-Hinweise, Büro-Hinweise zum Abhaken (Airtec_Hinweise.xlsx) |
| Maschinen | `app/maschinen.js`, `lib/maschinen.js`, `lib/xlsx.js`, `functions/api/maschinen.js` | Ausleihe mit einem Tipp, Protokoll in der Excel |
| Lager | `app/lager.js` | Platzhalter |

Web-App für Inbetriebnahmeprotokolle (Split, Multisplit, VRF, Direktverdampfer, Kaltwassersatz, Wärmepumpe, Klimaschrank).
Die Monteure füllen das Protokoll auf dem Handy aus, die App erzeugt ein PDF und legt es automatisch in SharePoint ab.
Die Auswahllisten (Monteure, Gerätetypen, Nachfüllmengen, GWP, Dokumentenlinks …) kommen aus der Excel-Datei `Airtec_IBN_Stammdaten.xlsx` in SharePoint.

## Aufbau

| Ordner | Inhalt |
|---|---|
| `app/` | Die App (eine HTML-Seite), Symbole, Offline-Speicher (`sw.js`) |
| `functions/api/` + `lib/` | Hintergrunddienst für **Cloudflare Pages** (aktuell genutzt): `upload` legt PDFs in SharePoint ab, `stamm` liefert die Stammdaten-Excel, `status` prüft die Einrichtung |
| `api/` | Derselbe Dienst als Alternative für **Azure Static Web Apps** |

## Cloudflare Pages – Einstellungen

* Framework: *Keine* · Build-Befehl: *(leer)* · Build-Ausgabeverzeichnis: `app`
* Umgebungsvariablen: siehe Tabelle unten (als „Secret“/verschlüsselt anlegen, mindestens `CLIENT_SECRET` und `APP_CODE`)

## Cloudflare Workers – Einstellungen (Alternative zu Pages)

* „Repository importieren“, Build-Befehl leer, Deploy-Befehl `npx wrangler deploy` (Standard) – die Einstellungen stehen in `wrangler.jsonc`
* Umgebungsvariablen wie unten unter *Einstellungen → Variablen und Geheimnisse*

## Azure Static Web App – Build-Einstellungen (Alternative)

* App location: `app`
* Api location: `api`
* Output location: *(leer lassen)*

## Umgebungsvariablen

| Name | Beispiel | Bedeutung |
|---|---|---|
| `TENANT_ID` | `xxxxxxxx-…` | Verzeichnis-ID (Mandant) der App-Registrierung |
| `CLIENT_ID` | `xxxxxxxx-…` | Anwendungs-ID (Client) der App-Registrierung |
| `CLIENT_SECRET` | *(geheim)* | Wert des geheimen Clientschlüssels |
| `APP_CODE` | z. B. `Kaelte-2026!` | *(Übergang)* alter Firmen-Code. Wird noch akzeptiert, kann gelöscht werden, sobald alle angemeldet sind |
| `SP_SITE_URL` | `https://airtec.sharepoint.com/sites/Technik` | SharePoint-Website |
| `SP_LIBRARY` | `Dokumente` | *(optional)* Dokumentbibliothek, Standard = Hauptbibliothek der Website |
| `SP_FOLDER` | `Inbetriebnahmeprotokolle` | Zielordner in der Bibliothek |
| `SP_PROJECT_SUBFOLDER` | `ja` | `ja` = Unterordner je Projektnummer anlegen |
| `SP_ZUGANG_PATH` | `…/Stammdaten/Airtec_Zugaenge.xlsx` | *(optional)* Zugangsliste. Standard: `Airtec_Zugaenge.xlsx` im Ordner der Stammdaten |
| `GSHEET_ID` | `1AbC…xyz` | ID der Google-Tabelle Wochenplan (der Teil zwischen `/d/` und `/edit` im Link) |
| `GOOGLE_SA_JSON` | *(geheim)* | Kompletter Inhalt der JSON-Schlüsseldatei des Google-Dienstkontos |
| `SESSION_SECRET` | *(geheim, optional)* | Schlüssel für die Anmeldungen. Ändern = alle Handys müssen sich neu anmelden |
| `SP_STAMM_PATH` | `Inbetriebnahmeprotokolle/Stammdaten/Airtec_IBN_Stammdaten.xlsx` | Pfad der Stammdaten-Excel in der Bibliothek |

## Einrichtung prüfen

Im Browser aufrufen: `https://<adresse-der-app>/api/status?code=<APP_CODE>`
Die Antwort zeigt, ob Anmeldung, SharePoint-Website, Ordner und Stammdaten gefunden werden.

## Verhalten ohne Internet

Protokolle, die ohne Verbindung erstellt werden, bleiben auf dem Handy gespeichert und werden automatisch hochgeladen, sobald wieder Internet da ist. Die App selbst funktioniert nach dem ersten Öffnen auch offline.

## Zugangsliste

Vorlage: `vorlagen/Airtec_Zugaenge.xlsx` → in SharePoint neben die Stammdaten-Datei legen.
Spalten: Name · E-Mail · Passwort · Name im Wochenplan · Schreibrecht (x).
Die Datei liest nur der Server (über Microsoft Graph), sie wird nie aufs Handy geladen.
Änderungen wirken nach spätestens 5 Minuten; ein geändertes Passwort meldet die Person ab.

## Wochenplan (Google-Tabelle)

* Ein Blatt je Kalenderwoche, Titel enthält „KW“ und die Nummer (z. B. `KW 46`).
* Wochentage (Mo/Montag …) in einer der ersten drei Spalten, Monteurnamen als Überschriften darüber.
* Gleicher Eintrag am gleichen Tag = ein Team. Urlaub, Schule, HBZ, krank werden als Abwesenheit erkannt.
* Die Tabelle wird mit der E-Mail-Adresse des Dienstkontos geteilt (Betrachter reicht für das Lesen).

## Maschinen

Vorlage: `vorlagen/Airtec_Maschinen.xlsx` → liegt neben den Stammdaten (anderer Ort: `SP_MASCHINEN_PATH`).
* Blatt „Maschinen“ pflegt das Büro (Nr, Maschine, Hersteller/Typ, Seriennummer, Kategorie, Bemerkung).
* Blatt „Protokoll“ schreibt die App: je Maschine die letzten 10 Ausleihen; Zeile ohne „Zurückgelegt“ = unterwegs.
* Nach `MASCHINEN_TAGE` (Standard 10) Tagen fragt die App den Monteur beim Öffnen, ob er die Maschine noch hat.
* „Maschine verleihen“: an Externe (Vorschläge aus Blatt „Verleih“), mit Ansprechpartner und Dauer → Spalte „Rückgabe bis“.
  Danach erinnert die App das Büro, alle … Tage erneut (Blatt „Verleih“, Spalte B, Standard 3), bis die Rückgabe eingetragen ist.
  Fehlen Blatt oder Spalten in einer älteren Datei, ergänzt die App sie beim nächsten Speichern.
* „Auf Baustelle gelassen“: mitgenommene Maschine einer Baustelle zuordnen (Spalte „Baustelle“); angezeigt wird dann die Baustelle,
  abholen oder zurückstellen darf jeder. Vorschlag: eigene Baustelle laut Wochenplan heute + zuletzt benutzte.
* Gespeichert wird nur, wenn die Datei seit dem Laden unverändert ist (eTag) – sonst wird neu geladen und wiederholt.
