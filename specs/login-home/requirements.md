# Requisitos — login(home)

> Alcance: pantalla `/login` (UI) que consume el contrato ya implementado en la
> feature `login` (Server Actions `login`, `verifyChallenge`, `logout` en
> `lib/actions/auth.ts`, tipos en `lib/types/auth.ts`). Esta feature NO
> redefine ni modifica el backend de autenticación/RBA; solo construye la
> interfaz que lo invoca. El resultado real de cada `status` de `LoginResult`
> ya está garantizado por la feature `login`; aquí solo se especifica cómo se
> presenta.

## Formulario de login

- **R1 (ubicuo):** El sistema DEBE renderizar en la ruta `/login` un
  formulario con un campo de correo electrónico (`type="email"`) y un campo
  de contraseña (`type="password"`), cada uno con una etiqueta (`<label>`)
  visible y asociada explícitamente al campo.
- **R2 (ubicuo):** El sistema DEBE mostrar en `/login` un botón de envío de
  tipo `submit` con el texto "Iniciar sesión".

## Validación en el cliente

- **R3 (por evento):** CUANDO el usuario intenta enviar el formulario con el
  campo de correo vacío o con un formato que no corresponde a un correo
  válido, el sistema DEBE mostrar un mensaje de error asociado a ese campo y
  DEBE impedir la invocación de la Server Action `login`.
- **R4 (por evento):** CUANDO el usuario intenta enviar el formulario con el
  campo de contraseña vacío, el sistema DEBE mostrar un mensaje de error
  asociado a ese campo y DEBE impedir la invocación de la Server Action
  `login`.
- **R5 (por evento):** CUANDO el correo y la contraseña ingresados superan la
  validación de cliente (R3, R4), el sistema DEBE invocar la Server Action
  `login` con `{ email, password }` exactamente una vez por envío.

## Estados de carga

- **R6 (de estado):** MIENTRAS la invocación a la Server Action `login` (o
  `verifyChallenge`) esté en curso, el sistema DEBE deshabilitar el botón de
  envío correspondiente y DEBE mostrar un indicador visual de carga.
- **R6a (de estado):** MIENTRAS la invocación esté en curso, el sistema DEBE
  impedir un segundo envío concurrente del mismo formulario (no-doble-submit).

## Manejo de resultados de `login`

- **R7 (por evento):** CUANDO `login` devuelve `{ status: "ok" }`, el sistema
  DEBE redirigir al usuario a la ruta indicada por el parámetro de consulta
  `redirect` de la URL actual si está presente y es una ruta interna válida
  (empieza con `/` y no con `//`); en cualquier otro caso, DEBE redirigir a
  `/`.
- **R8 (condicional):** SI `login` devuelve
  `{ status: "invalid_credentials" }`, ENTONCES el sistema DEBE mostrar un
  único mensaje de error genérico (sin indicar si el correo o la contraseña
  fue el dato incorrecto) y DEBE permanecer en `/login` conservando el valor
  ingresado en el campo de correo.
- **R9 (condicional):** SI `login` devuelve
  `{ status: "account_unavailable" }`, ENTONCES el sistema DEBE mostrar un
  mensaje de error distinguible del de R8 que indique que la cuenta no está
  disponible para iniciar sesión.
- **R10 (condicional):** SI `login` devuelve
  `{ status: "account_locked"; retryAfterMinutes }`, ENTONCES el sistema DEBE
  mostrar un mensaje de error que incluya el valor numérico de
  `retryAfterMinutes` recibido, indicando el tiempo restante antes de poder
  reintentar.
- **R11 (condicional):** SI `login` devuelve
  `{ status: "validation_error"; fieldErrors }`, ENTONCES el sistema DEBE
  mostrar, para cada clave presente en `fieldErrors`, el o los mensajes de
  error bajo el campo del formulario correspondiente a esa clave.
- **R12 (por evento):** CUANDO `login` devuelve
  `{ status: "challenge_required"; challengeId }`, el sistema DEBE transicionar
  la pantalla, sin recargar la página, a un estado de verificación que
  presente un campo para introducir un código recibido por correo
  electrónico, conservando el `challengeId` recibido.

## Verificación del challenge (OTP)

- **R13 (ubicuo):** MIENTRAS la pantalla esté en el estado de verificación
  (R12), el sistema DEBE mostrar un campo de código con su etiqueta asociada
  y un botón de envío separado del formulario de credenciales.
- **R14 (por evento):** CUANDO el usuario intenta enviar el código de
  verificación con un valor que no son exactamente 6 dígitos numéricos, el
  sistema DEBE mostrar un mensaje de error asociado a ese campo y DEBE
  impedir la invocación de la Server Action `verifyChallenge`.
