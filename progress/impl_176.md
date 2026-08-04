# 176 — analitica: modo agregado de tasas y tiempos · bitacora de implementacion

> Rama `feature/176-analitica-modo-agregado-tasas`, worktree `C:/w176`.
> Zona `backend`. **Sin migraciones, sin RLS nueva, sin `down.sql`** (`design.md §1.3, §9`):
> esta feature no crea tabla ni columna; todo sale de `analytics_daily`, que ya existe.
> **Sin E2E**: no toca UI ni flujo critico de auth/pagos/recaudo/ingesta/webhooks
> (`CHECKPOINTS.md`); el consumidor visual llega con la ficha frontend de D5.

## 0. Como leer esto

En este repo **un requisito no esta cubierto porque exista un test verde**, sino porque
romper la implementacion pone rojo un test **nombrado**. La tabla de §3 es el nucleo de esta
bitacora: cada mutacion de `requirements.md §3` se aplico de verdad sobre el arbol, se
comprobo con `grep` que **habia aterrizado en el disco** (leccion de la 124, donde un
reemplazo que nunca escribio el archivo se conto como «el test no cubre»), se corrio el test
nombrado, se comprobo el rojo y se revirtio. Tras cada reversion, `git status` limpio.

## 1. Archivos

### 1.1 Modificados (lista cerrada de `design.md §1.1`)

| Archivo | Que se le hizo |
|---|---|
| `lib/types/analitica-operativa.ts` | `CuboAgregado`, `GranoAgregado`, `AgregadoOperativo`, `ResultadoAgregado`, `UNIDADES_AGREGABLES`, `ERROR_UNIDAD_NO_AGREGABLE`, `esUnidadAgregable`. `PuntoSerie`/`SerieOperativa`/`Cobertura`/`ResultadoOperativo` **intactos** |
| `lib/interfaces/services/IAnaliticaOperativaService.ts` | `consultarAgregado(...)` + `OpcionesAgregado`. `consultar` sin tocar |
| `lib/services/AnaliticaOperativaService.ts` | `consultarAgregado` y sus privados (`cubosDeRollupAgregados`, `cubosVivosAgregados`, `fundirEnGrupos`, `ventanaDelCubo`, `lunesDeLaSemanaCR`, `componentesDe`, `seudonimizarCubos`). El comentario de cabecera `:38-40` queda **ampliado**, no sustituido |
| `lib/actions/analitica-operativa.ts` | Server Action `consultarAgregadoOperativo`, con los mismos cuatro pasos y reusando `denegar()` y `sondeaIdentidadDeMensajero` |

### 1.2 Creados

Los 13 tests de `tests/unit/analytics/agregado-*.test.ts` (11 de requisito + los 2 guardias),
el spec `specs/176-analitica-modo-agregado-tasas/**` y esta bitacora.

### 1.3 Desviaciones declaradas (con su motivo)

1. **Dos archivos de test de la 126 tocados, fuera de `design.md §1.1`.**
   `tests/unit/analytics/operativa-oraculo.test.ts` y
   `tests/unit/analytics/analitica-operativa-action.test.ts`. Es **colateral obligado** de
   anadir `consultarAgregado` a `IAnaliticaOperativaService`: sus dobles implementan la
   interfaz y sin el metodo nuevo **el arbol no compila**. Lo unico que se les anade es un
   stub que **lanza** —«este doble no sirve el agregado»—, de modo que si algun dia el borde
   de la serie llamase al agregado el test lo diria a gritos en vez de devolver un objeto
   plausible. Estan declarados con este motivo en la constante `PERMITIDOS` del guardia de
   frontera, no colados en silencio.
2. **`denegar()` cambia su tipo de retorno**, de `ResultadoOperativo` a
   `{ readonly status: "forbidden" }`. Es un **estrechamiento de tipo**, no de conducta: los
   dos llamadores lo siguen aceptando y el cuerpo de la funcion no cambia. Se hace
   precisamente para poder **reusarla** desde el agregado en vez de estrenar una segunda
   forma de responder 403 que alguien pueda olvidar auditar (motivo escrito en `:196-198`).
   `consultarAnaliticaOperativa` y `construirServicio` no se tocan.
3. **`en_ruta` / `en_bodega` en el fixture del aging: rojo real, arreglado.** El caso de R11
   fabricaba sus `EtiquetaEstatus` con dos de los **7 values retirados** por la 153, que el
   censo `tests/unit/guards/censo-order-status-rename.test.ts` prohibe fuera de su allowlist.
   No se veia corriendo solo `tests/unit/analytics`: aparece en `pnpm run test:guardias`. Se
   arreglo **el codigo nuevo, no el guardia**: los `value` pasan a ser `en_reparto` y
   `en_bodega_central`, dos values **vigentes** de `ORDER_STATUS_SEED`
   (`lib/types/order-status.ts:54-79`). El fixture no necesitaba la nomenclatura anterior
   para nada. Commit `622003e5`.

