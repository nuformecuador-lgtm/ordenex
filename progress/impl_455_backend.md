# 455 — Fase 1 (backend) · bitacora del backend_dev

> 2026-09-24 · rama `feature/455-backend` creada con `git switch -c feature/455-backend 33ef583c`
> (`git log --oneline -1` → `33ef583c docs(455): fase 0 cerrada`: dev con la 454 y la Fase 0 de la 455).
> Busqueda de codigo: el MCP `codebase-memory` (proyecto `R-job-singularis-projects-ordenex`) se consulto
> primero (`search_graph`), pero esta rancio para la 454 y no sirve para un censo de literales: los
> simbolos se confirmaron en el archivo real y el reemplazo se hizo por AST de TypeScript.

## Veredicto

**Fase 1 hecha salvo T1.9 (rastreo publico), que exige tocar UI (§BLOQUEO-1).** Redes 454 y 455 en
verde tras cada grupo; 24 mutaciones, 24 rojas; el resto de rojos de la suite son tests de UI que
derivan texto del CODIGO y que la Fase 2 reescribe (§BLOQUEO-2). Resultado del gate: §Gate.

## Entorno (decision que se declara)

- `node_modules`: junction al del repo principal. **Consecuencia medida**: `prisma generate` escribe en
  el cliente COMPARTIDO (`node_modules/.pnpm/@prisma+client…`), asi que desde este agente el cliente
  Prisma de la maquina tiene el enum `GestionResultado` NUEVO. Cualquier otro worktree en `dev` que
  compile o corra tests necesita `pnpm exec prisma generate` en su arbol antes (memoria «Base local
  compartida rompe gates ajenos»).
- **Base de datos: NO se toco la base local compartida `ordenex`.** Se clono con
  `CREATE DATABASE ordenex_455 TEMPLATE ordenex` (0 conexiones activas en ese momento) y el `.env` de
  este worktree apunta a `ordenex_455` (reescrito por script, sin imprimirlo). `prisma migrate status` →
  `PostgreSQL database "ordenex_455" … at "localhost:5432"`. M1-M3 se aplicaron SOLO ahi
  (`prisma migrate deploy` → 212 migraciones). La base `ordenex` sigue sin la 455: la Fase 2 puede usar
  `ordenex_455` (mismo metodo) o migrar la compartida cuando el leader lo decida.
- En `ordenex_455` M3 borro `pendiente` (nadie la citaba) y conservo `en_fulfillment` (el historial la
  cita). En produccion (medicion) borrara las dos.

## Tareas

