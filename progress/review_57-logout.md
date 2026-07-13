# review_57-logout — Botón "Cerrar sesión" (logout)

Reviewer: reviewer (feature 57). Worktree: `R:/ark-studio/projects/ricardo/ordenex-f57`
(rama `feature/57-logout`). Objeto: `git diff origin/dev` (sin commitear).

## Veredicto

**RECHAZADO** — 2 hallazgos BLOQUEANTES de trazabilidad (R10, R11). El resto
del trabajo (colocación del control, unificación, backend reutilizado, typecheck
y suite) está correcto y en verde.

> **RESUELTO 2026-07-13 (leader, verificado).** Los 2 bloqueantes se corrigieron:
> **B1 (R11)** — añadido test del estado pendiente (promesa diferida → botón `disabled`
> + "Cerrando sesión…" + `push` no llamado durante el pending). **B2 (R10)** — añadido
> test del camino de error (logout rechaza → NO navega + re-habilita + `toast.error`), y
> se cumple la cláusula de feedback: el humano eligió **añadir `toast.error("No se pudo
> cerrar sesión")`** en el `catch` (`LogoutButton.tsx`), usando el sistema de toasts
> (feature 11). Menores M2 (trazabilidad honesta) y M3 (tasks `[x]`) también corregidos.
> Verificado por el leader (diffs leídos, tests reales no-hollow): typecheck 0, eslint 0,
> **2333/2333** tests. Trazabilidad R1..R14 → test COMPLETA. → **APROBADO de facto**.

