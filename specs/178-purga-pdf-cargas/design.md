# Feature 178 — Design

Decisiones técnicas ANTES de escribir código. Los requisitos viven en `requirements.md`; aquí
va el CÓMO.

> **Puerta F1.4 CERRADA el 2026-08-03** con aprobación explícita del humano. (a) fecha de corte **`carga.created_at`** (+ su índice, en alcance);
> (b) fallo parcial: **se limpian las columnas igual**, best-effort, **sin reintentos internos**;
> (c) **cron propio en `vercel.json`**, NO la cola de la feature 90; (d) órdenes con `carga_id`
> NULL **fuera**; (e) cadencia **DIARIA** a las **03:00 CR**; (f) `N` **≥ 0**, default 7, sin tope,
> corte **inclusivo**. Nada de esto se reabre.

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

## 2. Camino de ejecución: cron propio diario (decisión (c) + (e))

```
vercel.json ── 0 9 * * * (= 03:00 CR) ──▶ GET /api/cron/purga-pdf-cargas
                                            ↓  Bearer <CRON_SECRET> (loadCronConfig)
                                   PurgaPdfCargasService.ejecutar(now)     ← lógica de negocio
                                            ↓                    ↓
                              PurgaPdfCargasRepository     IFileStorage.remove (bucket etiquetas)
                                            ↓
                                    Postgres (carga / orden)
```

- **Ruta:** `app/api/cron/purga-pdf-cargas/route.ts`, **clon estructural** de
  `app/api/cron/procesar-devueltas-sla/route.ts`: `bearerToken(req)`, secreto por
  `loadCronConfig().CORTE_DIARIO_SECRET` (la misma env `CRON_SECRET` que los cinco crons
  existentes; **no se añade env de secreto nueva**), `401` **antes** de construir el service
  (R25), lógica extraída a `handlePurgaPdfCargas(req, deps)` con `getSecret` / `service` / `now`
  inyectables, `withErrorHandler` + `appErrorToResponse`, y `200` con el resumen agregado (R23/R24).
  Solo se exporta `GET` (es lo que invoca Vercel Cron y lo que hacen los otros cinco).
- **`vercel.json`:** sexta entrada, `{ "path": "/api/cron/purga-pdf-cargas", "schedule": "0 9 * * *" }`.
  Costa Rica es **UTC−6 fijo, sin horario de verano**, así que 03:00 CR ≡ 09:00 UTC todo el año
  y no hace falta ninguna corrección estacional. Ninguna otra entrada usa esa hora
  (`corte-diario` y `generar-gastos-fijos` a las 06:00 UTC; `liberar_reprogramadas` y
  `analitica_rollup_diario` viven en la cola a 06:00 y 06:30 UTC).
- **`maxDuration`:** se declara en la ruta (patrón `api-key/carga/route.ts:75`) para que el tope
  por corrida de §2.1 tenga un presupuesto explícito contra el que dimensionarse.

### 2.1 Tope por corrida (R21/R22) — justificación

Una corrida procesa como mucho `PURGA_PDF_MAX_CARGAS_POR_CORRIDA` cargas (default **200**). El
motivo **no** es compartir presupuesto con nadie —ya no hay drenador de por medio—: es el
**límite de ejecución de la función serverless**. Cada carga cuesta una llamada a Storage
(`remove` con N rutas) más una transacción corta; la primera corrida sobre un histórico de meses
podría encontrar miles de cargas y agotar `maxDuration` **a mitad**, dejando la mitad del trabajo
hecho y la respuesta en error, sin que nada indique por dónde iba.

Con el tope, cada corrida termina **en éxito** con `quedaPendiente: true` (R22) y la del día
siguiente sigue por donde quedó (orden `created_at ASC`: siempre lo más viejo primero). El
backlog inicial se drena en tantos días como haga falta, o de golpe subiendo la env. Es la
compensación explícita de haber renunciado a la continuación encolada de la cola.

### 2.2 Qué se pierde al no usar la cola, y cómo se compensa (decisión (c) + (b))

