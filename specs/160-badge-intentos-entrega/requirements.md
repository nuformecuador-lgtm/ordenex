# Feature 160 — Intentos de entrega: criterio, escalado y dato en la orden

Requisitos en notación EARS. Cada `R<n>` es testeable y sin detalle de
implementación. Feature `fullstack`, complejidad **high** (era `low`).

> **Esta feature ya NO es "un chip".** La puerta F1.4 del 2026-07-29 se resolvió
> EN CONTRA de tres recomendaciones del spec anterior. El alcance real es:
> **corregir el derivador compartido de intentos de entrega** —el que gobierna el
> cron SLA de la feature 99 y, por esa vía, el `cobroRechazado` de la feature 56
> (dinero real)— y **llevar el conteo a TODAS las superficies donde se muestra la
> orden**, incluidos los descargables, **como un dato más de la orden**.
>
> El R14 del spec original decía que, si Q1 se respondía así, la feature se
> DETENÍA y exigía spec propio. Este documento ES ese spec.

## Decisiones de la puerta F1.4 (2026-07-29) — entrada, no sugerencia

| # | Decisión | Contra la recomendación previa |
| --- | --- | --- |
| **D1** | El intento cuenta destino `devuelta` **Y** destino `reprogramada`. | Sí (el spec recomendaba solo `devuelta`) |
| **D2** | El conteo ampliado gobierna **también el escalado automático**. Consecuencia aceptada y reafirmada: las órdenes con reprogramación llegan antes al umbral, se rechazan antes y se le cobra antes el rechazo a la tienda. | Sí |
| **D3** | `incidente` **NO** cuenta como intento y queda **TERMINAL**. El estado `indemnizada` se planteó y se **descartó**: no existe, no se declara, no se deja preparado. La 160 no depende de la 158. | No (se mantiene) |
| **D4** | El dato va en **TODAS** las superficies donde se muestre la orden (tablas, cards, archivos descargables), **dentro de esta misma feature**. | Sí |
| **D5** | Se muestra **solo el número**, sin el umbral "de N". | No (se mantiene) |

## Decisiones de la puerta F1.4-bis (2026-07-29, mismo día)

| # | Decisión |
| --- | --- |
| **D6** | **Presentación: NO es un chip, es un dato.** Textual del humano: *"no manejemos los intentos como un chip, mejor manejemos como un dato más de las tablas, con su propia columna de intentos"*. En **tablas** → **columna propia "Intentos"**. En superficies **sin tabla** (cards, listas, diálogos) → **dato etiquetado "Intentos: N"**, con el mismo tratamiento visual y la misma jerarquía que los demás campos de esa superficie (Nombre, Producto, Nº Guía, Teléfono). |
| **D7** | **QA1 resuelto: opción (a), sin mitigación.** Resuelto **por medición**, no por precaución: la consulta de `design.md §4.3` se ejecutó contra producción (`ordenex-db`, solo lectura, 2026-07-29) y arrojó **0 órdenes** que salten el umbral. Evidencia fechada y condición de re-medición en `design.md §4.4`. |
| **D8** | **QA2 desaparece** por dependencia: sin mitigación no hay corte que diseñar. |
| **D9** | **QA3 resuelto: el manifiesto SÍ lleva el dato, y la regla de la 148 se reformula.** Textual del humano: *"cada que un dato de una orden es agregado, este dato también debe aparecer en los manifiestos, y el número de intentos es un dato propio de una orden"*. Los R2/R11 de la feature 148 **no** significan "exactamente 11 columnas" sino "el manifiesto lleva los datos de su tabla": quedan **derogados y reformulados** (ver `design.md §6.3`). |

## Contexto verificado contra el código de la rama

- El conteo **existe** y es la fuente de verdad:
  `OrdenHistorialService.contarIntentos` (`lib/services/OrdenHistorialService.ts:56-68`)
  → `OrdenHistorialRepository.contarPorDestinoVigentes`
  (`lib/repositories/OrdenHistorialRepository.ts:92-108`). Lo que cambia es el
  **criterio**, no la existencia del derivador.
