# modal — tasks.md

Checklist de implementación de la feature 13 (`Modal`). Cada task tiene criterio de
"hecho" y mapea a requisitos `R<n>` con su(s) test(s) en
`tests/components/Modal.test.tsx` (Vitest + @testing-library/react + userEvent,
`// @vitest-environment jsdom`, patrón de `tests/components/BulkUpload.test.tsx`).

Convención de dependencias: T2 depende de T1, etc. `[P]` = paralelizable con sus
hermanas una vez cumplida su dependencia.

---

## T1 — Andamiaje del componente y contrato de props
- Crear `components/shared/Modal.tsx` (`"use client"`) con `ModalProps` de
  `design.md`, componiendo `@base-ui/react/dialog` (Root/Portal/Backdrop/Popup/
  Title/Description) + `Button` de `@/components/ui/button`.
- Exporta `Modal` y `ModalProps`.
- **Hecho:** `pnpm typecheck` pasa; el módulo importa sin errores; helper de test
  `renderModal(props)` puede montarlo.
- **Depende de:** —

## T2 [P] — Visibilidad controlada (R1, R2, R3, R4)
- Cablear `open` → `Dialog.Root`; `onOpenChange` del Root → prop `onOpenChange`.
- **Tests:**
  - "no renderiza el diálogo cuando open es false" (R1): `queryByRole("dialog")` es
    null.
  - "renderiza rol dialog cuando open es true" (R2).
  - "invoca onOpenChange(false) al cerrar y no muta open" (R3, R4): open sigue true
    tras el cierre; el spy recibió `false`.
- **Depende de:** T1

## T3 [P] — Título, descripción, children y acciones (R5, R6, R7, R8, R9, R10)
- Render de `title` (Dialog.Title), `description` condicional (Dialog.Description),
  `children` en el cuerpo, botones confirmar/cancelar con labels default.
- **Tests:**
  - "asocia el título con aria-labelledby" (R5).
  - "asocia la descripción con aria-describedby solo si se provee" (R6).
  - "renderiza children arbitrarios en el cuerpo" (R7): p. ej. un `<button>Hijo>`.
  - "muestra confirmar y cancelar con labels por defecto y personalizados" (R8).
  - "confirmar sin onConfirm no lanza (no-op)" (R9).
  - "no renderiza cancelar cuando hideCancel es true" (R10).
  - "el botón de confirmar recibe la variante default por defecto" (R8b).
  - "el botón de confirmar recibe la variante destructive cuando
    confirmVariant='destructive'" (R8b): aserción sobre la clase/atributo de
    variante destructiva del `Button` (p. ej. estilos `destructive` de
    `buttonVariants`).
- **Depende de:** T1

## T4 — Confirmar/cancelar síncrono (R11, R12, R13)
- `handleConfirm` rama síncrona + cierre según `closeOnConfirm`; `handleCancel`.
- **Tests:**
  - "invoca onConfirm una vez al confirmar (síncrono)" (R11).
  - "cierra tras confirmar síncrono cuando closeOnConfirm no es false" (R12).
  - "no cierra tras confirmar síncrono cuando closeOnConfirm es false" (R12/R21).
  - "cancelar invoca onCancel y onOpenChange(false)" (R13).
- **Depende de:** T2, T3

## T5 — Flujo async: spinner, bloqueo y anti-doble-submit (R14, R15, R16, R17, R18)
- Detección de thenable; estado `pending`; spinner `Loader2` + `disabled` en
  confirmar; `role="status"`/`aria-busy`; guarda anti-doble-submit.
- **Tests (usar promesa diferida controlada por el test):**
  - "entra en pending mientras la promesa está sin resolver" (R14).
  - "muestra spinner en el botón de confirmación durante pending" (R15).
  - "deshabilita el botón de confirmación durante pending" (R16).
  - "no invoca onConfirm dos veces si se acciona de nuevo durante pending" (R17):
    `onConfirm` llamado 1 vez.
  - "anuncia carga con role=status/aria-busy durante pending" (R18).
- **Depende de:** T4

