# Feature 239 — Diseño técnico

> Requisitos en `requirements.md`. Enfoque **decidido por el humano** (`progress/design_pila_ayuda_tienda.md`
> §F5): **partir el estado**. Aquí se documenta el porqué para que quede en el repo, no para reabrirlo.
>
> El nombre del pre-estado está pendiente de firma (P1). En todo este documento se usa el
> **placeholder `⟨PRE⟩`**, con la recomendación `devolucion_por_confirmar`. Sustituir en un solo
> commit al recibir la firma.

---

## 0. El fallo, en una línea de causa y efecto

`novedadWhere` (`lib/repositories/OrdenRepository.ts:2942`) exige `gestionAprobada: true` para listar
una devuelta. `findDevueltasSla` (`lib/repositories/DevolucionSlaRepository.ts:38-55`) filtra solo
por `deletedAt` + `estatus = devuelta` y ancla en `gestion.createdAt` (`:67`); `DevolucionSlaService`
menciona `gestionAprobada` **cero veces**. Con p90 de 22,1 h de retraso gestión→aprobación y ventana
`not_found` de 24 h, hay órdenes que se escalan y **se cobran** sin haber sido visibles nunca.

Las dos mitades tienen que mirar **el mismo hecho**. Este diseño hace que ese hecho sea **el estado
de la orden**, que es el único dato que las dos ya consultan por construcción.

---

## 1. Modelo de datos

### 1.1 Tablas nuevas: ninguna. RLS nueva: ninguna

No se crean tablas. Se reutilizan `orden`, `order_status`, `gestion_orden` y
`orden_historial_estado`, todas con su RLS ya declarada. No hay política nueva que escribir ni
superficie nueva que aislar.

### 1.2 Un value nuevo en el catálogo `order_status`

`⟨PRE⟩` entra como **apéndice** de `ORDER_STATUS_SEED` (`lib/types/order-status.ts`), sin renombrar,
reordenar ni retirar ninguno de los 20 vigentes. El catálogo pasa de 20 a 21.

Migración `db/migrations/<ts>_order_status_devolucion_por_confirmar/`:

- `migration.sql`: `INSERT INTO "order_status" ("value", …) SELECT … WHERE NOT EXISTS (SELECT 1 FROM
  "order_status" WHERE "value" = '⟨PRE⟩');` — patrón exacto de la 139 y la 154.
- `down.sql`: `DELETE FROM "order_status" WHERE "value" = '⟨PRE⟩' AND NOT EXISTS (…referencias en
  "orden" ni en "orden_historial_estado"…);` — patrón de la 155: **si alguien lo referencia, la fila
  sobrevive huérfana**. El historial es append-only y no se reescribe (R32).

### 1.3 Un value nuevo en el enum `orden_historial_origen_tipo`

`anclaje_devolucion` (P8), la familia de la transición ⟨PRE⟩ → `devuelta`.

- `migration.sql`: `ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS
  'anclaje_devolucion';`
- `down.sql`: RENAME a `_old`, `CREATE TYPE` **con la lista vigente hoy** (24 valores, los de
  `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED`), `ALTER TABLE … USING (…::text::…)`, `DROP TYPE …_old`. Patrón
  de `20260714160000_gestion_orden_anulacion/down.sql`.
- **Los `down.sql` de migraciones anteriores de este enum NO se tocan**: son fotos históricas. Lo que
  sí hay que comprobar es si alguno recrea el tipo con lista cerrada; si lo hace, aplicar ese down
  después de esta migración deja el enum sin el value nuevo — condición conocida del rollback
  encadenado, se documenta y se prueba con `tests/integration/db`.
- TS: `anclaje_devolucion` entra en `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` (el `satisfies` +
  `_EnsureExhaustive` rompen el build si el SEED y el enum divergen). **NO entra** en
  `ORIGEN_TIPOS_VISITA_REAL` — es una confirmación administrativa, no una visita; meterlo ahí subiría
  el conteo de intentos, adelantaría el escalado y cobraría antes de tiempo. **NO entra** en
  `ORIGEN_TIPOS_CON_GESTION`: esa lista solo desambigua la nulidad del enlace, y esta familia sí
  enlaza la gestión ancla (mismo caso que `escalado_devuelta_sla`, que tampoco está).

