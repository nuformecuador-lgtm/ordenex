# Feature 157 (Recolección en tienda por el mensajero · QR) · design.md

> Referencias obligatorias: `docs/architecture.md` (capas Controller → Service → Repository,
> Server Actions para mutaciones internas, migraciones up/down, sin sobre-ingeniería en
> componentes) y `docs/conventions.md`.
> Todo el estado del arte de esta sección se verificó leyendo `dev` en el worktree `lote-135`.

---

## 1. Resumen de la decisión de diseño

Tres piezas, ninguna de ellas un modelo de datos nuevo:

| Pieza | Superficie | Naturaleza |
| --- | --- | --- |
| A. Asignar recolecciones | `/ordenes` (maestro/admin) | Escritura de `mensajero_asignado_id` **sin cambio de estado** |
| B. Apartado y panel del mensajero | `/mis-asignaciones` | Tercer grupo + componente propio, `GestionarOrdenPanel` intacto |
| C. Confirmación por QR | `/mis-asignaciones` | Transición `por_recolectar_en_tienda → en_ruta_bodega_central`, familia `recoleccion_tienda` |

La pieza A es la única del repo que **asigna sin transicionar**. Es deliberado: el paquete sigue
en la tienda; el estado solo cambia cuando el mensajero lo tiene físicamente y lo escanea (pieza C).

---

## 2. Estado del arte verificado (qué existe y qué falta)

### 2.1 Lo que ya existe y se reusa tal cual

| Artefacto | Ruta | Uso en 157 |
| --- | --- | --- |
| `QrScanner` | `components/shared/QrScanner.tsx` | Cámara + ciclo de vida de `html5-qrcode`, sin cambios |
| `extractNumGuiaFromScan` | `lib/utils/paquete-url.ts` | El QR de la etiqueta codifica `/paquete/<numGuia>` |
| `EscanerRecepcionBodegaCentral` | `app/(app)/ordenes/_components/` | **Plantilla** del escáner (QR + entrada manual equivalente, guard `procesando`, toast por estado) |
| `lib/actions/recepcion-bodega-central.ts` | — | **Plantilla** de la Server Action (`withErrorHandler` + zod + `resolveActorFromSession`) |
| `RecepcionBodegaCentralService` | `lib/services/` | **Plantilla** del service (rol → carga → idempotencia → guardia de estado → escritura guardada → carrera) |
| `OrdenRepository.recibirEnBodegaCentral` | `lib/repositories/OrdenRepository.ts:1653` | **Plantilla** del repo (UPDATE guardado por estado de origen + `appendCambioEstado` en la misma tx) |
| `useRecogerPorGuia` / `EscanerRecoger` / `InputRecoger` | `app/(app)/mis-asignaciones/_components/` | **Plantilla** del par escáner+input del mensajero, con la restricción "asignada a mí" resuelta en cliente contra la lista ya cargada |
| `OrdenesApartado` | `app/(app)/ordenes/_components/` | **No se toca**: ya acepta título, `estatusValue`, `selectable`, acción primaria/secundaria/terciaria e historial por fila. La feature solo monta una instancia más |
| `AsignarBodegaModal` | `app/(app)/ordenes/_components/` | **Plantilla** del modal de asignación por lote |
| `PosOrderCard` / `AsignacionDetalle` | `app/(app)/mis-asignaciones/_components/` | **No se reusan** en recolección (arrastran cobro, secuencia de ruta y detalle de entrega) |

### 2.2 Lo que la 154 deja declarado y esta feature ESTRENA

- `order_status` gana `por_recolectar_en_tienda` (tabla catálogo, no enum).
- `TRANSICIONES` gana la arista `por_recolectar_en_tienda → en_ruta_bodega_central`
  (`via: recoleccion_tienda`, `rol: mensajero`), y `ESTADOS_CREACION` gana
  `por_recolectar_en_tienda`.
- `orden_historial_origen_tipo` gana el value `recoleccion_tienda`.

Esta feature **no crea nada de eso**: lo consume. Si la 154 no está mergeada, 157 no compila
(el `satisfies Record<OrderStatusValue, …>` del mapa de transiciones es la red de seguridad).

### 2.3 Lo que hoy NO contempla las recolecciones (y hay que abrir)

1. `OrdenesRevisionMaestro.tsx` monta 7 apartados; ninguno es `por_recolectar_en_tienda`.
2. `GuiaAsignacionService` tiene tres escrituras (`generarGuia`, `asignarDesdeBodega`,
   `rutearABodegaSatelite`); las tres transicionan y las tres exigen origen distinto de
   `por_recolectar_en_tienda`.
3. `MisAsignacionesService.listarMisAsignaciones` consulta con
   `findMisAsignaciones(actor, [ORIGEN_RECOGER, ESTADO_EN_REPARTO])` y arma DOS grupos.
