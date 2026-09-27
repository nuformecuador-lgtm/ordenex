# Revisión T4.3 — Feature 454 (el estado se aplica al aprobar el cierre)

> Reviewer. Commit revisado: `edff9ccf` (`origin/feature/454-estado-al-aprobar-cierre-final`), comprobado
> con `log --oneline -1`. Base de `dev` para aislar el diff: `f05b7c3f` (merge-base con `origin/dev`).
> Entorno: junction de `node_modules`, `.env` copiado sin imprimir, `prisma generate`; base local
> compartida con M1–M3 ya aplicadas.
> Búsqueda de código: el MCP `codebase-memory` (`R-job-singularis-projects-ordenex`) NO tiene ningún
> símbolo de la 454 (`search_graph` de `registrarGestionPendiente|anotarSenalesGestion|findParaCorreccion`
> devuelve 0): índice rancio para esta rama. Todo se leyó en el archivo real con `grep`/lectura directa.
> El recorrido en navegador (T4.2) lo hace otro agente y no se esperó.

## Veredicto de la primera revisión (sobre `edff9ccf`): RECHAZADO — ver «Re-revisión» al final para el veredicto FINAL

Tres bloqueantes, todos con arreglo pequeño y ninguno en el código de producción que ya está:
el gate completo está ROJO por un archivo de la 454, R56 no tiene ningún test que lo verifique y la
autorización del lector nuevo del detalle no tiene red (una mutación sobrevive). El resto está
sólido: Fase 0 limpia, dinero y corte cubiertos, migraciones coherentes, contraste de producción con
0 diferencias de dinero.

## Checklist

| # | Punto | Resultado |
|---|---|---|
| 1 | Trazabilidad R1–R65 → test que existe y pasa | **FALLA en R56** (sin test; mutación sobrevive). R65 es vacuo (ver m2). El resto: los tests existen y pasan (abajo) |
| 1b | Tests citados, corridos por mí | `tests/integration/db/454`: **47 archivos, 243 tests, 0 skipped, verde**. 33 archivos unitarios/componentes/integración citados en las bitácoras (habilitación API, OpenAPI 405/454/webhook, webhook-eventos, guía, reparto-mañana, N1, aplicación, timeline, rastreo, chips, guardias, traspaso, cambio de día, caja-cod, wallet-idempotencia, WebhookEventoOrdenService, cierres-admin-repository): **686 tests verdes** |
| 2 | Fase 0: invariantes intactas salvo los 5 cambios autorizados | **OK**. Diff `3603d199..edff9ccf` de `tests/integration/db/454/caracterizacion` y `_escenario.ts`: fuera de `[INTERMEDIO]` solo cambian C10 (clave `calle` sale de la precondición), C17 (2 líneas pasan al `[INTERMEDIO]`), C16 (g1 sembrada LEGADA), C23 (solo el argumento `aplicacionGestiones`) y `_escenario.limpiarComprometido` (borra `orden_evento` y sus jobs antes). Cada uno está en `impl_454_backend.md` con antes→después y su rojo. Los demás cambios (C01, C05, C06, C07 `it.fails`→`it`, C14, C22, C25, C26) están dentro de `[INTERMEDIO]` con nota fechada |
| 3 | Mutaciones propias | 12 mutaciones: **10 ROJAS, 2 SOBREVIVEN** (MUT-R6 y MUT-R10). Tabla abajo |
| 4 | Cambios fuera de encargo del frontend + `NOMBRE_RESULTADO_PENDIENTE` | **OK**, correctos y probados (MUT-R7, R8, R9 rojas) |
| 5 | Migraciones M1–M3 | **OK** (detalle abajo) |
| 6 | Seguridad y alcance | Código **OK**; la red del detalle tiene un agujero (B3) |
| 7 | `./init.sh` completo | **ROJO: `INIT_EXIT=1`** (`progress/gate_review_454.log`). 1 rojo propio (B1) + 4 archivos ajenos medidos |
| — | tasks.md todas `[x]` (CHECKPOINTS) | **FALLA**: ni una tarea marcada (m1) |
| — | RLS en tabla nueva | OK: `orden_evento` con `ENABLE ROW LEVEL SECURITY` (M2) |
| — | Webhooks: firma/idempotencia | OK: `webhook_evento` reusa `cabecerasFirma`, pausa por circuito y `dedupe_key = webhook_evento:<id>`; payload del job `{ ordenEventoId }` sin PII |
| — | Sin secretos ni hardcode de contexto | OK |
| — | Capas | OK (repos con SQL, servicios sin HTTP, interfaces en `lib/interfaces/`) |
| — | E2E Playwright | No aplica: no hay harness en el repo; el riesgo lo cubre el recorrido T4.2 |
| — | Contraste (T3.1) | OK: producción, 165 cierres aprobados, **K8a–e = 0** (dinero idéntico); K1 = 1 y K6 = 41 explicados en `contraste_454.md`, ninguno es regresión. No lo re-corrí (lo corrió el leader por MCP) |

