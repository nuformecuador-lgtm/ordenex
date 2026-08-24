# Feature 274 — Tareas

Rama: `feature/274-cascada-tarifa-zona-tienda` (base `origin/dev`, 273 ya mergeada).
Convención de "hecho": **un assert que falla si el trabajo no está**. Un criterio que se
satisface reescribiendo un comentario o pasando un grep no cuenta.

## Gate — leelo antes de empezar

El diff toca `db/migrations/**`, `db/schema.prisma`, `lib/types/**` y media docena de archivos
con nombre de dinero (`tarifa`, `cierre`, `ingreso`). **`./init.sh --rapido` se niega solo** y
manda al completo (`docs/verification.md §Cuándo --rapido se niega`). El gate de esta feature,
también para abrir el PR, es **`./init.sh` COMPLETO**. No se intenta el rápido "por probar".

Baseline: medir `pnpm test` **antes** de tocar nada y anotar el conteo de archivos y de rojos en
`progress/impl_274.md`. Sin baseline propio no se puede afirmar que un rojo es ajeno.

Las cuatro preguntas abiertas del spec están **respondidas** (humano, 2026-08-24) e incorporadas
a `requirements.md` y `design.md`. No queda nada bloqueado por una respuesta pendiente.

---

## T0 — Preparación (bloqueante)

- [ ] **T0.1** Verificar que la base local tiene aplicadas las migraciones de la 273.
      *Hecho:* `prisma migrate deploy` (nunca `db:migrate`, que puede resetear) sale sin
      pendientes y `SELECT status FROM tarifas LIMIT 1` todavía existe (punto de partida).

---

## T1 — La regla, en un módulo puro `[P]` (depende de: T0.1)

- [ ] **T1.1** Crear `lib/utils/cascada-tarifa.ts` con `ParTarifa`, `clavePar`,
      `nivelDeCascada`, `elegirPorCascada`, `whereCascada` (design §2.1). Sin imports de Prisma.
- [ ] **T1.2** Tests `tests/unit/utils/cascada-tarifa.test.ts`:
      un caso por nivel (1, 2, 3), el caso «ninguno → null», el caso `(NULL, NULL)` que **no**
      es nivel, el par con `zonaId: null` que solo alcanza el nivel 2, el caso en que el nivel 2
      es **más reciente** y aun así gana el nivel 1, y el mismo conjunto de filas en orden
      invertido dando el mismo resultado.
      *Hecho:* R1–R6 tienen test verde y el módulo no importa `@prisma/client`
      (assert sobre el AST/fuente **más** el hecho de que el test corre sin cliente generado).

---

## T2 — Migración: drop de `tarifas.status` (depende de: T0.1)

- [ ] **T2.1** `pnpm run db:migrate:create` → `db/migrations/20260825120000_drop_tarifa_status/`
      con el UP de design §1.2. Escribir `down.sql` **a mano**, con el comentario que declara la
      pérdida de dato.
- [ ] **T2.2** Quitar `status` y `enum EstadoTarifa` de `db/schema.prisma`; `pnpm db:generate`.
- [ ] **T2.3** Test `tests/integration/db/drop-tarifa-status-migration.test.ts`, calcado del
      patrón de `tests/integration/db/tarifa-zona-is-default-migration.test.ts`: Postgres real,
      **esquema desechable**, aplicando el SQL **de disco** sentencia a sentencia.
      *Hecho (R9/R10):* tras el UP, insertar una tarifa **sin** `status` funciona y
      `information_schema.columns` no lista `tarifas.status` ni `pg_type` lista `estado_tarifa`;
      tras el DOWN, una fila preexistente vuelve con `status = 'activo'` y el tipo existe.
      Nada de regex sobre el SQL como única prueba.

---

## T2bis — Renombrado PURO del resolver (R17) — **commit propio, sin nada más dentro**

Se hace **antes** de T3 y en un commit aparte para que el diff del dinero se lea sin este ruido.
Regla del commit: **ni una línea de comportamiento**. Si el implementer siente la tentación de
"aprovechar y arreglar", va a T3.

