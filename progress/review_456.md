# 456 — Revisión independiente (reviewer, 2026-09-24)

Rama revisada: `origin/feature/456-tooltip-estados` @ `e4339fe0` (merge-base con dev: `cca58a2f`), en
`checkout --detach` sobre un worktree propio. `.env` copiado sin imprimir, `node_modules` por junction,
`prisma generate` hecho. Búsqueda: `grep` + lectura de archivos + la guardia de la ficha (el MCP
`codebase-memory` no se usó: el implementador ya documentó que el índice está rancio para estos
archivos, y todo lo afirmado aquí se midió en el archivo real o ejecutando).

## Veredicto: **APROBADO** (sin bloqueantes; 5 hallazgos menores; conviene cerrar los 3 primeros antes de la release)

## Checklist

| Punto | Resultado |
|---|---|
| requirements / design (con alternativas §10) / tasks existen | OK |
| Tasks T0.1–T4.3 marcadas `[x]` (T5.1 es esta revisión, T6.1 la release) | OK |
| Trazabilidad R1–R37 → test que existe y pasa (tabla abajo) | OK, con el mapa de `tasks.md` desactualizado (menor 1) |
| Gate completo: `progress/gate_456.log` sobre `cff0b6d6` (= código de `e4339fe0`): 2176/2176 archivos, 30 816 tests, 26 skipped (los de la 455), `INIT_EXIT=0` | OK (no repetido entero, por orden del coordinador) |
| Corrido por mí: 272 archivos / 4 115 tests (todos los tocados por la 456 + `tests/unit/guards` + `tests/unit/types` + `menu-visibility` + gráficas y wallet) | VERDE |
| `pnpm run typecheck` corrido por mí | VERDE |
| Textos: `DESCRIPCION_ESTADO` vs `textos-aprobados.md`, 20/20 literal + nota de ayuda | OK (leído a ojo fila por fila y ejecutado: el test lee el `.md` del disco y compara con `toBe`) |
| `textos-aprobados.md` sin editar por la ficha | OK (no está en el diff) |
| «Novedad» deriva sus plazos de `lib/config/devolucion-sla.ts` | OK — mutación `DIAS_RECHAZO_AUTOMATICO: 7` → ROJO en la fila aprobada; el caso «usa la configuración» sigue verde (el texto mostrado sí cambió con el config: R5 en sus dos mitades) |
| RLS / migraciones / secretos / webhooks | No aplica: ficha solo de frontend, sin tablas, sin migraciones, sin secretos |
| Capas | OK: `EstadoInfo.tsx` es presentación pura (sin fetch, R29 con test) y la fuente vive en `lib/types` |
| Hardcode de país/moneda | No aplica |
| E2E | No aplica (no toca flujos críticos; sin harness E2E, ver memoria); el riesgo se cubrió con el recorrido Playwright de `progress/recorrido_456.md` |
| Descargas (R17) | OK: ningún archivo `*-descarga-columnas` cambió; la `DataTable` descarga por `descarga.columnas`, no por `render` |

## Trazabilidad R → test (verificado contra los archivos reales)

