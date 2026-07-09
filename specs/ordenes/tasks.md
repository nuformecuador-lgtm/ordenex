# Tasks — ordenes (CRUD backend)

> Backend: `implementer`. `[P]` = paralelizable respecto a las tareas de su mismo
> bloque de dependencia. Cada task fija su criterio de "hecho" y el/los `R<n>` que
> cubre su test (mapa de trazabilidad; docs/verification.md). Diseño FIRME: no hay
> preguntas bloqueantes; iniciar tras aprobación del spec. Complejidad: `high`.

## Bloque 1 — Modelo de datos y migraciones

- [x] T001 Agregar a `db/schema.prisma`: modelo `OrderStatus` (id, value unique);
  modelos de geografía `Zona`, `Provincia` (zona_id), `Canton` (provincia_id),
  `Distrito` (canton_id) con sus índices; modelo `Orden` (todos los campos de R7,
  `num_guia Int @unique @default(autoincrement())`, `num_remision String @unique`,
  `estatus_id` FK not null, `tienda_id` FK a `usuario` not null,
  `zona_id`/`provincia_id`/`canton_id` FK **NOT NULL**, `distrito_id` FK
  **nullable**, `peso Decimal(10,3)`, `notas` texto **nullable**, `deleted_at`,
  timestamps, índices); y las relaciones inversas en `Usuario`/catálogos.
  **Hecho cuando:** `prisma validate` sin errores. Cubre: R7, R8, R9, R10, R11,
  R12, R13, R14, R14a (verificación de modelo). Depende de: aprobación del spec.
- [x] T002 Generar migración `ordenes_catalogos_geografia` con
  `pnpm run db:migrate:create`: `order_status`, `zona`, `provincia`, `canton`,
  `distrito` en orden de FK, con índices, FKs y `ENABLE ROW LEVEL SECURITY` en las
  5 tablas. **Hecho cuando:** existe `migration.sql` con las 5 tablas, FKs en
  orden correcto y RLS. Cubre: R1, R4, R5, R6, R15, R16. Depende de: T001.
- [x] T003 Escribir `down.sql` de T002 (drop en orden inverso: `distrito`,
  `canton`, `provincia`, `zona`, `order_status`), sin tocar tablas preexistentes.
  **Hecho cuando:** `pnpm run db:rollback` + `pnpm run db:migrate` deja el esquema
  sin diff. Cubre: R6, R15, R17. Depende de: T002.
- [x] T004 Generar migración `ordenes` con `pnpm run db:migrate:create`: tabla
  `orden` con `num_guia` SERIAL/secuencia, `zona_id`/`provincia_id`/`canton_id`
  `NOT NULL`, `distrito_id` y `notas` `NULL`, índices únicos de `num_guia` y
  `num_remision`, índices `tienda_id`/`estatus_id`/`created_at`, FKs (order_status,
  usuario, `zona`/`provincia`/`canton` `ON DELETE RESTRICT`, `distrito`
  `ON DELETE SET NULL`) y `ENABLE ROW LEVEL SECURITY`. **Hecho cuando:** existe
  `migration.sql` con la tabla, la secuencia de `num_guia`, uniques, nullabilidad
  correcta, FKs y RLS. Cubre: R8, R12, R14, R14a, R15, R16. Depende de: T002.
- [x] T005 Escribir `down.sql` de T004 (`DROP TABLE orden;`). **Hecho cuando:**
  rollback + re-migrate sin diff. Cubre: R15, R17. Depende de: T004.
- [x] T006 Verificar RLS: test de integración que, con cliente Supabase key
  `anon`, confirma rechazo de query directa a `orden`, `order_status` y las 4
  geografías. **Hecho cuando:** el test pasa (o DIFERIDO documentado si no hay DB
  real, como login T004/T020). Cubre: R16. Depende de: T004.

## Bloque 2 — Seed de `order_status`

- [x] T007 Crear `lib/types/order-status.ts` con `ORDER_STATUS_SEED` (los 7
  valores incluido `en_bodega`, `as const`), fuente única de verdad (patrón
  `ROLES_SEED`). **Hecho cuando:** test unitario verifica que contiene exactamente
  los 7 valores esperados. Cubre: R2. Depende de: T001.
