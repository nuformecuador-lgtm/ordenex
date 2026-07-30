# Feature 143 — Diseño técnico

> Requisitos en `requirements.md`. Todo lo de abajo se apoya en superficie ya
> verificada en este worktree (`origin/dev @ c3e6954`); las referencias a código
> están comprobadas, no supuestas.

## Decisiones de gate (F1.4, cerradas con el humano)

- **G-1 — Solo vista previa.** El botón vive únicamente en `OrdenesCargaPreview`.
  Los errores de la carga real post-confirmación (paso `asignacion`) quedan fuera
  de alcance: exigiría construir superficie de errores nueva en un paso que hoy no
  la tiene (solo lanza un toast), y el momento útil de la descarga es **antes** de
  crear nada. (R20)
- **G-2 — Prefijo de línea dentro de `motivo_error`.** La celda empieza con
  `Fila <N> — `, una sola vez, seguida del detalle determinista. Identifica la
  fila original aun cuando `num_remision` esté vacío o repetido, **sin** una
  segunda columna extra (respeta D-A). (R6, R7, R8, R22)
- **G-3 — Solo xlsx.** Nada de CSV. (R21)

## 0. Modelo de datos, migraciones, RLS, endpoints

**Ninguno.** Esta feature no toca Postgres ni Prisma: no hay tablas nuevas,
migraciones ni políticas RLS. Tampoco hay endpoints ni Server Actions nuevos: la
descarga es **cliente puro** (`Blob` + anchor + `URL.createObjectURL`), el mismo
patrón que ya usa `components/shared/BulkUpload.tsx` para la plantilla
(`handleDownloadTemplate`, líneas 201-222). Todos los datos necesarios ya viven
en el estado del cliente tras la validación.

## 1. Superficie existente (verificada)

| Pieza | Ruta | Qué aporta |
| --- | --- | --- |
| `clasificarBulkSummary(data)` | `app/(app)/ordenes/_components/carga-masiva-clasificacion.ts` | `errores: OrdenConError[]` con `{ fila: number \| null, numRemision, errores: Record<string,string[]> }` |
| `FilaParseada { row: RawRow; linea: number }` | `app/(app)/ordenes/_components/carga-masiva-parser.ts` | valores CRUDOS por línea, 1-based sobre datos no vacíos |
| `ORDENES_BULK_FIELDS` | `app/(app)/ordenes/_components/carga-masiva-fields.ts` | 8 columnas de la plantilla v2, **su orden ES el de las columnas** |
| `buildXlsxTemplate(fields)` | `lib/utils/xlsx-template.ts` | cabecera + 1 fila de ejemplo; import dinámico de `exceljs` DENTRO de la función |
| `formatErrores(errores)` | `app/(app)/ordenes/_components/OrdenesConErrorTabla.tsx` | aplana `Record<string,string[]>` a `"campo: m1, m2; campo2: m3"`, o `"Error de validación"` |
| `findMissingHeaders(headers)` | `lib/types/carga-masiva.ts` | solo comprueba PRESENCIA de `REQUIRED_HEADERS` |
| `filaCargaSchema` | `lib/types/carga-masiva.ts` | `z.object` **sin `.strict()`** |
| `parseSpreadsheet(buffer, ext)` | `lib/parsers/spreadsheet.ts` | vía servidor; indexa por cabecera detectada |

### 1.1 El eje del cruce `fila` ↔ `linea` — verificado

`procesarEnChunks` (`carga-masiva-chunks.ts:98-100`) **remapea** la `fila`
relativa al lote a la línea original del archivo:
`resultados.push({ ...rr, fila: lote[i]?.linea ?? rr.fila })`. Por tanto
`OrdenConError.fila` es directamente comparable con `FilaParseada.linea`. Sin
ese remapeo el cruce sería inválido; queda como invariante que la feature
depende y que el test de R4 protege.

