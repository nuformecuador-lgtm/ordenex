# Feature 160 — Intentos de entrega: criterio, escalado y chip

Requisitos en notación EARS. Cada `R<n>` es testeable y sin detalle de
implementación. Feature `fullstack`, complejidad **high** (era `low`).

> **Esta feature ya NO es "un chip".** La puerta F1.4 del 2026-07-29 se resolvió
> EN CONTRA de tres recomendaciones del spec anterior. El alcance real es:
> **corregir el derivador compartido de intentos de entrega** —el que gobierna el
> cron SLA de la feature 99 y, por esa vía, el `cobroRechazado` de la feature 56
> (dinero real)— y **llevar el conteo a TODAS las superficies donde se muestra la
> orden**, incluidos los descargables.
>
> El R14 del spec anterior decía que, si Q1 se respondía así, la feature se
> DETENÍA y exigía spec propio. Este documento ES ese spec.

## Decisiones de la puerta F1.4 (2026-07-29) — entrada, no sugerencia

| # | Decisión | Contra la recomendación previa |
| --- | --- | --- |
| **D1** | El intento cuenta destino `devuelta` **Y** destino `reprogramada`. | Sí (el spec recomendaba solo `devuelta`) |
| **D2** | El conteo ampliado gobierna **también el escalado automático**, no solo el chip. Consecuencia aceptada y reafirmada: las órdenes con reprogramación llegan antes al umbral, se rechazan antes y se le cobra antes el rechazo a la tienda. | Sí |
| **D3** | `incidente` **NO** cuenta como intento y queda **TERMINAL**. El estado `indemnizada` se planteó y se **descartó**: no existe, no se declara, no se deja preparado. La 160 no depende de la 158. | No (se mantiene) |
| **D4** | El chip va en **TODAS** las superficies donde se muestre la orden (tablas, cards, archivos descargables), **dentro de esta misma feature**. | Sí (el spec dejaba fuera `/recepcion-satelite` y la revisión del maestro) |
| **D5** | El chip muestra **solo el número** ("2 intentos"), sin el umbral "de N". | No (se mantiene) |

## Contexto verificado contra el código de la rama

- El conteo **existe** y es la fuente de verdad:
  `OrdenHistorialService.contarIntentos` (`lib/services/OrdenHistorialService.ts:56-68`)
  → `OrdenHistorialRepository.contarPorDestinoVigentes`
  (`lib/repositories/OrdenHistorialRepository.ts:92-108`). Lo que cambia es el
  **criterio**, no la existencia del derivador.
- Sus DOS consumidores actuales: `DevolucionSlaService.ts:110` (cron SLA,
  feature 99) y `OrdenHistorialService.ts:51` (drawer de historial, feature 47).
  Ampliar el criterio los mueve a los dos.
- Hay **dos** caminos a `reprogramada` en el mapa cerrado de la feature 140
  (`lib/types/order-status-transiciones.ts:86` y `:106`), y **solo uno es una
  visita real**:
  - `#13` `en_reparto → reprogramada`, familia `gestion`, rol mensajero: el
    mensajero fue, no entregó y acordó nueva fecha. **Hoy no se cuenta.**
  - `#22` `devuelta → reprogramada`, familia `reprogramacion_tienda`, rol
    adminTienda: la tienda reprograma una orden **ya devuelta**.
- **Verificado que `#22` sería doble conteo:**
  `GestionOrdenRepository.reprogramarDesdeDevuelta` (`:384-443`) **NO anula** la
  gestión `devuelta` previa; esa fila sigue vigente y sigue contando. Sumar
  además la fila `reprogramada` contaría el mismo hecho dos veces.
- `devuelta` tiene **una sola** arista entrante en el mapa (`#14`, familia
  `gestion`); `reprogramada` tiene las dos de arriba y ninguna más.
- `db/schema.prisma:1152` ya declara `@@index([ordenId, estatusDestinoId])`.
  `orden_historial_estado` ya tiene RLS habilitada sin policies (solo
  service-role) y es append-only e inmutable.
- El umbral vive en `reintentosConfig.MIN_INTENTOS_ENTREGA`
  (`lib/config/reintentos.ts`, env `REINTENTOS_MIN_INTENTOS`, default **3**) y
  **no** está en el bundle del cliente (no es `NEXT_PUBLIC_`).

---

## Grupo A — El criterio de "intento de entrega"

**R1 — Definición del intento.** El sistema DEBE contar como UN intento de
entrega de una orden cada transición VIGENTE de su historial que cumpla una de
estas dos condiciones, y solo esas:
(a) su estado destino es `devuelta`; o
(b) su estado destino es `reprogramada` **y** su familia de origen es `gestion`.

