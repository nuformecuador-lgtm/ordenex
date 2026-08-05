# 184 — la parte BACKEND de la Tanda E (listados 4 y 5: «Cierres de bodega» del admin)

> Rama: `feature/184-deuda-170-listados` · Fecha: 2026-08-04 · Rol: BACKEND_DEV
>
> Alcance entregado: **E.1 y E.2**. `app/**` y `components/**` NO se tocan: E.3 (las dos
> pantallas) y E.4 (el censo) son del frontend y cierran la tanda.
>
> **Veredicto en una línea: los dos listados de bodega del admin dejan de descargar la tabla
> entera para quedarse con una mitad —de 7 filas leídas para producir 5, a 5— y aquí SÍ hicieron
> falta métodos de repositorio nuevos, con el dato delante; 19 mutaciones ejecutadas, 18 rojas y
> una superviviente MEDIDA que es un mutante equivalente, no un hueco.**

---

## 1. Lo primero que se midió: ¿hacían falta métodos nuevos de verdad?

El encargo pedía comprobarlo, porque el inventario se había quedado corto **en la dirección
contraria** dos veces (las tandas B y C no escribieron ni un método de repositorio). Aquí el
inventario acierta, y la razón se ve en una tabla — **los cinco** métodos de
`CierresBodegaAdminRepository`, con lo que emite cada uno:

| Método | Qué `where` emite | ¿Sirve como conjunto del listado 4 o del 5? |
| --- | --- | --- |
| `findCierresBodega()` | **ninguno** (`findMany` sin `where`) | **No.** Devuelve la UNIÓN de la cola y el histórico |
| `findHistoricoPaginado(rango)` | `estado notIn [cola]` + `skip`/`take` + `count` | No: es una página |
| `findColaPaginada(rango)` | `estado in [cola]` + `skip`/`take` + `count` | No: es una página |
| `findCierreBodegaConDetalle(id)` | `id` — y luego `cierre_dia`, `gestion_orden`, `cierre_detail` | No: otro grano (un cierre y su detalle) |
| `resolverCierreBodega(input)` | `id` + guardia de estado | No: es una escritura |

**Los cinco métodos, y ninguno devuelve ninguno de los dos conjuntos.** La única lectura sin
recorte es `findCierresBodega`, y **no es este conjunto: es este conjunto MÁS el otro listado de
la misma pantalla.** Por eso el servicio la parte en memoria con `esColaSolicitado`
(`CierresBodegaAdminService.ts:62`), y por eso el Anexo A mide el coste de estos dos listados
como «trae los dos conjuntos».

Reusarla habría dejado el archivo saliendo de un listado compuesto, que es exactamente lo que R1
prohíbe. Se escribieron **`findHistoricoCompleto()`** y **`findColaCompleta()`**.

**El dato, medido en el test** (`cierres-bodega-admin-completo.test.ts`, caso de R1, sobre el
almacén de la suite y para el actor `maestro`): la relectura de hoy lee **7 filas** (5 resueltos +
2 de la cola) para producir cualquiera de los dos archivos; la lectura dedicada lee **5** para
resueltos y **2** para pendientes. Y aquí cada fila de más **no es una fila de más a secas**:
`BODEGA_RESUMEN_SELECT` lleva dos joins de nombre (`zona`, `solicitadoPorUsuario`) y un
`_count: { cierresDia: true }`, que es una subconsulta correlacionada por fila. En producción la
proporción es mucho peor en un sentido concreto: la cola son los cierres sin resolver —una
decena— y el histórico crece sin tope con los días, así que descargar la cola arrastraba **toda
la operación**.

### Y aun así, lo de las tandas B y C también pasaba aquí

El encargo avisaba de que en B y C lo que faltaba no era un método sino **una sola declaración
del criterio**. Eso estaba pasando aquí también, y la tanda lo habría empeorado:

| Declaración | Antes | Ahora |
| --- | --- | --- |
| `orderBy: { solicitadoAt: "desc" }` sobre `cierre_bodega` | escrito **tres** veces (`findCierresBodega`, `findHistoricoPaginado`, `findColaPaginada`); con los dos métodos nuevos habrían sido **cinco** | `ORDEN_CIERRES_BODEGA_ADMIN`, **una** vez, leída por los cinco caminos |
| `estado notIn [cola]` | inline en `findHistoricoPaginado`; el conjunto habría sido la **segunda** copia | `historicoBodegaWhere()`, **una** vez |
| `estado in [cola]` | inline en `findColaPaginada`; ídem | `colaBodegaWhere()`, **una** vez |

Cero cambios de comportamiento: los 29 casos previos de los dos `*-where.test.ts` siguen verdes
sin tocarse, incluidos los que fijan `where` y orden en valores **absolutos**. Contraprueba
medida: **M5** (cambiar la constante compartida pone rojas cuatro afirmaciones a la vez, dos de
páginas y dos de conjuntos). Una declaración única no es una declaración sin vigilar.

