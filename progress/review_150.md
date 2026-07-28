# Feature 150 — Tamaño de hoja seleccionable en las etiquetas · review

- **Revisado:** `feature/150-tamano-hoja-etiquetas` en el worktree
  `ordenex-wt-150`, dos commits sobre `origin/dev @ 55b0cd4` (`9616928` spec,
  `87683ff` implementación). Diff verificado con `git diff 55b0cd4..HEAD`:
  14 archivos, +2029/-71.
- **Veredicto: `OK` (APROBADO).** 0 bloqueantes, 4 hallazgos menores.

---

## 1. Checklist de CHECKPOINTS.md

### Especificación
- [x] `requirements.md` con R1-R21 en EARS numerados.
- [x] `design.md` con alternativas descartadas y su porqué (§7: ocho, incluida
      estirar por eje y el CTM de jsPDF con su razón técnica).
- [x] `tasks.md` con **T1-T11 todas marcadas `[x]`** (verificado: cero casillas
      `[ ]` en el archivo).

### Trazabilidad
- [x] Cada `R<n>` mapea a al menos un test concreto y no vacío (§3).
- [x] `progress/impl_150.md` contiene el mapa `R<n> -> test` completo.

### Calidad de código (medido por el reviewer en este worktree)
- [x] `pnpm typecheck` -> **0 errores**.
- [x] `pnpm lint` -> **0 errores, 145 warnings**, y **ninguno** en archivos de la
      150: el grep de la salida por `etiquetas-hoja|etiquetas-layout|etiquetas-pdf|EtiquetasGuiaModal`
      no devuelve nada. Los 145 son baseline preexistente de `dev`.
- [x] `pnpm test` -> **522 archivos / 5349 tests, 0 fallos**. Delta frente a la
      baseline del leader (518 / 5308): **+4 archivos, +41 tests, 0 rotos**.
      `tests/unit/guards/no-embalaje.test.ts` **no falló** en ninguna de mis dos
      corridas completas.
- [x] E2E: no aplica (no toca auth, pagos, recaudo, ingesta ni webhooks).

### Datos y seguridad
- [x] Sin tabla ni columna nueva -> RLS no aplica, y `design.md` §6 lo declara
      explícitamente para que no se lea como olvido.
- [x] Sin migraciones -> `down.sql` no aplica; `./init.sh` valida la regla y pasa.
- [x] Sin secretos. El diff no introduce ninguna lectura de `process.env`; al
      contrario, el catálogo se aparta de `lib/config/etiquetas.ts` justamente
      para no arrastrar config server-side al bundle de cliente (R3).
- [x] Webhooks: no aplica.

### Capas / permisos / multi-país
- [x] Sin controller, service ni repository nuevos. `etiquetas-layout.ts` es
      aritmética pura sin DOM; `etiquetas-pdf.ts` es el único que toca
      `document`/`canvas`; el modal solo mantiene estado local.
- [x] Sin Server Actions nuevas: la única llamada al servidor sigue siendo
      `generarEtiquetas({ ordenIds })`, sin el tamaño (afirmado en el test de R10).
- [x] Sin hardcode de país/moneda/cuenta (el monto sigue pasando por `formatMonto`).

### Verificación final
- [x] `./init.sh` termina en verde (`== init OK ==`).
- [x] `progress/review_150.md` (este archivo), veredicto `OK`.
- [ ] Entrada en `progress/history.md` y `status` en `feature_list.json`:
      **pendiente del leader** (ver hallazgo m4).

---

## 2. Decisiones vinculantes de la puerta F1.4, una por una

