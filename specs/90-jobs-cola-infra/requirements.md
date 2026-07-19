# Feature 90 — Infraestructura de cola de background jobs (requirements)

> **Alcance (solo esto):** infraestructura genérica de una cola de background jobs en
> Postgres (patrón *transactional-outbox* + worker), drenada por un Vercel Cron cada
> minuto, MÁS la migración del cron diario `liberar-reprogramadas` (feature 46) a un job
> recurrente sobre esa cola.
>
> **Fuera de alcance:** geocodificación Google (feature 91) y webhooks salientes / outbox
> en `appendCambioEstado` (feature 92). Se mencionan solo como *features siguientes que
> consumirán esta infraestructura*. Tampoco se toca la carga masiva (sigue con chunking en
> cliente) ni se migran los crons `corte-diario` / `generar-gastos-fijos` (quedan como
> están; su migración es seguimiento posterior).

Notación EARS. Cada `R<n>` es testeable y trae su mapeo a test propuesto (el implementer lo
concreta en `progress/impl_90.md`).

---

## Modelo de datos y migración

- **R1 (Ubicuo).** El sistema DEBE persistir cada background job como una fila de la tabla
  `jobs` (`@@map("jobs")`) con al menos: `id`, `tipo` (enum nativo Postgres `job_tipo`),
  `payload` (JSONB), `estado` (enum nativo Postgres `job_estado`), `intentos`,
  `max_intentos`, `run_after`, `locked_at` (nullable), `last_error` (nullable),
  `dedupe_key` (nullable), `created_at`, `updated_at`.
  *Test:* integración DB — insertar una fila y leerla verifica columnas, tipos y defaults
  (`estado='pending'`, `intentos=0`, `run_after=now()`).

- **R2 (Ubicuo).** El estado de un job DEBE pertenecer al enum cerrado
  `{ pending, processing, done, failed }` y el tipo al enum cerrado `{ liberar_reprogramadas }`,
  ambos declarados como enums NATIVOS de Postgres con `@@map` (`job_estado`, `job_tipo`),
  ampliables por `ALTER TYPE ... ADD VALUE` en features 91/92.
  *Test:* integración DB — insertar un `estado`/`tipo` fuera del enum falla (error de tipo
  Postgres); el schema Prisma declara ambos enums con `@@map`.

- **R3 (Ubicuo).** La tabla `jobs` DEBE tener un índice PARCIAL sobre `(run_after)` con
  predicado `WHERE estado = 'pending'`, para que la selección de trabajo pendiente vencido
  no escanee filas ya procesadas.
  *Test:* integración DB — `pg_indexes` (o `EXPLAIN`) confirma el índice parcial existe con
  el predicado esperado.

- **R4 (Ubicuo).** La tabla `jobs` DEBE imponer unicidad de `dedupe_key` mediante un índice
  ÚNICO PARCIAL con predicado `WHERE dedupe_key IS NOT NULL`, de modo que múltiples filas
  con `dedupe_key = NULL` coexistan pero no puedan repetirse dos filas con la misma clave no
  nula.
  *Test:* integración DB — dos inserts con el mismo `dedupe_key` no nulo: el segundo viola la
  unicidad; dos inserts con `dedupe_key NULL` conviven.

- **R5 (Ubicuo).** La tabla `jobs` DEBE tener Row Level Security habilitada SIN policies (solo
  service role), siguiendo el patrón de `api_key` / `wallet_movimiento` / `premio_ranking`.
  *Test:* integración DB — `pg_class.relrowsecurity` es `true` para `jobs` y no existen
  policies asociadas.

- **R6 (Ubicuo).** La migración Prisma nueva DEBE ser versionada y reversible: incluye
  `migration.sql` (UP) y `down.sql` (DOWN) que revierte exactamente lo creado (tabla `jobs`,
  índices, RLS y los dos enums nativos), ejecutable por `pnpm run db:rollback`.
  *Test:* integración DB — aplicar UP y luego DOWN deja el schema sin la tabla `jobs` ni los
  enums `job_tipo`/`job_estado`; `down.sql` existe en la carpeta de la migración.

