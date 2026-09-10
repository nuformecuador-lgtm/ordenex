# Implementación 401 — La caída del geocodificador avisa y se recupera sola

> Rama `feat/401-geocodificador-avisa-y-se-recupera`, salida de `origin/dev` @ `7a23c0f3`.
> Spec: `specs/401-geocodificador-caido-avisa-y-se-recupera/`. El `tasks.md` mandó.

**Qué arregla, en una frase:** si el corte del 2026-09-08 se repite, sale un aviso a ~75 minutos
en vez de 19 horas, y los jobs muertos vuelven a la cola **sin que nadie abra la base de datos**.

---

## T0 — la puerta de entrada, comprobada en el archivo real

`lib/geo/fallo-config-geocode.ts` **existe** en el árbol (commit `b31ff729`, «feat(400): un fallo
de configuracion del geocodificador ya no bloquea la asignacion», dentro de `origin/dev` @
`7a23c0f3`). Exporta las tres cosas que esta ficha necesita leer:
`MARCADOR_FALLO_CONFIG_GEOCODE`, `marcarFalloConfigGeocode()` y `esFalloConfigGeocode()`.

Y `GeocodificacionService` **emite** el marcador en los dos caminos de configuración:
`GeocodeNoConfiguradoError` (credencial ausente) y `GeocodeConfigInvalidaError` (el proveedor
rechazó la petición). Comprobado leyendo el archivo, no el grafo.

**Ese marcador es la única detección de la causa en toda esta ficha.** No se ha introducido un
segundo mecanismo, y hay una guardia que lo vigila (T14).

---

## Archivos

### Creados

| Archivo | Qué es |
| --- | --- |
| `lib/config/geocode-salud.ts` | los cinco números, con sus defaults; nunca lanza |
| `lib/interfaces/repositories/IGeocodeSaludRepository.ts` | contrato estrecho y PROPIO sobre `jobs` |
| `lib/interfaces/services/IGeocodeSaludService.ts` | contrato del servicio + `geocodeSaludNoOp` |
| `lib/repositories/GeocodeSaludRepository.ts` | las dos sentencias SQL |
| `lib/services/GeocodeSaludService.ts` | la regla pura, el aviso y la recuperación |
| `db/migrations/20260910110000_jobs_geocodificacion_salud_idx/` | índice PARCIAL + su `down.sql` |
| `db/migrations/20260910120000_notificacion_evento_geocodificacion_caida/` | los 2 valores de enum + su `down.sql` |
| `tests/unit/config/geocode-salud-config.test.ts` | R29, R30 |
| `tests/unit/notificaciones/geocodificacion-caida-aviso.test.ts` | R7, R9, R10, R26, R27 |
| `tests/unit/services/geocode-salud-service.test.ts` | R1-R5, R11, R22, R24, R26 |
| `tests/unit/guards/geocode-salud-sin-prosa.guardia.test.ts` | R1, R32, R33, R34, R35 |
| `tests/integration/db/geocode-recuperacion.test.ts` | R2, R3, R15, R16, R18, R19, R21-R24 |
| `tests/integration/db/notificacion-evento-geocodificacion-caida-migration.test.ts` | R9, R10, R31 |

### Modificados

| Archivo | Qué cambia |
| --- | --- |
| `db/schema.prisma` | +2 valores de enum (`geocodificacion_caida`, `geocodificacion_caida_dia`) |
| `lib/types/notificacion.ts` | los mismos 2 valores en las uniones de dominio |
| `lib/notificaciones/emitir.ts` | `+GeocodificacionCaidaContexto`, `+textoGeocodificacionCaida`, `+emitirGeocodificacionCaida` |
| `lib/notificaciones/notificadores.ts` | `+GeocodificacionCaidaNotificador`, `+…Con`/`…Real`, `+` a la intersección del no-op |
| `lib/services/GeocodificacionService.ts` | 1 colaborador opcional (default no-op) y 3 llamadas envueltas |
| `lib/services/jobs/geocodificacion-handler.ts` | **el composition root** |
| `tests/unit/services/geocodificacion-service.test.ts` *(ext.)* | R6, R13, R14, R17, R20, R25 |
| `tests/unit/services/notificacion-notificadores-reales.test.ts` *(ext.)* | R7, R8, R11, **R12** (censo + guardia por sitio) |
| `tests/unit/services/notificacion-productores-wiring.test.ts` *(ext.)* | inventario CERRADO de eventos y entidades |

