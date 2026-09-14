# 426 — revisión

**Rama:** `feat/426-api-401-json` · **Commit revisado:** `ea887d69` · **Fecha:** 2026-09-14
**Veredicto: OK — no hay bloqueantes.**

> Qué se revisó: `specs/426-api-401-json/{requirements,design,tasks}.md`, `progress/impl_426.md`,
> `middleware.ts`, los 7 archivos de test del diff, `CHECKPOINTS.md`, `docs/architecture.md`,
> `docs/conventions.md`, `docs/verification.md` y `progress/gate_426.log`.
> **Búsqueda:** el MCP `codebase-memory` no estaba disponible en este subagente; la superficie se
> midió con `find`/`grep` sobre el árbol real, que para «contar route.ts» es la fuente correcta de
> todos modos (a un `route.ts` no lo importa nadie y el grafo no lo seleccionaría).

---

## 1. Checklist de CHECKPOINTS.md, punto por punto

| punto | veredicto | evidencia |
| --- | --- | --- |
| `requirements.md` con EARS numerados | OK | R1–R11, todos con su «Verificable:» |
| `design.md` con alternativa descartada y su porqué | OK | A1 (`SELF_AUTH_ROUTES`), A2 (303), A3 (`Accept`), A4 (parchear clientes) |
| `tasks.md` con TODAS las tasks `[x]` | **NO** | **0 de 10 marcadas.** Hallazgo M1 (contabilidad, no sustancia) |
| Cada `R<n>` mapea a un test concreto | OK | mapa verificado en §3: los 11 con test que corre y **muere** si se revierte el arreglo |
| `progress/impl_<feature>.md` con el mapa R → test | OK | `progress/impl_426.md` |
| `pnpm run typecheck` sin errores | OK | `progress/gate_426.log:10` → «typecheck paso» |
| `pnpm run lint` sin errores | OK | 184 warnings (baseline del repo), **0 errores**; ninguno en archivos de esta feature |
| `pnpm test` verde | OK | gate completo: 1959 archivos, 28489 passed / 26 skipped, `INIT_EXIT=0`. Los 26 skipped son de `AnaliticaPage`/`AnaliticaShell`, preexistentes. **`.env presente`**, así que `integration/db` SÍ corrió (no es el falso verde de «gate sin .env») |
| E2E para flujo crítico (auth) | **inaplicable** | no hay arnés Playwright en el repo (`tests/` no tiene `e2e/`). El riesgo queda cubierto por los tests que ejercitan el **middleware real**: unitarios + `tests/integration/api/chat-media-middleware.test.ts` + la guardia de barrido |
| RLS en tablas nuevas | N/A | la feature **no toca la base de datos**: el diff no incluye `db/` |
| Migraciones con `down.sql` | N/A | ninguna migración nueva |
| Sin secretos hardcodeados | OK | el cuerpo del 401 sale de `MSG.UNAUTHORIZED`; no hay literales de entorno |
| Webhooks con firma / idempotentes | OK (intacto) | `/api/webhooks` sigue en `SELF_AUTH_ROUTES`; su handler no se tocó |
| Controller sin queries ni negocio | OK | `middleware.ts` no gana lógica: delega en `appErrorToResponse` |
| Service sin HTTP | N/A | no hay servicio nuevo |
| `./init.sh` termina en verde | OK | `INIT_EXIT=0` escrito DENTRO del log (`progress/gate_426.log`) |
| `progress/review_<feature>.md` con veredicto OK | OK | este archivo |
| Entrada en `progress/history.md` | **pendiente** | hallazgo M4 (paso de cierre del leader) |

---

## 2. Los cinco puntos mirados con lupa

### 2.1 El middleware no se aflojó por ningún lado — CONFIRMADO

`git diff origin/dev...HEAD -- middleware.ts` son **tres hunks** y ninguno toca lo sensible:

- **`PUBLIC_ROUTES`, `SELF_AUTH_ROUTES` y `REDIRECT_TO_ROOT`: cero cambios.** Ni un elemento, ni un
  orden, ni un carácter. La guardia firmada `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts`
  sigue **sin tocar y verde** (la corrí). R9 cumplido.
