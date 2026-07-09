# tasks.md — componente carga masiva (feature 9)

Cada task es discreta y verificable. `[P]` = paralelizable con otras `[P]` del
mismo bloque. Tests en `tests/components/BulkUpload.test.tsx` (Vitest +
`@testing-library/react`, patrón de `tests/components/DataTable.test.tsx`,
`// @vitest-environment jsdom`) y `tests/unit/utils/csv-template.test.ts`.

## Bloque 0 — Andamiaje

- [x] **T0** — Crear `lib/utils/csv-template.ts` (vacío/stub) y
  `components/shared/BulkUpload.tsx` (`"use client"`, exporta tipos e interfaz de
  props según `design.md`).
  - Hecho: `pnpm typecheck` pasa; el archivo exporta `BulkUploadProps`,
    `TemplateField`, `BulkUploadResult`, `BulkUploadError`.

## Bloque 1 — Utilidad CSV (pura, sin DOM) — depende de T0

- [x] **T1** — Implementar `buildCsvTemplate(fields)`: primera fila = `label ?? key`
  en orden (R5); segunda fila con `example` solo si al menos un field lo aporta
  (R6). Devuelve string CSV.
  - Test `tests/unit/utils/csv-template.test.ts`:
    - cabecera respeta orden y usa `label` cuando existe (R5).
    - con ejemplos → 2 filas; sin ningún ejemplo → 1 fila (R6).
  - Hecho: tests R5, R6 verdes.
- [x] **T2** [P] — Escapado CSV en `buildCsvTemplate`: valores con separador, comillas
  o salto de línea se envuelven en comillas dobles y las comillas internas se
  duplican (R7).
  - Test: field con `key`/`example` que contiene `,`, `"`, `\n` produce CSV
    parseable (R7).
  - Hecho: test R7 verde.

## Bloque 2 — Render base y config — depende de T0

- [x] **T3** — Render de estructura accesible: `Label` + `Input type="file"` con
  `accept` derivado de props, botones "Descargar plantilla" y "Cargar archivo"
  con nombres accesibles, `aria-label` del contenedor = `props.label` (R3, R17).
  - Test: `getByLabelText` del input; `getByRole("button", {name:"Descargar
    plantilla"})` y `{name:"Cargar archivo"}`; `input` tiene `accept=".csv,.xlsx"`
    para `accept:["csv","xlsx"]` (R3, R17).
  - Hecho: tests R3, R17 verdes.

## Bloque 3 — Descarga de plantilla — depende de T1, T2, T3

- [x] **T4** — Cablear botón "Descargar plantilla" a `buildCsvTemplate` + descarga por
  `Blob`/`URL.createObjectURL`/`<a download>`; nombre = `templateFileName` o
  `plantilla.csv` (R4, R5, R8). Sin llamada de red (R8).
  - Test (mock de `URL.createObjectURL`/`revokeObjectURL` y del click del `<a>`):
    al pulsar el botón se crea un Blob y se dispara descarga con el nombre correcto;
    `fetch` NO se llama (R4, R5, R8).
  - Hecho: tests R4, R8 verdes.
- [x] **T5** [P] — Deshabilitar "Descargar plantilla" cuando `fields` está vacío (R20).
  - Test: `fields:[]` → botón `disabled` (R20).
  - Hecho: test R20 verde.

## Bloque 4 — Selección y validación — depende de T3

- [x] **T6** — Al seleccionar archivo válido, mostrar su nombre y pasar a estado
  `selected` (R9).
  - Test (`userEvent.upload` con `.csv` válido): aparece el nombre del archivo (R9).
  - Hecho: test R9 verde.
- [x] **T7** — Validación por extensión (D2): archivo con extensión no incluida en
  `accept` → mensaje `role="alert"`, no habilita envío, no guarda archivo (R10).
  - Test: subir `.pdf` con `accept:["csv"]` → `getByRole("alert")`; botón "Cargar
    archivo" sigue `disabled` (R10).
  - Hecho: test R10 verde.
- [x] **T7b** — Validación por MIME (D2): con MIME presente y contradictorio se rechaza
  aunque la extensión sea válida (R21); con MIME vacío/ausente NO se rechaza por ese
  motivo, manda la extensión (R22).
  - Test A: `File` con nombre `datos.csv` pero `type:"application/pdf"` y
    `accept:["csv"]` → `getByRole("alert")`, botón "Cargar archivo" `disabled`
    (R21). Test B: `File` con nombre `datos.csv` y `type:""` (vacío) y
    `accept:["csv"]` → aceptado, se muestra el nombre, botón habilitable (R22).
  - Hecho: tests R21, R22 verdes.
