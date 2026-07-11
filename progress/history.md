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

## 2026-07-10 — ordenes - carga masiva (botón + modal) (feature 14)
- Frontend puro por composición: botón "Carga masiva" en la cabecera de `/ordenes` +
  wrapper de cliente local `app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx` que
  abre el `Modal` (feature 13) como CONTENEDOR (`hideCancel`, `confirmLabel="Cerrar"`, sin
  `onConfirm`) con el `BulkUpload` (feature 9) dentro, apuntando al endpoint de la feature 15
  (`/api/ordenes/carga-masiva`, `accept=["csv","xlsx"]`, `fieldName="file"`, 11 columnas en
  orden). `onSuccess`: refresca la lista (SWR `mutate` sobre `["ordenes:list", …]`) + toast
  (feature 11) `success`/`warning` según `conError`, sin cerrar el modal; `onError`: toast
  `error` sin refrescar. NO modifica los componentes genéricos ni el backend.
- Requisitos: R1–R19 (EARS) -> tests reales en `tests/components/OrdenesCargaMasivaButton.test.tsx`
  (mock de `fetch`, spies de `useToast`/`mutate`). Ver `progress/impl_ordenes-carga-masiva-ui.md`.
  Suite 61 files / 506 tests verdes (+21); typecheck/lint/init.sh OK.
- Decisiones humanas (2026-07-10): modal NO se cierra al éxito; botón solo texto; sin
  `maxSizeBytes` en cliente; toast solo con totales (el detalle por fila es la feature 16).
- Review APROBADO, 0 bloqueantes. Mergeada a `origin/dev` vía **PR #10** (bb511f1, 2026-07-10).
  Cierra la cadena de carga masiva: 9 (componente) -> 15 (endpoint) -> 14 (UI).
- Sin deuda de DB (frontend puro).

## 2026-07-10 — ordenes - carga masiva - etapa 2 (feature 16, FULLSTACK)
- Tras la carga (feature 15, que ya crea las órdenes en `en_preparacion`), resumen del lote
  + asignación de `mensajero_sugerido_id`. POST-COMMIT (no cambia el flujo 14/15). **Backend:**
  `UserRepository.listMensajeros()` (rol mensajero + estado activo, `{id,nombre}`);
  `OrdenRepository` `findResumenByNumRemisiones`/`asignarMensajeroSugerido`/`countOrdenesDeTienda`;
  `AsignacionMensajeroService` (valida mensajero, todo-o-nada por tienda, `updateMany` por
  mensajeroId distinto, lista vacía=no-op); Server Actions `lib/actions/mensajeros.ts`
  (`withErrorHandler`+`toActionError`, extraído a `lib/actions/_shared/`). Autorización:
  listarMensajeros→adminTienda/maestro/admin; resumen/asignar→solo adminTienda. **Sin migración**
  (reutiliza `mensajero_sugerido_id` de la 15). **Frontend:** `components/ui/select.tsx` sobre
  `@base-ui/react/select`; `OrdenesCargaResumen` como 2º paso del modal de la 14 (`DataTable`,
  select global "aplicar a todos" + override por fila con pre-selección, confirmar→asignar+toast+mutate).
  Lote identificado por `num_remision` con `resultado="creada"` del `BulkSummary`.
- Requisitos R1–R34 (EARS, backend+frontend) -> tests reales. Ver `progress/impl_carga-masiva-etapa2.md`.
  Suite 67 files / 572 tests verdes (+66); typecheck/lint/init.sh OK.
- Decisiones humanas (2026-07-10): post-commit; asignación global+fila; mensajeros solo activo;
  autorización como arriba; lote por BulkSummary; sin nombres de geografía; todo-o-nada; resumen
  en el modal; Select sobre @base-ui/react/select.
- Proceso: evaluada FULLSTACK y corrida como UN ciclo (no se partió la entrada del feature_list,
  mitades secuenciales). Reviewer verificó que el refactor de `toActionError` a `_shared/` no
  rompió la feature 12. Review APROBADO, 0 bloqueantes. Mergeada vía **PR #11** (b5009ae, 2026-07-10).
- Sin deuda de DB (no migración).

