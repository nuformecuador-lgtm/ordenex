# Review — feature 37 (Mensajero: "Cierre del día") · APROBADO (0 bloqueantes)

Fecha: 2026-07-12 · Reviewer (subagente) · Rama `feature/37-cierre-dia-mensajero` @ `59d5b23`

## Veredicto: APROBADO — 0 bloqueantes

## Verificación ejecutable (números obtenidos por el reviewer, no del reporte del implementer)
- `./init.sh` → **== init OK ==** (verde); valida "todas las migraciones tienen down.sql" + ".env presente".
- `pnpm test` (vitest) → **188 archivos, 1623/1623 passed** (baseline 1565 → **+58**).
- `pnpm run lint` → **0 errores** (135 warnings, todos en `.claude/skills/**`, ajenos).
- `pnpm run typecheck` (tsc --noEmit) → **0 errores**.
- Flaky `HomePage.test.tsx` no hizo falta re-correrlo (todo verde a la primera).

## Checklist
- **Trazabilidad R→test (regla #4):** R1–R20 + E2E, cada uno con test concreto que ejercita el requisito (revisados uno a uno; ninguno vacío/tautológico). OK.
- **Money-critical (R6–R9, R14):** montos con `Prisma.Decimal`, cruzan la frontera como **string** (`toFixed(2)`); **cero** `parseFloat`/`Number(`/`toNumber(` sobre montos (service/repo/UI). R9 probado `0.10×10=1.00` exacto. Snapshot R14 congela totales en `crearCierre`. Totales cuadran al centavo. OK.
- **Seguridad/autorización (R1,R2,R5,R19):** `page.tsx` → `notFound()` si `rol !== 'mensajero'` o resultado no `ok`; repo filtra por `mensajeroId`/`cierreId:null`; evidencias solo por URL firmada (el DTO omite `evidenciaStoragePath`, verificado en `toDetalleDTO`); RLS `ENABLE ROW LEVEL SECURITY` sin `CREATE POLICY`. OK.
- **Migración (R19,R20):** enums + `cierre_dia` + FK `cierre_id` en `gestion_orden` + RLS; `down.sql` en orden inverso; test estático (patrón del repo) + round-trip manual documentado. OK.
- **Ruteo por zona (R15,R16):** `IZonaRepository.findCentralZonaId()`, nunca lee `esCentral`; `centralZonaId === null` → fallback seguro a `bodega_satelite` sin lanzar; sin `zonaId` → `validation_error` sin crear. OK.
- **Alcance:** el service solo escribe `solicitado`; sin lógica de aprobar/rechazar (fuera de alcance = feat 38/39/41). OK.
- **Convenciones:** Controller(action)→Service(DI)→Repository(Prisma); `withErrorHandler` + `UnauthenticatedError` en el borde; sin `fetch` a rutas internas; TTL de URL firmada por `lib/config/cierre.ts` (sin hardcode). OK.
- **Tasks:** T0–T19 `[x]`. Bitácora `progress/impl_37-*.md` con mapa R→test completo. OK.

## Notas menores / deudas (NO bloquean)
1. R19/R20 se verifican con test estático (regex sobre `migration.sql`/`down.sql`) + round-trip manual, no con apply/rollback automatizado contra Postgres. Patrón establecido del repo (los 13 `*-migration.test.ts` usan `readFileSync`). Aceptable.
2. E2E escrito con ejecución diferida (`e2e/cierre-dia.spec.ts`, no corre bajo `pnpm test`) — patrón del repo. El flujo crítico de dinero queda cubierto además por el test de integración de actions.
3. **Limitación conocida ligada a feature 55:** en runtime `findCentralZonaId()` devuelve `null` hasta que la 55 marque la zona central → `bodega_central` no se dispara aún en producción (fallback a satélite). Documentado en design §6 y bitácora; la lógica sí está cubierta en unit R15. Deuda de la 55, no defecto de la 37.

## Archivos clave revisados
`lib/services/CierreDiaService.ts`, `lib/repositories/CierreDiaRepository.ts`, `lib/actions/cierre-dia.ts`, `app/(app)/cierre-dia/page.tsx`, `app/(app)/cierre-dia/_components/CierreDiaModule.tsx`, `db/migrations/20260712100000_cierre_dia/{migration.sql,down.sql}`, y los 4 archivos de test (`tests/unit/services/cierre-dia-service.test.ts`, `tests/unit/repositories/cierre-dia-repository.test.ts`, `tests/integration/actions/cierre-dia-action.test.ts`, `tests/integration/db/cierre-dia-migration.test.ts`).
