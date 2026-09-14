# 426 — una ruta de api con la sesión vencida responde HTML en vez de 401

## Contexto medido (no supuesto)

**El síntoma, reproducido contra producción el 2026-09-14** (ficha 426 en `feature_list.json`):
`POST https://ordenex.co/api/ordenes/carga-masiva/chunk` sin sesión válida devuelve **`307` a
`/login?redirect=…` con `Content-Type: text/plain`**. El 307 **conserva el método**, así que el
cliente repite el POST contra la página de login y recibe su **HTML con `200`**. Desde fuera es
indistinguible de «el servidor se cayó», y eso fue lo que reportó el integrador (Nuform).

**La causa, en el código** (verificada archivo por archivo, no deducida del grafo):

- `middleware.ts:66-81` — el rechazo por sesión es **siempre** un `NextResponse.redirect`
  (307 por defecto): a `/login?redirect=<pathname>`, o a `/` para los prefijos de
  `REDIRECT_TO_ROOT`. No hay ninguna rama que distinga una ruta de API de una página.
- `middleware.ts:46-47` — antes del guard pasan sin tocar `PUBLIC_ROUTES` y `SELF_AUTH_ROUTES`.

**La superficie, contada sobre el árbol real** (`app/api/**/route.ts` = **24 archivos**):

| grupo | archivos | desenlace HOY sin credencial |
| --- | --- | --- |
| público (`/api/docs/openapi`) | 1 | pasa el guard; lo sirve el handler |
| auto-autenticado (`/api/cron` ×11, `/api/ordenes/api-key` ×9, `/api/webhooks` ×1) | 21 | pasa el guard; el handler responde **401 `application/json`** |
| **guardado por sesión** (`/api/ordenes/carga-masiva/chunk`, `/api/chat/media/[mensajeId]`) | **2** | **307 a `/login`** — el defecto entero |

Dos precisiones medidas que la ficha no traía:

1. **`/api/health` está en `PUBLIC_ROUTES` (`middleware.ts:11`) pero NO existe su handler**:
   `app/api/health/**` no devuelve ningún archivo. Hoy responde el 404 de Next. No lo toca esta
   ficha (ver «Fuera de alcance»).
2. **Los dos handlers afectados ya saben responder 401 JSON**, solo que nunca se ejecutan:
   `app/api/ordenes/carga-masiva/chunk/route.ts:105-106` (`UnauthenticatedError` → 401 con el
   `AppErrorShape` de la feature 10) y `app/api/chat/media/[mensajeId]/route.ts:99-101`
   (`{ error: "unauthenticated" }`, 401).

**Los consumidores propios, medidos uno a uno** (esto es lo que la ficha pedía comprobar y no
deducir). **Ninguno depende del redirect:**

| consumidor | hoy, con la sesión vencida | con el 401 |
| --- | --- | --- |
| `app/(app)/mis-asignaciones/_components/chat/hooks/useMediaChat.ts:72-85` — `fetch` del adjunto | el `fetch` **sigue** el 307 (modo `follow` por defecto), recibe el HTML del login con `200`, `res.ok` es `true`, hace `blob()` y pasa a estado **`"listo"`**: el chat pinta una imagen rota y jura que fue bien | `!res.ok` → estado **`"error"`** explícito, que es lo que la UI ya sabe mostrar. **Mejora** |
| `app/(app)/mis-asignaciones/_components/chat/MediaAdjunto.tsx:352-355` — `<a href download>` del documento | con `download` y mismo origen el navegador **guarda lo que llegue**: hoy guarda el HTML del login bajo el nombre del documento. **El mensajero no ve ninguna página de login** | guarda un archivo con el cuerpo JSON. Igual de inservible, **ni mejor ni peor**: no hay regresión y no hay dependencia del redirect |
| `app/(app)/ordenes/_components/carga-masiva-chunks.ts:101-108` — `procesarEnChunks` | `res.ok` es `true` y revienta en `res.json()`; la UI muestra «No se pudo validar el archivo: Unexpected token '<'…» (`OrdenesCargaUpload.tsx:70-78`) | `ChunkRequestError(401)` → «No se pudo validar el archivo (estado 401).» / «La carga falló (estado 401).» (`OrdenesCargaMasivaButton.tsx:206-211`). **Mejora** |

