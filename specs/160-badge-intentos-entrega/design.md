# Feature 160 — Design

Decisiones técnicas de **el criterio de intento de entrega, su efecto sobre el
escalado automático, y su exposición en todas las superficies de la orden**.

> **Reescrito el 2026-07-29** (puerta F1.4) y **revisado el mismo día** (puerta
> F1.4-bis). La versión original diseñaba una feature ADITIVA de dos superficies
> que "no redefinía ninguna regla de negocio"; D1 y D2 invalidaron esa premisa y
> D4 multiplicó las superficies. La revisión F1.4-bis cerró los tres bloqueantes
> (D7, D8, D9) y **cambió la presentación: el conteo deja de ser un chip y pasa a
> ser un dato más de la orden** (D6).

## 0. Qué cambió, y respecto de qué

### 0.1 Respecto de la versión original del spec (puerta F1.4)

| Antes | Ahora | Origen |
| --- | --- | --- |
| Intento = destino `devuelta` | Intento = destino `devuelta` **o** destino `reprogramada` con familia `gestion` | D1 + matiz verificado |
| "No cambia el cron SLA ni el drawer" | El cron SLA y el drawer **cambian**: es el punto de la feature | D2 |
| 2 superficies | **12 superficies** sobre **7 DTO**, incluido un descargable | D4 |
| Complejidad `low`, aditiva | Complejidad **`high`**, toca dinero | D1+D2+D4 |
| `incidente` fuera "por defecto" | `incidente` fuera **y terminal**; `indemnizada` descartado | D3 |

### 0.2 Respecto de la primera reescritura (puerta F1.4-bis)

| Antes (F1.4) | Ahora (F1.4-bis) | Origen |
| --- | --- | --- |
| Chip incrustado en la celda de otra columna, vía decorador `conChipIntentos` | **Columna propia "Intentos"** en tablas; **dato etiquetado "Intentos: N"** en cards, listas y diálogos | D6 |
| "Oculto cuando el conteo es 0" | **El valor siempre se muestra, `0` incluido** (§5.3) | D6 + decisión razonada de este documento |
| "Sin agregar columnas nuevas" (R20 original) | Se agrega **una** columna, en posición fija, sin tocar las preexistentes (R21) | D6 |
| QA1 abierta y bloqueante | **Resuelta: opción (a), sin mitigación**, por medición contra producción | D7 |
| QA2 abierta y bloqueante | **Desaparece** por dependencia de QA1 | D8 |
| QA3 abierta y bloqueante | **Resuelta: el manifiesto lleva el dato**, y R2/R11 de la 148 se derogan y reformulan (§6.3) | D9 |
| — | Límite nuevo declarado: el dato **no es ordenable ni filtrable** (§5.5, R29, QA8) | consecuencia de D6 |

**Corrección de una afirmación del spec original:** su §4.1 hablaba de
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
contaría el mismo hecho dos veces. El objetor #3 del spec original era correcto
**solo para `#22`**; el error fue aplicarlo también a `#13`.

`deshacer_gestion` es la otra familia de `ORIGEN_TIPOS_CON_GESTION`, pero su
único destino declarado es `en_reparto`: nunca produce `reprogramada`. Por tanto
`destino = reprogramada AND origen_tipo = 'gestion'` ≡ arista `#13` exactamente.

> **A verificar contra la 154 ya mergeada** (T1): que el mapa del catálogo v2
> (18 → 20 estados) siga teniendo exactamente esas dos aristas con destino
> `reprogramada` y que `incidente` siga sin salidas. No se asume: se comprueba.

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
una línea de código**: es el comportamiento por defecto del criterio. La 154 —ya
implementada y verde— lo declara TERMINAL y **sin salidas**, y este diseño no
introduce ninguna: nada aquí asume que `incidente` transite a algo. Tampoco se
declara, referencia ni deja preparado ningún estado `indemnizada`.

## 2. Modelo de datos

**Sin tabla nueva, sin columna de base de datos nueva, sin enum nuevo, sin índice
nuevo, sin migración.** (La "columna nueva" de D6 es de **presentación**, en la
tabla de la UI; no toca el esquema.)

- Fuente: `orden_historial_estado` (`db/schema.prisma:1128-1154`), append-only e
  inmutable. La exclusión de intentos anulados es un filtro de LECTURA.
- **RLS:** ya habilitada sin policies (solo service-role). Las lecturas ocurren
  server-side vía Prisma con el service role, igual que hoy. **No se toca.**
