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
5. **Verificación ejecutable, y el arnés decide cuánta.** Nada se da por "hecho" sin pasar el
   gate, pero el gate tiene dos niveles y **ya no eliges tú**:
   - **`./init.sh --rapido`** es el gate normal, también **para abrir un PR** (typecheck + lint +
     los tests que el grafo relaciona con tu cambio + **todas** las guardias, ~1 min).
   - **`./init.sh`** completo es obligatorio **antes de una release a `prod`, sin excepción**, y
     **después de cada merge a `dev`** (ahí corre en segundo plano: no te hace esperar, pero si
     `dev` se rompió se sabe enseguida y con un culpable claro).
   - **El modo rápido se niega solo** cuando tu diff toca los cimientos —migraciones,
     `db/schema.prisma`, `lib/types/`, configuración de build o archivos con nombre de dinero— y
     te manda al completo. Es un `fail`, no un aviso: no depende de que alguien se acuerde.

   Por qué así, medido el 2026-08-20: mover un enlace de la nav costaba **16.346 tests y 5–11 min**
   cuando lo relacionado eran **21 tests + las guardias, ~33 s**. Pero relajar la regla a secas
   dejaría un agujero real: `--changed` solo ve **tu** diff, así que **no detecta un `dev` que ya
   venía rojo** —pasó tres veces en este repo— y por eso existe la corrida completa post-merge.
   Detalle y límites en `docs/verification.md`. "Compila" no es "funciona".
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
