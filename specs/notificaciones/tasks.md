# notificaciones — tasks.md

Checklist de implementación de la feature 11 (sistema de toast) **compuesto sobre
`@base-ui/react/toast`** (decisión humana 2026-07-10, [RESUELTO-C]). Cada task tiene
criterio de "hecho" y mapea a requisitos `R<n>` con su(s) test(s). Tests de
componente con Vitest + `@testing-library/react` + `userEvent` en jsdom
(`// @vitest-environment jsdom`), patrón `tests/components/`; auto-descarte y pausa
con `vi.useFakeTimers()`. El adaptador puro se testea en `tests/unit/`.

Símbolos reales usados de Base UI (verificados en
`node_modules/@base-ui/react/toast/index.d.ts`): `Toast.Provider` (props `timeout`,
`limit`), `Toast.Portal`, `Toast.Viewport`, `Toast.Root` (prop `toast`),
`Toast.Title`, `Toast.Description`, `Toast.Close`, y el hook `useToastManager()` →
`{ toasts, add, close, update, promise }` (`add(options) => id`, `close(id)`).
`ToastObject`: `id`, `title`, `type`, `timeout`, `priority`, `onClose`.

Archivos de test previstos:
- `tests/components/ToastProvider.test.tsx` — comportamiento (provider + hook) vía
  un componente-harness que llama `useToast()` y dispara toasts con botones.
- `tests/components/Toast.test.tsx` — presentacional (variante, icono, role, cierre).
- `tests/unit/utils/action-error-message.test.ts` — adaptador `messageFromActionError`.

Convención: `[P]` = paralelizable con sus hermanas una vez cumplida su dependencia.

> Nota Base UI: la primitiva cubre NATIVAMENTE auto-descarte (`timeout`), persistencia
> (`timeout: 0`), pausa por hover/foco, apilado y límite (`limit`), ids únicos, cierre
> programático (`close`) y `onClose`. Por eso varias tasks se reducen a **wiring +
> verificación del requisito observable**, no a implementar la mecánica a mano.

---

## T1 [x] — Tipos y andamiaje del provider sobre Base UI
- Crear `providers/ToastProvider.tsx` (`"use client"`) con los tipos `ToastVariant`,
  `ToastOptions`, `ToastApi`, `ToastProviderProps` de `design.md`. Renderizar
  `<Toast.Provider timeout={defaultDuration} limit={max}>` (de
  `@base-ui/react/toast`) envolviendo `children` + `<Toast.Portal><Toast.Viewport>`
  con un `ToastList` interno que consume `useToastManager().toasts`.
- Crear `hooks/useToast.ts` (`"use client"`) que envuelve `useToastManager()` y
  expone `ToastApi`.
- Exportar `ToastProvider`, `useToast` y los tipos públicos.
- **Hecho:** `pnpm typecheck` pasa; los módulos importan `@base-ui/react/toast` sin
  errores; un harness de test monta `<ToastProvider>` y llama `useToast()`.
- **Depende de:** —

## T2 [x] [P] — Hook: API estable y guarda de provider (R1, R2)
- `useToast()` construye `{ success, error, info, warning, show, dismiss }` sobre
  `add`/`close`, memoizado (`useMemo`) para identidad estable. Fuera de
  `Toast.Provider`, `useToastManager()` no tiene context: propagar/lanzar un error
  descriptivo (envolver si hace falta para el mensaje).
- **Tests (`ToastProvider.test.tsx`):**
  - "useToast expone success/error/info/warning/show/dismiss con identidad estable
    entre renders" (R1).
  - "useToast fuera de ToastProvider lanza un error descriptivo" (R2): harness SIN
    provider → `toThrow`.
- **Depende de:** T1

## T3 [x] — show/variantes → add(); ids y texto (R3, R4, R5, R6)
- `show({message,variant,duration,onDismiss})` llama
  `add({ title: message, type: variant, priority, timeout: duration, onClose })` y
  devuelve el id. `success/error/info/warning` = `show` con `variant` fijado.
- **Tests (`ToastProvider.test.tsx`):**
  - "ToastProvider renderiza sus children sin alterarlos" (R3).
  - "toast.success(message) muestra un toast con ese texto" (R4).
  - "show({variant,message}) devuelve un id y muestra el toast" (R5).
  - "ids de toasts consecutivos no colisionan" (R6): disparar 2, comparar ids.
- **Depende de:** T1, T2

## T4 [x] [P] — Componente presentacional Toast: variante, icono y role (R7, R8)
- Crear `components/shared/Toast.tsx` (`"use client"`): compone `Toast.Root`
  (`toast={toast}`) + `Toast.Title` + `Toast.Close`. Setear `data-variant={toast.type}`,
  icono `lucide` por variante (`cva`), y `role="alert"` para error/warning /
  `role="status"` para success/info. El `ToastList` del provider renderiza un
  `Toast` por item de `useToastManager().toasts`.