**No se tocó ninguno de éstos** (`git diff --stat` contra `7a23c0f3` sobre esas rutas: vacío):
`lib/services/JobQueueService.ts` (R32), `lib/repositories/JobRepository.ts`,
`lib/interfaces/repositories/IJobRepository.ts` (R35),
`lib/services/AsignabilidadCoordenadasService.ts` (R34), `lib/clients/google-geocode.ts` y
`lib/config/geocode.ts` (R28), `app/(app)/**`, `app/api/**`. **Cero rutas nuevas, cero Server
Actions nuevas, cero tablas y cero columnas** (R31): la única migración de estructura es el índice
parcial.

`feature_list.json` **no se toca** desde dentro de la rama.

---

## Lo que quedó CONFIGURABLE (Q2 del spec, con sus defaults)

Los cinco números viven en `lib/config/geocode-salud.ts` y salen de variables de entorno. Ausente,
vacío, no numérico, cero o negativo → default, **sin lanzar** (R30: cargarlos no puede tumbar una
corrida del drenador, que sirve a nueve tipos de job).

| Variable | Default | Papel |
| --- | --- | --- |
| `GEOCODE_CAIDA_JOBS_MINIMOS` | **3** | jobs DISTINTOS con marcador que hacen falta para avisar |
| `GEOCODE_CAIDA_VENTANA_MIN` | **60** | ventana de recencia |
| `GEOCODE_RECUPERACION_LOTE` | **5** | máximo de revividos por respuesta satisfactoria |
| `GEOCODE_RECUPERACION_ESPACIADO_MS` | **60000** | separación entre los `run_after` de una tanda |
| `GEOCODE_RECUPERACION_ENFRIAMIENTO_MIN` | **60** | intervalo mínimo antes de volver a revivir un job |

Ninguno está declarado en `.env.example` ni en Vercel: **los cinco corren hoy con su default**, que
es el punto de equilibrio calibrado en `design.md` §4 y §6. Cambiar cualquiera es una decisión de
producto, no un despliegue de código.

Q3, Q4 y Q5 se implementaron tal y como el spec propone: un aviso **por jornada CR y por rol**; un
job legado sin marcador **no se recupera solo** (medido por la 400: hoy hay cero filas así); y un
día de volumen mínimo (2 jobs) **no dispara el aviso**, con el daño acotado a 2 órdenes que la 400
ya deja asignables sin ubicación.

---

## Mapa `R<n> → test`

