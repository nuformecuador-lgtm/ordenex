# Feature 116 — Mensajero: notas privadas por orden · design.md

> El CÓMO técnico. **SIN migración propia** (la tabla y la columna las crea la feature 115; ver
> §2). Capas: Controller (Server Action) → Service → Repository, como en la feature 36
> (`mis-asignaciones`). En implementación, 116 se ejecuta DESPUÉS de que 115 esté `done` porque
> comparten la tabla `orden_mensajero_meta` y la ruta de lectura del DTO (§6).

---

## 1. Resumen de la decisión

La nota privada del mensajero es un texto libre por `(mensajero, orden)`, almacenado en la columna
`nota text NULL` de la tabla `orden_mensajero_meta` (feature 115). 116 aporta SOLO:

1. **Escritura** — dos Server Actions (`guardarNotaPrivada` / `limpiarNotaPrivada`) → un service
   con authz por mensajero → dos métodos de upsert/limpieza en el repositorio de la tabla meta
   (el que 115 introduce). El upsert PRESERVA `marcar_luego`; "limpiar" hace `nota = NULL` sin
   borrar la fila.
2. **Lectura** — se añade `notaPrivada: string | null` al DTO de "mis asignaciones", tomándolo del
   MISMO JOIN filtrado por `usuario_id` que 115 introduce en `findMisAsignaciones` (una sola query).
3. **UI** — un componente cliente que muestra/edita/limpia la nota en el detalle y un indicador en
   la card, SEPARADO y etiquetado distinto de `orden.notas` (nota de la tienda).

No hay tabla ni columna nuevas; no hay migración (R15).

---

## 2. Modelo de datos — SIN migración (reuso de la feature 115)

- **Tabla (creada por 115):** `orden_mensajero_meta`
  - `usuario_id` (FK → `usuario`), `orden_id` (FK → `orden`), `marcar_luego boolean`,
    **`nota text NULL`**, `UNIQUE(usuario_id, orden_id)`.
  - RLS: la define y posee la feature 115 (service-role only, patrón de las tablas sensibles del
    repo). 116 NO la modifica.
- **Migración:** **es de la feature 115.** 116 NO crea `db/migrations/*`. El modelo Prisma
  `OrdenMensajeroMeta` (con la columna `nota`) ya existe cuando 116 arranca (115 `done`). Si 116
  detectara que una migración es imprescindible (no prevista), la justifica y aporta `down.sql`
  reversible (R15).
- **`orden.notas` NO se toca:** es la nota de la tienda (`Orden.notas String?`, `schema.prisma:365`).
  Vive en otra tabla/columna; ninguna ruta de 116 la lee para escribir ni la modifica (R7).

> Conclusión: 116 = **Server Action + service + repo (métodos) + UI**, todo sobre el esquema que
> dejó 115.

---

## 3. Backend — cambios por capa

### 3.1 Server Actions (Controller) — NUEVO `lib/actions/notas-privadas-mensajero.ts`

`'use server'`. Espejo del patrón de `lib/actions/mis-asignaciones.ts`: resuelve el actor con
`resolveActorFromSession()`, valida con zod, delega en el service bajo `withErrorHandler`, y
traduce el `AppErrorShape` del borde (solo `VALIDATION_ERROR` → `validation_error`, `UNAUTHORIZED`
→ `unauthenticated`). `forbidden`/`not_found` los devuelve el service como resultado de dominio.

```ts
// guardar: crea o edita la nota privada del mensajero para una orden.
export async function guardarNotaPrivada(input: unknown, deps = {}): Promise<GuardarNotaResult>;
// limpiar: deja nota = NULL (no borra la fila; preserva marcar_luego).
export async function limpiarNotaPrivada(input: unknown, deps = {}): Promise<LimpiarNotaResult>;
```

- Inyección de dependencias de test como en `mis-asignaciones.ts` (`{ service?, getActor? }`).
- `if (!actor) throw new UnauthenticatedError()` antes de tocar el service (R10).

### 3.2 Service — NUEVO `lib/services/NotaPrivadaMensajeroService.ts` (+ interfaz)

Lógica de negocio pura (sin HTTP ni Prisma), testeable con un doble del repo. Depende del
repositorio de la tabla meta (el de 115) por interfaz.

- `guardar(ordenId, nota, actor)`:
  1. `actor.rol !== "mensajero"` → `forbidden` (R10).
  2. `nota` recortada; si queda vacía → delega en `limpiar` (R5).
  3. `repo.upsertNota(actor.usuarioId, ordenId, notaRecortada)` (R1/R2/R3/R9).
  4. Devuelve `{ status: "ok", nota }` (o `{ status: "ok", nota: null }` si se limpió).
  5. Si la FK de `orden_id` falla (orden inexistente) → resultado de dominio `forbidden`
     (mismo trato que "orden ajena o inexistente" de la 36; ver §4) SIN excepción cruda (R16).
