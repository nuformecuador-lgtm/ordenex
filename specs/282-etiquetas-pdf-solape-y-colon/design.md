# Feature 282 — Diseño técnico

> El QUÉ está en `requirements.md`. Aquí va el CÓMO, con los números medidos y
> las alternativas descartadas (§7). Feature de **frontend puro**: sin tablas,
> sin RLS, sin migración, sin `down.sql`, sin endpoint (§8).

## 0. Alcance

| Dentro | Fuera |
|---|---|
| `app/(app)/ordenes/_components/etiquetas-pdf.ts` | `lib/pdf/etiquetas-pdf-lote.ts` (feature 136, D3 y **Q1**) |
| `app/(app)/ordenes/_components/etiquetas-layout.ts` | `lib/pdf/etiquetas-ajuste.ts` (compartido con el lote: **no se toca**) |
| `app/(app)/ordenes/_components/EtiquetasGuiaModal.tsx` (borde de error, R16) | `lib/config/moneda.ts` (el formateador es correcto; el que no imprime es el PDF) |
| Artefacto de fuente + su carga diferida (nuevos) | `EtiquetaGuia.tsx` (vista previa DOM: es HTML, el `₡` se pinta con la fuente del sistema y no sufre el defecto) |

El nombre del archivo `etiquetas-pdf.ts` **no cambia**: hay una guardia ajena que
lo lista por ruta (`tests/unit/components/intentos-no-alcance-ui.test.ts:25`) y
renombrarlo la rompería sin motivo.

## 1. Lo que está medido (confirmado en esta sesión, no citado de memoria)

| Hecho | Dónde |
|---|---|
| `margin = 6`, `fontGuia = 22`, `fontValor = 9`, `fontRotulo = 8`, `lineHeight = 4`, `fieldGap = 1.0`, `qrSize = 26` | `etiquetas-layout.ts:24-40` |
| Guía dibujada en `y = margin + 10 = 16` | `etiquetas-pdf.ts:169` |
| Campos arrancan en `CAMPOS_Y_INICIO = 18` | `etiquetas-pdf.ts:54` |
| Límite inferior del texto: `qrY - 2 = 66` (`qrY = 100 - 6 - 26 = 68`) | `etiquetas-pdf.ts:183,199` |
| El monto se formatea con `formatMonto`, y el símbolo sale de `monedaConfig.simbolo` (default `₡`, U+20A1) | `etiquetas-pdf.ts:196`, `lib/config/moneda.ts:59,222` |
| Todo se escala con un **único** factor `s = min(ancho, alto) / 100`, tipografías incluidas | `etiquetas-layout.ts:88-128` |
| El generador del lote **no importa** el de cliente; comparte sólo `etiquetas-ajuste.ts` y `formatMonto` | `lib/pdf/etiquetas-pdf-lote.ts:1-13` |
| En jsPDF, `addFont(...)` usa **Identity-H por defecto** | `node_modules/jspdf/dist/jspdf.node.js:5827` |
| Con Identity-H, jsPDF embebe **un subconjunto** (`subset.encode(glyIdsUsed)`) en `/FontFile2` y escribe un `/ToUnicode` | ídem `:27619-27685` |
| Con `WinAnsiEncoding`, jsPDF embebe `metadata.rawData`: **la fuente entera**. No se usará esa codificación | ídem `:27695-27713` |
| El `/ToUnicode` es un CMap con entradas `beginbfchar` de la forma `<cid><unicode>` en hex de 4 dígitos | ídem `:27568-27610` |
| Con Identity-H el texto se emite en **hexadecimal** (2 bytes por glifo) y un carácter ausente del cmap de la fuente **se cae de la cadena** | ídem `:27800-27844` |

Ese último punto es el que hace verificable el defecto 2: si la fuente no trae el
glifo, el símbolo **desaparece** del PDF y R9 se pone en rojo solo.

## 2. Defecto 1 — el solape

### 2.1 La regla

La línea base de la primera fila de campos deja de ser un literal y pasa a
derivarse del cuerpo del número de guía:

```
PT_A_MM        = 25.4 / 72                     // 0.3527778
GUIA_Y         = margin + 10                   // 16  (sin cambio)
CAMPOS_Y_INICIO = GUIA_Y + fontGuia * PT_A_MM  // 16 + 7.7611 = 23.7611
```

Es decir: **un cuerpo entero (1 em) del número de guía por debajo de su línea
base**. Vive en `etiquetas-layout.ts` (módulo puro, testeable en Node) y
`etiquetas-pdf.ts` lo consume; ahí desaparece la constante `18`.

