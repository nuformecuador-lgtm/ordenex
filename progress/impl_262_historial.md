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
