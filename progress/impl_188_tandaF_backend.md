# 184 — la parte BACKEND de la Tanda F (listados 8 y 9: «Incidentes» del admin)

> Rama: `feature/184-deuda-170-listados` · Fecha: 2026-08-04 · Rol: BACKEND_DEV
>
> Alcance entregado: **F.1 y F.2**. `app/**` y `components/**` NO se tocan: F.3 (las dos
> pantallas) y F.4 (el censo) son del frontend y cierran la tanda.
>
> **Veredicto en una línea: los dos listados de incidentes dejan de descargar el alcance entero
> para quedarse con una mitad —de 7 filas leídas para producir 5, a 5— y además dejan de firmar
> las URL de evidencia que el archivo tiene PROHIBIDO llevar; aquí SÍ hicieron falta métodos de
> repositorio nuevos, con el dato delante; 20 mutaciones ejecutadas, las 20 rojas.**

---

## 1. Lo primero que se midió: ¿hacían falta métodos nuevos de verdad?

El encargo pedía comprobarlo, porque el inventario se había quedado corto **en la dirección
contraria** dos veces (las tandas B y C no escribieron ni un método de repositorio). Aquí el
inventario acierta, y la razón se ve en una tabla — **los seis** métodos de
`IncidenteAdminRepository`, con lo que emite cada uno:

| Método | Qué `where` emite | ¿Sirve como conjunto del listado 8 o del 9? |
| --- | --- | --- |
| `findByAlcance(alcance)` | `alcanceWhere(alcance)`, **sin corte por estado** | **No.** Devuelve la UNIÓN de la cola y el histórico |
| `findHistoricoPaginado(alcance, rango)` | `alcance` + `estado notIn [cola]` + `skip`/`take` + `count` | No: es una página |
| `findColaPaginada(alcance, rango)` | `alcance` + `estado in [cola]` + `skip`/`take` + `count` | No: es una página |
| `findByIdEnAlcance(id, alcance)` | `id` + `alcance` | No: otro grano (una fila) |
| `reportar(input)` / `resolver(input)` | escrituras transaccionales | No |

**Los seis métodos, y ninguno devuelve ninguno de los dos conjuntos.** La única lectura sin
recorte es `findByAlcance`, y **no es este conjunto: es este conjunto MÁS el otro listado de la
misma pantalla.** Por eso el servicio la parte en memoria con `esColaSolicitado`
(`IncidenteAdminService.ts:126`), y por eso el Anexo A mide el coste de estos dos listados como
«trae los dos conjuntos».

Reusarla habría dejado el archivo saliendo de un listado compuesto, que es exactamente lo que R1
prohíbe. Se escribieron **`findHistoricoCompleto(alcance)`** y **`findColaCompleta(alcance)`**.

**El dato, medido en el test** (`incidentes-completo.test.ts`, caso de R1, sobre el almacén de la
suite): la relectura de hoy lee **7 filas** (5 del histórico + 2 de la cola) para producir
**cualquiera** de los dos archivos; la lectura dedicada lee **5** para el histórico y **2** para la
cola. Y hay un segundo dato que este dominio tiene y los de las tandas D y E no: **el mismo almacén
para el `adminSatelite` de `z-1` da 4 filas leídas por la relectura y 3 / 1 por las dedicadas**,
porque aquí el alcance por zona y el corte por estado son criterios independientes que se
multiplican.

Cada fila de más no es una fila de más a secas: `INCIDENTE_SELECT` lleva tres joins de nombre
(`orden.zona`, `reportadoPorUsuario`, `resueltoPorUsuario`), el join de `orden.estatus` y una
**subconsulta ordenada de evidencias por fila**. Y en producción la proporción es mucho peor en un
sentido concreto: la cola son los incidentes sin resolver —una decena— y el histórico crece sin
tope con los días, así que descargar la cola arrastraba **todos** los incidentes que el actor puede
ver.

### Y aun así, lo de las tandas B y C también pasaba aquí

El encargo avisaba de que lo que a veces falta no es un método sino **una sola declaración del
criterio**. Eso estaba pasando aquí también, y la tanda lo habría empeorado:

| Declaración | Antes | Ahora |
| --- | --- | --- |
| `orderBy: { createdAt: "desc" }` | escrito **tres** veces (`findByAlcance`, `findHistoricoPaginado`, `findColaPaginada`); con los dos métodos nuevos habrían sido **cinco** | `ORDEN_INCIDENTES_ADMIN`, **una** vez, leída por los cinco caminos |
| `alcance + estado notIn [cola]` | inline en `findHistoricoPaginado`; el conjunto habría sido la **segunda** copia | `historicoIncidentesWhere()`, **una** vez |
| `alcance + estado in [cola]` | inline en `findColaPaginada`; ídem | `colaIncidentesWhere()`, **una** vez |
| **el alcance por la zona de la ORDEN** | `alcanceWhere()` **más DOS copias escritas a mano** dentro de `resolver` (`:257` y `:320`) — tres declaraciones | `alcanceWhere()`, **una** vez, leída por los seis caminos |

La última fila **no la traía el encargo y se encontró midiendo**: las dos copias de `resolver` son
la guardia que decide si un `adminSatelite` puede mover el dinero de otra zona (la del `updateMany`
que escribe la indemnización y la del `count` que distingue «ya resuelto» de «otra zona»). Eran
literalmente la misma expresión que `alcanceWhere`, así que sustituirlas es un cambio nulo de
comportamiento — y ahora hay **una** declaración del criterio más sensible de este repositorio en
vez de tres. Los 25 casos de `incidente-admin-repository.test.ts` siguen verdes sin tocarse.