| R | Test que lo cubre |
| --- | --- |
| R1 | `tests/unit/services/geocode-salud-service.test.ts` › «401/R1 — el marcador de la 400 es la ÚNICA forma…» (la prosa legada SIN marcador no cuenta; el mismo texto marcado sí) + `tests/unit/guards/geocode-salud-sin-prosa.guardia.test.ts` › «401/T14 — R1: ningún predicado de esta ficha lee la PROSA del error» (6 archivos, sin `LIKE`, con contraprueba) |
| R2 | `geocode-salud-service` › «401/R2 — se cuentan JOBS DISTINTOS, no intentos» (un job con 7 intentos NO cruza; tres jobs distintos SÍ) + `tests/integration/db/geocode-recuperacion.test.ts` › «401/T7 — R2/R3: el conteo de evidencia, medido sobre el mismo `WHERE`» |
| R3 | `geocode-salud-service` › «401/R3 — matriz sobre el umbral» (0/1 no avisa, 2/7 sí; el `desde` es `ahora − 60 min` exacto; umbral configurable) + integración: contraprueba sobre la ventana |
| R4 | `geocode-salud-service` › «401/R4 — un fallo de configuración AISLADO no emite nada» y «⭑ EL OFF-BY-ONE: con `umbral − 1` ya registrados, el job EN CURSO completa la cuenta» |
| R5 | `geocode-salud-service` › «401/R5 — los fallos AJENOS a la configuración no son evidencia» (8 casos parametrizados: red, timeout, 5xx, cuota, estado desconocido, respuesta inválida, payload inválido, handler no registrado) + contraprueba del `startsWith` |
| R6 | `tests/unit/services/geocodificacion-service.test.ts` › «401/R6-R17-R25 — los desenlaces donde NO se llama a la salud, ni una vez» (6 casos parametrizados con un doble que cuenta llamadas) |
| R7 | `tests/unit/notificaciones/geocodificacion-caida-aviso.test.ts` › «401/R7 — una emisión crea EXACTAMENTE dos filas…» (**lista de roles afirmada A MANO**: `["maestro","admin"]`) + `notificacion-notificadores-reales` › «⭑ R8: el camino real crea las DOS filas…» + integración › «⭑ R7: una emisión deja DOS filas en la base» |
| R8 | `notificacion-notificadores-reales` › «401/R7-R8-R11 — camino real…»: usa `INotificacionRepository.crear`, ningún canal nuevo |
| R9 | `tests/integration/db/notificacion-evento-geocodificacion-caida-migration.test.ts` › «⭑ R9: dos emisiones el MISMO día CR dejan DOS filas en total, no cuatro», «⭑ R9 (barrera 1): leer la del `maestro` NO desactiva la guardia de la del `admin`» y «⭑ R9 (barrera 2): con la del `maestro` ya leída, el ÍNDICE ÚNICO rechaza la repetida» + `geocodificacion-caida-aviso` › «401/R9-R10 — la entidad es la JORNADA CR» |
| R10 | integración › «⭑ R10: dos jornadas CR distintas dejan CUATRO filas, aunque las de la primera sigan sin leer» + `geocodificacion-caida-aviso` › «⭑ R10: dos jornadas distintas dejan CUATRO filas» |
| R11 | `geocode-salud-service` › «401/R11 — un aviso que revienta queda registrado y NO se propaga» (notificador y repositorio) + `notificacion-notificadores-reales` › «⭑ R11: absorbe el fallo del repositorio y lo REGISTRA con contexto» + `geocodificacion-service` › «⭑ R11: con la salud LANZANDO, el `throw` del job sigue ocurriendo IGUAL» |
| R12 | `notificacion-notificadores-reales` › (a) «lib/services/jobs/geocodificacion-handler.ts inyecta el notificador real» — guardia por SITIO sobre el uso efectivo, (b) censo `SERVICES_CON_NOTIFICADOR` + «los defaults de TODOS los services del censo son el no-op» + «el censo está COMPLETO», (c) guardia derivada «cada `notificar*Real` exportado lo PASA algún fichero». **Prueba de la prueba: ver «T13» abajo, con la salida real en ROJO** |
| R13 | `geocodificacion-service` › «⭑ R13: tras un `ok` del proveedor, se invoca la recuperación exactamente UNA vez» y «⭑ R13: la recuperación va DESPUÉS de escribir la caché y la orden» |
| R14 | `geocodificacion-service` › «⭑ R14: un ACIERTO DE CACHÉ no invoca la recuperación, y el job termina igual» |
| R15 | `geocode-recuperacion` › «⭑ `pending`, `intentos = 0`, `last_error` NULO, `locked_at` NULO» y «⭑ `tipo`, `payload` y `dedupe_key` quedan IDÉNTICOS» (filas testigo antes/después) |
| R16 | `geocode-recuperacion` › «⭑ un `failed` SIN marcador y otro con la PROSA LEGADA no se tocan» (y tampoco se les toca el `updated_at`) |
| R17 | `geocodificacion-service` › «⭑ R17: los tres desenlaces DETERMINISTAS de dirección COMPLETAN el job, no lo matan» + R16 (un job sin marcador no es elegible) |
| R18 | `geocode-recuperacion` › «⭑ 25 jobs muertos con marcador + una respuesta satisfactoria → vuelven a la cola sin tocar la base a mano» |
| R19 | idem: `recuperados` es exactamente `losCincoMasViejos`, comparado por id |
| R20 | `geocodificacion-service` › «401/R20 — una recuperación caída NO revierte una geocodificación buena» (el job se completa igual + el fallo queda logueado sin PII) |
| R21 | `geocode-recuperacion` › «⭑ R21: con 25 candidatos y máximo 5, se recuperan EXACTAMENTE 5» (y 20 siguen muertos) |
| R22 | `geocode-recuperacion` › «⭑ R22: los `run_after` de la tanda están separados ≥60 s y TODOS son posteriores a la recuperación» (y son 1, 2, 3, 4 y 5 minutos) + «⭑ un espaciado configurado distinto viaja al SQL de verdad» + `geocode-salud-service` › «⭑ lote, espaciado y enfriamiento, los tres, afirmados A MANO» |
| R23 | `geocode-recuperacion` › «⭑ filas testigo comparadas ANTES y DESPUÉS: ninguna cambia» (otro tipo de job, `done`, `pending` y `processing`, todas con marcador) |
| R24 | `geocode-recuperacion` › «⭑ un job tocado hace un instante NO entra; uno anterior al enfriamiento SÍ» y «⭑ dos llamadas seguidas NO reviven a los mismos» |
| R25 | `geocodificacion-service` › «⭑ R25: durante `config_invalida` la recuperación no se invoca NI UNA VEZ» + `geocode-salud-service` › «R25: la recuperación NO se dispara desde `registrarFalloConfig`» |
| R26 | `geocodificacion-caida-aviso` › «401/R26 — sin datos personales y sin secretos» (4 casos: ni dirección/id/guía/`@`/credencial; lo único numérico es la cifra agregada; `anexo` nulo) + `geocode-salud-service` › «401/R26 — ningún log de esta ficha lleva PII ni secretos» |
| R27 | `geocodificacion-caida-aviso` › «401/R27 — lenguaje llano» (**literal completo afirmado a mano**, singular y plural; ausencia case-insensitive de «geocodifica», «config_invalida», «REQUEST_DENIED» y «API»; dice que la causa es NUESTRA) |
| R28 | `tests/unit/clients/google-geocode.test.ts` y los casos vigentes de `geocodificacion-service.test.ts` siguen verdes **sin cambios** + guardia › «⭑ el cliente HTTP del proveedor y su config no los toca nadie de esta ficha» |
| R29 | `geocode-salud-config` › «401/R29 — sin ninguna variable de entorno, los cinco defaults» (los cinco escritos a mano) |
| R30 | `geocode-salud-config` › «401/R30 — un valor ausente o inválido cae al default y NO lanza» (vacío, no numérico, cero, negativo) + el límite conocido de `parseInt` declarado |
| R31 | Revisión de alcance (`git diff --stat`, abajo): el diff no crea tabla ni columna. La única migración de estructura es el índice parcial + integración › «R31: el UP no crea tablas, no altera columnas y NO reescribe ninguna fila» y «R31: la migración del ÍNDICE no crea tabla ni columna» |
| R32 | Revisión de alcance: el diff **no toca** `lib/services/JobQueueService.ts` + guardia › «⭑ el drenador genérico no conoce esta ficha» |
| R33 | Guardia › «401/T14 — R33: esta ficha LEE el marcador; el único que lo ESCRIBE sigue siendo la 400» (ningún archivo llama a `marcarFalloConfigGeocode`; ninguno escribe `last_error` salvo para ponerlo a `NULL`; con contraprueba) |
| R34 | Revisión de alcance: el diff **no toca** `AsignabilidadCoordenadasService.ts` ni los mensajes al operador + guardia › «⭑ el gate de asignabilidad y sus mensajes al operador siguen siendo de la 400» |
| R35 | Guardia › «⭑ `IJobRepository` tiene EXACTAMENTE los métodos de siempre» (lista literal: `enqueue`, `claimBatch`, `complete`, `fail`, `findByDedupeKeys`) + «⭑ los dos métodos nuevos viven en el repositorio PROPIO y estrecho», con contraprueba del extractor |

