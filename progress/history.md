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

## 2026-07-10 — dashboard admin maestro (feature 23, FRONTEND)
- Frontend puro: `app/(app)/page.tsx` ramifica por rol — `maestro`/`admin` → `AdminMaestroDashboard`;
  `adminTienda` → dashboard de la feature 26 intacto; resto → placeholder 'Bienvenido'. Panel de
  postulaciones de mensajeros en estado `pendiente` en tarjetas + `Pagination` (feature 8); documentos
  como enlaces "Ver" (A1); aprobar/rechazar con `Modal` async (feature 13) + `Toast` (feature 11) +
  refresco SWR (A2); rechazo sin motivo (A3). Consume las Server Actions de la feature 22. Mergeada
  vía **PR #28** (6bf385b).
- Requisitos cubiertos: R1–R19 (EARS), mapeados a test (ver `progress/impl_23-dashboard-maestro.md`).
- Reviewer **APROBADO** (único mayor era documental, resuelto marcando tasks). Suite 1018 verde;
  typecheck + lint OK; `init.sh` EXIT 0.
- Decisiones F1.4 (humano): A1 documentos como enlaces "Ver"; A2 refresco vía SWR; A3 rechazo sin motivo.

## 2026-07-10 — fulfillment de tienda + estado inicial condicional (feature 27, FULLSTACK)
- Fullstack en un ciclo. (1) Nuevo campo booleano `Usuario.fulfillment` (default false) con migración +
  `down.sql`. (2) El backend fuerza `fulfillment=false` si el rol ≠ `adminTienda` (R4/R4a). (3) Switch
  'esta tienda tiene fulfillment' en `UsuarioForm` (feature 25, R5/R6). (4) Estado inicial de la carga
  masiva CONDICIONAL en `BulkOrdenService` según el `adminTienda` autenticado: con fulfillment →
  `en_fulfillment`; sin fulfillment → `en_preparacion` (R15). Mergeada vía **PR #29** (c4530c4).
- Requisitos cubiertos: R1–R15 (EARS), mapeados a test (ver `progress/impl_27-fulfillment-tienda.md`).
- Reviewer **APROBADO** 0 bloqueantes. Suite 1053 verde post-merge; `init.sh` OK.
- **Desbloquea la feature 17** (deps 27 y 28 done).


## 2026-07-10 — carga masiva: corrección CR + acoplamiento distrito/zona (feature 51, FRONTEND)
- Corrección derivada de hallazgos del reviewer de la feature 24. Frontend puro (sin tocar backend/feature 15).
  (1) `OrdenesCargaMasivaButton.tsx`: campo `distrito` marcado `required` (sufijo " *" en la cabecera XLSX vía
  `xlsx-template.ts`); (2) Alert (shadcn, icono Info) dentro del modal avisando que cada orden debe indicar un
  distrito y ese distrito debe tener zona, o la fila se rechaza (acoplamiento R4/R11 de la feature 24);
  (3) ejemplos de plantilla Ecuador→Costa Rica (San José/San José/Carmen; teléfono 8 dígitos CR).
  `BulkUpload.tsx`/`xlsx-template.ts` extendidos con `required?`.
- Tests de componente añadidos (distrito requerido, opcional no requerido, aviso renderizado, ejemplos CR / no
  Ecuador) + test del sufijo " *". Suite 1165/1165 verde; typecheck/lint/`init.sh` OK.
- Proceso: corrección pequeña, ciclo SDD agilizado (spec inline por el leader, sin reviewer formal aparte).

## 2026-07-11 — asignación por zona (GAM) y ruteo a bodega satélite (feature 30, FULLSTACK)
- El maestro (bodega central) SOLO controla la zona GAM. Al asignar mensajero, solo aparecen los de zona GAM
  (filtro por `zonaId` = zona con `esGam=true`); si la orden es de otra zona, el maestro no la asigna a mensajero:
  la rutea a la bodega satélite de esa zona → estado NUEVO `en_ruta_bodega_satelite` ("En ruta a bodega <zona>",
  nombre derivado de `orden.zonaId`). Al rutear se asigna `num_guia` (secuencia, idempotente).
- Backend (backend_dev, model opus): 10.º valor `en_ruta_bodega_satelite` en `ORDER_STATUS_SEED` + migración
  `20260711140000_order_status_en_ruta_bodega_satelite` (ADD VALUE IF NOT EXISTS + INSERT ON CONFLICT + `down.sql`
  reversible con DELETE condicional, patrón feat 17/28). `ZonaRepository.findGamZonaId`; en `OrdenRepository`
  `findMensajerosGam`/`findMensajeroIdsValidosGam`/`rutearBodegaSateliteLote` + zona en transición y listado;
  `GuiaAsignacionService` inyecta `IZonaRepository`, guardia R4 (rechazo `validation_error` si no hay zona GAM),
  clasificación GAM/no-GAM en lote mixto (una tx), método `rutearABodegaSatelite`; actions `rutearABodegaSatelite`
  + `listarMensajerosParaAsignacion` filtrada a GAM (firmas estables).
- Frontend (frontend_dev, model opus): columna "Zona", badge dinámico, 5.º apartado solo-lectura "En ruta a
  bodega satélite" + `RutearSateliteModal`, y `GenerarGuiaModal` con split GAM (select) / no-GAM (grupo satélite
  sin select, `mensajeroId=null`). Contrato de columnas de la feature 26 intacto.
- Requisitos cubiertos: R1–R22 (EARS), mapeados 1:1 a test (ver `progress/impl_30-...md`). Reviewer **APROBADO**
  0 bloqueantes (corrió `./init.sh` él mismo). Verificación: `pnpm test` **1287/1287**, `./init.sh` EXIT 0, typecheck/lint OK.
- Decisiones F1.4 (humano 2026-07-11, las 6 recomendadas): (a) GAM=flag `esGam`+guardia R4 (sin sembrar zona GAM);
  (b) un `en_ruta_bodega_satelite` con zona derivada; (c) ruteo solo transición + `orden.zonaId`; (d) orígenes
  `en_fulfillment`/`en_preparacion`/`en_bodega`; (e) override del `GenerarGuiaModal` también filtrado a GAM (service
  revalida); (f) `num_guia` al rutear.
- DEUDA (gate de despliegue, DB real): migración NO aplicada contra Postgres (sin DB aislada); cubierta por test de
  integración estático `order-status-satelite-migration.test.ts`.
- Hallazgos menores (aceptados): (1) `zonaNombre`/`zonaEsGam` opcionales en `OrdenListItemDTO` (aditivo R19); el repo
  siempre los envía. (2) `listarMensajerosParaAsignacion` devuelve vacío si no hay zona GAM — candidato a aviso de UX.
- **Desbloquea / se apoya en**: feed a features 33 (recepción QR en satélite consume `en_ruta_bodega_satelite`),
  34 (asignación desde satélite) y 39 (pago por zona). Consumió 24 (zonas/`esGam`) y 17 (generar guía/`num_guia`).

## 2026-07-11 — etiqueta de guía con QR y código de barras (feature 32, FULLSTACK)
- Al pulsar la acción "Imprimir etiquetas" sobre el lote seleccionado (vista del maestro, feature 17), se genera un
  **PDF descargable, una etiqueta EXACTAMENTE 100mm × 100mm por orden** (PDF multipágina), con todos los datos del
  paquete + un **código QR** (codifica `orden.id`, lo escaneará la feature 33 para recepción) y un **código de barras**
  (codifica `num_guia`, CODE128). Solo se etiquetan órdenes que YA tienen `num_guia`; las demás se omiten con aviso.
- Backend (backend_dev, model opus), **SIN migración/tabla** (read DERIVADO): `EtiquetaGuiaDTO` (`lib/types/etiqueta-guia.ts`)
  + `OrdenRepository.findEtiquetasByIds` que RESUELVE lo que el `OrdenDTO` no expone (nombres de tienda/zona/provincia/
  cantón/distrito + `direccion` + `montoCobrar` Decimal→number); `EtiquetaGuiaService` (guardia `num_guia`, autz
  maestro-only) + Server Action `lib/actions/etiquetas-guia.ts` (zod + `resolveActorFromSession` + `withErrorHandler`).
  `findEtiquetasByIds` es aditivo en `IOrdenRepository` (contratos 6/7/17/26/30 intactos). `lib/config/moneda.ts` (patrón
  de `lib/config/ordenes.ts`, env override, default `es-CR`/`CRC`).
- Frontend (frontend_dev, model opus): acción "Imprimir etiquetas" en `OrdenesRevisionMaestro` sobre la selección/lote,
  `EtiquetaGuia`/`EtiquetasGuiaModal`, y `etiquetas-pdf.ts` con **jspdf** (`unit:"mm", format:[100,100]`, una página por
  etiqueta, rasteriza el QR de `qrcode.react` y el barcode de `jsbarcode`). Deps NUEVAS: `qrcode.react`, `react-barcode`,
  `jspdf`, `jsbarcode`.
- Requisitos cubiertos: R1–R15 (EARS), mapeados 1:1 a test. Reviewer **APROBADO** 0 bloqueantes (corrió `./init.sh` él
  mismo). Verificación: `pnpm test` **1314/1314**, `./init.sh` EXIT 0, typecheck/lint OK.
- Decisiones F1.4 (humano 2026-07-11): (a) QR=`orden.id`; (b) barcode=`num_guia`; **(c) PDF real 100×100 mm** (CAMBIO vs
  la recomendación HTML `window.print()` → superseded R10; suma dep de PDF sobre qrcode.react+react-barcode); (d)
  `qrcode.react`+`react-barcode`(+`jspdf`/`jsbarcode`); (e) acción "Imprimir etiquetas" sobre el lote; (f) rol maestro,
  órdenes con `num_guia`; (g) reimpresión libre sin auditoría.
- DEUDA / verificación MANUAL (declarada): el tamaño binario exacto del PDF y la escaneabilidad física del QR no son
  unit-testeables; quedan como verificación manual.
- **Desbloquea**: feature 33 (recepción por escaneo del QR en bodega satélite). Consumió la 17 (`num_guia`).

## 2026-07-11 — mensajero: "Mis asignaciones" y gestión de órdenes (feature 36, FULLSTACK)
- Módulo `/mis-asignaciones` del rol `mensajero`. Máquina de estados (aclaración del humano: "aceptar" = orden
  RECOGIDA por el mensajero): asignada (17/34) → `en_espera_aceptacion` ("esperando que el mensajero la recoja")
  → [botón **Recoger**, lote "Recoger todas" + individual] → estado NUEVO **`en_reparto`** → gestión de UNA en una
  → `entregada`/`reprogramada`/`devuelta`/estado NUEVO **`rechazada`**.
- Gestión (4 resultados, obligatoriedad por resultado): ENTREGADA → foto evidencia + `montoRecibido` (DEBE cuadrar
  EXACTO con `montoCobrar`, comparación `Prisma.Decimal.equals`) + método de pago; REPROGRAMAR → fecha futura +
  motivo; DEVOLUCIÓN → motivo; RECHAZO → foto evidencia + motivo.
- Backend (backend_dev, model opus): migración `20260711150000_gestion_orden_estados_metodo_pago` (up+down):
  2 valores de order_status (`en_reparto`, `rechazada`), enum PG `metodo_pago_value` (efectivo/SIMPE/transferencia),
  enum `gestion_resultado`, tabla `gestion_orden` (+**RLS**, sin policies = solo service role), puntero de bloqueo
  1-a-1 `usuario.orden_en_gestion_id` (FK ON DELETE SET NULL). `GestionOrdenRepository`, `MisAsignacionesService`
  (listar / recoger lote+individual / gestionar por resultado / **liberarGestion**), actions en `lib/actions/
  mis-asignaciones.ts` (zod + `resolveActorFromSession` + `withErrorHandler`). Bloqueo 1-a-1 robusto ante carreras
  (`updateMany` idempotente) y recargas; se libera al completar (dentro de la tx) o al CANCELAR el modal (R35).
  Evidencias en bucket privado NUEVO `gestion-evidencias` (patrón `SupabaseFileStorage`/`ISignedUrlProvider`, path
  privado + URL firmada, atomicidad storage↔DB con remove best-effort).
- Frontend (frontend_dev, model opus): módulo con detalle completo, secciones por-recoger/en-reparto, "Recoger
  todas" + individual, `GestionarOrdenModal` (4 resultados), bloqueo 1-a-1 respaldado por el puntero backend, subida
  de foto, select de método de pago; labels `en_reparto`/`rechazada`. Reusa DataTable/Pagination/Modal/Toast.
- Requisitos cubiertos: R0–R34 + R35 (liberar lock, aditivo), mapeados 1:1 a test. **Ciclo con 1 rechazo**: el
  reviewer bloqueó por (1) tasks sin marcar y (2) falta E2E de recaudo (checkpoint de flujo de dinero); el humano
  decidió AÑADIR el E2E. Correcciones: `e2e/mis-asignaciones.spec.ts` (recoger→ENTREGAR/RECHAZO/REPROGRAMAR,
  patrón escrito-no-ejecutado de `auth.spec.ts`), `withErrorHandler` en actions, `liberarGestion`, comparación de
  monto en Decimal. **Re-review APROBADO** 0 bloqueantes. Verificación: `pnpm test` **1433/1433**, `./init.sh`
  EXIT 0, typecheck (incl. `e2e/`) + lint OK.
- Decisiones F1.4 (humano 2026-07-11): (a) estado recogida=`en_reparto`/acción "Recoger"; (b) rechazo=`rechazada`
  nuevo; (c) enum PG `metodo_pago_value`; (d) tabla `gestion_orden` con `resultado`; (e) bloqueo backend
  `usuario.orden_en_gestion_id`; (f) bucket `gestion-evidencias`; (g) recoger lote+individual; (h) monto exacto;
  (i) obligatoriedad por resultado; (j) trato idéntico central/satélite.
- DEUDA declarada: crear bucket privado `gestion-evidencias` en Supabase (HUMANO); migración NO aplicada contra
  Postgres real (deuda de despliegue); E2E ESCRITO pero NO ejecutado (requiere entorno con DB/seed/login).
- **Desbloquea**: feature 37 (cierre del día, consume las órdenes gestionadas y los montos por método de pago),
  y es base de 46/47/48/49 (reprogramación/reintentos/retorno/trazabilidad). Consumió la 17.

## 2026-07-11 — bodega satélite: "Mis asignaciones" y recepción por QR (feature 33, FULLSTACK)
- Módulo del rol `adminSatelite` en ruta NUEVA `/recepcion-satelite` (no `mis-asignaciones`, que es del mensajero,
  feature 36). Dos secciones: "Por recibir" (`en_ruta_bodega_satelite` de SU zona) y "Recibidas"
  (`en_bodega_satelite`). Recepción por ESCANEO del QR de la etiqueta (feature 32, QR=`orden.id`): cada escaneo
  transiciona `en_ruta_bodega_satelite` → estado NUEVO `en_bodega_satelite` ("en bodega satélite de <zona>",
  zona derivada de `orden.zonaId`, patrón feature 30).
- Backend (backend_dev, model opus): 13.º valor `en_bodega_satelite` en `ORDER_STATUS_SEED` + migración
  `20260711160000_order_status_en_bodega_satelite` (up+down condicional, patrón 30). `findUsuarioZonaId` (espejo de
  `findUsuarioFulfillment`; el zonaId del adminSatelite se resuelve SERVER-SIDE, no se toca el tipo `Actor`),
  `findRecepcionSateliteByZona`, `recibirEnSatelite` (UPDATE con `WHERE` por estado origen + zonaId).
  `RecepcionSateliteService.recibir`: guardas rol `adminSatelite` + zona propia (orden de otra zona → `zona_ajena`,
  doble defensa), idempotencia (ya recibida → `ya_recibida` sin doble transición), 5 casos de error tipados. Actions
  con zod + `resolveActorFromSession` + `withErrorHandler`.
- Frontend (frontend_dev, model opus): página protegida server-side (`notFound` si no adminSatelite), módulo dos
  secciones, `EscanerRecepcion` con AMBOS caminos — **cámara `html5-qrcode`** (import dinámico dentro de `useEffect`,
  nunca SSR) + **lector físico keyboard-wedge** (input), ambos → misma action; feedback por ítem (Toast); ítem de
  Sidebar gated por rol. Cambios a EstatusBadge/estatus-label/order-status/Sidebar puramente aditivos.
- Requisitos cubiertos: R1–R23 (EARS), mapeados 1:1 a test. Reviewer **APROBADO** 0 bloqueantes (corrió `init.sh` +
  `pnpm build`). Verificación: `pnpm test` **1493/1493**, `./init.sh` EXIT 0, typecheck/lint OK. Dep nueva `html5-qrcode`.
- Decisiones F1.4 (humano 2026-07-11): (a) escaneo AMBOS = cámara + lector keyboard-wedge (PWA = feature FUTURA
  aparte); (b) un `en_bodega_satelite` zona-derivada; (c) solo su zona (server-side, `zona_ajena`); (d) 1-a-1
  idempotente; (e) 5 casos de error; (f) sección "Recibidas" aparte; (g) E2E `e2e/recepcion-satelite.spec.ts`
  (escrito, ejecución diferida); (h) sin vista del maestro.
- DEUDA declarada: migración NO aplicada contra Postgres real (cubierta por test estático); verificación MANUAL del
  hardware (cámara/lector); E2E escrito NO ejecutado.
- HALLAZGO ajeno (pre-existente, NO de la 33): `pnpm build` falla el prerender de `/postulacion` (feature 21) por
  `prisma.vehiculo.findMany()` en prerender estático sin `export const dynamic` (`P2021` sin DB en build). Candidato
  a **feature de corrección aparte** (declarar la ruta dinámica o no consultar Prisma en prerender). `html5-qrcode`
  NO lo causa (solo se carga en cliente).
- **Desbloquea**: feature 34 (asignación a mensajeros desde la satélite, parte de `en_bodega_satelite`). Consumió
  la 30 (`en_ruta_bodega_satelite`) y la 32 (QR=`orden.id`).

## 2026-07-11 — fix build: /postulacion prerender dinámico (feature 52, FRONTEND)
- Corrección de BUILD (bug PRE-EXISTENTE detectado por el reviewer de la feature 33, ajeno a ella). `pnpm build`
  fallaba el prerender ESTÁTICO de la ruta pública `app/postulacion/page.tsx` (feature 21): Server Component async
  que consulta Prisma (`VehiculoRepository.findMany()` + `prisma.tipoIdentificacion.findMany()`) sin leer
  `cookies()`/`headers()`, así que Next intentaba prerenderizarla en build; sin DB → `P2021 TableDoesNotExist`.
  Las otras rutas con Prisma (`app/(app)/page.tsx`, `login`, `recuperar-contrasena`) leen `cookies()` y salen
  dinámicas solas, por eso no fallaban.
- FIX: `export const dynamic = "force-dynamic"` en `app/postulacion/page.tsx` (renderiza en request time; apropiado
  para página pública que lee catálogos de DB). Una línea + comentario; sin tocar lógica ni otras rutas.
- Verificación: **`pnpm build` PASA** (`/postulacion` ahora `ƒ Dynamic`); `./init.sh` verde, `pnpm test` **1493/1493**.
- Proceso: corrección pequeña, ciclo SDD agilizado (spec inline por el leader en `feature_list.json` id 52, sin
  reviewer formal aparte; el criterio de aceptación es el build verde). No hay patrón en el repo para unit-testear
  config de ruta (`export const dynamic`); la verificación es el `pnpm build`.

## 2026-07-11 — deuda de despliegue: migraciones aplicadas + fix db-rollback Prisma 7 (feature 53, BACKEND/TOOLING)
- Contexto: el humano pidió saldar las deudas dependientes del entorno (ejemplo: migraciones) antes de avanzar.
- HALLAZGO clave: `DATABASE_URL` apunta a un **Postgres LOCAL** (`localhost:5432`, db `ordenex`), NO a un Supabase
  compartido (la nota vieja del repo era incorrecta). Riesgo bajo.
- Migraciones: `prisma migrate deploy` aplicó las **12 pendientes** (cobros, rol adminSatelite, rename
  embalaje→en_fulfillment, enum order_status, vehículos, postulación, fulfillment, zonas, num_guia diferido,
  en_ruta_bodega_satelite, gestion_orden+enums, en_bodega_satelite). `migrate status` = "up to date"; `db:seed`
  (catálogos) OK.
- Al verificar el ROLLBACK (T020) se descubrió que `scripts/db-rollback.ts` estaba **doblemente roto en Prisma 7**:
  (1) `prisma db execute` ya no acepta `--schema` (datasource vía `prisma.config.ts`); (2) `migrate resolve
  --rolled-back` da P3012 (solo migraciones FALLIDAS, no aplicadas). FIX (backend_dev, model opus): quitar
  `--schema` del `db execute`, y reemplazar `migrate resolve --rolled-back` por un `DELETE FROM "_prisma_migrations"
  WHERE "migration_name"=...` (a un archivo temporal ejecutado con `db execute`, guard de validación del nombre).
- Verificación del rollback (round-trip real contra la DB local): `pnpm db:rollback` (revierte la última) →
  `migrate status` la muestra pendiente → `migrate deploy` la reaplica → "up to date". DB dejada consistente.
  `./init.sh` verde, `pnpm test` **1493/1493**, typecheck OK.
- DEUDA RESTANTE (registrada en `current.md`): E2E ejecutables (falta harness de seed/login e2e — candidato a
  feature), seed de ZONAS (necesita el Excel del humano), RLS con key anon (T004). El bucket `gestion-evidencias`
  aplica solo si se usa Supabase Storage.
