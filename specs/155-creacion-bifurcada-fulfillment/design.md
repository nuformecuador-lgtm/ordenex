# Feature 155 — Diseño

> Cubre `requirements.md` R1–R43. Zona `backend` (con la salvedad de la pregunta abierta 6).
> Depende de 154 aplicada: `por_recolectar_en_tienda` existe en el catálogo, en `ORDER_STATUS_SEED`,
> en `TRANSICIONES`, en `ESTADOS_CREACION` y en los mapas de badge.

## 0. Alcance en una frase

Sustituir las **tres reglas de nacimiento** que hoy conviven (default global, estado de fulfillment y
estado fijo de la API) por **una sola bifurcación** gobernada por `Usuario.fulfillment`, y borrar del
sistema el value `en_fulfillment` sin falsear el historial.

**Lo que NO se toca:** el flag `Usuario.fulfillment` (existe, feature 27), su switch de UI, el
generador de `num_guia`, `ManifiestoService`, `AsignacionSateliteService`, `RecepcionBodegaCentralService`,
la lógica de tarifas de la carga por API, ni el enum `orden_historial_origen_tipo` (esta feature no
añade values: usa `ajuste_estado`, que ya existe → **no hay que tocar ningún `down.sql` previo**).

---

## 1. Superficie verificada en `dev` (leída, no supuesta)

| Qué | Dónde | Hoy |
| --- | --- | --- |
| Flag de la tienda | `db/schema.prisma:97` | `fulfillment Boolean @default(false)` |
| Switch del flag | `app/(app)/configuracion/_components/UsuarioForm.tsx:133-136,169,190,353-363` | solo visible/aceptado para rol `adminTienda` |
| Lectura del flag | `lib/repositories/OrdenRepository.ts:759` (`findUsuarioFulfillment`) | ya existe en `IOrdenRepository:432` |
| Mapeo del flag → estado | `lib/config/ordenes.ts:28-45`, `lib/services/BulkOrdenService.ts:272-275` | `true → en_fulfillment`, `false → en_preparacion` |
| Estado fijo de la API | `lib/services/BulkOrdenService.ts:39,348` | `en_ruta_bodega_central` |
| Alta manual | `lib/services/OrdenService.ts:33-121` + `lib/actions/ordenes.ts:35-47` | usa `DEFAULT_ESTATUS_VALUE`; acepta `estatusId` explícito (`lib/types/orden.ts:20`); **sin ningún consumidor de UI** |
| Creación 1 orden | `OrdenRepository.create` (`:560-605`) | historial + geocodificación en la tx; **sin `num_guia`** |
| Creación en lote sin guía | `OrdenRepository.createManyOrdenes` (`:884-942`) | historial + geocodificación en la tx |
| Creación en lote con guía | `OrdenRepository.createManyOrdenesConGuia` (`:953-1019`) | historial + `num_guia`; **NO encola geocodificación** ⚠️ |
| Secuencia de guía | `OrdenRepository.ts:129` | `NUM_GUIA_GENERATOR = "siguiente_num_guia()"`, guarda `num_guia IS NULL` |
| Catálogo TS | `lib/types/order-status.ts:29-48` | 18 values, `en_fulfillment` en índice 4 |
| Grafo | `lib/types/order-status-transiciones.ts:45-163` | clave `en_fulfillment` + `ESTADOS_CREACION` de 3 values |
| Orígenes de guía/ruteo | `lib/services/GuiaAsignacionService.ts:31,35` | ambos admiten `en_fulfillment` |
| Badges | `app/(app)/ordenes/_components/EstatusBadge.tsx:15,43,74` | label + variante + **refuerzo de acento propio** |
| Apartados/acciones | `OrdenesRevisionMaestro.tsx:163-176`, `OrdenesListado.tsx:71,106,282`, `ordenes-columns.tsx:192` | apartado "En fulfillment" y acciones por lote |
| Contrato público | `lib/api/openapi-spec.ts:12-27` + espejo `docs/api/api-key-openapi.yaml` | lista `en_fulfillment` |
| Eventos públicos | `lib/types/webhook-eventos.ts:12-22` | incluye `en_ruta_bodega_central`, no `por_recolectar_en_tienda` |
| Emisor de eventos | `lib/services/jobs/webhook-estado-encolado.ts:82-121` | filtra por destino; **las creaciones también pasan por ahí** |
| Guard de censo | `tests/unit/guards/censo-order-status-rename.test.ts` | 6 values viejos + allowlist por basename |
| Inventario de aristas | `tests/fixtures/inventario-transiciones-140.ts` | transcrito a mano, consumido por los tests de conectividad |

