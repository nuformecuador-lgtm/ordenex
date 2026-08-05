# 184 — la parte BACKEND de la Tanda B (consolidación: listados 6 y 7)

> Rama: `feature/184-deuda-170-listados` · Fecha: 2026-08-04 · Rol: BACKEND_DEV
>
> Alcance entregado: **B.1**. `app/**` y `components/**` NO se tocan: B.2 (las dos pantallas) y
> B.3 (el censo) son del frontend y cierran la tanda.
>
> **Veredicto en una línea: los dos listados más caros del inventario tienen ya su lectura
> dedicada —de cuatro consultas + cinco agregados + el reparto del efectivo a DOS consultas y
> cero aritmética de dinero—, sin un solo método de repositorio nuevo y con 18 mutaciones
> ejecutadas, las 18 rojas.**

---

## 1. Lo primero que se midió: ¿hacía falta escribir repositorio?

El encargo pedía comprobarlo antes de asumirlo. La respuesta es **no**, y por partida doble:

| Listado | Método que el inventario decía que existe | ¿Sirve tal cual? |
| --- | --- | --- |
| 6 — Cierres de bodega solicitados | `CierreBodegaRepository.findCierresBodegaByZona(zonaId)` | **Sí.** Devuelve el conjunto entero de la zona, ordenado `solicitadoAt desc` y proyectado con `toBodegaResumenRow` — el MISMO mapper que `findCierresBodegaByZonaPaginado` |
| 7 — Cierres del día a consolidar | `CierreBodegaRepository.findCierresDiaConsolidables(zonaId)` | **Sí.** Ídem, con `consolidablesWhere` (los cuatro predicados) y `toConsolidableRow` |

Los dos son literalmente lo que la pantalla ya releía: `listarConsolidacion()` los llama y expone
sus resultados como `cierresBodegaPasados` y `consolidables`. La deuda no estaba en «falta una
consulta», estaba en **cómo se llegaba a ella**: por dentro del listado compuesto, arrastrando
las otras tres consultas y el dinero.

**Se reusaron, no se duplicaron.** Un `findCierresBodegaByZonaCompleto` habría sido un gemelo
con el mismo `where`, el mismo orden y el mismo `select`: la tercera declaración del mismo
criterio, que es justo lo que R16 prohíbe.

### Lo que sí se tocó del repositorio, y por qué

Al pasar estos dos conjuntos a sostener un archivo, su `where` y su `orderBy` dejan de ser un
detalle interno: **si divergen de los de la página, la fila 26 del archivo deja de ser la primera
de la página 2** y no hay ninguna pantalla que lo diga. Y estaban declarados DOS veces:

| Par | Antes | Ahora |
| --- | --- | --- |
| Consolidables | `consolidablesWhere` compartido ✔, `orderBy: { solicitadoAt: "desc" }` escrito **dos veces** | `ORDEN_CONSOLIDABLES`, una vez |
| Cierres de bodega | `where: { zonaId }` **dos veces**, `orderBy` **dos veces** | `cierresBodegaDeZonaWhere(zonaId)` + `ORDEN_CIERRES_BODEGA`, una vez cada uno |

Cero cambios de comportamiento: los 27 casos previos de los tres archivos de repositorio siguen
verdes sin tocarse, incluidos los que fijan el `where` y el orden en valores absolutos.

---

## 2. Qué se escribió

### Servicio — `CierreBodegaService`

`listarCierresBodegaSolicitadosCompleto(actor)` y `listarConsolidablesCompleto(actor)`: guard de
rol ANTES del repositorio → zona desde `findUsuarioZonaId` → el método del conjunto → tope
`descargaConfig.MAX_FILAS` evaluado aquí → las filas tal cual. Sin zona → `[]` sin consultar.

**Ninguno de los dos recibe `input`, y es una decisión, no un olvido.** Estos dos listados no
admiten filtros: su schema de página solo tenía `page`/`pageSize`, y quitarlos deja una lista
blanca de **cero claves**. El borde la sigue aplicando entera —parsear ES la barrera— pero no hay
nada que transportar hasta el servicio. El precedente del repo para el caso «sin filtros» es
`PlantillaMensajeService.listarCompleto`, que recibe el input y lo descarta con `void input`;
aquí se prefirió no declarar un parámetro muerto, y la barrera se mide igual (M13–M15, §3).

