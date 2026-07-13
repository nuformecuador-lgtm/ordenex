# Feature 49 — Trazabilidad / historial de estados de la orden — design.md

> El CÓMO técnico. Antes del modelo de datos va el MAPA de la máquina de estados,
> porque el valor de esta feature es capturar CADA transición y el diseño gira en
> torno a no olvidar ninguna. Todos los símbolos son reales (verificados con
> Grep/Read sobre la rama `feature/49-...`, que contiene 43 + 46).

---

## 1. Modelo de datos

### 1.1 Tabla nueva `orden_historial_estado` (append-only, inmutable)

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | `TEXT` PK (uuid) | |
| `orden_id` | `TEXT` NOT NULL, FK → `orden(id)` | |
| `estatus_origen_id` | `TEXT` NULL, FK → `order_status(id)` | NULL = creación (R1/R20) |
| `estatus_destino_id` | `TEXT` NOT NULL, FK → `order_status(id)` | |
| `actor_usuario_id` | `TEXT` NULL, FK → `usuario(id)` ON DELETE SET NULL | NULL = sistema/cron (R21) |
| `origen_tipo` | enum `orden_historial_origen_tipo` NOT NULL | clasificación (R23) |
| `motivo` | `TEXT` NULL | de la gestión (R22) |
| `gestion_orden_id` | `TEXT` NULL, FK → `gestion_orden(id)` | opcional: enlaza la gestión que causó la transición (familia H); trazabilidad extra sin duplicar datos |
| `created_at` | `TIMESTAMP(3)` NOT NULL DEFAULT `CURRENT_TIMESTAMP` | instante de la transición (R1) |

- **Inmutable (R2):** SIN `updated_at`, SIN `deleted_at`. Nunca se hace UPDATE/DELETE.
- **Índices:** `(orden_id, created_at)` para la línea de tiempo (R5); `(orden_id,
  estatus_destino_id)` para el conteo de intentos (R24, cuenta destinos `devuelta`).
- **RLS (R3):** `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` sin policies (solo service
  role), patrón `gestion_orden` / `cierre_dia` / `wallet_movimiento`. Todo acceso pasa
  por el service role del backend; la autorización por rol vive en el service (R27).
- **FKs sin cascada de borrado de la orden:** la orden usa soft-delete (`deleted_at`),
  no se borra físicamente, así que el historial nunca queda huérfano.

### 1.2 Enum nativo `orden_historial_origen_tipo` (R23)

```
carga_masiva            -- feature 15/27: estado inicial en createMany
creacion_manual         -- feature 6: OrdenService.crear (create individual)
generacion_guia         -- feature 17/30: generarGuiaLote
asignacion_bodega       -- feature 17: asignarBodegaLote
ruteo_satelite          -- feature 30: rutearBodegaSateliteLote
recepcion_satelite      -- feature 33: recibirEnSatelite
asignacion_satelite     -- feature 34: asignarSateliteLote
recoleccion             -- feature 36: recogerLote
gestion                 -- feature 36: crearGestionYTransicionar
liberacion_reprogramada -- feature 46: liberarOrden (cron)
ajuste_estado           -- feature 6: OrdenService.actualizar (CRUD genérico)
```

Enum Postgres nativo (patrón `WalletMovimientoCategoria` / `GestionResultado`), fuente
única de verdad reflejada en `lib/types/orden-historial.ts`.

### 1.3 Modelo Prisma (borrador)

```prisma
enum OrdenHistorialOrigenTipo {
  carga_masiva
  creacion_manual
  generacion_guia
  asignacion_bodega
  ruteo_satelite
  recepcion_satelite
  asignacion_satelite
  recoleccion
  gestion
  liberacion_reprogramada
  ajuste_estado
  @@map("orden_historial_origen_tipo")
}

model OrdenHistorialEstado {
  id               String                   @id @default(uuid())
  ordenId          String                   @map("orden_id")
  estatusOrigenId  String?                  @map("estatus_origen_id")
  estatusDestinoId String                   @map("estatus_destino_id")
  actorUsuarioId   String?                  @map("actor_usuario_id")
  origenTipo       OrdenHistorialOrigenTipo @map("origen_tipo")
  motivo           String?
  gestionOrdenId   String?                  @map("gestion_orden_id")
  createdAt        DateTime                 @default(now()) @map("created_at")
  // SIN updated_at / deleted_at: fila INMUTABLE (R2).

  orden          Orden         @relation(fields: [ordenId], references: [id])
  estatusOrigen  OrderStatus?  @relation("HistorialOrigen", fields: [estatusOrigenId], references: [id])
  estatusDestino OrderStatus   @relation("HistorialDestino", fields: [estatusDestinoId], references: [id])
  actor          Usuario?      @relation(fields: [actorUsuarioId], references: [id], onDelete: SetNull)
  gestion        GestionOrden? @relation(fields: [gestionOrdenId], references: [id])

  @@index([ordenId, createdAt])            // R5: línea de tiempo
  @@index([ordenId, estatusDestinoId])     // R24: conteo de intentos
  @@map("orden_historial_estado")
}
```
(Relaciones opuestas `historial ...[]` en `Orden`, `OrderStatus`, `Usuario`,
`GestionOrden` — aditivas, sin migración de datos.)