4. `MisAsignacionesModule` solo conoce esos dos grupos y un único panel de detalle
   (`GestionarOrdenPanel`).
5. `OrdenRepository` no tiene ningún método que escriba `mensajero_asignado_id` sin transicionar.

---

## 3. Modelo de datos

### 3.1 Migraciones: NINGUNA

Esta feature **no añade tablas, columnas, enums ni índices**. Verificación por punto:

- `por_recolectar_en_tienda` y `en_ruta_bodega_central` son filas de la tabla catálogo
  `order_status` (la 154 la primera, ya existe la segunda).
- `recoleccion_tienda` es un value del enum `orden_historial_origen_tipo` que **da de alta la 154**
  (`ALTER TYPE ADD VALUE` + actualización de los `down.sql` previos: trabajo de la 154, no de esta).
- La asignación escribe `orden.mensajero_asignado_id`, columna existente con su relación
  `OrdenMensajeroAsignado` e índice (feature 17).
- La transición escribe `orden.estatus_id` y una fila de `orden_historial`, ambas existentes.

**Consecuencia operativa:** no hay `migration.sql` ni `down.sql` que escribir en 157, y por tanto
tampoco un guard de censo nuevo. Si en la revisión aparece la necesidad de una columna (p. ej. la
dirección de recogida de la pregunta abierta 2 de `requirements.md`), eso **sale del alcance** y
vuelve a la puerta.

### 3.2 RLS

No hay tabla nueva, luego no hay política RLS nueva. El aislamiento real de esta feature es de
**aplicación**: el `WHERE` del repositorio fuerza `mensajero_asignado_id = :actor` en la lectura del
apartado del mensajero y en la escritura de la confirmación (R12/R30/R34). Es el mismo criterio ya
vigente en `GestionOrdenRepository.findMisAsignaciones` (`lib/repositories/GestionOrdenRepository.ts:109`).

### 3.3 Invariante que esta feature rompe a propósito: `asignado_at`

Hoy, en todo el repo, `mensajero_asignado_id != null ⟹ asignado_at != null`
(`OrdenRepository.ts:1351`, `:1397`; los limpiadores ponen ambos a `null`).

La asignación de recolección **no estampa `asignado_at`**. Motivo: el ÚNICO lector de esa columna es
`RankingRepository.contarAsignadasPorMensajero` (`lib/repositories/RankingRepository.ts:29-45`), que
la usa como **denominador** del ranking diario ("asignadas hoy"). Una recolección jamás puede
producir una `entregada` (numerador), de modo que estampar `asignado_at` **penalizaría** al
mensajero por hacer recolecciones. Y no se pierde nada: cuando la misma orden llegue a la central y
se le asigne mensajero para repartir, `asignarBodegaLote` estampa `asignado_at` entonces — que es el
instante correcto. Ver la pregunta abierta **Q1**.

---

## 4. Backend

### 4.1 Tipos y borde (zod)

**Nuevo:** `lib/types/recoleccion-tienda.ts` (espejo de `lib/types/recepcion-bodega-central.ts`).

```ts
export const recolectarEnTiendaSchema = z.object({
  numGuia: z.number().int().positive(),
});

export type RecolectarEnTiendaResult =
  | { status: "ok"; ordenId: string; estado: "en_ruta_bodega_central" }   // R27
  | { status: "ya_recolectada" }                                          // R32
  | { status: "estado_invalido"; estado: string }                         // R33
  | { status: "no_encontrada" }                                           // R30 (inexistente | borrada | ajena)
  | { status: "forbidden" }                                               // R29 (rol)
  | { status: "conflict"; motivo: string }                                // R31 (bloqueo) / R34 (carrera)
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R20
  | { status: "unauthenticated" };                                        // R29 (sesión)
```

`no_encontrada` **fusiona** "no existe", "borrada" y "es de otro mensajero" a propósito (R30): un
resultado distinto para la orden ajena filtraría su existencia. Es la misma opacidad que ya aplica
`MisAsignacionesService` (36/R31), adaptada a un identificador público (`num_guia`).

**Nuevo:** en `lib/types/orden-guia.ts`, `AsignarRecoleccionResult` reusando el shape de
`AsignarBodegaResult` (`ok` con `resultados: { ordenId }[]` · `conflict` con `detalle:
DetalleConflicto[]` · `validation_error` · `forbidden` · `unauthenticated`), para que el traductor
de errores del modal (`guia-decision-error-messages.ts`) siga sirviendo sin cambios.

### 4.2 Interfaces (`lib/interfaces/`)

**Nueva:** `lib/interfaces/services/IRecoleccionTiendaService.ts`

