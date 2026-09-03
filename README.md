# Davvinci Backend — llamadas reales con Telnyx

Este proyecto es la pieza que le faltaba al prototipo Davvinci para poder
hacer **llamadas telefónicas reales**, no solo simuladas. Es un servidorcito
que:

1. Sirve el frontend de Davvinci (la carpeta `public/`, ya con el marcador
   conectado a este backend).
2. Guarda de forma segura tu clave de Telnyx (nunca viaja al navegador).
3. Cuando el agente da clic en "Llamar", le marca primero al teléfono real
   del agente y, en cuanto contesta, conecta automáticamente la llamada con
   el contacto — dos teléfonos normales, unidos por Telnyx.

No necesitas saber programar para dejarlo funcionando: sigue los pasos en
orden.

---

## Parte 1 — Dar de alta la cuenta de Telnyx (~15-20 min)

1. Entra a **telnyx.com** y crea una cuenta (correo + verificación de
   celular).
2. En el **Mission Control Portal** (el panel de Telnyx), agrega saldo de
   prueba a tu cuenta (con 10-20 USD es más que suficiente para probar).
3. **Compra un número:** Menú *Numbers → Buy Numbers*. Para probar rápido,
   lo más simple es comprar un número de EE. UU./Canadá (no piden
   documentación adicional); un número mexicano requiere subir un
   "regulatory bundle" (comprobante de domicilio/identificación) que puede
   tardar más en aprobarse. El país del número no importa para que la
   llamada puente funcione — solo es el identificador que hace la llamada.
4. **Crea una Call Control Application:** Menú *Voice → Call Control
   Applications → Add new*. Dale un nombre (ej. "Davvinci"). Aquí no hace
   falta llenar el webhook todavía, se lo damos después.
5. Copia el **Connection ID** que te genera esa aplicación.
6. **Asigna tu número** a esa Call Control Application: *Numbers → tu
   número → My Connection → selecciona la app que creaste*.
7. Genera tu **API Key**: menú *API Keys → Create API Key*. Cópiala, no se
   vuelve a mostrar completa.

Con esto ya tienes los 3 datos que pide el `.env`: `TELNYX_API_KEY`,
`TELNYX_CONNECTION_ID`, `TELNYX_FROM_NUMBER` (tu número en formato
`+1XXXXXXXXXX`).

---

## Parte 2 — Probarlo en tu computadora (antes de desplegarlo)

```bash
cd davvinci-backend
npm install
cp .env.example .env
```

Abre `.env` y llena tus datos reales de Telnyx. Deja `PUBLIC_BASE_URL` como
está por ahora, lo ajustamos en el siguiente paso.

Telnyx necesita poder "hablarte" de vuelta (para pedirte las instrucciones
de la llamada), así que tu compu necesita una URL pública temporal. La
forma más fácil es **ngrok**:

```bash
npm install -g ngrok        # si no lo tienes
node server.js               # deja esto corriendo en una terminal
ngrok http 3000               # en otra terminal
```

Ngrok te va a dar una URL como `https://abcd1234.ngrok-free.app`. Copia esa
URL y pégala en `.env` como `PUBLIC_BASE_URL`, luego reinicia `node
server.js` para que la tome.

**Probar sin tocar el frontend**, directo por línea de comandos:

```bash
curl -X POST http://localhost:3000/api/dial \
  -H "Content-Type: application/json" \
  -H "x-app-key: LA_QUE_PUSISTE_EN_APP_SECRET" \
  -d '{"agentPhone":"+5215500000000","contactPhone":"+5215511111111","contactName":"Prueba"}'
```

Cambia `agentPhone` por tu celular y `contactPhone` por el celular de quien
quieras que "reciba" la llamada de prueba. En unos segundos debería sonar
tu teléfono primero; al contestar, se conecta con el otro número
automáticamente.

**Probarlo con la interfaz completa:** abre `http://localhost:3000` en el
navegador (ya no el link de Claude), entra con tu usuario admin, ve a
*Configuración → Llamadas reales* y actívalo con:
- URL del backend: `http://localhost:3000`
- Clave de la app: la misma que pusiste en `APP_SECRET`

Luego en *Agentes*, ponle tu celular real al agente con el que vayas a
probar, y en *Marcador* marca un número — debería sonar tu teléfono de
verdad.

---

## Parte 3 — Desplegarlo para usarlo mañana con Pedro (que no dependa de tu compu)

La forma más simple y gratuita: **Railway** (railway.app) o **Render**
(render.com). Ambos: te conectas con GitHub, subes esta carpeta como
repositorio, y ellos te dan una URL pública fija (ej.
`https://davvinci-backend.up.railway.app`) — ya no necesitas ngrok ni dejar
tu compu prendida.

Pasos generales (Railway):
1. Sube esta carpeta a un repositorio de GitHub (puede ser privado).
2. En Railway: *New Project → Deploy from GitHub repo* → selecciona el
   repo.
3. En *Variables*, agrega las mismas que tienes en tu `.env` (API key,
   connection id, número, app secret). Para `PUBLIC_BASE_URL`, usa la URL
   que Railway te asigne (puedes verla después del primer deploy y
   actualizar la variable).
4. Railway hace el `npm install` y `npm start` automáticamente.
5. Cuando tengas la URL pública, en Davvinci (ya en esa misma URL, no en el
   link de Claude) ve a *Configuración → Llamadas reales* y pon esa URL.

---

## Notas importantes

- **Este backend es independiente del link de Claude.** El prototipo que
  viste dentro de Claude (el link `claude.ai/...`) es una demo segura que
  siempre funciona sin depender de nada de esto, pero por seguridad de esa
  plataforma no puede hacer llamadas reales. Este proyecto es la versión
  "de verdad" — se abre desde la URL de tu propio servidor (localhost,
  ngrok, o Railway/Render), no desde el link de Claude.
- **Nunca compartas tu API Key de Telnyx ni el archivo `.env`.**
- El costo es el que Telnyx cobra por minuto (ver la tabla de precios que
  te pasé antes) más, si usas Railway/Render, su plan gratuito o el más
  económico — para una prueba/demo no deberías gastar casi nada.
- `GET /api/calls` (mandando el header `x-app-key`) te regresa el
  historial de llamadas reales que este backend ha originado, útil para
  verificar que sí está funcionando.
