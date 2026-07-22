# Feature 107 — Diseño técnico

> Convenciones: `docs/architecture.md` (Controller→Service→Repository, migraciones
> up/down, RLS en tablas nuevas) y `docs/conventions.md`. Los símbolos citados SIN la
> marca **[NUEVO]** existen hoy en el repo; los marcados **[NUEVO]** los crea esta
> feature.

## 1. Modelo de datos

### 1.1 Enum `PlantillaEstado` **[NUEVO]**
Enum Postgres nativo (patrón `EstadoTarifa`/`RolValue` de `db/schema.prisma`), con
`@@map("plantilla_estado")`. Cuatro valores EXACTOS (R23):

```prisma
enum PlantillaEstado {
  activo
  inactivo
  pending
  refused

  @@map("plantilla_estado")
}
```

> Se reservan `pending` (estado inicial, sin productor de la salida `pending → activo`)
> y `refused` (sin productor) en el enum aunque este alcance NO los transicione desde el
> front (patrón "reservar valores del enum" ya usado en `CierreEstado`,
> `WalletMovimientoCategoria`). El front solo emite el destino `inactivo` (R24/R25).

### 1.2 Modelo `PlantillaMensaje` **[NUEVO]**
Tabla `plantilla_mensaje`. Configuración MUTABLE (lleva `updatedAt`), NO es un libro
inmutable. SOFT DELETE vía `deletedAt` (Decisión humana 3; R27/R28). El conjunto de
variables usadas por el cuerpo se persiste como ARRAY de claves (Decisión humana 4;
R15).

```prisma
model PlantillaMensaje {
  id        String          @id @default(uuid())
  nombre    String          @unique          // R10: identificador único
  cuerpo    String                            // texto con placeholders {{clave}}
  variables String[]                          // R15: claves detectadas en el cuerpo (Postgres text[]), sin duplicados, sincronizadas con `cuerpo`
  estado    PlantillaEstado @default(pending) // R12 (Decisión humana 1)
  createdBy String?         @map("created_by") // FK -> usuario (maestro actor); SET NULL al borrar el usuario
  deletedAt DateTime?       @map("deleted_at") // R27: soft delete; NULL = vigente
  createdAt DateTime        @default(now()) @map("created_at")
  updatedAt DateTime        @updatedAt @map("updated_at")

  creador Usuario? @relation("PlantillaMensajeCreador", fields: [createdBy], references: [id], onDelete: SetNull)

  @@index([createdAt])   // R6: orden determinista del listado
  @@index([estado])      // filtro por estado
  @@index([deletedAt])   // R28: filtro de vigentes (deletedAt IS NULL)
  @@map("plantilla_mensaje")
}
```

> **`variables` como `String[]` (Postgres `text[]`) vs `Json`:** se elige `text[]`
> nativo — el dato es una lista de claves homogéneas, `text[]` la indexa/consulta
> mejor y evita el ruido estructural de `jsonb`. Nota de compatibilidad de unicidad de
> `nombre`: al haber soft delete, el índice `UNIQUE(nombre)` es GLOBAL (incluye
> borradas); si se desea reutilizar el nombre de una plantilla eliminada habrá que
> pasar a un índice único parcial `WHERE deleted_at IS NULL` (ver §5 [D6]).

En `Usuario` se añade el lado inverso **[NUEVO]**:
`plantillasCreadas PlantillaMensaje[] @relation("PlantillaMensajeCreador")`.

### 1.3 Migración `db/migrations/<ts>_plantilla_mensaje/` **[NUEVO]**
`migration.sql` (UP), aditiva (no toca tablas existentes):
1. `CREATE TYPE "plantilla_estado" AS ENUM ('activo','inactivo','pending','refused');`
2. `CREATE TABLE "plantilla_mensaje" (...)` con PK, `nombre` UNIQUE, `variables`
   `TEXT[] NOT NULL DEFAULT '{}'`, `estado` DEFAULT `'pending'`, `deleted_at`
   TIMESTAMP(3) NULL, FK `created_by → usuario(id) ON DELETE SET NULL`, `created_at`,
   `updated_at`.
3. Índices `plantilla_mensaje_created_at_idx`, `plantilla_mensaje_estado_idx`,
   `plantilla_mensaje_deleted_at_idx`, índice único `plantilla_mensaje_nombre_key`.
4. `ALTER TABLE "plantilla_mensaje" ENABLE ROW LEVEL SECURITY;` (R30, sin policies →
   solo service role; patrón `api_key`).

`down.sql` (DOWN, R31) revierte exactamente: `DROP TABLE IF EXISTS "plantilla_mensaje";`
(arrastra PK, índices, FK y RLS) seguido de `DROP TYPE IF EXISTS "plantilla_estado";`.

