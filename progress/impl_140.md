# Implementación 140 — Guardia central de transiciones de `order_status`

> Rama: `feature/140-flujo-estados-guardia-central` (desde `origin/dev`, con 137/138/139 ya
> mergeadas). Zona: backend. Spec CERRADO (Q1–Q7 resueltas en el gate F1.4 del 2026-07-25).
> Sin migraciones, sin `down.sql`, sin RLS, sin endpoints nuevos (§2/§6 de `design.md`).
>
> **Revisión 2 (tras el review de `progress/review_140.md`, que RECHAZÓ el commit `9fba420`).**
> BLOQ-1 cerrado: la guardia pasa a **FALLO CERRADO** (ya no hay ninguna ruta por la que una
> entrada llegue al `createMany` sin haber pasado por `assertTransicionValida`) y las 24 suites
> de call-sites que la tenían APAGADA ahora la ejercitan con un catálogo explícito. BLOQ-2
> cerrado: `tasks.md` con T1.1–T4.2 en `[x]`. Nota menor del `via` de `ruteo_satelite`: corregida.

## Archivos

**Nuevos (producción)**
- `lib/types/order-status-transiciones.ts` — `TRANSICIONES` (**43** aristas de flujo / 39 pares
  únicos), `ESTADOS_CREACION` (3), `ESTADOS_TERMINALES` (2), `ESTADOS_VESTIGIALES` (VACÍO, Q2),
  `TransicionIlegalError`, **`TransicionNoValidableError`**, `assertTransicionValida`,
  `esOrderStatusValue`.
  Dominio PURO: sin Prisma, sin efectos secundarios, sin lectura de entorno.
  Exhaustividad estática por partida doble: `as const satisfies Record<OrderStatusValue, …>`
  + `_EnsureExhaustive` (patrón `orden-historial.ts`).

**Modificados (producción)**
- `lib/repositories/registrar-cambio-estado.ts` — `appendCambioEstado` valida CADA entrada del
  lote antes del `createMany`; parámetro nuevo `catalogo: CatalogoEstadosResolver` opcional con
  default real (`resolverCatalogoEstadosReal`), mismo patrón que `emitir: WebhookEmisor` ⇒ los
  ~18 call-sites NO cambian. Resolución `id -> value` con UNA consulta cacheada por proceso.
  `resetCatalogoEstadosCache()` exportado solo para tests.
  **FALLO CERRADO (rev. 2):** el tipo del resolvedor ya no admite `null`; catálogo ilegible,
  vacío o `tx` sin `$queryRaw` ⇒ `TransicionNoValidableError`; un `id` que no resuelve a un
  `value` conocido por el build ⇒ `TransicionNoValidableError` (ya no `continue`).

**Tests nuevos**
- `tests/unit/domain/order-status-transiciones.connectividad.test.ts` (T3.1).
- `tests/unit/domain/order-status-transiciones.guardia.test.ts` (T3.2).
- `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` (T3.3 + T3.4).
- `tests/fixtures/inventario-transiciones-140.ts` — **fixture compartida, no es un test**:
  transcripción A MANO del apéndice A (43 aristas de flujo + 3 de creación + recuentos).
  Se consume desde T3.2 y T3.4 para no tener dos copias divergentes del inventario.
- `tests/fixtures/catalogo-estados.ts` (rev. 2) — **helper compartido**: `idEstado(value)`,
  `filasCatalogoEstados()` y `sembrarCatalogoEstados()`. Da a los dobles de `tx` de las suites
  de call-sites el catálogo EXPLÍCITO que la guardia de fallo cerrado exige, usando sólo la API
  pública del resolvedor (calienta su caché por proceso). Sin hooks nuevos en producción.