| De la cola (feature 90) | Sustituto en esta feature |
|---|---|
| Reintentos con backoff | **Ninguno.** La recuperación es la corrida del día siguiente (R19): el trabajo no hecho sigue siendo elegible porque su referencia sigue viva. |
| Dead-letter y traza por ejecución | El **código HTTP** de la respuesta del cron (R23) y el resumen numérico logueado (R24). Los fallos quedan en los logs de Vercel Cron, no en una tabla consultable. **Limitación asumida y declarada.** |
| `dedupe_key` / idempotencia de encolado | Innecesario: no hay encolado. La idempotencia es del **estado de datos** (R8/R20): una carga sin referencias vivas ya no es candidata. |
| Troceado con continuación encolada | Tope por corrida + corrida diaria (§2.1, R22). |

Nada de esto necesita `JobTipo`, `RecurrenciaSpec`, `dedupe_key`, semilla ni registro en
`buildHandlers`/`buildRecurrencias`: **no se toca `procesar-jobs` ni el enum `job_tipo`**.

---

## 3. Modelo de datos y migración

**Sin tablas ni columnas nuevas.** Las cuatro columnas que se leen y escriben ya existen
(`carga.download_url`, `carga.download_storage_path`, `orden.download_url`,
`orden.download_storage_path`). Sin RLS nueva: no hay tabla nueva.

La migración de esta feature es **una sola carpeta** y contiene **solo índices** (R26):

```sql
-- migration.sql (UP)
CREATE INDEX "carga_purga_pendiente_idx" ON "carga" ("created_at")
  WHERE "download_storage_path" IS NOT NULL OR "download_url" IS NOT NULL;

CREATE INDEX "orden_purga_pendiente_idx" ON "orden" ("carga_id")
  WHERE "carga_id" IS NOT NULL
    AND ("download_storage_path" IS NOT NULL OR "download_url" IS NOT NULL);
```

```sql
-- down.sql (DOWN)
DROP INDEX "orden_purga_pendiente_idx";
DROP INDEX "carga_purga_pendiente_idx";
```

Cero DDL sobre datos: el UP solo crea índices y el DOWN solo los suelta (R26).

**Por qué el índice de `carga` es sobre `created_at` (decisión (a)):** hoy `carga` indexa
`fecha_carga`, no `created_at`, así que el filtro de corte de R5 no tiene soporte. Y **por qué es
parcial**: con el tiempo la inmensa mayoría de las cargas estarán **ya purgadas**; un índice total
sobre `created_at` obligaría a recorrerlas todas —de la más vieja a la más nueva— evaluando el
predicado de "referencia viva" hasta juntar las `limite` candidatas. El índice parcial **solo
contiene las filas pendientes**, así que la selección cuesta lo que el trabajo que queda, no lo
que el histórico acumulado. Lo mismo para `orden`: responde "¿esta carga aún tiene alguna orden
con referencia viva?" (R8) sin recorrer las órdenes ya limpias del lote.

Prisma **no sabe expresar índices parciales**, así que van a mano en el `migration.sql` y **no** se
declaran en `schema.prisma`. Precedente explícito del repo: los índices reales de `jobs` son
parciales y están documentados así en `db/schema.prisma:1619-1625`. Riesgo conocido y acotado: un
`prisma migrate dev --create-only` futuro puede proponer un `DROP INDEX` fantasma; por eso
`tasks.md` incluye la tarea de **medirlo** y, si aparece, documentarlo en el encabezado de la
migración (nunca "arreglarlo" borrando el índice).

---

## 4. Capas y contratos

### 4.1 Configuración — `lib/config/purga-pdf.ts` (R1-R4, R21)

```ts
export interface PurgaPdfConfig {
  /** Días de retención. Default 7. Mínimo 0. SIN tope superior (R3). */
  PURGA_PDF_RETENCION_DIAS: number;
  /** Tope de cargas procesadas por corrida (R21). Default 200. */
  PURGA_PDF_MAX_CARGAS_POR_CORRIDA: number;
}
export function loadPurgaPdfConfig(): PurgaPdfConfig;
```

- La retención **no** puede usar el `readPositiveInt` copiado de `lib/config/jobs.ts` /
  `lib/config/etiquetas.ts`: ese helper rechaza el `0` y lo mandaría al default, contradiciendo
  R3. Hace falta un `readNonNegativeInt(name, fallback)` local: ausente / vacía / no entera /
  **negativa** ⇒ `fallback` (R2); `>= 0` ⇒ el valor tal cual (R3). El tope de cargas por corrida
  sí usa la semántica positiva de siempre (un tope de 0 no purgaría nunca).
