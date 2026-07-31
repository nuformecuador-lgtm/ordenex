# Feature 135 - analitica: catalogo de KPIs + rangos temporales · bitacora de implementacion

> Rama de trabajo: `feature/135-analitica-catalogo-kpis-rangos` (creada desde `origin/dev` @ `664840f3`).
> Spec aprobado por el humano el 2026-07-30; puerta T0 CERRADA (D1-D10).
> Backend PURO: sin migracion, sin UI, sin Server Actions.
>
> **ESTADO: implementacion COMPLETA, REVISADA y CERRADA por el leader.**
> **La medicion que vale es la de la SECCION 12** (2026-07-30, posterior al review); la seccion 11
> queda como rastro y las secciones 1 y 5 como historia de la sesion interrumpida.
> Titulares: `typecheck` y `lint` en **verde**; **R22 cerrado por mutacion** (los 3 supervivientes
> del review, muertos); delta contra `dev` @ `72b75954` **medido con baseline propio**:
> 646/7627/22 rojos -> **655/7807/20 rojos**, subconjunto estricto = **cero regresiones**.
> **`pnpm test` e `./init.sh` siguen ROJOS por causa ajena** —`dev` viene rojo del PR #212 y la
> regla 1 esta violada en `frontend`—, asi que **T6.1 se queda sin marcar**.
>
> ⚠️ **El diagnostico de «contaminacion del cliente Prisma» que esta bitacora repite mas abajo
> resulto FALSO.** La causa era que la rama iba 45 commits por detras de `dev`. Ver 12.1.
> Nada de lo que sigue se da por hecho sin salida real pegada.

---

## 1. Bloqueo de la sesion interrumpida (RESUELTO - rastro historico)

> **Resuelto el 2026-07-30 con un worktree aparte.** El checkout principal sigue en `ux` con el
> trabajo de otra sesion y no se toco. La medicion valida esta en la **seccion 11**. Esta seccion
> se conserva porque explica por que las salidas de la seccion 5 estan partidas en dos.


**Otra sesion movio este checkout de `feature/135-analitica-catalogo-kpis-rangos` a `ux`
mientras la implementacion corria.** Rastro objetivo (`git reflog`):

```
4c1bc188 HEAD@{0}: checkout: moving from feature/135-analitica-catalogo-kpis-rangos to ux
ed5f66bd HEAD@{1}: reset: moving to HEAD
ed5f66bd HEAD@{2}: commit: spec(135-analitica-catalogo-kpis-rangos): cierra la puerta F1.4
f3d8842c HEAD@{3}: commit: spec(135-analitica-catalogo-kpis-rangos): catalogo de KPIs, rangos y filtros
664840f3 HEAD@{4}: checkout: moving from ux to feature/135-analitica-catalogo-kpis-rangos
```

Consecuencias medidas, no supuestas:

- Los **13 archivos de codigo de la 135 sobrevivieron**: estaban *untracked* y viajaron con el
  arbol de trabajo. `git status --porcelain` los muestra como `?? lib/analytics/` y
  `?? tests/unit/analytics/`.
- **`specs/135-analitica-catalogo-kpis-rangos/` desaparecio del disco**: solo existe en el commit
  `ed5f66bd` de la rama 135. Con el se perdieron **las marcas `[x]` de `tasks.md`** que el
  implementer habia ido escribiendo (recuperables con `git show`, 22 casillas).
- Se perdieron tambien las dos ediciones a archivos **trackeados**: el alta en la `ALLOWLIST` de
  `tests/unit/guards/censo-order-status-rename.test.ts` y la modificacion de `feature_list.json`.
- El arbol actual es el de `ux` (`4c1bc188`), que **no** es la base de la 135. Por eso
  `pnpm run typecheck` da 2 errores preexistentes de `ux` y el guard de frontera censa los ~90
  archivos del rediseno `ux`.

**No se ejecuto ningun `git checkout`, `reset`, `stash` ni operacion destructiva desde esta
sesion**, por instruccion explicita. La verificacion final (T6.1) exige estar en la rama 135 y
la decide el humano/leader.

---

## 2. Archivos creados

Codigo de produccion - `lib/analytics/` (4 archivos, ninguno fuera):

| Archivo | Contenido |
|---|---|
| `lib/analytics/types.ts` | dominios cerrados, `Metrica` (12 campos), `DefinicionMetrica`, `FuenteMetrica`, `RangoResuelto`, `EntradaRango`, `DIMENSIONES`, `ROLES_ANALITICA`, `RANGO_PRESETS`, `MENSAJERO_SIN_ASIGNAR`, `RANGO_TOPE_DIAS = 366`. Unico import: `import type { OrderStatusValue }`. |
| `lib/analytics/metrics.ts` | `METRICAS` (23), `MetricaId`, `getMetrica`, `listarMetricas`, `sonSumables`, `ANALITICA_TAGS`, `tagDeDominio`. |
| `lib/analytics/ranges.ts` | `resolverRango(entrada, now?)` para `dia` / `semana` (lunes) / `mes` (30 dias moviles) / `personalizado`. Solo sobre `fecha-cr.ts`. |
| `lib/analytics/filters.ts` | `analiticaFiltroSchema` (`.strict()`, zod v4), los 4 `.refine` de R29, `parseAnaliticaFiltro` discriminado. |

Tests - `tests/unit/analytics/` (9 archivos):

`types.test.ts`, `metrics.test.ts`, `metrics-dinero.guardia.test.ts`,
`definiciones-catalogo.guardia.test.ts`, `ranges.test.ts`, `ranges-reuso.guardia.test.ts`,
`filters.test.ts`, `modulo-puro.guardia.test.ts`, `frontera.guardia.test.ts`.

Archivos trackeados que la 135 necesita tocar:

- `tests/unit/guards/censo-order-status-rename.test.ts` - una entrada en `ALLOWLIST`,
  **REAPLICADA** en el worktree (seccion 11.2). Ver el porque en la seccion 6.
- `specs/135-.../tasks.md` - **18 de 22 casillas marcadas**, **REAPLICADAS** (seccion 11.2).
- `feature_list.json` - bookkeeping de T0.3 / T6.3 / T6.5, **NO aplicado** (lo hace el leader).
  Ver seccion 7.

R25 (texto literal del requisito) permite `lib/analytics/**` mas sus tests en **`tests/unit/**`**;
`tests/unit/guards/` cae dentro. La linea 5 de `tasks.md` es una convencion mas estrecha del plan
de tareas, no el requisito.

---

## 3. Mapa `R1..R36 -> test` (los 36, ninguno pendiente)

Formato: **R<n>** - `archivo` - nombres exactos de los tests.

