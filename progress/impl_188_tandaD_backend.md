# 184 — la parte BACKEND de la Tanda D (listados 2 y 3: «Cierres del día» del admin)

> Rama: `feature/184-deuda-170-listados` · Fecha: 2026-08-04 · Rol: BACKEND_DEV
>
> Alcance entregado: **D.1 y D.2**. `app/**` y `components/**` NO se tocan: D.3 (las dos
> pantallas) y D.4 (el censo) son del frontend y cierran la tanda.
>
> **Veredicto en una línea: los dos listados del admin dejan de descargar el alcance entero para
> quedarse con una mitad —de 7 filas leídas para producir 5, a 5— y esta vez SÍ hicieron falta
> métodos de repositorio nuevos, con el dato delante; 19 mutaciones ejecutadas, las 19 rojas.**

---

## 1. Lo primero que se midió: ¿hacían falta métodos nuevos de verdad?

El encargo pedía comprobarlo, porque el inventario se había quedado corto **en la dirección
contraria** dos veces (las tandas B y C no escribieron ni un método). Aquí el inventario acierta,
y la razón se ve en una tabla:

| Método de `CierresAdminRepository` | Qué `where` emite | ¿Sirve como conjunto del listado 2 o del 3? |
| --- | --- | --- |
| `findCierresByAlcance(alcance)` | `alcanceWhere(alcance)`, **sin corte por estado** | **No.** Devuelve la UNIÓN de la cola y el histórico |
| `findHistoricoPaginado(alcance, rango)` | `alcance` + `estado notIn cola` + `skip`/`take` + `count` | No: es una página |
| `findColaPaginada(alcance, rango)` | `alcance` + `estado in cola` + `skip`/`take` + `count` | No: es una página |
| `findCierreByIdEnAlcance` / `findGestionesIncidenteDelCierre` / `resolverCierre` / `forzarSolicitudVencido` | otro grano (un cierre, sus gestiones, escrituras) | No |

**Los siete métodos del repositorio, y ninguno devuelve ninguno de los dos conjuntos.** La única
lectura sin recorte es `findCierresByAlcance`, y **no es este conjunto: es este conjunto MÁS el
otro listado de la misma pantalla.** Por eso el servicio la parte en memoria con `esColaCierreDia`
(`CierresAdminService.ts:149`), y por eso el Anexo A mide el coste de estos dos listados como
«trae cola + histórico del alcance entero».

Reusarla habría dejado el archivo saliendo de un listado compuesto, que es exactamente lo que R1
prohíbe. Se escribieron **`findHistoricoCompleto(alcance)`** y **`findColaCompleta(alcance)`**.

**El dato, medido en el test** (`cierres-admin-completo.test.ts`, caso de R1, sobre el almacén de
la suite y para el actor `maestro`): la relectura de hoy lee **7 filas** (5 del histórico + 2 de la
cola) para producir cualquiera de los dos archivos; la lectura dedicada lee **5** para el histórico
y **2** para la cola. En producción esa proporción es mucho peor en un sentido concreto: la cola
son los cierres sin resolver —una decena— y el histórico crece sin tope con los días, así que
descargar la cola arrastraba todo el histórico del alcance.

### Y aun así, lo de las tandas B y C también pasaba aquí

El encargo avisaba de que en B y C lo que faltaba no era un método sino **una sola declaración del
criterio**. Eso estaba pasando aquí también, y la tanda lo habría empeorado:

| Declaración | Antes | Ahora |
| --- | --- | --- |
| `orderBy: { solicitadoAt: "desc" }` | escrito **tres** veces (`findCierresByAlcance`, `findHistoricoPaginado`, `findColaPaginada`); con los dos métodos nuevos habrían sido **cinco** | `ORDEN_CIERRES_ADMIN`, **una** vez, leída por los cinco caminos |
| `alcance + estado notIn cola` | inline en `findHistoricoPaginado`; el conjunto habría sido la **segunda** copia | `historicoWhere(alcance)`, **una** vez |
| `alcance + estado in cola` | inline en `findColaPaginada`; ídem | `colaWhere(alcance)`, **una** vez |