## Requisitos

### R1 — una ruta de API sin sesión responde 401
**CUANDO** llegue una petición a una ruta de API (definición en R7) que no esté cubierta por
`PUBLIC_ROUTES` ni por `SELF_AUTH_ROUTES` y no traiga una sesión activa, el sistema **DEBE**
responder con código **`401`**.

*Verificable:* `POST /api/ordenes/carga-masiva/chunk` y `GET /api/chat/media/<uuid>` sin cookie
devuelven `401`.

### R2 — el cuerpo es JSON y dice que falta la sesión
**CUANDO** el sistema responda el 401 de R1, **DEBE** emitir la cabecera `Content-Type` con el tipo
`application/json` y un cuerpo **parseable como JSON** que identifique el fallo como falta de
sesión.

*Verificable:* `res.headers.get("content-type")` empieza por `application/json`, `await res.json()`
no lanza, y el objeto resultante trae `status: "error"` y `code: "UNAUTHORIZED"`.

### R3 — ese rechazo no redirige
**CUANDO** el sistema rechace por sesión una ruta de API, **NO DEBE** responder con un código de
redirección (`3xx`) **ni** incluir cabecera `Location`.

*Verificable:* el status no es 307 (ni ningún 3xx) y `res.headers.get("location")` es `null`. Es el
requisito que mata el defecto: sin él, un 302 con cuerpo JSON pasaría R1 y R2.

### R4 — la cookie muerta se sigue borrando
**SI** la petición trae una cookie de sesión que no corresponde a una sesión activa, **ENTONCES** la
respuesta 401 de R1 **DEBE** borrar esa cookie, igual que hoy hace el redirect
(`middleware.ts:72`).

*Verificable:* `res.cookies.get("session")?.value` es `""` tras un rechazo con cookie inválida.

### R5 — el desenlace no depende del método
**CUANDO** una ruta de API sin sesión se pida con `GET`, `POST`, `PUT`, `PATCH` o `DELETE`, el
sistema **DEBE** responder el mismo 401 de R1 en los cinco casos.

*Por qué es un requisito y no un adorno:* la conservación del método por el 307 es **el mecanismo
exacto** por el que el integrador acabó posteando contra la página de login.

### R6 — las páginas no cambian
**CUANDO** el sistema rechace por sesión una ruta que **no** sea de API, **DEBE** responder
exactamente como hoy: `307` con `Location` a `/login?redirect=<pathname>`, salvo los prefijos de
`REDIRECT_TO_ROOT`, que **DEBEN** seguir respondiendo `307` a `/`.

*Verificable:* `/ordenes`, `/dashboard`, `/xyz` → 307 a `/login?redirect=…`; `/paquete/ABC123` →
307 a `/`; `/` sin sesión sigue en 200 y con sesión sigue en 307 a `/dashboard`.

### R7 — qué cuenta como ruta de API
El sistema **DEBE** tratar como ruta de API **únicamente** el path `/api` y los que empiezan por
`/api/`.

*Verificable:* `/api-docs` (que es una **página**, `middleware.ts:18`) y `/apitos` siguen
tratándose como páginas y conservan su desenlace de R6. `/api/docs/openapi` (que **sí** es una ruta
de API, el spec JSON) sigue siendo pública por R8.

### R8 — las públicas y las auto-autenticadas no se enteran
**MIENTRAS** una ruta esté cubierta por `PUBLIC_ROUTES` o por `SELF_AUTH_ROUTES`, el sistema
**DEBE** dejarla pasar sin consultar la sesión, con el mismo desenlace que hoy.

*Verificable:* `/api/docs/openapi`, `/api/cron/*`, `/api/ordenes/api-key/*` y `/api/webhooks/*` sin
cookie siguen pasando el guard (`next()`), y `isSessionActive` no se llama.

### R9 — las tres listas firmadas quedan intactas
El arreglo **DEBE** dejar `PUBLIC_ROUTES`, `SELF_AUTH_ROUTES` y `REDIRECT_TO_ROOT` con
**exactamente** el mismo contenido y el mismo orden que hoy.

