# 184 — la parte BACKEND de la Tanda G (wallet: listados 11 y 12)

> Rama: `feature/184-deuda-170-listados` · Fecha: 2026-08-04 · Rol: BACKEND_DEV
>
> Alcance entregado: **G.1**. `app/**` y `components/**` NO se tocan: G.2 (las dos pantallas +
> el segundo censo) y G.3 (el censo transversal) son del frontend y cierran la tanda.
>
> **Veredicto en una línea: los dos listados baratos del inventario no ahorran nada —y esta
> bitácora no lo va a fingir—, pero el archivo de «Saldos de tiendas» estaba saliendo SIN
> ORDENAR y ahora sale como la tabla; sin un solo método de repositorio nuevo, con 24 mutaciones
> ejecutadas y las 24 rojas.**

---

## 1. Qué se gana de verdad aquí, medido y sin adornos

El encargo pedía medirlo y escribirlo tal cual aunque fuera poco. Lo es, y en un caso es cero:

| | Listado 11 — Plantillas de gasto fijo | Listado 12 — Saldos de tiendas |
| --- | --- | --- |
| Consultas antes | 1 (`findMany` sin `where`) | 2 (`groupBy` del ledger + nombres) |
| Consultas después | **1, la misma** | **2, las mismas** |
| Filas leídas antes / después | **iguales** | **iguales** |
| Ahorro medido | **ninguno** | **ninguno** |
| Lo que sí cambia | el tope se evalúa en el servidor (R6) y el conjunto deja de cruzar al navegador por encima de él | **lo anterior + el archivo pasa a salir ORDENADO** |

**En el 11 no hay nada más que decir, y decir otra cosa sería falso.** Es un `findMany` sin
`where` sobre una tabla de configuración con un puñado de filas; la migración es higiene: el
adaptador se unifica, el tope se decide donde debe y la lista blanca del borde pasa a existir.
El aviso de tope no llegará a dispararse nunca en producción.

**En el 12 sí apareció algo que no estaba en el inventario, y es un defecto vivo:**

> `listarSaldosTodasTiendas()` devuelve las filas **en el orden que le conviene al planificador
> de Postgres** —lo dice el comentario del propio repositorio, escrito por la 170—, mientras que
> la tabla las presenta **por nombre de tienda**. Como el archivo se producía releyendo ese
> listado, **la fila 26 del archivo no era la primera de la página 2**, y dos descargas seguidas
> del mismo conjunto pueden salir en distinto orden.

La 170 lo dejó **declarado como desviación consciente** (`impl_170-fase2-tanda-i.md`), y con
razón: entonces ese conjunto no sostenía ningún archivo. Desde esta tanda lo sostiene, y R5
—«la página N DEBE ser el segmento que le corresponde dentro del conjunto que produce el
archivo, en el mismo orden»— deja de admitirlo. Su killer es **M9** (§4).

Un tercer efecto, medido y que le sirve a quien venga después: **tras G.2, las dos
acciones-fuente se quedan sin un solo consumidor de producción.** `listarPlantillasAction` y
`listarSaldosTiendasAction` (y detrás de ellas `GastoFijoPlantillaService.listarPlantillas` y
`WalletTiendaService.listarSaldosTiendas`) se referencian hoy **solo** desde la descarga de su
pantalla — verificado con `grep` sobre `app/**` (dos ficheros, la línea de `obtenerFilas` de
cada uno). No se borran aquí: está fuera del alcance de G.1, y además siguen teniendo consumo
en la suite —el caso de R44 de la 170 y el de R16 de esta tanda las usan como contraprueba de
que la tabla y el archivo no divergen—.

---

## 2. ¿Hacían falta métodos nuevos? No, y se midió antes de escribir

El encargo pedía aplicar el criterio de D/E (allí sí hicieron falta, porque la única lectura sin
recorte era la **unión** de los dos listados de la pantalla) y dar el dato.

| Listado | Lectura que ya existía | ¿Sirve tal cual? |
| --- | --- | --- |
| 11 | `GastoFijoPlantillaRepository.listar()` | **Sí.** Conjunto entero, sin `where`, `createdAt desc`, el mismo `toDTO` que `listarPaginado`. Es literalmente lo que el panel releía |
| 12 | `WalletTiendaMovimientoRepository.listarSaldosTiendasPaginado(rango)` | **Sí**, y es la que hay que usar: **no** `listarSaldosTodasTiendas` |

