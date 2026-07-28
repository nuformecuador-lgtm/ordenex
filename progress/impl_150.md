# Feature 150 — Tamaño de hoja seleccionable en las etiquetas · bitácora de implementación

- **Rama / worktree:** `feature/150-tamano-hoja-etiquetas` en
  `C:\Users\Cristian\Documents\trabajo\arc\ordenex-wt-150` (desde `origin/dev @ 55b0cd4`).
- **Rol:** frontend_dev. Sin backend: cero migraciones, cero `down.sql`, cero RLS,
  cero Server Actions nuevas, cero cambios en `db/`.
- **Alcance respetado (D3):** `lib/pdf/etiquetas-pdf-lote.ts`, `lib/config/etiquetas.ts`,
  `lib/services/EtiquetasLotePdfService.ts`, el contrato de integradores (feature 88)
  y `EtiquetaGuia.tsx` **no se tocaron**. El único `.tsx` de producción modificado
  es `EtiquetasGuiaModal.tsx`.
- **Sin commit:** los cambios quedan en el árbol de trabajo; commitea el leader.

---

## 1. Módulos

### Nuevos (producción)

| Archivo | Qué es |
|---|---|
| `lib/config/etiquetas-hoja.ts` | Catálogo puro: `HojaEtiquetaId`, `HojaEtiqueta`, `HOJAS_ETIQUETA` (4 tamaños en el orden de R1), `HOJA_ETIQUETA_DEFAULT_ID`, `getHojaEtiqueta`, `formatMm`. Sin imports, sin `process.env`, sin lógica al importarse (R3). |
| `app/(app)/ordenes/_components/etiquetas-layout.ts` | Aritmética pura del escalado: `LIENZO_BASE_MM`, `MAQUETA_BASE`, `crearLayout(hoja)` → `s`, `lado`, `offX`, `offY`, constantes escaladas, `x()/y()/escala()` y `barcodeRaster`. Sin DOM, sin jspdf. |

### Modificados (producción)

| Archivo | Cambio |
|---|---|
| `app/(app)/ordenes/_components/etiquetas-pdf.ts` | Tercer parámetro `hoja` **obligatorio** en `buildEtiquetasPdf` y `descargarEtiquetasPdf`; `format: [anchoMm, altoMm]` en `new jsPDF` y en cada `addPage`; dibujo vía `crearLayout` mapeando coordenadas del lienzo base; `splitTextToSize` con `layout.contentWidth`; ráster del barcode escalado; `ETIQUETAS_PDF_FILENAME` eliminado y sustituido por `etiquetasPdfFilename(hoja)`. Ya no queda ninguna constante `SIZE_MM`. |
| `app/(app)/ordenes/_components/EtiquetasGuiaModal.tsx` | Estado local `hojaId` (default del catálogo, reset en la transición de `open`, sin persistencia); `Select` de `components/ui/select.tsx` con `aria-label="Tamaño de hoja"` y `<label htmlFor>` visible, renderizado solo si `hayImprimibles`; `description` compuesta con `formatMm`; `descargarEtiquetasPdf(..., getHojaEtiqueta(hojaId))`. |

### Nuevos (tests)

- `tests/unit/config/etiquetas-hoja.test.ts` (Node)
- `tests/unit/components/etiquetas-layout.test.ts` (Node)
- `tests/unit/components/etiquetas-pdf.test.ts` (jsdom, jspdf **real**)
- `tests/unit/components/etiquetas-pdf-descarga.test.ts` (jsdom, jspdf sustituido)

### Modificados (tests)

- `tests/components/EtiquetasGuiaModal.test.tsx` — actualizada la aserción de
  argumentos (tercer argumento = hoja) **sin relajarla**, y añadido el bloque de
  la feature 150 (R6–R11).
- `tests/unit/pdf/etiquetas-pdf-lote.smoke.test.ts` — añadido el test de
  no-regresión R21 (blindaje de D3).
- `specs/150-tamano-hoja-etiquetas/tasks.md` — casillas `[x]` de T1–T11 y nota
  del desvío de T7.

`tests/components/OrdenesListadoEtiquetasChain.test.tsx` y
`tests/components/OrdenesRevisionMaestro.test.tsx` **no** necesitaron cambio: su
`vi.mock` del módulo de PDF sigue siendo suficiente (solo consumen
`descargarEtiquetasPdf`, y el import nuevo del catálogo es un módulo puro que no
arrastra nada). Se verificó ejecutándolos: 30 tests en verde entre los tres
archivos.

---

