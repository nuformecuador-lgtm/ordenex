# Feature 140 — Guardia central de transiciones de `order_status` — requirements.md

> Zona: backend · Complexity: high · Rama: `feature/140-flujo-estados-guardia-central`
> Depende de: **137** (renombres de nomenclatura), **138** (recepción en bodega central),
> **139** (devolución de rechazadas). Las tres YA aterrizaron y están mergeadas en `dev`.
> Notación EARS estricta. Cada `R<n>` es testeable.

> **Nota de reconciliación (2026-07-25).** Este spec se redactó como "feature 138" bajo la
> numeración vieja (135/136/137 = hoy **137/138/139**) y ANTES de que sus dependencias
> aterrizaran. Esta versión corrige los IDs, cierra las seis preguntas abiertas (más una
> decisión nueva del gate) y RE-VERIFICA el inventario del apéndice A de `design.md` contra
> el código de `dev`. Donde el spec viejo y el código discrepaban, **manda el código**.

## Contexto y glosario

Hoy **no existe** una máquina de estados central. Cada service declara sus propios
orígenes/destinos y la guardia real de legalidad es el `WHERE estatus_id = <origen>` de
cada `UPDATE`. El único choke point de escritura de `orden.estatus_id` es
`appendCambioEstado` (`lib/repositories/registrar-cambio-estado.ts`, feature 49), que
registra historial + encola el webhook (feature 99) pero **NO valida** que la transición
`origen -> destino` sea legal. Esta feature centraliza ese mapa y lo usa para validar.

- **Transición:** par dirigido `(origen, destino)` de valores de `order_status`, con
  `origen = null` para la creación (null -> X).
- **Disparador / familia:** el `origen_tipo` (enum `orden_historial_origen_tipo`,
  `lib/types/orden-historial.ts`, **22 valores** tras 138/139) y el rol/actor que ejecuta
  la transición.
- **Estado terminal:** estado sin salida esperada en el flujo normal. Por decisión del
  gate: `entregada` y `devuelta_a_tienda` (Q1 RESUELTA; 137 renombró
  `recibido_origen -> devuelta_a_tienda`).
- **Estado de creación / entrada:** estado en el que una orden puede NACER (null -> X).
  Conjunto CERRADO de tres (Q5 RESUELTA, verificado en código): `en_preparacion`
  (default global, `ordenesConfig.DEFAULT_ESTATUS_VALUE`), `en_fulfillment` (tienda con
  flag fulfillment) y `en_ruta_bodega_central` (estado inicial FIJO de la carga por API
  key, `ESTATUS_INICIAL_API` en `lib/services/BulkOrdenService.ts`).
- **Choke point:** `appendCambioEstado`, invocado por ~18 call-sites dentro de su misma
  transacción Prisma.
- **Catálogo:** `ORDER_STATUS_SEED` (`lib/types/order-status.ts`) tiene hoy **18 values**
  (la 139 sumó TRES: `por_devolver`, `devolviendo_a_bodega_central`,
  `por_devolver_a_tienda`).

El apéndice de `design.md` contiene el **inventario cerrado** de todas las transiciones
existentes (fuente de verdad leída del código de `dev`, no supuesta).

---

## Requisitos

### Módulo único del mapa

**R1** — El sistema DEBE exponer un módulo único (`TRANSICIONES`) que sea la fuente
única de verdad de las transiciones válidas de `order_status`, como mapa
`origen -> destino[]` sobre valores del catálogo (`OrderStatusValue`), reemplazando la
declaración dispersa por service.

**R2** — DONDE una transición tenga un disparador conocido, el módulo DEBE asociar a cada
arista su metadato de familia (`origen_tipo`) y el rol/actor que la ejecuta, sin que ese
metadato altere la decisión de legalidad (la legalidad depende sólo de `origen -> destino`).

**R3** — El módulo DEBE declarar de forma explícita el conjunto de **estados de creación**
(destinos válidos de una transición `null -> X`) y el conjunto de **estados terminales**.

**R4** — El sistema DEBE validar usando los `value` del catálogo (no los `id` internos):
el mapa se indexa por `value` y el choke point resuelve la correspondencia `id <-> value`
sin depender de que cada call-site conozca la estructura interna del mapa.

**R5** — El módulo DEBE ser cerrado y exhaustivo respecto de `ORDER_STATUS_SEED`
(`lib/types/order-status.ts`): todo `value` referenciado en el mapa DEBE existir en el
catálogo, y una verificación (build o test) DEBE romperse SI se agrega un valor al
catálogo que no quede clasificado como entrada, salida, terminal, o vestigial declarado.
El conjunto de vestigiales declarados está **VACÍO** hoy (Q2 RESUELTA).

### Validación en el choke point