- [ ] **T2bis.1** `git mv` de los dos archivos y renombrado de los dos identificadores:
      - `lib/repositories/TarifaVigentePorTiendaRepository.ts` → `TarifaVigenteRepository.ts`
        (clase `TarifaVigentePorTiendaRepository` → `TarifaVigenteRepository`).
      - `lib/interfaces/repositories/ITarifaVigentePorTiendaRepository.ts` →
        `ITarifaVigenteRepository.ts` (interfaz `ITarifaVigentePorTiendaRepository` →
        `ITarifaVigenteRepository`).
- [ ] **T2bis.2** Actualizar los **importadores**. Producción (10):
      `lib/repositories/OrdenRepository.ts`, `lib/repositories/CierreDiaRepository.ts`,
      `lib/services/BulkOrdenService.ts`, `lib/services/CotizacionOrdenService.ts`,
      `lib/utils/ingreso-ordenex.ts`, `lib/actions/cierre-dia.ts`,
      `app/api/ordenes/api-key/carga/route.ts`,
      `app/api/ordenes/api-key/cotizacion/route.ts`,
      `app/api/ordenes/carga-masiva/chunk/route.ts`, `app/api/cron/corte-diario/route.ts`.
      Tests (14): `tests/unit/repositories/tarifa-vigente-por-tienda-repository.test.ts`
      (renombrar también el archivo → `tarifa-vigente-repository.test.ts`),
      `tests/unit/repositories/cierre-dia-repository.test.ts`,
      `tests/unit/repositories/cierre-pagos-lectura.test.ts`,
      `tests/unit/repositories/gestion-desde-ayuda-cierre.test.ts`,
      `tests/unit/services/cierres-admin-service.test.ts`,
      `tests/unit/services/bulk-orden-service.test.ts`,
      `tests/unit/services/bulk-orden-service.carga-api.test.ts`,
      `tests/unit/services/bulk-orden-service.carga-lote.test.ts`,
      `tests/unit/services/cotizacion-orden-service.test.ts`,
      `tests/unit/services/rol-admin-satelite-authz.test.ts`,
      `tests/unit/utils/ingreso-ordenex.test.ts`,
      `tests/integration/db/cierre-detail-congelado.test.ts`,
      `tests/integration/db/corte-diario-segundo-cierre-sql-real.test.ts`,
      `tests/integration/cotizacion-api-key.test.ts`.
      *(Los cuatro `tests/integration/db/*` restantes que citan el nombre —`cierre-bloqueo-nv`,
      `cierre-segundo-vincula-solo-lo-suyo`, `deshacer-gestion-conserva-reserva`,
      `resolver-novedad-reprograma-dinero`— se comprueban uno a uno: si solo lo nombran en un
      comentario, se actualiza el comentario.)*
      *Hecho:* `rg "TarifaVigentePorTienda" lib app tests db` no devuelve nada.
- [ ] **T2bis.3** *Hecho (criterio duro del renombrado puro):* `git diff <base>..HEAD -- lib app`
      filtrado por las líneas que **no** contienen el identificador viejo ni el nuevo está
      **vacío**, y `pnpm test` da el **mismo** conteo de verdes/rojos que el baseline de T0
      (delta 0, pegado en `progress/impl_274.md`). Un renombrado que cambia un test no es un
      renombrado.

*A partir de aquí, en el resto de las tareas, `ITarifaVigenteRepository` /
`TarifaVigenteRepository` son los nombres vigentes.*

---

## T3 — Contrato y resolver (depende de: T1, T2.2, T2bis)

- [ ] **T3.1** Reescribir `lib/interfaces/repositories/ITarifaVigenteRepository.ts`:
      `resolveTarifa(tiendaId, zonaId)` + `resolveTarifas(pares, tx?)`. Fuera
      `resolveTarifaPorTienda`, `resolveTarifaCotizablePorTienda`, `resolveTarifasPorTiendas`.
      Actualizar el comentario de cabecera: hoy afirma que la tarifa **no** se resuelve por zona.
- [ ] **T3.2** Reescribir `lib/repositories/TarifaVigenteRepository.ts` sobre
      `whereCascada` + `elegirPorCascada`. **Borrar el bloque `TODO:` de la deuda (g)**
      y el `orderBy: { createdAt: "desc" }` de los tres métodos.
