# Feature 239 — bitácora de implementación · T1, T2, T3, T4 y T5 (parcial)

> Rama `feature/239-devolucion-espera-cierre`, base `origin/dev` = `9f80b57f`.
> Tandas cubiertas: **T1**, **T2**, **T3**, **T4** entera y **T5.1/T5.2/T5.3/T5.5**.
> **NO están hechas, y son de otro:** T0.1 (re-medir producción), T0.3 (aviso a integradores),
> T5.4 (consulta de población atascada contra producción), T5.6 (ver la app) y T6 (cierre
> documental).

---

## Estado del árbol tras T3

**Las dos mitades ya están del mismo lado.** Con T1+T2+T3 dentro, `/novedades` y el cron del SLA
miran EL MISMO HECHO —el estado de la orden— y la columna `gestion_aprobada` ya no existe.
El agujero que describía este apartado (T1+T2 sin T3 dejaban `/novedades` vacía con el árbol
verde) **está cerrado**.

Lo que falta para el PR es T4 (los emuladores restantes y la guardia de no-fusión), T5 (las dos
mutaciones que quedan, `test:guardias` ya corrido, y ver la app) y T6 (cierre documental). El
detalle, al final.

---

## Qué se tocó

### Migraciones (dos, las dos con su `down.sql`)

| Carpeta | UP | DOWN |
| --- | --- | --- |
| `db/migrations/20260819110000_orden_historial_origen_anclaje_devolucion/` | `ALTER TYPE … ADD VALUE IF NOT EXISTS 'anclaje_devolucion'` | RENAME + `CREATE TYPE` con los **26** valores vigentes + `ALTER COLUMN … USING` + `DROP TYPE …_old` |
| `db/migrations/20260819120000_order_status_devolucion_por_confirmar/` | `INSERT … WHERE NOT EXISTS` por `value` | `DELETE … AND NOT EXISTS` (orden ni historial): si alguien lo referencia, la fila **sobrevive huérfana** |

**Ninguna de las dos mueve órdenes de estado desde SQL** (R31): sin backfill, ni en el up ni en el
down. Está afirmado en `tests/integration/db/anclaje-devolucion-migration.test.ts`.

**Índices parciales tras el recreate del enum — comprobado, no supuesto.** La única columna que usa
`orden_historial_origen_tipo` es `orden_historial_estado.origen_tipo`, y sobre ella hay **un**
índice (`orden_historial_actor_origen_created_idx`, feature 167). **No hay ningún índice parcial**
cuyo predicado mencione el enum — censado sobre `db/migrations/*/migration.sql` y afirmado en un
caso del test de migración. `ALTER COLUMN … TYPE` reconstruye solo los índices que dependen de la
columna, así que el `down.sql` **no rehace ninguno a mano**. Medido contra la base local (abajo):
tras el down, los cuatro índices de la tabla siguen ahí.

**Rollback encadenado (condición conocida, documentada en el propio `down.sql`).** Los `down.sql`
de migraciones anteriores de este enum **NO se tocan**: son fotos históricas. Varios recrean el tipo
con **lista cerrada** (p. ej. el de `asignacion_recoleccion`, 157, con 25 valores), así que
aplicarlos *después* de esta migración deja el enum sin `anclaje_devolucion` aunque este down no se
haya corrido. Lo que sí se ajustó son los **tests** que derivan «los N previos» del SEED vigente
(siete archivos de `tests/integration/db/`): a cada uno se le sumó `anclaje_devolucion` a su
conjunto `AÑADIDOS_EN_O_DESPUES_DEL_<n>`.

### Producción

| Archivo | Qué |
| --- | --- |
| `lib/types/order-status.ts` | +`devolucion_por_confirmar` como **apéndice** (índice 20). Catálogo 20 → 21 |
| `db/schema.prisma` | +`anclaje_devolucion` en el enum `OrdenHistorialOrigenTipo` (26 → 27) |
| `lib/types/orden-historial.ts` | +`anclaje_devolucion` al SEED. **NO** entra en `ORIGEN_TIPOS_VISITA_REAL` ni en `ORIGEN_TIPOS_CON_GESTION` |
| **`lib/types/gestion-destino.ts` (nuevo)** | **La bisagra.** `ESTATUS_POR_RESULTADO` con sus dos `satisfies` + `estatusDestinoDeResultado()` + `ESTATUS_DEVOLUCION_POR_CONFIRMAR` |
| `lib/services/MisAsignacionesService.ts` | deja de usar `findEstatusIdByValue(input.resultado)`; usa el mapa |
| `lib/types/order-status-transiciones.ts` | **altas** #59 `en_reparto → ⟨PRE⟩`, #60 `⟨PRE⟩ → devuelta` (`anclaje_devolucion`), #61 `⟨PRE⟩ → en_reparto` (`deshacer_gestion`); **baja** #14 `en_reparto → devuelta`. 54 → 56 aristas, 52 → 54 pares |
| `lib/services/CierreDiaService.ts` | `ESTADOS_ESPERADOS.devuelta` gana el pre-estado en **primera** posición (R24) |
| `app/(app)/ordenes/_components/EstatusBadge.tsx` | etiqueta «Devolución por confirmar» + variante `warning` (la de `devuelta`) |
| `lib/types/rastreo-publico.ts` | hito `no_entregado`, **el mismo que `devuelta`** (R28) |
| `app/(app)/ordenes/exclude-por-rol.ts` | excluido para `adminTienda`, junto a `devuelta` |
| `lib/types/webhook-eventos.ts` | **NO se añade** (P2) + el porqué escrito al lado |
| `lib/utils/estados-bodega-satelite.ts` | **NO se añade** (P4 firmada en contra) + el precio escrito al lado |
| `lib/types/tablero-dia.ts` | **NO se añade** (default `otros` es correcto) + el porqué |
| `lib/interfaces/repositories/ICierresAdminRepository.ts` | `AnclajeDevolucionConfig` + `ResolverCierreInput` pasa a **unión discriminada** por `nuevoEstado` |
| `lib/repositories/CierresAdminRepository.ts` | **−** el `updateMany` de `gestionAprobada` (T2.3) · **+** el bloque de anclaje al final de la rama `aprobado` |
| `lib/services/CierresAdminService.ts` | resuelve los dos ids del anclaje y **falla cerrado** si alguno es `null` (R9) |

### Tests nuevos

