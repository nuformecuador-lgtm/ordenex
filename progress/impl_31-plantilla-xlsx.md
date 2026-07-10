# Impl — Feature 31: plantilla de carga en XLSX (corrección)

> Zona: frontend puro. Rama: `feature/31-plantilla-xlsx`.
> Decisiones firmes F1.4 respetadas: (1) SIEMPRE XLSX, sin prop `templateFormat`;
> (2) import dinámico de exceljs (R6b); (3) `csv-template.ts` + su test intactos.

## Archivos tocados

Creados:
- `lib/utils/xlsx-template.ts` — generador puro `buildXlsxTemplate(fields): Promise<ArrayBuffer>`.
  Import dinámico de exceljs dentro de la función (R6b). Cabecera `label ?? key` en
  negrita, anchos calculados por contenido (MIN 12 / MAX 40 / PAD 2), fila de ejemplo
  opcional, throw con `fields` vacío.
- `tests/unit/utils/xlsx-template.test.ts` — UNIT-GEN round-trip (write → `xlsx.load` → assert).

Modificados:
- `components/shared/BulkUpload.tsx` — `handleDownloadTemplate` async: import dinámico de
  `@/lib/utils/xlsx-template`, Blob con MIME XLSX, `DEFAULT_TEMPLATE_NAME = "plantilla.xlsx"`,
  estado `isGeneratingTemplate` (R10) integrado en `canDownloadTemplate`. Eliminado el
  import de `buildCsvTemplate`. JSDoc CSV→XLSX. Flujo de subida intacto.
- `app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx` — `templateFileName`
  `.csv` → `.xlsx` (R12). `ORDENES_BULK_FIELDS` y `accept` sin cambios.
- `tests/components/BulkUpload.test.tsx` — bloque de descarga migrado a async (mock del
  generador vía `vi.mock`), asserts de MIME/extensión XLSX, R9 default `plantilla.xlsx`,
  R10 deshabilitado durante generación, R11 fields vacío. Suite de subida heredada intacta.
- `tests/components/OrdenesCargaMasivaButton.test.tsx` — R12 espera `.xlsx`.

Conservados intactos (F1.4-2): `lib/utils/csv-template.ts`, `tests/unit/utils/csv-template.test.ts`.

## Mapa R1–R13 → test

| R   | Test |
| --- | ---- |
| R1  | xlsx-template.test.ts — "cabecera respeta orden / label" |
| R2  | xlsx-template.test.ts — "cabecera en negrita" |
| R3  | xlsx-template.test.ts — "ancho definido ≥ mínimo" |
| R4  | xlsx-template.test.ts — "con ejemplo segunda fila" / "sin ejemplo solo cabecera" |
| R5  | xlsx-template.test.ts — "rechaza sin campos" |
| R6  | xlsx-template.test.ts — "binario recargable" + BulkUpload.test.tsx — MIME XLSX del Blob |
| R6b | BulkUpload.test.tsx — generador invocado tras clic (import dinámico); sin import estático de exceljs en BulkUpload |
| R7  | xlsx-template.test.ts — round-trip write→load |
| R8  | BulkUpload.test.tsx — descarga con Blob XLSX sin fetch |
| R9  | BulkUpload.test.tsx — default `plantilla.xlsx` / `templateFileName` provisto |
| R10 | BulkUpload.test.tsx — botón deshabilitado durante generación, no re-dispara |
| R11 | BulkUpload.test.tsx — fields vacío deshabilita |
| R12 | OrdenesCargaMasivaButton.test.tsx — `templateFileName` = `.xlsx` (columnas intactas) |
| R13 | BulkUpload.test.tsx — suite de subida existente sigue verde; OrdenesCargaMasivaButton onSuccess/onError intactos |

## Verificación (salida real)

- `npx tsc --noEmit`: sin errores (strict, sin `any`).
- Afectados en aislamiento: 4 files / 61 tests passed.
- `./init.sh`: `== init OK ==`, exit 0. Dentro corre la suite completa:
  **Test Files 87 passed (87) · Tests 730 passed (730)**. Migraciones/.env OK.
  (eslint: 0 errores, solo warnings pre-existentes en `.claude/skills/*`, ajenos al diff.)
- Nota flaky: una ejecución paralela de `npx vitest run` mostró 5 rojos por timeout
  (HomePage/LoginForm auth + integración `ordenes-carga-masiva.route` con exceljs bajo
  contención de CPU). Verificados verdes en aislamiento y bajo `./init.sh`. No los toca
  este diff.

## Frontend puro

El diff no toca `lib/actions/`, `lib/services/`, `lib/repositories/`, `app/api/`, `db/`.
`lib/utils/xlsx-template.ts` es util de presentación (mismo lugar que `csv-template.ts`).
