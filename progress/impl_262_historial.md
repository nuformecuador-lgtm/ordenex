# Bitácora — feature 262 · BLOQUE HISTORIAL (P1): el rastro se ve en «Ver historial»

> Rama `feature/262-historial`, desde `origin/dev` en `bc574d00`. Worktree aislado, `node_modules`
> por junction desde el repo principal, `prisma generate` antes de cada corrida que importa.
>
> **Alcance de esta tanda:** **B24-B29** y los requisitos **R37-R45**, que hasta hoy **no tenían un
> solo test**. Es lo único que le faltaba a la ficha para poder cerrarse.
>
> ⚠️ **Y una desviación autorizada por adelantado, arriba del todo para que no se lea como un
> descuido:** `tasks.md` planteaba `B24` como una **rotura deliberada del build** en
> `HistorialOrdenTimeline.tsx`. Esa técnica no cabe aquí —el trabajo va en dos tandas y una rama con
> el build roto no pasa el gate ni se puede mergear—, así que **el componente se arregló en esta
> misma tanda, con el alcance MÍNIMO**: estructura correcta y textos de la fuente única, **nada de
> estilo ni de copy fino**. Lo que ocupa el lugar de aquella rotura está en §5.

---

## 1 · Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `lib/interfaces/repositories/IOrdenDiaRepartoCambioRepository.ts` | Contrato de la LECTURA del rastro (**B25**) |
| `lib/repositories/OrdenDiaRepartoCambioRepository.ts` | `findCorreccionesByOrden`, `created_at ASC, id ASC` (**B25**) |
| `tests/unit/services/orden-historial-fusion.test.ts` | 26 tests de la fusión y de la autorización (**B27**) |
| `tests/unit/types/orden-historial-union.test.ts` | El `@ts-expect-error` que hace de R42 algo comprobable (**F8**, la mitad de tipos) |
| `tests/integration/db/correccion-dia-reparto-historial.int.test.ts` | 9 tests contra Postgres real (**B28** + **B29**) |
| `tests/unit/guards/historial-correccion-dia.guardia.test.ts` | 20 tests: lo que sustituye a la rotura deliberada (§5) |

### Modificados

| Archivo | Qué cambió |
| --- | --- |
| `lib/types/orden-historial.ts` | **B24**: `OrdenHistorialTransicionDTO` + `OrdenHistorialCorreccionDiaDTO`; `OrdenHistorialEntradaDTO` pasa a ser la **unión**, conservando el nombre |
| `lib/interfaces/repositories/IOrdenHistorialRepository.ts` | `findHistorialByOrden` devuelve el tipo **estrecho** |
| `lib/repositories/OrdenHistorialRepository.ts` | `toEntradaDTO` añade `clase: "transicion"` |
| `lib/services/OrdenHistorialService.ts` | **B26**: `fusionarLineaDeTiempo` (pura, exportada) + `RANGO_POR_CLASE` + el tercer repo por constructor |
| `lib/utils/dia-reparto-textos.ts` | `ETIQUETA_CORRECCION_DIA` y `textoCorreccionDiaReparto` (**R18/R38**) |
| `app/(app)/ordenes/_components/HistorialOrdenTimeline.tsx` | `switch` exhaustivo + la rama sin transición + la `key` con la clase + `@pendiente-262-f6` |
| `lib/actions/orden-historial.ts` | `buildService` instancia el repo nuevo (**B26**) |
| **13 sitios más** que construyen `OrdenHistorialService` | El tercer repo, obligatorio. Ver §3.1 |
| `tests/unit/repositories/orden-historial-repository.test.ts` | El literal-contrato **CRECE** con `clase`. Ver §3.2 |
| `tests/unit/services/orden-historial-service.test.ts` · `tests/unit/actions/orden-historial-action.test.ts` · `tests/components/{HistorialOrdenTimeline,HistorialOrdenSheet,EstatusBadgeRetiroFulfillment}.test.tsx` | Fixtures que ganan `clase: "transicion"`. **Ninguna aserción vieja cambia de sentido** (R45) |
| `tests/unit/utils/dia-reparto-textos.test.ts` | Sección (5): los textos nuevos, con literales a mano |
| `tests/unit/services/{devolucion-sla-service,intentos-entrega-criterio-unico}.test.ts` · `tests/integration/{_semilla-tablero-dia,db/_semilla-rollup,db/analitica-operativa-equivalencia.test}.ts` | Doble vacío para el tercer repo |

**No se tocó:** `tests/unit/guards/rastreo-frontera.guardia.test.ts` (sigue intacta y verde, R43),
`feature_list.json`, `progress/current.md`, ni ningún `down.sql`. **Esta tanda no añade migración.**

---

## 2 · Mapa `R37`-`R45` → test

Cada uno tiene al menos un test que **existe, corre y muerde** (la mutación que lo mata va al lado;
salida real en §4).

