# impl_403 (BACKEND) — un webhook que falla siempre se PAUSA, avisa, y se recupera solo

> Spec: `specs/403-webhook-destino-que-falla-siempre/`
> Rama: `feat/403-webhook-destino-que-falla-pausa-y-avisa`
> Alcance: **solo backend**. T14 (UI, `WebhookAccionCell.tsx`) queda para `frontend_dev`.

## Lo primero, porque cambia cómo se lee todo lo demás

**No se desactiva nada. `activa` no se escribe en ningún punto de esta ficha.** La pausa es un
estado **derivado** de dos contadores más el reloj, y lo único que hace es **espaciar** los
reintentos. La suscripción sigue viva, sigue recibiendo jobs nuevos, sigue reintentando, y **se
recupera sola al primer 2xx** — sin que ningún humano toque nada.

Es la decisión del humano y el motivo está medido: desactivar deja al integrador desconectado
hasta que alguien lo reactive a mano, y ya se comprobó que ese silencio puede durar **cinco días**.
La cura no puede parecerse a la enfermedad.

Contexto que justifica los números: **2.042 fallos `HTTP 429` y 1.958 jobs muertos contra un solo
destino entre el 4 y el 9 de septiembre**, frente a 60 entregas correctas. Y esos mismos reintentos
dejaron **media hora** sin ejecutarse a la geocodificación, con 42 órdenes esperando (ficha 402).

---

## Las DOS migraciones, y qué hace cada `down.sql`

### `db/migrations/20260909120000_webhook_suscripcion_circuito/`

**UP:** un solo `ALTER TABLE "webhook_suscripcion"` con dos `ADD COLUMN`:

| columna | tipo | default | para qué |
| --- | --- | --- | --- |
| `fallos_consecutivos` | `INTEGER NOT NULL` | `0` | fallos de entrega SEGUIDOS sin un 2xx de por medio (R3) |
| `sin_exito_desde` | `TIMESTAMP(3) NOT NULL` | `CURRENT_TIMESTAMP` | ancla de la racha: última entrega aceptada, o alta/edición de la URL (R1) |

- **No hay una tercera columna `pausada`**, y es una decisión (design §1.1): «pausada» es 100 %
  derivado de esas dos más el reloj. Un booleano persistido **en paralelo** a los datos que lo
  determinan puede divergir de ellos; con un valor derivado eso es estructuralmente imposible.
- **Aditiva y sin backfill.** Las filas existentes quedan «sanas ahora mismo»: nadie entra en pausa
  por su historial previo.
- **No toca RLS** (la tabla ya la tiene habilitada sin policies desde la 99) ni `activa`.

**`down.sql`:** `DROP COLUMN IF EXISTS` de las **dos**, en **orden inverso** (`sin_exito_desde`
antes que `fallos_consecutivos`). No borra filas, no toca `activa`, no toca la PK, el índice único
de `owner_usuario_id`, la FK ni la RLS — y eso se **mide después de correr el down** contra
Postgres, no se supone. Lo que se pierde al revertir es información operativa y reconstruible sola
(la siguiente entrega aceptada vuelve a fijar el ancla), así que aquí el `DROP COLUMN` es la
reversión correcta y **no** hace falta la precondición ruidosa que sí exige el otro down.

### `db/migrations/20260909130000_notificacion_evento_webhook_suscripcion/`

**UP:** dos `ALTER TYPE ... ADD VALUE IF NOT EXISTS`:
`notificacion_evento += 'webhook_suscripcion_pausada'` y
`notificacion_entidad_tipo += 'webhook_suscripcion_pausa'`.
Va **sola y con timestamp posterior** al de las columnas por el `55P04` de Postgres.

**`down.sql`: RECREA-CON-LISTA los dos tipos** — 9 valores en `notificacion_evento` y 7 en
`notificacion_entidad_tipo`, que son «los enums de HOY antes de esta migración».

**La pregunta obligatoria del repo, hecha y respondida sobre los CINCO downs anteriores** (y
ninguno se toca, son fotos históricas):