- Sus DOS consumidores actuales: `DevolucionSlaService.ts:110` (cron SLA,
  feature 99) y `OrdenHistorialService.ts:51` (drawer de historial, feature 47).
- Hay **dos** caminos a `reprogramada` en el mapa cerrado de la feature 140
  (`lib/types/order-status-transiciones.ts:86` y `:106`), y **solo uno es una
  visita real**: `#13` `en_reparto → reprogramada` (familia `gestion`, mensajero)
  sí; `#22` `devuelta → reprogramada` (familia `reprogramacion_tienda`,
  adminTienda) no.
- **Verificado que `#22` sería doble conteo:**
  `GestionOrdenRepository.reprogramarDesdeDevuelta` (`:384-443`) **NO anula** la
  gestión `devuelta` previa; esa fila sigue vigente y sigue contando.
- `db/schema.prisma:1152` ya declara `@@index([ordenId, estatusDestinoId])`.
  `orden_historial_estado` tiene RLS habilitada sin policies (solo service-role)
  y es append-only e inmutable.
- El umbral vive en `reintentosConfig.MIN_INTENTOS_ENTREGA`
  (`lib/config/reintentos.ts`, env `REINTENTOS_MIN_INTENTOS`, default **3**) y
  **no** está en el bundle del cliente.
- **La feature 154 ya está implementada y verde** en otra rama (catálogo 18 → 20,
  con `por_recolectar_en_tienda` e `incidente`, este último TERMINAL y **sin
  salidas**). Nada de este spec asume que `incidente` transite a algo.

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

**R3 — `incidente` no cuenta y no transita.** El sistema NO DEBE contar como
intento ninguna transición cuyo destino sea `incidente`, NO DEBE declarar
ninguna transición de salida desde `incidente`, y NO DEBE declarar, referenciar
ni dejar preparado ningún estado que lo desterminalice.

**R4 — Criterio ÚNICO y compartido.** El sistema DEBE producir, para una misma
orden, EXACTAMENTE el mismo número de intentos en las tres lecturas que lo
consumen: la regla de reintento-vs-escalado del cron SLA, el badge del drawer de
historial y el dato de cualquier superficie. El sistema NO DEBE admitir una
segunda definición de "intento vigente".

**R5 — Vigencia conservada.** El sistema DEBE seguir excluyendo del conteo (a)
las transiciones causadas por una gestión ANULADA y (b) las transiciones de la
familia gestión cuyo enlace a la gestión está vacío (huérfanas), y DEBE seguir
contando las que nunca vinieron de una gestión. El historial NO DEBE
modificarse: la exclusión es un filtro de LECTURA.

**R6 — Degradación segura sin catálogo.** SI el estado `devuelta` no existe en el
catálogo, ENTONCES el sistema DEBE reportar 0 intentos para toda orden y NO DEBE
fallar la lectura. SI existe `devuelta` pero no `reprogramada`, ENTONCES el
sistema DEBE contar únicamente la rama (a) de R1 y NO DEBE fallar.

**R7 — Sin estado persistido nuevo y sin migración.** El sistema NO DEBE
introducir columnas de base de datos, tablas, enums, índices ni migraciones para
sostener este conteo: sigue derivándose del historial en tiempo de lectura.

---

## Grupo B — Efecto sobre el escalado y sobre el historial

**R8 — El escalado usa el criterio nuevo.** CUANDO el cron SLA evalúa una orden
que reposa en `devuelta` con causa `not_found` y su ventana vencida, el sistema
DEBE comparar contra el umbral configurable el conteo definido en R1.

**R9 — El resto del cron no cambia.** El sistema NO DEBE alterar, respecto del
comportamiento vigente: qué órdenes son candidatas del cron, las ventanas por
causa, el escalado directo de `wrong_number`/`wrong_address`, la idempotencia por
guarda de estado, la resiliencia por orden ni el destino de la liberación.

