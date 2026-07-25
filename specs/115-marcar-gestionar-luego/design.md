# Feature 115 — Diseño técnico

> Convenciones: `docs/architecture.md` (Controller→Service→Repository, migraciones
> up/down, RLS en tablas nuevas) y `docs/conventions.md`. Los símbolos citados SIN la
> marca **[NUEVO]** existen hoy en el repo (con `archivo:línea`); los **[NUEVO]** los
> crea esta feature.

## 0. Nota de coordinación 115 / 116 (LEER ANTES)

Esta feature es la **DUEÑA** de la tabla `orden_mensajero_meta` y de su **ÚNICA**
migración. La migración crea la tabla ya con **AMBAS** columnas de una vez:

| Columna        | Tipo                       | La usa | Notas |
| -------------- | -------------------------- | ------ | ----- |
| `usuario_id`   | FK → `usuario(id)`         | 115+116| mensajero dueño de la fila |
| `orden_id`     | FK → `orden(id)`           | 115+116| orden marcada / anotada |
| `marcar_luego` | `boolean NOT NULL DEFAULT false` | **115** | la marca "gestionar más tarde" |
| `nota`         | `text NULL`                | **116** | **nace aquí**, la USA la 116 |
| `UNIQUE(usuario_id, orden_id)` | — | 115+116 | una fila por (mensajero, orden) |

La feature 116 (notas privadas) **NO crea migración ni columna**: la columna `nota` ya
existe tras esta migración. El **modelo Prisma `OrdenMensajeroMeta`** que crea 115
declara `nota String?` para mantener el schema en sincronía con la DB (Prisma exige
reflejar la columna); 116 solo la LEE/escribe. La migración incluye su `down.sql`
inverso (R4). Los símbolos de dominio que 116 reutiliza (repo/servicio/action de meta)
los crea 115 y 116 los EXTIENDE con métodos `nota`, sin tocar la migración.

## 1. Modelo de datos

### 1.1 Modelo `OrdenMensajeroMeta` **[NUEVO]**
Tabla `orden_mensajero_meta`. Fila privada por `(mensajero, orden)`. PK surrogate `id`
uuid + índice `UNIQUE(usuario_id, orden_id)` (patrón `ZonaDistrito`, `db/schema.prisma:336`),
en vez de PK compuesta: el surrogate deja una clave estable para el `upsert` de Prisma
y para que la 116 referencie la fila por id si lo necesita. Ambas FK con
`ON DELETE CASCADE` (patrón `RolPermiso`/`ZonaDistrito`): si se borra el mensajero o la
orden, su meta privada se va con ellos (dato derivado, sin valor huérfano). Lleva
`created_at`/`updated_at` (config mutable, la 116 necesita `updatedAt`).

```prisma
// Feature 115 — meta PRIVADA por (mensajero, orden). `marcar_luego` (115) = "gestionar
// más tarde", solo informativa. `nota` (text NULL) NACE aquí para la feature 116 (notas
// privadas), que NO crea migración. UNIQUE(usuario_id, orden_id): una fila por pareja.
model OrdenMensajeroMeta {
  id          String   @id @default(uuid())
  usuarioId   String   @map("usuario_id")
  ordenId     String   @map("orden_id")
  marcarLuego Boolean  @default(false) @map("marcar_luego") // feature 115
  nota        String?  // feature 116: columna nace aquí (115), la USA la 116
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  usuario Usuario @relation("OrdenMensajeroMetaMensajero", fields: [usuarioId], references: [id], onDelete: Cascade)
  orden   Orden   @relation("OrdenMensajeroMetaOrden",     fields: [ordenId],   references: [id], onDelete: Cascade)

  @@unique([usuarioId, ordenId]) // R1/R7: una fila por (mensajero, orden)
  @@index([usuarioId])           // R17: leer todas las metas del mensajero al listar
  @@index([ordenId])
  @@map("orden_mensajero_meta")
}
```

