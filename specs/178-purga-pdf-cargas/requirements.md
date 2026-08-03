# Feature 178 — Job semanal de purga de los PDF de cargas antiguas (retención parametrizable)

Requisitos en notación EARS. Cada `R<n>` termina mapeado a un test concreto en `tasks.md`
(tabla `R<n>→test`, `docs/specs.md` §Trazabilidad). Sin detalles de implementación: el CÓMO
vive en `design.md`.

**Alcance:** backend puro, sin UI y sin endpoint nuevo de negocio. Un trabajo recurrente
**semanal** que, **agrupando por `carga_id`**, para cada carga cuya fecha de corte tenga más de
`N` días borra del bucket privado de etiquetas:

1. el PDF **CONSOLIDADO** del lote, y
2. los PDF **INDIVIDUALES** de **todas** las órdenes de ese lote,

y deja a NULL, en las filas afectadas, **las dos** columnas testigo: `download_url` **y**
`download_storage_path` (esta última es la que la feature 177 usa para decidir si el PDF
existe). `N` sale de variable de entorno, default 7, mínimo 1, sin tope superior.

**Objetivo:** que el bucket de etiquetas no crezca sin freno con etiquetas que ya nadie descarga.

**Fuera de alcance (declarado, no olvidado):**

- Las órdenes con `carga_id` NULL (alta manual, órdenes anteriores a la feature 141): ver
  §Fuera de alcance declarado (d) y R17.
- Los objetos del bucket cuya ruta **nunca se persistió** (etiquetas de las features 136/141:
  solo se guardó la URL firmada): ver §Limitación heredada.
- Cambiar cómo la 136/141 genera o persiste hoy sus URLs; cambiar el contrato de los endpoints
  `/generate` de la 177; UI de configuración de la retención; borrado bajo demanda.

## Decisiones YA TOMADAS por el humano (no se reabren)

- **Alcance del borrado:** el PDF consolidado de la carga **Y** los PDF individuales de todas
  las órdenes de esa carga.
- **Configuración de la retención:** por **variable de entorno**. Ni UI, ni tabla de config, ni
  query param. Default **7** días, validación **`>= 1`**, **sin tope superior**.
- **Obligación heredada de la 177:** la purga pone a NULL **también** `download_storage_path`
  (en `orden` **y** en `carga`), y `/generate` debe volver a generar después de la purga (R16).

## Terreno verificado contra el código (no supuesto)

- `db/schema.prisma:590-610` — `Carga` tiene **`fechaCarga` (`fecha_carga`, `@default(now())`)
  Y `createdAt` (`created_at`, `@default(now())`)**. Índices existentes: `carga_usuario_carga_idx`
  y `carga_fecha_carga_idx`; **`created_at` NO está indexado** en `carga`. Búsqueda en todo el
  repo: **ningún código escribe `fechaCarga` explícitamente** — hoy solo lo pone el default, así
  que ambas columnas coinciden; `specs/141-tabla-cargas-orden/design.md:60-61` declara a propósito
  que `fecha_carga` "podría fijarse en el futuro" por el usuario. De ahí la pregunta abierta (a).
- `db/schema.prisma:515-522` — `Orden.cargaId` es **nullable** (`NULL` = orden sin lote),
  `downloadUrl` (URL firmada, caduca) y `downloadStoragePath` (ruta del objeto, feature 177).
- `db/schema.prisma:595-598` — mismas dos columnas en `Carga` para el PDF consolidado.
- `lib/interfaces/external/IFileStorage.ts:15-23` — **la interfaz YA expone `remove(paths)`**;
  no hace falta ampliarla para borrar. Pero `SupabaseFileStorage.remove`
  (`lib/storage/SupabaseFileStorage.ts:57-62`) **descarta el `{ error }` que devuelve Supabase**:
  con el contrato actual **es imposible saber si un borrado falló**. Ese hecho medido es el que
  fuerza la pregunta abierta (b).
- `lib/services/EtiquetasLotePdfService.ts:72,111` — el path de todo PDF de etiqueta es
  `{usuarioId}/{uuid}.pdf` en el bucket `etiquetasConfig.ETIQUETAS_BUCKET` (default
  `etiquetas-guia`). El bucket **por defecto** de `SupabaseFileStorage` es el de postulaciones
  (`postulacionConfig.BUCKET`): construirlo sin pasar el bucket borraría en el sitio equivocado
  (de ahí R11).
