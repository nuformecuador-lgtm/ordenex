# 410 — Bitácora del BACKEND

> Rama `feat/410-notificaciones-push`, nacida de `dev` @ **`ca697141`**
> (`chore(410): la ficha arranca, con la 409 ya en dev`).
> Alcance: **solo backend** — tandas 0 a 4 del `tasks.md`, más el cierre que me toca. El permiso del
> navegador, el control de suscripción, la supresión del tono y la baja al cerrar sesión (tanda 5)
> son del agente de frontend, sobre esta misma rama. Ver §9 («qué le dejo al frontend»).

---

## §0 — Fase 0: lo que se comprobó ANTES de escribir una línea

### T0.1 — La puerta previa de la 409, verificada en el ARCHIVO REAL

| Qué | Dónde | Veredicto |
| --- | --- | --- |
| `presentacionDe(fila) → { titulo, cuerpo, destino } \| null` | `lib/notificaciones/presentacion-aviso.ts:86` | **existe, y es pura**: sin Prisma en runtime, sin React, sin `next/*`, sin reloj. Se consume tal cual; no se duplica ni un literal |
| `rolLector` **no** es `destinatario_rol` | la cabecera del propio `FilaDeAviso` lo escribe con todas las letras | confirmado, y es lo que decide todo el catálogo: los tres avisos del mensajero llegan como fila DIRIGIDA A USUARIO, con `destinatario_rol` en NULL |
| `esEventoAgregado` + `accionDeAviso` | `lib/notificaciones/catalogo-avisos.ts` | módulo puro; el servicio de push lo usa para saber si hay cifra viva que pedir |

### T0.2 — Los dos eventos nuevos de la 409, copiados de `db/schema.prisma`

`novedades_sin_gestionar` y `devoluciones_represadas`. El enum `NotificacionEvento` tiene **13**
valores, no 11 como decía el borrador del design: la 409 añadió dos. El catálogo de push los cubre.

### T0.3 — El CONTEO por (usuario, evento): **SÍ llegó**, y se usa

La 409 dejó `IVigenciaAvisoAgregado.cifra(evento, actor)`
(`lib/interfaces/services/IVigenciaAvisoAgregado.ts`), que resuelve la cifra viva **acotada al
ámbito del actor**. En el drenador hay `{ usuarioId, rol, zonaId }` por destinatario, que es
exactamente un `Actor`, así que **el push de los dos avisos agregados lleva el número dentro** —
«5 novedades esperan tu decisión», el literal del lienzo aprobado.

Consecuencias, las tres escritas para que ninguna parezca un olvido:

1. **Con conteo** → el título es el compuesto (`tituloNovedadesSinGestionar(5)`) y el cuerpo la
   descripción persistida. Es la mitad numerada de R52.
2. **Sin conteo** —los otros seis eventos elegibles, y también cuando el resolutor FALLA— → el push
   sale con el texto persistido, en singular y **sin afirmar cantidad**. Es la mitad por defecto de
   R52, y falla hacia NO AFIRMAR a propósito.
3. **Con cifra CERO** → `presentacionDe` devuelve `null` y **no se envía nada**: el aviso se apagó
   solo mientras el trabajo esperaba en la cola. Es la tercera regla antirruido.

### Nota de método (regla 7 de `CLAUDE.md`), dicha en voz alta

**El MCP `codebase-memory` SÍ estaba en mi conjunto de herramientas, y NO lo usé.** Toda la
localización se hizo con `grep`/`glob` y leyendo los archivos reales. No es una queja ni una
excusa: es lo que hice, y se dice porque la regla pide empezar por el grafo. Lo que sí se cumplió
sin excepción es la otra mitad de esa regla —«el archivo dice QUÉ hay»—: ni una conclusión de este
informe sale de un índice, todas salen de leer el archivo o de ejecutar.

---

## §1 — Archivos creados y modificados

### Nuevos

