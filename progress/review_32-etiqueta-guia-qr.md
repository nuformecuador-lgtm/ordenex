# Review — Feature 32: etiqueta de guía con QR y código de barras

**Veredicto: APROBADO (0 bloqueantes)** · reviewer (model opus) · 2026-07-11 · rama `feature/32-etiqueta-guia-qr`

## Verificación ejecutable (regla #5)
El reviewer corrió `./init.sh` él mismo: **158 archivos de test, 1314 tests, 0 fallos**; lint 0 errores (135 warnings preexistentes en `.claude/skills`). Exit 0.

## Trazabilidad R1–R15 → test: COMPLETA (verificada en el código de test, no solo la tabla)
- R1 DTO con nombres resueltos; R2 `sin_guia`; R3 `no_encontrada` sin abortar el lote; R4 `distritoNombre:null`; R5 `montoCobrar` number/null sin símbolo en backend + formato en componente; R6 keys sin `deletedAt`; R7 `qrValue===ordenId`; R8 `barcodeValue===String(numGuia)` CODE128 — `tests/unit/services/etiqueta-guia-service.test.ts`, `tests/components/EtiquetaGuia.test.tsx`.
- R9 campos+QR+barcode en DOM; R11 M etiquetas + aviso N−M; R12 sin imprimibles → aviso y NO descarga — `tests/components/EtiquetasGuiaModal.test.tsx`.
- R10 reinterpretado a "Descargar PDF" por la decisión F1.4 (c) que **supersede** el `window.print()` original (declarado en la cabecera de `requirements.md` y la bitácora); el test verifica que `descargarEtiquetasPdf` se invoca con las etiquetas.
- R13 forbidden (service + action + admin readOnly no ve la acción); R14 `unauthenticated`; R15 lista vacía/id malformado/no-array — `tests/integration/actions/etiquetas-guia-action.test.ts`, `tests/components/OrdenesRevisionMaestro.test.tsx`.

## Decisiones F1.4: implementadas tal cual
- (a) QR=`orden.id` (UUID); (b) barcode=`num_guia` (CODE128).
- (c) **PDF real 100×100 mm**: `etiquetas-pdf.ts:129` `new jsPDF({ unit:"mm", format:[100,100] })` + `addPage([100,100])` por etiqueta (unidades mm correctas), NO html print. Binario exacto/escaneabilidad = verificación manual DECLARADA en la bitácora (no oculta).
- (d) `qrcode.react@4.2.0`, `react-barcode@1.6.1`, `jspdf@4.2.1`, `jsbarcode@3.12.3` en `package.json` + `pnpm-lock.yaml` + `node_modules`. Build no depende de nada no instalado.
- (e) acción explícita "Imprimir etiquetas" sobre el lote (desacoplada de "Generar guía"); lote = PDF multipágina.
- (f) rol `maestro`, solo órdenes con `num_guia` (guardia); (g) reimpresión libre.

## Backend / convenciones / seguridad: OK
- SIN migración/tabla/RLS (read derivado; diff de migraciones vacío).
- `EtiquetaRow`/`toEtiquetaRow` resuelve nombres tienda/zona/provincia/cantón/distrito + `direccion` + `montoCobrar` (Decimal→number) — `OrdenRepository.ts:161-200,620-627`; no IDs crudos.
- Capas repo/service/action; autz maestro-only; zod + `resolveActorFromSession` + `withErrorHandler`. Contratos previos (6/7/17/26/30) intactos (`findEtiquetasByIds` aditivo en `IOrdenRepository`; mocks solo reciben el stub).
- Moneda: `lib/config/moneda.ts` sigue el patrón de `lib/config/ordenes.ts` (env override `MONEDA_LOCALE`/`MONEDA_CURRENCY`, default `es-CR`/`CRC`). No hardcode inconsistente.
- QR=`orden.id` / barcode=`num_guia` no exponen secretos.

## Hallazgos menores (cierre post-aprobación — resueltos por el leader)
1. tasks.md T3.1–T3.3 quedaban `[ ]` → marcadas `[x]` al cerrar.
2. Faltaba entrada en `progress/history.md` → añadida.
3. `feature_list.json` en `in_progress` y sin `review_32*.md` → este doc + estado `done`.

## Fuera de alcance (correcto)
Recepción por escaneo (feature 33, que consume el QR) no construida. PDF no testeable pixel a pixel: esperado y declarado como verificación manual.
