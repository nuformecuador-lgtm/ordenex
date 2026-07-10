# Sesión activa

> Estado vivo de lo que se esta trabajando ahora. El leader lo mantiene al dia.
> Al cerrar una feature, se limpia de aca y se resume en history.md.

## Features en curso

| Branch | Zona | Fase | Estado |
|--------|------|------|--------|
| (ninguna en curso) | — | — | Zonas frontend y backend LIBRES. |

> Feature 25 (gestión de usuarios) CERRADA 2026-07-10: **PR #24 mergeado** a `origin/dev`
> (95d5025, 20:39Z), status -> `done`, entrada en `history.md`. Fullstack, sin tabla nueva; CRUD
> usuarios en configuración (solo maestro), R1–R36. Reviewer APROBADO 0 bloqueantes; suite ~886
> verde. GAP de rol id/value cerrado (`listarRoles`, select por UUID). Deuda menor: timeout de un
> test de `usuario-form` (flaky bajo carga).

> Feature 50 (vehiculos) CERRADA 2026-07-10: **PR #21 mergeado** a `origin/dev` (eb6a17d), status `done`, entrada en `history.md`. Backend puro (R1–R15, R12 N/A). Migración+seed **aplicados y verificados contra Postgres real**. Desbloquea la 21→22→23.

> Feature 20 (recuperación de contraseña) CERRADA 2026-07-10: **PR #20 mergeado** a `origin/dev`
> (b1ef459, 19:15Z), status -> `done`, entrada en `history.md`. Fullstack (reusa infra OTP, sin
> tabla nueva); implementada en 2 slices (backend + frontend), reviewer APROBADO en ambos, 0
> bloqueantes, suite 782/782 verde. Desbloquea la #25 (comparte `strongPasswordSchema`).

> Feature 31 (plantilla XLSX) CERRADA 2026-07-10: **PR #19 mergeado**, status -> `done`, entrada
> en `history.md`. Frontend puro (CSV→XLSX, exceljs import dinámico), reviewer APROBADO 0 bloqueantes.

> Feature 29 (enriquecer validación carga masiva) CERRADA 2026-07-10: **PR #17 mergeado** a
> `origin/dev` (7535961), status -> `done`, entrada en `history.md`. Frontend puro (R1–R19),
> reviewer APROBADO 0 bloqueantes, suite 721/721 verde. Corrió en paralelo con la 28 (backend).

> Feature 26 (dashboard/apartado admin de tienda) CERRADA 2026-07-10: **PR #14 mergeado** a
> `origin/dev` (e5a0f5d), status -> `done`, entrada en `history.md`. Frontend puro, corrió en
> paralelo con la 19 (backend). Reviewer APROBADO 0 bloqueantes; suite 689/689 verde. Deuda
> aceptada: sin e2e de login adminTienda (repo sin infra seed/login e2e). Cierre commiteado a
> `dev` (chore/state) — otra sesión trabaja la 28 en paralelo.

> Feature 28 (rename estado embalaje -> en_fulfillment) CERRADA 2026-07-10: **PR #15 mergeado** a
> `origin/dev` (d259e6a), status -> `done`, entrada en `history.md`. Backend puro; enum PG
> `order_status_value` standalone + rename de fila de catálogo, verificado contra Postgres real (R11).
> El cierre (done + history) viaja en la rama `chore/skills-cierre-28` junto con las skills de diseño.
> DEUDA nueva: `scripts/db-rollback.ts` (flag `--schema` roto en Prisma 7) -> feature aparte.


> Feature 18 (cobros crud) CERRADA 2026-07-10: PR #12 mergeado a `origin/dev` (a379d8e),
> status -> `done`, entrada en `history.md`. El cierre de la 18 + registro de la 19 viajan en
> el primer commit de `feature/19-rol-adminsatelite`.
> SKIP de la 17: deps 27/28 no `done`; no arranca hasta que cierren. Otras elegibles: 20, 21,
> 24 (necesita Excel), 25, 26, 28, 29.

> Feature 14 (botón carga masiva en órdenes) CERRADA 2026-07-10: PR #10 mergeado a
> `origin/dev` (bb511f1), status -> `done`, entrada en `history.md`. El cierre de la 14 +
> registro de la 16 viajan en el primer commit de `feature/16-carga-masiva-etapa2`.

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
- `ordenes - carga masiva - etapa 2` (id 16): **zone=fullstack, complexity=medium,
  branch=feature/16-carga-masiva-etapa2, depends_on=15.** Evaluada 2026-07-10 con el
  codigo en mano: es FULLSTACK (backend nuevo — listar usuarios `role=mensajero` como
  `{id,nombre}` para el select y asignar/actualizar `mensajero_sugerido_id`; hoy no hay
  metodo de listado por rol en `UserRepository`; y frontend — resumen columna por columna
  + selects). DECISION DE PROCESO (leader): NO se parte la entrada del feature_list (que el
  humano curo) en dos; como las mitades son ESTRICTAMENTE SECUENCIALES (frontend depende del
  backend, sin paralelismo que ganar) se corre como UN ciclo fullstack (implementer delega
  backend_dev -> frontend_dev, un PR). Si el humano prefiere el split formal, se hace.
  Decisiones humanas (2026-07-10): (1) flujo POST-COMMIT — las ordenes ya las crea la 15 en
  `en_preparacion`; la 16 muestra el resumen y asigna mensajero sobre ordenes YA creadas, NO
  cambia la 15/14. (2) asignacion de mensajero AMBOS: select global "aplicar a todos" +
  override por fila.
- `dashboard/apartado del admin de tienda` (id 26): **zone=frontend, complexity=medium,
  branch=feature/26-dashboard-admin-tienda, depends_on=null.** Evaluada 2026-07-10:
  la descripcion dice "Frontend" y sus insumos estan done — autz por rol (feature 6),
  DataTable + columna tiendaNombre (feature 7), boton/modal de carga masiva (features
  14/16). NO hay backend nuevo: el filtrado de ordenes a la tienda del adminTienda ya lo
  hace la autz de la 6. Zona frontend LIBRE (unica en curso: 19 backend) -> corre en
  paralelo. Seleccionada por el humano ignorando la cadena de la 28 (28->27->17).
  ABIERTO para el spec: que mas muestra el dashboard del adminTienda ademas del modulo de
  ordenes (metricas/accesos) -> el humano decidira en la puerta de aprobacion F1.4.

## Conflictos pendientes

> Conflictos de merge que el agente no pudo resolver solo. El humano decide.

(Ninguno por ahora)

## Plan de la sesion
- [x] Features 1-16, 18: ciclos SDD completos (ver history.md).
- [ ] Feature 19 (backend, low, rol adminSatelite): F1 spec en curso.
- [ ] Feature 17 BLOQUEADA (depends 27/28). Elegibles: 19,20,21,24,25,26,28,29.

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