| Archivo | Qué es |
| --- | --- |
| `db/migrations/20260912120000_push_suscripcion/{migration,down}.sql` | `push_suscripcion` + `push_envio_dia`, sus índices y la RLS de las dos |
| `db/migrations/20260912120100_job_tipo_push_web/{migration,down}.sql` | `job_tipo += push_web`, **en carpeta aparte** (55P04) |
| `lib/config/push.ts` | `loadPushConfig`, `pushConfigurado`, `clavePublicaPush`, `piezasVapidAusentes`, `PushNoConfiguradoError`. Espejo de `lib/config/email.ts` |
| `lib/interfaces/external/IPushSender.ts` | `PushOutcome` (`ok` / `caducada` / `transitorio` / `rechazada`), calcado de `IWebhookSender` |
| `lib/interfaces/repositories/IPushSuscripcionRepository.ts` | contrato del canal: upsert, bajas, listado, sello y **el cupo** |
| `lib/interfaces/repositories/IPushNotificacionReader.ts` | contrato de las dos lecturas del drenador |
| `lib/interfaces/services/IPushWebService.ts` | contrato del servicio de entrega |
| `lib/notificaciones/push-elegibles.ts` | **el catálogo**, `satisfies Record<NotificacionEvento, PerfilPush>`. Módulo PURO |
| `lib/notificaciones/notificacion-repo-con-push.ts` | **el decorador**: el único punto de cableado |
| `lib/notificaciones/best-effort.ts` | `emitirBestEffort`, extraída de `notificadores.ts` (ver §2.3) |
| `lib/repositories/PushSuscripcionRepository.ts` | solo Prisma: upsert por endpoint, bajas, listado, sello, toma de cupo |
| `lib/repositories/PushNotificacionReader.ts` | solo Prisma: la fila del aviso y sus destinatarios pendientes |
| `lib/services/PushWebService.ts` | la política: relee, resuelve, compone y aplica la tabla de desenlaces |
| `lib/services/jobs/push-web-handler.ts` | handler delgado + composition root, **sin lanzar si faltan las claves** |
| `lib/push/web-push-sender.ts` | único archivo que conoce `web-push`; traduce a `PushOutcome` |
| `lib/actions/push.ts` | `obtenerClavePublicaPush`, `registrarSuscripcionPush`, `eliminarSuscripcionPush` |
| `lib/types/push.ts` | schemas zod `strict()` + resultados tipados |
| `public/icons/badge-72.png` | el glifo `package` de lucide, blanco sobre transparente, 72×72 (D8) |

### Modificados

| Archivo | Cambio |
| --- | --- |
| `db/schema.prisma` | +`PushSuscripcion`, +`PushEnvioDia`, +`push_web` en `JobTipo`, +2 relaciones en `Usuario` |
| `lib/interfaces/repositories/INotificacionRepository.ts` | `crear` → `Promise<string \| null>` |
| `lib/repositories/NotificacionRepository.ts` | `crear` devuelve el id; **+`predicadoDestinatariosDeAviso`**, pegado a `predicadoVisibilidad` |
| `lib/notificaciones/emitir.ts` | `emitirFilas` compara `!== null` |
| `lib/notificaciones/notificadores.ts` | `repoReal()` decorado (la única línea de cableado) + re-export de `emitirBestEffort` |
| `app/api/cron/procesar-jobs/route.ts` | registra el handler `push_web` |
| `public/sw.js` | +`push`, +`notificationclick`, dentro de la rama de **producción** |
| `lib/pwa/actualizacion.ts` | +`MENSAJE_PUSH_RECIBIDO` |
| `.env.example` | +3 nombres VAPID, con cómo se generan y el aviso de darlas de alta **por entorno** |
| `package.json` / `pnpm-lock.yaml` | +`web-push@^3.6.7`, +`@types/web-push@^3.6.4` |
| 12 archivos de test | los dobles de `crear` y los censos literales (§6) |

**NO se tocó:** `components/`, `hooks/`, `app/(app)/**`, `feature_list.json`, `progress/current.md`,
`predicadoVisibilidad`, ni **ningún `down.sql` anterior**.

---

## §2 — Las cuatro decisiones que este backend tomó, y por qué

### 2.1 — ⚠️ EL HALLAZGO: el `down.sql` del enum ya no funcionaba, y no por mi lista

El `down.sql` de un `job_tipo` nuevo recrea el tipo (`RENAME TO …_old` → `CREATE TYPE` →
`ALTER TABLE jobs ALTER COLUMN tipo TYPE …` → `DROP TYPE …_old`). Copié el de la hermana más
reciente (`20260827100000_job_tipo_whatsapp_bienvenida`) y **el rollback murió**:

```
ERROR: el operador no existe: job_tipo = job_tipo_old
```

**Causa, medida y no deducida:** la ficha 401 creó el 2026-09-10 el índice **PARCIAL**
`jobs_geocodificacion_estado_updated_idx`, cuyo predicado es `WHERE "tipo" = 'geocodificacion'`. Ese
literal queda tipado como `job_tipo_old` en cuanto se renombra el tipo, y el `ALTER … USING` —que
reconstruye los índices dependientes— compara el tipo nuevo contra el viejo y aborta. Mi `down.sql`
lo **suelta antes y lo recrea después**, idéntico a como lo escribió su propia migración.

Las ocho hermanas anteriores **no se tocan y siguen siendo correctas**: `db:rollback` va de la
última hacia atrás, así que cuando les llega el turno el índice de la 401 ya no existe.

### 2.2 — ⚠️ `push_envio_dia.evento` es la SEGUNDA columna que usa `notificacion_evento`

Y eso cambió una regla vigente desde la 146. Los `down.sql` que amplían ese enum lo recrean
retipando **una** columna (`notificacion.evento`); con la mía viva, el `DROP TYPE …_old` muere con
`2BP01`. **Doce archivos rojos de golpe en el primer gate** — cinco de ellos por esto.

Lo que se hizo, y lo que NO:

- **NO** se tocó ninguno de esos `down.sql`: en un rollback real la tabla ya no existe cuando les
  toca el turno, porque la migración de push es POSTERIOR a todas ellas. Siguen siendo ciertos.
