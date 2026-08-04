# Feature 183 — bitácora del FRONTEND (bloque E · T12, T13, T14)

> Rama `feature/183-neto-bruto-caja`. Ejecutado por `frontend_dev`.
> **Alcance:** T12–T14, requisitos **R19–R23**. `lib/**`, `db/**` y los tests de backend
> **no se tocaron**: son los bloques A–D, ya commiteados (`progress/impl_183_backend.md`).
> **Lo que manda:** `progress/decision_183.md` (⟨D12⟩, humano, 2026-08-04, CERRADA) y las
> dos preguntas de la puerta que afectan a este bloque, cerradas el mismo día:
> **P2 = (a)** (etiqueta «Bruto», sin línea secundaria) y **P3 = (a)** (el neto de
> `egresos` conserva su signo negativo; `formatearValor` no se toca).

---

## 1. El estado en el que se recibió el repo

`pnpm run typecheck` daba **19 errores en 6 archivos, todos de frontend**. No era una
regresión: era la lista de trabajo declarada por `design.md §3.2` («dejan de compilar,
los seis, uno a uno; es el efecto buscado»). El backend convirtió `ImporteAnalitico` en
una unión discriminada por `forma`, así que leer `.neto` de un importe que no lo tiene
dejó de compilar — que es exactamente lo que R2 exige.

**Al cierre de este bloque: `pnpm run typecheck` → 0 errores.**

---

## 2. Qué se hizo, por tarea

### T12 — `adaptar.ts`

Commit `17184b28`.

- **`filasDeVista` escribe la clave `neto` SOLO si el importe la publica.** La decisión
  vive en una función nueva, `valoresDeImporte(importe)`, que ramifica por `forma` y es
  **total**: no hay rama de rescate. Ni `null`, ni `0`, ni `""`, ni derivada del bruto
  (R23).
- **Nacen `COLUMNAS_IMPORTE_SOLO_BRUTO` y `columnasDeVista(vista)`.** La columna del
  neto **no existe** en vez de existir vacía, y ese es el punto: `TablaResumen` pinta el
  marcador de dato ausente en toda celda cuya clave no encuentra
  (`TablaResumen.tsx:73`), y ese marcador significa «no se sabe» (R15 de la 132). Aquí
  la verdad es «no aplica» (R19).
  Sigue habiendo **una** declaración de columnas: `COLUMNA_BRUTO` y `COLUMNA_NETO` se
  declaran sueltas y los dos juegos se componen de ellas, así que **comparten el mismo
  objeto de bruto** y no pueden divergir en etiqueta ni en unidad.
- **`serieDeVista` se estrecha por forma, con dos sobrecargas**:
  `(VistaConNeto, CampoImporte)` y `(VistaFinanciera, "bruto")`. De una vista cualquiera
  solo se puede pedir el `"bruto"`; el `"neto"` exige haber pasado por `esVistaConNeto`.
  Es lo que impide en **compilación** que una vista sin neto emita dos series (R21).
- **`esVistaConNeto(vista)`** comprueba el total **y todas las filas**. R18 de la 183
  garantiza que una vista no mezcla formas, pero comprobar solo el total dejaría que una
  vista mal formada colara una fila sin neto en una serie que lo pide, y ahí el fallo
  aparecería como cifra y no como error.
- **`ImporteSinNetoError`**: forzar la llamada prohibida con un `as` (o con un DTO que
  llegue por JSON sin pasar por el tipo) **falla con nombre**; no devuelve el ausente ni
  el bruto disfrazado de neto. Es la mitad de R23 que no se puede expresar en el tipo.
- El módulo sigue siendo **puro**: sin React, sin JSX, sin I/O; solo `import type` de los
  dos contratos. Y sigue sin sumar, restar ni derivar importes (R14 de la 132).

### T13 — `TableroFinanciero.tsx`

Commit `15cbeb74`.

- **`TotalDelDto`** ramifica por `total.forma`: con neto, exactamente como hasta hoy
  («Total neto» + «Total bruto»); sin neto, la línea del neto se **omite**, no se pinta
  vacía ni con el marcador.
