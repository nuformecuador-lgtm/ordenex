# Feature 135 — Rename de nomenclatura de `order_status` (tasks)

> `[P]` = paralelizable con otras `[P]` del mismo bloque (no comparten archivo).
> Cada task cierra con su criterio de "hecho". Requisitos en `requirements.md`, diseño y
> censo clasificado en `design.md`. **Prerequisito de gate:** confirmar Q1 (mapeo) y Q2
> (alcance del contrato externo) antes de tocar código.

## Bloque A — fuente de verdad TS + migración · debe ir PRIMERO
Al editar la tupla, `OrderStatusValue` cambia y el compilador empieza a exigir los mapas.

- [ ] **T1** — `lib/types/order-status.ts`: renombrar los 6 literales de `ORDER_STATUS_SEED`
  (`en_reparto`→`en_ruta`, `en_espera_aceptacion`→`por_recoger`, `en_bodega`→`en_bodega_central`,
  `en_ruta_bodega_principal`→`en_ruta_bodega_central`, `devuelta_origen`→`devolviendo_a_tienda`,
  `recibido_origen`→`en_tienda`) **conservando la posición** (índices 8/10/13 intactos) y
  actualizar comentarios. *Hecho:* la tupla tiene 15 elementos, mismos índices, nuevos
  literales; `OrderStatusValue` compila.
- [ ] **T2** (depende de T1) — Crear `db/migrations/<ts>_order_status_rename_nomenclatura/migration.sql`
  con los 6 `UPDATE "order_status" SET value=... WHERE value=...` (R2), sin `ALTER TYPE`.
  *Hecho:* archivo con las 6 sentencias exactas + comentario que explica id/FK preservados (R4).
- [ ] **T3** (depende de T2) — Crear `down.sql` con los 6 UPDATE inversos (R3).
  *Hecho:* `down.sql` es el inverso exacto (contiene los values viejos por diseño).
- [ ] **T4** (depende de T2/T3) — Aplicar en local (`pnpm run db:migrate`) y verificar
  rollback (`pnpm run db:rollback` aplica `down.sql`) + re-migrar limpio. *Hecho:* la tabla
  `order_status` muestra los nuevos values; el rollback restituye los viejos conservando
  `id`; conteo estable (R3/R4 a mano).

## Bloque B — mapas de presentación (forzados por el compilador) · depende de T1
- [ ] **T5** — `app/(app)/ordenes/_components/EstatusBadge.tsx`: renombrar las CLAVES de
  `ORDER_STATUS_LABELS`, `ORDER_STATUS_VARIANT` y `ORDER_STATUS_CLASS` a los nuevos values,
  **sin cambiar** las etiquetas de texto ni la variante/clase. NO tocar el case especial
  `en_ruta_bodega_satelite` (~línea 96). *Hecho:* build type-check verde (exhaustividad
  `Record<OrderStatusValue,…>`); ninguna cadena visible cambió (R6/R8).

## Bloque C — lógica: constantes / sets / uniones-literal (categoría d) · depende de T1 · [P] por archivo
Regla: cambiar cada literal de estado; NO cambiar nombres de constante ni de columna.
(Referencias `archivo:línea` en `design.md §A.d`.)

- [ ] **T6** [P] — `lib/repositories/`: `OrdenRepository.ts` (incl. `ESTADOS_CANCELABLES_API`,
  `ORIGEN_RECEPCION_ORIGEN`), `CorteDiarioRepository.ts`, `CierreDiaRepository.ts`,
  `GestionOrdenRepository.ts`, `LiberacionReprogramadaRepository.ts`, `RecuperacionBodegaRepository.ts`.
- [ ] **T7** [P] — `lib/services/`: `MisAsignacionesService.ts`, `GuiaAsignacionService.ts`
  (incl. `ORIGEN_RUTEO_SATELITE` Set), `CierreDiaService.ts` (`ESTADOS_PENDIENTES` + mapa
  `devuelta:[…]`), `CorteDiarioService.ts`, `CierresAdminService.ts`, `DevolucionSlaService.ts`,
  `RecuperacionBodegaService.ts`, `LiberacionReprogramadaService.ts`, `DevolucionOrigenService.ts`,
  `ApiOrdenCancelacionService.ts`, `RecepcionOrigenService.ts`, `AsignacionSateliteService.ts`
  (incl. cast `as "en_espera_aceptacion"`), `BulkOrdenService.ts`, `OrdenService.ts`.