Cero cambios de comportamiento: los 22 casos previos de los dos `*-where.test.ts` siguen verdes
sin tocarse, incluidos los que fijan `where` y orden en valores **absolutos**. Contraprueba
medida: **M6** (cambiar la constante compartida pone rojas seis afirmaciones a la vez, las de la
página y las del conjunto). Una declaración única no es una declaración sin vigilar.

---

## 2. Qué se escribió

### Repositorio — `CierresAdminRepository`

`findHistoricoCompleto(alcance)` y `findColaCompleta(alcance)`: cada uno es su hermano paginado
**sin `skip`/`take` y sin el `count`**, con el MISMO `where` y el MISMO `orderBy` por
construcción, no por vigilancia. UNA consulta cada uno (R15).

Las dos funciones de criterio se declaran con tipo de retorno **`Prisma.CierreDiaWhereInput`
explícito**, y no es cosmético: es lo que hace que `tsc` cace una columna inexistente dentro de
ellas (medido en **M7**, §4).

### Servicio — `CierresAdminService`

`listarHistoricoCierresAdminCompleto(actor)` y `listarPendientesCierresAdminCompleto(actor)`:
guard de rol ANTES del repositorio → `resolveAlcance` (el MISMO de la página: rol + zona destino,
nunca de la entrada) → el método del conjunto → tope `descargaConfig.MAX_FILAS` evaluado aquí →
`conPendiente`.

**Ninguno recibe `input`, y es decisión, no olvido** — mismo criterio que las tandas B y C. Estos
listados no admiten filtros: su schema de página solo llevaba `page`/`pageSize`, y quitarlos deja
una lista blanca de **cero claves**. El borde la sigue aplicando entera —parsear ES la barrera,
medido en M15–M17— pero no hay nada que transportar hasta el servicio.

**El conjunto SÍ pasa por `conPendiente`, y esa es la decisión no obvia de esta tanda.** El
archivo no lleva la columna del pendiente (`cierres-admin-descarga-columnas.ts` no la proyecta en
ninguna de sus dos filas), así que la tentación —y el precedente de las tandas B y C, que quitaron
trabajo no consumido— era saltárselo. Se descartó con un motivo concreto:

- `pendientePagoMensajero` **está en el DTO** y significa algo: `null` es «este cierre NO está
  aprobado» (172/R28), que es distinto de `"0.00"`. Emitir `null` en cierres aprobados sería un
  **dato equivocado en un DTO de dinero**, no trabajo ahorrado. La diferencia con la tanda C es
  exacta: allí el `CierrePasadoDTO` **no tenía** campo de evidencia, así que firmar URL era trabajo
  del que no se consumía nada; aquí el campo existe.
- El coste es **UNA agregación para todo el conjunto**, no una por fila: `conPendiente` llama
  `sumarVigentesPorCierre` una sola vez, la misma llamada que ya hace la página. Medido en el caso
  «el conjunto NO firma ninguna URL de evidencia ni recalcula dinero»
  (`toHaveBeenCalledTimes(1)`).
- Y así las filas del archivo son **las mismas que las de la página, campo por campo**, que es lo
  que R5 pide en su forma fuerte. Killer medido: **M14**.

### Schemas — `lib/types/cierres-admin.ts`

Derivados, no reescritos:

```ts
listarHistoricoCierresAdminCompletoSchema  = listarHistoricoCierresAdminSchema
  .omit({ page: true, pageSize: true }).strict();
listarPendientesCierresAdminCompletoSchema = listarPendientesCierresAdminSchema
  .omit({ page: true, pageSize: true }).strict();
```

Dos constantes y no una, aunque hoy su forma coincida: es el mismo motivo por el que sus dos
schemas de página se declararon aparte en la 170 —el nombre es lo único que dice cuál de las dos
mitades se pide—. Y `.strict()` se reescribe aunque `.omit()` lo herede, por el mismo motivo que
en el schema de la página.

### Bordes — `lib/actions/cierres-admin.ts`

`listarHistoricoCierresAdminCompleto` y `listarPendientesCierresAdminCompleto`, calcados de sus
hermanas paginadas: actor primero, zod después, servicio al final, todo bajo `withErrorHandler`.
`input: unknown = {}` para que la pantalla pueda llamarlas sin argumentos.

