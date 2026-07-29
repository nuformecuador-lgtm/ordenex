# Feature 160 — Design

Decisiones técnicas de **el criterio de intento de entrega, su efecto sobre el
escalado automático, y su exposición en todas las superficies de la orden**.

> **Reescrito el 2026-07-29.** La versión anterior de este documento diseñaba una
> feature ADITIVA de dos superficies que "no redefinía ninguna regla de negocio".
> Las respuestas de la puerta F1.4 invalidaron esa premisa: D1 y D2 cambian el
> derivador compartido que gobierna dinero, y D4 multiplica las superficies por
> cinco. Lo que sigue es el diseño del alcance real.

## 0. Qué cambió respecto de la versión anterior

| Antes | Ahora | Origen |
| --- | --- | --- |
| Intento = destino `devuelta` | Intento = destino `devuelta` **o** destino `reprogramada` con familia `gestion` | D1 + matiz verificado |
| "No cambia el cron SLA ni el drawer" | El cron SLA y el drawer **cambian**: es el punto de la feature | D2 |
| 2 superficies (listado + card del mensajero) | **11 superficies** sobre **7 DTO** distintos, incluido un descargable | D4 |
| Complejidad `low`, feature aditiva | Complejidad **`high`**, feature que toca dinero con efecto retroactivo | D1 + D2 + D4 |
| `incidente` fuera "por defecto" | `incidente` fuera **y terminal**; `indemnizada` descartado y no se deja preparado | D3 |
| Chip sin umbral | Sin cambio | D5 |

**Corrección de una afirmación del spec anterior:** su §4.1 hablaba de
`ordenesColumnsMensajeroSugerido` como variante derivada. **No existe** en la
rama: `ordenes-columns.tsx` solo exporta `ordenesColumns` y
`ordenesColumnsReprogramada`, y la única otra derivada es
`ordenesColumnsAdminTienda` (`app/(app)/_components/ordenes-columns-admin-tienda.ts`).

## 1. El criterio nuevo, con su evidencia

### 1.1 Definición

Una fila de `orden_historial_estado` cuenta como **intento de entrega** si es
VIGENTE (predicado de las features 46/47/67, sin cambios) **y** además:

```
(destino = devuelta)                                  -- rama A, la de hoy
OR
(destino = reprogramada AND origen_tipo = 'gestion')  -- rama B, la que agrega D1
```

### 1.2 Por qué la rama B se filtra por `origen_tipo = 'gestion'`

El mapa cerrado de la feature 140 (`lib/types/order-status-transiciones.ts`)
tiene **exactamente dos** aristas con destino `reprogramada`:

| Arista | Par | Familia | Rol | ¿Es una visita? |
| --- | --- | --- | --- | --- |
| `#13` (`:86`) | `en_reparto → reprogramada` | `gestion` | mensajero | **Sí.** Fue, no entregó, acordó fecha. |
| `#22` (`:106`) | `devuelta → reprogramada` | `reprogramacion_tienda` | adminTienda | No. Trámite de escritorio sobre una orden ya devuelta. |

**El doble conteo de `#22` está verificado, no supuesto.**
`GestionOrdenRepository.reprogramarDesdeDevuelta` (`:384-443`) hace UPDATE de
estado, crea una gestión sintética `resultado = reprogramada` y appendea la
transición — pero **nunca anula la gestión `devuelta` anterior**. Esa gestión
sigue con `anulada_at IS NULL`, así que su fila de historial (destino `devuelta`)
sigue siendo vigente y sigue contando. Contar además la fila `reprogramada`
contaría el mismo hecho dos veces. El objetor #3 del spec anterior era correcto
**solo para `#22`**; el error fue aplicarlo también a `#13`.

`deshacer_gestion` es la otra familia de `ORIGEN_TIPOS_CON_GESTION`, pero su
único destino declarado es `en_reparto`: nunca produce `reprogramada`. Por tanto
`destino = reprogramada AND origen_tipo = 'gestion'` ≡ arista `#13` exactamente.

### 1.3 Por qué INCLUSIÓN y no EXCLUSIÓN

Se pudo escribir la rama B como `destino = reprogramada AND origen_tipo NOT IN
('reprogramacion_tienda')`. **Se descarta**: con una lista de exclusión,
cualquier familia FUTURA que produzca `reprogramada` empieza a contar sola,
sube el conteo, adelanta el escalado y cobra un rechazo antes de tiempo — en
silencio. Con la lista de inclusión, una familia nueva **no cuenta** hasta que
alguien lo decida explícitamente. Contar de menos retrasa el escalado
(inofensivo); contar de más es dinero mal cobrado. Es el mismo razonamiento con
el que la feature 67 resolvió las filas huérfanas
(`OrdenHistorialRepository.ts:84-90`).

