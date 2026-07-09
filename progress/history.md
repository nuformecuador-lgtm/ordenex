# Bitácora (append-only)

> Una entrada por feature completada. No se edita lo ya escrito; solo se añade.

<!-- Formato:
## AAAA-MM-DD — <feature>
- Qué se construyó (1-2 líneas).
- Requisitos cubiertos: R1..Rn.
- Decisiones relevantes o deuda dejada.
-->

## 2026-07-08 — login (flujo RBA + modelo de datos)
- Backend del login con autenticación basada en riesgo: modelo `Usuario` (nombre,
  email, telefono, password_hash, estado, cedula, tipo_identificacion_id, rol_id,
  created_at, updated_at), catálogos `tipo_identificacion`/`rol` (id+value con seed),
  `LoginAttempt`, `TrustedDevice`, `EmailOtpChallenge`, y `Session` (24h). RBA con
  señales dispositivo/IP/fallos → OTP por email; lockout duro 5 intentos/15 min;
  hashing bcrypt; Server Actions `login`/`verifyChallenge`/`logout`; migración con
  `down.sql` y RLS activado en las 6 tablas.
- Requisitos cubiertos: R1–R24 (incl. R10a, R21a, R23a), mapeados a tests en
  `progress/impl_login.md`. Verificación: typecheck/lint/test verdes.
- Decisiones: OTP solo por email (SMS/WhatsApp fuera de alcance); catálogos id+value;
  validación genérica de cédula/teléfono; estado enum pendiente/activo/inactivo/
  bloqueado; sesión cookie httpOnly sin refresh token.
- DEUDA (aceptada por el humano 2026-07-08, requiere entorno con DB real):
  ejecución del E2E de auth (T021→cubierto por E2E de login(home)), verificación
  del rechazo RLS con key anon (T004) y rollback de migración (T020). Marcada `done`
  con estos diferimientos documentados; NO cumple CHECKPOINTS al 100% (E2E sin
  ejecutar en verde) hasta correrlos en despliegue.

## 2026-07-08 — login(home) (pantalla de login)
- UI del login: página `/login` (Server Component con redirect de sesión activa) +
  formulario cliente email/contraseña que consume las Server Actions de `login`,
  maneja los 6 resultados de `LoginResult`, fase OTP (`verifyChallenge`), botón
  "Cerrar sesión" en la home, accesibilidad (labels/ARIA/foco/teclado). shadcn/ui +
  Tailwind. E2E `e2e/auth.spec.ts` escrito (4 caminos).
- Requisitos cubiertos: R1–R27, mapeados a tests de componente reales
  (`tests/components/*.test.tsx`, testing-library + jsdom) en
  `progress/impl_login-home.md`. Suite: 18 archivos / 110 tests verdes.
- Decisiones: botón de logout mínimo para destrabar E2E; redirect de usuarios ya
  autenticados (conecta R23a del backend). Review inicial RECHAZÓ por tests falsos
  (haiku) y bug de foco R22; se corrigió escalando frontend_dev a sonnet (tests que
  renderizan componentes reales; R22 fijado con regresión comprobada). Re-review
  APROBADO, 0 bloqueantes.
- DEUDA (aceptada por el humano 2026-07-08): ejecución del E2E (T017) requiere
  `.env` + Supabase de prueba + seed (usuario válido, uno para OTP, uno bloqueable).
  Marcada `done` con E2E diferido de ejecución; init.sh no corre `test:e2e`.
