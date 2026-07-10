# Impl — Feature 25 · Gestión de usuarios (configuración) · BACKEND (Bloque 0–3)

Rama: `feature/25-gestion-usuarios`. Alcance: T1, T2, T2b, T3, T4, T5, T6, T7.
Frontend (T8–T11, R26–R28, R36) queda **PENDIENTE** para `frontend_dev`.

## Archivos creados
- `lib/config/usuarios.ts` (T1) — DEFAULT/MAX_PAGE_SIZE, override por env.
- `lib/types/usuario.ts` (T2) — schemas zod (union discriminada por `passwordMode`),
  DTOs y `ActionError` (`conflict` con `campo`). Importa `strongPasswordSchema` (feat 20).
- `lib/utils/password-generator.ts` (T2b) — `generateStrongPassword()` (crypto), autovalida.
- `lib/interfaces/services/IUsuarioService.ts` (T5) — resultados discriminados; reusa `Actor`.
- `lib/services/UsuarioService.ts` (T6) — `ALLOWED_ROLES = { maestro }`; crea con estado
  `activo`, resuelve contraseña por modo, traduce catálogo/duplicado.
- `lib/actions/usuarios.ts` (T7) — 6 Server Actions, `withErrorHandler`/`toActionError`,
  deps inyectables (`getActor`/`usuarioService`).

## Archivos modificados
- `lib/interfaces/repositories/IUserRepository.ts` (T3) — `list`/`count`/`update`/`setEstado`/
  `listTiposIdentificacion` + tipos (`ListUsuariosParams`, `UsuarioListItem`, `UpdateUsuarioData`,
  `TipoIdentificacionItem`). Ningún tipo de salida expone `passwordHash`.
- `lib/repositories/UserRepository.ts` (T4) — implementación; `LIST_SELECT` (incluye `rol.value`,
  sin hash), `SORT_COLUMN` lista blanca, valida FK catálogo reusando `CatalogoInvalidoError`.
- Tests existentes ampliados con los stubs de los métodos nuevos del repo (ripple del cambio de
  interfaz): `tests/unit/services/{asignacion-mensajero-service,auth-service,rol-admin-satelite-authz}.test.ts`.

## Tests creados
- `tests/unit/config/usuarios.test.ts`
- `tests/unit/types/usuario-schema.test.ts`
- `tests/unit/utils/password-generator.test.ts`
- `tests/unit/repositories/user-repository.crud.test.ts`
- `tests/unit/services/usuario-service.test.ts`
- `tests/unit/actions/usuarios.test.ts`

## Mapa R (backend) → test
- R1 (resolver actor): usuario-service (autorización) + usuarios (action delega tras actor).
- R2 (sin sesión → unauthenticated): usuarios.test "sin sesion -> unauthenticated".
- R3/R4 (solo maestro): usuario-service "admin/mensajero/desconocido -> forbidden".
- R5 (validación borde): usuarios.test "email invalido -> validation_error".
- R6/R31 (política contraseña manual): usuario-schema "modo manual rechaza password débil";
  usuarios.test "password debil -> validation_error".
- R7/R35 (hash, no claro en manual): usuario-service "modo manual hashea y no retorna generatedPassword".
- R8 (estado activo): usuario-service "crear fija estado activo".
- R9 (catálogo FK): usuario-service "catalogo FK inexistente -> validation_error".
- R10/R11 (duplicado email/cedula): usuario-service "conflict con campo email/cedula";
  usuarios.test "propaga conflict con campo".
- R12/R24 (sin passwordHash): usuario-service "crear no retorna passwordHash"; user-repository.crud
  "list ... sin passwordHash".
- R13 (paginado, clamp): usuarios config test; usuario-schema "acota pageSize a MAX";
  usuario-service "listar calcula skip"; user-repository.crud "list paginado".
- R14 (fila con rolValue, sin hash): user-repository.crud "list ... con rolValue".
- R15 (orden lista blanca): usuario-schema "rechaza sortBy fuera de lista blanca";
  user-repository.crud "list ordena por columna de lista blanca" / "ignora sortBy inválido".
- R16 (solo editables): usuario-schema "actualizar rechaza email/cedula/password";
  user-repository.crud "update aplica solo campos editables"; usuario-service "aplica solo editables".