Consecuencia declarada (QA7): una fila LEGADA con destino `reprogramada` y origen
`ajuste_estado` —posible antes de la guardia de la 140— **no** contará. Es
deliberado.

### 1.4 La rama A no se toca

La rama A conserva su comportamiento exacto de hoy: cuenta cualquier `origen_tipo`
con destino `devuelta`, incluidas las transiciones que nunca vinieron de una
gestión (`ajuste_estado`, feature 67/R25). Endurecerla también reduciría conteos y
retrasaría escalados: no lo pidió nadie y no entra.

### 1.5 `incidente` (D3)

`incidente` no es destino de ninguna rama de R1, así que **no cuenta sin escribir
una línea de código**: es el comportamiento por defecto del criterio. La 160 **no
depende de la 158** ni del orden de merge. Y no se declara, referencia ni deja
preparado ningún estado `indemnizada`: la decisión de descartarlo se respeta al
nivel de que este documento no lo menciona más que aquí.

## 2. Modelo de datos

**Sin tabla nueva, sin columna nueva, sin enum nuevo, sin índice nuevo, sin
migración.**

- Fuente: `orden_historial_estado` (`db/schema.prisma:1128-1154`), append-only e
  inmutable. La exclusión de intentos anulados es un filtro de LECTURA.
- **RLS:** ya habilitada sin policies (solo service-role). Las lecturas ocurren
  server-side vía Prisma con el service role, igual que hoy. **No se toca.**
- **Índice — evaluado explícitamente, como pide el encargo.** El filtro nuevo es:

  ```
  orden_id IN (...)  AND  estatus_destino_id IN (devueltaId, reprogramadaId)
                     AND  <residual: origen_tipo / anulada_at>
  ```

  `@@index([ordenId, estatusDestinoId])` (`db/schema.prisma:1152`) **sigue
  sirviendo**: las dos columnas del índice son exactamente las dos del predicado
  selectivo, y el paso de `= devueltaId` a `IN (2 valores)` es un scan de dos
  rangos del mismo índice, no un seq scan. `origen_tipo` y `gestion.anulada_at`
  quedan como filtros **residuales** sobre el puñado de filas ya recuperadas (una
  orden acumula unidades de filas de historial, no miles), y el join a
  `gestion_orden` es por PK.

  **Conclusión: NO hace falta índice nuevo, por lo tanto NO hay migración.** Si en
  la implementación apareciera evidencia contraria (un `EXPLAIN` que muestre seq
  scan), eso **es** una migración y contradice el encargo: se detiene y se
  escala como decisión, no se añade un índice por su cuenta.

## 3. Backend

### 3.1 Fuente única del criterio (clave de R4)

`lib/types/orden-historial.ts` ya es el hogar documentado de "qué cuenta y qué no
como intento" (bloques de las features 49/67/99/100/109/138/139). Ahí se declara
la familia admitida por la rama B, con el mismo patrón `satisfies` que rompe el
build si el enum cambia:

```ts
// Feature 160 (D1) — familias de origen que, con destino `reprogramada`, cuentan
// como INTENTO. Lista de INCLUSION a proposito (design §1.3): una familia nueva NO
// cuenta hasta que se agregue aqui explicitamente. `reprogramacion_tienda` queda
// FUERA porque la fila `devuelta` de esa misma orden sigue vigente y ya conto ese
// intento (`reprogramarDesdeDevuelta` no anula la gestion previa).
export const ORIGEN_TIPOS_REPROGRAMADA_INTENTO = [
  "gestion",
] as const satisfies readonly OrdenHistorialOrigenTipo[];
```

Los bloques de comentario de la 99/100/109/138/139 de ese archivo afirman hoy
"destino != `devuelta` → no altera `contarIntentos`". **Esa afirmación deja de ser
suficiente** y hay que corregirla en el mismo commit: el criterio pasa a ser
"destino ∉ {`devuelta`} y no (destino = `reprogramada` ∧ origen = `gestion`)".
Verificado que ninguno de esos valores produce `reprogramada`, así que la
conclusión ("no altera el conteo") sigue siendo cierta para todos ellos; lo que
cambia es la razón, y el comentario tiene que decirlo o el próximo lector
razonará mal.

### 3.2 Predicado compartido en el repositorio

Hoy el `where` vive inline en `contarPorDestinoVigentes`
(`lib/repositories/OrdenHistorialRepository.ts:92-108`). Se extrae a una función
pura del módulo y **los dos métodos de conteo la consumen**:

```ts
/** Ids de catalogo del criterio (§1.1). `reprogramadaId: null` -> solo rama A (R6). */
export interface CriterioIntento {
  devueltaId: string;
  reprogramadaId: string | null;
}

function whereIntentosVigentes(
  ordenId: Prisma.OrdenHistorialEstadoWhereInput["ordenId"], // string | { in: string[] }
  criterio: CriterioIntento,
): Prisma.OrdenHistorialEstadoWhereInput
```

