# Feature 150 — Tamaño de hoja seleccionable en las etiquetas · design

## 0. Decisiones cerradas ANTES del spec (no se reabren)

- **D1 — Una etiqueta por página, escalada.** Nada de mosaico / N-up / grilla.
  Cada etiqueta ocupa una página entera del tamaño elegido y la maqueta se escala
  proporcionalmente (márgenes, tipografía, QR, código de barras). En A4 eso
  significa **1 etiqueta por hoja**.
- **D2 — El tamaño se elige en cada descarga, sin persistencia.** Selector en el
  modal con default 100 × 100 mm. Sin `localStorage`, sin columna en DB, sin
  Server Action de preferencias, sin migración.
- **D3 — Alcance: solo el generador de cliente.** `lib/pdf/etiquetas-pdf-lote.ts`
  (feature 136) queda en 100 × 100 mm y **fuera de alcance**: no cambia su firma,
  no recibe parámetro de tamaño, no se toca el contrato público de integradores
  de la feature 88, no se toca `MAX_ETIQUETAS_POR_PDF`.

### Consecuencias declaradas de D3

1. **La feature no tiene backend.** No hay Server Action nueva, no hay route
   handler, no hay servicio ni repositorio nuevos.
2. **No hay modelo de datos.** Sin tabla, sin columna, sin migración Prisma, sin
   `down.sql`, **sin RLS**. La sección "modelo de datos" de `docs/specs.md` es
   vacía por construcción, y así queda registrado aquí para que el reviewer no
   lo lea como un olvido.
3. **Riesgo consciente y aceptado: los dos generadores divergen.** Tras esta
   feature, el PDF que descarga un operador desde el modal puede venir en cuatro
   tamaños, mientras que el PDF consolidado que recibe un integrador por la carga
   con API key sigue siendo 100 × 100 mm fijo. Es una divergencia funcional
   visible (mismo producto, dos comportamientos) aceptada por decisión del
   humano. R21 la blinda con un test de no-regresión para que nadie la "arregle"
   por accidente en un refactor.

---

## 1. Dónde vive el catálogo (corolario de D3, decidido aquí)

La ficha decía «catálogo compartido en `lib/config/etiquetas.ts`». **Se descarta
ese archivo.** Motivo verificado en el código:

`lib/config/etiquetas.ts:65-81` define `loadEtiquetasConfig()` leyendo
`process.env.ETIQUETAS_BUCKET`, `ETIQUETAS_SIGNED_URL_TTL_SECONDS` y
`ETIQUETAS_MAX_POR_PDF`, y en la última línea hace
`export const etiquetasConfig = loadEtiquetasConfig();` — es decir, **lee el
entorno como efecto de importación**. El consumidor del catálogo de tamaños es
`EtiquetasGuiaModal.tsx`, un componente `"use client"`. Importar ese módulo desde
el cliente significaría:

- arrastrar al bundle del navegador configuración **server-side** (nombre del
  bucket privado, TTL de la URL firmada, tope de etiquetas del lote);
- evaluar accesos a `process.env` sin prefijo `NEXT_PUBLIC_`, que Next inlinea
  como `undefined` en el cliente: la config se degradaría a sus defaults **en
  silencio**, sin error visible;
- violar el criterio explícito del encargo: el módulo del catálogo debe ser
  importable desde el cliente **sin efectos secundarios** (R3).

**Decisión: módulo nuevo `lib/config/etiquetas-hoja.ts`**, con solo tipos y
constantes puras (sin `process.env`, sin I/O, sin lógica al importar). Se queda
en `lib/config/` —y no en `lib/types/`— porque es un catálogo de configuración de
producto en el sentido de `lib/config/moneda.ts`, y porque respeta la intención
de la ficha ("catálogo compartido") sin heredar el problema del archivo de la
136. Los dos archivos conviven; no se fusionan ni se renombra el existente.

---

## 2. Contrato del catálogo (`lib/config/etiquetas-hoja.ts`, NUEVO)

