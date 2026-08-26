# Feature 282 — Bitácora de implementación (BACKEND + módulos compartidos)

> Rama `feature/282-etiquetas-pdf-solape-y-colon`. Esta tanda cubre **todo salvo
> la UI del navegador**: la extracción de la maqueta compartida, el generador del
> servidor, el artefacto de fuente y toda su verificación. Lo que queda para
> `frontend_dev` está en § 7, con nombre y apellidos.

## 1. Qué estaba roto, y con qué evidencia

Una etiqueta real de producción salía con el número de guía **pisando la fila
«DESTINATARIO»** y con el importe como `¡ 8 0` en vez de `₡18.000`.

- **Solape.** La guía se dibujaba en `y = margin + 10 = 16` con `fontGuia = 22` pt
  (**7,761 mm**) y los campos arrancaban en `CAMPOS_Y_INICIO = 18`: **2 mm** de
  separación entre líneas base. En **todas** las etiquetas, no en un caso raro.
- **Colón.** `₡` es **U+20A1** y no existe en el juego WinAnsi/cp1252 de las 14
  fuentes estándar de jsPDF.
- **Y vivía por duplicado.** El generador del servidor declaraba en su cabecera
  ser «espejo EXACTO» del de cliente y **ya no lo era**: la feature 150 llevó el
  de cliente a constantes escaladas (`layout.fontGuia`…) mientras aquel conservaba
  `8`, `22` y `10` escritos a mano. Ese comentario se ha corregido.

## 2. Archivos

### Creados

| Archivo | Qué es |
|---|---|
| `lib/pdf/etiquetas-maqueta.ts` | **La única fuente de verdad** de la geometría (R21). `camposYInicio()` derivada. |
| `lib/pdf/etiquetas-dibujo.ts` | El dibujo del texto de la etiqueta, una sola vez (cabecera, `drawCampos`, `camposDeEtiqueta`, `drawEtiqueta`). |
| `lib/pdf/etiquetas-fuente.ts` | **Generado.** Artefacto: `base64`, `cobertura`, `PESO_DECLARADO_*`, cabecera de procedencia. |
| `lib/pdf/etiquetas-fuente-registro.ts` | `registrarFuente`, `cubreTexto`, `exigirCobertura` y el tipo `FuenteEmbebida`. |
| `app/(app)/ordenes/_components/etiquetas-fuente-carga.ts` | El **único** `import()` dinámico del artefacto (navegador). |
| `assets/fuentes/LiberationSans-etiqueta-subset.ttf` | Subconjunto TTF commiteado (entrada de la regeneración). |
| `licenses/LiberationSans-OFL.txt` | Licencia íntegra (SIL OFL 1.1). |
| `scripts/fuente-etiqueta-a-base64.ts` | Convierte el `.ttf` en el módulo. Sin dependencias nuevas. |
| `tests/unit/pdf/ttf-lector.ts` + `.test.ts` | Lector de TTF **autocomprobado** (tres controles). |
| `tests/unit/pdf/pdf-inspector.ts` | Inspector de PDF: objetos, content stream, recursos de fuente, `/ToUnicode`, `/FontFile2`. |
| `tests/unit/pdf/etiquetas-maqueta.test.ts` | R1, R2, R3, R25, R27. |
| `tests/unit/pdf/etiquetas-fuente.test.ts` | R11, R14, R17, R28, R29, R30. |
| `tests/unit/pdf/etiquetas-dos-generadores.test.ts` | R22, la comparación de los dos PDF. |
| `tests/unit/guards/etiquetas-maqueta-unica.guardia.test.ts` | R21. |
| `tests/unit/guards/etiqueta-fuente-diferida.guardia.test.ts` | R13, R14, R23. |
| `tests/fixtures/cp1252.ts` | El juego que R11 exige, **de la especificación**, no del artefacto. |
| `tests/fixtures/etiquetas-282.ts` | Corpus de referencia (R26, R34). |

### Movidos / modificados

