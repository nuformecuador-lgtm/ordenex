# review_modal.md — Feature 13 (`Modal`)

Reviewer del arnés SDD. Rama `feature/13-modal`. Revisión ejecutada 2026-07-09.
El reviewer NO editó código; solo verificó.

## Veredicto

**APROBADO.** 34 tests de `Modal` verdes (suite completa 379/379). Sin hallazgos
bloqueantes. `./init.sh` en verde ejecutado por el reviewer (no confiando solo en la
bitácora del implementer). R1..R30 mapeados a test real con asserts; R31 delegado a
Base UI sin test propio por decisión humana (correcto).

## Checklist CHECKPOINTS

- [x] `specs/modal/requirements.md` con EARS numerados R1..R31.
- [x] `specs/modal/design.md` con alternativas descartadas (shadcn/Radix dialog y
      diálogo 100% propio) y su porqué.
- [x] `specs/modal/tasks.md` presente; T1–T11 declaradas completadas (ver hallazgo
      menor sobre formato de checkbox).
- [x] Cada R<n> (R1..R30) mapea a ≥1 test concreto que lo ejerce. R31 sin test por
      decisión humana documentada.
- [x] `progress/impl_modal.md` contiene el mapa R<n> → test.
- [x] `pnpm typecheck` sin errores (verificado por el reviewer).
- [x] `pnpm lint` sin errores (verificado por el reviewer).
- [x] `pnpm test` 379/379 (verificado por el reviewer); Modal.test.tsx 34/34.
- [x] `./init.sh` termina en verde (verificado por el reviewer).
- [n/a] RLS / migraciones / down.sql / webhooks / firma / idempotencia / capas
      Controller-Service-Repo: feature de UI pura de cliente, sin datos, sin tablas,
      sin endpoints. No aplica.
- [x] Sin secretos hardcodeados; sin hardcode de país/moneda/cuenta.

## Fidelidad a la spec y decisiones humanas (2026-07-09)

- [x] `Modal` genérico en `components/shared/Modal.tsx`, `"use client"`.
- [x] Compuesto sobre `@base-ui/react/dialog` YA instalado (Root/Portal/Backdrop/
      Popup/Title/Description) + `Button` de `@/components/ui/button`.
- [x] **NO se instaló** shadcn dialog ni `@radix-ui/react-dialog`. `package.json` sin
      deps nuevas de dialog; `pnpm-lock.yaml` sin `@radix-ui/react-dialog` (los refs
      radix presentes son transitivos preexistentes: slot, toggle, primitive,
      compose-refs, use-controllable-state — ninguno es un dialog).
- [x] Props: `open`/`onOpenChange`, `title`, `children` arbitrarios, confirmar/
      cancelar (`confirmLabel`/`cancelLabel`), `onConfirm`, `onError`,
      `confirmVariant?: 'default'|'destructive'`. Contrato coincide con design.md.
- [x] Async `onConfirm`: spinner (`Loader2` + `role=status`) y botón `disabled`
      durante pending (R15/R16/R18); anti-doble-submit con doble red (`disabled` +
      `pendingRef` síncrono) — R17 testeado (1 sola invocación). Al RESOLVER cierra
      si `closeOnConfirm!==false` (R20); al RECHAZAR llama `onError(error)`, para
      spinner, RE-HABILITA confirmar y cancelar y NO cierra (R22/R23). Sin render de
      error propio, sin prop `errorMessage`. Todo cubierto por tests.
- [x] `confirmVariant='destructive'` reenvía la variante al `Button` (R8b): tests
      afirman `bg-primary` (default) y `text-destructive` (destructive), consistente
      con `buttonVariants` de `components/ui/button.tsx`.
- [x] Comportamiento síncrono sin spinner (R11/R12) testeado.
- [x] Accesibilidad `aria-modal`/labelledby/describedby/Escape/overlay (R5/R6/R25/
      R26/R28/R29/R30) testeada. Nota: `aria-modal="true"` se pasa explícito al Popup
      porque Base UI 1.6.0 no lo emite por defecto (documentado en impl_modal.md);
      correcto y estándar.

## Convenciones

- [x] TS strict, sin `any` no justificado (`isThenable` usa narrowing tipado; error
      como `unknown`).
- [x] Nombres: `Modal.tsx` PascalCase, funciones camelCase.
- [x] Manejo de errores sin `catch` vacío: el `catch` vuelve a `idle`, re-habilita
      botones y delega en `onError`. No traga el error silenciosamente.
