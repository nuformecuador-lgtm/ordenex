# 335 — Bitácora de implementación

Rama: `feature/335-filtros-desde-url` · worktree `C:/w335` · base `origin/dev` (2f9f3f6f).

## T0.1 — Baseline (2026-08-31, antes de tocar nada)

- `components/shared/BuscadorFiltros.tsx` y `components/shared/FilterComponent.tsx`
  **idénticos a `origin/dev`** (`git diff --stat origin/dev --` sin salida). La 326 no los
  ha movido todavía.
- `pnpm db:generate` fue necesario: el worktree recién creado no tenía cliente Prisma y el
  typecheck daba 14 errores fantasma `Module '@prisma/client' has no exported member`.
  **No son rojos del repo**, son árbol sin generar.
- `pnpm typecheck` → **verde, 0 errores**.
- Subconjunto de tests que esta ficha puede tocar
  (`tests/unit/components`, `CierresAdminFiltros`, `HistoricoFiltros`, `NovedadesBuscador`,
  `CierresAdminDeepLink`, `descarga/SateliteDescarga`, `tests/components/paginacion`):
  **77 archivos / 1053 tests, 0 rojos**, 192 s.

**Baseline de rojos preexistentes en el perímetro de la ficha: 0.**
