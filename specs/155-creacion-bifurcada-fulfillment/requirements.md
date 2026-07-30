# Feature 155 — Creación bifurcada por bodega + retiro de `en_fulfillment`

> Zona: `backend` · Complejidad: `high` · Depende de: **154** (que depende de **153**).
> Rama sugerida: `feature/155-creacion-bifurcada-fulfillment`.

## Contexto

Al crear una orden el sistema decide **dónde nace** según si el paquete **ya está en la bodega**:

- **Rama (a) — ya está en bodega**: la orden nace en `en_preparacion` y **sin `num_guia`** (guía
  pendiente; la genera después la feature 156).
- **Rama (b) — no está en bodega**: se le genera la guía **en el acto**, se emite el manifiesto y
  la orden nace en `por_recolectar_en_tienda` (value que da de alta la feature 154).

Las **tres vías de creación** quedan cubiertas: alta manual, carga masiva por UI y carga por API key.

## Estado heredado que este spec asume aplicado

- **153**: `en_ruta` → `en_reparto` (rename mecánico).
- **154**: values `por_recolectar_en_tienda` e `incidente` en el catálogo, grafo v2 en
  `TRANSICIONES`, `por_recolectar_en_tienda` sumado a `ESTADOS_CREACION`, etiquetas de badge de
  los dos values nuevos, y los values `recoleccion_tienda`/`incidente` en el enum
  `orden_historial_origen_tipo`.

## Decisiones del humano ya cerradas (no se reabren)

1. La respuesta a "¿ya está en bodega?" sale del **interruptor de fulfillment de la TIENDA**, no de
   la orden ni de la vía de carga.
2. Ese flag **ya existe**: `Usuario.fulfillment` (`db/schema.prisma:97`, `Boolean @default(false)`,
   feature 27) y su switch ya está montado en
   `app/(app)/configuracion/_components/UsuarioForm.tsx:353-363`. **No hay migración ni UI nueva
   para el flag**: el trabajo es recablear a qué estado mapea.
3. `en_fulfillment` **se retira**: no aparece en el flujo nuevo, y las órdenes que ya están en
   bodega nacen en `en_preparacion`.
4. `BulkOrdenService.ESTATUS_INICIAL_API` (= `en_ruta_bodega_central`) **se retira**: dejaba la
   orden viajando sin haber sido recolectada.

> **No confundir con el otro `fulfillment` del repo.** El de tarifas (`db/schema.prisma:760`,
> `Decimal`, y `app/(app)/configuracion/tarifas/_components/CrearTiendaForm.tsx:22`) es un **monto**,
> nada que ver con este flag booleano de usuario.

---

## Requisitos (EARS)

### A. El punto único de decisión

- **R1** — El sistema DEBE resolver el estado inicial de toda orden creada a partir de **un solo
  predicado**: el valor de `fulfillment` del usuario **dueño** de la orden (el que queda en
  `orden.tienda_id`). Ninguna otra entrada DEBE influir en esa decisión: ni el payload de la
  petición, ni la vía de carga, ni el rol del actor que ejecuta.
- **R2** — SI el dueño de la orden tiene `fulfillment = true`, ENTONCES el sistema DEBE crear la
  orden en `en_preparacion` y con `num_guia` **sin asignar** (`NULL`).
- **R3** — SI el dueño de la orden tiene `fulfillment = false`, ENTONCES el sistema DEBE crear la
  orden en `por_recolectar_en_tienda` y asignarle `num_guia` **en la misma transacción** de la
  creación.
- **R4** — CUANDO la creación es por lote (carga masiva por UI o por API key), el sistema DEBE
  resolver el predicado de R1 **una sola vez por lote**, no una vez por fila.
- **R5** — El sistema DEBE determinar el estado inicial **exclusivamente** por R1: la entrada de
  creación DEJA de exponer un estatus inicial, y una entrada que traiga uno arbitrario NO DEBE
  alterar el estado en que nace la orden.
- **R6** — La bifurcación DEBE estar implementada en **un solo punto de decisión** compartido por
  las tres vías de creación; ninguna vía DEBE replicar la regla por su cuenta.
- **R7** — CUANDO el catálogo de estados no contiene el value que la rama resuelta necesita, el
  sistema NO DEBE crear ninguna orden y DEBE reportar un error accionable que nombre el value
  faltante, sin persistir nada.

### B. Guía, mensajero y trazabilidad de la creación

