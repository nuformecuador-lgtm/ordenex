# Feature 353 — La etiqueta se parece al diseño aprobado · bitácora de implementación

> Rama `feature/353-etiquetas-fieles`, worktree `R:\wt\350`. Todo lo que sigue
> está **medido en esta sesión (2026-09-02) leyendo el PDF con el inspector**,
> salvo donde se dice lo contrario. No hay spec propio: la ficha nace del rechazo
> del humano al resultado de la 350 («¿por qué se ven tan diferentes?») y el
> alcance es la disposición, no el modelo de datos.

---

## 0. Veredicto en una línea

La etiqueta pasa a tener la disposición del diseño aprobado —número de guía a
**30 pt**, rótulo de marca, fila `REM`/`FECHA` bajo el número, regla horizontal,
`PARA`, pesos en negrita, `CONTENIDO`/`TIENDA` apilados y recuadro de borde
grueso— **sin perder ni un carácter**: el peor caso medido (dirección de 286 +
producto de 138) sigue imprimiéndose entero en las **cuatro** hojas y la
capacidad de `100x100` se queda **exactamente igual** (286 / 391).

---

## 1. La divergencia que me pasaron y que NO era cierta

> «El QR está abajo, y el diseño lo pone ARRIBA A LA DERECHA (…) la banda
> `codigos` va pegada al borde inferior con QR **y** barras juntos.»

**Falso, medido antes de tocar nada.** En `dev` (commit `53b8e648`) el QR ya
estaba arriba a la derecha y abajo iba **solo** el código de barras a ancho
completo. Leído del PDF del caso de evidencia en 100 × 100:

```
IMG (68.00, 6.00) - (94.00, 32.00)   26.00 x 26.00   <- QR, esquina sup. derecha
IMG (6.00, 78.00) - (94.00, 94.00)   88.00 x 16.00   <- barcode, a ancho completo
```

El nombre de la banda (`codigos`) confunde: es la banda del **código de barras**;
el QR se dibuja dentro de la cabecera desde la 350 (`etiquetas-dibujo.ts`, el
`addImage` con `layout.y(0)`). Se anota porque era la mitad del encargo y habría
llevado a «arreglar» algo que ya estaba bien.

---

## 2. Las divergencias reales, una por una

| # | Qué decía el diseño | Qué había en `dev` | Estado |
|---|---|---|---|
| 1 | QR arriba a la derecha, barcode solo abajo | **ya estaba así** | — (§1) |
| 2 | Número de guía ~10,6 mm de caja (**30 pt**) | **22 pt** (7,76 mm, el 73 %) | **ARREGLADO** |
| 3 | Rótulo diminuto **«ORDENEX · GUÍA»** sobre el número | decía solo `GUÍA` | **ARREGLADO** |
| 4 | Fila `REM <n>` y `FECHA <f>` **debajo** del número | `FECHA` y `REMISIÓN` **encima**, y el valor de la remisión en la línea del número | **ARREGLADO** |
| 5 | **Regla horizontal** bajo la cabecera | no existía | **ARREGLADO** |
| 6 | Rótulo **`PARA`** abriendo el destino | no existía | **ARREGLADO** (con matiz, §4) |
| 7 | Nombre, teléfono y ubicación en **negrita** | los tres en redonda | **ARREGLADO** |
| 8 | `CONTENIDO` / `TIENDA` en rótulo diminuto **con el valor debajo** | `Producto:` / `Tienda:` **en línea** | **ARREGLADO** (con matiz, §4) |
| 9 | Recuadro del importe de **borde grueso** | 0,3 mm — se leía como una línea de tabla | **ARREGLADO** (0,6 mm) |
| 10 | ubicación en **versalitas** negrita | redonda, caja normal | **NEGRITA sí, versalitas NO** (§7) |
| 11 | número repetido bajo el barcode, **espaciado** | está debajo y centrado, pero **dentro del ráster** | **NO TOCADO** (§7) |

