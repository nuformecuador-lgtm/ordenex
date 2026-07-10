# review_notificaciones.md — Revisión (feature 11 · notificaciones / sistema de toast)

Reviewer · branch `feature/11-notificaciones` · 2026-07-09
Spec aprobado y revisado 2026-07-10. Sistema de toast compuesto sobre
`@base-ui/react/toast` ([RESUELTO-C]) + adaptador puro `messageFromActionError`.

## Veredicto: APROBADO — 0 bloqueantes

---

## Checklist de revisión

- [x] **Decisión cerrada 1 (Base UI):** `ToastProvider`/`ToastItem` componen sobre
  primitivas reales de Base UI — `Toast.Provider` (props `timeout`/`limit`),
  `Toast.Portal`, `Toast.Viewport`, `Toast.Root` (prop `toast`), `Toast.Title`,
  `Toast.Description`, `Toast.Close`, y `Toast.useToastManager()`. NO reimplementa
  timers, portal, apilado, pausa ni límite a mano: auto-descarte/pausa/límite/ids
  son nativos de Base UI. Confirmado leyendo el código, no solo la bitácora.
- [x] **Decisión cerrada 2 (cableado FUERA de alcance):** `git diff --name-only origin/dev`
  NO incluye `app/(app)/ordenes/page.tsx` ni su test, ni el `onError` del `Modal`.
  El único fichero de producción modificado es `app/(app)/layout.tsx` (monta el
  provider sin cablear consumidores).
- [x] **Decisión cerrada 3 (`validation_error` → genérico):** `messageFromActionError`
  hace `MSG[CODE_BY_DOMAIN_STATUS[err.status]]`; `validation_error → VALIDATION_ERROR →
  "Los datos enviados no son validos."`. No aplana `fieldErrors`. Test dedicado lo
  asevera (`msg.not.toContain("peso")`).
- [x] **Trazabilidad R1..R21 → test real** (tabla abajo). Cada R renderiza el
  componente real y afirma sobre DOM/roles/ids/timers. No hay tests vacíos.
- [x] **a11y:** `role="alert"` para error/warning y `role="status"` para success/info
  (R8, leído del `Toast.Root` real); viewport `role="region"` + `aria-label="Notificaciones"`
  (R9); `Toast.Close aria-label="Cerrar notificación"` (R13). Verificado en código y test.
- [x] **Diff acotado:** producción = `providers/ToastProvider.tsx`, `hooks/useToast.ts`,
  `components/shared/Toast.tsx`, `lib/utils/action-error-message.ts`, `app/(app)/layout.tsx`;
  + 3 tests + spec/progress. NO aparece `lib/errors/**` ni `lib/actions/**` ni
  `ordenes/page.tsx`.
- [x] **Calidad:** TS strict (typecheck limpio), sin `any` propio (el `any` es el
  default del genérico de Base UI `useToastManager<Data extends object = any>`, no
  introducido por nosotros), sin `catch` vacío (el `catch` de `useToast` re-lanza con
  mensaje descriptivo, R2), `"use client"` en provider/hook/componente y ausente en
  el adaptador puro (correcto). El adaptador solo importa `MSG`/`CODE_BY_DOMAIN_STATUS`
  de `@/lib/errors/codes` y el tipo `ActionError`; es puro sin side effects.
- [x] **Verificación ejecutable (corrida por el reviewer):** `./init.sh` en verde.
- [x] **Sin regresiones:** `AppLayout.test.tsx` y `OrdenesPage.test.tsx` verdes
  (5 files / 38 tests en corrida focalizada).
- [x] **Limitaciones documentadas:** R15 por foco de teclado SÍ se reproduce en jsdom
  y tiene test propio además del de hover (documentado en la bitácora). R18: selector
  `data-limited` documentado en el propio test.
- [x] **CHECKPOINTS aplicables:** spec (requirements EARS + design con 3 alternativas
  descartadas + tasks todas `[x]`), trazabilidad + mapa en `impl_`, typecheck/lint/test
  verdes, init.sh verde. RLS/migraciones/webhooks/secretos/capas/permisos/multi-país:
  N/A (UI de cliente pura, sin DB, sin API routes, sin secretos).

## Salida real de `./init.sh`