### Schemas — `lib/types/cierre-bodega.ts`

Derivados, no reescritos:

```ts
listarCierresBodegaSolicitadosCompletoSchema = listarCierresBodegaPaginadoSchema
  .omit({ page: true, pageSize: true }).strict();
listarConsolidablesCompletoSchema = listarConsolidablesSchema
  .omit({ page: true, pageSize: true }).strict();
```

Dos constantes y no una, aunque hoy su forma coincida: si mañana uno de los dos listados gana un
filtro, lo gana en su schema de página y lo hereda aquí sin arrastrar al otro. Y `.strict()` se
reescribe aunque `.omit()` lo herede, por el mismo motivo que en el schema de la página.

### Bordes — `lib/actions/cierre-bodega.ts`

`listarCierresBodegaSolicitadosCompleto` y `listarConsolidablesCompleto`, calcados de sus
hermanas paginadas: actor primero, zod después, servicio al final, todo bajo `withErrorHandler`.
`input: unknown = {}` para que la pantalla pueda llamarlas sin argumentos.

**Lo que el frontend encontrará listo (B.2):**
`listarCierresBodegaSolicitadosCompleto()` devuelve `ListarCompletoResult<CierreBodegaResumen>` y
`listarConsolidablesCompleto()` devuelve `ListarCompletoResult<CierreBodegaResumenLite>` — que es
exactamente lo que `filasDesdeResultado` sabe traducir y lo que `filaDescargaBodegaSolicitado` /
`filaDescargaConsolidable` ya saben proyectar. Los agregados de dinero de las dos pantallas
siguen llegando por `listarConsolidacion`, sin cambios (R49/R50 de la 170).

---

## 3. Las 18 mutaciones, con su salida

Cada una: se rompe el código de verdad, se corre, se restaura. Ninguna quedó aplicada (`git
status` limpio tras cada lote, verificado y pegado).

### Lote repositorio (5) — el criterio compartido

```
=== M1 (R16/R5) el conjunto de los cierres de bodega ordena al reves que su pagina
  × filtra por zona, orderBy solicitadoAt desc, totales STRING + cantidadCierres del _count
  × cierres de bodega solicitados: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  Tests  2 failed | 25 passed (27)
=== M2 (R16/R4) el conjunto de los cierres de bodega deja de acotar por zona
  × filtra por zona, orderBy solicitadoAt desc, totales STRING + cantidadCierres del _count
  × cierres de bodega solicitados: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  Tests  2 failed | 25 passed (27)
=== M3 (R15) el conjunto de los cierres de bodega recorta como si fuera una pagina
  × cierres de bodega solicitados: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × los dos conjuntos cuestan UNA consulta, sin recorte y sin conteo de página (R15)
  Tests  2 failed | 25 passed (27)
=== M4 (R16/R5) el conjunto de consolidables ordena al reves que su pagina
  × el conjunto CONSOLIDABLE se declara una sola vez: la pagina y el listado entero lo comparten
  Tests  1 failed | 26 passed (27)
=== M5 (R5) el orden COMPARTIDO de los cierres de bodega cambia para los dos a la vez
  × filtra por zona, orderBy solicitadoAt desc, totales STRING + cantidadCierres del _count
  × cierres de bodega — solicitados: acota por zona y NO filtra por estado
  × cierres de bodega solicitados: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  Tests  3 failed | 24 passed (27)
=== arbol restaurado
```

**M4 es la que responde a «¿y el listado 7 dónde se prueba?»:** su caso vive desde la 170 en
`colas-paginadas-where.test.ts` («el conjunto CONSOLIDABLE se declara una sola vez») y afirma
exactamente lo que R14/R15/R16 piden para el conjunto: mismo `where`, mismo `orderBy`, sin
`skip`/`take` y sin `count`. **No se duplicó**; se midió que sigue siendo el guardián correcto.

