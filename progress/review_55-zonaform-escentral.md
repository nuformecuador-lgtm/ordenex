# Review — feature 55 (completar ZonaForm: `esCentral` + drift `provincia.zonaId`) · APROBADO (0 bloqueantes)

Fecha: 2026-07-12 · Reviewer (subagente) · Rama `feature/55-zonaform-escentral`

## Veredicto: APROBADO — 0 bloqueantes

## Verificación ejecutable (números obtenidos por el reviewer)
- `./init.sh` → **EXIT 0** (`== init OK ==`).
- `pnpm typecheck` → **0 errores**.
- `pnpm lint` → **0 errores** (135 warnings preexistentes en `.claude/skills/`, ajenos).
- `pnpm test` → **1614/1614 passed** (185 archivos; baseline dev 1565 → +49). Flaky `HomePage.test.tsx` no falló.
- `npx prisma validate` → **valid**; `prisma migrate status` → **up to date**, 25 migraciones, **0 nuevas** (decisión C schema-only confirmada).

## Verificación de las decisiones F1.4
- **(A) Reasignar central transaccional:** `ZonaRepository.create/update` desmarca la central previa con `tx.zona.updateMany` DENTRO de la `$transaction`, antes de escribir la nueva (`ZonaRepository.ts:94-95`, `:170-175`). `P2002` sobre `zona_es_central_unico` → `ConflictError` de dominio; `P2002` de otra constraint se re-lanza (`:61-75`). Tests reales verifican orden de invocación y traducción selectiva; el service devuelve `ok` al marcar 2ª central sin filtrar 500. No tautológico.
- **(B) Reconstrucción completa de ZonaForm:** crear + editar con nombre + provincia/cantón/distritos (N:M) + `cobroVehiculo` + tarifas + toggle `esCentral`. Prefill de distritos en edición desde el **N:M** (`GeoRepository.listDistritos` lee la tabla puente `ZonaDistrito`, no el escalar; `ZonaForm.seedSeleccionEdicion`). OK.
- **(C) Drift solo-schema:** `Provincia` ya no declara `zonaId`/`zona`; `Zona` ya no declara `provincias` (`schema.prisma:221-246`). Grep confirma que ningún código de producción los referencia. Test estático `provincia-schema-drift.test.ts` afirma la ausencia de los 3 símbolos. Sin migración nueva. OK.
- **(D) Seed intacto:** `seed-zonas.ts` nunca toca `es_central`. OK.

## Dictamen checkbox-vs-Modal: MENOR (no bloqueante)
La decisión F1.4-A exige "reasignar CON confirmación" (confirmación explícita antes de reasignar). El checkbox inline "Entiendo que reasignaré la zona central" la cumple de forma bloqueante: sin marcarlo, `submit()` devuelve `validation_error` y NO llama al backend (`ZonaForm.tsx:267-275`); tras confirmar, muta con `esCentral=true` (probado end-to-end en `zona-form.test.tsx:457-480`). El `design.md` presentaba el Modal como ruta RECOMENDADA, no requisito duro. Cumple la decisión aprobada → menor.

## Checklist
- Trazabilidad R1–R14 → test concreto y no tautológico. OK.
- Tasks T0–T10 `[x]`. Bitácora con mapa R→test. OK.
- Capas action→service→repository; zod en el borde; sin `fetch` interno; sin hardcode; gate `maestro` server-side en el catálogo geo. OK.
- CHECKPOINTS.md recorrido sin fallos. OK.

## Menores / deudas (NO bloquean)
1. Camino `conflict` muestra mensaje a nivel formulario (no por-campo) porque `ZonaActionError.conflict` no trae payload — deuda de enriquecer el conflict con el campo afectado.
2. Reasignación como `updateMany` inline en el repo (sin método nombrado en `IZonaRepository`) — autorizado por el design; extraíble si se quiere purismo de capas.
3. `centralActual` (listado) fiable solo si la central está en la página cargada; el backend garantiza la invariante igual.
4. Divergencia escalar↔N:M en prefill de zonas SEMBRADAS — deuda de nivel feature-24, fuera de alcance, documentada en JSDoc de `ZonaForm`.

## Archivos clave revisados
`lib/repositories/ZonaRepository.ts`, `lib/services/GeoService.ts`, `lib/actions/geo.ts`, `lib/repositories/GeoRepository.ts`, `app/(app)/configuracion/_components/ZonaForm.tsx`, `db/schema.prisma`, `tests/integration/db/provincia-schema-drift.test.ts`, `tests/unit/repositories/zona-repository.test.ts`, `tests/unit/services/zona-service.test.ts`, `tests/unit/components/zona-form.test.tsx`, `scripts/seed-zonas.ts`.