```
== Arnes SDD :: init ==
! jq no esta instalado (recomendado para validar feature_list.json)
✓ node v24.13.0
✓ dependencias presentes
-> pnpm run typecheck   (tsc --noEmit) — sin diagnósticos
-> pnpm run lint        (eslint) — sin hallazgos
-> pnpm run test        (vitest run)
 Test Files  54 passed (54)
      Tests  413 passed (413)
   Duration  18.81s
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

Baseline previa 51 files / 384 tests → +3 files / +29 tests (ToastProvider 21 +
Toast 6 + action-error-message 2). Coincide con la bitácora del implementer.

## Trazabilidad R1..R21 → test (verificada)

| R | Test (archivo :: nombre) | Aserción real verificada |
| --- | --- | --- |
| R1 | ToastProvider :: "R1: ... identidad estable entre renders" | tipos de los 6 métodos + `after === before` tras re-render |
| R2 | ToastProvider :: "R2: fuera de ToastProvider lanza" | `toThrow(/ToastProvider/i)` sin provider |
| R3 | ToastProvider :: "R3: renderiza children sin alterarlos" | hijo por `testid` + texto presente |
| R4 | ToastProvider :: "R4: toast.success muestra ese texto" | `toastsWithText("Guardado")` length 1 |
| R5 | ToastProvider :: "R5: show devuelve id y muestra toast" | id string no vacío + toast visible |
| R6 | ToastProvider :: "R6: ids consecutivos no colisionan" | `ids[0] !== ids[1]` |
| R7 | Toast :: "R7: variante %s expone data-variant y su icono" (x4) | `data-variant` = variante + `svg[aria-hidden]` |
| R8 | Toast :: "R8: error/warning role=alert" / "success/info role=status" | `getAttribute("role")` en el root real |
| R9 | ToastProvider :: "R9: región accesible por portal" | `getByRole("region",{name:/notificaciones/i})` contiene el root |
| R10 | ToastProvider :: "R10: auto-descarta tras duración default" | fake timers, +5100ms → length 0 |
| R11 | ToastProvider :: "R11: respeta duración por-toast" | corto desaparece a 1500ms, largo persiste |
| R12 | ToastProvider :: "R12: duration 0 persiste" | +60000ms → sigue length 1 |
| R13 | ToastProvider :: "R13: botón de cierre retira el toast" | click `aria-label` cierre → length 0 |
| R14 | ToastProvider :: "R14: dismiss(id) retira" / "id inexistente es no-op" | dismiss retira; id falso no lanza ni afecta |
| R15 | ToastProvider :: "R15: pausa por hover" / "pausa por foco de teclado" | hover/focus pausa +8000ms; leave/blur reanuda |
| R16 | ToastProvider :: "R16: onDismiss una vez (auto)" / "(manual)" | spy `toHaveBeenCalledTimes(1)`, no re-invoca |
| R17 | ToastProvider :: "R17: se apilan simultáneamente" | 3 toasts visibles a la vez |
| R18 | ToastProvider :: "R18: al superar max los antiguos dejan de mostrarse" | max=2, visibles<=2, antiguo `data-limited=""` |
| R19 | ToastProvider :: "R19: retirar uno no afecta a los demás" | cerrar Fallo, Guardado sigue |
| R20 | ToastProvider :: "R20: consumidor bajo el provider dispara y ve toast" | harness sin provider propio dispara toast |
| R21 | action-error-message :: "mapea cada status → MSG canónico" / "validation_error genérico" | 5 literales → MSG.*; validation no aplana fieldErrors |

Los 21 requisitos tienen ≥1 test que ejerce el comportamiento (no vacío). El mapa de
la bitácora coincide con los nombres reales de los tests.

## Hallazgos

### Bloqueantes
- Ninguno.

### Menores (no bloquean; opcionales de follow-up)
- `useToast` hace `catch { throw new Error(...) }`, lo que descarta el error original
  de Base UI (se pierde la causa/stack). El mensaje es descriptivo y cumple R2; si se
  quiere, `throw new Error(msg, { cause: e })` conservaría la traza. No bloqueante.
- El adaptador cubre `ActionError`; un `AppErrorShape` se pasa directo por su `.message`
  según diseño. No hay helper de unión ni test para el discriminador `isAppErrorShape`,
  pero el spec lo deja fuera (el consumidor decide). Coherente con [RESUELTO-A].

## Nota de estado
`feature_list.json` mantiene la feature 11 en `in_progress` y `progress/history.md`
aún no tiene entrada de la feature 11: es lo esperado antes del merge (el checkpoint
"entrada en history" se completa al mergear). No afecta el veredicto.

## Veredicto final: APROBADO (0 bloqueantes)