```ts
export type HojaEtiquetaId = "100x100" | "4x6in" | "a4" | "carta";

export interface HojaEtiqueta {
  id: HojaEtiquetaId;
  /** Etiqueta visible en el selector (español, con tildes). */
  label: string;
  anchoMm: number;
  altoMm: number;
}

/** Orden fijo del selector (R1). */
export const HOJAS_ETIQUETA: readonly HojaEtiqueta[];
export const HOJA_ETIQUETA_DEFAULT_ID: HojaEtiquetaId; // "100x100"
export function getHojaEtiqueta(id: string): HojaEtiqueta; // desconocido -> default (R5)
/** "100", "101,6" … para el texto del modal, sin depender de Intl/locale. */
export function formatMm(valor: number): string;
```

Valores exactos (R2):

| id | label | ancho mm | alto mm | origen del número |
|---|---|---|---|---|
| `100x100` | `100 × 100 mm` | 100 | 100 | maqueta actual (feature 32, F1.4 (c)) |
| `4x6in` | `4 × 6 pulgadas` | 101.6 | 152.4 | 4 in × 25.4 y 6 in × 25.4 |
| `a4` | `A4` | 210 | 297 | ISO 216 |
| `carta` | `Carta` | 215.9 | 279.4 | 8.5 in × 25.4 y 11 in × 25.4 |

Nota sobre "carta": la ficha decía «carta = 216 × 279 mm». Es el redondeo al
milímetro del tamaño real (8.5 × 11 in = **215.9 × 279.4 mm**, que es también el
`letter` de jsPDF). Se fija el valor exacto, no el redondeado, para que el PDF
declare `612 × 792 pt` clavados y no un tamaño "casi carta" que algunas
impresoras reescalan.

Los identificadores y el nombre del archivo van **sin tildes** (convención del
repo); las etiquetas visibles sí llevan tildes correctas.

---

## 3. Modelo de escalado (con números)

La maqueta actual está expresada en mm sobre un **lienzo cuadrado de 100 × 100**
con `MARGIN = 6` (`etiquetas-pdf.ts:16-19`). El escalado se define así:

```
s     = min(anchoMm, altoMm) / 100      // factor único, ambos ejes (R14)
lado  = 100 * s                          // lado del bloque cuadrado dibujado
offX  = (anchoMm - lado) / 2             // centrado horizontal (R15)
offY  = (altoMm  - lado) / 2             // centrado vertical  (R15)

x' = offX + s * x        y' = offY + s * y        tamaño' = s * tamaño
fontSize' = s * fontSize (en pt; el escalado tipográfico es el mismo factor)
```

### 3.1 El punto fino: etiqueta cuadrada en hoja alargada

Ninguno de los tres tamaños grandes es cuadrado, así que hay que decidir
explícitamente qué pasa con la relación de aspecto. **Se escala por el lado
MENOR y se centra**, dejando bandas blancas arriba y abajo. Razones:

1. **El QR y el código de barras no admiten deformación.** Escalar cada eje por
   su propio factor (en A4: 2.10 en X y 2.97 en Y) convertiría el QR en un
   rectángulo y alargaría los módulos del CODE128. Un QR no cuadrado deja de ser
   un QR válido para muchos lectores, y esta etiqueta se escanea en operación
   (feature 33). Esto sería un defecto funcional, no estético.
2. **La maqueta ya está validada en 1:1.** Los cortes de línea, los siete campos
   y la posición del bloque de códigos se afinaron sobre el cuadrado en la
   feature 32; escalar uniformemente los preserva exactamente.
3. **Escalar por el lado mayor desbordaría.** En A4, s = 2.97 daría un bloque de
   297 mm de ancho sobre una hoja de 210: se saldría de la página (violaría R17).

Se elige **centrado en ambos ejes** (y no anclado arriba a la izquierda) porque
deja márgenes iguales para el corte manual en A4/carta y porque en la etiqueta
térmica de 4 × 6 in absorbe simétricamente el desalineado del avance del medio,
en vez de acumularlo en un solo borde.

