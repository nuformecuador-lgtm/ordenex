# Feature 109 — Orden sin gestionar: cierre vencido + reasignación prioritaria · design.md

> El CÓMO técnico sobre las decisiones recomendadas de `requirements.md`. Símbolos reales
> verificados con Grep/Read sobre la rama `feature/109-...` (creada desde `origin/dev`, con 110 y
> 111 mergeadas). Capas: Controller (Route handler / Server Action) → Service → Repository. Money-
> critical: los snapshots de cierre son inmutables; esta feature solo AÑADE lógica/transiciones y
> un catálogo. Todas las transiciones pasan por el choke point `appendCambioEstado` (49).

---

## 1. Resumen de la decisión

Cuatro piezas, casi todas backend:

1. **Estatus `sin_gestionar`** (valor del catálogo `order_status`) + **2 `origen_tipo`** nuevos
   (`corte_sin_gestionar`, `liberacion_sin_gestionar`). Migraciones ADITIVAS con `down.sql`.
2. **Corte diario extendido:** al pasar de día, TODA orden en `en_reparto` → `sin_gestionar` (vía
   choke point, actor null) y el mensajero queda con un cierre `vencido` que lo bloquea (reusa o
   crea), incluso si no tenía gestiones. Idempotente.
3. **Congelamiento por construcción:** `sin_gestionar` no es un estado de bodega, así que no aparece
   en ningún listado de reasignación; queda frozen hasta que su cierre se APRUEBE.
4. **Liberación SOLO al aprobar + modelo de cierre GLOBAL (LOCKED):** al APROBAR (`aprobado`) el
   cierre, sus órdenes `sin_gestionar` pasan a `en_bodega`/`en_bodega_satelite` por zona de la
   orden, sin mensajero, con `prioridad = true` (101/110), en la misma tx de `resolverCierre`, vía
   choke point. **Modelo de cierre FINAL (todos los cierres):** solo `aprobado` es TERMINAL;
   `solicitado`, `vencido` y `rechazado` son ABIERTOS = BLOQUEANTES. Rechazar deja el cierre en
   `rechazado` (mismo `resolverCierre`, conserva nombre + `motivo_rechazo` + `resuelto_por/at`) pero
   ahora `rechazado` BLOQUEA y es RE-SOLICITABLE (`rechazado → solicitado`, espejo de
   `vencido → solicitado`). El rechazo NO libera `sin_gestionar`: solo la APROBACIÓN lo hace (el
   mensajero re-solicita hasta que el admin apruebe).

`sin_gestionar` es money-neutral por CONSTRUCCIÓN: no tiene `gestion_orden`, luego no entra en el
snapshot (`cierre_detail`) ni en los feeds de wallet (42/43/44), que leen `gestion_orden` por
`cierre_id`. El enum `CierreEstado` NO se modifica (reusa los 4 valores; `rechazado` deja de ser
terminal por LÓGICA, no por esquema).

---

## 2. Modelo de datos

### 2.1 Estatus `sin_gestionar` (R1/R2)

- **Fuente única:** añadir `"sin_gestionar"` a `ORDER_STATUS_SEED` (`lib/types/order-status.ts`,
  15.º valor). Rompe el build del `Record` tipado `ORDER_STATUS_LABELS` (`EstatusBadge`) hasta que
  se le dé etiqueta (R25) — deseado.
- **Migración** `db/migrations/<ts>_order_status_sin_gestionar/` (timestamp posterior al último):
  - `migration.sql` (UP): `INSERT INTO "order_status" ("id","value") SELECT gen_random_uuid()::text,
    'sin_gestionar' WHERE NOT EXISTS (SELECT 1 FROM "order_status" WHERE "value"='sin_gestionar');`
    (idempotente, patrón `recibido_origen`). No cambia el default de creación (`en_preparacion`).
  - `down.sql` (DOWN): `DELETE FROM "order_status" os WHERE os."value"='sin_gestionar' AND NOT
    EXISTS (…orden.estatus_id=os.id…) AND NOT EXISTS (…orden_historial_estado.estatus_destino_id /
    estatus_origen_id = os.id…);` (borra SOLO si nada lo referencia — patrón `recibido_origen`).
  - No toca RLS ni columnas (R2). `ALTER TABLE ADD COLUMN` NO se usa (no hay columna nueva, ver Q1).

### 2.2 `origen_tipo` nuevos (R3)