### 1.4 La columna `orden.gestion_aprobada` se RETIRA

Es la mitad implementada del fallo y **queda reemplazada por el estado**. Se retira junto con:

| Sitio | Qué hace hoy | Qué pasa |
| --- | --- | --- |
| **Encendedor** — `CierresAdminRepository.resolverCierre:1018-1021` | `updateMany` a `true` sobre las órdenes con gestión `devuelta` de ese cierre, **sin acotar estatus** | Se **sustituye** por el bloque de anclaje (§3). El defecto de no acotar estatus desaparece: el bloque nuevo está guardado por `⟨PRE⟩`. |
| **Apagador 1** — `DevolucionSlaRepository.liberarDevueltaSla:104` | `gestionAprobada: false` en el `data` del `updateMany` guardado | Se borra la línea. El resto del método no cambia. |
| **Apagador 2** — `OrdenRepository.habilitarNovedad:2980` | `{ ayuda: false, gestionAprobada: false }` | Pasa a `{ ayuda: false }`. Ver P9/R23. |
| **Lector** — `OrdenRepository.novedadWhere:2942` | `{ estatus: devuelta, gestionAprobada: true }` | Vuelve a ser `{ estatus: { value: "devuelta" } }`. |
| **Schema** — `db/schema.prisma:504` | columna | Se retira del modelo. |

Migración `db/migrations/<ts>_orden_retiro_gestion_aprobada/`:

- `migration.sql`: `ALTER TABLE "orden" DROP COLUMN "gestion_aprobada";`
- `down.sql`: `ALTER TABLE "orden" ADD COLUMN "gestion_aprobada" boolean NOT NULL DEFAULT false;`
  **Pérdida de dato declarada:** el down repone la columna, no sus valores. Es aceptable porque la
  columna queda semánticamente muerta: ningún valor suyo significa nada después de este cambio, y el
  código anterior la leía con `DEFAULT false`, que es lo que el down deja.

**Esta migración ES el arreglo del recorte retroactivo (R30/P6).** Hoy toda orden anterior a la
columna vale `false` y **cae de `/novedades`**; al desaparecer la columna, el predicado vuelve a ser
una igualdad de estado y esas órdenes se ven solas. No hace falta backfill, y por eso no lo hay.

### 1.5 Índices

Ninguno nuevo.

- El bloque de anclaje filtra `gestion_orden` por `cierre_id` (`@@index([cierreId])` existente, mismo
  apoyo que usan los cinco feeds de dinero de la misma transacción) y `orden` por `id in (…)` (PK).
- El cron lee `orden` por `estatus_id` (índice existente, el mismo que usa hoy) y
  `orden_historial_estado` por `(orden_id, created_at)` (`@@index([ordenId, createdAt])`, existente).
  **Se apoya en ese índice a propósito**: no hay índice por `origen_tipo` solo, así que el filtro por
  familia queda como residual sobre el puñado de filas de esa orden. Es el mismo truco que
  `whereIntentosVigentes` documenta.

---

## 2. El mapa `resultado → estatus`: la bisagra

Hoy el destino de una gestión se deriva por **identidad de nombre**:

```ts
// lib/services/MisAsignacionesService.ts:388
const nuevoEstatusId = await this.ordenRepo.findEstatusIdByValue(input.resultado);
```

Funciona porque los cuatro resultados (`entregada`, `reprogramada`, `devuelta`, `rechazada`) y el
quinto (`incidente`) se llaman **igual** que su estado destino. Esta feature rompe esa identidad para
uno de ellos, y por eso hay que **crear el mapa**. Es el punto donde entra todo F5.

```ts
// lib/types/gestion-destino.ts  (módulo PURO: sin Prisma, sin servicios)
export const ESTATUS_POR_RESULTADO = {
  entregada:   "entregada",
  reprogramada:"reprogramada",
  rechazada:   "rechazada",
  incidente:   "incidente",
  devuelta:    "⟨PRE⟩",   // ← la única que deja de ser identidad
} as const satisfies Record<GestionResultado, OrderStatusValue>;
```

