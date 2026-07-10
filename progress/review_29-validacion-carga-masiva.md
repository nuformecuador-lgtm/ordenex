# review_29-validacion-carga-masiva — Veredicto del REVIEWER

> Feature 29 — "enriquecer validación previa a la carga masiva". Zona: frontend puro.
> Rama: `feature/29-validacion-carga-masiva`. Base: `origin/dev`.
> Revisión ejecutada por el reviewer (no editó código). Fecha: 2026-07-10.

## Veredicto final: APROBADO — 0 bloqueantes

---

## Checklist verificado

### Especificación
- [x] `requirements.md` con R1–R19 EARS numerados.
- [x] `design.md` con alternativas descartadas y su porqué (ALT-1 dry-run, ALT-2
      fetch existentes, ALT-3 meter existentes en `OrdenesCargaResumen`).
- [x] `tasks.md` con TODAS las tasks marcadas `[x]` (T0–T5).

### Trazabilidad R1–R19 → test (todos verificados, no vacíos)
- [x] R1/R2/R3 → `CargaMasivaClasificacion.test.ts` (asserts reales: tres grupos
      disjuntos; data malformada→vacíos; estatus null; errores {} conservando fila/numRemision).
- [x] R4/R7/R8/R9/R10/R18 → `OrdenesCargaResumenPaso.test.tsx` (tres secciones,
      aviso "solo se cargan las nuevas", select mensajero presente, R11 sin fetch con lista vacía).
- [x] R5/R6 → `OrdenesExistentesTabla.test.tsx` (etiqueta legible, estatus null→"—",
      cero botones/combobox = solo lectura).
- [x] R11/R12/R13 → `OrdenesCargaMasivaButton.test.tsx` (avanza con creadas>0&&dup>0;
      avanza con creadas===0&&dup>0 mostrando solo existentes; los-tres-vacíos→queda en upload;
      conError>0 avanza con errores; mutate ordenes:list + toast).
- [x] R14 → verificado por diff (abajo).
- [x] R15 → grep `any`=0 en archivos nuevos (solo aparece en comentarios "sin any") + tsc verde.
- [x] R16 → verificado por diff (primitivas no tocadas).
- [x] R17 → `EstatusLabel.test.ts` (los 8 value del seed→label; desconocido→crudo; null/undefined/""→"—").
- [x] R18/R19 → `OrdenesConErrorTabla.test.tsx` (fila por error con motivo; mapa vacío→genérico;
      formatErrores aplana campo:mensajes).
- [x] Mapa `R<n>→test` presente en `progress/impl_29-...md`.

### Frontend puro (R14) — verificado por git
- [x] Diff vs `origin/dev` NO toca `lib/actions/`, `lib/services/`, `lib/repositories/`,
      `app/api/`, `db/`. Acotado a `app/(app)/ordenes/_components/`, `tests/components/`
      y `specs/29-.../tasks.md`.

### No modifica primitivas (R16) — verificado por git
- [x] `DataTable`, `Modal`, `Select`, `Alert`, `useToast`, `BulkUpload` NO aparecen en el diff.
- [x] `OrdenesCargaResumen.tsx` (feature 16) intacto → ALT-3 respetada: la lógica de
      existentes/errores vive en `OrdenesCargaResumenPaso` (contenedor), no dentro de él.

### Guards sin `any` (R15)
- [x] `clasificarBulkSummary` usa `asRecord`/`typeof`/`Array.isArray` sobre
      `Record<string, unknown>`; `result.data: unknown` narrowed sin `any`. tsc strict verde.

### Mapa de etiquetas (R17)
- [x] `ESTATUS_LABELS: Record<(typeof ORDER_STATUS_SEED)[number], string>` anclado al seed;
      cubre exactamente los 8 value reales (`entregada, devuelta, devuelta_origen,
      reprogramada, en_fulfillment, en_ruta_bodega_principal, en_bodega, en_preparacion`).
      Usa `en_fulfillment` (value post-rename feature 28), no un literal descartado.
      Fallback: desconocido→crudo, null/""→"—". El build rompe si falta un value (tipado exhaustivo).

### Verificación ejecutable (corrida por el reviewer)
- [x] Feature 29 (6 archivos): **47/47 passed**.
- [x] Suite completa `npx vitest run`: **86 files, 721/721 passed**.
- [x] `./init.sh`: **INIT_EXIT=0**, `== init OK ==`. Lint 0 errores (135 warnings,
      todos en `.claude/skills/` — ajenos, pre-existentes). Typecheck OK. Suite interna 721/721.

---

## Dictamen del flaky de AUTH (HomePage/LoginForm)

CONFIRMADO como flakiness pre-existente bajo ejecución paralela, ajeno a la feature 29:
- `tests/components/HomePage.test.tsx` + `tests/components/LoginForm.test.tsx` en
  AISLAMIENTO: **29/29 passed** (verificado por el reviewer).
- Suite completa corrida por el reviewer: **721/721 sin ningún rojo** (el fallo intermitente
  no se manifestó en esta corrida, consistente con flakiness por concurrencia).
- El diff de la feature 29 NO toca `app/(app)/page.tsx`, `LoginForm` ni sus tests
  (verificado por git: "NONE").
Conclusión: **NO es bloqueante para la feature 29**. Se registra como observación de deuda
de suite (flakiness de auth bajo paralelismo), ajena a esta feature.

## Nota del reword de `design.md` (guard no-embalaje, feature 28)
CONFIRMADO documental: el reword del parentético en D5 no cambió decisión ni requisito;
el mapa usa `en_fulfillment` (value vigente del seed) y ancla las claves a `ORDER_STATUS_SEED`.
`tests/unit/guards/no-embalaje.test.ts` verde en la suite. Sin impacto funcional.

---

## Hallazgos

- **Observación (no bloqueante):** flakiness de auth bajo paralelismo (dictaminada arriba).
- **Observación (no bloqueante):** `OrdenesCargaMasivaButton.tsx` conserva comentarios con
  numeraciones R de features previas (14/16/21) que no corresponden a la feature 29
  (p. ej. "R21/[RESUELTO-6]", "R18, R19" en el docstring del wrapper). Es ruido documental
  heredado, no afecta comportamiento ni trazabilidad. Sugerencia menor de limpieza futura.

Sin hallazgos BLOQUEANTES. Sin hallazgos menores que impidan el merge.

## Checkpoints de datos/seguridad/capas
No aplican: feature frontend puro, sin tablas, migraciones, webhooks, secretos ni
Server Actions nuevas (consume backend existente de 15/16). RLS/idempotencia/firma N/A.