- **Fuente única:** añadir `"corte_sin_gestionar"` y `"liberacion_sin_gestionar"` a
  `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` (`lib/types/orden-historial.ts`). NINGUNO entra en
  `ORIGEN_TIPOS_CON_GESTION` (ambos nacen con `gestion_orden_id = null`; sus destinos no son
  `devuelta`, así que no afectan `contarIntentos`, R12 — mismo criterio que 99/100).
- **Migración** `db/migrations/<ts>_orden_historial_origen_sin_gestionar/`:
  - `migration.sql` (UP): `ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS
    'corte_sin_gestionar';` y `… ADD VALUE IF NOT EXISTS 'liberacion_sin_gestionar';` — SOLO añade;
    su primer USO ocurre en tx posteriores (runtime), nunca en esta migración (evita el error
    55P04 "unsafe use of new value"; patrón `cancelacion_api`).
  - `down.sql` (DOWN): recrea el enum SIN los 2 valores (RENAME → CREATE con los 18 valores
    previos → `ALTER COLUMN … USING` → DROP old), precondición: ninguna fila de
    `orden_historial_estado` usa los valores nuevos (si la hay, el `USING` falla ruidosamente — es
    correcto: revertir borrando auditoría no es seguro). Patrón exacto de
    `20260722130000_cancelacion_api_por_key/down.sql`.

### 2.3 SIN columna nueva en `orden` (Q1, recomendado)

No se añade `orden.cierre_id`. La orden `sin_gestionar` se asocia a su cierre por
`mensajero_asignado_id` (que se CONSERVA durante `sin_gestionar` y se limpia solo al liberar). Es
correcto por el invariante 111/R10 (un mensajero tiene a lo sumo UN cierre bloqueante) reforzado
por el bloqueo total (mientras esté bloqueado no puede recoger → no acumula nuevas `en_reparto` →
no hay ambigüedad de a qué cierre pertenecen sus `sin_gestionar`). `orden.prioridad` (101) se
reutiliza tal cual. RLS de `orden` intacta.

---

## 3. Backend — corte diario extendido (R4–R10)

Se mantiene el route handler `/api/cron/corte-diario` (41) y su guardia `CRON_SECRET` (R24). El
cambio es en `CorteDiarioService.ejecutarCorte` + los repos que consume.

### 3.1 Selección de mensajeros (R4/R7/R10, Q6)

`CorteDiarioRepository.findMensajerosConActividadSinCierre` se AMPLÍA (o gana un gemelo) para que
el conjunto de mensajeros a evaluar sea la UNIÓN de:
- (a) los que tienen `gestion_orden` con `cierre_id IS NULL AND anulada_at IS NULL` (comportamiento
  actual 41/67), **y**
- (b) los que tienen ≥1 `orden` con `estatus.value = 'en_reparto'` y `deleted_at IS NULL`
  (mensajero inactivo, nuevo en 109), leyendo su `zonaId`.
Se EXCLUYEN (R10) los que ya tienen `cierre_dia estado IN ('solicitado','vencido')` — no solo
`solicitado` como hoy — para no crear un segundo cierre bloqueante ni violar el invariante.

### 3.2 Transición `en_reparto → sin_gestionar` + `vencido` en una tx (R6/R7/R8/R9, Q3)

Por mensajero, en UNA transacción todo-o-nada (extensión de `CierreDiaRepository.crearCierre`
gated por un input opcional del corte, para no tocar `solicitarCierre`/37):
1. `updateMany` guardado: `orden` con `mensajeroAsignadoId = m`, `estatusId = <en_reparto>`,
   `deletedAt = null` → `estatusId = <sin_gestionar>` (NO limpia `mensajero_asignado_id`: se
   conserva para la asociación, Q1). Se recogen los ids afectados (`$queryRaw … RETURNING id` o
   pre-SELECT, patrón `asignarSateliteLote`/`recogerLote`) para el append SOLO de las que
   transicionaron (R6/R9).
2. `appendCambioEstado(tx, [{ ordenId, estatusOrigenId: <en_reparto>, estatusDestinoId:
   <sin_gestionar>, actorUsuarioId: null, origenTipo: 'corte_sin_gestionar' }, …])` (R6/R22).
