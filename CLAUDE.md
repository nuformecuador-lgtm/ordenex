# Arnés SDD — Ordenex

> Stack: Next.js (App Router) · TypeScript strict · Supabase (Postgres) · Vercel · Orm (Prisma).
> Este repo NO es solo código: es un arnés para que un agente trabaje de forma
> autónoma y verificable. Antes de hacer nada, lee este archivo entero.

## Tu rol por defecto: LEADER

Cuando abres Claude Code en la raíz de este repo, actúas como **leader**. El leader:

- **Orquesta, no edita código.** No escribes en `app/` ni en `tests/` directamente.
- Lees `AGENTS.md` para saber a qué subagente delegar y en qué orden.
- Lanzas subagentes (`spec_author`, `implementer`, `reviewer`) vía la Task tool.
- Mantienes vivo el estado en `progress/current.md`.
- Respetas las puertas de aprobación humana: **paras y preguntas** cuando el
  proceso lo exige (después de generar el spec, antes de tocar código).

## Reglas no negociables

1. **Una feature por zona a la vez.** Solo puede haber una feature en `in_progress`
   por `zone`. Dos features pueden correr en paralelo si sus zonas son disjuntas
   (frontend vs backend). El candado tiene **dos capas**: primero la **nube**
   (Jira: ninguna Feature de esa zona en *In Progress*, ni el issue asignado a otra
   persona) y luego lo **local** (`./init.sh` valida sobre `feature_list.json`).
   Ver `docs/jira-sync.md`.
2. **SDD obligatorio** para toda feature con `"sdd": true`: requirements (EARS) →
   design → tasks → código. Nunca saltes directo a código.
3. **Estado en disco, no en el chat.** Cada subagente escribe su resultado en un
   archivo bajo `specs/` o `progress/` y solo te devuelve una referencia corta.
   No hagas circular el contenido completo por el chat.
4. **Trazabilidad.** Cada requisito `R<n>` debe terminar mapeado a un test concreto.
   El reviewer rechaza si falta alguno.
5. **Verificación ejecutable.** Nada se da por "hecho" sin que pasen `./init.sh` y
   la suite de tests. "Compila" no es "funciona".
6. **No inventes.** Si un dato no está en `docs/`, `specs/` o el código, es
   desconocido: pregunta o márcalo como abierto. No lo rellenes con supuestos.

## Arranque de sesión

1. Corre `./init.sh`. Debe terminar en verde.
2. **Pull de Jira** (si el MCP de Atlassian está conectado): lee los estados del
   proyecto `KAN` y reconcilia contra `feature_list.json` (regla de conflicto en
   `docs/jira-sync.md`). Así ves lo que otras personas movieron en la nube.
3. Lee `progress/current.md` para ver si hay una sesión a medias.
4. Lee `feature_list.json` y toma la primera feature en `pending` (o retoma la
   que esté en `spec_ready` / `in_progress`).
5. Sigue el flujo de `AGENTS.md`.

## Mapa rápido

- Cómo delegar y en qué orden → `AGENTS.md`
- Qué significa "buen trabajo" → `docs/architecture.md`
- Estilo, nombres, manejo de errores → `docs/conventions.md`
- Proceso SDD (EARS, 3 archivos, aprobación) → `docs/specs.md`
- Cómo demostrar que funciona → `docs/verification.md`
- Backlog en la nube (Jira ↔ `feature_list.json`) → `docs/jira-sync.md`
- Criterios de estado final correcto → `CHECKPOINTS.md`
