# 421 — un test de migración consulta el enum sin fijar el esquema y enrojece por culpa de otro archivo

## Contexto medido (no supuesto)

El 2026-09-11, durante el gate de release, `tests/integration/db/notificacion-evento-avisos-agregados-migration.test.ts:416`
esperaba 11 etiquetas del enum `notificacion_evento` y recibió **23: cada etiqueta duplicada**.
Un enum de Postgres no admite etiquetas repetidas, así que la consulta estaba viendo **dos tipos**.

La consulta filtraba `WHERE t.typname = 'notificacion_evento'` **sin acotar el namespace**, y el
harness de `tests/integration/db/` aísla varios archivos **creando esquemas temporales** donde clona
ese mismo enum (`push-cupo-carrera.test.ts:207-222` lo hace explícitamente). Los catálogos de
Postgres (`pg_enum`, `pg_type`, `pg_class`, `pg_indexes`, `pg_constraint`, `pg_policies`,
`information_schema.*`) son **globales a la base**: no los filtra el `search_path`. Con
`MAX_WORKERS = max(2, availableParallelism × 2/3)` (`vitest.config.ts:38`), dos archivos coinciden
en el tiempo y el `string_agg` suma los dos tipos.

Que es un **olvido** y no una decisión lo demuestra la consulta de al lado, en el mismo bloque
(línea 396): ésa **sí** acota `schemaname = 'public'`.

Diagnóstico completo: `progress/flake_enum_esquema_2026-09-11.md`.

## Requisitos

### R1 — la consulta acota el esquema
**MIENTRAS** exista en la misma base otro esquema con un tipo, tabla, índice o restricción **del
mismo nombre** que uno de `public`, el sistema **DEBE** devolver, en toda consulta a los catálogos
de Postgres hecha desde `tests/`, **únicamente** los objetos de `public` — ni uno más.

*Verificable:* con un segundo esquema vivo que contiene su propio `notificacion_evento`, la lectura
real del enum devuelve exactamente las etiquetas de `public`.

### R2 — el defecto existe y el caso lo ve
**CUANDO** la misma lectura se hace **sin** acotar el esquema y hay un segundo tipo homónimo vivo,
el sistema **DEBE** devolver etiquetas duplicadas.

*Por qué es un requisito y no un adorno:* sin él, R1 pasaría también en una base donde el escenario
no se hubiera montado — un verde por vacío. Es el control de no-vacuidad del caso de R1.

### R3 — el barrido: ni una consulta a catálogos sin esquema en `tests/`
El sistema **DEBE** mantener en **cero** el número de consultas SQL de `tests/` que leen un catálogo
de Postgres (`pg_enum`, `pg_type`, `pg_class`, `pg_index`, `pg_indexes`, `pg_constraint`,
`pg_policies`, `pg_proc`, `pg_attribute`, `pg_trigger`, `pg_tables`, `pg_views`, `pg_matviews`,
`pg_sequences`, `information_schema.*`) **sin acotar el esquema**.

### R4 — la guardia sabe denunciar
**CUANDO** alguien escriba una consulta nueva a un catálogo sin acotar el esquema, la guardia de R3
**DEBE** ponerse roja **nombrando el archivo y la línea**.

*Verificable:* la guardia clasifica correctamente un par de muestras sintéticas —una acotada y una
sin acotar— sin depender del árbol real.

### R5 — la guardia lee código, no prosa
El escáner de R3 **DEBE** ignorar comentarios y texto de los `it(...)`: en este árbol los
comentarios **nombran a propósito** lo que el código tiene prohibido, y una guardia que escanea
prosa afirma algo falso con la misma cara de verde.

### R6 — se limpia lo que se ensucia, también en el camino malo
**SI** un caso crea un esquema temporal, **ENTONCES** el sistema **DEBE** soltarlo (`DROP SCHEMA …
CASCADE`) **aunque el caso falle o lance**, y **DEBE** dejar la base local compartida como estaba.

### R7 — no se toca el veredicto de lo que ya medía
El arreglo **DEBE** dejar intactas las aserciones de los archivos tocados: siguen midiendo los
mismos valores, los mismos índices y las mismas restricciones que antes.

## Fuera de alcance
- `init.sh` (lo toca la ficha 420 en paralelo).
- `tests/baseline-rojos.json`: meter ahí este archivo habría sido comprar el verde.
- Código de producción: el defecto vive sólo en consultas de test.