### 3.2 Números por tamaño

| id | ancho × alto mm | s | lado bloque mm | offX mm | offY mm | MediaBox pt |
|---|---|---|---|---|---|---|
| `100x100` | 100 × 100 | 1.000 | 100 | 0 | 0 | 283.46 × 283.46 |
| `4x6in` | 101.6 × 152.4 | 1.016 | 101.6 | 0 | 25.4 | 288 × 432 |
| `a4` | 210 × 297 | 2.100 | 210 | 0 | 43.5 | 595.28 × 841.89 |
| `carta` | 215.9 × 279.4 | 2.159 | 215.9 | 0 | 31.75 | 612 × 792 |

`offX` es 0 en los cuatro casos porque en todos ellos el lado menor es el ancho;
aun así se calcula, no se asume: el catálogo podría crecer con una hoja apaisada.

En `100x100` sale s = 1, offX = offY = 0, es decir **la salida por defecto es
byte-a-byte equivalente a la maqueta actual**: el default no es una regresión
visual, es el mismo dibujo.

### 3.3 Constantes derivadas (mm y pt)

| constante | base (100×100) | `4x6in` (s=1.016) | `a4` (s=2.1) | `carta` (s=2.159) |
|---|---|---|---|---|
| `margin` | 6 | 6.096 | 12.6 | 12.954 |
| `contentWidth` | 88 | 89.408 | 184.8 | 190.0 |
| fuente rótulo | 8 | 8.128 | 16.8 | 17.272 |
| fuente valor | 9 | 9.144 | 18.9 | 19.431 |
| fuente remisión | 10 | 10.16 | 21 | 21.59 |
| fuente n.º de guía | 22 | 22.352 | 46.2 | 47.498 |
| interlineado / paso `y` | 4 | 4.064 | 8.4 | 8.636 |
| separación entre campos | 1.5 | 1.524 | 3.15 | 3.239 |
| lado del QR | 26 | 26.416 | 54.6 | 56.134 |
| alto del barcode | 16 | 16.256 | 33.6 | 34.544 |
| hueco QR↔barcode | 4 | 4.064 | 8.4 | 8.636 |

### 3.4 Resolución de los rásteres (R18)

- **Código de barras.** Lo rasteriza `JsBarcode` con `{ height: 60, width: 2,
  fontSize: 18 }` (px) y se estampa sobre ~62 mm de ancho. Si solo se escalaran
  los milímetros, en A4 la misma imagen se estiraría 2.1× y las barras quedarían
  visiblemente pixeladas (y potencialmente ilegibles para un lector láser). Por
  eso las opciones del ráster escalan con `s` y **hacia arriba**:
  `width: ceil(2·s)`, `height: ceil(60·s)`, `fontSize: round(18·s)`.
  Comprobación de que la densidad nunca baja: `4x6in` → width 3 (3/2 = 1.5 ≥
  1.016); `a4` → 5 (2.5 ≥ 2.1); `carta` → 5 (2.5 ≥ 2.159). ✔
- **QR.** Viene del `<canvas>` de la vista previa, fijo en 512 px
  (`EtiquetaGuia.tsx:26`). A 26 mm son 19.7 px/mm (≈500 dpi); a 54.6 mm (A4)
  bajan a 9.4 px/mm (≈238 dpi), muy por encima de lo que necesita un QR de esta
  densidad. **No se toca `EtiquetaGuia.tsx`**: subir el canvas de la vista previa
  encarecería el render de N etiquetas en pantalla para no ganar nada
  perceptible.

---

## 4. Módulos: uno por uno