- **El `config.matcher`: cero cambios.** Las exclusiones de las fotos de la landing
  (svg, jpg, jpeg, png, gif, webp, avif, ico) y los **tres archivos de la PWA** (`manifest.json`,
  `sw.js`, `offline.html`) están idénticas, con su comentario de la feature 284 entero. Y no queda
  solo en el diff: `tests/unit/guards/pwa-servida-sin-sesion.guardia.test.ts` **lee el matcher del
  fuente y lo compila a RegExp** — lo corrí, 5 casos verdes.
- El orden de decisión se conserva: el desvío nuevo vive DENTRO del punto de rechazo, después de
  las dos listas de excepción y después de la validación real contra la DB. Ninguna ruta que hoy
  exige sesión deja de exigirla; ningún camino se salta `isSessionActive`.

### 2.2 Los tres tests del defecto están INVERTIDOS, no neutralizados — CONFIRMADO Y MEDIDO

Ninguna de las tres formas conocidas de falsear apareció:

- **¿Contra su propia fuente?** No. El cuerpo se compara contra los literales `"error"` y
  `"UNAUTHORIZED"`, no contra `MSG.UNAUTHORIZED` ni contra `HTTP_STATUS_BY_CODE`. Del mensaje solo
  se exige que exista y no esté vacío, razonado dentro del propio test
  (`middleware-api-401.test.ts:84-88`): el contrato que se fija es el `code`.
- **¿`if (!x) return;`, `skip`, `only`, `todo`?** Ninguno en los cinco archivos tocados.
- **¿Baseline?** `tests/baseline-rojos.json` **no cambió** (diff vacío) y ninguno de los archivos de
  la feature aparece dentro.
- **¿Se perdió algún caso?** No: `middleware.test.ts` tiene **18 `it(` antes y 18 después**;
  `chat-media-middleware.test.ts`, **4 y 4**. Las dos aserciones de «la ruta NO se añadió a las
  listas de excepcion» siguen intactas.

Y lo importante: **verifiqué las mutaciones yo mismo**, sin fiarme de la bitácora (en este repo ya
hubo un arnés de mutaciones que reportó supervivientes sin ejecutar un test). Las tres reproducen
EXACTAMENTE lo que dice `progress/impl_426.md`:

| mutación aplicada por el reviewer | resultado medido |
| --- | --- |
| borrar la rama `if (esRutaApi(...)) return appErrorToResponse(...)` | `Test Files 4 failed`, 19 failed / 38 passed — caen los tres invertidos Y la guardia de R10 |
| 401 → **302 con el mismo cuerpo JSON** | 12 failed / 7 passed (19) — sobreviven los dos casos de R2 y muere R3. Sin R3, ese 302 se colaba |
| `esRutaApi` → `startsWith("/api")` sin barra | 2 failed / 46 passed — mueren los dos casos de `/apitos` |

Árbol restaurado tras cada una: `git diff --stat HEAD -- middleware.ts` vacío.

### 2.3 Las rutas afectadas son EXACTAMENTE DOS — contado sobre el árbol

`find app/api -name "route.ts"` → **24 archivos** (y `route.*` también 24: no hay `.tsx` ni `.js`).
Clasificados uno a uno contra las listas del middleware:

| grupo | nº | archivos |
| --- | --- | --- |
| público (`/api/docs`) | 1 | `app/api/docs/openapi/route.ts` |
| self-auth (`/api/cron` x11, `/api/ordenes/api-key` x9, `/api/webhooks` x1) | 21 | — |
| **guardado por sesión** | **2** | `app/api/ordenes/carga-masiva/chunk/route.ts`, `app/api/chat/media/[mensajeId]/route.ts` |

1 + 21 + 2 = 24. **Exactamente dos.** (La ficha del JSON decía «2 públicas + 20 self-auth»; el spec
ya corrigió ese reparto —`/api/health` es una entrada de lista SIN archivo— y es el spec el que
cuadra con el árbol.)

Consumidores: el grep de `/api/` fuera de `app/api` devuelve **solo dos** llamadas reales
(`useMediaChat.ts:15` y `carga-masiva-chunks.ts:9`, la primera también detrás del `<a download>`),
que son justo las tres situaciones que el diseño midió. **No hay un cuarto consumidor sin medir.**

### 2.4 La afirmación de /api-docs — EL SPEC ESTABA MAL; EL TEST ES EL CORRECTO

Verificado en el código: `"/api-docs"` **está** en `PUBLIC_ROUTES` (`middleware.ts:20`) y además
existe `app/api-docs/route.ts` (el 25.º route handler del repo, fuera de `app/api`, que sirve el
HTML de Swagger UI). Por tanto `/api-docs` **pasa el guard con 200 y nunca llega al punto de
rechazo**: la frase de `requirements.md` R7 («conservan su desenlace de R6», o sea 307) es
**incorrecta**, y también lo es esa línea del mapa de `tasks.md`.