Dos `satisfies`, dos redes distintas: `Record<GestionResultado, …>` rompe el build si el enum de
resultados gana un valor sin destino declarado; `OrderStatusValue` rompe el build si el destino no
existe en el catálogo. El servicio pasa a `findEstatusIdByValue(ESTATUS_POR_RESULTADO[input.resultado])`.

**El mapa vive en `lib/types/`, no dentro del servicio**, porque lo necesitan al menos tres lectores
(el servicio de gestión, la tabla de estados esperados del deshacer, y los tests del inventario de
transiciones) y una segunda copia es exactamente la clase de divergencia que este repo persigue con
guardias.

---

## 3. El tercer bloque de `resolverCierre`

`CierresAdminRepository.resolverCierre` ya tiene dos bloques con esta forma exacta, dentro del
`if (res.count === 1 && nuevoEstado === "aprobado")`: `liberacionSinGestionar` (109, `:1111-1171`) y
`devolucionRechazadas` (139, `:1183-1236`). El bloque de anclaje es el **tercero, copia literal de
esos dos**: leer candidatas → `updateMany` GUARDADO por el estado de origen → `appendCambioEstado`
solo si `count > 0`.

### 3.1 Forma

```
si (aprobado):
  1. gestiones = tx.gestionOrden.findMany({ cierreId, resultado: 'devuelta', anuladaAt: null })
                 select { id, ordenId }
     → si vacío: no-op, sin consultas extra
  2. vigentes  = tx.gestionOrden.findMany({ ordenId: { in: ordenIds },
                                            resultado: 'devuelta', anuladaAt: null },
                                          orderBy: [ordenId, createdAt desc], select { id, ordenId })
     → en memoria: primera fila por ordenId = gestión `devuelta` vigente MÁS RECIENTE
  3. anclables = ordenIds cuya gestión vigente más reciente ES la de ESTE cierre     ← R4c / R5
  4. movidas = tx.orden.updateMany({ where: { id: { in: anclables },
                                              estatusId: preEstadoId,               ← guarda R4a
                                              deletedAt: null },
                                     data: { estatusId: devueltaId } })              ← money-neutral
  5. si (movidas.count > 0) appendCambioEstado(tx, anclables.map(…{
       estatusOrigenId: preEstadoId, estatusDestinoId: devueltaId,
       actorUsuarioId: resueltoPor, origenTipo: 'anclaje_devolucion',
       gestionOrdenId: <la gestión ancla de esa orden> }))
```

**Paso 2, y por qué es una consulta y no N:** la carrera que cuesta dinero (§4) exige comprobar
recencia **dentro de la transacción**. `GestionOrdenRepository.reprogramarDesdeDevuelta:554` hace ese
`findFirst` para una orden; aquí son N, así que se hace un `findMany` ordenado y se recorta en
memoria. Un `findFirst` por orden dentro de la transacción del dinero es un N+1 en la ruta más
caliente y más cara del sistema.

**El `updateMany` guardado por `estatusId = preEstadoId` es lo que da la idempotencia (R8)**, igual
que en los otros dos bloques: una segunda ejecución encuentra las órdenes ya en `devuelta`,
`count = 0`, y no hay append. No hay código de idempotencia; la hay por construcción.

**El `gestionOrdenId` en el append** enlaza la gestión que ancla. No es decorativo: es lo que permite
auditar *qué* devolución se confirmó con *qué* aprobación sin volver a derivarlo.

### 3.2 Dónde va, exactamente

**Al final del bloque `aprobado`, después del de `devolucionRechazadas`.** Razón: el bloque es
money-neutral, pero `tests/unit/repositories/cierres-admin-caja-cod.test.ts` **mide el orden de las
llamadas** dentro de la transacción, porque los feeds se leen unos a otros (la caja lee lo que el
ledger acaba de escribir). Insertar el bloque nuevo entre medias no rompe el dinero, pero sí mueve
las aserciones de orden sin ninguna ganancia. Al final no toca ninguna.

