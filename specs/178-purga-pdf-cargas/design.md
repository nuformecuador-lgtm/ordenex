# Feature 178 — Design

Decisiones técnicas ANTES de escribir código. Los requisitos viven en `requirements.md`; aquí
va el CÓMO. Todo lo marcado como **pendiente de (a)/(b)/(c)/(d)** depende de una pregunta abierta
de la puerta F1.4: este documento describe la **recomendación por defecto**, y señala qué cambia
con la otra respuesta.

---

## 1. Lo que esta feature NO puede dar por bueno (hallazgo que fija el diseño)

La feature 177 introdujo `download_storage_path` en `orden` y en `carga` y la convirtió en **el
único testigo de "el PDF existe"**: `ApiPdfEtiquetaService.porOrden` (línea 50-51) y `porCarga`
(línea 90) leen esa columna y, si viene con valor, **re-firman sin comprobar nada más**.
`createSignedUrl` de Supabase **no falla** si el objeto no existe: firma igual.

Por tanto, una purga que borrase el objeto y limpiase solo `download_url` dejaría al integrador
recibiendo `200 { url, generado: false }` con una URL que devuelve **404 al descargar**. Esa es la
razón de R13/R14 (NULL en **las dos** columnas, en **las dos** tablas) y de R16, que se verifica
con un test de integración de extremo a extremo: purgar → llamar `/generate` → `generado: true`.

Consecuencia de diseño derivada: **la referencia y el objeto deben morir juntos, y si solo puede
morir uno, que muera la referencia** (§6).

---

## 2. Camino de ejecución: cola de jobs (feature 90) — pendiente de (c)

Se monta como **tipo nuevo de la cola**, no como cron propio:

```
vercel.json  ── * * * * * ──▶  GET /api/cron/procesar-jobs        (ya existe, CRON_SECRET)
                                  ↓ JobQueueService.drenar
                     handlers.get("purga_pdf_cargas")             ← registro nuevo
                                  ↓
                     PurgaPdfCargasService.ejecutar(now)          ← lógica de negocio
                                  ↓                     ↓
                     PurgaPdfCargasRepository      IFileStorage.remove (bucket etiquetas)
                                  ↓
                            Postgres (carga / orden)
```

- **Handler:** `lib/services/jobs/purga-pdf-cargas-handler.ts`, delgado, con el mismo patrón que
  `liberar-reprogramadas-handler.ts`: expone `crearPurgaPdfCargasHandler(service, now)`,
  `buildPurgaPdfCargasService()` y `recurrenciaPurgaPdfCargas: RecurrenciaSpec`.
- **Identidad de encolado:** módulo puro `lib/services/jobs/purga-pdf-cargas-encolado.ts` con
  `DEDUPE_PREFIX = "purga_pdf_cargas"` y `dedupeKeyPurga(fechaCorridaCR)`, igual que el par
  handler/encolado de la 124 (para que el script de siembra no arrastre Prisma).
- **Registro:** `buildHandlers()` y `buildRecurrencias()` de
  `app/api/cron/procesar-jobs/route.ts` (ambas exportadas justamente para que un test verifique
  el enganche sin levantar el endpoint).
- **Semilla:** `scripts/seed-jobs-purga-pdf-cargas.ts` + entrada en `package.json`, clon del
  `seed-jobs-analitica-rollup-diario.ts` (idempotente por `dedupe_key`, `ON CONFLICT DO NOTHING`).
- **Autorización (R25):** ninguna nueva. El único disparador es el drenador, que ya exige
  `Bearer <CRON_SECRET>` (`procesar-jobs/route.ts:151-156`).

### 2.1 Cadencia y recurrencia (R18/R19) — pendiente de (e)