- **`PanelKpi`** ramifica por `total.forma`: con neto, KPI = neto + línea secundaria del
  bruto (R16/132, R20); sin neto, **KPI = bruto con la etiqueta «Bruto»** —la que ya
  existía en `TEXTOS`— y **sin línea secundaria** (P2). No se deja sin etiqueta: el
  nombre de la métrica está en la cabecera de la sección, pero un KPI sin etiqueta pierde
  el nombre accesible que la 132 le dio.
- **`serieAcotada(vista, campo)` se parte en `acotar(serie)`** más dos selectores:
  - `seriesComparativas(vista)` → **dos** series donde el importe trae los dos campos,
    **una** (la del bruto) donde no (R21);
  - `serieUnica(vista)` → la serie del donut: el neto donde lo hay, el bruto donde no.
    El donut sigue recibiendo **una** serie, que es lo que lleva haciendo desde la 132
    (aplica el techo a los **segmentos** de la única serie que pinta).
  Partirlo en `acotar` evitó tener que duplicar las sobrecargas de `serieDeVista` en el
  componente y quitó el único sitio donde habría hecho falta un `as`.
- **`PanelTabla`** pide sus columnas a `columnasDeVista(vista)`.
- **Ningún id de métrica escrito en el componente** (R22): las cuatro ramas nuevas
  preguntan por `forma` o por `esVistaConNeto`.
- **`formatearValor` NO se tocó** (P3): el KPI de `egresos` sigue pintando su neto
  negativo tal cual.

### T14 — Tests de tablero y adaptador

Commits `0b9c7f53` y `dcd2a40c`.

**El helper compartido de fixture** — `tests/fixtures/importe-analitico.ts`
(`importeConNeto`, `importeSoloBruto`, `sinNeto`, `MONEDA_QUE_NADIE_LEE`). Solo
`import type`, así que no arrastra un byte de runtime a jsdom. Vive en `tests/fixtures/`
y **no** en `tests/unit/services/_dobles-analitica-financiera.ts` (que es lo que
`design.md §9` sugería) por una razón medida: aquel archivo importa
`AnaliticaFinancieraService` y con él la cadena de repositorios, y los tests de
componente corren en jsdom. Es **complementario** de `conNeto()`/`soloBruto()` de aquel
archivo, no un duplicado: aquellos **leen** estrechando por forma; estos **construyen**.

**Dadas vuelta, no borradas** (R25):

| Dónde | Qué afirmaba | Qué afirma ahora |
|---|---|---|
| `TableroFinanciero.test.tsx`, bloque R16/132 | el KPI de `ingreso_flete` muestra neto 900 y bruto 1000 | el KPI de **`egresos`** muestra neto −3.600 y bruto 4.000. R16 queda **reinterpretado**, no derogado: se muda a donde el requisito sigue teniendo material |
| Fixture de las tres de Q1 | neto 900 / 1800 / 2700, distinto del bruto — una combinación que la base **no admite** (su `Σ egreso` es 0 por el `CHECK` de la 173) | **pierden el campo**, no lo igualan: publican `solo_bruto`. Igualar las cifras habría dejado la fixture «arreglada» y el requisito sin medir |
| Fixture de `egresos` | bruto 4000 / neto 3600 (positivo) | bruto 4000 / **neto −3600**: P3 se mide, y el neto no es `−bruto` para que un panel que pintara la misma cifra dos veces no pase |
| `AnaliticaPage.test.tsx` | la fixture es `ingreso_flete` con bruto **y** neto | la fixture es **`egresos`**. Las DOS cifras son el punto de ese archivo (R2 exige que ninguna deje rastro para un rol sin acceso); con `ingreso_flete` habría quedado una sola y media aserción vacía |
| `tablero-financiero-cargar.test.ts`, `tablero-financiero-adaptar.test.ts` | importes `{bruto, neto, moneda}` a mano | los mismos importes por el helper compartido; el DTO sigue siendo REAL (sin `as unknown as`) y el tipo sigue vigilando |

**Casos nuevos** (11 en el adaptador, 12 en el tablero): están en el mapa de §4.

---

## 3. Archivos creados / modificados