### 1.4 Deuda declarada y divergencia observada (T6.3)

1. **Deuda: dos definiciones de «lunes» en el repo** (`design.md §6.1`). La del servicio,
   `lunesDeLaSemanaCR` en `lib/services/AnaliticaOperativaService.ts:707-718`, y la del
   cliente, `lunesDeLaSemana` en
   `app/(app)/analitica/_components/operativo/agregacion.ts:80-88` (feature 131). Esta
   feature **no puede** unificarlas: `lib/` no depende de `app/`, y mover la copia del
   cliente seria escribir en el subarbol de otra feature y romper su propio guardia de
   frontera (R18). Es deuda **con dueno y con fecha de vencimiento**: la ficha frontend que
   sale de D5 (`requirements.md §5`) **borra** la copia del cliente para `porcentaje` y
   `segundos` al consumir cubos semanales del servidor. Mientras dure, lo unico que la
   contiene es `tests/unit/analytics/agregado-semana.test.ts`, que compara el ancla del
   servicio contra el **preset `semana` de `lib/analytics/ranges.ts`** y no contra una
   constante escrita a mano. Un calculo duplicado en dos capas se desincroniza solo, y nada
   avisa.
2. **Divergencia observada y NO corregida desde aqui, para la 175** (`design.md §1.3`):
   `incidentes` (`lib/analytics/metrics.ts:220`) y `sin_gestionar` (`:242`) siguen marcadas
   `estadoProduccion: "declarada"` pese a tener columna en `analytics_daily` y ser servidas
   por la 126. **No se toca `lib/analytics/metrics.ts`**: el catalogo es de la 127 y sus
   divergencias las corrige la 175, que se implementa en paralelo. No afecta a esta feature:
   ninguna de las dos metricas es `porcentaje` ni `segundos`, asi que ninguna es agregable.

## 2. Mapa `R<n>` -> test que MUERE

Cada entrada nombra el caso que **cae de verdad** bajo su mutacion, no un hermano suyo que
siga verde (anclaje silencioso: el fallo que aparecio en la 125, la 126 y la 131).

| R | Archivo | Caso que muere |
|---|---|---|
| R1 | `agregado-contrato.test.ts` | «cada cubo agregado trae numerador y denominador ademas del valor» |
| **R2** | `agregado-tasas.test.ts` | «con dias de volumen desigual la tasa del periodo suma antes de dividir y no promedia los dias» |
| R3 | `agregado-tiempo-ciclo.test.ts` | «el tiempo de ciclo del periodo es Σ acum / Σ n a traves de DIAS distintos» |
| R4 | `agregado-tasas.test.ts` | «denominador cero devuelve valor null con numerador y denominador en 0, no una tasa de 0» |
| R5 | `agregado-contrato.test.ts` | «la respuesta agregada sobrevive a JSON.stringify y no lleva bigint» |
| R6 | `agregado-tasas.test.ts` | «el denominador de las tres tasas es gestiones, no ordenes creadas» |
| R7 | `agregado-tasas.test.ts` | «el denominador de primer_intento_ok es entregas» |
| **R8** | `agregado-coherencia.test.ts` | «sobre un unico dia cerrado el agregado coincide con el punto de la serie de la 126» |
| R9 | `agregado-cobertura.test.ts` | «la respuesta agregada declara cobertura con las fechas no comparables del rango» |
| R10 | `agregado-dia-en-curso.test.ts` | «el cubo que contiene el dia en curso viaja parcial con su corteAt, y el que solo tiene dias cerrados no» |
| R11 | `agregado-aging.test.ts` | «aging_por_estado agrega la dimension al corte en un unico cubo parcial» |
| R12 | `agregado-metricas-admitidas.test.ts` | «una metrica de conteo se rechaza con validation_error y no se agrega» |
| R13 | `agregado-alcance.guardia.test.ts` | «ninguna firma del modo agregado recibe filtro, alcance o rango sueltos» |
| R14 | `agregado-action.test.ts` | «un denegado se audita antes de responder forbidden y viaja sin datos ni motivo» |
| R15 | `agregado-identidad.test.ts` | «bajo politica seudonima los cubos por mensajero no llevan ids reales y el filtro por mensajero se deniega» |
| R16 | `agregado-alcance.guardia.test.ts` | «el modo agregado no declara metricas propias: todas salen del catalogo» |
| R17 | `agregado-alcance.guardia.test.ts` | «el modo agregado consume agregarCubos y no anade metodos al repositorio del rollup» |
| R18 | `agregado-frontera.guardia.test.ts` | «el diff contra origin/dev no toca ningun archivo fuera de la lista declarada» |
| R19 | `agregado-semana.test.ts` | «el grano semana ancla en el mismo lunes que el preset `semana` de `ranges.ts`» |

