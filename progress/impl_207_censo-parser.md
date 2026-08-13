# Feature 207 — el censo de tablas contaba prosa como si fuera JSX

Rama `chore/deuda-202-207`. Alcance tocado: SOLO `tests/unit/descarga/`. Ni `app/` ni
`components/` se modifican (había otro agente trabajando en `components/shared/PageHeader.tsx`
en paralelo; su cambio estaba en el árbol durante las medidas finales y no afecta al censo).

## El defecto

`etiquetasDataTable` escaneaba el fuente CRUDO con `/<DataTable[\s<>]/g`. Una mención de la
etiqueta en un `//`, en un `/* */` o en un `{/* */}` contaba como una tabla DEL ARCHIVO.
Mordió dos veces: feature 200 tanda 2 (un archivo declaró DOS tablas por un comentario) y
feature 205 (`RepartoPrevisualizacion.tsx`, que no monta ninguna tabla ni importa el
componente, fue denunciado por su cabecera; se llegó a encargar registrar esa tabla fantasma
en el censo y el subagente se negó).

## Archivos

| Archivo | Qué |
| --- | --- |
| `tests/unit/descarga/etiquetas-datatable.ts` | **NUEVO.** El lector, extraído de la guardia y arreglado. |
| `tests/unit/descarga/etiquetas-datatable.test.ts` | **NUEVO.** Su primer test. 11 casos. |
| `tests/unit/descarga/cobertura-tablas.guardia.test.ts` | **MODIFICADO.** Importa el lector en vez de definirlo. |

### Por qué se extrae a un módulo

El encargo pide un test propio para `etiquetasDataTable`. La función vivía dentro de un
`.test.ts`, y un test que la importara de ahí haría que vitest re-registrara los `describe` de
la guardia y ésta corriera dos veces por tanda. El módulo va en la misma carpeta y con el
mismo patrón que `censo-tablas.ts`, que ya vive ahí sin ser un test.

### Cómo se quitan los comentarios

Se **reusa `quitarComentarios` de `tests/fixtures/money-safe.ts`** — no se escribe un tercer
parser. Es el quitador compartido del repo (ya lo usan 6 archivos de test) y cubre las tres
formas que pide el encargo:

- **línea** `//` — con la salvaguarda de no confundirse con el `//` de una URL (`[^:]`);
- **bloque** `/* … */` — que es también la forma de los docstrings;
- **JSX** `{/* … */}` — es un comentario de bloque envuelto en llaves, así que cae con el
  mismo barrido y deja atrás un par de llaves vacío y equilibrado que no engaña al conteo de
  profundidad del parser.

Una sola línea al entrar: `const fuente = quitarComentarios(fuenteBruta);`. El resto del
parser (genéricos, llaves anidadas, cadenas) queda intacto.

**Efecto colateral bueno:** el arreglo cierra además dos falsos NEGATIVOS del mismo origen,
porque el parser leía el interior de un comentario metido ENTRE los atributos de una etiqueta
real — un `descarga=` comentado contaba como descarga declarada, y un apóstrofo o un `>` en
una frase en español abrían una cadena o cerraban la etiqueta antes de tiempo. Los dos están
fijados con test.

## Mutaciones

Aplicadas una a una sobre `etiquetas-datatable.ts`, restaurando el módulo al terminar.
`nuevo` = `etiquetas-datatable.test.ts`; `censo` = `cobertura-tablas.guardia.test.ts`.

| # | Mutación | `nuevo` | `censo` |
| --- | --- | --- | --- |
| m1 | quitador desactivado (`const fuente = fuenteBruta`) | **ROJO** 6/11 | VERDE |
| m2 | bloque ávido (`[\s\S]*` en vez de `[\s\S]*?`) | **ROJO** 1/11 | ROJO |
| m3a | el quitador se come el JSX real (`.replace(/<DataTable[\s\S]*?\/>/g, " ")`) | **ROJO** 7/11 | ROJO |
| m3b | se lo come todo (`const fuente = ""`) | **ROJO** 7/11 | ROJO |
| m4 | sin salto de genéricos (`if (false)`) | **ROJO** 1/11 | VERDE |
| — | sin mutar | VERDE 11/11 | VERDE 4/4 |

