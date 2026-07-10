# review — ordenes: carga masiva (botón + modal) (feature 14)

> Fase 3 (revisión). Reviewer. Branch: `feature/14-ordenes-carga-masiva`.
> Fecha: 2026-07-10. NO se editó código; solo verificación.

## Veredicto: APROBADO — 0 bloqueantes

---

## Checklist

- [x] **Composición pura (R19).** `git diff --name-only origin/dev` + untracked:
  NO toca `components/shared/BulkUpload.tsx`, `Modal.tsx`, `Toast`/`ToastProvider`,
  `hooks/useToast.ts`, `app/api/**` ni `lib/**`. Código nuevo solo en
  `app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx` + `page.tsx` (montaje)
  + tests. Diff acotado.
- [x] **Props reales de BulkUpload (R8-R12).** endpoint `/api/ordenes/carga-masiva`,
  accept `["csv","xlsx"]`, fieldName `"file"`, templateFileName
  `"plantilla-ordenes-carga-masiva.csv"`, fields = 11 columnas en orden. El test R11
  asevera `fields.map(f=>f.key)` === las 11 keys EN ORDEN. Sin `maxSizeBytes`
  (RESUELTO-3 cumplido).
- [x] **Modal contenedor puro (R4-R7).** `hideCancel`, `confirmLabel="Cerrar"`, sin
  `onConfirm`; título "Carga masiva de órdenes"; cierre por "Cerrar" (R7a), Escape
  (R7b). Tests confirman único botón "Cerrar" y ausencia de "Confirmar".
- [x] **onSuccess/onError (R13-R17).** `mutate` con matcher `key[0]==="ordenes:list"`;
  toast success (conError=0) / warning (conError>0 o data no parseable); onError →
  toast error con message y SIN mutate. Modal NO se cierra al éxito (R17). Tests
  espían `useSWRConfig().mutate`, `useToast` (success/error/warning) y validan el
  matcher evaluándolo contra claves de ejemplo. No son vacíos.
- [x] **Trazabilidad R1..R19 → test.** Ver tabla. Todos los R con test que ejerce lo
  que declara. R19 verificado por alcance de diff (correcto).
- [x] **Cambios en tests existentes.** `OrdenesPage.test.tsx` y
  `OrdenesPagination.test.tsx` solo envuelven `renderPage()` en `<ToastProvider>`
  (necesario porque `page.tsx` ahora monta el botón que llama `useToast()`). NINGÚN
  assert de paginación/listado eliminado ni relajado.
- [x] **Verificación ejecutable.** `./init.sh` corrido por el reviewer → verde.
- [x] **Decisiones humanas cerradas.** (1) Modal no cierra al éxito; (2) botón solo
  texto "Carga masiva" alineado a la derecha (`flex justify-end`); (3) sin
  `maxSizeBytes`; (4) toast solo totales creadas/duplicadas/conError. Todas aplicadas.
- [x] **CHECKPOINTS.md.** Spec (3 archivos, design con A1/A2 descartadas, tasks todas
  `[x]`) ✓. Trazabilidad + mapa R→test en impl ✓. typecheck/lint/test verdes ✓.
  Sin tablas/migraciones/secretos/webhooks nuevos (N/A seguridad). Sin backend
  (N/A capas/permisos). Sin hardcode de país/moneda/cuenta ✓. history.md actualizado ✓.

---

## Trazabilidad R1..R19 → test

| R | Test | OK |
|---|------|----|
| R1 | "R1: renderiza el botón 'Carga masiva'" | ✓ |
| R2 | "R2: el botón es type=button" | ✓ |
| R3 | "R3: al hacer clic aparece el dialog" | ✓ |
| R4 | "R4: el modal muestra el título 'Carga masiva de órdenes'" (aria-labelledby) | ✓ |
| R5 | "R5: el cuerpo del modal contiene BulkUpload" | ✓ |
| R6 | "R6: el pie tiene un único botón 'Cerrar' y no 'Confirmar'" | ✓ |
| R7 | "R7a: clic en 'Cerrar' cierra" + "R7b: Escape cierra" | ✓ |
| R8 | "R8: endpoint = /api/ordenes/carga-masiva" | ✓ |
| R9 | "R9: accept = ['csv','xlsx']" | ✓ |
| R10 | "R10: fieldName = 'file'" | ✓ |
| R11 | "R11: fields tiene las 11 keys en orden" | ✓ |
| R12 | "R12: templateFileName = 'plantilla-ordenes-carga-masiva.csv'" | ✓ |
| R13 | "R13: onSuccess llama a mutate con matcher de 'ordenes:list'" (evalúa matcher) | ✓ |
| R14 | "R14: onSuccess conError=0 → toast.success con conteos" | ✓ |
| R15 | "R15a: conError>0 → toast.warning" + "R15b: data no parseable → toast.warning" | ✓ |
| R16 | "R16: onError → toast.error con message, sin mutate" | ✓ |
| R17 | "R17: onSuccess NO cierra el modal" | ✓ |
| R18 | "R18: el dialog abierto expone aria-modal" | ✓ |
| R19 | Criterio "hecho" + revisión de diff (solo ordenes/** + tests) + "no invoca fetch global" | ✓ |

---

## Hallazgos

- **menor** — El assert de R14 verifica que el mensaje del toast `contiene` "2","1","0"
  (los conteos), lo cual es correcto pero podría coincidir por casualidad con otros
  formatos. Robusto para el mensaje actual; no bloqueante.
- **menor** — CHECKPOINTS.md pide E2E (Playwright) para flujos críticos como "ingesta
  de órdenes". Esta feature es composición UI pura y el spec aprobado por humano acota
  la verificación a tests de componente (Vitest); la lógica de ingesta real vive en el
  endpoint (feature 15) con su propia suite. No bloqueante para esta feature.

Ningún hallazgo bloqueante.

---

## Salida real de `./init.sh`

```
== Arnes SDD :: init ==
! jq no esta instalado (recomendado para validar feature_list.json)
✓ node v24.13.0
✓ dependencias presentes
-> pnpm run typecheck   (tsc --noEmit)  -> sin errores
-> pnpm run lint        (eslint)        -> sin errores
-> pnpm run test        (vitest run)
   Test Files  61 passed (61)
        Tests  506 passed (506)
✓ todas las migraciones tienen down.sql
✓ .env presente
== init OK ==
```

Baseline dev: 60 files / 485 tests. Ahora: **61 files / 506 tests** (+1 archivo,
+21 tests). Coincide con lo esperado (~61/506). Ningún test previo bajó.

## Veredicto final: APROBADO (0 bloqueantes)