**Lo que el frontend encontrará listo (D.3):** las dos acciones devuelven
`ListarCompletoResult<CierreAdminResumen>` — exactamente lo que `filasDesdeResultado` sabe
traducir y lo que `filaDescargaCierreHistorico` / `filaDescargaCierrePendiente` ya saben proyectar
(las dos toman `CierreAdminResumen`, sin cambio de firma).

---

## 3. Dónde vive cada test, y por qué — con la medición delante

El encargo pedía decidirlo con criterio y justificarlo. Se midió con **M7**, la mutación que en la
tanda A solo cazaba un Postgres real:

```
=== M7 (R14) el criterio del historico gana una condicion sobre una columna QUE NO EXISTE
  × la cola y el historico PARTICIONAN el conjunto: mismo criterio, uno el complemento del otro
  × los CONJUNTOS de cola e histórico particionan el alcance con la MISMA constante (R16)
  × cierres del dia — historico: alcance + estados fuera de la cola, mismo where en pagina y conteo
  × cierres del dia — historico: el acceso total NO emite destinoZonaId (ve toda la central)
  × cierres del día — histórico: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × cierres del día — histórico: el acceso total NO emite destinoZonaId, pero SÍ el tipo de bodega (R4)
  × el conjunto del archivo NO es el listado compuesto: trae UNA mitad, no las dos (R1)
  Tests  7 failed | 22 passed (29)
--- typecheck:
  lib/repositories/CierresAdminRepository.ts(360,5): error TS2353: Object literal may only specify
    known properties, and 'estadoDelCierreResuelto' does not exist in type 'CierreDiaWhereInput'.
  typecheck exit: 2
```

**Doble red, y por eso esta tanda NO añade un archivo `tests/integration/db/`:**

1. **`tsc` la caza**, como en las tandas B y C: estas consultas van por el constructor tipado de
   Prisma (`Prisma.CierreDiaWhereInput`, `Prisma.CierreDiaOrderByWithRelationInput`, `select` con
   `GetPayload`), no por `$queryRaw` como las de la tanda A. La columna inexistente no compila.
2. **Los `*-where.test.ts` también la cazan**, y con siete casos: aquí las afirmaciones son
   `toEqual` sobre el `where` entero —igualdad estricta—, así que una clave de más lo pone rojo
   aunque el tipo la permitiera.

No se encontró ninguna propiedad de estas dos consultas que un Postgres real pudiera desmentir y
estas dos no. Lo que un Postgres real sí seguiría cazando —drift entre `schema.prisma` y la base—
no lo introduce esta tanda: las columnas y el índice `[destinoTipo, destinoZonaId]` son los que ya
usan las dos páginas en producción.

**Lo que los dobles NO ven, y por eso está en los `*-where.test.ts`:** el `where`, el `orderBy`,
cuántas consultas se emiten y qué NO llevan.

**Lo que los `*-where.test.ts` NO ven, y por eso está en el test de servicio:** de qué método se
sirve el camino del archivo. Es orquestación, no SQL — y es LA propiedad de esta tanda (§4, M8).

---

## 4. Las 19 mutaciones, con su salida

Cada una: se rompe el código de verdad, se corre, se restaura **desde una copia en memoria**
(nunca `git checkout`/`restore`: el worktree está compartido). Ninguna quedó aplicada; `git status`
limpio al final, verificado.

### Lote repositorio (7) — el criterio compartido y la partición