- [x] **T7c** [P] — Validación de tamaño (D2): con `maxSizeBytes` provisto, archivo que
  lo excede se rechaza con `role="alert"` y no habilita envío (R23); sin
  `maxSizeBytes`, no se valida tamaño (R23).
  - Test A: `maxSizeBytes: 10` y archivo de 20 bytes válido por tipo →
    `getByRole("alert")`, "Cargar archivo" `disabled` (R23). Test B: mismo archivo
    sin `maxSizeBytes` → aceptado, botón habilitable (R23).
  - Hecho: test R23 verde.
- [x] **T8** [P] — "Cargar archivo" deshabilitado mientras no haya archivo válido
  (R11) y deshabilitado si falta `endpoint` aun con archivo válido (R19).
  - Test: estado inicial → `disabled` (R11); con archivo válido pero sin `endpoint`
    → `disabled` (R19).
  - Hecho: tests R11, R19 verdes.

## Bloque 5 — Subida multipart — depende de T4, T6, T8

- [x] **T9** — Submit hace `POST` multipart a `endpoint` con `FormData` y el archivo
  bajo `fieldName` (default `file`); no fija `Content-Type` manual (R12).
  - Test (mock global `fetch`): tras seleccionar archivo válido y pulsar "Cargar
    archivo", `fetch` se llama con `endpoint`, `method:"POST"`, y el `FormData`
    contiene la entrada `file` (o `fieldName` custom) con el archivo (R12).
  - Hecho: test R12 verde.
- [x] **T10** — Estado de carga: mientras la promesa de `fetch` está pendiente,
  `role="status"` visible y ambos botones deshabilitados (R13).
  - Test (fetch con promesa diferida): tras submit y antes de resolver →
    `getByRole("status")` y ambos botones `disabled` (R13).
  - Hecho: test R13 verde.
- [x] **T11** — Éxito: `response.ok` → mensaje `role="status"` de éxito + `onSuccess`
  invocado con `{status, data}` (R14, R18).
  - Test: `fetch` resuelve `ok:true, status:200, json:()=>({...})` → aparece
    éxito con `role="status"`; `onSuccess` recibió `status:200` y data (R14, R18).
  - Hecho: test R14 verde.
- [x] **T12** — Error HTTP y de red: `response.ok:false` o `fetch` rechazado →
  `role="alert"` + `onError` con `BulkUploadError`; nunca lanza sin controlar
  (R15, R18).
  - Test A: `fetch` resuelve `ok:false, status:422` → `role="alert"`, `onError`
    con `status:422`. Test B: `fetch` rechaza → `role="alert"`, `onError` sin
    `status`; el render no lanza (R15, R18).
  - Hecho: tests R15, R18 verdes.
- [x] **T13** [P] — Reintento: tras éxito o error, seleccionar otro archivo válido
  vuelve a estado que permite cargar de nuevo (R16).
  - Test: forzar error, luego `upload` de nuevo → "Cargar archivo" habilitado y
    alert previo limpiado (R16).
  - Hecho: test R16 verde.

## Bloque 6 — Cierre

- [x] **T14** — Mapa de trazabilidad R1–R23 → tests en `progress/impl_carga-masiva.md`.
  - Hecho: cada `R<n>` referencia un test nombrado; `pnpm test` verde y
    `pnpm typecheck` sin errores.
- [ ] **T15** — Commit por task lógica siguiendo `feat(carga-masiva): <qué>`
  (`docs/conventions.md`).
  - Hecho: historial con commits por bloque, no un mega-commit.

## Notas de dependencias

- T1, T2 son independientes del render (utilidad pura) → pueden ir antes/paralelas
  a T3.
- Bloque 5 depende de tener render (T3), selección (T6) y validación de habilitado
  (T8).
- R1 (fields no vacío) y R2 (endpoint) quedan cubiertos indirectamente por T5/T8
  (comportamiento con/sin ellos) y por los tipos del contrato (T0).
- T7b (MIME) y T7c (tamaño) dependen del render + selección (T3, T6), igual que T7.
