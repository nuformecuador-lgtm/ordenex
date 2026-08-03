# Feature 177 — Design

Decisiones técnicas ANTES de escribir código. Los requisitos viven en `requirements.md`;
aquí va el CÓMO.

> **Puerta F1.4 CERRADA.** (a) precedencia fija **`num_guia` gana** sobre `num_remision`, sin
> 409 de ambigüedad; (b) `/generate` responde **solo `POST`**; (c) ruta por carga
> `POST /api/ordenes/api-key/carga/{cargaId}/generate` con **uuid**, y publicar `cargaId` en el
> `CargaResponse` del OpenAPI entra en el alcance; (d) **sin** modo forzar-regeneración.
> Nada de esto se reabre.

---

## 1. Restricción de plataforma que fija la forma de las rutas

`app/api/ordenes/api-key/` ya tiene el segmento dinámico `[numGuia]`. **Next.js prohíbe dos
slugs con nombres distintos en el mismo nivel** (`[numGuia]` y `[id]` como hermanos): el build
falla con "You cannot use different slug names for the same dynamic path". Por tanto la ruta
nueva **no puede** ser `/api/ordenes/api-key/{id}`; necesita un segmento estático que la
desambigüe. Esto no es una preferencia estética: es la razón por la que la ruta lleva `orden/`.

Además, cualquier ruta nueva debe colgar del prefijo `/api/ordenes/api-key` para caer en
`SELF_AUTH_ROUTES` (`middleware.ts:32`, match por prefijo con `startsWith`). Las tres rutas
propuestas cumplen, así que **no se toca `middleware.ts`** (R40).

### Rutas

| # | Método | Ruta | Archivo |
|---|---|---|---|
| 1 | `GET` | `/api/ordenes/api-key/orden/{id}` | `app/api/ordenes/api-key/orden/[id]/route.ts` |
| 2 | `POST` | `/api/ordenes/api-key/orden/{id}/generate` | `app/api/ordenes/api-key/orden/[id]/generate/route.ts` |
| 3 | `POST` | `/api/ordenes/api-key/carga/{cargaId}/generate` | `app/api/ordenes/api-key/carga/[cargaId]/generate/route.ts` |

`POST /api/ordenes/api-key/carga` (feature 88) sigue existiendo y no colisiona: es otro path.

Los dos handlers de `/generate` exportan **solo `POST`** (decisión (b), R44): no se exporta
`GET` ni ningún otro verbo, de modo que Next responde `405` a los demás. Razón: `/generate`
escribe en la base y crea un objeto en Storage; un `GET` sería pre-fetcheable por navegadores,
crawlers y proxies, y cualquier reintento automático dispararía la generación.

---

## 2. Modelo de datos

### 2.1 El problema real (hallazgo del status_note, verificado)

`EtiquetasDescargaService.ts:48` hace `setCargaDownloadUrl(cargaId, out.signedUrl)` y
`EtiquetasLotePdfService.ts:78` produce esa `signedUrl` con
`signedUrls.createSignedUrl(path, ttl)`. El servicio **ya calcula y devuelve `path`**
(`return { path, signedUrl, expiraEnSegundos }`, línea 80) pero **nadie lo persiste**: lo que
llega a `download_url` es la URL firmada, que caduca.

Consecuencia dura: con el estado actual **es imposible distinguir "el PDF existe en Storage"
de "el PDF existe pero la URL caducó"**, porque la única evidencia guardada es la propia URL
caducada. Y `IFileStorage` (`upload`/`remove`) **no tiene operación de existencia**, así que
tampoco se puede preguntar a Storage sin salirse del contrato.

Dato adicional medido: `download_url` y `downloadUrl` **no tienen ni un solo lector** en
`app/` ni en `lib/` (la única aparición en `app/` es la escritura de la respuesta de la carga,
que usa el mapa en memoria, no la columna). Es hoy una columna write-only.

### 2.2 Decisión: DOS columnas nuevas, aditivas

```prisma
model Orden {
  // ...
  downloadUrl         String? @map("download_url")          // feature 136/141: URL FIRMADA (se deja intacta)
  downloadStoragePath String? @map("download_storage_path") // feature 177: ruta del objeto en el bucket de etiquetas
}

model Carga {
  // ...
  downloadUrl         String? @map("download_url")
  downloadStoragePath String? @map("download_storage_path")
}
```

Semántica (R36/R37):

