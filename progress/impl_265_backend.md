# Feature 265 — Bitácora del bloque BACKEND

> Rama `feature/265-optimizador-lee-al-proveedor`, desde `origin/dev` en `241f1842`.
> Alcance: **todo menos el bloque frontend `FE1`-`FE4`**, que va después y en otra sesión.
> Lo que quedó a deber está en la última sección, dicho y no disimulado.

---

## 1 · Qué se implementó, en una frase por pieza

| Bloque | Qué hace ahora |
| --- | --- |
| **§A — leer** | El schema de respuesta parsea `skippedShipments`, `validationErrors` y `metrics.skippedMandatoryShipmentCount`, **todos opcionales**. Antes zod los tiraba en el *strip* y una respuesta que explicaba el problema con precisión llegaba como «forma inesperada». |
| **§B — degradar** | Desenlace nuevo `sin_solucion` (el proveedor contestó **bien** y no las sirvió todas) → el compuesto ordena **todas** las paradas en local. Nunca una secuencia parcial. El job **completa**. |
| **§C — cortar antes de pagar** | Guarda de coherencia del origen: si el origen resuelto está a más de `RUTA_ORIGEN_MAX_KM` del centroide de las paradas, se **descarta** y se usa el centroide. Se sigue optimizando; no se corta el trabajo. |
| **§D — el fallo deja de llegar crudo** | `try/catch` alrededor de `client.optimizar`: conserva el orden previo, marca `desactualizada` y lanza `RutaIntentoFallidoError`. La pantalla recibe `conflict`, no «AppErrorCode inesperado INTERNAL». |
| **§E — la premisa** | El razonamiento vivo se conserva **verbatim**; la premisa caducada se **anexa** fechada, con motivo medido y puntero. Guardia en las dos direcciones. |
| **§G — el mensajero (mitad de datos)** | Columna `ruta_optimizada.secuencia_fuente` con su migración y su `down.sql`, más el campo recorriendo repo → servicio → action → `RutaResumenDTO`. La UI la pinta **FE1-FE4**. |
| **§H — el umbral** | `RUTA_ORIGEN_MAX_KM = 200` en un solo sitio, declarado 🧭 **sin calibrar**, con guardia. |
| **§I — la traza** | `RUTA_DEBUG_LOG` **invierte su default**: la traza nace apagada y se enciende con `1`. Nada depende de ella. |

---

## 2 · Archivos

### Creados

- `db/migrations/20260822140000_ruta_secuencia_fuente/migration.sql`
- `db/migrations/20260822140000_ruta_secuencia_fuente/down.sql`
- `tests/integration/db/ruta-secuencia-fuente-migracion.test.ts`
- `tests/unit/guards/premisa-saltos-caducada.guardia.test.ts`
- `tests/unit/guards/umbral-origen-declarado.guardia.test.ts`
- `tests/unit/services/optimizacion-ruta-degradacion.test.ts`

### Modificados — producción

| Archivo | Cambio |
| --- | --- |
| `lib/interfaces/external/IRouteOptimizationClient.ts` | `SecuenciaFuente`; `ok` gana `fuente` **requerido**; desenlace `sin_solucion` |
| `lib/clients/google-route-optimization.ts` | schema defensivo, `extraerCodigosDeSalto`, `motivoSinSolucion`, `traducirSecuencia` devuelve en vez de lanzar en **un** caso, traza de R8, premisa anexada |
| `lib/clients/haversine-route-optimization.ts` | declara `fuente: "local"` siempre |
| `lib/clients/fallback-route-optimization.ts` | `sin_solucion` → Haversine, con su aviso agregado; propaga la `fuente` |
| `lib/services/OptimizacionRutaService.ts` | `centroide()` extraído, `origenCoherente()`, `try/catch`, `motivoDeExcepcion()`, rama `sin_solucion`, transporta `secuenciaFuente` |
| `lib/config/route-optimization.ts` | `RUTA_ORIGEN_MAX_KM` con su declaración de 4 piezas |
| `lib/logging/optimizer-log.ts` | default invertido (P7) |
| `lib/interfaces/repositories/IRutaOptimizadaRepository.ts` · `lib/repositories/RutaOptimizadaRepository.ts` | `secuenciaFuente` en el DTO y en la meta; se escribe en la **misma transacción**; `marcarDesactualizada` **no** la toca |
| `lib/interfaces/services/IOptimizacionRutaService.ts` · `lib/types/ruta-mensajero.ts` · `lib/actions/ruta-mensajero.ts` | el campo sube hasta el borde |
| `lib/interfaces/services/IMisAsignacionesService.ts` · `lib/services/MisAsignacionesService.ts` | `RutaResumenDTO.secuenciaFuente` |
| `db/schema.prisma` | `secuenciaFuente String? @map("secuencia_fuente")` |
| `.env.example` | `RUTA_ORIGEN_MAX_KM` y `RUTA_DEBUG_LOG`, solo nombres |
| `tests/setup/jest-dom.ts` | la línea 28 se conserva **con su nota**: hoy es redundante y por qué se deja |

### Modificados — tests ajenos, con su razón

Once archivos de test cambiaron **solo para que el tipo compile** (el campo nuevo es requerido,
y que salieran señalados era el objetivo): los 5 fixtures `RutaResumenDTO` que el diseño
nombraba, más `MisAsignacionesPage`, `SincronizarRutaButton` y tres tests de action. En todos
el valor añadido es `null` o `"proveedor"`, que es el comportamiento de hoy.

**Tres cambiaron de aserción, y eso no puede pasar en silencio:**

| Test | Qué decía | Qué dice ahora, y por qué |
| --- | --- | --- |
| `google-route-optimization.test.ts:113` — «no cubre todas → **lanza**» | protegía «nunca se persiste parcial» | afirma el desenlace `sin_solucion`, con el **nombre actualizado**. La invariante que el nombre prometía queda cubierta en el mismo PR por dos tests nuevos (abajo) |
| `optimizacion-ruta-service.test.ts` — «si el cliente lanza (credencial), la secuencia previa tampoco se toca» | además afirmaba que **no** se marcaba desactualizada y que la excepción salía cruda | la primera mitad sigue igual; la segunda **era el defecto** (R24). Ahora afirma `marcarDesactualizada` llamada y `RutaIntentoFallidoError` |
| `mis-asignaciones-orden-ruta.test.ts` y `optimizacion-ruta-trazado.test.ts` — dos `toEqual` literales | el contrato sin `secuenciaFuente` | el literal **es** el contrato: crece con él. No se cambió por su propia fuente, que lo dejaría siempre verde |

**Dónde vive ahora la red que protegía el test reescrito** (esto es lo que impide que el
arreglo se lleve por delante una invariante):

1. `fallback-route-optimization.test.ts` → «R10: la secuencia devuelta cubre TODAS las paradas
   de entrada, ni una menos», con el calculador local **real**, no un doble.
2. `optimizacion-ruta-service.test.ts` → «`sin_solucion` sin compuesto: no persiste nada,
   marca desactualizada y lanza el tipado».

---

## 3 · Decisiones que tomé y no estaban escritas letra por letra

**1 · `R7` reconoce CLAVES, no una forma.** El spec pide citar «códigos de motivo en un campo
que el contrato reconozca», pero la forma interna de `skippedShipments` **no se conoce** (P1 se
quedó sin vía). Declarar `reasons[].code` como si se supiera habría sido inventar. Lo que hace
`extraerCodigosDeSalto` es reconocer **una clave llamada `code` cuyo valor tiene forma de
código** (`^[A-Z][A-Z0-9_]{2,49}$`), a cualquier profundidad ≤ 3. Ese filtro deja fuera **por
construcción** las tres cosas que no pueden salir: coordenadas (son números), identificadores
(minúsculas y guiones) y texto libre (espacios). Si la forma real no trae nada reconocible —el
caso que hoy se espera— el motivo se compone igual, sin hueco (**R49**).

**2 · El motivo saneado se decide por `error.name`, no por `instanceof`.** Un `instanceof`
obligaría al servicio a importar `lib/clients/google-route-optimization`, es decir a conocer el
proveedor concreto, que es justo lo que `IRouteOptimizationClient` aísla. Las cuatro clases
nuestras fijan su `this.name` explícitamente. Ante cualquier otra cosa, texto fijo.

**3 · El default de `RUTA_DEBUG_LOG` se invierte con lista blanca**, no con `!== "0"` al revés:
solo `1` y `true` encienden. Un typo deja la traza apagada, que es el lado seguro cuando lo que
está en juego es volcar coordenadas de entrega a un log de terceros.

**4 · `RutaNoConfiguradoError` también pasa por la puerta de R24.** El spec no hace excepciones
por clase de error, y hacerlas habría dejado abierto justo el camino que rompía la pantalla. En
producción ese caso ni llega al servicio: lo intercepta el compuesto y ordena en local.