**Censo del literal `en_fulfillment`:** 132 ocurrencias en 45 archivos, de los cuales 11 son
migraciones históricas y 1 es `docs/api/api-key-openapi.yaml`; los **33 restantes** son código y
tests vivos. Coincide con los "34 archivos" de la ficha.

**Hallazgo que la ficha no anticipaba:** `createManyOrdenesConGuia` **no encola geocodificación**
(comparar `:953-1019` contra `:931-936` y `:596-599`). Hoy solo lo sufre el canal de API key; si la
carga masiva por UI pasara a esa ruta tal cual, la rama (b) crearía órdenes **sin coordenadas**, que
el gate de asignabilidad de la feature 92 bloquearía más tarde sin explicación. R11 existe para
cerrar ese hueco (y de paso lo cierra para el canal de API key).

---

## 2. El punto único de decisión

Módulo nuevo, **puro** (sin Prisma, sin HTTP, sin `process.env`), consumido por los dos servicios:

`lib/services/destino-creacion.ts`

```ts
import type { OrderStatusValue } from "@/lib/types/order-status";

/** Dónde nace una orden y con qué. Único lugar donde vive la regla (R1/R6). */
export interface DestinoCreacion {
  readonly estatus: OrderStatusValue;   // "en_preparacion" | "por_recolectar_en_tienda"
  readonly conGuia: boolean;            // true => num_guia en el acto (R3/R8)
  readonly emiteManifiesto: boolean;    // true => manifiesto del lote (R24/R26)
}

/** R1/R2/R3 — el ÚNICO predicado es el flag de la tienda dueña. */
export function resolverDestinoCreacion(fulfillmentDeLaTienda: boolean): DestinoCreacion;
```

- `true`  → `{ estatus: "en_preparacion",           conGuia: false, emiteManifiesto: false }`
- `false` → `{ estatus: "por_recolectar_en_tienda", conGuia: true,  emiteManifiesto: true  }`

Los dos `estatus` se declaran como `OrderStatusValue` y se **verifican en test contra
`ESTADOS_CREACION`**: si la 154 renombra o mueve un value, el test cae antes que producción (R31).

`conGuia` y `emiteManifiesto` viajan juntos en el mismo objeto a propósito: son las tres caras de la
misma decisión, y separarlas es exactamente cómo se degrada a "tres reglas que hay que mantener
sincronizadas a mano" — que es el estado del que esta feature viene a sacarnos.

---

## 3. Cambios por vía de creación

### 3.1 Alta manual — `OrdenService.crear`

1. Resolver `tiendaId` como hoy (`:38-54`; maestro/admin lo traen en la entrada, adminTienda lo
   fuerza a sí mismo) → cubre R13/R14.
2. `const destino = resolverDestinoCreacion(await repo.findUsuarioFulfillment(tiendaId))`.
3. `estatusId = await repo.findEstatusIdByValue(destino.estatus)`; `null` → `validation_error` con
   la clave `estatusId` nombrando el value faltante (R7), patrón ya presente en `:69-74`.
4. Se **elimina** la rama `if (input.estatusId !== undefined)` (`:60-63`) y el campo `estatusId` del
   `crearOrdenSchema` (`lib/types/orden.ts:20`) → R5. El schema no es `.strict()`, así que una
   entrada legada con `estatusId` se ignora en silencio en vez de romper; el test de R5 verifica que
   la orden nace donde manda el flag, no donde manda el payload.
5. `repo.create(data, historial, { conGuia: destino.conGuia })`.

### 3.2 Carga masiva por UI — `BulkOrdenService.cargarMasiva`

`:272-275` pasa de la ternaria de config a `resolverDestinoCreacion(...)`. `precargar` recibe
`destino.estatus`. La persistencia elige repositorio por `destino.conGuia`:

- `conGuia: false` → `createManyOrdenes` (hoy).
- `conGuia: true`  → `createManyOrdenesConGuia`, que pasa a encolar geocodificación (R11).

El `dryRun` no cambia: sigue saliendo antes de persistir (`:326-334`), así que no consume guías
(R17). El dedup sigue reportando el estatus resuelto por lote (`:519-532`) → R18.

### 3.3 Carga por API key — `BulkOrdenService.cargarViaApi`

- Se borra la constante `ESTATUS_INICIAL_API` (`:39`).
- `:348` pasa a `resolverDestinoCreacion(await this.repo.findUsuarioFulfillment(tiendaId))` — la
  misma llamada que la vía sesión, sobre el dueño de la key (R19).
- La rama `conGuia: false` (hoy inalcanzable, ver pregunta abierta 3) devuelve `numGuia: null` para
  esas órdenes: `CargaViaApiOrden.numGuia` pasa de `number` a `number | null` (R21). El resto del
  bloque de respuesta (`total`/`creadas`/`duplicadas`/`conError`/`filas`/`ordenes`/`costoEnvio`/
  `etiquetasPdf`) queda intacto (R23).
- El route handler (`app/api/ordenes/api-key/carga/route.ts`) **no cambia**: sigue delegando al
  service y encadenando el PDF de etiquetas best-effort.

### 3.4 Repositorio — creación con guía de UNA orden

`IOrdenRepository.create` gana un tercer parámetro opcional
`opciones?: { conGuia?: boolean }` (default `false` = comportamiento actual). Cuando es `true`,
dentro de la **misma** `$transaction` de `:562-601`, después del `create` y antes del
`appendCambioEstado`:

```sql
UPDATE "orden" SET num_guia = siguiente_num_guia() WHERE id = $1 AND num_guia IS NULL
```

reusando la constante `NUM_GUIA_GENERATOR` (`:129`) y la guarda de idempotencia (R8), con la relectura
defensiva de `createManyOrdenesConGuia:989-997` (nunca `as number`). Se elige **parámetro** y no un
método `createConGuia` hermano porque duplicaría 40 líneas de tx idénticas (create + historial +
geocodificación) por una sola sentencia de diferencia.

---

## 4. Modelo de datos y migración

**Tablas nuevas: ninguna. Columnas nuevas: ninguna. RLS: sin cambios** — `orden`,
`orden_historial_estado` y `order_status` conservan la RLS de features previas; esta migración solo
hace DML sobre filas existentes más un `DELETE` condicional de catálogo.

`db/migrations/<ts>_order_status_retiro_en_fulfillment/`

### 4.1 `migration.sql` (UP)

Cuatro pasos, en este orden y en una sola transacción implícita de la migración:

1. **Rastro del backfill (R35), antes de mover nada** — una fila de historial por cada orden que hoy
   esté en `en_fulfillment` (incluidas las borradas lógicamente):

```sql
INSERT INTO "orden_historial_estado"
  ("id","orden_id","estatus_origen_id","estatus_destino_id","actor_usuario_id","origen_tipo","motivo","created_at")
SELECT gen_random_uuid()::text, o."id", f."id", p."id", NULL,
       'ajuste_estado'::orden_historial_origen_tipo,
       'migracion 155: retiro de en_fulfillment', now()
FROM "orden" o
JOIN "order_status" f ON f."id" = o."estatus_id" AND f."value" = 'en_fulfillment'
CROSS JOIN "order_status" p
WHERE p."value" = 'en_preparacion';
```

2. **Backfill (R34)** — solo `estatus_id`; ni `num_guia`, ni mensajero, ni prioridad:

```sql
UPDATE "orden" SET "estatus_id" = (SELECT "id" FROM "order_status" WHERE "value" = 'en_preparacion')
WHERE "estatus_id" = (SELECT "id" FROM "order_status" WHERE "value" = 'en_fulfillment');
```

3. **Retiro del catálogo (R37)** — condicional, patrón exacto de
   `20260724140000_order_status_devolucion_rechazadas/down.sql`:

```sql
DELETE FROM "order_status" os
WHERE os."value" = 'en_fulfillment'
  AND NOT EXISTS (SELECT 1 FROM "orden" o WHERE o."estatus_id" = os."id")
  AND NOT EXISTS (SELECT 1 FROM "orden_historial_estado" h
                  WHERE h."estatus_destino_id" = os."id" OR h."estatus_origen_id" = os."id");
```