| R | Test real (archivo › caso) |
|---|---|
| R1 | `tests/unit/types/descripcion-estado.test.ts` › «R1 — 20 estados, 20 explicaciones» |
| R2 | idem › «R2/R5 — «%s»: la explicación es la fila de la tabla aprobada» (20 casos, lee el `.md`) + `EstadoInfo.test.tsx` (20 casos, texto en el diálogo) |
| R3 | typecheck (mutación: borrar `incidente` de `DESCRIPCION_ESTADO` → `tsc` EXIT=2, TS1360) + `descripcion-estado` › «R3 — 19 claves no compilan» (`@ts-expect-error`) |
| R4 | `descripcion-estado` › «R4/R5 — «Novedad» usa los plazos de la configuración» |
| R5 | idem + fila aprobada (mutación a 7 días: ROJO) |
| R6 | `descripcion-estado` › «R6 — «Novedad» no da el número de intentos» |
| R7 | `EstadoInfo.test.tsx` › «R7 — el texto no depende de la superficie» |
| R8 | `descripcion-estado` › «R8 — la nota de ayuda es igual a la sección «Pendiente de visto bueno»» |
| R9 | `EstatusBadgeInfo`, `HistorialOrdenTimelineInfo`, `PosOrderCardInfoEstado` (3 vistas), `SateliteOrderCardInfo`, `IncidentesAdminModule` › «456», `GestionarOrdenPanelTope` › «456», `ChatConversacionLlamada` › «456», `CierreFacturaSinGestionar` › «456 R9/R15», `RastreoDialogInfoEstado`, `detalle-columnas` › «R9» |
| R10 | `detalle-columnas` › «R10 — el resultado lleva su botón»; `HistorialOrdenTimelineInfo` › «R10»; `EstadoInfo` › «InfosEstado» |
| R11 | `EstadoInfo` › «SenalPendienteConInfo» (5 resultados); `NotaGestionPendiente` › «456»; `RastreoDialogInfoEstado` › «R11» |
| R12 | `EstadoInfo` › «la nota de ayuda…»; `PosOrderCardInfoEstado` › «R12»; `HistorialOrdenTimelineInfo` › «R12»; `NotaGestionPendiente` › «456» |
| R13 | `MultiSelectFilterInfoEstado` › «R13 — cada opción…», «con UN estado», «con VARIOS estados» |
| R14 | `ConteoPorStatusDonaInfo` › «R14/R37»; `EstadoInfo` › «LeyendaEstadosConInfo» |
| R15 | `EstadoInfo` › retirados/desconocidos (4 casos); `EstatusBadgeInfo` › «R15»; `HistorialOrdenTimelineInfo` › «R15»; `RastreoDialogInfoEstado` › «R9/R11/R15»; `descripcion-estado` › «R15» |
| R16 | `NoRegresion456` › contadores; `NovedadesTabs` › «456»; `CierreFacturaSinGestionar` › «R16/R30»; guardia › «(extra) nombre en un ATRIBUTO» |
| R17 | tests de columnas de descarga existentes, sin editar y verdes (ningún archivo de descarga en el diff) |
| R18 | `tests/unit/guards/estado-con-info.guardia.test.ts` › brazos (a)–(d) + anti-vacío |
| R19 | idem › «mutaciones sintéticas» 1–5, 4b y dos extra |
| R20–R22, R25, R29 | `EstadoInfo.test.tsx` › «la interacción» |
| R23, R24 | `EstadoInfo.test.tsx` › 20 estados (nombre accesible y diálogo con nombre/descripción) + señal/nota |
| R26 | `EstadoInfo.test.tsx` › «R26/R27/R33 — caja de 16 px, área 24 (after:-inset-1)» |
| R27 | `contraste-tokens.guardia.test.ts` (suelos 3:1 escritos) |
| R28 | `RastreoDialogInfoEstado` › «R28»; `EstadoInfo` › «R28» |
| R30 | `PosOrderCardInfoEstado` › «R30» (3 vistas); `ChatOrdenesListaInfoEstado` › «R30»; `SateliteOrderCardInfo` › «R30»; `NoRegresion456` › casilla; `CierreFacturaSinGestionar` › pestaña; `EstadoInfo` › «R30» |
| R31 | `MultiSelectFilterInfoEstado` › «R31» (botón, clic dentro del popup, Escape) |
| R32 | `EstatusBadgeInfo` (20 + clases); `ChatOrdenesListaInfoEstado` › «R32»; `EstatusBadge*` con aserciones de clase intactas |
| R33 | recorrido T4.3 (alturas antes/después en `impl_456.md`), como fija el spec |
| R34 | `MultiSelectFilterInfoEstado` › «R34» |
| R35 | `RastreoDialogInfoEstado` › «R35» |
| R36 | `rastreo-*` guardias y `menu-visibility` sin editar y verdes |
| R37 | `ConteoPorStatusDona.test.tsx` sin editar y verde (12/12) + `ConteoPorStatusDonaInfo` |

## Cobertura (mandato del humano: el botón en TODO lugar que muestra un estado)

