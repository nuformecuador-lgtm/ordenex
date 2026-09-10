# impl_402 — La cola reparte el trabajo entre tipos

Rama `feat/402-cola-reparte-entre-tipos`. Spec: `specs/402-cola-reparte-trabajo-entre-tipos/`.

> **Segunda vuelta (review `progress/review_402.md`, RECHAZADO).** El reviewer confirmó el SQL
> —no se ha tocado ni un carácter— y tumbó la evidencia: **dos mutaciones de una línea que
> reintroducen la DOBLE ENTREGA de un job sobrevivían a la suite entera**. Mi justificación para
> no medirlas («la ventana de la carrera es de microsegundos y no se puede provocar a voluntad»)
> **era falsa, y él la provocó**. Lo corregido en esta vuelta está al final, en
> "Correcciones del review".

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
| `tests/integration/db/job-repository-claim-concurrente.int.test.ts` | **nuevo** — R5 en sus DOS modos, con dos conexiones de verdad |
| `tests/unit/services/job-queue-service.test.ts` | **modificado** — `describe` nuevo para R8 |
| `specs/402-cola-reparte-trabajo-entre-tipos/design.md` | **corregido en la 2.ª vuelta** — §1 documentaba el SQL inseguro |
| `specs/402-cola-reparte-trabajo-entre-tipos/tasks.md` | **corregido en la 2.ª vuelta** — casillas marcadas + grupo 6 |
| `docs/verification.md` | **corregido en la 2.ª vuelta** — la cifra de archivos contra Postgres (77 → 147) |

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
| **R5** | `tests/integration/db/job-repository-claim-concurrente.int.test.ts`, **los dos modos de competencia**: › modo 1 `⭑ R5: el segundo claim NO espera al primero y NO repite ni una fila` (el competidor tiene el lock ABIERTO) y › modo 2 `⭑ R5: una fila que otro worker ya reclamo Y COMMITEO no se entrega por segunda vez` + `⭑ una fila re-agendada con backoff por otro worker no se reclama antes de tiempo` (el competidor YA COMMITEÓ — el modo NORMAL en producción, porque el claim corre en autocommit) |
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
   serializan en su única conexión, así que el `SKIP LOCKED` no llegaría a ejercitarse—. Usa
   **esquemas desechables** con `jobs` clonada (`LIKE public.jobs INCLUDING ALL`: mismos enums,
   índices y defaults) y `search_path` por transacción; se sueltan con `DROP SCHEMA ... CASCADE`.
   Ni una fila entra en `public.jobs`, y un esquema huérfano —si el proceso muriera— no lo mira
   ningún cron. Desde la 2.ª vuelta, al arrancar **se barren los huérfanos de corridas
   anteriores**, y por EDAD (el sello de tiempo va en el nombre): un barrido por prefijo a secas
   se llevaría por delante el esquema de otro archivo que esté corriendo en paralelo.

## Mutaciones: qué se rompió a propósito y qué murió

Cada mutación se aplicó al SQL real y se corrieron los archivos de la ficha. Las tres primeras
son de la 1.ª vuelta; (d), (e) y (g) salieron del review. **Hoy no sobrevive ninguna.**

| # | Mutación | Resultado |
| --- | --- | --- |
| **a** | `priorizados` vuelve a `ORDER BY "run_after" ASC` (antigüedad global, sin turnos) | **MUERE** — 4 rojos: R1/R3, R6, R9 y el testigo del archivo de concurrencia |
| **b** | `FOR UPDATE OF j SKIP LOCKED` → `FOR UPDATE OF j` | **MUERE** — el segundo claim se queda esperando y Postgres lo mata con `57014` (statement_timeout); también cae la aserción de forma de R7 |
| **c** | `ROW_NUMBER() ... ORDER BY "run_after" DESC` (desempate intra-tipo roto) | **MUERE** — 6 rojos: R1/R3, R2, R4, R6, R9 y el de concurrencia |
| **d** | quitar el `WHERE` repetido de `bloqueados` entero | **MUERE**, y ahora por COMPORTAMIENTO: los dos casos del modo 2 más la aserción de forma de R7. Antes de esta vuelta solo la mataba el regex |
| **e** | dentro de ese `WHERE`: `j."locked_at" < $visibilityCutoff` → `j."locked_at" IS NOT NULL` | **MUERE** (antes SOBREVIVÍA a todo) — `⭑ R5: una fila que otro worker ya reclamo Y COMMITEO...`: `DOBLE ENTREGA: A reclamo filas que el competidor ya se habia llevado y commiteado. A: … (293 ms), commit del competidor: +124 ms — expected [ …(3) ] to deeply equal []` |
| **g** | dentro de ese `WHERE`: `j."run_after" <= $now` → `j."run_after" IS NOT NULL` | **MUERE** (antes SOBREVIVÍA a todo) — `⭑ una fila re-agendada con backoff...`: `BACKOFF IGNORADO: A reclamo filas que otro worker acababa de re-agendar para dentro de cinco minutos. Se ejecutarian antes de tiempo, en bucle. A: … (276 ms), commit del competidor: +108 ms` |