- **R8** — La asignación de `num_guia` de R3 DEBE usar la **misma secuencia atómica** que ya usa el
  resto del sistema para numerar, y DEBE ser idempotente: solo consume un número cuando
  `num_guia IS NULL`. Ninguna guía DEBE colisionar ni consumirse dos veces.
- **R9** — MIENTRAS una orden nace por la rama de R3, el sistema NO DEBE asignarle mensajero
  (`mensajero_asignado_id` queda `NULL`). El mensajero **sugerido** que traiga la fila se conserva
  tal cual llega.
- **R10** — CUANDO se crea una orden por cualquiera de las tres vías, el sistema DEBE registrar su
  primera fila de historial (origen `NULL` → estado inicial) con la familia propia de la vía
  (`creacion_manual`, `carga_masiva` o `carga_api`), en la **misma transacción** que la creación.
- **R11** — CUANDO el sistema crea una orden por cualquiera de las tres vías y por cualquiera de las
  dos ramas, DEBE encolar la geocodificación de su dirección con el mismo criterio ya vigente: un
  encolado por orden **efectivamente insertada**, dentro de la misma transacción, y no-op si la
  dirección no es geocodificable.
- **R12** — El sistema NO DEBE producir efectos parciales en la creación: estado, `num_guia`,
  fila de historial y encolado de geocodificación de una misma orden se cometen o se revierten
  juntos.

### C. Vía 1 — alta manual

- **R13** — CUANDO maestro o admin crea una orden manualmente para una tienda, el sistema DEBE
  aplicar R1 sobre **la tienda indicada en la entrada**, no sobre el actor que ejecuta.
- **R14** — CUANDO un adminTienda crea una orden manualmente, el sistema DEBE aplicar R1 sobre **sí
  mismo** (la tienda que su rol le fuerza).
- **R15** — El alta manual DEBE conservar sus resultados de dominio actuales ante entrada inválida,
  rol no autorizado y `num_remision` duplicado: la bifurcación no cambia ninguno de esos caminos.

### D. Vía 2 — carga masiva por UI

- **R16** — CUANDO un adminTienda carga un archivo, el sistema DEBE aplicar R1 sobre esa tienda y
  DEBE reportar, por cada fila creada, el estado inicial resuelto.
- **R17** — MIENTRAS la carga masiva corre en modo **validación previa** (dry-run), el sistema NO
  DEBE crear ninguna orden ni consumir ningún `num_guia`, y DEBE reportar igualmente el estado
  inicial que correspondería.
- **R18** — CUANDO la carga masiva descarta una fila por duplicada (contra el archivo o contra la
  base), el sistema NO DEBE consumir `num_guia` ni dejar historial para esa fila.

### E. Vía 3 — carga por API key

- **R19** — CUANDO se crean órdenes por la vía de API key, el sistema DEBE aplicar R1 sobre el dueño
  de la key y DEBE dejar de usar un estado inicial fijo.
- **R20** — MIENTRAS el dueño de la key tenga `fulfillment = false`, las órdenes creadas por API
  DEBEN nacer en `por_recolectar_en_tienda` con `num_guia` asignado, y la respuesta DEBE reportar
  ese estado y esa guía por orden creada.
- **R21** — SI el dueño de la key tuviera `fulfillment = true`, ENTONCES las órdenes DEBEN nacer en
  `en_preparacion` y la respuesta DEBE reportar la guía **vacía** (`null`) para ellas, sin fabricar
  ningún número.
- **R22** — El sistema NO DEBE crear ninguna orden en `en_ruta_bodega_central`: ese estado deja de
  ser un estado de creación por cualquier vía.
- **R23** — La carga por API key DEBE conservar intactos el resto de su contrato de respuesta ya
  vigente: totales del lote, clasificación por fila, costo de envío por orden creada y bloque de
  etiquetas.

### F. Manifiesto de la rama (b)

- **R24** *(forma final, puerta T0.1 del 2026-07-29 — opción C de `design.md §8`)* — CUANDO un lote
  nace por la rama de R3, el sistema DEBE poder armar el manifiesto de ese lote con `origen` = la
  tienda dueña y `destino` = la bodega central, **reutilizando el servicio único de manifiesto**;
  ningún otro módulo DEBE construir filas de manifiesto. El punto de enganche DEBE ser un **flujo
  propio** (`recoleccion_tienda`), no el flujo de la carga masiva, y DEBE admitir la selección del
  lote por `num_remision`. ADEMÁS, el canal de API key —que no puede invocar la Server Action del
  manifiesto porque resuelve al actor por cookie de sesión— DEBE exponer el manifiesto de su lote en
  la respuesta de su propio endpoint de carga, con la misma disciplina best-effort del bloque de
  etiquetas.
