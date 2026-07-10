# Feature 22 — Aprobación de postulaciones de mensajeros — design.md

> Backend puro. Reusa el patrón de capas Controller(Server Action) → Service →
> Repository con interfaces (docs/architecture.md), el `Actor`/`resolveActorFromSession`
> de auth, el manejador de errores global (feature 10) y `IFileStorage` (feature 21).

## 1. Decisiones clave (resumen)

| Tema | Decisión | Requisito |
| --- | --- | --- |
| Capa de entrada | 3 Server Actions internas (no rutas API) | R1 |
| Autorización | Guard por rol en el Service; `maestro`/`admin` OK, resto `forbidden` | R2/R3/R5 |
| Sesión | `resolveActorFromSession()` en la Action; `null` → `unauthenticated` | R4/R5 |
| Estado tras APROBAR | `pendiente` → `activo` | R12 |
| Estado tras RECHAZAR | `pendiente` → `inactivo` (ver P1, reusa enum, sin migración) | R16 |
| Documentos | URL firmada temporal del bucket privado `mensajero-docs` | R8/R9 |
| Migraciones | **NINGUNA** (con la decisión P1=`inactivo`) | — |
| Contrato de error | Resultados de dominio → `toActionError` / errores globales | R20/R21 |

**Consecuencia importante:** con P1 = `inactivo` esta feature NO crea tablas ni
migraciones. No hay tabla nueva → no aplica RLS nueva (el CHECKPOINTS RLS se
satisface por vacuidad). Si F1.4 elige `rechazado` nuevo, ver §7 (implica
migración up/down del enum).

## 2. Modelo de datos

No se introduce esquema nuevo. Se leen/escriben entidades existentes de la
feature 21:

- `Usuario` (tabla `usuario`): se lee (rol vía relación `rol`, estado, identidad,
  contacto, `tipoIdentificacion`, `vehiculo`, `placa`) y se escribe **solo** la
  columna `estado` en aprobar/rechazar (R15/R19).
- `MensajeroDocumento` (tabla `mensajero_documento`): solo lectura de los 5
  documentos (`tipo`, `storagePath`, `contentType`) por `usuarioId`.
- Enum `EstadoUsuario`: `pendiente | activo | inactivo | bloqueado` (sin cambios).
- Enum `RolValue`: `maestro | admin | mensajero | adminTienda | adminSatelite`.

Índices: la query de listado filtra por rol + estado. `usuario` ya tiene
`@@index([rolId])`. El filtro por estado se combina con `rolId`; para el volumen
esperado (postulaciones pendientes) es suficiente. Si el volumen creciera, se
evaluaría un índice compuesto `(rol_id, estado)` — se deja anotado, NO se crea en
esta feature (evitar índice especulativo sin ruta caliente demostrada).

## 3. Capas y archivos nuevos (backend)

```
lib/interfaces/services/IAprobacionPostulacionService.ts   # contrato service + tipos result
lib/interfaces/repositories/IAprobacionPostulacionRepository.ts  # contrato repo
lib/interfaces/external/ISignedUrlProvider.ts              # firma de URLs (ver §5)
lib/services/AprobacionPostulacionService.ts               # lógica + autorización
lib/repositories/AprobacionPostulacionRepository.ts        # queries Prisma
lib/actions/aprobacion-postulaciones.ts                    # 3 Server Actions ('use server')
lib/types/aprobacion-postulacion.ts                        # DTOs + schemas zod + Result de action
lib/config/aprobacion-postulaciones.ts                     # SIGNED_URL_TTL_SECONDS, PAGE_SIZE_MAX
```

Reusa sin duplicar: `Actor` (`@/lib/interfaces/services/IOrdenService`),
`resolveActorFromSession` (`@/lib/auth/resolve-actor`), `withErrorHandler` /
`UnauthenticatedError` / `ValidationError` / `isAppErrorShape` (`@/lib/errors`),
`toActionError` (`@/lib/actions/_shared/to-action-error`), `getPrismaClient`.

### Service (autorización + reglas)
```ts
const ROLES_APROBADORES = new Set<RolValue>(["maestro", "admin"]); // R2
// Guard comun al inicio de las 3 operaciones (R3/R5):
if (!ROLES_APROBADORES.has(actor.rol)) return { status: "forbidden" };
```
- `listarPendientes(input, actor)` → autoriza; llama `repo.listPendientes({skip,take})`;
  por cada usuario llama `repo.findDocumentos(usuarioId)` (o join) y genera URL
  firmada por documento vía `ISignedUrlProvider`. Devuelve `{items, page, pageSize, total}`.
- `aprobar(usuarioId, actor)` → autoriza; `repo.findMensajeroById(usuarioId)`;
  si `null` → `not_found` (R13); si `estado !== "pendiente"` → `conflict` (R14);
  `repo.actualizarEstado(usuarioId, "activo")` → `ok` (R12/R15).
- `rechazar(usuarioId, actor)` → igual patrón con estado destino `inactivo`
  (R16/R17/R18/R19).

