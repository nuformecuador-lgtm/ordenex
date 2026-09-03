# Ficha 366 — Design

## 0. Contexto técnico ya confirmado en el árbol real (no en el grafo, que hoy no
   encuentra `zonaUnicaDeDistrito` — índice desalineado; todo lo de abajo se confirmó leyendo
   `lib/repositories/OrdenRepository.ts` y `db/schema.prisma`)

- `OrdenRepository.zonaUnicaDeDistrito<T>(zonas: readonly T[]): T | null` (línea 1776): el colapso
  1/0/>1 de la N:M, ya compartido por `findDistritosByCantonIds` y `findDistritoParaCorreccion`.
- `ZonaRepository.update` (líneas 178-214): reemplaza `zona_distrito` con `deleteMany` + `createMany`
  dentro de un `$transaction`. No toca `orden`.
- `zona_distrito` tiene `@@unique([zonaId, distritoId])` + índices por `zonaId` y por `distritoId`
  (NO hay unicidad por `distritoId` solo: un distrito en 2 zonas es legal en el esquema).
- `orden` tiene `@@index([zonaId])` y `@@index([distritoId])`; `cierre_detail` tiene
  `@@index([ordenId])`; `gestion_orden` tiene `@@index([ordenId])`. La reconciliación no necesita
  ningún índice nuevo.
- `cierre_detail` es inmutable (sin `updated_at`/`deleted_at`) y congela su propio `zona_id`,
  `es_central`, `zona_nombre` y los `tarifa_valor_*` en el instante de solicitar el cierre. Cambiar
  `orden.zona_id` después NUNCA altera una fila ya escrita ahí — es una garantía estructural, no una
  promesa de esta ficha.
- `gestion_orden.anulada_at IS NULL` es el patrón ya usado en el repo (feature 67) para "gestión
  VIGENTE".
- El catálogo del historial de acciones (ficha 362) es exhaustivo por `satisfies`/`Exclude`
  (`lib/types/historial-accion.ts`): añadir un tipo nuevo se refleja automáticamente en el listado,
  los filtros y la descarga de `/historial-de-acciones` sin tocar esa pantalla.
- Precedente directo de "avisa, no bloquea": `CorregirDatosClienteService` permite corregir la
  ubicación de una orden **aunque ya tenga un detalle de cierre** (`yaEnUnCierre: true`) — el aviso
  solo informa, no impide guardar. Es relevante para §1: ese precedente es para una corrección **con
  un humano mirando el aviso**; esta ficha no tiene a nadie mirando, así que el corte que elijo aquí
  es más conservador que el de esa pantalla, a propósito.

## 1. El corte de "ya facturada" (R6/R7/R8) — ENMENDADO en la revisión de aprobación del 2026-09-03

**Elegido:** una orden es elegible si **no está borrada**, **no tiene ninguna fila en
`cierre_detail`** (el testigo `yaEnUnCierre` ya existente, reutilizado) **y no tiene ninguna fila en
`gestion_orden` con `anulada_at IS NULL` cuyo `resultado` sea `entregada`, `rechazada` o
`incidente`**. Una gestión vigente con `resultado` `reprogramada` o `devuelta` **no** hace inelegible a
la orden.

**Por qué `incidente` se excluye (y no es un tercer caso "gratis" como `reprogramada`/`devuelta`).**
`GestionResultado` es un enum de CINCO valores —`entregada`, `reprogramada`, `devuelta`, `rechazada`,
`incidente`—, así que un incidente sí puede llegar por una gestión del mensajero, con su propia fila
en `gestion_orden` (no únicamente por el reporte de un ADMIN vía `OrdenIncidente`, que es un camino
aparte). Esa fila tiene columna `indemnizacion` (`Decimal`, nullable "mientras no se cierra", mismo
patrón que `pago_mensajero`): es dinero, igual que `entregada`/`rechazada`. Y a diferencia de
`reprogramada`/`devuelta`, `incidente` es uno de los `ESTADOS_TERMINALES` — no hay liberación
programada ni SLA de devoluciones que lo rutee después, así que no hay ningún futuro que la zona
todavía tenga que decidir. El criterio general que queda, y que hay que defender así de explícito: **se
excluye el resultado que puede llevar dinero; se incluye el resultado cuya bodega de destino aún está
por decidir.** `incidente` falla las dos condiciones a la vez (lleva dinero potencial y no tiene
destino que decidir), así que cae del lado excluido sin ambigüedad. Medido el 2026-09-03: hay **0**
gestiones con `resultado = 'incidente'` en toda la base — se excluye por prudencia (el enum lo permite
y la columna `indemnizacion` existe para eso), no porque la medición lo exija; que hoy no haya ni una
no es motivo para dejarlo del lado que sí puede mover dinero en silencio.