| Decisión | Veredicto | Evidencia comprobada por el reviewer |
|---|---|---|
| **D1** — una etiqueta por página escalada, nada de mosaico | OK | `buildEtiquetasPdf` hace `addPage(format)` por cada etiqueta desde el índice 1 y dibuja una sola etiqueta por página. El test cuenta objetos `/Type /Page` sobre el PDF real para n = 1, 3, 7 en los cuatro tamaños, y con 4 etiquetas afirma 4 llamadas a `jsbarcode` con los cuatro valores. No hay grilla ni bucle de posiciones dentro de una página. |
| **D2** — tamaño por descarga, default 100x100, sin persistencia | OK | `useState(HOJA_ETIQUETA_DEFAULT_ID)` + reset en la transición de `open`. Cero ocurrencias de `localStorage`, `sessionStorage`, `document.cookie` o envío al servidor en el diff. El test de R10 espía `Storage.prototype.setItem` y el setter de `document.cookie`. |
| **D3** — alcance solo el generador de cliente | OK | `git diff --stat 55b0cd4..HEAD`: **`lib/pdf/etiquetas-pdf-lote.ts` NO aparece**. Tampoco `lib/config/etiquetas.ts`, `EtiquetaGuia.tsx`, `lib/services/`, `app/api/`, `db/` ni `prisma/`. Sin migraciones, sin `down.sql`, sin RLS, sin Server Actions nuevas. El contrato de integradores (feature 88) queda intacto. |
| Catálogo en `lib/config/etiquetas-hoja.ts` | OK | Archivo nuevo sin un solo `import` y sin `process.env`; el test de R3 lo afirma sobre el texto fuente descartando comentarios, que es la forma correcta de probar ausencia de efecto de importación. |
| Factor único `s = lado_menor / 100` con centrado en ambos ejes | OK | Ver §4. |
| `carta` = 215.9 x 279.4 mm exactos | OK | `toEqual` literal en el catálogo y **612 x 792 pt clavados** en el `/MediaBox` del PDF real, que es la razón de ser del valor exacto. |
| Sufijo del tamaño en el nombre del archivo (R19) | OK | `etiquetasPdfFilename(hoja)` -> `etiquetas-guia-<id>.pdf`; `ETIQUETAS_PDF_FILENAME` eliminado y sin consumidores residuales (grep sobre `app/`, `lib/`, `tests/`: cero). |
| Ráster del barcode escalado hacia arriba; QR de la vista previa intacto en 512 px | OK | `barcodeRaster = { width: ceil(2s), height: ceil(60s), fontSize: round(18s) }`. `EtiquetaGuia.tsx` no está en el diff. |

Ninguna decisión vinculante fue violada.

---

## 3. Trazabilidad R1-R21 -> test que lo verifica de verdad

Leí cada test citado; ninguno es un cascarón. La columna resume la aserción real,
no el título.

| R | Test | Qué afirma realmente | OK |
|---|---|---|---|
| R1 | `tests/unit/config/etiquetas-hoja.test.ts` | `toHaveLength(4)` y el array de ids en el orden exacto | si |
| R2 | idem | `toEqual` literal de los cuatro objetos completos + reconversión desde pulgadas (4x25.4, 8.5x25.4, 11x25.4) | si |
| R3 | idem | lee el fuente, quita comentarios y afirma que no hay `process.env`, ni `import`, ni `require` | si |
| R4 | idem | default = `100x100`, pertenece al catálogo y mide 100 x 100 | si |
| R5 | idem | seis ids inválidos (incluidos `__proto__`, `toString` y uno con espacio final) caen al default; y los cuatro válidos NO caen al default | si (el segundo caso evita el falso positivo de un resolvedor que devolviera siempre el default) |
| R6 | `tests/components/EtiquetasGuiaModal.test.tsx` | abre el combobox por su nombre accesible y afirma el texto de las cuatro opciones EN ORDEN | si |
| R7 | idem | valor inicial 100 x 100; y ciclo abrir -> elegir A4 -> cerrar -> reabrir vuelve al default | si |
| R8 | idem | la descripción cambia con la elección y muestra label + mm con coma decimal (215,9 x 279,4) | si |
| R9 | idem | tras elegir A4, `descargarEtiquetasPdf` recibe como tercer argumento el objeto hoja completo (`toEqual` literal, no `expect.anything()`) | si |
| R10 | idem | espías sobre `Storage.prototype.setItem` y el setter de `document.cookie` sin llamadas + `generarEtiquetas` 1 vez con `{ ordenIds }` | si |
| R11 | idem | sin imprimibles: no hay combobox, ni rótulo, ni botón de descarga | si |
| R12 | `etiquetas-pdf.test.ts` + `etiquetas-pdf-descarga.test.ts` | conteo de `/Type /Page` sobre el PDF real (n = 1, 3, 7 x 4 tamaños), un barcode por página, y `addPage` n-1 veces con `[ancho, alto]` | si |
| R13 | `etiquetas-pdf.test.ts` | parsea todos los `/MediaBox` del PDF real contra `mm x 72/25.4` en los cuatro tamaños; casos dedicados para carta (612 x 792) y para el default (283.46) | si |
| R14 | `etiquetas-layout.test.ts` | `s` por hoja; el mismo delta en X y en Y produce el mismo desplazamiento (forma correcta de probar "un solo factor"); y `s` menor que el factor del lado mayor | si |
| R15 | idem | lado/offX/offY contra §3.2, simetría de bandas (`alto - offY - lado === offY`) y una **hoja apaisada inventada** que fuerza `offX > 0` | si |
| R16 | idem | las once constantes de §3.3 contra `base x s` en las cuatro hojas, más los números clavados de A4 y carta | si |
| R17 | idem | `offX, offY >= 0`, bordes derecho/inferior dentro de la página, y el bloque QR+barcode no invade el margen exterior | si |
| R18 | `etiquetas-layout.test.ts` + `etiquetas-pdf.test.ts` | `width >= 2s`, `height >= 60s`, enteros; y las opciones REALES capturadas del mock de `jsbarcode` al construir el PDF | si (cubre el cálculo y su llegada a la librería) |
| R19 | `etiquetas-pdf.test.ts` + `etiquetas-pdf-descarga.test.ts` | los cuatro nombres literales, unicidad por `Set`, y que `doc.save` recibe el nombre correcto | si |
| R20 | `etiquetas-pdf.test.ts` | infla los content streams del PDF real y busca los nueve datos (los cuatro niveles geográficos por separado) en los cuatro tamaños; más el caso del ajuste de línea | si |
| R21 | `tests/unit/pdf/etiquetas-pdf-lote.smoke.test.ts` | `/MediaBox` de todas las páginas en 283.46 pt, `buildEtiquetasLotePdf.length === 1`, y el fuente no menciona `etiquetas-hoja` ni `etiquetas-layout` | si, con reserva -> hallazgo m1 |

