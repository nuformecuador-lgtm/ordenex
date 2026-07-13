# Feature 57 — Botón "Cerrar sesión" (logout) · design.md

> Diseño anclado en el código real. Todos los nombres citados existen en el
> worktree `R:/ark-studio/projects/ricardo/ordenex-f57`. Regla #6: no se inventan
> mecanismos; lo que ya existe se reutiliza y se cita.

## 1. Mecanismo de sesión REAL (hallazgos)

| Pieza | Archivo | Detalle verificado |
| --- | --- | --- |
| Nombre de cookie | `lib/constants/auth.ts` | `SESSION_COOKIE_NAME = "session"` |
| Creación de sesión (login) | `lib/actions/auth.ts` → `setSessionCookie()` | `cookies().set("session", sessionId, { httpOnly, secure: prod, sameSite: "lax", expires, path: "/" })` tras `authService.login()` (R23 feature 6) |
| Modelo de sesión | `SessionRepository` (`lib/repositories/SessionRepository.ts`) | fila `Session { id, userId, expiresAt }`; `create`, `findValidById` (expira si `expiresAt <= now`), `deleteById` **idempotente** (traga `P2025`) |
| Resolución de actor | `lib/auth/resolve-actor.ts` → `resolveActorFromSession()` | lee cookie `session`, valida la fila y resuelve `rol` |
| **Guard de rutas** | `middleware.ts` | intercepta todo salvo `PUBLIC_ROUTES = ["/login", "/api/health"]`; si falta la cookie `session` → `NextResponse.redirect("/login?redirect=<path>")` |
| **Backend de logout (YA EXISTE)** | `lib/actions/auth.ts` → `logout(deps)` | lee `session` de la cookie; si hay id llama `authService.logout(sessionId)`; siempre `clearSessionCookie()` (`cookies().delete("session")`). Idempotente (R24) |
| Servicio de logout | `lib/services/AuthService.ts` → `logout(sessionId)` | `sessionRepo.deleteById(sessionId)` (R24) |
| Contrato | `lib/interfaces/services/IAuthService.ts` | `logout(sessionId: string): Promise<void>` |
| Botón de logout | `app/_components/LogoutButton.tsx` (montado por `PageHeader`) | client, `useTransition` → `await logout(); router.push("/login")`; icono `LogOut` + "Salir" ("Saliendo…" mientras `isPending`); en error `toast.error(...)` |
| Shell autenticado | `app/(app)/layout.tsx` + `app/(app)/_components/Sidebar.tsx` | `<SidebarProvider><Sidebar items={…}/><SidebarInset>{children}</SidebarInset></SidebarProvider>`; items filtrados por rol vía `itemsVisibles(SIDEBAR_ITEMS, actor)`. El sidebar NO tiene logout. |
| Topbar del header | `components/shared/PageHeader.tsx` | Server Component usado por TODA página de `app/(app)`; renderiza el `LogoutButton` en su zona superior derecha (fondo navy) |
| Roles | `lib/types/roles.ts` `ROLES_SEED` | `maestro, admin, mensajero, adminTienda, adminSatelite` |

**Conclusión:** la pieza backend (Server Action que invalida la sesión y expira la
misma cookie del login) **ya está construida y testeada** (feature 6, R24, con
tests en `tests/integration/actions/auth-action.test.ts` y
`tests/unit/services/auth-service.test.ts`). Esta feature es, en la práctica,
**mayormente frontend**: colocar el control en el shell para todos los roles,
cerrar el flujo de redirección/no-back y unificar el control (quitar el ad-hoc).

## 2. Partición fullstack (menor, estrictamente secuencial → un ciclo)

- **Backend (verificación/reuso, sin código nuevo):** confirmar el contrato de
  `logout` en `lib/actions/auth.ts` (borra la cookie `session` y elimina la fila
  `Session` de forma idempotente). No se crea Server Action nueva, ni servicio, ni
  repo, ni migración (R13). El "trabajo" backend es asegurar cobertura de R5/R6/R9
  sobre la action existente (ya cubierta) y no romperla.
- **Frontend (el trabajo real):** montar el control en el topbar del `PageHeader`,
  cablear el flujo click → `logout()` → redirección a `/login`, y retirar el botón
  ad-hoc de `page.tsx`.
- **Orden:** backend (verificar) → frontend (construir). Un solo ciclo; el
  implementer delega backend_dev (verificación/no-op) → frontend_dev (UI+flujo).

## 3. Diseño frontend

### 3.1 Ubicación del control (F1.4-a → DECISIÓN FINAL: topbar del PageHeader)

Montar el `LogoutButton` en la **zona superior derecha del `PageHeader` compartido**
(`components/shared/PageHeader.tsx`): etiqueta "Salir" + icono `LogOut` de
`lucide-react`, dentro de un contenedor `flex items-center gap-3` a la derecha del
título (header con `justify-between`). El `PageHeader` es un Server Component usado
por TODA página del grupo `app/(app)`, por lo que el control aparece para todos los
roles en toda página protegida (R1, R2), sin depender de ningún filtrado por rol.
El `PageHeader` solo se usa bajo sesión (nunca en rutas públicas, que viven fuera de
`(app)`) ⇒ no aparece en público (R3). El `PageHeader` (server) renderiza el
`LogoutButton` (client); esa mezcla server→client es válida.

Esta ubicación **recupera el logout del PR #54** (que lo tenía en el topbar del
`PageHeader` y fue revertido). Se recupera SOLO el logout; NO la campana de
notificaciones ni el restyle global de #54. El estilo del `PageHeader` se conserva
(`bg-navy text-white rounded-lg`) y el botón usa clases de contraste (border/texto
claros) para leerse sobre el fondo navy.

