# review_402 — La cola reparte el trabajo entre tipos

> **ESTE INFORME TIENE DOS VUELTAS.** Abajo, intacto, el registro de la PRIMERA (commit
> `8f55dd77`, veredicto **RECHAZADO**, tres bloqueantes). La SEGUNDA vuelta —commit
> `c19f4011`, que cierra los tres— esta al final, en
> **"Segunda vuelta: verificacion del commit `c19f4011`"**.
>
> **VEREDICTO VIGENTE: APROBADA.** Lo de aqui abajo se conserva porque explica POR QUE el
> arreglo esta como esta; no describe el estado actual de la rama.

---

## PRIMERA VUELTA (commit `8f55dd77`) - RECHAZADO

Revisión del commit `8f55dd77b3633a2d06a32f3856cd9dac38ef27ae` (rama
`feat/402-cola-reparte-entre-tipos`, 9 archivos sobre `079c4ec7`) contra
`specs/402-cola-reparte-trabajo-entre-tipos/`, `docs/architecture.md`,
`docs/conventions.md`, `docs/verification.md` y `CHECKPOINTS.md`.

**Veredicto: RECHAZADO.** El código de producción es CORRECTO —y mejor que el `design.md`—,
pero la evidencia no defiende el invariante más caro del sistema: **dos mutaciones de una línea
que reintroducen la doble entrega de un job sobreviven a la suite entera**, y una de ellas la
medí produciendo la doble entrega contra Postgres. No hay que tocar `JobRepository.ts`; hay que
cerrar tres huecos de evidencia y de spec.

---

## Lo que corrí yo (no la bitácora del implementer)

Todo en el worktree de la rama (`.claude/worktrees/agent-afae9466fa4ed809b`, limpio en
`8f55dd77`), con `DATABASE_URL` **exportada** desde el `.env` del árbol principal — que es la vía
que `docs/verification.md` sanciona, sin copiar el `.env`. El árbol principal nunca se tocó.

| Qué | Resultado |
| --- | --- |
| `./init.sh --rapido` | **`INIT_EXIT=0`**, `== init OK ==` |
| Gate: DB | `✓ DATABASE_URL resuelta: los 147 archivos de tests contra Postgres SI se ejecutan` |
| Gate: relacionados | `Test Files 438 passed (438)` · `Tests 6207 passed | 17 skipped (6224)` |
| Gate: guardias | `Test Files 198 passed (198)` · `Tests 2952 passed (2952)` |
| Gate: veredicto | `sin rojos nuevos (0 archivo(s) rojo(s) sobre 629 ejecutado(s))` |
| **Saltados, mirados uno a uno** | **17 casos, los 17 en `tests/components/AnaliticaPage.test.tsx`** (preexistentes, ajenos). **Cero archivos saltados.** |
| Los 3 archivos de la ficha | aparecen EJECUTADOS: `reparto-por-tipo (9 tests)`, `claim-concurrente (2 tests)`, `job-queue-service (13 tests)` |
| Los 3 archivos, aislados | `Test Files 3 passed (3)` · `Tests 24 passed (24)`, cero saltados |
| Residuos en la base local | **ninguno**: cero esquemas `t402_*`, `public."jobs"` sigue con 74 filas |

La bitácora del implementer sobre el gate es **exacta**. Nada de lo que reportó se cayó al
comprobarlo.

### Mutaciones — las 3 suyas y 4 mías

Aplicadas al SQL real, corriendo los tres archivos de la ficha:

| # | Mutación | Resultado |
| --- | --- | --- |
| a | `priorizados` vuelve a `ORDER BY "run_after" ASC` (antigüedad global) | **MUERE** (R1/R3, R6, R9, R5) |
| b | `FOR UPDATE OF j SKIP LOCKED` → `FOR UPDATE OF j` | **MUERE** (R5 cae a los 3.095 ms por `statement_timeout`; + forma de R7) |
| c | `ROW_NUMBER() ... ORDER BY "run_after" DESC` | **MUERE** (R1/R3, R2, R4, R6, R9, R5) |
| d | quitar el `WHERE` repetido de `bloqueados` | **MUERE, y SOLO por la aserción de FORMA de R7** — tal y como el implementer declaró |
| **e (mía)** | en el `WHERE` de `bloqueados`: `j."locked_at" < $visibilityCutoff` → `j."locked_at" IS NOT NULL` | **SOBREVIVE** — y **reintroduce la doble entrega** (medido, ver abajo) |
| **f (mía)** | `priorizados ... LIMIT $limit` → `LIMIT $limit + 5` | **MUERE** (7 casos) |
| **g (mía)** | en el `WHERE` de `bloqueados`: `j."run_after" <= $now` → `j."run_after" IS NOT NULL` | **SOBREVIVE** |

Las tres del implementer mueren, confirmado. Las que él no probó son las que abren el agujero.

---

## Punto 1 del encargo — la desviación del `design.md §1`: **el razonamiento es CORRECTO, y lo medí**