4. Nada más. Idempotente: una segunda pasada encuentra 0 filas en los tres pasos.

**Consecuencia asumida y explícita:** en una base con historial real (producción), el paso 3 es
**no-op** y la fila del catálogo **sobrevive** referenciada solo por el historial. Queda inalcanzable
desde la aplicación (no está en `ORDER_STATUS_SEED`, ni en `TRANSICIONES`, ni en `ESTADOS_CREACION`,
ni en ningún mapa de UI). En una base sin historial de ese value (dev limpia, CI) desaparece. Es la
diferencia entre "borrar el value" y "borrar la historia", y aquí solo se borra el primero.

**Por qué no se puede simplemente borrar la fila:** `orden_historial_estado.estatus_destino_id` es
obligatorio (FK restrictiva) y `estatus_origen_id` es opcional — un `DELETE` en cascada o con
`SET NULL` convertiría filas de origen legítimo en filas con origen `NULL`, que es **exactamente el
marcador de "creación"** (`db/schema.prisma:1134`). Borrar la fila corrompería la línea de tiempo.

**El backfill no dispara nada (R40):** va en SQL puro, así que no pasa por `appendCambioEstado` ni,
por tanto, por `emitirWebhooksEstado` (`webhook-estado-encolado.ts:82`) ni por el encolado de jobs.
Ni un webhook, ni una notificación, ni un job por orden migrada.

### 4.2 `down.sql` (DOWN, R38)

```sql
-- 1. repone el value si el UP lo borró (base sin historial)
INSERT INTO "order_status" ("id","value")
SELECT gen_random_uuid()::text, 'en_fulfillment'
WHERE NOT EXISTS (SELECT 1 FROM "order_status" WHERE "value" = 'en_fulfillment');

-- 2. devuelve SOLO las órdenes marcadas por el rastro del UP que sigan en en_preparacion
UPDATE "orden" o
SET "estatus_id" = (SELECT "id" FROM "order_status" WHERE "value" = 'en_fulfillment')
WHERE o."estatus_id" = (SELECT "id" FROM "order_status" WHERE "value" = 'en_preparacion')
  AND EXISTS (SELECT 1 FROM "orden_historial_estado" h
              WHERE h."orden_id" = o."id"
                AND h."motivo" = 'migracion 155: retiro de en_fulfillment');

-- 3. borra el rastro
DELETE FROM "orden_historial_estado"
WHERE "motivo" = 'migracion 155: retiro de en_fulfillment';
```

El marcador va en `motivo` (texto libre, ya nullable) porque además **se lee en la línea de tiempo de
la orden**: el usuario ve por qué su orden cambió de estado sin que nadie la tocara. Un marcador
oculto en otra tabla no daría eso.

---

## 5. Catálogo, grafo y configuración

- `lib/types/order-status.ts` — se retira `"en_fulfillment"` de `ORDER_STATUS_SEED` (índice 4). Los
  demás values **conservan su posición relativa**; el test de índices
  (`tests/unit/types/order-status.test.ts:38-82`) se reajusta con los índices nuevos y el conteo pasa
  de 18 a 17 + los 2 de la 154 = **19**.
- `lib/types/order-status-transiciones.ts` — se borra la clave `en_fulfillment` del mapa (R28). El
  `satisfies Record<OrderStatusValue, …>` (`:148`) y `_EnsureExhaustive` (`:186-190`) hacen que
  **olvidar cualquiera de los dos lados rompa el build**: no se relajan.
- `ESTADOS_CREACION` (`:159-163`) queda `["en_preparacion", "por_recolectar_en_tienda"]` — se retiran
  `en_fulfillment` y `en_ruta_bodega_central` (R22/R31). El comentario que cita las tres constantes
  de configuración (`:151-158`) se reescribe para citar `resolverDestinoCreacion`.
- `lib/config/ordenes.ts` — se retiran `FULFILLMENT_ESTATUS_VALUE` **y** `DEFAULT_ESTATUS_VALUE`, con
  sus dos variables de entorno (R30). `OrdenesConfig` queda con las dos cotas de paginación.