```
=== M1 (R16/R5) el conjunto del historico ordena al reves que su pagina
  × los CONJUNTOS de cola e histórico particionan el alcance con la MISMA constante (R16)
  × cierres del día — histórico: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × el conjunto del archivo NO es el listado compuesto: trae UNA mitad, no las dos (R1)
  Tests  3 failed | 26 passed (29)
=== M2 (R16/R4) el conjunto del historico deja de acotar por alcance
  × los CONJUNTOS de cola e histórico particionan el alcance con la MISMA constante (R16)
  × cierres del día — histórico: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × cierres del día — histórico: el acceso total NO emite destinoZonaId, pero SÍ el tipo de bodega (R4)
  × el conjunto del archivo NO es el listado compuesto: trae UNA mitad, no las dos (R1)
  Tests  4 failed | 25 passed (29)
=== M3 (R15) el conjunto del historico recorta como si fuera una pagina
  × cierres del día — histórico: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × los dos conjuntos del admin cuestan UNA consulta, sin recorte y sin conteo de página (R15)
  Tests  2 failed | 27 passed (29)
=== M4 (R1) el conjunto del historico vuelve a leer el listado COMPUESTO (sin corte por estado)
  × los CONJUNTOS de cola e histórico particionan el alcance con la MISMA constante (R16)
  × cierres del día — histórico: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × cierres del día — histórico: el acceso total NO emite destinoZonaId, pero SÍ el tipo de bodega (R4)
  × el conjunto del archivo NO es el listado compuesto: trae UNA mitad, no las dos (R1)
  Tests  4 failed | 25 passed (29)
=== M5 (R16) el corte de la COLA deja de leer la constante compartida y pierde `vencido`
  × cierres del dia — cola: alcance + estados DE la cola, mismo where en pagina y conteo
  × cierres del dia — cola: el acceso total NO emite destinoZonaId (ve toda la central)
  × la cola y el historico PARTICIONAN el conjunto: mismo criterio, uno el complemento del otro
  × cierres del día — cola: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × los CONJUNTOS de cola e histórico particionan el alcance con la MISMA constante (R16)
  × cierres del día — cola: el acceso total NO emite destinoZonaId, pero SÍ el tipo de bodega (R4)
  Tests  6 failed | 23 passed (29)
=== M6 (R5/R16) el orden COMPARTIDO cambia para los cinco caminos a la vez
  × cierres del dia — cola: alcance + estados DE la cola, mismo where en pagina y conteo
  × cierres del dia — cola: el acceso total NO emite destinoZonaId (ve toda la central)
  × cierres del día — cola: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × cierres del dia — historico: alcance + estados fuera de la cola, mismo where en pagina y conteo
  × cierres del dia — historico: el acceso total NO emite destinoZonaId (ve toda la central)
  × cierres del día — histórico: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  Tests  6 failed | 23 passed (29)
=== M7 (R14) el criterio gana una condicion sobre una columna QUE NO EXISTE
  (salida completa en §3)
  Tests  7 failed | 22 passed (29)   +   typecheck exit: 2
=== arbol restaurado
```

**M5 es el lado feo de la partición.** Sustituir la constante compartida por `["solicitado"]` en la
cola deja `vencido` fuera de las dos mitades: no está en el `in` de la cola ni fuera del `notIn`
del histórico. Un cierre vencido que se cae de las dos pantallas —y ahora también de los dos
archivos— deja la bodega de su mensajero bloqueada sin que nadie lo vea. Seis casos lo dicen.

**M6 es la contraprueba de que compartir el orden no lo vuelve invisible**, y esta vez con cinco
caminos colgando de una constante.

### Lote servicio (7) — de qué se sirve el archivo, el tope y el alcance

```
=== M8 (R1) el conjunto del historico vuelve a servirse del listado COMPUESTO y parte en memoria
  × el conjunto de la descarga NO relee el listado compuesto: pide su mitad y sólo su mitad (R1)
  Tests  1 failed | 84 passed (85)
=== M9 (R6) el tope del historico se corre una fila: >= en vez de >
  × con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)
  Tests  1 failed | 84 passed (85)
=== M10 (R6) el tope del historico TRUNCA en vez de rechazar
  × con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)
  Tests  1 failed | 84 passed (85)
=== M11 (R4) el guard de rol del historico se evalua DESPUES del repositorio
  × un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)
  Tests  1 failed | 84 passed (85)
=== M12 (R4) sin zona, el historico consulta igual
  × el adminSatelite SIN zona recibe un conjunto vacío y no consulta la base (R4)
  Tests  1 failed | 84 passed (85)
=== M13 (R5) el conjunto del historico se sirve del metodo PAGINADO con take: 2
  × el alcance sale del ACTOR, no de la entrada: cada admin descarga LO SUYO (R4)
  × el conjunto de la descarga NO relee el listado compuesto: pide su mitad y sólo su mitad (R1)
  × el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)
  × las filas del archivo son las MISMAS que las de la página, campo por campo
  × el conjunto NO firma ninguna URL de evidencia ni recalcula dinero
  × con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)
  Tests  6 failed | 79 passed (85)
=== M14 (R5/mapper) el conjunto del historico se salta el enriquecido de la pagina
  × las filas del archivo son las MISMAS que las de la página, campo por campo
  × el conjunto NO firma ninguna URL de evidencia ni recalcula dinero
  Tests  2 failed | 83 passed (85)
=== arbol restaurado
```