**Corrección de hecho sobre la versión anterior de esta sección.** La primera versión de este
documento excluía TODA gestión vigente, razonando que "un humano SÍ podría corregirla vía
`CorregirDatosClienteService`, con su aviso". Eso es falso, y lo desmiente el propio §0: ese servicio
solo re-deriva la zona cuando `provinciaId`/`cantonId`/`distritoId` **cambian de valor**
(`CorregirDatosClienteService.corregir`, paso 5.a — `if (cambios.length === 0) return { status: "ok",
cambios: [] }`). En el escenario de esta ficha el distrito de la orden **nunca cambia**: lo que cambió
es el mapa `zona_distrito`. Re-elegir el mismo distrito es un no-op, así que hoy **no existe ninguna
vía manual** para esto — es exactamente el defecto que la ficha viene a arreglar, y el corte no puede
apoyarse en un escape que no existe.

**Por qué el corte es por `resultado`, y no por "toda gestión vigente".** Medido contra el histórico
completo de producción el 2026-09-03 (evidencia de que HOY este corte no rompe nada — **no** una
garantía perpetua del esquema: `pago_mensajero`, `ingreso_bodega_rechazo` e `indemnizacion` son
columnas nullable, y nada en la base impide que una `reprogramada` o una `devuelta` empiecen a llevar
importe propio mañana):

| resultado vigente | gestiones | con `pago_mensajero` | con `ingreso_bodega_rechazo` | sin cierre todavía |
| --- | --- | --- | --- | --- |
| `entregada` | 349 | 349 | 0 | 0 |
| `rechazada` | 103 | 0 | 2 | 33 |
| `reprogramada` | 160 | 0 | 0 | 34 |
| `devuelta` | 158 | 0 | 0 | 0 |

Una `reprogramada` o una `devuelta` vigente no cargan un colón hoy (0 de 160 y 0 de 158). Excluirlas de
la reconciliación automática no solo es innecesario: es **activamente dañino**, porque las dos siguen
ruteándose HACIA ADELANTE por `orden.zonaId`:

- `lib/services/LiberacionReprogramadaService.ts:202` — `resolverDestinoCierre(orden.zonaId,
  ctx.centralZonaId)` decide a qué bodega libera una `reprogramada` cuando llega su fecha.
- `lib/services/DevolucionSlaService.ts:241` — la misma derivación para una `devuelta`.

Con el corte anterior (excluir toda gestión vigente), una `reprogramada` con la zona vieja estampada
se liberaría a la bodega EQUIVOCADA cuando el cron la suelta — el mismo atasco que motivó la ficha,
y nada podría arreglarlo nunca. El riesgo real que el corte original quería evitar —reescribir en
silencio la tarifa de algo que el mensajero ya cerró hoy y todavía no se ha facturado— vive en
`entregada` (349 de 349 con pago ya fijado) y en `rechazada` (33 sin cierre TODAVÍA: ahí la ventana
SÍ es real), y ahí la exclusión sigue vigente.

**Por qué el criterio se formula por `resultado` y no por "la gestión no tiene un importe distinto de
cero".** Las tres columnas de importe de la gestión (`pago_mensajero`, `ingreso_bodega_rechazo`,
`indemnizacion`) son `NULL` para TODA gestión —cualquiera sea su `resultado`— hasta que se aprueba su
cierre (`schema.prisma`: "NULL mientras no se cierra"). Un corte por "importe ≠ cero" sería, antes de
cualquier cierre, indistinguible de "sin corte": nunca excluiría nada, porque nada tiene importe
todavía en ese instante — dejaría pasar exactamente las 349 `entregada` y las 33 `rechazada` sin cierre
que sí hay que proteger. `resultado` es la única señal que existe ANTES del cierre y que expresa la
regla real ("una entrega o un rechazo son el momento en que el dinero de esa gestión queda decidido").
Si algún día una `reprogramada` empezara a llevar importe propio (hoy ninguna de las 160 lo lleva), ese
día hay que añadir `"reprogramada"` a la lista de resultados excluidos — es el cambio de una constante
en este archivo, documentado aquí para que no sea una sorpresa.

