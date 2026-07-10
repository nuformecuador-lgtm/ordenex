# impl — ordenes: carga masiva (botón + modal) (feature 14)

> Fase 2 (implementación). Zona: frontend puro (composición). Spec aprobado por
> humano 2026-07-10. Branch: `feature/14-ordenes-carga-masiva`.
> Delegado a `frontend_dev`; verificado por el implementer.

## Resultado

Feature COMPLETA. Composición pura: botón "Carga masiva" en `/ordenes` que abre un
`Modal` (feature 13) contenedor del `BulkUpload` (feature 9) apuntando al endpoint
`POST /api/ordenes/carga-masiva` (feature 15). Sin backend nuevo, sin modificar
genéricos (R19 cumplido).

## Archivos creados

- `app/(app)/ordenes/_components/OrdenesCargaMasivaButton.tsx` — wrapper de cliente
  (`"use client"`): estado `open`, `Button` disparador, `Modal` contenedor
  (`hideCancel`, `confirmLabel="Cerrar"`, sin `onConfirm`), `BulkUpload` como
  children, constante `ORDENES_BULK_FIELDS` (11 columnas en orden), guard
  `parseResumen(unknown)`, `handleSuccess` (mutate por matcher + toast success/warning,
  sin cerrar) y `handleError` (toast error, sin mutate).
- `tests/components/OrdenesCargaMasivaButton.test.tsx` — 21 tests (jsdom, vitest +
  testing-library + userEvent). Dobles: `useToast`, `BulkUpload` (captura props +
  callbacks), `useSWRConfig().mutate`; espía de `global.fetch` (sin llamada real).

## Archivos modificados

- `app/(app)/ordenes/page.tsx` — fila de cabecera `<div className="flex justify-end">`
  con `<OrdenesCargaMasivaButton />` sobre el `DataTable`. SWR/paginación intactos.
- `tests/components/OrdenesPage.test.tsx` — helper `renderPage()` envuelto en
  `<ToastProvider>` (necesario porque `page.tsx` ahora monta el botón, que llama
  `useToast()` al montar). Solo cambia el wrapper del helper, no la lógica de los tests.
- `tests/components/OrdenesPagination.test.tsx` — mismo ajuste del helper `renderPage()`.

## No tocados (R19 verificado en `git diff --name-only`)

`components/shared/BulkUpload.tsx`, `components/shared/Modal.tsx`,
`components/shared/Toast.tsx`, `providers/ToastProvider.tsx`, `hooks/useToast.ts`,
`app/api/**`. Diff acotado a `app/(app)/ordenes/**` + `tests/**` + `specs/**`.

## Mapa R -> test

Archivo de tests: `tests/components/OrdenesCargaMasivaButton.test.tsx`.

| R | Test |
|---|------|
| R1 | "R1: renderiza el botón 'Carga masiva'" |
| R2 | "R2: el botón es type=button" |
| R3 | "R3: al hacer clic aparece el dialog" |
| R4 | "R4: el modal muestra el título 'Carga masiva de órdenes'" |
| R5 | "R5: el cuerpo del modal contiene BulkUpload" |
| R6 | "R6: el pie tiene un único botón 'Cerrar' y no 'Confirmar'" |
| R7 | "R7a: clic en 'Cerrar' cierra el modal" + "R7b: Escape cierra el modal" |
| R8 | "R8: endpoint = /api/ordenes/carga-masiva" |
| R9 | "R9: accept = ['csv','xlsx']" |
| R10 | "R10: fieldName = 'file'" |
| R11 | "R11: fields tiene las 11 keys en orden" |
| R12 | "R12: templateFileName = 'plantilla-ordenes-carga-masiva.csv'" |
| R13 | "R13: onSuccess llama a mutate con matcher de 'ordenes:list'" |
| R14 | "R14: onSuccess conError=0 -> toast.success con conteos" |
| R15 | "R15a: onSuccess conError>0 -> toast.warning" + "R15b: onSuccess con data no parseable -> toast.warning" |
| R16 | "R16: onError -> toast.error con message, sin mutate" |
| R17 | "R17: onSuccess NO cierra el modal" |
| R18 | "R18: el dialog abierto expone aria-modal" |
| R19 | Criterio de "hecho": revisión de diff (solo `app/(app)/ordenes/**` + tests; sin genéricos ni backend) + "no invoca fetch global" |

Todos los R1..R18 con test explícito; R19 verificado por alcance de diff. Cobertura
completa de trazabilidad.

## Salida real de verificación

```
pnpm typecheck  -> sin errores (tsc --noEmit)
pnpm lint       -> sin errores/warnings (eslint)
pnpm test       -> Test Files 61 passed (61) | Tests 506 passed (506)
./init.sh       -> == init OK ==
```

Baseline de la rama: 60 files / 485 tests. Ahora: 61 files / 506 tests
(+1 archivo, +21 tests). Ningún test previo bajó.

## Decisiones / deuda

- Decisiones humanas cerradas aplicadas: (1) modal NO se cierra al éxito (R17);
  (2) botón solo texto "Carga masiva" alineado a la derecha (R1); (3) sin
  `maxSizeBytes` en cliente (backend es la autoridad); (4) toast solo con totales
  `creadas`/`duplicadas`/`conError` (R14).
- Ajuste de dos tests existentes (`OrdenesPage`/`OrdenesPagination`): envolver
  `renderPage` en `ToastProvider` real. Es consecuencia directa e inevitable de
  montar `OrdenesCargaMasivaButton` (que usa `useToast()` incondicionalmente) en
  `page.tsx`; sin ello esos 15 tests fallaban con "useToast debe usarse dentro de un
  ToastProvider". No se alteró la lógica de esos tests.
- Sin deuda pendiente ni bloqueos.