| Archivo | Cambio |
|---|---|
| `app/(app)/ordenes/_components/etiquetas-layout.ts` → `lib/pdf/etiquetas-layout.ts` | **Mudado, sin archivo-puente.** Gana `crearLayoutBase()`. |
| `lib/pdf/etiquetas-pdf-lote.ts` | Pierde `SIZE_MM`, `MARGIN`, `CONTENT_WIDTH`, `FONT_*`, `LINE_HEIGHT`, `FIELD_GAP`, `CAMPOS_Y_INICIO`, `GAP_*`, su `drawCampos` y su `drawEtiqueta`. Registra la fuente una vez por documento. Su firma pública **no cambia**. |
| `app/(app)/ordenes/_components/etiquetas-pdf.ts` | Igual: sólo conserva el rasterizado con DOM. `buildEtiquetasPdf` gana un 4.º parámetro **obligatorio** (`fuente`); `descargarEtiquetasPdf` pasa a `async`. |
| `.gitattributes` | `*.ttf binary`: un byte convertido dejaría el TTF ilegible y el sha256 en rojo. |
| `tests/unit/components/etiquetas-pdf.test.ts` | Import del layout, 4.º parámetro, y la aserción del monto **endurecida** (§ 5). Bloques nuevos R1/R3/R4/R6/R7/R8/R9/R10/R12/R15/R26/R34. |
| `tests/unit/components/etiquetas-pdf-descarga.test.ts` | El doble de jsPDF gana `addFileToVFS`/`addFont`; llamadas `await`; R16 y el canal navegador de R28. |
| `tests/unit/pdf/etiquetas-pdf-lote.test.ts` | Aserción del monto endurecida + R19, R20, R15, R23, R24, R26, R28, R34. |
| `tests/unit/pdf/etiquetas-pdf-lote.smoke.test.ts` | Blindaje de la 150 **reformulado** (§ 6). |
| `tests/unit/components/etiquetas-layout.test.ts` | Sólo el import. |
| `tests/integration/carga-api-etiquetas.test.ts` | R28 por el canal best-effort de la API. |

## 3. Los números MEDIDOS, con su tope

Nada de esto es estimación. Los tres primeros son los que el encargo pedía medir.

### 3.1 Peso del artefacto (R14)

| Medida | Valor | Tope / objetivo | Veredicto |
|---|---|---|---|
| TTF del subconjunto | **16 944 B** (16,5 KB) | — | — |
| `base64` que viaja | **22 592 chars** (22,1 KB) | tope **81 920** · objetivo **46 080** | **CUMPLE los dos** (27,6 % del tope, 49 % del objetivo) |
| Code points cubiertos | **219** en 19 rangos | cp1252 imprimible (218) + `₡` | exacto |

No hizo falta el criterio de Q6 (si aprieta manda la cobertura): con cp1252
**completo** el artefacto entra en el objetivo con más del doble de margen.

### 3.2 `/FontFile2` por documento (R15)

| Salida | Con 1 página | Con 20 páginas | Tope |
|---|---|---|---|
| Servidor (`buildEtiquetasLotePdf`, `compress: true`) | **3 408 B** | **3 408 B** | 12 288 B → **CUMPLE** (28 %) |
| Cliente (`buildEtiquetasPdf`) | **4 172 B** | **4 172 B** | 12 288 B → **CUMPLE** (34 %) |

Constante al crecer las páginas: el subconjunto es **por documento**, no por
página. Además, un lote de 20 declara **un** `/Subtype /Type0` y **un**
`/FontFile2` en todo el archivo (aserción estructural, R24).

### 3.3 `f` — coste de la fuente por documento en el servidor (R24)

Medido con `process.hrtime.bigint()`, 60 repeticiones tras calentamiento,
comparando un documento **con** la fuente registrada y dibujada contra el mismo
**sin** ella (`registrarFuente` es perezoso: jsPDF parsea el TTF al usar la
fuente, así que se fuerza dibujando y emitiendo).

```
documento CON fuente         mediana 0.94 ms | p90 1.24 ms | max 5.61 ms
documento SIN fuente         mediana 0.15 ms | p90 0.26 ms | max 0.50 ms

f (coste por documento) = 0.79 ms

N=300   (18 + 0.79) x 300 = 5.6 s  | tope de f = 102.0 ms | CABE
N=1000  (18 + 0.79) x 1000 = 18.8 s | tope de f =  18.0 ms | CABE
```

| Modo | Documentos | Veces que se paga `f` | Veredicto |
|---|---|---|---|
| Consolidado (`generarYAlmacenar`) | 1 | 1 → 0,79 ms sobre 5,6 s de render | irrelevante |
| **Individual** (`generarYAlmacenarPorOrden`, el peor caso) | N | N | **cabe con 23× de margen** en el techo duro (0,79 ms contra un tope de 18 ms) |

**No se activa la salida de Q8.** No hay que estrechar el subconjunto, ni bajar
`ETIQUETAS_MAX_POR_PDF`, ni excluir el modo individual.

### 3.4 Tamaño del PDF (Q9, coste aceptado con firma)

| Caso | Antes | Después | Delta |
|---|---|---|---|
| 1 etiqueta | 7 176 B | 9 983 B | **+2 807 B (+39,1 %)** |
| 10 etiquetas | 44 425 B | 47 328 B | +2 903 B (+6,5 %) |
| 50 etiquetas | 213 499 B | 216 845 B | +3 346 B (**+1,6 %**) |
| Consolidado, 50 en 1 PDF | 208,5 KB | 211,8 KB | ×1,016 |
| **Individual, 300 PDF de 1 etiqueta** | **2,05 MB** | **2,86 MB** | **×1,39** |