**Alternativa descartada A — usar `ESTADOS_SIN_CORRECCION` como corte.** Reutilizaría vocabulario
existente, pero mezcla dos preocupaciones distintas: esa lista gobierna *qué datos de cliente puede
tocar un humano* (dirección, teléfono, producto…), no *qué gestión ya tiene dinero decidido*. Además
sigue sin resolver el problema de fondo: `reprogramada`/`devuelta`/`incidente` no están en
`ESTADOS_SIN_CORRECCION` (no son terminales los dos primeros), así que ese corte por sí solo no dice
nada de si su gestión lleva dinero o no.

**Alternativa descartada B — usar solo `yaEnUnCierre` (sin mirar `gestion_orden` en absoluto).**
Bastaría para la garantía estructural de R8 (`cierre_detail` es inmutable pase lo que pase). Se
descarta porque deja una ventana real: las 33 `rechazada` sin cierre todavía tienen `resultado`
decidido y, aunque `ingreso_bodega_rechazo` hoy solo esté poblado en 2 de 103, el dato de la tienda que
paga por ese rechazo específico (₡1.700 vs ₡1.000 en el caso medido) ya depende de la zona vigente en
el momento de la gestión — cambiarla en silencio después mueve esa cifra sin que nadie lo decidiera.

**Alternativa descartada C — cortar por "gestión con importe ≠ cero" en vez de por `resultado`.** Ver
el párrafo de arriba: antes de que un cierre se apruebe, TODAS las gestiones —de cualquier
`resultado`— tienen esas tres columnas en `NULL`, así que este corte sería equivalente a "ningún
corte" en el momento exacto en que hace falta proteger algo (una `entregada`/`rechazada` recién
registrada, todavía sin cerrar). Se descarta por inútil en el caso que importa, no por incorrecto en
abstracto.

## 2. Alcance de distritos cubiertos por cada guardado (R5)

**Elegido:** la **unión** de los distritos que la zona tenía ANTES del guardado (leídos justo antes
del `deleteMany`) y los que quedan DESPUÉS (`data.distritoIds`).

**Por qué la unión y no solo "la lista final".** El encargo sugería evaluar seriamente "todos los de
la lista final", que ya resuelve el caso principal (volver a guardar la zona reconcilia su propia
deriva). Pero deja un hueco: un distrito que se ACABA DE QUITAR de esta zona en este mismo guardado
(pasa a 0 zonas, o a otra zona en una edición futura de esa otra zona) no aparece en "la lista final"
de ESTA zona, así que este guardado no lo consideraría — aunque sea precisamente el guardado que causó
que ese distrito dejara de pertenecer aquí. Con la unión, ese distrito SÍ se re-evalúa en este mismo
guardado: si tras el reemplazo resuelve una zona distinta (o ninguna), las órdenes de ese distrito se
reconcilian (o se quedan quietas, R3) en el mismo acto que produjo el cambio, no en un guardado futuro
que podría no llegar nunca.

**Alternativa descartada C — solo el diff (distritos añadidos ∪ quitados, sin los que no cambian).**
Es literalmente lo mismo que la unión cuando la lista final y la previa no comparten distritos, pero
diverge del diseño elegido en el caso común: un distrito que la zona YA tenía y sigue teniendo (no
está en el diff) puede llevar años con una orden desalineada por una edición ANTERIOR de otra zona
—el caso medido de producción, Tempisque→El Coco—. El diff no lo tocaría; la unión (que incluye los
distritos SIN cambio, porque también están en "la lista final") sí. Se descarta el diff puro por dejar
fuera exactamente el caso que motivó la ficha.