No lo doy por bueno leyendo el código: monté el escenario contra Postgres real, en un esquema
desechable, con **la sentencia EXACTA de producción, `FOR UPDATE OF j SKIP LOCKED` incluido**.
La ventana snapshot→bloqueo se ensancha sembrando 300.000 candidatos (el `ROW_NUMBER()` obliga a
`candidatos` a verlos todos), y el worker B commitea su claim DENTRO de esa ventana:

```
[SKIP LOCKED real, 300000 candidatos, commit de B a los 150 ms]
  bloqueados SIN el predicado repetido -> A tardo 259 ms, reclamo 5  <-- LA MISMA FILA QUE B, DOS VECES
  bloqueados CON el predicado repetido -> A tardo 172 ms, reclamo 4  (sin repetidas)
```

Y con la ventana forzada de forma determinista (A espera el lock de B y despierta tras su commit;
mismo recheck de EvalPlanQual):

```
  bloqueados SIN el predicado repetido -> B reclamo 1, A reclamo 1  <-- LA MISMA FILA DOS VECES
  bloqueados CON el predicado repetido -> B reclamo 1, A reclamo 0
```

**Conclusión: el `design.md §1` está MAL.** Su CTE `bloqueados` —`JOIN` por id como única
condición— entrega la misma fila a dos workers, y eso es una **regresión del invariante R10/R11 de
la feature 90**, que se sostenía justo porque su `FOR UPDATE` vivía dentro del `WHERE`. El
predicado repetido no es código de más: es lo que hace que la reescritura sea segura.

Hay un agravante que nadie ha escrito y que conviene que quede: **la ventana de esa carrera crece
con el número de candidatos**. La sentencia nueva ya no puede cortar el escaneo en `limit` filas
(lo dice el propio `design.md §2`), así que la duración del statement —y con ella la exposición—
sube justo cuando hay saturación, que es el escenario que esta ficha existe para atender. La
protección es más necesaria de lo que su nota sugiere.

### ¿Y la aserción de FORMA? Es una **coartada**, y con la medida delante

El implementer justificó no medir el comportamiento diciendo que «la ventana de la carrera es de
microsegundos y no hay forma de provocarla a voluntad». **Eso es falso**: la provoqué dos veces, de
forma determinista y repetible, en menos de 90 líneas y ~10 s por corrida. Existe la prueba; no se
escribió.

Y la forma que se dejó en su lugar no cubre lo que dice cubrir. El regex exige que entre el `JOIN
priorizados` y el `FOR UPDATE OF j SKIP LOCKED` aparezca el literal `j."estado" = 'pending'`.
**No mira** la comparación `run_after <= now`, **no mira** la rama de `processing`, **no mira** que
los parámetros que se enlazan sean los correctos. Por eso mi mutación (e) —que deja ese literal
intacto y sólo cambia `locked_at < cutoff` por `locked_at IS NOT NULL`— pasa el regex, pasa los 24
tests de la ficha, pasa las 198 guardias… y devuelve el sistema exactamente al fallo que el
predicado vino a impedir:

```
variante real   -> A reclamo 4; filas que B YA se habia llevado: 0   (ok)
variante mut-e  -> A reclamo 5; filas que B YA se habia llevado: 1   <-- DOBLE ENTREGA
```

Doble entrega aquí no es un rojo de test: es un `webhook_estado` firmado y entregado dos veces a un
integrador, o un `whatsapp_bienvenida` que llega dos veces al cliente. Es el invariante más caro de
la cola y hoy lo guarda un `String.match`.

## Punto 2 del encargo — el lote parcial bajo solape: NO es una regresión de rendimiento, pero está mal documentado

El cambio de comportamiento es real y el implementer lo declaró bien: `priorizados` fija los ids
ANTES de bloquear, así que el segundo worker se lleva sólo lo que el primero no tuviera bloqueado
(el propio test de R5 lo deja fijado: B pide 6 y se lleva 4). Antes, el `SKIP LOCKED` vivía dentro
del `LIMIT` y B se llevaba las siguientes N libres.

Medido el alcance real, que es lo que decide si duele:

1. **En producción `claimBatch` NO corre dentro de una transacción.** `JobQueueService.drenar` la
   invoca en autocommit sobre el cliente singleton: los locks del `FOR UPDATE` viven lo que dura
   **una sentencia** (~ms), no lo que dura el procesado del lote. El test de concurrencia mantiene
   la transacción de A abierta a propósito, que es un escenario **más extremo** que el real.
2. **La ventana de solape es, por tanto, la duración de un statement.** Si la corrida N+1 arranca
   después de que la N haya commiteado su claim, sus filas ya son `processing` con `locked_at`
   reciente: **ni siquiera entran en `candidatos`**, y el segundo lote se llena entero.