- [x] T008 Agregar `seedOrderStatus(prisma)` a `scripts/seed-catalogos.ts`
  (upsert por `value` iterando `ORDER_STATUS_SEED`) e invocarlo en `main()`.
  **Hecho cuando:** test unitario (Prisma mockeado, como
  `tests/unit/scripts/seed-catalogos.test.ts`) verifica upsert por value e
  idempotencia (re-ejecutar no duplica ni pierde `id`). Cubre: R2, R3. Depende de:
  T002, T007.

## Bloque 3 — Tipos, config e interfaces

- [x] T009 [P] `lib/config/ordenes.ts`: `DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE`,
  `DEFAULT_ESTATUS_VALUE='en_bodega'`, sobreescribibles por entorno. **Hecho
  cuando:** compila `strict`; test verifica cap de `MAX_PAGE_SIZE` y overrides por
  env. Cubre: R33 (soporte), N1. Depende de: T001.
- [x] T010 [P] `lib/types/orden.ts`: `crearOrdenSchema` (num_remision obligatorio
  no vacío, destinatario/telefono_dest/producto obligatorios, peso numérico > 0,
  `zonaId`/`provinciaId`/`cantonId` **obligatorios**, `distritoId`/`estatusId`/
  `notas` opcionales), `actualizarOrdenSchema` (todos opcionales, sin num_guia/id),
  `listarOrdenesSchema` (page/pageSize positivos, sortBy lista blanca, sortDir
  asc/desc, estatusId opcional), `OrdenDTO` (incluye geografía y `notas`).
  **Hecho cuando:** tests de validación cubren rechazo de: num_remision ausente,
  peso negativo/no numérico, `zonaId`/`provinciaId`/`cantonId` ausentes, campos
  requeridos ausentes (R26); page/pageSize no positivos y sortBy fuera de lista
  blanca (R32). Cubre: R12, R14a, R25, R26, R31, R32. Depende de: T001, T009.
- [x] T011 [P] Interfaces `lib/interfaces/repositories/IOrdenRepository.ts`
  (create, findById excl. borradas, list con where/orden/paginación + count,
  update, softDelete, existsEstatus, existsGeo) y
  `lib/interfaces/services/IOrdenService.ts` (crear, obtener, listar, actualizar,
  borrar con contexto de actor). **Hecho cuando:** compilan `strict` sin `any`.
  Cubre: soporte de capas. Depende de: T001.

## Bloque 4 — Repositorio

- [x] T012 Implementar `lib/repositories/OrdenRepository.ts` (solo Prisma). Todas
  las lecturas filtran `deleted_at IS NULL`; `list` acepta `where` (incl.
  `tiendaId`/`estatusId`), orden de lista blanca y offset/limit, y devuelve
  `{ items, total }`; `softDelete` fija `deleted_at`. **Hecho cuando:** tests
  unitarios con Prisma mockeado cubren: unicidad `num_remision` → conflicto (R14/
  R28), exclusión de borradas en find/list (R34), paginación + conteo (R30),
  filtro/orden de lista blanca (R31). Cubre: R14, R28, R30, R31, R34. Depende de:
  T004, T011.

## Bloque 5 — Servicio de dominio (autorización por rol)

- [x] T013 Implementar `lib/services/OrdenService.ts` con la **matriz rol→
  operación** (R19–R24) recibiendo actor `{ usuarioId, rol }`: generación de
  default de estatus (N1), validación de existencia de `estatusId`/FKs de
  geografía, traducción de unicidad a `conflict`, alcance por `tienda_id` para
  `adminTienda`, restricción de `mensajero` a solo `estatusId`. **Hecho cuando:**
  tests unitarios (repo mockeado) cubren:
  - maestro/admin CRUD sobre cualquier orden (R20);
  - adminTienda crea forzando su `tienda_id` y solo ve/edita/borra las suyas
    (R21); crear con `tienda_id` ajeno → `forbidden` (R22);
  - mensajero: crear/borrar → `forbidden`; actualizar solo `estatusId`, otro campo
    → `forbidden` (R23, R41);
  - actor no autorizado → `forbidden` (R24);
  - crear válido asigna estatus default `en_bodega` y delega (R27); num_remision
    duplicado → `conflict` (R28); geografía obligatoria validada (R12/R26);
  - obtener/actualizar/borrar de inexistente o borrada → `not_found` (R29, R36,
    R40);
  - actualizar aplica solo campos permitidos, no toca inmutables, actualiza
    updated_at (R37); estatusId inexistente → validación (R38);
  - borrar hace soft delete y desaparece del listado (R39, R34).
  Cubre: R19–R24, R27, R28, R29, R36, R37, R38, R39, R40, R41. Depende de: T008,
  T009, T010, T012.
  **Fixtures (R14b):** los tests de creación DEBEN sembrar en su setup una
  cadena de geografía (zona → provincia → canton, opcional distrito) porque
  `zona_id`/`provincia_id`/`canton_id` son FK NOT NULL contra tablas creadas
  vacías; sin ese fixture el insert viola las FK.