**Alternativa descartada D — recorrer el catálogo completo de distritos en cada guardado.** Detectaría
cualquier deriva en cualquier zona, no solo la que se está editando. Se descarta por
desproporcionada: el coste deja de ser "proporcional a esta zona" y pasa a ser "proporcional a todo el
catálogo geográfico" en cada guardado de cualquier zona, y excede el alcance que pidió el humano
("automático al editar las zonas", no un barrido general). Si algún día se quiere un barrido de todo
el catálogo, es una ficha aparte con su propio costo/beneficio — no este mínimo.

## 3. Modelo de datos

**Sin tablas nuevas. Sin cambios de forma en `orden`, `zona`, `zona_distrito`, `cierre_detail` ni
`gestion_orden`.** Una sola migración, aditiva:

```sql
-- UP
ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS 'orden_zona_reconciliada';
```

Mismo patrón que `20260731120000_orden_historial_origen_asignacion_recoleccion` (Postgres no permite
usar un valor de enum recién añadido en la misma transacción en que se añadió, y Prisma Migrate corre
cada `migration.sql` en su propia transacción — por eso esta migración va SOLA, sin backfill ni uso).
`down.sql` recrea el tipo `historial_accion_tipo` con los 42 valores previos (el orden exacto que
hoy tiene `CREATE TYPE` en `20260902120000_historial_accion/migration.sql`), con la misma precondición
que ya usan `20260731120000.../down.sql` y `20260729140000.../down.sql`: revertir solo es seguro si
ninguna fila de `historial_accion` usa todavía `orden_zona_reconciliada`.

`historial_accion` ya tiene RLS habilitada sin policies (solo service role) desde la ficha 362; un
valor nuevo de enum no cambia eso.

No hace falta ningún índice nuevo: `orden(distrito_id)`, `orden(zona_id)`, `cierre_detail(orden_id)` y
`gestion_orden(orden_id)` ya existen (§0).

## 4. Refactor compartido: `zonaUnicaDeDistrito` se MUEVE, no se copia

Se extrae el cuerpo de `OrdenRepository.zonaUnicaDeDistrito` (privado hoy) a un módulo puro nuevo,
junto a los demás helpers compartidos de repositorios:

```ts
// lib/repositories/_shared/zona-colapso.ts
export function zonaUnicaDeDistrito<T>(zonas: readonly T[]): T | null {
  return zonas.length === 1 ? zonas[0] : null;
}
```

`OrdenRepository` pasa a importarla (sus tres usos actuales — el método privado y las dos lecturas que
lo llaman — quedan intactos en comportamiento) y `ZonaRepository` la importa igual. Es la MISMA
función, no una reimplementación en SQL: la regla "1 vs 0 vs >1" solo existe en un sitio del árbol,
que es exactamente lo que pide el encargo ("hay que reusarlo, no re-escribirlo").

## 5. Contrato I/O

### 5.1 `IZonaRepository`

```ts
export interface UpdateZonaResult {
  zona: ZonaDTO;
  /** R12: cuántas órdenes cambiaron de zona por la re-derivación de ESTE guardado. */
  ordenesReconciliadas: number;
}

export interface IZonaRepository {
  // ...sin cambios en create/findById/list/listLite/hardDelete/countExisting*/findCentralZonaId...

  /**
   * Reemplaza datos + N:M + tarifas, y en la MISMA transacción re-deriva la zona de las órdenes
   * elegibles cuyo distrito quedó apuntando a otra zona (366/R1-R9). `actorUsuarioId` congela QUIEN
   * disparó la reconciliación (patrón `hardDelete`, ficha 362).
   */
  update(
    id: string,
    data: UpdateZonaData,
    actorUsuarioId: string | null,
  ): Promise<UpdateZonaResult | null>;
}
```

### 5.2 `ZonaService.actualizar` / `IZonaService`

```ts
export type ActualizarZonaServiceResult =
  | { status: "ok"; zona: ZonaDTO; ordenesReconciliadas: number }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden" }
  | { status: "not_found" };
```

`ZonaService.actualizar` pasa `actor.usuarioId` al repositorio (mismo patrón que ya usa
`ZonaService.borrar` con `hardDelete`) y reenvía `ordenesReconciliadas` tal cual. Sin cambios de
autorización: sigue siendo `maestro`-only (`esMaestro`).

### 5.3 `lib/types/zona.ts` / `lib/actions/zonas.ts`