| down | qué hace | ¿sigue siendo cierto? |
| --- | --- | --- |
| `20260727120000_notificacion` (146, la que CREÓ los enums) | **solo dropea** (se lleva también las tablas) | sí, no se toca |
| `20260820210000_..._postulacion_recurso` (253) | recrea-con-lista, 4 y 4 | sí, no se toca |
| `20260822140000_..._dia_reparto_corregido` (262) | recrea-con-lista, 5 y 5 | sí, no se toca |
| `20260823120000_..._bloqueo_cierre` (271) | recrea-con-lista SOLO `notificacion_evento`, 6 | sí, no se toca |
| `20260829130000_..._gasto_fijo_cobro` (333) | recrea-con-lista, 8 y 6 | sí, no se toca |

**Y la consecuencia, escrita en el propio `down.sql`:** un down recrea-con-lista es una **foto de
su rama**; aplicado sobre una base que ya avanzó, borra en silencio los valores posteriores. Por
eso el único que conoce la lista de hoy es el de ESTA migración.

**Precondición ruidosa:** si queda alguna fila de `notificacion` con el evento o la entidad nuevos,
el `USING` del `ALTER COLUMN` **falla y aborta el rollback**. Es lo correcto: esas filas son el
único aviso de que un integrador lleva sin recibir eventos —el silencio que esta ficha existe para
romper—. **No hay ni un `DELETE` ni un `UPDATE` para «hacer sitio»**, y hay un test que lo mide
ejercitando el down de verdad contra Postgres, con su control positivo.

Las dos se aplicaron con `prisma migrate deploy` contra la base **local** (`localhost:5432`, db
`ordenex`), verificada antes con `prisma migrate status`. **Ninguna se editó después de aplicarse.**

---

## Tareas de `tasks.md`: qué está hecho y qué no

| Task | Estado | Dónde |
| --- | --- | --- |
| **T1** migración de las 2 columnas + `down.sql` + schema | ✅ | `db/migrations/20260909120000_webhook_suscripcion_circuito/` |
| **T2** migración de los 2 enums + `down.sql` + `lib/types/notificacion.ts` | ✅ | `db/migrations/20260909130000_notificacion_evento_webhook_suscripcion/` |
| **T3** `estaPausada()` puro | ✅ | `lib/utils/webhook-suscripcion-pausa.ts` (nuevo) |
| **T4** los 3 números de config | ✅ | `lib/config/webhook.ts` (+ `pausaConfigDe`) |
| **T5** contrato del repositorio | ✅ | `lib/interfaces/repositories/IWebhookSuscripcionRepository.ts` |
| **T6** implementación del repositorio | ✅ | `lib/repositories/WebhookSuscripcionRepository.ts` |
| **T7** `Retry-After` en el sender | ✅ | `lib/interfaces/external/IWebhookSender.ts`, `lib/clients/webhook-sender.ts` |
| **T8** el circuito en el service | ✅ | `lib/services/WebhookEstadoService.ts` |
| **T9** hook genérico de `retryAfterMs` en la cola | ✅ | `lib/services/JobQueueService.ts` |
| **T10** emisor del aviso | ✅ | `lib/notificaciones/emitir.ts` |
| **T11** notificador best-effort | ✅ | `lib/notificaciones/notificadores.ts` |
| **T12** composition root | ✅ | `lib/services/jobs/webhook-estado-handler.ts` |
| **T13** passthrough hasta la Server Action | ✅ | interfaz del service, `lib/types/webhook.ts`, `lib/services/WebhookSuscripcionService.ts` |
| **T14** UI (`WebhookAccionCell.tsx`) | ❌ **NO HECHO — es de `frontend_dev`** | — |
| **T15** esta bitácora | ✅ | este archivo |

**T14 es lo único pendiente**, y el dato ya está listo y tipado para consumirlo:
`ObtenerWebhookActionResult` expone `webhook: WebhookVistaPublica | null` con
`pausada: boolean` y `sinExitoDesde: string | null` (ISO-8601). El requisito **R19** («tras guardar
la URL el aviso desaparece sin recargar») ya está resuelto en el servidor: `actualizarUrlByOwner`
reinicia el circuito, así que el `refrescar()` que la pantalla YA hace tras cada mutación `ok`
devuelve `pausada: false` sin ninguna acción adicional.

---

## Archivos creados

