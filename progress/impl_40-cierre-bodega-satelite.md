# Impl — Feature 40 · Cierre de bodega satélite → bodega principal

Branch: `feature/40-cierre-bodega-satelite` · Zona: `fullstack` · complexity: `high`
depends_on: 38 (`done`, transitivamente 37) · F1.4 APROBADA 2026-07-12 (todas recomendadas)
Fecha impl: 2026-07-12 · Baseline: `origin/dev` (commit `04b5d0d` en la rama) — 197 files / 1739 tests

## Veredicto

**VERDE (autoevaluación del implementer — no auto-aprobado; decide el reviewer).**
Todas las tasks T0–T11 completas. `./init.sh` VERDE, tree limpio, 8 commits sobre `dev`.

## Verificación ejecutable (salida real)

- `npx prisma validate`: **valid**. `npx prisma generate`: OK.
- **Migración `20260712120000_cierre_bodega` — round-trip REAL (DB viva localhost:5432, R25):**
  `migrate deploy` aplica → `pnpm run db:rollback` revierte (verificado: `cierre_bodega` count 0 +
  `cierre_dia.cierre_bodega_id` count 0) → `migrate deploy` reaplica limpio (`up to date`).
- **RLS (R24, live):** `relrowsecurity=true` en `cierre_bodega`; índice único parcial
  `cierre_bodega_zona_solicitado_uq` (`WHERE estado='solicitado'`) presente.
- `pnpm run typecheck`: **0 errores**.
- `pnpm run lint`: **0 errores** (135 warnings preexistentes, todos en `.claude/skills/**` y minificados; 0 en código feature 40).
- `pnpm run build`: **pasa** (ruta `/cierres-admin` compilada).
- `pnpm test` / `./init.sh`: **202 files / 1797 tests passing (+58 sobre 1739)**; "todas las migraciones tienen down.sql" OK; `== init OK ==`.
- E2E `e2e/cierre-bodega-satelite.spec.ts`: escrito, ejecución DIFERIDA (no corre bajo `pnpm test`; Playwright usa `./e2e`, requiere dev server + DB sembrada — mismo patrón 33/34/36/37/38).

## Archivos creados

Backend:
- `db/migrations/20260712120000_cierre_bodega/migration.sql` + `down.sql`
- `lib/types/cierre-bodega.ts`
- `lib/interfaces/repositories/ICierreBodegaRepository.ts`
- `lib/interfaces/repositories/ICierresBodegaAdminRepository.ts`
- `lib/interfaces/services/ICierreBodegaService.ts`
- `lib/interfaces/services/ICierresBodegaAdminService.ts`
- `lib/repositories/CierreBodegaRepository.ts` (exporta `BODEGA_RESUMEN_SELECT`, `toBodegaResumenRow`)
- `lib/repositories/CierresBodegaAdminRepository.ts`
- `lib/services/CierreBodegaService.ts`
- `lib/services/CierresBodegaAdminService.ts`
- `lib/actions/cierre-bodega.ts`
- `tests/unit/services/cierre-bodega-service.test.ts`
- `tests/unit/services/cierres-bodega-admin-service.test.ts`
- `tests/unit/repositories/cierre-bodega-repository.test.ts`
- `tests/unit/repositories/cierres-bodega-admin-repository.test.ts`
- `tests/integration/actions/cierre-bodega-action.test.ts`

Frontend:
- `app/(app)/cierres-admin/_components/cierre-detalle-shared.tsx` (helpers/columnas/`TotalesPanel`/`DetalleSecciones`/`VisorEvidencia`, reuso 37/38/40)
- `app/(app)/cierres-admin/_components/ConsolidacionBodegaModule.tsx` (adminSatélite: consolidar/solicitar)
- `app/(app)/cierres-admin/_components/CierresBodegaAdminModule.tsx` (maestro: cola/histórico/detalle/aprobar/rechazar)
- `e2e/cierre-bodega-satelite.spec.ts`

