# 427 — Revisión · rama `feat/427-traspasar-ordenes-en-reparto` @ `c1d04b4a` · `origin/dev` @ `95264fb4`

> Escrito por el leader a partir del informe del reviewer, que no puede escribir archivos (su tipo de
> agente no tiene la herramienta) y no lo sorteó por Bash. El árbol quedó limpio tras las 13
> mutaciones: `git diff HEAD` vacío, HEAD en `c1d04b4a`.

## Veredicto: **RECHAZADO** — 2 bloqueantes (R42, R20) y 5 menores

El código de R42 y de R20 es **correcto**; lo que falta es que **una regresión de cualquiera de los
dos deje la suite en rojo**. Hoy la dejaría en verde.

## Qué se ejecutó

- **Sin repetir la suite completa.** El gate del leader (`gate_427_b.log`): typecheck y lint en 0
  errores, 1.968/1.969 archivos, 28.723 tests; el único rojo es el flake del ranking (`40P01`).
- **Corrida base sin mutar**, secuencial (`--no-file-parallelism`, para no provocar el deadlock),
  22 archivos: los 7 de la ficha, T21/T24, las dos guardias, notificadores-reales, push-elegibles,
  productores-wiring, los 5 censos y `no-migration-102` → **457/457, 0 saltados, `VITEST_EXIT=0`**.
- **13 mutaciones en 14 corridas**, cada una aplicada por script, corrida y revertida con
  `git checkout` desde un `trap` dentro de la misma llamada. Scripts y logs en el scratchpad de la
  sesión (`mut/`).

| # | Mutación | Resultado |
| --- | --- | --- |
| 1 | Action sin los dos notificadores (mutación 11 del plan) | ROJO, 4 |
| 2 | Construir sin ellos pero dejarlos referenciados (`void [...]`) | ROJO, 2 (identidad en runtime) |
| 3 | Cruzar recibido y cedido | ROJO, 2 |
| 4 | Servicio: `loteId: input.mensajeroDestinoId` | ROJO, 1 |
| 5 | **Servicio: `loteId: validas[0].id`** (la forma «ordenId» de la mutación 10) | **SOBREVIVE** — 72/72, y 333/333 en el `related` completo del servicio |
| 6 | `emitir.ts`: `entidadId: ctx.mensajeroUsuarioId` | ROJO, 1 |
| 7 | Rastro con `this.prisma` dentro del callback | ROJO, 2 |
| 8 | Rastro escrito después del `$transaction` | ROJO, 2 |
| 9 | **`traspasarConversaciones(this.prisma, …)`** | **SOBREVIVE** — 23/23 |
| 10 | **`UPDATE gestion_orden SET mensajero_id = destino WHERE orden_id IN (lote)`** dentro de la tx | **SOBREVIVE** — 23/23 |
| 11 | Control de la 10: el mismo `UPDATE` con `WHERE mensajero_id = origen` | ROJO en T9.4 |
| 12 | Volver a poner `@sin-superficie` con el modal montado | ROJO (caducidad) |
| 13 | El modal no importa la action | ROJO (R-A) |

## Los siete puntos pedidos

1. **Censos: OK, no se relajó nada.** Los seis archivos (262, 253, 333, 271, 403, 102) con **0
   líneas borradas**; ningún `toEqual` cambió de forma. Los valores nuevos van al final, detrás de
   `reparto_manana`/`reparto_manana_dia`, en el orden recibido → cedido de la migración. Las únicas
   líneas `−` en otros censos suben un contador junto con el miembro que lo justifica (8→9 en
   `carga-del-mensajero`, 2→3 en `AsignacionBloqueoPorCierre`).
2. **Notificador: OK.** La mutación del plan cae, y sus dos variantes también (1-3). Lo que la mata
   es la aserción por identidad en runtime (`tests/unit/actions/traspasar-mensajero.test.ts:231-260`).