- [ ] **T8** [P] — `lib/actions/`: `mis-asignaciones.ts`, `resolver-novedad.ts`, `cierre-dia.ts`,
  `devolucion-origen.ts`, `liberacion-reprogramada.ts` (`ESTATUS_BODEGA_CENTRAL`),
  `recepcion-origen.ts`, `recepcion-satelite.ts`, `ordenes-guia.ts`.
- [ ] **T9** [P] — `lib/interfaces/` (services + repositories): literales de unión y
  comentarios en los `I*` listados en `design.md §A.d` (p. ej. `IAsignacionSateliteService.ts`,
  `IRecepcionOrigenService.ts`, `IDevolucionOrigenService.ts`, `IOrdenRepository.ts`, etc.).
- [ ] **T10** [P] — `lib/types/`: `orden-historial.ts`, `api-orden.ts`, `recepcion-origen.ts`,
  `recepcion-satelite.ts`, `orden.ts`, `orden-guia.ts` (literales de unión + comentarios).
  *Hecho (T6–T10):* build verde; `findEstatusIdByValue` y las guardas resuelven al nuevo
  value; ninguna resolución `value→id` devuelve `null` (R7).

## Bloque D — UI adicional (app/components) · depende de T1 · [P] por archivo
- [ ] **T11** [P] — `app/(app)/ordenes/_components/`: `OrdenesTabs.tsx` (`ESTADO_EN_BODEGA`,
  arrays, `case`), `OrdenesRevisionMaestro.tsx` (`estatusValue`/`.get("<value>")`),
  `GenerarGuiaModal.tsx` (comparaciones `r.estado===`), `OrdenesModule.tsx`, `OrdenesApartado.tsx`,
  `AsignarBodegaModal.tsx`, `DevolverATiendaModal.tsx`, `RecuperarABodegaModal.tsx`,
  `EscanerRecepcionOrigen.tsx`, y `page.tsx` (array de estados por rol, :33).
- [ ] **T12** [P] — `app/(app)/mis-asignaciones/_components/`: `MisAsignacionesModule.tsx`,
  `EscanerRecoger.tsx`, `InputRecoger.tsx`, `useRecogerPorGuia.ts`.
- [ ] **T13** [P] — `app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx`;
  `components/shared/PrioridadResalte.tsx`; `components/private/BodegaLiberadasHoy.tsx`.
  *Hecho (T11–T13):* build verde; la UI muestra las mismas etiquetas de siempre (R8).

## Bloque E — contrato externo (categoría b, R9/Q2) · depende de gate Q2 · [P]
- [ ] **T14** [P] — `lib/api/openapi-spec.ts` (enum de estado + ejemplos),
  `docs/api/api-key-openapi.yaml` (enums publicados), `lib/types/webhook-eventos.ts`
  (lista de eventos), `app/api/ordenes/api-key/[numGuia]/cancelar/route.ts` y
  `.../carga/route.ts` (comentarios/literales). *Hecho:* el contrato expone los nuevos
  values (o queda sin cambios si el gate elige capa de traducción — anotar la decisión).

## Bloque F — tests + seeds (categorías e/f) · depende de Bloques A–E
- [ ] **T15** — `tests/unit/types/order-status.test.ts`: set (:12-30) y aserciones
  POSICIONALES (`[8]`,`[10]`,`[13]`) a los nuevos values conservando índice; segundo
  `describe` (`rows.has(...)`) a los nuevos. *Hecho:* verde con 15 nuevos values.
- [ ] **T16** — `tests/integration/db/order-status-enum-migration.test.ts`: **desacoplar**
  de `ORDER_STATUS_SEED`; afirmar los 8 literales HISTÓRICOS del enum
  (`{entregada, devuelta, devuelta_origen, reprogramada, en_fulfillment,
  en_ruta_bodega_principal, en_bodega, en_preparacion}`) (R10). *Hecho:* el test valida la
  migración histórica sin depender del seed vigente.
- [ ] **T17** — Crear test NUEVO
  `tests/integration/db/order-status-rename-nomenclatura-migration.test.ts`: UP afirma los
  6 UPDATE, DOWN afirma los inversos (R2/R3) y, con DB de test, fila antigua→nueva con `id`
  y conteo estables (R4). *Hecho:* R2/R3/R4 trazados a este test.
- [ ] **T18** [P] — `scripts/seed-ordenes-qa.ts`: literales `estatusValue`/`origenValue`/
  `destinoValue`/`in:[...]` a los nuevos values. *Hecho:* el seed de QA usa los nuevos.
- [ ] **T19** [P] — Resto de tests (89 archivos, ver §Archivos esperados): actualizar datos
  de entrada, fixtures y aserciones a los nuevos values. Repartir en sub-tandas por carpeta
  para paralelizar sin conflicto. *Hecho:* cada suite verde con los nuevos values.
