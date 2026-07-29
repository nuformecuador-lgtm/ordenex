# Feature 160 — Design

Decisiones técnicas del chip de intentos de entrega. Alcance estricto:
**exponer** un conteo que ya existe y **pintarlo**. No se re-deriva, no se
persiste, no se migra.

## 1. Modelo de datos

**Sin cambios.** No hay tabla nueva, columna nueva, enum nuevo ni migración.

- Fuente: `orden_historial_estado` (modelo `OrdenHistorialEstado`,
  `db/schema.prisma:1131`), append-only e inmutable.
- Índice: `@@index([ordenId, estatusDestinoId])` (`db/schema.prisma:1155`) ya
  existe y es exactamente el que sirve al filtro del conteo (`orden_id IN (...)`
  + `estatus_destino_id = devuelta`). El join a `gestion_orden` es por PK sobre
  un puñado de filas.
- RLS: `orden_historial_estado` ya tiene RLS habilitada **sin policies** (solo
  service-role). Las lecturas de esta feature ocurren server-side vía Prisma con
  el service role, igual que el conteo individual actual. **No se toca la RLS.**
- No hay backfill ni recomputación: el conteo se deriva en cada lectura (R13).

## 2. Contrato de datos (DTOs)

Dos DTO ganan el MISMO campo, aditivo y opcional (patrón `zonaEsGam?` /
`marcarLuego?`):

```ts
// lib/types/orden.ts — OrdenListItemDTO
/** Feature 160: intentos de entrega VIGENTES de la orden (destinos `devuelta`
 *  con gestión vigente), derivados del historial en el mismo lote del listado.
 *  Opcional (`?`) por el patrón aditivo de `zonaEsGam?`: no rompe fixtures/mocks
 *  que construyen el DTO sin él; el listado SIEMPRE lo envía (0 incluido). */
intentosEntrega?: number;
```

```ts
// lib/interfaces/services/IMisAsignacionesService.ts — MiAsignacionDTO
intentosEntrega?: number;   // misma semántica y mismo derivador
```

Reglas del contrato:

- `0` = sin intentos (valor legítimo, R7). `undefined` = superficie que no lo
  resuelve (otras proyecciones de `OrdenRepository` que también arman
  `OrdenListItemDTO`). La UI trata ambos igual: **sin chip** (R9).
- `OrdenDTO` (CRUD base) **no** gana el campo: el conteo es de listado, no del
  contrato de crear/obtener/actualizar. Mismo criterio con el que la feature 17
  dejó `mensajeroSugeridoId` fuera de `OrdenDTO`.

## 3. Backend — resolución EN LOTE

### 3.1 Predicado único compartido (clave de R3)

Hoy el predicado de "intento vigente" vive inline dentro de
`OrdenHistorialRepository.contarPorDestinoVigentes`
(`lib/repositories/OrdenHistorialRepository.ts:92-108`). Se **extrae** a una
función pura del mismo módulo y los DOS métodos la consumen:

```ts
// lib/repositories/OrdenHistorialRepository.ts (módulo, no exportado al mundo)
function whereVigentesPorDestino(
  ordenId: Prisma.OrdenHistorialEstadoWhereInput["ordenId"], // string | { in: string[] }
  estatusDestinoId: string,
): Prisma.OrdenHistorialEstadoWhereInput
```

El cuerpo es el `where` actual, sin cambios semánticos: rama 1
(`gestionOrdenId: null` + `origenTipo notIn ORIGEN_TIPOS_CON_GESTION`) y rama 2
(`gestion: { anuladaAt: null }`). Extraerlo es lo que impide que el conteo del
chip y el conteo que dispara `rechazada` → `cobroRechazado` (feature 56, dinero)
diverjan por copia-pega.

### 3.2 Nuevo método de repositorio

```ts
// lib/interfaces/repositories/IOrdenHistorialRepository.ts
/** Feature 160/R4: conteo de transiciones vigentes hacia `estatusDestinoId` para
 *  un LOTE de órdenes, en UNA sola consulta. Las órdenes sin filas NO aparecen en
 *  el Map (el llamador resuelve el default 0). `ids` vacío -> Map vacío sin query. */
contarPorDestinoVigentesEnLote(
  ordenIds: string[],
  estatusDestinoId: string,
): Promise<Map<string, number>>;
```