```ts
export type RecolectarEnTiendaServiceResult =
  Exclude<RecolectarEnTiendaResult, { status: "unauthenticated" }>;

export interface IRecoleccionTiendaService {
  recolectarEnTienda(numGuia: number, actor: Actor): Promise<RecolectarEnTiendaServiceResult>;
}
```

**Ampliadas (aditivas):**

- `IGuiaAsignacionService` → `asignarRecoleccion(input: AsignarRecoleccionInput, actor): Promise<AsignarRecoleccionServiceResult>`
  con `AsignarRecoleccionInput = { ordenIds: string[]; mensajeroId: string }`.
- `IOrdenRepository` → dos métodos nuevos (§4.4).
- `IMisAsignacionesService.ListarMisAsignacionesServiceResult` → campo `porRecolectar: MiAsignacionDTO[]`.
- `MiAsignacionDTO` → campo **opcional** `tiendaTelefono?: string | null` (R15), siguiendo el patrón
  aditivo ya documentado para `marcarLuego?` / `notaPrivada?`: no rompe fixtures, y el `toDTO`
  siempre lo emite.

### 4.3 Services

#### (A) `GuiaAsignacionService.asignarRecoleccion` — se AMPLÍA el service existente

Se añade como **cuarta acción del mismo service**, no como service nuevo. Justificación: es la misma
responsabilidad ("el maestro decide qué mensajero se lleva qué lote") y reusa cuatro piezas que ya
viven ahí: `findByIdsForTransicion`, `findMensajerosBloqueados`, `findMensajeroIdsValidosByZona` y el
contrato `DetalleConflicto` que la UI ya sabe pintar.

Secuencia (todas las guardias ANTES de la única escritura, patrón de las otras tres acciones):

1. `esAccesoTotal(actor.rol)` → si no, `forbidden` (R8).
2. `ordenIds` vacío → `{ status: "ok", resultados: [] }` (idempotencia trivial, patrón vigente).
3. `findByIdsForTransicion(ordenIds)` → por cada id: no existe / borrada / estado ≠
   `por_recolectar_en_tienda` → `detalle`. Si `detalle.length > 0` → `conflict` **sin efectos** (R5).
4. Validación del mensajero: existe y su rol es `mensajero` → si no, `validation_error`
   `{ mensajeroId: ["mensajeroId no valido"] }` (R6). *(Sujeto a la pregunta abierta 1 de
   `requirements.md`: si el humano elige acotar por zona, aquí entra
   `findMensajeroIdsValidosByZona`.)*
5. `findMensajerosBloqueados([mensajeroId])` → bloqueado → `conflict` con
   `MSG_MENSAJERO_BLOQUEADO` (constante ya existente en el service) (R7).
6. **NO se invoca `gateCoordenadas`** (R9): la recolección no entra a ninguna ruta.
7. `repo.asignarRecoleccionLote(ordenIds, mensajeroId, "por_recolectar_en_tienda")`.

#### (B) `RecoleccionTiendaService` — service NUEVO

`lib/services/RecoleccionTiendaService.ts`, espejo estructural de `RecepcionBodegaCentralService`
con dos diferencias: el rol autorizado es `mensajero` (no acceso total) y se añade la guardia de
propiedad y la de bloqueo por cierre.

```
constructor(repo: Pick<IOrdenRepository,
  "findByNumGuiaForTransicion" | "findEstatusIdByValue" | "recolectarEnTienda" | "findMensajerosBloqueados">)
```

Secuencia de `recolectarEnTienda(numGuia, actor)`:

1. `actor.rol !== "mensajero"` → `forbidden` (R29).
2. Bloqueo por cierre: `findMensajerosBloqueados([actor.usuarioId])` → `conflict` con el mismo
   texto `MSG_BLOQUEADO` que usa `MisAsignacionesService` (R31). **Va antes de leer la orden**: sin
   efectos parciales, mismo orden que en `gestionar`.
3. `findByNumGuiaForTransicion(numGuia)` → `null` o `deletedAt !== null` → `no_encontrada` (R30).
4. `row.mensajeroAsignadoId !== actor.usuarioId` → `no_encontrada` (R30, opacidad deliberada).
5. `row.estatusValue === "en_ruta_bodega_central"` → `ya_recolectada` (R32, idempotente).
6. `row.estatusValue !== "por_recolectar_en_tienda"` → `estado_invalido` + estado (R33).
7. `findEstatusIdByValue("en_ruta_bodega_central")` → `null` → `validation_error`
   `{ estatus: ["el catalogo no tiene en_ruta_bodega_central"] }` (misma degradación que 138).
8. `repo.recolectarEnTienda(row.id, "por_recolectar_en_tienda", destinoId, actor.usuarioId,
   { actorUsuarioId: actor.usuarioId, origenTipo: "recoleccion_tienda" })`.
9. `false` (perdió la carrera) → re-lee: si ya está en `en_ruta_bodega_central` → `ya_recolectada`;
   si no → `conflict` (R34).