```ts
export type ActualizarZonaResult =
  | { status: "ok"; zona: ZonaDTO; ordenesReconciliadas: number }
  | ZonaActionError;
```

`actualizarZona` (Server Action) no cambia de forma más allá de reenviar el campo nuevo: ya reenvía
`service.actualizar(...)` tal cual.

### 5.4 UI (`CrearZonaForm.tsx`, modo editar)

El único cambio de superficie: el `toast.success` de guardar ya distingue crear/editar
(`esEditar ? "Zona actualizada" : "Zona creada"`). Cuando `ordenesReconciliadas > 0` en modo editar, el
mensaje lo dice, p. ej. `Zona actualizada (12 órdenes reubicadas)`. Sin modal de confirmación previo:
el humano pidió automático, no un asistente de tres pasos (R1). Es la única superficie nueva; no hay
pantalla nueva, ni aviso previo, ni segunda confirmación.

## 6. Flujo transaccional (dentro de `ZonaRepository.update`, mismo `$transaction` que ya existía)

1. `exists = tx.zona.findUnique(...)`; si no existe, `return null` (sin cambios).
2. Si `data.esCentral === true`, desmarca cualquier otra central (sin cambios).
3. `zona = tx.zona.update(...)` (sin cambios).
4. **[366]** `distritosPrevios = tx.zonaDistrito.findMany({ where: { zonaId: id }, select: { distritoId: true } })` — ANTES de tocar la N:M.
5. `tx.zonaDistrito.deleteMany({ where: { zonaId: id } })` + `createMany(data.distritoIds)` (sin cambios).
6. Reemplazo de `tarifaZonaMensajero` (sin cambios).
7. **[366]** `distritosAfectados = únicos(distritosPrevios.distritoId, data.distritoIds)` (§2). Si está
   vacío, `ordenesReconciliadas = 0` y se salta a 12.
8. **[366]** `filas = tx.zonaDistrito.findMany({ where: { distritoId: { in: distritosAfectados } }, select: { distritoId: true, zonaId: true } })` — el estado YA reemplazado.
9. **[366]** Agrupa `filas` por `distritoId` y aplica `zonaUnicaDeDistrito` (§4) a cada grupo. Descarta
   los que resuelven `null` (R3). Vuelve a agrupar el resultado por la zona resuelta:
   `Map<zonaResueltaId, distritoId[]>`.
10. **[366]** Si el mapa de 9 no está vacío: `loteId = randomUUID()` (una vez, R11) y
    `actor = resolverActorCongelado(tx, actorUsuarioId)` (una vez). Para cada
    `(zonaResueltaId, distritoIds)` del mapa:
    - `elegibles = tx.orden.findMany({ where: { distritoId: { in: distritoIds }, zonaId: { not: zonaResueltaId }, deletedAt: null, cierreDetalles: { none: {} }, gestiones: { none: { anuladaAt: null, resultado: { in: ["entregada", "rechazada", "incidente"] } } } }, select: { id: true, numGuia: true, numRemision: true } })` (R6/R7 — Prisma expresa las dos exclusiones como `NOT EXISTS` sin SQL crudo; la exclusión de gestión ahora es "vigente Y con resultado entregada/rechazada/incidente", no "vigente" a secas — design §1).
    - Si `elegibles.length === 0`, siguiente grupo.
    - `tx.orden.updateMany({ where: { id: { in: elegibles.map(o => o.id) } }, data: { zonaId: zonaResueltaId } })` (R4, R9 — solo `zonaId`).
    - `appendAccion(tx, elegibles.map(o => ({ accion: "orden_zona_reconciliada", entidadTipo: "orden", entidadId: o.id, entidadEtiqueta: etiquetaDeEntidad("orden", { numGuia: o.numGuia, numRemision: o.numRemision }), ...actor })), loteId)` (R10/R11 — mismo patrón que `corregirDatosCliente`, `valorAnterior`/`valorNuevo`/`monto` van `null`).
    - `ordenesReconciliadas += elegibles.length`.
11. Recarga tarifas para el DTO (sin cambios).
12. `return { zona: toDTO(...), ordenesReconciliadas }`.