- [ ] **T20** — Crear guard de censo `tests/unit/guards/censo-order-status-rename.test.ts`:
  grep case-sensitive de los 6 values ANTIGUOS sobre `app/ lib/ components/ hooks/ scripts/
  tests/ e2e/`, excluyendo `db/migrations/**` y el `down.sql` de esta feature; falla si hay
  coincidencias (contempla `en_bodega` exacto sin marcar `en_bodega_satelite`). *Hecho:*
  guard en verde (R13).

## Bloque G — cierre
- [ ] **T21** (depende de todo) — `./init.sh` verde + suite completa verde
  (`docs/verification.md`). Regenerar cliente Prisma si el type-check da falso negativo
  (memoria del repo). Mapear cada R→test en
  `progress/impl_135-order-status-rename-nomenclatura.md`. *Hecho:* init + tests verdes;
  mapa de trazabilidad R1–R13 completo.

---

## Archivos esperados (para validación de conflictos de paralelismo)

### SE CREAN (4)
```
db/migrations/<ts>_order_status_rename_nomenclatura/migration.sql
db/migrations/<ts>_order_status_rename_nomenclatura/down.sql
tests/integration/db/order-status-rename-nomenclatura-migration.test.ts
tests/unit/guards/censo-order-status-rename.test.ts
```

### SE MODIFICAN — producción (≈78)
Fuente de verdad + presentación:
```
lib/types/order-status.ts
app/(app)/ordenes/_components/EstatusBadge.tsx
db/schema.prisma                 # solo comentario de líneas ~350-351
lib/config/ordenes.ts            # solo comentario (default NO cambia)
```
Tipos / contrato externo:
```
lib/types/webhook-eventos.ts
lib/types/api-orden.ts
lib/types/recepcion-origen.ts
lib/types/recepcion-satelite.ts
lib/types/orden.ts
lib/types/orden-historial.ts
lib/types/orden-guia.ts
lib/api/openapi-spec.ts
docs/api/api-key-openapi.yaml    # depende de Q2
```
Services:
```
lib/services/MisAsignacionesService.ts
lib/services/CierreDiaService.ts
lib/services/CierresAdminService.ts
lib/services/CorteDiarioService.ts
lib/services/BulkOrdenService.ts
lib/services/ApiOrdenCancelacionService.ts
lib/services/RecuperacionBodegaService.ts
lib/services/DevolucionSlaService.ts
lib/services/LiberacionReprogramadaService.ts
lib/services/OrdenService.ts
lib/services/RecepcionOrigenService.ts
lib/services/DevolucionOrigenService.ts
lib/services/AsignacionSateliteService.ts
lib/services/GuiaAsignacionService.ts
```
Repositories:
```
lib/repositories/GestionOrdenRepository.ts
lib/repositories/OrdenRepository.ts
lib/repositories/RecuperacionBodegaRepository.ts
lib/repositories/LiberacionReprogramadaRepository.ts
lib/repositories/CorteDiarioRepository.ts
lib/repositories/CierreDiaRepository.ts
```
Interfaces:
```
lib/interfaces/services/IMisAsignacionesService.ts
lib/interfaces/services/IBulkOrdenService.ts
lib/interfaces/services/ICierreDiaService.ts
lib/interfaces/services/IApiOrdenCancelacionService.ts
lib/interfaces/services/IRecepcionSateliteService.ts
lib/interfaces/services/IRecuperacionBodegaService.ts
lib/interfaces/services/INovedadesService.ts
lib/interfaces/services/IRecepcionOrigenService.ts
lib/interfaces/services/ILiberacionReprogramadaService.ts
lib/interfaces/services/IGuiaAsignacionService.ts
lib/interfaces/services/IDevolucionOrigenService.ts
lib/interfaces/services/IAsignacionSateliteService.ts
lib/interfaces/repositories/IGestionOrdenRepository.ts
lib/interfaces/repositories/IOrdenRepository.ts
lib/interfaces/repositories/ICierreDiaRepository.ts
lib/interfaces/repositories/IRecuperacionBodegaRepository.ts
lib/interfaces/repositories/IDevolucionSlaRepository.ts
lib/interfaces/repositories/ILiberacionReprogramadaRepository.ts
```
Actions:
```
lib/actions/mis-asignaciones.ts
lib/actions/resolver-novedad.ts
lib/actions/cierre-dia.ts
lib/actions/devolucion-origen.ts
lib/actions/liberacion-reprogramada.ts
lib/actions/recepcion-origen.ts
lib/actions/recepcion-satelite.ts
lib/actions/ordenes-guia.ts
```
App / componentes / scripts:
```
app/(app)/ordenes/page.tsx
app/(app)/ordenes/_components/OrdenesTabs.tsx
app/(app)/ordenes/_components/OrdenesModule.tsx
app/(app)/ordenes/_components/OrdenesApartado.tsx
app/(app)/ordenes/_components/OrdenesRevisionMaestro.tsx
app/(app)/ordenes/_components/AsignarBodegaModal.tsx
app/(app)/ordenes/_components/GenerarGuiaModal.tsx
app/(app)/ordenes/_components/EscanerRecepcionOrigen.tsx
app/(app)/ordenes/_components/DevolverATiendaModal.tsx
app/(app)/ordenes/_components/RecuperarABodegaModal.tsx
app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx
app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx
app/(app)/mis-asignaciones/_components/EscanerRecoger.tsx
app/(app)/mis-asignaciones/_components/InputRecoger.tsx
app/(app)/mis-asignaciones/_components/useRecogerPorGuia.ts
app/api/ordenes/api-key/[numGuia]/cancelar/route.ts
app/api/ordenes/api-key/carga/route.ts
components/shared/PrioridadResalte.tsx
components/private/BodegaLiberadasHoy.tsx
scripts/seed-ordenes-qa.ts
```