**No** hay tabla de transiciones state-aware como en 138: aquí el par origen→destino es único.

#### (C) `MisAsignacionesService.listarMisAsignaciones` — se AMPLÍA

- Constante nueva `ORIGEN_RECOLECCION = "por_recolectar_en_tienda"`.
- La lectura pasa a `findMisAsignaciones(actor.usuarioId, [ORIGEN_RECOLECCION, ORIGEN_RECOGER, ESTADO_EN_REPARTO])`.
- Tercer bucket `porRecolectar`, con `secuenciaRuta: null` (nunca es parada).
- Los KPIs (`pendientes`, `porCobrar`, `totalACobrar`) siguen derivándose **solo** de
  `porGestionar`: no se toca ese cálculo, que es exactamente lo que R39 exige.
- `paradasSinOptimizar` sigue contando solo sobre `porGestionar`.
- **No se tocan** `recogerAsignaciones`, `escogerParaGestion`, `gestionar` ni `liberarGestion`
  (R18/R25).

### 4.4 Repository (`OrdenRepository`)

**Cambio aditivo previo:** `OrdenTransicionRow` gana `mensajeroAsignadoId?: string | null` y el
`select` de `findByNumGuiaForTransicion` (`OrdenRepository.ts:1121-1144`) lo incluye. Se declara
**opcional** por el mismo patrón aditivo que `OrdenListItemDTO.mensajeroAsignadoId?` (no rompe los
dobles de test existentes de 138/139); el repo siempre lo emite.

**Método nuevo 1 — `asignarRecoleccionLote(ordenIds, mensajeroId, origenValue): Promise<number>`**

```
$transaction(async tx => {
  const result = await tx.orden.updateMany({
    where: { id: { in: ordenIds }, deletedAt: null, estatus: { value: origenValue } },
    data:  { mensajeroAsignadoId: mensajeroId },   // ← NI estatusId, NI numGuia, NI asignadoAt
  });
  if (result.count !== ordenIds.length) throw new ConflictoLoteError(); // rollback: todo-o-nada (R5)
  return result.count;
})
```

Notas de diseño:

- **Sin `appendCambioEstado`.** No hay cambio de estado, y el choke point de la feature 140 valida
  contra `TRANSICIONES`: una auto-arista `por_recolectar_en_tienda → por_recolectar_en_tienda` NO
  existe en el mapa y haría lanzar `TransicionIlegalError`. Registrar la asignación como transición
  sería falsificar el historial. Ver **Q3**.
- La guarda del `WHERE` (estado + no borrada) es la defensa REAL; la comprobación del paso 3 del
  service solo sirve para reportar mejor (mismo criterio que `recibirEnBodegaCentral`).
- `prioridad` **no** se toca (a diferencia de `asignarBodegaLote`, que la apaga): una recolección no
  participa del ciclo de reasignación prioritaria de la feature 101.

**Método nuevo 2 — `recolectarEnTienda(ordenId, origenValue, destinoEstatusId, mensajeroId, historial): Promise<boolean>`**

Copia exacta de `recibirEnBodegaCentral` (`OrdenRepository.ts:1653-1692`) añadiendo
`mensajeroAsignadoId: mensajeroId` a **ambos** `where` (el pre-read del origen y el `updateMany`),
de modo que la propiedad sea parte de la guardia atómica y no solo una comprobación previa (R34).
`appendCambioEstado` se invoca **solo si `result.count === 1`**, con
`origenTipo: "recoleccion_tienda"`.

**`GestionOrdenRepository.findMisAsignaciones`**: el `include` compartido `WITH_ASIGNACION` gana
`tienda: { select: { telefono: true } }` y `toMiAsignacionRow` lo propaga como `tiendaTelefono`
(R15). El `WHERE` no cambia (`mensajeroAsignadoId` + `deletedAt: null` + `estatus.value IN`).

### 4.5 Server Actions (controllers)

Mutaciones internas ⇒ Server Actions, no route handlers (`docs/architecture.md`).

**Nueva:** `lib/actions/recoleccion-tienda.ts`

```ts
export async function recolectarEnTiendaPorQr(
  input: unknown,
  deps: RecoleccionTiendaDeps = {},
): Promise<RecolectarEnTiendaResult>
```

Espejo literal de `lib/actions/recepcion-bodega-central.ts`: `withErrorHandler` →
`resolveActorFromSession` → `UnauthenticatedError` si no hay sesión → `recolectarEnTiendaSchema.parse`
→ service. `toRecoleccionActionError` traduce solo `VALIDATION_ERROR` y `UNAUTHORIZED`, y **lanza**
ante cualquier otro `AppErrorCode` (no lo enmascara como resultado de dominio).

