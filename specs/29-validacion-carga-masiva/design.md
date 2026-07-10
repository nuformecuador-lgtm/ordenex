# design.md — enriquecer validación previa a la carga masiva (feature 29)

> Frontend puro. Consume el backend YA EXISTENTE de las features 15/16. Sin
> backend, DB, migraciones ni Server Actions nuevos. Diseñado sobre la
> interpretación **(A)** (enriquecer el reporte POST-COMMIT del `BulkSummary`),
> **aprobada firme** en la puerta F1.4 (2026-07-10). La interpretación **(B)**
> (dry-run pre-commit) queda como alternativa descartada firme (ALT-1).

## Contexto y estado actual

El flujo hoy (verificado):

```
BulkUpload (POST /api/ordenes/carga-masiva)  → crea las órdenes nuevas
    → onSuccess(result)  [result.data: unknown ≈ BulkSummary]
        parseResumen(result.data)              → {creadas,duplicadas,conError}  (toast)
        extractNumRemisionesCreadas(result.data) → string[]  (solo "creada")
        setStep("resumen") si creadas > 0
    → OrdenesCargaResumen({ numRemisiones })   → resumenCargaMasiva + Select mensajero
```

Las filas `duplicada` del `BulkSummary` (que YA traen `numRemision` + `estatus`)
se cuentan para el toast pero su detalle se **descarta**. La feature 29 recupera
ese detalle y lo presenta separado, en solo lectura.

## Decisiones técnicas

### D1 — Fuente de datos: el `BulkSummary` ya devuelto (sin fetch adicional)

Las órdenes existentes se muestran directamente desde `BulkSummary.filas` con
`resultado === "duplicada"`, usando su `numRemision` y `estatus`. **No** se llama
a ninguna Server Action para las existentes: el dato ya viene en el resultado de
la carga. Esto mantiene la feature 100% frontend y sin coste de red extra.

Las órdenes nuevas siguen alimentando `OrdenesCargaResumen` vía los `numRemision`
con `resultado === "creada"` (comportamiento actual intacto), que sí hace su fetch
`resumenCargaMasiva` para traer los campos completos + mensajero sugerido.

*Justificación de la asimetría:* para las nuevas se necesita el detalle completo
(destinatario, producto, monto, sugerido) para asignar mensajero → se usa la
Server Action existente de la feature 16. Para las existentes solo se requiere
`numRemision` + `estatus` (identificación + estado, solo lectura), que ya están en
el `BulkSummary`. No se justifica otra llamada.

### D2 — Clasificación tipada del `BulkSummary` (helpers puros)

Se añade un helper puro de presentación (p. ej.
`app/(app)/ordenes/_components/carga-masiva-clasificacion.ts`) con guards
defensivos, extendiendo el patrón de `parseResumen`/`extractNumRemisionesCreadas`:

```ts
export interface OrdenExistente { numRemision: string; estatus: string | null; }

export interface OrdenConError {
  fila: number | null;
  numRemision: string;
  errores: Record<string, string[]>;   // vacío si no vino
}

export interface ClasificacionCarga {
  numRemisionesNuevas: string[];   // resultado === "creada"
  existentes: OrdenExistente[];    // resultado === "duplicada"
  errores: OrdenConError[];        // resultado === "error"  (R18/R19)
}

export function clasificarBulkSummary(data: unknown): ClasificacionCarga;
```

Reglas:
- Lee `data.filas` como `unknown[]`; ignora entradas sin forma esperada (no lanza).
- `numRemision` se toma solo si es `string`; `estatus` se normaliza a `string | null`.
- Para filas `error`: `fila` se toma si es `number` (si no, `null`); `errores` se
  toma si es objeto (si no, `{}`).
- Ante `data` no-objeto o `filas` no-array → los tres grupos vacíos.
- Sin `any`: se usan narrowings `typeof`/`Array.isArray` sobre `Record<string,unknown>`.

`extractNumRemisionesCreadas` puede refactorizarse para delegar en este helper
(misma salida) o mantenerse; se prioriza no duplicar la lógica de guard.

### D3 — Presentación: paso "resumen" con tres secciones

Se mantiene el modal de 2 pasos (`"upload" | "resumen"`). En el paso "resumen" se
renderizan, de arriba a abajo:

1. **Aviso de resultado (R7, R8):** un `Alert` que resume "N nuevas cargadas" y,
   si `existentes.length > 0`, "M ya existían y no se recargan". Deja explícito
   que solo se cargaron las nuevas.
2. **Sección "Órdenes nuevas" (R9, R10):** el `OrdenesCargaResumen` existente
   (feature 16) con su `DataTable` + `Select` de mensajero por fila + global +
   "Confirmar asignación". Sin cambios de comportamiento. Solo se renderiza si
   `numRemisionesNuevas.length > 0`.
