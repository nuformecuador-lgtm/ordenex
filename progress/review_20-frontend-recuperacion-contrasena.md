# Review Feature 20 — Recuperación de contraseña (SLICE FRONTEND, Bloque 4 / T06–T08)

> Reviewer. Alcance: SOLO frontend (R12/R16/R17/R18) y su integración con las
> Server Actions del backend (ya aprobado en `review_20-recuperacion-contrasena.md`).
> Rama: `feature/20-recuperacion-contrasena` vs `origin/dev`. Commit frontend: `cfede1f`.

## Checklist verificado

### Trazabilidad frontend
- [x] **R12** → `recuperar-contrasena-page.test.tsx`: "redirige a / cuando la cookie de sesión
      es válida", "renderiza el formulario cuando no hay cookie", "…cuando la sesión está
      expirada/inválida". Tests reales, no vacíos.
- [x] **R16** (3 fases email→código→contraseña+confirmación) → `recuperar-contrasena-form.test.tsx`:
      "avanza de email a código tras solicitar", "avanza a nueva contraseña tras verificar".
- [x] **R17** (éxito + navegación a login) → `recuperar-contrasena-form.test.tsx`:
      "muestra confirmación y enlace a login tras restablecer con éxito" (link href="/login").
- [x] **R18** (enlace en login) → `login-form-reset-link.test.tsx`: "muestra un enlace hacia
      la ruta de reset" (href="/recuperar-contrasena").

### Seguridad UI (crítico)
- [x] La UI nunca distingue "email no existe" de "email enviado": tras `solicitarRecuperacion`
      con `status:"ok"` siempre avanza a fase código. La action solo puede devolver
      `ok | validation_error` (nunca `invalid_or_expired`); el form no filtra existencia.
- [x] Errores de verificación y restablecimiento usan el MISMO mensaje genérico
      (`GENERIC_INVALID_MESSAGE`) para `invalid_or_expired`, sin revelar la causa.

### Ruta y protección
- [x] Vive en `app/recuperar-contrasena/**`, no bajo `app/login/`.
- [x] `page.tsx` es Server Component público; redirige a `/` si `SESSION_COOKIE_NAME` +
      `SessionRepository.findValidById` da sesión válida (patrón `login/page.tsx`).

### Integración con backend
- [x] `solicitarRecuperacion({ email })` ↔ `requestResetSchema { email }`.
- [x] `verificarCodigoRecuperacion({ email, code })` ↔ `verifyResetCodeSchema { email, code }`.
- [x] `restablecerContrasena({ email, code, password, confirmPassword })` ↔
      `resetPasswordSchema { email, code, password, confirmPassword }`.
- [x] El form maneja las uniones de resultado completas (ok / invalid_or_expired /
      validation_error) sin asumir formas inexistentes.

### Alcance frontend puro
- [x] El commit frontend `cfede1f` toca SOLO: `app/login/_components/LoginForm.tsx` (enlace),
      `app/recuperar-contrasena/**`, 3 tests, y docs (progress/tasks). No toca `lib/actions/`,
      `lib/services/`, `lib/repositories/`, `lib/types/password-*`, `db/`, `app/api/`.
- [x] T08 no rompe login: `LoginForm.test.tsx` + `LoginPage.test.tsx` → 29/29 verdes.

### Calidad
- [x] TS strict: `pnpm run typecheck` exit 0. Sin `any` en `app/recuperar-contrasena/**`
      (solo casts `as Record<string,string[]>` sobre `flatten().fieldErrors`, aceptable).
- [x] `pnpm run lint`: 0 errores (135 warnings pre-existentes en `.claude/skills/**`, ajenos).

### Verificación ejecutable (corrida por el reviewer)
- [x] Tests frontend aislados: 3 archivos, 11/11 verdes.
- [x] `LoginForm` + `LoginPage`: 29/29 verdes (sin regresión por T08).
- [x] `./init.sh` → `== init OK ==`, exit 0. Suite completa: 99 archivos, 782/782 verdes.
      No apareció flaky en esta corrida.

## Hallazgos

- **Observación (menor, no bloqueante):** el `page.tsx` frontend instancia
  `SessionRepository`/`getPrismaClient` directamente en el Server Component (igual que
  `login/page.tsx`). Es réplica fiel del patrón existente aprobado; no introduce deuda nueva.
- **Observación:** riesgo heredado del `console.log` de OTP en claro en `OtpChallengeIssuer`
  es backend y quedó fuera de alcance (ya reportado al leader); el frontend no lo agrava.

Sin hallazgos BLOQUEANTES.

## Veredicto del slice frontend: APROBADO

Bloqueantes: 0.

Con este slice aprobado, la Feature 20 (Recuperación de contraseña) queda COMPLETA:
backend (R1–R15, R19, R20) aprobado previamente + frontend (R12/R16/R17/R18) aprobado aquí.
Pendiente operativo de cierre: marcar T09 (trazabilidad final ya reflejada en la bitácora)
y el paso de estado a `done` con su entrada en `progress/history.md`.
