# Feature 30 — Asignación por zona (GAM) y ruteo a bodega satélite · design.md

El CÓMO técnico. Se apoya en el flujo de la feature 17 (`GuiaAsignacionService`,
`OrdenRepository`, `lib/actions/ordenes-guia.ts`, UI del maestro) y en el modelo de la
feature 24 (`zona.esGam`, `usuario.zonaId`, `orden.zonaId`). NO se reinventa: se EXTIENDE
el cuerpo de piezas ya existentes conservando sus firmas (feature 17/R28 lo dejó previsto).

---

## 1. Modelo de datos

### 1.1 Nuevo estado de catálogo `en_ruta_bodega_satelite` (R1, R2)

- **TS (fuente de verdad):** añadir `"en_ruta_bodega_satelite"` como 10.º valor de
  `ORDER_STATUS_SEED` en `lib/types/order-status.ts` (tras `en_espera_aceptacion`). El seed
  idempotente `seedOrderStatus` (`scripts/seed-catalogos.ts`) itera la lista con upsert por
  `value`; no hay lista literal duplicada.
- **Migración Prisma** `db/migrations/<ts>_order_status_en_ruta_bodega_satelite/`:
  - `migration.sql` (patrón exacto de la feature 17,
    `20260711130000_..._espera_aceptacion/migration.sql`):
    ```sql
    ALTER TYPE "order_status_value" ADD VALUE IF NOT EXISTS 'en_ruta_bodega_satelite';
    INSERT INTO "order_status" ("id","value")
      VALUES (gen_random_uuid()::text,'en_ruta_bodega_satelite')
      ON CONFLICT ("value") DO NOTHING;
    ```
    (Nota para el runner: `ALTER TYPE ... ADD VALUE` no corre dentro de una transacción en
    Postgres antiguos; el `IF NOT EXISTS` lo hace idempotente — mismo comentario que la 17.)
  - `down.sql` (patrón `down.sql` de la feature 17): borra la fila SOLO si ninguna orden la
    referencia; documenta que el valor del enum Postgres no se elimina (`DROP VALUE` no
    existe). Es inocuo mientras ninguna fila lo referencie:
    ```sql
    DELETE FROM "order_status" WHERE "value" = 'en_ruta_bodega_satelite'
      AND NOT EXISTS (SELECT 1 FROM "orden" o JOIN "order_status" s
        ON o."estatus_id"=s."id" WHERE s."value"='en_ruta_bodega_satelite');
    ```
- **RLS:** `order_status` y `orden` ya tienen RLS habilitada (migración
  `20260709130100_ordenes` y catálogos); esta feature NO agrega policies ni tablas nuevas —
  no hay superficie RLS nueva. El acceso sigue siendo por service role del servidor.

### 1.2 Zona GAM (R3, R4)

No requiere cambios de esquema: la columna `zona.es_gam` y su índice único parcial
`zona_es_gam_unico WHERE es_gam = true` ya existen (feature 24). Se añade una consulta de
lectura para resolver el `id` de la zona GAM:

- `IZonaRepository.findGamZonaId(): Promise<string | null>` → implementada en
  `ZonaRepository` con `this.prisma.zona.findFirst({ where: { esGam: true }, select: { id: true } })`.
  `null` si aún no hay zona GAM (dispara el guardia R4 en el service).

**Reconciliación (R4):** hoy ninguna zona tiene `esGam = true`. NO se siembra por migración
(ver Preguntas abiertas (a)); en su lugar, el service rechaza con `validation_error` claro si
`findGamZonaId()` devuelve `null`, y el maestro marca la zona GAM desde configuración
(feature 24, `ZonaRepository.setGam` ya atómico y coherente con el índice parcial).

### 1.3 Nombre de zona en el listado (R14, R19)

`orden.zonaId` ya es NOT NULL y la relación `Orden.zona → Zona` existe. Se amplía la
proyección del LISTADO (no del CRUD `toDTO`) en `OrdenRepository.list`:

- En `WITH_ESTATUS_Y_TIENDA` (`lib/repositories/OrdenRepository.ts`) agregar
  `zona: { select: { nombre: true, esGam: true } }`.
- `toListItemDTO` agrega `zonaNombre: row.zona.nombre` y `zonaEsGam: row.zona.esGam`.
- `OrdenListItemDTO` (`lib/types/orden.ts`) suma `zonaNombre: string` y `zonaEsGam: boolean`
  (aditivo → no rompe consumidores, R19). La columna de zona se añade en
  `app/(app)/ordenes/_components/ordenes-columns.tsx`. `zonaEsGam` permite a la UI decidir
  por fila si mostrar select de mensajero (GAM) o "→ bodega satélite" (no-GAM).

