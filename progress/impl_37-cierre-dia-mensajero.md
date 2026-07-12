# Impl 37 — Cierre del día (mensajero) — VERDE (implementado)

Fecha: 2026-07-12 · Coordinador: implementer · Rama: `feature/37-cierre-dia-mensajero`
Subagentes: `backend_dev` (T1–T13) · `frontend_dev` (T14–T17)

> Reemplaza la bitácora previa "BLOQUEADO" (2026-07-11). Ese bloqueo se debía al baseline
> roto por el PR #40 (refactor zonas/tarifas) y a la ausencia del resolver de zona central;
> AMBAS causas quedaron resueltas por la feature 54 (reconciliación, ya en `dev`). La 37 se
> implementó contra el diseño tal cual, sin cambios de spec.

## Veredicto
**VERDE — feature lista para review.** Todas las tasks T0–T19 completadas y marcadas en
`specs/37-cierre-dia-mensajero/tasks.md`.

## Verificación ejecutable (salida real)
- `npx prisma validate` → **valid**
- `pnpm run typecheck` (tsc --noEmit) → **0 errores**
- `pnpm run lint` (eslint) → **0 errores** (135 warnings, todos en `.claude/skills/**`, ajenos a la feature)
- `pnpm test` (vitest run) → **188 files, 1623/1623 passed** (baseline 1565 → +58 tests nuevos)
- `./init.sh` → **== init OK ==** ("todas las migraciones tienen down.sql", ".env presente")
- Migración round-trip (R20): `pnpm run db:rollback` (down.sql, revierte `20260712100000_cierre_dia`
  limpio) → `prisma migrate deploy` (re-aplica solo cierre_dia) → `migrate status` = "Database schema
  is up to date". La DB queda con la migración APLICADA.
  - Nota: `pnpm run db:migrate` (= `prisma migrate dev`) NO sirve para el re-apply porque su check
    de drift de dev detecta una migración PRE-EXISTENTE ajena (`20260711200000_provincia_zona_id_nullable`,
    "modified after applied") y pide reset del schema. El re-apply correcto es `prisma migrate deploy`
    (sin drift-check de dev), que fue como el backend_dev verificó el round-trip. Sin impacto en la 37.

## Archivos nuevos
### Backend
- `db/migrations/20260712100000_cierre_dia/migration.sql` (UP) y `down.sql` (DOWN)
- `lib/types/cierre.ts`
- `lib/config/cierre.ts` (TTL URL firmada; parte de T16)
- `lib/interfaces/services/ICierreDiaService.ts`
- `lib/interfaces/repositories/ICierreDiaRepository.ts`
- `lib/repositories/CierreDiaRepository.ts`
- `lib/services/CierreDiaService.ts`
- `lib/actions/cierre-dia.ts`
- `tests/integration/db/cierre-dia-migration.test.ts`
- `tests/unit/repositories/cierre-dia-repository.test.ts`
- `tests/unit/services/cierre-dia-service.test.ts`
- `tests/integration/actions/cierre-dia-action.test.ts`
### Frontend
- `app/(app)/cierre-dia/page.tsx`
- `app/(app)/cierre-dia/_components/CierreDiaModule.tsx`
- `tests/components/CierreDiaModule.test.tsx`
- `tests/components/CierreDiaPage.test.tsx`
- `e2e/cierre-dia.spec.ts` (escrito, ejecución DIFERIDA; NO corre bajo `pnpm test`)

## Archivos modificados
- `db/schema.prisma` (enums `CierreEstado`/`CierreDestinoTipo`, modelo `CierreDia`, FK `cierreId` +
  índice en `GestionOrden`, inversas en `Usuario`/`Zona`)
- `lib/auth/menu-visibility.ts` (item sidebar "Cierre del día", `roles: ["mensajero"]`, IconKey `clipboardCheck`)
- `app/(app)/_components/Sidebar.tsx` (mapa iconKey → `ClipboardCheck` de lucide)
- `tests/unit/auth/menu-visibility.test.ts` (lista exacta de items del mensajero)
- `tests/integration/db/zonas-migration.test.ts` (añade `_cierre_dia` a la exclusión del check de
  orden de timestamps: la nueva migración pasó a ser la última)
