# Tasks — cobros (CRUD backend)

> Ejecuta: `implementer` (backend). `[P]` = paralelizable respecto a las tareas de
> su mismo bloque. Cada task fija su criterio de "hecho" y el/los `R<n>` que cubre
> su test (mapa de trazabilidad; docs/verification.md). Complejidad: `medium`.
> **Decisiones de negocio cerradas (humano, 2026-07-10):** D1 tabla multi-fila con
> columna `nombre`; D2 IVA porcentaje 0..100 `Decimal(5,2)`; D3 `fulfillment` monto
> `Decimal(12,2)` + `comision_cod` porcentaje 0..100 `Decimal(5,2)`; D4 solo
> `maestro` escribe; D5 `nombre` + 8 numéricas NOT NULL, montos/porcentajes ≥ 0 y
> porcentajes ≤ 100 (ver "Decisiones cerradas" en `requirements.md`). No quedan
> [ABIERTO]. Se replica el patrón del CRUD de órdenes (feature 6) y el manejo de
> errores común (features 10/16).

## Bloque 1 — Modelo de datos y migración

- [x] T001 Agregar a `db/schema.prisma` el modelo `Cobro`: `id` uuid; `nombre`
  String NOT NULL (D1); las 5 columnas de monto (`valorFlete`, `valorFleteDevuelto`,
  `valorFleteGam`, `valorFleteDevueltoGam`, `fulfillment`) con `@db.Decimal(12,2)`;
  las 3 de porcentaje (`comisionCod`, `ivaFlete`, `ivaComisionCod`) con
  `@db.Decimal(5,2)` (D2/D3); `@map` snake_case (GAM→gam), NOT NULL; `deletedAt
  @map("deleted_at")`, timestamps, `@@map("cobro")`, `@@index([createdAt])`. SIN
  `@unique` sobre `nombre` (ver design "Unicidad de `nombre`"). **Hecho cuando:**
  `prisma validate` sin errores y los `@map` coinciden con R4. Cubre (verificación
  de modelo): R1, R2, R3, R4, R5. Depende de: aprobación del spec.
- [x] T002 Generar migración `db/migrations/<ts>_cobros/migration.sql`: `CREATE
  TABLE "cobro"` (`nombre TEXT NOT NULL`; 5 montos `DECIMAL(12,2)`; 3 porcentajes
  `DECIMAL(5,2)`; todas NOT NULL; `deleted_at`, timestamps), `CREATE INDEX
  "cobro_created_at_idx"`, `ALTER TABLE "cobro" ENABLE ROW LEVEL SECURITY`. **Hecho
  cuando:** existe `migration.sql` con la tabla, `nombre`, tipos `DECIMAL(12,2)`
  (montos) / `DECIMAL(5,2)` (porcentajes), NOT NULL en las 9 columnas, índice y
  RLS, sin índice único en `nombre`. Cubre: R1, R2, R3, R5, R6, R7. Depende de:
  T001.
- [x] T003 Escribir `down.sql` de T002 (`DROP TABLE IF EXISTS "cobro";`), sin tocar
  tablas preexistentes. **Hecho cuando:** rollback + re-migrate deja el esquema sin
  diff. Cubre: R6. Depende de: T002.
- [x] T004 [P] Test de integración RLS: con cliente Supabase key `anon`, confirmar
  rechazo de query directa a `cobro`. **Hecho cuando:** el test pasa (o DIFERIDO
  documentado si no hay DB real, como `ordenes` T006). Cubre: R7. Depende de: T002.

## Bloque 2 — Config, tipos e interfaces

- [x] T005 [P] `lib/config/cobros.ts`: `DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE`
  sobreescribibles por entorno (`readPositiveInt`, patrón `lib/config/ordenes.ts`).
  **Hecho cuando:** compila `strict`; test verifica cap de `MAX_PAGE_SIZE` y
  overrides por env. Cubre: R18 (soporte). Depende de: aprobación del spec.
- [x] T006 [P] `lib/types/cobro.ts`: `crearCobroSchema` (`nombre` `min(1)`; 5
  montos `nonnegative`; 3 porcentajes `comisionCod`/`ivaFlete`/`ivaComisionCod`
  `min(0).max(100)`; `.strict()`), `actualizarCobroSchema`
  (`crearCobroSchema.partial().strict()`), `listarCobrosSchema` (page/pageSize con
  cap), `CobroDTO` (incluye `nombre`; Decimal→number, sin `deletedAt`),
  `ActionError` (sin `conflict`) y los result types discriminados. **Hecho
  cuando:** tests de validación cubren rechazo de: `nombre` vacío/ausente, campo
  numérico ausente en crear, valor negativo, no numérico, porcentaje > 100
  (R15/R23); `actualizarCobroSchema` rechaza campos desconocidos (`strict`). Cubre:
  R2, R3, R5, R14, R15, R20, R23, R27. Depende de: T005.
- [x] T007 [P] Interfaces `lib/interfaces/repositories/ICobroRepository.ts`
  (`create`, `findById` excl. borrados, `list` con skip/take + count, `update`,
  `softDelete`) y `lib/interfaces/services/ICobroService.ts` (`crear`, `obtener`,
  `listar`, `actualizar`, `borrar` con `Actor { usuarioId, rol }` + result types
  de dominio). **Hecho cuando:** compilan `strict` sin `any`. Cubre: soporte de
  capas. Depende de: T001, T006.

## Bloque 3 — Repositorio