## 2. Catálogo de variables (ABIERTO / data-driven) **[NUEVO]**

Catálogo data-driven en `lib/types/plantilla-variables.ts` (server-safe, importable por
service y UI). Patrón "fuente de verdad TS" de `lib/types/roles.ts`, pero SIN union
type cerrado: `key` es `string`, ampliar es agregar una fila (Decisión humana 4; R13).

```ts
export interface PlantillaVariable {
  key: string;      // clave dentro de {{ }}, formato [a-z0-9_]+
  label: string;    // etiqueta legible para la UI
  ejemplo: string;  // valor de muestra para la vista previa (R18)
}

// Catálogo de variables DISPONIBLES para insertar. ABIERTO: añadir una fila NO obliga
// a migrar código ni tipos. `usuario`/`cod` son solo la SEMILLA de EJEMPLO (no un
// catálogo fijo); el conjunto se amplía libremente.
export const PLANTILLA_VARIABLES = [
  { key: "usuario", label: "Nombre del cliente",  ejemplo: "Juan" },
  { key: "cod",     label: "Código de la orden",  ejemplo: "ABC123" },
] satisfies PlantillaVariable[];

export const PLANTILLA_VARIABLE_KEYS = new Set(PLANTILLA_VARIABLES.map((v) => v.key));
```

- **Sintaxis (R14):** un placeholder es `{{` + espacios opcionales + `clave` + espacios
  opcionales + `}}`, con `clave` = `[a-z0-9_]+`. Regex de extracción:
  `/\{\{\s*([a-z0-9_]+)\s*\}\}/gi`. Una llave doble sin clave o con caracteres fuera del
  set (`{{}}`, `{{ }}`, `{{a b}}`, `{{á}}`) es MALFORMADA (R16).
- **Helpers puros** en `lib/utils/plantilla-mensaje.ts` **[NUEVO]** (sin side effects):
  - `extraerVariables(cuerpo): string[]` — claves bien formadas, normalizadas (trim +
    lowercase), DEDUPLICADAS y en orden de aparición → esto es lo que se persiste en la
    columna `variables` (R15).
  - `validarCuerpo(cuerpo): { ok: true; variables: string[] } | { ok: false; malformadas: string[] }`
    — detecta llaves dobles MALFORMADAS (R16). NO hay lista blanca: cualquier clave bien
    formada se ACEPTA (Decisión humana 4). `variables` es el array a persistir.
  - `renderPlantilla(cuerpo, valores: Record<string,string>): string` — sustituye TODAS
    las ocurrencias de cada placeholder (R18/R19). Para la preview se construye `valores`
    a partir del catálogo (`ejemplo`); una clave bien formada fuera del catálogo cae a un
    marcador derivado (p. ej. `clave.toUpperCase()`), nunca rompe la preview (R18).

## 3. Capas

### 3.1 Tipos + zod `lib/types/plantilla-mensaje.ts` **[NUEVO]**
Patrón `lib/types/usuario.ts` (zod en el borde, `.strict()`):
- `crearPlantillaSchema = z.object({ nombre: z.string().min(1), cuerpo: z.string().min(1) }).strict()`
  — el cliente NO envía `variables`: el service las DERIVA del cuerpo con
  `extraerVariables` y las persiste (R15). La validación de llaves malformadas (R16) es
  de dominio y se hace en el service con `validarCuerpo`, devolviendo `validation_error`
  con `fieldErrors.cuerpo`.
- `actualizarPlantillaSchema = crearPlantillaSchema.partial().strict()` (R20/R22); si el
  cuerpo cambia, el service recalcula `variables`.
- `cambiarEstadoPlantillaSchema = z.object({ estado: z.literal("inactivo") }).strict()`
  — el `z.literal("inactivo")` es lo que rechaza CUALQUIER otro destino
  (`activo`/`pending`/`refused`) (R25). DESACTIVAR es la única transición del front
  (Corrección humana); ACTIVAR (`pending → activo`) no existe en este alcance.
- `listarPlantillasSchema` con `page`/`pageSize` (clamp a `MAX_PAGE_SIZE`), patrón
  `listarUsuariosSchema`.
- DTOs: `PlantillaListItemDTO`, `PlantillaPublica`, y `ActionError` discriminado
  (`validation_error` | `unauthenticated` | `forbidden` | `not_found` | `conflict`)
  reutilizando la forma de `lib/types/usuario.ts`.

### 3.2 Config `lib/config/plantillas.ts` **[NUEVO]**
Patrón `lib/config/usuarios.ts`: `DEFAULT_PAGE_SIZE` (25) y `MAX_PAGE_SIZE` (100)
sobreescribibles por env (`PLANTILLAS_DEFAULT_PAGE_SIZE`, `PLANTILLAS_MAX_PAGE_SIZE`).