Cero cambios de comportamiento en el resto: los 34 casos previos de los dos `*-where.test.ts`
siguen verdes sin tocarse, incluidos los que fijan `where` y orden en valores **absolutos**.
Contraprueba medida: **M5** (cambiar la constante compartida pone rojas seis afirmaciones a la vez,
cuatro de páginas y dos de conjuntos). Una declaración única no es una declaración sin vigilar.

**Nota de alcance:** `zonaWhere` (`:44`) **no se tocó a propósito**. Parece la misma guardia pero
no lo es: se aplica sobre la tabla `orden` directamente (`orden.zonaId`), no sobre
`orden_incidente` a través de la relación. Meterla en `alcanceWhere` acoplaría dos criterios que
hoy coinciden en intención y difieren en forma.

---

## 2. Qué se escribió

### Repositorio — `IncidenteAdminRepository`

`findHistoricoCompleto(alcance)` y `findColaCompleta(alcance)`: cada uno es su hermano paginado
**sin `skip`/`take` y sin el `count`**, con el MISMO `where` y el MISMO `orderBy` por construcción,
no por vigilancia. UNA consulta cada uno (R15).

Las dos funciones de criterio se declaran con tipo de retorno **`Prisma.OrdenIncidenteWhereInput`
explícito**, y no es cosmético: es lo que hace que `tsc` cace una columna inexistente dentro de
ellas (medido en **M7**, §3).

### Servicio — `IncidenteAdminService`

`listarHistoricoIncidentesCompleto(actor)` y `listarPendientesIncidentesCompleto(actor)`: guard →
`resolveAlcance` (el MISMO de la página: rol + zona de la ORDEN resuelta server-side, nunca de la
entrada) → `sinZona` devuelve conjunto vacío **sin tocar la base** → el método del conjunto → tope
`descargaConfig.MAX_FILAS` evaluado aquí → `toDTO`.

**Ninguno recibe `input`, y es decisión, no olvido** — mismo criterio que las tandas B, C, D y E.
Estos listados no admiten filtros: su schema de página solo llevaba `page`/`pageSize`, y quitarlos
deja una lista blanca de **cero claves**. El borde la sigue aplicando entera —parsear ES la
barrera, medido en M16–M18— pero no hay nada que transportar hasta el servicio.

### La decisión sobre enriquecimientos: este caso **no es el de la C ni el de la D**, es un tercero

Los dos precedentes que el encargo pone delante:

- **Tanda C**: el DTO **no tenía** campo de evidencia → firmar URL era trabajo puro perdido, se
  eliminó.
- **Tanda D**: el archivo no proyecta la columna, pero saltarse `conPendiente` emitía `null`, que
  **significa «no aprobado»** → se conservó.

Aquí el campo **sí existe** (`IncidenteAdminDTO.evidenciaUrls`) y el archivo **no lo proyecta**, que
es literalmente la forma de la tanda D. Y aun así la decisión es la contraria — **el camino del
conjunto NO firma ninguna URL** — por una razón que ninguna de las dos tandas anteriores tenía:

> **No es sólo que nadie lea el resultado: es que ese resultado está PROHIBIDO en este camino.**

`incidentes-descarga-columnas.ts:9-11` lo dice por escrito y las dos pantallas lo repiten
(`IncidentesAdminModule.tsx:396-397`, `IncidentesHistoricoTabla.tsx:122-123`): **R22 de la 170** —
un `xlsx` reenviado por correo con URL firmadas dentro es acceso a las fotos sin sesión. Firmarlas
en el camino del archivo sería **fabricar ese riesgo para tirarlo a la basura una línea después**.

La regla del encargo aplicada al pie de la letra: *«saltarse trabajo solo es ahorro si nadie lee el
resultado; si alguien lee un valor por defecto que significa otra cosa, es un bug»*.

- **Nadie lo lee**: las dos filas de descarga enumeran sus columnas una a una y ninguna es de
  evidencia. Medido, no supuesto: el caso compara la proyección REAL del archivo
  (`filaDescargaIncidenteHistorico` / `…Pendiente`, el mismo módulo que usa la pantalla) entre el
  conjunto y la página, y sale idéntica.
- **Y el valor por defecto sí significaría otra cosa** si alguien lo leyera: `evidenciaUrls: []` en
  un dominio donde toda evidencia es obligatoria (1..N, R46) se leería como «este incidente no tenía
  fotos». Por eso el riesgo **se dejó ejecutable en vez de escrito**: el caso «las filas del archivo
  son las de la página en TODAS las columnas que el archivo proyecta» **se pone rojo el día que
  alguien añada una columna de evidencia al archivo**, que es exactamente el día en que saltarse las
  firmas dejaría de ser un ahorro y pasaría a ser un bug. Eso es lo que convierte esta decisión en
  una decisión y no en una apuesta.

El ahorro medido, en el mismo caso: la relectura de hoy firma **las 7 evidencias del alcance** (una
llamada al storage, con `paths.length === 7`) para producir cualquiera de los dos archivos; los dos
conjuntos firman **cero**. En producción esa llamada crece con el histórico, sin tope.