`proximaCorridaPurgaCR(now)` = **próximo domingo 03:00 America/Costa_Rica** estrictamente
posterior a `now` (CR es UTC−6 fijo, sin horario de verano ⇒ 09:00 UTC), con
`dedupeKey = purga_pdf_cargas:<YYYY-MM-DD CR de esa corrida>`. La clave lleva la **fecha de la
corrida** (no una fecha objetivo como en la 124) porque esta purga no agrega un día concreto:
opera sobre "todo lo vencido a día de hoy".

`JobQueueService` re-agenda la siguiente ocurrencia tanto al completar como al morir por
agotamiento de intentos (`IJobQueueService.drenar`, R23/R24 de la 90) ⇒ R19 sale gratis.

### 2.2 Troceado y continuación (R21/R22)

Una corrida procesa como mucho `PURGA_PDF_MAX_CARGAS_POR_CORRIDA` cargas (default **200**). Si al
terminar quedaban más candidatas, el handler **encola una continuación inmediata**
(`runAfter = now`, payload `{ continuacion: n+1 }`, `dedupeKey =
purga_pdf_cargas:<fecha CR>:cont:<n+1>`), que el drenador recoge en el minuto siguiente.

Por qué el tope no es opcional: el drenador es compartido y corre dentro del presupuesto de una
function de Vercel; una purga sin tope, la primera vez que se ejecute sobre un histórico de meses,
agotaría el tiempo de la corrida y arrastraría con ella al resto de tipos de job.

Detalle importante: las continuaciones **también** re-agendan la ocurrencia semanal (la
recurrencia es por tipo, no por fila). Como todas calculan la **misma** `dedupeKey` de la semana
siguiente y `enqueue` hace `ON CONFLICT DO NOTHING`, el resultado es exactamente **una** fila. No
se añade lógica para evitarlo: el `dedupe_key` ya es la garantía.

---

## 3. Modelo de datos y migración

**Sin tablas ni columnas nuevas.** Las cuatro columnas que se leen y escriben ya existen
(`carga.download_url`, `carga.download_storage_path`, `orden.download_url`,
`orden.download_storage_path`). Sin RLS nueva: no hay tabla nueva; `jobs` ya está con RLS
habilitada sin policies (solo service role).

La migración de esta feature contiene **dos cosas**:

### 3.1 Valor nuevo del enum `job_tipo` (obligatorio, va SOLO en su carpeta)

```sql
-- db/migrations/<ts>_job_tipo_purga_pdf_cargas/migration.sql
ALTER TYPE "job_tipo" ADD VALUE IF NOT EXISTS 'purga_pdf_cargas';
```

Va en **su propia migración**, sin ninguna otra sentencia: Postgres no permite usar un valor de
enum en la misma transacción que lo añadió (55P04) y Prisma Migrate corre cada `migration.sql` en
una transacción. Precedente literal: `20260801100000_job_tipo_analitica_rollup_diario`.

`down.sql`: `DELETE FROM "jobs" WHERE "tipo" = 'purga_pdf_cargas';` seguido del
RENAME/CREATE/ALTER TABLE ... USING/DROP que recrea `job_tipo` con los **siete** valores previos
en su orden exacto (`liberar_reprogramadas`, `geocodificacion`, `optimizacion_ruta`,
`webhook_estado`, `whatsapp_template_sync`, `whatsapp_chat_envio`, `analitica_rollup_diario`),
porque Postgres no soporta `ALTER TYPE ... DROP VALUE`. Copia exacta del criterio de la 124.

### 3.2 Índices de la selección (segunda carpeta de migración) — pendiente de (a)

Con la recomendación (a) = `created_at`, la consulta de candidatas necesita soporte de índice; y
para que la purga no degrade con los años necesita que **las cargas ya purgadas no se vuelvan a
escanear**. Dos índices **parciales**:

```sql
CREATE INDEX "carga_purga_pendiente_idx" ON "carga" ("created_at")
  WHERE "download_storage_path" IS NOT NULL OR "download_url" IS NOT NULL;

CREATE INDEX "orden_purga_pendiente_idx" ON "orden" ("carga_id")
  WHERE "carga_id" IS NOT NULL
    AND ("download_storage_path" IS NOT NULL OR "download_url" IS NOT NULL);
```