**5 · La migración SÍ se aplicó a la base local**, con `prisma migrate deploy` (aditivo, nunca
resetea), no con `migrate dev` (que ante *drift* propone **borrar la base** — y la base local
está compartida con la 262). `prisma migrate status` quedó en «Database schema is up to date!».

---

## 4 · Mapa `R<n> → test`

| R | Qué exige | Test que lo defiende |
| --- | --- | --- |
| R1 | Se leen los tres campos | `google-route-optimization.test.ts` → «R1: los TRES campos se leen de verdad» |
| R2 | Su ausencia no rompe nada | ídem → «una respuesta SANA sin … sigue siendo ok» |
| R3 | La decisión no depende de la forma interna | ídem → «R3: la decision NO depende de la forma interna» y «R3 bis: `skippedShipments` VACIO …» |
| R4 | El motivo nombra las paradas saltadas | ídem → «lee los tres campos y devuelve el desenlace con sus conteos» |
| R5 | El motivo lleva conteos | ídem (misma aserción, `servidas 0 de 6`) |
| R6 | El motivo no filtra nada | ídem → «ni coordenadas, ni ordenId, ni indices …» |
| R7 | Códigos de motivo, si existen | ídem → «R7: con codigos reconocibles, se citan LOS CODIGOS» + autocomprobación del extractor |
| R8 | La traza lo dice aunque la respuesta sirva | ⏳ **CORREGIDO el 2026-08-22 (§8.1):** esta fila **mentía**. El de R1 usa una respuesta `sin_solucion` (**no** utilizable) y el llamado de R8 afirmaba **sólo** `status: ok`, así que **ninguno de los dos** cubría R8. Hoy sí: `google-…` → «R8: una respuesta UTILIZABLE que ademas trae avisos sigue siendo `ok` **Y QUEDA ESCRITA**», que exige la línea con `skippedShipments: 0` y `validationErrors: true`. Medido con **M-ae** |
| R9 | «No cubre todas» → orden local | `fallback-route-optimization.test.ts` → «265/R9-R11 …» (3 casos) |
| R10 | Nunca una secuencia parcial persistida | ídem → «R10: la secuencia devuelta cubre TODAS …» · `optimizacion-ruta-service.test.ts` → «no persiste nada, marca desactualizada …» |
| R11 | «Algunas» = «ninguna» | `fallback-…` → los tres casos parametrizados (0, 4, 5 de 6) · cliente → «R11: servir ALGUNAS (4 de 6)» |
| R12 | Aviso agregado al degradar | `fallback-…` → «R12: avisa con CONTEOS y sin PII» |
| R13 | El job completa, sin reintento | `optimizacion-ruta-degradacion.test.ts` → «`crearOptimizacionRutaHandler` NO lanza» (+ su mitad negativa) |
| R14 | Los otros desenlaces no degradan | `fallback-…` → «R14 (mitad negativa)» |
| R15 | La secuencia previa no se toca hasta tener una completa | `optimizacion-ruta-degradacion.test.ts` → «la secuencia persistida cubre las TRES …» (`marcarDesactualizada` no llamada) · `optimizacion-ruta-service.test.ts` → R24 |
| R16 | Se comprueba la coherencia antes de llamar | `optimizacion-ruta-origen.test.ts` → «se llama al proveedor con el CENTROIDE …» |
| R17 | Se sustituye por el centroide | ídem (se afirma el **argumento** de la llamada) |
| R18 | Aplica a cualquier fuente, salvo `centroide` | ídem → «R18: aplica tambien a `ultima_conocida`» y «R18 bis: si el origen YA es el centroide» |
| R19 | Aviso agregado, sin coordenadas | ídem → «R19: avisa con la distancia redondeada …» |
| R20 | La huella usa el origen final | ídem → «R20: la HUELLA se calcula con el origen FINAL» |
| R21 | Configurable, sin lanzar | `route-optimization-config.test.ts` → «265/R21 …» (ausente/vacía/`abc`/`0`/`-1`/`NaN`/`200km`) |
| R22 | Sin llamadas ni lecturas de más | `optimizacion-ruta-origen.test.ts` → «R22: la guarda no anade NI UNA llamada …» |
| R23 | Descartar el origen no cancela el trabajo | ídem → «se llama al proveedor con el CENTROIDE …» (afirma `status: ok`) |
| R24 | Excepción → conserva, marca y tipa | `optimizacion-ruta-service.test.ts` → «265/R24, R26 …» (2 casos) |
| R25 | La pantalla recibe `conflict`, no una excepción | `sincronizar-ruta.test.ts` → «265/R25 …» (2 casos) |
| R26 | La cola sigue viendo una excepción | `optimizacion-ruta-service.test.ts` → «R26: la cola sigue viendo una EXCEPCION» |
| R27 | El razonamiento original, verbatim | `premisa-saltos-caducada.guardia.test.ts` cláusula (a) |
| R28 | La nota anexada, con sus cinco piezas | ídem cláusula (b) |
| R29 | La guardia existe y no es vacía | ídem, bloque «autocomprobacion» (6 casos) + cláusula (c) |
| R30 | La degradación por credencial ausente sigue igual | `fallback-…` → los tests de la 92 intactos + «los DOS caminos de degradacion marcan `local`» |
| R31 | No se envía `ordenId` | `google-…` → «R31: tampoco en este camino viaja el `ordenId`» |
| R32 | Nada de token, URL ni coordenadas en errores | `google-…` → «265/R6, R32 …» · `optimizacion-ruta-service.test.ts` → «R32: el motivo de un error de LIBRERIA es fijo» |
| R33 | Las cinco guardas de coste, intactas | `optimizacion-ruta-service.test.ts` (R20/R34/R35/R36/R38, sin tocar) — ver §6 |
| R34 | (lo que queda vivo) sin tabla, sin RLS, **sin backfill** | `ruta-secuencia-fuente-migracion.test.ts` → «R34 (lo que queda vivo) …» |
| R35 | La procedencia se persiste y se consulta | `ruta-optimizada-repo.test.ts` → «265/R35 …» · `optimizacion-ruta-service.test.ts` → «un orden %s se persiste CON esa marca» · `…-degradacion.test.ts` |
| R36 | La marca es la de ESA secuencia | `ruta-optimizada-repo.test.ts` → «R36: recalcular de `local` a `proveedor` CAMBIA la marca» |
| R37 | Sin secuencia que ordenar, no se afirma procedencia | `optimizacion-ruta-service.test.ts` → «R37: en la rama trivial …» |
| R38-R45 | La pantalla y sus textos | **FE3** (bloque frontend). Lo que el backend aporta: R39 → `sincronizar-ruta.test.ts` «265/R39 …»; R44 → `fallback-…` «los DOS caminos … marcan `local`»; R45 → `ruta-optimizada-repo.test.ts` «al LEER, `null` significa no consta» |
| R46 | El umbral vive en un solo sitio | `umbral-origen-declarado.guardia.test.ts` → «265/R46 …» + árbol simulado |
| R47 | Declarado sin calibrar, con guardia | ídem → «la declaracion esta completa, y el fallo dice CUAL pieza falta» |
| R48 | Nada depende de la traza | `optimizacion-ruta-degradacion.test.ts` → «265/R48 …» (2 tests) + toda la suite con `RUTA_DEBUG_LOG=0` |
| R49 | Sin códigos, el motivo sigue completo | `google-…` → «R49: SIN ningun codigo …» · `…-degradacion.test.ts` → «el aviso agregado nombra la causa …» |

---

## 5 · Mutaciones — 25 de las 30, con su salida real

> ⏳ **2026-08-22:** las cinco restantes (`M-v`…`M-z`) están en `impl_265_frontend.md` §5, y la
> revisión añadió una **31.ª**, **`M-ae`** (la que faltaba para **R8**) → **§8.1**.

Arnés: `scratchpad/mutar.py`, que aplica **una** mutación, corre los tests que deben cazarla y
**revierte siempre** (`finally`). No hay veredicto agregado: abajo va el nombre del test que se
puso rojo en cada corrida, copiado de la salida de vitest.