Además, `dedupPorRemision` clasifica las repetidas intra-archivo como
`duplicada` (no `error`), así que **todas** las filas con `resultado === "error"`
provienen de `filasUnicas`. El índice se construye sobre `filasUnicas`; si en el
futuro apareciese un error fuera de ese conjunto, R5 lo cubre (fila degradada,
sin lanzar).

### 1.2 Round-trip: por qué hoy funciona y por qué hay que fijarlo

Verificado leyendo el código, no asumido:

- `findMissingHeaders` (`lib/types/carga-masiva.ts:37-40`) construye un `Set` con
  las cabeceras presentes y devuelve las **obligatorias ausentes**. No hay lista
  blanca: una columna desconocida como `motivo_error` no produce ningún rechazo.
- Ambos parsers indexan por cabecera detectada y vuelcan cada columna en
  `RawRow[header]`: `extractRows` (`lib/parsers/spreadsheet.ts:89-111`) y
  `matrizAArchivo` (`carga-masiva-parser.ts:108-132`). Una columna extra añade
  una clave más al `RawRow`; **no desplaza ni contamina** a las demás, porque el
  mapeo es por nombre de cabecera y no por posición.
- `filaCargaSchema` (`lib/types/carga-masiva.ts:59-88`) es un `z.object` sin
  `.strict()`: zod **descarta** claves desconocidas en silencio, así que
  `motivo_error` desaparece de `FilaCargaInput`.
- Efecto colateral controlado: `motivo_error` con texto hace que la fila cuente
  como "no vacía" en ambos parsers. Irrelevante aquí, porque toda fila exportada
  ya trae al menos `num_remision` o motivo.

Es decir: hoy el round-trip sobrevive por **diseño permisivo**, no por contrato
explícito. R14/R15/R16 convierten esa permisividad en contrato con test, para
que un futuro `.strict()` o una lista blanca de cabeceras rompa el test en vez
de romper al usuario en producción.

## 2. Módulos a crear / modificar

### 2.1 `lib/utils/xlsx-template.ts` — función hermana `buildXlsxRows`

Se **extiende el módulo existente** con una función hermana, no se crea módulo
nuevo:

```ts
export async function buildXlsxRows(
  fields: XlsxTemplateField[],
  rows: Array<Record<string, string>>,
  sheetName?: string,
): Promise<ArrayBuffer>;
```

- Reutiliza `headerFor` (cabecera = clave máquina siempre — regla de oro de la
  feature 58) y la política de anchos (`MIN_WIDTH`/`MAX_WIDTH`/`PAD`), calculando
  el ancho a partir de la cabecera y del **valor más largo presente en los datos**
  de esa columna, acotado por `MAX_WIDTH`.
- `exceljs` se importa **dinámicamente dentro de la función** (R19), igual que
  `buildXlsxTemplate`.
- Fila 1 en negrita; una fila por elemento de `rows`; celda vacía si la clave no
  está en el registro.
- Lanza si `fields` está vacío (mismo contrato defensivo que `buildXlsxTemplate`).
  Con `rows` vacío genera solo la cabecera (el consumidor ya no llega ahí por R11).
- **No se modifica `buildXlsxTemplate`** (R18).

Por qué aquí y no en un módulo nuevo: `xlsx-template.ts` ya es el único punto del
repo que conoce la regla "la cabecera es la clave máquina" y la política de
anchos. Duplicarla en otro módulo es exactamente el modo en que reapareció el bug
de la feature 58.

### 2.2 `app/(app)/ordenes/_components/carga-masiva-errores-formato.ts` (nuevo, puro)

Se **mueve** `formatErrores` (hoy exportada desde `OrdenesConErrorTabla.tsx`, un
componente `"use client"`) a un módulo puro, y `OrdenesConErrorTabla.tsx` la
**re-exporta** para no romper `tests/components/OrdenesConErrorTabla.test.tsx`,
que la importa desde ahí. Motivo: el helper que compone las filas del export debe
ser puro y testeable sin React, y no debe arrastrar un componente cliente.

