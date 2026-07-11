# Feature 32 — Etiqueta de guía con QR y código de barras — tasks

> Orden: backend → frontend, un solo PR. `[P]` = paralelizable con otras `[P]` del
> mismo bloque. Cada task incluye criterio de "hecho". Los R<n> refieren a
> `requirements.md`. NO empezar hasta aprobación humana (`spec_ready`).

## Bloque 0 — Preparación / decisiones

- [x] **T0.1** Confirmar con el humano las Preguntas abiertas (a)–(g) de
  `requirements.md`. *Hecho:* respuestas registradas (Decisiones F1.4 APROBADAS 2026-07-11).
- [x] **T0.2** Instalar deps de (d): QR (`qrcode.react`) + barcode (`react-barcode`)
  o las elegidas por el humano. *Hecho:* aparecen en `package.json`, `pnpm install`
  ok, `pnpm run typecheck` sigue verde (tipos disponibles).

## Bloque 1 — Backend (contratos y capas)

- [x] **T1.1** Crear `lib/types/etiqueta-guia.ts`: `EtiquetaGuiaDTO`,
  `EtiquetaOmitidaDTO`, `generarEtiquetasSchema` (zod, lista no vacía),
  `GenerarEtiquetasResult`. (R1, R2, R3, R4, R5, R6, R15) *Hecho:* compila strict,
  sin `any`, no expone `deletedAt`.
- [x] **T1.2** `[P]` Interfaz `lib/interfaces/repositories/IOrdenRepository.ts`:
  añadir `findEtiquetasByIds(ids)`. *Hecho:* firma tipada; el repo la implementa.
- [x] **T1.3** `[P]` Interfaz `lib/interfaces/services/IEtiquetaGuiaService.ts`:
  `generarEtiquetas(input, actor)`. *Hecho:* firma tipada y exportada.
- [x] **T1.4** Implementar `findEtiquetasByIds` en
  `lib/repositories/OrdenRepository.ts`: `findMany` con `deletedAt: null` +
  `include` de tienda/zona/provincia/canton/distrito (`select nombre`). Solo query,
  sin lógica. (R1, R3) *Hecho:* devuelve filas con nombres; test de repo (o mock)
  verifica el shape. Depende de T1.2.
- [x] **T1.5** Implementar `lib/services/EtiquetaGuiaService.ts`: autorización
  (R13), clasificación por id (etiqueta / `sin_guia` / `no_encontrada`), armado del
  DTO (nombres, `Decimal->number`, `qrValue`, `barcodeValue`). (R1–R8, R13)
  *Hecho:* unit tests de R1–R6/R7/R8/R13 pasan mockeando el repo. Depende de
  T1.1/T1.3/T1.4.
- [x] **T1.6** Server Action `lib/actions/etiquetas-guia.ts` (`'use server'`):
  actor→`unauthenticated` (R14), `generarEtiquetasSchema.parse`→`validation_error`
  (R15), `withErrorHandler` + traducción de error, `buildEtiquetaService()`.
  *Hecho:* unit tests de R14/R15 y del passthrough `ok`/`forbidden` pasan. Depende
  de T1.5.

## Bloque 2 — Frontend (presentación e impresión)

- [x] **T2.1** `EtiquetaGuia.tsx` (`_components/`, `"use client"`,
  presentacional): renderiza todos los campos + `<QRCode value=qrValue>` +
  `<Barcode value=barcodeValue>`; formatea `montoCobrar` por config de moneda (sin
  hardcode). (R5, R7, R8, R9) *Hecho:* component test comprueba campos + ambos
  códigos en el DOM. Depende de T0.2, T1.1.
- [x] **T2.2** CSS `@media print`: hoja con una etiqueta por bloque, oculta el
  resto de la UI; tamaño de etiqueta según (c). (R10) *Hecho:* estilos de impresión
  aíslan las etiquetas (revisión visual/print preview).
- [x] **T2.3** `EtiquetasGuiaModal.tsx` (`"use client"`): llama a
  `generarEtiquetas(ordenIds)`; renderiza etiquetas, avisa omitidas, y si no hay
  imprimibles informa y NO imprime; botón "Imprimir" → `window.print()`.
  (R10, R11, R12) *Hecho:* component tests de R10/R11/R12 pasan. Depende de
  T2.1, T1.6.
- [x] **T2.4** Integrar en
  `app/(app)/ordenes/_components/OrdenesRevisionMaestro.tsx`: acción "Imprimir
  etiquetas" (patrón `onSecondaryAction`/`secondaryActionLabel`) en los apartados
  con `num_guia` (según (f)); montar `EtiquetasGuiaModal`; respetar `readOnly`
  (admin). (R11, R13) *Hecho:* la acción abre el modal con la selección; test del
  orquestador pasa. Depende de T2.3.

## Bloque 3 — Trazabilidad y cierre

- [x] **T3.1** Escribir el mapa `R<n> → test` en `progress/impl_32-etiqueta-guia-qr.md`
  (tabla §7 de `design.md`). *Hecho:* cada R1–R15 mapea a ≥1 test existente.
- [x] **T3.2** `pnpm run typecheck`, `pnpm run lint`, `pnpm test` en verde; `./init.sh`
  en verde. *Hecho:* todo pasa localmente sin errores (reviewer verificó 1314 tests).
- [x] **T3.3** Verificar CHECKPOINTS: sin tabla nueva (sin RLS/migración
  aplicables), contrato del CRUD intacto, componentes cliente correctos, un commit
  por task lógica. *Hecho:* reviewer APROBADO 0 bloqueantes; entrada añadida a
  `progress/history.md` y `progress/review_32-etiqueta-guia-qr.md`.

## Notas de dependencias
- T1.1 desbloquea T1.5 y T2.1. T1.4 desbloquea T1.5. T1.6 desbloquea T2.3.
- T2.1 → T2.3 → T2.4 en serie (UI). T2.2 puede ir en paralelo a T2.1.
- Bloque 1 completo antes de cerrar Bloque 2 (el frontend consume la action real).
