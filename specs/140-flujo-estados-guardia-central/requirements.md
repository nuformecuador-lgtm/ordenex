# Feature 138 — Guardia central de transiciones de `order_status` — requirements.md

> Zona: backend · Complexity: high · Rama: `feature/138-flujo-estados-guardia-central`
> Depende de: 135 (renombres), 136 (recepción central), 137 (devolución de rechazadas).
> Notación EARS estricta. Cada `R<n>` es testeable.

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
  `lib/types/orden-historial.ts`) y el rol/actor que ejecuta la transición.
- **Estado terminal:** estado sin salida esperada en el flujo normal. Por decisión del
  gate: `entregada` y `devuelta_a_tienda` (Q1 RESUELTA; 135 renombra
  `recibido_origen -> devuelta_a_tienda`).
- **Estado de creación / entrada:** estado en el que una orden puede NACER (null -> X).
  Hoy: `en_preparacion` (default), `en_fulfillment` (tienda fulfillment), y el estado
  inicial del canal integrador (`carga_api`). Ver Q5.
- **Choke point:** `appendCambioEstado`, invocado por ~18 call-sites dentro de su misma
  transacción Prisma.

El apéndice de `design.md` contiene el **inventario cerrado** de todas las transiciones
existentes (fuente de verdad leída del código, no supuesta).

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

### Validación en el choke point

**R6** — CUANDO `appendCambioEstado` recibe una transición cuyo par `(origen, destino)`
NO está en `TRANSICIONES`, el sistema DEBE rechazarla con un error de dominio claro y NO
DEBE escribir el historial ni encolar el webhook de esa transición.

**R7** — CUANDO un lote (`createMany`) contiene al menos una transición ilegal, el sistema
DEBE rechazar el lote completo de forma atómica, sin efectos parciales (respeta el
contrato todo-o-nada vigente: al fallar dentro de la `$transaction`, revierte todo).

**R8** — El sistema DEBE aceptar sin cambios TODAS las transiciones que los call-sites
actuales ejecutan legítimamente: cada transición del inventario (apéndice de `design.md`)
DEBE estar presente en `TRANSICIONES`. Ningún call-site legal existente puede empezar a
fallar por introducir la guardia.

**R9** — SI la transición proviene del escape hatch administrativo (update genérico,
`OrdenService.actualizar`, `origen_tipo = ajuste_estado`), ENTONCES el sistema DEBE
someterla a la MISMA guardia (no hay `ANY -> ANY` sin declarar). Las aristas de ajuste
administrativo legítimas DEBEN estar declaradas explícitamente en `TRANSICIONES` (ver
Q3 sobre si el humano quiere reservar un override amplio para maestro/admin).

**R10** — CUANDO `appendCambioEstado` recibe una transición de creación (`origen = null`),
el sistema DEBE validar que el destino pertenece al conjunto de estados de creación (R3),
o aceptarlo según la política que fije el diseño (ver Q5).

**R11** — CUANDO una transición es legal, el comportamiento del sistema DEBE ser idéntico
al actual: mismo append de historial y mismo encolado transaccional del webhook (feature
99), sin regresión.

**R12** — El error de dominio de transición ilegal DEBE ser un tipo distinguible
(asertable por tests y call-sites) y NO DEBE filtrar PII ni secretos en su mensaje.

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
(como origen o destino) más los terminales y los de creación cubre exactamente
`ORDER_STATUS_SEED`, salvo los estados vestigiales explícitamente declarados (ver Q2).

### Trazabilidad

**R17** — Cada `R<n>` de este documento DEBE quedar mapeado a un test concreto en
`progress/impl_138.md` durante la implementación; un requisito sin test es un fallo de la
feature (docs/specs.md, trazabilidad).

---

## Preguntas abiertas

> Estas ambigüedades NO se resuelven inventando supuestos; se elevan para la puerta de
> aprobación. El diseño propone una respuesta por defecto donde es seguro, marcada `[def]`.

**Q1 — [RESUELTA por el gate] terminal del flujo de devolución.** El catálogo ACTUAL
(`ORDER_STATUS_SEED`) tiene `recibido_origen` como terminal del flujo de devolución
(14.º valor). El **renombre 135** hace `recibido_origen -> devuelta_a_tienda`. Los estados
terminales son `entregada` y `devuelta_a_tienda`. El mapa se escribe con la nomenclatura
post-135; el implementer aterriza 138 sobre un catálogo que ya tiene los renombres (135 es
dependencia).

**Q2 — `en_ruta_bodega_central` (estado sin entrada natural).** El inventario revela que
`en_ruta_bodega_central` (post-135; hoy `en_ruta_bodega_principal`, 6.º valor) NO tiene
ninguna transición natural de ENTRADA en el código actual: su única entrada posible es el
escape hatch genérico o la carga, y su única salida es la cancelación por API
(`cancelacion_api -> devolviendo_a_tienda`). Es un cuello de botella real que el test de
R14/R15 detectaría. ¿Es un estado vestigial/legado a declarar como excepción (allowlist) o
hay que darle una entrada de flujo? Esta feature lo inventaría y lo expone; NO decide
unilateralmente eliminarlo.

**Q3 — Política del escape hatch.** ¿El humano quiere un override administrativo amplio
(maestro/admin puede forzar cualquier `origen -> destino`) o incluso el ajuste
administrativo debe respetar `TRANSICIONES` (R9)? `[def]` Se propone que TODO pase por la
guardia y las aristas de ajuste legítimas se declaren; un override amplio debilitaría la
garantía de conectividad. Si se quiere el override, definir cómo mantener R14/R15
significativo.

**Q4 — Alcance de 135/136/137.** Nomenclatura final confirmada por el gate:
- **135 (renombres):** `en_reparto -> en_ruta`, `en_espera_aceptacion -> por_recoger`,
  `en_bodega -> en_bodega_central`, `en_ruta_bodega_principal -> en_ruta_bodega_central`,
  `devuelta_origen -> devolviendo_a_tienda`, `recibido_origen -> devuelta_a_tienda`. El
  mapa (apéndice A) ya usa estos nombres.
- **137 (devolución de rechazadas):** introduce el estado `devolviendo_a_bodega_central`
  ("en ruta de devolución a central"). Sus aristas concretas (origen/destino) no son
  verificables hoy contra código; quedan marcadas `TODO(137)` en el mapa hasta que 137
  aterrice.
- **136 (recepción central):** estado(s) y aristas nuevas aún por confirmar; marcadas
  `TODO(136)`.
Falta cerrar: (a) las aristas exactas de 137 alrededor de `devolviendo_a_bodega_central`;
(b) el/los estado(s) y aristas de 136.

**Q5 — Validación de la creación (`null -> X`).** ¿Debe la guardia rechazar crear una
orden directamente en un estado no-inicial (p. ej. `en_reparto`), o la validación de
creación queda fuera de alcance y sólo se validan transiciones con origen no nulo? `[def]`
Validar que `null -> X` cae en el conjunto de estados de creación declarado (R3/R10).

**Q6 — Superficie del error.** `appendCambioEstado` hoy es `Promise<void>`. La guardia
introduce un `throw` (que revierte la tx, deseable). Confirmar que un `throw` de dominio
dentro de la transacción es la superficie aceptada (vs devolver un resultado tipado, que
obligaría a cambiar la firma de ~18 call-sites y rompería R8). `[def]` `throw` tipado.
