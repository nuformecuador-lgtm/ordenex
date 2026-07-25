# Review — Feature 140 (Guardia central de transiciones de `order_status`)

> Reviewer, 2026-07-25. Commit revisado: `9fba420`. Rama `feature/140-flujo-estados-guardia-central`.
> Verificacion re-ejecutada por el reviewer, no heredada de `progress/impl_140.md`.

## VEREDICTO: RECHAZADO — 2 bloqueantes

El trabajo es solido: el inventario esta bien portado, la trazabilidad R1–R17 es real y asertiva,
y toda la verificacion sale en verde. Se rechaza por UN hallazgo de fondo (la guardia falla ABIERTA
en un camino alcanzable y esta APAGADA en casi todas las suites que ejercitan los call-sites reales,
lo que contradice la decision (2) del gate: activacion estricta / fallo cerrado) mas un
incumplimiento explicito de CHECKPOINTS (tasks sin marcar).

## Verificacion ejecutable (corrida por el reviewer)

| Comando | Resultado |
| --- | --- |
| `pnpm exec tsc --noEmit` | **0 errores** |
| `pnpm run lint` | **0 errores**, 146 warnings (preexistentes, ninguno nuevo) |
| `pnpm test` | **511 archivos / 5154 tests PASS** |
| `./init.sh` | **`== init OK ==`** (warnings preexistentes: 2 migraciones sin `down.sql` ajenas a la 140; sin `.env`) |
| Tests nuevos de la 140 (3 archivos) | **142 PASS** — coincide con lo declarado |

Alcance del diff (`git show --stat 9fba420`): 7 archivos, 1162 lineas, todas adiciones.
**Sin migraciones, sin `down.sql`, sin RLS, sin endpoints ni rutas nuevas** — confirmado: el commit
no toca `db/`, `prisma/`, `app/api/` ni ningun service/call-site. Capas respetadas: el modulo del
mapa es dominio PURO (sin Prisma, sin entorno) y la unica escritura vive en el repositorio.
Sin secretos, sin hardcode de pais/moneda.

## Trazabilidad R1–R17: COMPLETA

Los 17 requisitos mapean a tests reales y asertivos (no vacios, no "ejecutan codigo"). Muestreo
verificado linea a linea:

- **R5 (exhaustividad estatica).** La garantia NO es solo "verificada a mano": es AUTOMATICA y doble.
  `as const satisfies Record<OrderStatusValue, readonly DestinoTransicion[]>`
  (`lib/types/order-status-transiciones.ts:140`) + `_EnsureExhaustive` (`:178-181`) rompen `tsc`, que
  corre dentro de `./init.sh`. El hueco que dejaria un `value` nuevo clasificado con lista VACIA lo
  cierra el test de conectividad (quedaria sin entrada y sin salida, y el test lo nombraria). R5
  satisfecho **sin depender del recuerdo del implementer**.
- **R13 (O(1), sin round-trips).** `resuelve el catalogo UNA sola vez por proceso` y `un lote de 50
  transiciones no dispara una consulta por transicion` cuentan de verdad las llamadas a `$queryRaw`
  filtrando por `order_status`; fallarian si se moviera la consulta al bucle. Los indices
  (`DESTINOS_POR_ORIGEN`, `SET_CREACION`) se construyen al cargar el modulo: validar son dos lookups
  de `Set`/`Map`. Correcto.
- **R7 (atomicidad del lote).** `valida el lote ANTES del createMany, sea cual sea la posicion de la
  ilegal` recorre las 3 posiciones y exige `createMany` y `emitir` NO llamados. Es una asercion real.
  (Ver nota menor: el rollback efectivo de la `$transaction` no se prueba contra DB.)
- **R14/R15/R16 (conectividad).** `calcularGrados()` recorre el grafo de verdad (nodo virtual `START`
  hacia los 3 de creacion) y compara la LISTA de ofensores contra `[]` con mensaje que los enumera;
  con `TRANSICIONES` mutilado fallaria nombrando el estado. No pasa trivialmente. Cobertura exacta
  18/18 asegurada por `Object.keys(TRANSICIONES).sort() == [...ORDER_STATUS_SEED].sort()` +
  `ORDER_STATUS_SEED.length === 18`, con `ESTADOS_VESTIGIALES` VACIO asertado.