**Los 21 requisitos tienen test real. Ninguno queda sin cubrir ni cubierto de
forma decorativa.**

---

## 4. La aritmética del escalado: el desvío del design es correcto

El implementador declara un desvío: `lado = min(ancho, alto)` en vez del
`lado = 100 * s` de `design.md` §3.1.

- **Es el mismo valor matemático**, porque `s = lado / 100`; el desvío solo evita
  el ida y vuelta por el factor. Reproduje el motivo: `101.6/100*100` da
  `101.60000000000001` en doble precisión, lo que dejaría
  `offX = (101.6 - 101.60000000000001)/2 = -7.1e-15` (negativo) y haría caer
  `expect(l.offX).toBeGreaterThanOrEqual(0)` de R17 por puro ruido numérico. Es
  una corrección de precisión, **no un cambio de modelo**.
- **Los números coinciden con `design.md` §3.2**, verificados uno a uno contra el
  código y contra las aserciones:

  | id | s | lado | offX | offY | MediaBox pt |
  |---|---|---|---|---|---|
  | `100x100` | 1 (exacto, `toBe`) | 100 | 0 (`toBe`) | 0 (`toBe`) | 283.46 |
  | `4x6in` | 1.016 | 101.6 | 0 | 25.4 | 288 x 432 |
  | `a4` | 2.1 | 210 | 0 | 43.5 | 595.28 x 841.89 |
  | `carta` | 2.159 | 215.9 | 0 | 31.75 | **612 x 792** (afirmado explícitamente) |

  Y §3.3 sale clavado: A4 margin 12.6, contentWidth 184.8, fontGuia 46.2,
  qrSize 54.6, barcodeHeight 33.6; carta margin 12.954, qrSize 56.134,
  fontGuia 47.498.
- **`100x100` es idéntico a la feature 32**: `s = 1` y offsets `0` con `toBe`
  (igualdad estricta, no `toBeCloseTo`), `x(6) === 6`, `contentWidth === 88` y
  opciones del barcode `{2, 60, 18}` exactas. El default no es regresión visual.
- **El caso apaisado** (`offX > 0`) está cubierto con una hoja inventada: el
  centrado se calcula de verdad y no se asume que el lado menor sea el ancho.
