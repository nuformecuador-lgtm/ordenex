# requirements.md — enriquecer validación previa a la carga masiva (feature 29)

> Enriquece el paso de resumen de la carga masiva de órdenes (feature 16). Al
> procesar el archivo (chequeado por `num_remision`), la UI debe SEPARAR las
> órdenes ya EXISTENTES de las NUEVAS, mostrar las existentes con su ESTADO
> ACTUAL sin permitir recargarlas, dejar explícito que solo se cargan las nuevas,
> y CONSERVAR el select de mensajero por fila que aporta la feature 16.
>
> Zona: **frontend** · Complejidad: **medium** · depends_on: **16 (done)**.
>
> **Alcance NO negociable:** FRONTEND puro. Consume el backend YA EXISTENTE de
> las features 15/16. NO se crea/toca backend, DB, migraciones ni Server Actions.
>
> **Decisión humana (puerta F1.4, 2026-07-10) — FIRME:** se aprueba la **opción A**
> (enriquecer el reporte POST-COMMIT del `BulkSummary`, frontend puro). Ver las 4
> resoluciones al final ("Preguntas abiertas → Ninguna pendiente").

## Anclas reales del repo (verificadas, no se inventan APIs)

- `lib/types/carga-masiva.ts`:
  - `BulkSummary = { total, creadas, duplicadas, conError, filas: RowResult[] }`.
  - `RowResult = { fila: number, numRemision: string, resultado: "creada"|"duplicada"|"error", estatus?: string, errores?: Record<string,string[]> }`.
  - Cada fila `duplicada` (= ya existente) YA trae su `estatus` (estado actual de
    la orden) y su `numRemision`. Hoy esa información se **descarta** en el frontend.
- `app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx` (feature 14/16):
  sube el archivo con `<BulkUpload endpoint="/api/ordenes/carga-masiva">`; en
  `handleSuccess(result)` usa `parseResumen` (solo cuenta creadas/duplicadas/
  conError para un toast) y `extractNumRemisionesCreadas` (solo filas
  `resultado === "creada"`) → pasa esos `numRemisiones` a `<OrdenesCargaResumen>`.
  Las filas `duplicada`/`error` NO se muestran en detalle. `result.data` llega
  como `unknown`; hoy se lee con guards defensivos.
- `app/(app)/ordenes/_components/OrdenesCargaResumen.tsx` (feature 16): recibe
  `numRemisiones` (las creadas), llama `resumenCargaMasiva({numRemisiones})` y
  las muestra en `DataTable` con una columna final `Select` de mensajero (global
  "aplicar a todos" + override por fila) + botón "Confirmar asignación"
  (`asignarMensajeroSugerido`). Este select por fila es el que la feature 29 debe
  CONSERVAR (punto d).
- El modal tiene 2 pasos: `Step = "upload" | "resumen"`.
- Componentes reutilizables disponibles: `DataTable`/`Column`
  (`components/shared/DataTable`), `Select` (`components/ui/select`),
  `Alert`/`AlertDescription` (`components/ui/alert`), `Modal`
  (`components/shared/Modal`), `useToast` (`hooks/useToast`).
- El backend YA crea SOLO las órdenes nuevas (las duplicadas no se re-insertan).
  Por tanto "cargar únicamente las nuevas" (punto c) ya se cumple a nivel de
  datos; la feature 29 lo hace **explícito y visible** en la UI.

## Alcance

- **En alcance:** enriquecer `handleSuccess` de `OrdenesCargaMasivaButton` para
  extraer y clasificar las filas del `BulkSummary` en tres grupos (nuevas /
  existentes / con error), y renderizar en el paso de resumen una sección
  separada, de solo lectura, de "órdenes ya existentes" con su `numRemision` +
  `estatus`, sin acción de recarga. Mantener intacto el flujo de asignación de
  mensajero por fila de la feature 16 para las nuevas.
- **Fuera de alcance:** cualquier endpoint/Server Action nuevo; cambios en el
  parseo/creación de la carga (feature 15); cambios en `BulkUpload`; una
  validación **dry-run pre-commit** (ver Preguntas abiertas, opción B).

---

## Requisitos (EARS)

### Clasificación del resultado de la carga

- **R1** — CUANDO una carga masiva finalice y el frontend reciba el `BulkSummary`,
  el sistema DEBE clasificar `BulkSummary.filas` en tres grupos disjuntos según
  `resultado`: **nuevas** (`"creada"`), **existentes** (`"duplicada"`) y **con
  error** (`"error"`).