- **R1** - `tests/unit/analytics/modulo-puro.guardia.test.ts`
  - `no declara use server en ningun archivo de lib/analytics`
  - `no importa @/lib/db, repositorios, servicios ni acciones en lib/analytics`
  - `no importa next/headers ni ningun modulo de peticion en lib/analytics`
  - `no importa @prisma/client como valor en lib/analytics`
  - `no lee variables de entorno en lib/analytics`
  - `importa los cuatro modulos sin DATABASE_URL y ninguno lanza`
  - `importar los cuatro modulos no ejecuta efectos observables`
  - `importar dos veces devuelve exactamente los mismos valores congelados`
- **R2** - `tests/unit/analytics/modulo-puro.guardia.test.ts`
  - `metrics.ts es el unico archivo del repo que declara metricas`
  - `metrics.ts si declara metricas: el censo mira donde debe`
  - `el cubo sin_asignar se escribe una sola vez, en lib/analytics (R30)`
- **R3** - `tests/unit/analytics/metrics.test.ts`
  - `declara las 12 claves exactas y ninguna extra`
  - `no compila una entrada a la que le falte unidadDeConteo` (`@ts-expect-error`)
- **R4** - `tests/unit/analytics/metrics.test.ts`
  - `no repite ningun id`
  - `escribe todos los ids en snake_case y ninguno vacio`
  - `encuentra por id cualquier metrica declarada`
  - `devuelve undefined para un id desconocido en vez de lanzar`
- **R5** - `tests/unit/analytics/metrics.test.ts`
  - `restringe dominio a operativa o financiera`
  - `es snapshot si y solo si su fuente es el rollup analytics_daily`
- **R6** - `tests/unit/analytics/metrics-dinero.guardia.test.ts`
  - `toda metrica financiera cita solo ledgers append-only y snapshots de cierre`
  - `ninguna metrica financiera lee orden, gestion_orden, historial ni el rollup`
  - `ninguna metrica financiera es snapshot del rollup operativo`
  - `rechaza una metrica financiera que pretenda recalcular el dinero desde orden`
- **R7** - `tests/unit/analytics/metrics.test.ts`
  - `declara los 5 roles exactos sin apiKey`
  - `usa solo los tres valores del dominio cerrado de alcance`
  - `da acceso total a maestro y admin en toda metrica` (contrastado contra `esAccesoTotal`)
- **R8** - `tests/unit/analytics/definiciones-catalogo.guardia.test.ts`
  - `el catalogo de order_status tiene diecinueve values`
  - `todo estado citado por una metrica pertenece a ORDER_STATUS_SEED`
  - `ninguna metrica cita en_fulfillment, retirado por la feature 155`
  - `ningun archivo de lib/analytics nombra en_fulfillment`
  - `el embudo por estado enumera los diecinueve values vigentes`
- **R9** - `tests/unit/analytics/definiciones-catalogo.guardia.test.ts`
  - `toda categoria citada pertenece a uno de los siete enums autorizados`
  - `los enums autorizados siguen existiendo en db/schema.prisma`
  - `no cita metodos de pago inventados: SINPE va en mayusculas`
  - `las causas de devolucion citadas son las tres del enum vigente`
- **R10** - `tests/unit/analytics/metrics.test.ts`
  - `usa solo dimensiones del dominio cerrado`
  - `incluye siempre el grano fecha`
  - `no repite un grano dentro de la misma metrica`
  - `no compila una dimension inventada`
- **R11** - `tests/unit/analytics/metrics.test.ts` (task T3.5, sin `it.skip`)
  - `primer_intento_ok remite al criterio de intentos vigentes del historial`
  - `primer_intento_ok no declara umbral propio ni columna materializada`
  - `ninguna otra metrica inventa un criterio de intentos distinto`
- **R12** - `tests/unit/analytics/metrics.test.ts`
  - `expone una etiqueta estable por dominio`
  - `deriva la etiqueta de cualquier metrica sin inventar cadenas`
  - `distingue la etiqueta operativa de la financiera`
- **R13** - `tests/unit/analytics/ranges.test.ts`
  - `devuelve una ventana semiabierta para cada preset`
  - `devuelve una ventana semiabierta para un rango arbitrario`
  - `el instante hasta NO pertenece al rango y el anterior si`
- **R14** - `tests/unit/analytics/ranges-reuso.guardia.test.ts`
  - `ranges.ts importa los helpers de @/lib/utils/fecha-cr`
  - `no reimplementa el desfase UTC-6 en ningun archivo de lib/analytics`
  - `no construye fechas con toISOString().slice en lib/analytics`
  - `no usa startOfDayCR como cota en lib/analytics (la trampa del ranking)`
  - `el censo detecta el offset escrito a mano (autocomprobacion del guardia)`
- **R15** - `tests/unit/analytics/ranges.test.ts`
  - `a las 20:00 CR del 14 el dia sigue siendo el 14, no el 15 UTC`
  - `el ultimo milisegundo del dia CR (2026-07-15T05:59:59.999Z) sigue siendo el 14`
  - `un milisegundo despues (2026-07-15T06:00:00.000Z) ya es el dia 15 en CR`
  - `el dia dura exactamente 24 horas`
- **R16** - `tests/unit/analytics/ranges.test.ts`
  - `cumple los invariantes (b)-(e) para toda entrada: $nombre` (12 casos: 3 presets +
    personalizado, con cruces de mes, de anio y bisiesto)
  - `contiene a now solo para los tres presets`
  - `el rango arbitrario respeta las fechas que fija el cliente, sin desplazarlas`
- **R17** - `tests/unit/analytics/ranges.test.ts` (cero `vi.useFakeTimers()` en el archivo)
  - `acepta now explicito sin falsear el reloj global`
  - `usa el instante actual cuando no se pasa now`
- **R18** - `tests/unit/analytics/ranges.test.ts`
  - `da el mismo resultado con TZ=UTC y con TZ=Asia/Tokyo` (tambien `America/Costa_Rica`;
    restaura `process.env.TZ` en `finally`)
- **R19** - `tests/unit/analytics/filters.test.ts`
  - `rechaza una clave desconocida junto a un filtro por lo demas valido`
  - `acepta el filtro sin la clave desconocida (la unica diferencia es esa clave)`
  - `reporta la clave desconocida bajo su propio nombre en fieldErrors`
- **R20** - `tests/unit/analytics/filters.test.ts`
  - `rechaza el filtro sin rango`
  - `rechaza el preset trimestre`
  - `acepta dia, semana y mes sin fechas`
  - `acepta personalizado con su par de fechas`
  - `cubre exactamente los cuatro valores de RANGO_PRESETS`
- **R21** - `tests/unit/analytics/filters.test.ts`
  - `rechaza el escalar en zona_id, tienda_id y mensajero_id`
  - `rechaza la lista vacia de zona_id`
  - `rechaza la lista con un id vacio`
  - `acepta la lista de dos ids en las tres dimensiones`
  - `acepta la ausencia de las tres dimensiones (son opcionales)`