**M5 es la contraprueba de que compartir el orden no lo vuelve invisible:** cambiar la constante
compartida pone rojas a la vez las afirmaciones ABSOLUTAS de la página y las del conjunto. Una
declaración única no es una declaración sin vigilar.

### Lote servicio (7) — el coste que la tanda quita, y el tope

```
=== M6 (R10) el conjunto del listado 6 vuelve a pasar por el listado compuesto
  × el conjunto de la descarga no calcula agregados ni reparto de efectivo (R10)
  × el alcance sale del ACTOR, no de la entrada: cada bodega descarga la SUYA (R4)
  Tests  2 failed | 46 passed (48)
=== M7 (R10) el conjunto del listado 7 calcula los agregados y el reparto, y los tira
  × el conjunto de la descarga no calcula agregados ni reparto de efectivo (R10)
  Tests  1 failed | 47 passed (48)
=== M8 (R6) el tope del listado 6 se corre una fila: >= en vez de >
  × con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)
  Tests  1 failed | 47 passed (48)
=== M9 (R6) el tope del listado 7 trunca en vez de rechazar
  × con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)
  Tests  1 failed | 47 passed (48)
=== M10 (R4) el guard de rol del listado 7 se evalua DESPUES del repositorio
  × un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)
  Tests  1 failed | 47 passed (48)
=== M11 (R4) sin zona, el listado 6 consulta igual
  × el adminSatelite SIN zona recibe un conjunto vacío y no consulta el listado
  Tests  1 failed | 47 passed (48)
=== M12 (R5/R10) el conjunto del listado 6 se sirve del metodo PAGINADO
  × el conjunto de la descarga no calcula agregados ni reparto de efectivo (R10)
  × el alcance sale del ACTOR, no de la entrada: cada bodega descarga la SUYA (R4)
  × el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)
  × las filas del archivo son las MISMAS que las de la página: un solo mapper de dinero
  × con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)
  Tests  5 failed | 43 passed (48)
=== arbol restaurado
```

**M7 es LA mutación de esta tanda, y merece leerse dos veces.** El código mutado calcula
`sumTotales`, `repartirEfectivo` y `sumIngresoBodega` sobre el conjunto **y tira el resultado**.
Produce exactamente el mismo archivo, exactamente las mismas llamadas al repositorio y
exactamente el mismo objeto de vuelta. Es indistinguible por cualquier vía razonable… salvo por
el espía de este archivo: cada fila del almacén tiene sus campos de dinero convertidos en
propiedades vigiladas (`Object.defineProperty` + getter que anota la lectura), y la mutación las
lee. **Un solo caso la caza**, y es el que R10 pide.

La anti-vacuidad de ese espía está medida en el mismo caso: la relectura que esta tanda sustituye
(`listarConsolidacion`) lee el pago de cada mensajero **dos veces** —una para sumarlo y otra para
repartirlo— y el test lo afirma con el número exacto (10 lecturas para 5 consolidables). Sin esa
mitad, los `toEqual([])` del espía serían un adorno.

### Lote borde (5) — la lista blanca derivada

```
=== M13 (R17) el borde del listado 6 usa el schema de la PAGINA en vez del derivado
  × una clave no declarada muere con validation_error sin tocar el service (R17)
  Tests  1 failed | 20 passed (21)
=== M14 (R17) el borde del listado 7 no parsea la entrada
  × una clave no declarada muere con validation_error sin tocar el service (R17)
  Tests  1 failed | 20 passed (21)
=== M15 (R17) el schema derivado deja de ser estricto (.strict -> .passthrough)
  × una clave no declarada muere con validation_error sin tocar el service (R17)
  Tests  1 failed | 20 passed (21)
=== M16 (R7) el borde del listado 6 valida ANTES de resolver el actor
  × el actor se resuelve ANTES de validar: sin sesión no se filtra la lista blanca
  Tests  1 failed | 20 passed (21)
=== M18 (borde) los dos bordes dejan de admitir la llamada SIN entrada
  × sin entrada, o con un objeto vacío, delega en el service con SOLO el actor
  Tests  1 failed | 5 passed (6)
=== arbol restaurado
```

