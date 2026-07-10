# Requisitos — vehiculos (feature 50)

> Alcance: crear el catálogo `vehiculos` (tabla + enum de Postgres) disponible
> **únicamente para el rol `maestro`**, siguiendo el patrón de catálogo con enum de
> las features 4 (role seed) y 19 (rol adminSatelite), con una **diferencia clave
> deliberada**: la columna de valor se llama **`name`** (NO `value` como
> `rol`/`order_status`/`tipo_identificacion`). Nuevo enum `VehiculoValue` con tres
> valores `moto`, `carro`, `camion`; esos mismos valores se siembran en la tabla.
> El `id` (uuid PK) queda listo para que la feature 21 (postulación de mensajero) lo
> referencie vía `vehiculo_id`. Zona: **backend puro, sin UI**. NO se implementa el FK
> de la feature 21 aquí.

## Contexto verificado del repo (no inventado)

- Patrón de catálogo con enum Postgres: `db/schema.prisma` líneas 25-43
  (`model Rol { id, value RolValue @unique } / enum RolValue { ... @@map("rol_value") }`).
- `tipo_identificacion` y `order_status` usan columna **`value`** (`schema.prisma`
  16-23, 160-168). Esta feature usa **`name`** por decisión explícita del
  `feature_list.json` (id 50).
- Fuente única de verdad en TS: `lib/types/roles.ts`
  (`export const ROLES_SEED: RolValue[] = Object.values(RolValue)`) y
  `lib/types/order-status.ts` (`ORDER_STATUS_SEED`).
- Seed idempotente: `scripts/seed-catalogos.ts` (`seedRoles`, `seedOrderStatus`,
  `seedTiposIdentificacion`) con `upsert({ where, update: {}, create })`.
- Migración de enum Postgres con `down.sql` que recrea/elimina el tipo:
  `specs/rol-adminsatelite/design.md` y `db/migrations/.../order_status_value_enum`.
- RLS de tablas server-only: `db/migrations/20260710120000_cobros/migration.sql`
  línea 33 (`ALTER TABLE "cobro" ENABLE ROW LEVEL SECURITY`, sin policies) y su
  `down.sql` (`DROP TABLE IF EXISTS "cobro"`).
- Patrón de capas del CRUD con autz por rol: `lib/interfaces/services/ICobroService.ts`
  (Actor `{ usuarioId, rol: RolValue }`, resultados discriminados
  `ok|validation_error|forbidden|not_found`) y `lib/auth/resolve-actor.ts`
  (`resolveActorFromSession`).

## Enum y schema

- **R1 (ubicuo):** El sistema DEBE declarar en `db/schema.prisma` un enum
  `VehiculoValue` con exactamente tres miembros `moto`, `carro`, `camion` (sin
  duplicados), cada uno **sin `@map`** (los tres son identificadores válidos e iguales
  al label deseado en la DB), y con `@@map("vehiculo_value")` (convención de
  `rol_value`/`order_status_value`).
- **R2 (ubicuo):** El sistema DEBE declarar en `db/schema.prisma` un modelo `Vehiculo`
  con **exactamente** los campos `id` (`String @id @default(uuid())`) y `name`
  (tipo `VehiculoValue`, `@unique`), mapeado a la tabla `@@map("vehiculos")`. La
  columna de valor DEBE llamarse `name` (NO `value`).

## Migración (nueva, incremental, reversible)

- **R3 (ubicuo):** El sistema DEBE crear una migración nueva bajo `db/migrations/`
  (carpeta propia `<timestamp>_vehiculos/`, con timestamp posterior a la última
  migración existente) cuyo `migration.sql` (a) cree el tipo enum
  `CREATE TYPE "vehiculo_value" AS ENUM ('moto','carro','camion')`, (b) cree la tabla
  `vehiculos` con `id` (TEXT PK) y `name` (`"vehiculo_value"` NOT NULL), (c) cree el
  índice único sobre `name` (`vehiculos_name_key`), y (d) habilite RLS con
  `ALTER TABLE "vehiculos" ENABLE ROW LEVEL SECURITY`. NO DEBE editar ninguna
  migración ya aplicada.