- **R22** - `tests/unit/analytics/filters.test.ts`
  - `rechaza el instante ISO con hora en desde`
  - `rechaza el epoch numerico en desde`
  - `rechaza el instante con offset de huso en desde`
  - `rechaza la fecha sin relleno de ceros 2026-7-5 (el regex es de ancho fijo)`
  - `rechaza los mismos formatos en hasta`
  - `acepta la fecha calendario YYYY-MM-DD`
- **R23** - `tests/unit/analytics/filters.test.ts`
  - `devuelve status ok con el filtro parseado cuando la entrada es valida`
  - `mapea el error a fieldErrors con la clave del campo culpable`
  - `no lanza ante una entrada absurda, ni null, ni undefined`
  - `agrupa bajo la clave general el error que no pertenece a ningun campo`
- **R24** - `tests/unit/analytics/filters.test.ts`
  - `rechaza el campo rol`
  - `rechaza el campo usuario_id`
  - `no declara ninguna clave de rol, sesion ni alcance en su forma`
- **R25** - `tests/unit/analytics/frontera.guardia.test.ts`
  - `encuentra la base de comparacion o declara por que no hay repositorio git`
  - `el guardia mide un diff no vacio y sabe contra que compara`
  - `no anade ni modifica carpetas de migracion en db/migrations`
  - `no toca db/schema.prisma`
  - `no anade rutas, paginas ni componentes en app o components`
  - `no anade acciones, servicios ni repositorios`
  - `todo el codigo tocado vive en lib/analytics, en sus tests o en la excepcion nominal`
  - `el censo de prefijos detecta un archivo prohibido escrito a mano (autocomprobacion)`
  - `la excepcion es nominal: otro archivo de tests/unit/guards SI es infraccion`
- **R26** - este archivo: salida real de `pnpm test` / `typecheck` / `lint` / `./init.sh`,
  seccion 5.
- **R27** - `tests/unit/analytics/ranges.test.ts`
  - `la semana empieza el lunes CR y llega hasta hoy`
  - `el lunes la semana dura un solo dia`
  - `en domingo la semana es la que empezo el lunes anterior y dura siete dias`
  - `cruza el fin de mes sin aritmetica de calendario propia`
  - `cruza el fin de anio sin aritmetica de calendario propia`
  - `empieza SIEMPRE en lunes, cualquiera que sea el dia de la consulta`
- **R28** - `tests/unit/analytics/ranges.test.ts`
  - `el preset mes es una ventana movil de 30 dias, no el mes calendario`
  - `el dia 1 del mes la ventana arranca en el mes anterior`
  - `dura SIEMPRE 30 dias, se consulte el dia que se consulte`
  - `cruza el fin de anio sin aritmetica de calendario propia`
  - `convive con la semana sin homogeneizarse: una tiene borde de calendario y la otra no`
- **R29** - `tests/unit/analytics/filters.test.ts`
  - `exige desde y hasta cuando el rango es personalizado`
  - `rechaza el rango invertido`
  - `acepta la ventana de un solo dia (desde igual a hasta)`
  - `acepta la ventana de 366 dias contando ambos extremos`
  - `rechaza la ventana de 367 dias contando ambos extremos`
  - `toma el tope de la constante RANGO_TOPE_DIAS, no de un literal`
  - `rechaza desde junto a un preset`
  - `rechaza hasta junto a un preset`
  - `rechaza todos los casos como validation_error, nunca como excepcion`
- **R30** - `tests/unit/analytics/metrics.test.ts` + `modulo-puro.guardia.test.ts`
  - `agrupa las ordenes sin mensajero en el cubo sin_asignar`
  - `expone el literal del cubo como constante unica`
  - `no declara sinAsignar en metricas que no agrupan por mensajero`
  - censo repo-wide: `el cubo sin_asignar se escribe una sola vez, en lib/analytics (R30)`
- **R31** - `tests/unit/analytics/ranges.test.ts` + `ranges-reuso.guardia.test.ts`
  - `usa el dia natural de Costa Rica 00:00-24:00`
  - `una gestion de las 19:00 CR cae en el dia CR correcto, no en el siguiente`
  - censo: `no usa startOfDayCR como cota en lib/analytics (la trampa del ranking)`
- **R32** - `tests/unit/analytics/metrics-dinero.guardia.test.ts`
  - `solo los roles de acceso total ven metricas financieras`
  - `no declara ninguna metrica financiera con alcance acotado`
  - `listarMetricas devuelve cero financieras a adminSatelite, adminTienda y mensajero`
  - `listarMetricas devuelve el catalogo entero a maestro y a admin`
  - `rechaza que se le abra el dinero a un cuarto rol`
- **R33** - `tests/unit/analytics/metrics.test.ts`
  - `admite metricas declaradas sin productor`
  - `no compila un tercer estado de produccion`
  - `filtra el subconjunto producido de forma consultable`
  - `combina el filtro de estado de produccion con el de dominio`
- **R34** - `tests/unit/analytics/definiciones-catalogo.guardia.test.ts`
  - `atribuye por la zona de la orden en toda metrica con grano zona`
  - `no declara atribucion de zona en metricas sin grano zona`
  - `ningun archivo de lib/analytics atribuye por la zona del usuario` (censo = 0)
- **R35** - `tests/unit/analytics/metrics.test.ts`
  - `cuenta gestiones vigentes, no ordenes`
  - `no declara una familia paralela por orden`
  - `las tasas se declaran sobre gestiones`
  - `advierte en la descripcion que el denominador no son ordenes`
  - `cita las gestiones anuladas en la descripcion de toda metrica`
  - `apunta el numerador y el denominador de toda razon a ids reales del catalogo`
- **R36** - `tests/unit/analytics/metrics.test.ts`
  - `expone la unidad de conteo de cada metrica dentro del dominio cerrado`
  - `cuenta ordenes en ordenes_creadas y en ordenes_por_estado`
  - `sonSumables devuelve false entre entregas y ordenes_creadas`
  - `sonSumables devuelve true entre entregas y devoluciones`
  - `sonSumables devuelve false entre una metrica de dinero y una de gestiones`

Extra (no exigido por ningun R, pero es la red del contrato de tipos):
`tests/unit/analytics/types.test.ts` verifica contra `db/schema.prisma` que los 5 literales de
`RolAnalitica` existen en `RolValue` y que `apiKey` esta en el esquema pero NO en el subconjunto
de analitica. Un rename de rol en el esquema rompe ahi.

---

## 4. `estadoProduccion` metrica a metrica (D8 / R33)

Criterio: lo que la 126 y la 127 tienen comprometido en `feature_list.json` y las medidas del
rollup de la 123. **20 `producida` + 3 `declarada` = 23.** Una `declarada` **no es deuda** de la
126/127 (D8).