---

## 2. Capa de repositorio (`OrdenRepository` / `IOrdenRepository`)

Métodos NUEVOS o modificados (Prisma queries puras, sin lógica de negocio):

| Método | Cambio | Req |
| --- | --- | --- |
| `findMensajerosGam(gamZonaId)` | NUEVO. `usuario.findMany({ where: { rol: { value: "mensajero" }, zonaId: gamZonaId }, select: { id, nombre }, orderBy: nombre })`. Reemplaza el cuerpo de `findAllMensajeros` en el loader del modal. | R5 |
| `findMensajeroIdsValidosGam(ids, gamZonaId)` | NUEVO. Subconjunto de `ids` con rol `mensajero` **y** `zonaId = gamZonaId`. Reemplaza a `findMensajeroIdsValidos` en la validación del service. | R6 |
| `findByIdsForTransicion(ids)` | MODIFICADO. Añadir a la proyección `zonaId: true` y `zona: { select: { esGam: true } }`; el `OrdenTransicionRow` suma `zonaId` y `zonaEsGam`. | R8/R9/R11/R12 |
| `list(params)` | MODIFICADO. Incluir `zona.nombre`/`zona.esGam` (§1.3). | R14 |
| `generarGuiaLote(decisiones)` | SIN cambio de firma. Ya fija `estatusId` + `mensajeroAsignadoId` + `num_guia` idempotente por decisión; el service ahora puede pasar `estatusId = en_ruta_bodega_satelite` con `mensajeroAsignadoId = null` para las no-GAM (R9/R10). No requiere método nuevo. | R10/R11 |
| `rutearBodegaSateliteLote(ordenIds, estatusId)` | NUEVO (para la acción dedicada R13, origen `en_bodega`/revisión). Igual que `generarGuiaLote` pero para un lote homogéneo no-GAM: asigna `num_guia` idempotente (`UPDATE ... WHERE num_guia IS NULL` con `nextval('orden_num_guia_seq')`), fija `estatusId` y `mensajeroAsignadoId = NULL`, transaccional. | R10/R13 |

`orden_num_guia_seq` se usa igual que en la feature 17 (constante de módulo
`NUM_GUIA_SEQUENCE`, nunca se interpola entrada de usuario en el SQL crudo).

`IZonaRepository.findGamZonaId()` (§1.2) se añade a la interfaz de zona.

---

## 3. Capa de servicio (`GuiaAsignacionService`)

Se INYECTA además `IZonaRepository` (o un método puente en `IOrdenRepository`; se elige
inyectar `IZonaRepository` para no acoplar zona a `OrdenRepository`). Constructor:
`constructor(repo: IOrdenRepository, zonaRepo: IZonaRepository)`.

### 3.1 `generarGuia(input, actor)` — extendido (R4, R6–R11, R16, R17)

Secuencia:
1. Autorización: `actor.rol !== "maestro"` → `forbidden` (sin cambio).
2. Resolver `gamZonaId = await zonaRepo.findGamZonaId()`. Si `null` → `validation_error`
   `{ zona: ["zona GAM no configurada"] }` (R4).
3. Precargar `ordenes = repo.findByIdsForTransicion(ordenIds)` (ahora con `zonaId`/`zonaEsGam`)
   y `mensajerosValidos = repo.findMensajeroIdsValidosGam(mensajeroIds, gamZonaId)`.
4. Validación por orden (aborta con `conflict.detalle` sin efectos, R17):
   - no existe / borrada / estado de origen no permitido (`en_fulfillment`/`en_preparacion`) →
     igual que feature 17.
   - **es GAM** (`orden.zonaId === gamZonaId`): si `mensajeroId != null` y no está en
     `mensajerosValidos` → detalle "mensajeroId no válido (no GAM)" (R6).
   - **NO es GAM** (`orden.zonaId !== gamZonaId`): si `mensajeroId != null` → detalle
     "no se puede asignar mensajero a orden de zona no-GAM" (R8). Si `mensajeroId == null` →
     se ruteará a satélite (válido).
5. Resolver `estatusId` destino por value: `en_espera_aceptacion`, `en_bodega`,
   `en_ruta_bodega_satelite` (guarda defensiva si falta el seed).
6. Construir `decisiones` para `generarGuiaLote`:
   - GAM + mensajero → `{ estatusId: espera, mensajeroAsignadoId: mensajeroId }`.
   - GAM + sin mensajero → `{ estatusId: bodega, mensajeroAsignadoId: null }`.
   - no-GAM → `{ estatusId: en_ruta_bodega_satelite, mensajeroAsignadoId: null }` (R9/R10).