- **SÍ** se arreglaron sus CONTROLES de test, que ejecutan un `down` histórico contra la base de
  HOY: se les añadió `soltarDependientesPosterioresDelEnumDeEventos(tx)`
  (`tests/integration/db/_postgres-real.ts`), que pone la base en el estado del rollback real.
- **Y queda escrito donde se lea**: el `down.sql` de una migración FUTURA que amplíe
  `notificacion_evento` tendrá que retipar **las dos** columnas. Si se olvida falla con el mismo
  `2BP01`, RUIDOSAMENTE, y los cinco tests de migración lo cazan. Está en `db/schema.prisma` junto
  al modelo y en el propio helper.

### 2.3 — `emitirBestEffort` se mudó a su propio archivo (y se re-exporta)

`notificadores.ts` importa el decorador para cablearlo en `repoReal()`, y el decorador necesita
`emitirBestEffort`: dejarla donde estaba cerraba un ciclo de imports. Vive en
`lib/notificaciones/best-effort.ts` y `notificadores.ts` la **re-exporta**, así que los veintitantos
importadores que ya existían no cambian ni una línea.

### 2.4 — El trabajo lleva SOLO `{ notificacionId }`, y quién suena se relee del cupo

El design §7 fija el payload en un campo. Pero el cupo se toma **antes** de encolar y por
destinatario, así que al ejecutar hay que saber **para quién** ganó ESE aviso. La respuesta la da la
columna `push_envio_dia.notificacion_id`: el envío consulta `usuariosConCupoDe(notificacionId)` y
cruza ese conjunto con los destinatarios pendientes. Así:

- el payload sigue siendo un campo (nada de texto, destino ni destinatario obsoletos);
- alguien que ya gastó su cupo hoy con **otro** aviso del mismo tipo no vuelve a sonar (R6);
- se consulta por `notificacion_id` y **no** por (evento, día) a propósito: el trabajo puede
  ejecutarse un minuto después y cruzar la medianoche de Costa Rica, y una consulta por jornada no
  encontraría nada — el push se perdería en silencio.

---

## §3 — Mapa `R<n> → test`

> Los literales de texto se afirman **a mano**, nunca contra la función que los compone.
> `PE` = `tests/unit/notificaciones/push-elegibles.test.ts` · `DEC` =
> `tests/unit/notificaciones/notificacion-repo-con-push.test.ts` · `SVC` =
> `tests/unit/services/push-web-service.test.ts` · `SND` = `tests/unit/push/web-push-sender.test.ts`
> · `CFG` = `tests/unit/config/push-config.test.ts` · `ACC` =
> `tests/unit/actions/push-action.test.ts` · `SW` = `tests/unit/guards/pwa-push.guardia.test.ts` ·
> `CAB` = `tests/unit/guards/push-cableado-unico.guardia.test.ts` · `JOB` =
> `tests/unit/guards/jobs-handler-por-tipo.guardia.test.ts` · `DB-R` =
> `tests/integration/db/push-canal-restricciones.test.ts` · `DB-C` =
> `tests/integration/db/push-cupo-carrera.test.ts` · `DB-D` =
> `tests/integration/db/push-destinatarios-equivalencia.test.ts` · `DB-M` =
> `tests/integration/db/push-migration.test.ts`

### Cubiertos por este backend (41 de 52)

