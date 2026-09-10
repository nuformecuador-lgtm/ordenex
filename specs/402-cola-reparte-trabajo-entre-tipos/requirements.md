# Feature 402 — La cola reparte el trabajo entre tipos (requirements)

> **Incidente que origina esta ficha (medido en producción, 2026-09-09, 15:33 UTC).**
> `JobRepository.claimBatch` reclama con `ORDER BY "run_after" ASC LIMIT ${limit}`, sin
> ninguna noción de `tipo`. Con `JOBS_BATCH_SIZE = 10` (default, `lib/config/jobs.ts`) y 82
> `webhook_estado` vencidos (el más antiguo desde las 15:22) delante de 14
> `whatsapp_bienvenida`, 6 `geocodificacion` (vencidos desde las 15:30) y 2
> `optimizacion_ruta`, los tres tipos minoritarios **no llegaron a reclamarse nunca**
> mientras el tipo saturado siguió delante por antigüedad. Consecuencia real: la
> geocodificación estuvo media hora sin correr con la credencial de Google ya arreglada,
> bloqueando 42 órdenes. Hubo que adelantar `run_after` a mano para forzar el drenado.

> **Alcance (solo esto):** cambiar la REGLA DE SELECCIÓN de `JobRepository.claimBatch` para
> que un tipo saturado no pueda dejar a los demás sin turno en la misma corrida, dentro de
> la MISMA sentencia atómica que ya existe. Más una señal de diagnóstico barata (log del
> reparto por tipo) para que la falta de avance de un tipo sea observable sin una sonda
> manual.
>
> **Fuera de alcance:**
> - **Feature 401** (alerta y reencolado del geocodificador muerto) — no se toca aquí.
> - **Feature 403** (una suscripción de webhook que falla siempre no se desactiva ni
>   avisa) — esa ficha REDUCE la probabilidad de que `webhook_estado` (u otro tipo) se
>   sature. Esta ficha hace que, si CUALQUIER tipo se satura de todos modos (webhooks u
>   otra causa futura), la saturación **no pueda** dejar a los demás sin turno. Ninguna
>   sustituye a la otra.
> - Prioridades configurables por tipo (por usuario o por config): una regla FIJA
>   (round-robin por turnos, ver design.md) resuelve el caso medido sin superficie nueva
>   que mantener.
> - Cambiar `JOBS_BATCH_SIZE`, la tecnología de la cola, o añadir un broker/worker
>   persistente.
> - Rediseñar `claimBatch` más allá de su regla de selección: la atomicidad, el `SKIP
>   LOCKED`, el rescate por visibility timeout, el incremento de `intentos` y el reloj
>   inyectado (`now`/`visibilityCutoff`) de la feature 90 se CONSERVAN tal cual (ver
>   design.md, sección "Garantías conservadas").

Notación EARS. Cada `R<n>` es testeable y trae su mapeo a test propuesto (el implementer lo
concreta en `progress/impl_402.md`).

---

## Reparto del lote entre tipos

- **R1 (Ubicuo).** Al formar el lote de una corrida, el sistema DEBE repartir los candidatos
  (pendientes vencidos o `processing` colgados) entre los tipos presentes mediante un
  reparto por turnos: dentro de cada tipo, sus candidatos se numeran por turno según
  `run_after` ascendente (el más antiguo = turno 1); el lote se compone tomando primero el
  turno 1 de cada tipo presente, luego el turno 2, y así sucesivamente, hasta completar
  `limit` o agotar los candidatos. El total reclamado en una corrida NUNCA supera `limit`.
  *Test:* integración DB (Postgres real) — sembrar candidatos de varios tipos en cantidades
  desiguales; `claimBatch(limit, opts)` devuelve exactamente la composición por tipo que
  predice el reparto por turnos.

