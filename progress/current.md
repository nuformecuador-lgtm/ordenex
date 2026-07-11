# Sesión activa

> Estado vivo de lo que se esta trabajando ahora. El leader lo mantiene al dia.
> Al cerrar una feature, se limpia de aca y se resume en history.md.

## Features en curso

| Branch | Zona | Fase | Estado |
|--------|------|------|--------|
| feature/30-asignacion-zona-ruteo-satelite | fullstack | F1 (spec) | **Rama creada desde `origin/dev` (5e06aeb, incluye la 17). Evaluada: fullstack high, un ciclo (precedente 16/24/25/27). Deps 24 y 17 done.** spec_author LANZADO. Al terminar F1 → `spec_ready` y PARADA en puerta F1.4 (preguntas abiertas: (a) identificación GAM = flag `es_gam`/`es_central` vs nombre; (b) estado de ruteo = un `en_ruta_bodega_satelite` con zona derivada vs estado por zona). NO se toca código hasta aprobación humana. |

> Feature 17 (revisión maestro / generar guía / asignación mensajero) CERRADA 2026-07-11: **PR #32 mergeado** a `origin/dev` (5e06aeb). Fullstack (R0–R32), reviewer APROBADO 0 bloqueantes, migración `num_guia` NULLABLE + secuencia + `mensajero_asignado_id` + estado `en_espera_aceptacion`. Suite 1244 verde tras integrar `dev` (feature 51). Desbloquea 30/32/36. Pendiente humano: aplicar la migración contra Postgres real (deuda de despliegue).

> Feature 23 (dashboard maestro) CERRADA 2026-07-10/11: **PR #28 mergeado** a `origin/dev`. Frontend puro (R1–R19). Feature 27 (fulfillment tienda) CERRADA: **PR #29 mergeado**. Feature 51 (corrección carga masiva CR) CERRADA: **PR #31 mergeado**. Ver `history.md`.

> Feature 22 (aprobación de postulaciones) CERRADA 2026-07-10: **PR #26 mergeado** a `origin/dev` (8eaed55), status `done`, entrada en `history.md`. Backend puro (R1–R21), reviewer APROBADO 0 mayores, sin migraciones. Rechazo→`inactivo`, URLs firmadas TTL 300s. Desbloquea la 23.

> Feature 21 (postulación de mensajero) CERRADA 2026-07-10: **PR #23 mergeado** a `origin/dev` (20db364), status `done`, entrada en `history.md`. Fullstack (R1–R26), reviewer APROBADO (bloqueante R17 resuelto). `primer_apellido` OBLIGATORIO; migración APLICADA y VERIFICADA contra Postgres real. Desbloquea la 22→23. Pendiente humano: crear bucket privado `mensajero-docs` en Supabase Storage.

> Feature 25 (gestión de usuarios) CERRADA 2026-07-10: **PR #24 mergeado** a `origin/dev` (95d5025), status `done`, entrada en `history.md`. Fullstack (R1–R36), otra sesión, reviewer APROBADO 0 bloqueantes.

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
- `gestion de zonas` (id 24): **zone=fullstack, complexity=high, branch=feature/24-gestion-zonas,
  depends_on=null.** Evaluada 2026-07-10: fullstack (migracion + seed XLSX + backend CRUD + UI en
  configuracion). Por precedente del repo (features 20/21/25 corrieron fullstack SIN partir) se corre
  como UN ciclo fullstack (implementer delega backend_dev->frontend_dev, un PR). Worktree
  `../ordenex-f24` desde `origin/dev`. Seleccionada por el humano (2026-07-10) excluyendo 23 y 27; la
  siguiente por id, la 17, esta bloqueada semanticamente por la 27 (in_progress). Es foundational:
  destraba 30 (asignacion por zona) y 39 (pago por zona). **F1 (spec R1-R28) COMPLETA -> spec_ready.**
  DOS GATES antes de impl: (1) es fullstack -> NO corre en paralelo con la feature 27 (tambien
  fullstack, in_progress en otra sesion); (2) el seed necesita el **Excel de zonas** que el humano debe
  proveer. Preguntas abiertas para F1.4 en `specs/24-gestion-zonas/requirements.md`.
  **F1.4 APROBADA por el humano 2026-07-10** (las 7 propuestas tal cual) -> status `in_progress` (F2.0).
  **IMPL EN ESPERA (no arrancada):** la feature 27 esta implementando AHORA en el checkout principal y
  ya tiene modificados `db/schema.prisma`, `UserRepository`/`IUserRepository`, `OrdenRepository` y la UI
  de configuracion -> arrancar la 24 chocaria en la migracion de `usuario` y los repos (regla #1 no
  negociable). La impl de la 24 arranca cuando la 27 este `done` en `dev`; entonces se sincroniza. El
  seed ademas espera el Excel. Rama `feature/24-gestion-zonas` pusheada con el spec para revision.

- `fulfillment de tienda + estado inicial condicional` (id 27): **zone=fullstack,
  complexity=high, branch=feature/27-fulfillment-tienda, depends_on=25.** Evaluada
  2026-07-10: fullstack (backend — campo booleano `fulfillment` en Usuario +
  migracion/down.sql + logica condicional en `BulkOrdenService`/carga masiva feature 15;
  frontend — switch 'esta tienda tiene fulfillment' en la UI de creacion de usuario de la
  feature 25). Deps 25 y 28 **done**. DECISION DE PROCESO (leader): NO se parte el entry
  del feature_list; las mitades son ESTRICTAMENTE SECUENCIALES (el switch del frontend
  depende del campo backend, sin paralelismo que ganar) -> se corre como UN ciclo
  fullstack (implementer delega backend_dev -> frontend_dev, un PR), mismo criterio que
  las features 16 y 25. Si el humano prefiere el split formal, se hace. Rama creada desde
  `origin/dev` (al dia con 21/25/50/28).

- `asignacion por zona (GAM) y ruteo a bodega satelite` (id 30): **zone=fullstack,
  complexity=high, branch=feature/30-asignacion-zona-ruteo-satelite, depends_on=24.**
  Evaluada 2026-07-11: fullstack (backend — nuevo `order_status` de ruteo a satelite,
  consultas de mensajeros filtradas por zona, transiciones de asignacion; frontend —
  UI del maestro: lista de mensajeros restringida a GAM + accion 'rutear a bodega
  satelite'). Deps 24 (zonas, con `distrito.zona_id` y `Usuario.zona_id`) y 17 (generar
  guia / `mensajero_asignado_id` / `en_espera_aceptacion`) **done**. DECISION DE PROCESO
  (leader): NO se parte el entry; por precedente del repo (16/24/25/27) se corre como UN
  ciclo fullstack (implementer delega backend_dev -> frontend_dev, un PR). Rama creada
  desde `origin/dev` (5e06aeb). Preguntas ABIERTAS para F1.4: (a) identificacion de la
  zona GAM -> flag `es_gam`/`es_central` en `zona` (recomendado) vs. por nombre 'GAM'
  -OJO: la 24 dejo `es_gam` como toggle de UI NO sembrado, hay que reconciliar-; (b)
  estado de ruteo -> UN `en_ruta_bodega_satelite` con nombre de zona derivado de
  `orden.zona_id` (recomendado, precedente `en_ruta_bodega_principal`) vs. estado por zona.

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
