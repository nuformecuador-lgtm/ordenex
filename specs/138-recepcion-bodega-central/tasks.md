# Feature 136 — Recepción en bodega central · tasks.md

> Depende de **135** (renombre de estados). NO empezar hasta que 135 esté mergeada: las constantes
> `en_ruta_bodega_central`/`en_bodega_central` y el catálogo `order_status` renombrado deben
> existir. `[P]` = paralelizable con las tareas del mismo bloque.

## Bloque 0 — Precondición

- [ ] **T0. Verificar dependencia 135.** Confirmar en `db/schema.prisma`/seed que el catálogo
  `order_status` tiene `en_ruta_bodega_central` y `en_bodega_central`, y que
  `BulkOrdenService.ESTATUS_INICIAL_API === "en_ruta_bodega_central"`.
  - Hecho: grep confirma ambos valores post-135; sin ellos, se para y se avisa.

## Bloque 1 — Migración (enum de historial)

- [ ] **T1. Migración `ADD VALUE 'recepcion_bodega_central'`.** Crear
  `db/migrations/<ts>_orden_historial_origen_recepcion_bodega_central/` con `migration.sql` (UP:
  `ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS 'recepcion_bodega_central';`,
  va sola) y `down.sql` (recrea el tipo sin el valor, patrón `carga_api`; lista de valores copiada
  del enum vigente ANTES de esta feature). Añadir el valor al enum `OrdenHistorialOrigenTipo` en
  `db/schema.prisma`.
  - Hecho: `pnpm run db:migrate` aplica en verde; `pnpm run db:rollback` revierte con el `down.sql`
    sin error; `prisma generate` reconoce el nuevo valor.

## Bloque 2 — Backend (tras T1)

- [ ] **T2. Interfaz repo.** Añadir `recibirEnBodegaCentral(ordenId, destinoEstatusId, historial):
  Promise<boolean>` a `lib/interfaces/repositories/IOrdenRepository.ts`.
  - Hecho: type-check pasa; la firma reusa `HistorialContexto`.

- [ ] **T3. Implementación repo.** Implementar `recibirEnBodegaCentral` en
  `lib/repositories/OrdenRepository.ts` (espejo de `recibirEnOrigen` SIN guardia de tienda/zona;
  guardia por estado de origen `en_ruta_bodega_central` + `deletedAt: null`; `updateMany` +
  `appendCambioEstado` con `origenTipo: 'recepcion_bodega_central'` en la misma tx; NO toca
  `num_guia`/`mensajero_asignado_id`). Depende de **T2**.
  - Hecho: transiciona solo desde el origen; count 1 ⇒ append 1; count 0 ⇒ sin append. (R2/R3/R9/R18)

- [ ] **T4. Interfaz service.** Crear `lib/interfaces/services/IRecepcionBodegaCentralService.ts`
  con `RecibirEnBodegaCentralServiceResult` e `IRecepcionBodegaCentralService` (§3.4 del design).
  `[P]` con T2/T3.
  - Hecho: type-check pasa; el union NO incluye `zona_ajena`/`tienda_ajena`/`sin_zona`.

- [ ] **T5. Service.** Crear `lib/services/RecepcionBodegaCentralService.ts` (espejo de
  `RecepcionOrigenService`; rol `esAccesoTotal`; sin guardia de zona/tienda; orden de guardias:
  rol → no_encontrada → ya_recibida → estado_invalido → catálogo → transición → conflict). Depende
  de **T2, T4**.
  - Hecho: cubre R1/R2/R4/R6/R7/R8/R9/R11 con dobles de repo.

- [ ] **T6. Tipos + zod del borde.** Crear `lib/types/recepcion-bodega-central.ts` con
  `recibirEnBodegaCentralSchema` (`{ numGuia: int positive }`) y `RecibirEnBodegaCentralResult`
  (dominio + `unauthenticated`). `[P]` con T5.
  - Hecho: schema rechaza `0`, negativos y no-enteros. (R10)

