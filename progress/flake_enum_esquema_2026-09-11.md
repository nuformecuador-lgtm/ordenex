# EL ROJO DEL GATE DE RELEASE — diagnosticado, no supuesto (2026-09-11, 02:0x)

## El sintoma
`tests/integration/db/notificacion-evento-avisos-agregados-migration.test.ts:416`
  esperado: 11 valores del enum
  recibido: 23 — **cada etiqueta DUPLICADA**, mas los dos valores nuevos

Un enum de Postgres NO PUEDE tener etiquetas repetidas. O sea que la consulta
estaba viendo DOS tipos, no uno.

## La causa, confirmada en el codigo
La consulta (linea 399):
    SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS valores
      FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'notificacion_evento'
Filtra por NOMBRE DE TIPO y **no fija el namespace**.

Y el harness (`tests/integration/db/_postgres-real.ts:61`) aisla cada archivo
**creando un esquema temporal**, aplicando alli el DDL y soltandolo con
`DROP SCHEMA … CASCADE`. Es buen dise~no — pero significa que puede haber
`notificacion_evento` en `public` Y en el esquema temporal de otro archivo a la vez.

`vitest.config.ts:38`: MAX_WORKERS = max(2, availableParallelism × 2/3), varios
procesos, todos contra la MISMA Postgres local. Y hay **12 archivos** de
`tests/integration/db/` que tocan `notificacion_evento`.

=> Cuando dos coinciden, el `string_agg` suma los dos tipos. Exactamente el patron
   observado: cada etiqueta dos veces, en orden de `enumsortorder`.

## Por que NO afecta a produccion
En produccion existe UN solo `notificacion_evento`, en `public`. El escenario es
imposible alli. Ademas el test verifica un `down.sql` —un guion de REVERSION que
este despliegue no ejecuta.

## Medido
  · aislado: 20/20 VERDE
  · en el gate completo: 1 failed | 1926 passed (1927)
  · el reviewer de la 410 corrio el gate completo sobre su rama: este archivo VERDE

## Lo que NO se hace
NO se mete en `tests/baseline-rojos.json`. Eso seria comprar el verde, y la casa
lo prohibe explicitamente: la 414 rechazo ese atajo con seis rojos ajenos.

## El arreglo correcto es una linea
Fijar el esquema en la consulta:
    JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE t.typname = 'notificacion_evento' AND n.nspname = 'public'
(o `t.typnamespace = 'public'::regnamespace`). Es lo mismo que ya hace la consulta
hermana de `pg_indexes`, que SI filtra `schemaname = 'public'` (linea 396).
⚠️ ESO ULTIMO ES LA PRUEBA DE QUE ES UN OLVIDO, no una decision: la consulta de al
lado, en el mismo bloque, si acota el esquema.