El «antes» no es una reconstrucción: se midió ejecutando el builder tal como
estaba en `HEAD` antes de esta tanda (`git show HEAD:lib/pdf/etiquetas-pdf-lote.ts`).

> El coste firmado en Q9 era **×3-4** en el modo individual. El real es **×1,39**:
> la decisión se tomó sobre una cota superior que no se alcanza. Se reporta por si
> alguien quiere revisar el presupuesto de Storage a la baja, **no** para reabrir
> la decisión.

### 3.5 First Load JS de `/ordenes`

**Pendiente, y a propósito.** `tasks.md` lo dice con todas las letras: la medición
de T14 queda **superada por T29**, que hay que hacer **después** de la paridad de
la vista previa. Medirlo ahora daría una cifra que caduca en la siguiente tanda.
Lo que sí está puesto ya es lo que hace que esa cifra pueda ser `+0 KB`: la
guardia de R13 (§ 6) comprueba que el artefacto **sólo** se nombra dentro del
`import()` dinámico del cargador, en todo `app/` y `components/`.

## 4. La fuente elegida, medida antes de creérsela (R30, T1)

| Dato | Valor |
|---|---|
| Fuente | **Liberation Sans Regular** |
| Versión | **2.1.5** |
| Origen | `https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz` |
| Licencia | **SIL Open Font License 1.1** — `licenses/LiberationSans-OFL.txt` |
| SHA-256 del TTF original (410 712 B) | `76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8` |
| SHA-256 del subconjunto commiteado (16 944 B) | `6603b80b0a9feb1953fd22e0f88f0e49e2f256ade4cd8b2ac044e47c947816b4` |

Motivo de la elección: es métricamente compatible con Arial/Helvetica, que es la
familia con la que está maquetada la etiqueta, así que el ancho del importe no se
mueve; y es TrueType con tabla `glyf`, que es lo que el subsetter de jsPDF sabe
reescribir (una OTF-CFF no produciría un `/FontFile2` utilizable).

**La puerta de R30, medida antes de seguir con ella** (no «porque debería
tenerlo»):

```
colon U+20A1   gid= 2077 contorno=292   <- fuente completa
colon U+20A1   gid=  222 contorno=170   <- subconjunto commiteado
cero '0'       gid=   17 contorno=92
espacio        gid=    1 contorno=0
chino U+4E2D   gid=    0 contorno=-
```

Comando exacto del subconjunto (queda también en la cabecera del módulo generado):

```
python -m fontTools.subset LiberationSans-Regular.ttf \
  --unicodes="U+0020-007E,U+00A0-00FF,U+0152-0153,U+0160-0161,U+0178,U+017D-017E,U+0192,U+02C6,U+02DC,U+2013-2014,U+2018-201A,U+201C-201E,U+2020-2022,U+2026,U+2030,U+2039-203A,U+20A1,U+20AC,U+2122" \
  --output-file=assets/fuentes/LiberationSans-etiqueta-subset.ttf \
  --no-hinting --drop-tables+=GSUB,GPOS,GDEF,FFTM,kern,gasp --notdef-outline --recalc-bounds
```

`fontTools` es una herramienta **de mano**, fuera del build: el repo no gana
ninguna dependencia. El módulo se regenera con
`pnpm exec tsx scripts/fuente-etiqueta-a-base64.ts`.

### Un hallazgo que obligó a medir mejor

`contorno()` mide la longitud del registro `glyf`. Con esa medida, el **espacio
duro** (U+00A0) daba **16 B > 0** y parecía «con tinta»: es un glifo **compuesto**
que referencia al espacio. Se añadió `tieneTinta()`, que resuelve compuestos, y la
cobertura se afirma con ella. La igualdad del test es **exacta**
(`vacios === [U+0020, U+00A0]`), no un `contains`: si un tercer carácter se
quedara sin tinta, sale rojo.

## 5. Cómo se verifica el glifo: sobre los BYTES, no sobre la llamada

Tres eslabones, cada uno de los cuales rompería el papel si fallara. Se aplican
**igual a los dos PDF** (`tests/unit/components/etiquetas-pdf.test.ts` y
`tests/unit/pdf/etiquetas-pdf-lote.test.ts`, éste inflando los streams porque el
builder usa `compress: true`):

1. **Content stream → recurso.** El `/F<n>` activo cuando se dibuja el monto es
   `/Subtype /Type0` con `/Encoding /Identity-H` y tiene `/FontFile2` (**R8/R20**).
2. **Hex → Unicode por el propio PDF.** El `<hex> Tj` se traduce con el
   `/ToUnicode` **que ese documento declara** y da exactamente `formatMonto(18000)`
   = `₡18.000` (**R9**). Si la fuente no tuviera el glifo, jsPDF lo habría borrado
   de la cadena y aquí faltaría.