| R | Test que lo defiende | Muere con |
| --- | --- | --- |
| **R37** | `orden-historial-fusion` · «una orden con dos transiciones y dos correcciones devuelve las **CUATRO**, intercaladas por instante» (`toEqual` de la lista entera) + «una orden con SOLO correcciones» + el CONTROL DE NO-VACUIDAD de que las dos clases llegan · `correccion-dia-reparto-historial.int` · «devuelve TODAS las correcciones de la orden» y «**M-ak**: la corrección de OTRA orden NO entra», con su control positivo | **M-y**, **M-ak** |
| **R38** | `dia-reparto-textos` §(5) · 6 casos, **literales escritos a mano** (ida, vuelta, cambio de año, sin siglas, sin `YYYY-MM-DD`, los tres «sin fecha») · `HistorialOrdenTimeline.test` · «las dos fechas EN PALABRAS, su actor, su sello y su motivo», con `not.toMatch(/\d{4}-\d{2}-\d{2}/)` sobre el `textContent` · `correccion-dia-reparto-historial.int` · «con la sesión en `America/Costa_Rica` las dos fechas siguen siendo el día escrito», **con la aserción de que el `SET LOCAL` tomó efecto** | **M-r38**, **M-fec**, **M-x** |
| **R39** | `HistorialOrdenTimeline.test` · «NO se pinta como una transición: ni etiqueta de estado ni flecha», recorriendo **todas** las etiquetas del catálogo, **con su CONTRAPRUEBA** (la misma búsqueda sobre una transición sí las encuentra) · `historial-correccion-dia.guardia` (b) · la rama no nombra `estatusLabel`, **con anti-vacuidad** (la de transición sí) · `orden-historial-union` · `@ts-expect-error` al leer `estatusDestinoValue` sobre una corrección | **M-ac**, **M-r39** |
| **R40** | `orden-historial-fusion` · 6 casos: ascendente con la entrada invertida; el resultado **no cambia** al invertir las dos listas; **empate exacto → transición primero**; el empate con más compañía; el orden preservado dentro de cada fuente · `correccion-dia-reparto-historial.int` · «**TRES filas del MISMO instante** salen desempatadas por `id`, no por cómo se insertaron», con el control de no-vacuidad de que las tres comparten `created_at` | **M-z1**, **M-z2**, **M-z3**, **M-id** |
| **R41** | `orden-historial-fusion` · «el `ok` trae YA fusionadas» + «ordena en el servidor aunque los repos devuelvan sus filas al revés del orden final» · `historial-correccion-dia.guardia` (d) · el componente no tiene `.sort(`, ni `.reverse(`, ni `new Date(` · `dia-reparto-textos` (2) · el módulo de textos sigue sin `Date` ni `Intl` | **M-aa**, **M-z1** |
| **R42** | `orden-historial-union` · **cinco `@ts-expect-error`** que afirman que leer un campo de transición sobre la unión NO compila + el `never` del `default` del componente y el `Record` exhaustivo de `RANGO_POR_CLASE`. Se verifica **compilando**, no ejecutando: el `pnpm typecheck` del gate es su corrida | **M-aj** |
| **R43** | `rastreo-frontera.guardia` **intacta** (sigue prohibiendo `OrdenHistorialEntradaDTO`, que sigue existiendo con el mismo nombre) · `correccion-dia-reparto-historial.int` · **CONTROL POSITIVO**: una orden **con** dos correcciones devuelve por `RastreoPublicoRepository` **exactamente** las mismas transiciones que sin ellas, con doble no-vacuidad (2 transiciones y 2 correcciones de verdad) | **M-r43** |
| **R44** | `orden-historial-fusion` · **5 roles con visibilidad** ven la corrección con su motivo; **4 sin visibilidad** (`adminTienda` ajena, mensajero sin actuación, `adminSatelite` de otra zona, `adminSatelite` sin zona) → el rastro **NI SE LEE**; + rol desconocido y orden borrada. La aserción no es «respeta permisos»: es que la segunda lectura **no se emite** | **M-r44** |
| **R45** | `orden-historial-fusion` §(b) · 3 casos con el resultado escrito **campo a campo a mano** (no contra `[t1,t2,t3]`, que sería su propia fuente) + el del servicio · `orden-historial-service.test` **entero, sin una sola aserción cambiada** · `orden-historial-repository.test` (literal que crece, §3.2) | **M-z3** |

---

## 3 · Decisiones al implementar, y las desviaciones del spec

### 3.1 · El tercer repo del constructor es OBLIGATORIO, y eso son 19 sitios, no 1

`design.md` §14.5 listaba **un solo** sitio a cablear (`lib/actions/orden-historial.ts`). Medido:
`new OrdenHistorialService(...)` aparece en **20 sitios** (14 de producción/scripts + 6 de test).
Los otros 19 usan el servicio **sólo** para `contarIntentos*` y no llaman a `obtenerHistorial`.

**Se hizo obligatorio igualmente.** Un tercer parámetro opcional con «sin correcciones» por defecto
convierte un cableado olvidado en **un drawer que enseña menos de lo que hay y no rompe nada** — el
fallo mudo exacto que esta ficha existe para evitar, y la familia de defectos que más ha costado en
este repo. Con el parámetro obligatorio, olvidarlo es un rojo de `pnpm typecheck`. El precio es que
13 módulos importan un repositorio que no usan; el motivo está escrito en el constructor.

