# Review — Feature 31: plantilla de carga en XLSX (corrección)

> Reviewer. Rama `feature/31-plantilla-xlsx` vs `origin/dev`. Zona: frontend puro.
> Fecha: 2026-07-10.

## Checklist verificado

### Especificación
- [x] `requirements.md` con R1–R13 (incl. R6b) en EARS numerados.
- [x] `design.md` con alternativas descartadas (ALT-1 servidor, ALT-2 libería ligera, ALT-3 CSV).
- [x] `tasks.md` con todas las tasks (T1–T7) marcadas `[x]` + mapa R→task→test.

### Trazabilidad R1–R13 → test real (verificado leyendo los tests)
- [x] R1 — `xlsx-template.test.ts`: round-trip, cabecera en orden con `label ?? key`.
- [x] R2 — `xlsx-template.test.ts`: `getRow(1).getCell(n).font.bold === true`.
- [x] R3 — `xlsx-template.test.ts`: cada `column.width` definido y ≥ 12.
- [x] R4 — `xlsx-template.test.ts`: dos escenarios (con ejemplo → 2ª fila alineada/vacía; sin ejemplo → solo cabecera).
- [x] R5 — `xlsx-template.test.ts`: `buildXlsxTemplate([])` rejects/toThrow.
- [x] R6 — `xlsx-template.test.ts` (binario recargable) + `BulkUpload.test.tsx` (Blob.type === MIME XLSX).
- [x] R6b — `BulkUpload.test.tsx`: generador invocado tras el clic (mock del import dinámico); verificado además que NO hay import estático de exceljs en `BulkUpload.tsx`.
- [x] R7 — `xlsx-template.test.ts`: round-trip write→`xlsx.load`→assert (no smoke test vacío).
- [x] R8 — `BulkUpload.test.tsx`: descarga crea Blob XLSX + `<a>.click()`, `fetch` NO invocado.
- [x] R9 — `BulkUpload.test.tsx`: default `plantilla.xlsx` y `templateFileName` provisto.
- [x] R10 — `BulkUpload.test.tsx`: durante promesa pendiente el botón queda deshabilitado y clic repetido ignorado (`toHaveBeenCalledTimes(1)`).
- [x] R11 — `BulkUpload.test.tsx`: `fields=[]` → botón deshabilitado.
- [x] R12 — `OrdenesCargaMasivaButton.test.tsx`: `templateFileName` = `...xlsx` + test de 11 keys en orden (columnas intactas).
- [x] R13 — suite de subida heredada de `BulkUpload.test.tsx` + `OrdenesCargaMasivaButton` (onSuccess/onError) verdes; `accept`/`ORDENES_BULK_FIELDS` sin cambios.

### Decisiones firmes F1.4
- [x] (1) SIEMPRE XLSX, sin prop `templateFormat`; `DEFAULT_TEMPLATE_NAME = "plantilla.xlsx"`.
- [x] (2) exceljs por import dinámico (`(await import("exceljs")).default` dentro de `buildXlsxTemplate`, y `await import("@/lib/utils/xlsx-template")` dentro de `handleDownloadTemplate`). Sin import estático al tope. (R6b)
- [x] (3) `lib/utils/csv-template.ts` y su test CONSERVADOS — `git diff` vacío en ambos.

### Generador `lib/utils/xlsx-template.ts`
- [x] `async`, `Promise<ArrayBuffer>`, sin `any`.
- [x] Cabecera `label ?? key`, negrita, anchos (MIN 12 / MAX 40 / PAD 2).
- [x] Fila de ejemplo opcional con la regla del CSV (`fields.some(f => f.example != null)`).
- [x] API alineada con `lib/parsers/spreadsheet.ts` (mismo cast documentado en el lado lectura del test).

### `BulkUpload`
- [x] `handleDownloadTemplate` async, MIME `...spreadsheetml.sheet`.
- [x] Estado `isGeneratingTemplate` integrado en `canDownloadTemplate` (deshabilita durante generación).
- [x] `finally` restablece el estado, sin `catch` vacío.
- [x] Resto del componente (flujo de subida) intacto.

### Frontend puro (git verificado)
- [x] El diff de la 31 NO toca `lib/actions/`, `lib/services/`, `lib/repositories/`, `app/api/`, `db/`.

### Calidad
- [x] `npx tsc --noEmit`: exit 0, sin errores (strict, sin `any`).

### Verificación ejecutable (corrida por el reviewer)
- Feature en aislamiento (xlsx-template + BulkUpload + OrdenesCargaMasivaButton + csv-template): **61/61 passed**.
- Tests sospechosos en aislamiento (route carga-masiva + HomePage + LoginForm): **45/45 passed**.
- `./init.sh`: imprime `== init OK ==`, EXIT=0. Su gate propio pasa (migraciones + .env OK).
  - La corrida vitest DENTRO de init.sh mostró timeouts NO deterministas: run A = 3 rojos, run B = 2 rojos, siempre por `Test timed out` bajo contención de CPU (setup 54s / import 105s), y el conjunto de tests que falla CAMBIA entre corridas.

## Dictamen del flaky
**FLAKY, no bloqueante.** Evidencia:
1. Los mismos tests pasan 45/45 en aislamiento (incl. `ordenes-carga-masiva.route` R28 y HomePage).
2. El conjunto que falla varía entre corridas (2 vs 3) y son SIEMPRE `Test timed out`, no aserciones fallidas.
3. El diff de la 31 NO toca la ruta de carga masiva, el parser (`lib/parsers/spreadsheet.ts`) ni el flujo de subida; el R28 de la ruta ya tiraba de exceljs (feature 15) antes de esta feature. Es el test más pesado (genera y parsea un XLSX grande) y por eso el primero en agotar el timeout bajo contención. No hay ruta de regresión desde este diff.

## Hallazgos
- **Observación (no bloqueante):** no pude reproducir una corrida completa 730/730 totalmente verde bajo `./init.sh` por los timeouts flaky bajo contención; el implementer reportó 730/730. La discrepancia se explica por la carga de CPU de la máquina, no por el diff. Recomendación futura (fuera de alcance): subir `testTimeout` o serializar los tests de integración pesados con exceljs para eliminar el ruido.
- Sin hallazgos menores ni de seguridad. Frontend puro: RLS/migraciones/webhooks/capas = N/A. Sin secretos ni hardcode de contexto.

## Veredicto
**APROBADO** — 0 bloqueantes.
