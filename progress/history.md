# Bitácora (append-only)

> Una entrada por feature completada. No se edita lo ya escrito; solo se añade.

<!-- Formato:
## AAAA-MM-DD — <feature>
- Qué se construyó (1-2 líneas).
- Requisitos cubiertos: R1..Rn.
- Decisiones relevantes o deuda dejada.
-->

## 2026-07-08 — login (flujo RBA + modelo de datos)
- Backend del login con autenticación basada en riesgo: modelo `Usuario` (nombre,
  email, telefono, password_hash, estado, cedula, tipo_identificacion_id, rol_id,
  created_at, updated_at), catálogos `tipo_identificacion`/`rol` (id+value con seed),
  `LoginAttempt`, `TrustedDevice`, `EmailOtpChallenge`, y `Session` (24h). RBA con
  señales dispositivo/IP/fallos → OTP por email; lockout duro 5 intentos/15 min;
  hashing bcrypt; Server Actions `login`/`verifyChallenge`/`logout`; migración con
  `down.sql` y RLS activado en las 6 tablas.
- Requisitos cubiertos: R1–R24 (incl. R10a, R21a, R23a), mapeados a tests en
  `progress/impl_login.md`. Verificación: typecheck/lint/test verdes.
- Decisiones: OTP solo por email (SMS/WhatsApp fuera de alcance); catálogos id+value;
  validación genérica de cédula/teléfono; estado enum pendiente/activo/inactivo/
  bloqueado; sesión cookie httpOnly sin refresh token.
- DEUDA (aceptada por el humano 2026-07-08, requiere entorno con DB real):
  ejecución del E2E de auth (T021→cubierto por E2E de login(home)), verificación
  del rechazo RLS con key anon (T004) y rollback de migración (T020). Marcada `done`
  con estos diferimientos documentados; NO cumple CHECKPOINTS al 100% (E2E sin
  ejecutar en verde) hasta correrlos en despliegue.

## 2026-07-08 — login(home) (pantalla de login)
- UI del login: página `/login` (Server Component con redirect de sesión activa) +
  formulario cliente email/contraseña que consume las Server Actions de `login`,
  maneja los 6 resultados de `LoginResult`, fase OTP (`verifyChallenge`), botón
  "Cerrar sesión" en la home, accesibilidad (labels/ARIA/foco/teclado). shadcn/ui +
  Tailwind. E2E `e2e/auth.spec.ts` escrito (4 caminos).
- Requisitos cubiertos: R1–R27, mapeados a tests de componente reales
  (`tests/components/*.test.tsx`, testing-library + jsdom) en
  `progress/impl_login-home.md`. Suite: 18 archivos / 110 tests verdes.
- Decisiones: botón de logout mínimo para destrabar E2E; redirect de usuarios ya
  autenticados (conecta R23a del backend). Review inicial RECHAZÓ por tests falsos
  (haiku) y bug de foco R22; se corrigió escalando frontend_dev a sonnet (tests que
  renderizan componentes reales; R22 fijado con regresión comprobada). Re-review
  APROBADO, 0 bloqueantes.
- DEUDA (aceptada por el humano 2026-07-08): ejecución del E2E (T017) requiere
  `.env` + Supabase de prueba + seed (usuario válido, uno para OTP, uno bloqueable).
  Marcada `done` con E2E diferido de ejecución; init.sh no corre `test:e2e`.

## 2026-07-09 — permissions (tabla permiso + relación N:M con rol)
- Nueva tabla `permiso` (id, nombre, method, route, created_at, updated_at con
  defaults) y tabla pivote `rol_permiso` (relación N:M con el catálogo `rol`).
  Migración Prisma con `down.sql` y RLS activado en ambas tablas nuevas, siguiendo
  el patrón de login. La tabla `permiso` queda VACÍA (sin seed), como pidió la feature.
- Requisitos cubiertos: R1–R14, mapeados a 9 tests nuevos en `progress/impl_permissions.md`.
  Suite: 126/126 tests verdes; typecheck y lint OK.
- Decisiones: relación N:M (no 1:N) porque `rol` es catálogo reutilizable y un permiso
  puede pertenecer a varios roles. Sin UI, endpoints ni seed de permisos (fuera de alcance).
