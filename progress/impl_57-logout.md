# impl_57-logout — Control de logout ("Salir")

> Feature PURO FRONTEND. El backend de logout YA EXISTÍA (`logout` en
> `lib/actions/auth.ts` → `AuthService.logout` → `SessionRepository.deleteById`,
> R24 de la feature 6). No se tocó backend, DB ni rutas de API.

## REWORK (2026-07-13) — reubicación al topbar del PageHeader

**Qué cambió y por qué.** La primera versión puso el logout en un `SidebarFooter`
del `Sidebar`. El humano revisó el **PR #54 ("adjustments")** —que tenía el logout
en un topbar dentro del `PageHeader` compartido y luego fue revertido— y prefirió
esa ubicación. Decisión: **recuperar SOLO el logout de #54** (etiqueta "Salir" +
icono `LogOut`, esquina superior derecha del `PageHeader`); NO se recupera la
campana de notificaciones (queda como feature aparte) ni el restyle global
navy→claro de #54. El `PageHeader` conserva su estilo actual (`bg-navy text-white
rounded-lg`); el botón lleva clases de contraste (border/texto claros) para leerse
sobre navy.

**Reversión del sidebar.** `app/(app)/_components/Sidebar.tsx` vuelve EXACTO a
`origin/dev` (verificado con `diff`): se quitaron el `<SidebarFooter>` con el
`<LogoutButton/>` y los imports de `SidebarFooter` y `LogoutButton`. El sidebar ya
no tiene logout.

**Botón (final).** `app/_components/LogoutButton.tsx`: `<Button variant="outline"
className="cursor-pointer border-white/40 bg-transparent text-white
hover:bg-white/10 hover:text-white"><LogOut aria-hidden/>{isPending ? "Saliendo…"
: "Salir"}</Button>`. Camino feliz `logout()` + `router.push("/login")`; estado
pendiente deshabilitado con "Saliendo…" (R11); `catch` conserva
`toast.error("No se pudo cerrar sesión")` (R10, decisión previa del humano, mejor
que el console-only del #54).

**PageHeader (server) monta el LogoutButton (client).** En
`components/shared/PageHeader.tsx` se añadió una zona derecha `flex items-center
gap-3` (header con `sm:justify-between`) que contiene `{actions}` + `<LogoutButton
/>`. Verificado que el `PageHeader` se usa SOLO bajo `app/(app)` (autenticado): las
páginas públicas (login/postulación/recuperar-contraseña) viven fuera de `(app)` y
no lo usan ⇒ el logout no aparece en público (R3). Válido que un Server Component
renderice un client component.

**Radio de impacto en tests (colateral obligado).** Como el `PageHeader` ahora
monta un client component que usa `useRouter()` (lanza sin AppRouterContext:
"invariant expected app router to be mounted") y `useToast()` (lanza sin
`ToastProvider`), TODO test que renderiza una página/dashboard con `PageHeader`
rompía. Se aisló stubbeando `@/app/_components/LogoutButton` en esos tests (patrón
ya usado en `HomePageRol`/`HomePageMaestro`); el comportamiento del botón se cubre
en `LogoutButton.test.tsx`. Sin cambios de producto por esto.

### Archivos del rework

| Archivo | Cambio |
| --- | --- |
| `app/(app)/_components/Sidebar.tsx` | REVERTIDO a `origin/dev`: − `<SidebarFooter><LogoutButton/></SidebarFooter>` y sus imports |
| `app/_components/LogoutButton.tsx` | etiqueta "Cerrar sesión"→"Salir", "Cerrando sesión…"→"Saliendo…"; + icono `LogOut`; clases de contraste para navy; conserva `toast.error` (R10) y `push` |
| `components/shared/PageHeader.tsx` | + import y render de `<LogoutButton/>` en zona derecha (`flex items-center gap-3`, header `justify-between`); estilo navy conservado |
| `tests/components/LogoutButton.test.tsx` | asserts "Cerrar sesión"→"Salir", "Cerrando sesión…"→"Saliendo…"; conserva R11 y R10 |
| `tests/components/PageHeader.test.tsx` | NUEVO: título/descr + presencia del control "Salir" (R1/R2/R12), coexiste con `actions` |
| `tests/components/Sidebar.test.tsx` | − casos de logout en el footer + mocks de `@/lib/actions/auth` y `@/hooks/useToast`; + caso "el sidebar NO renderiza ningún control de logout" |
| `tests/components/HomePage.test.tsx` | R14 reformulado: la home no añade logout ad-hoc; el único control es el del `PageHeader` (stub, exactamente 1) |
| `tests/components/HomePageRol.test.tsx` | stub `LogoutButton` label→"Salir"; caso actor-null: el placeholder ahora incluye el logout del `PageHeader` (presente, no ausente) |
| `tests/components/HomePageMaestro.test.tsx` | stub `LogoutButton` label→"Salir" (cosmético) |
| `tests/components/{OrdenesPage,OrdenesPagination,OrdenesModuleReuse,AdminTiendaDashboard,PlaceholderPages}.test.tsx` | + stub de `@/app/_components/LogoutButton` (aísla el client montado por `PageHeader`) |
| `tests/integration/{mi-wallet-page,wallet-page,wallet-mensajeros-page,mis-pagos-page,configuracion/usuarios-page,configuracion/zonas-page}.test.tsx` | + stub de `@/app/_components/LogoutButton` |
| `e2e/auth.spec.ts` | selectores/comentarios: "Cerrar sesión"/sidebar → "Salir"/topbar del `PageHeader` |
| `specs/57-logout/{requirements,design,tasks}.md` | ubicación final = topbar del `PageHeader`; label "Salir"/"Saliendo…"; trazabilidad R1/R2/R12 → `PageHeader.test.tsx`; R8 = solo guard |

### Trazabilidad tras el rework

- **R1, R2, R12** → `tests/components/PageHeader.test.tsx` (presencia del control
  "Salir" en el topbar, para toda página autenticada, botón nativo operable por
  teclado) + `Sidebar.test.tsx` (el sidebar ya NO tiene logout).
- **R3** → `e2e/auth.spec.ts` (tras logout, en `/login` no hay control "Salir").
- **R7, R10, R11** → `tests/components/LogoutButton.test.tsx` (push a `/login`;
  error no navega + toast + re-habilita; pendiente disabled + "Saliendo…").
- **R14** → `tests/components/HomePage.test.tsx` (único logout = el del `PageHeader`).
- **R4/R5/R6/R9** → backend existente (auth-action / auth-service / session-repo).
- **R8** → guard `middleware.ts` + `e2e/auth.spec.ts`.

### Verificación del rework (números)

- `npx tsc --noEmit` → **0 errores** (tras `npx prisma generate` en el worktree).
- `npx vitest run` (suite completa) → **2335 passed / 2335** (261 files),
  **0 fallos**. Incluye el nuevo `PageHeader.test.tsx` (4 casos) y los page/
  dashboard tests aislados con el stub del `LogoutButton`.
- `npx eslint` sobre los 20 archivos tocados → **0 errores**.

---

> Lo que sigue documenta la PRIMERA versión (logout en el `SidebarFooter`), ya
> **revertida**. Se conserva como historia; la ubicación vigente es el topbar del
> `PageHeader` (ver rework arriba).

## Decisiones F1.4 aplicadas (aprobadas por el humano, REFINAN el design)

- **(a) Ubicación:** se REUTILIZÓ el botón existente `app/_components/LogoutButton.tsx`
  colocándolo en el `SidebarFooter` del shell compartido
  `app/(app)/_components/Sidebar.tsx`, de modo que aparece para TODOS los roles.
  (El design recomendaba crear un `SidebarLogoutButton` con icono; se descartó a
  favor de reutilizar el botón tal cual, por decisión del humano.)
- **(b) Confirmación:** NINGUNA. Logout directo de un click, tal cual el botón
  existente (sin `Modal`).
- **R8 (no-back):** se conservó `router.push("/login")` del botón existente (NO se
  cambió a `replace` ni se añadió `router.refresh()` ni caché, contra la
  recomendación del design). El no-acceso a rutas protegidas al volver atrás lo
  cubre el guard existente `middleware.ts` (redirige a `/login` si falta la cookie
  `session`, que la action `logout` borra). No se detectó hueco real (ver abajo).

## Cómo se reutilizó el botón

`LogoutButton.tsx` mantiene el camino feliz intacto: `useTransition` →
`await logout()` → `router.push("/login")`, el texto "Cerrando sesión..." mientras
`isPending` y el bloqueo anti-doble-click (`disabled={isPending}`). El ÚNICO cambio
respecto al botón original (fix del reviewer, decisión del humano) es en el `catch`:
además del `console.error` se añade feedback visible con el sistema de toasts
(feature 11) — `toast.error("No se pudo cerrar sesión")` vía `useToast()` — para
cubrir R10. En el
`Sidebar` se renderiza `<LogoutButton />` dentro de un `<SidebarFooter>` añadido
después de `<SidebarContent>`. El botón se estira a todo el ancho del footer por
el `flex flex-col` (align stretch) de la primitiva `SidebarFooter`; se añadió
`className="overflow-hidden"` al footer para que su texto no se desborde fuera del
sidebar en estado colapsado (`collapsible="icon"`). Texto y acción se conservan.

El `SidebarFooter` NO depende de la prop `items` (filtrada por rol en el server),
por lo que el control aparece para cualquier rol logueado (R1, R2). El shell solo
se monta bajo sesión ⇒ no aparece en público (R3).

## Archivos tocados

| Archivo | Cambio |
| --- | --- |
| `app/(app)/_components/Sidebar.tsx` | + import `SidebarFooter` y `LogoutButton`; + `<SidebarFooter className="overflow-hidden"><LogoutButton /></SidebarFooter>` tras `<SidebarContent>` |
| `app/(app)/page.tsx` | − bloque ad-hoc `{hasValidSession && <div className="px-16"><LogoutButton/></div>}` + comentario "Minimal logout button…"; − lógica muerta `hasValidSession` (cookies/`SessionRepository`/`getPrismaClient`); − imports sin uso (`cookies`, `SESSION_COOKIE_NAME`, `SessionRepository`, `getPrismaClient`, `LogoutButton`) |
| `tests/components/Sidebar.test.tsx` | + mock de `@/lib/actions/auth`; + describe "control Cerrar sesión (feature 57)" con 3 casos (R1, R2, R12) |
| `tests/components/HomePage.test.tsx` | reescrito a R14: la home ya no renderiza su propio botón "Cerrar sesión" (antes afirmaba su visibilidad condicional) |
| `e2e/auth.spec.ts` | selectores del logout `getByText` → `getByRole("button", { name: "Cerrar sesión" })`; comentarios/título "(d) … home button" → "sidebar button" |
| `app/_components/LogoutButton.tsx` | + `import { useToast }`; + `const toast = useToast()`; en el `catch`, además del `console.error`, `toast.error("No se pudo cerrar sesión")` (R10, feedback visible). Camino feliz sin cambios |
| `tests/components/LogoutButton.test.tsx` | + mock de `@/hooks/useToast`; + caso R11 (estado pendiente con deferred promise) y caso R10 (logout rechaza → no navega, botón re-habilitado, `toast.error`) |

Backend (`lib/actions/auth.ts`, `AuthService`, `SessionRepository`, `middleware.ts`): SIN cambios.

## Trazabilidad R<n> → test

| Req | Test | Estado |
| --- | --- | --- |
| R1 | `tests/components/Sidebar.test.tsx` :: "muestra el control Cerrar sesión en el footer (R1)" | nuevo ✔ |
| R2 | `tests/components/Sidebar.test.tsx` :: "se muestra aunque no haya items visibles … (R2)" (render con `items=[]`) | nuevo ✔ |
| R3 | `e2e/auth.spec.ts` :: "(d) … logout button is no longer visible" tras logout (shell no montado en `/login`) | ajustado ✔ |
| R4 | `tests/components/LogoutButton.test.tsx` :: "al hacer click invoca la Server Action logout …" | existente, reusado ✔ |
| R5 | `tests/unit/services/auth-service.test.ts` (logout → `deleteById`) + `tests/integration/actions/auth-action.test.ts` (R24) | existente (backend) ✔ |
| R6 | `tests/integration/actions/auth-action.test.ts` :: R24 limpia la cookie `session` | existente (backend) ✔ |
| R7 | `tests/components/LogoutButton.test.tsx` :: "… luego navega a /login" (`push("/login")`) | existente, reusado ✔ |
| R8 | guard `middleware.ts` (redirect a `/login` sin cookie) + `e2e/auth.spec.ts` :: "after logout, accessing protected route should redirect to /login" | existente/ajustado ✔ |
| R9 | `tests/integration/actions/auth-action.test.ts` :: idempotencia (sin cookie no llama a AuthService.logout pero limpia cookie) | existente (backend) ✔ |
| R10 | `tests/components/LogoutButton.test.tsx` :: "R10: si logout rechaza, NO navega, re-habilita el botón y muestra toast de error" (mock de `@/hooks/useToast`: asserta `router.push` NO llamado, botón no-disabled y `toast.error("No se pudo cerrar sesión")`) | nuevo ✔ |
| R11 | `tests/components/LogoutButton.test.tsx` :: "R11: mientras logout está en curso el botón queda disabled y muestra 'Cerrando sesión…'" (deferred promise: asserta `disabled` + texto "Cerrando sesión..." ANTES de resolver, y navegación tras resolver) | nuevo ✔ |
| R12 | `tests/components/Sidebar.test.tsx` :: "es un botón con nombre accesible y operable por teclado (R12)" | nuevo ✔ |
| R13 | Sin tablas/migraciones: `git diff` no toca `db/migrations/`; no se creó Server Action/repo/servicio | ✔ |
| R14 | `tests/components/HomePage.test.tsx` :: "la home ya no renderiza su propio botón Cerrar sesión" | ajustado ✔ |

> Nota (fix del reviewer): R10/R11 ahora tienen tests DEDICADOS nuevos en
> `LogoutButton.test.tsx` (no "existente"): R11 ejercita el estado pendiente con
> una promesa diferida; R10 ejercita el rechazo de `logout()` (no navega, botón
> re-habilitado, `toast.error`). El camino feliz sigue con `router.push` y sin
> Modal (decisión del humano); el único cambio de producto es el toast de error.

## Verificación (números)

- **`npx tsc --noEmit`** → **0 errores** (tras `npx prisma generate`; el worktree no
  traía el cliente Prisma generado — se regeneró; sin esto, errores masivos de
  `@prisma/client`).
- **`npx vitest run`** (suite completa) → **2333 passed / 2333** (baseline 2331 + los
  **2 casos nuevos** de `LogoutButton.test.tsx` para R10/R11). Sin regresiones; el
  flaky `tests/unit/guards/no-embalaje.test.ts` (timeout ambiental, ajeno a esta
  feature) pasó en esta corrida. Tests objetivo
  (`LogoutButton`/`Sidebar`/`HomePage`): **19/19 verdes**.
- **`npx eslint` sobre los archivos tocados** (`LogoutButton.tsx`,
  `LogoutButton.test.tsx`, `Sidebar.test.tsx`) → **0 errores**.

## Fix del reviewer (feedback trazabilidad + R10)

Aplicado tras el RECHAZO por trazabilidad (núcleo aprobado). Decisión del humano:
añadir un **toast de error** (opción recomendada). Cambios:

1. **R10 (feedback visible):** `LogoutButton.tsx` — en el `catch`, además del
   `console.error`, `toast.error("No se pudo cerrar sesión")` vía `useToast()`
   (feature 11). Camino feliz intacto (`logout()` + `router.push("/login")` +
   "Cerrando sesión…").
2. **R11 (test estado pendiente):** nuevo caso en `LogoutButton.test.tsx` con una
   promesa **diferida** que mockea `logout`: asserta botón `disabled` + texto
   "Cerrando sesión..." ANTES de resolver, y navegación tras resolver.
3. **R10 (test camino de error):** nuevo caso en `LogoutButton.test.tsx` con
   `logout` que rechaza: asserta que NO se navega, el botón se re-habilita y se
   llama `toast.error("No se pudo cerrar sesión")` (mock de `@/hooks/useToast`).
4. **Colateral:** `Sidebar.test.tsx` — al montar `LogoutButton` (que ahora usa
   `useToast()`) se añadió el mock de `@/hooks/useToast` para no lanzar fuera de
   `ToastProvider`.
5. Trazabilidad de R10/R11 corregida (ver tabla arriba) y tasks marcadas `[x]`.

## Hueco de no-back (R8)

No se detectó hueco real. El guard `middleware.ts` intercepta toda ruta no pública
y redirige a `/login` cuando falta la cookie `session` (que la action `logout`
elimina). Como el humano pidió "tal cual el existente", NO se endureció con
`replace`/`refresh`/`no-store`. Si en un futuro se quisiera blindar el Router Cache
de App Router al pulsar "Atrás", sería un follow-up de decisión del humano (no se
aplicó a escondidas).
