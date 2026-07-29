# Feature 160 — Chip de intentos de entrega en la orden

Requisitos en notación EARS. Cada `R<n>` es testeable y sin detalle de
implementación. Feature `fullstack`, complejidad baja, ADITIVA: **no** crea
tablas, **no** crea migraciones y **no** redefine ninguna regla de negocio
existente.

## Contexto (verificado contra el código de la rama)

El conteo de intentos de entrega **ya existe y ya es la fuente de verdad**; esta
feature solo lo lleva a dos superficies de UI.

- `OrdenHistorialService.contarIntentos(ordenId)`
  (`lib/services/OrdenHistorialService.ts:56`) resuelve el id del estado
  `devuelta` y delega en
  `OrdenHistorialRepository.contarPorDestinoVigentes(ordenId, devueltaId)`
  (`lib/repositories/OrdenHistorialRepository.ts:92`), que cuenta filas de
  `orden_historial_estado` con `estatus_destino_id = devuelta` cuya gestión sigue
  **vigente** (features 46/47/67). "Vigente" excluye las transiciones causadas
  por gestiones ANULADAS y las HUÉRFANAS, pero sigue contando las que nunca
  vinieron de una gestión.
- El contrato de qué cuenta y qué no como intento está documentado en
  `lib/types/orden-historial.ts` (bloques de las features 49/67/99/100/109/138/139)
  y es parte del contrato, no un comentario decorativo.
- Ese MISMO valor alimenta hoy dos consumidores: la regla de
  reintento-vs-escalado del cron SLA (feature 99) y el badge "Intento X de N" del
  drawer de historial (feature 47,
  `app/(app)/ordenes/_components/HistorialOrdenSheet.tsx:156-181`, oculto con
  `intentos === 0`).
- `db/schema.prisma:1155` ya declara `@@index([ordenId, estatusDestinoId])` para
  ese conteo. `orden_historial_estado` ya tiene RLS habilitada sin policies
  (solo service-role).
- El listado de `/ordenes` se pagina **en servidor** (`OrdenService.listar` →
  `OrdenRepository.list`, `skip`/`take`), y su DTO es `OrdenListItemDTO`
  (`lib/types/orden.ts:150`), que ya tiene el precedente de campo derivado
  opcional `zonaEsGam?` (`:155`).
- La card del mensajero (`app/(app)/mis-asignaciones/_components/pos-card/PosOrderCard.tsx`)
  NO consume `OrdenListItemDTO`, sino `MiAsignacionDTO`
  (`lib/interfaces/services/IMisAsignacionesService.ts:12`), que ya tiene el
  mismo precedente aditivo (`marcarLuego?`, `notaPrivada?`, features 115/116).

## Requisitos

**R1 — Conteo expuesto en el listado de órdenes.** El sistema DEBE exponer, en
cada elemento del listado paginado de órdenes, el número de intentos de entrega
VIGENTES de esa orden.

