# Feature 48 — Rechazo: devolución a la tienda de origen — design.md

> El CÓMO técnico. Primero el MAPA del estado actual (archivo:símbolo:línea), porque el valor
> de la feature es enchufar la transición `rechazada → devuelta_origen` a la máquina de estados
> y al historial de la 49 SIN saltarse el choke point, reusando la resolución de tienda de
> origen (`orden.tienda_id`), la bodega responsable (features 41/30) y la autz/visibilidad por
> rol ya existentes. Todos los símbolos son reales (verificados con Grep/Read sobre la rama
> `feature/48-...`, que nace del tip de la 47 = dev + 58 + 49 + 46 + 47).

---

## 1. MAPA del estado actual (archivo:símbolo:línea)

### 1.1 Catálogo `order_status` — `rechazada` y `devuelta_origen` YA existen

`lib/types/order-status.ts:ORDER_STATUS_SEED:19-33`:
- `devuelta_origen` — L22 (3.º valor). **Ningún call-site lo escribe hoy** (ver §1.4);
  reservado a ESTA feature.
- `rechazada` — L31 (12.º, feature 36). Destino final del proceso de entrega.
- Etiquetas de presentación ya definidas en
  `app/(app)/ordenes/_components/estatus-label.ts:6-20`: `devuelta_origen → "Devuelta a
  origen"` (L9), `rechazada → "Rechazada"` (L18). **No hace falta añadir etiquetas.**

**Conclusión:** no se requiere migración de catálogo (R17). Ambos estados están sembrados por
`seedOrderStatus` (idempotente).

### 1.2 Los DOS caminos por los que una orden llega HOY a `rechazada`

| Camino | archivo:símbolo:línea | Comportamiento |
| --- | --- | --- |
| Rechazo DIRECTO (feature 36) | `lib/services/MisAsignacionesService.ts:gestionar:142-234` | Con `input.resultado === "rechazada"`: sube evidencia (L183-192), resuelve `nuevoEstatusId = findEstatusIdByValue("rechazada")` (L172) y llama a `crearGestionYTransicionar` SIN `seguimiento` (L212-218). Destino `en_reparto → rechazada`. **No** limpia `mensajero_asignado_id`. |
| ESCALADO automático (feature 47) | `lib/services/MisAsignacionesService.ts:resolverSeguimientoDevuelta:276-308` | Con `input.resultado === "devuelta"` y `intentoActual >= umbral`: `seguimiento = { destinoEstatusId: <rechazada>, limpiaMensajero: false }` (L286-291). En el repo, seguimiento `devuelta → rechazada`, actor NULL. **No** limpia `mensajero_asignado_id` (deja el rastro "para la 48", comentario L287-288). |

**Ambos** terminan en `rechazada` a través del MISMO repo (`crearGestionYTransicionar`, #9 del
mapa de la 49) y ambos CONSERVAN `mensajero_asignado_id`. Por tanto la elegibilidad de la 48
es puramente por ESTADO (`rechazada`), agnóstica del camino (R1/R2).

### 1.3 Escritura de estado y choke point (feature 49)

- Choke point: `lib/repositories/registrar-cambio-estado.ts:appendCambioEstado:21-37`. Inserta
  el lote de transiciones (`createMany`) en el `tx` en curso; toda escritura de
  `orden.estatus_id` DEBE invocarlo en su misma tx.