- [x] Sin sobre-ingeniería: promoción a `shared/` justificada (≥2 features:
      14 carga masiva + confirmaciones de borrado). No reimplementa focus-trap/overlay.

## Tabla de trazabilidad R<n> → test (verificada contra el archivo de tests)

| R | Test verificado | Assert real |
| --- | --- | --- |
| R1 | "R1: no renderiza el diálogo cuando open es false" | queryByRole dialog null |
| R2 | "R2: renderiza un contenedor rol dialog cuando open es true" | findByRole dialog |
| R3 | "R3/R4: al cerrar invoca onOpenChange(false) y no muta open" | spy(false) + sigue montado |
| R4 | "R3/R4: ..." | onOpenChange recibe booleano |
| R5 | "R5: asocia el título con aria-labelledby" | id resuelve al texto |
| R6 | "R6: ... aria-describedby solo si se provee" + "sin description no expone" | id + ausencia |
| R7 | "R7: renderiza children arbitrarios" | botón Hijo presente |
| R8 | "R8: ... labels por defecto" + "... personalizados" | ambos labels |
| R8b | "R8b: variante default" + "R8b: variante destructive" | bg-primary / text-destructive |
| R9 | "R9: confirmar sin onConfirm no lanza (no-op)" | resuelve undefined + cierra |
| R10 | "R10: no renderiza cancelar cuando hideCancel" | cancelar ausente |
| R11 | "R11: invoca onConfirm una sola vez (síncrono)" | toHaveBeenCalledTimes(1) |
| R12 | "R12: cierra tras confirmar síncrono" + "R12/R21: no cierra si false" | spy(false) / no llamado |
| R13 | "R13: cancelar invoca onCancel y onOpenChange(false)" | ambos spies |
| R14 | "R14/R15/R16/R18: entra en pending ..." | role=status aparece |
| R15 | idem | .animate-spin dentro de status |
| R16 | idem | confirmBtn disabled |
| R17 | "R17: no invoca onConfirm una segunda vez" | toHaveBeenCalledTimes(1) |
| R18 | idem R14 | aria-busy=true |
| R19 | 3 tests: Escape / overlay / cancelar deshabilitado | onOpenChange no llamado |
| R20 | "R20: cierra al resolver ..." | spy(false) tras resolve |
| R21 | "R21: permanece abierto ... closeOnConfirm false" | no cierra + sale de pending |
| R22 | "R22: no cierra al rechazar y reactiva botones" | sigue abierto + no disabled |
| R23 | "R23: invoca onError con el error, sin error propio" | onError(error) + no role=alert |
| R24 | "R24: reintenta onConfirm tras rechazo" | toHaveBeenCalledTimes(2) |
| R25 | "R25: cierra con Escape ..." | spy(false) |
| R26 | "R26: cierra al hacer clic en el overlay" | spy(false) |
| R27 | "R27: no cierra por Escape/overlay dismissible false" + "botones sí cierran" | no llamado / spy(false) |
| R28 | "R28: expone aria-modal='true'" | toHaveAttribute |
| R29 | "R29: mueve el foco al interior al abrir" | dialog.contains(activeElement) |
| R30 | "R30: atrapa el foco con Tab" | foco no escapa a body |
| R31 | — | Sin test (delegado a Base UI, decisión humana 2026-07-09). Correcto. |

## Hallazgos

- **menor** — `specs/modal/tasks.md` no usa checkboxes literales `- [x]`; declara el
  avance con una nota "T1–T11 completadas" y criterios "Hecho:" por task.
  CHECKPOINTS pide "tasks marcadas [x]". La sustancia (todas completas y verificadas
  por tests verdes) está cubierta; es sólo formato. No bloquea.
- **menor** — R6 y R8/R8b/R12/R19/R27 se cubren con varios tests bajo una fila; el
  mapa de impl_modal.md ya lo refleja. Sin impacto.

Sin hallazgos BLOQUEANTES.

## Verificación ejecutable (corrida por el reviewer)

```
./init.sh → == init OK ==
  pnpm typecheck → 0 errores
  pnpm lint      → 0 errores
  pnpm test      → Test Files 51 passed (51) · Tests 379 passed (379)
Modal.test.tsx (aislado) → 34 passed (34)
pnpm-lock.yaml → sin @radix-ui/react-dialog; package.json sin deps de dialog nuevas
```