Las 2, 3, 4, 5, 7 y 9 **no cuestan ni un milímetro** de capacidad y entran tal
cual. Las 6 y 8 sí cuestan, y ahí está la decisión de la ficha (§4).

### El defecto que apareció de paso, y es de la 350

`ajustarBloque` **devolvía `cabe: false` sin mirar el resultado en el suelo**: el
recorrido descendente `cuerpoMaxPt − i·PASO` casi nunca cae exactamente en
`cuerpoMinPt` (el tope del detalle es `cuerpoTelefono − 0,25` y el cuerpo del
teléfono sale de `cuerpo · 12/13`, que no está en la rejilla de 0,25 pt), así que
el suelo **no se probaba nunca**. Medido: en A4 una dirección de **2.562**
caracteres se rechazaba con el mensaje `necesita 6.2 mm de alto (…) y hay 6.3` —el
propio error decía que cabía— y la capacidad dejaba de ser monótona (2.561 sí,
3.000 no, 4.000 sí, 6.000 no, 7.000 sí). Arreglado evaluando el suelo como un
candidato más. Solo puede **subir** capacidad: `carta · antesDeR7` pasa de 7.639 a
**7.827**.

---

## 3. Las cajas medidas (100 × 100, área útil x[6, 94] y[6, 94])

Lo que el humano pidió para poder comparar con números:

| Elemento | Caja medida | Tamaño |
|---|---|---|
| **Número de guía** `19887906` | x = 6,00 · línea base y = **19,41** · caja de tinta y[8,82 ; 19,41] | **30,00 pt = 10,58 mm** de caja, 46,57 mm de ancho |
| **QR** | (68,00 · 6,00) → (94,00 · 32,00) | **26,00 × 26,00 mm**, cuadrado, pegado a la esquina superior derecha |
| **Código de barras** | (6,00 · 78,00) → (94,00 · 94,00) | **88,00 × 16,00 mm**, a todo el ancho útil, pegado abajo |
| **Arranque del destino** | línea base de `PARA` en y = **36,82**; destinatario en y = **41,00** | — |
| Regla horizontal | y = **33,00**, x[6,00 ; 94,00] | grosor **0,40 mm** |
| Recuadro del importe | (6,00 · 53,66) → (94,00 · 60,78) | 88,00 × 7,11 mm, grosor **0,60 mm** |

La cabecera, de arriba abajo: `ORDENEX · GUÍA` en y = 8,82 (8 pt) → número en
y = 19,41 (30 pt) → `REM  REM-2201     FECHA  2026-08-25` en y = 29,99 (9,75 pt).
Entre cada par hay **1 em del cuerpo del número** (10,58 mm), que es la regla
derivada de la 282 aplicada dos veces.

### Por qué subir el número a 30 pt sale gratis

El alto de la cabecera es `max(QR_MM, pila de texto)`. Con 22 pt la pila medía
10,58 mm y sobraban **15,4 mm** de los 26 del QR: papel en blanco. Con 30 pt más
la fila `REM`/`FECHA` la pila mide **24,9 mm**, sigue por debajo de 26 y **el
resto de las bandas no se enteran**. Está afirmado como test en
`etiquetas-maqueta.test.ts` («la cabecera con el número grande SIGUE cabiendo en
el hueco del QR»), con su control positivo para que no sea una comprobación
vacía.

### Las otras tres hojas (caso de evidencia)

| hoja | k | QR | barcode | regla | recuadro |
|---|---|---|---|---|---|
| `4x6in` | 1,018 | (69,13 · 6,00)-(95,60 · 32,47), 26,47² | 89,60 × 16,29 | y = 33,47 | 0,61 mm |
| `a4` | 2,250 | (145,50 · 6,00)-(204,00 · 64,50), 58,50² | 198,00 × 36,00 | y = 65,50 | 1,35 mm |
| `carta` | 2,317 | (149,66 · 6,00)-(209,90 · 66,24), 60,24² | 203,90 × 37,07 | y = 67,24 | 1,39 mm |

---

