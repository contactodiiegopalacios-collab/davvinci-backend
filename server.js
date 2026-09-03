"use strict";

/**
 * Davvinci Backend — llamadas reales via Telnyx
 * -----------------------------------------------
 * Sirve el frontend de Davvinci (carpeta /public) y expone:
 *
 *   POST /api/dial        -> origina una llamada REAL: primero le marca
 *                             al agente, y cuando el agente contesta,
 *                             Telnyx conecta automaticamente al contacto.
 *   ALL  /texml/bridge     -> Telnyx pide aqui las instrucciones de la
 *                             llamada (TeXML) una vez que el agente contesta.
 *   POST /webhooks/telnyx  -> eventos de la llamada (contestada, colgada, etc).
 *   GET  /api/calls        -> ultimas llamadas reales registradas (para probar).
 *
 * Ver README.md para como configurar la cuenta de Telnyx y desplegar esto.
 */

const path = require("path");
const fs = require("fs");
const express = require("express");
require("dotenv").config();

const {
  TELNYX_API_KEY,
  TELNYX_CONNECTION_ID,
  TELNYX_FROM_NUMBER,
  PUBLIC_BASE_URL,
  APP_SECRET,
  PORT,
} = process.env;

const CALL_LOG_FILE = path.join(__dirname, "calls.json");
const TELNYX_API = "https://api.telnyx.com/v2";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Telnyx TeXML webhooks pueden venir como form-urlencoded
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function readCallLog() {
  try {
    return JSON.parse(fs.readFileSync(CALL_LOG_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeCallLog(entries) {
  try {
    fs.writeFileSync(CALL_LOG_FILE, JSON.stringify(entries, null, 2));
  } catch (err) {
    console.error("No se pudo guardar calls.json:", err.message);
  }
}

function appendCallLog(entry) {
  const log = readCallLog();
  log.unshift({ ...entry, ts: new Date().toISOString() });
  writeCallLog(log.slice(0, 500)); // nos quedamos con las ultimas 500
}

// Normaliza numeros a formato E.164 basico. No reemplaza una validacion real,
// pero evita los errores mas comunes (falta el "+", espacios, guiones).
function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/[\s()-]/g, "");
  if (!s.startsWith("+")) {
    // Si ya trae codigo de pais sin "+", lo agregamos.
    // Si parece numero mexicano de 10 digitos, asumimos +52.
    if (/^\d{10}$/.test(s)) s = "+52" + s;
    else s = "+" + s;
  }
  return /^\+\d{8,15}$/.test(s) ? s : null;
}

function requireAppSecret(req, res, next) {
  if (!APP_SECRET || APP_SECRET === "cambia-esto-por-algo-largo-y-dificil") {
    return res.status(500).json({
      error:
        "APP_SECRET no esta configurado en el servidor. Revisa el archivo .env.",
    });
  }
  if (req.header("x-app-key") !== APP_SECRET) {
    return res.status(401).json({ error: "No autorizado." });
  }
  next();
}

async function telnyxRequest(pathSuffix, body) {
  const resp = await fetch(`${TELNYX_API}${pathSuffix}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TELNYX_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg =
      data?.errors?.map((e) => e.detail || e.title).join("; ") ||
      `Telnyx respondio ${resp.status}`;
    const err = new Error(msg);
    err.telnyx = data;
    throw err;
  }
  return data;
}

// ---------------------------------------------------------------------------
// POST /api/dial  { agentPhone, contactPhone, agentName?, contactName? }
//
// Marca primero al agente. En cuanto el agente contesta, Telnyx pide las
// instrucciones a /texml/bridge, que responde "marca tambien al contacto y
// une las dos llamadas". Asi el agente nunca tiene que marcar nada a mano
// y el contacto ve el numero de Telnyx configurado como caller ID.
// ---------------------------------------------------------------------------
app.post("/api/dial", requireAppSecret, async (req, res) => {
  try {
    if (!TELNYX_API_KEY || !TELNYX_CONNECTION_ID || !TELNYX_FROM_NUMBER) {
      return res.status(500).json({
        error:
          "Faltan variables de Telnyx en el .env (TELNYX_API_KEY / TELNYX_CONNECTION_ID / TELNYX_FROM_NUMBER).",
      });
    }
    if (!PUBLIC_BASE_URL || PUBLIC_BASE_URL.includes("CAMBIA-ESTO")) {
      return res.status(500).json({
        error:
          "PUBLIC_BASE_URL no esta configurado. Necesita ser la URL publica de este servidor (ngrok o el dominio ya desplegado).",
      });
    }

    const agentPhone = normalizePhone(req.body.agentPhone);
    const contactPhone = normalizePhone(req.body.contactPhone);
    const contactName = (req.body.contactName || "").toString().slice(0, 80);

    if (!agentPhone) {
      return res.status(400).json({ error: "agentPhone invalido. Usa formato +52..." });
    }
    if (!contactPhone) {
      return res.status(400).json({ error: "contactPhone invalido. Usa formato +52..." });
    }

    const texmlUrl =
      `${PUBLIC_BASE_URL}/texml/bridge?to=${encodeURIComponent(contactPhone)}` +
      `&name=${encodeURIComponent(contactName)}`;

    const call = await telnyxRequest("/calls", {
      connection_id: TELNYX_CONNECTION_ID,
      to: agentPhone,
      from: TELNYX_FROM_NUMBER,
      texml_url: texmlUrl,
      webhook_url: `${PUBLIC_BASE_URL}/webhooks/telnyx`,
      timeout_secs: 30,
    });

    appendCallLog({
      type: "dial_requested",
      agentPhone,
      contactPhone,
      contactName,
      telnyx_call_control_id: call?.data?.call_control_id || null,
    });

    res.json({
      ok: true,
      message: "Marcando al agente. Cuando conteste, se conectara con el contacto.",
      call_control_id: call?.data?.call_control_id || null,
    });
  } catch (err) {
    console.error("Error en /api/dial:", err.message);
    res.status(502).json({ error: `No se pudo iniciar la llamada: ${err.message}` });
  }
});

// ---------------------------------------------------------------------------
// TeXML que Telnyx pide cuando el agente contesta.
// Le avisa brevemente al agente y luego marca al contacto y une la llamada.
// ---------------------------------------------------------------------------
app.all("/texml/bridge", (req, res) => {
  const to = (req.query.to || "").toString();
  const name = (req.query.name || "").toString();
  const safeTo = to.replace(/[<&>]/g, "");
  const greeting = name
    ? `Conectando con ${name}. Un momento.`
    : "Conectando la llamada. Un momento.";

  res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="es-MX" voice="female">${greeting}</Say>
  <Dial>${safeTo}</Dial>
</Response>`);
});

// ---------------------------------------------------------------------------
// Webhooks de eventos de Telnyx (contestada, colgada, fallo, etc.)
// ---------------------------------------------------------------------------
app.post("/webhooks/telnyx", (req, res) => {
  const event = req.body?.data;
  if (event) {
    appendCallLog({
      type: "telnyx_event",
      event_type: event.event_type,
      call_control_id: event.payload?.call_control_id || null,
      from: event.payload?.from || null,
      to: event.payload?.to || null,
    });
    console.log("[telnyx webhook]", event.event_type, event.payload?.call_control_id);
  }
  res.sendStatus(200);
});

// ---------------------------------------------------------------------------
// Consultar el historial de llamadas reales (para verificar que si funciono)
// ---------------------------------------------------------------------------
app.get("/api/calls", requireAppSecret, (req, res) => {
  res.json(readCallLog());
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    telnyxConfigured: Boolean(TELNYX_API_KEY && TELNYX_CONNECTION_ID && TELNYX_FROM_NUMBER),
    publicBaseUrlConfigured: Boolean(PUBLIC_BASE_URL && !PUBLIC_BASE_URL.includes("CAMBIA-ESTO")),
  });
});

const port = PORT || 3000;
app.listen(port, () => {
  console.log(`Davvinci backend escuchando en http://localhost:${port}`);
  console.log(`Frontend: http://localhost:${port}/`);
  console.log(`Salud:    http://localhost:${port}/api/health`);
});
