# Feature 456 — Tareas

> Requisitos: `requirements.md` (R1-R37). Diseño: `design.md` (§ citados). Textos: `textos-aprobados.md`. La
> tabla de los estados no se edita. La sección «Pendiente de visto bueno» solo la cambia el humano.
>
> **Orden obligatorio.** Primero, la 454 y la 455 mergeadas en `dev`. Después, Fases 0 a 4. Luego la revisión
> (Fase 5). La release (Fase 6) solo por orden del humano, junto con SF-001, la 454 y la 455.
>
> Convenciones:
> - Implementa `frontend_dev`.
> - `[P]` = se puede hacer en paralelo con otras `[P]` del mismo bloque.
> - `Dep:` = dependencias.
> - **Hecho** = criterio verificable.
> - Un commit por tarea.
> - El worktree nace de `dev`: el primer paso es `git checkout --detach <SHA dado>` + `git merge-base`.
> - **Gate completo** (`./init.sh`), porque la ficha toca `lib/types/`. `INIT_EXIT=$?` va escrito dentro del
>   log, sin `tail`.
> - Sin «SLA» en ningún texto.

---

## FASE 0 — Medir antes de construir

- [ ] **T0.1 — Base.** Confirmar en el archivo, no en el grafo:
  - que la 454 y la 455 están en `dev`;
  - que existen `NOMBRE_ESTADO`, `nombreDeEstado`, `nombreDeResultado` y `SENAL_PENDIENTE`, y los 20 códigos de
    la 455;
  - que la señal de pendiente y la nota de ayuda tienen componente o texto propio, y dónde.

  **Además:** que el parser de la G4 de la 455 lee solo la primera tabla de `textos-aprobados.md`. Si no es
  así, se acota con nota fechada (`design.md` §1.2).

  **Hecho:** salidas y SHA en `progress/impl_456.md`, y G4 verde con la sección nueva del `.md`.
- [ ] **T0.2 — Prueba de concepto del popover** `[P]` con T0.3. En una rama desechable, un `Popover` de Base UI
  1.6 con `openOnHover` en cinco sitios:
  - (a) una fila de tabla;
  - (b) una tarjeta del mensajero;
  - (c) el `Dialog` del rastreo;
  - (d) una opción del `MultiSelectFilter`;
  - (e) la leyenda bajo una gráfica.

  Medir en Playwright con `hasTouch` a 390 × 844:
  - `tap()` abre y deja abierto, y tocar fuera cierra;
  - en (b), tocar el popup **no** selecciona si se corta la propagación, y **sí** si no se corta;
  - en (c), tocar el popup no cierra el diálogo;
  - en (d), tocar el popup no cierra el panel ni marca la opción, con el detector de `design.md` §4.4.

  **Hecho:** los resultados anotados en `progress/impl_456.md`. Si algo falla, se aplica la salida de
  `design.md` §2 y se anota. La rama se borra.
- [ ] **T0.3 — Inventario sobre la 455** `[P]` con T0.2. Barrido de los símbolos de `design.md` §6 y de los
  chips, gráficas y filtros de estado. Clasificar cada aparición en `progress/inventario_456.md`, en una de
  estas clases:
  - `render`;
  - `frase`;
  - `descarga`;
  - `recuento` (con el motivo de §5.2);
  - `control-con-hermano`.

  Incluye:
  - las gráficas de analítica con categorías que sean estados o resultados (§5.1, fila 17);
  - si `/novedades` pinta el chip o la nota de ayuda;
  - dónde se pinta la nota de ayuda;
  - chips dentro de `a`, `label` o `summary`;
  - las pantallas de SF-001.

  **Hecho:** 0 apariciones sin clasificar, y cada diferencia con `design.md` §5 anotada como decisión.
- [ ] **T0.4 — Alturas de referencia** en la rama de la 455:
  - una fila de `/ordenes`;
  - una fila de «en bodega» de la satélite;
  - la cabecera de la tarjeta completa y la del mosaico (390 px);
  - una opción del filtro de estado.

  **Hecho:** cinco números en `progress/impl_456.md`.

---

## FASE 1 — La fuente. Dep: T0.1

- [ ] **T1.1 — La fuente única.** En `lib/types/order-status.ts`: `DESCRIPCION_ESTADO`, `descripcionNovedad`,
  `DESCRIPCION_NOTA_AYUDA` (con comentario de «pendiente de visto bueno»), `descripcionDeEstado` y
  `codigoDeNombre` (`design.md` §1.1). **Hecho:** `tsc` limpio y la G3 de la 455 sigue verde.