## 4. LA DECISIÓN DE LA FICHA, con sus números

Los tres rótulos que el diseño **apila** sobre su valor (`PARA`, `CONTENIDO`,
`TIENDA`) gastan **tres líneas nuevas**. Medido en la celda de 100 × 100:

- coste bruto: 3 × 8 pt × 1,26 de interlineado = **10,67 mm**;
- descuento por quitar la sangría del rótulo en línea: ≈ **1,6 mm**;
- **coste neto: 9,1 mm**.

Y la holgura que había: **0,25 mm**. Medido bajando el `altoUtil` milímetro a
milímetro con el peor caso hasta que salta R7.

Con los rótulos apilados a la fuerza, el peor caso de producción **no se emite**:

```
ErrorEtiquetaNoCabe: (…) bloque de destino (…) necesita 22.0 mm de alto
con el cuerpo minimo y hay 12.9 mm
```

…y la capacidad de `100x100` caía de **391 a 155** caracteres de dirección, por
debajo del máximo real de producción (286). Eso rompe lo que la 350 pagó caro.

**No se eligió entre «diseño» y «capacidad»: se hizo lo que esta maqueta ya hacía
con el cuerpo tipográfico, una degradación en orden declarado.** La etiqueta se
compone **apilada —el diseño— siempre que quepa**; cuando el texto no deja sitio,
y solo entonces, los rótulos vuelven a la línea de su valor y `PARA` se omite,
que es exactamente la disposición de la 350. Nunca se recorta un dato y nunca se
deja de emitir por un rótulo.

La frontera, medida y escrita **como tabla literal** en
`etiquetas-diseno-353.test.ts`: de los 8 casos del corpus × 4 hojas (32
combinaciones), **solo 2 caen a la disposición compacta** —`peor-caso-medido` y
`palabra-imposible`, y solo en `100x100`—. En las otras 30 sale el diseño tal
cual. Un test lo afirma caso a caso y se pone rojo por los **dos** lados: si algo
deja de apilarse *o* si empieza a apilarse donde la tabla dice que no cabe.

**Lo que hay que llevar al humano** (§7): en `100x100` esas tres líneas se comen
el hueco que permitía al destinatario llegar a su cuerpo base de 13 pt. Ahora se
imprime a **9,75 pt** en esa hoja (sigue en negrita y sigue siendo el mayor del
bloque). En las otras tres hojas conserva su cuerpo base.

---

## 5. La capacidad, re-medida en las cuatro hojas

Barrido de direcciones de longitud creciente, comprobado por sus dos lados
(`n` cumple, `n+1` no) y con barrido fino hacia arriba para no fiarse de una
bisección sobre una función que no es monótona garantizada.

| hoja | sin bajar del cuerpo base | antes del suelo (7,0 pt) | antes de R7 | (350) antes de R7 |
|---|---|---|---|---|
| **100x100** | **NUNCA** (era 106) | **286** (=) | **391** (=) | 391 |
| **4x6in** | 589 (era 699) | 1.060 (era 1.266) | **1.765** (=) | 1.765 |
| **a4** | 3.371 (era 4.115) | 2.561 (era 6.729) | **8.864** (=) | 8.864 |
| **carta** | 2.841 (era 3.618) | 5.024 (era 6.200) | **7.827** (era 7.639) | 7.639 |

Lo importante: **la capacidad de emisión no baja en ninguna hoja** y sube en
`carta` por el arreglo de `ajustarBloque`. Lo que baja es «cuántos caracteres
admite sin que la tipografía empiece a encoger», que es el precio de los tres
rótulos y está declarado.

`sinBajarBase: null` en `100x100` significa «ninguna longitud lo consigue» y se
comprueba también por sus dos lados: falla con la dirección más corta posible, y
si mañana la maqueta recuperase el hueco, ese test se pone rojo pidiendo el
número.

### El peor caso, en las cuatro hojas