- **Tests (`Toast.test.tsx`):** renderizar dentro de un `<Toast.Provider>` mínimo
  (o el `ToastProvider`) y disparar un toast por variante.
  - "cada variante expone data-variant y su icono" (R7).
  - "error y warning usan role=alert; success e info usan role=status" (R8):
    `getByRole("alert")` / `getByRole("status")`.
- **Depende de:** T1

## T5 [x] [P] — Viewport en portal con región accesible (R9)
- `<Toast.Portal><Toast.Viewport role="region" aria-label="Notificaciones"
  className="fixed ...">`. Verificar el nombre accesible y el montaje por portal.
- **Tests (`ToastProvider.test.tsx`):**
  - "los toasts se renderizan en una región accesible montada por portal" (R9):
    `getByRole("region", { name: /notificaciones/i })` contiene los toasts.
- **Depende de:** T3

## T6 [x] — Auto-descarte por timeout (R10, R11, R12) — wiring de Base UI
- Mapear `defaultDuration` → `timeout` del `Toast.Provider` y `duration` → `timeout`
  por-toast en `add`. `duration: 0` ⇒ persistente (NO forzar `timeout` cuando es
  `undefined`; dejar que Base UI use su default). No implementar timers propios.
- **Tests (`ToastProvider.test.tsx`, `vi.useFakeTimers()`):**
  - "auto-descarta tras la duración por defecto" (R10): avanzar el reloj el default.
  - "respeta la duración por-toast" (R11): un toast con `duration` corta desaparece
    antes que uno con la default.
  - "duration 0 persiste (no auto-descarta)" (R12): avanzar el reloj mucho; sigue.
- **Depende de:** T3

## T7 [x] [P] — Cierre manual y programático (R13, R14, R19)
- `Toast.Close` con `aria-label="Cerrar notificación"` (cierra vía Base UI).
  `dismiss(id)` = `close(id)` (no-op si no existe). Cerrar uno no afecta a los demás.
- **Tests (`ToastProvider.test.tsx`):**
  - "el botón de cierre retira ese toast" (R13): click en "Cerrar notificación".
  - "dismiss(id) retira el toast correspondiente; id inexistente es no-op" (R14).
  - "retirar un toast no afecta a los demás activos" (R19): 2 toasts, cerrar uno,
    el otro sigue.
- **Depende de:** T4, T6

## T8 [x] [P] — Pausa/reanudación del auto-descarte (R15) — nativo Base UI
- No implementar pausa a mano: la aporta Base UI (hover/focus del viewport). Task =
  verificar el requisito observable.
- **Tests (`ToastProvider.test.tsx`, `vi.useFakeTimers()`):**
  - "pausa el auto-descarte mientras el puntero está sobre el toast y lo reanuda al
    salir" (R15): `mouseEnter`, avanzar reloj > duración → sigue; `mouseLeave`,
    avanzar → desaparece.
  - (Si el entorno lo permite) "pausa también con foco de teclado dentro del toast"
    (R15): `focusin`/`focusout`. Si jsdom no reproduce la pausa por foco de forma
    fiable, documentarlo en `progress/impl_notificaciones.md` y cubrir R15 con el
    caso de hover; NO añadir lógica propia solo para el test.
- **Depende de:** T6

## T9 [x] [P] — Callback onDismiss (R16) — vía onClose de Base UI
- Pasar `onDismiss` del consumidor como `onClose` en `add`. Base UI lo invoca una
  vez al cerrarse (auto, manual o programático).
- **Tests (`ToastProvider.test.tsx`):**
  - "onDismiss se invoca una vez al auto-descartar" (R16): spy + avanzar reloj.
  - "onDismiss se invoca una vez al cerrar manualmente" (R16): cerrar antes de que
    venza el timer; el spy queda en 1 tras avanzar el reloj.
- **Depende de:** T6, T7

## T10 [x] [P] — Apilado y límite (R17, R18) — vía limit de Base UI
- Mapear `max` → `limit` del `Toast.Provider`. Varios toasts coexisten; al superar
  `limit`, los más antiguos se marcan `data-limited` y dejan de mostrarse.
- **Tests (`ToastProvider.test.tsx`):**
  - "múltiples toasts se apilan y se renderizan simultáneamente" (R17): disparar 3
    con `max` alto → los 3 visibles.
  - "al superar max los más antiguos dejan de mostrarse" (R18): `max={2}`, disparar
    3 → a lo sumo 2 visibles; el más antiguo ya no está visible (o marcado
    `data-limited`). Documentar en el test el selector usado (visibilidad vs
    `data-limited`).
- **Depende de:** T3