3. **El caso «una corrida tarda más de un minuto y se solapa con la siguiente» no degrada nada.**
   Lo que se solapa es el *procesado* de la corrida N con el *claim* de la N+1, y el claim de la N
   ya commiteó hace rato. Para que hubiera degradación tendrían que solaparse los dos `claimBatch`,
   es decir, que el claim de la N tardase más de 60 s él solo.
4. **Coste máximo si ocurriese:** una corrida se lleva menos filas de las que podía. Ninguna fila se
   pierde ni se retrasa más allá de la corrida siguiente (60 s). No hay livelock posible: los locks
   son transitorios.

Con **un** cron (`* * * * *` en `vercel.json`, disparador único) esto es aceptable y no bloquea. Lo
que sí falta es dejarlo escrito **donde manda**: hoy vive en `progress/impl_402.md`, que es una
bitácora, y el `design.md` —el spec de registro— no lo menciona. El día que alguien añada un
segundo worker, un disparo manual o baje la frecuencia del cron, la propiedad «cada worker se lleva
N libres» ya no existe y no habrá dónde leerlo.

---

## CHECKPOINTS.md, punto por punto

### Especificación
- [x] `requirements.md` con requisitos EARS numerados R1-R9.
- [x] `design.md` con alternativas descartadas (A-F) y su porqué. **Pero su §1 documenta un SQL
      que entrega filas dos veces** — ver BLOQUEANTE 2.
- [ ] **`tasks.md` con todas las tasks marcadas `[x]`: NO.** El archivo tiene **12 tareas (T1-T12)
      y CERO casillas**. Las fichas hermanas sí las llevan (396: 74, 393: 35, 398: 23). El
      checkpoint no se puede dar por cumplido.

### Trazabilidad
- [x] `progress/impl_402.md` contiene el mapa R<n> -> test.
- [~] Cada R<n> mapea a un test concreto: **R1, R2, R3, R4, R6, R7, R8 y R9 sí** (verificados uno a
      uno abajo). **R5 no lo cubre en el modo que importa** — ver BLOQUEANTE 1.

### Calidad de código
- [x] `pnpm run typecheck` sin errores (dentro del gate).
- [x] `pnpm run lint` sin errores.
- [x] `pnpm test` (modo rápido: relacionados + guardias) verde, con la capa de datos ejecutada.
- [n/a] E2E: no hay harness Playwright en el repo y el cambio no tiene superficie de UI; el riesgo
      se cubre contra Postgres real, que es donde vive la lógica.

### Datos y seguridad
- [n/a] RLS: **no hay tabla nueva** ni cambio de esquema.
- [n/a] Migraciones: **ninguna**. El aviso de `down.sql` que imprime el gate es deuda preexistente
      de tres migraciones de agosto, ajena a esta ficha.
- [x] Sin secretos hardcodeados. El `.env` que el implementer copió al worktree **no está en el
      commit** (verificado: 9 archivos, ninguno es `.env`).
- [n/a] Webhooks nuevos: ninguno.

### Patrón de capas
- [x] Controller (`app/api/cron/procesar-jobs/route.ts`) **sin cambios**.
- [x] Service sin HTTP: sólo agrupa un array ya en memoria y llama al logger.
- [x] Repository sólo query: el `$queryRaw` y `toDTO`, sin lógica de negocio.
- [x] Contratos intactos: `IJobRepository.claimBatch`, `ClaimOpts`, `JobDTO`, `DrenarResult`.

### Permisos / Multi-país
- [n/a] Sin páginas ni componentes nuevos. Sin país, moneda ni cuenta en juego.
- [x] **Sin hardcode de contexto**: el reparto es `PARTITION BY "tipo"`, genérico; ningún tipo del
      enum aparece nombrado en `JobRepository.ts`.

### Verificación final
- [x] El gate termina en verde (INIT_EXIT=0), reproducido por mí.
- [ ] `progress/review_402.md` con veredicto OK -> **este archivo, y el veredicto es RECHAZADO**.
- [ ] Entrada en `progress/history.md`: **no existe** (corresponde al cierre; queda pendiente).

---

## Trazabilidad R1-R9, uno por uno

Comprobé que el test **discrimina**, no que exista con un nombre parecido: para cada uno, qué
devolvería la implementación vieja.

- **R1** — `reparto-por-tipo` > `R1/R3 ... 4/3/2/1, no 8+2+0+0`. **Sí.** 14 candidatos de 4 tipos,
  `limit=10`; exige la composición exacta `{webhook 4, whatsapp 3, geo 2, ruta 1}`, la lista literal
  de los 10 testigos y `total === 10`. Con el orden global daría 8+2+0+0. Una fila ajena saldría
  como `AJENO:<uuid>`. Muere con las mutaciones a, c y f.
- **R2** — ídem > `14 candidatos de un unico tipo y limit = 10`. **Sí.** Exige 10 filas y que sean
  `solo-1..solo-10`, no diez cualesquiera. Muere con c y f.