```
lib/config/etiquetas-hoja.ts                        (N) catálogo puro: tipos + 4 tamaños + default + getHojaEtiqueta + formatMm
app/(app)/ordenes/_components/etiquetas-layout.ts   (N) puro, sin DOM: crearLayout(hoja) -> constantes escaladas + mapX/mapY
app/(app)/ordenes/_components/etiquetas-pdf.ts      (M) recibe la hoja; dibuja con el layout escalado; nombre de archivo por tamaño
app/(app)/ordenes/_components/EtiquetasGuiaModal.tsx(M) estado local del tamaño + selector + descripción dinámica
lib/pdf/etiquetas-pdf-lote.ts                       (=) NO SE TOCA (D3)
lib/config/etiquetas.ts                             (=) NO SE TOCA (§1)
app/(app)/ordenes/_components/EtiquetaGuia.tsx      (=) NO SE TOCA (§3.4)
```

### 4.1 `lib/config/etiquetas-hoja.ts` (nuevo)
Contrato en §2. Sin dependencias (ni siquiera de jspdf). Testeable en Node.

### 4.2 `app/(app)/ordenes/_components/etiquetas-layout.ts` (nuevo)
Función pura `crearLayout(hoja: HojaEtiqueta): EtiquetaLayout` que devuelve el
objeto con `s`, `offX`, `offY`, todas las constantes de §3.3 ya multiplicadas, y
los helpers `x(v)` / `y(v)` de §3. Vive **junto a la página que lo usa** y no en
`lib/`, por la regla "sin sobre-ingeniería" de `docs/architecture.md`: hoy lo
consume un solo módulo. Se separa de `etiquetas-pdf.ts` por una razón concreta:
`etiquetas-pdf.ts` toca `document`/`canvas` y no es testeable en Node, mientras
que toda la aritmética del escalado sí lo es. Sin esta separación, R14–R17 no
tendrían un test barato y determinista.

### 4.3 `etiquetas-pdf.ts` (modificado)
Cambios de contrato:

```ts
// antes
export const ETIQUETAS_PDF_FILENAME = "etiquetas-guia.pdf";
export function buildEtiquetasPdf(etiquetas, qrCanvases): jsPDF;
export function descargarEtiquetasPdf(etiquetas, qrCanvases): void;

// después
export function etiquetasPdfFilename(hoja: HojaEtiqueta): string; // "etiquetas-guia-a4.pdf"
export function buildEtiquetasPdf(etiquetas, qrCanvases, hoja: HojaEtiqueta): jsPDF;
export function descargarEtiquetasPdf(etiquetas, qrCanvases, hoja: HojaEtiqueta): void;
```

- El tercer parámetro es **obligatorio**, no opcional con default. Un default
  silencioso dejaría pasar un llamador que olvidó propagar la elección del
  usuario y el bug saldría como "siempre descarga 100×100"; con parámetro
  obligatorio lo caza el compilador. `ETIQUETAS_PDF_FILENAME` se elimina: no
  tiene consumidores fuera del propio módulo (verificado por grep; los tests solo
  importan `descargarEtiquetasPdf`).
- `new jsPDF({ unit: "mm", format: [hoja.anchoMm, hoja.altoMm] })` y el mismo
  `format` en cada `addPage` (R12, R13).
- `drawEtiqueta` y `drawField` pasan a recibir el `layout` y a mapear cada
  coordenada con `x()`/`y()`; `splitTextToSize` usa `layout.contentWidth`
  (si no, el ajuste de línea se calcularía sobre 88 mm en una hoja A4 y el texto
  quedaría "encogido" en una columna angosta).
- `barcodeDataUrl(value, layout)` aplica §3.4.

**Nombre del archivo (decidido aquí, R19): sí lleva el tamaño.**
`etiquetas-guia-100x100.pdf`, `etiquetas-guia-4x6in.pdf`, `etiquetas-guia-a4.pdf`,
`etiquetas-guia-carta.pdf`. Motivo operativo: el caso real es descargar el mismo
lote en dos tamaños para comparar antes de imprimir; con nombre fijo el navegador
entrega `etiquetas-guia (1).pdf` y el operador ya no sabe cuál es cuál. El coste
(el default deja de llamarse `etiquetas-guia.pdf`) es nulo: nada del repo
depende de ese nombre.