| Archivo | Qué |
|---|---|
| `app/(app)/analitica/_components/financiero/adaptar.ts` | T12: `valoresDeImporte`, `columnasDeVista`, `COLUMNAS_IMPORTE_SOLO_BRUTO`, `VistaConNeto`, `esVistaConNeto`, sobrecargas de `serieDeVista`, `ImporteSinNetoError` |
| `app/(app)/analitica/_components/financiero/TableroFinanciero.tsx` | T13: `TotalDelDto` y `PanelKpi` por `forma`; `acotar` + `seriesComparativas` + `serieUnica`; `columnasDeVista` en la tabla |
| `tests/fixtures/importe-analitico.ts` | **nuevo** — el helper compartido de fixture (T14) |
| `tests/unit/analytics/tablero-financiero-adaptar.test.ts` | T14: fixtures por el helper + 11 casos nuevos (R19, R21, R22, R23) |
| `tests/unit/analytics/tablero-financiero-cargar.test.ts` | T14: fixture por el helper |
| `tests/components/TableroFinanciero.test.tsx` | T14: fixtures con la forma real de las diez + R16/132 dado vuelta + 12 casos nuevos (R19, R20, R21, R22) |
| `tests/components/AnaliticaPage.test.tsx` | T14: fixture por el helper, mudada a `egresos` |

**Cero cambios en `lib/**`, `db/**`, `components/**` ni en tests de backend.** Comprobado:

```
$ git diff --name-only f802a85f..HEAD -- lib/ db/ components/ prisma/
(vacío)
```

Commits:

```
17184b28 feat(183/E): `adaptar.ts` deja de escribir el `neto` que el DTO no trae
15cbeb74 feat(183/E): el tablero ramifica por `total.forma`, no por el id de la metrica
0b9c7f53 test(183/E): R19-R23 medidos, y las fixtures ganan el discriminante con UN helper
dcd2a40c test(183/E): el marcador de ausente se afirma ANTES que la cabecera de la columna
```

---

## 4. Mapa R → test, construido **leyendo el caso citado**

No se contó ninguna mención `R\d+` en títulos: esa técnica cruza espacios de nombres
(los `R14`, `R16`, `R19`, `R20`, `R21`, `R22`, `R23` de la 130/132/183 conviven en estos
mismos archivos — `Feature 132 (R23)` es «el panel en error no pinta cifras», que no
tiene nada que ver con el R23 de la 183) y ya produjo un falso 68/68 en este repo. Cada
fila cita el **nombre exacto del caso** y lo que ese caso comprueba de verdad.

