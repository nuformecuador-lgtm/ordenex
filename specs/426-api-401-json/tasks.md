# 426 — tareas

> Zona `backend`. Un solo archivo de producción: `middleware.ts`.
> **El gate de esta ficha es `./init.sh` COMPLETO**: `--rapido` se niega solo porque el diff toca
> `middleware.ts` (`docs/verification.md:79`). No hay migración, no hay base de datos.

## Archivos esperados

| archivo | qué |
| --- | --- |
| `middleware.ts` | **modificado** — la rama 5.a del diseño (`esRutaApi` + 401 JSON) |
| `tests/unit/auth/middleware-api-401.test.ts` | **nuevo** — los casos de R1–R5, R7 |
| `tests/unit/guards/api-sin-redirect-sin-sesion.guardia.test.ts` | **nuevo** — el barrido de R10 |
| `tests/unit/auth/middleware.test.ts` | **modificado** — 2 casos (líneas 164 y 246) |
| `tests/integration/api/chat-media-middleware.test.ts` | **modificado** — 1 caso (línea 29) |
| `tests/components/CargaMasivaChunks.test.ts` | **modificado** — un caso de R11 (401) |
| `tests/components/useMediaChat.test.tsx` | **nuevo** — el otro caso de R11 |
| `progress/impl_426.md` | **nuevo** — bitácora, con el mapa `R<n> → test` y las salidas pegadas |

## Checklist

- [ ] **T1. Confirmar la superficie sobre el árbol, no sobre la ficha.**
  Enumerar `app/api/**/route.ts`, clasificar cada archivo en público / self-auth / sesión y anotar
  la cuenta en la bitácora.
  *Hecho cuando:* hay un número por grupo y coincide con el diseño §4 (24 archivos: 1 + 21 + 2) o,
  si no coincide, la discrepancia está escrita **antes** de tocar nada.
  *Depende de:* nada.

- [ ] **T2. La rama en `middleware.ts` (R1, R2, R3, R4, R5, R7).**
  `esRutaApi(pathname)` con la regla del primer segmento y, en el punto de rechazo, la respuesta
  `appErrorToResponse(new UnauthenticatedError().toShape())` **antes** de `REDIRECT_TO_ROOT`.
  Imports profundos (`@/lib/errors/http`, `@/lib/errors/app-error`), no el barril.
  El borrado de la cookie inválida sigue siendo común a las dos ramas.
  *Hecho cuando:* `pnpm run typecheck` y `pnpm run lint` en verde y las tres listas del middleware
  quedan **carácter por carácter** como estaban (R9).
  *Depende de:* T1.

- [ ] **T3. Los casos del middleware (R1, R2, R3, R4, R5, R7).** `tests/unit/auth/middleware-api-401.test.ts`,
  con el molde del archivo vecino (mock de `@/lib/auth/session-guard`, middleware real, `NextRequest`).
  Cubre: las dos rutas reales sin cookie → 401; `content-type` + `await res.json()` con
  `code: "UNAUTHORIZED"`; `location` nulo y status no-3xx; los cinco métodos; cookie inválida
  borrada; `/apitos` y `/api-docs` siguen siendo páginas.
  *Hecho cuando:* el archivo está verde y **rojo** si se revierte T2.
  *Depende de:* T2.

- [ ] **T4. Actualizar los tres casos que afirman el defecto (R6 sigue intacto).** [P] con T5, T6
  `middleware.test.ts:164` y `:246` y `chat-media-middleware.test.ts:29`, según la tabla del
  diseño §8. En cada uno, el comentario debe decir **qué se conservó** (la ruta sigue guardada), no
  solo el número nuevo.
  *Hecho cuando:* los tres archivos están verdes, los bloques de páginas y de self-auth **no se han
  tocado** (se comprueba con `git diff`), y las dos aserciones de
  `chat-media-middleware.test.ts:49-72` siguen exactamente igual.
  *Depende de:* T2.

- [ ] **T5. La guardia del barrido (R10).** [P] con T4, T6
  `tests/unit/guards/api-sin-redirect-sin-sesion.guardia.test.ts`: enumera `app/api/**/route.ts`,
  construye el pathname de cada uno (`[param]` → literal), corre el middleware sin cookie y exige
  cero `3xx`. Con los dos controles de no-vacuidad del diseño §9 (≥ 24 archivos; las dos rutas de
  sesión en 401 + JSON y una self-auth pasando).
  *Hecho cuando:* verde sobre el árbol, y la **mutación de control** (revertir la rama 5.a) la deja
  **roja nombrando el archivo de ruta culpable**; las dos salidas pegadas en la bitácora.
  *Depende de:* T2.