**Lo que SÍ se conserva, y por el motivo de la tanda D:** el resto de `toDTO`, incluido `esPropio`,
que lo calcula el SERVIDOR con el actor de la petición (R51 de la 158). No cuesta E/S, va en el DTO
y significa algo. Que se calcula igual en los dos caminos está afirmado —y **M15** lo mata—.

### Schemas — `lib/types/incidente.ts`

Derivados, no reescritos:

```ts
listarHistoricoIncidentesCompletoSchema  = listarHistoricoIncidentesSchema
  .omit({ page: true, pageSize: true }).strict();
listarPendientesIncidentesCompletoSchema = listarPendientesIncidentesSchema
  .omit({ page: true, pageSize: true }).strict();
```

Dos constantes y no una, aunque hoy su forma coincida: el nombre es lo único que dice cuál de las
dos mitades se pide, y si mañana una gana un filtro lo hereda aquí sin arrastrar a la otra. Y
`.strict()` se reescribe aunque `.omit()` lo herede, por el mismo motivo que en el schema de la
página.

### Bordes — `lib/actions/incidentes.ts`

`listarHistoricoIncidentesCompleto` y `listarPendientesIncidentesCompleto`, calcados de sus hermanas
paginadas: actor primero, zod después, servicio al final, todo bajo `withErrorHandler`.
`input: unknown = {}` para que la pantalla pueda llamarlas sin argumentos.

**Lo que el frontend encontrará listo (F.3):** las dos acciones devuelven
`ListarCompletoResult<IncidenteAdminDTO>` — exactamente lo que `filasDesdeResultado` sabe traducir y
lo que `filaDescargaIncidentePendiente` / `filaDescargaIncidenteHistorico` ya saben proyectar (las
dos toman `IncidenteAdminDTO`, **sin cambio de firma**).

---

## 3. Dónde vive cada test, y por qué — con la medición delante

El encargo pedía decidirlo con criterio y justificarlo. Se midió con **M7**, la mutación que en la
tanda A solo cazaba un Postgres real:

```
=== M7 (R14) el criterio del HISTORICO gana una condicion sobre una columna QUE NO EXISTE
  × la cola y el historico PARTICIONAN el conjunto: mismo criterio, uno el complemento del otro
  × los CONJUNTOS de cola e histórico de incidentes particionan el alcance con la MISMA constante (R16)
  × incidentes — historico: alcance por la zona de la ORDEN + estados fuera de la cola
  × incidentes — historico: el acceso total no emite filtro de zona
  × incidentes — histórico: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × incidentes — histórico: el acceso total NO emite filtro de zona, y el adminSatelite SÍ (R4)
  × el conjunto del archivo NO es el listado compuesto: trae UNA mitad, no las dos (R1)
  Tests  7 failed | 33 passed (40)
  --- lib/repositories/IncidenteAdminRepository.ts(88,5): error TS2353: Object literal may only
      specify known properties, and 'estadoDelIncidenteResuelto' does not exist in type
      'OrdenIncidenteWhereInput'.
  --- typecheck exit: 1
```

**Doble red, y por eso esta tanda NO añade un archivo `tests/integration/db/`:**

1. **`tsc` la caza**, como en las tandas B, C, D y E: estas consultas van por el constructor tipado
   de Prisma (`Prisma.OrdenIncidenteWhereInput`, `Prisma.OrdenIncidenteOrderByWithRelationInput`,
   `select` con `GetPayload`), no por `$queryRaw` como las de la tanda A. La columna inexistente no
   compila.
2. **Los `*-where.test.ts` también la cazan**, y con siete casos: aquí las afirmaciones son `toEqual`
   sobre el `where` entero —igualdad estricta—, así que una clave de más lo pone rojo aunque el tipo
   la permitiera.

No se encontró ninguna propiedad de estas dos consultas que un Postgres real pudiera desmentir y
estas dos no. Lo que un Postgres real sí seguiría cazando —drift entre `schema.prisma` y la base— no
lo introduce esta tanda: las columnas y la proyección son las que ya usan las dos páginas en
producción, sin un solo campo nuevo. (Este dominio **sí tiene** tests de `tests/integration/db/`
—`orden-incidente-migration`, `incidente-indemnizacion-migration`— y siguen siendo los adecuados
para lo que vigilan: la forma de la tabla, no el `where` de una lectura.)

**Lo que los dobles NO ven, y por eso está en los `*-where.test.ts`:** el `where`, el `orderBy`,
cuántas consultas se emiten y qué NO llevan.

**Lo que los `*-where.test.ts` NO ven, y por eso está en el test de servicio:** de qué método se
sirve el camino del archivo, **cuántas filas lee** y **cuántas URL firma**. Es orquestación, no SQL
— y son LAS dos propiedades de esta tanda (§4, M8 y M14).

---

## 4. Las 20 mutaciones, con su salida

Cada una: se rompe el código de verdad, se corre, se restaura **desde una copia en memoria** (nunca
`git checkout`/`restore`/`stash`: el worktree está compartido). El runner **reintenta la restauración
hasta seis veces y verifica byte a byte que el contenido volvió a ser el original**, y aborta si no
lo consigue — el incidente de la tanda D (un `writeFileSync` que falló por un lock de Windows y dejó
la mutación aplicada) está cubierto. `git status` limpio tras cada lote, verificado y pegado.

