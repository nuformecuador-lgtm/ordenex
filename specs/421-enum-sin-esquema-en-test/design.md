# 421 — diseño

## El censo, antes de decidir nada

Barrido de `tests/` con un tokenizador (no un `grep`: la prosa de este árbol nombra los catálogos
a propósito) buscando literales SQL que lean un catálogo de Postgres:

| | |
| --- | --- |
| consultas a catálogos en `tests/` | **162** |
| ya acotadas al esquema | **125** |
| **sin acotar** | **37**, en **21 archivos** |

O sea: el olvido **no está solo en el archivo que enrojeció**. Está en 21, y por eso es **una
ficha y no once**.

## La forma del arreglo

1. **La consulta del enum pasa a vivir en un solo sitio.** `tests/integration/db/_postgres-real.ts`
   —el harness que ya usan estos 147 archivos— gana `etiquetasDeEnum(cliente, tipo)`, que devuelve
   las etiquetas en `enumsortorder` **acotando `n.nspname = 'public'`** vía `pg_namespace`.
   El archivo que enrojeció (`notificacion-evento-avisos-agregados-migration.test.ts`, 3 consultas)
   la usa. Así el caso rojo de R1/R2 ejercita **la consulta real**, no una copia suya.
2. **El resto de las 37 se acota en sitio**, con el filtro que corresponde a cada catálogo:
   `n.nspname = 'public'` (`pg_type`, `pg_class` vía `pg_namespace`), `schemaname = 'public'`
   (`pg_indexes`, `pg_policies`), `table_schema = 'public'` (`information_schema.*`).
3. **Una guardia estática** (`tests/unit/db/catalogo-esquema-acotado.guardia.test.ts`) mantiene el
   cero de R3. Entra sola en el gate rápido: `test:guardias` selecciona por patrón `vitest run
   guard`, y `guardia` contiene `guard`.

## El caso que demuestra el defecto (R1+R2)

`tests/integration/db/catalogo-consulta-acota-esquema.test.ts`:

1. crea un esquema desechable `p421_<base36 del reloj>_<uuid>`;
2. clona ahí `notificacion_evento` **leyendo del real** (una lista escrita a mano caducaría con la
   siguiente ficha que añada un evento, y lo haría en silencio);
3. lee el enum con `etiquetasDeEnum` → **exactamente** las etiquetas de `public`, sin repetidas;
4. lee el enum con la consulta **vieja** (sin namespace) → **el doble**, cada etiqueta dos veces.
   Ése es el control de no-vacuidad: si el paso 2 no hubiera montado el escenario, este paso
   fallaría y el verde del paso 3 no valdría nada;
5. suelta el esquema en un `finally` + un `afterAll` que barre lo que ESTE proceso creó.

Barrido de huérfanos **por edad (> 1 h) y no por prefijo a secas**, copiado de
`push-cupo-carrera.test.ts:194`: dos worktrees comparten la base local y un barrido ciego se
llevaría por delante el esquema de una corrida viva.

## Alternativas descartadas

- **Meter el archivo en `tests/baseline-rojos.json`.** Comprar el verde. La casa lo prohíbe y la
  ficha 414 ya rechazó ese atajo.
- **Serializar `tests/integration/db/**` (un worker, o `describe.sequential`).** Escondería el
  defecto pagando reloj en cada corrida, y dejaría la consulta igual de mal para el día que dos
  esquemas coincidan por otra vía (una migración a medias, un `psql` abierto).
- **`SET search_path` al esquema correcto.** No sirve: los catálogos **no** se filtran por
  `search_path`; `pg_enum` lista los tipos de **toda** la base.
- **`::regtype` / `to_regclass`** en vez del `JOIN` a `pg_namespace`. Resuelve por `search_path`, así
  que devuelve *un* tipo — pero **cuál** depende de un estado global que el test no fija, y falla
  distinto según quién corra en paralelo. Se prefiere decir `public` en voz alta.
- **Un `grep` en vez de tokenizador para la guardia.** Medido en este mismo barrido: el `grep`
  crudo daba **88** «hallazgos», de los que más de la mitad eran **títulos de `it(...)` y
  comentarios**. Una guardia con ese ruido se desactiva sola a la semana.
- **Refactorizar las 37 a helpers compartidos.** Desproporcionado para una ficha de complejidad
  baja y con riesgo real de cambiar lo que esos tests miden (R7). El helper se introduce sólo donde
  paga: la consulta que enrojeció y que el caso rojo necesita ejercitar de verdad.

## Riesgos

- **`_postgres-real.ts` lo importan 147 archivos**: añadir un export es aditivo, pero hace que
  `--changed` seleccione mucho. Se corre el gate **completo**.
- La base local es compartida entre worktrees: el caso nuevo **no escribe en `public`**; sólo crea y
  suelta su propio esquema.