**19/19 requisitos con test nombrado y mutacion verificada.**

## 3. Mutaciones aplicadas -> test que murio

Todas verificadas con `grep` en el disco **antes** de correr el test. Todas revertidas
despues, con `git status` limpio comprobado.

| R | Mutacion aplicada (donde) | Verificacion en disco | Test que murio |
|---|---|---|---|
| R1 | `componentesYValor` devuelve solo `{ valor }` (`AnaliticaOperativaService.ts`) | `grep 'return { valor: razon'` -> linea 735 | ✅ «cada cubo agregado trae numerador y denominador…» (+2 de R5 por arrastre) |
| **R2** | La salida del cubo pasa por un `mutMediaDeMedias` que **promedia los valores diarios** en vez de usar las medidas fundidas; activo **solo** para las 4 tasas | `grep 'mutMediaDeMedias\|porDia'` -> 7 lineas | ✅ «con dias de volumen desigual…» (0,5455 en vez de 0,10). **`agregado-tiempo-ciclo.test.ts` quedo VERDE** bajo esta mutacion: la restriccion por metrica demuestra que el rojo no es colateral |
| R3 | La misma, activa **solo** para `tiempo_ciclo` | `grep 'MUT_METRICAS = '` -> `Set(["tiempo_ciclo"])` | ✅ «…Σ acum / Σ n a traves de DIAS distintos» (505,6 en vez de 110) |
| R4 | `valor: denominador === 0 ? 0 : razon(...)` | `grep 'denominador === 0 ? 0'` -> linea 735 | ✅ «denominador cero devuelve valor null…» |
| R5 | `numerador: m.segCicloAcum` (el `bigint` crudo, sin `Number()`) | `grep 'm.segCicloAcum as never'` -> linea 754 | ✅ «la respuesta agregada sobrevive a JSON.stringify…» (`TypeError` de `JSON.stringify(BigInt)`) |
| R6 | Denominador de las 3 tasas -> `m.ordenesCreadas` | `grep 'denominador: m.ordenesCreadas'` -> 3 lineas | ✅ «el denominador de las tres tasas es gestiones…» |
| R7 | Denominador de `primer_intento_ok` -> `denominadorDeGestiones(m)` | `grep 'primerIntentoOk, denominador'` -> linea 750 | ✅ «el denominador de primer_intento_ok es entregas» |
| **R8** | **Dividir-y-sumar**: la media se toma **por cubo crudo** (los dos cubos de zona del MISMO dia), no por dia; activa solo para `tasa_entrega` | `grep 'mutK'` -> lineas 661-664 | ✅ «sobre un unico dia cerrado el agregado coincide con el punto de la serie…» |
| R9 | `cobertura` deja de emitirse en la respuesta agregada | `grep 'false ? { cobertura }'` -> linea 249 | ✅ «la respuesta agregada declara cobertura…» (+2 casos hermanos) |
| R10 | No se propagan `parcial`/`corteAt` al cubo | `grep 'false && g.corteAt'` -> linea 284 | ✅ «el cubo que contiene el dia en curso viaja parcial con su corteAt…» |
| R11 | El aging deja de fundirse: un cubo **por estatus** aunque no se pida desglose | `grep 'return fila.estatusId'` -> 2 lineas | ✅ «aging_por_estado agrega la dimension al corte en un unico cubo parcial» |
| R12 | Se anula la comprobacion de `unidad` en **el borde y el servicio** | `grep 'false && !esUnidadAgregable'` -> accion:180 y servicio:225 | ✅ «una metrica de conteo se rechaza con validation_error y no se agrega» |
| R13 | Se anade `filtro: AnaliticaFiltroInput` a la firma de `consultarAgregado` en la interfaz | `grep 'filtro: AnaliticaFiltroInput'` -> linea 74 | ✅ «ninguna firma del modo agregado recibe filtro, alcance o rango sueltos» |
| R14 | `return { status: "forbidden" }` directo, **sin** `denegar()` (sin `logger.logError`) | `sed -n '168,172p'` muestra el retorno desnudo | ✅ «un denegado se audita antes de responder forbidden…» |
| R15 (a) | Los cubos se devuelven **sin** `seudonimizarCubos` | `grep 'seudonimizarCubos'` -> solo la definicion, ya sin uso | ✅ «bajo politica seudonima los cubos por mensajero no llevan ids reales…» |
| R15 (b) | Se salta `sondeaIdentidadDeMensajero` en el borde del agregado | `grep 'false && sondeaIdentidad'` -> linea 173 | ✅ el mismo caso (su segunda mitad, la del filtro denegado) |
| R16 | Se declara `case "tasa_inventada"` en `componentesDe` | `grep 'tasa_inventada'` -> linea 751 | ✅ «el modo agregado no declara metricas propias…» |
| R17 | Se anade `agregarPeriodo(...)` a `IAnaliticaOperativaRollupRepository` | `grep 'agregarPeriodo'` -> linea 109 | ✅ «el modo agregado consume agregarCubos y no anade metodos…» |
| R18 | Un archivo **fuera de la lista** entra en el diff: `lib/analytics/mut-176-temporal.ts`, en un commit temporal (el guardia mide `origin/dev...HEAD`, luego la mutacion tiene que estar **commiteada**) | `git diff --name-only origin/dev...HEAD` lo lista | ✅ «el diff contra origin/dev no toca ningun archivo fuera de la lista declarada» |
| R19 | La semana se ancla en **domingo**: `-(diaDeLaSemana % 7)` en vez de `-((diaDeLaSemana + 6) % 7)` | `grep 'diaDeLaSemana % 7'` -> linea 717 | ✅ «el grano semana ancla en el mismo lunes que el preset `semana`…» |

