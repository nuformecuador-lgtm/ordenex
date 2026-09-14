# 426 — bitácora de implementación

**Rama:** `feat/426-api-401-json` · **Zona:** backend · **Fecha:** 2026-09-14

> **Qué se hizo, en una frase.** El rechazo por falta de sesión de un path de API dejó de ser un
> `307` a `/login` y pasa a ser un **`401` con el `AppErrorShape`** de la feature 10. Ni un handler
> tocado, ni una lista de excepción tocada, ni una línea de base de datos. **El arreglo no escribe
> un 401 nuevo: desatasca el que ya existía** en los dos handlers y que nunca llegaba a ejecutarse.

---

## T1 — la superficie, contada sobre el árbol (no sobre la ficha)

`find app/api -name "route.ts"` → **24 archivos**, que coinciden exactamente con el diseño §4:

| grupo | archivos | por qué pasa el guard | desenlace sin credencial |
| --- | --- | --- | --- |
| público | 1 (`/api/docs/openapi`) | `PUBLIC_ROUTES` cubre `/api/docs` | lo sirve el handler (200). **Sin cambio** |
| self-auth | 21 (`/api/cron` ×11, `/api/ordenes/api-key` ×9, `/api/webhooks/whatsapp` ×1) | `SELF_AUTH_ROUTES` | 401 JSON del propio handler. **Sin cambio** |
| **guardado por sesión** | **2** (`/api/ordenes/carga-masiva/chunk`, `/api/chat/media/[mensajeId]`) | nada los excluye | **antes 307 → login → 200 HTML; ahora 401 JSON** |

Sin discrepancia con el spec: 1 + 21 + 2 = 24.

`/api/health` sigue en `PUBLIC_ROUTES` **sin handler** (404 de Next). Fuera de alcance a propósito:
sacarlo alteraría la lista firmada de R9.

---

## Archivos creados / modificados

| archivo | qué |
| --- | --- |
| `middleware.ts` | **modificado** — `esRutaApi()` + `rechazoSinSesion()`: la rama 5.a del diseño |
| `tests/unit/auth/middleware-api-401.test.ts` | **nuevo** — 19 casos: R1, R2, R3, R4, R5, R7 (+ dos de R6 como control) |
| `tests/unit/guards/api-sin-redirect-sin-sesion.guardia.test.ts` | **nuevo** — el barrido de R10 con sus dos controles de no-vacuidad |
| `tests/unit/auth/middleware.test.ts` | **modificado** — 2 casos **invertidos** (líneas 164 y 246 del original) |
| `tests/integration/api/chat-media-middleware.test.ts` | **modificado** — 1 caso **invertido** (línea 29 del original) |
| `tests/components/CargaMasivaChunks.test.ts` | **modificado** — un caso nuevo de R11 (401) |
| `tests/components/useMediaChat.test.tsx` | **nuevo** — el otro caso de R11, con su control del defecto de hoy |
| `progress/impl_426.md` | **nuevo** — esta bitácora |

**Lo que NO se tocó, y es parte del trabajo:**

- `PUBLIC_ROUTES`, `SELF_AUTH_ROUTES` y `REDIRECT_TO_ROOT` quedan **carácter por carácter** como
  estaban (R9). La guardia firmada `rastreo-sin-ruta-nueva.guardia.test.ts` sigue verde **sin
  tocarla**.
- El `matcher` del `config`: las exclusiones de las fotos de la landing y de los tres archivos de
  la PWA (`manifest.json`, `sw.js`, `offline.html`) están intactas.
- Los dos handlers. En particular **no se unificó** el `{ error: "unauthenticated" }` de
  `app/api/chat/media/[mensajeId]/route.ts:100` con el `AppErrorShape` (decisión **D2**).
- `tests/baseline-rojos.json`: **no ha crecido**, ni una entrada. Ningún test se borró, se relajó ni
  se mandó al baseline.
- Las dos aserciones de `chat-media-middleware.test.ts` que comprueban que la ruta **no** entró en
  ninguna lista de excepción (bloque «la ruta NO se añadió a las listas de excepcion»): idénticas.

### El cambio en `middleware.ts`, en dos piezas

```ts
function esRutaApi(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function rechazoSinSesion(request: NextRequest, pathname: string): NextResponse {
  if (esRutaApi(pathname)) return appErrorToResponse(new UnauthenticatedError().toShape());
  if (matches(pathname, REDIRECT_TO_ROOT)) return NextResponse.redirect(new URL("/", request.url));
  return redirectALogin(request, pathname);
}
```

