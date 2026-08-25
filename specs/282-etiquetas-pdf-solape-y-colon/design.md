# Feature 282 — Diseño técnico

> El QUÉ está en `requirements.md`. Aquí va el CÓMO, con los números medidos y
> las alternativas descartadas (§7). Feature de **frontend puro**: sin tablas,
> sin RLS, sin migración, sin `down.sql`, sin endpoint (§8).

## 0. Alcance

> **§0 REVISADO el 2026-08-25 (Q1): entran los dos generadores.** La tabla de
> abajo ya refleja el alcance nuevo; el detalle de qué se comparte y qué no está
> en **§10**. La ficha pasa de `frontend` a `fullstack` (backend → frontend).

| Dentro | Fuera |
|---|---|
| `app/(app)/ordenes/_components/etiquetas-pdf.ts` (generador de cliente) | `lib/config/moneda.ts` (el formateador es correcto; el que no imprime es el PDF) |
| `lib/pdf/etiquetas-pdf-lote.ts` (generador server-side, feature 136) | `lib/pdf/etiquetas-ajuste.ts` (reparto de líneas: correcto, **no se toca**) |
| `app/(app)/ordenes/_components/etiquetas-layout.ts` → se muda a `lib/pdf/` (§10) | `EtiquetaGuia.tsx` (vista previa DOM: es HTML, el `₡` se pinta con la fuente del sistema y no sufre el defecto — **Q10**) |
| `app/(app)/ordenes/_components/EtiquetasGuiaModal.tsx` (borde de error, R16) | `EtiquetasLotePdfService`, `ApiPdfEtiquetaService` y las rutas de API: **no cambian** (llaman al builder, no a la maqueta) |
| Módulos compartidos nuevos de `lib/pdf/` + artefacto de fuente (§10) | La factura de cierre (es HTML, no jsPDF) |

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

---

# Ampliación del 2026-08-25 — cierre de Q1…Q6

## 9. El defecto está en los dos generadores

Medido sobre `lib/pdf/etiquetas-pdf-lote.ts` (188 líneas, runtime Node):

| Defecto | Dónde, en el generador del servidor |
|---|---|
| `CAMPOS_Y_INICIO = 18` | línea 53 |
| guía en `MARGIN + 10` con cuerpo 22 | líneas 128-131 |
| `formatMonto` (símbolo `₡`) sobre Helvetica | línea 152 |
| Misma banda de códigos fija (`qrY = 100 - 6 - 26`) | línea 141 |

Sus consumidores, que **no cambian** (llaman al builder, no a la maqueta):
`EtiquetasLotePdfService.generarYAlmacenar` (PDF consolidado) y
`generarYAlmacenarPorOrden` (**un PDF por orden**, feature 141),
`ApiPdfEtiquetaService`, y las rutas `app/api/ordenes/api-key/carga/route.ts`,
`…/carga/[cargaId]/generate/route.ts` y `…/orden/[id]/generate/route.ts`.

## 10. Compartir o duplicar: se COMPARTE

**Decisión: una sola maqueta, en `lib/pdf/`.** No se arregla dos veces.

### 10.1 Por qué, con el hecho que lo decide

La cabecera del generador del servidor declara ser «espejo EXACTO» del de
cliente. **Ya no lo es, y se puede medir**: la feature 150 llevó el de cliente a
constantes escaladas (`layout.fontRotulo`, `layout.fontGuia`, `layout.fontValor`)
mientras el del servidor conserva `8`, `22`, `10` escritos a mano en
`drawEtiqueta` (líneas 128-137) y su propio juego de constantes (líneas 24-57).
Un espejo que se mantiene a mano diverge en cuanto alguien toca un lado, y esta
ficha existe porque **el mismo defecto vive por duplicado**. Duplicar el arreglo
sería duplicar también la próxima corrección.

El repo ya resolvió esto una vez y de la manera correcta:
`lib/pdf/etiquetas-ajuste.ts` se extrajo precisamente para que «las dos maquetas
no vuelvan a divergir en este punto» (su propia cabecera). Se extiende ese
precedente al resto de la geometría. Y `docs/architecture.md` lo respalda: un
módulo se promueve a compartido **cuando dos consumidores lo necesitan con la
misma API**, que es exactamente el caso.