3. Vincula gestiones pendientes + snapshot (lógica actual de `crearCierre`), si las hay.
4. **Guarda de "algo pasó" (R8):** el cierre se crea si `sinGestionarTransicionadas > 0` **O**
   `gestionesVinculadas > 0`. Solo si AMBOS son 0 se hace `rollback → null` (verdadero no-op /
   carrera, R9). Hoy el `rollback → null` exige ≥1 gestión; se relaja para admitir el `vencido`
   money-neutral (0 gestiones, ≥1 `sin_gestionar`).

Snapshot money-neutral (R8): con 0 gestiones, `computeTotales`/`derivarPagos`/`derivarIngresoBodega`
devuelven `0.00`; no se crea `cierre_detail` (el bucle es sobre gestiones vinculadas). El `vencido`
existe solo para bloquear y retener.

**Idempotencia (R9):** 2.ª corrida — las órdenes ya son `sin_gestionar` (guarda `estatusId =
en_reparto` afecta 0) y el mensajero ya tiene `vencido` (excluido por §3.1) → no-op.

### 3.3 Bloqueo (R7/R21) — reuso puro

El bloqueo es DERIVADO (`findMensajerosBloqueados`, `estado IN ('solicitado','vencido')`): crear el
`vencido` basta para bloquear (recibir + gestionar + recoger + escoger + deshacer, 41/111). No se
escribe código de bloqueo nuevo. Invariante (R21): la exclusión de §3.1 impide un 2.º cierre.

---

## 4. Backend — congelamiento (R14/R15)

Por construcción: `sin_gestionar` NO es `en_bodega`/`en_bodega_satelite`, luego no entra en:
- `OrdenRepository` listado `en_bodega` de `/ordenes` (WHERE por estatus),
- `RecepcionSateliteService`/repo listado "Recibidas" `en_bodega_satelite`.
No hay punto que reasigne una `sin_gestionar` (los asignadores 17/30/34 parten de
`en_bodega`/`en_espera_aceptacion`/`en_bodega_satelite`). Se añade un test explícito (R15) de que
`sin_gestionar` no aparece en esos listados, para blindar el congelamiento ante cambios futuros.

---

## 5. Backend — liberación SOLO al aprobar (R16–R20)

Hook: `CierresAdminRepository.resolverCierre` — ya es un `$transaction` que, al aprobar, alimenta
wallets. Se AÑADE, DENTRO de la rama de aprobación existente `if (res.count === 1 && nuevoEstado
=== 'aprobado') { … }` (junto a los feeds de wallet, NO en la rama de rechazo — Q2 LOCKED):

1. Resolver el `mensajeroId` del cierre (select dentro de la tx o traerlo en el input).
2. Cargar las órdenes `sin_gestionar` del mensajero (`orden` WHERE `mensajeroAsignadoId =
   mensajeroId`, `estatusId = <sin_gestionar>`, `deletedAt = null`) con su `zonaId`.
3. Por orden, derivar destino `resolverDestinoCierre(orden.zonaId, centralZonaId)` → `en_bodega`
   (central) / `en_bodega_satelite` (satélite) (R16, Q4). `centralZonaId` se resuelve una vez
   (`IZonaRepository.findCentralZonaId`, inyectado al repo o pasado por el service).
4. `updateMany` guardado por destino (agrupando por `estatusId` destino), molde EXACTO de
   `RecuperacionBodegaRepository.recuperarABodega`:
   `where: { id: {in}, estatusId: <sin_gestionar>, deletedAt: null }`,
   `data: { estatusId: <destino>, mensajeroAsignadoId: null, asignadoAt: null, prioridad: true }`
   (R16/R17/R19).
5. `appendCambioEstado(tx, [{ ordenId, estatusOrigenId: <sin_gestionar>, estatusDestinoId:
   <destino>, actorUsuarioId: resueltoPor, origenTipo: 'liberacion_sin_gestionar' }, …])` para las
   filas afectadas (R18/R22).

- **R19:** liberación SOLO en la rama `aprobado`; guarda por `estatusId = sin_gestionar` → count 0 =
  no-op sin tocar `prioridad`.
- **R20:** un cierre normal (mensajero sin `sin_gestionar`) → paso 2 trae 0 órdenes → no-op; el
  flujo de wallets existente NO cambia.
- **R13:** un `vencido` money-neutral aprobado → 0 `gestion_orden` con ese `cierre_id` → los feeds
  (42/43/44) construyen 0 movimientos → money-neutral (ya cierto hoy; se añade test).
- **R23:** la liberación NO toca los totales snapshot del cierre; solo `orden.*`.