### 2.3 `app/(app)/ordenes/_components/carga-masiva-export-errores.ts` (nuevo, puro)

```ts
/** Cabecera de la columna extra con el motivo (decisión D-A). */
export const COLUMNA_MOTIVO_ERROR = "motivo_error";

/** Columnas del export: las 8 de la plantilla + motivo_error al final (R1). */
export const ERRORES_EXPORT_FIELDS: XlsxTemplateField[];

/** Texto de la celda `motivo_error`: `Fila N — detalle` (R6, R7, R8, R22). */
export function motivoErrorDeFila(error: OrdenConError): string;

/** Compone las filas del export cruzando errores con filas parseadas (R3-R8). */
export function construirFilasErrorExport(
  errores: OrdenConError[],
  filas: FilaParseada[],
): Array<Record<string, string>>;

/** Nombre del archivo descargado (R10). */
export function nombreArchivoErrores(fecha: Date): string;
```

Algoritmo de `construirFilasErrorExport`:

1. Índice `Map<number, RawRow>` a partir de `filas` (clave `linea`). Ante `linea`
   repetida gana la primera (mismo criterio que `dedupPorRemision`).
2. Por cada `error` en orden (R3):
   - `row = error.fila != null ? indice.get(error.fila) : undefined`.
   - Si hay `row`: cada clave de `ORDENES_BULK_FIELDS` toma `row[key] ?? ""` (R4).
   - Si no hay `row` (fila `null` o sin correspondencia): todas las 8 vacías salvo
     `num_remision = error.numRemision` (R5). Nunca lanza; sin `catch` vacíos
     porque no hay nada que pueda lanzar (mismo estilo defensivo que
     `clasificarBulkSummary`).
   - `motivo_error = motivoErrorDeFila(error)` (R6, R7, R8, R22).
3. Devuelve el arreglo. Función pura, sin efectos, sin `any`.

`motivoErrorDeFila(error)` (decisión de gate G-2):

```
detalle = formatErrores(error.errores)            // "campo: m1, m2; campo2: m3" | "Error de validación"
return error.fila != null
  ? `Fila ${error.fila} — ${detalle}`             // R6, R7
  : detalle;                                      // R22: sin prefijo, no se inventa número
```

El separador es un guion largo rodeado de espacios (`" — "`), el mismo que ya usa
la app en textos de UI. El prefijo aparece **una sola vez** aunque el detalle
agrupe varios campos y varios mensajes: se antepone al detalle ya compuesto, no
por campo.

`nombreArchivoErrores(fecha)`: `ordenes-con-error-AAAAMMDD-HHmm.xlsx` con
componentes locales de la fecha, cero-rellenados. Recibe la fecha por parámetro
para ser testeable de forma determinista.

### 2.4 UI: dónde va el botón

Ubicación elegida: **`OrdenesCargaPreview.tsx`** (paso "Revisar hallazgos"), en
la fila de acciones junto a los chips / encima de la tabla de errores.

Justificación (verificada, no supuesta):

- Decisión de gate **G-1**: solo la vista previa. El paso `asignacion` (tras la
  carga real) no lista filas con error — solo hay un toast en
  `OrdenesCargaMasivaButton.tsx:154-170` — y darle descarga obligaría a construir
  UI de errores nueva ahí; además el momento útil de corregir es antes de crear
  nada (R20).
- Es la **única** superficie que hoy renderiza `OrdenesConErrorTabla`
  (`OrdenesCargaPreview.tsx:118-120`). `OrdenesCargaResumenPaso.tsx` también la
  compone pero **no lo usa nadie**: `OrdenesCargaMasivaButton` renderiza
  `OrdenesCargaUpload` → `OrdenesCargaPreview` → `OrdenesCargaResumen`
  (líneas 215-229).
