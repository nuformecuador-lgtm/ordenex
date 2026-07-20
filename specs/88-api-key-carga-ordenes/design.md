# Feature 88 — Diseño técnico

Consumo de la API key (81a): autenticación por key en una petición HTTP + endpoint de
carga de órdenes que genera guía inmediata y devuelve `num_guia`. **Reutiliza** el
modelo `ApiKey` (81), el hasher SHA-256 (81), `BulkOrdenService` (15), la secuencia
`orden_num_guia_seq` (17) y el manejador de errores global (10). No introduce migración.

## 1. Autenticación por API key (lo nuevo del backend)

### 1.1 Lookup por hash — extensión de `IApiKeyRepository`

Hoy `IApiKeyRepository` (`lib/interfaces/repositories/IApiKeyRepository.ts`) solo tiene
`createConUsuario`. Se agrega:

```
findByKeyHash(keyHash: string): Promise<ApiKeyAutenticada | null>
```

- `ApiKeyAutenticada` proyecta lo mínimo para autorizar y actuar:
  `{ apiKeyId, usuarioId, estado: EstadoUsuario, rol: string }`. **Nunca** proyecta
  `key_hash` ni el secreto (espejo de `PUBLIC_SELECT`, `ApiKeyRepository.ts:22`).
- Query: `prisma.apiKey.findUnique({ where: { keyHash }, select: { id, usuarioId, usuario: { select: { estado, rol: { value } } } } })`.
  `key_hash` es UNIQUE (`schema.prisma:1003`) → lookup O(1) por índice.
- La implementación `ApiKeyRepository.findByKeyHash` añade `usuario` (y su `rol`) al
  `Pick<PrismaClient>` del constructor si hiciera falta.

### 1.2 Servicio de autenticación — `ApiKeyAuthService` (nuevo, o método en un helper)

Función pura de borde, inyectable en tests:

```
autenticar(rawKey: string | null): Promise<
  | { status: "ok"; actor: Actor; apiKeyId: string }
  | { status: "unauthenticated" }   // sin key o hash no encontrado (R2/R4)
  | { status: "forbidden" }         // usuario no activo (R5)
>
```

- `rawKey` null/vacío → `unauthenticated` (R2), sin tocar la DB.
- Calcula `hashApiKey(rawKey)` (`lib/utils/api-key-hash.ts`, SHA-256 hex) — **exactamente
  el mismo hasher que usó la 81 al generar**, o el hash nunca coincidiría.
- `repo.findByKeyHash(hash)` → null ⇒ `unauthenticated` (R4).
- `estado !== "activo"` ⇒ `forbidden` (R5).
- ok ⇒ `Actor = { usuarioId, rol }` (tipo existente
  `lib/interfaces/services/IOrdenService`).
- **Nunca** loguea `rawKey` ni `hash` (R6). Es la regla de seguridad subrayada: la key
  viaja en cada request; ni la key ni el hash entran a un `console.*` ni a un error
  serializado. El lookup es por hash, jamás por comparación en claro.

## 2. Endpoint de carga por API (nuevo Route Handler)

Ruta propuesta: `app/api/ordenes/api-key/carga/route.ts` (`POST`). Namespace `api-key`
para separar visualmente la vía-integrador de la vía-sesión.

Sigue el patrón EXACTO de `carga-masiva/chunk/route.ts` (verificado): `withErrorHandler`
+ `isAppErrorShape`/`appErrorToResponse`, cuerpo `zod`, y **deps inyectables** para
test sin DB ni cookies:

```
export interface CargaApiDeps {
  autenticar?: (raw: string | null) => Promise<AuthResult>;
  bulkService?: IBulkOrdenService;
}
export async function handleCargaApi(req: Request, deps: CargaApiDeps = {}): Promise<NextResponse>
export async function POST(req: Request): Promise<NextResponse> { return handleCargaApi(req); }
```

Flujo dentro de `withErrorHandler`:
1. Extraer el secreto del header `Authorization: Bearer <key>` (§3). Ausente → `UnauthenticatedError` (R2).
2. `auth = await (deps.autenticar ?? defaultAutenticar)(rawKey)`.
   `unauthenticated` → `UnauthenticatedError` (401); `forbidden` → `ForbiddenError` (403).
3. Parsear cuerpo con `cargaApiBodySchema` (§4). JSON inválido / schema inválido →
   `ValidationError` (reusa `MSG.VALIDATION_ERROR` + `fieldErrors`).