- **R3** — mismo caso que R1. **Sí.** El tipo mayoritario llega al turno 4 y ocupa el cupo que geo y
  ruta no pueden llenar: sin tope artificial y sin cupo desperdiciado.
- **R4** — ídem > `limit = 4: del tipo mayoritario entran sus TRES mas antiguos`. **Sí.** Aserción
  separada sobre el subconjunto del tipo mayoritario (`may-1/2/3`, no `may-3/4/5`). Muere con c.
- **R5** — `claim-concurrente` > `el segundo claim NO espera al primero y NO repite ni una fila`.
  **Parcialmente, y le falta el modo que importa.** Ver BLOQUEANTE 1.
- **R6** — `reparto-por-tipo` > `limit = 2: el rescatado toma el turno 1 de su tipo`. **Sí.** El
  rescatado es el MÁS NUEVO por `run_after`: con el orden global jamás entraría en un lote de 2.
  Además comprueba `intentos 3 -> 4` y el re-sellado de `locked_at`, y hay un caso negativo
  (`locked_at` reciente, luego no candidato). Muere con a y c.
- **R7** — ídem > `una llamada a claimBatch emite exactamente una consulta`. **Sí para "una sola
  sentencia".** Espía real (`crearPrismaDeTestConEspia`), filtra el ruido transaccional y **no es
  cierto por vacío**: exige `reclamados === 3` antes de contar. Las dos aserciones de FORMA que
  lleva pegadas son otra cosa: ver BLOQUEANTE 1.
- **R8** — `job-queue-service` > tres casos más el del logger sin `info`. **Sí.** Parsea el JSON del
  mensaje en vez de comparar el texto; cubre lote vacío (no loguea) y ausencia de PII con un
  payload y un id sembrados a propósito. Y **comprobé el composition root**: `buildService` no
  inyecta logger, `defaultLogger` ahora trae `info: console.info`, luego el log **sí sale en
  producción**; no es un notificador muerto.
- **R9** — `reparto-por-tipo` > `un tipo posterior a la feature 90 recibe su turno`. **Sí.**
  `analitica_invalidacion_cache` con el `run_after` más nuevo y `limit=3`: con el orden global
  saldría `webhook-1/2/3`; se exige `{nuevo, webhook-1, webhook-2}`. Muere con a y c.

**Ningún test de integración de esta ficha puede pasar sin datos.** El primer caso del archivo es
un control de aislamiento explícito: lista los candidatos de la ventana y exige que sean
EXACTAMENTE los 14 sembrados. No hay un solo retorno temprano condicional ni un `skip` dentro de un
caso. El reloj inyectado en el año 2000 deja fuera las 74 filas reales de la base local. Corrí los
tres archivos y los 24 casos aparecen ejecutados con nombre; ninguno saltado.

---

## Hallazgos

### BLOQUEANTE 1 — La exclusión mutua bajo un claim COMMITEADO no tiene test, y dos mutaciones que la rompen sobreviven

**Qué falla.** R5 dice: «ninguna fila DEBE ser entregada a más de una llamada». El test cubre un
solo modo de concurrencia —el primer worker mantiene el lock abierto y el segundo lo salta— que en
producción **no es el modo normal**: `claimBatch` corre en autocommit, así que el caso realista es
que el competidor **ya commiteó** y la fila queda libre con `estado = processing`. Ése es el modo
que la reescritura estuvo a punto de romper, es el que motivó el `WHERE` repetido, y es el que **no
se mide**.

**La prueba de que el hueco es real, no teórico** (mutación (e): en el `WHERE` de `bloqueados`,
`j."locked_at" < $visibilityCutoff` pasa a `j."locked_at" IS NOT NULL`, una línea):

- pasa los 24 tests de la ficha, los 438 archivos relacionados y las 198 guardias: `init.sh
  --rapido` sale **verde**;
- pasa incluso la aserción de forma de R7, porque el literal `j."estado" = pending` sigue ahí;
- y contra Postgres **entrega la misma fila a dos workers**: `variante mut-e -> A reclamo 5; filas
  que B YA se habia llevado: 1`.

La mutación (g) (`j."run_after" <= $now` pasa a `IS NOT NULL`) también sobrevive entera; no medí una
consecuencia para ella en esta carrera concreta y no la afirmo, pero deja la rama `pending` del
predicado sin ninguna red.

**Qué falta para levantarlo.** Un test de comportamiento en
`tests/integration/db/job-repository-claim-concurrente.int.test.ts` que ejercite el claim
**commiteado**: B reclama con la sentencia real y **commitea**; A arranca su `claimBatch` ANTES de
ese commit y llega al bloqueo DESPUÉS; se exige que A **no** devuelva ninguna fila de B. La ventana
se abre de forma determinista por cualquiera de estas dos vías, las dos probadas en esta revisión:

- sembrando muchos candidatos en el esquema desechable (con 300.000 el statement dura ~200 ms, de
  sobra para commitear B dentro), usando **la sentencia real, `SKIP LOCKED` incluido**; o
