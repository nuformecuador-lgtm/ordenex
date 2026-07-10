# Sesión activa

> Estado vivo de lo que se esta trabajando ahora. El leader lo mantiene al dia.
> Al cerrar una feature, se limpia de aca y se resume en history.md.

## Features en curso

| Branch | Zona | Fase | Estado |
|--------|------|------|--------|
| feature/12-notificaciones-fix | backend | F2.4 | **impl COMPLETA + reviewer APROBADO (0 bloqueantes)**. Spec regenerado y aprobado 2026-07-09 (el anterior se perdio con el worktree ../ordenex-f12 sin pushear). Decisiones humanas cerradas: DIFERIR auth (solo `lib/actions/ordenes.ts`); INTERNAL -> re-lanzar (sin nuevo miembro en ActionError); alcance solo backend (toasts = feature 11); UI-safe via adaptador `toActionError`; CONSERVAR `id` en fieldErrors. Suite 51 files / 384 tests verdes. Commit + push hechos a `origin/feature/12-notificaciones-fix`. **PR pendiente de abrir a mano** (gh no instalado): https://github.com/nuformecuador-lgtm/ordenex/pull/new/feature/12-notificaciones-fix -> base `dev`. Pasa a `done` cuando el humano mergee. |

> Reconciliacion 2026-07-09 (leader): las features 9 (carga-masiva, PR #5 d4a21c8) y
> 13 (modal, PR #6 26c3272) ya estaban mergeadas a `origin/dev` pero seguian marcadas
> `in_progress` en `feature_list.json` (violaba la regla una-feature-por-zona en init.sh:
> dos frontend in_progress). Ambas -> `done`, entradas anadidas a `history.md`, limpiadas
> de esta tabla. Ademas el cliente Prisma no estaba generado (9 test files rojos por
> `.prisma/client/default`); `pnpm db:generate` -> suite verde 51 files / 379 tests.

## Evaluaciones

> El leader documenta aca cada evaluacion de zone/complexity/particion.

- `paginacion` (id 8): **zone=frontend, complexity=medium, branch=feature/8-paginacion,
  depends_on=null.** Evaluada como frontend puro (compone con DataTable de feature 7;
  el backend `listarOrdenes({page,pageSize})` de feature 6 ya existe, no se toca).
  No es fullstack → sin particion. Rama creada desde `origin/dev` (ya al dia con
  order-list). Decisiones humanas Q1-Q4 (2026-07-09): server-side, selector 10/25/50
  (reset a pag 1), botones primera/ultima, ventana numerica con elipsis + aria-current.
- `componente carga masiva` (id 9): **zone=frontend, complexity=medium.** Componente
  de subida de archivo parametrizable (tipo, ruta API, plantilla). Zona ocupada por
  la 8 → en espera.
- `manejador de errores` (id 10): **zone=backend, complexity=medium,
  branch=feature/10-manejador-errores, depends_on=null.** SELECCIONADA (2026-07-09):
  zona backend libre mientras la 8 (frontend) sigue abierta → corren en paralelo.
  Estructura de error comun + wrapper para Server Actions/endpoints; NO toca UI.
  Worktree creado desde `origin/dev` en `../ordenex-f10`. Fase 1 (spec) en curso.
- `notificaciones` (id 11): **zone=frontend, complexity=low.** Toast de mensajes.
- `notificaciones - fix` (id 12): **zone=backend, complexity=medium, depends_on=10.**
  Reemplaza switch-case de errores por el manejador global (necesita la 10 done).
- `modal` (id 13): **zone=frontend, complexity=medium.** Modal reutilizable con
  soporte async (spinner + bloqueo de confirmacion).
- `ordenes - carga masiva` (id 14): **zone=frontend, complexity=low, depends_on=9.**
  Boton en ordenes que abre modal con el componente de carga masiva.

## Conflictos pendientes

> Conflictos de merge que el agente no pudo resolver solo. El humano decide.

(Ninguno por ahora)

## Plan de la sesion
- [x] Features 1-10, 9, 13: ciclos SDD completos (ver history.md).
- [ ] Feature 12 (backend): spec_ready, PARADA en puerta de aprobacion humana.
- [ ] Features 11, 14, 15...: evaluacion -> spec -> aprobacion -> impl -> review -> done.

## Notas / decisiones tomadas
- Modelos legacy de AGENTS.md (sonnet-4/opus-4.8) mapeados a sonnet/opus/haiku.
- Decision del humano (2026-07-09): TODOS los agentes con `opus`, ignorando la
  gradacion por complexity (la tabla resuelve a opus en todas las columnas).
- frontend_dev escalado de haiku a sonnet en login(home) por verificacion falsa.
- (2026-07-09) Refactor del proceso: ramas desde `dev`, PRs hacia `dev`,
  evaluacion automatica de `zone`/`complexity`, particion de `fullstack` y
  paralelismo por zonas disjuntas.

## Bloqueos / preguntas abiertas
- DEUDA DE DESPLIEGUE (aceptada, requiere entorno con DB real): ejecutar E2E de
  auth en verde (T017), verificar rechazo RLS con key anon (T004) y rollback de
  migracion (T020). Hasta correrlos, CHECKPOINTS no se cumple al 100% pese al
  estado `done`.
