# Feature 119 — Evidencias de gestión: de 1 a 1..N fotos · design.md

> Decisiones técnicas antes de tocar código. Todo lo que aquí se decide es vinculante para el
> implementer. Referencias en `archivo:línea` del código real explorado.

## 1. Modelo de datos

### 1.1 Tabla nueva `gestion_orden_evidencia` (R1/R2/R4)

Prisma (`db/schema.prisma`, junto a `model GestionOrden`):

```prisma
// Feature 119: evidencias 1..N de una gestion. Reemplaza la foto UNICA de
// gestion_orden.evidencia_storage_path/_content_type como fuente de verdad del
// conjunto; el path unico se conserva como PORTADA (indice 0) por retro-compat
// (design §2). RLS habilitada sin policies (solo service role, patron gestion_orden).
model GestionOrdenEvidencia {
  id          String   @id @default(uuid())
  gestionId   String   @map("gestion_id")
  storagePath String   @map("storage_path") // path bucket privado, NO URL
  contentType String   @map("content_type") // image/jpeg|png|webp
  indice      Int      // 0-based, orden de captura; 0 = portada
  createdAt   DateTime @default(now()) @map("created_at")

  gestion GestionOrden @relation(fields: [gestionId], references: [id], onDelete: Cascade)

  @@unique([gestionId, indice]) // R2: no dos filas con el mismo indice por gestion
  @@index([gestionId])          // lectura de las evidencias de una gestion
  @@map("gestion_orden_evidencia")
}
```

En `model GestionOrden` se añade el lado inverso: `evidencias GestionOrdenEvidencia[]`.

