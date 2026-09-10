# impl_402 — La cola reparte el trabajo entre tipos

Rama `feat/402-cola-reparte-entre-tipos`. Spec: `specs/402-cola-reparte-trabajo-entre-tipos/`.

## Lo que cambió, en una frase

`JobRepository.claimBatch` ya no ordena por antigüedad GLOBAL: numera cada candidato dentro de
su tipo (`ROW_NUMBER() OVER (PARTITION BY tipo ORDER BY run_after)`) y compone el lote por
turnos — el turno 1 de todos los tipos presentes antes que el turno 2 de ninguno. **Sin
migración, sin cambio de esquema, sin cambio de firma ni de contrato.**

## Archivos

| Archivo | Qué |
| --- | --- |
| `lib/repositories/JobRepository.ts` | **modificado** — la sentencia del claim pasa de una CTE a tres (`candidatos` / `priorizados` / `bloqueados`) |
| `lib/services/JobQueueService.ts` | **modificado** — `JobsLogger.info?` (opcional) y el desglose por tipo de cada corrida (R8) |
| `tests/integration/db/job-repository-reparto-por-tipo.int.test.ts` | **nuevo** — R1, R2, R3, R4, R6, R7, R9 contra Postgres real |
| `tests/integration/db/job-repository-claim-concurrente.int.test.ts` | **nuevo** — R5, dos conexiones de verdad |
| `tests/unit/services/job-queue-service.test.ts` | **modificado** — `describe` nuevo para R8 |
| `specs/402-cola-reparte-trabajo-entre-tipos/**` | copiado del árbol principal, para que la rama se sostenga sola |

Ninguno de los ~10 archivos que instancian `JobQueueService` con un doble `{ warn: () => {} }`
se tocó: `info` es OPCIONAL y se invoca con `?.`, así que siguen compilando y corriendo. Hay un
test que lo comprueba, no es una suposición.

## Mapa `R<n>` → test

Los ocho primeros corren contra **Postgres real**; es deliberado, y el motivo está medido en
este repo: toda la lógica del reparto vive en el SQL, y un doble de `claimBatch` devuelve lo
que se le diga — pasaría en verde con el `ORDER BY` roto.

| R | Test (archivo › `it`) |
| --- | --- |
| **R1** | `tests/integration/db/job-repository-reparto-por-tipo.int.test.ts` › `⭑ R1/R3: los CUATRO tipos entran en la PRIMERA corrida — 4/3/2/1, no 8+2+0+0` (y `R1: el claim CONSERVA sus efectos — processing, locked_at = now e intentos + 1`) |
| **R2** | ídem › `14 candidatos de un unico tipo y limit = 10 -> 10 filas, todas de ese tipo` |
| **R3** | ídem › `⭑ R1/R3: los CUATRO tipos entran en la PRIMERA corrida — 4/3/2/1, no 8+2+0+0` (webhook se lleva 4 de 10: ocupa el cupo que geo y ruta no pueden llenar) |
| **R4** | ídem › `limit = 4: del tipo mayoritario entran sus TRES mas antiguos, no otros tres` |
| **R5** | `tests/integration/db/job-repository-claim-concurrente.int.test.ts` › `⭑ R5: el segundo claim NO espera al primero y NO repite ni una fila` (+ `R5: tras el rollback de ambos, ninguna fila del corpus quedo reclamada`) |
| **R6** | `job-repository-reparto-por-tipo.int.test.ts` › `limit = 2: el rescatado toma el turno 1 de su tipo junto al pendiente mas antiguo` (+ `un processing con locked_at RECIENTE sigue sin ser candidato`) |
| **R7** | ídem › `una llamada a claimBatch emite exactamente una consulta contra jobs` |
| **R8** | `tests/unit/services/job-queue-service.test.ts` › `R8: con jobs de DOS tipos, registra {tipo: cantidad} una sola vez`, `R8: lote VACIO -> no registra nada`, `R8: el mensaje NO lleva payload, ni ids, ni ningun dato de dominio` |
| **R9** | `job-repository-reparto-por-tipo.int.test.ts` › `un tipo posterior a la feature 90 recibe su turno igual que los demas` (`analitica_invalidacion_cache`, del enum posterior a la 90) |

## Cómo se aíslan los tests de la base de desarrollo

Dos mecanismos distintos, y los dos MEDIDOS, no supuestos:

1. **El archivo del reparto** corre dentro de `enTransaccionRevertida` (ni una fila queda) y
   además **inyecta el reloj en el año 2000**: los 74 jobs reales de la base local tienen
   `run_after` de 2026, luego `run_after <= now` es falso para todos y ninguno entra en el
   conjunto candidato. El primer `it` del archivo **lo comprueba**: lista los candidatos de la
   ventana y exige que sean EXACTAMENTE los 14 sembrados. Si ese caso cae, ninguno de los
   demás significa nada, y se ve.
2. **El archivo de concurrencia** no puede usar una transacción revertida —dos conexiones no
   ven las filas sin commitear de la otra, y dos consultas sobre la misma transacción se
   serializan en su única conexión, así que el `SKIP LOCKED` no llegaría a ejercitarse—. Usa un
   **esquema desechable** con `jobs` clonada (`LIKE public.jobs INCLUDING ALL`: mismos enums,
   índices y defaults) y `search_path` por transacción; se suelta con `DROP SCHEMA ... CASCADE`.
   Ni una fila entra en `public.jobs`, y un esquema huérfano —si el proceso muriera— no lo mira
   ningún cron.