Se imprime **entero** en las cuatro. En `4x6in`, `a4` y `carta` con el diseño
completo y con los cuerpos base sin encoger (destinatario a 13,24 pt en `4x6in`);
en `100x100` con la disposición compacta, la dirección en 4 líneas a 7,0 pt y el
producto en 2 a 7,0 pt.

### R11 — se cambió el orden de comparación, y por qué

La 350 ordenaba las hojas **por área** y exigía que las tres métricas crecieran en
ese orden. Con los números nuevos, `a4` aguanta más antes de dejar de emitir
(8.864 contra 7.827) pero **menos** antes de que el primer texto toque el suelo
(2.561 contra 5.024): A4 es más alta y Carta más ancha, y en esta maqueta el
ancho gobierna los caracteres por línea y el alto las líneas. Ordenar por área
obliga a afirmar algo que R11 no dice. Se sustituye por el orden de
**dominancia** —mayor en los dos lados—, que es lo que R11 sí dice («un papel más
grande nunca debe dar menos capacidad»), con su control positivo de que cada par
declarado domina de verdad y de que `a4` y `carta` no se dominan. Las tres
métricas siguen creciendo estrictamente en las tres comparaciones que quedan.
El propio `design.md` de la 350 ya documentaba que estos números dependen de la
**relación de aspecto** y no del área.

---

## 6. Las mutaciones: 8 aplicadas, **8 muertas**, 0 supervivientes

Cada una se aplicó al archivo real, se corrió la suite y se revirtió comprobando
el `sha256` del archivo antes y después. El arnés aborta si el ancla no aparece
exactamente una vez o si el runner no llegó a ejecutar tests.

| # | Mutación | Test que la mata | Línea de fallo real |
|---|---|---|---|
| **M1** | **devolver el QR abajo** (`layout.y(altoUtil - qrMm)`) | `etiquetas-diseno-353` › el QR: cuadrado de 26 mm en la esquina superior DERECHA | `expected 68 to be close to 6, received difference is 62` · 33 de 39 rojos |
| **M2** | **encoger el número de guía** a 22 pt | `etiquetas-diseno-353` › el numero de guia: 30 pt, 10,58 mm de caja | `expected 22 to be 30` · 5 rojos |
| **M3** | no dibujar la regla horizontal | `etiquetas-diseno-353` › la regla horizontal: a todo el ancho util | `expected [] to have a length of 1 but got +0` · 41 rojos |
| **M4** | volver a los rótulos en línea siempre | `etiquetas-diseno-353` › el bloque de destino arranca en 36,82 mm | `falta el rotulo PARA: expected undefined to be defined` · 31 rojos |
| **M5** | devolver la fila `REM`/`FECHA` encima del número | `etiquetas-pdf` › R24 (295) › comparte fila con la remision | `expected 8.822… to be greater than 8.822…` · 67 rojos |
| **M6** | recuadro del importe otra vez a 0,3 mm | `etiquetas-maqueta` › los grosores de trazo del diseño | `expected 0.3 to be 0.6` |
| **M7** | quitar la negrita del destinatario y del teléfono | `etiquetas-diseno-353` › «evidencia» en 100x100 | `«destinatario» deberia ir en negrita y su fuente es Helvetica` · 32 rojos |
| **M8** | deshacer el arreglo del suelo de `ajustarBloque` | `etiquetas-capacidad` › carta · antesDeR7 = 7827 | `la capacidad BAJO de la declarada (antesDeR7 ya no llega a 7827)` |

Las dos obligatorias (M1 y M2) mueren, y mueren **en el test nuevo**: antes de
esta ficha **las dos habrían sobrevivido en verde**, que es literalmente cómo se
produjo la deriva. La suite de la 350 no tenía ni una aserción sobre disposición.

---

## 7. Lo dudoso, y lo que necesita firma del humano

1. **El destinatario en `100x100` baja de 13 a 9,75 pt.** Es el precio de las tres
   líneas de rótulo del diseño. Si el humano prefiere el nombre grande a los
   rótulos apilados en esa hoja, es una línea (`rotulosApilados`). Con el número
   delante: recuperar los 13 pt exige **4,45 mm** que no hay, y las palancas que
   la 350 dejó declaradas suman como mucho ~2,9 mm (margen 6 → 5 mm y el cuerpo
   del importe 16 → 14). **No lo decido yo.**