**Ninguno de los dos es la unión de dos listados**, que es lo que en D y E obligó a escribir
método: aquí la pantalla lee **un** conjunto y el archivo quiere **ese mismo** conjunto.

La única decisión de fondo fue **de qué método pedirlo en el 12**. El inventario y `tasks.md`
anotan «sobre `listarSaldosTodasTiendas()`». Se descartó, con motivo medido: ese método es el
que devuelve las filas sin orden. El orden vive una sola vez, dentro de
`listarSaldosTiendasPaginado`, así que el conjunto se pide ahí con `page: 1` +
`pageSize: MAX_FILAS + 1` — el patrón que este mismo servicio ya usa en
`listarMisMovimientosCompleto` y `listarMovimientosDeTiendaCompleto`. Consecuencias:

- **R16 se cumple en su forma fuerte:** el conjunto y la página no comparten el criterio, es que
  **son la misma llamada** con otro rango. No hay dos declaraciones porque no hay dos sitios.
- **Coste: idéntico.** `listarSaldosTiendasPaginado` no consulta nada por su cuenta: reusa la
  agregación. Medido en «el conjunto pide UNA agregación, la misma que el listado de la
  pantalla».
- **Cero cambios en el repositorio del 12.** Los 14 casos previos de
  `wallet-tienda-movimiento-repository.test.ts` y los 6 de `saldos-tiendas-paginado.test.ts`
  siguen verdes sin tocarse.

### Lo único que sí se tocó del repositorio (11), y por qué

`orderBy: { createdAt: "desc" }` estaba escrito **tres veces** en
`GastoFijoPlantillaRepository`: `listar`, `listarPaginado` y `listarActivas`. Y en las **seis**
tandas anteriores apareció lo mismo. Ahora es **una** declaración (`ORDEN_PLANTILLAS`) que las
tres leen; lo que distingue al conjunto del CRON sigue siendo su `where` (`activa: true`), que
no se tocó. Cero cambios de comportamiento: los 27 casos de los cuatro archivos del dominio
siguen verdes, incluidos los que fijan el orden en valor absoluto (contraprueba medida: **M4**).

### Y el mapper de dinero (12)

`{ tiendaId, tiendaNombre, saldo, signo }` derivado con `derivarSaldoTienda` estaba escrito
**dos veces** en `WalletTiendaService` (el listado sin paginar y el paginado); esta tanda lo
habría dejado en **tres**. Ahora es `toSaldoResumen`, una vez. No es simetría: es el mapper de
dinero de una pantalla de dinero — dos copias divergentes producen una tabla y un archivo que
dicen cifras distintas del mismo libro y **ninguna de las dos falla**. Killer: **M14**.

---

## 3. Dónde vive cada test, y por qué — con la medición delante

El encargo pedía decidirlo con criterio y justificarlo, no añadir integración por inercia.

**M5 — la mutación que en la tanda A solo cazaba un Postgres real:**

```
=== M5 (R14) el criterio del conjunto gana una condicion sobre una columna QUE NO EXISTE
  × plantillas de gasto fijo: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × el conjunto del archivo NO es el del cron: `listarActivas` sí filtra, y comparte el orden (R16)
  Tests  2 failed | 52 passed (54)
--- typecheck:
lib/repositories/GastoFijoPlantillaRepository.ts(112,75): error TS2353: Object literal may only
  specify known properties, and 'conceptoNormalizado' does not exist in type
  'GastoFijoPlantillaWhereInput'.
typecheck exit: 2
```

**Doble red, y por eso esta tanda NO añade ningún archivo `tests/integration/db/`:**

1. **`tsc` la caza.** Como en B–F, la consulta del 11 va por el constructor tipado de Prisma
   (`Prisma.GastoFijoPlantillaOrderByWithRelationInput`, `GetPayload`), así que una columna
   inexistente no compila. En la tanda A eran `$queryRaw` —texto libre— y ahí sí hizo falta
   Postgres de verdad.
2. **Los casos de `historicos-paginados-where.test.ts` también la cazan**, porque afirman
   `toBeUndefined()` sobre el `where`: una clave de más lo pone rojo aunque el tipo la admitiera.

