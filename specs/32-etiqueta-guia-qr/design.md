# Feature 32 — Etiqueta de guía con QR y código de barras — design

> Fullstack, un ciclo (backend_dev → frontend_dev, un PR). Se apoya en datos ya
> presentes en `orden` + geografía + tienda. NO crea tablas ni migraciones: la
> etiqueta es un READ derivado. Se engancha en la vista de revisión del maestro
> (feature 17) como acción explícita "Imprimir etiquetas".

## 1. Modelo de datos

**Sin cambios de esquema, sin migración, sin RLS nueva.** La etiqueta se deriva
de columnas existentes en `db/schema.prisma`:

- `model Orden` (líneas 267-305): `numGuia` (`Int? @unique`, asignado en feature
  17), `numRemision`, `destinatario`, `telefonoDest`, `producto`, `direccion`
  (feature 15), `montoCobrar` (`Decimal? @map("monto_cobrar")`), `tiendaId`,
  `zonaId`, `provinciaId`, `cantonId`, `distritoId` (nullable), `deletedAt`.
- Relaciones ya existentes usadas para resolver nombres: `tienda` →
  `Usuario.nombre` (`@relation("OrdenTienda")`), `zona` → `Zona.nombre`,
  `provincia` → `Provincia.nombre`, `canton` → `Canton.nombre`, `distrito` →
  `Distrito.nombre` (opcional).

Motivo por el que hace falta un read nuevo: `lib/types/orden.ts` NO expone
`direccion`, `montoCobrar` ni los NOMBRES de provincia/cantón/distrito (solo IDs);
`OrdenListItemDTO` solo añade `zonaNombre` y `tiendaNombre`. Ninguna lectura actual
ensambla el payload completo de la etiqueta. (R1, R4, R5).

## 2. DTO de etiqueta (contrato de salida)

Nuevo archivo `lib/types/etiqueta-guia.ts` (schemas zod + DTOs; patrón de
`lib/types/orden-guia.ts`):

```ts
// Payload por orden imprimible (R1). montoCobrar: number|null (Decimal->number, R5).
// distritoNombre nullable (R4). qrValue/barcodeValue: strings ya resueltos por el
// backend para que el frontend NO decida qué codificar (R7/R8).
export interface EtiquetaGuiaDTO {
  ordenId: string;
  numGuia: number;              // garantizado: solo órdenes con guía (R2)
  numRemision: string;
  destinatario: string;
  telefonoDest: string;
  direccion: string | null;
  producto: string;
  montoCobrar: number | null;   // R5, sin moneda hardcodeada
  tiendaNombre: string;
  zonaNombre: string;
  provinciaNombre: string;
  cantonNombre: string;
  distritoNombre: string | null; // R4
  qrValue: string;               // = String(numGuia) (decisión (a') 2026-07-15)
  barcodeValue: string;          // = String(numGuia) (decisión (b))
                                 // QR y barcode codifican el MISMO valor: num_guia.
}

// Órdenes solicitadas que NO produjeron etiqueta (R2/R3), para el aviso de UI (R11).
export interface EtiquetaOmitidaDTO {
  ordenId: string;
  motivo: "sin_guia" | "no_encontrada"; // R2 / R3
}

export const generarEtiquetasSchema = z.object({
  ordenIds: z.array(z.string().min(1)).min(1), // R15
});

export type GenerarEtiquetasResult =
  | { status: "ok"; etiquetas: EtiquetaGuiaDTO[]; omitidas: EtiquetaOmitidaDTO[] }
  | { status: "unauthenticated" }   // R14
  | { status: "forbidden" }         // R13
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }; // R15
```