4. `service.cargarViaApi(rows, auth.actor)` (§6) → mapear el resultado a la respuesta (§5).

No autoriza por rol `adminTienda` (esa es la vía sesión). La autorización aquí ES la
key activa. Defensa en profundidad: el service vuelve a exigir que el actor sea el de la
key (rol `apiKey`).

## 3. Presentación de la key en la petición — decisión

**Elegido: `Authorization: Bearer ordx_...`.**
- Estándar de facto para tokens portadores; soportado nativamente por todo cliente HTTP
  y por gateways/proxies sin config extra. El prefijo `ordx_` (`API_KEY_PREFIX`,
  `lib/utils/api-key-generator.ts:8`) permite validación superficial del formato.
- **Alternativa descartada: header propietario `X-API-Key: ordx_...`.** Más simple de
  leer (sin parsear el esquema `Bearer`), pero es un no-estándar: cada cliente debe
  configurarlo a mano, algunos proxies no lo propagan, y no reutiliza el ecosistema de
  auth existente. La ganancia (ahorrar un `split(" ")`) no compensa la fricción de
  integración. Se mantiene la puerta abierta a aceptar AMBOS en el futuro sin romper.

## 4. Contrato de entrada

```
cargaApiBodySchema = z.object({
  ordenes: z.array(z.record(z.string(), z.string())).min(1).max(MAX_CHUNK_ROWS),
})
```
- Reusa `cargaMasivaConfig.MAX_CHUNK_ROWS` (tope defensivo por lote).
- Cada fila es el mismo shape crudo `RawRow` que consume `BulkOrdenService` (clave =
  header, valor = texto): `num_remision`, `destinatario`, `telefono`, `provincia`,
  `canton`, `distrito`, `producto`, `monto_cobrar`, `direccion?`, `notas?`. Las mismas
  reglas de `filaCargaSchema`. No hay `dryRun` en esta vía (el integrador carga en firme).

## 5. Contrato de salida

`200` con:
```json
{
  "total": 3,
  "creadas": 2,
  "duplicadas": 1,
  "conError": 0,
  "ordenes": [
    { "id": "uuid", "numRemision": "R-001", "numGuia": 1042, "estado": "en_ruta_bodega_principal" }
  ],
  "filas": [
    { "fila": 1, "numRemision": "R-001", "resultado": "creada", "estatus": "en_ruta_bodega_principal", "numGuia": 1042 },
    { "fila": 2, "numRemision": "R-002", "resultado": "duplicada", "estatus": "..." },
    { "fila": 3, "numRemision": "R-003", "resultado": "error", "errores": { "monto_cobrar": ["..."] } }
  ]
}
```
- Reusa `BulkSummary` (`total/creadas/duplicadas/conError/filas`); **extiende solo las
  filas `creada`** con `numGuia`, y agrega el bloque plano `ordenes` (R10) que el
  integrador consume directo sin filtrar.
- Errores de la petición completa (auth, JSON): forma estándar `appErrorToResponse`
  (401/403/422), nunca con la key en el cuerpo.

## 6. `BulkOrdenService` — nuevo entrypoint `cargarViaApi` (reuso, no duplicación)

Se agrega un método público a `BulkOrdenService`/`IBulkOrdenService` que **reutiliza los
helpers privados existentes** (`precargar`, `resolveFila`, `buildSummary`) sin duplicar la
resolución geográfica/dedup/validación:

```
cargarViaApi(rows: RawRow[], actor: Actor): Promise<CargaViaApiResult>
```
- Guarda de rol: `actor.rol !== "apiKey"` → `forbidden` (la vía sesión sigue exigiendo
  `adminTienda` en `cargarMasiva`, intacta — R14).
- `tiendaId = actor.usuarioId` (el usuario dedicado de la key es el dueño de las órdenes;
  ver Decisión Abierta §F1.4-4).
- **Estado inicial fijo** `en_ruta_bodega_principal` (R8): NO se consulta el flag
  `fulfillment` de la tienda (ese branch es exclusivo de `cargarMasiva`). Se resuelve su
  `estatusId` con `repo.findEstatusIdByValue("en_ruta_bodega_principal")`; null (seed
  faltante) → todas las filas a error, como hace `cargarMasiva:207-219`.