- Review APROBADO, 0 bloqueantes.
- DEUDA (aceptada, requiere DB real, misma limitación que login): verificar RLS con
  key `anon` y rollback de la migración contra Postgres. Escrito y testeado a nivel
  unitario/validación; ejecución contra DB diferida.

## 2026-07-09 — role seed (enum Postgres rol_value + seed de roles)
- Los valores de rol se modelan como enum de Postgres `rol_value`
  ('maestro','admin','mensajero','Admin Tienda'); en `db/schema.prisma` se declara
  `enum RolValue` (miembro `adminTienda @map("Admin Tienda")`) y `Rol.value` pasa de
  `String` a `RolValue @unique`, siguiendo el patrón de `EstadoUsuario`. Fuente única
  de verdad en TS (`lib/types/roles.ts` / `ROLES_SEED`). El seed `seed-catalogos.ts`
  (`pnpm db:seed`) inserta los 4 valores vía upsert idempotente y ya NO siembra `usuario`.
- Requisitos cubiertos: R1–R14, mapeados a 18 tests nuevos en `progress/impl_role-seed.md`.
  Suite: 144/144 tests verdes; db:generate, typecheck, lint e init.sh OK.
- Decisiones (del humano, 2026-07-09): enum de Postgres (no solo TS), creado en la
  migración; se EDITÓ la migración de login `20260708212416_login_usuario_rba`
  (migration.sql: CREATE TYPE antes de crear `rol`; down.sql: DROP TYPE) porque aún
  no se había aplicado. `usuario` retirado del catálogo; ortografía `mensajero` (con j);
  cuarto rol literal `Admin Tienda`. Tabla `Usuario` vacía → cambio de tipo seguro,
  sin riesgo de FK.
- Review APROBADO, 0 bloqueantes.
- DEUDA (aceptada, requiere DB real): aplicar la migración editada y `db:seed` contra
  Postgres, y el exit-code end-to-end de R14. Diferido como en login/permissions.

## 2026-07-09 — seed maestro user (tarea ad-hoc, fuera de feature_list)
- Migración `db/migrations/20260709120000_seed_maestro_user/` que siembra
  idempotentemente un usuario `maestro` (`admin@ordenex.test`, estado activo, hash
  bcrypt coste 10 = mismo que login, `compareSync` verificado). Asegura antes rol
  `maestro` y tipo `cedula` con `ON CONFLICT DO NOTHING`; usuario con
  `ON CONFLICT (email) DO NOTHING`. `down.sql` borra solo el usuario.
- Pedido directo del humano (no es feature SDD). Delegado a backend_dev.
  db:generate/typecheck/lint/144 tests verdes.
- DEUDA: aplicar contra Postgres real (sin DB). Credenciales entregadas al humano
  por chat (no en claro en el repo).

## 2026-07-09 — home - sidebar (menú de navegación responsive)
- Grupo de rutas `app/(app)/` con `layout.tsx` que monta un `Sidebar` (Client
  Component): 3 items — Configuración→/configuracion, Perfil→/perfil,
  Órdenes→/ordenes — con item activo por `usePathname` + `aria-current`, toggle
  hamburguesa responsive (móvil colapsado / desktop expandido), nav landmark y
  navegación por teclado. shadcn/ui (`Button`) + Tailwind. Placeholders mínimos por
  ruta (Server Components con título) para evitar 404.
- Requisitos cubiertos: R1–R17, mapeados a 12 tests de componente reales (renderizan
  los componentes reales y asertan comportamiento) en `progress/impl_home-sidebar.md`.
  Suite: 27 archivos / 153 tests verdes; typecheck/lint/init.sh OK.
- Decisiones (del humano, 2026-07-09): rutas raíz en español; grupo `app/(app)/` con
  la home autenticada dentro; placeholders mínimos. Se descartó el componente
  `sidebar` completo de shadcn por sobre-ingeniería para "simple"; nav propio + Button.
- Review APROBADO, 0 bloqueantes. Hallazgos menores no bloqueantes: T010/T011 de
  tasks.md sin marcar `[x]`; `.gitignore` ignora `feature_list.json` (revisar aparte).
- Sin deuda de DB (feature de UI pura; el E2E de navegación no requiere Postgres).

