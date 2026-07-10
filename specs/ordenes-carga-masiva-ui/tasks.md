# tasks.md — ordenes: carga masiva (botón + modal) (feature 14)

Checklist de implementación. Zona frontend, complejidad low. Todo por composición;
NO se modifica `BulkUpload`, `Modal`, `Toast`/`ToastProvider` ni el endpoint (R19).

Tests en **`tests/components/OrdenesCargaMasivaButton.test.tsx`** (Vitest +
@testing-library/react + userEvent, `// @vitest-environment jsdom`, `cleanup()` entre
tests; patrón de `tests/components/BulkUpload.test.tsx` y `Modal.test.tsx`).
Mocks: `global.fetch` (sin llamada real al endpoint), espía de `useToast`
(mock del hook o del módulo) y espía de `mutate` (`vi.mock("swr")` o envolver en un
`SWRConfig` con `provider`/`mutate` espiado). Verificar props de `BulkUpload`
mockeando `@/components/shared/BulkUpload` con un doble que exponga las props
recibidas y botones para disparar `onSuccess`/`onError`.

Convención de dependencias: T2 depende de T1, etc. `[P]` = paralelizable con sus
hermanas una vez cumplida su dependencia.

---

## [x] T1 — Wrapper local y andamiaje (R19)
- Crear `app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx` (`"use client"`)
  con: estado `open`, `Button` disparador, `Modal` contenedor, `BulkUpload` como
  `children`, y la constante `ORDENES_BULK_FIELDS: TemplateField[]` (11 columnas del
  contrato, en orden — ver `design.md` D3). Importa `useToast` y `useSWRConfig`.
- **Hecho:** `pnpm typecheck` pasa; el componente monta en un test sin errores; el
  diff NO toca `components/shared/BulkUpload.tsx`, `Modal.tsx`, `Toast*`, ni backend.
- **Depende de:** —

## [x] T2 — Montaje del botón en la vista (R1, R2)
- Editar `app/(app)/ordenes/page.tsx` para renderizar `<OrdenesCargaMasivaButton />`
  en una fila de cabecera sobre el `DataTable` (no alterar SWR/paginación).
- **Tests:**
  - "renderiza el botón 'Carga masiva'" (R1): `getByRole("button", { name: /carga masiva/i })`.
  - "el botón es type=button y accesible por teclado" (R2): atributo `type` y foco vía Tab.
- **Depende de:** T1