- [ ] **T1.2 — `tests/unit/types/descripcion-estado.test.ts`**, con los siete casos de `design.md` §1.2.
  Dep: T1.1. **Hecho:** verde, y estas mutaciones anotadas con su rojo:
  - (1) escribir «5 días» a mano;
  - (2) cambiar una coma de otra explicación;
  - (3) `DIAS_RECHAZO_AUTOMATICO: 7`;
  - (4) cambiar una palabra de `DESCRIPCION_NOTA_AYUDA`.

  `git diff --stat` vacío tras revertir.

---

## FASE 2 — El componente. Dep: T1.1

- [ ] **T2.1 — `components/ui/popover.tsx`** (`design.md` §2). **Hecho:** los tests de los popovers existentes
  siguen verdes.
- [ ] **T2.2 — `components/shared/EstadoInfo.tsx`**, con sus cinco piezas (§3). Dep: T2.1. **Hecho:** verdes
  `EstadoInfo`, `SenalPendienteConInfo`, `NotaAyudaConInfo` y `LeyendaEstadosConInfo` (tests de §8).
- [ ] **T2.3 — `EstatusBadge` sobre `EstadoConInfo`.** Dep: T2.2. **Hecho:** `EstatusBadgeInfo` verde. Los
  tests `EstatusBadge*` existentes siguen verdes **sin editar sus aserciones de texto ni de clase**.
- [ ] **T2.4 — Contraste** (§7) `[P]` con T2.3. **Hecho:** las cifras de 3:1 o más, escritas en el test.

---

## FASE 3 — La guardia y las superficies. Dep: T2.3

- [ ] **T3.1 — Guardia en modo informe** (`design.md` §6). **Hecho:** la lista de lo que marca coincide con
  T0.3, y las cinco fuentes sintéticas se comportan como dice §6.

Superficies. Son `[P]` entre sí y cada una lleva su test de §8. **Hecho** común:
- el test del componente está verde;
- la guardia deja de listar ese archivo;
- los tests existentes siguen verdes sin editar sus aserciones de texto (si una aserción cuenta botones, se
  reescribe con nota fechada).

- [ ] **T3.2 — Órdenes, señal de pendiente y nota de ayuda en `/ordenes`** (§5.1, filas 1-3 y 18).
- [ ] **T3.3 — Línea de tiempo**: transiciones y eventos de gestión (fila 4).
- [ ] **T3.4 — Incidentes y cierres**: origen de la barrida y resultado de cada fila, en pantalla, en la vista de
  papel y en SF-001. Las pestañas no llevan botón (filas 5-6, §5.2).
- [ ] **T3.5 — Bodega satélite** (fila 7).
- [ ] **T3.6 — Portal del mensajero**: tarjetas, cabecera del panel y nota de ayuda de «con ayuda» (filas 8-9 y
  18).
- [ ] **T3.7 — Chat**: lista con el patrón de hermano y cabecera (filas 10-11).
- [ ] **T3.8 — Novedades** (fila 12), según T0.3.
- [ ] **T3.9 — Rastreo público** (fila 13).
- [ ] **T3.10 — Monitoreo, «Resultado del día»** (fila 14).
- [ ] **T3.11 — Filtros de estado**. Incluye:
  - `codigoEstado` en `FilterOption`;
  - la opción con su botón hermano;
  - el botón del filtro aplicado junto a la X;
  - el detector de clic fuera (`design.md` §4.4).

  Se aplica en `/ordenes` y en la satélite (fila 15). **Hecho:** `MultiSelectFilterInfoEstado` verde, y los
  tests existentes del filtro verdes sin editar.
- [ ] **T3.12 — Analítica**: leyenda propia bajo «Conteo por estado» y bajo las gráficas de la fila 17. No se
  toca `GraficaRanking` (filas 16-17). **Hecho:** `ConteoPorStatusDonaInfo` verde, y el test existente de la
  gráfica verde sin editar.
- [ ] **T3.13 — Resto del inventario de T0.3.**
- [ ] **T3.14 — Guardia en modo estricto.** Dep: T3.2-T3.13. `USOS_PERMITIDOS` con solo las cuatro clases de
  §6, con un motivo por archivo. **Hecho:** verde, y dos mutaciones con su rojo:
  - quitar `EstadoConInfo` de `IncidentesAdminModule`;
  - quitar `codigoEstado` de `opcionesEstado` (el brazo c).
- [ ] **T3.15 — No-regresión de lo que no lleva botón** `[P]` con T3.14:
  - contadores del tablero, pestañas del cierre y de novedades, y KPI: 0 botones;
  - descargas: columnas idénticas;
  - `DataTable` con casilla, casilla y explicación no interfieren.

---

## FASE 4 — Verificación. Dep: T3.14, T3.15

- [ ] **T4.1 — Gate completo** `./init.sh`. `INIT_EXIT=0` dentro del log y `skipped` revisado. **Hecho:**
  `progress/gate_456.log`.