**El listado 12 no tiene `where` que verificar** —su lectura es un `groupBy` sin condiciones, y
el acotamiento lo pone el ROL en el servicio—, así que ahí lo verificable es otra cosa: **qué
argumentos recibe la agregación y en qué ORDEN sale el resultado**. Eso vive en
`wallet-tienda-movimiento-repository.test.ts`, ejecutando el repositorio REAL con un doble de
Prisma. No se metió en `historicos-paginados-where.test.ts` porque ese archivo está construido
sobre el par `findMany`/`count`, que aquí no existe.

**Lo que los dobles NO ven, y por eso está en los tests de repositorio:** que la agregación del
conjunto y la de la página sean la misma, que no lleve `where` ni recorte, cuántas consultas se
emiten y **el orden**. **Lo que los tests de repositorio no ven, y por eso está en los de
servicio:** el guard, el tope y de qué método se sirve el conjunto.

---

## 4. Las 24 mutaciones, con su salida

Cada una: se rompe el código de verdad, se corre, **se restaura y se verifica el contenido por
hash SHA-256** (el runner aborta el proceso entero si la restauración no cuadra — el incidente
del `writeFileSync` bajo lock de Windows está contemplado, con tres reintentos). `git status`
limpio tras cada lote, verificado y pegado.

### Lote repositorio (8) — el criterio compartido y el orden

```
=== M1 (R16/R5) el conjunto de plantillas ordena al reves que su pagina
  × plantillas de gasto fijo: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × el conjunto del archivo NO es el del cron: `listarActivas` sí filtra, y comparte el orden (R16)
  Tests  2 failed | 52 passed (54)
=== M2 (R16/R26) el conjunto de plantillas filtra por activa: se vuelve el conjunto del CRON
  × plantillas de gasto fijo: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × el conjunto del archivo NO es el del cron: `listarActivas` sí filtra, y comparte el orden (R16)
  Tests  2 failed | 52 passed (54)
=== M3 (R15) el conjunto de plantillas recorta como si fuera una pagina
  × plantillas de gasto fijo: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  × el conjunto de plantillas cuesta UNA consulta, sin recorte y sin conteo de página (R15)
  Tests  2 failed | 52 passed (54)
=== M4 (R5/R16) el orden COMPARTIDO de las plantillas cambia para los tres a la vez
  × plantillas de gasto fijo: sin where (activas e inactivas), dos consultas y el orden de hoy
  × plantillas de gasto fijo: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)
  Tests  2 failed | 52 passed (54)
=== M5 (R14) el criterio del conjunto gana una condicion sobre una columna QUE NO EXISTE
  (salida completa en §3)                                   Tests  2 failed | 52 passed (54)
=== M6 (R5) el recorte de saldos deja de ordenar: el conjunto sale como lo da el planificador
  × el conjunto sale ORDENADO por nombre y la pagina es su segmento exacto (R5)
  × dos tiendas con el MISMO nombre no se solapan entre paginas: el orden es TOTAL (R5)
  × un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)
  × el conjunto del archivo sale ORDENADO como la pagina, no en el orden del planificador (R5)
  × las filas del archivo son las MISMAS que las de la pagina: un solo mapper de dinero (R16)
  × devuelve la pagina pedida y el total del conjunto (R40, R41)
  × CONTRAPRUEBA de R44: forbidden sin filas ni total, ni siquiera a la propia tienda
  × ordena por nombre de tienda, con un orden TOTAL que no solapa paginas (R51)
  Tests  8 failed | 33 passed (41)
=== M7 (R5) el orden de saldos pierde el desempate por id: deja de ser TOTAL
  × dos tiendas con el MISMO nombre no se solapan entre paginas: el orden es TOTAL (R5)
  × ordena por nombre de tienda, con un orden TOTAL que no solapa paginas (R51)
  Tests  2 failed | 39 passed (41)
=== M8 (R6/R41) el total de saldos cuenta las filas devueltas, no el CONJUNTO
  × el conjunto sale ORDENADO por nombre y la pagina es su segmento exacto (R5)
  × devuelve la pagina pedida y el total del conjunto (R40, R41)
  × el conjunto paginado y el dataset completo coinciden para el mismo actor (R44)
  × no ejecuta mas consultas que el listado sin paginar, salvo el conteo (R54)
  Tests  4 failed | 37 passed (41)
=== arbol restaurado (verificado por hash tras cada mutacion)
```