2. **La ubicación va en negrita pero NO en versalitas.** El diseño dice
   «versalitas negrita». Helvetica no tiene versalitas reales y la aproximación
   habitual es poner el texto en mayúsculas — pero eso **cambia los caracteres
   que se imprimen** y R2 de la 350 exige que la concatenación de lo dibujado sea
   *exactamente* el valor del dato. `GAM / SAN JOSÉ / MORA / COLÓN` no es
   `GAM / San José / Mora / Colón`. Los rótulos (`PARA`, `CONTENIDO`, `TIENDA`,
   `COBRAR`) sí van en mayúsculas porque son literales, no datos. **Pide firma.**
3. **El número bajo el código de barras no está «espaciado».** Está debajo y
   centrado, pero lo dibuja la librería **dentro del ráster** (`includetext` en
   bwip-js, `displayValue` en jsbarcode). Sacarlo a texto propio obliga a tocar
   los dos rasterizadores —cada uno con su librería por runtime— que es
   exactamente el espejo a mano que ya divergió en la 282, y además le quitaría
   alto al barcode. **No lo toqué.**
4. **La fecha se sigue imprimiendo `YYYY-MM-DD`, no `dd/mm/aa`.** El valor llega
   ya resuelto del servidor (`fechaCalendarioCR`, feature 295) y reformatearlo es
   un cambio de **dato**, no de disposición. Lo que sí cambió es **dónde** va.
5. **Toqué UI, y no debía.** `EtiquetaGuia.tsx` (la vista previa) es un
   componente y mi encargo era backend. Lo hice porque **R23 de la 350 exige que
   pantalla y papel coincidan en orden y jerarquía**, y hay un test que lo mide
   cruzando los dos: al mover la fecha en el papel, la previa quedaba mintiendo y
   la suite roja. El cambio es el espejo mínimo (cabecera nueva, regla, `PARA`,
   pesos, rótulos apilados). **La fidelidad visual fina de la previa —que usa
   clases de Tailwind y no milímetros— merece una pasada de `frontend_dev`.**
6. **La `4x6in`, `a4` y `carta` no tienen números literales de caja** en el test
   de diseño; solo `100x100`, que es la hoja de dimensiones fijas y la que usa
   siempre el generador del lote. Las otras tres quedan cubiertas por V8 (que
   corre en las cuatro y compara contra el layout) y por la tabla de apilado.

---

## 8. Archivos

### Modificados

| Archivo | Qué |
|---|---|
| `lib/pdf/etiquetas-maqueta.ts` | `CUERPOS_BASE.guia` 22 → **30**; nuevas `GROSOR_RECUADRO_MM` (0,6) y `GROSOR_REGLA_MM` (0,4), expuestas en `MAQUETA_BASE` |
| `lib/pdf/etiquetas-dibujo.ts` | cabecera de tres filas, `ROTULO_GUIA` = `ORDENEX · GUÍA`, `ROTULO_REMISION` = `REM`, nuevos `ROTULO_PARA` / `CONTENIDO` / `TIENDA`, regla horizontal, negritas, recuadro grueso, y la decisión medida `rotulosApilados` |
| `lib/pdf/etiquetas-ajuste.ts` | el suelo se evalúa como candidato: se acabó el falso negativo |
| `app/(app)/ordenes/_components/EtiquetaGuia.tsx` | la vista previa espeja la disposición nueva (R23) — **fuera del alcance backend, ver §7.5** |
| `tests/unit/pdf/pdf-inspector.ts` | `RectanguloDibujado.grosor` y el lector nuevo `trazosDePagina` |
| `tests/unit/pdf/etiquetas-verificacion.ts` | V7 (disposición de los rótulos) y V8 (las siete aserciones del diseño), sobre el PDF, en las cuatro hojas y los dos generadores |
| `tests/unit/pdf/etiquetas-capacidad.test.ts` | capacidad re-medida y R11 por dominancia |
| `tests/unit/pdf/etiquetas-maqueta.test.ts` | el número de guía dominante y los grosores |
| `tests/unit/pdf/etiquetas-dos-generadores.test.ts` | la paridad compara también **trazos y grosores** |
| `tests/unit/components/etiquetas-pdf.test.ts` | el bloque de la 295 sigue a la fila de la fecha a su sitio nuevo |
| `tests/unit/components/etiquetas-pdf-descarga.test.ts` | el doble de jsPDF aprende `line` |
| `tests/components/EtiquetaGuiaPreview.test.tsx` | el orden literal pantalla/papel |
| `tests/unit/guards/etiquetas-maqueta-unica.guardia.test.ts` | los dos grosores entran en la lista prohibida **y** en el control positivo |

