# Feature 17 — Órdenes: revisión maestro / generar guía / asignación de mensajero · tasks.md

Zone: `fullstack` · complexity: `high` · depends_on: 27, 28 · branch: `feature/17-revision-maestro-generar-guia`

> Bloque 0 (puerta F1.4): **CERRADO/APROBADO por el humano (2026-07-10).** No requiere
> acción; la feature está lista para implementación. Un commit por task lógica
> (`docs/conventions.md`). Cada task tiene criterio de "hecho". `[P]` = paralelizable
> con sus hermanas del mismo bloque (sin dependencia entre ellas).

---

## Bloque 0 — Aprobación (F1.4)
- [x] **T0** — Puerta F1.4 aprobada por el humano (2026-07-10). Las 5 decisiones + alcance
  (ambos estados de revisión) + estado nuevo registrados como APROBADOS en
  `requirements.md`. **Hecho:** documento sin preguntas abiertas.

## Bloque 1 — Catálogo de estado (R9, R10)
- [ ] **T1** `[P]` — Añadir `"en_espera_aceptacion"` como 9.º valor de `ORDER_STATUS_SEED`
  en `lib/types/order-status.ts`, con comentario de feature. **Hecho:** `OrderStatusValue`
  incluye el valor; test `tests/unit/types/order-status.test.ts` verde con 9 valores.