### 10.2 Qué se comparte y qué no

| Módulo | Qué contiene | Estado |
|---|---|---|
| `lib/pdf/etiquetas-maqueta.ts` | `LIENZO_BASE_MM`, `MAQUETA_BASE` (incluido `guiaY`), `PT_A_MM`, `camposYInicio()`, `GAP_TEXTO_CODIGOS`, `GAP_ROTULO_VALOR`, `qrTopBase()` | NUEVO, puro |
| `lib/pdf/etiquetas-layout.ts` | `crearLayout` y `EtiquetaLayout` | **MUDADO** desde `app/(app)/ordenes/_components/` |
| `lib/pdf/etiquetas-dibujo.ts` | cabecera (GUÍA / REMISIÓN), `drawCampos`, `geografiaLegible` y la colocación de las dos imágenes que recibe ya rasterizadas | NUEVO |
| `lib/pdf/etiquetas-fuente.ts` | artefacto generado: `base64`, `nombre`, `archivoVfs`, `estilo`, `COBERTURA`, `PESO_DECLARADO_BYTES` | NUEVO (**corrige §3.4**: ya no vive bajo `app/`, porque el servidor no puede importar de ahí) |
| `lib/pdf/etiquetas-fuente-registro.ts` | `registrarFuente(doc, fuente)` y `cubreTexto(fuente, texto)` | NUEVO |
| `app/(app)/ordenes/_components/etiquetas-fuente-carga.ts` | el **único** `import()` dinámico, sólo para el navegador | NUEVO |
| `lib/pdf/etiquetas-ajuste.ts` | reparto de líneas y elipsis | SIN TOCAR |

**Lo que NO se comparte, y por qué:** el rasterizado. El cliente saca el QR del
`<canvas>` de la vista previa y dibuja el código de barras con `jsbarcode` sobre
un canvas del DOM; el servidor usa `qrcode` y `bwip-js` porque corre en Node sin
DOM. Es la razón por la que la feature 136 no reusó el generador de cliente y
sigue siendo válida. Cada generador rasteriza lo suyo y **pasa los data URL** al
módulo de dibujo compartido.

El escalado deja de ser exclusivo del cliente: el servidor usa el mismo
`crearLayout` con la hoja `100x100`, donde `s = 1` y `offX = offY = 0`, así que
**el resultado numérico es idéntico** al de sus literales actuales. Eso es
demostrable, no opinable: los `Td` del PDF del servidor sólo deben moverse en lo
que R19 exige.

`app/(app)/ordenes/_components/etiquetas-layout.ts` desaparece y sus dos tests
actualizan el import. No se deja un archivo-puente re-exportando: un puente es
otro sitio donde volver a divergir.

### 10.3 Qué impide que vuelvan a divergir

Tres cosas, en orden de fuerza:

1. **R22, un test que compara los dos PDF.** Para el mismo `EtiquetaGuiaDTO` y la
   hoja de 100 × 100, se extraen los `x y Td` y el texto de los dos documentos y
   se exige que **coincidan**. Si alguien mueve una línea base en un generador y
   no en el otro, sale rojo, aunque ninguno de los dos tests propios lo note.
2. **R21 + guardia de fuente.** Ninguno de los dos archivos puede declarar por su
   cuenta las constantes de la maqueta: la guardia lee su texto y falla si
   reaparece un `CAMPOS_Y_INICIO`, un `FONT_ROTULO`, un `LINE_HEIGHT`, un
   `MARGIN` o un `SIZE_MM` propio.
3. **El compilador.** Al no existir ya las constantes locales, escribir un número
   a mano exige *añadir* código nuevo, no *olvidar* actualizarlo. Es la
   diferencia entre un error por comisión y uno por omisión.

## 11. La fuente en el servidor: otro mecanismo, otro presupuesto

### 11.1 Cómo se carga

**Import estático del mismo artefacto** (`lib/pdf/etiquetas-fuente.ts`) desde
`lib/pdf/etiquetas-pdf-lote.ts`. Sin `fs`, sin rutas, sin `await`.

