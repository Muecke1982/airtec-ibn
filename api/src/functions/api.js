const { app } = require("@azure/functions");
const { cfg, checkCode, drive, upload, download, cleanName } = require("../graph");

const json = (status, body) => ({ status, jsonBody: body });
const deny = () => json(401, { error: "Firmen-Code falsch" });
const MAX = 60 * 1024 * 1024;

// PDF-Protokoll in SharePoint ablegen
app.http("upload", {
  methods: ["POST"], authLevel: "anonymous", route: "upload",
  handler: async (req, ctx) => {
    try {
      if (!checkCode(req)) return deny();
      const q = req.query;
      let filename = cleanName(q.get("name"));
      if (!filename.toLowerCase().endsWith(".pdf")) filename += ".pdf";
      const buf = Buffer.from(await req.arrayBuffer());
      if (buf.length < 100 || buf.subarray(0, 4).toString() !== "%PDF") return json(400, { error: "Keine gültige PDF-Datei" });
      if (buf.length > MAX) return json(413, { error: "Datei zu groß" });
      let folder = cfg("SP_FOLDER").replace(/^\/+|\/+$/g, "");
      const proj = cleanName(q.get("projekt"));
      if (cfg("SP_PROJECT_SUBFOLDER", false).toLowerCase() === "ja" && proj) folder += "/" + proj;
      const item = await upload(folder, filename, buf);
      ctx.log(`Protokoll gespeichert: ${folder}/${item.name} (${q.get("monteur") || "?"})`);
      return json(200, { ok: true, name: item.name, folder, webUrl: item.webUrl });
    } catch (e) {
      ctx.error(e);
      return json(e.status === 401 || e.status === 403 ? 502 : 500, { error: e.message });
    }
  },
});

// Stammdaten-Excel aus SharePoint liefern
app.http("stamm", {
  methods: ["GET"], authLevel: "anonymous", route: "stamm",
  handler: async (req, ctx) => {
    try {
      if (!checkCode(req)) return deny();
      const buf = await download(cfg("SP_STAMM_PATH"));
      return { status: 200, body: buf, headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Cache-Control": "no-store" } };
    } catch (e) {
      ctx.error(e);
      return json(e.status === 404 ? 404 : 500, { error: e.status === 404 ? "Stammdaten-Datei in SharePoint nicht gefunden" : e.message });
    }
  },
});

// Einrichtungs-Test: prüft Code, Anmeldung, Website, Bibliothek und Stammdaten
app.http("status", {
  methods: ["GET"], authLevel: "anonymous", route: "status",
  handler: async (req) => {
    if (!checkCode(req, true)) return deny();
    const out = {};
    try {
      const d = await drive();
      out.sharepoint = `OK – Website „${d.siteName}“, Bibliothek „${d.driveName}“`;
    } catch (e) { out.sharepoint = "FEHLER: " + e.message; return json(200, out); }
    out.ordner = cfg("SP_FOLDER", false) || "FEHLER: SP_FOLDER fehlt";
    try { await download(cfg("SP_STAMM_PATH")); out.stammdaten = "OK"; } catch (e) { out.stammdaten = "FEHLER: " + e.message; }
    return json(200, out);
  },
});