## 2026-07-10 — cobros - crud (feature 18)
- Backend puro. CRUD de `cobro` (tarifas) replicando el patrón por capas del CRUD de órdenes
  (feature 6): tabla nueva multi-fila con `nombre` (TEXT NOT NULL) + 8 columnas — montos
  `Decimal(12,2)` (`valor_flete`, `valor_flete_devuelto`, `valor_flete_gam`,
  `valor_flete_devuelto_gam`, `fulfillment`) y porcentajes 0..100 `Decimal(5,2)`
  (`comision_cod`, `iva_flete`, `iva_comision_cod`) — más id/created_at/updated_at/deleted_at
  (soft delete). Migración `20260710120000_cobros` con `down.sql` + RLS (sin policies). Capas
  `CobroService`/`CobroRepository`/`lib/types/cobro.ts` (zod) + Server Actions (`withErrorHandler`
  + `toActionError`). Autorización: solo `maestro` escribe; `admin` solo lee/lista;
  `adminTienda`/`mensajero` → forbidden. DTO serializa Decimal→number, no expone `deleted_at`;
  zod valida NOT NULL, ≥0 y porcentajes ≤100.
- Requisitos R1–R27 (EARS) -> tests reales (service/repo/zod/action/rls/config). Ver
  `progress/impl_cobros-crud.md`. Suite 73 files / 660 tests verdes (+88); typecheck/lint/init.sh OK.
- Decisiones humanas (2026-07-10): tarifas multi-fila con `nombre`; IVA y `comision_cod` como
  porcentaje 0..100; `fulfillment` como monto; solo `maestro` escribe; sin FK a zona (relación
  por zona = feature 24). Interpretación registrada: "fulfillment=monto, comision_cod=%".
- Review APROBADO, 0 bloqueantes (tipos verificados exactos). Mergeada vía **PR #12** (a379d8e, 2026-07-10).
- DEUDA (aceptada, patrón 6/15, requiere DB real): aplicar migración/RLS/rollback contra Postgres.

## 2026-07-10 — rol admin bodega satelite (feature 19)
- Backend puro. Agrega el valor `adminSatelite` (label DB slug, sin `@map`) al enum Postgres
  `RolValue` y al `ROLES_SEED`, llevando el catálogo de roles de 4 a 5 (maestro, admin, mensajero,
  adminTienda, adminSatelite), patrón de la feature 4 (role seed). Migración incremental
  `ALTER TYPE ... ADD VALUE` con `down.sql` que recrea el tipo; seed idempotente derivado del enum;
  fuente única de verdad en `lib/types/roles.ts`. Sin permisos nuevos: `adminSatelite` queda
  forbidden por defecto (verificado) y NO puede aprobar postulaciones de mensajeros (limitado a
  maestro/admin). Migración de login intacta.
- Requisitos R1–R12 (EARS) -> tests reales. Ver `progress/impl_rol-adminsatelite.md`.
  Suite 75 files / 678 tests verdes (+18); typecheck/lint/init.sh OK.
- Review APROBADO, 0 bloqueantes. Mergeada vía **PR #13** (75b7abc, 2026-07-10).
- DEUDA (aceptada, patrón 4, requiere DB real): aplicar `ALTER TYPE`/rollback contra Postgres.
## 2026-07-10 — dashboard/apartado del admin de tienda (feature 26, FRONTEND)
- Frontend puro. Landing `/` autenticada condicional por rol (server-side, `resolveActorFromSession`):
  el rol `adminTienda` ve su apartado/dashboard como primera experiencia tras login = encabezado +
  su módulo de órdenes (solo las de su tienda) con botón de carga masiva; los demás roles y el
  anónimo conservan el placeholder. **Se extrae `OrdenesModule`** (client) desde `ordenes/page.tsx`;
  `/ordenes` lo consume sin cambio funcional (una sola implementación de `DataTable`+fetch, R10).
  `ordenes-columns-admin-tienda` = columnas SIN "Tienda" (R11) sin mutar `ordenes-columns.tsx`.
  `AdminTiendaDashboard` (server component) = header + `OrdenesModule` con columnas del rol.
  SIN backend/DB/actions/RLS: el filtrado por tienda sigue en `OrdenService.listar` (feature 6).