## 2. Decisiones tomadas sobre la marcha (ninguna reabre el spec)

1. **`lado = min(ancho, alto)` en vez de `100 · s`.** El ida y vuelta por el
   factor mete error de coma flotante (101.6 → 101.60000000000001) y dejaba
   `offX = −1.42e−14`, un offset negativo que hacía caer la aserción de encaje de
   R17 por puro ruido numérico. Los números de `design.md` §3.2 salen idénticos.
2. **`MAQUETA_BASE` exportado desde `etiquetas-layout.ts`.** El generador dibuja
   en coordenadas del lienzo base de 100 mm y las mapea con `layout.x()/y()`; sin
   las constantes base habría que dividir cada valor escalado entre `s`, que es
   ruido y pierde precisión. Con `100x100` (s = 1, offsets 0) el dibujo es el
   mismo de la feature 32.
3. **Un archivo de test extra para R19 (`etiquetas-pdf-descarga.test.ts`).**
   `doc.save` es propiedad **de instancia** de jsPDF (no del prototipo: no hay
   dónde espiarla) y el build de Node de jspdf —el que resuelve vitest— la
   implementa con `fs.writeFileSync`: llamarla en la suite escribía
   `etiquetas-guia-*.pdf` de verdad en la raíz del repo (comprobado). Por eso ese
   único caso usa un doble de jspdf, y el resto de T7 sigue con jspdf real.
   Registrado también en `tasks.md`.
4. **El rótulo «Tamaño de hoja» va como `<label htmlFor>` visible + `aria-label`
   del combobox.** El texto de UI no está hardcodeado dentro de la primitiva:
   vive en una constante del módulo, lista para i18n.

## 3. Deuda / cosas que quedan abiertas

- **Divergencia consciente entre los dos generadores** (`design.md` §0.3): el PDF
  del modal admite cuatro tamaños; el consolidado por API key sigue en 100 × 100 mm
  fijo. Aceptada por D3 y blindada por el test de R21.
- **Sin verificación de impresión física.** El centrado (`offX`/`offY`) es
  reversible en una línea si una prueba real de impresión en A4/carta dice otra
  cosa (`design.md` §7.4).
- **Sin cambio en el QR de la vista previa** (512 px, `EtiquetaGuia.tsx`): en A4 da
  ~238 dpi, holgado para la densidad de este QR (`design.md` §3.4).

---

## 4. Trazabilidad R1–R21 → test