El test **no está aflojado**: afirma `status === 200`, `location === null` Y que `isSessionActive`
no se llamó — tres aserciones sobre el comportamiento real. Lo que R7 protege de verdad (que
`/api-docs` no se trate como ruta de API) lo sostiene el caso de `/apitos`, que SÍ muere con la
mutación del prefijo. El implementador lo dejó escrito en la bitácora en vez de tapar la
discrepancia, que es lo correcto. Queda como **menor M2**: corregir la línea del spec para que el
siguiente no lo lea como un test comprado.

### 2.5 El handler de chat/media NO se tocó — CONFIRMADO

`git diff --stat origin/dev...HEAD -- app/` está **vacío**: ni un archivo de `app/` en el diff. El
`{ error: "unauthenticated" }` de `app/api/chat/media/[mensajeId]/route.ts:100` sigue tal cual
(D2 respetada), igual que el `UnauthenticatedError` de `chunk/route.ts`. Ninguna desviación.

---

## 3. Trazabilidad verificada — R<n> → test

Los corrí yo: 8 archivos, **102 tests passed, 0 skipped** (2,1 s). «Muere con la mutación» = lo
comprobé revirtiendo el arreglo en el árbol y restaurándolo después.

| R | test que lo verifica | ¿muere con la mutación? |
| --- | --- | --- |
| R1 | `tests/unit/auth/middleware-api-401.test.ts` › «POST /api/ordenes/carga-masiva/chunk sin cookie responde 401», «GET /api/chat/media/uuid…», «una ruta de API que todavia no existe…» | sí |
| R2 | idem › «content-type application/json y un cuerpo con code UNAUTHORIZED» + «el cuerpo del 401 de la media…» | sí (con la de borrar la rama) |
| R3 | idem › `it.each` «%s no trae Location ni un status 3xx» + la guardia de R10 | **sí, y es el único que caza el 302 con cuerpo JSON** |
| R4 | idem › «borra la cookie de sesion que fallo la validacion al responder 401» (además exige que `isSessionActive` se llamara con esa cookie: el 401 es «no vale», no «no traía») | sí |
| R5 | idem › `it.each(["GET","POST","PUT","PATCH","DELETE"])` | sí (5 casos) |
| R6 | `tests/unit/auth/middleware.test.ts`, bloques de páginas SIN TOCAR + 2 casos nuevos (`/ordenes` → 307 con `?redirect=`; `/paquete/ABC123` → 307 a `/`) | n/a (control de no-regresión: verde antes y después) |
| R7 | `middleware-api-401.test.ts` › «el path /api exacto», «/apitos sigue redirigiendo (307)», «/api-docs es una PAGINA publica: 200» | `/apitos` muere con `startsWith("/api")` |
| R8 | `middleware.test.ts`, bloques público y self-auth SIN TOCAR + guardia R10 › «CONTROL: una ruta con autenticacion propia sigue PASANDO» (exige `isSessionActive` NO llamado) | n/a (control) |
| R9 | `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts` SIN TOCAR, verde | n/a (guardia firmada) |
| R10 | `tests/unit/guards/api-sin-redirect-sin-sesion.guardia.test.ts`: barrido del árbol + 2 controles de no-vacuidad (≥24 archivos, `[param]` sustituido) + 2 controles de sentido | sí, **y nombra el archivo de ruta culpable** |
| R11 | `tests/components/CargaMasivaChunks.test.ts` › «ChunkRequestError con status 401» · `tests/components/useMediaChat.test.tsx` › «un 401 deja el adjunto en estado error, nunca en listo» | el de `useMediaChat` trae su **propio control**: con 200 + HTML del login reproduce el estado «listo» de hoy, así que mide al consumidor real y no a una maqueta |

**Ningún requisito se queda sin test, y ningún test es vacío.**

---

## 4. Hallazgos

### BLOQUEANTES

**Ninguno.**

### menores