- **R2 (Condicional).** SI en una corrida solo hay candidatos de UN tipo, ENTONCES el sistema
  DEBE reclamar hasta `limit` candidatos de ese tipo (el reparto por turnos no reduce el
  tamaño del lote cuando solo hay un tipo activo; caso "un solo tipo satura la cola de forma
  legítima").
  *Test:* integración DB — sembrar más de `limit` candidatos vencidos de un único tipo;
  `claimBatch(limit, opts)` devuelve `limit` filas, todas de ese tipo.

- **R3 (Condicional / hambre inversa).** SI los demás tipos presentes en una corrida tienen
  menos candidatos que los turnos que les tocarían, ENTONCES los turnos sobrantes DEBEN
  asignarse, en la MISMA corrida, al tipo o tipos con más candidatos, hasta completar `limit`
  o agotar todos los candidatos (un pico legítimo del tipo mayoritario no queda artificialmente
  capado por la existencia de tipos minoritarios).
  *Test:* integración DB — sembrar un tipo con muchos más candidatos vencidos que los demás
  tipos presentes (proporciones inspiradas en el incidente medido); confirmar que TODOS los
  tipos presentes aparecen en el lote reclamado y que el cupo no usado por los tipos
  minoritarios lo ocupa el tipo mayoritario, sin dejar cupo sin usar habiendo candidatos.

- **R4 (Ubicuo).** Dentro de un mismo tipo, el orden de reclamo entre sus propios candidatos
  DEBE seguir siendo `run_after` ascendente (el más antiguo de ese tipo primero), igual que
  antes del reparto entre tipos.
  *Test:* integración DB — sembrar 3 candidatos del mismo tipo con `run_after` distintos y un
  `limit` que no alcance para los tres; confirmar que los reclamados de ese tipo son los de
  `run_after` más antiguo.

- **R5 (De estado / no regresión — exclusión mutua con tipos mixtos).** MIENTRAS dos llamadas
  a `claimBatch` se ejecuten concurrentemente sobre un conjunto de candidatos de MÚLTIPLES
  tipos, el sistema DEBE seguir garantizando que ninguna fila sea entregada a más de una
  llamada (invariante `FOR UPDATE SKIP LOCKED` de la feature 90 / R11, reverificado con tipos
  mixtos).
  *Test:* integración DB (Postgres real) — sembrar candidatos de 3 tipos, lanzar 2
  `claimBatch` concurrentes, verificar que la unión de ids reclamados es disjunta.

- **R6 (Condicional / no regresión — visibility timeout con tipos mixtos).** SI un candidato
  rescatado por visibility timeout (`processing` con `locked_at` vencido) pertenece a un tipo
  distinto al de los `pending` vencidos de la misma corrida, ENTONCES DEBE competir por su
  turno en pie de igualdad con los demás tipos (mismo criterio de turno de R1), sin trato
  especial por venir de un rescate.
  *Test:* integración DB — sembrar un `processing` colgado de tipo A y varios `pending`
  vencidos de tipo B con cupo limitado; confirmar que el rescatado de A ocupa su turno igual
  que si fuera un `pending` vencido de A.

- **R7 (Ubicuo / coste).** El reparto por tipo DEBE resolverse dentro de la MISMA sentencia
  SQL atómica que hoy ejecuta el claim, sin agregar una segunda consulta ni una segunda
  transacción por corrida.
  *Test:* integración DB con espía de consultas (patrón `crearPrismaDeTestConEspia`, ya usado
  en `tests/integration/db/_postgres-real.ts`) — una llamada a `claimBatch` emite EXACTAMENTE
  una sentencia.

- **R8 (Ubicuo / diagnóstico).** CUANDO el drenador reclama al menos un job en una corrida, el
  sistema DEBE registrar (log agregado, sin `payload` ni PII) el conteo de jobs reclamados
  agrupado por tipo en esa corrida, de modo que la falta de avance de un tipo sea observable
  en los logs sin requerir una consulta manual a la tabla `jobs`.
  *Test:* unit service (`tests/unit/services/job-queue-service.test.ts`) — con jobs reclamados
  de 2 tipos distintos, el logger recibe el desglose `{tipo: cantidad}` esperado; con lote
  vacío no se registra nada.

- **R9 (Ubicuo / genericidad).** El reparto por turnos DEBE operar de forma genérica sobre la
  columna `tipo` de los candidatos, sin enumerar tipos concretos en la lógica de reparto, de
  modo que un tipo agregado al enum `job_tipo` en el futuro (como ya pasó con 91, 92, 99, 109,
  124 y 128) quede cubierto automáticamente, sin tocar `JobRepository` de nuevo.
  *Test:* integración DB — sembrar candidatos usando un `JobTipo` de los añadidos DESPUÉS de
  la feature 90 (p. ej. `analitica_invalidacion_cache`) junto a otro tipo; confirmar que
  participa del reparto por turnos igual que los demás.

---

## Trazabilidad (resumen)

| Requisito | Tipo de test |
|-----------|--------------|
| R1 | integración DB (Postgres real) — reparto por turnos |
| R2 | integración DB — un solo tipo activo usa el lote entero |
| R3 | integración DB — hambre inversa / pico legítimo del tipo mayoritario |
| R4 | integración DB — orden intra-tipo por antigüedad |
| R5 | integración DB (Postgres real) — concurrencia con tipos mixtos |
| R6 | integración DB — visibility timeout con tipos mixtos |
| R7 | integración DB con espía de consultas — una sola sentencia |
| R8 | unit service — log del desglose por tipo |
| R9 | integración DB — genericidad ante un tipo nuevo del enum |

---

## Preguntas abiertas

1. **Tipos distintos con candidatos > `JOBS_BATCH_SIZE`.** Hoy hay 9 valores en el enum
   `job_tipo` contra un `JOBS_BATCH_SIZE` default de 10 (margen de solo 1). Si algún día 10 o
   más tipos tienen candidatos simultáneamente, el reparto por turnos deja a 1+ tipos sin
   turno en ESA corrida puntual (aunque el desempate por `run_after` ascendente los prioriza
   en la corrida siguiente, porque su espera se vuelve más vieja que la de los tipos recién
   llegados — ver design.md). Esta ficha NO sube `JOBS_BATCH_SIZE` (fuera del arreglo mínimo).
   ¿Se acepta ese respaldo por antigüedad como suficiente, o hace falta una garantía dura?
2. **Alcance del diagnóstico de R8.** El log solo puede reportar los tipos que SÍ fueron
   reclamados en la corrida; no puede reportar "tipo con candidatos pero cero reclamados esa
   corrida" sin que el repositorio calcule ese dato aparte (lo que exigiría una consulta
   adicional y rompería R7). ¿Se acepta esta limitación, o una ficha futura debe extender
   `IJobRepository` para exponer ese conteo?
3. **Canal del diagnóstico.** Se propone reutilizar el `JobsLogger` ya existente en
   `JobQueueService` (ver design.md) en vez de abrir un canal de métricas nuevo. Si el humano
   prefiere otra vía (p. ej. un campo en `DrenarResult`), indicarlo — design.md explica por
   qué se descartó tocar ese contrato ya fijado.