*Verificable:* la guardia existente `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts:68-82`
—que compara las tres listas posicionalmente contra literales firmados— sigue verde **sin tocarla**.
Es lo que impide «arreglar» esto metiendo `/api/chat` o `/api/ordenes` en una lista de excepción,
que además abriría la media al mundo.

### R10 — ninguna ruta de API se rechaza redirigiendo, ni las futuras
El sistema **DEBE** mantener en **cero** el número de rutas bajo `app/api/**/route.ts` que, pedidas
sin cookie de sesión, reciban del guard una respuesta `3xx`.

*Verificable:* un barrido del árbol enumera los archivos de ruta, construye su pathname y comprueba
el desenlace del middleware real para cada uno. Es lo que hace que la ruta de API **número 25**
—escrita dentro de seis meses por alguien que no leyó esto— no reabra el defecto.

### R11 — los consumidores propios tratan el 401 como fallo, no como contenido
**CUANDO** un consumidor del navegador reciba el 401 de una de las dos rutas afectadas, **DEBE**
quedar en un estado de error explícito y **NO DEBE** tratar la respuesta como contenido válido.

*Verificable:* `useMediaChat` con un `fetch` que responde 401 termina en estado `"error"` (nunca en
`"listo"`), y `procesarEnChunks` lanza `ChunkRequestError` con `status === 401`.

## Fuera de alcance — y conviene que quede escrito

- **No evita que la sesión del integrador caduque.** Duran 24 h clavadas (medido sobre sus filas de
  `Session`). Esta ficha **no toca** la duración de la sesión.
- **No le da a Nuform un canal mejor.** Para eso ya existe la API key (`/api/ordenes/api-key/*`,
  activa y sin usar desde el 2026-08-28), que se autentica por `Authorization: Bearer` y **no
  caduca cada día**. Migrar a ese canal es una conversación con el integrador, no código.
- **Esta ficha hace que el síntoma sea LEGIBLE, nada más.** Nadie debe leerla como el cierre del
  problema de Nuform: al día siguiente su sesión volverá a vencer y su carga volverá a fallar —solo
  que ahora el fallo dirá `401 {"code":"UNAUTHORIZED"}` en vez de fingir un `200` con una página
  dentro.
- `/api/health` sin handler (queda como está: sacarlo de `PUBLIC_ROUTES` alteraría la lista firmada
  de R9 y no tiene nada que ver con este defecto).
- El enlace de descarga del documento del chat (`MediaAdjunto.tsx:352-355`), que seguirá guardando
  un archivo inservible cuando no haya sesión. No empeora; tampoco mejora. Ver pregunta abierta 3.
- Unificar el cuerpo de error de los handlers que ya responden 401 por su cuenta. Ver pregunta
  abierta 2.
- Cualquier migración, tabla, columna o política RLS: esta feature **no toca la base de datos**.

## Preguntas abiertas

1. **Cuerpo del 401 del middleware.** El repo tiene hoy **tres** formas de decir «401» en
   `app/api`: el `AppErrorShape` de la feature 10 (`{status:"error",code:"UNAUTHORIZED",message}`,
   que es lo que emitiría el handler de `chunk` si llegara a correr), `{error:"unauthorized"}` (cron
   y webhooks) y `{error:"unauthenticated"}` (media). El diseño elige el **`AppErrorShape`** por ser
   el contrato declarado del repo y el que ya emite la ruta del integrador. ¿Se confirma, o se
   prefiere el literal corto de los crons?
2. **¿Se unifica el 401 de `app/api/chat/media/[mensajeId]/route.ts:100`** con esa misma forma? Es
   un cambio de una línea, pero es código que **hoy funciona** y ninguna evidencia lo señala; se ha
   dejado fuera por «arreglar lo evidenciado, no rediseñar». Si se quiere, entra como task extra.
3. **¿Debe la UI del chat avisar «tu sesión venció, vuelve a entrar»** al recibir un 401 (en vez del
   genérico «no se pudo cargar»)? Sería la mejora real para el mensajero, pero es UI y esta ficha es
   de zona `backend`. Si se aprueba, es ficha aparte.
4. **¿Se le avisa a Nuform del cambio de contrato?** Su cliente pasará de recibir `200`+HTML a
   `401`+JSON. Es estrictamente más legible, pero **es un cambio observable** para un tercero.