| # | Mutación | Veredicto | Test rojo (uno de los que cayeron) |
| --- | --- | --- | --- |
| M-a | Quitar `skippedShipments` del schema | **muere** | `R1: los TRES campos se leen de verdad` (+ `R7: con codigos reconocibles…`) — 2 rojos |
| M-b | Declararlo obligatorio | **muere** | `una respuesta SANA sin skippedShipments … sigue siendo ok` — 8 rojos |
| M-c | Decidir por `skippedShipments.length` | **muere** | `R3 bis: skippedShipments VACIO con la secuencia incompleta degrada igual` — 2 rojos |
| M-d | Motivo genérico «forma inesperada» | **muere** | `lee los tres campos y devuelve el desenlace con sus conteos` — 5 rojos |
| M-e | Meter un índice de parada en el motivo | **muere** | `ni coordenadas, ni ordenId, ni indices de parada…` — 2 rojos |
| M-f | Re-lanzar `sin_solucion` en vez de degradar | **muere** | `NINGUNA parada servida … -> se delega en el calculo local` — 10 rojos |
| M-g | Degradar solo si `servidas === 0` | **muere** | `ALGUNAS servidas: 4 de 6 -> se delega en el calculo local` — 3 rojos |
| M-h | Degradar también ante `transitorio` | **muere** | `R14 (mitad negativa): transitorio y config_invalida NO degradan` — 2 rojos |
| M-i | Persistir la parcial en vez de la local | **muere** | `no persiste nada, marca desactualizada y lanza el tipado` |
| M-j | Borrar la guarda del origen | **muere** | `se llama al proveedor con el CENTROIDE, no con el origen lejano` — 5 rojos |
| M-k | `>` por `>=` en el umbral | **muere** | `> y no >=: una distancia EXACTAMENTE igual al limite NO sustituye` |
| M-l | Guarda solo para `gps` | **muere** | `R18: aplica tambien a ultima_conocida, no solo a gps` |
| M-m | Huella con el origen **viejo** | **muere** | `R20: la HUELLA se calcula con el origen FINAL` |
| M-n | Cortar el job en vez de sustituir | **muere** | `se llama al proveedor con el CENTROIDE…` — 6 rojos |
| M-o | Quitar el `try/catch` | **muere** | `excepcion nuestra … -> orden previo intacto + desactualizada + RutaIntentoFallidoError` — 5 rojos |
| M-p | Marcar la degradada `desactualizada` | **muere** | `§5.4 — la degradacion se persiste VIGENTE, y por eso la siguiente llamada NO se paga` |
| M-q | Reescribir el razonamiento | **muere** | `(a) el razonamiento que sigue vivo esta VERBATIM` — 2 rojos |
| M-r | Borrar el puntero de la nota | **muere** | `(b) la nota anexada esta completa, y el fallo dice CUAL pieza falta` |
| M-s | Escribir siempre `"proveedor"` | **muere** | `un orden local se persiste CON esa marca` — 4 rojos |
| M-t | No escribir la columna al reemplazar | **muere** | `R36: recalcular de local a proveedor CAMBIA la marca` — 4 rojos |
| M-u | Procedencia en la rama trivial | **muere** | `R37: en la rama trivial de 0 o 1 parada NO se afirma ninguna procedencia` |
| M-aa | Repetir el umbral en otro módulo | **muere** | `ningun otro modulo de lib/, app/ o components/ lo define ni lo repite` |
| M-ab | Borrar la declaración «no calibrado» | **muere** | `la declaracion esta completa, y el fallo dice CUAL pieza falta` — 2 rojos |
| M-ac | Emitir el aviso **solo** por `optlog` | **muere** | `apagada y encendida producen la MISMA secuencia, la misma marca y el mismo aviso` — 2 rojos |
| M-ad | Imprimir `motivos: undefined` sin códigos | **muere** | `R49: SIN ningun codigo, el motivo nombra causa y conteos, sin huecos ni undefined` — 3 rojos |

**Las cinco que NO corrí y por qué:** `M-v`, `M-w`, `M-x`, `M-y` y `M-z` mutan la **pantalla**
(el aviso persistente, las tres señales, el toast y el saneo del texto). Sus tests son los de
**FE3**, que todavía no existen. **Las corre el agente de frontend**, no yo: mutar código que
aún no está escrito daría «sobrevive» por una razón falsa.

⚠️ **Dos avisos honestos sobre este arnés:**

1. **M-a mató un test que no era el que el diseño anunciaba.** La primera corrida solo puso
   rojo `R7`, no un test de R1 — porque **ningún test afirmaba que los tres campos se leyeran**
   (todos los demás se apoyan en la cobertura de la secuencia, que es independiente **a
   propósito**, R3). Se añadió el test que faltaba (`R1: los TRES campos se leen de verdad`) y
   se volvió a correr la mutación. Sin el arnés, ese agujero se habría quedado.
2. **M-o no mató ningún test de la action**, y el diseño decía que debía («test del servicio y
   test de la action»). Es correcto que no: la action se prueba con un **doble del servicio**,
   así que no puede ver si el servicio tiene o no `try/catch`. R25 sigue cubierto —su test
   afirma el contrato de la action— pero la mutación que lo defiende es otra. Queda escrito
   para que nadie lea «M-o → action» como si estuviera comprobado.

---

## 6 · El gate: `./init.sh` COMPLETO

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=0)
✓ specs presentes para features sdd en vuelo
-> pnpm run typecheck
✓ typecheck paso
-> pnpm run lint
✖ 99 problems (0 errors, 99 warnings)      ← warnings preexistentes, ninguno de esta rama
✓ lint paso
-> pnpm run test
 Test Files  1 failed | 1310 passed (1311)
      Tests  2 failed | 17597 passed | 26 skipped (17625)
   Duration  379.26s
