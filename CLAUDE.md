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
5. **Verificación ejecutable: corre lo que tocas, no todo.** Nada se da por "hecho" sin pasar el
   gate, y el gate decide cuánto se corre (reglas del humano, 2026-10-05):
   - **`./init.sh --rapido`** es el gate de TODO el trabajo, también para abrir un PR y después de
     mergear: typecheck + lint + los tests que el grafo relaciona con tu diff + las guardias.
   - Si el diff toca **dinero o datos** (nombres de dinero, migraciones, `db/schema.prisma`,
     `lib/types/`), el mismo `--rapido` se **amplía solo** con toda `tests/integration/db` (contra
     Postgres). No hace falta el completo.
   - **`./init.sh` completo: SOLO antes de una release a `prod`**, sin excepción. También lo exige
     `--rapido` si tocas el propio gate, `tests/fixtures/sin-comentarios.ts` o la config de
     build/tests (su radio es todo el repo).
   - **Ningún subagente corre el completo, y el leader no se lo pide.** Un rojo se repite AISLADO
     (solo ese archivo); si pasa, se anota como intermitente y no se vuelve a correr todo.

   Por qué: en la 473 (5 archivos) se corrió el completo tres veces, ~67 min, cuando lo relacionado
   eran ~280 tests; y cada completo arrastra los flakes de la base compartida. Precio aceptado: un
   `dev` que ya venía rojo (`--changed` no lo ve) se descubre en el completo de la release, no antes.
   Detalle en `docs/verification.md`. "Compila" no es "funciona".
6. **No inventes.** Si un dato no está en `docs/`, `specs/` o el código, es
   desconocido: pregunta o márcalo como abierto. No lo rellenes con supuestos.
7. **Buscar código empieza por el grafo, no por `grep`.** El repo está indexado en el MCP
   `codebase-memory` bajo el nombre **`R-job-singularis-projects-ordenex`** —no `ordenex`, que
   responde *project not found*, y `R-ark-studio-projects-ricardo-ordenex` es OTRO repo—. Toda
   pregunta del tipo «dónde está X», «quién llama a Y», «qué hace Z» se resuelve con
   `search_graph`, `trace_path`, `get_code_snippet`, `query_graph`, `get_architecture` o
   `search_code`. `grep`/`glob` quedan para texto plano, configs, `db/schema.prisma`, `specs/`,
   `progress/` y para leer un archivo entero antes de editarlo.
   **El índice caduca, y su forma de mentir es devolver de más:** el 2026-08-28 dio por vivos
   `actualizarOrden` y `OrdenService.actualizar`, borrados el 2026-08-07 —donde hoy solo queda el
   comentario del borrado—. Por eso, antes de concluir «esto ya existe» a partir del grafo,
   **confirma el símbolo en el archivo real**; y si el árbol se ha movido, `detect_changes` y
   reindexa. El grafo te dice DÓNDE mirar; el archivo dice QUÉ hay.

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
- Qué se comprueba al desplegar a `prod` → `docs/release.md`
- Criterios de estado final correcto → `CHECKPOINTS.md`