- forzando a A a esperar el lock (`FOR UPDATE OF j` sin `SKIP LOCKED`) y soltando B después: el
  recheck de EvalPlanQual que se mide es el mismo.

El criterio de aceptación es objetivo: **las mutaciones (e) y (g) deben morir.** Mientras sólo las
mate un regex sobre el texto del SQL, lo que hay es un cable trampa, no una medida; y el propio
implementer describe la aserción como «de FORMA a propósito» apoyándose en una imposibilidad que no
existe.

*No hay que cambiar `JobRepository.ts`: la sentencia que se commiteó es la correcta.*

### BLOQUEANTE 2 — `design.md` §1 documenta un SQL que entrega filas dos veces

El spec de registro sigue mostrando `bloqueados` con el `JOIN` por id como única condición, y
**está medido que eso duplica entregas**. Hoy la corrección sólo vive en `progress/impl_402.md` y en
un comentario del método. El día que alguien compare código contra design —o genere código desde
él— «alinear» significa reintroducir el fallo, y el design le dará la razón.

**Qué falta:** corregir `design.md` §1 para que muestre la sentencia que se commiteó, con el
párrafo de por qué el predicado se repite (recheck de EvalPlanQual sobre la versión nueva de la
fila) y la nota de que la ventana crece con el tamaño del conjunto candidato. Añadir además, en §1
o en §2, el cambio de comportamiento del punto 2 —bajo solape de dos claims el segundo lote puede
venir incompleto o vacío—, que hoy sólo está en la bitácora.

### BLOQUEANTE 3 — `tasks.md` sin marcar

12 tareas (T1-T12), cero casillas. `CHECKPOINTS.md` exige «todas las tasks marcadas `[x]`», y las
fichas hermanas (396, 393, 398) las llevan. Tal como está, el checkpoint no es verificable.
**Qué falta:** marcar T1-T12 en el formato de casillas del repo y confirmar que cada criterio de
«hecho cuando» se cumplió.

### menor 1 — El test de R5 fija, dentro del mismo caso, un comportamiento que ningún requisito pide

`expect(claves(jobsB)).toEqual(["geo-2","webhook-2","whatsapp-1","whatsapp-2"])` está codificando
que B, pidiendo 6, se lleva 4: exactamente la degradación bajo solape del punto 2. Está bien que
quede fijada, pero mezclada con la aserción de disjunción se lee como si fuera R5. Sugerencia:
separarla en su propio caso con nombre explícito («bajo solape, el segundo lote viene incompleto:
es el precio de fijar los ids antes de bloquear») y referencia al párrafo del design.

### menor 2 — El esquema desechable puede quedar huérfano

`job-repository-claim-concurrente.int.test.ts` crea `t402_concurrencia_<uuid>` y lo suelta en
`afterAll`. Si el runner muere a mitad queda un esquema huérfano en la base local **compartida**
entre worktrees. El propio archivo lo declara y el riesgo es bajo (ningún cron mira ahí; comprobé
que hoy no hay ninguno residual). Convendría una limpieza de arranque por prefijo, o dejarlo dicho
en `docs/verification.md`.

### menor 3 — Orden implícito entre los dos casos del archivo de concurrencia

El segundo (`tras el rollback de ambos, ninguna fila del corpus quedo reclamada`) sólo significa
algo si el primero ya corrió. Hoy es seguro (`vitest.config.ts` no activa `sequence.shuffle`), pero
es una dependencia no declarada: bastaría mover la comprobación al final del primer caso o
declararla en un comentario.

### menor 4 — El `.env` copiado al worktree

`docs/verification.md` dice, con su motivo, que **no** se copia ni se enlaza el `.env` a un worktree
y que la vía es exportar `DATABASE_URL`. El implementer lo copió (y lo borró después; no está en el
commit). Verifiqué que exportar la variable basta: el gate imprimió `DATABASE_URL resuelta: los 147
archivos ... SI se ejecutan` y a la vez el aviso `no hay .env`. Sin daño, pero conviene usar la vía
sancionada.

### menor 5 — Cifra rancia en `docs/verification.md` (ajena a esta ficha)

El doc habla de «77 archivos de test» envueltos en `HAY_BASE_DE_DATOS`; el gate mide hoy **147**. La
cifra del gate se mide en cada corrida y es la buena; la del doc engaña. Deuda del repo, no de la
402, pero queda anotada.

---

## Lo que esta ficha hace BIEN, y merece decirse

- **La regla se prueba donde vive.** 8 de 9 requisitos contra Postgres real, con el argumento
  correcto escrito en la cabecera del archivo: un doble de `claimBatch` no ve la consulta.
- **El aislamiento está MEDIDO, no supuesto.** El primer caso comprueba que la ventana del test
  contiene exactamente el corpus sembrado; sin eso, ninguno de los demás significaría nada. Y los
  testigos se nombran por clave, así que una fila ajena saldría delatada.