Por qué no `readFileSync` de un `.ttf`: `next.config.ts` **no declara ningún
`outputFileTracingIncludes`** (medido), así que un archivo suelto leído por ruta
en tiempo de ejecución depende del trazado automático, que no sigue rutas
construidas. El fallo aparecería **sólo en producción**, como un 500 en la carga
por API, que es el peor sitio: el PDF es best-effort y el integrador vería
`etiquetasPdf: { error }` sin que ningún test lo hubiera visto antes (R23).

En el navegador el mecanismo sigue siendo el de §3.5 (import dinámico): el
servidor no tiene bundle que engordar, el navegador sí.

### 11.2 Arranque en frío

Lo que la función gana al arrancar es el módulo con la cadena base64 (~50 KB de
JS, frente al límite de 250 MB de la function: irrelevante) y su parseo, que es
el de un literal de cadena. **El coste real no está en el arranque**: está en
`addFont`, y se paga **por documento**.

Medido en la propia librería (`jspdf.node.js:26783-26797`): en cada `addFont`
jsPDF hace `atob(base64)` → `Uint8Array` → `TTFFont.open(...)`, es decir
descodifica y **parsea la fuente entera** una vez por cada `jsPDF` creado. Un
lote consolidado crea **un** documento; el modo individual de la feature 141
crea **N**.

### 11.3 Presupuesto de tiempo, con los números del repo

Datos ya medidos y escritos en `lib/config/etiquetas.ts`: ~18 ms de render por
etiqueta, tope por defecto **300** (~5,6 s), techo duro **1000** (~18 s), y
`maxDuration = 60` en la ruta, que además paga la inserción del lote.

Reservando el 40 % del presupuesto para esa inserción (36 s para el PDF):

```
(18 ms + f) × N ≤ 36 000 ms
N = 300  (default)    →  f ≤ 102 ms por documento
N = 1000 (techo duro) →  f ≤  18 ms por documento
```

`f` = lo que cuesta `addFont` con el subconjunto elegido. **Hay que medirlo**
(T18), en los dos modos:

| Modo | Documentos | Veces que se paga `f` |
|---|---|---|
| Consolidado (`generarYAlmacenar`) | 1 | 1 — irrelevante frente a los 5,6 s de render |
| **Individual** (`generarYAlmacenarPorOrden`) | N | **N — es el peor caso y el que manda** |

Si `f` no cabe (Q8), las salidas declaradas son: estrechar el subconjunto
(debilita R11), bajar `ETIQUETAS_MAX_POR_PDF` por entorno, o excluir el modo
individual. **No** se elige ninguna sin preguntar.

### 11.4 Presupuesto de bytes en esa ruta

Cada documento embebe su propio `/FontFile2`. La feature 136 midió ~3,3 KB de PDF
por etiqueta con `compress: true`; el subconjunto embebido (~2-5 KB, ya
deflatado) es **por documento**:

| Modo | Antes | Después (estimado, a medir) |
|---|---|---|
| Consolidado, 300 etiquetas | ~1 MB | ~1 MB + 12 KB máx. (**+1 %**) |
| Individual, 300 PDFs | ~1 MB | **~4 MB** (×3-4) |

El consolidado no se entera; el individual sí, y va a Storage. Es **Q9**.

## 12. La verificación vale para las dos salidas

La cadena de tres eslabones del §4 no depende del runtime: opera sobre los bytes
del PDF. Se aplica igual a `buildEtiquetasLotePdf`, con dos ajustes:

- ese builder usa `compress: true`, así que los content streams van deflatados y
  hay que inflarlos — el test del lote (`tests/unit/pdf/etiquetas-pdf-lote.test.ts`)
  **ya lo hace**, y el helper de inflado del test de cliente también;
- es `async` y mockea `qrcode` / `bwip-js`, que es como ya está montado.

El mismo `tests/unit/pdf/ttf-lector.ts` sirve para los dos. R20 exige el
resultado sobre el PDF del servidor; R9/R10 sobre el del navegador.

## 13. El cupo, y cómo se pone rojo (Q3)

Firmado: se cede la línea (11 → 10). No se toca el cuerpo del número de guía ni
la banda de códigos (R27): ahí leen las pistolas, y `qrSize`, `barcodeHeight` y
`gapQrBarcode` se quedan exactamente como están.

Lo que se añade es que **el recorte deje de ser silencioso**: un corpus declarado
de casos, en `tests/fixtures/etiquetas-282.ts`, y un test que falla si **alguno**
sale con marca de recorte (R26). El corpus arranca con:

| Caso | De dónde sale |
|---|---|
| Evidencia: guía `19887906`, dirección de 2 líneas, `₡18.000`, `GAM / San José / Mora / Colón` | etiqueta real de producción |
| Dirección de 3 líneas | el peor caso que el propio código declara justo (`etiquetas-layout.ts:31-35`) |
| Ubicación con los cuatro niveles + destinatario y producto largos | forma, no dato real |

Honestidad sobre el corpus: sólo el primero es un caso **real**; los demás son
**formas**. Ver **Q7**.

## 14. Cobertura declarada y fallo visible (Q5)

`lib/pdf/etiquetas-fuente.ts` exporta, **generado desde el propio archivo de
fuente** (nunca escrito a mano), el conjunto de code points que el subconjunto
cubre, y `cubreTexto(fuente, texto)` responde en O(longitud del texto).

Antes de dibujar con la fuente embebida, cada generador comprueba el texto
completo del campo —no sólo el símbolo, porque
`formatMontoString` tiene una rama que pinta **verbatim** lo que no tenga forma
de decimal— y si algo no está cubierto **lanza** un error con contexto
(`el símbolo «X» (U+XXXX) no está en el subconjunto embebido`).

| Canal | Qué ve el usuario |
|---|---|
| Navegador | el mensaje de R16 en el modal y **ninguna descarga** |
| API de carga | HTTP 200 con `etiquetasPdf: { error }`, la carga **no** revertida y los `num_guia` intactos — el camino best-effort que ya existe (`app/api/ordenes/api-key/carga/route.ts:90-96`) |

Es decir: el fallo usa los canales de fallo que el sistema ya tiene, y ninguno de
los dos imprime una etiqueta con el importe roto. Que es lo que hoy pasa en la
calle sin que nadie se entere.

Un test de R29 comprueba que la cobertura **declarada** coincide con la del
archivo embebido (leída con `ttf-lector`): una declaración que mienta sería peor
que no tenerla.

## 15. Alternativas descartadas (ampliación)

- **A8 — Arreglarlo dos veces, una en cada generador.** Es lo más pequeño en
  diff. Descartada: el «espejo EXACTO» que declara la cabecera del generador del
  servidor **ya está roto** (§10.1), lo que demuestra que el mantenimiento manual
  no sostiene la copia. Si aun así se eligiera duplicar, lo único que impediría
  la divergencia sería el test comparativo de R22 — es decir, habría que escribir
  igualmente la parte cara, y quedarse con dos copias que corregir cada vez.
- **A9 — Unificar también el rasterizado en un solo módulo.** Descartada: las
  librerías son distintas **por runtime** (DOM vs Node), que es la razón
  documentada de que existan dos generadores. Unificarlo obligaría a inyectar un
  rasterizador y a arrastrar `jsbarcode` al servidor o `bwip-js` al navegador.
- **A10 — Leer el `.ttf` con `fs` en el servidor.** Descartada por §11.1: sin
  `outputFileTracingIncludes` el archivo puede no llegar a la función y el fallo
  sólo aparece en producción.
- **A11 — Un artefacto de fuente distinto (o más pequeño) para el servidor.**
  Descartada: dos artefactos son dos coberturas, dos pesos y dos verdades; R22
  dejaría de poder comparar los dos PDF.
- **A12 — Dejar el modo individual sin fuente embebida** para ahorrar `f × N`.
  Descartada de entrada: sería exactamente el defecto que la ficha cierra, vivo
  «según qué botón se pulse». Si el presupuesto no da, se decide en Q8, no en
  silencio.

## 16. Orden de trabajo

La ficha es `fullstack`: **primero backend** (módulos compartidos de `lib/pdf/`,
artefacto, generador del servidor y su verificación), **después frontend**
(generador de cliente, carga diferida, modal). El bloque compartido es la
dependencia de los dos, así que va antes que ambos.

El gate sigue siendo `./init.sh --rapido`: el diff no toca migraciones,
`db/schema.prisma`, `lib/types/`, configuración de build ni archivos con nombre
de dinero. Sí toca `lib/pdf/` y `app/api/…` sólo de rebote (nada de las rutas
cambia), así que conviene correr además los tests de integración de la carga por
API antes del PR.
