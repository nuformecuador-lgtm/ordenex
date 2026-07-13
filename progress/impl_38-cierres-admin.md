# progress/impl_38-cierres-admin.md — Feature 38: "Admin: cierres del día (aprobar/rechazar)"

Rama: `feature/38-cierres-admin` (desde `origin/dev`, con features 37 y 55). Fase 2 (implementación).
Puerta F1.4 aprobada por el humano el 2026-07-12. depends_on: 37 (`done`).

## Veredicto (autoverificación del implementer, NO autoaprobación)

**VERDE.** Todas las tasks T0..T16 completas. `./init.sh` → `== init OK ==`. El reviewer decide.

## Verificación ejecutable (salida real)

| Comando | Resultado |
| --- | --- |
| `npx prisma validate` | schema válido |
| `pnpm run typecheck` | exit 0 — **0 errores** |
| `pnpm run lint` | exit 0 — **0 errores** (135 warnings, todas preexistentes en `.claude/skills/`; 0 en archivos de la 38) |
| `pnpm test` | **1739 passed / 1739** (197 files) — incluye los tests nuevos de la 38 |
| `./init.sh` | `todas las migraciones tienen down.sql` · `.env presente` · `== init OK ==` |
| Migración round-trip | up→down→up **limpio** (verificado por backend_dev: columnas+FK+idx tras UP, ausentes tras DOWN, restauradas tras UP; **RLS de `cierre_dia` intacta** en todo el ciclo) |

Baseline de `dev` antes de tocar nada: typecheck exit 0 sobre HEAD `ce6e731`.

## Decisiones F1.4 implementadas (aprobadas)

- (a) Rechazo INMUTABLE: aprobar/rechazar solo cambia `estado`; `gestion_orden.cierre_id` NO se desvincula (R15). Sin desbloqueo/re-solicitud (feature 41).
- (b) Detalle REUSA `CierreDetalleGestion` + `WITH_DETALLE` + firma de evidencia de la 37 (exportados `WITH_DETALLE`/`toPendienteRow`/`DetalleRow` en repo y `toDetalleDTO` en service, reuso sin duplicar).
- (c) Vista = cola `solicitado` (pendientes) + histórico `aprobado`/`rechazado` del alcance.
- (d) Concurrencia: `updateMany ... WHERE id=X AND estado='solicitado' AND <alcance>`; count 0 en alcance → `conflict`, fuera de alcance → `no_encontrada`.
- (e) Migración aditiva única: `resuelto_por` (FK usuario, ON DELETE SET NULL), `resuelto_at`, `motivo_rechazo`; motivo obligatorio al rechazar (zod en borde + defensa en service). RLS intacta.
- (f) E2E `e2e/cierres-admin.spec.ts` escrito, ejecución diferida.
- (g) De a UNO con el detalle a la vista.

## Alcance por rol+zona (server-side)

- `maestro` → cierres `destinoTipo = bodega_central` (sin filtro de zona).
- `adminSatelite` → `destinoTipo = bodega_satelite` Y `destinoZonaId = findUsuarioZonaId(actor)`; sin zona → módulo vacío + aviso (R3).
- Otro rol / sin sesión → `notFound()` server-side (R1). Alcance en el WHERE del repo (R2/R13), nunca en memoria.

## Archivos creados

**Backend (backend_dev)**
- `db/migrations/20260712110000_cierre_dia_resolucion/migration.sql`
- `db/migrations/20260712110000_cierre_dia_resolucion/down.sql`
- `lib/interfaces/services/ICierresAdminService.ts`
- `lib/interfaces/repositories/ICierresAdminRepository.ts`
- `lib/types/cierres-admin.ts`
- `lib/repositories/CierresAdminRepository.ts`
- `lib/services/CierresAdminService.ts`
- `lib/actions/cierres-admin.ts`
- `tests/unit/services/cierres-admin-service.test.ts`
- `tests/unit/repositories/cierres-admin-repository.test.ts`
- `tests/integration/actions/cierres-admin-action.test.ts`
- `tests/integration/db/cierre-dia-resolucion-migration.test.ts`

**Frontend (frontend_dev)**
- `app/(app)/cierres-admin/page.tsx`
- `app/(app)/cierres-admin/_components/CierresAdminModule.tsx`
- `e2e/cierres-admin.spec.ts`
- `tests/components/CierresAdminPage.test.tsx`
- `tests/components/CierresAdminModule.test.tsx`

## Archivos modificados

- `db/schema.prisma` — `CierreDia`: +`resueltoPor`/`resueltoAt`/`motivoRechazo` + relación `resueltoPorUsuario` + `@@index([resueltoPor])`; `Usuario`: +`cierresResueltos` (relación inversa `CierreResueltoPor`).
- `lib/repositories/CierreDiaRepository.ts` — exportados `WITH_DETALLE`/`toPendienteRow`/`DetalleRow` (reuso sin duplicar).
- `lib/services/CierreDiaService.ts` — exportado `toDetalleDTO` (reuso del mapper de detalle).
- `lib/auth/menu-visibility.ts` — item "Cierres del día" → `/cierres-admin`, roles `[maestro, adminSatelite]` (el item del mensajero `/cierre-dia` quedó intacto).
- `tests/unit/auth/menu-visibility.test.ts` — casos de visibilidad del nuevo item.
- `tests/integration/db/zonas-migration.test.ts` — exclusión `_cierre_dia_resolucion` en la lista curada de migraciones apéndice (mantenimiento igual a 37/54).
- `specs/38-cierres-admin/tasks.md` — T0..T16 marcadas `[x]`.