## 2026-07-09 — ordenes (CRUD backend de órdenes)
- Backend completo del CRUD de órdenes con 6 tablas nuevas: catálogo `order_status`
  (7 valores: entregada, devuelta, devuelta_origen, reprogramada, embalaje,
  en_ruta_bodega_principal, en_bodega) con seed idempotente (patrón ROLES_SEED,
  fuente única de verdad en TS); geografía jerárquica VACÍA `zona`→`provincia`→
  `canton`→`distrito`; y `orden` (num_guia Int autoincrement unique; num_remision
  String unique provisto por usuario; estatus FK→order_status NOT NULL default
  `en_bodega`; tienda_id FK→Usuario NOT NULL; zona/provincia/canton_id FK NOT NULL;
  distrito_id y notas nullable; peso Decimal; soft delete vía deleted_at;
  created_at/updated_at). 2 migraciones con down.sql y RLS en las 6 tablas. CRUD por
  capas (Server Actions/service/repository/zod): crear, listar (excluye soft-deleted,
  paginación offset), obtener, actualizar, borrar lógico. Autorización por rol:
  maestro/admin full; adminTienda solo sus órdenes (rechaza tienda ajena); mensajero
  solo lectura + cambio de estatus.
- Requisitos cubiertos: R1–R42 + R14a (notas) + R14b (dependencia geografía),
  mapeados a 90 tests reales en `progress/impl_ordenes.md`. Suite: 243/243 verdes;
  db:generate/typecheck/lint/init.sh OK.
- Decisiones (del humano, 2026-07-09): order_status como tabla catálogo (no enum);
  geografía como 4 tablas jerárquicas creadas vacías; num_guia autoincrement por DB y
  num_remision del usuario; solo distrito_id/notas nullable → zona/provincia/canton
  NOT NULL; default en_bodega; borrado lógico; autorización por rol desde ya;
  complexity elevada a high. DEPENDENCIA OPERATIVA conocida: al ser geografía NOT NULL
  con tablas vacías, NO se pueden crear órdenes hasta poblar zona/provincia/canton;
  los tests de creación siembran geografía en fixtures.
- Review APROBADO, 0 bloqueantes.
- DEUDA (aceptada, requiere DB real): aplicar migraciones + seed de order_status +
  RLS + rollback contra Postgres. Diferido como en login/permissions/role-seed.

## 2026-07-09 — ordenes - list (tabla genérica + vista de órdenes)
- Componente genérico reutilizable `DataTable<T>` en `components/shared/` con contrato
  `Column<T> { id; value; render?: ((row:T)=>ReactNode) | keyof T | string }`
  (render función=componente custom, string=clave, ausente→valor por `column.id`),
  `rowKey=row.id`, estado vacío y accesibilidad (thead/th scope). Vista `/ordenes`
  (Client Component) con SWR cuyo fetcher invoca la Server Action existente
  `listarOrdenes` (sin API route nueva), con estados loading/error/vacío, montando 5
  columnas: num_guia, num_remision, estatus, destinatario, tienda. Sin paginación
  (será la feature 8) ni acciones por fila.
- Ampliación mínima del backend de la feature 6 (decisión b del humano): el DTO del
  listado incluye `tiendaNombre` (de la relación tienda→Usuario.nombre) vía select/join;
  la columna tienda muestra el nombre legible, no el uuid. Sin tocar el resto del CRUD
  ni la autorización por rol; SIN migración nueva (select sobre relación existente).
- Requisitos cubiertos: R1–R26, mapeados a tests reales en `progress/impl_ordenes-list.md`.
  Suite: 37 archivos / 263 tests verdes; typecheck/lint/init.sh OK.
- Decisiones (del humano, 2026-07-09): SWR en cliente sobre la action existente; 5
  columnas fijas; sin paginación/orden/filtros/acciones (paginación separada a la
  feature 8); columna tienda con nombre legible (opción b, amplía el listado backend).
- Review APROBADO, 0 bloqueantes. Sin deuda de DB (la ampliación no requiere migración;
  la deuda de aplicar el CRUD contra Postgres sigue siendo la de la feature 6).