| R | Test |
| --- | --- |
| R1 | `PE` › «son OCHO elegibles y CINCO no» + `DEC` › «un evento elegible cuyo LECTOR no lo es: se consulta, pero no se encola» |
| R2 | `PE` › «las claves del catalogo son exactamente los valores del enum de Prisma» + `pnpm run typecheck` (el `satisfies Record<…>` no compila con un valor sin decidir) |
| R3 | `PE` › «ninguno de los cinco se pushea a NINGUN rol» (+ control positivo anti-vacío) y «cada entrada NO elegible declara su porque» |
| R4 | `PE` › «`cierre_dia_vencido` se pushea al mensajero y NO a la bodega» y las otras cuatro parejas |
| R5 | `DEC` › «encola una vez…» (`base.creadas` es 1: el push no crea ninguna fila) |
| R6 | `DEC` › «el SEGUNDO aviso elegible del mismo dia NO encola nada» + `DB-R` › «el primero gana, el segundo devuelve `false`» + `SVC` › «un destinatario pendiente SIN cupo no recibe nada» |
| R7 | `DB-C` › «`Promise.all` de dos emisiones sobre DOS CONEXIONES: un cupo, un encolado» + «MUTACION: `SELECT`-y-luego-`INSERT` deja pasar a los dos» |
| R8 | `SVC` › «el aviso fue borrado…» y «todos lo leyeron o lo descartaron…» + `DB-D` › «de tres admins, el que leyo y el que descarto quedan fuera» |
| R9 | `SVC` › «titulo, cuerpo, destino y evento; y NADA que el aviso no trajera» (literales a mano) |
| R13 *(mitad servidor)* | `ACC` › «R13/R30: sin canal configurado devuelve `null`, que NO es un error» |
| R15 *(mitad servidor)* | `ACC` › «la baja tambien va acotada al actor de sesion» |
| R16 | `DB-R` › «el MISMO dispositivo dos veces deja UNA fila» + «MUTACION R18: con la unicidad en (usuario, endpoint) habria DOS filas vivas» |
| R17 | `DB-R` › ídem (las claves se renuevan, la fila no se duplica) |
| R18 | `DB-R` › «otra persona inicia sesion en el mismo telefono y la suscripcion CAMBIA de dueno» |
| R19 *(mitad servidor)* | `ACC` › «la baja tambien va acotada al actor de sesion» |
| R20 *(mitad servidor)* | `ACC` › «sin fila que borrar, la accion devuelve `ok`» |
| R21 | `DB-D` › «un `adminTienda` inactivo queda fuera del conjunto de push» |
| R22 | `DB-R` › «CASCADE en las dos tablas, ejercitado contra el motor» + `DB-M` › «las dos FK a `usuario` son CASCADE» |
| R23 | `SND` › «barrido sobre TODOS los desenlaces con detalle» + `SVC` › «barrido sobre todos los mensajes de una corrida con desenlaces mixtos» |
| R24 | `DB-D` › «los cuatro alcances dan EXACTAMENTE el mismo conjunto por las dos vias» |
| R25 | `DB-D` › ídem (+ la mitad negativa: ningún rol ajeno) + «MUTACION R25: sin la rama de ZONA…» |
| R26 | `SVC` › «tres dispositivos: la del medio falla y las otras dos se entregan igual» |
| R27 | `DEC` › «con `tx`, el decorador delega y NO encola: el push jamas va dentro de una transaccion» |
| R28 | `DEC` › «la cola revienta: `crear` devuelve el id igualmente y el error se loggea con su operacion» (+ el lector) |
| R29 | `CFG` › «`.env.example` documenta los tres NOMBRES y ninguno lleva valor» + «ningun archivo de codigo asigna una clave VAPID a un literal» |
| R30 | `CFG` › «`pushConfigurado()` es false y ni una de las tres funciones lanza» + `SVC` › «no lanza, no envia, y el log nombra la variable ausente» + `DEC` › «el aviso se crea igual y la cola queda intacta» + `JOB` › «construir el registro no lanza…, tampoco sin claves VAPID» |
| R31 | `CFG` › «el mensaje del error cita el NOMBRE y jamas el valor de la privada» + `ACC` › «el fuente de la accion no nombra la clave PRIVADA por ningun lado» |
| R32 | `CFG` › «cambiar la variable cambia lo que se sirve, sin reconstruir nada» + `ACC` › «se sirve la que haya en ese momento» |
| R33 | `SND` › «404 -> caducada» y «410 Gone -> caducada» + `SVC` › «`caducada`: la suscripcion se BORRA y el trabajo TERMINA» (+ su mutación) |
| R34 | `SND` › «429 / 500 / red -> transitorio» + `SVC` › «`transitorio`: LANZA, que es como la cola sabe que tiene que reintentar» + `DEC` › `maxIntentos = 3` |
| R35 | `DEC` › «R35: emitir DOS VECES el mismo aviso no produce un segundo trabajo» |
| R36 | `JOB` › «cada valor de `job_tipo` tiene su handler en `buildHandlers`» + los cinco desenlaces de `SVC` que **terminan sin lanzar** |
| R37 | `SW` › «la notificacion lleva EXACTAMENTE lo que vino en el payload» |
| R38 | `SW` › «`json()` que lanza -> titulo y cuerpo de reserva», «un push SIN cuerpo», «un payload SIN titulo», «un destino que no es una ruta de la app» |
| R39 | `SW` › «`focus()` y `navigate(destino)`, y NO se abre una segunda pestaña» (+ la mutación sobre el fuente) |
| R40 | `SW` › «`openWindow(destino)`» y «sin `data`, se abre la portada» |
| R41 | `SW` › «la etiqueta se deriva del evento y `renotify` es false (reemplaza, no apila)» |
| R42 | `SW` › «en `localhost` el SW se autodestruye y NO registra `push`» + «los dos manejadores estan DENTRO del `else` de produccion» |
| R43 *(mitad SW)* | `SW` › «`postMessage` con el mensaje acordado, solo a la ventana visible» + «el literal del mensaje NO diverge entre el bundle y el service worker» |
| R44 | `DEC` › «los dos metodos delegan y no tocan la cola» |
| R46 *(mitad servidor)* | `SVC` › «R46: un destinatario SIN suscripciones no es un fallo» |
| R47 | `DB-R` › «`relrowsecurity` es true en `push_suscripcion` y en `push_envio_dia`» + «y no tienen policies» |
| R48 | `SVC` › «R48: cuatro campos y ni uno mas» (`Object.keys(carga).sort()`) |
| R49 | `DB-M` (15 casos) + la ejecución real up → down → up contra la base local (§4) |
| R50 | `ACC` › «con un `usuarioId` en el cuerpo: `validation_error`, y NADA se escribe» + «la suscripcion se registra a nombre del actor de sesion» |
| R51 | `CAB` (10 casos: `repoReal()` decorado, los doce bindings por `repoReal()`, `new NotificacionRepository(` una sola vez, el productor futuro, y el camino REAL ejecutado) |
| R52 | `SVC` › «CON conteo: el titulo lleva la cifra viva», «SIN conteo: singular, sin cantidad, y NO se inventa un numero», «el aviso AGREGADO se APAGA SOLO: con cifra 0 no se envia nada» |