Cada una muere en **su** caso y solo en el suyo, que es la señal de que los dos casos del modo 2
cubren ramas distintas del predicado y ninguno es decorativo.

## La desviación del design, ahora MEDIDA (y ya subida al spec)

`design.md §1` escribía la CTE `bloqueados` como un `JOIN` por id sin `WHERE`. Le añadí el
predicado de candidato repetido (el mismo `WHERE` que `candidatos`, ni una condición nueva),
razonándolo — y el reviewer **lo midió** contra Postgres, con la sentencia exacta de producción
y la ventana ensanchada con 300.000 candidatos:

```
bloqueados SIN el predicado repetido -> A reclamo 5  <-- LA MISMA FILA QUE B, DOS VECES
bloqueados CON el predicado repetido -> A reclamo 4  (sin repetidas)
```

El mecanismo: en `READ COMMITTED` la sentencia entera usa el snapshot de su inicio; si otro
worker reclama esas filas y **commitea** mientras la sentencia sigue viva, al bloquear Postgres
reevalúa las condiciones sobre la versión NUEVA (EvalPlanQual). Con el `JOIN` por id como única
condición, la fila recién reclamada **sigue cumpliéndola** y se entrega dos veces. Y ese modo
—competidor ya commiteado— es el **normal** en producción: `drenar` llama al claim en autocommit,
así que los locks duran una sentencia, milisegundos.

**Lo que estuvo mal en mi primera vuelta no fue el arreglo, fue la evidencia:** dije que la
carrera no se podía provocar a voluntad y la dejé sostenida por un regex sobre el texto del SQL.
Se provoca, cuesta ~5 s por corrida, y ahora está en el modo 2 del archivo de concurrencia.
Todo esto vive ya en `design.md §1` (bloqueante 2), no solo aquí.

## Un efecto del diseño que conviene saber (no lo pide ningún requisito)

Con la sentencia nueva, **dos corridas solapadas ya no llenan las dos su lote**. `priorizados`
fija los `limit` ids ANTES de bloquear, así que el segundo worker sólo puede reclamar los que el
primero no tuviera bloqueados: si el primero se llevó todos los de esa ventana, el segundo
devuelve menos filas (o ninguna) aunque queden candidatos. Antes, el `SKIP LOCKED` vivía dentro
del `LIMIT` y el segundo se llevaba las siguientes N libres.

**No rompe R5** (lo que R5 exige es que ninguna fila se entregue dos veces, y eso se mide), ni
afecta al modo normal de operación: el cron es **uno**, cada minuto, y el claim corre en
autocommit —los locks duran una sentencia, no el procesado del lote—, así que para que hubiera
degradación tendrían que solaparse dos `claimBatch`, es decir, que el claim solo tardase más de
60 s. Coste máximo si pasara: un lote más corto, recuperado en la corrida siguiente.

Desde la 2.ª vuelta esto ya **no vive solo aquí**: está en `design.md §1` con su razonamiento, y
fijado en un test con nombre propio (`bajo solape, el segundo lote viene INCOMPLETO`), separado
del caso de R5 para que no se lea como si fuera un requisito.

## Correcciones del review (2.ª vuelta)

`JobRepository.ts` **no se tocó**: `git diff` contra el commit anterior no devuelve nada para ese
archivo. Todo lo corregido es evidencia y spec.

