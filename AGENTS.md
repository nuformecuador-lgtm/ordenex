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

## Modelos

**Ningun subagente fija modelo: todos HEREDAN el de la sesion.** El frontmatter de
`.claude/agents/*.md` no lleva `model:`, y el leader no pasa override al delegar salvo razon
concreta para esa llamada.

Antes habia una tabla que asignaba `opus-4.8` a los seis agentes por igual — la misma columna
repetida tres veces, o sea que no discriminaba nada por `complexity`. El 2026-07-31 ese id dejo de
estar disponible y **el `backend_dev` de la feature 167 murio al arrancar** sin escribir una linea;
`spec_author` y `reviewer` siguieron funcionando porque no fijaban modelo. Un id escrito a mano
envejece y rompe el arnes entero en silencio; la herencia no. Si algun dia hace falta discriminar por
`complexity`, se hace en la llamada concreta, no en el frontmatter.

## Paralelismo

Se permite un maximo de **2 features concurrentes por zona** (`frontend`, `backend`,
`fullstack`), siempre que no haya conflicto de archivos con las que ya estan `in_progress`.

| Feature A | Feature B | Paralelo? |
| --- | --- | --- |
| `frontend` | `backend` | Si |
| `frontend` | `frontend` | Si (max 2, validando sin conflicto de archivos) |
| `backend` | `backend` | Si (max 2, validando sin conflicto de archivos) |

### Validacion de conflicto entre features de la misma zona

Antes de lanzar una feature de zona `Z` cuando ya hay `N` features `in_progress`
en esa zona (`N < 2`), el leader debe:

1. Listar los archivos que las features `in_progress` de zona `Z` estan tocando,
   consultando `progress/impl_<feature>.md` de cada una.
2. Revisar en `specs/<nueva-feature>/tasks.md` los archivos esperados.
3. Si hay **interseccion de archivos** entre la nueva feature y las `in_progress`,
   esa feature se **bloquea** hasta que alguna de las que tocan esos archivos pase
   a `done`.
4. Si no hay interseccion (o la nueva es la primera de su zona), se permite el
   paralelismo.
5. Si ya hay 2 features `in_progress` en zona `Z`, se espera a que una pase a
   `done` antes de evaluar la siguiente.

Feature con `depends_on` no arranca hasta que su dependencia este `done`.

## Flujo de una feature (dos fases)

### Fase 1 — Especificacion

1. (F1.0) **Evaluacion, seleccion y branch.** El leader:
   - Escanea TODAS las features `pending` en orden de `id`.
   - Para cada una con `zone`/`complexity`/`branch` en `null`, evalua usando los
     criterios de arriba y actualiza `feature_list.json` con los valores asignados.
   - Documenta cada evaluacion en `progress/current.md > Evaluaciones`.
   - Agrupa las features `in_progress` por `zone` y cuenta cuantas hay en cada una.
   - Recorre las `pending` (ya evaluadas) en orden de `id` y selecciona la
     **primera** que cumpla **ambas** condiciones:
     a. Su zona tiene **menos de 2** features `in_progress`.
     b. Pasa la **validacion de conflicto** de archivos (ver `## Paralelismo`):
        ningun archivo de `specs/<feature>/tasks.md` intersecta con los archivos
        que estan tocando las features `in_progress` de la misma zona.
   - Si la zona ya tiene 2 features `in_progress`, o hay conflicto de archivos,
     saltea la feature y evalua la siguiente.
   - Si ninguna feature `pending` pasa el filtro, espera a que una feature
     `in_progress` pase a `done` y vuelve a este paso.
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

## Regla del gate: quien corre que (2026-08-03)

**Ningun subagente corre la suite completa.** Ni `frontend_dev`, ni `backend_dev`, ni el
`reviewer`. El reparto es:

| Quien | Que corre |
| --- | --- |
| `frontend_dev` / `backend_dev` | `pnpm typecheck`, `pnpm lint`, y **solo** sus archivos nuevos + los que su cambio pueda romper (`pnpm exec vitest related --run <archivos>`) |
| `reviewer` | lo que necesite para verificar sus hallazgos, incluida la suite si sospecha una regresion |
| **leader** | `./init.sh --rapido` al cerrar cada tanda · `./init.sh` **completo** al cerrar la feature y antes del PR |

**Por que, y no es teorico.** En la sesion del 2026-08-02 (feature 172) **cinco subagentes
murieron por cortes de stream de la API**, y los cinco cayeron en la fase de verificacion larga:
una corrida de ~4 minutos sin emitir nada es tiempo suficiente para que el stream se rompa.
Reanudarlos cuesta replicar 250k+ tokens de contexto y a veces vuelve a caer en el mismo punto.
En cuanto se les dijo *«corre solo tus archivos, el gate lo corro yo»*, dejaron de caerse.

Ademas el subagente **no tiene el contexto para juzgar un rojo ajeno**: no sabe si un fallo en
`CuentasPorPagarTable` es el flake conocido de jsdom de esta maquina o una regresion suya. El
leader si. Un rojo mal diagnosticado por un subagente cuesta mas que la corrida que se ahorro.

## Regla anti telefono-descompuesto

Los subagentes **no** devuelven todo su trabajo por el chat. Escriben en disco y
te devuelven solo: que archivo escribieron y un veredicto de una linea. Tu lees
el archivo si necesitas el detalle. Asi el contexto no se satura y todo queda
versionado en git.