**Nota de alcance:** el `orderBy: { solicitadoAt: "desc" }` que queda en
`findCierreBodegaConDetalle` **no se tocó a propósito**: es sobre `cierre_dia`, otra tabla y otro
listado (los cierres del día incluidos en un cierre de bodega). Meterlo en la constante de arriba
acoplaría dos criterios que hoy coinciden por casualidad.

---

## 2. Qué se escribió

### Repositorio — `CierresBodegaAdminRepository`

`findHistoricoCompleto()` y `findColaCompleta()`: cada uno es su hermano paginado **sin
`skip`/`take` y sin el `count`**, con el MISMO `where` y el MISMO `orderBy` por construcción, no
por vigilancia. UNA consulta cada uno (R15).

Las dos funciones de criterio se declaran con tipo de retorno **`Prisma.CierreBodegaWhereInput`
explícito**, y no es cosmético: es lo que hace que `tsc` cace una columna inexistente dentro de
ellas (medido en **M7**, §3).

**Ninguno recibe alcance, y no es un olvido: es que este listado no tiene.** El admin de bodega
es acceso total y ve la operación entera; el acotamiento es el ROL y lo aplica el servicio. Por
eso el `where` de los dos conjuntos tiene **exactamente una clave** (`estado`) y el test lo
afirma con `Object.keys(...)`.

### Servicio — `CierresBodegaAdminService`

`listarHistoricoCierresBodegaCompleto(actor)` y `listarPendientesCierresBodegaCompleto(actor)`:
guard `esAccesoTotal` ANTES del repositorio → el método del conjunto → tope
`descargaConfig.MAX_FILAS` evaluado aquí → `toResumen`.

**Ninguno recibe `input`, y es decisión, no olvido** — mismo criterio que las tandas B, C y D.
Estos listados no admiten filtros: su schema de página solo llevaba `page`/`pageSize`, y quitarlos
deja una lista blanca de **cero claves**. El borde la sigue aplicando entera —parsear ES la
barrera, medido en M15–M17— pero no hay nada que transportar hasta el servicio.

**Y aquí NO hay zona que resolver**, a diferencia de la tanda B: el `sinZona` de aquellos dos
listados no existe en éstos, así que no hay rama vacía que devolver ni consulta que ahorrarse por
ese lado.

### La decisión sobre enriquecimientos: este caso **no es el de la D ni el de la C**

La tanda D conservó `conPendiente` porque saltárselo emitía `null` —«no aprobado»— en un DTO de
dinero; la C se saltó el firmado de URL porque el DTO ni siquiera tenía campo de evidencia. **Aquí
no hay enriquecido que decidir**, y eso se midió antes de escribir nada:

| Camino | Qué hace además de leer y mapear |
| --- | --- |
| `listarCierresBodegaAdmin` (la relectura de hoy) | **nada**: `findCierresBodega` → `toResumen` → `if/else` por estado |
| `listarHistoricoCierresBodegaPaginado` / `…Pendientes…` (las páginas) | **nada**: repo → `toResumen` |
| `listarHistoricoCierresBodegaCompleto` / `…Pendientes…` (lo nuevo) | **nada**: repo → `toResumen` |

Cero firmas de URL, cero agregados de dinero, cero consultas a otra tabla: los totales son
SNAPSHOT y `toResumen` los pasa tal cual (R13). Lo único que la relectura de hoy hacía de más era
**leer la otra mitad**. Así que la decisión que sí había que tomar es la simétrica: **usar el
MISMO `toResumen` que la página**, para que las filas del archivo sean las de la página campo por
campo (R5 en su forma fuerte) y no unas parecidas. Está afirmado en el caso «las filas del archivo
son las MISMAS que las de la página, campo por campo».

Eso tiene una consecuencia medida y honesta, y es **M14** (§3): hoy `CierreBodegaResumenRow` y
`CierreBodegaResumen` son **estructuralmente idénticos**, así que saltarse `toResumen` produce el
mismo objeto y **ningún test lo mata**. Es un **mutante equivalente**, no un hueco de cobertura, y
la conclusión NO es retirar el `.map(toResumen)`: retirarlo rompería la simetría con la página
—que sí mapea— justo en el punto donde R16 pide que los dos caminos no puedan divergir. Se deja,
declarado.

### Schemas — `lib/types/cierre-bodega.ts`

Derivados, no reescritos:

```ts
listarPendientesCierresBodegaCompletoSchema = listarCierresBodegaPaginadoSchema
  .omit({ page: true, pageSize: true }).strict();
listarHistoricoCierresBodegaCompletoSchema  = listarCierresBodegaPaginadoSchema
  .omit({ page: true, pageSize: true }).strict();
```