| R | Archivo · caso | Qué comprueba (leído) |
|---|---|---|
| **R19** | `tests/components/TableroFinanciero.test.tsx` · «Feature 183 (R19) …» → ``` `%s` pinta su bruto como cifra del KPI, con la etiqueta «Bruto» (P2)``` (×3, una por métrica de Q1) | en la sección de cada métrica sin neto aparece el texto **«Bruto»** (la etiqueta del KPI, o sea su nombre accesible) y la cifra del **bruto** del DTO (1000 / 2000 / 3000) |
| **R19** | mismo archivo · ``` `%s` no muestra la etiqueta «Neto» ni una línea secundaria``` (×3) | `queryByText("Neto")` y `queryByText("Total neto")` son `null`, el `textContent` de la sección **no casa `/neto/i`**, y **tampoco** existe la línea `Bruto: <cifra>` (P2: sin línea secundaria) |
| **R19** | mismo archivo · ``` `%s` no pinta el marcador de dato ausente en el lugar del neto``` (×3) | `queryAllByText(formatearValor(null,"moneda"))` dentro de la sección tiene **longitud 0**. El marcador se toma del paquete (`SIN_MONTO`), no se escribe a mano. `queryByText` compara el texto COMPLETO del elemento, así que el guion largo de las fechas del rango no lo dispara |
| **R19** | mismo archivo · «una tabla de una vista sin neto no declara la columna del neto» | sobre la vista por tienda **con la distinción retirada**: cero celdas con el marcador de ausente, cero `columnheader` «Neto», y sí `columnheader` «Bruto». Es la otra cara de R19: el ausente en la **tabla** aparecería solo, sin que nadie lo escriba |
| **R19** | `tests/unit/analytics/tablero-financiero-adaptar.test.ts` · «R19/183 …» → «la tabla de una vista sin neto no puede pintar el ausente: no hay celda donde pintarlo» | para cada fila y cada columna de `columnasDeVista`, `fila.valores[columna.id]` **no es `undefined`** — o sea que columnas y filas no pueden desincronizarse, que es la condición para que el marcador no nazca |
| **R20** | `tests/components/TableroFinanciero.test.tsx` · «Feature 132 (R16) / 183 (R20) …» → «el panel de KPI muestra el neto como cifra y el bruto etiquetado aparte» | sobre **`egresos`**: la cifra del neto (−3.600) está, el texto `Bruto: <4.000>` está, y las dos cifras **son distintas entre sí** (`expect(neto).not.toBe(bruto)`) |
| **R20** | mismo bloque · «el panel de tabla muestra el total del DTO en sus dos formas» | sobre `cuenta_por_pagar_tienda`: «Total neto», «Total bruto» y sus dos cifras (128 / 140) |
| **R20** | mismo bloque · «la tabla de una vista CON neto conserva sus dos columnas de importe» | `columnheader` «Neto» **y** `columnheader` «Bruto». Es el contrapeso del caso de R19: sin él, un tablero que unificara todo en «solo bruto» pasaría R19 en verde |
| **R20** | mismo bloque · «el neto de `egresos` conserva su signo negativo (P3, humana 2026-08-04)» | la cifra pintada es `−3.600,00` y **no** `3.600,00`: `formatearValor` no se tocó |
| **R20** | `tablero-financiero-adaptar.test.ts` · «la vista CON neto sigue escribiendo las dos claves: la retirada no se generalizo (R20)» | `Object.keys(fila.valores)` = `["bruto","neto"]` y el neto vale 1 200 000. Sin este caso, un adaptador que **nunca** escribiera el neto pasaría los tres casos de R23 |
| **R21** | `tests/components/TableroFinanciero.test.tsx` · «Feature 183 (R21) …» → «sin neto, la MISMA gráfica recibe UNA: ninguna entrada de la serie del neto» | se leen los `<li>` de la alternativa textual de la gráfica (`SerieTextual`, que nombra `serie.etiqueta` en cada entrada): **cero** entradas `neto, …`, **cinco** `bruto, …`, **cinco en total** |
| **R21** | mismo bloque · «con neto, la gráfica comparativa recibe DOS series: la del bruto y la del neto» | **cinco** entradas `bruto, …` **más cinco** `neto, …` = **diez**. Es el lado que hay que conservar, y el que fija que el techo `MAX_SERIES` se consume al doble solo donde hay material |
| **R21** | `tablero-financiero-adaptar.test.ts` · «R21/183 …» → «pedirle el neto FALLA con nombre en vez de devolver el ausente o el bruto» | forzando la llamada con un `as`, `serieDeVista(vista,"neto")` lanza `ImporteSinNetoError` y el mensaje nombra el cubo. En compilación la llamada ni existe: son las sobrecargas |
| **R21** | mismo archivo · «`esVistaConNeto` responde por la forma del total Y de las filas, no por el id» | `true` para la vista con neto, `false` para la misma sin neto, y **`false` para una vista MEZCLADA** cuyo total sí publica neto (se afirma explícitamente que `mezclada.total.forma === "bruto_y_neto"` antes de exigir el `false`) |
| **R22** | `tests/components/TableroFinanciero.test.tsx` · «Feature 183 (R22) …» → «la misma vista, con y sin neto, produce dos pantallas distintas» | dos renders de la **misma** vista (mismo id de métrica, mismo id de vista, mismo grano, mismos brutos) que solo se diferencian en `forma`: los `textContent` de la sección **difieren**, uno casa `/neto/i` y el otro no. Un tablero que decidiera por una lista de ids escrita a mano daría el mismo resultado para las dos |
| **R22** | mismo bloque · «las tres métricas sin neto y las siete con neto conviven en el MISMO tablero» | en un **único** render, las tres secciones de Q1 no casan `/neto/i` y las de `egresos`, `dinero_en_caja` y `ganancia_ordenex` sí. Descarta un interruptor global |
| **R22** | `tablero-financiero-adaptar.test.ts` · «las dos vistas tienen el MISMO id: lo que decide es la forma del DTO y no la metrica (R22)» | `vistaDeEjemploSoloBruto().id === vistaDeEjemplo().id` y aun así `columnasDeVista` devuelve juegos distintos |
| **R22** | `tests/unit/guards/tablero-financiero.guardia.test.ts` · «ningun archivo escribe una lista de ids financieros a mano» | censo del fuente de toda la carpeta `financiero/`: un array literal con ≥2 ids de `IDS_FINANCIERAS_SERVIDAS` lo pone rojo (medido, M4). **Límite honesto abajo, §6** |
| **R23** | `tablero-financiero-adaptar.test.ts` · «R23/183 …» → «la fila adaptada de una vista `solo_bruto` NO tiene la clave `neto`, de ninguna manera» | `Object.keys(fila.valores)` = `["bruto"]` y `"neto" in fila.valores` es `false`. El `in` es lo que distingue «ausente» de «presente con valor nulo», que es justo lo que un `neto: null` haría indistinguible |
| **R23** | mismo bloque · «y no la tiene ni en `null`, ni en `0`, ni en cadena vacia, ni copiada del bruto» | las cuatro formas de la mutación, una a una sobre el mismo objeto: `toBeUndefined`, `not.toBeNull`, `not.toBe(0)`, `not.toBe("")`, `not.toBe(valores.bruto)` |
| **R23** | mismo archivo · «pedirle el neto FALLA con nombre…» (citado también en R21) | la ausencia tampoco se convierte en el dato ausente por la vía de la **serie**: se lanza |