**Alcance/actor:** `resolverCierre` ya corre acotado por alcance (rol+zona) y con `resueltoPor` =
admin actor; la liberación reutiliza ese actor para el append (R18).

### 5.2 `rechazado` bloqueante y re-solicitable (R27–R31) — modelo GLOBAL

El rechazo NO cambia su escritura: `CierresAdminService.rechazarCierre` sigue delegando en
`resolverCierre({ nuevoEstado: 'rechazado', resueltoPor, motivoRechazo })` (conserva nombre +
auditoría). Lo que cambia es (a) que `rechazado` BLOQUEA y (b) que existe la transición
`rechazado → solicitado`. Cuatro toques quirúrgicos, todos reuso del patrón `vencido` de la 111:

1. **Conjunto bloqueante → `{solicitado,vencido,rechazado}` (R29).** En
   `lib/repositories/OrdenRepository.ts`: `ESTADOS_CIERRE_BLOQUEANTES` (:113, hoy
   `["solicitado","vencido"]`) gana `"rechazado"`; queda cubierto `findMensajerosBloqueados` (:1740)
   y `existeAlgunMensajeroBloqueadoEnZona` (:1762). El SQL crudo anti-TOCTOU de asignación
   (:1717, `c."estado" IN ('solicitado','vencido')`) añade `'rechazado'`. En
   `lib/repositories/CorteDiarioRepository.ts`: la exclusión (:9/:41, hoy solo `solicitado`) pasa a
   `estado IN ('solicitado','vencido','rechazado')` (R10) — un mensajero con un cierre abierto no
   recibe un 2.º.
2. **Transición `rechazado → solicitado` (R28).** En `lib/repositories/CierreDiaRepository.ts`,
   gemelo EXACTO de `transicionarVencidoASolicitado` (:242): `existeCierreRechazado(mensajeroId)`
   (gemelo de `existeCierreVencido`, :230) + `transicionarRechazadoASolicitado(mensajeroId)`
   (`updateMany WHERE mensajero_id = X AND estado = 'rechazado' SET estado = 'solicitado'`, SOLO
   `estado`, count 0 → false). Recomendación de implementación: generalizar ambos a
   `{vencido,rechazado}` (`existeCierreReabrible` / `transicionarAbiertoASolicitado`) para no
   duplicar; el invariante (R30) garantiza a lo sumo uno, así que el `updateMany` guardado por
   `estado IN ('vencido','rechazado')` toca exactamente un cierre.
3. **`solicitarCierre` (mensajero) enruta el `rechazado`.** En `lib/services/CierreDiaService.ts`,
   la rama que hoy detecta `existeCierreVencido → transicionarVencidoASolicitado` se generaliza a
   "existe cierre reabrible (`vencido` o `rechazado`) → transiciónalo" (misma Server Action
   `lib/actions/cierre-dia.ts`, sin ruta nueva). El resultado `ok` puede llevar
   `via: 'rechazado_solicitado'` para el toast. NO aplica la precondición de "sin pendientes"
   (evita deadlock, como 111/R9). `listarCierreDia` expone `tieneRechazado` (gemelo de
   `tieneVencido`, derivado de `cierresPasados`, sin query extra) para el CTA de UI (R31).
4. **Válvula del admin generalizada (caso abandonado).** `CierresAdminRepository.forzarSolicitudVencido`
   (:439, `vencido → solicitado`) se generaliza a `{vencido,rechazado}` (guarda
   `estado IN ('vencido','rechazado')`) para que el admin pueda destrabar también un `rechazado`
   abandonado (mensajero ausente), evitando el bloqueo permanente de él y su bodega (41/R17). Es la
   consecuencia directa de que `rechazado` sea ahora tan bloqueante como `vencido`.

**Money-safe (R28/R23):** todas las transiciones de re-solicitud cambian SOLO `estado`; no tocan
snapshot, `cierre_id` de gestiones ni wallets. El desbloqueo definitivo y la liberación de
`sin_gestionar` ocurren SOLO al APROBAR (§5.1). Invariante (R30): sostenido por las guardas de
estado, no por locks.

### 5.3 Impacto sobre las features 38 y 111 (radio de cambio, símbolos reales)