### De la parte de FRONTEND (declarados, no olvidados)

**R10, R11, R12, R14, R45** enteros, y las **mitades de cliente** de **R13, R15, R19, R20, R43 y
R46**. Van en `progress/impl_410_frontend.md`. En concreto:

| R | Qué falta, y dónde va |
| --- | --- |
| R10 | «al montar NO se llama a `requestPermission`» — unit de `hooks/usePushSuscripcion.ts` (T5.1) |
| R11 | el permiso solo tras el gesto explícito — T5.1 |
| R12 | `denied` no se vuelve a pedir y se explica cómo revertirlo — T5.1 / T5.2 |
| R14 | los tres estados del control — T5.2 |
| R15 (cliente) | `unsubscribe()` **y** la acción de borrado — T5.1 |
| R19/R20 (cliente) | el `LogoutButton` da de baja **antes** de `logout()` y el fallo no impide salir — T5.5 |
| R43 (app) | la campana revalida y **suprime su tono** para ese incremento — T5.4 |
| R45 | la instrucción de **instalar en la pantalla de inicio** en el hueco exacto del control — T5.2 |
| R46 (cliente) | sin suscripción, la campana sigue igual — T5.2 |

---

## §4 — Las migraciones, ejercitadas de verdad

**Dos, y la del enum va sola** (55P04). Contra la base local (`localhost:5432/ordenex`, confirmado
con `prisma migrate status` sin exponer credencial):

```
prisma migrate deploy                          -> aplicadas las DOS
pnpm run db:rollback                           -> ✗ ERROR: el operador no existe: job_tipo = job_tipo_old
  (arreglo del down.sql: soltar y recrear el indice parcial de la 401)
pnpm run db:rollback                           -> «Rollback completado: 20260912120100_job_tipo_push_web»
prisma db execute --file .../push_suscripcion/down.sql  -> las dos tablas fuera
  (+ DELETE de su fila en _prisma_migrations, que es lo que hace `db:rollback` por dentro)
prisma migrate deploy                          -> aplicadas de nuevo, las dos
prisma migrate status                          -> «Database schema is up to date!»
prisma migrate diff --from-config-datasource   -> «-- This is an empty migration.» (CERO drift)
```

⚠️ **Por qué el segundo `down` se ejecutó a mano y no con `pnpm run db:rollback`:**
`scripts/db-rollback.ts` elige la **última carpeta por nombre**, no la última migración *aplicada*.
Tras revertir la del enum, la carpeta más nueva sigue siendo la suya, así que un segundo
`db:rollback` vuelve a intentar la misma y muere con «la sintaxis de entrada no es válida para el
enum job_tipo: «push_web»». Es una limitación del script, no de estos `down.sql`; se ejercitó el
archivo con `prisma db execute`, que es **exactamente** lo que el script hace por dentro. Queda
anotado como límite, no como excusa.

⚠️ **La lista del `down.sql` del enum es una FOTO de esta rama** (los nueve valores previos, leídos
de `db/schema.prisma` en `origin/dev` @ `ca697141`). Si otra ficha añade un valor a `job_tipo` y
entra en `dev` antes que ésta, **hay que releerla antes del PR**: revertir con la lista vieja
borraría ese valor en silencio. Le pasó a la 401 con la 403. Lo comprueba `DB-M` › «recrea el enum
con los NUEVE valores previos».

---

## §5 — El gate

`./init.sh` **COMPLETO**, y no por elección: el diff toca `db/migrations/**`, `db/schema.prisma`
**y** `package.json`. El modo rápido se niega solo, por partida triple.

`INIT_EXIT` va escrito **DENTRO** del log (`progress/gate_410_backend.log`), inmediatamente después
del comando. El exit code que devuelve el runner **no sirve**: en este mismo trabajo la **primera**
corrida, que fue ROJA, llegó anunciada por el runner como «exit code 0». No se canalizó por `tail`.

### Corrida final — VERDE

```
== Arnes SDD :: init (modo: completo) ==
✓ node v24.13.0
✓ dependencias presentes
✓ feature_list.json: sin ids duplicados (412 fichas), cupo por zona respetado (in_progress=2) y specs en su sitio
✓ typecheck paso
✓ lint paso                      (184 warnings, 0 errores; NINGUNO en un archivo de esta ficha)
✓ DATABASE_URL resuelta: los 163 archivos de tests contra Postgres SI se ejecutan
 Test Files  1912 passed (1912)
      Tests  27685 passed | 26 skipped (27711)
✓ tests: sin rojos nuevos (0 archivo(s) rojo(s) sobre 1912 ejecutado(s), todos en el baseline conocido)
✓ .env presente
== init OK ==
INIT_EXIT=0
```

