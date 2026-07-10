# design.md — ordenes: carga masiva - etapa 2 (feature 16)

## Enfoque general

Feature POST-COMMIT: las órdenes YA existen (`en_preparacion`, feature 15). Esta
etapa añade, en el orden de implementación **backend → frontend**:

1. **Backend** — un método de listado de mensajeros en el repo de usuarios, un
   servicio de asignación cohesivo (listar mensajeros + resumen del lote + asignar
   `mensajero_sugerido_id`), sus métodos de repositorio de órdenes y las Server
   Actions que los exponen con el manejador de errores de feature 10.
2. **Frontend** — una vista de resumen (`DataTable`) con `num_remision` visible, un
   `select` global "aplicar a todos" + override por fila, y la confirmación que
   dispara la asignación con toasts.

Se respeta el patrón Controller (Server Action) → Service → Repository de
`docs/architecture.md`, con inyección por interfaces para poder testear sin DB.

Capas nuevas / tocadas:

```
lib/interfaces/repositories/IUserRepository.ts         (ext) + listMensajeros()
lib/repositories/UserRepository.ts                     (ext) + listMensajeros()
lib/interfaces/repositories/IOrdenRepository.ts        (ext) + findResumenByNumRemisiones(), asignarMensajeroSugerido()
lib/repositories/OrdenRepository.ts                    (ext) idem
lib/interfaces/services/IAsignacionMensajeroService.ts (nuevo)
lib/services/AsignacionMensajeroService.ts             (nuevo) listarMensajeros / resumenCargaMasiva / asignarMensajeroSugerido
lib/types/asignacion-mensajero.ts                      (nuevo) schemas zod + DTOs (MensajeroDTO, ResumenCargaOrdenDTO)
lib/actions/mensajeros.ts                              (nuevo) Server Actions
components/ui/select.tsx                                (nuevo) primitiva Select (@base-ui/react)
app/(app)/ordenes/_components/OrdenesCargaResumen.tsx  (nuevo) vista resumen + asignación
app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx (ext) enruta paso 1 (subida) → paso 2 (resumen)
```

**Sin migración:** `orden.mensajero_sugerido_id` (`String?`) y la relación
`mensajeroSugerido` (`@relation("OrdenMensajeroSugerido")`) YA existen en
`db/schema.prisma` (feature 15), con `@@index([mensajeroSugeridoId])` y FK
`ON DELETE SET NULL`. RLS de `orden`/`usuario` intacta; acceso server-side vía
Prisma service role (R20).

## Modelo de datos y DTOs

No hay cambios de esquema. DTOs nuevos en `lib/types/asignacion-mensajero.ts`:

```ts
export interface MensajeroDTO { id: string; nombre: string }            // R1/R2

export interface ResumenCargaOrdenDTO {                                 // R6
  id: string;
  numGuia: number;
  numRemision: string;
  destinatario: string;
  telefonoDest: string;
  producto: string;
  montoCobrar: number | null;      // Decimal -> number (o null)
  direccion: string | null;
  estatusValue?: string;
  mensajeroSugeridoId: string | null;
  mensajeroSugeridoNombre: string | null;  // via relación mensajeroSugerido.nombre
}

// R6/R7: input del resumen (borde validado con zod)
export const resumenCargaSchema = z.object({
  numRemisiones: z.array(z.string().min(1)).min(1).max(<MAX_ROWS de cargaMasivaConfig>),
});

// R12/R13/R18: input de asignación
export const asignarMensajeroSchema = z.object({
  asignaciones: z.array(z.object({
    ordenId: z.string().min(1),
    mensajeroId: z.string().min(1),
  })), // vacío permitido (R18: no-op)
});
```

> Nota: se elige un `ResumenCargaOrdenDTO` **propio** en vez de ampliar `OrdenDTO`
> para no alterar el contrato del CRUD (feature 6/7) ni sus tests. `toDTO` de
> `OrdenRepository` permanece intacto.

## Backend

### Repositorio de usuarios (`IUserRepository` / `UserRepository`)

Nuevo método (R2/R3):

```ts
listMensajeros(): Promise<MensajeroDTO[]>;
// prisma.usuario.findMany({
//   where: { rol: { value: "mensajero" }, estado: "activo" },  // [ABIERTO-1]
//   select: { id: true, nombre: true },
//   orderBy: { nombre: "asc" },
// })
```

Solo proyecta `id`/`nombre` (nunca hash/PII, R1). El filtro `rol.value` reutiliza el
mismo criterio ya usado por `OrdenRepository.findMensajerosByIds`.

### Repositorio de órdenes (`IOrdenRepository` / `OrdenRepository`)

Dos métodos nuevos (batch, scoping por tienda y `deletedAt`):