| Símbolo | Estado hoy | Cambio en 109 |
| --- | --- | --- |
| `CierreEstado` (enum) | `solicitado/aprobado/rechazado/vencido` | **sin cambio** (reusa los 4; sin migración de enum, `cierre-estado-*-migration` intacta) |
| `OrdenRepository.ESTADOS_CIERRE_BLOQUEANTES` (:113) | `["solicitado","vencido"]` | **+ `"rechazado"`** → `["solicitado","vencido","rechazado"]` (R29) |
| SQL crudo anti-TOCTOU asignación (`OrdenRepository.ts:1717`) | `IN ('solicitado','vencido')` | **+ `'rechazado'`** (R29) |
| `CorteDiarioRepository` exclusión (:9/:41) | solo `solicitado` | **`IN ('solicitado','vencido','rechazado')`** (R10) |
| `CierreDiaRepository` (:230/:242) | `existeCierreVencido` / `transicionarVencidoASolicitado` | **+ gemelos `rechazado`** (o generalizados a `{vencido,rechazado}`) (R28) |
| `CierreDiaService.solicitarCierre` | rama `vencido → solicitado` | generaliza a `{vencido,rechazado} → solicitado`; `ok.via` opcional |
| `ListarCierreDiaServiceResult` / props UI | `tieneVencido` | **+ `tieneRechazado`** (CTA re-solicitar, R31) |
| `CierresAdminRepository.forzarSolicitudVencido` (:439) | `vencido → solicitado` | guarda `estado IN ('vencido','rechazado')` (válvula generalizada, R28) |
| `CierresAdminRepository.resolverCierre` / `CierresAdminService.rechazarCierre` | reject → `rechazado` terminal + auditoría | **sin cambio de escritura**; cambia su EFECTO (rechazado ahora bloquea). Approve: + liberación §5.1 |
| `RechazarCierreServiceResult` | ok `estado:'rechazado'` | **sin cambio** (sigue `estado:'rechazado'`) |
| `CierresAdminService.listarCierresAdmin` (:96) | `solicitado`/`vencido` → pendientes; `rechazado` → histórico | `rechazado` permanece en histórico (el admin ya actuó) pero rotulado BLOQUEANTE hasta re-solicitud (R31) |
| Flujo de wallets al aprobar (42/43/44) | idempotente por constraint | **sin cambio** (un `vencido` money-neutral = 0 movimientos, R13) |

**UI (R31):** vista del mensajero "Cierre del día" — el CTA "Solicitar aprobación" del `vencido`
(111/R13) se generaliza para aparecer también con `tieneRechazado`; el aviso comunica que un
`rechazado` NO es terminal (bloquea hasta re-solicitar+aprobar). `/cierres-admin` — un `rechazado`
sigue en el histórico, rotulado "bloqueante hasta re-solicitud" (no "resuelto/cerrado"). No hay
pantalla nueva (Q7).

---

## 6. Frontend (R25/R26/R31)

- **Etiqueta (R25):** añadir `sin_gestionar: "Sin gestionar"` a `ORDER_STATUS_LABELS`
  (`app/(app)/ordenes/_components/EstatusBadge`), lo que satisface el `Record` tipado y hace que
  `estatusLabel` y la línea de tiempo del historial (49) la muestren legible. Verificar el color del
  badge (variante neutra/alerta) en `EstatusBadge`.
- **Resalte/orden (R26):** ninguna vista nueva. `sin_gestionar` está congelada → no aparece en la
  reasignación; solo tras liberarse (con `prioridad = true`) entra en el resalte prioritario
  EXISTENTE (101/R8). No se toca `/novedades`, "Devueltas", ni el portal del mensajero (110/R10).
- **CTA re-solicitar el `rechazado` (R31):** en `app/(app)/cierre-dia/_components/CierreDiaModule.tsx`,
  el CTA "Solicitar aprobación del cierre vencido" (111/R13, gobernado por `tieneVencido`) se
  generaliza para aparecer también con la nueva prop `tieneRechazado` (mismo botón → misma Server
  Action `solicitarCierre()`, que el backend enruta a la transición). El aviso de bloqueo total
  (111/R12) comunica que un `rechazado` NO es terminal (bloquea hasta re-solicitar+aprobar).
- **`/cierres-admin` (Q7, R31):** el `vencido` money-neutral usa el render existente (38/111):
  totales `0.00`, sin detalle. Un `rechazado` permanece en el histórico pero se rotula
  "bloqueante hasta re-solicitud" (no "resuelto/cerrado"). Sin pantalla nueva.

---

