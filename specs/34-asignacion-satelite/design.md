# Feature 34 — Bodega satélite: asignación a mensajeros de su zona · design.md

> El CÓMO técnico. Las decisiones marcadas "(F1.4-x)" dependen de una pregunta abierta de
> `requirements.md`; aquí se documenta la opción recomendada y su alternativa descartada. Nada de
> código de producción se escribe hasta la aprobación humana.

## 0. Resumen

El `adminSatelite` entra prácticamente al mismo flujo de asignación a mensajeros del maestro
(feature 17), con dos restricciones scoped a SU zona: (1) solo asigna órdenes en
`en_bodega_satelite` de su zona; (2) solo a mensajeros de esa zona. Tras asignar, la orden pasa a
`en_espera_aceptacion` (mismo estado del flujo del maestro), lista para la feature 36. **No hay
estados nuevos, ni columnas, ni `num_guia` nuevo, ni tablas → NO hay migración ni superficie RLS
nueva.** El trabajo es: un service de dominio, una escritura de repo guardada por estado+zona, un
loader de mensajeros por zona, una Server Action y la extensión de la UI de `recepcion-satelite`.

## 1. Modelo de datos, migraciones y RLS

- **Sin cambios de esquema.** `Orden.estatusId`, `Orden.mensajeroAsignadoId` (NULLABLE),
  `Orden.zonaId` (NOT NULL, feature 24) y `Usuario.zonaId` (NULLABLE, solo mensajero/adminSatelite)
  ya existen. Los valores de catálogo `en_bodega_satelite` (feature 33) y `en_espera_aceptacion`
  (feature 17) ya están sembrados. → **NO hay migración Prisma ni `down.sql` en esta feature**
  (confirma R8/R16; se documenta explícitamente para el reviewer, que no debe exigir migración).
- **RLS:** sin tablas nuevas → sin policies nuevas. El acceso a `orden`/`order_status`/`usuario`
  sigue siendo por service role a través del repo (patrón features 17/30/33). El scoping por zona
  se aplica en la capa service/repo (server-side), NO por RLS de fila.

## 2. Backend — capas (Controller → Service → Repository)

### 2.1 Repository (`lib/repositories/OrdenRepository.ts`, `IOrdenRepository`)

Reúso + una escritura nueva:

- **Reúso directo (ya genéricos por `zonaId`):**
  - `findUsuarioZonaId(usuarioId)` → zona del adminSatelite (feature 33).
  - `findMensajeroIdsValidosGam(ids, zonaId)` → valida el `mensajeroId` contra la zona del actor
    (defensa en profundidad, R9). Se invoca con la zona del adminSatelite, NO con la GAM.
  - `findByIdsForTransicion(ids)` → precarga de órdenes con `estatusValue` / `zonaId` / `deletedAt`
    para las guardias por orden (R10–R12).
  - `findEstatusIdByValue("en_espera_aceptacion")` → resuelve el `estatusId` destino.
  - Loader de mensajeros para la UI: `findMensajerosGam(zonaId)` invocado con la zona del actor.
- **(F1.4-b) Renombrado recomendado:** `findMensajerosGam` → `findMensajerosByZona`,
  `findMensajeroIdsValidosGam` → `findMensajeroIdsValidosByZona` (más honesto; ya filtran por el
  `zonaId` recibido: `where: { rol: { value: "mensajero" }, zonaId }`). Requiere actualizar los
  llamadores de la 17/30 (`GuiaAsignacionService`, `lib/actions/ordenes-guia.ts`) — cambio aditivo
  de nombre, mismo comportamiento (R16 estable). *Alternativa descartada:* reusar con el nombre
  actual (nombre engañoso en el nuevo call-site).
- **Escritura NUEVA guardada por estado + zona (R14) — `asignarSateliteLote`:**
  ```
  asignarSateliteLote(
    ordenIds: string[],
    mensajeroId: string,
    zonaId: string,
    destinoEstatusId: string,   // id de en_espera_aceptacion
    origenEstatusId: string,    // id de en_bodega_satelite (guardia)
  ): Promise<number>            // filas efectivamente transicionadas
  ```
  `updateMany` con `WHERE id IN (...) AND estatusId = origen AND zonaId = zona AND deletedAt IS
  NULL`, `data: { mensajeroAsignadoId, estatusId: destino }`. Patrón `recibirEnSatelite`
  (concurrencia-segura): si `count !== ordenIds.length` alguna cambió de estado/zona entre lectura
  y escritura → el service reporta `conflict` sin efectos parciales (transacción todo-o-nada,
  Prisma revierte si el service decide abortar). NO usa `asignarBodegaLote` de la 17 porque esa
  escritura NO guarda por estado/zona en el `WHERE` (la 17 valida antes, sin carrera relevante para
  su UI de un solo maestro; el satélite tiene multi-operador por zona → necesita la guardia).