- Infraestructura de recurrencia disponible: `Job`/`JobTipo`/`JobEstado` (feature 90,
  `db/schema.prisma:1595-1642`), drenador `GET /api/cron/procesar-jobs` cada minuto
  (`vercel.json:12-15`) autorizado por `CRON_SECRET`, registro de handlers y de recurrencias en
  `app/api/cron/procesar-jobs/route.ts:55-120`, y dos precedentes de job **recurrente por reloj**:
  `liberar_reprogramadas` y `analitica_rollup_diario`.
- `specs/177-api-consulta-orden-pdf/design.md:78-87` y `lib/services/ApiPdfEtiquetaService.ts:50-51,90`
  — `/generate` **solo mira `download_storage_path`**: si viene con valor, re-firma sin
  comprobar que el objeto exista. Es exactamente la trampa que R16 fija.

## Limitación heredada (declarada, no resuelta aquí)

`specs/177-api-consulta-orden-pdf/design.md:84-87` da por hecho que esta feature barrerá los
objetos huérfanos de las features 136/141. **No puede**: de aquellos objetos solo se guardó la
URL firmada (`download_url`), nunca la ruta, y `IFileStorage.remove` necesita la ruta. Esta purga
borra **únicamente** objetos cuya ruta esté persistida en `download_storage_path`. Los demás
quedan en el bucket, inalcanzables por código. La única salida realista es una **regla de ciclo de
vida del bucket** (configuración de Supabase Storage, fuera de este repo) o un barrido por
`list()` que hoy `IFileStorage` no expone. **Recomendación: ticket aparte.** Queda fijado por R10
(se borra lo referenciado) y declarado aquí para que no se descubra tarde.

---

## Requisitos

### Configuración de la retención

- **R1** — El sistema DEBE resolver la retención de los PDF de carga, en días, desde la variable
  de entorno `PURGA_PDF_RETENCION_DIAS`.
- **R2** — SI `PURGA_PDF_RETENCION_DIAS` está ausente, vacía, no es un entero o es menor que 1,
  ENTONCES el sistema DEBE usar **7 días**.
- **R3** — El sistema DEBE aceptar cualquier valor entero mayor o igual que 1 **sin tope
  superior**, aplicándolo tal cual como ventana de retención.
- **R4** — El sistema DEBE resolver la retención **en cada corrida**, no en el momento de
  construir el módulo, de modo que dos corridas con configuración distinta usen ventanas
  distintas.

### Selección de lo que se purga

- **R5** — El sistema DEBE tratar como elegible toda carga cuya **fecha de corte** sea
  estrictamente anterior a `instante_de_la_corrida − N días`.
- **R6** — MIENTRAS la fecha de corte de una carga esté dentro de la ventana de retención, el
  sistema NO DEBE borrar ningún objeto suyo ni modificar ninguna columna de esa carga ni de sus
  órdenes.
- **R7** — El sistema DEBE agrupar el trabajo **por `carga_id`**: la carga y **todas** sus
  órdenes se resuelven como una única unidad de purga.
- **R8** — El sistema NO DEBE seleccionar una carga que ya no tenga ninguna referencia viva
  (ni en la carga ni en ninguna de sus órdenes), aunque su fecha de corte esté fuera de la
  ventana.
- **R9** — El sistema DEBE incluir en la unidad de purga **todas** las órdenes de la carga,
  incluidas las marcadas como borradas (`deleted_at` no nulo): sus objetos ocupan el mismo
  bucket.

### Borrado en Storage

- **R10** — CUANDO una carga es elegible, el sistema DEBE borrar del bucket **todos** los objetos
  cuya ruta esté referenciada en `carga.download_storage_path` (PDF consolidado) y en
  `orden.download_storage_path` de las órdenes de esa carga (PDF individuales).
- **R11** — El sistema DEBE ejecutar ese borrado contra el **bucket de etiquetas configurado**
  (`ETIQUETAS_BUCKET`), nunca contra otro bucket.
- **R12** — SI una carga elegible no tiene ninguna ruta referenciada, ENTONCES el sistema NO DEBE
  invocar el borrado en Storage (ni con una lista vacía de rutas).

### Efecto en la base de datos

- **R13** — CUANDO una carga se purga, el sistema DEBE dejar a NULL **`carga.download_storage_path`
  Y `carga.download_url`** de esa carga.