## 7. Contratos de I/O (deltas)

| Símbolo | Cambio |
| --- | --- |
| `ORDER_STATUS_SEED` / `ORDER_STATUS_LABELS` | + `sin_gestionar` |
| `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` | + `corte_sin_gestionar`, `liberacion_sin_gestionar` |
| `ICorteDiarioRepository.findMensajerosConActividadSinCierre` | amplía el conjunto (gestiones ∪ `en_reparto`); excluye `estado IN ('solicitado','vencido','rechazado')` (R10/R29) |
| `ICierreDiaRepository.crearCierre` / `CrearCierreInput` | input opcional del corte (ids/estatus para `en_reparto → sin_gestionar`); guarda "algo pasó" admite 0 gestiones + ≥1 `sin_gestionar` |
| `ICierreDiaRepository` | + `existeCierreRechazado` / `transicionarRechazadoASolicitado` (gemelos del `vencido`, o generalizados a `{vencido,rechazado}`) (R28) |
| `OrdenRepository.ESTADOS_CIERRE_BLOQUEANTES` + SQL anti-TOCTOU | + `rechazado` (R29) |
| `CierreDiaService.solicitarCierre` / `ListarCierreDiaServiceResult` | rama de re-solicitud generaliza a `{vencido,rechazado}`; + `tieneRechazado` para el CTA (R28/R31) |
| `ICierresAdminRepository.forzarSolicitudVencido` | guarda `estado IN ('vencido','rechazado')` (válvula generalizada, R28) |
| `ICierresAdminRepository.resolverCierre` | rama `aprobado`: + libera `sin_gestionar` a bodega (`prioridad = true`) en la misma tx; requiere `findCentralZonaId` / estatus ids. Reject SIN cambio de escritura |
| `CierresAdminService.rechazarCierre` / `RechazarCierreServiceResult` | **sin cambio** (sigue `estado:'rechazado'`; cambia solo su efecto de bloqueo) |
| `appendCambioEstado` | (sin cambio de firma) recibe entradas con los 2 `origen_tipo` nuevos |

Money: no se serializan montos nuevos; los totales del cierre siguen cruzando como STRING.

---

## 8. Concurrencia y anti-TOCTOU

- **Corte (R6/R9):** `updateMany` guardado por `estatusId = en_reparto` + append SOLO de las filas
  afectadas (RETURNING id / pre-SELECT); la guarda "algo pasó" evita el `vencido` fantasma; la
  exclusión por `estado IN ('solicitado','vencido','rechazado')` evita el 2.º cierre (R10/R30).
  Todo en una tx por mensajero.
- **Liberación (R19):** `updateMany` guardado por `estatusId = sin_gestionar`; carrera / 2.ª corrida
  → count 0 → no-op, `prioridad` intacta. Corre DENTRO de la rama `aprobado` de `resolverCierre`
  (atómico con la transición del cierre y con los wallets).
- **Re-solicitud `{vencido,rechazado} → solicitado` (R28):** `updateMany` guardado por
  `estado IN ('vencido','rechazado')`; carrera / ya resuelto → count 0 → `conflict`. Solo cambia
  `estado` (money-safe). Mismo patrón que `transicionarVencidoASolicitado` (111).
- **Invariante (R21/R30):** sostenido por las guardas de estado (corte 41/R10 + exclusión ampliada
  §3.1 + transiciones 1→1 §5.2), no por locks.

---

## 9. Alternativas consideradas y descartadas (obligatorio)

### 9.1 Columna `orden.cierre_id` para asociar la orden a su `vencido` — DESCARTADA (Q1)
Añadir un FK nullable `orden.cierre_id`, setearlo en el corte y liberar por `cierre_id` al resolver.
_Por qué se descarta:_ (1) exige una migración de COLUMNA sobre `orden` (tabla caliente) que la
descripción no pide (solo el valor de estatus es aditivo); (2) el invariante 111/R10 + el bloqueo
total ya garantizan que las `sin_gestionar` de un mensajero pertenecen a su ÚNICO cierre bloqueante,
así que `mensajero_asignado_id` es una clave de asociación suficiente y sin drift; (3) reutiliza el
molde EXACTO de `recuperarABodega` (guarda por estado). La columna se puede añadir como follow-up si
el negocio pide asociar `sin_gestionar` a cierres HISTÓRICOS de un mismo mensajero (hoy imposible por
el invariante).

