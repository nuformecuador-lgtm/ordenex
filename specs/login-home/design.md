# Diseño — login(home)

## Enfoque general

Esta feature es puramente de UI. Consume el contrato ya congelado de la
feature `login`:

- Server Actions `login`, `verifyChallenge`, `logout` en `lib/actions/auth.ts`.
- Tipos `LoginInput`, `VerifyChallengeInput`, `LoginResult` en
  `lib/types/auth.ts` (incluye el `status: "otp_invalid"` de `verifyChallenge`,
  que no debe confundirse con `invalid_credentials` de `login`).
- `middleware.ts` ya trata `/login` como ruta pública y ya redirige a
  `/login?redirect=<pathname>` cuando falta la cookie `session`.

No se modifica `lib/actions/auth.ts` ni `lib/types/auth.ts`, ni el modelo de
datos, ni `middleware.ts` en su lógica de protección de rutas (solo se lee
el query param `redirect` que `middleware.ts` ya produce).

## Estructura de componentes

```
app/
  login/
    page.tsx                 Server Component (ruta /login)
      - lee el searchParam `redirect` y lo pasa como prop de solo lectura
        al formulario cliente (no ejecuta lógica de negocio).
      - redirección de sesión activa (R24): lee la cookie `session` vía
        `cookies()` y, si existe, valida la sesión server-side con
        `SessionRepository.findValidById(sessionId)` (método ya existente de
        la feature `login`, que descarta sesiones expiradas — ejercita R23a
        del backend). Si la sesión es válida, `redirect("/")` antes de
        renderizar el formulario. Este chequeo vive aquí, nunca en el Client
        Component ni en `middleware.ts`.
    _components/
      login-form.tsx          Client Component ('use client')
        - estado del formulario de credenciales (email, password)
        - estado de fase: 'credentials' | 'challenge'
        - estado de challengeId, código OTP
        - estado de carga/pending (useTransition o estado local)
        - invoca `login(...)` / `verifyChallenge(...)` importados desde
          `@/lib/actions/auth`
        - validación de cliente con zod (reutiliza los mismos criterios que
          `lib/types/auth.ts`: formato email, password no vacía, código de
          6 dígitos) para dar feedback inmediato antes de tocar la Server
          Action (R3, R4, R14). El backend sigue siendo la fuente de verdad;
          esta validación es solo UX y nunca reemplaza R11/R18.
      credentials-fields.tsx  Subcomponente presentacional (opcional, solo si
        `login-form.tsx` crece demasiado) — inputs de email/password con
        label, error y aria-describedby.
      challenge-fields.tsx    Subcomponente presentacional del input de OTP.
```

Justificación de Server Component + Client Component: `docs/architecture.md`
exige que las páginas (Server Components) validen permisos vía `cookies()` y
que la interacción de formulario (estado, eventos) viva en el cliente. La
página `/login` en sí no necesita datos sensibles; solo reenvía el query
param de redirección, así que el Server Component es mínimo.

## Componentes de UI (shadcn/ui + Tailwind)

El repo aún no tiene `components.json` ni `components/ui/`. Se agregan solo
las primitivas necesarias vía `npx shadcn add <componente>` (no se escriben a
mano si shadcn las provee, según `docs/architecture.md`):

- `input` — campos de correo, contraseña, código OTP.
- `label` — etiquetas asociadas (`htmlFor`/`id`).
- `button` — envío de formulario y de código OTP, con estado `disabled` +
  spinner/texto de carga mientras `pending`.
- `card` — contenedor visual del formulario (opcional, uso puramente
  estético).
- `alert` (o reutilizar `role="alert"` simple si `alert` no cubre el caso) —
  mensajes de error generales (`invalid_credentials`, `account_unavailable`,
  `account_locked`, `otp_invalid`).

