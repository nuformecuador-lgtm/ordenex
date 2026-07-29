# Design — Feature 154 · Catálogo de estados v2

> Requisitos: `specs/154-catalogo-estados-v2/requirements.md` · Depende de la **153** aplicada
> (`en_ruta` → `en_reparto`). Todo lo de aquí se escribe contra `en_reparto`.
>
> **PUERTA T0 CERRADA (2026-07-29).** Q1/Q2/Q3 ya están respondidas (ver el bloque de cabecera de
> `requirements.md`). La respuesta a **Q2 cambia el diseño**: la 154 es **SOLO ADITIVA** y **no
> retira ninguna arista**. §3.2 pasa de "BAJAS" a "BAJAS DIFERIDAS" y §3.4 lleva los recuentos
> reales. Lo que queda de §3.5 es histórico.

---

## 1. Contexto y superficie

Tres artefactos son fuente única de verdad y esta feature toca los tres:

| Artefacto | Qué es | Cambio |
| --- | --- | --- |
| `lib/types/order-status.ts` → `ORDER_STATUS_SEED` | catálogo de estados, respaldado por la **TABLA** `order_status` | +2 values (18 → 20) |
| `lib/types/orden-historial.ts` → `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` | familias de transición, respaldadas por el **ENUM PG** `orden_historial_origen_tipo` | +2 values (22 → 24) |
| `lib/types/order-status-transiciones.ts` → `TRANSICIONES` | grafo de legalidad de la feature 140 | +2 aristas de flujo, +1 de creación (**0 bajas**, decisión Q2) |

Y la capa de presentación: `app/(app)/ordenes/_components/EstatusBadge.tsx`
(`ORDER_STATUS_LABELS` / `ORDER_STATUS_VARIANT` / `ORDER_STATUS_CLASS`).

**No se toca ningún service, repository, action ni route handler.** No hay endpoints nuevos, ni
contratos HTTP nuevos, ni cambios en el payload público de la API de integradores.

---

## 2. Modelo de datos

### 2.1 `order_status` es TABLA CATÁLOGO, no enum

Lo fue: la migración `20260714123909_reconcile_fks_drop_order_status_value` lo convirtió de enum a
tabla. Por tanto el alta de un estado es un **INSERT**, no un `ALTER TYPE`.

**Migración A — `<ts1>_order_status_v2_por_recolectar_incidente`**

Patrón calcado de `db/migrations/20260724140000_order_status_devolucion_rechazadas/migration.sql`
(feature 139): un `INSERT ... SELECT ... WHERE NOT EXISTS` por value, idempotente por `value`
(único), `id` = `gen_random_uuid()::text`.

```
INSERT INTO "order_status" ("id", "value")
SELECT gen_random_uuid()::text, 'por_recolectar_en_tienda'
WHERE NOT EXISTS (SELECT 1 FROM "order_status" WHERE "value" = 'por_recolectar_en_tienda');
-- ídem para 'incidente'
```

`down.sql`: patrón calcado del `down.sql` de la 139 — `DELETE` **guardado** por ausencia de
referencias en `orden.estatus_id` y en `orden_historial_estado.estatus_origen_id` /
`estatus_destino_id`. Best-effort: si algo referencia, no borra y no rompe FKs (R6).

**RLS:** ADITIVA. No crea tablas ni columnas; `order_status` conserva la RLS de features previas.
No hay tabla nueva, así que no aplica el anti-patrón "tabla nueva sin RLS".

### 2.2 `orden_historial_origen_tipo` SÍ es ENUM de Postgres

**Migración B — `<ts2>_orden_historial_origen_recoleccion_tienda_incidente`** (carpeta SEPARADA de
la A, con timestamp posterior).

```
ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS 'recoleccion_tienda';
ALTER TYPE "orden_historial_origen_tipo" ADD VALUE IF NOT EXISTS 'incidente';
```