- **Índice — evaluado explícitamente.** El filtro nuevo es:

  ```
  orden_id IN (...)  AND  estatus_destino_id IN (devueltaId, reprogramadaId)
                     AND  <residual: origen_tipo / anulada_at>
  ```

  `@@index([ordenId, estatusDestinoId])` (`db/schema.prisma:1152`) **sigue
  sirviendo**: las dos columnas del índice son exactamente las dos del predicado
  selectivo, y el paso de `= devueltaId` a `IN (2 valores)` es un scan de dos
  rangos del mismo índice, no un seq scan. `origen_tipo` y `gestion.anulada_at`
  quedan como filtros **residuales** sobre el puñado de filas ya recuperadas, y el
  join a `gestion_orden` es por PK.

  **Conclusión: NO hace falta índice nuevo, por lo tanto NO hay migración.** Si en
  la implementación apareciera evidencia contraria (un `EXPLAIN` con seq scan),
  eso **es** una migración y contradice el encargo: se detiene y se escala como
  decisión, no se añade un índice por cuenta propia.

## 3. Backend

### 3.1 Fuente única del criterio (clave de R4)

`lib/types/orden-historial.ts` ya es el hogar documentado de "qué cuenta y qué no
como intento". Ahí se declara la familia admitida por la rama B, con el mismo
patrón `satisfies` que rompe el build si el enum cambia:

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

Los bloques de comentario de las features 99/100/109/138/139 de ese archivo
afirman hoy "destino != `devuelta` → no altera `contarIntentos`". **Esa
afirmación deja de ser suficiente** y hay que corregirla en el mismo commit: el
criterio pasa a ser "destino ∉ {`devuelta`} y no (destino = `reprogramada` ∧
origen = `gestion`)". Verificado que ninguno de esos valores produce
`reprogramada`, así que la conclusión sigue siendo cierta para todos ellos; lo que
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

Extraerlo es lo que impide que el dato de la UI y el número que dispara
`rechazada` → `cobroRechazado` diverjan por copia-pega.

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
obtener un número que no es el que gobierna el dinero.

Implementación del lote (patrón `OrdenRepository.findMensajerosBloqueados`):

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
**mismo** `whereIntentosVigentes`.

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
"contarIntentosEnLote">` como dependencia **requerida** de constructor (una dep
opcional deja que el wiring de producción se la olvide y el dato desaparezca en
silencio; requerida, el compilador lo impide) y hace el merge sobre los items **ya
acotados por rol/zona/tienda** (R15).

| # | Servicio | Método | DTO | Nota |
| --- | --- | --- | --- | --- |
| 1 | `OrdenService` | `listar` | `OrdenListItemDTO` | alimenta 5 superficies de UI |
| 2 | `MisAsignacionesService` | `listarMisAsignaciones` | `MiAsignacionDTO` | ambos grupos; ya tiene el patrón `findMarcarLuegoByMensajero`/`findNotasByMensajero` |
| 3 | `RecepcionSateliteService` | `listar` | `RecepcionSateliteDTO` | **un solo lote para los 5 grupos** |
| 4 | `NovedadesService` | listado de novedades | `NovedadDTO` | |
| 5 | `RechazosSlaTiendaService` | listado de rechazos SLA | `RechazoSlaTiendaDTO` | |
| 6 | `LiberacionReprogramadaService` | liberadas hoy | `LiberadaHoyRow` | |
| 7 | `ManifiestoService` | filas del manifiesto | `ManifiestoFilaDTO` | descargable (R28) |

Forma del merge, idéntica en los 7:

```ts
const intentos = await this.historial.contarIntentosEnLote(rows.map((r) => r.id));
// ... intentosEntrega: intentos.get(row.id) ?? 0        // R14
```

En el caso 3 el lote se arma **una vez** con la unión de los ids de los cinco
grupos: cinco consultas al historial por página serían un incumplimiento gratuito
de R12.

**Sin ciclo de módulos:** cada servicio importa SOLO el tipo
`IOrdenHistorialService` (`import type`); `OrdenHistorialService` depende de
`IOrdenRepository`/`IOrdenHistorialRepository` y nunca de los servicios de lista.

**Coste por página:** 2 lecturas del catálogo `order_status` (tabla diminuta) + 1
`groupBy` indexado. **Ninguna consulta depende de N.**

**Peaje de fixtures declarado:** siete constructores nuevos significan tocar los
dobles de test de siete suites. Es mecánico y visible; mismo camino que las
features 115/116 al sumar `metaRepo` a `MisAsignacionesService`. La deuda "fakes
de repositorio a mano y duplicados" de `progress/current.md` se va a notar aquí.

### 3.6 Contrato de los DTO

Los 6 DTO internos ganan el MISMO campo, aditivo y opcional (patrón `zonaEsGam?`
/ `marcarLuego?` / `prioridad?`):

```ts
/** Feature 160: intentos de entrega VIGENTES de la orden (criterio unico de
 *  `OrdenHistorialService`, design §1.1), derivados del historial en el mismo lote
 *  de la lectura. Opcional (`?`) por el patron aditivo del repo: no rompe
 *  fixtures/mocks que construyen el DTO sin el; el servicio SIEMPRE lo envia (0
 *  incluido). La UI pinta `?? 0`: el dato SIEMPRE se muestra (R19). */