- R17 (editar inexistente): user-repository.crud "update retorna null"; usuario-service "actualizar inexistente -> not_found".
- R18 (catálogo en edición): user-repository.crud "update valida FK rolId"; usuario-service "catalogo FK inválido en edición".
- R19 (edición → público): user-repository.crud "update ... retorna publico"; usuario-service actualizar ok.
- R20/R21/R22 (activar/inactivar, baja lógica): user-repository.crud "setEstado ... null si no existe";
  usuario-service "cambiarEstado inactiva" / "inexistente -> not_found".
- R23 (enum estado): usuario-schema "cambiarEstado solo acepta activo|inactivo".
- R25/R34 (no loguear contraseña): password-generator "no expone/loguea el valor"; hash-only en service.
- R29 (catálogo tipos): user-repository.crud "listTiposIdentificacion"; usuario-service listarTipos.
- R30/R32 (modos contraseña / autogenerada fuerte): usuario-schema "modo generate no requiere password";
  password-generator "genera contraseña que pasa strongPasswordSchema"; usuario-service "modo generate ... hashea".
- R33 (devolver una vez): usuario-service "la retorna una vez"; usuarios.test "propaga generatedPassword".

R26–R28, R36 → frontend (T8–T11), PENDIENTE.

## Verificación (salida real)
- `npx tsc --noEmit`: 0 errores.
- `npx vitest run` (suite completa): **110 files, 864 tests passed**, exit 0. Sin flaky en esta corrida.
- Tests nuevos en aislamiento: 6 files, 49 passed.
- `./init.sh`: **== init OK ==**, exit 0. Lint: 0 errores (135 warnings, todos preexistentes en
  `.claude/skills/impeccable/scripts/**`, ninguno en archivos de esta feature). Migraciones down.sql OK.
- Diff fuera de `lib/`: solo `tests/**` (tests nuevos + 3 mocks de repo ampliados). **No se tocó `app/**`.**
  Sin migración/tabla nueva (se reusa el modelo `Usuario`).

## Veredicto
Backend de la feature 25 (Bloque 0–3) completo y verde; frontend (Bloque 4) pendiente.

---

# Impl — Feature 25 · FRONTEND (Bloque 4, T8–T11)

Rama: `feature/25-gestion-usuarios`. Alcance frontend: T8, T9, T10, T11 (+ cierre T12).
Solo capa de presentación; NO se tocó `lib/**`, `db/`, `app/api/` (solo se importan tipos
y Server Actions ya existentes en lectura).

## Archivos creados (app/(app)/configuracion/**)
- `_components/usuarios-columns.tsx` (T8) — `buildUsuariosColumns({onEditar,onCambiarEstado,
  estadoPendienteId})`: columnas nombre/email/rol(value legible)/estado(chip)/acciones. NO
  expone campos sensibles (el DTO de fila no tiene hash). `ROL_LABELS`/`ESTADO_LABELS` +
  `EstadoUsuarioBadge`.
- `_components/UsuarioForm.tsx` (T9) — `forwardRef<UsuarioFormHandle>` con `submit()` imperativo.
  Selects de rol (`ROLES_SEED`) y tipo de documento (SWR sobre `listarTiposIdentificacion`).
  Toggle de modo de contraseña escribir/generar (oculta input en generar); tras crear muestra
  `generatedPassword` UNA vez con botón copiar + aviso. En edición deshabilita email/cedula.
  Valida en cliente reusando `crearUsuarioSchema`/`actualizarUsuarioSchema` (incluye
  `strongPasswordSchema` vía la unión), sin duplicar reglas.
- `_components/UsuariosModule.tsx` (T10, client) — DataTable + Pagination (SWR con
  `fallbackData` del prefetch), botón Crear + Modal async (`closeOnConfirm=false`, dispara
  `formRef.submit()`), activar/inactivar por fila, `useToast` para feedback. Cablea las
  Server Actions.

## Archivos modificados
- `app/(app)/configuracion/page.tsx` (T11) — Server Component: `resolveActorFromSession`;
  si `rol !== "maestro"` NO renderiza el módulo (mensaje "No tienes permiso"); si maestro,
  prefetch de `listarUsuarios(page 1, DEFAULT_PAGE_SIZE)` y render de `UsuariosModule`.
  Reemplaza el placeholder.