- **Ningún test verde por vacío.** El de R7 exige haber reclamado 3 filas antes de contar
  sentencias; el de concurrencia exige que el segundo lote no sea vacío antes de afirmar que la
  unión es disjunta.
- **El diagnóstico de R8 llega de verdad a producción.** `info` opcional, `defaultLogger` con
  `console.info` y `buildService` sin logger inyectado: comprobado que alguien lo llama, no sólo
  que se importa.
- **La desviación del design se declaró en el commit, en la bitácora y en el código.** Es
  exactamente lo que hay que hacer con una desviación; el problema no es que la hiciera, es que se
  quedó sin medir y sin subir al spec.
- **El arreglo resuelve el incidente.** Con las proporciones del 2026-09-09, la geocodificación
  entra en la PRIMERA corrida en vez de no entrar nunca.

---

## Veredicto

**RECHAZADO.**

Vuelve al implementer con tres cosas, ninguna de ellas en `JobRepository.ts`:

1. **Un test de comportamiento del claim commiteado** en `job-repository-claim-concurrente.int.test.ts`,
   con criterio objetivo: las mutaciones `locked_at < cutoff -> IS NOT NULL` y
   `run_after <= now -> IS NOT NULL` dentro del `WHERE` de `bloqueados` deben **morir**.
2. **`design.md` §1 corregido** a la sentencia real, con el porqué del predicado repetido y con el
   cambio de comportamiento bajo solape escrito en el spec, no sólo en la bitácora.
3. **`tasks.md` con T1-T12 marcadas.**

Hecho eso, la ficha está lista: el reparto por turnos es correcto, discriminante y está bien
medido.

---
---

# Segunda vuelta: verificacion del commit `c19f4011`

`c19f4011f884b2c9785f5f4f8bd2d7906861c2d6`, encima del commit de esta revisión. **6 archivos,
583 inserciones.**

**VEREDICTO: APROBADA.** Los tres bloqueantes están cerrados y lo comprobé ejecutando, no
leyendo. Los cinco menores, atendidos.

## Lo primero: el SQL no se tocó

```
git diff 8f55dd77 c19f4011 -- lib/    ->  vacio
```

Confirmado por mi cuenta. La corrección es toda de evidencia y de spec, que es exactamente lo que
pedía el informe.

## BLOQUEANTE 1 — CERRADO. Las mutaciones mueren, y cada una en su propio caso

Apliqué yo las mutaciones al SQL real y corrí los tres archivos de la ficha. Éste era mi criterio
objetivo, literal, de la primera vuelta:

| Mutación aplicada por mí | Antes (1.ª vuelta) | Ahora | Rojo exacto |
| --- | --- | --- | --- |
| **(e)** `j."locked_at" < $visibilityCutoff` a `IS NOT NULL` | **SOBREVIVÍA** | **MUERE** | `R5: una fila que otro worker ya reclamo Y COMMITEO no se entrega por segunda vez` — mensaje: `DOBLE ENTREGA: A reclamo filas que el competidor ya se habia llevado y commiteado. A: (123 ms), commit del competidor: +40 ms` |
| **(g)** `j."run_after" <= $now` a `IS NOT NULL` | **SOBREVIVÍA** | **MUERE** | `una fila re-agendada con backoff por otro worker no se reclama antes de tiempo` — mensaje: `BACKOFF IGNORADO: A reclamo filas que otro worker acababa de re-agendar para dentro de cinco minutos` |
| **(d)** quitar el `WHERE` de `bloqueados` entero | moría **sólo** por el regex de forma | **MUERE POR COMPORTAMIENTO**: los DOS casos del modo 2 (`DOBLE ENTREGA` y `BACKOFF IGNORADO`), y además el regex | |
| **(a)** `ORDER BY "run_after" ASC` global | moría | **MUERE** (7 rojos) | |
| **(b)** quitar `SKIP LOCKED` | moría | **MUERE** (3 casos del modo 1 a los ~3.020 ms: `statement_timeout` 57014) | |

Cada mutación cae en el caso que le corresponde y con un mensaje que dice **qué se rompió**, no
un `toEqual` mudo. Eso es lo que separa una medida de un cable trampa.

### El mecanismo antifalso-verde: lo saboteé y funciona

Era la parte que más me importaba, porque es el modo de fallo que buscaba en la primera vuelta.
Muté el test, no el código: `CANDIDATOS_GRANDES` de **150.000 a 50**, para que la sentencia de A
termine antes de que el competidor commitee.

**Los dos casos del modo 2 se ponen ROJOS, no pasan por vacío:**

```
x  R5: una fila que otro worker ya reclamo Y COMMITEO no se entrega por segunda vez
x  una fila re-agendada con backoff por otro worker no se reclama antes de tiempo
   LA VENTANA NO SE ABRIO — A: (3 ms), commit del competidor: +33 ms.
   El competidor commiteo DESPUES de que A terminase, asi que la carrera no se ejercio.
   Sube CANDIDATOS_GRANDES (hoy 50).
```

