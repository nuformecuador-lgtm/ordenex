# Feature 25 — Gestión de usuarios (configuración) · requirements.md

Zone: fullstack · complexity: medium · depends_on: 20 · branch: feature/25-gestion-usuarios

> Decisiones de la puerta F1.4 fijadas (humano, 2026-07-10). Ver "Decisiones firmes"
> al final. No quedan preguntas abiertas.

Módulo de gestión de usuarios dentro de `app/(app)/configuracion` para que el admin
**maestro** haga CRUD de usuarios: crear, listar, editar y activar/inactivar.
Reusa el modelo `Usuario` existente (sin tabla nueva ni migración), `hashPassword`
(bcrypt), el manejador de errores global del backend, y en frontend DataTable +
Pagination, Modal y Toast.

Notación EARS. Cada requisito es testeable. Los términos "rol autorizado" y "actor"
se resuelven vía `resolveActorFromSession` → `{ usuarioId, rol }` (patrón feature 6/18).

## Autenticación y autorización

- **R1** — El sistema DEBE resolver el actor autenticado antes de ejecutar cualquier
  operación de gestión de usuarios (crear, listar, obtener, editar, activar/inactivar).
- **R2** — SI no hay una sesión válida, ENTONCES el sistema DEBE responder
  `unauthenticated` y NO ejecutar ninguna operación de datos.
- **R3** — SI el rol del actor NO es `maestro`, ENTONCES el sistema DEBE responder
  `forbidden` para toda operación (crear, listar, obtener, editar, activar/inactivar).
  Solo `maestro` tiene acceso de lectura y escritura; `admin` y cualquier otro rol →
  `forbidden` (Decisión 1).
- **R4** — El sistema DEBE tratar cualquier valor de rol distinto de `maestro`
  (incluido un rol no reconocido) como no autorizado (`forbidden`), nunca como acceso
  permitido por defecto.

## Crear usuario

- **R5** — CUANDO un actor autorizado envía una solicitud de creación, el sistema
  DEBE validar en el borde (zod) los campos: `nombre`, `email`, `telefono`,
  `tipoIdentificacionId`, `cedula` (número de documento), `rolId` y `password`,
  y responder `validation_error` con `fieldErrors` por campo si alguno es inválido.
- **R6** — El sistema DEBE validar que el `email` tenga formato de correo y que la
  contraseña (escrita o autogenerada) cumpla la política fuerte `strongPasswordSchema`
  de la feature 20 (`lib/types/password-policy.ts`: min 8 / máx 72 caracteres +
  mayúscula + minúscula + dígito + símbolo). Esta política NO se duplica: se importa de
  ese módulo (Decisión 3; dependencia de la feature 20).
- **R7** — CUANDO un actor autorizado crea un usuario con datos válidos, el sistema
  DEBE persistir la contraseña únicamente como hash bcrypt (mismo coste que el login)
  y NUNCA en texto plano.
- **R8** — CUANDO un actor autorizado crea un usuario con datos válidos, el sistema
  DEBE dejar el usuario en estado `activo` (a diferencia de la postulación pública,
  que nace `pendiente`).
- **R9** — SI el `tipoIdentificacionId` o el `rolId` enviados no existen en su
  catálogo, ENTONCES el sistema DEBE responder un error de catálogo inválido
  identificando el campo (reusa `CatalogoInvalidoError`), sin crear el usuario.
- **R10** — SI el `email` ya está en uso por otro usuario, ENTONCES el sistema DEBE
  responder conflicto de unicidad identificando el campo `email` (reusa
  `UsuarioDuplicadoError`), sin crear el usuario.
- **R11** — SI la `cedula` (número de documento) ya está en uso por otro usuario,
  ENTONCES el sistema DEBE responder conflicto de unicidad identificando el campo
  `cedula`, sin crear el usuario.
- **R12** — CUANDO la creación es exitosa, el sistema DEBE devolver el usuario creado
  en su forma pública (`UsuarioPublico`), que NUNCA incluye `passwordHash`.

## Contraseña inicial: escrita o autogenerada

Aplica a la creación de cualquier usuario (cualquier rol), no solo mensajero.

- **R30** — CUANDO el maestro crea un usuario, el sistema DEBE aceptar dos modos para
  la contraseña inicial: (a) **manual**, escrita por el maestro; o (b) **autogenerada**
  por el sistema. La solicitud DEBE indicar el modo de forma inequívoca.
- **R31** — SI el modo es manual, ENTONCES el sistema DEBE validar la contraseña
  escrita contra `strongPasswordSchema` (R6) y responder `validation_error` si no la
  cumple.
- **R32** — SI el modo es autogenerado, ENTONCES el sistema DEBE generar una
  contraseña que CUMPLA `strongPasswordSchema` (R6) sin requerir que el maestro la
  escriba.
- **R33** — CUANDO la contraseña es autogenerada y la creación es exitosa, el sistema
  DEBE devolver la contraseña en texto plano UNA sola vez (en la respuesta de creación)
  para que el maestro la comunique al usuario, y NO DEBE volver a exponerla en ninguna
  consulta posterior (listar/obtener/editar).
- **R34** — El sistema DEBE persistir únicamente el hash bcrypt de la contraseña
  autogenerada (R7); NUNCA DEBE persistir ni registrar (log) la contraseña
  autogenerada en texto plano.
- **R35** — SI el modo es manual, ENTONCES el sistema NUNCA DEBE devolver la contraseña
  en texto plano en ninguna respuesta (el maestro ya la conoce).

## Listar usuarios