---

## T13 — la prueba de la prueba: las guardias, VISTAS EN ROJO

Mutación aplicada: en `lib/services/jobs/geocodificacion-handler.ts`, **borrar sólo el argumento**
`notificarGeocodificacionCaidaReal` de `new GeocodeSaludService(...)`, **dejando el `import`
intacto**. Es exactamente la forma del fallo real medido en este repo el 2026-08-23 (2 de 7
notificadores muertos con la suite entera en verde).

```
 ❯ tests/unit/services/notificacion-notificadores-reales.test.ts (26 tests | 2 failed) 731ms
     × lib/services/jobs/geocodificacion-handler.ts inyecta el notificador real 9ms
     × cada `notificar*Real` exportado lo PASA algun fichero de lib/ o app/, no solo lo importa 322ms
 FAIL  … > el camino real esta CABLEADO en el composition root, no en el default >
       lib/services/jobs/geocodificacion-handler.ts inyecta el notificador real
 ❯ tests/unit/services/notificacion-notificadores-reales.test.ts:492:17
 FAIL  … > guardia derivada: ningun notificador REAL puede quedarse sin composition root >
       cada `notificar*Real` exportado lo PASA algun fichero de lib/ o app/, no solo lo importa
 ❯ tests/unit/services/notificacion-notificadores-reales.test.ts:667:21
 Test Files  1 failed (1)
      Tests  2 failed | 24 passed (26)
```

