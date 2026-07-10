# Feature 21 — Postulación de mensajero · requirements.md

Registro PÚBLICO (postulación) de mensajeros: única vía de auto-registro del
sistema. El aspirante completa un formulario y sube 5 documentos. Al enviar se
crea una cuenta con rol `mensajero` en estado `pendiente` (default de
`EstadoUsuario`), SIN acceso hasta ser aprobada. La aprobación es la feature 22 y
NO se implementa aquí.

Notación EARS. Cada `R<n>` es verificable y mapeable a un test (ver `design.md`
§ Trazabilidad). Ámbito confirmado contra `db/schema.prisma`: `usuario` usa `email`
y `cedula` como únicos; `nombre` NO es único; `estado` default `pendiente`; el
login/hash reutilizable vive en `lib/utils/password.ts` (bcrypt, coste 10).

## Acceso y estructura del formulario

- **R1** — El sistema DEBE exponer una página pública de postulación de mensajero
  accesible sin sesión ni cookie de autenticación.

- **R2** — El sistema DEBE aceptar en el formulario de postulación los campos:
  `nombre`, `primer_apellido`, `segundo_apellido` (opcional), `email`, `telefono`,
  `tipo_identificacion_id`, número de documento (`cedula`), `vehiculo_id`, `placa`,
  `password` y `confirmacion_password`.

- **R3** — El sistema DEBE aceptar exactamente 5 archivos de documento:
  `cedula_anverso`, `cedula_reverso`, `propiedad_anverso`, `propiedad_reverso` y
  `foto_rostro`.

## Validación de entrada (borde, zod)

- **R4** — SI falta cualquiera de los campos obligatorios de R2 (todos salvo
  `segundo_apellido`), ENTONCES el sistema DEBE rechazar la postulación con un
  error de validación por campo y NO DEBE crear ninguna cuenta.

- **R5** — SI `email` no tiene formato de correo válido, ENTONCES el sistema DEBE
  rechazar la postulación con error en el campo `email`.

- **R6** — El sistema DEBE validar que `password` cumpla la política mínima de
  longitud y no exceda 72 caracteres (`MAX_PASSWORD_LENGTH`, reutilizado del
  login).

- **R7** — SI `password` y `confirmacion_password` no coinciden, ENTONCES el
  sistema DEBE rechazar la postulación con error de validación y NO DEBE crear
  ninguna cuenta.

- **R8** — El sistema DEBE validar que `cedula` (número de documento) y `telefono`
  contengan solo dígitos y respeten la longitud configurada (reutiliza
  `numericIdentifierSchema` de `lib/types/auth.ts`).

- **R9** — SI `vehiculo_id` no referencia un vehículo existente en `vehiculos`, o
  `tipo_identificacion_id` no referencia un tipo existente, ENTONCES el sistema
  DEBE rechazar la postulación con error de catálogo y NO DEBE crear ninguna
  cuenta.

- **R10** — El sistema DEBE aceptar cada documento solo si es una imagen de tipo
  permitido (jpeg, png o webp) y su tamaño no excede el máximo configurado; SI un
  documento incumple tipo o tamaño, ENTONCES DEBE rechazar la postulación con
  error en ese documento y NO DEBE crear cuenta ni almacenar archivos.

- **R11** — El sistema DEBE requerir `placa` como texto no vacío, normalizada
  (recortada y en mayúsculas) antes de persistir.

## Creación de la cuenta

- **R12** — CUANDO se envía una postulación válida, el sistema DEBE crear un
  `usuario` con rol `mensajero` y `estado = pendiente` (default de
  `EstadoUsuario`, sin sobrescribirlo).

- **R13** — El sistema DEBE persistir `nombre`, `primer_apellido`,
  `segundo_apellido` (o nulo si se omitió), `email`, `telefono`,
  `tipo_identificacion_id`, `cedula`, `vehiculo_id` y `placa` en el registro de
  usuario creado.

- **R14** — El sistema DEBE almacenar la contraseña únicamente como hash bcrypt
  con el mismo coste que el login (`hashPassword` de `lib/utils/password.ts`,
  coste 10) y NUNCA en texto plano.

- **R15** — El sistema DEBE resolver el rol `mensajero` a partir de los datos
  sembrados existentes y NO DEBE crear catálogos (rol, tipo_identificacion,
  vehículos) como efecto de la postulación.

## Documentos

- **R16** — CUANDO se crea la cuenta, el sistema DEBE almacenar los 5 documentos
  en el almacenamiento de archivos y registrar la referencia (path) de cada uno
  asociada al usuario y a su tipo.

- **R17** — El sistema DEBE permitir que el perfil del mensajero referencie la
  `foto_rostro` como imagen de perfil a partir del documento almacenado.

- **R18** — Los documentos almacenados NO DEBEN ser accesibles públicamente; su
  lectura DEBE requerir credenciales de servidor (bucket privado / URL firmada
  bajo demanda).