- `lib/services/GuiaAsignacionService.ts:31,35` — `ORIGEN_GENERAR_GUIA` y `ORIGEN_RUTEO_SATELITE`
  pierden `en_fulfillment` (R29). El resto del recableo de "generar guía" es de la **156**.
- `tests/fixtures/inventario-transiciones-140.ts` — se retiran las aristas `#1`,`#2`,`#3`,`#7b` y las
  entradas de creación `en_fulfillment` y `en_ruta_bodega_central`; se añade la de creación
  `por_recolectar_en_tienda` si la 154 no la dejó puesta.

### 5.1 Por qué se retiran también las variables de entorno

`docs/architecture.md` §Principios-4 ("sin hardcode de contexto") habla de **país, moneda, cuenta y
credenciales**, no de la máquina de estados. Y desde la feature 140 hay una guardia estricta que
valida la creación contra `ESTADOS_CREACION`: si alguien exporta
`ORDENES_DEFAULT_ESTATUS_VALUE=cualquier_cosa`, el resultado no es "otra configuración", es
**producción caída con `TransicionIlegalError` en cada creación**. Una palanca cuyo único efecto
posible es romper la aplicación no es configuración: es una trampa. Se retira.

---

## 6. Contrato público del canal de integración

- `lib/api/openapi-spec.ts:12-27` — se retira `en_fulfillment` y se añade `por_recolectar_en_tienda`
  (R42). El espejo textual `docs/api/api-key-openapi.yaml` se actualiza en el **mismo commit** (lo
  exige el comentario de cabecera `:1-8`).
- Además de la lista, cambia lo que el integrador **observa**: la carga por API deja de devolver
  `en_ruta_bodega_central` y devuelve `por_recolectar_en_tienda`. Es un **cambio incompatible** de la
  respuesta y debe quedar escrito en la descripción del endpoint, no solo en el enum.
- `lib/types/webhook-eventos.ts:12-22` — se añade `por_recolectar_en_tienda` a `EVENTOS_PUBLICOS`
  (R43). Sin eso, el integrador que hoy recibe un evento al crear una orden dejaría de recibir
  cualquier cosa hasta que la orden llegue a bodega central, y el silencio se leería como "no se
  creó". Ver pregunta abierta 2: esta lista está declarada como contrato fijado en un gate previo, y
  la decisión se confirma en la puerta.

---

## 7. Guard de censo (R33)

Se **extiende** `tests/unit/guards/censo-order-status-rename.test.ts` (el de la 135, que la 153 ya
habrá tocado): se añade `{ label: "en_fulfillment", re: /\ben_fulfillment\b/ }` a `OLD_VALUES`.

Detalle que evita un falso positivo: el nombre de carpeta histórica
`20260710140000_rename_order_status_..._en_fulfillment` **no** dispara `\ben_fulfillment\b`, porque el
carácter previo es `_` (carácter de palabra) y no hay frontera. Por eso `tests/unit/guards/no-embalaje.test.ts`
no necesita entrar en la allowlist pese a citar esa ruta.

Sí necesitan entrada en la allowlist, con justificación individual:

- `rename-order-status-migration.test.ts` — afirma el texto literal de migraciones históricas.
- `order-status-enum-migration.test.ts` — ya está en la allowlist por la 135.
- el test de la migración nueva de esta feature — afirma el literal que retira.

Todo lo demás (`orden-repository.guia.test.ts`, `guia-asignacion-service.test.ts`,
`bulk-orden-service.test.ts`, `recepcion-satelite-service.test.ts`, los cuatro tests de componentes,
`e2e/reprogramacion-liberacion.spec.ts`, …) se **limpia**, no se allowlistea.

---

## 8. Manifiesto de la rama (b) — ABIERTO

Lo verificado: `ManifiestoService.armar` (`lib/services/ManifiestoService.ts:139-185`) es un READ
derivado, posterior a la operación ya cometida, y su flujo `carga_masiva` ya produce **exactamente**
el movimiento que la rama (b) necesita — `origen = tienda`, `destino = bodega central`,
`responsable = quien ejecutó` (`:98-100`). El servicio **ya acepta actores `apiKey`** y los acota a
su propia tienda (`:65-68`). El binario `.xlsx` se arma en el navegador, no en el servidor
(`lib/actions/manifiesto.ts:46-57`).