### Lote repositorio (7) — el criterio compartido y la partición

```
=== M1 (R16/R5) el conjunto del HISTORICO ordena al reves que su pagina
  × los CONJUNTOS de cola e histórico de incidentes particionan el alcance con la MISMA constante (R16)
  × incidentes — histórico: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × el conjunto del archivo NO es el listado compuesto: trae UNA mitad, no las dos (R1)
  Tests  3 failed | 37 passed (40)
=== M2 (R1/R16) el conjunto del HISTORICO deja de cortar por estado (= el listado compuesto)
  × los CONJUNTOS de cola e histórico de incidentes particionan el alcance con la MISMA constante (R16)
  × incidentes — histórico: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × incidentes — histórico: el acceso total NO emite filtro de zona, y el adminSatelite SÍ (R4)
  × el conjunto del archivo NO es el listado compuesto: trae UNA mitad, no las dos (R1)
  Tests  4 failed | 36 passed (40)
=== M3 (R15) el conjunto del HISTORICO recorta como si fuera una pagina (take: 2)
  × incidentes — histórico: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × los dos conjuntos de incidentes cuestan UNA consulta, sin recorte y sin conteo de página (R15)
  Tests  2 failed | 38 passed (40)
=== M4 (R16/R4) el criterio de la COLA deja de acotar por la zona de la ORDEN
  × incidentes — cola: alcance por la zona de la ORDEN + estado de la cola
  × incidentes — pendientes: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × los CONJUNTOS de cola e histórico de incidentes particionan el alcance con la MISMA constante (R16)
  × el conjunto del archivo NO es el listado compuesto: trae UNA mitad, no las dos (R1)
  Tests  4 failed | 36 passed (40)
=== M5 (R5/R16) el orden COMPARTIDO cambia para los CINCO caminos a la vez
  × incidentes — cola: alcance por la zona de la ORDEN + estado de la cola
  × incidentes — cola: el acceso total no emite filtro de zona
  × incidentes — pendientes: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × incidentes — historico: alcance por la zona de la ORDEN + estados fuera de la cola
  × incidentes — historico: el acceso total no emite filtro de zona
  × incidentes — histórico: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  Tests  6 failed | 34 passed (40)
=== M6 (R16/R44) el HISTORICO cambia `notIn: [cola]` por `in: ["aprobado","rechazado"]`
  × la cola y el historico PARTICIONAN el conjunto: mismo criterio, uno el complemento del otro
  × los CONJUNTOS de cola e histórico de incidentes particionan el alcance con la MISMA constante (R16)
  × incidentes — historico: alcance por la zona de la ORDEN + estados fuera de la cola
  × incidentes — historico: el acceso total no emite filtro de zona
  × incidentes — histórico: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × incidentes — histórico: el acceso total NO emite filtro de zona, y el adminSatelite SÍ (R4)
  × el conjunto del archivo NO es el listado compuesto: trae UNA mitad, no las dos (R1)
  Tests  7 failed | 33 passed (40)
=== M7 (R14) el criterio gana una condicion sobre una columna QUE NO EXISTE
  (salida completa en §3)
  Tests  7 failed | 33 passed (40)   +   typecheck exit: 1
=== arbol restaurado
```

**M4 y M6 son los dos lados feos de este repositorio**, y merecen leerse juntos:

- **M4** quita el alcance del criterio de la cola sin tocar el del histórico: el archivo de
  «Incidentes pendientes» de un `adminSatelite` traería **los incidentes de todas las zonas**, con
  la causa, el destinatario y el motivo de cada uno. Es la fuga de R4 en su forma más directa, y la
  cazan cuatro casos —dos de página y dos de conjunto— porque el criterio es uno solo.
- **M6** sustituye el `notIn` del histórico por `in: ["aprobado","rechazado"]`: hoy da lo mismo,
  pero el día que el enum `CierreEstado` gane un estado, ese estado **desaparece de las dos mitades**
  en vez de caer en el histórico. Es exactamente el defecto que la 170 documentó al crear estos
  archivos, y por eso los casos de la 170 caen junto a los míos.

**M5 es la contraprueba de que compartir el orden no lo vuelve invisible**, con cinco caminos
colgando de una constante: caen seis afirmaciones, cuatro de páginas que existían desde la 170.

### Lote servicio (8) — de qué se sirve el archivo, cuánto lee, cuánto firma

