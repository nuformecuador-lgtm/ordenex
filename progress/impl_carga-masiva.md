# impl — componente carga masiva (feature 9)

Rama: `feature/9-carga-masiva`. Frontend puro. No se tocó backend, DB, Prisma,
migraciones, RLS ni se crearon endpoints: el componente recibe `endpoint` por
props y hace `POST` multipart ahí.

## Archivos creados

- `lib/utils/csv-template.ts` — utilidad pura `buildCsvTemplate(fields)` (sin DOM
  ni React). Cabecera en orden, fila de ejemplo opcional, escapado CSV (R5–R7).
- `components/shared/BulkUpload.tsx` — componente `"use client"` genérico y
  reutilizable. Descarga de plantilla CSV nativa (Blob + `<a download>`) y subida
  `fetch` + `FormData` multipart. Reutiliza `ui/button`, `ui/input`, `ui/label`,
  `ui/alert` e íconos de `lucide-react`.
- `tests/unit/utils/csv-template.test.ts` — 5 tests (R5, R6, R7 + contrato).
- `tests/components/BulkUpload.test.tsx` — 20 tests (R1–R4, R8–R23).

## Archivos modificados

- `specs/carga-masiva/tasks.md` — tasks T0–T14 marcadas `[x]`. T15 (commit) queda
  `[ ]`: lo coordina el leader tras el reviewer.

## Mapa de trazabilidad R<n> -> test

| Req | Test |
| --- | --- |
| R1  | BulkUpload — "R1: acepta una lista no vacía de fields y habilita la descarga de plantilla" |
| R2  | BulkUpload — "R2/R12: envía POST multipart al endpoint con el archivo bajo el fieldName por defecto" |
| R3  | BulkUpload — "R3/R17: expone input con label asociada, botones con nombre accesible y accept derivado de props" |
| R4  | BulkUpload — "R4/R8: ... nombre por defecto ..." + "R4: usa templateFileName como nombre del archivo descargado cuando se provee" |
| R5  | csv-template — "R5: la cabecera respeta el orden de los campos y usa label cuando existe" |
| R6  | csv-template — "R6: con al menos un ejemplo ..." + "R6: sin ningún ejemplo genera solo la fila de cabecera" |
| R7  | csv-template — "R7: escapa valores con separador, comillas o saltos de línea produciendo un CSV parseable" |
| R8  | BulkUpload — "R4/R8: al descargar crea un Blob y dispara la descarga ... sin llamar al endpoint" |
| R9  | BulkUpload — "R9: al seleccionar un archivo válido muestra su nombre" |
| R10 | BulkUpload — "R10: rechaza extensión no permitida con role=alert y mantiene la subida deshabilitada" |
| R11 | BulkUpload — "R11: 'Cargar archivo' está deshabilitado mientras no haya archivo válido" |
| R12 | BulkUpload — "R2/R12: ... fieldName por defecto" + "R12: usa el fieldName custom en el FormData" |
| R13 | BulkUpload — "R13: mientras la petición está en curso muestra role=status y deshabilita ambos botones" |
| R14 | BulkUpload — "R14/R18: en éxito muestra role=status e invoca onSuccess con status y data" |
| R15 | BulkUpload — "R15/R18: en error HTTP ..." + "R15: en fallo de red ... sin propagar excepción" |
| R16 | BulkUpload — "R16: tras un error, seleccionar otro archivo válido limpia el alert y rehabilita la subida" |
| R17 | BulkUpload — "R3/R17: expone input con label asociada, botones con nombre accesible ..." |
| R18 | BulkUpload — "R14/R18 ..." (role=status éxito) + "R15/R18 ..." (role=alert error) |
| R19 | BulkUpload — "R19: sin endpoint, 'Cargar archivo' sigue deshabilitado aun con archivo válido" |
| R20 | BulkUpload — "R20: deshabilita 'Descargar plantilla' cuando fields está vacío" |
| R21 | BulkUpload — "R21: rechaza MIME contradictorio aunque la extensión sea válida" |
| R22 | BulkUpload — "R22: MIME vacío no rechaza; manda la extensión y el archivo queda habilitable" |
| R23 | BulkUpload — "R23: con maxSizeBytes, rechaza ..." + "R23: sin maxSizeBytes, no valida tamaño ..." |

## Nota de arquitectura (para el reviewer)

`docs/architecture.md` prescribe Server Actions para mutaciones internas. Aquí el
componente es genérico y NO conoce su destino: recibe `endpoint` por props y sube
un binario multipart a una ruta arbitraria. Es la única vía viable para un
componente reutilizable de subida de archivos; documentado como excepción
consciente en `design.md` D3. La feature consumidora decide el endpoint.

## Verificación (salida real)

`./init.sh` → verde:

```
-> pnpm run typecheck   (tsc --noEmit)      sin errores
-> pnpm run lint        (eslint)            sin errores
-> pnpm run test        (vitest run)
 Test Files  39 passed (39)
      Tests  288 passed (288)
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

Solo los archivos nuevos: `npx vitest run tests/components/BulkUpload.test.tsx
tests/unit/utils/csv-template.test.ts` → `Test Files 2 passed (2) · Tests 25
passed (25)`.

## Pendiente (fuera de mi alcance)

- T15: commit por bloque lógico — lo coordina el leader tras el reviewer.