**R2 — Conteo expuesto en las asignaciones del mensajero.** El sistema DEBE
exponer, en cada orden del listado del portal del mensajero (ambos grupos: "por
recoger" y "por gestionar"), el número de intentos de entrega VIGENTES de esa
orden.

**R3 — Criterio único, sin re-derivación.** El sistema DEBE producir, para una
misma orden, EXACTAMENTE el mismo número que devuelve hoy el conteo individual
del historial (el que alimentan el drawer de historial y la regla de escalado).
El sistema NO DEBE definir un segundo criterio de "intento vigente".

**R4 — Resolución en lote.** CUANDO el sistema resuelve una página de N órdenes,
DEBE obtener los N conteos con UNA sola consulta al historial, sea cual sea N
(una consulta por fila es un incumplimiento de este requisito, no una nota
menor).

**R5 — Sin consulta con lote vacío.** SI el conjunto de órdenes a resolver está
vacío, ENTONCES el sistema NO DEBE emitir consulta alguna al historial y DEBE
devolver un resultado vacío.

**R6 — Degradación segura sin catálogo.** SI el estado `devuelta` no existe en el
catálogo de estados (seed pendiente), ENTONCES el sistema DEBE reportar 0
intentos para todas las órdenes del lote y NO DEBE fallar el listado.

**R7 — Órdenes sin intentos.** SI una orden no tiene ninguna transición vigente
que cuente como intento, ENTONCES el sistema DEBE reportar 0 para esa orden (no
ausencia de dato ni error).

**R8 — Chip en el listado de órdenes.** DONDE una fila del listado de órdenes
tiene un conteo de intentos mayor o igual a 1, el sistema DEBE mostrar un chip
que comunique ese número y DEBE exponer un nombre accesible que lo identifique
como intentos de entrega (no solo el número suelto).

**R9 — Chip oculto en cero.** SI el conteo de intentos de una orden es 0 o el
dato no está disponible, ENTONCES el sistema NO DEBE renderizar el chip ni
ningún marcador de reemplazo en su lugar.

**R10 — Chip en la card del mensajero.** DONDE una card de orden del portal del
mensajero tiene un conteo de intentos mayor o igual a 1, el sistema DEBE mostrar
el chip con las mismas reglas de contenido, accesibilidad y ocultamiento de R8 y
R9.

**R11 — Presentación no invasiva en el listado.** El sistema DEBE mostrar el chip
del listado SIN agregar columnas nuevas ni alterar el conjunto ni el orden de las
columnas existentes.

**R12 — Sin regla de permisos nueva.** El sistema DEBE derivar la visibilidad del
conteo de la autorización que el listado YA aplica (alcance por rol: adminTienda
a sus órdenes, mensajero a sus asignadas, etc.), y NO DEBE exponer el conteo de
una orden que el actor no puede listar.

**R13 — Sin estado persistido nuevo.** El sistema NO DEBE introducir columnas,
tablas, enums ni migraciones para sostener este conteo: sigue siendo derivado del
historial en tiempo de lectura.

**R14 — Sin alteración de las reglas vigentes.** El sistema NO DEBE cambiar qué
transiciones cuentan como intento, ni el umbral configurable de reintentos, ni el
comportamiento del cron SLA, ni el contenido del drawer de historial.

**R15 — Contrato aditivo y retrocompatible.** El campo de conteo DEBE ser
opcional en los DTO afectados: todo consumidor, fixture o mock que hoy construye
esos DTO sin el campo DEBE seguir compilando y renderizando (fila/card sin chip,
según R9).

**R16 — Sin regresión del listado.** El listado de órdenes y el del portal del
mensajero DEBEN conservar su paginación, su orden y su resto de contenido sin
cambios observables más allá del chip.

## Trazabilidad R → test

La tabla se completa con rutas reales en la última task (ver `tasks.md`, T12). Se
deja aquí el mapa PROPUESTO para que ningún requisito quede sin dueño.

| Req | Test propuesto |
| --- | --- |
| R1  | unit del repo de órdenes/servicio: el DTO del listado propaga el conteo |
| R2  | unit de `MisAsignacionesService.listarMisAsignaciones`: el DTO propaga el conteo en ambos grupos |
| R3  | unit del repositorio de historial: el conteo en lote y el individual comparten predicado y coinciden para la misma orden (incluye gestión anulada y fila huérfana) |
| R4  | unit del repo: con N ids el mock de Prisma registra 1 sola llamada al historial |
| R5  | unit del repo: `ids = []` → 0 llamadas a Prisma, mapa vacío |
| R6  | unit del servicio: `findEstatusIdByValue("devuelta") = null` → todos 0, sin excepción |
| R7  | unit del servicio: orden sin filas en el lote → 0 (no `undefined`) |
| R8  | component test de las columnas del listado: conteo ≥ 1 renderiza chip con nombre accesible |
| R9  | component test: conteo 0 / ausente → sin chip ni placeholder |
| R10 | component test de la card del mensajero: ≥1 chip, 0 sin chip |
| R11 | unit de columnas: ids y orden de columnas idénticos a los previos |
| R12 | unit del servicio: el conteo se resuelve solo sobre los ids ya filtrados por el alcance del rol |
| R13 | verificación de que no hay migración nueva ni cambio de `schema.prisma` (revisión + `init.sh`) |
| R14 | suites existentes de historial/SLA/drawer en verde sin cambios de aserción |
| R15 | type-check + tests existentes que construyen los DTO sin el campo, en verde |
| R16 | suites de listado y de `/mis-asignaciones` existentes en verde |

## Preguntas abiertas

Se formalizan con recomendación razonada en `design.md > §7 Preguntas abiertas
(puerta F1.4)`. Resumen:

- **Q1** — ¿El intento cuenta solo destino `devuelta` (como hoy) o también
  `reprogramada`? *Recomendación: solo `devuelta`.*
- **Q2** — ¿El estado nuevo `incidente` (feature 158) cuenta como intento?
  *Recomendación: no (es terminal).*
- **Q3** — ¿El chip muestra el umbral ("Intento 2 de 3") como el drawer, o solo
  el número de intentos? *Recomendación: solo el número en el chip.*
- **Q4** — ¿El chip llega también a los listados de `/recepcion-satelite` y
  revisión del maestro? *Recomendación: no en esta feature.*