**M13 es la que justifica que el schema se DERIVE.** Con la lista blanca copiada a mano del
listado paginado, `page: 2` y `pageSize: 100` pasarían: son claves que la página acepta y el
conjunto no debe. El caso las prueba explícitamente, junto a `zonaId` —la única cuya aceptación
abriría el dinero de la bodega vecina—.

### M17 — la que en la tanda A solo cazaba un Postgres real

```
=== M17 el criterio del conjunto gana una condicion sobre una columna QUE NO EXISTE
--- vitest:
 Test Files  2 passed (2)
      Tests  21 passed (21)
--- typecheck:
lib/repositories/CierreBodegaRepository.ts(131,20): error TS2353: Object literal may only
  specify known properties, and 'zonaIdentificador' does not exist in type 'CierreBodegaWhereInput'.
typecheck exit: 2
```

Igual que en la tanda A, **la suite entera se queda verde**: los dobles no ven la consulta. Lo que
cambia es quién la caza. Allí eran consultas `$queryRaw` —texto libre— y hizo falta un archivo de
integración contra Postgres de verdad. Aquí las dos consultas van por el constructor tipado de
Prisma (`Prisma.CierreBodegaWhereInput`, `Prisma.CierreDiaOrderByWithRelationInput`,
`select` con `GetPayload`), así que **la columna inexistente no compila**.

**Por eso esta tanda NO añade un archivo `tests/integration/db/`**, y la decisión está medida, no
supuesta: el hueco que aquel archivo tapaba lo ocupa aquí `tsc`, y no se encontró ninguna
propiedad de estas dos consultas que Postgres pudiera desmentir y el typecheck no. Lo que un
Postgres real sí seguiría cazando —drift entre `schema.prisma` y la base— no lo introduce esta
tanda: las dos consultas son las mismas que ya corren en producción.

---

## 4. Archivos

**Nuevos (2)**

- `tests/unit/services/consolidacion-completo.test.ts` — 7 casos (incluye el espía de dinero).
- `tests/unit/actions/cierre-bodega-descarga-action.test.ts` — 6 casos, los dos bordes en cada uno.

**Modificados — producción (5)**

- `lib/repositories/CierreBodegaRepository.ts` — el orden y el `where` por zona, cada uno
  declarado una vez. Sin métodos nuevos.
- `lib/services/CierreBodegaService.ts` — los dos métodos del conjunto.
- `lib/interfaces/services/ICierreBodegaService.ts` — sus dos contratos y sus dos result types.
- `lib/types/cierre-bodega.ts` — los dos schemas derivados y los dos `…CompletoResult`.
- `lib/actions/cierre-bodega.ts` — los dos bordes.

**Modificados — tests (1)**

- `tests/unit/repositories/historicos-paginados-where.test.ts` — +2 casos (9 → 11).

**Cero** cambios en `app/**`, `components/**`, `db/migrations/`, RLS, esquema, `feature_list.json`
y la configuración de `useSWR` de ninguna pantalla (R33).

**Peaje de los `vi.mock` ajenos: CERO en esta tanda.** El aviso heredado de la tanda A (los tests
que mockean el módulo de acciones revientan al importarlo si no declaran los exports nuevos) no
se cobró aquí porque **ninguna pantalla importa todavía las acciones nuevas**: eso es B.2. Se
comprobó ejecutando los cinco archivos que mockean o renderizan este dominio
(`CierresDescarga`, `ColasPaginacion`, `BajoRiesgoPaginacion`, `CierresAdminPage`,
`paginacion-transversal`): 36 casos, todos verdes sin tocarlos. **Quien haga B.2 sí lo pagará**, y
conviene que lo enumere antes con `pnpm exec vitest related --run` sobre las dos pantallas.

---

## 5. Mapa `R<n>` → archivo + nombre del caso

Construido **leyendo el caso**, no contando `R\d+` en títulos: varios casos cubren un requisito
sin nombrarlo y varios títulos de los archivos vecinos citan requisitos de la **feature 170**
(`R41`, `R44`, `R49`, `R51`, `R54`), cuyo espacio de nombres se cruza con el de esta.