Dos constantes y no una, aunque hoy su forma coincida **y aunque las dos deriven del mismo schema
de página**: el nombre es lo único que dice cuál de las dos mitades se pide, y si mañana una gana
un filtro lo hereda aquí sin arrastrar a la otra. Y `.strict()` se reescribe aunque `.omit()` lo
herede, por el mismo motivo que en el schema de la página.

### Bordes — `lib/actions/cierre-bodega.ts`

`listarPendientesCierresBodegaCompleto` y `listarHistoricoCierresBodegaCompleto`, calcados de sus
hermanas paginadas: actor primero, zod después, servicio al final, todo bajo `withErrorHandler`.
`input: unknown = {}` para que la pantalla pueda llamarlas sin argumentos.

**Lo que el frontend encontrará listo (E.3):** las dos acciones devuelven
`ListarCompletoResult<CierreBodegaResumen>` — exactamente lo que `filasDesdeResultado` sabe
traducir y lo que `filaDescargaBodegaPendiente` / `filaDescargaBodegaResuelto` ya saben proyectar
(las dos toman `CierreBodegaResumen`, sin cambio de firma).

---

## 3. Dónde vive cada test, y por qué — con la medición delante

El encargo pedía decidirlo con criterio y justificarlo. Se midió con **M7**, la mutación que en la
tanda A solo cazaba un Postgres real:

```
=== M7 (R14) el criterio del HISTORICO gana una condicion sobre una columna QUE NO EXISTE
  × la cola y el historico PARTICIONAN el conjunto: mismo criterio, uno el complemento del otro
  × los CONJUNTOS de cola e histórico de bodega particionan la tabla con la MISMA constante (R16)
  × cierres de bodega — resueltos: estados fuera de la cola (los RECHAZADOS siguen dentro)
  × cierres de bodega — resueltos: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × el conjunto del archivo NO es el listado compuesto: trae UNA mitad, no las dos (R1)
  Tests  5 failed | 29 passed (34)
--- typecheck:
  lib/repositories/CierresBodegaAdminRepository.ts(93,61): error TS2353: Object literal may only
    specify known properties, and 'estadoDelCierreResuelto' does not exist in type
    'CierreBodegaWhereInput'.
  typecheck exit: 2
```

**Doble red, y por eso esta tanda NO añade un archivo `tests/integration/db/`:**

1. **`tsc` la caza**, como en las tandas B, C y D: estas consultas van por el constructor tipado
   de Prisma (`Prisma.CierreBodegaWhereInput`,
   `Prisma.CierreBodegaOrderByWithRelationInput`, `select` con `GetPayload`), no por `$queryRaw`
   como las de la tanda A. La columna inexistente no compila.
2. **Los `*-where.test.ts` también la cazan**, y con cinco casos: aquí las afirmaciones son
   `toEqual` sobre el `where` entero —igualdad estricta— más un `Object.keys(where)` que exige que
   la única clave sea `estado`. Una clave de más lo pone rojo aunque el tipo la permitiera.

No se encontró ninguna propiedad de estas dos consultas que un Postgres real pudiera desmentir y
estas dos no. Lo que un Postgres real sí seguiría cazando —drift entre `schema.prisma` y la base—
no lo introduce esta tanda: las columnas y la proyección son las que ya usan las dos páginas en
producción, sin un solo campo nuevo.

**Lo que los dobles NO ven, y por eso está en los `*-where.test.ts`:** el `where`, el `orderBy`,
cuántas consultas se emiten y qué NO llevan.

**Lo que los `*-where.test.ts` NO ven, y por eso está en el test de servicio:** de qué método se
sirve el camino del archivo y **cuántas filas lee**. Es orquestación, no SQL — y es LA propiedad
de esta tanda (§4, M8).

---

## 4. Las 19 mutaciones, con su salida

Cada una: se rompe el código de verdad, se corre, se restaura **desde una copia en memoria**
(nunca `git checkout`/`restore`/`stash`: el worktree está compartido). El runner **reintenta la
restauración y verifica byte a byte que el contenido volvió a ser el original**, y aborta si no lo
consigue — el incidente de la tanda D (un `writeFileSync` que falló por un lock de Windows y dejó
la mutación aplicada) está cubierto. `git status` limpio tras cada lote, verificado y pegado.

### Lote repositorio (7) — el criterio compartido y la partición