- **R2** — La clasificación DEBE realizarse leyendo `result.data` (tipo `unknown`
  entregado por `BulkUpload`) mediante guards defensivos, sin lanzar excepción
  ante formas inesperadas, siguiendo el patrón existente de `parseResumen` /
  `extractNumRemisionesCreadas`. SI `result.data` no tiene la forma esperada,
  ENTONCES cada grupo DEBE resolverse como lista vacía.

- **R3** — De cada fila **existente** (`"duplicada"`) el sistema DEBE conservar al
  menos su `numRemision` y su `estatus` (estado actual de la orden que el backend
  ya devuelve); de cada fila **con error** (`"error"`) DEBE conservar `fila`,
  `numRemision` y `errores`. Ninguna fila con `estatus`/`errores` ausente DEBE
  provocar un fallo de render (se muestra un marcador legible, p. ej. "—").

### Sección de órdenes ya EXISTENTES (solo lectura, no recargables)

- **R4** — CUANDO exista al menos una orden **existente** (`duplicadas > 0`) en el
  resultado, el sistema DEBE mostrar en el paso de resumen una sección/panel
  claramente separada e identificada como "órdenes ya existentes" (o equivalente
  inequívoco), distinta de la sección de órdenes nuevas.

- **R5** — La sección de órdenes existentes DEBE mostrar, por cada orden, su
  `numRemision` y su estado ACTUAL como **etiqueta legible** (no el `value` crudo;
  ver R17). DEBE renderizarse con `DataTable` (`components/shared/DataTable`).

- **R6** — La sección de órdenes existentes DEBE ser de **solo lectura**: NO DEBE
  ofrecer ningún control de recarga, reintento, asignación de mensajero, ni
  botón/acción que persista o reintente esas órdenes.

- **R7** — El sistema DEBE indicar de forma explícita al usuario que las órdenes
  existentes **NO se recargan** (mensaje/aviso legible, p. ej. mediante `Alert`),
  para que quede claro que ya estaban en el sistema.

### Órdenes NUEVAS (las únicas que se cargan) + select de mensajero

- **R8** — El sistema DEBE dejar explícito en la UI que **solo** las órdenes
  **nuevas** (`creadas`) son las que se han cargado (p. ej. rótulo/aviso o conteo
  visible que distinga "N nuevas cargadas" de las existentes).

- **R9** — El sistema DEBE CONSERVAR, para las órdenes nuevas, la vista de resumen
  de la feature 16 (`OrdenesCargaResumen`) con su columna `Select` de mensajero
  por fila y el select global "aplicar a todos", sin degradar su comportamiento
  (pre-selección del sugerido, override por fila, confirmación, toasts,
  revalidación SWR).

- **R10** — La sección de órdenes nuevas DEBE seguir alimentándose de los
  `numRemision` con `resultado === "creada"` (las creadas), sin mezclar en ella
  ninguna orden existente ni con error.

### Casos límite de presentación

- **R11** — SI `creadas === 0` pero `duplicadas > 0`, ENTONCES el sistema DEBE
  **AVANZAR al paso de resumen** mostrando únicamente la sección de órdenes
  existentes (solo lectura, sin filas nuevas ni select de mensajero), y NO DEBE
  intentar cargar el resumen de asignación de mensajero con una lista vacía de
  nuevas. (Decisión firme, [RESUELTO-2].)

- **R12** — SI `creadas === 0`, `duplicadas === 0` y `conError === 0` (p. ej. carga
  vacía), ENTONCES el sistema DEBE conservar el comportamiento actual (toast
  informativo) sin mostrar secciones vacías de existentes, nuevas ni errores.
  (Cuando `conError > 0`, aplica R18.)

- **R13** — El sistema DEBE mantener el comportamiento actual de toast de resumen
  (`creadas` / `duplicadas` / `conError`) y de revalidación SWR
  `["ordenes:list", …]` tras la carga, sin regresiones.

### Etiqueta legible del estado (mapa value → label)