- **M1 — `tasks.md` tiene 0 de 10 tasks marcadas `[x]`.** Es contabilidad, no sustancia: T1–T8 están
  evidenciadas en la bitácora y las verifiqué de forma independiente (superficie contada, gate
  verde, mutaciones rojas). T9 (PR) y T10 (aviso a Nuform) están pendientes POR DISEÑO. Aun así
  `CHECKPOINTS.md` exige las casillas marcadas para pasar a `done`, y el repo sigue esa convención
  (la 422 tiene 17 `[x]`). **Marcar T1–T8 antes de cerrar la ficha.**
- **M2 — `requirements.md` R7 y el mapa de `tasks.md` siguen afirmando que `/api-docs` redirige a
  `/login`.** Es falso: está en `PUBLIC_ROUTES` y responde 200. El código y el test son correctos;
  lo que queda mal es el texto del spec, corregido solo en la bitácora. Una línea de arreglo evita
  que el siguiente lea ese test como aflojado.
- **M3 — T10 (aviso a Nuform) sigue con la fecha en blanco** (`progress/impl_426.md:278`). Es tarea
  del humano y está registrada a propósito; NO es hallazgo de código, pero sí es la puerta de
  despliegue: sin ella la release no sale. Se anota para que no se descubra el día de la release.
- **M4 — falta la entrada en `progress/history.md`.** Paso de cierre del leader.
- **M5 — alcance del barrido de R10 (observación, no defecto).** La guardia enraíza en `app/api`,
  así que un hipotético `app/(grupo)/api/x/route.ts` —que en Next serviría `/api/x` sin vivir bajo
  `app/api`— no entraría en el barrido. **No abre ningún agujero**: el arreglo decide POR PATHNAME,
  de modo que esa ruta igual recibiría su 401; lo único que no cubriría es la guardia. Y R10 está
  redactado explícitamente sobre `app/api/**/route.ts`, así que la guardia mide exactamente lo que
  el requisito pide.
- **M6 — sugerencia para `docs/release.md`.** El smoke post-despliegue ya verifica los tres archivos
  de la PWA y `/ordenes`. Como este cambio es observable para un tercero, añadir una línea del tipo
  `curl -sI https://ordenex.co/api/ordenes/carga-masiva/chunk` esperando **401** (hoy: 307) daría
  señal inmediata de que el arreglo llegó. No bloquea.

### Lo que NO se contó como hallazgo (declarado de antemano)

- Que la ficha no arregle la caducidad de la sesión del integrador: es explícito en el spec.
- La casilla «avisar a Nuform antes de desplegar»: tarea del humano (aparece en M3 solo como
  recordatorio de la puerta de despliegue).
- Los 184 warnings de lint: baseline del repo. Verifiqué que ninguno cae en archivos de esta feature.

---

## 5. Seguridad y calidad

- **No afloja nada.** Cambia la FORMA del rechazo, no quién pasa: las tres listas firmadas intactas,
  el matcher intacto, la validación real contra la DB intacta y el borrado de la cookie inválida
  conservado (probado en R4).
- **No filtra información.** El cuerpo es el mensaje fijo de `MSG.UNAUTHORIZED`: sin PII, sin el
  pathname, y sin distinguir «no existe» de «no autenticado» — igual que el 307 de antes.
- **Sin `WWW-Authenticate`**, decidido a conciencia en el diseño §3 (evita el diálogo de credenciales
  del navegador). De acuerdo.
- **Capas:** `middleware.ts` no gana lógica de negocio ni queries; delega en `appErrorToResponse`
  (feature 10). Los imports profundos (`@/lib/errors/http`, `@/lib/errors/app-error`) en vez del
  barril están justificados —el barril arrastra `zod` a un bundle que corre en cada petición— y
  tienen precedente en el repo.
- **Un solo contrato para «no hay sesión»**: el borde emite exactamente lo que habría emitido el
  handler de `chunk`. Coherente con D1.
- **Base de datos:** cero. No hay migración, tabla, columna ni RLS que revisar.

---

## Veredicto final

**OK.** No hay bloqueantes. El arreglo hace lo que el spec dice y solo eso; los tres tests del
defecto están genuinamente invertidos (verificado con tres mutaciones propias, no por la bitácora);
las listas firmadas, el matcher de la PWA y los dos handlers están intactos; los 11 requisitos
tienen un test que corre y muere si se revierte el arreglo; y el gate completo cerró en
`INIT_EXIT=0` con `.env` presente. Los seis hallazgos menores son contabilidad y documentación:
ninguno toca el comportamiento. **Antes de marcar la ficha `done`: M1, M2 y M4. Antes de desplegar
a `prod`: M3.**
