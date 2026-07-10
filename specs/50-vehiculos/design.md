# Diseño — vehiculos (feature 50)

## Alcance técnico

Complejidad `low`, zona `backend`. Crear un catálogo `vehiculos` respaldado por un
enum de Postgres, con seed idempotente y fuente única de verdad en TS, siguiendo el
patrón de las features 4 (role seed) y 19 (rol adminSatelite). Diferencia clave: la
columna de valor es **`name`** (no `value`). Cuatro/cinco piezas coordinadas:

1. **Enum Postgres** `vehiculo_value` (`moto`, `carro`, `camion`) — miembro Prisma +
   migración nueva con su `down.sql`.
2. **Modelo Prisma** `Vehiculo { id, name }` mapeado a la tabla `vehiculos`, con
   `name @unique` y RLS.
3. **Fuente única de verdad TS** `lib/types/vehiculos.ts`
   (`VEHICULOS_SEED = Object.values(VehiculoValue)`).
4. **Seed idempotente** `seedVehiculos` en `scripts/seed-catalogos.ts` (upsert por `name`).
5. **Lectura autorizada solo a `maestro`** (servicio + Server Action, patrón capas
   `ICobroService` + `resolveActorFromSession`). Escritura: condicional a F1.4 ([P1]).

Sin UI, sin FK a `Usuario` (eso es la feature 21).

## Diferencia clave respecto a los demás catálogos (columna `name`)

Los catálogos existentes usan `value`:

```prisma
model Rol                { id String @id @default(uuid()); value RolValue @unique; @@map("rol") }
model OrderStatus        { id String @id @default(uuid()); value String   @unique; @@map("order_status") }
model TipoIdentificacion { id String @id @default(uuid()); value String   @unique; @@map("tipo_identificacion") }
```

`vehiculos` rompe ese patrón **a propósito** (feature_list.json id 50): la columna se
llama `name`. El `upsert` del seed usa `where: { name }` (no `where: { value }`), y el
índice único es `vehiculos_name_key`. Este es el punto de mayor riesgo de "romper el
patrón por costumbre": revisar en el seed y en el service que se use `name`.

## Modelo Prisma (R1, R2)

```prisma
// Catalogo de tipos de vehiculo (feature 50). Backed por enum Postgres
// vehiculo_value. OJO: columna "name" (NO "value" como rol/order_status/tipo_id).
model Vehiculo {
  id   String       @id @default(uuid())
  name VehiculoValue @unique // seed (3): moto, carro, camion

  @@map("vehiculos")
}

enum VehiculoValue {
  moto
  carro
  camion

  @@map("vehiculo_value")
}
```

Los tres miembros son identificadores válidos e iguales al label deseado en la DB →
**sin `@map`** (a diferencia de `adminTienda @map("Admin Tienda")`).

## Migración nueva (R3, R4)

Carpeta `db/migrations/<timestamp>_vehiculos/` con timestamp posterior a la última
migración aplicada (hoy la más reciente es `20260710150000_order_status_value_enum`;
usar p. ej. `20260710160000_vehiculos`).

`migration.sql`:

```sql
-- CreateEnum (feature 50). Patron CREATE TYPE "rol_value"/"order_status_value".
CREATE TYPE "vehiculo_value" AS ENUM ('moto', 'carro', 'camion');

-- CreateTable. OJO: columna "name" (NO "value").
CREATE TABLE "vehiculos" (
    "id" TEXT NOT NULL,
    "name" "vehiculo_value" NOT NULL,

    CONSTRAINT "vehiculos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (catalogo: name unico).
CREATE UNIQUE INDEX "vehiculos_name_key" ON "vehiculos"("name");

-- EnableRowLevelSecurity. Defensa en profundidad (docs/architecture.md): la tabla
-- solo se accede desde el servidor (Prisma service role). Sin policies para
-- anon/authenticated -> RLS bloquea todo salvo service role. La autz por rol
-- (solo maestro, R9/R10) vive en el service, no en policies.
ALTER TABLE "vehiculos" ENABLE ROW LEVEL SECURITY;
```

