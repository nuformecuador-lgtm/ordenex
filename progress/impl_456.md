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