### Los `integration/db` CORRIERON — con nombre y número

`.env` copiado del checkout principal **tras comprobar que su `DATABASE_URL` activa apunta a
`localhost:5432/ordenex`** y no a Supabase (la línea de Supabase está comentada). Está gitignorado y
**no** entra en ningún commit.

- El gate lo dice antes de correr: **«los 163 archivos de tests contra Postgres SI se ejecutan»**.
- Contados en la salida de la corrida final: **248 archivos bajo `tests/integration/db/` ejecutados
  con `✓`**, y **CERO saltados**. Los 26 `skipped` de la suite son de otras familias.
- Los **cuatro** archivos de `integration/db` de esta ficha, con sus casos:

```
✓ tests/integration/db/push-canal-restricciones.test.ts       (7 tests)
✓ tests/integration/db/push-destinatarios-equivalencia.test.ts (4 tests)
✓ tests/integration/db/push-cupo-carrera.test.ts              (4 tests)
✓ tests/integration/db/push-migration.test.ts                (15 tests)
```

Nueve más en `unit/`: `push-config` (11), `push-elegibles` (17), `notificacion-repo-con-push` (15),
`web-push-sender` (11), `push-web-service` (24), `push-action` (14), `push-cableado-unico` (10),
`pwa-push` (20), `jobs-handler-por-tipo` (5). **157 casos nuevos en 13 archivos.**

### La corrida ANTERIOR fue ROJA, y qué era — las doce, una por una

`INIT_EXIT=1`, «rojos NUEVOS respecto del baseline: 12 archivos». **Las doce eran mías**, y ninguna
era deuda ajena ni un flake. Se agrupan en tres familias:

| Familia | Archivos | Qué pedían |
| --- | --- | --- |
| **Censos LITERALES que crecen** (se ponen rojos a propósito cuando el inventario crece; que se pusieran rojos ES la prueba de que sigue cerrado) | `procesar-jobs-geocodificacion`, `procesar-jobs-webhook-estado`, `job-tipo-whatsapp-bienvenida-migration`, `schema-drift-saneamiento`, `api-key-dependencias-usuario.guardia` | +`push_web` en los dos conjuntos EXACTOS de handlers; el censo de `updated_at` con default pasa de OCHO a NUEVE tablas; y las DOS relaciones nuevas hacia `Usuario`, clasificadas **con motivo** |
| **La dependencia nueva del enum** (§2.2) | los CINCO `notificacion-evento-*-migration` | ejecutar un `down.sql` histórico contra la base de hoy exige soltar antes `push_envio_dia` |
| **Los dobles de `crear`** | `notificacion-repository` | `crear` devuelve el id, no un booleano |

Casos especiales, dichos aparte porque no son un censo:

- **`superficie-de-uso.guardia`**: las tres Server Actions de `lib/actions/push.ts` no las importa
  nadie **todavía** — su superficie es la tanda 5, que es del frontend. Se anotaron con
  `/** @sin-superficie … */` **y su motivo**, diciendo qué archivo se las va a dar. ⚠️ **Esa
  anotación CADUCA**: la guardia se pone roja si lo anotado vuelve a ser alcanzable, así que quien
  monte el control tiene que borrarla. Está escrito junto a las tres.
- **`job-tipo-whatsapp-bienvenida-migration`** exigía que el enum **TERMINARA** en su valor. Eso ya
  no puede ser suyo: se cambió a que sus nueve valores estén **al principio y en ese orden** (que es
  lo que su migración sí puede prometer, porque el orden decide la comparación del enum) y a que su
  propio valor siga existiendo.

---

## §6 — Las once mutaciones

> **Arnés con autocomprobación, por la lección del que mintió 9/9 sin ejecutar un test.** Corre
> contra el árbol **COMMITEADO** (`886ff7ce`) y: (a) aborta si el árbol no está limpio antes de
> empezar; (b) imprime el `git diff --stat` de cada mutación y aborta si sale vacío; (c) aborta si
> una corrida ejecuta **0 tests**; (d) revierte con `git checkout -- .` y **vuelve a comprobar** que
> el árbol quedó limpio antes de seguir.
> **Línea base sin mutar: 127 tests en los 8 archivos objetivo, 0 rojos.**