---

## Encolado (enqueue)

- **R7 (Por evento).** CUANDO se encola un job, el sistema DEBE insertar una fila con
  `estado = 'pending'`, `intentos = 0` y el `run_after` indicado (por defecto `now()`).
  *Test:* unit repo con fake / integración DB — `enqueue` produce una fila `pending` con los
  valores por defecto.

- **R8 (Condicional / idempotencia).** SI se encola un job con un `dedupe_key` que ya existe
  en una fila, ENTONCES el sistema DEBE NO crear una fila nueva (`ON CONFLICT (dedupe_key)
  DO NOTHING`) y NO fallar la operación.
  *Test:* integración DB — dos `enqueue` con el mismo `dedupe_key` dejan exactamente una fila.

- **R9 (Opcional).** DONDE el `enqueue` recibe una transacción externa (`tx`), el sistema DEBE
  ejecutar la inserción dentro de esa transacción (soporte transactional-outbox para features
  91/92), sin abrir una transacción propia.
  *Test:* unit repo con fake de `Pick<PrismaClient,...>` — `enqueue(tipo,payload,opts,tx)` usa
  el `tx` provisto y no `this.prisma`.

---

## Claim atómico (worker)

- **R10 (Por evento).** CUANDO el worker reclama un lote de tamaño `limit`, el sistema DEBE
  seleccionar y bloquear las filas candidatas con `FOR UPDATE SKIP LOCKED` dentro de una única
  sentencia atómica, marcándolas `estado = 'processing'`, fijando `locked_at = now()` e
  incrementando `intentos`, devolviendo exactamente las filas reclamadas.
  *Test:* integración DB — `claimBatch(n)` sobre N pendientes devuelve N filas en `processing`
  con `intentos` incrementado y `locked_at` no nulo.

- **R11 (De estado / anti doble-procesamiento).** MIENTRAS dos workers reclaman
  concurrentemente, el sistema DEBE garantizar que ninguna fila sea entregada a más de un
  worker (efecto de `SKIP LOCKED`).
  *Test:* integración DB — dos `claimBatch` concurrentes sobre el mismo conjunto no devuelven
  ninguna fila en común (unión disjunta).

- **R12 (Condicional).** SI el `run_after` de un job pendiente es futuro respecto al reloj de
  la corrida, ENTONCES el sistema DEBE NO reclamarlo.
  *Test:* integración DB — un job `pending` con `run_after` en el futuro no aparece en el
  resultado de `claimBatch`.

- **R13 (Condicional / visibility timeout).** SI un job quedó en `estado = 'processing'` con
  `locked_at` más antiguo que `JOBS_VISIBILITY_TIMEOUT_MS`, ENTONCES el worker DEBE poder
  re-reclamarlo (rescate de jobs muertos por crash), reincrementando `intentos` y refrescando
  `locked_at`.
  *Test:* integración DB — un job `processing` con `locked_at` vencido es reclamado de nuevo;
  uno con `locked_at` reciente NO.

---

## Reintentos, backoff y dead-letter

- **R14 (Por evento).** CUANDO un job se ejecuta con éxito, el sistema DEBE marcarlo
  `estado = 'done'`.
  *Test:* unit service con handler fake ok + integración DB — `complete(id)` deja la fila en
  `done`.

- **R15 (Por evento).** CUANDO un job falla y `intentos < max_intentos`, el sistema DEBE
  re-agendarlo (`estado = 'pending'`) con `run_after = now() + backoff` y registrar
  `last_error` (texto acotado, sin secretos ni PII), donde
  `backoff = min(JOBS_BACKOFF_CAP_MS, JOBS_BACKOFF_BASE_MS * 2^(intentos-1))` (backoff
  exponencial acotado por el cap).
  *Test:* unit service — para intentos 1,2,3 el `runAfter` calculado corresponde a
  `base*2^(n-1)` saturado en `cap`; `last_error` no contiene el `CRON_SECRET`.