| T | Estado | Nota |
|---|---|---|
| T1.1 | Hecha | `lib/types/order-status.ts`: seed vigente, `NOMBRE_ESTADO`, `ESTADO_RETIRADO` (absorbe `ORDER_STATUS_RETIRADOS`, que queda como su subconjunto tipado), `CODIGO_VIGENTE_DE_ANTERIOR`, `nombreDeEstado`, `nombrePublicoDeEstado`, `codigoVigente`, `mensajeCodigoAnterior`. `lib/types/gestion-resultado.ts`: `nombreDeResultado`, `SENAL_PENDIENTE`, asercion de tipo. |
| T1.2 | Hecha | `GestionResultado` con los codigos vigentes, sin `@map`. `prisma validate` OK. `migrate diff` contra la base clonada propone recrear el enum con lista; M2 hace `RENAME VALUE` con el MISMO estado final (mismas etiquetas, mismo orden) — se prefirio a proposito (design §3.1). |
| T1.3 | Hecha | M1/M2/M3 + `down.sql`, cada uno un bloque `DO` idempotente. M3 lee las FK de `pg_constraint`. Test `tests/integration/db/455/migracion.test.ts` (16 casos). |
| T1.4 | Hecha | Interruptor cambiado (una sola edicion). Reemplazo mecanico por AST (solo codigo: literales, claves, SQL entre comillas; nunca comentarios ni textos visibles) en 94 archivos de produccion y ~560 de tests. `contadores.ts` con `Record<GestionResultado, keyof FilaTableroDia>`. |
| T1.5 | Hecha | `seedOrderStatus` falla ante un codigo anterior sin insertar. |
| T1.6 | Hecha | `…Nombre` en listado, detalle, gestiones, evidencias, cancelacion, borrado, habilitacion y carga; `filas[].estatus` → `estado` + `estadoNombre`; 422 explicativo. |
| T1.7 | Hecha | `estadoNombre` pegado tras `estado` en `orden.estado_actualizado`; `resultadoNombre`/`resultadoAnteriorNombre` en los eventos 454. |
| T1.8 | Hecha | `ORDER_STATUS_ENUM = [...ORDER_STATUS_SEED]`; `schemaNombre()`; `.yaml` espejo verificado ESTRUCTURALMENTE (js-yaml contra el objeto TS: quedan 4 diferencias PREEXISTENTES en `CotizacionEscenarioDevuelto`, ajenas, no tocadas); Postman; CHANGELOG (RUPTURA); `configuracion-api.md`; `manual-metricas-por-mensajero.md`. |
| T1.9 | **BLOQUEO-1** | Ver abajo. |
| T1.10 | Hecha | G1 (brazo 455 del censo), G2, G3, G4 (+ G5 en T1.8), cada una con su mutacion en el archivo y una mutacion de arbol registrada. G2/G3 llevan `PENDIENTES_FASE_2` (conteo exacto por archivo). |
| T1.11 | Hecha | `{{estatus}}`, notificacion de rechazo, etiqueta de la analitica operativa, prosa de `metrics.ts` sin codigos anteriores. La ETIQUETA «Sin gestionar» de la metrica `novedad_interna` se quedo: cambia JUNTO con su panel (UI) en la Fase 2 (guardia `etiquetas-visibles`). `lib/services/mensajes-*.ts` NO cambian: llevan el CODIGO a proposito porque la UI lo parsea y lo traduce (`*-error-messages.ts`, Fase 2 T2.7). |
| T1.12 | Hecha (parte lib) | Lector de `historial_accion.valor_*` traduce al leer (`codigoVigente`); filtros por URL traducen un codigo anterior. La COLUMNA que pinta el valor (`historial-acciones-columnas.ts`) es UI: el `[INTERMEDIO]` de C16 queda para la Fase 2. |
| T1.13 | Ver §Gate | |

## BLOQUEO-1 — T1.9 (rastreo publico) exige tocar UI

El DTO nuevo (`linea: { nombre, fecha, pendiente? }`, sin ids de hito, R32) deja sin compilar su unico
consumidor de UI. Archivos:
- `app/_landing/RastreoDialog.tsx` (importa `ETIQUETA_POR_HITO` y lee `entrada.hito`, `envio.hitoVigente`).
- Sus tests: `tests/components/RastreoDialog.test.tsx`, `tests/components/RastreoDialog.pendiente.test.tsx`,
  `tests/components/LandingPage.test.tsx`, `tests/fixtures/superficies-publicas.ts`.
- `lib/types/rastreo-publico.ts` `NOMBRE_RESULTADO_PENDIENTE` («Entregada», «Rechazada»…) esta atado por
  `tests/unit/types/rastreo-publico.nombre-resultado.test.ts` a `ORDER_STATUS_LABELS` de
  `app/(app)/ordenes/_components/EstatusBadge.tsx` (UI): cambiarlo solo pone ese test rojo.
Propuesta: la Fase 2 hace DTO + servicio + pagina en el mismo commit (T2.8 con el backend delante), o
autorizar a este agente a editar solo `RastreoDialog.tsx` (lectura de `nombre`). Mientras tanto el
rastreo sigue con hitos; `rastreo-sin-estatus-crudo.guardia` se ajusto a la homonimia nueva
(`entregado`/`reprogramado` se escriben igual que dos hitos) con nota fechada.

## BLOQUEO-2 — tests de UI que derivan texto del codigo

Con los codigos nuevos, varios modulos de UI que HUMANIZAN o PLURALIZAN el codigo producen textos
como «Entregados» o «Devolucion_a_origen_por_rechazos» (y sus tests quedan rojos). No es un fallo del
backend: es exactamente lo que la Fase 2 (T2.6) sustituye por `nombreDeEstado`. Lista exacta en §Gate.

## Toques de UI hechos (solo CODIGOS, ningun texto)