Y el diagnóstico de la guardia derivada, que nombra las dos cosas que hacen falta para arreglarlo:

```
+ [
+   {
+     "cableadoEn": [],
+     "notificador": "notificarGeocodificacionCaidaReal",
+     "soloImportadoEn": [
+       "lib/services/jobs/geocodificacion-handler.ts",
+     ],
+   },
+ ]
```

**Las dos se pusieron ROJAS.** Restaurado el argumento: `Test Files 1 passed (1) · Tests 26 passed
(26)`.

---

## Las otras cuatro mutaciones, con su rojo

Cada una se aplicó, se midió y se revirtió. Un test que sobrevive a su mutación no protege nada.

| Mutación | Dónde | Resultado |
| --- | --- | --- |
| **El umbral no avisa cuando debe**: `>=` → `>` en `hayCaida` | `lib/services/GeocodeSaludService.ts` | **ROJO**, 5 casos: «tres jobs DISTINTOS … SÍ cruzan el umbral», «con 2 otros jobs registrados, ¿avisa? true», «un umbral configurado distinto cambia el punto de corte», «la regla pura `hayCaida` es exactamente…», «⭑ EL OFF-BY-ONE…» → `Tests 5 failed | 30 passed (35)` |
| **Avisa con un fallo aislado**: `hayCaida` → `>= 1` | idem | **ROJO**, 7 casos, entre ellos «⭑ un solo job con 7 intentos fallidos con marcador NO cruza el umbral» y «⭑ con cero jobs previos, el aviso no sale» → `Tests 7 failed | 28 passed (35)` |
| **Resucita un job cuya causa era la dirección**: `estado = 'failed'` → `estado IN ('failed','done')` | `lib/repositories/GeocodeSaludRepository.ts` | **ROJO**: «⭑ filas testigo comparadas ANTES y DESPUÉS: ninguna cambia» → `Tests 1 failed | 11 passed (12)` |
| **El lote de 5 se convierte en todos de golpe**: `LIMIT` borrado | idem | **ROJO**, 4 casos: la reproducción del incidente, «R21: … se recuperan EXACTAMENTE 5», «R22: los `run_after` … separados ≥60 s» y «dos llamadas seguidas NO reviven a los mismos» → `Tests 4 failed | 8 passed (12)` |
| *(extra)* **El marcador sale del `WHERE`** de la recuperación | idem | **ROJO**: «⭑ un `failed` SIN marcador y otro con la PROSA LEGADA no se tocan» → `Tests 1 failed | 11 passed (12)` |