- `limpiar(ordenId, actor)`:
  1. `actor.rol !== "mensajero"` → `forbidden` (R10).
  2. `repo.limpiarNota(actor.usuarioId, ordenId)` — `updateMany ... SET nota = NULL` (no-op si no
     hay fila; idempotente, R4/R9).
  3. `{ status: "ok" }`.

**Authz por mensajero (R6/R8/R9):** el service SIEMPRE pasa `actor.usuarioId` como `usuario_id`;
nunca recibe un `usuario_id` desde el cliente. La privacidad es estructural: toda escritura y toda
lectura quedan acotadas por la clave `(usuario_id, orden_id)`.

### 3.3 Repositorio — métodos AÑADIDOS al repo de la tabla meta (de 115)

Sobre `OrdenMensajeroMetaRepository` / `IOrdenMensajeroMetaRepository` (nombres provisionales; 116
adopta el nombre que fije 115). Solo Prisma, sin lógica de negocio:

```ts
// R1/R2/R3/R9: crea o edita; en conflicto (usuario_id, orden_id) actualiza SOLO `nota`.
upsertNota(usuarioId: string, ordenId: string, nota: string): Promise<void>;
//   prisma.ordenMensajeroMeta.upsert({
//     where:  { usuarioId_ordenId: { usuarioId, ordenId } },
//     create: { usuarioId, ordenId, nota },      // marcarLuego toma su default (false)
//     update: { nota },                          // NO toca marcarLuego -> R3
//   })

// R4/R9: limpia SIN borrar la fila (preserva marcar_luego). No-op idempotente si no existe fila.
limpiarNota(usuarioId: string, ordenId: string): Promise<void>;
//   prisma.ordenMensajeroMeta.updateMany({
//     where: { usuarioId, ordenId }, data: { nota: null },
//   })
```

- **Por qué `updateMany` en `limpiar` y no `update`:** `update` lanza si la fila no existe;
  `updateMany` con `count = 0` es el no-op idempotente que pide R4.
- **Por qué NO `delete` en `limpiar`:** la fila es COMPARTIDA con `marcar_luego` (115). Borrarla
  perdería ese flag. Ver §5 (alternativa descartada).

### 3.4 Lectura del DTO (JOIN compartido con 115)

`GestionOrdenRepository.findMisAsignaciones` YA hará un include filtrado a `orden_mensajero_meta`
por `usuario_id = mensajeroId` para `marcar_luego` (feature 115). 116 añade `nota` a esa proyección
y lo mapea a un campo nuevo:

- `MiAsignacionRow.notaPrivada: string | null` (`IGestionOrdenRepository.ts`).
- `MiAsignacionDTO.notaPrivada: string | null` (`IMisAsignacionesService.ts`).
- `GestionOrdenRepository`: `notaPrivada: meta?.nota ?? null` en el `mapRow`.
- `MisAsignacionesService.toDTO`: propaga `notaPrivada`.

Una sola query (sin N+1). La proyección por `usuario_id = mensajeroId` garantiza R8 (nunca la nota
de otro). Estos archivos son COMPARTIDOS con 115 (§6).

---

## 4. Contratos I/O

`lib/types/nota-privada-mensajero.ts` (NUEVO): schemas zod + tipos de resultado.

```ts
const NOTA_MAX = 2000; // P1 (prov.): ajustable sin tocar el modelo

guardarNotaSchema = z.object({
  ordenId: z.string().uuid(),                    // formato del id de Orden (uuid)
  nota:    z.string().max(NOTA_MAX),             // se recorta en el service; vacío -> limpiar (R5)
});
limpiarNotaSchema = z.object({ ordenId: z.string().uuid() });

type GuardarNotaResult =
  | { status: "ok"; nota: string | null }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R13
  | { status: "forbidden" }        // rol ≠ mensajero (R10) u orden inexistente/ajena (R16)
  | { status: "unauthenticated" }; // sin sesión (R10)

type LimpiarNotaResult =
  | { status: "ok" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden" }
  | { status: "unauthenticated" };
```

- `guardar` devuelve la `nota` resultante (o `null` si se limpió por venir en blanco) para que la
  UI refleje el estado sin re-fetch inmediato; R14 se garantiza además con `router.refresh()`.
- Se reutiliza la forma de resultado del patrón 36 (`validation_error`/`unauthenticated`/`forbidden`),
  sin inventar códigos nuevos.

---

## 5. Alternativas descartadas (obligatorio)

### Alternativa A (descartada) — Columna `orden.nota_mensajero` en la tabla `orden`

Guardar la nota como una columna directa en `Orden` (junto a `orden.notas`).

**Por qué se descarta:**
- Una orden puede ser REASIGNADA entre mensajeros; una sola columna en `orden` no modela N notas
  por-autor ni el aislamiento por mensajero (R6/R8/R9). La clave `(usuario_id, orden_id)` de
  `orden_mensajero_meta` sí.