- El único componente que tiene a la vez la clasificación y las `FilaParseada`
  es `OrdenesCargaMasivaButton` (estados `clasificacion` y `filasUnicas`, líneas
  115-118). Pasar `filas` a `OrdenesCargaPreview` es **un solo nivel** de props;
  meterlo dentro de `OrdenesConErrorTabla` obligaría a enhebrar `filas` por dos
  consumidores (uno de ellos muerto) y a mezclar una acción en un componente que
  el spec de la feature 29 declara "de solo lectura, sin acciones".

Contrato de props (aditivo, opcional para no romper tests existentes de
`OrdenesCargaPreview` si los hubiera):

```ts
export interface OrdenesCargaPreviewProps {
  clasificacion: ClasificacionCarga;
  /** Filas parseadas del archivo original (valores crudos), para el export. */
  filas?: FilaParseada[];
  confirmando: boolean;
  progresoTexto?: string | null;
  onConfirmar: () => void;
}
```

`OrdenesCargaMasivaButton` pasa `filas={filasUnicas}`.

Handler (mismo patrón que `BulkUpload.handleDownloadTemplate`):

```
if (errores.length === 0 || generando) return;      // R11, R12
setGenerando(true)
try {
  const { buildXlsxRows } = await import("@/lib/utils/xlsx-template");  // R19
  const buffer = await buildXlsxRows(ERRORES_EXPORT_FIELDS,
                    construirFilasErrorExport(errores, filas ?? []));
  Blob([buffer], { type: XLSX_MIME }) → createObjectURL → <a download> → click → revokeObjectURL
} catch { toast.error("No se pudo generar el archivo de errores.") }  // R13
finally { setGenerando(false) }
```