Con el corpus real: A dura 123–151 ms y el competidor commitea a los ~40 ms, o sea ~100 ms de
holgura, y la comprobación `tCommitB < tFinA` lo certifica **en cada corrida**. No es una promesa
del comentario: es una aserción.

**Detalle que vale la pena conocer** (no es un defecto, es cómo se comporta el mecanismo): con la
mutación (a) —que devuelve el `ORDER BY` global y con él la capacidad de cortar el escaneo en
`limit` filas— la sentencia baja de ~130 ms a ~28 ms, la ventana se cierra y los casos del modo 2
caen con `LA VENTANA NO SE ABRIO` en vez de con `DOBLE ENTREGA`. **Siguen rojos**, que es lo que
importa; sólo cambia el mensaje. El sistema es coherente: si la sentencia se acelera, el test avisa
de que ya no está midiendo la carrera, en vez de mentir.

### Estabilidad: 13 corridas verdes, cero flakes

| Qué | Resultado |
| --- | --- |
| Archivo de concurrencia, 8 corridas seguidas | **8 verdes / 0 rojas**, `Tests 5 passed (5)`, 4,9–5,6 s cada una |
| Los tres archivos de la ficha, 3 corridas mas 1 verbose | verdes, `Tests 27 passed (27)`, 3,6 s |
| Dentro del gate | `job-repository-claim-concurrente.int.test.ts (5 tests) 3718ms` |

El retardo del competidor se calibra con lo que tardó el ensayo (`msDelClaim * 0.3`), no con un
número fijo, así que en una máquina más lenta la ventana se ensancha y el retardo la sigue.
**Riesgo residual, y va en la dirección correcta:** si la máquina se carga entre el ensayo y la
carrera, el caso puede salir rojo con `LA VENTANA NO SE ABRIO`. Es un falso ROJO con instrucciones,
no un falso verde. Es el intercambio que hay que querer.

### Lo que además comprobé del test nuevo

- **Los objetivos no se calculan con un SQL escrito a mano.** El `beforeAll` hace un ensayo con
  `JobRepository.claimBatch` REAL y lo revierte: se mide contra las filas que elige la sentencia de
  producción, no contra un orden inventado. Es el patrón «aserción contra su propia fuente»
  evitado bien.
- **El competidor del caso del backoff usa `repo.fail` REAL**, no un `UPDATE` a mano: si el backoff
  cambiara de forma, el test lo seguiría.
- **`restaurarObjetivos()` devuelve el corpus a su estado inicial antes de cada carrera**, así que
  el segundo caso no mide los restos del primero — el competidor commitea de verdad y eso deja
  huella.
- **`expect(idsA).toEqual(objetivos.slice(ROBADAS))`**: no se conforma con «no hay repetidas»
  (cierto por vacío si A devolviera cero); exige exactamente las que el competidor no tocó.
- **El modo 1 ya no depende del orden entre casos**: cada caso corre su propio solape. Cierra el
  menor 3.

## BLOQUEANTE 2 — CERRADO. El design ya no puede reintroducir el fallo

Comparé el bloque SQL del `design.md` §1 contra el `$queryRaw` real, línea a línea: **coinciden**,
predicado incluido, marcado `OBLIGATORIO, no es redundante`. Y alrededor hay ahora:

- la sección **«Por qué el predicado de candidato se REPITE en `bloqueados`»**, con el mecanismo de
  EvalPlanQual explicado, **mis números medidos** pegados (SIN el predicado: reclamó 5, la misma
  fila dos veces; CON el predicado: reclamó 4) y la escala de la ventana (20k a 30 ms; 60k a 97 ms;
  150k a 252 ms; 300k a 436 ms);
- el agravante que faltaba: **la exposición crece con la saturación**, o sea que la carrera es más
  probable justo en el escenario que la ficha atiende;
- el punto 2 de «Garantías conservadas» corregido: `SKIP LOCKED` **sólo cubre uno de los dos modos**
  de competencia, y el otro lo sostiene el predicado;
- una frase dirigida a quien lo lea mañana: las tres CTEs no se colapsan y **el predicado no se
  borra por «duplicado»**, con la ruta del test que lo prueba;
- **el efecto del solape sube al design**, con el razonamiento de autocommit completo (los cuatro
  puntos) y la advertencia de que la propiedad «cada worker se lleva N libres» dejó de ser cierta.

Respuesta a la pregunta que se me hizo: **no, quien lea ese design mañana no puede reintroducir el
fallo creyendo que alinea el código con la especificación.** El SQL del design ES el del código, el
predicado lleva el aviso pegado, y si aun así alguien lo borrara, los dos casos del modo 2 se lo
dicen con nombre y apellidos.

*Nit sin consecuencia, no pido cambio:* el `candidatos` del design lista
`SELECT "id", "tipo", "run_after"` y el código sólo `"id", "run_after"`. Da igual —`PARTITION BY
"tipo"` no necesita proyectar la columna— y copiar el design tampoco rompería nada.