- **Sin `clamp` superior** (R3): decisión explícita del humano. A diferencia del TTL de una URL
  firmada, un valor absurdamente grande aquí **no abre ningún dato**: solo hace que la purga no
  borre nada.
- **`loadPurgaPdfConfig()` se llama dentro del handler, en cada corrida (R4)**; no se exporta un
  singleton congelado al importar, a diferencia de `etiquetasConfig`. Motivo: el proceso de una
  función serverless sobrevive entre invocaciones y el requisito pide que la ventana se resuelva
  por corrida; además así el test varía la env sin recargar módulos.
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
}

export interface IPurgaPdfCargasRepository {
  /** R5/R7/R8/R9: hasta `limite` cargas con `created_at <= corte` y referencia viva. */
  findCargasPurgables(corte: Date, limite: number): Promise<CargaPurgable[]>;
  /** R22: ¿queda AL MENOS UNA candidata? Sin `skip`, y el porqué importa: se llama DESPUÉS
   *  del bucle, y `limpiarReferencias` deja a NULL justo las columnas que hacen candidata a
   *  una carga, así que las ya purgadas NO casan el `where`. Un `skip: limite` se comería un
   *  segundo lote de candidatas VIVAS y declararía `false` habiendo trabajo. Ese era el
   *  bloqueante del review (ronda 1). */
  existeAlgunaCandidata(corte: Date): Promise<boolean>;
  /** R13/R14/R15: NULL en las 4 columnas de la carga y de SUS órdenes, en UNA transacción. */
  limpiarReferencias(cargaId: string): Promise<{ ordenesActualizadas: number }>;
}
```

Consulta de `findCargasPurgables`:

```sql
SELECT c.id
FROM carga c
WHERE c.created_at <= $corte            -- R5: INCLUSIVO (decisión (f))
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

`<=` y no `<`: el corte es inclusivo por decisión (f) ("se purga lo creado hace N días **o más**").
Con `N = 0` el corte es `now`, así que entra todo lo creado hasta ese instante.

Las rutas se leen en una segunda consulta por los `carga_id` obtenidos (`IN (...)`, índice
`orden_carga_id_idx` ya existente). Orden **ASC**: se purga primero lo más viejo, que es lo que un
operador espera cuando una corrida no alcanza a barrerlo todo (§2.1).

`limpiarReferencias` escribe en **una transacción por carga**: `UPDATE orden SET
download_url = NULL, download_storage_path = NULL WHERE carga_id = $id` (R14, **sin filtrar por
`deleted_at`** — R9) y `UPDATE carga SET download_url = NULL, download_storage_path = NULL WHERE
id = $id` (R13). Ninguna otra columna en el `data` (R15). La transacción es **por carga**, no por
corrida: una carga que falle no arrastra a las ya purgadas, y lo ya purgado no se repite mañana.

**No se reutiliza `OrdenRepository`**: ya tiene ~1600 líneas y sus métodos sobre estas columnas son
*setters* de una sola fila pensados para el camino caliente de la 177. Un repositorio propio
mantiene la superficie de la purga aislada y testeable, y evita que un cambio aquí toque el
repositorio del que cuelga media aplicación.

### 4.3 Servicio — `lib/services/PurgaPdfCargasService.ts` (+ `IPurgaPdfCargasService`)

```ts
export interface PurgaResultado {
  cargasPurgadas: number;
  ordenesAfectadas: number;
  objetosBorrados: number;   // rutas ENVIADAS a remove (ver §6)
  quedaPendiente: boolean;   // R22
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
1. cfg = loadConfig()                                    # R1-R4
2. corte = now - cfg.PURGA_PDF_RETENCION_DIAS días        # R5 (N=0 ⇒ corte = now)
3. candidatas = repo.findCargasPurgables(corte, tope)     # R7/R8/R9
4. por cada candidata (secuencial):
     4a. paths = [cargaPath, ...ordenPaths] sin nulos
     4b. si paths.length > 0 → storage.remove(paths)      # R10/R11/R12
     4c. repo.limpiarReferencias(cargaId)                 # R13/R14/R15
5. quedaPendiente = repo.existeAlgunaCandidata(corte)        # R22 (sin skip: ver §interfaz)
6. devolver conteos agregados                             # R24
```

