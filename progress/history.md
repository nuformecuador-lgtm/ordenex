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
  estándar de modal scrolleable). **Un PR (2 commits: fix plantilla + fix modal) `feature/58 → dev`.** PENDIENTE merge (OK humano).