### 2.2 Service (`lib/services/…`, interfaz en `lib/interfaces/services/…`)

**(F1.4-a) Decisión: service PARALELO dedicado, no generalizar `asignarDesdeBodega`.**

Nuevo `AsignacionSateliteService.asignar(input, actor)` (interfaz `IAsignacionSateliteService`),
con la forma de resultado tipada espejo de la 17/33:

```
interface AsignarSateliteInput { ordenIds: string[]; mensajeroId: string }
type AsignarSateliteServiceResult =
  | { status: "ok"; resultados: { ordenId: string; estado: "en_espera_aceptacion" }[] } // R7
  | { status: "forbidden" }                                                             // R13
  | { status: "sin_zona" }                                                              // R3
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // mensajero_invalido / catálogo
  | { status: "conflict"; detalle: { ordenId: string; motivo: string }[] };             // R10–R12/R14
```

Flujo (orden de guardias, sin efectos ante cualquier rechazo):
1. `actor.rol !== "adminSatelite"` → `forbidden` (R13), antes de tocar datos.
2. `zonaId = findUsuarioZonaId(actor.usuarioId)`; si `null` → `sin_zona` (R3).
3. `findMensajeroIdsValidosByZona([mensajeroId], zonaId)`; si no lo contiene → `validation_error`
   `{ mensajeroId: ["mensajero_invalido"] }` (R9).
4. Precarga `findByIdsForTransicion(ordenIds)`; por orden acumula `detalle`: inexistente/borrada →
   `no_encontrada`; `zonaId !== zona` → `zona_ajena` (R11); `estatusValue !== "en_bodega_satelite"`
   → `estado_invalido: <estado>` (R12). Si `detalle.length > 0` → `conflict` (R10), sin escribir.
5. `findEstatusIdByValue` para origen (`en_bodega_satelite`) y destino (`en_espera_aceptacion`);
   si falta alguno → `validation_error` "catálogo de estados incompleto (seed pendiente)".
6. `asignarSateliteLote(ordenIds, mensajeroId, zonaId, destinoId, origenId)`. Si el `count` no cubre
   todas las órdenes (carrera R14) → re-lee y devuelve `conflict` sin efectos parciales.
7. `ok` con `resultados` (todas a `en_espera_aceptacion`).

**Por qué paralelo y no generalizar:** `GuiaAsignacionService.asignarDesdeBodega` está cableado a
`rol=maestro`, `findGamZonaId` (zona GAM fija), origen `en_bodega` y `asignarBodegaLote` (sin
guardia por estado/zona). Generalizarla exigiría parametrizar rol + fuente de zona + estado-origen
+ estrategia de escritura, mezclando dos autorizaciones en un método y tocando el service de la 17
(riesgo sobre su contrato aprobado, R16). El DRY real está en el REPO (primitivas compartidas);
la separación por rol vive mejor en services distintos. Ubicación del service nuevo: junto al
dominio satélite (`lib/services/AsignacionSateliteService.ts`), hermano de
`RecepcionSateliteService`.

### 2.3 Controller — Server Action (`lib/actions/`)

**(F1.4-c) Extensión de `lib/actions/recepcion-satelite.ts`** (o un `asignacion-satelite.ts`
hermano si la UI va en ruta nueva). Patrón exacto de `recibirPorQr`:

- `asignarDesdeSatelite(input, deps)`: `resolveActorFromSession` → si no hay actor,
  `UnauthenticatedError` (R1/R15); `asignarSateliteSchema.parse(input)` (zod: `ordenIds` no vacío
  de uuids, `mensajeroId` uuid) → `validation_error` en ZodError (R19); delega en el service bajo
  `withErrorHandler`. `forbidden`/`sin_zona`/`conflict`/`validation_error` son resultados de
  dominio del service; solo `UNAUTHORIZED`/`VALIDATION_ERROR` se traducen en el borde (espejo de
  `toRecepcionSateliteActionError`).
- Loader de mensajeros de la zona para el modal: `listarMensajerosSatelite(deps)` — resuelve
  `zonaId` del actor (`findUsuarioZonaId`) y devuelve `findMensajerosByZona(zonaId)`; rol !=
  adminSatelite → `forbidden`; sin zona → lista vacía (R5/R6). Análogo a
  `listarMensajerosParaAsignacion` de la 17 pero scoped a la zona del actor, no a la GAM.

Tipos y schemas zod en `lib/types/asignacion-satelite.ts` (o dentro de `recepcion-satelite.ts`),
patrón `lib/types/orden-guia.ts` / `recepcion-satelite.ts`.

## 3. Frontend — UI

**(F1.4-c) Recomendado: extender `app/(app)/recepcion-satelite/`.**