## Archivos modificados

- `db/schema.prisma` (model `CierreBodega`; `CierreDia.cierreBodegaId` + relación + índice; relaciones opuestas en `Usuario`/`Zona`)
- `app/(app)/cierres-admin/page.tsx` (Server Component role-aware: pre-fetch por rol + props)
- `app/(app)/cierres-admin/_components/CierresAdminModule.tsx` (refactor a helpers compartidos; feature 38 intacta)
- `tests/components/CierresAdminPage.test.tsx` (mocks de las nuevas actions `cierre-bodega`; aísla el control de acceso)
- `tests/integration/db/zonas-migration.test.ts` (exclusión de `_cierre_bodega` en el guard de orden de migraciones; patrón 37/38)

## Mapa de trazabilidad R → test

| R | Descripción | Test(s) |
|---|---|---|
| R1 | solo adminSatélite consolida/solicita | `tests/unit/services/cierre-bodega-service.test.ts` (forbidden) · `tests/integration/actions/cierre-bodega-action.test.ts` (unauthenticated + delegación) · UI: `page.tsx` notFound + pre-fetch por rol |
| R2 | solo maestro ve cola/resuelve bodega | `tests/unit/services/cierres-bodega-admin-service.test.ts` (forbidden) · `cierre-bodega-action.test.ts` |
| R3 | adminSatélite acota a SU zona | `cierre-bodega-service.test.ts` (findUsuarioZonaId + WHERE por zona) |
| R4 | adminSatélite sin zona → sinZona, no crea | `cierre-bodega-service.test.ts` · UI `ConsolidacionBodegaModule` (aviso `role=alert`, sin tablas) |
| R5 | lista cierre_dia aprobados consolidables | `cierre-bodega-service.test.ts` · `tests/unit/repositories/cierre-bodega-repository.test.ts` (WHERE aprobado+satélite+zona+null) |
| R6 | cierre_dia `solicitado` pendiente → conflict | `cierre-bodega-service.test.ts` · `cierre-bodega-repository.test.ts` (contarCierresDiaSolicitados) |
| R7 | sin consolidables → conflict, no crea | `cierre-bodega-service.test.ts` |
| R8 | ≤1 `solicitado` por zona (índice único parcial) | `cierre-bodega-service.test.ts` (existe + P2002→conflict) · `cierre-bodega-repository.test.ts` (P2002 propaga) · migración live (índice parcial) |
| R9 | crea CierreBodega + vincula cierre_dia, atómico | `cierre-bodega-repository.test.ts` ($transaction INSERT + updateMany con guardia) |
| R10 | totales snapshot agregados == suma exacta | `cierre-bodega-service.test.ts` (al centavo) · `cierre-bodega-repository.test.ts` (→ Prisma.Decimal) |
| R11 | detalle por cierre_dia (grupos por resultado) + totales agregados | `cierres-bodega-admin-service.test.ts` · `tests/unit/repositories/cierres-bodega-admin-repository.test.ts` (WITH_DETALLE, WHERE cierreId por cierre_dia) · UI modal maestro |
| R12 | evidencia → URL firmada, no path crudo | `cierres-bodega-admin-service.test.ts` (doble ISignedUrlProvider) · UI `VisorEvidencia` |
| R13 | montos string escala 2, snapshot no recompute | `cierres-bodega-admin-service.test.ts` · UI helper `money()` sin parseFloat |
| R14 | detalle NO expone pago al mensajero (feature 39) | `cierres-bodega-admin-service.test.ts` (sin campo `pagoMensajero`) |
| R15 | cola `solicitado` + histórico para maestro | `cierres-bodega-admin-service.test.ts` · `cierres-bodega-admin-repository.test.ts` (orderBy desc + totales string) |
| R16 | aprobar `solicitado` → aprobado | `cierres-bodega-admin-service.test.ts` · `cierres-bodega-admin-repository.test.ts` (updated) |
| R17 | rechazo exige motivo no vacío | `cierres-bodega-admin-service.test.ts` (sin/con motivo) · `cierre-bodega-action.test.ts` (zod motivo vacío) · UI sub-modal |
| R18 | transición guardada, doble resolución → conflict | `cierres-bodega-admin-service.test.ts` · `cierres-bodega-admin-repository.test.ts` (updateMany WHERE estado='solicitado') |
| R19 | id inexistente → no_encontrada, sin efectos | `cierres-bodega-admin-service.test.ts` · `cierres-bodega-admin-repository.test.ts` · `cierre-bodega-action.test.ts` (id inválido) |
| R20 | resueltoPor + resueltoAt al resolver | `cierres-bodega-admin-service.test.ts` · `cierres-bodega-admin-repository.test.ts` (resueltoAt Date) |
| R21 | rechazo inmutable: cierre_dia.cierreBodegaId intacto | `cierres-bodega-admin-repository.test.ts` (resolverCierreBodega no toca cierre_dia) |
| R22 | sin otros efectos (orden/gestion/cierre_dia) | `cierres-bodega-admin-repository.test.ts` (solo toca cierre_bodega) |
| R23 | listar/ver detalle no muta | `cierre-bodega-service.test.ts` · `cierres-bodega-admin-service.test.ts` |
| R24 | RLS habilitada en `cierre_bodega` | migración live (`relrowsecurity=true`) · `zonas-migration.test.ts` (down.sql presente) |
| R25 | migración reversible (rollback round-trip) | round-trip live up→down→up · guard de `down.sql` en `./init.sh` |
| E2E | consolida→solicita→cola→detalle→aprueba/rechaza→histórico | `e2e/cierre-bodega-satelite.spec.ts` (diferido) |

