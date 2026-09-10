# Revisión 401 — La caída del geocodificador avisa y se recupera sola

> Rama `feat/401-geocodificador-avisa-y-se-recupera`, cabeza **`151f1d2c81e66e62a5fc0d07c3e3618fcd44d20e`**
> (6 commits, empujada; `origin` y local coinciden, 0/0).
> Base de comparación: `7a23c0f3`. `origin/dev` avanzó 2 commits desde entonces (`4e263840`,
> `c2a6fef2` — specs de la 404/405 y un chore de la 406): nada que cruce con esta ficha.
> Revisado en el worktree `.claude/worktrees/agent-a8a98fb33a7ec7051`. **No se tocó el repo principal.**
>
> **Gate completo NO ejecutado, por instrucción del leader:** la ficha 403 trabaja en paralelo sobre
> la MISMA base local y un `./init.sh` completo ahora no mediría esta rama. En su lugar se corrieron
> los tests focalizados y se aplicaron mutaciones propias (abajo).

---

## Veredicto

**RECHAZADA — un (1) bloqueante, y es de spec, no de código.**

El código está bien: los 35 requisitos tienen test que los cubre de verdad, el cableado se ve rojo
con la mutación exacta que este repo ya sufrió, las dos sentencias SQL se prueban donde viven, y
**las nueve mutaciones aplicadas en esta revisión murieron todas**. Lo que falta es corregir el
`design.md`, que sigue publicando una sentencia SQL que Postgres rechaza —medido otra vez aquí—.
Con esa corrección hecha, y sin necesidad de volver a correr nada más que la lectura del spec,
la ficha es aprobable.

---

## Checklist de `CHECKPOINTS.md`, punto por punto

### Especificación
- [x] `specs/401-.../requirements.md` con 35 requisitos EARS numerados `R1` … `R35`.
- [x] `design.md` con alternativas descartadas y su porqué (§8, **trece**: A1–A13).
- [ ] `tasks.md` existe, pero **ninguna task está marcada `[x]`** — el archivo no tiene casillas
      (0 marcadas, 0 vacías). Mismo formato que la 400. Ver hallazgo **M-2**.

### Trazabilidad
- [x] Cada requisito mapea a al menos un test concreto. **Verificado uno a uno** (tabla abajo).
- [x] `progress/impl_401.md` contiene el mapa R -> test, con el nombre real de cada caso.

### Calidad de código
- [x] `pnpm run typecheck` -> **0 errores** (corrido por mí).
- [x] `pnpm run lint` -> **177 problems (0 errors, 177 warnings)** -> pasa (corrido por mí).
- [~] `pnpm test` completo **no se corrió** (instrucción del leader). Focalizados corridos por mí:
      **174 unit (7 archivos) + 37 integración (2 archivos) + 14 de google-geocode = 225 verdes.**
      Los 6 rojos del árbol son de la 403 — atribución **comprobada** abajo (punto 0).
- [x] E2E: **inaplicable**. No hay harness Playwright en este repo y esta ficha no toca auth, pagos,
      recaudo, ingesta de órdenes ni webhooks: es la cola interna de jobs.

### Datos y seguridad (Supabase)
- [x] RLS: **no se crea ninguna tabla ni columna** (verificado en el `git diff --stat` y leyendo los
      dos `migration.sql`). `jobs` conserva su RLS de la 90 y `notificacion` la de la 146. Cero
      policies nuevas. Declarado en `design.md` §3.4.
- [~] Migraciones versionadas y reversibles: las dos traen su `down.sql`.
      - `20260910110000_jobs_geocodificacion_salud_idx`: **ejercitado de verdad**. Comprobado por mí
        contra la base local que el índice existe con su definición exacta (btree sobre
        `estado, updated_at`, parcial `WHERE tipo = geocodificacion`).
      - `20260910120000_notificacion_evento_geocodificacion_caida`: **`pnpm run db:rollback` NO se
        corrió**, y la razón es correcta —revertiría la última carpeta y su recreación-con-lista
        borraría de la base compartida los dos valores de la 403—. Se ejercita entero dentro de una
        transacción revertida, incluida su precondición ruidosa y su control positivo. Aceptado, con
        la reserva **M-4**.