✗ 'pnpm run test' fallo
INIT_EXIT=1
```

**`INIT_EXIT=1`, y los DOS rojos NO son de esta rama.** Los dos están en
`tests/integration/db/notificacion-evento-postulacion-recurso-migration.test.ts`, que lee los
valores de dos **enums de la base local** y los compara con una lista literal. En la base
sobra `orden_dia_reparto_cambio`, que llegó con las migraciones de la **feature 262**, que se
está implementando en paralelo **contra la misma base local**:

```
$ pnpm exec prisma migrate status
The migrations from the database are not found locally in prisma/migrations:
20260822130000_orden_dia_reparto_cambio
20260822140000_notificacion_evento_dia_reparto_corregido
```

Tres comprobaciones de que no es mío, hechas y no supuestas:

1. `git diff origin/dev -- <ese test>` → **vacío**: no lo he tocado.
2. `grep -rn orden_dia_reparto_cambio db/ lib/ tests/` → **cero coincidencias** en mi árbol.
3. Ese rojo ya estaba **antes** de que yo aplicara nada a la base (primera corrida de
   `tests/integration/db/` a las 20:36; mi `migrate deploy` fue a las ~20:47).

**No es un timeout bajo carga** —lo comprobé aislado, y falla igual en 696 ms— y **no se
arregla desde esta rama**: se cura cuando la 262 mergee su migración, o en cualquier entorno
que no comparta esta base local.

**Los 4 rojos de la primera corrida se redujeron a 2**: los otros dos (`mis-asignaciones-orden-ruta`
y `optimizacion-ruta-trazado`) **sí eran míos** —dos `toEqual` literales del contrato— y están
arreglados haciendo crecer el literal, no ablandándolo.

**Paso 6 (migraciones sin `down.sql`), corrido aparte** porque `init.sh` corta en el primer rojo
y no llegó a imprimirlo:

```
migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
```

**La lista NO crece**: son las tres `ruta_*` del 2026-08-14 que ya venían así, y la migración
nueva **no aparece**. No se tocan las tres viejas: editar una migración ya aplicada es *drift*.

---

## 7 · Lo que quedó a deber

1. **⚠️ El gate no está verde, y su rojo no es reparable desde aquí.** Los 2 rojos son de la
   262 sobre la base local compartida (§6). **El leader tiene que decidir**: o se acepta con
   esta explicación, o se re-corre el gate cuando la 262 haya mergeado. Lo que **no** se puede
   hacer es tocar ese test para que pase: mide la base de verdad y ahora mismo dice la verdad.

2. **⚠️ El cliente Prisma se genera en `node_modules` COMPARTIDO, y la 262 me lo pisó dos
   veces.** `pnpm exec prisma generate` escribe en el `node_modules` del repo principal, que
   está montado por *junction* en los dos worktrees. Cuando la otra sesión regenera desde **su**
   schema, mi columna desaparece del cliente y el typecheck se pone rojo con
   `Property 'secuenciaFuente' does not exist` — pasó **dos veces**, la segunda **dentro del
   gate**. Se arregla con un `prisma generate` y a correr otra vez. **Quien vuelva a correr el
   gate aquí debe regenerar justo antes.** Y al revés: mi `generate` le quita a la 262 sus
   valores de enum del cliente. Es simétrico y no tiene arreglo desde una sola rama.

3. **Dos migraciones con el MISMO prefijo de timestamp.** La mía es
   `20260822140000_ruta_secuencia_fuente` y la de la 262 es
   `20260822140000_notificacion_evento_dia_reparto_corregido`. No colisionan (directorios
   distintos, tablas distintas) y el orden lexicográfico las resuelve, pero **está dicho** por
   si al leader le importa renombrar una antes de mergear.

4. **La migración se aplicó a la base LOCAL** (`migrate deploy`), no a preview ni a producción.
   El despliegue de Vercel la aplica en el build.

5. **P1 y P5 siguen abiertas y esta ficha las cierra sin resolver.** La forma interna de
   `skippedShipments` no se vio y **ya no se verá**: la traza que era la única vía queda apagada
   por defecto en esta misma release. El schema es defensivo y el extractor de códigos
   reconoce claves, no una forma (§3.1). Si algún día alguien captura la respuesta cruda, lo
   que hay que apretar es `extraerCodigosDeSalto` y su test, nada más.

6. **El umbral `RUTA_ORIGEN_MAX_KM = 200` NO está calibrado**, y su guardia solo garantiza que
   eso siga **escrito**, no que el número sea bueno. **C3 sigue viva**: re-medir M1 antes de
   desplegar a producción, con `ruta_optimizada_parada` ya con filas. Si el máximo legítimo se
   acerca a 200 km, se para y se pregunta.

7. **Los avisos agregados (`logger.warn`) siguen sin llegar a nadie en producción.** Es el
   límite declarado 5 del spec y **P8 lo cerró así a propósito**: la operación se entera
   **consultando `ruta_optimizada.secuencia_fuente`**. Escribí los `warn` porque los tests son
   la única superficie que hoy los observa —y porque enchufar un logger real es una decisión de
   plataforma que este repo no ha tomado—, pero que nadie crea que se están viendo.

8. **`tests/integration/repositories/` NO levanta Postgres.** Ese archivo se llama «integración»
   pero usa un Prisma mockeado (es el patrón del repo, no algo que yo haya introducido). Mis
   tests ahí afirman **los argumentos** del `upsert`, no el `UPDATE` real. Lo que sí mira el
   SQL de verdad es el test estático de la migración. El único sitio donde la columna se
   ejercita contra Postgres de verdad será **F6**, en preview.

9. **No corrí F6** (ver la app): depende del bloque frontend, que no es mío.

10. **`feature_list.json` y `progress/current.md` no se tocaron**, como se me indicó.

---

## 8 · Anexo del 2026-08-22 — los dos bloqueantes de la revisión, cerrados

> Rama `fix/265-bloqueantes-revision`, desde `origin/dev` en **`96940710`**. Encargo acotado:
> **B1**, **B2** y **m1** de `progress/review_265.md`. **Ni una línea de producción cambia**: el
> reviewer ya había medido que el código está sano. Los 11 menores (**m2**-**m11**) **no se tocan**:
> no estaban en el encargo, y `review_265.md` **no se edita** — es el informe del reviewer.

### 8.1 · B1 — `R8` ya tiene un test que muerde, y está medido

**El agujero, tal como lo dejó el bloque backend.** El test que se llamaba de R8
(`tests/unit/clients/google-route-optimization.test.ts`) montaba el escenario correcto —las seis
visitas servidas **más** `validationErrors` presente— y luego afirmaba **sólo**
`toMatchObject({ status: "ok", fuente: "proveedor" })`. No comprobaba que se escribiera nada. Y el
**único** sitio de toda la suite que afirmaba la línea «informa saltos» era el test de **R1**, que
usa `RESPUESTA_DEL_INCIDENTE` — un caso **`sin_solucion`**, o sea una respuesta que **NO** es
utilizable. Con eso, el requisito («la traza lo dice **aunque la respuesta sirva**») no lo defendía
nadie, y el mapa `R → test` de §4 lo daba por cubierto con dos tests.

**Lo que se añadió.** El mismo test enciende la traza a propósito —como hace el de R1— y exige la
línea, con el payload exacto que distingue este caso del de R1: `skippedShipments: 0`
(no se saltó ni una parada; el aviso viene **sólo** de `validationErrors`), `validationErrors: true`
y `skippedMandatoryShipmentCount: null`. Las dos mitades quedan en el mismo `it`, con el nombre
actualizado (`… sigue siendo ok Y QUEDA ESCRITA`): un nombre que promete lo que el cuerpo no
comprueba es peor que no tenerlo.

**La mutación `M-ae`, corrida de verdad, en las dos direcciones.** Arnés:
`scratchpad/mutar_mae.py`, que mueve el bloque `optlog` de `lib/clients/google-route-optimization.ts`
**detrás del `return ok`** —es decir, dentro de la rama de `sin_solucion`: «sólo se avisa cuando ya
es tarde», que es literalmente el defecto que R8 vigila—. Se autocomprueba de tres formas, porque en
este repo un arnés ya reportó «9/9 supervivientes» **dos veces sin ejecutar un solo test**: (1)
**aborta** si el bloque a mutar no está tal cual en el archivo; (2) corre la **base sin mutar** antes
de nada y exige verde; (3) **restaura siempre** en `finally` y comprueba el diff.

**(a) Con el test de HOY — la mutación MUERE:**

```
=== BASE SIN MUTAR ===
 Test Files  1 passed (1)
      Tests  32 passed (32)
exit = 0

=== MUTADO (M-ae: el optlog se mueve tras el `return ok`) ===
 ❯ tests/unit/clients/google-route-optimization.test.ts (32 tests | 1 failed) 22ms
     × R8: una respuesta UTILIZABLE que ademas trae avisos sigue siendo `ok` Y QUEDA ESCRITA 3ms

 Test Files  1 failed (1)
      Tests  1 failed | 31 passed (32)

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  … > 265/R2 — la AUSENCIA de los tres campos nuevos no rompe nada > R8: una respuesta
 UTILIZABLE que ademas trae avisos sigue siendo `ok` Y QUEDA ESCRITA
AssertionError: la respuesta era UTILIZABLE y traia avisos: la traza tenia que decirlo IGUAL:
expected undefined to be defined
 ❯ tests/unit/clients/google-route-optimization.test.ts:412:9