- Punto de escritura genérico #11: `lib/repositories/OrdenRepository.ts:update` — `origen_tipo
  = ajuste_estado`, actor = usuario autenticado (usado hoy por `OrdenService.actualizar`,
  `lib/services/OrdenService.ts:158-199`, L192-197). Escribe estado + append en la misma tx.
- Enum `origen_tipo`: `lib/types/orden-historial.ts:ORDEN_HISTORIAL_ORIGEN_TIPO_SEED:11-23`
  (11 valores, `ajuste_estado` en L22), respaldado por el enum Prisma nativo.
- Test de cobertura: `tests/unit/repositories/orden-historial-cobertura.test.ts` — conjunto
  CERRADO de 11 puntos; invariantes: exactamente 11 (L59-63), cada símbolo es un método real
  (L65-70), los 11 `origen_tipo` cubren EXACTAMENTE el enum (L72-76), cada familia aparece UNA
  vez (L78-81). El #11 es `{ OrdenRepository, "update", "ajuste_estado" }` (L44).

### 1.4 Confirmación: `devuelta_origen` no se escribe hoy

`grep devuelta_origen` sólo aparece en catálogo (seed/tipos), specs, migración de enum y
etiquetas — NUNCA como destino de una escritura de estado. El test de cobertura (11 puntos, sin
`devuelta_origen`) lo confirma. Es un estado sembrado pero HUÉRFANO hasta la 48.

### 1.5 Tienda de origen — `orden.tienda_id`

`db/schema.prisma:model Orden:308-352`:
- `tiendaId String @map("tienda_id")` (L315) — FK NOT NULL a `Usuario`, relación
  `@relation("OrdenTienda")` (L334). Se fija en la carga masiva (feature 15) / creación
  (feature 6, `OrdenService.crear` fuerza `tienda_id = actor.usuarioId` para `adminTienda`,
  `lib/services/OrdenService.ts:31-46`).
- `@@index([tiendaId])` (L346).
- `mensajeroAsignadoId String?` (L326, `onDelete: SetNull`) — conservado en `rechazada`.

**Conclusión:** la tienda de origen ya vive en la orden; NADA nuevo (R6, F1.4-c).

### 1.6 Visibilidad y autorización por rol (features 6/26/49)

| Pieza | archivo:símbolo:línea | Qué garantiza |
| --- | --- | --- |
| Listado de órdenes por rol | `lib/services/OrdenService.ts:listar:129-156` | `adminTienda` → `where.tienda_id = actor.usuarioId` (L138, server-side); `maestro`/`admin` → sin filtro; filtro opcional por estado `where.estatus_id` (L136). `KNOWN_ROLES = maestro/admin/adminTienda/mensajero` (L21) — **`adminSatelite` NO está** (sub-riesgo F1.4-d). |
| Autz de lectura del historial | `lib/services/OrdenHistorialService.ts:autorizar:68-92` | maestro/admin (todas), adminTienda (su tienda), mensajero (asignada/actuada), adminSatelite (su zona). |
| Superficie UI | `app/(app)/ordenes/page.tsx:17-45` | maestro/admin → `OrdenesRevisionMaestro` (apartados por estado); resto → `OrdenesModule` (lista plana, SWR + Server Action `listarOrdenes` server-scoped, `mostrarHistorial`). |
| Línea de tiempo (49) | `HistorialOrdenTimeline.tsx` / `HistorialOrdenSheet.tsx` | Muestra las entradas del historial con etiquetas de `estatus-label`. |

### 1.7 Bodega responsable (features 41/30/33)

- `lib/utils/bodega-responsable.ts:resolverDestinoCierre:16-23` — dado `zonaId` +
  `centralZonaId` devuelve `bodega_central` (si la zona ES la central) o `bodega_satelite`.
- Zona central: `IZonaRepository.findCentralZonaId` (impl `ZonaRepository`), usada por la 41 y
  reusada por la 47 (`MisAsignacionesService.ts:300`). Fallback seguro: `centralZonaId` null →
  `bodega_satelite` (no lanza).

---

## 2. Diseño del retorno (dónde se engancha, transacción, choke point)

Decisión de diseño según F1.4-a (RECOMENDADA): **acción MANUAL de la bodega responsable**;
la orden REPOSA en `rechazada` y una acción explícita la transiciona a `devuelta_origen`.

### 2.1 Capas (patrón `docs/architecture.md`)

```
app/(app)/ordenes (o módulo bodega satélite)      ← superficie con el botón "Devolver a tienda"
  ↓  Server Action (lib/actions/devolucion-origen.ts, 'use server', lee cookies → Actor)
lib/services/DevolucionOrigenService.ts           ← REGLA: guardia de estado + autz por bodega
  ↓  (interfaz IDevolucionOrigenService)
