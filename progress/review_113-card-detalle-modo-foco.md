# Review 113 — card en reparto: detalle completo inline + modo foco al gestionar

> Reviewer. Rama `feature/113-card-detalle-modo-foco`. Diff vs `origin/dev`.
> Verificación ejecutable corrida por el reviewer (no se confía solo en la bitácora).

## Alcance del diff (name-only vs dev)

Producción: SOLO `app/(app)/mis-asignaciones/_components/MisAsignacionesModule.tsx`.
Tests: `tests/components/MisAsignacionesModule.test.tsx`.
Docs: `specs/113-*/… (requirements/design/tasks)`, `progress/impl_113-*`.
NO se tocó: backend/service/repo, `AsignacionDetalle.tsx`, `GestionarOrdenPanel.tsx`,
`page.tsx`, `MisAsignacionesPage.test.tsx`, `MarcarLuegoToggle.*`. Coincide con `tasks.md`.

## Checklist del arné

- [x] `specs/113/requirements.md` con EARS numerados R1–R12.
- [x] `specs/113/design.md` con alternativas descartadas (Alt A ruta dedicada, Alt B acordeón).
- [ ] **`specs/113/tasks.md` con TODAS las tareas marcadas `[x]`** → **FALLA**: T0–T11 están `[ ]`.
- [x] `progress/impl_113-*.md` contiene el mapa R→test.
- [x] Trazabilidad: cada R1–R12 mapea a un test real con aserciones (tabla abajo).
- [x] `typecheck` 0 errores.
- [x] `lint` 0 errores (143 warnings preexistentes, no de esta feature).
- [x] `pnpm test` / `./init.sh` en verde (números abajo).
- [x] RLS/migraciones/webhooks/secretos: N/A (cambio de presentación puro, sin DB ni backend).
- [x] Capas: no se introdujo lógica de negocio ni HTTP en el cliente; reusa componentes.
- [x] Sin hardcode de país/moneda/cuenta.
- [ ] Entrada en `progress/history.md` para 113 → pendiente (paso del leader, post-review).

## Verificación ejecutable (corrida por el reviewer)

`./init.sh` → verde. typecheck 0 err · lint 0 err (143 warn preexistentes).

```
Suite completa:   Test Files 459 passed (459)   Tests 4586 passed (4586)
Aislado (113+115+page):   Test Files 3 passed (3)   Tests 66 passed (66)
```

## Trazabilidad R → test (`tests/components/MisAsignacionesModule.test.tsx`)

| Req | Test (archivo:línea) | Aserción real |
| --- | --- | --- |
| R1  | :1061 | Cada card trae Pedido/Entrega/Cobro + "Valor a cobrar"/"Dirección" con datos propios (no del vecino). |
| R2  | :1097 | "Termina la gestión en curso" ausente en vista completa Y en foco. |
| R3  | :1119 | `bloqueado=true`: card `disabled` pero con Pedido/Valor a cobrar/dirección visibles. |
| R4  | :1140 | `ordenEnGestionId="g2"`: cards g1 y g2 ausentes del DOM; `escogerParaGestion` no llamado. |
| R4b | :1159 | `escogerParaGestion({ ordenId:"g1" })` una vez; sin llamadas nuevas (liberar/gestionar/recoger no invocadas). |
| R5  | :1182 | En foco el panel muestra "Orden REM-G2 · Activa Dos" (la activa). |
| R6  | :409  | Colapso a foco: ambas cards ausentes + sin texto de ocultamiento + solo panel de la activa. |
| R7  | :1196 | En foco: sin `ruta-mapa`, sin "Mapa de ruta", sin botón "Sincronizar ruta". |
| R8  | :1212 | En foco: sin región "Por recoger", "Recoger por número de guía" ni "Recoger por escaneo". |
| R9  | :1228 | En foco (`yaActiva`): 4 botones (Entregar/Rechazar/Reprogramar/Devolver) + "Cancelar gestión"; sin gate de guía; `escoger` no llamado. |
| R10 | :1252 | Rerender `ordenEnGestionId=null`: regresan grilla (g1/g2), "Por recoger" y `ruta-mapa`. |
| R11 | :1298 | `porGestionar=[]` con puntero: muestra vacío, sin panel ni foco. |
| R12 | :1313 | `bloqueado=true` + puntero: aviso de bloqueo, cards deshabilitadas visibles, sin panel (no colapsa a foco). |