## Gate completo (`./init.sh`, log sin tail, `INIT_EXIT` escrito dentro del log)

`progress/gate_review_454.log`: typecheck y lint verdes; `Test Files 5 failed | 2125 passed (2130)` ·
`Tests 6 failed | 30425 passed | 26 skipped`; los 26 skipped son los de siempre (Analítica), 0 skipped en
`integration/db` (DATABASE_URL resuelta, 246 archivos contra Postgres). **`INIT_EXIT=1`**.

| Archivo rojo | Aislado sobre `edff9ccf` | Aislado sobre `dev` limpio `f05b7c3f`, misma base | Lectura |
|---|---|---|---|
| `tests/unit/guards/caja-173-alcance.guardia.test.ts` | ROJO (`expected [ 'scripts/contraste-454.ts' ] to deeply equal []`) | no existe el archivo → verde | **PROPIO de la 454 → B1** |
| `integration/db/cierre-bloqueo-nv-sql-real` (T10.1/R34) | ROJO | ROJO igual | ajeno: toma los 3 primeros usuarios reales de la base compartida y el 3.º tiene cierres abiertos |
| `integration/db/notificacion-evento-bloqueo-cierre-migration` | ROJO | ROJO igual | ajeno: el CONTROL del down choca con filas `cierre_dia_rechazado` de la base compartida (22P02) |
| `integration/db/notificacion-evento-gasto-fijo-migration` | ROJO | ROJO igual | ajeno, misma causa |
| `integration/db/notificacion-evento-webhook-suscripcion-migration` (×2) | ROJO | ROJO igual | ajeno, misma causa |

Los cuatro ajenos fallan idénticos en `dev` limpio con la misma base: dependen de los DATOS de la base
local compartida, no del código de la 454. Aun así, el gate tiene que quedar verde (o esos cuatro medidos
en `tests/baseline-rojos.json` con su motivo) antes de la release.

## Hallazgos

### BLOQUEANTE

**B1 — Gate completo rojo por un archivo de la 454.** La guardia `caja-173-alcance`
(«CIERRE de la lista: toda fuente que nombre las categorías nuevas está declarada», línea 564) cae de
forma determinista por `scripts/contraste-454.ts`, que nombra las categorías de wallet y no está
declarado. Entró con el merge `b5772b7f` (rama `feature/454-contraste`, cuya bitácora dice «`pnpm test`:
no aplica») y **no se corrió ningún gate después** de ese merge ni del de `dev` (`edff9ccf`): el último
verde es `76979e2c`. Arreglo: declarar el script en la lista de la guardia con su motivo (script de solo
lectura, verificación T3.1) y volver a correr `./init.sh` completo.

**B2 — R56 sin test (trazabilidad).** R56: las órdenes con gestión pendiente NO cuentan como carga del
mensajero (aviso de mensajero ocupado, «Generar guía», aviso de reparto de mañana). Implementado en
`lib/repositories/OrdenRepository.ts:5186` (`findMensajerosConOrdenesEn`) y
`lib/repositories/RepartoMananaRepository.ts:102`. **MUT-R10 quita las dos líneas y sobrevive a 62
archivos / 669 tests** (guía, reparto-mañana repo/servicio/ruta/dedupe, guardias de carga y estados de
reparto, `ordenes-guia-action`, bloqueo por cierres, toda `integration/db/454`). T1.18 pedía «tests de
`GuiaAsignacionService` y `RepartoMananaRepository` con una orden pendiente que no cuenta»; no existen, y
la tabla de `tasks.md` cita `GuiaAsignacionService.carga.test.ts` y `RepartoMananaRepository.test.ts`, que
tampoco. Falta: un test contra Postgres real con un mensajero cuya única orden `en_reparto` tiene gestión
pendiente → no aparece en `findMensajerosConOrdenesEn` ni en el universo de reparto de mañana; y un control
positivo (la misma orden sin gestión sí cuenta). Registrar su mutación.

