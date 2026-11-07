# Airtec Inbetriebnahme-App

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
| `APP_CODE` | z. B. `Kaelte-2026!` | Firmen-Code, den die Monteure einmal in der App eingeben |
| `SP_SITE_URL` | `https://airtec.sharepoint.com/sites/Technik` | SharePoint-Website |
| `SP_LIBRARY` | `Dokumente` | *(optional)* Dokumentbibliothek, Standard = Hauptbibliothek der Website |
| `SP_FOLDER` | `Inbetriebnahmeprotokolle` | Zielordner in der Bibliothek |
| `SP_PROJECT_SUBFOLDER` | `ja` | `ja` = Unterordner je Projektnummer anlegen |
| `SP_STAMM_PATH` | `Inbetriebnahmeprotokolle/Stammdaten/Airtec_IBN_Stammdaten.xlsx` | Pfad der Stammdaten-Excel in der Bibliothek |

## Einrichtung prüfen

Im Browser aufrufen: `https://<adresse-der-app>/api/status?code=<APP_CODE>`
Die Antwort zeigt, ob Anmeldung, SharePoint-Website, Ordner und Stammdaten gefunden werden.

## Verhalten ohne Internet

Protokolle, die ohne Verbindung erstellt werden, bleiben auf dem Handy gespeichert und werden automatisch hochgeladen, sobald wieder Internet da ist. Die App selbst funktioniert nach dem ersten Öffnen auch offline.