- [x] Sin secretos hardcodeados: los cinco números salen de `process.env` con default; el marcador se
      **importa** del módulo de la 400 y su longitud se deriva de su `.length` (la guardia T14 lo
      vigila).
- [x] Webhooks: no aplica, esta ficha no crea ninguno.

### Patrón de capas
- [x] `GeocodeSaludRepository` es SQL crudo parametrizado y nada más; el umbral, la ventana, el lote
      y el enfriamiento llegan como argumentos.
- [x] `GeocodeSaludService` no conoce HTTP ni Prisma ni Next: DI por interfaces, notificador con
      default no-op.
- [x] Los dos contratos nuevos viven en `lib/interfaces/repositories/` y `lib/interfaces/services/`.
- [x] Composition root único: `lib/services/jobs/geocodificacion-handler.ts` (comprobado que es el
      **único** sitio de `lib/`, `app/` y `scripts/` donde se construye cualquiera de los dos
      services).

### Permisos
- [x] No aplica: cero rutas, cero páginas, cero Server Actions nuevas. El único disparador sigue
      siendo el cron ya existente. **Comprobado en el archivo real** que la cadena llega:
      `app/api/cron/procesar-jobs/route.ts:68` construye el handler con
      `buildGeocodificacionService(now)`.

### Multi-país / configuración
- [x] Nada de país, moneda ni cuenta. La jornada se calcula con `fechaCalendarioCR`, la utilidad ya
      existente, y hay un test que fija el caso que separa CR de UTC (02:00Z del 9-sep da 2026-09-08).

### Verificación final
- [ ] `./init.sh` **no termina en verde** (`INIT_EXIT=1`). Los 6 rojos **no son de esta ficha** —ver
      punto 0—, pero el checkpoint literal no se cumple y no puede cumplirse mientras la base local
      arrastre las migraciones de la 403. Ver hallazgo **M-3**.
- [x] `progress/review_401.md` existe (este archivo).
- [ ] **No hay entrada de la 401 en `progress/history.md`.** Ver hallazgo **m-5**.

---

## Punto 0 — Atribución de los 6 rojos: **la afirmación del implementador es CIERTA**

Comprobado con tres medidas independientes, no con una.

**1. El grep sobre el árbol de esta rama da CERO.**

```
grep -rn "webhook_suscripcion_paus" db/ lib/ tests/   ->  (sin resultados)
```

Los dos literales aparecen sólo en `progress/impl_401.md` y en
`specs/403-webhook-destino-que-falla-siempre/`. No están en `db/schema.prisma`, ni en
`lib/types/notificacion.ts`, ni en `db/migrations/`.

**2. La base tiene DOS migraciones aplicadas que no están en el árbol.** Aquí hay un matiz que
importa: `prisma migrate status` en MI corrida dijo «Database schema is up to date!» y **no** las
delató, al contrario de lo que pegó el implementador. Así que lo medí contra la tabla:

```
_prisma_migrations: 189 filas   |   db/migrations: 187 carpetas
Las dos que sobran, ambas terminadas y sin rollback:
  20260909120000_webhook_suscripcion_circuito
  20260909130000_notificacion_evento_webhook_suscripcion
```

Y el enum de la base, en orden de adición, pone al culpable **antes** que al de esta ficha:

```
notificacion_evento: ... gasto_fijo_cobro_pendiente, webhook_suscripcion_pausada, geocodificacion_caida
```

**3. Corrí los cuatro archivos rojos yo mismo.** `Tests 6 failed | 70 passed (76)`, y en los **seis**
diffs el ÚNICO valor inesperado es `webhook_suscripcion_pausada` o `webhook_suscripcion_pausa`.
`geocodificacion_caida` y `geocodificacion_caida_dia` aparecen **dentro de la lista esperada** en los
seis: el implementador ya los añadió.