**Ampliada:** `lib/actions/ordenes-guia.ts` gana `asignarRecoleccion(input, deps)`, con
`asignarRecoleccionSchema = z.object({ ordenIds: z.array(z.string().uuid()).min(1),
mensajeroId: z.string().uuid() })` y el traductor de errores que el archivo ya tiene
(`toGuiaActionError`).

---

## 5. Frontend

### 5.1 Pieza A — el listado del maestro

- **`OrdenesApartado.tsx`: SIN CAMBIOS.** Su contrato (título, `estatusValue`, `estatusId`,
  `selectable`, acción primaria/secundaria/terciaria, `mostrarHistorial`) cubre el caso completo.
  Estudiado y confirmado: no hace falta ni un prop nuevo.
- **`OrdenesRevisionMaestro.tsx`**: se monta un apartado más, **antes** de "En bodega" (orden
  cronológico del flujo v2):

  ```
  titulo="Por recolectar en tienda"
  estatusValue="por_recolectar_en_tienda"
  actionLabel="Asignar mensajero para recolección"   → abre AsignarRecoleccionModal
  secondaryActionLabel="Imprimir etiquetas"          → EtiquetasGuiaModal (ya existe; estas órdenes
                                                        nacen CON num_guia por la 155)
  mostrarHistorial
  ```
  Con `readOnly` (rol `admin`) el apartado se lista sin checkboxes ni botones, igual que los demás.
  La columna "Mensajero" de `ordenesColumns` ya pinta `relaciones.mensajeroAsignado.nombre` con
  fallback `—`, así que **R2 sale gratis** con la variante de columnas por defecto.
- **`AsignarRecoleccionModal.tsx` (nuevo)**: copia reducida de `AsignarBodegaModal` — lista de
  remisiones + `Select` de mensajero + confirmar. **Sin** la fase "resultado" con
  `ManifiestoResultado`: el manifiesto de estas órdenes ya se emitió al crearlas (feature 155). Al
  éxito: toast + `onSuccess()` (que revalida todos los apartados por prefijo de key SWR).

### 5.2 Pieza B — el panel PROPIO del mensajero

**Qué se reemplaza y qué se reusa (delimitación exacta pedida por la puerta):**

| Elemento de `GestionarOrdenPanel` | En recolección |
| --- | --- |
| 4 botones de resultado + `RESULTADO_BOTONES` | **Fuera** (R16) |
| `METODO_PAGO_OPTIONS` / campo método de pago / `sinCobro` | **Fuera** (R16) |
| `CAUSA_DEVOLUCION_OPTIONS` / `CausaField` | **Fuera** (R16) |
| `EvidenciasField` + `comprimirImagen` + `MAX_EVIDENCIAS` | **Fuera** (R16) |
| `MotivoField`, `fechaReprogramacion`, `mananaCalendarioCR` | **Fuera** (R16) |
| `gestionarSchema` / Server Action `gestionar` | **Fuera** (R36: ni gestión ni dinero) |
| `VerificarGuiaGate` (verificar antes de gestionar) | **Fuera**: aquí el escaneo ES la acción |
| `escogerParaGestion` / `liberarGestion` / `ordenEnGestionId` / MODO FOCO | **Fuera** (R18) |
| `AsignacionDetalle` (detalle de ENTREGA: cobro, dirección de destino, notas de tienda) | **Fuera** (R13) |
| `ChatWhatsappPanel` / `EnviarPlantillaWhatsappButton` (hilo con el CLIENTE) | **Fuera**: el interlocutor de una recolección es la tienda |
| `NotaPrivadaMensajero` | **Fuera** (minimalismo; no hay gestión que anotar) |
| `ContactoButtons` | **Se reusa**, apuntando al teléfono de la TIENDA (R15) |
| `QrScanner` + `extractNumGuiaFromScan` + entrada manual | **Se reusa** (R17/R19/R20) |

**Componentes nuevos** (viven junto a la página; `docs/architecture.md` → "sin sobre-ingeniería":
un solo consumidor):

- `app/(app)/mis-asignaciones/_components/useRecolectarPorGuia.ts` — hook espejo de
  `useRecogerPorGuia`: resuelve `numGuia` contra la lista `porRecolectar` ya cargada (restricción
  "asignada a mí" en cliente, R21, con toast y **sin** llamar a la action), llama a
  `recolectarEnTiendaPorQr` y traduce los 8 resultados a toast (R23). Devuelve
  `{ recolectar, procesando }`.
