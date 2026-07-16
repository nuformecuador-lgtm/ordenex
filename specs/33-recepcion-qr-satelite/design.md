# Feature 33 — Bodega satélite: "Mis asignaciones" y recepción por QR · design.md

> Decisiones técnicas sobre los requisitos R1–R23. Sujeto a la aprobación F1.4 (las preguntas
> abiertas de `requirements.md` mandan sobre la opción implementada). Se apoya en el patrón real
> de features 17/30 (transición de estado por guardia de origen), 32 (QR = `num_guia`) y 36
> (módulo por-rol, Server Actions, datos por props).
>
> ⚠️ **Actualizado 2026-07-15** con las decisiones (a-1) y (a-2) de `requirements.md`:
> 1. **QR = `num_guia`** (no `orden.id`): el lookup de recepción es por `num_guia` (`@unique`), no
>    por PK. El QR codifica la URL `<origin>/paquete/<numGuia>`. Sin retrocompatibilidad.
> 2. **Recepción SOLO por cámara**: el camino keyboard-wedge (`<input>` autofocus + Enter, R10) se
>    **retiró de la UI**. Ya no hay "dos caminos" de recepción.

## 1. Modelo de datos y migración

**Sin tablas ni columnas nuevas.** La feature solo añade UN valor de catálogo de estado y reutiliza
`orden.zonaId` (NOT NULL) y `usuario.zonaId` (nullable) existentes.

### 1.1 Catálogo `en_bodega_satelite` (R1/R2/R20/R21)

- `lib/types/order-status.ts` — añadir `"en_bodega_satelite"` como **13.º** valor de
  `ORDER_STATUS_SEED` (fuente de verdad; `seedOrderStatus` lo siembra idempotente por `value`).
- Migración nueva `db/migrations/<timestamp>_order_status_en_bodega_satelite/`:
  - `migration.sql` (patrón EXACTO de `20260711140000_order_status_en_ruta_bodega_satelite`):
    ```sql
    ALTER TYPE "order_status_value" ADD VALUE IF NOT EXISTS 'en_bodega_satelite';
    INSERT INTO "order_status" ("id","value")
      VALUES (gen_random_uuid()::text,'en_bodega_satelite')
      ON CONFLICT ("value") DO NOTHING;
    ```
    (Nota para el runner: `ALTER TYPE ... ADD VALUE` no corre dentro de transacción en Postgres
    antiguos; `IF NOT EXISTS` lo hace idempotente.)
  - `down.sql` (patrón feature 30): `DELETE FROM "order_status" WHERE "value"='en_bodega_satelite'`
    condicionado a que **ninguna** `orden` la referencie; documentar que el valor del enum Postgres
    NO se elimina (no hay `DROP VALUE`). RLS de `orden`/`order_status` sin cambios (acceso por
    service role; no hay tabla nueva → sin superficie RLS nueva).

## 2. Capas (Controller → Service → Repository)

Patrón feature 36 (mutación interna del mismo proyecto → **Server Action**, no Route API).

```
app/(app)/recepcion-satelite/page.tsx        ← Server Component: valida rol adminSatelite,
                                                pre-fetch del listado, pasa datos por props
lib/actions/recepcion-satelite.ts            ← Server Actions ('use server'): listar + recibir
lib/services/RecepcionSateliteService.ts     ← lógica: alcance por zona, guardias, idempotencia
lib/repositories/OrdenRepository.ts          ← métodos nuevos (query + transición guardada)
```

### 2.1 Resolución de la zona del adminSatelite (R4)

`Actor` (`{ usuarioId, rol }`) NO trae `zonaId`. En vez de tocar el tipo compartido
`Actor`/`resolveActorFromSession` (lo consumen features 6/15/17/30/36 → riesgo de regresión), el
**service** resuelve la zona server-side por `usuarioId`, con un método de repo espejo de
`findUsuarioFulfillment`:

```ts
// IOrdenRepository (nuevo)
findUsuarioZonaId(usuarioId: string): Promise<string | null>;
```

- `null` → el adminSatelite no tiene zona (R5): listado vacío + `sin_zona` en recepción.

### 2.2 Consulta de "Mis asignaciones" (R6/R8)

Fila proyectada de solo lectura (nombres legibles resueltos, no IDs; patrón `EtiquetaRow`):