**Riesgo de concurrencia aceptado, y por qué.** El paso 10 lee ids elegibles y luego los actualiza en
DOS sentencias (no una `UPDATE ... RETURNING`). Existe una ventana teórica en la que otra transacción
podría escribir sobre una de esas órdenes entre la lectura y la escritura. Se acepta porque: (a) es un
camino `maestro`-only, de baja frecuencia (editar la configuración de zonas, no una acción operativa de
mensajero/bodega en caliente); y (b) el propio filtro de elegibilidad hace ese solape más improbable
todavía (una orden sin cierre y sin gestión vigente no es el tipo de fila que otra transacción esté
tocando en ese instante). Alternativa descartada abajo.

## 7. Historial de acciones

- **Tipo:** `orden_zona_reconciliada` (nuevo, catálogo de `lib/types/historial-accion.ts`).
- **Categoría:** `mueve_dinero` — misma razón que `orden_ubicacion_corregida`: el distrito re-deriva
  la zona y la zona decide la tarifa que se factura.
- **Entidad:** `orden` (ya existe; no hace falta una entidad nueva).
- **Etiqueta:** `etiquetaDeEntidad("orden", { numGuia, numRemision })` — la guía, o la remisión si no
  hay guía, nunca datos del destinatario (R10).
- **`valorAnterior`/`valorNuevo`/`monto`:** `null` los tres — mismo patrón que
  `orden_ubicacion_corregida`: la fila registra el HECHO, no los valores (D4 de la 312 sigue
  protegiendo eso).
- **`loteId`:** uno por guardado de zona (R11), aunque ese guardado toque más de una zona resuelta
  distinta (grupo del paso 10).
- **Etiqueta legible del tipo:** "Actualizó la zona de una orden" (mismo registro de voz que
  "Actualizó una tarifa").
- La pantalla `/historial-de-acciones` NO necesita cambios: el catálogo es exhaustivo por
  `satisfies`/`Exclude`, así que el nuevo tipo aparece solo en el selector de filtros, el listado y la
  descarga.

**No se registra ninguna fila sobre la ZONA editada por este mecanismo** (ni `zona_actualizada` ni
similar): editar el nombre/distritos/tarifas de una zona hoy no deja rastro propio en absoluto (solo
`zona_borrada` existe en el catálogo), y esa es una carencia previa y distinta de lo que esta ficha
resuelve. Añadir auditoría genérica de "se editó una zona" es una ficha aparte, no un arreglo mínimo de
lo evidenciado.

## 8. Riesgos declarados (no escondidos)

- **Mover una orden de bandeja mientras el paquete viaja.** Reconciliar `orden.zona_id` de una orden
  `en_ruta_bodega_satelite` cambia inmediatamente qué bodega satélite puede recibirla
  (`OrdenRepository.recibirEnSatelite` acota su guarda por `zonaId`). En el caso medido esto es
  EXACTAMENTE lo correcto (la orden estaba bloqueada en la bodega equivocada). No hay pantalla nueva
  ni aviso al `adminSatelite`: lo que ve el operador es que la orden aparece en la bandeja de la zona
  correcta y deja de aparecer en la de la zona vieja, en el instante en que se guarda la zona — el
  mismo efecto que ya produce cualquier lectura acotada por `zonaId` hoy. El rastro auditable para
  reconstruir "por qué se movió" es el historial de acciones (§7), no una notificación en vivo.
- **Deriva residual no resuelta, y sin vía manual hoy.** Un distrito que resuelve 0 o >1 zonas, o una
  orden con detalle de cierre o con una gestión vigente `entregada`/`rechazada`, se queda con la zona
  vieja (R3/R7). A diferencia de lo que decía una versión anterior de este documento, **hoy no hay
  ninguna vía manual** para corregir esto (§1): `CorregirDatosClienteService` solo re-deriva la zona
  cuando el distrito cambia de VALOR, y aquí no cambia. La única forma de que se resuelva es (a) un
  guardado futuro de alguna zona cuyo `distritosAfectados` (§2) vuelva a incluir ese distrito y este
  ya resuelva una única zona, o (b) una intervención directa en base de datos, como la que hizo el
  leader el 2026-09-03 fuera de esta ficha. No hay conteo de esta deuda residual en la respuesta
  (Q2 de `requirements.md`, cerrada: no se añade).
