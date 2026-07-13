# Review — feature 38 (admin: cierres del día, aprobar/rechazar) · APROBADO (0 bloqueantes)

Fecha: 2026-07-12 · Reviewer (subagente) · Rama `feature/38-cierres-admin` @ `0418a1a` (sobre `origin/dev` 63d02f0)

## Veredicto: APROBADO — 0 bloqueantes

## Verificación ejecutable (números obtenidos por el reviewer)
- `pnpm run typecheck` → 0 errores.
- `./init.sh` → VERDE: typecheck 0, lint 0 (135 warnings preexistentes en `.claude/skills/`), **197 archivos / 1739 tests passed**, "todas las migraciones tienen down.sql", `== init OK ==`. Flaky `HomePage.test.tsx` pasó (no hizo falta reintento).
- Round-trip migración `20260712110000_cierre_dia_resolucion`: `db:rollback` (down) exit 0 + `migrate deploy` (up) exit 0. Migración puramente ADITIVA (ADD COLUMN/CONSTRAINT/INDEX); RLS de `cierre_dia` (de la 37) intacta (test estático confirma que up/down no tocan RLS).

## Decisiones F1.4 — todas respetadas
- **(a) Rechazo inmutable:** `resolverCierre` es un único `updateMany` sobre `cierre_dia`; NO toca `gestion_orden` (test repo R15). Sin desbloqueo/re-solicitud (eso es la 41).
- **(b) Detalle reusado:** `CierresAdminRepository` importa `WITH_DETALLE`/`toPendienteRow` de la 37 y el service usa `toDetalleDTO`; sin DTO duplicado.
- **(c)** Cola `solicitado` + histórico `aprobado`/`rechazado`, acotados al alcance.
- **(d) Concurrencia sin TOCTOU:** `updateMany WHERE id + estado='solicitado' + alcance`; `count===1`→ok, `count===0`→ `count()` de alcance decide `conflict` vs `fuera_de_alcance`. Sin read-check-write.
- **(e) Auditoría:** `resuelto_por` FK `ON DELETE SET NULL`, `resuelto_at`, `motivo_rechazo`; motivo obligatorio validado en zod (`.trim().min(1)`) y re-validado en el service.
- **(f)** `e2e/cierres-admin.spec.ts` existe (aprobar + rechazar-con-motivo, totales snapshot + evidencia firmada), ejecución diferida.
- **(g)** De a uno con detalle a la vista.

## Seguridad money-critical / autorización
- **Alcance en el WHERE** en los tres puntos: listado (`findCierresByAlcance`), detalle (`findCierreByIdEnAlcance`) y transición (`resolverCierre`) — nunca en memoria. `maestro`→`bodega_central` sin zona; `adminSatelite`→`bodega_satelite`+`findUsuarioZonaId`.
- `adminSatelite` sin zona: listado vacío+`sinZona`; detalle/aprobar/rechazar → `no_encontrada` sin consultar el repo (no filtra existencia). Otro rol → `notFound()` en `page.tsx` + `forbidden` en el service.
- Evidencias solo por URL firmada (test R7: el DTO NO expone `evidenciaStoragePath`). Totales = snapshot vía `toFixed(2)` string; sin `parseFloat`/`Number(` sobre montos.

## Trazabilidad
R1–R17 + E2E → test concreto y no tautológico (validados: cierre de otra zona/bodega rechazado; 2ª transición → conflict; rechazar sin motivo → validation_error). Tasks T0..Tn `[x]`. Bitácora `impl_38` con mapa R→test.

## Menores / deudas (NO bloquean)
1. Tests de `resolverCierre` (R10/R12) y de migración son unit con Prisma mockeado / estáticos (regex sobre SQL), no integración contra DB real, pese a que la trazabilidad decía "integración repo/DB". Consistente con el patrón del repo (`cierre-dia-repository`/`cierre-dia-migration`); el round-trip real lo corrió el reviewer. La concurrencia real (dos `updateMany` simultáneos) no se ejercita en DB. Deuda menor.
2. E2E escrito con ejecución diferida (patrón features 33/34/36/37).

## Archivos clave revisados
`lib/services/CierresAdminService.ts`, `lib/repositories/CierresAdminRepository.ts`, `lib/actions/cierres-admin.ts`, `lib/types/cierres-admin.ts`, `app/(app)/cierres-admin/page.tsx`, `db/migrations/20260712110000_cierre_dia_resolucion/{migration,down}.sql`, los 5 archivos de test + `e2e/cierres-admin.spec.ts`.