```
=== M1 (R16/R5) el conjunto de RESUELTOS ordena al reves que su pagina
  × los CONJUNTOS de cola e histórico de bodega particionan la tabla con la MISMA constante (R16)
  × cierres de bodega — resueltos: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × el conjunto del archivo NO es el listado compuesto: trae UNA mitad, no las dos (R1)
  Tests  3 failed | 31 passed (34)
=== M2 (R1/R16) el conjunto de RESUELTOS deja de cortar por estado (= el listado compuesto)
  × los CONJUNTOS de cola e histórico de bodega particionan la tabla con la MISMA constante (R16)
  × cierres de bodega — resueltos: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × el conjunto del archivo NO es el listado compuesto: trae UNA mitad, no las dos (R1)
  Tests  3 failed | 31 passed (34)
=== M3 (R15) el conjunto de RESUELTOS recorta como si fuera una pagina
  × cierres de bodega — resueltos: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × los dos conjuntos de la bodega del admin cuestan UNA consulta, sin recorte y sin conteo de página (R15)
  Tests  2 failed | 32 passed (34)
=== M4 (R16) la COLA deja de leer la constante compartida y se traga `vencido`
  × cierres de bodega — cola: solo `solicitado`, y los RECHAZADOS quedan fuera
  × la cola y el historico PARTICIONAN el conjunto: mismo criterio, uno el complemento del otro
  × cierres de bodega — pendientes: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × los CONJUNTOS de cola e histórico de bodega particionan la tabla con la MISMA constante (R16)
  × el conjunto del archivo NO es el listado compuesto: trae UNA mitad, no las dos (R1)
  Tests  5 failed | 29 passed (34)
=== M5 (R5/R16) el orden COMPARTIDO cambia para los CINCO caminos a la vez
  × cierres de bodega — cola: solo `solicitado`, y los RECHAZADOS quedan fuera
  × cierres de bodega — pendientes: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × cierres de bodega — resueltos: estados fuera de la cola (los RECHAZADOS siguen dentro)
  × cierres de bodega — resueltos: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  Tests  4 failed | 30 passed (34)
=== M6 (R16/R44) el HISTORICO cambia `notIn: [cola]` por `in: [aprobado, rechazado]`
  × la cola y el historico PARTICIONAN el conjunto: mismo criterio, uno el complemento del otro
  × los CONJUNTOS de cola e histórico de bodega particionan la tabla con la MISMA constante (R16)
  × cierres de bodega — resueltos: estados fuera de la cola (los RECHAZADOS siguen dentro)
  × cierres de bodega — resueltos: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × el conjunto del archivo NO es el listado compuesto: trae UNA mitad, no las dos (R1)
  Tests  5 failed | 29 passed (34)
=== M7 (R14) el criterio gana una condicion sobre una columna QUE NO EXISTE
  (salida completa en §3)
  Tests  5 failed | 29 passed (34)   +   typecheck exit: 2
=== arbol restaurado
```

**M4 y M6 son los dos lados feos de la partición**, y merecen leerse juntos:

- **M4** mete `vencido` en el `in` de la cola sin sacarlo del `notIn` del histórico: un cierre de
  bodega `vencido` aparecería en **las dos** pantallas y en **los dos** archivos, contado dos
  veces en una tabla de dinero agregado por zona.
- **M6** sustituye el `notIn` del histórico por `in: ["aprobado","rechazado"]`: hoy da lo mismo,
  pero el día que el enum `CierreEstado` gane un estado, ese estado **desaparece de las dos
  mitades** en vez de caer en el histórico. Es exactamente el defecto que la 170 documentó al
  crear estos archivos, y por eso los casos de la 170 caen junto a los míos.

**M5 es la contraprueba de que compartir el orden no lo vuelve invisible**, esta vez con cinco
caminos colgando de una constante.

### Lote servicio (7) — de qué se sirve el archivo, el tope y el guard

```
=== M8 (R1) el conjunto de RESUELTOS vuelve a servirse del COMPUESTO y parte en memoria
  × el conjunto de la descarga NO relee el listado compuesto: pide su mitad y sólo su mitad (R1)
  Tests  1 failed | 43 passed (44)
=== M9 (R6) el tope de RESUELTOS se corre una fila: >= en vez de >
  × con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)
  Tests  1 failed | 43 passed (44)
=== M10 (R6) el tope de RESUELTOS TRUNCA en vez de rechazar
  × con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)
  Tests  1 failed | 43 passed (44)
=== M11 (R4) el guard de rol de RESUELTOS se evalua DESPUES del repositorio
  × un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)
  Tests  1 failed | 43 passed (44)
=== M12 (R5) el conjunto de RESUELTOS se sirve del metodo PAGINADO con take: 2
  × el alcance sale del ROL del ACTOR, no de la entrada, y abarca TODAS las zonas (R4)
  × el conjunto de la descarga NO relee el listado compuesto: pide su mitad y sólo su mitad (R1)
  × el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)
  × las filas del archivo son las MISMAS que las de la página, campo por campo
  × con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)
  Tests  5 failed | 39 passed (44)
=== M13 (R4) el guard de la COLA acepta ademas al adminSatelite
  × un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)
  Tests  1 failed | 43 passed (44)
=== M14 (mapper) el conjunto de RESUELTOS se salta `toResumen` y devuelve la fila CRUDA
  Tests  44 passed (44)          ← SOBREVIVE: mutante equivalente, ver abajo
=== arbol restaurado
```