## Bloque 6 — Borde (Server Actions)

- [x] T014 Implementar `lib/actions/ordenes.ts` (`crearOrden`, `obtenerOrden`,
  `listarOrdenes`, `actualizarOrden`, `borrarOrden`) como Server Actions que: leen
  la sesión (cookie `session` → `SessionRepository`), rechazan sin sesión válida
  (R18), parsean input con los schemas de T010, resuelven actor `{ usuarioId, rol }`
  y llaman a `OrdenService`, devolviendo resultado discriminado tipado (R42).
  **Hecho cuando:** tests de integración cubren:
  - sin sesión/expirada → `unauthenticated` sin tocar DB (R18);
  - input inválido → `validation_error` con fieldErrors (R26/R32/R38);
  - crear válido → `ok` con `OrdenDTO` y `num_guia` asignado (R27);
  - autorización por rol end-to-end (maestro/admin todo; adminTienda solo suyas;
    mensajero solo lectura + estatus) (R19–R24, R41);
  - obtener existente/autorizado → `ok`; inexistente/no autorizado → `not_found`/
    `forbidden` (R29);
  - listar → `{ items, page, pageSize, total }` con filtro/orden y cap de pageSize
    (R30, R31, R33), sin borradas (R34);
  - actualizar → `ok`/`not_found`/`forbidden` (R35, R36, R37);
  - borrar → `ok` (soft) y desaparece del listado (R39); num_remision duplicado →
    `conflict` (R28);
  - errores tipados, sin filtrar internals/PII (R42).
  - **dependencia operativa (R14b):** el setup del test siembra geografía
    (zona/provincia/canton) antes de crear; se documenta que sin geografía poblada
    no es posible crear órdenes.
  Cubre: R14b, R18, R25, R26, R27, R28, R29, R30, R31, R33, R34, R35, R36, R37,
  R38, R39, R40, R41, R42. Depende de: T013.

## Bloque 7 — Verificación final

- [x] T015 Correr `pnpm run typecheck`, `pnpm run lint` y la suite (`tests/unit`,
  `tests/integration`) en verde. **Hecho cuando:** todos pasan y la salida + el
  mapa `R1..R42 → test` se registran en `progress/impl_ordenes.md`. Cubre:
  trazabilidad completa. Depende de: T001–T014.
- [x] T016 Verificar rollback de ambas migraciones (`pnpm run db:rollback` y
  re-migrate) sin errores ni pérdida de datos fuera de lo esperado. **Hecho
  cuando:** corre sin error y el esquema coincide con el previo (o DIFERIDO
  documentado si no hay DB real, como login T020). Cubre: R15, R17. Depende de:
  T003, T005.

## Mapa de trazabilidad R → task

- R1 → T002 · R2 → T007/T008 · R3 → T008
- R4, R5, R6 → T002/T003 · R7 → T001 · R8 → T001/T004 · R9 → T001
- R10 → T001/T013 · R11 → T001 · R12 → T001/T004/T010/T013 · R13 → T001
- R14 → T001/T004/T012 · R14a → T001/T004/T010 · R14b → T013/T014
- R15 → T002/T003/T004/T005/T016 · R16 → T002/T004/T006 · R17 → T003/T005/T016
- R18 → T014 · R19–R24 → T013/T014 · R25 → T010/T014 · R26 → T010/T014
- R27 → T013/T014 · R28 → T012/T013/T014 · R29 → T013/T014 · R30 → T012/T014
- R31 → T010/T012/T014 · R32 → T010 · R33 → T009/T014 · R34 → T012/T013/T014
- R35 → T014 · R36 → T013/T014 · R37 → T013/T014 · R38 → T013/T014
- R39 → T013/T014 · R40 → T013/T014 · R41 → T013/T014 · R42 → T014
