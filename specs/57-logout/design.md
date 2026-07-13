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
| Botón ad-hoc previo | `app/_components/LogoutButton.tsx` (usado en `app/(app)/page.tsx`) | client, `useTransition` → `await logout(); router.push("/login")`; muestra "Cerrando sesión…"; el comentario del `page.tsx` dice explícitamente que debe moverse/reemplazarse cuando exista el shell definitivo |
| Shell autenticado | `app/(app)/layout.tsx` + `app/(app)/_components/Sidebar.tsx` | `<SidebarProvider><Sidebar items={…}/><SidebarInset>{children}</SidebarInset></SidebarProvider>`; items filtrados por rol vía `itemsVisibles(SIDEBAR_ITEMS, actor)` |
| Footer del sidebar | `components/ui/sidebar.tsx` → `SidebarFooter` | primitiva ya exportada, **hoy sin usar** |
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
- **Frontend (el trabajo real):** montar el control en el `SidebarFooter`, cablear
  el flujo click → [¿confirmación?] → `logout()` → redirección con invalidación de
  caché, y retirar el botón ad-hoc de `page.tsx`.
- **Orden:** backend (verificar) → frontend (construir). Un solo ciclo; el
  implementer delega backend_dev (verificación/no-op) → frontend_dev (UI+flujo).

## 3. Diseño frontend

### 3.1 Ubicación del control (F1.4-a → recomendación: sidebar footer)

Añadir un `SidebarFooter` al final de `app/(app)/_components/Sidebar.tsx` con un
`SidebarMenu` de un solo `SidebarMenuItem`: el control "Cerrar sesión" con icono
`LogOut` de `lucide-react` (mismo patrón de iconos que el resto del sidebar).
El control **no** depende de la prop `items` (que se filtra por rol): se renderiza
siempre que el shell autenticado esté montado ⇒ visible para todos los roles
(R1, R2). El shell solo se monta bajo sesión (middleware) ⇒ no aparece en público
(R3).

Reutilización del comportamiento: la lógica de `app/_components/LogoutButton.tsx`
(useTransition → `logout()` → redirección, estado "Cerrando sesión…", bloqueo) se
conserva. Opciones equivalentes para el implementer (a elegir, sin sobre-diseñar):
(i) renderizar el `LogoutButton` existente dentro del `SidebarFooter`; o
(ii) presentar un `SidebarMenuButton` con icono que dispare la misma lógica. Se
prefiere (ii) por consistencia visual con el resto de ítems del sidebar, moviendo
la lógica de logout a un componente cliente pequeño (p. ej.
`SidebarLogoutButton`) que reusa la Server Action `logout` (sin duplicar backend).

### 3.2 Flujo click → invalidación → redirección → no-back (R4–R9)

```
onClick
  → startTransition(async () => {
        try {
          await logout();            // Server Action existente: borra fila Session + expira cookie "session"
          router.replace("/login");  // R7: va a /login y saca la ruta protegida del history
          router.refresh();          // R8: invalida el Router Cache (RSC) de páginas protegidas
        } catch (e) {
          // R10: NO navegar; feedback (toast de la feature 11) + control accionable
        }
     })
```

**Por qué `router.replace` + `router.refresh` (R8, no-back):** el `middleware.ts`
ya es el guard server-side: una vez borrada la cookie `session`, cualquier
navegación real a una ruta protegida se redirige a `/login`. El punto fino es el
**Router Cache** de App Router: tras el logout, el payload RSC de la página
protegida previa podría servirse desde caché de cliente al pulsar "Atrás".
`router.refresh()` invalida ese caché ⇒ pulsar "Atrás" fuerza una nueva petición
que el middleware intercepta. `router.replace("/login")` (en vez de `push`)
sustituye la entrada de la ruta protegida en el history, de modo que "Atrás" no
retrocede a ella. Combinados satisfacen R8 sin nuclearizar. Las navegaciones
client-side de App Router son mismo-documento, por lo que el bfcache del navegador
no restaura snapshots de la SPA; no hace falta `no-store` global.

> **Cambio respecto al botón ad-hoc:** el `LogoutButton` actual usa
> `router.push("/login")` sin `refresh()`. Feature 57 cambia a
> `router.replace("/login") + router.refresh()`. Esto implica **actualizar** el
> test existente `tests/components/LogoutButton.test.tsx` (hoy afirma `push`) para
> afirmar `replace` + `refresh` (queda mapeado en tasks/trazabilidad).

### 3.3 Unificar el control (R14)

Retirar el botón ad-hoc de `app/(app)/page.tsx` (el bloque `hasValidSession && …`
con `<LogoutButton/>`) para que solo exista el control del sidebar y no aparezcan
dos "Cerrar sesión" (los tests que buscan `getByText("Cerrar sesión")` fallarían
por match múltiple). El E2E `e2e/auth.spec.ts` (bloque "(d) Logout using home
button") seguirá encontrando "Cerrar sesión" porque el sidebar está en el layout
que envuelve la home; se ajusta el comentario/selector si hiciera falta.

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
   de lo necesario; `middleware` (guard) + `router.replace` + `router.refresh`
   satisfacen R8 con menor coste y mejor UX (sin recarga completa).
5. **Cabeceras `Cache-Control: no-store` en el layout autenticado.** DESCARTADA
   como solución primaria: el guard de `middleware` ya rechaza sin cookie y
   `router.refresh()` invalida el Router Cache; añadir `no-store` global sería
   sobre-ingeniería. Se deja como nota, no como requisito.

## 5. Contratos I/O

- **Server Action** `logout(deps?: LogoutDeps): Promise<void>` — sin argumentos en
  runtime (los `deps` son solo para inyección en tests). Efectos: elimina la fila
  `Session` (si hay id) y borra la cookie `session`. No retorna payload.
- **Componente** `SidebarLogoutButton` (o reuso de `LogoutButton`): sin props;
  cliente; consume `logout` de `@/lib/actions/auth` y `useRouter` de
  `next/navigation`. Nombre accesible: "Cerrar sesión" (R12).

## 6. Datos / migraciones / RLS

Ninguna (R13). No se crean tablas ni columnas ni `migration.sql`/`down.sql`. Se
reutiliza `Session` y su repositorio existentes. `pnpm prisma validate` debe
seguir verde y `git diff` no debe añadir nada bajo `db/migrations/`.
