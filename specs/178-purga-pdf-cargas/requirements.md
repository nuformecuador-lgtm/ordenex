# Feature 178 — Cron diario de purga de los PDF de cargas antiguas (retención parametrizable)

Requisitos en notación EARS. Cada `R<n>` termina mapeado a un test concreto en `tasks.md`
(tabla `R<n>→test`, `docs/specs.md` §Trazabilidad). Sin detalles de implementación: el CÓMO
vive en `design.md`.

> **PUERTA F1.4 CERRADA** (decisiones del humano incorporadas; no se reabren). Ojo con el
> nombre heredado de la ficha: **la cadencia es DIARIA**; lo "semanal" pasó a ser el
> **valor por defecto de la retención** (`N = 7` días).

**Alcance:** backend puro, sin UI. Un **cron propio diario** (`app/api/cron/...` +
`vercel.json`, autorizado por `CRON_SECRET`) que, **agrupando por `carga_id`**, para cada carga
creada hace `N` días **o más** borra del bucket privado de etiquetas:

1. el PDF **CONSOLIDADO** del lote, y
2. los PDF **INDIVIDUALES** de **todas** las órdenes de ese lote,

y deja a NULL, en las filas afectadas, **las dos** columnas testigo: `download_url` **y**
`download_storage_path` (esta última es la que la feature 177 usa para decidir si el PDF
existe). `N` sale de variable de entorno, default 7, mínimo 0, sin tope superior.

**Objetivo:** que el bucket de etiquetas no crezca sin freno con etiquetas que ya nadie descarga.

**Fuera de alcance (declarado, no olvidado):**

- Las órdenes con `carga_id` NULL (alta manual, órdenes anteriores a la feature 141): ver
  §Fuera de alcance declarado (d) y R17.
- Los objetos del bucket cuya ruta **nunca se persistió** (etiquetas de las features 136/141:
  solo se guardó la URL firmada): ver §Limitación heredada.
- Reintentos automáticos con backoff, dead-letter y trazabilidad por ejecución: quedan fuera al
  no usarse la cola de la feature 90 (decisión (c)). La recuperación de un fallo es **la corrida
  del día siguiente** (R19).
- Cambiar cómo la 136/141 genera o persiste hoy sus URLs; cambiar el contrato de los endpoints
  `/generate` de la 177; UI de configuración de la retención; borrado bajo demanda.

## Decisiones YA TOMADAS por el humano (no se reabren)

Previas al spec:

- **Alcance del borrado:** el PDF consolidado de la carga **Y** los PDF individuales de todas
  las órdenes de esa carga.
- **Configuración de la retención:** por **variable de entorno**. Ni UI, ni tabla de config, ni
  query param.
- **Obligación heredada de la 177:** la purga pone a NULL **también** `download_storage_path`
  (en `orden` **y** en `carga`), y `/generate` debe volver a generar después de la purga (R16).

**Cerradas en la puerta F1.4:**

- **(a) Fecha de corte: `carga.created_at`**, por inmutable. Crear su índice **entra en el
  alcance** (`created_at` no está indexado hoy en `carga`).
- **(b) Fallo parcial: se limpian las columnas igual** (borrado best-effort), **sin reintentos
  internos ni backoff**. La recuperación es la corrida del día siguiente.
- **(c) CRON PROPIO en `vercel.json`**, NO la cola de la feature 90. Caen `JobTipo`,
  `RecurrenciaSpec`, `dedupe_key` y la continuación encolada.
- **(d) Órdenes con `carga_id` NULL: FUERA**, declarado, con ticket aparte recomendado.
- **(e) Cadencia DIARIA a las 03:00 America/Costa_Rica** (no choca con `liberar_reprogramadas`
  a las 00:00 CR ni con `analitica_rollup_diario` a las 00:30 CR).
- **(f) Retención `N`: mínimo 0, sin tope superior, default 7. Corte INCLUSIVO:** se purga lo
  creado hace `N` días **o más**. Ver §Consecuencia declarada de `N = 0`.

## Terreno verificado contra el código (no supuesto)

- `db/schema.prisma:590-610` — `Carga` tiene `fechaCarga` (`fecha_carga`) **y** `createdAt`
  (`created_at`), ambas `@default(now())`. Índices existentes: `carga_usuario_carga_idx` y
  `carga_fecha_carga_idx`; **`created_at` NO está indexado** en `carga` (de ahí T3).
  Búsqueda en todo el repo: ningún código escribe `fecha_carga` explícitamente, pero
  `specs/141-tabla-cargas-orden/design.md:60-61` declara a propósito que "podría fijarse en el
  futuro" por el usuario: por eso la decisión (a) es `created_at`.
- `db/schema.prisma:515-522` — `Orden.cargaId` es **nullable** (`NULL` = orden sin lote),
  `downloadUrl` (URL firmada, caduca) y `downloadStoragePath` (ruta del objeto, feature 177).
- `db/schema.prisma:595-598` — mismas dos columnas en `Carga` para el PDF consolidado.
- `lib/interfaces/external/IFileStorage.ts:15-23` — **la interfaz YA expone `remove(paths)`**;
  no hace falta ampliarla. Pero `SupabaseFileStorage.remove`
  (`lib/storage/SupabaseFileStorage.ts:57-62`) **descarta el `{ error }` que devuelve Supabase**:
  con el contrato actual **es imposible saber si un borrado falló**. Ese hecho medido es el que
  sostiene la decisión (b).