### SE MODIFICAN — tests (91) + e2e (7)
Casos especiales (T15/T16): `tests/unit/types/order-status.test.ts`,
`tests/integration/db/order-status-enum-migration.test.ts`. Resto:
```
tests/unit/scripts/seed-order-status.test.ts
tests/unit/actions/order-status.test.ts
tests/unit/actions/liberacion-reprogramada-action.test.ts
tests/unit/actions/recepcion-origen-action.test.ts
tests/unit/db/orden-num-guia-deferred.test.ts
tests/unit/filtro-canton-distrito.test.ts
tests/unit/utils/guia-decision-error-message.test.ts
tests/unit/types/orden-historial-types.test.ts
tests/unit/components/ordenes-tabs.test.tsx
tests/unit/components/ordenes-module.test.tsx
tests/unit/components/mis-asignaciones-buscador.test.ts
tests/unit/repositories/orden-repository.test.ts
tests/unit/repositories/orden-repository.api-lectura.test.ts
tests/unit/repositories/orden-repository.bulk.test.ts
tests/unit/repositories/orden-repository.cancelar-api.test.ts
tests/unit/repositories/orden-repository.carga-api.test.ts
tests/unit/repositories/orden-repository.guia.test.ts
tests/unit/repositories/orden-repository.novedades.test.ts
tests/unit/repositories/gestion-orden-repository.test.ts
tests/unit/repositories/cierre-dia-repository.test.ts
tests/unit/repositories/cierres-admin-repository.test.ts
tests/unit/repositories/corte-diario-repository.test.ts
tests/unit/repositories/liberacion-reprogramada-repository.test.ts
tests/unit/repositories/orden-historial-repository.test.ts
tests/unit/repositories/orden-historial-cobertura.test.ts
tests/unit/services/api-orden-cancelacion-service.test.ts
tests/unit/services/api-orden-lectura-service.test.ts
tests/unit/services/asignacion-satelite-service.test.ts
tests/unit/services/bulk-orden-service.test.ts
tests/unit/services/bulk-orden-service.carga-api.test.ts
tests/unit/services/cierre-dia-service.test.ts
tests/unit/services/cierres-admin-service.test.ts
tests/unit/services/corte-diario-service.test.ts
tests/unit/services/devolucion-origen-service.test.ts
tests/unit/services/devolucion-sla-service.test.ts
tests/unit/services/guia-asignacion-service.test.ts
tests/unit/services/guia-asignacion-gate-coordenadas.test.ts
tests/unit/services/liberacion-reprogramada-service.test.ts
tests/unit/services/mis-asignaciones-service.test.ts
tests/unit/services/mis-asignaciones-orden-ruta.test.ts
tests/unit/services/mis-asignaciones-causa-devolucion.test.ts
tests/unit/services/mis-asignaciones-evidencias.test.ts
tests/unit/services/mis-asignaciones-marcar-luego.test.ts
tests/unit/services/mis-asignaciones-nota-privada.test.ts
tests/unit/services/orden-service.test.ts
tests/unit/services/orden-historial-service.test.ts
tests/unit/services/orden-mensajero-meta-service.test.ts
tests/unit/services/recepcion-origen-service.test.ts
tests/unit/services/recuperacion-bodega-service.test.ts
tests/unit/services/reprogramacion-tienda-service.test.ts
tests/unit/services/rol-admin-satelite-authz.test.ts
tests/unit/services/webhook-estado-service.test.ts
tests/unit/services/webhook-estado-encolado.test.ts
tests/integration/api/ordenes-api-key-listado.route.test.ts
tests/integration/api/ordenes-api-key-carga.route.test.ts
tests/integration/api/ordenes-api-key-cancelar.route.test.ts
tests/integration/actions/ordenes-action.test.ts
tests/integration/actions/ordenes-guia-action.test.ts
tests/integration/actions/asignacion-satelite-action.test.ts
tests/integration/repositories/orden-mensajero-meta.int.test.ts
tests/integration/repositories/orden-webhook-enqueue.test.ts
tests/integration/db/gestion-orden-migration.test.ts
tests/integration/db/cierre-detail-migration.test.ts
tests/integration/db/zonas-migration.test.ts
tests/integration/db/resolver-novedad-recupera-sla.test.ts
tests/integration/db/resolver-novedad-reprograma-sla.test.ts
tests/components/EstatusLabel.test.ts
tests/components/OrdenesEstatusLabelAdminTienda.test.tsx
tests/components/OrdenesRevisionMaestro.test.tsx
tests/components/OrdenesApartado.test.tsx
tests/components/OrdenesTabsEtiquetasChain.test.tsx
tests/components/OrdenesCargaMasivaButton.test.tsx
tests/components/OrdenesCargaPreview.test.tsx
tests/components/OrdenesCargaResumenPaso.test.tsx
tests/components/AsignarBodegaModal.test.tsx
tests/components/AsignarSateliteModal.test.tsx
tests/components/GenerarGuiaModal.test.tsx
tests/components/EscanerRecoger.test.tsx
tests/components/EscanerRecepcionOrigen.test.tsx
tests/components/InputRecoger.test.tsx
tests/components/MisAsignacionesModule.test.tsx
tests/components/MisAsignacionesPage.test.tsx
tests/components/MarcarLuegoToggle.test.tsx
tests/components/NotaPrivadaMensajero.test.tsx
tests/components/GestionarOrdenPanelEvidencias.test.tsx
tests/components/ChatWhatsappPanel.test.tsx
tests/components/HistorialOrdenSheet.test.tsx
tests/components/HistorialOrdenTimeline.test.tsx
tests/components/PrioridadResalte.test.tsx
```
e2e:
```
e2e/asignacion-satelite.spec.ts
e2e/devolucion-origen.spec.ts
e2e/cierre-dia.spec.ts
e2e/historial-orden.spec.ts
e2e/reprogramacion-liberacion.spec.ts
e2e/reintentos-escalado.spec.ts
e2e/mis-asignaciones.spec.ts
```