`down.sql`: los dos `DROP INDEX` en orden inverso. Ninguna sentencia toca datos (R26).

Prisma **no sabe expresar índices parciales**, así que van a mano en el `migration.sql` y **no** se
declaran en `schema.prisma`. Precedente explícito en el repo: los índices reales de `jobs` son
parciales y están documentados así en `db/schema.prisma:1619-1625`. Riesgo conocido y acotado: un
`prisma migrate dev --create-only` futuro puede proponer un `DROP INDEX` fantasma; por eso
`tasks.md` incluye la tarea de **medirlo** y, si aparece, documentarlo en el encabezado de la
migración igual que hizo la 124 con su enum (nunca "arreglarlo" borrando el índice).

Por qué el índice sobre `orden` también es parcial y por `carga_id`: la selección de candidatas
necesita responder "¿esta carga aún tiene alguna orden con referencia viva?" (R8) sin recorrer
todas sus órdenes.

**Si la puerta decide (a) = `fecha_carga`:** el índice de `carga` se sustituye por el parcial sobre
`fecha_carga` (el índice total `carga_fecha_carga_idx` ya existe, pero no filtra por referencia
viva, así que el parcial sigue mereciendo la pena); el resto no cambia.

---

## 4. Capas y contratos

### 4.1 Configuración — `lib/config/purga-pdf.ts` (R1-R4, R21)

```ts
export interface PurgaPdfConfig {
  /** Días de retención. Default 7. Mínimo 1. SIN tope superior (R3). */
  PURGA_PDF_RETENCION_DIAS: number;
  /** Tope de cargas procesadas por corrida (R21). Default 200. */
  PURGA_PDF_MAX_CARGAS_POR_CORRIDA: number;
}
export function loadPurgaPdfConfig(): PurgaPdfConfig;
```

- `readPositiveInt(name, fallback)` con la misma semántica que `lib/config/jobs.ts` y
  `lib/config/etiquetas.ts`: ausente/vacía/no entera/`<= 0` ⇒ default. Eso ya cubre R2
  (`0` y `-3` caen al default 7). **No hay `clamp` superior** (R3): es una decisión explícita del
  humano, y a diferencia del TTL de una URL firmada, un valor absurdamente grande aquí **no abre
  ningún dato**: solo hace que la purga no borre nada.
- **Se llama `loadPurgaPdfConfig()` dentro del handler, en cada corrida (R4)**, y no se exporta un
  singleton `purgaPdfConfig` congelado al importar el módulo, a diferencia de
  `etiquetasConfig`. Motivo: el proceso de una función serverless vive entre despliegues y el
  requisito pide que la ventana se resuelva por corrida; además así el test puede variar la env
  sin recargar módulos.
- Env documentadas en `.env.example`, junto al bloque de las features 136/177.

**Alternativa descartada:** meter las dos claves en `EtiquetasConfig`
(`lib/config/etiquetas.ts`). Descartada porque ese módulo exporta un **singleton congelado al
importar** (`export const etiquetasConfig = loadEtiquetasConfig()`), que es exactamente lo que R4
prohíbe, y porque su contrato ya está fijado por tests de la 136/177 que se verían tocados por una
feature que no cambia nada de la generación.

### 4.2 Repositorio — `lib/repositories/PurgaPdfCargasRepository.ts` + su interfaz

`lib/interfaces/repositories/IPurgaPdfCargasRepository.ts`:

```ts
export interface CargaPurgable {
  cargaId: string;
  /** Ruta del PDF consolidado, o null si nunca se persistió. */
  cargaPath: string | null;
  /** Rutas de los PDF individuales de las órdenes del lote (sin nulos). */
  ordenPaths: string[];
  /** Órdenes del lote con alguna referencia viva (path o url). */
  ordenIds: string[];
}

export interface IPurgaPdfCargasRepository {
  /** R5/R7/R8/R9: hasta `limite` cargas con corte anterior a `corte` y referencia viva. */
  findCargasPurgables(corte: Date, limite: number): Promise<CargaPurgable[]>;
  /** R8/R22: ¿queda al menos una candidata más allá de las devueltas? */
  quedanCargasPurgables(corte: Date, limite: number): Promise<boolean>;
  /** R13/R14/R15: NULL en las 4 columnas de la carga y de SUS órdenes, en UNA transacción. */
  limpiarReferencias(cargaId: string): Promise<{ ordenesActualizadas: number }>;
}
```

Consulta de `findCargasPurgables` (recomendación (a) = `created_at`):

```sql
SELECT c.id
FROM carga c
WHERE c.created_at < $corte
  AND (
        c.download_storage_path IS NOT NULL
     OR c.download_url IS NOT NULL
     OR EXISTS (SELECT 1 FROM orden o
                 WHERE o.carga_id = c.id
                   AND (o.download_storage_path IS NOT NULL OR o.download_url IS NOT NULL))
  )
ORDER BY c.created_at ASC
LIMIT $limite;
```

Las rutas se leen en una segunda consulta por los `carga_id` obtenidos (`IN (...)`, índice
`orden_carga_id_idx` ya existente). Orden **ASC**: se purga primero lo más viejo, que es lo que un
operador espera si la primera corrida no alcanza a barrerlo todo.

`limpiarReferencias` escribe en **una transacción por carga**: `UPDATE orden SET
download_url = NULL, download_storage_path = NULL WHERE carga_id = $id` (R14, **sin filtrar por
`deleted_at`** — R9) y `UPDATE carga SET download_url = NULL, download_storage_path = NULL WHERE
id = $id` (R13). Ninguna otra columna en el `data` (R15). La transacción es **por carga**, no por
corrida: una carga que falle no arrastra a las ya purgadas.

**No se reutiliza `OrdenRepository`**: ya tiene ~1600 líneas y sus métodos de estas columnas son
todos *setters* de una sola fila pensados para el camino caliente de la 177. Un repositorio propio
mantiene la superficie de la purga aislada y testeable, y evita que un cambio aquí toque el
repositorio del que cuelga media aplicación.

### 4.3 Servicio — `lib/services/PurgaPdfCargasService.ts` (+ `IPurgaPdfCargasService`)

```ts
export interface PurgaResultado {
  cargasPurgadas: number;
  ordenesAfectadas: number;
  objetosBorrados: number;   // rutas ENVIADAS a remove (ver §6)
  quedaPendiente: boolean;   // R22: el handler encola la continuación
}

export interface IPurgaPdfCargasService {
  ejecutar(now: Date): Promise<PurgaResultado>;
}
```

Dependencias por constructor (DI, testeable sin DB ni red): `IPurgaPdfCargasRepository`,
`IFileStorage` (ya construido **con el bucket de etiquetas**) y un lector de config
`() => PurgaPdfConfig`.

Flujo:

```
1. cfg = loadConfig()                                   # R1-R4
2. corte = now - cfg.PURGA_PDF_RETENCION_DIAS días       # R5
3. candidatas = repo.findCargasPurgables(corte, tope)    # R7/R8/R9
4. por cada candidata (secuencial):
     4a. paths = [cargaPath, ...ordenPaths] sin nulos
     4b. si paths.length > 0 → storage.remove(paths)     # R10/R11/R12
     4c. repo.limpiarReferencias(cargaId)                # R13/R14/R15
5. quedaPendiente = repo.quedanCargasPurgables(corte, tope)
6. devolver conteos agregados                            # R24
```

**El orden 4b antes de 4c es deliberado** y es el inverso del que usa la 177 al generar. Ver §6.

Secuencial y no en paralelo: el borrado ya va agrupado por carga (una sola llamada a `remove` con
todas las rutas del lote), y paralelizar cargas multiplicaría la presión sobre Storage y sobre el
pool de Prisma dentro de una function compartida con el resto del drenado.