exit = 1
=== RESTAURADO. diff sobre el archivo: '' ===
```

**(b) Con el test ANTERIOR (el de `origin/dev`) — la misma mutación SOBREVIVE.** Esto es lo que
convierte el arreglo en una medición y no en una promesa: se repuso el archivo de test tal como
estaba en `dev` y se corrió **la misma** mutación:

```
--- test ANTERIOR (el de dev) puesto en su sitio ---
375:  it("R8: una respuesta UTILIZABLE que ademas trae avisos sigue siendo `ok`", async () => {

=== BASE SIN MUTAR ===
 Test Files  1 passed (1)
      Tests  32 passed (32)
exit = 0

=== MUTADO (M-ae: el optlog se mueve tras el `return ok`) ===
exit = 0          <- VERDE. La mutacion sobrevivia, tal como midio el reviewer.
=== RESTAURADO. diff sobre el archivo: '' ===
```

Nótese el detalle que lo hace exacto: en **(a)** cae **1 de 32** y sobreviven **31**, entre ellos
**el test de R1** — que es justo la razón por la que el agujero existía. Y el conteo de tests **no
cambia** (32 antes y después): no se añadió un test, se le pusieron dientes al que ya estaba.

⚠️ **Se commiteó ANTES de mutar** (`bc640875`). Restaurar sobre un archivo modificado y sin
commitear se lleva el trabajo por delante; hoy mismo ya le pasó a otro agente aquí. Efecto secundario
visto y corregido: Python reescribe el archivo con **CRLF** en Windows, lo que deja el árbol marcado
como modificado **con un diff vacío**; se normalizó reponiendo el blob y se verificó por bytes
(`CRLF: 0`, 425 saltos de línea).

**`design.md` §10.4 gana `M-ae`**, que es el otro medio de B1: la tabla salió con **treinta**
mutaciones y **ninguna para R8**, así que el arnés tampoco tapaba el hueco. Son **treinta y una**.

### 8.2 · B2 — `tasks.md` pasa de 0/43 a 38 `[x]` · 5 `[ ]`

Marcadas **leyendo las dos bitácoras** y verificando en el árbol lo verificable, no a ojo. El archivo
lleva ahora una cabecera con la tabla de las cinco que siguen vivas, **cada una con su motivo y de
quién es**, y cada task en `[ ]` repite su estado **al lado**, donde lo va a leer quien la tome:

| task | estado |
| --- | --- |
| **B0.1** | ⛔ **No tomable, y se cierra así.** La traza que era su única vía **se apaga en esta misma release** (P4). P1 y P5 quedan abiertas y declaradas. Marcarla `[x]` sería mentir; rellenarla, inventar |
| **C3** | Pre-despliegue. M1 no se pudo medir → el umbral es **declarado, no derivado** |
| **C5** | **H1 no tiene ficha** (medido, §8.4). **H2 sí está resuelto**. Registrar fichas es del leader |
| **C7** | Variable de entorno, no código. Y **en gran parte superada**: el default ya se invirtió, así que poner `RUTA_DEBUG_LOG=0` ya no hace falta para apagarla |
| **C8** | Post-despliegue. No hay despliegue todavía: sin número no se marca |

Y **tres `[x]` llevan su letra pequeña escrita** con ⏳, porque un `[x]` liso sobre ellas también
escondería deuda: **B0.4** (la task se hizo, pero **M1 volvió «no medible»** — de ahí nace C3),
**B16** (las 30 se corrieron **repartidas** entre los dos bloques, y ahora son **31** con `M-ae`) y
**F6** (hecha en **local**, no en preview; la mitad «no se llama al proveedor con ese origen» no se
distingue sin credencial, y esa mitad la cubre el unitario que afirma el **argumento** de
`client.optimizar`).

**Nota sobre C7, que además es una deriva spec ↔ código** (**m6** del reviewer): la task dice «el
valor por defecto del código **no se toca**, eso es P7» y **el código sí lo tocó** — con
autorización, porque la segunda puerta de `requirements.md` cerró P7 como «se **INVIERTE EL DEFAULT
EN EL CÓDIGO**». Lo correcto es el código; lo desactualizado, la task. Queda anotado **dentro de
C7**, que es donde alguien lo va a leer antes de tomarla. `design.md` §1 y §16.1 arrastran la misma
frase vieja y **no se han tocado**: eso es m6 y no estaba en este encargo.

### 8.3 · m1 — `B0.2`, la medición que existía pero no estaba pegada

La task exigía «los dos números pegados **con el snippet que los produjo**». El snippet, ejecutado
con `pnpm exec tsx` sobre las coordenadas de la traza `client/google — ENTRADA` del incidente
(`requirements.md` §2):

```ts
import { distanciaHaversineKm } from "@/lib/geo/polilinea";

const origen = { lat: 6.3422343, lng: -75.514335 };   // Medellin, `fuente: 'gps'`
const paradas = [
  { lat: 9.9029459, lng: -83.6815776 },               // i=0
  { lat: 9.9747225, lng: -84.2068436 },               // i=1..5, las cinco identicas
  { lat: 9.9747225, lng: -84.2068436 },
  { lat: 9.9747225, lng: -84.2068436 },
  { lat: 9.9747225, lng: -84.2068436 },
  { lat: 9.9747225, lng: -84.2068436 },
];

// Misma aritmetica que `centroide()` en `lib/services/OptimizacionRutaService.ts:116`
// (es privada del modulo, no se puede importar; se reproduce verbatim).
const centroide = {
  lat: paradas.reduce((s, p) => s + p.lat, 0) / paradas.length,
  lng: paradas.reduce((s, p) => s + p.lng, 0) / paradas.length,
};

console.log("origen -> parada repetida :", distanciaHaversineKm(origen, paradas[1]!).toFixed(4));
console.log("parada i=0 <-> i=1..5     :", distanciaHaversineKm(paradas[0]!, paradas[1]!).toFixed(4));
console.log("centroide                 :", centroide);
console.log("origen -> CENTROIDE       :", distanciaHaversineKm(origen, centroide).toFixed(4));
```

Salida real:

```
origen -> parada repetida : 1038.3712 km
parada i=0 <-> i=1..5     : 58.0813 km
centroide                 : { lat: 9.962759733333334, lng: -84.11929926666667 }
origen -> CENTROIDE       : 1028.9960 km  <- el que usa la guarda R16
```

**Los tres números, y qué significa cada uno:**

| medida | valor | para qué sirve |
| --- | --- | --- |
| origen → parada repetida | **1.038,3712 km** | confirma el **≈1.040 km** del spec. El «unos 1.400 km» del reporte original era el equivocado |
| parada i=0 ↔ i=1..5 | **58,0813 km** | la **cota inferior legítima**: dos paradas del mismo día y del mismo país. Cualquier umbral tiene que dejar pasar esto |
| origen → **centroide** | **1.028,9960 km** | **es el que de verdad compara la guarda `R16`**, y el que nadie había calculado. A 1.029 km del centroide, con el umbral en 200, el origen se descarta con muchísimo margen |

El reviewer lo recalculó por su cuenta y le dio **1.028,99**: es el mismo número truncado a dos
decimales en vez de redondeado (1.028,996 → **1.029,00**). No hay discrepancia, y se escribe con
cuatro decimales para que no vuelva a haberla. **Los números del spec eran correctos: no se corrige
`requirements.md` §2 ni `design.md` §6.4.** Lo que faltaba era la evidencia, y ya está aquí.

El script se ejecutó y **se borró**: era de un solo uso y no tiene por qué quedarse en el repo. El
texto de arriba es literalmente lo que corrió.

### 8.4 · C2, C6 y la mitad medible de C5

**C2 — pre-vuelo.** `origin/dev` sigue en **`96940710`**, la misma base de la que nació esta rama.
Nadie la movió mientras corría este encargo. ⚠️ **El pre-vuelo caduca**: quien abra el PR lo repite.

**C6 — el blob commiteado, no el árbol.** Verificado sobre `bc640875` leyendo cada archivo **desde
su blob** (`show HEAD:<ruta>`), no desde el árbol de trabajo:

```
tasks.md   -> 38 lineas '- [x]'
tasks.md   -> las 5 en '- [ ]' son exactamente B0.1, C3, C5, C7, C8
design.md  -> 'M-ae' en :905 (la fila de la tabla) y :907 (el porque)
test       -> :375 «Y QUEDA ESCRITA» · :416 skippedShipments: 0, · :417 validationErrors: true,
```

Se comprueba porque el árbol **no distingue** «lo commiteé» de «alguien lo revirtió»: en este repo
otra sesión ya reseteó una rama.

**C5 — lo que se pudo medir, medido; lo que es del leader, sin tocar.** Buscando la línea del token
en el archivo del cliente **tal como está en `origin/dev`**: **cero coincidencias** (`exit=1`). O
sea **H2 (token en el log) está resuelto en `dev`**, y de paso eso cierra la mitad que le faltaba a
**B0.3** («falta confirmarlo contra el remoto»; el árbol local no prueba el remoto). **H1**, en
cambio, **no tiene ficha**: barrido sobre `feature_list.json` buscando la calidad de la
geocodificación / `geocode_precision` como ficha propia → **cero**; los ids vivos alrededor son 265,
266, 267, 268 y 269, y ninguno es H1. Registrarla es del leader, así que **C5 se queda en `[ ]`** con
esto escrito al lado. **`feature_list.json` no se ha tocado.**

### 8.5 · C1 — el gate `./init.sh` COMPLETO, en verde

Escrito para que el exit code **no lo tape un `echo`** (en este repo un `echo` posterior ya hizo
pasar un gate rojo por «exit code 0»): `{ ./init.sh; echo "INIT_EXIT=$?"; } > gate.log 2>&1`, y el
valor se lee **dentro** del log. Antes del gate, `prisma generate --schema db/schema.prisma`: el
cliente vive en un `node_modules` **compartido** por *junction* y otra sesión puede regenerarlo por
debajo, dejando un typecheck rojo con tipos que sí existen (ya pasó dos veces en el bloque backend).

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=2)
✓ specs presentes para features sdd en vuelo
-> pnpm run typecheck
✓ typecheck paso
-> pnpm run lint
✖ 99 problems (0 errors, 99 warnings)
✓ lint paso
-> pnpm run test
 Test Files  1319 passed (1319)
      Tests  17793 passed | 26 skipped (17819)
   Duration  347.91s
✓ test paso
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

Cuatro cosas que se comprueban aquí y no se dan por supuestas:

1. **`INIT_EXIT=0` está DENTRO del log**, en su última línea, no detrás de un `echo` del shell.
2. **Los números son EXACTAMENTE los de la corrida del reviewer** (`1319` archivos, `17793` verdes,
   `26` saltados) — y tienen que serlo: **no se añadió ningún test**, se le pusieron dientes a uno que
   ya existía. Si el total hubiera cambiado, algo más habría pasado.
3. **99 *warnings*, 0 errores**: los mismos 99 que midieron los dos bloques y el reviewer. **Ninguno
   sale de esta rama.**
4. **La lista de «migraciones sin `down.sql`» NO crece**: siguen siendo las tres `ruta_*` del
   2026-08-14 que ya venían así, y que **no se tocan** (editar una migración aplicada es *drift*).

**No hubo rojo que diagnosticar**, así que no hizo falta distinguir «timeout bajo carga» de «base
compartida». Se anota igual porque es la trampa que este árbol tiene puesta: los rojos de
`tests/integration/db/…-migration.test.ts` comparan **enums de la base local** contra listas
literales, y con dos features migrando contra la misma base local salen rojos que **no son de tu
rama**. Aquí ya no aparecen: las migraciones de la 262 están en el árbol desde que se mergeó.

`gate.log` **no se commitea**.

### 8.6 · Lo que este anexo NO hizo, dicho para que nadie lo suponga

1. **Ni una línea de código de producción.** El diff son tres archivos: el test del cliente,
   `design.md` (la fila de `M-ae`) y `tasks.md` (las marcas), más esta bitácora. `lib/`, `app/`,
   `db/` y `components/` están intactos.
2. **Los 11 menores (`m2`-`m11`) siguen abiertos**, incluidos los tres que son deuda de prosa barata
   y que alguien debería tomar: **m4** (la frase de `design.md` §10.2 que llama «el único sitio donde
   el `WHERE` real se mira» a un archivo con Prisma mockeado), **m5** (el comentario de
   `google-route-optimization.ts:208` que sigue diciendo «se apaga con `RUTA_DEBUG_LOG=0`», caducado
   por la inversión del default) y **m6** en `design.md` §1/§16.1. **No estaban en el encargo.**
3. **`progress/review_265.md` no se ha editado.** Es el informe del reviewer y se queda como está,
   con su veredicto RECHAZADO: quien lo revise después compara ese informe con este anexo.
4. **`feature_list.json` y `progress/current.md` no se han tocado.** Son del leader. Con ellos se
   quedan **C5** (registrar la ficha de H1) y **m8** (la entrada en `progress/history.md`).
5. **No se abrió PR ni se mergeó nada.**

---

## 9 · ANEXO 2026-08-23 — los MENORES de la revisión (`m2`-`m11`)

> Rama `fix/265-menores-revision`, desde `origin/dev` en **`bc574d00`** (el merge del PR #469, que
> es el que trajo `progress/review_265.md`). Encargo: cerrar los once menores; **`m1` ya venía
> cerrado** por el anexo §8.3 de más arriba, así que los de esta tanda son diez.
>
> **Ni una línea de lógica cambia.** El diff de `lib/` son **comentarios**; lo que sí cambia de
> verdad son **dos tests nuevos** que ponen rojas dos propiedades que hasta hoy sólo estaban
> escritas. `progress/review_265.md` **no se ha tocado** (es el informe del reviewer),
> `feature_list.json` y `progress/current.md` **tampoco** (son del leader).

### 9.1 · Resumen: qué se cerró y qué no

| # | Qué era | Estado |
| --- | --- | --- |
| **m2** | `F6` a medias: la mitad «y **no** se llama al proveedor con ese origen» | 🔴 **ABIERTO**, y no se puede cerrar aquí (§9.2) |
| **m3** | La 3.ª señal de R43 (`dashArray`) sin ningún test en todo el repo | ✅ **CERRADO** con test + 2 mutaciones (§9.3) |
| **m4** | `design.md` §10.2 llamaba «el único sitio donde el `WHERE` real se mira» a un archivo con Prisma mockeado | ✅ **CERRADO** (prosa, §9.4) |
| **m5** | Comentario caducado: «se apaga con `RUTA_DEBUG_LOG=0`» | ✅ **CERRADO**, más el barrido del repo (§9.5) |
| **m6** | Deriva spec ↔ código sobre P7 en `design.md` §1 y §16.1 | ✅ **CERRADO** (prosa, §9.6) |
| **m7** | `R33` pide «en el mismo orden» y ningún test fijaba el orden | ✅ **CERRADO** con 4 tests + 4 mutaciones (§9.7) |
| **m8** | Falta la entrada en `progress/history.md` | 🔴 **ABIERTO: es del leader** (§9.8) |
| **m9** | Dos migraciones comparten prefijo de timestamp | ✅ **VERIFICADO, sin acción** (§9.9) |
| **m10** | Mina heredada: `getByRole("alert")` en singular en 3 tests ajenos | 🟡 **ABIERTO a propósito** (§9.10) |
| **m11** | Los `warn` agregados no llegan a nadie en producción | ✅ **CERRADO** documentándolo **en el código** (§9.11) |

**Siete cerrados, tres abiertos**, y los tres abiertos **con su motivo**, no maquillados.

### 9.2 · m2 — `F6` sigue a medias, y NO se puede cerrar en esta rama

**Queda ABIERTO. El motivo, exacto:** el punto 3 de `F6` tiene dos mitades. «La ruta sale ordenada
igual» está cerrada con evidencia (`impl_265_frontend.md` §6). La otra mitad —«y **no** se llama al
proveedor con ese origen»— **exige distinguir una llamada que se hizo de una que no**, y en local
**no hay credencial**: sin credencial no se llama al proveedor **nunca**, así que el escenario
«origen incoherente» y el escenario «todo bien» producen la misma observación. No es que nadie lo
haya intentado: **es que en local ese experimento no tiene poder de resolución**.

Lo que haría falta es **preview**, y **esta rama no tiene despliegue**. Tampoco puedo fabricarlo:
en este repo el MCP de Supabase está fijado al proyecto de **producción** y el ref de preview ya se
buscó por cuatro vías distintas sin encontrarlo. Pinchar producción para verificar un menor sería
desproporcionado y no está autorizado.

**Lo que sí se puede decir de esa mitad, medido:** está cubierta por unitario. `optimizacion-ruta-
origen.test.ts` afirma el **argumento** con el que se llamó a `client.optimizar` —o sea, con qué
origen se habría llamado al proveedor—, y esta misma rama le añade un caso más fuerte en el mismo
sentido (el 4.º test de §9.7: el origen que viaja es el centroide de **las paradas que se envían**).
Eso no sustituye a ver la app, y no se pretende que lo haga.

**Queda pendiente para quien despliegue**, tal como ya dice la letra pequeña de `F6` en `tasks.md`:
repetir el punto 3 en preview antes de la release. **No lo marco `[x]`.**

### 9.3 · m3 — la tercera señal de R43, cerrada aquí (y por qué aquí y no en ficha propia)

**La decisión, razonada.** El reviewer la clasifica como «deuda anterior a esta ficha», y lo es: el
`dashArray` lo introdujo la 97. Dos cosas la traen a esta ficha de todos modos:

1. **R43 es un requisito de la 265**, y dice que las **tres** señales conviven y siguen distintas.
   Dos de las tres tenían test. La tercera se afirmaba **hasta las props del mapa** y ahí se paraba,
   así que R43 estaba cubierto a dos tercios. Un requisito de esta ficha a medio probar no es deuda
   de otra ficha: es deuda de ésta.
2. **El coste medido es una hora, no una ficha.** El repo ya tiene el molde resuelto
   (`tests/components/UbicacionMapa.test.tsx` monta un componente de react-leaflet en jsdom con
   `leaflet` y `react-leaflet` mockeados). Abrir una ficha para copiar un molde que ya existe cuesta
   más ceremonia que trabajo. **Por eso se cierra aquí y no hay borrador de ficha nueva.**

**Lo que estaba roto, dicho sin adornos:** `dashArray` aparecía en **un solo sitio** de todo el repo
(`RutaMapaInner.tsx:158`) y **ningún test lo tocaba**. Borrarlo dejaba la suite entera en verde y al
mensajero mirando una línea continua —que le dice «esto es un recorrido navegable»— sobre una
geometría que sólo une paradas en recto. No rompe nada, sólo miente: la familia de fallos que esta
casa lleva persiguiendo.

**Qué se añadió:** `tests/components/RutaMapaInner.test.tsx`, tres casos —`local` → punteada,
`routes` → continua, sin trazado → punteada—. La polilínea del fixture se **codifica con
`codificarPolilinea` del repo** en vez de pegar una cadena mágica: el componente la **decodifica**, y
una cadena inventada caería por la rama de «polilínea corrupta» sin que el test se enterara.

**Mutaciones, con su salida real** (cada una aplicada, corrida y restaurada; `git diff` vacío tras
restaurar):

```
=== BASE ===                            Tests  3 passed (3)
=== M-af: se borra el dashArray ===     Tests  2 failed | 1 passed (3)
=== M-ag: la condicion se invierte ===  Tests  3 failed (3)
```

`M-af` deja vivo el caso `routes` —correcto: ese caso afirma la **ausencia** de `dashArray`— y `M-ag`
mata los tres. Las dos entran en la tabla de `design.md` §10.4.

**Y se corrige el diseño de paso:** §10.2 decía «los **tres textos** presentes» y en el DOM hay
**dos**. Ahora dice qué se prueba en cada sitio y por qué son dos tests.

### 9.4 · m4 — `design.md` §10.2 decía que ahí se mira el `WHERE` real, y no

**Verificado en el árbol antes de tocar la frase**, no aceptado del informe:
`tests/integration/repositories/ruta-optimizada-repo.test.ts:1-50` construye un `prisma` de `vi.fn()`
—incluido un `$transaction` falso— y su propia cabecera lo dice: «*Prisma mockeado (patron del resto
de `tests/integration/repositories`: la suite NO levanta Postgres)*». Las aserciones de la 265 en ese
archivo (`:259-320`) leen `args.update.secuenciaFuente` y `args.create.secuenciaFuente`: **argumentos
que se le pasan a Prisma**, no SQL ejecutado.

**No se borra la frase, se dice qué es en realidad** (que era lo pedido): el archivo afirma los
**argumentos** con los que el repositorio llama a Prisma y que la escritura va **dentro de la misma
transacción**; y se nombra quién **sí** mira el SQL —el test estático de la migración por regex sobre
el `.sql`, el `@map` de `db/schema.prisma` y `F6` contra el Postgres local—. Se deja escrito, con
todas sus letras, lo que la creencia vieja escondía: **un `WHERE` mutado que Prisma acepte pasa ese
test en verde**. En este repo eso ya se midió cuatro veces seguidas.

**Es prosa: no lleva test, y no se finge que lo lleve.** Se verificó **leyendo el código que
describe**, que es la otra forma de comprobarla.

### 9.5 · m5 — el comentario caducado, y el barrido que el encargo pedía

`lib/clients/google-route-optimization.ts:208` decía «*se apaga con `RUTA_DEBUG_LOG=0`*». **Miente
hoy**: `activo()` (`lib/logging/optimizer-log.ts`) devuelve `true` **sólo** con `1` o `true`, así que
la traza **nace apagada** y esa variable sirve para **encenderla**. Corregido, y se deja escrito **qué
decía antes y por qué caducó**, para que el siguiente no lo lea como un cambio arbitrario.

**El barrido, que era la parte que no se arregla sola.** `grep -rn RUTA_DEBUG_LOG` sobre todo el repo
(sin `node_modules`, `.git` ni `.next`) → **7 archivos de código/spec vivos** con la frase o su idea.
Uno por uno:

| Dónde | Veredicto |
| --- | --- |
| `lib/clients/google-route-optimization.ts:208` | ❌ **mentía → corregido** |
| `specs/…/requirements.md:39` (glosario, fila «la traza») | ❌ **mentía → anotado** con ⏳: describía el estado de antes de P7, y hoy el código hace lo contrario. Es la fila de **Vocabulario**, no un EARS: se **anota**, no se reescribe un requisito aprobado |
| `lib/logging/optimizer-log.ts:14` | ✅ **se deja**: la instrucción vieja lleva su corrección **en el renglón siguiente** (⏳ FEATURE 265). Es registro histórico con su enmienda pegada, no una frase suelta que engañe |
| `lib/logging/optimizer-log.ts:31` | ✅ **se deja**: está **entre comillas** («…») como cita de lo que la función decía antes, dentro del párrafo que explica la inversión |
| `tests/setup/jest-dom.ts:31-36` | ✅ correcto: ya dice que la línea es **hoy redundante** y por qué se conserva igual |
| `.env.example:80` | ✅ correcto: «**enciende** la traza» |
| `specs/…/design.md` §1, §16.1, §16.3 | ❌ **eran m6 y quedan corregidos** (§9.6) |

También se corrigieron **dos referencias de línea podridas** que aparecieron en el mismo barrido:
`design.md` apuntaba a `optimizer-log.ts:37-39` y a `jest-dom.ts:28`, y hoy ninguna de las dos es la
línea que dice. Se sustituyen por **el nombre de la función y el de la línea de código**, que no rota.

### 9.6 · m6 — la deriva sobre P7, cerrada en el diseño (la task ya la llevaba)

**Primero se comprobó si seguía vivo, como pedía el encargo.** En `tasks.md`, **`C7` sí lo llevaba
anotado** (⛔ con dos correcciones, puesto por el anexo §8.2). En `design.md`, **no**: §1 seguía
diciendo que invertir el default **NO entra** en la ficha, y §16.1 seguía diciendo «**Cero líneas de
código**». Las dos frases dicen lo contrario de lo que hace el código.

Lo correcto es el código, y **está autorizado**: la segunda puerta de `requirements.md` cerró **P7**
como «se **INVIERTE EL DEFAULT EN EL CÓDIGO**». Corregidas las dos, con el texto viejo citado dentro
de la corrección. Y el párrafo de §16.1 sobre «en qué entornos lo decide el humano» lleva ahora su
anexo: **con el default invertido, poner la variable ya no hace falta para apagar nada**; lo único
que sobrevive de ese párrafo es no ponerla en Production y Preview a la vez el día que alguien la use
para **encender** la traza. `C7` apunta de vuelta a que el diseño ya está corregido.

**Es prosa: sin test, verificada leyendo `activo()`.**

### 9.7 · m7 — `R33` pide «en el mismo orden», y eso ahora se pone rojo

R33 pide dos cosas: que las guardas de coste corten **igual** y **en el mismo orden**. La primera
mitad tenía cinco tests (cada guarda con su `expect(client.optimizar).not.toHaveBeenCalled()`). La
segunda **descansaba en el comentario normativo de la cabecera del servicio**, y un comentario no se
pone rojo.

**Por qué el orden no es cosmética.** Está elegido para que **lo barato corte antes que lo caro**.
Reordenarlo no cambia el resultado cuando sólo hay un motivo —por eso los tests de cada guarda
seguirían verdes— pero cambia **cuánto se paga y cuánto se lee** cuando coinciden dos, que es el caso
real. Y en un punto no es coste sino corrección: `centroide()` devuelve `NaN` con cero paradas, así
que la guarda de 0 ó 1 parada **tiene** que ir antes de que alguien resuelva un origen.

**La técnica:** montar escenarios donde **dos** guardas cortarían a la vez y afirmar **cuál ganó**.
Cada guarda devuelve su propia `razon`, así que el ganador es observable sin espiar nada interno.
Cuatro casos, en `optimizacion-ruta-service.test.ts`, describe «265/R33 — las guardas cortan EN ESTE
ORDEN»:

| Caso | Escenario | Se afirma |
| --- | --- | --- |
| R20 < R34 | job obsoleto **y** dentro del intervalo | `razon: "obsoleta"`, y que **no se leen las paradas** |
| R34 < R35 | cero paradas **y** dentro del intervalo | `razon: "intervalo_minimo"` **y `findParadasEnReparto` sin llamar** — el doble clic no cuesta ni una lectura de base |
| R35 < R36 | una parada **y** la misma huella que la última vez | `razon: "sin_paradas"` y que la secuencia trivial **sí** se reescribe con `secuenciaFuente: null` |
| R38 < 265/R16 | 3 paradas con tope 2 y origen incoherente | el origen que viaja es el centroide de **las 2 que se envían** (9,94 / −84,10), no el de las tres (13,29 / −89,4) |

Detalle del tercero, porque importa cómo está hecho: la huella es un hash privado, así que **no se
reimplementa aquí** —eso sería compararla contra sí misma—. Se hace una primera corrida, se **lee la
huella que el servicio persistió** y se le devuelve al escenario de la segunda.

**Mutaciones, con su salida real.** Arnés con autocomprobación: imprime el **conteo de cada corrida**,
no sólo el exit code (en este repo un arnés de mutaciones ya reportó «9/9 supervivientes» dos veces
**sin haber ejecutado un test**). Corrido **dos veces** —la segunda después de un ajuste de tipos—,
con el mismo resultado:

```
=== BASE (sin mutar) ===                                          Tests  40 passed (40)
=== M-ah: el intervalo minimo por delante de la obsolescencia === Tests  1 failed | 39 passed (40)
    FAIL … 265/R33 … > R20 antes que R34: job obsoleto Y dentro del intervalo -> gana `obsoleta`
=== M-ai: el intervalo minimo por detras de leer las paradas ===  Tests  1 failed | 39 passed (40)
    FAIL … 265/R33 … > R34 antes que R35: … y NO se lee la base
=== M-aj: la guarda de 0/1 parada deja de cubrir el caso de UNA = Tests  5 failed | 35 passed (40)
    FAIL … 265/R33 … > R35 antes que R36: UNA parada Y la misma huella … -> gana `sin_paradas`
=== M-ak: la coherencia del origen sobre las paradas SIN recortar Tests  1 failed | 39 passed (40)
    FAIL … 265/R33 … > el recorte R38 va ANTES de la guarda del origen
--- restaurando ---  diff tras restaurar: ''   (las cuatro veces)
=== BASE otra vez ===                                             Tests  40 passed (40)
```

⚠️ **Lean el número, que es la medida del agujero:** `M-ah` y `M-ai` matan **UN test de 40**. O sea
que **39 tests sobreviven a reordenar las guardas de coste**, incluidos los cinco que las prueban una
a una. Eso es exactamente lo que m7 decía, ahora medido en vez de supuesto.

Las cuatro entran en `design.md` §10.4 y la fila de R33 en §10.2 deja de decir «los tests que ya
existen» a secas. La **cabecera del servicio** apunta ahora al describe nuevo, y de paso se corrige
que decía «LAS **CUATRO** GUARDAS» mientras listaba **cinco**.

⚠️ **Lección re-aprendida, y esta vez me costó a mí.** El arnés restaura con `git checkout -- <file>`,
y eso se lleva por delante **cualquier cambio sin commitear de ese archivo**. Mi comentario de m11
en `OptimizacionRutaService.ts` estaba sin commitear cuando corrí las mutaciones: **se borró en
silencio**. Se detectó y se repuso. La regla que ya estaba escrita en §8.1 y que se confirma: **commit
ANTES de mutar**, y comprobar el **blob**, no el árbol.

### 9.8 · m8 — la entrada en `progress/history.md`: es del leader

**Queda ABIERTO, y no por olvido.** `history.md` es el registro de cierre de la ficha y lo escribe el
leader cuando la feature se da por terminada; esta ficha sigue `in_progress` y **tiene pendientes
reales** (`C3`, `C7`, `C8`, la mitad de `F6`). Escribir su entrada de cierre desde aquí sería
anunciar un final que no ha ocurrido. Igual que `feature_list.json` y `current.md`: **no se tocan**.

### 9.9 · m9 — el prefijo compartido: verificado, sin daño, y sin tocar nada

Los dos directorios existen y son **distintos**:

```
db/migrations/20260822140000_notificacion_evento_dia_reparto_corregido/   (262: dos enums)
db/migrations/20260822140000_ruta_secuencia_fuente/                       (265: una columna)
```

Prisma indexa por **nombre de directorio**, no por prefijo, así que compartir el timestamp no las
enfrenta: tocan tablas distintas y ninguna depende de la otra. Comprobado contra la base local, en
solo lectura y sin exponer credencial:

```
$ pnpm exec prisma migrate status --schema db/schema.prisma
Datasource "db": PostgreSQL database "ordenex", schema "public" at "localhost:5432"
143 migrations found in prisma/migrations
Database schema is up to date!
```

**No se renombra ni se toca ninguna de las dos.** Editar o renumerar una migración **ya aplicada** es
*drift*, y deja una fila fantasma que `migrate status` no ve. Se anota y se deja quieto, que es lo
que el reviewer pedía.

### 9.10 · m10 — la mina de `getByRole("alert")`: abierta a propósito

**Queda ABIERTA, y es una decisión, no un descuido.** Los tres usos
(`RepartoModule.test.tsx:839`, `:1152`, `:1463`) están **verdes hoy** y son correctos: en sus
escenarios hay **una** alerta. La mina sólo muerde a quien escriba un caso con **dos** a la vez.

Arreglarla de verdad significa hacer esas tres consultas específicas (a qué alerta apuntan), y eso es
**editar tests ajenos y verdes** en un archivo de 2.700 líneas que otras ramas están tocando ahora
mismo. El encargo dice **no relajar ni tocar tests ajenos**, y aquí el riesgo (conflicto, o peor:
debilitar una aserción sin querer) supera al beneficio de un cambio que **no arregla nada roto**.

Queda declarada donde ya estaba —`impl_265_frontend.md` §5.1 y §8.4— y ahora también aquí. Si alguien
tropieza con el `multiple elements`, esta entrada le dice qué es en un renglón.

### 9.11 · m11 — los `warn` que no lee nadie, escrito donde se lee

**Verificado en el árbol, no leído del informe.** Hay **dos** `defaultLogger` no-op y **una** sola
construcción real que los deja a los dos por defecto:

- `lib/services/OptimizacionRutaService.ts` → `const defaultLogger: RutaLogger = { warn: () => {} }`
- `lib/clients/fallback-route-optimization.ts` → `const defaultLogger: FallbackLogger = { warn: () => {} }`
- `lib/services/jobs/optimizacion-ruta-handler.ts:120-128` pasa **`undefined`** en la posición del
  logger del servicio y **no le pasa logger** al compuesto. Los dos únicos puntos de entrada
  (`app/api/cron/procesar-jobs/route.ts:75` y `lib/actions/ruta-mensajero.ts:66`) llaman a esa misma
  función. **No hay ninguna otra construcción.**

**No es un defecto y no se arregla: es el límite declarado 5**, cerrado a propósito por **P8** —la
operación se entera consultando `ruta_optimizada.secuencia_fuente`, un dato persistido, no un log que
expira—. Lo que sí era un defecto es **dónde estaba escrito**: sólo en `design.md` §14.3, y el código
decía lo contrario. En `fallback-route-optimization.ts` el comentario junto al `warn` decía
literalmente que servía «*para que un operador note que se está ordenando en local*». **Nadie lo
nota.**

Se escribe el límite **en los dos `defaultLogger`** y se corrige ese comentario, con la consecuencia
práctica delante: **no cuelgues nada de estos `warn`**, y si un día hacen falta, se inyecta un logger
real en `buildOptimizacionRutaService` —el hueco ya está en el constructor—.

**Es prosa: sin test.** Lo verificable es el cableado, y está medido arriba.

### 9.12 · El gate — `./init.sh` COMPLETO, en verde

`pnpm exec prisma generate --schema db/schema.prisma` **justo antes** (el cliente vive en un
`node_modules` compartido por *junction*), y el `echo` **dentro** del redirect:
`{ ./init.sh; echo "INIT_EXIT=$?"; } > gate.log 2>&1`.

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
✓ regla max-2-por-zona respetada (in_progress=2)
✓ specs presentes para features sdd en vuelo
-> pnpm run typecheck
✓ typecheck paso
-> pnpm run lint
✖ 99 problems (0 errors, 99 warnings)
✓ lint paso
-> pnpm run test
 Test Files  1320 passed (1320)
      Tests  17800 passed | 26 skipped (17826)
   Duration  353.61s
✓ test paso
! migraciones sin down.sql: 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at
✓ .env presente
== init OK ==
INIT_EXIT=0
```

Cuatro comprobaciones, no cuatro afirmaciones:

1. **`INIT_EXIT=0` está DENTRO del log.** No hubo rojo, así que no hizo falta distinguir «timeout bajo
   carga» de «base compartida»; se deja dicho el criterio por si alguien lo repite mientras otro
   agente trabaja.
2. **Los números crecen EXACTAMENTE lo que se añadió**, y eso es la comprobación: `1319 → 1320`
   archivos (+1, `RutaMapaInner.test.tsx`) y `17.793 → 17.800` verdes (**+7** = 3 de m3 + 4 de m7).
   `26` saltados, igual. **Ningún test ajeno se movió, ni se relajó, ni desapareció.**
3. **99 *warnings*, 0 errores**: los mismos 99 del bloque backend, del frontend y del reviewer.
   **Ninguno sale de esta rama.**
4. **La lista de «migraciones sin `down.sql`» NO crece**: las mismas tres `ruta_*` del 2026-08-14.
   Esta rama **no toca `db/`**.

`gate.log` **no se commitea** (se borra al terminar), y el `.env` copiado del repo principal
**tampoco**: está en `.gitignore` y se borra al cerrar el worktree.

### 9.13 · Lo que este anexo NO hizo

1. **Cero cambios de lógica.** En `lib/` el diff son **sólo comentarios** (`git diff` lo confirma
   línea a línea). Lo que cambia de comportamiento observable es **cero**; lo que cambia es qué se
   pone rojo.
2. **No se tocó `progress/review_265.md`.** Es el informe del reviewer y se queda con su veredicto
   RECHAZADO: quien revise después compara ese informe contra este anexo.
3. **No se tocó `feature_list.json` ni `progress/current.md`.** Son del leader. Con ellos siguen
   `C5` (la ficha de H1) y **m8**.
4. **No se relajó ni se borró un solo test ajeno.** Los tres `getByRole("alert")` de m10 siguen
   exactamente como estaban (§9.10).
5. **No hay borrador de ficha nueva**, porque **m3 se cerró aquí** en vez de derivarse; el porqué
   está razonado en §9.3.
6. **No se abrió PR ni se mergeó nada.**

### 9.14 · Lo que cambia en el mapa `R<n> → test`

Dos filas de los mapas de §4 (aquí) y §4 (`impl_265_frontend.md`) se quedan cortas y se corrigen
**aquí**, sin reescribir las secciones de los bloques anteriores:

| R | Decía | Dice ahora |
| --- | --- | --- |
| **R33** | `optimizacion-ruta-service.test.ts` (R20/R34/R35/R36/R38, **sin tocar**) | lo mismo **+** `optimizacion-ruta-service.test.ts` → describe «**265/R33 — las guardas cortan EN ESTE ORDEN**» (4 tests). Los de antes cubrían «cortan igual»; éstos cubren «**y en el mismo orden**», que es la mitad que R33 pide y que no tenía test |
| **R43** | `RepartoModule.test.tsx` → «R43: las TRES señales conviven…» (1 test) | lo mismo **+** `RutaMapaInner.test.tsx` → «**265/R43 — la tercera señal: el trazado LOCAL se dibuja PUNTEADO**» (3 tests). El primero llega a las **props** del mapa; el segundo, a la **línea punteada** |

**Ningún otro `R<n>` cambia de test**, y ninguno pierde el que tenía.