### 4.4 `EtiquetasGuiaModal.tsx` (modificado)
- `const [hojaId, setHojaId] = useState<HojaEtiquetaId>(HOJA_ETIQUETA_DEFAULT_ID)`.
  Se resetea al default en la misma transición `open` que ya reinicia el estado a
  `"cargando"` (`EtiquetasGuiaModal.tsx:87-91`, ajuste durante el render, no en
  `useEffect`): eso da R7 sin efectos extra y sin persistencia (R10).
- Selector con la primitiva existente `components/ui/select.tsx` (`Select` sobre
  `@base-ui/react/select`, rol `combobox`), `aria-label="Tamaño de hoja"`, con
  `options = HOJAS_ETIQUETA.map(h => ({ value: h.id, label: h.label }))`. No se
  crea componente nuevo: la primitiva ya existe (regla de `docs/architecture.md`).
- Se renderiza **solo si `hayImprimibles`** (R11), encima de la grilla de vista
  previa.
- La `description` del Modal deja de ser el literal actual («…una página de
  100 × 100 mm», línea 145) y pasa a componerse con la hoja elegida:
  `Cada etiqueta se descarga como una página de <label> (<ancho> × <alto> mm).`
  con `formatMm` (coma decimal: `215,9`), sin `Intl` para que el texto no dependa
  del locale del runner de tests.
- `handleDescargar` pasa `getHojaEtiqueta(hojaId)` como tercer argumento (R9).

---

## 5. Rutas, endpoints y contratos I/O

**Ninguno.** No hay endpoint nuevo ni modificado, no hay Server Action nueva ni
cambio en `generarEtiquetas({ ordenIds })`, no hay schema zod de borde (no entra
nada externo: el único input es una elección del propio usuario dentro de un
componente cliente, acotada por tipos a `HojaEtiquetaId` y saneada por
`getHojaEtiqueta` en R5). No hay integraciones externas nuevas.

## 6. Modelo de datos

**Ninguno.** Sin tabla, sin columna, sin migración, sin `down.sql`, sin política
RLS. Ver §0, consecuencia 2 de D3.

---

## 7. Alternativas descartadas

1. **Mosaico / N-up (varias etiquetas por hoja A4).** Descartada por **D1**
   (decisión del humano). Se registra aquí para dejar constancia de que se
   evaluó: en A4 caben cuatro etiquetas de 100 × 100 mm, lo que ahorraría papel,
   pero exige guías de corte, cambia la semántica de "una etiqueta = una página"
   en la que se apoya el flujo de impresión térmica actual y multiplicaría los
   casos de borde (última hoja incompleta, lotes que no son múltiplo de 4).
2. **Escalar cada eje por su propio factor (estirar hasta llenar la hoja).**
   Descartada: deforma QR y código de barras hasta comprometer el escaneo (§3.1).
3. **Escalar por el lado mayor.** Descartada: desborda la página (§3.1, punto 3).
4. **Anclar la etiqueta arriba a la izquierda en vez de centrarla.** Descartada
   frente al centrado por el corte manual y el desalineado del medio térmico
   (§3.1). Es la alternativa más cercana a la elegida y la decisión es reversible
   en una línea (`offX`/`offY`), por si la prueba de impresión real dice otra cosa.
5. **Aplicar una matriz de transformación (CTM) de jsPDF en vez de escalar
   constantes.** Sería menos código, pero `splitTextToSize` mide el texto en
   unidades de usuario **sin** conocer la CTM activa: el ajuste de línea se
   calcularía sobre el ancho sin escalar y los siete campos se cortarían mal en
   toda hoja distinta de 100 × 100. Descartada.
6. **Poner el catálogo en `lib/config/etiquetas.ts`** (lo que decía la ficha).
   Descartada: ese módulo lee `process.env` al importarse y el consumidor es un
   componente cliente (§1).