| R | Archivo | Caso | Estado |
| --- | --- | --- | --- |
| R1 | — | la lectura dedicada existe (servicio + borde); que la PANTALLA la use es B.2 | **parcial: cierra en B.2** |
| R2 | `tests/unit/services/consolidacion-completo.test.ts` | «el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)» + «las filas del archivo son las MISMAS que las de la página: un solo mapper de dinero» (el servidor entrega el conjunto ya resuelto; el servicio no reordena ni recorta) | backend ✔ (la mitad de cliente, en B.2) |
| R3 | `tests/unit/actions/cierre-bodega-descarga-action.test.ts` | «una clave no declarada muere con validation_error sin tocar el service (R17)» | ✔ **con matiz**: estos dos listados NO tienen filtros (su schema de página solo llevaba `page`/`pageSize`), así que «los filtros vigentes» es el conjunto entero de la zona siempre. Lo que se afirma es lo único afirmable: que ninguna clave puede viajar |
| R4 | `…/consolidacion-completo.test.ts` | «un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)» + «el alcance sale del ACTOR, no de la entrada: cada bodega descarga la SUYA (R4)»; y en el borde, «una clave no declarada muere con validation_error sin tocar el service (R17)» | ✔ |
| R5 | `tests/unit/repositories/historicos-paginados-where.test.ts` | «cierres de bodega solicitados: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)»; para el listado 7, `colas-paginadas-where.test.ts` «el conjunto CONSOLIDABLE se declara una sola vez: la pagina y el listado entero lo comparten». Más, en servicio, «el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)» | ✔ |
| R6 | `…/consolidacion-completo.test.ts` | «con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)» (los dos listados, borde exacto por arriba y por abajo) + borde «limite_excedido del service pasa tal cual: conteos y NINGUNA fila (R6)» | ✔ |
| R7 | `tests/unit/actions/cierre-bodega-descarga-action.test.ts` | «sin sesión devuelve unauthenticated y ninguna fila, sin tocar el service (R7)» + «forbidden del service pasa tal cual, sin filas ni total (R7)» + «el actor se resuelve ANTES de validar: sin sesión no se filtra la lista blanca». El mensaje al usuario lo redacta el adaptador, y sus casos ya existen | backend ✔ |
| R8 | — | es de pantalla (montar no llama a la acción del conjunto) | **B.2** |
| R10 | `…/consolidacion-completo.test.ts` | **«el conjunto de la descarga no calcula agregados ni reparto de efectivo (R10)»** — espía de lecturas de dinero en CERO para los dos listados, más las llamadas al repositorio (`["findCierresBodegaByZona"]` y `["findCierresDiaConsolidables"]`, sin `contarCierresDiaSolicitados` ni la otra lectura), más la anti-vacuidad sobre `listarConsolidacion` | ✔ |
| R12 | — | columnas y textos del archivo: no se tocan. `cierres-bodega-descarga-columnas.ts` no se modificó y `ControlDescargaTransversal.test.tsx` sigue verde | ✔ sin cambios |
| R13 | `tests/components/paginacion/paginacion-transversal.test.tsx` | los listados 6 y 7 **siguen** declarados `conjunto` y siguen en `PENDIENTES_184`, porque sus pantallas no han migrado: el censo pasa sin tocarlo. Sacarlos es B.3, en el mismo commit que B.2 | ✔ |
| R14 | `tests/unit/repositories/historicos-paginados-where.test.ts` + `colas-paginadas-where.test.ts` | «cierres de bodega solicitados: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)» y «el conjunto CONSOLIDABLE se declara una sola vez» — ejecutan el repositorio REAL y afirman sobre los ARGUMENTOS de la consulta | ✔ (sin métodos nuevos: se verifican los reusados) |
| R15 | `…/historicos-paginados-where.test.ts` | «los dos conjuntos cuestan UNA consulta, sin recorte y sin conteo de página (R15)» | ✔ |
| R16 | los dos `*-where.test.ts` | los dos casos de R14, que es donde se afirma «mismas condiciones y mismo orden». La otra mitad de R16 —«no hay dos declaraciones del mismo criterio»— se cumple por construcción (`consolidablesWhere`, `cierresBodegaDeZonaWhere`, `ORDEN_CONSOLIDABLES`, `ORDEN_CIERRES_BODEGA`) y se midió con M5 | ✔ |
| R17 | `tests/unit/actions/cierre-bodega-descarga-action.test.ts` | «una clave no declarada muere con validation_error sin tocar el service (R17)» — seis entradas × dos bordes; incluye `page`/`pageSize`, que es lo que hace de la lista blanca una DERIVADA, y `zonaId`, que es la que importa | ✔ |
| R33 | — | no se tocó la configuración de `useSWR` de ninguna pantalla (cero archivos `app/**` modificados) | ✔ |
| R34 | este archivo | el mapa de arriba | ✔ |