- **R25** — Un fallo al armar o descargar el manifiesto NO DEBE revertir la creación ya cometida ni
  alterar el estado, la guía o el historial de ninguna orden.
- **R26** — MIENTRAS un lote nace por la rama de R2 (el paquete ya está en bodega), el sistema NO
  DEBE emitir manifiesto en la creación.

### G. Retiro de `en_fulfillment` — código

- **R27** — El sistema DEBE retirar `en_fulfillment` de la fuente de verdad TS del catálogo, de modo
  que el sembrado idempotente del catálogo deje de incluirlo.
- **R28** — El sistema DEBE retirar `en_fulfillment` del mapa de transiciones, de la lista de estados
  de creación, del mapa de etiquetas legibles, del mapa de variantes de badge y del mapa de refuerzo
  de acento, **conservando activo** el chequeo de exhaustividad estática: si un value del catálogo
  queda sin clasificar, el build DEBE romper.
- **R29** — El sistema DEBE retirar `en_fulfillment` de los orígenes admitidos por "generar guía" y
  por el ruteo a bodega satélite; una orden en un origen no admitido DEBE producir conflicto sin
  efectos sobre ninguna orden del lote.
- **R30** — El sistema DEBE retirar la clave de configuración del estado de fulfillment y su variable
  de entorno, y NO DEBE quedar **ninguna** variable de entorno capaz de fijar en qué estado nace una
  orden.
- **R31** — El sistema DEBE dejar la lista de estados de creación con **exactamente dos** valores:
  `en_preparacion` y `por_recolectar_en_tienda`. Intentar crear una orden en cualquier otro estado
  DEBE ser rechazado por la guardia de transiciones sin persistir nada.
- **R32** — La vista de revisión de órdenes NO DEBE ofrecer apartado ni acciones por lote para
  `en_fulfillment`.
- **R33** — El sistema DEBE incorporar `en_fulfillment` al **guard de censo ya existente**,
  extendiéndolo y no duplicándolo, de modo que ningún archivo de `app/`, `lib/`, `components/`,
  `hooks/`, `scripts/`, `tests/` ni `e2e/` conserve el literal fuera de una lista de excepciones
  justificada archivo por archivo.

### H. Retiro de `en_fulfillment` — datos

- **R34** — La migración DEBE reasignar (backfill) **toda** orden cuyo estado sea `en_fulfillment`
  —incluidas las borradas lógicamente— a `en_preparacion`, sin tocar `num_guia`,
  `mensajero_asignado_id`, `prioridad` ni ningún otro campo de la orden.
- **R35** — La migración DEBE dejar rastro del backfill de R34 en la línea de tiempo de cada orden
  afectada: una fila de historial `en_fulfillment → en_preparacion`, con familia `ajuste_estado`,
  **sin actor** (sistema) y con un motivo literal que la identifique como obra de esta migración.
- **R36** — La migración NO DEBE reescribir ni borrar ninguna fila de historial **preexistente** que
  referencie `en_fulfillment`: la línea de tiempo pasada es inmutable.
- **R37** — La migración DEBE eliminar `en_fulfillment` del catálogo de estados **solo si** ninguna
  orden y ninguna fila de historial lo referencian; en caso contrario DEBE dejar la fila en la tabla,
  inalcanzable desde cualquier flujo de la aplicación.
- **R38** — La migración DEBE tener `down.sql` reversible: repone el value en el catálogo si falta,
  devuelve a `en_fulfillment` exactamente las órdenes marcadas por el rastro de R35 que sigan en
  `en_preparacion`, y elimina ese rastro.
- **R39** — Tras aplicar la migración, el censo de datos DEBE dar **cero** órdenes en
  `en_fulfillment`.
- **R40** — El backfill de R34/R35 NO DEBE emitir notificaciones, webhooks ni jobs: es una corrección
  de datos, no una transición de negocio.
- **R41** — CUANDO la UI muestra una fila de historial cuyo estado ya no pertenece al catálogo
  conocido por el build, DEBE degradar al valor crudo con estilo neutro, sin romper la vista.