Las cinco mueren. Lo que hay que leer de la tabla es la **columna del censo**:

- **m1 deja el censo VERDE.** Es la demostración de que sin este test el arreglo era
  invisible: revertirlo mañana no pone nada en rojo, porque el censo solo se mueve cuando se
  mueve el árbol. Era exactamente el agujero por el que entró el defecto.
- **m4 también deja el censo VERDE**: las tres instancias con genérico del árbol
  (`OrdenesCargaResumen`, `OrdenesConErrorTabla`, `OrdenesExistentesTabla`) están censadas
  `fuera`, así que ninguna ejercita hoy la lectura del `descarga=` tras el genérico. Esa rama
  del parser la sostiene únicamente el test nuevo.

Una sexta mutación se descartó por **equivalente**: prefijar `// ` a los `<DataTable` DESPUÉS
de quitar comentarios no quita nada (no hay segunda pasada) y la regex sigue casando. Sobrevivió
por no ser un cambio de comportamiento, no por un hueco del test; se sustituyó por m3a.

## Los totales del censo NO se movieron

Medido contra el árbol con el parser viejo y con el nuevo, archivo por archivo:

```
CRUDO : archivos=31 instancias=32
LIMPIO: archivos=31 instancias=32
DIFERENCIAS (0)      <- ni en el conteo ni en el `descarga=` de cada una de las 32
```

La comparación incluye el flag `declaraDescarga` de cada instancia, no solo el total: contar
bien y leer mal el estado da el mismo número. Los seis totales que afirma la guardia (31
archivos / 32 instancias / 33 censadas / 27 `con_descarga` / 6 `fuera` / 5 exclusiones con
`<DataTable>`) siguen intactos.

## Barrido del árbol: ¿hay otros archivos inflando el censo hoy?

**No.** 21 archivos de `app/` y `components/` mencionan `DataTable` en prosa, pero **ninguno
con los ángulos**, así que ninguno suma una tabla fantasma. El censo de hoy no documenta
ninguna tabla inexistente. (Se listan en el barrido: `DescargarDatasetButton`, `Pagination`,
`PrioridadResalte`, `EmptyState`, `UsuariosModule`, `OrdenesModule`, … y el propio
`RepartoPrevisualizacion`.)

Dos hallazgos ADYACENTES **(cerrados en la tanda 2, ver abajo)**:

1. **`montajesEnElArbol`** (misma guardia, ~línea 172) tiene el MISMO defecto: escanea fuente
   crudo para decidir qué pantallas montan una tabla compartida. Hoy no daña —las dos tablas
   compartidas del censo (`PagosRegistradosTabla`, `TablaResumen`) dan lo mismo con y sin
   comentarios—, pero el árbol ya contiene prosa que esa función contaría: aplicando su misma
   lógica a `components/ui/input.tsx` aparece `RankingHistoricoModule.tsx` como consumidor por
   dos comentarios que citan `<input type="date">` (líneas 53 y 124), sin que el archivo monte
   ningún `<input>` en minúscula. Su docstring ya reconoce el problema y lo mitiga exigiendo
   import **y** JSX a la vez; quitar comentarios sería el arreglo de verdad.
2. **`aserciones`** en `columnas-asercion-de-orden.guardia.test.ts` (~línea 137) declara en su
   docstring que sigue «el mismo enfoque que `etiquetasDataTable`» — y también escanea crudo,
   así que un `expect(...)` comentado cuenta como aserción.

## La mitigación de la 205 se deja donde está

`app/(app)/wallet/mensajeros/_components/RepartoPrevisualizacion.tsx` sigue nombrando las
etiquetas SIN los ángulos, con su nota de las líneas 46-49. No se revierte: no es de este
encargo y esa nota documenta el historial. Su caso queda además fijado como test —la frase
original, con los ángulos devueltos, tiene que dar cero tablas—, pero sobre un fixture
sintético, no leyendo el archivo: un test que leyera el árbol se pondría verde o rojo según lo
que escriba mañana otra feature, y lo que hay que fijar es el parser.