- `download_storage_path IS NOT NULL` ⇔ **el PDF existe** ⇒ solo re-firmar.
- `download_storage_path IS NULL` ⇒ **no hay PDF** ⇒ generar, subir, escribir la columna.
- `download_url` **no se lee nunca** en esta feature y **no se escribe nunca** (R26/R35/R38).

**Filas heredadas de la 136/141** (`download_url` con URL caducada, `download_storage_path`
NULL): se tratan como "sin PDF" (R38). La primera llamada a `/generate` genera un objeto nuevo
y deja la columna poblada. El objeto viejo queda huérfano en el bucket; lo barrerá la feature
178 o el ciclo de vida del bucket. Es deuda acotada y visible, no silenciosa.

Sin RLS nueva: no hay tablas nuevas. `orden` y `carga` conservan su política actual (`carga`
tiene RLS habilitada sin policies, autorización en el service — `schema.prisma:580-583`); la
autorización de esta feature vive en el service/repositorio vía `tienda_id` / `usuario_carga`.

### 2.3 Migración

`db/migrations/<ts>_download_storage_path/`

`migration.sql` (UP):
```sql
ALTER TABLE "orden" ADD COLUMN "download_storage_path" TEXT;
ALTER TABLE "carga" ADD COLUMN "download_storage_path" TEXT;
```

`down.sql` (DOWN, obligatorio):
```sql
ALTER TABLE "carga" DROP COLUMN "download_storage_path";
ALTER TABLE "orden" DROP COLUMN "download_storage_path";
```

Aditiva, nullable, sin backfill, sin índices (no se filtra por esta columna: siempre se lee
por PK/owner ya resueltos). Reversible exactamente (R39).

---

## 3. Alternativas descartadas (obligatorio)

### Alternativa A — Reutilizar `download_url` para guardar el path (migrar la columna)

Migrar el significado de la columna existente: `download_url` pasaría a guardar la ruta, y la
migración haría `UPDATE ... SET download_url = NULL` en las filas que hoy tienen una URL.

**Descartada porque:** (1) la 136/141 **sigue escribiendo una URL ahí** después de esta feature
(no está en alcance cambiar la carga por API), así que la columna quedaría con dos semánticas
conviviendo y sin forma de distinguirlas; (2) el `down.sql` **no podría restaurar** las URLs
borradas: sería una migración destructiva e irreversible de facto, contra
`docs/architecture.md` §Migraciones; (3) el nombre `download_url` mintiendo sobre su contenido
es exactamente la clase de trampa que causó este hallazgo.

### Alternativa B — Extraer el path parseando la URL firmada ya guardada (backfill)

Una signed URL de Supabase tiene forma `/storage/v1/object/sign/<bucket>/<path>?token=...`, así
que el path es recuperable con una expresión regular sobre los valores existentes.

**Descartada porque:** acopla el esquema de datos al formato de URL de un proveedor externo que
puede cambiar sin aviso; un cambio de formato convertiría el backfill en paths inválidos que
firmarían objetos inexistentes (y `createSignedUrl` de Supabase **no falla** si el objeto no
existe: firma igual y el 404 llega al integrador al descargar). El beneficio —ahorrar una
regeneración por lote antiguo— no compensa. Se prefiere R38: regenerar la primera vez.

### Alternativa C — Preguntarle a Storage si el objeto existe (probe), sin columna nueva

Reconstruir el path determinísticamente (p. ej. `{usuarioId}/{ordenId}.pdf`) y hacer un `list`/
`head` contra el bucket para decidir si generar.

**Descartada porque:** `IFileStorage` no expone existencia (`upload`/`remove` solamente), así que
habría que ampliar un contrato compartido por la feature 21 y todas sus implementaciones; añade
un round-trip de red por request en el camino caliente; y obliga a cambiar el esquema de paths
de la 136 (hoy `{usuarioId}/{randomUUID()}.pdf`, `EtiquetasLotePdfService.ts:72,111`), que es
aleatorio a propósito. Coste alto para evitar una columna nullable.

### Alternativa D — Devolver la URL persistida y regenerar solo si el cliente reporta 403

Optimista: devolver `download_url` tal cual y dejar que el integrador reintente.

**Descartada porque:** traslada al integrador la gestión de la caducidad, rompe R23, y con TTL
de 5 minutos la URL guardada estaría caducada casi siempre. Es el bug que esta feature existe
para no cometer.

### Alternativa E — Ampliar `/api/ordenes/api-key/{numGuia}` para aceptar también la remisión

**Descartada por decisión del humano** (no se reabre): amplía el comportamiento de un endpoint
ya publicado a integradores; una remisión numérica cambiaría el significado de una llamada
existente sin cambio de versión.