Tras revertirlas todas: `geocode-recuperacion` + `geocode-salud-service` → **47 passed (47)**.

---

## Migraciones, aplicadas y revertidas de verdad

Base: `prisma migrate status` dice `PostgreSQL database "ordenex", schema "public" at
"localhost:5432"` (la base local, **compartida entre worktrees**). No se leyó ni se copió el `.env`
al worktree: `DATABASE_URL` se exportó en la sesión, comprobando antes que el prefijo es
`postgres` (el `.env` la entrecomilla con comillas simples y una comilla colada haría FALLAR la
conexión en vez de saltar los tests).

- `20260910110000_jobs_geocodificacion_salud_idx` — aplicada con `prisma migrate deploy`. Su
  `down.sql` **se ejercitó de verdad** contra esa base: el índice existe → se aplica el down →
  `(NO EXISTE)` → se re-aplica el up → vuelve con su definición exacta
  (`… USING btree (estado, updated_at) WHERE (tipo = 'geocodificacion'::job_tipo)`).
- `20260910120000_notificacion_evento_geocodificacion_caida` — aplicada. Su `down.sql` **no se
  corrió con `pnpm run db:rollback`, y es deliberado**: ver la nota de entorno de abajo. Se
  ejercita entero dentro de una transacción revertida en
  `notificacion-evento-geocodificacion-caida-migration.test.ts`, incluida su precondición ruidosa
  (con una fila del evento nuevo, **aborta**) y su control positivo (sin ella, corre entero y
  `notificacion_dedupe_key` **sobrevive** con su `NULLS NOT DISTINCT` y su `WHERE` parcial).

---

## Gate

`./init.sh` **completo**, obligatorio: el diff toca `db/migrations/**`, `db/schema.prisma` y
`lib/types/**`, así que el modo rápido **se niega solo** (regla 5 de `CLAUDE.md`). Log propio de
esta sesión —`/tmp` es compartido entre worktrees y dos agentes ya se pisaron el veredicto una
vez— y `INIT_EXIT=$?` escrito **dentro** del log, sin canalizar por `tail`.

### Salida real (segunda corrida, tras arreglar los inventarios de enums)

```
✓ node v24.13.0
✓ dependencias presentes
✓ feature_list.json: sin ids duplicados (400 fichas), cupo por zona respetado (in_progress=4) y specs en su sitio
-> pnpm run typecheck            → sin salida (0 errores)
-> pnpm run lint                 → ✖ 177 problems (0 errors, 177 warnings)   ✓ lint paso
✓ DATABASE_URL resuelta: los 150 archivos de tests contra Postgres SI se ejecutan
-> pnpm run test:json

 Test Files  4 failed | 1837 passed (1841)
      Tests  6 failed | 26629 passed | 26 skipped (26661)

ROJOS NUEVOS (4 archivo(s) que no estan en el baseline):
  - tests/integration/db/notificacion-evento-bloqueo-cierre-migration.test.ts
  - tests/integration/db/notificacion-evento-dia-reparto-corregido-migration.test.ts
  - tests/integration/db/notificacion-evento-gasto-fijo-migration.test.ts
  - tests/integration/db/notificacion-evento-postulacion-recurso-migration.test.ts
✗ hay rojos NUEVOS respecto del baseline (el detalle esta justo arriba)
INIT_EXIT=1
```