**M8 es LA mutación de esta tanda, y merece leerse dos veces.** El código mutado vuelve a
`findCierresBodega()` y parte en memoria con `esColaSolicitado` — es decir, deshace exactamente lo
que la tanda entrega. Y produce **las mismas filas, en el mismo orden, con el mismo total**: el
corte en memoria y el corte en la base seleccionan lo mismo. Es indistinguible por cualquier test
que mire el resultado… y de hecho **43 de los 44 casos siguen verdes**.

La caza un solo caso, y por una vía que había que construir a propósito, tal como avisaba el
encargo: el repositorio en memoria de la suite anota **cuántas filas devolvió cada llamada**, no
solo cuál fue. El caso afirma `llamadas === ["findHistoricoCompleto"]` y `filasLeidas === [5]`. La
**anti-vacuidad** vive en el mismo caso: la relectura que esta tanda sustituye se ejecuta también
—`listarCierresBodegaAdmin(MAESTRO)`— y se afirma que lee **7**
(`llamadas === ["findCierresBodega"]`, `filasLeidas === [7]`). Sin esa mitad, un servicio que no
leyera nada pasaría igual.

**M12 existe por el aviso de la tanda C/D: cuidado con el killer que depende del fixture.**
Servirse del método paginado con el `take` real (25) y cinco filas de almacén habría dejado R5
vivo, porque la página 1 *sería* el conjunto entero. Se ejecutó directamente con **`take: 2`**, y
ahí caen cinco casos, incluido el de R5. El caso de R5 recorre además las páginas con
`pageSize: 2` por el mismo motivo, y lleva su propia anti-vacuidad
(`expect(items.length).toBeGreaterThan(2)`: son TRES páginas, no una).

**M13 se aplicó al guard de la COLA a propósito**, para que el lote no midiera solo uno de los dos
listados; y el rol que abre no es cualquiera: el `adminSatelite` tiene su propia pantalla de
bodega (los listados 6 y 7), así que es el error plausible — y le entregaría el agregado de dinero
de **todas** las zonas.

#### M14: la mutación que sobrevive, y por qué NO se retira nada

`items: conjunto` en vez de `items: conjunto.map(toResumen)`. **Sobrevive**, y está medido, no
supuesto. El motivo es concreto: `CierreBodegaResumenRow`
(`ICierreBodegaRepository.ts:25-39`) y `CierreBodegaResumen`
(`ICierreBodegaService.ts:21-35`) declaran **las mismas trece propiedades con los mismos tipos**,
así que `toResumen` es hoy una proyección que resulta ser la identidad: el programa mutado y el
original son **observacionalmente indistinguibles**. Es la definición de **mutante equivalente**,
no un hueco de cobertura.

Se consideró y se descartó cerrar el hueco de dos formas:

- **Afirmar que el objeto devuelto NO es el mismo que el del repositorio** (`not.toBe`): mataría
  la mutación, pero fija un detalle de implementación sin ninguna consecuencia observable — en
  producción el repositorio construye objetos nuevos en cada consulta.
- **Afirmar el conjunto exacto de claves del DTO**: hoy tampoco la mata (las claves coinciden), y
  el día que difirieran, el campo de más tampoco llegaría al archivo: quien decide las columnas es
  `filaDescargaBodegaResuelto`, que las enumera una a una.

Y **no se retira el `.map(toResumen)`**, aunque el encargo pida retirar el código que ninguna
mutación protege: aquí el código no es inalcanzable —se ejecuta— y quitarlo rompería la simetría
con la página, que sí mapea. Que los dos caminos hagan lo MISMO es lo que sostiene «las filas del
archivo son las de la página, campo por campo» (R5) y lo que R16 pide en su espíritu. Queda
declarado aquí, que es lo que corresponde a un mutante equivalente.

### Lote borde (5) — la lista blanca derivada

```
=== M15 (R17) el borde de RESUELTOS usa el schema de la PAGINA en vez del derivado
  × una clave no declarada muere con validation_error sin tocar el service (R17)
  Tests  1 failed | 20 passed (21)
=== M16 (R17) el borde de PENDIENTES no parsea la entrada
  × una clave no declarada muere con validation_error sin tocar el service (R17)
  Tests  1 failed | 20 passed (21)
=== M17 (R17) el schema derivado de RESUELTOS deja de ser estricto (.strict -> .passthrough)
  × una clave no declarada muere con validation_error sin tocar el service (R17)
  Tests  1 failed | 20 passed (21)
=== M18 (R7) el borde de RESUELTOS valida ANTES de resolver el actor
  × el actor se resuelve ANTES de validar: sin sesión no se filtra la lista blanca
  Tests  1 failed | 20 passed (21)
=== M19 (borde) el borde de RESUELTOS deja de admitir la llamada SIN entrada
  × sin entrada, o con un objeto vacío, delega en el service con SOLO el actor
  Tests  1 failed | 20 passed (21)
=== arbol restaurado
```