| id | estado | justificacion |
|---|---|---|
| `ordenes_creadas` | producida | 126 volumen; medida `ordenes` del rollup (123) |
| `ordenes_por_estado` | producida | 126 embudo por estado |
| `entregas` | producida | 126 tasas entrega; medida `entregas` (123) |
| `devoluciones` | producida | idem; medida `devoluciones` (123) |
| `rechazos` | producida | idem; medida `rechazos` (123) |
| `reprogramaciones` | producida | idem; medida `reprogramaciones` (123) |
| **`incidentes`** | **declarada** | no aparece en la ficha de la 126 ni en las medidas de la 123: el resultado `incidente` llego con la 154/158, despues de escribirse el lote |
| **`sin_gestionar`** | **declarada** | la 126 no la nombra y no es medida del rollup; el estado si queda cubierto dentro de `ordenes_por_estado` |
| `tasa_entrega` | producida | 126 tasas entrega/devolucion/rechazo |
| `tasa_devolucion` | producida | idem |
| `tasa_rechazo` | producida | idem |
| `primer_intento_ok` | producida | 126 primer-intento; medida `primer_intento_ok` (123) |
| `motivos_devolucion` | producida | 126 motivos de devolucion (`gestion_causa_devolucion`) |
| `tiempo_ciclo` | producida | 126 tiempos de ciclo; medida `seg_ciclo_acum` (123) |
| `aging_por_estado` | producida | 126 aging, explicitamente intradia |
| `cod_recaudado` | producida | 127 COD recaudado por metodo |
| `ingreso_flete` | producida | 127 ingresos Ordenex (flete) |
| `ingreso_comision_cod` | producida | 127 comision COD |
| `ingreso_iva` | producida | 127 IVAs |
| **`egresos`** | **declarada** | la ficha de la 127 compromete ingresos, cuentas por pagar y conciliacion; los egresos de `wallet_movimiento` no aparecen |
| `cuenta_por_pagar_tienda` | producida | 127 cuentas por pagar a tiendas |
| `cuenta_por_pagar_mensajero` | producida | 127 cuentas por pagar a mensajeros |
| `conciliacion_cierres` | producida | 127 conciliacion de cierres |

---

## 5. Salidas reales

### 5.1 Baseline ANTES de tocar nada (rama `feature/135-...`, arbol limpio)

```
$ pnpm test
> ordenex@0.1.0 test C:\Users\Cristian\Documents\trabajo\arc\ordenex
> vitest run

 RUN  v4.1.10 C:/Users/Cristian/Documents/trabajo/arc/ordenex

 Test Files  617 passed (617)
      Tests  6973 passed (6973)
   Duration  199.26s
```

**Baseline = 0 fallos.**

### 5.2 `./init.sh` completo con T1+T5 ya en el arbol (rama 135)

```
✓ lint paso   (19 problems, 0 errors, 19 warnings - todos preexistentes, ninguno en lib/analytics)
 Test Files  618 passed (618)
      Tests  6981 passed (6981)
✓ test paso
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

### 5.3 `./init.sh` con las 6 tareas de codigo completas (rama 135) - **1 ROJO, ya diagnosticado**

```
 ❯ tests/unit/guards/censo-order-status-rename.test.ts (8 tests | 1 failed)
     × no hay coincidencias case-sensitive de los 7 values retirados en app/, lib/, ...

AssertionError: expected [ Array(1) ] to deeply equal []
+ [ "tests\unit\analytics\definiciones-catalogo.guardia.test.ts -> en_fulfillment" ]

 Test Files  1 failed | 625 passed (626)
      Tests  1 failed | 7148 passed (7149)
```

Causa y correccion en la seccion 6. **Delta en ese punto: 0 -> 1 fallo; +9 archivos de test,
+175 tests verdes.** La correccion de la seccion 6 lo lleva de vuelta a 0, pero el checkout ajeno
la borro antes de que se pudiera medir el `./init.sh` final.

### 5.4 Suite de la feature (`pnpm vitest run tests/unit/analytics`), rama 135

```
 RUN  v4.1.10 C:/Users/Cristian/Documents/trabajo/arc/ordenex

 Test Files  9 passed (9)
      Tests  176 passed (176)
   Duration  1.80s
```

### 5.5 `pnpm run typecheck` (rama 135)

```
> ordenex@0.1.0 typecheck C:\Users\Cristian\Documents\trabajo\arc\ordenex
> tsc --noEmit
```
Sin errores. Los `@ts-expect-error` de R3 / R10 / R33 estan validados por `tsc`: una directiva
sin error seria fallo.

### 5.6 `pnpm run lint`

`19 problems (0 errors, 19 warnings)`, **todos preexistentes**; `eslint` sobre los 13 archivos
de la 135 sale limpio (`exit 0`, cero warnings).

### 5.7 Estado del arbol AHORA (rama `ux`, tras el checkout ajeno) - **no es medida valida**

```
$ pnpm vitest run tests/unit/analytics
 ❯ tests/unit/analytics/frontera.guardia.test.ts (9 tests | 3 failed)
 Test Files  1 failed | 8 passed (9)
      Tests  3 failed | 174 passed (177)

$ pnpm vitest run tests/unit/guards/censo-order-status-rename.test.ts
      Tests  1 failed | 7 passed (8)