- `db/migrations/20260909120000_webhook_suscripcion_circuito/{migration.sql,down.sql}`
- `db/migrations/20260909130000_notificacion_evento_webhook_suscripcion/{migration.sql,down.sql}`
- `lib/utils/webhook-suscripcion-pausa.ts`
- `tests/unit/utils/webhook-suscripcion-pausa.test.ts`
- `tests/unit/notificaciones/webhook-suscripcion-pausada-aviso.test.ts`
- `tests/integration/db/webhook-suscripcion-circuito-migracion.test.ts`
- `tests/integration/db/notificacion-evento-webhook-suscripcion-migration.test.ts`

## Archivos modificados

`db/schema.prisma` · `lib/types/notificacion.ts` · `lib/types/webhook.ts` ·
`lib/config/webhook.ts` · `lib/clients/webhook-sender.ts` ·
`lib/interfaces/external/IWebhookSender.ts` ·
`lib/interfaces/repositories/IWebhookSuscripcionRepository.ts` ·
`lib/interfaces/services/IWebhookSuscripcionService.ts` ·
`lib/repositories/WebhookSuscripcionRepository.ts` · `lib/services/WebhookEstadoService.ts` ·
`lib/services/WebhookSuscripcionService.ts` · `lib/services/JobQueueService.ts` ·
`lib/services/jobs/webhook-estado-handler.ts` · `lib/notificaciones/emitir.ts` ·
`lib/notificaciones/notificadores.ts`

Tests extendidos: `tests/unit/config/webhook-config.test.ts` ·
`tests/unit/clients/webhook-sender.test.ts` · `tests/unit/services/webhook-estado-service.test.ts` ·
`tests/unit/services/webhook-suscripcion-service.test.ts` ·
`tests/unit/services/job-queue-service.test.ts` ·
`tests/unit/services/jobs/webhook-habilitacion-api-emision.test.ts` ·
`tests/unit/services/notificacion-notificadores-reales.test.ts` ·
`tests/unit/services/notificacion-productores-wiring.test.ts` ·
`tests/unit/actions/webhooks-action.test.ts` ·
`tests/integration/repositories/webhook-suscripcion-repository.test.ts`

---

## Mapa `R<n> → test`

