# Review — Feature 30: asignación por zona (GAM) y ruteo a bodega satélite

**Veredicto: APROBADO (0 bloqueantes)** · reviewer (model opus) · 2026-07-11 · rama `feature/30-asignacion-zona-ruteo-satelite`

## Verificación ejecutable (regla #5)
El reviewer corrió `./init.sh` él mismo (no confió en la bitácora):
- `typecheck` OK, `lint` 0 errores (135 warnings, todas en `.claude/skills/impeccable/scripts/*`, ajenas a la feature).
- `Test Files 154 passed (154) · Tests 1287 passed (1287)`, exit 0, `== init OK ==`.

## Trazabilidad R1–R22 → test: COMPLETA
Cada requisito mapea a un test concreto que ejercita lo afirmado (verificado leyendo los tests, no solo la tabla). Detalle:
- R1 seed 10.º valor idempotente; R2/R20/R21 migración estática (ADD VALUE, INSERT ON CONFLICT, down condicional, valor único) — `order-status-satelite-migration.test.ts`.
- R3 `findGamZonaId`; R4 guardia sin GAM → `validation_error` sin efectos en los 3 métodos de escritura.
- R5/R6 repo filtra `rol=mensajero AND zonaId=gamZonaId` (excluye otras zonas y NULL) + revalidación en service.
- R7 override de GenerarGuia + `asignarDesdeBodega` usan `findMensajeroIdsValidosGam` (service REVALIDA).
- R8–R13 clasificación GAM/no-GAM, lote mixto en una tx, `num_guia` idempotente, rechazo no-GAM en bodega, acción dedicada.
- R14/R15 columna Zona + label derivado "En ruta a bodega <zona>".
- R16/R17 autz maestro-only, guardias por origen, todo-o-nada.
- R18/R19 no-regresión camino 17 + DTO aditivo.

## Decisiones F1.4: todas implementadas tal cual
(a) GAM = flag `esGam` + guardia R4 (migración NO siembra zona GAM). (b) UN estado `en_ruta_bodega_satelite`, nombre derivado de `orden.zonaId`. (c) ruteo = solo transición + `zonaId` + num_guia, sin FK a bodega. (d) orígenes `en_fulfillment`/`en_preparacion`/`en_bodega`. (e) restricción mensajeros-GAM también en el override del `GenerarGuiaModal`, revalidada en service. (f) `num_guia` al rutear, idempotente (`WHERE num_guia IS NULL` + `nextval('orden_num_guia_seq')`).

## Migración
`db/migrations/20260711140000_order_status_en_ruta_bodega_satelite/` con `migration.sql` (ADD VALUE IF NOT EXISTS + INSERT ON CONFLICT DO NOTHING) y `down.sql` reversible (DELETE condicional `NOT EXISTS` sobre `orden`; el enum PG no se depura, documentado). Patrón 17/28; timestamp posterior a la 17. Test estático presente. **Deuda aceptada**: no aplicada contra Postgres real (sin DB aislada; `.env` apunta a Supabase compartido).

## Capas / convenciones / seguridad: OK
Repository solo Prisma; service sin HTTP; action con zod + `resolveActorFromSession` + `withErrorHandler`. Firmas estables (`generarGuia`, `asignarDesdeBodega`, `listarMensajerosParaAsignacion` sin cambio de contrato; DTO ampliado aditivo). Contrato de columnas de la feature 26 intacto (`ordenes-columns-admin-tienda.ts` excluye `id:"zona"`). Autz maestro-only en escritura; idempotencia de `num_guia`; nombre de secuencia constante (nunca interpola entrada).

## Hallazgos menores (no bloqueantes, aceptados)
1. `zonaNombre`/`zonaEsGam` opcionales en `OrdenListItemDTO` (correcto por R19 aditivo); el `GenerarGuiaModal` decide GAM/no-GAM por `zonaEsGam` por fila. El repo SIEMPRE los envía → sin riesgo en runtime; riesgo latente si un consumidor construyera filas sin el campo (caería al lado GAM por defecto). Sugerencia opcional: comentar la invariante cerca del uso en el modal.
2. `listarMensajerosParaAsignacion` devuelve lista vacía si no hay zona GAM (por diseño; la escritura falla con R4). Coherente, pero conviene que la UI muestre un aviso accionable ("configura la zona GAM"). No es requisito de esta feature — candidato a mejora de UX o a la feature 24.
