# impl_notificaciones.md — bitácora de implementación (feature 11)

Feature 11 · notificaciones (sistema de toast) · zone: frontend ·
branch: `feature/11-notificaciones` · SDD, spec aprobado y revisado 2026-07-10.

Sistema de toast reutilizable **compuesto sobre `@base-ui/react/toast`**
(decisión humana [RESUELTO-C]) + adaptador puro `messageFromActionError`
([RESUELTO-B]). Cableado de superficies existentes FUERA de alcance
([RESUELTO-A]): no se tocó `/ordenes` ni el `onError` del `Modal`.

## Archivos tocados

### Creados (producción)
- `providers/ToastProvider.tsx` (`"use client"`) — envuelve `Toast.Provider`
  (mapea `defaultDuration`->`timeout`, `max`->`limit`), monta el viewport por
  portal (`role="region"`, `aria-label="Notificaciones"`, `positionClasses`);
  `ToastList` interno consume `useToastManager().toasts`. Exporta los tipos
  públicos `ToastVariant`, `ToastOptions`, `ToastApi`, `ToastProviderProps`.
- `hooks/useToast.ts` (`"use client"`) — `useToast()` memoizado (identidad
  estable, R1); envuelve `useToastManager()`; `show/success/error/info/warning`
  sobre `add(...)` devolviendo el id; `dismiss = close`. Fuera de provider
  re-lanza con mensaje que menciona `ToastProvider` (R2).
- `components/shared/Toast.tsx` (`"use client"`) — presentacional de UN toast:
  `Toast.Root` con `data-variant`, `role` alert/status, `cva` `toastVariants`
  (4 variantes), icono `lucide` por variante (`aria-hidden`),
  `Toast.Title`/`Description` condicional, `Toast.Close aria-label="Cerrar
  notificación"`.
- `lib/utils/action-error-message.ts` — adaptador puro `messageFromActionError`
  (R21). Importa `MSG` y `CODE_BY_DOMAIN_STATUS` de `@/lib/errors/codes` (NO
  modifica `lib/errors/**`). `validation_error` -> `MSG.VALIDATION_ERROR`.

### Modificados (producción)
- `app/(app)/layout.tsx` — el shell (`Sidebar` + `main`) queda envuelto en
  `<ToastProvider>` (R20). `app/layout.tsx` raíz intacto; sin cablear
  consumidores. `app/(app)/ordenes/page.tsx` NO aparece en el diff (verificado).

### Creados (tests)
- `tests/components/ToastProvider.test.tsx` — 21 tests (R1–R6, R9–R20).
- `tests/components/Toast.test.tsx` — 6 tests (R7, R8).
- `tests/unit/utils/action-error-message.test.ts` — 2 tests (R21).

## Mapa R1..R21 -> test (verificable por nombre)