7. **Recordar el último tamaño en `localStorage`.** Descartada por **D2**.
8. **Parametrizar también el generador server-side y/o extraer una maqueta
   compartida entre ambos.** Descartada por **D3**. Sobre la duplicación real que
   ya existe entre `etiquetas-pdf.ts` y `lib/pdf/etiquetas-pdf-lote.ts` (la
   maqueta del segundo es un clon del primero, declarado en su cabecera y en el
   design de la 136): **no se hace nada en esta feature**. Unificarlas exigiría
   un módulo de maqueta agnóstico de rasterizador (browser canvas vs
   `qrcode`/`bwip-js`), que es un refactor de la 136 con su propio riesgo y su
   propio spec. Esta feature aumenta la divergencia en un eje (tamaño) y lo
   declara como deuda conocida en §0.3.

---

## 8. Verificación (cómo se prueba lo que no es puro)

- **Aritmética del escalado** (R14–R17): tests unitarios en Node sobre
  `crearLayout`, sin DOM ni jspdf. Incluye una aserción de encaje: para los
  cuatro tamaños, `offX + s·(100 − margin) ≤ anchoMm` y
  `offY + s·(100 − margin) ≤ altoMm`, y `offX, offY ≥ 0`.
- **Tamaño de página del PDF** (R12, R13, R20): test en entorno `jsdom` sobre
  `buildEtiquetasPdf` con jspdf REAL, mockeando solo `jsbarcode` y estubando
  `HTMLCanvasElement.prototype.toDataURL` con un PNG 1×1 válido (jsPDF decodifica
  la imagen de verdad). Se afirma el `/MediaBox` en puntos según §3.2 y el conteo
  de `/Type /Page`. Precedente exacto del repo:
  `tests/unit/pdf/etiquetas-pdf-lote.test.ts:63-126`.
- **Densidad del ráster** (R18): el mock de `jsbarcode` captura las opciones y se
  afirma `width ≥ 2·s` y `height ≥ 60·s`.
- **Selector y flujo** (R6–R11, R19): `tests/components/EtiquetasGuiaModal.test.tsx`
  con `descargarEtiquetasPdf` mockeada, afirmando el tercer argumento.
- **No-regresión server-side** (R21): test que reafirma el `/MediaBox` de
  283.46 × 283.46 de `buildEtiquetasLotePdf` y que su firma sigue siendo de un
  solo parámetro.

### Tests existentes que este cambio rompe (hay que actualizarlos)

| Test | Por qué rompe |
|---|---|
| `tests/components/EtiquetasGuiaModal.test.tsx:135-138` | afirma `toHaveBeenCalledWith(etiquetas, expect.any(Map))`; ahora hay un tercer argumento |
| `tests/components/EtiquetasGuiaModal.test.tsx` (dialog) | la `description` del modal deja de ser el literal fijo |
| `tests/components/OrdenesListadoEtiquetasChain.test.tsx:38-40` | mockea el módulo entero; al aparecer un import nuevo (`etiquetas-hoja`) hay que confirmar que el mock sigue siendo suficiente |
| `tests/components/OrdenesRevisionMaestro.test.tsx:57` | mismo mock parcial del módulo de PDF |

`tests/unit/services/etiqueta-guia-service.test.ts` **no** se toca: el servicio
resuelve el DTO de la etiqueta y no sabe nada del tamaño de página.

---

## 9. Decisiones ABIERTAS para la puerta humana F1.4

**Ninguna.** D1, D2 y D3 cierran las tres ambigüedades de la ficha, y las cinco
decisiones que este documento tomó por su cuenta quedan argumentadas y son
puntuales de revisar en la puerta:

1. Catálogo en `lib/config/etiquetas-hoja.ts` y no en `lib/config/etiquetas.ts` (§1).
2. Factor único `s = lado_menor / 100` con centrado en ambos ejes (§3.1).
3. `carta` = 215.9 × 279.4 mm exactos, no el 216 × 279 redondeado de la ficha (§2).
4. Nombre de archivo con sufijo del tamaño (§4.3).
5. Ráster del código de barras escalado hacia arriba; QR de la vista previa
   intacto en 512 px (§3.4).

Si el humano discrepa de cualquiera de las cinco, el cambio es local (un módulo
cada una) y no altera los requisitos, salvo la 4, que reescribe R19.