**Cubiertos aquí: R19, R20, R21, R22, R23 (5 de 5 del bloque E).**
**Fuera de este encargo:** R1–R18, R24, R25, R27 (backend, `progress/impl_183_backend.md`)
y R26 (bloque F / T15).

---

## 5. Mutaciones: **10 aplicadas, 10 muertas**

Cada mutación se aplicó **de verdad** al código de producción, se corrieron los tests
relacionados y se revirtió con `git checkout --`. Salida real pegada. Árbol limpio
después de cada una.

### M1 · R19 — se pinta `null` donde iba el neto
`PanelKpi`, rama `solo_bruto`: `<KpiCard etiqueta={TEXTOS.neto} valor={null} …/>` más la
línea secundaria del bruto. Es **literalmente** la mutación que R19 nombra.

```
     × `ingreso_flete` pinta su bruto como cifra del KPI, con la etiqueta «Bruto» (P2) 28ms
     × `ingreso_comision_cod` pinta su bruto como cifra del KPI, con la etiqueta «Bruto» (P2) 28ms
     × `ingreso_iva` pinta su bruto como cifra del KPI, con la etiqueta «Bruto» (P2) 24ms
     × `ingreso_flete` no muestra la etiqueta «Neto» ni una línea secundaria 30ms
     × `ingreso_comision_cod` no muestra la etiqueta «Neto» ni una línea secundaria 24ms
     × `ingreso_iva` no muestra la etiqueta «Neto» ni una línea secundaria 23ms
     × `ingreso_flete` no pinta el marcador de dato ausente en el lugar del neto 23ms
     × `ingreso_comision_cod` no pinta el marcador de dato ausente en el lugar del neto 33ms
     × `ingreso_iva` no pinta el marcador de dato ausente en el lugar del neto 24ms
     × las tres métricas sin neto y las siete con neto conviven en el MISMO tablero 18ms
TestingLibraryElementError: Unable to find an element with the text: Bruto.
AssertionError: expected <p …(1)></p> to be null
AssertionError: expected 'Ingreso por fleteRango: 2026-07-05 — …' not to match /neto/i
 Test Files  1 failed | 1 passed (2)
      Tests  10 failed | 55 passed (65)
```
**MUERTA**, y por los tres lados que R19 pide: el marcador aparece, la etiqueta «Neto»
vuelve y el KPI pierde su nombre accesible «Bruto».

### M2 · R20 — se unifican TODOS los paneles en «solo bruto»
`TotalDelDto` deja de pintar el bloque del neto, `PanelKpi` toma siempre la rama de solo
bruto y `columnasDeVista` devuelve siempre `COLUMNAS_IMPORTE_SOLO_BRUTO`.