### 9.2 Modelar `sin_gestionar` como una `gestion_orden` sintética (resultado nuevo) — DESCARTADA
Crear una gestión "sin gestión" para reusar la vinculación al cierre y la línea de detalle.
_Por qué se descarta:_ rompe la money-neutralidad (todo el pipeline 39/56/69/42-44 parte de
`gestion_orden`; una gestión sintética arriesga pago/cobro/`cierre_detail`), y `GestionResultado` es
un enum cerrado (entregada/reprogramada/devuelta/rechazada) cuyo sentido es "resultado de una
entrega". `sin_gestionar` es justo la AUSENCIA de gestión: modelarla como estatus de la orden (sin
`gestion_orden`) la mantiene money-neutral por construcción y no contamina los feeds de wallet.

### 9.3 Liberar en CUALQUIER resolución (aprobar o rechazar) — DESCARTADA por el humano
Liberar las `sin_gestionar` tanto al aprobar como al rechazar.
_Por qué se descarta:_ el humano exige que "congeladas hasta APROBAR" sea alcanzable — el rechazo
NO debe soltar las órdenes. La liberación queda SOLO en la rama `aprobado` (§5.1). El rechazo NO
libera; el mensajero re-solicita hasta la aprobación.

### 9.4 Re-abrir el rechazo a `vencido` / hacerlo SCOPED (solo cierres con `sin_gestionar`) — DESCARTADA (modelo GLOBAL LOCKED)
Variante intermedia: que rechazar un cierre con `sin_gestionar` lo re-abra a `vencido` (renombrando
el estado), y dejar `rechazado` terminal para los cierres normales.
_Por qué se descarta (modelo final del humano):_ ensuciaba la semántica (`vencido` con
`motivo_rechazo`), requería un `rechazarCierre` con rama scoped y un result type ampliado, y dejaba
dos clases de rechazo. El modelo elegido es más limpio y GLOBAL: `rechazado` conserva su nombre y
auditoría pero pasa a ser ABIERTO=BLOQUEANTE y RE-SOLICITABLE para TODOS los cierres (§5.2), igual
que `vencido`. `rechazado` NO queda huérfano (es alcanzable y re-solicitable). Coste: añadir
`rechazado` al conjunto bloqueante (una constante + un SQL crudo + la exclusión del corte) y un par
de métodos gemelos de re-solicitud; sin migración de enum, sin tocar la escritura del reject.

---

## 10. Partición backend / frontend (para el implementer)

**Backend (backend_dev) — grueso:**
- Migración `order_status_sin_gestionar` (INSERT + down) + `ORDER_STATUS_SEED`.
- Migración `orden_historial_origen_sin_gestionar` (2 `ADD VALUE` + down) + `SEED`.
- `CorteDiarioRepository`: ampliar la selección (gestiones ∪ `en_reparto`; excluir
  `{solicitado,vencido,rechazado}`).
- `CierreDiaRepository.crearCierre`: input opcional del corte + transición `en_reparto →
  sin_gestionar` (choke point) + guarda "algo pasó" con 0 gestiones.
- `CorteDiarioService.ejecutarCorte`: cablear la transición `sin_gestionar` por mensajero.
- `OrdenRepository`: `ESTADOS_CIERRE_BLOQUEANTES` + SQL crudo anti-TOCTOU → + `rechazado` (R29).
- `CierreDiaRepository` + `CierreDiaService.solicitarCierre`: `rechazado → solicitado` (gemelos del
  `vencido`, o generalizados a `{vencido,rechazado}`) + `tieneRechazado` (R28/R31).
- `CierresAdminRepository.forzarSolicitudVencido`: guarda `estado IN ('vencido','rechazado')` (R28).
- `CierresAdminRepository.resolverCierre`: liberación de `sin_gestionar` a bodega en la rama
  `aprobado` (`prioridad = true`, choke point), misma tx; inyectar `findCentralZonaId` / estatus ids.
- Tests unit/integración de money-neutralidad (R11/R13), idempotencia (R9/R19), bloqueo+re-solicitud
  (R27–R30).

**Tests EXISTENTES que cambian (38/111/41) — el implementer los AJUSTA (no afloja):**
- `tests/unit/repositories/orden-repository.bloqueo.test.ts` (41) — **cambia de esperar
  DESBLOQUEO al rechazar a esperar BLOQUEO**: un `rechazado` ahora SÍ bloquea (nuevo assert del
  conjunto `{solicitado,vencido,rechazado}`); el SQL anti-TOCTOU incluye `'rechazado'`.