## 2026-07-09 — paginacion (componente separado + paginación server-side de /ordenes)
- Componente `Pagination` (`components/shared/`) SEPARADO, controlado y transport-agnostic
  (compone con `DataTable` como hermano, sin tocar su contrato): ventana de números de
  página con elipsis + `aria-current="page"`, botones primera/última (`showFirstLast`),
  selector de tamaño `[10,25,50]`, `<nav aria-label>` + botones reales con `disabled`
  semántico y `aria-live`. Hook `usePagination` (`hooks/`) para modo client-side
  reutilizable. Vista `/ordenes` cableada SERVER-SIDE: SWR key `[ordenes:list,page,pageSize]`
  → `listarOrdenes({page,pageSize})` (feature 6, sin tocar backend), reset a página 1 al
  cambiar tamaño. `DEFAULT_PAGE_SIZE` cambiado 20→25 para alinear con el selector.
- Requisitos cubiertos: R1–R34, mapeados a tests reales en `progress/impl_paginacion.md`.
  Suite: 40 archivos / 289 tests verdes; typecheck/lint/init.sh OK.
- Decisiones (del humano, 2026-07-09): server-side en /ordenes; números de página con
  elipsis; selector 10/25/50; primera/última; `DEFAULT_PAGE_SIZE=25` (era 20, fuera del
  selector). No toca DB, migraciones, RLS ni `app/api/`; `DataTable` intacto.
- Review APROBADO, 0 bloqueantes (3 menores no bloqueantes documentados en
  `progress/review_paginacion.md`). Rama `feature/8-paginacion` mergeada a `origin/dev`
  (6bada04) por el humano vía UI (gh no instalado). Proceso nuevo: rama desde `dev`, PR a `dev`.

## 2026-07-09 — manejador de errores (estructura de error común + wrapper global backend)
- Manejador de errores global de backend: estructura de error común para todos los
  endpoints/Server Actions (códigos, shape serializable, normalización de errores
  desconocidos, logger, y un wrapper `withErrorHandler`). Módulo bajo `lib/errors/`
  con suite dedicada en `tests/unit/errors/` (app-error, codes, http, index, logger,
  normalize, shape, with-error-handler). Zona backend pura; no toca UI.
- Requisitos cubiertos: R1–R20 (ver spec en la rama y `progress/review_*` del track).
  Verificación: 320 tests verdes tras merge de dev; typecheck/lint/init.sh OK.
- Proceso: desarrollada EN PARALELO con la feature 8 (zonas disjuntas frontend/backend)
  en worktree `../ordenex-f10`. Review APROBADO, 0 mayores. Commit b4ff324, mergeada a
  `origin/dev` vía PR #4 (f6a5da4). Desbloquea la feature 12 (notificaciones-fix, depends_on:10).

## 2026-07-09 — componente carga masiva (BulkUpload genérico + plantilla CSV)
- Componente frontend reutilizable `BulkUpload` (`components/shared/BulkUpload.tsx`)
  parametrizable: recibe el tipo de archivo aceptado (accept derivado de props),
  la ruta del endpoint destino y la definición de campos de la plantilla. Botón de
  descarga de plantilla (CSV generado desde los `fields`) y botón de carga (POST
  multipart al endpoint provisto). Validación de tipo por extensión (autoridad) +
  MIME (MIME vacío no rechaza; MIME contradictorio rechaza), `maxSizeBytes` opcional,
  estados/mensajes accesibles (`role=alert`), botón de carga deshabilitado sin
  archivo válido. Zona frontend pura; el endpoint lo decide la feature consumidora
  (excepción consciente documentada en `design.md` D3, la usará la feature 14).
- Requisitos cubiertos: R1–R23 (EARS), mapeados a 25 tests reales (20 en
  `BulkUpload.test.tsx` + 5 en `csv-template.test.ts`) en `progress/impl_carga-masiva.md`.
  Suite verde tras merge de dev; typecheck/lint/init.sh OK.
- Review APROBADO, 0 bloqueantes. Commit 33e8b1f, mergeada a `origin/dev` vía PR #5
  (d4a21c8). Desbloquea la feature 14 (ordenes - carga masiva, depends_on:9).
- Sin deuda de DB (componente de UI puro).