- Proceso: ciclo ágil, spec inline (feature_list id 53). Corrió sobre la rama `chore/deuda-despliegue-migraciones`.

## 2026-07-11 — bodega satélite: asignación a mensajeros de su zona (feature 34, FULLSTACK)
- El adminSatelite asigna sus órdenes `en_bodega_satelite` (recibidas, feature 33) a mensajeros de SU zona →
  `en_espera_aceptacion` (mismo estado del flujo del maestro, feature 17; luego la consume el mensajero en la 36).
  SIN estados nuevos, SIN migración, SIN generar `num_guia` (las órdenes ya lo tienen). Cierra la cadena operativa
  satelital: rutear (30) → etiqueta QR (32) → recibir (33) → **asignar (34)** → mensajero recoge/gestiona (36).
- Backend (backend_dev, model opus): `AsignacionSateliteService` (servicio PARALELO al `GuiaAsignacionService` del
  maestro, decisión F1.4-a; guardas rol `adminSatelite` + zona propia resuelta server-side vía `findUsuarioZonaId`;
  5 errores tipados `estado_invalido`/`zona_ajena`/`mensajero_invalido`/`sin_zona`/`no_encontrada`; lote todo-o-nada)
  + `OrdenRepository.asignarSateliteLote` (`updateMany` guardado por estado+zona+deletedAt, concurrencia-segura,
  re-lee y `conflict` si count≠esperado). Action con zod + `resolveActorFromSession` + `withErrorHandler`.
  RENAME honesto (decisión F1.4-b): `findMensajerosGam`→`findMensajerosByZona`, `findMensajeroIdsValidosGam`→
  `findMensajeroIdsValidosByZona` (interfaz + repo + llamadores 17/30; maestro sigue pasando la zona GAM, VERDE).
- Frontend (frontend_dev, model opus): EXTIENDE `recepcion-satelite` (decisión F1.4-c, no ruta nueva): la sección
  "Recibidas" → `ListaRecibidas` con checkbox por fila + "Asignar" + `AsignarSateliteModal` (lote con 1 mensajero,
  patrón `AsignarBodegaModal` de la 17, decisión F1.4-d). Mensajeros por props desde Server Component.
- Requisitos cubiertos: R1–R20 (EARS), mapeados 1:1 a test. Reviewer **APROBADO** 0 bloqueantes (corrió `init.sh`).
  Verificación: `pnpm test` **1519/1519**, `./init.sh` EXIT 0, typecheck (incl. `e2e/`) + lint OK. Rename NO rompió
  el maestro (17/30 verdes).
- Decisiones F1.4 (humano 2026-07-11, las 6 recomendadas): (a) servicio paralelo; (b) rename a `...ByZona`;
  (c) extender `recepcion-satelite`; (d) lote con 1 mensajero; (e) errores tipados todo-o-nada; (f) E2E
  `e2e/asignacion-satelite.spec.ts` (escrito, ejecución diferida).
- DEUDA declarada: E2E escrito NO ejecutado (requiere entorno con DB/seed/login). Hallazgo menor (aceptado): en el
  detalle de carrera R14, motivo `conflict` vs `estado_invalido` (cosmético).
- **Desbloquea/completa**: cierra la cadena satelital operativa. Consumió 33 (`en_bodega_satelite`), 17 (asignación/
  `en_espera_aceptacion`) y 30 (filtro de mensajeros por zona, ahora `...ByZona`).

## 2026-07-12 — reconciliación del refactor PR #40: dev verde + esCentral (feature 54, FULLSTACK/FIX)
- FIX-FEATURE de emergencia: el PR #40 "Adjustments" (refactor cobros→tarifas, zona↔distrito N:M, `TarifaZonaMensajero`
  pago-por-zona, sidebar/menú shadcn nuevo) se mergeó A MEDIAS a `dev` y lo dejó ROJO: `prisma validate` inválido + 86
  errores de typecheck + 11 tests fallando. Decisión del humano (2026-07-12): arreglar HACIA ADELANTE (conservar el
  refactor) + reponer la identificación de la zona central con flag NUEVO `esCentral` (renombrado desde `esGam`).
- Reconciliación (backend_dev + frontend_dev, model opus): (1) schema — repone `Zona.usuarios Usuario[]` (P1012);
  renombra `Zona.esGam`→`esCentral` (`@map("es_central")`, índice único parcial) vía migración
  `20260712000000_zona_es_central_rename` (+down.sql); convierte la migración #40 rota
  `20260711200000_provincia_zona_id_nullable` (ALTER sobre columna inexistente, 42703) en no-op idempotente guardado.
  (2) resolver — `IZonaRepository.findGamZonaId`→`findCentralZonaId` (devuelve la zona `esCentral=true`); actualiza los
  llamadores 17/30 (`GuiaAsignacionService`, `ordenes-guia.ts`) manteniendo la semántica (maestro asigna a mensajeros
  de la zona central). (3) recablea `ZonaRepository`/`TarifaRepository`/`GeoRepository` al nuevo modelo. (4)
  `zonas-columns.tsx` usa `esCentral` y quita las columnas de pagos (movidos a tarifas/`TarifaZonaMensajero`).