**Se anota como desviación del inventario del spec, no se arregla a ciegas** (criterio de `B24`).

### 3.2 · Un consumidor que el inventario de §14.5 no tenía

`tests/unit/repositories/orden-historial-repository.test.ts` **no aparecía** en la lista de §14.5 —y
no es culpa del spec: el inventario se hizo con `grep` sobre `OrdenHistorialEntradaDTO`, y ese
archivo construye el literal **inline, sin anotación de tipo**, así que no importa el símbolo.

Por eso **el typecheck no lo vio y el gate sí**: `toEqual` compara la forma **entera**. El literal
**se hizo CRECER** con `clase: "transicion"`; no se relajó a `objectContaining`. Ese literal **ES el
contrato** de la fila que sale del repositorio, y cambiarlo por una comparación parcial lo dejaría
verde para siempre.

### 3.3 · `B29` vive en el test de Postgres real, no en el del doble

`tasks.md` pedía «la comprobación positiva **en el test del rastreo público**». Está en
`tests/integration/db/correccion-dia-reparto-historial.int.test.ts` y no en
`tests/integration/repositories/rastreo-publico.int.test.ts`, por una razón que se midió: aquel
archivo usa un Prisma **falso** cuyo tipo es `Pick<PrismaClient, "orden" | "ordenHistorialEstado">`.
Un falso que no tiene la tabla del rastro **no puede demostrar que no se lee**: la ausencia sería
trivial. Contra Postgres real, con la orden teniendo dos correcciones escritas de verdad, sí lo
demuestra — y por eso el test lleva **dos** controles de no-vacuidad.

### 3.4 · R44 se probó con 5 + 4, no con «los cuatro y los dos»

`tasks.md` decía «los cuatro roles con visibilidad y los dos sin ella». Medido sobre
`OrdenHistorialService.autorizar`: hay **cinco** caminos con visibilidad (maestro, admin,
adminTienda de su tienda, mensajero asignado, adminSatelite de su zona) y **cuatro** sin ella
(adminTienda ajena → `not_found`; mensajero sin actuación; adminSatelite de otra zona;
adminSatelite **sin zona**). Se cubren los nueve, más el rol desconocido y la orden borrada.

### 3.5 · La regla de orden es un `sort` con comparador declarado, no un merge

`Array.prototype.sort` es estable desde ES2019, y las dos fuentes entran **contiguas**, así que el
orden dentro de cada una se preserva. El desempate `transición → corrección` va **en el comparador**
y no delegado a la concatenación (design §14.3). El `Record<clase, number>` es exhaustivo: una
tercera clase **no compila**.

Se eligió el `sort` sobre el merge de dos listas ordenadas porque el merge **asume** que las
entradas llegan ordenadas; el `sort` no depende de eso, y el test «ordena ascendente aunque cada
fuente llegue del revés» lo afirma.

---

## 4 · Mutaciones — 16 corridas, 16 muertas, con su salida real

⚠️ **El arnés se autocomprueba** (`scratchpad/mutaciones-262-historial.py`), porque en este repo un
arnés de mutaciones ya reportó «9/9 supervivientes» **dos veces sin haber ejecutado un test**. Exige
las cuatro cosas: (1) el texto a mutar aparece **exactamente una vez**; (2) la corrida **en limpio**
del mismo comando está **verde antes de mutar**; (3) la salida trae la línea `Test Files` de vitest
—o un veredicto de `tsc`—, o sea que el comando corrió; (4) restaura siempre con `git checkout --`
**sobre un árbol commiteado**.

```
== corrida limpia de control ==
   limpio: Test Files 6 passed (6)
   limpio: tsc sin errores
```