```ts
// R6/R8/R10: filas del resumen, solo tienda del actor y no borradas.
findResumenByNumRemisiones(nums: string[], tiendaId: string): Promise<ResumenCargaOrdenDTO[]>;
// where: { numRemision: { in: nums }, tiendaId, deletedAt: null }
// include: { estatus: { select: { value } }, mensajeroSugerido: { select: { nombre } } }
// mapea Decimal montoCobrar -> number|null

// R15/R16: actualiza mensajero_sugerido_id por lote; devuelve filas afectadas.
asignarMensajeroSugerido(ordenIds: string[], mensajeroSugeridoId: string, tiendaId: string): Promise<number>;
// prisma.orden.updateMany({
//   where: { id: { in: ordenIds }, tiendaId, deletedAt: null },
//   data: { mensajeroSugeridoId },
// }).count
```

> Se usa `updateMany` (no el `update`/`toUpdateData` existente) porque `UpdateOrdenData`
> hoy **no** incluye `mensajeroSugeridoId` y ampliarlo abriría el CRUD genérico a
> mutar ese campo por rol; un método dedicado y acotado por tienda es más seguro y
> testeable (R15/R16).

### Servicio de asignación (`AsignacionMensajeroService`)

Implementa `IAsignacionMensajeroService`, depende de `IUserRepository` +
`IOrdenRepository` (inyección por constructor). Resultados discriminados de dominio
(patrón `IOrdenService`), traducidos a `ActionError` en el borde.

```ts
listarMensajeros(actor): Promise<{ status:"ok"; mensajeros: MensajeroDTO[] } | { status:"forbidden" }>;
resumenCargaMasiva(input, actor): Promise<{ status:"ok"; ordenes: ResumenCargaOrdenDTO[] } | { status:"forbidden" }>;
asignarMensajeroSugerido(input, actor):
  Promise<{ status:"ok"; asignadas:number }
        | { status:"validation_error"; fieldErrors } | { status:"forbidden" }>;
```

Reglas de autorización (alineadas con `OrdenService`/`BulkOrdenService`):

- `listarMensajeros`: rol ∈ {`adminTienda`, `maestro`, `admin`} → `ok`; otro →
  `forbidden` (R5, **[ABIERTO-2]**).
- `resumenCargaMasiva` y `asignarMensajeroSugerido`: SOLO `adminTienda`, sobre su
  propia tienda (`tiendaId = actor.usuarioId`); otro rol → `forbidden`
  (R11/R17, **[ABIERTO-5]**).

Lógica de `asignarMensajeroSugerido` (R12–R18):

1. Autoriza (adminTienda). Si `asignaciones` vacío → `ok` con `asignadas: 0` (R18).
2. Valida mensajeros: `repo.findMensajerosByIds(distinct(mensajeroIds))`; si algún
   `mensajeroId` no está en el `Set` → `validation_error`
   (`fieldErrors.mensajeroId`), sin persistir (R13).
3. Verificación de tienda (**[ABIERTO-5]**, default todo-o-nada): carga las órdenes
   objetivo de la tienda del actor y confirma que **todas** las `ordenId` solicitadas
   pertenecen a ella; si alguna no → `forbidden`, sin persistir (R14).
4. Agrupa `ordenIds` por `mensajeroId` distinto y llama
   `repo.asignarMensajeroSugerido(ids, mensajeroId, actor.usuarioId)` una vez por
   grupo (R15). Suma los counts → `asignadas`.

### Server Actions (`lib/actions/mensajeros.ts`)

`'use server'`, patrón exacto de `lib/actions/ordenes.ts`: `withErrorHandler` +
`resolveActorFromSession` + `UnauthenticatedError` + zod parse en el borde +
`toActionError` (se **extrae** `toActionError` de `ordenes.ts` a un helper
compartido, p. ej. `lib/actions/_shared/to-action-error.ts`, para no duplicarlo).

```ts
export async function listarMensajeros(deps?): Promise<{status:"ok"; mensajeros:MensajeroDTO[]} | ActionError>;
export async function resumenCargaMasiva(input, deps?): Promise<{status:"ok"; ordenes:ResumenCargaOrdenDTO[]} | ActionError>;
export async function asignarMensajeroSugerido(input, deps?): Promise<{status:"ok"; asignadas:number} | ActionError>;
```

Cada una: resuelve actor (401 si null, R4/R17/R19), valida input con zod
(ZodError → VALIDATION_ERROR), instancia el servicio con Prisma real (fábrica local,
inyectable por `deps` para tests).

## Frontend

### Ubicación del resumen (**[ABIERTO-6]**, default)

Segundo **paso dentro del modal existente** de la feature 14. `OrdenesCargaMasivaButton`
mantiene un estado de paso: `"upload"` (muestra `BulkUpload`) → al `onSuccess` con
`creadas > 0`, extrae `numRemisiones = filas.filter(f => f.resultado==="creada").map(f=>f.numRemision)`
y pasa a `"resumen"`, renderizando `<OrdenesCargaResumen numRemisiones={...} onDone={...}/>`
en el cuerpo del mismo `Modal`. Si `creadas === 0`, se conserva el comportamiento de
feature 14 (solo toast). Justificación: un único punto de entrada, reutiliza `Modal`
(async, focus-trap) y evita una ruta/segunda vista; el usuario asigna mensajero en el
mismo flujo, inmediatamente tras cargar.