```
     × una vista `solo_bruto` declara UNA columna y una `bruto_y_neto` declara DOS 5ms
     × las dos vistas tienen el MISMO id: lo que decide es la forma del DTO y no la metrica (R22) 1ms
     × el panel de KPI muestra el neto como cifra y el bruto etiquetado aparte 25ms
     × el neto de `egresos` conserva su signo negativo (P3, humana 2026-08-04) 24ms
     × el panel de tabla muestra el total del DTO en sus dos formas 20ms
     × la tabla de una vista CON neto conserva sus dos columnas de importe 68ms
     × las tres métricas sin neto y las siete con neto conviven en el MISMO tablero 33ms
     × la vista por metodo de pago muestra el neto del DTO y no la suma de sus metodos 29ms
     × la vista por tienda muestra los totales del DTO y no la suma de sus seis cubos 20ms
     × el saldo al corte de la cuenta por pagar es el del DTO y no la suma de sus tiendas 16ms
Unable to find an element with the text: -₡3 600,00
Unable to find an element with the text: Total neto
Unable to find an accessible element with the role "columnheader" and name "Neto"
AssertionError: expected 'Egresos del períodoRango: 2026-07-05 …' to match /neto/i
 Test Files  2 failed (2)
      Tests  10 failed | 55 passed (65)
```
**MUERTA**, y exactamente donde R20 lo predice: **el panel de `egresos`** y **la tabla de
`cuenta_por_pagar_tienda`**.

### M3 · R21 — se emiten DOS series iguales donde no hay neto
`seriesComparativas` devuelve la serie del bruto y una copia suya etiquetada `"neto"`.

```
     × sin neto, la MISMA gráfica recibe UNA: ninguna entrada de la serie del neto 21ms
     × la misma vista, con y sin neto, produce dos pantallas distintas 34ms
AssertionError: expected [ 'neto, tienda-aaa: ₡201,00', …(4) ] to have a length of +0 but got 5
AssertionError: expected 'Recaudo CODRango: 2026-07-05 — 2026-0…' not to match /neto/i
 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 63 passed (65)
```
**MUERTA.** El mensaje enseña la serie inventada: `neto, tienda-aaa: ₡201,00` — el
**bruto** de esa tienda con nombre de neto, que es la mentira que R21 evita.

### M4 · R22(a) — una LISTA de ids financieros escrita en el componente
`const IDS_SIN_NETO = ["ingreso_flete", "ingreso_comision_cod", "ingreso_iva"];` dentro
de `PanelKpi`, usada para decidir.

```
     × ningun archivo escribe una lista de ids financieros a mano 6ms
AssertionError: reescriben IDS_FINANCIERAS_SERVIDAS: expected [ Array(1) ] to deeply equal []
 Test Files  1 failed (1)
      Tests  1 failed | 19 passed (20)
```
**MUERTA** por el guardia de censo del tablero, que es donde R22 la nombra.

### M5 · R22(b) — se decide por el ID de la vista en vez de por la forma
`columnasDeVista`: `v.id.startsWith("cod_recaudado") ? COLUMNAS_IMPORTE : …`.

```
     × una vista `solo_bruto` declara UNA columna y una `bruto_y_neto` declara DOS 5ms
     × las dos vistas tienen el MISMO id: lo que decide es la forma del DTO y no la metrica (R22) 2ms
     × la tabla de una vista sin neto no puede pintar el ausente: no hay celda donde pintarlo 0ms
     × la tabla de una vista CON neto conserva sus dos columnas de importe 68ms
     × una tabla de una vista sin neto no declara la columna del neto 18ms
     × la misma vista, con y sin neto, produce dos pantallas distintas 32ms
AssertionError: expected <th scope="col" …(1)></th> to be null
AssertionError: expected 'Recaudo CODRango: 2026-07-05 — 2026-0…' not to match /neto/i
 Test Files  2 failed | 1 passed (3)
      Tests  6 failed | 79 passed (85)
```
**MUERTA**, y **el guardia de censo siguió VERDE** con esta variante. Es un hallazgo, no
un detalle: ver §6.

### M6a · R23 — `neto: importe.neto ?? bruto` (la mutación literal del spec)

```
     × la fila adaptada de una vista `solo_bruto` NO tiene la clave `neto`, de ninguna manera 6ms
     × y no la tiene ni en `null`, ni en `0`, ni en cadena vacia, ni copiada del bruto 1ms
AssertionError: expected [ 'bruto', 'neto' ] to deeply equal [ 'bruto' ]
AssertionError: expected 1234567.89 to be undefined
 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 63 passed (65)
```
**MUERTA** — «encuentra la clave `neto` donde no debe haber ninguna», y con el valor del
**bruto** dentro, que es lo que delata la derivación.

### M6b · R23 — la ausencia se convierte en `null`