- **R4 (ubicuo):** El sistema DEBE proveer el `down.sql` de esa migración que revierta
  exactamente lo creado: `DROP TABLE IF EXISTS "vehiculos"` y luego
  `DROP TYPE IF EXISTS "vehiculo_value"` (la tabla se elimina antes que el tipo del que
  depende), sin tocar tablas ni tipos preexistentes.
- **R5 (condicional):** SI el `down.sql` se ejecuta MIENTRAS existe (en features
  posteriores) un FK `vehiculo_id` que referencia `vehiculos`, ENTONCES el `DROP TABLE`
  DEBE fallar de forma explícita por la dependencia (no dejar estado inconsistente).
  Precondición esperada en esta feature: no existe aún ningún FK a `vehiculos`
  (el de la feature 21 no se implementa aquí), por lo que el rollback es seguro.

## Fuente única de verdad en TS y seed

- **R6 (ubicuo):** El sistema DEBE definir la fuente única de verdad en TS
  `lib/types/vehiculos.ts` derivando `VEHICULOS_SEED` del enum de Prisma
  (`Object.values(VehiculoValue)`), sin lista literal duplicada, de modo que tras
  regenerar el cliente Prisma `VEHICULOS_SEED` contenga exactamente los tres valores
  `moto`, `carro`, `camion`.
- **R7 (por evento):** CUANDO `seedVehiculos` se ejecuta, el sistema DEBE garantizar
  una fila en `vehiculos` por cada valor de `VEHICULOS_SEED` (tres filas: `moto`,
  `carro`, `camion`), usando `upsert` por `name` (`update: {}` no-op, `create: { name }`),
  sin borrar ni tocar otras tablas.
- **R8 (por evento):** CUANDO `seedVehiculos` se ejecuta dos o más veces consecutivas
  sobre la misma base, el sistema DEBE dejar exactamente tres filas (una por valor del
  enum), sin duplicados y con `id` estable (idempotencia por el índice único
  `vehiculos_name_key`).

## Autorización (solo maestro)

- **R9 (de estado):** MIENTRAS el actor autenticado tiene `rol = maestro`, el sistema
  DEBE permitirle las operaciones del catálogo `vehiculos` expuestas por la feature
  (ver R11/R12).
- **R10 (condicional):** SI el actor NO está autenticado o su `rol` es distinto de
  `maestro` (`admin`, `mensajero`, `adminTienda`, `adminSatelite`), ENTONCES el sistema
  DEBE denegar la operación devolviendo `unauthenticated` / `forbidden`
  respectivamente, sin exponer datos del catálogo. La autz se resuelve en el servidor
  vía `resolveActorFromSession` + servicio (patrón `ICobroService`), no en el cliente.

## Operaciones del catálogo (CRUD acotado por el enum)

> Ver design.md D1 y **Preguntas abiertas**: el alcance exacto de las operaciones de
> ESCRITURA es una decisión pendiente para la puerta F1.4. Los requisitos R11-R12
> describen la interpretación recomendada.

- **R11 (por evento):** CUANDO un actor `maestro` solicita listar/obtener el catálogo
  `vehiculos`, el sistema DEBE devolver las filas sembradas (`moto`, `carro`, `camion`)
  con su `id` y `name`, sin exponer campos internos.
- **R12 (condicional):** SI (y solo si la decisión F1.4 habilita escritura) un actor
  `maestro` intenta crear una fila del catálogo, ENTONCES el sistema DEBE aceptar
  **únicamente** un `name` que sea un valor válido de `VehiculoValue` y que **no exista
  ya** en la tabla; ante un `name` inválido DEBE devolver `validation_error` y ante un
  `name` ya presente DEBE devolver `conflict` (el dominio del catálogo queda acotado a
  `{moto, carro, camion}` por el enum de Postgres, sin filas arbitrarias).

## Consumo futuro (feature 21) — sin implementar aquí