| R | Archivo | Nombre del test |
| --- | --- | --- |
| R1 | ToastProvider.test.tsx | "R1: expone success/error/info/warning/show/dismiss con identidad estable entre renders" |
| R2 | ToastProvider.test.tsx | "R2: useToast fuera de ToastProvider lanza un error descriptivo" |
| R3 | ToastProvider.test.tsx | "R3: ToastProvider renderiza sus children sin alterarlos" |
| R4 | ToastProvider.test.tsx | "R4: toast.success(message) muestra un toast con ese texto" |
| R5 | ToastProvider.test.tsx | "R5: show({variant,message}) devuelve un id y muestra el toast" |
| R6 | ToastProvider.test.tsx | "R6: ids de toasts consecutivos no colisionan" |
| R7 | Toast.test.tsx | "R7: la variante %s expone data-variant y su icono" (4 casos) |
| R8 | Toast.test.tsx | "R8: error y warning usan role=alert" / "R8: success e info usan role=status" |
| R9 | ToastProvider.test.tsx | "R9: los toasts se renderizan en una región accesible montada por portal" |
| R10 | ToastProvider.test.tsx | "R10: auto-descarta tras la duración por defecto" |
| R11 | ToastProvider.test.tsx | "R11: respeta la duración por-toast..." |
| R12 | ToastProvider.test.tsx | "R12: duration 0 persiste (no auto-descarta)" |
| R13 | ToastProvider.test.tsx | "R13: el botón de cierre retira ese toast" |
| R14 | ToastProvider.test.tsx | "R14: dismiss(id) retira el toast correspondiente" / "R14: dismiss con id inexistente es un no-op" |
| R15 | ToastProvider.test.tsx | "R15: pausa mientras el puntero está sobre el toast y reanuda al salir" / "R15: pausa también con foco de teclado..." |
| R16 | ToastProvider.test.tsx | "R16: onDismiss se invoca una vez al auto-descartar" / "R16: onDismiss se invoca una vez al cerrar manualmente" |
| R17 | ToastProvider.test.tsx | "R17: múltiples toasts se apilan y se renderizan simultáneamente" |
| R18 | ToastProvider.test.tsx | "R18: al superar max los más antiguos dejan de mostrarse" |
| R19 | ToastProvider.test.tsx | "R19: retirar un toast no afecta a los demás activos" |
| R20 | ToastProvider.test.tsx | "R20: un componente cliente montado bajo el ToastProvider dispara y ve un toast vía useToast" |
| R21 | action-error-message.test.ts | "mapea cada status de ActionError a su mensaje canónico en español (R21)" / "validation_error devuelve el mensaje genérico (no aplana fieldErrors) (R21 / [RESUELTO-B])" |

Los 21 requisitos tienen >=1 test. Ninguno queda huérfano.

## Salida real de verificación

- `pnpm typecheck` -> limpio (`tsc --noEmit`, sin diagnósticos). Sin `any` propio
  (`useToastManager<Data extends object = any>()` se instancia con el default).
- `pnpm lint` -> limpio (eslint sin hallazgos).
- `pnpm test` (suite completa):
  ```
  Test Files  54 passed (54)
       Tests  413 passed (413)
  ```
  Base previa: 51 files / 384 tests. Delta: +3 files / +29 tests (ToastProvider
  21 + Toast 6 + action-error-message 2 = 29). Sin regresiones: `AppLayout.test.tsx`
  y `OrdenesPage.test.tsx` siguen verdes.
- `./init.sh` -> `== init OK ==` (typecheck + lint + test + validación del arnés).

## Alcance del diff (verificado)

Diff acotado a: `app/(app)/layout.tsx` (modificado) + archivos nuevos de toast/
adaptador + tests + `specs/notificaciones/*`. Confirmado que
`app/(app)/ordenes/page.tsx` NO aparece en el diff.

Nota de saneamiento: durante la implementación un subagente modificó
`scripts/seed-catalogos.ts` (fuera de alcance). Se revirtió (`git checkout`); la
suite siguió en 413/413, confirmando que el cambio era innecesario para esta
feature.

## Limitaciones / notas de test (deuda documentada)

- **R15 (foco de teclado):** SÍ se reproduce de forma fiable en jsdom con esta
  versión de Base UI; se cubrió con test propio además del caso de hover. No se
  añadió lógica de producción solo para el test.
- **R18 (selector):** Base UI NO elimina los toasts excedentes; marca el
  `Toast.Root` más antiguo con `data-limited=""`. El test define "visible" =
  root **sin** `data-limited`, verifica `visibles.length <= 2` con `max={2}` y
  que el más antiguo tiene `data-limited === ""`. (Selector documentado en el
  propio test.)
- **Accesibilidad observada (no bloqueante):** en la pila colapsada Base UI pone
  `aria-hidden="true"` en el `Toast.Root` (y su botón) de forma inconsistente,
  exponiendo el texto en una región `aria-live` clonada aparte. Por eso los
  tests cuentan toasts vía `[data-variant]` (no `getByText`, que duplicaría por
  el clon) y para R8 leen el `role` directo del root (no `getByRole`, que
  excluiría los `aria-hidden`).

## Fuera de alcance (follow-up, según spec)

- Cableado de `/ordenes` y del `onError` del `Modal` para emitir toasts
  ([RESUELTO-A]) — feature separada con su propia actualización de tests.