### 1.4 Migración

- Carpeta `db/migrations/<timestamp>_orden_historial_estado/` con `migration.sql` (UP)
  y `down.sql` (DOWN, R4). ADITIVA: crea enum + tabla + FKs + 2 índices + RLS; NO altera
  tablas existentes salvo agregar las relaciones opuestas (no cambian columnas).
- El índice parcial no aplica aquí; los dos índices son normales.
- `down.sql`: `DROP TABLE IF EXISTS "orden_historial_estado";` (arrastra FKs e índices) +
  `DROP TYPE IF EXISTS "orden_historial_origen_tipo";`, en orden inverso. Round-trip R32.

---

## 2. MAPA de la máquina de estados — puntos de escritura de `orden.estatus_id`

> Estos son TODOS los call-sites que hoy escriben el estado de una orden. Cada uno se
> instrumenta (R9–R19). Verificado por Grep/Read. **11 puntos en 3 repositorios.**

| # | Archivo:símbolo | Estado(s) destino | Mecanismo actual | Familia (R) | origen_tipo |
| --- | --- | --- | --- | --- | --- |
| 1 | `lib/repositories/OrdenRepository.ts` → `createManyOrdenes` (L461-472) | `en_preparacion`/`en_fulfillment` (inicial) | `createMany` skipDuplicates | R9 | `carga_masiva` |
| 2 | `lib/repositories/OrdenRepository.ts` → `create` (L269-295) | estado inicial (CRUD) | `orden.create` | R10 | `creacion_manual` |
| 3 | `lib/repositories/OrdenRepository.ts` → `generarGuiaLote` (L610-634) | `en_espera_aceptacion` / `en_bodega` / `en_ruta_bodega_satelite` | `$transaction` + `$executeRawUnsafe` (num_guia) + `tx.orden.update` | R11 | `generacion_guia` |
| 4 | `lib/repositories/OrdenRepository.ts` → `asignarBodegaLote` (L637-648) | `en_espera_aceptacion` | `orden.updateMany` | R12 | `asignacion_bodega` |
| 5 | `lib/repositories/OrdenRepository.ts` → `rutearBodegaSateliteLote` (L658-674) | `en_ruta_bodega_satelite` | `$transaction` + `$executeRawUnsafe` + `tx.orden.update` | R13 | `ruteo_satelite` |
| 6 | `lib/repositories/OrdenRepository.ts` → `recibirEnSatelite` (L739-754) | `en_bodega_satelite` | `orden.updateMany` guardado por estado+zona | R14 | `recepcion_satelite` |
| 7 | `lib/repositories/OrdenRepository.ts` → `asignarSateliteLote` (L766-796) | `en_espera_aceptacion` | **`$executeRaw` CRUDO** (anti-TOCTOU, feature 41) | R15 | `asignacion_satelite` |
| 8 | `lib/repositories/GestionOrdenRepository.ts` → `recogerLote` (L145-162) | `en_reparto` | `orden.updateMany` guardado por propiedad+origen | R16 | `recoleccion` |
| 9 | `lib/repositories/GestionOrdenRepository.ts` → `crearGestionYTransicionar` (L165-201) | `entregada`/`reprogramada`/`devuelta`/`rechazada` | `$transaction` (INSERT gestion + `tx.orden.update` + limpia puntero) | R17 | `gestion` |
| 10 | `lib/repositories/LiberacionReprogramadaRepository.ts` → `liberarOrden` (L67-81) | `en_bodega` / `en_bodega_satelite` | `orden.updateMany` guardado por estado | R18 | `liberacion_reprogramada` |
| 11 | `lib/repositories/OrdenRepository.ts` → `update` (L327-339) | cualquiera (CRUD `OrdenService.actualizar`, incl. mensajero solo-estatus) | `orden.updateMany` | R19 | `ajuste_estado` |