- `specs/37-cierre-dia-mensajero/tasks.md` (T0–T19 marcadas)

## Trazabilidad R → test (cada R con al menos un test concreto)
| R | Test (archivo :: nombre) |
| --- | --- |
| R1 | `tests/unit/services/cierre-dia-service.test.ts` :: "R1/R2: rol != mensajero -> forbidden…"; `tests/integration/actions/cierre-dia-action.test.ts` :: "listar/solicitar con adminSatelite -> forbidden"; `tests/components/CierreDiaPage.test.tsx` :: "rol distinto / sin actor / forbidden -> notFound" |
| R2 | `tests/unit/services/cierre-dia-service.test.ts` :: "R2: resuelve gestiones/conteo/historico SIEMPRE por el usuarioId del actor"; `tests/unit/repositories/cierre-dia-repository.test.ts` :: "R3: filtra por mensajeroId…" |
| R3 | `tests/unit/services/cierre-dia-service.test.ts` :: "R3: agrupa por resultado con las 4 claves siempre presentes"; `tests/unit/repositories/cierre-dia-repository.test.ts` :: "filtra cierreId:null; ordena por createdAt desc"; `tests/components/CierreDiaModule.test.tsx` :: "R3: agrupa en las 4 secciones" |
| R4 | `tests/unit/services/cierre-dia-service.test.ts` :: "R4/R6: entregada expone monto+metodo; reprogramada fecha+motivo"; `tests/components/CierreDiaModule.test.tsx` :: "R4: detalle completo de la orden" |
| R5 | `tests/unit/services/cierre-dia-service.test.ts` :: "R5: firma en lote, expone SOLO la URL firmada, nunca el path"; `tests/components/CierreDiaModule.test.tsx` :: "R5: evidencia vía URL firmada" |
| R6 | `tests/unit/services/cierre-dia-service.test.ts` :: "R4/R6: entregada monto+metodo"; `tests/components/CierreDiaModule.test.tsx` :: "R6: monto (string) + método" |
| R7 | `tests/unit/services/cierre-dia-service.test.ts` :: "R7: totales por metodo + general cuadran"; `tests/components/CierreDiaModule.test.tsx` :: "R7: panel de totales sin reparsear" |
| R8 | `tests/unit/services/cierre-dia-service.test.ts` :: "R8: reprogramada/devuelta/rechazada cuentan $0" |
| R9 | `tests/unit/services/cierre-dia-service.test.ts` :: "R9: suma de 0.10 repetidos exacta (Decimal)" |
| R10 | `tests/unit/services/cierre-dia-service.test.ts` :: "R10: con ordenes pendientes -> conflict, no crea" + "puedesSolicitar false + motivo"; `tests/unit/repositories/cierre-dia-repository.test.ts` :: "cuenta ordenes en_espera_aceptacion/en_reparto"; `tests/components/CierreDiaModule.test.tsx` :: "R10/R11: botón deshabilitado + motivo" |
| R11 | `tests/unit/services/cierre-dia-service.test.ts` :: "R11: sin gestiones pendientes -> conflict, no crea" + "puedesSolicitar false + motivo"; `tests/components/CierreDiaModule.test.tsx` :: "R10/R11: botón deshabilitado + motivo" |
| R12 | `tests/unit/services/cierre-dia-service.test.ts` :: "R12: ya existe cierre solicitado -> conflict, no crea"; `tests/unit/repositories/cierre-dia-repository.test.ts` :: "true si hay cierre solicitado del mensajero" |
| R13 | `tests/unit/repositories/cierre-dia-repository.test.ts` :: "en $transaction: INSERT cierre_dia + vincular gestiones pendientes; devuelve id"; `tests/integration/actions/cierre-dia-action.test.ts` :: "crea un cierre solicitado y lo deja en el historico" |
| R14 | `tests/unit/services/cierre-dia-service.test.ts` :: "R15… R14 snapshot totales"; `tests/unit/repositories/cierre-dia-repository.test.ts` :: "totales snapshot como Prisma.Decimal" |
| R15 | `tests/unit/services/cierre-dia-service.test.ts` :: "R15: zona==central -> bodega_central"; "R15: zona no-central -> bodega_satelite"; "R15 + design §6: findCentralZonaId null -> fallback seguro" |
| R16 | `tests/unit/services/cierre-dia-service.test.ts` :: "R16: mensajero sin zona -> validation_error, no crea" |
| R17 | `tests/unit/services/cierre-dia-service.test.ts` :: "R17: listar NO muta (nunca invoca crearCierre)" |
| R18 | `tests/integration/actions/cierre-dia-action.test.ts` :: "crea… visible en el historico"; `tests/unit/repositories/cierre-dia-repository.test.ts` :: "mapea totales STRING toFixed(2) + solicitadoAt ISO"; `tests/components/CierreDiaModule.test.tsx` :: "R18: histórico lista cierres pasados" + "estado vacío" |
| R19 | `tests/integration/db/cierre-dia-migration.test.ts` :: "R19: RLS habilitada sin policies (solo service role)" |
| R20 | `tests/integration/db/cierre-dia-migration.test.ts` :: "DOWN — reversible en orden inverso (R20)" + round-trip real verificado en DB (rollback→deploy→status up to date) |
| E2E `prov. F1.4-g` | `e2e/cierre-dia.spec.ts` :: "ve totales por método → Solicitar cierre → aparece 'Solicitado' en el histórico" (ESCRITO, ejecución diferida — patrón del repo, sin harness de seed/login e2e) |