Estas primitivas van a `components/ui/` (regla del repo: primitivas
shadcn ahí, nunca reimplementadas a mano). `login-form.tsx` y sus
subcomponentes viven junto a la página (`app/login/_components/`) porque solo
esta feature los usa (regla "sin sobre-ingeniería" de `docs/architecture.md`:
se promueven a `components/shared/` solo si otra feature los necesita con la
misma API).

## Contrato de invocación desde el cliente

`login-form.tsx` importa directamente las Server Actions:

```ts
import { login, verifyChallenge } from "@/lib/actions/auth";
```

Esto es consistente con `docs/architecture.md` ("mutación desde componente
propio → Server Action", "NO usar fetch a rutas API internas para
mutaciones"). No se crea ningún route handler nuevo para esta feature.

Flujo:
1. Fase `credentials`: submit → validación de cliente → si pasa,
   `await login({ email, password })` dentro de un `startTransition`/estado
   `isPending` propio (R6, R6a).
2. Según `result.status`:
   - `"ok"` → `router.push(redirectTarget)` (R7).
   - `"challenge_required"` → set fase a `challenge`, guarda `challengeId`
     en estado (R12).
   - `"invalid_credentials" | "account_unavailable" | "account_locked" |
     "validation_error"` → set estado de error correspondiente, sin cambiar
     de fase (R8–R11).
3. Fase `challenge`: submit del código → validación de cliente (6 dígitos) →
   `await verifyChallenge({ challengeId, code })`.
4. Según `result.status`:
   - `"ok"` → misma redirección que R7 (R16).
   - `"otp_invalid"` → mensaje de error, se mantiene fase `challenge` y
     `challengeId` (R17).
   - `"validation_error"` → error bajo el campo de código (R18).

`redirectTarget` se calcula en el cliente a partir del prop `redirect`
recibido desde el Server Component página (que a su vez lo lee de
`searchParams`), validando que empiece con `/` y no con `//` (protección
básica de open-redirect) antes de usarlo en `router.push`; si no es válido,
usa `/`.

## Manejo de estado

- `useState` para: fase (`credentials` | `challenge`), valores de campos,
  errores por campo (`Record<string, string[]>`), error general (string |
  null), `challengeId` (string | null), `isPending` (boolean).
- No se usa SWR: esta pantalla no hace *fetching* de datos públicos, son
  mutaciones (Server Actions), consistente con la tabla de
  `docs/architecture.md` ("Mutación desde componente propio → Server
  Action"). SWR queda fuera de alcance de este formulario.
- No se usa un store global (Redux/Zustand): el estado es local a un único
  formulario de una sola pantalla; no hay necesidad de compartirlo entre
  componentes no relacionados (regla "sin sobre-ingeniería").

## Redirección tras éxito

`useRouter().push(redirectTarget)` desde el Client Component tras `status:
"ok"` (tanto en `login` como en `verifyChallenge`). Se usa `push` (no
`replace`) para mantener consistencia con la navegación estándar de Next;
no hay requisito que pida bloquear el botón "atrás" del navegador tras login.

## Botón mínimo de logout en la home (R25, R26) — cierra el E2E (T021 de `login`)

Decisión cerrada #1 de `requirements.md`: no existe todavía una pantalla de
"home autenticado". Para cerrar el diferimiento T021 de
`specs/login/tasks.md` (E2E que cubre login exitoso, credenciales inválidas,
cuenta bloqueada y logout), esta feature agrega el mínimo indispensable:

- `app/page.tsx` pasa a ser (o envolver) un chequeo server-side de sesión:
  lee la cookie `session` y valida con `SessionRepository.findValidById`. Si
  hay sesión válida, renderiza un botón "Cerrar sesión" (R25); si no, no lo
  muestra. En la práctica, un usuario sin sesión válida ni siquiera llega a
  `/` porque `middleware.ts` lo redirige a `/login`; el chequeo explícito de
  R25 cubre el caso de forma robusta e independiente del middleware.
- El botón invoca la Server Action `logout()` (ya implementada en la feature
  `login`). Se implementa como un pequeño Client Component (`'use client'`)
  con handler que llama a `logout()` y luego `router.push("/login")`, o como
  `<form action={logout}>` seguido de redirección; cualquiera de los dos es
  válido porque es una mutación de un solo paso sin datos intermedios (R26).
- Esto NO es una feature de dashboard; es una afordancia mínima, documentada
  con un comentario en el código para no confundirla con una decisión de
  producto definitiva. Si en el futuro existe una feature de "home
  autenticado", ese botón se reemplaza/mueve ahí.

## Alternativas descartadas

1. **Formulario con Server Action como `action` nativo de `<form>`
   (progressive enhancement, sin JS) en vez de Client Component controlado
   con `useState`/event handlers.** Descartada porque el flujo tiene una
   transición de fase no trivial (`credentials` → `challenge_required` →
   verificación de OTP) que depende de datos devueltos por la Server Action
   (`challengeId`) para decidir qué UI mostrar a continuación; el patrón
   `<form action={...}>` nativo de Next solo maneja bien flujos de una sola
   mutación con redirect o revalidate, no una máquina de estados de dos
   pasos con datos intermedios en el cliente. Además, se necesita validar en
   cliente antes de invocar la acción (R3, R4, R14) y mostrar estados
   `isPending` granulares por fase, lo cual es más directo con invocación
   explícita (`await login(...)`) dentro de un Client Component.
2. **Ruta API (`app/api/login/route.ts`) + `fetch` desde el cliente en vez de
   invocar la Server Action directamente.** Descartada por violar
   explícitamente la tabla de `docs/architecture.md` ("Mutación desde
   componente propio → Server Action", "no usar fetch a rutas API internas
   para mutaciones") y por duplicar innecesariamente el borde de validación
   zod que ya existe en `lib/actions/auth.ts`.
3. **Guardar el estado del formulario en la URL (query params) en vez de
   estado de React local.** Descartada porque expondría el `challengeId` y
   potencialmente fragmentos de estado de autenticación en el historial del
   navegador/logs de acceso, lo cual es una fuga innecesaria de un dato
   sensible del flujo de login.

## Trazabilidad prevista

- R1, R2, R19, R23 → tests de componente (React Testing Library o similar)
  sobre `login-form.tsx`: existencia de labels asociadas, roles, tab order.
- R3, R4, R14, R21, R22 → tests de componente: validación de cliente sin
  invocar la Server Action (mock de `login`/`verifyChallenge` con spy que
  verifica 0 llamadas), foco tras error.
- R5, R6, R6a, R15 → tests de componente con mock de la Server Action:
  verifica una sola invocación con el payload correcto y estado
  `disabled`/pending durante la promesa.
- R7, R16 → test de componente/E2E: mock/response `"ok"` → `router.push`
  llamado con el target esperado (con y sin `redirect` válido/ inválido).
- R8, R9, R10, R11, R12, R13, R17, R18 → tests de componente: un mock de
  `login`/`verifyChallenge` por cada `status` posible, verificando el
  mensaje/estado esperado.
- R20 → test de componente: cada error renderizado tiene `role="alert"` (o
  `aria-live`) y `aria-describedby` apuntando al id del campo.
- R24 → test (integración/E2E) del Server Component `app/login/page.tsx`: con
  cookie de sesión válida → `redirect("/")`; sin cookie o con sesión
  expirada → renderiza el formulario.
- R25, R26 → test de componente + E2E: botón "Cerrar sesión" visible solo con
  sesión válida; al activarlo se invoca `logout` y una ruta protegida vuelve
  a redirigir a `/login`.
- R27 → test de componente: los mensajes de los distintos `status` no son
  idénticos entre sí y `account_locked` incluye `retryAfterMinutes`.
- Cobertura E2E (Playwright, ver `tasks.md`): login exitoso, credenciales
  inválidas, cuenta bloqueada, logout — cierra T021 de `specs/login/tasks.md`.