Implementación (patrón `OrdenRepository.findMensajerosBloqueados`, que devuelve
un `Set` a partir de un `findMany` con `in`):

```ts
if (ordenIds.length === 0) return new Map();          // R5
const rows = await this.prisma.ordenHistorialEstado.groupBy({
  by: ["ordenId"],
  where: whereVigentesPorDestino({ in: ordenIds }, estatusDestinoId),
  _count: { _all: true },
});
return new Map(rows.map((r) => [r.ordenId, r._count._all]));
```

- Una sola llamada a Prisma, con o sin resultados (R4).
- El delegate acotado del repo (`Pick<PrismaClient, "ordenHistorialEstado">`) ya
  expone `groupBy`; los mocks unitarios existentes deben ganar esa propiedad.
- **Fallback admitido** si `groupBy` con filtro de relación diera problemas en la
  versión de Prisma del repo: `findMany({ select: { ordenId: true }, where: <el
  mismo predicado> })` + conteo en memoria. Sigue siendo **una** consulta y el
  mismo `whereVigentesPorDestino`; el test de R4 (1 sola llamada) vale para
  ambas formas.

### 3.3 Nuevo método de servicio (dueño de "qué destino es un intento")

```ts
// lib/interfaces/services/IOrdenHistorialService.ts
/** Feature 160/R4/R6: intentos por orden para un LOTE. Resuelve UNA vez el id de
 *  `devuelta` y devuelve un Map ordenId -> intentos (las órdenes sin intentos no
 *  aparecen; el llamador usa 0). Catálogo sin `devuelta` -> Map vacío. */
contarIntentosEnLote(ordenIds: string[]): Promise<Map<string, number>>;
```

`OrdenHistorialService` sigue siendo el ÚNICO módulo que conoce la constante
`ESTATUS_DEVUELTA`. `contarIntentos(ordenId)` queda intacto (features 47/99
siguen llamándolo); el método nuevo es su versión en lote.

### 3.4 Punto de merge — listado de órdenes

`OrdenService.listar` (`lib/services/OrdenService.ts:136`) hace el merge después
de `repo.list`, sobre los items YA acotados por rol (R12):

```ts
const { items, total } = await this.repo.list({...});
const intentos = await this.historial.contarIntentosEnLote(items.map((i) => i.id));
return {
  status: "ok",
  items: items.map((i) => ({ ...i, intentosEntrega: intentos.get(i.id) ?? 0 })), // R7
  page, pageSize, total,
};
```

Dependencia nueva del constructor:

```ts
constructor(
  private readonly repo: IOrdenRepository,
  private readonly historial: Pick<IOrdenHistorialService, "contarIntentosEnLote">,
) {}
```

- **Requerida, no opcional.** Una dep opcional dejaría que el wiring de producción
  se olvide de pasarla y que el chip desaparezca en silencio; con el parámetro
  requerido el compilador lo impide. Coste: 18 construcciones `new OrdenService(repo)`
  en 2 archivos de test (`tests/unit/services/orden-service.test.ts`,
  `tests/unit/services/rol-admin-satelite-authz.test.ts`) que pasan a recibir un
  stub `{ contarIntentosEnLote: async () => new Map() }`. Es mecánico y explícito;
  es el mismo camino que tomó la feature 115/116 al sumar `metaRepo` a
  `MisAsignacionesService`.
- **Sin ciclo de módulos:** `OrdenService` importa SOLO el tipo
  `IOrdenHistorialService` (import type), y `OrdenHistorialService` depende de
  `IOrdenRepository`/`IOrdenHistorialRepository`, nunca de `IOrdenService`.
- Wiring: `lib/actions/ordenes.ts > buildOrdenService()` construye
  `new OrdenService(new OrdenRepository(prisma), new OrdenHistorialService(new
  OrdenRepository(prisma), new OrdenHistorialRepository(prisma)))`, réplica del
  wiring que ya vive en `lib/actions/orden-historial.ts:31-37`.