**M4 es la contraprueba de que compartir el orden no lo vuelve invisible:** cambiar la constante
pone rojas a la vez la afirmación ABSOLUTA de la página (caso de la 170) y la del conjunto. Una
declaración única no es una declaración sin vigilar.

**M6 es la que mide qué sostenía la 170 y qué sostiene ahora:** ese orden ya lo vigilaban dos
casos suyos; lo nuevo es que ahora también tumba los del **archivo**.

**M8 importa más de lo que parece:** si el `total` contara la página, el aviso de tope diría
«hay 5001» tuviera el ledger las tiendas que tuviera.

### Lote servicio (10) — el orden del archivo, el tope y el alcance

```
=== M9 (R5/R16) el conjunto de saldos se sirve de listarSaldosTodasTiendas, como decia el inventario
  × un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)
  × el conjunto del archivo sale ORDENADO como la pagina, no en el orden del planificador (R5)
  × las filas del archivo son las MISMAS que las de la pagina: un solo mapper de dinero (R16)
  × el conjunto pide UNA agregacion, la misma que el listado de la pantalla
  × pide como mucho el tope + 1 filas: lo justo para saber que se supero (R6)
  Tests  5 failed | 56 passed (61)
=== M10 (R6) el tope de los saldos se corre una fila: >= en vez de >
  × con MAX_FILAS entrega TODAS; con una mas devuelve limite_excedido y ni una fila (R6)
  Tests  1 failed | 60 passed (61)
=== M11 (R6) el tope de los saldos TRUNCA en vez de rechazar
  × con MAX_FILAS entrega TODAS; con una mas devuelve limite_excedido y ni una fila (R6)
  Tests  1 failed | 60 passed (61)
=== M12 (R6) el conjunto de saldos pide el tope EXACTO en vez de tope + 1
  × pide como mucho el tope + 1 filas: lo justo para saber que se supero (R6)
  Tests  1 failed | 60 passed (61)
=== M13 (R4) el guard de rol de los saldos se evalua DESPUES del repositorio
  × un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)
  Tests  1 failed | 60 passed (61)
=== M14 (R16) el conjunto de saldos deriva el saldo con su propio mapper (creditos - debitos al reves)
  × las filas del archivo son las MISMAS que las de la pagina: un solo mapper de dinero (R16)
  Tests  1 failed | 60 passed (61)
=== M15 (R6) el tope de las plantillas se corre una fila: >= en vez de >
  × con MAX_FILAS entrega TODAS; con una mas devuelve limite_excedido y ni una fila (R6)
  Tests  1 failed | 26 passed (27)
=== M16 (R6) el tope de las plantillas TRUNCA en vez de rechazar
  × con MAX_FILAS entrega TODAS; con una mas devuelve limite_excedido y ni una fila (R6)
  Tests  1 failed | 26 passed (27)
=== M17 (R4) el guard de rol de las plantillas se evalua DESPUES del repositorio
  × un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)
  Tests  1 failed | 26 passed (27)
=== M18 (R1/R5) el conjunto de plantillas se sirve del metodo PAGINADO (primera pagina de 2)
  × un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)
  × el conjunto del archivo es el mismo que recorrer las paginas, en el mismo orden (R5)
  × las filas del archivo son las MISMAS que las de la pagina: un solo mapper
  × con MAX_FILAS entrega TODAS; con una mas devuelve limite_excedido y ni una fila (R6)
  × el conjunto cuesta UNA llamada al repositorio, la misma que el listado de la tabla
  Tests  5 failed | 22 passed (27)
=== arbol restaurado (verificado por hash tras cada mutacion)
```

**M9 es LA mutación de esta tanda, y es exactamente lo que `tasks.md` decía que había que
escribir** («sobre `listarSaldosTodasTiendas()`»). Produce el mismo número de filas, las mismas
cifras, el mismo total y las mismas consultas: lo único que cambia es **el orden**, y sin el caso
de R5 pasaría por buena. Es la respuesta medida a «mide qué se gana de verdad».

**M12 es la que justifica el `+ 1`:** con `pageSize: limite` exacto, un conjunto de 5001 tiendas
se ve como 5000 y el archivo sale truncado sin avisar — el modo de fallo que R6 existe para
impedir.

**M18 se ejecutó con `take: 2`, no con `take: 25`, y por eso mató a R5.** Con un almacén de 5
filas y `take: 25` la primera página *es* el conjunto entero: la mutación habría muerto solo por
el caso de las llamadas al repositorio y R5 habría quedado con un killer aparente y ninguno real.
Es la trampa nº 1 del encargo, y se pagó por adelantado.

