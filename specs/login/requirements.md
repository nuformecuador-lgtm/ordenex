# Requisitos — login (RBA)

> Alcance: modelo de datos del usuario, autenticación con evaluación de riesgo
> (RBA), validación de entrada y manejo de credenciales inválidas. La pantalla
> de home del login (UI) es la feature separada `login(home)`; aquí solo se
> especifica el flujo de autenticación y su contrato.

## Modelo de datos

- **R1 (ubicuo):** El sistema DEBE persistir cada usuario con los campos:
  `nombre`, `email`, `telefono`, `contraseña` (hash, nunca en texto plano),
  `estado`, `cedula`, `tipo_identificacion_id`, `rol_id`, `created_at`,
  `updated_at`.
- **R2 (ubicuo):** El sistema DEBE relacionar cada usuario con exactamente un
  registro de catálogo `tipo_identificacion` a través de `tipo_identificacion_id`.
- **R3 (ubicuo):** El sistema DEBE relacionar cada usuario con exactamente un
  registro de catálogo `rol` a través de `rol_id`.
- **R4 (ubicuo):** El sistema DEBE garantizar que el campo `email` sea único
  entre todos los usuarios.
- **R5 (ubicuo):** El sistema DEBE garantizar que el campo `cedula` sea único
  entre todos los usuarios.
- **R6 (ubicuo):** El sistema NUNCA DEBE almacenar la contraseña en texto plano;
  solo su hash.
- **R7 (ubicuo):** El sistema NUNCA DEBE incluir el hash de la contraseña en
  ninguna respuesta (API, Server Action, log).

## Validación de entrada

- **R8 (condicional):** SI el `email` recibido en el intento de login no tiene
  formato de correo válido, ENTONCES el sistema DEBE rechazar la solicitud con
  un error de validación sin consultar la base de datos.
- **R9 (condicional):** SI la `contraseña` recibida está vacía o excede la
  longitud máxima soportada, ENTONCES el sistema DEBE rechazar la solicitud con
  un error de validación antes de evaluar credenciales.
- **R10 (condicional):** SI al crear/actualizar un usuario el `tipo_identificacion_id`
  o el `rol_id` no corresponden a un registro existente en su catálogo,
  ENTONCES el sistema DEBE rechazar la operación con un error de validación.
- **R10a (condicional):** SI al crear/actualizar un usuario la `cedula` o el
  `telefono` contienen caracteres no numéricos o no cumplen la longitud mínima
  y máxima configuradas, ENTONCES el sistema DEBE rechazar la operación con un
  error de validación. La validación es genérica (solo numérico y longitud); NO
  aplica algoritmo de dígito verificador ni formato específico de país.

## Autenticación con credenciales

- **R11 (por evento):** CUANDO se recibe un intento de login con `email` y
  `contraseña`, el sistema DEBE verificar la existencia del usuario y la
  coincidencia de la contraseña contra el hash almacenado.
- **R12 (condicional):** SI el `email` no corresponde a ningún usuario o la
  contraseña no coincide, ENTONCES el sistema DEBE responder con un error
  genérico de "credenciales inválidas" (HTTP 401), sin revelar cuál de los dos
  datos fue incorrecto.
- **R13 (condicional):** SI el usuario encontrado tiene `estado` distinto de
  activo, ENTONCES el sistema DEBE rechazar el login con un error específico de
  cuenta no disponible, incluso si la contraseña es correcta.
- **R14 (por evento):** CUANDO las credenciales son válidas y la cuenta está en
  estado activo, el sistema DEBE proceder a la evaluación de riesgo (RBA) antes
  de conceder la sesión.

## Autenticación basada en riesgo (RBA)

- **R15 (ubicuo):** El sistema DEBE calcular una señal de riesgo por cada
  intento de login exitoso en credenciales, basada como mínimo en: si el
  dispositivo/navegador es reconocido previamente para ese usuario, si la
  dirección IP/red es reconocida previamente para ese usuario, y el conteo de
  intentos fallidos recientes para ese usuario.
- **R16 (por evento):** CUANDO la señal de riesgo calculada es baja (dispositivo
  e IP reconocidos, sin fallos recientes relevantes), el sistema DEBE conceder
  la sesión directamente sin pasos adicionales.
