# Feature 30 — Asignación por zona (GAM) y ruteo a bodega satélite · tasks.md

Checklist ordenado backend → frontend (un solo ciclo, fullstack). Cada task indica los
`R<n>` que satisface, dependencias y criterio de "hecho". `[P]` = paralelizable con otras
del mismo bloque. La numeración de tests se completa en
`progress/impl_30-asignacion-zona-ruteo-satelite.md`.

> Precondición: F1.4 APROBADA. Confirmar las decisiones (a)-(f) de requirements.md antes de
> tocar código; en especial (a) guardia vs seed GAM, (d) estados de origen del ruteo.

---

## Bloque 0 — Catálogo y migración de estado (R1, R2, R21)

- [ ] **T1** — Añadir `"en_ruta_bodega_satelite"` como 10.º valor de `ORDER_STATUS_SEED` en
  `lib/types/order-status.ts` (con comentario feature 30). — R1.
  *Hecho:* el tipo `OrderStatusValue` incluye el literal; `seedOrderStatus` lo siembra
  (upsert idempotente) sin tocar los 9 previos.
- [ ] **T2** — Crear migración `db/migrations/<ts>_order_status_en_ruta_bodega_satelite/`
  con `migration.sql` (`ALTER TYPE order_status_value ADD VALUE IF NOT EXISTS ...` +
  `INSERT ... ON CONFLICT DO NOTHING`) y `down.sql` (DELETE condicional; documenta que el
  enum no se depura), patrón feature 17. Depende de T1. — R2, R21.
  *Hecho:* `pnpm db:migrate` aplica; `pnpm db:rollback` revierte la fila; el `order_status`
  contiene el valor tras el up.

## Bloque 1 — Repositorios (R3, R5, R6, R14) `[P]` entre sí salvo dep. indicada

- [ ] **T3** [P] — `IZonaRepository.findGamZonaId(): Promise<string|null>` + implementación en
  `ZonaRepository` (`findFirst({ where: { esGam: true }, select: { id: true } })`). — R3.
  *Hecho:* devuelve el id de la zona GAM; `null` si no hay ninguna. Test unit repo.
- [ ] **T4** [P] — `OrdenRepository.findMensajerosGam(gamZonaId)` +
  `findMensajeroIdsValidosGam(ids, gamZonaId)` en `IOrdenRepository`/`OrdenRepository`
  (filtro `rol=mensajero` **y** `zonaId=gamZonaId`). — R5, R6.
  *Hecho:* solo devuelve mensajeros GAM; excluye otras zonas y `zonaId=NULL`. Tests unit repo.
- [ ] **T5** [P] — Modificar `findByIdsForTransicion` para proyectar `zonaId` + `zona.esGam`;
  ampliar `OrdenTransicionRow` con `zonaId`/`zonaEsGam`. — R8, R9, R11, R12.
  *Hecho:* las filas de transición traen la zona y el flag GAM.
- [ ] **T6** [P] — Ampliar el LISTADO: `WITH_ESTATUS_Y_TIENDA` incluye
  `zona.{nombre,esGam}`; `toListItemDTO` agrega `zonaNombre`/`zonaEsGam`; `OrdenListItemDTO`
  (`lib/types/orden.ts`) suma ambos campos (aditivo). — R14, R19.
  *Hecho:* el listado devuelve `zonaNombre`; consumidores del CRUD (6/7) siguen compilando.
- [ ] **T7** — `OrdenRepository.rutearBodegaSateliteLote(ordenIds, estatusId)` (transaccional:
  `num_guia` idempotente vía `nextval('orden_num_guia_seq')` WHERE NULL, fija `estatusId`,
  `mensajeroAsignadoId=NULL`). Depende de T2 (estado). — R10, R13.
  *Hecho:* rutea el lote a `en_ruta_bodega_satelite` asignando guía solo a las que no la
  tienen; test integration.

## Bloque 2 — Servicio (R4, R6–R12) — depende de Bloque 1

- [ ] **T8** — Inyectar `IZonaRepository` en `GuiaAsignacionService` (constructor
  `(repo, zonaRepo)`); actualizar `buildGuiaService` en `lib/actions/ordenes-guia.ts` y los
  tests que instancian el service. — R18.
  *Hecho:* compila; tests de la feature 17 adaptados al nuevo constructor siguen verdes.
- [ ] **T9** — `generarGuia`: resolver `gamZonaId` (guardia R4), clasificar cada orden GAM/
  no-GAM, validar mensajero GAM (R6), rechazar mensajero en orden no-GAM (R8), rutear no-GAM
  a `en_ruta_bodega_satelite` con guía (R9/R10) en la misma transacción del lote (R11).
  Depende de T3–T7. — R4, R6, R8, R9, R10, R11, R17.
  *Hecho:* tests unit/integration: lote mixto → GAM por regla 17, no-GAM a satélite, todo-o-
  nada; sin zona GAM → `validation_error`.