Cuerpo: `AND` de (1) `ordenId`, (2) el `OR` de destinos del criterio —rama A
`{ estatusDestinoId: devueltaId }`, rama B `{ estatusDestinoId: reprogramadaId,
origenTipo: { in: [...ORIGEN_TIPOS_REPROGRAMADA_INTENTO] } }`, esta última
omitida si `reprogramadaId === null`— y (3) el `OR` de VIGENCIA **exactamente
como hoy**: `{ gestionOrdenId: null, origenTipo: { notIn:
[...ORIGEN_TIPOS_CON_GESTION] } }` o `{ gestion: { anuladaAt: null } }`.

Extraerlo es lo que impide que el chip y el número que dispara `rechazada` →
`cobroRechazado` diverjan por copia-pega.

### 3.3 Interfaz del repositorio

`contarPorDestinoVigentes(ordenId, estatusDestinoId)` **se renombra** a
`contarIntentosVigentes(ordenId, criterio)` y gana su gemelo en lote:

```ts
// lib/interfaces/repositories/IOrdenHistorialRepository.ts
contarIntentosVigentes(ordenId: string, criterio: CriterioIntento): Promise<number>;

/** Feature 160/R12: conteo para un LOTE, en UNA sola consulta. Las ordenes sin filas
 *  NO aparecen en el Map (el llamador resuelve el default 0). `ids` vacio -> Map vacio
 *  SIN query (R13). */
contarIntentosVigentesEnLote(
  ordenIds: string[],
  criterio: CriterioIntento,
): Promise<Map<string, number>>;
```

**Se renombra y no se conserva el nombre viejo a propósito.** El método ya no
cuenta "por destino": cuenta intentos según un criterio compuesto. Dejar el
nombre viejo invitaría a un call-site futuro a pasarle un destino suelto y
obtener un número que no es el que gobierna el dinero. El coste es mecánico
(1 llamador de producción + sus dobles de test) y el diff queda auditable.

Implementación del lote (patrón `OrdenRepository.findMensajerosBloqueados`, que
devuelve un `Set` desde un `findMany` con `in`):

```ts
if (ordenIds.length === 0) return new Map();            // R13
const rows = await this.prisma.ordenHistorialEstado.groupBy({
  by: ["ordenId"],
  where: whereIntentosVigentes({ in: ordenIds }, criterio),
  _count: { _all: true },
});
return new Map(rows.map((r) => [r.ordenId, r._count._all]));
```

Fallback admitido si `groupBy` con filtro de relación diera problemas en la
versión de Prisma del repo: `findMany({ select: { ordenId: true }, where: <el
mismo predicado> })` + conteo en memoria. Sigue siendo **una** consulta y el
**mismo** `whereIntentosVigentes`; el test de R12 vale para las dos formas.

### 3.4 Servicio dueño de "qué estados son un intento"

`OrdenHistorialService` sigue siendo el ÚNICO módulo que conoce los `value` del
catálogo. Resuelve el criterio **una vez** por llamada:

```ts
const ESTATUS_DEVUELTA = "devuelta";
const ESTATUS_REPROGRAMADA = "reprogramada";   // feature 160/D1

private async resolverCriterio(): Promise<CriterioIntento | null> {
  const [devueltaId, reprogramadaId] = await Promise.all([
    this.ordenRepo.findEstatusIdByValue(ESTATUS_DEVUELTA),
    this.ordenRepo.findEstatusIdByValue(ESTATUS_REPROGRAMADA),
  ]);
  if (devueltaId === null) return null;        // R6: sin `devuelta` no hay conteo
  return { devueltaId, reprogramadaId };       // `reprogramadaId` null -> solo rama A
}

contarIntentos(ordenId: string): Promise<number>                       // firma intacta
contarIntentosEnLote(ordenIds: string[]): Promise<Map<string, number>> // nuevo (R12)
```

`contarIntentos` conserva su firma porque `DevolucionSlaService` la consume por
`Pick<IOrdenHistorialService, "contarIntentos">` (`DevolucionSlaService.ts:33`) y
`obtenerHistorial` la llama internamente (`:51`). **Lo que cambia es lo que
devuelve**, que es exactamente el punto de D2.

### 3.5 Los 7 puntos de merge en lote

Cada servicio de lectura recibe `Pick<IOrdenHistorialService,
"contarIntentosEnLote">` como dependencia **requerida** de constructor (no
opcional: una dep opcional deja que el wiring de producción se la olvide y el
chip desaparezca en silencio; requerida, el compilador lo impide) y hace el merge
sobre los items **ya acotados por rol/zona/tienda** (R15).