## Unicidad

- **R19** — SI el `email` ya pertenece a un usuario existente, ENTONCES el sistema
  DEBE rechazar la postulación sin crear la cuenta e informar el conflicto en el
  campo `email`.

- **R20** — SI la `cedula` ya pertenece a un usuario existente, ENTONCES el
  sistema DEBE rechazar la postulación sin crear la cuenta e informar el conflicto
  en el campo `cedula`.

- **R21** — El sistema DEBE garantizar la unicidad de `email` y `cedula` mediante
  constraint único en base de datos, además de la validación de aplicación (R19,
  R20).

## Seguridad y no-acceso

- **R22** — La postulación DEBE ser una operación pública: el sistema NO DEBE
  requerir sesión para ejecutarla y NO DEBE conceder sesión, cookie ni token como
  resultado de crearla.

- **R23** — MIENTRAS el usuario recién creado permanece en `estado = pendiente`,
  el sistema NO DEBE permitirle iniciar sesión (comportamiento existente del
  login para cuentas no `activo`; se verifica, no se reimplementa aquí).

- **R24** — SI ocurre un fallo al almacenar los documentos o al crear el registro,
  ENTONCES el sistema NO DEBE dejar una cuenta parcial ni archivos huérfanos
  (operación atómica con limpieza).

- **R25** — Toda tabla nueva de esta feature DEBE tener Row Level Security
  activado sin políticas para `anon`/`authenticated` (acceso solo por service
  role), coherente con `usuario`/`cobro`.

## Confirmación al aspirante

- **R26** — CUANDO la cuenta se crea con éxito, el sistema DEBE mostrar un mensaje
  de confirmación de que la postulación fue recibida y quedó pendiente de
  aprobación, sin redirigir a ninguna zona autenticada.

---

## Preguntas abiertas (para la puerta F1.4)

- **A1 — Migración/tabla `vehiculos` en la rama.** El modelo `Vehiculo` está en
  `db/schema.prisma`, pero en este worktree NO existe carpeta de migración de
  vehículos en `db/migrations/`. Antes de implementar el FK
  `usuario.vehiculo_id -> vehiculos.id` hay que confirmar que la migración de la
  feature 50 esté presente en `dev` y rebasar. Si no, esta feature debe incluir/
  depender de esa migración.

- **A2 — Almacenamiento de archivos (decisión mayor, sin infra previa).** No hay
  integración de subida de archivos en el repo (solo `lib/supabase/client.ts` con
  service role). `design.md` propone Supabase Storage (bucket privado). Confirmar
  bucket, límites (tipos jpeg/png/webp, tamaño por archivo) y estrategia de URL
  firmada. Alternativa descartada documentada en `design.md`.

- **A3 — Respuesta ante duplicado (¿genérica o específica?).** R19/R20 proponen
  error específico por campo (`email`/`cedula` ya registrado), norma de UX de
  registro. El login/recuperación usan respuestas genéricas para no filtrar
  existencia. Confirmar la postura de seguridad para un formulario de auto-registro
  público.

- **A4 — Endurecimiento de la acción pública (rate-limiting).** El login tiene
  bloqueo por cuenta vía `LoginAttempt`/`RiskEngine`, pero no hay throttle genérico
  por IP reutilizable. Confirmar si la postulación requiere límite por IP/captcha
  en esta feature o se difiere.

- **A5 — Política mínima de contraseña.** El login solo exige `min(1)`. Confirmar
  si la postulación debe imponer una política más fuerte (longitud mínima, etc.)
  o reutilizar la del login.

## Decisiones F1.4 (APROBADAS por el humano, 2026-07-10)

- **A1 — RESUELTO (falsa alarma):** la feature 50 (vehículos) está COMPLETA en `origin/dev`
  (schema + migración `20260710160000_vehiculos/` + `lib/types/vehiculos.ts` + código). El worktree
  f21 nace de `dev`, así que el FK `usuario.vehiculo_id -> vehiculos.id` se crea sin rebase adicional.
- **A2 — Almacenamiento = Supabase Storage (bucket PRIVADO).** Los 5 documentos van a un bucket
  privado; en `Usuario`/perfil se guardan los paths/URLs. Solo imágenes (jpg/png) con límite de tamaño
  (definir en design; descartada la alternativa bytea en DB).
- **A3 — Duplicados = error ESPECÍFICO por campo.** Ante email o número de documento ya registrados,
  responder con error identificando el campo ("este email/cédula ya está registrado"), norma de
  registro (NO la respuesta genérica del login/recuperación).
- **A4 — Rate-limiting = SÍ, incluirlo** en esta feature (acción pública). Diseñar el throttle
  (por IP/email) aquí; no hay uno reutilizable.
- **A5 — Política de contraseña = mínimo 8 caracteres** (más la confirmación), reforzando el `min(1)`
  del login actual.