Lados inversos **[NUEVO]** (edición mínima):
- `Usuario`: `ordenMensajeroMetas OrdenMensajeroMeta[] @relation("OrdenMensajeroMetaMensajero")`.
- `Orden`: `mensajeroMetas OrdenMensajeroMeta[] @relation("OrdenMensajeroMetaOrden")`.

### 1.2 Migración `db/migrations/20260723120000_orden_mensajero_meta/` **[NUEVO]**
`migration.sql` (UP), aditiva (no toca tablas existentes). Timestamp posterior a la
última migración del repo (`20260722150000_...`).

```sql
-- Feature 115 (design §1) + coordinación 116: crea orden_mensajero_meta con AMBAS
-- columnas de una vez. `marcar_luego` (115) y `nota` (nace aquí para 116). Aditiva (R1).
CREATE TABLE "orden_mensajero_meta" (
  "id"           TEXT NOT NULL,
  "usuario_id"   TEXT NOT NULL,
  "orden_id"     TEXT NOT NULL,
  "marcar_luego" BOOLEAN NOT NULL DEFAULT false,   -- R1: 115
  "nota"         TEXT,                              -- R2: NULLABLE, nace aquí para 116
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "orden_mensajero_meta_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "orden_mensajero_meta_usuario_id_fkey" FOREIGN KEY ("usuario_id")
    REFERENCES "usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "orden_mensajero_meta_orden_id_fkey" FOREIGN KEY ("orden_id")
    REFERENCES "orden"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- R1/R7: unicidad de la pareja -> idempotencia del toggle (upsert).
CREATE UNIQUE INDEX "orden_mensajero_meta_usuario_id_orden_id_key"
  ON "orden_mensajero_meta"("usuario_id", "orden_id");

-- R17: leer todas las metas del mensajero al listar; segunda FK indexada.
CREATE INDEX "orden_mensajero_meta_usuario_id_idx" ON "orden_mensajero_meta"("usuario_id");
CREATE INDEX "orden_mensajero_meta_orden_id_idx"   ON "orden_mensajero_meta"("orden_id");

-- R3: RLS habilitada SIN policies (solo service role), patrón api_key/plantilla_mensaje.
-- La autorización de negocio (cada mensajero solo su fila) vive en el service (R8/R12).
ALTER TABLE "orden_mensajero_meta" ENABLE ROW LEVEL SECURITY;
```

`down.sql` (DOWN, R4) revierte exactamente — `DROP TABLE` arrastra la PK, el índice
único, los dos índices normales, las dos FK y la RLS:

```sql
-- DOWN (R4): revierte EXACTAMENTE migration.sql.
DROP TABLE IF EXISTS "orden_mensajero_meta";
```

## 2. Capas (Controller → Service → Repository)

### 2.1 Tipos + zod `lib/types/orden-mensajero-meta.ts` **[NUEVO]**
Patrón `lib/types/gestion-orden.ts` (zod en el borde, resultados discriminados por
`status`):

```ts
export const marcarLuegoSchema = z.object({
  ordenId: z.string().min(1),
  marcarLuego: z.boolean(),        // R9: valor EXPLÍCITO (no un flip ciego), idempotente
});

export type MarcarLuegoResult =
  | { status: "ok"; ordenId: string; marcarLuego: boolean }
  | { status: "unauthenticated" }  // R10
  | { status: "forbidden" }        // R11/R13
  | { status: "not_found" }        // R14
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }; // R9
```

### 2.2 Repository `OrdenMensajeroMetaRepository` **[NUEVO]**
Implementa `IOrdenMensajeroMetaRepository` **[NUEVO]** (`lib/interfaces/repositories/`).
Solo Prisma, sin lógica de negocio ni permisos:
- `upsertMarcarLuego(usuarioId, ordenId, marcarLuego): Promise<void>` — `prisma.ordenMensajeroMeta.upsert`
  con `where: { usuarioId_ordenId: { usuarioId, ordenId } }`; `create` fija
  `marcarLuego`, `update` solo `marcarLuego`. Idempotente por el `UNIQUE` (R5/R6/R7).
