# 454 — Fase 1 (backend): bitacora

> Rama `feature/454-backend`, nacida de `3603d199` (spec + los 28 tests de caracterizacion de la Fase 0).
> Agente: backend_dev. **Estado: Fase 1 hecha salvo lo que exige tocar UI** (§BLOQUEO-2 y §BLOQUEO-3).
> El BLOQUEO de T1.4 (primera tanda) lo levanto el coordinador el 2026-09-23 autorizando los cambios
> 1-5; cada uno queda abajo con su antes→despues y la corrida roja que lo justifica.
>
> Busqueda de codigo: en la PRIMERA tanda el MCP `codebase-memory` no se uso (todo con `grep`; incumplia
> la regla 7 y se dijo). En esta tanda SI: `search_graph` (proyecto `R-job-singularis-projects-ordenex`)
> para `whereIntentosVigentes`/`contarIntentos`, `deshacerGestion`/`anularGestionPendiente`, el rastreo
> publico y `resolverCierreBodega`/`aprobarCierreBodega`, confirmando cada simbolo en el archivo real
> antes de usarlo. `grep` quedo para texto plano, `specs/`, `db/schema.prisma` y migraciones.

## Entorno

- `git switch -c feature/454-backend 3603d199…` → `git log --oneline -1` = `3603d199 test(454): caracterizacion del comportamiento actual`.
- `node_modules`: junction al del repo principal (`fs.symlinkSync(..., "junction")` desde node). `.env`
  copiado del repo principal sin imprimirlo. `prisma generate` en verde.
- `prisma migrate status` → `PostgreSQL database "ordenex" … at "localhost:5432"`; hoy **209 migraciones,
  `Database schema is up to date!`**.
- Linea base de la red (primera tanda): `Test Files 28 passed (28)` · `Tests 98 passed | 1 expected fail (99)`.
- Hallazgo de entorno (medido): en la base local la zona de la SESION no es UTC; `CURRENT_TIMESTAMP`
  convertido a `timestamp` sin zona queda horas por detras del `created_at` que Prisma escribe (UTC, en
  el cliente). M3 lo resuelve con `(clock_timestamp() AT TIME ZONE 'UTC')::timestamp(3)` (lo cazo su
  propio test: con `CURRENT_TIMESTAMP` las ayudas migradas salian CERRADAS).

## ⚠️ Base local compartida MIGRADA

M1 (`20260923120000_job_tipo_webhook_evento`), M2 (`20260923120100_orden_evento`) y **M3
(`20260923120200_retiro_estados_454`)** estan aplicadas en la base local compartida. M3 movio a
`en_reparto` la UNICA orden local que estaba en `devolucion_por_confirmar` (medido antes: 1 orden en
`devolucion_por_confirmar`, 0 en `ayuda_tienda`, 0 sin fila de solicitud, 0 sin gestion `devuelta`).
Otros worktrees sobre `dev` veran esa orden `en_reparto`. Si la ficha se abandona: `pnpm run db:rollback`
tres veces (M3, M2, M1 en ese orden; probados).

## Tareas