| # | Servicio | Método | DTO | Nota |
| --- | --- | --- | --- | --- |
| 1 | `OrdenService` | `listar` | `OrdenListItemDTO` | alimenta 4 superficies de UI |
| 2 | `MisAsignacionesService` | `listarMisAsignaciones` | `MiAsignacionDTO` | ambos grupos; ya tiene el patrón `findMarcarLuegoByMensajero`/`findNotasByMensajero` |
| 3 | `RecepcionSateliteService` | `listar` | `RecepcionSateliteDTO` | **un solo lote para los 5 grupos** (por recibir, recibidas, por devolver, en tránsito, devueltas) |
| 4 | `NovedadesService` | listado de novedades | `NovedadDTO` | |
| 5 | `RechazosSlaTiendaService` | listado de rechazos SLA | `RechazoSlaTiendaDTO` | |
| 6 | `LiberacionReprogramadaService` | liberadas hoy | `LiberadaHoyRow` | |
| 7 | `ManifiestoService` | filas del manifiesto | `ManifiestoFilaDTO` | descargable (R27) |

Forma del merge, idéntica en los 7:

```ts
const intentos = await this.historial.contarIntentosEnLote(rows.map((r) => r.id));
// ... intentosEntrega: intentos.get(row.id) ?? 0        // R14
```

En el caso 3 el lote se arma **una vez** con la unión de los ids de los cinco
grupos: son cinco proyecciones del mismo `RecepcionSateliteDTO` resueltas en la
misma llamada, y cinco consultas al historial por página serían un
incumplimiento gratuito de R12.

**Sin ciclo de módulos:** cada servicio importa SOLO el tipo
`IOrdenHistorialService` (`import type`); `OrdenHistorialService` depende de
`IOrdenRepository`/`IOrdenHistorialRepository` y nunca de los servicios de lista.

**Coste por página:** 2 lecturas del catálogo `order_status` (tabla diminuta) + 1
`groupBy` indexado. **Ninguna consulta depende de N.**

**Peaje de fixtures declarado:** siete constructores nuevos significan tocar los
dobles de test de siete suites (`orden-service`, `rol-admin-satelite-authz`,
`mis-asignaciones`, `recepcion-satelite`, `novedades`, `rechazos-sla-tienda`,
`manifiesto`). Es mecánico y visible; es el mismo camino que tomaron las features
115/116 al sumar `metaRepo` a `MisAsignacionesService`. La deuda "fakes de
repositorio a mano y duplicados" de `progress/current.md` se va a notar aquí.

### 3.6 Contrato de los DTO

Los 6 DTO internos ganan el MISMO campo, aditivo y opcional (patrón `zonaEsGam?`
/ `marcarLuego?` / `prioridad?`):

```ts
/** Feature 160: intentos de entrega VIGENTES de la orden (criterio unico de
 *  `OrdenHistorialService`, design §1.1), derivados del historial en el mismo lote
 *  de la lectura. Opcional (`?`) por el patron aditivo del repo: no rompe
 *  fixtures/mocks que construyen el DTO sin el; el servicio SIEMPRE lo envia (0
 *  incluido). `0` y `undefined` se pintan igual: SIN chip (R18). */
intentosEntrega?: number;
```

- `OrdenListItemDTO` · `MiAsignacionDTO` · `RecepcionSateliteDTO` · `NovedadDTO` ·
  `RechazoSlaTiendaDTO` · `LiberadaHoyRow`.
- `ManifiestoFilaDTO` lo lleva **NO opcional** (`intentos: number`): ese DTO tiene
  la regla contraria (feature 148/R11 enumera sus propiedades una a una a
  propósito, para que el archivo no filtre ni omita campos en silencio). Ver QA3.
- `OrdenDTO` (CRUD base) **no** gana el campo: el conteo es de lectura de listas,
  no del contrato de crear/obtener/actualizar.
- `ApiOrdenListItemDTO` / `ApiOrdenDetalleDTO` **no** ganan el campo (R29). El
  canal integrador se sirve de `listByOwner` → `ApiOrdenRow`, una proyección
  distinta: no hay riesgo de fuga por herencia.
- `EtiquetaGuiaDTO` **no** gana el campo (R28).

## 4. Dinero y retroactividad — la parte que hay que leer despacio

### 4.1 Qué órdenes cambian de comportamiento

La cadena es: `contarIntentos` → `DevolucionSlaService.ejecutar` → `escalar()` →
transición `devuelta → rechazada` con gestión sintética → concepto
`cobroRechazado` de la tarifa de zona (feature 56) al aprobar el cierre.

Filtrando por lo que el cron **realmente** hace
(`DevolucionSlaService.ts:88-137` y `DevolucionSlaRepository.findDevueltasSla`):