- `page.tsx`: además del pre-fetch actual (`listarRecepcionSatelite`), pre-fetch de
  `listarMensajerosSatelite()` y paso por props (datos sensibles vía Server Component padre, patrón
  actual). La validación de rol server-side (`notFound` si no adminSatelite) ya existe (R1).
- `RecepcionSateliteModule.tsx`: la sección **"Recibidas"** (`en_bodega_satelite`, R4) pasa de
  solo-lista a lista **seleccionable** con acción "Asignar":
  - selección múltiple de órdenes `en_bodega_satelite` (checkbox por fila).
  - botón "Asignar" abre un modal.
  - **(F1.4-d) Modal por lote con UN mensajero** — nuevo `AsignarSateliteModal`, clon del patrón
    `AsignarBodegaModal` de la 17 (`Modal` de `components/shared` + `Select` de mensajeros de la
    zona + `useToast`), llamando a `asignarDesdeSatelite({ ordenIds, mensajeroId })`. Éxito →
    `router.refresh()` (relee estado server, patrón feature 33). *Alternativa:* modal por-orden con
    override (patrón `GenerarGuiaModal`).
  - **R6:** si `mensajeros.length === 0` → estado vacío accionable + "Asignar" deshabilitado.
- La sección "Por recibir" sigue intacta (R7 de la 33: sin acción de asignar).
- Reúso de componentes: `components/shared/{Modal,PageHeader}`, `components/ui/{select,card,
  checkbox}`, `hooks/useToast`, `estatus-label`, `mensajero-options`/`toMensajeroOptions` (17).

*Alternativa descartada (F1.4-c):* ruta/módulo nuevos `/asignacion-satelite` — duplica shell,
authz y pre-fetch del adminSatelite sin ganancia; se prefiere un único módulo por rol.

## 4. Contratos de entrada/salida (resumen)

| Borde | Entrada | Salida (dominio) |
| --- | --- | --- |
| `asignarDesdeSatelite` (action) | `{ ordenIds: string[]; mensajeroId: string }` (zod) | `ok` / `forbidden` / `sin_zona` / `validation_error` / `conflict{detalle}` / `unauthenticated` |
| `listarMensajerosSatelite` (action) | — (actor) | `ok{ mensajeros }` / `forbidden` / `unauthenticated` |
| `AsignacionSateliteService.asignar` | `input`, `actor` | ver §2.2 |
| `asignarSateliteLote` (repo) | `ordenIds, mensajeroId, zonaId, destinoId, origenId` | `count` de filas transicionadas |

## 5. Alternativas descartadas (obligatorio)

1. **Generalizar `asignarDesdeBodega` de la 17** (parametrizar rol + zona-origen + estado-origen +
   escritura) en lugar de un service paralelo. *Descartada:* acopla dos modelos de autorización
   (`maestro`/GAM vs `adminSatelite`/zona-propia) en un método, toca el service ya aprobado de la
   17 (riesgo R16) y complica las guardias. El DRY se obtiene en el repo; la separación por rol se
   mantiene en services distintos. (Ver F1.4-a — sigue siendo pregunta abierta para el humano.)
2. **Reutilizar `asignarBodegaLote` (17) para la escritura.** *Descartada:* su `WHERE` no guarda
   por estado de origen ni zona (asume validación previa sin carrera relevante). El satélite es
   multi-operador por zona → necesita la escritura guardada `asignarSateliteLote` (patrón
   `recibirEnSatelite`) para concurrencia-segura (R14).
3. **Nuevo estado por zona / nuevo `num_guia` en la asignación.** *Descartada:* el destino
   `en_espera_aceptacion` ya existe y las órdenes ya tienen `num_guia` (30/17); introducir estados
   o guías nuevas rompería R8/R16 y el consumo idéntico de la feature 36 (R17).
4. **Módulo/ruta nuevos para la UI.** *Descartada:* duplica shell/authz/pre-fetch; se extiende
   `recepcion-satelite` (F1.4-c).

## 6. Verificación

- Unit (service, dobles de repo, sin DB/HTTP): R3, R5–R14.
- Integration (action + repo): R1, R2, R4, R14, R15, R19.
- Type/no-regresión: R16, R17 (contratos 17/30/33/36 estables).
- E2E (Playwright, escrito, ejecución diferida) si se aprueba F1.4-f: R18.
- CHECKPOINTS aplicables: capas (controller sin queries, service sin HTTP, repo solo Prisma),
  permisos server-side (`cookies()`/`resolveActorFromSession`), mutación por Server Action, sin
  hardcode de zona (se resuelve por `findUsuarioZonaId`). **No aplica** "migración con `down.sql`"
  (no hay migración) — documentado en §1 para el reviewer.