**B3 — Mutación superviviente en el alcance del lector nuevo del detalle (R29/R64).** MUT-R6: en
`lib/services/OrdenHistorialService.ts:162`, devolver las señales (`findSenalesGestion`) también cuando la
autorización NO es `ok` → **18/18 verdes**. Causa: el helper `detalle` de
`tests/integration/db/454/senales-gestion-lectores-sql-real.test.ts:168-171` devuelve solo `{ status }`
para cualquier resultado no-`ok`, así que la aserción «la ajena no le llega (not_found, sin señales)»
(línea 269) no puede fallar nunca. No es teórico: `lib/actions/orden-historial.ts:58` devuelve el
resultado del servicio tal cual al cliente. El código de hoy es correcto; lo que falta es la red.
Arreglo: que `detalle` devuelva el resultado crudo en la rama no-`ok` (o asertar
`toEqual({ status: "not_found" })` sobre `obtenerHistorial` directamente) y registrar la mutación.

### menor

- **m1 — `tasks.md` sin ninguna tarea marcada.** T0.0–T4.3 siguen `[ ]` aunque las bitácoras las dan
  por hechas (CHECKPOINTS: «todas marcadas `[x]`»). Además la tabla «Trazabilidad R → test» de
  `tasks.md` cita 9 archivos que no existen (`MisAsignacionesService.gestionable`, `ApiHabilitacionService`,
  `unit/services/OrdenesListado.gestion-pendiente`, `ApiOrdenLecturaService.pendiente`, `openapi-spec`,
  `rastreo-publico.retirados`, `GuiaAsignacionService.carga`, `RepartoMananaRepository`,
  `AvisoAgregadoRepository.ayuda`). El mapa real está repartido entre `impl_454_backend.md`,
  `impl_454_datos.md` e `impl_454_frontend.md`: consolidarlo en uno.
- **m2 — R65 es vacuo.** Confirmado en `dev` (`f05b7c3f:lib/repositories/AvisoAgregadoRepository.ts`):
  solo cuenta el grupo `devolucion`; no hay aviso diario que cuente `ayuda_tienda`. La premisa de R65 es
  falsa. Declararlo en `requirements.md` como «no aplica, medido» en vez de mapearlo a un test que no existe.
- **m3 — La red de caracterización perdió dientes en dos puntos.** Tras el cambio autorizado #3, C16 ya
  no detecta quitar el filtro de recencia (MUT-R3a deja C16 verde; R57 lo cubre solo
  `aplicacion-al-aprobar` «R57»). MUT-R2 (sin la segunda vía de intentos) deja verdes C03 y C04; solo lo
  detecta `intentos-segunda-via-sql-real`. Los dos puntos están cubiertos, pero por un único test cada uno.
- **m4 — La red 454 depende del catálogo de la base local.** `_escenario.ts:67-72,125` exige
  `ayuda_tienda` y `devolucion_por_confirmar` en `order_status`; M3 los BORRA en una base sin referencias
  (un `migrate reset` o una base nueva). Ahí las 47 suites caerían en `prepararMundo`. Hoy se mantiene
  solo porque la base compartida tiene historial que los referencia. Sembrarlos dentro de la tx o
  documentarlo.
- **m5 — R11 a medias.** El test «R11: si un paso POSTERIOR falla…» afirma estado, historial, cierre y
  wallet, pero no la ausencia de eventos/jobs (`orden.estado_actualizado`) que R11 también nombra.
- **m6 — MUT-R4 cae por la precondición, no por la aserción.** Cambiar la familia de la `devuelta`
  aplicada a `gestion` pone rojo C05 en su `beforeAll` («la aprobacion no escribio la fila de anclaje», 5
  skipped). La variante MUT-R4b (el ancla se lee por la rama legada) sí cae en la aserción del reloj. Queda cubierto.
- **m7 — Comentario inexacto** en `tests/integration/db/wallet-idempotencia.test.ts` («con el reloj
  corriendo desde la gestion, R47»): R47 ancla en la aprobación. Solo es un comentario.