- `tests/unit/repositories/corte-diario-repository.test.ts` — la exclusión pasa a los 3 estados
  abiertos; un mensajero con `rechazado` no recibe un 2.º cierre.
- `tests/unit/repositories/cierre-dia-repository.test.ts` / `tests/unit/services/cierre-dia-service.test.ts`
  (111) — **NUEVO camino `rechazado → solicitado`** (gemelo del `vencido → solicitado`): el
  mensajero puede solicitar desde `rechazado`; regresión del `vencido` verde.
- `tests/unit/services/cierres-admin-service.test.ts` / `tests/unit/repositories/cierres-admin-repository.test.ts` —
  `rechazarCierre` conserva `estado:'rechazado'` (escritura SIN cambio), PERO la aprobación gana la
  liberación de `sin_gestionar`; `forzarSolicitudVencido` acepta `rechazado`.
- `tests/integration/actions/cierres-admin-action.test.ts` — el `rechazar` sigue devolviendo
  `rechazado` (sin cambio); se añade que el cierre queda bloqueante/re-solicitable.
- `tests/components/CierresAdminModule.test.tsx` / `CierresAdminPage.test.tsx` — `rechazado` en el
  histórico rotulado "bloqueante hasta re-solicitud" (no "resuelto").
- `tests/components/CierreDiaModule.test.tsx` (111/R13) — el CTA de re-solicitar aparece también con
  `tieneRechazado`.
- `e2e/cierres-admin.spec.ts` / `e2e/cierres-admin-rechazos-sla.spec.ts` — flujo de rechazo (e2e,
  diferido): rechazar ya NO cierra el ciclo; el mensajero re-solicita → admin aprueba.
- **NO cambian:** `tests/integration/db/cierre-estado-vencido-migration.test.ts` (el enum
  `CierreEstado` no se toca).

**Confirmación (pedido por el coordinador) — tests que pasan de "desbloqueo al rechazar" a
"bloqueo + re-solicitud":** `orden-repository.bloqueo.test.ts` (bloqueo por `rechazado`),
`corte-diario-repository.test.ts` (exclusión incluye `rechazado`), `cierre-dia-*` (nuevo
`rechazado → solicitado`), y los e2e de rechazo. Los `cierres-admin-*` NO cambian su ESCRITURA de
reject (sigue `rechazado`), solo su efecto de bloqueo + el rótulo de UI.

**Frontend (frontend_dev):**
- `ORDER_STATUS_LABELS` (`EstatusBadge`): etiqueta + variante de `sin_gestionar` (R25).
- Test de que `sin_gestionar` no aparece/reordena/resalta en la reasignación (R15/R26).
- `CierreDiaModule`: CTA re-solicitar generalizado a `tieneRechazado`; `/cierres-admin`: rótulo
  bloqueante de `rechazado` (R31).

**Orden sugerido:** migraciones + SEEDs → corte extendido (repo/service) → conjunto bloqueante +
`rechazado → solicitado` + válvula → liberación en la rama `aprobado` de `resolverCierre` →
money-neutralidad/idempotencia → UI (etiqueta + CTA + rótulo). La UI depende del valor de catálogo.

---

## 11. Forks duros abiertos

Ninguno. El humano cerró el modelo (global, `rechazado` bloqueante + re-solicitable). Los detalles
que quedaban (rótulo de `rechazado` en `/cierres-admin`, CTA de re-solicitud del mensajero, válvula
del admin generalizada a `{vencido,rechazado}` para el caso abandonado) se cierran por CONVENCIÓN
espejando el tratamiento del `vencido` (111), sin decisión abierta.

### P (menor, no bloquea) — auditoría al re-solicitar desde `rechazado`
La transición `rechazado → solicitado` cambia SOLO `estado` (espejo exacto del `vencido`), por lo
que un cierre re-solicitado CONSERVA el `resuelto_por/at`/`motivo_rechazo` del rechazo previo hasta
que la aprobación final los sobrescribe. Es cosmético (un `solicitado` mostrando un `resueltoAt`
viejo) y money-neutral. _Recomendación:_ dejarlo así (mirror exacto); si molesta en la UI, limpiar
`motivo_rechazo`/`resuelto_at` en la transición es un follow-up trivial. No es un fork.