intentosEntrega?: number;
```

- `OrdenListItemDTO` · `MiAsignacionDTO` · `RecepcionSateliteDTO` · `NovedadDTO` ·
  `RechazoSlaTiendaDTO` · `LiberadaHoyRow`.
- `ManifiestoFilaDTO` lo lleva **NO opcional** (`intentos: number`): ese DTO
  enumera sus propiedades una a una a propósito para que el archivo no omita
  campos en silencio (§6.3).
- `OrdenDTO` (CRUD base) **no** gana el campo.
- `ApiOrdenListItemDTO` / `ApiOrdenDetalleDTO` **no** (R31). El canal integrador
  se sirve de `listByOwner` → `ApiOrdenRow`, proyección distinta: sin riesgo de
  fuga por herencia.
- `EtiquetaGuiaDTO` **no** (R30).

## 4. Dinero y retroactividad

### 4.1 Qué órdenes cambian de comportamiento

La cadena es: `contarIntentos` → `DevolucionSlaService.ejecutar` → `escalar()` →
transición `devuelta → rechazada` con gestión sintética → concepto
`cobroRechazado` de la tarifa de zona (feature 56) al aprobar el cierre.

Filtrando por lo que el cron **realmente** hace
(`DevolucionSlaService.ts:88-137` y `DevolucionSlaRepository.findDevueltasSla`):

1. Solo entran órdenes **que reposan en `devuelta`**, no borradas, con gestión
   `devuelta` VIGENTE. Una orden en `reprogramada` **no es candidata**. → La
   ampliación **no** agrega órdenes al universo del cron.
2. Las de causa `wrong_number`/`wrong_address` **escalan directo** sin consultar
   el conteo (`:128-133`). → **No cambian.**
3. Las de causa `null` se omiten. → **No cambian.**
4. **Solo cambia** la rama `not_found` con ventana de 24 h vencida (`:108-127`).

**El conjunto que cambia de comportamiento es, por tanto:** órdenes que reposan
en `devuelta`, causa `not_found`, ventana vencida, con **≥1 transición vigente
`en_reparto → reprogramada` de familia `gestion`**, tales que
`conteo_nuevo >= umbral` y `conteo_viejo < umbral`.

Con el umbral por defecto (3): una orden con 2 reprogramaciones del mensajero y 1
devuelta pasa de `intentos = 1` (libera a bodega) a `intentos = 3` (**escala a
`rechazada`** y se le cobra el rechazo a la tienda).

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

Efectos colaterales visibles el mismo día, que no son dinero:

- El badge del drawer (feature 47) sube para esas órdenes.
- Una orden puede quedar con `intentos > umbral` (p. ej. 4 con umbral 3) porque el
  cron solo evalúa desde `devuelta` y una reprogramación no lo dispara. **Las
  superficies de esta feature muestran solo el número (D5), así que ahí no hay
  incoherencia**; sí se ve en el drawer, que sigue mostrando "X de N".

### 4.3 Consulta de medición (solo lectura)

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

No filtra por causa `not_found` ni por ventana vencida: da la **cota superior**
del lote afectado, que es lo que hace falta para decidir.

### 4.4 Medición ejecutada — evidencia fechada (D7)

**Entorno:** proyecto Supabase `ordenex-db` (**producción**), acceso de **solo
lectura**. **Fecha:** 2026-07-29. **Ejecutada por:** el coordinador, antes de
cerrar QA1.

| Medición | Valor |
| --- | --- |
| Órdenes hoy en `devuelta` | **2** |
| Órdenes que saltarían el umbral de 3 (`nuevo >= 3 AND viejo < 3`) | **0** |
| Órdenes cuyo conteo cambia de valor (`nuevo > viejo`) | **8** |
| Filas de historial con destino `reprogramada` y `origen_tipo = 'gestion'` | **10** |
| Filas de historial totales en toda la base | **167** |

**Lectura de la evidencia:** el conjunto de §4.1 está **vacío**. Cero órdenes
escalan a `rechazada` por el cambio de criterio; el efecto retroactivo existe
conceptualmente pero hoy **no tiene sujeto**. Las 8 órdenes cuyo conteo cambia lo
hacen sin cruzar el umbral: cambia el número que se muestra, no el desenlace. El
volumen de producción es todavía mínimo (167 filas de historial en total), y eso
—no una apuesta— es lo que hace segura la opción (a).

**Decisión QA1 = (a), sin mitigación** (D7). **Condición de vigencia, no
negociable:**

> **Esta medición es una foto del 2026-07-29 y el conteo se recalcula al vuelo.
> La consulta de §4.3 se vuelve a ejecutar JUSTO ANTES del despliegue.** Si al
> re-medir el resultado de la fila "saltarían el umbral" es **> 0**, la decisión
> de QA1 **se revisa** antes de desplegar: vuelven a la mesa las opciones (b),
> (c) y (d) que §8.1 conserva documentadas para ese caso.

Esa re-ejecución es una task del cierre (`tasks.md` T24.1), no una recomendación.

## 5. Frontend — el conteo como un dato más de la orden (D6)

### 5.1 Una pieza compartida, dos formas de presentación

Módulo `components/shared/intentos-entrega.tsx`, sin fetch ni lógica de dominio:

```ts
export const INTENTOS_COLUMN_ID = "intentos";
export const INTENTOS_LABEL = "Intentos";