lib/repositories/OrdenRepository.update (#11)     ← ESCRITURA de estado + appendCambioEstado (tx)
  ↓
Supabase (Postgres)
```

- **Server Action** `devolverATienda(ordenId)` (`lib/actions/devolucion-origen.ts`): resuelve
  el `Actor` de la sesión (patrón `resolveActorFromSession`), instancia el service, ejecuta.
  Mutación interna → Server Action, no route handler (arquitectura).
- **Service** `DevolucionOrigenService.devolverATienda(ordenId, actor)`: contiene la REGLA
  (guardia + autz + decisión de bodega responsable). No conoce HTTP ni Prisma.
- **Repo**: reusa `OrdenRepository.update` (#11) — que ya escribe estado + `appendCambioEstado`
  atómicamente con `origen_tipo = ajuste_estado` y actor = usuario. NO se crea un call-site
  nuevo (F1.4-e recomendada).

### 2.2 La REGLA en el service (R4/R5/R10/R11)

`DevolucionOrigenService.devolverATienda(ordenId, actor)`:
1. Cargar la orden (`OrdenRepository.findById`, excluye borradas → `not_found`).
2. **Guardia de estado (R5):** si `estatus != rechazada`:
   - si `estatus == devuelta_origen` → devolver `ok` idempotente (no re-transiciona).
   - si otro estado → `conflict` (no elegible; sólo desde `rechazada`).
3. **Autz por bodega responsable (R10/R11):** derivar la bodega responsable de la zona de la
   orden con `resolverDestinoCierre(orden.zonaId, findCentralZonaId())`:
   - `bodega_central` → permitido a `maestro`/`admin`.
   - `bodega_satelite` → permitido a `adminSatelite` cuya zona == `orden.zonaId`.
   - cualquier otro caso (incl. `adminTienda`, `mensajero`, `adminSatelite` de otra zona) →
     `forbidden`.
4. **Transición (R4/R7/R8):** resolver `devueltaOrigenId = findEstatusIdByValue("devuelta_origen")`
   (catálogo incompleto → error de config) y llamar a
   `OrdenRepository.update(ordenId, { estatusId: devueltaOrigenId }, { actorUsuarioId:
   actor.usuarioId, origenTipo: "ajuste_estado" })`. El repo hace el `UPDATE` + el
   `appendCambioEstado` en la MISMA `$transaction` (atómico, R7).

**Concurrencia / idempotencia:** `rechazada` es final del proceso de entrega, sin actores
concurrentes que reintroduzcan la orden al flujo; el riesgo de carrera es bajo. Endurecimiento
opcional (si el reviewer lo pide): que `OrdenRepository.update` acepte una guardia de estado de
origen (`WHERE estatus_id = <rechazada>` con `RETURNING`) para que sólo transicione si sigue en
`rechazada` (el append cubre EXACTAMENTE las filas que transicionaron, patrón #7/#8 de la 49).

### 2.3 Por qué reusar #11 (`ajuste_estado`) y no un `origen_tipo` nuevo (F1.4-e)

- El test de cobertura de la 49 exige "exactamente 11 puntos" y "un `origen_tipo` por familia".
  Añadir un call-site nuevo con `ajuste_estado` rompería "1 por familia"; añadir uno con un
  `origen_tipo` nuevo forzaría una migración de enum y crecería a 12.
- Reusar el método #11 (`OrdenRepository.update`) con `ajuste_estado` mantiene el conjunto en 11
  y "1 por familia": #11 sigue siendo el único punto `ajuste_estado`. Se ACTUALIZA el test de
  cobertura sólo en DOCUMENTACIÓN (comentario en #11: "también sirve el retorno a tienda
  `rechazada → devuelta_origen` vía `DevolucionOrigenService`"), tal como la 47 documentó que
  #9 sirve el seguimiento. Semánticamente aceptable: es un ajuste de estado ejecutado por un
  administrador, con actor y timestamp registrados.
- Se añaden aserciones de INTEGRACIÓN propias de la 48 (fuera del test de cobertura): la acción
  deja UNA fila de historial `rechazada → devuelta_origen` con actor = el admin de bodega y
  `origen_tipo = ajuste_estado`.

### 2.4 Visibilidad (R12/R13/R14/R15)

- **Tienda (R12):** `OrdenService.listar` ya acota `adminTienda` a `where.tienda_id =
  actor.usuarioId`. La orden en `devuelta_origen` (o `rechazada`) aparece automáticamente en el
  listado de la tienda con su etiqueta. Superficie: badge/apartado "Devueltas/Rechazadas" o el
  filtro por estado ya soportado en `OrdenesModule`. Sin cambio de autz.
- **Etiquetas (R13):** ya existen en `estatus-label.ts` ("Rechazada", "Devuelta a origen").
- **Otros roles (R14):** maestro/admin (todas), adminSatelite (su zona), mensajero
  (asignada/actuada) — reusa `OrdenHistorialService.autorizar` y `OrdenService.listar`.
- **Línea de tiempo (R15):** la transición aparece como una entrada más en
  `HistorialOrdenTimeline` (dato ya provisto por la 49; sin lógica de presentación nueva).

---

## 3. Modelo de datos

- **Sin tabla nueva, sin columna nueva, sin migración** (F1.4-c/e/f recomendadas). Todo se
  apoya en: `orden.tienda_id` (origen), `order_status` (`rechazada`/`devuelta_origen` ya
  sembrados), el historial append-only de la 49 (instante + actor del retorno).
- RLS: no aplica (no hay tabla nueva). La orden y su historial ya tienen su RLS.

---

## 4. Estrategia de tests (cómo se prueba)

- **Unit — guardia de estado (R5):** desde `rechazada` → transiciona; desde cualquier otro
  estado → `conflict`; desde `devuelta_origen` → `ok` idempotente (no re-transiciona).
- **Unit — elegibilidad de ambos caminos (R1/R2):** una orden `rechazada` por rechazo directo
  y una por escalado son AMBAS retornables (mismo resultado); ninguna requiere dato extra.
- **Unit — autz por bodega responsable (R10/R11):** con zona central, permite maestro/admin y
  niega adminSatelite/adminTienda/mensajero; con zona satélite, permite el adminSatelite de esa
  zona y niega el de otra zona y al resto. Deriva la bodega con `resolverDestinoCierre` +
  `findCentralZonaId` (fallback central null → satélite).
- **Integración — transición atómica por el choke point (R4/R7/R8):** la acción deja la orden
  en `devuelta_origen` y UNA fila de historial `rechazada → devuelta_origen` con `actor = admin`
  y `origen_tipo = ajuste_estado`; si el append falla, revierte el cambio de estado (atómico).
- **Cobertura de la 49 (R9):** el test `orden-historial-cobertura.test.ts` sigue en 11 puntos,
  con #11 (`update`/`ajuste_estado`) documentado como servidor también del retorno a tienda; no
  hay 12.º punto ni `origen_tipo` nuevo.
- **Visibilidad (R12/R14):** `OrdenService.listar` para `adminTienda` sólo devuelve sus órdenes
  (incluyendo `rechazada`/`devuelta_origen`); una orden de OTRA tienda no aparece; con filtro por
  estado devuelve las `devuelta_origen`.
- **UI (R13/R15):** render de la etiqueta "Devuelta a origen"; la línea de tiempo muestra la
  entrada `rechazada → devuelta_origen`.
- **No regresión (R16):** rechazo directo (36) y escalado (47) siguen dejando la orden en
  `rechazada` conservando `mensajero_asignado_id`; tests previos verdes.
- **Aceptación (R18):** `./init.sh` verde (typecheck/lint/tests).
- **E2E (flujo crítico, ingesta/recaudo adyacente):** una orden llega a `rechazada` (por
  escalado o rechazo directo); la bodega responsable ejecuta "Devolver a tienda"; la orden
  queda `devuelta_origen`, el `adminTienda` de origen la ve en su módulo con etiqueta "Devuelta
  a origen" y la línea de tiempo muestra la transición.

---

## 5. Contratos I/O (borde)

- **Server Action** `devolverATienda(ordenId: string)` (`lib/actions/devolucion-origen.ts`):
  entrada validada con zod (`{ ordenId: string().uuid() }`); resuelve `Actor` de la sesión;
  devuelve `{ status: "ok" } | { status: "forbidden" } | { status: "not_found" } | { status:
  "conflict"; motivo } | { status: "config_error"; ... }` (patrón de resultados de
  `MisAsignacionesService`/`OrdenService`). No devuelve PII de la orden más allá de lo ya
  autorizado.
- **Service** `IDevolucionOrigenService.devolverATienda(ordenId, actor): Promise<Result>` —
  interfaz nueva en `lib/interfaces/services/`. Depende de `IOrdenRepository`
  (`findById`, `findEstatusIdByValue`, `findUsuarioZonaId`, `update`) y de
  `Pick<IZonaRepository, "findCentralZonaId">`, ambos ya existentes.
- **Sin webhook ni API externa** → no aplica firma/idempotencia de webhook.

---

## 6. Trazabilidad R → superficie

| R | Dónde se cumple |
| --- | --- |
| R1/R2 | Guardia por estado `rechazada` en `DevolucionOrigenService` (agnóstica del camino). |
| R3 | Sin transición automática en `crearGestionYTransicionar` (36/47 intactos). |
| R4/R7/R8 | `DevolucionOrigenService` + `OrdenRepository.update` (#11) → `appendCambioEstado` en tx. |
| R5 | Guardia de estado de origen en el service (idempotente en `devuelta_origen`). |
| R6 | `orden.tienda_id` (sin campo nuevo). |
| R9 | `orden-historial-cobertura.test.ts` (11 puntos, #11 documentado). |
| R10/R11 | Autz por bodega responsable (`resolverDestinoCierre` + `findCentralZonaId`). |
| R12/R14 | `OrdenService.listar` (scope por tienda) + `OrdenHistorialService.autorizar`. |
| R13/R15 | `estatus-label.ts` + `HistorialOrdenTimeline`. |
| R16 | No se toca la rama de rechazo/escalado; tests previos 36/47/49. |
| R17/R18 | Sin migración; `./init.sh`. |

---

## 7. Migración: NO se requiere (recomendado) — y la alternativa

**Recomendado — ninguna migración (R17, F1.4-f):**
- `order_status` NO cambia: `rechazada` y `devuelta_origen` ya sembrados.
- Tienda de origen: `orden.tienda_id` ya existe.
- `origen_tipo` reutilizado (`ajuste_estado`, #11): sin `ALTER TYPE`, sin call-site nuevo.
- Instante + actor del retorno: capturados por el historial de la 49 (no hace falta columna de
  auditoría).

**Alternativa (declarada si el humano la elige) — migración aditiva:**
- (e)-alternativa: `origen_tipo` dedicado `devolucion_origen` → UP `ALTER TYPE
  "orden_historial_origen_tipo" ADD VALUE 'devolucion_origen'`; DOWN debe RECREAR el enum
  (Postgres no permite `DROP VALUE`): crear tipo nuevo sin el valor, `ALTER TABLE ... ALTER
  COLUMN ... TYPE ... USING`, `DROP TYPE` viejo, `RENAME` (frágil si ya hay filas con el valor).
  El test de cobertura crece a 12 puntos (12 familias).
- (f)-alternativa: columna de auditoría en `orden` (`devuelta_origen_at TIMESTAMPTZ NULL`,
  `devuelta_origen_por` FK a `Usuario` NULL) → UP añade columnas + índice; DOWN las elimina.
  Round-trip `db:migrate → db:rollback → db:migrate` obligatorio.

**Por qué se descartan como default:** ambas pagan una migración (y la de enum es de
reversibilidad frágil) para un beneficio marginal — el retorno ya es identificable por el par
`rechazada → devuelta_origen` en el historial, con su actor y timestamp. Se conservan a mano
para la puerta de aprobación.

---

## 8. Alternativas descartadas (obligatorio)

### 8.1 Retorno AUTOMÁTICO en la misma tx que alcanza `rechazada` — DESCARTADA (F1.4-a)
Emitir `rechazada → devuelta_origen` dentro de `crearGestionYTransicionar` (patrón del
seguimiento de la 47, `origen_tipo=gestion`, actor=null), tanto para el rechazo directo como
para el escalado. **Por qué se descarta:** la orden NUNCA reposaría en `rechazada`, lo que
contradice la descripción ("llega a RECHAZO (estado final) ... debe VOLVER") y afirmaría el
retorno FÍSICO del paquete a la tienda antes de que ocurra. No hay actor humano auditable del
retorno. Es más barato (sin acción/endpoint, sin superficie, sin migración, cobertura 49 en 11)
y queda como opción si el negocio decide NO modelar el paso físico de devolución.

### 8.2 `origen_tipo` dedicado `devolucion_origen` — DESCARTADA (F1.4-e)
Historial autodescriptivo pero cuesta una migración `ALTER TYPE ADD VALUE` con `down.sql` que
recrea el enum (reversibilidad frágil, igual que la 47 §7) y crece el test de cobertura a 12.
El retorno ya es identificable por el par `rechazada → devuelta_origen` con `origen_tipo =
ajuste_estado` y su actor. Se conserva como variante a decisión del humano.

### 8.3 Encaminar el retorno por `OrdenService.actualizar` (CRUD genérico) — DESCARTADA
`OrdenService.actualizar` (#11) ya escribe `ajuste_estado`, pero su autz permite a `adminTienda`
tocar `estatus_id` de SUS órdenes (`OrdenService.ts:174-177`), lo que dejaría a la tienda
auto-marcar `devuelta_origen` (indebido) y no impone la guardia "sólo desde `rechazada`". Se
descarta a favor de un servicio DEDICADO (`DevolucionOrigenService`) que reusa el mismo
call-site de repo (#11) pero con su propia guardia de estado y autz por bodega responsable.

### 8.4 Columna materializada de "devuelto a origen" en `orden` — DESCARTADA (F1.4-f)
Un flag/columna que marque el retorno duplicaría un estado ya representado por
`estatus = devuelta_origen` y su historial, con doble fuente de verdad y una migración
innecesaria. El estado + el historial de la 49 bastan.