| Tarea | Estado | Test que lo cierra |
|---|---|---|
| T1.1 | Parte aditiva + transiciones (#70 `en_reparto→devuelta` por `anclaje_devolucion`), `gestion-destino` (`devuelta→devuelta`), `rastreo-publico`, `webhook-eventos`. **La RETIRADA de los dos valores de `ORDER_STATUS_VALUES`/SEED queda en §BLOQUEO-2** (rompe tipos de dos componentes de UI). | guardias 140, `order-status-transiciones` |
| T1.2 | Hecha | `454/orden-evento-migration.test.ts` |
| T1.3 | Hecha. `tasks.md` nombra DOS guardias; UN archivo (`gestion-pendiente-unica-fuente.guardia.test.ts`) cubre los dos literales (`gestion_registrada` y `ayuda_solicitada`) con la misma heuristica: no se duplica en `ayuda-abierta-unica-fuente.guardia.test.ts`. | `gestion-pendiente-sql-real`, `ayuda-abierta-sql-real` |
| T1.4 | Hecha | `registro-gestion-sin-transicion-sql-real`, `registro-gestion-concurrencia-sql-real`, C07 (`it` ×10) |
| T1.5 | Hecha (primera tanda) | `webhook-evento-sql-real`, `unit/services/WebhookEventoOrdenService` |
| T1.6 | Hecha: N1 al registrar (`emitirOrdenRechazadaEnTransaccion`); la aprobacion no crea `orden_rechazada` | C20, `unit/.../notificacion-orden-rechazada` |
| T1.7 | Hecha | `aplicacion-al-aprobar-sql-real` (7), `unit/repositories/cierres-admin-aplicacion-gestiones`, `cierres-admin-caja-cod` sin tocar |
| T1.8 | Hecha | `devolucion-rechazadas-seleccion-sql-real` (5), C10 |
| T1.9 | Hecha | `intentos-segunda-via-sql-real` (6), guardia `sinteticas-sin-evento-registro`, `anclaje-vs-intentos.guardia` SIN tocar y verde, C03/C04/C05/C19 |
| T1.10 | Hecha | `corte-excluye-pendientes-sql-real` (5), C01/C02 |
| T1.11 | Hecha | `deshacer-ramas-sql-real` (6), C21 |
| T1.12/T1.13 | Hechas | C12, C13, C08 sin editar |
| T1.14 | Hecha | `correccion-ramas-sql-real` (6), C06 |
| T1.15 | Hecha | `ayuda-evento-sql-real` (9), C22 |
| T1.16 | Hecha | `novedades-predicado-sql-real` (5), `hilo-ventana-alcanzable.guardia`. R65: ver nota abajo |
| T1.17/T1.18 | Hechas | C14, C15, `traspaso-mensajero`, `correccion-dia-reparto(-efectos)`, `guia-asignacion`, `reparto-manana` |
| T1.19 | Hecha | `rastreo-pendiente-sql-real` (9), C27 |
| T1.20 | Hecha | `openapi-454-eventos`, `openapi-*`, `ordenes-api-key-orden-consulta.route`, `gestiones-detalle-api-405` |
| T1.21 | **Medicion hecha, DTO en §BLOQUEO-3** | — |
| T1.22 | Hecha | `cierre-bodega-sf001-sql-real` (4), C24 |
| T1.23 | **§BLOQUEO-2** (literales de UI) | — |
| T1.24 | Hecha | `retiro-estados-migration.test.ts` (13: a-g) + up→down→up REAL en la base local |
| T1.25 | Hecha: 28/28 verdes (tabla abajo) | — |
| T1.26 | Gate completo: ver §Salida | — |

## Cambios autorizados a la red de la Fase 0 (coordinador, 2026-09-23)

Cada uno: el antes→despues literal y la corrida del test VIEJO (`git show 3603d199:<archivo>`) contra el
codigo nuevo, copiada a un `*.viejo.test.ts` temporal y borrada al terminar.

1. **C10 `devolucion-rechazadas-139`**, precondicion.
   Antes: `expect(r.antes).toEqual({ calle: "rechazada", escritorio: "rechazada", escalada: "rechazada" })`.
   Despues: `expect({ escritorio, escalada }).toEqual({ escritorio: "rechazada", escalada: "rechazada" })` +
   `[INTERMEDIO]` nuevo `expect(r.antes.calle).toBe("en_reparto")` (R1).
   Rojo viejo: `AssertionError: expected { calle: 'en_reparto', …(2) } to deeply equal { calle: 'rechazada', …(2) }`.
2. **C17 `cierre-rechazado`**.
   Antes: `expect(r.trasRechazo.rec).toBe("rechazada")` y `expect(r.trasAprobar.historial).toBe(r.historialAntes + 1)`.
   Despues: esas dos lineas salen de la invariante al `[INTERMEDIO]`: `trasRechazo.ent/rec` = `en_reparto`
   (R13), `historialAntes` = 0 y `trasAprobar.historial` = `historialAntes + 3` (R1+R8: dos aplicaciones +
   la 139). Dinero = 0, historial sin cambios tras rechazar y «re-aprobar no emite otra vez» intactos.
   Rojo viejo: `expected 'en_reparto' to be 'rechazada'` · `expected 3 to be 1` · (INTERMEDIO viejo)
   `expected 'en_reparto' to be 'entregada'`.
3. **C16 `dos-gestiones-vivas`**: g1 pasa de `gestionarOk` a LEGADA sembrada (gestion `devuelta` + fila de
   historial `gestion`, SIN evento, orden en el pre-estado 239). Las tres aserciones, identicas. Nota en
   el test: la prohibicion de dos pendientes NUEVAS la cubren C07 y R3.
   Rojo viejo: `Error: gestionar(devuelta) no fue ok: {"status":"conflict","motivo":"esta orden ya tiene una gestion pendiente de confirmar"}` (4 skipped por `beforeAll`).
4. **C23 `confirmacion-fisica-238`**: SOLO el argumento: `anclajeDevolucion: { preEstadoId, devueltaId }` →
   `aplicacionGestiones: { enRepartoId, destinoPorResultado: {…} }`. Aserciones identicas.
   Corrida vieja: en ejecucion PASA (vitest no tipa y el repositorio tolera la clave ausente); cae en
   `tsc`: `TS2353: … 'anclajeDevolucion' does not exist in type 'ResolverCierreBase & { … aplicacionGestiones: AplicacionGestionesConfig; … }'`.
5. **`_escenario.ts` `limpiarComprometido`**: borra `orden_evento` (y sus jobs `webhook_evento` por
   `ordenEventoId`) antes de las gestiones. Sin eso el `afterAll` de C02/C07 cae por FK RESTRICT.

Cambios de la MISMA clase aplicados sin preguntar (cumplen (a) solo el cambio de MOMENTO y (b) ninguna
asercion de dinero/intentos/cobro/tope/SLA tocada). Todos dentro de un `describe("[INTERMEDIO] …")`, con
comentario fechado «AQUI DECIA …»:

| Test | Antes → despues | Rojo del viejo contra el codigo nuevo |
|---|---|---|
| C22 `ayuda-ciclo` | `estadoConAyuda` `ayuda_tienda` → `en_reparto` (R21) | `expected 'en_reparto' to be 'ayuda_tienda'` |
| C06 `correccion-69` | `estadoTrasCorregir` `rechazada` → `en_reparto` (R18) | `expected 'en_reparto' to be 'rechazada'` |
| C01 `corte-no-barre-gestionadas` | `{ o1: entregada, o2: rechazada }` → `{ o1: en_reparto, o2: en_reparto }` (R1) | `expected { o1: 'en_reparto', … } to deeply equal { o1: 'entregada', … }` |
| C05 `sla-devolucion-reloj` | `devolucion_por_confirmar` → `en_reparto` (R1) | `expected 'en_reparto' to be 'devolucion_por_confirmar'` |
| C25 `tablero-dia` | `{ enReparto: 1, otros: 1 }` → `{ enReparto: 2, otros: 0 }` (la ayuda ya no es estado; bucket, no dinero) | `expected { asignadas: 8, … } to match object { enReparto: 1, otros: 1 }` |
| C14 `traspaso` | `ayuda_tienda` → `en_reparto` (R28) | `expected 'en_reparto' to be 'ayuda_tienda'` |
| C26 `webhook-estado` | `trasGestionar` longitud 1 → 0 (R33: nace al aprobar) | `expected [] to have a length of 1 but got +0` |
| C07 `no-doble-gestion` | `it.fails` → `it` (R4 cumplido) | `Error: Expect test to fail` |

## Mutaciones de esta tanda (todas ROJAS; arnes `mut.py`: corre la base sin mutar y exige verde, aplica, corre, restaura byte a byte — `restaurado True` en todas)

| Tarea · test | Mutacion | Resultado |
|---|---|---|
| T1.7 unit `cierres-admin-aplicacion-gestiones` | M-A sin guarda `estatus_id = en_reparto` · M-B sin recencia · M-C actor de `devuelta` = mensajero · M-D sin filtro «con evento» | ROJO ×4 |
| T1.7 `aplicacion-al-aprobar-sql-real` | M-A · M-B · M-C · M-E destino equivocado · M-F sin guarda de `cierreId` · M-D2 recencia sin filtro de registro | ROJO ×6 |
| idem | M-D (solo el filtro `delCierre` del registro) | **sobrevive: mutante equivalente** — la consulta de recencia ya filtra por registro; el filtro es de rendimiento |
| T1.8 `devolucion-rechazadas-seleccion-sql-real` | M-G sin exclusion por otro cierre abierto · M-H sin «la mas reciente» · M-I un cierre aprobado tambien excluye | ROJO ×3 |
| T1.9 `intentos-segunda-via-sql-real` | M-L sin la segunda via · M-M segunda via por familia `anclaje_devolucion` · M-N sin exigir cierre aprobado | ROJO ×3 |
| T1.9 guardia `sinteticas-sin-evento-registro` | M-K `escalarDevueltaSla` escribe `gestion_registrada` | ROJO (3 tests) |
| T1.10 `corte-excluye-pendientes-sql-real` | M-J el corte sin `whereOrdenSinGestionPendiente` | ROJO |
| T1.11 `deshacer-ramas-sql-real` | M-R toda gestion por la rama legada · M-S la nueva sin webhook · M-T sin la guarda de estado DENTRO de la tx | ROJO ×3 (M-T sobrevivia con solo el servicio; se anadio la llamada directa al repositorio y quedo ROJO) |
| T1.14 `correccion-ramas-sql-real` | M-O todo por la legada · M-P todo por la nueva · M-Q la nueva sin webhook | ROJO ×3 |
| T1.15 `ayuda-evento-sql-real` | M-U derivacion sin «transicion posterior» · M-V pedir ayuda sin liberar el puntero · M-W la API cierra con otro tipo | ROJO ×3 |
| T1.4 `registro-gestion-sin-transicion-sql-real` | M-Y1 sin liberar puntero · M-Y2 rol no congelado · M-Y3 sin reoptimizacion · M-Y4 el registro vuelve a transicionar | ROJO ×4 |
| T1.4 `registro-gestion-concurrencia-sql-real` | M-Z1 la tienda sin candado de la fila · M-Z2 la re-lectura de la tienda sin ayuda abierta | ROJO ×2 |
| T1.19 `rastreo-pendiente-sql-real` | M-R1 sin excluir anuladas · M-R2 aunque el cierre este aprobado · M-R3 sin exigir `en_reparto` | ROJO ×3 (M-R2/M-R3 sobrevivian con la primera version; se anadieron los casos «ciclo nuevo» y «movida por otra via») |
| T1.16 `novedades-predicado-sql-real` | M-N2 grupo ayuda por estado · M-N3 conteo sin los ids | ROJO ×2 |
| idem | M-N1 ids de ayuda sin acotar a la tienda | **sobrevive: equivalente** — `novedadWhere` vuelve a acotar por `tiendaId` |
| T1.24 `retiro-estados-migration` (up) | M-M1 sin precondicion de solicitud · M-M2 ayuda un ms ANTES del rastro · M-M5 backfill sin las borradas | ROJO ×3 |
| T1.24 (down) | M-M3 devuelve lo que cambio despues · M-M4 no borra el registro de M3 · M-M6 no aplica las pendientes nuevas | ROJO ×3 |

(La tabla de la primera tanda —T1.3, 14 mutaciones— sigue abajo, intacta.)

## Adaptacion de la suite unitaria y de integracion (Fase B)

- `cierres-admin-anclaje-devolucion.test.ts` → `git mv` a `cierres-admin-aplicacion-gestiones.test.ts`,
  reescrito (el anclaje 239 muere con el pre-estado; cada garantia tiene heredera, tabla en la cabecera).
  Corrida vieja: la suite no cargaba (`Cannot read properties of undefined (reading 'preEstadoId')`).
- `cierre-dia-repository.test.ts`: el corte tiene UN origen y toma candado por `$queryRaw` antes de la
  re-lectura (casos nuevos: candado antes de re-leer; re-lectura vacia no escribe).
- `cierres-admin-tope-sin-gestion.test.ts` «sin `rechazada`»: `validation_error` y `resolverCierre` no
  llamado (fallo cerrado de la aplicacion, design §7.2).
- Dobles de catalogo y de `gestionOrden.findMany` en suites de dinero: honran `where.eventos`. **Ninguna
  asercion de dinero tocada.**
- `cierres-admin-confirmacion-fisica.test.ts`: orden `["anclar","confirmar"]` (design §16); 238/R23 intacta.
- `gestion-desde-ayuda-*`, `solicitud-ayuda`, `rescate-ayuda`, `habilitar-novedad`, `orden-nota`:
  ayuda como hecho (`registrarAyuda*`, `ayudaAbierta`), `estaEnVentanaDeEscritura` con 3 parametros.
- `ApiHabilitacionService` rama A: un «arreglo» (`habilitada_sin_cambio_de_estado`) puso ROJO el invariante
  de C22 y se REVIRTIO; el contrato es `habilitada` + `estado: en_reparto` + `ayudaCerrada: true`.
- Guardia `aprobacion-escrituras-cubiertas`: la suite jubilada sale de `SUITES_DE_LA_TRANSACCION`;
  `tx.orden.updateMany` y `appendCambioEstado` citan cada una sus suites reales; `tx.ordenEvento.create`
  (correccion, rama nueva) entra en `ESCRITURAS_FUERA` con `correccion-ramas-sql-real`; y una lista NUEVA
  `ESCRITURAS_SQL_DE_LA_APROBACION` declara el `UPDATE "orden"` crudo de la aplicacion (el censo de
  `tx.<modelo>.<metodo>` no lo veia) con autocomprobacion: el numero de `UPDATE "orden"` del archivo es el
  declarado.
- `_escenario.ts`: sin cambios en esta tanda.

## Nota R65 (avisos diarios) — medido, sin cambio

El design (P4) cita `AvisoAgregadoRepository.ts:81,195` como «grupo ayuda». Medido en `dev` y en la rama:
ese repositorio solo cuenta el grupo `devolucion` (`countNovedadesByTienda(tiendaId, "devolucion")`) y las
represadas; `git show dev:lib/repositories/AvisoAgregadoRepository.ts | grep ayuda` = vacio. No hay hoy un
aviso diario que cuente `ayuda_tienda`, asi que R65 se cumple sin cambio. El conteo de la pestaña de ayuda
(`countNovedadesByTienda(…, "ayuda")`) SI pasa por la derivacion y lo afirma `novedades-predicado-sql-real`.

## Hallazgo ajeno a la 454 (no se toca)

`CierresBodegaAdminService.aprobarCierreBodega` → `resolverCierreBodega` choca con el CHECK
`cierre_bodega_conciliacion_coherente` de la 431 (un `aprobado` sin conciliar). La via viva es
`marcarConciliado`; T1.22 se prueba por ella. Es de la 431, no de esta ficha.

## BLOQUEO-2 — retirar los dos valores exige tocar UI

T1.1 (quitar `ayuda_tienda`/`devolucion_por_confirmar` de `ORDER_STATUS_VALUES`/SEED) y T1.23 (barrido de
literales + guardia `sin-estados-retirados`) no compilan sin editar componentes: `EstatusBadge.tsx`
(`Record<OrderStatusValue, …>` con las dos claves, `:41,46,92,98`), `cierre-factura.tsx:1426`
(`SIN_GESTION_ORIGEN_LABEL`), `OrdenesListado.tsx:756` (`case "ayuda_tienda"`), y `exclude-por-rol.ts`
(bajo `app/`). Mi alcance excluye UI. Propuesta: que la Fase 2 (T2.2/T2.7) lo haga en el mismo commit que
la retirada del tipo, o autorizarme a editar SOLO esas lineas. Mientras, los valores siguen en el tipo y
en el catalogo (M3 los retira de la base solo si nada los referencia: en local y en produccion es no-op).

## BLOQUEO-3 — T1.21: la clase `evento_orden` de la linea de tiempo exige tocar UI

Añadir `evento_orden` a la union `OrdenHistorialEntradaDTO` deja sin compilar el `switch` exhaustivo
(`const _exhaustivo: never`) de `HistorialOrdenTimeline.tsx` — la trampa que la 262 dejo puesta a
proposito. T2.3 de la Fase 2 es ese `switch`. Propuesta: hacer DTO + servicio + componente en un mismo
paso (T2.3 con backend delante) o autorizarme el `case` minimo.
Parte de medicion hecha (Pregunta abierta 4): `cierre_sin_gestion.estatus_origen_id` lo leen
`SIN_GESTION_SELECT` (`lib/utils/cierre-sin-gestion.ts`) → `CierreDiaRepository` y `CierresAdminRepository`
(detalle del cierre) → `cierre-factura.tsx:2111` (`SIN_GESTION_ORIGEN_LABEL`), que SI distingue la ayuda
(«Ayuda de la tienda»). Con la 454 toda barrida nueva sale de `en_reparto`: esa etiqueta deja de
aparecer para las barridas nuevas. Si se quiere conservar, hay que derivar la ayuda del evento en ese DTO
(campo nuevo) y pintarlo: decision de producto + Fase 2.

## Mapa R → test

| R | Test |
|---|---|
| R1, R2, R5 | `454/registro-gestion-sin-transicion-sql-real` |
| R3 | C07 (secuencial), `gestion-pendiente-sql-real`, C22 (no gestionable con ayuda) |
| R4 | C07 (concurrente ×10), `registro-gestion-concurrencia-sql-real` (tienda doble, mensajero+tienda ×5) |
| R6 | C13 |
| R7, R8, R9, R10, R11, R12, R14 | `aplicacion-al-aprobar-sql-real`, `unit/repositories/cierres-admin-aplicacion-gestiones` |
| R13 | `aplicacion-al-aprobar-sql-real`, C17 |
| R15, R16, R17 | `deshacer-ramas-sql-real`, C21 |
| R18, R19, R20 | `correccion-ramas-sql-real`, C06 |
| R21, R23, R24, R25, R26, R27 | `ayuda-evento-sql-real`, C22 |
| R22 | `novedades-predicado-sql-real`, `ayuda-evento-sql-real`, `ayuda-abierta-sql-real`, C22 |
| R28 | `ayuda-evento-sql-real`, C14 |
| R29 | **sin test backend**: el chip lo pinta la Fase 2 (T2.2) sobre datos que ya expone la API (R32) |
| R30 | **§BLOQUEO-3** |
| R31 | `rastreo-pendiente-sql-real`, C27 |
| R32 | `ordenes-api-key-orden-consulta.route`, `gestiones-detalle-api-405`, `unit/api/openapi-405-gestiones` |
| R33 | `webhook-evento-sql-real`, `unit/services/WebhookEventoOrdenService`, C26, y el webhook de deshacer/correccion en sus tests de rama |
| R34, R36 | `unit/api/openapi-454-eventos`, `webhook-contrato`, `webhook-eventos` |
| R35 | C20, `unit/.../notificacion-orden-rechazada` |
| R37 | **parcial** (grafo de transiciones sin #59-#66: guardia `order-status-transiciones`); el tipo y los literales de UI, §BLOQUEO-2 |
| R38, R39, R41, R42 | `retiro-estados-migration.test.ts` |
| R40 | C27 (lectura historica de las filas legadas) |
| R43 | `corte-excluye-pendientes-sql-real`, C01 |
| R44 | C02 |
| R45 | `intentos-segunda-via-sql-real`, C03 |
| R46 | C04 (tope 276) |
| R47 | C05 |
| R48 | C19 |
| R49 | C11 |
| R50 | C09 |
| R51 | `devolucion-rechazadas-seleccion-sql-real`, C10 |
| R52 | C08 |
| R53 | C12 |
| R54 | C14 |
| R55 | C15 |
| R56 | `unit/services/guia-asignacion`, `reparto-manana` |
| R57 | `aplicacion-al-aprobar-sql-real`, C16 |
| R58 | C17 |
| R59 | C18, `corte-excluye-pendientes-sql-real` |
| R60 | C23 |
| R61, R64 | C24, `cierre-bodega-sf001-sql-real` |
| R62 | C25 |
| R63 | C28 |
| R65 | nota R65 (sin cambio medido), `novedades-predicado-sql-real` |

## T1.25 — la Fase 0 contra el codigo nuevo

`pnpm exec vitest run tests/integration/db/454` → **`Test Files 45 passed (45)` · `Tests 227 passed (227)`**,
0 skipped, 0 expected-fail (C07 ya es `it`). Las 28 de caracterizacion en verde; las invariantes editadas
son SOLO las cinco autorizadas; el resto de cambios estan dentro de `[INTERMEDIO]` (tabla de arriba).

## Primera tanda (historico)

### T1.2 — M1/M2: up → down → up (local)

1. `prisma migrate deploy` → aplica M1 y M2.
2. `tsx scripts/db-rollback.ts` (down de M2 + borra su fila de `_prisma_migrations`); down de M1 con
   `prisma db execute --file …/down.sql` + borrado de su fila.
3. Comprobacion SQL: sin `webhook_evento`, sin tabla, `job_tipo` con 10 valores, indice parcial de la 401.
4. `prisma migrate deploy` otra vez → verde; `migrate status` → `Database schema is up to date!`.

Correccion antes de cerrar M2: el CHECK `orden_evento_familia_aplicacion_check` admitia un
`gestion_registrada` SIN familia (`NULL IN (…)` pasa). Rollback de M2 en local, `IS NOT NULL` anadido y
reaplicado: nunca se edito una migracion aplicada en su sitio.

### T1.24 — M3: up → down → up (local, REAL)

`prisma migrate deploy` (aplica M3) → `pnpm run db:rollback` (`Rollback completado: 20260923120200_retiro_estados_454`)
→ `migrate status` la da pendiente → `prisma migrate deploy` → `All migrations have been successfully applied.`
→ `migrate status` → `Database schema is up to date!`. Ademas, el test la corre up → up → down → up en
transaccion revertida con actividad del modelo nuevo entre medias. Diferencias con el design §1.6,
declaradas en el SQL: (1) el retiro del catalogo mira tambien `analytics_daily` (FK RESTRICT a
`order_status` que el design no listaba); (2) el down repone el catalogo ANTES de aplicar las pendientes
(necesita sus ids) y borra los hechos que escribio la propia M3 (sin eso up→down→up choca con el unico
parcial); (3) la precondicion de `devolucion_por_confirmar` exige tambien que la `devuelta` no este en un
cierre ya APROBADO (no podria quedar pendiente).

### T1.3 — mutaciones (primera tanda)

| # | Archivo mutado | Mutacion | Rojo |
|---|---|---|---|
| 1 | gestion-pendiente.ts (Prisma) | `anuladaAt: null` comentada | 1 failed |
| 2 | gestion-pendiente.ts (Prisma) | `eventos: { some: gestion_registrada }` comentada | 2 failed |
| 3 | gestion-pendiente.ts (Prisma) | `not: "aprobado"` → `not: "rechazado"` | 2 failed |
| 4 | gestion-pendiente.ts (SQL) | `"gp"."anulada_at" IS NULL` → `TRUE` | 1 failed |
| 5 | gestion-pendiente.ts (SQL) | evento `= 'gestion_registrada'` → `… AND FALSE` | 4 failed |
| 6 | gestion-pendiente.ts (SQL) | `"gpc"."estado" <> 'aprobado'` → `TRUE` | 1 failed |
| 7 | gestion-pendiente.ts (orden) | `estatus: { value: en_reparto }` comentada | 1 failed |
| 8 | ayuda-abierta.ts | `value = en_reparto` → `TRUE` | 2 failed |
| 9 | ayuda-abierta.ts | `NOT gestion pendiente` → `TRUE` | 2 failed |
| 10 | ayuda-abierta.ts | `ult.tipo = 'ayuda_solicitada'` → `TRUE` | 3 failed |
| 11 | ayuda-abierta.ts | `>` → `>=` | 2 failed |
| 12 | ayuda-abierta.ts | `ORDER BY … DESC` → `ASC` | 3 failed |
| 13 | ayuda-abierta.ts | historial posterior → `FALSE` | 2 failed |
| 14 | guardia unica-fuente | un `where` con `ayuda_solicitada` en `CorteDiarioRepository.ts` | 1 failed |

## Archivos

Produccion (desde `3603d199`): `app/api/cron/procesar-jobs/route.ts` (unico archivo bajo `app/`, route
handler), 3 migraciones (`20260923120000_job_tipo_webhook_evento`, `20260923120100_orden_evento`,
`20260923120200_retiro_estados_454`, cada una con `down.sql`), `db/schema.prisma`, y en `lib/`:
actions `ordenes-guia`; api `openapi-spec`; constants `reparto-mensajero-estados`; interfaces
`ICierreDiaRepository`, `ICierresAdminRepository`, `IGestionOrdenRepository`, `IOrdenNotaRepository`,
`IOrdenRepository`, `IRastreoPublicoRepository`, `IWebhookEventoReader`, `IApiHabilitacionService`;
notificaciones `emitir`; repositories `CierreDia`, `CierresAdmin`, `CorteDiario`, `GestionOrden`,
`OrdenHistorial`, `OrdenNota`, `Orden`, `RastreoPublico`, `RepartoManana`, `WebhookEventoReader`,
`ayuda-abierta`, `gestion-pendiente`; services `ApiHabilitacion`, `ApiOrdenLectura`, `CierreDia`,
`CierresAdmin`, `CorreccionDiaReparto`, `CorteDiario`, `GestionDesdeAyuda`, `GuiaAsignacion`,
`HabilitarNovedad`, `MisAsignaciones`, `OrdenNota`, `RastreoPublico`, `SolicitudAyuda`,
`TraspasoMensajero`, `WebhookEventoOrden`, `jobs/webhook-evento-{encolado,handler}`, `rescate-ayuda`;
types `api-orden`, `gestion-destino`, `orden-evento`, `order-status-transiciones`, `rastreo-publico`,
`ventana-hilo-notas`, `webhook-eventos`. Docs: `docs/api/api-key-openapi.yaml`, `CHANGELOG.md`.

Tests nuevos de esta tanda (`tests/integration/db/454/`): `aplicacion-al-aprobar-sql-real`,
`devolucion-rechazadas-seleccion-sql-real`, `corte-excluye-pendientes-sql-real`,
`intentos-segunda-via-sql-real`, `correccion-ramas-sql-real`, `deshacer-ramas-sql-real`,
`ayuda-evento-sql-real`, `registro-gestion-sin-transicion-sql-real`, `registro-gestion-concurrencia-sql-real`,
`rastreo-pendiente-sql-real`, `novedades-predicado-sql-real`, `cierre-bodega-sf001-sql-real`,
`retiro-estados-migration`; guardia `tests/unit/guards/sinteticas-sin-evento-registro.guardia.test.ts`;
`tests/unit/api/openapi-454-eventos.test.ts`.

## Salida de las verificaciones

Antes del gate (esta tanda): `pnpm run typecheck` → `tsc --noEmit` sin errores. `pnpm run lint` →
`✖ 216 problems (0 errors, 216 warnings)` (ningun warning en los archivos nuevos: `eslint` sobre ellos
vacio). `pnpm exec vitest run tests/unit` → `Test Files 1330 passed (1330)` · `Tests 20539 passed (20539)`.
`pnpm exec vitest run tests/integration/db/454` → `Test Files 45 passed (45)` · `Tests 227 passed (227)`.

Gate completo (`bash ./init.sh > progress/gate_454_backend.log 2>&1; echo "INIT_EXIT=$?" >> …`), cuatro corridas:

1. `gate_454_backend_1.log` — `INIT_EXIT=1`, 2 rojos MIOS: `orden-traspaso-migration` (el censo de
   posteriores de la 427 no declaraba M3 → declarada con su motivo) y `retiro-estados-migration` (d)
   (`count()` global de `jobs` movido por tests en paralelo: `{ jobs: 90 }` vs `{ jobs: 92 }` → se cuenta
   por `xmin = pg_current_xact_id()::xid`; mutacion M-M7 «la migracion encola un job» lo pone ROJO).
   Arreglados en `b4f6be95`.
2. `gate_454_backend_2.log` — `INIT_EXIT=1`, 1 rojo ajeno: `liquidacion-reparto-migration` bloque B,
   `40P01 deadlock` en su `aplicarDdl` (9 skipped por su `beforeAll`). Aislado 3/3 verde (24/24).
3. `gate_454_backend_3.log` — `INIT_EXIT=1`, 1 rojo ajeno: `recuperar-contrasena-form.test.tsx`
   (formulario de login, no encuentra el texto bajo carga). Aislado 3/3 verde (11/11).
4. **`gate_454_backend.log` (definitiva)** — typecheck y lint en verde; `Test Files 2119 passed (2119)` ·
   `Tests 30393 passed | 26 skipped (30419)`; los 26 skipped son `tests/components/Analitica{Page,Shell}`,
   **0 skipped en `integration/db`**; `✓ tests: sin rojos nuevos`; `== init OK ==`; **`INIT_EXIT=0`**.

**Veredicto:** backend de la 454 hecho y verde (T1.1-T1.26 salvo la retirada de los dos valores del tipo y
la clase `evento_orden` de la linea de tiempo, que exigen UI: §BLOQUEO-2 y §BLOQUEO-3), con la red de la
Fase 0 en 28/28 y C07 ya `it`.
