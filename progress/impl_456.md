# 456 — Bitácora de implementación (frontend_dev, 2026-09-24)

Rama `feature/456-tooltip-estados`, nacida de `cca58a2f` (dev con la 454 y la 455 mergeadas).
Base local compartida `ordenex` (`prisma migrate status` → al día). `.env` copiado sin imprimir;
`node_modules` por junction; `prisma generate` hecho. Búsqueda: MCP `codebase-memory` (proyecto
`R-job-singularis-projects-ordenex`) para ubicar los componentes; **el índice está rancio** (daba a
`EstatusBadge` la prop `zonaNombre`, retirada por la 455), así que todo se confirmó en el archivo y el
barrido de símbolos se hizo con `grep` + la guardia nueva en modo informe.

## T0.1 — Base

- `NOMBRE_ESTADO`, `nombreDeEstado`, `nombreDeResultado`, `SENAL_PENDIENTE` y los 20 códigos de la 455:
  presentes en `lib/types/order-status.ts` y `lib/types/gestion-resultado.ts`.
- Señal de pendiente y nota de ayuda: `components/shared/nota-pendiente-confirmacion.ts`
  (`textoPendienteConfirmacion`, `NOTA_AYUDA_SOLICITADA`), pintadas por `NotaGestionPendiente.tsx`,
  la línea de tiempo, las tarjetas del mensajero (`RepartoModule`) y el rastreo.
- G4 de la 455 (`nombre-estado-catalogo.test.ts`) ya corta el `.md` en «## Validado contra el código»:
  la tabla nueva de la nota no la afecta. Sin cambio.

## Reconciliaciones con el código real (ninguna cambia el alcance)

- **R-456-1 · Códigos.** El spec se escribió con los códigos viejos; se usan los de la 455 (`entregado`,
  `reprogramado`, `novedad`, `devolucion_a_origen_por_rechazo`, `novedad_interna`,
  `mensajero_recogiendo_en_bodega`, `por_devolver_a_bodega_central`). `DESCRIPCION_ESTADO` es
  `satisfies Record<OrderStatusValue, string>` sobre esas claves.
- **R-456-2 · Rastreo.** Ya publica nombres (455/R31) y marca `pendiente`: el cliente traduce con
  `codigoDeNombre` (design DF); la respuesta no cambia (R36).
- **R-456-3 · G2 de la 455 y el texto aprobado.** La explicación aprobada de «Novedad interna» dice «sin
  gestionar el paquete»; G2 caza la frase retirada «sin gestionar». La tabla aprobada no se edita: se
  añadió «sin gestionar» a la excepción por TEXTO de `lib/types/order-status.ts` en
  `nombres-estado-retirados.guardia.test.ts`, con nota fechada.
- **R-456-4 · `SenalPendienteConInfo` recibe `OrderStatusValue`** (no `GestionResultado`): desde la 455 el
  resultado ES un código de estado y el rastreo solo tiene el código que sale de `codigoDeNombre`.
- **R-456-5 · Símbolos vigilados.** La 455 dejó alias (`estatusLabel`, `ORDER_STATUS_LABELS`,
  `resultadoLabel`, `notaGestionPendiente`, `RESULTADO_LABEL`, `RESULTADO_FILA_LABEL`,
  `etiquetaDeDesenlace`, `chipDeEstado`, `etiquetaEstado`, `textoPendienteConfirmacion`,
  `NOTA_AYUDA_SOLICITADA`): la guardia los vigila todos. Los módulos que DEFINEN alias se clasifican con la
  clase de su uso y el motivo lo dice.
- **R-456-6 · Cierres.** En `cierre-factura` las filas de gestión NO pintan su resultado (lo dice la
  pestaña, recuento §5.2): no hay «resultado por fila» que botonear ahí. Llevan botón: el origen de cada
  orden barrida, cada fila de la confirmación física (su `Badge` de resultado) y, junto al TÍTULO (fuera
  del `<h4>`/`<h2>`), las secciones «<resultado> (N)» de `cierre-detalle-shared` (admin y SF-001) y del
  cierre del mensajero (`CierreDiaModule`), cuyas filas tampoco repiten el resultado.