## Decisiones / desviaciones tomadas (sin improvisar el spec)
- **Caso `findCentralZonaId() === null` (design §6, ligado a feature 55 pending):** respetado. Con
  `centralZonaId` null, ningún mensajero clasifica como central → `destinoTipo = bodega_satelite`,
  `destinoZonaId = zona del mensajero` (fallback seguro, NO lanza). La clasificación a `bodega_central`
  empezará a funcionar en runtime cuando la 55 marque una zona central. Los tests unit de R15 usan un
  doble que SÍ devuelve id, cubriendo GAM→central y no-GAM→satélite.
- **FKs de `cierre_dia`:** `mensajero_id`→usuario y `destino_zona_id`→zona con `ON DELETE RESTRICT`
  (el design §1.5 no fijaba la acción de delete para estas dos; un cierre es registro operativo que no
  debe borrarse por cascada). La FK `gestion_orden.cierre_id` sí es `ON DELETE SET NULL` como manda el design.
- **`lib/config/cierre.ts`** lo creó backend_dev (TTL de la URL firmada) porque el service lo necesita;
  reusa el bucket de evidencias de la feature 36 (`gestion_orden`). El resto de T16 (item de sidebar) lo hizo frontend_dev.
- **Sidebar:** nuevo `IconKey "clipboardCheck"` (lucide `ClipboardCheck`). La defensa real de acceso es
  el `notFound()` server-side de la página (design §4.2 / feature 36 §6), no el ocultar el item.
- **Money-safe:** montos/totales cruzan la frontera como STRING (`Decimal.toFixed(2)`); sumas con
  `Prisma.Decimal`; la UI renderiza los strings tal cual, sin `parseFloat`/`Number`.

## Cobertura de R
Todos los R1–R20 + E2E quedaron cubiertos con al menos un test concreto (tabla arriba). El E2E se
escribió pero su EJECUCIÓN queda diferida (patrón del repo: sin harness de seed/login e2e; igual que
`auth`/`mis-asignaciones`/`recepcion-satelite`/`asignacion-satelite`). NO corre bajo `pnpm test`.