**M8 es LA mutación de esta tanda, y merece leerse dos veces.** El código mutado vuelve a
`findCierresByAlcance` y parte en memoria con `esColaCierreDia` — es decir, deshace exactamente lo
que la tanda entrega. Y produce **las mismas filas, en el mismo orden, con los mismos totales**:
el corte en memoria y el corte en la base seleccionan lo mismo. Es indistinguible por cualquier
test que mire el resultado… y de hecho **84 de los 85 casos siguen verdes**.

La caza un solo caso, y por una vía que había que construir a propósito: el repositorio en memoria
de la suite anota **cuántas filas devolvió cada llamada**, no solo cuál fue. El caso afirma
`llamadas === ["findHistoricoCompleto"]` y `filasLeidas === [5]`. La **anti-vacuidad** vive en el
mismo caso: la relectura que esta tanda sustituye se ejecuta también, y se afirma que lee **7**
(`llamadas === ["findCierresByAlcance"]`, `filasLeidas === [7]`). Sin esa mitad, un servicio que no
leyera nada pasaría igual.

**M13 existe por el aviso de la tanda C: cuidado con el killer que depende del fixture.** Servirse
del método paginado con el `take` real (25) y cinco filas de almacén habría dejado R5 vivo, porque
la página 1 *sería* el conjunto entero. Se ejecutó directamente con **`take: 2`**, y ahí caen seis
casos, incluido el de R5.

### Lote borde (5) — la lista blanca derivada

```
=== M15 (R17) el borde del historico usa el schema de la PAGINA en vez del derivado
  × una clave no declarada muere con validation_error sin tocar el service (R17)
  Tests  1 failed | 17 passed (18)
=== M16 (R17) el borde de la COLA no parsea la entrada
  × una clave no declarada muere con validation_error sin tocar el service (R17)
  Tests  1 failed | 17 passed (18)
=== M17 (R17) el schema derivado del historico deja de ser estricto (.strict -> .passthrough)
  × una clave no declarada muere con validation_error sin tocar el service (R17)
  Tests  1 failed | 17 passed (18)
=== M18 (R7) el borde del historico valida ANTES de resolver el actor
  × el actor se resuelve ANTES de validar: sin sesión no se filtra la lista blanca
  Tests  1 failed | 17 passed (18)
=== M19 (borde) el borde del historico deja de admitir la llamada SIN entrada
  × sin entrada, o con un objeto vacío, delega en el service con SOLO el actor
  Tests  1 failed | 17 passed (18)
=== arbol restaurado
```

**M15 es la que justifica que el schema se DERIVE.** Con la lista blanca copiada a mano del
listado paginado, `page: 2` y `pageSize: 100` pasarían: son claves que la página acepta y el
conjunto no debe. El caso las prueba explícitamente, junto a `destinoZonaId` y `destinoTipo`, que
son las que abrirían el dinero de la bodega vecina. **M16 se aplicó al borde de la COLA a
propósito**, para que el lote no midiera solo uno de los dos.

**Resultado: 19 mutaciones, 19 rojas. Ninguna sobrevivió**, así que no hay código propio sin
vigilar que retirar (el encargo pedía retirarlo, no comentarlo, si lo hubiera).

---

## 5. Archivos

**Nuevos (2)**

- `tests/unit/services/cierres-admin-completo.test.ts` — 8 casos (incluye el contador de filas
  leídas y su anti-vacuidad).
- `tests/unit/actions/cierres-admin-descarga-action.test.ts` — 6 casos, **los dos bordes en cada
  uno**.

**Modificados — producción (6)**