7. `generarGuiaLote(decisiones)` (transaccional, todo-o-nada, R11/R17). `num_guia` a todas
   (incl. satélite, R10) idempotente.
8. Resultado por orden: `{ ordenId, numGuia, estado }` (estado ∈ {en_espera_aceptacion,
   en_bodega, en_ruta_bodega_satelite}).

### 3.2 `asignarDesdeBodega(input, actor)` — extendido (R6, R7, R12)

- Resolver `gamZonaId`; si `null` → `validation_error` (R4).
- Validar `mensajeroId` con `findMensajeroIdsValidosGam([mensajeroId], gamZonaId)` (R6).
- Cargar órdenes con `findByIdsForTransicion`; además del guardia de origen `en_bodega`
  (feature 17), rechazar por `conflict` cualquier orden cuyo `zonaId !== gamZonaId` (R12).
- Resto igual (fija `mensajeroAsignadoId`/`estatusId = en_espera_aceptacion`, no toca
  `num_guia`).

### 3.3 `rutearABodegaSatelite(input, actor)` — NUEVO (R13, R16, R17)

- `input`: `{ ordenIds: string[] }`.
- Autorización maestro; resolver `gamZonaId` (R4).
- Cargar órdenes; validar (aborta con `conflict.detalle`, sin efectos):
  - existe / no borrada;
  - estado de origen ∈ ORÍGENES permitidos (recomendado `en_fulfillment`, `en_preparacion`,
    `en_bodega`; ver Preguntas abiertas (d));
  - `orden.zonaId !== gamZonaId` (solo no-GAM; una orden GAM aquí → detalle "orden GAM no se
    rutea a satélite").
- Resolver `estatusId = en_ruta_bodega_satelite`; llamar `rutearBodegaSateliteLote` (R10).
- Resultado: `{ ordenId, estado: "en_ruta_bodega_satelite" }[]`.

> Alternativa de diseño para el ruteo (ver §7, alternativa B): NO añadir esta acción y
> forzar todo el ruteo dentro de `generarGuia`. Se conserva `rutearABodegaSatelite` para
> cubrir `en_bodega` y dar al maestro una acción explícita, pero su alcance de orígenes es
> Pregunta abierta (d).

---

## 4. Capa de acciones (Server Actions, `lib/actions/ordenes-guia.ts`)

Firmas ESTABLES (feature 17/R28); cambia el cuerpo / cableado (R18):

- `listarMensajerosParaAsignacion` — el cuerpo pasa a resolver `gamZonaId` y llamar
  `repo.findMensajerosGam(gamZonaId)` (antes `findAllMensajeros`). Firma y tipo de retorno
  (`MensajeroLiteDTO[]`) intactos (R5/R18). Si no hay zona GAM → devuelve lista vacía (la UI
  ya maneja lista vacía; la escritura falla con R4 en el service, mensaje claro).
- `generarGuia` / `asignarDesdeBodega` — el `buildGuiaService()` ahora inyecta también
  `ZonaRepository`. Sin cambios de firma ni de schema zod (`generarGuiaSchema`,
  `asignarBodegaSchema`).
- `rutearABodegaSatelite` — NUEVA action `'use server'` con `rutearSateliteSchema =
  z.object({ ordenIds: z.array(z.string().min(1)) })`, mismo patrón de `withErrorHandler` +
  `resolveActorFromSession` + `toGuiaActionError`. Resultado discriminado
  `RutearSateliteResult` (`ok` | `unauthenticated` | `forbidden` | `validation_error` |
  `conflict{detalle}`), en `lib/types/orden-guia.ts`.

Nuevos tipos en `lib/types/orden-guia.ts`: `rutearSateliteSchema`,
`RutearSateliteResultadoItem`, `RutearSateliteResult`.

---

## 5. UI del maestro (`app/(app)/ordenes/_components/`)

- **`OrdenesRevisionMaestro.tsx`**: añadir un 5.º apartado (solo-lectura, `selectable=false`)
  para `en_ruta_bodega_satelite` con título "En ruta a bodega satélite" (R15). El loader de
  mensajeros ya viene filtrado a GAM por la action (R5) — sin cambios en este componente
  salvo el apartado nuevo. Opcionalmente, un botón "Rutear a bodega satélite" en los
  apartados de revisión / `en_bodega` que abra un modal de confirmación y llame a
  `rutearABodegaSatelite` (R13).
- **`GenerarGuiaModal.tsx`**: usar `zonaEsGam` por fila. Las órdenes GAM conservan el select
  de mensajero (opciones ya GAM, R5/R7); las no-GAM se muestran en un grupo aparte
  "Se enviarán a la bodega satélite de \<zona\>" SIN select (R8), informando el destino. Al
  confirmar, se construye `decisiones` con `mensajeroId = null` para las no-GAM (el service
  las rutea, R9/R11). El resumen del toast distingue: en espera / en bodega / en ruta a
  satélite.
- **`AsignarBodegaModal.tsx`**: sin cambios de UI (el backend rechaza no-GAM, R12); las
  opciones del select ya son GAM (R7).
- **`ordenes-columns.tsx`**: nueva columna "Zona" (`zonaNombre`, R14). El `EstatusBadge` /
  etiqueta de estado mapea `en_ruta_bodega_satelite` → "En ruta a bodega \<zona\>" usando
  `zonaNombre` de la fila (R15).
- Permisos: la página `app/(app)/ordenes/page.tsx` no cambia (resuelve rol server-side;
  `admin` sigue en solo-lectura, R16).

---

## 6. Contratos I/O (resumen)

- `generarGuia({ decisiones: [{ ordenId, mensajeroId: string|null }] })` → `ok` con
  `resultados: [{ ordenId, numGuia, estado }]` (estado incluye `en_ruta_bodega_satelite`) |
  `conflict{detalle}` | `validation_error` | `forbidden` | `unauthenticated`.
- `asignarDesdeBodega({ ordenIds, mensajeroId })` → igual que feature 17, con nuevo motivo de
  `conflict` "orden no-GAM" (R12).
- `rutearABodegaSatelite({ ordenIds })` → `ok` con `resultados: [{ ordenId, estado }]` |
  `conflict{detalle}` | `validation_error` | `forbidden` | `unauthenticated`.
- `listarMensajerosParaAsignacion()` → `ok` con `mensajeros: MensajeroLiteDTO[]` (solo GAM).

---

## 7. Alternativas consideradas y descartadas

**A. Identificar la zona GAM por nombre ("GAM") en vez del flag `esGam`. — DESCARTADA.**
Frágil ante renombres, tildes/mayúsculas y errores de captura; requeriría normalización y no
garantiza unicidad. El flag `esGam` ya existe (feature 24) con índice único parcial que
garantiza a lo sumo una. Elegido: `esGam` (R3). Riesgo residual (que hoy no haya ninguna
GAM) se cubre con el guardia R4, no con el nombre.

**B. Rutear a satélite un estado dinámico por zona (p. ej. `en_ruta_bodega_limon`). —
DESCARTADA.** Multiplicaría el catálogo `order_status` por número de zonas, rompería el seed
declarativo (`ORDER_STATUS_SEED` fijo), y complicaría las guardias por estado y los queries.
Elegido: un solo `en_ruta_bodega_satelite` con nombre de zona derivado de `orden.zonaId` para
el display (R15/R20; precedente `en_ruta_bodega_principal`).

**C. Filtrar mensajeros por zona en el CLIENTE (traer todos y ocultar los no-GAM en la UI). —
DESCARTADA.** Expondría por la red mensajeros de otras zonas (fuga de datos operativos) y
sería evadible. Elegido: filtrar en el repositorio/DB (`findMensajerosGam`) y revalidar en el
service (R5/R6, defensa en profundidad).

**D. Diferir `num_guia` de las órdenes ruteadas a satélite hasta que la satélite las asigne a
un mensajero (feature 34). — DESCARTADA.** La bodega satélite RECIBE escaneando el QR de la
etiqueta (feature 33), y esa etiqueta (feature 32) se genera con `num_guia`. Sin guía en el
ruteo no habría QR que escanear. Elegido: asignar `num_guia` al rutear (R10), coherente con
feature 17/R19.

**E. Añadir una columna `orden.bodega_satelite_id` / FK explícita al destino. — DESCARTADA en
esta feature.** El destino se deriva de `orden.zonaId` (la feature 33 filtra por la zona del
`adminSatelite`). Añadir FK sería estado redundante sincronizable con `zonaId`. Queda como
Pregunta abierta (c) por si la 33 lo requiere; no se introduce aquí.

---

## 8. Riesgos / notas de implementación

- **Órdenes no-GAM preexistentes en `en_bodega`** (creadas por la feature 17 antes de la 30):
  la acción `rutearABodegaSatelite` con origen `en_bodega` (R13, Pregunta abierta (d)) permite
  sacarlas; sin ella quedarían atascadas. Confirmar orígenes en F1.4.
- **Inyección de `IZonaRepository` en `GuiaAsignacionService`**: actualizar `buildGuiaService`
  en `lib/actions/ordenes-guia.ts` y los tests que instancian el service (mock del zonaRepo).
- **Guardia R4**: los mensajes de error deben ser accionables ("configura la zona GAM en
  Configuración → Zonas"), sin filtrar internals (convenciones de manejo de errores).