Todos los R están cubiertos por tests con aserciones significativas (no vacíos).

## Verificación por objetivo del brief

1. **Detalle inline (R1/R2/R3):** `AsignacionDetalle` montado inline en cada card
   (`MisAsignacionesModule.tsx:428`). El string "Termina la gestión en curso" NO existe
   como texto renderizado (solo aparece en un comentario de código `:426` y en aserciones
   de test que verifican su ausencia). Con `bloqueado=true` la card queda `disabled` pero
   conserva el detalle (R3 verde). OK.
2. **Bloqueo 1-a-1 intacto (R4/R4b):** el diff NO altera imports ni firmas: sigue
   `escogerParaGestion({ ordenId })` y `liberarGestion({ ordenId })` con el mismo payload;
   `gestionar` se invoca dentro de `GestionarOrdenPanel` (no tocado). Sin Server Actions
   nuevas. El bloqueo se mantiene como restricción de ACCIÓN. OK.
3. **Modo foco (R5–R10):** `modoFoco = !bloqueado && ordenEnGestionId !== null &&
   detalleOrden !== null` (`:152`). En foco solo se renderiza `GestionarOrdenPanel`
   (`yaActiva`) y se omite toda la rama no-foco (grilla/mapa/Sincronizar/Por recoger).
   Restaura al volver el puntero a `null` (deriva sola). OK.
4. **Bordes (R11/R12):** vacío no entra en foco; `bloqueado` tiene precedencia. OK.
5. **Preservación 115:** sort estable `porGestionarVisual` (`:108`), badge "Gestionar más
   tarde" dentro del botón (`:416-420`), toggle `MarcarLuegoToggle` hermano del botón
   (`:434-438`). Los tests de 115 (`MarcarLuegoToggle.test.tsx`: R18 badge :216, R19 sort
   :241/:281, R5/R6 toggle) montan el módulo y pasan (66/66 aislado). OK.
6. **Alcance:** único archivo de producción tocado. OK.
7. **Verificación ejecutable:** 4586/4586 verdes por el reviewer. OK.

## Hallazgos

### BLOQUEANTE

- **B1 — `specs/113-card-detalle-modo-foco/tasks.md`: las 12 tareas (T0–T11) siguen
  marcadas `[ ]`, ninguna `[x]`.** Incumple CHECKPOINTS.md ("Existe `tasks.md` y todas las
  tasks están marcadas `[x]`"), gate contra el que valida el reviewer. El trabajo está de
  hecho completo (código correcto, bitácora con mapa R→test y suite verde), por lo que es
  una omisión clerical, pero el checkpoint es explícito. **Qué falta para cumplirlo:** el
  implementer marca T0–T11 como `[x]` en `tasks.md`. NO requiere cambios de código ni tests.

### menor (no bloqueantes)

- **m1 — `progress/history.md` sin entrada de 113.** Es paso del leader tras el review OK;
  informativo, no imputable al implementer en esta etapa.
- **m2 — Cobertura R7 parcial:** el test R7 (:1196) usa `RUTA_VIGENTE`, así que no asevera
  explícitamente que el alert "El orden mostrado no está actualizado" quede oculto en foco.
  No es un gap de comportamiento: ese alert vive dentro de la rama no-foco, que en foco no
  se renderiza en absoluto. Cobertura, no defecto.
- **m3 — Comentario en producción (`:426`) cita el string eliminado** "Termina la gestión
  en curso…" para documentar lo removido. No se renderiza; no viola R2 (que habla del texto
  en la vista). Informativo.

## Veredicto

**RECHAZADO** — 1 bloqueante (B1: `tasks.md` con T0–T11 sin marcar `[x]`, incumple
CHECKPOINTS.md). Todo lo sustantivo (trazabilidad R1–R12, detalle inline, bloqueo 1-a-1,
modo foco, bordes, preservación de la 115, alcance y verificación ejecutable 4586/4586)
está correcto. Remediación única y trivial: marcar T0–T11 como `[x]`; no vuelve a tocarse
código ni tests. Tras eso, APROBABLE.
