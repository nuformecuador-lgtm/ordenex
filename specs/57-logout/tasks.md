# Feature 57 — Botón "Cerrar sesión" (logout) · tasks.md

> Checklist ejecutable. `[P]` = paralelizable. Cada task con criterio de "hecho".
> Partición fullstack menor y **secuencial**: backend (verificación/reuso) →
> frontend (UI + flujo). Un solo ciclo.

## Fase 0 — Preludio (bloqueante)

- [x] **T0. Aprobación humana de F1.4.** Resolver (a) ubicación (recomendado:
  sidebar footer) y (b) confirmación (recomendado: directo). **Hecho:** decisión
  registrada; el resto de tasks asume las recomendaciones salvo cambio.

## Fase 1 — Backend (verificación/reuso, SIN código nuevo) — depende de T0

- [x] **T1. Verificar la Server Action `logout` existente.** Confirmar en
  `lib/actions/auth.ts` que `logout` (i) lee la cookie `SESSION_COOKIE_NAME`,
  (ii) llama `authService.logout(sessionId)` solo si hay id, y (iii) siempre borra
  la cookie. **Hecho:** contrato confirmado; no se añade Server Action nueva
  (R4, R5, R6, R9, R13).
- [x] **T2. Verificar idempotencia server-side.** Confirmar
  `SessionRepository.deleteById` traga `P2025` y `AuthService.logout` delega en él.
  **Hecho:** cubierto por tests existentes (ver trazabilidad R5/R9); sin cambios.

## Fase 2 — Frontend — depende de Fase 1

- [x] **T3. Montar el control de logout "Salir" en el topbar del `PageHeader`.**
  En `components/shared/PageHeader.tsx` (Server Component usado por toda página de
  `app/(app)`), renderizar `<LogoutButton />` en una zona derecha (`flex items-center
  gap-3`, header con `justify-between`), con etiqueta "Salir" + icono `LogOut` de
  `lucide-react` y clases de contraste para leerse sobre el fondo navy. **Hecho:**
  el control aparece en toda página autenticada para cualquier rol y es operable
  por teclado (R1, R2, R3, R12). **Revertido:** el `SidebarFooter` de la versión
  previa se quitó; el sidebar vuelve a header + nav.
- [x] **T4. Cablear el flujo de logout + redirección.** El `LogoutButton`
  (`app/_components/LogoutButton.tsx`) en `onClick` ejecuta
  `startTransition(async () => { await logout(); router.push("/login"); })`, con
  estado "Saliendo…" y bloqueo anti-doble-click. **Hecho:** al click invalida la
  sesión y va a `/login`, bloqueando reenvíos (R4, R7, R11). El no-back (R8) lo
  cubre el guard `middleware.ts` (decisión del humano: se conserva `push`, sin
  `replace`/`refresh`).
- [x] **T5. Manejo de error del flujo.** SI `logout()` rechaza, NO navegar a
  `/login`; mostrar feedback (toast, feature 11) y dejar el control accionable.
  **Hecho:** con la action fallando, no hay navegación y el botón vuelve a estar
  habilitado (R10).
- [x] **T6. [P] Retirar el botón ad-hoc de la home.** Quitar de
  `app/(app)/page.tsx` el bloque `hasValidSession && <LogoutButton/>` (y limpieza
  de imports/lógica de sesión que quedaran sin uso). **Hecho:** solo existe UN
  control "Cerrar sesión" (el del sidebar); `getByText("Cerrar sesión")` no hace
  match múltiple (R14).
- [ ] **T7. (Condicional F1.4-b) Confirmación con Modal.** SOLO si el humano elige
  confirmación: envolver el disparo en `components/shared/Modal.tsx`
  (`confirmLabel="Cerrar sesión"`, `confirmVariant="destructive"`, `onConfirm`
  async con el flujo de T4). **Hecho:** aparece el modal, confirmar ejecuta el
  logout; cancelar lo aborta. **N/A:** el humano eligió confirmación NINGUNA
  (F1.4-b directo); la precondición no se cumple, esta task queda fuera de alcance.

## Fase 3 — Tests y verificación — depende de Fase 2

- [x] **T8. [P] Test de presencia en el `PageHeader`** (ver trazabilidad R1/R2/R12):
  `tests/components/PageHeader.test.tsx`.
- [x] **T9. [P] Actualizar `LogoutButton` test** a la etiqueta "Salir"/"Saliendo…"
  conservando los casos de estado pendiente y error (R7, R10, R11).