Va **sola** (sin ningún uso de los valores nuevos en la misma transacción): Postgres rechaza usar
un value de enum recién añadido dentro de la transacción que lo añadió (55P04), y Prisma Migrate
corre cada `migration.sql` en una transacción. Añadir DOS values en una misma migración sí es legal
y tiene precedente exacto en el repo: `20260721120000_orden_historial_origen_tipo_sla_devuelta`
añade `liberacion_devuelta_sla` y `escalado_devuelta_sla` juntos.

`down.sql`: Postgres **no tiene `DROP VALUE`**. Se recrea el tipo con los **22** values previos, se
migra la columna con `USING (...::text::...)` y se suelta el tipo viejo. Patrón calcado de
`20260724150000_orden_historial_origen_devolucion_rechazada/down.sql`. Documenta la precondición: 0
filas de `orden_historial_estado` con esos dos orígenes; si las hay, el `USING` falla ruidosamente y
el rollback aborta — comportamiento CORRECTO (R11).

`db/schema.prisma`: el bloque `enum OrdenHistorialOrigenTipo` (línea ~1097) gana los dos values, con
comentario `// feature 154`. Sin drift → los tests de migración lo verifican por regex.

### 2.3 Peaje de los `down.sql` PREVIOS — hallazgo, con corrección de la ficha