> **Historia:** una primera versión colocó el control en un `SidebarFooter` del
> `Sidebar`. El humano cambió la decisión a favor del topbar del `PageHeader`
> (visto en #54). El `SidebarFooter` se revirtió: el sidebar vuelve a header + nav.

Reutilización del comportamiento: la lógica de `app/_components/LogoutButton.tsx`
(useTransition → `logout()` → `router.push("/login")`, estado "Saliendo…", bloqueo
anti-doble-click, `toast.error` en el catch) se conserva; solo cambian su etiqueta
("Cerrar sesión" → "Salir") y su lugar de montaje (del `SidebarFooter` al
`PageHeader`).

### 3.2 Flujo click → invalidación → redirección → no-back (R4–R9)

```
onClick
  → startTransition(async () => {
        try {
          await logout();          // Server Action existente: borra fila Session + expira cookie "session"
          router.push("/login");   // R7: va a /login tras completar el logout
        } catch (e) {
          // R10: NO navegar; toast.error(...) (feature 11) + control accionable
        }
     })
```

**No-back (R8) vía guard:** el `middleware.ts` es el guard server-side: una vez
borrada la cookie `session`, cualquier navegación real a una ruta protegida se
redirige a `/login`. Por decisión del humano se conserva `router.push("/login")`
del botón existente (NO se endurece con `replace`/`refresh`/`no-store`). No se
detectó hueco real: el guard cubre el intento de acceso a rutas protegidas
—incluido pulsar "Atrás"— tras el logout.

### 3.3 Unificar el control (R14)

Retirar el botón ad-hoc de `app/(app)/page.tsx` (el bloque `hasValidSession && …`
con `<LogoutButton/>`) para que solo exista el control del `PageHeader` (topbar) y
no queden dos controles de logout. El E2E `e2e/auth.spec.ts` (bloque "(d) Logout
using PageHeader topbar button") encuentra el botón "Salir" porque el `PageHeader`
está en toda página autenticada; se ajustan comentario/selector a "Salir".

### 3.4 Impacto de F1.4(b) — confirmación

- **Directo (recomendado):** el flujo de 3.2 tal cual.
- **Con confirmación:** envolver el disparo en el `Modal` compartido
  (`components/shared/Modal.tsx`) con `confirmLabel="Cerrar sesión"`,
  `confirmVariant="destructive"` y `onConfirm` async que ejecuta el flujo 3.2. El
  Modal ya provee spinner, bloqueo y canal de error (`onError`) — cubre R10/R11
  sin lógica extra. La decisión no afecta el backend ni la trazabilidad de
  R4–R9; solo añade un test de "aparece el modal y confirma".

## 4. Alternativas consideradas y descartadas

1. **Crear una Server Action / route handler de logout nuevos.** DESCARTADA:
   `logout` ya existe en `lib/actions/auth.ts`, es idempotente y borra la misma
   cookie `session` que fija el login; duplicarla viola la reutilización (regla #3
   de architecture) y regla #6. Se reutiliza la existente.
2. **Logout vía enlace/route GET (`/logout`).** DESCARTADA: `architecture.md`
   manda mutaciones internas por Server Action, no por rutas GET fetcheadas; un
   GET de logout es propenso a CSRF y a disparos por prefetch/scanners.
3. **Menú de usuario/perfil con dropdown (nombre + rol + logout).** DESCARTADA
   para el alcance actual (ver F1.4-a): no existe dropdown/menú de usuario en el
   shell; construirlo es sobre-ingeniería para complejidad `low`. Reevaluable como
   feature aparte; el botón podría migrar sin tocar backend.
4. **Navegación dura `window.location.href = "/login"` para el no-back.**
   DESCARTADA: aunque garantiza descartar todo el estado de cliente, es más pesada
   de lo necesario; el `middleware` (guard) satisface R8 al redirigir cualquier
   acceso a ruta protegida sin cookie de sesión.
5. **Endurecer el no-back con `router.replace` + `router.refresh` +
   `Cache-Control: no-store`.** DESCARTADA por decisión del humano ("tal cual el
   botón existente"): el guard de `middleware` ya rechaza sin cookie. Se conserva
   `router.push("/login")`. Reevaluable como follow-up si se quisiera blindar el
   Router Cache de App Router al pulsar "Atrás".
6. **Ubicación en el `SidebarFooter`.** DESCARTADA tras implementarse: el humano
   prefirió el topbar del `PageHeader` (recuperado de #54). Ver §3.1.

## 5. Contratos I/O

- **Server Action** `logout(deps?: LogoutDeps): Promise<void>` — sin argumentos en
  runtime (los `deps` son solo para inyección en tests). Efectos: elimina la fila
  `Session` (si hay id) y borra la cookie `session`. No retorna payload.
- **Componente** `LogoutButton` (`app/_components/LogoutButton.tsx`): sin props;
  cliente; consume `logout` de `@/lib/actions/auth`, `useRouter` de
  `next/navigation` y `useToast` de `@/hooks/useToast`. Nombre accesible: "Salir"
  ("Saliendo…" mientras
  `isPending`) (R12). Montado por el `PageHeader` compartido en su zona derecha.

## 6. Datos / migraciones / RLS

Ninguna (R13). No se crean tablas ni columnas ni `migration.sql`/`down.sql`. Se
reutiliza `Session` y su repositorio existentes. `pnpm prisma validate` debe
seguir verde y `git diff` no debe añadir nada bajo `db/migrations/`.