## Verificación (salida real)

```
$ pnpm exec vitest run tests/unit/descarga
 Test Files  27 passed (27)
      Tests  151 passed (151)

$ pnpm exec vitest run tests/unit/guards
 Test Files  26 passed (26)
      Tests  290 passed (290)

$ pnpm exec tsc --noEmit
(sin salida, exit 0)

$ pnpm exec eslint tests/unit/descarga/etiquetas-datatable.ts \
    tests/unit/descarga/etiquetas-datatable.test.ts \
    tests/unit/descarga/cobertura-tablas.guardia.test.ts
(sin salida, exit 0)
```

`./init.sh` NO se corrió: el árbol tenía cambios en vuelo de otro agente
(`components/shared/PageHeader.tsx`) y un gate leído sobre un árbol que se mueve no vale como
veredicto. Queda para el leader, secuenciado.

## Veredicto (tanda 1)

El censo ya no cuenta prosa: `etiquetasDataTable` quita comentarios de línea, de bloque y de
JSX reusando `quitarComentarios`, con 11 tests que fijan las dos caras, 5 mutaciones muertas
—dos de ellas invisibles para el censo, que es justo por lo que hacía falta el test— y los
totales del registro sin moverse.

---

# TANDA 2 — los otros dos sitios

Los dos hallazgos que la tanda 1 reportó sin tocar. Mismo arreglo, mismo criterio de prueba.

## Archivos

| Archivo | Qué |
| --- | --- |
| `tests/unit/descarga/montajes-componente.ts` | **NUEVO.** El predicado `montaComponente`, extraído de la guardia y arreglado. |
| `tests/unit/descarga/montajes-componente.test.ts` | **NUEVO.** Su primer test. 10 casos. |
| `tests/unit/descarga/aserciones-de-orden.ts` | **NUEVO.** `aserciones` + `tieneAsercionDeOrden` + `MATCHERS_DE_ORDEN`, extraídos y arreglados. |
| `tests/unit/descarga/aserciones-de-orden.test.ts` | **NUEVO.** Su primer test. 12 casos. |
| `tests/unit/descarga/cobertura-tablas.guardia.test.ts` | **MODIFICADO.** `montajesEnElArbol` se queda solo con el recorrido del árbol. |
| `tests/unit/descarga/columnas-asercion-de-orden.guardia.test.ts` | **MODIFICADO.** Importa el lector en vez de definirlo. |

### 1. `montajesEnElArbol` → `montaComponente`

Se extrae **el predicado**, no el recorrido: `montaComponente(fuente, rutaComponente)` decide si
un archivo monta el componente; `montajesEnElArbol` se queda en la guardia porque es ella quien
sabe qué árboles se miran (`ARBOLES_UI`). Una línea al entrar: `quitarComentarios`.

Lo que había que entender aquí es que la mitigación existente —exigir import **y** JSX— no
cerraba nada: basta con que el archivo importe de verdad y nombre la etiqueta en un comentario.
Es el caso vivo que ya se midió: `RankingHistoricoModule.tsx` importa `@/components/ui/input`
(línea 34) y cita `<input type="date">` en dos comentarios (53 y 124), sin montar un solo
`<input>`. Y un falso positivo aquí no es un rojo cualquiera: la guardia obliga a **declarar en
el censo** el montaje que denuncia, o sea a escribir en el registro algo que el código no hace.

### 2. `aserciones` → `aserciones-de-orden.ts`

El peor de los dos, y por eso el que más importa: **una guardia que cuenta aserciones podía
quedar satisfecha por código que no se ejecuta**. Comentar la aserción de orden de una lista de
columnas —el gesto de dejarla «para luego»— dejaba la guardia verde y el orden del archivo que
descarga el usuario sin vigilancia.