3. **CID → contorno.** `/CIDToGIDMap` es `/Identity`, así que el CID **es** el
   índice de glifo; se extrae el `/FontFile2` y se exige
   `loca[gid+1] - loca[gid] > 0` **y** `tieneTinta` (**R10**).

El lector de TTF **se autocomprueba** (`tests/unit/pdf/ttf-lector.test.ts`), porque
un lector que siempre diga que sí es un verde que no mide nada:

- **negativo**: U+4E2D, U+05D0 y U+1F600 → glifo **0**;
- **de vacío**: el espacio → glifo real con contorno **0**;
- **positivo**: `'0'` → glifo con contorno **> 0**.

**Aserción endurecida, no borrada.** `etiquetas-pdf.test.ts` y
`etiquetas-pdf-lote.test.ts` afirmaban el monto buscando su **tramo ASCII más
largo** (`"234,50"`) entre los bytes. Esa aserción nunca vio el símbolo — era el
agujero por el que el bug llegó al usuario — y además dejaría de encontrar el
texto con Identity-H. Se sustituye por la decodificación del eslabón 2, que
afirma **la cadena entera, símbolo incluido**. Se retiró el helper `incluyeTexto`,
que quedaba sin uso.

## 6. Lo que impide que los dos generadores vuelvan a divergir

Tres capas, en orden de fuerza, y las tres están puestas:

1. **`tests/unit/pdf/etiquetas-dos-generadores.test.ts` (R22).** Para los cuatro
   casos del corpus y la hoja de 100 × 100, extrae `x y Td` + cuerpo + **texto
   legible** de los **dos** PDF y exige igualdad. Hoy coinciden **exactamente**:
   el servidor usa `crearLayoutBase()` (`s = 1`, offsets 0) y da los mismos
   números que sus literales de antes.
2. **`tests/unit/guards/etiquetas-maqueta-unica.guardia.test.ts` (R21).** Ninguno
   de los dos puede volver a declarar `CAMPOS_Y_INICIO`, `FONT_*`, `LINE_HEIGHT`,
   `FIELD_GAP`, `MARGIN`, `SIZE_MM`… ni tener un `drawCampos`/`drawEtiqueta`
   propio; ni queda el módulo viejo bajo `app/`; ni ningún módulo de `lib/pdf/`
   importa de `app/`. Con **control positivo**: la maqueta compartida sí las
   declara (si no, la prohibición estaría verde por vacía).
3. **El compilador.** Al no existir las constantes locales, escribir un número a
   mano exige **añadir** código, no **olvidar** actualizarlo.

**Blindaje de la 150, reformulado (T12/R18).** El smoke test afirmaba
`not.toContain("etiquetas-layout")` sobre el generador del servidor. Eso ya no
puede sostenerse: el módulo compartido vive precisamente ahí. Lo que aquella
aserción protegía —que el PDF de los integradores no gane un tamaño de hoja— se
sigue afirmando, y por lo que **es**: firma pública de un solo parámetro
(`toHaveLength(1)`), `/MediaBox` de 283,46 pt en **todas** las páginas, y
`crearLayoutBase()` sin `crearLayout(` ni `etiquetas-hoja` ni `HOJAS_ETIQUETA` en
el archivo. Se le añadió una aserción nueva de lo que la ficha **sí** cambia:
el PDF consolidado embebe `/Type0` + `/Identity-H` + `/FontFile2`.

## 7. Qué queda para `frontend_dev`

Todo lo que toca la pantalla. El árbol queda **compilando y verde** sin ello.

| Tarea | Qué falta |
|---|---|
| **T9 (R16)** | `EtiquetasGuiaModal.tsx`: `handleDescargar` `async`, `try/catch`, mensaje «No se pudo preparar la tipografía de la etiqueta. Inténtalo de nuevo.» y **ninguna** descarga. Hoy el modal llama a `descargarEtiquetasPdf` sin `await`: la promesa rechazada **no se muestra al usuario**. La constante del mensaje ya está exportada como `ERROR_FUENTE_ETIQUETA` en `etiquetas-fuente-carga.ts`. |
| **T11** | `tests/components/EtiquetasGuiaModal.test.tsx` (fallo de carga → mensaje, sin descarga) y sus dobles devolviendo promesa. |
| **T27 (R31/R33)** | `asegurarFuenteEnPantalla(fuente)` idempotente en `etiquetas-fuente-carga.ts` (base64 → `ArrayBuffer` → `FontFace` → `document.fonts.add`), disparo **al abrir el modal**, y el **valor del monto** de `EtiquetaGuia.tsx` con esa familia. |
| **T28 (R32)** | `tests/components/EtiquetaGuiaPreview.test.tsx`: familia aplicada al importe, `FontFace` creada desde **esos** bytes, y el cruce con el `/BaseFont` del PDF. Mutaciones **M10** y **M11**. |
| **T29 (R13/R14)** | `pnpm exec prisma generate` → `pnpm exec next build`: «Size» y «First Load JS» de `/ordenes` antes/después y peso del chunk, marcados «post-paridad». Si el First Load crece, se para. |
| **T15** | La comprobación a ojo: PDF en las cuatro hojas + vista previa del modal, y comparar el importe. |