## Mutaciones: qué se rompió a propósito y qué murió

Cada mutación se aplicó al SQL real y se corrieron los tres archivos. **Ninguna sobrevivió.**

| # | Mutación | Resultado |
| --- | --- | --- |
| **a** | `priorizados` vuelve a `ORDER BY "run_after" ASC` (antigüedad global, sin turnos) | **MUERE** — 4 rojos: R1/R3, R6, R9 y el testigo del archivo de concurrencia |
| **b** | `FOR UPDATE OF j SKIP LOCKED` → `FOR UPDATE OF j` | **MUERE** — el segundo claim se queda esperando y Postgres lo mata con `57014` (statement_timeout); también cae la aserción de forma de R7 |
| **c** | `ROW_NUMBER() ... ORDER BY "run_after" DESC` (desempate intra-tipo roto) | **MUERE** — 6 rojos: R1/R3, R2, R4, R6, R9 y el de concurrencia |
| **d** | quitar el `WHERE` repetido de `bloqueados` (mi añadido, ver abajo) | **MUERE** solo por la aserción de FORMA de R7. Los tests de comportamiento SOBREVIVEN, y eso está dicho en el propio test: la ventana de la carrera es de microsegundos y no hay forma de provocarla a voluntad |

## Una desviación del design, con su motivo

`design.md §1` escribe la CTE `bloqueados` como un `JOIN` por id sin `WHERE`. **Se le añadió el
predicado de candidato repetido** (mismo `WHERE` que `candidatos`, ni una condición nueva).

Por qué: si otro worker COMMITEA su claim entre el snapshot de esta sentencia y el momento del
bloqueo, Postgres reevalúa las condiciones sobre la versión NUEVA de la fila (EvalPlanQual). Con
el `JOIN` por id como única condición, la fila que el otro worker acaba de reclamar **sigue
cumpliéndola** y se entregaría dos veces — justo el invariante que la 90 sostenía al tener el
`FOR UPDATE` dentro del `WHERE`. Con el predicado repetido, la fila ya `processing` con
`locked_at` reciente no lo cumple y se descarta. En el camino normal no cambia nada: los ids de
`priorizados` ya pasaron ese mismo filtro bajo el mismo snapshot.

## Un efecto del diseño que conviene saber (no lo pide ningún requisito)

Con la sentencia nueva, **dos corridas solapadas ya no llenan las dos su lote**. `priorizados`
fija los `limit` ids ANTES de bloquear, así que el segundo worker sólo puede reclamar los que el
primero no tuviera bloqueados: si el primero se llevó todos los de esa ventana, el segundo
devuelve menos filas (o ninguna) aunque queden candidatos. Antes, el `SKIP LOCKED` vivía dentro
del `LIMIT` y el segundo se llevaba las siguientes N libres.

**No rompe R5** (lo que R5 exige es que ninguna fila se entregue dos veces, y eso se mide), ni
afecta al modo normal de operación: el cron es **uno**, cada minuto. Queda escrito porque es un
cambio real de comportamiento bajo solape, y porque la corrida siguiente recoge lo que quedó.

## Verificación

```
pnpm run typecheck   → sin errores (tsc --noEmit, salida vacía)
pnpm run lint        → 0 errors, 175 warnings (TODAS preexistentes; ninguna en los archivos de esta ficha)
pnpm exec vitest related --run lib/repositories/JobRepository.ts lib/services/JobQueueService.ts
                     → Test Files 438 passed (438) · Tests 6207 passed | 17 skipped (6224)
los tres archivos de esta ficha
                     → Test Files 3 passed (3) · Tests 24 passed (24)
```

El gate (`./init.sh --rapido`) y su `INIT_EXIT` van al final de este archivo.

## Gate

`./init.sh --rapido`, corrido en el worktree con el `.env` copiado del árbol principal (y
borrado al terminar; nunca se commitea). Log completo con el código de salida DENTRO:
`scratchpad/gate-402-rapido.log`.

```
✓ typecheck paso
✓ lint paso (0 errors)
✓ el cambio no toca esquema, tipos compartidos, config ni dinero: el modo rapido basta
✓ DATABASE_URL resuelta: los 147 archivos de tests contra Postgres SI se ejecutan
  relacionados: Test Files 438 passed (438) · Tests 6207 passed | 17 skipped (6224)
  guardias:     Test Files 198 passed (198) · Tests 2952 passed (2952)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 629 ejecutado(s))
✓ .env presente
== init OK ==
INIT_EXIT=0
```

**Los saltados, mirados uno a uno** (con 8 de 9 requisitos apoyados en `integration/db`, un
verde con los tests saltados no probaría nada): **17 casos saltados en total, y los 17 están en
`tests/components/AnaliticaPage.test.tsx`** — preexistentes y ajenos a esta ficha. **Cero
archivos saltados.** Los tres archivos de la ficha aparecen EJECUTADOS en el log del gate:

```
✓ tests/integration/db/job-repository-reparto-por-tipo.int.test.ts (9 tests) 920ms
✓ tests/integration/db/job-repository-claim-concurrente.int.test.ts (2 tests) 805ms
✓ tests/unit/services/job-queue-service.test.ts (13 tests) 16ms
```

El aviso de `migraciones sin down.sql` (tres, de las fichas de ruta de agosto) es **deuda
preexistente**: esta ficha no añade ninguna migración.