## BLOQUEANTE 3 — CERRADO

`tasks.md`: **15 casillas, las 15 en `[x]`, ninguna sin marcar.** T1–T12 de la primera vuelta más
un grupo nuevo: T13 (test del competidor commiteado), T14 (design §1) y T15 (menores). Ahora el
checkpoint es verificable.

## Los menores

| # | Qué pedí | Qué hizo | Mi lectura |
| --- | --- | --- | --- |
| **1** | separar el `toEqual` de `jobsB` de la aserción de R5 | Lo movió a su propio caso, `bajo solape, el segundo lote viene INCOMPLETO — el precio de fijar los ids antes de bloquear`, con el porqué y con el «en producción no muerde» | **De acuerdo con él, y tiene razón en no borrarlo.** Ese literal **es contrato**, no polizón: fija un efecto que ahora está declarado en `design.md` §1. Borrarlo dejaría el cambio de comportamiento sin nadie que lo vigile; cambiarlo por su propia fuente lo dejaría siempre verde. En su propio caso y con ese nombre ya no se lee como si fuera R5. **Cerrado.** |
| **2** | esquemas huérfanos | `barrerHuerfanos()` al arrancar, **por EDAD** (sello de tiempo en el nombre, más de 1 h), no por prefijo | **Mejor que lo que pedí.** Un barrido por prefijo se llevaría el esquema de otro archivo corriendo en paralelo, que es el modo de fallo caro. Los nombres del formato viejo se quedan (el `parseInt` da NaN y se saltan): deuda inocua, y está dicho. **Cerrado.** |
| **3** | orden implícito entre los dos casos | Cada caso del modo 1 corre su propio solape | **Cerrado.** |
| **4** | `.env` copiado | Gate corrido exportando `DATABASE_URL` | **Cerrado, y con la prueba en el log**: `DATABASE_URL resuelta: los 147 archivos ... SI se ejecutan` conviviendo con `no hay .env`. Reproducido por mí, idéntico. |
| **5** | cifra rancia (77) | `docs/verification.md` a **147**, con la fecha, el valor anterior y la advertencia de que **esta cifra caduca** y la buena es la que imprime el gate | **Cerrado, y bien resuelto**: no se limita a cambiar el número, avisa de que el número no es la fuente. |

## Gate, reproducido por mí sobre `c19f4011`

| Qué | Resultado |
| --- | --- |
| `./init.sh --rapido` (con `DATABASE_URL` exportada, sin `.env`) | **`INIT_EXIT=0`**, `== init OK ==` |
| Relacionados | `Test Files 438 passed (438)` · `Tests 6210 passed | 17 skipped (6227)` |
| Guardias | `Test Files 198 passed (198)` · `Tests 2952 passed (2952)` |
| Veredicto de baseline | `sin rojos nuevos (0 archivo(s) rojo(s) sobre 629 ejecutado(s))` |
| Saltados | **17 casos, los 17 en `AnaliticaPage.test.tsx`** (ajenos). **Cero archivos saltados.** |
| Los 3 de la ficha | ejecutados: `claim-concurrente (5 tests) 3718ms`, `reparto-por-tipo (9 tests) 764ms`, `job-queue-service (13 tests) 10ms` |
| Residuos en la base local | **ninguno**: cero esquemas `t402_*`, `public."jobs"` sigue con 74 filas |

## CHECKPOINTS, lo que cambia respecto a la primera vuelta

- [x] `tasks.md` con todas las tasks marcadas `[x]` — **ahora sí** (15/15).
- [x] Cada `R<n>` mapea a un test que lo verifica — **R5 ya cubre sus dos modos de competencia**.
- [x] `design.md` describe lo que se construyó, sin trampa para el siguiente.
- [x] `progress/review_402.md` existe y su veredicto es **OK**.
- [ ] Entrada en `progress/history.md`: sigue pendiente, **corresponde al cierre de la ficha**, no
      al implementer de esta vuelta.

Todo lo demás del checklist de la primera vuelta sigue igual y sigue verde: sin migración, sin
tabla nueva, sin secretos, capas intactas y sin hardcode de contexto (el `lib/` no se tocó).

## Veredicto final

**APROBADA.** No queda ningún bloqueante ni ninguna reserva.

El reparto por turnos era correcto desde la primera vuelta; lo que faltaba era que alguien pudiera
romperlo sin que nadie se enterara, y eso se acabó: **las dos mutaciones de una línea que devolvían
la doble entrega hoy mueren, cada una en su propio caso y con su propio mensaje**, el mecanismo que
impide el falso verde está saboteado y comprobado, el test es estable en 13 corridas, y el
`design.md` ya no le tiende una trampa al siguiente que lo lea.

Queda para el cierre de la ficha, como siempre: la entrada en `progress/history.md` y el paso a
`done` en `feature_list.json`.