- [ ] **T2** `[P]` — Actualizar el label legible del estado en
  `app/(app)/ordenes/_components/estatus-label.ts` ("En espera de aceptación del
  mensajero"). **Hecho:** test de `EstatusLabel` cubre el nuevo valor.

## Bloque 2 — Migración de esquema (R1–R7, R10) · depende de T1
- [ ] **T3** — Editar `db/schema.prisma`: `numGuia Int? @unique @map("num_guia")` (quitar
  `@default(autoincrement())`); añadir `mensajeroAsignadoId String?` + relación
  `OrdenMensajeroAsignado` (`onDelete: SetNull`) + `@@index`; añadir lado inverso
  `ordenesAsignadas` en `Usuario`. **Hecho:** `prisma validate`/`generate` sin error.
- [ ] **T4** — Crear migración `db/migrations/<ts>_orden_num_guia_deferred_mensajero_asignado_espera_aceptacion/migration.sql`
  (UP): `DROP DEFAULT` + `DROP NOT NULL` de `num_guia`; `ALTER SEQUENCE orden_num_guia_seq
  OWNED BY NONE`; `ADD COLUMN mensajero_asignado_id` + índice + FK `ON DELETE SET NULL`;
  `ALTER TYPE order_status_value ADD VALUE IF NOT EXISTS 'en_espera_aceptacion'`;
  `INSERT ... order_status ... ON CONFLICT DO NOTHING`. **Hecho:** `pnpm db:migrate` aplica
  en verde; `orden.num_guia` nullable sin default, UNIQUE intacto; columna y estado presentes.
- [ ] **T5** — Escribir `down.sql` (DOWN) en orden inverso, con la ADVERTENCIA obligatoria
  (falla si hay guías NULL) y el borrado condicional del estado de catálogo (patrón
  feature 15). **Hecho:** `pnpm db:rollback` revierte en base sin guías NULL; con guías
  NULL falla explícitamente (test/integration cubre ambos caminos).
- [ ] **T6** `[P]` — Test de migración/DB: `orden.num_guia` nullable + sin default + UNIQUE;
  `orden_num_guia_seq` existe y `OWNED BY NONE`; `nextval` avanza; `mensajero_asignado_id`
  FK nullable `ON DELETE SET NULL` con índice; `order_status` contiene `en_espera_aceptacion`.
  **Hecho:** tests R1/R3/R4/R7/R10 verdes.

## Bloque 3 — No-regresión de creación (R2, R8, R30, R31) · depende de T3/T4
- [ ] **T7** — Verificar/ajustar `OrdenRepository.create` y `createManyOrdenes` para NO
  enviar `num_guia` (queda NULL) y persistir `mensajero_asignado_id = NULL`. **Hecho:**
  test unit repo R2/R8; tests de carga masiva (features 15/16/27) verdes salvo guía NULL.
- [ ] **T8** — Barrido de tipos: `numGuia` como `number | null` en `lib/types/orden.ts`,
  serializadores y componentes del listado (feature 7); mostrar "pendiente"/vacío cuando
  es NULL. **Hecho:** `tsc --strict` sin errores; test R30 (listado con guía pendiente).

## Bloque 4 — Servicio de guía/asignación (R11–R29) · depende de T3
- [ ] **T9** — Definir interfaz `lib/interfaces/services/IGuiaAsignacionService.ts` con
  contratos I/O: `GenerarGuiaInput` (`decisiones: {ordenId, mensajeroId: string|null}[]`),
  `AsignarBodegaInput` (`ordenIds, mensajeroId`) y resultados discriminados. **Hecho:**
  tipos compilan; sin dependencia de HTTP/Prisma.
- [ ] **T10** — Extender `IOrdenRepository`/`OrdenRepository`: `findByIdsForTransicion`,
  `findMensajeroIds` (rol `mensajero`, SIN filtro de zona), `asignarGuiaYTransicion`
  (UPDATE con `num_guia = nextval(...) WHERE num_guia IS NULL`) bajo `$transaction`.
  **Hecho:** métodos con test de repo (integration) para asignación idempotente R5.
- [ ] **T11** — Implementar `GuiaAsignacionService.generarGuia` (R18–R25, R27–R29):
  autorización solo `maestro`; guardia de estado de origen ∈ {`en_fulfillment`,
  `en_preparacion`}; validación de `mensajeroId`; transacción por lote; `num_guia` a TODAS
  las elegibles; destino `en_espera_aceptacion` (con mensajero) o `en_bodega` (sin).
  **Hecho:** tests unit R11/R13/R18/R19/R21/R22/R23/R24/R27/R28 verdes.
- [ ] **T12** — Implementar `GuiaAsignacionService.asignarDesdeBodega` (R26–R29):
  autorización `maestro`; origen = `en_bodega`; `mensajero_asignado_id` + destino
  `en_espera_aceptacion`; NO reasigna `num_guia`. **Hecho:** tests unit R26/R27/R28 verdes.
- [ ] **T13** — Test de atomicidad (integration): fallo a mitad del lote → rollback total,
  ninguna orden numerada; orden inexistente/borrada/estado inválido → fallo aislado sin
  transacción a medias. **Hecho:** tests R25/R29 verdes.

## Bloque 5 — Server Actions (R12, R14) · depende de T11/T12
- [ ] **T14** — Crear `lib/actions/ordenes-guia.ts` (`'use server'`): `generarGuia` y
  `asignarDesdeBodega`, con zod (`generarGuiaSchema`, `asignarBodegaSchema`), resolución de
  actor (`unauthenticated` si falta), `withErrorHandler` + `toActionError`. **Hecho:**
  tests unit action R14 (sin actor → unauthenticated) y R12 (`admin` escritura → forbidden).
- [ ] **T15** `[P]` — Loader/acción que devuelve TODOS los usuarios rol `mensajero` (sin
  filtro de zona) para el modal. **Hecho:** test R28 (lista sin filtro de zona); firma
  estable documentada para feature 30.

## Bloque 6 — UI del maestro (R15–R20) · depende de T14/T15
- [ ] **T16** — Server Component de órdenes: apartados/tabs separados `en_fulfillment`,
  `en_preparacion`, `en_espera_aceptacion`, `en_bodega`, cada uno con DataTable (feature 7)
  + Paginación (feature 8) filtrando por `value`. Rol validado por `cookies()`; `admin`
  en solo-lectura (sin botones). **Hecho:** component tests R15/R16/R12(UI).
- [ ] **T17** — Selección múltiple por checkbox por apartado; botón "Generar guía" en los
  apartados de revisión (R18) y "Asignar mensajero" en `en_bodega`. **Hecho:** component
  test R17/R18.
- [ ] **T18** — Modal async (feature 13) de "Generar guía": agrupa selección en (a) con
  sugerido (preselecciona, override o "sin") y (b) sin sugerido; construye `decisiones` y
  hace UNA llamada a `generarGuia` (R24); Toast (feature 11) con resumen/errores. **Hecho:**
  component test R20/R24; caso mixto en una sola llamada.
- [ ] **T19** `[P]` — Modal de asignación desde `en_bodega` → `asignarDesdeBodega`. **Hecho:**
  component test del flujo bodega (R26) con Toast.

## Bloque 7 — Cierre (R32)
- [ ] **T20** — Completar la tabla de trazabilidad R→test con rutas concretas en
  `progress/impl_17-revision-maestro-generar-guia.md`; correr `./init.sh` + suite completa.
  **Hecho:** `./init.sh` verde, todos los tests verdes, cada `R1`–`R31` con test asociado
  (reviewer valida R32).

---

## Grafo de dependencias (resumen)
- T1 → T3 → {T4 → T5, T6, T7, T8, T9, T10, T11, T12, T13}
- T2 `[P]` con T1.
- T11/T12 → T14 → T16/T17/T18/T19.
- T15 `[P]` con T14; T19 `[P]` con T18.
- T20 al final (depende de todo).
