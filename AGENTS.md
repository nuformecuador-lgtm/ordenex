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

## Estrategia de ramas

```
main <- (solo humano mergea) -- dev <- PR <- feature/<id>-<slug>
```

- Las feature branches nacen de `dev`.
- Los agentes **nunca** tocan `main`. Solo pueden crear branches, pushear y abrir
  PRs hacia `dev`.
- El merge `dev -> main` lo hace el humano cuando `dev` esta estable.

## Evaluacion automatica de `zone` y `complexity`

El leader evalua cada feature `pending` antes de lanzar spec_author. Los campos
`zone`, `complexity` y `branch` se dejan `null` en `feature_list.json`; el leader
los asigna.

### Criterios para `zone`

| Zone | Senales en la description |
| --- | --- |
| `frontend` | "pantalla", "menu", "componente", "UI", "boton", "sidebar", "tabla reusable", "toast", "paginacion", "carga masiva" |
| `backend` | "migracion", "seed", "tabla", "RLS", "API", "endpoint", "manejador de errores" (global) |
| `fullstack` | ambas categorias presentes en la misma feature |

**Particion de `fullstack`:** si la feature evalua como `fullstack`, el leader la
parte en dos:

```
Feature original: "ordenes" (fullstack)
  +-- feature/6-ordenes-backend  (zone: backend, depends_on: null)
  +-- feature/7-ordenes-frontend (zone: frontend, depends_on: 6)
```

La feature hija con `depends_on` no arranca hasta que la dependencia este `done`.
El leader actualiza `feature_list.json` con las dos features y documenta la
particion en `progress/current.md > Evaluaciones`.

### Criterios para `complexity`

| Complexity | Senales |
| --- | --- |
| `low` | 1 archivo/tabla, sin logica condicional compleja |
| `medium` | 2-3 capas, condiciones, multiples archivos |
| `high` | multi-feature, webhooks, integraciones externas |

## Modelos por complejidad

Cada feature tiene un campo `complexity` (`low`, `medium`, `high`).
El leader elige modelo al delegar:

| Agente | `low` | `medium` | `high` |
| --- | --- | --- | --- |
| `spec_author` | `opus-4.8` | `opus-4.8` | `opus-4.8` |
| `reviewer` | `opus-4.8` | `opus-4.8` | `opus-4.8` |
| `frontend_dev` | `opus-4.8` | `opus-4.8` | `opus-4.8` |
| `backend_dev` | `opus-4.8` | `opus-4.8` | `opus-4.8` |
| `implementer` | `opus-4.8` | `opus-4.8` | `opus-4.8` |
| `leader` | `opus-4.8` | `opus-4.8` | `opus-4.8` |

## Paralelismo

Dos features pueden correr en paralelo si sus `zone` son **disjuntas**:

| Feature A | Feature B | Paralelo? |
| --- | --- | --- |
| `frontend` | `backend` | Si |
| `frontend` | `frontend` | No |
| `backend` | `backend` | No |

Feature con `depends_on` no arranca hasta que su dependencia este `done`.

## Integracion con Jira (backlog en la nube)

El backlog vive tambien en Jira (`KAN`) y se sincroniza bidireccionalmente con
`feature_list.json`. Detalle completo en `docs/jira-sync.md`. Lo minimo que el
leader debe hacer:

- **Arranque:** pull de Jira y reconciliar `status` (paso 2 de "Arranque de sesion"
  en `CLAUDE.md`).
- **Al cambiar `status` de una feature**, refleja el cambio en su issue anclada
  (campo `jira: "KAN-<n>"`): `spec_ready`→To Do, `in_progress`→In Progress (21),
  `done`→Done (41). Transiciones via `transitionJiraIssue`.
- **Candado de nube** en F1.0 (arriba).
- **Feature nueva:** crea el issue `Feature` en `KAN` y escribe su key en el campo
  `jira` de `feature_list.json`.

## Flujo de una feature (dos fases)

### Fase 1 — Especificacion