**R10 — El drawer de historial refleja el mismo número.** CUANDO un actor
autorizado abre el historial de una orden, el sistema DEBE mostrar el conteo
definido en R1 y el umbral configurable, con las mismas reglas de visibilidad que
ya aplica.

---

## Grupo C — Exposición del conteo (backend)

**R11 — Conteo expuesto por superficie.** El sistema DEBE exponer el número de
intentos de entrega de cada orden en el resultado de cada lectura que alimenta
una superficie del inventario de R22–R28.

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
el campo DEBE seguir compilando y renderizando.

---

## Grupo D — Presentación: un dato más de la orden

**R17 — En tablas, columna propia.** DONDE una superficie muestra órdenes en una
tabla, el sistema DEBE mostrar los intentos de entrega en una **columna propia**
con encabezado "Intentos", y NO DEBE mostrarlos como marcador incrustado dentro
de la celda de otra columna.

**R18 — Fuera de tablas, dato etiquetado.** DONDE una superficie muestra una
orden sin tabla (card, elemento de lista o diálogo), el sistema DEBE mostrar los
intentos como un **dato etiquetado** ("Intentos: N") con el mismo tratamiento
visual y la misma jerarquía que los demás campos de esa superficie.

**R19 — El valor SIEMPRE se muestra, incluido el cero.** El sistema DEBE mostrar
el número de intentos en toda fila y toda superficie del inventario, incluido el
valor `0`, y NO DEBE dejar la celda vacía, ni sustituirla por un marcador de dato
ausente, ni omitir el dato etiquetado. SI el conteo no viajara en el dato de
entrada, ENTONCES el sistema DEBE mostrar `0`.

**R20 — Sin umbral.** El sistema NO DEBE mostrar el umbral de reintentos ("de N")
en ninguna superficie del inventario, y NO DEBE enviar el umbral al cliente en
ninguna de ellas.

**R21 — Integridad de las columnas existentes.** CUANDO el sistema agrega la
columna "Intentos" a una tabla, DEBE conservar los identificadores, los
encabezados y el orden relativo de todas las columnas preexistentes, y DEBE
insertar la columna nueva en una posición fija y determinista.

**R22 — Listado de órdenes y sus variantes.** DONDE se muestra una orden en el
listado plano de órdenes, en la variante de columnas de la pestaña
`reprogramada`, en el dashboard del adminTienda o en cualquier apartado de la
revisión del maestro, el sistema DEBE mostrar la columna "Intentos" con las
reglas de R17, R19, R20 y R21.

**R23 — Diálogos de acción por lote.** DONDE un diálogo de acción por lote lista
las órdenes seleccionadas, el sistema DEBE mostrar el dato etiquetado junto a
cada orden listada con las reglas de R18, R19 y R20.

**R24 — Portal del mensajero.** DONDE se muestra una orden del portal del
mensajero —en la card de "por gestionar", en la lista de "por recoger" y en el
detalle de la orden— el sistema DEBE mostrar el dato etiquetado con las reglas de
R18, R19 y R20.

**R25 — Recepción satélite.** DONDE se muestra una orden en un grupo del módulo
de recepción satélite presentado como tabla, el sistema DEBE mostrar la columna
"Intentos" (R17, R21); DONDE el grupo se presenta como cards, DEBE mostrar el
dato etiquetado (R18). En ambos casos aplican R19 y R20.

**R26 — Novedades de la tienda.** DONDE se muestra una orden en la lista de
novedades o en la lista de rechazadas por plazo vencido, el sistema DEBE mostrar
el dato etiquetado con las reglas de R18, R19 y R20.

**R27 — Aviso de liberadas hoy.** DONDE se muestra una orden en el aviso
"Liberadas hoy (reprogramación)" de una bodega, el sistema DEBE mostrar el dato
etiquetado con las reglas de R18, R19 y R20.