Dos apuntes útiles para quien siga:

- El artefacto **no** vive bajo `app/`. Se importa con
  `await import("@/lib/pdf/etiquetas-fuente")` y la guardia de R13 exige que ese
  sea el **único** sitio de `app/` y `components/` que lo nombre. Si la vista
  previa necesita los bytes, que los pida a `cargarFuenteEtiqueta()`.
- `descargarEtiquetasPdf` ya propaga el error de carga **y** el de cobertura
  (R28): los dos llegan al modal como un `Error` con mensaje.

## 8. Mutaciones (T13) — nueve aplicadas, nueve rojas

Arnés en `.tmp282/mutaciones.py` (no commiteado, es de un solo uso). **Se
autocomprueba**: aborta si el árbol no está limpio antes de mutar, si `git diff`
sale vacío (la mutación no llegó), si vitest no llega a **contar** tests, o si el
árbol no vuelve a su sitio al revertir. Cada bloque lleva el `git diff --stat`
real de la mutación.

### M1 — el valor del monto vuelve a helvetica → **ROJO**

```
lib/pdf/etiquetas-dibujo.ts | 6 +-----
  × eslabon 1 — el recurso de fuente del monto es /Type0 con /Identity-H y /FontFile2
  × eslabon 2 — decodificado por el /ToUnicode DEL PROPIO PDF da «₡18.000»
  × eslabon 3 — el CID del simbolo tiene contorno NO VACIO en su /FontFile2
  × R8 — el recurso de fuente del monto es /Type0 con /Identity-H y trae /FontFile2
  × R9 — el hex del monto, decodificado por el /ToUnicode DEL PROPIO PDF, es «₡18.000»
  × R10 — el CID del simbolo tiene CONTORNO NO VACIO dentro del /FontFile2 embebido
  × solo el valor del monto usa la fuente embebida; todo lo demas es Type1 estandar
  × cada pagina incluye los campos de la orden
  × los nueve datos quedan escritos en cualquier tamaño del catalogo
  × R7 — el caso de la evidencia imprime sus nueve datos enteros
Test Files  2 failed (2)
Tests  10 failed | 28 passed (38)
```

### M2 — base64 de una fuente SIN el símbolo → **ROJO**

```
assets/fuentes/LiberationSans-etiqueta-subset.ttf | Bin 16944 -> 16760 bytes
 lib/pdf/etiquetas-fuente.ts                       |  11 +++++------
  × U+20A1 tiene glifo con contorno NO VACIO en el archivo commiteado
  × el simbolo CONFIGURADO (no uno escrito a mano aqui) esta cubierto
  × cubre cp1252 MAS el simbolo configurado, y ni uno menos
  × `cubreTexto` usa esa declaracion: dice que si a lo cubierto y que NO a lo demas
  × R28 — un caracter no cubierto LANZA, con el code point en el mensaje
  × eslabon 2 — decodificado por el /ToUnicode DEL PROPIO PDF da «₡18.000»
  × R9 — el hex del monto, decodificado por el /ToUnicode DEL PROPIO PDF, es «₡18.000»
  × R10 — el CID del simbolo tiene CONTORNO NO VACIO dentro del /FontFile2 embebido
  ... (39 en total)
Test Files  3 failed (3)
Tests  39 failed | 13 passed (52)
```

### M3 — glifo del símbolo **vaciado** (contorno 0), sin tocar el `cmap` → **ROJO**

Es el eslabón que distingue «declarado» de «impreso»: el `cmap` sigue diciendo
que `₡` está, y el `/ToUnicode` también. Sólo el contorno lo desmiente.

```
assets/fuentes/LiberationSans-etiqueta-subset.ttf | Bin 16944 -> 16944 bytes
 lib/pdf/etiquetas-fuente.ts                       |   4 ++--
  × U+20A1 tiene glifo con contorno NO VACIO en el archivo commiteado
  × el simbolo CONFIGURADO (no uno escrito a mano aqui) esta cubierto
  × eslabon 3 — el CID del simbolo tiene contorno NO VACIO en su /FontFile2
  × R10 — el CID del simbolo tiene CONTORNO NO VACIO dentro del /FontFile2 embebido
Test Files  3 failed (3)
Tests  4 failed | 48 passed (52)
```