```
=== M8 (R1) el conjunto del HISTORICO vuelve a servirse del COMPUESTO y parte en memoria
  × el conjunto de la descarga NO relee el listado compuesto: pide su mitad y sólo su mitad (R1)
  Tests  1 failed | 78 passed (79)
=== M9 (R6) el tope del HISTORICO se corre una fila: >= en vez de >
  × con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)
  Tests  1 failed | 78 passed (79)
=== M10 (R6) el tope del HISTORICO TRUNCA en vez de rechazar
  × con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)
  Tests  1 failed | 7 passed (8)      ← medido a solas: el diff de 5000 filas tapa el resumen del lote
=== M11 (R4) el guard de rol del HISTORICO se evalua DESPUES del repositorio
  × un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)
  × el adminSatelite SIN zona recibe un conjunto vacío y no consulta la base (R4)
  Tests  2 failed | 77 passed (79)
=== M12 (R4) sin zona, el HISTORICO consulta igual
  × el adminSatelite SIN zona recibe un conjunto vacío y no consulta la base (R4)
  Tests  1 failed | 78 passed (79)
=== M13 (R5) el conjunto del HISTORICO se sirve del metodo PAGINADO con take: 2
  × el alcance sale del ACTOR, no de la entrada: cada admin descarga LO SUYO (R4)
  × el conjunto de la descarga NO relee el listado compuesto: pide su mitad y sólo su mitad (R1)
  × el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)
  × las filas del archivo son las de la página en TODAS las columnas que el archivo proyecta
  × con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)
  Tests  5 failed | 74 passed (79)
=== M14 (enriquecido) el conjunto de la COLA vuelve a FIRMAR las URL como la pagina
  × el conjunto NO firma NINGUNA URL de evidencia: el archivo no las lleva (R22 de la 170)
  Tests  1 failed | 78 passed (79)
=== M15 (R5/mapper) el conjunto del HISTORICO calcula `esPropio` con OTRO usuario
  × las filas del archivo son las de la página en TODAS las columnas que el archivo proyecta
  Tests  1 failed | 78 passed (79)
=== arbol restaurado
```

**M8 es LA mutación de esta tanda, y merece leerse dos veces.** El código mutado vuelve a
`findByAlcance` y parte en memoria con `esColaSolicitado` — es decir, deshace exactamente lo que la
tanda entrega. Y produce **las mismas filas, en el mismo orden, con el mismo total**: el corte en
memoria y el corte en la base seleccionan lo mismo. Es indistinguible por cualquier test que mire el
resultado… y de hecho **78 de los 79 casos siguen verdes**.

La caza un solo caso, y por una vía que había que construir a propósito, tal como avisaba el
encargo: el repositorio en memoria de la suite anota **cuántas filas devolvió cada llamada**, no
solo cuál fue. El caso afirma `llamadas === ["findHistoricoCompleto"]` y `filasLeidas === [5]`. La
**anti-vacuidad** vive en el mismo caso: la relectura que esta tanda sustituye se ejecuta también
—`listarIncidentes(MAESTRO)`— y se afirma que lee **7** (`llamadas === ["findByAlcance"]`,
`filasLeidas === [7]`). Sin esa mitad, un servicio que no leyera nada pasaría igual.

**M13 existe por el aviso de las tandas C/D/E: cuidado con el killer que depende del fixture.**
Servirse del método paginado con el `take` real (25) y cinco filas de almacén habría dejado R5 vivo,
porque la página 1 *sería* el conjunto entero. Se ejecutó directamente con **`take: 2`**, y ahí caen
cinco casos, incluido el de R5. El caso de R5 recorre además las páginas con `pageSize: 2` por el
mismo motivo, y lleva su propia anti-vacuidad (`expect(items.length).toBeGreaterThan(2)`: son TRES
páginas, no una).

**M14 es la mutación INVERSA, y es la que hace de la decisión sobre enriquecimientos algo
verificable.** No rompe el código quitando trabajo: lo rompe **volviendo a añadirlo**. Reintroduce
el `firmar()` en el camino de la cola —exactamente lo que haría alguien «igualando» el conjunto a su
página sin leer R22— y muere. Sin ella, «no firmamos» sería una frase de esta bitácora en vez de una
propiedad del sistema.

**M15 se aplicó a `esPropio` a propósito**, para medir el hueco que la tanda E documentó como
mutante equivalente: allí el mapper era la identidad y saltárselo no mataba nada. Aquí `toDTO` NO es
la identidad, y para que su tercer argumento estuviera vigilado hubo que **fortalecer un caso antes
de mutar**: la comparación conjunto↔página pasó de mirar solo las columnas del archivo a mirar el
DTO entero **salvo `evidenciaUrls`**, que es la única diferencia deliberada. Con la comparación
débil M15 sobrevivía; con la fuerte muere. **Esta tanda no tiene ningún superviviente.**

### Lote borde (5) — la lista blanca derivada

```
=== M16 (R17) el borde del HISTORICO usa el schema de la PAGINA en vez del derivado
  × una clave no declarada muere con validation_error sin tocar el service (R17)
  Tests  1 failed | 83 passed (84)
=== M17 (R17) el borde de PENDIENTES no parsea la entrada
  × una clave no declarada muere con validation_error sin tocar el service (R17)
  Tests  1 failed | 83 passed (84)
=== M18 (R17) el schema derivado del HISTORICO deja de ser estricto (.strict -> .passthrough)
  × una clave no declarada muere con validation_error sin tocar el service (R17)
  Tests  1 failed | 83 passed (84)
=== M19 (R7) el borde del HISTORICO valida ANTES de resolver el actor
  × el actor se resuelve ANTES de validar: sin sesión no se filtra la lista blanca
  Tests  1 failed | 83 passed (84)
=== M20 (borde) el borde del HISTORICO deja de admitir la llamada SIN entrada
  × sin entrada, o con un objeto vacío, delega en el service con SOLO el actor
  Tests  1 failed | 83 passed (84)
=== arbol restaurado
```

**M16 es la que justifica que el schema se DERIVE.** Con la lista blanca copiada a mano del listado
paginado, `page: 2` y `pageSize: 100` pasarían: son claves que la página acepta y el conjunto no
debe. El caso las prueba explícitamente, junto a `zonaId` y `estado`, que son las que convertirían
el archivo de un `adminSatelite` en el de la zona vecina. **M17 se aplicó al borde de PENDIENTES a
propósito**, para que el lote no midiera solo uno de los dos.