**R28 — El manifiesto refleja los datos de la orden.** Esta regla **deroga y
reemplaza** los R2/R11 de la feature 148 ("EXACTAMENTE las 11 columnas pedidas"),
por decisión del humano del 2026-07-29:

- (a) CUANDO el sistema genera el manifiesto, DEBE emitir el número de intentos
  de entrega de cada orden como una columna del archivo, con valor numérico `0`
  para las órdenes sin intentos (celda con `0`, no celda vacía).
- (b) El conjunto de columnas del manifiesto DEBE ser un conjunto ABIERTO: ni el
  código ni sus pruebas DEBEN afirmar que el manifiesto tiene un número cerrado
  de columnas. Las pruebas DEBEN verificar que ciertas columnas ESTÁN presentes,
  con su clave y su orden relativo, no que no existan otras.

---

## Grupo E — Límites y no regresión

**R29 — El dato no es ordenable ni filtrable en el servidor.** El sistema NO DEBE
aceptar el número de intentos como criterio de ordenamiento ni como filtro en las
lecturas paginadas: es un valor derivado en tiempo de lectura y no una columna de
la orden. SI una entrada externa lo solicitara como orden o filtro, ENTONCES el
borde DEBE rechazarla con el mismo error que cualquier campo no admitido.

**R30 — No se expone en la vista del paquete ni en la etiqueta.** El sistema NO
DEBE exponer el conteo de intentos en la página de detalle del paquete a la que
apunta el QR ni en la etiqueta de guía imprimible.

**R31 — No se expone en el contrato público de integradores.** El sistema NO DEBE
agregar el conteo de intentos a los DTO ni a la documentación de la API por llave
de integración.

**R32 — Sin regresión de los listados.** Todas las superficies afectadas DEBEN
conservar su paginación, su orden, su selección por lote y el resto de su
contenido sin cambios observables más allá del dato nuevo.

---

## Trazabilidad R → test

Mapa **COMPLETADO con rutas reales** al cerrar la implementación (T25). Los
requisitos de backend se detallan en `progress/impl_160_backend.md §2`; los de
frontend, en `progress/impl_160_frontend.md §2`. Ningún requisito queda sin dueño.