## Trazabilidad R → test (cada R al menos un test)

| R | Test(s) |
| --- | --- |
| R1 (acceso solo maestro/adminSatelite; resto notFound) | `tests/components/CierresAdminPage.test.tsx` (roles no admin / sin sesión → notFound) · `tests/unit/services/cierres-admin-service.test.ts` (rol inválido → forbidden) · `tests/integration/actions/cierres-admin-action.test.ts` (sin sesión → unauthenticated) |
| R2 (alcance por rol+zona en el WHERE) | `cierres-admin-service.test.ts` (maestro→bodega_central; adminSatelite→bodega_satelite+su zona) · `tests/unit/repositories/cierres-admin-repository.test.ts` (findCierresByAlcance: set multi-zona/tipo → solo alcance) |
| R3 (adminSatelite sin zona → vacío + sinZona) | `cierres-admin-service.test.ts` (sinZona listas vacías) · `CierresAdminPage.test.tsx` + `CierresAdminModule.test.tsx` (aviso accionable, sin tablas) |
| R4 (cola pendientes con totales) | `cierres-admin-service.test.ts` (partición pendientes) · `CierresAdminModule.test.tsx` (lista pendientes) · `cierres-admin-repository.test.ts` |
| R5 (histórico aprobado/rechazado) | `cierres-admin-service.test.ts` (partición histórico) · `CierresAdminModule.test.tsx` (histórico solo lectura, sin botones) |
| R6 (detalle por resultado, reuso DTO 37) | `cierres-admin-service.test.ts` (agrupa por resultado) · `cierres-admin-repository.test.ts` (gestiones WHERE cierre_id) · `CierresAdminModule.test.tsx` (monto+método) |
| R7 (evidencia solo URL firmada) | `cierres-admin-service.test.ts` (doble ISignedUrlProvider: URL firmada, no storage_path) · `CierresAdminModule.test.tsx` (visor por URL firmada) |
| R8 (totales = snapshot) | `cierres-admin-service.test.ts` (totales == snapshot) · `CierresAdminModule.test.tsx` (panel de totales snapshot) |
| R9 (Decimal→string escala 2) | `cierres-admin-service.test.ts` · `cierres-admin-repository.test.ts` · `CierresAdminModule.test.tsx` (render string, sin parseFloat) |
| R10 (aprobar solicitado→aprobado) | `cierres-admin-repository.test.ts` (updateMany count=1→updated) · `cierres-admin-service.test.ts` (aprobar→ok) · `CierresAdminModule.test.tsx` (botón Aprobar) |
| R11 (rechazo exige motivo) | `cierres-admin-service.test.ts` (sin motivo→validation_error; con motivo→ok) · `cierres-admin-action.test.ts` (motivo vacío→validation_error) · `CierresAdminModule.test.tsx` (sub-modal exige motivo) |
| R12 (idempotencia/concurrencia → conflict) | `cierres-admin-repository.test.ts` (doble resolverCierre→conflict) · `cierres-admin-service.test.ts` (conflict) |
| R13 (fuera de alcance → sin efectos) | `cierres-admin-repository.test.ts` (fuera_de_alcance; findCierreByIdEnAlcance→null) · `cierres-admin-service.test.ts` (→no_encontrada) |
| R14 (auditoría resueltoPor + resueltoAt) | `cierres-admin-repository.test.ts` (data lleva resueltoPor + resueltoAt(Date); aprobar → motivoRechazo null) |
| R15 (sin efectos colaterales; cierre_id intacto) | `cierres-admin-repository.test.ts` (gestion_orden no tocado; único statement) |
| R16 (solo lectura salvo transición) | `cierres-admin-service.test.ts` (listar/ver detalle nunca invocan resolverCierre) |
| R17 (migración versionada + reversible + RLS) | `tests/integration/db/cierre-dia-resolucion-migration.test.ts` (columnas/FK/idx, RLS habilitada, down reversible) + round-trip up→down→up manual verificado |
| E2E (F1.4-f) | `e2e/cierres-admin.spec.ts` (solicitado → detalle[totales+evidencia] → aprobar/rechazar[con motivo] → histórico; ejecución diferida) |

## Notas / desviaciones

- `resolverCierre` es un único `updateMany` (guardia estado+alcance, decisión d), sin `$transaction` multi-tabla; no toca `gestion_orden` (R15).
- `verCierreDetalle`/`aprobar`/`rechazar` con adminSatelite sin zona → `no_encontrada` (no hay alcance válido; evita filtrar existencia), consistente con R13.
- `zonaRepo.findCentralZonaId` se inyecta por contrato pero queda como verificación defensiva reservada: el destino ya viene persistido por la 37 (design §3.1).
- Sidebar reusa `iconKey: clipboardCheck` (no se inventaron iconKeys nuevos).
- Suite estable en verde en dos corridas independientes (1739/1739); flakiness ajena a la 38 (guard `no-embalaje` que camina el repo bajo carga paralela) que no reincidió.

## Estado de commits

Cambios en el working tree de `feature/38-cierres-admin`, SIN commitear (a decisión del leader/reviewer). NO se abrió PR ni se mergeó a `dev`.
