# Feature 132 — analítica: tablero financiero · bitácora de implementación

> Rama `feature/132-analitica-tablero-financiero`, worktree `C:/w132`.
> Base de la rama: `a66daa8a` (merge del PR #270 en `dev`).
> Zona `frontend`, complejidad `medium`, `depends_on: 127` (**done**, PR #269).
> **Ninguna línea de código de producción la escribió el implementer**: las tres tandas las
> ejecutó `frontend_dev` (`AGENTS.md`); el implementer coordinó, verificó y commiteó.

## 0. Estado

**Tasks cerradas: 13 de 13.** T0.1–T0.4 ya venían cerradas por la puerta F1.4; aquí se cerraron
T1.1, T1.2, T2.1–T2.3, T3.1, T4.1–T4.3, T5.1–T5.3 y T6.1. T6.2 (`./init.sh` completo) y T6.3
(sincronización + PR) son del **leader**, no del implementer.

**Requisitos mapeados: 28 de 28.**

La puerta F1.4 estaba **cerrada por defecto declarado** (2026-08-03) y no se reabrió. Las tres
decisiones que condicionaban el código se aplicaron tal cual: rango por defecto `mes`, `tiendaId`
**crudo** con la limitación escrita en pantalla (los nombres son la ficha 179) y tablero **sin
gráfica de líneas** (el desglose por fecha es la ficha 180).

## 1. Archivos

### Creados

| Ruta | Qué es |
|---|---|
| `app/(app)/analitica/_components/financiero/rango.ts` | La ÚNICA constante de rango de la feature (R26) |
| `app/(app)/analitica/_components/financiero/adaptar.ts` | Adaptadores PUROS DTO → props de la 130 |
| `app/(app)/analitica/_components/financiero/cargar.ts` | Cargador de servidor: las 8 métricas en paralelo |
| `app/(app)/analitica/_components/financiero/TableroFinanciero.tsx` | Server Component: los 9 paneles |
| `app/(app)/analitica/_components/financiero/PanelConciliacion.tsx` | Server Component: el caso `tipo: "conciliacion"` |
| `tests/unit/analytics/tablero-financiero-rango.test.ts` | R26 + censo de presets |
| `tests/unit/analytics/tablero-financiero-adaptar.test.ts` | R14–R16, R20, R21, R24 |
| `tests/unit/analytics/tablero-financiero-cargar.test.ts` | R9, R12, R13, R23, R27 |
| `tests/components/TableroFinanciero.test.tsx` | R4, R13, R16–R18, R22–R24 |
| `tests/components/PanelConciliacion.test.tsx` | R19 |
| `tests/unit/guards/tablero-financiero.guardia.test.ts` | Guard estático: R10, R25, R27 |

### Modificados

| Ruta | Qué cambió |
|---|---|
| `app/(app)/analitica/_components/AnaliticaShell.tsx` | + prop `financiero` y su `<section>`; nada existente reordenado |
| `app/(app)/analitica/page.tsx` | Pre-fetch en el Server Component tras el gate; el gate NO se toca |
| `tests/components/AnaliticaShell.test.tsx` | + 5 casos (R6, R7, R8); los de la 129 intactos |
| `tests/components/AnaliticaPage.test.tsx` | + 23 casos (R1–R3, R5, R8, R9); los de la 129 intactos |
| `tests/unit/descarga/censo-tablas.ts` | `TablaResumen` gana sus dos montajes (ver §4) |

### No tocados, y ese era el objetivo

`lib/**`, `components/private/analytics/**`, `feature_list.json`. Verificado con
`git diff a66daa8a HEAD -- lib/ components/private/analytics/ feature_list.json`: **vacío**. Es la
comprobación literal que T5.1 pide para **R5**.

## 2. Mapa `R<n>` → test → mutación que lo pone rojo

La tercera columna es lo que obliga a que el test **mida algo**: la mutación concreta del código de
producción que lo tumbaría. Un test que no se pueda tumbar no es trazabilidad, es decoración.

| R | Test (archivo :: nombre) | Mutación que lo pone rojo |
|---|---|---|
| R1 | `AnaliticaPage.test.tsx` :: «Feature 132 (R1) — los roles con acceso total ven la región financiera» (it.each maestro/admin) | Dejar de pasar la prop `financiero` en `page.tsx` |
| R2 | `AnaliticaPage.test.tsx` :: «para un rol sin acceso no queda RASTRO de la región financiera» | Renderizar la región (o su vacío) antes del `notFound()` |
| R3 | **`tablero-financiero.guardia.test.ts`** :: «la pagina decide con esAccesoTotal» + «ningun archivo escribe una lista de roles a mano». El caso de comportamiento de `AnaliticaPage.test.tsx` («el conjunto de roles que ve la región coincide exactamente con los que esAccesoTotal acepta») acompaña pero **NO discrimina** | Sustituir `esAccesoTotal(actor.rol)` por `["maestro","admin"].includes(...)` — **2 rojos, medido** (§8) |
| R4 | `TableroFinanciero.test.tsx` :: «no aparece por ninguna de sus etiquetas ni deja hueco» + «no muestra ningun motivo de denegacion» | Renderizar el panel `denegado` en cero, vacío o con motivo |
| R5 | `AnaliticaPage.test.tsx` :: «ROLES_ACCESO_ANALITICA sigue siendo exactamente maestro y admin» / «ROLES_ANALITICA sigue siendo los cinco lectores, sin apiKey» / «subconjunto ESTRICTO» | Añadir un rol a `ROLES_ACCESO_ANALITICA` (lo que hará la 133) |
| R6 | `AnaliticaShell.test.tsx` :: «expone TRES regiones y la tercera se llama Tablero financiero» + «el contenido financiero se pinta DENTRO de su región y no en las otras dos» | Poner la región encima de la operativa, fuera de la pila, o sin `aria-label` |
| R7 | `AnaliticaShell.test.tsx` :: «con filtros y operativo enchufados pero sin financiero, sigue sin haber región financiera» | Añadir el `EmptyState` que el paso (3) del punto de extensión de la 129 sugería |
| R8 | `AnaliticaPage.test.tsx` :: «Feature 132 (R1, R8) — los otros cuatro roles siguen recibiendo notFound» + los cuatro describes de la 129, intactos; `AnaliticaShell.test.tsx` :: «las regiones Filtros y Tablero operativo conservan su estado vacío cuando sólo llega financiero» | Tocar el gate, o el `EmptyState` de las dos regiones existentes |
| R9 | `tablero-financiero-cargar.test.ts` :: «cada llamada recibe dos argumentos: el id y el filtro por defecto»; `AnaliticaPage.test.tsx` :: «el cargador se invoca EXACTAMENTE una vez por render» + «no se consulta el dinero para un rol denegado» | Mover el `await` delante del gate, o pasarle `deps` al Server Action |
| R10 | `tablero-financiero.guardia.test.ts` :: «ningun archivo de la feature declara use client» + «ningun archivo pasa avisoRecorte ni ninguna otra prop-funcion a un componente cliente» | Poner `"use client"` en cualquier archivo de la región, o pasar `avisoRecorte` a una gráfica |
| R11 | **`pnpm exec next build`** (§3.1). Ningún gate automático del repo lo corre | `"use client"` en `page.tsx`: compila los tests y revienta el build arrastrando Prisma al bundle |
| R12 | `tablero-financiero-cargar.test.ts` :: «las ocho llamadas ya se emitieron antes de que se resuelva la primera» + «con un error y un denegado, las otras seis llegan ok» | Cambiar el `Promise.all` por un bucle con `await` dentro |
| R13 | `tablero-financiero-cargar.test.ts` :: «invoca el borde una vez por metrica servida y ninguna vez de mas»; `TableroFinanciero.test.tsx` :: «las secciones del tablero son exactamente las de IDS_FINANCIERAS_SERVIDAS» | Escribir la lista de ids a mano, u omitir/añadir un panel |
| R14 | `tablero-financiero-adaptar.test.ts` :: «cada punto lleva el valor del campo pedido de su propia fila» + «hay una fila por fila del DTO y las dos cifras son las del contrato»; `TableroFinanciero.test.tsx` :: el `describe` de R14 (por método / por tienda / cuenta por pagar) + «el panel de tabla muestra el total del DTO en sus dos formas» | **Dos mutaciones distintas, las dos medidas:** pasar la prop `totales` de `TablaResumen` (**rojo**, M1 del reviewer) **y** derivar el total sumando `vista.filas` (**4 rojos** tras el arreglo; **sobrevivía** antes, §8) |
| R15 | `tablero-financiero-adaptar.test.ts` :: «una cadena vacia no vale cero», «una cadena de solo espacios tampoco vale cero», «un texto que no es un numero se marca como ausente», «el literal NaN se marca como ausente» — los cuatro con `.not.toBe(0)` explícito | Sustituir el `null` de `aNumero` por `0` |
| R16 | `tablero-financiero-adaptar.test.ts` :: «el bruto y el neto producen series distintas e identificables» + «las dos columnas de importe se declaran una sola vez»; `TableroFinanciero.test.tsx` :: «el panel de KPI muestra el neto como cifra y el bruto etiquetado aparte» | Pintar solo el neto (escondería el volumen) o solo el bruto (mentiría en cuanto hubiera una anulación) |
| R17 | `TableroFinanciero.test.tsx` :: «viven en secciones distintas con nombres accesibles distintos» + «no existe ninguna cifra que sea la suma de los dos totales» | Fundir las dos vistas de `cod_recaudado` en una serie, o mostrar su total conjunto |
| R18 | `TableroFinanciero.test.tsx` :: «aparece en las DOS metricas cuyo DTO trae esAcumulado true» + «NO aparece en las otras seis» | Leer el saldo al corte de una lista de ids escrita a mano en vez de `datos.esAcumulado` |
| R19 | `PanelConciliacion.test.tsx` :: «muestra un aviso con role=alert que incluye CUANTOS cierres estan descuadrados» + «el resto de la tabla y el cuadre se renderizan IGUALMENTE» + «no lanza con la lista de descuadrados vacia» + «muestra los importes por metodo de CADA fila, no solo sus conteos» | Silenciar el aviso, omitir la cantidad, apagar el panel al detectar un descuadre, o **anular los totales de fila** (`valores[clave] = null`): **1 rojo** tras el arreglo; **sobrevivía** antes (§8) |
| R20 | `tablero-financiero-adaptar.test.ts` :: «doce cubos con techo cinco quedan en cinco categorias» + «doce cubos agrupados al tope del paquete pasan por prepararSeries sin lanzar» + el contrapeso «los mismos doce cubos SIN agrupar desbordan el techo de segmentos del donut» | Quitar la llamada a `agruparCola` en el panel por tienda |
| R21 | `tablero-financiero-adaptar.test.ts` :: «la suma de lo que se pinta es la suma de lo que se recibio» + «una cola entera sin dato produce una categoria ausente, no una que vale cero» | Truncar la cola con un `slice` en vez de agruparla |
| R22 | `TableroFinanciero.test.tsx` :: «cada panel muestra las fechas calendario del propio DTO, sin recalcularlas»; `PanelConciliacion.test.tsx` :: «pinta el rango tal cual lo devuelve el DTO» | Recalcular el rango con `resolverRango` en la pantalla |
| R23 | `tablero-financiero-cargar.test.ts` :: «el validation_error produce estado error con un mensaje construido con las claves»; `TableroFinanciero.test.tsx` :: «emite role=alert con el mensaje saneado del borde» + «no pinta cifras, ni ceros, ni el total de la metrica» | Devolver un panel `ok` con datos vacíos ante un `error` o un `validation_error` |
| R24 | `tablero-financiero-adaptar.test.ts` :: «el cubo se copia tal cual, sin traducirlo ni acortarlo»; `TableroFinanciero.test.tsx` :: «la tabla muestra el identificador interno tal cual, sin resolver el nombre» + «la limitacion de los identificadores esta visible junto a los paneles por tienda» | Resolver el nombre de tienda con una consulta extra (es la ficha 179), u ocultar la limitación |
| R25 | `tablero-financiero.guardia.test.ts` :: «ningun archivo escribe un simbolo de moneda, un codigo ISO ni un locale» + «los archivos que pintan importes formatean con la funcion del paquete» | Escribir un símbolo de colón, un ISO de moneda o un locale en cualquier archivo de la región |
| R26 | `tablero-financiero-rango.test.ts` :: «el filtro por defecto pide la ventana movil de treinta dias» + «ningun otro archivo de la region financiera escribe un preset ni la clave rango» + «esta congelado» + «no depende del momento ni del entorno en que se importa» | Escribir un preset suelto en `cargar.ts`, o leer `searchParams` |
| R27 | `tablero-financiero.guardia.test.ts` :: «ningun archivo declara el dominio del catalogo» + «ningun archivo escribe una lista de ids financieros a mano» + «alguien consume IDS_FINANCIERAS_SERVIDAS» | Filtrar el catálogo por dominio desde el tablero: el guard de fuente única censa ese patrón y esa llamada **coincide con él** |
| R28 | **Este documento** (§2), más el bloque «cobertura del censo» del guard, que exige que los cinco archivos de `financiero/` estén censados por nombre y que la carpeta se **recorra** (un archivo nuevo entra solo) | Añadir un archivo a la región sin traerlo al censo |

Los cuatro censos del guard llevan **autocomprobación**: cada uno se ejercita sobre texto sintético
que contiene el patrón prohibido (lo detecta) y sobre texto limpio (no lo detecta), incluidos los
falsos positivos reales del tablero (la prop de datos `paneles`, el `.map` de los paneles y los
template literals). Sin eso, un censo roto pasaría **por vacío**, que es la forma más cara de tener
un guard en verde.

## 3. Gates

Todos medidos **en esta rama**. Ninguno heredado de otra bitácora: un baseline citado caduca con
cualquier PR ajeno.

| Gate | Resultado |
|---|---|
| `pnpm typecheck` | **0 errores** |
| `pnpm lint` | **0 errores**, 27 warnings — todos preexistentes y ajenos (`_args`/`_input` en tests de otras features) |
| `pnpm exec next build` (**R11**) | **verde**, ver §3.1 |
| Suite completa | ver §3.2 |

### 3.1 `pnpm exec next build` — R11

**Nunca `pnpm build`**, que encadena `migrate deploy` contra una base real. Salida real:

```
▲ Next.js 16.2.10 (Turbopack)
  Creating an optimized production build ...
✓ Compiled successfully in 25.4s
  Running TypeScript ...
  Finished TypeScript in 37.7s ...
  Collecting page data using 11 workers ...
✓ Generating static pages using 11 workers (40/40) in 644ms
  Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /analitica
…
ƒ  (Dynamic)  server-rendered on demand
```

`/analitica` compila como ruta **dinámica** con la región financiera cableada, y el paso de
TypeScript del build termina limpio. Este es el único punto de la feature donde «los tests pasan»
no implicaba «funciona»: la frontera RSC no la cubre ningún gate automático del repo, y un
`"use client"` mal puesto compila los tests y revienta aquí arrastrando Prisma al bundle.

Aviso ajeno registrado por si reaparece: el *type check* posterior al build fallaba en
`app/api/cron/corte-diario/route.ts` por un `export` que no es handler. **En esta corrida no se
manifestó** y, en cualquier caso, es preexistente y no de esta feature.

### 3.2 Suite completa

```
Test Files  2 failed | 840 passed | 8 skipped (850)
     Tests  4 failed | 10512 passed | 130 skipped (10646)
  Duration  581.35s
```

**850 archivos** y **sin bloque `Errors`**: la suite arrancó entera. Es la comprobación que importa
antes de creerse ningún conteo — una corrida con «unhandled errors» de workers omite archivos
enteros y reporta de MENOS pareciendo casi verde.

Los **4 rojos son ajenos**, y los dos se comprobaron **en aislado** antes de darlos por tales:

| Rojo | Qué es | Prueba |
|---|---|---|
| `tests/integration/db/analytics-daily-migration.test.ts` (3 tests) | **Carencia de entorno del worktree**: `C:/w132` solo tiene `.env.example`, así que `prisma migrate diff` no resuelve `DATABASE_URL` | Con `DATABASE_URL` definida: **62/62 verde** |
| `tests/unit/components/filter-component.test.tsx` (1 test) | **Flake por saturación**: no salió en la corrida anterior y cambió de archivo entre corridas (antes fue `recuperar-contrasena-form`) | En aislado: **39/39 verde** |

Perímetro de la feature, corrido aparte y en verde: **10 archivos / 123 tests**
(los siete de la feature más `AnaliticaShell`/`AnaliticaPage` y los dos guards del repo que esta
feature tuvo que actualizar).

> El baseline de `845 archivos / 10 605 tests / 0 fallos` que circulaba venía medido en la rama
> `ux` y **no es comparable** con este número: es otra rama y esta feature añade seis archivos de
> test. Lo comparable es lo de arriba, medido aquí.

## 4. Los dos guards del repo que esta feature puso en rojo

Ninguno de los dos lo detectó el `vitest related` de las tandas: **los dos leen del disco** y por
eso no aparecen en el grafo de imports de los archivos nuevos. Sólo salieron en la suite completa.
Es el argumento entero a favor de correrla.

**1. `tests/unit/guards/censo-simpe.test.ts`.** `PanelConciliacion` etiquetaba la columna como
`SIMPE`, que es el literal histórico que la feature 118 renombró y que ese guard prohíbe en todo el
árbol `app/ lib/ tests/ e2e/`. La grafía canónica del repo es **`SINPE`** con N
(`lib/types/metodo-pago.ts:14`, `lib/analytics/metrics.ts:404`). Corregido; la **clave** del DTO
sigue en minúsculas (`ClaveTotalCierre`), que es lo que el propio guard declara compatible.

**2. `tests/unit/descarga/cobertura-tablas.guardia.test.ts`.** La feature 172 registró
`components/private/analytics/TablaResumen.tsx` como `fuera` **porque no tenía ningún consumidor
montado**, y dejó escrito que «si mañana alguien la monta en una pantalla, el censo obliga a volver
aquí y decidir». Ese primero es esta feature. Se hizo lo que el censo pedía: declarar sus **dos
montajes** (`TableroFinanciero.tsx` y `PanelConciliacion.tsx`) y **sustituir el motivo**. Sigue
`fuera`, pero ya no por «no la monta nadie» —eso dejó de ser cierto— sino porque **la descarga de
analítica es la feature 134** (export CSV), declarada fuera del alcance de la 132. No se relajó el
guard ni se movió ningún total del censo: esta feature no añade instancias de `<DataTable>`, monta
el envoltorio.

## 5. Desviaciones respecto a `design.md`, con su motivo

**D1 — No se usa la prop `totales` de `TablaResumen`** (`design.md §5`, paneles 6, 7 y 9 la
pedían). Esa prop hace que el paquete calcule la fila de totales con `totalizar`
(`TablaResumen.tsx:44-54`), es decir **una suma derivada en coma flotante**, y **R14 lo prohíbe**:
toda cifra pintada debe proceder literalmente de un campo del DTO. Además discreparía del `total`
que la 127 ya calculó en `Prisma.Decimal` aguas arriba, y dos cifras que no cuadran en la misma
tabla son peores que una sola. En su lugar se pinta el **`vista.total` del propio DTO**, con su
bruto y su neto, junto a la tabla. *Coste de revertir:* trivial, pero revertirlo rompe R14.

**D2 — La región financiera no se renderiza sin contenido**, en contra del paso (3) del punto de
extensión de la 129, que pedía un `EmptyState` a juego. Ya estaba declarada en `design.md §3.5` y
ratificada en T0.4/Q4: se sigue **el razonamiento** del propio comentario de la 129 («una región
financiera visible y vacía es peor que no tenerla») y no su instrucción, porque **se contradicen
entre sí**. Es la única forma de que R2 sea cierto sin depender de que el llamador se acuerde de no
pasar la prop.

**D3 — Los nombres accesibles de las piezas internas van prefijados con el título de su panel**
(`… · Distribución`, `… · Comparativa por categoría`, `… · Detalle por categoría`). No estaba en el
diseño. Motivo: `GraficaMarco` emite **su propia** `<section aria-label>`, así que sin prefijo
habría dos regiones anidadas con nombre accesible idéntico — ambiguas para un lector de pantalla y
para `getByRole`.

**D4 — El despacho de panel se hace por la FORMA del DTO** (`tipo`, id de vista vía
`VISTA_COD_RECAUDADO_POR_*`, `grano`, si trae filas) y no con un `switch` sobre ids de métrica.
Motivo: un `switch` por id reintroduciría a mano la lista que **R27** obliga a consumir de
`IDS_FINANCIERAS_SERVIDAS`.

**D5 — La clave del objeto de textos es `etiquetaRango` y no `rango`.** El censo de R26 prohíbe el
patrón `rango:` seguido de un literal en cualquier archivo de la región que no sea `rango.ts`, y lo
detectó en rojo. Se **renombró la clave**; no se relajó el guard.

## 6. Lo que esta feature NO hizo, con su razón

- **Ampliar el acceso a otros roles y recortar paneles por rol → feature 133.** No se tocó
  `ROLES_ACCESO_ANALITICA` ni `ROLES_ANALITICA` (diff vacío, §1).
- **Export CSV → feature 134.** No hay descarga, ni botón, ni serializador. Es además el motivo con
  el que `TablaResumen` sigue `fuera` en el censo de tablas (§4).
- **Barra de filtros → feature 131.** Esta feature consume un rango por defecto (R26) y no pinta
  ningún control.
- **Nombres legibles de tienda → ficha 179.** Se pinta el `tiendaId` crudo con la limitación
  **escrita en pantalla**, no escondida.
- **Serie temporal / gráfica de líneas → ficha 180.** Cinco de las ocho métricas devuelven
  `filas: []` porque la 127 agrega la ventana entera; dibujar una línea exigiría inventarse los
  puntos.
- **E2E de Playwright → feature 133** (Q5), cuando el tablero tenga su forma definitiva por rol y
  no haya que escribirlo dos veces.
- **Caché y `revalidateTag` → feature 128.**

## 7. Pendiente para el leader

- **T6.2** — `./init.sh` completo antes del PR.
- **T6.3** — `git fetch origin dev` + merge (conflicto previsible y pequeño en `AnaliticaShell.tsx`
  y `page.tsx` si la 131 aterriza antes), push y `gh pr create --base dev`. **El implementer no
  abre el PR.**
- **Nota de entorno**: el worktree `C:/w132` no tiene `.env` (solo `.env.example`). Sin él, tres
  tests de `tests/integration/db/` fallan por no resolver `DATABASE_URL`. **No se creó ninguno**:
  escribir un `.env` en un worktree ajeno no es decisión del implementer.
- Las seis respuestas de la puerta F1.4 siguen **PENDIENTES DE RATIFICACIÓN**. La única cuya
  reversión no es barata es **Q3** (sin gráfica de líneas): revertirla bloquea la 132 hasta ampliar
  la 127.

---

# 8. Segunda vuelta — respuesta al RECHAZO del reviewer

`progress/review_132-analitica-tablero-financiero.md`, veredicto **RECHAZADO**: 1 bloqueante y 5
menores. El reviewer lanzó **31 mutaciones propias**; **28 pusieron rojo** y **3 sobrevivieron**.
Ninguna era un defecto funcional —el código cumplía los 28 requisitos— sino **huecos en la red de
tests**. **No se tocó una sola línea de producción para cerrarlos** (`git diff` de `app/` contra el
HEAD anterior: vacío).

## 8.1 Las tres mutaciones supervivientes, ahora muertas

Cada una la **verifiqué yo mismo**, no me fié del subagente: apliqué la mutación sobre el fuente de
producción, corrí los tests, comprobé el rojo, revertí y comprobé que la producción quedaba sin
residuo (`git diff -- app/` vacío).

| Mutación | Antes | Ahora | Qué la mata |
|---|---|---|---|
| **M27 (R3)** — `esAccesoTotal(actor.rol)` → `["maestro","admin"].includes(...)` | **51/51 VERDE** (sobrevivía) | **2 ROJOS** | El quinto censo del guard |
| **M2 (R14)** — el total se **deriva** sumando `vista.filas` en vez de leer `vista.total` | verde (sobrevivía) | **4 ROJOS** | El `describe` de R14 + la fixture descuadrada |
| **M30 (R19)** — `valores[clave] = null`: se anulan los totales de fila | **6/6 VERDE** (sobrevivía) | **1 ROJO** | La aserción sobre los importes de las dos filas |

## 8.2 El bloqueante (R3) y por qué mi mapa mentía

R3 no es un requisito de **comportamiento** sino de **fuente única**: exige que los roles se
deriven de `esAccesoTotal` y **no de una lista escrita de nuevo**. El test que yo había mapeado
compara comportamiento, y `esAccesoTotal` y la lista a mano **coinciden hoy** — así que no podía
distinguirlos. **Sólo un censo del fuente puede.**

Y mi bitácora **declaraba esa mutación como letal cuando no lo era**. Eso es peor que el hueco: R28
convierte este mapa en entregable, y un mapa que afirma una red que no existe hace que el siguiente
lector deje de comprobar. La fila R3 del §2 está corregida, y también la de R14, que mezclaba una
mutación letal (la prop `totales`) con otra que sobrevivía (derivar el total). **Las tres filas
ahora dicen lo que está medido.**

El censo nuevo (quinto del guard) deriva el dominio de roles de `Object.values(RolValue)`: un guard
que reescribiera la lista de roles cometería exactamente el pecado que persigue.

## 8.3 Los 5 menores

| # | Hallazgo | Estado |
|---|---|---|
| menor-1 | R14: total derivado en el componente sobrevive | **CERRADO** (§8.1) |
| menor-2 | R19: los totales por `(nivel, estado)` sobreviven | **CERRADO** (§8.1) |
| menor-3 | La tercera columna del mapa es inexacta en R3 y R14 | **CERRADO**: las dos filas corregidas contra lo medido |
| menor-4 | `design.md` §5 desalineado: sigue pidiendo la prop `totales` | **CERRADO**: nueva §5.1 del design, que **no borra** la tabla equivocada sino que la corrige y explica por qué, con aviso explícito a la 131 y la 134 |
| menor-5 | Bookkeeping: `history.md`, `feature_list.json`, T6.2/T6.3 | **NO es mío**: el propio reviewer lo marca como del **leader**. Declarado, no cerrado |

## 8.4 Sobre la fixture que hacía sobrevivir a M2

El hueco de R14 no era del código: era de la **fixture**. En `cuenta_por_pagar_tienda` la suma de
las filas coincidía exactamente con el total del DTO (121/110), de modo que sumar y leer daban lo
mismo y ninguna aserción podía separarlos. Se **descuadró a propósito**.

> **CORREGIDO en la ronda 3 (menor-6).** La primera versión de este párrafo —y del comentario de la
> fixture— justificaba el descuadre diciendo que «es fiel al dominio: `esAcumulado: true` sale de
> una agregación distinta y no tiene por qué cuadrar». **Eso era falso**, y está corregido en §9.

## 8.5 Gates de la segunda vuelta

| Gate | Resultado |
|---|---|
| `pnpm typecheck` | **0 errores** |
| `pnpm lint` | **0 errores**, 27 warnings preexistentes ajenos |
| `pnpm exec next build` | **verde**: `✓ Compiled successfully in 39.7s`, `Finished TypeScript in 45s`, `/analitica` dinámica |
| Suite completa | `Test Files 3 failed \| 839 passed \| 8 skipped (850)` · `Tests 6 failed \| 10518 passed \| 130 skipped (10654)` |
| Perímetro de la feature | **10 archivos / 131 tests, 0 rojos** |

**850 archivos** (el total esperado) y **cero bloques `Unhandled Error`**: la suite arrancó entera.
Los tests subieron de 10 646 a **10 654** — los ocho que añade esta segunda vuelta.

Los **6 rojos son ajenos**, y los dos que no conocía los comprobé **en aislado** antes de darlos por
tales:

| Rojo | Qué es | Prueba |
|---|---|---|
| `tests/integration/db/analytics-daily-migration.test.ts` (3) | Falta de `.env` en el worktree | Ya medido: 62/62 con `DATABASE_URL`. **No se creó ningún `.env`** |
| `tests/components/LoginForm.test.tsx` + `tests/integration/recuperar-contrasena-form.test.tsx` (3) | **Flakes por saturación** | **33/33 verde en aislado**. Cambian de archivo entre corridas: en corridas anteriores fueron `filter-component` y `recuperar-contrasena`; el reviewer tampoco reprodujo el mío |

Ningún rojo es atribuible a la feature, y **ninguno de los tres arreglos de esta vuelta tocó
producción**.

---

# 9. Ronda 3 — menor-6: el porqué de la fixture de R14 era falso

Ronda 2 quedó **APROBADA-CON-NOTAS** (0 bloqueantes, 28/28, 7 mutaciones nuevas y las 7
discriminaron), con **un menor nuevo**. Este.

## 9.1 Qué estaba mal

Al descuadrar la fixture de `cuenta_por_pagar_tienda` para dar mordida a R14 escribí, como
justificación, que el total «no tiene por qué coincidir» con la suma de las filas porque la métrica
es `esAcumulado: true` y saldría de «una agregación distinta». **Eso es falso, y lo verifiqué yo
mismo antes de corregirlo** en vez de fiarme del reviewer:

- `AnaliticaFinancieraService.ts:284-310` (`deSaldoDeTiendas`) saca **las filas y el total del mismo
  array** (`filas`): las filas agrupando por cubo, el total sobre el array entero.
- El neto lo produce `derivarSaldoTienda` (`lib/utils/saldo-tienda.ts:11-31`), que es una **resta sin
  recorte ni tope**, y por tanto **aditiva**: `Σ(créditos − débitos por tienda) = Σcréditos − Σdébitos`.
- Luego el total **coincide con la suma de las filas por construcción**, y `esAcumulado` no cambia
  nada de eso: cambia el **rango** que se agrega, no la relación entre los cubos y su total.

**Y es más amplio de lo que el hallazgo decía:** al comprobarlo vi que las **dos vistas de
`cod_recaudado`** (`:233-276`) se construyen igual —mismo array para filas y total— así que las
**tres** fixtures que descuadré son artificiales, no sólo la de la cuenta por pagar. El comentario
nuevo lo dice de las tres.

## 9.2 Por qué importaba corregirlo, si la red muerde igual

Porque la única función de ese comentario es **frenar a quien quiera cuadrar los números**. Un
mantenedor que dude va a ir al servicio a comprobarlo, va a ver que el motivo **no se sostiene**, y
entonces «arreglará» la fixture — reabriendo exactamente el hueco que el comentario existía para
evitar. **Un comentario que se cae al primer intento de comprobarlo es peor que ninguno**: gasta la
confianza del lector y encima le da la razón para deshacer el arreglo.

## 9.3 Qué dice ahora

Que el descuadre es **artificial y deliberado**, que en producción **sí cuadra y por construcción**
(con archivo y línea, para que el lector no tenga que fiarse), y cuál es el motivo real: **con los
números cuadrados el test no puede distinguir «leo `vista.total`» de «lo calculo sumando las filas»**,
porque pintan el mismo número — y esa distinción es justo lo que R14 exige, ya que **R14 habla de DE
DÓNDE sale la cifra, no de si dos cifras resultan iguales**. Cierra diciendo que quien venga de leer
el servicio tiene razón sobre producción y que es irrelevante en una fixture, cuyo trabajo es
**discriminar, no parecerse**. Y que cuadrarla deja R14 sin red.

## 9.4 Alcance del cambio

**Sólo comentarios.** No se tocó el dato de la fixture, ni una aserción, ni una línea de producción:

| Comprobación | Resultado |
|---|---|
| `git diff` contra `app/`, `components/`, `lib/` | **0 archivos** |
| Perímetro de la feature | **10 archivos / 131 tests, 0 rojos** |

La contraprueba de que la red sigue mordiendo es que **el dato no cambió**: las mutaciones medidas
en §8.1 siguen siendo válidas tal cual, porque lo único que se editó es el texto que las explica.