1. Solo entran órdenes **que reposan en `devuelta`**, no borradas, con gestión
   `devuelta` VIGENTE. Una orden en `reprogramada` **no es candidata**: el cron no
   la mira. → La ampliación **no** agrega órdenes al universo del cron.
2. De esas, las de causa `wrong_number`/`wrong_address` **escalan directo** sin
   consultar el conteo (`:128-133`). → **No cambian.**
3. Las de causa `null` se omiten. → **No cambian.**
4. **Solo cambia** la rama `not_found` con ventana de 24 h vencida (`:108-127`),
   que es la única que compara `intentos >= umbral`.

**El conjunto que cambia de comportamiento es, por tanto:** órdenes que reposan
en `devuelta`, con causa `not_found`, ventana vencida, y con **≥1 transición
vigente `en_reparto → reprogramada` de familia `gestion`**, tales que
`conteo_nuevo >= umbral` y `conteo_viejo < umbral`.

Con el umbral por defecto (3): una orden con 2 reprogramaciones del mensajero y 1
devuelta pasa de `intentos = 1` (libera a bodega, nuevo reintento) a
`intentos = 3` (**escala a `rechazada`** y se le cobra el rechazo a la tienda).

### 4.2 El efecto es RETROACTIVO, y eso no es un detalle

El conteo **no está materializado**: se recalcula al vuelo desde un historial
append-only. No existe columna, ni snapshot, ni fecha de efectividad. En
consecuencia:

> **En el PRIMER pase del cron tras el despliegue, todas las órdenes vivas que ya
> cumplan la condición de §4.1 escalan de golpe.** No es un cambio "hacia
> adelante": es una reinterpretación de historia ya escrita.

Y el escalado **no es reversible por el mismo camino**: `rechazada` solo sale por
la aprobación del cierre (`#38`/`#39`, feature 139), y el `cobroRechazado` entra
al cierre como ingreso de bodega contra la tienda.

Efectos colaterales que NO son dinero pero sí son visibles el mismo día:

- El badge del drawer (feature 47) sube para esas órdenes ("Intento 3 de 3" donde
  ayer decía "Intento 1 de 3").
- Una orden puede quedar con `intentos > umbral` (p. ej. 4 con umbral 3) porque
  el cron solo evalúa desde `devuelta` y una reprogramación no lo dispara. **El
  chip muestra solo el número (D5), así que esa incoherencia no se ve en la UI**;
  sí se vería en el drawer, que sigue mostrando "X de N".

### 4.3 Cómo medir el radio de impacto ANTES de decidir

Consulta de **solo lectura** (esbozo; se ejecuta contra la base que corresponda
sin escribir nada) que lista las órdenes que saltarían el umbral:

```sql
WITH vig AS (
  SELECT h.orden_id, h.estatus_destino_id, h.origen_tipo
  FROM orden_historial_estado h
  LEFT JOIN gestion_orden g ON g.id = h.gestion_orden_id
  WHERE (h.gestion_orden_id IS NULL
         AND h.origen_tipo NOT IN ('gestion','deshacer_gestion'))
     OR g.anulada_at IS NULL
),
ids AS (
  SELECT
    (SELECT id FROM order_status WHERE value = 'devuelta')     AS dev,
    (SELECT id FROM order_status WHERE value = 'reprogramada') AS rep
)
SELECT o.id, o.num_remision,
       COUNT(*) FILTER (WHERE v.estatus_destino_id = ids.dev) AS viejo,
       COUNT(*) FILTER (WHERE v.estatus_destino_id = ids.dev
                           OR (v.estatus_destino_id = ids.rep
                               AND v.origen_tipo = 'gestion'))  AS nuevo
FROM orden o
JOIN vig v ON v.orden_id = o.id
CROSS JOIN ids
WHERE o.deleted_at IS NULL
  AND o.estatus_id = ids.dev
GROUP BY o.id, o.num_remision, ids.dev, ids.rep
HAVING COUNT(*) FILTER (WHERE v.estatus_destino_id = ids.dev
                           OR (v.estatus_destino_id = ids.rep
                               AND v.origen_tipo = 'gestion')) >= 3   -- umbral
   AND COUNT(*) FILTER (WHERE v.estatus_destino_id = ids.dev)  < 3;
```

No filtra por causa `not_found` ni por ventana vencida, así que da la **cota
superior** del lote afectado — que es justo lo que hace falta para decidir.

### 4.4 Qué habría que hacer al respecto

**No se rellena con un supuesto: es QA1, bloqueante.** Las opciones sobre la mesa,
con su coste, están en §8.1. Lo que sí se decide aquí es el **orden**: la medición
de §4.3 se ejecuta ANTES de cerrar QA1, porque "cuántas órdenes son" cambia cuál
de las opciones es razonable.

## 5. Frontend

### 5.1 Dos piezas compartidas, una sola definición visual