- **R17** — El sistema DEBE mostrar el estado de cada orden existente como una
  **etiqueta legible en español** derivada del `value` textual (`RowResult.estatus`)
  mediante un mapa `value → label` de **presentación en el frontend**. El mapa DEBE
  cubrir **todos** los valores de `ORDER_STATUS_SEED`
  (`lib/types/order-status.ts`): `entregada`, `devuelta`, `devuelta_origen`,
  `reprogramada`, `en_fulfillment`, `en_ruta_bodega_principal`, `en_bodega`,
  `en_preparacion`. SI llega un `value` desconocido o ausente, ENTONCES el sistema
  DEBE mostrar el `value` crudo (fallback), sin fallar. El mapa es solo de
  presentación: NO toca backend ni depende de la feature 28 (usa los `value` de
  `ORDER_STATUS_SEED` como fuente de las claves).

### Órdenes con ERROR (detalle por fila)

- **R18** — CUANDO exista al menos una fila con `resultado === "error"`
  (`conError > 0`), el sistema DEBE mostrar en el paso de resumen una
  sección/tabla claramente separada de "órdenes con error" que liste **cada** fila
  con error. DEBE renderizarse con `DataTable` (`components/shared/DataTable`).

- **R19** — Por cada fila con error, la sección DEBE mostrar al menos su `fila`
  (número 1-based de la fila del archivo) y/o `numRemision`, y su **motivo** de
  error derivado de `RowResult.errores` (`Record<string, string[]>` de
  `lib/types/carga-masiva.ts`), presentado de forma legible (p. ej. campo → mensaje).
  SI `errores` está ausente o vacío, ENTONCES el sistema DEBE mostrar un motivo
  genérico legible sin fallar. La sección de errores DEBE ser de **solo lectura**
  (sin recarga/reintento).

### Restricciones de implementación (verificables por revisión)

- **R14** — El sistema NO DEBE introducir ni modificar backend, DB, migraciones ni
  Server Actions: el diff DEBE limitarse a componentes de UI bajo
  `app/(app)/ordenes/_components/` (y, si acaso, helpers puros de presentación).
  Verificable: el diff no toca `lib/actions/`, `lib/services/`,
  `lib/repositories/`, `app/api/`, `db/`.

- **R15** — El código nuevo DEBE cumplir TypeScript strict sin `any`; la lectura de
  `result.data` (`unknown`) DEBE usar guards tipados, reutilizando/derivando el
  patrón defensivo existente.

- **R16** — El sistema DEBE lograrse sin modificar `DataTable`, `Modal`, `Select`,
  `Alert`, `useToast` ni `BulkUpload` (se consumen tal cual).

---

## Trazabilidad

Cada `R<n>` se mapea a un test concreto en `tasks.md`. Los tests de UI siguen el
patrón `tests/components/*.test.tsx` (`@testing-library/react` + `userEvent`,
`// @vitest-environment jsdom`), tomando como referencia
`tests/components/OrdenesCargaMasivaButton.test.tsx` y
`tests/components/OrdenesCargaResumen.test.tsx`. Las funciones puras de
clasificación se cubren con tests unitarios directos (sin jsdom).

---

## Preguntas abiertas

**Ninguna pendiente.** Las 4 preguntas se resolvieron en la puerta humana F1.4
(2026-07-10):

- **[RESUELTO-1] ← ABIERTO-1:** se aprueba la **opción A (frontend puro)**:
  enriquecer el reporte POST-COMMIT del `BulkSummary` sin tocar backend. La opción
  B (dry-run pre-commit / fullstack) queda **descartada** explícitamente (registrada
  como alternativa descartada firme en `design.md`, ALT-1).

- **[RESUELTO-2] ← ABIERTO-2:** cuando `creadas === 0` y `duplicadas > 0`, el modal
  **AVANZA al paso de resumen** mostrando solo la sección de órdenes existentes
  (sin filas nuevas ni select). Fijado en **R11**.

- **[RESUELTO-3] ← ABIERTO-3:** las filas con `resultado === "error"` se muestran
  con **detalle por fila** (no solo el conteo del toast): una sección/tabla con
  `fila`/`numRemision` y su motivo derivado de `RowResult.errores`. Fijado en
  **R18, R19**. Amplía el alcance original.

- **[RESUELTO-4] ← ABIERTO-4:** el estado de las órdenes existentes se muestra como
  **etiqueta legible**, no el `value` crudo. No existe un mapa `value → label`
  reutilizable en el repo (solo `ORDER_STATUS_SEED` con los `value` sin etiqueta en
  `lib/types/order-status.ts`), por lo que esta feature define un **mapa de
  presentación nuevo en el frontend** cubriendo todos los `value` de
  `ORDER_STATUS_SEED`, con fallback al `value` crudo. Fijado en **R17**. Amplía el
  alcance original.