**R2 — La reprogramación de la tienda no cuenta.** SI una transición tiene
destino `reprogramada` y familia de origen `reprogramacion_tienda`, ENTONCES el
sistema NO DEBE contarla como intento, porque la transición `devuelta` de esa
misma orden sigue vigente y ya aportó ese intento.

**R3 — `incidente` no cuenta.** El sistema NO DEBE contar como intento ninguna
transición cuyo destino sea `incidente`, y NO DEBE declarar, referenciar ni dejar
preparado ningún estado que desterminalice `incidente`.

**R4 — Criterio ÚNICO y compartido.** El sistema DEBE producir, para una misma
orden, EXACTAMENTE el mismo número de intentos en las tres lecturas que lo
consumen: la regla de reintento-vs-escalado del cron SLA, el badge del drawer de
historial y el chip de cualquier superficie. El sistema NO DEBE admitir una
segunda definición de "intento vigente".

**R5 — Vigencia conservada.** El sistema DEBE seguir excluyendo del conteo (a)
las transiciones causadas por una gestión ANULADA y (b) las transiciones de la
familia gestión cuyo enlace a la gestión está vacío (huérfanas), y DEBE seguir
contando las transiciones que nunca vinieron de una gestión. El historial NO DEBE
modificarse: la exclusión es un filtro de LECTURA.

**R6 — Degradación segura sin catálogo.** SI el estado `devuelta` no existe en el
catálogo de estados, ENTONCES el sistema DEBE reportar 0 intentos para toda orden
y NO DEBE fallar la lectura. SI existe `devuelta` pero no `reprogramada`,
ENTONCES el sistema DEBE contar únicamente la rama (a) de R1 y NO DEBE fallar.

**R7 — Sin estado persistido nuevo y sin migración.** El sistema NO DEBE
introducir columnas, tablas, enums, índices ni migraciones para sostener este
conteo: sigue derivándose del historial en tiempo de lectura.

---

## Grupo B — Efecto sobre el escalado y sobre el historial

**R8 — El escalado usa el criterio nuevo.** CUANDO el cron SLA evalúa una orden
que reposa en `devuelta` con causa `not_found` y su ventana vencida, el sistema
DEBE comparar contra el umbral configurable el conteo definido en R1 (no el
conteo restringido a destino `devuelta`).

**R9 — El resto del cron no cambia.** El sistema NO DEBE alterar, respecto del
comportamiento vigente: qué órdenes son candidatas del cron, las ventanas por
causa, el escalado directo de `wrong_number`/`wrong_address`, la idempotencia por
guarda de estado, la resiliencia por orden ni el destino de la liberación.

**R10 — El drawer de historial refleja el mismo número.** CUANDO un actor
autorizado abre el historial de una orden, el sistema DEBE mostrar el conteo de
intentos definido en R1 y el umbral configurable, con las mismas reglas de
visibilidad y ocultamiento que ya aplica.

---

## Grupo C — Exposición del conteo (backend)

**R11 — Conteo expuesto por superficie.** El sistema DEBE exponer el número de
intentos de entrega de cada orden en el resultado de cada lectura que alimenta
una superficie del inventario de R21–R27.

**R12 — Resolución EN LOTE.** CUANDO el sistema resuelve el conteo para un
conjunto de N órdenes, DEBE obtener los N conteos con UNA sola consulta al
historial, sea cual sea N. Una consulta por fila es un incumplimiento de este
requisito, no una nota menor.

**R13 — Sin consulta con lote vacío.** SI el conjunto de órdenes a resolver está
vacío, ENTONCES el sistema NO DEBE emitir consulta alguna al historial y DEBE
devolver un resultado vacío.

**R14 — Órdenes sin intentos.** SI una orden no tiene ninguna transición que
cumpla R1, ENTONCES el sistema DEBE reportar `0` para esa orden, no ausencia de
dato ni error.

**R15 — Sin regla de permisos nueva.** El sistema DEBE derivar la visibilidad del
conteo del alcance que cada lectura YA aplica (adminTienda a sus órdenes,
mensajero a sus asignadas, adminSatélite a su zona, etc.) y NO DEBE exponer el
conteo de una orden que el actor no puede leer por esa vía.

**R16 — Contrato interno aditivo.** El campo de conteo DEBE ser opcional en los
DTO internos afectados: todo consumidor, fixture o mock que hoy los construye sin
el campo DEBE seguir compilando y renderizando (sin chip, según R18).

---

## Grupo D — Presentación