`XLSX_MIME` (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`)
está hoy declarado privado en `BulkUpload.tsx:102` y duplicado en su test. Se
promueve a constante exportada desde `lib/utils/xlsx-template.ts` y
`BulkUpload.tsx` la consume desde ahí (cambio mecánico, sin efecto observable).

El botón se renderiza **solo si `errores.length > 0`** (R11): oculto, no
deshabilitado. Coherente con la propia tabla de errores, que ya se renderiza
condicionalmente; un botón deshabilitado permanente sería ruido en el 90% de las
cargas correctas.

## 3. Formato del contenido de `motivo_error`

Decisión (gate G-2): **prefijo de línea + `formatErrores`**, es decir
`Fila <N> — campo: mensaje1, mensaje2; campo2: mensaje3`, y
`Fila <N> — Error de validación` cuando no hay detalle. Sin número de fila
conocido, la celda es solo el detalle (R22).

Ejemplos:

| Caso | Celda `motivo_error` |
| --- | --- |
| un campo, un mensaje | `Fila 7 — telefono: debe tener 8 dígitos` |
| un campo, dos mensajes | `Fila 7 — telefono: debe tener 8 dígitos, formato inválido` |
| dos campos | `Fila 12 — direccion_destinatario: distrito no encontrado; monto_cobrar: debe ser numérico y no negativo` |
| sin detalle | `Fila 3 — Error de validación` |
| `fila === null` | `telefono: debe tener 8 dígitos` |

Justificación:
- **Identifica la fila sin una segunda columna extra:** el usuario sabe qué línea
  de su archivo original falló aunque `num_remision` esté vacío o repetido —
  precisamente los casos en que la fila es más difícil de reconocer — respetando
  la decisión cerrada D-A (una sola columna extra).
- **Coherencia UI ↔ archivo:** el detalle es literalmente el mismo texto de la
  columna "Motivo" de la tabla; el prefijo es la columna "Fila" de esa misma
  tabla, fusionada en la única celda disponible.
- **Legible sin herramientas:** una sola celda de texto plano; `;` separa campos,
  `,` separa mensajes del mismo campo. No requiere saltos de línea (que en XLSX
  obligan a `alignment.wrapText` para verse) ni JSON.
- **Prefijo una sola vez (R6):** se antepone al detalle YA compuesto, no por
  campo; repetirlo por campo sería ruido puro.
- **Determinista (R8):** `formatErrores` recorre `Object.entries` del mismo objeto
  `errores` que ya está en memoria; para una clasificación dada el orden de claves
  es estable, y el orden de mensajes dentro de cada campo lo fija el servidor. El
  prefijo es una función pura de `error.fila`. Dos generaciones consecutivas
  producen byte a byte el mismo texto.
- **Un solo punto de verdad:** el detalle vive en `formatErrores`; si cambia,
  cambia en tabla y archivo a la vez, sin desincronización posible.
- **Inocuo para el round-trip:** `motivo_error` es columna desconocida para ambos
  parsers y se descarta en la validación de fila (§1.2); su contenido, sea cual
  sea, no afecta a ninguna otra columna.

## 4. Alternativas descartadas

**A1. Hoja aparte con el detalle de errores (una fila por campo con error).**
Descartada por decisión cerrada con el humano (D-A) y porque obliga al usuario a
saltar entre hojas para corregir, además de que muchos flujos de re-subida toman
"la primera hoja" (`parseSpreadsheet` lee `worksheets[0]`, `xlsxAMatriz` también):
una segunda hoja sería invisible para el propio parser y una fuente de confusión
si el usuario reordena hojas.

**A2. Sufijar/renombrar la cabecera del motivo para "avisar" que no se sube
(p. ej. `motivo_error (no subir)`).** Descartada: es literalmente el bug de la
feature 58 con otro disfraz. Cualquier divergencia entre texto de cabecera y
clave máquina es la clase de error que ya costó una feature de corrección. La
cabecera es la clave, punto.

**A3. Generar el archivo en el servidor (route handler o Server Action que
devuelva el binario).** Descartada: los datos ya están íntegros en el cliente
(clasificación + filas crudas), el archivo original **nunca llega al servidor**
(el flujo parsea en el navegador precisamente para esquivar el límite de body de
Vercel), así que el servidor tendría que recibir de vuelta las filas crudas solo
para devolverlas en XLSX. Coste de red y de superficie de API a cambio de nada.

**A4. Exportar los valores normalizados que se enviaron al backend en vez de los
crudos.** Descartada por decisión cerrada (D-B) y porque el objetivo es que el
usuario reconozca *lo que él escribió* para corregirlo; devolverle una versión
normalizada por la app haría el diff incomprensible.

**A5. Reutilizar `buildXlsxTemplate` pasando N campos sintéticos o llamándolo en
bucle.** Descartada: su contrato es "cabecera + una fila de ejemplo" y forzarlo a
N filas exigiría deformar `example`, con riesgo de tocar la generación de la
plantilla real (R18). Función hermana en el mismo módulo, contrato limpio.

**A6. Poner el botón dentro de `OrdenesConErrorTabla`.** Descartada: obligaría a
enhebrar `filas` por dos consumidores (uno de ellos, `OrdenesCargaResumenPaso`,
sin uso vivo) y rompería el carácter de "solo lectura, sin acciones" que ese
componente declara desde la feature 29.

**A7. Segunda columna extra `fila_original` para identificar la línea.**
Descartada en el gate F1.4: contradice D-A ("una sola columna extra al final") y
duplica superficie desconocida en el archivo re-subible. El prefijo
`Fila <N> — ` dentro de `motivo_error` (G-2) da la misma información con una sola
columna y sin tocar el contrato del round-trip.

**A8. Ofrecer también descarga en CSV** (existe `lib/utils/csv-template.ts` y la
subida acepta `.csv`). Descartada en el gate F1.4 (G-3): el objetivo es "el mismo
formato de la plantilla vigente" y un segundo formato duplica superficie de UI y
de tests sin resolver ningún problema del usuario — el archivo exportado ya se
re-sube tal cual.

**A9. Botón de descarga también tras la carga real (paso `asignacion`).**
Descartada en el gate F1.4 (G-1): ese paso no lista filas con error (solo un
toast), así que habría que construir superficie de errores nueva; y el momento
útil de corregir y re-subir es **antes** de crear órdenes.

## 5. Trazabilidad prevista requisito → test

| R | Test previsto |
| --- | --- |
| R1, R2 | `tests/unit/utils/xlsx-rows.test.ts` + integración round-trip (headers exactos y en orden) |
| R3, R4 | `tests/components/CargaMasivaExportErrores.test.ts` (cruce por línea) |
| R5 | idem (`fila: null` y línea inexistente) |
| R6, R7 | idem (`Fila 7 — telefono: …`; prefijo UNA sola vez con varios campos; mapa vacío → `Fila 3 — Error de validación`) |
| R8 | idem (separadores `; ` / `, `; dos invocaciones → resultado idéntico) |
| R9, R10, R11, R12, R13 | `tests/components/OrdenesCargaPreview.test.tsx` (fetch espiado sin llamadas, nombre del anchor, ausencia del botón, doble click, fallo de `buildXlsxRows`) |
| R14, R15, R16 | `tests/integration/carga-masiva-errores-roundtrip.test.ts` (ambos parsers + `filaCargaSchema`) |
| R17 | `tests/components/OrdenesCargaUpload.test.tsx` (cabecera faltante → no hay paso preview) |
| R18 | `tests/integration/carga-masiva-plantilla-roundtrip.test.ts` (existente, no debe cambiar) |
| R19 | `tests/unit/utils/xlsx-rows.test.ts` (el módulo de export no importa `exceljs` en top-level) |
| R20 | `tests/components/OrdenesCargaMasivaButton.test.tsx` (paso `asignacion` → ningún botón de descarga de errores en el DOM) |
| R21 | `tests/components/OrdenesCargaPreview.test.tsx` (una sola acción de descarga; el Blob es MIME xlsx y no hay opción CSV) |
| R22 | `tests/components/CargaMasivaExportErrores.test.ts` (`fila: null` → celda sin prefijo `Fila`) |

## 6. Riesgos

- **R-1. El remapeo de `fila` en `procesarEnChunks` es el único garante del
  cruce.** Si alguien lo elimina, el export saldría con celdas de otras filas
  (peor que vacío). Mitigación: el test de R4 construye el escenario end-to-end
  con `linea` desalineada respecto al índice del lote.
- **R-2. Endurecer `filaCargaSchema` con `.strict()` en el futuro** rompería la
  re-subida. Mitigación: R16 con test explícito, y comentario en el schema
  apuntando a esta feature.
- **R-3. Archivos grandes** (hasta `MAX_ROWS`): la generación es síncrona en el
  hilo principal. Con miles de filas con error puede haber un congelamiento
  perceptible. Mitigación mínima: el estado ocupado de R12. Optimización (worker)
  fuera de alcance.

## Preguntas abiertas — RESUELTAS (gate F1.4)

**No queda ninguna pregunta abierta.** Las tres de la primera redacción se
cerraron con el humano:

1. ~~¿Descarga también tras la carga real (paso `asignacion`)?~~ → **No** (G-1,
   R20). Razón: exigiría construir superficie de errores nueva en un paso que hoy
   solo lanza un toast, y el momento útil de la descarga es antes de crear nada.
   Ver alternativa A9.
2. ~~¿Cómo identificar la fila cuando `num_remision` está vacío o repetido?~~ →
   **Prefijo `Fila <N> — ` dentro de `motivo_error`** (G-2, R6/R7/R8/R22), una
   sola vez por celda. Razón: resuelve la identificación sin una segunda columna
   extra, respetando D-A. Ver §3 y alternativa A7.
3. ~~¿Segunda opción de descarga en CSV?~~ → **No** (G-3, R21). Solo `.xlsx`, el
   formato de la plantilla vigente. Ver alternativa A8.