La ficha dice "hay que ACTUALIZAR LOS `down.sql` PREVIOS que recrean el tipo". **Verificado contra
el repo: el SQL de esos `down.sql` NO cambia.** Cada uno es una *foto histórica*: recrea el enum tal
como estaba **antes de su propia migración**, y su comentario ya lo dice explícitamente ("La lista
de valores debe coincidir con el enum ANTES de esta migracion"). El rollback es secuencial —
`scripts/db-rollback.ts:8-15` toma siempre la ÚLTIMA carpeta — así que cuando se ejecuta el `down`
de una migración vieja, los values posteriores ya se habían quitado. Cambiarlos los volvería
incorrectos.

Los 8 `down.sql` que recrean el tipo y **quedan intactos**:

```
20260714160000_gestion_orden_anulacion          (11 values, pre-67)
20260717120000_..._carga_api                    (12, pre-88)
20260721120000_..._sla_devuelta                 (13, pre-99)
20260721130000_..._resolver_novedad             (15, pre-100)
20260722130000_cancelacion_api_por_key          (17, pre-106)
20260722150000_..._sin_gestionar                (18, pre-109)
20260724130000_..._recepcion_bodega_central     (20, pre-138)
20260724150000_..._devolucion_rechazada         (21, pre-139)
```

**Lo que SÍ rompe** al crecer el SEED son los tests de esas migraciones, que reconstruyen la lista
esperada como `SEED.filter(v => !AÑADIDOS_EN_O_DESPUES_DEL_X.has(v))`. Cada uno de esos conjuntos
debe ganar `recoleccion_tienda` e `incidente` o el test falla. Verificados (5):

- `tests/integration/db/gestion-orden-anulacion-migration.test.ts` (`..._DEL_67`)
- `tests/integration/db/orden-historial-origen-tipo-sla-devuelta-migration.test.ts` (`..._DEL_99`)
- `tests/integration/db/orden-historial-origen-tipo-resolver-novedad-migration.test.ts` (`..._DEL_100`)
- `tests/integration/db/orden-historial-origen-tipo-cancelacion-api-migration.test.ts` (`..._DEL_106`)
- `tests/integration/db/orden-historial-origen-recepcion-bodega-central-migration.test.ts` (`..._DEL_138`)

El implementer debe **barrer** `tests/` por `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` por si hay más, y
correr `tests/integration/db` completo (memoria del repo: esta es exactamente la fase que se salta y
rompe).

### 2.4 Sin backfill de datos

Ninguna orden viva cambia de estado en esta feature. El backfill de `en_fulfillment →
en_preparacion` pertenece a la 155 (salvo que Q2 se resuelva por la opción (iii)).

---

## 3. El grafo v2 — inventario auditable

Numeración: la del apéndice A de la feature 140, tal como vive hoy en
`lib/types/order-status-transiciones.ts` y en `tests/fixtures/inventario-transiciones-140.ts`
(#1–#42, con el **#27** ya retirado por la 139). Las nuevas toman **#43** y **#44**.

### 3.1 ALTAS — 2 de flujo + 1 de creación

| # | origen | destino | `via` | `rol` | consumidor futuro |
| --- | --- | --- | --- | --- | --- |
| — | `null` (creación) | `por_recolectar_en_tienda` | `carga_masiva` / `creacion_manual` / `carga_api` | — | feature **155** |
| #43 | `por_recolectar_en_tienda` | `en_ruta_bodega_central` | `recoleccion_tienda` | mensajero | feature **157** |
| #44 | `en_reparto` | `incidente` | `gestion` | mensajero | feature **158** |

- `ESTADOS_CREACION` pasa de 3 a **4**: `["en_preparacion", "en_fulfillment", "en_ruta_bodega_central", "por_recolectar_en_tienda"]`.
- `ESTADOS_TERMINALES` pasa de 2 a **3**: `["entregada", "devuelta_a_tienda", "incidente"]`.
- `incidente: []` en el mapa (terminal **sin ninguna salida**; el `indemnizada` que se planteó en
  el gate quedó descartado). Tiene entrada (#44) → cumple R26.
- `por_recolectar_en_tienda: [#43]` — entrada por creación, salida #43 → cumple R26.
- `ESTADOS_VESTIGIALES` sigue **vacío** (salvo que Q2 se resuelva por la opción (ii)).

**Familias nuevas del historial (`ORDEN_HISTORIAL_ORIGEN_TIPO_SEED`):** `recoleccion_tienda` (usada
por #43) e `incidente` (ver **Q4**: hoy queda declarada sin arista que la produzca, porque #44 va vía
`gestion`). Ninguna de las dos entra en `ORIGEN_TIPOS_CON_GESTION` (R12): #43 nunca enlaza una
gestión y su destino no es `devuelta`; el value `incidente` no se emite todavía. Mismo criterio
documentado para `recepcion_bodega_central` (138) y `devolucion_rechazada` (139).

### 3.2 BAJAS — DIFERIDAS a las features 155/156 (decisión Q2, 2026-07-29)

> **La 154 NO retira ninguna de estas seis.** La tabla se conserva como inventario de lo que hay
> que retirar y de en qué feature. Motivo: `GuiaAsignacionService` las ejecuta HOY; retirarlas sin
> tocar el service deja `en_fulfillment` sin salidas (rompe R26) y atrapa sus órdenes vivas.
> Reparto: `#4`/`#6`/`#7c` → feature **156**; `#1`/`#3`/`#7b` → feature **155**.

Las que hoy permiten **saltarse la bodega central al generar la guía**. Auditable línea a línea
contra `lib/types/order-status-transiciones.ts` (numeración previa a la 154):

| # | origen | destino | `via` | línea hoy | quién la ejecuta hoy |
| --- | --- | --- | --- | --- | --- |
| #4 | `en_preparacion` | `por_recoger` | `generacion_guia` | `:48` | `GuiaAsignacionService.generarGuia` (GAM + mensajero) |
| #6 | `en_preparacion` | `en_ruta_bodega_satelite` | `generacion_guia` | `:50` | `generarGuia` (no-GAM) |
| #7c | `en_preparacion` | `en_ruta_bodega_satelite` | `ruteo_satelite` | `:53` | `rutearABodegaSatelite` (`ORIGEN_RUTEO_SATELITE`, `GuiaAsignacionService.ts:35`) |
| #1 | `en_fulfillment` | `por_recoger` | `generacion_guia` | `:56` | `generarGuia` (GAM + mensajero) |
| #3 | `en_fulfillment` | `en_ruta_bodega_satelite` | `generacion_guia` | `:58` | `generarGuia` (no-GAM) |
| #7b | `en_fulfillment` | `en_ruta_bodega_satelite` | `ruteo_satelite` | `:60` | `rutearABodegaSatelite` |

**4 pares dirigidos únicos** desaparecerán cuando se retiren (#6/#7c comparten par, #3/#7b
comparten par): `(en_preparacion, por_recoger)`, `(en_preparacion, en_ruta_bodega_satelite)`,
`(en_fulfillment, por_recoger)`, `(en_fulfillment, en_ruta_bodega_satelite)`. **En la 154 los
cuatro siguen siendo legales.**

### 3.3 SUPERVIVIENTES que el spec fija explícitamente

| # | arista | por qué sobrevive |
| --- | --- | --- |
| #5 | `en_preparacion → en_bodega_central` (`generacion_guia`) | **única** salida de "generar guía" tras el cambio; es la arista sobre la que se construye la 156. **Q1 CERRADA: sobrevive.** |
| #2 | `en_fulfillment → en_bodega_central` (`generacion_guia`) | PUENTE hasta que la 155 retire `en_fulfillment`. **Q2 CERRADA: sobrevive (y con ella las otras cuatro salidas de `en_fulfillment`).** |
| #7 | `en_bodega_central → en_ruta_bodega_satelite` (`ruteo_satelite`) | asignación a satélite, sale de bodega |
| #8 | `en_bodega_central → por_recoger` (`asignacion_bodega`) | asignación a mensajero, sale de bodega |
| #9 | `en_bodega_satelite → por_recoger` (`asignacion_satelite`) | asignación del satélite a su mensajero |

Todo lo demás del mapa (#10–#42) queda **byte-idéntico**.

### 3.4 Recuentos (REALES, con la decisión Q2 = solo aditiva)

| | antes (post-153) | después |
| --- | --- | --- |
| `ORDER_STATUS_SEED` | 18 | **20** |
| `ORDEN_HISTORIAL_ORIGEN_TIPO_SEED` | 22 | **24** |
| aristas de flujo (`RECUENTO_INVENTARIO.aristasFlujo`) | 43 | **45** (43 + 2, sin bajas) |
| pares dirigidos únicos (`paresUnicos`) | 39 | **41** (39 + 2: las dos nuevas estrenan par) |
| aristas de creación (`aristasCreacion`) | 3 | **4** |
| `ESTADOS_CREACION` | 3 | **4** |
| `ESTADOS_TERMINALES` | 2 | **3** |
| `ESTADOS_VESTIGIALES` | 0 | **0** (sigue vacío) |

### 3.5 Cómo habrían cambiado los recuentos según Q1 y Q2 *(histórico)*

| escenario | flujo | pares | riesgo |
| --- | --- | --- | --- |
| **ELEGIDO** — Q2 = solo aditiva, 0 bajas | **45** | **41** | ninguno: nada se rompe entre la 154 y la 155/156 |
| Propuesta original (retirar 6, #5 y #2 sobreviven) | 39 | 37 | ventana en la que "generar guía" y "rutear a satélite" lanzan `TransicionIlegalError` |
| Q2 = (ii)/(iii): se retira también #2 | 38 | 36 | `en_fulfillment: []` → rompe R26 |
| Q1 = "retirar también #5" | 37 | 35 | `en_preparacion: []` → rompe R26 **y** deja a la 156 sin destino |

---

## 4. Presentación (`EstatusBadge.tsx`)

`ORDER_STATUS_LABELS` y `ORDER_STATUS_VARIANT` son `Record<OrderStatusValue, …>`: en cuanto el SEED
crezca, **el build rompe** hasta que se añadan las dos entradas. Es la misma red de seguridad que el
`satisfies` del mapa y no se relaja.

| value | label propuesto | variante | refuerzo `ORDER_STATUS_CLASS` |
| --- | --- | --- | --- |
| `por_recolectar_en_tienda` | "Por recolectar en tienda" | `warning` (estado de ESPERA, criterio de `por_devolver`) | ninguno |
| `incidente` | "Incidente" | `danger` (criterio de `rechazada`) | ninguno |

**Q5 CONFIRMADA por el humano (2026-07-29) tal cual.** `EstatusBadge` ya cae a chip neutro con el
valor crudo ante un value desconocido (`isKnownStatus`) → R31 no requiere cambio de código, solo
un test que lo fije.

---

## 5. Secuencia de migración ↔ despliegue (fallo CERRADO)

El guard de la 140 falla cerrado: si no puede DEMOSTRAR que una transición es legal, la rechaza
(`TransicionNoValidableError`). Hay dos direcciones de drift y conviene tenerlas separadas:

- **DB adelantada al build** (migración aplicada, build viejo): la tabla `order_status` tiene dos
  values que `ORDER_STATUS_SEED` del build no lista. `esOrderStatusValue` devuelve `false` →
  `TransicionNoValidableError("estatus_desconocido")`. **Inocuo aquí**, porque en esta feature
  ninguna orden apunta a esos values: nadie los produce hasta la 155/157.
- **Build adelantado a la DB** (código desplegado, migración no aplicada): el build conoce dos
  values que la tabla no tiene; resolver `value → id` para ellos no encontraría fila. **Inocuo aquí**
  por la misma razón. R33 lo cubre como regresión.

Conclusión: el orden migración↔despliegue es **indiferente para esta feature**; el peaje real
aparece en la 155/157, que sí escriben esos estados. Lo que **no** es indiferente es la retirada de
aristas → **Q3**.

### 5.1 El riesgo que hay que decidir antes de implementar (Q3)

`GuiaAsignacionService` ejecuta HOY las 6 aristas de §3.2. Retirarlas sin tocar el service (que es
el alcance declarado) hace que, desde el merge de la 154 hasta el merge de la 156:

- "Generar guía" con mensajero → `TransicionIlegalError` (`en_preparacion → por_recoger`).
- "Generar guía" sobre orden no-GAM → `TransicionIlegalError`.
- "Rutear a bodega satélite" desde `en_preparacion`/`en_fulfillment` → `TransicionIlegalError`.

No es un bug del diseño: es la consecuencia inevitable de separar la retirada de aristas (154) del
recableado del service (156). **Mitigación propuesta:** la 154 no llega sola a `prod`; el lote
154 + 155 + 156 viaja como un tren. En `dev` y en preview el desfase es aceptable y visible.
Requiere confirmación humana.

---

## 6. Alternativas descartadas

**A1 — Retirar las 6 aristas en la feature 155/156, junto al recableado de
`GuiaAsignacionService`, y dejar la 154 puramente aditiva.** → **ES LA ELEGIDA (Q2, 2026-07-29).**
El humano cerró el gate por aquí: el coste de "diff duplicado" que se le imputaba abajo resultó
menor que el de una ventana de despliegue con "generar guía" roto. El texto original queda como
registro de por qué se había descartado.
Es la alternativa más segura desde el punto de vista de despliegue: elimina por completo el riesgo
de §5.1, porque la arista muere en el mismo commit que su último productor.
**Descartada** porque el lote asigna a la 154 el rol de "único diff del grafo": partir la reescritura
del mapa en dos features obliga a tocar dos veces `TRANSICIONES`, dos veces el fixture del
inventario y dos veces los tests de conectividad, con recuentos intermedios que no corresponden a
ningún estado aprobado del flujo. El coste de A1 es diff duplicado y un estado intermedio del grafo
que nadie diseñó; el coste de la opción elegida es una ventana de despliegue, que se cierra con el
tren de release de §5.1. **Si el humano responde Q3 con "la 154 se despliega sola a producción",
esta alternativa deja de ser descartable y hay que volver a ella.**

**A2 — Una sola migración con el INSERT del catálogo y el `ALTER TYPE ADD VALUE` juntos.**
Descartada: aunque técnicamente los dos values de enum no se USAN en la transacción (y por tanto no
dispararía 55P04), rompe el precedente del repo — la 139 partió deliberadamente
`20260724140000_order_status_*` y `20260724150000_orden_historial_origen_*` — y mezcla dos objetos
con reversibilidad muy distinta: el catálogo revierte con un `DELETE` guardado e inocuo, el enum con
una recreación del tipo que puede abortar. Juntas, un fallo del `down` del enum bloquearía también
el del catálogo.

**A3 — Volver `order_status` a un enum de Postgres, por uniformidad con la familia de historial.**
Descartada: `20260714123909_reconcile_fks_drop_order_status_value` hizo justo el camino contrario
(enum → tabla) para poder referenciarlo por FK. Volver atrás es una regresión de arquitectura y
convertiría cada alta de estado futura en un `ALTER TYPE` irreversible.

**A4 — Declarar `en_fulfillment` VESTIGIAL en vez de conservarle el puente #2** (opción (ii) de Q2).
Descartada como propuesta por defecto: el mecanismo `ESTADOS_VESTIGIALES` existe para "un estado
futuro que naciera sin flujo", no para un estado con órdenes vivas; usarlo aquí obliga a reescribir
el test que exige el conjunto vestigial vacío y, sobre todo, deja atrapadas las órdenes que hoy están
en `en_fulfillment` hasta que la 155 haga el backfill. Sigue sobre la mesa como respuesta a Q2 si el
humano prefiere no dejar aristas de cortesía.

**A5 — Relajar el `satisfies Record<OrderStatusValue, …>` para no tener que tocar el badge ni el
mapa al añadir values.**
Descartada de plano: es la red de seguridad que garantiza R25 y la única razón por la que "olvidar
clasificar un estado" es un fallo de build y no un incidente de producción. Instrucción explícita
del lote: no relajarla.

---

## 7. Contratos de entrada/salida

No hay ninguno nuevo. Se documenta lo que **no** cambia, para que el reviewer pueda verificarlo:

- **API pública de integradores** (`openapi-spec.ts`, feature 88): sin cambios. Ningún estado nuevo
  es alcanzable por el canal API en esta feature.
- **Webhooks de cambio de estado** (feature 104/112): sin cambios. Al no producirse ninguna
  transición nueva, no se emite ningún payload con los values nuevos.
- **Server Action `listarOrderStatus`** (feature 63): devuelve el catálogo tal como está en la tabla;
  tras la migración A devolverá 20 filas en vez de 18. Consumidores: filtros de listado. Efecto
  esperado y aceptado (los dos estados aparecerán en el desplegable de filtro sin resultados hasta la
  155/157). **Si esto no es aceptable para el negocio, es un requisito nuevo, no un supuesto de este
  spec** — anotarlo en la puerta.

---

## 8. Trazabilidad requisito → artefacto verificable

| R | Artefacto donde se verifica |
| --- | --- |
| R1–R4 | migración A + `tests/integration/db/<nueva>-migration.test.ts` + `tests/unit/types/order-status.test.ts` + `tests/unit/scripts/seed-order-status.test.ts` |
| R5–R6 | `down.sql` de la migración A + test estático de la migración |
| R7–R9 | migración B + `db/schema.prisma` + `_EnsureExhaustive` de `lib/types/orden-historial.ts` + test estático |
| R10–R11 | `down.sql` de la migración B + test estático |
| R12 | test de `ORIGEN_TIPOS_CON_GESTION` (patrón 138/139) |
| R13–R17 | `tests/unit/domain/order-status-transiciones.guardia.test.ts` + `…connectividad.test.ts` |
| R18–R24 | `…guardia.test.ts` (casos negativos por arista retirada) + test del mensaje sin PII |
| R25 | `…connectividad.test.ts` ("exhaustividad") + el propio build (`satisfies`) |
| R26 | `…connectividad.test.ts` |
| R27 | `tests/fixtures/inventario-transiciones-140.ts` + los tests que lo recorren |
| R28 | guard de censo nuevo (patrón `tests/unit/guards/censo-order-status-rename.test.ts`) |
| R29–R31 | `tests/components/EstatusLabel.test.ts` |
| R32–R33 | `tests/unit/repositories/registrar-cambio-estado.guardia.test.ts` (regresión) |
