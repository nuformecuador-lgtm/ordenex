# review — componente carga masiva (feature 9)

Reviewer SDD. Rama `feature/9-carga-masiva`. Fecha 2026-07-09.

## Veredicto

**APROBADO** — 25 tests de la feature verdes (20 en `BulkUpload.test.tsx` + 5 en
`csv-template.test.ts`); suite completa 288/288; typecheck y lint sin errores.
No hay hallazgos bloqueantes.

## Checklist

- [x] `specs/carga-masiva/requirements.md` con R1–R23 EARS numerados.
- [x] `design.md` con alternativa descartada (XLSX con librería) y su porqué (D1).
- [x] `tasks.md`: T0–T14 marcadas `[x]`. T15 (commit por bloque) queda `[ ]`,
      es responsabilidad del leader tras el review; no bloquea.
- [x] Cada R1–R23 mapea a un test concreto que lo ejerce (tabla abajo).
- [x] `progress/impl_carga-masiva.md` contiene el mapa `R<n> -> test`.
- [x] `pnpm run typecheck` sin errores (verificado por el reviewer).
- [x] `pnpm run lint` sin errores (verificado por el reviewer).
- [x] `pnpm test` 288/288 y subconjunto de la feature 25/25 (verificado, no fiado
      de la bitácora).
- [x] `./init.sh` termina en `== init OK ==`.
- [x] Sin tablas/migraciones/RLS/endpoints nuevos: N/A por diseño (feature FE pura).
- [x] Sin secretos hardcodeados; sin hardcode de país/moneda/cuenta.

## Fidelidad a la spec y decisiones humanas (2026-07-09)

- [x] `BulkUpload` genérico en `components/shared/`, UI pura, recibe
      `endpoint`/`accept`/`fields`/`maxSizeBytes?` + `onSuccess`/`onError` por props.
- [x] Plantilla en **CSV nativo sin dependencias**: `lib/utils/csv-template.ts`
      pura + `Blob`/`URL.createObjectURL`/`<a download>`. `package.json` NO añade
      `xlsx` ni `exceljs` (confirmado leyendo dependencies/devDependencies).
- [x] Subida por `fetch` + `FormData` multipart al `endpoint`, sin fijar
      `Content-Type` manual (test lo asevera: `init.headers` undefined).
- [x] Validación tipo por extensión (autoridad) + MIME: MIME vacío no rechaza
      (R22), MIME presente contradictorio rechaza aun con extensión válida (R21).
      Ambos con test.
- [x] `maxSizeBytes` opcional: excedido rechaza sin subir (R23), ausente no valida
      (R23). Dos tests.
- [x] Estados idle/selected/uploading (ambos botones bloqueados)/success/error.
      Accesibilidad: `Label htmlFor`, botones con nombre accesible, `role="status"`
      (carga/éxito) y `role="alert"` (error) distinguibles.
- [x] NO toca backend/DB/endpoints; solo consume `endpoint` por props.
- [x] Excepción de arquitectura (fetch multipart en vez de Server Action)
      documentada y justificada en `design.md` D3 e `impl`. Aceptada: es un
      componente genérico de subida de binario a ruta arbitraria; la Server Action
      no aplica a un componente reutilizable sin destino conocido.

## Trazabilidad R1–R23 -> test (verificada)

| Req | Test | OK |
| --- | --- | --- |
| R1  | BulkUpload "R1: acepta una lista no vacía de fields y habilita la descarga" | ✓ |
| R2  | BulkUpload "R2/R12: envía POST multipart al endpoint..." (url == endpoint) | ✓ |
| R3  | BulkUpload "R3/R17: ...accept derivado de props" (accept=".csv,.xlsx") | ✓ |
| R4  | BulkUpload "R4/R8: nombre por defecto" + "R4: usa templateFileName" | ✓ |
| R5  | csv-template "R5: cabecera respeta orden y usa label" | ✓ |
| R6  | csv-template "R6: con ejemplo 2 filas" + "R6: sin ejemplo 1 fila" | ✓ |
| R7  | csv-template "R7: escapa separador/comillas/saltos, CSV parseable" | ✓ |
| R8  | BulkUpload "R4/R8: crea Blob y descarga sin llamar al endpoint" (fetch no llamado) | ✓ |
| R9  | BulkUpload "R9: al seleccionar archivo válido muestra su nombre" | ✓ |
| R10 | BulkUpload "R10: rechaza extensión no permitida con role=alert, subida disabled" | ✓ |
| R11 | BulkUpload "R11: 'Cargar archivo' disabled sin archivo válido" | ✓ |
| R12 | BulkUpload "R2/R12: fieldName por defecto" + "R12: fieldName custom" | ✓ |
| R13 | BulkUpload "R13: en curso role=status y ambos botones disabled" | ✓ |
| R14 | BulkUpload "R14/R18: éxito role=status e invoca onSuccess con status y data" | ✓ |
| R15 | BulkUpload "R15/R18: error HTTP onError con status" + "R15: fallo de red sin propagar" | ✓ |
| R16 | BulkUpload "R16: tras error, otro archivo limpia alert y rehabilita" | ✓ |
| R17 | BulkUpload "R3/R17: input con label asociada, botones con nombre accesible" | ✓ |
| R18 | BulkUpload "R14/R18" (status éxito, sin alert) + "R15/R18" (alert error) — distinguibles | ✓ |
| R19 | BulkUpload "R19: sin endpoint, 'Cargar archivo' disabled aun con archivo válido" | ✓ |
| R20 | BulkUpload "R20: deshabilita 'Descargar plantilla' con fields vacío" | ✓ |
| R21 | BulkUpload "R21: rechaza MIME contradictorio aunque extensión válida" | ✓ |
| R22 | BulkUpload "R22: MIME vacío no rechaza; manda la extensión" | ✓ |
| R23 | BulkUpload "R23: con maxSizeBytes rechaza excedido" + "R23: sin maxSizeBytes no valida" | ✓ |

## Hallazgos

Bloqueantes: ninguno.

Menores (no bloquean, para futura iteración):

- **menor** — R1: el test solo comprueba que el botón de descarga queda habilitado
  con `fields` no vacío. La invariante "lista no vacía" se apoya en el contrato de
  tipos (T0) y en R20 (vacío -> disabled). Cobertura suficiente, pero el test de R1
  es indirecto respecto al texto del requisito.
- **menor** — Cuando se pasa la prop `label`, el texto se usa a la vez como
  `aria-label` del contenedor (`role="group"`) y como texto del `<Label>`. Doble
  exposición del mismo nombre accesible; no rompe nada pero es redundante.
- **menor** — CHECKPOINTS pide E2E para flujos críticos (ingesta de órdenes). Este
  componente es genérico y no cablea por sí mismo la ingesta; el E2E corresponde a
  la feature consumidora (14/15) que lo monte contra un endpoint real. No aplica a
  la feature 9.

## Nota para el leader

Post-review pendiente del flujo del arnés (fuera del alcance del reviewer): T15
(commits por bloque), entrada en `progress/history.md` y transición de estado en
`feature_list.json`.