`components/shared/IntentosEntregaBadge.tsx` — **presentación pura**, sin fetch y
sin lógica de dominio:

- Props `{ intentos: number }`. Devuelve `null` si `< 1` (**la regla de
  ocultamiento vive en UN solo sitio**, R18).
- Texto `1 intento` / `${n} intentos`. **Nunca "de N"** (R19: el umbral no está en
  el bundle del cliente y no se va a inyectar en 7 contratos por un adorno; el
  "de N" sigue a un clic, en el drawer de historial).
- Primitiva `Badge` de `components/ui/badge.tsx`, `variant="warning"` (tokens
  `-soft`/`-strong`, contraste ≥ 4.5:1 y modo oscuro ya resueltos). Misma variante
  que `PrioridadBadge`, con el mismo rol semántico: "atención, esta fila no es
  como las demás".
- `role="status"`, `aria-label={`Intentos de entrega: ${n}`}` (mismo tratamiento
  que el badge del drawer, `HistorialOrdenSheet.tsx:169-178`).

`conChipIntentos(columns)` — **decorador de columnas**, en el mismo módulo
compartido y calcado de `conBadgePrioridad`
(`components/shared/PrioridadResalte.tsx:58-94`, incluido su helper
`resolverCelda`): envuelve la PRIMERA columna de DATOS para anexar el chip sin
tocar cabeceras, ids ni orden (R20). Se elige la primera columna de datos, no la
de estado, por dos razones: (a) es la convención que el repo ya sancionó para
marcadores de FILA, y (b) evita inventar una segunda convención en la misma
tabla, donde ambos decoradores pueden componerse (`conBadgePrioridad(conChipIntentos(cols))`
en "Recibidas", donde ya conviven prioridad e intentos).

Que el chip lo usen ≥ 2 features con la misma API es exactamente lo que
`docs/architecture.md > Regla: sin sobre-ingeniería` exige para promoverlo a
`components/shared/`.

### 5.2 Inventario CERRADO de superficies (verificado archivo por archivo)

**Dentro (11):**

| # | Superficie | Archivo | DTO | R |
| --- | --- | --- | --- | --- |
| 1 | Listado plano de `/ordenes` | `app/(app)/ordenes/_components/OrdenesListado.tsx` + `ordenes-columns.tsx` | `OrdenListItemDTO` | R21 |
| 2 | Variante de la pestaña `reprogramada` | `ordenesColumnsReprogramada` (`ordenes-columns.tsx:199`) | idem | R21 |
| 3 | Dashboard del adminTienda | `app/(app)/_components/AdminTiendaDashboard.tsx` + `ordenes-columns-admin-tienda.ts` | idem | R21 |
| 4 | Revisión del maestro (7 apartados) | `OrdenesRevisionMaestro.tsx` → `OrdenesApartado.tsx` | idem | R21 |
| 5 | Diálogos de acción por lote (listan `<ul>` de órdenes) | `GenerarGuiaModal`, `AsignarBodegaModal`, `RutearSateliteModal`, `EtiquetasGuiaModal`, `RecuperarABodegaModal`, `DevolverATiendaModal` | idem | R22 |
| 6 | Mensajero · "por gestionar" | `mis-asignaciones/_components/pos-card/PosOrderCard.tsx` | `MiAsignacionDTO` | R23 |
| 7 | Mensajero · "por recoger" + detalle | `MisAsignacionesModule` → `PorAceptarSection` → `AsignacionDetalle.tsx` | idem | R23 |
| 8 | Recepción satélite · 5 grupos | `RecepcionSateliteModule.tsx`, `recibidas-columns.tsx` (3 tablas), `RecepcionDetalle.tsx` (2 grupos de cards) | `RecepcionSateliteDTO` | R24 |
| 9 | `/novedades` · novedades | `novedades/_components/NovedadesModule.tsx` | `NovedadDTO` | R25 |
| 10 | `/novedades` · rechazadas por plazo vencido | `novedades/_components/RechazosSlaModule.tsx` | `RechazoSlaTiendaDTO` | R25 |
| 11 | Aviso "Liberadas hoy (reprogramación)" | `components/private/BodegaLiberadasHoy.tsx` (montado en revisión del maestro **y** en recepción satélite) | `LiberadaHoyRow` | R26 |
| 12 | Manifiesto Excel descargable | `lib/utils/manifiesto-xlsx.ts` + `lib/types/manifiesto.ts` | `ManifiestoFilaDTO` | R27 · **QA3** |

(Son 12 entradas para 11 superficies de UI + 1 descargable.)

Las 4 primeras se cubren decorando **una** definición de columnas: `#2` y `#3`
derivan de `ordenesColumns` por composición, y `#4` la reusa tal cual. Es un
punto de aplicación, no cuatro.