3. **Entidad = `lote_id`: el código está bien, el test no basta → B1.** `emitir.ts:1510` y `:1538`
   usan `ctx.loteId`; el servicio pasa `aplicado.loteId` (`:361`, `:373`), que sale de un
   `randomUUID()` por acto (`:304`); el repositorio devuelve el `loteId` recibido
   (`OrdenRepository.ts:4824`, afirmado por T9.7).
4. **Arnés: el arreglo es real.** La mutación 7 cae en sus dos formas (7 y 8). Pero solo cubre la
   tabla del rastro → M1.
5. **Migraciones: OK.** Solo 4 archivos añadidos en `db/migrations`, ninguna migración existente
   tocada; las dos con `down.sql`; el de los enums retipa las tres columnas —`push_envio_dia.evento`
   incluida— sin `DELETE`; sus listas (15 eventos / 13 entidades) coinciden una a una con
   `origin/dev`; timestamps posteriores a `20260916120000`; la tabla nueva con RLS
   (`migration.sql:115`).
6. **Gestiones: el código no toca `gestion_orden` ni `cierre_*`, pero el test está incompleto → B2.**
   El corte diario (`CierreDiaRepository.ts:737-775`) mete las órdenes traspasadas en el cierre del
   destino: es la semántica diseñada, no un hallazgo.
7. **`@sin-superficie`: OK.** Cae en rojo en las dos direcciones (mutaciones 12 y 13).

## Bloqueantes

### B1 — R42: nada ata el `loteId` de los avisos al `lote_id` del acto

**Medido:** con el servicio pasando el id de la primera orden como `loteId`, **72/72 en verde**, y
333/333 en todo el `related` del servicio. Es la forma «ordenId» de la mutación 10 de `tasks.md`,
que solo se puede aplicar en el servicio; la bitácora probó solo la variante `mensajeroId` en el
emisor.

**Por qué no la ve nadie:** T16 (`traspaso-mensajero-service.test.ts:527`, `:535`) solo exige forma
de uuid y que los dos avisos compartan el valor.

**Consecuencia si regresa:** A → Carlos, vuelta a Andy, y otra vez A → Carlos. La entidad se repite,
el `P2002` se absorbe y **el aviso queda mudo para siempre**.

**Qué falta:** en el caso «cada notificador EXACTAMENTE UNA VEZ», afirmar que los dos `loteId` son
**el mismo valor que recibió `traspasarMensajeroLote`**
(`espias.traspasarMensajeroLote.mock.calls[0][0].loteId`). Re-ejecutar la mutación 5 y pegar su
salida en rojo.

### B2 — R20: T9.4 no siembra ninguna gestión sobre una orden del lote

**Medido:** T9.4 (`traspaso-mensajero.int.test.ts:482-523`) pone la gestión en la orden `entregada`,
que **no entra** en `loteDe(ctx, [enReparto])`. La mutación 10 sobrevive (23/23) y su control, la 11,
cae: el test no es vacío, pero le falta el caso que el requisito nombra («sobre esas órdenes»).

**Por qué es real:** `gestion_orden` no tiene unicidad por orden (solo `@@index([ordenId])`); una
orden `reprogramada` vuelve a bodega y a reparto (`OrdenesListado.tsx:747`) **arrastrando su
gestión**, con `cierre_id` y `pago_mensajero`; y R14 da por hecho que el lote puede traer órdenes con
el tope de intentos agotado. Reescribir el autor movería **pago y cierre del origen al destino** (el
riesgo de design §A6) sin ningún test en rojo.

**Qué falta:** en T9.4, sembrar una gestión previa del origen **sobre una orden del lote**
(idealmente con `cierre_id` y `pago_mensajero`) y afirmar que conserva `mensajero_id`, `cierre_id` e
importes. Re-ejecutar la mutación 10 en rojo.

## Menores

