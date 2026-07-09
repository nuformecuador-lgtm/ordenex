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