**Ningún rojo es suyo.** Y la decisión de no meterlos en `tests/baseline-rojos.json` es la correcta:
no son deuda medida de nadie, y el propio `docs/verification.md` advierte contra añadir entradas
«para pasar el gate».

### Los 5 rojos que SÍ eran suyos (`6c4aa3e1`): ampliados a mano y bien

Leí el diff entero del commit. Los cinco inventarios se **amplían con el literal escrito a mano** y
un comentario que dice de qué ficha viene y con qué migración; **ninguno se relajó** (no se cambió un
`toEqual` por un `toContain`, no se derivó la lista del enum de Prisma ni del tipo de dominio) y
**ninguno se compara contra su propia fuente**. `no-migration-102` declara la carpeta nueva en su
lista de excepciones con el motivo escrito. Correcto.

---

## Punto 1 — El SQL del `design.md` §5.1: **BLOQUEANTE**

**Lo medí yo, contra la base local, con la sentencia tal cual la escribe el spec** (dentro de una
transacción revertida):

```
CODIGO: 0A000 | FOR UPDATE no está permitido con funciones de ventana deslizante
```

**El implementador tiene razón: ese SQL no corre.** Y la forma implementada conserva **íntegras las
cuatro decisiones** que el spec exige — lo verifiqué línea a línea en
`lib/repositories/GeocodeSaludRepository.ts`:

| Decisión del spec | ¿Se conserva? | Dónde |
| --- | --- | --- |
| `left("last_error", $len) = $marcador`, nunca `LIKE` | **Sí** | en `elegibles`; la guardia T14 prohíbe `LIKE`/`ILIKE`/`SIMILAR TO` en ese archivo |
| `FOR UPDATE SKIP LOCKED` | **Sí** | en `elegibles` (sin ventana), igual que el `claimBatch` |
| `run_after` escalonado con `row_number()` y el espaciado | **Sí** | en `candidatos` (sin bloqueo), sobre el conjunto ya fijado y en el mismo orden |
| `intentos = 0`, `last_error = NULL`, `locked_at = NULL` | **Sí** | en el `UPDATE`, y medido en integración |

El `ORDER BY updated_at ASC` y el `LIMIT` viven en `elegibles`, así que el conjunto queda **fijado
antes** de numerar: `candidatos` numera exactamente esas filas y en ese orden. Es equivalente al
spec, no una aproximación.

**PERO EL SPEC NO SE CORRIGIÓ.** `git log -- specs/401-.../` devuelve un solo commit
(`2819ca2c`, el de creación): ni `design.md` ni `tasks.md` se tocaron en esta rama.
Hoy siguen diciendo:

- `design.md:364-387` — el bloque SQL con `row_number() OVER (...)` y `FOR UPDATE SKIP LOCKED` en la
  **misma** `SELECT`, presentado como la sentencia a implementar;
- `design.md:396` — «FOR UPDATE SKIP LOCKED, igual que claimBatch», sin decir que va en otra CTE;
- `tasks.md:115-116` — «FOR UPDATE SKIP LOCKED **en la CTE de candidatos**» y «run_after escalonado
  con row_number()» — es decir, el spec **pide por escrito** poner las dos cosas en la misma CTE,
  que es literalmente la combinación que Postgres rechaza.

**Por qué esto es bloqueante y no cosmético.** Si alguien reintroduce esa forma leyendo el spec, el
fallo **no se ve**: `revivirFallosConfig` lanzaría, `GeocodificacionService.avisarSalud` lo atraparía,
y el logger que el composition root inyecta es el **no-op** por defecto (ver **m-6**). Resultado: la
recuperación deja de funcionar sin un solo test rojo en el camino de producción y sin una línea de
log. Es exactamente la familia de fallos mudos que esta ficha existe para eliminar.

**Qué falta, en concreto:** sustituir el bloque de `design.md` §5.1 por la forma implementada (los
dos CTEs más el `UPDATE`), añadir la nota del 0A000 medido y del precedente del `claimBatch` de
`JobRepository`, y reescribir la viñeta de `tasks.md` T6 para que diga en qué CTE va cada cosa.
No hace falta tocar una línea de código.

