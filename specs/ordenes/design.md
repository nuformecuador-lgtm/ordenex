# Diseño — ordenes (CRUD backend)

## Enfoque general

CRUD de órdenes como **Server Actions** (`lib/actions/ordenes.ts`, `'use server'`),
consistente con `docs/architecture.md` ("Mutación desde componente propio →
Server Action") y con `login` (`lib/actions/auth.ts`). Capas idénticas a login:
Controller (Server Action) → `OrdenService` (lógica de negocio + autorización por
rol, sin HTTP ni DB) → `OrdenRepository` (solo Prisma).

```
lib/actions/ordenes.ts                 Controller: lee sesión, parsea zod, resuelve actor, llama al service
lib/services/OrdenService.ts           Orquesta: autorización por rol, num_guia, defaults, soft delete
lib/repositories/OrdenRepository.ts    Prisma: create/findById/list/update/softDelete (filtra deleted_at)
lib/interfaces/services/IOrdenService.ts
lib/interfaces/repositories/IOrdenRepository.ts
lib/types/orden.ts                     Tipos de dominio + schemas zod (create/update/list) + OrdenDTO
lib/types/order-status.ts              ORDER_STATUS_SEED (fuente única de verdad, patrón ROLES_SEED)
lib/config/ordenes.ts                  DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, DEFAULT_ESTATUS ('en_bodega')
```

Se reutiliza la lectura de sesión (cookie `session` → `SessionRepository`) del
feature `login` para resolver el actor `{ usuarioId, rol }`; no se reimplementa
autenticación.

## Modelo de datos (Prisma)

Todo con `id` uuid TEXT, columnas `snake_case` vía `@map`/`@@map`, timestamps
`created_at`/`updated_at`, y catálogo como **tabla relacionada** (no enum),
consistente con `Rol`/`TipoIdentificacion`.

### Catálogo `order_status`

```prisma
model OrderStatus {
  id    String @id @default(uuid())
  value String @unique // seed (7): entregada, devuelta, devuelta_origen,
                        //   reprogramada, en_fulfillment, en_ruta_bodega_principal, en_bodega

  ordenes Orden[]

  @@map("order_status")
}
```

`value` como TEXT único (no enum Postgres, por decisión firme del humano):
permite agregar/renombrar estatus por datos sin migrar un tipo. Seed idempotente
por `value` (ver "Seed").

### Geografía jerárquica (4 tablas, vacías)

```prisma
model Zona {
  id     String @id @default(uuid())
  nombre String

  provincias Provincia[]

  @@map("zona")
}

model Provincia {
  id     String @id @default(uuid())
  nombre String
  zonaId String @map("zona_id")

  zona     Zona     @relation(fields: [zonaId], references: [id])
  cantones Canton[]

  @@map("provincia")
  @@index([zonaId])
}

model Canton {
  id          String @id @default(uuid())
  nombre      String
  provinciaId String @map("provincia_id")

  provincia Provincia  @relation(fields: [provinciaId], references: [id])
  distritos Distrito[]

  @@map("canton")
  @@index([provinciaId])
}

model Distrito {
  id       String @id @default(uuid())
  nombre   String
  cantonId String @map("canton_id")

  canton Canton @relation(fields: [cantonId], references: [id])

  @@map("distrito")
  @@index([cantonId])
}
```

Orden de creación (UP): `zona` → `provincia` → `canton` → `distrito`. Orden de
borrado (DOWN): inverso.

**Dependencia operativa conocida (correctitud, R14b).** Como `orden.zona_id`,
`orden.provincia_id` y `orden.canton_id` son FK **NOT NULL** (cambio firme del
humano) y las 4 tablas de geografía se crean **vacías** (sin seed), es imposible
insertar una orden hasta que exista al menos una `zona`, una `provincia` y un
`canton` referenciables. Consecuencias:
- La geografía DEBE poblarse (por importación/administración de datos) antes de
  habilitar la creación de órdenes en producción; queda registrado como
  dependencia operativa, no como bug.
- `distrito_id` es nullable, así que NO bloquea la creación.
- Los **tests de creación de orden DEBEN sembrar filas de geografía en su setup**
  (fixtures: una zona → provincia → canton, opcionalmente distrito) para poder
  ejercitar el CRUD. Sin ese fixture, el `INSERT` viola las FK NOT NULL.

### `orden`

```prisma
model Orden {
  id           String   @id @default(uuid())
  numGuia      Int      @unique @default(autoincrement()) @map("num_guia") // R8/R14: SERIAL
  numRemision  String   @unique @map("num_remision")                      // R9/R14: lo provee el usuario
  estatusId    String   @map("estatus_id")                                // R10: FK not null
  destinatario String
  telefonoDest String   @map("telefono_dest")
  tiendaId     String   @map("tienda_id")                                 // R11: FK -> usuario, not null
  zonaId       String   @map("zona_id")                                   // R12: NOT NULL
  provinciaId  String   @map("provincia_id")                              // R12: NOT NULL
  cantonId     String   @map("canton_id")                                 // R12: NOT NULL
  distritoId   String?  @map("distrito_id")                               // R12: nullable (único FK nullable)
  producto     String
  peso         Decimal  @db.Decimal(10, 3)                                // R13: precisión fija (kg con gramos)
  notas        String?                                                    // R14a: texto nullable
  deletedAt    DateTime? @map("deleted_at")                               // soft delete
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt       @map("updated_at")

  estatus   OrderStatus @relation(fields: [estatusId], references: [id])
  tienda    Usuario     @relation("OrdenTienda", fields: [tiendaId], references: [id])
  zona      Zona        @relation(fields: [zonaId], references: [id])
  provincia Provincia   @relation(fields: [provinciaId], references: [id])
  canton    Canton      @relation(fields: [cantonId], references: [id])
  distrito  Distrito?   @relation(fields: [distritoId], references: [id])

  @@map("orden")
  @@index([tiendaId])
  @@index([estatusId])
  @@index([createdAt])
}
```

**`num_guia` (autoincrement)** se modela como `Int @unique @default(autoincrement())`
→ Prisma lo genera como columna `SERIAL`/`INTEGER` con secuencia Postgres
(`orden_num_guia_seq`). Es un contador monótono asignado por la base de datos al
insertar; el usuario nunca lo envía y su unicidad está garantizada por la
secuencia + índice único (R8, R14). Se expone crudo en el DTO (Nota N3).

**`num_remision`** es `String @unique`: lo provee el usuario en el input, se valida
obligatorio y no vacío en zod, y la unicidad la impone el índice único; una
colisión se traduce a `conflict` (R28).

Se agrega en `Usuario` la relación inversa `ordenesTienda Orden[] @relation("OrdenTienda")`
(edición mínima, sin cambiar columnas de `usuario`).

## Migraciones

Se usan **dos migraciones** para separar catálogos/geografía del modelo `orden`
(cada una con su `down.sql`, patrón del repo):

1. `db/migrations/<ts>_ordenes_catalogos_geografia/`
   - UP: `CREATE TABLE order_status` (+ índice único `value`); `zona`, `provincia`,
     `canton`, `distrito` en ese orden con sus FKs e índices; `ENABLE ROW LEVEL
     SECURITY` en las 5 tablas.
   - DOWN: drop en orden inverso (`distrito`, `canton`, `provincia`, `zona`,
     `order_status`).
2. `db/migrations/<ts>_ordenes/`
   - UP: `CREATE TABLE orden` con `num_guia` como `SERIAL`/secuencia, columnas
     `zona_id`/`provincia_id`/`canton_id` `NOT NULL`, `distrito_id` y `notas`
     `NULL`, índices únicos `orden_num_guia_key`/`orden_num_remision_key`, índices
     `tienda_id`/`estatus_id`/`created_at`, FKs (a `order_status`, `usuario`,
     `zona`/`provincia`/`canton` con `ON DELETE RESTRICT`, `distrito` con
     `ON DELETE SET NULL`), y `ENABLE ROW LEVEL SECURITY`.
   - DOWN: `DROP TABLE orden;` (la secuencia de `num_guia` cae con la columna).

Alternativamente pueden fusionarse en una sola migración si se genera todo junto;
lo relevante (R15/R17) es que cada carpeta de migración tenga su `down.sql` que
revierta exactamente lo suyo, respetando el orden de FKs.

## RLS (Supabase)

`order_status`, `zona`, `provincia`, `canton`, `distrito` y `orden` se acceden solo
desde el servidor (Prisma con service role). Se habilita RLS sin policies para
`anon`/`authenticated` (RLS bloquea todo salvo service role), idéntico a
`usuario`/`rol`/`permiso`. La autorización fina por rol/dueño (R19–R24) vive en
`OrdenService`, no en policies (ver alternativa descartada #2).

## Seed de `order_status`

Réplica EXACTA del patrón `seedRoles`/`ROLES_SEED`:

```ts
// lib/types/order-status.ts  — fuente única de verdad
export const ORDER_STATUS_SEED = [
  "entregada",
  "devuelta",
  "devuelta_origen",
  "reprogramada",
  "en_fulfillment",
  "en_ruta_bodega_principal",
  "en_bodega",
] as const;
```

En `scripts/seed-catalogos.ts` se agrega `seedOrderStatus(prisma)` que itera
`ORDER_STATUS_SEED` con `prisma.orderStatus.upsert({ where: { value }, update: {},
create: { value } })` (idempotente, conserva `id` existentes) y se invoca desde
`main()` junto a `seedTiposIdentificacion`/`seedRoles`. La geografía NO se siembra
(R4).

## Contratos — Server Actions

Resultado discriminado y tipado (R42), estilo `LoginResult`:

```ts
// lib/actions/ordenes.ts  ('use server')

type ActionError =
  | { status: 'validation_error'; fieldErrors: Record<string, string[]> } // R26/R32/R38
  | { status: 'unauthenticated' }                                         // R18
  | { status: 'forbidden' }                                               // R22/R24/R41
  | { status: 'not_found' }                                               // R29/R36/R40
  | { status: 'conflict' };                                               // R28

type CrearOrdenInput = {
  numRemision: string; destinatario: string; telefonoDest: string;
  producto: string; peso: number; estatusId?: string;
  tiendaId?: string;                 // ignorado/forzado para adminTienda (R21/R22)
  zonaId: string; provinciaId: string; cantonId: string; // obligatorios (R12/R26)
  distritoId?: string;               // nullable (R12)
  notas?: string;                    // nullable (R14a)
};
type CrearOrdenResult = { status: 'ok'; orden: OrdenDTO } | ActionError;

type ObtenerOrdenResult = { status: 'ok'; orden: OrdenDTO } | ActionError;

type ListarOrdenesInput = {
  page?: number;            // default 1
  pageSize?: number;        // default DEFAULT_PAGE_SIZE, cap MAX_PAGE_SIZE (R33)
  estatusId?: string;       // filtro (R31)
  sortBy?: 'created_at' | 'num_guia' | 'num_remision'; // lista blanca (R31)
  sortDir?: 'asc' | 'desc';
};
type ListarOrdenesResult =
  | { status: 'ok'; items: OrdenDTO[]; page: number; pageSize: number; total: number } // R30
  | ActionError;

type ActualizarOrdenInput = Partial<Omit<CrearOrdenInput, 'numRemision'>>; // mensajero: solo estatusId (R37)
type ActualizarOrdenResult = { status: 'ok'; orden: OrdenDTO } | ActionError;

type BorrarOrdenResult = { status: 'ok' } | ActionError;
```

`OrdenDTO` expone `id`, `numGuia` (número crudo, N3), `numRemision`, `estatusId`
(+ opcionalmente `estatus.value`), `destinatario`, `telefonoDest`, `tiendaId`,
`zonaId`, `provinciaId`, `cantonId`, `distritoId` (nullable), `producto`, `peso`
(serializado a number/string, no `Decimal` crudo), `notas` (nullable),
`createdAt`, `updatedAt`. Nunca `deletedAt` salvo consumidor autorizado.

Validación: schemas zod en `lib/types/orden.ts` parsean cada input en el borde
(R25/R32). El service recibe datos validados + actor `{ usuarioId, rol }`.

### `OrdenService` (pseudo-contrato)

1. **Autorización por rol** (R19–R24), aplicada antes de cualquier acceso a datos:
   - `maestro`/`admin`: sin restricción de alcance.
   - `adminTienda`: fuerza `tiendaId = actor.usuarioId` en crear; en
     leer/actualizar/borrar exige `orden.tiendaId === actor.usuarioId` (si no,
     `not_found` para lecturas de ajenas / `forbidden` para mutaciones); crear con
     `tiendaId` ajeno explícito → `forbidden` (R22).
   - `mensajero`: crear/borrar → `forbidden`; actualizar acepta solo `estatusId`
     (cualquier otro campo presente → `forbidden`).
2. **crear**: valida existencia de `estatusId` y de FKs de geografía
   (`zonaId`/`provinciaId`/`cantonId` obligatorias, `distritoId` opcional);
   default `estatusId = en_bodega` si ausente (config, N1); delega en repo;
   violación de unicidad de `num_remision` → `conflict` (R28). `num_guia` lo asigna
   la secuencia de la DB.
3. **listar**: aplica filtro/orden de lista blanca + paginación con cap
   (`MAX_PAGE_SIZE`); el repo filtra `deleted_at IS NULL`; para `adminTienda`
   inyecta `tiendaId = actor` en el where. Devuelve `{ items, total }` (R30/R33/R34).
4. **obtener/actualizar/borrar**: resuelven la orden excluyendo borradas
   (R29/R36/R40); `borrar` fija `deleted_at` (R39).

## Paginación y orden del listado (N2)

Offset-based (`page`/`pageSize`) con conteo total, suficiente para la tabla
paginada de la feature 7. `MAX_PAGE_SIZE`/`DEFAULT_PAGE_SIZE` en
`lib/config/ordenes.ts`. Orden por defecto `created_at desc`; campos ordenables/
filtrables restringidos por lista blanca en el schema zod (evita inyección de
columnas).

## Alternativas descartadas

1. **`order_status` como enum Postgres** (`estado_orden`) en vez de tabla catálogo.
   Descartada por decisión firme: los estatus del flujo logístico
   (`reprogramada`, `en_ruta_bodega_principal`, etc.) evolucionan por operación;
   una tabla permite añadir/renombrar por datos + seed idempotente (patrón
   `rol`/`tipo_identificacion`), sin migración de tipo cada vez. Además `orden`
   referencia el catálogo por FK, dando integridad referencial y `id` estable.
2. **Autorización por RLS policies de Postgres** (policies por `tienda_id`/rol) en
   vez de en `OrdenService`. Descartada: el repo accede con service role que
   bypassa RLS, así que las policies no se ejercitarían; la matriz por rol es
   lógica de negocio que pertenece al service testeable sin DB ("Separación de
   capas"). RLS se deja habilitado sin policies solo como defensa en profundidad.
3. **`num_guia` como uuid o string formateado en DB.** Descartada: el requisito
   pide numérico autoincremental; un `SERIAL` con secuencia Postgres garantiza
   monotonicidad y unicidad sin lógica de aplicación. El formateo con ceros a la
   izquierda, si se necesita, se hace en la UI (N3), no en el dato.
4. **Borrado físico (`DELETE`).** Descartada: una orden es entidad de negocio con
   valor de auditoría; el borrado lógico (`deleted_at`) preserva trazabilidad y
   permite excluirlas de listados por defecto (R34).