## 2026-07-09 — modal (componente Modal reutilizable con soporte async)
- Componente frontend reutilizable `Modal` (`components/shared/Modal.tsx`) construido
  sobre `@base-ui/react/dialog`: soporta `onConfirm` síncrono o async; cuando es async
  muestra un spinner mientras la promesa está pendiente y bloquea el botón de confirmar
  (doble red anti-doble-submit: `disabled` + `pendingRef` síncrono). Al resolver cierra
  si `closeOnConfirm!==false`; al rechazar no cierra, reactiva los botones e invoca
  `onError(error)` (sin render de error propio). Opciones: `confirmVariant`
  (p.ej. `destructive`), `hideCancel`, `dismissible=false` (bloquea Escape/overlay pero
  no los botones). Accesibilidad delegada a Base UI: `aria-modal`, foco inicial dentro,
  focus trap, restauración de foco. Zona frontend pura.
- Requisitos cubiertos: R1–R31 (EARS); R1–R30 mapeados a 34 tests reales en
  `Modal.test.tsx`, R31 (restauración de foco) delegado a Base UI sin lógica propia
  (decisión humana 2026-07-09). Ver `progress/impl_modal.md`. Suite 379/379 verde;
  typecheck/lint/init.sh OK.
- Review APROBADO, 0 bloqueantes. Commit 7577abe, mergeada a `origin/dev` vía PR #6
  (26c3272). La feature 14 montará `BulkUpload` dentro de este `Modal`.
- Sin deuda de DB (componente de UI puro).

## 2026-07-09 — notificaciones - fix (migración de errores de órdenes al manejador global)
- Backend puro. Migra el manejo de error de las 5 Server Actions de `lib/actions/ordenes.ts`
  (`crear`/`obtener`/`listar`/`actualizar`/`borrar`) al manejador global de la feature 10
  (`withErrorHandler` / `normalizeError`), eliminando la construcción ad-hoc de literales
  de error y el helper local `fieldErrorsFrom`. Nuevo adaptador `toActionError(shape)`
  (inverso de `CODE_BY_DOMAIN_STATUS`, switch exhaustivo sobre los 6 `AppErrorCode` con
  guard `never`) traduce el `AppErrorShape` de vuelta al literal de dominio que la UI ya
  consume → contrato `*Result` intacto, UI y tests de componente sin cambios (UI-safe).
- Requisitos cubiertos: R1–R12 (EARS), mapeados a tests reales en
  `tests/integration/actions/ordenes-action.test.ts` (solo se AGREGARON casos T13/T14/T15;
  asserts previos intactos). Ver `progress/impl_notificaciones-fix.md`. Suite 51 files /
  384 tests verdes (+5 sobre baseline); typecheck/lint/init.sh OK.
- Decisiones humanas cerradas (2026-07-09): (1) DIFERIR auth — solo `ordenes.ts`,
  `auth.ts` NO se toca; (2) errores inesperados `INTERNAL` se loggean y se **re-lanzan**
  (sin agregar miembro a `ActionError`, para no romper el contrato UI); (3) alcance solo
  backend (los toasts al usuario son la feature 11); (4) conservar clave `id` en `fieldErrors`.
- NOTA de proceso: el spec original se había perdido (worktree `../ordenex-f12` eliminado
  sin pushear el branch); se REGENERÓ desde cero anclado al código real antes de implementar.
- Review APROBADO, 0 bloqueantes. Mergeada a `origin/dev` vía **PR #7** (2026-07-10).
- Sin deuda de DB (no toca DB, migraciones ni RLS).

## 2026-07-10 — notificaciones (sistema de toast reutilizable)
- Frontend puro. Sistema de toast sobre `@base-ui/react/toast` (decisión humana:
  consistente con `Modal`/feature 13 sobre `@base-ui/react/dialog`): `ToastProvider`
  (`providers/`) + hook `useToast()` (`hooks/`, API `success`/`error`/`info`/`warning`/
  `show`/`dismiss` con id estable) + componente presentacional `Toast`
  (`components/shared/`). 4 variantes con `role="alert"` (error/warning) / `role="status"`
  (success/info), viewport en portal con `role="region"`+`aria-label`, botón de cierre con
  `aria-label`. Aprovecha nativamente de Base UI: auto-descarte (`timeout`), persistencia
  (`timeout:0`), pausa por hover/foco, apilado y límite (`limit`), ids únicos, cierre
  programático (`close`), `onClose`. Adaptador puro `messageFromActionError`
  (`lib/utils/`) que reutiliza `MSG` + `CODE_BY_DOMAIN_STATUS` de la feature 12
  (`validation_error` → mensaje genérico). Provider montado en `app/(app)/layout.tsx`.
