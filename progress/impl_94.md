# Feature 94 — admin con paridad de maestro (Órdenes · Cierres · Ranking · Wallet)

## Pedido
El rol `admin` debe VER y MANIPULAR igual que `maestro` en 4 módulos: Órdenes, Cierres del día, Ranking, Wallet. Solo esos (Configuración NO).

## Proceso (SDD abreviado)
- **Diseño/análisis**: investigación read-only que mapeó cada compuerta de autorización (sidebar + gate de página + allowlist de servicio) por módulo.
- **Gate (F1.4)**: 3 decisiones confirmadas por el humano — (1) paridad total incl. money-critical, (2) Órdenes ve todas + acciones por lote, (3) helper compartido.
- **Implementación**: backend_dev (servicios + helper) → frontend_dev (sidebar + páginas) → reviewer.

## Diseño
Helper único `lib/auth/acceso-total.ts`: `ROLES_ACCESO_TOTAL = [maestro, admin]` + `esAccesoTotal(rol)`. Todas las compuertas maestro-only de los 4 módulos migran a `esAccesoTotal`.

## Trazabilidad (requisito → gate → test)
| Req | Gate (archivo) | Test |
|-----|----------------|------|
| R1 admin genera guía / asigna / rutea | `GuiaAsignacionService.ts` | `guia-asignacion-service.test.ts`, `ordenes-guia-action.test.ts` |
| R2 admin usa acciones por lote + ve todas | `ordenes/page.tsx` (`accionesLote`/`incluirTodas`) | `OrdenesPage.test.tsx` |
| R3 admin aprueba/rechaza cierres | `CierresAdminService.ts`, `CierresBodegaAdminService.ts` | `cierres-admin-service.test.ts`, `cierres-bodega-admin-service.test.ts`, `CierresAdminPage.test.tsx` |
| R4 admin ve + edita ranking | `RankingService.ts` | `ranking-service.test.ts`, `RankingPage.test.tsx` |
| R5 admin ve + manipula wallet | `Wallet*Service.ts`, `GastoFijoPlantillaService.ts` | `wallet-*-service.test.ts`, `wallet-page.test.tsx`, `wallet-mensajeros-page.test.tsx` |
| R6 admin en el sidebar de los 4 módulos | `menu-visibility.ts` | `menu-visibility.test.ts` |
| R7 NO sobre-otorgar (Configuración maestro-only; vistas propias de adminTienda/mensajero intactas) | sin cambio | `menu-visibility.test.ts`, `wallet-tienda-service.test.ts`, `wallet-mensajero-service.test.ts` |
| R8 mensajero sigue solo-lectura en ranking | `RankingService.ts` | `ranking-service.test.ts` |

## Verificación (medida)
- `pnpm typecheck` 0 · `pnpm lint` 0 errores.
- Suite completa **3625 / 3626** (único rojo `zonas-migration.test.ts`, preexistente, rojo también en `dev`).
- Reviewer **APROBADO**: 0 sobre-otorgamientos, 0 compuertas faltantes; verificado por mutación (revertir un gate de wallet a maestro-only pone un test en rojo).