- **R-456-7 · Superficies extra halladas por la guardia:** celdas «Valor anterior/nuevo» del registro de
  acciones (corrección de resultado), resultados por orden en el detalle de movimientos del wallet
  (`/wallet`, `/mi-wallet`) y la lista de resultados del detalle de dinero por producto: línea de texto
  intacta + botones al lado (`InfosEstado`, pieza nueva).
- **R-456-8 · Nota de ayuda en las tarjetas.** `RepartoModule` pasaba `nota={NOTA_AYUDA_SOLICITADA}`; las
  tarjetas ganan `notaAyuda` (booleano) y pintan `NotaAyudaConInfo`. `/novedades` NO pinta la nota de
  ayuda (su pestaña de ayuda usa la nota «Esperando tu respuesta»); sus tarjetas heredan el chip.
- **R-456-9 · Tarjeta «completa»** (`PosOrderCard`/`PosCardHeader`) no está montada en ninguna pantalla
  hoy; se convirtió igual (tests) y las alturas se midieron en «mosaico» y «detalle», las dos reales.
- **R-456-10 · Densidad (R33).** En la vista «detalle» del mensajero a 390 px el chip más largo («Mensajero
  recogiendo en la bodega») tenía 3 px de holgura: con el botón al lado se partía en dos líneas (95 → 108,5
  px). Arreglo: `EstadoConInfo botonFlotante` (botón superpuesto en la esquina del chip, sin caja), solo en
  esa vista. Medido después: 95 px.
- **R-456-11 · Filtro y Escape.** Base UI consume el Escape del popover antes de que llegue a `document`: el
  «si hay explicación abierta, no cierres el panel» del diseño era código muerto (mutación C2b sobrevivía en
  jsdom) y en el navegador, SIN esa línea, Escape cerró solo la explicación. Se quitó. El detector de clic
  fuera (`data-slot="estado-info-popup"`) SÍ hace falta (C2 roja).
- **R-456-12 · Tests ajenos retocados (sin tocar aserciones de texto ni de clase), todos con nota fechada:**
  `EstatusBadgeCatalogoV2/EnReparto/RetiroFulfillment` y `DetalleMensajeroPanel` (el `Badge` se localiza
  por `data-slot` en vez de `firstElementChild`); `PosOrderCard.estado-455` (`parentElement` → abuelo);
  cuentas de botones reescritas descontando «Qué significa «…»» en `CierreFacturaSinGestionar` (R31 de la
  264), `PorRecibirModule` (R5) y `OrdenesExistentesTabla`; `historial-correccion-dia.guardia` (el
  anti-vacío de la transición busca `EstadoConInfo`, y la corrección no puede usarlo);
  `DetalleMensajeroPanel` (el módulo de columnas importa `EstadoInfo`).
- **O7 (repaso 455):** `docs/ayuda/mensajero/cierre-del-dia.md` «la marcaste como Entregado» y
  `docs/ayuda/mensajero/recoleccion.md` «no corresponde a ningún paquete que tengas que recolectar».
- **Texto de la nota de ayuda: PENDIENTE DE VISTO BUENO DEL HUMANO** (se usa el de `textos-aprobados.md`,
  marcado así en `DESCRIPCION_NOTA_AYUDA`).

## T0.2 — Prueba de concepto (Playwright, Chromium, 390×844 `hasTouch`, `tap()`; página desechable borrada)

| Caso | Resultado |
|---|---|
| (a) fila de tabla | tap abre, sigue abierto a 1,2 s, tap fuera cierra, segundo tap cierra, casilla intacta |
| (b) tarjeta con clic | tap abre; tocar el texto: 0 selecciones CON corte; SIN corte (contrafactual) 2 selecciones; tocar la tarjeta sí selecciona |
| (c) `Dialog` del rastreo | tap abre, popup con `tema-claro`, tocar el popup no cierra el diálogo, Escape cierra solo el popup |
| (d) opción del filtro | tap abre, no marca, tocar el popup no cierra el panel ni marca, Escape cierra solo el popup, la opción sigue marcando, filtro aplicado con botón |
| (e) leyenda bajo gráfica | tap abre (texto de «Novedad» con «a las 24 horas»), tap fuera cierra |
| Escritorio | hover abre y al salir cierra; Enter y Espacio abren; Escape cierra y devuelve el foco; abrir otro cierra el primero; caja 16×16 con `::after` −4 px (24×24) |

## T0.4 / T4.3 — Alturas (px), antes → después (mismas filas, por remisión)

