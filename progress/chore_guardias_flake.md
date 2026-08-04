# Chore — dos guardias que afirmaban cobertura que no tenían, y el tercer mecanismo del flake

Rama: `chore/guardias-y-flake` (desde `origin/dev`). Solo se toca `tests/**`.

> **Las tres estaban cerradas.** Ninguna era un bug: las dos guardias hacían exactamente lo
> que declaraban, y el flake (3) ya tenía su arreglo puntual. Lo que faltaba era la cobertura
> que se les atribuía. Los tres censos nuevos se validaron **ejecutando la mutación que
> existen para cazar** y, en los tres, además **la contraprueba**: un caso legítimo parecido
> que tiene que seguir verde. Sin la segunda mitad no se sabe si el guardia discrimina o solo
> grita.

| | Qué | Cómo quedó |
| --- | --- | --- |
| **1** | `listasDeIdsAMano` no cazaba la decisión por un id suelto (R22/183, R27/132) | **cerrado** — censo (f) nuevo, 2 mutaciones |
| **2** | La guardia de R14 solo mataba su mutación si la fecha huérfana permanecía | **cerrado** — regla 2 nueva, 3 mutaciones |
| **3** | Tercer mecanismo del flake de jsdom, sin detector | **cerrado** — censo del ANCLA, 9 sitios marcados y arreglados |

---

## 1. El tablero financiero no puede decidir por el id de una métrica

**Archivo:** `tests/unit/guards/tablero-financiero.guardia.test.ts` (censo `(f)`,
`decisionesPorIdDeMetrica`).

### El agujero, y por qué el censo viejo no era el sitio

`listasDeIdsAMano` filtra literales de array y exige `presentes.length >= 2`. Su propia
autocomprobación declara que un id suelto no cuenta. **Eso está bien para lo que vigila** —una
lista reescrita que redefine el catálogo— y por eso NO se tocó. Lo que faltaba era otro censo:
R22 de la 183 y R27 de la 132 exigen que el tablero decida **por la forma del DTO**, y
`if (metricaId === "ingreso_flete")` viola eso pasando verde.

### Dónde está la frontera (lo único difícil)

El tablero **sí** decide por identificadores, y es legítimo: la cabecera de
`TableroFinanciero.tsx` declara que elige componente por «tipo, **id de vista**, grano, si
trae filas». Los dos vocabularios son disjuntos y viven en módulos distintos:

- id de **vista** → `"cod_recaudado__por_metodo"`, y además llega por constante importada;
- id de **métrica** → `"cod_recaudado"`, uno de los diez de `IDS_FINANCIERAS_SERVIDAS`.

Por eso el literal se exige **completo entre comillas**: la vista empieza por el id de la
métrica y **no** se marca, porque tras `cod_recaudado` viene `_` y no la comilla de cierre. Es
la misma técnica de `listasDeIdsAMano`, aplicada a un id suelto.

Se marcan cuatro formas: comparación (en los dos órdenes), `case`, prueba de pertenencia
(`.includes` / `.startsWith` / `.indexOf`) y literal de array **con uno solo ya basta** (una
lista de ids en la pantalla solo existe para preguntarle si contiene algo, y el `.includes`
suele estar en otra línea).

**Límite declarado dentro del propio censo:** no se marca un id como **clave** de un objeto de
presentación (`ETIQUETAS[id]`). Buscar un texto por clave no ramifica qué se pinta —que es lo
que R22 prohíbe— y marcarlo convertiría el guardia en fuente de falsos positivos. El censo
cubre la **decisión**, no el diccionario.

### Mutación (la que nombra el spec) — ROJA

`app/(app)/analitica/_components/financiero/TableroFinanciero.tsx`, en `seccionesDePanel`:

```ts
if (panel.id === "ingreso_flete") return null;
```

```
FAIL tests/unit/guards/tablero-financiero.guardia.test.ts > R27 · la lista de metricas
     financieras tiene una sola fuente > ningun archivo decide por el id de una metrica financiera
AssertionError: ramifican por el nombre de la metrica en vez de por la forma del DTO
  (tipo, id de vista, grano, filas, forma del importe): expected [ Array(1) ] to deeply equal []

+ [
+   "app/(app)/analitica/_components/financiero/TableroFinanciero.tsx: ingreso_flete: === \"ingreso_flete\"",
+ ]

 Tests  1 failed | 23 passed (24)
```