- [ ] **T4.2 — Mutaciones de cierre.** Van en secuencia, **nunca** en paralelo con el gate:
  - (1) sin `stopPropagation` en el popup → cae `PosOrderCardInfoEstado`;
  - (2) sin `stopPropagation` en el botón de la opción, o sin el detector de clic fuera → cae
    `MultiSelectFilterInfoEstado`;
  - (3) cambiar una palabra de una explicación → cae `descripcion-estado`;
  - (4) un `{nombreDeEstado(x)}` en una pantalla → cae la guardia;
  - (5) `ring-ring/50` en el botón → cae el test de contraste o de clase;
  - (6) quitar `tema-claro` del popup del rastreo → cae `RastreoDialogInfoEstado`.

  **Hecho:** seis rojos con el nombre de su test, y `git diff --stat` vacío al terminar.
- [ ] **T4.3 — Recorrido por rol** (Playwright MCP, datos de `design.md` §9). En **cada** superficie se
  comprueba:
  - (i) el botón aparece junto a cada nombre que §0.2 dice;
  - (ii) el texto es **idéntico** al del `.md`, comparado por programa;
  - (iii) no se dispara la acción del contenedor;
  - (iv) Tab llega al botón, Enter abre y Escape cierra devolviendo el foco;
  - (v) no hay botón donde §5.2 dice que no.

  Se anota en `progress/recorrido_456.md` con capturas.

  | Rol | Pantallas y comprobaciones propias |
  |---|---|
  | maestro (escritorio) | **`/ordenes`:**<br>• chip con botón y el hover abre;<br>• la casilla de la fila sigue independiente;<br>• señal de pendiente y nota de ayuda con su botón;<br>• detalle e historial: transiciones, eventos registrado y corregido con botón, «Creación» y retirado sin botón;<br>• CSV con las mismas columnas.<br>**Filtro de estado:**<br>• cada opción con botón, y pulsarlo no marca ni cierra el panel;<br>• filtro aplicado con un estado: botón junto a la X, y la X sigue limpiando;<br>• con varios estados, sin botón;<br>• vista guardada igual que antes;<br>• axe sobre el panel abierto.<br>**Otras pantallas:**<br>• `/monitoreo` detalle: «Estado» y «Resultado del día» con botón, contadores sin botón;<br>• `/incidentes`;<br>• `/cierres-admin`: filas de resultado y origen de la barrida con botón, pestañas sin botón (y pulsar un botón de fila no cambia la pestaña);<br>• `/analitica`: leyenda de «Conteo por estado» con un botón por estado y las barras iguales;<br>• tema oscuro. |
  | admin | Lo mismo en su alcance, más recepción en la bodega central. |
  | adminTienda | `/ordenes` propias con la señal de pendiente y la nota de ayuda. `/novedades`: tarjetas con botón y pestañas sin botón. Descarga. |
  | adminSatelite | `/recepcion-satelite`: por recibir (el desplegable abre solo con su botón), en bodega, recibidas y su filtro de estado. Pantallas de SF-001 del inventario. |
  | mensajero (móvil 390 × 844, `hasTouch`) | **Tarjetas** (completa, mosaico y detalle):<br>• `tap` en el botón y en el texto abierto no gestionan la orden;<br>• `tap` fuera cierra;<br>• `tap` en la tarjeta sigue gestionando.<br>**Otras pantallas:**<br>• «con ayuda», con la nota y su botón;<br>• recoger, recolección y recolectadas del día;<br>• cabecera del panel «Gestionar orden»;<br>• chat: el botón al final de la fila no abre la conversación, tocar la fila sí; cabecera de la conversación. |
  | rastreo público (móvil y escritorio) | Una guía por estado, una con pendiente y una con un estado retirado en el historial. Botón en el vigente, en cada entrada y en la pendiente. Tocar dentro de la explicación no cierra el diálogo. Con tema oscuro, la explicación sale clara. |

  Densidad: las cinco alturas de T0.4, **iguales**. **Hecho:** todo en verde. Si algo falla, se abre una tarea
  de la Fase 3 y se repite el recorrido en esa pantalla.

---

## FASE 5 — Revisión (reviewer). Dep: T4.3

- [ ] **T5.1** — Trazabilidad verificada contra los tests reales. El reviewer presenta al humano los puntos
  «Abierto»; el primero es el visto bueno del texto de la nota de ayuda. Informe en `progress/review_456.md`,
  **commiteado**.

## FASE 6 — Release (solo por orden del humano). Dep: T5.1

- [ ] **T6.1** — Va en la misma release que la 454 y la 455, con `./init.sh` completo sobre el SHA exacto de
  `dev` comparado con `origin/dev`. La nota de ayuda no sale sin el visto bueno del humano; si falta, se decide
  con él antes de la release. Tras desplegar, rastreo público de una guía real en móvil. **Hecho:**
  `progress/release_456.md`.