### `OrdenesCargaResumen` (nuevo, `_components/`)

- Al montar, obtiene datos vía Server Actions (SWR o `useEffect`+estado):
  `resumenCargaMasiva({ numRemisiones })` → filas; `listarMensajeros()` → opciones
  del select (R31). Maneja loading/error (select deshabilitado / aviso).
- Render con `DataTable` (R22/R34): columnas `num_remision` (visible, R23),
  `destinatario`, `telefono`, `producto`, `estatus`, y **`mensajero`** cuyo `render`
  es una función `(row) => <Select .../>` por fila. `rowKey="id"` (R23).
- **Select global** (fuera de la tabla, encabezado del resumen): "Asignar mensajero a
  todas". `onChange` → setea el estado seleccionado de todas las filas (R24/R25).
- **Override por fila:** cada `Select` de fila refleja `seleccion[row.id]`
  (inicializado con `row.mensajeroSugeridoId`, R27); su `onChange` actualiza solo esa
  fila (R26).
- **Confirmar:** botón/`onConfirm` del `Modal` (async, R30). Construye
  `asignaciones = filas.filter(tiene mensajero).map(row => ({ ordenId: row.id, mensajeroId: seleccion[row.id] }))`
  y llama `asignarMensajeroSugerido({ asignaciones })`. Éxito → `toast.success` +
  `mutate(["ordenes:list", …])` (R28/R33); fallo/`status!=="ok"` → `toast.error` (R29).

Estado del select seleccionado por fila: `Record<ordenId, mensajeroId | "">`.
Global y overrides se resuelven en cliente; el backend solo recibe las asignaciones
finales (cubre "AMBOS" con una sola acción, decisión humana 2).

### Componente `Select` (**[ABIERTO-7]**, default)

Nuevo `components/ui/select.tsx` sobre `@base-ui/react/select` (precedente de `Modal`
y `Toast`, ya en `dependencies`), con nombre accesible y navegación por teclado
(R32). Props mínimas: `value`, `onValueChange`, `options: {value,label}[]`,
`placeholder`, `disabled`, `aria-label`. *Alternativa:* `npx shadcn add select`
(ver más abajo).

## Alternativa de diseño descartada

**Mostrar el resumen y asignar desde el `BulkSummary` en cliente, sin backend nuevo,
identificando el lote por `estatusId = en_preparacion` con `listarOrdenes`.**

Descartada por dos razones:

1. **Identificación imprecisa del lote.** Como feature 15 fija `en_preparacion` como
   default GLOBAL, filtrar por ese estatus incluiría órdenes de **cargas anteriores**
   aún sin procesar, no solo el lote recién subido. Filtrar por los `num_remision`
   `creada` del `BulkSummary` es exacto (R7).
2. **Faltan datos para asignar.** El `BulkSummary.filas` solo trae
   `{ fila, numRemision, resultado, estatus, errores }`: **no** incluye el `id` de la
   orden (necesario para persistir `mensajero_sugerido_id`) ni los campos de negocio
   para el resumen "columna por columna". Además la asignación DEBE validarse server-
   side (mensajero con rol correcto, pertenencia a la tienda) — no puede resolverse
   solo en cliente. Por eso se añade `resumenCargaByNumRemisiones` + la acción de
   asignación con autorización.

Adicional descartada — **`npx shadcn add select`**: traería la primitiva de Radix UI
como dependencia nueva, mientras que el repo ya estandarizó sus overlays/portales en
`@base-ui/react` (`Modal`, `Toast`). Se prefiere consistencia y no duplicar librerías
de UI headless; por eso el default es construir el `Select` sobre `@base-ui/react`.

## Verificación (resumen)

- Unit servicio: autorización (R5/R11/R17), validación de mensajero (R13),
  todo-o-nada por tienda (R14), agrupación por lote (R15), no-op vacío (R18).
- Unit repos: `listMensajeros` filtra rol/estado y proyecta id/nombre (R2/R3);
  `findResumenByNumRemisiones` scoping tienda/deletedAt y unicidad (R8/R10);
  `asignarMensajeroSugerido` scoping y count (R16).
- Integración acción: 401 sin sesión, forbidden por rol, VALIDATION_ERROR por zod,
  mapeo `toActionError` (R4/R19).
- Componente: resumen con `DataTable` + `num_remision` visible (R22/R23), select
  global aplica a todas (R24/R25), override por fila (R26/R27), confirmar →
  `asignarMensajeroSugerido` + toast + mutate (R28/R33), fallo → toast error (R29),
  bloqueo durante envío (R30), carga de mensajeros por Server Action (R31).