---

## Punto 2 — La prueba de que el aviso está cableado: **REPRODUCIDA**

Apliqué la mutación exacta de T13 —borrar **sólo** el argumento `notificarGeocodificacionCaidaReal`
de `new GeocodeSaludService(...)`, dejando el `import` intacto (comprobado: el `grep -c` sigue dando
1)—:

```
 FAIL  ...notificacion-notificadores-reales.test.ts > el camino real esta CABLEADO en el composition
       root, no en el default > lib/services/jobs/geocodificacion-handler.ts inyecta el notificador real
 FAIL  ...notificacion-notificadores-reales.test.ts > guardia derivada: ningun notificador REAL puede
       quedarse sin composition root > cada notificar*Real exportado lo PASA algun fichero de lib/ o
       app/, no solo lo importa
+ [ { "cableadoEn": [], "notificador": "notificarGeocodificacionCaidaReal",
+     "soloImportadoEn": [ "lib/services/jobs/geocodificacion-handler.ts" ] } ]
 Test Files  1 failed (1)   Tests  2 failed | 24 passed (26)
```

**Las dos guardias en ROJO, con el import vivo.** Restaurado: `26 passed (26)`.

Y comprobé **la otra mitad del cableado, que el implementador también protegió**: borrar el
argumento `salud` de `new GeocodificacionService(...)` —lo que dejaría la ficha entera inerte con el
notificador perfectamente inyectado— también pone roja la guardia por sitio
(`Tests 1 failed | 25 passed`). Restaurado y verde. El árbol quedó limpio (`git status` vacío) tras
cada mutación.

---

## Punto 3 — Las dos barreras de R9 medidas por separado: **cubre el requisito**

El diagnóstico del implementador es correcto y lo verifiqué leyendo los dos casos: dentro de una
transacción, la violación del índice único **aborta la transacción entera**, así que la guardia
previa del `admin` ya no llega a correr. Medir «una tercera emisión no crea ninguna» de una pieza es
imposible con el aislamiento que estos tests usan.

Lo que hay en su lugar cubre el requisito, y en **tres** planos, no dos:

1. **Barrera 1 (integración):** con la del `maestro` ya leída, `existeNoLeidaPara(maestro)` es `false`
   y `existeNoLeidaPara(admin)` sigue `true`, y **las dos filas siguen ahí**. Fija que
   `destinatario_rol` está dentro de la clave y que leer una no suprime la otra.
2. **Barrera 2 (integración):** saltándose la guardia y yendo al `INSERT` directo, quien rechaza es
   `notificacion_dedupe_key` — la aserción es `rejects.toThrow(/notificacion_dedupe_key/)`, o sea
   nombra el índice, no un mensaje genérico. Con su **contraprueba** (la misma clave a pelo dos veces
   la rechaza) y su **control** (con dos roles distintos el mismo `INSERT` entra las dos veces).
3. **El caso completo, en unitario:** `geocodificacion-caida-aviso.test.ts`, «que el maestro LEA la
   suya no suprime la del admin ni crea una nueva»: la segunda emisión devuelve 0 y siguen siendo 2
   filas, contra un doble que emula **las dos** barreras (guardia de no-leídas más una dedupe que
   devuelve `false`, igual que el repositorio real absorbiendo el P2002).

**No aflojaron la aserción para que pasara**, que era el riesgo. El hueco residual —que
`NotificacionRepository.crear` absorba de verdad el P2002 en este escenario concreto— es
comportamiento preexistente de la 146 y el repositorio lo hace explícitamente
(`NotificacionRepository.ts:116`). **Cubierto.**

---

## Punto 4 — Las cinco variables configurables

**Comportamiento: correcto, y lo corrí.** `tests/unit/config/geocode-salud-config.test.ts` (11 casos)
cubre ausente (las borra en el `beforeEach`), vacío, no numérico, cero, negativo, y además tres
basuras extra. Todos caen al default y **`loadGeocodeSaludConfig()` no lanza en ninguno**. Los cinco
defaults están escritos **a mano** en un `toEqual` literal, no derivados del módulo. Además declara
el límite conocido de `parseInt` (un «3.9.9» se lee como 3), que es honesto y no un descuido.

