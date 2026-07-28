# Feature 149 — Diseño técnico

> Deshacer asignación a mensajero o bodega antes de la recogida.
> Zona: fullstack. Complejidad: alta. `depends_on`: null (acopla con 140, 49, 17, 30, 33, 34, 41).

---

## §Decisiones (cerradas con el humano antes del spec — no se reabren)

### D1 — Roles autorizados

- `maestro` y `admin` (helper `esAccesoTotal`, `lib/auth/acceso-total.ts`) pueden deshacer
  cualquier orden, sin restricción de zona.
- `adminSatelite` solo puede deshacer órdenes de SU zona. El criterio de scoping se replica
  EXACTAMENTE de `AsignacionSateliteService.asignar`
  (`lib/services/AsignacionSateliteService.ts:58-133`):
  1. revalidación del rol server-side ANTES de tocar datos (`actor.rol !== ROL_AUTORIZADO` →
     `forbidden`);
  2. la zona se resuelve SERVER-SIDE con `repo.findUsuarioZonaId(actor.usuarioId)`, nunca se
     acepta del cliente; `null` → `sin_zona`;
  3. por cada orden se compara `orden.zonaId !== zonaId` → motivo `zona_ajena`;
  4. la guarda de zona se REPITE en el `WHERE` del UPDATE (`"zona_id" = $zonaId`), no solo en el
     service (defensa en profundidad / anti-TOCTOU).
- Ningún otro rol. `adminTienda`, `mensajero` y `apiKey` reciben `forbidden`.

### D1' — Reparto de casos por rol (derivado de D1, decisión de este spec)

El criterio es «deshace la bodega que tiene el paquete físicamente», el mismo de
`RecuperacionBodegaService.esBodegaResponsable` (feature 100) y de `resolverDestinoCierre`:

| Caso | Estado actual | Destino | Quién |
| --- | --- | --- | --- |
| (a) central | `por_recoger` | `en_bodega_central` | maestro/admin |
| (a) satélite | `por_recoger` | `en_bodega_satelite` | maestro/admin + adminSatelite de esa zona |
| (b) | `en_ruta_bodega_satelite` | `en_bodega_central` | maestro/admin |

El caso (b) NO se ofrece al `adminSatelite` (R36): el paquete está en tránsito bajo custodia de la
central, y la satélite no puede saber si ya salió. Además, el destino `en_bodega_central` implica
zona GAM, y la zona de un `adminSatelite` nunca es la GAM, así que la regla de D1 lo excluye por
construcción; R5 lo hace explícito en vez de dejarlo implícito.

### D2 — `num_guia` se CONSERVA

Nunca vuelve a NULL, ni se consume `nextval`. Ya está impreso en la etiqueta física y
`generarGuiaLote`/`rutearBodegaSateliteLote` son idempotentes sobre él (`WHERE num_guia IS NULL`),
de modo que una orden revertida y reasignada conserva la MISMA guía y la etiqueta impresa sigue
siendo válida. Ninguna escritura de esta feature toca la columna `num_guia`.

### D3 — El destino se DERIVA del historial

El destino sale de `orden_historial_estado`: la fila MÁS RECIENTE de la orden cuyo
`estatus_destino_id` es el `estatus_id` ACTUAL de la orden; se toma su `estatus_origen_id` y se
resuelve a `value`. Es exactamente «el origen de la transición que se está deshaciendo».

Se lee así (método NUEVO en `OrdenHistorialRepository`, ver §3.3):

```
SELECT estatus_origen.value
FROM orden_historial_estado h
WHERE h.orden_id = $ordenId AND h.estatus_destino_id = $estatusActualId
ORDER BY h.created_at DESC, h.id DESC
LIMIT 1
```

**Fallo CERRADO** (R13): si no hay fila, o si `estatus_origen_id` es NULL (fila de creación), o si
el `value` leído no está en la tabla de normalización, la orden se rechaza con `conflict` y motivo
`origen no derivable del historial`. NUNCA se adivina por zona ni por defecto.

### D3' — Normalización del origen leído (decisión de este spec, justificada)