**19/19 mutaciones aplicadas, 19/19 mataron su test nombrado. Ninguna quedo verde.**

### 3.1 Sobre las tres que deciden la feature

- **La aritmetica (R2/T4.1 y R3/T4.2).** Los datos del test estan desequilibrados a
  proposito (dia 1: 1 de 1; dia 2: 9 de 99), la asercion es **doble** —afirma `0,10` y
  **niega** `0,5455`— y los **dos cubos estan en fechas DISTINTAS**
  (`2026-08-01` / `2026-08-02`), comprobado leyendo el archivo y ademas afirmado dentro del
  propio test (`agregado-tiempo-ciclo.test.ts:36`: `expect(cubos[0].fecha).not.toBe(cubos[1].fecha)`).
  **No** repite la forma de `operativa-tiempo-ciclo.test.ts:22-29`, que usa dos **zonas del
  mismo dia** —caso que la 126 ya resuelve bien— y con el que este test habria pasado igual
  de verde con la implementacion mala. La mutacion de R2 se restringio a las tasas y dejo
  `agregado-tiempo-ciclo.test.ts` **verde**, y la de R3 al reves: el rojo de cada una es
  **suyo**, no arrastre del otro.
- **R8, el ancla.** El test usa **el mismo doble de repositorio y el mismo servicio** para
  los dos caminos, y ademas afirma que las dos llamadas a `agregarCubos` reciben los
  **mismos granos y la misma consulta** (`agregado-coherencia.test.ts:90-92`). Por eso la
  mutacion que lo mata no puede ser la de R2 —sobre un solo dia no hay nada que promediar—
  sino la de **dividir-y-sumar por cubo crudo**: es exactamente el error que impide que el
  agregado derive de la serie con una formula paralela.
- **T5.3, los guardias.** Ver §4.

## 4. T5.3 — ningun guardia cuelga del que caduca

- **Conteo de archivos de guardia: 53 en el merge-base (`d32b42cb`) -> 55 en `HEAD`.** No
  baja: sube en los dos que anade esta feature.
- `pnpm run test:guardias`: **54 archivos / 730 tests, 0 rojos.**
- **Nada perenne cuelga del caduco.** La unica mencion de `agregado-frontera.guardia.test.ts`
  fuera de si mismo es **prosa** en la cabecera de `agregado-alcance.guardia.test.ts:10`, que
  explica por que viven separados. No hay import, ni helper compartido, ni fixture comun:
  **borrar el archivo caduco no se lleva por delante ni un assert perenne.** Es la leccion
  registrada en la 128, donde hubo que mudar un guardia de archivo por esto mismo.
