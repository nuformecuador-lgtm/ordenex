# Integración con Jira — backlog en la nube

> El backlog del arnés vive **también** en Jira (proyecto **Ordenex**, key `KAN`,
> site `singularis-su.atlassian.net`) para que varias personas + sus agentes tomen
> features sin pisarse. `feature_list.json` y Jira se sincronizan **bidireccionalmente**.
> Este doc es la fuente de verdad de CÓMO se mapean y sincronizan.

## Por qué

`feature_list.json` + `progress/current.md` solo se comparten por git: dos personas
en máquinas distintas no se ven en tiempo real y pueden agarrar la misma feature o
dos features que chocan de zona. Jira da un tablero compartido y en vivo. El candado
anti-colisión pasa a tener **dos capas**: primero la nube (Jira), luego lo local
(`init.sh`).

## Anclaje: `id` del arnés ↔ issue de Jira

Cada feature del `feature_list.json` corresponde a **una** issue tipo `Feature` en `KAN`.
El anclaje es doble y redundante para que el sync sea robusto en ambos sentidos:

| Lado | Cómo se guarda el vínculo |
| --- | --- |
| `feature_list.json` | campo `"jira": "KAN-<n>"` en cada feature |
| Jira (issue) | label `fid-<id>` + línea `id arnés: **<id>**` en la descripción |

Por la carga inicial (features 1–50 creadas en orden) hoy vale `KAN-<id> == feature <id>`,
pero **NO dependas de esa igualdad**: el vínculo canónico es el campo `jira` / el label
`fid-<id>`. Las features nuevas tomarán la siguiente key libre de Jira, que ya no coincidirá.

## Mapa de campos

| `feature_list.json` | Jira |
| --- | --- |
| `name` | summary, prefijado: `[F<id>] <name>` |
| `description` | description (+ bloque "Metadata del arnés SDD" al final) |
| `status` | estado del workflow (ver tabla abajo) |
| `zone` | label `zone-<zone>` (`zone-frontend`/`zone-backend`/`zone-fullstack`) |
| `complexity` | label `cx-<complexity>` (`cx-low`/`cx-medium`/`cx-high`) |
| `branch` | línea en el bloque de metadata de la descripción |
| `sdd: true` | label `sdd` |
| `depends_on: <M>` | issue link **Blocks**: `KAN-<M>` *blocks* `KAN-<id>` (o sea `<id> is blocked by <M>`) |
| (todas) | label `arnes` (marca de "gestionado por el arnés") |

### Estados

| `status` (arnés) | Estado Jira | transición id |
| --- | --- | --- |
| `pending` | To Do | 11 |
| `spec_ready` | To Do (se mantiene) — el detalle "spec listo" vive en `progress/` | — |
| `in_progress` | In Progress | 21 |
| `done` | Done | 41 |

- **In Review** (transición 31) existe en Jira y queda para uso **manual humano**
  (p.ej. PR abierto / en revisión). El arnés no lo escribe automáticamente porque
  `feature_list.json` no tiene ese estado; al hacer pull, un issue en In Review se
  trata como `in_progress`.

## Candado anti-colisión (dos capas)

Antes de arrancar una feature (paso **F1.0** de `AGENTS.md`), en este orden:

1. **Capa nube (Jira) — primero.** El leader consulta Jira:
   ```
   JQL: project = KAN AND labels = "zone-<zona-objetivo>" AND statusCategory = "In Progress"
   ```
   - Si devuelve alguna issue → la zona está **ocupada en la nube**: no arranca, evalúa la siguiente feature (misma regla de zona que ya existe local).
   - Si la issue objetivo ya tiene `assignee` distinto de vos → otra persona la tomó: no arranca.
   - Si libre: el leader **se asigna** el issue objetivo (`assignee = usuario actual`) y lo transiciona a **In Progress**. El assignee es el dueño del candado en la nube.
2. **Capa local (`init.sh`) — después.** `init.sh` valida un-`in_progress`-por-zona
   sobre `feature_list.json`. Es la red de seguridad offline y la que corre en cada arranque.

Soltar el candado: al pasar la feature a `done` (o al abandonarla), el leader
la transiciona en Jira y quita/mantiene el assignee según corresponda.

## Sincronización bidireccional

El sync lo ejecuta **el agente dentro de una sesión con el MCP de Atlassian conectado**
(la auth del MCP es interactiva; ver "Automatización futura"). Dos direcciones:

- **Push (`feature_list.json` → Jira).** Cuando el leader cambia `status`/`zone`/
  `complexity`/`depends_on`/`branch` en `feature_list.json`, refleja el cambio en la
  issue anclada (transición + labels + links + metadata de la descripción).
- **Pull (Jira → `feature_list.json`).** Al **arranque de sesión**, el leader lee los
  estados en Jira (`project = KAN`) y reconcilia contra `feature_list.json`: si un
  humano movió una tarjeta en Jira, actualiza el `status` local.

### Regla de conflicto

Si el mismo campo difiere entre los dos lados:

- **`status`:** gana **Jira** (es el tablero vivo compartido; un humano pudo moverlo).
- **Estructura del backlog** (`depends_on`, `zone`, `complexity`, alta/baja de features,
  reescritura de `description`): gana **`feature_list.json`** — el humano lo cura a mano
  (regla de `CLAUDE.md`). El push reemplaza lo que haya en Jira.
- Ante ambigüedad real, **para y pregunta** (regla no negociable #6 de `CLAUDE.md`);
  registra el choque en `progress/current.md > Conflictos pendientes`.

## Cómo operar el sync (procedimiento del agente)

Con el MCP conectado, tools relevantes:

- Pull / consulta: `searchJiraIssuesUsingJql` (`project = KAN ...`).
- Push estado: `transitionJiraIssue` (ids 11/21/41).
- Push labels/summary/description: `editJiraIssue`.
- Push dependencias: `createIssueLink` (type `Blocks`).
- Alta de feature nueva: `createJiraIssue` (issueType `Feature`) + escribir `jira` en `feature_list.json`.

`cloudId` del site: `3b165d31-3757-40cf-bcf1-724a1fde0452`.

## Automatización desatendida (cron/CI)

El MCP usa OAuth **interactivo**, así que un cron/CI no puede usarlo. Para el sync
desatendido está `scripts/jira-sync.mjs` (node, sin dependencias) que habla directo
con la **REST API de Jira v3** usando un **API token**. Modos:

| Comando | Qué hace |
| --- | --- |
| `pnpm jira:check` | **READ-ONLY.** Reporta drift (estado, features sin issue, issues sin `fid`). Exit 1 si hay drift. |
| `pnpm jira:push -- --apply` | JSON → Jira: transiciona el estado de cada issue al del `feature_list.json`. Sin `--apply` es dry-run. |
| `pnpm jira:pull -- --apply` | Jira → JSON: actualiza el `status` local según Jira (Jira gana). Sin `--apply` es dry-run. |

Config por entorno (ver `.env.jira.example`): `JIRA_SITE`, `JIRA_EMAIL`,
`JIRA_API_TOKEN` (crealo en https://id.atlassian.com/manage-profile/security/api-tokens),
`JIRA_PROJECT` (default `KAN`).

**CI:** el workflow `.github/workflows/jira-sync.yml` corre `check` cada hora (falla y
queda visible si hay drift) y permite `push` manual por `workflow_dispatch`. Requiere los
secrets `JIRA_SITE`, `JIRA_EMAIL`, `JIRA_API_TOKEN` en el repo. `pull --apply` NO corre en
CI (escribe un archivo curado a mano): hacelo local o vía el agente y revisá el diff.

> Nota: `scripts/jira-sync.mjs` está construido pero **aún no se probó contra la API en
> vivo** (falta el token). El modo por defecto es el read-only `check`; `push`/`pull`
> requieren `--apply` explícito. Corré primero `pnpm jira:check` para validar.

## Onboarding de un colaborador nuevo

Para que otra persona trabaje features desde la nube sin pisar a nadie:

1. Clona el repo (el `.mcp.json` ya viene versionado → Claude Code detecta el server de Atlassian).
2. Conecta **su propia** cuenta Atlassian al MCP (auth OAuth interactiva la primera vez).
   El candado por `assignee`/estado funciona con cualquier identidad; cada quien se asigna
   lo que toma.
3. Para el sync desatendido/local, crea su API token y llena `.env` desde `.env.jira.example`.
4. Al arrancar, sigue "Arranque de sesión" de `CLAUDE.md` (incluye el pull de Jira).

## Validación local sin jq

La capa LOCAL del candado (una feature por zona en `in_progress` + ancla `jira`) corre
vía `scripts/check-zone-lock.mjs` (node, sin depender de `jq`), invocado por `init.sh`
y disponible como `pnpm check:zones`.