T1.4 incluye el reemplazo mecanico en `app/` «solo tipos/logica, no textos». Estos 18 archivos de
`app/` cambian UNICAMENTE codigos (claves de mapas, comparaciones, `case`) — con UNA excepcion involuntaria,
`madurez-textos.ts:85` (el singular `"entregada"` era texto y quedo `"entregado"`; ver §BLOQUEO-2):
`analitica/_components/entregas/{CohorteCargaTabla.tsx, desenlaces-de-fila.ts, efectividad.ts,
madurez-textos.ts}`, `analitica/_components/operativo/catalogo-paneles.ts`,
`cierre-dia/_components/CierreDiaModule.tsx`, `cierres-admin/_components/{CorregirResultadoDialog.tsx,
cierre-detalle-shared.tsx, cierre-factura.tsx, cierre-labels.ts, cierres-gestiones-fundida-descarga-columnas.ts}`,
`mis-asignaciones/_components/{GestionarOrdenPanel.tsx, chat/chat-format.ts}`,
`monitoreo/_components/contadores.ts` (el `Record` explicito de design §1.2),
`ordenes/_components/{EstatusBadge.tsx, OrdenesListado.tsx}`, `ordenes/exclude-por-rol.ts`,
`recepcion-satelite/_components/SateliteOrdenesListado.tsx`. Mas `app/api/ordenes/api-key/route.ts`
(controlador del canal: el 422).

## RECONCILIACIONES de esta fase

1. **Tests de migraciones historicas que reejecutan SQL de su epoca** (`454/retiro-estados-migration`):
   el SQL aplicado es inmutable y dice `'devuelta'`. Se envuelve con `enLaEraAnterior455`
   (`tests/integration/db/455/_era-anterior.ts`): down de M2/M1 → SQL historico → up de M1/M2, todo en la
   transaccion revertida. Las aserciones de ese test solo cambian el CODIGO leido (R53).
2. **Tests que afirman el TEXTO de migraciones aplicadas** (`gestion-orden-migration`,
   `incidente-indemnizacion-migration`, `order-status-*-migration`, `cierre-sin-gestion-migration`):
   conservan los codigos de su epoca; G1 los lista como excepcion con numero exacto y motivo.
3. **`analytics-daily-job` / `-backfill` usaban el huerfano `pendiente` como estado cualquiera.** M3 lo
   borra donde nadie lo cita (y en produccion lo borrara): se cambio por `en_preparacion` (su equivalente).
4. **C12 invariante «carga duplicada»**: la extraccion de su `correr()` leia la clave `estatus`; ahora lee
   `estado` (R27). La ASERCION no se toco. Nota fechada en el archivo.
5. **Rutas de evidencias** (`${resultado}-…`): las nuevas llevan el codigo vigente; nadie parsea el
   prefijo (confirmado). Los tests que fijaban la ruta se actualizaron.
6. **M2 acotada al esquema** (`current_schema()` + `JOIN pg_namespace`): la guardia
   `catalogo-postgres-acota-esquema` lo pidio para el test y la migracion tenia el mismo agujero (la suite crea
   esquemas temporales con el mismo enum). Solo estaba aplicada en `ordenex_455` (checksum actualizado alli).
7. **`CargaRowResult.estado` sin `enum`** en el contrato: con `enum` seria un QUINTO bloque de catalogo y
   `openapi-contrato-en-reparto` cuenta cuatro; su descripcion remite al catalogo de `OrdenListItem.estado`.

## Mutaciones (una por pieza de logica; salida integra en `progress/mut_455_backend/<id>.log`)

Metodo: `mutar.cjs` aplica un reemplazo literal (comprueba que se aplico), corre los tests, restaura el
archivo byte a byte y muestra `git diff --stat` del archivo (vacio en las 24).