| R | Qué exige | Test que lo cubre |
| --- | --- | --- |
| **R1** | contador + ancla por suscripción | `tests/integration/db/webhook-suscripcion-circuito-migracion.test.ts` → «las dos columnas EXISTEN, con su tipo, NOT NULL y su default», «una fila MÍNIMA nace con contador 0 y un ancla no nula» (Postgres real) · `tests/integration/repositories/webhook-suscripcion-repository.test.ts` → «una suscripción recién creada tiene contador 0 y un ancla válida» |
| **R2** | el 2xx resetea y saca de la pausa | `tests/unit/services/webhook-estado-service.test.ts` → «la entrega aceptada llama a `registrarEntregaOk`…», «SALE DE LA PAUSA: tras el reset, el mismo estado ya no cumple el umbral» · `tests/integration/repositories/webhook-suscripcion-repository.test.ts` → «pone el contador a cero y mueve el ancla», «y con eso SALE DE LA PAUSA en la misma consulta» |
| **R3** | qué cuenta y qué NO | `tests/unit/services/webhook-estado-service.test.ts` → bloque «403/R3»: no-2xx/timeout/red cuentan; **payload inválido** y **`WebhookSecretKeyError`** NO · `…repository.test.ts` → «devuelve el contador YA incrementado», «NO mueve el ancla de la racha» |
| **R4** | umbral + ventana ⇒ intervalo de pausa | `tests/unit/utils/webhook-suscripcion-pausa.test.ts` → «3 fallos y 30 minutos: pausada», «los dos límites EXACTOS» · `tests/unit/services/webhook-estado-service.test.ts` → «el error lleva el INTERVALO DE PAUSA como sugerencia» |
| **R5** | no toca `activa`, no deja de encolar, no deja de procesar | `tests/unit/services/jobs/webhook-habilitacion-api-emision.test.ts` → «una suscripción en plena racha de fallos SIGUE recibiendo su job» y «el filtro de elegibilidad mira SOLO `activa`» · `tests/unit/services/webhook-estado-service.test.ts` → «ni en un éxito, ni en un fallo, ni al cruzar el umbral se llama a `desactivarByOwner`» + guardia de vocabulario sobre el código · `…repository.test.ts` → «NO toca `activa`: … no se reactiva por recibir un 2xx», «`findActivaByOwner` NO filtra por pausa» |
| **R6** | fallos insuficientes o ventana sin cumplir ⇒ backoff normal | `tests/unit/utils/webhook-suscripcion-pausa.test.ts` → «CAÍDA CORTA Y AISLADA: 5 fallos en 4 minutos NO pausa», «un fallo aislado y luego silencio real» · `tests/unit/services/webhook-estado-service.test.ts` → bloque «403/R6» |
| **R7** | guardar la URL reinicia el circuito | `tests/integration/repositories/webhook-suscripcion-repository.test.ts` → «`actualizarUrlByOwner` reinicia el circuito y saca de la pausa en el acto», «también cuando el destino NO estaba roto», «`upsertByOwner` … también reinicia» |
| **R8** | defaults 3 / 30 min / 1 h | `tests/unit/config/webhook-config.test.ts` → bloque «403/R8»: defaults, override por env, inválido → default, `pausaConfigDe` |
| **R9** | aviso al `maestro`, y NUNCA «desactivó» | `tests/unit/notificaciones/webhook-suscripcion-pausada-aviso.test.ts` → «la forma EXACTA de la fila», «va SOLO al maestro», «EL TEXTO NUNCA DICE «DESACTIV»…» · `tests/integration/db/notificacion-evento-webhook-suscripcion-migration.test.ts` → «la fila que llega a la base es la que R9/R13 describen» (Postgres real) |
| **R10** | reutiliza el mecanismo de la 146 | `tests/unit/notificaciones/webhook-suscripcion-pausada-aviso.test.ts` → «emite por `INotificacionRepository.crear`, sin ningún canal nuevo» |
| **R11** | un fallo del aviso se registra y no propaga | `tests/unit/notificaciones/webhook-suscripcion-pausada-aviso.test.ts` → «un repositorio que revienta NO propaga, y el fallo queda REGISTRADO» · `tests/unit/services/webhook-estado-service.test.ts` → «el aviso es lo ÚLTIMO que puede pasar, y el job falla igual» |
| **R12** | una racha, un aviso; racha nueva, aviso nuevo | `tests/integration/db/notificacion-evento-webhook-suscripcion-migration.test.ts` → «tres intentos fallidos de la MISMA racha dejan UNA fila», «una racha NUEVA (tras recuperarse) SÍ avisa», + contraprueba y control sobre `notificacion_dedupe_key` (Postgres real) · `tests/unit/notificaciones/webhook-suscripcion-pausada-aviso.test.ts` → bloque «403/R12» |
| **R13** | ni URL ni secreto en aviso ni logs | `tests/unit/services/webhook-estado-service.test.ts` → «el contexto del notificador solo tiene un id de owner y una fecha», «el log de una entrega fallida ESTANDO PAUSADA sigue sin filtrar nada» · `tests/unit/notificaciones/webhook-suscripcion-pausada-aviso.test.ts` → «la fila entera es opaca» |
| **R14** | 429 con `Retry-After` (segundos y fecha HTTP) | `tests/unit/clients/webhook-sender.test.ts` → «forma SEGUNDOS», «forma FECHA HTTP», + `parseRetryAfterMs` puro · `tests/unit/services/job-queue-service.test.ts` → «una sugerencia MENOR … se ignora: manda el backoff» |
| **R15** | 429 sin cabecera usable ⇒ backoff genérico | `tests/unit/clients/webhook-sender.test.ts` → «sin `Retry-After`…», «una cabecera ILEGIBLE no revienta», «un `Retry-After` que pide esperar CERO o hacia atrás se ignora» |
| **R16** | el 429 sigue gastando intento y muriendo al quinto | `tests/unit/services/job-queue-service.test.ts` → «cinco 429 seguidos con `Retry-After` siguen terminando en `failed`» |
| **R17** | nada supera `JOBS_BACKOFF_CAP_MS` | `tests/unit/services/job-queue-service.test.ts` → «una sugerencia MAYOR gana… hasta el cap, y ni un milisegundo más» (incluye el intervalo de pausa de 1 h y un `Retry-After` extremo) |
| **R18** | la consulta expone `pausada` y `sinExitoDesde` | `tests/unit/actions/webhooks-action.test.ts` → «`pausada` y `sinExitoDesde` viajan hasta el resultado, y sin el secreto» · `tests/unit/services/webhook-suscripcion-service.test.ts` → los dos campos en el DTO · `tests/integration/repositories/webhook-suscripcion-repository.test.ts` → bloque «403/R18» |
| **R19** | tras guardar la URL, deja de mostrarse pausada | **servidor:** `tests/integration/repositories/webhook-suscripcion-repository.test.ts` → «`actualizarUrlByOwner` … la MISMA consulta que alimenta la pantalla ya dice `false`». **UI: pendiente de `frontend_dev`** (`tests/components/WebhookAccionCell.test.tsx`, T14) |