No es una forma rara de escribir: hoy hay **41 menciones de `expect(` dentro de comentarios en
`tests/`, repartidas en 17 archivos** (18 en `superficie-de-uso.guardia`, 6 en la propia guardia
de columnas, y una o dos en otros 15). Ninguna es una aserción de orden de una
`COLUMNAS_DESCARGA_*` — por eso la cobertura no se movió al arreglarlo—, pero la puerta estaba
abierta y con tráfico.

Se extraen `aserciones`, `tieneAsercionDeOrden` y `MATCHERS_DE_ORDEN` (los tres son el
contrato). El negativo (c) de la autocomprobación de la guardia se deja donde está, con una nota:
la parte «mención en un comentario» la sostiene ahora el test del módulo.

**Efecto colateral bueno, otra vez simétrico:** el arreglo cierra un falso NEGATIVO en cada uno.
Un comentario ENTRE `expect(...)` y su matcher rompía la lectura y la aserción viva no contaba;
un import comentado ya no cuela como import. Los dos están fijados con test.

## Los totales NO se movieron

Medido con el detector viejo y el nuevo sobre el árbol, archivo por archivo, ANTES de aceptar
el arreglo:

```
montajesEnElArbol — las dos rutas que la guardia consulta de verdad:
  components/private/analytics/TablaResumen.tsx          CRUDO 2  ==  LIMPIO 2
  components/shared/liquidacion/PagosRegistradosTabla.tsx CRUDO 2  ==  LIMPIO 2
  rutas censadas que se mueven: 0

  (barrido de control: aplicando el MISMO cálculo a los ~600 .tsx del árbol, el único
   componente con montaje fantasma por prosa es components/ui/input.tsx, con
   RankingHistoricoModule.tsx colgando de dos comentarios. Ninguno está censado.)

aserciones / cobertura de COLUMNAS_DESCARGA_*:
  constantes censadas: 38   (el suelo de la guardia sigue siendo 35)
  constantes que cambian de archivos de cobertura: 0
  desnudas CRUDO: 0   desnudas LIMPIO: 0
  expect() vistos en tests/: CRUDO 31264  ->  LIMPIO 31223   (41 vivían en comentarios)
```

Las dos guardias afirman hoy exactamente lo mismo que ayer: 31 archivos / 32 instancias / 33
censadas / 27 `con_descarga` / 6 `fuera` / 5 exclusiones, y 38 constantes ≥ 35 con 0 desnudas.
Ningún número se ajustó para que cuadrara: se midió primero y no hizo falta tocar ninguno.

## Mutaciones

Aplicadas una a una, restaurando el archivo al terminar (el script aborta si el reemplazo no
cambia el fuente: una mutación que no muta reporta «sobrevive» y miente). `nuevo` = el test del
módulo; `guardia` = la guardia que lo consume.

**`montajes-componente.ts`** (guardia = `cobertura-tablas.guardia`):

| # | Mutación | `nuevo` | `guardia` |
| --- | --- | --- | --- |
| m1 | quitador desactivado (`const fuente = fuenteBruta`) | **ROJO** 5/10 | VERDE |
| m2 | se lo come todo (`const fuente = ""`) | **ROJO** 3/10 | ROJO 1/4 |
| m3 | se cae la exigencia de IMPORT (solo JSX) | **ROJO** 2/10 | VERDE |
| m4 | se cae la exigencia de JSX (solo import) | **ROJO** 5/10 | VERDE |

**`aserciones-de-orden.ts`** (guardia = `columnas-asercion-de-orden.guardia`):

| # | Mutación | `nuevo` | `guardia` |
| --- | --- | --- | --- |
| a1 | quitador desactivado (`const fuente = fuenteBruta`) | **ROJO** 6/12 | VERDE |
| a2 | se lo come todo (`const fuente = ""`) | **ROJO** 8/12 | ROJO |
| a3 | sin equilibrar paréntesis (`profundidad++` desactivado) | **ROJO** 6/12 | ROJO |
| a4 | sin respetar cadenas (nunca entra en comilla) | **ROJO** 1/12 | VERDE |
| a5 | cola del matcher recortada (120 → 2) | **ROJO** 7/12 | ROJO |