**Resultado: 20 mutaciones, 20 rojas. Ninguna sobrevivió**, así que no hay código propio sin vigilar
que retirar (el encargo pedía retirarlo, no comentarlo, si lo hubiera) ni mutante equivalente que
declarar.

---

## 5. Archivos

**Nuevos (2)**

- `tests/unit/services/incidentes-completo.test.ts` — 8 casos (incluye el contador de filas leídas
  con su anti-vacuidad, y el espía de firmas con la suya en TRES mitades).
- `tests/unit/actions/incidentes-descarga-action.test.ts` — 6 casos, **los dos bordes en cada uno**.

**Modificados — producción (6)**

- `lib/repositories/IncidenteAdminRepository.ts` — `ORDEN_INCIDENTES_ADMIN`,
  `historicoIncidentesWhere`, `colaIncidentesWhere` (una declaración cada uno), **los dos métodos
  nuevos** y las dos copias a mano de `alcanceWhere` dentro de `resolver` sustituidas por la función.
- `lib/interfaces/repositories/IIncidenteAdminRepository.ts` — sus dos contratos.
- `lib/services/IncidenteAdminService.ts` — los dos métodos del conjunto y `SIN_URLS_FIRMADAS`.
- `lib/interfaces/services/IIncidenteAdminService.ts` — sus dos contratos y sus dos result types.
- `lib/types/incidente.ts` — los dos schemas derivados y los dos `…CompletoResult`.
- `lib/actions/incidentes.ts` — los dos bordes.

**Modificados — tests (4)**

- `tests/unit/repositories/historicos-paginados-where.test.ts` — +4 casos (20 → 24).
- `tests/unit/repositories/colas-paginadas-where.test.ts` — +2 casos (14 → 16).
- `tests/unit/services/incidente-admin-service.test.ts` y
  `tests/unit/services/indemnizacion-tope-negocio-incidente.test.ts` — sus dobles ganan los dos
  métodos como no-op. **Es el único peaje de tipos de esta tanda**, y son dos suites: las otras tres
  que doblan este repositorio usan `as unknown as`, así que no lo notan. Lo cobra `tsc`, no un rojo
  tardío.

**Cero** cambios en `app/**`, `components/**`, `db/migrations/`, RLS, esquema, `feature_list.json`
y la configuración de `useSWR` de ninguna pantalla (R33).

**Peaje de los `vi.mock` ajenos: CERO en esta tanda.** Ninguna pantalla importa todavía las acciones
nuevas: eso es F.3. Se comprobó ejecutando las dieciocho suites que mockean, renderizan o censan
este dominio: **343 casos, todos verdes**. **Quien haga F.3 sí lo pagará** (§9).

---

## 6. Mapa `R<n>` → archivo + nombre del caso

Construido **leyendo el caso**, no contando `R\d+` en títulos: varios casos cubren un requisito sin
nombrarlo y varios títulos de los archivos vecinos citan requisitos de la **feature 170** (`R22`,
`R40`, `R41`, `R44`, `R51`, `R54`) y de la **158** (`R46`, `R48`, `R49`), cuyos espacios de nombres
se cruzan con el de ésta.