| Pieza | Antes | Después |
|---|---|---|
| Fila de `/ordenes` (12 filas) | 57/77 | idénticas fila a fila |
| Fila «en bodega» satélite (8 filas) | 57/77/97/62 | idénticas |
| Opción del filtro de estado | 32 (Todos 37) | 32 (37) |
| Cabecera tarjeta mosaico (390 px) | 29 | 29 |
| Cabecera tarjeta detalle (390 px) | 95 | 108,5 → **95** tras R-456-10 |
| Opciones del filtro (nombres y orden) | 20 | idénticas |

## Mutaciones (arnés con autocomprobación: texto único, restauración byte a byte; `git diff` limpio)

Fuente (T1.2): M1.1 «5 días» a mano → ROJO `descripcion-estado` (R4/R5); M1.2 coma en «En preparación» →
ROJO (R2); M1.3 `DIAS_RECHAZO_AUTOMATICO: 7` → ROJO (fila aprobada de «Novedad»); M1.4 una palabra de la
nota → ROJO (R8).

| Id | Mutación | Resultado |
|---|---|---|
| G1 (T3.14) | `{nombreDeEstado(...)}` en vez de `EstadoConInfo` en `IncidentesAdminModule` | ROJO guardia (a)+(b) |
| G2 (T3.14) | sin `codigoEstado` en `opcionesEstado` | ROJO guardia (c) (y 5 de `MultiSelectFilterInfoEstado`) |
| C1 | popup sin `stopPropagation` | ROJO `PosOrderCardInfoEstado` (3 vistas) |
| C2 | filtro sin el detector de clic fuera | ROJO `MultiSelectFilterInfoEstado` |
| C2b | quitar el «si hay explicación, no cierres con Escape» | VERDE → código muerto, retirado (R-456-11) |
| C3 | una palabra de una explicación | ROJO `descripcion-estado` + `EstadoInfo` |
| C4 | `{estatusLabel(x)}` en la cabecera del panel del mensajero | ROJO guardia (a) |
| C5 | `ring-ring/50` en el botón | ROJO `EstadoInfo` + contraste |
| C6 | sin `tema-claro` en el popup de la landing | ROJO `RastreoDialogInfoEstado` |
| S1 | `/ordenes`: `EstatusBadge` sin `EstadoConInfo` | ROJO `EstatusBadgeInfo` (21) |
| S2 | historial: sin botón en el resultado | ROJO `HistorialOrdenTimelineInfo` |
| S3 | chat: sin el `InfoEstado` hermano | ROJO guardia (c) — la 1.ª vez SOBREVIVIÓ (contaba el import como hermano); arreglado y con caso sintético 4b |
| S4 | mosaico sin nota de ayuda | ROJO `PosOrderCardInfoEstado` |
| S5 | satélite con código no reconocido | ROJO `SateliteOrderCardInfo` |
| S6 | analítica sin leyenda propia | ROJO `ConteoPorStatusDonaInfo` |
| S7 | rastreo sin traducir nombre → código | ROJO `RastreoDialogInfoEstado` (4) |
| S8 | monitoreo «Resultado del día» como texto | ROJO `detalle-columnas` (2) |
| S9 | cierre: origen de barrida como texto | ROJO `CierreFacturaSinGestionar` (4) |
| S10 | señal de pendiente con el texto de «Entregado» | ROJO `EstadoInfo` (6) |

Guardia (R19): cinco fuentes sintéticas + 4b + dos extra, dentro del propio archivo.

## Contraste (T2.4, medido y escrito como suelo)

Icono `muted-foreground` peor superficie: claro 6,80 · oscuro 6,40. Anillo `ring` opaco: claro 3,68 ·
oscuro 5,57. Landing: `asfalto-5` 6,99 y anillo 3,78 sobre `kraft-inset`/`kraft-card`.

## Abierto (para el reviewer / humano)

- Visto bueno del texto de la nota de ayuda.
- Resultado sin aprobar con la explicación del estado (R10), como anticipaba el spec.
- ARIA del listbox: axe marca `aria-required-children`, `aria-required-parent` y `listitem` en el panel
  del filtro de estado… y **las mismas tres** en el filtro «Zona», que no lleva botones: son del
  `MultiSelectFilter` de antes, no de la 456. No se abre ficha (design §10-D exigía un fallo serio NUEVO).
