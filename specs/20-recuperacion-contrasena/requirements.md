# Feature 20 — Recuperación de contraseña · requirements.md

> Zona: fullstack · Complejidad: medium · depends_on: null
> Reutiliza la infraestructura OTP por email del login RBA (features 1/2).
> Notación EARS. Cada `R<n>` es testeable y no describe implementación.

## Alcance

Flujo público (no autenticado) que permite a un usuario restablecer su contraseña
mediante un código OTP enviado a su correo. Tres pasos: (1) solicitar por email,
(2) verificar el código recibido, (3) definir una nueva contraseña con confirmación.
No se crea tabla nueva: se reutiliza `EmailOtpChallenge`.

## Requisitos

### Solicitud de recuperación

- **R1** — CUANDO un usuario envía el formulario de "olvidé mi contraseña" con un
  email sintácticamente válido, el sistema DEBE responder con un mensaje genérico de
  confirmación ("si el correo existe, enviamos un código"), sin revelar si la cuenta
  existe.
- **R2** — SI el email corresponde a una cuenta existente, ENTONCES el sistema DEBE
  generar y enviar un código OTP por correo reutilizando la emisión OTP del login
  (`OtpChallengeIssuer`), sin duplicar la lógica de generación/envío.
- **R3** — SI el email NO corresponde a ninguna cuenta, ENTONCES el sistema DEBE NO
  enviar correo alguno y devolver exactamente la misma respuesta genérica que en R1
  (no enumeración de usuarios).
- **R4** — El sistema DEBE persistir únicamente el hash del código OTP en
  `EmailOtpChallenge.code_hash`; nunca el código en claro.

### Verificación del código

- **R5** — CUANDO el usuario envía un código para verificación asociado a su email, el
  sistema DEBE aceptarlo solo si existe un desafío activo (no consumido y no expirado
  según `authConfig.OTP_TTL_MINUTES`) para ese usuario y el código coincide con el hash
  almacenado.
- **R6** — SI el código es incorrecto, no existe desafío activo, o el desafío expiró,
  ENTONCES el sistema DEBE responder con un error genérico que no distinga la causa ni
  revele existencia de la cuenta.

### Nueva contraseña

- **R7** — CUANDO el usuario define la nueva contraseña, el sistema DEBE exigir que la
  contraseña y su confirmación sean idénticas, rechazando el envío si difieren.
- **R8** — El sistema DEBE rechazar toda nueva contraseña que no cumpla la política
  fuerte, mediante un validador reutilizable (schema zod): longitud mínima 8 y máxima 72
  caracteres, y que contenga al menos una mayúscula, una minúscula, un dígito y un
  símbolo. Esta política aplica SOLO a la nueva contraseña del reset; no re-valida las
  contraseñas existentes.
- **R9** — CUANDO el código está verificado y la nueva contraseña es válida, el sistema
  DEBE hashearla con bcrypt reutilizando `hashPassword` (mismo coste que el login) y
  persistir el resultado en `Usuario.password_hash`.
- **R10** — CUANDO el restablecimiento se completa con éxito, el sistema DEBE marcar el
  desafío OTP como consumido (`consumed_at`) para impedir su reutilización.
- **R11** — SI al momento de restablecer el desafío ya fue consumido o expiró, ENTONCES
  el sistema DEBE rechazar la operación con error genérico y NO modificar la contraseña.

### Autorización y endurecimiento

- **R12** — El flujo completo DEBE ser público (no requiere sesión) y estar accesible
  desde la pantalla de login.
- **R13** — El sistema DEBE impedir modificar la contraseña de un usuario sin poseer un
  código OTP válido, activo y emitido para el email de ESE usuario (un OTP de un email
  no puede restablecer la contraseña de otro).
- **R14** — El sistema DEBE NO registrar en logs el código OTP en claro ni la contraseña
  en claro en ninguno de los pasos.
