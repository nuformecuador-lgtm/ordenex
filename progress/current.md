# Sesión activa

> Estado vivo de lo que se esta trabajando ahora. El leader lo mantiene al dia.
> Al cerrar una feature, se limpia de aca y se resume en history.md.

## Features en curso

| Branch | Zona | Fase | Estado |
|--------|------|------|--------|
| feature/14-ordenes-carga-masiva | frontend | F1 spec | SELECCIONADA por F1.0 (feature 14, frontend, `low`). Botón en `/ordenes` que abre un Modal (feature 13) con el `BulkUpload` (feature 9) apuntando al endpoint `/api/ordenes/carga-masiva` (feature 15). Todas las dependencias `done`. Branch desde `origin/dev`. spec_author en curso. |

> Feature 15 (endpoint carga masiva) CERRADA 2026-07-10: PR #9 mergeado a `origin/dev`
> (aff6e73), status -> `done`, entrada en `history.md`. El cierre de la 15 + registro de la
> 14 viajan en el primer commit de `feature/14-ordenes-carga-masiva` (bookkeeping vía PR).
> Se revirtió un cambio espurio del implementer (hash bcrypt del maestro en migración
> histórica); no entró al PR #9.

> Feature 11 (notificaciones/toast) CERRADA 2026-07-10: PR #8 mergeado a `origin/dev`
> (1169312), status -> `done`, entrada en `history.md`. El cierre de la 11 + registro de
> la 15 viajan en el primer commit de `feature/15-carga-masiva-endpoint` (bookkeeping vía
> PR, sin commits directos a `dev`).
> NOTA: al mergear la 11, la zona frontend quedó libre → la feature 14 (frontend, low,
> depends_on 9 done) está desbloqueada y podría correr en PARALELO con la 15 (backend).

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
- [x] Features 1-13, 15: ciclos SDD completos (ver history.md).
- [ ] Feature 14 (frontend, low, boton carga masiva en ordenes): F1 spec en curso.
- [ ] Features 16, 17, 18...: evaluacion -> spec -> aprobacion -> impl -> review -> done.

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