- `LogoutButton` lanza «useToast debe usarse dentro de un ToastProvider» en `/dashboard` y la tabla de la
  satélite tiene un desajuste de hidratación de fecha: preexistentes, ajenos a la ficha.

## T4.1 — Gate completo

- Intento 1 (`progress/gate_456_intento1.log`, `INIT_EXIT=1`): 2 rojos. (1) Red 455 C16
  (`snapshot-correccion`): la celda del registro ahora devuelve un elemento; se ajustó SOLO la extracción
  (lee el texto visible), la aserción literal no cambia — commit `cff0b6d6`. (2)
  `financiera-cubo-temporal` («semana»): ajeno; 3 corridas aisladas en verde (7/7 cada una).
- Intento 2 (`progress/gate_456.log`): **2176/2176 archivos, 30 816 tests, 26 skipped (los preexistentes
  de la 455), `== init OK ==`, `INIT_EXIT=0`.**

## Cierre de los hallazgos 1–3 de `progress/review_456.md` (rama `feature/456-final`)

- **Hallazgo 2 (registro de acciones sin red).** `valorLegible` entra en `SIMBOLOS_VIGILADOS` de
  `tests/unit/guards/estado-con-info.guardia.test.ts`; `historial-acciones-descarga-columnas.ts` se
  clasifica `descarga`. La clase de `historial-acciones-columnas.ts` sigue siendo `descarga` (el nombre
  que produce `valorLegible` solo llega a la descarga; en pantalla el resultado lo pinta `EstadoConInfo`),
  y ahora su motivo LO COMPRUEBA algo: el caso «la excepción `descarga` del registro de acciones» de la
  guardia (exige que el archivo USE `EstadoConInfo` y que exista el test de componente) y
  `tests/components/HistorialAccionesValorInfo.test.tsx` (botón en «Valor anterior/nuevo» con una
  corrección de resultado, ninguno con otra acción ni con valor vacío, y la descarga con el nombre).
  Nueva mutación sintética «(extra) un helper vigilado…». Mutaciones reales, en secuencia y revertidas
  con `git checkout` (árbol limpio tras cada una):
  - **X2 del revisor** (el archivo devuelto a `cca58a2f`): **ROJO** — brazo (a) nombra las líneas 169 y
    175 (`valorLegible` en el `render`), más el caso del motivo y el R10 del test de componente (3 rojos).
  - `celdaValor` sin `EstadoConInfo` (devuelve `valorLegible`): **ROJO** — caso del motivo + R10 (2 rojos).
- **Hallazgo 3.** `desenlaces-de-fila.ts` pasa de `control-con-hermano` (satisfecho por el `InfosEstado`
  de otra lista) a `recuento`, con el motivo: la frase «Entregado: 4 · …» de «En qué terminaron» nombra
  cada desenlace con la cifra de órdenes del producto que acabaron así.
- **Hallazgo 1.** El mapa de `specs/456-tooltip-estados/tasks.md` se rehízo con rutas completas. Un script
  (de un solo uso, no commiteado) leyó la sección y comprobó: toda ruta `tests/…` existe, ningún
  `*.test.ts(x)` citado sin ruta, R1–R37 presentes y el comienzo de cada caso citado está en su archivo →
  **30 rutas, 66 casos, 0 errores**, en `tasks.md` y en la copia de abajo. Contra la versión anterior del
  mapa: 26 errores (los nombres sin ruta y los archivos inexistentes que citó el revisor).

## Mapa R → test (CHECKPOINTS › Trazabilidad)

Copia del de `specs/456-tooltip-estados/tasks.md` (mismo contenido, comprobado por el mismo script).