| Id | Archivo:linea | Mutacion | Cae |
|---|---|---|---|
| M1-update | M1 `migration.sql:56` | quitar el UPDATE de `novedad` | `migracion` R14 + cobertura |
| M2-sin-rechazo | M2 `migration.sql:31` | no renombrar `rechazada` | `migracion` R15 |
| M3-nunca-borra | M3 `migration.sql:44` | `IF false THEN DELETE` | `migracion` R18 |
| R20-sin-comprobacion | `scripts/seed-catalogos.ts:57` | saltar la comprobacion | `seed` (2) |
| G1-arbol | `lib/types/gestion-resultado.ts:16` | `"devuelta"` en lib | censo brazo 455 |
| G2-arbol | idem | `"Entregada"` en lib | G2 arbol |
| G3-arbol | idem | mapa `{entregado:"Entregado",…}` | G3 arbol |
| G4-arbol | `lib/types/order-status.ts:132` | «Novedades» | G4 (3) |
| R10-no-reconocido | `order-status.ts:218` | devolver el codigo | `nombre-de-estado` R10 |
| R34-publico-retirado | `order-status.ts:227` | retirado → nombre historico | `nombre-de-estado` R34 |
| R24-listado | `ApiOrdenLecturaService.ts:75` | `estadoNombre = codigo` | C12 [INTERMEDIO] |
| R24-gestion | `ApiOrdenLecturaService.ts:240` | `resultadoNombre = codigo` | C12 [INTERMEDIO] |
| R26-mensaje | `app/api/ordenes/api-key/route.ts:69` | sin mensaje | ruta R26 + C12 |
| R27-estatus | `BulkOrdenService.ts:135` | publicar `estatus` | C12 (2) + bulk (3) |
| R25-webhook-estado | `WebhookEstadoService.ts:279` | `estadoNombre = codigo` | C11 [INTERMEDIO] |
| R25-webhook-evento | `WebhookEventoOrdenService.ts:151` | `resultadoNombre = codigo` | `WebhookEventoOrdenService` (2) |
| G5-sin-estadoNombre | `openapi-spec.ts:1349` | quitar `OrdenListItem.estadoNombre` | G5 (3) |
| R29-enum-a-mano | `openapi-spec.ts:48` | enum sin `recolectando` | G5 R29 |
| R30-tabla | `CHANGELOG.md:42` | nombre equivocado en la tabla | `changelog-455` |
| R35-plantilla | `plantilla-datos.ts:497` | `{{estatus}}` = codigo | C15 + `plantilla-datos` |
| R36-notificacion | `emitir.ts:63` | texto viejo | `notificacion-orden-rechazada` |
| R22-url-anterior | `filtros-url.ts:144` | sin `codigoVigente` | C02 R22 |
| R23-snapshot | `HistorialAccionService.ts:99` | sin traducir | `snapshot-lectura` |
| R3-label-analitica | `AnaliticaOperativaRollupRepository.ts:134` | `label = value` | C05 [INTERMEDIO] |

## Mapa R → test (backend)

| R | Test |
|---|---|
| R1, R43 | `tests/unit/types/nombre-estado-catalogo.test.ts` (G4) |
| R2, R10, R11 | `tests/unit/types/nombre-de-estado.test.ts` (funcion); pantallas: Fase 2 |
| R3 | G3 `tests/unit/guards/fuente-unica-nombre-estado.guardia.test.ts`; C05 [INTERMEDIO] |
| R4, R33 | `nombre-de-estado.test.ts` › «el resultado se llama como su estado destino» |
| R9, R41 | G2 `tests/unit/guards/nombres-estado-retirados.guardia.test.ts` |
| R12, R42 | G3 |
| R13, R40 | G1 `tests/unit/guards/censo-order-status-rename.test.ts` (brazo 455) |
| R14-R19 | `tests/integration/db/455/migracion.test.ts` |
| R20 | `tests/integration/db/455/seed.test.ts` |
| R21, R45 | C01, C02 (invariantes intactos) |
| R22 | C02 [INTERMEDIO] |
| R23 | `tests/integration/db/455/snapshot-lectura.test.ts` |
| R24 | C12 [INTERMEDIO] + tests de servicio (cancelacion, borrado, habilitacion, lectura) con literales |
| R25 | C11 [INTERMEDIO], `WebhookEventoOrdenService.test.ts`, `webhook-estado-service*.test.ts` |
| R26 | `tests/integration/api/ordenes-api-key-listado-codigo-anterior.route.test.ts` + C12 |
| R27 | C12 [INTERMEDIO], `bulk-orden-service.carga-api.test.ts` |
| R28, R50 | C11 invariantes |
| R29 | `tests/unit/api/openapi-nombres-455.guardia.test.ts` (G5) + `openapi-*` |
| R30 | `tests/unit/api/changelog-455.test.ts` + G1 sobre los dos docs |
| R31, R32, R34 | **BLOQUEO-1** (la funcion `nombrePublicoDeEstado` si esta probada) |
| R35 | C15 [INTERMEDIO], `tests/unit/types/plantilla-datos.test.ts` |
| R36 | `tests/unit/repositories/notificacion-orden-rechazada.test.ts` |
| R37, R38 | G2 (docs/ayuda y `contextoPara` por rol; lo pendiente es de la Fase 2, T2.10) |
| R44 | casos MUTACION dentro de G1-G5 + tabla de mutaciones |
| R46-R49, R52, R53 | C03-C10, C14 + `tests/integration/db/454/**` en verde con los codigos vigentes |