**Suites de call-sites adaptadas (rev. 2, 24 archivos).** Todas tenían ids sintéticos
(`os-x`, `s-previo`) que ningún catálogo resuelve, así que con el bypass la guardia quedaba
APAGADA justo donde se modelan los call-sites reales. Ahora usan `idEstado(<value>)` +
`sembrarCatalogoEstados()`, con pares que existen en `TRANSICIONES`:
`cierre-dia-repository`, `cierres-admin-repository`, `CierresAdminRepository.resolverCierre.devolucion`,
`orden-repository`, `orden-repository.guia`, `orden-repository.bulk`, `orden-repository.carga-api`,
`orden-repository.cancelar-api`, `orden-repository.recepcion-satelite`,
`orden-repository.recepcion-bodega-central`, `orden-repository.asignacion-satelite`,
`orden-historial-repository`, `orden-historial-atomicidad`, `gestion-orden-repository`,
`gestion-orden-evidencia`, `gestion-orden-reprogramar`, `devolucion-sla-repository`,
`recuperacion-bodega-repository`, `liberacion-reprogramada-repository`,
`orden-webhook-enqueue`, `orden-geocode-enqueue`, `optimizacion-ruta-enqueue`,
`resolver-novedad-recupera-sla`, `resolver-novedad-reprograma-sla`.
Tres ajustes NO son de fontanería y quedan documentados como cambio de contrato querido:
1. `orden-repository.test.ts` creaba una orden directamente en `en_bodega_central` -> ahora
   nace en `en_preparacion` (Q5/A.3-#8: la creación se valida).
2. `orden-repository.test.ts` ajustaba `en_bodega_central -> entregada` con `ajuste_estado`
   -> ahora usa la arista real #28 (`devolviendo_a_tienda -> devuelta_a_tienda`): Q3, el
   escape hatch no tiene override.
3. `orden-repository.guia.test.ts`: la pre-lectura del origen devolvía `[]` (origen `null` por
   el `?? null` defensivo). Ahora el doble modela la realidad y devuelve el estado actual de
   cada orden consultada. **Ninguna guardia se relajó para que pasaran.**

**Sin tocar:** ningún service, ningún call-site de producción, ningún componente, ninguna migración.

## Trazabilidad R1..R17 → test

| R | Qué exige | Test (archivo → nombre) |
| --- | --- | --- |
| R1 | módulo único `TRANSICIONES` como fuente de verdad | `tests/unit/domain/order-status-transiciones.guardia.test.ts` → *el mapa declara exactamente las aristas del inventario, ni una mas* |
| R2 | metadato de familia/rol por arista, sin alterar la legalidad | `…guardia.test.ts` → *el mapa declara exactamente las aristas del inventario, ni una mas* (compara `origen->destino (via)` con el inventario) + `…connectividad.test.ts` → *cada estado de creacion es alcanzable desde START y tiene salida de flujo* |
| R3 | conjuntos explícitos de creación y terminales | `…connectividad.test.ts` → *cada estado de creacion es alcanzable desde START y tiene salida de flujo*; *los estados terminales tienen entrada y estan exentos de necesitar salida* |
| R4 | validar por `value`, no por `id` | `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` → *acepta un resolvedor inyectado y valida con el, sin tocar el tx*; `…guardia.test.ts` (dominio) → *esOrderStatusValue reconoce los value del SEED y descarta lo demas* |
| R5 | exhaustividad frente a `ORDER_STATUS_SEED` (build o test) | build: `satisfies Record<OrderStatusValue,…>` + `_EnsureExhaustive` (verificado a mano: añadir un value ficticio al SEED rompe `tsc` en `order-status-transiciones.ts:140` y `:181`); test: `…connectividad.test.ts` → *el mapa declara una entrada por cada value del catalogo (exhaustividad, R5)* |
| R6 | transición fuera del mapa (o no demostrable) ⇒ rechazo, sin historial ni webhook | `tests/unit/domain/order-status-transiciones.guardia.test.ts` → *lanza TransicionIlegalError en %s -> %s* (6 casos), *rechaza el auto-lazo de cualquier estado (X -> X nunca esta declarado)*, *REGRESION 139/R9: rechazada -> devolviendo_a_tienda es ILEGAL (arista #27 retirada)*; `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` → *lanza TransicionIlegalError y NO escribe historial ni encola webhook*; **fallo cerrado**: *un tx sin $queryRaw (doble parcial) RECHAZA el append*, *un $queryRaw que no devuelve filas de catalogo RECHAZA el append*, *DRIFT DB->build: un value que el build no conoce NO pasa sin validar*, *un fallo de lectura del catalogo se propaga y revierte la tx (no degrada)* |
| R7 | lote con ≥1 ilegal ⇒ rechazo atómico | `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` → *lanza TransicionIlegalError y NO escribe historial ni encola webhook*; *valida el lote ANTES del createMany, sea cual sea la posicion de la ilegal* |
| R8 | ninguna transición legítima existente empieza a fallar (43 aristas + 3 de creación) | **data-driven sobre el inventario COMPLETO**: `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` → *#%i deja pasar %s -> %s (origen_tipo %s) y registra el historial* (43 casos) + *creacion null -> %s (origen_tipo %s) pasa la guardia* (3 casos) + *el test recorre el inventario COMPLETO (43 aristas de flujo + 3 de creacion)*; dominio: `…guardia.test.ts` → *#%i acepta %s -> %s* (43 casos) |
| R9 | el ajuste administrativo pasa por la MISMA guardia (sin override) | `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` → *R9/Q3: el ajuste administrativo generico NO tiene override ANY -> ANY*; dominio: `…guardia.test.ts` → *R9/Q3: no existe override ANY -> ANY; el ajuste administrativo pasa por el mismo mapa* |
| R10 | creación (`null -> X`) validada contra `ESTADOS_CREACION` | `…guardia.test.ts` (dominio) → *acepta nacer en %s (via %s)* (3), *acepta EXACTAMENTE los tres estados de creacion del catalogo*, *rechaza nacer en %s (fuera de ESTADOS_CREACION)* (15); choke point: *R10: nacer (origen null) fuera de ESTADOS_CREACION se rechaza en el choke point* |
| R11 | transición legal ⇒ comportamiento idéntico (append + webhook) | `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` → *hace el mismo append del historial y el mismo encolado del webhook*; *un lote vacio sigue siendo no-op: ni consulta el catalogo ni escribe* (+ la suite histórica del choke point, 511 archivos verdes) |
| R12 | error(es) tipado(s), `instanceof`, sin PII | `…guardia.test.ts` (dominio) → *es asertable por instanceof y conserva origen/destino*; *el mensaje menciona SOLO los dos value del catalogo*; *el mensaje de la creacion ilegal no expone ids ni el actor*; choke point: *el error identifica el par ofensor sin filtrar el id de la orden ni el actor*; *el error de no-validable no filtra ids ni PII* (`TransicionNoValidableError`) |
| R13 | O(1) por transición, sin round-trips de DB extra | `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` → *resuelve el catalogo UNA sola vez por proceso, aunque se llame muchas veces*; *un lote de 50 transiciones no dispara una consulta por transicion*; *la cache se comparte entre llamadas con distintos tx*; dominio: *valida sin efectos secundarios: mil llamadas no mutan el mapa* |
| R14 | invariante de conectividad (entrada/salida, START virtual, terminales exentos) | `tests/unit/domain/order-status-transiciones.connectividad.test.ts` → *todo estado NO terminal tiene al menos UNA salida*; *todo estado tiene al menos UNA entrada (los de creacion, desde START)*; *los estados terminales tienen entrada y estan exentos de necesitar salida* |
| R15 | el test FALLA nombrando los `value` ofensores | mismos tres tests de R14: el assert compara la LISTA de ofensores contra `[]` y el mensaje la enumera (`callejon sin salida: …` / `cuello de botella inalcanzable: …`) |
| R16 | cobertura EXACTA de los 18 `value`, sin exenciones | `…connectividad.test.ts` → *los value que aparecen en el mapa, terminales y creacion cubren los 18 del SEED*; *el conjunto de estados vestigiales declarados esta VACIO (Q2)* |
| R17 | cada `R<n>` mapeado a un test | este documento |

Recuento de tests nuevos: **151** en 3 archivos (rev. 2).
Conectividad 7 · guardia de dominio 78 · choke point 66.
Además, **24 suites de call-sites** que antes NO ejercitaban la guardia ahora la ejercitan de
verdad (ver "Prueba de que la guardia está encendida").

## Decisiones Q1–Q7, tal como se aprobaron (no re-litigadas)

- **Q1 — terminales.** `entregada` y `devuelta_a_tienda`. `entregada` conserva su salida
  legítima #31 (deshacer gestión): el test EXIME a los terminales de necesitar salida, no se
  la prohíbe.
- **Q2 — sin allowlist vestigial.** `ESTADOS_VESTIGIALES = []`. `en_ruta_bodega_central` entra
  por `START` (carga API) y sale por #30/#37: ya no es cuello de botella. El mecanismo queda
  documentado y exportado VACÍO, para un estado futuro.
- **Q3 — todo pasa por la guardia.** NO se declara override `ANY -> ANY`, ni para
  maestro/admin. `OrdenService.actualizar` (`origen_tipo = ajuste_estado`) queda sujeto a
  `TRANSICIONES`; sus aristas legítimas están declaradas (#28, #40, #42).
  **Consecuencia operativa asumida y escrita:** rescatar a mano una orden atascada exige
  DECLARAR la arista en `lib/types/order-status-transiciones.ts` y DESPLEGAR (PR + CI). No hay
  palanca en caliente ni permiso de rol que lo evite.
- **Q4 — 137/138/139 verificadas contra código.** El mapa se pobló releyendo los call-sites
  (`GuiaAsignacionService`, `CierresAdminRepository`, `CierreDiaService/Repository`,
  `DevolucionSlaRepository`, `RecuperacionBodegaRepository`, `LiberacionReprogramadaRepository`,
  `GestionOrdenRepository`, `OrdenRepository`, `RecepcionBodegaCentralService`,
  `EnvioDevolucionCentralService`, `DevolucionOrigenService`, `RecepcionOrigenService`,
  `BulkOrdenService`, `lib/config/ordenes.ts`). **Cero divergencias** con el apéndice A.
- **Q5 — la creación SÍ se valida.**
  `ESTADOS_CREACION = ["en_preparacion", "en_fulfillment", "en_ruta_bodega_central"]`.
- **Q6 — `throw` tipado.** `TransicionIlegalError` (`instanceof`, `name`, `origen`, `destino`),
  mensaje = `transicion ilegal: <origen|creacion> -> <destino>`, sólo los dos `value`.
  La firma pública de `appendCambioEstado` NO cambia para los call-sites.
- **Q7 — ACTIVACIÓN ESTRICTA día 1.** No hay modo shadow, ni solo-log, ni feature flag, ni
  variable de entorno, ni `ordenesConfig.*`, ni parámetro de bypass. Un `grep` del PR no
  encuentra ningún interruptor. Mitigación del riesgo asumido: el test data-driven sobre el
  inventario COMPLETO (T3.4) + la cobertura exacta del catálogo (T3.1).

## Notas de implementación (para el reviewer)

1. **`rechazada -> devolviendo_a_tienda` NO está declarada** (el viejo #27). La 139 la retiró a
   propósito (su R9); hay un test de regresión explícito que exige que sea ILEGAL.
2. **43 aristas de flujo, 39 pares únicos.** Cuatro pares están declarados dos veces con
   familias distintas: #19/#23 (`devuelta -> en_bodega_central`) y #20/#24
   (`devuelta -> en_bodega_satelite`) — SLA vs. recuperación manual —, y **#3/#7b, #6/#7c**
   (`en_fulfillment`/`en_preparacion -> en_ruta_bodega_satelite`) — `generacion_guia` no-GAM
   vs. `ruteo_satelite`. Estas dos últimas son la **corrección de la nota menor 1 del review**:
   `ORIGEN_RUTEO_SATELITE` (`GuiaAsignacionService.ts:35`) admite tres orígenes y el apéndice A
   sólo listaba el de `en_bodega_central`. Cambia el metadato (R2) y el recuento por call-site
   (41 -> 43); **la legalidad no cambia** (los pares ya estaban declarados).
3. **Resolución `id -> value` (design §4).** Una consulta `SELECT id, value FROM order_status`
   dentro del `tx` en curso, cacheada por proceso (el catálogo es inmutable tras el seed) ⇒
   cero round-trips en el camino caliente aunque el lote traiga 50 transiciones. Coste asumido
   (design §4): la PRIMERA escritura de estado de cada proceso (cada lambda nueva) añade esa
   consulta dentro de la tx del call-site.
4. **FALLO CERRADO — corrección del BLOQUEANTE 1 del review.** La revisión 1 dejaba pasar sin
   validar toda entrada cuyo `id` no resolviera a un `OrderStatusValue` conocido. Era alcanzable
   en producción (un deploy que siembra values nuevos mientras instancias del build anterior
   siguen sirviendo: el id existe en `order_status`, la FK está satisfecha y la transición se
   colaba), y encima mantenía la guardia APAGADA en las 24 suites de call-sites. Corregido:
   - el tipo `CatalogoEstadosResolver` ya **no admite `null`**;
   - `tx` sin `$queryRaw`, catálogo no-array o catálogo vacío ⇒ `TransicionNoValidableError`;
   - un `id` (origen o destino) que no resuelve ⇒ `TransicionNoValidableError`;
   - un fallo transitorio de lectura se propaga y revierte la tx (ya era fallo cerrado).
   Es decir: **no existe ninguna ruta por la que una entrada llegue al `createMany` sin haber
   pasado por `assertTransicionValida`**. `TransicionNoValidableError` es distinto de
   `TransicionIlegalError` ("no pude validar" ≠ "es ilegal") y su mensaje tampoco lleva PII.
   El test que consagraba el fail-open ("un tx que no puede leer el catalogo no rompe el
   append") fue **eliminado** y sustituido por cinco que exigen el rechazo, incluido el caso de
   drift DB→build.
5. **Endurecimiento de `OrdenService.crear` (A.3-#8).** Con R10 activo, crear en un estado fuera
   de los tres de creación pasa a lanzar. **Verificado que ningún flujo de producción lo hace:**
   la Server Action `crearOrden` no está referenciada por ninguna página/componente
   (`app/`, `components/`, `hooks/`), y los tres caminos reales de creación son
   `OrdenService.crear` sin `estatusId` (default `en_preparacion`), `BulkOrdenService` (carga
   masiva: `en_preparacion`/`en_fulfillment`) y `BulkOrdenService.cargarViaApi`
   (`en_ruta_bodega_central`). **Ningún test existente hubo que ajustar ni aflojar.**
6. **Cero `any`.** El único cast es el `typeof (tx as { $queryRaw?: unknown }).$queryRaw`
   con el que el resolvedor detecta un `tx` incapaz de leer el catálogo (mismo idiom que el
   emisor de webhooks) — y ahora esa detección **lanza**, no degrada.
7. **`ESTADOS_CREACION` vs. `lib/config/ordenes.ts` (nota menor 3 del review).** El mapa fija
   los tres estados de creación en código mientras `ordenesConfig` los lee del entorno
   (`ORDENES_DEFAULT_ESTATUS_VALUE`, `ORDENES_FULFILLMENT_ESTATUS_VALUE`). Hoy coinciden y
   `.env.example` no define ninguna de las dos; un override en producción rompería la creación
   con un error de dominio **ruidoso** (fallo cerrado, coherente con Q7), no en silencio.
   Se deja anotado como deuda de acoplamiento, no se cambia: atar ambos lados es decidir si el
   grafo puede depender del entorno, y eso es materia de spec (§7 lo descartó para la tabla en
   DB por el mismo motivo).

## Prueba de que la guardia está encendida (mutación, rev. 2)

Comprobación ejecutada tras adaptar las suites: al **borrar una arista del mapa**, las suites de
call-sites se ponen ROJAS (antes seguían verdes, que es justo lo que el review señaló).

```
# quitando #12 (en_ruta -> entregada) de TRANSICIONES:
 ❯ tests/integration/repositories/orden-webhook-enqueue.test.ts (6 tests | 6 failed)
 ❯ tests/unit/repositories/gestion-orden-repository.test.ts    (26 tests | 3 failed)
 ❯ tests/unit/repositories/gestion-orden-evidencia.test.ts     (5 tests | 2 failed)
 ❯ tests/integration/repositories/optimizacion-ruta-enqueue.test.ts (11 tests | 3 failed)
      Tests  14 failed | 94 passed (108)

# quitando #16 (en_ruta -> sin_gestionar):
 ❯ tests/unit/repositories/cierre-dia-repository.test.ts (60 tests | 3 failed)
```

En ambos casos el mapa se restauró y las suites volvieron a verde.

## Verificación (salidas reales, rev. 2)

```
$ pnpm exec tsc --noEmit
TSC_OK            # sin salida = 0 errores

$ pnpm run lint            # repo completo
✖ 146 problems (0 errors, 146 warnings)     # warnings preexistentes, 0 errores, ninguno nuevo

$ pnpm test
 Test Files  511 passed (511)
      Tests  5163 passed (5163)

$ ./init.sh
✓ typecheck paso
✓ lint paso
✓ test paso
! migraciones sin down.sql: 20260723120000_job_tipo_whatsapp_template_sync 20260723120100_plantilla_template_id   # preexistente, ajeno a la 140
! no hay .env. Crea uno a partir de .env.example
== init OK ==
```

Notas de proceso:
- Rev. 1: el primer `pnpm test` salió rojo en `tests/unit/guards/censo-order-status-rename.test.ts`
  (el unit del dominio citaba dos nombres pre-137 como casos negativos). Se corrigió en el TEST,
  sin tocar el censo ni su allowlist.
- Rev. 2: al pasar a fallo cerrado se pusieron rojas 24 suites (≈130 tests) que dependían del
  bypass. Se arreglaron dándoles el catálogo que les faltaba (`tests/fixtures/catalogo-estados.ts`)
  y pares legales; **no se relajó la guardia en ningún caso**. Ninguna suite reveló un call-site
  real ejecutando una transición fuera del inventario.

## Veredicto

Guardia central ACTIVA y de FALLO CERRADO en el único choke point de escritura de estado, con el
inventario completo portado (43 + 3), R1–R17 cubiertos por 151 tests nuevos, 24 suites de
call-sites ejercitando de verdad la guardia (verificado por mutación), suite completa (5163) y
`./init.sh` en verde.