## T6 [P] — Bloqueo de cierre durante pending (R19)
- Durante `pending`: cancelar y cierre deshabilitados; ignorar Escape y overlay;
  `disablePointerDismissal` activo.
- **Tests:**
  - "no cierra por Escape mientras está pending" (R19).
  - "no cierra por overlay mientras está pending" (R19).
  - "botón cancelar deshabilitado / no cierra mientras está pending" (R19).
- **Depende de:** T5

## T7 [P] — Resolución del confirmar async (R20, R21)
- Al resolver: salir de pending; cerrar si `closeOnConfirm !== false`, si no
  permanecer abierto.
- **Tests:**
  - "cierra al resolver la promesa cuando closeOnConfirm no es false" (R20):
    `onOpenChange(false)` tras `await`.
  - "permanece abierto al resolver cuando closeOnConfirm es false" (R21):
    `onOpenChange` no recibió false; sale de pending (spinner desaparece).
- **Depende de:** T5

## T8 [P] — Rechazo, onError y reintento (R22, R23, R24)
- Al rechazar: salir de pending, no cerrar, reactivar botones (confirmar y
  cancelar), invocar `onError(error)`. NO renderizar mensaje de error propio ni
  guardar estado de error. Al reintentar, invocar `onConfirm` de nuevo.
- **Tests:**
  - "no cierra el modal al rechazar la promesa" (R22): `onOpenChange` no recibió
    false; el modal sigue abierto.
  - "reactiva confirmar y cancelar y detiene el spinner al rechazar" (R22): spinner
    desaparece; botones ya no están `disabled`.
  - "invoca onError con el error capturado al rechazar y no renderiza error propio"
    (R23): `onError` recibe el error; no existe `role="alert"` en el diálogo.
  - "reintenta onConfirm al confirmar de nuevo tras un rechazo" (R24): `onConfirm`
    llamado 2 veces.
- **Depende de:** T5

## T9 [P] — Cierre por Escape y overlay + dismissible (R25, R26, R27)
- Filtrado por `details.reason` en `onOpenChange`; `dismissible=false` bloquea
  Escape/overlay pero no los botones.
- **Tests:**
  - "cierra con Escape cuando no está pending y dismissible no es false" (R25).
  - "cierra al hacer clic en el overlay en las mismas condiciones" (R26).
  - "no cierra por Escape ni overlay cuando dismissible es false, pero sí por
    botones" (R27).
- **Depende de:** T2

## T10 [P] — Accesibilidad de foco y aria-modal (R28, R29, R30, R31)
- Verificar `aria-modal`, foco inicial dentro del diálogo y focus trap (provistos
  por Base UI `modal`). R31 se satisface por delegación: NO añadir test de
  restauración de foco al disparador (decisión humana); basta con no implementar
  lógica propia de restauración.
- **Tests:**
  - "el diálogo expone aria-modal cuando está abierto" (R28).
  - "mueve el foco al interior del diálogo al abrir" (R29).
  - "atrapa el foco con Tab dentro del diálogo" (R30).
- **Depende de:** T2, T3

## T11 — Trazabilidad, lint y suite verde
- Completar el mapa `R1..R30 → test` en `progress/impl_modal.md`.
- **Hecho:** `pnpm test` (Modal.test.tsx) verde; `pnpm typecheck` y `pnpm lint`
  limpios; `./init.sh` en verde; cada `R<n>` mapeado a ≥1 test (lo verifica el
  reviewer, `docs/specs.md` Trazabilidad).
- **Depende de:** T2–T10

---

### Notas de implementación para los tests
- Usar una **promesa diferida** (`let resolve/reject; new Promise(...)`) para
  controlar el instante de resolución/rechazo y aserciones en pending.
- Preferir `userEvent` para clics/teclado (`{Escape}`); `findBy*`/`waitFor` tras
  `await` de promesas.
- El overlay/backdrop de Base UI se renderiza en portal: localizarlo por su
  `data-*`/rol o vía el elemento backdrop; documentar el selector usado.
- `cleanup()` entre tests (jsdom) como en `BulkUpload.test.tsx`.