- **m8 — Desempate de recencia distinto.** La aplicación (`CierresAdminRepository.ts:2179`) ordena solo
  por `createdAt desc`; el lateral de señales usa `created_at DESC, id DESC`. Con R3 no puede haber dos
  pendientes nuevas empatadas, así que no tiene efecto hoy.
- **m9 — 4 rojos ajenos del gate** (tabla de arriba): de la base compartida, no de la 454. Tienen que
  resolverse o medirse en el baseline antes de la release.

## Punto 4 — cambios fuera de encargo del frontend

- **R64 `findParaCorreccion`** (`OrdenRepository.ts:2754`, `correccion-datos-cliente.ts`,
  `CorregirDatosClienteService.ts:220`): correcto. La ayuda abierta se deriva del punto único
  (`conAyudaAbiertaDe`) y solo amplía el caso `adminTienda`; el parámetro es obligatorio y la propiedad de
  la tienda la sigue comprobando el servicio. Probado: MUT-R7 (quitar `|| ayudaAbierta`) → ROJO en
  `454/correccion-ayuda-abierta-sql-real` C1.
- **R40 vínculo de barridas** (`lib/utils/cierre-sin-gestion.ts`): deja pasar un value RETIRADO para que
  la barrida histórica siga leyéndose «Ayuda de la tienda». Lo que no es vigente ni retirado sigue
  omitiéndose. Probado: MUT-R8 → ROJO en `cierres-admin-repository` «R9».
- **`NOMBRE_RESULTADO_PENDIENTE`** (`lib/types/rastreo-publico.ts`): copia declarada de 5 nombres, atada
  por un test que compara contra un LITERAL escrito a mano Y contra `ORDER_STATUS_LABELS[ESTATUS_POR_RESULTADO[r]]`
  (no solo contra su propia fuente). MUT-R9 («Rechazado») → ROJO en los dos casos. El rastreo público
  solo expone `nombreResultado` y la fecha, después de la verificación guía+teléfono, sin actor, motivo ni mensajero.

## Punto 5 — migraciones

- Ninguna migración aplicada se editó: el diff contra `dev` en `db/migrations` son solo las 3 carpetas nuevas.
- **M1** (`job_tipo += webhook_evento`): va sola por el 55P04. Su down RECREA el enum con una lista de 10
  valores, que es una foto de esta rama (lo declara con aviso de que borra valores posteriores). Suelta y
  recrea el índice parcial de la 401 y borra antes los jobs `webhook_evento`. Correcto con el riesgo
  documentado; ningún down previo se tocó.
- **M2** (`orden_evento`): aditiva, FKs RESTRICT, índice único parcial por gestión, CHECKs con
  `IS NOT NULL` explícito y RLS activada. El down suelta tabla y tipo y documenta que va DESPUÉS del de M3.
- **M3** (backfill + retiro): un solo `DO`; primero las precondiciones con `RAISE` (ayuda sin solicitud
  con actor; `devolucion_por_confirmar` sin `devuelta` pendiente); luego el rastro por orden (incluidas
  las borradas), los eventos de ayuda y de registro, el backfill solo de `estatus_id`, y el retiro
  **condicional** que mira las 4 tablas con FK a `order_status` (confirmado en las migraciones:
  `orden`, `orden_historial_estado` ×2, `cierre_sin_gestion`, `analytics_daily`). El down repone el
  catálogo (tabla, no enum: no hay recreación con lista), aplica al modelo viejo las pendientes y las
  ayudas abiertas nuevas, devuelve solo lo intacto y borra el rastro. Idempotencia, up→down→up y ausencia
  de jobs los cubre `retiro-estados-migration.test.ts` (13 casos, verdes).

## Punto 6 — seguridad y alcance

- Los listados (`/ordenes`, bodega satélite: página y grupos) anotan las señales SOLO sobre los ids que
  el `where` con alcance ya dejó pasar (`anotarSenalesGestion`, `OrdenRepository.ts:1825`). No hay
  consulta nueva que recorte. Cubierto por L1/L2 de `senales-gestion-lectores-sql-real` (tienda ajena y
  zona ajena no llegan).
- Detalle: las señales y los eventos se leen DESPUÉS de `autorizar` (`OrdenHistorialService.ts:161-185`).
  Correcto hoy, pero sin red (B3).
- Timeline: `findEventosByOrden` no expone `motivo` ni el mensajero; el nombre del actor, igual que las
  transiciones de hoy.
