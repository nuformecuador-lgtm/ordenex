# Bitácora de implementación — Feature 32: Etiqueta de guía con QR y código de barras

> Fase 2 (tras aprobación humana F1.4, 2026-07-11). Fullstack, un ciclo:
> backend_dev -> frontend_dev. READ derivado, SIN tabla/migración/RLS nueva.
> Coordinado por el implementer; código escrito por los subagentes.

## Resumen
- Backend: DTO + zod, interfaz service, `findEtiquetasByIds` en OrdenRepository
  (READ derivado que resuelve nombres de geografía/tienda, dirección y monto que el
  OrdenDTO no exponía), `EtiquetaGuiaService` (guardia num_guia + rol maestro) y
  Server Action `lib/actions/etiquetas-guia.ts` (zod + resolveActorFromSession +
  withErrorHandler, patrón feature 17). Firmas nuevas; contratos previos (6/7/17/26/30) intactos.
- Frontend: componente `EtiquetaGuia` (QR + barcode en DOM con qrcode.react +
  react-barcode), helper de PDF, `EtiquetasGuiaModal`, e integración de la acción
  "Imprimir etiquetas" en la vista del maestro (feature 17), desacoplada de "Generar guía".

## Decisiones F1.4 construidas
- (a) QR codifica `orden.id`; (b) barcode codifica `num_guia` (CODE128).
- (c) PDF real descargable, cada etiqueta EXACTAMENTE 100x100 mm; lote = PDF multipágina (una etiqueta por página).
- (d) `qrcode.react` + `react-barcode` (etiqueta en pantalla) + `jspdf` (PDF).
- (e) Acción explícita "Imprimir etiquetas" (independiente de "Generar guía").
- (f) Rol `maestro`; apartados con num_guia (en_espera_aceptacion, en_bodega, en_ruta_bodega_satelite); órdenes sin guía se omiten. Admin (readOnly) no ve la acción.
- (g) Reimpresión libre, sin auditoría ni estado propio.

## Vía de PDF elegida (reconciliación c+d)
`jspdf` con páginas de exactamente 100x100 mm (`new jsPDF({ unit:"mm", format:[100,100] })`
+ `addPage([100,100])` por etiqueta), embebiendo QR y barcode como imágenes raster y
dibujando el texto con las APIs de jspdf. NO se usó html2canvas (Tailwind v4 emite
colores `oklch` que el html2canvas clásico no parsea -> fragilidad). Rasters:
- QR: `QRCodeCanvas` de qrcode.react -> `canvas.toDataURL("image/png")` (size 512, nitidez).
- Barcode: `jsbarcode` directo sobre un `<canvas>` offscreen (CODE128) -> toDataURL.

`qrcode.react` + `react-barcode` se conservan en el componente de etiqueta EN PANTALLA
(decisión d + R9). El PDF se arma aparte a partir de los rasters.

## Deps instaladas (package.json + pnpm-lock.yaml)
`qrcode.react@4.2.0`, `react-barcode@1.6.1`, `jspdf@4.2.1`, `jsbarcode@3.12.3` (todas
con tipos propios; no hizo falta @types). `pnpm install` OK, typecheck verde.