```
     × la fila adaptada de una vista `solo_bruto` NO tiene la clave `neto`, de ninguna manera 5ms
     × y no la tiene ni en `null`, ni en `0`, ni en cadena vacia, ni copiada del bruto 1ms
AssertionError: expected [ 'bruto', 'neto' ] to deeply equal [ 'bruto' ]
AssertionError: expected null to be undefined
 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 63 passed (65)
```
**MUERTA.** Se corrió aparte de M6a a propósito: `?? bruto` y `null` son dos mentiras
distintas y el caso tiene que separarlas (`expected null to be undefined` vs
`expected 1234567.89 to be undefined`).

### M7 · R19 — la columna del neto existe SIEMPRE
`columnasDeVista` devuelve siempre `COLUMNAS_IMPORTE`.

```
     × una vista `solo_bruto` declara UNA columna y una `bruto_y_neto` declara DOS 5ms
     × las dos vistas tienen el MISMO id: lo que decide es la forma del DTO y no la metrica (R22) 2ms
     × la tabla de una vista sin neto no puede pintar el ausente: no hay celda donde pintarlo 0ms
     × una tabla de una vista sin neto no declara la columna del neto 21ms
     × la misma vista, con y sin neto, produce dos pantallas distintas 29ms
 Test Files  2 failed (2)
      Tests  5 failed | 60 passed (65)
```
**MUERTA.** Y aquí saltó algo que obligó a **rehacer el orden de un caso**: con la
mutación aplicada, «una tabla de una vista sin neto no declara la columna del neto»
moría por la **cabecera** y la afirmación que de verdad enuncia R19 —que el marcador de
ausente no aparece— nunca llegaba a evaluarse. Reordenado el caso (commit `dcd2a40c`) y
repetida la mutación, la evidencia es la correcta:

```
     × una tabla de una vista sin neto no declara la columna del neto 176ms
AssertionError: expected [ Array(6) ] to have a length of +0 but got 6
      Tests  1 failed | 34 skipped (35)
```
**SEIS celdas** pintando «no se sabe» donde la verdad es «no aplica». Es la colisión que
R19 existe para evitar, ahora visible en el mensaje del fallo.

### M8 · R21 (contrapeso) — UNA serie siempre, también donde hay neto

```
     × con neto, la gráfica comparativa recibe DOS series: la del bruto y la del neto 39ms
AssertionError: expected [] to have a length of 5 but got +0
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 64 passed (65)
```
**MUERTA.** Sin este contrapeso, el caso de R21 pasaría en verde con un tablero que
hubiera perdido la serie doble en todas partes.

### M9 · R21/R18 — `esVistaConNeto` mira SOLO el total, no las filas

```
     × `esVistaConNeto` responde por la forma del total Y de las filas, no por el id 5ms
AssertionError: expected true to be false
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 64 passed (65)
```
**MUERTA** por el caso de la vista mezclada. Es la que justifica que el predicado recorra
las filas: sin ella, una vista mal formada colaría una fila sin neto en la serie del neto
y el fallo aparecería como cifra, no como error.

**Resumen: 10 mutaciones aplicadas · 10 muertas. Ninguna sobrevivió**, pero **una (M7)
mató un caso por la aserción equivocada** y obligó a reordenarlo para que la evidencia
del fallo fuera la del requisito.

---

## 6. Un límite medido, no supuesto: el guardia **no** caza el `if` por id suelto

R22 dice que su mutación es «un `if (metricaId === "ingreso_flete")` en el tablero → el
guardia de censo del tablero lo caza». **Medido: no lo caza, y es por diseño de aquel
guardia.** `listasDeIdsAMano` (`tablero-financiero.guardia.test.ts:195-204`) solo marca
un array literal con **dos o más** ids servidos, y su propia autocomprobación lo dice con
todas las letras:

```js
expect(listasDeIdsAMano(`if (panel.id === "${primero}") return null;`)).toEqual([]);
```

Es una decisión razonable de aquel guardia —una comparación suelta no es reescribir el
catálogo— pero significa que **el guardia solo cubre la mitad de R22**:

- la **lista** de ids escrita en el componente → **guardia rojo** (M4, medido);
- una **decisión por id** que no forma lista → **guardia verde** (M5, medido).