**Requisitos que NO se pueden cubrir aquí, con su motivo:** R1 (parcial), R2 (mitad de cliente),
R8, R29–R32 son de **pantalla o de censo** —viven en `app/**` y en `paginacion-transversal`—, y
salen en B.2/B.3, fuera del alcance de BACKEND_DEV. **R9** es de la tanda C (las URL de evidencia
del listado 1) y **R11** es del listado 10, cerrado en la tanda A. **R18–R28** son la poda de la
selección satélite, cerrada en la tanda A. **R31/R32** son de la tanda H.

---

## 6. Puertas (medición real)

```
$ pnpm run typecheck
> tsc --noEmit
=== typecheck exit: 0 ===

$ pnpm exec eslint .
✖ 44 problems (0 errors, 44 warnings)

$ pnpm exec vitest run <los 15 archivos tocados y sus vecinos del dominio>
 Test Files  15 passed (15)
      Tests  139 passed (139)
   Duration  20.92s

$ pnpm exec vitest run guard
 Test Files  61 passed (61)
      Tests  830 passed (830)
   Duration  11.75s
```

**Rojos: cero, ni propios ni ajenos.**

Las **44 warnings de lint son AJENAS y PREEXISTENTES**: es el mismo número que midieron
`chore_deuda_170.md §6` (2026-08-03) y la tanda A sobre el árbol limpio. En los archivos que
toqué, `eslint` reporta 2 warnings, las dos en el helper `delegado` de
`historicos-paginados-where.test.ts` (`:42`, `:43`), que existía antes de esta tanda. **Delta
propio: cero.**

**La suite completa NO se corre aquí**: el gate (`./init.sh`) lo corre el LEADER.

---

## 7. Qué queda, y para quién

| Tarea | De quién | Qué falta exactamente |
| --- | --- | --- |
| **B.2** | frontend | `CierresBodegaSolicitadosTabla.tsx` (`:118-127`) y `ConsolidacionBodegaModule.tsx` (`:273-284`): `obtenerFilas` pasa de `filasDelConjuntoCompleto(listarConsolidacion().then(...))` a `filasDesdeResultado(listarCierresBodegaSolicitadosCompleto(), filaDescargaBodegaSolicitado)` y `filasDesdeResultado(listarConsolidablesCompleto(), filaDescargaConsolidable)`. Los cinco agregados de dinero siguen llegando por `listarConsolidacion` y NO se tocan |
| **B.3** | frontend | listados 6 y 7 a `adaptador: "completo"` y fuera de `PENDIENTES_184` (quedan 9), en el MISMO commit que B.2 |

**Aviso para B.2 (peaje del `vi.mock`):** en cuanto las dos pantallas importen las acciones
nuevas, todo archivo de test que haga `vi.mock("@/lib/actions/cierre-bodega", …)` con factoría y
renderice esas pantallas revienta al importarlas si no declara los exports nuevos. Los candidatos
medidos hoy son `tests/components/descarga/CierresDescarga.test.tsx`,
`tests/components/paginacion/ColasPaginacion.test.tsx` y `tests/components/CierresAdminPage.test.tsx`.
Es peaje esperado, no regresión.