### Lote borde (6) — la lista blanca derivada

```
=== M19 (R17) el borde de plantillas usa el schema de la PAGINA en vez del derivado
  × una clave no declarada muere con validation_error sin tocar el service (R17)
  Tests  1 failed | 35 passed (36)
=== M20 (R17) el borde de los saldos NO parsea la entrada
  × una clave no declarada muere con validation_error sin tocar el service (R17)
  Tests  1 failed | 35 passed (36)
=== M21 (R17) el schema derivado de plantillas deja de ser estricto (.strict -> .passthrough)
  × una clave no declarada muere con validation_error sin tocar el service (R17)
  Tests  1 failed | 35 passed (36)
=== M22 (R17) el schema derivado de los saldos deja de ser estricto (.strict -> .passthrough)
  × una clave no declarada muere con validation_error sin tocar el service (R17)
  Tests  1 failed | 35 passed (36)
=== M23 (R7) el borde de los saldos valida ANTES de resolver el actor
  × el actor se resuelve ANTES de validar: sin sesion no se filtra la lista blanca
  Tests  1 failed | 35 passed (36)
=== M24 (borde) el borde de plantillas deja de admitir la llamada SIN entrada
  × sin entrada, o con un objeto vacio, delega en el service con SOLO el actor
  Tests  1 failed | 35 passed (36)
=== arbol restaurado (verificado por hash tras cada mutacion)
```

**M19 es la que justifica que el schema se DERIVE.** Con la lista blanca copiada a mano del
listado paginado, `page: 2` y `pageSize: 100` pasarían: son claves que la página acepta y el
conjunto no debe. El caso las prueba explícitamente, junto a `tiendaId` —la única que
convertiría el saldo de TODAS las tiendas en el de una elegida por quien pide—.

**Resultado: 24 mutaciones, 24 rojas. Ninguna sobrevivió**, así que no hay código propio sin
vigilar que retirar, y no hubo que declarar ningún mutante equivalente.

### La trampa nº 2, medida aparte: el fixture grande tampoco basta

El encargo avisa de que en la tanda E una reordenación casi sobrevivió porque el campo que la
mutación tocaba era idéntico en todas las filas. Aquí se comprobó en vez de suponerlo:
**M9 + homogeneizar `tiendaNombre` en las cinco filas del fixture + quitar la afirmación de la
secuencia absoluta**:

```
      Tests  4 failed | 3 passed (7)
      (el caso «el conjunto del archivo sale ORDENADO como la pagina…» PASA)
```

Con los nombres iguales, `expect(conjunto).toEqual(recorrido)` se cumple **con cualquier orden**
y M9 sobrevive. El caso solo mata porque **(a)** las cinco filas difieren en el campo por el que
se ordena y **(b)** además fija la secuencia absoluta esperada. Las dos mitades son
load-bearing, y ahora está escrito por qué el fixture es como es. (Los otros cuatro rojos de esa
corrida son de las afirmaciones que el propio fixture homogeneizado invalida, no de la mutación.)

---

## 5. Archivos

**Nuevos (3)**

- `tests/unit/services/gasto-fijo-plantillas-completo.test.ts` — 6 casos.
- `tests/unit/services/saldos-tiendas-completo.test.ts` — 7 casos (incluye el del orden).
- `tests/unit/actions/wallet-listados-descarga-action.test.ts` — 6 casos, los **dos** bordes en
  cada uno. Un solo archivo y no dos: los dos módulos de acciones exponen la MISMA forma de
  `deps` (`{ service, getActor }`), así que un solo recorrido los cubre sin adaptador.

**Modificados — producción (9)**

- `lib/repositories/GastoFijoPlantillaRepository.ts` — `ORDEN_PLANTILLAS`, una declaración en
  vez de tres. **Sin métodos nuevos.**
- `lib/services/GastoFijoPlantillaService.ts` — `listarPlantillasCompleto`.
- `lib/interfaces/services/IGastoFijoPlantillaService.ts` — su contrato y su result type.
- `lib/types/gasto-fijo-plantilla.ts` — el schema derivado, su input y el `…CompletoResult`.
- `lib/actions/gasto-fijo-plantilla.ts` — `listarPlantillasCompletoAction`.
- `lib/services/WalletTiendaService.ts` — `toSaldoResumen` (una declaración en vez de dos) y
  `listarSaldosTiendasCompleto`.