`down.sql` (revierte exactamente, tabla antes que el tipo del que depende):

```sql
-- DOWN: revierte migration.sql de esta carpeta. No toca objetos preexistentes.
DROP TABLE IF EXISTS "vehiculos";
DROP TYPE IF EXISTS "vehiculo_value";
```

Nota R5: si en el futuro (feature 21) existiera un FK `usuario.vehiculo_id ->
vehiculos.id`, el `DROP TABLE` fallaría por la dependencia; correcto (rollback no debe
dejar estado inconsistente). En esta feature ese FK no existe, así que el down es
seguro.

## Fuente única de verdad TS (R6)

`lib/types/vehiculos.ts` (patrón `roles.ts`):

```ts
import { VehiculoValue } from "@prisma/client";

// Fuente unica de verdad de los tipos de vehiculo (patron ROLES_SEED). El seed
// idempotente (seedVehiculos) itera esta lista con upsert por `name`.
export const VEHICULOS_SEED: VehiculoValue[] = Object.values(VehiculoValue);
```

Sin segunda lista literal: añadir/quitar un miembro del enum se propaga solo.

## Seed idempotente (R7, R8)

Añadir `seedVehiculos` a `scripts/seed-catalogos.ts`, junto a los otros seeds, e
invocarlo en `main()`. **Diferencia clave: `where: { name }`**, no `value`:

```ts
export async function seedVehiculos(
  prisma: Pick<PrismaClient, "vehiculo">
): Promise<void> {
  for (const name of VEHICULOS_SEED) {
    await prisma.vehiculo.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
}
```

Idempotente por el índice único `vehiculos_name_key`; `update: {}` no-op; sin `delete`;
`id` estable entre corridas. Testeable con un fake in-memory (patrón `seedRoles`).

## Lectura/CRUD y autorización (R9-R13)

Patrón de capas del repo (Controller/Server Action → Service → Repository, con
interfaces en `lib/interfaces/`), reutilizando `resolveActorFromSession`
(`lib/auth/resolve-actor.ts`) que devuelve `Actor { usuarioId, rol: RolValue }`.

- **Interfaz** `lib/interfaces/services/IVehiculoService.ts`: `Actor`, resultados
  discriminados `ok | forbidden | unauthenticated | validation_error | conflict |
  not_found` (patrón `ICobroService`).
- **Service** `lib/services/VehiculoService.ts`: puerta de autz **solo `maestro`**
  (`if (actor.rol !== "maestro") return { status: "forbidden" }`), lógica pura sin
  HTTP. Recibe el repositorio por constructor (DI).
- **Repository** `lib/repositories/VehiculoRepository.ts`: solo Prisma
  (`vehiculo.findMany`, `findUnique`, y —si F1.4 elige (B)— `create`/`update`/`delete`).
- **Server Action** `lib/actions/vehiculos.ts` (`'use server'`): lee la sesión con
  `resolveActorFromSession`, instancia el service, traduce el resultado. Mutaciones
  internas por Server Action (no route handler), según `docs/architecture.md`.

Autz (matriz): `maestro` → permitido; `admin`/`mensajero`/`adminTienda`/`adminSatelite`
→ `forbidden`; sin sesión → `unauthenticated`. RLS ya bloquea el acceso directo desde
el cliente; la autz fina vive en el service (misma decisión que `cobro`).

**Alcance de operaciones (base firme = opción A, ver [P1]):** `listar()` y `obtener(id)`
para `maestro`. `crear/actualizar/borrar` (opción B) quedan diseñadas pero **detrás de
la decisión F1.4**: si se habilitan, `crear` valida que `name ∈ VehiculoValue` (zod
`z.nativeEnum(VehiculoValue)`) y que no exista (si existe → `conflict`); el dominio
queda acotado a `{moto, carro, camion}` por el enum.

## Consumo futuro — feature 21 (R13, informativo)

La feature 21 añadirá `usuario.vehiculo_id String? @map("vehiculo_id")` con
`FK -> vehiculos.id` y su índice. **No se implementa aquí.** Esta feature garantiza que
`vehiculos.id` es un uuid PK estable y `name` único, condiciones suficientes para ese
FK. `feature_list.json` ya declara `depends_on: 50` en la feature 21.