- Webhook: job `{ ordenEventoId }`. El cuerpo va firmado al dueño de la orden, con `motivo` = causa
  tipificada (nunca texto libre) y el DTO de mensajero de la convención 256/404.

## Tabla de mutaciones

Propias. Cada una se aplicó con `perl -pi`, se comprobó con el diff del archivo, se revirtió restaurando
el archivo del índice y se confirmó que el árbol de `lib`/`app` quedaba limpio antes de la siguiente.

| Id | Punto | Archivo:línea — mutación | Tests corridos | Resultado |
|---|---|---|---|---|
| MUT-R1 | Corte que no barre gestionadas (R43) | `CierreDiaRepository.ts:979` — fuera `...whereOrdenSinGestionPendiente()` de la re-lectura del corte | C01 + `corte-excluye-pendientes-sql-real` | **ROJO** 6/10 (O1/O2 barridas, vínculo y sintética) |
| MUT-R2 | Conteo de intentos por la vía nueva (R45) | `OrdenHistorialRepository.ts:231` — fuera `whereTieneRegistroDeCalle()` del `OR` | C03 + C04 + `intentos-segunda-via-sql-real` | **ROJO** 1 (`intentos-segunda-via` «R45/DA»); C03 y C04 verdes (m3) |
| MUT-R3a | Bloque de aplicación: recencia (R57) | `CierresAdminRepository.ts:2187` — `aplicables = delCierre` | `aplicacion-al-aprobar` + C16 | **ROJO** 1 («R57»); C16 verde (m3) |
| MUT-R3b | Bloque de aplicación: guarda/idempotencia (R9/R12) | `CierresAdminRepository.ts:2203` — fuera `AND "estatus_id" = en_reparto` | `aplicacion-al-aprobar` + C11 + C17 | **ROJO** 1 («R9») |
| MUT-R4 | Anclaje del plazo (R47) | `CierresAdminRepository.ts:2219` — familia de la `devuelta` aplicada `anclaje_devolucion` → `gestion` | C05 | **ROJO** por precondición (`beforeAll`, 5 skipped) |
| MUT-R4b | Anclaje del plazo (R47) | `DevolucionSlaRepository.ts:42` — el ancla nunca se encuentra (rama legada, desde la gestión) | C05 | **ROJO** «el cron a t1 + ventana − 1 min NO escala»: `expected 'rechazada' to be 'devuelta'` |
| MUT-R5 | Guardia de doble gestión (R4/R44) | `GestionOrdenRepository.ts:752` — fuera el `SELECT … FOR UPDATE` | C07 + `registro-gestion-concurrencia` + C02 | **ROJO** 3 (C07: `expected 2 to be 1`; C02: el corte no esperó el candado y cae la invariante «nunca gestión Y barrida») |
| MUT-R6 | Alcance del lector nuevo (R29/R64) | `OrdenHistorialService.ts:162` — señales devueltas también si la autorización no es `ok` | `senales-gestion-lectores-sql-real` + `OrdenHistorialService.evento-orden` | **SOBREVIVE** 18/18 → **B3** |
| MUT-R7 | R64 frontend | `correccion-datos-cliente.ts` — fuera `|| ayudaAbierta` | `correccion-ayuda-abierta-sql-real` | **ROJO** 1 (C1) |
| MUT-R8 | R40 barridas | `cierre-sin-gestion.ts` — no deja pasar retirados | `cierres-admin-repository` + `cierre-dia-repository` | **ROJO** 1 («R9») |
| MUT-R9 | Copia de nombres | `rastreo-publico.ts` — `"Rechazada"` → `"Rechazado"` | `rastreo-publico.nombre-resultado` | **ROJO** 2 (contrato + fuente) |
| MUT-R10 | Carga del mensajero (R56) | `OrdenRepository.ts:5186` + `RepartoMananaRepository.ts:102` — fuera la exclusión de pendientes | 62 archivos (guía, reparto-mañana ×4, guardias de carga, acción de guía, bloqueo, `integration/db/454`) | **SOBREVIVE** 669/669 → **B2** |

## Qué hace falta para APROBAR

1. B1: declarar `scripts/contraste-454.ts` en `caja-173-alcance` con su motivo y correr `./init.sh`
   completo sobre la rama con `dev` mergeado. Rojos solo ajenos, medidos y verdes contra un control.