La otra mitad la cubren los **casos de comportamiento** de §4: las dos fixtures de R22
comparten id de métrica, id de vista, grano y brutos, y solo se diferencian en `forma`.
M5 las puso rojas (6 casos). Está registrado aquí porque es exactamente el tipo de hueco
que el reviewer de la 173 encontró cuatro veces: **citar un guardia que no mide lo que se
le atribuye.** No se tocó el guardia de la 132 para ensancharlo: hacerlo entraría en
`tests/unit/guards/` sin encargo y cambiaría el criterio de una feature `done`.

---

## 7. Salida real de la verificación

### Los cuatro archivos de test del bloque

```
$ pnpm exec vitest run \
    tests/unit/analytics/tablero-financiero-adaptar.test.ts \
    tests/unit/analytics/tablero-financiero-cargar.test.ts \
    tests/components/TableroFinanciero.test.tsx \
    tests/components/AnaliticaPage.test.tsx

 Test Files  4 passed (4)
      Tests  108 passed (108)
   Duration  7.15s
```

### Todas las guardias del repo

```
$ pnpm exec vitest run guard

 Test Files  59 passed (59)
      Tests  812 passed (812)
   Duration  4.74s
```

### `pnpm run typecheck` — **0 errores**

```
$ pnpm run typecheck
> tsc --noEmit
(sin salida) — EXIT=0
```

Los 19 errores en 6 archivos con los que se recibió el repo están todos cerrados, y
ninguno se cerró con un `as`, un `any` ni un `@ts-ignore`. El único `as` del bloque está
en un caso de test y **es lo que ese caso mide**: que forzar la llamada prohibida lanza
en vez de inventar.

### `pnpm run lint` sobre lo tocado

```
$ pnpm exec eslint <los 7 archivos tocados>
(sin salida) — EXIT=0
```

### Estabilidad frente al flake de jsdom

Se tocó DOM, así que `TableroFinanciero.test.tsx` se corrió **en solitario ×3**:
**3/3 en verde**, 35 casos cada una, fase `tests` entre 956 ms y 973 ms (dispersión ~2%).

Los tres mecanismos de `progress/chore_flake_jsdom.md` **no aplican a lo escrito aquí**,
y se comprobó uno a uno antes de darlo por bueno:

1. **`await import()` dentro del `it`** — no hay ninguno: los casos nuevos son síncronos
   y el componente es de servidor, se renderiza directo.
2. **`waitFor` sobre una ausencia + aserción síncrona de presencia** — no hay ningún
   `waitFor` en los casos nuevos: `TableroFinanciero` no carga nada, recibe los paneles
   por props ya resueltos.
3. **Foto del DOM antes de que la carga asiente** — el caso de R22 compara dos
   `textContent` de dos renders **distintos y completos**, con `cleanup()` explícito
   entre medias; no hay carga en vuelo que pueda asentarse entre las dos lecturas.

`./init.sh` (en cualquiera de sus dos formas) **no se corrió**: lo corre el leader.

---

## 8. Lo que este agente NO hizo, a propósito

- `lib/**`, `db/**` y los tests de backend — son los bloques A–D, ya commiteados.
- Las notas fechadas en `specs/127-*` y `specs/132-*` (T15 / R26) — bloque F.
- `progress/impl_183.md` con el mapa de los 27 requisitos (T16) — bloque F; aquí está
  el de R19–R23, que es lo que este bloque puede afirmar leyendo sus propios casos.
- Ensanchar `tests/unit/guards/tablero-financiero.guardia.test.ts` — ver §6.
- `formatearValor` (P3) y cualquier otra cosa del paquete de la 130.
- `./init.sh` — lo corre el leader.

## 9. Veredicto

Bloque E completo (T12–T14): el tablero ramifica por la forma del DTO y no por ninguna
lista de ids; donde no hay neto no hay etiqueta, ni línea, ni columna, ni marcador de
ausente; donde lo hay siguen los dos y distinguibles, con el signo negativo intacto; una
vista sin neto emite una serie y no dos; el adaptador no rellena la ausencia con nada y
falla con nombre si se le fuerza. Diez mutaciones aplicadas y diez muertas —una obligó a
reordenar un caso que moría por la aserción equivocada— y un límite del guardia de la 132
medido y escrito en vez de dado por bueno. `pnpm run typecheck` en **0 errores**.