- [x] **T10. [P] Ajustar E2E** `e2e/auth.spec.ts` para el control del topbar del
  `PageHeader` ("Salir") y el no-back (R7, R8).
- [x] **T10b. [P] Aislar los tests de páginas del `LogoutButton` (client).** Como el
  `PageHeader` ahora monta un client component (`useRouter`/`useToast`), los tests
  que renderizan páginas/dashboards con `PageHeader` stubbean `@/app/_components/
  LogoutButton`. **Hecho:** sin regresiones (ver impl, sección de rework).
- [x] **T11. Verde total.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm
  prisma validate` y `./init.sh` en verde; `git diff` sin nada bajo
  `db/migrations/` (R13). **Hecho:** todo pasa y sin migraciones nuevas.

## Trazabilidad R<n> → test

| Req | Qué valida | Test (archivo :: caso) |
| --- | --- | --- |
| R1 | Control presente en el topbar del `PageHeader` (toda página autenticada) | `tests/components/PageHeader.test.tsx` :: "muestra el control de logout 'Salir' en el topbar" (nuevo) |
| R2 | Visible para todos los roles (el `PageHeader` no filtra por rol) | `tests/components/PageHeader.test.tsx` :: "presente en toda página autenticada, independiente del rol" (nuevo); el sidebar NO renderiza logout: `tests/components/Sidebar.test.tsx` :: "el sidebar NO renderiza ningún control de logout" |
| R3 | No aparece sin sesión (`PageHeader`/shell no montado en público) | `e2e/auth.spec.ts` :: "(d) … logout button no longer visible" tras logout (existente, ajustado a "Salir") |
| R4 | Click invoca la Server Action de logout | `tests/components/LogoutButton.test.tsx` :: "al hacer click invoca la Server Action logout" (existente, reusado) |
| R5 | Invalida la MISMA sesión server-side | `tests/unit/services/auth-service.test.ts` :: logout → `sessionRepo.deleteById(sessionId)` (R24, existente) + `tests/integration/actions/auth-action.test.ts` :: "R24: elimina la sesion y limpia la cookie" (existente) |
| R6 | Expira la cookie `session` (mismo nombre del login) | `tests/integration/actions/auth-action.test.ts` :: "R24: … limpia la cookie" (assert `clearCookie` llamado) (existente) |
| R7 | Redirige a `/login` | `tests/components/LogoutButton.test.tsx` :: "luego navega a /login" (`push("/login")`) |
| R8 | No-acceso al volver atrás (guard) | guard `middleware.ts` (redirect a `/login` sin cookie) + `e2e/auth.spec.ts` :: "after logout, accessing protected route should redirect to /login" (existente) |
| R9 | Idempotencia (logout sin sesión no rompe) | `tests/integration/actions/auth-action.test.ts` :: "no llama a AuthService.logout si no hay cookie … pero sí limpia la cookie" (existente) + `tests/unit/repositories/session-repository.test.ts` :: `deleteById` idempotente ante `P2025` (existente/confirmar) |
| R10 | Error del logout no simula éxito | `tests/components/LogoutButton.test.tsx` :: "R10: si logout rechaza, NO navega, re-habilita el botón y muestra toast de error" (nuevo) |
| R11 | Progreso + anti-doble-click | `tests/components/LogoutButton.test.tsx` :: "R11: … el botón queda disabled y muestra 'Saliendo…'" (nuevo) |
| R12 | Operable por teclado y nombre accesible "Salir" | `tests/components/PageHeader.test.tsx` :: "R1/R2: … control de logout 'Salir' … tagName BUTTON, no disabled" (nuevo) |
| R13 | Sin tablas/migraciones nuevas | T11: `pnpm prisma validate` verde + `git diff` sin cambios en `db/migrations/` (check de CI/`init.sh`) |
| R14 | Un único control (sin el ad-hoc de la home) | `tests/components/HomePage.test.tsx` :: "el único logout es el del PageHeader (sin botón ad-hoc)" (actualizado) |

> Nota: los tests marcados "existente" ya cubren el backend R24 de la feature 6;
> feature 57 los **reutiliza** como evidencia de R4–R6/R9 y añade/ajusta los tests
> de UI/flujo (R1, R2, R7, R10, R11, R12, R14). El reviewer rechaza si algún
> R<n> queda sin test asociado.