**Transición atómica y anti-carrera (R14/R18):** `actualizarEstado` hace un
`updateMany({ where: { id, rol: {value:"mensajero"}, estado: "pendiente" }, data:{ estado } })`
y devuelve `count`. Si `count === 0`, el service reconsulta para distinguir
`not_found` (no existe/otro rol) de `conflict` (existe pero ya no está pendiente).
Así dos aprobaciones concurrentes no producen doble efecto (solo una ve `count=1`).

### Repository (solo Prisma)
```
findMensajeroById(id): { id, estado } | null   # where rol.value = 'mensajero'
actualizarEstadoSiPendiente(id, estadoDestino): number  # updateMany count (anti-carrera)
listPendientes({skip, take}): { items: PostulacionRow[], total }  # rol mensajero + estado pendiente
findDocumentos(usuarioId): MensajeroDocumentoDTO[]  # reusa forma de feature 21
```
`PostulacionRow` incluye datos R7 vía `include: { tipoIdentificacion, vehiculo, documentos }`.

### Server Actions (borde HTTP-less)
Patrón idéntico a `lib/actions/ordenes.ts`:
```ts
const r = await withErrorHandler(async () => {
  const actor = await (deps.getActor ?? resolveActorFromSession)();
  if (!actor) throw new UnauthenticatedError();       // R4
  const id = idSchema.parse(input);                   // R21 (ZodError → VALIDATION_ERROR)
  return service.aprobar(id, actor);                  // R20 resultado tipado
});
return isAppErrorShape(r) ? toActionError(r) : r;
```
Tres funciones exportadas: `listarPostulacionesPendientes`, `aprobarPostulacion`,
`rechazarPostulacion`, cada una con `deps` inyectables (`service?`, `getActor?`)
para test, siguiendo `OrdenActionDeps`.

## 4. Contratos I/O

```ts
// Entrada listado
type ListarPostulacionesInput = { page?: number; pageSize?: number };
// Salida (item)
interface PostulacionPendienteDTO {
  usuarioId: string;
  nombre: string; primerApellido: string | null; segundoApellido: string | null;
  email: string; telefono: string;
  tipoIdentificacion: string;      // value del catálogo
  cedula: string;
  vehiculo: string | null;         // value del catálogo
  placa: string | null;
  documentos: { tipo: MensajeroDocumentoTipo; url: string; expiresInSeconds: number }[]; // R8/R9
}
type ListarResult =
  | { status: "ok"; items: PostulacionPendienteDTO[]; page: number; pageSize: number; total: number }
  | { status: "forbidden" } | { status: "unauthenticated" };

// Aprobar / Rechazar
type DecisionResult =
  | { status: "ok"; usuarioId: string; estado: "activo" | "inactivo" }
  | { status: "forbidden" } | { status: "unauthenticated" }
  | { status: "not_found" } | { status: "conflict" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> };
```
Los `status` de dominio se mapean por `CODE_BY_DOMAIN_STATUS` (feature 10). El
`unauthenticated`/`validation_error` los produce la Action vía errores globales;
`forbidden`/`not_found`/`conflict`/`ok` los devuelve el Service.

## 5. Integración con Storage (URL firmada) — R8/R9

La feature 21 solo guarda `storagePath` en el bucket privado `mensajero-docs` y
`IFileStorage` expone `upload`/`remove`, **no** firma URLs. Decisión: **añadir un
contrato nuevo `ISignedUrlProvider`** (no ampliar `IFileStorage`, que es de
escritura) implementado sobre `supabase.storage.from(bucket).createSignedUrl(path, ttl)`:

```ts
interface ISignedUrlProvider {
  createSignedUrl(path: string, expiresInSeconds: number): Promise<string>;
  createSignedUrls(paths: string[], expiresInSeconds: number): Promise<Record<string,string>>;
}
```
- Implementación `SupabaseSignedUrlProvider` usa `createServerClient()` (service
  role) como `SupabaseFileStorage`. Testeable con un doble (sin red), igual que
  `StorageClientLike`.
- TTL desde `lib/config/aprobacion-postulaciones.ts`
  (`SIGNED_URL_TTL_SECONDS`, default 300, override por env) — sin hardcode
  (architecture.md "sin hardcode de contexto").
- Batch: usar `createSignedUrls` para los 5 (o N×5) paths en una llamada por
  usuario para no hacer 5 round-trips.

## 6. Alternativas descartadas

- **A1 — Ruta API (`app/api/postulaciones/...`) en vez de Server Actions.**
  Descartada: son mutaciones/consultas internas consumidas por el dashboard del
  mismo proyecto (feature 23); architecture.md manda Server Action para eso y
  reservar Route Handlers para webhooks/API pública/terceros. No hay consumidor
  externo ni firma/idempotencia de webhook que lo justifiquen.