Lo que **no** encaja tal cual:

1. La entrada por `numRemisiones` está restringida al literal `flujo: "carga_masiva"`
   (`lib/types/manifiesto.ts:69-78`). El alta manual y la carga por API key seleccionarían por
   `ordenIds` y tendrían que declararse `carga_masiva`, que es mentira en la etiqueta aunque acierte
   en el mapeo.
2. `obtenerManifiesto` es una **Server Action** que resuelve el actor de la **cookie de sesión**
   (`lib/actions/manifiesto.ts:63-64`). El canal de API key es HTTP puro con `Authorization: Bearer`:
   no puede invocarla. Si la rama (b) por API debe "emitir manifiesto", necesita otro borde.

Las tres opciones, con su consecuencia:

| Opción | Qué implica | Coste |
| --- | --- | --- |
| **A. Reusar tal cual** | las tres vías piden `flujo: "carga_masiva"`; la API key se queda **sin** manifiesto | 0 código; nombre de flujo que miente; el integrador no tiene manifiesto |
| **B. Flujo nuevo `recoleccion_tienda`** | se añade un séptimo value a `MANIFIESTO_FLUJOS` con el mismo mapeo origen/destino, y se permite selección por `numRemisiones` para él | pequeño y honesto; sigue sin resolver el canal API key |
| **C. B + borde propio para API key** | además, la respuesta de `POST /api/ordenes/api-key/carga` expone el manifiesto (inline o como URL firmada, igual que ya hace con el PDF de etiquetas) | el mayor; toca contrato público; encaja con el precedente de `etiquetasPdf` |

**Recomendación del autor:** **B**, y dejar **C** para cuando un integrador lo pida. El manifiesto
es un papel que se firma en el mostrador de la tienda al entregar los bultos al mensajero; el
integrador remoto no está en ese mostrador. Pero la decisión es del humano, porque "se emite el
manifiesto" en la ficha no distingue vías.

**Lo que sí queda cerrado pase lo que pase:** ningún módulo distinto de `ManifiestoService` arma
filas de manifiesto (R24), y un fallo del manifiesto nunca revierte la creación (R25) — ambas cosas
ya son invariantes de la 148 y esta feature no las relaja.

---

## 9. Alternativas descartadas

**A1 — Reescribir el historial: cambiar las filas viejas que referencian `en_fulfillment` a
`en_preparacion` y borrar el value de golpe.** *Descartada.* `orden_historial_estado` está declarada
fila **inmutable** (`db/schema.prisma:1141`) y es la fuente del derivador de intentos de entrega
(`:1155`), que alimenta `rechazada` y de ahí dinero. Reescribirla dejaría el catálogo limpio a costa
de que la línea de tiempo mienta sobre lo que pasó. Un value huérfano en una tabla de catálogo es
barato; una auditoría falsificada, no.

**A2 — Backfill mudo, sin filas de historial.** *Descartada.* Sería más corto, pero (i) rompe el
invariante de la feature 49 de que todo cambio de `estatus_id` deja rastro, (ii) el usuario vería su
orden saltar de estado sin explicación, y (iii) haría el `down.sql` **irreversible**: sin marcador no
hay forma de saber qué órdenes estaban en `en_fulfillment`. `docs/architecture.md` exige que el DOWN
revierta exactamente lo que hace el UP.

**A3 — Que el estado inicial venga en el payload público de la API (campo `en_bodega` por orden).**
*Descartada por el humano y confirmada aquí.* Además de reabrir una decisión cerrada, daría al
integrador la capacidad de declarar que su paquete ya está en nuestra bodega —una afirmación sobre
**nuestro** inventario— y haría que dos órdenes del mismo lote pudieran nacer en estados distintos,
duplicando la lógica de guía/manifiesto por fila.

**A4 — Bifurcar por vía de carga (UI = una rama, API = la otra).** *Descartada.* Es lo que hay hoy
(`ESTATUS_INICIAL_API`) y es justamente el defecto que la feature corrige: el canal por el que entra
un dato no dice nada sobre dónde está físicamente el paquete.

