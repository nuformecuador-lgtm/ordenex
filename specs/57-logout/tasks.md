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

- [x] **T3. Añadir `SidebarFooter` con control "Cerrar sesión".** En
  `app/(app)/_components/Sidebar.tsx`, agregar `SidebarFooter` (primitiva ya
  disponible en `components/ui/sidebar.tsx`) con un `SidebarMenuButton` + icono
  `LogOut` de `lucide-react`, nombre accesible "Cerrar sesión", independiente de la
  prop `items`. **Hecho:** el control aparece en el sidebar para cualquier set de
  `items` (incluido vacío) y es operable por teclado (R1, R2, R3, R12).
- [x] **T4. Cablear el flujo de logout + redirección + no-back.** Componente
  cliente (nuevo `SidebarLogoutButton` o reuso de `LogoutButton`) que en `onClick`
  ejecute `startTransition(async () => { await logout(); router.replace("/login");
  router.refresh(); })`, con estado "Cerrando sesión…" y bloqueo anti-doble-click.
  **Hecho:** al click invalida sesión, va a `/login`, invalida el Router Cache y
  bloquea reenvíos (R4, R7, R8, R11).
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

- [x] **T8. [P] Test de visibilidad por rol** (ver trazabilidad R1/R2).
- [x] **T9. [P] Actualizar `LogoutButton`/componente test** a `replace`+`refresh`
  y estados (R7, R8, R10, R11).
- [x] **T10. [P] Ajustar E2E** `e2e/auth.spec.ts` para el control del sidebar y el
  no-back (R7, R8).
- [x] **T11. Verde total.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm
  prisma validate` y `./init.sh` en verde; `git diff` sin nada bajo
  `db/migrations/` (R13). **Hecho:** todo pasa y sin migraciones nuevas.

## Trazabilidad R<n> → test

| Req | Qué valida | Test (archivo :: caso) |
| --- | --- | --- |
| R1 | Control presente en el shell autenticado | `tests/components/Sidebar.test.tsx` :: "muestra el control Cerrar sesión en el footer" (nuevo) |
| R2 | Visible para todos los roles (independiente de `items`) | `tests/components/Sidebar.test.tsx` :: "el control Cerrar sesión se muestra aunque no haya items visibles (independiente del rol)" (nuevo; render con `items=[]`) |
| R3 | No aparece sin sesión (shell no montado) | `tests/components/LoginPage`/guard: `e2e/auth.spec.ts` :: "(d) … logout button no longer visible" tras logout (existente, ajustado) |
| R4 | Click invoca la Server Action de logout | `tests/components/LogoutButton.test.tsx` :: "al hacer click invoca la Server Action logout" (existente, reusado) |
| R5 | Invalida la MISMA sesión server-side | `tests/unit/services/auth-service.test.ts` :: logout → `sessionRepo.deleteById(sessionId)` (R24, existente) + `tests/integration/actions/auth-action.test.ts` :: "R24: elimina la sesion y limpia la cookie" (existente) |
| R6 | Expira la cookie `session` (mismo nombre del login) | `tests/integration/actions/auth-action.test.ts` :: "R24: … limpia la cookie" (assert `clearCookie` llamado) (existente) |
| R7 | Redirige a `/login` | `tests/components/LogoutButton.test.tsx` :: "luego navega a /login" (actualizar `push`→`replace`) |
| R8 | No-acceso al volver atrás (guard + refresh) | `tests/components/LogoutButton.test.tsx` :: "invoca router.refresh tras logout" (nuevo) + `e2e/auth.spec.ts` :: "after logout, accessing protected route should redirect to /login" (existente) |
| R9 | Idempotencia (logout sin sesión no rompe) | `tests/integration/actions/auth-action.test.ts` :: "no llama a AuthService.logout si no hay cookie … pero sí limpia la cookie" (existente) + `tests/unit/repositories/session-repository.test.ts` :: `deleteById` idempotente ante `P2025` (existente/confirmar) |
| R10 | Error del logout no simula éxito | `tests/components/LogoutButton.test.tsx` :: "si logout rechaza, no navega y re-habilita el control" (nuevo) |
| R11 | Progreso + anti-doble-click | `tests/components/LogoutButton.test.tsx` :: "deshabilita el control y muestra 'Cerrando sesión…' mientras pendiente" (nuevo) |
| R12 | Operable por teclado y nombre accesible | `tests/components/Sidebar.test.tsx` :: "el control Cerrar sesión es un botón con nombre accesible" (nuevo) |
| R13 | Sin tablas/migraciones nuevas | T11: `pnpm prisma validate` verde + `git diff` sin cambios en `db/migrations/` (check de CI/`init.sh`) |
| R14 | Un único control (sin el ad-hoc de la home) | `tests/components/HomePage.test.tsx` :: "la home ya no renderiza su propio botón Cerrar sesión" (actualizar) |

> Nota: los tests marcados "existente" ya cubren el backend R24 de la feature 6;
> feature 57 los **reutiliza** como evidencia de R4–R6/R9 y añade los tests nuevos
> de UI/flujo (R1, R2, R7, R8, R10, R11, R12, R14). El reviewer rechaza si algún
> R<n> queda sin test asociado.