- **`onDelete: Cascade`**: la gestión es el padre natural del conjunto. Feature 67 ("deshacer
  gestión") ANULA con `anulada_at` (soft), no borra (`db/schema.prisma:476-477`), así que el cascade
  casi nunca dispara; se elige por corrección del FK hijo, no por un flujo de borrado.
- **`content_type` NOT NULL**: las escrituras nuevas siempre lo fijan; el backfill usa fallback para
  el caso raro de un histórico con path pero sin content_type (§1.3, y Pregunta abierta 4).

### 1.2 Migración UP (`db/migrations/<ts>_gestion_orden_evidencia/migration.sql`)

Patrón: tabla nueva aditiva, sin tocar columnas/policies previas (precedente
`20260714160000_gestion_orden_anulacion/migration.sql`). Contenido:

```sql
-- 1) Tabla 1:N de evidencias de gestion (R1/R2).
CREATE TABLE "gestion_orden_evidencia" (
  "id"           TEXT NOT NULL,
  "gestion_id"   TEXT NOT NULL,
  "storage_path" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "indice"       INTEGER NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gestion_orden_evidencia_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gestion_orden_evidencia_gestion_id_indice_key"
  ON "gestion_orden_evidencia" ("gestion_id", "indice");           -- R2
CREATE INDEX "gestion_orden_evidencia_gestion_id_idx"
  ON "gestion_orden_evidencia" ("gestion_id");

ALTER TABLE "gestion_orden_evidencia" ADD CONSTRAINT "gestion_orden_evidencia_gestion_id_fkey"
  FOREIGN KEY ("gestion_id") REFERENCES "gestion_orden"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) RLS habilitada sin policies (solo service role, patron gestion_orden). (R4)
ALTER TABLE "gestion_orden_evidencia" ENABLE ROW LEVEL SECURITY;

-- 3) Backfill (R3): cada gestion con evidencia actual -> UNA fila indice 0.
--    COALESCE cubre el caso raro path-sin-content_type (Pregunta abierta 4).
INSERT INTO "gestion_orden_evidencia" ("id", "gestion_id", "storage_path", "content_type", "indice", "created_at")
SELECT gen_random_uuid(), "id", "evidencia_storage_path",
       COALESCE("evidencia_content_type", 'image/jpeg'), 0, "created_at"
FROM "gestion_orden"
WHERE "evidencia_storage_path" IS NOT NULL;
```

### 1.3 Migración DOWN (`down.sql`, OBLIGATORIO)

```sql
-- Revierte EXACTAMENTE migration.sql: suelta la tabla nueva (y con ella el backfill).
-- NO toca gestion_orden: las columnas viejas y sus datos (incluida la portada) quedan
-- intactas, por eso revertir NO pierde la evidencia unica preexistente. Las fotos 2..N
-- de gestiones creadas tras la migracion SI se pierden: es el reverso de la feature.
DROP TABLE IF EXISTS "gestion_orden_evidencia";
```

## 2. Decisión: ¿se conservan o se deprecan las columnas viejas? — SE CONSERVAN (expand/contract, fase *expand*)

`gestion_orden.evidencia_storage_path` / `evidencia_content_type` **se conservan** y se re-usan como
**portada denormalizada** (evidencia índice 0), vía **dual-write** dentro de la misma transacción.
La tabla `gestion_orden_evidencia` es la **fuente de verdad del conjunto 1..N**.

Justificación:
- Hay **4 consumidores de lectura** de esas columnas que esta feature NO está en alcance de
  reescribir: cierre del día 37 (`CierreDiaService.ts:148-152`), cierres admin 38
  (`CierresAdminService.ts:126-130`), cierres bodega 40 (`CierresBodegaAdminService.ts:74-78`) y la
  API de lectura 106 (`OrdenRepository.ts:1182-1202`, `IOrdenRepository.ts:347`). Mantener la
  portada en las columnas viejas los deja funcionando **sin ningún cambio ni regresión** (siguen
  viendo exactamente una foto, la de hoy).
- El backfill (R3) llena la tabla nueva desde esas columnas; el dual-write (R12) las mantiene
  sincronizadas con el índice 0 hacia adelante → nunca hay una gestión nueva "invisible" para los
  consumidores viejos.
- La **fase contract** (soltar las columnas viejas + repuntar los 4 consumidores + sus DTOs/tests a
  renderizar N fotos) queda como **follow-up explícito fuera de alcance** (Pregunta abierta 1).

### Alternativa descartada — *drop-and-repoint en esta misma feature*

Soltar YA `evidencia_storage_path`/`_content_type` y repuntar en este mismo ciclo TODOS los
consumidores (cierres 37/38/40 + API 106 + sus repos, DTOs y tests) a leer de
`gestion_orden_evidencia`. **Rechazada** porque:
1. **Radio de impacto**: toca 6+ archivos repartidos en 4 features ajenas al pedido (que es "capturar
   1..N en gestionar + panel"), multiplicando la superficie de revisión y de regresión.
2. **Migración irreversible acoplada a refactor multi-consumidor**: un `DROP COLUMN` con pérdida de
   datos combinado con reescritura de 4 flujos de dinero (cierres) es alto riesgo para un solo PR.
3. Expand/contract permite **entregar la captura de forma segura ahora** y contraer después con su
   propia puerta de aprobación. El costo es una columna denormalizada (portada), patrón conocido y
   justificado, no duplicación accidental.

## 3. Contrato de aplicación

### 3.1 Tipos (`lib/interfaces/services/IMisAsignacionesService.ts`)

`EvidenciaArchivo` (`:139-142`) NO cambia. `GestionarInput` (`:149-168`) pasa el campo singular
`evidencia: EvidenciaArchivo` a **`evidencias: EvidenciaArchivo[]`** en las 3 ramas con foto
(entregada/devuelta/rechazada); `reprogramada` sigue sin evidencia:

```ts
export type GestionarInput = { ubicacion?: UbicacionInput } & (
  | { ordenId: string; resultado: "entregada"; montoRecibido: number; metodoPago: MetodoPago; evidencias: EvidenciaArchivo[] }
  | { ordenId: string; resultado: "reprogramada"; fechaReprogramacion: string; motivo: string }
  | { ordenId: string; resultado: "devuelta"; causaDevolucion: CausaDevolucion; motivo: string; evidencias: EvidenciaArchivo[] }
  | { ordenId: string; resultado: "rechazada"; motivo: string; evidencias: EvidenciaArchivo[] }
);
```

`GestionarServiceResult` (`:170-174`): `evidenciaUrl?: string` → **`evidenciaUrls?: string[]`** (R13).
El panel hoy ignora ese campo; el cambio es de contrato, sin consumidor UI que romper.

### 3.2 Config (`lib/config/gestion.ts`)

Añadir a `GestionConfig` el tope, sobreescribible por env (sin hardcode, patrón `:33-39`):

```ts
/** Maximo de evidencias por gestion (R7). Default 3. */
MAX_EVIDENCIAS_POR_GESTION: number; // readPositiveInt("GESTION_MAX_EVIDENCIAS", 3)
```

### 3.3 Validación de borde (`lib/types/gestion-orden.ts`)

`validarEvidencia` y `evidenciaSchema` (`:30-54`) se conservan **tal cual** (validación por archivo,
R8). Se añade el schema de lista:

```ts
const evidenciasSchema = z
  .array(evidenciaSchema)
  .min(1, "se requiere al menos una foto de evidencia")           // R6
  .max(gestionConfig.MAX_EVIDENCIAS_POR_GESTION, "maximo N fotos"); // R7
```

En `gestionarSchema` (`:110-148`) las ramas `entregada`/`devuelta`/`rechazada` cambian
`evidencia: evidenciaSchema` → `evidencias: evidenciasSchema`. El mismo schema se usa en cliente
(panel) y servidor (revalidación), igual que hoy.

### 3.4 Server Action (`lib/actions/mis-asignaciones.ts`)

- `rawFromFormData` (`:185-212`): `formData.get("evidencia")` → `formData.getAll("evidencia")`,
  filtrando strings; se expone como `raw.evidencias` (array de File-like).
- `toGestionarInput` (`:215-255`): en las 3 ramas con foto, `evidencia: await leerEvidencia(...)` →
  `evidencias: await leerEvidencias(data.evidencias)`.
- Nueva `leerEvidencias(files: FileLike[]): Promise<EvidenciaArchivo[]>` = `Promise.all(files.map(leerEvidencia))`.
  `leerEvidencia` (`:257-260`) se conserva.

### 3.5 Service — subida atómica con compensación (`lib/services/MisAsignacionesService.ts`)

`gestionar` (`:257-354`) conserva todas las guardas previas (rol, bloqueo 111, propiedad/origen,
monto == montoCobrar, resolución de estatus). Cambia el bloque de subida (`:304-320`) y el manejo de
error (`:336-340`). Secuencia:

```
1. (guardas actuales, sin cambio)
2. Si resultado ∈ {entregada, rechazada, devuelta}:
   uploaded: string[] = []           // paths ya subidos (para compensar)
   evidencias: {storagePath, contentType, indice}[] = []
   try {
     for (let i = 0; i < input.evidencias.length; i++) {   // secuencial y determinista
       const ev = input.evidencias[i]
       const ext = GESTION_MIME_EXTENSION[ev.contentType] ?? "bin"
       const path = `${ordenId}/${resultado}-${Date.now()}-${i}.${ext}`  // -i garantiza unicidad
       const stored = await storage.upload({ path, bytes: ev.bytes, contentType: ev.contentType })
       uploaded.push(stored)
       evidencias.push({ storagePath: stored, contentType: ev.contentType, indice: i })
     }
   } catch (e) {
     // R10: falla la subida #k -> borrar las k-1 ya subidas, NADA en DB.
     if (uploaded.length) await storage.remove(uploaded)
     throw e
   }
3. gestion = buildGestionData(input, evidencias)   // evidencias en vez de path/contentType singulares
4. try { await repo.crearGestionYTransicionar({ ordenId, mensajeroId, gestion, evidencias, nuevoEstatusId }) }
   catch (e) { if (uploaded.length) await storage.remove(uploaded); throw e }   // R11
5. registrarUbicacion (best-effort, sin cambio)
6. R13: evidenciaUrls = uploaded.length ? await signedUrls.createSignedUrls(uploaded, TTL) : undefined
        (createSignedUrls -> Record<path,url>; mapear en el orden de `uploaded`)
   return { status: "ok", ordenId, estado: resultado, evidenciaUrls }
```

- **Subida secuencial** (bucle `for await`): hace la compensación trivial y determinista (`uploaded`
  contiene EXACTAMENTE lo subido hasta el fallo). Para máx 3 fotos el costo de no paralelizar es
  despreciable y evita el enredo de rastrear cuáles resolvieron en un `Promise.all` que rechaza.
- `buildGestionData` (`:416-457`) deja de recibir `(storagePath, contentType)` singulares y pasa a
  recibir `evidencias`; para las ramas con foto arma `{ evidencias }`, para `reprogramada` sin foto.

### 3.6 Repository (`lib/interfaces/repositories/IGestionOrdenRepository.ts` + `GestionOrdenRepository.ts`)

`GestionOrdenData` (`IGestionOrdenRepository.ts:59-75`): añadir
`evidencias?: { storagePath: string; contentType: string; indice: number }[]`. Los campos singulares
`evidenciaStoragePath`/`evidenciaContentType` se **conservan** (portada, R12) pero los deriva el repo
del índice 0, no el service.

`crearGestionYTransicionar` (`GestionOrdenRepository.ts:266-344`) — dentro del MISMO `$transaction`
existente (R9), tras `tx.gestionOrden.create`:

```ts
const cover = gestion.evidencias?.find((e) => e.indice === 0) ?? gestion.evidencias?.[0] ?? null;
// en el data del create de gestionOrden (R12, dual-write):
evidenciaStoragePath: cover?.storagePath ?? null,
evidenciaContentType: cover?.contentType ?? null,
// tras crear la gestion, insertar las N filas hijas (R1/R2):
if (gestion.evidencias?.length) {
  await tx.gestionOrdenEvidencia.createMany({
    data: gestion.evidencias.map((e) => ({
      gestionId: creada.id, storagePath: e.storagePath, contentType: e.contentType, indice: e.indice,
    })),
  });
}
```

El `tx.orden.update` (estatus), `tx.usuario.update` (libera puntero), `appendCambioEstado` y el
encolado de reoptimización (`:300-341`) NO cambian: siguen en la misma transacción → atomicidad total
(R9/R11). El tipo del cliente Prisma de tx (`GestionPrismaClient`, `:27-30`) suma `gestionOrdenEvidencia`.

## 4. Frontend — `GestionarOrdenPanel.tsx` (multi-select + previews + quitar)

Estado: `evidencia: File | null` (`:147`) → **`evidencias: File[]`** (`[]` inicial). Cambios:

- **Selección múltiple** (R14): el `<input type="file">` de las 3 ramas
  (`:420-428`, `:474-482`, `:497-505`) lleva `multiple`. Se extrae un componente local
  **`EvidenciasField`** (multi-select + previews + quitar) reusado en las 3 ramas para no triplicar
  el markup (patrón `MotivoField`/`CausaField`, un solo consumidor → vive en el archivo).
- `handleEvidenciaChange` (`:157-169`): recorre `e.target.files`, **comprime cada una**
  (`comprimirImagen`, `:16/165`), y las **concatena** al array (permite ir agregando en varias
  selecciones). Aplica el tope: si excede `MAX_EVIDENCIAS_POR_GESTION`, recorta y marca error (R16).
- **Previews** (R15): por cada `File` un thumbnail con `URL.createObjectURL(file)`; se **revocan**
  (`URL.revokeObjectURL`) al quitar la foto y al desmontar (`useEffect` cleanup) para no fugar memoria.
- **Quitar** (R15): botón X por preview → `splice` del array + `revokeObjectURL`.
- `buildRaw` (`:178-203`) / `buildFormData` (`:206-226`): `evidencia` singular → `evidencias` array;
  `buildFormData` hace `fd.append("evidencia", file)` por cada foto (misma clave, N valores → el
  borde los lee con `getAll`).
- **Bloqueo de envío** (R16/R17): `handleConfirm` (`:259-296`) valida con `gestionarSchema.safeParse`
  (mismo schema que revalida el servidor); `min(1)`/`max(N)` producen error por campo `evidencias`
  sin llamar a la action. `elegirResultado` (`:248-257`) resetea `evidencias` a `[]`.
- Aplica a **entregada, rechazada y devuelta**; `reprogramada` sin cambios.

## 5. Integraciones / seguridad

- Bucket privado `gestion-evidencias` sin cambio (`lib/config/gestion.ts:36`); N objetos por gestión
  con path `{ordenId}/{resultado}-{ts}-{i}.{ext}`.
- Lectura siempre por URL firmada TTL corto (`ISignedUrlProvider.createSignedUrls`,
  `lib/storage/SupabaseSignedUrlProvider.ts:57-64`); nunca path crudo (R13).
- `storage.remove` es best-effort y no lanza ante paths inexistentes
  (`IFileStorage.ts:18-22`, `SupabaseFileStorage.ts:57-62`) → apto para la compensación R10/R11.
- Tabla nueva con RLS habilitada sin policies (R4); acceso solo por service role, patrón
  `gestion_orden`.