Los orígenes posibles según el inventario 140 son seis: `en_bodega_central` (#8),
`en_bodega_satelite` (#9), `en_fulfillment` (#1/#3/#7b), `en_preparacion` (#4/#6/#7c) para el caso
(a) y (b), más `en_bodega_central` (#7) para el caso (b).

**Se soportan los cuatro, pero el destino se NORMALIZA a un estado de bodega** (R12):

| Origen leído | Destino | Por qué |
| --- | --- | --- |
| `en_bodega_central` | `en_bodega_central` | identidad |
| `en_bodega_satelite` | `en_bodega_satelite` | identidad |
| `en_fulfillment` | `en_bodega_central` | ver abajo |
| `en_preparacion` | `en_bodega_central` | ver abajo |

Justificación de las dos últimas filas (por qué NO se vuelve al estado pre-guía):

1. **Consistencia con D2.** Devolver la orden a `en_fulfillment`/`en_preparacion` CONSERVANDO el
   `num_guia` produce un híbrido inconsistente: una orden en estado pre-guía con guía impresa. En
   esos estados el listado ofrece «Generar guía», es decir, la acción que ya se ejecutó.
2. **Verdad física.** Las dos transiciones que producen esos orígenes dejan el paquete en la
   bodega CENTRAL: `generarGuia` solo asigna mensajero a órdenes GAM (`orden.zonaId ===
   centralZonaId`, `GuiaAsignacionService.ts:182-197`), y el ruteo a satélite parte siempre de la
   central. `en_bodega_central` es el estado que describe dónde está el paquete.
3. **Alcance de aristas.** Normalizar mantiene el inventario nuevo en TRES aristas (§2) en vez de
   siete, y no reabre caminos hacia estados de creación (R28).

**No se restringe el alcance** (la ruta «generar guía + asignar mensajero desde `en_preparacion`»
es la más común: rechazarla vaciaría la feature). Lo que sí se hace es cerrar la puerta a
adivinar: si el origen leído NO es uno de esos cuatro `value`, se rechaza (R13).

**Guardas de coherencia zona/destino** (R14/R15), porque la normalización introduce una inferencia
y esa inferencia se verifica en vez de asumirse:

- destino `en_bodega_central` + `orden.zonaId !== centralZonaId` → `conflict`;
- destino `en_bodega_satelite` + `orden.zonaId === centralZonaId` → `conflict`.

### D4 — Motivo OBLIGATORIO

Texto libre del operador, validado con zod en el borde:

```ts
motivo: z.string().trim().min(10, "explica el motivo (mínimo 10 caracteres)").max(300)
```

- **Mínimo 10**: fuerza una razón real y no un `"x"`; es una bitácora que se lee meses después.
- **Máximo 300**: la columna es `text` (`OrdenHistorialEstado.motivo String?`, sin límite en DB),
  pero la línea de tiempo (`HistorialOrdenTimeline.tsx`) renderiza el motivo en una celda; 300 es
  el tope del campo de motivo de gestión y mantiene la consistencia visual.
- UN motivo por invocación, aplicado a todas las órdenes del lote (R24).
- Se persiste en `orden_historial_estado.motivo`, la columna que ya expone
  `OrdenHistorialEntradaDTO.motivo` (`lib/types/orden-historial.ts:92-99`).

### D5 — `origen_tipo = deshacer_asignacion` (valor NUEVO del enum)

Migración `ALTER TYPE ... ADD VALUE IF NOT EXISTS` + `down.sql` que recrea el tipo (§4), patrón
EXACTO de `20260724150000_orden_historial_origen_devolucion_rechazada` (feature 139) y de
`cancelacion_api` (feature 106). Va SOLA en su migración: Postgres no permite USAR un valor de
enum recién añadido en la misma transacción que lo añadió (55P04).

Se añade también a:
- `db/schema.prisma`, enum `OrdenHistorialOrigenTipo` (línea ~1115, tras `devolucion_rechazada`);
- `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` en `lib/types/orden-historial.ts` — obligatorio: el
  `satisfies readonly PrismaOrdenHistorialOrigenTipo[]` y el `_EnsureExhaustive` rompen el build
  si el enum gana un valor que el SEED no lista.

**¿Entra en `ORIGEN_TIPOS_CON_GESTION`? NO.** El criterio documentado en
`lib/types/orden-historial.ts:38-71` es doble: (i) la familia solo existe para desambiguar la
NULIDAD del enlace a gestión en el derivador de intentos, y (ii) solo importa para transiciones
cuyo destino sea `devuelta`. `deshacer_asignacion`:

- NUNCA enlaza una gestión: su fila nace con `gestion_orden_id = NULL` por construcción (no hay
  gestión asociada a una asignación deshecha, igual que `liberacion_sin_gestionar` o
  `recuperacion_manual`);
- sus destinos son `en_bodega_central` / `en_bodega_satelite`, JAMÁS `devuelta`, así que nunca
  entra en el conteo de `contarPorDestinoVigentes` (`OrdenHistorialRepository.ts:91-107`), que
  filtra por `estatusDestinoId` = `devuelta`.

Dejarlo fuera es INOCUO y correcto: incluirlo, en cambio, haría que sus filas se interpretaran
como «huérfanas de gestión» (rama R26 del derivador), que es semánticamente falso.

---

## §1. Arquitectura y flujo

Capas, según `docs/architecture.md` (Controller → Service → Repository, mutación interna ⇒ Server
Action):

```
UI (cliente)
  app/(app)/ordenes/_components/DeshacerAsignacionModal.tsx           [NUEVO]
  app/(app)/recepcion-satelite/_components/DeshacerAsignacionSateliteModal.tsx [NUEVO]
        ↓ Server Action
  lib/actions/deshacer-asignacion.ts                                  [NUEVO]
        ↓ (zod en el borde + resolveActorFromSession)
  lib/services/DeshacerAsignacionService.ts                           [NUEVO]
        ↓ (interfaces)
  lib/repositories/OrdenRepository.deshacerAsignacionLote()           [MODIFICADO]
  lib/repositories/OrdenHistorialRepository.findOrigenesReversion()   [MODIFICADO]
        ↓
  appendCambioEstado (choke point 49) → guardia 140 → historial + webhook
```

Secuencia del service (orden deliberado: lo barato y lo que aborta todo, primero):

1. `esAccesoTotal(actor.rol)` o `adminSatelite`; nada más → `forbidden` (R1/R2).
2. Si `adminSatelite`: `findUsuarioZonaId` → `null` ⇒ `sin_zona` (R6).
3. `findCentralZonaId()` → `null` ⇒ `validation_error` («zona GAM no configurada»), misma guarda
   R4 de `GuiaAsignacionService`.
4. `findByIdsForTransicion(ordenIds)` (incluye borradas, para distinguir motivos): existencia
   (R18), borrada (R17), estado de origen permitido (R16), zona del actor (R4).
5. `findOrigenesReversion(items)` → derivación + normalización + coherencia zona/destino
   (R11-R15). Rechazo de cualquiera ⇒ `conflict` con `detalle` por orden.
6. Si el actor es `adminSatelite`: todos los destinos derivados deben ser `en_bodega_satelite`
   (R5), si no ⇒ `forbidden`.
7. **NO se consulta `findMensajerosBloqueados`** (Q1 CERRADA, R19): el cierre pendiente del
   mensajero NO bloquea el deshacer. Ver §8-Q1 para la justificación de la asimetría.
8. `findEstatusIdByValue` de los estados implicados; falta de seed ⇒ `validation_error`
   («catálogo de estados incompleto (seed pendiente)»), copia literal del mensaje ya usado.
9. `deshacerAsignacionLote(...)` — escritura transaccional (§3.2).
10. `ok` con `resultados: [{ ordenId, estado }]`.

Contrato de resultado: EL MISMO patrón de `GuiaAsignacionService` /
`IAsignacionSateliteService` — `ok | forbidden | sin_zona | validation_error | conflict`, con
`DetalleConflicto = { ordenId, motivo }` por orden, y todo-o-nada por lote (R20).

---

## §2. Guardia central de transiciones (acoplamiento con la feature 140)

`lib/types/order-status-transiciones.ts` es el inventario CERRADO y falla CERRADO: sin declarar
las aristas, `appendCambioEstado` lanza `TransicionIlegalError` y la transacción revierte.

**Aristas NUEVAS a declarar (continuación de la numeración del inventario):**

```ts
por_recoger: [
  { to: "en_ruta", via: "recoleccion", rol: "mensajero" },                                  // #11
  { to: "en_bodega_central", via: "deshacer_asignacion", rol: "maestro/admin" },            // #43 (149)
  { to: "en_bodega_satelite", via: "deshacer_asignacion",
    rol: "maestro/admin/adminSatelite (de la zona)" },                                      // #44 (149)
],
en_ruta_bodega_satelite: [
  { to: "en_bodega_satelite", via: "recepcion_satelite", rol: "adminSatelite" },            // #10
  { to: "en_bodega_central", via: "deshacer_asignacion", rol: "maestro/admin" },            // #45 (149)
],
```

`via`/`rol` son metadatos de trazabilidad; la legalidad depende SOLO del par `(origen, destino)`.
NO se declara ninguna arista hacia `en_fulfillment`/`en_preparacion` (D3').

**Qué rompe en los tests de la 140 (anticipado, no descubierto en implementación):**

| Archivo | Qué rompe | Corrección |
| --- | --- | --- |
| `tests/fixtures/inventario-transiciones-140.ts` | `INVENTARIO_FLUJO` no lista #43-#45 y `RECUENTO_INVENTARIO` fija 43 aristas / 39 pares | Añadir las 3 filas (transcritas a mano, no derivadas del mapa) y actualizar a `aristasFlujo: 46`, `paresUnicos: 42` |
| `tests/unit/domain/order-status-transiciones.guardia.test.ts:30-34` | asercion literal «43 aristas y 39 pares únicos» | Actualizar al nuevo recuento (usa `RECUENTO_INVENTARIO`, basta con el fixture + el título del test) |
| `tests/unit/domain/order-status-transiciones.guardia.test.ts:36-42` | «el mapa declara exactamente las aristas del inventario» | Pasa automáticamente si fixture y mapa se actualizan a la vez; es la red de seguridad de que no se cuela una arista de más |
| `tests/unit/domain/order-status-transiciones.guardia.test.ts:51` | `["por_recoger", "en_bodega_satelite"]` figura en la lista de pares que DEBEN lanzar; con #44 pasa a ser LEGAL | **Retirar** ese par de la lista de ilegales y sustituirlo por uno que siga siendo ilegal (`por_recoger -> en_preparacion`), añadiendo un caso de REGRESIÓN 149 que afirme que #43/#44/#45 SÍ pasan |
| `tests/unit/domain/order-status-transiciones.connectividad.test.ts` | nada | No cambian estados, ni terminales, ni el catálogo (sigue en 18); `en_ruta_bodega_satelite` y `por_recoger` ya tenían entrada y salida |

---

## §3. Modelo de datos y capa de repositorios

### §3.1 Tablas: ninguna nueva

Se reutilizan `orden` (columnas `estatus_id`, `mensajero_asignado_id`, `asignado_at`) y
`orden_historial_estado` (append-only, con su RLS de la feature 49). **Sin tablas nuevas ⇒ sin RLS
nueva.** `num_guia` y `prioridad` NO se tocan (D2, R30).

### §3.2 Escritura — `OrdenRepository.deshacerAsignacionLote` [NUEVO]

No existe hoy ninguna primitiva que sirva: `asignarBodegaLote` fija mensajero (lo contrario),
`rutearBodegaSateliteLote` consume `num_guia`, `recuperarABodega` (100) es de UNA orden, guardada
por `devuelta` y enciende `prioridad`. Se añade una primitiva propia, con el molde de
`asignarSateliteLote` (UPDATE crudo guardado + `RETURNING id` + append en la misma tx):

```ts
interface DeshacerAsignacionItem { ordenId: string; destinoEstatusId: string; }

deshacerAsignacionLote(
  items: DeshacerAsignacionItem[],
  origenEstatusIdPorOrden: ReadonlyMap<string, string>,
  historial: HistorialContexto & { motivo: string },
  zonaId: string | null,          // no-null ⇒ guarda de zona (adminSatelite)
): Promise<number>;
```

Dentro de UN `$transaction`:

1. Por cada item, `UPDATE "orden" SET "estatus_id" = $destino, "mensajero_asignado_id" = NULL,
   "asignado_at" = NULL, "updated_at" = NOW() WHERE "id" = $id AND "estatus_id" = $origen AND
   "deleted_at" IS NULL [AND "zona_id" = $zonaId] RETURNING "id"` — la guarda por estado de
   origen (+ zona para el `adminSatelite`) es la defensa anti-TOCTOU (R21).
   **SIN `NOT EXISTS` sobre `cierre_dia`** (Q1 CERRADA, R19): a diferencia de
   `asignarSateliteLote`, este writer NO consulta cierres. Añadir esa guarda aquí sería un error:
   ver §8-Q1.
   **`num_guia` y `prioridad` NO aparecen en el `SET`** (D2, R30): la ausencia es el mecanismo,
   y es aserto de test (T4.12).
2. Si el total de filas devueltas ≠ `items.length` ⇒ **lanza** `DeshacerAsignacionConflictoError`
   con los ids que no transicionaron. El `throw` revierte la `$transaction` completa: TODO-O-NADA
   real (R20/R21), a diferencia de `asignarSateliteLote`, que deja pasar los ganadores. Es una
   desviación DELIBERADA del precedente y está justificada: aquí una reversión parcial dejaría
   parte de un lote sin mensajero y parte con él, sin forma de saber cuál desde la UI.
3. `appendCambioEstado(tx, entradas)` con una entrada por orden efectivamente transicionada:
   `estatusOrigenId` (el de la guarda, garantizado), `estatusDestinoId`, `actorUsuarioId`,
   `origenTipo: "deshacer_asignacion"`, `motivo`. El choke point valida la transición (140),
   escribe el historial (49) y encola el webhook (99/104) en la MISMA tx (R31/R32/R33).

4. **ANCLA PARA LA FEATURE 146 (Q5 CERRADA, R41).** Justo DESPUÉS del `appendCambioEstado` y
   DENTRO de la misma `$transaction` es donde se enganchará el productor de la notificación al
   mensajero desasignado, cuando exista el canal de la feature 146. El implementador DEBE dejar
   ahí, literalmente, este comentario-ancla (sin código):

   ```ts
   // TODO(146): productor de notificación al mensajero desasignado. Cuando exista la campana
   // de notificaciones (feature 146), encolar AQUI —en esta misma tx, patrón transactional-
   // outbox del webhook de estado— un aviso por cada orden revertida que TENIA mensajero:
   //   destinatario = mensajeroAsignadoId ANTES del UPDATE (capturarlo del RETURNING o del
   //                  pre-read; el UPDATE ya lo puso a NULL)
   //   contenido    = "La orden <num_guia> fue retirada de tus asignaciones"
   // Solo caso (a) (`por_recoger`); el caso (b) no tiene mensajero. Ver specs/149 R41.
   ```

   Consecuencia de implementación: el `RETURNING` del UPDATE del paso 1 DEBE incluir también
   `"mensajero_asignado_id"` **antes** de la escritura (`RETURNING "id", (SELECT ...)` no sirve;
   se captura en el pre-read del lote), para que la 146 tenga el destinatario disponible sin
   rehacer la consulta. Esta feature captura el dato y lo descarta; la 146 lo consume.

El service captura `DeshacerAsignacionConflictoError`, re-lee con `findByIdsForTransicion` y
devuelve `conflict` con el detalle por orden.

### §3.3 Lectura — `OrdenHistorialRepository.findOrigenesReversion` [NUEVO]

```ts
findOrigenesReversion(
  items: readonly { ordenId: string; estatusActualId: string }[],
): Promise<Map<string, string | null>>;   // ordenId -> estatus_origen.value | null
```

UNA consulta para todo el lote (sin N+1), usando el índice existente
`@@index([ordenId, estatusDestinoId])` de `orden_historial_estado`: `DISTINCT ON (h.orden_id)`
sobre las filas `(orden_id, estatus_destino_id)` del lote, `ORDER BY h.orden_id, h.created_at
DESC, h.id DESC`, con join a `order_status` para devolver el `value` del origen. `null` ⇒ no hay
fila o el origen es NULL ⇒ el service rechaza (R13, fallo cerrado).

Se añade a `IOrdenHistorialRepository`. Es una lectura pura, sin lógica de negocio: la
normalización (D3') y las guardas de coherencia viven en el service.

### §3.4 Interfaces [NUEVAS/MODIFICADAS]

- `lib/interfaces/services/IDeshacerAsignacionService.ts` [NUEVO]: `DeshacerAsignacionInput`
  (`{ ordenIds: string[]; motivo: string }`), `DeshacerAsignacionServiceResult`,
  `DeshacerAsignacionResultadoItem`, reutilizando `DetalleConflicto` de
  `IGuiaAsignacionService`.
- `lib/interfaces/repositories/IOrdenRepository.ts` [MOD]: `deshacerAsignacionLote` + tipos.
- `lib/interfaces/repositories/IOrdenHistorialRepository.ts` [MOD]: `findOrigenesReversion`.
- `lib/services/mensajes-deshacer-asignacion.ts` [NUEVO]: constantes de motivo tipadas
  (`MSG_SIN_HISTORIAL`, `MSG_ZONA_DESTINO_INCOHERENTE`, `MSG_ESTADO_NO_REVERSIBLE`), patrón
  `lib/services/mensajes-bloqueo.ts` (feature 46), para que los tests aserten sobre constantes y
  no sobre literales duplicados. NO hay constante de «mensajero con cierre pendiente»: ese motivo
  no existe en esta feature (Q1 CERRADA).

---

## §4. Migración (up + down)

Directorio: `db/migrations/20260728120000_orden_historial_origen_deshacer_asignacion/`

**`migration.sql` (UP)**

```sql
-- Feature 149 (D5, R25): añade `deshacer_asignacion` al enum `orden_historial_origen_tipo`.
-- Clasificación propia de la reversión de una asignación/ruteo ANTES de la recogida
-- (por_recoger -> en_bodega_central/en_bodega_satelite, en_ruta_bodega_satelite ->
-- en_bodega_central; actor = maestro/admin/adminSatelite). Distinguible en la línea de tiempo
-- de asignacion_bodega / asignacion_satelite / ruteo_satelite / ajuste_estado.
--
-- VA SOLA: Postgres no permite USAR un valor de enum recién añadido en la misma transacción que
-- lo añadió (55P04) y Prisma Migrate corre cada migration.sql en una transacción. Su primer uso
-- ocurre en runtime, en transacciones posteriores. Mismo precedente que
-- 20260724150000_..._devolucion_rechazada y 20260724130000_..._recepcion_bodega_central.
-- `IF NOT EXISTS` la hace idempotente. ADITIVA: no altera tablas (sin RLS nueva).
ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS 'deshacer_asignacion';
```

**`down.sql` (DOWN)**

```sql
-- DOWN (149): Postgres NO soporta `ALTER TYPE ... DROP VALUE`; el tipo se RECREA sin
-- `deshacer_asignacion`. Patrón IDÉNTICO a
-- 20260724150000_orden_historial_origen_devolucion_rechazada/down.sql.
--
-- Precondición: NINGUNA fila de "orden_historial_estado" con origen_tipo = 'deshacer_asignacion'.
-- Si quedara alguna, el USING falla RUIDOSAMENTE y el rollback aborta: es el comportamiento
-- CORRECTO (borrar rastro de auditoría de reversiones ya ejecutadas no es seguro).
--
-- La ÚNICA columna que usa el enum es "orden_historial_estado"."origen_tipo". La lista debe
-- coincidir con el enum ANTES de esta migración: los 22 valores vigentes.
ALTER TYPE "orden_historial_origen_tipo" RENAME TO "orden_historial_origen_tipo_old";
CREATE TYPE "orden_historial_origen_tipo" AS ENUM (
  'carga_masiva', 'creacion_manual', 'generacion_guia', 'asignacion_bodega', 'ruteo_satelite',
  'recepcion_satelite', 'asignacion_satelite', 'recoleccion', 'gestion',
  'liberacion_reprogramada', 'ajuste_estado', 'deshacer_gestion', 'carga_api',
  'liberacion_devuelta_sla', 'escalado_devuelta_sla', 'reprogramacion_tienda',
  'recuperacion_manual', 'cancelacion_api', 'corte_sin_gestionar', 'liberacion_sin_gestionar',
  'recepcion_bodega_central', 'devolucion_rechazada'
);
ALTER TABLE "orden_historial_estado"
  ALTER COLUMN "origen_tipo" TYPE "orden_historial_origen_tipo"
  USING ("origen_tipo"::text::"orden_historial_origen_tipo");
DROP TYPE "orden_historial_origen_tipo_old";
```

---

## §5. Server Action y contratos I/O

`lib/actions/deshacer-asignacion.ts` [NUEVO] — mutación interna ⇒ Server Action, nunca ruta API
(`docs/architecture.md`). Patrón literal de `lib/actions/resolver-novedad.ts`:
`withErrorHandler` + `resolveActorFromSession` + zod en el borde + fábrica del service.

**Entrada**

```ts
const deshacerSchema = z.object({
  ordenIds: z.array(z.string().uuid()).min(1),
  motivo: z.string().trim().min(10).max(300),   // D4/R22
});
```

**Salida** (`DeshacerAsignacionActionResult`)

```ts
| { status: "ok"; resultados: { ordenId: string; estado: "en_bodega_central" | "en_bodega_satelite" }[] }
| { status: "forbidden" }
| { status: "sin_zona" }
| { status: "validation_error"; fieldErrors: Record<string, string[]> }
| { status: "conflict"; detalle: { ordenId: string; motivo: string }[] }
| { status: "unauthenticated" }
```

Ningún mensaje incluye UUIDs ni PII (R40): los motivos son constantes tipadas y el `ordenId` viaja
en un campo aparte, que la UI usa para señalar la fila, no para renderizar texto.

---

## §6. UI

### §6.1 Listado del maestro — `app/(app)/ordenes/_components/OrdenesListado.tsx` [MOD]

**Por LOTE, no por orden.** Precedente del repo: todas las acciones de este listado son por lote
(`AccionLote` + modal sobre la selección: `GenerarGuiaModal`, `AsignarBodegaModal`,
`RecuperarABodegaModal`). El caso de uso real es el mismo que la asignación que revierte —el
maestro asignó un lote y se equivocó de mensajero—, así que revertir de a una sería una regresión
de ergonomía. El motivo obligatorio es único por lote (D4/R24), lo que encaja con un solo modal.

Cambios:
- `accionesDe("por_recoger")` y `accionesDe("en_ruta_bodega_satelite")` suman
  `{ key: "deshacer", label: "Deshacer asignación", variant: "outline", onRun: abrirDeshacer }`
  junto a «Imprimir etiquetas» (hoy su única acción).
- `ModalAbierto` suma `"deshacer-asignacion"`; se monta `DeshacerAsignacionModal` con
  `ordenesSeleccionadas`; `onSuccess = handleSuccess` (cierra + revalida las tablas, R38).
- `bloqueoSeleccion`: sin cambios. `por_recoger` y `en_ruta_bodega_satelite` NO están en
  `ESTADOS_ASIGNACION`, así que el bloqueo de checkbox por zona con cierre abierto no aplica —y
  no debe añadirse: por Q1 (CERRADA) el cierre no bloquea el deshacer, ni en el servidor ni en la
  UI. Una orden de una zona con cierres abiertos SÍ se puede seleccionar y deshacer.

`DeshacerAsignacionModal.tsx` [NUEVO]: `Modal` compartido + `Textarea` de motivo +
`confirmDisabled` mientras el motivo no valide (R37) + lista de las órdenes del lote. UNA llamada
a la Server Action con todo el lote (no un loop `await` por orden como
`RecuperarABodegaModal`: aquí el backend es todo-o-nada por lote, R20).
`deshacer-asignacion-error-messages.ts` [NUEVO] traduce cada `status`/motivo a texto accionable
(R39), patrón `recuperar-bodega-error-messages.ts`.

### §6.2 Módulo de la bodega satélite [MOD]

Hoy `/recepcion-satelite` no muestra las órdenes ya asignadas de la zona. Cambios:

- `lib/services/RecepcionSateliteService.listar`: añade `"por_recoger"` a la lista de
  `estatusValues` que ya pasa a `findRecepcionSateliteByZona` (el repo acepta N estados, no hace
  falta query nueva) y un bucket `asignadas` en el mismo bucle de clasificación.
- `IRecepcionSateliteService` [MOD]: `asignadas: RecepcionSateliteDTO[]` en el resultado.
- `app/(app)/recepcion-satelite/page.tsx` [MOD]: pasa `asignadas` al módulo.
- `RecepcionSateliteModule.tsx` [MOD]: nueva sección «Asignadas (por recoger)» con `DataTable`
  seleccionable (patrón exacto de «Por devolver», con su propio `Set` de selección) y botón
  «Deshacer asignación» que abre `DeshacerAsignacionSateliteModal` [NUEVO] (mismo cuerpo que el
  del maestro, con `RecepcionSateliteDTO` en vez de `OrdenListItemDTO`). Éxito ⇒ `router.refresh()`
  (R38).
- El caso (b) NO se ofrece aquí (R36): las órdenes `en_ruta_bodega_satelite` siguen en «Por
  recibir», sin acción de deshacer.

---

## §7. Alternativas descartadas

**A. Derivar el destino de la ZONA de la orden (`zonaEsGam ? en_bodega_central :
en_bodega_satelite`) en vez del historial.** Es más simple y no necesita leer el historial.
DESCARTADA (y explícitamente vetada por D3): una orden no-GAM en `por_recoger` puede haber llegado
desde `en_bodega_satelite` (#9, asignada por la satélite) o desde `en_preparacion` (#4)... pero
también una orden de zona satélite podría, en un flujo futuro, asignarse desde la central. La
regla por zona es una inferencia que *coincide* hoy con la verdad en la mayoría de los casos, lo
que la hace peor que una regla equivocada: falla en silencio y manda paquetes a la bodega
incorrecta. El historial es el dato real de dónde salió.

**B. Reutilizar `OrdenService.actualizar` con `origen_tipo = ajuste_estado`.** Cero código nuevo
de servicio. DESCARTADA: (i) `ajuste_estado` no distingue en la bitácora una reversión de un
parche administrativo, y la auditoría de estas reversiones es medio propósito de la feature (D4/D5);
(ii) el CRUD genérico no limpia `mensajero_asignado_id`/`asignado_at` ni deriva destino; (iii)
obligaría a declarar `por_recoger -> en_bodega_*` con vía `ajuste_estado`, abriendo esas aristas
al ajuste administrativo genérico de cualquier maestro sin motivo obligatorio ni guarda de zona.

**C. Extender `RecuperacionBodegaService` (feature 100) con los nuevos estados de origen.** Ya
hace «volver a bodega + limpiar mensajero». DESCARTADA: su guarda de origen es `devuelta`, su
`origen_tipo` es `recuperacion_manual`, enciende `prioridad = true` (feature 110/R2) y opera de a
UNA orden. Meter dos flujos con reglas de prioridad opuestas en el mismo service produce un
`if` por origen en cada paso; el repo del arnés ya resolvió este dilema a favor de servicios
paralelos (`AsignacionSateliteService` vs `GuiaAsignacionService`, decisión F1.4-a de la 34).

**D. Acción por ORDEN (botón por fila) en vez de por lote.** Más simple de implementar y con
precedente (`FilaDevuelta`, `FilaPorDevolver`). DESCARTADA para el listado del maestro: la acción
que se revierte es por lote, y pedir un motivo por fila para diez órdenes del mismo error es
hostil. Sí se conserva la ergonomía de fila en el sentido de que un lote de UNA orden es un caso
válido de la misma acción.

**E. Poner `num_guia` a NULL para «revertir del todo».** DESCARTADA por D2: la etiqueta ya está
impresa y pegada al paquete; anular la guía deja un paquete físico con un número que la DB ya no
reconoce, y el escáner de recepción (`findByNumGuiaForTransicion`) dejaría de encontrarlo.

**F. Permitir volver a `en_fulfillment`/`en_preparacion` declarando cuatro aristas más.** Sería la
lectura literal de «derivar del historial». DESCARTADA por D3' (híbrido inconsistente
estado-pre-guía + `num_guia`, y reapertura de «Generar guía» sobre una orden ya etiquetada).

---

## §8. Decisiones del gate F1.4 (CERRADAS 2026-07-28)

El humano APROBÓ el spec y resolvió las siete preguntas. Ninguna queda abierta. Se registran aquí
con su justificación; el implementador NO debe reabrirlas.

### Q1 — El cierre pendiente del mensajero NO bloquea el deshacer. **ASIMETRÍA DELIBERADA.**

Palabras del humano: *«el administrador puede deshacer la asignación a pesar del cierre; si tiene
un cierre activo no se debería poder asignar»*.

| Operación | Gate `findMensajerosBloqueados` / `NOT EXISTS cierre_dia` |
| --- | --- |
| `GuiaAsignacionService.generarGuia` (asignar) | **VIGENTE**, no se toca |
| `GuiaAsignacionService.asignarDesdeBodega` (asignar) | **VIGENTE**, no se toca |
| `OrdenRepository.asignarSateliteLote` (asignar) | **VIGENTE**, no se toca |
| `deshacerAsignacionLote` (deshacer, 149) | **NO APLICA** |

Por qué la asimetría es correcta y no una inconsistencia:

1. **La orden nunca se recogió.** Está en `por_recoger`: no pasó a `en_ruta`, no tiene gestión, no
   entra en el snapshot del cierre del día (`cierre_dia_orden`, feature 69). Retirarla no altera
   ningún cuadre de caja: no hay dinero asociado.
2. **El gate de asignación protege lo contrario.** Existe para que a un mensajero que está
   cuadrando caja no se le sigan APILANDO órdenes. Deshacer VACÍA su lista: va exactamente en la
   dirección que el gate persigue.
3. **Bloquear crea un atasco.** Una orden mal asignada quedaría congelada hasta que se resolviera
   un cierre que no depende ni del administrador ni de la orden. Es el peor de los dos errores.

Consecuencias en el diseño: sin `NOT EXISTS` en el UPDATE (§3.2), sin `findMensajerosBloqueados`
en el service (§1 paso 7), sin constante de motivo (§3.4), y un test que FIJA la asimetría
(T4.9): deshacer con mensajero bloqueado → `ok`; asignar ese mismo mensajero → `conflict`.

### Q2 — `prioridad` NO se restaura. Limitación conocida y aceptada.

`asignarBodegaLote`/`asignarSateliteLote` apagan `prioridad = false` al asignar (features
101/R5). El flag no se historifica, así que al deshacer no hay forma de saber si estaba encendido.
Decisión: NO se enciende, NO se historifica, NO se añade columna. Una orden liberada por SLA que
se asigna y se desasigna queda en `false` y vuelve al backlog sin marca de prioridad. Es una
LIMITACIÓN CONOCIDA (R30), no un bug: el operador que deshace puede volver a priorizarla por los
mecanismos existentes. Diferencia deliberada con `recuperarABodega` (110/R2, que sí enciende
`prioridad`), porque allí la orden viene de un intento de entrega FALLIDO y aquí de un error de
asignación sin intento.

### Q3 — Desempate del historial: ACEPTADO tal cual.

`ORDER BY h.created_at DESC, h.id DESC` (§3.3). No se añade columna monotónica al historial. El
empate exacto al milisegundo solo puede darse dentro de un mismo `createMany`, que escribe UNA
fila por orden, así que dos filas empatadas de la MISMA orden no se producen en la práctica; el
desempate por `id` existe únicamente para que la consulta sea determinista.

### Q4 — SIN tope de tamaño de lote.

Consistente con el resto de acciones por lote del repo (`generarGuia`, `asignarDesdeBodega`,
`rutearABodegaSatelite`, `asignarSateliteLote`, `recibirLote`), ninguna de las cuales declara un
máximo. No se introduce aquí una restricción que no existe en sus hermanas.

### Q5 — Aviso al mensajero: SE QUIERE, pero se DIFIERE a la feature 146.

Palabras del humano: *«si no se puede ya, deja la anotación»*. La campana de notificaciones es la
feature 146, hoy `pending` y sin implementar: el canal NO existe.

- **Esta feature NO implementa notificación alguna** (R41). El único efecto para el mensajero es
  que la orden desaparece de su listado.
- El contrato del aviso futuro (disparador, destinatario, contenido) está fijado en
  `requirements.md` §10 / R41.
- El **punto exacto de enganche** está anclado en §3.2 paso 4 de este documento, con el
  comentario `TODO(146)` que el implementador DEBE dejar literalmente en el código, dentro de la
  transacción y justo después de `appendCambioEstado`. El pre-read del lote DEBE capturar el
  `mensajero_asignado_id` previo para que la 146 tenga el destinatario sin rehacer la consulta.
- Trazabilidad cruzada: T7.2 exige registrar esta ancla en `progress/impl_149.md` para que la
  feature 146 la encuentre por búsqueda de `TODO(146)`.

### Q6 — CONFIRMADO: no hace falta marca de «ya revertida».

Tras deshacer, el historial queda con `X -> por_recoger` y `por_recoger -> X`. Un segundo
deshacer sobre la orden ya en bodega es imposible (R16 bloquea el estado de origen). Si la orden
se reasigna y se vuelve a deshacer, la derivación D3 lee la fila MÁS RECIENTE, que es la de la
nueva asignación: correcta por construcción. No se añade columna ni flag de reversión.

### Q7 — Webhook: ACEPTADO, el par (origen, destino) basta.

El choke point encola el evento de cambio de estado con destino `en_bodega_central` /
`en_bodega_satelite`, indistinguible de una liberación por SLA para el integrador. No se añade
un tipo de evento nuevo ni un campo de familia al payload del webhook. Quien necesite el detalle
lo tiene en la línea de tiempo de la orden (`origen_tipo = deshacer_asignacion` + motivo).
</content>
</invoke>