- Requisitos R1–R11 (EARS) -> tests reales (component + ramificación por rol + estructural/reuso +
  filtro backend). Ver `progress/impl_26-dashboard-admin-tienda.md` y `progress/review_26-...md`.
  Suite 689/689 tests verdes; typecheck/lint/init.sh OK.
- Decisiones humanas (F1.4, 2026-07-10): (1) MVP "solo órdenes" (sin métricas/KPIs); (2) landing `/`
  condicional por rol (no ruta dedicada `/tienda`); (3) ocultar columna "Tienda" para adminTienda;
  (4) Sidebar sin cambios.
- Review APROBADO, 0 bloqueantes. Corrió en PARALELO con la feature 19 (backend). Mergeada a
  `origin/dev` vía **PR #14** (e5a0f5d, 2026-07-10).
- DEUDA (aceptada, dictaminada no bloqueante por el reviewer): sin e2e de login `adminTienda` (el
  repo no tiene infra seed/login e2e); R1/R7 cubiertos por component tests + test real de backend.

## 2026-07-10 — rename estado embalaje -> en_fulfillment (feature 28, BACKEND)
- Corrección de nomenclatura. Rename del valor de catálogo `order_status` `embalaje` -> `en_fulfillment`
  (convención `en_`) en la fuente única `lib/types/order-status.ts` (`ORDER_STATUS_SEED`) y migración
  `UPDATE order_status SET value='en_fulfillment' WHERE value='embalaje'` con `down.sql` inverso.
- DECISIONES HUMANAS (2026-07-10): (1) ADEMÁS se crea un enum de Postgres `order_status_value`
  **STANDALONE** (CREATE TYPE con los 8 valores incl. `en_fulfillment`, patrón `RolValue`; down `DROP TYPE`)
  para validaciones futuras, SIN retipar la columna `order_status.value` (sigue TEXT) — SQL manual porque
  Prisma no materializa enums no referenciados; (2) a partir de esta feature las migraciones SÍ se ejecutan
  contra Postgres real (deuda de despliegue 4/6/15 LEVANTADA).
- Fix de soporte: `scripts/seed-catalogos.ts` ahora construye el cliente con el driver adapter `PrismaPg`
  (+`loadEnvFile`) — antes fallaba contra DB real. Guard anti-`embalaje` + tests de migración (rename y enum)
  + test de sincronía enum<->ORDER_STATUS_SEED.
- Requisitos R1–R11 (EARS) -> tests reales. Ver `progress/impl_rename-embalaje-fulfillment.md` y
  `progress/review_rename-embalaje-fulfillment.md`. Suite 81 files / 698 tests verdes (tras merge con dev/26);
  typecheck/lint/init.sh OK.
- R11 verificado por el reviewer contra Postgres real (localhost:5432/ordenex): `order_status` con 8 valores,
  `embalaje`=0, `en_fulfillment`=1; tipo `order_status_value` con 8 labels; `down.sql` revierten y la
  re-aplicación restaura el estado.
- Review APROBADO, 0 bloqueantes. Corrió en PARALELO con la feature 26 (frontend). Mergeada a `origin/dev`
  vía **PR #15** (d259e6a, 2026-07-10).
- DEUDA nueva (fuera de alcance): `scripts/db-rollback.ts` usa el flag `--schema` (roto en Prisma 7) ->
  arreglar en una feature aparte; el rollback R11 se ejecutó con `prisma db execute --file`.

## 2026-07-10 — enriquecer validación previa a la carga masiva (feature 29, FRONTEND)
- Frontend puro. Enriquece el paso de resumen de la carga masiva (feature 16): en vez de descartar
  las filas `duplicada`/`error` del `BulkSummary` (que ya trae el backend de la feature 15), el
  resumen ahora SEPARA el resultado en 3 secciones: NUEVAS (`OrdenesCargaResumen` de la 16 intacto,
  con su select de mensajero por fila), EXISTENTES (solo lectura: nº remisión + estado ACTUAL como
  etiqueta legible, aviso de que no se recargan) y ERRORES (solo lectura: fila/nº remisión + motivo).
  Nuevos helpers puros `carga-masiva-clasificacion.ts` (guards sobre `unknown`) y `estatus-label.ts`
  (mapa value→label anclado a `ORDER_STATUS_SEED`, `Record` tipado que rompe el build si cambian los
  estados; fallback al value crudo); contenedor `OrdenesCargaResumenPaso.tsx`; ajuste de
  `OrdenesCargaMasivaButton.handleSuccess`. SIN backend/DB/actions (R14): el filtrado/creación sigue
  en el backend de las features 15/16.