| Req | Test real |
| --- | --- |
| R1  | `tests/unit/repositories/orden-historial-repository.test.ts` (bloque "160/R1…"); `tests/unit/types/criterio-intento-entrega.test.ts` |
| R2  | `orden-historial-repository.test.ts` ("160/R2…"); `criterio-intento-entrega.test.ts`; `tests/unit/services/devolucion-sla-service.test.ts` ("160/R2/R8…") |
| R3  | `orden-historial-repository.test.ts` ("160/R3…"); `criterio-intento-entrega.test.ts` ("R3…", "D3…") |
| R4  | `tests/unit/services/intentos-entrega-criterio-unico.test.ts` (suite entera); `orden-historial-repository.test.ts` ("R4…"); `tests/unit/services/orden-historial-service.test.ts` ("R4…") |
| R5  | `orden-historial-repository.test.ts` ("R24…", "160/R5…", "R26…", "R25…"); `intentos-entrega-criterio-unico.test.ts` ("160/R5…") |
| R6  | `orden-historial-service.test.ts` ("160/R6…"); `orden-historial-repository.test.ts` ("160/R6…") |
| R7  | `./init.sh` verde + `git diff --name-only -- db/` vacío (verificado en ambas fases) |
| R8  | `devolucion-sla-service.test.ts` ("160/R8…"); `intentos-entrega-criterio-unico.test.ts` ("160/R8…") |
| R9  | `devolucion-sla-service.test.ts` ("160/R9…") + resto de la suite del cron sin cambios de aserción |
| R10 | `orden-historial-service.test.ts` ("160/R10…"); `intentos-entrega-criterio-unico.test.ts` |
| R11 | `orden-service.test.ts`, `mis-asignaciones-service.test.ts`, `recepcion-satelite-service.test.ts`, `NovedadesService.test.ts`, `rechazos-sla-tienda-service.test.ts`, `liberacion-reprogramada-action.test.ts`, `manifiesto-service.test.ts` (bloques "R11/R14…") |
| R12 | `orden-historial-repository.test.ts` ("R12…"); `orden-historial-service.test.ts` ("R12…"); `intentos-entrega-criterio-unico.test.ts` ("R12…") + un "R12" en cada uno de los 7 servicios |
| R13 | `orden-historial-repository.test.ts` ("R13…"); `orden-historial-service.test.ts` ("R13…") + un caso de lote vacío por servicio |
| R14 | Los mismos de R11 (todos asertan el `0` explícito); `manifiesto-service.test.ts` ("…emite `0`, no `null` ni celda vacia") |
| R15 | `orden-service.test.ts` ("R15…") y equivalentes por rol/zona/tienda en los otros 5 servicios |
| R16 | `tests/unit/types/intentos-no-alcance.test.ts` + `pnpm run typecheck` verde con los fixtures preexistentes sin el campo |
| R17 | `tests/unit/components/intentos-entrega.test.tsx` ("columnaIntentos — R17…"); `tests/unit/components/ordenes-columns.test.tsx` ("R17: la tabla monta un columnheader 'Intentos'", "R17: el numero NO se incrusta en la celda de estado"); `tests/components/RecepcionSateliteModule.test.tsx` (3 grupos de tabla); `tests/components/GenerarGuiaModal.test.tsx` |
| R18 | `intentos-entrega.test.tsx` ("IntentosDato — R18…"); `AsignarBodegaModal.test.tsx`, `RutearSateliteModal.test.tsx`, `RecuperarABodegaModal.test.tsx`, `DevolverATiendaModal.test.tsx`, `MisAsignacionesModule.test.tsx`, `RecepcionSateliteModule.test.tsx`, `NovedadesModule.test.tsx`, `RechazosSlaModule.test.tsx`, `BodegaLiberadasHoy.test.tsx` |
| R19 | `intentos-entrega.test.tsx` ("valorIntentos — R19…"); y en **cada** superficie un caso con `0` y otro con el campo AUSENTE (ver `progress/impl_160_frontend.md §2`) |
| R20 | `intentos-entrega.test.tsx` ("R20 — el umbral NO viaja al cliente…", incluida la guarda de fuente del módulo); casos "R20" en `ordenes-columns.test.tsx`, `GenerarGuiaModal.test.tsx`, `AsignarBodegaModal.test.tsx`, `MisAsignacionesModule.test.tsx`, `BodegaLiberadasHoy.test.tsx` |
| R21 | `ordenes-columns.test.tsx` ("R21: la columna nueva va JUSTO DESPUES de `estatus`…", "R21: ids, encabezados y orden relativo de las 18 preexistentes, intactos"); los tres asserts vigentes de `ordenes-columns.test.tsx` (hoy `:116-119`; `:113-117` cuando se escribió el spec, corridos por el import nuevo) siguen verdes **sin tocarlos**; `RecepcionSateliteModule.test.tsx` ("R21/R32: el badge 'Prioritaria' sigue en la celda de Nº Guía") |
| R22 | `ordenes-columns.test.tsx` ("R22: las tres variantes derivadas heredan la columna…"); `tests/components/OrdenesPage.test.tsx`, `AdminTiendaDashboard.test.tsx`, `OrdenesModuleReuse.test.tsx`, `OrdenesRevisionMaestro.test.tsx` ("R22: cada apartado del maestro monta la columna…") |
| R23 | `AsignarBodegaModal.test.tsx`, `RutearSateliteModal.test.tsx`, `RecuperarABodegaModal.test.tsx`, `DevolverATiendaModal.test.tsx` (dato etiquetado) y `GenerarGuiaModal.test.tsx` (columna: **es tabla**, no lista). `EtiquetasGuiaModal.test.tsx` fija la EXCLUSIÓN por R30 (ver discrepancias en `progress/impl_160_frontend.md §3`) |
| R24 | `MisAsignacionesModule.test.tsx` (bloque "intentos de entrega (feature 160)": card POS, detalle plegado y "por recoger") |
| R25 | `RecepcionSateliteModule.test.tsx` (bloque "intentos de entrega (feature 160)": 3 tablas + 2 grupos de cards) |
| R26 | `NovedadesModule.test.tsx` y `RechazosSlaModule.test.tsx` (bloques "intentos de entrega (feature 160)") |
| R27 | `BodegaLiberadasHoy.test.tsx` (bloque "intentos de entrega") + los DOS montajes: `RecepcionSateliteModule.test.tsx` y `OrdenesRevisionMaestro.test.tsx` |
| R28 | `tests/unit/utils/manifiesto-xlsx.test.ts` ("R28a…", "R28b…"); `tests/unit/services/manifiesto-service.test.ts` |
| R29 | `tests/unit/types/intentos-no-alcance.test.ts` (`sortBy` y `filter` rechazados) |
| R30 | `intentos-no-alcance.test.ts` (contrato `EtiquetaGuiaDTO`); `tests/components/EtiquetaGuia.test.tsx` ("R30: no expone el conteo"); `EtiquetasGuiaModal.test.tsx`; `tests/unit/components/intentos-no-alcance-ui.test.ts` (guarda de fuente de la vista del paquete, la etiqueta y el PDF) |
| R31 | `intentos-no-alcance.test.ts` (guarda sobre `openapi-spec` + tipos `ApiOrden*`) |
| R32 | Las suites completas de las 12 superficies, verdes. Los cambios de aserción —5 en total, todos por el dato nuevo— están enumerados uno a uno en `progress/impl_160_frontend.md §3` |