- Revisé que el generador dibuja en coordenadas del lienzo base y las mapea con
  `layout.x()/y()`: no hay ninguna coordenada escalada dos veces ni ninguna
  magnitud dibujada sin escalar. El punto delicado (`splitTextToSize`) usa
  `layout.contentWidth` y está blindado por su propio test (mutación M5).

---

## 5. Pruebas de mutación (reproducidas + propias)

Método: copia de respaldo del archivo fuera del repo, mutación con `sed`/`perl`,
corrida del test dirigido, restauración por copia. **En ningún momento se usó git
para modificar estado**; `git status --porcelain` quedó vacío al terminar.

| # | Mutación | Requisito atacado | Resultado |
|---|---|---|---|
| M1 | `crearLayout`: `Math.min` -> `Math.max` (escalar por el lado mayor) | R14/R15/R17 | **6 tests caídos** en `etiquetas-layout.test.ts`: coincide exactamente con lo reportado |
| M2 | `etiquetasPdfFilename` devuelve el literal fijo `etiquetas-guia.pdf` | R19 | **4 tests caídos** entre `etiquetas-pdf.test.ts` y `etiquetas-pdf-descarga.test.ts`: coincide |
| M3 *(propia)* | `offY = 0` (anclar arriba en vez de centrar verticalmente) | R15 | **1 test caído** (centrado en ambos ejes). Detectado, pero con margen estrecho -> m2 |
| M4 *(propia)* | `Math.ceil` -> `Math.floor` en `barcodeRaster.width/height` | R18 | **2 tests caídos**: uno en el layout y otro sobre las opciones reales que recibe `jsbarcode` |
| M5 *(propia)* | `splitTextToSize(value, 88)` en vez de `layout.contentWidth` (el bug clásico: texto encogido en A4) | R16/R20 | **1 test caído** (ajuste de línea con el ancho escalado). Es exactamente el fallo que predecía `design.md` §7.5, y lo caza sobre el PDF real |
| M6 *(propia)* | quitar `setHojaId(HOJA_ETIQUETA_DEFAULT_ID)` de la transición de `open` (el tamaño se "recuerda" al reabrir) | R7/D2 | **1 test caído** (reabrir vuelve al default) |

Conclusión: los tests son **sensibles, no decorativos**. Las seis mutaciones (dos
reproducidas y cuatro inventadas por el reviewer) fueron detectadas.

Una séptima (parametrizar `buildEtiquetasLotePdf` con parámetros **por defecto**)
no pude ejecutarla porque el classifier bloqueó editar `lib/pdf/etiquetas-pdf-lote.ts`;
la analicé estáticamente y produce el hallazgo m1.

---

## 6. R19 y el aislamiento de la descarga

- `tests/unit/components/etiquetas-pdf-descarga.test.ts` sustituye el módulo
  `jspdf` entero por `JsPDFDoble` vía `vi.mock`, así que `doc.save` nunca llega al
  `fs.writeFileSync` del build de Node. El archivo no importa `node:fs` ni ninguna
  API de disco.
- `tests/unit/components/etiquetas-pdf.test.ts`, que sí usa jspdf **real**, nunca
  llama a `descargarEtiquetasPdf`: solo a `buildEtiquetasPdf` y a
  `etiquetasPdfFilename`, y extrae los bytes con `doc.output("arraybuffer")` en
  memoria.
- **No quedaron PDFs residuales**: `find . -name "*.pdf"` (excluyendo
  `node_modules`) no devuelve nada, `git ls-files "*.pdf"` está vacío y
  `git status --porcelain` quedó limpio tras correr la suite completa dos veces.

---

## 7. Hallazgos

### BLOQUEANTES

**Ninguno.**

### Menores