- [ ] **T3.3** Reescribir `tests/unit/repositories/tarifa-vigente-repository.test.ts`
      con el patrón vigente del repo (doble de Prisma a mano, asserts sobre `where`/`select`
      **exactos**).
      *Hecho (R7):* un test cuenta **una** llamada a `tarifa.findMany` para N pares y compara el
      `where` con el `OR` de tres ramas, literal.

### Caducidades de T3 — se retiran a propósito, no en silencio

Cada retirada va con una línea de justificación en el commit y en `progress/impl_274.md`:

1. `describe("R30 — marcador TODO: de la deuda (g)…")` y sus 4 tests estructurales sobre el
   texto del fuente: exigen que el `TODO:` siga presente y mencione `status`, `PR #64`,
   `feature 69`. **La deuda se cierra en esta feature**; un guardia que exige que la deuda siga
   documentada no puede sobrevivir a su pago.
2. Los tests que fijan la **AUSENCIA** de `zonaId` en el `where`: son el contrato textual de la
   regla vieja («por tienda, NO por zona»). Los sustituye T3.3, que exige la **presencia** de
   `zonaId` en las tres ramas.
3. Todo test que afirme el filtro `status: "activo"`. La columna deja de existir; el typecheck
   ni siquiera los dejaría compilar.
4. Los tests de «la MÁS RECIENTE»: fijan el desempate por `createdAt` que el
   `UNIQUE (zona_id, tienda_id) NULLS NOT DISTINCT` vuelve innecesario (R5). Se sustituyen por
   el test de orden invertido de T1.2.

- [ ] **T3.4** Guardia `tests/guards/tarifa-status-retirado.guard.test.ts`, con **dos dientes**:
      (a) recorre `lib/`, `app/`, `db/schema.prisma` y falla si reaparece `EstadoTarifa`,
      `estado_tarifa` o una referencia a `tarifa.status`;
      (b) recorre `lib/`, `app/` y `tests/` y falla si reaparece `TarifaVigentePorTienda`.
      *Hecho (R13, R17):* la guardia falla si se le reintroduce a mano cualquiera de las cuatro
      cadenas. *(Es branch-agnóstica: recorre el árbol, no un diff — no caduca al mergear.)*

---

## T4 — Tipos, service y actions de tarifa `[P]` (depende de: T2.2)

- [ ] **T4.1** `lib/types/tarifa.ts`: fuera `estadoTarifaSchema`, el `.extend({ status })` de
      `actualizarTarifaSchema`, `TarifaDTO.status` y el import de `EstadoTarifa`.
- [ ] **T4.2** `lib/interfaces/repositories/ITarifaRepository.ts` + `TarifaRepository.ts`:
      fuera `UpdateTarifaData.status`, la línea `out.status` y **`inactivarPorTienda`** entero
      (hueco aceptado y declarado en design §2.2: no se abre ficha).
- [ ] **T4.3** `TarifaService`: constante `TARIFA_SIN_ALCANCE` y las dos guardas de design §3.4
      (`crear` y **par efectivo** en `actualizar`); simplificar la rama `:112`.
- [ ] **T4.4** Tests:
      *Hecho (R11):* `actualizar` con `{ status: "activo" }` → `validation_error` (strict).
      *Hecho (R12):* el DTO devuelto por `crear` no tiene la clave `status`.
      *Hecho (R14):* `crear` sin tienda y sin zona → `validation_error` **y** el repo no recibe
      ninguna llamada (spy en cero).
      *Hecho (R15):* `actualizar` con `{ zonaId: null }` sobre una fila con `tiendaId: null` →
      `validation_error` y `update` no se llama.
      *Hecho (R16):* tienda sin zona → ok; zona sin tienda → ok.
      Archivos: `tests/unit/types/tarifa-schemas.test.ts`,
      `tests/unit/services/tarifa-service.test.ts`,
      `tests/integration/actions/tarifas-action.test.ts` (fake service + `getActor` inyectado),
      `tests/unit/repositories/tarifa-repository.test.ts`.

---

## T5 — Cierre de día (depende de: T3)