- Requisitos cubiertos: R1–R21 (EARS), mapeados a tests reales que renderizan el
  componente (`tests/components/ToastProvider.test.tsx`, `Toast.test.tsx`,
  `tests/unit/utils/action-error-message.test.ts`). Ver `progress/impl_notificaciones.md`.
  Suite 54 files / 413 tests verdes (+29); typecheck/lint/init.sh OK. Sin regresiones en
  `AppLayout`/sidebar ni `OrdenesPage`.
- Decisiones humanas (2026-07-10): (1) base `@base-ui/react/toast` (no toast propio);
  (2) cablear `/ordenes` y `Modal.onError` = follow-up, FUERA de alcance; (3)
  `validation_error` → mensaje genérico. `@base-ui/react/toast` confirmado presente
  (v1.6.0) antes de decidir.
- Review APROBADO, 0 bloqueantes (menores no bloqueantes: `catch` de `useToast` re-lanza
  sin `cause`). Mergeada a `origin/dev` vía **PR #8** (1169312, 2026-07-10).
- Sin deuda de DB (frontend puro).

## 2026-07-10 — ordenes - carga masiva (endpoint) (feature 15)
- Backend, high. Endpoint `POST /api/ordenes/carga-masiva` (Route Handler, multipart campo
  `file`) que parsea CSV y XLSX con `exceljs` (dependencia nueva), valida/resuelve por fila,
  deduplica `num_remision` (intra-archivo + DB), persiste en lote (`skipDuplicates`) con
  semántica de éxito parcial, y responde `{ total, creadas, duplicadas, conError, filas[] }`;
  errores estructurales vía el manejador global (feature 10). Capas nuevas: `BulkOrdenService`,
  parser de hojas (`lib/parsers/`), config de límites, `lib/auth/resolve-actor`.
- Migración `20260710000000_carga_masiva_ordenes` (con `down.sql` + RLS conservada): añade a
  `orden` las columnas `direccion`, `monto_cobrar`, `mensajero_sugerido_id` (FK -> `usuario`
  `ON DELETE SET NULL` + índice), vuelve `peso` NULLABLE, e inserta `en_preparacion` en
  `order_status` (`ON CONFLICT DO NOTHING`).
- Requisitos: R1–R32 (EARS) -> tests reales (unit de parseo/servicio/repo + integración del
  Route Handler mockeando prisma). Ver `progress/impl_carga-masiva-endpoint.md`. Suite 60
  files / 485 tests verdes (+72); typecheck/lint/init.sh OK; migración con `down.sql`.
- Decisiones humanas (2026-07-10): (A-6) carga masiva SOLO rol `adminTienda` -> 403 el resto
  (R11), `tienda_id` = actor.usuarioId siempre, sin campo `tiendaId` (maestro/admin = feature
  futura); (A-2) `en_preparacion` = DEFAULT GLOBAL de creación (`ordenesConfig.DEFAULT_ESTATUS_VALUE`,
  antes `en_bodega`) -> cambió el CRUD de la feature 6 y su test (actualizado); (A-5) zona
  derivada de la provincia; (A-1) `peso` nullable en columna pero `crearOrdenSchema` sigue
  exigiendo `peso>0`; (A-3) value = slug `en_preparacion`; (A-4) geografía = prerrequisito
  externo. Parser `exceljs` elegido (cubre CSV+XLSX).
- Review APROBADO, 0 bloqueantes. NOTA de proceso: el implementer había introducido un cambio
  ESPURIO fuera de alcance (alteraba el hash bcrypt del `maestro` en la migración histórica
  `20260709120000_seed_maestro_user`); el leader lo detectó al revisar el diff y lo REVIRTIÓ
  antes de commitear (no entró al PR). Mergeada a `origin/dev` vía **PR #9** (aff6e73, 2026-07-10).
- DEUDA (aceptada, patrón features 6/10, requiere DB real): aplicar la migración contra
  Postgres. Lo verificable sin DB está cubierto por unit + integración mockeada.
