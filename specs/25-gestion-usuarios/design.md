# Feature 25 — Gestión de usuarios (configuración) · design.md

Referencia de decisiones técnicas. Cubre requisitos R1–R36. Sigue el patrón de capas
Controller (Server Action) → Service → Repository (`docs/architecture.md`) y reusa la
infraestructura existente. **NO requiere tabla nueva ni migración**: usa el modelo
`Usuario` ya existente.

> **Dependencia de la feature 20 (`depends_on: 20`).** La política de contraseña se
> reutiliza de `lib/types/password-policy.ts` (`strongPasswordSchema`), módulo que
> introduce la feature 20 y que NO existe en esta rama hasta que la 20 mergee a `dev`
> (PR #20 abierto). La implementación (F2) de esta feature NO arranca hasta que la 20
> esté en `dev`. La política NO se duplica: se importa.

## 1. Modelo de datos

Se reutiliza tal cual (`db/schema.prisma`):

- `Usuario`: `id, nombre, email @unique, telefono, passwordHash, estado
  (EstadoUsuario @default(pendiente)), cedula @unique, tipoIdentificacionId (FK),
  rolId (FK), createdAt, updatedAt`.
- `enum EstadoUsuario`: `pendiente | activo | inactivo | bloqueado`. La baja lógica
  usa `inactivo` (R20); `bloqueado` reservado a seguridad (Pregunta abierta 5).
- `TipoIdentificacion { id, value @unique }` (seed: cedula/ruc/pasaporte).
- `Rol { id, value: RolValue @unique }`, `RolValue = maestro | admin | mensajero |
  adminTienda | adminSatelite`.

**Decisión:** el usuario creado por el maestro nace `activo` (R8) pasando
`estado: "activo"` explícito en `CreateUsuarioInput.estado` (el default del modelo es
`pendiente`, pensado para la postulación pública feature 21). Sin migración: el campo
`estado` ya existe y admite `activo`. La baja/alta manual usa `inactivo`/`activo`;
`bloqueado` no lo toca este módulo (R20/R21, Decisión 6).

**RLS:** el modelo Usuario ya existía (features 1/6); esta feature no crea tablas ni
altera el esquema, por lo que no introduce nuevas políticas RLS. La autorización se
aplica en el Service por rol (R3). *(Si el reviewer exige RLS sobre `usuario` y hoy
falta, es un gap preexistente fuera del alcance de esta feature — se anota, no se
resuelve aquí.)*

## 2. Capas y archivos nuevos

### Repository — extender `UserRepository` / `IUserRepository`
Se **añaden** métodos (reusando `PUBLIC_SELECT`, `mapDuplicadoError`,
`CatalogoInvalidoError`, `UsuarioDuplicadoError` ya presentes):

- `list(params: ListUsuariosParams): Promise<ListUsuariosResult>` — paginado, patrón
  `OrdenRepository.list`: `{ where?, skip, take, sortBy?, sortDir? }` → `{ items, total }`.
  El item de listado incluye el `value` del rol (include `rol: { select: { value }}`)
  para R14. Nunca proyecta `passwordHash`.
- `count(where?): Promise<number>` — soporta el `total` del listado (o se deriva de
  `list`; se declara explícito por trazabilidad).
- `update(id, data: UpdateUsuarioData): Promise<UsuarioPublico | null>` — aplica solo
  campos permitidos (R16); valida catálogos por FK (reusa el patrón `create`) y
  devuelve `null` si el id no existe. Reusa `mapDuplicadoError` (no aplica a los
  campos editables por defecto, pero se mantiene por consistencia).
- `setEstado(id, estado: EstadoUsuario): Promise<UsuarioPublico | null>` — cambia solo
  el estado (R20/R21); `null` si no existe.
- `listTiposIdentificacion(): Promise<{ id: string; value: string }[]>` — **a crear**:
  hoy NO existe repo/acción que liste `tipo_identificacion` (verificado: solo hay seed
  y su uso como FK). Necesario para poblar el select del formulario (R29).

Se extiende la interfaz `IUserRepository` con las firmas anteriores. `UserPrismaClient`
ya incluye `usuario`, `tipoIdentificacion`, `rol`.

### Service — nuevo `lib/services/UsuarioService.ts` (+ interfaz)
**No existe `UserService`** → se crea `UsuarioService` implementando
`IUsuarioService` (nuevo, `lib/interfaces/services/IUsuarioService.ts`), patrón de
`CobroService`/`OrdenService`:

- Reusa el tipo `Actor` de `IOrdenService` (`{ usuarioId, rol }`).
- Autorización (Decisión 1): única constante `ALLOWED_ROLES = { maestro }` para lectura
  y escritura. Rol distinto de `maestro` → `forbidden` (R3/R4).
- Métodos: `crear`, `listar`, `obtener`, `actualizar`, `cambiarEstado`,
  `listarTiposIdentificacion`. Cada uno chequea autorización ANTES de tocar datos.
- `crear`: resuelve la contraseña según el modo (R30):
  - modo **manual**: usa la contraseña del input (ya validada contra
    `strongPasswordSchema` en el borde, R31); NO devuelve texto plano (R35).
  - modo **autogenerado**: llama a `generateStrongPassword()` (util nuevo, ver §2 bis),
    que produce una contraseña que pasa `strongPasswordSchema` (R32); tras crear,
    devuelve esa contraseña UNA vez en el result (`{ generatedPassword }`, R33) para que
    el maestro la comunique.
  - en ambos: hashea con `hashPassword` (R7/R34), fija `estado: "activo"` (R8), delega a
    `repo.create`, traduce `CatalogoInvalidoError`/`UsuarioDuplicadoError` a resultados
    de dominio (`validation_error` / `conflict` con campo). Nunca loguea la contraseña.
- Resultados discriminados tipados (`{ status: "ok" | "forbidden" | "not_found" |
  "validation_error" | "conflict"; ... }`), como `CobroService`.

### Util nuevo — `lib/utils/password-generator.ts` (§2 bis)
- `generateStrongPassword(): string` — genera una contraseña que CUMPLE
  `strongPasswordSchema` (R32): longitud dentro de [8,72], garantizando al menos una
  mayúscula, una minúscula, un dígito y un símbolo del conjunto permitido por la
  política de la feature 20. Usa `crypto.randomInt`/`randomBytes` (aleatoriedad
  criptográfica), baraja las posiciones para no fijar el orden de las clases, y
  **valida su propia salida** contra `strongPasswordSchema` antes de devolver (invariante
  auto-verificable). Sin efectos secundarios, no loguea (R34).
- Importa `strongPasswordSchema` de `lib/types/password-policy.ts` (feature 20). Si el
  conjunto de símbolos de la política cambia, el generador se alinea a ese contrato.

### Tipos + zod — nuevo `lib/types/usuario.ts`
- Importa `strongPasswordSchema` de `lib/types/password-policy.ts` (feature 20) — NO se
  redefine la política (Decisión 3).
- `crearUsuarioSchema` (strict): `nombre` (min1), `email` (email), `telefono` (min1),
  `tipoIdentificacionId` (min1), `cedula` (min1), `rolId` (min1), y el bloque de
  contraseña como **unión discriminada por `passwordMode`** (R30):
  - `{ passwordMode: "manual", password: strongPasswordSchema }` (R31)
  - `{ passwordMode: "generate" }` (sin `password`; el service la genera, R32)
- `actualizarUsuarioSchema` (strict, partial de los campos EDITABLES: `nombre`,
  `telefono`, `rolId`, `tipoIdentificacionId`) — NO admite `email`/`cedula`/`password`.
- `cambiarEstadoUsuarioSchema`: `estado: z.nativeEnum(EstadoUsuario)` acotado a
  `activo | inactivo` (R23).
- `listarUsuariosSchema`: `page`, `pageSize` (clamp a `MAX_PAGE_SIZE`), `sortBy`,
  `sortDir` (lista blanca).
- `UsuarioListItemDTO` (id, nombre, email, rolValue, estado, createdAt) y reuso de
  `UsuarioPublico`. `ActionError` discriminado (validation_error | unauthenticated |
  forbidden | not_found | conflict). Config en `lib/config/usuarios.ts`
  (DEFAULT_PAGE_SIZE / MAX_PAGE_SIZE), patrón `lib/config/cobros.ts`.

### Server Actions — nuevo `lib/actions/usuarios.ts`
`'use server'`, patrón de `lib/actions/cobros.ts`: `withErrorHandler` + `toActionError`
+ `resolveActorFromSession` (inyectable en tests vía `deps.getActor`). Acciones:
`crearUsuario`, `listarUsuarios`, `obtenerUsuario`, `actualizarUsuario`,
`cambiarEstadoUsuario`, `listarTiposIdentificacion`. Validación en el borde con los
schemas zod; el service inyectable vía `deps.usuarioService` para tests.

### Frontend — `app/(app)/configuracion/`
- `page.tsx` (Server Component): valida rol autorizado vía `resolveActorFromSession`;
  si no autorizado, no renderiza el módulo. Pre-fetch inicial del listado (datos
  sensibles → server, `docs/architecture.md`) y pasa por props a un módulo cliente.
- `_components/UsuariosModule.tsx` (client): `DataTable` + `Pagination` (R26), botón
  "Crear", `Modal` con formulario crear/editar (R27), acción activar/inactivar por
  fila, `useToast` para feedback (R28). Columnas: nombre, email, rol, estado, acciones.
- `_components/usuarios-columns.tsx`: definición de columnas (id/value/render) para el
  DataTable, patrón `ordenes-columns`.
- `_components/UsuarioForm.tsx`: formulario con selects de rol (`ROLES_SEED`) y tipo
  de documento (acción `listarTiposIdentificacion`), inputs `components/ui/*`. Incluye
  el toggle de modo de contraseña (escribir / generar, R36): en modo generar oculta el
  input de contraseña; tras crear con éxito, muestra `generatedPassword` una sola vez
  con botón "copiar" y aviso de que no se volverá a mostrar (R33). Rol `mensajero` por
  esta vía pide solo el set base (R29, Decisión 2).

## 3. Contratos I/O (resumen)

- `crearUsuario(input)` → `{ status:"ok", usuario: UsuarioPublico, generatedPassword?:
  string }` | ActionError. `generatedPassword` SOLO presente en modo autogenerado (R33),
  nunca en modo manual (R35) ni en ninguna otra acción.
- `listarUsuarios({page,pageSize,sortBy,sortDir})` → `{ status:"ok", items:
  UsuarioListItemDTO[], page, pageSize, total }` | ActionError.
- `obtenerUsuario(id)` → `{ status:"ok", usuario: UsuarioPublico }` | ActionError.
- `actualizarUsuario(id, input)` → `{ status:"ok", usuario: UsuarioPublico }` | ActionError.
- `cambiarEstadoUsuario(id, {estado})` → `{ status:"ok", usuario: UsuarioPublico }` | ActionError.
- `listarTiposIdentificacion()` → `{ status:"ok", tipos: {id,value}[] }` | ActionError.

Ningún DTO expone `passwordHash` (R12/R19/R24).

## 4. Integraciones
Ninguna externa. Reusa: `hashPassword` (`lib/utils/password.ts`), manejador de errores
global (`lib/errors`, `toActionError`), DataTable/Pagination/Modal (`components/shared`),
`useToast` (`hooks/useToast.ts`), `ROLES_SEED` (`lib/types/roles.ts`).

## 5. Alternativas descartadas

- **A1. Crear un `UserService` genérico que también absorba `AuthService`/login.**
  Descartada: el login (feature 1) y su verificación de credenciales ya viven en
  `AuthService` con su propia responsabilidad y el único acceso al hash
  (`findByEmailWithHash`). Meter el CRUD de configuración ahí acoplaría dos dominios
  distintos y arriesgaría exponer el hash. Se crea un `UsuarioService` separado que
  solo maneja el CRUD administrativo, dejando `AuthService` intacto.

- **A2. Borrado físico + tabla de auditoría para las bajas.** Descartada: la
  descripción y `EstadoUsuario` ya modelan la baja como lógica (`inactivo`). Borrar
  físicamente rompería relaciones (órdenes, sesiones, intentos de login) y perdería
  trazabilidad. Se usa cambio de estado (R20), sin migración.

- **A3. Definir una política de contraseña propia mínima (min 8/máx 72) para no
  depender de la feature 20.** Descartada por decisión del humano (Decisión 3): se
  reutiliza `strongPasswordSchema` de la feature 20 para no duplicar ni divergir la
  política. El coste es una dependencia de merge (`depends_on: 20`): la implementación
  no arranca hasta que la 20 esté en `dev`. Se asume ese coste a cambio de una única
  fuente de verdad de la política de contraseñas.

- **A6. Guardar la contraseña autogenerada para poder mostrarla de nuevo (o enviarla
  por email).** Descartada: violaría R34 (solo se persiste el hash) y el principio de
  no exponer secretos. La contraseña autogenerada se muestra UNA sola vez en la
  respuesta de creación (R33) y se descarta en memoria; si se pierde, el flujo correcto
  es un reset futuro (fuera de alcance, Decisión 5).

- **A4. Endpoint REST (`app/api/usuarios`) para el CRUD.** Descartada: son mutaciones
  internas del propio proyecto; `docs/architecture.md` manda Server Actions para eso y
  reserva route handlers para webhooks/API pública. Se usan Server Actions.

- **A5. Añadir `estado` como campo editable dentro del `actualizarUsuario`.**
  Descartada: mezcla la baja/alta lógica (acción con semántica propia y auditable) con
  la edición de datos. Se separa en `cambiarEstadoUsuario` para claridad y para acotar
  qué toca cada operación (R16 vs R20/R21).