- `findMarcarLuegoByMensajero(usuarioId): Promise<Set<string>>` — devuelve el conjunto de
  `ordenId` con `marcarLuego = true` del mensajero (para la lectura del listado, R17).

> La 116 EXTENDERÁ esta misma interfaz/repo con `upsertNota` / `findNotasByMensajero`
> sobre la misma tabla (columna `nota`). 115 no los crea.

### 2.3 Service `OrdenMensajeroMetaService` **[NUEVO]**
Implementa `IOrdenMensajeroMetaService` **[NUEVO]**. Recibe el meta-repo y el
`OrdenRepository` (solo lectura, para la guarda de propiedad) por constructor (DI).
`ALLOWED_ROL = "mensajero"`. Método:

```
marcarGestionarLuego(input, actor): Promise<MarcarLuegoResult>
  1. if actor.rol !== "mensajero" -> { forbidden }                 // R11
  2. cargar orden por id (findByIdParaGestion o equivalente):
       - no existe / borrada         -> { not_found }              // R14
       - mensajeroAsignadoId != actor -> { forbidden }             // R13
  3. repo.upsertMarcarLuego(actor.usuarioId, input.ordenId, input.marcarLuego)  // R5/R6/R8
       (usuario_id SIEMPRE = actor.usuarioId; nunca del input)     // R8/R12
  4. { ok, ordenId, marcarLuego }
```

NO toca `orden.estatusId`, `orden.prioridad`, la ruta ni el historial de estados (R15/R16):
el service solo escribe en `orden_mensajero_meta`.

### 2.4 Server Action `lib/actions/orden-mensajero-meta.ts` **[NUEVO]**
`'use server'`, patrón EXACTO de `lib/actions/mis-asignaciones.ts:127-140`
(`withErrorHandler` + `resolveActorFromSession` + `UnauthenticatedError` en el borde +
`isAppErrorShape` → traductor de `VALIDATION_ERROR`/`UNAUTHORIZED`; `forbidden`/`not_found`
los devuelve el service como resultado de dominio). `deps` inyectables para test
(`{ service?, getActor? }`).

| Action | Entrada | Salida OK | Errores |
| --- | --- | --- | --- |
| `marcarGestionarLuego(input)` | `{ ordenId, marcarLuego }` | `{status:"ok", ordenId, marcarLuego}` | validation_error (R9), unauthenticated (R10), forbidden (R11/R13), not_found (R14) |

Es una **mutación interna del mismo proyecto → Server Action, no Route API**
(`docs/architecture.md` §Server Actions vs Route Handlers).

## 3. Lectura (reflejo en el listado del mensajero)

### 3.1 `MiAsignacionDTO` += `marcarLuego: boolean` (edición mínima)
`lib/interfaces/services/IMisAsignacionesService.ts` — se agrega `marcarLuego: boolean`
al DTO (R17). `MisAsignacionesService.toDTO` lo inicializa en `false`.

### 3.2 `MisAsignacionesService.listarMisAsignaciones` (edición mínima)
Se inyecta el `IOrdenMensajeroMetaRepository` en el constructor y se suma una entrada al
`Promise.all` existente (`lib/services/MisAsignacionesService.ts:114`):
`metaRepo.findMarcarLuegoByMensajero(actor.usuarioId)` → `Set<ordenId>`. Al construir
cada DTO se hace `marcarLuego: metas.has(row.id)` (mismo patrón que las `secuencias` de la
feature 92, `MisAsignacionesService.ts:124/134`). Solo se leen las filas del PROPIO actor
(R20). `lib/actions/mis-asignaciones.ts:65-80 buildService()` se amplía para pasar el
nuevo repo (una línea).

> **Reordenado (R19):** el service NO cambia su orden (sigue mandando la secuencia de ruta
> de la 92). El "hundir al final" de las marcadas es **presentación** y se hace en el
> cliente (§4), para no pelear con el `sort` por secuencia de ruta ni tocar la ruta
> persistida.

## 4. UI (badge + toggle + orden visual)