---

## Mutaciones: seis, y las seis murieron

Cada mutación se aplicó con un arnés **autocomprobado** —compara el sha1 del archivo antes y
después y aborta si no cambió—, corrió los 9 archivos de test de la ficha y restauró el archivo.

| # | Qué se rompió | Rojo |
| --- | --- | --- |
| **M1** | `estaPausada` nunca devuelve `true` (el umbral no se dispara cuando debe) | **18 tests en 3 archivos** — «3 fallos y 30 minutos sin éxito: pausada», «el fallo número 3 … pausa», «y con eso SALE DE LA PAUSA…», «`pausada` y `activa` son INDEPENDIENTES», … |
| **M2** | se quita `registrarEntregaOk` del camino del 2xx (la pausa no se levanta) | **2 tests** — «la entrega aceptada llama a `registrarEntregaOk`…», «SALE DE LA PAUSA: tras el reset…» |
| **M3** | se elimina el eje de TIEMPO: basta el conteo (**el falso positivo**) | **6 tests en 3 archivos** — «CAÍDA CORTA Y AISLADA: 5 fallos en 4 minutos NO pausa», «una caída corta NO sale como pausada», «el minuto 30 exacto pausa; el 29 no», … |
| **M4** | el `entidadId` deja de llevar el ancla (dedup por owner, no por racha) | **2 tests** — «la forma EXACTA de la fila», «EL CASO QUE JUSTIFICA EL DISEÑO: una racha NUEVA tras recuperarse SÍ avisa» |
| **M5** | se quita el tope `JOBS_BACKOFF_CAP_MS` de la sugerencia (R17) | **1 test** — «una sugerencia MAYOR gana… hasta el cap, y ni un milisegundo más» |
| **M6** | `actualizarUrlByOwner` deja de reiniciar el circuito (R7/R19) | **2 tests** — «reinicia el circuito y saca de la pausa en el acto», «también cuando el destino NO estaba roto» |

Las tres que el encargo exigía como mínimo son **M1**, **M2** y **M3**; **M3 es la del riesgo real
de esta ficha** —un integrador de verdad conectado y una caída corta que no debe acabar en pausa—.

---

## El gate

### `./init.sh` NO llega a los tests en esta rama, y no es por este diff

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
  - falta la carpeta de specs de la ficha 400 ("un fallo de configuracion del geocodificador no debe bloquear la asignacion")
  - falta la carpeta de specs de la ficha 402 ("la cola no reparte el trabajo entre tipos y uno saturado deja a los demas sin turno")
✗ feature_list.json invalido (el detalle esta justo arriba)
INIT_EXIT=1
```

El commit base de esta rama (`64839dfa`, en `dev`) registró **seis fichas nuevas** en
`feature_list.json` pero solo trajo las carpetas de specs de la **401** y la **403**. Las fichas
**400** y **402** quedaron `in_progress` sin su carpeta, y sus specs viven en las ramas de otros
agentes que trabajan en paralelo ahora mismo (`fd13f76c` y `8f55dd77`, comprobado con
`git log --all --diff-filter=A`). `scripts/validar-feature-list.mjs` corre en el **paso 3**, antes
de typecheck, así que `./init.sh` **muere ahí** en cualquier rama que salga de este commit.

**No se tocó `feature_list.json`** (no es de este alcance, y escribirlo desde dentro de una rama de
agente puede revertir cierres ajenos al mergearse) ni se trajeron specs de otras ramas.

### Lo que sí se corrió: los pasos 5 y 6 de `init.sh`, literales

`pnpm run typecheck` · `pnpm run lint` · `pnpm run test:json` ·
`node scripts/comparar-baseline-rojos.mjs .vitest/rojos.json` · comprobación de `down.sql`.

**`DATABASE_URL` exportada, no copiada** (`docs/verification.md`): se extrajo del `.env` del árbol
principal a un archivo del scratchpad y el script la exporta comprobando antes que el prefijo es
`postgres` y que no lleva comillas. La línea que lo prueba, en cada corrida:

```
DATABASE_URL ok (70 chars, prefijo postgresql:)
archivos con HAY_BASE_DE_DATOS: 147
```

Los **147 archivos contra Postgres SÍ se ejecutaron**. `prisma migrate status` antes de migrar:
`PostgreSQL database "ordenex", schema "public" at "localhost:5432"` — la base **local**.

#### Corrida 1 — 5 rojos, TODOS míos

```
Test Files  5 failed | 1827 passed (1832)
     Tests  11 failed | 26408 passed | 26 skipped (26445)