**¿Deberían declararse en `.env.example`? NO, y no es una opinión: es el precedente medido.**
`lib/config/jobs.ts` declara exactamente el mismo patrón —`JOBS_BATCH_SIZE`, `JOBS_MAX_ATTEMPTS`,
`JOBS_BACKOFF_BASE_MS`, `JOBS_BACKOFF_CAP_MS`, `JOBS_VISIBILITY_TIMEOUT_MS`— y **ninguna de las cinco
está en `.env.example`** (comprobado). Añadirlas además tendría un coste de proceso real:
`.env.example` está en la lista de rutas que hacen que `./init.sh --rapido` **se niegue solo**
(`docs/verification.md`), así que declarar cinco variables opcionales obligaría a un gate completo.
Su sitio documental es `design.md` §6.4 y `progress/impl_401.md`, donde ya están con su papel y su
porqué. **Sin hallazgo.**

---

## Trazabilidad R -> test, verificada

Los 35 tienen cobertura real. Los que revisé leyendo el test entero (no sólo el título) van marcados
con una estrella.

| R | Cubierto por | Nota |
| --- | --- | --- |
| R1 * | `geocode-salud-service` (prosa legada frente a la misma prosa marcada) + guardia T14 con **contraprueba** | La guardia prohíbe `LIKE`/`ILIKE`/`SIMILAR TO` y exige el `left(...)` |
| R2 * | `geocode-salud-service` (7 intentos = 1 job) + integración sobre el mismo `WHERE` | |
| R3 * | matriz 0/1/2/7 + el `desde` afirmado exacto + contraprueba de ventana en integración | |
| R4 * | «un aislado no emite» + **el off-by-one** con umbral menos uno | |
| R5 * | 8 casos parametrizados + contraprueba del `startsWith` | |
| R6 * | `geocodificacion-service`: 6 desenlaces, cero llamadas de ambos tipos | |
| R7 * | `geocodificacion-caida-aviso`: los roles escritos LITERAL, forma completa de las dos filas, mismo texto, sin tienda ni zona | No derivado de `ROLES_ADMINISTRACION` |
| R8 * | `notificacion-notificadores-reales`: camino real por `INotificacionRepository.crear` | |
| R9 * | integración (barreras 1 y 2, con contraprueba y control) + unitario | Ver punto 3 |
| R10 * | integración (4 filas en 2 jornadas) + unitario | |
| R11 * | notificador lanza / repo lanza: no propaga y queda logueado; `emitirBestEffort` registra | Ver **m-6** |
| R12 * | 3 capas + **la mutación reproducida por mí** | Ver punto 2 |
| R13 * | una llamada tras el `ok`, y **después** de caché y orden (orden de efectos afirmado) | |
| R14 * | acierto de caché: 0 llamadas, y el job termina igual | |
| R15 * | integración: pending, intentos 0, last_error nulo, locked_at nulo, y tipo/payload/dedupe_key idénticos | |
| R16 * | integración: sin marcador, con prosa legada y con last_error nulo no se tocan (ni su updated_at) | |
| R17 * | los 3 desenlaces deterministas completan el job | |
| R18 * | integración: 25 filas, 5 revividos, sin una sola sentencia manual | |
| R19 * | los recuperados son exactamente los cinco más viejos, comparados por id | Mutación DESC -> rojo (mía) |
| R20 * | la recuperación lanza: el job se completa igual, con el fallo logueado y sin PII | |
| R21 * | 25 candidatos -> exactamente 5, y 20 siguen muertos | |
| R22 * | los run_after son **exactamente** 1,2,3,4,5 min; y con espaciado 90 s, 90 y 180 s | Mutación de unidad -> rojo (mía) |
| R23 * | 4 filas testigo comparadas antes/después con un `toEqual` de la fila entera | |
| R24 * | 10/59/61 min; y dos llamadas seguidas dan 10 ids distintos | Mutación del filtro -> rojo (mía) |
| R25 * | config_invalida: cero llamadas a la recuperación, en los dos niveles | |
| R26 * | texto sin PII, anexo nulo, único número la cifra agregada; y los logs sin la credencial | |
| R27 * | **literal completo a mano**, singular y plural; ausencia case-insensitive de las 4 prohibidas | |
| R28 | `google-geocode.test.ts` verde **sin cambios** (14 casos, corrido por mí) + guardia sobre el cliente y `lib/config/geocode.ts` | El diff no toca ninguno de los dos |
| R29 * | los 5 defaults en un `toEqual` literal | |
| R30 * | vacío, no numérico, cero, negativo, más 3 basuras extra, sin lanzar | |
| R31 | `git diff --stat` (leído por mí) + los dos `migration.sql` (leídos) + integración | Cero tablas, cero columnas |
| R32 | Guardia sobre el árbol: `JobQueueService.ts` no contiene ni el nombre del service ni el del evento | **No es sólo un diff --stat** |
| R33 * | Guardia: nadie llama al productor del marcador, nadie escribe last_error salvo a NULL, con contraprueba | |
| R34 | Guardia sobre `AsignabilidadCoordenadasService.ts` + el diff no toca `app/` | |
| R35 * | Lista literal de los 5 métodos de `IJobRepository`, con contraprueba del extractor | |