**R6** — CUANDO `appendCambioEstado` recibe una transición cuyo par `(origen, destino)`
NO está en `TRANSICIONES`, el sistema DEBE rechazarla con un error de dominio claro y NO
DEBE escribir el historial ni encolar el webhook de esa transición. La guardia DEBE estar
ACTIVA desde el primer despliegue: NO existe modo shadow, modo solo-registro ni feature
flag que la desactive (Q7 RESUELTA — activación estricta).

**R7** — CUANDO un lote (`createMany`) contiene al menos una transición ilegal, el sistema
DEBE rechazar el lote completo de forma atómica, sin efectos parciales (respeta el
contrato todo-o-nada vigente: al fallar dentro de la `$transaction`, revierte todo).

**R8** — El sistema DEBE aceptar sin cambios TODAS las transiciones que los call-sites
actuales ejecutan legítimamente: cada transición del inventario (apéndice de `design.md`)
DEBE estar presente en `TRANSICIONES`. Ningún call-site legal existente puede empezar a
fallar por introducir la guardia.

**R9** — SI la transición proviene del ajuste administrativo genérico
(`OrdenService.actualizar`, `origen_tipo = ajuste_estado`), ENTONCES el sistema DEBE
someterla a la MISMA guardia que a cualquier otro call-site: **NO se declara ningún
override `ANY -> ANY`**, ni siquiera para maestro/admin (Q3 RESUELTA). Las aristas de
ajuste administrativo legítimas DEBEN estar declaradas explícitamente en `TRANSICIONES`.
Consecuencia ACEPTADA y explícita: rescatar a mano una orden atascada en un estado exigirá
**declarar la arista en el módulo y desplegar**; no es un toggle en caliente ni un permiso
de rol.

**R10** — CUANDO `appendCambioEstado` recibe una transición de creación (`origen = null`),
el sistema DEBE aceptarla SI el destino pertenece a `ESTADOS_CREACION`
(`en_preparacion`, `en_fulfillment`, `en_ruta_bodega_central`) y DEBE rechazarla en
cualquier otro caso (Q5 RESUELTA: la creación SÍ se valida).

**R11** — CUANDO una transición es legal, el comportamiento del sistema DEBE ser idéntico
al actual: mismo append de historial y mismo encolado transaccional del webhook (feature
99), sin regresión.

**R12** — El error de dominio de transición ilegal DEBE ser un tipo distinguible
(asertable por `instanceof` desde tests y call-sites) y NO DEBE filtrar PII ni secretos en
su mensaje: sólo los dos `value` implicados (Q6 RESUELTA).

**R13** — MIENTRAS valida, el sistema DEBE hacerlo con una comprobación O(1) por transición
en el camino caliente, sin round-trips de base de datos adicionales (el catálogo es
inmutable y se resuelve una vez por proceso).

### Invariante de conectividad (test del grafo)

**R14** — El sistema DEBE proveer un test que recorra el grafo de `TRANSICIONES` y verifique
que **todo estado NO terminal** tenga al menos UNA entrada y al menos UNA salida, donde:
- los estados terminales (`entregada`, `devuelta_a_tienda`) están exentos de necesitar salida (Q1 resuelta);
- los estados de creación (R3) se consideran con entrada desde un nodo virtual `START`.

**R15** — El test de R14 DEBE FALLAR SI aparece un **callejón sin salida** (estado no
terminal sin salida) o un **cuello de botella inalcanzable** (estado no-creación sin
entrada), señalando el/los estado(s) ofensores por su `value`.

**R16** — El test DEBE verificar que el conjunto de `value` que aparecen en `TRANSICIONES`
(como origen o destino) más los terminales y los de creación cubre **exactamente** los 18
`value` de `ORDER_STATUS_SEED`. No hay exención: el conjunto de estados vestigiales
declarados está VACÍO (Q2 RESUELTA).

### Trazabilidad

**R17** — Cada `R<n>` de este documento DEBE quedar mapeado a un test concreto en
`progress/impl_140.md` durante la implementación; un requisito sin test es un fallo de la
feature (docs/specs.md, trazabilidad).

---

## Preguntas abiertas — TODAS CERRADAS (gate F1.4, 2026-07-25)

> Ninguna queda abierta. Se conservan como registro de la decisión: el implementer no debe
> reabrirlas ni reinterpretarlas.

**Q1 — [RESUELTA por el gate] terminal del flujo de devolución.** Los estados terminales
son `entregada` y `devuelta_a_tienda`. El renombre de la **137** hizo
`recibido_origen -> devuelta_a_tienda`; el mapa se escribe con la nomenclatura post-137,
que es la que ya vive en `dev`.

**Q2 — [RESUELTA CONTRA CÓDIGO] `en_ruta_bodega_central` ya NO es vestigial.** Cuando se
escribió el borrador, ese estado no tenía entrada de flujo y se temía un cuello de botella
que obligara a una allowlist. Hoy tiene ambas puntas:
- **ENTRADA por creación:** es el estado inicial FIJO de la carga por API key
  (`ESTATUS_INICIAL_API` en `lib/services/BulkOrdenService.ts`), es decir, llega desde el
  nodo virtual `START` como miembro de `ESTADOS_CREACION`.
