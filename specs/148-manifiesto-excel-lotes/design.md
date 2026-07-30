# Feature 148 — Manifiesto Excel al crear o mover órdenes · design

## 0. Decisiones cerradas ANTES del spec (no se reabren)

- **D1 — Generación en CLIENTE.** El navegador arma el `.xlsx` con `exceljs` (import
  dinámico DENTRO de la función, regla del módulo `lib/utils/xlsx-template.ts:84-85`) y lo
  descarga con el patrón Blob + anchor. NO hay generación server-side, NO hay Supabase
  Storage, NO hay bucket.
- **D2 — 5 puntos de enganche**, todos en esta feature (§3).
- **D3 — SIN modelo nuevo en base de datos.** Sin migración, sin `down.sql`, sin RLS, sin
  tabla. NO se reusa `carga.download_url` de la feature 141 (su PR #168 no está en `dev`).

Consecuencia declarada y aceptada: el manifiesto **no es reimprimible** (§8).

---

## 1. Hallazgo crítico: qué devuelve HOY cada flujo

El punto de diseño es que **ningún flujo devuelve hoy las 11 columnas**. Flujo por flujo:

| # | Flujo | Punto de enganche | Qué devuelve HOY | Qué falta para el manifiesto |
|---|---|---|---|---|
| 1 | Carga masiva (vía sesión) | `lib/services/BulkOrdenService.ts:245` → `cargarMasiva` → `BulkSummary` | `filas: { fila, numRemision, resultado, estatus, errores? }` + contadores. **NO trae `ordenId`, ni `numGuia`, ni destinatario/teléfono/dirección/zona/monto** | 9 de 11 columnas |
| 2 | Generar guía / asignar desde bodega | `lib/services/GuiaAsignacionService.ts:133` y `:319` | `resultados: { ordenId, numGuia, estado }` (generarGuia) / `{ ordenId, estado }` (asignarDesdeBodega) | destinatario, teléfono, dirección, zona, monto, remisión, responsable |
| 3 | Ruteo a bodega satélite | `lib/services/GuiaAsignacionService.ts:418` (`rutearABodegaSatelite`) y `lib/services/AsignacionSateliteService.ts:58` (`asignar`, bodega satélite) | `resultados: { ordenId, estado }` | 9 de 11 columnas |
| 4 | Envío de devolución a central | `lib/services/EnvioDevolucionCentralService.ts:38` (`enviarACentral`) | `{ status }` **por UNA orden**; el lote lo hace la UI en loop (`app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx:345-365`) | todo; ni siquiera devuelve el `ordenId` |
| 5 | Envío a la tienda | `lib/services/DevolucionOrigenService.ts:35` (`devolverATienda`) | `{ status }` **por UNA orden**; el lote lo hace la UI en loop (`app/(app)/ordenes/_components/DevolverATiendaModal.tsx:49-52`) | todo |

**Decisión D4 — acción de LECTURA aparte, no ampliar los 5 retornos.** El manifiesto se
arma con una Server Action de solo lectura (`obtenerManifiesto`) que recibe la selección del
lote y devuelve las filas ya listas. Razones:

1. Ampliar cinco DTOs de retorno (dos de ellos por-orden y con `status` idempotente que no
   devuelve `ordenId`) tocaría 5 servicios de negocio + sus interfaces + sus tests, y
   violaría R27 (contrato de negocio intacto).
2. Dos flujos (4 y 5) NO tienen lote en el service: el lote existe solo en la UI. Ampliar el
   retorno ahí no da un lote, da N respuestas sueltas.
3. Ya existe el precedente exacto en el repo: `generarEtiquetas({ ordenIds })`
   (`lib/actions/etiquetas-guia.ts:58`, `lib/services/EtiquetaGuiaService.ts:44`) es un READ
   derivado por lote de ids, sin tabla nueva, consumido por un modal cliente que descarga un
   archivo. Y `resumenCargaMasiva({ numRemisiones })`
   (`app/(app)/ordenes/_components/OrdenesCargaResumen.tsx:102`,
   `lib/types/asignacion-mensajero.ts:44`) es el mismo patrón para el lote de carga masiva,
   que es el único que NO tiene ids (solo `num_remision`).
4. Los datos se leen DESPUÉS de la operación cometida ⇒ el manifiesto refleja el estado ya
   persistido (guía recién asignada, mensajero recién asignado), que es justo lo que se
   quiere imprimir.

Coste aceptado: un round-trip extra al servidor por descarga. Es un READ de ≤ N filas por
ids, sobre índices de PK; no está en ruta caliente.

---

## 2. Selección del lote por flujo (entrada de la acción de lectura)

| Flujo | Selección disponible en el cliente tras el éxito | Entrada |
|---|---|---|
| 1. Carga masiva | `numRemisionesNuevas` (`app/(app)/ordenes/_components/OrdenesCargaResumenPaso.tsx:27`, ya derivado del `BulkSummary`) | `{ flujo: "carga_masiva", numRemisiones }` |
| 2. Generar guía / asignar bodega | `result.resultados[].ordenId` (`app/(app)/ordenes/_components/GenerarGuiaModal.tsx:161-180`, `AsignarBodegaModal.tsx:68`) | `{ flujo, ordenIds }` |
| 3. Ruteo satélite (maestro) | `ordenes[].id` del modal (`app/(app)/ordenes/_components/RutearSateliteModal.tsx:50-52`) | `{ flujo: "ruteo_satelite", ordenIds }` |
| 3b. Asignación satélite | `ordenes[].id` (`app/(app)/recepcion-satelite/_components/AsignarSateliteModal.tsx:73-76`) | `{ flujo: "asignacion_satelite", ordenIds }` |
| 4. Devolución a central | ids con `status === "ok"` del loop (`RecepcionSateliteModule.tsx:353-357`) | `{ flujo: "devolucion_central", ordenIds }` |
| 5. Envío a la tienda | ids con `status === "ok"` del loop (`DevolverATiendaModal.tsx:49-52`) | `{ flujo: "envio_tienda", ordenIds }` |

`numRemisiones` es la ÚNICA vía alterna y existe porque el summary de la carga masiva no
lleva ids (§1). La acción acepta una unión discriminada de las dos formas de selección.

---

## 3. Módulos nuevos y ubicación

```
lib/types/manifiesto.ts                         (N) tipos + schemas zod del borde
lib/interfaces/services/IManifiestoService.ts   (N) contrato del servicio único
lib/services/ManifiestoService.ts               (N) SERVICIO ÚNICO: arma las 11 columnas
lib/actions/manifiesto.ts                       (N) Server Action READ 'use server'
lib/utils/xlsx-template.ts                      (M) + buildXlsxRows + export XLSX_MIME
lib/utils/manifiesto-xlsx.ts                    (N) puro: filas -> ArrayBuffer + filename
components/shared/descargar-blob.ts             (N) DOM: Blob + anchor + revokeObjectURL
components/shared/DescargarManifiestoButton.tsx (N) botón cliente reusado por los 5 flujos
lib/interfaces/repositories/IOrdenRepository.ts (M) + ManifiestoRow + 2 métodos de lectura
lib/repositories/OrdenRepository.ts             (M) WITH_MANIFIESTO + implementación
```

Justificación de ubicaciones (docs/architecture.md):
- `ManifiestoService` es lógica de negocio pura (mapeo flujo → origen/destino/responsable),
  sin HTTP ni Prisma, con repos inyectados por constructor.
- `components/shared/` para el botón y el helper de descarga porque los consumen DOS grupos
  de rutas (`app/(app)/ordenes` y `app/(app)/recepcion-satelite`) ⇒ pasa la regla de "sin
  sobre-ingeniería" (≥ 2 consumidores).
- `lib/utils/manifiesto-xlsx.ts` es puro (sin DOM); el side effect de descarga vive en
  `components/shared/descargar-blob.ts`, igual que hoy vive dentro del componente en
  `components/shared/BulkUpload.tsx:201-222`.

### Qué NO se toca
- `BulkOrdenService`, `GuiaAsignacionService`, `AsignacionSateliteService`,
  `EnvioDevolucionCentralService`, `DevolucionOrigenService`: **cero cambios** (R27). Sus
  interfaces, inputs y resultados quedan idénticos.
- `app/api/ordenes/carga-masiva/chunk/route.ts`: sin cambios.
- Ninguna migración, ningún `db/schema.prisma` (D3).

---

## 4. Contrato de tipos

```ts
// lib/types/manifiesto.ts
export type ManifiestoFlujo =
  | "carga_masiva"
  | "generacion_guia"     // incluye asignar-desde-bodega
  | "ruteo_satelite"
  | "asignacion_satelite"
  | "devolucion_central"
  | "envio_tienda";

/** Fila del manifiesto: EXACTAMENTE las 11 columnas de R2, ya en texto/número de salida. */
export interface ManifiestoFilaDTO {
  numGuia: number | null;      // R5: null -> celda vacía
  numRemision: string;
  destinatario: string;
  telefono: string;            // teléfono del DESTINATARIO
  direccion: string | null;
  zona: string;                // nombre de la zona (R6)
  monto: number | null;        // R7: null -> celda vacía
  origen: string;
  destino: string;
  responsable: string;
  fecha: string;               // YYYY-MM-DD calendario CR (R10)
}

export interface ManifiestoOmitidaDTO { ref: string; motivo: "no_encontrada" }

export const manifiestoSchema = z.union([
  z.object({ flujo: z.enum(FLUJOS), ordenIds: z.array(z.string().min(1)).min(1) }),
  z.object({ flujo: z.literal("carga_masiva"),
             numRemisiones: z.array(z.string().min(1)).min(1).max(MAX_ROWS) }),
]);

export type ManifiestoResult =
  | { status: "ok"; filas: ManifiestoFilaDTO[]; omitidas: ManifiestoOmitidaDTO[] }
  | { status: "unauthenticated" }      // R28
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }; // R30
```

Repositorio (aditivo, patrón `EtiquetaRow` de `lib/interfaces/repositories/IOrdenRepository.ts:192-210`):

```ts
export interface ManifiestoOrdenRow {
  id: string;
  tiendaId: string;               // R29: filtro por dueño cuando el actor es apiKey
  numGuia: number | null;
  numRemision: string;
  destinatario: string;
  telefonoDest: string;
  direccion: string | null;
  montoCobrar: number | null;     // Decimal -> number
  tiendaNombre: string;
  zonaNombre: string;
  zonaEsCentral: boolean;         // decide GAM/satélite en origen/destino
  mensajeroAsignadoNombre: string | null;  // NO existe en EtiquetaRow: se agrega
}

findManifiestoByIds(ids: string[]): Promise<ManifiestoOrdenRow[]>;
findManifiestoByRemisiones(remisiones: string[], tiendaId: string): Promise<ManifiestoOrdenRow[]>;
```

Ambos filtran `deletedAt: null` (R12) y devuelven `[]` con entrada vacía. El segundo se acota
por `tiendaId` porque `num_remision` es único **por tienda**, no global (misma acotación que
hace hoy el resumen de carga masiva).

### Tabla `origen` / `destino` / `responsable` (R8/R9)

`CENTRAL` = `zona.nombre` de la zona con `esCentral = true`
(`IZonaRepository.findCentralZonaId` + nombre; ver `GuiaAsignacionService.ts:141`).
`ZONA` = `zonaNombre` de la orden. `TIENDA` = `tiendaNombre` de la orden.
`ACTOR` = nombre del usuario que ejecutó la operación. `MENSAJERO` =
`mensajeroAsignadoNombre` de la orden ya persistida.

| Flujo | `origen` | `destino` | `responsable` |
|---|---|---|---|
| `carga_masiva` | `TIENDA` | `CENTRAL` | `ACTOR` (el adminTienda que carga) |
| `generacion_guia` — orden GAM con mensajero | `CENTRAL` | `ZONA` | `MENSAJERO` |
| `generacion_guia` — orden GAM sin mensajero | `CENTRAL` | `CENTRAL` | `ACTOR` |
| `generacion_guia` — orden no-GAM (se rutea) | `CENTRAL` | `ZONA` | `ACTOR` |
| `ruteo_satelite` | `CENTRAL` | `ZONA` | `ACTOR` |
| `asignacion_satelite` | `ZONA` (bodega satélite) | `ZONA` | `MENSAJERO` |
| `devolucion_central` | `ZONA` (bodega satélite) | `CENTRAL` | `ACTOR` (adminSatelite) |
| `envio_tienda` | `CENTRAL` | `TIENDA` | `ACTOR` |

Esto resuelve explícitamente la ambigüedad señalada: **`origen`/`destino` son la ubicación
física de salida y de llegada del movimiento de ESA operación**, no la tienda/zona de la
orden en abstracto. Por eso en la carga masiva es `tienda → central` (la orden entra al
circuito) y en un ruteo a satélite es `central → zona`.

La distinción "GAM con/sin mensajero" se deriva de datos ya persistidos
(`zonaEsCentral` + `mensajeroAsignadoNombre`), no de un parámetro extra: el manifiesto se
pide DESPUÉS de la escritura, así que la orden ya trae su mensajero si lo recibió.

---

## 5. Flujo de datos (end to end)

```
[Modal/paso del flujo]  --(operación de negocio, sin cambios)-->  service existente
        |  status === "ok"
        v
<DescargarManifiestoButton flujo=... seleccion={ordenIds | numRemisiones} />
        |  click
        v
obtenerManifiesto(input)            lib/actions/manifiesto.ts  ('use server', READ)
   zod parse (R30) -> actor (R28) -> ManifiestoService.armar(input, actor)
                                        |
                                        +-- OrdenRepository.findManifiestoBy*  (Prisma)
                                        +-- ZonaRepository (nombre zona central)
                                        v
                             { filas: ManifiestoFilaDTO[], omitidas }
        |
        v
buildManifiestoXlsx(filas)   lib/utils/manifiesto-xlsx.ts
   -> buildXlsxRows(COLUMNAS, filas)  lib/utils/xlsx-template.ts  (import dinámico exceljs)
        |
        v
descargarBlob(buffer, XLSX_MIME, manifiestoFileName(flujo, fecha))
   components/shared/descargar-blob.ts  (Blob + <a download> + revokeObjectURL)
```

### `lib/utils/xlsx-template.ts` — qué hay hoy y qué se agrega

Hoy exporta **solo** `XlsxTemplateField` y `buildXlsxTemplate(fields)`
(`lib/utils/xlsx-template.ts:17,75`). El MIME vive como constante PRIVADA del componente
(`components/shared/BulkUpload.tsx:102`). NO existen `buildXlsxRows` ni `XLSX_MIME`
exportados en esta base.

Se agrega:
- `export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"`.
- `export async function buildXlsxRows(columns: XlsxColumn[], rows: Array<Record<string, string | number | null>>, sheetName: string): Promise<ArrayBuffer>` —
  cabecera en negrita, anchos por contenido, import dinámico de `exceljs` DENTRO de la
  función (regla del módulo), lanza si `columns` está vacío (mismo contrato defensivo que
  `buildXlsxTemplate`).
- `BulkUpload.tsx` pasa a importar `XLSX_MIME` del módulo en vez de su constante local
  (cambio mecánico, sin cambio de comportamiento).

> **AVISO DE CONFLICTO DE MERGE PREVISIBLE.** La feature 143 (rama
> `feature/143-descargar-errores-carga-masiva`, aún NO mergeada a `dev`) agrega
> `buildXlsxRows` + `XLSX_MIME` en ESTE MISMO archivo. Si la 143 aterriza primero, el
> implementer de la 148 **debe reusar esa versión y borrar la propia**, no duplicar. Si
> aterriza después, el conflicto se resuelve conservando UNA sola definición de cada símbolo.
> Esta es la única superficie compartida entre ambas features.

### Nombre del archivo (R14)

`manifiesto-<flujo>-<YYYY-MM-DD>.xlsx`, con `<flujo>` = el valor de `ManifiestoFlujo` y la
fecha vía `fechaCalendarioCR()` (`lib/utils/fecha-cr.ts:35`), NO `toISOString().slice(0,10)`
(off-by-one documentado en ese módulo).

---

## 6. Superficies de UI (dónde se engancha el botón)

| Flujo | Componente que dispara la acción por lote | Dónde va el botón |
|---|---|---|
| Carga masiva | `app/(app)/ordenes/_components/OrdenesCargaResumenPaso.tsx:31-60` (paso "resumen") | Junto al `Alert` de "N nuevas cargadas", con `numRemisionesNuevas` |
| Generar guía | `app/(app)/ordenes/_components/GenerarGuiaModal.tsx:161-181` | Nuevo paso "resultado" del modal (tras `status==="ok"`, antes de `onSuccess`) |
| Asignar desde bodega | `app/(app)/ordenes/_components/AsignarBodegaModal.tsx:68` | Igual |
| Ruteo satélite (maestro) | `app/(app)/ordenes/_components/RutearSateliteModal.tsx:50-61` | Igual |
| Asignación satélite | `app/(app)/recepcion-satelite/_components/AsignarSateliteModal.tsx:73-80` | Igual |
| Devolución a central | `app/(app)/recepcion-satelite/_components/RecepcionSateliteModule.tsx:345-365` | Sección "En tránsito a central": botón con los ids que salieron `ok` |
| Envío a la tienda | `app/(app)/ordenes/_components/DevolverATiendaModal.tsx:45-59` | Igual que los modales |

Patrón común: los modales usan `components/shared/Modal` con `onConfirm/onError` y cierran
al confirmar. Para no perder el lote al cerrar, el modal pasa a una **fase "resultado"** que
muestra el resumen ya existente (toast) + el botón de descarga, y `onSuccess()` se invoca al
cerrar esa fase. Esto NO cambia la acción de negocio (R27) ni el momento en que se comete.

---

## 7. Alternativas descartadas

**A. Generación server-side + persistencia en Supabase Storage (reimprimible/auditable).**
Descartada por D1 (decisión cerrada con el humano): exige bucket nuevo, política de
retención, RLS de acceso al archivo y un modelo que asocie lote↔archivo — justo lo que D3
prohíbe. Coste ya conocido y aceptado: no reimprimible.

**B. Ampliar el DTO de retorno de los 5 servicios para que traigan las 11 columnas.**
Descartada: toca 5 servicios de negocio + interfaces + ~10 archivos de test, viola R27, y no
funciona para los flujos 4 y 5, cuyo service es por-orden y ni siquiera devuelve `ordenId`
(§1). Además obligaría a los servicios a leer datos que su lógica no necesita (dirección,
teléfono, nombre de zona), contaminando su responsabilidad.

**C. Reusar `EtiquetaGuiaService.generarEtiquetas` como fuente de filas.**
Descartada: `EtiquetaRow` no trae `mensajeroAsignadoNombre` (⇒ falta `responsable`) ni
`zonaEsCentral`, y su DTO carga QR/barcode/producto/geografía que el manifiesto no usa;
extenderlo mezclaría dos artefactos con reglas de autorización distintas. Sí se copia su
patrón (READ derivado por ids, sin tabla nueva, omitidas en vez de abortar).

**D. Reusar `carga.download_url` (feature 141) para publicar el manifiesto.**
Descartada por D3: la 141 no está en `dev` (PR #168 abierto) y crear la dependencia
bloquearía esta feature; además implicaría persistencia, prohibida por D1.

**E. Un componente de descarga por flujo (5 copias del botón).**
Descartada: duplicaría el mapeo columna↔dato y rompería R1 (servicio único). Un solo botón
parametrizado por `flujo` + selección.

---

## 8. Limitaciones aceptadas (explícitas)

1. **El manifiesto NO es reimprimible.** Se genera en memoria del navegador sobre el
   resultado de la acción. Si el usuario cierra el modal/paso sin descargar, o si pierde el
   archivo, **el manifiesto de ese lote se perdió**: no hay forma de volver a obtener "ese
   mismo lote" porque el lote no queda registrado en ninguna parte. (Aceptado por el humano
   en D1; no se mitiga en esta feature.)
2. **Sin auditoría en base de datos.** No queda constancia de quién descargó qué manifiesto,
   ni cuándo, ni de qué órdenes se compuso el lote. No hay tabla, no hay `download_url`, no
   hay evento de historial.
3. **Los datos se leen DESPUÉS de la operación**, no son un snapshot atómico de la
   transacción: si otro usuario modifica una de las órdenes entre la operación y la descarga,
   el manifiesto refleja el dato más reciente, no el del instante de la operación.
4. **Órdenes borradas entre la operación y la descarga** salen del manifiesto como
   "omitidas" (R12); el conteo de la operación de negocio puede no coincidir con el número
   de filas del archivo.
5. **Sin paginación**: el manifiesto se arma en una sola lectura. El techo práctico es el de
   la carga masiva (`cargaMasivaConfig.MAX_ROWS`); no se diseñan lotes mayores.

---

## 9. Decisiones del gate F1.4 — **CERRADAS por el humano (2026-07-28)**

> El gate se aprobó con **las 8 propuestas del spec tal cual**. Resumen ejecutable; el detalle
> de cada una queda abajo como estaba redactado.
>
> 1. **Enganche al lote de la UI, SIN tocar los services.** El manifiesto se arma con los ids
>    cuyo `status === "ok"` en el loop del modal, tanto para `enviarACentral` como para
>    `devolverATienda`. **R27 se mantiene intacto**: NO se agregan métodos de lote al dominio.
> 2. **Bodega central**: `zona.nombre` de la zona `esCentral` cuando existe; si NO hay zona
>    central configurada, **literal de respaldo `"Bodega central"`**. La descarga nunca falla
>    por este dato de catálogo, ni deja la celda vacía.
> 3. **`monto` = `orden.monto_cobrar`** (cobro al destinatario, COD). Confirmado.
> 4. **`telefono` = `orden.telefono_dest`** (destinatario). Confirmado.
> 5. **`fecha` = fecha de la OPERACIÓN** (día de la descarga, calendario CR), no `created_at`.
>    Confirmado.
> 6. **Carga masiva = archivo completo** (todas las filas `creada` del `BulkSummary` acumulado),
>    no chunk por chunk. Confirmado.
> 7. **Fase "resultado" con botón explícito** en los 4 modales (hoy cierran al confirmar). Se
>    acepta el cambio de UX. **NO** hay descarga automática ni acción en el toast.
> 8. **`responsable` = nombre del usuario que ejecutó** la operación cuando no hay mensajero;
>    cuando SÍ hay mensajero asignado, manda el mensajero. Sin texto de rol, sin columna extra
>    (se conservan las 11 columnas pedidas).

### Redacción original de las preguntas (histórico)

1. **"Envío a la tienda" — punto de enganche.** SÍ existe y se localizó:
   `DevolucionOrigenService.devolverATienda` (`lib/services/DevolucionOrigenService.ts:35`),
   pero es **por orden**; el lote existe únicamente en la UI
   (`app/(app)/ordenes/_components/DevolverATiendaModal.tsx:49-52`, loop `await` sobre la
   selección). Este diseño engancha el manifiesto al lote de la UI (ids con `status==="ok"`)
   **sin tocar el service**. ¿Se aprueba, o se quiere un método de lote real en el service
   (cambio mayor, R27 se tendría que relajar)? Lo mismo aplica a
   `EnvioDevolucionCentralService.enviarACentral` (`lib/services/EnvioDevolucionCentralService.ts:38`),
   también por-orden con lote en UI (`RecepcionSateliteModule.tsx:345-365`).
2. **Etiqueta de la bodega central** en `origen`/`destino`: se propone `zona.nombre` de la
   zona `esCentral`. ¿Qué texto se usa si NO hay zona central configurada (los flujos 2 y 3
   ya abortan en ese caso, pero 1, 4 y 5 no)?
3. **Semántica de `monto`**: se propone `orden.monto_cobrar` (cobro al destinatario, COD),
   no el costo de envío/flete+IVA. ¿Correcto?
4. **Semántica de `telefono`**: `orden.telefono_dest` (destinatario). ¿Correcto?
5. **Semántica de `fecha`**: fecha de la OPERACIÓN (día de la descarga, calendario CR), no
   `orden.created_at`. ¿Correcto?
6. **Ámbito del lote en carga masiva**: el archivo completo (todas las filas `creada` del
   `BulkSummary` acumulado), no chunk por chunk. ¿Correcto?
7. **Descarga automática vs. botón explícito**: se propone botón explícito en la fase
   "resultado" de cada flujo. ¿Se acepta añadir esa fase a los 4 modales (hoy cierran al
   confirmar)? Es el único cambio de UX no trivial de la feature.
8. **`responsable` cuando el responsable es el ACTOR**: se usa el nombre del usuario
   autenticado. ¿Se quiere en su lugar un texto de rol ("Bodega central") para los casos sin
   mensajero?