Revertida.

### Contraprueba — VERDE

Al mismo archivo se le añadieron **dos decisiones legítimas**, incluida la que más se parece a
la prohibida (el id de **vista** escrito entero, que empieza por el id de la métrica):

```tsx
if (vista.id === "cod_recaudado__por_metodo") { ... }
if (vista.grano === "fecha" && vista.total.forma === "solo_bruto") { ... }
```

```
 Test Files  1 passed (1)
      Tests  24 passed (24)
```

`pnpm exec tsc --noEmit` con la contraprueba puesta: limpio (el caso compila, no es texto de
adorno). Revertida.

---

## 2. Quitar la cita también pone roja la guardia de R14

**Archivo:** `tests/unit/analytics/catalogo-produccion.guardia.test.ts`.

### El agujero, reproducido antes de tocar nada

Con la guardia **original**, borrando del bloque de `egresos` la cita a
`progress/decision_183.md` **y** su fecha (o sea: cambiar `definicion.categorias` sin
documentar nada):

```
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

Verde. Vigilaba la **incoherencia** entre lo escrito, no la **ausencia** de firma. La causa era
el sujeto: `cambiosDecididosEnProgress()` solo derivaba de líneas que nombraran `declarada` y
`producida`, y ⟨D12⟩ cambia `definicion.categorias`, no `estadoProduccion`.

> **Nota de método:** el primer intento de reproducirlo fue con un mutador en modo texto que
> convirtió `metrics.ts` a **CRLF**. Con CRLF, el `split(/\n  \{\n/)` de `bloqueDeEntrada` no
> casa nunca, devuelve **un** trozo —el archivo entero— y la guardia pasa a juzgar el fichero
> completo como si fuera el bloque de cada métrica: acusaba a `incidentes` de citar una fecha
> que está 250 líneas más abajo. Es el precedente de la 172 (un parser que muere ante la
> mutación que existe para cazar), así que **se arregló también**: `bloqueDeEntrada` comprueba
> ahora su propio parseo. Todas las mediciones de abajo se rehicieron con un mutador binario.

### Qué distingue a las entradas que SÍ deben citar

No vale exigir cita a todas: la mayoría del catálogo no tiene decisión humana detrás. Lo que
distingue a las que sí es que **un documento de decisión las nombre junto al campo que toca**.
De ahí la regla 2: una referencia `` `metrica.campo` `` en un `decision_*.md` hace sujeto a esa
entrada. Derivación medida sobre `progress/` (4 documentos):

| Regla | Pares derivados |
| --- | --- |
| 1 (`estado`, la original) | `incidentes`/175, `sin_gestionar`/175, `egresos`/C2_127 |
| 2 (`campo`, nueva) | `egresos`/**183**, `conciliacion_cierres`/C2_127, `egresos`/C2_127 |

**Una regla más ancha se descartó midiendo:** «la decisión nombra la métrica» haría sujetos a
`ingreso_flete`, `ingreso_comision_cod` e `ingreso_iva` —que `decision_183.md` nombra— y sus
entradas del catálogo **no cambian**: sería un falso positivo contra un catálogo correcto.

Además: la derivación pasa a ser una **función pura autocomprobada** sobre texto sintético (si
dejara de casar, la guardia quedaría sin sujetos, verde por vacío, que es el modo de fallo que
ya tuvo), y la comprobación (c) `estadoProduccion === "producida"` se aplica **solo** a los
cambios de estado: una decisión sobre `categorias` no dice nada del estado.

### Mutaciones — las tres ROJAS

**M1 — borrar cita Y fecha** (la que antes quedaba verde):

```
FAIL ... > todo cambio de catalogo decidido en `progress/` esta citado por su entrada
AssertionError: egresos: progress/decision_183.md decide sobre su entrada del catalogo
  y la entrada NO lo cita: expected false to be true
 Tests  1 failed | 4 passed (5)
```

**M2 — borrar solo la cita, dejando la fecha** (la mitad que ya funcionaba): roja.

**M3 — `metrics.ts` en CRLF** (el parser):

```
AssertionError: metrics.ts no se partio en entradas (¿finales de linea CRLF?): el bloque de
  cada metrica seria el archivo entero y toda la comprobacion de abajo miraria el texto
  equivocado: expected 1 to be greater than 25
 ❯ bloqueDeEntrada tests/unit/analytics/catalogo-produccion.guardia.test.ts:95:5
```

Las tres revertidas.

### Contrapruebas — el par que demuestra que discrimina

Añadiendo una línea a `progress/decision_183.md`:

| Línea añadida | Resultado |
| --- | --- |
| «la decisión nombra `` `cod_recaudado` `` sin tocar su entrada» | **VERDE** (5 passed) — no se le exige cita |
| «la decisión cambia `` `cod_recaudado.definicion` ``» | **ROJA**: `cod_recaudado: progress/decision_183.md decide sobre su entrada del catalogo y la entrada NO lo cita` |

Es exactamente la frontera: nombrar la métrica no obliga; nombrar **su campo**, sí. Ambas
revertidas.

---

## 3. Tercer mecanismo del flake de jsdom: el detector va en el ANCLA, no en la foto

**Archivo nuevo:** `tests/unit/guards/ancla-de-carga.guardia.test.ts`.

### Por qué se movió el detector de sitio

`progress/chore_flake_jsdom.md` §7 ya midió que un detector sobre las **capturas** del DOM
tiene **sensibilidad cero** (0 antes del arreglo y 0 después): la espera insuficiente vive
dentro de un helper, a un nivel de indirección de la foto, y «¿deja este helper la UI
asentada?» es semántico. **Se confirmó esa medición antes de repetir el error**, con tres
definiciones de la población de capturas:

| Definición | Sitios |
| --- | --- |
| captura del DOM usada después de un `await` | 287 |
| ídem, pero captura de **valor** (no de un handle) | 3 |
| foto → acción → foto **comparadas** (la forma literal del mecanismo) | **1** (el ya arreglado) |

Un detector sobre esa población marca 1 sitio o 287: ninguno sirve. **El defecto no vive en la
foto: vive en el ancla**, y la forma del ancla sí es sintáctica. Es la propia lección del
documento —«un ancla que el estado transitorio también cumple no es un ancla»— llevada a un
censo.

> Nota: la cifra de «42 capturas» del documento no tiene definición escrita ni script
> commiteado, y no se pudo reproducir con ninguna de las tres definiciones de arriba (la más
> cercana, 42 pares captura→comparación, incluye handles de elemento afirmados en la línea
> siguiente, que no son fotos). Se sustituye por poblaciones **medidas y reproducibles desde
> el propio guardia**.

### La regla

Un `await waitFor(...)` anclado **solo a un conteo de elementos del DOM** no dice QUÉ espera, y
el estado de carga también tiene un número: el `DataTable` pinta en carga un `<tr>` con
`role="status"` más skeletons `aria-hidden` que no cuentan como `row`, de modo que
`header + status = 2` = `header + la fila real`. Debe llevar, **en el mismo `waitFor`**, una
aserción de contenido o la ausencia de `role="status"`.

### Medición

| | |
| --- | --- |
| archivos de test con entorno jsdom | **196** |
| `await waitFor(...)` extraídos | **455** |
| ancladas a contenido | 83 |
| ancladas solo a un mock (**fuera de alcance**, ver límites) | 273 |
| **marcadas por el censo** | **9**, en 6 archivos |

Ni 0 ni todas. Los 9, arreglados en este chore sin cambiar lo que miden:

| Sitio | Arreglo |
| --- | --- |
| `SateliteDescarga.test.tsx:253` y `:264` | + ausencia de `role="status"` |
| `WalletDescarga.test.tsx:379` y `:556` | + ausencia de `role="status"` |
| `WalletPropsDescarga.test.tsx:331` | ancla **positiva**: Beto presente, Ana ausente, sin carga |
| `ColasPaginacion.test.tsx:528` | + ausencia de `role="status"` |
| `SatelitePaginacion.test.tsx:566` y `:568` | + ausencia de `role="status"` |
| `PagosRegistradosTabla.test.tsx:442` | ancla a la entrega del blob (ver §3.bis: el primer intento fue malo) |

Dos merecen explicación. **`WalletPropsDescarga:331` era el mismo caso histórico**: búsqueda
resuelta en el servidor y `toHaveLength(1 + 1)`, o sea el número exacto que la tabla en carga
también da. **`PagosRegistradosTabla:442`** esperaba a que hubiera **cero** avisos de «no hay
datos», que es cierto también **antes** de que la descarga empiece: esa espera no esperaba
nada. Ahora ancla a la señal positiva de que terminó (el control deshabilita el botón mientras
genera y lo devuelve al pulsable al resolver) y sigue exigiendo el aviso ausente.

### Mutación — ROJA, y el archivo mutado VERDE

Reintroducido en `ControlDescargaTransversal.test.tsx` el ancla histórica exacta:

```js
await waitFor(() => expect(within(tabla).getAllByRole("row")).toHaveLength(2));
```

```
FAIL tests/unit/guards/ancla-de-carga.guardia.test.ts > un ancla que el estado transitorio
     tambien cumple no es un ancla > ninguna espera se ancla SOLO a un conteo de elementos del DOM
+ [
+   "tests/components/descarga/ControlDescargaTransversal.test.tsx:243 — () => expect(within(tabla).getAllByRole(\"row\")).toHaveLength(2)",
+ ]
```

Y **el archivo mutado corre en verde**:

```
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

Ésa es exactamente la razón de ser del censo: el defecto es invisible para la ejecución (por
eso era un flake) y visible para el texto. Revertida.

### Contraprueba — VERDE

Un conteo que **sí dice qué espera**, puesto en un archivo real
(`SateliteDescarga.test.tsx`):

```js
await waitFor(() => {
  expect(within(tabla).getAllByRole("row")).toHaveLength(1 + 1);
  expect(within(tabla).getByText("REM-002")).toBeInTheDocument();
});
```

Guardia **verde** (7 passed) y el archivo **verde** (4 passed): no es texto que engañe al
censo, es un ancla legítima. Revertida.

## 3.bis. La única de las nueve que falló en el gate, y por qué

El leader integró la rama y `./init.sh` dio **931 de 932 archivos verdes**. El único rojo fue
**mío**: `PagosRegistradosTabla.test.tsx`, la novena ancla.

```
FAIL tests/components/PagosRegistradosTabla.test.tsx
  > descarga SIN releer del servidor: proyecta el mismo array que pinta
Error: expect(element).toBeEnabled()
Received element is not enabled:
  <button aria-busy="true" ... data-disabled="" disabled="" ... />
```

**2 de 2 corridas de la suite completa, verde siempre en aislado.** No es flake: es
determinista bajo contención, y el diagnóstico del leader era correcto. `toBeEnabled()` espera
a que **termine la generación real del XLSX**, y `waitFor` tiene un presupuesto propio de
**1000 ms** (el suyo, no el `testTimeout` de 20 s del repo). El cambio de ancla no rompió el
test: lo hizo medir, y al medir destapó que ese trabajo no cabe en ese presupuesto.

### Por qué SOLO ésta de las nueve — la causa es de archivo, no de ancla

| Archivo | ¿aísla `buildXlsxRows` (exceljs) y `descargarBlob`? | Sujeto de mi ancla |
| --- | --- | --- |
| `SateliteDescarga` | **sí** (`:27`, `:30`) | carga de la tabla |
| `WalletDescarga` | **sí** (`:81`, `:84`) | carga de la tabla |
| `WalletPropsDescarga` | **sí** (`:59`, `:62`) | carga de la tabla (contenido) |
| `ColasPaginacion` | **sí** (`:121`, `:124`) | carga de la tabla |
| `SatelitePaginacion` | **sí** (`:76`, `:79`) | carga de la tabla |
| `PagosRegistradosTabla` | **NO** | **generación real del archivo** |

`PagosRegistradosTabla` era el único de los seis que ejecutaba exceljs de verdad. Y las otras
ocho anclas no esperan trabajo nuevo: el `queryByRole("status")` que añadí se resuelve con la
**misma** carga mockeada de la que ya dependía el conteo de filas que estaba allí antes — no
introduje ningún sujeto de CPU. **No hay más bombas de relojería**; había una, y era ésta.

Coste medido del codificador real, en aislado y con la máquina libre: la fase `tests` del
archivo pasa de **2,87 s a 2,42 s** al aislarlo (Δ ≈ **450 ms** en un solo caso). Un trabajo de
~450 ms contra un presupuesto de 1000 ms deja un margen de 2×, que la contención se come
entera. De ahí que falle **siempre** en la suite y **nunca** en aislado.

### Qué elegí, y por qué no las otras dos

**Opción 3 + 1: aislar el codificador binario y anclar a la entrega del blob.**

```js
await waitFor(() => expect(descargarBlobMock).toHaveBeenCalledTimes(1));
```

- **No es la opción 2 (timeout propio).** Con el codificador aislado no hay trabajo real que
  esperar, así que subir el presupuesto sería pagar por algo que no hace falta que ocurra. El
  caso mide *qué array se proyecta*, no cuánto tarda exceljs en comprimirlo.
- **Es lo que el repo ya hace en los otros cinco archivos de descarga**, con esas palabras:
  «se aísla SOLO el codificador binario (exceljs); `construirDescarga` corre REAL». La
  proyección —lo único que este caso juzga— sigue siendo la de producción.
- **Se ancla al ÚLTIMO paso, no al primero.** `descargarBlob` corre después de
  `buildXlsxRows`, así que cuando el ancla se cumple la proyección ya está hecha y leerla a
  continuación no es una carrera. Anclar a `buildXlsxRows` y afirmar la entrega acto seguido
  habría sido el **segundo** mecanismo del flake con otro disfraz, dentro del chore que existe
  para quitarlo.
- **De paso, el caso pasa a comprobar lo que su título promete**: «el mismo array que pinta»
  no se verificaba —solo se miraba que no hubiera `fetch`—. Ahora se afirma que las filas
  proyectadas son los DOS comprobantes, en el orden de pantalla y con el monto STRING intacto.

### Medición bajo carga, que es la única que vale aquí

Medido con `pnpm exec vitest run tests/components tests/unit` (**757 archivos, 9630 tests**) en
este worktree:

| Corrida | Versión | Resultado |
| --- | --- | --- |
| control | la que falló el gate (`toBeEnabled`, sin aislar) | **1 failed** / 756 passed — mismo test, misma aserción, `221,95 s` |
| 1 | arreglada | **757 passed · 9630 tests** — `217,50 s` |
| 2 | arreglada | **757 passed · 9630 tests** — `231,11 s` |

La corrida de control importa tanto como las verdes: **reproduje el fallo del gate en mi
máquina** antes de dar el arreglo por bueno. Dos pasadas verdes y no una, por la lección del
chore anterior: una suite verde de una sola pasada no cierra un flake.

`pnpm exec vitest run guard` tras el cambio: **60 archivos / 823 tests verdes**. El nuevo ancla
es de mock, que el censo del ancla declara explícitamente fuera de su alcance (su sujeto es la
llamada, no la pantalla), así que no lo marca ni debe.

### El parser, antes que nada

El extractor equilibra paréntesis en vez de casarlos con un regex (un `\(([^)]*)\)` se corta en
el primer `)` del cuerpo), y hay un caso que lo comprueba: extrae dos esperas de un fuente
sintético, con sus líneas, y clasifica **lo extraído**. Además, cualquier `waitFor` cuyo
paréntesis no cierre se reporta como cuerpo vacío y **una aserción de cobertura lo hace fallar**
en vez de tragárselo. Es el precedente de la 172.

### Lo que este censo NO cubre, declarado

- **Las 273 esperas ancladas a un mock.** Que la consulta salga no es que la pantalla llegue
  —misma familia—, pero ahí el arreglo no es mecánico (hay esperas cuyo sujeto legítimo *es* la
  llamada) y meterlas convertiría el guardia en ruido. Deuda medida, no tapada.
- **`await screen.findAllBy*(...)` con conteo**, la misma ambigüedad escrita de otra forma. No
  aparece hoy en el árbol; si aparece, este censo no la verá.
- **No previene la carrera**, prueba que ninguna espera está anclada solo a un número. Contra la
  carrera ya materializada siguen las guardias en ejecución de `ControlDescargaTransversal`
  (`esperarTablaAsentada`, `fotoDeLaPantalla`).
- **La resolución de helpers es de un nivel y del mismo fichero.** Es lo que añadió 2 de los 9
  sitios (`remisionesVisibles()`), y es justo donde moría el detector anterior; un helper
  importado de otro archivo no se resuelve.

---

## Verificación

Todo desde `R:\...\.claude\worktrees\agent-a4d288a030151dde4` (worktree propio, con
`pnpm install` y `prisma generate` propios).

```
$ pnpm exec vitest run tests/components tests/unit      # x2, tras el arreglo de §3.bis
 Test Files  757 passed (757)
      Tests  9630 passed (9630)
   Duration  217.50s / 231.11s

$ pnpm exec vitest run guard
 Test Files  60 passed (60)
      Tests  823 passed (823)
   Duration  10.03s

$ pnpm exec vitest run <los 8 archivos tocados o mutados>
 Test Files  8 passed (8)
      Tests  73 passed (73)
   Duration  18.51s

$ pnpm exec tsc --noEmit
(sin salida; exit 0)

$ pnpm exec eslint <los 9 archivos tocados>
(sin salida; 0 errores, 0 warnings)
```

**`./init.sh` no se corrió aquí**: el encargo lo asigna explícitamente al leader.

`git status` limpio: ninguna mutación quedó en el árbol (`app/`, `lib/` y `progress/` sin
modificar; los tres commits tocan solo `tests/**`).

## Commits

| | |
| --- | --- |
| `969dfedf` | el tablero financiero no puede decidir por el id de una métrica |
| `9aa1645e` | quitar la cita de una decisión también pone roja la guardia de R14 |
| `7f397888` | un ancla que el estado transitorio también cumple no es un ancla |

## Qué llevarse de aquí

1. **Cuando un detector mide sensibilidad cero, la pregunta no es cómo afinarlo sino si está
   mirando el sitio.** El del mecanismo (3) miraba la foto; el defecto vivía en el ancla, a una
   indirección de distancia y con forma sintáctica.
2. **Un guardia verde ante su propia mutación y un archivo verde con el defecto puesto son el
   mismo hallazgo visto por los dos lados.** Aquí el archivo mutado pasó 7/7 mientras el censo
   lo señalaba: es la definición de flake.
3. **Mutar en modo texto en Windows cambia los finales de línea**, y un parser de censo que no
   comprueba su propio corte pasa a juzgar el archivo entero sin decirlo. Mutador binario, y
   sanidad del parseo dentro del guardia.
4. **La frontera de un censo se escribe con vocabularios disjuntos, no con listas.** El tablero
   puede decidir por el id de *vista* y no por el de *métrica*: exigir el literal completo entre
   comillas separa los dos sin una sola excepción escrita a mano.
5. **`waitFor` tiene su propio presupuesto de 1000 ms, y no es el `testTimeout`.** Un ancla
   correcta puede seguir siendo mala si su señal incluye trabajo de CPU: ~450 ms de exceljs
   contra 1000 ms es margen 2×, y la contención se lo come **siempre**. Al arreglar un ancla
   falsa, mirar no solo si la nueva señal es inequívoca sino **cuánto cuesta producirla**.
6. **Verde en aislado no dice nada de un fallo que solo aparece bajo carga.** El control —correr
   la versión rota bajo la misma carga y verla caer— vale tanto como las dos corridas verdes:
   sin él no se sabe si el arreglo arregló o si la máquina tuvo un buen día.
