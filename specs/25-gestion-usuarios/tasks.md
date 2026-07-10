# Feature 25 — Gestión de usuarios (configuración) · tasks.md

Checklist de pasos verificables. `[P]` = paralelizable con las tareas del mismo bloque
que no compartan archivo. Cada task indica los `R<n>` que cubre y su test.
Convención de nombres de test: describe comportamiento (`docs/conventions.md`).

Bloqueo de aprobación: spec aprobado en la puerta F1.4 (decisiones firmes en
`requirements.md`).

**Bloqueo de dependencia (`depends_on: 20`):** la implementación (F2) NO arranca hasta
que la feature 20 esté mergeada a `dev`. El módulo `lib/types/password-policy.ts`
(`strongPasswordSchema`) NO existe en esta rama todavía (PR #20 abierto). Toda tarea que
importe la política de contraseña (T2, T2b, T6) está bloqueada por ese merge; NO se
duplica la política.

---

## Bloque 0 — Tipos y config (borde)

- **T1** — Crear `lib/config/usuarios.ts` con `DEFAULT_PAGE_SIZE`, `MAX_PAGE_SIZE`
  (patrón `lib/config/cobros.ts`).
  - Cubre: R13. Dep: ninguna.
  - Hecho: exporta las constantes; importado por schema y service.
  - Test: `tests/unit/config/usuarios.test.ts` — "expone limites de paginacion positivos y MAX>=DEFAULT".

- **T2** [P] — Crear `lib/types/usuario.ts`: `crearUsuarioSchema` (strict) con el bloque
  de contraseña como **unión discriminada por `passwordMode`** (`manual` con
  `password: strongPasswordSchema` importado de `lib/types/password-policy.ts`;
  `generate` sin password); `actualizarUsuarioSchema` (partial de editables: nombre/
  telefono/rolId/tipoIdentificacionId, strict, sin email/cedula/password);
  `cambiarEstadoUsuarioSchema` (activo|inactivo); `listarUsuariosSchema` (page/pageSize
  clamp/sortBy/sortDir lista blanca); `UsuarioListItemDTO`, `ActionError`.
  - Cubre: R5, R6, R13, R15, R16, R23, R30, R31. Dep: T1, **feature 20 en dev**.
  - Hecho: schemas compilan en TS strict, sin `any`; importa `strongPasswordSchema`, NO
    duplica la política.
  - Test: `tests/unit/types/usuario-schema.test.ts` — "modo manual rechaza password que no cumple strongPasswordSchema (R6/R31)", "modo generate no requiere password (R30/R32)", "actualizar rechaza email/cedula/password (R16)", "cambiarEstado solo acepta activo|inactivo (R23)", "listar acota pageSize a MAX (R13)".

- **T2b** [P] — Crear `lib/utils/password-generator.ts`: `generateStrongPassword()` con
  aleatoriedad criptográfica que garantiza mayúscula/minúscula/dígito/símbolo y longitud
  válida; valida su propia salida contra `strongPasswordSchema` antes de devolver.
  - Cubre: R32, R34. Dep: **feature 20 en dev**.
  - Hecho: sin `any`; no loguea; importa `strongPasswordSchema`.
  - Test: `tests/unit/utils/password-generator.test.ts` — "genera contraseña que pasa strongPasswordSchema en N iteraciones (R32)", "genera valores distintos en llamadas sucesivas", "no expone/loguea el valor generado (R34)".

## Bloque 1 — Repository

- **T3** — Extender `lib/interfaces/repositories/IUserRepository.ts`: firmas `list`,
  `count`, `update`, `setEstado`, `listTiposIdentificacion`; tipos `ListUsuariosParams`,
  `ListUsuariosResult`, `UpdateUsuarioData`, `UsuarioListItem`.
  - Cubre: R13, R14, R15, R16, R20, R21, R29. Dep: T2.
  - Hecho: interfaz compila; no expone `passwordHash` en ningún tipo de salida.
  - Test: (contrato verificado indirectamente por T4).

- **T4** — Implementar en `lib/repositories/UserRepository.ts`: `list` (paginado, include
  `rol.value`, orden por lista blanca, `PUBLIC_SELECT` sin hash), `count`, `update`
  (valida FK catálogo reusando patrón `create`, `null` si no existe), `setEstado`
  (`null` si no existe), `listTiposIdentificacion`.
  - Cubre: R13, R14, R15, R16, R18, R20, R21, R22, R24, R29. Dep: T3.
  - Hecho: métodos implementados reusando `mapDuplicadoError`/`CatalogoInvalidoError`.
  - Test: `tests/unit/repositories/user-repository.crud.test.ts` (prisma mock) —
    "list devuelve items paginados con rolValue y total, sin passwordHash (R13/R14/R24)",
    "list ordena por columna de lista blanca (R15)",
    "update aplica solo campos editables y retorna publico (R16/R19)",
    "update retorna null si el usuario no existe (R17)",
    "setEstado cambia a inactivo/activo y null si no existe (R20/R21/R22)",
    "listTiposIdentificacion devuelve id/value del catalogo (R29)".

## Bloque 2 — Service

- **T5** — Crear `lib/interfaces/services/IUsuarioService.ts`: `Actor` (reusa de
  IOrdenService), resultados discriminados de `crear/listar/obtener/actualizar/
  cambiarEstado/listarTiposIdentificacion`.
  - Cubre: R1–R4, R12, R19, R24. Dep: T2, T3.
  - Hecho: interfaz compila; ningún result expone `passwordHash`.

- **T6** — Crear `lib/services/UsuarioService.ts` (patrón `CobroService`): única
  constante `ALLOWED_ROLES = { maestro }` (Decisión 1); `crear` (resuelve contraseña por
  `passwordMode`: manual usa la del input, generate llama `generateStrongPassword`;
  hashPassword + estado `activo` + traducción de errores catálogo/duplicado; devuelve
  `generatedPassword` solo en modo generate), `listar`, `obtener`, `actualizar`,
  `cambiarEstado`, `listarTiposIdentificacion`. Autorización ANTES de tocar datos.
  - Cubre: R1, R3, R4, R7, R8, R9, R10, R11, R12, R16, R17, R18, R19, R20, R21, R22,
    R23, R24, R25, R30, R32, R33, R34, R35.
  - Dep: T5, T4, T2b, `hashPassword`, **feature 20 en dev**.
  - Hecho: sin `any`; nunca loguea password/hash (R25/R34).
  - Test: `tests/unit/services/usuario-service.test.ts` (repo mock) —
    "solo maestro autorizado; admin/otros -> forbidden en todas las operaciones (R3/R4)",
    "crear modo manual hashea la password del input y no retorna generatedPassword (R7/R35)",
    "crear modo generate genera password fuerte, la hashea y la retorna una vez (R32/R33/R34)",
    "crear fija estado activo (R8)",
    "crear con email/cedula duplicada -> conflict con campo (R10/R11)",
    "crear con catalogo FK inexistente -> validation/catalogo invalido (R9)",
    "crear no retorna passwordHash (R12/R24)",
    "actualizar de usuario inexistente -> not_found (R17)",
    "cambiarEstado inactiva (baja logica) sin borrado fisico (R20)",
    "cambiarEstado de inexistente -> not_found (R22)".

## Bloque 3 — Server Actions

- **T7** — Crear `lib/actions/usuarios.ts` (`'use server'`, patrón `cobros.ts`):
  `crearUsuario`, `listarUsuarios`, `obtenerUsuario`, `actualizarUsuario`,
  `cambiarEstadoUsuario`, `listarTiposIdentificacion` con `withErrorHandler` +
  `toActionError` + `resolveActorFromSession` (inyectable `deps.getActor`/
  `deps.usuarioService`).
  - Cubre: R1, R2, R5, R6, R13, R23, R28 (mensaje del manejador global), R33 (propaga
    `generatedPassword` en el result de `crearUsuario`).
  - Dep: T6.
  - Hecho: validación zod en el borde; resultados tipados; sin `any`.
  - Test: `tests/unit/actions/usuarios.test.ts` (service + getActor mock) —
    "sin sesion -> unauthenticated y no llama al service (R2)",
    "input invalido -> validation_error con fieldErrors (R5/R6)",
    "crearUsuario modo generate propaga generatedPassword del service (R33)",
    "delega en el service y adapta el error a ActionError (R28)".

## Bloque 4 — Frontend (configuración)

- **T8** [P] — `app/(app)/configuracion/_components/usuarios-columns.tsx`: columnas
  (nombre, email, rol, estado, acciones) para DataTable (patrón `ordenes-columns`).
  - Cubre: R14, R26. Dep: T2.
  - Hecho: columnas tipadas; estado renderizado legible.
  - Test: `tests/unit/components/usuarios-columns.test.tsx` — "define columnas nombre/email/rol/estado sin exponer campos sensibles (R14)".

- **T9** [P] — `app/(app)/configuracion/_components/UsuarioForm.tsx`: form crear/editar
  con select de rol (`ROLES_SEED`) y de tipo de documento (acción
  `listarTiposIdentificacion`), inputs `components/ui/*`, y toggle de modo de contraseña
  (escribir/generar). En modo generar oculta el input; tras crear muestra
  `generatedPassword` una vez con botón copiar y aviso. Rol `mensajero` = solo set base.
  - Cubre: R5, R29, R36. Dep: T2, T7.
  - Hecho: en modo editar deshabilita email/cedula (R16); valida en cliente antes de enviar.
  - Test: `tests/unit/components/usuario-form.test.tsx` — "modo editar bloquea email y cedula (R16)", "puebla selects de rol y tipo de documento (R29)", "toggle generar oculta input y muestra la password una vez tras crear (R36)".

- **T10** — `app/(app)/configuracion/_components/UsuariosModule.tsx` (client):
  DataTable + Pagination (R26), botón Crear + Modal (R27), activar/inactivar por fila,
  `useToast` para feedback (R28).
  - Cubre: R26, R27, R28, R20, R21, R36 (hospeda el UsuarioForm con el modo de
    contraseña en el Modal). Dep: T8, T9, T7.
  - Hecho: acciones cablean las Server Actions; Modal async muestra spinner/bloquea botón.
  - Test: `tests/unit/components/usuarios-module.test.tsx` — "lista en DataTable con paginacion (R26)", "crear/editar en Modal async (R27)", "muestra toast de exito/error del backend (R28)", "boton activar/inactivar cambia estado (R20/R21)".

- **T11** — `app/(app)/configuracion/page.tsx` (Server Component): valida rol autorizado
  (`resolveActorFromSession`), pre-fetch del listado y render de `UsuariosModule`.
  Si no autorizado, no renderiza el módulo.
  - Cubre: R1, R3, R13. Dep: T10, T7.
  - Hecho: reemplaza el placeholder; datos sensibles pre-fetch en server y por props.
  - Test: `tests/integration/configuracion/usuarios-page.test.tsx` — "rol no autorizado no ve el modulo (R3)", "pre-carga el listado del maestro (R13)".

## Bloque 5 — Cierre

- **T12** — Documentar el mapa `R<n> → test` en `progress/impl_gestion-usuarios.md`;
  correr `./init.sh` y la suite de tests en verde.
  - Cubre: trazabilidad (todos los R1–R36). Dep: T1–T11.
  - Hecho: init verde, todos los tests pasan, cada R mapeado a ≥1 test.

---

### Cobertura R → task/test (resumen)
R1:T6/T7/T11 · R2:T7 · R3:T6/T11 · R4:T6 · R5:T2/T7/T9 · R6:T2/T7 · R7:T6 · R8:T6 ·
R9:T6 · R10:T6 · R11:T6 · R12:T6 · R13:T1/T4/T7/T11 · R14:T4/T8 · R15:T2/T4 ·
R16:T2/T4/T6/T9 · R17:T4/T6 · R18:T4/T6 · R19:T4/T6 · R20:T4/T6/T10 · R21:T4/T6/T10 ·
R22:T4/T6 · R23:T2/T6/T7 · R24:T4/T5/T6 · R25:T6 · R26:T8/T10 · R27:T10 · R28:T7/T10 ·
R29:T4/T9 · R30:T2/T6 · R31:T2/T6 · R32:T2b/T6 · R33:T6/T7/T9 · R34:T2b/T6 ·
R35:T6 · R36:T9/T10.