### M4 — `camposYInicio()` fijado a `18` → **ROJO**

```
lib/pdf/etiquetas-maqueta.ts | 2 +-
  × queda un cuerpo entero (1 em) por debajo de la linea base de la guia
  × el 18 de antes NO cabia: 2 mm para un cuerpo que necesita 7,76
  × R3 — la desigualdad se conserva al escalar: vale para las CUATRO hojas por construccion
  × con la derivacion el cupo para los siete campos es 10 (antes 11)
  × la separacion entre lineas base es >= 1 em del cuerpo del numero de guia   (servidor)
  × en las CUATRO hojas, la separacion entre lineas base es >= 1 em del cuerpo de la guia
  ... (10 en total)
Test Files  3 failed (3)
Tests  10 failed | 41 passed (51)
```

### M5 — `camposYInicio()` fijado **a mano** a `23.7611` (el valor bueno, sin derivar) → **ROJO**

```
lib/pdf/etiquetas-maqueta.ts | 2 +-
  × queda un cuerpo entero (1 em) por debajo de la linea base de la guia
  × SI el cuerpo de la guia cambia, la fila baja EXACTAMENTE lo mismo (no es un numero magico)
  × un valor fijado a mano (23.7611) dejaria de derivar: la relacion lo delata
  × R3 — la desigualdad se conserva al escalar: vale para las CUATRO hojas por construccion
Test Files  1 failed (1)
Tests  4 failed | 9 passed (13)
```

### M6 — `addFont` con `"WinAnsiEncoding"` → **ROJO**

```
lib/pdf/etiquetas-fuente-registro.ts | 2 +-
  × R15 — el /FontFile2 no pasa de 12 KB y no crece con las paginas   (servidor)
  × R15 — el /FontFile2 no pasa de 12 KB y es CONSTANTE al crecer las paginas   (cliente)
  × eslabon 1/2/3 y R8/R9/R10
  ... (12 en total)
Test Files  2 failed (2)
Tests  12 failed | 26 passed (38)
```

### M7 — línea base movida en **un solo** generador

**Primera formulación: SUPERVIVIENTE, y la mutación era mía, no del test.**
Escribí el desplazamiento como `camposYInicio() + (typeof document === "undefined" ? 0 : 3)`
dentro del módulo **compartido**. El test de R22 corre los dos generadores en el
**mismo proceso jsdom**, así que `document` está definido para ambos y los dos se
movieron 3 mm igual: no hubo divergencia que detectar.

```
lib/pdf/etiquetas-dibujo.ts | 2 +-
resultado: VERDE (SUPERVIVIENTE)
Test Files  2 passed (2)
Tests  14 passed (14)
```

**Límite real que esto deja escrito:** R22 compara los dos PDF **tal como se
generan en el entorno del test**. Una divergencia *condicionada al runtime* no la
ve. No se tapa con una aserción nueva porque el remedio (rasterizar el PDF del
servidor en un proceso Node aparte y compararlo desde el de jsdom) cuesta más de
lo que protege, y nadie escribe ese código por accidente: es una rama explícita
sobre `typeof document`.

Reformulada como la divergencia que sí ocurre —alguien toca **un** generador—,
en sus dos formas, **las dos rojas**:

```
### M7a — el servidor desplaza su maqueta: divergencia REAL de un solo lado
lib/pdf/etiquetas-pdf-lote.ts | 3 ++-
× caso «evidencia»: mismas lineas base y mismo texto
× caso «direccion-3-lineas»: mismas lineas base y mismo texto
× caso «ubicacion-completa»: mismas lineas base y mismo texto
× caso «alfabeto-real»: mismas lineas base y mismo texto
Test Files  1 failed (1)
Tests  4 failed | 1 passed (5)

### M7b — el servidor reintroduce CAMPOS_Y_INICIO propio
lib/pdf/etiquetas-pdf-lote.ts | 2 ++
× lib/pdf/etiquetas-pdf-lote.ts no declara ninguna constante de maqueta propia
Test Files  1 failed (1)
Tests  1 failed | 8 passed (9)
```

### M8 — se quita `exigirCobertura` (R28 muerto) → **ROJO**

```
lib/pdf/etiquetas-dibujo.ts | 2 +-
  × no produce un PDF con el importe mutilado: lanza con el code point en el mensaje
Test Files  1 failed | 2 passed (3)
Tests  1 failed | 40 passed (41)
```

Y por el canal del navegador, con la misma mutación:

```
  × el generador LANZA y `save` no llega a llamarse
Test Files  1 failed (1)
Tests  1 failed | 5 passed (6)
```

### M9 — `COBERTURA` declara un carácter que el archivo no tiene → **ROJO**