- Barrido propio con `grep` de: los 20 nombres escritos como literal en `app/` y `components/`; los
  campos ya traducidos que llegan del servidor (`estadoNombre`, `resultadoNombre`, …: ninguno se pinta en
  `app/`); los usos de `nombreDeEstado`/`NOMBRE_ESTADO` en `lib/` (API, notificaciones, plantillas PDF,
  frase de cierre: ninguno llega a una pantalla sin pasar por un archivo clasificado); y los `{x.estatus}` /
  `{x.resultado}` en JSX (todos van ya por `EstatusBadge`/`EstadoConInfo`/`InfoEstado`, o son estados de
  otra cosa: cierre, API key, usuario, conciliación).
- Literales sin botón que quedan, todos fuera del alcance por el spec: título de sección «En reparto» del
  chat (`chat-contactos.ts:101`) y título de página «Por recolectar en tienda» (`RecoleccionModule.tsx:68`)
  son rótulos de GRUPO cuyas filas llevan cada una su chip con botón; «Novedad interna» en
  `catalogo-paneles.ts` es una métrica; la pestaña «Novedad» es recuento; `tarifas-labels` es un concepto de
  tarifa. Ver menor 5.
- Superficies extra del implementador, revisadas en código: registro de acciones (celdas «Valor
  anterior/nuevo» con `EstadoConInfo` cuando la acción guarda un resultado; la descarga sigue leyendo
  `valorLegible`), wallet y mi-wallet (línea de texto intacta + `InfosEstado` al lado, en escritorio y
  móvil) y dinero por producto (`Resultados` con `InfosEstado`). Correctas en pantalla. Protección contra
  regresión: el wallet SÍ cae (mutación X1); dinero por producto lo cubre el brazo (a), porque su versión previa pintaba `{valores.map(etiquetaDeDesenlace)…}` directo en JSX y ese símbolo es vigilado; el registro de acciones NO (X2, menor 2).
- Reverts de superficies reales a su versión previa a la 456 (la mutación más realista posible): cierres
  (`cierre-detalle-shared`, `CierreDiaModule`, `cierre-confirmacion-fisica`) → brazo (a); `detalle-columnas`,
  `SateliteOrdenesListado`, `ConteoEntregasAnillo` → brazos (a)(b)(c) + `detalle-columnas` R10.

## Tests ajenos modificados (`git diff cca58a2f e4339fe0 -- tests`)

Revisados uno a uno. Ninguna aserción de comportamiento se debilitó:
- `EstatusBadgeCatalogoV2/EnReparto/RetiroFulfillment`, `DetalleMensajeroPanel`: solo cambia el localizador
  (`firstElementChild` → `[data-slot="badge"]`); las aserciones de clase quedan iguales. El segundo cambio de
  `DetalleMensajeroPanel` sustituye el módulo esperado en el censo de importaciones (`estatus-label` →
  `EstadoInfo`), coherente con el cambio real.
- `PosOrderCard.estado-455`: `parentElement` → abuelo, por el envoltorio nuevo.
- `CierreFacturaSinGestionar` (R31 de la 264), `OrdenesExistentesTabla`, `PorRecibirModule`: las cuentas de
  botones descuentan SOLO los «Qué significa «…»», y a la vez exigen que ese botón EXISTA (no es un verde
  por vacío); cualquier otro control sigue prohibido o contado igual.
- `historial-correccion-dia.guardia`: la anti-vacuidad pasa de `estatusLabel` a `EstadoConInfo` (lo que
  pinta hoy la transición) y se AÑADE que la corrección tampoco lo use. Se endurece, no se afloja.
- `nombres-estado-retirados.guardia`: excepción por TEXTO EXACTO «sin gestionar» en `order-status.ts`
  (prosa del texto aprobado). La comparación es exacta y sensible a mayúsculas: «Sin gestionar» como nombre
  seguiría cayendo (test M m1 del propio archivo).
- Red 455 C16 (`snapshot-correccion`): solo cambia la EXTRACCIÓN (renderiza el elemento a markup y quita
  las etiquetas; el botón no tiene texto visible), la aserción literal es la misma. Correcto.