- **R15** — El sistema DEBE reutilizar las constantes de `authConfig`
  (`OTP_TTL_MINUTES` y las que apliquen) sin hardcodear TTL ni umbrales. Las nuevas
  constantes de rate-limit (R19/R20) DEBEN ser configurables por variable de entorno
  siguiendo el patrón de `lib/config/auth.ts`.

### Rate-limit (endurecimiento: TTL + límite ligero, sin lockout de cuenta)

- **R19** — MIENTRAS un email haya originado `RESET_MAX_REQUESTS` solicitudes dentro de la
  ventana `RESET_REQUEST_WINDOW_MINUTES`, el sistema DEBE NO emitir nuevos códigos OTP para
  ese email, conservando la respuesta genérica de R1/R3 (no revela el límite ni la
  existencia).
- **R20** — MIENTRAS un email/IP haya superado `RESET_MAX_VERIFY_ATTEMPTS` intentos de
  verificación dentro de la ventana `RESET_VERIFY_WINDOW_MINUTES`, el sistema DEBE rechazar
  nuevos intentos con el mismo error genérico (`invalid_or_expired`). Este límite DEBE NO
  reutilizar el lockout `MAX_FAILED_ATTEMPTS` del login, DEBE NO escribir en `login_attempt`
  y DEBE NO bloquear la cuenta ni afectar el inicio de sesión.

### Interfaz de usuario

- **R16** — El sistema DEBE presentar tres fases al usuario: (a) ingreso de email,
  (b) ingreso del código, (c) nueva contraseña + confirmación.
- **R17** — CUANDO el restablecimiento se completa con éxito, el sistema DEBE mostrar una
  confirmación y ofrecer navegación de regreso al login.
- **R18** — El sistema DEBE ofrecer un enlace de acceso al flujo desde el formulario de
  login (p. ej. "¿Olvidaste tu contraseña?").

## Preguntas abiertas

Ninguna pendiente. Las cuatro preguntas de la puerta F1.4 fueron resueltas por el humano
y quedan fijadas como decisiones firmes (ver "Decisiones firmes (F1.4)" y `design.md`).

## Decisiones firmes (F1.4)

1. **Ruta:** `app/recuperar-contrasena/` — flujo multi-fase propio (patrón `LoginForm`).
   No se anida bajo `app/login/`.
2. **Política de contraseña (R8):** fuerte — mínimo 8, máximo 72 (límite bcrypt), con al
   menos 1 mayúscula, 1 minúscula, 1 dígito y 1 símbolo. Validador reutilizable (schema
   zod). Aplica solo a la nueva contraseña del reset; no re-valida contraseñas existentes.
3. **`device_hash` / `ip_address` (R- infra):** valores REALES de la request
   (`computeDeviceHash(userAgent)` + IP), igual que el login. No se usa marcador.
4. **Endurecimiento (R19/R20):** TTL (`OTP_TTL_MINUTES`) + rate-limit ligero de solicitudes
   por email/IP y de intentos de verificación, con constantes configurables por env. NO se
   reutiliza el lockout `MAX_FAILED_ATTEMPTS` del login; el reset nunca bloquea la cuenta.

## Consideraciones de seguridad (notas, no requisitos negociables)

- **Timing de R1/R3:** la ruta "email existe" ejecuta bcrypt (hash del OTP) y envío de
  correo; la ruta "no existe" no. Esa diferencia de tiempo puede filtrar existencia. Si
  mitigarlo (trabajo ficticio equivalente) resulta costoso, se marca como mejora futura,
  no bloqueante.
- **Riesgo heredado:** `OtpChallengeIssuer.emitir` contiene `console.log("Codigo OTP
  generado:", code)` (código en claro). Reutilizar esa infra hereda esa fuga. R14 exige
  no loguear el código en claro en ESTE flujo; corregir el log del issuer compartido
  queda fuera del alcance de esta feature y se reporta al leader.