| # | Qué se rompe | Veredicto | Qué se puso rojo |
| --- | --- | --- | --- |
| **M-y** | la fusión descarta las correcciones | **MUERE** | `Test Files 1 failed (1)` — «una orden con dos transiciones y dos correcciones devuelve las CUATRO…», «…SOLO correcciones…», «CONTROL DE NO-VACUIDAD…», «ordena ascendente aunque cada fuente llegue del reves» |
| **M-z1** | concatenar **sin ordenar** | **MUERE** | «una orden con dos transiciones y dos correcciones…», «ordena ascendente aunque cada fuente llegue del reves», «el resultado NO depende del orden en que venia cada lista», «ordena en el servidor aunque los repos devuelvan sus filas al reves» |
| **M-z2** | invertir el desempate del **empate exacto** | **MUERE** | **sólo** «EMPATE EXACTO de instante: primero la TRANSICION, despues la correccion» y «el empate se resuelve IGUAL aunque la correccion llegue con mas compania». Es la prueba de que esos dos tests son lo que defiende la regla arbitraria |
| **M-z3** | ordenar **descendente** | **MUERE** | los cuatro de orden, incluido el de **R45** |
| **M-r44** | leer el rastro **antes** de autorizar | **MUERE** | «adminTienda de OTRA tienda → not_found, y el rastro NI SE LEE» + los otros tres sin visibilidad |
| **M-aa** | ordenar **en el componente** | **MUERE** | `historial-correccion-dia.guardia` · «el componente no ordena, ni compara instantes entre entradas» |
| **M-ac** | pintar la corrección con `estatusLabel` | **MUERE** | `Test Files 2 failed (2)` — la guardia «no llama a `estatusLabel`…» **y** los dos de pantalla |
| **M-x** | copiar el texto del día dentro del `.tsx` | **MUERE** | «R38: la corrección se lee con las dos fechas EN PALABRAS…» y «R37/R41: mezclada con transiciones…» |
| **M-f6** | retirar la anotación `@pendiente-262-f6` | **MUERE** | «el componente lleva la anotación `@pendiente-262-f6` con su motivo» — §5 |
| **M-ak** | quitar el `WHERE` por `orden_id` | **MUERE** | «⭑ M-ak: la correccion de OTRA orden NO entra en esta linea de tiempo» + el del plan |
| **M-id** | quitar el desempate por `id` del `ORDER BY` | **MUERE** | **sólo** «⭑ R40: TRES filas del MISMO instante salen desempatadas por `id`» |
| **M-fec** | serializar la fecha sin `fechaRepartoComoTexto` | **MUERE** | «devuelve TODAS las correcciones…» y «con la sesion en `America/Costa_Rica`…» |
| **M-r43** | el rastreo público gana un campo (`motivo`) | **MUERE** | `rastreo-frontera.guardia` (3 tests) **y** el control positivo de R43 |
| **M-r38** | el texto suelta la fecha en `YYYY-MM-DD` | **MUERE** | los 4 de `dia-reparto-textos` §(5) **y** los de pantalla |
| **M-aj** | **deshacer la unión** (`estatusDestinoValue` opcional) | **MUERE** | `tsc` rojo, 6 errores. Los dos que importan: `HistorialOrdenTimeline.tsx(140,19): Type 'OrdenHistorialEntradaDTO' is not assignable to type 'never'` y **`orden-historial-union.test.ts(33,3): error TS2578: Unused '@ts-expect-error' directive`** — que es **exactamente** el mecanismo que R42 prometía |
| **M-r39** | la corrección gana `estatusDestinoValue` | **MUERE** | `tsc` rojo, 6 errores, empezando por el DTO del repositorio |

**Sobreviven 0.** Y el árbol quedó limpio después (`git status --short` vacío, verificado).

---

## 5 · ⬛ El mecanismo que sustituye a la rotura deliberada, y cómo se comprueba que muerde

**Lo que la rotura garantizaba:** que la parte de UI **no se pudiera olvidar**. Como el componente
se arregló en esta misma tanda, «F7 no llega» ya no es un estado posible; lo que **sí** sigue siendo
posible —y es el mismo agujero por el otro lado— es que la entrada de corrección **desaparezca** de
la pantalla o vuelva a pintarse como una transición. Contra eso hay **tres** cosas, y las tres se
verificaron con una mutación:

1. **La unión + el `never`** (`M-aj`, `M-r39`): deshacer la unión, o meterle a la corrección un campo
   de estado, pone **`pnpm typecheck` rojo** con el nombre del archivo. Es permanente y no depende de
   que nadie se acuerde.
2. **`tests/unit/guards/historial-correccion-dia.guardia.test.ts`**, 20 tests sobre el fuente real:
   el `switch` existe y es exhaustivo, la rama de corrección **no** nombra `estatusLabel` (con
   anti-vacuidad: la de transición **sí**), los textos vienen de la fuente única, el componente **no
   ordena ni construye fechas**, la `key` lleva la clase, **y los tests de pantalla de esa entrada
   siguen existiendo** (la lección de «el test que vive dentro de lo que borras»). El detector se
   **auto-prueba** en las dos direcciones antes de que se le crea nada.
3. **La anotación `@pendiente-262-f6` junto al código**, con su motivo obligatorio de ≥40 caracteres
   nombrando lo que falta, y la cláusula (f) de la guardia que la exige. Es la convención que este
   repo ya usa (`@sin-superficie`, «el motivo junto al código»), y sirve para lo mismo: **invertir la
   carga de la prueba**. Quien dé la ficha por cerrada se encuentra la guardia roja, lee qué falta y
   tiene que borrar la anotación **a propósito**.

**Cómo se comprueba que muerde**, con su salida real:

```
[M-f6  (retirar la anotacion `@pendiente-262-f6`)] MUERE:
  Test Files 1 failed (1) | rojos: el componente lleva la anotación `@pendiente-262-f6` con su motivo 5ms
[M-ac  (pintar la correccion con `estatusLabel`)] MUERE:
  Test Files 2 failed (2) | rojos: no llama a `estatusLabel` ni pinta la flecha de estados;
  R38: la corrección se lee con las dos fechas EN PALABRAS…; R37/R41: mezclada con transiciones…
[M-aa  (ordenar en el COMPONENTE)] MUERE:
  Test Files 1 failed (1) | rojos: el componente no ordena, ni compara instantes entre entradas
[M-aj  (deshacer la union)] MUERE: tsc rojo (6 errores):
  …/orden-historial-union.test.ts(33,3): error TS2578: Unused '@ts-expect-error' directive.
```

