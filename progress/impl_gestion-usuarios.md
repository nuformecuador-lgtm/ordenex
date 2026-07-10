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