```ts
// IOrdenRepository (nuevo)
interface RecepcionSateliteRow {
  id: string; numGuia: number | null; numRemision: string;
  estatusValue: string;   // en_ruta_bodega_satelite | en_bodega_satelite
  destinatario: string; telefonoDest: string; direccion: string | null;
  producto: string; montoCobrar: number | null;
  tiendaNombre: string; zonaNombre: string;
  provinciaNombre: string; cantonNombre: string; distritoNombre: string | null;
}
// Órdenes de la zona en los DOS estados relevantes, sin borradas. El service parte en grupos.
findRecepcionSateliteByZona(
  zonaId: string,
  estatusValues: string[],   // ["en_ruta_bodega_satelite","en_bodega_satelite"]
): Promise<RecepcionSateliteRow[]>;
```

El service separa en `porRecibir` (`en_ruta_bodega_satelite`) y `recibidas` (`en_bodega_satelite`),
igual que `MisAsignacionesService.listarMisAsignaciones` separa `porRecoger`/`porGestionar`.

### 2.3 Recepción por QR (R10–R18)

**Lookup por `num_guia`** (el QR codifica `<origin>/paquete/<numGuia>`; decisión (a-2), 2026-07-15).
El escáner extrae el entero del último segmento con `extractNumGuiaFromScan` (`lib/utils/paquete-url.ts`)
antes de llamar a la action. La fila de transición se resuelve por `findByNumGuiaForTransicion(numGuia)`
(espejo de `findByIdsForTransicion`: INCLUYE borradas para distinguir "no existe" de "borrada";
la fila trae `id/estatusValue/deletedAt/zonaId`). Transición atómica guardada por estado + zona:

> **Antes (F1.4, superado el 2026-07-15):** lookup **por PK** con `findByIdsForTransicion([ordenId])`,
> porque el QR codificaba `orden.id`. Se conserva la nota para explicar por qué el repo tiene ambos
> caminos de búsqueda. Un UUID escaneado ya no resuelve nada → `validation_error` (R16).

```ts
// IOrdenRepository (nuevo) — R11/R18: escritura idempotente y concurrencia-segura.
// UPDATE orden SET estatus_id=:destino
//   WHERE id=:ordenId AND zona_id=:zonaId
//     AND estatus_id=(SELECT id FROM order_status WHERE value='en_ruta_bodega_satelite')
//     AND deleted_at IS NULL
// Devuelve true si afectó 1 fila (recibida), false si 0 (ya no estaba en el origen → race).
recibirEnSatelite(ordenId: string, zonaId: string, destinoEstatusId: string): Promise<boolean>;
```

**Service `RecepcionSateliteService.recibir(ordenId, actor)` — máquina de resultados (R10–R18):**

1. `actor.rol !== "adminSatelite"` → `{ status: "forbidden" }` (R17).
2. `zonaId = repo.findUsuarioZonaId(actor.usuarioId)`; si `null` → `{ status: "sin_zona" }` (R5).
3. `row = repo.findByNumGuiaForTransicion(numGuia)` (antes: `findByIdsForTransicion([ordenId])[0]`).
   - no existe o `deletedAt !== null` → `{ status: "no_encontrada" }` (R15).
   - `row.zonaId !== zonaId` → `{ status: "zona_ajena" }` (R12).
   - `row.estatusValue === "en_bodega_satelite"` → `{ status: "ya_recibida" }` (R14, idempotente, sin escribir).
   - `row.estatusValue !== "en_ruta_bodega_satelite"` → `{ status: "estado_invalido", estado: row.estatusValue }` (R13).
4. `destinoId = repo.findEstatusIdByValue("en_bodega_satelite")`; si `null` → `validation_error`
   ("catálogo de estados incompleto (seed pendiente)", patrón feature 17/30).
5. `ok = repo.recibirEnSatelite(ordenId, zonaId, destinoId)`.
   - `ok === true` → `{ status: "ok", ordenId, estado: "en_bodega_satelite" }` (R11).
   - `ok === false` (race: otro escaneo la movió entre el paso 3 y el 5) → re-leer y devolver
     `ya_recibida` si ahora está en `en_bodega_satelite`, o `conflict` en otro caso (R18).

`mensajero_asignado_id` y `num_guia` NUNCA se tocan (R11).

### 2.4 Server Actions (`lib/actions/recepcion-satelite.ts`)

Patrón `lib/actions/mis-asignaciones.ts`: `withErrorHandler`, `resolveActorFromSession`,
`UnauthenticatedError` en el borde, zod para validar el identificador escaneado; `forbidden` /
`sin_zona` / `zona_ajena` / `estado_invalido` / `ya_recibida` / `no_encontrada` son **resultados de
dominio** (no excepciones). Inyección de `service`/`getActor` por `deps` para tests.

