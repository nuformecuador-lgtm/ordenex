# Tasks — vehiculos (feature 50)

> Backend puro, complejidad `low`. Orden de ejecución con dependencias. `[P]` =
> paralelizable con la task anterior. Cada task lista los `R<n>` que satisface y su
> criterio de "hecho". **Antes de T5-T8 se requiere la decisión F1.4 [P1]** (alcance
> de escritura): si es opción A (recomendada), T7/T8 se omiten; si es B, se ejecutan.

## Bloqueo previo

- [ ] **T0 — Confirmar decisión F1.4 [P1]/[P2]/[P3].** (R11, R12) Registrar en el spec
      si el CRUD es solo-lectura (A) o incluye escritura acotada (B), el nombre del
      enum (`VehiculoValue` recomendado) y la ubicación del seed.
      *Hecho:* decisión anotada; ambigüedad resuelta por el humano.

## Modelo de datos

- [ ] **T1 — Declarar enum `VehiculoValue` y modelo `Vehiculo` en `db/schema.prisma`.**
      (R1, R2, R13) Enum con `moto/carro/camion` (sin `@map`, `@@map("vehiculo_value")`);
      modelo `Vehiculo { id @id @default(uuid()); name VehiculoValue @unique;
      @@map("vehiculos") }`. Depende de T0.
      *Hecho:* `pnpm run db:generate` regenera el cliente con `VehiculoValue` y
      `prisma.vehiculo`; columna `name` (no `value`).

- [ ] **T2 — Crear migración `<timestamp>_vehiculos/migration.sql`.** (R3) Timestamp
      posterior al último; `CREATE TYPE "vehiculo_value"`, `CREATE TABLE "vehiculos"`
      (id TEXT PK + name), `CREATE UNIQUE INDEX "vehiculos_name_key"`, `ENABLE ROW
      LEVEL SECURITY`. No editar migraciones previas. Depende de T1.
      *Hecho:* `pnpm run db:migrate` aplica la migración sin error; la tabla existe con
      RLS habilitada.

- [ ] **T3 — Escribir `down.sql` de la migración.** (R4, R5) `DROP TABLE IF EXISTS
      "vehiculos"` antes de `DROP TYPE IF EXISTS "vehiculo_value"`. Depende de T2.
      *Hecho:* `pnpm run db:rollback` revierte la migración dejando la DB sin la tabla
      ni el tipo; re-aplicar la migración vuelve a funcionar.

## Fuente de verdad y seed

- [ ] **T4 — Crear `lib/types/vehiculos.ts` con `VEHICULOS_SEED`.** (R6) Derivado de
      `Object.values(VehiculoValue)`, sin lista literal. `[P]` con T5. Depende de T1.
      *Hecho:* `VEHICULOS_SEED` tipa `VehiculoValue[]`, longitud 3.

- [ ] **T5 — Añadir `seedVehiculos` a `scripts/seed-catalogos.ts` e invocarlo en
      `main()`.** (R7, R8) `upsert({ where: { name }, update: {}, create: { name } })`
      iterando `VEHICULOS_SEED`. **OJO: `name`, no `value`.** Depende de T4.
      *Hecho:* `pnpm db:seed` deja 3 filas en `vehiculos`; re-ejecutar no duplica ni
      cambia `id`.

## Servicio y autorización

- [ ] **T6 — Capa de lectura autorizada (`maestro`).** (R9, R10, R11) Crear
      `lib/interfaces/services/IVehiculoService.ts` (Actor + resultados discriminados),
      `lib/repositories/VehiculoRepository.ts` (`findMany`/`findUnique`),
      `lib/services/VehiculoService.ts` (guard `rol !== "maestro" -> forbidden`;
      `listar`/`obtener`) y `lib/actions/vehiculos.ts` (`'use server'`, usa
      `resolveActorFromSession`). Depende de T1.
      *Hecho:* `listar()` devuelve `ok` con las 3 filas para `maestro` y
      `forbidden`/`unauthenticated` para el resto/sin sesión.

- [ ] **T7 — (Solo si F1.4 = opción B) Operaciones de escritura acotadas por el enum.**
      (R12) `crear/actualizar/borrar` en interfaz/service/repository/action, con zod
      `z.nativeEnum(VehiculoValue)` y unicidad de `name` (`conflict` si existe). Guard
      `maestro`. `[P]` con T6 si se decide B. Depende de T6.
      *Hecho:* crear `name` inválido → `validation_error`; `name` existente →
      `conflict`; crear un valor faltante → `ok`.

## Tests (trazabilidad R → test)

- [ ] **T8 — Tests unitarios de schema, tipos y seed.** (R1, R2, R6, R7, R8, R13)
      Test de `db/schema.prisma` (enum/modelo/columna `name`), de `VEHICULOS_SEED`
      (longitud 3, deriva del enum), y de `seedVehiculos` con fake in-memory
      (persistencia + idempotencia). Patrón `tests/unit/types/roles.test.ts` y
      `tests/unit/scripts/seed-order-status.test.ts`. `[P]` con T9. Depende de T5.
      *Hecho:* tests verdes cubriendo R1/R2/R6/R7/R8/R13.

- [ ] **T9 — Tests de migración y `down.sql`.** (R3, R4, R5) Regex sobre `migration.sql`
      (CREATE TYPE/TABLE/INDEX/RLS) y `down.sql` (DROP TABLE antes de DROP TYPE); no se
      modificó ninguna migración previa. Patrón
      `tests/integration/db/order-status-enum-migration.test.ts`. Depende de T3.
      *Hecho:* tests verdes cubriendo R3/R4/R5.

- [ ] **T10 — Tests de `VehiculoService` (autz) y (si B) escritura.** (R9, R10, R11, R12)
      `maestro` → `ok`; otros roles → `forbidden`; sin actor → `unauthenticated`; (si B)
      validación/conflict de `crear`. Depende de T6 (y T7 si B).
      *Hecho:* tests verdes cubriendo R9/R10/R11 (y R12 si aplica).

## Verificación final

- [ ] **T11 — Verificar calidad y alcance backend.** (R14, R15) `pnpm run typecheck`,
      `pnpm run lint`, `pnpm test` verdes; confirmar que NO se añadió nada en `app/`
      ni `components/`. Depende de todas las anteriores.
      *Hecho:* suite verde; sin archivos de UI nuevos.

- [ ] **T12 — Registrar el mapa `R<n> -> test` en `progress/impl_50-vehiculos.md` y
      correr `./init.sh`.** (trazabilidad, CHECKPOINTS) Depende de T11.
      *Hecho:* `./init.sh` verde; cada `R1..R15` mapeado a un test o verificación;
      entrada añadida a `progress/history.md`.