- `app/(app)/mis-asignaciones/_components/RecoleccionTiendaPanel.tsx` — sección
  `aria-label="Por recolectar en tienda"` que contiene:
  1. banner con el conteo (`role="status"`), patrón `PorAceptarSection`;
  2. **un solo** bloque de acción para todo el apartado: `QrScanner` + input de número de guía +
     botón "Confirmar recolección" (dos vías equivalentes → misma action, R17). **No** hay botón
     por-tarjeta: la acción es escanear (decisión del humano);
  3. la lista **agrupada por `tiendaNombre`** (R14), con un encabezado por tienda que incluye el
     `ContactoButtons` de su teléfono (R15) y, debajo, una tarjeta por orden con guía, remisión,
     producto y destinatario (R13);
  4. con `bloqueado === true`: se renderiza (1), (3) y (4) pero **no** (2) (R24), igual que hace
     hoy el módulo con `InputRecoger`/`EscanerRecoger`.

- `MisAsignacionesModule.tsx` (modificado):
  - nuevo prop `porRecolectar: MiAsignacionDTO[]`;
  - renderiza `RecoleccionTiendaPanel` **encima** de "Por recoger", solo en la VISTA COMPLETA (el
    MODO FOCO es del flujo de gestión y no cambia: R25);
  - `porRecolectar` **no** entra en `unionAsignaciones` (fuente de opciones del filtro
    cantón/distrito) ni se le aplica `aplicarFiltroZona` (R40);
  - el buscador de guías (`filtrarAsignaciones`) **sí** se le aplica: buscar una guía por número es
    útil también recolectando;
  - `paradasMapa` y `porGestionarVisual` siguen derivando solo de `porGestionarFiltrado` (R39).
- `app/(app)/mis-asignaciones/page.tsx`: pasa `porRecolectar={result.porRecolectar}`. Sin más
  cambios (el rol y el bloqueo ya se resuelven ahí server-side).

### 5.3 Etiquetas de UI

`EstatusBadge` ya recibe su label y variante para `por_recolectar_en_tienda` de la **154**. 157 no
añade labels de estado. Los textos nuevos (títulos de apartado, toasts) se declaran como constantes
en el módulo que los usa, i18n-ready, siguiendo el patrón de `MisAsignacionesModule`. Nada de
siglas: se dice "Por recolectar en tienda", no jerga interna.

---

## 6. Contratos de entrada/salida (resumen)

| Operación | Entrada | Salida |
| --- | --- | --- |
| `asignarRecoleccion` (Server Action) | `{ ordenIds: uuid[]; mensajeroId: uuid }` | `ok{resultados:[{ordenId}]}` · `conflict{detalle:[{ordenId,motivo}]}` · `validation_error{fieldErrors}` · `forbidden` · `unauthenticated` |
| `recolectarEnTiendaPorQr` (Server Action) | `{ numGuia: int > 0 }` | `ok{ordenId,estado}` · `ya_recolectada` · `estado_invalido{estado}` · `no_encontrada` · `conflict{motivo}` · `validation_error{fieldErrors}` · `forbidden` · `unauthenticated` |
| `listarMisAsignaciones` (ampliada) | — | `ok{ porRecolectar, porRecoger, porGestionar, ordenEnGestionId, kpis, ruta }` · `forbidden` |

Integraciones externas: **ninguna**. Sin Meta, sin Shopify, sin WhatsApp, sin webhooks. La cámara es
`html5-qrcode` vía el `QrScanner` compartido, con import dinámico (nunca en SSR).

---

## 7. Concurrencia, idempotencia y atomicidad

| Escenario | Garantía | Dónde vive |
| --- | --- | --- |
| Dos escaneos del mismo QR | El segundo `updateMany` afecta 0 filas → re-lectura → `ya_recolectada`; una sola fila de historial | `recolectarEnTienda` (repo) + paso 9 del service |
| Escaneo mientras el maestro reasigna | El `where` incluye `mensajeroAsignadoId`; si cambió, 0 filas → `conflict` | `where` del `updateMany` |
| Lote de asignación con una orden ya movida | `count !== ordenIds.length` → `throw` → rollback: 0 órdenes asignadas | `asignarRecoleccionLote` |
| Transición + historial | Misma `$transaction`; el append solo si `count === 1` | patrón heredado de 138 |
| Guardia del grafo de estados | `appendCambioEstado` valida contra `TRANSICIONES` (fallo cerrado, feature 140) | choke point, sin cambios |

---

## 8. Alternativas descartadas

### 8.1 Reusar `GestionarOrdenPanel` con un modo `recoleccion` que oculte campos — DESCARTADA

Era la opción de menor diff aparente. Se descarta por tres razones concretas, verificadas en el
archivo (`GestionarOrdenPanel.tsx`, 761 líneas):

1. El panel es una **máquina de 3 pasos** (`detalle → resultados → formulario`) cuyo paso 1 termina
   obligatoriamente en `VerificarGuiaGate → onGestionarPedido → escogerParaGestion`, es decir, en el
   puntero 1-a-1. Una recolección necesita justo lo contrario: N confirmaciones seguidas sin
   escoger nada (R18). Un flag no "oculta" eso, lo cortocircuita.