- Reusa `resolveFila` para clasificar cada fila (creada / duplicada / error) igual que la
  carga masiva, incluida la dedup contra DB e intra-lote (R11/R12).
- Persistencia: NO usa `createManyOrdenes` (ese no asigna `num_guia`). Usa un método nuevo
  del repo (§7) que crea + numera en una tx y devuelve `num_guia` por orden.

### Por qué método nuevo y no extender `cargarMasiva`
- `cargarMasiva` guarda `rol === adminTienda`, deriva el estado del flag `fulfillment` y
  persiste sin guía. Sobrecargarlo con banderas (`estatusOverride`, `asignarGuia`,
  `allowRol`) haría que el camino money-critical de la carga masiva por sesión cambie de
  forma con cada request → más superficie de regresión (R14). Un entrypoint hermano que
  comparte los **helpers privados** logra el reuso real (la parte valiosa: geo/dedup/
  validación) sin tocar la garantía del camino existente.

## 7. Persistencia con guía inmediata — `OrdenRepository` (reconciliación con feature 17)

Método nuevo:
```
createManyOrdenesConGuia(
  data: CreateOrdenData[], batchSize: number, historial: HistorialContexto,
): Promise<Array<{ ordenId: string; numRemision: string; numGuia: number; estatusValue: string }>>
```
Dentro de UNA `$transaction` por chunk, combinando los DOS patrones ya probados del repo:
1. **Patrón `createManyOrdenes` (diff before/after + `skipDuplicates`)**
   (`OrdenRepository.ts:656-700`): inserta el chunk, detecta las filas realmente nuevas
   comparando ids antes/después (respeta duplicados por carrera).
2. **Patrón `generarGuiaLote` (nextval idempotente)** (`OrdenRepository.ts:894-896`): por
   cada orden nueva, `UPDATE "orden" SET num_guia = nextval('orden_num_guia_seq') WHERE
   id = $1 AND num_guia IS NULL`, luego `SELECT num_guia`. El nombre de la secuencia es la
   constante de módulo `NUM_GUIA_SEQUENCE`; **jamás** se interpola entrada de usuario.
3. `appendCambioEstado` (origen `null` → destino `en_ruta_bodega_principal`,
   `origenTipo` = `carga_masiva`, ver §F1.4-7) en la MISMA tx.

### El punto de diseño delicado: no duplicar guías
- Se consume **la misma secuencia** `orden_num_guia_seq` que "Generar guía" (feature 17)
  y el ruteo a satélite (feature 30). Al ser una única secuencia atómica de Postgres,
  dos vías nunca emiten el mismo número.
- La guarda `WHERE num_guia IS NULL` hace la asignación **idempotente**: si una orden ya
  trae `num_guia` (esta vía), un futuro "Generar guía" NO lo sobrescribe.
- Además, `en_ruta_bodega_principal` **no** es un estado de origen válido para
  `generarGuia` (solo `en_fulfillment`/`en_preparacion`, `GuiaAsignacionService.ts:28`),
  así que estas órdenes ni siquiera reingresan a esa vía. Doble garantía contra guía
  duplicada.

## 8. Modelo de datos y migración

- **Sin migración.** `api_key.key_hash` ya existe y es UNIQUE (81). `orden.num_guia` ya es
  NULLABLE (17). El enum de estado ya tiene `en_ruta_bodega_principal`. El rol `apiKey` y
  el enum `EstadoUsuario` ya existen. La secuencia `orden_num_guia_seq` ya existe.
- `last_used_at` / `revoked_at` en `api_key`: **fuera de alcance** (81b). No se añaden;
  el estado del usuario (`activo`) cubre la revocación funcional en R5.
- **RLS:** la autorización es server-side por hash de key; el Route Handler usa el cliente
  Prisma del servidor (igual que `carga-masiva/chunk`). No se delega la autorización a RLS.

## 9. Seguridad (subrayado)

- La key viaja en cada petición: **nunca** se loguea (ni key ni hash). Este repo ya tuvo
  un `console.log` que volcó un secreto — no se repite. Los errores devueltos por
  `appErrorToResponse` no incluyen el header de autorización.
- El lookup es **siempre** por `key_hash` (SHA-256 del secreto entrante); jamás se
  compara el secreto en claro contra la DB ni se guarda el secreto.
- `findByKeyHash` no proyecta `key_hash` ni ningún secreto en su tipo de retorno.