- **R16 (Condicional / dead-letter).** SI un job falla y `intentos >= max_intentos`, ENTONCES
  el sistema DEBE marcarlo `estado = 'failed'` (dead-letter) sin re-agendar reintentos.
  *Test:* unit service / integración DB — al superar `max_intentos`, `fail(...)` deja la fila
  en `failed`.

---

## Drenado (Controller / cron)

- **R17 (De estado).** MIENTRAS el secreto de cron no esté configurado, o el token `Bearer`
  del request esté ausente o no coincida con `CRON_SECRET`, el endpoint de drenado DEBE
  responder `401` SIN producir ningún efecto (no se reclama ni ejecuta ningún job, ni se
  construye el service real).
  *Test:* route test (clon de `corte-diario-route.test.ts`) — sin header / token incorrecto /
  secreto null → 401 y el spy del service NO se invoca.

- **R18 (Por evento).** CUANDO el endpoint de drenado recibe un token válido, el sistema DEBE
  drenar hasta `JOBS_BATCH_SIZE` jobs y responder `200` con un JSON de conteos agregados
  (p. ej. `procesados`, `ok`, `fallidos`, `reintentados`, `muertos`) SIN PII ni secretos.
  *Test:* route test con service fake — token válido → 200 con conteos; el cuerpo no contiene
  el secreto ni datos de dominio/PII.

- **R19 (Condicional).** SI el service lanza durante el drenado, ENTONCES el endpoint DEBE
  responder un error controlado (`>= 500`, vía `withErrorHandler`/`appErrorToResponse`) sin
  filtrar el secreto ni PII.
  *Test:* route test — service que lanza → status ≥ 500 y el cuerpo no contiene el secreto.

- **R20 (Ubicuo).** `vercel.json` DEBE incluir un cron `{ path: "/api/cron/procesar-jobs",
  schedule: "* * * * *" }` (único disparador temporal del drenado) y DEBE NO incluir ya la
  entrada de `/api/cron/liberar-reprogramadas`.
  *Test:* config test (clon del bloque "schedule del cron" de `corte-diario-route.test.ts`) —
  parsea `vercel.json`: `procesar-jobs` presente con `* * * * *`; `liberar-reprogramadas`
  ausente de `crons`.

- **R21 (Ubicuo).** Todos los parámetros de la cola (`JOBS_BATCH_SIZE`, `JOBS_MAX_ATTEMPTS`,
  `JOBS_BACKOFF_BASE_MS`, `JOBS_BACKOFF_CAP_MS`, `JOBS_VISIBILITY_TIMEOUT_MS`) DEBEN resolverse
  por variable de entorno con defaults sensatos (visibility timeout por defecto = 1 h); el
  secreto de autorización reutiliza `CRON_SECRET`. Ningún valor se hardcodea.
  *Test:* unit config — `loadJobsConfig()` lee cada env y aplica el default cuando falta;
  default de visibility = 3 600 000 ms.

---

## Job recurrente `liberar_reprogramadas`

- **R22 (Ubicuo / reuso).** El handler `liberar_reprogramadas` DEBE delegar TODA la lógica de
  negocio en `LiberacionReprogramadaService.ejecutarLiberacion(...)`, sin reescribir ni
  duplicar la lógica de liberación.
  *Test:* unit — el handler invoca `ejecutarLiberacion` una vez con el argumento esperado
  (fecha CR derivada de `startOfDayCR`); no reimplementa la clasificación de bodega.

- **R23 (Por evento / recurrencia en éxito).** CUANDO el job `liberar_reprogramadas` termina
  con éxito, el sistema DEBE re-agendar su próxima ocurrencia (nueva fila) con
  `run_after` = próxima corrida CR y `dedupe_key = "liberar_reprogramadas:<YYYY-MM-DD CR>"` de
  esa próxima corrida.
  *Test:* unit service — tras éxito se llama a `enqueue` con el `dedupe_key` de la fecha CR
  siguiente y el `run_after` esperado.