**M15 es la que justifica que el schema se DERIVE.** Con la lista blanca copiada a mano del
listado paginado, `page: 2` y `pageSize: 100` pasarían: son claves que la página acepta y el
conjunto no debe. El caso las prueba explícitamente, junto a `zonaId` y `estado`, que son las que
convertirían un archivo del maestro en otra cosa. **M16 se aplicó al borde de PENDIENTES a
propósito**, para que el lote no midiera solo uno de los dos.

**Resultado: 19 mutaciones, 18 rojas y 1 superviviente medida y declarada (M14, equivalente).**

---

## 5. Archivos

**Nuevos (2)**

- `tests/unit/services/cierres-bodega-admin-completo.test.ts` — 7 casos (incluye el contador de
  filas leídas con su anti-vacuidad, y el espía de firmas con la suya).
- `tests/unit/actions/cierre-bodega-admin-descarga-action.test.ts` — 6 casos, **los dos bordes en
  cada uno**.

**Modificados — producción (6)**

- `lib/repositories/CierresBodegaAdminRepository.ts` — `ORDEN_CIERRES_BODEGA_ADMIN`,
  `historicoBodegaWhere`, `colaBodegaWhere` (una declaración cada uno) **y los dos métodos
  nuevos**.
- `lib/interfaces/repositories/ICierresBodegaAdminRepository.ts` — sus dos contratos.
- `lib/services/CierresBodegaAdminService.ts` — los dos métodos del conjunto.
- `lib/interfaces/services/ICierresBodegaAdminService.ts` — sus dos contratos y sus dos result
  types.
- `lib/types/cierre-bodega.ts` — los dos schemas derivados y los dos `…CompletoResult`.
- `lib/actions/cierre-bodega.ts` — los dos bordes.

**Modificados — tests (3)**

- `tests/unit/repositories/historicos-paginados-where.test.ts` — +3 casos (17 → 20).
- `tests/unit/repositories/colas-paginadas-where.test.ts` — +2 casos (12 → 14).
- `tests/unit/services/cierres-bodega-admin-service.test.ts` — su `fakeRepo` gana los dos métodos
  como no-op. **Es el único peaje de tipos de esta tanda**, y es una sola suite: las otras cuatro
  que doblan este repositorio usan `as unknown as`, así que no lo notan. Lo cobra `tsc`, no un
  rojo tardío.

**Cero** cambios en `app/**`, `components/**`, `db/migrations/`, RLS, esquema, `feature_list.json`
y la configuración de `useSWR` de ninguna pantalla (R33).

**Peaje de los `vi.mock` ajenos: CERO en esta tanda.** Ninguna pantalla importa todavía las
acciones nuevas: eso es E.3. Se comprobó ejecutando las dieciséis suites que mockean, renderizan o
censan este dominio: **171 casos, todos verdes**. **Quien haga E.3 sí lo pagará**, y conviene
enumerarlo antes con `pnpm exec vitest related --run` sobre las dos pantallas.

---

## 6. Mapa `R<n>` → archivo + nombre del caso

Construido **leyendo el caso**, no contando `R\d+` en títulos: varios casos cubren un requisito sin
nombrarlo y varios títulos de los archivos vecinos citan requisitos de la **feature 170** (`R40`,
`R41`, `R44`, `R49`, `R51`, `R54`), cuyo espacio de nombres se cruza con el de esta.

