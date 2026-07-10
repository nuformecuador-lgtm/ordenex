# Feature 22 — Aprobación de postulaciones de mensajeros — requirements.md

> Alcance: BACKEND puro (sin UI; la consume el dashboard de la feature 23).
> Depende de la feature 21 (crea las postulaciones: `Usuario` rol `mensajero`
> estado `pendiente` + 5 `MensajeroDocumento` en bucket privado).
> No modifica la postulación (feature 21) ni otros roles.

Notación EARS. Cada requisito es verificable con un test (ver trazabilidad en `design.md`).

## Autorización

- **R1** — El sistema DEBE exponer las operaciones de listar postulaciones
  pendientes, aprobar una postulación y rechazar una postulación únicamente a
  través de Server Actions internas (no rutas API públicas).

- **R2** — SI el actor que invoca cualquiera de las tres operaciones tiene rol
  `maestro` o `admin`, ENTONCES el sistema DEBE permitir la operación (sujeto al
  resto de reglas de negocio).

- **R3** — SI el actor que invoca cualquiera de las tres operaciones tiene rol
  `mensajero`, `adminTienda` o `adminSatelite`, ENTONCES el sistema DEBE
  responder `forbidden` y NO DEBE leer datos de postulaciones ni modificar
  ningún estado.

- **R4** — SI no existe una sesión válida al invocar cualquiera de las tres
  operaciones, ENTONCES el sistema DEBE responder `unauthenticated` y NO DEBE
  ejecutar lógica de negocio.

- **R5** — El sistema DEBE evaluar la autenticación (R4) y luego la autorización
  por rol (R2/R3) ANTES de acceder a la capa de datos o de Storage en cualquiera
  de las tres operaciones.

## Listar postulaciones pendientes

- **R6** — CUANDO un actor autorizado (R2) solicita la lista de postulaciones
  pendientes, el sistema DEBE devolver únicamente los usuarios con rol
  `mensajero` y estado `pendiente`.

- **R7** — CUANDO el sistema devuelve una postulación pendiente, DEBE incluir sus
  datos de identidad y contacto: nombre, primer apellido, segundo apellido,
  email, teléfono, tipo de identificación (valor del catálogo), número de
  identificación (cédula), vehículo (valor del catálogo) y placa.

- **R8** — CUANDO el sistema devuelve una postulación pendiente, DEBE incluir sus
  5 documentos (`cedula_anverso`, `cedula_reverso`, `propiedad_anverso`,
  `propiedad_reverso`, `foto_rostro`), cada uno con una URL firmada temporal que
  permita visualizar el binario alojado en el bucket privado.

- **R9** — El sistema DEBE generar las URL firmadas de los documentos con una
  expiración finita y configurable, sin exponer nunca el binario mediante una URL
  pública permanente.

- **R10** — CUANDO un actor autorizado solicita la lista, el sistema DEBE aceptar
  parámetros de paginación (página y tamaño de página, acotado a un máximo) y
  DEBE devolver los ítems de esa página junto con el total de postulaciones
  pendientes.

- **R11** — MIENTRAS no existan usuarios con rol `mensajero` y estado
  `pendiente`, el sistema DEBE devolver una lista vacía con total `0` (no un
  error).

## Aprobar una postulación

- **R12** — CUANDO un actor autorizado aprueba una postulación cuyo usuario tiene
  rol `mensajero` y estado `pendiente`, el sistema DEBE cambiar el estado de ese
  usuario de `pendiente` a `activo`.

- **R13** — SI el identificador de la postulación a aprobar no corresponde a un
  usuario con rol `mensajero`, ENTONCES el sistema DEBE responder `not_found` y
  NO DEBE modificar ningún estado.

- **R14** — SI el usuario objetivo de la aprobación existe y es `mensajero` pero
  su estado NO es `pendiente`, ENTONCES el sistema DEBE responder `conflict` y NO
  DEBE modificar su estado.

- **R15** — CUANDO el sistema aprueba una postulación, DEBE modificar únicamente
  el campo `estado` del usuario y NO DEBE alterar sus demás datos ni sus
  documentos.

## Rechazar una postulación

- **R16** — CUANDO un actor autorizado rechaza una postulación cuyo usuario tiene
  rol `mensajero` y estado `pendiente`, el sistema DEBE cambiar el estado de ese
  usuario de `pendiente` a `inactivo` (estado resultante propuesto; ver
  "Preguntas abiertas" P1), dejando la cuenta sin habilitar.

- **R17** — SI el identificador de la postulación a rechazar no corresponde a un
  usuario con rol `mensajero`, ENTONCES el sistema DEBE responder `not_found` y
  NO DEBE modificar ningún estado.

- **R18** — SI el usuario objetivo del rechazo existe y es `mensajero` pero su
  estado NO es `pendiente`, ENTONCES el sistema DEBE responder `conflict` y NO
  DEBE modificar su estado.

- **R19** — CUANDO el sistema rechaza una postulación, DEBE modificar únicamente
  el campo `estado` del usuario y NO DEBE eliminar la cuenta ni sus documentos.

## Contrato e integridad

- **R20** — El sistema DEBE devolver resultados de dominio discriminados por
  `status` (`ok`, `forbidden`, `unauthenticated`, `not_found`, `conflict`,
  `validation_error`), traducidos por el borde (Server Action) al contrato
  tipado que consume la UI, reutilizando el manejador de errores global
  (feature 10).

- **R21** — SI el identificador recibido para aprobar o rechazar es inválido
  (vacío o mal formado), ENTONCES el sistema DEBE responder `validation_error`
  sin acceder a la capa de datos.

## Preguntas abiertas (para la puerta de aprobación humana F1.4)

- **P1 — Estado resultante del RECHAZO.** El enum `EstadoUsuario` actual tiene
  `pendiente | activo | inactivo | bloqueado`. Propuesta firme: **`inactivo`**
  (reusar valor existente → sin migración de enum; semántica "cuenta sin
  habilitar" encaja). Alternativas: `bloqueado` (connota bloqueo por
  seguridad/fallos, no un rechazo administrativo) o un valor NUEVO `rechazado`
  (semánticamente exacto pero implica migración del enum Postgres `estado_usuario`
  + `down.sql` + backfill → más costo y riesgo). Decidir en F1.4. El diseño
  y los tests se escriben contra `inactivo`; cambiarlo es un ajuste local.

- **P2 — Motivo de rechazo.** El `feature_list` NO pide guardar un motivo de
  rechazo. Propuesta: **no persistir motivo en esta feature** (evita columna y
  migración nuevas). Si negocio lo requiere, sería una columna nullable
  `motivo_rechazo` en `usuario` (o tabla de auditoría aparte) → feature/iteración
  posterior. Confirmar en F1.4 si basta sin motivo.

- **P3 — Expiración de la URL firmada.** Propuesta: valor configurable por env
  con default (p. ej. 300 s). Confirmar el default aceptable para el flujo de
  revisión del maestro en el dashboard (feature 23).

- **P4 — Auditoría de la decisión.** ¿Se requiere registrar quién aprobó/rechazó
  y cuándo (columnas `revisado_por`/`revisado_en` o log)? No lo pide el
  `feature_list`. Propuesta: fuera de alcance en F22; marcar como posible
  siguiente feature. Confirmar en F1.4.