### Alternativas descartadas EN la puerta F1.4 (decisión del humano)

- **`409 CONFLICT` ante coincidencia cruzada guía/remisión** (era la recomendación del
  spec_author). **Descartada:** el humano prefiere que el 100 % de las llamadas resuelva.
  Coste asumido y declarado: la orden alcanzable solo por su remisión colisionada queda
  invisible por esta ruta, en silencio (§4.2 y `requirements.md` §Riesgo declarado (a)).
- **`GET` en `/generate`, solo o junto a `POST`.** **Descartada:** solo `POST` (§1).
- **Identificar la carga por su `name`.** **Descartada:** `name` es nullable y único solo por
  usuario (`schema.prisma:588,597`); el uuid ya lo tiene el integrador.
- **Modo `force` de regeneración.** **Descartada:** ver §7bis.

---

## 4. Capas (Controller → Service → Repository)

```
app/api/ordenes/api-key/orden/[id]/route.ts                 ← Controller (consulta)
app/api/ordenes/api-key/orden/[id]/generate/route.ts        ← Controller (PDF orden)
app/api/ordenes/api-key/carga/[cargaId]/generate/route.ts   ← Controller (PDF carga)
   ↓
lib/services/ApiOrdenResolucionService.ts   ← resuelve {id} → orden propia (guía > remisión) | not_found
lib/services/ApiPdfEtiquetaService.ts       ← reuso-o-genera + firma (orden y carga)
   ↓
lib/repositories/OrdenRepository.ts (métodos nuevos)
   ↓ Prisma / Supabase Storage (IFileStorage, ISignedUrlProvider)
```

### 4.1 Interfaces nuevas (`lib/interfaces/`)

`lib/interfaces/services/IApiOrdenResolucionService.ts`
```ts
export type ResolverOrdenResult =
  | { status: "ok"; orden: { id: string; numGuia: number | null }; via: "num_guia" | "num_remision" }
  | { status: "not_found" };

export interface IApiOrdenResolucionService {
  resolver(actor: Actor, identificador: string): Promise<ResolverOrdenResult>;
}
```

`via` no viaja a la respuesta HTTP (el contrato publicado no lo incluye): existe para que el
test discriminante de la precedencia (R14) pueda afirmar POR QUÉ columna resolvió, además de
qué orden devolvió. **No hay `ambiguo`**: la decisión (a) lo eliminó del dominio.
```

`lib/interfaces/services/IApiPdfEtiquetaService.ts`
```ts
export type PdfEtiquetaResult =
  | { status: "ok"; url: string; expiraEnSegundos: number; generado: boolean }
  | { status: "not_found" }
  | { status: "sin_etiqueta" }      // → 409 (R25/R33)
  | { status: "excede_tope" };      // → 409 (R34)

export interface IApiPdfEtiquetaService {
  porOrden(actor: Actor, ordenId: string): Promise<PdfEtiquetaResult>;
  porCarga(actor: Actor, cargaId: string): Promise<PdfEtiquetaResult>;
}
```

### 4.2 Métodos nuevos de repositorio (`IOrdenRepository`)

```ts
/** R6-R12: hasta DOS filas (una por columna), scope forzado por owner y no borradas.
 *  Devuelve AMBAS coincidencias (no desempata): la precedencia de R14 la aplica el service. */
findByGuiaORemisionForOwner(
  identificador: { numGuia: number | null; numRemision: string },
  ownerId: string,
): Promise<Array<{ id: string; numGuia: number | null; numRemision: string }>>;

/** R20/R21: lee la referencia persistida del PDF individual (null = no hay PDF). */
findDownloadStoragePathByOrdenForOwner(ordenId: string, ownerId: string): Promise<string | null>;

/** R20/R26: escribe SOLO `download_storage_path`. */
setOrdenDownloadStoragePath(ordenId: string, path: string): Promise<void>;

/** R29/R32: carga propia + ids de sus órdenes vivas del owner; null si no existe/ajena. */
findCargaConOrdenesForOwner(
  cargaId: string,
  ownerId: string,
): Promise<{ downloadStoragePath: string | null; ordenIds: string[] } | null>;

/** R30/R35: escribe SOLO `carga.download_storage_path`. */
setCargaDownloadStoragePath(cargaId: string, path: string): Promise<void>;
```

Query de R6 (una sola ida a la base, ambas columnas ya indexadas por sus `@unique`):

```sql
SELECT id, num_guia, num_remision
FROM orden
WHERE tienda_id = $ownerId
  AND deleted_at IS NULL
  AND (num_guia = $numGuiaOrNull OR num_remision = $identificador)