- `tests/components/PlaceholderPages.test.tsx` — se quita el caso `/configuracion` (ya no es
  placeholder; ahora es Server Component con auth, cubierto por el test de integración nuevo).

## Tests creados
- `tests/unit/components/usuarios-columns.test.tsx`
- `tests/unit/components/usuario-form.test.tsx`
- `tests/unit/components/usuarios-module.test.tsx`
- `tests/integration/configuracion/usuarios-page.test.tsx`
(Actions mockeadas; SWR aislado por `SWRConfig`/`ToastProvider`.)

## Mapa R (frontend) → test
- R1/R3 (auth server-side, solo maestro): usuarios-page "rol no autorizado no ve el módulo",
  "sesión ausente tampoco ve el módulo".
- R13 (prefetch listado): usuarios-page "pre-carga el listado del maestro y lo pasa al módulo"
  (+ fallback a datos vacíos si el listado falla).
- R14/R26 (columnas sin datos sensibles): usuarios-columns "define columnas nombre/email/rol/
  estado sin exponer campos sensibles", "renderiza rol legible y estado como chip".
- R26 (DataTable + Pagination): usuarios-module "lista en DataTable con paginación".
- R27 (Modal async crear/editar): usuarios-module "el botón Crear abre el Modal async",
  "Editar carga el usuario y abre el Modal en modo edición".
- R28 (feedback useToast del backend): usuarios-module "muestra toast de éxito" / "toast de error".
- R16 (editar bloquea email/cedula): usuario-form "modo editar bloquea email y cedula".
- R29 (selects rol/tipo doc): usuario-form "puebla el select de rol desde ROLES_SEED y el de
  tipo de documento desde la acción".
- R5/R6 (validación en cliente): usuario-form "modo manual con contraseña débil devuelve
  validation_error sin llamar a la acción".
- R36/R33 (toggle generar + muestra password una vez): usuario-form "toggle generar oculta el
  input y muestra la password una vez tras crear".
- R20/R21 (activar/inactivar): usuarios-columns "muestra Inactivar/Activar según estado";
  usuarios-module "el botón Inactivar cambia el estado".

## Nota abierta (no bloqueante)
El select de rol se puebla desde `ROLES_SEED` (valores `RolValue`), pero el backend
(`crearUsuarioSchema`/`create`) espera `rolId` = id del catálogo `rol` (UUID, `gen_random_uuid`
en el seed). Se sigue la Decisión 1.4 (R29: "poblar desde ROLES_SEED") al pie de la letra en el
frontend; queda la posible discrepancia valor/id (y el prefill de rol en edición, cuyo `rolId`
UUID no matchea las opciones por valor) como gap entre la decisión firme y el contrato del
schema. No existe acción para listar roles con id y crear una tocaría `lib/**` (fuera de alcance).

## Verificación (salida real)
- `npx tsc --noEmit`: 0 errores, exit 0.
- Tests frontend nuevos + PlaceholderPages en aislamiento: **5 files, 19 passed**, exit 0.
- `npx vitest run` (suite completa): **114 files, 882 tests passed** (en corrida limpia), exit 0.
  Bajo carga paralela aparecen timeouts flaky pre-existentes en `tests/components/LoginForm`,
  `tests/integration/recuperar-contrasena-form` y `tests/integration/api/ordenes-carga-masiva.route`
  (auth/integración, ajenos a esta feature); verde al reintentar. A los 2 tests propios más
  pesados (userEvent + selects) se les fijó timeout holgado (15–20 s).
- `./init.sh`: **== init OK ==**, exit 0.
- Diff fuera de `app/(app)/configuracion/**`: solo `tests/**` (4 tests nuevos + ajuste de
  `PlaceholderPages.test.tsx`) y `progress/impl_gestion-usuarios.md`. NO se tocó `lib/**`,
  `db/`, ni `app/api/`.

## Veredicto (frontend)
Frontend de la feature 25 (Bloque 4, T8–T11) completo y verde; T12 cerrado.