- `tests/unit/types/gestion-destino.test.ts`
- `tests/unit/types/webhook-eventos.test.ts`
- `tests/unit/utils/estados-bodega-satelite.test.ts`
- `tests/integration/db/anclaje-devolucion-migration.test.ts`
- `tests/unit/repositories/cierres-admin-anclaje-devolucion.test.ts` ← *el archivo que el
  comentario de `cierres-admin-repository.test.ts` prometía y no existía*
- `tests/unit/guards/aprobacion-escrituras-cubiertas.guardia.test.ts` (R33, con autocomprobación)
- `tests/fixtures/anclaje-devolucion.ts` (cableado mínimo para los dobles de `resolverCierre`)

### Tests actualizados (con nota fechada en cada uno)

Inventarios congelados 20 → 21 (`buckets-estatus.guardia`, `definiciones-catalogo.guardia`,
`EstatusBadgeCatalogoV2`, `EstatusLabel`, `rastreo-hitos-exhaustivo.guardia`,
`rastreo-sin-estatus-crudo.guardia`, `order-status.test`, `seed-order-status`,
`order-status-v2-migration`, `connectividad`), enum 26 → 27 (`orden-historial-types`, los siete
`*-migration.test.ts` del enum, `orden-historial-cobertura` con el punto de escritura **#28**),
recuentos de transiciones (`order-status-transiciones.guardia`, `inventario-transiciones-140`),
y los dobles de `resolverCierre` (seis archivos) por el parámetro obligatorio.

---

## Mapa `R<n> → test` (solo los cubiertos por T1 y T2)

| Req | Test |
| --- | --- |
| R1 | `tests/unit/types/order-status.test.ts` — «contiene exactamente los 21 valores esperados» · `order-status-transiciones.connectividad.test.ts` (entrada y salida) |
| R2 | `tests/unit/services/mis-asignaciones-service.test.ts` — «R1/239-R2: devolver deja la orden en el PRE-ESTADO (no en `devuelta`) y sin seguimiento» |
| R3 | `tests/unit/types/gestion-destino.test.ts` — «`devuelta` es el UNICO resultado cuyo destino NO es su propio nombre» (+5 casos) |
| R4 | `tests/unit/repositories/cierres-admin-anclaje-devolucion.test.ts` — «al aprobar, la devolucion de ESTE cierre pasa a `devuelta` en la misma tx» |
| R4c/R5 | ídem — 5 casos de «LA CARRERA DE LOS DOS CIERRES» (**mutación medida abajo**) |
| R6 | ídem — «RECHAZAR un cierre no mueve ninguna orden del pre-estado ni registra anclaje» · `cierres-admin-service.test.ts` — «el RECHAZO no pasa config de anclaje» |
| R7 | ídem — «el append lleva actor = el admin, `anclaje_devolucion` y ENLAZA la gestion ancla» |
| R8 | ídem — 2 casos · `tests/integration/db/wallet-idempotencia.test.ts` — «R6/239-R4/R8: aprobar ANCLA solo la devolucion de ESTE cierre, y re-aprobar no cambia nada» |
| R9 | `tests/unit/services/cierres-admin-service.test.ts` — «catalogo SIN el pre-estado → la aprobacion NO ocurre y no hay efectos parciales» + su gemelo sin `devuelta` |
| R10 | `cierres-admin-anclaje-devolucion.test.ts` — «money-neutral: el `data` lleva SOLO `estatusId`» (igualdad exacta) · los cinco feeds y sus idempotencias **verdes sin tocar** |
| R11 | `ordenes-columnas-money-safe.guardia.test.ts` y `dinero-sin-centimos.guardia.test.ts` **verdes sin tocar** |
| R24 | `tests/unit/services/cierre-dia-service.test.ts` — caso nuevo «239: el mensajero deshace su devolucion del dia desde el pre-estado» |
| R25 | `tests/unit/repositories/orden-repository.test.ts` — 3 casos (reasignables por igualdad, paradas solo `en_reparto`, y el grafo sin salida hacia asignación/ruteo/recolección) |
| R26 | typecheck (los 3 `Record` totales rompieron el build y se arreglaron) + un test por mapa parcial: `OrdenesExcludePorRol.test.ts`, `webhook-eventos.test.ts`, `estados-bodega-satelite.test.ts`, `buckets-estatus.test.ts` |
| R27 | `tests/unit/types/webhook-eventos.test.ts` — «el pre-estado NO es evento publico» + «`devuelta` SIGUE siendo evento publico» |
| R28 | `tests/unit/guards/rastreo-hitos-exhaustivo.guardia.test.ts` — el pre-estado comparte hito con `devuelta` |
| R29 | `tests/unit/domain/order-status-transiciones.guardia.test.ts` — «`en_reparto → devuelta` ya es ILEGAL» + las tres altas + «P4: el pre-estado NO tiene arista de `recuperacion_manual`» |
| R31 | `tests/integration/db/anclaje-devolucion-migration.test.ts` — ni el up ni el down tocan `orden`/`estatus_id` |
| R32 | ídem (down recrea el tipo con los 26 previos; borra el value solo si nadie lo referencia) + verificación real contra la base local |
| R33 | `tests/unit/guards/aprobacion-escrituras-cubiertas.guardia.test.ts` (**autocomprobación medida abajo**) + las dos suites de T2.5 con el `.filter(...)` retirado |

**R16/R17 (no son de estas tandas, pero se verificaron por ser el riesgo declarado):**
`intentos-entrega-criterio-unico.test.ts` **verde sin tocarse**. De
`criterio-intento-entrega.test.ts` se tocó **un solo caso**, y **no por fusión de criterios**: la
arista del mensajero cambió de **destino**, no de familia. `whereIntentosVigentes` no mira ningún
destino de transición (mira `resultado` + cierre aprobado + `ORIGEN_TIPOS_VISITA_REAL`), así que el
conteo de intentos **no cambia**; el caso ahora afirma justamente eso, y además que
`anclaje_devolucion` **no** está en `ORIGEN_TIPOS_VISITA_REAL`.

---

## T2.4 — ningún feed de dinero lee `orden.estatus_id` (verificado, no supuesto)

Revisado archivo por archivo:

| Feed | Qué lee |
| --- | --- |
| `WalletFeedService` | `gestionOrden.findMany({ cierreId }, select: { ordenId, resultado })` + `cierre_detail` (snapshot) |
| `WalletTiendaFeedService` | `gestionOrden.findMany({ cierreId }, select: { ordenId, resultado, montoRecibido })` + `cierre_detail` |
| `CajaCodFeedService` | `walletTiendaMovimiento.findMany` (lo que el ledger acaba de escribir) |
| `WalletMensajeroFeedService` | `cierreDia.findUnique` (`mensajeroId`, `totalPagoMensajero`, `totalEfectivo`) |
| `WalletIndemnizacionFeedService` | `gestionOrden.findMany({…}, select: { indemnizacion })` |
| `leerDetallePorOrden` (compartido) | `cierreDetail.findMany({ cierreId })` |

**Cero lecturas de `orden.estatus_id`.** Por eso el bloque de anclaje puede ir al final sin mover
ninguna aserción de orden — y `cierres-admin-caja-cod.test.ts`, que **mide el orden de las
llamadas**, quedó **verde sin tocarse** (solo se le añadió el parámetro obligatorio).

---

## Salida real

### `pnpm run typecheck`

```
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit
```

exit=0

### `pnpm run lint`

```
✖ 89 problems (0 errors, 89 warnings)
  0 errors and 1 warning potentially fixable with the `--fix` option.
```

exit=0 — los 89 warnings son `no-unused-vars` de dobles de test **preexistentes**; ninguno en
archivos de esta feature.

### `pnpm test` (`vitest run`, suite completa)

```
 Test Files  1184 passed (1184)
      Tests  15222 passed | 26 skipped (15248)
   Start at  06:47:45
   Duration  303.20s (transform 35.28s, setup 77.05s, import 778.11s, tests 639.40s, environment 500.87s)
```

exit=0

### Suites de dinero de `resolverCierre` + los dos criterios de intento

```
pnpm exec vitest run tests/unit/repositories/cierres-admin-caja-cod.test.ts \
  tests/integration/db/wallet-idempotencia.test.ts \
  tests/unit/repositories/cierres-admin-repository.test.ts \
  tests/unit/repositories/cierres-admin-indemnizacion.test.ts \
  tests/integration/db/cierre-detail-congelado.test.ts \
  tests/unit/services/intentos-entrega-criterio-unico.test.ts \
  tests/unit/types/criterio-intento-entrega.test.ts

 Test Files  7 passed (7)
      Tests  103 passed (103)
```

### Migraciones contra la base local (`localhost:5432`, base `ordenex`)

`prisma migrate deploy` (aplica las dos) → `db:rollback` + el `down.sql` del enum a mano →
consulta de estado → `migrate deploy` otra vez → `migrate deploy` una tercera (idempotencia).

```
# tras el rollback completo
enum values: 26
tiene anclaje_devolucion: false
indices de orden_historial_estado: orden_historial_actor_origen_created_idx | orden_historial_estado_orden_id_created_at_idx | orden_historial_estado_orden_id_estatus_destino_id_idx | orden_historial_estado_pkey
order_status tiene el pre-estado: 0
order_status total: 22

# tras re-aplicar
enum values: 27
tiene anclaje_devolucion: true
indices de orden_historial_estado: orden_historial_actor_origen_created_idx | orden_historial_estado_orden_id_created_at_idx | orden_historial_estado_orden_id_estatus_destino_id_idx | orden_historial_estado_pkey
order_status tiene el pre-estado: 1
order_status total: 23

# tercera pasada
No pending migrations to apply.
```

Los **cuatro índices** de `orden_historial_estado` sobreviven al `ALTER COLUMN … TYPE` del down —
incluido el que lleva `origen_tipo`. **El down no tiene que rehacer ningún índice.**

> `order_status total` es 23 y no 21 porque la base local arrastra dos filas huérfanas de values
> retirados por features anteriores (el patrón «se borra solo si nadie lo referencia»). El seed
> vigente son 21.

---

## Las dos medidas de mutación

### 1 · La carrera de los dos cierres (obligatoria, T5.2)

`lib/repositories/CierresAdminRepository.ts` · sha256 **antes**:
`e3534a984efe90544c61249cde7b56c16a9529b83424f64308fa58a07c14aa1f`

Mutación aplicada — se retira la comprobación de «gestión vigente más reciente»:

```ts
- const anclables = gestionesDelCierre.filter(
-   (g) => masRecientePorOrden.get(g.ordenId) === g.id,
- );
+ const anclables = gestionesDelCierre; // MUTACION T5.2: sin comprobar recencia
```

sha256 mutado: `175cc4317ee7d592ad704b28499ef6870efa6e84381b5b0350b49b4504c36de0`

**ROJO** (salida real):

```
 ❯ tests/unit/repositories/cierres-admin-anclaje-devolucion.test.ts (13 tests | 2 failed) 19ms
     × R5: aprobar el cierre VIEJO no ancla (su gestion ya no es la vigente mas reciente) 6ms
     × R5: con DOS ordenes en el cierre, se ancla la que toca y solo esa 1ms

AssertionError: expected { o1: 'os-devuelta' } to deeply equal { o1: 'os-devolucion_por_confirmar' }
 Test Files  1 failed (1)
      Tests  2 failed | 11 passed (13)
```

Restaurado · sha256 **después**:
`e3534a984efe90544c61249cde7b56c16a9529b83424f64308fa58a07c14aa1f` (idéntico al de antes).

```
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

### 2 · Autocomprobación de la guardia de cobertura de escrituras (T2.6)

`tests/unit/repositories/CierresAdminRepository.resolverCierre.devolucion.test.ts` · sha256
**antes**: `d76d760edeae1567e7b72969f5b840ae09e0ef93da72aa12bb7acab681617a82`

Se repone el `.filter((c) => c.where.id !== undefined)` que T2.5 retiró. La guardia se pone
**ROJA**:

```
- []
+ [
+   "tests/unit/repositories/CierresAdminRepository.resolverCierre.devolucion.test.ts",
+ ]
 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
```

Restaurado · sha256 **después**: `d76d760edeae1567e7b72969f5b840ae09e0ef93da72aa12bb7acab681617a82`

```
 Test Files  2 passed (2)
      Tests  14 passed (14)
```

> El detector tuvo **dos falsos positivos** antes de quedar bien, y los dos quedan escritos como
> casos: (i) ladraba ante los **dobles de Prisma** que emulan un `where` parcial —eso no descarta
> aserciones, es la base fingiendo ser la base—; (ii) ladraba ante la **mención en un comentario**
> del filtro retirado, lo que habría obligado a borrar la explicación para pasar la guardia. Se
> resuelve exigiendo `mock.calls` en la misma cadena y pasando el fuente por
> `quitarComentarios` (el quitador único de la feature 209).

---

## Decisiones que hubo que tomar, y que conviene revisar

1. **`ResolverCierreInput` es ahora una unión discriminada, no un objeto plano con un campo
   obligatorio.** `design.md` §3.3 pedía «`anclajeDevolucion` **requerido**». Plano no funciona:
   `rechazarCierre` llama al mismo método y tendría que resolver dos ids de catálogo que no usa —
   y, si el catálogo estuviera incompleto, el rechazo fallaría por algo que no le incumbe (R6 dice
   justo lo contrario). La unión por `nuevoEstado` expresa las dos mitades: **obligatorio** al
   aprobar y **`?: never`** al rechazar. El coste declarado del design se pagó igual: todos los
   dobles de `resolverCierre` (6 archivos) tuvieron que pasarlo, y ahí es donde rompió el
   typecheck, que es la señal buscada.

2. **`criterio-intento-entrega.test.ts` tuvo que tocarse en un caso.** El design lo lista entre los
   que «quedan verdes sin tocarse». El caso afirmaba «la arista a `devuelta` del mensajero es de
   familia `gestion`», y eso deja de ser cierto **por el cambio de destino**, no por una fusión de
   criterios. Está reescrito con nota fechada y afirmando el invariante que sí importa (R17: el
   conteo no cambia). Merece una segunda lectura del revisor.

3. **T0.1 (re-medir contra producción) NO está hecha** — es T0, fuera del encargo. La foto del
   2026-08-18 (0 en `devuelta`, 12/12 cierres aprobados, mediana 8,2 h · p90 22,1 h · máx 48,2 h)
   **caduca y no se cita como vigente**. Hay que rehacerla antes de desplegar.

4. **T0.3 (aviso a integradores) NO está hecha.** Bloquea el despliegue, no el código: desde esta
   feature `devuelta` se emite al **aprobar**, no al gestionar.

5. **T2.5 cita `cierres-admin-repository.test.ts:1143-1146`**; el filtro vivía en ese bloque y en
   otros dos del mismo archivo (los tres retirados), más el helper de
   `…resolverCierre.devolucion.test.ts`. Todos fuera.

6. **`wallet-idempotencia.test.ts` y `cierre-detail-congelado.test.ts` cambiaron de doble.** Sus
   fakes emulaban el `updateMany` por relación de `gestion_aprobada`; ahora emulan la guarda por
   `estatus_id` del anclaje. En los dos casos el doble **honra el `where`** en vez de devolver un
   `{count}` a ciegas — un doble mudo haría pasar en verde una versión del bloque **sin** guarda,
   que es justo lo que quita la idempotencia.

---

## Lo que falta para cerrar la ficha

T3 (el reloj y la visibilidad, incluida la retirada de `gestion_aprobada`), T4 (los tests
legítimamente invertidos), T5 (las tres mutaciones restantes, `test:guardias` completo y el
recorrido por la app) y T6 (cierre documental). **Y T0.1 / T0.3 antes de desplegar.**

---

# T3 — el reloj y la visibilidad

Es la tanda que cierra el fallo. Hasta aquí `dev` tenía la mitad que **quita la visibilidad** sin
la que **mueve el reloj**; T3 pone las dos a mirar el mismo hecho.

## Qué se tocó

### Migración (T3.1)

`db/migrations/20260819130000_orden_retiro_gestion_aprobada/`

| | |
| --- | --- |
| `migration.sql` | `ALTER TABLE "orden" DROP COLUMN "gestion_aprobada";` |
| `down.sql` | `ALTER TABLE "orden" ADD COLUMN IF NOT EXISTS "gestion_aprobada" boolean NOT NULL DEFAULT false;` |

**Pérdida de dato declarada:** el down repone la columna, no sus valores. Es aceptable porque
después de la 239 ningún valor suyo significa nada —quien decide si una devolución está confirmada
es el estado— y porque el código anterior la leía con `DEFAULT false`, que es justo lo que el down
deja: una base que ese código puede leer (R32). **Ni el up ni el down mueven órdenes de estado**
(R31), y eso se afirma en la guardia, sobre el SQL **sin comentarios** (los dos explican por qué
*no* hacen ese `UPDATE`).

**Esta migración ES el arreglo del recorte retroactivo (R30).** La columna era `NOT NULL DEFAULT
false`, así que toda devolución anterior a ella valía `false` y **caía** de `/novedades`. Al
desaparecer, esas devoluciones vuelven a verse solas. Sin backfill, y por eso no lo hay.

### Producción

| Archivo | Qué |
| --- | --- |
| `db/schema.prisma` | fuera la columna `gestionAprobada` |
| `lib/repositories/OrdenRepository.ts` | `novedadWhere` vuelve a `{ estatus: { value: "devuelta" } }` · `habilitarNovedad` pasa a `{ ayuda: false }` |
| `lib/repositories/DevolucionSlaRepository.ts` | `findDevueltasSla` proyecta la última fila `anclaje_devolucion` y ancla ahí; `liberarDevueltaSla` pierde el apagado de la columna |
| `lib/interfaces/repositories/IDevolucionSlaRepository.ts` | `DevueltaSlaRow` gana `origenAncla: "aprobacion" \| "legado"` |
| `lib/interfaces/services/IDevolucionSlaService.ts` | `DevolucionSlaResult` gana `legadas` |
| `lib/services/DevolucionSlaService.ts` | cuenta `legadas`, avisa con un conteo agregado, y **reescribe la prosa caducada de Q5** (T3.5) |
| `app/api/cron/procesar-devueltas-sla/route.ts` | expone `legadas` en el 200 (único cambio del contrato HTTP, aditivo) |
| `lib/interfaces/repositories/IOrdenRepository.ts` · `lib/interfaces/services/IHabilitarNovedadService.ts` · `lib/types/novedad-habilitar.ts` · `lib/services/HabilitarNovedadService.ts` · `lib/actions/habilitar-novedad.ts` | prosa al día: «apaga las dos banderas» ya no es cierto |

### Tests

Nuevo: `tests/unit/guards/gestion-aprobada-retirada.guardia.test.ts` (censo del árbol, R20, con
autocomprobación de cuatro casos).
Ampliados: `orden-repository.novedades.test.ts` (+6), `devolucion-sla-repository.test.ts` (+5),
`devolucion-sla-service.test.ts` (+6), `habilitar-novedad-service.test.ts` (+2), los dos
emuladores `resolver-novedad-*-sla.test.ts` (+1 cada uno).

## Los dos puntos que pediste tratar con cuidado

### 1 · `count` y `find` siguen compartiendo el `where`

La aserción viva **no se tocó y está verde**:

```
tests/unit/repositories/orden-repository.novedades.test.ts
  R8: ambos metodos construyen exactamente el mismo predicado anclado al estado
    expect(whereCount).toEqual(whereFind);
    expect(whereCount).toEqual(NOVEDAD_WHERE);
```

Además queda **renombrada con su requisito** en un caso nuevo («R21: `count` y `find` comparten
EXACTAMENTE el mismo where»), que es la aserción que la mutación T5.3 tendrá que matar. El
predicado no puede divergir por construcción: los dos métodos llaman al mismo `novedadWhere`
privado.

### 2 · El reloj y la rama legada

**El ancla es ahora la fila de historial `anclaje_devolucion`**, con `orderBy createdAt desc` +
`take 1` — el `desc` es lo que implementa R15 (la vuelta completa gana el anclaje más reciente).

**La rama legada NO es un `??` mudo:** viaja en el DTO como `origenAncla: "aprobacion" | "legado"`,
el servicio la **cuenta** en `legadas`, y el cron la **expone** en su 200 y la registra con un
aviso de conteo agregado (sin PII, R35).

**Y sí, hace falta — es requisito, no adorno.** Tres razones, y la primera basta:

1. **R14 la exige literalmente.** «SI una orden está en `devuelta` y no existe en su historial
   ninguna transición de anclaje, ENTONCES el sistema DEBE anclar su ventana en la fecha de su
   gestión `devuelta` vigente más reciente.» No es opcional.
2. **La foto de 0 órdenes es de producción, y no es la única base.** Preview y local sí tienen
   órdenes en `devuelta`; el `down.sql` del catálogo contempla explícitamente que la fila del
   pre-estado sobreviva huérfana. Sin la rama, cualquiera de esas órdenes se quedaría sin ancla.
3. **Sin ella, la alternativa es peor.** Sin rama legada `ancladaAt` tendría que ser nullable y
   alguien decidiría qué hacer con el `null` aguas abajo —o peor, el cron trataría la ausencia
   como «vencida hace mucho» y escalaría. La rama nombrada convierte «no sé» en un caso con
   nombre, contado, visible y **conservador** (mantiene el plazo que la orden ya tenía).

Con 0 órdenes en producción, `legadas` debe salir **0 desde la primera corrida** y quedarse ahí.
Eso es precisamente lo que la hace útil: es la medida que dice que el grandfather está vacío, y la
que delataría a cualquiera que meta órdenes en `devuelta` por fuera del anclaje.

## R22 y R23 — qué se hizo y qué queda con dueño

**R23 queda CERRADO, y por construcción.** «Habilitar» apagaba `gestion_aprobada`: la fila
desaparecía de `/novedades` y la orden **seguía en `devuelta`**, así que a los 5 días el cron la
escalaba a `rechazada` y la cobraba, sin aviso (auditoría §2.2). Con la rama de la devolución
convertida en una igualdad de estado, **ninguna bandera puede esconderla**: mientras la orden siga
en `devuelta` —o sea, mientras su reloj corra— sigue listada. No hay comprobación nueva que alguien
tenga que recordar: se retiró la palanca. Tests: `orden-repository.novedades.test.ts` («R23:
`habilitarNovedad` apaga SOLO `ayuda`») y `habilitar-novedad-service.test.ts` (+2).

**R22 queda ABIERTO por decisión firmada, y aquí está el detalle para que se pueda cerrar.** La
rama `{ ayuda: true }` de `novedadWhere` **no acota estatus**, así que una orden con el flag
encendido sigue listada aunque salga de reparto (el corte nocturno la barre a `sin_gestionar` sin
apagarlo). La puerta humana del 2026-08-19 asignó la fuga de `ayuda` a las fichas **235/236**, que
retiran el booleano y lo sustituyen por un estatus propio; P3 dice además que tocar `/novedades`
aquí garantiza conflicto de archivos con 236 y 240. **No lo toqué**, y lo dejé escrito en el código
junto a la rama. Si se prefiere cerrarlo aquí, el arreglo mínimo es **una clave**:
`{ ayuda: true, estatus: { value: "en_reparto" } }`. Es tu decisión, no mía.

## Salida real (T3)

### `pnpm run typecheck`

```
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit
```

exit=0

### `pnpm run lint`

```
✖ 89 problems (0 errors, 89 warnings)
```

exit=0 — los mismos 89 warnings preexistentes (`no-unused-vars` de dobles de test), ninguno en
archivos de esta feature.

### `pnpm test` (suite completa)

```
 Test Files  1185 passed (1185)
      Tests  15251 passed | 26 skipped (15277)
```

exit=0

### `pnpm run test:guardias`

```
 Test Files  117 passed (117)
      Tests  1703 passed (1703)
```

### Suites de dinero + los dos criterios de intento

```
 Test Files  8 passed (8)
      Tests  116 passed (116)
```

`cierres-admin-caja-cod.test.ts` (que mide el orden de las llamadas), las cinco idempotencias,
`intentos-entrega-criterio-unico.test.ts` y `criterio-intento-entrega.test.ts`: verdes.

### Migración contra la base local (`localhost:5432`)

```
# tras `prisma migrate deploy`
orden.gestion_aprobada: AUSENTE
columnas de orden: 35

# tras `pnpm run db:rollback`
orden.gestion_aprobada: {"column_name":"gestion_aprobada","column_default":"false","is_nullable":"NO"}
columnas de orden: 36

# tras re-aplicar, y una tercera pasada
orden.gestion_aprobada: AUSENTE
columnas de orden: 35
No pending migrations to apply.
```

El down repone la columna **exactamente** como el código anterior la leía: `NOT NULL DEFAULT
false`.

## La mutación del reloj (obligatoria)

`lib/repositories/DevolucionSlaRepository.ts` · sha256 **antes**:
`c7d2f6802e533720a451edfae96ed52c31c5d80cdc1ecac0adfeedb2c8daf33c`

Mutación aplicada — el ancla vuelve al `created_at` de la gestión, que es como estaba antes de la
239:

```ts
- ancladaAt: anclaje ? anclaje.createdAt : g.createdAt,
+ ancladaAt: g.createdAt,
```

sha256 mutado: `3a9e8a6a853c8a141d59940434f6fc6394847ab91c2646b355a366fa2e56a2e6`

**ROJO — 5 casos en 3 archivos** (salida real):

```
× 239/R12: el ancla es el instante del ANCLAJE, no el `created_at` de la gestion
    AssertionError: expected 2026-07-15T06:00:00.000Z to deeply equal 2026-07-16T14:00:00.000Z
× 239/R15: tras la vuelta completa gana el anclaje MAS RECIENTE
    AssertionError: expected 2026-07-15T06:00:00.000Z to deeply equal 2026-07-20T09:00:00.000Z
× R5: filtra por estatus devuelta + no borrada; deriva causa y mensajero de la gestion vigente
× 239/R12: el cron ancla en la APROBACION del cierre, no en la gestion del mensajero
    (resolver-novedad-recupera-sla.test.ts)
× 239/R12: el cron ancla en la APROBACION del cierre, no en la gestion del mensajero
    (resolver-novedad-reprograma-sla.test.ts)

 Test Files  3 failed | 1 passed (4)
      Tests  5 failed | 51 passed (56)
```

Restaurado · sha256 **después**:
`c7d2f6802e533720a451edfae96ed52c31c5d80cdc1ecac0adfeedb2c8daf33c` (idéntico al de antes).

```
 Test Files  4 passed (4)
      Tests  56 passed (56)
```

**Un detalle del reparto que conviene leer:** `devolucion-sla-service.test.ts` **sobrevive** a esta
mutación, y está bien que así sea — su repositorio es un doble, así que el ancla le llega ya
calculada: ese archivo mide la **aritmética de la ventana**, no de dónde sale el instante. Quien
tiene que cazar la mutación es el archivo del **repositorio**, que es donde vive la derivación, y
la caza. Es el mismo principio que «probar el `WHERE` donde vive».

## Mapa `R<n> → test` (T3)

| Req | Test |
| --- | --- |
| R12 | `devolucion-sla-repository.test.ts` — «el ancla es el instante del ANCLAJE, no el `created_at` de la gestion» (**mutación medida**) · `devolucion-sla-service.test.ts` — «con el ancla en la aprobacion (10 h) la ventana de 24 h AUN vive» + su contrafactual |
| R13 | `devolucion-sla-repository.test.ts` — «una orden en `devolucion_por_confirmar` NO es candidata del cron» |
| R14 | ídem — «sin fila de anclaje, ancla en la gestion Y sale MARCADA como legada» · `devolucion-sla-service.test.ts` — «una candidata legada sale contada en `legadas`» + «una anclada por aprobacion NO cuenta como legada» |
| R15 | `devolucion-sla-repository.test.ts` — «tras la vuelta completa gana el anclaje MAS RECIENTE» · `devolucion-sla-service.test.ts` — el mismo enunciado desde el servicio |
| R18 | `orden-repository.novedades.test.ts` — «una orden en `devuelta` se lista, sin ninguna condicion adicional» |
| R19 | ídem — «una orden en el PRE-ESTADO no casa el predicado» |
| R20 | `tests/unit/guards/gestion-aprobada-retirada.guardia.test.ts` (censo + 4 casos de autocomprobación) · `orden-repository.novedades.test.ts` — «el predicado no menciona ninguna marca persistida» |
| R21 | `orden-repository.novedades.test.ts` — «`count` y `find` comparten EXACTAMENTE el mismo where» |
| R22 | **ABIERTO por decisión firmada** (P10 → fichas 235/236). La rama y su deuda quedan documentadas en `novedadWhere` |
| R23 | `orden-repository.novedades.test.ts` — «`habilitarNovedad` apaga SOLO `ayuda`» · `habilitar-novedad-service.test.ts` (+2) |
| R30 | `orden-repository.novedades.test.ts` — «una `devuelta` ANTERIOR al despliegue casa el predicado» |
| R31 | `gestion-aprobada-retirada.guardia.test.ts` — ni el up ni el down mueven órdenes (sobre SQL sin comentarios) |
| R32 | ídem — la migración existe y su down repone la columna con `DEFAULT false` · verificado contra la base local |
| R35 | `devolucion-sla-service.test.ts` — «el aviso de la rama legada es un CONTEO agregado, sin ids ni guias ni tiendas» |

## Decisiones y deudas que dejo abiertas (T3)

1. **R22 sin implementar, por la puerta humana del 2026-08-19.** Detalle y arreglo mínimo, arriba.
2. **`app/(app)/novedades/_components/NovedadesModule.tsx:195`** tiene un comentario que sigue
   diciendo que la orden pierde «`ayuda` y `gestion_aprobada`». Es prosa caducada de UI y **no lo
   toqué** (mi alcance excluye componentes). Es una línea; se la dejo al frontend o dímelo y la
   cambio.
3. **T4.1 quedó hecha solo en los dos emuladores que T3 rompía.** Sus semillas ahora incluyen la
   fila de anclaje —que es lo que hoy pone una orden en `devuelta`— y cada uno gana una aserción
   que la hace *load-bearing*: sin ella la semilla nueva pasaría verde aunque nadie la leyera. El
   tercero (`resolver-novedad-reprograma-dinero.test.ts`) no usa el cron y no necesitó cambios.
   **Falta T4.4** (la guardia de no-fusión `anclaje-vs-intentos.guardia.test.ts`) y T4.2/T4.3.
4. **`legadas` no es disjunto** con los otros cuatro conteos del cron: es un corte transversal.
   Está escrito en el contrato para que nadie lo sume como quinto cubo.

---

# T4 y T5 — el cierre

## R22 — la fuga de `ayuda`, tapada AQUÍ (decisión humana del 2026-08-19)

La puerta humana original la mandaba a las fichas 235/236. Se **reabrió y se cerró aquí**, y el
motivo es de despliegue: si la 239 sale a producción antes que ellas, **la fuga sale con ella** y
habría que limpiar filas a mano.

**El agujero** (auditoría §2.1): la rama `{ ayuda: true }` de `novedadWhere` no acotaba estatus.
Una orden con el flag encendido se quedaba en `/novedades` **para siempre** —el corte nocturno la
barre a `sin_gestionar` sin apagarlo y nadie más lo apaga—, hasta que alguien pulsara «Habilitar»
en cada una a mano.

**El arreglo**, una clave: `{ ayuda: true, estatus: { value: ESTATUS_EN_REPARTO } }`. La solicitud
de ayuda solo sostiene la fila mientras la orden sigue en reparto, que es el único estado en el que
esa solicitud significa algo. Es R22 literal.

**Queda escrito en el código que es un tapón con dueño y con fecha de caducidad:** la ficha 235
retira el booleano `ayuda` y lo sustituye por un estatus propio; cuando entre, esta rama entera
sobra. El comentario lo dice, con el porqué del despliegue.

**Nota de coherencia que dejé escrita:** la ventana de ESCRITURA del hilo
(`estaEnVentanaDeEscritura`) sigue abriéndose para el `adminTienda` con `ayuda` en cualquier
estatus, y es deliberado — deja cerrar la conversación y pulsar «Habilitar» sobre una orden que ya
cayó del listado, que es justo como se apaga el flag. **Escribir no hace visible nada.** Si hubiera
estrechado también la ventana, esas órdenes se quedarían con el flag encendido para siempre.

### La guardia del hilo se puso roja, y era su trabajo

`hilo-ventana-alcanzable.guardia.test.ts` estaba escrita para **ponerse roja el día que alguien
añadiera otra rama con estatus** a `novedadWhere`. Eso es exactamente lo que pasó. Fui a decidir
qué significa para la ventana, y la respuesta **refuerza R38**: el estatus que aporta la rama de
ayuda es `en_reparto`, que es **justo la ventana del mensajero**. Ahora las dos ramas de la
pantalla de la tienda cruzan con una ventana real —la suya por `devuelta`, la del mensajero por
`en_reparto`— y por esa segunda rama **los dos roles miran la misma orden a la vez**, que es
literalmente lo que un hilo bidireccional necesita para servir de algo. Los tres casos de la
guardia quedan actualizados con ese razonamiento.

### Prosa caducada de UI, corregida

`app/(app)/novedades/_components/NovedadesModule.tsx` decía que la orden pierde «`ayuda` y
`gestion_aprobada`». Era una mentira sobre una columna que ya no existe. Corregida, con nota de por
qué se retiró.

## T4.4 — la guardia de no-fusión (`anclaje-vs-intentos.guardia.test.ts`)

La más importante de las que quedaban. Vigila R16 en **cuatro frentes**:

1. **Sin acoplamiento directo:** el módulo del anclaje no importa del módulo del conteo, ni al
   revés, ni menciona sus símbolos (`whereIntentosVigentes`, `RESULTADOS_QUE_CUENTAN_COMO_INTENTO`,
   `ORIGEN_TIPOS_VISITA_REAL`, `contarIntentosVigentes` · `anclaje_devolucion`, `ORIGEN_ANCLAJE`,
   `origenAncla`).
2. **Punto único:** `whereIntentosVigentes` se declara una sola vez y en su módulo; la **lectura**
   por la familia del anclaje vive en un solo módulo.
3. **Sin helper compartido:** censa `esCierreAprobado` / `cierreAprobadoWhere` /
   `whereCierreAprobado` en todo `lib/` + `app/`. Comparten una palabra y nada más.
4. **Las dos listas de inclusión siguen separadas:** `anclaje_devolucion` no está en
   `ORIGEN_TIPOS_VISITA_REAL`.

**Un detalle que costó una iteración y merece leerse:** el primer detector del punto 2 marcaba
`CierresAdminRepository` como segundo lector, y era un falso positivo — ese módulo **escribe** la
familia (la aprobación), no la lee. Escribir y leer son cosas distintas: hay **un** productor y
**un** consumidor, que es justo lo correcto. El detector se afinó a `where: { … origenTipo … }` y
tiene su propio caso que prueba que distingue las dos formas, contra los dos ficheros reales.

Corre sobre fuente **sin comentarios**: los dos módulos se citan mutuamente en prosa a propósito, y
esa cita es lo que impide que alguien los una mañana por no saberlo.

## T4.1 / T4.2 / T4.3

- **T4.1** — los dos emuladores que el cambio del reloj rompía (`resolver-novedad-recupera-sla`,
  `resolver-novedad-reprograma-sla`) tienen ahora la semilla que hoy corresponde: la orden está en
  `devuelta` **con su fila de anclaje**, que es lo único que puede ponerla ahí. Cada uno gana una
  aserción que hace la semilla *load-bearing* («el cron ancla en la APROBACIÓN, no en la gestión»):
  sin ella, la fila nueva pasaría verde aunque no la leyera nadie. Y las dos **caen con la mutación
  del reloj**, medido abajo. El tercero (`resolver-novedad-reprograma-dinero`) no usa el cron.
- **T4.2 — E2E: DECLARADO INAPLICABLE, con la razón y el reemplazo.** Todas las specs de `e2e/`
  están **escritas y NO EJECUTADAS**: no hay harness ni base sembrada y `pnpm test` no las incluye
  (lo dice su propia `EXECUTION NOTE`). Así que **no puedo afirmar «el test falla si se salta la
  aprobación»: no corre**. Lo que sí hice es dejar `reintentos-escalado.spec.ts` de acuerdo con el
  comportamiento real —cada intento deja ahora **dos** filas en la línea de tiempo, la gestión
  («Devolución por confirmar») y la aprobación («Devuelta»)— porque una spec que miente es peor que
  una que no corre. La cobertura **ejecutable** de esa propiedad está nombrada en el propio archivo:
  `mis-asignaciones-service.test.ts`, `cierres-admin-anclaje-devolucion.test.ts` y
  `devolucion-sla-repository.test.ts`.
- **T4.3 — barrido: CERO cobertura perdida.** No se borró ningún archivo ni componente (`git status`
  no tiene una sola `D`). Y el censo de casos por fichero contra `origin/dev` da igual o **más** en
  todos los tocados:

  | archivo | dev | ahora |
  | --- | --- | --- |
  | `OrdenesExcludePorRol.test.ts` | 3 | 5 |
  | `resolver-novedad-recupera-sla.test.ts` | 4 | 5 |
  | `resolver-novedad-reprograma-sla.test.ts` | 5 | 6 |
  | `order-status-transiciones.guardia.test.ts` | 44 | 50 |
  | `devolucion-sla-repository.test.ts` | 7 | 12 |
  | `orden-repository.novedades.test.ts` | 16 | 24 |
  | `orden-repository.test.ts` | 30 | 33 |
  | `cierres-admin-service.test.ts` | 60 | 64 |
  | `devolucion-sla-service.test.ts` | 24 | 30 |
  | `habilitar-novedad-service.test.ts` | 4 | 6 |
  | `buckets-estatus.test.ts` | 11 | 12 |

  Los ficheros que no aparecen tienen el conteo **intacto**: sus casos se invirtieron *en el sitio*
  (mismo caso, verdad nueva), no se retiraron. En particular el caso de `gestion_aprobada` de
  `wallet-idempotencia.test.ts`, que pasó a medir el anclaje conservando su enunciado R6.

## Las mutaciones de esta tanda

### 1 · La fusión de los dos criterios (T4.4) — la que pediste ver fallar

`lib/repositories/DevolucionSlaRepository.ts` · sha256 **antes**:
`c7d2f6802e533720a451edfae96ed52c31c5d80cdc1ecac0adfeedb2c8daf33c`

Mutación: el anclaje **reutiliza `whereIntentosVigentes`**, con import real y uso real.

```ts
+ import { whereIntentosVigentes } from "@/lib/repositories/OrdenHistorialRepository";
+ const _fusion = whereIntentosVigentes(rows[0]?.id ?? ""); // MUTACION T4.4
```

sha256 mutado: `380de47888a45dac1e2cd77a9d5450ec92c0d6b434fb264836cdeba82db87009`

**ROJA** (salida real):

```
× el modulo del anclaje NO importa nada del modulo del conteo
    AssertionError: el repositorio del cron SLA importa del repositorio del historial: si lo que
    trae es el predicado de intentos, las dos derivaciones acaban compartiendo definicion (R16).
    expected true to be false
× el modulo del anclaje NO menciona ningun simbolo del criterio de intentos
    AssertionError: expected [ 'whereIntentosVigentes' ] to deeply equal []
 Test Files  1 failed (1)
      Tests  2 failed | 14 passed (16)
```

Restaurado · sha256 **después**: `c7d2f680…f33c` (idéntico). `16 passed`.

### 2 · El tapón de `ayuda` (R22)

`lib/repositories/OrdenRepository.ts` · sha256 **antes**:
`b9ff3f12c08c159455faccddfd9470bf401914add31bf19aa3a1b2afa4c642d7`

Mutación: se le quita el `estatus` a la rama de ayuda — vuelve a `{ ayuda: true }` a secas, como
estaba antes del 2026-08-19. sha256 mutado:
`2dca836ba19a9bfbb1531a6645c3bdeb9e401b9ff5648d233bcf1b7b1a488b96`

**ROJO — 8 casos en 2 archivos**, entre ellos los dos escritos para vigilarlo:

```
× R22: la rama de ayuda EXIGE `en_reparto` — una solicitud vieja no sostiene la fila
× R22: ninguna rama lista una orden con ayuda si NO esta en reparto (ni `sin_gestionar`, ni bodega, ni entregada)
× la rama de AYUDA de `novedadWhere` existe y está ACOTADA a reparto (R22)
 Tests  8 failed
```

Restaurado · sha256 **después**: `b9ff3f12…42d7` (idéntico). Verde.

### 3 · El predicado de novedades (T5.3)

Mismo fichero, sha256 antes/después **`b9ff3f12…42d7`**; mutado a
`49c2dbf70120d2bf5ac8a56da511e5c9e9b340f31e55a88a9a505a10d2c0086c` cambiando la igualdad de estado
por el pre-estado.

**ROJO — 12 casos en 2 archivos**, incluidos los cuatro que importan:

```
× R18: una orden en `devuelta` se lista, sin ninguna condicion adicional
× R19: una orden en el PRE-ESTADO no casa el predicado (no hay rama que la admita)
× R30: una `devuelta` ANTERIOR al despliegue casa el predicado (nada que backfillear)
× R8: ambos metodos construyen exactamente el mismo predicado anclado al estado
 Tests  12 failed
```

Restaurado con hash idéntico. Verde.

## Salida real (cierre)

### `pnpm run typecheck`

```
> ordenex@0.1.0 typecheck R:\job\singularis\projects\ordenex
> tsc --noEmit
```

exit=0

### `pnpm run lint`

```
✖ 89 problems (0 errors, 89 warnings)
```

exit=0 — los mismos 89 preexistentes.

### `pnpm test` (suite completa)

```
 Test Files  1186 passed (1186)
      Tests  15269 passed | 26 skipped (15295)
```

exit=0

### `pnpm run test:guardias` (T5.5)

```
 Test Files  118 passed (118)
      Tests  1719 passed (1719)
```

Incluye las **tres guardias nuevas** de esta feature
(`aprobacion-escrituras-cubiertas`, `gestion-aprobada-retirada`, `anclaje-vs-intentos`), las dos
del criterio de intento **verdes sin tocarse**, money-safe, `dinero-sin-centimos`,
`hilo-ventana-alcanzable` y la frontera de `orden_nota`.

### Suites de dinero + los dos criterios de intento

```
 Test Files  8 passed (8)
      Tests  116 passed (116)
```

## Mapa `R<n> → test` (T4/T5)

| Req | Test |
| --- | --- |
| R16 | `tests/unit/guards/anclaje-vs-intentos.guardia.test.ts` — 4 frentes + 6 autocomprobaciones (**mutación de fusión medida**) |
| R17 | `intentos-entrega-criterio-unico.test.ts` **verde sin tocarse** · `criterio-intento-entrega.test.ts` (un caso invertido por cambio de destino, no por fusión — verificado por el coordinador) |
| R22 | `orden-repository.novedades.test.ts` — «la rama de ayuda EXIGE `en_reparto`» y «ninguna rama lista una orden con ayuda si NO esta en reparto» (**mutación medida**) |
| R31 | `git status` sin una sola `D`; `gestion-aprobada-retirada.guardia.test.ts` sobre el SQL de las migraciones |
| R32 | `anclaje-devolucion-migration.test.ts` + `gestion-aprobada-retirada.guardia.test.ts` + round-trip real contra la base local |

## Lo que queda, y de quién es

- **T0.1** (re-medir producción) y **T0.3** (aviso a integradores) — **del coordinador**. No las
  toqué ni las marqué.
- **T5.4** (consulta de población atascada §12 ejecutada contra producción) — necesita el MCP de
  producción; va con T0.1.
- **T5.6** (ver la app) — la corre el coordinador después del gate.
- **T6** (cierre documental: 99 §1.1/§3.5, 215 §7bis, auditoría §1, `feature_list.json`).
