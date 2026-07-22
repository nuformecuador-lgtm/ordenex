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

1. **Máximo 2 features `in_progress` por zona.** Cada `zone` (`frontend`, `backend`,
   `fullstack`) admite hasta **2** features en `in_progress` a la vez en
   `feature_list.json`, siempre sin conflicto de archivos entre ellas (ver
   `AGENTS.md > Paralelismo`). Distintas zonas corren en paralelo sin restricción
   entre sí. `./init.sh` lo valida.
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
2. Lee `progress/current.md` para ver si hay una sesión a medias.
3. Lee `feature_list.json` y toma la primera feature en `pending` (o retoma la
   que esté en `spec_ready` / `in_progress`).
4. Sigue el flujo de `AGENTS.md`.

## Mapa rápido

- Cómo delegar y en qué orden → `AGENTS.md`
- Qué significa "buen trabajo" → `docs/architecture.md`
- Estilo, nombres, manejo de errores → `docs/conventions.md`
- Proceso SDD (EARS, 3 archivos, aprobación) → `docs/specs.md`
- Cómo demostrar que funciona → `docs/verification.md`
- Criterios de estado final correcto → `CHECKPOINTS.md`