⚠️ **Y lo que este mecanismo NO es, dicho sin rodearlo:** no es una *forcing function*. **Ninguna
comprobación automática puede obligar a nadie a abrir la app y mirar la pantalla** (`F6`). Lo que
hace es que nadie pueda decir que no lo sabía, y que retirar el recordatorio deje huella en un diff.
Si alguien quiere una garantía más fuerte para `F6`, hace falta una decisión humana sobre el
proceso, no otro test.

---

## 6 · El gate

`./init.sh` **COMPLETO** (el modo rápido se niega: el diff toca `lib/types/**`). Corrido con
`INIT_EXIT=$?` **escrito dentro del log**, porque en este repo un `echo` posterior ya tapó un gate
rojo haciéndolo pasar por «exit code 0».

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=2)
✓ specs presentes para features sdd en vuelo
✓ typecheck paso
✓ lint paso
 Test Files  1323 passed (1323)
      Tests  17859 passed | 26 skipped (17885)
   Duration  348.95s
✓ test paso
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

El aviso de «migraciones sin down.sql» es **preexistente** (tres migraciones de la feature 92) y esta
tanda **no añade ninguna migración**, así que no lo toca ni por asomo.

**La primera corrida salió ROJA con 1 fallo, y era mío y legítimo:** el literal-contrato de
`orden-historial-repository.test.ts` (§3.2). No fue timeout ni base compartida — el mensaje decía
exactamente qué campo faltaba. Se arregló haciendo **crecer** el literal, no relajándolo, y la
segunda corrida quedó en verde.

---

## 7 · Lo que queda a deber, dicho y no disimulado

1. **`F7`/`F8` en su parte de PANTALLA — no cerrados.** Lo que hay es el **mínimo funcional**: la
   estructura, el `switch` exhaustivo, los textos importados y **tres** tests de render (R38, R39, y
   el de la mezcla). Lo que **falta** es de un agente de frontend: el **estilo y el copy fino** de la
   entrada (hoy reusa el mismo punto y el mismo borde que una transición: se distingue **por texto**,
   que es lo que R39 y design §14.4 exigen, pero no está pulida), y el resto de la suite de
   componente que `F8` enumera (una lista larga con las dos clases mezcladas, y el «se distingue por
   texto y no sólo por color» afirmado sobre el render).
2. **`F6` («ver la app») — NO HECHA, y ningún test la puede sustituir.** Falta abrir «Ver historial»
   de una orden corregida con cuenta **maestro/admin** y con **adminTienda**, y comprobar en vivo
   que la entrada se lee, se distingue y sale en su sitio. Está anotada en el código (§5.3) y es la
   deuda real de esta ficha. En este repo, ver la app encontró 7 textos rotos que 12.000 tests daban
   por buenos.
3. **`B14` y `R34`-`R36`** — los cerró la tanda de frontend (`progress/impl_262_frontend.md`); no son
   de este bloque.
4. **El `adminSatelite` escribe un rastro que no puede leer** (límite 7 del spec, **P5** abierta).
   No es un agujero de esta tanda: es el reparto de canales que la ficha declara. Sigue sin
   responder.
5. **`P4`** (si el `adminTienda` debería o no leer el motivo que escribió la bodega) sigue abierta.
   Esta tanda implementó lo que **R44** dice —misma autorización, **sin** regla nueva— y hay un test
   que afirma justo eso; si la puerta humana responde lo contrario, hace falta un **segundo**
   predicado de autorización y ese test cambia con su razón escrita.
6. **`B0.2`** (re-medir M1 contra producción antes de desplegar) es del leader: necesita el MCP.

---

## 8 · Un riesgo del entorno que sigue vivo

`node_modules` está montado **por junction desde el repo principal** y puede haber otra sesión
trabajando en paralelo. Cada `prisma generate` de la otra sesión **sobrescribe el cliente
compartido**, y con un cliente rancio `tx.ordenDiaRepartoCambio` es `undefined`: los tests de
integración de este bloque se caerían con un `TypeError` que **no tiene nada que ver con lo que se
está midiendo**. Se corrió `pnpm exec prisma generate` antes de cada gate y antes del arnés de
mutaciones. Quien retome esto: desconfía de un rojo que hable de `undefined`.

---

# ⬛ 9 · CIERRE DE LOS BLOQUEANTES 1, 3 Y 4 DE LA REVISIÓN — 2026-08-23

> Rama `fix/262-bloqueantes-revision`, desde `origin/dev` en **`c63c7235`**. Worktree aislado,
> `node_modules` por junction, `prisma generate` justo antes del gate.
>
> Encargo: `progress/review_262.md` (informe del reviewer, **no se editó**). Se cierran los
> bloqueantes **1**, **3** y **4**. El **2** (`F6`, «ver la app») **no es de esta tanda**: necesita
> un preview desplegado y cuentas de tres roles, y ni se tocó ni se marcó.

## 9.1 · Archivos