- **`MisAsignacionesModule`** (`app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx`)
  — sobre la grilla "En reparto / por gestionar" (`porGestionar`, línea 296):
  - **Badge (R18):** cuando `orden.marcarLuego`, la card muestra un `Badge`
    (`components/ui/badge`, ya importado) "Gestionar más tarde" (junto al de "Pendiente de
    optimizar").
  - **Orden visual (R19):** un `useMemo` deriva la lista mostrada aplicando un `sort`
    ESTABLE secundario que hunde las `marcarLuego` al final, DESPUÉS del orden por ruta que
    ya llega del server (JS `sort` estable desde ES2019, mismo argumento que
    `MisAsignacionesService.ts:145`). No muta `porGestionar` ni la ruta.
  - **Toggle (R5/R6):** un control **[NUEVO]** `MarcarLuegoToggle.tsx` en la card llama a
    `marcarGestionarLuego({ ordenId, marcarLuego: !orden.marcarLuego })` y hace
    `router.refresh()` (patrón de las demás mutaciones del módulo). Sin toast en el happy
    path; error → `useToast().error`.
- El resto del módulo (recoger/escoger/gestionar/mapa) queda intacto.

## 5. Autorización y seguridad (resumen)
- **Página:** `app/(app)/mis-asignaciones/page.tsx` ya limita el módulo a rol `mensajero`
  server-side (`notFound()`), sin cambios.
- **Server Action:** `unauthenticated` sin sesión (R10), `forbidden` si el rol no es
  mensajero (R11) o la orden no es del actor (R13), `not_found` si no existe (R14).
- **`usuario_id` no falsificable (R8/R12):** siempre `actor.usuarioId`; el input solo
  aporta `ordenId` y `marcarLuego`. Un mensajero no puede escribir la fila de otro porque
  el `where` del upsert fija `usuario_id = actor.usuarioId`.
- **RLS (R3):** habilitada sin policies (solo service role), como `plantilla_mensaje`/`api_key`.

## 6. Decisiones y alternativas descartadas

- **[D1] Tabla `orden_mensajero_meta` por-(mensajero, orden) vs. columna en `orden`
  (DESCARTADA).** Se evaluó añadir `orden.marcar_luego` directamente a la tabla `orden`.
  **Descartada:** la marca es **privada y distinta por mensajero** (R12/R20); una columna
  en `orden` sería un valor ÚNICO y COMPARTIDO por quien vea la orden, imposible de acotar
  por `usuario_id`, y filtraría la marca de un mensajero a otros roles. Además obligaría a
  alterar la tabla `orden` (caliente) y a mezclar dato privado del mensajero con dato de
  negocio de la orden. La tabla puente `(usuario_id, orden_id)` con `UNIQUE` es la forma
  correcta de un atributo N:1 privado por usuario, y además es la que la 116 necesita para
  la `nota`.
- **[D2] `upsert` con valor EXPLÍCITO vs. flip leído-luego-escrito (DESCARTADA).** El
  toggle recibe `marcarLuego: boolean` (el valor deseado) y hace `upsert`, en vez de leer
  la fila y escribir su negación. **Descartada** la lectura-y-flip: introduce una carrera
  (dos toggles concurrentes podrían anularse) y no es idempotente ante reintentos; el
  upsert con valor explícito es idempotente y seguro ante concurrencia (R7).
- **[D3] PK surrogate `id` + `@@unique([usuarioId, ordenId])` vs. PK compuesta
  `@@id([usuarioId, ordenId])` (RolPermiso).** Se elige surrogate (patrón `ZonaDistrito`):
  clave estable para el `upsert` y para que la 116 pueda referenciar la fila por `id` si lo
  requiere. La PK compuesta también funcionaría; se documenta como alternativa equivalente
  no elegida para no arrastrar una PK de dos columnas a la relación de la 116.
- **[D4] Reordenado en el cliente vs. en el service.** El "hundir al final" (R19) se hace
  en el cliente para NO competir con el `sort` por secuencia de ruta de la feature 92
  (server-side) ni alterar la ruta persistida. Descartado reordenar en el service: mezclaría
  un criterio de presentación privado del mensajero con el orden autoritativo de la ruta.