- **A2 — Estado de rechazo = valor NUEVO `rechazado` en el enum.** Descartada
  como default por costo: requiere migración del enum Postgres `estado_usuario`
  (`ALTER TYPE ... ADD VALUE`), su `down.sql` (que en Postgres NO puede quitar un
  valor de enum sin recrear el tipo y reasignar columnas → down complejo/riesgoso)
  y actualizar toda la lógica que ramifica por estado. Reusar `inactivo` cumple
  el requisito ("cuenta sin habilitar") con cero migración. Trade-off:
  `inactivo` pierde la distinción semántica "rechazado" vs "desactivado luego de
  activo"; si esa distinción importa a negocio se decide en F1.4 (P1). Se elige
  la opción reversible y barata por defecto.

- **A3 — Devolver `storagePath` crudo y que la UI (feature 23) firme la URL.**
  Descartada: obligaría a exponer service-role/credenciales de Storage al cliente
  o a un endpoint extra, violando "el binario nunca es público" (R18 feature 21)
  y el principio de datos privados servidos desde el servidor. El backend (F22)
  entrega URL firmada de corta vida, controlando expiración y acceso.

- **A4 — Autorización por tabla de permisos (`Permiso`/`RolPermiso`).** Existe el
  modelo de permisos, pero el resto de features de dominio (ordenes) autorizan
  con un guard de rol en el Service (`KNOWN_ROLES`/matriz). Se mantiene esa
  consistencia: guard `ROLES_APROBADORES = {maestro, admin}` en el Service. Menos
  acoplamiento y test directo por rol. (Si más adelante se centraliza RBAC, se
  migra junto con ordenes, no aisladamente.)

- **A5 — `update` por PK + lectura previa para decidir conflict/not_found.**
  Descartada frente a `updateMany` condicional (where incluye `estado:
  pendiente`): la variante `updateMany` es atómica y evita la carrera de dos
  aprobadores simultáneos (R14/R18). Se mantiene una reconsulta SOLO cuando
  `count=0`, para distinguir 404 de 409 (no en el camino feliz).

## 7. Si F1.4 elige `rechazado` (contingencia)

Se agregaría: migración `db/migrations/<ts>_estado_usuario_rechazado/` con
`migration.sql` (`ALTER TYPE estado_usuario ADD VALUE 'rechazado'`) y `down.sql`
(recrear enum sin el valor, con reasignación de columna) — documentar el riesgo.
R16 cambiaría destino a `rechazado`. El resto del diseño no cambia.

## 8. Seguridad / checklist

- No se loguean PII ni URLs firmadas (contienen token). Errores envueltos con
  contexto sin secretos (conventions.md).
- No hay tabla nueva → RLS N/A (satisfecho por vacuidad). Las lecturas van por
  service-role del backend, nunca desde el cliente.
- No se hardcodea país/moneda/cuenta; TTL y page size por configuración.

## 9. Trazabilidad R → test (unit de service salvo indicado)

| R | Test (comportamiento) |
| --- | --- |
| R1 | `aprobacion-postulaciones` exporta 3 Server Actions (`'use server'`); no hay route handler (revisión) |
| R2 | service: `maestro` y `admin` pueden listar/aprobar/rechazar |
| R3 | service: `mensajero`/`adminTienda`/`adminSatelite` → `forbidden` sin tocar repo (spy) |
| R4 | action: `getActor` → null ⇒ `unauthenticated`, service no invocado |
| R5 | service: rol no autorizado ⇒ `forbidden` antes de llamar repo/signedUrl (spies sin llamadas) |
| R6 | service listar: repo devuelve solo mensajeros pendientes; result contiene esos ítems |
| R7 | service listar: DTO incluye nombre/apellidos/email/telefono/tipoId/cedula/vehiculo/placa |
| R8 | service listar: cada ítem trae 5 documentos con `url` firmada (provider spy devuelve URLs) |
| R9 | service listar: `createSignedUrls` llamado con `SIGNED_URL_TTL_SECONDS`; `expiresInSeconds` en DTO |
| R10 | service listar: pasa `skip/take` según page/pageSize; devuelve `total` del repo |
| R11 | service listar: repo vacío ⇒ `{items:[], total:0}` status `ok` |
| R12 | service aprobar: pendiente ⇒ `updateEstado(id,'activo')`, result `ok/estado activo` |
| R13 | service aprobar: repo `findMensajeroById`→null ⇒ `not_found`, no update |
| R14 | service aprobar: estado no pendiente (updateMany count 0 + reconsulta) ⇒ `conflict`, sin cambio |
| R15 | service aprobar: solo se llama update de estado; ningún otro campo en `data` |
| R16 | service rechazar: pendiente ⇒ estado `inactivo`, result `ok` |
| R17 | service rechazar: no mensajero/inexistente ⇒ `not_found` |
| R18 | service rechazar: estado no pendiente ⇒ `conflict`, sin cambio |
| R19 | service rechazar: no borra usuario ni documentos (repo sin delete) |
| R20 | action: mapea `forbidden/not_found/conflict/ok` al result tipado (integration action) |
| R21 | action: id vacío/mal formado ⇒ `validation_error`, service no invocado |

Cada `R<n>` mapea a ≥1 test; el implementer replica esta tabla en
`progress/impl_22-aprobacion-postulaciones.md` (CHECKPOINTS trazabilidad).