- **Recordatorio para el PR:** `tests/unit/analytics/agregado-frontera.guardia.test.ts`
  **se retira en el PR que mergea la 176**. Mide `origin/dev...HEAD`; en cuanto esto este en
  `dev`, ese diff deja de ser «lo que hizo la 176» y pasa a juzgar cualquier rama posterior.
  Su cabecera lo dice literal y el archivo no contiene ningun assert que deba sobrevivir.

## 5. Verificacion

### 5.1 Baseline (heredado del leader, medido antes de mi turno)

- `tests/unit/analytics`: **97 archivos / 991 tests, 0 rojos.**
- `pnpm typecheck`: limpio.
- Mutaciones verificadas: **0 de 19**. `progress/impl_176.md`: no existia.
  `tasks.md`: 1 marcada de 23.

Ese baseline **no incluia los guardias**, y ahi estaba escondido el unico rojo real (§1.3.3).

### 5.2 Final (medido por mi)

```
$ pnpm typecheck
> tsc --noEmit
(sin salida: limpio)

$ pnpm lint
✖ 44 problems (0 errors, 44 warnings)
```
Los 44 son **warnings preexistentes** de `@typescript-eslint/no-unused-vars` en archivos
ajenos a esta feature: `pnpm lint | grep -iE "agregado|analitica-operativa|AnaliticaOperativaService"`
no devuelve **ni una linea**. 0 errores.

```
$ pnpm exec vitest run tests/unit/analytics
 Test Files  97 passed (97)
      Tests  991 passed (991)

$ pnpm run test:guardias
 Test Files  54 passed (54)
      Tests  730 passed (730)
```

Suite completa: ver §5.3.

### 5.3 Suite completa

```
$ pnpm exec vitest run
 Test Files  1 failed | 900 passed (901)
      Tests  1 failed | 11069 passed (11070)
```

**901 archivos**, no una corrida degradada: vitest no reporto ni un *unhandled error* de
workers, que es lo que hace que la suite omita archivos enteros y parezca casi verde. El
conteo de **archivos** se comparo a proposito, no el de tests.

**El unico rojo es ajeno a esta feature y esta diagnosticado:**

```
FAIL tests/integration/actions/analitica-financiera-action.test.ts
     > F.4 · pago + contraasiento ajuste en el mismo rango: bruto 800, neto 0
DriverAdapterError: el nuevo registro para la relacion «wallet_movimiento» viola
la restriccion «check» «wallet_movimiento_tipo_categoria_check»
```

- **No lo causa esta rama.** El archivo no esta en el diff y no importa **ni uno** de los
  cuatro archivos que la 176 toca: consume `analitica-financiera` (127), no la operativa.
- **Es drift de la base COMPARTIDA entre worktrees.** El `CHECK` que lo rechaza lo introduce
  `da79136e feat(173): el CHECK categoria<->tipo de la caja`, un commit que **esta en
  `origin/dev` y NO en esta rama** (`git log origin/dev --not HEAD -- db/migrations`). Otro
  worktree ya aplico esa migracion sobre el Postgres compartido, asi que la base tiene hoy
  una restriccion **mas estricta** de la que conoce el codigo de esta rama, que va **71
  commits por detras de `dev`**. Se resuelve solo cuando el leader sincronice con `dev` en
  T6.4; no hay nada que arreglar aqui.
- **No se corrio ninguna migracion ni `db:rollback`** desde este worktree (§0).

Ademas, `tests/components/CuentasPorPagarTable.test.tsx` fallo en **una** de las tres
corridas y **paso en aislado**: flake por saturacion, no regresion. Se comprobo antes de
contarlo.

### 5.4 Una nota de honestidad sobre T1.2

El criterio de HECHO de T1.2 pedia observar un estado **transitorio** —que
`AnaliticaOperativaService` dejara de compilar por metodo ausente entre anadir el metodo a la
interfaz (T1.2) e implementarlo (T2.1)—. Ese instante ya no existia cuando yo tome el
relevo: el arbol llegaba con las dos cosas hechas y **reproducirlo habria exigido romper el
servicio a proposito**. Verifique el invariante equivalente y comprobable: la interfaz declara
`consultarAgregado`, el servicio lo implementa, `pnpm typecheck` esta limpio, y la mutacion de
**R13** —anadir un parametro a esa firma— efectivamente rompe el guardia. Se marca `[x]` con
esta salvedad escrita, no en silencio.

## 6. Veredicto

**Los 19 requisitos estan cubiertos por un test nombrado cuya mutacion lo mata**, la frontera
de `design.md §1` se cumple con dos desviaciones declaradas y con motivo, y el unico rojo
real que quedaba —el fixture del aging contra el censo de nomenclatura de la 153— esta
arreglado en el codigo nuevo, no en el guardia.