### 3.3 Repository `lib/repositories/PlantillaMensajeRepository.ts` **[NUEVO]**
Implementa `IPlantillaMensajeRepository` **[NUEVO]** (`lib/interfaces/repositories/`).
Solo Prisma, sin lógica de negocio ni permisos: `create` (persiste `nombre`, `cuerpo`,
`variables`, `estado='pending'`, `createdBy`), `list({skip,take})` + `count`,
`findById`, `findByNombre` (para unicidad), `update` (incluye recálculo de `variables`),
`updateEstado`, `softDelete` (fija `deletedAt = now()`). TODAS las lecturas
(`list`/`count`/`findById`/`findByNombre`) filtran `deletedAt IS NULL` por defecto
(R28). Traduce la violación de unique de `nombre` a un error de dominio de duplicado
(patrón `UsuarioDuplicadoError` de `IUserRepository`).

### 3.4 Service `lib/services/PlantillaMensajeService.ts` **[NUEVO]**
Implementa `IPlantillaMensajeService` **[NUEVO]** (`lib/interfaces/services/`). Recibe
el repo por constructor (DI). `ALLOWED_ROLES = new Set(["maestro"])` (patrón
`UsuarioService`): toda operación devuelve `forbidden` si el actor no es maestro
(R5). Aplica `validarCuerpo` en crear/actualizar y persiste `variables` derivadas
(R15/R16). Nace en `pending` (R12). Métodos: `crear`, `listar`, `obtener`,
`actualizar`, `cambiarEstado`, `eliminar` (soft delete), `preview`. Resultados
discriminados por `status` (patrón `*ServiceResult` de `IUsuarioService`).

**Máquina de estados (R23/R24/R25/R26)** — la ÚNICA transición expuesta en el front es
DESACTIVAR:

| Acción front | Destino (schema) | Efecto | Estado |
| --- | --- | --- | --- |
| (crear) | — | nace `pending` (R12) | `pending` |
| Desactivar | `inactivo` | fija `estado = inactivo` | `inactivo` |
| Activar (`pending`/`inactivo` → `activo`) | — | FUERA DE ALCANCE (backend futuro) | — |
| Marcar `refused` | — | FUERA DE ALCANCE, sin productor | — |

El schema `z.literal("inactivo")` corta cualquier destino que no sea `inactivo` (R25);
`activo`/`pending`/`refused` no son destinos alcanzables desde el front. Desactivar es
idempotente (fijar `inactivo` sobre `pending`/`inactivo`).

### 3.5 Server Actions `lib/actions/plantillas.ts` **[NUEVO]**
`'use server'`, patrón EXACTO de `lib/actions/usuarios.ts`:
`withErrorHandler` + `resolveActorFromSession` + `UnauthenticatedError` (R4) +
`toActionError`/`toUsuarioActionError`-equivalente, con `deps` inyectables para test
(`{ plantillaService?, getActor? }`). Contratos I/O:

| Action | Entrada | Salida OK | Errores |
| --- | --- | --- | --- |
| `crearPlantilla(input)` | `{nombre,cuerpo}` | `{status:"ok", plantilla}` | validation_error, conflict(`nombre`), unauthenticated, forbidden |
| `listarPlantillas(input)` | `{page?,pageSize?}` | `{status:"ok", items, page, pageSize, total}` | unauthenticated, forbidden |
| `obtenerPlantilla(id)` | `string` | `{status:"ok", plantilla}` | not_found, unauthenticated, forbidden |
| `actualizarPlantilla(id,input)` | `id`, `{nombre?,cuerpo?}` | `{status:"ok", plantilla}` | validation_error, conflict, not_found, unauthenticated, forbidden |
| `cambiarEstadoPlantilla(id,input)` | `id`, `{estado:"inactivo"}` | `{status:"ok", plantilla}` | validation_error (R25), not_found, unauthenticated, forbidden |
| `eliminarPlantilla(id)` | `string` | `{status:"ok"}` (soft delete, R27) | not_found, unauthenticated, forbidden |
| `previewPlantilla(cuerpo)` | `string` | `{status:"ok", texto}` | validation_error, unauthenticated, forbidden |

## 4. Rutas y UI

- **Ruta:** `app/(app)/configuracion/plantillas/page.tsx` **[NUEVO]** — Server
  Component. Autoriza igual que `.../api/page.tsx`: `resolveActorFromSession()`, si
  `actor?.rol !== "maestro"` renderiza el aviso "No tienes permiso…" dentro de
  `AppPage` (R3). Precarga la primera página con `listarPlantillas` y la pasa como
  `initialData` a un módulo cliente (datos sensibles → server, patrón de config).
- **Menú:** en `lib/auth/menu-visibility.ts`, dentro del ítem "Configuración",
  añadir `{ label: "Plantillas", href: "/configuracion/plantillas" }` a `children`
  (R1/R2; la visibilidad la hereda de `roles: ["maestro"]`).
