# Implementación 140 — Guardia central de transiciones de `order_status`

> Rama: `feature/140-flujo-estados-guardia-central` (desde `origin/dev`, con 137/138/139 ya
> mergeadas). Zona: backend. Spec CERRADO (Q1–Q7 resueltas en el gate F1.4 del 2026-07-25).
> Sin migraciones, sin `down.sql`, sin RLS, sin endpoints nuevos (§2/§6 de `design.md`).

## Archivos

**Nuevos (producción)**
- `lib/types/order-status-transiciones.ts` — `TRANSICIONES` (41 aristas de flujo),
  `ESTADOS_CREACION` (3), `ESTADOS_TERMINALES` (2), `ESTADOS_VESTIGIALES` (VACÍO, Q2),
  `TransicionIlegalError`, `assertTransicionValida`, `esOrderStatusValue`.
  Dominio PURO: sin Prisma, sin efectos secundarios, sin lectura de entorno.
  Exhaustividad estática por partida doble: `as const satisfies Record<OrderStatusValue, …>`
  + `_EnsureExhaustive` (patrón `orden-historial.ts`).

**Modificados (producción)**
- `lib/repositories/registrar-cambio-estado.ts` — `appendCambioEstado` valida CADA entrada del
  lote antes del `createMany`; parámetro nuevo `catalogo: CatalogoEstadosResolver` opcional con
  default real (`resolverCatalogoEstadosReal`), mismo patrón que `emitir: WebhookEmisor` ⇒ los
  ~18 call-sites NO cambian. Resolución `id -> value` con UNA consulta cacheada por proceso.
  `resetCatalogoEstadosCache()` exportado solo para tests.

**Tests nuevos**
- `tests/unit/domain/order-status-transiciones.connectividad.test.ts` (T3.1).
- `tests/unit/domain/order-status-transiciones.guardia.test.ts` (T3.2).
- `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` (T3.3 + T3.4).
- `tests/fixtures/inventario-transiciones-140.ts` — **fixture compartida, no es un test**:
  transcripción A MANO del apéndice A (41 aristas de flujo + 3 de creación + recuentos).
  Se consume desde T3.2 y T3.4 para no tener dos copias divergentes del inventario. Es la
  única desviación respecto de "Archivos esperados" de `tasks.md` (un archivo de apoyo más).

**Sin tocar:** ningún service, ningún call-site, ningún componente, ninguna migración.

## Trazabilidad R1..R17 → test