**Fuera, con motivo:**

| Superficie | Archivo | Motivo |
| --- | --- | --- |
| Detalle público del paquete (QR) | `app/paquete/[numGuia]/page.tsx` | Accesible a **cualquier rol autenticado**, no al alcance de la orden (R28 · QA4) |
| Etiqueta de guía imprimible | `EtiquetaGuia.tsx`, `etiquetas-pdf.ts` | Documento físico del paquete; no es una vista de gestión (R28) |
| API de integradores | `ApiOrdenLecturaService`, `openapi-spec.ts` | Contrato público (R29 · QA5) |
| Cierre del día / cierres de admin | `CierreDiaModule.tsx`, `cierre-detalle-shared.tsx` | Grano = GESTIÓN, no orden; documento de dinero congelado (QA6) |
| Drawer de historial | `HistorialOrdenSheet.tsx` | Ya muestra el conteo ("Intento X de N"); cambia su NÚMERO por R10, no su UI |

## 6. Rutas, endpoints y contratos I/O

- **No hay endpoint nuevo, ni route handler nuevo, ni Server Action nueva.** Las
  12 superficies ya se sirven por Server Actions existentes (`listarOrdenes`,
  listado de asignaciones, `listar` de recepción satélite,
  `listarNovedadesAction`, `listarRechazosSlaTiendaAction`, `listarLiberadasHoy`,
  `obtenerManifiesto`).
- El cambio de contrato I/O es **aditivo**: un entero por item. **Sin cambios de
  validación zod**: no hay entrada nueva del cliente; el conteo es 100 % derivado
  en servidor.
- El cron SLA sigue siendo el mismo route handler; cambia el número que consume,
  no su firma ni su contrato.
- **Ninguna integración externa** involucrada (ni Storage, ni WhatsApp, ni Meta,
  ni Shopify).

## 7. Alternativas descartadas

### 7.1 (DESCARTADA) Dos conteos: uno "de visitas" para el chip y otro "de devoluciones" para el cron