- **R15 (por evento):** CUANDO el código de verificación supera la validación
  de cliente (R14), el sistema DEBE invocar la Server Action `verifyChallenge`
  con `{ challengeId, code }`, usando el `challengeId` recibido en R12.
- **R16 (por evento):** CUANDO `verifyChallenge` devuelve
  `{ status: "ok" }`, el sistema DEBE aplicar la misma regla de redirección
  que R7.
- **R17 (condicional):** SI `verifyChallenge` devuelve
  `{ status: "otp_invalid" }`, ENTONCES el sistema DEBE mostrar un mensaje de
  error indicando que el código es inválido o expiró, y DEBE permitir un
  nuevo intento sin abandonar el estado de verificación ni perder el
  `challengeId`.
- **R18 (condicional):** SI `verifyChallenge` devuelve
  `{ status: "validation_error"; fieldErrors }`, ENTONCES el sistema DEBE
  mostrar el error bajo el campo de código, igual que R11.

## Accesibilidad

- **R19 (ubicuo):** Cada campo de entrada del formulario de credenciales y
  del formulario de verificación (correo, contraseña, código) DEBE tener un
  atributo `id` único referenciado por el `htmlFor` de su `<label>`.
- **R20 (ubicuo):** Todo mensaje de error mostrado por R3, R4, R8, R9, R10,
  R11, R14, R17, R18 DEBE anunciarse a tecnologías asistivas (rol `alert` o
  región `aria-live`) y DEBE asociarse a su campo mediante `aria-describedby`
  cuando el error corresponde a un campo específico.
- **R21 (por evento):** CUANDO la pantalla `/login` termina de montarse, el
  sistema DEBE colocar el foco inicial en el campo de correo electrónico.
- **R22 (por evento):** CUANDO se muestra un error de validación de cliente
  tras un intento de envío (R3, R4, R14), el sistema DEBE mover el foco al
  primer campo que contiene un error.
- **R23 (ubicuo):** El formulario de credenciales y el de verificación DEBEN
  ser completamente operables por teclado: orden de tabulación lógico y envío
  disponible mediante la tecla Enter dentro de los campos de texto.

## Sesión ya activa y logout

- **R24 (por evento):** CUANDO un usuario que ya posee una cookie de sesión
  válida navega a `/login`, el sistema DEBE redirigirlo a la home (`/`) sin
  mostrar el formulario de login. La validez de la sesión se resuelve en el
  servidor (no basta la mera presencia de la cookie).
- **R25 (de estado):** MIENTRAS exista una sesión válida del usuario, el
  sistema DEBE mostrar en la home (`app/page.tsx`) un botón "Cerrar sesión";
  y SI no hay sesión válida, ENTONCES ese botón NO DEBE mostrarse.
- **R26 (por evento):** CUANDO el usuario activa el botón "Cerrar sesión", el
  sistema DEBE invocar la Server Action `logout` y, una vez completada, DEBE
  dejar al usuario sin sesión válida, de modo que una navegación posterior a
  una ruta protegida lo redirija a `/login`.

## Distinguibilidad de mensajes de error

- **R27 (ubicuo):** El sistema DEBE presentar un mensaje distinguible por
  cada caso de error (`invalid_credentials`, `account_unavailable`,
  `account_locked`, `otp_invalid`, `validation_error`), de forma que dos
  casos distintos no produzcan un texto idéntico. El contenido textual exacto
  (idioma, tono) queda a criterio de implementación, con la única restricción
  adicional de que el caso `account_locked` DEBE incluir el valor numérico de
  `retryAfterMinutes` (ver R10).

## Decisiones cerradas

Resueltas por el humano el 2026-07-08; definitivas para esta feature:

1. **Logout / home autenticada (R25, R26).** SÍ se añade un botón mínimo
   "Cerrar sesión" en `app/page.tsx`, visible solo cuando hay sesión válida,
   que invoca la Server Action `logout` ya implementada en la feature
   `login`. Su único fin es destrabar la cobertura E2E de login/logout
   (T021 de `specs/login/tasks.md`); no constituye una feature de dashboard.
2. **Redirección de usuarios ya autenticados (R24).** SÍ. Un usuario con
   sesión válida que visita `/login` es redirigido a `/`. Se resuelve
   server-side en `app/login/page.tsx` leyendo la sesión (p. ej.
   `SessionRepository.findValidById`, que ya existe de la feature `login` y
   ejercita la validación de expiración R23a del backend), no en
   `middleware.ts`.
3. **Copy de mensajes de error (R27).** Queda a criterio de implementación;
   el spec solo exige distinguibilidad por caso y que `account_locked`
   muestre los minutos restantes (`retryAfterMinutes`).

## Preguntas abiertas

Ninguna. Las tres preguntas previas fueron resueltas (ver "Decisiones
cerradas").