Nota: `qrValue`/`barcodeValue` se resuelven en el backend (no en el componente)
para centralizar la decisión (a')/(b) en un solo lugar y que la feature 33 lea el
mismo contrato. La presentación construye la URL del paquete
`<origin>/paquete/<qrValue>` para el QR impreso; el backend emite el `num_guia`
pelado, no la URL (el `origin` es de presentación).

## 3. Capas (Controller → Service → Repository)

Respeta `docs/architecture.md`.

### Repository — `lib/repositories/OrdenRepository.ts`
Nuevo método `findEtiquetasByIds(ids: string[]): Promise<EtiquetaRow[]>`:
- Un solo `findMany` con `where: { id: { in: ids }, deletedAt: null }` e `include`
  de `tienda`, `zona`, `provincia`, `canton`, `distrito` seleccionando solo
  `nombre` (patrón `WITH_ESTATUS_Y_TIENDA`, líneas 61-76).
- Devuelve filas crudas (incluye `numGuia` posible `null`); el filtro `sin_guia`
  se decide en el service para poder reportar la causa (R2). No contiene lógica de
  negocio (solo query). Añadir a `IOrdenRepository`
  (`lib/interfaces/repositories/IOrdenRepository.ts`).

### Service — `lib/services/EtiquetaGuiaService.ts` (nuevo)
`class EtiquetaGuiaService implements IEtiquetaGuiaService`
(`lib/interfaces/services/IEtiquetaGuiaService.ts`, nuevo). Recibe
`IOrdenRepository` por constructor (DI, testeable sin DB/HTTP).
- `generarEtiquetas(input, actor)`:
  1. Autorización: `actor.rol !== "maestro"` (y `admin` según (f)) → `forbidden` (R13).
  2. `distinct(ordenIds)`; carga con `findEtiquetasByIds`.
  3. Por cada id solicitado: si no vino de la query → `omitida: no_encontrada`
     (R3); si vino pero `numGuia === null` → `omitida: sin_guia` (R2); si tiene
     guía → construir `EtiquetaGuiaDTO` (resolver nombres, `Decimal->number`,
     `qrValue = String(numGuia)`, `barcodeValue = String(numGuia)`).
  4. Devuelve `{ status: "ok", etiquetas, omitidas }`.
- No conoce HTTP ni Prisma directamente.

### Controller — Server Action `lib/actions/etiquetas-guia.ts` (nuevo)
`'use server'`, patrón EXACTO de `lib/actions/ordenes-guia.ts`:
`resolveActorFromSession` (→ `unauthenticated`, R14), `generarEtiquetasSchema.parse`
(→ `validation_error`, R15), `withErrorHandler` + `toGuiaActionError`, inyección
`buildEtiquetaService()`. Mutación NO aplica (es read), pero se usa Server Action
(no route handler) porque es consumo interno desde componente propio
(`docs/architecture.md`, tabla Server Actions vs Route Handlers).

## 4. Frontend

### Punto de integración — `app/(app)/ordenes/_components/OrdenesRevisionMaestro.tsx`
Añadir una acción secundaria "Imprimir etiquetas" en los apartados cuyas órdenes
YA tienen `num_guia` (`en_espera_aceptacion`, `en_bodega`,
`en_ruta_bodega_satelite`; ver (f)). Reutiliza el patrón existente
`onSecondaryAction`/`secondaryActionLabel` de `OrdenesApartado` (ya usado para
"Rutear a bodega satélite"). Handler abre un nuevo modal de etiquetas con el
snapshot seleccionado. `readOnly` (admin) según decisión (f).

### Componentes nuevos (colocados junto a la página, `_components/`)
- `EtiquetasGuiaModal.tsx` (Client Component): al abrir, llama a la action
  `generarEtiquetas(ordenIds)`; muestra las etiquetas (R9), avisa las omitidas
  (R11) y, si no hay ninguna imprimible, informa y no imprime (R12). Botón
  "Imprimir" → `window.print()` (R10).
- `EtiquetaGuia.tsx` (Client Component, presentacional): renderiza UNA etiqueta con
  todos los campos (R9) + `<QRCode value={qrValue}/>` y `<Barcode value={barcodeValue}/>`.
  Formatea `montoCobrar` con la config de moneda existente (sin hardcode, R5;
  reutilizar el helper de formato de moneda del repo si existe, si no, resolver por
  config). El QR/barcode se montan solo en cliente (libs de (d)).
- Impresión: hoja de etiquetas con CSS `@media print` que oculta el resto de la UI
  y pagina una etiqueta por bloque (tamaño objetivo a confirmar, (c)).

### Dependencias nuevas (deps de (d), a instalar)
`qrcode.react` (QR) + `react-barcode` (barcode 1D). Ambas Client-only; se importan
en los componentes marcados `"use client"`. Instalación efectiva y elección final:
humano (F1.4).

## 5. Integraciones
- Feature 33 (recepción por escaneo) CONSUMIRÁ el `qrValue` (= `String(numGuia)`,
  decisión (a') 2026-07-15). Esta feature solo lo PRODUCE; no implementa la recepción.
  El escaneo resuelve la orden por `num_guia` (`@unique`), no por PK.
- Ruta pública del detalle del paquete: `<origin>/paquete/<numGuia>` (antes
  `<origin>/paquete/<ordenId>`). Es el destino del QR y el que abre la feature 65
  (lectura genérica de QR por origen).
- Ninguna integración externa (Meta/WhatsApp/Shopify) ni webhook.

## 6. Alternativas descartadas

- **A. Persistir la etiqueta/QR en una tabla nueva (`etiqueta_guia`) o columnas en
  `orden`.** Descartada: la etiqueta es 100% derivable de datos existentes; añadir
  tabla implicaría migración + RLS + sincronización ante cambios de dirección/monto,
  sin ganancia. Se prefiere READ derivado (R1). (Reconsiderar solo si (g) exige
  auditar impresiones.)
- **B. Generar la etiqueta en PDF en el servidor (p. ej. pdf-lib/puppeteer).**
  Descartada para el ciclo base: añade dependencia pesada, tiempo de servidor y
  layout fijo, cuando `window.print()` + `@media print` cubre el requisito de
  imprimible (R10, decisión (c)). Queda como alternativa si se necesita archivar PDF.
- **C. Extender `OrdenDTO`/`OrdenListItemDTO` con dirección, monto y nombres de
  geografía.** Descartada: ampliaría el contrato del CRUD (features 6/7) y del
  listado para todos los consumidores, con PII/monto que hoy no se exponen ahí.
  Se prefiere un DTO dedicado `EtiquetaGuiaDTO` (patrón `orden-guia.ts`,
  "DTOs propios que no amplían OrdenDTO").
- **D. Codificar `num_guia` en el QR.** ~~Descartada como recomendación: el QR lo
  consume la recepción de la feature 33; `orden.id` (UUID PK) es un lookup más
  directo y estable. `num_guia` va al código de barras (lector físico).~~
  **REVERTIDA el 2026-07-15: esta es ahora la opción ELEGIDA** (decisión (a') en
  `requirements.md`). QR y barcode codifican `num_guia`; el lookup de recepción es
  por la columna `@unique` `num_guia`. Se conserva el texto original tachado para
  dejar rastro de por qué se había descartado.
- **D'. (Ahora descartada) Codificar `orden.id` (UUID) en el QR.** Era la decisión
  F1.4 (a) del 2026-07-11 e incluso llegó a implementarse. Descartada el 2026-07-15
  por decisión del humano: obliga a manejar dos identificadores distintos (UUID en
  QR, `num_guia` en barcode y en la etiqueta visible), y el UUID no es legible ni
  verificable a ojo contra el documento físico. Ventaja perdida al descartarla: el
  UUID era inadivinable, lo que acotaba de facto el acceso a `/paquete/<id>` (ver §8:
  ese efecto protector desaparece y quedó como riesgo aceptado).
- **E. Disparar la impresión automáticamente al "Generar guía" (feature 17).**
  Descartada como default: acopla impresión a asignación e impide reimprimir a
  demanda; se prefiere acción explícita "Imprimir etiquetas" sobre la selección
  (decisión (e)).

## 7. Trazabilidad prevista (R<n> → test)

| R | Test previsto |
| --- | --- |
| R1 | unit `EtiquetaGuiaService`: arma DTO completo con nombres resueltos |
| R2 | unit service: orden sin `num_guia` → `omitida: sin_guia`, sin etiqueta |
| R3 | unit service: id inexistente/borrado → `omitida: no_encontrada`, no aborta el lote |
| R4 | unit service: `distritoId` null → `distritoNombre: null` con etiqueta válida |
| R5 | unit service: `montoCobrar` Decimal→number y null; sin símbolo de moneda |
| R6 | unit service/DTO: el payload no incluye `deletedAt` |
| R7 | unit service: `qrValue === String(numGuia)`; component test: renderiza QR con `<origin>/paquete/<numGuia>` |
| R7.1 | unit: un UUID escaneado no resuelve orden → `validation_error` (sin retrocompatibilidad) |
| R8 | unit service: `barcodeValue === String(numGuia)` (= `qrValue`); component test: renderiza barcode |
| R9 | component test `EtiquetaGuia`: todos los campos + QR + barcode en el DOM |
| R10 | component test `EtiquetasGuiaModal`: "Imprimir" invoca `window.print` |
| R11 | component test: selección mixta → M etiquetas + aviso de N−M omitidas |
| R12 | component test: selección sin guías → aviso y NO llama a `window.print` |
| R13 | unit action/service: rol no autorizado → `forbidden` |
| R14 | unit action: sin actor → `unauthenticated` |
| R15 | unit action: lista vacía / id malformado → `validation_error` |

## 8. Riesgo conocido / deuda abierta — enumerabilidad de `/paquete/<numGuia>`

Registrado el **2026-07-15**, derivado de la decisión (a') (QR codifica `num_guia`).

**Hecho técnico.** `num_guia` se asigna desde una secuencia Postgres
(`nextval(orden_num_guia_seq)`, feature 17). Es por tanto **correlativo y enumerable**:
conocida una guía, las contiguas son adivinables por incremento/decremento.

**Superficie expuesta.** La ruta `/paquete/<numGuia>` sirve el payload de etiqueta, que
incluye **PII y datos comerciales**: destinatario, teléfono, dirección, producto y monto a
cobrar. La autorización de esa ruta y de `obtenerEtiquetaPorGuia` exige **sesión válida**,
pero **no acota por zona ni por tienda**: cualquier rol autenticado (`maestro`, `admin`,
`mensajero`, `adminTienda`, `adminSatelite`) puede leer el detalle de **cualquier** guía.

**Consecuencia.** Con el QR anterior (`orden.id`, UUID v4) el identificador era
inadivinable, lo que hacía impracticable el barrido aunque la autorización fuese la misma.
Con el correlativo, un usuario autenticado puede **recorrer la secuencia** (1, 2, 3, …) y
cosechar los datos de todas las órdenes del sistema. El cambio no altera la autorización;
altera la **dificultad práctica** de explotarla.

**Decisión.** El humano fue informado explícitamente de este efecto y **ACEPTÓ el riesgo**
el 2026-07-15, optando por **no** acotar la autorización en este cambio. Queda como **deuda
abierta**, no como descuido ni como omisión del diseño.

**Mitigaciones NO implementadas** (registradas para quien retome la deuda; ninguna está en
el alcance actual y ninguna debe implementarse sin una decisión nueva):
- Acotar `obtenerEtiquetaPorGuia` por zona/tienda según el rol del actor (el `adminTienda`
  solo sus órdenes; el `adminSatelite`/`mensajero` solo su zona).
- Mantener `num_guia` como identificador visible/escaneable, pero servir la ruta por un
  token opaco no enumerable.
- Rate limiting / auditoría de accesos a `/paquete/*` para detectar barridos.
