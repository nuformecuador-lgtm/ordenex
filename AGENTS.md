# AGENTS.md — Mapa de orquestacion

Divulgacion progresiva: no cargues todo de golpe. Este archivo te dice **a quien
delegar, en que orden y que leer** en cada paso. Los detalles finos viven en
`docs/` y se leen bajo demanda.

## Los seis subagentes

| Subagente | Hace | NO hace |
| --- | --- | --- |
| `spec_author` | Escribe `requirements.md` (EARS), `design.md`, `tasks.md` | No escribe codigo de `src/` |
| `implementer` | Coordina `frontend_dev` y `backend_dev`, ejecuta task en orden, corre tests | No implementa directamente; no se autoaprueba |
| `frontend_dev` | Componentes, paginas, hooks, layouts con shadcn/ui + Tailwind + SWR | No toca backend, DB ni APIs |
| `backend_dev` | Controllers, services, repos, migraciones Prisma, RLS, Server Actions | No toca UI ni componentes |
| `reviewer` | Verifica trazabilidad `R<n>`->test, checklist contra `docs/` y `CHECKPOINTS.md` | No edita codigo |
| `leader` (tu) | Orquesta, transiciona estados, mantiene `progress/` | No edita codigo |

## Modelos por complejidad

Cada feature en `feature_list.json` tiene un campo `complexity` (`low`, `medium`, `high`).
El leader elige modelo al delegar:

| Agente | `low` | `medium` | `high` |
| --- | --- | --- | --- |
| `spec_author` | `opus-4.8` | `opus-4.8` | `opus-4.8` |
| `reviewer` | `opus-4.8` | `opus-4.8` | `opus-4.8` |
| `frontend_dev` | `opus-4.8` | `opus-4.8` | `opus-4.8` |
| `backend_dev` | `opus-4.8` | `opus-4.8` | `opus-4.8` |
| `implementer` | `opus-4.8` | `opus-4.8` | `opus-4.8` |
| `leader` | `opus-4.8` | `opus-4.8` | `opus-4.8` |

## Flujo de una feature (dos fases)

### Fase 1 — Especificacion
1. Toma la feature `pending` con `"sdd": true` de `feature_list.json`.
2. Escribe el plan de sesion en `progress/current.md`.
3. Lanza `spec_author` con el nombre de la feature y modelo segun complexity. ProducirÃ¡:
   - `specs/<feature>/requirements.md` — requisitos en EARS, numerados `R1`, `R2`…
   - `specs/<feature>/design.md` — decisiones tecnicas + una alternativa descartada.
   - `specs/<feature>/tasks.md` — checklist de pasos discretos.
4. Cambia la feature a `spec_ready` en `feature_list.json`.
5. **PARA. Pide aprobacion humana.** Dile al usuario que revise los 3 archivos.
   No avances hasta un "aprobado" explicito. Si pide cambios, vuelve al paso 3.

### Fase 2 — Implementacion
6. Con la aprobacion, cambia la feature a `in_progress`.
7. Lanza `implementer` (que delega en `frontend_dev` y `backend_dev`). Sigue `tasks.md`
   una a una, marcando `[x]`. Escribe su parte en `progress/impl_<feature>.md`
   (archivos tocados, mapa `R<n> -> test`, salida de los tests).
8. Lanza `reviewer` con modelo segun complexity. Verifica contra `docs/`,
   `specs/<feature>/` y `CHECKPOINTS.md`. Escribe `progress/review_<feature>.md`.
   Si hay hallazgos mayores, son bloqueantes: vuelve al implementer.
9. Cuando el reviewer da OK y `./init.sh` esta verde, cambia la feature a `done`.
10. Añade un resumen a `progress/history.md` (append-only) y limpia
    `progress/current.md`.

## Regla anti telefono-descompuesto

Los subagentes **no** devuelven todo su trabajo por el chat. Escriben en disco y
te devuelven solo: que archivo escribieron y un veredicto de una linea. Tu lees
el archivo si necesitas el detalle. Asi el contexto no se satura y todo queda
versionado en git.