TYPECHECK_EXIT=0   LINT_EXIT=0   TEST_EXIT=1   BASELINE_EXIT=1

ROJOS NUEVOS (5 archivo(s) que no estan en el baseline):
  - tests/integration/db/no-migration-102.test.ts
  - tests/integration/db/notificacion-evento-bloqueo-cierre-migration.test.ts
  - tests/integration/db/notificacion-evento-dia-reparto-corregido-migration.test.ts
  - tests/integration/db/notificacion-evento-gasto-fijo-migration.test.ts
  - tests/integration/db/notificacion-evento-postulacion-recurso-migration.test.ts
```

**Los cinco son el precio escrito de añadir un valor a un enum cerrado**, y se arreglaron a mano:

- `no-migration-102.test.ts`: la migración nueva se declara en
  `MIGRACIONES_NOTIFICACIONES_POSTERIORES` con su motivo.
- Los otros cuatro llevan listas **literales** de valores del enum, y esas listas **SON el
  contrato** («los eventos son ESTOS y cada uno tiene un productor identificado»), así que se
  **actualizan**, no se relajan ni se derivan del schema. Solo se tocaron los casos que leen **la
  base aplicada** o **el schema de hoy**; las **fotos históricas** (el DOWN de cada ficha con «los N
  previos») no se tocaron. Los títulos que llevaban la cuenta («los NUEVE eventos») se
  despersonalizaron: caducaban en cada ficha.

#### Corrida 2 — 3 rojos, los TRES flakes de saturación

```
Test Files  3 failed | 1829 passed (1832)
     Tests  3 failed | 26416 passed | 26 skipped (26445)
TYPECHECK_EXIT=0   LINT_EXIT=0   TEST_EXIT=1   BASELINE_EXIT=1

ROJOS NUEVOS (3 archivo(s) que no estan en el baseline):
  - tests/unit/analytics/catalogo-produccion.guardia.test.ts
  - tests/unit/guards/impresion-flujo.guardia.test.ts
  - tests/unit/tablero-dia/buckets-estatus.guardia.test.ts
```

Los **cinco de la corrida 1 pasaron a verde** y aparecieron estos tres, **todos con el mismo
error**: `Test timed out in 20000ms`. Son guardias que **recorren el árbol de archivos**, y las
tres estaban **VERDES en la corrida 1**. Aisladas pasan en menos de un segundo, **medido tres veces
seguidas**: `3 passed (3) | 93 passed (93)`, 2,18 s / 825 ms / 797 ms.

**No van a `tests/baseline-rojos.json`**: no son deuda de nadie, son saturación con varios agentes
corriendo a la vez. Añadirlas ahí sería exactamente lo que ese archivo prohíbe por escrito.

#### Corrida 3 — VERDE, la suite entera

```
DATABASE_URL ok (70 chars, prefijo postgresql:)
archivos con HAY_BASE_DE_DATOS: 147
-> pnpm run typecheck
TYPECHECK_EXIT=0
-> pnpm run lint
✖ 181 problems (0 errors, 181 warnings)
LINT_EXIT=0
-> pnpm run test:json

 Test Files  1832 passed (1832)
      Tests  26419 passed | 26 skipped (26445)
   Duration  671.25s