- **m1 — El blindaje de R21 tiene una rendija: `toHaveLength(1)` no detecta un
  parámetro con valor por defecto.** `Function.length` cuenta solo los parámetros
  anteriores al primero con default (verificado en Node:
  `((a, b = 1, c = 2) => 0).length === 1`). Si alguien "unificara" los generadores
  escribiendo `buildEtiquetasLotePdf(etiquetas, anchoMm = 100, altoMm = 100)`, las
  tres aserciones seguirían pasando: la arity daría 1, el `/MediaBox` seguiría en
  283.46 con los defaults, y el grep del fuente solo busca las cadenas
  `etiquetas-hoja` / `etiquetas-layout`. La divergencia deliberada queda protegida
  contra el refactor evidente (importar el catálogo) pero no contra el sigiloso
  (parametrizar con defaults). Sugerencia para una próxima feature: afirmar sobre
  el fuente que la firma exportada no lleva coma en su lista de parámetros, o que
  `SIZE_MM` sigue siendo la única fuente del `format`. **No bloquea**: el requisito
  tiene test y el riesgo real (que el tamaño elegido por el operador se cuele al
  PDF de integradores) sí está cerrado, porque eso exigiría importar el catálogo
  y el test lo caza.
- **m2 — La mutación M3 (`offY = 0`) solo tumba un test.** El centrado vertical de
  R15 se apoya en una única aserción de simetría dentro de un solo caso. Basta
  para la trazabilidad, pero es el punto más frágil del conjunto.
- **m3 — Desfase de nombre en `tasks.md` T11**: pide la bitácora en
  `progress/impl_150-tamano-hoja-etiquetas.md` y el archivo real es
  `progress/impl_150.md`. El nombre real es el que exige `CHECKPOINTS.md`
  (`impl_<feature>.md`), así que el error está en la tarea, no en el entregable.
- **m4 — Bookkeeping de cierre pendiente (del leader, no del implementador)**: la
  150 sigue en `"status": "pending"` en `feature_list.json` y no hay entrada en
  `progress/history.md`. Además, la `description` de la ficha sigue diciendo
  «catálogo compartido en `lib/config/etiquetas.ts`» y «ambos generadores», que es
  justo lo que D3 y `design.md` §1 descartaron: conviene no usarla como fuente al
  cerrar.

### Observaciones sin acción

- Convenciones: identificadores, nombres de archivo y comentarios sin tildes; el
  texto visible («Tamaño de hoja», «4 × 6 pulgadas», la descripción del modal) en
  español con tildes correctas y coma decimal; los comentarios citan el `R<n>` que
  justifican. Cumple `docs/conventions.md`.
- El rótulo del selector vive en una constante del módulo (`LABEL_TAMANO_HOJA`) y
  no incrustado en la primitiva: bien de cara a i18n.
- Se reutilizó `components/ui/select.tsx` en vez de crear un componente nuevo,
  como manda `docs/architecture.md`.
- Deuda declarada y aceptada: sin prueba de impresión física (el centrado es
  reversible en una línea) y divergencia consciente entre los dos generadores.

---

## 8. Números medidos por el reviewer (no citados de la bitácora)

| Comprobación | Reportado | Medido por el reviewer | Coincide |
|---|---|---|---|
| `pnpm typecheck` | 0 errores | **0 errores** | si |
| `pnpm lint` | 0 errores / 145 warnings, ninguno en la 150 | **0 errores / 145 warnings**, grep sobre los cuatro módulos de la 150 sin coincidencias | si |
| `pnpm test` | 522 archivos / 5349 tests / 0 fallos | **522 / 5349 / 0** (275 s; repetido dentro de `./init.sh`: mismo resultado, 411 s) | si |
| Delta vs baseline (518 / 5308) | +41 tests, 0 rotos | **+4 archivos, +41 tests, 0 rotos** | si |
| `no-embalaje.test.ts` flaky | falló en la 1a corrida | **no falló** en ninguna de mis dos corridas completas | - |
| `./init.sh` | verde | **`== init OK ==`** | si |
| Mutación `min -> max` | 6 tests | **6 tests** | si |
| Mutación nombre fijo | 4 tests | **4 tests** | si |

---

## Veredicto

**`OK` — APROBADO.** 0 bloqueantes, 4 menores (m1-m4), ninguno de los cuales
compromete un requisito ni una decisión vinculante. Las tres decisiones de la
puerta F1.4 (D1, D2, D3) y las cinco del spec se respetan al pie de la letra; el
único desvío documentado (`lado = min(ancho, alto)`) es una corrección de
precisión que produce exactamente los números de `design.md` §3.2; los 21
requisitos tienen un test que los verifica de verdad, y seis pruebas de mutación
(dos reproducidas, cuatro propias) confirman que esos tests son sensibles.

Queda para el leader: cerrar `feature_list.json` y `progress/history.md` (m4).