```
lib/pdf/etiquetas-fuente.ts | 1 +
  × COBERTURA coincide EXACTAMENTE con lo que el archivo cubre
  × los rangos declarados vienen ordenados y sin solaparse (lo que asume la busqueda)
  × `cubreTexto` usa esa declaracion: dice que si a lo cubierto y que NO a lo demas
Test Files  1 failed (1)
Tests  3 failed | 11 passed (14)
```

### Extra — la aserción estructural de R24

```
### registrar la fuente DENTRO del bucle de paginas -> ROJO
  × un lote de 20 paginas declara UN solo recurso Type0 y UN solo /FontFile2
Test Files  1 failed (1)
Tests  5 failed | 11 passed (16)
```

## 9. Mapa R → test

De los 34 requisitos, **31** tienen ya un test que existe y pasa. Los **3**
restantes (R31, R32, R33) son de la vista previa y son de `frontend_dev` por
diseño: la ficha se secuencia backend → frontend.

| R | Test |
|---|---|
| R1 | `tests/unit/pdf/etiquetas-maqueta.test.ts` «queda un cuerpo entero (1 em)…» + `tests/unit/components/etiquetas-pdf.test.ts` «en las CUATRO hojas, la separacion…» |
| R2 | `etiquetas-maqueta.test.ts` «SI el cuerpo de la guia cambia…» y «un valor fijado a mano…» |
| R3 | `etiquetas-pdf.test.ts` «en las CUATRO hojas…» (medido sobre el PDF) + `etiquetas-maqueta.test.ts` «R3 — la desigualdad se conserva al escalar» |
| R4 | `etiquetas-pdf.test.ts` «aparecen los siete y en el mismo orden de arriba abajo» |
| R5 | `etiquetas-pdf.test.ts` «ninguna linea entra en la banda» + `etiquetas-pdf-lote.test.ts` «ninguna linea baja del borde superior del QR» |
| R6 | `etiquetas-pdf.test.ts` «ningun caso del corpus sale con marca de recorte» (caso `direccion-3-lineas`) |
| R7 | `etiquetas-pdf.test.ts` «R7 — el caso de la evidencia imprime sus nueve datos enteros» |
| R8 | `etiquetas-pdf.test.ts` «R8 — el recurso de fuente del monto es /Type0…» |
| R9 | `etiquetas-pdf.test.ts` «R9 — el hex del monto, decodificado por el /ToUnicode DEL PROPIO PDF…» |
| R10 | `etiquetas-pdf.test.ts` «R10 — el CID del simbolo tiene CONTORNO NO VACIO…» + `ttf-lector.test.ts` (los tres controles) |
| R11 | `tests/unit/pdf/etiquetas-fuente.test.ts` bloque «R11 — cobertura…» |
| R12 | `etiquetas-pdf.test.ts` «solo el valor del monto usa la fuente embebida…» + «el ajuste de linea usa el ancho ESCALADO…» |
| R13 | `tests/unit/guards/etiqueta-fuente-diferida.guardia.test.ts` bloque «R13» *(la cifra de First Load JS: T29, frontend)* |
| R14 | misma guardia, bloque «R14» + `etiquetas-fuente.test.ts` «R14» + § 3.1 de esta bitácora |
| R15 | `etiquetas-pdf.test.ts` «R15 — el /FontFile2 no pasa de 12 KB…» + `etiquetas-pdf-lote.test.ts` «R15…» |
| R16 | `tests/unit/components/etiquetas-pdf-descarga.test.ts` «R16: si la fuente no carga, NO se descarga nada…» *(el mensaje en el modal: T9, frontend)* |
| R17 | `etiquetas-fuente.test.ts` bloque «R17 — procedencia y licencia» |
| R18 | `etiquetas-pdf-lote.smoke.test.ts` «R21: … sin parametro de tamaño» y «R18/R20: el PDF consolidado embebe la fuente» |
| R19 | `etiquetas-pdf-lote.test.ts` «R19 — el servidor tampoco pisa la primera fila» |
| R20 | `etiquetas-pdf-lote.test.ts` «eslabon 1 / 2 / 3» |
| R21 | `tests/unit/guards/etiquetas-maqueta-unica.guardia.test.ts` |
| R22 | `tests/unit/pdf/etiquetas-dos-generadores.test.ts` |
| R23 | guardia diferida «R23 — en el servidor, import estatico…» + `etiquetas-pdf-lote.test.ts` «R23 — la fuente NO se lee del sistema de archivos» |
| R24 | `etiquetas-pdf-lote.test.ts` «un lote de 20 paginas declara UN solo recurso Type0 y UN solo /FontFile2» + la medida de `f` en § 3.3 |
| R25 | `etiquetas-maqueta.test.ts` bloque «R25 — el cupo que se cede» |
| R26 | `etiquetas-pdf.test.ts` y `etiquetas-pdf-lote.test.ts` «ningun caso del corpus sale con marca de recorte» |
| R27 | `etiquetas-maqueta.test.ts` bloque «R27» + `etiquetas-pdf.test.ts` (el cuerpo de la guía medido en el PDF) |
| R28 | `etiquetas-pdf-lote.test.ts` «R28…», `tests/integration/carga-api-etiquetas.test.ts` «R28…», `etiquetas-pdf-descarga.test.ts` «R28 — … en el navegador tampoco se descarga nada» |
| R29 | `etiquetas-fuente.test.ts` bloque «R29 — la cobertura declarada no miente» |
| R30 | `etiquetas-fuente.test.ts` bloque «R30 — la fuente elegida contiene el simbolo» |
| **R31** | **frontend_dev (T27)** — `tests/components/EtiquetaGuiaPreview.test.tsx` |
| **R32** | **frontend_dev (T28)** — misma suite, test cruzado con el `/BaseFont` |
| **R33** | **frontend_dev (T27)** — `EtiquetasGuiaModal.test.tsx`; la mitad de la descarga ya está en `etiquetas-pdf-descarga.test.ts` (R16) |
| R34 | `etiquetas-pdf.test.ts` «R34 — los seis no-ASCII…» + `etiquetas-pdf-lote.test.ts` «los seis no-ASCII medidos en produccion salen impresos» |