Por qué 1 em y no una fracción medida: las métricas de tinta (ascendente,
descendente, bbox) de las 14 fuentes estándar **no están en el repo** —jsPDF sólo
expone `metadata.bbox` de fuentes embebidas—, así que cualquier fracción sería un
número inventado. 1 em del cuerpo mayor cubre con holgura el descendente del
número (que además, siendo dígitos, es cero) más el ascendente de la primera
fila, que se dibuja a 8-9 pt: aun tomando 1 em completo para ésta, 3,18 mm
caben en los 7,76 mm que se dan. Ver **Q4**.

### 2.2 Por qué vale para las cuatro hojas sin un solo caso especial

`crearLayout` escala **con el mismo factor `s`** las coordenadas (`layout.y`) y
las tipografías (`layout.fontGuia = 22 * s`). Si la desigualdad
`CAMPOS_Y_INICIO - GUIA_Y ≥ fontGuia · PT_A_MM` se cumple en el lienzo base, al
multiplicar los dos lados por `s` se sigue cumpliendo **exactamente**, para
cualquier hoja presente o futura del catálogo. Ese es el argumento; R3 lo
comprueba igualmente **midiendo sobre el PDF** en las cuatro hojas, porque un
argumento no es una medida (`s` = 1 · 1,016 · 2,10 · 2,159).

### 2.3 Qué cede el cupo vertical, con la aritmética delante

`lineasDisponibles(yInicio, 66, 4, 1.0, 7) = floor((60 - yInicio) / 4) + 1`

| `CAMPOS_Y_INICIO` | Cupo de líneas para 7 campos |
|---|---|
| 18 (hoy) | **11** |
| ≤ 20 | 11 |
| 20,1 … 24,0 | **10** |
| > 24,0 | 9 |

Con 23,7611 el cupo baja de **11 a 10**: se cede **una** línea, y quedan 0,24 mm
hasta el umbral que costaría la segunda. Por eso **no se añade ningún término de
aire extra** a la fórmula: el margen sobre la cota de tinta ya es de ~4,5 mm y
cualquier constante decorativa cruzaría el umbral de 24.

Qué necesita cada caso:

| Caso | Líneas necesarias | ¿Entra con cupo 10? |
|---|---|---|
| Evidencia (7 campos, dirección de 2 líneas) | 8 | Sí, con 2 de holgura (**R7**) |
| El caso que el comentario del propio archivo declara justo (dirección de 3 líneas) | 9 | Sí, con 1 de holgura (**R6**) |
| Dirección de 4 líneas | 10 | Sí, exacto |

Lo que se pierde es holgura, no contenido: el recorte con elipsis
(`recortarConElipsis`) sigue siendo la última defensa y sólo actúa a partir de la
quinta línea de dirección, igual que hoy pero un escalón antes.

> Nota menor, medida: el comentario de `etiquetas-layout.ts:31-35` dice «con 1.0
> el cupo es 10». Con la fórmula que hoy tiene `lineasDisponibles` (que suma 1)
> el cupo es 11. El comentario está desfasado en uno; los números de esta tabla
> salen del código actual, no del comentario.

## 3. Defecto 2 — la fuente embebida

### 3.1 Qué se embebe

- **Candidata: Liberation Sans Regular** (SIL OFL 1.1, TrueType con tabla `glyf`).
  Motivo: es métricamente compatible con Arial/Helvetica, que es la familia con
  la que está maquetada la etiqueta, así que el ancho del importe no se mueve.
- **Debe ser TrueType (`glyf`/`loca`), no CFF/OTF**: el subsetter de jsPDF opera
  sobre `glyf`; una OTF-CFF no produciría `/FontFile2` utilizable.
- La elección **no se da por buena por afirmación**: T1 mide que trae U+20A1 y
  toda la cobertura de R11. Si no la trae, se cae a DejaVu Sans o Noto Sans
  (**Q2**).

### 3.2 Dónde se aplica: sólo el VALOR de «Monto a cobrar»

Los rótulos y los otros seis valores siguen en Helvetica (R12). Es la decisión
que menos riesgo introduce: cambiar la fuente de todo el documento movería el
ancho de la columna de rótulos, el `splitTextToSize` de la dirección y, con
ellos, el cupo que acabamos de recalcular (§7, A4).

Para que medir y dibujar usen la misma fuente, `CampoEtiqueta` gana una fuente
opcional y `drawCampos` la aplica **antes** de `splitTextToSize`, de
`getTextWidth` (el `medir` de la elipsis) y de `doc.text`:

```ts
interface FuenteTexto { nombre: string; estilo: string }
interface CampoEtiqueta { label: string; value: string; fuente?: FuenteTexto }
// default: { nombre: "helvetica", estilo: "normal" }
```