- `lib/interfaces/services/IWalletTiendaService.ts` — su contrato y su result type.
- `lib/types/wallet-tienda.ts` — el schema derivado, su input y el `…CompletoResult`.
- `lib/actions/wallet-tienda.ts` — `listarSaldosTiendasCompletoAction`.

**Cero cambios en `lib/repositories/WalletTiendaMovimientoRepository.ts`**: el listado 12 reusa
su método tal cual.

**Modificados — tests (4)**

- `tests/unit/repositories/historicos-paginados-where.test.ts` — +3 casos (24 → 27).
- `tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts` — +3 casos (14 → 17).
- `tests/unit/actions/gasto-fijo-plantilla-actions.test.ts` — el doble declara el método nuevo.
- `tests/unit/actions/wallet-tienda-actions.test.ts` — ídem.

**Cero** cambios en `app/**`, `components/**`, `db/migrations/`, RLS, esquema,
`feature_list.json` y la configuración de `useSWR` de ninguna pantalla (R33).

**Peaje de los `vi.mock` ajenos: CERO en esta tanda.** Ninguna pantalla importa todavía las
acciones nuevas: eso es G.2. Se comprobó ejecutando los once archivos que mockean o renderizan
estos dos dominios (`wallet-gastos-fijos-panel`, `WalletDescarga`, `WalletPropsDescarga`,
`wallet-tiendas-page`, `wallet-tiendas-desglose`, `wallet-tiendas-pago`, `BajoRiesgoPaginacion`,
`paginacion-transversal`, `mi-wallet-page`, `wallet-tienda-descarga-action`,
`wallet-tienda-desglose-action`): **137 casos, todos verdes sin tocarlos**. El peaje que sí se
pagó aquí, y es el mínimo posible: los dos dobles de servicio de `tests/unit/actions/` tuvieron
que declarar el método nuevo, porque implementan la interfaz COMPLETA (lo caza `tsc`, no un
test). **Quien haga G.2 pagará el otro peaje** y conviene que lo enumere antes con
`pnpm exec vitest related --run` sobre las dos pantallas.

---

## 6. Mapa `R<n>` → archivo + nombre del caso

Construido **leyendo el caso**, no contando `R\d+` en títulos: varios casos cubren un requisito
sin nombrarlo y varios títulos de los archivos vecinos citan requisitos de las features **170**
(`R40`, `R41`, `R44`, `R51`, `R54`) y **171**, cuyos espacios de nombres se cruzan con el de esta.