### I. Contrato público del canal de integración

- **R42** — La especificación OpenAPI del canal por API key y su espejo documental NO DEBEN
  documentar `en_fulfillment`, y DEBEN documentar el estado en que nacen las órdenes creadas por API
  tras esta feature.
- **R43** *(forma final, puerta T0.1 del 2026-07-29 — respuesta "SÍ" a la pregunta 2)* — CUANDO una
  orden creada por la vía de API key nace por la rama de R3, el integrador suscrito DEBE seguir
  recibiendo un evento de nacimiento: el cambio de estado inicial NO DEBE hacer desaparecer en
  silencio el evento que hoy recibe. Para lograrlo, `por_recolectar_en_tienda` DEBE incorporarse a
  la política de eventos públicos. La ampliación DEBE ser **aditiva**: ningún estado que hoy emite
  evento DEBE dejar de emitirlo.

---

## Preguntas abiertas — CERRADAS (puerta T0.1, humano, 2026-07-29)

> **Las seis se cerraron el 2026-07-29 y no se reabren.** Las respuestas literales, con su
> justificación, están en `design.md §11`. R24 y R43 quedan arriba en su **forma final**. Resumen:
> (1) manifiesto → **opción C**; (2) evento público → **sí**; (3) el rol `apiKey` cae siempre en la
> rama (b) y **R21 se implementa igual**, como rama defensiva; (4) la arista `#5` sobrevive (la usa
> la 156, ya mergeada); (5) etiqueta en el acto → **fuera de alcance**, va en la 157; (6) zona →
> **backend → frontend**, la fase backend no toca `.tsx`.
>
> El texto original de las seis preguntas se conserva abajo como registro de lo que se preguntó.

1. **Manifiesto de la rama (b)** — ¿reusa la Server Action `obtenerManifiesto` de la feature 148 o
   necesita punto de enganche propio? Desarrollada con opciones y consecuencias en
   `design.md § 8`. Afecta a R24.

2. **Evento público de nacimiento (R43)** — hoy una orden creada por API key nace en
   `en_ruta_bodega_central`, que **sí** está en la política de eventos públicos
   (`lib/types/webhook-eventos.ts:12-22`), así que el integrador recibe un evento al crearse.
   `por_recolectar_en_tienda` no está en esa lista. El diseño propone **añadirlo** para no perder el
   evento, pero esa lista está declarada como contrato público fijado en un gate previo. ¿Se
   confirma añadirlo, o se acepta que el integrador deje de recibir evento al crear?

3. **Integradores con bodega propia** — el switch de fulfillment solo se muestra y se acepta para el
   rol `adminTienda`; el backend fuerza `false` para el resto de roles
   (`UsuarioForm.tsx:133-136,169,190`). El dueño de una API key es un usuario de rol `apiKey`, de
   modo que **estructuralmente siempre cae en la rama (b)**. ¿Es lo querido, o un integrador con
   bodega propia debe poder marcarse como "ya está en bodega"? (R21 queda como rama defensiva, hoy
   inalcanzable.)

4. **Arista `en_preparacion → en_bodega_central`** — la ficha de la 154 la lista entre las aristas
   retiradas ("#4 y #5 desde `en_preparacion`") y, dos frases después, afirma que "generar guía solo
   puede llevar a `en_bodega_central`"; la feature 156 la necesita. Es una contradicción **de la
   ficha de la 154**, no de esta feature: 155 no toca esa arista. Debe resolverse antes de 156.

5. **Etiqueta de la orden que nace con guía** — la rama (b) produce una orden con `num_guia` desde el
   minuto cero, así que su etiqueta ya es imprimible. ¿Se ofrece imprimir etiqueta en el acto de la
   creación (como ya hace la carga por API key con su PDF consolidado del lote), o eso queda para la
   feature 157? Esta feature **no** lo asume.

6. **Zona declarada de la feature** — la ficha dice `backend`, pero el retiro del value obliga a
   tocar tres componentes de `app/(app)/ordenes/_components/` (`EstatusBadge.tsx`,
   `OrdenesListado.tsx`, `OrdenesRevisionMaestro.tsx`) y `ordenes-columns.tsx`, porque los mapas
   están tipados como `Record<OrderStatusValue, …>` y el build rompe si sobra una clave. ¿Se acepta
   que 155 toque esos archivos, o se secuencia backend → frontend como en otras fullstack?