## Redes

`pnpm exec vitest run tests/integration/db/455 tests/integration/db/454` en verde tras cada grupo de
commits. Ultima corrida (tras el gate): **`Test Files 68 passed (68)` · `Tests 339 passed (339)`**, 0 skipped
(la red 455 crecio de 17 a 20 archivos: `migracion`, `seed`, `snapshot-lectura`; `_era-anterior.ts` es helper).

## Gate

`./init.sh` COMPLETO sobre `66c0335c`, salida integra en `progress/gate_455_backend.log` (sin `tail`,
`INIT_EXIT` escrito dentro):
- typecheck: **✓** (`tsc --noEmit`).
- lint: **0 errores**, 216 warnings (los mismos 216 preexistentes que midio la Fase 0; 0 nuevos).
- tests: `Test Files 9 failed | 2149 passed (2158)` · `Tests 30 failed | 30542 passed | 26 skipped`.
  - Los 26 skipped son `describe.skip` preexistentes de `tests/components/AnaliticaPage.test.tsx` (17) y
    `AnaliticaShell.test.tsx` (9) (leido de `.vitest/rojos.json`): **`integration/db` skipped = 0**.
  - Los 30 rojos son EXACTAMENTE el conjunto de §BLOQUEO-2 (abajo): no hay ningun rojo ajeno, asi que no
    procedian repeticiones aisladas.
- **`INIT_EXIT=1`** por esos 30.

### BLOQUEO-2 — detalle (30 tests, 9 archivos; todos de `app/(app)/analitica/_components/entregas/`)

Modulos de UI que derivan el texto del CODIGO (y que la Fase 2, T2.6, sustituye por `nombreDeEstado` /
`nombreDeResultado`):
- `etiqueta-desenlace.ts` → `etiquetaDeDesenlace` PLURALIZA el codigo (`novedad` → «Novedads»,
  `devolucion_a_origen_por_rechazo` → «Devolucion_a_origen_por_rechazos»).
- `ConteoPorStatusDona.tsx` → `etiquetaDeStatus` HUMANIZA el codigo (G3 lo lista como pendiente).
- `madurez-textos.ts:85` → el singular era el literal `"entregada"` (texto, no codigo); el reemplazo
  mecanico lo dejo en `"entregado"` («1 entregado de 1 orden» frente a «3 entregadas»): la Fase 2 lo
  reescribe con el nombre exacto (R5). Es el UNICO texto visible que el reemplazo toco.
Tests rojos: `tests/components/ConteoEntregasAnillo.test.tsx` (9), `tests/components/ConteoPorStatusDona.test.tsx` (5),
`tests/unit/analytics/desenlaces-de-fila.test.ts` (4), `tests/components/ProductosTablaDinero.test.tsx` (4),
`tests/unit/analytics/otros-resultados.test.ts` (3), `tests/components/ProductosTabla.test.tsx` (2),
`tests/unit/descarga/analitica-productos-descarga-columnas.test.ts` (1),
`tests/unit/analytics/conteo-entregas-pliegue.test.ts` (1), `tests/components/KpisEfectividad.test.tsx` (1).
⚠️ **Esta rama NO se puede desplegar sin la Fase 2**: la analitica de entregas mostraria esos textos.

### Tambien para la Fase 2 (sin rojo hoy)

- `lib/analytics/metrics.ts` etiqueta «Sin gestionar» de `novedad_interna` y la leyenda del panel
  (`catalogo-paneles.ts`) pasan JUNTAS a «Novedad interna» (guardia `etiquetas-visibles` exige que digan
  lo mismo). G2 la lista como pendiente.
- `PENDIENTES_FASE_2` de G2 (30 archivos) y G3 (9 archivos): la Fase 2 termina con las dos listas vacias.
- `lib/services/mensajes-*.ts` y los `motivo` de los servicios llevan el CODIGO; la UI los traduce
  (`*-error-messages.ts`, T2.7).
- C04, C13, C14, C16 `[INTERMEDIO]` siguen con la forma de la Fase 0 (rotulos/rastreo/pestañas/columna:
  todo UI o T1.9).