- **R12 (sin PII).** El mensaje se descompone y se compara token a token; hay assert anti-UUID y un
  caso en el choke point que exige que ni `orden-secreta`, ni `u1`, ni los ids `os-` aparezcan.

## Bloqueantes

### BLOQUEANTE 1 — La guardia falla ABIERTA (el gate pidio fallo cerrado)

Archivos / lineas:
- `lib/repositories/registrar-cambio-estado.ts:100` — `if (porId === null) return;` (salta el LOTE ENTERO)
- `lib/repositories/registrar-cambio-estado.ts:103` y `:109` — `if (destino === undefined) continue;` / `if (origen === undefined) continue;` (salta la ENTRADA)
- `lib/repositories/registrar-cambio-estado.ts:68, 72, 78` — las tres salidas `null` del resolvedor
- `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts:278` — test que CONSAGRA el fail-open

**Analisis de alcanzabilidad, camino por camino:**

1. `typeof tx.$queryRaw !== "function"` (`:68`) — **NO alcanzable en produccion.** Argumento concreto:
   (a) `ChokePointTx = OrdenHistorialTxClient & JobTxClient` exige `$queryRaw` en el tipo;
   (b) los ~18 call-sites obtienen `tx` de `this.prisma.$transaction(async (tx) => ...)`, es decir
   `Prisma.TransactionClient`, que SI expone `$queryRaw`; (c) no hay `$extends` en ningun punto de
   `lib/` ni `app/` (verificado por grep), asi que no existe cliente extendido que estreche la
   superficie; (d) el mismo guard ya gobierna `emisorWebhookEstadoReal` en produccion desde la
   feature 99: si se estuviera disparando, los webhooks llevarian meses muertos en silencio.
2. `!Array.isArray(filas)` (`:72`) — **NO alcanzable.** `$queryRaw` de Prisma resuelve siempre un
   array; un fallo transitorio de lectura LANZA, y ese throw se propaga y revierte la tx: ahi el
   comportamiento ya es **fallo cerrado**, correcto.
3. `porId.size === 0` (`:78`) — **NO alcanzable mientras haya transiciones.** Exige `order_status`
   vacio, pero todo camino de escritura resuelve antes su id con `findEstatusIdByValue` y las FKs
   apuntan al catalogo: con el catalogo vacio no hay nada que transicionar.
4. **El salto POR ENTRADA (`:103` / `:109`) SI es alcanzable, y es DELIBERADO.** El propio comentario
   del codigo (`:92`) lo dice: "deja que un estado sembrado DESPUES de arrancar el proceso (cache
   tibia) no tumbe el flujo". Concretamente: `resolverCatalogoEstadosReal` filtra con
   `esOrderStatusValue`, asi que **toda fila de `order_status` cuyo `value` no este en el
   `ORDER_STATUS_SEED` de ese build se descarta**, y cualquier transicion que la toque pasa SIN
   VALIDAR. El argumento de "la FK la rechaza" **no aplica a este caso**: el id existe en
   `order_status`, la FK es feliz. Ventana real: un despliegue que agrega values (exactamente lo que
   hizo la 139 hace una semana) mientras instancias tibias del build anterior siguen sirviendo;
   alcanzable via `OrdenService.actualizar`, cuyo selector de estado se alimenta del catalogo de la
   DB. Es estrecho, pero es silencioso y es fallo ABIERTO justo donde Q7 pidio fallo cerrado.