**R17 — Contenido y accesibilidad del chip.** DONDE una orden tiene un conteo de
intentos mayor o igual a 1, el sistema DEBE mostrar un chip que comunique ese
número en texto (singular/plural) y DEBE exponer un nombre accesible que lo
identifique como intentos de entrega, no solo el número suelto.

**R18 — Chip oculto en cero.** SI el conteo de intentos de una orden es 0 o el
dato no está disponible, ENTONCES el sistema NO DEBE renderizar el chip ni
ningún marcador de reemplazo en su lugar.

**R19 — Sin umbral en el chip.** El chip NO DEBE mostrar el umbral de reintentos
("de N"), y el sistema NO DEBE enviar el umbral al cliente en ninguna de las
superficies del inventario.

**R20 — Presentación no invasiva en las tablas.** El sistema DEBE mostrar el chip
en las tablas SIN agregar columnas nuevas y SIN alterar el conjunto, los
identificadores ni el orden de las columnas existentes.

**R21 — Listado de órdenes y sus variantes.** DONDE se muestra una orden en el
listado plano de órdenes, en la variante de columnas de la pestaña
`reprogramada`, en el dashboard del adminTienda o en cualquier apartado de la
revisión del maestro, el sistema DEBE mostrar el chip con las reglas de R17–R20.

**R22 — Listas de confirmación por lote.** DONDE un diálogo de acción por lote
lista las órdenes seleccionadas, el sistema DEBE mostrar el chip junto a cada
orden listada con las reglas de R17–R19.

**R23 — Portal del mensajero.** DONDE se muestra una orden del portal del
mensajero —en la card de "por gestionar", en la lista de "por recoger" y en el
detalle de la orden— el sistema DEBE mostrar el chip con las reglas de R17–R19.

**R24 — Recepción satélite.** DONDE se muestra una orden en cualquiera de los
grupos del módulo de recepción satélite (por recibir, recibidas, por devolver,
en tránsito a central, devueltas), el sistema DEBE mostrar el chip con las reglas
de R17–R20.

**R25 — Novedades de la tienda.** DONDE se muestra una orden en la lista de
novedades o en la lista de rechazadas por plazo vencido, el sistema DEBE mostrar
el chip con las reglas de R17–R19.

**R26 — Aviso de liberadas hoy.** DONDE se muestra una orden en el aviso
"Liberadas hoy (reprogramación)" de una bodega, el sistema DEBE mostrar el chip
con las reglas de R17–R19.

**R27 — Manifiesto descargable.** CUANDO el sistema genera el manifiesto en
Excel, DEBE emitir el número de intentos de entrega de cada orden como una
columna del archivo, con valor `0` para las órdenes sin intentos (celda con
número, no celda vacía).

---

## Grupo E — Límites y no regresión

**R28 — No se expone en la vista del paquete ni en la etiqueta.** El sistema NO
DEBE exponer el conteo de intentos en la página de detalle del paquete a la que
apunta el QR ni en la etiqueta de guía imprimible.

**R29 — No se expone en el contrato público de integradores.** El sistema NO DEBE
agregar el conteo de intentos a los DTO ni a la documentación de la API por
llave de integración.

**R30 — Sin regresión de los listados.** Todas las superficies afectadas DEBEN
conservar su paginación, su orden, su selección por lote y el resto de su
contenido sin cambios observables más allá del chip.

---

## Trazabilidad R → test

Mapa PROPUESTO; se completa con rutas reales en la última task (`tasks.md`, T25).
Ningún requisito queda sin dueño.