Sin esa disciplina, el reparto se calcularía con las anchuras de una fuente y el
dibujo se haría con las de otra: es justo el género de fallo mudo que esta ficha
viene a cerrar.

### 3.3 Registro en el documento

En `buildEtiquetasPdf`, tras crear el `jsPDF`:

```ts
doc.addFileToVFS(fuente.archivoVfs, fuente.base64);
doc.addFont(fuente.archivoVfs, fuente.nombre, fuente.estilo); // Identity-H por defecto
```

**No se pasa `"WinAnsiEncoding"`**: medido en `jspdf.node.js:27706`, esa rama
embebe `metadata.rawData`, o sea la fuente **completa**, y reventaría R15.

### 3.4 El artefacto y su procedencia (R17)

| Archivo | Qué es | Viaja al navegador |
|---|---|---|
| `assets/fuentes/<fuente>-etiqueta-subset.ttf` | subconjunto TTF, entrada de la regeneración | no |
| `app/(app)/ordenes/_components/etiquetas-fuente.ts` | módulo generado: `base64`, `nombre`, `archivoVfs`, `estilo` + cabecera con origen, versión, SHA-256 y comando de regeneración | **sí** (en chunk diferido) |
| `app/(app)/ordenes/_components/etiquetas-fuente-carga.ts` | `cargarFuenteEtiqueta(): Promise<FuenteEmbebida>` — el **único** sitio con el `import()` dinámico | sí (unos bytes) |
| `licenses/<fuente>-OFL.txt` | licencia íntegra | no |
| `scripts/fuente-etiqueta-a-base64.ts` | convierte el `.ttf` en el `.ts`. **Sin dependencias nuevas**: sólo `node:fs` | no |

El subconjunto se produce **fuera del build**, con la herramienta que el
implementador tenga a mano (`pnpm dlx subset-font`, `pyftsubset`…), y el comando
exacto queda escrito en la cabecera del módulo. Así el repo no gana ninguna
dependencia de producción ni de build, y la reproducibilidad se sostiene con un
test: el base64 que ships decodifica exactamente al `.ttf` commiteado (SHA-256).

Cobertura del subconjunto: **cp1252 imprimible ∪ { `monedaConfig.simbolo` }**
(~230 glifos). Ni más (bytes que nadie usa) ni menos: menos sería una regresión,
porque la Helvetica de hoy cubre todo cp1252 en ese campo (R11).

### 3.5 Carga diferida y contrato de las funciones

```ts
// etiquetas-pdf.ts
export interface FuenteEmbebida {
  nombre: string;      // "LiberationSans"
  archivoVfs: string;  // "LiberationSans-etiqueta.ttf"
  estilo: string;      // "normal"
  base64: string;
}

// SÍNCRONA, con la fuente INYECTADA y OBLIGATORIA (mismo criterio que `hoja`:
// un default silencioso volvería a producir el bug sin que nadie lo vea).
export function buildEtiquetasPdf(
  etiquetas: EtiquetaGuiaDTO[],
  qrCanvases: Map<string, HTMLCanvasElement>,
  hoja: HojaEtiqueta,
  fuente: FuenteEmbebida,
): jsPDF;

// ASÍNCRONA: aquí, y sólo aquí, se cruza el borde de la carga diferida.
export async function descargarEtiquetasPdf(
  etiquetas: EtiquetaGuiaDTO[],
  qrCanvases: Map<string, HTMLCanvasElement>,
  hoja: HojaEtiqueta,
): Promise<void>;
```

El constructor del PDF sigue siendo síncrono y puro respecto de la fuente: se
puede probar con la fuente real sin tocar el `import()`, y el composition root
(el modal → `descargarEtiquetasPdf`) es el que la inyecta de verdad.

**Borde de error (R16).** `cargarFuenteEtiqueta` envuelve el fallo con contexto
(`no se pudo cargar la tipografía de la etiqueta`) y `descargarEtiquetasPdf` lo
propaga. El modal lo captura y muestra:

> «No se pudo preparar la tipografía de la etiqueta. Inténtalo de nuevo.»

y **no** descarga nada. Degradar en silencio a Helvetica sería volver a imprimir
`¡ 8 0` sin que nadie se entere: exactamente el defecto que se está cerrando.

## 4. Cómo se verifica que el glifo sale DE VERDAD (R8-R10)

Un test que compruebe «se llamó a `addFont`» no dice nada sobre el papel. La
verificación afirma sobre **los bytes del PDF generado**, encadenando tres
eslabones, cada uno de los cuales rompería el resultado impreso si fallara:

1. **Content stream → recurso de fuente.** Se localiza en la página 1 el
   `/F<n> <t> Tf` activo cuando se dibuja el monto y el `<hex> Tj` que sigue. El
   objeto `/F<n>` del `/Resources` debe ser `/Subtype /Type0` con
   `/Encoding /Identity-H` (⇒ es la fuente embebida, no una estándar). **R8**.
2. **Hex → Unicode por el propio PDF.** Los 2 bytes de cada glifo se traducen con
   el `/ToUnicode` **que declara ese mismo documento** (entradas
   `<cid><unicode>`). El resultado debe ser, carácter a carácter,
   `formatMonto(18000)` = `₡18.000`, con `20a1` presente. **R9**. Si la fuente no
   tuviera el glifo, jsPDF habría **borrado** el carácter de la cadena
   (`jspdf.node.js:27826`) y esto sale rojo.
3. **CID → contorno en el `/FontFile2`.** `/CIDToGIDMap` es `/Identity`, así que
   el CID **es** el índice de glifo dentro del subconjunto embebido. Se extrae el
   stream `/FontFile2`, se leen `head.indexToLocFormat`, `loca` y `glyf`, y se
   exige que `loca[gid+1] - loca[gid] > 0`, es decir **contorno no vacío**.
   **R10**. Éste es el eslabón que distingue «declarado» de «impreso»: un glifo
   en blanco pasa los dos anteriores y este no.

El lector de TTF vive en `tests/unit/pdf/ttf-lector.ts` (helper de tests, sin
dependencias nuevas) y **se autocomprueba**, porque un lector que siempre diga
que sí es un test verde que no mide nada:

- control positivo: `'0'` tiene glifo con contorno no vacío;
- control negativo: un carácter que la fuente no puede tener (p. ej. U+4E2D `中`)
  resuelve a glifo 0;
- control de vacío: `' '` (espacio) resuelve a un glifo **de contorno vacío** —
  demuestra que el lector sabe distinguir vacío de lleno.

Y se remata con **mutaciones obligatorias** (T13): volver el monto a Helvetica,
sustituir la fuente por una sin `₡`, y volver `CAMPOS_Y_INICIO` a 18 deben poner
en rojo, respectivamente, R8-R10, R9-R11 y R1-R3. Si alguna mutación sale verde,
el test no vale.

## 5. El coste, con su número

### 5.1 Presupuesto

| Concepto | Tope | Objetivo | Cómo se mide |
|---|---|---|---|
| Artefacto que ships (`etiquetas-fuente.ts`, base64) | **80 KB** (81 920 chars) | ≤ 45 KB | guardia ejecutable sobre `base64.length` |
| Chunk diferido en el navegador | ≈ el anterior | — | tamaño del `.js` en `.next/static/chunks` que contiene el base64 |
| **First Load JS de `/ordenes`** | **+0 KB** | +0 KB | salida de `next build` antes/después |
| `/FontFile2` dentro de cada PDF | **12 KB** | ≤ 6 KB | longitud del stream, afirmada en test (R15) |
| Peso del PDF de 1 etiqueta | +12 KB máx. | — | `doc.output("arraybuffer").byteLength` |

Estimación de partida (a confirmar, es justo lo que T1/T14 tienen que medir):
un subconjunto cp1252 de ~230 glifos de una grotesca ronda los **35-45 KB** de
TTF, que en base64 son **~47-60 KB**. El `/FontFile2` de cada PDF es mucho menor
porque jsPDF vuelve a subsetear con **los glifos realmente usados** (≈ 12 para
`₡18.000`): del orden de **2-5 KB**.

### 5.2 Procedimiento de medida (T14)

1. `pnpm exec prisma generate` (un cliente rancio da falsos negativos).
2. `pnpm exec next build` — **no** `pnpm run build`, que además correría
   `scripts/migrate-deploy.ts` contra una base.
3. Anotar la fila de la ruta `/ordenes` («Size» y «First Load JS») antes y
   después, y el tamaño del chunk que contiene la fuente.
4. Todo a `progress/impl_282.md`. Un «no pesa mucho» no cierra R14.

Los comandos que buscan el chunk van **en un archivo de script**, no inline: en
este repo el escapado inline se come una capa y el resultado miente.

## 6. Bordes que hay que endurecer, no relajar

- `tests/unit/components/etiquetas-pdf.test.ts:301-326` afirma hoy el monto
  buscando el trozo ASCII (`"1.235"`) en el stream. Con Identity-H el texto va
  **en hexadecimal** y esa aserción dejará de encontrarlo. **No se borra ni se
  ablanda**: se sustituye por la decodificación vía `/ToUnicode` del §4, que
  afirma **más** que antes (la cadena entera, símbolo incluido).