| # | Mutación | Rojos | Dónde saltó |
| --- | --- | --- | --- |
| M1 | quitar la toma de cupo (el decorador encola siempre) | **5 / 19** | `DEC` › «el SEGUNDO aviso elegible del mismo dia NO encola nada» y otros tres + `DB-C` › la carrera → **R6/R7** |
| M2 | invertir el cupo (siempre ocupado): el PRIMERO no sale | **7 / 19** | `DEC` › «encola una vez…» + `DB-C` → **R6** |
| M3 | `caducada` tratada como transitorio | **2 / 24** | `SVC` › «`caducada`: la suscripcion se BORRA y el trabajo TERMINA» → **R33** |
| M4 | quitar la rama de ZONA del predicado de destinatarios | **2 / 4** | `DB-D` › «los cuatro alcances…» y «MUTACION R25…» → **R24/R25** |
| M5 | marcar elegible un evento de la lista negativa (`carga_masiva_terminada`) | **2 / 17** | `PE` › «son OCHO elegibles y CINCO no» y «ninguno de los cinco se pushea a NINGUN rol» → **R1/R3** |
| M6 | `repoReal()` devuelve el repositorio SIN decorar | **3 / 10** | `CAB` › «el `return` PASA el repositorio por `conPushWeb(…)`», «las cuatro piezas…» y **el camino REAL ejecutado** → **R51** |
| M7 | quitar `focus()` del `notificationclick` | **2 / 20** | `SW` › «`focus()` y `navigate(destino)`…» y «con VARIAS ventanas…» → **R39** |
| M8 | faltan las claves VAPID | *(ver abajo)* | **no es un «debe romper»: es un «no debe romper nada»** |
| M9 | un productor NUEVO que construye su repositorio sin `repoReal()` | **5 / 43** | `CAB` (4 casos) + `notificacion-notificadores-reales` › «cada `notificar*Real` … lo PASA algún fichero» → **R51** |
| M10 | `geocodificacion_caida` también elegible para `admin` | **1 / 17** | `PE` › «el `admin` NO recibe push, aunque la campana SI le mande el aviso» → **D4** |
| M11 | el push afirma una cantidad sin conteo disponible | **1 / 24** | `SVC` › «SIN conteo …: singular, sin cantidad, y NO se inventa un numero» → **R52** |

**Supervivientes: NINGUNO.**

**M8 no se mide como las otras, y merece su párrafo.** Lo que pide no es un rojo sino lo contrario:
que **nada** lance y que el control **no** se ofrezca. Y resulta que esa mutación está **aplicada de
forma permanente** en esta máquina: `.env` tiene **cero** ocurrencias de `VAPID`, así que la suite
entera corre con el canal SIN CONFIGURAR. Medido: los **90 tests** de los 7 archivos del canal pasan
en verde con el entorno real, y entre ellos están los cuatro que lo afirman explícitamente —
`pushConfigurado()` es `false`, ninguna de las tres funciones de config lanza, el decorador no
encola nada, el handler se construye sin lanzar y el servicio TERMINA citando el nombre de la
variable ausente—.

Dos honestidades sobre el conteo, porque un número grande no siempre es mejor:

- **M10 y M11 matan UN test cada una**, y es el correcto: son decisiones de una sola frase con un
  solo aserto que las nombra. Lo que importa es que ese aserto **existe y se pone rojo**, no cuántos
  arrastra.
- **La carrera del cupo (`DB-C`) tiene una honestidad que hay que decir**: el caso principal afirma
  «exactamente un cupo, exactamente un encolado», y eso se cumpliría **también** si las dos llamadas
  se hubieran serializado solas. Lo que demuestra que la ventana existe de verdad es el **segundo**
  caso, el de la mutación `SELECT`-y-luego-`INSERT`, que usa una **barrera explícita** para que las
  dos conexiones lean antes de que ninguna escriba y afirma `[true, true]`: **las dos leyeron cero**
  y lo único que impidió la segunda fila fue el índice.

**Nada se re-midió después:** desde la corrida de mutaciones, los únicos archivos de producción que
cambiaron son `lib/actions/push.ts` (tres comentarios `@sin-superficie`) y `db/schema.prisma` (un
comentario). Ninguno es objetivo de ninguna de las once.

---

## §7 — ⚠️ LOS DOS AVISOS PROMETIDOS QUE ESTA FICHA **NO** ENTREGA

`design-notificaciones/Push.dc.html` le promete al mensajero cuatro avisos. **Dos de ellos NO
EXISTEN como evento**, y esta ficha **no los crea**: entrega el CANAL, no el catálogo (decisión del
humano del 2026-09-10, D1). Se escribe aquí porque **en el lienzo aparecen dibujados**, con su
tarjeta y su texto, y ahí es exactamente donde alguien los daría por hechos.

| Prometido en el lienzo | Qué hay de verdad, medido en `db/schema.prisma` | Estado |
| --- | --- | --- |
| **«Tu cierre del lunes fue rechazado»** (un rechazo que **no** bloquea) | NO existe evento de rechazo de cierre. Si el rechazo además deja al mensajero bloqueado, se avisa por `mensajero_bloqueado_por_cierres` —uno de sus tres productores es justamente el rechazo—. **Un rechazo que no bloquea no produce hoy ningún aviso, ni en la campana.** | **SIN CUBRIR** · ficha aparte (412) |
| **«Tu reparto de mañana»** | NO existe **nada**: ni valor en el enum, ni emisor, ni cron, ni productor. | **SIN CUBRIR** · ficha aparte (413) |

Los otros dos del lienzo sí están: «quedó bloqueado» (`mensajero_bloqueado_por_cierres`) y «le
cambiaron el día de reparto» (`dia_reparto_corregido`).

