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

## 1. El corte de "ya facturada" (R6/R7/R8)

**Elegido:** una orden es elegible si **no está borrada**, **no tiene ninguna fila en
`cierre_detail`** (el testigo `yaEnUnCierre` ya existente, reutilizado) **y no tiene ninguna fila en
`gestion_orden` con `anulada_at IS NULL`** ("gestión vigente", vocabulario ya usado por la feature 67).

**Por qué esas dos condiciones y no una sola:**

- Con **solo** `yaEnUnCierre`, el corte sería literalmente "no se retarifa hacia atrás" en su sentido
  más estricto — y sería *suficiente* para la garantía estructural de R8, porque `cierre_detail` es
  inmutable pase lo que pase con `orden.zona_id`. Pero una automatización SIN humano delante no tiene
  el aviso que sí tiene `CorregirDatosClienteService`: reescribir en silencio la zona de una orden que
  el mensajero ya entregó/rechazó/devolvió HOY, antes de que el cierre del día se solicite, cambiaría
  qué tarifa se le va a facturar a esa gestión sin que nadie lo haya decidido explícitamente. Excluir
  también las órdenes con gestión vigente es la manera de no tomar esa decisión por nadie.
- Es, además, la regla que el propio leader usó el 2026-09-03 para el re-estampado manual de las 42
  (`NOT EXISTS cierre_detail` **y** `NOT EXISTS gestion_orden no anulada`) — una decisión ya
  contrastada contra producción, no un supuesto nuevo.
- Es **más estrecha** que `ESTADOS_SIN_CORRECCION` (los 4 terminales de
  `lib/types/correccion-datos-cliente.ts`) y así debe ser: una orden `reprogramada` tiene una fila de
  gestión vigente (resultado `reprogramada`, `anulada_at` NULL) aunque `reprogramada` NO esté en
  `ESTADOS_SIN_CORRECCION`. Esta ficha la deja fuera de la automatización — no porque esté prohibido
  tocarla (un humano SÍ podría corregirla vía `CorregirDatosClienteService`, con su aviso), sino
  porque nadie la está mirando en este camino automático.
- Un `incidente` reportado por un ADMIN (no por gestión del mensajero, vía `OrdenIncidente`, no vía
  `gestion_orden`) queda fuera de la exclusión (b) pero SÍ está cubierto: en la práctica un `incidente`
  reportado sin que medie una gestión previa es un estado terminal poco frecuente y, si además no
  tiene cierre, sigue siendo elegible — que es lo correcto: no hay dinero en juego (no hay
  `cierre_detail`) y no hay una gestión del mensajero en curso que este cambio pudiera contradecir.

**Alternativa descartada A — usar `ESTADOS_SIN_CORRECCION` como corte.** Reutilizaría vocabulario
existente, pero mezclaría dos preocupaciones distintas: esa lista gobierna *qué datos de cliente puede
tocar un humano* (dirección, teléfono, producto…), no *cuándo es seguro que un proceso automático,
sin aviso, mueva silenciosamente la zona*. Se descarta porque dejaría fuera del corte a órdenes con
gestión vigente pero no terminal (`reprogramada`), exactamente el caso que §1 quiere evitar.

**Alternativa descartada B — usar solo `yaEnUnCierre`.** Es la lectura más literal de "no se retarifa
hacia atrás" y bastaría para la garantía de inmutabilidad. Se descarta porque es *insuficiente* para
el caso sin aviso: dejaría que la automatización reescriba la zona de una orden con una entrega/rechazo
ya registrado hoy mismo, sin que ningún humano lo haya confirmado — el mismo dinero que
`CorregirDatosClienteService` sí hace confirmar explícitamente (R11 de la 327) antes de tocarlo.

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
    - `elegibles = tx.orden.findMany({ where: { distritoId: { in: distritoIds }, zonaId: { not: zonaResueltaId }, deletedAt: null, cierreDetalles: { none: {} }, gestiones: { none: { anuladaAt: null } } }, select: { id: true, numGuia: true, numRemision: true } })` (R6/R7 — Prisma expresa las dos exclusiones como `NOT EXISTS` sin SQL crudo).
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
- **Deriva residual no resuelta.** Un distrito que resuelve 0 o >1 zonas, o una orden con detalle de
  cierre o gestión vigente, se queda con la zona vieja (R3/R7) hasta que alguien la corrija a mano
  (vía `CorregirDatosClienteService`, que sigue funcionando igual, con su aviso) o hasta que el
  distrito vuelva a resolver una única zona en un guardado futuro. No hay conteo de esta deuda
  residual en la respuesta (Q2 de `requirements.md`).
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
| Corte de elegibilidad = `ESTADOS_SIN_CORRECCION` | §1-A | Mezcla dos preocupaciones distintas; deja fuera del corte una orden `reprogramada` con gestión vigente. |
| Corte de elegibilidad = solo `yaEnUnCierre` | §1-B | Insuficiente sin el aviso humano que sí tiene la corrección manual. |
| Alcance = solo el diff de distritos | §2-C | Deja fuera el caso medido: distrito sin cambio en este guardado pero con deriva de una edición anterior. |
| Alcance = catálogo completo de distritos | §2-D | Desproporcionado; excede "automático al editar **las** zonas" tal como lo pidió el humano. |
| `UPDATE ... RETURNING` (patrón `softDelete`) en vez de find-then-update | §6 | Correcto y más seguro ante concurrencia, pero en un camino `maestro`-only de baja frecuencia el find-then-update es más simple y ya da los tres campos (`id`, `numGuia`, `numRemision`) sin SQL crudo. Documentado como riesgo aceptado, no ignorado. |
