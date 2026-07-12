# Review — Feature 54: reconciliación del refactor PR #40 (dev verde)

**Veredicto: APROBADO (0 bloqueantes)** · reviewer (model opus) · 2026-07-12 · rama `feature/54-reconciliar-zonas-tarifas` (HEAD `511f717`)

## Nota de proceso (menor #1, resuelto)
Feature 54 es una **FIX-FEATURE de reconciliación de emergencia**, corrida como ciclo ágil con criterios de aceptación INLINE en `feature_list.json` id 54 (prisma validate + typecheck 0 + init.sh verde + build), TODOS cumplidos. NO tiene `specs/54-...` dir, igual que las fix-features 51/52/53 (precedente del repo). El mapa "reconciliación→test" está en `progress/impl_54-...md`. Exención registrada.

## Verificación ejecutable (corrida por el reviewer, números reales)
| Check | Resultado |
|---|---|
| `npx prisma validate` | OK — schema válido |
| `pnpm typecheck` | 0 errores |
| `pnpm test` (aislado) | **1565/1565, 0 fallos** (182 files) |
| `./init.sh` | `== init OK ==`, exit 0 (incluye 1565 + guard down.sql/.env) |
| `pnpm build` | exit 0, 14 rutas |
| `prisma migrate status` | 25 migraciones, "up to date" |

El verde es real (suite corrida 2×, misma cifra).

## Puntos críticos (encargo)
- **(a) Sin `findGamZonaId`/`esGam` funcional colgando**: `findGamZonaId` eliminado del código de producción (solo en comentarios). Resolver vivo = `findCentralZonaId` (`ZonaRepository`/`IZonaRepository`). Campo Prisma `esGam`→`esCentral` (`@map("es_central")`) en todos los select/accesos. Residuos: variables locales `esGam` (semánticamente correctas), campo DTO estable `zonaEsGam`, comentarios, stub `ZonaForm`. Cosmético (menor #2).
- **(b) 17/30/34 preservadas**: `GuiaAsignacionService` mantiene semántica idéntica (orden central sii `orden.zonaId === centralZonaId`); `ordenes-guia.ts` usa `findCentralZonaId`; `OrdenRepository` mapea `esCentral`→DTO estable `zonaEsGam` (sin ripple). Feature 34 (`findMensajerosByZona`) intacta. Sus tests pasan.
- **(c) Sin tests debilitados**: `OrdenesCargaMasivaButton.test.tsx` NO modificado — se restauró el COMPONENTE (feature 51: distrito `required`, ejemplos CR San José/San José/Carmen). `menu-visibility.test.ts` pasó a referencia por LABEL (sigue afirmando el set exacto por rol). Tests de invariante de migración: blocklist frágil → comparación contra predecesor real fijo (no tautológico; sin re-timestampear migraciones aplicadas).
- **(d) Intención del #40 conservada**: `Tarifa`/`TarifaZonaMensajero`/`ZonaDistrito` (N:M) presentes; pagos al mensajero NO volvieron a `Zona` (viven en `tarifa_zona_mensajero`); `zonas-columns` usa `esCentral` (badge "Central / GAM").

## Seguridad / migraciones
- Sin tablas nuevas → sin RLS nueva. Migración `20260712000000_zona_es_central_rename` con `down.sql` reversible. La migración #40 rota `20260711200000_provincia_zona_id_nullable` (ALTER sobre columna inexistente, 42703) se convirtió en no-op idempotente guardado (`IF EXISTS`) con `down.sql` — reconciliación forward válida de una migración que nunca aplicó. Capas repo/service/action preservadas. Sin secretos hardcodeados.

## Hallazgos menores (no bloqueantes)
1. (proceso) Sin `specs/54-...` dir — RESUELTO como exención de fix-feature ágil (arriba).
2. (cosmético) Nombres legacy `esGam` en variables locales/comentarios/DTO `zonaEsGam`. Limpieza opcional.
3. (deuda #40 pre-existente, documentada) `ZonaForm.tsx` sigue STUBBEADO (solo `nombre`; NO hay UI para setear `esCentral` aunque schema/DTO/repo lo soportan) + drift schema/DB en `provincia.zonaId`. ⚠️ IMPACTO OPERATIVO: sin UI para marcar la zona central, `findCentralZonaId` devuelve null → el maestro (30) no puede asignar mensajeros. **Registrar follow-up** para completar `ZonaForm` (setear esCentral) antes de operar 30/34/37 en runtime.
