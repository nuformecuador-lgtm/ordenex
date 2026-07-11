# Review — Feature 23 · Dashboard del admin maestro (FRONTEND)

> Reviewer. No se editó código. Verificación ejecutada con **npm** en el worktree f23
> (rama `feature/23-dashboard-maestro`).

## Veredicto: **CAMBIOS REQUERIDOS**

Motivo: la implementación es correcta y toda la funcionalidad + trazabilidad está
verde, pero `specs/23-dashboard-maestro/tasks.md` tiene las 14 tasks (T0–T13) sin
marcar (`[ ]`). CHECKPOINTS exige "todas las tasks marcadas `[x]`" para pasar a
`done`. Es un arreglo de bookkeeping (vuelve al implementer, sin tocar código).

## Verificación ejecutable (corrida por el reviewer)

- `npm run typecheck` → **VERDE** (0 errores).
- `npm run lint` → **VERDE** (0 errores; 135 warnings, todos bajo `.claude/skills/**`, ajenos).
- `npm test` (suite completa) → **VERDE**, 1018/1018, 130 archivos.
- Tests dirigidos (23 nuevos/ajustados de la 23) → **VERDE** 23/23.
- `./init.sh` → EXIT 0 (`== init OK ==`). En su corrida embebida de vitest bajo carga
  cayeron 2 casos de `tests/unit/components/usuario-form.test.tsx` por **timeout**
  (ajenos a la 23); pasan limpios en la corrida `npm test` normal (1018/1018).
  Flaky de I/O bajo carga, NO bloqueante.

## Trazabilidad R → test (todos mapean a test que verifica de verdad)

| Req | Test | OK |
| --- | --- | --- |
| R1 | HomePageMaestro :: maestro / admin → "Panel maestro" | ✓ |
| R2 | HomePageMaestro :: adminTienda → "Panel de tienda" (26 intacta, listar no llamado) | ✓ |
| R3 | HomePageMaestro :: mensajero/adminSatelite/null → "Bienvenido" | ✓ |
| R4 | HomePageMaestro :: resolveActorFromSession llamado 1 vez (server-side) | ✓ |
| R5 | HomePageMaestro :: heading "Panel maestro" + panel como único bloque | ✓ |
| R6 | Panel :: al montar invoca listarPostulacionesPendientes y lista items | ✓ |
| R7 | PostulacionCard :: datos completos + nulos como "—" | ✓ |
| R8 | PostulacionCard :: 5 enlaces "Ver", href firmado, target _blank, rel noopener noreferrer, orden fijo | ✓ |
| R9 | Panel :: Pagination con page/pageSize/total del backend; click → page 2 | ✓ |
| R10 | Panel :: estado carga (role=status "Cargando") | ✓ |
| R11 | Panel :: "No hay postulaciones pendientes" con lista vacía | ✓ |
| R12 | Panel :: ActionError → role=alert sin PII | ✓ |
| R13 | PostulacionCard :: botones Aprobar/Rechazar cableados con la postulación | ✓ |
| R14 | Panel :: aprobar abre Modal con nombre + acción | ✓ |
| R15 | Panel :: confirmar → aprobar/rechazarPostulacion(usuarioId) | ✓ |
| R16 | Panel :: durante la action spinner + confirmar deshabilitado (anti doble-submit) | ✓ |
| R17 | Panel :: ok → toast éxito + mutate + fila desaparece | ✓ |
| R18 | Panel :: ActionError → toast mapeado + fila permanece | ✓ |
| R19 | Estructural: tests mockean solo las 3 actions de la 22; ningún componente importa services/repos/prisma | ✓ |

Decisiones F1.4: A1 (enlaces "Ver" _blank + rel noopener noreferrer, sin visor) →
verificado R8. A2 (refresco SWR regenera URLs, TTL backend intacto) → verificado
por `mutate()` post-acción (R17); no se tocó backend. A3 (rechazo sin motivo, action
solo `id`) → verificado R15.

## Correctitud y patrón

- `page.tsx`: rama adminTienda (26) INTACTA primero; maestro/admin → AdminMaestroDashboard;
  resto/null → "Bienvenido". +8 líneas, sin alterar lógica de sesión existente. ✓
- AdminMaestroDashboard: Server Component (PageHeader + panel), patrón AdminTiendaDashboard. ✓
- Panel: SWR + Modal async (feature 13) + Toast + Pagination; reusa shared. ✓
- Ajuste a `HomePageRol.test.tsx` (26): LEGÍTIMO. R1 de la 23 mueve maestro/admin fuera
  del placeholder; el caso R3 se acotó a mensajero/adminSatelite y la rama adminTienda
  queda intacta (test R1/R2/R5 de la 26 verdes). ✓

## Alcance (frontend puro)

Commit `0c7af9e` toca solo: `app/(app)/_components/*` (5 nuevos), `page.tsx` (+8),
3 tests nuevos, `HomePageRol.test.tsx` (+7/-3), impl doc. **Cero** backend, DB,
migraciones o `lib/actions/aprobacion-postulaciones.ts`. ✓

## Hallazgos

- **MAYOR (bloqueante):** `specs/23-dashboard-maestro/tasks.md` con las 14 tasks
  (T0–T13) sin marcar `[x]`; CHECKPOINTS exige todas marcadas. Fix: marcarlas
  (bookkeeping, sin cambio de código). Vuelve al implementer.
- **menor:** el impl doc afirma "1 flaky por corrida"; en mi `npm test` limpio pasó
  1018/1018 y el flaky solo apareció bajo la carga de `./init.sh` (usuario-form,
  ajeno). Sin impacto funcional.

## Checklist CHECKPOINTS

- [x] requirements.md (EARS R1–R19), design.md, tasks.md existen
- [ ] tasks.md con todas `[x]`  ← incumplido (ver MAYOR)
- [x] Cada R mapea a test concreto; impl doc contiene el mapa R→test
- [x] typecheck / lint / test verdes (npm)
- [x] init.sh EXIT 0
- [x] Sin secretos, sin backend/DB tocados (frontend puro; RLS/webhooks/migraciones N/A)

---

## Resolución (leader, 2026-07-10)
- **MAYOR (documental) RESUELTO:** las 14 tasks (T0–T13) de `tasks.md` marcadas `[x]`. El código ya
  estaba verde (typecheck/lint/`npm test` 1018/1018, init.sh EXIT 0, R1–R19 mapeados). **Veredicto final: APROBADO.**