- [ ] **T10** — `asignarDesdeBodega`: validar mensajero GAM (R6) y rechazar órdenes no-GAM en
  el lote (R12); mantener guardia de origen `en_bodega`. Depende de T3–T5, T8. — R6, R12.
  *Hecho:* test unit: orden no-GAM en el lote → `conflict`, sin efectos.
- [ ] **T11** — `rutearABodegaSatelite(input, actor)` nuevo método del service: maestro,
  guardia R4, guardia de origen (orígenes de Pregunta abierta (d)), solo no-GAM, llama
  `rutearBodegaSateliteLote`. Depende de T7, T8. — R13, R16, R17.
  *Hecho:* test unit/integration: rutea N órdenes no-GAM; rechaza GAM/origen inválido.

## Bloque 3 — Server Actions (R4, R5, R13, R16, R18) — depende de Bloque 2

- [ ] **T12** — `listarMensajerosParaAsignacion`: cuerpo pasa a resolver `gamZonaId` +
  `findMensajerosGam` (firma y tipo intactos). — R5, R18.
  *Hecho:* la action devuelve solo mensajeros GAM; test action.
- [ ] **T13** — Nuevos tipos en `lib/types/orden-guia.ts` (`rutearSateliteSchema`,
  `RutearSateliteResultadoItem`, `RutearSateliteResult`) + action `rutearABodegaSatelite`
  (`withErrorHandler` + `resolveActorFromSession` + `toGuiaActionError`). Depende de T11. —
  R13, R16.
  *Hecho:* action tipada discriminada; sin sesión → `unauthenticated`; validación zod en el
  borde.
- [ ] **T14** — Verificar `generarGuia`/`asignarDesdeBodega` con el service extendido y el
  `buildGuiaService` que inyecta `ZonaRepository`. Depende de T8–T10. — R16, R18.
  *Hecho:* firmas estables; tests de actions verdes.

## Bloque 4 — UI del maestro (R14, R15) — depende de Bloque 3

- [ ] **T15** [P] — `ordenes-columns.tsx`: columna "Zona" (`zonaNombre`). `EstatusBadge`/
  etiqueta mapea `en_ruta_bodega_satelite` → "En ruta a bodega \<zona\>" con `zonaNombre`. —
  R14, R15.
  *Hecho:* component test: fila muestra zona; estado ruteado se ve legible con la zona.
- [ ] **T16** — `OrdenesRevisionMaestro.tsx`: 5.º apartado solo-lectura
  `en_ruta_bodega_satelite` ("En ruta a bodega satélite"); botón/modal "Rutear a bodega
  satélite" que llama `rutearABodegaSatelite` (orígenes según Pregunta abierta (d)). Depende
  de T13. — R13, R15.
  *Hecho:* aparece el apartado; el maestro rutea no-GAM y la vista se revalida.
- [ ] **T17** — `GenerarGuiaModal.tsx`: usar `zonaEsGam` por fila; GAM con select (opciones
  GAM), no-GAM en grupo "→ bodega satélite de \<zona\>" sin select; toast distingue espera/
  bodega/ruta-satélite. Depende de T12. — R7, R8, R9, R11.
  *Hecho:* component test: no-GAM sin select; confirmar envía `mensajeroId=null` para no-GAM.

## Bloque 5 — Cierre (R20, R21, R22)

- [ ] **T18** — Barrido de no-regresión: tests GAM de la feature 17 verdes; `pnpm typecheck`,
  `pnpm lint`, `pnpm test` verdes; `./init.sh` en verde. — R18, R19, R20, R21.
  *Hecho:* suite completa verde; `db:migrate`+`db:rollback` OK.
- [ ] **T19** — Completar la tabla `R<n> → test` en
  `progress/impl_30-asignacion-zona-ruteo-satelite.md` (todos los R1–R21 con test concreto). —
  R22.
  *Hecho:* cada requisito mapeado a al menos un test; el reviewer lo valida.

---

## Dependencias (resumen)

```
T1 → T2 → T7 → T11 → T13 → T16
T3,T4,T5,T6 (Bloque 1, [P]) → T9/T10
T8 → T9,T10,T11,T14
T12 → T17
T15 [P]
Bloques 4 → T18 → T19
```

## Notas de alcance (NO hacer aquí)

- Recepción por QR en satélite (`en_ruta_bodega_satelite` → `en_bodega_satelite`): **feature 33**.
- Asignación desde la satélite a sus mensajeros: **feature 34**.
- Módulo del mensajero / aceptación / gestión: **feature 36**.
- Pagos por zona en cierres: **feature 39**. Etiqueta QR/código de barras: **feature 32**.