**Servicios que orquestan** (contexto de actor/motivo/origen que el helper necesita):
`GuiaAsignacionService` (#3/#4/#5), `AsignacionSateliteService` (#7),
`RecepcionSateliteService` (#6), `MisAsignacionesService` (#8/#9),
`LiberacionReprogramadaService` (#10), `BulkOrdenService` (#1), `OrdenService` (#2/#11).

**Notas críticas del mapa:**
- El estado de ORIGEN ya está pre-leído por los servicios vía
  `findByIdsForTransicion` / `findByIdsParaGestion` (traen `estatusValue`), así que el
  helper puede registrar origen→destino sin una lectura extra.
- #7 (`asignarSateliteLote`) es **SQL crudo** con `NOT EXISTS` anti-TOCTOU (feature 41):
  el append de historial debe ir en el MISMO `$transaction` y depender de las filas
  realmente afectadas (`RETURNING id` o count por-fila), NO del `ordenIds` de entrada
  (R8) — si una orden pierde la guarda no transiciona y NO debe dejar rastro.
- #6/#8/#10/#11 usan `updateMany` sin transacción explícita hoy: para R7 hay que
  envolverlos en `$transaction` (o construir el INSERT del historial condicionado a las
  filas afectadas dentro de la misma tx).
- Puntos que NO escriben estado y por tanto NO se instrumentan (documentado para el
  reviewer): `asignarMensajeroSugerido` (solo `mensajero_sugerido_id`), `softDelete`
  (solo `deleted_at`), `setOrdenEnGestion`/`liberarOrdenEnGestion` (puntero de bloqueo),
  y las escrituras de `cierre_id`/`pago_mensajero` (features 37/39/56, no cambian estado).

**Punto ABIERTO / a confirmar en impl:** si existiera algún otro camino de escritura de
`estatus_id` no listado (p. ej. un seed o un script), se marca como abierto y NO se
inventa; el test de cobertura (§5) fija los 11 como el conjunto cerrado conocido.

---

## 3. Diseño del choke point centralizado (F1.4-b)

### 3.1 Helper único `registrarCambioEstado`

Un helper de repositorio/servicio que TODA escritura de estado invoca dentro de su
transacción:

```ts
// lib/repositories/OrdenHistorialRepository.ts (o helper puro reutilizable)
interface CambioEstadoEntrada {
  ordenId: string;
  estatusOrigenId: string | null;   // null = creación
  estatusDestinoId: string;
  actorUsuarioId: string | null;    // null = sistema/cron
  origenTipo: OrdenHistorialOrigenTipo;
  motivo?: string | null;
  gestionOrdenId?: string | null;
}
// Recibe el `tx` de la transacción en curso → append en la MISMA tx (R7).
async function registrarCambioEstado(tx: TxClient, entradas: CambioEstadoEntrada[]): Promise<void>
```

Recibe un **lote** de entradas (las transiciones de batch generan varias) y hace un
`createMany`. Acepta el cliente de transacción `tx` para garantizar atomicidad (R7).

### 3.2 Dónde se engancha cada punto

- **#3/#5/#9** ya corren en `$transaction`: se agrega la llamada al helper dentro del
  callback, usando el origen pre-leído y el destino resuelto. Para #9, el
  `gestion_orden_id` recién creado y el `motivo` de la gestión (R22).
- **#4/#6/#8/#10/#11** (updateMany): se envuelven en `$transaction` para que el
  updateMany y el append compartan tx. El append usa como origen el estado pre-leído por
  el service y como destino el `estatusId` resuelto, y SOLO para las filas afectadas
  (`result.count`; en batch guardado, re-derivar cuáles cumplieron — ver R8).
- **#7** (`$executeRaw` crudo): añadir `RETURNING id` al UPDATE y, con los ids
  retornados, hacer el `createMany` del historial dentro del mismo `$transaction`. Así el
  rastro cubre exactamente las órdenes que ganaron la guarda anti-TOCTOU (R8).
- **#1/#2** (creación): origen = `null`, destino = estado inicial; para #1 (createMany
  con skipDuplicates) el append cubre solo las filas efectivamente insertadas.

### 3.3 Riesgo de "olvidar un call-site" y mitigación

TypeScript no puede forzar que toda escritura de `estatus_id` pase por el helper (son 11
métodos, 3 mecanismos, incl. SQL crudo). Mitigaciones:
1. **Inventario cerrado** (§2): los 11 puntos están enumerados archivo:símbolo:línea; las
   tasks los cubren uno por uno.
2. **Un test por familia** (R9–R19) que ejecuta la transición y afirma que quedó
   exactamente una fila de historial con origen/destino/actor/tipo correctos.
3. **Test de cobertura estático** (§5) que lista los 11 símbolos como el conjunto
   conocido; si aparece un método nuevo que escribe `estatus_id` sin historial, es un
   hallazgo bloqueante del reviewer (regla de trazabilidad).
4. **Convención documentada** en `docs/architecture.md`-adyacente (comentario en el
   helper): "toda escritura de `orden.estatus_id` DEBE llamar a `registrarCambioEstado`
   en la misma tx".

### 3.4 ¿Un único método `transicionar(tx, ...)`?
Se evalúa unificar las 11 escrituras bajo un solo método de transición, pero cada punto
tiene guardas y efectos propios (asignación de `num_guia` por secuencia, anti-TOCTOU con
`NOT EXISTS`, propiedad+origen, zona, limpieza de puntero de gestión). Forzar un método
único reescribiría lógica ya probada de 6 features y aumentaría el riesgo de regresión
(R33). **Decisión:** helper compartido para el APPEND (choke point del historial), NO un
método único de transición. El append es el punto común; la guarda sigue siendo de cada
familia.

---

## 4. Backend: consulta, derivador y autorización

### 4.1 Servicio `OrdenHistorialService` (o extensión de `OrdenService`)
- `obtenerHistorial(ordenId, actor)` → autoriza reusando la visibilidad de la orden
  (R27): reusa el patrón de `OrdenService.obtener` (adminTienda solo su `tiendaId`,
  mensajero solo asignadas, adminSatélite solo su zona, maestro/admin todas). Devuelve
  las transiciones ordenadas por `created_at asc` con nombres legibles de estado y actor.
- `contarIntentos(ordenId)` → `COUNT(*)` de historial con `estatus_destino = devuelta`
  (R24). Consulta reutilizable que la feature 47 leerá (R25). Usa el índice
  `(orden_id, estatus_destino_id)`.

### 4.2 Repositorio `OrdenHistorialRepository`
- `registrarCambioEstado(tx, entradas)` (§3.1) — escritura.
- `findHistorialByOrden(ordenId)` — lectura ordenada con `include` de estados/actor.
- `contarPorDestino(ordenId, estatusDestinoId)` — para el derivador de intentos.

### 4.3 Borde (Server Action)
- `lib/actions/orden-historial.ts` (`'use server'`): `obtenerHistorialOrden(ordenId)` →
  `resolveActorFromSession()` + `OrdenHistorialService.obtenerHistorial`. Devuelve
  resultado tipado (`ok` | `forbidden`/`not_found`). Patrón `lib/actions/ordenes-guia.ts`
  y `lib/actions/liberacion-reprogramada.ts`. Datos por props al componente (R28).

### 4.4 DTO
`OrdenHistorialEntradaDTO { estatusOrigenValue: string | null; estatusDestinoValue:
string; origenTipo; actorNombre: string | null; motivo: string | null; createdAt }`.
Resuelve `value` de estados y nombre del actor por relaciones (no expone UUIDs internos
ni PII fuera de lo mostrado).

---

## 5. Estrategia de tests (cómo se prueba que CADA transición deja rastro)

- **Unit del helper** (`registrarCambioEstado`): con un doble de `tx`, afirma que arma
  el `createMany` con origen/destino/actor/tipo/motivo correctos, incluido origen `null`
  en creación y actor `null` en sistema.
- **Integración por familia (R9–R19), una por punto del mapa §2:** con dobles de
  repositorio que capturan las llamadas dentro de la tx (patrón de los tests de
  `GuiaAsignacionService`/`MisAsignacionesService`/`LiberacionReprogramadaService`),
  ejecuta la transición y afirma: (1) el cambio de `estatus_id` esperado; (2) exactamente
  N filas de historial (N = órdenes efectivamente transicionadas, R8); (3)
  origen/destino/tipo/actor correctos. Casos de guarda: orden que pierde la carrera /
  no cumple origen → NO deja rastro (R8).
- **Atomicidad (R7):** simular fallo del append → el cambio de estado se revierte (nada
  persiste). Simular fallo del cambio de estado → no hay historial.
- **Derivador de intentos (R24):** sembrar N transiciones a `devuelta` → `contarIntentos`
  = N; sin devueltas → 0.
- **Autorización (R27):** adminTienda con orden ajena → forbidden/not_found; mensajero con
  orden no asignada → idem; maestro → ok.
- **RLS (R3):** intento con clave anónima → rechazado (patrón de los tests RLS del repo).
- **Round-trip de migración (R32):** aplicar → `down.sql` → reaplicar; `migrate status`
  up-to-date.
- **Cobertura (§3.3):** test que documenta los 11 símbolos del mapa §2 como conjunto
  conocido de escritura de estado.
- **E2E (flujo crítico):** un recorrido que lleva una orden por ≥2 transiciones y verifica
  que la línea de tiempo del detalle las muestra en orden con actor y motivo.

---

## 6. Frontend: línea de tiempo (F1.4-f)

- **Ubicación:** detalle de la orden. Como NO existe página de detalle hoy (la lista vive
  en `app/(app)/ordenes/_components/OrdenesModule.tsx` /
  `OrdenesRevisionMaestro.tsx`), se añade una superficie de detalle mínima: una acción
  "Ver historial" por fila que abre un **drawer/modal** (reutilizar primitiva de
  `components/ui`; el repo ya usa modales, p. ej. `GenerarGuiaModal`), que recibe el
  historial pre-fetcheado vía la Server Action (R28).
- **Componente** `HistorialOrdenTimeline` (vive junto a la página de órdenes; se promueve
  a `shared/` solo si otra feature lo reusa): renderiza una lista vertical de entradas;
  cada entrada muestra estado destino (etiqueta legible vía `estatus-label`, R30),
  timestamp, actor (o "Sistema") y motivo si existe.
- **Autorización de la superficie:** el rol se resuelve server-side; la acción autoriza
  por visibilidad de la orden (R27). Componente en `private/`-style: recibe datos por
  props, no fetchea datos sensibles.
- **Realtime (feature 35):** fuera de alcance. La línea de tiempo se carga al abrir el
  drawer. Punto de extensión: la 35 podrá suscribir cambios de la orden y refrescar el
  timeline; aquí solo se deja el componente que consume una lista de entradas.

---

## 7. Alternativas descartadas (obligatorio)

### 7.1 Trigger Postgres `AFTER INSERT/UPDATE OF estatus_id` en `orden` — DESCARTADA
Un trigger a nivel DB sería el ÚNICO choke point real: imposible olvidar un call-site,
captura uniforme de updateMany / `$transaction` / SQL crudo. **Por qué se descarta:** el
trigger NO tiene acceso limpio al contexto de aplicación que exigen R21/R22/R23 — actor
(`usuario_id`), `motivo` de la gestión y `origen_tipo` no están en la fila de `orden`; se
tendrían que inyectar por variables de sesión (`SET LOCAL app.actor_id = ...`) en cada
request, frágil con connection pooling (PgBouncer/Prisma) y difícil de testear sin DB
real. Además esconde la lógica de trazabilidad fuera del código versionado de la app,
contra el patrón Controller→Service→Repo del repo. Se conserva como posible **red de
defensa futura** (registrar un rastro "sin actor" ante escrituras que no pasen por el
helper), no como mecanismo primario.

### 7.2 Reusar/extender `gestion_orden` en vez de tabla nueva — DESCARTADA
`gestion_orden` solo modela las 4 transiciones del mensajero (entregada/reprogramada/
devuelta/rechazada) y mezcla evidencias, montos, método de pago, snapshots de pago
(features 37/39/56). Las 7 transiciones de asignación/ruteo/recepción/liberación NO
tienen gestión asociada, así que no cabrían sin nullables masivos y sin semántica clara.
Reusarla acoplaría trazabilidad con dinero/evidencias y rompería la inmutabilidad
(gestion_orden se referencia por cierres). Tabla dedicada `orden_historial_estado`
append-only mantiene una sola responsabilidad y un contrato simple para la 47 y la UI.

### 7.3 Columna materializada `orden.intentos` — DESCARTADA (ver F1.4-a)
Duplicaría estado ya derivable del historial y podría divergir; el derivador `COUNT` sobre
el índice `(orden_id, estatus_destino_id)` es suficiente para la 47.