---

## Trazabilidad R → test

| R | Test (archivo › caso) |
|---|---|
| R1 | `tests/unit/types/descripcion-estado.test.ts` › «20 estados, 20 explicaciones» |
| R2 | `descripcion-estado.test.ts` › «cada explicación es la fila de la tabla aprobada» |
| R3 | typecheck del gate + `descripcion-estado.test.ts` › «@ts-expect-error con 19 claves» |
| R4 | `descripcion-estado.test.ts` › «Novedad usa los plazos de la configuración» |
| R5 | `descripcion-estado.test.ts` › «plazos de la configuración» + «fila aprobada» (cae con 7 días) |
| R6 | `descripcion-estado.test.ts` › «Novedad no da el número de intentos» |
| R7 | `EstadoInfo.test.tsx` › «el texto no depende de la superficie» + recorrido T4.3 |
| R8 | `descripcion-estado.test.ts` › «nota de ayuda igual a la sección pendiente de visto bueno» |
| R9 | `EstatusBadgeInfo`, `HistorialOrdenTimelineInfo`, `PosOrderCardInfoEstado`, `ChatOrdenesListaInfoEstado`, `SateliteOrderCardInfo`, `GestionarOrdenPanelInfo`, `IncidentesAdminInfo`, `CierreFacturaInfo`, `ChatConversacionInfo`, `RastreoDialogInfoEstado` + recorrido |
| R10 | `CierreFacturaInfo` › «filas de resultado con botón»; `DetalleColumnasResultadoInfo`; `HistorialOrdenTimelineInfo` › «eventos registrado y corregido» |
| R11 | `SenalPendienteConInfo.test.tsx` |
| R12 | `NotaAyudaConInfo.test.tsx` + tests de T3.2/T3.6 |
| R13 | `MultiSelectFilterInfoEstado.test.tsx` › «opción con botón», «filtro aplicado con un estado», «con N, sin botón» |
| R14 | `ConteoPorStatusDonaInfo.test.tsx`, `LeyendaEstadosConInfo.test.tsx` y los de T3.12 |
| R15 | `EstadoInfo.test.tsx` › «retirado y desconocido sin botón»; `HistorialOrdenTimelineInfo` › «retirado» |
| R16 | Tests de T3.15 › «contadores, pestañas y KPI: 0 botones» |
| R17 | Tests de columnas de descarga › «columnas idénticas» |
| R18 | `tests/unit/guards/estado-con-info.guardia.test.ts` › brazos (a)-(d) |
| R19 | `estado-con-info.guardia.test.ts` › «cinco fuentes sintéticas» + T3.14 + T4.2 (4) |
| R20 | `EstadoInfo.test.tsx` › «hover abre» |
| R21 | `EstadoInfo.test.tsx` › «clic abre y sigue abierto; fuera, segundo clic y Escape cierran» + recorrido (tap) |
| R22 | `EstadoInfo.test.tsx` › «teclado» |
| R23 | `EstadoInfo`, `SenalPendienteConInfo` y `NotaAyudaConInfo` › «nombre accesible» |
| R24 | `EstadoInfo.test.tsx` › «nombre y descripción del popup» |
| R25 | `EstadoInfo.test.tsx` › «abrir otro cierra el primero» |
| R26 | `EstadoInfo.test.tsx` › «clases de área» + recorrido |
| R27 | `contraste-tokens.guardia.test.ts` › «EstadoInfo 3:1 o más» |
| R28 | `RastreoDialogInfoEstado.test.tsx` › «tema-claro con .dark» |
| R29 | `EstadoInfo.test.tsx` › «sin fetch» |
| R30 | `PosOrderCardInfoEstado`, `ChatOrdenesListaInfoEstado`, `CierreFacturaInfo` › «no cambia la pestaña», `DataTable` con casilla + T4.2 (1) |
| R31 | `MultiSelectFilterInfoEstado.test.tsx` › «el botón y la explicación no marcan ni cierran» + T4.2 (2) |
| R32 | `EstatusBadgeInfo`; `ChatOrdenesListaInfoEstado` › «nombre accesible intacto»; tests `EstatusBadge*` y del filtro sin editar |
| R33 | Recorrido T4.3 › las cinco alturas iguales a T0.4 |
| R34 | `MultiSelectFilterInfoEstado` › «opciones, nombres y orden idénticos» + C01/C02 de la 455 |
| R35 | `RastreoDialogInfoEstado.test.tsx` › «no cierra el diálogo» |
| R36 | `rastreo-sin-estatus-crudo.guardia` y `rastreo-frontera.guardia` sin editar; `menu-visibility.test.ts` |
| R37 | `ConteoPorStatusDonaInfo` › «cifras y barras idénticas»; test existente de la gráfica sin editar |