- **R14** — CUANDO una carga se purga, el sistema DEBE dejar a NULL
  **`orden.download_storage_path` Y `orden.download_url`** de **todas** sus órdenes.
- **R15** — El sistema NO DEBE modificar ninguna otra columna de `carga` ni de `orden`, ni borrar
  filas de ninguna de las dos tablas.
- **R16** — CUANDO se invoca `POST /api/ordenes/api-key/orden/{id}/generate` o
  `POST /api/ordenes/api-key/carga/{cargaId}/generate` **después** de que la purga haya alcanzado
  ese recurso, el sistema DEBE **generar un PDF nuevo** y devolver la URL firmada de un objeto
  recién subido (`generado: true`), nunca re-firmar la referencia purgada.
- **R17** — El sistema NO DEBE borrar objetos ni modificar columnas de órdenes con `carga_id`
  NULL. (Consecuencia declarada: el PDF individual de una orden sin lote **no caduca nunca** por
  esta vía; ver §Fuera de alcance declarado (d) y la pregunta abierta (d).)

### Ejecución, recurrencia y robustez

- **R18** — El sistema DEBE ejecutar la purga con cadencia **semanal**, sin intervención manual.
- **R19** — CUANDO una ocurrencia semanal termina, el sistema DEBE dejar agendada la siguiente,
  incluso si esa ocurrencia terminó en fallo definitivo (la serie no se detiene).
- **R20** — El sistema DEBE ser **idempotente**: una segunda ejecución sobre el mismo estado no
  vuelve a borrar objetos ni a escribir columnas.
- **R21** — El sistema DEBE acotar el trabajo de una corrida a un **tope configurable de cargas**
  por ejecución.
- **R22** — MIENTRAS queden cargas elegibles por encima de ese tope, el sistema DEBE dejar
  encolada la continuación del trabajo pendiente sin esperar a la siguiente semana.
- **R23** — SI una corrida falla, ENTONCES el sistema DEBE reintentarla según la política de
  reintentos de la cola y, agotados los intentos, registrar el fallo sin detener la serie
  semanal.
- **R24** — El sistema DEBE registrar por corrida el número de cargas purgadas, órdenes afectadas
  y objetos borrados, **sin PII y sin secretos** (ni rutas de objetos con identificadores de
  usuario en claro en el log de resumen).
- **R25** — El sistema NO DEBE poder ser disparado por una petición sin el secreto de cron
  válido.

### Migración

- **R26** — El sistema DEBE aportar su migración con `migration.sql` (UP) y `down.sql` (DOWN)
  que la revierte exactamente, sin borrar datos de negocio de `orden` ni de `carga`.

---

## Fuera de alcance declarado (d) — órdenes con `carga_id` NULL

Verificado en `db/schema.prisma:515`: `Orden.cargaId` es nullable y `NULL` significa "orden sin
lote" (alta manual, o histórica anterior a la 141). Como esta purga **agrupa por `carga_id`** (así
lo pidió el humano), esas órdenes **quedan fuera por definición** y su PDF individual **no caduca
nunca**. No es un olvido: es la consecuencia directa del criterio de agrupación. R17 lo fija con un
test para que nadie lo "arregle" por accidente. Ver pregunta abierta (d).

---

## Preguntas abiertas (puerta F1.4)

Cada una con la recomendación por defecto del spec_author y la consecuencia de tomarla.

### (a) Fecha de corte: `carga.created_at` vs `carga.fecha_carga`

**Estado del terreno:** las dos existen, las dos son `@default(now())` y **hoy ningún código
escribe `fecha_carga`**, así que coinciden en toda fila existente. Pero
`specs/141-tabla-cargas-orden/design.md:60-61` declara que conviven **a propósito** porque
`fecha_carga` es el dato de negocio y "podría fijarse en el futuro" (backdating por el usuario).
Además `fecha_carga` **está indexada** y `created_at` **no**.

**Recomendación: `created_at`.** La retención es una política de ciclo de vida del **objeto en
Storage**, y el objeto nace cuando nace la fila, no cuando el usuario dice que se cargó el lote.
Con `fecha_carga`, el día que alguien pueda backdatear un lote, la purga borraría al instante el
PDF de una carga creada hoy.

**Consecuencia si se acepta:** hace falta **crear el índice** de la selección en esta feature
(hoy `created_at` no lo tiene en `carga`); está contemplado en `design.md` §3 y en `tasks.md`.