2. Arrastra siete dependencias que en recolección no significan nada (`gestionarSchema`,
   `METODO_PAGO_OPTIONS`, `CAUSA_DEVOLUCION_OPTIONS`, `comprimirImagen`, `mananaCalendarioCR`,
   `ChatWhatsappPanel`, `AsignacionDetalle`). Cada una quedaría bajo un condicional, y **cada feature
   futura de gestión tendría que preguntarse si aplica a recolección** — empezando por la 158
   (incidente), que llega en el mismo lote.
3. El humano pidió explícitamente que el módulo de gestión CAMBIE para este caso. Un componente
   propio deja `GestionarOrdenPanel` literalmente intacto (R25) y hace que el reviewer pueda
   verificarlo con un diff vacío en ese archivo.

### 8.2 Modelar la recolección como un `resultado` más de `gestion_orden` — DESCARTADA

Habría dado "gratis" el historial, el cierre y el ranking. Se descarta porque `gestion_orden` es una
tabla **money-critical**: sus columnas (`monto_recibido`, `metodo_pago`, `pago_mensajero`,
`ingreso_bodega_rechazo`, `cierre_id`) alimentan el cierre del día, la wallet y el ranking. Meter
ahí una fila sin dinero exigiría (a) un value nuevo del enum `GestionResultado` con su
`ALTER TYPE ADD VALUE` **y la actualización de todos los `down.sql` previos que recrean el tipo**;
(b) `NULL`-ear media tabla; (c) auditar `computeTotales`, `derivarPagos`, `derivarIngresoBodega`,
`ESTADOS_ESPERADOS` del deshacer, `CierreDiaService`, `CierresAdminService` y
`RankingRepository` para que la ignoren. Una recolección no produce dinero: se modela como
**transición de estado con familia de historial propia** (`recoleccion_tienda`), que es exactamente
lo que la 154 dio de alta para esto.

### 8.3 Que la asignación transicione la orden a `por_recoger` (reusando `asignarDesdeBodega`) — DESCARTADA