3. **Sección "Órdenes ya existentes" (R4–R6):** un `DataTable` de solo lectura con
   columnas `numRemision` y estado como etiqueta legible (D5). Solo se renderiza si
   `existentes.length > 0`.
4. **Sección "Órdenes con error" (R18, R19):** un `DataTable` de solo lectura con
   columnas `fila`/`numRemision` y motivo legible. Solo se renderiza si
   `errores.length > 0`.

El modal avanza a "resumen" si `numRemisionesNuevas.length > 0` **o**
`existentes.length > 0` **o** `errores.length > 0` (R11 cubre `creadas === 0` con
existentes; simétrico para solo errores).

Opciones de encaje (dónde viven las nuevas secciones):

- **Opción elegida:** un nuevo componente contenedor
  `OrdenesCargaResumenPaso.tsx` (o extender `OrdenesCargaMasivaButton` para
  renderizar las secciones en el paso "resumen") que compone el aviso +
  `OrdenesCargaResumen` (nuevas) + tabla de existentes + tabla de errores. Esto
  evita meter la lógica de existentes/errores dentro de `OrdenesCargaResumen` (que
  es específico de asignación de mensajero). Cumple R16 (no modifica primitivas) y
  la regla "sin sobre-ingeniería" (vive junto a la página).

### D4 — Componentes de las secciones de solo lectura

**Existentes** — `DataTable<OrdenExistente>`:

```ts
const columns: Column<OrdenExistente>[] = [
  { id: "numRemision", value: "Nº Remisión", render: "numRemision" },
  { id: "estatus", value: "Estado actual", render: (r) => estatusLabel(r.estatus) }, // D5
];
// rowKey: "numRemision" (único por fila; feature 15 garantiza unicidad de num_remision)
```

**Errores** — `DataTable<OrdenConError>`:

```ts
const columns: Column<OrdenConError>[] = [
  { id: "fila", value: "Fila", render: (r) => (r.fila != null ? String(r.fila) : "—") },
  { id: "numRemision", value: "Nº Remisión", render: (r) => r.numRemision || "—" },
  { id: "motivo", value: "Motivo", render: (r) => formatErrores(r.errores) },
];
// rowKey derivable: `${fila}-${numRemision}` (estable por fila del archivo).
```

`formatErrores(errores: Record<string,string[]>): string` aplana el mapa a un texto
legible (p. ej. `"num_remision: obligatorio; telefono: formato inválido"`); si el
mapa está vacío devuelve un motivo genérico ("Error de validación") (R19).

Ambas secciones: sin `Select`, sin botones, sin `onValueChange` → solo lectura
(R6, R19). `emptyMessage` no aplica porque cada sección solo se renderiza con su
grupo no vacío.

### D5 — Mapa de etiquetas de estado (value → label), presentación en frontend

**Investigación de fuente (verificada):** NO existe un mapa `value → label`
reutilizable en el repo. `lib/types/order-status.ts` solo exporta
`ORDER_STATUS_SEED` (los `value` sin etiqueta) y `OrderStatusValue`;
`lib/config/ordenes.ts` solo tiene el `DEFAULT_ESTATUS_VALUE`. Un grep por
`label`/`en_preparacion` no encontró ninguna traducción existente. Por tanto esta
feature **define un mapa nuevo de presentación** (frontend puro; no toca backend).

- **Ubicación:** `app/(app)/ordenes/_components/estatus-label.ts` (helper puro).
- **Forma:**

```ts
import { ORDER_STATUS_SEED } from "@/lib/types/order-status";

// Claves ancladas a ORDER_STATUS_SEED (Record<OrderStatusValue, string>) para que
// el compilador exija cubrir TODOS los value; añadir/quitar un status rompe el build.
const ESTATUS_LABELS: Record<(typeof ORDER_STATUS_SEED)[number], string> = {
  entregada: "Entregada",
  devuelta: "Devuelta",
  devuelta_origen: "Devuelta a origen",
  reprogramada: "Reprogramada",
  en_fulfillment: "En fulfillment",
  en_ruta_bodega_principal: "En ruta a bodega principal",
  en_bodega: "En bodega",
  en_preparacion: "En preparación",
};

export function estatusLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return (ESTATUS_LABELS as Record<string, string>)[value] ?? value; // fallback: value crudo (R17)
}
```

- **Fallback (R17):** `value` desconocido → se muestra el `value` crudo; `null`/
  ausente → "—". Sin lanzar.
- **Relación con feature 28 (en paralelo):** las claves se anclan a
  `ORDER_STATUS_SEED`, que ya contiene `en_fulfillment` (el value posterior al
  rename de la feature 28). No se
  hardcodea ningún supuesto que colisione con el renombrado de la feature 28; si
  esa feature cambia el conjunto de `ORDER_STATUS_SEED`, el `Record` tipado obliga
  a actualizar el mapa (fallo de compilación visible, no silencioso).