- **Componentes** en `app/(app)/configuracion/plantillas/_components/` **[NUEVO]**
  (viven junto a la página, regla "sin sobre-ingeniería"):
  - `PlantillasModule.tsx` (client) — orquesta listado + acciones, usa `AppPage`.
  - `plantillas-columns.tsx` — columnas de la tabla (patrón `api-keys-columns.tsx`).
  - `CrearPlantillaForm.tsx` / `EditarPlantillaForm.tsx` — formularios con el editor.
  - `VariablesInsert.tsx` — botonera que inserta `{{clave}}` en el cursor (R17) leyendo
    `PLANTILLA_VARIABLES`; muestra un panel de vista previa que llama a `previewPlantilla`.
  - Acción de estado (botón/Switch de shadcn/ui): SOLO "Desactivar" (envía destino
    `inactivo`), visible cuando el estado no es ya `inactivo`, llamando a
    `cambiarEstadoPlantilla` (R24). NO hay acción "Activar" en este alcance;
    `pending`/`activo`/`refused` se muestran como badge informativo de solo lectura y el
    front NUNCA emite un destino distinto de `inactivo`.
- Primitivas: reutilizar shadcn/ui (`Button`, `Input`, `Textarea`, `Switch`, `Badge`,
  `DataTable`); no crear componentes nuevos si ya existen (`docs/architecture.md`).

## 5. Decisiones y alternativas descartadas

- **[D1] Enum Postgres nativo vs. tabla-catálogo.** Los estatus de orden usan una
  TABLA (`order_status`) porque su vocabulario crece con el negocio. Aquí el conjunto
  es CERRADO y conocido (4 valores), como `EstadoTarifa`/`CierreEstado`: se elige enum
  nativo. **Descartado** el catálogo-tabla por sobredimensionar un dominio fijo y
  obligar a un JOIN en cada listado.
- **[D2] SOFT DELETE con `deletedAt`** (Decisión humana 3). Patrón `Tarifa`/`Orden`
  (`deleted_at` + filtro `IS NULL`). **Descartado** el borrado DURO: perdería el rastro
  de plantillas retiradas y su relación `createdBy`. Coste asumido: los listados deben
  filtrar `deletedAt IS NULL` en el repo (R29) y el índice único de `nombre` es global
  (ver [D6]).
- **[D3] Catálogo ABIERTO + array de variables persistido** (Decisión humana 4).
  El cuerpo acepta CUALQUIER `{{clave}}` bien formada; el service DERIVA y persiste las
  claves en la columna `variables` (`text[]`). El catálogo `PLANTILLA_VARIABLES` es solo
  la lista de sugerencias para insertar/preview, ampliable con una fila.
  **Trade-off (abierto vs. validación):** un catálogo cerrado con lista blanca daría
  errores tempranos ante typos (`{{usaurio}}`) pero obliga a migrar código por cada
  variable nueva y choca con el pedido humano. Se elige ABIERTO: se valida solo la FORMA
  (`{{}}`/caracteres inválidos → `validation_error`, R16), NO la pertenencia. El riesgo
  de un placeholder que nunca se resolverá en el envío real se acota en la preview
  (marcador visible en MAYÚSCULAS, R18) y con la ampliación barata del catálogo. Se
  **descarta** persistir un `jsonb` estructurado: la lista de claves homogéneas encaja
  en `text[]`, más simple de consultar.
- **[D4] `estado` en `cambiarEstadoPlantilla` acotado a `z.literal("inactivo")`**
  (Corrección humana). El front SOLO desactiva: el único destino válido es `inactivo`
  (R24/R25). **Descartado** aceptar `["activo","inactivo"]` (o los 4 valores): ACTIVAR
  (`pending → activo`) NO existe en este alcance y abrir el destino `activo`/`pending`/
  `refused` filtraría transiciones de backend futuras a la UI.
- **[D5] Estado inicial `pending`** (Decisión humana 1). Se descarta nacer `activo`
  (una plantilla recién creada no debe estar "viva") e `inactivo`; nace `pending`. En
  este alcance el front solo la puede DESACTIVAR (`→ inactivo`); la salida
  `pending → activo` y el `refused` son transiciones de backend futuras sin productor
  (pregunta abierta 1).
- **[D6] Índice único de `nombre` global vs. parcial.** Con soft delete, `UNIQUE(nombre)`
  impide reusar el nombre de una plantilla eliminada. Se acepta como comportamiento
  inicial (nombre único de por vida). Si se pide reusar nombres liberados, se cambia a
  índice único parcial `WHERE deleted_at IS NULL` (Prisma no lo expresa → SQL a mano en
  la migración, patrón `wallet_movimiento`).