| R | Archivo | Caso | Estado |
| --- | --- | --- | --- |
| R1 | — | la lectura dedicada existe (servicio + borde); que la PANTALLA la use es G.2 | **parcial: cierra en G.2** |
| R2 | `tests/unit/services/{gasto-fijo-plantillas,saldos-tiendas}-completo.test.ts` | «el conjunto del archivo es el mismo que recorrer las páginas, en el mismo orden (R5)» y «el conjunto del archivo sale ORDENADO como la pagina, no en el orden del planificador (R5)» — el servidor entrega el conjunto ya resuelto y ordenado; el servicio no reordena ni recorta | backend ✔ (la mitad de cliente, en G.2) |
| R3 | `tests/unit/actions/wallet-listados-descarga-action.test.ts` | «una clave no declarada muere con validation_error sin tocar el service (R17)» | ✔ **con matiz**: ninguno de los dos listados tiene filtros (sus schemas de página solo llevaban `page`/`pageSize`), así que «los filtros vigentes» es siempre el conjunto entero. Lo afirmable es que ninguna clave puede viajar |
| R4 | `…/gasto-fijo-plantillas-completo.test.ts` + `…/saldos-tiendas-completo.test.ts` | «un rol sin acceso recibe forbidden ANTES de tocar el repositorio (R4)» (5 roles cada uno, cero llamadas al repo, + el otro lado con maestro y admin) y «el alcance sale del ACTOR: el metodo no tiene parametro por el que pedir otro (R4)» (aridad 1). En el borde, «una clave no declarada muere con validation_error…» con `tiendaId` | ✔ |
| R5 | `tests/unit/repositories/wallet-tienda-movimiento-repository.test.ts` | «el conjunto sale ORDENADO por nombre y la pagina es su segmento exacto (R5)» + «dos tiendas con el MISMO nombre no se solapan entre paginas: el orden es TOTAL (R5)». Para el 11, `historicos-paginados-where.test.ts` «plantillas de gasto fijo: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)». En servicio, los dos casos de R2. Killers: **M6, M7, M9, M18** | ✔ |
| R6 | los dos `*-completo.test.ts` | «con MAX_FILAS entrega TODAS; con una mas devuelve limite_excedido y ni una fila (R6)» (borde exacto por arriba y por abajo, los dos listados) + «pide como mucho el tope + 1 filas: lo justo para saber que se supero (R6)» + en el borde «limite_excedido del service pasa tal cual: conteos y NINGUNA fila (R6)» | ✔ |
| R7 | `tests/unit/actions/wallet-listados-descarga-action.test.ts` | «sin sesion devuelve unauthenticated y ninguna fila, sin tocar el service (R7)» + «forbidden del service pasa tal cual, sin filas ni total (R7)» + «el actor se resuelve ANTES de validar: sin sesion no se filtra la lista blanca». El mensaje al usuario lo redacta el adaptador, y sus casos ya existen | backend ✔ |
| R8 | — | es de pantalla (montar no llama a la acción del conjunto) | **G.2** |
| R12 | — | columnas y textos del archivo: no se tocan. `gastos-fijos-descarga-columnas.ts` y `saldos-tiendas-descarga-columnas.ts` sin modificar; `ControlDescargaTransversal.test.tsx` sigue verde | ✔ sin cambios |
| R13 | `tests/components/paginacion/paginacion-transversal.test.tsx` | los listados 11 y 12 **siguen** declarados `conjunto` y siguen en `PENDIENTES_184`, porque sus pantallas no han migrado: el censo pasa sin tocarlo. Sacarlos es G.3, en el mismo commit que G.2 | ✔ |
| R14 | `historicos-paginados-where.test.ts` + `wallet-tienda-movimiento-repository.test.ts` | «plantillas de gasto fijo: el conjunto y la página emiten las MISMAS condiciones y el MISMO orden (R16/R5)» y «el conjunto del archivo y la pagina salen de la MISMA agregacion, sin where ni recorte (R15/R16)» — ejecutan el repositorio REAL y afirman sobre los ARGUMENTOS de la consulta | ✔ (sin métodos nuevos: se verifican los reusados) |
| R15 | los mismos dos | «el conjunto de plantillas cuesta UNA consulta, sin recorte y sin conteo de página (R15)» y, en los saldos, las cuatro afirmaciones de «dos consultas: la agregación y los nombres; ni `findMany` ni `count`», más `where`/`skip`/`take` `undefined` | ✔ |
| R16 | los mismos dos + los dos `*-completo.test.ts` | los casos de R14, más «el conjunto del archivo NO es el del cron: `listarActivas` sí filtra, y comparte el orden (R16)» y «las filas del archivo son las MISMAS que las de la pagina: un solo mapper de dinero (R16)». La otra mitad —«no hay dos declaraciones del mismo criterio»— se cumple por construcción (`ORDEN_PLANTILLAS`, `toSaldoResumen`, y en el 12 porque conjunto y página **son la misma llamada**) y se midió con **M4** y **M14** | ✔ |
| R17 | `tests/unit/actions/wallet-listados-descarga-action.test.ts` | «una clave no declarada muere con validation_error sin tocar el service (R17)» — seis entradas × dos bordes; incluye `page`/`pageSize`, que es lo que hace de la lista blanca una DERIVADA, y `tiendaId`, que es la que importa | ✔ |
| R33 | — | no se tocó la configuración de `useSWR` de ninguna pantalla (cero archivos `app/**` modificados) | ✔ |
| R34 | este archivo | el mapa de arriba | ✔ |

**Requisitos que NO se pueden cubrir aquí, con su motivo:** R1 (parcial), R2 (mitad de cliente) y
R8 son de **pantalla**, y salen en G.2. R29–R32 son de **censo** (`paginacion-transversal`,
`WalletPropsDescarga`, `adaptador-conjunto.guardia`) y salen en G.2/G.3 y en la tanda H. **R9**
es de la tanda C, **R10** de la B, **R11** del listado 10 (tanda A) y **R18–R28** son la poda de
la selección satélite, cerrada en la tanda A.