**Sobre el quitador COMPARTIDO** (`quitarComentarios` en `tests/fixtures/money-safe.ts`), que es
lo que de verdad sostiene los tres arreglos:

| # | Mutación | `montajes` | `aserciones` | `g. tablas` | `g. columnas` |
| --- | --- | --- | --- | --- | --- |
| s1 | deja de quitar comentarios de LÍNEA | **ROJO** 3/10 | **ROJO** 4/12 | VERDE | VERDE |
| s2 | deja de quitar los de BLOQUE (y JSX) | **ROJO** 3/10 | **ROJO** 3/12 | VERDE | VERDE |
| s3 | bloque ÁVIDO (`[\s\S]*`) | **ROJO** 1/10 | **ROJO** 1/12 | ROJO 2/4 | VERDE |

Las 12 mueren. Lo que hay que leer es la columna de la guardia: **7 de las 12 son INVISIBLES
para la guardia que las consume** (m1, m3, m4, a1, a4, s1, s2). Es decir: revertir cualquiera de
esos siete arreglos mañana no pondría nada en rojo si no fuera por los dos tests nuevos —las
guardias solo se mueven cuando se mueve el árbol, y el árbol de hoy no ejercita esas ramas. Ése
es exactamente el agujero por el que entró el defecto original.

Un survivor de verdad, y cómo se mató. **a4 sobrevivía** en la primera pasada: el fixture de
cadenas era `expect(etiqueta("Totales (USD)"))`, con los paréntesis de la cadena EQUILIBRADOS,
así que el conteo cuadraba igual sin respetar comillas. Se cambió por un `)` suelto
(`expect(rotulo("cerrado )"))`), que es el caso para el que existe esa rama, y la mutación pasó a
morir 1/12. Queda anotado en el propio test para que nadie lo «simplifique» de vuelta.

## Barrido final: ¿queda algún otro sitio que escanee fuente crudo?

Medido, no opinado. Se extrajeron los patrones que cada test de `tests/` aplica **al contenido
de un archivo** (`/re/.test(fuente)`, `fuente.includes("…")`, `fuente.match(/re/)`,
`expect(fuente).toMatch(/re/)`) y se comparó su veredicto crudo vs sin comentarios sobre los
archivos que ese test lee de verdad.

**39 tests** tienen al menos un patrón sensible a la prosa sobre lo que leen. **33 de ellos ya
quitan comentarios.** Quedan 6 crudos, y de esos:

1. **`tests/unit/guards/busqueda-texto-solo-lectura.test.ts` — VIVO, y es el tercer caso real.**
   Censa línea a línea, sobre fuente crudo, qué archivos nombran `busquedaTexto` /
   `busqueda_texto`, y exige que solo sean los de una lista blanca. `lib/db/prisma-client.ts`
   está en esa lista blanca **y solo la nombra en un docstring** (línea 33). O sea: hay una
   entrada de lista blanca que existe para callar a un comentario. En el otro sentido, cualquier
   archivo que mencione la columna de pasada pone la guardia en rojo sin tocar nada.
2. **La propia `cobertura-tablas.guardia`, líneas ~228-230.** El bloque de la `<table>` cruda
   (`expect(fuente).toMatch(/<table[\s>]/)` y `.not.toMatch(/DescargarDatasetButton/)`) sigue
   leyendo el archivo crudo. Hoy es honesto —`RankingModule.tsx` tiene un `<table` real en la
   línea 139 y no nombra el botón—, pero es el mismo escaneo, en la misma guardia.
3. **`tests/unit/repositories/tarifa-vigente-por-tienda-repository.test.ts` — NO es un defecto**,
   y conviene decirlo: escanea crudo A PROPÓSITO porque R30 exige que exista un marcador `TODO:`
   *en un comentario*, y hasta ancla la búsqueda a `^\s*(?://|\*)\s*TODO:` para que una mención
   suelta no lo dé por cumplido. Escanear prosa está bien cuando lo que se busca ES prosa.