| Hallazgo | Qué se hizo |
| --- | --- |
| **Bloqueante 1** — la exclusión mutua bajo claim COMMITEADO sin test; (e) y (g) sobreviven | Dos casos nuevos de comportamiento ("modo 2") en `job-repository-claim-concurrente.int.test.ts`. **(e) y (g) mueren**, cada una en el suyo (tabla de mutaciones arriba) |
| **Bloqueante 2** — `design.md §1` documenta el SQL inseguro | §1 corregido a la sentencia real + subsección "Por qué el predicado de candidato se REPITE" con los números medidos, el mecanismo de EvalPlanQual, la nota de que la ventana crece con la saturación y el aviso de no colapsar las CTEs. Añadido el efecto del lote parcial bajo solape con su razonamiento. Y "Garantías conservadas" (punto 2) ya dice que `SKIP LOCKED` cubre **uno** de los dos modos |
| **Bloqueante 3** — `tasks.md` sin marcar | T1-T12 marcadas `[x]` + Grupo 6 (T13-T15) con el trabajo de esta vuelta |
| **menor 1** — el `toEqual` de `jobsB` mezclado con R5 | Separado a su propio `it` (`bajo solape, el segundo lote viene INCOMPLETO…`). **No es polizón: es contrato** — fija un comportamiento declarado en `design.md §1`, y por eso se conserva; lo que no era correcto es que se leyera como parte de R5 |
| **menor 2** — esquema desechable huérfano | Barrido al arrancar, **por edad** (sello de tiempo en el nombre, >1 h). Por prefijo a secas se llevaría el esquema de otro archivo corriendo en paralelo |
| **menor 3** — orden implícito entre casos | El caso del residuo corre **su propio** solape; ya no depende de que otro se haya ejecutado |
| **menor 4** — el `.env` copiado al worktree | Esta vuelta se corrió **exportando `DATABASE_URL`** (vía sancionada por `docs/verification.md`); no se copió ningún `.env` |
| **menor 5** — cifra rancia (77 archivos) | `docs/verification.md` pasa a **147**, la que mide el gate hoy, y dice que la cifra del párrafo caduca |

## Verificación (2.ª vuelta)

```
pnpm run typecheck   → sin errores (tsc --noEmit, salida vacía)
pnpm run lint        → 0 errors, 175 warnings (las mismas de antes; ninguna en los archivos de la ficha)
los tres archivos de la ficha
                     → Test Files 3 passed (3) · Tests 27 passed (27)
```

## Gate

`./init.sh --rapido` con **`DATABASE_URL` exportada** (esta vuelta NO se copió el `.env`:
`docs/verification.md`). Log completo con el código de salida DENTRO:
`scratchpad/gate-402-rapido-v2.log`.

```
✓ el cambio no toca esquema, tipos compartidos, config ni dinero: el modo rapido basta
✓ typecheck paso
✓ lint paso
✓ DATABASE_URL resuelta: los 147 archivos de tests contra Postgres SI se ejecutan
  relacionados: Test Files 438 passed (438) · Tests 6210 passed | 17 skipped (6227)
  guardias:     Test Files 198 passed (198) · Tests 2952 passed (2952)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 629 ejecutado(s))
! no hay .env. Crea uno a partir de .env.example      <-- y aun asi la capa de datos SI corrio
== init OK ==
INIT_EXIT=0
```

Esas dos líneas juntas —`DATABASE_URL resuelta … SI se ejecutan` y `no hay .env`— son la prueba
de que la vía sancionada (exportar la variable) basta y de que no quedó ningún `.env` en el
worktree.

**Los saltados, mirados uno a uno** (con 8 de 9 requisitos apoyados en `integration/db`, un
verde con los tests saltados no probaría nada): **17 casos saltados, los 17 en
`tests/components/AnaliticaPage.test.tsx`** — preexistentes y ajenos. **Cero archivos saltados**,
y cero saltados en las guardias. Los tres archivos de la ficha aparecen EJECUTADOS en el log:

```
✓ tests/integration/db/job-repository-claim-concurrente.int.test.ts (5 tests) 5999ms
✓ tests/integration/db/job-repository-reparto-por-tipo.int.test.ts (9 tests) 627ms
✓ tests/unit/services/job-queue-service.test.ts (13 tests) 18ms
```

**Residuos en la base local, comprobados después del gate:** cero esquemas `t402_*`,
`public."jobs"` con las mismas 74 filas y el mismo `run_after` mínimo que antes de empezar.

El aviso de `migraciones sin down.sql` (tres, de las fichas de ruta de agosto) es **deuda
preexistente**: esta ficha no añade ninguna migración.