| R | Test | Caso |
|---|---|---|
| R1 | `tests/unit/config/etiquetas-hoja.test.ts` | «expone exactamente cuatro tamaños, siempre en el mismo orden» |
| R2 | `tests/unit/config/etiquetas-hoja.test.ts` | «declara las dimensiones exactas…» + «4x6in y carta son la conversión exacta de sus pulgadas» |
| R3 | `tests/unit/config/etiquetas-hoja.test.ts` | «el módulo del catálogo no lee el entorno ni importa nada» (aserción sobre el texto fuente) |
| R4 | `tests/unit/config/etiquetas-hoja.test.ts` | «el tamaño por defecto es 100x100 y pertenece al catálogo» |
| R5 | `tests/unit/config/etiquetas-hoja.test.ts` | «un identificador desconocido se resuelve al default» + «un identificador válido devuelve su propia hoja» |
| R6 | `tests/components/EtiquetasGuiaModal.test.tsx` | «muestra el selector «Tamaño de hoja» con las cuatro opciones del catálogo, en orden» |
| R7 | `tests/components/EtiquetasGuiaModal.test.tsx` | «al abrir, el tamaño seleccionado es el default» + «reabrir el modal vuelve al default» |
| R8 | `tests/components/EtiquetasGuiaModal.test.tsx` | «la descripción del modal muestra la etiqueta visible y los mm del tamaño elegido» |
| R9 | `tests/components/EtiquetasGuiaModal.test.tsx` | «la descarga usa el tamaño seleccionado en ese momento» |
| R10 | `tests/components/EtiquetasGuiaModal.test.tsx` | «NO persiste el tamaño en el navegador ni lo manda al servidor» (espías sobre `Storage.prototype.setItem` y el setter de `document.cookie`) |
| R11 | `tests/components/EtiquetasGuiaModal.test.tsx` | «sin etiquetas imprimibles no hay selector de tamaño ni descarga» |
| R12 | `tests/unit/components/etiquetas-pdf.test.ts` | «produce tantas páginas como etiquetas, en los cuatro tamaños» + «cada página dibuja UNA sola etiqueta»; y `etiquetas-pdf-descarga.test.ts` «añade una página por etiqueta adicional, con el formato de la hoja» |
| R13 | `tests/unit/components/etiquetas-pdf.test.ts` | «declara TODAS las páginas con el tamaño exacto del catálogo» + «carta sale en 612 × 792 pt clavados» + «el default sigue siendo 283.46 pt» |
| R14 | `tests/unit/components/etiquetas-layout.test.ts` | «el factor sale del lado MENOR» + «es UN SOLO factor: X e Y escalan exactamente igual» + «NUNCA escala por el lado mayor» |
| R15 | `tests/unit/components/etiquetas-layout.test.ts` | «hojas no cuadradas: bloque cuadrado del lado menor, centrado en ambos ejes» + «100x100: s = 1 y offsets 0» + «hoja apaisada» |
| R16 | `tests/unit/components/etiquetas-layout.test.ts` | «margen, ancho de contenido, tipografías, interlineado, QR y barcode usan el mismo factor» + «los números de design.md §3.3 salen clavados» |
| R17 | `tests/unit/components/etiquetas-layout.test.ts` | «el bloque útil cabe entero y los offsets no son negativos» + «el bloque QR + barcode no invade el margen exterior» |
| R18 | `tests/unit/components/etiquetas-pdf.test.ts` | «las opciones de jsbarcode escalan con el factor y nunca pierden densidad» + «con 100x100 conserva 2 / 60 / 18»; y `etiquetas-layout.test.ts` «las opciones del ráster nunca bajan de la densidad de 100x100» |
| R19 | `tests/unit/components/etiquetas-pdf.test.ts` («el nombre del archivo lleva el identificador…», «dos tamaños distintos NUNCA producen el mismo nombre») + `tests/unit/components/etiquetas-pdf-descarga.test.ts` («guarda con el nombre que incluye el identificador», «dos descargas… no producen el mismo nombre») | |
| R20 | `tests/unit/components/etiquetas-pdf.test.ts` | «los nueve datos quedan escritos en cualquier tamaño del catálogo» (+ «el ajuste de línea usa el ancho ESCALADO») |
| R21 | `tests/unit/pdf/etiquetas-pdf-lote.smoke.test.ts` | «el generador server-side sigue en 100 × 100 mm y sin parámetro de tamaño» (MediaBox de todas las páginas, `buildEtiquetasLotePdf.length === 1`, y el fuente no importa `etiquetas-hoja`/`etiquetas-layout`) |

Los 21 requisitos tienen test. Ninguno queda sin cubrir.

---

## 5. Verificación (números medidos, no supuestos)

| Comprobación | Resultado |
|---|---|
| `pnpm typecheck` | **0 errores** (igual que la baseline de la rama) |
| `pnpm lint` | **0 errores**, 145 warnings — ninguno en archivos de esta feature (verificado con grep sobre la salida); los warnings son el baseline preexistente |
| `pnpm test` (suite completa) | **522 archivos, 5349 tests: 0 fallos** (ver nota) |

**Nota sobre la primera corrida de la suite.** En la primera pasada falló
`tests/unit/guards/no-embalaje.test.ts` con `Test timed out in 20000ms`. No es un
fallo de aserción ni tiene relación con este diff: ese test recorre el árbol de
archivos del repo buscando la palabra «embalaje», no importa ninguno de los
módulos tocados, y ninguno de los archivos de esta feature contiene esa palabra
(verificado con `grep -li embalaje` sobre los cuatro: exit 1, sin coincidencias).
Corrido en aislado pasa en **2.3 s**. Es la flakiness por contención de CPU que
documenta el propio `vitest.config.ts` (`testTimeout: 20000`, comentario sobre
HomePage/OrdenesModuleReuse). La segunda corrida completa quedó en verde.

### Prueba de mutación

| Mutación | Tests caídos |
|---|---|
| `crearLayout`: `Math.min(ancho, alto)` → `Math.max(ancho, alto)` (escalar por el lado mayor, viola R14/R15/R17) | **6 fallos** en `tests/unit/components/etiquetas-layout.test.ts` (el resto de `tests/unit/components/` siguió en verde: 149 pasados) |
| `etiquetasPdfFilename`: devolver el literal fijo `"etiquetas-guia.pdf"` (viola R19) | **4 fallos**, repartidos entre `etiquetas-pdf.test.ts` y `etiquetas-pdf-descarga.test.ts` |

Las dos mutaciones fueron revertidas y `tests/unit/components/` volvió a
**147/147 en verde** antes de cerrar.