Nota fáctica que evita un susto: el `updateMany` del `gestion_aprobada` de hoy está **antes** de las
indemnizaciones. Moverlo al final no cambia nada porque ningún feed lee `orden.estatus_id` — hay que
**verificarlo, no suponerlo** (tarea T2.4).

### 3.3 El parámetro es OBLIGATORIO, no opcional

`liberacionSinGestionar` y `devolucionRechazadas` son opcionales (`if (liberacionSinGestionar)`), y
si el composition root se los olvida, la aprobación funciona y la liberación no ocurre: se degrada en
silencio. **Aquí eso es inaceptable**: sin el bloque, la orden se queda en `⟨PRE⟩` para siempre,
invisible y sin reloj, y nadie se entera.

Por eso `ResolverCierreInput` gana `anclajeDevolucion: { preEstadoId: string; devueltaId: string }`
**requerido**. Un olvido de cableado rompe el typecheck, que es donde tiene que romper. Coste
conocido y aceptado: todos los dobles de test de `resolverCierre` tienen que pasarlo.

Y el servicio resuelve esos dos ids **antes** de llamar al repo; si alguno es `null` (seed
incompleto), **rechaza la aprobación entera** (R9), sin efectos parciales. Fallo cerrado: aprobar sin
poder anclar es exactamente el estado del que esta feature viene a sacarnos.

### 3.4 `cierre_dia.resuelto_at` NO se usa. Nunca

Se escribe **igual al rechazar** (`resolverCierre:998`, fuera de la rama `aprobado`), y
`forzarSolicitudVencido` reabre un cierre **sin limpiarla**. Cualquier derivación que la use lleva
`estado = 'aprobado'` pegado o miente. Este diseño no la usa en ningún sitio: el anclaje no lee
fechas del cierre, **es** una transición con su propia fila de historial.

---

## 4. Las carreras

| # | Carrera | Estado |
| --- | --- | --- |
| 1 | **Dos cierres de la misma orden** | **Mitigada, y es la que cuesta dinero.** g1 en C1 (pendiente) → un admin recupera a bodega → reasignación → g2 en C2. Si C1 se aprueba mientras la orden está en `⟨PRE⟩` por g2, la anclaría con una aprobación *anterior* al hecho real: el reloj arrancaría antes, el escalado ocurriría antes y **se cobraría el rechazo antes de tiempo**. Mitigación: paso 3 del §3.1 — la gestión del cierre tiene que ser la `devuelta` vigente **más reciente** de la orden, comprobado **dentro de la transacción**. |
| 2 | Cron ↔ aprobación | Cerrada. El cron solo ve `devuelta`; una orden en `⟨PRE⟩` no es candidata (R13). |
| 3 | Re-aprobación / doble submit | **Imposible por construcción** bajo este enfoque: el `updateMany` guardado por `⟨PRE⟩` ya no encuentra nada. |
| 4 | Reprogramación manual de la tienda | Cerrada. `ReprogramacionTiendaService` exige `= devuelta` y su repo vuelve a guardar por `estatus_id = devuelta`. |
| 5 | Deshacer gestión ↔ aprobación | Cerrada. La ventana de deshacer es `cierre_id IS NULL`; al crear el cierre la gestión queda vinculada y ya no se deshace. |

---

## 5. El reloj: cómo se deriva el anclaje

`findDevueltasSla` pasa de anclar en `gestion.createdAt` a anclar en **el instante de la transición a
`devuelta`**, con **rama legada nombrada**:

```
select de orden (estatus = devuelta, deletedAt null):
  gestiones:        where { resultado devuelta, anuladaAt null } desc take 1   ← causa + mensajero (igual que hoy)
  historialEstados: where { origenTipo: 'anclaje_devolucion' }  desc take 1   ← el ancla
```

- **Fila de anclaje presente** → `ancladaAt = historial[0].createdAt`, `origenAncla = 'aprobacion'`.
- **Ausente** → `ancladaAt = gestion[0].createdAt`, `origenAncla = 'legado'` (R14). Es el caso de las
  órdenes que llegaron a `devuelta` antes de esta feature; **no es un fallback silencioso**: viaja en
  el DTO y el servicio lo cuenta, para que la población legada sea observable y se pueda ver
  extinguirse.