## C2b y la línea retirada del detector de Escape

Decisión CORRECTA. El comportamiento que la línea pretendía asegurar (Escape con la explicación abierta
cierra solo la explicación, no el panel) está fijado por `MultiSelectFilterInfoEstado` › «R31» (tras el
Escape afirma que el `listbox` sigue). Lo comprobé con una mutación propia: registrar el `keydown` del
filtro en fase de CAPTURA (antes de que Base UI consuma el Escape) → ese test cae en ROJO. Así que la
línea era código muerto y su ausencia no deja el requisito sin red: si Base UI deja de consumir el Escape
en una actualización, la suite lo dirá.

## Mutaciones propias (en secuencia, cada una revertida con `git checkout`; `git status` limpio tras cada una)

| Id | Mutación | Resultado |
|---|---|---|
| M1 | Fuente: «Fin del recorrido.» → «Fin del trayecto.» en `DESCRIPCION_ESTADO.devuelta_a_tienda` | ROJO: `descripcion-estado` (fila aprobada) + `EstadoInfo` (2) |
| M1b | Config: `DIAS_RECHAZO_AUTOMATICO: 7` | ROJO: fila aprobada de «Novedad» + `EstadoInfo` (2); el caso «usa la configuración» sigue verde (el texto sí siguió al config) |
| M1c | Tipo: borrar la clave `incidente` | ROJO: `tsc` EXIT=2 (TS1360 en el `satisfies`) |
| M2a | Guardia (a): revertir `cierre-detalle-shared`, `CierreDiaModule`, `cierre-confirmacion-fisica` a `cca58a2f` | ROJO: brazo (a), 4 líneas nombradas |
| M2b/c | Guardia (b)(c): revertir `detalle-columnas`, `SateliteOrdenesListado`, `ConteoEntregasAnillo` | ROJO: brazos (a)(b)(c) + `detalle-columnas` › R10 |
| M2d | Guardia (d): importar `Popover` en `contadores.ts` | ROJO: brazo (d) |
| M3a | Fila: quitar `onClick={cortarClick}` del DISPARADOR | ROJO: `EstadoInfo` › R30 (las superficies no caen porque el contenedor ya ignora clics nacidos en un `button`) |
| M3b | Fila: quitar `onClick={cortarClick}` del POPUP | ROJO: `PosOrderCardInfoEstado` › R30 en las 3 vistas + `EstadoInfo` › R30 |
| M4a | Filtro: quitar el detector de clic dentro del popup | ROJO: `MultiSelectFilterInfoEstado` › R31 |
| M4b | Filtro aplicado: `value.length === 1` → `>= 1` | ROJO: «con VARIOS estados… ningún botón» |
| M4c | Filtro: `keydown` del panel en captura (verifica C2b) | ROJO: `MultiSelectFilterInfoEstado` › R31 |
| M5 | Rastreo: quitar `superficie="landing"` del `EstadoConInfo` | ROJO: `RastreoDialogInfoEstado` › R28 |
| M6 | Pos-card mosaico: `codigo={orden.numRemision}` en vez de `estatusValue` | ROJO: 8 (6 de la 455 + 2 de la 456) |
| X1 | Wallet: revertir `DetalleMovimientoCierre.tsx` a `cca58a2f` | ROJO: guardia brazo (c) |
| **X2** | **Registro de acciones: revertir `historial-acciones-columnas.ts` a `cca58a2f`** | **VERDE — sobrevive** (menor 2) |

## Hallazgos

1. **menor — el mapa R → test está desactualizado.** La tabla de `tasks.md` cita archivos que no existen
   (`SenalPendienteConInfo.test.tsx`, `NotaAyudaConInfo.test.tsx`, `LeyendaEstadosConInfo.test.tsx`,
   `GestionarOrdenPanelInfo`, `IncidentesAdminInfo`, `CierreFacturaInfo`, `ChatConversacionInfo`,
   `DetalleColumnasResultadoInfo`): esos casos viven en `EstadoInfo.test.tsx` y en bloques «456» de los
   tests existentes. Y `impl_456.md` no trae el mapa (CHECKPOINTS lo pide). Toda R tiene test real (tabla de
   arriba, que puede copiarse), pero el mapa escrito no sirve para encontrarlo.