| R | Qué exige | Test (archivo → nombre) |
| --- | --- | --- |
| R1 | módulo único `TRANSICIONES` como fuente de verdad | `tests/unit/domain/order-status-transiciones.guardia.test.ts` → *el mapa declara exactamente las aristas del inventario, ni una mas* |
| R2 | metadato de familia/rol por arista, sin alterar la legalidad | `…guardia.test.ts` → *el mapa declara exactamente las aristas del inventario, ni una mas* (compara `origen->destino (via)` con el inventario) + `…connectividad.test.ts` → *cada estado de creacion es alcanzable desde START y tiene salida de flujo* |
| R3 | conjuntos explícitos de creación y terminales | `…connectividad.test.ts` → *cada estado de creacion es alcanzable desde START y tiene salida de flujo*; *los estados terminales tienen entrada y estan exentos de necesitar salida* |
| R4 | validar por `value`, no por `id` | `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` → *acepta un resolvedor inyectado y valida con el, sin tocar el tx*; `…guardia.test.ts` (dominio) → *esOrderStatusValue reconoce los value del SEED y descarta lo demas* |
| R5 | exhaustividad frente a `ORDER_STATUS_SEED` (build o test) | build: `satisfies Record<OrderStatusValue,…>` + `_EnsureExhaustive` (verificado a mano: añadir un value ficticio al SEED rompe `tsc` en `order-status-transiciones.ts:140` y `:181`); test: `…connectividad.test.ts` → *el mapa declara una entrada por cada value del catalogo (exhaustividad, R5)* |
| R6 | transición fuera del mapa ⇒ rechazo, sin historial ni webhook | `tests/unit/domain/order-status-transiciones.guardia.test.ts` → *lanza TransicionIlegalError en %s -> %s* (6 casos), *rechaza el auto-lazo de cualquier estado (X -> X nunca esta declarado)*, *REGRESION 139/R9: rechazada -> devolviendo_a_tienda es ILEGAL (arista #27 retirada)*; `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` → *lanza TransicionIlegalError y NO escribe historial ni encola webhook* |
| R7 | lote con ≥1 ilegal ⇒ rechazo atómico | `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` → *lanza TransicionIlegalError y NO escribe historial ni encola webhook*; *valida el lote ANTES del createMany, sea cual sea la posicion de la ilegal* |
| R8 | ninguna transición legítima existente empieza a fallar | **data-driven sobre el inventario COMPLETO**: `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` → *#%i deja pasar %s -> %s (origen_tipo %s) y registra el historial* (41 casos) + *creacion null -> %s (origen_tipo %s) pasa la guardia* (3 casos) + *el test recorre el inventario COMPLETO (41 aristas de flujo + 3 de creacion)*; dominio: `…guardia.test.ts` → *#%i acepta %s -> %s* (41 casos) |
| R9 | el ajuste administrativo pasa por la MISMA guardia (sin override) | `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` → *R9/Q3: el ajuste administrativo generico NO tiene override ANY -> ANY*; dominio: `…guardia.test.ts` → *R9/Q3: no existe override ANY -> ANY; el ajuste administrativo pasa por el mismo mapa* |
| R10 | creación (`null -> X`) validada contra `ESTADOS_CREACION` | `…guardia.test.ts` (dominio) → *acepta nacer en %s (via %s)* (3), *acepta EXACTAMENTE los tres estados de creacion del catalogo*, *rechaza nacer en %s (fuera de ESTADOS_CREACION)* (15); choke point: *R10: nacer (origen null) fuera de ESTADOS_CREACION se rechaza en el choke point* |
| R11 | transición legal ⇒ comportamiento idéntico (append + webhook) | `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` → *hace el mismo append del historial y el mismo encolado del webhook*; *un lote vacio sigue siendo no-op: ni consulta el catalogo ni escribe* (+ la suite histórica del choke point, 511 archivos verdes) |
| R12 | error tipado, `instanceof`, sin PII | `…guardia.test.ts` (dominio) → *es asertable por instanceof y conserva origen/destino*; *el mensaje menciona SOLO los dos value del catalogo*; *el mensaje de la creacion ilegal no expone ids ni el actor*; choke point: *el error identifica el par ofensor sin filtrar el id de la orden ni el actor* |
| R13 | O(1) por transición, sin round-trips de DB extra | `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` → *resuelve el catalogo UNA sola vez por proceso, aunque se llame muchas veces*; *un lote de 50 transiciones no dispara una consulta por transicion*; *la cache se comparte entre llamadas con distintos tx*; dominio: *valida sin efectos secundarios: mil llamadas no mutan el mapa* |
| R14 | invariante de conectividad (entrada/salida, START virtual, terminales exentos) | `tests/unit/domain/order-status-transiciones.connectividad.test.ts` → *todo estado NO terminal tiene al menos UNA salida*; *todo estado tiene al menos UNA entrada (los de creacion, desde START)*; *los estados terminales tienen entrada y estan exentos de necesitar salida* |
| R15 | el test FALLA nombrando los `value` ofensores | mismos tres tests de R14: el assert compara la LISTA de ofensores contra `[]` y el mensaje la enumera (`callejon sin salida: …` / `cuello de botella inalcanzable: …`) |
| R16 | cobertura EXACTA de los 18 `value`, sin exenciones | `…connectividad.test.ts` → *los value que aparecen en el mapa, terminales y creacion cubren los 18 del SEED*; *el conjunto de estados vestigiales declarados esta VACIO (Q2)* |
| R17 | cada `R<n>` mapeado a un test | este documento |

Recuento de tests nuevos: **142** en 3 archivos.
Conectividad 7 · guardia de dominio 76 · choke point 59.

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
2. **41 aristas de flujo, 39 pares únicos.** #19/#23 (`devuelta -> en_bodega_central`) y
   #20/#24 (`devuelta -> en_bodega_satelite`) comparten par y difieren sólo en familia: el mapa
   declara las cuatro (metadato R2), la legalidad las colapsa.
3. **Resolución `id -> value` (design §4).** Una consulta `SELECT id, value FROM order_status`
   dentro del `tx` en curso, cacheada por proceso (el catálogo es inmutable tras el seed) ⇒
   cero round-trips en el camino caliente aunque el lote traiga 50 transiciones.
4. **Guard defensivo del resolvedor (documentado, NO es un interruptor).** Si el `tx` no expone
   `$queryRaw` o el catálogo no es legible, el resolvedor devuelve `null` y no hay nada que
   clasificar. Es el mismo precedente ya vigente en `emisorWebhookEstadoReal` (feature 99) y
   existe por los ~25 archivos de test históricos de los call-sites, que mockean el `tx` con
   `ordenHistorialEstado` a secas e ids sintéticos (`os-x`) que no pertenecen a ningún catálogo.
   En producción el `tx` es el cliente de `$transaction` de Prisma y `order_status` está
   sembrado: el catálogo SIEMPRE resuelve y la guardia SIEMPRE valida. No hay env var, config ni
   parámetro que fuerce esa rama. Los tests nuevos SÍ ejercitan la guardia con el catálogo
   completo, así que la ruta real está cubierta.
   Una entrada con un `id` fuera del catálogo resuelto se salta: no es clasificable, y la FK
   `orden_historial_estado.estatus_destino_id -> order_status.id` la rechaza en la misma tx.
5. **Endurecimiento de `OrdenService.crear` (A.3-#8).** Con R10 activo, crear en un estado fuera
   de los tres de creación pasa a lanzar. **Verificado que ningún flujo de producción lo hace:**
   la Server Action `crearOrden` no está referenciada por ninguna página/componente
   (`app/`, `components/`, `hooks/`), y los tres caminos reales de creación son
   `OrdenService.crear` sin `estatusId` (default `en_preparacion`), `BulkOrdenService` (carga
   masiva: `en_preparacion`/`en_fulfillment`) y `BulkOrdenService.cargarViaApi`
   (`en_ruta_bodega_central`). **Ningún test existente hubo que ajustar ni aflojar.**
6. **Cero `any`.** El único cast es el `typeof (tx as { $queryRaw?: unknown }).$queryRaw`
   del guard defensivo (mismo idiom que el emisor de webhooks).

## Verificación (salidas reales)

```
$ pnpm exec tsc --noEmit
TSC OK            # sin salida = 0 errores

$ pnpm exec eslint lib/types/order-status-transiciones.ts \
    lib/repositories/registrar-cambio-estado.ts tests/unit/domain \
    tests/unit/repositories/registrar-cambio-estado.guardia.test.ts tests/fixtures
LINT OK (0 problemas en archivos de la 140)

$ pnpm run lint            # repo completo
✖ 146 problems (0 errors, 146 warnings)     # warnings preexistentes, 0 errores, ninguno nuevo

$ pnpm test
 Test Files  511 passed (511)
      Tests  5154 passed (5154)
   Duration  135.60s

$ ./init.sh
✓ typecheck paso
✓ lint paso
✓ test paso
! migraciones sin down.sql: 20260723120000_job_tipo_whatsapp_template_sync 20260723120100_plantilla_template_id   # preexistente, ajeno a la 140
! no hay .env. Crea uno a partir de .env.example
== init OK ==
```

Nota: el primer `pnpm test` tras escribir los tests salió ROJO en
`tests/unit/guards/censo-order-status-rename.test.ts` (censo de la 137): el unit del dominio
citaba dos nombres pre-137 (`en_bodega`, `recibido_origen`) como casos negativos de
`esOrderStatusValue`. Se corrigió en el TEST (se construyen por concatenación), sin tocar el
censo ni su allowlist.

## Veredicto

Guardia central ACTIVA en el único choke point de escritura de estado, con el inventario
completo portado (41 + 3), R1–R17 cubiertos por 142 tests nuevos, suite completa y `./init.sh`
en verde.