**A5 — Conservar `en_fulfillment` como estado vestigial** (el mecanismo `ESTADOS_VESTIGIALES` de la
140 existe, hoy vacío). *Descartada.* Mantendría vivos el label, la variante, el refuerzo de acento,
el apartado del listado y 33 archivos de referencias, a cambio de nada: ningún flujo nuevo lo produce
ni lo consume. Un estado que nadie puede alcanzar pero que sigue apareciendo en los mapas es deuda
que el próximo lote paga.

**A6 — Método de repositorio `createConGuia` separado de `create`.** *Descartada.* Duplicaría la
transacción entera (create + historial + geocodificación) por una sola sentencia de diferencia, y ya
sabemos cómo termina eso: `createManyOrdenes` y `createManyOrdenesConGuia` divergieron hasta que una
encola geocodificación y la otra no (§1). Un parámetro con default preserva el comportamiento actual
de todos los llamadores.

---

## 10. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| La carga masiva por UI pasa a numerar guías: una tienda sin fulfillment consume la secuencia en cada carga | Es el comportamiento pedido. La guarda `num_guia IS NULL` impide el doble consumo y el `dryRun` no numera (R17). |
| El value huérfano en el catálogo hace que un listado por estado lo ofrezca | El catálogo se lista desde `order_status`; hay que verificar que la UI de filtros no muestre un value que ya no tiene label. Cubierto por R41 (degradación) y verificado en el test de badge. |
| Órdenes vivas en `en_fulfillment` en el momento del deploy | El backfill corre en la misma migración; R39 lo censa. |
| Cambio incompatible para integradores (estado inicial y enum) | R42/R43 + nota explícita en la descripción del endpoint. Requiere aviso a integradores: **no** es solo un cambio de documentación. |
| La 154 no deja `por_recolectar_en_tienda` en `ESTADOS_CREACION` | El test de §2 (los dos values de `resolverDestinoCreacion` ⊂ `ESTADOS_CREACION`) falla en CI antes del merge. |

---

## 11. Preguntas abiertas

1. **§8 — punto de enganche del manifiesto de la rama (b)**: opción A, B o C. Recomendada: **B**.
2. Las cinco restantes están en `requirements.md > Preguntas abiertas` (eventos públicos,
   integradores con bodega propia, arista `en_preparacion → en_bodega_central` de la 154, etiqueta en
   el acto, y zona declarada de la feature).

---

## 12. Mapa requisito → artefacto verificable

| R | Artefacto |
| --- | --- |
| R1–R6 | `tests/unit/services/destino-creacion.test.ts` (función pura, ambas ramas, y ⊂ `ESTADOS_CREACION`) |
| R7 | tests de "catálogo incompleto" en `orden-service` y `bulk-orden-service` |
| R8, R12 | `tests/unit/repositories/orden-repository.guia.test.ts` (idempotencia + todo-o-nada) |
| R9, R10 | tests de historial y de mensajero en los tres servicios |
| R11 | `tests/unit/repositories/…` — encolado por orden insertada en las **dos** rutas de lote y en `create` |
| R13–R15 | `tests/unit/services/orden-service.test.ts` |
| R16–R18 | `tests/unit/services/bulk-orden-service.test.ts` |
| R19–R23 | `tests/unit/services/bulk-orden-service.carga-api.test.ts` + `tests/integration/…` de la ruta |
| R24–R26 | `tests/components/ManifiestoFlujos.test.tsx` + test del service, según la opción elegida en §8 |
| R27, R28, R31 | `tests/unit/types/order-status.test.ts`, `…/order-status-transiciones.*.test.ts`, `tests/fixtures/inventario-transiciones-140.ts` |
| R29 | `tests/unit/services/guia-asignacion-service.test.ts` |
| R30 | `tests/unit/config/ordenes-config.test.ts` |
| R32, R41 | `tests/components/OrdenesRevisionMaestro.test.tsx`, `EstatusLabel.test.ts` |
| R33 | `tests/unit/guards/censo-order-status-rename.test.ts` (extendido) |
| R34–R40 | `tests/integration/db/*-retiro-en-fulfillment*.test.ts` (UP, DOWN, censo de datos, ausencia de jobs) |
| R42 | test del espejo `openapi-spec.ts` ↔ `docs/api/api-key-openapi.yaml` |
| R43 | `tests/unit/services/webhook-estado-encolado.test.ts` |