**El orden 4b antes de 4c es deliberado** y es el inverso del que usa la 177 al generar. Ver §6.

Secuencial y no en paralelo: el borrado ya va agrupado por carga (una sola llamada a `remove` con
todas las rutas del lote), y paralelizar cargas multiplicaría la presión sobre Storage y sobre el
pool de Prisma dentro de una función con `maxDuration` acotado.

### 4.4 Bucket (R11)

El composition root de la ruta construye
`new SupabaseFileStorage(undefined, etiquetasConfig.ETIQUETAS_BUCKET)`. **Trampa real:** el
segundo parámetro tiene default `postulacionConfig.BUCKET` (documentos de mensajeros); olvidarlo
haría que la purga intentase borrar rutas de etiquetas en el bucket de postulaciones —silencioso,
porque `remove` no propaga error—. Por eso R11 tiene test propio sobre el composition root.

---

## 5. Contratos de entrada/salida

`GET /api/cron/purga-pdf-cargas`

- **Entrada:** `Authorization: Bearer <CRON_SECRET>`. Sin cuerpo, sin query params (la retención
  **no** es parametrizable por petición: decisión del humano, es env).
- **200:**

```json
{ "cargasPurgadas": 12, "ordenesAfectadas": 348, "objetosBorrados": 360, "quedaPendiente": false }
```

- **401:** `{ "error": "unauthorized" }` sin ejecutar nada (R25), incluido el caso "secreto no
  configurado en el entorno" (mismo criterio que los cinco crons existentes).
- **Error interno:** el que produzca `appErrorToResponse`; el código distinto de `200` es la señal
  observable de fallo (R23). Ningún log lleva el secreto, ni rutas de objetos, ni ids (R24).

---

## 6. Fallo parcial: por qué muere antes la referencia que el objeto (decisión (b))

Medido: `SupabaseFileStorage.remove` **descarta el `{ error }`** que devuelve el SDK
(`lib/storage/SupabaseFileStorage.ts:57-62`) e `IFileStorage.remove` devuelve `Promise<void>`. Con
el contrato actual el service **no puede** distinguir un borrado correcto de uno fallido, y
**ampliar `IFileStorage` queda fuera del alcance** por decisión del humano.

Decisión: **borrar (best-effort) y limpiar las columnas igual**, siempre, **sin reintentos internos
ni backoff**. Es la asimetría del daño:

| | Objeto borrado | Objeto vivo |
|---|---|---|
| **Columna limpiada** | caso feliz | objeto huérfano: cuesta espacio; `/generate` regenera |
| **Columna viva** | **`/generate` devuelve 200 con URL 404** (R16 roto) | no se purgó nada |

Si `remove` **lanza** (fallo de red antes de llegar a Supabase), esa carga se aborta **antes** de
limpiar y el error se propaga: la corrida termina en código de error (R23) y **la carga sigue
siendo candidata mañana** (R19/R20), porque su referencia sigue viva y `remove` es idempotente
sobre paths inexistentes por contrato de `IFileStorage`. No se reintenta dentro de la corrida: un
reintento inmediato ante un Storage caído solo consume el `maxDuration` que necesitan las cargas
siguientes.

Por eso `objetosBorrados` significa **"rutas enviadas a borrar"**, no "confirmadas": queda
declarado aquí y debe quedar en el comentario del service para que nadie lo lea como una garantía.

---

## 7. Alternativas descartadas (obligatorio)

### Alternativa A — Cola de jobs de la feature 90 (tipo `purga_pdf_cargas` + `RecurrenciaSpec`)

Era la **recomendación del spec_author**: tipo nuevo de `job_tipo`, handler registrado en
`buildHandlers`/`buildRecurrencias`, `dedupe_key` por corrida, continuación encolada y reintentos
con backoff y dead-letter gratis.

**Descartada por decisión del humano en la puerta F1.4 (c)**, no se reabre. Coste asumido y
declarado en §2.2: sin reintentos automáticos, sin dead-letter y sin traza consultable por
ejecución; se compensa con la cadencia diaria (una corrida fallida se recupera al día siguiente,
no a la semana siguiente), el código HTTP como señal de fallo (R23) y el tope por corrida (R21).
A cambio se evita añadir un valor al enum `job_tipo` —con su migración obligatoriamente aislada
por el 55P04 de Postgres y su `down.sql` que recrea el tipo entero— y tocar el registro compartido
del drenador.