- **M1 — el chat y los jobs escritos FUERA de la tx no se detectan.** El tipo
  `Pick<PrismaClient,"$queryRaw">` acepta el cliente entero, así que design §5 («ni escribir fuera»)
  no se cumple por tipo. La mutación 9 sobrevive: en el arnés, el `ROLLBACK TO SAVEPOINT` también
  revierte lo escrito con el cliente externo, pero **en producción los hilos quedarían movidos si
  falla el rastro** (R23). Igual con `encolarOptimizacionDebounce`. **Recomendado en este ciclo:** con
  `romper:"fuera"`, que el cliente externo lance ante cualquier escritura mientras dura su
  `$transaction`.
- **M2 — textos del modal con «orden(es)» y «conversación(es)»** (`TraspasarMensajeroModal.tsx:92`,
  `:100`). Design §10 dice «N órdenes», y los emisores de la propia ficha sí separan singular y plural.
- **M3 — `tasks.md` sin casillas `[x]`.** Mismo caso que el m2 de la 424: fricción del arnés.
- **M4 — logs del gate commiteados** (`gate_427.log` + `gate_427_b.log`, 26.490 líneas en `c1d04b4a`).
  **Resuelto por el leader:** fuera del índice; la evidencia del flake vive en la tabla de `impl_427.md`.
- **M5 — sin entrada en `progress/history.md`.** Parte del cierre.

No son hallazgo, según lo acordado: el flake del ranking, D2, D1, T25, los warnings de lint y la
desviación declarada de la mutación 12 en T13 (T16 la mata).

## Checklist de `CHECKPOINTS.md`

- **Pasa:** spec EARS y design con alternativas descartadas · mapa `R → test` en `impl_427.md` ·
  typecheck y lint · RLS en la tabla nueva y `down.sql` en las dos migraciones · sin secretos ni
  hardcode de país, moneda o cuenta · capas separadas e interfaces en `lib/interfaces/` · mutación
  por Server Action.
- **No pasa:** tasks marcadas `[x]` (M3) · cada R con un test que lo verifique (**R42, R20**) ·
  entrada en `history.md` (M5) · veredicto OK.
- **Con matiz:** `./init.sh` rojo solo por el flake ajeno.
- **No aplica:** E2E y webhooks.

## Trazabilidad verificada

`srv` = `tests/unit/services/traspaso-mensajero-service.test.ts` · `int` =
`tests/integration/db/traspaso-mensajero.int.test.ts` · `act` =
`tests/unit/actions/traspasar-mensajero.test.ts` · `emit` =
`tests/unit/notificaciones/emitir-traspaso.test.ts` · `modal`/`listado` =
`tests/components/TraspasarMensajero{Modal,Listado}.test.tsx`.

| R | Test | Estado |
| --- | --- | --- |
| R1, R2, R4-R14 | `srv` (R2 cubre 4 roles con `nadaSeConsulto`), `act` (R8), guardia `carga-del-mensajero` (R4), `int` T9.10 (R5), CHECK de T3(b) (R7) | OK |
| R3, R34 | `listado` | OK |
| R15-R19, R21, R22, R24-R27, R30-R32 | `int` T9.1-T9.11 y los casos R30/R31, T3(f) y el timeline (R26, R30) | OK |
| **R20** | `int` T9.4 | **B2** |
| R23 | `int` T9.10 | OK; ver M1 |
| R28 | `act` y `modal` | OK |
| R29 | `orden-historial-fusion` (b-427) y `HistorialOrdenTimeline` | OK |
| R33, R35-R37 | `modal` | OK; textos en M2 |
| R38-R41 | `emit` y `srv` | OK |
| **R42** | `emit` («la ENTIDAD es el `lote_id`») | **B1** |
| R43 | `push-elegibles` y T5 (`push_envio_dia_cupo`) | OK |

## Para volver a revisión

1. B1 y B2 cerrados, con las mutaciones 5 y 10 re-ejecutadas **en rojo** y su salida pegada en
   `impl_427.md`.
2. M1 en el mismo ciclo: la mutación 9 en rojo.
3. Los 22 archivos de la corrida base en verde y sin saltados. El gate completo solo si el cambio sale
   de `tests/`.