Coste por página: `list` + `count` (ya existentes) + 1 lectura del catálogo
`order_status` (tabla diminuta, ya se hace en varios flujos) + 1 `groupBy`
indexado. **Ninguna consulta depende de N** (R4).

### 3.5 Punto de merge — portal del mensajero

`MisAsignacionesService.listarMisAsignaciones`
(`lib/services/MisAsignacionesService.ts:120`) ya hace exactamente este patrón
con `findMarcarLuegoByMensajero` (Set) y `findNotasByMensajero` (Map). Se suma
una llamada más, después del `Promise.all` (necesita los ids de `rows`):

```ts
const intentos = await this.historial.contarIntentosEnLote(rows.map((r) => r.id));
// dentro del for: intentosEntrega: intentos.get(row.id) ?? 0
```

Misma dep nueva (`Pick<IOrdenHistorialService, "contarIntentosEnLote">`) en el
constructor. Aplica a los DOS grupos: una orden "por recoger" puede venir de una
recuperación tras un intento fallido, y ese dato es justamente el que el
mensajero necesita ver antes de salir.

## 4. Frontend

### 4.1 Chip del listado de órdenes

- Archivo: `app/(app)/ordenes/_components/ordenes-columns.tsx`.
- **Ubicación: dentro de la celda de la columna `estatus`**, junto al
  `EstatusBadge`, en un contenedor `flex flex-wrap items-center gap-1`. NO se
  agrega columna (R11).
- Render condicional: `(row.intentosEntrega ?? 0) >= 1` (R9). Con 0 o `undefined`
  la celda queda EXACTAMENTE como hoy.
- Contenido: `1 intento` / `${n} intentos` (singular/plural).
- Accesibilidad: `aria-label={`Intentos de entrega: ${n}`}`, `role="status"`
  (mismo tratamiento que el badge del drawer,
  `HistorialOrdenSheet.tsx:169-178`).
- Primitiva: `Badge` de `components/ui/badge.tsx` con `variant="warning"`
  (tokens `-soft`/`-strong`, contraste ≥ 4.5:1 y modo oscuro ya resueltos). El
  drawer usa `secondary`; aquí la señal debe destacar en una tabla densa de 17
  columnas. Ver Q3 si se prefiere unificar.
- Herencia gratis: `ordenesColumnsAdminTienda`
  (`app/(app)/_components/ordenes-columns-admin-tienda.ts`) deriva de
  `ordenesColumns` filtrando ids y NO oculta `estatus`, así que el dashboard de
  la tienda recibe el chip sin tocar ese archivo. Igual para
  `ordenesColumnsMensajeroSugerido` y `ordenesColumnsReprogramada`, que derivan
  del mismo array.

### 4.2 Chip de la card del mensajero

- Archivo: `app/(app)/mis-asignaciones/_components/pos-card/PosOrderCard.tsx`.
- Se suma a la fila de marcas informativas existente (`flex flex-wrap gap-1.5`,
  líneas 71-84), donde ya conviven "Pendiente de optimizar" y "Gestionar más
  tarde". La guarda del contenedor pasa a incluir `(orden.intentosEntrega ?? 0) >= 1`.
- Mismo texto, mismo `aria-label`, misma variante que 4.1: una sola definición
  visual. Como el chip se usa en DOS features distintas con la misma API,
  `docs/architecture.md > Regla: sin sobre-ingeniería` habilita (y pide)
  promoverlo a un componente compartido:
  `components/shared/IntentosEntregaBadge.tsx`, de presentación pura
  (`{ intentos: number }`, devuelve `null` si `< 1`). Las dos superficies lo
  consumen; la regla de ocultamiento vive en UN solo sitio y R9/R10 se testean
  una vez sobre el componente y una vez sobre cada superficie.

### 4.3 Fuera de alcance (frontend)

`/recepcion-satelite` y la revisión del maestro consumen otros DTO
(`RecepcionSateliteDTO` y proyecciones propias) y quedan fuera (ver Q4). El
drawer de historial (feature 47) no se toca (R14).