### NO se tocan (lista de exclusión para el reviewer)
```
# migraciones históricas (inmutables, R10) — el value viejo sobrevive aquí por diseño
db/migrations/20260710150000_order_status_value_enum/**
db/migrations/20260711130000_orden_num_guia_deferred_.../**
db/migrations/20260714123909_reconcile_fks_drop_order_status_value/**
db/migrations/20260714140000_order_status_pendiente/**
db/migrations/20260714150000_seed_order_status_completo/**
db/migrations/20260715120000_order_status_recibido_origen/**
db/migrations/20260722140000_order_status_sin_gestionar/**
db/migrations/2026071*_order_status_en_ruta_bodega_satelite|en_bodega_satelite/**
# (y cualquier otra migración ya versionada que cite estos values)

# registro histórico (no producción)
feature_list.json
progress/**
specs/**   (excepto specs/135-order-status-rename-nomenclatura/)

# valores/columnas que NO cambian
db/schema.prisma  → orden.estatus_id y las FK del historial (por id, R4/R11)
lib/config/ordenes.ts → DEFAULT/FULFILLMENT_ESTATUS_VALUE (en_preparacion/en_fulfillment, R11)
scripts/seed-catalogos.ts → itera ORDER_STATUS_SEED, sin literal propio
# valores vecinos que el WHERE exacto NO alcanza:
#   en_bodega_satelite, en_ruta_bodega_satelite (R11)
```

> Total real a tocar: **≈180 archivos** (≈78 producción + 91 tests + 7 e2e + 4 nuevos).
> El grueso es un barrido mecánico de literales guardado por el censo R13; la corrección de
> raíz es de 1 migración (6 UPDATE) + la tupla `ORDER_STATUS_SEED`.