### D6 — Flujo de datos en `OrdenesCargaMasivaButton.handleSuccess`

```
handleSuccess(result):
  resumen = parseResumen(result.data)                 // toast (sin cambios) — R13
  clasif  = clasificarBulkSummary(result.data)        // nuevo — R1,R2
  mutate(["ordenes:list", …])                         // sin cambios — R13
  toast según conError (sin cambios)                  // R13
  guardar clasif en estado (numRemisionesNuevas, existentes, errores)
  si (nuevas.length > 0 || existentes.length > 0 || errores.length > 0):
      setStep("resumen")                              // R4, R11, R18
  // si los tres vacíos → permanece en "upload", solo toast (R12)
```

El paso "resumen" pasa a renderizar el contenedor con las tres secciones en vez de
solo `OrdenesCargaResumen`. `numRemisiones` se sustituye/complementa por el objeto
de clasificación en el estado del componente.

### D7 — Accesibilidad y estilo

- Cada sección con encabezado textual claro ("Órdenes nuevas", "Órdenes ya
  existentes", "Órdenes con error") y `ariaLabel` en cada `DataTable`.
- El `Alert` de existentes usa variante informativa (no destructiva): no es un
  error, es información de que ya existían. La sección de errores puede usar
  variante destructiva.
- Tailwind + primitivas existentes; sin CSS nuevo relevante.

## Contrato de I/O (todo interno al frontend)

- **Entrada:** `BulkUploadResult.data: unknown` (≈ `BulkSummary`).
- **Salida de `clasificarBulkSummary`:** `ClasificacionCarga` (ver D2).
- **Sin** nuevos endpoints, Server Actions, tablas ni tipos de dominio backend.
  Se reutiliza `RowResult`/`BulkSummary` de `lib/types/carga-masiva.ts` como
  referencia de forma (los guards no importan runtime, solo tipos).

## Alternativas descartadas

### ALT-1 (descartada) — Dry-run pre-commit / validación previa real (opción B)

Implementar un endpoint `POST /api/ordenes/carga-masiva/validar` (o Server Action)
que parsee el archivo, consulte por `num_remision` cuáles existen y devuelva
existentes vs nuevas **antes** de crear nada; el usuario confirma y solo entonces
se crean las nuevas.

- **Por qué encaja con la literalidad** de "validación PREVIA a la carga".
- **Por qué se descarta como MVP:**
  1. Es **fullstack**, no frontend: viola el `zone: frontend` y el alcance de la
     feature 29 (que declara consumir el backend YA existente de 15/16).
  2. Cambiaría el flujo de la feature 15 (subir ≠ crear), rompiendo un contrato ya
     entregado y probado.
  3. Duplicaría el parseo/validación del archivo (una vez para validar, otra para
     crear) o exigiría persistir un "borrador" de lote → mayor superficie y riesgo.
  4. El objetivo funcional (separar existentes de nuevas y no recargar existentes)
     **ya se cumple** con el `BulkSummary` post-commit: el backend no reinserta las
     duplicadas, así que "cargar solo las nuevas" ya es cierto a nivel de datos;
     falta solo hacerlo visible (esta feature).
- **Estado:** **DESCARTADA firme** en la puerta F1.4 (2026-07-10, [RESUELTO-1]).
  El humano aprobó la opción A. Si en el futuro se quisiera B, sería una feature
  fullstack aparte (nuevo endpoint + cambio de flujo 15), no esta.

### ALT-2 (descartada) — Fetch de las existentes vía `resumenCargaMasiva`

Reutilizar la Server Action de la feature 16 para traer también el detalle
completo de las órdenes existentes (destinatario, producto, etc.).

- **Por qué se descarta:** innecesario. Las existentes solo requieren
  `numRemision` + `estatus` (identificación + estado, solo lectura), datos que ya
  vienen en el `BulkSummary`. Un fetch extra añadiría latencia, un estado de
  carga/error adicional y acoplamiento sin aportar valor al objetivo (b).

### ALT-3 (descartada) — Meter las existentes dentro de `OrdenesCargaResumen`

Extender `OrdenesCargaResumen` para que también reciba y pinte las duplicadas.

- **Por qué se descarta:** `OrdenesCargaResumen` es específico de la asignación de
  mensajero de las **nuevas** (carga `resumenCargaMasiva`, maneja selección,
  confirma). Mezclar las existentes lo sobrecarga y arriesga regresiones en la
  feature 16. Mejor un contenedor de paso que componga ambas piezas (D3), dejando
  `OrdenesCargaResumen` intacto (R9, R16).