- **R24 (Condicional / recurrencia en fallo terminal).** SI el job `liberar_reprogramadas`
  llega a fallo terminal (dead-letter), ENTONCES el sistema DEBE igualmente re-agendar la
  próxima ocurrencia, para que un fallo puntual NO detenga el job diario para siempre.
  *Test:* unit service — con un handler que lanza y agota `max_intentos`, se re-agenda la
  próxima ocurrencia (además de marcar la fila actual `failed`).

- **R25 (De estado / idempotencia de recurrencia).** MIENTRAS ya exista una fila pendiente
  para una fecha CR dada, el re-agendado de la próxima ocurrencia DEBE NO crear un duplicado
  (garantizado por el `dedupe_key` por día CR y `ON CONFLICT DO NOTHING`).
  *Test:* integración DB — dos re-agendados para la misma fecha CR dejan una sola fila
  pendiente para ese día.

- **R26 (Ubicuo / seed inicial idempotente).** El sistema DEBE proveer un seed inicial
  idempotente que siembre la PRIMERA fila `liberar_reprogramadas` sin duplicar si ya existe
  (por su `dedupe_key`).
  *Test:* integración DB — ejecutar el seed dos veces deja exactamente una fila para la fecha
  CR sembrada.

- **R27 (Ubicuo).** La ruta `/api/cron/liberar-reprogramadas` DEBE conservarse como disparo
  MANUAL on-demand (misma autorización `Bearer` vs `CRON_SECRET`, misma respuesta de conteos),
  perdiendo únicamente su `schedule` en `vercel.json`.
  *Test:* los tests existentes de la ruta siguen pasando (401 sin efectos, 200 con conteos);
  R20 cubre la ausencia de su schedule.

---

## Trazabilidad (resumen)

| Requisito | Tipo de test |
|-----------|--------------|
| R1, R2, R3, R4, R5, R6 | integración DB (schema/migración) |
| R7 | unit repo / integración DB |
| R8 | integración DB |
| R9 | unit repo (fake tx) |
| R10, R11, R12, R13 | integración DB (claim/SKIP LOCKED/visibility) |
| R14 | unit service + integración DB |
| R15, R16 | unit service (backoff/dead-letter) |
| R17, R18, R19 | route test (clon corte-diario) |
| R20 | config test (vercel.json) |
| R21 | unit config |
| R22, R23, R24 | unit service/handler |
| R25, R26 | integración DB |
| R27 | route test existente + R20 |

---

## Decisiones del gate F1.4 (RESUELTAS por el humano 2026-07-19)

1. **Horario del job recurrente → PRESERVAR 00:00 CR** (comportamiento actual de la feature 46;
   `run_after` de la próxima corrida = próximo 00:00 America/Costa_Rica = 06:00 UTC). No se mueve
   a 01:00 CR. Afecta el cálculo de `run_after` en R23 y el handler §5.
2. **`max_intentos` → POR-FILA desde config, con override por tipo.** `enqueue` rellena
   `max_intentos` desde `JOBS_MAX_ATTEMPTS` por defecto, pero acepta override por tipo de job
   (flexible para 91/92). La columna `max_intentos` de la fila es la fuente de verdad en el
   momento del `fail` (R15/R16).
3. **`payload` de `liberar_reprogramadas` → DERIVAR de `now` al ejecutar** (payload vacío `{}`);
   el handler usa `startOfDayCR(now)`. Igual que hoy; idempotente por día CR (R22).
4. **Ruta manual `liberar-reprogramadas` → CONSERVAR** como disparo manual on-demand (R27), sin
   cambio de código; solo pierde su `schedule` en `vercel.json`.
5. **Contrato de conteos de `procesar-jobs` → FIJADO** en `{ procesados, ok, fallidos,
   reintentados, muertos }` (R18), sin PII.