| R | Archivo | Caso | Estado |
| --- | --- | --- | --- |
| R1 | `tests/unit/services/cierres-bodega-admin-completo.test.ts` + `tests/unit/repositories/historicos-paginados-where.test.ts` | **«el conjunto de la descarga NO relee el listado compuesto: pide su mitad y sólo su mitad (R1)»** (llamadas + filas leídas, con la anti-vacuidad de la relectura de hoy: 7 filas) y «el conjunto del archivo NO es el listado compuesto: trae UNA mitad, no las dos (R1)» (el compuesto no lleva `where` en absoluto). Killers: **M2**, **M8** | backend ✔; que la PANTALLA lo use es **E.3** |
| R2 | `…/cierres-bodega-admin-completo.test.ts` | «el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)» + «las filas del archivo son las MISMAS que las de la página, campo por campo» (el servidor entrega el conjunto ya resuelto; el servicio no reordena ni recorta) | backend ✔ (la mitad de cliente, en E.3) |
| R3 | `tests/unit/actions/cierre-bodega-admin-descarga-action.test.ts` | «una clave no declarada muere con validation_error sin tocar el service (R17)» | ✔ **con matiz**: estos listados NO tienen filtros, así que «los filtros vigentes» es siempre la operación entera. Lo afirmable es que ninguna clave puede viajar |
| R4 | `…/cierres-bodega-admin-completo.test.ts` | «un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)» (5 roles × 2 listados, cero llamadas) + «el alcance sale del ROL del ACTOR, no de la entrada, y abarca TODAS las zonas (R4)» (maestro ≡ admin, las dos zonas en el archivo, y aridad 1 de los dos métodos). Killers: **M11**, **M12**, **M13** | ✔ |
| R5 | `tests/unit/repositories/{historicos-paginados,colas-paginadas}-where.test.ts` | «cierres de bodega — resueltos / pendientes: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)». Más, en servicio, «el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)» — con `pageSize: 2`, killer medido **M12** | ✔ |
| R6 | `…/cierres-bodega-admin-completo.test.ts` | «con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)» (borde exacto por arriba y por abajo, **para cada uno de los dos listados**) + en el borde, «limite_excedido del service pasa tal cual: conteos y NINGUNA fila (R6)». Killers: **M9**, **M10** | ✔ |
| R7 | `tests/unit/actions/cierre-bodega-admin-descarga-action.test.ts` | «sin sesión devuelve unauthenticated y ninguna fila, sin tocar el service (R7)» + «forbidden del service pasa tal cual, sin filas ni total (R7)» + «el actor se resuelve ANTES de validar: sin sesión no se filtra la lista blanca» (killer **M18**). El mensaje al usuario lo redacta el adaptador, y sus casos ya existen | backend ✔ |
| R8 | — | es de pantalla (montar no llama a la acción del conjunto) | **E.3** |
| R12 | — | columnas y textos del archivo: no se tocan. `cierres-bodega-descarga-columnas.ts` no se modificó y `ControlDescargaTransversal.test.tsx` sigue verde. Las dos filas de descarga siguen tomando `CierreBodegaResumen`, así que E.3 no cambia firmas | ✔ sin cambios |
| R13 | `tests/components/paginacion/paginacion-transversal.test.tsx` | los listados 4 y 5 **siguen** declarados `conjunto` y siguen en `PENDIENTES_184` (`:334-335`), porque sus pantallas no han migrado: el censo pasa sin tocarlo. Sacarlos es E.4, en el mismo commit que E.3 | ✔ |
| R14 | `historicos-paginados-where.test.ts` + `colas-paginadas-where.test.ts` | «cierres de bodega — resueltos: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)» y su gemelo de pendientes — ejecutan el repositorio REAL y afirman sobre los ARGUMENTOS de la consulta. Un caso por método nuevo. Killer del tipo «columna que no existe»: **M7** (rojo en tests **y** en `tsc`) | ✔ |
| R15 | `historicos-paginados-where.test.ts` | «los dos conjuntos de la bodega del admin cuestan UNA consulta, sin recorte y sin conteo de página (R15)» — killer **M3** | ✔ |
| R16 | los dos `*-where.test.ts` | los dos casos de R14 (mismas condiciones y mismo orden) + **«los CONJUNTOS de cola e histórico de bodega particionan la tabla con la MISMA constante (R16)»**, que es la mitad que solo se ve mirando las dos a la vez. La otra mitad de R16 —«no hay dos declaraciones del mismo criterio»— se cumple por construcción (`ORDEN_CIERRES_BODEGA_ADMIN`, `historicoBodegaWhere`, `colaBodegaWhere`) y se midió con **M4**, **M5** y **M6** | ✔ |
| R17 | `tests/unit/actions/cierre-bodega-admin-descarga-action.test.ts` | «una clave no declarada muere con validation_error sin tocar el service (R17)» — seis entradas × **dos** bordes; incluye `page`/`pageSize`, que es lo que hace de la lista blanca una DERIVADA, y `zonaId`/`estado`, que son las que importan. Killers: **M15**, **M16**, **M17** | ✔ |
| R33 | — | no se tocó la configuración de `useSWR` de ninguna pantalla (cero archivos `app/**` modificados) | ✔ |
| R34 | este archivo | el mapa de arriba | ✔ |

**Requisitos que NO se pueden cubrir aquí, con su motivo:** R1 (mitad de pantalla), R2 (mitad de
cliente) y R8 son de **pantalla**, y salen en E.3. R13/R29–R32 son de **censo**
(`paginacion-transversal`, `adaptador-conjunto.guardia`) y salen en E.4 y en la tanda H. **R9** es
de la tanda C (las URL de evidencia del listado 1) y **R10** de la tanda B (los agregados de la
consolidación); ninguno aplica a estos dos listados —el camino del archivo no firma ni agrega
nada—, aunque el espía de firmas se dejó puesto con su anti-vacuidad por si algún día el camino
cambiara. **R11** es del listado 10 y **R18–R28** son la poda de la selección satélite, las dos
cerradas en la tanda A.

---

## 7. Puertas (medición real)

```
$ pnpm run typecheck
> tsc --noEmit
=== typecheck exit: 0 ===

$ pnpm exec vitest run <mis 4 archivos + las 12 suites vecinas del dominio>
 Test Files  16 passed (16)
      Tests  171 passed (171)
   Duration  12.19s

$ pnpm exec vitest run guard
 Test Files  61 passed (61)
      Tests  830 passed (830)
   Duration  6.68s

$ pnpm exec eslint .
✖ 44 problems (0 errors, 44 warnings)
```