Imports **profundos** (`@/lib/errors/app-error`, `@/lib/errors/http`) y no el barril: el barril
arrastra `normalize.ts` → `zod` al bundle de un middleware que corre en **cada** petición.
El borrado de la cookie inválida sigue siendo **común a las dos ramas** (R4), y la rama de API va
**después** de `PUBLIC_ROUTES` y `SELF_AUTH_ROUTES` (R8) y **antes** de `REDIRECT_TO_ROOT`.

---

## Mapa `R<n> → test`

| R | test que lo cubre | estado |
| --- | --- | --- |
| R1 | `tests/unit/auth/middleware-api-401.test.ts` › «POST /api/ordenes/carga-masiva/chunk sin cookie responde 401», «GET /api/chat/media/&lt;uuid&gt; sin cookie responde 401», «una ruta de API que todavia no existe tambien responde 401» | ✅ |
| R2 | idem › «el 401 llega con content-type application/json y un cuerpo con code UNAUTHORIZED» y «el cuerpo del 401 de la media tiene la misma forma que el de la carga» | ✅ |
| R3 | idem › «%s no trae Location ni un status 3xx» (×2) **+** `tests/unit/guards/api-sin-redirect-sin-sesion.guardia.test.ts` › «ninguna ruta de API recibe del guard un 3xx ni una cabecera Location» | ✅ |
| R4 | idem › «borra la cookie de sesion que fallo la validacion al responder 401» | ✅ |
| R5 | idem › «responde 401 sea cual sea el metodo (GET/POST/PUT/PATCH/DELETE)» | ✅ |
| R6 | `tests/unit/auth/middleware.test.ts` › bloques de páginas ya existentes (`/ordenes`, `/dashboard`, `/xyz`, `/apitos`, `/paquete/ABC123`, `/`) — **sin modificar** — + en el archivo nuevo, «una pagina privada cualquiera… conserva su 307 a /login?redirect=» y «/paquete/\* sin sesion conserva su 307 a /» | ✅ |
| R7 | `middleware-api-401.test.ts` › «el path `/api` exacto tambien es una ruta de API», «/apitos no es una ruta de API: sigue redirigiendo (307) a /login», «/api-docs es una PAGINA publica: sigue pasando con 200» | ✅ |
| R8 | `tests/unit/auth/middleware.test.ts` › bloques «rutas publicas» y «endpoints con autenticacion propia» — **sin modificar** — + la guardia de R10 › «CONTROL: una ruta con autenticacion propia sigue PASANDO el guard (R8)» | ✅ |
| R9 | `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts` › «`PUBLIC_ROUTES`/`SELF_AUTH_ROUTES`/`REDIRECT_TO_ROOT` es EXACTAMENTE la lista firmada» — **sin modificar**, verde | ✅ |
| R10 | `tests/unit/guards/api-sin-redirect-sin-sesion.guardia.test.ts` (5 casos: el barrido + 2 de no-vacuidad + 2 de control) | ✅ |
| R11 | `tests/components/CargaMasivaChunks.test.ts` › «lanza ChunkRequestError con status 401 si el lote responde 401 (sesion vencida)» · `tests/components/useMediaChat.test.tsx` › «un 401 deja el adjunto en estado error, nunca en listo» | ✅ |

**Nota sobre R7 y `/api-docs`.** El mapa de `tasks.md` decía «`/apitos` y `/api-docs` siguen
redirigiendo a /login». Medido sobre el código: **`/api-docs` no redirige**, está en
`PUBLIC_ROUTES` (`middleware.ts:20`) y pasa con **200** — nunca llega al punto de rechazo. Lo que
R7 exige de verdad es que **ninguna de las dos se trate como ruta de API**, y eso es lo que afirma
el test: `/apitos` conserva su 307 y `/api-docs` conserva su 200. Se deja escrito para que el
reviewer no lo lea como una aserción relajada.

---

## Salidas reales

### Los tres casos INVERTIDOS (T4) — dónde estaban y qué afirman ahora

| archivo | antes | ahora |
| --- | --- | --- |
| `tests/unit/auth/middleware.test.ts` «una ruta de API no self-auth sin sesion se guarda» | `expect(res.status).toBe(307)` + `location.pathname === "/login"` | `401` + `content-type` json + `location` nulo |
| `tests/unit/auth/middleware.test.ts` «R40 (control): /api/ordenes/orden/ABC-123…» | `307` a `/login` | `401` + json + sin `location`. **El control sigue siendo control:** la ruta NO pasa, frente a las tres del bloque de arriba que sí pasan con 200 |
| `tests/integration/api/chat-media-middleware.test.ts` «GET sin cookie de sesion…» | `307` a `/login` | `401` + json + `code: "UNAUTHORIZED"`. **Lo que R26 protegía —la media detrás del guard— se conserva entero** |