2. **menor (cerrar antes de la release) — la guardia no ve un nombre pintado a través de un helper que no
   está en `SIMBOLOS_VIGILADOS`.** Medido (X2): con `historial-acciones-columnas.ts` devuelto a su versión
   previa (`render: (fila) => valorLegible(…)`, sin botón), la guardia y todos los tests siguen verdes. El
   brazo (a) solo reconoce el símbolo vigilado DIRECTO en el `render`, y el archivo está en
   `USOS_PERMITIDOS` como `descarga` con un motivo («la celda de pantalla usa `EstadoConInfo`») que nadie
   comprueba. R18 se cumple a la letra (hay excepción con motivo), pero la superficie extra queda sin red.
   Arreglo mínimo: un test de componente de las celdas «Valor anterior/nuevo» (botón presente con una
   acción de corrección de resultado, ausente con otra acción), y/o sumar `valorLegible` a los símbolos
   vigilados (hoy la llaman `celdaValor`, dentro de un bloque, y `historial-acciones-descarga-columnas.ts`, que se clasificaría como `descarga`; con eso el revert X2 caería por el brazo (a)).
3. **menor — `desenlaces-de-fila.ts` mal clasificado.** Figura como `control-con-hermano` con
   `hermanoEn: DineroProductoDetalle.tsx`, pero la frase que pinta («Entregado: 4 · …», columna «En qué
   terminaron» de `ProductosTabla`) no tiene botón al lado: el `InfosEstado` de `DineroProductoDetalle` es
   de OTRA lista (el detalle expandido, que solo existe si hay dinero). El brazo (c) queda satisfecho por un
   uso ajeno. Lo que pinta es un rótulo de recuento (nombre + cifra que agrega varias órdenes): debería ir
   como `recuento`, con ese motivo. Sin cambio visible; es honestidad de la lista de excepciones.
4. **menor — `docs/ayuda/mensajero/*.md` (O7 del repaso de la 455)** entra en esta rama sin relación con la
   456. Cambio de texto pequeño y correcto; solo se anota por alcance.
5. **menor (informativo) — rótulos de grupo con nombre de estado sin botón**: sección «En reparto» del chat
   y título «Por recolectar en tienda» de `/recoleccion`. Son etiquetas de grupo cuyas filas ya llevan su
   botón; el spec excluye las etiquetas de grupo y no las fuerza. Mismo patrón que los recuentos: si el
   humano los quiere, se usa `InfoEstado` junto al título, como ya se hizo en las secciones de los cierres.

## Puntos «Abierto» para presentar al humano (T5.1)

1. **Visto bueno del texto de la nota de ayuda** (R8): «El mensajero pidió ayuda a la tienda con esta
   entrega. El paquete sigue en reparto hasta que se registre su gestión.» Hoy se usa, marcado como
   pendiente en `DESCRIPCION_NOTA_AYUDA`. Según `tasks.md` T6.1, no sale a `prod` sin ese visto bueno.
2. **Resultado sin aprobar con la explicación del estado ya confirmado** (R10): junto a una gestión
   pendiente («Resultado del día», secciones de un cierre sin aprobar), la explicación de «Entregado» dice
   «…y la bodega lo confirmó al aprobar el cierre», que todavía no ha pasado. Es lo que pidió la enmienda.
3. **Los rótulos de recuento y de grupo siguen sin botón** (decisión 4; hallazgo 5).
4. **ARIA del listbox del filtro**: axe marca `aria-required-children/parent` y `listitem`, las mismas tres
   en el filtro «Zona», que no tiene botones: son de antes de la 456 (medido por el implementador).

## Qué falta para `done`

Nada bloqueante. Recomendado antes de la release (T6.1), en la misma rama o en una de seguimiento: los
menores 1 a 3 (mapa R → test en `impl_456.md`, red del registro de acciones, reclasificar
`desenlaces-de-fila`). La entrada de `progress/history.md` la añade el leader al cerrar.
