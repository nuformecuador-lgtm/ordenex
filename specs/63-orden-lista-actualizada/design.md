# Feature 63 — Orden lista actualizada · design.md

> El CÓMO técnico. Decisiones sujetas a las respuestas F1.4 de `requirements.md`;
> aquí se documenta la opción recomendada y su justificación.

## 1. Alcance y capas afectadas

| Capa | Archivo (existente / nuevo) | Cambio |
| --- | --- | --- |
| Action (catálogo) | `lib/actions/order-status.ts` (**nuevo**) | Server Action `listarOrderStatus()` |
| Interfaces | `lib/interfaces/repositories/IOrdenRepository.ts` | Reusa `listOrderStatus()` + `OrderStatusLiteRow` (ya existen) |
| Repository | `lib/repositories/OrdenRepository.ts` | Reusa `listOrderStatus()`; añade orden determinista si falta |
| Tipos/validación | `lib/types/orden.ts` | Añade `filter` (zod) a `listarOrdenesSchema` + whitelist |
| Service | `lib/services/OrdenService.ts` | Traduce `filter` whitelisteado a `where` |
| Repo (filtro) | `IOrdenRepository` / `OrdenRepository` (`list`) | `where` ya soporta `estatusId`; sin cambio de forma |
| UI primitiva | `components/ui/tabs.tsx` (**nuevo**) | `npx shadcn add tabs` |
| UI componente | `app/(app)/ordenes/_components/OrdenesTabs.tsx` (**nuevo**) | Tabs + lazy loading sobre `OrdenesModule` |
| UI wiring | `app/(app)/ordenes/page.tsx` / `OrdenesModule.tsx` | Monta las tabs para roles ≠ mensajero |

Sin tabla nueva, sin migración de datos: las migraciones de catálogo
(`20260714140000_*`, `20260714150000_*`) YA están en la rama. No se toca RLS
(no hay tabla nueva); `order_status` es catálogo de solo lectura.

## 2. Endpoint `order_status` (R1–R5)

Server Action (recomendación F1.4-a), patrón de `docs/architecture.md`
(mutaciones/lecturas internas via `lib/actions/`, no route handler):

```ts
// lib/actions/order-status.ts  ('use server')
export async function listarOrderStatus(
  deps: { getActor?; ordenRepo?: Pick<IOrdenRepository,"listOrderStatus"> } = {},
): Promise<ListarOrderStatusResult>
```

- Resuelve actor con `resolveActorFromSession` (patrón de `lib/actions/ordenes.ts`).
- Sin sesión → `unauthenticated` (R3). Rol `mensajero`/desconocido → `forbidden`
  (R4). `maestro`/`admin`/`adminTienda`/`adminSatelite` → `ok` (R2).
- Resultado tipado discriminado (patrón feature 10 / `ActionError`):
  `{ status: "ok"; estatus: OrderStatusLiteRow[] } | { status: "unauthenticated" } | { status: "forbidden" }`.
- Reusa `OrdenRepository.listOrderStatus()` (ya existe). Se añade
  `orderBy` determinista (p. ej. por `value`) para R5 si el `findMany` actual no
  lo garantiza.

Contrato I/O:

```
IN:  ()  (solo cookies de sesión)
OUT: { status:"ok", estatus:[{ id:string, value:string }, ...] }
```

Nota: NO se reutiliza `listarCatalogoEstatus()` (feature 17) porque su
autorización está fijada a `maestro`/`admin`; relajarla cambiaría la semántica de
esa feature. Acción nueva, autorización propia (F1.4-a).

## 3. Filtro genérico `filter` en `listarOrdenes` (R6–R11)

### 3.1 Borde (zod, `lib/types/orden.ts`)

`listarOrdenesSchema` gana un campo opcional `filter`. La whitelist se modela como
un objeto zod con claves conocidas (NO `z.record` abierto), de modo que una clave
extraña produce `validation_error` (R7/R11):

```ts
export const ORDEN_FILTER_FIELDS = ["status_id"] as const; // whitelist v1 (R8)

const ordenFilterSchema = z
  .object({ status_id: z.string().min(1).optional() })
  .strict(); // .strict() => clave fuera de whitelist -> ZodError -> validation_error

// en listarOrdenesSchema:
filter: ordenFilterSchema.optional(),
```

`.strict()` es la clave de R7: rechaza campos no listados sin llegar a Prisma.
El `estatusId` escalar preexistente se conserva (R10, sin regresión).

### 3.2 Traducción a `where` (`OrdenService.listar`)

