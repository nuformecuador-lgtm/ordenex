# 456 — Inventario (T0.3), sobre `cca58a2f`

Barrido de los símbolos vigilados (design §6 + alias de la 455, R-456-5) en `app/**` y `components/**`.
La fuente de verdad ejecutable es `USOS_PERMITIDOS` de `tests/unit/guards/estado-con-info.guardia.test.ts`
(clase + motivo por archivo, 0 sin clasificar: el brazo (b) falla si aparece uno nuevo y avisa si uno sobra).

## Render → ahora con el componente compartido (`components/shared/EstadoInfo.tsx`)

| Superficie | Archivo | Pieza |
|---|---|---|
| `/ordenes`, detalle del día de `/monitoreo`, satélite «en bodega», carga masiva | `EstatusBadge.tsx` | `EstadoConInfo` (chip `Badge`) |
| Señal de pendiente y nota de ayuda de `/ordenes` y del detalle | `NotaGestionPendiente.tsx` | `SenalPendienteConInfo` / `NotaAyudaConInfo` |
| Línea de tiempo | `HistorialOrdenTimeline.tsx` | `EstadoConInfo` (origen/destino), `InfoEstado` (resultados), `NotaAyudaConInfo` |
| `/incidentes` | `IncidentesAdminModule.tsx` | `EstadoConInfo` |
| Cierres: barrida, confirmación física, secciones (admin, SF-001, mensajero) | `cierre-factura.tsx`, `cierre-confirmacion-fisica.tsx`, `cierre-detalle-shared.tsx`, `CierreDiaModule.tsx` | `EstadoConInfo` / `InfoEstado` junto al título |
| Satélite «por recibir» | `SateliteOrderCard.tsx`, `RecepcionDetalle.tsx`, `PorRecibirModule.tsx` | `EstadoConInfo` |
| Tarjetas del mensajero (y de `/novedades`, recolección) | `PosCardHeader.tsx`, `PosOrderCard*.tsx`, `pos-estado.ts`, `RepartoModule.tsx` | `EstadoConInfo`, `NotaAyudaConInfo` |
| Panel «Gestionar orden» | `GestionarOrdenPanel.tsx` | `EstadoConInfo` |
| Chat: lista y cabecera | `ChatOrdenesLista.tsx` (hermano), `ChatConversacion.tsx` | `InfoEstado`, `EstadoConInfo` |
| Rastreo público | `app/_landing/RastreoDialog.tsx` | `EstadoConInfo`/`SenalPendienteConInfo` `superficie="landing"` |
| `/monitoreo` «Resultado del día» | `detalle-columnas.ts` | `EstadoConInfo` |
| Filtros de estado (`/ordenes`, satélite) | `filtro-estado-def.ts` → `MultiSelectFilter.tsx` | `codigoEstado` → `InfoEstado` |
| Analítica | `ConteoPorStatusDona.tsx`, `ConteoEntregasAnillo.tsx` | `LeyendaEstadosConInfo` |
| Registro de acciones, wallet, dinero por producto | `historial-acciones-columnas.ts`, `DetalleMovimientoCierre.tsx`, `DetalleMiMovimientoCierre.tsx`, `DineroProductoDetalle.tsx` | `EstadoConInfo` / `InfosEstado` |

## Sin botón (clase de §6) — ver `USOS_PERMITIDOS`

- `frase`: mensajes de error (`*-error-messages.ts`, `corregir-*`), toasts de escáneres y de recogida,
  modales (`RecuperarABodegaModal`, `RechazarNovedadModal`, `CorregirResultadoDialog`), prosa de analítica,
  contador de selección de la satélite, títulos y avisos de la sección de barridas.
- `descarga`: `ordenes-`, `satelite-`, `analitica-productos-`, `ranking-`, `cierres-gestiones-fundida-`
  descarga-columnas y `valorLegible` del registro.
- `recuento`: `contadores.ts`, `cierre-labels.ts` (pestañas/títulos con cifra), `KpisMensajero`,
  `KpisEfectividad`, `madurez-textos`, `CohorteCargaTabla`, `ranking-historico-labels`,
  `desenlaces-de-fila`… (ver guardia).
- Pestañas de `/novedades` y del cierre: controles con cifra (sin botón; test en `NovedadesTabs`/`CierreFacturaSinGestionar`).
- `HoyGestionBarras`: categorías de grupo («Sin gestión en el día», «Gestionadas»), no estados.

## Hallazgos respecto a design §5

`/novedades` no pinta la nota de ayuda (usa «Esperando tu respuesta»); `cierre-factura` no pinta el
resultado por fila; la tarjeta «completa» no está montada; superficies extra en wallet y registro de
acciones (R-456-6/7/8/9 de `impl_456.md`). Chips dentro de `a`/`label`/`summary`: ninguno encontrado.