LIMIT 2;
```

`LIMIT 2` no es una optimización caprichosa: dado que ambas columnas son `@unique` globales
(`schema.prisma:480-481`), el resultado tiene **como máximo 2 filas** (una por columna). Cuando
`{id}` no es entero positivo, `$numGuiaOrNull` es `NULL` y la comparación de guía nunca casa (R8).

**Desempate en el service (decisión (a), R14/R15):** sobre esas 0-2 filas,
`ApiOrdenResolucionService` aplica precedencia fija:

```
1. si alguna fila tiene num_guia === candidatoEntero  → esa fila (via: "num_guia")
2. si no, si alguna fila tiene num_remision === {id}  → esa fila (via: "num_remision")
3. si no hay filas                                    → not_found
```

Nunca devuelve `409`. Se prefiere resolver en el service, con las dos filas a la vista, antes
que hacerlo en SQL con `ORDER BY (num_guia = $g) DESC LIMIT 1`: la precedencia es una regla de
negocio (la decidió el humano y es la que un test debe poder fijar de forma discriminante), no
un detalle de ordenación de una query, y `docs/architecture.md` exige que la lógica de negocio
viva en el service. El coste es traer una fila de más en un caso raro.

**Riesgo declarado que esto introduce (aceptado):** la orden cuyo `num_remision` coincide con
el `num_guia` de otra orden propia queda **inalcanzable por esta ruta**, y el integrador no
recibe ninguna señal. Ver `requirements.md` §Riesgo declarado (a). Deliberadamente **no** se
añade un campo de aviso a la respuesta: cambiaría el contrato publicado por una situación que
el humano decidió tratar como silenciosa.

### 4.3 Reuso del generador de PDF (feature 136)

`EtiquetasLotePdfService` ya hace exactamente lo que hace falta y **devuelve el `path`**:

- PDF individual → `generarYAlmacenarPorOrden([ordenId], actor)` → `[{ ordenId, path, signedUrl, expiraEnSegundos }]` (lista vacía ⇒ sin etiqueta imprimible ⇒ `sin_etiqueta`).
- PDF consolidado → `generarYAlmacenar(ordenIds, actor)` → `{ path, signedUrl, ... } | null` (null ⇒ `sin_etiqueta`); lanza `EtiquetasLoteExcedeTopeError` ⇒ `excede_tope` (R34).

**Aislamiento por owner (crítico):** `IEtiquetaGuiaService.generarEtiquetas` declara
explícitamente que "no filtra por visibilidad de la orden"
(`IEtiquetaGuiaService.ts:38`). Por eso el service de esta feature **resuelve primero la orden
o la carga contra el repositorio con el owner forzado** y solo pasa a `EtiquetasLotePdfService`
ids ya verificados como propios. Sin ese orden, un integrador podría imprimir la etiqueta de
una orden ajena conociendo su id.

**TTL:** `EtiquetasLotePdfService` recibe el TTL por constructor, así que el mismo servicio se
instancia aquí con el TTL de 5 min sin tocar la feature 136. Al reusar (no generar), el service
llama directamente a `ISignedUrlProvider.createSignedUrl(pathPersistido, ttl)`.

### 4.4 Configuración (R43)

En `lib/config/etiquetas.ts`, junto a las existentes:

```ts
API_SIGNED_URL_TTL_SECONDS: clamp(
  readPositiveInt("ETIQUETAS_API_SIGNED_URL_TTL_SECONDS", 300),
  1,
  MAX_SIGNED_URL_TTL_SECONDS,
),
```

Default 300 s = los 5 min decididos por el humano, mismo TTL que las evidencias de la 106
(`gestionConfig.SIGNED_URL_TTL_SECONDS`). **No** se reutiliza `etiquetasConfig.SIGNED_URL_TTL_SECONDS`
(3600 s) porque ese valor gobierna la URL que devuelve la carga por API y bajarlo a 300
cambiaría el contrato de la 136/141 de contrabando.

Bucket: `etiquetasConfig.ETIQUETAS_BUCKET` (mismo bucket privado que la 136; el objeto es el
mismo tipo de artefacto).

---

## 5. Contratos de entrada/salida

### 5.1 `GET /api/ordenes/api-key/orden/{id}`

Entrada: path `{id}`, string; zod `z.string().trim().min(1).max(128)` (R13). El tope de 128 es
una **cota del borde**, no una regla de negocio: `num_remision` no tiene longitud máxima
declarada en el esquema ni en `filaCargaSchema` (`lib/types/carga-masiva.ts:81`, solo
`requiredNonEmpty`); se acota para no aceptar paths arbitrariamente largos desde fuera.

Salida `200`: **exactamente** el `ApiOrdenDetalleDTO` de la feature 106 (`lib/types/api-orden.ts`,
producido por `ApiOrdenLecturaService.detalle`). Se reutiliza el DTO y el schema OpenAPI
`OrdenDetalle` para que el integrador no tenga dos formas del mismo recurso.

```json
{
  "numGuia": 100234, "numRemision": "REM-0001", "estado": "entregada",
  "destinatario": "...", "telefonoDest": "...", "producto": "...",
  "direccion": "...", "montoCobrar": 25.9, "createdAt": "2026-07-22T14:03:11.000Z",
  "evidencias": [{ "resultado": "entregada", "contentType": "image/jpeg", "url": "...", "expiraEnSegundos": 300 }]
}
```

Errores: `401`, `403`, `404`, `422`. **No hay `409` en este endpoint:** con la precedencia de
(a) la resolución nunca es ambigua.

**Implementación de la lectura:** una vez resuelto `{id}` a una orden propia, el detalle lo
produce el `ApiOrdenLecturaService` ya existente. Como su `detalle(actor, numGuia)` opera por
`num_guia`, y una orden puede tener `num_guia = NULL` (`schema.prisma:480`), la resolución
devuelve el `orden.id` y se añade al repositorio la variante por id
(`findDetalleByOrdenIdForOwner`) reutilizando la MISMA proyección que
`findDetalleByNumGuiaForOwner`; el método de la 106 **no se modifica** (R17).

### 5.2 `POST /api/ordenes/api-key/orden/{id}/generate`

Entrada: path `{id}` (mismas reglas). Sin cuerpo (un cuerpo presente se ignora). **Solo `POST`**
(R44): el archivo de ruta exporta únicamente `POST`, así que Next responde `405` a `GET` y al
resto de verbos sin ejecutar nada.

Salida `200`:
```json
{ "url": "https://<proyecto>.supabase.co/storage/v1/object/sign/etiquetas-guia/...",
  "expiraEnSegundos": 300,
  "generado": true }