/** Valor a pintar. Derivado SIEMPRE resuelto: `undefined` se pinta 0 (R19). */
export function valorIntentos(row: { intentosEntrega?: number }): number;

/** Columna reutilizable para CUALQUIER tabla de ordenes (R17). Generica: sirve a
 *  `Column<OrdenListItemDTO>` y a `Column<RecepcionSateliteDTO>` sin duplicar. */
export function columnaIntentos<T extends { intentosEntrega?: number }>(): Column<T>;

/** Dato etiquetado para cards, listas y dialogos (R18): "Intentos: N". */
export function IntentosDato(props: { intentos: number; className?: string }): JSX.Element;
```

- **Una sola definición del dato** para las 12 superficies: la columna y el dato
  etiquetado comparten `valorIntentos` y `INTENTOS_LABEL`.
- **Sin umbral** en ninguna de las dos formas (R20). El "de N" sigue a un clic, en
  el drawer de historial.
- **Énfasis redundante, nunca portador único:** con `>= 1` el número se resalta
  tipográficamente (peso/color de la escala `warning` ya sancionada por
  `PrioridadResalte`), con `0` se muestra neutro. El **número** es el que
  comunica; el énfasis solo lo hace saltar a la vista en una tabla densa. No es
  un badge ni una pastilla: D6 pidió explícitamente dejar de tratarlo como chip.

**Lo que se retira del diseño anterior:** `IntentosEntregaBadge` y el decorador
`conChipIntentos`. El decorador existía para incrustar el chip en la celda de otra
columna; con columna propia no tiene razón de ser.

### 5.2 Posición de la columna, y por qué esa

**En `ordenesColumns`: inmediatamente después de `estatus`** (posición 4 de 19).
**En `recibidasColumns`: misma posición relativa**, después de `estatus`.

Tres razones, en orden de peso:

1. **Semántica.** El conteo califica al estado (`devuelta`/`reprogramada`): leerlo
   pegado al estado es leer una sola idea.
2. **Visibilidad real.** `ordenesColumns` ya tiene **18** columnas y el
   `DataTable` desborda con scroll horizontal (`overflow-x-auto` + flechas,
   `DataTable.tsx:385-465`). Una columna al final quedaría fuera del viewport
   permanentemente: cumpliría la letra de D4 y no su intención.
3. **Compatibilidad demostrable con los tests vigentes.** Los asserts de
   `tests/unit/components/ordenes-columns.test.tsx:113-117` son:
   `ordenesColumnsReprogramada.length === ordenesColumns.length + 1`,
   `ordenesColumnsReprogramada.at(-1)?.id === "liberada"` y
   `ordenesColumnsReprogramada.slice(0, -1)` igual a `ordenesColumns`.
   Insertando en posición 4 **los tres siguen verdes sin tocarlos**; insertando al
   final, el segundo se rompería.

### 5.3 El caso `0` — decidido, no abierto

**El dato SIEMPRE se muestra, con `0` incluido, en las 12 superficies** (R19).
Ni celda vacía, ni `—`, ni omisión del dato etiquetado. Cuatro razones:

1. **`0` es un valor conocido, no un dato ausente.** En este repo `—` (`SIN_DATO`,
   `ordenes-columns.tsx:8`) significa "relación opcional que no resolvió". Usarlo
   para un conteo que el backend garantiza numérico (R14) sería mentir sobre la
   naturaleza del dato.
2. **Una columna numérica con huecos se lee mal y se exporta peor.** En Excel una
   celda vacía **no es** `0`; la propia feature 148 distingue los dos casos a
   propósito (`numGuia` null → celda vacía, su R5). El manifiesto necesita `0`
   (R28a), y que la tabla y el archivo muestren cosas distintas para el mismo
   hecho es exactamente el tipo de incoherencia que esta feature vino a cerrar.
3. **Una regla, doce superficies, un test.** "Siempre se muestra" se verifica una
   vez sobre `valorIntentos` y una vez por superficie; "se oculta según el valor"
   multiplica los casos borde por doce.
4. **Es lo que pide una columna.** El chip podía desaparecer porque flotaba dentro
   de otra celda; una columna vacía en el 95 % de las filas es el hueco que el
   propio cambio de presentación vino a evitar.

El mismo criterio aplica al dato etiquetado de las cards: "Intentos: 0" se
muestra, igual que la card muestra el resto de sus campos siempre.

### 5.4 Inventario CERRADO de superficies (verificado archivo por archivo)

**Tablas (`DataTable`) → columna propia:**

| # | Superficie | Archivo | DTO | R |
| --- | --- | --- | --- | --- |
| 1 | Listado plano de `/ordenes` | `ordenes-columns.tsx` vía `OrdenesListado.tsx` | `OrdenListItemDTO` | R22 |
| 2 | Variante de la pestaña `reprogramada` | `ordenesColumnsReprogramada` (`:199`) | idem | R22 |
| 3 | Dashboard del adminTienda | `ordenes-columns-admin-tienda.ts` | idem | R22 |
| 4 | Revisión del maestro (7 apartados) | `OrdenesRevisionMaestro.tsx` → `OrdenesApartado.tsx` | idem | R22 |
| 5 | Recepción satélite · "Recibidas", "Por devolver", "En tránsito a central" | `recibidas-columns.tsx` vía `RecepcionSateliteModule.tsx` | `RecepcionSateliteDTO` | R25 |

**Sin tabla → dato etiquetado:**

| # | Superficie | Archivo | DTO | R |
| --- | --- | --- | --- | --- |
| 6 | Diálogos de acción por lote (`<ul>` de órdenes) | `GenerarGuiaModal`, `AsignarBodegaModal`, `RutearSateliteModal`, `EtiquetasGuiaModal`, `RecuperarABodegaModal`, `DevolverATiendaModal` | `OrdenListItemDTO` | R23 |
| 7 | Mensajero · "por gestionar" | `pos-card/PosOrderCard.tsx` | `MiAsignacionDTO` | R24 |
| 8 | Mensajero · "por recoger" + detalle | `PorAceptarSection` → `AsignacionDetalle.tsx` | idem | R24 |
| 9 | Recepción satélite · "Por recibir" y "Devueltas" (cards) | `RecepcionDetalle.tsx` | `RecepcionSateliteDTO` | R25 |
| 10 | `/novedades` · novedades | `NovedadesModule.tsx` | `NovedadDTO` | R26 |
| 11 | `/novedades` · rechazadas por plazo vencido | `RechazosSlaModule.tsx` | `RechazoSlaTiendaDTO` | R26 |
| 12 | Aviso "Liberadas hoy" (2 montajes) | `components/private/BodegaLiberadasHoy.tsx` | `LiberadaHoyRow` | R27 |
| 13 | Manifiesto Excel | `lib/utils/manifiesto-xlsx.ts` | `ManifiestoFilaDTO` | R28 |

> **Precisión verificada contra el código, porque cambia el tratamiento:** el
> encargo listó `/novedades` y "rechazadas por SLA" entre las tablas. **No lo
> son.** `NovedadesModule.tsx:102-140` y `RechazosSlaModule.tsx:100-133` renderizan
> `<ul>` de `<li>` con cards, no `DataTable`. Por eso reciben el **dato
> etiquetado** (R18), que entrega la misma información con la regla que les
> corresponde. Si alguna de las dos se convirtiera en tabla, la regla de R17 las
> mueve a columna automáticamente, sin cambiar el spec.

**Fuera, con motivo:**

| Superficie | Archivo | Motivo |
| --- | --- | --- |
| Detalle público del paquete (QR) | `app/paquete/[numGuia]/page.tsx` | Accesible a **cualquier rol autenticado**, no al alcance de la orden (R30 · QA4) |
| Etiqueta de guía imprimible | `EtiquetaGuia.tsx`, `etiquetas-pdf.ts` | Documento físico del paquete, no vista de gestión (R30) |
| API de integradores | `ApiOrdenLecturaService`, `openapi-spec.ts` | Contrato público (R31 · QA5) |
| Cierre del día / cierres de admin | `CierreDiaModule.tsx`, `cierre-detalle-shared.tsx` | Grano = GESTIÓN, no orden; documento de dinero congelado (QA6) |
| Drawer de historial | `HistorialOrdenSheet.tsx` | Ya muestra el conteo; cambia su NÚMERO por R10, no su UI |

### 5.5 Lo que el cambio a columna mueve, revisado punto por punto

- **Definiciones de columnas compartidas.** Verificado: **no hay** una definición
  compartida de columnas de orden que obligue a tocar consumidores ajenos.
  `ordenesColumns` (18) y `recibidasColumns` (12) son listas **independientes**;
  `ordenesColumnsAdminTienda` deriva por `filter` sobre ids y
  `ordenesColumnsReprogramada` por spread, así que **heredan la columna nueva sin
  tocarlas**; `OrdenesApartado` y `RecepcionSateliteModule` prependen su checkbox
  al array ya construido. → Se añade en **dos** archivos, ambos consumiendo la
  MISMA `columnaIntentos()`.
- **Interacción con `conBadgePrioridad`.** Decora la **primera** columna de datos
  (`PrioridadResalte.tsx:77-94`). Insertar "Intentos" en posición 4 no la afecta:
  la primera sigue siendo `numGuia`. Sin conflicto.
- **Ancho.** `Column<T>` **no tiene** prop de ancho ni de clase
  (`DataTable.tsx:35-48`): la tabla es `w-full` y resuelve el desbordamiento con
  `overflow-x-auto` + flechas de scroll (`:385-465`), recalculadas por
  `ResizeObserver` ante cambios de `columns` (`:252`). Una columna más suma ancho
  y el mecanismo ya existente lo absorbe; no hay layout que ajustar. El skeleton
  cicla 5 anchos (`SKELETON_WIDTHS`), así que tampoco se rompe.
- **Orden y filtros (features 144/151).** El `ORDER BY` del listado usa lista
  blanca de columnas reales de `orden` (`OrdenRepository.SORT_COLUMN`, `:143-147`:
  `createdAt`, `numGuia`, `numRemision`), y `ordenFilterSchema` es `.strict()` con
  whitelist. El dato es derivado: **no es ordenable ni filtrable server-side**
  (R29) y el borde ya rechaza cualquier intento sin código nuevo. Queda **QA8**
  para que la 144/151 decidan si una columna visible pero no ordenable les sirve.
  Materializarla exigiría migración y reintroduciría el drift de §7.4.
- **Export server-side (151).** Cuando llegue, necesitará el mismo
  `contarIntentosEnLote`: queda disponible como pieza reutilizable.

## 6. Rutas, endpoints y contratos I/O

### 6.1 Sin superficie de red nueva

**No hay endpoint nuevo, ni route handler nuevo, ni Server Action nueva.** Las 13
superficies ya se sirven por Server Actions existentes (`listarOrdenes`, listado
de asignaciones, `listar` de recepción satélite, `listarNovedadesAction`,
`listarRechazosSlaTiendaAction`, `listarLiberadasHoy`, `obtenerManifiesto`).

### 6.2 Cambio de contrato

Aditivo: un entero por item. **Sin cambios de validación zod** — no hay entrada
nueva del cliente; el conteo es 100 % derivado en servidor. El cron SLA conserva
firma y contrato; cambia el número que consume. **Ninguna integración externa**
involucrada.

### 6.3 Derogación explícita de R2/R11 de la feature 148 (D9)

**Lo que la 148 dice hoy.** `lib/types/manifiesto.ts:27-36`: *"R2 — Fila del
manifiesto: EXACTAMENTE las 11 columnas pedidas"* y *"R11 — NO lleva ningún dato
más […] Si se agrega una propiedad aquí, se rompe R2/R11"*. Igual en
`lib/utils/manifiesto-xlsx.ts:19-24`.

**Lo que decidió el humano (2026-07-29), textual.** *"cada que un dato de una
orden es agregado, este dato también debe aparecer en los manifiestos, y el
número de intentos es un dato propio de una orden"*.

**Lectura correcta de la 148, que la premisa anterior de este spec tenía mal.**
R2/R11 nunca quisieron decir "el manifiesto está congelado en 11 columnas". Su
intención era **que el manifiesto refleje los datos de la tabla de órdenes** y que
no se cuelen ahí campos que no son de la orden (`ordenId`, `tiendaId`,
`deletedAt`). El "11" era el inventario **de ese momento**, no un tope.

**Regla reformulada, que reemplaza a R2/R11 de la 148:**

> **El manifiesto refleja los datos de la orden.** Lleva una columna por cada dato
> propio de la orden que el producto haya decidido exponer, y ese conjunto
> **crece** cuando la orden gana un dato nuevo. Sigue vigente el lado prohibitivo
> de R11: identificadores internos, banderas de borrado y datos que **no son de la
> orden** siguen sin entrar. Lo que se deroga es el número cerrado, no el filtro.

**Cómo se escribe para que no vuelva a chocar** (R28b): el conjunto de columnas se
declara **abierto**. Ni el código ni los tests pueden afirmar "exactamente N
columnas"; las pruebas verifican que ciertas columnas **están**, con su clave y su
orden relativo. Así, la próxima feature que agregue un dato de la orden no vuelve
a topar contra el mismo requisito.

**Rastro obligatorio:** se anota la derogación en `specs/148-*/requirements.md`
como nota de corrección fechada, citando esta decisión, para que quien lea la 148
encuentre el hilo (task T22).

## 7. Alternativas descartadas

### 7.1 (DESCARTADA) Dos conteos: uno "de visitas" para la UI y otro "de devoluciones" para el cron

Es lo que recomendaba el spec original (su Q1, punto 4). Se descarta porque **D2
la contradice de frente**: el humano no pidió una métrica nueva, dijo que el cron
*ya debía* contar así. Además reintroduce el riesgo que la feature 67 cerró: dos
derivadores del mismo hecho que divergen en silencio, uno gobernando dinero.

### 7.2 (DESCARTADA) Excluir por lista negra (`origen_tipo NOT IN ('reprogramacion_tienda')`)

Ver §1.3. Una familia nueva empezaría a contar sola y adelantaría escalados sin
que nadie lo decida. La lista de inclusión falla del lado seguro.

### 7.3 (DESCARTADA) Resolver el conteo dentro de cada repositorio de listado con `_count` filtrado

Prisma permite `_count: { select: { historial: { where: {...} } } }` en el
`include`: una sola query total. Se descarta porque, con **7 servicios de
lectura**, obliga a escribir el criterio en **7 repositorios distintos** — siete
copias de la definición que dispara `cobroRechazado`. El roundtrip indexado que
evita es despreciable frente a esa deuda.

### 7.4 (DESCARTADA) Columna materializada `orden.intentos_entrega`

Lectura O(1), sin joins, y **haría el dato ordenable y filtrable** (lo que QA8
deja como límite). Aun así se descarta:

1. Exige migración, y R7 lo prohíbe.
2. Es **incorrecta** con el modelo vigente: la vigencia no es monotónica. Anular
   una gestión (feature 67) DESCUENTA intentos **sin escribir en el historial**
   (filtro de lectura sobre `gestion.anulada_at`). Un contador incremental se
   desincronizaría en silencio, y ese número dispara `rechazada` →
   `cobroRechazado`: drift = dinero mal cobrado.
3. Con el criterio nuevo empeora: el contador también tendría que distinguir
   `origen_tipo` al incrementar.

### 7.5 (DESCARTADA) Resolver el conteo en el borde (Server Actions) para no tocar los servicios

Evitaría los 7 constructores nuevos y sus fixtures. Se descarta porque mete lógica
de dominio en la capa de controlador —contra `docs/architecture.md > Separación de
capas`— y habría que repetirla en cada acción, reproduciendo 7.3 una capa más
arriba. Además el manifiesto arma su DTO **dentro** del servicio.

### 7.6 (DESCARTADA) Chip incrustado en la celda de otra columna

**Era el diseño de la versión anterior de este documento** (badge dentro de la
celda de estado, más un decorador `conChipIntentos` calcado de
`conBadgePrioridad`). Lo descarta **D6**, y las razones del humano se sostienen
solas: un chip es un *marcador de excepción* y los intentos son un *dato* de la
orden. Como dato merece encabezado propio, valor en todas las filas, y el mismo
trato que Guía, Zona o Monto. Consecuencia práctica: con chip el dato solo existía
cuando era ≥1 y no había forma de leer la columna de un vistazo ni de llevarlo al
descargable sin inventar una regla aparte.

### 7.7 (DESCARTADA) Columna "Intentos" al final de la tabla

Menos invasiva en apariencia. Se descarta por §5.2: con 18 columnas y scroll
horizontal quedaría permanentemente fuera del viewport —cumpliendo la letra de D4
y no su intención— y rompería el assert vigente
`ordenesColumnsReprogramada.at(-1)?.id === "liberada"`, obligando a tocar un test
ajeno sin necesidad.

### 7.8 (DESCARTADA) Ocultar la celda cuando el conteo es 0

Ver §5.3. Deja huecos en una columna numérica, hace que la tabla y el manifiesto
digan cosas distintas del mismo hecho, y multiplica por doce los casos borde.

### 7.9 (DESCARTADA) Una llamada a `contarIntentos(ordenId)` por fila

N+1 sobre listados paginados en servidor: decenas de queries por render más la
lectura del catálogo repetida. R12 lo prohíbe.

## 8. Preguntas abiertas

### 8.1 QA1 — RESUELTA (D7): opción (a), sin mitigación

Resuelta **por medición**, no por precaución: §4.4 documenta la evidencia
(producción, 2026-07-29, **0 órdenes** que salten el umbral). Las opciones que se
descartaron se conservan aquí porque **vuelven a la mesa si la re-medición previa
al despliegue da > 0**:

| Opción | Qué implica | Coste |
| --- | --- | --- |
| **(a) ELEGIDA — sin mitigación** | El criterio aplica a todas las órdenes desde el primer pase del cron. | Cero código. Segura **porque el lote medido es 0**, no por optimismo. |
| (b) Fecha de corte | La rama B solo cuenta transiciones `reprogramada` posteriores a un corte. | Config nueva (env, sin migración); el criterio deja de ser puro. |
| (c) Revisión manual previa | Revisar el lote de §4.3 y decidir orden por orden. | Cero código; trabajo humano proporcional al lote. |
| (d) Dos entregas | Primero la UI, después el cron. | Viola R4 de forma temporal (dos números conviviendo). |

### 8.2 QA2 — DESAPARECE (D8)

Sin mitigación no hay mecanismo de corte que diseñar. Se cierra por dependencia
de QA1, no por decisión propia.

### 8.3 QA3 — RESUELTA (D9)

El manifiesto **lleva** el dato, y la regla de la 148 se deroga y reformula. Ver
§6.3, que incluye el texto de la regla nueva, por qué la premisa anterior de este
spec estaba mal, y el rastro que hay que dejar en la 148.

### 8.4 QA4 · QA5 · QA6 · QA7 — abiertas, no bloqueantes, con recomendación

**QA4 (paquete/etiqueta): no.** La vista del paquete se sirve a cualquier rol
autenticado, no al alcance de la orden; exponer ahí el conteo amplía la
visibilidad sin que ninguna decisión lo pida. **QA5 (API pública): no en esta
feature** — es contrato externo, ya roto sin aviso dos veces esta semana. **QA6
(cierre del día): no** — su grano es la gestión, no la orden. **QA7 (filas legadas
con `reprogramada` de otro origen): mantener el criterio por inclusión** — contar
de menos retrasa el escalado (inofensivo); contar de más cobra antes de tiempo.

### 8.5 QA8 — NUEVA, abierta por el cambio a columna, no bloqueante

Una columna visible que **no se puede ordenar ni filtrar** (R29, §5.5) es un
límite declarado, no un descuido: el dato es derivado y el `ORDER BY` del listado
usa lista blanca de columnas reales. Lo que queda por decidir **no es de esta
feature**: si las features **144** (filtros, PR #180 en vuelo) y **151** (export
server-side) aceptan esa asimetría en su contrato o exigen materializar el dato.
*Recomendación: aceptarlo ahora y resolverlo allí* — materializar exige migración
y reintroduce el drift de §7.4.

## 9. Verificación

- `./init.sh` en verde y suite completa en verde.
- `git diff` **sin** cambios en `db/schema.prisma` ni en `db/migrations/` (R7).
- Foco de los tests: predicado único (ambas ramas, ambas vigencias), lote de 1
  query, lote vacío sin query, degradación de catálogo, **el caso de escalado que
  cambia** (2 reprogramaciones + 1 devuelta con umbral 3 → escala), el caso que NO
  cambia (`wrong_*` escala directo sin consultar el conteo) y el doble conteo
  evitado (devuelta + reprogramación de tienda → 1).
- Las 13 superficies con su par de tests (valor ≥ 1 y valor `0`, **ambos
  visibles**), las 2 definiciones de columnas con sus preexistentes intactas, y
  los tres asserts de `ordenes-columns.test.tsx:113-117` verdes **sin tocarlos**.
- **Re-ejecución de la consulta de §4.3 justo antes del despliegue**, con su
  resultado escrito en `progress/`. Si da > 0, se para y se revisa QA1.