### `pnpm run typecheck`

```
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit
```

Cero errores (salida vacía, exit 0).

### `pnpm run lint`

```
✖ 184 problems (0 errors, 184 warnings)
```

**0 errores.** Los 184 warnings son `no-unused-vars` preexistentes de `dev` (dobles de test con
parámetros `_x`); **ninguno cae en un archivo de esta feature** — comprobado filtrando la salida
por `middleware|useMediaChat|api-sin-redirect|CargaMasivaChunks|chat-media`: sin coincidencias.

### Los archivos de esta feature

```
pnpm exec vitest run tests/unit/auth/middleware-api-401.test.ts tests/unit/auth/middleware.test.ts \
  tests/unit/guards/api-sin-redirect-sin-sesion.guardia.test.ts \
  tests/integration/api/chat-media-middleware.test.ts \
  tests/components/CargaMasivaChunks.test.ts tests/components/useMediaChat.test.tsx \
  tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts

 Test Files  7 passed (7)
      Tests  91 passed (91)
```

(Los 7 incluyen a propósito la guardia firmada de R9, que **no se tocó** y sigue verde.)

### `vitest related` sobre lo tocado

```
pnpm exec vitest related --run middleware.ts tests/unit/auth/middleware-api-401.test.ts \
  tests/unit/guards/api-sin-redirect-sin-sesion.guardia.test.ts tests/components/useMediaChat.test.tsx \
  "app/(app)/mis-asignaciones/_components/chat/hooks/useMediaChat.ts" \
  "app/(app)/ordenes/_components/carga-masiva-chunks.ts"

 Test Files  63 passed (63)
      Tests  776 passed (776)
   Duration  73.05s
```

Y las guardias que **leen `middleware.ts` como archivo** (a esas el grafo de imports no las
selecciona, por eso se corren a mano):

```
pnpm exec vitest run tests/unit/guards/pwa-servida-sin-sesion.guardia.test.ts \
  tests/unit/guards/superficie-de-uso.guardia.test.ts \
  tests/unit/guards/openapi-canal-rutas-reales.guardia.test.ts \
  tests/unit/guards/rutas-336-retiradas.guardia.test.ts \
  tests/unit/guards/push-alta-punto-unico.guardia.test.ts \
  tests/unit/components/analytics-paquete-guard.test.ts \
  tests/integration/api/webhook-whatsapp-middleware.test.ts

 Test Files  7 passed (7)
      Tests  102 passed (102)
```

`skipped`: **0** en todas las corridas de arriba. Ningún test de esta feature toca la base de
datos, así que ninguno depende de `DATABASE_URL`.

---

## Mutaciones de control — con la salida roja pegada

Las tres se aplicaron sobre `middleware.ts` **en el árbol**, se corrió el test, y el archivo se
restauró desde una copia (`git diff --stat` posterior: `35 insertions(+), 3 deletions(-)`, que es
exactamente el cambio de la feature).

### T7.a — el 401 pasa a ser un `302` **con el mismo cuerpo JSON**

Es la mutación que importa: un 302 con cuerpo JSON **pasa R2** y solo lo caza R3.

```
 × /api/ordenes/carga-masiva/chunk no trae Location ni un status 3xx
 × /api/chat/media/11111111-2222-4333-8444-555555555555 no trae Location ni un status 3xx
 FAIL  …middleware-api-401.test.ts > middleware — el rechazo de una ruta de API no redirige (R3) > /api/ordenes/carga-masiva/chunk no trae Location ni un status 3xx
 FAIL  …middleware-api-401.test.ts > middleware — el rechazo de una ruta de API no redirige (R3) > /api/chat/media/… no trae Location ni un status 3xx
 Test Files  1 failed (1)
      Tests  12 failed | 7 passed (19)
```

**Los 7 supervivientes son la prueba:** entre ellos están los **dos casos de R2**
(«…content-type application/json y un cuerpo con code UNAUTHORIZED» y «el cuerpo del 401 de la
media…»), que siguen verdes con la mutación puesta. Sin R3, este 302 se colaba.

### T7.b — `esRutaApi` vuelve a `startsWith("/api")` (sin la barra)

```
 × /apitos no es una ruta de API: sigue redirigiendo (307) a /login
 × sigue redirigiendo una pagina privada que empieza con 'api' en el nombre
 FAIL  …middleware-api-401.test.ts > middleware — que cuenta como ruta de API (R7) > /apitos no es una ruta de API: sigue redirigiendo (307) a /login
 FAIL  …middleware.test.ts > middleware — /paquete/[numGuia] > sigue redirigiendo una pagina privada que empieza con 'api' en el nombre
 Test Files  2 failed (2)
      Tests  2 failed | 46 passed (48)
```