| Archivo | Qué cambió |
| --- | --- |
| `tests/integration/db/correccion-dia-reparto-efectos.int.test.ts` | **BLOQ. 1**: el bloque `R32` (3 tests nuevos, +1 helper `conOrdenEnRuta`, +2 catálogos en el `beforeAll`), y el comentario de `R31` deja de prometer «ni ruta» |
| `specs/262-corregir-dia-reparto/tasks.md` | **BLOQ. 3**: 41 tasks marcadas, sección **ESTADO DE CIERRE**, evidencia de `B15`/`B4`/`B13`/`C1`/`C2`/`C5` y el motivo de las cuatro vivas |
| `specs/262-corregir-dia-reparto/design.md` | la fila de `R32` de la tabla de estrategia de verificación, corregida y fechada |
| `progress/impl_262_backend.md` | el mapa `R<n> → test`: la fila de `R32` |
| `progress/history.md` | **BLOQ. 4**: la entrada de la 262 |
| `progress/impl_262_historial.md` | esta sección |

**No se tocó:** `progress/review_262.md`, `feature_list.json`, `progress/current.md`, ni una sola
línea de `lib/` o `app/`. `gate.log` **no se commiteó**.

## 9.2 · BLOQUEANTE 1 — `R32` ya tiene tres tests, y se demostró que muerden

**El hueco, dicho sin rodeos.** `R32` («la corrección no altera la ruta optimizada del mensajero ni
los indicadores de su portal») colgaba de `B15` —«correr las suites de ruta y de corte sin
tocarlas»— y de `F6`. **Ninguna de las dos es una aserción.** Correr suites ajenas demuestra que lo
que **ya se afirmaba** sigue afirmándose; no puede demostrar una propiedad que **nadie** afirma. La
revisión lo midió con una mutación que sobrevivió a **3.302 tests**.

**Dónde va el test, y por qué ahí.** En `correccion-dia-reparto-efectos.int.test.ts`, que es el
archivo de las AUSENCIAS de esta ficha — y que además llevaba escrito en el comentario de `R31`
«ni gestión, ni historial, **ni ruta**» y luego contaba sólo las dos primeras. Ese comentario
prometía justo la aserción que faltaba.

**Lo que hacía falta y no era obvio: RUTA SEMBRADA QUE PERDER.** Con las tablas de ruta vacías,
cualquier `count()` da cero antes y cero después **haga lo que haga la corrección**. Una aserción
así parece una comprobación y no lo es. El corpus (`conOrdenEnRuta`) siembra, dentro de la
transacción que se revierte:

- un **mensajero propio** —`ruta_optimizada.mensajero_id` es **UNIQUE**, así que reusar el usuario
  semilla reventaría con `P2002` en cualquier máquina donde ese usuario ya tuviera ruta; y un
  mensajero recién creado no tiene ninguna otra orden asignada, así que el listado del portal
  describe exactamente lo sembrado y nada más. **La base local es compartida**: fabricar el corpus
  dentro de la transacción es la única forma de que sea el mismo en todas las máquinas;
- una orden **`en_reparto`** (el estado en el que una orden ES parada de la ruta) con
  `montoCobrar` distinguible;
- la **cabecera** de la ruta con sus columnas llenas (estado, `calculada_at`, origen, `huella_set`,
  `secuencia_fuente`, las cuatro del trazado, `tramo_vivo_at`);
- una **parada posicionada** con su tramo.

**Los tres tests:**

1. **`⭑⭑ R32: la correccion NO TOCA NI UNA FILA de la ruta optimizada del mensajero`** — compara
   las **filas enteras** de `ruta_optimizada` y `ruta_optimizada_parada` leídas antes y después, no
   un puñado de columnas elegidas. `updated_at` de la cabecera lleva `@updatedAt`: cualquier
   escritura sobre ella, aunque no cambiara ningún valor de negocio, movería la fila y esto se
   pondría rojo. Con anti-vacuidad doble: la corrección **ocurrió** (el día quedó en `HOY`) y
   **había** una parada de esa orden que perder.
2. **`⭑⭑ R32: los INDICADORES DEL PORTAL del mensajero no se mueven al corregir`** — llama a
   `MisAsignacionesService.listarMisAsignaciones` **con los repositorios REALES sobre la
   transacción** (`GestionOrdenRepository`, `RutaOptimizadaRepository`,
   `OrdenMensajeroMetaRepository`) antes y después, y compara `kpis`, el `RutaResumenDTO` entero y
   la secuencia por orden. El dato **viaja de la escritura real al lector real**, igual que en el
   test de `R31`. Y la anti-vacuidad va en las **dos direcciones**: se afirma que
   `fechaRepartoISO` pasó de `2026-08-22` a `2026-08-21` y que `esParaManana` pasó de `true` a
   `false` — sin eso, «nada cambió» podría significar «no pasó nada» en vez de «pasó lo que debía».
3. **`⭑ R32: la correccion no ENCOLA ninguna reoptimizacion de ruta`** — el otro camino por el que
   la ruta se alteraría **sin tocar sus tablas**: encolar el job `optimizacion_ruta` (92/R16), como
   sí hace `GestionOrdenRepository`. Delta medido **dentro** de la transacción, así que las filas
   que ya hubiera en la base compartida son las mismas antes y después.

