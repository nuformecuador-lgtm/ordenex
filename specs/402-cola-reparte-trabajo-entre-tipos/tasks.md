# Feature 402 — La cola reparte el trabajo entre tipos (tasks)

> Checklist para el implementer. Cada task indica dependencias y criterio de "hecho".
> `[P]` = paralelizable respecto a las demás tasks marcadas `[P]` en su mismo grupo.
> Archivos tocados: SOLO `lib/repositories/JobRepository.ts`,
> `lib/services/JobQueueService.ts`, y tests nuevos/actualizados bajo `tests/`. Ninguna
> migración, ningún cambio en `db/schema.prisma`, `lib/types/` ni configuración de build —
> el gate de este cambio es `./init.sh --rapido` (ver `docs/verification.md`), salvo que el
> implementer descubra lo contrario al tocar el código real.

---

### Grupo 1 — Tests que fijan el reparto por turnos (ROJOS antes del cambio)

- [x] **T1 [P] — Test de reparto por turnos e incidente reproducido (R1, R3).**
  Nuevo archivo `tests/integration/db/job-repository-reparto-por-tipo.int.test.ts`, patrón
  `tests/integration/db/_postgres-real.ts` (`HAY_BASE_DE_DATOS`, `crearPrismaDeTest`,
  `enTransaccionRevertida`) — la suite se salta entera sin Postgres alcanzable, no falla en
  verde falso. Sembrar candidatos `pending` vencidos de 4 tipos distintos en cantidades
  desiguales (una réplica reducida y CONTROLADA de las proporciones del incidente: un tipo
  con muchos más candidatos que los demás, sin depender de desempates por timestamp
  ambiguos) y llamar a `JobRepository.claimBatch(limit, { now, visibilityCutoff })` real
  contra Postgres, dentro de la transacción revertida.
  **Hecho cuando:** el test compila y describe exactamente la composición esperada por tipo
  del lote reclamado; corre en ROJO contra la implementación actual (`ORDER BY run_after ASC`
  puro, sin partición por tipo) — confirma que expone el defecto.
  Depende de: nada.

- [x] **T2 [P] — Test de "un solo tipo activo" y orden intra-tipo (R2, R4).**
  Mismo archivo de T1 (u otro `describe` en él). Dos casos: (a) sembrar un ÚNICO tipo con más
  candidatos que `limit` y confirmar que el lote reclamado usa el `limit` entero, todos de ese
  tipo; (b) sembrar un tipo minoritario de 1 candidato junto a un tipo mayoritario de varios,
  con `run_after` distintos y verificables, y confirmar que dentro del tipo mayoritario el
  orden de reclamo sigue siendo `run_after` ascendente.
  **Hecho cuando:** ambos casos pasan en VERDE contra la implementación ACTUAL (no debe
  romperse: son casos de no-regresión) y siguen en verde tras T3.
  Depende de: nada (paralelizable con T1).

---

### Grupo 2 — Cambio del repositorio

- [x] **T3 — Reescribir la sentencia de `JobRepository.claimBatch`.**
  En `lib/repositories/JobRepository.ts`: reemplazar el `$queryRaw` de una CTE
  (`ORDER BY run_after ASC ... FOR UPDATE SKIP LOCKED LIMIT`) por la versión de tres CTEs de
  design.md §1 (`candidatos` con `ROW_NUMBER() OVER (PARTITION BY tipo ORDER BY run_after
  ASC)`, `priorizados` con `ORDER BY turno, run_after LIMIT $limit`, `bloqueados` con
  `FOR UPDATE OF j SKIP LOCKED`) más el `UPDATE ... FROM bloqueados` final. La firma
  `claimBatch(limit: number, opts: ClaimOpts): Promise<JobDTO[]>` y el `toDTO` NO cambian.
  Actualizar el comentario de cabecera del método para describir el reparto por turnos (sigue
  citando `design.md §3.1` de la 90 para lo que se conserva, y añade la referencia a
  `specs/402-.../design.md §1`).
  **Hecho cuando:** T1 y T2 pasan en VERDE contra Postgres real.
  Depende de: T1, T2.

---