### Creado

- `tests/unit/pdf/etiquetas-diseno-353.test.ts` — **el archivo que faltaba**: las
  cajas del diseño en milímetros como literales, la cabecera de arriba abajo, la
  regla, y la tabla de qué casos salen apilados. 39 tests.

### Los dos generadores

**Diff cero**, otra vez: `lib/pdf/etiquetas-pdf-lote.ts` y
`app/(app)/ordenes/_components/etiquetas-pdf.ts` **no cambian ni una línea**.
Todo vive en los módulos compartidos de `lib/pdf/`, y el test de paridad ahora
también compara los trazos, así que la regla nueva tampoco puede existir en uno y
faltar en el otro.

---

## 9. Verificación ejecutada

```
$ pnpm exec tsc --noEmit
TSC_EXIT=0            (sin salida)

$ pnpm run lint
LINT_EXIT=0
✖ 150 problems (0 errors, 150 warnings)      <- las 150 son heredadas (no-unused-vars en tests)

$ pnpm exec vitest run                        (suite completa, 898 s)
 Test Files  2 failed | 1654 passed (1656)
      Tests  2 failed | 23426 passed | 26 skipped (23454)
```

Los **dos** rojos, con su nombre:

1. `tests/unit/guards/superficie-de-uso.guardia.test.ts` —
   `lib/actions/tarifas.ts:67 obtenerTarifa`. **Heredado y tolerado por encargo**;
   no lo toca esta ficha.
2. `tests/integration/repositories/historico-conversaciones.int.test.ts` › R36.
   **Ajeno y no reproducible en aislado**: vuelto a correr solo, **27/27 en
   verde**. Es la base local compartida entre worktrees en paralelo (el test
   busca un término «que no casa nada» y le casaron filas de otra sesión). No
   toca nada de PDF; en la primera corrida completa de esta sesión ni siquiera
   apareció.

Suites de la etiqueta, en verde y por su cuenta: `tests/unit/pdf` (10 archivos),
`etiquetas-pdf.test.ts`, `etiquetas-layout.test.ts`, `etiquetas-pdf-descarga`,
las tres de componentes de etiqueta y las guardias.

---

## 10. Lo que NO se rompió (comprobado, no supuesto)

- **Nada se recorta.** V1 (reconstrucción exacta contra el literal del fixture)
  sigue corriendo sobre los 8 casos × 4 hojas × 2 generadores.
- **El peor caso entra entero en las cuatro hojas.** Medido en §5.
- **QR y barcode no se comprimen.** 26 mm y 16 mm en la celda base, afirmado
  contra `layout.qrMm` / `layout.barcodeMm` en V8c y V8d, en las cuatro hojas.
- **El arreglo del fallo mudo de jsPDF** (los 27 caracteres cp1252) se queda
  intacto, y `fuenteDeValor` gana la negrita **sin** tocar esa precedencia: si un
  texto necesita la fuente embebida —que no tiene versión negrita— se dibuja en
  su único estilo antes que perder un carácter.
- **Diff cero entre los dos generadores** (§8).