El service mapea la whitelist a columnas Prisma (mapa explícito, nunca la clave
cruda como nombre de columna):

```ts
const FILTER_TO_COLUMN = { status_id: "estatusId" } as const;
// where.estatusId = filter.status_id ?? input.estatusId  (filter tiene precedencia)
```

Se compone con el alcance por rol ya existente (`adminTienda` → `where.tiendaId`,
R9). El repositorio `list({ where })` ya acepta `estatusId`; no cambia su forma.

### 3.3 Precedencia

Si llegan `filter.status_id` y `estatusId` escalar, gana `filter.status_id`
(fuente explícita de la feature). Documentado en el test.

## 4. UI: componente de tabs con lazy loading (R12–R20)

### 4.1 Primitiva

`components/ui/tabs.tsx` vía `npx shadcn add tabs` (Radix `@radix-ui/react-tabs`).
No se crea a mano (regla de `docs/architecture.md`: primero shadcn).

### 4.2 `OrdenesTabs` (nuevo, cliente)

- Recibe `exclude: string[]` (por `value`, F1.4-c; default `["pendiente"]`).
- Fetch del catálogo con SWR sobre `listarOrderStatus()`; deriva
  `tabs = catálogo.filter(s => !exclude.includes(s.value))` (R14).
- Renderiza `Tabs` / `TabsList` / `TabsTrigger` (una por estado) + `TabsContent`.
- Estado `activeValue`. Cada `TabsContent` monta el contenido de su tab SOLO
  cuando es el activo o ya fue visitado (set `visited`): las no visitadas NO
  renderizan el módulo de datos → NO consultan (R16, requisito duro).
- Por tab activa se renderiza `OrdenesModule` (reuso, R19) parametrizado con el
  `status_id` de esa tab; `OrdenesModule` gana una prop opcional
  `filter?: { status_id: string }` que inyecta al `listarOrdenes` y a la **key
  SWR** (`["ordenes:list", statusId, page, pageSize]`), de modo que cada tab tiene
  su propia caché y paginación independiente (R15/R17, F1.4-e cache).
- `TabsList` con `overflow-x-auto` (scroll horizontal) para ~13 tabs (R18, F1.4-g).

### 4.3 Wiring por rol (`page.tsx`)

`maestro`/`admin`/`adminTienda` (y `adminSatelite` según F1.4-h) → `OrdenesTabs`
con `exclude` por rol. `mensajero` → sin cambios, sigue en `/mis-asignaciones`
(R20). La resolución de rol es server-side (`resolveActorFromSession`), patrón ya
usado en `ordenes/page.tsx`.

### 4.4 Etiqueta de la tab

Se usa el helper de display existente (`estatus-label.ts` / `EstatusBadge`) para
mostrar el nombre legible del estado, no el `value` crudo.

## 5. Alternativa descartada (obligatoria)

**Descartada: `filter` como `z.record(z.string(), z.string())` abierto, traducido
genéricamente a `where[campo] = valor`.**
Era más corto (sin whitelist ni mapa), pero permite que el cliente inyecte
cualquier nombre de columna al `WHERE` de Prisma (p. ej. filtrar por
`deletedAt`, `tiendaId` de otra tienda, o columnas internas), rompiendo el
alcance por rol y exponiendo datos. Viola "borde tipado" y "sin columnas
arbitrarias" de `docs/architecture.md`. Elegimos la whitelist `.strict()` con
mapa explícito clave→columna (R7/R11): coste marginal, cierra la inyección de
columnas y mantiene el control de autorización en el service.

**Segunda alternativa descartada (UI): renderizar todas las tabs con su
`OrdenesModule` montado y solo ocultarlas con CSS.**
Es lo que hace el patrón naíf de tabs, pero cada `OrdenesModule` oculto dispararía
su SWR al montar → N consultas simultáneas (una por estado) en el primer render,
violando R16. Elegimos montaje diferido por tab visitada (`visited` set), que
garantiza que las tabs nunca vistas no consultan.

## 6. Riesgos / notas

- Nombre real de la FK es `estatus_id`/`estatusId`; la clave pública del filtro es
  `status_id` (lo que pide la feature). El mapa `FILTER_TO_COLUMN` es el único
  punto que conoce ambas — no filtrar el nombre interno al cliente.
- El catálogo tiene ~14 estados; ~13 tabs tras excluir `pendiente`. Confirmar UX
  responsive (F1.4-g).
- Autorización del catálogo (R2) difiere de `listarCatalogoEstatus` (17): son dos
  acciones distintas a propósito.