## 5. Rutas / endpoints / contratos I/O

- **No hay endpoint nuevo, ni route handler, ni Server Action nueva.** Las
  superficies afectadas ya se sirven por Server Actions existentes:
  `listarOrdenes` (`lib/actions/ordenes.ts:69`) y la acción de listar
  asignaciones del mensajero.
- El cambio de contrato I/O es ADITIVO en el payload de esas acciones: un entero
  opcional por item. Sin cambios de validación zod (no hay entrada nueva del
  cliente; el conteo es 100% derivado en servidor).
- No hay integración externa involucrada (ni Supabase Storage, ni WhatsApp, ni
  Meta, ni Shopify).

## 6. Alternativas descartadas

### 6.1 (DESCARTADA) Resolver el conteo dentro de `OrdenRepository.list` con un conteo de relación filtrado

Prisma permite `_count: { select: { historial: { where: {...} } } }` dentro del
`include` del listado: **una sola query total**, sin roundtrip extra.

Se descarta porque:

1. Mete el predicado de vigencia (propiedad de las features 49/67, hoy encapsulado
   en `OrdenHistorialRepository`) dentro de `OrdenRepository`, creando la SEGUNDA
   definición del criterio que R3 prohíbe. El comentario de
   `OrdenHistorialService.contarIntentos` es explícito: ese punto único es el que
   garantiza que la línea de tiempo y la regla de escalado no diverjan.
2. Obliga a `OrdenRepository` a resolver el id de `devuelta` para poder armar el
   filtro, es decir, a conocer qué estado "es un intento" — decisión de negocio en
   la capa de datos.
3. Encarece TODOS los llamadores de `list` (listado del maestro, dashboard de la
   tienda, listado acotado del mensajero, y cualquier consumidor futuro), incluso
   los que no pintan el chip, sin forma de apagarlo.

El coste que evita (un roundtrip por página, indexado) es despreciable frente a
la deuda de acoplamiento.

### 6.2 (DESCARTADA) Columna materializada `orden.intentos_entrega`

Un contador persistido en `orden`, incrementado en cada transición a `devuelta`.
Lectura O(1) y sin joins.

Se descarta porque:

1. Exige migración, y la feature es explícitamente "sin migración" (R13).
2. Es **incorrecto** con el modelo vigente: la vigencia de un intento no es un
   evento monotónico. Anular una gestión (feature 67) DESCUENTA intentos sin
   escribir en el historial (es un filtro de LECTURA sobre `gestion.anulada_at`),
   y las filas huérfanas dejan de contar. Un contador incremental se
   desincronizaría en silencio, y ese número dispara `rechazada` →
   `cobroRechazado` (feature 56): drift = dinero mal cobrado.
3. Crearía una segunda fuente de verdad para el mismo hecho, justo lo que la 67
   se encargó de evitar.

### 6.3 (DESCARTADA) Columna dedicada "Intentos" en la tabla del listado

Una `Column` nueva en `ordenesColumns`.

Se descarta porque la tabla ya tiene 17 columnas y scroll horizontal; una columna
que está vacía en la gran mayoría de filas (el conteo típico es 0) paga ancho
permanente por información esporádica, obliga a inventar copia de celda vacía —en
tensión con R9— y se cuela en todas las variantes derivadas
(`ordenesColumnsAdminTienda`, `...MensajeroSugerido`, `...Reprogramada`), con la
regresión asegurada del test que afirma
`ordenesColumnsReprogramada.length === ordenesColumns.length + 1`. El chip dentro
de la celda de estado entrega la misma información donde el ojo ya está mirando y
cumple R11.

### 6.4 (DESCARTADA) Una llamada a `contarIntentos(ordenId)` por fila

Es la implementación "obvia" y reusaría el código existente sin tocar nada.
Se descarta porque es un N+1 sobre un listado paginado en servidor: con
`pageSize` por defecto son decenas de queries por render, más la lectura del
catálogo repetida. La ficha de la feature lo declara fallo de la feature, y R4 lo
prohíbe explícitamente.