- `lib/repositories/CierresAdminRepository.ts` — `ORDEN_CIERRES_ADMIN`, `historicoWhere`,
  `colaWhere` (una declaración cada uno) **y los dos métodos nuevos**.
- `lib/interfaces/repositories/ICierresAdminRepository.ts` — sus dos contratos.
- `lib/services/CierresAdminService.ts` — los dos métodos del conjunto.
- `lib/interfaces/services/ICierresAdminService.ts` — sus dos contratos y sus dos result types.
- `lib/types/cierres-admin.ts` — los dos schemas derivados y los dos `…CompletoResult`.
- `lib/actions/cierres-admin.ts` — los dos bordes.

**Modificados — tests (7)**

- `tests/unit/repositories/historicos-paginados-where.test.ts` — +4 casos (13 → 17).
- `tests/unit/repositories/colas-paginadas-where.test.ts` — +3 casos (9 → 12).
- Cinco suites que declaran el repositorio ENTERO como doble
  (`cierres-admin-service`, `cierres-admin-pendiente`, `cierres-admin-indemnizacion`,
  `CierresAdminService.aprobar.devolucion`, `indemnizacion-tope-negocio-cierre`) ganan los dos
  métodos como no-op. **Este es el peaje que las tandas B y C no pagaron**, y es el precio de
  añadir métodos al contrato: lo cobra `tsc`, no un rojo tardío.

**Cero** cambios en `app/**`, `components/**`, `db/migrations/`, RLS, esquema, `feature_list.json`
y la configuración de `useSWR` de ninguna pantalla (R33).

**Peaje de los `vi.mock` ajenos: CERO en esta tanda.** Ninguna pantalla importa todavía las
acciones nuevas: eso es D.3. Se comprobó ejecutando las suites que mockean o renderizan este
dominio, incluida `tests/integration/actions/cierres-admin-action.test.ts`: **188 casos en 12
archivos, todos verdes**. **Quien haga D.3 sí lo pagará**, y conviene enumerarlo antes con
`pnpm exec vitest related --run` sobre las dos pantallas.

---

## 6. Mapa `R<n>` → archivo + nombre del caso

Construido **leyendo el caso**, no contando `R\d+` en títulos: varios casos cubren un requisito sin
nombrarlo y varios títulos de los archivos vecinos citan requisitos de la **feature 170** (`R40`,
`R41`, `R44`, `R49`, `R51`, `R54`), cuyo espacio de nombres se cruza con el de esta.