### Grupo 3 — No regresión de garantías de la feature 90 (con tipos mixtos)

- [x] **T4 [P] — Test de concurrencia con tipos mixtos (R5).**
  Sembrar candidatos de 3 tipos distintos; lanzar 2 `claimBatch` concurrentes (mismo patrón
  de concurrencia usado para R11 en la feature 90 — localizar y clonar si existe un test
  dedicado, o construirlo del mismo modo que T1: 2 llamadas `Promise.all` sobre la misma
  transacción/conexión de test). Verificar que la unión de ids reclamados por ambas llamadas
  es disjunta (ningún id repetido).
  **Hecho cuando:** pasa en VERDE tras T3.
  Depende de: T3.

- [x] **T5 [P] — Test de visibility timeout con tipos mixtos (R6).**
  Sembrar un `processing` colgado (`locked_at` anterior al `visibilityCutoff`) de tipo A y
  varios `pending` vencidos de tipo B, con un `limit` que no alcance para todos. Confirmar que
  el rescatado de A ocupa su turno igual que si fuera un `pending` vencido de A (no queda
  sistemáticamente último ni sistemáticamente primero por su origen).
  **Hecho cuando:** pasa en VERDE tras T3.
  Depende de: T3.

- [x] **T6 [P] — Test de "una sola sentencia" (R7).**
  Usar `crearPrismaDeTestConEspia` (`tests/integration/db/_postgres-real.ts`) para contar los
  eventos de query emitidos por UNA llamada a `claimBatch`. Confirmar que sigue siendo
  exactamente 1 evento (no se coló una segunda consulta al introducir las CTEs adicionales).
  **Hecho cuando:** pasa en VERDE tras T3.
  Depende de: T3.

- [x] **T7 [P] — Test de genericidad ante un tipo nuevo del enum (R9).**
  Sembrar candidatos usando un `JobTipo` de los añadidos DESPUÉS de la feature 90 (p. ej.
  `analitica_invalidacion_cache` o `whatsapp_chat_envio`) junto a otro tipo cualquiera.
  Confirmar que participa del reparto por turnos igual que los demás, SIN que este test
  requiera ningún cambio adicional en `JobRepository.ts` más allá de T3.
  **Hecho cuando:** pasa en VERDE tras T3.
  Depende de: T3.

---

### Grupo 4 — Diagnóstico (R8)

- [x] **T8 [P] — Extender `JobsLogger` con `info` opcional.**
  En `lib/services/JobQueueService.ts`: añadir `info?(message: string): void` a la interfaz
  `JobsLogger` (OPCIONAL — ver design.md §3 "por qué opcional"). No tocar `defaultLogger` más
  allá de, opcionalmente, añadirle `info: (m) => console.info(m)`.
  **Hecho cuando:** el typecheck sigue en VERDE en TODOS los archivos que hoy instancian
  `JobQueueService` con un logger fake `{ warn: () => {} }` (listados en design.md §3) — no se
  toca ninguno de esos archivos.
  Depende de: nada (paralelizable con el Grupo 1/2/3).

- [x] **T9 — Test rojo del log de diagnóstico (R8).**
  En `tests/unit/services/job-queue-service.test.ts`: nuevo `describe` con un logger fake que
  además implementa `info` (spy). Casos: (a) `drenar` con jobs reclamados de 2 tipos distintos
  → `logger.info` fue llamado con un mensaje que contiene el desglose `{tipo: cantidad}`
  esperado (parsear el JSON del mensaje, no comparar el string exacto, para no acoplarse al
  formato de texto); (b) `drenar` con lote vacío (`claimBatch` devuelve `[]`) → `logger.info`
  NO fue llamado.
  **Hecho cuando:** el test compila y corre en ROJO (el desglose todavía no se calcula).
  Depende de: T8.

- [x] **T10 — Implementar el desglose por tipo en `drenar`.**
  En `JobQueueService.drenar`, tras `const jobs = await this.repo.claimBatch(...)`: si
  `jobs.length > 0`, agrupar por `job.tipo` (sin consulta adicional, el array ya está en
  memoria) y llamar a `this.logger.info?.(...)` con el desglose (design.md §3). Sin `payload`
  ni ningún campo de dominio en el mensaje.
  **Hecho cuando:** T9 pasa en VERDE.
  Depende de: T8, T9.