**Consecuencia mas grave que la ventana de despliegue: la guardia esta APAGADA en casi todos los
tests que ejercitan los call-sites reales.** Verificado de forma independiente: de los 26 archivos de
test que mockean el `tx` del choke point, los que declaran `$queryRaw: vi.fn()` (p.ej.
`tests/unit/repositories/orden-repository.cancelar-api.test.ts:28`) devuelven `undefined` ->
`!Array.isArray` -> `null` -> **guardia desactivada**; los que ni siquiera lo declaran (p.ej.
`tests/unit/repositories/cierre-dia-repository.test.ts:357`, con el comentario explicito "SIN
$queryRaw") tampoco la activan. Es decir: los ~25 archivos que modelan `cancelarViaApi`,
`deshacerGestion`, `resolverCierre`, la carga API, la recepcion central, etc. **no ejercitan la
guardia en absoluto**. El unico respaldo real de la activacion estricta es
`tests/fixtures/inventario-transiciones-140.ts`, una transcripcion a mano contrastada contra otra
transcripcion a mano (`TRANSICIONES`) — exactamente el riesgo que Q7 declaraba mitigar. El recuento
de "142 tests nuevos" no compensa: son 142 tests sobre el mapa, no sobre los call-sites.

Remate: `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts:278` ("un tx que no puede
leer el catalogo (doble parcial) no rompe el append") **convierte el fail-open en contrato
testeado**. Si manana alguien estrecha el `tx` de un call-site, la guardia muere en silencio y la
suite sigue verde.

**Que falta para cumplir R6 + la decision (2) del gate** (elegir uno; el orden es de preferencia):
- (a) `validarTransiciones` falla CERRADA: si `porId === null`, o si una entrada tiene `destino` /
  `origen` no resoluble, **lanzar** (error de dominio propio, distinto de `TransicionIlegalError` si
  se quiere separar "catalogo no disponible" de "transicion ilegal"); y adaptar los ~25 archivos
  historicos con un helper compartido de `tx` que devuelva el catalogo (`buildTx` de
  `registrar-cambio-estado.guardia.test.ts` ya ES ese helper: extraerlo a `tests/fixtures/` y
  reusarlo). Es trabajo mecanico, no de diseno.
- (b) Como minimo: fallar cerrada en `:100` y en `:103`/`:109`, **eliminar** el test que consagra el
  fail-open y sustituirlo por uno que exija el throw, y pasar el resolvedor inyectado explicito en
  las suites que hoy dependen del bypass.
- En cualquier caso, corregir la nota 4 de `progress/impl_140.md`: la afirmacion "en produccion el
  catalogo SIEMPRE resuelve y la guardia SIEMPRE valida" no es exacta para el caso 4.

### BLOQUEANTE 2 — `tasks.md` sin marcar (CHECKPOINTS, seccion Especificacion)

`specs/140-flujo-estados-guardia-central/tasks.md`: **T1.1–T4.2 siguen en `[ ]`** (11 sin marcar);
solo T0.1 esta `[x]`. CHECKPOINTS.md exige "todas las tasks estan marcadas `[x]`". Todas estan
efectivamente hechas (verificado una por una contra el codigo y los tests), asi que es un cierre
pendiente, no trabajo pendiente — pero es un incumplimiento explicito del checklist.

## Dictamen por punto evaluado

**1. Bypass del resolvedor.** -> **BLOQUEANTE.** Ver arriba: tres de los cuatro caminos son
inalcanzables en produccion con argumento concreto, pero el cuarto (salto por entrada con id no
resoluble) es alcanzable y esta declarado como intencional en el codigo; y el bypass SI se esta
usando para que pasen ~25 suites historicas, con lo que la cobertura real del choke point es
sustancialmente menor que la que sugiere el recuento de 142 tests.

**2. Fidelidad del inventario (R8).** -> **CORRECTO. Sin agujeros de legalidad.** Re-derive el
inventario leyendo el CODIGO de cada call-site, no el spec. Resultado: **los 39 pares dirigidos estan
completos, no falta ninguno y no sobra ninguno.**
- **6 aristas nuevas 138/139 confirmadas:** #37 y #41 en `lib/services/RecepcionBodegaCentralService.ts:17-27`
  (mapa state-aware `en_ruta_bodega_central -> en_bodega_central` / `devolviendo_a_bodega_central ->
  por_devolver_a_tienda`) + `OrdenRepository.recibirEnBodegaCentral`; #38/#39 en
  `lib/repositories/CierresAdminRepository.ts` (bloque `devolucionRechazadas`: ruteo por zona,
  central -> `por_devolver_a_tienda`, satelite -> `por_devolver`, `origen_tipo = devolucion_rechazada`);
  #40 en `lib/services/EnvioDevolucionCentralService.ts:12-13,71-74` (`ajuste_estado`); #42 en
  `lib/services/DevolucionOrigenService.ts:15-16,67-70` (`ajuste_estado`).
- **`deshacerGestion` confirmada:** `lib/services/CierreDiaService.ts:73-78` (`ESTADOS_ESPERADOS`)
  produce exactamente #31–#36, todas hacia `en_ruta`, incluidas `rechazada -> en_ruta` (#33) y la
  defensa legada `devuelta -> en_ruta` (#36). Las 6 estan declaradas.
- **`cancelarViaApi` confirmada:** `lib/repositories/OrdenRepository.ts:51`
  `ESTADOS_CANCELABLES_API = ["en_bodega_central","en_ruta_bodega_central"]`, destino
  `devolviendo_a_tienda` (#29/#30).
- **Creacion confirmada:** `ordenesConfig.DEFAULT_ESTATUS_VALUE = en_preparacion` y
  `FULFILLMENT_ESTATUS_VALUE = en_fulfillment` (`lib/config/ordenes.ts:41-45`),
  `lib/services/BulkOrdenService.ts:32 ESTATUS_INICIAL_API = "en_ruta_bodega_central"`. Los tres
  appends con `estatusOrigenId: null` son `create`, `createManyOrdenes` y `createManyOrdenesConGuia`.
- **`rechazada -> devolviendo_a_tienda` NO se declara.** Confirmado en
  `lib/types/order-status-transiciones.ts:104-115` (con comentario explicito) y con test de regresion
  dedicado. `DevolucionOrigenService.ESTADO_ORIGEN` es hoy `por_devolver_a_tienda`, coherente con la
  139/R9. **El camino cerrado sigue cerrado.**
- Recorri ademas los 13 `appendCambioEstado` de `OrdenRepository` + 3 de `GestionOrdenRepository` +
  2 de `CierreDiaRepository` + 2 de `CierresAdminRepository` + 2 de `DevolucionSlaRepository` +
  `LiberacionReprogramadaRepository` + `RecuperacionBodegaRepository`: **todos caen dentro del mapa.**
- Unica discrepancia hallada, de METADATO y no de legalidad -> ver notas menores.

**3. Trazabilidad R1–R17.** -> **COMPLETA.** Ningun requisito sin test; ningun test citado prueba algo
distinto de lo que dice cubrir. R5, R13 y R7 revisados en detalle arriba.

**4. Conectividad (R14/R15/R16).** -> **CORRECTO.** El test recorre el grafo de verdad y falla
nombrando al estado ofensor; no pasa trivialmente. `ESTADOS_VESTIGIALES` VACIO y cobertura exacta
18/18 contra `ORDER_STATUS_SEED` asertadas.

**5. Endurecimiento de la creacion.** -> **CONFIRMADO de forma independiente.** La Server Action
`crearOrden` (`lib/actions/ordenes.ts:35`) **no tiene ninguna referencia** en `app/`, `components/`,
`hooks/` ni `e2e/` (grep). Los tres unicos caminos de creacion en produccion nacen en
`en_preparacion` / `en_fulfillment` / `en_ruta_bodega_central`. Y confirmo lo mas importante: la
suite completa pasa **sin que se haya aflojado ni ajustado ningun test existente** — el diff de
`9fba420` es 100% adiciones y no toca ningun archivo de test previo.

**6. Proceso.** El 4.o archivo (`tests/fixtures/inventario-transiciones-140.ts`) -> **desviacion
ACEPTABLE**: es apoyo de test (no produccion), esta declarado en `impl_140.md`, y evita tener dos
copias divergentes del inventario entre T3.2 y T3.4 — que seria peor. Sin migraciones, sin
`down.sql`, sin RLS, sin endpoints: **confirmado**.

## Notas menores (no bloqueantes)

1. **R2 — metadato `via` inexacto en 2 aristas.** `lib/services/GuiaAsignacionService.ts:35`
   `ORIGEN_RUTEO_SATELITE = {en_fulfillment, en_preparacion, en_bodega_central}`:
   `rutearABodegaSatelite` emite `origen_tipo = ruteo_satelite` tambien desde `en_fulfillment` y
   `en_preparacion`, pero el mapa (y el apendice A, y la fixture) solo declaran esos dos pares con
   `via: generacion_guia` (#3/#6). **Cero impacto en legalidad** (la decision ignora `via` y ambos
   pares estan declarados), pero el recuento "41 aristas por call-site" se queda corto en 2, y el
   test "el mapa declara exactamente las aristas del inventario, ni una mas" bendice la inexactitud
   porque compara dos transcripciones a mano. Heredado del apendice A, no introducido aqui.
2. **Ramas defensivas que pasan de "origen null" a "throw".** `lib/repositories/OrdenRepository.ts`
   (`origenById.get(...) ?? null` en `generarGuiaLote` / `asignarBodegaLote` /
   `rutearBodegaSateliteLote`) y `lib/repositories/GestionOrdenRepository.ts:335`
   (`actual?.estatusId ?? null`): si la pre-lectura del origen fallara, antes se registraba una fila
   con origen `null` y ahora la guardia lo interpreta como CREACION y aborta la tx del call-site. Es
   **fallo cerrado** (correcto), pero es un cambio de comportamiento sin test que lo cubra.
3. **`ESTADOS_CREACION` hardcodeado vs. configuracion por entorno.** `lib/config/ordenes.ts:41-45`
   lee `ORDENES_DEFAULT_ESTATUS_VALUE` / `ORDENES_FULFILLMENT_ESTATUS_VALUE` del entorno; el mapa los
   fija en codigo. Hoy coinciden (y `.env.example` no los define), pero un override en produccion
   romperia toda creacion con un error de dominio. Nada ata ambos lados.
4. **R16 parcialmente tautologico.** `faltantes` / `sobrantes` no pueden ser no vacios dado el
   `satisfies`; la asercion que realmente muerde es
   `Object.keys(TRANSICIONES).sort() == [...ORDER_STATUS_SEED].sort()` + `length === 18`. Suficiente,
   pero el primer bloque no aporta garantia adicional.
5. **R7 sin prueba de rollback real.** La atomicidad se prueba a nivel unit (throw + `createMany` /
   `emitir` no llamados). El rollback efectivo de la `$transaction` se asume por Prisma. Coherente
   con el precedente del repo; no hay E2E (mismo criterio aceptado en 138/139).
6. **Coste de arranque en frio.** La primera escritura de estado de cada proceso (cada lambda nueva
   en Vercel) agrega un `SELECT id, value FROM order_status` DENTRO de la tx money-critical del
   call-site. Aceptado por design §4; conviene dejarlo escrito.
7. **Drift documental.** `feature_list.json` (140) sigue describiendo el terminal como `en_tienda`
   (nombre pre-137). El canonico es el spec.

## Que se necesita para OK

1. Cerrar el fallo abierto de la guardia (BLOQUEANTE 1) por la via (a) o (b), incluida la
   sustitucion del test que hoy consagra el bypass y la correccion de la nota 4 de `impl_140.md`.
2. Marcar `[x]` las tasks T1.1–T4.2 en `specs/140-flujo-estados-guardia-central/tasks.md`.
3. Re-correr `./init.sh` + suite completa tras el cambio: el fix toca el choke point de TODA
   escritura de estado, asi que una regresion aparecera lejos del diff.

---

# RE-REVIEW — commit `06b9858` sobre `9fba420` (2026-07-25)

> El bloque de arriba se conserva COMO HISTORIAL del rechazo. Lo que sigue es la re-revision
> de las correcciones. Verificacion re-ejecutada por el reviewer, no heredada del reporte.

## VEREDICTO FINAL: OK (APROBADO) — 0 bloqueantes

Los dos bloqueantes estan cerrados de verdad, no de forma cosmetica. La guardia pasa a fallo
CERRADO sin ninguna ruta de escape y —lo importante— la cura NO reintrodujo la enfermedad: las
24 suites de call-sites ejercitan la guardia de verdad, cosa que verifique por MUTACION sobre
aristas DISTINTAS de las que eligio el implementer.

## Verificacion ejecutable (corrida por el reviewer)

| Comando | Resultado |
| --- | --- |
| `pnpm exec tsc --noEmit` | **0 errores** |
| `pnpm run lint` | **0 errores**, 146 warnings (preexistentes) |
| `pnpm test` | **511 archivos / 5163 tests PASS** |
| `./init.sh` | **`== init OK ==`** (mismos 2 warnings preexistentes ajenos a la 140) |
| Tests de la 140 (3 archivos) | **151 PASS** — coincide con lo declarado |

Alcance: 32 archivos. **Produccion tocada = 2 archivos** (`registrar-cambio-estado.ts`,
`order-status-transiciones.ts`); el resto son tests, fixtures y documentos. **Sigue sin haber
migraciones, `down.sql`, RLS, endpoints ni cambios en ningun service o call-site de produccion.**

## BLOQUEANTE 1 — CERRADO. El fallo cerrado es COMPLETO

Recorri todas las rutas de entrada al `createMany` y no queda ninguna que escriba sin validar:

- `CatalogoEstadosResolver` ya no admite `null` en el TIPO
  (`lib/repositories/registrar-cambio-estado.ts:36-38`).
- Las tres salidas silenciosas del resolvedor ahora LANZAN: `$queryRaw` ausente (`:70-72`),
  respuesta no-array (`:76`) y catalogo vacio (`:85`) => `TransicionNoValidableError`.
- El salto POR ENTRADA —el agujero realmente alcanzable del review anterior— desaparecio:
  `valueDe()` (`:91-99`) LANZA `estatus_desconocido` en vez de `continue`. Es exactamente el
  caso de drift DB->build que reporte, y ahora tiene test propio.
- `validarTransiciones` (`:114-128`) no tiene early-return, ni `catch`, ni `?.`, ni default: por
  cada entrada resuelve destino, resuelve origen (o `null` explicito para la creacion) y llama
  `assertTransicionValida`. El unico camino que no valida es `entradas.length === 0` (`:171`),
  que tampoco escribe historial: correcto.
- El unico `continue` que queda (`:79`) descarta una FILA malformada al construir el mapa; su id
  no quedara resoluble, asi que la entrada que lo use muere en `valueDe`. Sigue siendo cerrado.
- **Ningun call-site traga el error.** Revise los tres `catch` que envuelven una `$transaction`
  con append: `OrdenRepository.ts:553` (`mapCreateError` solo traduce `P2002`; `:2031` devuelve
  el error tal cual), `CierreDiaRepository.ts:475` (solo `SinGestionesVinculadas`) y `:621`
  (solo `NoAnulable`). Los demas re-lanzan.
- **`appendCambioEstado` sigue siendo el UNICO escritor** de `ordenHistorialEstado.createMany`
  en produccion (grep sobre `lib/` y `app/`: el resto son lecturas o declaraciones de tipo).

El test que consagraba el fail-open ya no existe; en su lugar hay 5 que exigen el rechazo
(`tests/unit/repositories/registrar-cambio-estado.guardia.test.ts:297-380`), incluidos el drift
DB->build y el fallo transitorio de lectura (que debe propagarse, no degradar).

## La cura no reintrodujo la enfermedad — verificado

**La fixture NO es permisiva.** `tests/fixtures/catalogo-estados.ts:29-31` deriva las filas de
`ORDER_STATUS_SEED` (los 18 `value` reales) con ids deterministas `os-<value>`; no hay
"devuelve algo plausible para cualquier id". Un id que no sea `os-<value del SEED>` no resuelve
y la guardia lanza. `sembrarCatalogoEstados` (`:46-49`) usa SOLO la API publica
(`resetCatalogoEstadosCache` + `resolverCatalogoEstadosReal`) y calienta la cache con el
catalogo COMPLETO, asi que la guardia corre entera: resuelve ambos ids y valida el par.

**Los pares de cada suite son los que el call-site ejecuta de verdad.** Revise los diffs de las
24 suites: es una sustitucion 1:1 de ids sinteticos por `idEstado(<value real>)` conservando la
semantica de cada caso — `sin_gestionar -> en_bodega_central|en_bodega_satelite` (#17/#18),
`devuelta -> en_bodega_satelite` / `-> rechazada` (#20/#21), `rechazada -> por_devolver` /
`-> por_devolver_a_tienda` (#38/#39), `por_recoger -> en_ruta` (#11),
`en_bodega_central|en_ruta_bodega_central -> devolviendo_a_tienda` (#29/#30) y la creacion
`carga_api` en `en_ruta_bodega_central`. **No queda ningun `os-...` sintetico llegando al choke
point**: los literales `"os-..."` que sobreviven estan en tests de SERVICE (que mockean el repo
y no pasan por `appendCambioEstado`), en lecturas (`existsEstatus("os-x")`, `api-lectura`) y en
el caso de drift deliberado (`"os-estado-del-futuro"`).

**Sin puertas nuevas en produccion.** `06b9858` no anade ningun hook, setter ni parametro
test-only en `lib/`. El unico export test-only sigue siendo `resetCatalogoEstadosCache` (ya
existia en `9fba420`) y solo BORRA la cache: no permite inyectar un catalogo, asi que su peor
efecto en produccion seria forzar una relectura del catalogo REAL. No debilita la guardia.

**Sin fuga de estado compartido entre suites.** `vitest.config.ts` no fija `pool` ni
`isolate: false`, asi que rige el default (`forks`, `isolate: true`): registro de modulos —y por
tanto `catalogoCache`— independiente por archivo de test. Ademas cada suite re-siembra en
`beforeEach`, que resetea antes de calentar.

## PRUEBA POR MUTACION (la hice yo, sobre aristas DISTINTAS)

El implementer muto #12 y #16. Yo mute otras dos y restaure el archivo despues:

| Mutacion | Suites de CALL-SITE afectadas | Resultado |
| --- | --- | --- |
| Borrar **#11** `por_recoger -> en_ruta` (`recoleccion`) | `gestion-orden-repository`, `optimizacion-ruta-enqueue` | **8 tests ROJOS**; `TransicionIlegalError: transicion ilegal: por_recoger -> en_ruta` lanzado desde `lib/repositories/GestionOrdenRepository.ts:235` |
| Borrar **#29** `en_bodega_central -> devolviendo_a_tienda` (`cancelacion_api`) | `orden-repository.cancelar-api` | **3 tests ROJOS**; `TransicionIlegalError` desde `lib/repositories/OrdenRepository.ts:1240` |

La traza pasa por `assertTransicionValida -> validarTransiciones -> appendCambioEstado -> <el
call-site real>`: la guardia esta ENCENDIDA en los call-sites, no solo en los tests del mapa.
Archivo restaurado; `git status` no reporta `lib/types/order-status-transiciones.ts`.

## Los 3 ajustes "no fontaneria" — dictamen

1. **Creacion en `en_preparacion`** (`orden-repository.test.ts`): correcto y OBLIGADO. El test
   creaba en `en_bodega_central`, que Q5/A.3-#8 declara ilegal a proposito. Se ajusto el test,
   que es justo lo que `tasks.md` T4.2 exigia ("ajustar el test, no aflojar la guardia").
2. **Ajuste administrativo con la arista #28**: correcto. El caso anterior
   (`en_bodega_central -> entregada`) no es arista real de ningun flujo; con Q3 (sin override)
   tenia que pasar a ilegal. El PROPOSITO del test (que `update` registra historial con
   `ajuste_estado`) se conserva integro.
3. **Pre-lectura de `generarGuiaLote`**: **modela la realidad, no le ensena al mock lo que la
   guardia quiere oir.** El repo pre-lee `tx.orden.findMany({ where: { id: { in: ordenIds } } })`;
   el doble devolvia `[]`, que en produccion NO ocurre (los ids consultados existen). Ahora
   devuelve una fila por id consultado con `en_preparacion`, origen legitimo de `generarGuia`
   (`ORIGEN_GENERAR_GUIA = {en_fulfillment, en_preparacion}`, `GuiaAsignacionService.ts:31`).
   Los tests que asertan el historial siguen fijando su propio origen explicito, asi que no se
   perdio ninguna asercion.

## BLOQUEANTE 2 — CERRADO

`specs/140-flujo-estados-guardia-central/tasks.md`: **12 `[x]`, 0 `[ ]`**.

## Trazabilidad R1–R17: COMPLETA (reconfirmada)

Tabla de `progress/impl_140.md` revisada contra los tests reales. R6 y R12 cubren ahora tambien
`TransicionNoValidableError` (incluido un test de que su mensaje no filtra ids ni PII). El
inventario data-driven paso de 41 a **43 aristas** (con #7b/#7c, la nota menor del review
anterior) manteniendo **39 pares dirigidos unicos**; `RECUENTO_INVENTARIO` lo fija y hay test
que lo asegura.

## Notas menores (no bloqueantes; ninguna impide el merge)

1. **El apendice A del spec quedo desactualizado.** `specs/140-.../design.md` sigue diciendo
   **41 aristas** y no lista #7b/#7c, mientras el mapa, la fixture e `impl_140.md` dicen 43. El
   spec es el contrato: conviene retro-portar #7b/#7c al apendice A (tarea de spec_author /
   leader; el implementer no edita specs).
2. **`progress/impl_140.md`, fila R8:** el encabezado dice 43 aristas pero el detalle repite
   "(41 casos)" tres veces. El test ejecuta 43. Texto obsoleto.
3. **`tests/integration/repositories/orden-webhook-enqueue.test.ts:32`:**
   `ORIGEN_LEGAL[idEstado("en_ruta_bodega_central")] = "en_ruta_bodega_central"` es una entrada
   MUERTA (ese destino solo se usa con `carga_api`, cuyo origen es `null`). Inofensiva, pero se
   lee como un auto-lazo y confunde.
4. **`resetCatalogoEstadosCache` sigue exportado desde `lib/` solo para tests.** No es una
   puerta (solo borra la cache), pero es superficie de produccion que existe por los tests.
5. **Ramas defensivas `?? null`** (`OrdenRepository` en `generarGuiaLote` / `asignarBodegaLote` /
   `rutearBodegaSateliteLote`, `GestionOrdenRepository.ts:335`): si la pre-lectura fallara, la
   guardia lo trata como creacion y aborta la tx. Es fallo cerrado (correcto), pero sigue sin
   test propio.
6. **`ESTADOS_CREACION` hardcodeado vs. `ordenesConfig` por entorno**
   (`lib/config/ordenes.ts:41-45`): sin cambios respecto al review anterior; hoy coinciden y
   `.env.example` no los define.
7. **R7 sigue probado solo a nivel unit** (throw + `createMany`/`emitir` no llamados); el
   rollback real de la `$transaction` se asume por Prisma. Sin E2E, mismo criterio de 138/139.
8. **Proceso:** el worktree tiene sin commitear la reconciliacion de
   `specs/140-.../{requirements,design}.md`, `feature_list.json`, `progress/current.md` y
   `progress/history.md`. Conviene commitearlos junto al cierre de la feature.

## CHECKPOINTS — estado final

Especificacion (3/3) · Trazabilidad (2/2) · Calidad de codigo (typecheck, lint, test: 3/3; E2E
no aplica, mismo criterio 138/139) · Datos y seguridad (sin tablas, sin migraciones, sin
secretos, sin webhooks nuevos) · Capas (dominio puro / repositorio; sin services tocados) ·
Multi-pais (sin hardcode) · `./init.sh` verde. **Apto para `done` / merge.**