```ts
listarRecepcionSatelite(deps?): Promise<ListarRecepcionSateliteResult>
recibirPorQr(input: unknown, deps?): Promise<RecibirResult>
```

- `recibirPorQr` valida con zod el identificador escaneado. **Schema (R16), actualizado 2026-07-15:**
  el valor útil es un **`num_guia`** (entero positivo; `Orden.numGuia` es `Int? @unique`), extraído
  por el cliente del último segmento de `<origin>/paquete/<numGuia>`. El schema exige un entero
  positivo. Un valor vacío, ilegible, de otro origen, con segmento no numérico, o un **UUID de una
  etiqueta antigua** → `validation_error` "código inválido" ANTES del service (corte limpio, sin
  retrocompatibilidad).
  > Antes (superado): `{ ordenId: z.string().trim().min(1) }` con formato de id CUID/UUID.

### 2.5 Interfaces / tipos nuevos

- `lib/interfaces/repositories/IOrdenRepository.ts` — añadir `findUsuarioZonaId`,
  `findRecepcionSateliteByZona`, `recibirEnSatelite` y la fila `RecepcionSateliteRow`.
- `lib/interfaces/services/IRecepcionSateliteService.ts` — `IRecepcionSateliteService`, DTOs
  (`RecepcionSateliteDTO`), y los union-result de `listar`/`recibir`.
- `lib/types/recepcion-satelite.ts` — schemas zod (`recibirSchema`) + tipos de resultado expuestos por
  las actions.

## 3. Frontend

### 3.1 Página (Server Component, R3/R4)

`app/(app)/recepcion-satelite/page.tsx` (ruta propia: `mis-asignaciones` ya la ocupa el mensajero,
feature 36 — el título de la UI es "Mis asignaciones", el path se distingue):

```tsx
const actor = await resolveActorFromSession();
if (!actor || actor.rol !== "adminSatelite") notFound();   // R3
const result = await listarRecepcionSatelite();
if (result.status !== "ok") notFound();
// <RecepcionSateliteModule porRecibir={...} recibidas={...} zonaNombre={...} sinZona={...} />
```

Datos sensibles pre-fetch en el servidor y pasados por props (patrón feature 36; no fetch de cliente).

### 3.2 Componentes cliente (`app/(app)/recepcion-satelite/_components/`)

- `RecepcionSateliteModule.tsx` — dos secciones separadas "Por recibir" (R6/R7) y "Recibidas" (R8),
  con `Card`/`PageHeader` (feature 36) y estado legible "en bodega satélite de \<zona\>" (R9). Sin
  acciones de asignar/gestionar (R7). Tras cada recepción, `router.refresh()` re-lee el estado del
  servidor.
- `EscanerRecepcion.tsx` — **recepción SOLO por cámara** (decisión (a-1), 2026-07-15). Delega el
  botón, el visor y el ciclo de vida de `html5-qrcode` en el componente compartido
  `components/shared/QrScanner`. Al recibir el texto decodificado extrae el `num_guia`
  (`extractNumGuiaFromScan`) y llama a `recibirPorQr`. Feedback por ítem con `useToast` (feature 11):
  éxito ("orden \<remisión\> recibida"), o motivo (`zona_ajena`, `estado_invalido`, `ya_recibida`,
  `no_encontrada`, `código inválido`, `sin_zona`, `forbidden`, `conflict`). Guarda `procesando` para
  no lanzar dos recepciones simultáneas. Tras `ok`/`ya_recibida` dispara `onRecibida` →
  `router.refresh()`.
  > **RETIRADO el 2026-07-15 (rastro):** ~~input keyboard-wedge (R10): un `<input>` autofocus que
  > acumula lo que el lector "teclea"; al recibir Enter (terminador del lector) toma el valor, llama
  > `recibirPorQr({ ordenId })`, limpia el input y lo re-enfoca para el siguiente paquete. Sin
  > dependencia nueva ni cámara.~~ El humano decidió eliminar ese `<input>` de la UI: la cámara es la
  > única entrada. Los tests de ese camino (texto + Enter) se eliminaron a propósito. Nota: la
  > dependencia `html5-qrcode` que el keyboard-wedge evitaba es ahora obligatoria (la reusa la
  > feature 65).

## 4. Contratos I/O (resumen)