## Slot de acción en OrdenesApartado
Se extendió `OrdenesApartado` con una tercera acción retro-compatible
(`tertiaryActionLabel`/`onTertiaryAction`), sin romper feature 17/30. Reparto:
`en_espera_aceptacion` y `en_ruta_bodega_satelite` usan el slot PRIMARIO para "Imprimir
etiquetas" (antes `selectable=false`, ahora `selectable=!readOnly`); `en_bodega` usa el
TERCIARIO (ya ocupaba primaria "Asignar mensajero" + secundaria "Rutear a bodega
satélite"). Todo detrás de `!readOnly`.

## Archivos creados
### Backend
- `lib/types/etiqueta-guia.ts` — EtiquetaGuiaDTO, EtiquetaOmitidaDTO, generarEtiquetasSchema, GenerarEtiquetasResult.
- `lib/interfaces/services/IEtiquetaGuiaService.ts` — IEtiquetaGuiaService.
- `lib/services/EtiquetaGuiaService.ts` — service (guardia num_guia + rol maestro, armado del DTO).
- `lib/actions/etiquetas-guia.ts` — Server Action generarEtiquetas.
- `tests/unit/services/etiqueta-guia-service.test.ts`
- `tests/integration/actions/etiquetas-guia-action.test.ts`
### Frontend
- `lib/config/moneda.ts` — formatMonto (Intl.NumberFormat configurable por env; null -> guion). R5 sin hardcode.
- `app/(app)/ordenes/_components/EtiquetaGuia.tsx` — etiqueta presentacional (QR + barcode en DOM).
- `app/(app)/ordenes/_components/etiquetas-pdf.ts` — buildEtiquetasPdf / descargarEtiquetasPdf.
- `app/(app)/ordenes/_components/EtiquetasGuiaModal.tsx` — modal (llama action, preview, omitidas, descarga PDF).
- `tests/components/EtiquetaGuia.test.tsx`
- `tests/components/EtiquetasGuiaModal.test.tsx`

## Archivos modificados
- `lib/interfaces/repositories/IOrdenRepository.ts` — EtiquetaRow + firma findEtiquetasByIds.
- `lib/repositories/OrdenRepository.ts` — WITH_ETIQUETA, toEtiquetaRow, findEtiquetasByIds (select, Decimal->number, deletedAt null).
- `app/(app)/ordenes/_components/OrdenesApartado.tsx` — acción terciaria retro-compatible.
- `app/(app)/ordenes/_components/OrdenesRevisionMaestro.tsx` — integración "Imprimir etiquetas" + modal.
- `tests/components/OrdenesRevisionMaestro.test.tsx` — mocks + tests ajustados.
- `tests/unit/services/{orden-service,asignacion-mensajero-service,bulk-orden-service,rol-admin-satelite-authz}.test.ts` — solo se añadió el stub findEtiquetasByIds a los mocks de IOrdenRepository (aditivo, cero cambio de comportamiento).
- `package.json` / `pnpm-lock.yaml` — deps nuevas.
- `specs/32-etiqueta-guia-qr/tasks.md` — tasks marcadas [x].

## Mapa de trazabilidad R<n> -> test
| R | Cubierto | Test |
| --- | --- | --- |
| R1  | sí | unit etiqueta-guia-service: R1 orden con guia y geografia completas -> DTO con todos los nombres resueltos |
| R2  | sí | unit: R2 orden existente sin num_guia -> omitida sin_guia, sin etiqueta |
| R3  | sí | unit: R3 id no encontrado + orden valida -> etiqueta del valido, omitida del otro (no aborta el lote) |
| R4  | sí | unit: R4 orden sin distrito -> distritoNombre null con etiqueta valida; component EtiquetaGuia caso distrito null |
| R5  | sí | unit: R5 montoCobrar number sin simbolo + R5 montoCobrar null; component EtiquetaGuia formato de monto + null |
| R6  | sí | unit: R6 el DTO de etiqueta no contiene deletedAt ni claves fuera del contrato |
| R7  | sí | unit: R7 qrValue === ordenId; component EtiquetaGuia R7 pasa qrValue al QR |
| R8  | sí | unit: R8 barcodeValue === String(numGuia); component EtiquetaGuia R8 pasa barcodeValue + format CODE128 |
| R9  | sí | component EtiquetaGuia: R9 renderiza todos los campos legibles (+ QR + barcode en el DOM) |
| R10 | sí | component EtiquetasGuiaModal: R10 Descargar etiquetas invoca el helper de PDF con las etiquetas (reinterpretado como PDF por decisión c; window.print superseded) |
| R11 | sí | component EtiquetasGuiaModal: R11 mixta -> M etiquetas + aviso N-M; OrdenesRevisionMaestro: Feature 32/R11 abre el modal con la selección |
| R12 | sí | component EtiquetasGuiaModal: R12 sin imprimibles -> aviso y NO descarga (helper de PDF no invocado) |
| R13 | sí | unit: R13 rol no maestro -> forbidden, sin tocar datos; integration action: R13 rol no autorizado -> forbidden; component OrdenesRevisionMaestro: admin readOnly no ve Imprimir etiquetas |
| R14 | sí | integration action: R14 generarEtiquetas sin actor -> unauthenticated, sin llamar al service |
| R15 | sí | integration action: R15 lista vacia, R15 id malformado, R15 ordenIds ausente/no-array -> validation_error |

## Verificación manual pendiente (no unit-testeable)
- Que el PDF binario mida EXACTAMENTE 100x100 mm por página (jspdf no se ejercita en jsdom; su salida se mockea en los tests).
- Escaneabilidad real del QR (orden.id) y del barcode CODE128 (num_guia) con lector físico; nitidez del raster QR a size 512.
- Revisión visual del maquetado/desbordes de texto en la etiqueta impresa.

## Salida real de verificación
- `pnpm run typecheck`: exit 0 (sin errores).
- `pnpm run lint`: 0 errores, 135 warnings (todas preexistentes en `.claude/skills/*`, ninguna en lib/ ni tests/ nuevos).
- `pnpm test` (vitest run): 158 archivos, 1314 tests, todos pasan (0 fallos). Nuevos de la feature: 16 backend (service+action) + component tests (EtiquetaGuia, EtiquetasGuiaModal, OrdenesRevisionMaestro).
- `./init.sh`: VERDE — migraciones con down.sql OK, .env presente, "== init OK ==".

## Notas / deudas
- Sin cambios de esquema, migración ni RLS (feature derivada). CHECKPOINTS aplicables: contrato del CRUD (6/7) intacto, componentes cliente marcados "use client", firmas nuevas sin romper 17/26/30.
- Se creó `lib/config/moneda.ts` porque el repo no tenía helper de moneda (solo montoCobrar.toFixed(2) sin símbolo); resuelve R5 (moneda por configuración, sin hardcode).
- Feature 33 (recepción por escaneo) CONSUMIRÁ el qrValue (= orden.id); esta feature solo lo PRODUCE (fuera de alcance, no tocado).