- **Re-estampar una `reprogramada` cambia a qué bodega la libera el cron.** Es la consecuencia
  DIRECTA y BUSCADA de la enmienda de §1: `LiberacionReprogramadaService` y `DevolucionSlaService`
  derivan la bodega de liberación de `orden.zonaId` EN EL MOMENTO de liberar, así que una
  reconciliación que corrige la zona de una `reprogramada` hoy cambia a qué bodega la manda esa
  liberación mañana. Es exactamente lo que hay que corregir (evita repetir el atasco medido). El
  efecto que hay que declarar: si el paquete de esa `reprogramada` YA viajó físicamente a la bodega
  vieja antes de que la liberación ocurra, el operador de esa bodega verá la orden desaparecer de su
  bandeja de liberaciones pendientes y aparecer en la de la bodega nueva sin ningún aviso en pantalla
  — mismo patrón, mismo canal de auditoría (historial de acciones) que el riesgo ya declarado arriba
  para `en_ruta_bodega_satelite`.
- **Ninguna wallet, ninguna liquidación, ningún `cierre_detail` se toca.** Estructuralmente cierto
  (§0), no solo declarado: no hay ningún `write` a esas tablas en el flujo del §6.

## 9. Fuera de alcance (y por qué)

- **Tabla de historial de zonas / versionado de `zona_distrito`.** Ya descartado por el encargo:
  "arregla lo evidenciado, no rediseñes". `historial_accion` ya es el rastro append-only que hace
  falta (§7); una tabla adicional duplicaría esa función.
- **Motor de reglas de re-tarifado.** No hay reglas condicionales que configurar: la regla es la MISMA
  que ya usa la carga masiva y la corrección manual (§4), aplicada automáticamente.
- **`ZonaRepository.create`.** Una zona recién creada no puede, por construcción, ser "la zona
  correcta" de una orden preexistente sin que antes se le quite ese distrito a otra zona (lo que
  vuelve ambiguo al distrito mientras ambas ediciones no se hayan hecho, R3). El humano pidió
  "automático **al editar** las zonas"; crear no genera el tipo de deriva que esta ficha corrige.
- **Notificación al mensajero o al `adminSatelite`.** Fuera de alcance: el humano pidió automático y
  económico, no un asistente de tres pasos. El historial de acciones es la vía de auditoría (§7/§8).
- **Retarifar `cierre_detail` ya emitido.** Explícitamente prohibido por el humano y, además,
  estructuralmente imposible sin una migración que reescriba filas inmutables (§0) — no se toca.
- **Conteo de deriva residual (Q2).** Ver `requirements.md`.

## 10. Alternativas descartadas (resumen, con motivo en su sección)

| Alternativa | Sección | Por qué se descarta |
| --- | --- | --- |
| Corte de elegibilidad = `ESTADOS_SIN_CORRECCION` | §1-A | Mezcla "qué dato puede tocar un humano" con "qué gestión ya tiene dinero decidido"; no dice nada de si `reprogramada`/`devuelta`/`incidente` llevan importe. |
| Corte de elegibilidad = solo `yaEnUnCierre` (sin mirar `gestion_orden`) | §1-B | Deja sin proteger las 33 `rechazada` vigentes sin cierre todavía (dato medido 2026-09-03). |
| Corte de elegibilidad = "gestión con importe ≠ cero" en vez de por `resultado` | §1-C | Antes de cualquier cierre, esas columnas son NULL para toda gestión sin importar el resultado: el corte sería equivalente a no tener ninguno, justo cuando hace falta. |
| Alcance = solo el diff de distritos | §2-C | Deja fuera el caso medido: distrito sin cambio en este guardado pero con deriva de una edición anterior. |
| Alcance = catálogo completo de distritos | §2-D | Desproporcionado; excede "automático al editar **las** zonas" tal como lo pidió el humano. |
| `UPDATE ... RETURNING` (patrón `softDelete`) en vez de find-then-update | §6 | Correcto y más seguro ante concurrencia, pero en un camino `maestro`-only de baja frecuencia el find-then-update es más simple y ya da los tres campos (`id`, `numGuia`, `numRemision`) sin SQL crudo. Documentado como riesgo aceptado, no ignorado. |