| R | Archivo | Caso | Estado |
| --- | --- | --- | --- |
| R1 | `tests/unit/services/cierres-admin-completo.test.ts` + `tests/unit/repositories/historicos-paginados-where.test.ts` | **«el conjunto de la descarga NO relee el listado compuesto: pide su mitad y sólo su mitad (R1)»** (llamadas + filas leídas, con la anti-vacuidad de la relectura de hoy) y «el conjunto del archivo NO es el listado compuesto: trae UNA mitad, no las dos (R1)» (el `where` del compuesto no lleva `estado`). Killers: **M4**, **M8** | backend ✔; que la PANTALLA lo use es **D.3** |
| R2 | `…/cierres-admin-completo.test.ts` | «el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)» + «las filas del archivo son las MISMAS que las de la página, campo por campo» (el servidor entrega el conjunto ya resuelto; el servicio no reordena ni recorta) | backend ✔ (la mitad de cliente, en D.3) |
| R3 | `tests/unit/actions/cierres-admin-descarga-action.test.ts` | «una clave no declarada muere con validation_error sin tocar el service (R17)» | ✔ **con matiz**: estos listados NO tienen filtros, así que «los filtros vigentes» es siempre el alcance entero del actor. Lo afirmable es que ninguna clave puede viajar |
| R4 | `…/cierres-admin-completo.test.ts` | «un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)» (4 roles × 2 listados, cero llamadas) + «el alcance sale del ACTOR, no de la entrada: cada admin descarga LO SUYO (R4)» (tres alcances disjuntos + aridad 1 de los dos métodos) + «el adminSatelite SIN zona recibe un conjunto vacío y no consulta la base (R4)». En repositorio, «el acceso total NO emite destinoZonaId, pero SÍ el tipo de bodega (R4)». Killers: **M2**, **M11**, **M12**, **M13** | ✔ |
| R5 | `tests/unit/repositories/{historicos-paginados,colas-paginadas}-where.test.ts` | «cierres del día — histórico / cola: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)». Más, en servicio, «el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)» — con `pageSize: 2`, killer medido **M13** | ✔ |
| R6 | `…/cierres-admin-completo.test.ts` | «con MAX_FILAS entrega TODAS; con una más devuelve limite_excedido y ni una fila (R6)» (borde exacto por arriba y por abajo, **para cada uno de los dos listados**) + en el borde, «limite_excedido del service pasa tal cual: conteos y NINGUNA fila (R6)». Killers: **M9**, **M10** | ✔ |
| R7 | `tests/unit/actions/cierres-admin-descarga-action.test.ts` | «sin sesión devuelve unauthenticated y ninguna fila, sin tocar el service (R7)» + «forbidden del service pasa tal cual, sin filas ni total (R7)» + «el actor se resuelve ANTES de validar: sin sesión no se filtra la lista blanca» (killer **M18**). El mensaje al usuario lo redacta el adaptador, y sus casos ya existen | backend ✔ |
| R8 | — | es de pantalla (montar no llama a la acción del conjunto) | **D.3** |
| R12 | — | columnas y textos del archivo: no se tocan. `cierres-admin-descarga-columnas.ts` no se modificó y `ControlDescargaTransversal.test.tsx` sigue verde. Las dos filas de descarga siguen tomando `CierreAdminResumen`, así que D.3 no cambia firmas | ✔ sin cambios |
| R13 | `tests/components/paginacion/paginacion-transversal.test.tsx` | los listados 2 y 3 **siguen** declarados `conjunto` y siguen en `PENDIENTES_184`, porque sus pantallas no han migrado: el censo pasa sin tocarlo. Sacarlos es D.4, en el mismo commit que D.3 | ✔ |
| R14 | `historicos-paginados-where.test.ts` + `colas-paginadas-where.test.ts` | «cierres del día — histórico: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)» y su gemelo de cola — ejecutan el repositorio REAL y afirman sobre los ARGUMENTOS de la consulta. Un caso por método nuevo. Killer del tipo «columna que no existe»: **M7** (rojo en tests **y** en `tsc`) | ✔ |
| R15 | `historicos-paginados-where.test.ts` | «los dos conjuntos del admin cuestan UNA consulta, sin recorte y sin conteo de página (R15)» — killer **M3** | ✔ |
| R16 | los dos `*-where.test.ts` | los dos casos de R14 (mismas condiciones y mismo orden) + **«los CONJUNTOS de cola e histórico particionan el alcance con la MISMA constante (R16)»**, que es la mitad que solo se ve mirando las dos a la vez. La otra mitad de R16 —«no hay dos declaraciones del mismo criterio»— se cumple por construcción (`ORDEN_CIERRES_ADMIN`, `historicoWhere`, `colaWhere`) y se midió con **M5** y **M6** | ✔ |
| R17 | `tests/unit/actions/cierres-admin-descarga-action.test.ts` | «una clave no declarada muere con validation_error sin tocar el service (R17)» — seis entradas × **dos** bordes; incluye `page`/`pageSize`, que es lo que hace de la lista blanca una DERIVADA, y `destinoZonaId`/`destinoTipo`, que son las que importan. Killers: **M15**, **M16**, **M17** | ✔ |
| R33 | — | no se tocó la configuración de `useSWR` de ninguna pantalla (cero archivos `app/**` modificados) | ✔ |
| R34 | este archivo | el mapa de arriba | ✔ |

**Requisitos que NO se pueden cubrir aquí, con su motivo:** R1 (mitad de pantalla), R2 (mitad de
cliente) y R8 son de **pantalla**, y salen en D.3. R13/R29–R32 son de **censo**
(`paginacion-transversal`, `adaptador-conjunto.guardia`) y salen en D.4 y en la tanda H. **R9** es
de la tanda C (las URL de evidencia del listado 1) y **R10** de la tanda B (los agregados de la
consolidación); ninguno aplica a estos dos listados, aunque el espía de firmas se dejó puesto por
si algún día el camino cambiara. **R11** es del listado 10 y **R18–R28** son la poda de la
selección satélite, las dos cerradas en la tanda A.