## RLS / seguridad

Tabla nueva con RLS habilitada y sin policies (server-only), patrón `cobro`/geografía.
El seed corre desde el servidor con service role. Sin secretos, sin PII, sin
`console.log` de datos sensibles.

## Alternativas descartadas

1. **Columna `value` (como los demás catálogos) en vez de `name`.** Sería lo "natural"
   por consistencia con `rol`/`order_status`/`tipo_identificacion`. **Descartada:** el
   `feature_list.json` (id 50) exige explícitamente `name`, y la feature 21 referenciará
   esta tabla; cambiar el nombre de la columna contradiría el requisito y obligaría a
   renombrar después. Se documenta el riesgo de "romperlo por costumbre".
2. **Tabla `vehiculos` con `name String` libre (sin enum Postgres) — catálogo abierto.**
   Permitiría tipos de vehículo arbitrarios y un CRUD "de verdad". **Descartada:**
   contradice el `feature_list.json` (pide un enum Postgres con moto/carro/camion) y el
   patrón de dominio a nivel de motor de las features 4/19. Un valor fuera del enum
   sería un dato inválido imposible por el tipo.
3. **CRUD de escritura completo desde ya (crear/editar/borrar filas).** **Descartada
   como base** (queda como opción B pendiente de F1.4): con el dominio fijado por el
   enum de 3 valores, el seed ya deja las 3 filas y un CRUD de escritura aporta poco;
   los demás catálogos con enum del repo son solo-lectura sembrados. Se implementa la
   base solo-lectura y se difiere la escritura a la decisión humana.
4. **Editar una migración ya aplicada para meter el `CREATE TYPE`/`CREATE TABLE`.**
   **Descartada:** rompe el checksum/historial de Prisma Migrate (mismo razonamiento
   que la feature 19). Se crea una migración incremental nueva.
5. **Route Handler (`app/api/vehiculos`) para las operaciones.** **Descartada:** son
   mutaciones/lecturas internas; `docs/architecture.md` manda Server Actions para eso y
   reserva los route handlers para webhooks/API externa.

## Trazabilidad prevista (R → test)

- R1, R2 → test de schema (regex sobre `db/schema.prisma`): `enum VehiculoValue` con 3
  miembros sin `@map` y `@@map("vehiculo_value")`; `model Vehiculo` con `name
  VehiculoValue @unique` y `@@map("vehiculos")`; ausencia de columna `value`.
- R3 → test de migración: `migration.sql` contiene `CREATE TYPE "vehiculo_value"`,
  `CREATE TABLE "vehiculos"` con columna `name`, `CREATE UNIQUE INDEX
  "vehiculos_name_key"`, `ENABLE ROW LEVEL SECURITY`; ninguna migración previa cambió.
- R4, R5 → test de `down.sql`: contiene `DROP TABLE IF EXISTS "vehiculos"` antes de
  `DROP TYPE IF EXISTS "vehiculo_value"`.
- R6 → test de fuente de verdad: `VEHICULOS_SEED` longitud 3, deriva de
  `Object.values(VehiculoValue)`, incluye `moto`/`carro`/`camion`.
- R7 → test de `seedVehiculos` (fake): persiste 3 filas por `name`.
- R8 → test de idempotencia: dos corridas → 3 filas, `id` estable.
- R9, R10, R11 → tests de `VehiculoService`: `maestro` → `ok` con 3 filas; `admin`/
  `mensajero`/`adminTienda`/`adminSatelite` → `forbidden`; sin actor → `unauthenticated`.
- R12 → (solo si F1.4 = B) test de `crear`: `name` inválido → `validation_error`;
  `name` existente → `conflict`.
- R13 → verificación (grep/schema): `vehiculos.id` es `@id @default(uuid())`; el
  modelo `Usuario` NO gana `vehiculo_id` en esta feature.
- R14 → `pnpm run typecheck` + `pnpm run lint` verdes.
- R15 → verificación: sin archivos nuevos bajo `app/` ni `components/`.