- Loose-ends del #40 también corregidos (2do pase): (a) `menu-visibility.test.ts` obsoleto (desestructuraba por
  posición; el #40 reordenó el menú) → referencia por LABEL; (b) el #40 REVIRTIÓ la feature 51 (ejemplos de la
  plantilla volvieron a Ecuador) → RESTAURADO Costa Rica (San José/San José/Carmen) + distrito `required` en
  `OrdenesCargaMasivaButton`; (c) tests de invariante de migración (frágiles ante la migración retro-fechada
  `20260711000000_seed_roles_catalogo` del #40) → comparación contra predecesor real fijo (no tautológico).
- Verificación (reviewer + leader, ambos corrieron): `npx prisma validate` OK, `pnpm typecheck` **0**, `pnpm test`
  **1565/1565**, `./init.sh` verde, `pnpm build` OK, `migrate status` up-to-date. Reviewer **APROBADO** 0 bloqueantes.
- Ciclo ágil (fix-feature, spec inline en `feature_list.json` id 54 con criterios de aceptación; sin `specs/54-` dir,
  precedente 51/52/53). Se conservó la intención del #40 (no se revirtió nada del refactor).
- DEUDA/FOLLOW-UP (feature 55): `ZonaForm.tsx` sigue STUBBEADO (solo `nombre`) → NO hay UI para marcar la zona
  `esCentral`, así que `findCentralZonaId` devuelve null y el maestro (30) no puede asignar en runtime hasta
  completarla. También: limpieza cosmética de nombres `esGam` legacy; drift schema/DB en `provincia.zonaId`.
- **DESBLOQUEA**: `dev` vuelve a estar verde → repara 17/30/34 y destraba la feature 37 (pausada, spec intacto).

## 2026-07-12 — feature 37 (mensajero: "Cierre del día")
- Módulo `/cierre-dia` del rol mensajero: acumula las gestiones (feature 36) aún sin cierre
  (`cierre_id IS NULL`), las agrupa por resultado (entregada/reprogramada/devuelta/rechazada) con el
  detalle completo por orden, calcula los **totales por método de pago** (efectivo/SIMPE/transferencia)
  + total general, y permite **Solicitar cierre** (crea `cierre_dia` en estado `solicitado`, snapshotea
  los totales, vincula las gestiones y deriva el destino por zona). Histórico de cierres propios.
- Requisitos cubiertos: R1–R20 + E2E (cada uno con test concreto; reviewer verificó la trazabilidad).
- Modelo: tabla NUEVA `cierre_dia` (mensajero, estado, `destino_tipo`/`destino_zona_id`, totales
  Decimal snapshot) + enums `cierre_estado`(`solicitado`/`aprobado`/`rechazado`, los 2 últimos
  reservados para la 38) y `cierre_destino_tipo`(`bodega_central`/`bodega_satelite`) + FK nullable
  `cierre_id` en `gestion_orden` (ON DELETE SET NULL). Migración `20260712100000_cierre_dia` con
  `down.sql` (round-trip verificado) y **RLS** sin políticas anon/authenticated.
- Money-critical: montos `Prisma.Decimal`, serializados como **string** cruzando Server Action→cliente
  (cero `parseFloat`); totales cuadran al centavo. Ruteo server-side con `IZonaRepository.findCentralZonaId()`.
- Decisiones F1.4 (aprobadas por el humano 2026-07-11): (a) tabla+FK; (b) agrupa por `cierre_id IS NULL`,
  no por fecha; (c) precondición sin órdenes pendientes; (d) sin estado "abierto", nace `solicitado`;
  (e) destino `tipo`+`zona` (no un admin puntual); (f) snapshot de totales; (g) E2E; (h) histórico; (i) $0
  para reprog/dev/rech. Verde: prisma OK, typecheck 0, lint 0, **1623/1623 tests (+58)**, init.sh OK.
- Contexto: F2 estaba PAUSADA por el #40 (dev roto); la feature 54 reparó dev y renombró el resolver
  `findGamZonaId`→`findCentralZonaId` (`esGam`→`esCentral`), reconciliado en el spec de la 37 antes de impl.
- DEUDA/limitación (feature 55, pending): hasta que la 55 marque una zona `esCentral`, en runtime
  `findCentralZonaId()` devuelve null → todo mensajero rutea a satélite (fallback seguro, sin romper);
  la clasificación a `bodega_central` "despierta" cuando caiga la 55. E2E escrito, ejecución diferida
  (sin harness seed/login e2e). Migración no aplicada aún contra Postgres real.
- **DESBLOQUEA**: feature 38 (aprobar/rechazar cierre) y la base de 39/40/41.

## 2026-07-12 — feature 55 (completar ZonaForm: `esCentral` + drift `provincia.zonaId`)
- FOLLOW-UP de la 54 (deuda del #40). Reconstruyó por completo `app/(app)/configuracion/_components/ZonaForm.tsx`
  (que el #40 había stubbeado a solo `nombre`): crear/editar zona con nombre + selección provincia/cantón/
  distritos (N:M `ZonaDistrito`) + `cobroVehiculo` + tarifas + toggle **`esCentral`**. Crear zona (antes
  imposible) y editar (prefill de distritos desde el N:M) vuelven a funcionar.
- Requisitos cubiertos: R1–R14 (cada uno con test concreto; reviewer verificó trazabilidad).
- **Decisiones F1.4 (aprobadas por el humano 2026-07-12, todas las recomendadas):** (A) marcar una zona como
  central existiendo otra → **REASIGNAR** desmarcando la previa en la MISMA transacción (`ZonaRepository`
  `tx.zona.updateMany` dentro de `$transaction`; `P2002` sobre `zona_es_central_unico` → `ConflictError`, no 500);
  (B) reconstrucción COMPLETA de `ZonaForm`; (C) drift `provincia.zonaId` = reconciliación **SOLO-SCHEMA** (se
  borraron los símbolos huérfanos `Provincia.zonaId`/`Provincia.zona`/`Zona.provincias` del `schema.prisma`; la
  columna ya no existía en la DB — SIN migración ni `down.sql`); (D) el seed NO toca `es_central`.
- Nuevos: `lib/interfaces/services/IGeoService.ts`, `lib/services/GeoService.ts`, `lib/actions/geo.ts` (catálogo
  de geografía para los selectores, gate `maestro`), + tests (`provincia-schema-drift`, `geo-service`, `geo-action`).
- Confirmación de reasignación (UI): checkbox inline bloqueante ("Entiendo que reasignaré la zona central");
  sin marcarlo, el submit devuelve `validation_error` y no llama al backend. Reviewer lo dictaminó **menor** (el
  design proponía Modal como ruta recomendada, no requisito duro; cumple "confirmación explícita antes de reasignar").
- Verde: `prisma validate` valid, `migrate status` up-to-date (0 migraciones nuevas), typecheck 0, lint 0,
  **1614/1614 tests (+49)**, `init.sh` OK. Reviewer APROBADO 0 bloqueantes.
- **DESBLOQUEA el runtime de `bodega_central`**: con una zona marcada `esCentral` desde la UI,
  `IZonaRepository.findCentralZonaId()` deja de devolver null → el maestro (30) puede asignar/rutear y despiertan
  34/37 en producción. Deuda menor: `conflict` sin payload por-campo; divergencia escalar↔N:M del seed (nivel feat-24).

## 2026-07-12 — feature 38 (admin: cierres del día, aprobar/rechazar)
- Módulo `/cierres-admin` para el admin de bodega (maestro para la central/GAM, adminSatelite para su bodega):
  cola de cierres `solicitado` de su alcance + histórico de `aprobado`/`rechazado`, con el detalle COMPLETO de
  cada cierre (órdenes gestionadas, evidencias por URL firmada, montos, métodos, motivos) y los totales snapshot.
  Aprobar/rechazar de a uno tras ver el detalle. Consume el flujo de la feature 37.
- Requisitos cubiertos: R1–R17 + E2E (cada uno con test concreto; reviewer verificó trazabilidad).
- **Decisiones F1.4 (aprobadas por el humano 2026-07-12, todas recomendadas):** (a) rechazo **INMUTABLE**
  (solo cambia `estado`; las `gestion_orden` NO se desvinculan; el desbloqueo/re-solicitud del mensajero es de
  la feature 41); (b) REUSA el DTO de detalle de la 37 (`CierreDetalleGestion`/`WITH_DETALLE`/firma de evidencia)
  + añade `findGestionesByCierre`; (c) cola + histórico por alcance; (d) transición con guardia de concurrencia
  `updateMany ... WHERE id + estado='solicitado' + alcance` (sin TOCTOU; `count===0` → `conflict`/`fuera_de_alcance`);
  (e) migración **ADITIVA** `20260712110000_cierre_dia_resolucion` (`resuelto_por` FK `ON DELETE SET NULL`,
  `resuelto_at`, `motivo_rechazo` OBLIGATORIO al rechazar) con `down.sql`, RLS intacta; (f) E2E escrito; (g) de a uno.
- Alcance por rol+zona SERVER-SIDE en el WHERE (listado, detalle y transición): `maestro`→`bodega_central`;
  `adminSatelite`→`bodega_satelite` + `destinoZonaId = findUsuarioZonaId`. adminSatelite sin zona → `no_encontrada`
  (no filtra existencia). Otro rol → `notFound()`. Money-critical: totales snapshot (Decimal→string, sin `parseFloat`).
- Nuevos: `lib/services/CierresAdminService.ts`, `lib/repositories/CierresAdminRepository.ts`, sus interfaces,
  `lib/types/cierres-admin.ts`, `lib/actions/cierres-admin.ts`, `app/(app)/cierres-admin/` + ítem de sidebar
  (`menu-visibility.ts`, roles maestro/adminSatelite). Verde: prisma OK, typecheck 0, lint 0, **1739/1739 (+116)**,
  `init.sh` OK, migración round-trip OK. Reviewer APROBADO 0 bloqueantes.
- **DESBLOQUEA** la feature 40 (cierre bodega satélite → central) y complementa 39/41. Deuda menor: tests de
  transición/migración unit-mock (no integración DB real); E2E ejecución diferida.

## 2026-07-12 — feature 40 (cierre de bodega satélite → bodega principal)
- SEGUNDO NIVEL de cierre (doble espejo de 37/38): el adminSatélite CONSOLIDA los cierres de mensajero YA
  aprobados de su zona y SOLICITA el cierre de su bodega a la central; el maestro lo APRUEBA o RECHAZA. Extiende
  el módulo `/cierres-admin` de forma **role-aware** (adminSatélite solicita, maestro aprueba/rechaza); las
  secciones de cierres de mensajero (feature 38) quedan intactas.
- Requisitos cubiertos: R1–R25 + E2E (cada uno con test concreto; reviewer verificó trazabilidad y defensas DB live).
- **Decisiones F1.4 (aprobadas por el humano 2026-07-12, todas recomendadas):** (a) tabla nueva `CierreBodega` +
  FK nullable `cierre_bodega_id` en `cierre_dia` (espejo de `gestion_orden.cierre_id` de la 37); (b) reusa el enum
  `CierreEstado`; (c) al solicitar entran solo los `cierre_dia` `aprobado` de la zona con `cierre_bodega_id IS NULL`
  (los `rechazado` se excluyen y no bloquean); (d) precondición: bloquea si quedan `cierre_dia` `solicitado` sin
  resolver en la zona; (e) totales snapshot AGREGADOS (suma Decimal congelada al solicitar, money-critical); (f)
  pago al mensajero OMITIDO del detalle (es la feature 39); (g) índice único parcial `(zona_id) WHERE
  estado='solicitado'` (≤1 cierre de bodega abierto por zona; `P2002`→`conflict`); (h) maestro ve cola+histórico;
  (i) motivo de rechazo obligatorio; (j) rechazo INMUTABLE (no desvincula `cierre_dia`; desbloqueo=feature 41);
  (k) auditoría `resuelto_por`/`resuelto_at`/`motivo_rechazo`; (l) extender `/cierres-admin` role-aware.
- Alcance server-side: solicitar solo `adminSatelite` sobre SU zona (`findUsuarioZonaId`); resolver solo `maestro`;
  transición guardada `updateMany WHERE estado='solicitado'` sin TOCTOU; otro rol → `notFound()`/`forbidden`.
- Nuevos: `lib/services/CierreBodegaService.ts` (solicitar) + `CierresBodegaAdminService.ts` (resolver), sus repos e
  interfaces, `lib/types/cierre-bodega.ts`, `lib/actions/cierre-bodega.ts`, migración `20260712120000_cierre_bodega`
  (+ down.sql + RLS), `/cierres-admin` extendido. Reusa el detalle de 37/38 (sin duplicar). Verde: prisma OK,
  typecheck 0, lint 0, **1797/1797 (+58)**, `init.sh` OK, build pasa, migración round-trip real en DB viva.
  Reviewer APROBADO 0 bloqueantes.
- **DESBLOQUEA** la feature 41 (reglas/bloqueos/vencidos). Deuda menor: R8/R16/R18/R20-22 unit-mock (defensas DB
  verificadas live por el reviewer); R24 sin test automatizado de RLS; E2E ejecución diferida.

## 2026-07-12 — feature 39 (pago al mensajero por zona en el cierre)
- Money-critical. Cada gestión de un cierre trae el PAGO AL MENSAJERO resuelto por su zona+vehículo vía
  `TarifaZonaMensajero` (`cobroEntregado`, con fallback a la tarifa por defecto de la zona `vehiculoId IS NULL`),
  snapshoteado al solicitar el cierre y totalizado en los 3 niveles (mensajero 37, admin 38, bodega 40).
- Requisitos cubiertos: R1–R23 + R7b (cada uno con test concreto; reviewer verificó trazabilidad + round-trip real).
- **Decisiones F1.4 (aprobadas por el humano 2026-07-12):** (1) **SNAPSHOT** al solicitar (no derivado) — migración
  aditiva `20260712130000_pago_mensajero_cierre`: `gestion_orden.pago_mensajero` (NULL), `cierre_dia`/`cierre_bodega`.`total_pago_mensajero` (DEFAULT 0) + `down.sql`; la vista viva del mensajero deriva solo para preview. Snapshot
  INMUTABLE verificado (cambiar la tarifa después NO muta un cierre ya solicitado). (2) **SOLO `entregada` paga**
  al mensajero (→`cobroEntregado`); `rechazada`/`reprogramada`/`devuelta` = 0.00. (3) El `cobroRechazado` (pago por
  rechazo) NO va al mensajero sino a la BODEGA → SEPARADO en la **feature 56** nueva (`ingreso de bodega por
  rechazos`, pending, dep 39). (4) Resolución por `usuario.zonaId`+`usuario.vehiculoId` con fallback; el pago sale
  de la zona del MENSAJERO. (5) Tarifa faltante = 0.00, NO bloquea + aviso en vista admin. (6) Exponer en los DTOs
  de 37/38/40 y totalizar en las pantallas existentes (sin pantallas nuevas).
- **Reconciliación de modelo:** la descripción vieja del feature_list ("la zona almacena el pago") quedó desfasada
  por el #40 — el pago vive en `TarifaZonaMensajero`. `usuario.zonaId`/`vehiculoId` existen.
- Nuevos: `lib/interfaces/repositories/ITarifaZonaMensajeroRepository.ts` + repo, `lib/utils/pago-mensajero.ts`
  (util puro solo-entregada). Money-safe: `Prisma.Decimal`, string `toFixed(2)`, cero `parseFloat`. Verde: prisma OK,
  typecheck 0, lint 0, **1829/1829**, `init.sh` OK, build OK, SIN regresión 37/38/40. Reviewer APROBADO 0 bloqueantes.
- DEUDA menor: el aviso de "tarifa faltante" se infiere por heurística en el frontend (`entregada` && pago==="0.00"),
  con falso positivo posible en una entrega legítima de ₡0.00 → candidato a flag `tarifaFaltante` server-side
  (feature 56 o follow-up). Comentario obsoleto en un test de la 40 (m2). `ZonaRepository.toNumber` fuera de flujo (m4).

## 2026-07-12 — feature 56 (ingreso de bodega por rechazos, `cobroRechazado`)
- Money-critical. Espejo de la 39 para el OTRO lado del par pago-por-zona: cuando una gestión de un cierre resulta
  `rechazada`, el `cobroRechazado` de la tarifa de la zona es un INGRESO PARA LA BODEGA (destino del cierre: central
  si `esCentral`, satélite si no), no un pago al mensajero. Se resuelve con la MISMA `TarifaZonaMensajero` de la 39
  (reusa `resolvePagoTarifa`, sin modelo nuevo), se snapshotea al solicitar el cierre y se totaliza en los 3 niveles.
- Requisitos cubiertos: R1–R22 + R7b + R23 (cada uno con test concreto; reviewer verificó trazabilidad + round-trip).
- **Decisiones F1.4 (aprobadas por el humano 2026-07-12):** (Q1) aplica cuando la tarifa de la zona tiene
  `cobroRechazado>0` — la condición vive en la tarifa, no hay flag aparte; (Q2) SOLO `rechazada` genera ingreso;
  (Q3) **SNAPSHOT** al solicitar (inmutable, verificado); (Q4) migración aditiva `20260712140000_ingreso_bodega_rechazos`
  en 3 niveles (`gestion_orden.ingreso_bodega_rechazo` NULL + `cierre_dia`/`cierre_bodega`.`total_ingreso_bodega_rechazos`
  DEFAULT 0) + `down.sql`; (Q5) la bodega beneficiaria es el DESTINO del cierre ya calculado por la 37; (Q6) SÍ añadir
  flag **`tarifaFaltante` server-side** al DTO — **RESUELVE la deuda m1 de la 39**: elimina la heurística frontend
  (`entregada && pago==="0.00"`) por un flag derivado donde el resolver da `null`, sin falsos positivos en entregas
  legítimas de ₡0.00; (Q7) se muestra en las 3 vistas de cierre existentes (sin pantallas nuevas).
- Nuevos: `lib/utils/ingreso-bodega.ts` (util puro solo-rechazada, espejo de `pago-mensajero.ts`); columnas/labels
  "Ingreso de bodega por rechazos" en `/cierre-dia`, `/cierres-admin` y detalle de bodega. Money-safe: `Prisma.Decimal`,
  string `toFixed(2)`, cero `parseFloat`/`Number(` en rutas de dinero.
- **IMPL EN 2 COMMITS** por el bug de subagente opus-4.8[1m]: el `implementer` completó el backend y murió (API error)
  antes del frontend → el leader commiteó el backend verde (`6a0153d`) y relanzó `frontend_dev` directo (model:opus)
  para completar Q6+Q7 con asserts de UI (`40d99e2`). Verde: prisma OK, typecheck 0, lint 0, **1867 tests** (1 flaky
  ajeno `LoginForm`, pasa aislado), `init.sh` OK, migración round-trip OK, SIN regresión 37/38/39/40. Reviewer APROBADO
  0 bloqueantes (verificación round-trip real, snapshot inmutable probado, deuda m1 de la 39 RESUELTA).
- **CIERRA el par pago-por-zona** (mensajero 39 + bodega 56). Deuda menor: R21 test de migración estático (round-trip
  real corrido por el reviewer); E2E ejecución diferida.

## 2026-07-12 — feature 41 (reglas y bloqueos de cierre: obligatoriedad, vencidos)
- Reglas de negocio críticas de los cierres (reflejan el ingreso de dinero de la empresa): (1) jerarquía/bodega
  responsable por zona (central si `esCentral`, si no la satélite); (2) OBLIGATORIEDAD + VENCIDOS por corte diario
  automático; (3) BLOQUEO del mensajero con cierre pendiente; (4) BLOQUEO de la bodega satélite con cierres pendientes.
- Requisitos cubiertos: R1–R24 (cada uno con test concreto; reviewer verificó trazabilidad + round-trip real).
- **Decisiones F1.4 (aprobadas por el humano 2026-07-12):** (Q1) **Vercel Cron Jobs** — route handler
  `/api/cron/corte-diario` protegido con `CRON_SECRET` (401 sin secreto), `vercel.json` `crons "0 6 * * *"` = 00:00
  hora Costa Rica (UTC-6); idempotente por vinculación de gestiones (segunda corrida no duplica), jornada calculada
  en hora local CR. (Q2) el corte CREA una **fila real** `cierre_dia estado='vencido'` para cada mensajero que "debía
  cerrar y no solicitó" (≥1 `gestion_orden` con `cierre_id IS NULL` y sin `solicitado`), con destino a su bodega
  responsable, gestiones vinculadas y snapshot money-safe (`Prisma.Decimal`); no recalcula cierres resueltos. (Q3)
  bloqueo del mensajero **DERIVADO** (sin flag): bloqueado ⇔ existe cierre `solicitado`∨`vencido`; `rechazado` no
  bloquea; se desbloquea al resolver. (Q5) el `vencido` es resoluble por la bodega responsable reutilizando la
  feature 38 (guardia de transición extendida para aceptar `vencido` como origen), resolver desbloquea, totales no se
  recalculan. (Q6) SIN pantallas nuevas. (Q4 — **REGLA ESTRICTA elegida por el humano, no la recomendada**): la bodega
  satélite queda bloqueada para asignar si (i) tiene cierres de sus mensajeros en `solicitado`/`vencido` de su zona
  **O** (ii) su propio `CierreBodega` está en `solicitado` (único estado pendiente de `CierreBodega`, feature 40); test
  por cada causa.
- Guardas de asignación: maestro (17/30, `GuiaAsignacionService`) y adminSatélite (34, `AsignacionSateliteService`)
  rechazan asignar a mensajero bloqueado / con bodega bloqueada, todo-o-nada, motivo accionable. UI: vencidos
  diferenciados en `/cierres-admin` role-aware, avisos de bloqueo (mensajero + satélite por causa) en vistas existentes.
- Nuevos: enum `vencido` (migración aditiva up/down, round-trip real verificado incl. recreación del uq de la 40),
  route handler del cron + `lib/config/cron.ts`, `vercel.json` `crons`. Verde: prisma OK, typecheck 0, lint 0,
  **1931/1931 (+64)**, `init.sh` OK, SIN regresión 37/38/39/40/56. Reviewer APROBADO 0 bloqueantes. Commit `dde6fba`.
- **DESBLOQUEA** la fase de wallet/pagos (42-45) que se apoya en cierres aprobados. DEUDA menor: TOCTOU residual en el
  lote del maestro (pre-check sin `NOT EXISTS`; el path satélite sí lo integra; justificado/no bloqueante) → follow-up;
  R23 sin test de carrera real contra DB; `CRON_SECRET` documentado en `lib/config/cron.ts` (el `.env.example` está
  gitignored); E2E `e2e/reglas-bloqueos-cierre.spec.ts` escrito pero no ejecutado (patrón del arnés).

## 2026-07-12 — feature 42 (wallet: caja principal de Ordenex)
- Money-critical. Módulo WALLET = caja PRINCIPAL de Ordenex: **LIBRO append-only INMUTABLE** `wallet_movimiento`
  (`tipo` ingreso/egreso + `categoria` + `monto` Decimal + `origen_tipo`/`origen_id` polimórfico), **balance general
  DERIVADO** (Σingreso − Σegreso con `Prisma.Decimal`, sin saldo mutable — "libro de movimientos, no tablero de
  saldos", decisión humano 2026-07-10). RAÍZ de la cadena de pagos: deja el modelo de egresos genérico listo para
  43/44/45. Módulo nuevo `/wallet` (rol maestro) con libro paginado + balance + filtros + movimiento manual.
- Requisitos cubiertos: R1–R26 (cada uno con test concreto; reviewer verificó trazabilidad, round-trip real e
  idempotencia por constraint DB contra Postgres vivo).
- **Decisiones F1.4 (aprobadas por el humano 2026-07-12):** (Q1) el ingreso de Ordenex se DERIVA de la tarifa vigente
  de la zona AL APROBAR el cierre y el movimiento append-only ES el snapshot (sin tocar la feature 37) **+ NUEVA
  columna `orden.cobra_comision`** (`Boolean NOT NULL DEFAULT true`, retro-compatible): la comisión COD solo se cobra
  en órdenes `entregada` con `cobra_comision=true`; la 42 la añade y la LEE, poblarla editable por-orden queda como
  deuda A5. (A1) `entregada` → flete (`valorFleteGam`/`valorFlete` por `esCentral`) + comisión COD (si aplica) + IVA
  flete + IVA comisión; `devuelta`/`rechazada` → **flete de DEVOLUCIÓN** (`valorFleteDevueltoGam`/`valorFleteDevuelto`)
  + su IVA, SIN comisión; `reprogramada` → sin ingreso. (Q2) un movimiento por CONCEPTO agregado por cierre — 6
  categorías (`ingreso_flete`, `ingreso_flete_devolucion`, `ingreso_comision_cod`, `ingreso_iva_flete`,
  `ingreso_iva_flete_devolucion`, `ingreso_iva_comision_cod`); no emite concepto en 0.00. (Q3) SOLO `CierreDia`
  aprobados alimentan; `CierreBodega` (40) no re-cuenta; `vencido`→`aprobado` (41) alimenta una sola vez. (Q4) tabla
  única polimórfica reservada para egresos de 43/44/45. (Q5) `/wallet` rol maestro. (Q6) movimientos manuales mínimos
  (ajuste ingreso/egreso, inmutables, descripción obligatoria).
- Enganche money-critical: en `CierresAdminRepository.resolverCierre`, en la MISMA `$transaction` que la aprobación,
  IDEMPOTENTE por constraint DB `(origen_tipo, origen_id, categoria)` con `ON CONFLICT DO NOTHING` (sin TOCTOU) y
  ATÓMICO (todo-o-nada). Nuevos: `lib/utils/ingreso-ordenex.ts` + `wallet-balance.ts`, repos/services de wallet, migración
  aditiva (tabla + enums + índices + RLS sin policies + columna en `orden`). Money-safe: `Prisma.Decimal`, STRING
  `toFixed(2)`, cero `parseFloat`/`Number(`.
- Verde: prisma OK, typecheck 0, lint 0, **2008/2008 (+77)**, `init.sh` OK, round-trip de migración REAL (incl. drop de
  `orden.cobra_comision` y 3 enums), SIN regresión 37/38/39/40/56/41. Reviewer APROBADO 0 bloqueantes tras 1 ciclo (el
  rechazo inicial fue por falta del E2E → añadido `e2e/wallet.spec.ts`, commit `1f9124b`). Commits `a9769ea`+`f85ee42`+`1f9124b`.
- **DESBLOQUEA** 43 (pagos a tiendas), 44 (pagos a mensajeros), 45 (gastos/sueldos), que insertan sus egresos en el
  libro. DEUDA menor: captura editable de `cobra_comision` por-orden (A5, features 14/15/16/17); test de idempotencia
  unit usa mock en memoria (el constraint real lo verificó el reviewer); E2E escrito pero no ejecutado (patrón del arnés).

## Feature 46 — reprogramación: bloqueo y liberación programada (2026-07-13)

- **Primera de la Fase 2 del flujo del mensajero** (grupo 46/47/49 elegido por el humano). Fullstack/high, un ciclo.
  Rama `feature/46-reprogramacion-bloqueo-liberacion` desde `origin/dev` (que ya tiene 36/41/42/56). F1.4 APROBADA
  (todas las recomendadas). Impl COMPLETA R1–R21 + reviewer APROBADO 0 bloqueantes. Commit `a9fa3c8` + cierre chore(state).
- **BLOQUEO server-side real:** una orden con gestión `reprogramada` cuya `fechaReprogramacion > hoy (CR)` NO es
  reasignable/enviable. Guarda tipada `MSG_ORDEN_REPROGRAMADA_BLOQUEADA` en `GuiaAsignacionService` (`generarGuia` +
  `asignarDesdeBodega`) y `AsignacionSateliteService.asignar`, ANTES del check de origen, todo-o-nada; envío bloqueado
  por origen en `MisAsignacionesService`.
- **LIBERACIÓN programada:** cron NUEVO `/api/cron/liberar-reprogramadas` (auth `CRON_SECRET` antes de cualquier efecto,
  `schedule 0 6` diario en `vercel.json` = 00:00 CR, hora CR UTC−6 con fronteras testeadas) devuelve la orden a
  `en_bodega`/`en_bodega_satelite` derivado de la zona (`findCentralZonaId`, reúsa el ruteo de 30/33) para que la bodega
  la re-asigne vía 17/34. Idempotencia DERIVADA del estatus (UPDATE guardado por `estatusId=reprogramada`) + columna
  `orden.liberada_reprogramada_at`. **AVISO** = visibilidad derivada "liberadas hoy" en ambas bodegas (sin tabla nueva).
- **Migración** aditiva `20260713100000_orden_liberada_reprogramada_at` (columna nullable + índice parcial + `down.sql`
  inverso exacto). NO añade columnas de intentos/historial → R21 (contador de intentos / trazabilidad) FUERA DE ALCANCE
  = features 47/49.
- Verde: typecheck 0, lint 0, **2056/2056 (+48)**, `init.sh` OK, round-trip de migración verificado por SQL directo
  contra el Postgres local. DEUDA menor: E2E `e2e/reprogramacion-liberacion.spec.ts` escrito pero diferido (convención
  del arnés); round-trip por test estático + SQL manual (no CI).
- **NOTA AMBIENTAL (ajena a la 46):** el Postgres local arrastra la migración de la feature 43
  (`20260712170000_wallet_tienda_movimiento`, no en `dev`) → `prisma migrate status` falla; reconciliar el historial
  local (o `migrate reset`) antes del despliegue. **PENDIENTE: abrir PR a `dev` + merge (OK humano).** NOTA: con la
  feature 43 ya mergeada a `dev` (PR #50, 2026-07-13) este drift ambiental queda resuelto al reconciliar la rama.

## 2026-07-12 — feature 43 (wallet por tienda: saldo a favor de la tienda)
- Money-critical. Cada TIENDA (rol `adminTienda`) tiene su wallet con su SALDO A FAVOR = cuánto le debe entregar
  Ordenex = COD recaudado − (flete + comisión COD + IVA flete + IVA comisión) por orden. Es el **COMPLEMENTO EXACTO**
  del ingreso de Ordenex de la feature 42: reutiliza `derivarIngresoOrden` (42) para los débitos y `montoRecibido`
  para el crédito COD, sin fórmula nueva.
- Requisitos cubiertos: R1–R29 (cada uno con test concreto; reviewer verificó trazabilidad, round-trip real,
  invariante de cuadre en ambos estados del flag e idempotencia por constraint DB viva).
- **Decisiones F1.4 (aprobadas por el humano 2026-07-12):** (Q1) **LEDGER propio** `wallet_tienda_movimiento`
  (append-only inmutable, espejo de la 42 con dimensión `tienda_id`), alimentado en el MISMO enganche del cierre
  aprobado (`CierresAdminRepository.resolverCierre`, misma `$transaction`, tras la 42), congelando los montos al
  aprobar (evita divergencia con el snapshot de la 42 ante cambios de tarifa). (Q2) el crédito usa el COD REALMENTE
  recaudado (`gestion_orden.montoRecibido`); los débitos se toman tal cual de la 42 (la comisión sigue sobre
  `montoCobrar`). (Q3) `devuelta`/`rechazada` → la tienda **DEBE el flete de devolución** (`flete_devolucion` +
  `iva_flete_devolucion` como débitos → saldo negativo), **PERO REVERSIBLE** vía flag
  `TIENDA_DEBITA_FLETE_DEVOLUCION` (`lib/config/wallet-tienda.ts`, única fuente de verdad, **default true**,
  sobreescribible por env): en `false` el feed NO emite esos débitos a la tienda (la 42 no cambia; Ordenex absorbe),
  y la reversión de lo histórico va por ajuste compensatorio append-only, sin migración. (Q4) alcance = MODELO +
  VISIBILIDAD; el PAGO/liquidación a la tienda queda como follow-up (`pago_tienda`/`egreso_pago_tienda` reservados).
  (Q5) pantalla nueva `/mi-wallet` (adminTienda, acotada a su `usuarioId`=`tiendaId`) + `/wallet/tiendas` (maestro ve
  todas). (Q6) un movimiento por CONCEPTO agregado por (tienda, cierre), categorías espejo 1:1 de la 42.
- **Invariante de cuadre (R15) CONDICIONAL al flag:** con flag TRUE, `crédito COD − Σ débitos tienda = COD recaudado
  − ingreso Ordenex (42)` cuadra exacto; con flag FALSE, para devoluciones la diferencia es exactamente el flete de
  devolución + su IVA (absorbido por Ordenex). Test en ambos estados.
- Nuevos: tabla `wallet_tienda_movimiento` (migración aditiva up/down real, RLS sin policies, unique parcial de
  idempotencia `(origen_tipo, origen_id, tienda_id, categoria)`), `WalletTiendaFeedService`, config `wallet-tienda.ts`,
  service/actions role-aware, `/mi-wallet` + `/wallet/tiendas`, `e2e/mi-wallet.spec.ts`. Money-safe: `Prisma.Decimal`,
  STRING `toFixed(2)`, cero `parseFloat`/`Number(`; saldo derivado (puede ser negativo).
- Verde: prisma OK, typecheck 0, lint 0, **2092/2092 (+84)**, `init.sh` OK, round-trip de migración REAL por
  introspección, SIN regresión 37/38/39/40/56/41/42. Reviewer APROBADO 0 bloqueantes. Commit `6923a7b`.
- DEUDA menor: E2E escrito pero no ejecutado (patrón del arnés); test de migración unit estático (el round-trip real
  lo corrió el reviewer). El PAGO efectivo a la tienda queda como follow-up sobre el modelo ya probado.

## Feature 49 — trazabilidad / historial de estados de la orden (2026-07-13)

- **Segunda de la Fase 2 del flujo del mensajero** (grupo 46/47/49). Fullstack/high, TRANSVERSAL, un ciclo.
  Rama `feature/49-trazabilidad-historial-estados` desde el TIP de la 46 (contiene 43+46, para instrumentar la
  liberación de la 46). F1.4 APROBADA (todas las recomendaciones). Impl R1–R34 + reviewer APROBADO 0 bloqueantes
  (el reviewer reprodujo el grep de cobertura y el round-trip de migración, no solo por bitácora). Commit `faeeb2a`.
- **Choke point único** `registrar-cambio-estado.ts` (`OrdenEstadoService`): append INMUTABLE a
  `orden_historial_estado` en la MISMA `$transaction` que el cambio de estado (nunca un estado sin su línea).
- **Los 11 puntos de escritura de estado instrumentados atómicamente (11/11, sin 12º escapado):**
  `OrdenRepository` #1 `createManyOrdenes` / #2 `create` / #3 `generarGuiaLote` / #4 `asignarBodegaLote` /
  #5 `rutearBodegaSateliteLote` / #6 `recibirEnSatelite` / #11 `update`; #7 `asignarSateliteLote` (SQL crudo:
  `$executeRaw`→`$queryRaw ... RETURNING id` en la tx, CONSERVA el anti-TOCTOU `NOT EXISTS`, registra solo las
  filas realmente transicionadas — R8); `GestionOrdenRepository` #8 `recogerLote` / #9 `crearGestionYTransicionar`;
  `LiberacionReprogramadaRepository` #10 `liberarOrden` (actor NULL/cron, append solo si `count>0`).
- **Contador de intentos DERIVADO** del historial (sin columna materializada); la regla "≥3 intentos → escala a
  `rechazada`" queda para la feature 47 (que consume el derivador). Estado INICIAL (creación) = primera línea
  (órdenes post-deploy). SIN backfill retroactivo.
- **UI**: drawer "Ver historial" desde la lista de órdenes (no había página de detalle), con visibilidad por rol
  enforced SERVER-SIDE (maestro/admin todas, adminTienda su tienda, mensajero sus asignadas —vía nuevo
  `OrdenDTO.mensajeroAsignadoId` opcional, sin migración—, adminSatélite su zona). Realtime (35) fuera de alcance
  (solo punto de extensión).
- **Migración** aditiva `20260713120000_orden_historial_estado` (tabla append-only + RLS sin policies + índice
  `(orden_id, created_at)` + `down.sql` inverso). Verde: typecheck 0, lint 0, **2225/2225 (+85)**, `init.sh` OK,
  round-trip REAL. DEUDA menor: test de cobertura estático (compensado por el grep del reviewer, conjunto de 11
  cerrado); test RLS estático; E2E diferido. **PENDIENTE: sync con `dev` + PR + merge (OK humano).**

## 2026-07-13 — feature 44: wallet, pago a mensajeros y cuentas por pagar
- Qué se construyó: tercer eslabón de la cadena wallet (42 caja → 43 tienda → **44 mensajeros**). Al aprobar un
  `CierreDia` se congela el pago al mensajero contra el efectivo que recaudó: `pago_devengado = P`
  (`total_pago_mensajero`, snapshot 39), `pago_efectivo = min(P, total_efectivo)` (snapshot 37), y la **cuenta por
  pagar** (lo pendiente) es el saldo DERIVADO `Σdevengo − Σpago` (sin saldo almacenado).
- Requisitos cubiertos: R1–R27 (fullstack, money-critical).
- F1.4 APROBADA: Qa=SÍ (además del libro propio, EGRESO `egreso_pago_mensajero = P` en la caja 42, cuadrado);
  Qb=append-only + cuenta por pagar derivada; Qc=automático al aprobar; Qd=`min(P,E)`, `P=0` sin movimiento;
  Qe=vista maestro `/wallet/mensajeros` + self-view mensajero `/mis-pagos` (adminSatélite NO); Qf=liquidación manual
  como FOLLOW-UP (categoría `liquidacion` + `origen_tipo=pago_mensajero` reservados).
- Modelo: tabla `pago_mensajero_movimiento` (libro append-only INMUTABLE; RLS sin policies; idempotencia por índice
  único parcial `(origen_tipo, origen_id, mensajero_id, categoria) WHERE origen_id IS NOT NULL`; migración aditiva
  `20260712180000_pago_mensajero_movimiento` + `down.sql`; reutiliza `wallet_origen_tipo` de la 42).
- Enganche ATÓMICO en `CierresAdminRepository.resolverCierre` (misma `$transaction`, tras 42/43; solo `CierreDia`).
- Reviewer: RECHAZADO en el 1.er ciclo por R18 (desglose por cierre del maestro) y R22 (filtros server-side del
  maestro); corregido (capa service+action del maestro) + re-review APROBADO 0 bloqueantes.
- Verde: prisma OK, typecheck 0, lint 0, **2191 tests**, `init.sh` OK; migración verificada ESTÁTICAMENTE (Postgres
  local compartido con la 49 en paralelo). Corrió en PARALELO con la 49 en worktree aislado `../ordenex-f44`.
  Sincronizada con `dev` (46 + 49). **PR #53 → `dev`**. DESBLOQUEA la 45 (gastos/sueldos), último eslabón wallet.

## Feature 47 — reintentos de entrega y escalado a rechazo (2026-07-13)

- **Tercera de la Fase 2 del flujo del mensajero** (grupo 46/47/49 → 48). Fullstack/high, un ciclo. Rama desde `dev`
  verde POST-REVERT #55 (el PR #54 "adjustments" había revertido la 49 y roto la cadena wallet 42/43/44; el revert #55
  lo restauró). F1.4 APROBADA (todas las recomendaciones). Impl R1–R22 + reviewer APROBADO 0 bloqueantes. Commit `68eb8fd`.
- **Cambio central:** hoy una gestión `devuelta` dejaba la orden TERMINAL; la 47 la vuelve REINTENTABLE. En
  `GestionOrdenRepository.crearGestionYTransicionar`, en la MISMA `$transaction` que la gestión: `en_reparto→devuelta`
  (actor=mensajero) + una transición de seguimiento — `devuelta→rechazada` si `intentos>=umbral` (escalado final) o
  `devuelta→en_bodega/en_bodega_satelite` si no (reintento, ruteo por zona vía `findCentralZonaId` reusando 30/33/46) —
  cada una con su `appendCambioEstado` (choke point de la 49, `actor=null` sistema, `origen_tipo=gestion`). **Atómico:**
  si el 2º append falla, revierte todo.
- **Contador DERIVADO** del historial de la 49 (`contarPorDestino` sobre `orden_historial_estado`, sin columna nueva;
  SOLO `devuelta` cuenta, `reprogramada` NO). **Umbral CONFIGURABLE** `lib/config/reintentos.ts` (default 3, "mínimo por
  ley"). `devuelta_origen`/retorno a la tienda = FUERA DE ALCANCE (feature 48).
- **SIN migración** (los estatus ya existían; `origen_tipo=gestion` reutilizado). Añadido `zonaId` a la proyección
  `findByIdsParaGestion` (`OrdenGestionRow`) para rutear el reintento. Test de cobertura de la 49 sigue cerrado (11
  puntos, enum sin valores nuevos). UI badge "intento X de N" en la lista + el sheet de historial de la 49.
- Verde: typecheck 0, lint 0, **2355/2355 (+31)**, `init.sh` OK, SIN regresión 36/49. DEUDA menor: E2E diferido; TOCTOU
  teórico del conteo mitigado por la guardia de origen `en_reparto` + puntero 1-a-1 (aprobado en F1.4); R12 sin test
  nominal. **PENDIENTE: PR a `dev` + merge (OK humano).**

## 2026-07-13 — feature 58: plantilla carga masiva, fila de ejemplo re-subible (+ follow-up modal)
- Fix ágil (frontend/low, `sdd:false`, sin `specs/58/`). Rama `feature/58-plantilla-ejemplos-cr` desde el revert del #54
  (`12a67cc`, ya en `dev` vía PR #55). Criterio de aceptación: descargar la plantilla y subirla sin editar debe crear
  las órdenes de ejemplo. **Cumplido y verificado por el humano en la app.**
- **Diagnóstico (la premisa registrada era incorrecta):** los valores de ejemplo `San José/San José/Carmen` **SÍ** son
  válidos — existen en el catálogo geo sembrado y Carmen tiene zona **GAM** (verificado contra la DB local real, no solo
  el XLSX). El fallo real tenía dos capas encadenadas:
  1. **500** al cargar → **cliente Prisma OBSOLETO** (fechado Jul-9, anterior a las migraciones 42/43/44/46/49). El dev
     server corría contra él → cualquier query con campos nuevos reventaba. Resuelto con `prisma generate` + reinicio del
     server. (Esto también explicaba los "68 typecheck / 60 tests rojos" que reportó una entrega previa.)
  2. **«distrito requerido»** → el generador de plantilla **XLSX** (`lib/utils/xlsx-template.ts`) sufijaba con `" *"` la
     cabecera de los campos `required`. `distrito` es el ÚNICO `required:true` del repo → header `"distrito *"`. El parser
     (`spreadsheet.ts`) identifica columnas por el TEXTO del header → clave `"distrito *"` ≠ `"distrito"` que espera
     `filaCargaSchema` → el valor "Carmen" queda huérfano y `distrito` llega vacío. El CSV no tenía el sufijo (por eso solo
     fallaba el XLSX, que es el default). El roundtrip test previo no lo cazó porque solo validaba `REQUIRED_HEADERS`
     (5 columnas de cabecera), y `distrito` es obligatorio por-FILA, no por-cabecera.
- **Fix:** `headerFor` devuelve siempre `label ?? key` (eliminado `REQUIRED_SUFFIX`); el texto de la cabecera no puede
  divergir de la clave que el parser usa como identificador. La obligatoriedad se comunica en la UI (Alert del botón), no
  en el archivo. Comentario del campo `required` en `BulkUpload.tsx` actualizado al nuevo contrato.
- **Blindaje:** `carga-masiva-plantilla-roundtrip.test.ts` reforzado — asserta que CADA clave de columna aparece VERBATIM
  en los headers reparseados (caza `"distrito *"`) y que la fila de ejemplo expone `distrito="Carmen"` pasando por
  `filaCargaSchema`. `xlsx-template.test.ts` reescrito (antes exigía el sufijo `" *"` = codificaba el bug; ahora exige que
  `required` NO altere la cabecera). Borrado código muerto (`carga-masiva-fields.ts`, duplicado de una entrega defectuosa)
  y repuntado el guard de geo a la constante viva `ORDENES_BULK_FIELDS`.
- **Follow-up UI (mismo PR):** el `Modal` compartido no crecía con la tabla ancha (8 columnas) del paso "resumen" de la
  carga (features 14/16/29): estaba capado a `max-w-md` sin `max-height`/overflow. Fix en `Modal.tsx` — Popup
  `max-h-[calc(100dvh-2rem)]`; cuerpo `min-h-0 flex-1 overflow-auto` (único bloque scrolleable); header/footer `shrink-0`
  (fijos). `OrdenesCargaMasivaButton.tsx` pasa `max-w-4xl sm:max-w-5xl` sólo en `step==="resumen"`. El `Select` de la tabla
  portalea (`SelectPrimitive.Portal`) → el overflow no lo recorta. Sin cambios de lógica/API; `DataTable`/`OrdenesCargaResumen`
  intactos; 18 consumidores del Modal verdes.
- **Reviewer APROBADO 0 bloqueantes** (`review_58`), corrió la verificación él mismo. VERDE: typecheck **0**, `npx vitest run`
  **2330/2330 (260 archivos)**, focalizado 17/17. Menores no bloqueantes: focus-ring cosmético en borde de scroll (tradeoff
  estándar de modal scrolleable). **Un PR (2 commits: fix plantilla + fix modal) `feature/58 → dev`.** MERGEADA (PR #56).

## Feature 48 — rechazo: devolución a la tienda de origen (2026-07-13)

- **CUARTA y ÚLTIMA de la Fase 2 del flujo del mensajero** → cierra el grupo **46/47/48/49**. Fullstack/high, un ciclo.
  Rama desde el tip de la 47 (`dev`+58+47). F1.4 APROBADA (todas las recomendaciones). Impl R1–R19 + reviewer APROBADO
  0 bloqueantes. Commit `5467b94`.
- **Retorno por ACCIÓN MANUAL de la bodega responsable** (`DevolucionOrigenService.devolverATienda`): `rechazada →
  devuelta_origen`. Elegible CUALQUIER orden en `rechazada` — ambos caminos (rechazo directo del mensajero -36- y
  escalado -47-); la elegibilidad es por ESTADO, no por camino. Idempotente.
- **Transición ATÓMICA y trazada** vía el choke point de la 49 reutilizando el punto #11 (`OrdenRepository.update`,
  `origen_tipo=ajuste_estado`): `updateMany` + `appendCambioEstado` en la MISMA `$transaction` (revierte si el append
  falla). `orden-historial-cobertura.test.ts` SIGUE en 11 puntos (enum sin `devolucion_origen`).
- **Autz rol+zona SERVER-SIDE**: `bodega_central`→maestro/admin; `bodega_satelite`→adminSatélite de la zona; resto
  forbidden. Sub-riesgo F1.4-d respetado (`OrdenService.KNOWN_ROLES` sigue sin `adminSatelite`; la superficie del
  satélite vive en `RecepcionSateliteService` acotada por zona). **Tienda de origen** = `orden.tienda_id` (nada nuevo);
  el adminTienda VE sus `rechazada`/`devuelta_origen` por scope server-side. UI: botón "Devolver a tienda" en la bodega
  + apartado de devueltas del adminTienda.
- **SIN migración** (los estatus y el `tienda_id` ya existían). Verde: typecheck 0, lint 0, **2405/2405 (+44)**,
  `init.sh` OK, SIN regresión 36/47/49. DEUDA menor: authz corre tras la guarda de estado → un actor no responsable
  puede recibir `ok`/conocer estado vía el `motivo` del conflict sin modificar datos (follow-up authz-first); E2E
  diferido. **PENDIENTE: PR a `dev` + merge (OK humano).**

## 2026-07-13 — feature 57: botón cerrar sesión (logout) para todos los roles
- Fullstack/low, `sdd:true`. Corrió **EN PARALELO con la feature 47** (otra sesión, fase spec) en **worktree aislado** `../ordenex-f57`
  desde `dev`, archivos disjuntos (shell/auth vs. máquina de estados de la 47). Ciclo SDD completo (spec_author → F1.4 →
  frontend_dev → reviewer).
- **Problema operativo resuelto:** no había forma de cerrar sesión en roles como `tienda`. El único botón de logout vivía a mano
  en la rama genérica "Bienvenido" de la home (`app/(app)/page.tsx`), a la que `tienda`/`maestro` ni llegan (retornan su dashboard).
- **Hallazgo clave:** el **backend de logout YA EXISTÍA** — `logout` (`lib/actions/auth.ts`) → `AuthService.logout` →
  `SessionRepository.deleteById` (idempotente, borra la cookie `session`; con tests en `auth-action`/`auth-service`/`session-repository`).
  El guard de rutas es `middleware.ts` (redirige a `/login` sin cookie). Así que la feature fue **puro frontend**.
- **F1.4 APROBADA (humano):** (a) REUTILIZAR el `LogoutButton` existente TAL CUAL (un click, sin cambiarle el comportamiento:
  `logout()` + `router.push("/login")` + estado "Cerrando sesión…"), colocado en un **`SidebarFooter`** de
  `app/(app)/_components/Sidebar.tsx`. Como el layout compartido `app/(app)/layout.tsx` monta el `Sidebar` para CUALQUIER rol y el
  footer NO depende de `items`, el botón queda visible para **todos los roles**. (b) SIN modal de confirmación.
- **Cambios:** `Sidebar.tsx` (+`SidebarFooter`+`LogoutButton`), `page.tsx` (retirado el botón ad-hoc + lógica muerta
  `hasValidSession`/cookies/repo/imports). Backend/middleware/DB/`LogoutButton` (comportamiento) intactos.
- **Reviewer: RECHAZADO en el 1.er ciclo** por trazabilidad — R10/R11 con mapeo *hollow* (sin test que los ejerciera) y R10 exigía
  feedback de error al usuario, pero el botón solo hacía `console.error`. **RESUELTO:** el humano eligió **añadir
  `toast.error("No se pudo cerrar sesión")`** en el `catch` (sistema de toasts, feature 11) + tests dedicados de R10 (camino de
  error: no navega, re-habilita, toast) y R11 (estado pendiente) + trazabilidad corregida y `tasks.md` marcado. R8 (no-back) cubierto
  por el `middleware.ts` existente; NO se endureció `push`→`replace` (el humano pidió "tal cual").
- **Verde:** typecheck 0, eslint 0, `npx vitest run` **2333/2333** (baseline 2331 + 2 tests nuevos), objetivo 19/19. Reviewer re-verificado
  por el leader (diffs leídos, tests reales). Estado `done` + `review_57`. **Un PR `feature/57 → dev`.** PENDIENTE merge (OK humano).
- **REUBICACIÓN (misma feature, 2026-07-13):** al probar en la app, el humano detectó un topbar con "Salir" + campana de notificaciones que NO
  estaba en `origin/dev`. **Diagnóstico:** su `dev` LOCAL estaba en `1dd0c0d` = el PR **#54 "adjustments" REVERTIDO** (que tenía ese topbar en
  `PageHeader.tsx` con `<NotificationsBell/> <LogoutButton/>` "Salir", pero también la **wallet 42/43/44 y trazabilidad 49 ROTAS** — por eso se
  revirtió con el PR #55); `origin/dev` está en `b3ed545`. El humano prefirió el logout en el **topbar del `PageHeader`** (como el #54) en vez del
  sidebar. **Rework:** movido del `SidebarFooter` al `PageHeader` compartido (botón "Salir" + icono `LogOut`, contraste sobre navy; se conservó el
  toast de error y los tests R10/R11 con labels "Salir"/"Saliendo…"); `Sidebar` revertido a `origin/dev`. `PageHeader` es solo-autenticado (16 usos,
  todos bajo `app/(app)/`), así que el logout sale en toda página. Radio de impacto: como el `PageHeader` monta un client-component, 11 tests que
  renderizan páginas stubbean `LogoutButton` para aislar (patrón estándar); `PageHeader.test.tsx` (nuevo) prueba el logout REAL en el topbar. VERDE:
  typecheck 0, eslint 0, **2335/2335**. **Se registró la feature 60** (recuperar la campana `NotificationsBell` del #54 sobre el dev real, sin lo roto;
  depende de la 57, se relaciona con la 35 realtime). **PENDIENTE (humano):** sincronizar `dev` local con `origin/dev` (dejar de correr el #54 stale) + merge del PR #57.

## 2026-07-13 — wallet: gastos fijos/variables y sueldos (feature 45)
- **Último eslabón de la cadena wallet (42→43→44→45): egresos administrativos** que salen de la caja
  principal (42) y restan del balance derivado. Money-critical. Los egresos son filas `tipo=egreso` en
  el libro append-only polimórfico `wallet_movimiento` (42), SIN tabla de egresos nueva. **Gastos
  VARIABLES y SUELDOS = registro manual** (`origen_id` NULL; el sueldo lleva el nombre del trabajador +
  período como texto libre en la descripción; la vía manual rechaza `gasto_fijo`). **Gastos FIJOS = tabla
  nueva `gasto_fijo_plantilla`** (concepto/monto/activa, RLS sin policies, sin borrado —se desactiva—) que
  el maestro administra, y un **cron mensual** `/api/cron/generar-gastos-fijos` (auth `CRON_SECRET` antes
  de efectos, schedule `0 6 1 * *`=día 1 00:00 CR, clon de 41/46) que genera un egreso por plantilla activa,
  **idempotente por período** (`origen_id="<plantillaId>:<YYYY-MM>"` bajo el índice único parcial
  EXISTENTE; reejecutar el mismo mes → 0 filas). Reversa compensatoria append-only idempotente (aplica
  también a egresos del cron). UI `/wallet` (rol maestro): dialog de egreso manual, panel CRUD de
  plantillas, desglose de egresos por tipo y "Reversar" por fila.
- Requisitos cubiertos: **R1–R33** (trazabilidad completa R→test, verificada por el reviewer abriendo los
  tests). Reviewer **APROBADO 0 bloqueantes**. Verde REAL: typecheck 0, lint 0, **2545/2545 tests**,
  `init.sh` OK, round-trip de AMBAS migraciones (`20260713140000_wallet_egreso_gasto_fijo_variable` enum
  aditivo +down; `20260713150000_gasto_fijo_plantilla` tabla +down) contra el Postgres local.
- Decisiones/deuda: **F1.4** — sueldos texto libre (c); **gastos fijos por CRON** (b, el humano eligió la
  opción auto sobre la recomendación manual); resto recomendadas. Enum extendido con `egreso_gasto_fijo`/
  `egreso_gasto_variable` (`egreso_sueldo` ya existía en la 42). Idempotencia por la clave de período bajo
  el índice único parcial ya presente (sin índice nuevo, sin colisión con reversa/manuales). Cambio en
  código compartido auditado sin regresión: blindaje `montoPositivoSchema` con try/catch (monto vacío/no
  numérico → `validation_error` en vez de INTERNAL/500; robustece también el ajuste manual de la 42).
  Orquestada DIRECTO por el leader (`backend_dev → frontend_dev → reviewer`) para evitar el implementer
  monolítico y el bug opus-4.8[1m] (precedente 56). **DEUDA menor**: E2E del flujo de egresos diferido;
  tests de migración/DB estáticos o en memoria (round-trip real verificado a mano). **PR #62 mergeado
  (OK humano)**; tras el merge se sincronizó `dev` local y se reinició el dev server (schema nuevo → cliente Prisma).

## 2026-07-13 — zonas: seleccionar distritos de VARIOS cantones en una zona (feature 59)
- **FRONTEND PURO** (frontend/medium, `sdd:true`). Sin backend, migraciones ni cambios de contrato:
  `crearZona`/`actualizarZona` intactos; `arbolZonas()` usado SOLO como lectura para pre-cargar edición.
  Ciclo SDD completo (spec_author → **F1.4 aprobada (todas las recomendadas)** → frontend_dev → reviewer).
- **Problema:** el `ZonaForm` solo dejaba marcar distritos del cantón/provincia abierto en ese momento;
  cambiar de cantón "perdía de vista" lo ya elegido y no había forma de ver/quitar el conjunto acumulado.
- **Solución:** `selected` migrado de `Record<string,string>` a `Record<string, DistritoSeleccionado>`
  (`{distritoNombre, cantonId, cantonNombre, provinciaId, provinciaNombre}`) como **fuente de verdad única**
  → cambiar de provincia/cantón NO resetea la selección. **Resumen agrupado provincia→cantón**
  (`data-testid="resumen-distritos"`, `role="group"`) con botón **"Quitar"** por distrito
  (`aria-label="Quitar <distrito>"`); **sync bidireccional** resumen↔checkbox (mismo `selected`). Contador
  `data-testid="distritos-seleccionados"` conservado. **R10 heredada:** distritos de otra zona siguen
  `disabled` y nunca entran al conjunto. **Pre-marcado multi-cantón en edición** vía SWR
  `["zonas:arbol", zona.id]` sobre `arbolZonas()` (siembra `selected` para TODOS los cantones/distritos de
  la zona; merge idempotente). Envío intacto: `distritoIds: Object.keys(selected)`.
- Requisitos cubiertos: **R1–R12** (trazabilidad completa R→test en `progress/impl_59-...md`, verificada por
  el reviewer abriendo cada caso). Reviewer **APROBADO 0 bloqueantes de código**; el "RECHAZADO" inicial fue
  SOLO por gates documentales del leader (impl/tasks/history), ya cerrados. Verde REAL: typecheck 0, eslint 0,
  **`zona-form.test.tsx` 22/22** (+6 casos), suite completa **2551 passed** (2 flakes ambientales
  `HomePage`/`LoginForm` que pasan aislados; NO regresión). Solo cambiaron `ZonaForm.tsx` y su test.
- Decisiones/deuda: **F1.4-e** aprobó la ruta recomendada `arbolZonas` → **T9-alt (fallback perezoso) = N/A**.
  Orquestada DIRECTO por el leader (`frontend_dev → reviewer`) por el bug opus-4.8[1m]. **DEUDA menor**
  (reviewer, no bloqueante): numeración "R" mezclada entre features 55 y 59 en algún docstring/test
  (cosmético); sin test del enriquecimiento perezoso de provincia al navegar en edición. **PENDIENTE**: PR a
  `dev` + merge (OK humano). Frontend puro → sin acción de despliegue/migración.

## 2026-07-14 — 63 (Orden lista actualizada) + saneamiento de `dev` (PRs #66/#67/#68/#70)
- **Feature 63** (PR #65 mergeado): endpoint nuevo `listarOrderStatus`, `filter: {[campo]: value}` como
  whitelist estricta en `listarOrdenes` (mapa `FILTER_TO_COLUMN`, sin inyección; compone con el alcance
  por rol), y Tabs de shadcn por estado con **montaje diferido real** (una tab no visitada hace 0 queries;
  `visited.has(id) ? Module : null`, no CSS) y prop `exclude`. Mensajero/adminSatélite fuera del v1.
- Requisitos cubiertos: R1–R20, todos con test (92 tests propios, 6 archivos).
- **Cierre con matiz:** el reviewer la había RECHAZADO por 1 bloqueante — sus commits colaron en
  `ordenes-columns.tsx` cambios FUERA DE ALCANCE (columna `zona`: 14 vs 13; `Estatus`→`Estado`,
  `Flete`→`Flete + IVA`) que regresaron 3 tests VERDES (OrdenesPage D1/D3, AdminTiendaDashboard R11). El
  reviewer ofrecía revertir **o** ratificar con tests actualizados; se tomó la segunda: el PR #64 actualizó
  ambos archivos de test. Verificado antes de cerrar: **15/15 verde**, afirmando las etiquetas nuevas
  (tests actualizados, NO borrados). El typecheck rojo del review era de baseline, saldado por #68/#70.
- **Saneamiento de `dev` (misma sesión).** `dev` estaba ROJO sin que nadie lo supiera: 28 tests y 35
  errores de typecheck. Bisectado: `26b6c19` (PR #63) VERDE → `8706032` (**PR #64 "adjustments"**) ROJO.
  - **#66**: `down.sql` faltante en `20260714123909` (única de 45 sin reversa). Round-trip verificado
    contra Postgres local: down → 5 FKs a RESTRICT + enum con sus 13 valores → migration.sql → estado
    restaurado. El enum era huérfano al borrarse (ninguna columna lo usaba: el ciclo de vida vive como
    FILA en `order_status`), por eso se recrea solo el tipo. No incluye `pendiente` (es posterior).
  - **#67**: **el gate mentía.** `run_if` usaba `A && { B } || C`: un script que fallaba caía en el `||`,
    reportaba "script no definido, se omite" y devolvía 0 → **"init OK" con la suite roja**. Por ahí se
    coló el #64. Ahora: pnpm-ausente / script-no-definido → warn; **script-falló → rojo + exit 1**.
  - **#68**: 4 bugs REALES que los tests rojos cazaban bien. El peor: **`<ZonasModule>` borrado del render
    de `/configuracion`** (import y `zonasData` quedaron como código muerto; ESLint lo avisaba entre 140
    warnings) → el maestro no podía administrar zonas, y como `esCentral` solo se marca ahí, sin él
    `findCentralZonaId()`=null y no se asignan órdenes. También: geografía de ejemplo de vuelta a
    **Ecuador por 3ª vez** (→ San José/San José/Carmen, verificado contra los XLSX reales del seed);
    guarda de catálogo repuesta en `GuiaAsignacionService` (casteaba `as string` sin chequear null); y la
    denylist de `zonas-migration.test.ts` (el #64 apendió 7 migraciones sin extenderla).
  - **#70** (reemplaza al #69, mergeado por error contra la rama base ya consumida): migra los tests de
    tarifas al modelo `tiendaId`/`status`. Solo `tests/`, cero producción. 77→84 tests; ninguno borrado ni
    aflojado ("rechaza zonaId ausente" → "rechaza nombre/zonaId del modelo viejo (strict)", más fuerte).
- Verificación: **suite 2652/2652 VERDE** (294/294 archivos), typecheck **35 → 2**, lint 0 errores.
- Decisiones/deuda: `init.sh` **sigue ROJO con razón** — corta en typecheck por los 2 errores reales de la
  **feature 68** (`TarifaVigentePorZonaRepository` rompería aprobar un cierre; `seed-zonas.ts`). Aparcada a
  propósito por el humano. Features **35/60/62 ANULADAS** (`cancelled` + `status_note`, no borradas).
  Deudas de arnés registradas en `current.md`: `jq` ausente hacía que las reglas 3 y 4 de `init.sh` nunca
  corrieran; denylist frágil en `zonas-migration.test.ts`; fakes de repos triplicados a mano.

## 2026-07-15 — 67 (deshacer gestión: devolver una orden a gestión)
- El mensajero puede devolver una orden a gestión desde las 4 tablas del cierre del día cuando se
  equivocó al gestionarla. La gestión se **anula dejando rastro** (`anulada_at`/`anulada_por`), no se
  borra, y solo mientras no haya solicitado el cierre (`cierre_id IS NULL`).
- Requisitos cubiertos: **R1–R38**, todos con test real (mapa en `progress/impl_67-deshacer-gestion.md`).
- **Alcance recortado en la evaluación, y fue lo más valioso del ciclo.** El pedido tenía dos mitades
  y **la primera ya existía**: la gestión nace con `cierre_id=NULL` (feature 36) y
  `CierreDiaRepository` lista exactamente esas (37/R2-R3), así que las 4 tablas ya se llenaban en
  vivo. Verificado en el código, no supuesto; el humano confirmó que era contexto → la feature fue
  **solo el deshacer**. No se rehízo nada de lo que ya funcionaba.
- **Lo difícil no fue el botón; fueron dos cosas que ningún test existente cubría:**
  1. **Los 3 `WHERE`.** La gestión anulada debe quedar fuera de `findGestionesPendientes:120`,
     **`crearCierre:196`** y `CorteDiario:33`. El segundo es el punto money-critical: su
     `updateMany({where:{mensajeroId, cierreId:null}})` le habría puesto `cierre_id` a una gestión
     deshecha y **la wallet la habría cobrado al aprobar** → la feature habría creado justo el bug
     que viene a evitar. Lo encontró el `spec_author` leyendo el código, no la bitácora.
  2. **El contador de intentos.** El de la feature 47 no es una columna: se **deriva** del historial
     contando transiciones a `devuelta`, y el historial es append-only por diseño (49). Sin resolverlo,
     deshacer una `devuelta` errónea dejaba el intento contando y a los 3 la orden escalaba sola a
     `rechazada`. Se resolvió filtrando **en lectura**, sin tocar el historial, desambiguando por
     `origen_tipo` — porque `gestion_orden_id IS NULL` significa dos cosas ("nunca tuvo gestión" vs
     "se borró y la FK lo vació"). Ante la duda, la huérfana **no** cuenta: contar de menos es
     inofensivo, contar de más cobra mal.
- **Deshacer no es "volver al estado anterior":** una gestión `devuelta` deja la orden en `en_bodega*`
  con `mensajero_asignado_id` limpio (47), o escalada a `rechazada` → hay que reponer la asignación (R19).
- **F1.4-i:** la FK `orden_historial_estado.gestion_orden_id` volvió de `SET NULL` a **`RESTRICT`**,
  completa (modelo + SQL, migración `20260714170000`). Nació de un **error del spec** que el leader
  cazó: afirmaba que el DELETE era imposible por una FK `RESTRICT` cuando la `20260714123909` (PR #66,
  del día anterior) la había dejado en `SET NULL`. La decisión de anular seguía siendo la correcta,
  pero por el diseño append-only, no por una protección inexistente. El predicado del contador sigue
  siendo obligatorio: la FK es defensa en profundidad, no su reemplazo.
- Verificación: **2764 tests / 296 archivos / 0 fallos** · typecheck **2 = baseline exacto** (0 nuevos)
  · lint 0 errores · `migrate diff` sin drift · round-trip REAL de las 2 migraciones contra Postgres
  vivo, repetido por el reviewer en tx con `ROLLBACK` · estado vivo: enum 12, FK `confdeltype='r'`,
  RLS `gestion_orden` true/0 policies. Reviewer **APROBADO 0 bloqueantes de código** (el RECHAZADO
  inicial fue solo por 2 gates documentales del leader, ya cerrados; precedente 59).
- Decisiones/deuda: **HALLAZGO que sube la urgencia de la feature 68** — al correr `pnpm build` por
  primera vez en el cierre, **falla** en `TarifaVigentePorZonaRepository.ts:22`: Next.js typechequea al
  construir, así que **`dev` no compila y nada se despliega**. Cuando se aparcó el bug nadie lo sabía;
  no es runtime dormido, es bloqueo de despliegue. Por lo mismo `./init.sh` corta en typecheck sin
  llegar a los tests → la verificación se hizo con comandos directos y así se reporta, sin apoyarse en
  un gate que hoy no llega. Menores (ninguno gatea el PR): E2E de T21 escrito y no ejecutado (sin
  harness e2e); `db:rollback` no alcanza la 1.ª de las 2 migraciones (limitación preexistente del
  script); `unauthenticated` con mensaje genérico; tests R13/R14/R15 del service algo tautológicos.
  El typo "desha" (única cadena que ve el usuario) sí se corrigió antes del PR.

## 2026-07-19 — 90 (background jobs: infraestructura de cola + `liberar-reprogramadas` a job recurrente)
- **Feature A** de un sistema de background jobs en 3 partes (A infra, **91** geocodificación, **92**
  webhooks/outbox); B y C quedaron explícitamente fuera de alcance. Pedido del humano: *"como podría
  manejar colas… descarta redis, dame el contexto de la otra opción"* → **Redis descartado por él**
  porque exige un worker persistente, es decir infra externa que Vercel no da.
- Requisitos cubiertos: **R1–R27**, todos con test real. PR **#94 → `dev`, mergeado** (commits
  `57c53ea` impl + `9db7256` fix de test heredado + `334a4e4` review).
- **Qué se construyó:** tabla `jobs` genérica (patrón transactional-outbox + worker) drenada por un
  Vercel Cron nuevo `/api/cron/procesar-jobs` **cada minuto** — el único disparador temporal que
  queda. Claim atómico con **`FOR UPDATE SKIP LOCKED`** (**sin precedente en el repo**; el patrón
  `$queryRaw`+`RETURNING` dentro de `$transaction` ya existía en `OrdenRepository`), **visibility
  timeout de 1h** para rescatar jobs muertos por crash, **backoff exponencial** y **dead-letter**.
  Config por env en `lib/config/jobs.ts` (clon de `cron.ts`).
- **Consolidación pedida por el humano:** `liberar-reprogramadas` (feature 46) se **fusiona** a la
  cola como job recurrente que **envuelve `LiberacionReprogramadaService` sin reescribir su lógica**.
  Se re-agenda en éxito **y también en fallo terminal** — si no, un solo fallo terminal detendría el
  job diario para siempre. Su entrada de schedule sale de `vercel.json` y **la ruta se conserva como
  disparo manual** (decisión (4) del gate). Anti-colisión = SKIP LOCKED + `run_after` futuro +
  idempotencia por "día CR".
- **Gate F1.4 — 5 decisiones, todas con la recomendación:** (1) el horario **preserva 00:00 CR**, no
  se mueve a 01:00; (2) `max_intentos` por-fila desde config con override por tipo; (3) payload de
  `liberar_reprogramadas` **derivado de `now`** (payload vacío + `startOfDayCR(now)`), no estampado al
  encolar; (4) la ruta manual se conserva; (5) contrato de conteos fijado
  `{procesados, ok, fallidos, reintentados, muertos}`.
- **El reviewer rechazó la primera vez, con razón, y el fallo era del tipo que este repo ya conoce:**
  el código nuevo estaba sólido, pero un test **heredado de la feature 46**
  (`liberar-reprogramadas-route.test.ts`, bloque *"R8 — schedule del cron"*) seguía afirmando el
  `schedule '0 6 * * *'` que **esta feature acababa de quitar** → `pnpm test` rojo. Es el mismo patrón
  que los PRs #75 y #82: cambiar el comportamiento y dejar atrás el test que lo afirmaba. Acá **se
  cazó antes del merge**. Se corrigió **invirtiendo** el bloque (ahora afirma que el `cron` de
  liberar-reprogramadas es `undefined`, conserva el guard de `corte-diario` y no duplica
  `procesar-jobs`), sin borrar ni aflojar los tests de auth/conteos/error de la ruta manual.
- Verificación: typecheck **0**, lint **0 errores**, **55 tests de la feature verdes** (43 re-medidos
  por el reviewer tras el fix). **Round-trip REAL** de la migración `_jobs_cola` (up/down) hecho en un
  **Postgres 16 desechable en docker — nunca contra la DB dev compartida** (guardrail explícito):
  índices parciales y predicados, RLS `relrowsecurity=t`/0 policies, dedupe, claim (ignora
  pending-futuro y processing-reciente, rescata processing-viejo) y **SKIP LOCKED concurrente
  disjunto**. Reviewer **APROBADO 0 bloqueantes**. Trabajo en worktree aislado `ordenex-f90` desde
  `origin/dev` — nunca sobre `flow`, que arrastra WIP ajeno.
- Deuda declarada: falta el round-trip de la **cadena completa** de migraciones contra Postgres en CI
  (la `jobs_cola` se validó **aislada**). Seguimiento futuro: migrar `corte-diario` y
  `generar-gastos-fijos` al mismo patrón.

<!-- Backfill 2026-07-21 (PR de bookkeeping): las 24 entradas siguientes (features 61, 64, 65, 69,
     72, 73, 75, 76, 77, 78, 81-84, 86-89, 91, 93-97) faltaban en esta bitácora. Reconstruidas desde
     los PRs de GitHub + progress/impl_*/review_* + las descripciones de feature_list.json. Ordenadas
     por fecha de merge. -->

## 2026-07-14 — portal mensajero (feature 61, FULLSTACK)
- Fila de KPIs sobre la lista de `/mis-asignaciones` (feature 36): **pendientes** (órdenes en
  `en_reparto`), **entregadas** (en `entregada`) y **por cobrar** (suma de `orden.monto_cobrar` COD
  de las `en_reparto`, null→0). Componente presentacional `KpisMensajero.tsx` (Card + PriceLabel,
  región aria).
- Aclaración del humano (= gate F1.4): el estado `en_ruta` de la descripción NO existe → se mapeó a
  `en_reparto`; "por cobrar" es COD (`monto_cobrar`), no flete.
- Backend mínimo: `+contarEntregadas(mensajeroId)` (count, sin traer filas) + `kpis` en el resultado
  del service (dentro del `Promise.all` existente, sin latencia serial). Sin migración. Orquestada
  directo por el leader (los subagentes mueren por el bug opus-4.8[1m]).
- Landó vía la rama `adjustments` (PR #64). Deuda ajena preexistente en ese árbol: errores de tsc en
  `Tarifa*`/`IUserRepository` (refactor por-tienda/usuarios-por-rol en curso de otras sesiones).

## 2026-07-15 — pwa - basic (feature 64, FRONTEND)
- PWA básica: `manifest.json`, service worker vanilla (~50 líneas, sin @serwist), meta tags, íconos
  192/512, página offline. Colores del manifest desde `globals.css` (navy/kraft/brand).
- Requisitos T1–T8; reviewer APROBADO 0 bloqueantes (`review_64-pwa-basic.md`). Enfoque manual por
  riesgo de incompatibilidad con Next 16 + Turbopack.
- El PR dedicado #72 quedó **CLOSED** (superado); el código llegó a `dev` en el lote pwa/qr
  (~2026-07-15). Follow-up: el SW se restringió a **producción** (PR #111) para arreglar la recarga
  infinita en dev.

## 2026-07-15 — lectura de QR con cámara (feature 65, FRONTEND)
- Página `/qr` + ítem de menú "QR" (todos los roles): lector con cámara (`QrScanner` sobre
  `html5-qrcode` ya presente por la feature 33) que decodifica una ruta y navega a ella
  (`useQrNavigate`).
- Requisitos T1–T7; reviewer APROBADO 0 bloqueantes (`review_65-lestura-de-qr.md`). 1 archivo nuevo +
  2 modificados. **PR #73**.
- El detalle por-rol de la orden quedó como feature aparte (66, hoy `pending`).

## 2026-07-15 — fix: dev en verde — recibido_origen + columnas del listado (feature 72, FIX ágil)
- Fix ágil (`sdd:false`) que devolvió `dev` a **verde** tras el PR #75. (1) Conteos de
  `ORDER_STATUS_SEED` 13→14 (nuevo valor `recibido_origen`) + tests posicionales/menú/migración, sin
  borrar ni aflojar. (2) **Restauró 5 columnas** del listado (Producto/Dirección/Monto/Fulfillment/
  Comisión+IVA) que el PR #75 había borrado por drift (revert exacto de `8541498`) y **eliminó el
  `console.log('xyz')`** que corría en cada render en producción. (3) Arregló el guard `no-embalaje`
  (ignora `.claude/worktrees`).
- Medido: 18 fallos → 0 reales (2 flakes de timeout pasan en aislado); lint 0. **PR #76**.
- Desbloqueó el T5 de la feature 69. Lección: un baseline citado de la bitácora no es un baseline
  medido.

## 2026-07-16 — cierre_detail: congelar el detalle y la tarifa del cierre (feature 69, FULLSTACK/backend puro)
- Tabla nueva `cierre_detail` de grano (cierre, orden), poblada en la misma tx de `crearCierre`, que
  **congela (snapshot)** los campos money-critical (monto_cobrar, cobra_comision, zona_id, tienda_id,
  tarifa) + los descriptivos; los feeds de wallet pasan a leer el snapshot en vez de datos vivos de
  `orden`.
- Bug money-critical que cerró: editar monto/tarifa entre SOLICITAR y APROBAR descuadraba en silencio
  los totales snapshot contra los movimientos de wallet (append-only).
- **Absorbió la feature 68** (`cancelled`): recableó `TarifaVigentePorZonaRepository` a por-tienda →
  devolvió `pnpm build`/`./init.sh` a **verde** (typecheck 2→0). La regla de selección de tarifa
  (`tarifas.status`) quedó como `TODO:` → feature 70.
- Requisitos R1–R30 / 23 tasks; gate F1.4 con 1 override (g). Round-trip real de ambas migraciones.
  Reviewer APROBADO 0 bloqueantes. **PR #77**.

## 2026-07-16 — causa tipificada de la devolución (feature 73, FULLSTACK)
- Al devolver, el mensajero elige una **causa** (radios: `not_found`/`wrong_number`/`wrong_address`)
  además del motivo libre, que sigue obligatorio. Columna nueva `gestion_orden.causa_devolucion`
  (enum, nullable, sin CHECK), solo en la rama `devuelta`.
- Decisiones (gate F1.4): lista cerrada de 3 sin "Otro"; todas las causas cuentan igual como intento
  (feature 47 intacta); columna de **solo escritura** a propósito → mostrarla/agruparla = feature 74.
- Migración con `down.sql` + round-trip real (una devolución previa sobrevive con causa NULL).
  Primitiva `radio-group` sobre `@base-ui/react` (no Radix). Reviewer APROBADO 0 bloqueantes. **PR #78**.

## 2026-07-16 — evidencia (foto) obligatoria en la devolución (feature 75, FULLSTACK)
- La rama `devuelta` de la gestión suma `evidencia` obligatoria (espejo exacto de `rechazada`): reusa
  `evidenciaSchema` (MIME jpeg/png/webp + tamaño) en cliente y servidor; la foto se sube al bucket de
  evidencias antes de la tx.
- Sin cambios en la feature 47 (intentos/escalado) ni en la causa (73); solo se suma el campo. Tests
  de schema/action/service/UI ampliados a exigir evidencia, sin aflojar.
- Reviewer APROBADO (`review_75-evidencia-devolucion.md`). **PR #79**.

## 2026-07-16 — ranking diario de mensajeros + premios (feature 76, FULLSTACK)
- Página `/ranking`: ranking **diario** = entregas exitosas del día / órdenes asignadas del día (hora
  CR), % con 1 decimal server-side; tabla de premios editable (monto ₡ + descripción) para el top 3.
- Se agregó `orden.asignado_at` (migración aditiva) estampada en CADA asignación/reasignación
  (4 writers + 3 paths de limpieza instrumentados) para el denominador; tabla nueva `premio_ranking`.
- Gate F1.4: maestro edita+ve, mensajero ve solo-lectura; mínimo de muestra configurable (default 1).
  Reviewer APROBADO 0 bloqueantes. **PR #81**. Deuda: round-trip real de las 2 migraciones pendiente
  de verificación en despliegue.

## 2026-07-16 — bloqueo del checkbox del maestro por cierre abierto (feature 77, FULLSTACK/FIX ágil)
- En la lista del maestro, el checkbox de una orden se **deshabilita** si su bodega (central o
  satélite) tiene ≥1 mensajero con cierre **sin resolver** (`solicitado`/`vencido`), por ZONA de la
  orden. `findZonasConMensajeroBloqueado()` (1 query agregada + `distinct`, sin N+1) + bloqueo
  por-orden en la UI.
- Continuaba un WIP del humano que resolvía mal el pedido (flag global) y que **había reintroducido el
  `console.log("xyz")`** (mismo incidente del PR #75) → eliminado. Unifica la regla del backend a ≥1
  (revierte a propósito el relajado de la feature 41).
- Bug latente corregido de paso: `mensajerosFetcher` devolvía una forma incompatible bajo la misma key
  SWR. Reviewer APROBADO 0 bloqueantes. **PR #82**.

## 2026-07-17 — rutas públicas alcanzables sin sesión (feature 78, BACKEND)
- Bug de 1 línea: `middleware.ts` con `PUBLIC_ROUTES=["/login","/api/health"]` dejaba
  `/recuperar-contrasena` y `/postulacion` **inalcanzables sin sesión** (violaba el R22 de la feature
  21). Se añadieron ambas a `PUBLIC_ROUTES` + el **primer test de middleware del repo** (7 casos,
  escritos en rojo primero).
- Decisiones (gate F1.4): se conserva `startsWith`; `/paquete` queda fuera a propósito → feature 79;
  los `console.log` del OTP se quedan (único modo de completar el flujo hoy) → feature 80; sin
  proveedor de correo, solo un `TODO:`.
- Verificado en runtime con curl. Diff de producción: 2 archivos (`middleware.ts` + un comentario).
  Requisitos R1–R7. **PR #85**.

## 2026-07-17 — API keys: generación con usuario dedicado (feature 81, BACKEND)
- Modelo `ApiKey` (keyHash SHA-256 UNIQUE, `usuarioId` 1:1). Generar una key crea un **usuario
  dedicado** (rol nuevo `apiKey` sin permisos, email/cédula sintéticos únicos, contraseña aleatoria e
  ignota); la key se muestra en claro **una sola vez**.
- Gate F1.4: 8 decisiones D1–D8. La key con **SHA-256, no bcrypt** (el spec_author refutó al leader y
  tenía razón: 256 bits sin diccionario, y bcrypt sería ~100ms/request sin lookup por hash); la
  contraseña del usuario sí sigue en bcrypt. `down.sql` recrea el enum (Postgres no soporta DROP VALUE).
- Alcance acotado a "generar + asignar" (consumo = feature 88, UI = feature 82). Round-trip real
  repetido por el reviewer. Reviewer APROBADO 0 bloqueantes. **PR #86**.

## 2026-07-17 — API keys: UI de gestión (feature 82, FULLSTACK)
- Pantalla `Configuración > API` (solo maestro): **generar + listar** API keys (identificador,
  `key_prefix` en claro, usuario dedicado, fecha). Backend nuevo `listarApiKeys` (la 81 solo tenía
  `generar`). Reusa DataTable/Pagination/Modal/Toast/manejador de errores.
- El secreto/hash nunca cruza al cliente (por construcción); modal del secreto con checkbox "Ya guardé
  la clave" obligatorio, no dismissible.
- Reescribió la guardia de irrecuperabilidad de R19 de la 81 (la vieja estaba rota) → verificada por
  mutación por el reviewer. Apilada sobre la 81. Reviewer APROBADO 0 bloqueantes. **PR #87**.

## 2026-07-17 — /novedades: órdenes devueltas por tienda con contacto (feature 87, FULLSTACK)
- Página `/novedades` (solo adminTienda): lista las órdenes en estatus `devuelta` de la tienda del
  actor con su causa de devolución vigente, paginada, con botones de contacto (llamar/WhatsApp).
- Refactor: botones de contacto extraídos a `components/shared/ContactoButtons.tsx` con normalización
  E.164 CR (+506) + **arregla el bug heredado de `wa.me` sin código de país**; `GestionarOrdenPanel`
  deja de duplicarlos inline.
- Sin migración (la causa existe desde la 73). Backend con `findCausasDevueltaVigentes` en una consulta
  agregada (sin N+1). Requisitos R1–R22. Reviewer APROBADO 0 bloqueantes. **PR #89**.

## 2026-07-17 — /novedades incluye las devoluciones del mensajero (feature 89, BACKEND)
- Corrige que las devoluciones del mensajero no aparecían en `/novedades`: la feature 47 re-transiciona
  la orden fuera de `devuelta` en la misma tx, así que filtrar por estatus actual daba lista vacía. Se
  re-ancló el filtro a la **gestión devuelta vigente** (`resultado='devuelta' AND anulada_at IS NULL`)
  + orden **no cerrada** (excluye `entregada`/`devuelta_origen`/`recibido_origen`).
- Predicado central `novedadWhere` compartido por `count` y `find` (una orden con varios intentos
  figura una sola vez). Encogió a backend puro (la causa ya se renderiza desde la 73; sin campo motivo
  nuevo).
- Requisitos R1–R13. Reviewer APROBADO 0 bloqueantes (`review_89.md`). **PR #93**.

## 2026-07-20 — wallet: ítem de sidebar del maestro + periodicidad de gastos fijos (features 83 y 84)
- **83 (frontend):** ítem "Wallet" en el sidebar (solo maestro) con hijos Caja principal/Tiendas/
  Mensajeros (las 3 páginas ya eran solo-maestro server-side; antes solo se alcanzaban tecleando la
  URL).
- **84 (backend):** periodicidad de `GastoFijoPlantilla` modelada como unidad+cantidad+fecha_cobro
  (enum `PeriodicidadUnidad{dias,semanas,meses}`) → cubre diaria/semanal/quincenal/mensual y cualquier
  ciclo. Módulo puro `lib/utils/periodicidad.ts` (con clamping de fin de mes); cron a **diario**
  filtrando por `aplicaHoy`; idempotencia por periodo derivado; migración aditiva con backfill a
  meses/1 (comportamiento pre-84 preservado).
- La regla "un variable no puede ser periódico" ya se cumplía por construcción (solo las plantillas son
  periódicas) → se afirma y testea como regresión. Implementadas directo por el leader a pedido del
  humano (sin gate SDD). **PR #90**. Deuda: round-trip real de la migración pendiente (requiere
  `DATABASE_URL`). El frontend de la periodicidad quedó como feature 85 (`pending`).

## 2026-07-20 — landing pública en / + dashboard a /dashboard (feature 86, FRONTEND)
- Nueva `app/page.tsx` pública (topbar: logo + "Trabaja con nosotros"→`/postulacion` + "Ingreso"→
  `/login`; hero mínimo, colores existentes). El dashboard se movió a `app/(app)/dashboard/page.tsx`
  (`git mv`, cuerpo intacto, ramificación por rol conservada).
- Punto duro: `/` se hizo pública por **match exacto** en `middleware.ts` (nunca en la lista
  `startsWith`, que haría pública toda la app); con sesión, `/` redirige a `/dashboard`. Los 3
  redirects internos pasaron a `/dashboard`.
- Wordmark extraído a `components/shared/Logo.tsx`. Sin marketing inventado (regla 6). Requisitos
  R1–R16 mapeados a test. Reviewer APROBADO 0 bloqueantes. **PR #88**.

## 2026-07-20 — carga de órdenes por API key (feature 88, BACKEND — es la 81a)
- Consumo de la API key: auth por `Authorization: Bearer ordx_...` (hash SHA-256 + `findByKeyHash`) →
  endpoint nuevo que reusa `BulkOrdenService` con estado inicial `en_ruta_bodega_principal`, **guía
  directa** desde la secuencia existente (excepción al diferido de la feature 17), y respuesta que
  retorna cada orden con su `num_guia`.
- Valida key válida + usuario dedicado `activo` (palanca de revocación) + valor (hereda la regla de la
  carga masiva). Nuevo valor de enum `carga_api` (migración con `down.sql` que recrea el tipo).
- Choke-point de historial de estados (49) → 13 puntos; guía sin duplicar (`nextval` con guarda
  `IS NULL`). Round-trip real. Reviewer APROBADO 0 bloqueantes. **PR #92**. Completa la cadena API keys
  (generar 81 + UI 82 + consumo 88).

## 2026-07-20 — geocodificación de direcciones vía cola de jobs (feature 91, BACKEND)
- Feature B del sistema de background jobs (consume la cola de la 90): geocodifica direcciones contra
  **Google Geocoding API** y escribe lat/lng en `orden`. Columnas nuevas (latitud/longitud/geocoded_at/
  precision/status) + tabla `geocode_cache` por hash de dirección normalizada. Enum `JobTipo` gana
  `geocodificacion` (ALTER TYPE; `down.sql` recrea el tipo).
- **Primer cliente HTTP saliente server-side** del repo (`lib/clients/google-geocode.ts`, fetch
  inyectable). Disparadores = los 2 writers reales de dirección (el spec_author cazó que `update()` no
  puede cambiarla), encolando dentro de la misma tx (transactional outbox). Sin backfill histórico. Sin
  `GOOGLE_MAPS_API_KEY` el handler degrada sin tumbar el drenado.
- Requisitos R1–R34; gate F1.4 (9 decisiones). 2 bugs cazados por tests y verificados por mutación
  (TypeError en la construcción de la query; fuga de dirección en claro al cache). Round-trip real en
  Postgres desechable. Reviewer APROBADO 0 bloqueantes. **PR #96**.

## 2026-07-20 — dashboard: ítem "Inicio" en el sidebar (feature 93, FRONTEND)
- Ítem "Inicio" en el sidebar que enlaza a `/dashboard` (ya existente por la feature 86), visible solo
  para maestro y admin.
- Fix ágil (`sdd:false`). Landó junto a la rama de dashboard-sidebar (renumerada 92→93 por colisión de
  ids). **PR #103**.

## 2026-07-21 — admin con paridad de maestro (feature 94, FULLSTACK)
- El rol **admin** obtiene el mismo acceso (ver y manipular) que el maestro en los módulos Órdenes,
  Cierres del día, Ranking y Wallet.
- Trazabilidad en `impl_94.md`. **PR #107**.

## 2026-07-21 — etiquetas tras generar guía / asignar mensajero (feature 95, FRONTEND)
- Tras generar la guía y asignar mensajero, se encadena la vista previa + descarga (PDF) de las
  etiquetas de esas guías, reusando el modal de etiquetas existente. Para maestro y admin.
- Fix ágil (`sdd:false`). **PR #108**.

## 2026-07-21 — recoger guía por input de número (feature 96, FRONTEND)
- En el portal del mensajero, los botones de recoger se reemplazan por un input de número de guía;
  recoger queda disponible solo por ese input o por escaneo de cámara, validando que la guía esté
  asignada.
- Fix ágil (`sdd:false`). **PR #109**.

## 2026-07-21 — optimización de ruta - frontend (feature 97, FULLSTACK)
- Mitad frontend de la spec 92 (backend en PR #98): mapa Leaflet + OpenStreetMap con las paradas
  numeradas en orden de secuencia + la ruta dibujada (R28), aviso de ruta desactualizada (R30), botón
  sincronizar con GPS best-effort y anti-doble-click (R25/R31/R32/R34), y mensajes de conflicto de
  geocodificación en asignación (R9). Backend chico: `MiAsignacionDTO` expone lat/lng (feature 91).
- Leaflet cargado con `next/dynamic` `ssr:false`. `pnpm build` exit 0. **PR #110**, **desplegada a
  prod (PR #117)**.

## 2026-07-21 — devolución diferida + cron SLA de novedades (feature 99, BACKEND, money-critical)
- Motor del nuevo flujo de devolución. La orden devuelta ya NO se re-rutea de inmediato (feature
  47): cuenta como intento y QUEDA en `devuelta` (entra a /novedades). Un cron horario
  (`/api/cron/procesar-devueltas-sla`, `0 * * * *`, auth `CRON_SECRET`) procesa las vencidas sin
  resolver: not_found 24h con intentos<3 → libera a la bodega dueña (`en_bodega`/
  `en_bodega_satelite` por zona, sin mensajero); not_found 3er intento tras 24h → `rechazada`;
  wrong_number/wrong_address al día 6 → `rechazada`. Ventanas rolling en hora CR, ancladas a la
  última gestión `devuelta` vigente (SIN columna `devuelta_at`).
- Requisitos R1–R30 (mapa R→test en `progress/impl_99.md`). Migración: SOLO ALTER del enum
  `orden_historial_origen_tipo` (+`liberacion_devuelta_sla`/`escalado_devuelta_sla`) con `down.sql`
  que recrea el tipo; round-trip real verificado en DB desechable.
- **DINERO (Option A, gate F1.4-Q1):** al escalar, el cron crea una gestión SINTÉTICA
  `resultado=rechazada` (actor sistema, `cierre_id null`, mensajero de la última devuelta) en la
  misma tx → el snapshot de la 56 y la wallet 42/69 cobran el ingreso de bodega SIN código
  monetario nuevo. De paso cierra un hueco preexistente de la 47 (los escalados no generaban
  ingreso: `ingreso-bodega.ts:23` da 0.00 para `resultado !== rechazada`). Verificado POR MUTACIÓN
  por el reviewer.
- Reconcilia la 47 (relocaliza `resolverSeguimientoDevuelta` al cron; tests INVERTIDOS al sentido
  nuevo, no aflojados) y /novedades 89 (predicado ancla a `estatus = devuelta`; tests invertidos).
  Todas las transiciones por el choke point `appendCambioEstado` (49); los 2 `origen_tipo` nuevos NO
  cuentan como intento (destino ≠ `devuelta`).
- Gate F1.4 aprobado por el humano (las 8 recomendadas + confirmación Q1). Ciclo SDD directo del
  leader (spec_author → backend_dev → reviewer, `model:opus`). **Reviewer APROBADO 0 bloqueantes.**
  Medido (implementer + reviewer + leader, independiente): typecheck 0, lint 0, **3950/3950 tests**,
  round-trip real. Base de 100/101/102. **DEUDA ajena:** `./init.sh` rojo por bug preexistente del
  harness (`login` sin `specs/login/`), medido idéntico en HEAD limpio — no es de esta feature.

## 2026-07-22 — resolver la novedad: reprogramar (tienda) / recuperar a bodega (feature 100, FULLSTACK)
- Dos acciones MANUALES que RESUELVEN una novedad y sacan la orden de `devuelta` antes de que venza
  su ventana SLA (la feature 99 la salta, porque su cron solo actúa sobre las que siguen en
  `devuelta`). (1) **Reprogramar** (adminTienda, en `/novedades`): tras contactar al cliente,
  reprograma a la fecha que pida; gestión sintética `resultado=reprogramada` + `fecha_reprogramacion`
  (`origen_tipo=reprogramacion_tienda`) que reusa INTACTO el bloqueo/liberación de la 46. (2)
  **Recuperar a bodega** (bodega dueña: maestro/admin en `/ordenes`, adminSatelite en
  `/recepcion-satelite`): pasa la orden a `en_bodega`/`en_bodega_satelite` por zona, sin mensajero,
  para un nuevo intento (`origen_tipo=recuperacion_manual`, actor=admin).
- Requisitos R1–R24 (mapa R→test en `progress/impl_100.md`). Migración: solo ALTER del enum
  `orden_historial_origen_tipo` (+`reprogramacion_tienda`/`recuperacion_manual`) con `down.sql`;
  round-trip real verificado por el reviewer (up→down→up). Grupo nuevo `devueltas` en
  `RecepcionSateliteService.listar` (patrón del `porDevolver` de la 48).
- Gate F1.4 aprobado por el humano (las 5 recomendadas + bonus): Q1 reprogramar money-neutral y sin
  contar intento; Q2 recuperar limpia mensajero; Q3 authz server-side (tienda dueña /
  `esBodegaResponsable`); Q4 sin abrir `/novedades` a la bodega; Q5 sin carrera con el cron 99
  (UPDATE guardado por `estatus_id=devuelta`, `if count>0`). **Bonus:** NO enciende `orden.prioridad`
  (es la feature 101).
- Ciclo SDD directo del leader (spec_author → backend_dev ×2 → frontend_dev → reviewer). **Reviewer
  APROBADO de código** (RECHAZADO inicial SOLO por `impl_100.md` ausente, ya escrito; sin cambios de
  código; money-neutralidad y authz verificadas de forma adversarial, sin fuga de `prioridad`).
  Medido: typecheck 0, lint 0, **4039/4039 tests**, round-trip real. Base para 101 (prioridad) y 102
  (dinero en cierres). `./init.sh` rojo solo por la deuda ajena preexistente del harness (`login`).

## 2026-07-22 — prioridad de reasignación de las órdenes liberadas por SLA (feature 101, FULLSTACK)
- Nueva columna `orden.prioridad` (bool, default false). El cron SLA de la feature 99 la **enciende**
  al liberar una devolución vencida `not_found` a la bodega (`DevolucionSlaRepository.liberarDevueltaSla`),
  y se **apaga** al reasignar mensajero desde la bodega dueña (`asignarBodegaLote` central /
  `asignarSateliteLote` satélite). Los listados de reasignación de la bodega dueña ordenan
  `prioridad DESC` primero y el frontend **resalta la fila** (fondo `bg-warning/15` + badge accesible
  "Prioritaria") en el apartado `en_bodega` de `/ordenes` (maestro/admin) y el grupo "Recibidas" de
  `/recepcion-satelite` (adminSatelite).
- Requisitos R1–R12 (mapa R→test en `progress/impl_101-prioridad-reasignacion.md`). Migración aditiva
  (`ADD COLUMN` NOT NULL DEFAULT false) con `down.sql` (DROP COLUMN); round-trip real verificado por el
  reviewer. El escalado y la recuperación manual (100) NO encienden prioridad (R3, test negativo).
  Sin backfill (R11). El resalte NO se filtra a /novedades ni "Devueltas" (R10, test). Helper compartido
  `components/shared/PrioridadResalte.tsx`; `DataTable` gana la prop opcional retrocompatible `rowClassName`.
- Gate F1.4 aprobado por el humano (las 5 recomendadas + prop `rowClassName`). Ciclo directo del leader
  (spec_author → backend_dev → frontend_dev → reviewer). El `frontend_dev` cayó por límite de sesión a
  mitad de tarea; el leader retomó y cerró el frontend restante (test R10 de no-fuga, helper aislado,
  test de migración). **Reviewer APROBADO de código** (RECHAZADO inicial solo por artefactos de
  trazabilidad, ya cerrados; sin cambios de código de dominio). Medido: typecheck 0, lint 0,
  **4050/4050 tests**, round-trip real. `./init.sh` rojo solo por la deuda ajena preexistente del
  harness. Base de la feature 102 (dinero de estos rechazos visible en cierres — pendiente, para mañana).

## 2026-07-22 — 109 orden sin gestionar (cierre vencido + reasignación prioritaria)
- Al corte diario (41), TODA orden aún en `en_reparto` → nuevo estatus `sin_gestionar` + cierre
  `vencido` money-neutral que bloquea al mensajero; las órdenes quedan CONGELADAS hasta que se
  APRUEBE el cierre, ahí se liberan a bodega por zona (`en_bodega`/`en_bodega_satelite`, sin
  mensajero) con `prioridad=true` (101/110). Todas las transiciones por `appendCambioEstado` (49).
- **Modelo del cierre revisado (system-wide, 38/111):** solo `aprobado` es TERMINAL;
  `solicitado`/`vencido`/`rechazado` son abiertos=BLOQUEANTES. Rechazar deja `rechazado` (conserva
  motivo/auditoría) pero ahora BLOQUEA y es RE-SOLICITABLE (`rechazado→solicitado`, espejo del
  `vencido`); el conjunto bloqueante pasa a `{solicitado,vencido,rechazado}` en el bloqueo derivado,
  el SQL anti-TOCTOU de asignación y la exclusión del corte. Invariante: nunca 2 cierres abiertos.
- Requisitos cubiertos: **R1–R31**. Migraciones aditivas + `down.sql`: `order_status` `sin_gestionar`
  (es TABLA → `INSERT WHERE NOT EXISTS`) y 2 `origen_tipo` (`corte_sin_gestionar`,
  `liberacion_sin_gestionar`). SIN migración del enum `CierreEstado`.
- Gate F1.4 + re-gate cerrados por el humano (3 iteraciones del modelo de rechazo hasta "rechazado
  bloqueante + re-solicitable, GLOBAL"). typecheck 0, lint 0 err (143 warn baseline), **suite
  4522/4522**. Reviewer APROBADO (0 bloqueantes). **PR #141 → dev, merge humano 2026-07-22.**
- **Deuda/decisiones:** (1) los subagentes cayeron por errores de API repetidos (backend ~8,
  frontend 1, reviewer 4); el leader remató backend/review/verificación a mano (detalle en
  `impl_109.md`/`review_109.md`). (2) El ripple de los tests-DOWN de enum (67/99/100/106) se saldó
  agregando los 2 valores nuevos a sus SETS DE EXCLUSIÓN, sin tocar ningún `down.sql` (patrón frágil
  vivo, como la allow-list de `zonas-migration`). (3) Follow-up no bloqueante: aserción explícita de
  R13 (aprobar `vencido` money-neutral → 0 wallet), hoy garantizado por construcción. (4) Despliegue:
  `prisma migrate deploy` en destino (2 migraciones).

## 2026-07-23 — 118 corrección SIMPE → SINPE (medio de pago CR)
- Rename del VALOR del enum Postgres/Prisma `metodo_pago_value` `SIMPE`→`SINPE` (typo introducido en la
  feature 36), **reversible**: migración nueva `ALTER TYPE ... RENAME VALUE 'SIMPE' TO 'SINPE'` +
  `down.sql` inverso (preserva filas, no reescribe; migración histórica intacta).
- Alcance real ~27 archivos (8 fuentes + 12 tests + migración up/down + test de rename + guard de
  censo). Identificadores internos NO tocados por regla explícita (`total_simpe`/`totalSimpe`/clave
  DTO interna `simpe`). El ripple del test frágil `zonas-migration` se saldó excluyendo la migración
  nueva (patrón conocido).
- R1–R12 trazados a tests. Guard de censo case-sensitive de `SIMPE` como test Vitest. typecheck 0,
  lint 0, **4528/4528 tests**. Reviewer APROBADO (0 bloqueantes). **PR #145 → dev, merge humano
  2026-07-23.** Despliegue: `prisma migrate deploy`.
- Contexto: nació en el lote mensajero registrado como 112–118 y **renumerado a 113–119** por colisión
  del ID 112 con `webhook-payload` (PR #144, de otra sesión); esta feature quedó como **118**.

## 2026-07-23 — 115 mensajero: marcar orden para "gestionar más tarde"
- Marca privada por `(mensajero, orden)`, **solo informativa** (badge + orden visual); no cambia
  estado/ruta/prioridad ni escribe en el historial. Tabla nueva
  `orden_mensajero_meta(usuario_id, orden_id, marcar_luego bool default false, nota text NULL,
  UNIQUE(usuario_id, orden_id))` con RLS habilitada sin policies + 2 FK `ON DELETE CASCADE` +
  `down.sql`. La columna `nota` **nace aquí** para la feature 116 (que NO crea migración).
- Server Action `marcarGestionarLuego` con authz por mensajero (`usuario_id` SIEMPRE del actor; valida
  propiedad de la orden; idempotente por el UNIQUE). `marcarLuego` en `MiAsignacionDTO` (opcional en el
  tipo, siempre emitido). UI: badge + toggle en la card + `sort` estable que hunde las marcadas al final
  sin mutar la ruta persistida.
- R1–R20 trazados a tests. typecheck 0, lint 0, **4568/4568** (4574 tras sync con dev). Reviewer
  APROBADO (0 bloqueantes). **PR #146 → dev, merge humano 2026-07-23.** Sync trivial con 118
  (`schema.prisma` auto-merge SINPE+modelo; `zonas-migration` unión de exclusiones). Despliegue:
  `prisma migrate deploy`. Base de la feature 116 (notas privadas, reusa esta tabla).

## 2026-07-23 — 113 mensajero: card con detalle inline + modo foco al gestionar
- Cambio de PRESENTACIÓN en `MisAsignacionesModule.tsx` (sin backend/contratos; el bloqueo 1-a-1 no
  cambia). Cada card de "En reparto" muestra `AsignacionDetalle` inline (Pedido/Entrega/Cobro); se
  ELIMINA el ocultamiento "Termina la gestión en curso" → la restricción por gestión activa vuelve a ser
  de ACCIÓN, no de visibilidad.
- **Modo foco** derivado de `ordenEnGestionId` (sin estado nuevo): colapsa a solo `GestionarOrdenPanel`,
  oculta cards/mapa/"Por recoger"; se restaura al liberar el puntero. Preserva intactos el badge/toggle/
  sort de la feature 115.
- R1–R12 trazados a tests. typecheck 0, lint 0, **4586/4586**. Reviewer APROBADO (rechazo inicial solo por
  `tasks.md` sin marcar `[x]`, remediado; sin cambios de código). **PR #147 → dev, merge humano 2026-07-23.**

## 2026-07-23 — 119 evidencias de gestión: de 1 a 1..N fotos (máx 3)
- La evidencia de gestión pasa de 1 foto a **1..3** (entregada/rechazada/devuelta). Tabla nueva
  `gestion_orden_evidencia` 1:N (FK `gestion_id` CASCADE, `@@unique(gestion_id, indice)`, RLS sin
  policies) + migración/`down.sql` + **backfill** (portada existente → fila `indice 0`, `content_type`
  fallback `image/jpeg`).
- **Expand/contract:** se conservan `gestion_orden.evidencia_storage_path/_content_type` como PORTADA
  (índice 0) vía dual-write en la misma tx, para NO romper los consumidores de lectura (cierres 37/38/40,
  API 106, que siguen viendo la portada). Repuntarlos a N fotos = follow-up fuera de alcance.
- **Atomicidad storage↔DB con compensación:** subida secuencial acumulando lo subido; **rollback total**
  (`storage.remove` + nada en DB) ante fallo de subida (R10) o de la transacción (R11). Contrato
  `evidencias: EvidenciaArchivo[]`, `evidenciasSchema` min 1 / max 3, `evidenciaUrls` firmadas; el puente
  temporal `foldEvidenciaSingular` fue retirado. UI: `GestionarOrdenPanel` multi-select + previews (con
  revoke) + quitar + tope 3 + bloqueo de envío.
- R1–R17 trazados a tests. typecheck 0, lint 0, **4644/4644** (tras sync con 113). Reviewer APROBADO.
  **PR #148 → dev, merge humano 2026-07-23.** Despliegue: `prisma migrate deploy` (tabla + backfill); env
  opcional `GESTION_MAX_EVIDENCIAS` (default 3); bucket `gestion-evidencias`.

## 2026-07-23 — 114 mensajero: buscador de guías asignadas
- Input de búsqueda **100% cliente** en `MisAsignacionesModule` (sin backend): filtra ambos grupos por
  numGuía/numRemisión/destinatario, match parcial insensible a mayúsculas/acentos (reusa `normalizeName`);
  query vacío → sin filtrar; mensaje "sin resultados" por grupo.
- **Decisión del gate F1.4:** el mapa de ruta y el panel de detalle reflejan el conjunto FILTRADO
  (coherencia lista↔mapa), con salvaguarda de que la orden en gestión (`ordenEnGestionId`) nunca se oculta.
  Integra sobre 113 (foco/detalle) y 115 (badge/toggle/sort), preservados; el buscador solo aplica en la
  vista de lista.
- R1–R9 trazados a tests. typecheck 0, lint 0, **4657/4657**. Reviewer APROBADO. **PR #150 → dev, merge
  humano 2026-07-23.** El `frontend_dev` cayó por un error de API a mitad; el leader lo reanudó y remató
  (tests + push). Sin migraciones ni env nuevas.

## 2026-07-23 — 116 mensajero: notas privadas por orden
- Nota de texto libre **privada del mensajero** por orden, distinta de `orden.notas` (nota de la tienda).
  **SIN migración:** reutiliza la tabla `orden_mensajero_meta` y su columna `nota` de la feature 115.
- Server Actions `guardarNotaPrivada`/`limpiarNotaPrivada` con authz por mensajero (`usuario_id` SIEMPRE del
  actor); `upsertNota` PRESERVA `marcar_luego`; `limpiar` = `nota=NULL` idempotente sin borrar la fila;
  guardar en blanco → limpiar (R5); orden inexistente/ajena → `forbidden` sin excepción cruda. `notaPrivada`
  en `MiAsignacionDTO` solo del propio actor, vía el `Promise.all` de 115 (sin N+1).
- UI: editor "Mi nota" en el detalle (separado y etiquetado distinto de "Notas" de tienda) + indicador en la
  card. Preserva 113/114/115. `orden.notas` nunca se toca (R7).
- R1–R17 trazados a tests. typecheck 0, lint 0, **4779/4779**. Reviewer APROBADO. **PR #152 → dev, merge
  humano 2026-07-23.** El backend cayó por un error de API a mitad; el leader lo reanudó y remató. Sin
  migraciones ni env nuevas.

## 2026-07-23 — 117 mensajero: filtro por cantón y distrito
- Filtro **100% cliente** por Cantón y Distrito en `MisAsignacionesModule` (sin backend). Dos `Select`
  encadenados (distrito `disabled` sin cantón; cambiar de cantón resetea distrito; opción "todos" /
  "Limpiar filtros"); opciones de cantón derivadas del conjunto COMPLETO.
- **Decisión del gate F1.4:** etiqueta **"Cantón (Provincia)"** (dedup cantón+provincia); el mapa y el panel
  reflejan el conjunto FILTRADO (R14) con salvaguarda de la orden en gestión (R10). Se **compone en AND** con
  el buscador de la feature 114 sobre las mismas listas visibles.
- Preserva 113/114/115/116. R1–R14 trazados a tests. typecheck 0, lint 0, **4804/4804**. Reviewer APROBADO.
  **PR #153 → dev, merge humano 2026-07-23.** Cierra el lote mensajero 113–119. Sin migraciones ni env nuevas.

## 2026-07-24 — 137 unificar nomenclatura de order_status (rename, opción A del gate)
- Rename reversible del `value` de 6 estatus para unificar backend↔frontend↔contrato externo:
  `en_reparto→en_ruta`, `en_espera_aceptacion→por_recoger`, `en_bodega→en_bodega_central`,
  `en_ruta_bodega_principal→en_ruta_bodega_central`, `devuelta_origen→devolviendo_a_tienda`,
  `recibido_origen→devuelta_a_tienda`. Migración por `UPDATE order_status.value` (+down.sql), tupla fuente
  de verdad `ORDER_STATUS_SEED`, etiquetas R8 (= value legible directo), contrato externo API/webhook
  (breaking R9), barrido de ~180 archivos guardado por censo case-sensitive (R13). NO cambia
  `orden.estatus_id` (FK por id).
- Requisitos R1–R13 trazados a tests (`progress/impl_137-order-status-rename-nomenclatura.md`). Reviewer
  APROBADO-CON-NOTAS, 0 bloqueantes. typecheck 0, lint 0, suite verde.
- Renumerada 135→137 por colisión de IDs (dev reclamó 135=analítica, 136=etiquetas vía #155 flow); la rama
  conserva el slug `feature/135-...` (pusheada), patrón 103/104/105. **PR #157 → dev, merge humano 2026-07-24.**
- DEUDA: la migración NO se aplicó contra DB real (entorno sin `.env`; R2/R3/R4 por test estático +
  round-trip en memoria). **Al desplegar: `prisma migrate deploy` + verificar `down.sql` con `db:rollback`,
  coordinado con el deploy** (rename de valores: código y DB deben coincidir). Fundacional del lote 137–140.

## 2026-07-24 — 138 recepción en bodega central
- Cierra el dead-end de `en_ruta_bodega_central` (órdenes de carga API sin salida): recepción por QR / entrada
  manual (maestro/admin, global sin zona/tienda) → `en_bodega_central` + historial. Migración aditiva
  `ADD VALUE 'recepcion_bodega_central'` al enum `OrdenHistorialOrigenTipo` (+down.sql patrón `carga_api`).
  Backend espejo de `RecepcionOrigen` (repo `recibirEnBodegaCentral` guardado por estado de origen; service
  `esAccesoTotal`); escáner en el header de `/ordenes` (gate maestro/admin).
- R1–R18 trazados a tests. Reviewer APROBADO-CON-NOTAS, 0 bloqueantes. `./init.sh` verde (503 archivos /
  4979 tests). Renumerada 136→138. **PR #159 → dev, merge humano 2026-07-24.**
- DEUDA: migración aditiva NO aplicada contra DB real (post-merge: `prisma migrate deploy` + verificar
  `down.sql` con `db:rollback`; bajo riesgo por ser `ADD VALUE`).

## 2026-07-25 — 139 flujo de devolución de rechazadas (estados + transiciones + UI)
- Cierra el retorno físico de las `rechazada`: 3 estados nuevos al catálogo (`por_devolver`,
  `devolviendo_a_bodega_central`, `por_devolver_a_tienda`, índices 16/17/18 sin alterar posiciones
  previas) + `ADD VALUE 'devolucion_rechazada'` al enum de historial (ambas con `down.sql`).
- Recorrido: al APROBAR el cierre, cada `rechazada` del mensajero rutea por zona de la orden
  (`resolverDestinoCierre`) → satélite `por_devolver` / central `por_devolver_a_tienda` (atómico con
  el cierre, money-neutral, idempotente); `por_devolver → devolviendo_a_bodega_central` (adminSatélite,
  por lote); `devolviendo_a_bodega_central → por_devolver_a_tienda` (recepción central **state-aware**,
  extiende el escáner de la 138 a un solo escáner que resuelve destino por estado de origen);
  `por_devolver_a_tienda → devolviendo_a_tienda` (maestro/admin) → `devuelta_a_tienda` (tienda, flujo
  existente). **R9: se RETIRA la arista manual directa `rechazada → devolviendo_a_tienda`** en las 3
  superficies de UI — la única salida de `rechazada` pasa a ser la aprobación del cierre.
- R1–R24 trazados a tests (`progress/impl_139-...md`). Reviewer APROBADO-CON-NOTAS, 0 bloqueantes;
  typecheck 0, lint 0, 271 tests dirigidos verdes; `./init.sh` verde (508 archivos / 5012 tests).
  Renumerada 137→139. **PR #160 → dev, mergeado 2026-07-25.**
- DEUDAS: ~~T4.1 (test de integración del recorrido completo)~~ **SALDADA 2026-07-25** en
  `chore/cierre-lote-137-140`: `tests/integration/db/devolucion-rechazadas-flow.test.ts` (9 tests)
  encadena services y repos reales por las dos ramas del mismo cierre y verifica el historial exacto
  por salto; la guardia de la 140 no reveló ningún hueco (los 5 pares son legales); migraciones no
  aplicadas contra DB real (post-merge `prisma migrate deploy` + `db:rollback`); R22 en los envíos por
  lote usa `update` guardado solo por `{id, deletedAt}` con pre-check en el service (desviación
  prescrita por el design §4.1/§4.4, precedente feature 48) → endurecer a `updateMany WHERE
  estatus_id = origen` en el futuro.

## 2026-07-25 — 140 guardia central de transiciones de `order_status` (cierra el lote 137–140)
- Salda la deuda de fondo del lote: **no existía máquina de estados**. Cada service declaraba sus
  orígenes/destinos y la única guardia real era el `WHERE estatus_id = <origen>` de cada UPDATE; el
  choke point `appendCambioEstado` (feature 49, ~18 call-sites) registraba historial + encolaba webhook
  **sin validar legalidad**. Ahora el mapa vive en `lib/types/order-status-transiciones.ts` y se valida
  en el choke point, cubriendo los ~18 call-sites de una vez.
- **43 aristas de flujo → 39 pares dirigidos únicos + 3 de creación**, 22/22 familias `origen_tipo`,
  conectividad 18/18 (sin callejones sin salida ni estados inalcanzables). Exhaustividad estática por
  `satisfies`: el build rompe si el catálogo gana un value sin clasificar. **Sin migraciones, sin
  `down.sql`, sin RLS, sin endpoints nuevos** (dominio puro + choke point).
- **Gate F1.4, 4 decisiones:** todo pasa por la guardia (sin override `ANY→ANY` ni para maestro/admin
  → rescatar una orden atascada exige declarar la arista y desplegar); activación **estricta desde el
  día 1** (sin shadow/flag/env); se valida también la creación `null→X` contra `ESTADOS_CREACION`;
  `throw` tipado sin PII con la firma intacta para los call-sites. Q1/Q2/Q4 se cerraron **contra el
  código** al aterrizar 138/139 (`en_ruta_bodega_central` dejó de ser vestigial → allowlist vacía; el
  catálogo pasó a 18 values). `rechazada → devolviendo_a_tienda` NO se declara: la 139 la retiró (R9).
- **El reviewer RECHAZÓ la 1.ª entrega:** la guardia **fallaba abierta** — un `value` presente en la DB
  pero ausente del `ORDER_STATUS_SEED` del build pasaba sin validar (drift DB↔código, justo donde la
  guardia hace falta), y quedaba OFF en las ~25 suites que modelan los call-sites reales, con un test
  que consagraba el fail-open como contrato. Corregido a **fallo cerrado** (`TransicionNoValidableError`)
  + catálogo explícito inyectado en 24 suites vía fixture derivada del SEED real (no permisiva).
- Re-review **APROBADO 0 bloqueantes**, verificado **por mutación** (borrar una arista pone en rojo los
  tests de sus call-sites; antes del fix seguían verdes). R1–R17 trazados, 151 tests nuevos, suite 511
  archivos / 5163 verdes, `./init.sh` OK. **PR #161 → dev, mergeado 2026-07-25.**
- **Lote 137–140 COMPLETO** (4/4 mergeadas) y **DESPLEGADO A PRODUCCIÓN el 2026-07-25** (PR #163
  `dev → prod`, 41 commits). Deployment `ordenex-qzzgvlmhq` **Ready**, build verde en 29 s, runtime sin
  errores. **Migraciones aplicadas y verificadas**: el build corrió `prisma migrate deploy` →
  `No pending migrations to apply` sobre **86 migraciones** (= las 86 del repo, incluidas las 4 del
  lote). Deuda de migraciones del lote **SALDADA**.
- ⚠️ **Hallazgo operativo del deploy:** los **previews de Vercel comparten la base de Supabase con
  producción**, y como el `build` incluye `prisma migrate deploy`, **el build de un preview migra la
  base de producción**. Por eso al mergear a `prod` no quedaba nada pendiente. La ventana de
  inconsistencia código↔DB de una migración no-aditiva se abre **al crear el PR**, no al mergear: con el
  rename de la 137 estuvo abierta desde el preview del PR #157. Para renames/destructivas futuras,
  preferir expand-contract (aditiva primero, limpieza en un PR posterior) o mergear de inmediato.

## 2026-07-25 — 121 ubicación compartida por el cliente en el chat de WhatsApp (cierre de estado stale)
- Soporte de `type=location` en el webhook de WhatsApp + minimapa en el chat. Backend: enum
  `ChatMensajeTipo.ubicacion` + columnas `latitud`/`longitud` nullable en `chat_mensaje` (migración
  up/down `20260724120000_chat_mensaje_ubicacion`), normalización en `lib/types/whatsapp-webhook.ts`,
  propagación service/repo/DTO/vista. Frontend: burbuja con `MapPin`, **`components/ui/dialog.tsx` nuevo**
  (sobre `@base-ui/react`, modelado en `sheet.tsx`), `UbicacionMapa`/`UbicacionMapaInner`
  (Leaflet + OSM anti-SSR, patrón feature 97) y GPS lazy vía `useUbicacionActual` con degradación no
  bloqueante si se deniega el permiso.
- Gate F1.4: D1 = la posición del repartidor es el **GPS del navegador en vivo** (sin rastreo
  server-side); D2 = v1 **solo visualiza** (no adopta la ubicación como coordenadas de entrega).
  P1 = solo lat/lng, P2 = pin + texto "Ubicación compartida", P3 = GPS al abrir el modal.
- Reviewer **APROBADO 0 bloqueantes**, 16/16 requisitos con test (`progress/review_121.md`,
  `impl_121_backend.md`, `impl_121_frontend.md`).
- **Cerrada el 2026-07-25 por reconciliación:** figuraba `in_progress` por el aterrizaje diferido —
  dependía de que la feature 120 (chat) saliera de `flow` a `dev`, cosa que ya ocurrió. Su código y su
  migración están en `dev` y desplegados. Deuda menor heredada: la migración se validó por forma
  estática, y G2 quedó como dos archivos `impl_121_*` en vez de un `impl_121.md`.

## 2026-07-25 — 136 etiquetas PDF: primer review real (RECHAZADO) + corrección de los 3 bloqueantes
> ✅ **CERRADA (`done`) el 2026-07-26**: el bucket privado `etiquetas-guia` ya existe en Supabase prod
> (`public = false`, verificado por el leader), con lo que T0.1 queda saldada y R8/R9/R10 dejan de
> depender de fakes. Re-review APROBADO-CON-NOTAS, 0 bloqueantes.

- **Se descubrió que la 136 estaba mergeada en `dev` y DESPLEGADA sin review real.** Su
  `status_note` afirmaba "reviewer APROBADO 0 bloqueantes" y daba por hecho `.env.example`, pero
  `progress/review_136.md` no existía en disco y las variables no estaban en el archivo. Ambas
  afirmaciones quedaron corregidas en `feature_list.json`.
- **Review real → RECHAZADO, 3 bloqueantes** (`progress/review_136.md`; lo transcribió el leader tras
  cuatro caídas de conexión del agente, mismo precedente que la 139):
  - **BLOQ-1 (grave, pérdida de datos):** el PDF no tenía cota — hasta `MAX_CHUNK_ROWS` = 5000, con
    ~13 ms y ~279 KB por etiqueta (~1.4 GB / ~65 s en el tope) — y reventaba por **OOM/timeout DESPUÉS**
    de commitear las órdenes. Un OOM no es excepción JS, así que el `try/catch` del borde no lo
    capturaba: **500/504 en vez del 200 de R12 y el integrador perdía los `num_guia`** (al reintentar le
    salían como `duplicada`). Ningún test cubría lote grande.
  - **BLOQ-2:** T0.2 y T4.3 marcadas `[x]` con artefacto inexistente (`.env.example` sin las variables,
    `impl_136.md` ausente).
  - **BLOQ-3:** R7 sin test asertivo — el test mockeaba `qrcode` y `bwip-js`, justo las libs cuya
    server-safety afirma el requisito.
- **Corregido en 5 commits.** BLOQ-1 se resuelve **decidiendo antes de empezar** en vez de intentar
  recuperarse: tope `ETIQUETAS_MAX_POR_PDF` (default 300, techo 1000) evaluado en el **borde** antes de
  construir service o cliente de Storage, repetido en el service como defensa en profundidad; más
  `compress: true` (262.8 KB → 3.3 KB por etiqueta, ~80×) y `runtime = "nodejs"` + `maxDuration = 60`.
  Menores: TTL clampeado a 24 h, log sin el error crudo, `EtiquetaGuiaService` aísla por dueño cuando el
  actor es `apiKey`, y los comentarios "Feature 112" → "Feature 136".
- **Re-review: APROBADO-CON-NOTAS, 0 bloqueantes**, con medición propia del reviewer (300 etiquetas =
  5.74 s / RSS 301 MB → cabe con margen en `maxDuration=60`; techo 1000 = 19.3 s). **14 tests nuevos**;
  R3 y R4 dejan de ser parciales. `./init.sh` verde (**515 archivos / 5209 tests**), verificado también
  por el leader de forma independiente.
- ~~**Deuda viva:** T0.1 crear el bucket privado `etiquetas-guia`~~ → **SALDADA 2026-07-26**: el bucket
  existe y es privado en Supabase prod. La respuesta del endpoint ya puede traer la URL firmada real.
- **Notas menores vivas** del re-review: M1 upload/signed URL sin timeout (un stall de red aún podría
  dar 504 tras el commit — misma familia que BLOQ-1, mucho menos probable), M2 assert numérico débil en
  R4, M3 R3 no end-to-end, sin E2E (precedente de la 88).

## 2026-07-26 — 112, 105 y 79: cerradas por auditoría del backlog (ya estaban hechas)
- A petición del humano ("creo que muchas ya quedaron o ya no se necesitan") se auditó **cada feature
  pendiente contra el código**. El registro estaba desactualizado en 5 de 8 casos.
- **112 — webhook, sobre genérico `data`** (figuraba `spec_ready`, o sea sin empezar): ya implementada.
  `lib/services/WebhookEstadoService.ts:89` construye el cuerpo con `data: {...}` y
  `tests/unit/services/webhook-estado-service.test.ts:94` asserta `body.data`. El breaking change
  `orden` → `data` viajó con la implementación de la 104.
- **105 — UI de registro de webhooks** (figuraba `pending`): ya implementada y **cableada**. Cadena
  `page.tsx` → `ApiKeysModule` (23 referencias a webhook) → `api-keys-columns.tsx` →
  `WebhookAccionCell.tsx` → `RegistrarWebhookForm.tsx`, más `RevelarWebhookSecretoModal.tsx` y
  `webhook-url.ts`, con 3 tests de componente. (Un primer grep superficial sugirió que el formulario no
  estaba montado; la cadena real pasa por las columnas de la tabla.)
- **79 — `/paquete/[numGuia]` pública** (figuraba `pending`): la decisión que la feature pedía **ya se
  tomó y se implementó** — opción (b) de su propia descripción: NO es pública, exige sesión. Con un
  refinamiento: `middleware.ts` la manda a `/` en vez de a `/login` (`REDIRECT_TO_ROOT`), porque enviar
  a un formulario de login a quien sólo pegó un número de guía es un callejón. Tests en
  `tests/unit/auth/middleware.test.ts:116-127`. La superficie de enumeración que alertaba su ficha
  queda descartada al no exponerse sin sesión.
- **Reclasificadas (estaban a medias, en la mitad contraria a la que decía su ficha):** **85** tiene el
  backend completo y sólo le falta la UI (es feature frontend); **74** tiene la captura de la causa
  hecha y le falta explotarla (mostrarla/agruparla en listados).
- **Backlog real resultante: 20 pendientes, de las cuales 15 son la cadena de analítica.** El trabajo
  suelto son 5 features (80, 85, 74, 70, 71) más la 66. Sin features `in_progress` ni `spec_ready`.

## 2026-07-27 — 142 plantilla de carga masiva v2 (nuevo orden + `direccion_destinatario` unificada)
- Rehecha la plantilla de carga masiva: orden de columnas nuevo (`destinatario`, `telefono`,
  `direccion_destinatario`, `monto_cobrar`, `producto`, `num_remision`, `peso`, `notas`) y las 4
  columnas `provincia`/`canton`/`distrito`/`direccion` **reemplazadas por una sola** con formato
  `País / Provincia / Cantón (Distrito) / Dirección literal`. Parser puro nuevo en
  `lib/utils/direccion-destinatario.ts`. Sin migración. **PR #174**, mergeado a `dev` en `c3e6954`.
- Decisiones del humano: **corte duro** (sin modo compatibilidad; un archivo viejo falla en
  `findMissingHeaders`) y **distrito obligatorio** (de él se deriva `zona_id`, que decide tarifa y ruteo).
- Hallazgo que salvó el contrato público: `filaCargaSchema`/`resolveFila` los comparte `cargarViaApi`
  (feature 88, API key, con las 3 columnas geográficas SEPARADAS). Meter el parser en el schema lo habría
  roto en silencio → **extractor de geografía inyectado por vía**, con `resolveGeo` intacto.
- El ejemplo canónico de la plantilla se sustituyó: `Cartago / Jimenez (Juan Vinas)` existe en el
  catálogo pero **no recibe zona** al cruzarlo con el mapa → habría fallado. Quedó
  `Costa Rica / Cartago / Cartago (Occidental) / …`. El guard `carga-masiva-ejemplos-geo.test.ts` **no se
  relajó**. Deuda de datos detrás: solo **198 ternas** del catálogo reciben zona en el seed.
- Reviewer APROBADO 0 bloqueantes: typecheck 0, lint 0 errores, 517 archivos / 5280 tests verdes,
  mutación (R19/R22 → 5 tests caen) y fuzz de 50.000 entradas al parser (0 excepciones, falla cerrado).
- Deuda: falta E2E cliente→ruta chunk→service con la columna nueva; el mensaje de «paréntesis no cerrado»
  confunde si hay una `/` dentro del paréntesis.
- **Aviso operativo:** el corte es duro — todo archivo de carga masiva con las 4 columnas viejas dejó de
  funcionar al mergear; hay que redescargar la plantilla.

## 2026-07-27 — 143 descargar en Excel las filas con error de la carga masiva
- Botón en la vista previa de la carga masiva que descarga un `.xlsx` con **solo las filas con error**,
  con los valores **crudos** del archivo original y una columna extra `motivo_error` al final.
  Descarga de cliente puro (Blob + anchor), sin backend, sin migración. **PR #177** → `dev`.
- Requisitos: R1–R22, todos con test. Módulos nuevos: `carga-masiva-errores-formato.ts`,
  `carga-masiva-export-errores.ts`, `buildXlsxRows` + `XLSX_MIME` en `lib/utils/xlsx-template.ts`.
  `exceljs` sigue entrando **solo** por import dinámico.
- El ABIERTO del backlog («una columna extra rompe el round-trip») resultó **falso**, pero por diseño
  permisivo, no por contrato: `findMissingHeaders` solo comprueba presencia, ambos parsers indexan por
  nombre de cabecera y `filaCargaSchema` no es `.strict()`. Como funcionaba **por accidente afortunado**,
  se fijó con R14/R15/R16 + test de round-trip + comentarios-ancla: un futuro `.strict()` rompe un test,
  no la producción.
- Hallazgo del spec: el cruce `fila` ↔ `linea` solo es válido porque `procesarEnChunks` **remapea** la
  fila del lote a la línea original (`carga-masiva-chunks.ts:99`). Sin ese remapeo el archivo saldría con
  datos de otras filas y el usuario corregiría la fila equivocada. Blindado con test dedicado.
- Alcance cerrado en F1.4: **solo vista previa** (los errores post-confirmación quedan fuera, R20);
  prefijo `Fila N — campo: motivo` una sola vez y **sin inventar número** si no hay línea (R22); sin CSV.
- Review **por mutación**: `.strict()` mata 2 tests, lista blanca en `findMissingHeaders` mata 2, quitar
  el remapeo mata el del cruce, un sufijo en la cabecera mata 9, un prefijo inventado mata 2.
- Deuda: T13 (paseo manual en Excel/Sheets) **no se ejecutó**; se sustituyó por
  `tests/integration/carga-masiva-errores-roundtrip.test.ts`, que genera el xlsx real y lo re-parsea con
  ambos parsers.

## 2026-07-27 — 146 campana de notificaciones funcional
- `NotificationsBell` deja de tener notificaciones quemadas y consume datos reales. Modelo nuevo
  `notificacion` + `notificacion_lectura` (leída/descartada **por usuario**), migración
  `20260727120000_notificacion` (up + down), RLS habilitada sin policies (patrón del repo) y toda la
  autorización en un único `predicadoVisibilidad(actor)` compartido por las 5 Server Actions.
  R1–R50, 24 tasks. **PR #176** → `dev`.
- Decisiones del humano: 4 eventos que notifican (rechazo, carga masiva terminada, postulación
  pendiente, cierre por aprobar); refresco por **polling SWR**, no Realtime; direccionamiento por rol
  con lectura por usuario.
- **El humano omitió el aviso de «órdenes con más de 1 día sin asignación»**, el único que exigía
  barrido periódico → cayeron el cron, el `JobTipo` y el env de umbral que la ficha daba por hechos.
  Queda como candidato a feature aparte (el reloj corre «desde la creación», ya respondido).
- Contradicción resuelta en el gate: el rechazo llega a maestro + admin + `adminTienda` dueño +
  `adminSatelite` de la zona → obligó a **dos columnas de alcance** (`tienda_id`, `zona_id`). `Actor`
  gana `zonaId` (aditivo).
- **Bloqueante atajado por el leader:** la 1.ª entrega metía `if (enTest()) return` en producción — el
  mismo anti-patrón de guardia-apagada-bajo-test que hizo rechazar la 140. Recableado: el default de los
  services es un **no-op** y el real se inyecta en los composition roots, con test de barrido que falla
  si alguien reintroduce un apagado por entorno.
- Guardia ajena editada con aprobación: `no-migration-102.test.ts` afirmaba que el esquema no tiene
  NINGUNA infra de notificaciones; pasó a una allowlist de una entrada, sin tocar los invariantes de la 102.
- Deudas: sin purga (los 30 días son solo ventana de consulta); sin paginación (`PAGE_SIZE=50` trunca en
  silencio); sin marcar leída por elemento en la UI; la campana arranca vacía en cada página y cada una
  abre su propio polling. El `down.sql` se revisó por lectura, **sin round-trip real**.

## 2026-07-28 — 148 manifiesto Excel al crear o mover órdenes
- Tras cada operación **por lote** sobre órdenes se ofrece la descarga de un `.xlsx` con el manifiesto
  (11 columnas: guía, remisión, destinatario, teléfono, dirección, zona, monto, origen, destino,
  responsable, fecha). Los 5 puntos de enganche: carga masiva, generar guía / asignar mensajero, ruteo a
  bodega satélite, envío de devolución a central y devolución a la tienda. R1–R30, 22 tasks.
  **PR #178**, mergeado a `dev` en `0bcc360`.
- Decisiones del humano: generación **en cliente** sobre el resultado de la acción (`exceljs` por import
  dinámico + Blob/anchor), **sin Storage ni bucket nuevo** (el manifiesto NO es reimprimible), los 5
  enganches en esta feature y **sin modelo nuevo en DB**.
- Hallazgo estructural que evitó tocar 5 servicios de negocio: ningún flujo devuelve hoy las 11 columnas
  (la carga masiva ni siquiera trae `ordenId`) y **dos de los cinco no tienen lote en el service** —
  `EnvioDevolucionCentralService.enviarACentral` y `DevolucionOrigenService.devolverATienda` son **por
  orden**, con el lote como un loop en la UI. Solución: **Server Action de LECTURA aparte**
  (`obtenerManifiesto`, unión discriminada `ordenIds` vs `numRemisiones`) → los 5 servicios quedan
  intactos (R27, verificado contra el diff). Precedente idéntico: `generarEtiquetas({ ordenIds })`.
- **Cambio de UX real, confirmado por el humano:** para que exista la fase «resultado» con botón
  explícito, `onSuccess()` se **difiere al cierre** de esa fase (el `onSuccess` de los padres cierra el
  modal y destruiría la pantalla donde vive el botón). El encadenado a «Imprimir etiquetas» de la
  feature 95 ahora ocurre **después**: manifiesto → etiquetas.
- **Bloqueante que solo apareció mirando los E2E:** el diferimiento rompió 3 specs
  (`asignacion-satelite`, `reintentos-escalado`, `devolucion-origen`). **No salió en rojo porque los E2E
  no corren en `pnpm test` ni en `./init.sh`** — deuda de arnés viva.
- Review por mutación: 10 mutaciones, 9 KILL. Sobrevive la rama `mensajero ?? actor` de
  `asignacion_satelite` (menor, abierto). El guion largo (U+2014) quedó fijado por test; el helper viejo
  colapsaba `nombre: null` al nombre del actor, así que el caso **no era ni expresable**.
- Sin migración, sin `db/schema.prisma`, sin RLS.

## 2026-07-28 — 150 tamaño de hoja seleccionable en las etiquetas
- Catálogo de tamaños de hoja (100×100 mm, 4×6 in, A4, carta) en `lib/config/etiquetas-hoja.ts` +
  escalado en `app/(app)/ordenes/_components/etiquetas-layout.ts`, con selector en el modal de descarga.
  R1–R21, 11 tasks. **PR #179**, mergeado a `dev` en `28d9e8e`.
- Decisiones del humano: **una etiqueta por página escalada** (no mosaico N-up); el tamaño se elige **en
  cada descarga**, default 100×100 mm, **sin persistencia**; alcance = **solo el generador de cliente**.
- Esa tercera decisión recortó la feature a la mitad y no estaba en la ficha: el generador server-side
  `lib/pdf/etiquetas-pdf-lote.ts` (feature 136) corre **solo, dentro del `POST /api/ordenes/api-key/carga`,
  sin humano delante** → un selector ahí no existe; sería preferencia persistida o un campo en el payload
  público de integradores. El humano eligió ninguna → la 150 queda sin backend, sin migración y sin tocar
  contrato público.
- **Riesgo aceptado:** los dos generadores quedan divergentes (cliente parametrizable, servidor fijo en
  100×100), blindado con test de no-regresión (R21). ⚠️ Ese blindaje se apoya en `Function.length` y
  **no cazaría** una parametrización con parámetro por defecto — punto débil conocido.
- El catálogo NO fue a `lib/config/etiquetas.ts` como decía la ficha: ese archivo es config server-side
  por `process.env` y un componente cliente no puede importarlo sin arrastrar el entorno al bundle.
- `carta` = **215.9 × 279.4 mm** exactos, no el `216 × 279` redondeado de la ficha. La implementación usa
  `lado = min(ancho, alto)` en vez de `100·s` porque el ida y vuelta por el factor daba `offX = −1.4e−14`
  y violaba R17 por ruido de coma flotante.
- Trampa que costó un archivo de test extra: `doc.save` de jsPDF es propiedad **de instancia** y en Node
  usa `fs.writeFileSync` → llamarlo con jspdf real **escribía PDFs en la raíz del repo**. R19 se aisló
  sustituyendo jspdf entero.
- Deuda: el centrado **nunca se validó con impresión física**.

## 2026-07-28 — 152 hotfix WhatsApp: diagnóstico de salientes fallidos y fin de los reintentos infinitos
- **Registrada retroactivamente. NO pasó por el arnés:** se implementó fuera del ciclo SDD y se mergeó
  **directo a `prod`** (PRs **#182**, **#184**, **#185**, rama `feature/log-fallos-whatsapp`). El PR
  **#183**, que la porta a `dev`, seguía abierto al reconciliar. Se registra porque cambia el modelo de
  datos y las reglas de reintento del chat: quien toque WhatsApp después necesita saber que existe.
- **Los dos fallos mudos que resuelve:** (1) Meta responde 2xx con `wa_message_id` y luego reporta
  `failed` por webhook con `errors:[{code,title,message,error_data}]`, pero `metaStatusSchema` no lo
  declaraba y zod lo descartaba por *strip* → el `failed` quedaba sin motivo y había que entrar al panel
  de Meta. (2) El cliente clasificaba **cualquier** no-2xx como `transitorio` y tiraba el cuerpo: un 400
  determinista (plantilla inexistente, idioma equivocado, parámetros que no cuadran, destinatario no
  permitido) dejaba el saliente **`queued` para siempre**, con 5 reintentos contra el mismo 400 y muerte
  en dead-letter.
- **Qué entrega:** el borde tipado normaliza `errors[0]` a `WebhookStatus.error`; migración aditiva
  `20260728230000_chat_mensaje_error_meta` (`chat_mensaje.error_codigo/error_titulo/error_detalle` +
  índice parcial); volcado del status crudo completo con redacción de `recipient_id` (mantiene la
  invariante de no-PII de la 109/R11) en `lib/services/whatsapp/chat-logger.ts`; desenlace nuevo
  **`permanente`** (4xx salvo 429 → `failed` sin encolar; 5xx y 429 siguen `transitorio`); **lista
  blanca conservadora** de códigos reintentables (`130429`, `131000`, `131056`) en
  `lib/services/whatsapp/errores-meta.ts`, con el criterio de que un código desconocido **no** se
  reintenta; y la UI muestra el motivo real en vez de caer en el `default` del switch, que decía
  «Tu sesión expiró».
- **Bug latente corregido de paso:** `reintentarEnvio` reenviaba **siempre** con `enviarTexto`, incluso
  salientes `tipo=plantilla` → degradaba la plantilla a texto libre, que Meta rechaza fuera de la
  ventana de 24 h. Ahora re-resuelve la plantilla y la re-renderiza con los datos vigentes de la orden.
- **Deudas que deja, verificadas contra `origin/prod`:** (a) la migración
  `20260728230000_chat_mensaje_error_meta` **no tiene `down.sql`**, contra la regla del repo; (b) `prod`
  **y la rama del PR #183** llevan dos Server Actions de depuración —`lib/actions/_tmp-probar-jobs.ts` y
  `lib/actions/_tmp-sincronizar-plantillas.ts`— que hay que sacar antes de portar; (c) no tiene spec, ni
  requirements EARS, ni mapa `R<n>` → test, ni review del arnés: su verificación es la que declara el PR
  (typecheck limpio, 97/97 en las 12 suites de WhatsApp, 20 tests nuevos en
  `whatsapp-fallo-saliente.test.ts`).
- **Lección de proceso, la segunda vez en dos días:** un hotfix ramificado desde `origin/prod` que no se
  porta a `dev` el mismo día deja `prod` sano mientras todo lo que sale de `dev` arrastra el bug. Ya
  pasó el 2026-07-27 con el fix del pooler (PR #172).

## 2026-07-28 — 66 `qr - detalle`: cancelada
- Nunca se empezó. `app/(app)/qr/page.tsx` quedó siendo solo el escáner de la feature 65 (`QrScanner` +
  `useQrNavigate`), sin switch por rol ni pantalla de detalle.
- **Cancelada por decisión del humano** porque el flujo cambió: las lecturas de QR ya **no** se hacen
  desde una página dedicada sino **desde un botón en el punto de uso** (patrón que introdujo la
  recepción en bodega central, feature 138). Un detalle por rol colgado de `/qr` no tiene consumidor.
- **Deja trabajo declarado, aún sin registrar como feature:** la página `/qr` ya no se necesita y hay
  que retirarla (ruta `app/(app)/qr/`, su entrada en `lib/auth/menu-visibility.ts` y lo que dependa de
  `useQrNavigate`). No se retiró en la reconciliación: borrar una ruta es cambio de producto, no
  bookkeeping, y antes hay que verificar que `QrScanner`/`useQrNavigate` no queden huérfanos — el botón
  de recepción los reusa.

## 2026-07-28 — 153 `order_status`: `en_ruta` → `en_reparto` (primera del lote de flujo v2)
- Rename **mecánico** del value, sin ningún cambio de flujo: mismas aristas, mismos servicios,
  misma semántica. 94 archivos en el diff, de los cuales **75 son byte a byte idénticos a `dev`**
  tras normalizar el rename. Migración `20260728120000_order_status_en_reparto` (UPDATE sobre la
  tabla catálogo, no `ALTER TYPE`) + `down.sql`. R1–R21. **PR #190**, mergeado en `f7dbda4`.
- **`en_reparto` es el nombre VIEJO, y esta feature revierte una decisión de hace cuatro días.**
  La feature 135 lo renombró *a* `en_ruta` el 24/07 bajo «unificar nomenclatura» y dejó
  `censo-order-status-rename.test.ts` **prohibiendo** que reapareciera (estaba en `OLD_VALUES`).
  El arreglo correcto fue un **swap** del guard —entra `en_ruta`, sale `en_reparto`— conservando
  la allowlist que protege las migraciones y tests históricos de la 135. Borrarlo no era opción.
- **Arregló un fallo que venía de `dev`, no de la feature.** El guard `no-embalaje` estaba rojo
  desde el merge de las specs (PR #189): recorre el árbol con `fs.readdir` y tres archivos de
  `specs/155-*` y `specs/159-*` citan el guard **por su nombre de archivo**. Arreglo de 8 líneas
  en commit aparte y revertible. Es la segunda vez en el día que esa clase de guard se dispara
  por documentación (la primera fueron los restos sin trackear de la reconciliación).
- **Dos requisitos no tenían NINGÚN test y ahora sí.** `ORDER_STATUS_CLASS` es un
  `Partial<Record<...>>`: perder una clave al moverla **no rompe el build**, solo apaga el color
  del chip en silencio. Y `docs/api/api-key-openapi.yaml` es texto plano, sin nada que
  garantizara que seguía siendo espejo del objeto TS. Los cubrió el implementador por iniciativa
  propia, no estaban en el plan.
- **Verificación medida por el reviewer, no por el implementador:** suite `5712/5712` (baseline
  de `dev`: `1 failed / 5680`), `typecheck` 0, `eslint` sin errores nuevos, `tests/integration/db`
  584/584, `./init.sh` en `== init OK ==`. Delta **+31 tests, −1 suite rota**.
- **Review por MUTACIÓN: 27 aplicadas, 25 muertas.** El reviewer detectó que su primer arnés de
  mutación daba falsos positivos (un flag inválido de vitest) y **lo rehízo entero** con una
  mutación de control que sí debía sobrevivir.
- **Round-trip de migración ejecutado contra Postgres real** (lo cerró el leader tras verificar
  que `DATABASE_URL` apunta a `localhost` y no a producción): `deploy` → `en_reparto`,
  `db:rollback` → `en_ruta`, `deploy` → `en_reparto`, sin pérdida de filas. El conteo es **19 y
  no 18** por la fila huérfana `pendiente` (migración `20260714140000`, nunca añadida al SEED),
  ya documentada como inofensiva.
- **Deuda declarada, no disfrazada:** **T6.3 (Playwright) quedó en `[ ]` a propósito.** No hay
  harness de E2E en el repo y los `e2e/*.spec.ts` usan emails placeholder, así que no corren ni
  en `pnpm test` ni en `./init.sh`. En `e2e/` el cambio fue solo de comentarios. Marcar la
  casilla habría sido fingir una verificación que nadie hizo.
- **Menor conocido:** el mutante de `ESTATUS_EN_REPARTO` en `OrdenRepository` **sobrevive** — su
  único consumidor (`findParadasEnReparto`) está siempre mockeado. Hueco **preexistente en
  `dev`**; el valor entregado es correcto por el diff byte-idéntico, pero la red no lo protege.
- **Contrato externo roto sin aviso, por decisión del humano** (misma política que la 135): el
  value cambia en `api-key-openapi.yaml` y en el payload de webhook sin bumpear `info.version`
  (sigue en `1.0.0`) ni publicar changelog. Segunda rotura en una semana, anotada a conciencia.