## 10. Gate

`pnpm run db:generate` corrido antes. `./init.sh` **completo**, con
`INIT_EXIT=$?` escrito **dentro** del log y sin `tail` (un `echo` ya tapó un rojo
en este repo).

```
$ pnpm run db:generate            # cliente Prisma al dia antes del gate
$ ./init.sh                       # COMPLETO, con INIT_EXIT dentro del log
2026-08-25T20:19:15-05:00
[OK] node v24.13.0
[OK] dependencias presentes
[OK] regla max-2-por-zona respetada (in_progress=5)
[OK] specs presentes para features sdd en vuelo
-> pnpm run typecheck
> tsc --noEmit
[OK] typecheck paso
-> pnpm run lint
> eslint
X 100 problems (0 errors, 100 warnings)
[OK] lint paso
-> pnpm run test
> vitest run

 tests/unit/guards/superficie-de-uso.guardia.test.ts (18 tests | 1 failed) 94ms
     x ninguna Server Action de `lib/actions/**` es inalcanzable sin su anotacion `@sin-superficie` 23ms

 FAIL  tests/unit/guards/superficie-de-uso.guardia.test.ts
 AssertionError: ... expected [ Array(1) ] to deeply equal []
 - []
 + [
 +   "lib/actions/tarifas.ts:67 obtenerTarifa",
 + ]

 Test Files  1 failed | 1400 passed (1401)
      Tests  1 failed | 19077 passed | 26 skipped (19104)
   Duration  387.83s

X 'pnpm run test' fallo
INIT_EXIT=1
2026-08-25T20:25:50-05:00
```

**typecheck: 0 errores. lint: 0 errores** (100 warnings, todos preexistentes y
ajenos). **Tests: 19.077 pasan, 1 falla, 26 skipped, en 1.401 archivos.**

### El rojo ajeno, medido

`tests/unit/guards/superficie-de-uso.guardia.test.ts` falla con:

```
× ninguna Server Action de `lib/actions/**` es inalcanzable sin su anotación `@sin-superficie`
+   "lib/actions/tarifas.ts:67 obtenerTarifa",
Test Files  1 failed (1)
Tests  1 failed | 17 passed (18)
```

Es **ajeno**: ficha 275, de otra sesión, `pending`. `obtenerTarifa` ya existía en
el `merge-base` con `origin/dev` (`9e82aee1`) y **mi diff no toca** ni
`lib/actions/tarifas.ts` ni esa guardia (comprobado con
`git diff --name-only 9e82aee1..HEAD`). No se anota, no se silencia y no se toca.

**Delta contra ese baseline: 0.** El unico rojo de los 1.401 archivos es ese, y
es el mismo test y la misma linea que ya fallaba. No hay ni un rojo mio.

## 11. Veredicto

El solape y el simbolo estan arreglados **en los dos generadores a la vez** y
verificados sobre los bytes del PDF, no sobre las llamadas; la maqueta es una
sola y tiene tres capas que impiden que vuelva a partirse; los tres numeros que
habia que medir (22.592 chars de base64, f = 0,79 ms por documento, +2.807 B por
PDF individual) cumplen su tope con holgura; nueve mutaciones salen rojas con su
salida pegada; y el gate deja **delta 0** contra el unico rojo ajeno. Falta la
UI del navegador (R31-R33 y la medida del First Load JS), que es de `frontend_dev`
por diseno de la ficha.