## Preguntas abiertas

**No queda ninguna bloqueante.** QA1 y QA3 se resolvieron el 2026-07-29 (D7 y D9);
QA2 desapareció por dependencia (D8).

Siguen abiertas, **no bloqueantes**, con recomendación razonada en
`design.md §8`:

- **QA4 — Vista del paquete (QR) y etiqueta imprimible.** *Recomendación: NO*
  (R30). La vista del paquete es accesible a **cualquier rol autenticado**, no
  solo al alcance de la orden.
- **QA5 — API pública de integradores.** *Recomendación: NO en esta feature*
  (R31). Es contrato externo y ya se rompió sin aviso dos veces esta semana.
- **QA6 — Cierre del día y cierres de admin.** *Recomendación: NO.* Su grano es
  la GESTIÓN, no la orden, y es un documento de dinero congelado.
- **QA7 — Filas legadas con destino `reprogramada` y origen distinto de
  `gestion`.** El criterio de R1 es por INCLUSIÓN, así que quedan fuera.
  *Recomendación: mantenerlo así* — contar de menos retrasa el escalado
  (inofensivo); contar de más cobra un rechazo antes de tiempo.

### Nueva, abierta por el cambio a columna (no bloqueante)

- **QA8 — Ordenamiento y filtrado del dato nuevo.** R29 lo declara **no
  ordenable ni filtrable** en el servidor, porque es derivado y el `ORDER BY` del
  listado usa una lista blanca de columnas reales de `orden`
  (`OrdenRepository.SORT_COLUMN`, `:143-147`: solo `createdAt`, `numGuia`,
  `numRemision`). Las features **144** (filtros, en vuelo en el PR #180) y **151**
  (export server-side) tendrán que decidir si una columna visible pero no
  ordenable es aceptable en su contrato. *Recomendación: aceptarlo como límite
  declarado ahora y resolverlo en la 144/151, no aquí* — materializarlo exigiría
  migración y reintroduciría el drift que `design.md §7.4` descarta.