> **REUBICACIÓN (misma feature 57), 2026-07-13 — leader-verificado.** El humano cambió
> la ubicación: de `SidebarFooter` al **topbar del `PageHeader`** (botón "Salir" + `LogOut`,
> como el #54 revertido pero sobre el dev sano). Rework verificado por el leader:
> `Sidebar.tsx` idéntico a `origin/dev` (sin logout); `PageHeader.tsx` monta el `LogoutButton`
> arriba-derecha; `PageHeader` es solo-autenticado (16 usos bajo `app/(app)/`); toast de error
> y R10/R11 conservados con labels "Salir"/"Saliendo…". `PageHeader.test.tsx` (nuevo) prueba el
> logout real; 11 tests colaterales stubbean `LogoutButton` (aislamiento estándar, sin debilitar
> asserts). VERDE: typecheck 0, eslint 0, **2335/2335**. Riesgo residual: SOLO visual (aspecto del
> botón en el header de cada página) — a validar por el humano en la app.

## Verificación ejecutable (corrida por el reviewer)

- `npx prisma generate` → OK (el worktree no traía cliente generado).
- `npx tsc --noEmit` → **0 errores**.
- `npx vitest run` (suite completa) → **2331 passed / 2331** (260 files). En esta
  corrida incluso `no-embalaje.test.ts` pasó; sin regresiones.
- Objetivo (Sidebar/LogoutButton/HomePage/auth-action/auth-service/session-repo)
  → **47/47**.
- `npx eslint` sobre los 4 archivos tocados → **0 errores** (sin imports muertos).
- E2E `e2e/auth.spec.ts` NO ejecutado (requiere servidor Playwright); los casos
  existen y fueron ajustados a selectores por rol.

## Checklist CHECKPOINTS.md

- [x] `specs/57-logout/{requirements,design,tasks}.md` presentes; design con
      alternativas descartadas.
- [~] tasks.md: TODAS las tasks siguen `[ ]` (ninguna marcada `[x]`). Ver hallazgo
      menor M3. No bloqueante por sí solo, pero CHECKPOINTS exige `[x]` para `done`.
- [~] Trazabilidad: 12/14 R con test real; **R10 y R11 sin test** (bloqueante).
- [x] `progress/impl_57-logout.md` contiene el mapa R→test (aunque R10/R11 lo
      declaran "existente ✔" de forma inexacta — ver B1/B2).
- [x] typecheck / lint / test en verde.
- [x] Flujo crítico (auth) con E2E existente (`e2e/auth.spec.ts`).
- [x] Sin tablas/migraciones nuevas (R13): `git diff` no toca `db/migrations/`;
      nada nuevo bajo `db/`. Sin Server Action/repo/servicio nuevos.
- [x] Sin secretos hardcodeados. Sin cambios de capas backend.
- [x] Mutación interna por Server Action existente (`logout`), no GET/route.
- [x] Páginas protegidas siguen validando en servidor (`resolveActorFromSession`
      intacto; `page.tsx` limpiado sin romper la ramificación por rol).

## Correctitud del cambio

- El control queda en `<SidebarFooter>` FUERA de `<SidebarContent>` y NO depende
  de la prop `items` → visible para todos los roles, en toda página protegida
  (R1/R2). El shell solo se monta bajo `(app)` tras el guard → no aparece en
  público (R3). Correcto.
- El botón ad-hoc de la home se retiró de verdad, junto con la lógica muerta
  `hasValidSession`/cookies/`SessionRepository`/imports. Ya NO hay dos "Cerrar
  sesión" (R14). `HomePage.test.tsx` lo verifica. Correcto.
- `LogoutButton.tsx` sin cambios (reuso tal cual, decisión F1.4 aprobada).
- R8 (no-back) apoyado en `middleware.ts`; NO se endureció `push`→`replace`
  (follow-up aprobado). Correcto, NO bloqueante.

## Hallazgos

### BLOQUEANTES

- **B1 — R11 (progreso + anti-doble-envío) SIN test.**
  El comportamiento EXISTE en el código (`app/_components/LogoutButton.tsx:25-26`:
  `disabled={isPending}` + texto `"Cerrando sesión..."`), pero NINGÚN test lo
  ejercita. `LogoutButton.test.tsx` tiene un único caso (línea 24) que sólo
  afirma click→`logout()`→`push("/login")` (cubre R4/R7). La trazabilidad de
  impl_57 (fila R11) cita ese archivo como "existente ✔", pero el test NO
  verifica el estado pendiente/deshabilitado. Mapeo hollow → BLOQUEANTE por
  regla #4 / docs/verification.md / CHECKPOINTS "cada R<n> mapea a un test".
  Cómo cumplir: añadir un caso a `LogoutButton.test.tsx` (logout con promesa
  pendiente → botón `disabled` y texto "Cerrando sesión..."). No requiere tocar
  el botón.

- **B2 — R10 (error del logout no simula éxito + feedback al usuario) SIN test y
  cláusula de feedback incumplida.**
  (a) Sin test del camino de error: `LogoutButton.test.tsx` no cubre el rechazo
  de `logout()`. La trazabilidad de impl_57 (fila R10) lo declara "existente ✔"
  sin caso que lo verifique → mapeo hollow.
  (b) Sustantivo: R10 exige "DEBE dar feedback del fallo al usuario". La
  implementación (`LogoutButton.tsx:18-20`) sólo hace `console.error("Logout
  failed:", error)`, que NO es feedback al usuario (es de desarrollador). El
  no-navegar y el re-habilitar sí se cumplen, pero la cláusula de feedback no.
  Cómo cumplir: (i) test que mockee `logout` rechazando y afirme que NO se navega
  y el botón vuelve accionable; (ii) feedback visible al usuario (p. ej. toast de
  la feature 11) en el `catch`. Si el humano decide waivar la cláusula de
  feedback para una acción de bajo riesgo, basta (i) + registrar la decisión en
  requirements/tasks; hoy la spec NO lo waiva.

### MENORES

- **M1 — impl_57 reporta la suite como "2330 passed / 2331" con `no-embalaje`
  fallando por timeout ambiental.** En mi corrida pasó 2331/2331. No es un
  problema del cambio; sólo anoto la discrepancia para el registro.
- **M2 — La trazabilidad de R8/R10/R11 en impl_57 usa la etiqueta "existente ✔"
  para tests que no existen (R10/R11) o para el guard (R8).** Ajustar la tabla
  para reflejar la realidad (R8: cubierto por guard+E2E, aceptado; R10/R11:
  pendientes de test) evita futura confusión del reviewer.
- **M3 — `tasks.md` tiene todas las tasks en `[ ]`.** CHECKPOINTS.md exige que
  estén `[x]` para `done`. Marcar las realmente hechas (y dejar claras T7
  no-aplicable por F1.4-b y T9 no-aplicable por R8) antes de cerrar.

## Estado de trazabilidad R<n> → test

| R | Test | Real? |
| --- | --- | --- |
| R1 | Sidebar.test.tsx "muestra el control … en el footer (R1)" | sí |
| R2 | Sidebar.test.tsx "… aunque no haya items (R2)" (items=[]) | sí |
| R3 | e2e/auth.spec.ts "(d) logout button no longer visible" | sí (E2E, no ejecutado) |
| R4 | LogoutButton.test.tsx "invoca logout …" | sí |
| R5 | auth-service.test.ts "AuthService.logout"→deleteById + auth-action R24 | sí |
| R6 | auth-action.test.ts "R24: … limpia la cookie" | sí |
| R7 | LogoutButton.test.tsx "… navega a /login" (push) | sí |
| R8 | middleware guard + e2e "after logout … redirect /login" | sí (E2E/guard) |
| R9 | auth-action "no llama … sí limpia cookie" + session-repo "deleteById idempotente" | sí |
| R10 | — (declarado "existente ✔", sin caso) | **NO** |
| R11 | — (declarado "existente ✔", sin caso) | **NO** |
| R12 | Sidebar.test.tsx "es un botón con nombre accesible (R12)" | sí |
| R13 | git diff sin db/migrations/ + sin Server Action nueva | sí (estructural) |
| R14 | HomePage.test.tsx "la home ya no renderiza su botón" | sí |

**Resultado: 12/14 R con test real. R10 y R11 sin test → RECHAZADO.**