Cuando esos dos eventos existan, entran al canal **con una línea**: R2 obliga a que el enum **no
compile** hasta que alguien decida su elegibilidad, así que no pueden colarse ni quedarse fuera en
silencio.

---

## §8 — Lo que NO se pudo hacer, con nombre

| Tarea | Estado |
| --- | --- |
| **T6.4** — alta de las tres variables VAPID en Vercel, POR ENTORNO | **NO HECHA.** No tengo acceso a Vercel desde este agente. **Es bloqueante para que el canal funcione en producción**: sin ellas el control no se ofrece y no sale ningún push (y eso, por R30, es silencioso y correcto — pero silencioso). Producción y *preview* por **separado**: una variable marcada en los dos a la vez apunta al proyecto equivocado en uno. La privada **no** se pega en ningún informe |
| **T6.5** — comprobación en un teléfono real | **NO HECHA, y es la única prueba de que el canal existe.** Todo lo verificado aquí es jsdom, Postgres y un arnés que ejecuta `public/sw.js` en un `new Function`. La entrega real depende de servicios de terceros que ninguna suite de este repo toca. Queda como **límite abierto**, no dado por bueno. Además necesita T6.4 y el control de la tanda 5 |
| **T6.2** (el mapa de los 52) | **Incompleto a propósito:** 41 son míos y están arriba; los 11 del frontend quedan **declarados** con su tarea, no olvidados |
| **T6.6** — entrada en `progress/history.md` | Es del leader. Mi bitácora sí va commiteada |
| **`db:rollback` en dos pasos** | Limitación del script, explicada en §4. No es de estos `down.sql` |

---

## §9 — Qué le dejo al frontend

**Todo lo de servidor está en pie y probado. Lo que falta es la superficie.**

### La API que va a consumir

```ts
// lib/actions/push.ts
obtenerClavePublicaPush()            -> { status: "ok", clavePublica: string | null } | ActionError
registrarSuscripcionPush(input)      -> { status: "ok" } | ActionError
eliminarSuscripcionPush({ endpoint }) -> { status: "ok" } | ActionError
```

- `clavePublica: null` significa **«este despliegue no tiene canal»** → por R13 el control **no se
  ofrece**. No es un error y no hay que pintarlo como tal.
- `registrarSuscripcionPush` toma `{ endpoint, p256dh, auth, etiqueta? }` y **nada más**: el schema
  es `strict()`, así que mandar un `usuarioId` da `validation_error`. El dueño sale de la sesión.
- Desactivar dos veces devuelve `ok`. Un endpoint que no está devuelve `ok`. Es deliberado: el
  cierre de sesión no puede quedarse decidiendo qué hacer con un `not_found` (R20).

### El mensaje del service worker (R43)

`MENSAJE_PUSH_RECIBIDO` (`"ordenex:push-recibido"`), exportado de `lib/pwa/actualizacion.ts`. El SW
lo manda por `postMessage` **solo a las ventanas visibles**, con `{ tipo, destino }`. La app tiene
que **revalidar la campana y suprimir su tono** para ese incremento: el navegador obliga a mostrar
la notificación del sistema igualmente, así que sin la supresión se oyen **dos** avisos del mismo
hecho. La guardia `pwa-push.guardia.test.ts` ya comprueba que el literal no diverge entre los dos
archivos; falta la mitad de la app (T5.4).

### Tres cosas que hay que hacer, y que la suite va a recordar

1. **Borrar las tres anotaciones `@sin-superficie`** de `lib/actions/push.ts` al montar el control.
   La guardia `superficie-de-uso` se pone **roja** si lo anotado vuelve a ser alcanzable: una
   excepción que sobrevive a su motivo es basura que crece.
2. **R45 no es cortesía, y tiene precio medido (D6):** 8 personas entran desde iPhone o iPad y
   **3 usan SOLO iOS — las tres, mensajeras**. En Safari sin instalar, `PushManager` no existe y por
   R13 el control **no aparece**. La instrucción de «Compartir → Añadir a inicio» va **en el hueco
   exacto del control**, no en una ayuda ni en un pie: esas tres van a buscar el interruptor al
   mismo sitio que las otras 36, y un hueco vacío se lee como una avería.
3. **Nada de «SLA» ni siglas** en el texto visible. Plazo, vencimiento, fecha.

### Lo que NO hay que tocar

`predicadoVisibilidad`, el catálogo de push, el decorador y `emitirFilas`. Y **no** hace falta
cablear ningún notificador nuevo: el canal está cableado en **un** punto (`repoReal()`) y hay una
guardia que lo defiende.

---

## §10 — Veredicto

El canal está construido, cableado en un punto único y vigilado; las dos migraciones aplican y
revierten; las once mutaciones murieron; el gate completo termina en `INIT_EXIT=0` con los 248
archivos de `integration/db` ejecutados y ninguno saltado. **Nadie ha visto todavía un push en un
teléfono** (T6.4 y T6.5 quedan abiertas, con nombre), y **los dos avisos del lienzo que no existen
como evento siguen sin existir**: son las fichas 412 y 413.