- **R13** — CUANDO un actor autorizado solicita el listado, el sistema DEBE devolver
  los usuarios paginados (`page`, `pageSize`, `total`), acotando `pageSize` a un máximo
  configurado.
- **R14** — El sistema DEBE incluir en cada fila del listado, como mínimo, `nombre`,
  `email`, `rol` (value legible) y `estado`, y NUNCA `passwordHash`.
- **R15** — El sistema DEBE permitir ordenar el listado por al menos una columna
  (por defecto `createdAt`), usando una lista blanca de columnas ordenables.

## Editar usuario

- **R16** — CUANDO un actor autorizado edita un usuario existente, el sistema DEBE
  aplicar únicamente los campos permitidos `nombre`, `telefono`, `rolId`,
  `tipoIdentificacionId` (Decisión 4) y NO modificar `id`, `email`, `cedula`,
  `passwordHash` ni `createdAt`. El reset de contraseña desde la edición queda FUERA
  de alcance.
- **R17** — SI se intenta editar un usuario que no existe, ENTONCES el sistema DEBE
  responder `not_found` sin efectos.
- **R18** — SI el `rolId` o `tipoIdentificacionId` provistos en la edición no existen
  en su catálogo, ENTONCES el sistema DEBE responder error de catálogo inválido, sin
  aplicar cambios.
- **R19** — CUANDO la edición es exitosa, el sistema DEBE devolver el usuario
  actualizado en su forma pública, sin `passwordHash`.

## Activar / Inactivar (baja lógica)

- **R20** — CUANDO un actor autorizado inactiva un usuario existente, el sistema DEBE
  cambiar su `estado` a `inactivo` (baja lógica) y NUNCA borrar físicamente la fila.
  `bloqueado` queda reservado a seguridad y NO lo usa este módulo (Decisión 5).
- **R21** — CUANDO un actor autorizado activa un usuario existente, el sistema DEBE
  cambiar su `estado` a `activo`.
- **R22** — SI se intenta activar/inactivar un usuario que no existe, ENTONCES el
  sistema DEBE responder `not_found` sin efectos.
- **R23** — El sistema DEBE aceptar únicamente valores del enum `EstadoUsuario` como
  destino del cambio de estado; cualquier otro valor DEBE producir `validation_error`.

## No exposición de datos sensibles

- **R24** — El sistema DEBE garantizar que ningún DTO de salida (crear, listar,
  obtener, editar, cambiar estado) contenga `passwordHash`.
- **R25** — El sistema NUNCA DEBE registrar (log) la contraseña en texto plano ni el
  hash en ninguna capa.

## Reuso de infraestructura (frontend)

- **R26** — El sistema DEBE presentar el listado de usuarios reutilizando el
  componente `DataTable` + `Pagination` existentes, sin duplicar su lógica.
- **R27** — El sistema DEBE presentar la creación y edición de usuario en el
  componente `Modal` existente (con estado async: spinner y botón bloqueado durante
  el guardado), sin duplicarlo.
- **R28** — El sistema DEBE dar feedback de éxito/error mediante `useToast` (Toast
  existente), tomando el mensaje del manejador de errores global del backend, sin
  reimplementar mensajes por switch/case.
- **R29** — El formulario de creación DEBE poblar el select de rol desde
  `ROLES_SEED`/`RolValue` y el select de tipo de documento desde el catálogo
  `tipo_identificacion` (método/acción de listado a crear, ver tasks). Al crear un
  usuario con rol `mensajero` por esta vía se pide SOLO el set base (nombre, email,
  telefono, tipoDoc, cedula, rol, contraseña); NO se piden los campos extra de la
  feature 21 (vehículo/placa/documentos) (Decisión 2).

- **R36** — El formulario de creación DEBE ofrecer al maestro elegir entre escribir la
  contraseña o generarla automáticamente (R30); en modo autogenerado DEBE mostrar la
  contraseña resultante una sola vez (R33), con acción para copiarla, y advertir que
  no volverá a mostrarse.

## Trazabilidad

Cada `R<n>` se mapea a un test concreto en `tasks.md`.

---

## Decisiones firmes (puerta F1.4 — humano, 2026-07-10)

1. **Autorización:** solo `maestro` (lectura Y escritura del módulo). `admin` y
   cualquier otro rol → `forbidden`. (R3, R4)
2. **Crear mensajero por esta vía:** solo el set base; NADA de campos extra de la
   feature 21. (R29)
3. **Política de contraseña:** se reutiliza `strongPasswordSchema` de la feature 20
   (`lib/types/password-policy.ts`), tanto para la contraseña escrita como para la
   autogenerada. NO se duplica la política. Esto crea **dependencia de la feature 20**
   (`depends_on: 20`); la implementación (F2) no arranca hasta que la 20 esté en `dev`.
   (R6, R31, R32)
4. **Nueva funcionalidad — contraseña escrita o autogenerada:** la contraseña inicial
   puede escribirse o autogenerarse; la autogenerada cumple la política fuerte, se
   muestra una sola vez al maestro y solo se guarda el hash. (R30–R36)
5. **Campos editables:** editable = `nombre`, `telefono`, `rolId`,
   `tipoIdentificacionId`; NO editable = `email`, `cedula`. Reset de contraseña desde
   edición: FUERA de alcance. (R16)
6. **Baja lógica:** `inactivo` para baja/activación manual del maestro; `bloqueado`
   reservado a seguridad, no lo usa este módulo. (R20, R21)

## Preguntas abiertas

Ninguna pendiente.