**Ningún test de los nuevos puede pasar sin datos:** los escenarios de integración afirman el número
de filas sembradas —con mensaje— antes de actuar, y el de la barrera 1 falla ruidosamente si no hay
ningún usuario. Nada de `if (!filas) return;`.

---

## Mutaciones aplicadas EN ESTA REVISIÓN (todas revertidas, árbol limpio)

El implementador reportó 5. Busqué la que no probó —el reloj— y probé 4 más. **Las nueve mueren.**

| # | Mutación | Archivo | Resultado |
| --- | --- | --- | --- |
| 1 | Borrar el argumento del notificador, import intacto | `geocodificacion-handler.ts` | **ROJO**, 2 casos (las dos guardias) |
| 2 | Borrar el argumento `salud` de `new GeocodificacionService(...)` | idem | **ROJO**, 1 caso (guardia por sitio) |
| 3 | **Ventana en segundos**: la ventana en minutos por 1000 en vez de por 60000 | `GeocodeSaludService.ts` | **ROJO**, 2 casos (el `desde` exacto y la ventana configurada) |
| 4 | **Enfriamiento en segundos**: idem sobre el enfriamiento | idem | **ROJO**, 1 caso (los tres parámetros afirmados a mano) |
| 5 | **Unidad del escalonado**: `interval 1 millisecond` -> `interval 1 microsecond` | `GeocodeSaludRepository.ts` | **ROJO**, 2 casos (los 1-2-3-4-5 min y el espaciado configurado) |
| 6 | **Orden invertido**: el `ORDER BY updated_at` de `elegibles` a DESC | idem | **ROJO**, 1 caso (R19) |
| 7 | **Enfriamiento fuera del WHERE**: el filtro de `tocadoAntesDe` sustituido por uno inocuo | idem | **ROJO**, 1 caso (R24) |
| 8-9 | *(del implementador, releídas y coherentes con el código)* el umbral y el LIMIT | — | reportadas ROJAS |

La **3, 4, 5, 6 y 7 son nuevas**: cubren precisamente el eje del reloj que el implementador no
tocó (los 60 minutos de la ventana y los 60 segundos del escalonado). Ninguna sobrevivió: el `desde`,
el `tocadoAntesDe` y los cinco `run_after` están afirmados con valores exactos, no con desigualdades
laxas.

---

## Hallazgos

### BLOQUEANTE