**Consecuencia si se elige `fecha_carga`:** cero migración de índices, pero la ventana de
retención queda a merced de un dato editable por el usuario, y la purga se vuelve
**no monótona** (cambiar `fecha_carga` puede meter o sacar una carga de la ventana).

### (b) Idempotencia y fallo parcial del borrado en Storage

**Estado del terreno:** `SupabaseFileStorage.remove` **descarta el error** que devuelve Supabase
(`lib/storage/SupabaseFileStorage.ts:57-62`) e `IFileStorage.remove` devuelve `Promise<void>`: hoy
el llamador **no puede saber** si el borrado funcionó. Para "reintentar y dejar la fila intacta"
habría que **ampliar el contrato** `IFileStorage` (compartido con la feature 21) para que informe
del resultado.

**Recomendación: limpiar las columnas igual (best-effort), sin ampliar el contrato.** Razón: el
modo de fallo caro es el contrario. Si el objeto se borró pero la columna queda viva, `/generate`
de la 177 firma un objeto inexistente y el integrador recibe **200 con una URL que da 404**
(R16). Si la columna se limpia y el objeto sobrevive, el coste es un objeto huérfano —espacio— y
la siguiente llamada a `/generate` regenera. Además el enlace ya no sirve: `download_url` es una
URL firmada caducada desde hace días.

**Consecuencia si se acepta:** pueden quedar objetos huérfanos no contabilizados, y el resumen de
la corrida informará "objetos borrados" con el sentido de "borrados solicitados", no "confirmados".
Queda declarado en `design.md` §6.

**Consecuencia si se elige reintentar:** entra en el alcance ampliar `IFileStorage` (nuevo método
o cambio de firma de `remove`) y actualizar la feature 21 y sus dobles de test; y hay que decidir
el número de reintentos antes de rendirse, porque una carga con un objeto irrecuperablemente
"no borrable" bloquearía su fila para siempre.

### (c) Cola de la feature 90 vs cron propio en `vercel.json`

**Recomendación: la cola (feature 90), tipo `purga_pdf_cargas`, con `RecurrenciaSpec` semanal**,
igual que `liberar_reprogramadas` y `analitica_rollup_diario`. Razones medidas: la cola ya aporta
reintentos con backoff, dead-letter, `dedupe_key` (idempotencia entre siembra y reencolado),
visibility timeout y el drenador ya autorizado por `CRON_SECRET` que corre cada minuto
(`vercel.json:12-15`); un cron propio obligaría a reimplementar autorización, reintentos y
límites, y a gastar una entrada más de `crons` (los planes de Vercel las limitan).

**Consecuencia si se acepta:** la purga **comparte presupuesto de ejecución** con el resto del
drenado, por eso R21/R22 (tope por corrida + continuación encolada) no son opcionales.

**Consecuencia si se elige cron propio:** entrada nueva en `vercel.json`, ruta
`app/api/cron/purga-pdf-cargas/route.ts` con su verificación de `CRON_SECRET`, y hay que resolver
a mano el troceado y el reintento que la cola ya da.

### (d) Órdenes con `carga_id` NULL

**Recomendación: dejarlas fuera (R17) y abrir ticket aparte** para una purga por antigüedad de
`orden.created_at` sobre órdenes sin lote. Razón: meterlas aquí rompe el criterio "agrupar por
`carga_id`" que fijó el humano y mezcla dos políticas de retención distintas en un mismo job.

**Consecuencia si se acepta:** el PDF individual de una orden dada de alta manualmente vive en el
bucket **indefinidamente**. Hoy el volumen es previsiblemente menor que el de las cargas masivas,
pero crece de forma monótona.

**Consecuencia si se incluyen aquí:** hay que decidir su propia fecha de corte
(`orden.created_at`), su propio troceado y qué pasa con las órdenes vivas y recientes sin lote;
sube la complejidad de la feature de `medium` a `high`.

### (e) Día y hora de la corrida semanal (menor, pero no está en el código)

Nada en `docs/` ni en el código fija el momento de la corrida semanal. **Recomendación: domingo
03:00 America/Costa_Rica** (fuera de la ventana operativa y sin solaparse con
`liberar_reprogramadas` a las 00:00 CR ni con `analitica_rollup_diario` a las 00:30 CR).
**Consecuencia:** es una constante del handler; cambiarla después es un cambio de una línea y de
su test.