**Los `skipped` son 26, y son los legítimos de siempre:** `tests/components/AnaliticaPage.test.tsx`
(58 tests, **17 skipped**) y `tests/components/AnaliticaShell.test.tsx` (15 tests, **9 skipped**).
Ajenos a esta ficha. **`integration/db` NO se saltó**: la línea del gate lo dice con su cifra
—«los **150** archivos de tests contra Postgres **SÍ** se ejecutan»— porque `DATABASE_URL` se
exportó. Los tests que prueban el `WHERE` (T7) y la dedupe (T5) **corrieron de verdad**.

### Los archivos de esta ficha, todos en VERDE dentro de esa corrida

```
✓ tests/unit/config/geocode-salud-config.test.ts (11 tests)
✓ tests/unit/notificaciones/geocodificacion-caida-aviso.test.ts (15 tests)
✓ tests/unit/services/geocode-salud-service.test.ts (35 tests)
✓ tests/unit/guards/geocode-salud-sin-prosa.guardia.test.ts (21 tests)
✓ tests/unit/services/geocodificacion-service.test.ts (46 tests)
✓ tests/unit/services/notificacion-notificadores-reales.test.ts (26 tests)
✓ tests/unit/services/notificacion-productores-wiring.test.ts (20 tests)
✓ tests/integration/db/geocode-recuperacion.test.ts (12 tests)
✓ tests/integration/db/notificacion-evento-geocodificacion-caida-migration.test.ts (25 tests)
✓ tests/integration/db/no-migration-102.test.ts (7 tests)
```

### Los 6 rojos: qué son, y por qué NO se tocan

**La primera corrida** dio `INIT_EXIT=1` con **5 archivos rojos y 11 tests**. Cinco de esos once
**eran míos**: los inventarios LITERALES de los dos enums de notificación que cada ficha de enum
tiene que ampliar a mano —es el precio que pagaron la 253, la 262, la 271 y la 333, y que se
pongan rojos ES la prueba de que el inventario sigue cerrado— más la lista de excepciones de
`no-migration-102`. Arreglados (commit `6c4aa3e1`).

**Los 6 que quedan son de la ficha 403, que corre en paralelo en otro worktree sobre esta MISMA
base local.** Los cuatro archivos fallan en la misma clase de aserción —«la base aplicada tiene
EXACTAMENTE estos valores de enum»— y el diff nombra al culpable sin ambigüedad:

```
 FAIL  …notificacion-evento-gasto-fijo-migration.test.ts > la base tiene los NUEVE eventos y los
       SIETE entidad_tipo, con el nuevo AL FINAL
- Expected
+ Received
    "gasto_fijo_cobro_pendiente",
+   "webhook_suscripcion_pausada",
    "geocodificacion_caida",
```

`webhook_suscripcion_pausada` y `webhook_suscripcion_pausa` **no existen en ningún sitio de este
árbol** salvo en `specs/403-webhook-destino-que-falla-siempre/`: no están en `db/schema.prisma`, ni
en `lib/types/notificacion.ts`, ni en `db/migrations/`. Están en la base porque el worktree de la
403 aplicó ahí sus migraciones (`prisma migrate status` las reporta como «aplicadas y ausentes del
árbol»). **Esas seis aserciones ya estaban rojas en esta base antes de mi primer commit.**

**No se añaden a `tests/baseline-rojos.json`** y no se relajan: no son deuda medida de nadie, son
un artefacto del entorno que desaparece en cuanto la 403 se mergea (y entonces sus dos valores
entran en esas listas, que es trabajo de esa ficha). Añadirlas al baseline sería exactamente el
«nunca añadas uno para pasar el gate» que el propio gate advierte.

**Los seis vuelven verdes solos contra una base sin las migraciones de la 403.** Lo comprobable
aquí y ahora es lo de arriba: el único valor inesperado es el suyo.

---

## Dos cosas del spec que no cuadraron al bajar al código

**1. El SQL de `design.md` §5.1 no corre en Postgres.** La CTE `candidatos` lleva
`row_number() OVER (…)` y `FOR UPDATE SKIP LOCKED` en la **misma** `SELECT`, y Postgres lo rechaza
en ejecución. Medido contra la base local el 2026-09-09, con la sentencia tal cual la escribe el
spec:

```
0A000 — FOR UPDATE no está permitido con funciones de ventana deslizante
```

Es la **misma** restricción que ya obligó a partir en tres el `claimBatch` de `JobRepository`
(está documentada en su propio comentario). Se implementó la forma corregida —`elegibles` con el
bloqueo y sin ventana; `candidatos` con la ventana y sin bloqueo; el `UPDATE` sobre el conjunto ya
fijado—, que **conserva íntegras las cuatro decisiones que el spec exige** (`left(...)` y no
`LIKE`, `FOR UPDATE SKIP LOCKED`, `run_after` escalonado con `row_number()`, y
`intentos`/`last_error`/`locked_at` limpios). El porqué queda escrito en el propio archivo.

**2. El caso «con la del `maestro` ya leída, una tercera emisión no crea ninguna» no es medible de
una pieza dentro de una transacción.** En producción funciona por dos barreras distintas —la
guardia previa para el `admin` (sin leer) y el índice único para el `maestro` (ya leída), cuyo
`P2002` el repositorio absorbe—, y ahí cada sentencia va en su propia transacción. Dentro de una
transacción revertida, la violación del índice **aborta la transacción entera** y la guardia del
`admin` ya no llega a ejecutarse (medido: «transacción abortada, las órdenes serán ignoradas»). Se
miden **las dos barreras por separado**, cada una donde es observable, en vez de aflojar la
aserción hasta que pase.

---

## Nota de entorno: la ficha 403 corre en paralelo sobre la MISMA base local

`prisma migrate status` en este worktree reporta dos migraciones **aplicadas en la base y ausentes
del árbol**:

```
The migrations from the database are not found locally in prisma/migrations:
20260909120000_webhook_suscripcion_circuito
20260909130000_notificacion_evento_webhook_suscripcion
```

Son de la **403**, que está en otro worktree y todavía **no está mergeada en `dev`**. Consecuencias
que hay que saber, ninguna de ellas «arreglada» por mí:

- La base local ya tiene los valores de enum de la 403 (`webhook_suscripcion_pausada` y
  `webhook_suscripcion_pausa`), **antes** de los míos. Mi `down.sql` lista los enums tal como están
  en **`origin/dev` @ `7a23c0f3`** (9 eventos, 7 entidades), que es la regla del spec (§3.3): la
  foto se toma al abrir el PR, no de la base local. **Si la 403 se mergea antes que esta ficha, sus
  dos valores tienen que ENTRAR en esas dos listas antes de mergear.** Está escrito dentro del
  propio `down.sql`.
- Por eso **no corrí `pnpm run db:rollback`**: revierte la ÚLTIMA migración por orden de carpeta —la
  mía, la de los enums— y su recreación-con-lista **borraría los dos valores de la 403 de la base
  compartida**, rompiendo el worktree de al lado. El down se ejercita entero dentro de una
  transacción revertida, que mide lo mismo sin tocar a nadie.
- El test de integración de la migración **no compara la lista de enums de la base contra un
  literal cerrado** por este mismo motivo: afirma que los previos siguen ahí en su orden y que los
  nuevos van **después**, que es lo que demuestra que se AÑADIERON en vez de recrearse.
- Mis dos migraciones sí se aplicaron a la base compartida (`prisma migrate deploy`). Son
  **aditivas** —un índice parcial y dos valores de enum— y no rompen nada de la 403.

**Si aparecen rojos en features que esta ficha no toca, mírese esto antes que el código.**

---

## Veredicto

**Los 35 requisitos tienen test, las cinco mutaciones murieron y las dos guardias del cableado se
vieron ROJAS con el import intacto; el gate completo deja `INIT_EXIT=1` con 6 rojos que no son de
esta ficha —son los dos valores de enum que la 403 aplicó a la base local compartida— y todo lo
demás en verde (26.629 pasados, 26 saltados ajenos, `integration/db` ejecutada entera).**