- [ ] **T7. Server Action.** Crear `lib/actions/recepcion-bodega-central.ts` con
  `recibirEnBodegaCentralPorQr(input, deps)` (espejo de `recepcion-origen.ts`: actor por sesión,
  zod, `withErrorHandler`, traductor de `AppErrorShape`). Depende de **T5, T6**.
  - Hecho: sin sesión ⇒ `unauthenticated` (R5); input inválido ⇒ `validation_error` (R10); delega
    el resto al service.

## Bloque 3 — Frontend (tras T7)

- [ ] **T8. Componente receptor.** Crear
  `app/(app)/ordenes/_components/EscanerRecepcionBodegaCentral.tsx` (QR cámara vía `QrScanner` +
  input manual de guía; ambos a `recibirEnBodegaCentralPorQr`; toasts por resultado; `onRecibida`
  en ok/ya_recibida; guard `procesando`). Depende de **T7**.
  - Hecho: escaneo y entrada manual disparan la recepción; toast correcto por cada status; código
    inválido cortado en cliente. (R12/R13/R15)

- [ ] **T9. Wiring en tabs + page.** Añadir prop `puedeRecibirBodegaCentral` a
  `OrdenesTabs.tsx` (monta el componente en el encabezado con `onRecibida={handleSuccess}`) y la
  gate `esAccesoTotal` en `app/(app)/ordenes/page.tsx`. Depende de **T8**.
  - Hecho: maestro/admin ven el control y refrescan las tablas tras recibir (R14); adminTienda y
    otros roles NO lo ven (R16).

## Bloque 4 — Verificación y trazabilidad

- [ ] **T10. Tests.** Unit del service (R1/R2/R4/R6/R7/R8/R9/R11), integración repo
  (R2/R3/R9/R18 + guardia de origen), test de la action (R5/R10), test del componente
  (R12–R16). `[P]` internamente por archivo.
  - Hecho: cada `R<n>` tiene ≥1 test con nombre que describe el comportamiento.

- [ ] **T11. Mapa de trazabilidad.** Escribir `progress/impl_136-recepcion-bodega-central.md` con
  el mapa `R<n> → test`. Depende de **T10**.
  - Hecho: todos los R1–R18 mapeados; ninguno sin test.

- [ ] **T12. Verificación ejecutable.** `./init.sh` en verde + suite de tests + `pnpm run
  db:migrate`/`db:rollback` OK. Depende de todo lo anterior.
  - Hecho: init y tests pasan; migración up/down limpia.

---

## Archivos esperados

**Nuevos:**
- `db/migrations/<ts>_orden_historial_origen_recepcion_bodega_central/migration.sql`
- `db/migrations/<ts>_orden_historial_origen_recepcion_bodega_central/down.sql`
- `lib/interfaces/services/IRecepcionBodegaCentralService.ts`
- `lib/services/RecepcionBodegaCentralService.ts`
- `lib/types/recepcion-bodega-central.ts`
- `lib/actions/recepcion-bodega-central.ts`
- `app/(app)/ordenes/_components/EscanerRecepcionBodegaCentral.tsx`
- `tests/unit/RecepcionBodegaCentralService.test.ts`
- `tests/integration/recibir-en-bodega-central.test.ts` (repo + action)
- `progress/impl_136-recepcion-bodega-central.md`

**Modificados:**
- `db/schema.prisma` (nuevo valor en `enum OrdenHistorialOrigenTipo`)
- `lib/interfaces/repositories/IOrdenRepository.ts` (firma `recibirEnBodegaCentral`)
- `lib/repositories/OrdenRepository.ts` (implementación `recibirEnBodegaCentral` + constantes de estado)
- `app/(app)/ordenes/_components/OrdenesTabs.tsx` (prop + montaje del receptor en el encabezado)
- `app/(app)/ordenes/page.tsx` (gate `puedeRecibirBodegaCentral`)