---

## 7. Puertas (medición real)

```
$ pnpm run typecheck
> tsc --noEmit
=== typecheck exit: 0 ===

$ pnpm exec vitest run <mis 4 archivos + los 8 vecinos del dominio>
 Test Files  12 passed (12)
      Tests  188 passed (188)
   Duration  2.21s

$ pnpm exec vitest run guard
 Test Files  61 passed (61)
      Tests  830 passed (830)
   Duration  7.49s

$ pnpm exec eslint .
✖ 44 problems (0 errors, 44 warnings)
```

**Rojos: cero, ni propios ni ajenos.** Tampoco aparecieron los rojos de contención avisados
(`LoginForm`, `RegistrarPagoDialog`): no entran en los archivos que corrí.

Las **44 warnings de lint son AJENAS y PREEXISTENTES**: es el mismo número que midieron
`chore_deuda_170.md §6` (2026-08-03) y las tandas A, B y C sobre el árbol limpio. En los diez
archivos que toqué, `eslint` reporta **4 warnings**, las cuatro del helper `delegado` de los dos
`*-where.test.ts` (`_args` sin usar), que existían antes de esta tanda. **Delta propio: cero.**

**La suite completa NO se corre aquí**: el gate (`./init.sh`) lo corre el LEADER.

---

## 8. Nota de proceso: el worktree sigue compartido

Se respetó la regla de higiene: **ninguna orden de git sin ruta explícita**, y el runner de
mutaciones restaura **desde una copia en memoria**, no con `git checkout`. Aun así hubo un
incidente que conviene dejar escrito: en el primer lote, el `writeFileSync` de restauración de M6
falló con `UNKNOWN: unknown error` (lock transitorio de Windows sobre
`lib/repositories/CierresAdminRepository.ts`) y **dejó la mutación aplicada**. Se detectó con
`git diff` sobre esa ruta y se revirtió a mano la única línea afectada.

Desde entonces el runner **reintenta la restauración y verifica que el contenido volvió a ser el
original**, y aborta si no lo consigue. Una mutación que sobrevive por accidente es peor que
ninguna: se lee como código entregado.

Los archivos del otro agente (`app/(app)/cierre-dia/_components/CierreDiaModule.tsx` cuando
apareció modificado) **no se tocaron ni se commitearon**.

---

## 9. Qué queda, y para quién

| Tarea | De quién | Qué falta exactamente |
| --- | --- | --- |
| **D.3** | frontend | `CierresAdminHistoricoTabla.tsx` (`:108-116`) y `CierresAdminModule.tsx` (`:594-602`): `obtenerFilas` pasa de `filasDelConjuntoCompleto(listarCierresAdmin().then(res => ({status:"ok", items: res.historico})), filaDescargaCierreHistorico)` a `filasDesdeResultado(listarHistoricoCierresAdminCompleto(), filaDescargaCierreHistorico)`, y su gemelo con `listarPendientesCierresAdminCompleto` / `filaDescargaCierrePendiente`. Las dos filas de descarga **no cambian de firma**: siguen tomando `CierreAdminResumen` |
| **D.4** | frontend | listados 2 y 3 a `adaptador: "completo"` y fuera de `PENDIENTES_184` (quedan 6), en el MISMO commit que D.3 |

**Aviso para D.3 (peaje del `vi.mock`):** en cuanto las dos pantallas importen las acciones
nuevas, todo archivo de test que haga `vi.mock("@/lib/actions/cierres-admin", …)` con factoría y
renderice esas pantallas revienta al importarlas si no declara los exports nuevos. Los candidatos
medidos hoy son `tests/components/descarga/CierresDescarga.test.tsx`,
`tests/components/CierresAdminModule.test.tsx`, `tests/components/CierresAdminPage.test.tsx`,
`tests/components/CierresAdminIndemnizacion.test.tsx`,
`tests/components/CierresAdminPagoMensajero.test.tsx`,
`tests/components/paginacion/ColasPaginacion.test.tsx` y
`tests/components/paginacion/BajoRiesgoPaginacion.test.tsx`. Es peaje esperado, no regresión.