Mueren los dos casos de `/apitos` —el nuevo y el que ya existía—. `/api-docs` no muere aquí porque
es pública y ni llega al punto de rechazo, que es justo lo que dice el test.

### T5 — se revierte la rama 5.a (la guardia de R10 debe nombrar al culpable)

```
 × ninguna ruta de API recibe del guard un 3xx ni una cabecera Location
AssertionError: expected [ …(2) ] to deeply equal []
+ [
+   "app/api/chat/media/[mensajeId]/route.ts -> /api/chat/media/1111… devolvio 307 (location=https://app.test/login?redirect=%2Fapi%2Fchat%2Fmedia%2F1111…)",
+   "app/api/ordenes/carga-masiva/chunk/route.ts -> /api/ordenes/carga-masiva/chunk devolvio 307 (location=https://app.test/login?redirect=%2Fapi%2Fordenes%2Fcarga-masiva%2Fchunk)",
+ ]
 × CONTROL: las dos rutas guardadas por sesion responden 401 con JSON (no es que pasen todas)
AssertionError: app/api/ordenes/carga-masiva/chunk/route.ts deberia seguir detras del guard: expected 307 to be 401
 Test Files  1 failed (1)
      Tests  2 failed | 3 passed (5)
```

La guardia **nombra el archivo de ruta culpable**, que era el requisito de T5.

### El control de no-vacuidad de R11 (T6.b)

El test `useMediaChat.test.tsx` incluye un caso que **reproduce el defecto de hoy**: con un doble
que responde `200` + HTML del login, el hook termina en estado **`"listo"`** con
`url === "blob:objeto-1"`. Verde. Si el hook ignorara el cuerpo y siempre diera `"error"`, ese caso
fallaría y sabríamos que el test de R11 no mide al consumidor real.

---

## Gate

**`./init.sh --rapido` NO vale para esta ficha y se niega solo**: el diff toca `middleware.ts`,
que está en la lista de cimientos (`docs/verification.md:79`). **El gate completo (`./init.sh`, con
`INIT_EXIT=$?` escrito dentro del log y sin canalizar por `tail`) lo corre el leader**, no este
subagente. Lo de arriba es lo que sí se midió aquí: typecheck, lint, los archivos de la feature,
`vitest related` y las guardias que leen el middleware como archivo.

---

## NOTA DE DESPLIEGUE — sale ANTES de desplegar (D4)

> **Hay que avisar a Nuform antes de que esto llegue a producción.** Lo manda **el humano** por su
> canal; no es código y ninguna task lo automatiza.

**Qué se le dice.** A partir de este despliegue, una petición a
`POST /api/ordenes/carga-masiva/chunk` **con la sesión vencida** deja de devolver `200` con el HTML
de la página de login y pasa a devolver:

```
HTTP/1.1 401 Unauthorized
Content-Type: application/json
{"status":"error","code":"UNAUTHORIZED","message":"No hay una sesion valida."}
```

Es estrictamente más legible, pero **es un cambio observable para un tercero**: si su cliente hoy da
por buena cualquier respuesta `2xx`, empezará a ver un error donde antes veía un falso éxito — que
es exactamente el punto. Aprovechar el aviso para recordarles la **API key** que tienen activa y sin
usar desde el 2026-08-28 (`/api/ordenes/api-key/*`, `Authorization: Bearer`), que es el canal que
**no caduca cada 24 h**.

**Y lo que esta ficha NO arregla, dicho sin rodeos:** la sesión del integrador seguirá venciendo a
las 24 h y su carga seguirá fallando. Lo único que cambia es que el fallo será legible. Nadie debe
leer esta ficha como el cierre del problema de Nuform.

- [ ] **T10 — puerta de despliegue:** aviso enviado a Nuform el **____-__-__** por ______.
      **Sin esto, la release no sale.**

**Seguimiento (D3):** registrar ficha aparte para el aviso «tu sesión venció, vuelve a entrar» en la
interfaz del chat. No se abre aquí: esta ficha es `backend` y no toca UI.

---

## Veredicto

Implementado según el spec: el rechazo por sesión de una ruta de API es **401 JSON sin `Location`**,
las tres listas firmadas y los dos handlers quedan intactos, los tres tests del defecto están
**invertidos** (ninguno borrado, relajado ni mandado al baseline) y las tres mutaciones de control
salieron rojas con su salida pegada. Falta el gate completo (del leader) y el aviso a Nuform (T10).