4. Los otros tres (`definiciones-catalogo.guardia`, `contadores-cabecera.guardia`,
   `ordenes-config`) no leen el archivo donde el patrón difiere: es ruido de mi aproximación
   (para los que recorren árbol, el universo medido fue el árbol entero).

### Y la pregunta de fondo: ¿merece un helper compartido con nombre propio?

**No es el tercer sitio: es el septuagésimo quinto, y las copias no se ponen de acuerdo.** En
`tests/` hay **74 archivos con su propio quitador de comentarios escrito a mano** (73 de
TypeScript, 1 de SQL), además de `quitarComentarios`, que es el único compartido. Entre ellos,
**cinco semánticas distintas** para la misma pasada de comentario de línea (78 apariciones):

| Variante | Apariciones | Qué se le escapa |
| --- | --- | --- |
| `(^\|\s)\/\/.*$` | 50 | exige espacio o inicio de línea antes del `//` (`};// nota` sobrevive) |
| `^\s*\/\/.*$` | 10 | **solo comentarios de línea COMPLETA**: un `// nota` al final de una línea de código sobrevive entero |
| `\/\/.*$` | 10 | se come el `//` de cualquier URL y parte la cadena que la contenga |
| `(^\|[^:])\/\/.*$` | 6 | nada conocido (a salvo de `https://`); es la forma de `quitarComentarios` |
| `(^\|[^:])\/\/[^\n]*` | 2 | ídem, con `[^\n]` en vez de `.` — `quitarComentarios` y una copia |

Recomendación, para que la decida el humano y no yo: promover `quitarComentarios` a helper con
nombre propio y una prueba propia —hoy la única cobertura directa que tiene son dos líneas
sueltas dentro de `pagos-registrados-descarga-columnas.test.ts`— y migrar las copias por tandas.
Las 10 de `^\s*\/\/.*$` son las que hoy prometen más de lo que cumplen; las 10 de `\/\/.*$` son
las que pueden romper un fuente con URLs. Nada de esto se ha tocado en esta feature.

## Verificación (salida real, tanda 2)

```
$ pnpm exec vitest run tests/unit/descarga tests/unit/guards
 Test Files  55 passed (55)
      Tests  463 passed (463)

  (antes de la tanda 2: 27+26 = 53 archivos y 151+290 = 441 tests.
   +2 archivos y +22 tests, que son exactamente los dos nuevos: ninguna guardia
   se re-registró al extraer sus funciones, que era el riesgo de la mudanza.)

$ pnpm exec tsc --noEmit
(sin salida, exit 0)

$ pnpm exec eslint tests/unit/descarga/montajes-componente.ts \
    tests/unit/descarga/montajes-componente.test.ts \
    tests/unit/descarga/aserciones-de-orden.ts \
    tests/unit/descarga/aserciones-de-orden.test.ts \
    tests/unit/descarga/cobertura-tablas.guardia.test.ts \
    tests/unit/descarga/columnas-asercion-de-orden.guardia.test.ts
(sin salida, exit 0)
```

`./init.sh` NO se corrió, por lo mismo que en la tanda 1: hay otro agente trabajando en
`components/shared/PageHeader.tsx` y `app/`, y un gate leído sobre un árbol en movimiento no
vale como veredicto. Queda para el leader, secuenciado.

## Veredicto (tanda 2)

Los tres escáneres del par de guardias leen ya código y no prosa, cada uno en su módulo y con su
test de las dos caras: 22 tests nuevos, 12 mutaciones muertas —**7 de ellas invisibles para la
guardia que las consume**, que es la razón entera por la que estos tests tenían que existir— y
ni uno de los totales afirmados se movió. El barrido deja un tercer caso vivo y ajeno
(`busqueda-texto-solo-lectura`, con una lista blanca inflada por un docstring) y un dato que
cambia la pregunta: no hay tres sitios que copien este parser, hay setenta y cuatro, con cinco
comportamientos distintos.