### Las dos mutaciones, con su salida REAL

⚠️ **Se commiteó ANTES de mutar** (`7674faed`): el arnés restaura con `git checkout --` y hoy ya
borró trabajo sin commitear a dos agentes. El árbol se devolvió limpio después de cada una
(`git status --short` vacío, verificado).

**M-r32-a — la corrección borra las paradas de la ruta dentro de su propia transacción.** Es la
sonda EXACTA del bloqueante 1, inyectada en `corregirDiaRepartoLote` justo después del `UPDATE`:

```ts
await tx.rutaOptimizadaParada.deleteMany({
  where: { ordenId: { in: movidas.map((m) => m.id) } },
});
```

```
$ pnpm exec vitest run tests/integration/db/correccion-dia-reparto-efectos.int.test.ts

     × ⭑⭑ R32: la correccion NO TOCA NI UNA FILA de la ruta optimizada del mensajero 34ms
     × ⭑⭑ R32: los INDICADORES DEL PORTAL del mensajero no se mueven al corregir 37ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  …correccion-dia-reparto-efectos.int.test.ts > … > ⭑⭑ R32: la correccion NO TOCA NI UNA FILA
       de la ruta optimizada del mensajero
AssertionError: expected [] to deeply equal [ { …(7) } ]
- [
-   {
-     "id": "1a329d0a-…",
-     "ordenId": "39360fd5-…",
-     "rutaId": "03a8f380-…",
-     "secuencia": 1,
-     "tramoDistanciaM": 1180,
-     "tramoDuracionS": 210,
-     "tramoPolilinea": "cxocFvxnhVoJnG",
-   },
- ]
+ []
 ❯ tests/integration/db/correccion-dia-reparto-efectos.int.test.ts:599:30

 FAIL  …correccion-dia-reparto-efectos.int.test.ts > … > ⭑⭑ R32: los INDICADORES DEL PORTAL del
       mensajero no se mueven al corregir
AssertionError: expected { estado: 'vigente', …(6) } to deeply equal { estado: 'vigente', …(6) }
    "origenFuente": "gps",
-   "paradasSinOptimizar": 0,
+   "paradasSinOptimizar": 1,
    "secuenciaFuente": "proveedor",
-   "tramoSiguiente": {
-     "distanciaM": 1180,
-     "duracionS": 210,
-     "encodedPolyline": "cxocFvxnhVoJnG",
-   },
+   "tramoSiguiente": null,
 ❯ tests/integration/db/correccion-dia-reparto-efectos.int.test.ts:639:28

 Test Files  1 failed (1)
      Tests  2 failed | 9 passed (11)
```

**M-r32-b — la corrección encola una reoptimización por cada orden movida** (`tx.job.create` con
`tipo: "optimizacion_ruta"` dentro de la misma transacción):

```
$ pnpm exec vitest run tests/integration/db/correccion-dia-reparto-efectos.int.test.ts

     × ⭑ R32: la correccion no ENCOLA ninguna reoptimizacion de ruta 18ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  …correccion-dia-reparto-efectos.int.test.ts > … > ⭑ R32: la correccion no ENCOLA ninguna
       reoptimizacion de ruta
AssertionError: expected 22 to be 21 // Object.is equality

 Test Files  1 failed (1)
      Tests  1 failed | 10 passed (11)
```

**Restaurado y verde otra vez:** `Test Files 1 passed (1) · Tests 11 passed (11)`.

### El mapa `R<n> → test`, corregido en las TRES fuentes que mentían

| Dónde | Decía | Dice |
| --- | --- | --- |
| `progress/impl_262_backend.md` §2 | «B15 (suites de ruta y corte en verde, sin tocarlas)» | los tres tests, con la nota de que `B15` **no es un test** |
| `specs/262-corregir-dia-reparto/tasks.md` (mapa final) | «B15 · F6» | **B13**, bloque R32; `B15` y `F6` **acompañan, no sustituyen** |
| `specs/262-corregir-dia-reparto/design.md` (estrategia de verificación) | «Los tests que ya existen + `ver la app`» | **Postgres real con ruta sembrada**, con el porqué del fallo escrito |

**Y el comentario de `R31` deja de prometer lo que no hace.** No se le añadió el conteo de ruta:
esa orden no tiene ruta sembrada, así que sería un cero trivialmente verde. Se dice **eso** en el
comentario y se apunta al bloque `R32`.

## 9.3 · BLOQUEANTE 3 — `tasks.md` pasa de 1/46 a 42/46, leído de las bitácoras

Las marcas salen de las cuatro bitácoras y de lo que la revisión re-midió, **no de mirar el
árbol por encima**. Se añadió una sección **ESTADO DE CIERRE** al principio del archivo con la
tabla de las cuatro vivas y su motivo en una línea. Lo que el reviewer señaló en concreto:

- **`B15`** — hecha, pero sin evidencia. Ahora lleva **los cuatro puntos** con la lista de archivos
  y sus números: **27 archivos, 549 tests, 0 rojos** en tres tandas (5/79 la guardia y el corte ·
  11/227 asignación y deshacer · 11/243 ruta e indicadores). Más dos verificaciones de diff: la
  guardia del día **sólo creció** (277 adiciones / 3 borrados, y los tres borrados son líneas de
  armazón del constructor del censo, **ninguna aserción**), y `findParadasEnReparto` **no aparece**
  en el diff de los cuatro merges de la ficha contra su primer padre.
- **`B0.2` / `C3`** — **siguen `[ ]`**, con el motivo escrito: la foto de `M1` es del 2026-08-22
  04:27 CR y **caducó**; es del leader (MCP de Supabase, `DATABASE_URL` de producción *sensitive*).
- **`C7`** — **sigue `[ ]`**: `P4` y `P5` no se han llevado a la puerta humana y `requirements.md`
  no tiene la respuesta fechada. Es decisión de producto.
- **`F6`** — **sigue `[ ]`**, y no se tocó: es el bloqueante 2 y no es de esta tanda.
- **`C5`** — marcada con evidencia: `prisma migrate status` sobre `localhost:5432/ordenex` responde
  **«Database schema is up to date!»** con **143 migraciones**, y las dos de la ficha están en su
  orden. La prueba fuerte no es esa línea, sino que los **11 tests** de
  `correccion-dia-reparto-efectos.int` corren contra esa base y leen `orden_dia_reparto_cambio` y
  su `pg_class.relrowsecurity`.
- **`B4`** — marcada apuntando a dónde vive el `grep` que su criterio pedía: lo corrió la revisión
  y quedó en `progress/review_262.md` §menor (e), **una sola** escritura en todo el árbol.

## 9.4 · BLOQUEANTE 4 — la entrada de la 262 en `progress/history.md`

Escrita al final del archivo (append-only), con la voz de las entradas de la 264 y la 268: prosa
densa que dice **qué estaba roto y por qué era estructural**, no viñetas de changelog. Lo que no
omite: que el aviso **se habría perdido en silencio la segunda vez** por el `dedupe_key` con
`NULLS NOT DISTINCT`; que el rastro en «Ver historial» **obligó a pintar una entrada sin
transición** en un DTO que sólo sabía de transiciones; que **mirar la pantalla encontró que el
hueco del anillo era un disco más oscuro**, con los dos `rgb()` medidos; el fallo mudo de `R32` con
sus 3.302 tests verdes; y la **deuda viva: `F6` sin ejecutar**.

## 9.5 · El gate

`./init.sh` **COMPLETO**, escrito para que el exit code no lo tape un `echo`
(`./init.sh > gate.log 2>&1; echo "INIT_EXIT=$?" >> gate.log`), y **leído dentro del log**:

```
✓ typecheck paso
✓ lint paso              (✖ 99 problems: 0 errors, 99 warnings — todos PREEXISTENTES)
 Test Files  1324 passed (1324)
      Tests  17881 passed | 26 skipped (17907)
   Duration  351.65s
✓ test paso
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Verde a la primera, sin un rojo que interpretar** — así que no hubo que distinguir timeout bajo
carga de base compartida. El número cuadra: la revisión midió **17.878** sobre `c63c7235` y aquí
son **17.881**, exactamente **+3**, los tres tests de `R32`; el conteo de archivos no se mueve
(1.324) porque los tres viven en un archivo que ya existía. El aviso de «migraciones sin down.sql»
es **preexistente** (tres carpetas de la feature 92) y esta rama no añade ninguna migración.

⚠️ **`gate.log` no está en el repo**: se escribió en el árbol para poder leer `INIT_EXIT` dentro y
se borró antes de commitear.

## 9.6 · Lo que queda a deber

1. **`F6` («ver la app») — NO HECHA**, y no era de esta tanda (bloqueante 2 de la revisión). Es LA
   deuda viva de la ficha: necesita preview desplegado y cuentas de maestro/admin, `adminSatelite`
   y mensajero. Sigue anotada junto al código y bajo guardia.
2. **`B0.2` / `C3`** (re-medir `M1` contra producción, caducada) y **`C7`** (`P4` y `P5` a la
   puerta humana): son del **leader**, no de un subagente.
3. **Los seis menores de la revisión no se tocaron.** El encargo era 1, 3 y 4. Los dos de un
   renglón —(a) el comentario de `HistorialOrdenTimeline.tsx:140` que dice `bg-background` donde el
   código usa `bg-popover`, y (b) el censo de `notificacion-notificadores-reales.test.ts` que dice
   cinco donde hay seis— **siguen abiertos** y conviene llevárselos en la pasada de `F6`, que ya
   toca esa superficie.
4. **El veredicto de la revisión sigue siendo RECHAZADO** hasta que `F6` se ejecute: cerrar tres de
   cuatro bloqueantes no aprueba la ficha, y `progress/review_262.md` **no se editó** — es el
   informe del reviewer, no un documento de trabajo.

**Veredicto:** bloqueantes **1**, **3** y **4** cerrados y verificados; `R32` pasa de no tener
ninguna aserción a tener tres que mueren con la mutación que las midió; el bloqueante **2** (`F6`)
sigue abierto a propósito.