TEST_EXIT=0
-> node scripts/comparar-baseline-rojos.mjs .vitest/rojos.json
sin rojos nuevos (0 archivo(s) rojo(s) sobre 1832 ejecutado(s), todos en el baseline conocido)
BASELINE_EXIT=0
```

**1832 archivos de 1832 en verde**, cero rojos, `BASELINE_EXIT=0`. Las tres guardias de la corrida
2 volvieron a verde sin tocar una línea, que es la confirmación de que eran saturación.

El lint sale con **181 warnings y 0 errores** — todos `no-unused-vars` sobre parámetros `_algo` de
dobles de test, el patrón preexistente del repo (hay 176 de ellos antes de esta ficha).

### Los `skipped`: 26, los legítimos y ninguno más

```
✓ tests/components/AnaliticaPage.test.tsx  (58 tests | 17 skipped)
✓ tests/components/AnaliticaShell.test.tsx (15 tests |  9 skipped)
     Tests  … | 26 skipped (26445)
```

17 + 9 = **26**, los dos ajenos de Analítica. **Ningún archivo entero saltado**, y en particular
`tests/integration/db/` corrió completa — que es lo que hace que este verde diga algo de la capa de
datos.

### `down.sql`

```
MIGRACIONES_SIN_DOWN=' 20260814120000_ruta_optimizada_trazado 20260814140000_ruta_parada_tramo 20260814160000_ruta_tramo_vivo_at'
```

Las tres son **preexistentes** (agosto, feature de rutas) y ajenas a esta ficha. **Las dos
migraciones de la 403 traen su `down.sql`**, y los dos se ejercitan contra Postgres de verdad
—no solo por regex— en `webhook-suscripcion-circuito-migracion.test.ts` y
`notificacion-evento-webhook-suscripcion-migration.test.ts`.

---

## Lo que NO cuadró del spec, dicho en vez de improvisado

1. **`sin_exito_desde` es `TIMESTAMP(3)`, no `timestamptz`.** El `tasks.md` dice «timestamptz».
   Se usó `TIMESTAMP(3)` porque es a lo que Prisma mapea un `DateTime` sin `@db.`, y es lo que
   tienen `created_at`/`updated_at` de esa misma tabla. Con `timestamptz` habría **drift permanente**
   entre `db/schema.prisma` y la base, y `migrate dev` propondría cambiarlo en cada migración
   futura. Es un cambio de tipo físico que no afecta a ninguna decisión del spec: el predicado
   compara instantes.

2. **`incrementarFalloYLeer(owner, ahora)` no usa `ahora`.** La firma del `design.md` §2.2 lo
   incluye y se respetó (simetría con `registrarEntregaOk`, y los dobles necesitan el mismo reloj),
   pero la implementación **no lo usa a propósito**: un fallo NO mueve el ancla de la racha. Si la
   moviera, la ventana no se cumpliría jamás y el `entidadId` del aviso cambiaría en cada intento
   —un aviso por fallo en vez de uno por racha—. Está escrito en el docblock y **medido**
   («NO mueve el ancla de la racha, y ESA es la línea que sostiene R12»).

3. **El `.env.example` no gana los tres envs nuevos.** Ninguno de los envs de `lib/config/webhook.ts`
   está ahí (`WEBHOOK_TIMEOUT_MS`, `WEBHOOK_REPLAY_WINDOW_S` tampoco): son opcionales con default y
   la convención del archivo es no listarlos. Se mantuvo.

4. **`WebhookEstadoService.ts` entra en `SERVICES_CON_NOTIFICADOR`.** El censo de
   `notificacion-notificadores-reales.test.ts` se contrasta contra el árbol, así que un service
   nuevo con notificador **no puede** quedarse fuera en silencio. Se añadió, y con él una guardia de
   cableado sobre `lib/services/jobs/webhook-estado-handler.ts` que afirma sobre **la línea del
   cableado**, no sobre el import — porque importar sin pasar es el estado exacto que dejó mudo al
   `corte-diario` de la 271.

## Efecto colateral conocido sobre otras ramas

La base local es **compartida** entre worktrees. Al aplicar la migración de los enums, los cuatro
tests que comparan los valores del enum **de la base** contra una lista literal se ponen **rojos en
cualquier otra rama** hasta que esta se mergee (esta rama trae las listas ya actualizadas). Es el
comportamiento conocido y documentado; se resuelve **mergeando primero la ficha cuya migración
causa el rojo**.

## Veredicto

Backend de la 403 completo (T1–T13 y T15), con las dos migraciones reversibles y ejercitadas contra
Postgres, los 19 requisitos mapeados a tests reales y seis mutaciones muertas; queda **solo T14**,
la línea de aviso en `WebhookAccionCell.tsx`, para `frontend_dev`.