- Contaminaría la tabla de negocio de la tienda con datos privados de un operador, mezclando dos
  dominios (nota de tienda vs. nota de mensajero) que R7 exige separados.
- Requeriría una migración propia (columna nueva + RLS), contra la directriz de reuso de 115.

La tabla `(usuario_id, orden_id)` de 115 es la modelación correcta y ya existe: 116 solo añade
comportamiento sobre su columna `nota`.

### Alternativa B (descartada) — "Limpiar" = `DELETE` de la fila

Borrar físicamente la fila `orden_mensajero_meta` al limpiar la nota.

**Por qué se descarta:** la fila es COMPARTIDA con `marcar_luego` (115). Un `DELETE` al limpiar la
nota borraría también el flag "gestionar más tarde" del mensajero para esa orden — efecto colateral
inaceptable. Por eso limpiar = `SET nota = NULL` conservando la fila (R4). (Una limpieza de filas
totalmente vacías —`nota IS NULL AND marcar_luego = false`— es una optimización opcional y NO forma
parte de esta feature.)

---

## 6. UI

### 6.1 Componente NUEVO `app/(app)/mis-asignaciones/_components/NotaPrivadaMensajero.tsx` (cliente)

- Props: `{ ordenId: string; notaInicial: string | null }` (datos por props desde el server
  component padre; patrón `private/` de arquitectura).
- Render: sección etiquetada **"Mi nota"** (o "Mi nota privada"), CLARAMENTE distinta de la "Notas"
  de tienda (R7/R11): un `Textarea` (shadcn/ui) con el valor, botón **Guardar** y botón **Limpiar**
  (deshabilitado si no hay nota). Estado de carga/spinner en el submit (patrón Modal/async del repo).
- Acciones: `guardarNotaPrivada({ ordenId, nota })` y `limpiarNotaPrivada({ ordenId })`; en éxito,
  `toast` + `router.refresh()` para releer del servidor (R14). En `validation_error`/`forbidden`,
  `toast.error` con mensaje accionable (sin PII, R17).

### 6.2 Punto de inserción en el detalle (R11)

El detalle se compone en `MisAsignacionesModule.tsx` (panel inline vía `GestionarOrdenPanel`) y en
la sección "Por recoger" (`renderDetalle={(orden) => <AsignacionDetalle orden={orden} />}`).
`AsignacionDetalle.tsx` es un componente de PRESENTACIÓN puro y COMPARTIDO; para no volverlo
interactivo, se renderiza `<NotaPrivadaMensajero>` como HERMANO debajo de `<AsignacionDetalle>` en
el contexto del detalle del mensajero, pasando `ordenId={orden.id}` y `notaInicial={orden.notaPrivada}`.
La "Notas" de tienda permanece dentro de `AsignacionDetalle` (`:89`), garantizando dos campos
distintos y etiquetados (R7).

### 6.3 Indicador en la card (R12)

En la card de "En reparto / por gestionar" (`MisAsignacionesModule.tsx`) se añade un
indicador/badge (p. ej. "Nota" + preview truncado, P3) cuando `orden.notaPrivada` no es `null`.
Como todas las cards son órdenes del propio mensajero (`page.tsx` valida rol server-side), el
indicador es intrínsecamente privado (R6).

---

## 7. Seguridad y errores

- **Authz estructural (R6/R8/R9/R10):** el `usuario_id` SIEMPRE proviene del actor de sesión, nunca
  del cliente; el rol se valida en el service; la RLS de 115 es la última línea. La lectura se
  filtra por `usuario_id = mensajeroId` en el JOIN.
- **Errores (R17):** sin `catch` vacíos; mensajes fijos i18n-ready sin PII; el borde va bajo
  `withErrorHandler` (normaliza fallos EXCEPCIONALes). Nunca se loguea el contenido de la nota.
- **Integridad (R16):** la FK `orden_id → orden` (de 115) impide filas huérfanas; una violación de
  FK se traduce a resultado de dominio (`forbidden`), no a excepción cruda.

---

## 8. Trazabilidad de diseño

| Requisito | Mecanismo de diseño |
| --- | --- |
| R1/R2/R3 | `repo.upsertNota` (upsert por `usuario_id_orden_id`, update solo `nota`) |
| R4/R5 | `repo.limpiarNota` (`updateMany SET nota=NULL`) + recorte en el service |
| R6/R8/R9 | `usuario_id` del actor + JOIN/escritura acotados a la clave; RLS de 115 |
| R7 | campo/tabla separados de `orden.notas`; dos etiquetas en el detalle |
| R10 | check de rol en el service + `resolveActorFromSession` en el borde |
| R11/R12/R14 | `NotaPrivadaMensajero` (detalle) + indicador en card + `router.refresh()` |
| R13/R16 | zod en el borde + FK de 115 traducida a resultado de dominio |
| R15 | reuso de tabla/columna de 115; sin `db/migrations/*` |
| R17 | `withErrorHandler`, mensajes fijos, sin log de la nota |