**B-1 — `design.md` §5.1 y `tasks.md` T6 siguen publicando SQL que Postgres rechaza (0A000).**
Medido por mí contra la base local con la sentencia tal cual. El código implementa la forma correcta
y conserva las cuatro decisiones, pero el spec no se corrigió (los archivos de `specs/401-.../`
tienen un solo commit, el de creación). `tasks.md:115-116` llega a **pedir por escrito** la
combinación prohibida. **Qué falta:** reescribir el bloque SQL de `design.md` §5.1 con los dos CTEs
más el `UPDATE`, añadir la nota del 0A000 medido y del precedente del `claimBatch`, y corregir la
viñeta de `tasks.md` T6. Cero cambios de código.

### Mayores (no bloquean la calidad del código, sí el cierre)

**M-2 — Ninguna task de `tasks.md` está marcada.** `CHECKPOINTS.md` lo exige explícitamente. El
archivo no tiene casillas de ningún tipo (mismo formato que la 400; la 396 sí las tiene, todas
vacías), así que el checkpoint es hoy inaplicable tal como está escrito. La evidencia de ejecución de
las 19 tasks sí existe, en `progress/impl_401.md`. **Qué falta:** o marcar las tasks, o que el leader
decida qué hacer con ese checkpoint. No es deuda de esta ficha en solitario.

**M-3 — El gate completo está en rojo y no puede ponerse verde desde esta rama.** `INIT_EXIT=1`, 6
rojos, todos de la 403 (atribución comprobada arriba). El veredicto del gate es **por archivo**
contra el baseline, así que mientras la base local arrastre las dos migraciones de la 403 esta rama
no puede exhibir un gate verde. **Qué falta antes de dar la ficha por done:** una corrida completa
contra una base sin las migraciones de la 403 —o después de que la 403 se mergee—, con la lista de
saltados revisada. No es defecto de esta ficha; es una condición de cierre.

**M-4 — El down.sql de los enums es una foto de `origin/dev` en `7a23c0f3` y hay que revalidarla al
mergear.** Hoy es correcta: verifiqué que la 403 **no** está en `origin/dev`. Pero si la 403 mergea
antes, ese down recrearía los dos enums **sin** los dos valores de webhook y los borraría en silencio
de cualquier base que ya los tenga — que es literalmente la memoria «el down.sql borra los valores
posteriores». Está declarado dentro del propio archivo (líneas 29-36) y en la bitácora.
**Qué falta:** releer `db/schema.prisma` de `origin/dev` **en el momento de mergear** y, si la 403 ya
está, añadir sus dos valores a las dos listas antes del merge. Es una puerta de merge, no un arreglo.

### Menores

**m-5 — No hay entrada de la 401 en `progress/history.md`.** Checkpoint de «Verificación final».

**m-6 — R11 y R20 dicen «queda registrado con contexto», y en PRODUCCIÓN es mudo.**
`GeocodeSaludService` y `GeocodificacionService` reciben su logger por constructor con un default que
no hace nada, y el composition root pasa `undefined` en los dos casos. Consecuencia, medida leyendo
el árbol: si `contarFallosConfigDesde` o `revivirFallosConfig` revientan, en producción **no queda ni
una línea**. El aviso fallido sí se registra (`emitirBestEffort` cae al `ConsoleErrorLogger` de
`lib/errors`), así que R11 está cubierto en su capa; el que queda descubierto de verdad es **R20**.
Atenuante: es la convención preexistente de la 91 —el warn de «el proveedor rechazo la peticion» que
ya estaba también es mudo en producción—, no algo que esta ficha invente, y los tests sí inyectan
logger y lo afirman. **Sugerencia, una línea:** que `buildGeocodificacionService` inyecte un logger
real en vez de `undefined`. Queda como deuda declarada.

**m-7 — La recuperación sólo se dispara con un `ok` real del proveedor.** Si en algún momento
**todos** los jobs de geocodificación estuvieran muertos y no llegara ninguna orden nueva, nada
dispararía la recuperación. `design.md` §6.1 lo razona (durante el corte medido, 23 de 48 seguían
pending y sus propios reintentos son la sonda), y con el volumen medido —2 a 269 órdenes por día— el
caso es teórico. Pero **no está declarado como límite conocido en `requirements.md`**, a diferencia
de Q4 y Q5. Merecería una línea en las preguntas abiertas.