### 4.4 Bucket (R11)

El composition root del handler construye
`new SupabaseFileStorage(undefined, etiquetasConfig.ETIQUETAS_BUCKET)`. **Trampa real:** el
segundo parámetro tiene default `postulacionConfig.BUCKET` (documentos de mensajeros); olvidarlo
haría que la purga intentase borrar rutas de etiquetas en el bucket de postulaciones —silencioso,
porque `remove` no propaga error—. Por eso R11 tiene test propio sobre el composition root.

---

## 5. Contratos de entrada/salida

No hay endpoint nuevo. El único contrato observable desde fuera es el resumen agregado que ya
devuelve el drenador (`DrenarResult`: `procesados/ok/fallidos/reintentados/muertos`), que **no
cambia**. Los conteos de la purga (R24) salen por `console.log` estructurado del handler, con
**solo números** — nunca rutas (`{usuarioId}/{uuid}.pdf` contiene un identificador de usuario) ni
`carga_id`.

Entrada del job: `payload` `{}` para la ocurrencia semanal y `{ continuacion: n }` para las
continuaciones. Se valida con zod en el handler antes de usarse (borde tipado): un payload
inesperado se trata como `{}` y no rompe la corrida.

---

## 6. Fallo parcial: por qué muere antes la referencia que el objeto — pendiente de (b)

Medido: `SupabaseFileStorage.remove` **descarta el `{ error }`** que devuelve el SDK
(`lib/storage/SupabaseFileStorage.ts:57-62`) e `IFileStorage.remove` devuelve `Promise<void>`. Con
el contrato actual el service **no puede** distinguir un borrado correcto de uno fallido.

Decisión recomendada: **borrar (best-effort) y limpiar las columnas igual**, siempre. Es la
asimetría del daño:

| | Objeto borrado | Objeto vivo |
|---|---|---|
| **Columna limpiada** | caso feliz | objeto huérfano: cuesta espacio; `/generate` regenera |
| **Columna viva** | **`/generate` devuelve 200 con URL 404** (R16 roto) | no se purgó nada |

Si `remove` lanzase (fallo de red antes de llegar a Supabase), la carga se aborta **antes** de
limpiar, se propaga el error y la cola reintenta con backoff: la carga sigue siendo candidata en el
siguiente intento (R20: `remove` es idempotente sobre paths inexistentes por contrato de
`IFileStorage`).

Por eso `objetosBorrados` en `PurgaResultado` significa **"rutas enviadas a borrar"**, no
"confirmadas": queda declarado aquí y en el comentario del service para que nadie lo lea como una
garantía.

**Si la puerta decide (b) = reintentar sin limpiar:** entra en el alcance ampliar `IFileStorage`
(p. ej. `remove(paths): Promise<{ borrados: number; fallidos: string[] }>`), actualizar
`SupabaseFileStorage`, la feature 21 y todos los dobles de test, y añadir un requisito de "número
de intentos antes de rendirse" para que una ruta imborrable no bloquee su carga para siempre.

---

## 7. Alternativas descartadas (obligatorio)

### Alternativa A — Cron propio en `vercel.json` (`/api/cron/purga-pdf-cargas`)

Ruta nueva bajo `app/api/cron/`, protegida por `CRON_SECRET`, con `schedule` semanal.

**Descartada porque:** habría que reimplementar a mano lo que la cola ya da y está probado
—reintentos con backoff, dead-letter, `dedupe_key`, visibility timeout, troceado— y el propio
repo ya migró su job recurrente de referencia (`liberar_reprogramadas`) de cron propio a la cola.
Además cada entrada de `crons` es un recurso limitado por plan en Vercel y ya hay cinco. Es la
pregunta abierta (c): si el humano prefiere el cron, esta alternativa pasa a ser la elegida y lo
que se descarta es §2 (el resto del diseño —config, repo, service, orden de operaciones— no
cambia; solo cambia quién invoca `ejecutar(now)`).