### Alternativa B — Borrar las filas de `carga` (o hacer soft-delete del lote) en vez de anular columnas

**Descartada porque:** el lote es dato de negocio con FK `Restrict` desde `orden`
(`schema.prisma:550`); la feature pide **liberar storage**, no borrar historial. Un `DELETE`
fallaría por la FK y un soft-delete inventaría un estado que la 141 decidió explícitamente no
tener (`D3`: sin `status`).

### Alternativa C — Reconstruir las rutas y barrer el bucket con `list()`

**Descartada porque:** `IFileStorage` no expone `list` (solo `upload`/`remove`) y ampliarlo tocaría
un contrato compartido con la feature 21; el path es `{usuarioId}/{randomUUID()}.pdf`, así que la
antigüedad **no es deducible del nombre** y habría que fiarse del metadato del proveedor; y sobre
todo dejaría las columnas `download_storage_path` **vivas apuntando a objetos borrados**, que es
justo el 200-con-404 que R16 prohíbe. (A cambio, es lo único que alcanzaría a los huérfanos de la
136/141 — ver §Limitación heredada de `requirements.md`: ticket aparte, con regla de ciclo de vida
del bucket como opción preferida.)

### Alternativa D — Purgar por antigüedad de la **orden** (`orden.created_at`) en vez de por carga

**Descartada porque:** el humano fijó "agrupando por `carga_id`", y además rompe la unidad de
borrado: el PDF consolidado pertenece al lote, no a ninguna orden, y decidir cuándo borrarlo
exigiría igualmente agregar por `carga_id`. Sí es la forma natural del ticket aparte para las
órdenes con `carga_id` NULL (decisión (d)).

### Alternativa E — Marcar la carga como "purgada" con una columna nueva (`pdf_purgado_at`)

**Descartada porque:** el testigo ya existe y es exactamente `download_storage_path IS NULL AND
download_url IS NULL`; una columna nueva sería estado derivado, con su migración, su backfill y su
riesgo de desincronizarse (p. ej. si la 177 regenera el PDF después de la purga, `pdf_purgado_at`
mentiría y la carga quedaría exenta para siempre). Los índices parciales de §3 dan el mismo
rendimiento sin dato redundante.

### Alternativa F — Un solo `UPDATE ... WHERE created_at <= corte` masivo, sin recorrer cargas

**Descartada porque:** para borrar en Storage hay que **leer las rutas antes** de anularlas; si se
anulan primero, las rutas se pierden y los objetos quedan huérfanos **para siempre** (no hay
`list` en el contrato). Además un `UPDATE` masivo sobre `orden` sin cota bloquearía filas del
camino caliente durante toda la transacción, y con `maxDuration` acotado el corte a mitad dejaría
el trabajo a medias sin señal de por dónde iba.

### Alternativa G — Índice total sobre `carga.created_at` en vez de parcial

**Descartada porque:** no filtra por "referencia viva", así que con los años la selección tendría
que recorrer todo el histórico ya purgado —de lo más viejo a lo más nuevo— para encontrar las
pocas candidatas del día. El coste de la purga crecería con el histórico en vez de con el trabajo
pendiente. El precio del índice parcial es no poder declararlo en `schema.prisma` (§3), precio que
el repo ya paga en `jobs`.

---

## 8. Qué NO se toca

- `lib/services/ApiPdfEtiquetaService.ts`, `EtiquetasLotePdfService`, `EtiquetasDescargaService` y
  las rutas `/generate` de la 177: la purga es correcta precisamente porque **no** cambia su
  lógica (R16 se cumple con el estado de datos, no con un caso especial en el service).
- La cola de la feature 90: ni el enum `job_tipo`, ni `procesar-jobs`, ni `buildHandlers`,
  ni `buildRecurrencias`, ni scripts de siembra.
- `IFileStorage` y `SupabaseFileStorage`: `remove` ya existe y basta (decisión (b)).
- `middleware.ts`, `OrdenRepository`, el esquema de paths de Storage, la env `CRON_SECRET`
  (se reutiliza) y las columnas `download_url` como mecanismo de escritura de la 141.