Habría evitado el método de repo "asignar sin transicionar" (§4.4) y el roto del invariante de
`asignado_at` (§3.3). Se descarta porque `por_recoger` significa *"el paquete ya está en una bodega,
numerado, esperando que el mensajero lo acepte para salir a REPARTIR"*: su única salida es
`por_recoger → en_reparto` (arista #11, familia `recoleccion`). Reusarla (a) mezclaría en la misma
bandeja paquetes que están en la tienda con paquetes que están en bodega; (b) rompería el gate del
cierre, porque `por_recoger` **sí** está en `ESTADOS_PENDIENTES` (`CierreDiaService.ts:41`) y
bloquearía "Solicitar cierre" (contra R37); y (c) la arista aprobada por la 154 es
`por_recolectar_en_tienda → en_ruta_bodega_central`, no un rodeo por `por_recoger`.

### 8.4 Página dedicada `/recoleccion` para el escáner del mensajero — DESCARTADA

El mensajero ya vive en `mis-asignaciones` durante toda su jornada; una segunda pantalla le obliga a
navegar entre superficies para el mismo turno. Se sigue el precedente de la 138 (control dentro del
módulo que ya usa el rol) y de la 96 (escáner de recogida embebido en el propio apartado).

---

## 9. Trazabilidad requisito → artefacto

| Requisitos | Artefacto principal |
| --- | --- |
| R1, R2, R10 | `OrdenesRevisionMaestro.tsx` (+ `ordenesColumns` sin cambios) |
| R3–R9 | `GuiaAsignacionService.asignarRecoleccion` + `OrdenRepository.asignarRecoleccionLote` + `lib/actions/ordenes-guia.ts` |
| R11–R15, R21–R24 | `RecoleccionTiendaPanel.tsx`, `useRecolectarPorGuia.ts`, `MisAsignacionesModule.tsx` |
| R16–R18, R25 | Ausencia verificable: diff vacío en `GestionarOrdenPanel.tsx`; el panel nuevo no importa `gestionar` ni `escogerParaGestion` |
| R19, R20 | `extractNumGuiaFromScan` + `recolectarEnTiendaSchema` |
| R26–R35 | `RecoleccionTiendaService` + `OrdenRepository.recolectarEnTienda` + `lib/actions/recoleccion-tienda.ts` |
| R36, R37 | Ausencia verificable: sin escritura en `gestion_orden`; `ESTADOS_PENDIENTES` y `CorteDiarioService` no ganan el value nuevo |
| R38 | `RankingRepository` (ver Q1) |
| R39, R40 | `MisAsignacionesService.listarMisAsignaciones` + `MisAsignacionesModule` |

---

## 10. Riesgos

1. **Dependencia dura de la 154/155.** Sin `por_recolectar_en_tienda` en el catálogo ni
   `recoleccion_tienda` en el enum, esta feature no arranca. Mitigación: task de puerta 0 en
   `tasks.md`.
2. **Órdenes huérfanas.** Una orden asignada a un mensajero que nunca la recoge se queda en
   `por_recolectar_en_tienda` sin límite de tiempo. No hay cron de SLA para este estado. Ver pregunta
   abierta 6 de `requirements.md`.
3. **Ausencia de rastro de la asignación** (§4.4, Q3): hoy nadie podrá reconstruir quién asignó la
   recolección ni cuándo.

---

## 11. Preguntas abiertas

### Q1 (declarada abierta por el humano) — ¿cuenta la recolección en el cierre del día y en el ranking?

**Estudio del flujo, hecho antes de proponer:**

- **Cierre del día.** `CierreDiaService` bloquea "Solicitar cierre" con
  `contarOrdenesPendientesGestion(actor, ESTADOS_PENDIENTES)` donde
  `ESTADOS_PENDIENTES = ["por_recoger", "en_ruta"]` (`CierreDiaService.ts:41`). El detalle y los
  totales del cierre salen de `findGestionesPendientes`, es decir, de filas de `gestion_orden`. Una
  recolección no crea ninguna. ⇒ **Por defecto ya es invisible al cierre**, sin tocar nada.
- **Corte diario.** `CorteDiarioService` solo barre `en_ruta → sin_gestionar`
  (`CorteDiarioService.ts:20-21`). ⇒ **Ya es invisible**, sin tocar nada.
- **Ranking.** Aquí NO es invisible por defecto y ese es el hallazgo relevante:
  `RankingRepository.contarAsignadasPorMensajero` usa `orden.asignadoAt ∈ [hoy)` como
  **denominador**, y `contarEntregadasPorMensajero` cuenta `gestion_orden.resultado = 'entregada'`
  como numerador. Si la asignación de recolección estampara `asignado_at`, cada recolección **bajaría
  el porcentaje** del mensajero sin poder subirlo jamás.

**Propuesta (implementada como R38 y §3.3): invisible para ambos.** Se logra **no estampando
`asignado_at`** en `asignarRecoleccionLote`. Verificado que el único lector de esa columna en todo
`lib/` es `RankingRepository.ts:34` (el resto son escrituras), luego no hay consumidor que dependa
del invariante `mensajeroAsignadoId != null ⟹ asignadoAt != null`. Cuando la orden llegue a la
central y se le asigne mensajero para repartir, `asignarBodegaLote` estampa `asignado_at` en el
instante correcto y el ranking la cuenta entonces, una sola vez.

**Alternativas si el humano prefiere que SÍ cuente:**
(a) estampar `asignado_at` y aceptar la dilución del porcentaje;
(b) estampar `asignado_at` y añadir un numerador propio de recolecciones al ranking (cambia el
contrato del ranking y su UI, feature 76 — fuera del alcance de 157);
(c) filtrar el denominador por estado en la query — descartado técnicamente: la orden cambia de
estado apenas se recolecta, así que el filtro deja de aplicar el mismo día y el conteo se vuelve no
determinista.

**Pregunta al humano:** ¿confirmamos "invisible para cierre y ranking" (propuesta), o la recolección
debe pesar en el desempeño del mensajero y entonces entramos por (a) o (b)?

### Q2 — ¿La recolección debe bloquear el cierre del día?

Consecuencia directa de R37: un mensajero con 5 recolecciones asignadas sin recoger **puede** cerrar
su día. Es coherente con "no hay gestión ni dinero", pero deja el paquete en la tienda sin que nadie
lo note en el cierre. ¿Se acepta, o `por_recolectar_en_tienda` debe entrar en `ESTADOS_PENDIENTES`?
**Supuesto del diseño:** se acepta (no bloquea).

### Q3 — ¿La asignación de recolección necesita rastro de auditoría?

Por §4.4 no se escribe historial (no hay transición y el choke point de la 140 lo rechazaría). Queda
sin registro quién asignó la recolección y cuándo. Opciones: (a) aceptarlo — el primer rastro es la
transición de recolección, que sí registra actor y familia; (b) declarar en la 154/157 una arista
de auto-transición para poder registrarla (contamina el grafo); (c) tabla de auditoría de
asignaciones (fuera de alcance, y ninguna otra asignación del repo la tiene). **Supuesto:** (a).

### Q4 — Elegibilidad del mensajero y dirección de recogida

Ver preguntas abiertas 1 y 2 de `requirements.md`. Ambas afectan a este diseño: la 1 añadiría una
guardia de zona en el paso 4 de `asignarRecoleccion`; la 2 exigiría una columna nueva y por tanto
migración, que hoy este diseño declara innecesaria (§3.1).