### Alternativa B — Borrar las filas de `carga` (o hacer soft-delete del lote) en vez de anular columnas

Purgar el lote entero como registro, no solo su PDF.

**Descartada porque:** el lote es dato de negocio con FK `Restrict` desde `orden`
(`schema.prisma:550`) y desde la trazabilidad de la carga masiva; la feature pide **liberar
storage**, no borrar historial. Un `DELETE` fallaría por la FK y un soft-delete inventaría un
estado que la 141 decidió explícitamente no tener (`D3`: sin `status`).

### Alternativa C — Reconstruir las rutas y barrer el bucket con `list()`

Listar el bucket y borrar todo objeto con más de N días, sin mirar la base.

**Descartada porque:** `IFileStorage` no expone `list` (solo `upload`/`remove`) y ampliarlo tocaría
un contrato compartido con la feature 21; el path es `{usuarioId}/{randomUUID()}.pdf`, así que la
antigüedad **no es deducible del nombre** y habría que fiarse del metadato del proveedor; y sobre
todo dejaría las columnas `download_storage_path` **vivas apuntando a objetos borrados**, que es
justo el 200-con-404 que R16 prohíbe. (A cambio, es lo único que alcanzaría a los huérfanos de la
136/141 — ver §Limitación heredada de `requirements.md`: ticket aparte, con regla de ciclo de vida
del bucket como opción preferida.)

### Alternativa D — Purgar por antigüedad de la **orden** (`orden.created_at`) en vez de por carga

Recorrer órdenes vencidas una a una y borrar su PDF individual; el consolidado se borraría cuando
todas las órdenes de su lote estuvieran vencidas.

**Descartada porque:** el humano fijó "agrupando por `carga_id`", y además rompe la unidad de
borrado: el PDF consolidado pertenece al lote, no a ninguna orden, y decidir cuándo borrarlo
exigiría igualmente agregar por `carga_id`. Sí es la forma natural del ticket aparte para las
órdenes con `carga_id` NULL (pregunta abierta (d)).

### Alternativa E — Marcar la carga como "purgada" con una columna nueva (`pdf_purgado_at`)

Columna testigo para no volver a seleccionar la carga.

**Descartada porque:** el testigo ya existe y es exactamente `download_storage_path IS NULL AND
download_url IS NULL`; una columna nueva sería estado derivado, con su migración, su backfill y su
riesgo de desincronizarse de la realidad (p. ej. si la 177 regenera el PDF después de la purga,
`pdf_purgado_at` mentiría y la carga quedaría exenta para siempre). Los índices parciales de §3.2
dan el mismo rendimiento sin dato redundante.

### Alternativa F — Un solo `UPDATE ... WHERE created_at < corte` masivo, sin recorrer cargas

Anular las columnas de todas las filas vencidas en dos sentencias y borrar los objetos después.

**Descartada porque:** para borrar en Storage hay que **leer las rutas antes** de anularlas; si se
anulan primero, las rutas se pierden y los objetos quedan huérfanos **para siempre** (no hay
`list` en el contrato). Además un `UPDATE` masivo sobre `orden` sin cota bloquearía filas del
camino caliente durante toda la transacción.

---

## 8. Qué NO se toca

- `lib/services/ApiPdfEtiquetaService.ts`, `EtiquetasLotePdfService`, `EtiquetasDescargaService` y
  las rutas `/generate` de la 177: la purga es correcta precisamente porque **no** cambia su
  lógica (R16 se cumple con el estado de datos, no con un caso especial en el service).
- `IFileStorage` y `SupabaseFileStorage`: `remove` ya existe y basta (salvo que la puerta decida
  (b) = reintentar, §6).
- `middleware.ts`, `vercel.json` (con la recomendación (c)), `OrdenRepository`, el esquema de
  paths de Storage y las columnas `download_url` de la 141 como mecanismo de escritura.