## T11 [x] [P] — Adaptador messageFromActionError (R21)
- Crear `lib/utils/action-error-message.ts` (función pura) que mapea el `status` de
  `ActionError` a `MSG[CODE_BY_DOMAIN_STATUS[status]]`. NO modifica `lib/errors/**`
  (solo importa `MSG` y `CODE_BY_DOMAIN_STATUS`).
- **Tests (`tests/unit/utils/action-error-message.test.ts`):**
  - "mapea cada status de ActionError a su mensaje canónico en español" (R21): los 5
    literales → `MSG.*` esperado.
  - "validation_error devuelve el mensaje genérico (no aplana fieldErrors)"
    (R21 / [RESUELTO-B]): assert `MSG.VALIDATION_ERROR`.
- **Depende de:** —

## T12 [x] — Montaje del provider en el layout (R20)
- Envolver el shell de `app/(app)/layout.tsx` con `<ToastProvider>` (dentro del
  layout, sin tocar `app/layout.tsx` raíz). NO cablear consumidores existentes
  ([RESUELTO-A]).
- **Tests (`ToastProvider.test.tsx` o `tests/components/AppLayout.test.tsx`):**
  - "un componente cliente montado bajo el layout puede disparar y ver un toast vía
    useToast" (R20): render de un subárbol envuelto por `ToastProvider` + harness
    consumidor. Verificar que el layout sigue renderizando `Sidebar`/`main` sin
    regresión (no romper `AppLayout.test.tsx` existente).
- **Depende de:** T3, T5

## T13 [x] — Trazabilidad, lint y suite verde
- Completar el mapa `R1..R21 → test` en `progress/impl_notificaciones.md` con la
  salida real de los tests.
- **Hecho:** `pnpm test` (ToastProvider/Toast/action-error-message) verde; suite
  completa sin regresiones (incl. `AppLayout.test.tsx`, `OrdenesPage.test.tsx`);
  `pnpm typecheck` y `pnpm lint` limpios; `./init.sh` en verde; cada `R<n>` mapeado
  a ≥1 test (lo verifica el reviewer, `docs/specs.md` Trazabilidad).
- **Depende de:** T2–T12

---

## Mapa R → test (resumen)

| R | Test | Base UI |
| --- | --- | --- |
| R1 | ToastProvider: "API estable entre renders" | — |
| R2 | ToastProvider: "useToast fuera de provider lanza" | context de `useToastManager` |
| R3 | ToastProvider: "renderiza children sin alterarlos" | — |
| R4 | ToastProvider: "toast.success muestra ese texto" | `Toast.Title` |
| R5 | ToastProvider: "show devuelve id y muestra toast" | `add() => id` |
| R6 | ToastProvider: "ids consecutivos no colisionan" | id nativo |
| R7 | Toast: "data-variant + icono por variante" | `type` |
| R8 | Toast: "role=alert (error/warning) / role=status (success/info)" | `priority` + role propio |
| R9 | ToastProvider: "región accesible por portal" | `Toast.Portal`/`Viewport` |
| R10 | ToastProvider: "auto-descarte por timeout default" | `timeout` nativo |
| R11 | ToastProvider: "respeta timeout por-toast" | `timeout` en `add` |
| R12 | ToastProvider: "timeout 0 persiste" | nativo |
| R13 | ToastProvider: "botón de cierre retira el toast" | `Toast.Close` |
| R14 | ToastProvider: "dismiss(id) retira / no-op si no existe" | `close(id)` |
| R15 | ToastProvider: "pausa/reanuda por hover (y foco)" | pausa nativa |
| R16 | ToastProvider: "onDismiss una vez (auto y manual)" | `onClose` |
| R17 | ToastProvider: "toasts se apilan simultáneamente" | viewport |
| R18 | ToastProvider: "al superar max los antiguos dejan de mostrarse" | `limit`/`data-limited` |
| R19 | ToastProvider: "cerrar uno no afecta a los demás" | — |
| R20 | ToastProvider/AppLayout: "consumidor bajo el layout dispara y ve toast" | — |
| R21 | action-error-message: "mapea ActionError → MSG canónico" | — |

---

### Notas de implementación para los tests
- Usar `vi.useFakeTimers()` + `vi.advanceTimersByTime(ms)` para R10–R12, R15, R16;
  `vi.useRealTimers()` en `afterEach` y `cleanup()` (patrón `BulkUpload.test.tsx`).
- Preferir un **harness** con botones que llamen `useToast()` y `userEvent`/
  `fireEvent` para dispararlos, en vez de invocar la API fuera de React.
- El viewport de Base UI se monta por portal: buscar con `screen.*` (consulta todo
  el documento), no dentro del contenedor devuelto por `render`.
- Para R18, decidir y documentar el selector (visibilidad efectiva vs atributo
  `data-limited`) según cómo Base UI marque los toasts excedentes.
- No romper tests verdes existentes: T12 no cablea consumidores de `/ordenes`
  ([RESUELTO-A]); solo añade el provider al layout.