```

`generado: true` ⇒ el PDF se construyó y subió en esta llamada; `false` ⇒ se reusó el objeto ya
existente y solo se re-firmó (R22). Es el testigo observable del reuso.

Errores: `401`, `403`, `404` (inexistente/ajena/borrada), `409` (**solo** por orden sin etiqueta
imprimible), `422`, `405` (verbo distinto de `POST`), `500`.

### 5.3 `POST /api/ordenes/api-key/carga/{cargaId}/generate`

Entrada: path `{cargaId}` = **uuid** de `Carga.id` (decisión (c)), zod `z.string().uuid()` →
`422` si no es uuid. **Solo `POST`** (R44).
Salida: **idéntica** a §5.2 (R28). Errores: `401`, `403`, `404`, `409` (sin etiquetas /
excede tope), `422`, `405`, `500`.

De dónde saca el integrador ese uuid: de `cargaId` en la respuesta de
`POST /api/ordenes/api-key/carga`, que el handler ya devuelve (`carga/route.ts:367` propaga
`...summary`, y `summary.cargaId` se usa en la línea 303) pero que **el OpenAPI no publica**.
Por eso R45 mete la publicación de `cargaId` en `CargaResponse` dentro del alcance: sin ella el
contrato exigiría un identificador que el propio contrato no dice de dónde sale.

### 5.4 Errores

Todo error sale por `withErrorHandler` + `appErrorToResponse` con `UnauthenticatedError`,
`ForbiddenError`, `ValidationError`, `NotFoundError`, `ConflictError` de `lib/errors` (R42).
Sin códigos nuevos. La key nunca entra al cuerpo ni a los logs (R5).

---

## 6. Flujo de `/generate` (idéntico para orden y carga)

```
1. extraerBearer(req) → autenticar()          # 401 / 403           (R1-R3)
2. zod sobre el path param                     # 422                (R13)
3. resolver el recurso con owner forzado       # 404                (R6-R15, R29)
   (orden: precedencia num_guia > num_remision, nunca 409)