- [ ] **T6. Los consumidores (R11).** [P] con T4, T5
  (a) un caso en `tests/components/CargaMasivaChunks.test.ts` con `Response(…, {status:401})` →
  `ChunkRequestError` con `status === 401`;
  (b) `tests/components/useMediaChat.test.tsx` con `renderHook` (hay precedente:
  `tests/components/usePagination.test.tsx`) y un `fetch` que responde 401 → estado `"error"`, y
  **nunca** `"listo"`.
  *Hecho cuando:* ambos verdes; y (b) puesto a prueba con un doble que devuelve `200` + HTML, que
  debe reproducir el estado `"listo"` de hoy — si no lo reproduce, el test no está midiendo el
  consumidor real.
  *Depende de:* nada (miden el cliente, no el middleware). Se pueden escribir antes que T2.

- [ ] **T7. Mutación de control del arreglo.** Cambiar el 401 por un `302` con cuerpo JSON y
  comprobar que **muere** el caso de R3 (no solo los de R1/R2); revertir `esRutaApi` a
  `startsWith("/api")` (sin barra) y comprobar que **muere** el caso de `/apitos` (R7).
  *Hecho cuando:* las dos salidas rojas, con nombre de test, están pegadas en la bitácora.
  *Depende de:* T3.

- [ ] **T8. Gate completo y bitácora.** `./init.sh` (sin tocarlo), con `INIT_EXIT=$?` escrito
  **dentro** del log y sin canalizarlo por `tail`. Bitácora `progress/impl_426.md` con el mapa
  `R<n> → test`, las salidas y el número de `skipped`.
  *Hecho cuando:* `INIT_EXIT=0` en el log, la comparación contra `tests/baseline-rojos.json` no
  añade ningún archivo nuevo, y el mapa de abajo está completo.
  *Depende de:* T2–T7.

- [ ] **T9. PR contra `dev` y ficha.** PR con el diff de los 8 archivos y el veredicto del gate
  citado; `status_note` de la 426 en 3–6 líneas.
  *Hecho cuando:* el PR está abierto, el log del gate **commiteado** como evidencia, y el árbol
  remoto contiene lo que dice el informe (verificar el blob, no el árbol local).
  *Depende de:* T8.

## Mapa `R<n> → test`

| R | test |
| --- | --- |
| R1 | `tests/unit/auth/middleware-api-401.test.ts` › «POST /api/ordenes/carga-masiva/chunk sin cookie responde 401» y «GET /api/chat/media/<uuid> sin cookie responde 401» |
| R2 | idem › «el 401 llega con content-type application/json y un cuerpo con code UNAUTHORIZED» |
| R3 | idem › «el rechazo de una ruta de API no trae Location ni un status 3xx» + `tests/unit/guards/api-sin-redirect-sin-sesion.guardia.test.ts` |
| R4 | idem › «borra la cookie de sesion que fallo la validacion al responder 401» |
| R5 | idem › `it.each(["GET","POST","PUT","PATCH","DELETE"])` «responde 401 sea cual sea el metodo» |
| R6 | `tests/unit/auth/middleware.test.ts` › bloques de páginas ya existentes (`/ordenes`, `/dashboard`, `/xyz`, `/apitos`, `/paquete/ABC123`, `/`) — **sin modificar** |
| R7 | `tests/unit/auth/middleware-api-401.test.ts` › «/apitos y /api-docs no son rutas de API: siguen redirigiendo a /login» |
| R8 | `tests/unit/auth/middleware.test.ts` › bloque «endpoints con autenticacion propia» y rutas públicas — **sin modificar** — + la aserción de self-auth de la guardia de R10 |
| R9 | `tests/unit/guards/rastreo-sin-ruta-nueva.guardia.test.ts` › «`PUBLIC_ROUTES` / `SELF_AUTH_ROUTES` / `REDIRECT_TO_ROOT` es EXACTAMENTE la lista firmada» — **sin modificar**, debe seguir verde |
| R10 | `tests/unit/guards/api-sin-redirect-sin-sesion.guardia.test.ts` › «ninguna ruta de app/api responde 3xx sin cookie de sesion» (+ sus dos controles de no-vacuidad) |
| R11 | `tests/components/CargaMasivaChunks.test.ts` › «lanza ChunkRequestError con status 401 si el lote responde 401» · `tests/components/useMediaChat.test.tsx` › «un 401 deja el adjunto en estado error, nunca en listo» |

## Notas para quien implemente

- **No metas ninguna ruta en `PUBLIC_ROUTES` ni en `SELF_AUTH_ROUTES`.** Ese camino está descartado
  y razonado en `design.md §6 (A1)`; además pone rojas dos guardias.
- **No toques los handlers.** Los dos ya responden 401 JSON por su cuenta; el defecto es que nunca
  corren. Cambiar su cuerpo es la pregunta abierta 2, no una task.
- El texto del cuerpo sale de `MSG.UNAUTHORIZED`; no escribas el literal a mano en ningún sitio,
  tampoco en los tests (compáralo contra la constante **solo** si el contrato que fijas es el
  `code`, no el mensaje: un `toEqual` contra su propia fuente siempre está verde).