1. (F1.0) **Evaluacion, seleccion y branch.** El leader:
   - Escanea TODAS las features `pending` en orden de `id`.
   - Para cada una con `zone`/`complexity`/`branch` en `null`, evalua usando los
     criterios de arriba y actualiza `feature_list.json` con los valores asignados.
   - Documenta cada evaluacion en `progress/current.md > Evaluaciones`.
   - Identifica las `zone` ocupadas: features que ya estan `in_progress`.
     **Candado de dos capas (ver `docs/jira-sync.md`):** primero consulta la NUBE
     (JQL `project = KAN AND labels = "zone-<zona>" AND statusCategory = "In Progress"`;
     y que el issue objetivo no este asignado a otra persona) y luego lo LOCAL
     (`feature_list.json`). Una zona esta ocupada si lo esta en cualquiera de las dos.
   - Recorre las `pending` (ya evaluadas) en orden de `id` y selecciona la
     **primera** cuya `zone` NO este ocupada. Si la zona ya tiene una feature
     corriendo, la saltea y evalua la siguiente.
   - Al seleccionar: en Jira, **asignate** el issue anclado (`KAN-<n>`) y
     transicionalo a *In Progress* (toma del candado en la nube).
   - Si ninguna zona esta libre (todas las `pending` son de zonas ocupadas),
     espera a que una feature `in_progress` pase a `done` y vuelve a este paso.
   - Si la feature seleccionada evalua como `fullstack`, la parte en dos features
     (`backend` + `frontend`), las registra en `feature_list.json` con `depends_on`
     y vuelve a este paso para la feature `backend` (la `frontend` queda bloqueada
     por `depends_on`).
   - Genera `branch` como `feature/<id>-<slug>` (ej. `feature/8-paginacion`).
   - Crea la rama desde `dev`: `git fetch origin dev; git checkout -b <branch> origin/dev`.
   - Actualiza `feature_list.json` con `zone`, `complexity` y `branch`.
   - Documenta la evaluacion y particion en `progress/current.md > Evaluaciones`.
2. (F1.1) Registra la feature en `progress/current.md > Features en curso`.
3. (F1.2) Lanza `spec_author` con el nombre de la feature y modelo segun complexity.
   Produce:
   - `specs/<feature>/requirements.md` — requisitos en EARS, numerados `R1`, `R2`…
   - `specs/<feature>/design.md` — decisiones tecnicas + una alternativa descartada.
   - `specs/<feature>/tasks.md` — checklist de pasos discretos.
4. (F1.3) Cambia la feature a `spec_ready` en `feature_list.json`.
5. (F1.4) **PARA. Pide aprobacion humana.** Dile al usuario que revise los 3 archivos.
   No avances hasta un "aprobado" explicito. Si pide cambios, vuelve al paso F1.2.

### Fase 2 — Implementacion

6. (F2.0) Con la aprobacion, cambia la feature a `in_progress`.
7. (F2.1) Lanza `implementer` (que delega en `frontend_dev` y `backend_dev`). Sigue
   `tasks.md` una a una, marcando `[x]`. Escribe su parte en
   `progress/impl_<feature>.md` (archivos tocados, mapa `R<n> -> test`, salida de
   los tests).
8. (F2.2) Lanza `reviewer` con modelo segun complexity. Verifica contra `docs/`,
   `specs/<feature>/` y `CHECKPOINTS.md`. Escribe `progress/review_<feature>.md`.
   Si hay hallazgos mayores, son bloqueantes: vuelve al implementer.
9. (F2.3) **Sincronizacion con `dev`.** El implementer:
   - `git fetch origin dev`
   - `git merge origin/dev` en la feature branch.
   - Resuelve conflictos triviales automaticamente.
   - Si un conflicto es ambiguo (no sabe que version conservar), **pregunta al humano**
     y registra el conflicto en `progress/current.md > Conflictos pendientes`.
   - Hace `git push` de los cambios resueltos.
10. (F2.4) **PR hacia `dev`.** El implementer:
    - Ejecuta `gh pr create --base dev --title "feat(<feature>): <description>"`.
    - Reporta la URL del PR al humano.
11. (F2.5) Cuando el humano aprueba y mergea el PR en GitHub, cambia la feature a
    `done`.
12. (F2.6) Añade un resumen a `progress/history.md` (append-only) y limpia la
    feature de `progress/current.md`.

## Regla anti telefono-descompuesto

Los subagentes **no** devuelven todo su trabajo por el chat. Escriben en disco y
te devuelven solo: que archivo escribieron y un veredicto de una linea. Tu lees
el archivo si necesitas el detalle. Asi el contexto no se satura y todo queda
versionado en git.