## [x] T3 [P] — Apertura del modal (R3, R4, R5)
- Cablear `onClick` del botón → `setOpen(true)`; `Modal` con `title="Carga masiva de órdenes"`.
- **Tests:**
  - "al hacer clic en 'Carga masiva' aparece el dialog" (R3): tras `click`,
    `getByRole("dialog")` existe.
  - "el modal muestra el título 'Carga masiva de órdenes'" (R4): dialog con nombre
    accesible ese título.
  - "el cuerpo del modal contiene BulkUpload" (R5): con el doble de `BulkUpload`,
    aparece el marcador del doble (o, sin mock, el input file + botones "Descargar
    plantilla"/"Cargar archivo").
- **Depende de:** T1

## [x] T4 [P] — Modal como contenedor puro y cierre (R6, R7)
- `Modal` con `hideCancel`, `confirmLabel="Cerrar"`, SIN `onConfirm`, `dismissible`
  por defecto.
- **Tests:**
  - "el pie tiene un único botón 'Cerrar' y no un 'Confirmar' de subida" (R6):
    `getByRole("button", { name: /cerrar/i })` presente; `queryByRole("button", { name: /confirmar/i })` null.
  - "clic en 'Cerrar' cierra el modal" (R7): tras `click`, `queryByRole("dialog")` null.
  - "Escape cierra el modal" (R7): `userEvent.keyboard("{Escape}")` → sin dialog.
- **Depende de:** T3

## [x] T5 [P] — Props pasadas a BulkUpload (R8, R9, R10, R11, R12)
- Pasar `endpoint`, `accept`, `fieldName`, `templateFileName`, `fields` según D3.
- **Tests (con doble de `@/components/shared/BulkUpload` que capture props):**
  - "endpoint = /api/ordenes/carga-masiva" (R8).
  - "accept = ['csv','xlsx']" (R9).
  - "fieldName = 'file'" (R10).
  - "fields tiene las 11 keys en orden" (R11): assert
    `fields.map(f => f.key)` === `["num_remision","destinatario","telefono","provincia","canton","distrito","direccion","producto","notas","monto_cobrar","mensajero_sugerido_id"]`.
  - "templateFileName = 'plantilla-ordenes-carga-masiva.csv'" (R12).
- **Depende de:** T3

## [x] T6 — onSuccess: refresh + toast (R13, R14, R15, R17)
- Implementar `handleSuccess`: `parseResumen(result.data)`, `mutate` con matcher de
  claves `["ordenes:list", …]`, toast `success`/`warning`, sin cerrar el modal.
- **Tests (disparar `onSuccess` desde el doble de BulkUpload con un `result` fijo):**
  - "onSuccess llama a mutate con matcher de 'ordenes:list'" (R13): el espía de
    `mutate` recibe una función `key => …` que devuelve true para
    `["ordenes:list", 1, 10]` y false para otras claves.
  - "onSuccess con conError=0 dispara toast.success con creadas/duplicadas/conError" (R14, R15).
  - "onSuccess con conError>0 (o data no parseable) dispara toast.warning" (R15).
  - "onSuccess NO cierra el modal" (R17): el dialog sigue presente tras el callback.
- **Depende de:** T5

## [x] T7 [P] — onError: toast de error, sin refresh (R16)
- Implementar `handleError`: `toast.error` con `error.message`; NO llamar `mutate`.
- **Tests:**
  - "onError dispara toast.error con el message" (R16): el espía de `error` recibe un
    mensaje que incluye `error.message`.
  - "onError no invoca mutate" (R16): el espía de `mutate` no fue llamado.
- **Depende de:** T5

## [x] T8 [P] — Accesibilidad delegada (R18)
- Verificar que la semántica del diálogo y del formulario provienen de `Modal`/`BulkUpload`
  (no reimplementadas).
- **Tests:**
  - "el dialog abierto expone aria-modal" (R18): atributo `aria-modal` en el dialog.
  - "no se añade lógica propia de accesibilidad" (R18): revisión — sin `role`/aria
    manuales sobre el diálogo en el wrapper.
- **Depende de:** T3

## [x] T9 — Trazabilidad, lint y suite verde
- Completar el mapa `R1..R19 → test` en `progress/impl_ordenes-carga-masiva-ui.md`.
- **Hecho:** `pnpm test` (nuevo archivo) verde; `pnpm typecheck` y `pnpm lint`
  limpios; `./init.sh` en verde; cada `R<n>` mapeado a ≥1 test (lo verifica el
  reviewer, `docs/specs.md` Trazabilidad).
- **Depende de:** T2–T8

---

## Mapa R → test (resumen)

| R | Test (título) |
|---|---------------|
| R1 | "renderiza el botón 'Carga masiva'" (T2) |
| R2 | "el botón es type=button y accesible por teclado" (T2) |
| R3 | "al hacer clic aparece el dialog" (T3) |
| R4 | "el modal muestra el título 'Carga masiva de órdenes'" (T3) |
| R5 | "el cuerpo del modal contiene BulkUpload" (T3) |
| R6 | "el pie tiene un único botón 'Cerrar' y no 'Confirmar'" (T4) |
| R7 | "clic en 'Cerrar' cierra" + "Escape cierra" (T4) |
| R8 | "endpoint = /api/ordenes/carga-masiva" (T5) |
| R9 | "accept = ['csv','xlsx']" (T5) |
| R10 | "fieldName = 'file'" (T5) |
| R11 | "fields tiene las 11 keys en orden" (T5) |
| R12 | "templateFileName = 'plantilla-ordenes-carga-masiva.csv'" (T5) |
| R13 | "onSuccess llama a mutate con matcher 'ordenes:list'" (T6) |
| R14 | "onSuccess conError=0 → toast.success con conteos" (T6) |
| R15 | "onSuccess conError>0/no parseable → toast.warning" (T6) |
| R16 | "onError → toast.error, sin mutate" (T7) |
| R17 | "onSuccess NO cierra el modal" (T6) |
| R18 | "dialog expone aria-modal / accesibilidad delegada" (T8) |
| R19 | Criterio de "hecho" T1 + revisión de diff (T9) |

## Notas para los tests
- Doble de `BulkUpload`: `vi.mock("@/components/shared/BulkUpload", …)` devolviendo un
  componente que guarda las props en una ref/variable del test y expone botones
  `data-testid="fire-success"`/`fire-error` que invocan `props.onSuccess({ status:200,
  data:{ total, creadas, duplicadas, conError, filas:[] } })` y `props.onError({ message })`.
- Espiar `mutate`: envolver el render en `<SWRConfig value={{ provider: () => new Map() }}>`
  o `vi.mock("swr", …)` para interceptar `useSWRConfig().mutate`; assert sobre la
  función-matcher recibida evaluándola contra claves de ejemplo.
- Espiar `useToast`: `vi.mock("@/hooks/useToast")` devolviendo `{ success, error, warning, … }`
  como `vi.fn()`.
- El `ToastProvider` real ya está en `app/(app)/layout.tsx`; en tests se mockea el hook
  para no depender del provider.