- `lib/services/EtiquetasLotePdfService.ts:72,111` — el path de todo PDF de etiqueta es
  `{usuarioId}/{uuid}.pdf` en el bucket `etiquetasConfig.ETIQUETAS_BUCKET` (default
  `etiquetas-guia`). El bucket **por defecto** de `SupabaseFileStorage` es el de postulaciones
  (`postulacionConfig.BUCKET`): construirlo sin pasar el bucket borraría en el sitio equivocado
  —en silencio, porque `remove` no propaga error— (de ahí R11).
- `vercel.json:1-25` — cinco crons hoy; ninguno a las 09:00 UTC (= 03:00 CR).
  `app/api/cron/procesar-devueltas-sla/route.ts` y `corte-diario` son el patrón exacto a clonar:
  `GET`, `Bearer <CRON_SECRET>` vía `loadCronConfig()`, `401` antes de construir nada, handler
  extraído con deps inyectables, `200` con conteos agregados sin PII.
- `specs/177-api-consulta-orden-pdf/design.md:78-87` y
  `lib/services/ApiPdfEtiquetaService.ts:50-51,90` — `/generate` **solo mira
  `download_storage_path`**: si viene con valor, re-firma sin comprobar que el objeto exista. Es
  exactamente la trampa que R16 fija.

## Consecuencia declarada de `N = 0`

Con `PURGA_PDF_RETENCION_DIAS=0` y corte inclusivo, la corrida de las 03:00 CR purga **también
las cargas creadas ese mismo día** (edad ≥ 0). Es un valor legítimo y **no es irreversible**: el
PDF vuelve a existir bajo demanda con `POST /api/ordenes/api-key/{orden|carga}/.../generate`
(feature 177), que regenera al ver la referencia a NULL (R16). Lo que se pierde es la URL vigente
que un integrador tuviera en la mano, que de todos modos caduca a los 300 s.

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
- **R2** — SI `PURGA_PDF_RETENCION_DIAS` está ausente, vacía, no es un entero o es **negativa**,
  ENTONCES el sistema DEBE usar **7 días**.
- **R3** — El sistema DEBE aceptar cualquier valor entero **mayor o igual que 0**, **sin tope
  superior**, aplicándolo tal cual como ventana de retención (`0` es válido: purga también lo
  creado el mismo día).
- **R4** — El sistema DEBE resolver la retención **en cada corrida**, no en el momento de
  construir el módulo, de modo que dos corridas con configuración distinta usen ventanas
  distintas.

### Selección de lo que se purga

- **R5** — El sistema DEBE tratar como elegible toda carga cuyo **`created_at`** sea **anterior o
  igual** a `instante_de_la_corrida − N días` (corte **inclusivo**).
- **R6** — MIENTRAS el `created_at` de una carga sea **posterior** a ese corte, el sistema NO DEBE
  borrar ningún objeto suyo ni modificar ninguna columna de esa carga ni de sus órdenes.
- **R7** — El sistema DEBE agrupar el trabajo **por `carga_id`**: la carga y **todas** sus
  órdenes se resuelven como una única unidad de purga.
- **R8** — El sistema NO DEBE seleccionar una carga que ya no tenga ninguna referencia viva
  (ni en la carga ni en ninguna de sus órdenes), aunque su `created_at` esté fuera de la ventana.
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
  esta vía; ver §Fuera de alcance declarado (d).)

### Ejecución, cadencia y robustez

- **R18** — El sistema DEBE ejecutar la purga **una vez al día**, a las **03:00
  America/Costa_Rica**, sin intervención manual.
- **R19** — SI una corrida termina en error o deja trabajo sin hacer, ENTONCES el trabajo
  pendiente DEBE seguir siendo elegible para la **corrida del día siguiente**, sin intervención
  manual y sin reintentos internos.
- **R20** — El sistema DEBE ser **idempotente**: una segunda ejecución sobre el mismo estado no
  vuelve a borrar objetos ni a escribir columnas.
- **R21** — El sistema DEBE acotar el trabajo de una corrida a un **tope configurable de cargas**
  por ejecución.
- **R22** — MIENTRAS queden cargas elegibles por encima de ese tope, el sistema DEBE terminar la
  corrida **igualmente en éxito** y dejar constancia de que quedó trabajo pendiente, que retomará
  la corrida siguiente.
- **R23** — El sistema DEBE responder al disparador distinguiendo **corrida correcta** (`200` con
  el resumen) de **fallo** (código de error), para que el fallo sea observable sin una cola de
  jobs que lo registre.
- **R24** — El sistema DEBE registrar por corrida el número de cargas purgadas, órdenes afectadas
  y objetos borrados, **sin PII y sin secretos** (ni rutas de objetos, que contienen el id del
  usuario).
- **R25** — El sistema NO DEBE ejecutar ningún efecto ante una petición sin el `CRON_SECRET`
  válido: DEBE responder `401` antes de tocar la base o el Storage.

### Migración

- **R26** — El sistema DEBE aportar su migración con `migration.sql` (UP) y `down.sql` (DOWN)
  que la revierte exactamente, sin borrar ni alterar datos de negocio de `orden` ni de `carga`.

---

## Fuera de alcance declarado (d) — órdenes con `carga_id` NULL

Verificado en `db/schema.prisma:515`: `Orden.cargaId` es nullable y `NULL` significa "orden sin
lote" (alta manual, o histórica anterior a la 141). Como esta purga **agrupa por `carga_id`** (así
lo pidió el humano), esas órdenes **quedan fuera por definición** y su PDF individual **no caduca
nunca**. No es un olvido: es la consecuencia directa del criterio de agrupación. R17 lo fija con un
test para que nadie lo "arregle" por accidente.

**Ticket aparte recomendado:** purga por antigüedad de `orden.created_at` para órdenes sin lote,
con su propia ventana de retención. Hoy el volumen es previsiblemente menor que el de las cargas
masivas, pero crece de forma monótona.