| R | Archivo | Caso | Estado |
| --- | --- | --- | --- |
| R1 | `tests/unit/services/incidentes-completo.test.ts` + `tests/unit/repositories/historicos-paginados-where.test.ts` | **«el conjunto de la descarga NO relee el listado compuesto: pide su mitad y sólo su mitad (R1)»** (llamadas + filas leídas, con la anti-vacuidad de la relectura de hoy: 7 filas) y «el conjunto del archivo NO es el listado compuesto: trae UNA mitad, no las dos (R1)» (el `where` del compuesto no lleva `estado`). Killers: **M2**, **M8** | backend ✔; que la PANTALLA lo use es **F.3** |
| R2 | `…/incidentes-completo.test.ts` | «el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)» + «las filas del archivo son las de la página en TODAS las columnas que el archivo proyecta» (el servidor entrega el conjunto ya resuelto; el servicio no reordena ni recorta) | backend ✔ (la mitad de cliente, en F.3) |
| R3 | `tests/unit/actions/incidentes-descarga-action.test.ts` | «una clave no declarada muere con validation_error sin tocar el service (R17)» | ✔ **con matiz**: estos listados NO tienen filtros, así que «los filtros vigentes» es siempre el alcance entero del actor. Lo afirmable es que ninguna clave puede viajar |
| R4 | `…/incidentes-completo.test.ts` | «un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)» (4 roles × 2 listados, cero llamadas) + «el alcance sale del ACTOR, no de la entrada: cada admin descarga LO SUYO (R4)» (maestro ≡ admin ≡ las dos zonas; `adminSatelite` de `z-1` con conjuntos DISJUNTOS; aridad 1 de los dos métodos) + «el adminSatelite SIN zona recibe un conjunto vacío y no consulta la base (R4)». En repositorio, «incidentes — histórico: el acceso total NO emite filtro de zona, y el adminSatelite SÍ (R4)». Killers: **M4**, **M11**, **M12**, **M13** | ✔ |
| R5 | `tests/unit/repositories/{historicos-paginados,colas-paginadas}-where.test.ts` | «incidentes — histórico / pendientes: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)». Más, en servicio, «el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)» — con `pageSize: 2`, killer medido **M13**; y «las filas … campo por campo», killer **M15** | ✔ |
| R6 | `…/incidentes-completo.test.ts` | «con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)» (borde exacto por arriba y por abajo, **para cada uno de los dos listados**) + en el borde, «limite_excedido del service pasa tal cual: conteos y NINGUNA fila (R6)». Killers: **M9**, **M10** | ✔ |
| R7 | `tests/unit/actions/incidentes-descarga-action.test.ts` | «sin sesión devuelve unauthenticated y ninguna fila, sin tocar el service (R7)» + «forbidden del service pasa tal cual, sin filas ni total (R7)» + «el actor se resuelve ANTES de validar: sin sesión no se filtra la lista blanca» (killer **M19**). El mensaje al usuario lo redacta el adaptador, y sus casos ya existen | backend ✔ |
| R8 | — | es de pantalla (montar no llama a la acción del conjunto) | **F.3** |
| R9 | `…/incidentes-completo.test.ts` | R9 es de la tanda C **por nombre** (listado 1), pero su propiedad —«el conjunto no firma ninguna URL de evidencia»— aplica aquí **con más motivo**: **«el conjunto NO firma NINGUNA URL de evidencia: el archivo no las lleva (R22 de la 170)»**, espía en 0 con anti-vacuidad de tres mitades (la página firma 1 vez con los 5 paths exactos y SÍ lleva las URL; la relectura de hoy firma las 7). Killer: **M14** | ✔ (extendido) |
| R12 | — | columnas y textos del archivo: no se tocan. `incidentes-descarga-columnas.ts` no se modificó y `ControlDescargaTransversal.test.tsx` sigue verde. Las dos filas de descarga siguen tomando `IncidenteAdminDTO`, así que F.3 no cambia firmas | ✔ sin cambios |
| R13 | `tests/components/paginacion/paginacion-transversal.test.tsx` | los listados 8 y 9 **siguen** declarados `conjunto` y siguen en `PENDIENTES_184`, porque sus pantallas no han migrado: el censo pasa sin tocarlo. Sacarlos es F.4, en el mismo commit que F.3 | ✔ |
| R14 | `historicos-paginados-where.test.ts` + `colas-paginadas-where.test.ts` | «incidentes — histórico: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)» y su gemelo de pendientes — ejecutan el repositorio REAL y afirman sobre los ARGUMENTOS de la consulta. Un caso por método nuevo. Killer del tipo «columna que no existe»: **M7** (rojo en tests **y** en `tsc`) | ✔ |
| R15 | `historicos-paginados-where.test.ts` | «los dos conjuntos de incidentes cuestan UNA consulta, sin recorte y sin conteo de página (R15)» — killer **M3** | ✔ |
| R16 | los dos `*-where.test.ts` | los dos casos de R14 (mismas condiciones y mismo orden) + **«los CONJUNTOS de cola e histórico de incidentes particionan el alcance con la MISMA constante (R16)»**, que es la mitad que solo se ve mirando las dos a la vez. La otra mitad de R16 —«no hay dos declaraciones del mismo criterio»— se cumple por construcción (`ORDEN_INCIDENTES_ADMIN`, `historicoIncidentesWhere`, `colaIncidentesWhere`, `alcanceWhere`) y se midió con **M4**, **M5** y **M6** | ✔ |
| R17 | `tests/unit/actions/incidentes-descarga-action.test.ts` | «una clave no declarada muere con validation_error sin tocar el service (R17)» — seis entradas × **dos** bordes; incluye `page`/`pageSize`, que es lo que hace de la lista blanca una DERIVADA, y `zonaId`/`estado`, que son las que importan. Killers: **M16**, **M17**, **M18** | ✔ |
| R33 | — | no se tocó la configuración de `useSWR` de ninguna pantalla (cero archivos `app/**` modificados) | ✔ |
| R34 | este archivo | el mapa de arriba | ✔ |

**Requisitos que NO se pueden cubrir aquí, con su motivo:** R1 (mitad de pantalla), R2 (mitad de
cliente) y R8 son de **pantalla**, y salen en F.3. R13/R29–R32 son de **censo**
(`paginacion-transversal`, `adaptador-conjunto.guardia`) y salen en F.4 y en la tanda H. **R10** es
de la tanda B (los agregados de la consolidación) y **R11** del listado 10; ninguno aplica a estos
dos listados —el camino del archivo no agrega dinero ni filtra en el navegador—. **R18–R28** son la
poda de la selección satélite, cerrada en la tanda A.

---

## 7. Puertas (medición real)

```
$ pnpm run typecheck
> tsc --noEmit
=== typecheck exit: 0 ===

$ pnpm exec vitest run <mis 4 archivos + las 14 suites vecinas del dominio, pantallas incluidas>
 Test Files  18 passed (18)
      Tests  343 passed (343)
   Duration  10.07s

$ pnpm exec vitest run guard
 Test Files  61 passed (61)
      Tests  830 passed (830)
   Duration  6.60s

$ pnpm exec eslint .
✖ 44 problems (0 errors, 44 warnings)
```

**Rojos: cero, ni propios ni ajenos.** Tampoco aparecieron los rojos de contención avisados
(`LoginForm`, `RegistrarPagoDialog`): no entran en los archivos que corrí.