- **R17 (por evento):** CUANDO la señal de riesgo calculada es alta (dispositivo
  nuevo, IP/ubicación no reconocida, o fallos recientes por encima del umbral),
  el sistema DEBE exigir un paso de verificación adicional (OTP enviado por
  **email**) antes de conceder la sesión, en lugar de concederla directamente.
  El canal del MVP es email únicamente; SMS/WhatsApp quedan fuera de alcance
  como extensión futura.
- **R18 (por evento):** CUANDO un intento de login se completa (exitoso o no),
  el sistema DEBE registrar un evento de auditoría con marca de tiempo,
  identificador de usuario (si se resolvió), resultado, e indicadores de riesgo
  usados para la decisión.
- **R19 (por evento):** CUANDO el paso de verificación adicional de RBA (OTP por
  email) se completa correctamente, el sistema DEBE conceder la sesión y DEBE
  marcar el dispositivo/IP como reconocido para futuros intentos del mismo
  usuario.
- **R20 (condicional):** SI el paso de verificación adicional de RBA (OTP por
  email) falla o expira, ENTONCES el sistema NO DEBE conceder la sesión.

## Control de intentos fallidos

- **R21 (por evento):** CUANDO un usuario acumula 5 intentos fallidos
  consecutivos (umbral configurable), el sistema DEBE bloquear temporalmente
  cualquier nuevo intento de login para ese usuario durante 15 minutos
  (duración configurable). Es un rechazo temporal duro, no un challenge: durante
  la ventana de bloqueo el login se rechaza aunque las credenciales sean
  correctas.
- **R21a (por evento):** CUANDO un usuario está dentro de la ventana de bloqueo
  temporal, el sistema DEBE responder con un error de cuenta bloqueada
  temporalmente sin evaluar credenciales ni riesgo.
- **R22 (por evento):** CUANDO un intento de login es exitoso (contraseña
  correcta y, si aplica, verificación adicional superada), el sistema DEBE
  reiniciar el contador de intentos fallidos consecutivos de ese usuario.

## Sesión

- **R23 (por evento):** CUANDO se concede una sesión, el sistema DEBE crear un
  registro en el modelo `Session` existente (`id`, `userId`, `expiresAt`,
  `createdAt`) con expiración a 24 horas, y emitir una cookie httpOnly que
  permita a `middleware.ts` identificar al usuario como autenticado en
  solicitudes subsecuentes. NO se emite refresh token.
- **R23a (condicional):** SI la fecha `expiresAt` de la sesión ya pasó,
  ENTONCES el sistema DEBE tratar la sesión como inválida y no autenticar la
  solicitud.
- **R24 (ubicuo):** El sistema DEBE poder invalidar una sesión activa (logout)
  eliminando su registro `Session`, de forma que solicitudes posteriores con esa
  credencial ya no se traten como autenticadas.

## Decisiones cerradas

Las siguientes decisiones fueron resueltas por el humano y son definitivas para
esta feature:

1. **Canal del challenge RBA (R17):** OTP por email únicamente (MVP).
   SMS/WhatsApp fuera de alcance.
2. **Intentos fallidos (R21):** 5 fallidos consecutivos → bloqueo temporal duro
   de 15 minutos. Umbral y duración configurables por constante/entorno.
3. **Catálogos `tipo_identificacion` y `rol`:** no existían; se crean desde cero
   como tablas de catálogo simples con columnas `id` y `value`. Seed mínima:
   `tipo_identificacion` → (cedula, ruc, pasaporte); `rol` → (admin, usuario).
4. **Validación de `cedula` y `telefono` (R10a):** genérica, solo numérico y
   longitud (min/max configurable). Sin dígito verificador ni formato de país.
5. **Campo `estado` del usuario:** enum de 4 valores → `pendiente` / `activo` /
   `inactivo` / `bloqueado` (pendiente = recién creado sin verificar;
   bloqueado = por seguridad/fallos).
6. **Sesión (R23):** 24 horas, cookie httpOnly simple, sin refresh token,
   reutilizando el modelo `Session` existente en `db/schema.prisma`.

## Preguntas abiertas

Ninguna. Todas las preguntas previas fueron resueltas (ver "Decisiones
cerradas").