- `tests/unit/components/etiquetas-pdf-descarga.test.ts` dobla jsPDF con una
  clase mínima: hay que añadirle `addFileToVFS` y `addFont`, y `await` en las
  llamadas. El doble no debe empezar a fingir el subsetting: eso se prueba con
  jsPDF real en el otro archivo.
- `tests/components/EtiquetasGuiaModal.test.tsx` y
  `tests/components/OrdenesListadoEtiquetasChain.test.tsx` mockean el módulo de
  PDF: sus dobles pasan a devolver promesa.
- La sanidad `ys.length >= 16` de ese mismo test sigue cumpliéndose con cupo 10
  (4 textos de cabecera + 7 rótulos + 10 líneas de valor = 21).

## 7. Alternativas descartadas

- **A1 — Imprimir sólo la cifra, sin símbolo** (`18.000`, con el rótulo «MONTO A
  COBRAR» al lado). Coste cero, riesgo cero. **Descartada por decisión firmada
  del humano el 2026-08-25 (D1).** Se deja escrita porque es la salida si Q2 o Q6
  se atascan.
- **A2 — Sustituir `₡` por `CRC ` o `C`.** Misma familia que A1 y además falsea
  el símbolo de la moneda del país. Descartada.
- **A3 — Dibujar el `₡` como trazo vectorial** con las primitivas de jsPDF. 0
  bytes de bundle. Descartada: el glifo no casaría con la tipografía del resto de
  la fila, habría que mantener a mano su avance horizontal (y el importe se
  descuadraría al escalar por `s` en cuatro hojas), y es un rediseño del pipeline
  de dibujo para un carácter.
- **A4 — Embeber la fuente para TODO el documento.** Descartada: cambiaría el
  ancho de cada texto de la etiqueta, y con él la columna de rótulos, el corte de
  la dirección y el cupo que §2.3 acaba de ajustar; el riesgo de un solape nuevo
  en alguna de las cuatro hojas es real y no aporta nada al defecto evidenciado.
  Además obligaría a que el subconjunto cubriera datos de usuario arbitrarios
  (nombres, productos), no un alfabeto acotado.
- **A5 — Embeber la fuente completa sin subsetear.** ~350 KB de TTF (≈ 470 KB en
  base64) frente a ~40 KB. Descartada: el encargo pide acotar el coste, y además
  la rama `WinAnsiEncoding` de jsPDF hace exactamente esto sin quererlo
  (`jspdf.node.js:27706`), motivo por el que §3.3 fija Identity-H.
- **A6 — Servir el `.ttf` desde `public/` y buscarlo con `fetch` al generar.**
  Es más barato en bytes (el base64 en JS cuesta ~+33 % sobre el TTF crudo:
  ~13 KB más sobre 40 KB) y saca la fuente del grafo de módulos. Descartada por
  tres razones concretas: añade un modo de fallo en tiempo de ejecución (un
  despliegue que no suba el asset da 404 y el usuario ve el error de R16 sin que
  ningún test lo haya visto), obliga a doblar `fetch` en los tests del generador,
  y las etiquetas se imprimen en bodega, donde una red mala convierte un asset
  perdido en una descarga bloqueada. El chunk de JS, en cambio, ya está en el
  grafo del build y se cachea con el resto.
- **A7 — Rasterizar el PDF en el test (pdfjs-dist + canvas) y contar píxeles
  negros.** Sería la prueba más literal de «hay tinta». Descartada **de momento**:
  dependencias de desarrollo pesadas (canvas nativo en Windows) y lentas, cuando
  la cadena de tres eslabones del §4 ya distingue declarado de impreso. Queda
  como **Q4** por si se exige.

## 8. Datos, endpoints, integraciones

**Ninguno.** No hay tabla, columna, RLS, migración ni `down.sql`; no hay Server
Action nueva ni route handler; no hay integración externa. La feature se agota en
el generador de PDF del cliente y su modal. `lib/config/moneda.ts` **no se
modifica**: el formateador ya produce la cadena correcta y esa ruta está cubierta
por guardias de dinero que no hay motivo de tocar.

Consecuencia práctica para el gate: el diff no toca migraciones, `lib/types/`,
config de build ni archivos con nombre de dinero, así que `./init.sh --rapido`
es el gate válido para el PR. El artefacto se llama `etiquetas-fuente.ts` —y no
`…-monto…`/`…-cobro…`— también para no arrastrar el diff a la lista de nombres
de dinero sin necesidad.