- [ ] **T5.1** `CierreDiaRepository.crearCierre`: `resolveTarifas(pares, tx)` indexado por
      `clavePar` (design §4.2). `SNAPSHOT_SELECT` ya trae `orden.zonaId`: no se toca.
- [ ] **T5.2** `lib/actions/cierre-dia.ts`: sólo inyección.
- [ ] **T5.3** Tests `tests/unit/repositories/cierre-dia-repository.test.ts` +
      `tests/integration/db/cierre-detail-congelado.test.ts`.
      *Hecho (R22):* el snapshot congela el `tarifa_id` de la fila **de nivel 1** cuando existe,
      aunque la de nivel 2 sea más reciente.
      *Hecho (R7 en el cierre):* el doble de Prisma cuenta **una** llamada a `tarifa.findMany`
      para un cierre con N órdenes de M pares distintos (el test que hoy fija «sin N+1» se
      actualiza a pares, **no** se borra).
      *Hecho (R23):* orden sin tarifa → las 9 columnas en NULL y el cierre **creado**; el
      `409` de las APIs no llega hasta aquí.
      *Hecho (R24):* la lista de columnas de `cierre_detail` escritas es idéntica a la de `dev`.

---

## T6 — Carga vía API: cascada + 409 (depende de: T3, T6.0)

**Cambio de contrato de una API pública.** Ver T10 (aviso a integradores).

- [ ] **T6.0** `lib/services/mensajes-tarifa.ts` con `MSG_FILA_SIN_TARIFA` y
      `MSG_CARGA_SIN_TARIFA` (design §3.5). `MSG_COTIZACION_SIN_TARIFA` **no se toca**.
      *Hecho (R38):* un test afirma que la carga y la cotización emiten en `errores.tarifa`
      **la misma constante importada** (comparación contra `MSG_FILA_SIN_TARIFA`, no contra un
      literal re-escrito en el test).
- [ ] **T6.1** `BulkOrdenService`: fuera `tarifaLote`; añadir `zonaPorRemision`, mover la
      resolución **antes** de `createManyOrdenesConGuia`, partir `toCreate` en
      `conTarifa`/`sinTarifa` y aplicar el criterio de lote de design §3.6 (§4.3).
- [ ] **T6.2** `app/api/ordenes/carga-masiva/chunk/route.ts`: sólo inyección.
- [ ] **T6.3** Tests `tests/unit/services/bulk-orden-service.carga-api.test.ts` +
      `tests/integration/carga-api-key-sin-tarifa.test.ts`.
      *Hecho (R25):* dos órdenes del mismo lote en zonas distintas con tarifas distintas
      devuelven `costoEnvio` **distinto** (hoy devuelven el mismo: es la regresión que fija el
      valor de esta feature).
      *Hecho (R26):* el mock del repo recibe **una** llamada por lote.
      *Hecho (R27/R28 — lote mixto):* dos filas, una con tarifa y otra sin ella → `200`; la
      primera `creada` con su `costoEnvio`; la segunda `resultado: "error"` con
      `errores.tarifa`; **`createManyOrdenesConGuia` recibe UNA sola fila** (assert sobre el
      argumento, no sobre el conteo del summary) y la respuesta no contiene ningún
      `costoEnvio: "0.00"`.
      *Hecho (R29 — ninguna resuelve):* `409` con `MSG_CARGA_SIN_TARIFA` y **cero** escrituras:
      `createManyOrdenesConGuia` no se llama, no se crea fila de `carga` y la notificación
      `carga_masiva_terminada` no se emite (spies en cero).
      *Hecho (R30 — nadie llegó a resolver):* lote entero con distritos inexistentes → `200`
      con todas las filas en error de geografía y **sin** `409`; el repo de tarifas no se
      consulta.
      *Hecho:* `total` del summary sigue siendo `rows.length` y `creadas + duplicadas +
      conError === total` con filas degradadas de por medio (ninguna contada dos veces).
- [ ] **T6.4** Contrato publicado (R31): `lib/api/openapi-spec.ts` (descripción de `/carga`
      `:104-108` + respuesta `409` en `:202-204`) y su espejo `docs/api/api-key-openapi.yaml`.
      *Hecho:* `tests/unit/api/openapi-carga-409-sin-tarifa.test.ts` afirma que el path de
      `/carga` declara `409`, que su ejemplo es **la constante** `MSG_CARGA_SIN_TARIFA`, y que
      la descripción ya **no** contiene la cadena `0.00`; los tests de paridad `.ts`↔`.yaml`
      que ya existen siguen verdes.