## Decisiones / desviaciones

- **P2002 (R8):** el repo NO captura; propaga `Prisma.PrismaClientKnownRequestError` code `P2002`; el service lo traduce a `conflict`. Documentado en ambos.
- **R14 placeholder:** `CierreBodegaDetalleCierre` no expone campo de pago al mensajero (sin placeholder null); el test verifica ausencia de `pagoMensajero`.
- **Actions con deps:** dos servicios inyectables (`cierreBodegaService` adminSatélite, `cierresBodegaAdminService` maestro) + `getActor`, en vez de un único `service` (dos dominios/roles).
- **UI:** título del `PageHeader` conservado ("Cierres del día") para no romper la feature 38; helpers de detalle extraídos a `cierre-detalle-shared.tsx` y reusados por 38 y 40 (sin duplicar).
- **Test tocado en frontend:** `tests/components/CierresAdminPage.test.tsx` mockea las nuevas actions (por defecto `forbidden`) porque `page.tsx` ahora depende de ellas; determinista, sin DB real.

## Commits (rama `feature/40-cierre-bodega-satelite`, sin PR/merge)

```
7b56956 feat(40): E2E Playwright del cierre de bodega satelite (T10)
a2bfc97 feat(40): UI role-aware de cierre de bodega en /cierres-admin (T8)
d9ab93a test(40): unit services/repos + action integration (Prisma mockeado); R1-R23 cubiertos + exclusion de migracion
48e69d3 feat(40): Server Actions cierre de bodega (deps inyectables, withErrorHandler, zod en el borde)
02c541f feat(40): servicios cierre de bodega (adminSatelite solicita, maestro aprueba/rechaza)
fcb77be feat(40): repositorios Prisma (consolidables, crear atomico+snapshot, detalle WITH_DETALLE, resolver guardado)
0b5227c feat(40): contratos cierre de bodega (interfaces service/repo + schemas zod + Result types)
d3a01fe feat(40): modelo CierreBodega + FK cierre_bodega_id + migracion up/down (RLS, indice unico parcial)
```

## Pendiente (gate humano, fuera del implementer)

Abrir PR a `dev` + merge lo decide el humano/leader tras el reviewer. NO se abrió PR ni se mergeó.