2. B2: test de R56 contra Postgres real (pendiente no cuenta + control positivo), con MUT-R10 en ROJO.
3. B3: endurecer `detalle` en `senales-gestion-lectores-sql-real` para que MUT-R6 dé ROJO.
4. (menores) marcar `tasks.md`, consolidar el mapa R→test, declarar R65 como no aplicable medido.

---

# Re-revisión (2026-09-24) — `origin/feature/454-gate-final` @ `d82d91bc`

Alcance pedido por el coordinador: solo B1–B3 y los menores. Checkout `--detach d82d91bc`; `origin/dev`
(`f05b7c3f`) es ancestro. Diff `edff9ccf..d82d91bc` en `lib app scripts db`: **vacío**. El arreglo toca
solo tests, specs y progress; el código de producción revisado no cambió. Leídos
`progress/impl_454_fix_review.md` e `impl_454_gate_final.md`.

## Veredicto FINAL: **APROBADO**

Sujeto a una condición de release que no bloquea la ficha: el gate completo sobre esta rama
(`gate_454_gate_final.log`, lo corre el leader) queda con `INIT_EXIT=1` SOLO por 4 casos de 3 archivos
ajenos (downs de `notificacion_evento`), cuya causa son 3 filas locales de `notificacion` creadas
fuera de los tests el 2026-09-24. Se probó causalmente y fallan igual en `dev` limpio (lo medí en la
primera revisión). Antes de la release, esas filas se borran de la base local o se miden en el baseline
con su motivo.

| Punto | Comprobación (ejecutada por mí) | Resultado |
|---|---|---|
| B1 | `caja-173-alcance.guardia` + `rutas-336-retiradas.guardia` | **verdes** (en la misma corrida de 4 archivos: 65/65). El gate lo corre el leader; su log muestra los dos verdes y solo los 4 casos ajenos rojos |
| B2 (R56) | Test nuevo `454/carga-mensajero-pendiente-sql-real` verde (5/5). **Mi MUT-R10 exacta** (fuera `...whereOrdenSinGestionPendiente()` en `OrdenRepository.ts:5186` y `RepartoMananaRepository.ts:102`, las dos a la vez) | **ROJO 2/5** («R56 ocupado/Generar guía» y «R56 reparto de mañana»). Revertida, árbol limpio |
| B3 (detalle) | `454/senales-gestion-lectores-sql-real` verde. **Mi MUT-R6 exacta** (`OrdenHistorialService.ts:162` devuelve las señales también si la autorización no es `ok`) | **ROJO 3/20** (tienda ajena, «alcance (servicio)», «alcance (Server Action)»). Antes sobrevivía 18/18. Revertida, árbol limpio |
| m1 | Tabla «Trazabilidad R → test» de `tasks.md`: cada ruta resuelta contra sus prefijos (`tests/integration/db/`, `tests/`, `progress/`, spec) | **80 rutas citadas (74 de test + docs), 0 inexistentes**; **R1–R65 tienen todas su fila**. 40 tareas `[x]`; siguen abiertas T4.x y la Fase 5, como corresponde |
| m2 (R65) | Nota de vacuidad en `requirements.md` bajo R65 y búsqueda (grep) de «ayuda» en HEAD sobre `app/api/cron/avisos-diarios`, `AvisosDiariosService`, `AvisoAgregadoRepository`, `config/avisos-diarios` | **0 líneas**. La vacuidad está declarada y medida |
| m4 (base nueva) | `_escenario.ts`: `prepararMundo` ya no exige los dos retirados; `asegurarRetirados()` los siembra dentro de la tx revertida, bajo demanda, y falla ruidosamente en un escenario comprometido. En caracterización solo se añaden 2 líneas de fixture, ninguna aserción | Correcto por lectura. La medición en una base nueva (`48 failed → 48 passed`) es del implementador; **no la re-medí** (habría que crear otra base en el Postgres compartido) |
| Red 454 completa | `pnpm exec vitest run tests/integration/db/454` | **48 archivos, 250 tests, 0 skipped, verde** |

Menores que quedan (no bloquean): m3, m5, m7 y m8 de la primera revisión siguen como estaban
(cobertura por un único test en R57/R45, R11 sin afirmar jobs, un comentario inexacto, desempate por
`id`). Y la fragilidad de los controles de down de `notificacion_evento` ante valores posteriores es deuda
de otras fichas, no de la 454.