| Acción | Entrada | Salida (union) |
| --- | --- | --- |
| `listarRecepcionSatelite` | — (actor por sesión) | `{ status:"ok", porRecibir:DTO[], recibidas:DTO[], zonaNombre:string\|null, sinZona:boolean }` \| `unauthenticated` |
| `recibirPorQr` | `num_guia` extraído del QR (`<origin>/paquete/<numGuia>`) — entero positivo | `{ status:"ok", ordenId, estado:"en_bodega_satelite" }` \| `ya_recibida` \| `zona_ajena` \| `estado_invalido` \| `no_encontrada` \| `sin_zona` \| `forbidden` \| `validation_error` \| `conflict` \| `unauthenticated` |

> Entrada de `recibirPorQr` actualizada el 2026-07-15 (decisión (a-2)): antes era `{ ordenId:string }`
> (el `orden.id` del QR). Un UUID ya no es entrada válida → `validation_error`.

## 5. Alternativas consideradas y descartadas

- **(A) Escaneo por cámara web (`getUserMedia` + librería de decodificación).** ~~Descartada como
  base: introduce una **dependencia nueva**, permisos de cámara, más superficie de fallo y peso, y
  complica el test (no automatizable sin hardware/mocks de media). El **keyboard-wedge** cubre el caso
  operativo (lector físico), no añade dependencias y deja la entrada como texto testeable a nivel de
  action/E2E. La cámara queda como posible extra diferido.~~
  **REVERTIDA: es la opción ELEGIDA y ahora la ÚNICA** (F1.4 (a) 2026-07-11 la incluyó junto al
  keyboard-wedge; la decisión (a-1) del 2026-07-15 dejó **solo la cámara**). Implementada con
  `html5-qrcode` vía `components/shared/QrScanner`. Los costes que motivaron el descarte original
  (dependencia nueva, permisos de cámara, decodificación no unit-testeable) se **asumen**: la
  decodificación se mockea en los tests de componente y la cámara real queda como verificación manual
  (R22). Texto original conservado para dejar rastro del razonamiento previo.
- **(A') (Ahora descartado) Lector físico keyboard-wedge (`<input>` autofocus + Enter).** Fue la base
  aprobada en F1.4 (a) y llegó a implementarse (R10). **Retirado el 2026-07-15** por decisión del
  humano: la recepción es solo por cámara. Ventajas perdidas: no requería permisos de cámara y su
  entrada, al ser texto plano, era directamente testeable a nivel de action/E2E sin mocks de media.
- **(B) Estado por zona (`en_bodega_satelite_limon`, …).** Descartada: multiplica el catálogo, obliga a
  seed/guardias dinámicas por zona y rompe el criterio de la feature 30 (un solo estado, nombre de zona
  derivado de `orden.zonaId` para el display, R9/R20).
- **(C) Route Handler `app/api/...` para la recepción.** Descartada: es una mutación **interna** del
  mismo proyecto; architecture.md manda Server Action (no `fetch` a API interna). El Route API se
  reserva para webhooks/API pública, que no aplica aquí.
- **(D) Extender `Actor`/`resolveActorFromSession` con `zonaId`.** Descartada: `Actor` es un tipo
  compartido por muchas features; añadirle `zonaId` arriesga regresiones y acopla el módulo del
  adminSatelite a todas. Se resuelve la zona en el service vía `findUsuarioZonaId` (espejo de
  `findUsuarioFulfillment`), localizado y sin tocar el contrato compartido.
- **(E) Recepción por lote (multi-selección + confirmar) como mecanismo principal.** Descartada como
  base: el flujo físico es escanear paquete-por-paquete; el 1-a-1 con feedback por ítem (R10) y la
  idempotencia (R14) modelan mejor la operación. El lote queda como posible extra (Pregunta abierta (d)).

## 6. Seguridad / RLS / permisos

- Sin tabla nueva → sin policies nuevas; `orden`/`order_status` mantienen su RLS (acceso por service
  role). El aislamiento por zona es lógica de negocio en el service (R4/R12), reforzada en la escritura
  guardada (`recibirEnSatelite` filtra `zona_id` en el `WHERE`, R18).
- Página protegida server-side por rol (`notFound` si no es adminSatelite, R3); componentes reciben
  datos por props (no fetch de datos sensibles en cliente, CHECKPOINTS).
- Sin secretos ni PII en logs; errores de dominio con mensaje accionable sin filtrar internals
  (conventions.md).