$ pnpm run typecheck
app/(app)/mis-asignaciones/_components/_TmpSincronizarPlantillasButton.tsx(24,45): error TS2307
app/(app)/ordenes/_components/_TmpProbarJobsButton.tsx(24,34): error TS2307
```

Los 3 rojos de `frontera.guardia.test.ts` censan los ~90 archivos del rediseno `ux`
(`app/(app)/mis-asignaciones/`, `app/globals.css`, `tests/components/`), que **no son de la 135**;
los 2 errores de typecheck son de `ux`. El rojo del censo de la 155 es el alta de `ALLOWLIST` que
el checkout borro. Replicando la logica del guard contra la base real de la 135 (`4c1bc188`):
`lista negra R25 (infractores): []`, `censo positivo: []`.

---

## 6. La unica correccion fuera de `lib/analytics/**` (perdida, hay que reaplicarla)

`tests/unit/analytics/definiciones-catalogo.guardia.test.ts` **debe** citar el literal del value
retirado por la 155: T3.4 exige el caso explicito y R8 exige afirmar que el catalogo de KPIs
**no** lo cita. Eso choca con el guard repo-wide de la 155
(`tests/unit/guards/censo-order-status-rename.test.ts`), que prohibe ese literal fuera de su
`ALLOWLIST`.

La `ALLOWLIST` es el mecanismo que el propio archivo documenta ("una allowlist sin justificacion
es un agujero, no una excepcion"). El parche es **una linea** dentro del `Set` (linea ~65):

```ts
  // 135/T3.4+R8: guard hermano que afirma la AUSENCIA del value retirado en el catalogo de
  // KPIs; necesita nombrarlo para poder censarlo. La migracion de la 155 solo borra la fila si
  // nadie la referencia, asi que puede sobrevivir huerfana y aparecer en un GROUP BY real.
  "definiciones-catalogo.guardia.test.ts",
```

Se descartaron dos alternativas: (a) quitar el literal mata el caso que T3.4/R8 exige;
(b) construirlo por concatenacion **evade** el censo en vez de cumplirlo - seria un agujero real
en el guard de la 155.

Efecto secundario ya resuelto dentro de `frontera.guardia.test.ts`: se anadio
`ARCHIVOS_DE_CODIGO_PERMITIDOS = ["tests/unit/guards/censo-order-status-rename.test.ts"]`
(**rutas exactas, nunca prefijos**), con su justificacion y con un test propio
(`la excepcion es nominal: otro archivo de tests/unit/guards SI es infraccion`) para que la
excepcion no se convierta en puerta abierta. La **lista negra** de R25 (`db/migrations/`, `app/`,
`components/`, `lib/actions/`, `lib/services/`, `lib/repositories/`) queda **intacta** y se
verifico que sigue mordiendo con un archivo temporal en `lib/services/` (borrado con `rm`, nunca
con git).

**El literal es contagioso:** cualquier prosa que lo escriba exige alta en la allowlist. Por eso
los comentarios de `frontera.guardia.test.ts` lo nombran por descripcion ("el septimo de
`OLD_VALUES`"), no por literal.

---

## 7. Bookkeeping NO aplicado (T0.3, T6.3 y T6.5)

Pendiente por el bloqueo de la seccion 1; se deja escrito para aplicarlo de una sola pasada sobre
`feature_list.json` (en LF, **sin** `git checkout` para deshacer, y comprobando que el diff
contenga solo estas altas/modificaciones):

- **T6.3** - entrada 135: `status` y `status_note` con las 10 decisiones D1-D10 del 2026-07-30,
  incluida la **rectificacion de D7** ("el maestro solamente" -> "admin y maestro pueden").
- **T0.3** - alta del **ticket de saneamiento de `RankingService`** acordado en D6. Trabajo
  **fuera** de la 135 y que **no la bloquea**. `maxid` actual = 161, asi que el id libre es 162.
  Debe referenciar D6 y `lib/services/RankingService.ts:60-61`.
- **T6.5** - avisos en la `status_note` de **123, 126, 127, 132 y 133** con la referencia a
  `specs/135-analitica-catalogo-kpis-rangos/design.md` seccion 6.1; en particular la **132** y la
  **133** deben saber que el dominio financiera es de **dos roles** (`esAccesoTotal`) y que **no
  existe** vista financiera recortada para tienda, satelite ni mensajero.

---

## 8. Hallazgos colaterales y consecuencias aceptadas (T6.4)

**(a) Divergencia de "dia" entre `RankingService` y la 144 - ACEPTADA en D6.**
`lib/services/RankingService.ts:60-61` compara columnas `timestamp` contra `startOfDayCR(now)` +
24 h, es decir una ventana de 00:00Z a 24:00Z = **18:00-18:00 hora CR**. Analitica adopta el
**dia natural CR 00:00-24:00** via `inicioDelDiaCREnUtc` (convencion de la 144). Hasta que el
ticket de T0.3 se resuelva, **analitica y ranking reportan cifras distintas para "hoy"**:
divergencia conocida y aceptada, no un defecto a reportar (R31). Queda escrita en la cabecera de
`lib/analytics/ranges.ts` y verificada por `ranges-reuso.guardia.test.ts`.

> **T0.3 CERRADA el 2026-07-30: el ticket es la ficha 166** de `feature_list.json`
> (`pending` / `backend` / `low`), «saneamiento de la ventana de dia de RankingService
> (18:00-18:00 CR)». Cita D6, esta feature y la **alternativa 9 del design** (replicar la ventana
> 18:00-18:00 en analitica se descarto para no propagar el defecto a un rollup persistido que
> luego habria que backfillear).
>
> **Por que 166 y no el id siguiente: el 162 esta DUPLICADO** en `feature_list.json` — lo comparten
> «notificacion del sistema con la app abierta» y «no enviar mensajes de whatsapp sobre ordenes en
> estado no elegible». Es la misma colision que obligo a renumerar la 161 a 165, pero aquella
> renumeracion arreglo **un id de los cuatro**. No se renumera desde aqui: las dos fichas estan
> citadas por escrito fuera de este archivo (la 158 y `progress/current.md`), asi que cual cede el
> id es **decision del humano**.

**(b) Fila huerfana del value retirado por la 155.** El catalogo vigente tiene **19** values
(`ORDER_STATUS_SEED`, `lib/types/order-status.ts:54-74`). La migracion
`20260729140000_order_status_retiro_en_fulfillment` **solo borra la fila si nadie la referencia**,
asi que en una base con historial **sobrevive huerfana** y puede aparecer en un
`GROUP BY estatus_id` real. La **123** y la **126** deben tolerarla en el rollup; el catalogo no
la cita (R8) y hay test explicito.

**(c) `mensajero_id` NULLABLE en el grano del rollup (D5).** El cubo `sin_asignar` obliga a que
`analytics_daily.mensajero_id` sea nullable. Postgres no considera iguales dos `NULL` en un indice
unico, asi que la **123 esta obligada a elegir** entre (i) **indice unico parcial** por cada
combinacion de nulidad, o (ii) un **valor centinela** no nulo en la columna del grano. La 135 no
elige por ella. Si la 123 pone un `UNIQUE` ingenuo sobre el grano, **el upsert diario duplicara
filas** de mensajero no asignado.

**(d) Supuesto NO confirmado: "periodo EN CURSO" (D3).** La segunda mitad de Q3 (periodo en curso
o ultimo periodo completo) **no se respondio**. Se asume periodo **en curso hasta ahora** para los
tres presets (`hasta = inicio del dia CR siguiente al de now`). Es supuesto del spec_author, **no
decision del humano**. Si lo contradice, cambian R15/R27/R28 y sus tests, y nada mas del contrato.
Escrito como tal en la cabecera de `lib/analytics/ranges.ts`, apartado (b).

**(e) Defecto de redaccion en R27 (no bloquea, los valores cuadran).** R27 describe
`now = 2026-07-15T02:00:00Z` como **miercoles** 14 en CR. **2026-07-14 es MARTES**
(`new Date("2026-07-14T06:00:00.000Z").getUTCDay() === 2`). Los valores exigidos **no cambian**:
el lunes de la semana del martes 14 sigue siendo el 13. Se implemento y testeo contra **los
valores**, no contra el nombre del dia. Correccion sugerida al spec: una palabra.

**(f) `GestionCausaDevolucion` tiene 3 valores, no 5.** `design.md` seccion 3.3 y el hecho de
inventario 9 de `requirements.md` dicen "5 valores"; `db/schema.prisma:597` declara
`not_found | wrong_number | wrong_address` y su propio comentario dice "lista CERRADA de 3
valores". `motivos_devolucion` cita los **3 reales**, y el guard de R9 lo verifica **leyendo el
esquema**, no la prosa del spec. Correccion sugerida al spec.

**(g) `conciliacion_cierres` lleva una definicion vacia a proposito.** Los cuatro estados de
cierre (solicitado, aprobado, rechazado, vencido) pertenecen a `CierreEstado`, que **no esta** en
la lista cerrada de siete vocabularios que R9 autoriza a citar en `categorias`. Meterlos habria
obligado a **aflojar el guard de R9**; van en la `descripcion`. Cambiarlo seria un cambio de
contrato de R9, no un detalle de implementacion.

**(h) Las 8 financieras no declaran los granos `zona` ni `mensajero`.** `design.md` seccion 3.3 no
fija granos para las financieras, y su apartado del cubo `sin_asignar` enumera como metricas con
grano `mensajero` exactamente 11 ids, **todos operativos**. Declararlos habria forzado
`sinAsignar` / `atribucionZona`, cuya semantica es la de la **orden**, no la del ledger. Granos
usados: `fecha` en todas, mas `tienda` y `metodo_pago` donde el ledger o el cierre lo soporta.

**(i) Aviso a la 126: no existe `tasa_reprogramacion`.** La ficha de la 126 en `feature_list.json`
la menciona, pero el catalogo cerrado por **D1** no la tiene. **No se anadio**: anadir una metrica
exige una decision humana nueva y fechada (D1).

**(j) Deriva de sesiones paralelas visible en el arbol.** Aparecieron sin commitear
`specs/129-analitica-ruta-shell-sidebar/` y `specs/130-analitica-componentes-graficas/`, ajenos a
la 135. Por eso el **censo positivo** de R25 se limita a **codigo**
(`.ts`, `.tsx`, `.js`, `.sql`, `.prisma`) y excluye el papeleo (`specs/`, `progress/`,
`feature_list.json`, `.md`). La **lista negra** de R25 no se aflojo: si otra sesion deja un
archivo en `app/` sin commitear, el guard falla, y eso es deliberado.

---

## 9. Desviaciones de la letra del design (todas dentro del contrato)

1. **`Metrica<TMetricaId extends string = string>` es generico opcional.** Permite que
   `metrics.ts` estreche `definicion.razon.numerador` y `.denominador` a su union literal
   `MetricaId` **sin** que `types.ts` importe de `metrics.ts` (el ciclo que la seccion 2 del
   design quiere evitar). Los 12 campos de R3 y el chequeo de exceso con
   `satisfies readonly Metrica[]` funcionan igual.
2. **`FuenteLedger.tablas` y `FuenteCierre.tablas` son `readonly TablaDinero[]`** (ledgers union
   cierres) en vez de las tuplas estrictas de la seccion 3.2. Motivo: `cod_recaudado` cruza las
   dos familias en una sola fuente (`cierre_dia` + `wallet_tienda_movimiento`, design 3.3) y con
   las tuplas literales no compilaba. R6 sigue siendo verificable por tipos: el conjunto legal
   financiero es exactamente `TablaDinero` y su interseccion con `orden`, `gestion_orden`,
   `orden_historial_estado` y `analytics_daily` es vacia. `FuenteRollup.tablas` **si** conserva la
   tupla literal, asi que R5 no se afloja.
3. **`filters.ts` deriva `fieldErrors` de `parsed.error.issues`**, no de `flatten()` (zod v4,
   `package.json` declara `"zod": "^4.4.3"`). En v4 `unrecognized_keys` llega con `path: []` y
   caeria en `formErrors`, invisible para un consumidor que solo pinta `fieldErrors`; asi cada
   clave desconocida se reporta **bajo su propio nombre** (`fieldErrors.rol`), que es justo lo que
   R24 quiere hacer visible. Se exporta `CLAVE_ERROR_GENERAL` para el error de forma.
4. **El refine del tope se guarda contra `undefined` y contra `NaN`.** Escrito literal como en el
   design recibiria `undefined` sin fechas; ademas el calculo de dias devuelve `NaN` para una
   fecha que pasa el regex pero no existe (`"2026-13-45"`), y el refine la **rechaza** (falla
   cerrado) en vez de dejar pasar una ventana de duracion desconocida.
5. **`ranges.ts` no contiene ninguna constante temporal propia, ni la duracion de un dia:**
   se **deriva** de los propios helpers
   (`inicioDelDiaSiguienteCREnUtc(ancla) - inicioDelDiaCREnUtc(ancla)`), de modo que el censo de
   R14 es trivialmente cero. El dia de la semana (D2) se lee con
   `inicioDelDiaCREnUtc(fecha).getUTCDay()`, que da el dia CR sin depender del `TZ` (R18) y sin
   `startOfDayCR`.

---

## 10. Que falta para poder declarar la feature terminada

1. Devolver el checkout a `feature/135-analitica-catalogo-kpis-rangos` (**decision del humano**:
   otra sesion lo movio a `ux` y esta sesion tiene prohibido operar git).
2. Reaplicar la linea de `ALLOWLIST` de la seccion 6.
3. Aplicar el bookkeeping de la seccion 7 (T0.3, T6.3, T6.5) sobre `feature_list.json`.
4. Volver a marcar las 22 casillas de `tasks.md` que el checkout borro (recuperables con
   `git show feature/135-analitica-catalogo-kpis-rangos:specs/135-analitica-catalogo-kpis-rangos/tasks.md`).
5. Correr `./init.sh` completo desde la rama 135 y pegar aqui la salida final, sustituyendo la
   seccion 5.3.
6. Actualizar `progress/current.md`.

Hasta que 1-5 esten hechos, **T6.1 no esta cumplida** y esta feature **no esta verificada**.
No me autoapruebo: lo decide el reviewer.

### Estado de las tareas de `tasks.md`

| Bloque | Estado |
|---|---|
| T0.1, T0.2 | ya venian marcadas del spec_author |
| T0.3 | **sin marcar** - alta del ticket de `RankingService`, bloqueada con el resto del bookkeeping |
| T1.1, T1.2 | hechas |
| T2.1, T2.2 | hechas |
| T3.1 - T3.5 | hechas |
| T4.1 - T4.3 | hechas |
| T5.1, T5.2 | hechas |
| T6.1 | **sin marcar** - la suite pasa entera (626/7150, 0 fallos) y `lint` esta limpio, pero `typecheck` e `./init.sh` caen por la contaminacion del cliente Prisma (seccion 11.6, delta 0, causa ajena a la 135) |
| T6.2 | hecha (seccion 3 de este archivo) |
| T6.3 | **sin marcar** - bookkeeping bloqueado |
| T6.4 | hecha (seccion 8 de este archivo) |
| T6.5 | **sin marcar** - bookkeeping bloqueado |

`tasks.md` tiene **22** casillas. **18 quedarian en `[x]`**: las 2 que el spec_author ya habia
marcado (T0.1, T0.2) mas las **16 cerradas por el implementer**. Las **4 restantes** (T0.3, T6.1,
T6.3, T6.5) se dejan **sin marcar, con su razon escrita**, no fingidas.

**Estado real:** las marcas se perdieron cuando el checkout ajeno borro `specs/135-.../` del
disco, y se **REAPLICARON en el worktree** el 2026-07-30 (seccion 11.2). `tasks.md` tiene hoy
**18 `[x]` y 4 `[ ]`**, verificado con `grep`.

---

## 11. Re-verificacion en worktree limpio (2026-07-30) - LA MEDICION QUE VALE

El checkout principal quedo en `ux` con ~100 archivos staged de otra sesion activa y **no se
toco**. El leader monto un **worktree aparte** sobre `feature/135-analitica-catalogo-kpis-rangos`
@ `ed5f66bd`, con `specs/135-.../` de vuelta en disco y los 13 archivos de la 135 movidos alli.
Todo lo que sigue se midio **dentro de ese worktree**.

Estado de partida verificado: `git status --porcelain` = solo `?? lib/analytics/`,
`?? tests/unit/analytics/`, `?? progress/impl_135.md`. Base `ed5f66bd`, que cuelga de `dev` @
`664840f3`: la misma que el baseline original.

### 11.1 Baseline PRISTINO del worktree (mis 13 archivos apartados)

Los 13 archivos se copiaron a un directorio de respaldo, se **movieron fuera** del worktree (con
`mv`, nunca con git), se midio, y se devolvieron. Integridad comprobada con `md5sum` antes y
despues: **los 13 hashes coinciden**, cero perdida.

```
$ pnpm test          # arbol pristino en ed5f66bd
 Test Files  2 failed | 615 passed (617)
      Tests  2 failed | 6971 passed (6973)
   Duration  319.26s
```

**617 archivos / 6973 tests: coincide EXACTAMENTE con el baseline medido en el checkout
principal.** La base es la misma, como se esperaba.

**Los 2 rojos del baseline son FLAKINESS DE ENTORNO, no fallos reales:**
`tests/unit/guards/no-embalaje.test.ts` y `tests/unit/guards/censo-order-status-rename.test.ts`,
ambos por `Test timed out in 20000ms`. Son los dos guards que **recorren el arbol de archivos
entero**; el worktree vive en el filesystem temporal y, bajo la carga en paralelo de la suite
completa, el `walk` pasa de los 20 s. Aislados pasan sin despeinarse:

```
$ pnpm vitest run tests/unit/guards/no-embalaje.test.ts tests/unit/guards/censo-order-status-rename.test.ts
 Test Files  2 passed (2)
      Tests  9 passed (9)
   Duration  1.34s
```

No aparecen en el checkout principal (SSD del proyecto) ni en la corrida final de 11.3.

### 11.2 Reaplicado lo que el checkout ajeno habia borrado

1. **16 casillas `[x]`** en `specs/135-analitica-catalogo-kpis-rangos/tasks.md`. Total: **18 de
   22** marcadas (las 2 de T0 ya venian del spec_author). Las **4 restantes siguen sin marcar,
   con su razon**: `T0.3`, `T6.1`, `T6.3`, `T6.5`.
2. **La entrada en `ALLOWLIST`** de `tests/unit/guards/censo-order-status-rename.test.ts`, con
   una justificacion de 11 lineas **en el propio archivo** que se entiende sin contexto externo:
   explica que `definiciones-catalogo.guardia.test.ts` es un guard **hermano, no infractor** (R8
   exige que ninguna metrica cite el value retirado y T3.4 exige el caso explicito), que para
   censar la AUSENCIA de un literal hay que nombrarlo —igual que le pasa al propio archivo del
   censo, primera entrada de la lista—, que el `DELETE` de la migracion de la 155 solo borra la
   fila si nadie la referencia (de ahi la fila huerfana), y que construir el literal por
   concatenacion se descarto a proposito por ser evasion del guard, no cumplimiento.

### 11.3 Suite completa DESPUES (salida real)

```
$ pnpm test
> ordenex@0.1.0 test C:\...\scratchpad\wt135
> vitest run

 RUN  v4.1.10

 Test Files  626 passed (626)
      Tests  7150 passed (7150)
   Duration  277.09s
```

### 11.4 DELTA

| | archivos | tests | fallos |
|---|---|---|---|
| baseline pristino (`ed5f66bd`) | 617 | 6973 | 2 (timeouts de entorno, pasan aislados) |
| despues de la 135 | 626 | 7150 | **0** |
| **delta** | **+9** | **+177** | **-2 / cero regresiones** |

**Cero tests rotos por la 135.** Los +9 archivos y +177 tests son exactamente los de
`tests/unit/analytics/`. Cuadra: 6973 + 177 = 7150.

Suite de la feature aislada, mas el guard de la 155 que la 135 tuvo que tocar:

```
$ pnpm vitest run tests/unit/analytics tests/unit/guards/censo-order-status-rename.test.ts
 Test Files  10 passed (10)
      Tests  185 passed (185)
   Duration  2.11s
```

**El guard de la 155 quedo EN VERDE** (8/8) con la entrada de allowlist: 177 de analitica + 8 del
censo = 185.

### 11.5 lint

```
$ pnpm run lint
✖ 19 problems (0 errors, 19 warnings)
```
Los **mismos 19 warnings preexistentes**, ninguno en codigo de la 135. Y sobre los archivos de la
feature:

```
$ pnpm exec eslint lib/analytics tests/unit/analytics tests/unit/guards/censo-order-status-rename.test.ts
exit=0
```
Sin una sola linea de salida.

### 11.6 typecheck: 2 errores por CONTAMINACION DEL CLIENTE PRISMA (delta 0, NO son de la 135)

```
$ pnpm run typecheck
lib/repositories/WalletMovimientoRepository.ts(26,5): error TS2322: Type 'WalletOrigenTipo' is not
  assignable to type '"cierre_dia" | "gestion_orden" | "manual" | "pago_tienda" | "pago_mensajero" | "gasto"'.
  Type '"orden_incidente"' is not assignable to ...
lib/types/wallet.ts(72,7): error TS2322: Type 'true' is not assignable to type 'never'.
```

**Diagnostico, verificado:**

- `node_modules` del worktree es un **symlink** al del checkout principal:
  `node_modules -> /c/Users/Cristian/Documents/trabajo/arc/ordenex/node_modules`.
- El **cliente Prisma generado** que hay ahi pertenece al schema de **la otra sesion**, que ya
  incluye el origen `orden_incidente` (feature 158). El schema de **este** worktree no lo tiene:
  `grep -c orden_incidente db/schema.prisma` -> **0**.
- Resultado: tipos fantasma que no existen en la base de esta rama.

**Delta medido, no supuesto.** Se volvio a correr el typecheck con los 13 archivos de la 135
apartados y salen **exactamente los mismos 2 errores**:

```
$ pnpm run typecheck   # SIN lib/analytics ni tests/unit/analytics
lib/repositories/WalletMovimientoRepository.ts(26,5): error TS2322: ...
lib/types/wallet.ts(72,7): error TS2322: ...
```

**typecheck delta = 0.** Ningun error toca `lib/analytics/`. En el checkout principal, antes de
la deriva, este mismo codigo daba `tsc --noEmit` **limpio**.

**Por que NO se arreglo:** la cura es `pnpm db:generate` desde el schema limpio, pero
`node_modules` es un symlink al checkout principal, asi que regenerar el cliente **sobreescribiria
el de la otra sesion, que esta trabajando ahora**. Pisar su entorno es peor que dejar dos errores
diagnosticados con delta cero. **Decision del leader/humano**, no mia.

### 11.7 `./init.sh`

```
== Arnes SDD :: init ==
! jq no esta instalado (recomendado para validar feature_list.json)
✓ node v22.13.1
✓ dependencias presentes
-> pnpm run typecheck
lib/repositories/WalletMovimientoRepository.ts(26,5): error TS2322: ...
lib/types/wallet.ts(72,7): error TS2322: ...
✗ 'pnpm run typecheck' fallo
```

Cae en la **primera** puerta, la del typecheck contaminado de 11.6, y no llega a ejecutar el
resto. Por eso **T6.1 se queda SIN MARCAR**: exige los cuatro en verde y `typecheck` e `init.sh`
no lo estan, aunque el motivo sea ajeno a la feature y el delta sea cero. No se maquilla una
casilla para fingir una verificacion que nadie hizo.

### 11.8 Que sigue faltando

1. **`pnpm db:generate`** con el schema de esta rama, cuando el checkout principal este libre
   (o con un `node_modules` propio para el worktree). Cierra 11.6, 11.7 y **T6.1**.
2. El bookkeeping de la seccion 7: **T0.3**, **T6.3** y **T6.5** sobre `feature_list.json`, mas
   `progress/current.md`. Lo hace el leader; esta sesion tiene prohibido tocar ese archivo.
3. Los dos defectos de redaccion del spec —(e) y (f) de la seccion 8— los lleva **el leader al
   humano**; no se corrigen por cuenta propia porque **(f) cambiaria el catalogo contratado**.

---

## 12. Cierre del leader — 2026-07-30 (sesion posterior al review)

Todo lo de esta seccion esta **medido en un worktree aparte** sobre la rama, con el arbol limpio.
El checkout principal (`ux`) no se movio de rama en ningun momento.

### 12.1 El typecheck NO era "cliente Prisma contaminado" — y ya no cae

El diagnostico de 11.6 (y el que repeti yo al arrancar) era **plausible y equivocado**. La causa
real: la rama iba **45 commits por detras de `dev`**, y el cliente generado ya conocia
`orden_incidente` (feature 158) mientras el schema de la rama no. **Se disolvio al sincronizar con
`dev`**, no regenerando nada:

```
$ git diff --stat origin/dev feature/135-analitica-catalogo-kpis-rangos -- db/schema.prisma
(vacio -> los schemas son byte-identicos)

$ npx tsc --noEmit   ->  exit 0
$ npx eslint         ->  0 errores
```

**Leccion para el arnes:** «cliente Prisma contaminado» es un diagnostico caro de dar por bueno.
Antes de aceptarlo, comparar los dos `db/schema.prisma` — si son iguales, la causa es otra.

### 12.2 R22: los 3 mutantes supervivientes del review, MUERTOS

El review dejo R22 con **3 mutaciones vivas** (unico hueco de la feature): el comportamiento estaba
protegido por **dos redes redundantes** —el regex de ancho fijo y el `.refine` del tope, que trata
`NaN` como rechazo— y los tests solo caian si se quitaban **las dos**. Ningun test discriminaba el
mecanismo que R22 nombra por su nombre.

Tres aserciones nuevas en `tests/unit/analytics/filters.test.ts`, cada una elegida **por medicion**,
no por intuicion:

| caso | regex | `Date.parse` | que red discrimina |
|---|---|---|---|
| `"2026-13-45"` en `hasta` | pasa | `NaN` | solo el `.refine` del tope |
| `desde` = `hasta` = `"2026-13-45"` | pasa | `NaN` | idem, por el lado de `desde` |
| `"+002026-07-15"` (ano expandido ISO) | **rechaza** | valido | solo el regex |

> Descartado sobre la marcha: `"2026-02-30"` **no** sirve. Parece el caso obvio de "fecha que no
> existe", pero V8 la desborda a marzo y `Date.parse` devuelve un valor **finito**, asi que no
> discrimina nada. Se vio corriendo el caso, no leyendo la spec de ECMAScript.

Re-corridas las 3 mutaciones del review, cada una por separado:

```
[base]  Tests  38 passed (38)          # 35 previos + 3 nuevos
[R22]   Tests  1 failed | 37 passed    # desde/hasta a z.string()      -> MUERTA
[R22b]  Tests  1 failed | 37 passed    # fechaCalendario = z.string()  -> MUERTA
[R22c]  Tests  2 failed | 36 passed    # el refine falla ABIERTO       -> MUERTA
```

Suite de analitica: **9 archivos / 180 tests** (eran 177). `git status` limpio tras restaurar.

### 12.3 Delta contra `dev`, medido con baseline propio

No basta con «los rojos no son mios»: se monto un **segundo worktree en `dev` @ `72b75954`** y se
corrio la suite entera en los dos.

| | archivos | tests | rojos | archivos rojos |
|---|---|---|---|---|
| `dev` @ `72b75954` (baseline) | 646 | 7627 | **22** | 7 |
| rama 135 | 655 | 7807 | **20** | 5 |

**Los 20 son subconjunto ESTRICTO de los 22**, test a test. => **CERO REGRESIONES**, y la feature
aporta **+9 archivos / +180 tests**. Los 2 que solo caen en el baseline son los flaky ya conocidos
(`filter-component` debounce y timeout del guard `no-embalaje`), agravados por correr las dos
suites a la vez.

### 12.4 Lo que sigue rojo, y de quien es

1. **`dev` esta ROJO con 20 tests**, todos del rediseno de `ux` que entro por el **PR #212**:
   filtros canton/distrito de la 117 (`MisAsignacionesModule`) y las cards en reparto. **No lo
   introduce esta feature: se lo encuentra.** Es lo que mantiene `pnpm test` en rojo.
2. **`./init.sh` cae ademas por la REGLA 1**: la zona `frontend` tiene **tres** `in_progress`
   (161, 163, 164) y el arnes admite dos. `backend` tiene una sola, la 135. Decision humana.
3. Por eso **T6.1 sigue SIN MARCAR**. Lo demas de T6 esta cerrado.
