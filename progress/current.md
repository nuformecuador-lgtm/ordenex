# Sesión activa

> Estado vivo de lo que se esta trabajando ahora. El leader lo mantiene al dia.
> Al cerrar una feature, se limpia de aca y se resume en history.md.

## Features en curso

| Branch | Zona | Fase | Estado |
|--------|------|------|--------|
| feature/28-rename-embalaje-fulfillment | backend | F2.4 | **impl COMPLETA + reviewer APROBADO (0 bloqueantes).** 78 files / 687 tests verdes; migración R11 aplicada+revertida contra Postgres real (order_status: embalaje=0, en_fulfillment=1, 8 valores; enum PG order_status_value con 8 labels; columna value sigue TEXT). Pendiente: PR + merge (humano). DEUDA nueva: arreglar `scripts/db-rollback.ts` (usa `--schema`, roto en Prisma 7) en feature aparte. Spec v2 (R1..R11). Rename `order_status` `embalaje` -> `en_fulfillment` vía `UPDATE` (fila catálogo) + `down.sql`. DECISIONES HUMANAS (2026-07-10): (1) ADEMÁS enum PG `order_status_value` (8 valores con `en_fulfillment`, patrón `RolValue`) **STANDALONE** (NO retipar la columna, sigue TEXT); (2) migraciones YA se ejecutan contra DB real (deuda 4/6/15 LEVANTADA desde esta feature). FIX de soporte incluido: `scripts/seed-catalogos.ts` ahora usa el adapter `PrismaPg` + `loadEnvFile`. `progress/*` append-only. |
| feature/26-dashboard-admin-tienda | frontend | F2.4 | **impl COMPLETA + reviewer APROBADO (0 bloqueantes).** Landing `/` condicional por rol server-side (adminTienda → dashboard = header + módulo de órdenes de su tienda). Extraído `OrdenesModule` (una sola tabla+fetch, R10); columnas sin "Tienda" (R11) sin mutar `ordenes-columns.tsx`; frontend puro (backend intacto, filtro tienda vía OrdenService.listar feature 6). R1–R11 → test. Suite 689/689 verde, init.sh verde (verificado por reviewer). E2E login adminTienda DIFERIDO (deuda aceptada, repo sin infra seed/login e2e). Commit `91823ef` + push hechos. **PR PENDIENTE de abrir desde la WEB**: https://github.com/nuformecuador-lgtm/ordenex/pull/new/feature/26-dashboard-admin-tienda → base `dev`. Pasa a `done` al mergear. |

> DEUDA DE MIGRACIONES SALDADA (2026-07-10): aplicadas contra Postgres real (localhost:5432/ordenex)
> las 3 migraciones pendientes (carga_masiva_ordenes, cobros, rol_admin_satelite); `prisma migrate
> status` = "Database schema is up to date!" (9/9). El SEED de catálogos reveló el bug del adapter
> (corregido dentro de la feature 28).

> Feature 19 (rol adminSatelite) CERRADA 2026-07-10: PR #13 mergeado a `origin/dev` (75b7abc),
> status -> `done`, entrada en `history.md`. El cierre de la 19 + registro de la 28 viajan en
> el primer commit de `feature/28-rename-embalaje-fulfillment`.

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