- Requisitos R1–R19 (EARS) -> tests reales (unit de helpers + component). Ver
  `progress/impl_29-validacion-carga-masiva.md` y `progress/review_29-...md`. Suite 721/721 verde;
  typecheck + init.sh OK.
- Decisiones humanas (F1.4, 2026-07-10): (A) frontend puro (descartado B: dry-run pre-commit fullstack);
  avanzar mostrando existentes si 0 nuevas; detalle por fila de errores; etiqueta legible del estado.
- Review APROBADO, 0 bloqueantes. Corrió en PARALELO con la feature 28 (backend). Mergeada a
  `origin/dev` vía **PR #17** (7535961, 2026-07-10). Impl vía frontend_dev DIRECTO (el implementer
  falló 2× con el modelo legacy `sonnet-4`; ver memoria model-name-mapping).
- Flaky pre-existente de auth (HomePage/LoginForm bajo ejecución paralela) dictaminado no bloqueante
  (pasa 29/29 en aislamiento; el diff no toca esos archivos).

## Feature 50 — vehiculos — DONE 2026-07-10
- Backend puro. Catalogo `vehiculos` (tabla + enum PG) disponible solo para rol `maestro`, patron de
  las features 4/19 con una diferencia deliberada: columna de valor **`name`** (no `value`). Enum
  `VehiculoValue` (moto/carro/camion), model `Vehiculo{id uuid, name}`, migracion
  `20260710160000_vehiculos` (CREATE TYPE/TABLE + UNIQUE `vehiculos_name_key` + RLS) + down.sql,
  `lib/types/vehiculos.ts` (`VEHICULOS_SEED` derivado del enum), `seedVehiculos` idempotente por `name`,
  `IVehiculoService/Repository` + `VehiculoService` (guard `maestro` -> forbidden/unauthenticated) + action.
  Deja `vehiculos.id` como PK uuid estable para el FK `vehiculo_id` de la feature 21 (NO implementado aqui).
- Decisiones humanas (F1.4, 2026-07-10): P1=A (catalogo sembrado + SOLO LECTURA, T7 omitida, R12 N/A),
  P2=`VehiculoValue`, P3=seed en `scripts/seed-catalogos.ts`. R1–R11/R13–R15 -> tests reales (33 nuevos).
- Reviewer APROBADO (unico mayor documental: checkboxes de tasks, ya corregido). Suite 754 verde,
  typecheck+lint OK. **Migracion+seed APLICADOS y VERIFICADOS contra Postgres real** (localhost:5432/ordenex):
  3 filas idempotentes, RLS on, indice unico, enum con 3 labels. Deuda de despliegue CERRADA.
- Mergeada a `origin/dev` via **PR #21** (eb6a17d, 2026-07-10). Corrio en zona backend en paralelo con
  la 31 (frontend). Impl via backend_dev DIRECTO (el implementer falla con el modelo legacy sonnet-4).
  Desbloquea la cadena 21 -> 22 -> 23.

## 2026-07-10 — plantilla de carga en XLSX (feature 31, FRONTEND)
- Frontend puro. La plantilla descargable de `BulkUpload` (botón "Descargar plantilla") pasa de
  CSV a XLSX formateado (cabecera en negrita, anchos legibles, fila de ejemplo opcional con la
  misma regla del CSV), para que se llene columna por columna con facilidad. Nuevo generador
  `lib/utils/xlsx-template.ts` (`buildXlsxTemplate` async con exceljs); `handleDownloadTemplate`
  async con mime XLSX y estado mientras genera; `DEFAULT_TEMPLATE_NAME` y el consumidor de órdenes
  a `.xlsx`. Solo cambia la plantilla que se DESCARGA (el endpoint de carga ya aceptaba XLSX).
- Decisiones humanas (F1.4, 2026-07-10): SIEMPRE XLSX (sin prop `templateFormat`); exceljs por
  IMPORT DINÁMICO (`await import`, R6b) para no inflar el bundle; `lib/utils/csv-template.ts` y su
  test CONSERVADOS intactos.