- **`take 1` con `orderBy createdAt desc`** implementa R15: si la orden dio la vuelta entera y
  volvió, gana el anclaje más reciente.

`venceVentana` no cambia: sigue siendo rolling en milisegundos desde el ancla (P5). Lo único que
cambia es **qué instante es el ancla**.

Se reescribe además el bloque de JSDoc de `DevolucionSlaService.ts:122` que aún dice «Q5, **ABIERTA**»:
Q5 está **CERRADA con riesgo ACEPTADO** desde el 2026-08-13 (D14). Es prosa caducada y citarla ha
llevado ya una vez a conclusiones falsas.

---

## 6. Los dos criterios que miran «cierre aprobado» y NO se fusionan

Esto es una restricción de diseño, no una observación.

| | **Conteo de intentos** (`whereIntentosVigentes`) | **Anclaje de la devolución** (esta feature) |
| --- | --- | --- |
| Pregunta | ¿En cuántos cierres aprobados distintos tuvo esta orden un resultado contable vigente? | ¿En qué instante entró esta orden en `devuelta`? |
| Grano | N cierres × 1 orden, `COUNT(DISTINCT cierre_id)` | 1 transición, 1 timestamp |
| Fuente | `gestion_orden` + `cierre.estado` + familia de visita real | `orden_historial_estado`, familia `anclaje_devolucion` |
| Vida | Monótono creciente; nunca baja | Se re-escribe en cada vuelta del ciclo |
| Dirección del error | Contar de **más** cobra antes de tiempo | Anclar **tarde** retrasa el cobro |

Comparten una palabra («aprobado») y nada más. Un helper compartido tipo `esCierreAprobado()` es
tentador y **está mal**: acopla dos derivaciones cuyos errores van en direcciones opuestas, y la
primera vez que alguien "optimice" una, la otra cambia de comportamiento en silencio y con dinero
detrás.

Las guardias `tests/unit/services/intentos-entrega-criterio-unico.test.ts` y
`tests/unit/types/criterio-intento-entrega.test.ts` **tienen que quedar verdes sin tocarse**. Si se
ponen rojas, alguien las unificó: es regresión, no aserción a actualizar.

---

## 7. Transiciones (feature 140)

La guardia de transiciones es **exhaustiva y rompe el build**: es la red principal de este trabajo.

**Altas:**

| Arista | Familia | Rol | Productor |
| --- | --- | --- | --- |
| `en_reparto → ⟨PRE⟩` | `gestion` | mensajero | `GestionOrdenRepository.crearGestionYTransicionar` (vía el mapa de §2) |
| `⟨PRE⟩ → devuelta` | `anclaje_devolucion` | admin (aprobar cierre) | el bloque de §3 |
| `⟨PRE⟩ → en_reparto` | `deshacer_gestion` | mensajero | `CierreDiaRepository.anularGestionYDevolverAGestion` |
| `⟨PRE⟩ → en_bodega_central` | `recuperacion_manual` | maestro/admin/adminSatélite | **solo si P4 = sí** |
| `⟨PRE⟩ → en_bodega_satelite` | `recuperacion_manual` | adminSatélite | **solo si P4 = sí** |