## 7. Preguntas abiertas (puerta F1.4)

**Q1 — ¿El intento cuenta solo destino `devuelta` (como hoy) o también
`reprogramada`?**

*Recomendación: SOLO `devuelta`; no tocar el derivador.*

1. Este número no es un adorno de UI: es el MISMO que gobierna la regla de
   reintento-vs-escalado del cron SLA (feature 99) y, por esa vía, el disparo de
   `rechazada` → `cobroRechazado` (feature 56, dinero real). Ampliar el criterio
   desde una feature de chip cambiaría la regla legal de reintentos por un efecto
   colateral.
2. Semánticamente son cosas distintas: `devuelta` es una entrega FALLIDA;
   `reprogramada` es un aplazamiento ACORDADO con el destinatario. Contar un
   acuerdo como fallo acerca la orden al rechazo sin que nadie haya fallado.
3. Contaría doble en el flujo real: la feature 100 crea `reprogramada` DESDE
   `devuelta` (`origen_tipo = reprogramacion_tienda`), así que ese hecho ya está
   contado una vez como `devuelta`; sumar el destino `reprogramada` inflaría el
   conteo de la misma orden.
4. Si el negocio quiere "visitas totales" (devuelta + reprogramada), es una
   MÉTRICA distinta y merece campo propio y feature propia, no una redefinición
   del derivador compartido.

**Q2 — ¿El estado nuevo `incidente` (feature 158) cuenta como intento?**

*Recomendación: NO.*

1. Es TERMINAL: la orden no vuelve a bodega ni entra al flujo de devolución. Un
   "intento" cuya función es medir cuánto falta para escalar no tiene sentido en
   una orden que ya no puede reintentarse; además la 158 la resuelve
   indemnizando.
2. Contarlo contaminaría la regla de escalado sin ningún consumidor que se
   beneficie (una orden en `incidente` nunca llega al cron SLA de devueltas).
3. Mecánicamente, "no" es el comportamiento POR DEFECTO: el derivador cuenta
   destino `devuelta`, e `incidente` es otro destino. La recomendación **no
   requiere código**, y por eso la 160 no depende de la 158 ni del orden de
   merge. La respuesta contraria sí exigiría tocar el derivador compartido, con
   las mismas objeciones de Q1.

**Q3 — ¿El chip muestra el umbral ("Intento 2 de 3") como el drawer, o solo el
número?**

*Recomendación: solo el número (`2 intentos`).* El umbral vive en
`lib/config/reintentos.ts` leyendo `process.env.REINTENTOS_MIN_INTENTOS`, que NO
está disponible en el bundle del cliente (no es `NEXT_PUBLIC_`): mostrar "de N"
obligaría a inyectar el umbral en el payload del listado y de las asignaciones,
ampliando dos contratos por un adorno. El "de N" sigue disponible a un clic, en
el drawer de historial (feature 47), que es donde el usuario va a decidir. Si el
humano prefiere unificar, la variante barata es fijar el chip a
`variant="secondary"` (igual que el drawer) sin tocar el contrato.

**Q4 — ¿El chip llega también a `/recepcion-satelite` y a la revisión del
maestro?**

*Recomendación: no en esta feature.* Esas superficies consumen DTO propios
(`RecepcionSateliteDTO` y proyecciones específicas de `OrdenRepository`), así que
cada una implicaría su propio merge en lote y su propio contrato. El alcance
declarado son las dos superficies de la ficha (listado de órdenes y card del
mensajero). Extenderlo después es trivial: `contarIntentosEnLote` ya queda
disponible como pieza reutilizable.

## 8. Verificación

- `./init.sh` en verde.
- Suite completa en verde, con foco en: unit de `OrdenHistorialRepository`
  (predicado compartido + 1 sola query + lote vacío), unit de
  `OrdenHistorialService` (catálogo ausente → 0), unit de `OrdenService.listar` y
  de `MisAsignacionesService` (merge y default 0), y component tests de las dos
  superficies (chip visible con ≥1, ausente con 0/undefined).
- Sin migración pendiente ni drift de `schema.prisma`.