- Requisitos R1–R13 (+R6b) -> tests reales (round-trip del generador releyendo el buffer con
  ExcelJS + component del botón). Ver `progress/impl_31-plantilla-xlsx.md` y `review_31-...md`.
  Feature en aislamiento 61/61; typecheck OK; init.sh verde.
- Review APROBADO, 0 bloqueantes. Corrió en paralelo con la 28 (backend). Mergeada a `origin/dev`
  vía **PR #19** (2026-07-10 17:21Z). Impl vía frontend_dev DIRECTO (implementer inestable por
  sonnet-4). El PR #19 llevó también el cierre de la feature 29.
- Flaky de timeouts pre-existente (auth + integración bajo ejecución paralela), no determinista y
  ajeno al diff; init.sh no gatea sobre vitest.

## 2026-07-10 — recuperación de contraseña (feature 20, FULLSTACK)
- Flujo público de reset de contraseña reusando la infra OTP por email del login RBA, SIN tabla
  nueva (reusa `EmailOtpChallenge`). BACKEND: `strongPasswordSchema` (zod, 8-72 + complejidad,
  `lib/types/password-policy.ts`, reutilizable); constantes `AUTH_RESET_*` en authConfig;
  `PasswordResetService` (solicitar/verificarCodigo/restablecer) reusando `OtpChallengeIssuer`,
  `EmailOtpChallengeRepository` (+ `findLatestActiveByUsuarioId`, `contarRecientesPorUsuario`),
  `UserRepository.updatePasswordHash`, `hashPassword`; limitador de verificación en memoria
  (`reset-rate-limit.ts`); Server Actions (`lib/actions/password-reset.ts`). No enumeración de
  usuarios (respuesta genérica); rate-limit propio (NO reutiliza el lockout del login, no bloquea
  la cuenta); marca `consumedAt` al usar el OTP. FRONTEND: `app/recuperar-contrasena/` (page +
  `RecuperarContrasenaForm` de 3 fases email→código→nueva contraseña→éxito) + enlace desde login.