---

### Grupo 5 — Cierre

- [x] **T11 — Trazabilidad (`progress/impl_402.md`).**
  Documentar el mapa `R<n>` → test concreto (ruta de archivo + nombre del `describe`/`it`)
  para R1-R9, siguiendo el formato que `docs/specs.md` exige para que el reviewer lo verifique.
  **Hecho cuando:** las 9 filas están completas con rutas reales (no genéricas) a tests que
  YA pasan.
  Depende de: T1-T10.

- [x] **T12 — Gate.**
  Correr `./init.sh --rapido`. El diff de esta ficha toca únicamente
  `lib/repositories/JobRepository.ts`, `lib/services/JobQueueService.ts` y tests — ninguno de
  los disparadores del gate completo (migraciones, `db/schema.prisma`, `lib/types/`,
  configuración de build, archivos "de dinero"). Si al implementar aparece un cambio fuera de
  esa lista, reevaluar si el modo rápido sigue aplicando (`CLAUDE.md`, regla 5).
  **Hecho cuando:** el gate termina en verde con `INIT_EXIT=0` explícito en el log (no un
  `echo` que lo tape).
  Depende de: T1-T11.

---

### Grupo 6 — Correcciones del review (`progress/review_402.md`, RECHAZADO)

Añadidas DESPUÉS de la revisión. No estaban en el plan original y por eso van aquí, con su
propio criterio de hecho: el spec tiene que reflejar el trabajo real, no el previsto.

- [x] **T13 — Test de comportamiento del competidor que YA COMMITEÓ (bloqueante 1).**
  El reviewer demostró que la carrera snapshot→bloqueo SÍ se puede provocar de forma
  determinista (ensanchándola con un corpus grande), y que dos mutaciones de una línea dentro
  del `WHERE` de `bloqueados` —`locked_at < cutoff` → `IS NOT NULL` y `run_after <= now` →
  `IS NOT NULL`— restauraban la doble entrega **sobreviviendo a la suite entera**, incluida la
  aserción de FORMA de R7. Dos casos nuevos en
  `tests/integration/db/job-repository-claim-concurrente.int.test.ts` ("modo 2"): el competidor
  reclama y commitea; y el competidor falla y re-agenda con backoff.
  **Hecho cuando:** las dos mutaciones MUEREN (criterio objetivo del reviewer), la ventana de la
  carrera se comprueba en el propio test (si no se abrió, el caso falla diciéndolo, en vez de
  pasar por vacío) y `JobRepository.ts` NO se toca.
  Depende de: T3.

- [x] **T14 — `design.md` §1 corregido (bloqueante 2).**
  La sentencia del design mostraba `bloqueados` sin el predicado repetido: documentaba el SQL
  inseguro. Se corrige a la sentencia real, con el mecanismo (recheck de EvalPlanQual), los
  números medidos por el reviewer, la nota de que la ventana crece con el conjunto candidato
  —o sea, con la saturación— y el aviso de que ni las CTEs se colapsan ni el predicado se
  borra. Se sube también al design el efecto del lote parcial bajo solape, con el razonamiento
  de por qué no es una regresión operativa.
  **Hecho cuando:** `design.md` §1 y "Garantías conservadas" describen el código que se commiteó.

- [x] **T15 — Menores del review.**
  (a) La degradación bajo solape sale del caso de R5 y pasa a un `it` propio con su nombre;
  (b) barrido de esquemas desechables huérfanos al arrancar, **por edad** (no por prefijo a
  secas, que se llevaría el esquema de un archivo que corre en paralelo);
  (c) el tercer caso de concurrencia deja de depender del orden: corre su propio solape;
  (d) el gate se corre exportando `DATABASE_URL`, sin copiar el `.env` al worktree
  (`docs/verification.md`);
  (e) la cifra rancia de `docs/verification.md` (77 archivos contra Postgres) pasa a la medida
  de hoy (147).
  **Hecho cuando:** los cinco puntos están en el árbol y el gate sigue verde.
