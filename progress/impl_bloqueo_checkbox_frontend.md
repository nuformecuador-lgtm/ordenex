# Impl frontend — bloqueo del checkbox por cierre abierto (2026-07-16)

Worktree: `.claude/worktrees/bloqueo-checkbox-cierre` (base `origin/dev` d4b6e48). Sin commit.

## Qué se hizo

Se reemplazó el WIP (flag GLOBAL derivado de `bloqueadosIds` de mensajeros GAM) por el
bloqueo **por orden**: se compara `orden.zonaId` contra `zonasBloqueadasIds` de
`listarZonasBloqueadasPorCierre()` (SWR, key `ordenes:zonas-bloqueadas`, mismo patrón que
los demás fetchers del archivo). Central (GAM) y satélites con la misma regla (≥1 cierre).

- **`console.log("xyz", mensajerosData)` ELIMINADO** (incidente PR #75). No se agregó ningún log.
- Tabs con bloqueo (`ESTADOS_ASIGNACION`), verificadas contra `accionesDe()` del código real:
  `en_fulfillment` / `en_preparacion` ("Generar guía" → asigna mensajero) y **`en_bodega`**
  ("Asignar mensajero" + "Rutear a bodega satélite"). El WIP omitía `en_bodega`.
  Las tabs que solo imprimen etiquetas (`en_espera_aceptacion`, `en_ruta_bodega_satelite`)
  NO se bloquean.
- `rechazada` intacta: sigue bloqueando las órdenes no centrales. No se solapa con la regla
  nueva (no es tab de asignación); aun así se evalúa primero por ser la más específica, con
  el criterio comentado en el código.
- Sin `zonaId` utilizable o con el SWR en vuelo → NO se bloquea (no se puede afirmar que la
  zona esté bloqueada; el backend revalida al ejecutar). Comentado en el código.
- Copy corregida en `guia-decision-error-messages.ts`: "todos con un cierre abierto" →
  "al menos un mensajero con un cierre abierto" (regla real ≥1). Se actualizó la aserción
  del test propio de esa copy (`tests/unit/utils/guia-decision-error-message.test.ts`).
- `CierreDiaModule.tsx` NO se tocó (cambio ajeno del WIP).

## Archivos

- `app/(app)/ordenes/_components/OrdenesTabs.tsx` (modificado)
- `app/(app)/ordenes/_components/guia-decision-error-messages.ts` (copy)
- `tests/components/OrdenesTabsBloqueoCierre.test.tsx` (reescrito contra el diseño nuevo)
- `tests/unit/utils/guia-decision-error-message.test.ts` (aserción de copy)

## Verificación (medida en este worktree)

| | baseline | después |
|---|---|---|
| typecheck | 0 | **0** |
| lint | 0 err / 140 warn | **0 err / 140 warn** |
| tests | 16 failed / 3000 passed | **16 failed / 3013 passed** |

Los 16 fallos son los mismos ajenos del baseline (`EstatusLabel`, 2 de `menu-visibility`,
`devuelta_origen`, + fallos por carga en HomePage/OrdenesModuleReuse/RecepcionSatelite/
MisAsignaciones/CierreDia/AppLayout/HistorialOrdenTimeline: verificado que HomePage pasa en
aislado). Ningún fallo toca los archivos de este cambio. Los 5 tests nuevos pasan.

## Hallazgos

1. **`bloqueadosIds` NO quedó huérfano.** Lo consume `OrdenesRevisionMaestro.tsx`
   (`mensajerosBloqueadosIds` → `mensajero-options.ts`) para deshabilitar mensajeros en el
   selector del modal. En `OrdenesTabs` ya no se usa, pero **se dejó en el fetcher a
   propósito**: la key SWR `"ordenes:mensajeros"` la comparten ambos componentes y dos
   fetchers con la misma key deben devolver la misma forma. Contrato del backend intacto.
2. **Tradeoff en `en_bodega`**: el bloqueo alcanza también a "Imprimir etiquetas" (comparte
   la única columna de checkbox de la tab). Si el humano quiere poder imprimir etiquetas de
   una zona bloqueada, hace falta bloqueo por acción, no por fila. Decisión pendiente.