---

## T7 — Cotización por API key (depende de: T3, T6.0)

- [ ] **T7.1** `CotizacionOrdenService`: invertir el orden (geo → pares → una resolución) y
      calcular por fila con la zona del distrito (design §4.4).
- [ ] **T7.2** Aplicar el criterio de lote de design §3.6: fila sin tarifa → `resultado:
      "error"` con `errores.tarifa`; `409` sólo si **ninguna** fila que llegó a resolver
      resolvió. `status: "sin_tarifa"` se conserva con su significado estrechado y
      `app/api/ordenes/api-key/cotizacion/route.ts` **no cambia**.
      *Hecho:* un assert de que `route.ts` no aparece en el diff de esta task.
- [ ] **T7.3** Tests `tests/unit/services/cotizacion-orden-service.test.ts` +
      `tests/integration/cotizacion-api-key.test.ts`.
      *Hecho (R32):* dos filas en zonas distintas cotizan importes distintos, con **una** sola
      llamada al repo de tarifas.
      *Hecho (R33):* lote donde todas resuelven → `200`, todas `cotizada`, `conError: 0`,
      `totales.filasExcluidas: 0`.
      *Hecho (R34 — lote mixto):* una resuelve y otra no → `200`; la que no, `resultado:
      "error"` con `errores.tarifa`, **sin** clave `costos` (assert de ausencia de clave, no de
      valor cero); `conError: 1`; `totales.filasSumadas: 1`; `filasExcluidas: 1`; los importes
      de `totales` son exactamente los de la fila cotizada.
      *Hecho (R35 — ninguna resuelve):* `409` con `MSG_COTIZACION_SIN_TARIFA` y el mismo body
      que hoy (comparado contra el shape actual, no re-descrito), y **ningún** importe en la
      respuesta.
      *Hecho (R36 — nadie llegó a resolver):* lote entero sin cobertura → `200` con `totales`
      en cero y `filasSumadas: 0`; **no** `409`.
      *Hecho (R37):* el service ya no puede llamar a `resolveTarifaCotizablePorTienda` (no
      existe) y resuelve con el mismo método que el cierre.
- [ ] **T7.4** Contrato publicado (R31): reescribir en `openapi-spec.ts` el párrafo `:639-642`
      (el `409` ya no es «la tienda no tiene tarifa» y la asimetría con `/carga` que describe
      dejó de existir) y añadir al párrafo de `totales` `:627-633` el segundo motivo de
      exclusión; espejar en el `.yaml`.
      *Hecho:* un test de contrato afirma que la descripción de `/cotizacion` ya no contiene la
      cadena `costoEnvio: "0.00"`.

---

## T8 — Listado de órdenes (depende de: T3)

- [ ] **T8.1** `OrdenRepository`: quitar `tarifasTienda` del include y de `TARIFA_SELECT`;
      resolver la página con `whereCascada`/`elegirPorCascada` en **una** query adicional;
      `toListItemDTO(row, tarifa)`; aplicar lo mismo a `findListItemsByIds` (design §4.1).
- [ ] **T8.2** Ajustar `lib/types/orden.ts` (comentarios que describen «la tarifa activa de la
      tienda») y `tests/unit/components/ordenes-columns.test.tsx` / fixtures que construyen un
      `TarifaDTO` con `status`.
- [ ] **T8.3** Tests `tests/unit/repositories/orden-repository.test.ts`.
      *Hecho (R18):* dos órdenes de la misma tienda en zonas distintas muestran importes
      distintos.
      *Hecho (R19):* una página de N filas produce **2** consultas de datos (órdenes + tarifas),
      contadas en el doble de Prisma, sea N = 1 o N = 50.
      *Hecho (R20):* orden sin tarifa → `relaciones.tienda.tarifa === null` y
      `fleteConIva === "0.00"`.