---

## 7. Puertas (medición real)

```
$ pnpm run typecheck
> tsc --noEmit
=== typecheck exit: 0 ===

$ pnpm exec vitest run <mis 3 archivos nuevos + los 12 vecinos de los dos dominios>
 Test Files  15 passed (15)
      Tests  187 passed (187)
   Duration  1.71s

$ pnpm exec vitest run <los 11 archivos que mockean o renderizan estos dominios>
 Test Files  11 passed (11)
      Tests  137 passed (137)

$ pnpm exec vitest run guard
 Test Files  61 passed (61)
      Tests  830 passed (830)
   Duration  6.42s

$ pnpm exec eslint .
✖ 44 problems (0 errors, 44 warnings)
```

**Rojos: cero, ni propios ni ajenos.**

Las **44 warnings de lint son AJENAS y PREEXISTENTES**: el mismo número que midieron
`chore_deuda_170.md §6` (2026-08-03) y las tandas A–F sobre el árbol limpio. Sobre mis archivos,
`eslint` reporta 2 warnings, las dos en el helper `delegado` de `historicos-paginados-where.test.ts`
(`:42`, `:43`), que existía antes de esta tanda. **Delta propio: cero.**

**La suite completa NO se corre aquí**: el gate (`./init.sh`) lo corre el LEADER.

---

## 8. Qué queda, y para quién

| Tarea | De quién | Qué falta exactamente |
| --- | --- | --- |
| **G.2** | frontend | `GastosFijosPlantillasPanel.tsx` (`:242-254`): `obtenerFilas` pasa de `filasDelConjuntoCompleto(listarPlantillasAction().then(...), filaDescargaGastoFijo)` a `filasDesdeResultado(listarPlantillasCompletoAction(), filaDescargaGastoFijo)`. `SaldosTiendasTable.tsx` (`:164-176`): ídem con `listarSaldosTiendasCompletoAction()` y `filaDescargaSaldoTienda`. Además, el SEGUNDO censo (`WalletPropsDescarga.test.tsx`) declara `filasDesdeResultado` para los tres módulos de wallet, y su caso del tope con 5001 filas pasa a ser `limite_excedido` **del servidor** (R6) |
| **G.3** | frontend | listados 11 y 12 a `adaptador: "completo"` y fuera de `PENDIENTES_184`, que queda **vacío**, en el MISMO commit que G.2 |

**Lo que el frontend encontrará listo:** `listarPlantillasCompletoAction()` devuelve
`ListarCompletoResult<GastoFijoPlantillaDTO>` y `listarSaldosTiendasCompletoAction()` devuelve
`ListarCompletoResult<SaldoTiendaResumenDTO>` — exactamente lo que `filasDesdeResultado` sabe
traducir y lo que `filaDescargaGastoFijo` / `filaDescargaSaldoTienda` ya saben proyectar. Las dos
se pueden llamar **sin argumentos**.

**Aviso para G.2 (peaje del `vi.mock`):** en cuanto las dos pantallas importen las acciones
nuevas, todo archivo de test que haga `vi.mock("@/lib/actions/gasto-fijo-plantilla", …)` o
`vi.mock("@/lib/actions/wallet-tienda", …)` con factoría y renderice esas pantallas revienta al
importarlas si no declara los exports nuevos. Los candidatos medidos hoy son
`tests/unit/components/wallet-gastos-fijos-panel.test.tsx`,
`tests/components/descarga/WalletDescarga.test.tsx`,
`tests/components/descarga/WalletPropsDescarga.test.tsx`,
`tests/integration/wallet-tiendas-page.test.tsx`, `tests/integration/wallet-tiendas-desglose.test.tsx`,
`tests/integration/wallet-tiendas-pago.test.tsx` y
`tests/components/paginacion/BajoRiesgoPaginacion.test.tsx`. Es peaje esperado, no regresión.

**Dato para la tanda H (o para quien recoja la deuda):** tras G.2, `listarPlantillasAction` y
`listarSaldosTiendasAction` se quedan **sin ningún consumidor de producción** (§1). No se retiran
aquí —H.2 solo contempla borrar `filasDelConjuntoCompleto`— pero conviene anotarlo antes de que
se olvide: es superficie pública viva que ya no sirve a ninguna pantalla, y las dos siguen
usándose en la suite como contraprueba de que la tabla y el archivo no divergen.