- **SALIDA de flujo (feature 138):** `en_ruta_bodega_central -> en_bodega_central`
  (`RecepcionBodegaCentralService` + `OrdenRepository.recibirEnBodegaCentral`,
  `origen_tipo = recepcion_bodega_central`), además de la salida preexistente
  `-> devolviendo_a_tienda` (`cancelacion_api`).

Por tanto **NO necesita allowlist**. El mecanismo de allowlist vestigial se conserva
documentado (§8 de `design.md`) como conjunto **VACÍO**, para que un estado futuro sin
flujo tenga dónde declararse — pero hoy ningún `value` del catálogo queda exento (R16).

**Q3 — [RESUELTA por el humano] política del escape hatch: "todo pasa por la guardia".**
NO se declara ningún override `ANY -> ANY`, ni siquiera para maestro/admin.
`OrdenService.actualizar` (`origen_tipo = ajuste_estado`) queda sujeto a `TRANSICIONES`
como cualquier otro call-site, y las aristas de ajuste administrativo legítimas se
declaran explícitamente (hoy: #28, #40 y #42 del apéndice A). **Consecuencia asumida:**
rescatar a mano una orden atascada en un estado exigirá declarar la arista y desplegar
(PR + CI), no es un toggle en caliente. Se acepta a cambio de que R14/R15 sigan siendo
significativos: con un override amplio, la garantía de conectividad sería decorativa.

**Q4 — [RESUELTA CONTRA CÓDIGO] alcance de 137/138/139.** Las tres features aterrizaron y
están mergeadas en `dev`; **ya no queda ningún `TODO(138)`/`TODO(139)`** en el mapa.
- **137 (renombres):** `en_reparto -> en_ruta`, `en_espera_aceptacion -> por_recoger`,
  `en_bodega -> en_bodega_central`, `en_ruta_bodega_principal -> en_ruta_bodega_central`,
  `devuelta_origen -> devolviendo_a_tienda`, `recibido_origen -> devuelta_a_tienda`.
- **138 (recepción central):** una arista nueva, `en_ruta_bodega_central -> en_bodega_central`.
- **139 (devolución de rechazadas):** **TRES** estados nuevos (el borrador asumía uno solo)
  y cinco aristas nuevas; además **RETIRÓ** `rechazada -> devolviendo_a_tienda`.
El inventario re-verificado, con la lista completa y las discrepancias detectadas, está en
el apéndice A de `design.md`.

**Q5 — [RESUELTA por el humano] la creación (`null -> X`) SÍ se valida.**
`ESTADOS_CREACION = ["en_preparacion", "en_fulfillment", "en_ruta_bodega_central"]`
(verificado en código: `ordenesConfig.DEFAULT_ESTATUS_VALUE`,
`ordenesConfig.FULFILLMENT_ESTATUS_VALUE`, `BulkOrdenService.ESTATUS_INICIAL_API`). Nacer
en cualquier otro estado se rechaza (R10).
**Efecto colateral conocido y deliberado:** `OrdenService.crear` acepta hoy un `estatusId`
explícito arbitrario del catálogo (`crearOrdenSchema.estatusId` es opcional y sólo se
valida con `existsEstatus`). Con la guardia activa, crear directamente en un estado fuera
de los tres pasa a fallar. NO es una regresión de R8: no hay flujo legítimo que lo use, y
el propósito de la feature es exactamente cerrar esa puerta.

**Q6 — [RESUELTA por el humano] superficie del error: `throw` tipado.**
`TransicionIlegalError` distinguible por `instanceof`, mensaje sin PII (sólo los dos
`value`), y la firma de `appendCambioEstado` NO cambia para los ~18 call-sites (el
resolvedor de catálogo entra como parámetro opcional con default real). El `throw` dentro
de la `$transaction` es lo que da la atomicidad de R7.

**Q7 — [RESUELTA por el humano; decisión NUEVA que el borrador no contemplaba]
ACTIVACIÓN ESTRICTA desde el día 1.** La guardia lanza en producción desde el primer
despliegue: **no** hay modo shadow, ni modo solo-log, ni feature flag de apagado (R6).
- **Riesgo asumido:** si el inventario del apéndice A tiene un hueco (una arista real no
  declarada), ese flujo deja de funcionar en producción — el `throw` revierte la
  transacción del call-site y la acción falla, no degrada en silencio.
- **Mitigación:** el test de no-regresión **data-driven sobre el inventario COMPLETO**
  (T3.4), que ejercita cada arista declarada contra la guardia real, más el test de
  conectividad (T3.1) que exige cobertura exacta del catálogo (R16). La calidad del
  apéndice A es, literalmente, la red de seguridad de esta decisión: por eso se
  re-verificó contra código en vez de heredarse del borrador.