4. leer download_storage_path del recurso
   4a. NO NULL  → createSignedUrl(path, 300)   → { generado: false } (R21/R31)
   4b. NULL     → generar + upload + persistir path
                 → createSignedUrl(path, 300)  → { generado: true }  (R20/R30)
                 → sin etiquetas → 409          (R25/R33)
                 → excede tope   → 409          (R34)
5. 200
```

La escritura del paso 4b es un `UPDATE` de UNA columna, después de que el upload haya tenido
éxito. Si el upload va bien y el `UPDATE` falla, se responde `500` y la siguiente llamada
regenera: el peor caso es un objeto huérfano, nunca una referencia a un objeto inexistente.
Se prefiere ese orden al inverso (persistir y luego subir), que dejaría una referencia rota
apuntando a la nada, indistinguible de un PDF válido.

**Concurrencia (R27):** dos llamadas simultáneas sobre la misma orden sin PDF pueden generar
dos objetos; gana el último `UPDATE` y el otro queda huérfano. No se añade lock: el coste de
un objeto huérfano ocasional es menor que el de serializar el endpoint, y la feature 178 barre
el bucket. Queda declarado, no oculto. El requisito R27 se verifica sobre llamadas
**secuenciales** (que es el caso real del integrador), no concurrentes.

---

## 7. Contrato publicado (R41)

- `lib/api/openapi-spec.ts`: 4 → **7 paths**. Se añade el schema `PdfGenerateResponse`
  (`url`, `expiraEnSegundos`, `generado`) y se reutilizan `OrdenDetalle` y las `responses`
  existentes (`Unauthorized`/`Forbidden`/`NotFound`/`Conflict`/`ValidationError`).
- `docs/api/api-key-openapi.yaml`: espejo textual exacto (lo exige
  `tests/unit/api/openapi-contrato-en-reparto.test.ts`, que compara bloque a bloque).
- **Cuidado con el guard existente:** ese test afirma `expect(enumsTs).toHaveLength(4)` sobre
  los enums de ESTADO. Los endpoints nuevos **no deben introducir un quinto enum de estados**
  (la respuesta de `/generate` no lleva `estado`, y `OrdenDetalle` se reutiliza por `$ref`, sin
  duplicar el enum). Si el reuso por `$ref` no bastara, hay que actualizar el guard con
  justificación explícita, no relajarlo.
- **`cargaId` en `CargaResponse` (R45, decisión (c)):** se añade al schema `CargaResponse` del
  objeto TS y del `.yaml`, más el campo en el ejemplo publicado. **Tipo a confirmar contra el
  código en T1**: el lote puede no producir carga (`createOrdenesConGuia` devuelve
  `cargaId: string | null`), así que el schema debe declararlo `["string","null"]` con
  `format: "uuid"` salvo que la implementación demuestre que en la vía por API key nunca es
  `null`; no se declara `required` con un tipo que la respuesta pueda contradecir. Es una
  ampliación **aditiva** del contrato: ningún integrador existente se rompe por recibir una
  clave más. No se bumpea `info.version` (misma política que las features 135/153).

---

## 7bis. Consecuencia asumida de (d): sin refresco de layout

No existe `?force=true` ni ningún otro modo de forzar la regeneración: si hay
`download_storage_path`, se re-firma y punto. Consecuencia **asumida por el humano**: cuando el
layout de la etiqueta cambie —como ya pasó con la feature 150 y el tamaño de hoja— los PDFs ya
generados conservarán el layout viejo **indefinidamente**, y no hay forma de refrescarlos por
API. La única salida es que el objeto y su referencia desaparezcan (feature 178, purga) para que
la siguiente llamada regenere. Un despliegue que cambie el layout y quiera propagarlo tendrá que
apoyarse en esa purga, no en este endpoint.

A cambio se evita: multiplicar objetos en el bucket con cada llamada, tener que decidir si se
borra el objeto anterior (`IFileStorage.remove`) y gobernar los huérfanos que la 178 no
alcanzaría por no estar referenciados.

---

## 8. Qué NO se toca

- `app/api/ordenes/api-key/[numGuia]/route.ts` y `/cancelar` (feature 106).
- `EtiquetasDescargaService`, `EtiquetasLotePdfService` (salvo instanciarlos con otro TTL),
  `setCargaDownloadUrl`, `setOrdenesDownloadUrl` (feature 141).
- La columna `download_url` de ambas tablas: ni se lee ni se escribe aquí.
- `middleware.ts`: el prefijo ya cubre las rutas nuevas.
- El esquema de paths de Storage de la 136 (`{usuarioId}/{uuid}.pdf`).