**Rojos: cero, ni propios ni ajenos.** Tampoco aparecieron los rojos de contención avisados
(`LoginForm`, `RegistrarPagoDialog`): no entran en los archivos que corrí.

Las **44 warnings de lint son AJENAS y PREEXISTENTES**: es el mismo número que midieron
`chore_deuda_170.md §6` (2026-08-03) y las tandas A, B, C y D sobre el árbol limpio. En los once
archivos que toqué, `eslint` reporta **4 warnings**, las cuatro del helper `delegado` de los dos
`*-where.test.ts` (`_args` sin usar), que existían antes de esta tanda. **Delta propio: cero** —
el espía de firmas del test de servicio declara su parámetro y lo descarta con `void paths` en vez
del idiom `_paths`, justamente para no engordar el número.

**La suite completa NO se corre aquí**: el gate (`./init.sh`) lo corre el LEADER.

---

## 8. Hallazgo para E.3 / la tanda H: `listarCierresBodegaAdmin` se queda sin consumidores

Medido hoy contra el árbol: la acción `listarCierresBodegaAdmin()` tiene **exactamente dos
consumidores de producción**, y los dos son las descargas que esta tanda sustituye —
`CierresBodegaAdminModule.tsx:314-322` y `CierresBodegaResueltosTabla.tsx:120-128`—. La pantalla
ya no la usa para pintar: `app/(app)/cierres-admin/page.tsx:90-102` la sacó del render en la
T M.1 de la 170, y lo dice por escrito.

**En cuanto E.3 aterrice, `listarCierresBodegaAdmin` (la acción), `listarCierresBodegaAdmin` (el
método de servicio) y `findCierresBodega` (el método de repositorio) quedan sin ningún lector de
producción.**

**No se retiran aquí, y con motivo:** (a) hoy siguen siendo alcanzables —las dos pantallas las
llaman, y R13 exige que los listados sin migrar sigan descargando exactamente como hoy—; (b) la
anti-vacuidad del caso de R1 se apoya precisamente en ejecutar esa relectura y contar sus 7 filas.
Se deja **anotado como candidato a retirada** para la tanda H, junto al adaptador
`filasDelConjuntoCompleto`, que es el mismo tipo de deuda y el mismo momento para pagarla.

---

## 9. Qué queda, y para quién

| Tarea | De quién | Qué falta exactamente |
| --- | --- | --- |
| **E.3** | frontend | `CierresBodegaAdminModule.tsx` (`:311-323`) y `CierresBodegaResueltosTabla.tsx` (`:117-129`): `obtenerFilas` pasa de `filasDelConjuntoCompleto(listarCierresBodegaAdmin().then(res => ({status:"ok", items: res.pendientes})), filaDescargaBodegaPendiente)` a `filasDesdeResultado(listarPendientesCierresBodegaCompleto(), filaDescargaBodegaPendiente)`, y su gemelo con `listarHistoricoCierresBodegaCompleto` / `filaDescargaBodegaResuelto`. Las dos filas de descarga **no cambian de firma**: siguen tomando `CierreBodegaResumen` |
| **E.4** | frontend | listados 4 y 5 a `adaptador: "completo"` y fuera de `PENDIENTES_184` (quedan 4), en el MISMO commit que E.3 |

**Aviso para E.3 (peaje del `vi.mock`):** en cuanto las dos pantallas importen las acciones
nuevas, todo archivo de test que haga `vi.mock("@/lib/actions/cierre-bodega", …)` con factoría y
renderice esas pantallas revienta al importarlas si no declara los exports nuevos. Los candidatos
medidos hoy son `tests/components/descarga/CierresDescarga.test.tsx`,
`tests/components/CierresAdminPage.test.tsx`,
`tests/components/paginacion/ColasPaginacion.test.tsx` y
`tests/components/paginacion/BajoRiesgoPaginacion.test.tsx`. Es peaje esperado, no regresión.

**Y el caso que E.3 tiene que dejar verde sin retocar su intención:** el de la tanda M de la 170
que detectó la mutación `filasDelConjuntoCompleto → filasLocales` en `CierresBodegaResueltosTabla`
— ahora contra el adaptador nuevo (`tasks.md`, E.3).

---

## 10. Nota de proceso: el worktree sigue compartido

Se respetó la regla entera: **ninguna orden de git sin ruta explícita**, ningún `--amend`, ningún
`stash`. El runner de mutaciones restaura **desde una copia en memoria**, reintenta hasta seis
veces y **verifica que el contenido volvió a ser el original**, abortando si no lo consigue; se
comprobó `git status` limpio tras cada uno de los tres lotes. Los archivos del otro agente
(`app/(app)/cierres-admin/_components/CierresAdminModule.tsx`, que apareció modificado a mitad de
la tanda) **no se tocaron ni se commitearon**.