Las **44 warnings de lint son AJENAS y PREEXISTENTES**: es el mismo número que midieron
`chore_deuda_170.md §6` (2026-08-03) y las tandas A, B, C, D y E sobre el árbol limpio. En los doce
archivos que toqué, `eslint` reporta **4 warnings**, las cuatro del helper `delegado` de los dos
`*-where.test.ts` (`_args` sin usar), que existían antes de esta tanda. **Delta propio: cero.**

**La suite completa NO se corre aquí**: el gate (`./init.sh`) lo corre el LEADER.

---

## 8. Hallazgo para F.3 / la tanda H: qué queda sin consumidores y qué NO

Medido hoy contra el árbol: la acción `listarIncidentes()` tiene **exactamente tres consumidores de
producción** — `app/(app)/incidentes/page.tsx` (que sigue necesitando `sinZona`, dato de pantalla
que solo viaja por ahí), `IncidentesAdminModule.tsx:404-412` y `IncidentesHistoricoTabla.tsx:127-135`
(las dos descargas que esta tanda sustituye).

**En cuanto F.3 aterrice, `listarIncidentes` pierde DOS de sus tres consumidores pero NO se queda
sin ninguno**, a diferencia de lo que la tanda E encontró con `listarCierresBodegaAdmin`. Sigue
siendo la única fuente de `sinZona` para el Server Component. **No es candidata a retirada en la
tanda H**, y conviene que quede escrito para que nadie la borre por analogía con el caso de la E.

Lo mismo vale para `findByAlcance` en el repositorio y `listarIncidentes` en el servicio: los
sostiene ese tercer consumidor. Y la anti-vacuidad del caso de R1 se apoya precisamente en
ejecutarlos y contar sus 7 filas.

---

## 9. Qué queda, y para quién

| Tarea | De quién | Qué falta exactamente |
| --- | --- | --- |
| **F.3** | frontend | `IncidentesAdminModule.tsx` (`:402-413`) e `IncidentesHistoricoTabla.tsx` (`:125-136`): `obtenerFilas` pasa de `filasDelConjuntoCompleto(listarIncidentes().then(res => ({status:"ok", items: res.pendientes})), filaDescargaIncidentePendiente)` a `filasDesdeResultado(listarPendientesIncidentesCompleto(), filaDescargaIncidentePendiente)`, y su gemelo con `listarHistoricoIncidentesCompleto` / `filaDescargaIncidenteHistorico`. Las dos filas de descarga **no cambian de firma**: siguen tomando `IncidenteAdminDTO` |
| **F.4** | frontend | listados 8 y 9 a `adaptador: "completo"` y fuera de `PENDIENTES_184`, en el MISMO commit que F.3 |

**Aviso para F.3 (peaje del `vi.mock`):** en cuanto las dos pantallas importen las acciones nuevas,
todo archivo de test que haga `vi.mock("@/lib/actions/incidentes", …)` con factoría y renderice esas
pantallas revienta al importarlas si no declara los exports nuevos. Los **nueve** candidatos medidos
hoy son `tests/components/descarga/IncidentesDescarga.test.tsx`,
`tests/components/IncidentesAdminModule.test.tsx`, `tests/components/IncidentesAdminR51.test.tsx`,
`tests/components/IncidentesPage.test.tsx`, `tests/components/paginacion/ColasPaginacion.test.tsx`,
`tests/components/paginacion/BajoRiesgoPaginacion.test.tsx`,
`tests/components/RecepcionSateliteIncidente.test.tsx`,
`tests/components/ReportarIncidenteAccion.test.tsx` y
`tests/components/ReportarIncidenteModal.test.tsx`. Es peaje esperado, no regresión; los cuatro
últimos solo lo pagarán si renderizan alguna de las dos pantallas.

**Y una cosa que F.3 NO debe hacer:** «igualar» el conjunto a su página añadiéndole las URL
firmadas. Es lo que mide **M14** y lo que R22 de la 170 prohíbe. Si algún día el archivo tiene que
llevar evidencia, el cambio es de columnas **y** de servicio a la vez, y el caso «las filas del
archivo son las de la página en TODAS las columnas que el archivo proyecta» avisará.

---

## 10. Nota de proceso: el worktree sigue compartido

Se respetó la regla entera: **ninguna orden de git sin ruta explícita**, ningún `--amend`, ningún
`stash`. El runner de mutaciones restaura **desde una copia en memoria**, reintenta hasta seis veces
y **verifica que el contenido volvió a ser el original**, abortando si no lo consigue; se comprobó
`git status` limpio tras cada uno de los tres lotes.

Un incidente propio, y se corrigió: el primer pase del lote de repositorio usó
`vitest --reporter=basic`, que **no existe en vitest 4**, así que las siete corridas fallaron al
arrancar y el runner las reportó como «(sin resumen)» — es decir, **siete mutaciones que parecían
ejecutadas y no habían corrido ni un test**. Se detectó porque ninguna listó casos rojos, se arregló
el flag y se repitió el lote entero. Queda escrito porque una mutación que «no mata» por un flag mal
puesto se lee igual que una mutación que no mata por un hueco de cobertura.

Los archivos del otro agente (`app/(app)/cierres-admin/_components/CierresBodegaResueltosTabla.tsx`
y `app/(app)/cierres-admin/page.tsx`, que aparecieron modificados a mitad de la tanda) **no se
tocaron ni se commitearon**.
