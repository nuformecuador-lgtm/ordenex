# impl_modal.md — Feature 13 (`Modal`)

Rama: `feature/13-modal`. Frontend puro. Spec aprobada por humano 2026-07-09.

## Veredicto

**VERDE.** 34 tests de `Modal` verdes; suite completa 379/379; typecheck y lint
limpios; `./init.sh` en verde. Cada requisito `R1..R30` mapeado a ≥1 test. R31
(restauración de foco) se delega a Base UI sin test propio, por decisión humana.

## Archivos tocados

- **Creado** `components/shared/Modal.tsx` — componente `Modal` + `ModalProps`,
  compuesto sobre `@base-ui/react/dialog` (Root/Portal/Backdrop/Popup/Title/
  Description) y `@/components/ui/button`. `"use client"`. Toda la lógica async
  (spinner `Loader2`, bloqueo, anti-doble-submit, resolución/rechazo, `onError`).
- **Creado** `tests/components/Modal.test.tsx` — 34 tests (Vitest + Testing Library
  + userEvent, `@vitest-environment jsdom`).
- **Editado** `specs/modal/tasks.md` — nota de estado T1–T11 completadas.

## Decisiones de implementación relevantes (frente al design)

Se sondeó el comportamiento real de `@base-ui/react@1.6.0` en jsdom antes de fijar
los tests. Dos ajustes respecto a supuestos del `design.md`, sin desviarse de los
requisitos:

1. **R28 `aria-modal`.** El design asumía que el `modal` por defecto del
   `Dialog.Root` emitía `aria-modal="true"`. En esta versión, Base UI aísla el
   resto del documento con `data-base-ui-inert` y NO escribe `aria-modal`. Para
   cumplir R28 se pasa `aria-modal="true"` explícito al `Dialog.Popup` (atributo
   correcto y estándar para un diálogo modal; los props se reenvían al `<div>`).
2. **R17 anti-doble-submit.** Además del botón `disabled` durante `pending`, se
   añadió un espejo síncrono `pendingRef` para cerrar la ventana de carrera entre
   dos clicks emitidos antes de que React re-renderice con el `disabled` aplicado
   (la guarda basada solo en estado sufría de stale-closure). Doble red: `disabled`
   + `pendingRef`.

Overlay/backdrop localizado en tests por `data-testid="modal-backdrop"` (prop
reenviada al `Dialog.Backdrop`). Escape y clic en overlay disparan el
`onOpenChange(open,details)` de Base UI, filtrado por `details.reason`
(`escape-key` / `outside-press`) para R25–R27 y por fase para R19.

## Mapa de trazabilidad R<n> → test (`tests/components/Modal.test.tsx`)

| R | Requisito (resumen) | Test |
| --- | --- | --- |
| R1 | No renderiza diálogo con `open=false` | "R1: no renderiza el diálogo cuando open es false" |
| R2 | Rol `dialog` con `open=true` | "R2: renderiza un contenedor rol dialog cuando open es true" |
| R3 | Cierre → `onOpenChange(false)`, no muta `open` | "R3/R4: al cerrar invoca onOpenChange(false) y no muta open por sí mismo" |
| R4 | Invoca `onOpenChange` con booleano | "R3/R4: ..." (recibe `false`) |
| R5 | Título vía `aria-labelledby` | "R5: asocia el título con aria-labelledby" |
| R6 | `description` vía `aria-describedby` solo si se provee | "R6: asocia la descripción con aria-describedby solo si se provee" + "R6: sin description no expone aria-describedby" |
| R7 | `children` arbitrarios en el cuerpo | "R7: renderiza children arbitrarios en el cuerpo" |
| R8 | Botones confirmar/cancelar con labels default y custom | "R8: ... labels por defecto" + "R8: ... labels personalizados" |
| R8b | `confirmVariant` → variante del Button (default/destructive) | "R8b: ... variante default por defecto" + "R8b: ... variante destructive ..." |
| R9 | Sin `onConfirm` → no-op sin fallar | "R9: confirmar sin onConfirm no lanza (no-op) y cierra por defecto" |
| R10 | `hideCancel` oculta cancelar | "R10: no renderiza cancelar cuando hideCancel es true" |
| R11 | `onConfirm` síncrono invocado una vez | "R11: invoca onConfirm una sola vez al confirmar (síncrono)" |
| R12 | Cierra tras confirmar síncrono si `closeOnConfirm≠false` | "R12: cierra tras confirmar síncrono ..." + "R12/R21: no cierra ... cuando closeOnConfirm es false" |
| R13 | Cancelar → `onCancel` + `onOpenChange(false)` | "R13: cancelar invoca onCancel y onOpenChange(false)" |
| R14 | Promesa → estado pending | "R14/R15/R16/R18: entra en pending ..." |
| R15 | Spinner en botón confirmar durante pending | "R14/R15/R16/R18: ..." (`.animate-spin` dentro de `role=status`) |
| R16 | Botón confirmar `disabled` durante pending | "R14/R15/R16/R18: ..." (`toBeDisabled`) |
| R17 | No re-invoca `onConfirm` durante pending | "R17: no invoca onConfirm una segunda vez ..." |
| R18 | Anuncio de carga (`role=status` / `aria-busy`) | "R14/R15/R16/R18: ..." (`role=status` + `aria-busy=true`) |
| R19 | Bloqueo de cierre durante pending (Escape/overlay/cancelar) | 3 tests "R19: ... Escape / overlay / cancelar deshabilitado" |
| R20 | Resolver → sale de pending y cierra si `closeOnConfirm≠false` | "R20: cierra al resolver la promesa ..." |
| R21 | `closeOnConfirm=false` → permanece abierto al resolver | "R21: permanece abierto al resolver ..." (+ síncrono en "R12/R21") |
| R22 | Rechazo → no cierra, reactiva botones | "R22: no cierra el modal al rechazar la promesa y reactiva los botones" |
| R23 | Rechazo → `onError(error)`, sin render de error propio | "R23: invoca onError con el error capturado y no renderiza error propio" |
| R24 | Reintento tras rechazo re-invoca `onConfirm` | "R24: reintenta onConfirm al confirmar de nuevo tras un rechazo" |
| R25 | Escape cierra (no pending, dismissible≠false) | "R25: cierra con Escape ..." |
| R26 | Overlay cierra (mismas condiciones) | "R26: cierra al hacer clic en el overlay ..." |
| R27 | `dismissible=false` bloquea Escape/overlay pero no botones | "R27: no cierra por Escape ni overlay ..." + "R27: con dismissible false, los botones sí cierran" |
| R28 | `aria-modal="true"` con `open` | "R28: el diálogo expone aria-modal='true' cuando está abierto" |
| R29 | Foco inicial dentro del diálogo | "R29: mueve el foco al interior del diálogo al abrir" |
| R30 | Focus trap (Tab envuelve dentro) | "R30: atrapa el foco con Tab dentro del diálogo ..." |
| R31 | Restauración de foco delegada a Base UI | Sin test propio (decisión humana 2026-07-09) — no se implementa lógica propia |

## Salida final de tests

```
tests/components/Modal.test.tsx  → 34 passed (34)

./init.sh:
  pnpm typecheck  → OK (0 errores)
  pnpm lint       → OK (0 errores)
  pnpm test       → Test Files 51 passed (51) · Tests 379 passed (379)
  ✓ todas las migraciones tienen down.sql
  ✓ .env presente
  == init OK ==
```