**Baja:** `en_reparto → devuelta` (#14). Pierde su único productor en el mismo commit, y la
convención del repo es que una arista solo muere en el commit de su último productor. Las siete
salidas de `devuelta` (#19-#24, #36) **se conservan intactas**: siguen teniendo productor y siguen
siendo el camino de las órdenes ya ancladas.

**Invariante de conectividad (140/R14):** `⟨PRE⟩` tiene entrada y salida, así que no entra en
terminales ni en vestigiales.

---

## 8. Superficies de estatus: las que rompen el build y las que no

**Rompen el build al añadir el value** (son `Record` totales o `satisfies` exhaustivos) — no hay que
buscarlas, el compilador las señala:

1. `lib/types/order-status-transiciones.ts` — `TRANSICIONES` + `_EnsureExhaustive`.
2. `app/(app)/ordenes/_components/EstatusBadge.tsx` — `ORDER_STATUS_LABELS` y `ORDER_STATUS_VARIANT`.
3. `lib/types/rastreo-publico.ts` — `HITO_POR_ESTATUS` es `satisfies Record<OrderStatusValue, HitoPublico>`.

**NO rompen el build y hay que revisarlas a mano.** Es la lista de olvidos probables, y cada una
tiene una consecuencia concreta:

| Archivo | Si se olvida | Decisión |
| --- | --- | --- |
| `app/(app)/ordenes/exclude-por-rol.ts` | Un estado no listado **auto-aparece** como opción de filtro para el rol. El `adminTienda` vería `⟨PRE⟩` en su desplegable, que es justo lo que no debe ver. | `⟨PRE⟩` entra en la exclusión del `adminTienda`, junto a `devuelta`. Maestro/admin lo ven (solo excluyen `pendiente`). |
| `lib/types/webhook-eventos.ts` | **Cambio de contrato con integradores externos.** | `⟨PRE⟩` **no** entra en `EVENTOS_PUBLICOS` (P2): el integrador deja de recibir `devuelta` al gestionar y lo recibe al aprobar. Aviso previo obligatorio. |
| `lib/utils/estados-bodega-satelite.ts` | El satélite deja de ver devoluciones que tiene **físicamente en el estante**. | `⟨PRE⟩` entra en `ESTADOS_BODEGA_SATELITE` **si P4 = sí**, en la posición inmediatamente anterior a `devuelta` (la lista declara el orden que el usuario ve; añadirlo al final lo pintaría después de las ya confirmadas). |
| `lib/types/tablero-dia.ts` | El mapa es parcial con default `otros`, así que **absorbe el value nuevo sin quejarse**. | `⟨PRE⟩` **no** entra en `BUCKET_POR_ESTATUS`: las órdenes en `⟨PRE⟩` tienen gestión del día, así que cuentan en `devueltas`, no en los buckets de «sin resultado». Los buckets solo clasifican órdenes **sin** gestión vigente hoy. |

**Y una que sí se pone roja aunque el value esté bien clasificado:**
`tests/unit/tablero-dia/buckets-estatus.guardia.test.ts` congela el catálogo entero
(`CATALOGO_CONGELADO`, 20 values en orden) precisamente para que un value nuevo **no** pase
desapercibido. Es su trabajo. Se actualiza a 21 con nota fechada. Lo mismo para las cuentas literales
de `order-status-transiciones.connectividad.test.ts` (`toBe(20)`),
`rastreo-hitos-exhaustivo.guardia.test.ts` («los 20 values»), `rastreo-sin-estatus-crudo.guardia.test.ts`
y `EstatusBadgeCatalogoV2.test.tsx`.

**`ESTADOS_ESPERADOS` de `CierreDiaService.ts:86` — esto es regresión, no aserción a actualizar.**
La entrada `devuelta` (el `resultado` de la gestión) tiene que ganar `⟨PRE⟩`:

```ts
devuelta: ["⟨PRE⟩", "en_bodega_central", "en_bodega_satelite", "rechazada", "devuelta"],
```

Sin eso, la guarda de `deshacerGestion` («la orden debe seguir exactamente donde la dejó esa gestión»)
falla y **el mensajero deja de poder deshacer su propia devolución del día** (R24).

---

## 9. Contratos I/O

**Rutas nuevas: ninguna.** Ni endpoint, ni Server Action, ni página. Esta feature cambia el
comportamiento de superficies existentes, y eso es deliberado: cada superficie nueva es una
superficie más que puede quedarse a medias, y de eso viene el fallo que se está arreglando.

Cambian tres contratos internos:

```ts
// lib/interfaces/repositories/ICierresAdminRepository.ts
interface ResolverCierreInput {
  …
  /** OBLIGATORIO (§3.3): sin esto la devolución no se ancla nunca. */
  anclajeDevolucion: { preEstadoId: string; devueltaId: string };
}
```

```ts
// lib/interfaces/repositories/IDevolucionSlaRepository.ts
interface DevueltaSlaRow {
  …
  ancladaAt: Date;
  /** 'aprobacion' = fila de historial `anclaje_devolucion`; 'legado' = fecha de la gestión (R14). */
  origenAncla: "aprobacion" | "legado";
}
```

```ts
// lib/interfaces/services/IDevolucionSlaService.ts
interface DevolucionSlaResult {
  evaluadas: number; liberadas: number; escaladas: number; omitidas: number;
  /** cuántas de las evaluadas venían por la rama legada. Sin PII (R35). */
  legadas: number;
}
```

El cron `GET /api/cron/procesar-devueltas-sla` conserva su contrato HTTP salvo por ese contador
adicional en el 200.

---

## 10. Alternativas descartadas

### A · Derivar el ancla en la consulta, sin estado nuevo *(la más barata, y la que abre un agujero)*

`novedadWhere` y `findDevueltasSla` pasarían a exigir `estatus = devuelta` **y** un `EXISTS` sobre la
gestión vigente con su cierre en `aprobado`.

**Descartada porque deja tres guardas correctas... y no las protege.** `ReprogramacionTiendaService`,
`RecuperacionBodegaService` y la ventana de escritura del hilo (`ventana-hilo-notas.ts`) validan hoy
`= devuelta`. Si el ancla vive solo en la *consulta de listado*, esas tres siguen viendo `devuelta` y
la tienda puede **reprogramar por Server Action** una orden que aún no debería ver siquiera. Habría
que replicar el `EXISTS` en cada una — tres copias del criterio, que es la clase de duplicación que
este repo caza con guardias. Con el estado partido, las tres quedan correctas **solas y sin tocarse**,
porque `devuelta` pasa a significar «anclada».

Coste añadido: el cron escanearía **más** filas (todas las `devuelta`, incluidas las no ancladas) y la
población atascada seguiría siendo invisible.

### B · Persistir una columna de ancla (`orden.anclada_at`)

**Descartada por sus sitios de limpieza y por la dirección de su fallo.** Una columna mutable hay que
apagarla en **las siete salidas de `devuelta`**; hoy `gestion_aprobada` tiene exactamente ese problema
y **solo 2 de las 7 la apagan** (auditoría §2.3). Cuando una de esas limpiezas se olvida, el fallo es
un ancla **vieja** sobre una devolución nueva: el reloj arranca antes de tiempo, el escalado ocurre
antes y **se cobra antes de tiempo** — justo lo que `specs/215` declara prohibido. El estado, en
cambio, no se puede olvidar: cambiarlo *es* la operación.

### C · Dejar `gestion_aprobada` y arreglar solo el cron

Sería el parche mínimo: que `findDevueltasSla` filtre además por `gestionAprobada = true` y ancle en
el `resuelto_at` del cierre.

**Descartada por dos razones independientes, cualquiera de las dos basta.** (i) `resuelto_at` **no
significa aprobado**: se escribe igual al rechazar y `forzarSolicitudVencido` no la limpia, así que
anclaría en la fecha de un rechazo. (ii) Conserva la columna con sus cinco limpiezas pendientes y sus
dos fallos vivos (la fuga permanente de `/novedades` y el «Habilitar» que esconde sin detener el
reloj): arregla el síntoma más caro y deja el mecanismo que lo produce.

### D · Feature flag para desplegar por mitades

**Descartada: no hay punto de despliegue intermedio seguro.** Si el productor sale sin el consumidor,
`/novedades` queda **vacía con el árbol verde**. El flag no ayuda porque el estado de las órdenes en
vuelo depende de qué mitad estaba activa cuando se gestionaron: apagarlo no las devuelve. T1 y T2 van
en un solo PR por esto, no por comodidad.

---

## 11. Rojos esperados, y rojos que son regresión

**Rojos POR DISEÑO** (se actualizan con nota fechada):

- Inventarios congelados del catálogo (§8): 20 → 21 values.
- `tests/fixtures/inventario-transiciones-140.ts` y la suite de transiciones: +3 (o +5 con P4), −1.
- Los tres emuladores de `tests/integration/db/resolver-novedad-*.test.ts`: la orden ya no está en
  `devuelta` justo después de gestionar. Es la tanda más cara y la más subestimada.
- El e2e de escalado por SLA.
- `tests/unit/repositories/orden-repository.novedades.test.ts`: el predicado vuelve a la igualdad.

**Rojos que son REGRESIÓN** (si aparecen, el bloque aterrizó mal — se arregla el código, no el test):

- Los cinco feeds de dinero de `resolverCierre` y sus suites de idempotencia.
- `tests/unit/repositories/cierres-admin-caja-cod.test.ts`, que **mide el orden de las llamadas**.
- Las dos guardias del criterio de intento (§6).
- `tests/unit/guards/hilo-ventana-alcanzable.guardia.test.ts`: cruza la ventana de escritura del hilo
  con lo que cada rol ve listado. Con `devuelta` significando «anclada», la intersección del
  `adminTienda` sigue siendo no vacía — si se pone roja, la ventana y la pantalla se han desalineado.
- Las guardias money-safe y la frontera de `orden_nota`.

---

## 12. Consulta de población atascada (R34, solo lectura)

```sql
-- Órdenes detenidas en el pre-estado y su antigüedad, con el estado del cierre que las tiene.
SELECT c."estado"                                            AS estado_cierre,
       count(*)                                              AS ordenes,
       min(h."created_at")                                   AS mas_antigua,
       count(*) FILTER (WHERE h."created_at" < now() - interval '2 days')  AS mas_de_2_dias,
       count(*) FILTER (WHERE h."created_at" < now() - interval '7 days')  AS mas_de_7_dias
FROM "orden" o
JOIN "order_status" os ON os."id" = o."estatus_id" AND os."value" = '⟨PRE⟩'
JOIN LATERAL (
  SELECT g."cierre_id", g."created_at"
  FROM "gestion_orden" g
  WHERE g."orden_id" = o."id" AND g."resultado" = 'devuelta' AND g."anulada_at" IS NULL
  ORDER BY g."created_at" DESC LIMIT 1
) h ON true
LEFT JOIN "cierre_dia" c ON c."id" = h."cierre_id"
WHERE o."deleted_at" IS NULL
GROUP BY c."estado"
ORDER BY ordenes DESC;
```

Cero filas = nadie atascado. Filas con `estado_cierre` nulo = gestión aún sin cierre (normal el mismo
día). Filas con antigüedad alta y cierre `solicitado`/`vencido`/`rechazado` = mercadería congelada que
necesita una persona.

---

## 13. Riesgos

1. **La aprobación pasa a ser un prerrequisito de la visibilidad y del cobro.** Un cierre que nadie
   aprueba congela la orden. Riesgo aceptado y declarado (requirements § Supuesto operativo); medido
   en 0 casos el 2026-08-14 sobre 12 de 12 cierres. **Re-medir antes de desplegar.**
2. **Cambio de contrato observable para integradores** (P2/R27). Necesita aviso previo.
3. **Retraso real en la visibilidad de la tienda**: mediana 8,2 h, p90 22,1 h, máx 48,2 h. Es la
   semántica pedida, pero es un cambio de servicio percibido.
4. **Ficha 240 dependiente**: mientras «Habilitar» siga escondiendo sin detener el reloj, R23 se
   cumple solo si esa ficha entra antes o a la vez (P9).
5. **El pre-vuelo caduca**: `dev` se mueve. Comparar el SHA medido contra `origin/dev` antes de abrir
   el PR.

---

## 14. Documentación que esta feature deja al día

- `specs/99-devolucion-diferida-sla/design.md` §1.1 y §3.5 → marcar **SUPERADAS con fecha**: el
  anclaje deja de derivarse de la gestión y el predicado de novedad deja de ser el de aquella foto.
- `specs/215-reintento-en-cierre/design.md` §7bis → anotar que Q5 **cambia de forma** (mejor: se acaba
  el bucle de liberaciones y la población atascada es contable; peor: la mercadería se congela en vez
  de seguir circulando).
- JSDoc de `DevolucionSlaService.ts:122` → retirar el «Q5, ABIERTA» caducado.
- `progress/auditoria_ayuda_tienda.md` §1 → anotar la fecha en que el fallo queda cerrado.