| Req | Test propuesto |
| --- | --- |
| R1  | unit del predicado de intentos: cuenta `devuelta`; cuenta `reprogramada`+`gestion`; no cuenta otros destinos |
| R2  | unit: fila `reprogramada` con origen `reprogramacion_tienda` NO suma; escenario 1 devuelta + 1 reprogramación de tienda → 1 |
| R3  | unit: fila con destino `incidente` no altera el conteo; guard estático de que no existe estado `indemnizada` en el catálogo |
| R4  | unit: el conteo individual y el conteo en lote comparten predicado y coinciden para la misma orden; el cron y el drawer consumen ese punto único |
| R5  | unit: gestión anulada no cuenta (para AMBAS ramas de R1); fila huérfana no cuenta; fila sin gestión cuenta |
| R6  | unit del servicio: catálogo sin `devuelta` → 0/mapa vacío sin excepción; catálogo sin `reprogramada` → solo rama (a) |
| R7  | revisión + `./init.sh`: `git diff` sin cambios en `db/schema.prisma` ni `db/migrations/` |
| R8  | unit de `DevolucionSlaService`: orden con 2 reprogramaciones de mensajero + 1 devuelta y umbral 3 → ESCALA (hoy liberaría) |
| R9  | suite existente de `DevolucionSlaService` verde sin cambios de aserción salvo la del umbral |
| R10 | unit de `obtenerHistorial`: `intentos` refleja el criterio nuevo; el umbral sigue viajando |
| R11 | unit por servicio de lectura (7): el DTO propaga el conteo |
| R12 | unit por repositorio/servicio: con N ids, exactamente 1 llamada al historial |
| R13 | unit: `ids = []` → 0 llamadas, mapa vacío |
| R14 | unit: orden sin filas en el lote → `0`, no `undefined` |
| R15 | unit: los ids del lote son EXACTAMENTE los ya acotados por rol/zona/tienda |
| R16 | type-check + suites existentes que construyen los DTO sin el campo, en verde |
| R17 | component test del chip: `1` → singular, `3` → plural, nombre accesible correcto |
| R18 | component test: `0` y campo ausente → sin chip ni placeholder |
| R19 | component test + grep de contrato: el payload de las superficies no lleva el umbral |
| R20 | unit de columnas: ids y orden idénticos a los previos en las 4 definiciones de columnas |
| R21 | component tests de las 4 variantes de columnas del listado |
| R22 | component tests de los diálogos de acción por lote |
| R23 | component tests de la card POS, de la lista "por recoger" y del detalle |
| R24 | component tests de los 5 grupos de recepción satélite |
| R25 | component tests de novedades y de rechazadas por plazo vencido |
| R26 | component test del aviso "Liberadas hoy" |
| R27 | unit del generador del manifiesto: la columna de intentos existe, con `0` cuando no hay intentos |
| R28 | component/route test: la vista del paquete y la etiqueta no muestran el conteo |
| R29 | unit del DTO público + guard de la especificación OpenAPI: sin campo nuevo |
| R30 | suites existentes de las 11 superficies verdes sin cambios de aserción |

---

## Preguntas abiertas

Se detallan con evidencia en `design.md > §8`. Aquí el resumen y su carácter.

### Bloqueantes (la implementación NO arranca sin respuesta)

- **QA1 — Efecto retroactivo sobre órdenes vivas.** El conteo se recalcula al
  vuelo desde el historial: **no hay fecha de corte y el cambio no es solo hacia
  adelante**. En el primer pase del cron tras el despliegue, toda orden que hoy
  reposa en `devuelta` con causa `not_found` y ≥1 reprogramación de mensajero
  vigente puede saltar de golpe por encima del umbral y **escalar a `rechazada`**,
  generando `cobroRechazado` a la tienda (feature 56). ¿Qué se hace con ellas?
  No se rellena con un supuesto. Opciones planteadas en `design.md §8.1`.

- **QA2 — Mecanismo del corte, si QA1 elige acotar.** Si la respuesta a QA1 no es
  "aplica a todas de una vez", hay que decidir el mecanismo exacto (fecha de
  corte configurable, despliegue en dos entregas, o revisión manual del lote
  afectado) y quién lo opera.

- **QA3 — La 12.ª columna del manifiesto.** R27 obliga a emitir los intentos en
  el manifiesto Excel, pero la feature 148 declara en sus R2/R11 que el archivo
  tiene **EXACTAMENTE 11 columnas** y que "si se agrega una propiedad aquí, se
  rompe R2/R11". ¿Se confirma que D4 deroga ese requisito de la 148 (y su spec se
  anota), o el manifiesto queda fuera por ser documento operativo congelado?

### No bloqueantes (tienen recomendación razonada; se cierran en la misma puerta)

- **QA4 — Vista del paquete (QR) y etiqueta imprimible.** *Recomendación: NO*
  (R28). La vista del paquete es accesible a **cualquier rol autenticado**, no
  solo al alcance de la orden; exponer ahí el conteo amplía la visibilidad sin
  que ninguna decisión lo pida.
- **QA5 — API pública de integradores.** *Recomendación: NO en esta feature*
  (R29). Es contrato externo y ya se rompió sin aviso dos veces esta semana.
- **QA6 — Cierre del día y cierres de admin.** *Recomendación: NO.* Su grano es
  la GESTIÓN, no la orden, y es un documento de dinero congelado.
- **QA7 — Filas legadas con destino `reprogramada` y origen distinto de
  `gestion`.** El criterio de R1 es por INCLUSIÓN, así que quedan fuera.
  *Recomendación: mantenerlo así* — contar de menos retrasa el escalado
  (inofensivo); contar de más cobra un rechazo antes de tiempo.