- **R13 (ubicuo):** El sistema DEBE exponer `vehiculos.id` como PK `uuid` estable y
  `name` con índice único, de modo que la feature 21 pueda añadir un FK
  `usuario.vehiculo_id -> vehiculos.id`. El sistema NO DEBE implementar ese FK ni tocar
  el modelo `Usuario` en esta feature.

## No-regresión y calidad

- **R14 (ubicuo):** El sistema DEBE compilar (`pnpm run typecheck`) y pasar
  `pnpm run lint` tras añadir el enum, el modelo, los tipos y el seed.
- **R15 (ubicuo):** La feature DEBE ser **backend puro**: NO DEBE añadir páginas,
  rutas de UI ni componentes en `app/` o `components/` (la pantalla de gestión, si
  existiera, sería otra feature).

## Criterios de aceptación (verificables)

- `db/schema.prisma` contiene `enum VehiculoValue { moto carro camion @@map("vehiculo_value") }`
  (3 miembros, sin `@map`) y `model Vehiculo { id, name VehiculoValue @unique @@map("vehiculos") }`
  (R1, R2).
- Existe una migración nueva cuyo `migration.sql` crea el tipo, la tabla `vehiculos`
  (id + name), el índice único de `name` y habilita RLS; ninguna migración previa fue
  modificada (R3). Su `down.sql` hace `DROP TABLE`/`DROP TYPE` (R4).
- Tras `pnpm run db:generate`, `VEHICULOS_SEED` tiene longitud 3 e incluye
  `moto`/`carro`/`camion`, derivado de `Object.values(VehiculoValue)` (R6).
- El fake de `seedVehiculos` persiste 3 filas por `name`; dos ejecuciones dejan 3
  filas con `id` estable (R7, R8).
- El servicio de `vehiculos` devuelve `forbidden`/`unauthenticated` para actores no
  `maestro` y `ok` con las 3 filas para `maestro` (R9, R10, R11).
- `pnpm run typecheck` y `pnpm run lint` verdes; sin archivos nuevos en `app/`
  ni `components/` (R14, R15).

## Preguntas abiertas (para la puerta humana F1.4)

- **[P1] Alcance real de "CRUD" sobre un catálogo cerrado de 3 valores de enum.**
  El dominio está fijado por el enum `vehiculo_value`, así que un CRUD de filas
  arbitrarias no es posible: como máximo puede haber 3 filas (moto/carro/camion).
  ¿Qué se espera?
  - **(A) Recomendado (coherente con rol/order_status/tipo_identificacion):** catálogo
    **sembrado + solo lectura** (`listar`/`obtener`), sin Server Actions de
    create/update/delete. Es lo que hacen los otros catálogos con enum del repo.
  - **(B) CRUD acotado por el enum:** exponer también `crear`/`actualizar`/`borrar`
    guardados a `maestro`, pero cada `name` limitado a los 3 valores del enum y único
    (crear una fila que el seed también podría restaurar; borrar una fila del catálogo).
    Más superficie, valor operativo dudoso porque el seed ya deja las 3 filas.
  - **(C) Catálogo abierto (sin enum):** cambiar `name` a `String` libre para permitir
    tipos de vehículo arbitrarios. **Contradice** el `feature_list.json` (pide enum
    Postgres) y el patrón del repo; se documenta solo para descartarla.
  La spec adopta **(A)** como base firme (R6-R11, R13) y deja R12 (escritura) como
  condicional a que F1.4 elija **(B)**.
- **[P2] Nombre del enum:** se propone `VehiculoValue` (`@@map("vehiculo_value")`) por
  paralelismo con `RolValue`/`OrderStatusValue`. Confirmar en F1.4 si se prefiere
  `VehiculoName`/`vehiculo_name` dado que la columna es `name`. (Recomendado:
  `VehiculoValue`, porque nombra el **dominio de valores**, no la columna.)
- **[P3] Ubicación del seed:** integrar `seedVehiculos` en el `scripts/seed-catalogos.ts`
  existente (junto a roles/order_status/tipo_identificacion). Confirmar que se desea
  ejecutarlo en el mismo `pnpm db:seed`.
