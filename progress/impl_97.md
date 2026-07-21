# Feature 97 — optimización de ruta, frontend (mensajero)

## Pedido
Mostrar al mensajero sus paradas en el orden óptimo (más cercana → más lejana desde su ubicación), con un mapa que dibuje la ruta para hacer las entregas, un aviso si la ruta está desactualizada y un botón para re-sincronizar.

## Proceso (SDD; spec 92 preexistente)
Es la mitad **frontend** de `specs/92-optimizacion-ruta-mensajero/` (el backend es el PR #98, ya mergeado, que congeló el contrato). Backend chico (exponer coords) → frontend (mapa + UI). Gate de mapa: **Leaflet + OpenStreetMap** (elegido por el humano; sin API key).

## Diseño
- **Backend (chico):** `MiAsignacionDTO` gana `latitud`/`longitud` (`number | null`), serializadas Decimal→number con el patrón `montoCobrar`, desde las coords que escribió la feature 91.
- **Frontend:** consume el contrato del #98 (`secuenciaRuta`, `ruta {estado, calculadaAt, origenFuente, paradasSinOptimizar}`, action `sincronizarRuta({ ubicacion? })`). Mapa Leaflet cargado con `next/dynamic({ ssr:false })` (Leaflet usa `window`); marcadores numerados con `L.divIcon`; `Polyline` en orden de secuencia.

## Trazabilidad (requisito → gate → test)
| Req | Dónde | Test |
|-----|-------|------|
| coords en DTO | `MiAsignacionDTO` + `GestionOrdenRepository` (Decimal→number) | `gestion-orden-repository.test.ts`, `mis-asignaciones-service.test.ts` |
| R9 conflicto geocodificación en asignación | `guia-decision-error-messages.ts` | `GenerarGuiaModal.test.tsx`, `AsignarBodegaModal.test.tsx` |
| R25 GPS best-effort (no bloquea) | `SincronizarRutaButton.tsx` | `SincronizarRutaButton.test.tsx` |
| R28 orden por secuencia + pendientes | `MisAsignacionesModule.tsx` | `MisAsignacionesModule.test.tsx` |
| R29 "Por recoger" intacto | `MisAsignacionesModule.tsx` | `MisAsignacionesModule.test.tsx` |
| R30 aviso ruta desactualizada | `MisAsignacionesModule.tsx` | `MisAsignacionesModule.test.tsx` |
| R31/R32/R34 botón sincronizar + refresh + anti-doble-click | `SincronizarRutaButton.tsx` | `SincronizarRutaButton.test.tsx`, `MisAsignacionesModule.test.tsx` |
| mapa Leaflet/OSM | `RutaMapa.tsx` / `RutaMapaInner.tsx` | mockeado en `MisAsignacionesModule.test.tsx` (jsdom no pinta Leaflet) |

## Verificación (medida)
- `pnpm typecheck` 0 · `pnpm lint` 0 errores (143 warnings preexistentes) · tests de la feature 57/57 + backend 168/168.
- `pnpm build` **exit 0** (Leaflet SSR resuelto por el dynamic import; 30 páginas generadas) — Vercel construye.
- Deps nuevas: `leaflet`, `react-leaflet`, `@types/leaflet`.