- [x] T008 Implementar `lib/repositories/CobroRepository.ts` (solo Prisma):
  `create` (number→`Prisma.Decimal`), `findById`/`list` filtran `deleted_at IS
  NULL`, `list` devuelve `{ items, total }` con `orderBy created_at desc` y
  `skip/take`, `update` solo si no borrado, `softDelete` fija `deleted_at`; `toDTO`
  incluye `nombre`, hace `Decimal.toNumber()` en las 8 numéricas y omite
  `deleted_at`. **Hecho cuando:** tests unitarios con Prisma mockeado cubren:
  exclusión de borrados en find/list (R19), paginación + conteo (R18), soft delete
  (R24), serialización Decimal→number con `nombre` presente y sin exponer
  `deleted_at` (R27). Cubre: R18, R19, R24, R27. Depende de: T002, T007.

## Bloque 4 — Servicio (autorización por rol)

- [x] T009 Implementar `lib/services/CobroService.ts` con la matriz rol→operación
  (R9–R13): `READ_ROLES={maestro,admin}`, `WRITE_ROLES={maestro}`; autorización
  antes de tocar datos; `crear` persiste `nombre` + las 8 columnas numéricas;
  `obtener`/`actualizar`/
  `borrar` resuelven excluyendo borrados y devuelven `not_found` si ausente;
  `borrar` hace soft delete; `listar` con paginación/cap. **Hecho cuando:** tests
  unitarios (repo mockeado) cubren:
  - `maestro` CRUD completo (R10);
  - `admin` obtiene/lista OK pero crear/actualizar/borrar → `forbidden` (R11);
  - `adminTienda`/`mensajero` cualquier operación → `forbidden` (R12);
  - rol no reconocido → `forbidden` (R13);
  - crear válido persiste y devuelve DTO (R16);
  - obtener/actualizar/borrar de inexistente o borrado → `not_found` (R17/R21/R25);
  - actualizar aplica solo campos provistos, no toca `id`/`created_at` (R22);
  - borrar hace soft delete y desaparece del listado (R24, R19).
  Cubre: R9, R10, R11, R12, R13, R16, R17, R19, R21, R22, R24, R25. Depende de:
  T005, T006, T008.

## Bloque 5 — Borde (Server Actions)

- [x] T010 Implementar `lib/actions/cobros.ts` (`crearCobro`, `obtenerCobro`,
  `listarCobros`, `actualizarCobro`, `borrarCobro`) como Server Actions que:
  resuelven actor con `resolveActorFromSession` (rechazan sin sesión → R8),
  parsean input con los schemas de T006, llaman a `CobroService` dentro de
  `withErrorHandler` y traducen con `toActionError` (patrón `lib/actions/ordenes.ts`),
  devolviendo resultado discriminado tipado. **Hecho cuando:** tests de integración
  (service inyectable + `getActor` mock, como `ordenes-action.test.ts`) cubren:
  - sin sesión → `unauthenticated` sin tocar DB (R8);
  - input inválido (`nombre` vacío, campo numérico ausente/negativo, porcentaje
    > 100) → `validation_error` con `fieldErrors` (R15/R23);
  - crear válido (maestro) → `ok` con `CobroDTO` (incluye `nombre`) (R16);
  - autorización end-to-end: `admin` lee pero no escribe; `adminTienda`/`mensajero`
    → `forbidden` (R10–R13);
  - obtener/actualizar/borrar inexistente → `not_found` (R17/R21/R25);
  - listar → `{ items, page, pageSize, total }` con cap de `pageSize`, sin borrados
    (R18/R19);
  - borrar → `ok` (soft) y desaparece del listado (R24);
  - resultados tipados sin filtrar internals/PII (R26/R27).
  Cubre: R8, R9, R10, R11, R12, R13, R14, R15, R16, R17, R18, R19, R20, R21, R22,
  R23, R24, R25, R26, R27. Depende de: T009.

## Bloque 6 — Verificación final

- [x] T011 Correr `pnpm run typecheck`, `pnpm run lint` y la suite (`tests/unit`,
  `tests/integration`) en verde; `./init.sh` sin errores. **Hecho cuando:** todos
  pasan y el mapa `R1..R27 → test` se registra en `progress/impl_cobros.md`. Cubre:
  trazabilidad completa. Depende de: T001–T010.
- [x] T012 Verificar rollback de la migración (`db:rollback` + re-migrate) sin
  errores. **Hecho cuando:** corre sin error y el esquema coincide con el previo (o
  DIFERIDO documentado si no hay DB real, patrón `ordenes` T016). Cubre: R6.
  Depende de: T003.

## Mapa de trazabilidad R → task

- R1 → T001/T002 · R2 → T001/T002/T006 · R3 → T001/T002/T006 · R4 → T001
- R5 → T001/T002/T006 · R6 → T002/T003/T012 · R7 → T002/T004
- R8 → T010 · R9 → T009/T010 · R10 → T009/T010 · R11 → T009/T010 · R12 → T009/T010
- R13 → T009/T010 · R14 → T006/T010 · R15 → T006/T010 · R16 → T009/T010
- R17 → T009/T010 · R18 → T005/T008/T010 · R19 → T008/T009/T010
- R20 → T006/T010 · R21 → T009/T010 · R22 → T009/T010 · R23 → T006/T010
- R24 → T008/T009/T010 · R25 → T009/T010 · R26 → T010 · R27 → T006/T008/T010