**m-8 — El enfriamiento de 60 min también retrasa la primera recuperación.** Un job que murió hace
menos de una hora no entra en la tanda, así que tras restaurarse la credencial los más recientes
esperan hasta 60 minutos más. Es coherente con R24 y con el techo de «como mucho un revivido por job
y por hora», y el test lo fija (10 y 59 min no; 61 min sí). Se anota porque el coste real de la
recuperación frente al rescate manual es mayor que los «unos 25-30 minutos» de `design.md` §6.2
cuando el corte acaba de terminar.

**m-9 — La guardia T14 vigila una lista literal de 6 archivos.** Si la ficha ganara un séptimo
archivo de producción, quedaría fuera de las tres afirmaciones (sin prosa, sin escribir el marcador,
sin LIKE) sin que nada se ponga rojo. Es el mismo compromiso que hacen otras guardias del repo y la
lista lleva su comentario; se anota, no se pide cambiar.

**m-10 — Dos tests de integración exigen que exista al menos un usuario en la base.** Las barreras 1
y 2 de R9 lo afirman explícitamente. Es **lo correcto** frente a la memoria «test de integración
verde sin datos» —fallan ruidosamente en vez de saltarse—, pero significa que en una base recién
creada esos dos casos salen rojos por falta de semilla, no por regresión. Digno de saberse.

---

## Lo que NO es un hallazgo, y conviene dejar escrito

- **Los destinatarios se afirman a mano en DOS sitios** (`geocodificacion-caida-aviso.test.ts` y
  `notificacion-notificadores-reales.test.ts`), nunca derivados de `ROLES_ADMINISTRACION`. Quitar un
  rol de la constante deja los dos rojos. Era el riesgo nombrado en `design.md` §9 y está cerrado.
- **El literal del texto** se afirma a mano en dos constantes del test y se compara contra
  `textoGeocodificacionCaida(n)` — la dirección correcta: el contrato está en el test, no en la
  función.
- **R32 y R34 no se acreditan sólo con un `git diff --stat`**: hay guardias que leen el árbol real.
  Mejor de lo que pedía `requirements.md`.
- **El texto del aviso lleva acentos** mientras el snippet de `design.md` §7.2 va sin ellos. La
  versión implementada es la correcta para lenguaje de cara a una persona (R27) y el test la fija a
  mano. No es desviación que corregir.
- **`.env.example`**: ver punto 4. No tocarlo es lo correcto.

---

## Cómo se verificó (para que se pueda repetir)

```
pnpm run typecheck                                        -> 0 errores
pnpm run lint                                             -> 0 errors, 177 warnings
pnpm vitest run  (7 archivos unit de la ficha)            -> 174 passed (174)
DATABASE_URL=... pnpm vitest run  (2 de integration/db)   -> 37 passed (37)   <- NO saltados
pnpm vitest run tests/unit/clients/google-geocode.test.ts -> 14 passed (14)   (R28)
DATABASE_URL=... pnpm vitest run  (los 4 archivos rojos)  -> 6 failed | 70 passed (76)
9 mutaciones aplicadas y revertidas                       -> 9 rojos, arbol limpio tras cada una
SQL del design 5.1 contra Postgres real                   -> 0A000
_prisma_migrations (189) contra db/migrations (187)       -> las 2 que sobran son de la 403
```

El gate completo **no** se ejecutó, por instrucción del leader (la 403 comparte base local).

---

## Veredicto final

**RECHAZADA.**

Un único bloqueante: **B-1**, corregir el SQL publicado en `design.md` §5.1 y la viñeta de
`tasks.md` T6. Todo lo demás está en orden y, en varios puntos, por encima de lo que el spec pedía.
Los seis rojos del árbol **no son de esta ficha** —comprobado por tres vías— y los cinco que sí lo
eran se arreglaron a mano y correctamente.

Vuelve al implementador **sólo** para el arreglo del spec. **No hay nada que cambiar en el código de
producción ni en los tests.**