- Requisitos R1–R20 (EARS) -> tests reales (policy/schemas/rate-limit/service/actions + component).
  Ver `progress/impl_20-...md`, `review_20-...md` (backend) y `review_20-frontend-...md`.
  Implementada en 2 slices (backend con zona libre; frontend al liberarse tras #29/#31). Suite
  782/782 verde; typecheck + init.sh verdes.
- Decisiones humanas (F1.4, 2026-07-10): ruta `app/recuperar-contrasena/`; contraseña fuerte 8+
  con complejidad (validador zod reutilizable); device/ip reales del request; TTL + rate-limit
  ligero propio (sin lockout de cuenta).
- Reviewer APROBADO en ambos slices, 0 bloqueantes. Mergeada a `origin/dev` vía **PR #20**
  (b1ef459, 2026-07-10 19:15Z). Impl vía backend_dev/frontend_dev DIRECTO (implementer inestable
  por sonnet-4). Excepción aceptada por el humano: `OtpChallengeIssuer` loguea el OTP en claro
  (código heredado, fuera de alcance).

## 2026-07-10 — gestión de usuarios (feature 25, FULLSTACK)
- CRUD de usuarios en `app/(app)/configuracion/`, accesible **solo para rol maestro**, SIN tabla
  nueva (reusa `Usuario`). Requisitos R1–R36 (EARS). BACKEND (T1–T7): `lib/config/usuarios.ts`
  (límites de paginación); `lib/types/usuario.ts` — `crearUsuarioSchema` (unión discriminada por
  `passwordMode`: manual usa `strongPasswordSchema` de la #20, generate sin password),
  `actualizarUsuarioSchema`/`cambiarEstadoUsuarioSchema`/`listarUsuariosSchema`;
  `lib/utils/password-generator.ts` (`generateStrongPassword`, aleatoriedad criptográfica, valida
  su salida, no loguea); `UserRepository`+`IUserRepository` con `list`/`count`/`update`/`setEstado`/
  `listTiposIdentificacion`/`listRoles` (`PUBLIC_SELECT` sin `passwordHash`); `UsuarioService`
  (`ALLOWED_ROLES={maestro}`, autz ANTES de datos, hashPassword, estado `activo`, `generatedPassword`
  una vez en modo generate); `lib/actions/usuarios.ts` (`crear`/`listar`/`obtener`/`actualizar`/
  `cambiarEstado`/`listarTiposIdentificacion`/`listarRoles`). FRONTEND (T8–T11):
  `configuracion/page.tsx` (Server Component valida maestro + pre-fetch), `usuarios-columns`,
  `UsuarioForm` (toggle contraseña escribir/generar), `UsuariosModule` (DataTable+Pagination+Modal
  async+Toast).
- GAP funcional detectado y cerrado antes del merge: el select de rol enviaba el enum `value` pero
  el backend espera `rolId` (UUID) → `CatalogoInvalidoError` en crear. Fix: acción `listarRoles`
  (backend) + wiring del select por `rol.id` (frontend).
- Depends_on 20 (comparte `strongPasswordSchema`); arrancó F2 tras mergear la #20.
- Reviewer APROBADO, 0 bloqueantes; suite ~886 verde; typecheck + init.sh verdes. Mergeada a
  `origin/dev` vía **PR #24** (95d5025, 2026-07-10 20:39Z). Impl vía backend_dev→frontend_dev
  DIRECTO (implementer inestable por sonnet-4). Deuda menor (no bloqueante): subir timeout de un
  test de `usuario-form` (flaky bajo carga paralela).

## 2026-07-10 — vehículos (feature 50, BACKEND) [cierre de bookkeeping]
- Catálogo `vehiculos` SOLO-LECTURA: enum PG `vehiculo_value` (moto/carro/camion) + model `Vehiculo{id,name}`,
  migración `20260710160000_vehiculos` + seed, VERIFICADOS contra Postgres real. Implementada y mergeada
  por otra sesión vía **PR #21** (eb6a17d). Reviewer APROBADO. status -> `done` (bookkeeping corregido en
  esta sesión: el archivo había quedado en `in_progress`). Desbloquea 21→22→23.

## 2026-07-10 — postulación de mensajero (feature 21, FULLSTACK) [cierre de bookkeeping]
- Registro público (postulación) de mensajeros: única vía de auto-registro. Fullstack, R1–R26 (EARS).
  Implementada y mergeada por otra sesión vía **PR #23** (c5c1c97, 2026-07-10 20:32Z); esta sesión solo
  corrige el bookkeeping (el archivo quedó en `pending` por drift de sesiones paralelas). status -> `done`.
- DB: migración `20260710170000_postulacion_mensajero` — agrega a `usuario` las columnas nullable
  `primer_apellido`/`segundo_apellido`/`vehiculo_id`(FK RESTRICT→vehiculos)/`placa` + índice; crea enum
  `mensajero_documento_tipo` (5 valores) y tabla `mensajero_documento` (unique `(usuario_id,tipo)`, FK
  CASCADE, RLS). BACKEND: `lib/types/postulacion-mensajero.ts` (`postulacionSchema` reusa
  `strongPasswordSchema`, valida los 5 documentos por MIME/tamaño), `lib/config/postulacion.ts`,
  `PostulacionRepository`/`MensajeroDocumentoRepository`, `PostulacionMensajeroService` (resuelve rol
  mensajero → valida FKs → unicidad email/cédula → bcrypt → sube 5 docs a Storage → transacción
  crear usuario+docs → **rollback de archivos si falla**; estado `pendiente` por default de DB),
  Server Action `postularMensajero` (FormData, rate-limit por IP|email, NO concede sesión),
  `SupabaseFileStorage` sobre bucket privado `mensajero-docs`. FRONTEND: `app/postulacion/` (page pública
  + `PostulacionForm` con los 5 file inputs y vista de confirmación).
- Reviewer: bloqueante inicial (trazabilidad de `foto_rostro`) RESUELTO → **APROBADO**. Tests: 7 archivos
  unit/component + integración, 56 tests verdes en aislamiento. DEUDA (no bloqueante, documentada):
  aplicar la migración a Postgres real + crear el bucket privado `mensajero-docs`; aprobación/URL firmada
  de documentos diferida a la feature 22.


## 2026-07-10 — aprobación de postulaciones de mensajeros (feature 22, BACKEND)
- Backend puro (sin UI; la consume el dashboard de la feature 23) para que SOLO los roles `maestro`/`admin`
  listen, aprueben o rechacen postulaciones de mensajeros en estado `pendiente`. Mergeada vía **PR #26**
  (8eaed55). SIN migraciones ni cambios de enum (decisiones F1.4: rechazo reusa `inactivo`).
- Requisitos cubiertos: R1–R21 (EARS), cada uno mapeado a test (ver `progress/impl_22-aprobacion-postulaciones.md`).
  Autorización R2–R5 (maestro/admin → ok; mensajero/adminTienda/adminSatelite → `forbidden`; sin sesión →
  `unauthenticated`; guard ANTES de tocar datos/Storage). Aprobar `pendiente→activo` (R12); rechazar
  `pendiente→inactivo` (R16, decisión P1); `not_found` vs `conflict` vía `updateMany` condicional + reconsulta
  (R13/R14/R17/R18); solo se toca `estado` (R15/R19); id inválido → `validation_error` sin tocar datos (R21);
  URLs firmadas del bucket privado con TTL 300s configurable (R9, P3); paginación acotada (R10); lista vacía
  sin error (R11); contratos discriminados por `status` reusando el manejador global feature 10 (R20).
- Archivos: `lib/actions/aprobacion-postulaciones.ts`, `lib/services/AprobacionPostulacionService.ts`,
  `lib/repositories/AprobacionPostulacionRepository.ts`, `lib/storage/SupabaseSignedUrlProvider.ts`,
  interfaces en `lib/interfaces/**`, `lib/types/aprobacion-postulacion.ts`, `lib/config/aprobacion-postulaciones.ts`
  + 4 archivos de test (service/repository/action/storage). Reviewer **APROBADO** 0 bloqueantes; tests propios
  40/40; suite completa 998/999 (único rojo = flaky preexistente de la feature 20, pasa aislado).
- Decisiones F1.4 (humano): P1 rechazo=`inactivo` (cero migraciones); P2 sin motivo de rechazo; P3 TTL firma
  300s; P4 auditoría quién/cuándo fuera de alcance (feature aparte). Desbloquea la feature 23 (dashboard maestro).
- Hallazgos menores no bloqueantes (reviewer): R1 sin test negativo explícito de "no hay ruta pública"; clamp
  de `PAGE_SIZE_MAX` sin test dedicado; fallback silencioso `urlByPath[path] ?? ""` en `toDTO`.
- DEUDA heredada de la 21 sigue vigente: la aprobación real requiere aplicar la migración de la 21 a Postgres
  y crear el bucket privado `mensajero-docs` (entorno con DB real).


## 2026-07-10 — gestión de zonas (feature 24, FULLSTACK) — con REMODELADO de geografía
- **Cambio de modelo respecto a la descripción del backlog** (decisiones del humano en F1.4, spec reabierto):
  la geografía deja de ser hija de la zona y pasa a ser un **catálogo GLOBAL** de Costa Rica
  (`provincia → cantón → distrito`); se **ELIMINA `provincia.zona_id`** y la zona se asigna a nivel de
  **distrito** (`distrito.zona_id` nullable). Motivo: el Excel real asigna zona por distrito y una zona
  cruza provincias (GAM abarca SJ/Alajuela/Cartago/Heredia). El spec previo (geografía inline hija de la
  zona) estaba aprobado pero era incorrecto; se reescribió (R1–R40).
- Construido: migración `20260711120000_zonas_catalogo_global_pagos` (up+down+RLS): DROP `provincia.zona_id`;
  `distrito.zona_id`; `zona.pago_entrega`/`pago_rechazo` (Decimal 12,2 default 0), `zona.es_gam` (bool, índice
  único parcial "a lo sumo una true"); `usuario.zona_id` nullable. Backend (tipos/normalize/config, interfaces,
  `ZonaRepository`/`GeoRepository`/`ZonaService`, `lib/actions/zonas.ts`, `zonaId` en usuarios). Frontend en
  `configuracion` (`ZonaForm`/`ZonasModule`/`zonas-columns`, auth server-side). Seed `scripts/seed-zonas.ts`
  de **dos fuentes**: geografía desde el mapa oficial completo `public/geografia-cr-completa.xlsx`
  (7 prov / 84 cant / 491 dist, generado y validado por el humano) + hints de zona desde el Excel original;
  idempotente, `es_gam` NUNCA sembrado (toggle de UI).
- Decisión R4/R11 del humano (opción b): `orden.zona_id` (NOT NULL) se deriva de `distrito.zona_id` en
  `BulkOrdenService` (feature 15); distrito obligatorio y sin zona → **error de validación por fila**.
  Consecuencia operativa: una carga masiva exige que el maestro haya zonificado los distritos involucrados.
- Requisitos R1–R39 mapeados 1:1 a test (ver `progress/impl_24-gestion-zonas.md`); R40 = gate de despliegue.
  Reviewer **APROBADO** 0 bloqueantes. Verificación: `pnpm test` 1160/1160, `./init.sh` OK, typecheck/lint limpios.
- DEUDA (gate de despliegue, DB real): aplicar la migración y correr `seed-zonas.ts` contra Postgres con los dos XLSX.
- Hallazgos menores (no bloqueantes): (1) el template de carga masiva no marca "Distrito" como obligatorio ni
  comunica el nuevo acoplamiento zona↔distrito; (2) métrica `distritosSinZona` del seed cuenta por hint, no por
  distrito distinto (solo afecta el reporte); (3) índice único de `nombre` sobre valor crudo. Aside preexistente
  feature 15: ejemplos del template siguen siendo de Ecuador (Pichincha/Quito), no Costa Rica.


## 2026-07-11 — revisión maestro / generar guía / asignación de mensajero (feature 17, FULLSTACK)
- El módulo de órdenes del maestro muestra por separado `en_fulfillment`, `en_preparacion`, "en espera de
  aceptación" (`en_espera_aceptacion`, estado NUEVO) y `en_bodega`, con selección por checkbox.
- Backend: migración `20260711130000_orden_num_guia_deferred_mensajero_asignado_espera_aceptacion` (up+down):
  `orden.num_guia` → NULLABLE, secuencia `orden_num_guia_seq` desligada del SERIAL (`OWNED BY NONE`, DROP DEFAULT,
  UNIQUE intacto); nueva columna `orden.mensajero_asignado_id` (FK ON DELETE SET NULL, distinta de
  `mensajero_sugerido_id`); estado `en_espera_aceptacion` en ORDER_STATUS_SEED + fila de catálogo (patrón feat 28).
  `GuiaAsignacionService` (generar-guía sobre AMBOS estados de revisión + asignar-mensajero desde `en_bodega`,
  transaccional, idempotente `WHERE num_guia IS NULL`, `nextval` por fila, solo `maestro`, guardia por estado de
  origen). Server Actions discriminadas por `status`. `BulkOrdenService` (feature 15) ya NO asigna `num_guia` al
  insertar; barrido de `numGuia` → `number|null` en DTOs/consumidores (features 6/7).
- Frontend: vista del maestro con 4 apartados, `GenerarGuiaModal` (modal por lote: agrupa con/sin sugerido,
  override por orden, una sola llamada `{ordenId, mensajeroId|null}`), `AsignarBodegaModal`, columnas + Toast.
  Lista de mensajeros SIN filtro de zona (el filtro por zona/GAM es de la feature 30; límite explícito).
- Requisitos R0–R32 mapeados 1:1 a test. Reviewer **APROBADO** 0 bloqueantes. Verificación: `pnpm test` 1239/1239,
  `./init.sh` OK, typecheck/lint limpios.
- DEUDA (gate de despliegue, DB real): aplicar la migración contra Postgres (no aplicada; sin DB).
- Hallazgos menores (no bloqueantes): (1) brecha TOCTOU en `asignarBodegaLote`/`generarGuiaLote` (re-consulta por
  id sin re-guardar estado/deletedAt dentro de la tx), mitigada por la guardia de estado-origen ante reintentos;
  (2) unicidad de `num_guia` bajo concurrencia real solo ejercida con secuencia mockeada (migración no aplicada
  contra Postgres). Ambos consistentes con el nivel de concurrencia y la deuda de DB del repo.
- **Desbloquea**: features 30 (asignación por zona/GAM, restringe la lista de mensajeros), 32 (etiqueta/QR sobre
  num_guia), 36 (mis asignaciones del mensajero, consume `mensajero_asignado_id` y `en_espera_aceptacion`).