| R | Test (archivo › caso) |
|---|---|
| R1 | `tests/unit/types/descripcion-estado.test.ts` › «R1 — 20 estados, 20 explicaciones…» |
| R2 | `tests/unit/types/descripcion-estado.test.ts` › «R2/R5 — «%s»: la explicación es la fila de la tabla aprobada» (20 casos, lee el `.md`) + `tests/components/EstadoInfo.test.tsx` › «%s: nombre visible, nombre accesible exacto y, abierto, un diálogo…» (20 casos) |
| R3 | typecheck del gate (borrar una clave de `DESCRIPCION_ESTADO` → TS1360) + `tests/unit/types/descripcion-estado.test.ts` › «R3 — el tipo es exhaustivo: 19 claves no compilan» |
| R4 | `tests/unit/types/descripcion-estado.test.ts` › «R4/R5 — «Novedad» usa los plazos de la configuración…» |
| R5 | `tests/unit/types/descripcion-estado.test.ts` › «R4/R5 …» + «R2/R5 …» (fila aprobada; cae con 7 días) |
| R6 | `tests/unit/types/descripcion-estado.test.ts` › «R6 — «Novedad» no da el número de intentos…» |
| R7 | `tests/components/EstadoInfo.test.tsx` › «R7 — el texto no depende de la superficie…» + recorrido T4.3 |
| R8 | `tests/unit/types/descripcion-estado.test.ts` › «R8 — la nota de ayuda es igual a la sección «Pendiente de visto bueno del humano»» |
| R9 | `tests/components/EstatusBadgeInfo.test.tsx`; `tests/components/HistorialOrdenTimelineInfo.test.tsx` › «R9 — transición…»; `tests/components/PosOrderCardInfoEstado.test.tsx` › «R9/R32 …» (3 vistas); `tests/components/SateliteOrderCardInfo.test.tsx` › «R9 …»; `tests/components/IncidentesAdminModule.test.tsx` › bloque «456 — «Estado de la orden»…»; `tests/components/GestionarOrdenPanelTope.test.tsx` › bloque «456 — cabecera del panel…»; `tests/components/ChatConversacionLlamada.test.tsx` › bloque «456 — cabecera de la conversación…»; `tests/components/CierreFacturaSinGestionar.test.tsx` › «R9/R15 …»; `tests/components/RastreoDialogInfoEstado.test.tsx` › «R9/R11/R15 …»; `tests/unit/components/detalle-columnas.test.tsx` › «R9 — la columna «Estado»…»; `tests/components/HistorialAccionesValorInfo.test.tsx` (registro de acciones) |
| R10 | `tests/unit/components/detalle-columnas.test.tsx` › «R10 — el resultado lleva su botón…»; `tests/components/HistorialOrdenTimelineInfo.test.tsx` › «R10 — gestión registrada…»; `tests/components/EstadoInfo.test.tsx` › «InfosEstado: un botón por código distinto…»; `tests/components/HistorialAccionesValorInfo.test.tsx` › «R10 — «Valor anterior» y «Valor nuevo»…» |
| R11 | `tests/components/EstadoInfo.test.tsx` › «%s pendiente: «<resultado> · pendiente de confirmación»…» (5 resultados); `tests/components/NotaGestionPendiente.test.tsx` › bloque «456 …»; `tests/components/RastreoDialogInfoEstado.test.tsx` › «R11 …» |
| R12 | `tests/components/EstadoInfo.test.tsx` › «la nota de ayuda con su explicación…»; `tests/components/PosOrderCardInfoEstado.test.tsx` › «R12 …»; `tests/components/HistorialOrdenTimelineInfo.test.tsx` › «R12 …»; `tests/components/NotaGestionPendiente.test.tsx` › bloque «456 …» |
| R13 | `tests/components/MultiSelectFilterInfoEstado.test.tsx` › «R13 — cada opción…», «con UN estado…», «con VARIOS estados…» |
| R14 | `tests/components/ConteoPorStatusDonaInfo.test.tsx` › «R14/R37 …»; `tests/components/EstadoInfo.test.tsx` › «la leyenda es una lista con nombre y un botón por código…» |
| R15 | `tests/components/EstadoInfo.test.tsx` › «%s: se pinta el nombre de la 455 SIN botón» (4 casos); `tests/components/EstatusBadgeInfo.test.tsx` › «R15 …»; `tests/components/HistorialOrdenTimelineInfo.test.tsx` › «R15 …»; `tests/components/RastreoDialogInfoEstado.test.tsx` › «R9/R11/R15 …»; `tests/unit/types/descripcion-estado.test.ts` › «R15 …» |
| R16 | `tests/components/NoRegresion456.test.tsx` › «contadores del tablero del día…»; `tests/components/NovedadesTabs.test.tsx` › bloque «456 …»; `tests/components/CierreFacturaSinGestionar.test.tsx` › «R16/R30 …»; `tests/unit/guards/estado-con-info.guardia.test.ts` › «(extra) un nombre en un ATRIBUTO…» |
| R17 | `tests/unit/components/ordenes-descarga-columnas.test.ts` y `tests/unit/components/historial-acciones-descarga-columnas.test.ts` sin editar y verdes (ningún `*-descarga-columnas` en el diff); `tests/components/HistorialAccionesValorInfo.test.tsx` › «R17 — la DESCARGA de la misma fila lleva el nombre…» |
| R18 | `tests/unit/guards/estado-con-info.guardia.test.ts` › brazos (a)–(d), anti-vacío y «la excepción `descarga` del registro de acciones…» |
| R19 | `tests/unit/guards/estado-con-info.guardia.test.ts` › «mutaciones sintéticas» 1–5, 4b y los tres «(extra)» (incluido el helper `valorLegible` en un `render`) |
| R20 | `tests/components/EstadoInfo.test.tsx` › «R20 — pasar el puntero abre tras el retraso» |
| R21 | `tests/components/EstadoInfo.test.tsx` › «R21 — clic abre y sigue abierto…», «R21 — pulsar fuera cierra» + recorrido (tap) |
| R22 | `tests/components/EstadoInfo.test.tsx` › «R22 — Enter y Espacio abren…», «R22/R23 — el botón es alcanzable con Tab» |
| R23 | `tests/components/EstadoInfo.test.tsx` › «%s: nombre visible, nombre accesible exacto…» (20) + «R22/R23 …» + los de la señal y la nota |
| R24 | `tests/components/EstadoInfo.test.tsx` › «%s: … un diálogo con nombre y descripción aprobados» (20) |
| R25 | `tests/components/EstadoInfo.test.tsx` › «R25 — abrir otro cierra el primero» |
| R26 | `tests/components/EstadoInfo.test.tsx` › «R26/R27/R33 — caja de 16 px, área activable de 24…» + recorrido |
| R27 | `tests/unit/guards/contraste-tokens.guardia.test.ts` › bloque «Ficha 456 — el botón de información cumple 1.4.11» |
| R28 | `tests/components/RastreoDialogInfoEstado.test.tsx` › «R28 …»; `tests/components/EstadoInfo.test.tsx` › «R28 …» |
| R29 | `tests/components/EstadoInfo.test.tsx` › «R29 — cerrado, el texto no está en el DOM…» |
| R30 | `tests/components/PosOrderCardInfoEstado.test.tsx` › «R30 …» (3 vistas); `tests/components/ChatOrdenesListaInfoEstado.test.tsx` › «R30 …»; `tests/components/SateliteOrderCardInfo.test.tsx` › «R30 …»; `tests/components/NoRegresion456.test.tsx` › «abrir la explicación no marca la casilla…»; `tests/components/CierreFacturaSinGestionar.test.tsx` › «R16/R30 …»; `tests/components/EstadoInfo.test.tsx` › «R30 …» |
| R31 | `tests/components/MultiSelectFilterInfoEstado.test.tsx` › «R31 — pulsar el botón no marca…» |
| R32 | `tests/components/EstatusBadgeInfo.test.tsx` › «R32 …»; `tests/components/ChatOrdenesListaInfoEstado.test.tsx` › «R32 …»; `tests/components/EstatusBadgeCatalogoV2.test.tsx`, `tests/components/EstatusBadgeEnReparto.test.tsx`, `tests/components/EstatusBadgeRetiroFulfillment.test.tsx` (aserciones de clase intactas) |
| R33 | Recorrido T4.3 (alturas antes/después en `progress/impl_456.md`), como fija el spec |
| R34 | `tests/components/MultiSelectFilterInfoEstado.test.tsx` › «R34 — mismas opciones, mismos nombres y mismo orden…» |
| R35 | `tests/components/RastreoDialogInfoEstado.test.tsx` › «R35 — tocar dentro de la explicación no cierra el diálogo…» |
| R36 | `tests/unit/guards/rastreo-sin-estatus-crudo.guardia.test.ts`, `tests/unit/guards/rastreo-frontera.guardia.test.ts` y `tests/unit/auth/menu-visibility.test.ts`, sin editar y verdes |
| R37 | `tests/components/ConteoPorStatusDona.test.tsx` sin editar y verde + `tests/components/ConteoPorStatusDonaInfo.test.tsx` › «R14/R37 …» |