Es literalmente lo que recomendaba el spec anterior (su Q1, punto 4: "si el
negocio quiere visitas totales, es una MÉTRICA distinta y merece campo propio").
Se descarta porque **D2 la contradice de frente**: el humano no pidió una métrica
nueva, dijo que el cron *ya debía* contar así. Además reintroduce exactamente el
riesgo que la feature 67 cerró: dos derivadores del mismo hecho que divergen en
silencio, uno de ellos gobernando dinero.

### 7.2 (DESCARTADA) Excluir por lista negra (`origen_tipo NOT IN ('reprogramacion_tienda')`)

Ver §1.3. Una familia nueva empezaría a contar sola y adelantaría escalados sin
que nadie lo decida. La lista de inclusión falla del lado seguro.

### 7.3 (DESCARTADA) Resolver el conteo dentro de cada repositorio de listado con `_count` filtrado

Prisma permite `_count: { select: { historial: { where: {...} } } }` en el
`include` del listado: una sola query total, sin roundtrip extra. Se descarta
porque, con **7 servicios de lectura**, obliga a escribir el predicado de
vigencia + el criterio de intento en **7 repositorios distintos**. Eso son siete
copias de la definición que dispara `cobroRechazado`. El coste que evita (un
roundtrip indexado por página) es despreciable frente a esa deuda.

### 7.4 (DESCARTADA) Columna materializada `orden.intentos_entrega`

Lectura O(1), sin joins. Se descarta porque:

1. Exige migración, y R7 lo prohíbe.
2. Es **incorrecta** con el modelo vigente: la vigencia no es monotónica. Anular
   una gestión (feature 67) DESCUENTA intentos **sin escribir en el historial**
   (es un filtro de lectura sobre `gestion.anulada_at`). Un contador incremental
   se desincronizaría en silencio, y ese número dispara `rechazada` →
   `cobroRechazado`: drift = dinero mal cobrado.
3. Con el criterio nuevo el problema empeora: el contador también tendría que
   distinguir `origen_tipo` al incrementar.

### 7.5 (DESCARTADA) Resolver el conteo en el borde (Server Actions) para no tocar los servicios

Evitaría los 7 constructores nuevos y sus fixtures. Se descarta porque mete
lógica de dominio en la capa de controlador —contra
`docs/architecture.md > Separación de capas`— y porque habría que repetirla en
cada acción (7 copias del merge), reproduciendo el problema de 7.3 una capa más
arriba. Además el manifiesto arma su DTO **dentro** del servicio: ahí el borde ni
siquiera tendría dónde engancharse.

### 7.6 (DESCARTADA) Columna dedicada "Intentos" en las tablas

La tabla de `/ordenes` ya tiene 18 columnas y scroll horizontal; una columna
vacía en la gran mayoría de filas paga ancho permanente por información
esporádica, obliga a inventar copia de celda vacía (en tensión con R18) y se cuela
en todas las variantes derivadas, rompiendo los tests que fijan la lista exacta de
cabeceras. El decorador de §5.1 entrega la misma información donde el ojo ya está
y cumple R20.

### 7.7 (DESCARTADA) Una llamada a `contarIntentos(ordenId)` por fila

Es la implementación obvia y no exigiría método nuevo. Se descarta por ser un N+1
sobre listados paginados en servidor: decenas de queries por render y la lectura
del catálogo repetida. R12 lo prohíbe.

## 8. Preguntas abiertas (puerta F1.4-bis)

### 8.1 QA1 — BLOQUEANTE · ¿Qué se hace con las órdenes vivas?

El problema está descrito en §4.2. **No se rellena con un supuesto.** Opciones,
con su coste real:

| Opción | Qué implica | Coste |
| --- | --- | --- |
| **(a) Sin mitigación** | El criterio aplica a todas las órdenes desde el primer pase del cron. | Cero código. Coherente con "el cron ya debía contar así". Riesgo: un lote de rechazos y de `cobroRechazado` el mismo día, sin aviso a las tiendas. |
| **(b) Fecha de corte** | La rama B solo cuenta transiciones `reprogramada` con `created_at >= <corte>`. | Config nueva (env, sin migración) + el criterio deja de ser puro y hay que testear el borde. El chip y el cron seguirían coherentes entre sí. |
| **(c) Revisión manual previa** | Se ejecuta §4.3, se revisa el lote y se decide orden por orden antes de desplegar. | Cero código; trabajo humano proporcional al tamaño del lote (que §4.3 mide). |
| **(d) Dos entregas** | Primero el chip con el criterio nuevo; el cron pasa al criterio nuevo en una entrega posterior. | Viola R4 de forma temporal (dos números distintos conviviendo). Solo aceptable si es explícitamente transitorio y con fecha. |

**Sin respuesta a QA1 no arranca el Bloque 2 de `tasks.md`** (el que toca el cron).
Los bloques de exposición y UI pueden avanzar igual: no dependen de esto.

### 8.2 QA2 — BLOQUEANTE si QA1 ≠ (a)

Si se elige (b): ¿qué fecha exacta, y qué pasa cuando la variable no está puesta
(¿cae a "sin corte" o a "no cuenta la rama B"?). Si se elige (c): ¿quién revisa y
con qué criterio se resuelve cada orden del lote? Si se elige (d): ¿con qué fecha
se cierra la transición?

### 8.3 QA3 — BLOQUEANTE del task del manifiesto (no de la feature)

R27 obliga a emitir los intentos en el manifiesto. Pero la feature 148 declara en
`lib/types/manifiesto.ts:27-36` y en `manifiesto-xlsx.ts:19-24` que el archivo
tiene **"EXACTAMENTE las 11 columnas pedidas"** y que "si se agrega una propiedad
aquí, se rompe R2/R11". Agregar una 12.ª columna `intentos`:

- deroga R2/R11 de la 148 y rompe sus tests de cabeceras;
- cambia un documento **operativo** que puede estar siendo consumido fuera del
  producto (nadie versiona ese archivo).

¿Se confirma que D4 deroga R2/R11 de la 148 —y se anota en su spec— o el
manifiesto queda fuera del alcance por ser documento congelado? Un spec_author no
deroga el requisito de otra feature por su cuenta.

### 8.4 QA4 · QA5 · QA6 · QA7 — no bloqueantes, con recomendación

Recogidas en `requirements.md > Preguntas abiertas`. Resumen de la recomendación:
**no** al detalle público del paquete y a la etiqueta (amplía visibilidad), **no**
a la API pública (contrato externo), **no** al cierre del día (grano gestión), y
**sí** a mantener el criterio por inclusión, que deja fuera las filas legadas.

## 9. Verificación

- `./init.sh` en verde y suite completa en verde.
- `git diff` **sin** cambios en `db/schema.prisma` ni en `db/migrations/` (R7). Si
  aparecen, el diseño se torció.
- Foco de los tests: predicado único (ambas ramas, ambas vigencias), lote de 1
  query, lote vacío sin query, degradación de catálogo, **el caso de escalado que
  cambia** (2 reprogramaciones + 1 devuelta con umbral 3 → escala), el caso que NO
  cambia (`wrong_*` escala directo sin consultar el conteo), y el caso de doble
  conteo evitado (devuelta + reprogramación de tienda → 1).
- Las 12 superficies con su par de tests (≥1 → chip; 0/ausente → sin chip ni
  placeholder) y las 4 definiciones de columnas con sus cabeceras intactas.
- Evidencia de §4.3 ejecutada y su resultado escrito en `progress/` antes de
  cerrar QA1.