- [ ] **T8.4** **Test de convergencia (R8/R21), el que justifica la feature.** Un test que, con
      el MISMO conjunto de filas de `tarifas` y la MISMA orden, obtiene la tarifa por el camino
      del listado y por el del cierre y **compara el `tarifa_id`**; el caso elegido es
      precisamente uno donde hoy divergen (una tarifa `inactivo` más reciente frente a una de
      zona). *Hecho:* falla si alguien vuelve a introducir una regla propia en el listado.
- [ ] **T8.5** **Test de la asimetría (R39), el que impide que alguien "unifique" los cuatro
      bordes.** Con el MISMO estado de `tarifas` (par sin tarifa): el listado devuelve `"0.00"`
      y `tarifa: null`; el cierre se crea con las 9 columnas en NULL; la carga por API y la
      cotización devuelven `409`. *Hecho:* las cuatro afirmaciones en un solo archivo de test,
      con un comentario de cabecera que remite a requirements §«Tres superficies, dos
      comportamientos» — para que quien lo ponga rojo lea el porqué antes de "arreglarlo".

---

## T9 — Cierre (depende de: T1–T8)

- [ ] **T9.1** Mapa `R<n> → test` completo en `progress/impl_274.md` (los **40** requisitos).
      *Hecho:* ningún `R<n>` sin fila; el reviewer rechaza si falta uno.
- [ ] **T9.2** Correr **`./init.sh` COMPLETO** y pegar la salida real en `progress/impl_274.md`,
      con el delta contra el baseline de T0. Nada de "debería pasar".
- [ ] **T9.3** Actualizar la ficha 274 en `feature_list.json` (`spec_path`, `status`) escribiendo
      en **LF** y verificando que el diff son **sólo** los campos de la 274 (otras sesiones
      escriben el mismo archivo).
- [ ] **T9.4** En el cuerpo del PR: decir que **cambian importes visibles sin cambiar datos**
      (design §6), que la carga por API **cambia de contrato** (409), que los cierres ya creados
      no se tocan, que la 275 queda desbloqueada, y **enlazar T10 como bloqueo de despliegue**.

---

## T10 — Aviso a integradores (BLOQUEA EL DESPLIEGUE a `prod`, no el código)

Misma política que 239/T0.3 y 268/T8: el aviso no bloquea T6, ni el merge a `dev`; bloquea el
paso a `prod`. Se redacta UNA sola vez y cubre las tres cosas:

1. **`POST /api/ordenes/api-key/carga` deja de crear órdenes con envío en cero.** Una fila cuyo
   par (tienda, zona) no tiene tarifa vuelve como `resultado: "error"` con
   `errores.tarifa` y **no se crea**. Hasta hoy se creaba con `costoEnvio: "0.00"`.
2. **Un lote en el que ninguna fila resuelve tarifa responde `409`** y no crea nada. Es un
   código de estado nuevo en ese endpoint: una integración que solo distingue `2xx` de `4xx`
   genéricos debe tratarlo como reintentar-después-de-configurar, no como error de datos.
3. **`POST /api/ordenes/api-key/cotizacion` deja de tumbar el lote entero por falta de tarifa:**
   ahora las filas afectadas vuelven en `error` dentro de un `200`, y el `409` queda sólo para
   el lote en que ninguna resuelve. Quien hoy trata todo `409` como «no hay tarifa para nada»
   sigue siendo correcto; quien asume que un `200` implica precio en todas las filas, no.

**Hecho cuando:** el aviso está enviado y su envío consta **con fecha** en
`progress/impl_274.md`, y la ficha 274 de `feature_list.json` lleva el `status_note` de que no
se despliega a `prod` sin ese aviso.

---

## Paralelismo

- `[P]` reales: **T1** y **T4** pueden ir en paralelo entre sí (T4 sólo necesita T2.2).
- **T5, T6, T8** pueden ir en paralelo entre sí una vez cerradas T3 y T6.0 (tocan archivos
  distintos). **T7** también, tras T6.0.
- **T10** es `[P]` con todo: no toca código.
- **T2bis** NO es paralelizable con nada: es un renombrado global y cualquier trabajo simultáneo
  se le cruza. Se hace, se commitea y se sigue.
- **T2, T2bis y T3** son la ruta crítica: todo lo demás cuelga de ellas.
