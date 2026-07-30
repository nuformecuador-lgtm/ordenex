# Feature 135 — analítica: catálogo de KPIs + rangos temporales · requirements

> Zona: backend · Complexity: medium · depends_on: null · **Feature FUNDACIONAL** del lote de
> analítica (135 + 122–134). Sin DB, sin UI, sin Server Actions: solo tipos, datos y validación
> puros en `lib/analytics/`.

## Alcance en una frase

Declarar, en un único módulo puro, **(a)** el catálogo de KPIs de analítica (una fila por
métrica: id, etiqueta, dominio, clase, unidad, granos, fuente y alcance por rol), **(b)** la
resolución de los rangos temporales día/semana/mes en hora de Costa Rica y **(c)** el esquema
zod de los filtros que toda la analítica acepta — de modo que ninguna de las 13 features que
la consumen pueda definir un KPI, una ventana temporal o un filtro por su cuenta.

## No-alcance (explícito)

- Ninguna migración, tabla, índice ni política RLS. `analytics_daily` la crea la **123**.
- Ningún repositorio, servicio, Server Action, route handler ni componente.
- Ningún cálculo de una métrica: aquí se **declara** qué es cada KPI, no se computa (126/127).
- Ninguna resolución de permisos: el resolutor de alcance por rol es la **122**; aquí solo se
  **declara** el alcance por métrica.

---

## Hechos de inventario verificados (leídos en el código, no supuestos)

1. **`order_status` es una TABLA catálogo y el seed vigente tiene 19 `value`, no 20.**
   `ORDER_STATUS_SEED` (`lib/types/order-status.ts:54-74`) lista 19 valores y
   `tests/unit/types/order-status.test.ts:72` lo fija en 19. La feature 154 apendió
   `por_recolectar_en_tienda` e `incidente` (18 → 20) y la **155 RETIRÓ `en_fulfillment`**
   (20 → 19) con la migración `20260729140000_order_status_retiro_en_fulfillment`, que
   reasigna las órdenes vivas a `en_preparacion` y **solo borra la fila del catálogo si nadie
   la referencia** — o sea, en una base con historial la fila `en_fulfillment` **sobrevive
   huérfana e inalcanzable desde el código**. Consecuencia dura para este spec: un KPI de
   embudo que enumere estados debe citar los **19 del seed** y NO `en_fulfillment`, aunque la
   fila exista en la DB.
   Los 19: `entregada`, `devuelta`, `devolviendo_a_tienda`, `reprogramada`,
   `en_ruta_bodega_central`, `en_bodega_central`, `en_preparacion`, `por_recoger`,
   `en_ruta_bodega_satelite`, `en_reparto`, `rechazada`, `en_bodega_satelite`,
   `devuelta_a_tienda`, `sin_gestionar`, `por_devolver`, `devolviendo_a_bodega_central`,
   `por_devolver_a_tienda`, `por_recolectar_en_tienda`, `incidente`.
2. **Estados de creación y terminales ya están declarados** en
   `lib/types/order-status-transiciones.ts`: `ESTADOS_CREACION = [en_preparacion,
   por_recolectar_en_tienda]` (:261), `ESTADOS_TERMINALES = [entregada, devuelta_a_tienda,
   incidente]` (:282), `ESTADOS_VESTIGIALES = []` (:293). Un embudo debe apoyarse en estos
   conjuntos, no en una lista paralela.
3. **El corte diario NO calcula una ventana de fechas.** `CorteDiarioService.ejecutarCorte()`
   (`lib/services/CorteDiarioService.ts:51-125`) no usa fecha alguna: opera sobre "mensajeros
   con actividad **sin cierre**". El route del cron (`app/api/cron/corte-diario/route.ts`)
   tampoco. Es decir, **"la lógica de fecha del corte diario" que menciona la ficha no
   existe como tal**; la lógica de día en hora de Costa Rica del repo vive en
   `lib/utils/fecha-cr.ts` (UTC-6 fijo, sin horario de verano).
4. **`lib/utils/fecha-cr.ts` es reutilizable tal cual, sin extracción**, y ya distingue las dos
   convenciones (la distinción está documentada en el propio archivo, :70-95):
   - `startOfDayCR(now)` → medianoche **UTC** de la fecha calendario CR (convención `@db.Date`,
     feature 46). **No sirve** para comparar contra columnas `timestamp`.
   - `inicioDelDiaCREnUtc(fecha)` → `${fecha}T06:00:00.000Z`, el instante real de las 00:00 CR
     (feature 144). `inicioDelDiaSiguienteCREnUtc(fecha)` → cota superior EXCLUSIVA.
   - `fechaCalendarioCR(now)` → `YYYY-MM-DD` de CR; `periodoMensualCR(now)` → `YYYY-MM`.
5. **Existe una divergencia viva entre esos dos usos.** `RankingService` compara
   `gestion_orden.created_at` / `orden.asignado_at` (columnas `timestamp`) contra
   `startOfDayCR(now)` + 24 h (`lib/services/RankingService.ts:60-61`), o sea una ventana
   `[00:00Z, 24:00Z)` = **18:00–18:00 hora CR**, no el día natural de Costa Rica. Los filtros
   de `/ordenes` (feature 144) sí usan `inicioDelDiaCREnUtc`. Analítica no puede adoptar las
   dos: ver **Q6**.
6. **Roles reales**: `enum RolValue` (`db/schema.prisma:35-44`) = `maestro`, `admin`,
   `mensajero`, `adminTienda` (`@map("Admin Tienda")`), `adminSatelite`, `apiKey`. La sesión se
   resuelve en `lib/auth/resolve-actor.ts:15-34` y devuelve `{ usuarioId, rol, zonaId }`;
   `esAccesoTotal(rol)` (`lib/auth/acceso-total.ts`) trata `maestro` y `admin` como
   equivalentes. **`apiKey` es una cuenta de integración, no un lector de analítica.**
7. **Dimensiones reales de una orden** (`db/schema.prisma:458-523`): `zona_id`, `tienda_id`,
   `provincia_id`, `canton_id` son **NOT NULL**; `distrito_id` y `mensajero_asignado_id` son
   nullable. La "tienda" es un `Usuario` con rol `adminTienda` (FK `orden.tienda_id → usuario`).
   `orden.zona_id` es el valor **congelado** de la orden (no se deriva del distrito en lectura).
   Por lo tanto **"órdenes sin zona/tienda" no puede ocurrir**; lo que sí ocurre es
   **órdenes sin mensajero asignado** (ver Q5).
8. **Fuentes de dinero (append-only)**: `wallet_movimiento` (:926), `wallet_tienda_movimiento`
   (:988), `pago_mensajero_movimiento` (:1050), con sus enums de categoría (:885, :962, :1028);
   y los **snapshots de cierre** `cierre_dia` (:718) y `cierre_bodega` (:761) con
   `total_efectivo` / `total_simpe` / `total_transferencia` / `total_general` /
   `total_pago_mensajero` / `total_ingreso_bodega_rechazos`. Métodos de pago:
   `enum MetodoPagoValue = efectivo | SINPE | transferencia` (:554, ojo `SINPE` en mayúsculas).
9. **Motivos y resultados de gestión**: `enum GestionResultado = entregada | reprogramada |
   devuelta | rechazada | incidente` (:563), `GestionCausaDevolucion` (5 valores en inglés,
   :597), `GestionCausaIncidente = danado | perdido | robado` (:583). Una gestión **anulada**
   (`gestion_orden.anulada_at IS NOT NULL`, :643) NO cuenta.
10. **Intento de entrega (feature 160)**: es **derivado, sin columna materializada**. El
    criterio único vive en `OrdenHistorialService.contarIntentos` /
    `lib/interfaces/repositories/IOrdenHistorialRepository.CriterioIntento`
    (`lib/services/OrdenHistorialService.ts:14-18, 64-74`): transiciones **vigentes** del
    historial con destino `devuelta` (rama A), o destino `reprogramada` con familia de origen
    `gestion` (rama B), **excluyendo** las causadas por gestiones anuladas. El índice de soporte
    es `orden_historial_estado(orden_id, estatus_destino_id)` (`db/schema.prisma:1200`).
11. **Patrón de filtros zod del repo**: `ordenFilterSchema` (`lib/types/orden.ts:98-134`) es
    `.strict()`, sus filtros de catálogo son **listas no vacías de ids no vacíos** (nunca
    escalares), las fechas viajan como `YYYY-MM-DD` (nunca instantes ni offsets: los bordes se
    calculan server-side) y los conflictos se cierran con `.refine`. El error tipado del borde
    es `ActionError.validation_error` con `fieldErrors` (`lib/types/orden.ts:204-209`).
12. **No existe hoy `lib/analytics/`** ni ningún uso de `cacheTag`/`revalidateTag` en el repo
    (censo en `lib/` y `app/`: 0 coincidencias). La 128 estrenará ese patrón.

---

## Requisitos (EARS)

### Módulo y pureza

- **R1 (Ubicuo — módulo puro).** El sistema DEBE ubicar todo el contrato en `lib/analytics/` y
  ese módulo DEBE ser importable y ejecutable **sin base de datos, sin red, sin cookies, sin
  variables de entorno y sin cliente Prisma en runtime**: no DEBE contener `'use server'`, ni
  importar `next/headers`, `@/lib/db/*`, repositorios, servicios ni componentes, ni ejecutar
  efectos al importarse (solo declaraciones y funciones puras).

- **R2 (Ubicuo — fuente única).** El sistema DEBE declarar el catálogo de KPIs **una sola vez**,
  en `lib/analytics/metrics.ts`, como estructura congelada (`as const` / `readonly`), y NO DEBE
  existir ninguna otra declaración de métricas de analítica en el repositorio: un censo
  automatizado sobre `app/`, `lib/`, `components/` y `scripts/` DEBE quedar en cero fuera de
  ese archivo y de sus tests.

- **R3 (Ubicuo — forma completa de una métrica).** El sistema DEBE exigir, por tipos, que cada
  entrada del catálogo declare **todos** estos campos y ninguno más: `id`, `etiqueta`,
  `descripcion`, `dominio`, `clase`, `unidad`, `granos`, `fuente`, `alcance` y `definicion`
  (los estados/categorías/columnas del catálogo del repo que la determinan). Una entrada a la
  que le falte un campo NO DEBE compilar.

- **R4 (Ubicuo — identidad estable).** El sistema DEBE garantizar que los `id` de métrica sean
  únicos, en `snake_case`, no vacíos, y DEBE exponer una búsqueda total por id que devuelva la
  métrica o `undefined` para un id desconocido, **sin lanzar** y sin `any`.

### Invariantes del catálogo

- **R5 (Ubicuo — dominio y clase).** El sistema DEBE restringir `dominio` a
  `operativa | financiera` y `clase` a `live | snapshot`, y DEBE cumplir la equivalencia:
  una métrica es `snapshot` **si y solo si** su `fuente` es el rollup `analytics_daily`.

- **R6 (Ubicuo — frontera del dinero).** MIENTRAS una métrica tenga `dominio: "financiera"`, su
  `fuente` DEBE ser exclusivamente uno o varios de: los ledgers append-only
  (`wallet_movimiento`, `wallet_tienda_movimiento`, `pago_mensajero_movimiento`) o los
  snapshots de cierre (`cierre_dia`, `cierre_bodega`). NO DEBE citar `orden`, `gestion_orden`,
  `orden_historial_estado` ni `analytics_daily`.

- **R7 (Ubicuo — alcance por rol declarado y exhaustivo).** El sistema DEBE exigir que cada
  métrica declare su alcance para los **cinco** roles lectores reales (`maestro`, `admin`,
  `adminSatelite`, `adminTienda`, `mensajero`) con un valor de un dominio cerrado
  (`total | acotado | prohibido`); NO DEBE declarar alcance para `apiKey`; y toda métrica DEBE
  declarar `total` para `maestro` y para `admin`. Omitir un rol NO DEBE compilar.

- **R8 (Ubicuo — estados citados existentes).** El sistema DEBE garantizar que todo `value` de
  `order_status` citado en la `definicion` de cualquier métrica pertenezca a
  `ORDER_STATUS_SEED` (19 valores); en particular NO DEBE citar `en_fulfillment` (retirado por
  la feature 155) ni ningún `value` renombrado por las features 137/153.

- **R9 (Ubicuo — vocabularios citados existentes).** El sistema DEBE garantizar que toda
  categoría de dominio citada en una `definicion` pertenezca al enum correspondiente del
  esquema vigente: `GestionResultado`, `GestionCausaDevolucion`, `GestionCausaIncidente`,
  `MetodoPagoValue`, `WalletMovimientoCategoria`, `WalletTiendaMovimientoCategoria` o
  `PagoMensajeroMovimientoCategoria`.

- **R10 (Ubicuo — granos declarados).** El sistema DEBE restringir `granos` a un dominio cerrado
  de dimensiones (`fecha`, `zona`, `tienda`, `mensajero`, `estatus`, `metodo_pago`,
  `causa_devolucion`) y toda métrica DEBE incluir al menos `fecha`. Una dimensión declarada
  fuera de ese dominio NO DEBE compilar.

- **R11 (Condicional — intentos de entrega no se redefine).** SI el catálogo v1 incluye una
  métrica basada en intentos de entrega, ENTONCES su `definicion` DEBE remitirse al criterio
  único ya existente (transiciones **vigentes** con destino `devuelta`, o destino
  `reprogramada` con familia de origen `gestion`, excluyendo gestiones anuladas) y NO DEBE
  introducir un criterio propio, un umbral propio ni una columna materializada.

- **R12 (Ubicuo — etiquetas de invalidación).** El sistema DEBE exportar una etiqueta de caché
  estable **por dominio** (`operativa`, `financiera`), derivable desde cualquier métrica, para
  que la 128 invalide sin inventar cadenas y sin que dos módulos escriban la misma etiqueta a
  mano.

### Rangos temporales

- **R13 (Por evento — resolución de un rango).** CUANDO se resuelva un rango a partir de un
  preset y de un instante `now`, el sistema DEBE devolver una ventana **semiabierta**
  `[desde, hasta)` de instantes UTC más las fechas calendario de Costa Rica correspondientes
  (`desdeFecha`/`hastaFecha`, `YYYY-MM-DD`, con `hastaFecha` **inclusiva** para el consumidor).

- **R14 (Ubicuo — reutiliza, no reimplementa).** El sistema DEBE calcular esos límites usando
  los helpers ya existentes de `lib/utils/fecha-cr.ts`
  (`fechaCalendarioCR`, `inicioDelDiaCREnUtc`, `inicioDelDiaSiguienteCREnUtc`) y NO DEBE
  reimplementar el desfase UTC-6, ni construir fechas con `toISOString().slice(0,10)`, ni usar
  `startOfDayCR` como cota para comparar columnas `timestamp`.

- **R15 (Por evento — rango de día).** CUANDO el preset sea `dia` y `now` sea
  `2026-07-15T02:00:00Z` (20:00 del 14 en CR), el sistema DEBE devolver
  `desde = 2026-07-14T06:00:00.000Z`, `hasta = 2026-07-15T06:00:00.000Z`,
  `desdeFecha = hastaFecha = "2026-07-14"`.

- **R16 (Ubicuo — invariantes de toda ventana).** Para **cualquier** preset, el sistema DEBE
  devolver una ventana que: (a) contenga a `now` (`desde <= now < hasta`); (b) empiece y
  termine exactamente en una frontera de día de Costa Rica (`T06:00:00.000Z`); (c) dure un
  número entero de días; (d) cumpla `desde < hasta`; y (e) sea idéntica para el mismo `now`
  en llamadas sucesivas.

- **R17 (Ubicuo — `now` inyectable).** El sistema DEBE aceptar el instante de referencia como
  parámetro con valor por defecto el instante actual, de modo que todo test pueda fijarlo sin
  falsear relojes globales.

- **R18 (Ubicuo — independiente del huso del proceso).** MIENTRAS el proceso corra con
  cualquier `TZ` (p. ej. `UTC`, `America/Costa_Rica`, `Asia/Tokyo`), el sistema DEBE devolver
  para el mismo `now` **exactamente los mismos** límites.

### Filtros (zod)

- **R19 (Ubicuo — borde cerrado).** El sistema DEBE validar los filtros de analítica con un
  esquema zod `.strict()` que **rechace** cualquier clave desconocida.

- **R20 (Ubicuo — rango obligatorio y cerrado).** El sistema DEBE exigir el campo de rango y
  restringirlo al dominio cerrado de presets aprobado; un valor fuera del dominio DEBE ser
  rechazado.

- **R21 (Ubicuo — filtros dimensionales).** El sistema DEBE aceptar `zona_id`, `tienda_id` y
  `mensajero_id` como **opcionales** y, cuando estén presentes, como **listas no vacías de ids
  no vacíos** (patrón feature 144/R32): NO DEBE aceptar el escalar ni la lista vacía (una lista
  vacía significaría "ningún valor" y degradaría silenciosamente a "sin filtro").

- **R22 (NEGATIVO — el cliente no manda instantes).** El sistema NO DEBE aceptar en el filtro
  instantes ISO con hora, offsets, husos horarios ni epochs: los bordes temporales se calculan
  server-side a partir del preset (y, si se aprueba Q4, de fechas calendario `YYYY-MM-DD`).

- **R23 (Por evento — resultado de validación tipado).** CUANDO la validación falle, el sistema
  DEBE devolver los errores **por campo** en la forma que ya consume el borde del repo
  (`fieldErrors: Record<string, string[]>`), sin lanzar excepciones no tipadas y sin filtrar
  internals.

- **R24 (NEGATIVO — el filtro no es autorización).** El esquema NO DEBE aceptar ni exponer rol,
  sesión, `usuario_id` ni ningún campo de alcance: un filtro válido NO significa acceso
  concedido. El recorte por rol lo aplica la 122 **encima** del filtro ya validado.

### Frontera de la feature y verificación

- **R25 (NEGATIVO — sin DB, sin UI, sin acciones).** El sistema NO DEBE crear ni modificar
  migraciones, tablas, índices ni políticas RLS; NO DEBE crear rutas, Server Actions,
  repositorios, servicios ni componentes; y los archivos tocados DEBEN limitarse a
  `lib/analytics/**` más sus tests en `tests/unit/**`.

- **R26 (Condicional — verificación ejecutable).** SI la feature se declara terminada, ENTONCES
  `pnpm run typecheck`, `pnpm run lint`, `pnpm test` y `./init.sh` DEBEN terminar en verde, con
  la salida real pegada en `progress/impl_135.md` junto al mapa `R<n> → test`.

---

## Trazabilidad requisito → prueba (el mapa fino lo cierra el implementer)

| R | Verificación (test unitario concreto) |
|---|---|
| R1 | `tests/unit/analytics/modulo-puro.guardia.test.ts`: importa `lib/analytics/*` con el entorno vacío (sin `DATABASE_URL`) y afirma que no lanza; censo AST/regex de `'use server'`, `next/headers`, `@/lib/db`, `@/lib/repositories`, `@/lib/services` en esos archivos = 0. |
| R2 | Mismo guard: censo de declaraciones de métricas (`dominio: "operativa"|"financiera"`) fuera de `lib/analytics/metrics.ts` = 0. |
| R3 | `tests/unit/analytics/metrics.test.ts`: toda entrada tiene las 10 claves y ninguna extra (`Object.keys` ordenado) + caso de tipos negativo con `@ts-expect-error` al omitir un campo. |
| R4 | `metrics.test.ts`: `new Set(ids).size === METRICAS.length`; cada id matchea `/^[a-z][a-z0-9_]*$/`; `getMetrica("no_existe") === undefined`. |
| R5 | `metrics.test.ts`: para cada métrica, `clase === "snapshot"` ⇔ `fuente.tipo === "rollup"`. |
| R6 | `metrics.test.ts`: para cada métrica financiera, sus tablas ⊆ {3 ledgers, 2 cierres}; y ∩ {`orden`,`gestion_orden`,`orden_historial_estado`,`analytics_daily`} = ∅. |
| R7 | `metrics.test.ts`: `Object.keys(m.alcance)` === los 5 roles exactos; sin `apiKey`; `alcance.maestro === alcance.admin === "total"`. |
| R8 | `tests/unit/analytics/definiciones-catalogo.guardia.test.ts`: todo estado citado ∈ `ORDER_STATUS_SEED`; caso explícito que falla si aparece `en_fulfillment`. |
| R9 | Mismo guard: toda categoría citada ∈ el enum correspondiente importado como **tipo/valor** desde el esquema vigente. |
| R10 | `metrics.test.ts`: `granos ⊆ DIMENSIONES` y `granos` incluye `"fecha"`; `@ts-expect-error` con una dimensión inventada. |
| R11 | `metrics.test.ts`: si existe la métrica de intentos, su `definicion.criterio === "intentos_vigentes_historial"` y no declara umbral propio; si no existe, el test se salta explícitamente con `it.skip` documentado. |
| R12 | `metrics.test.ts`: `tagDeDominio("operativa")` estable y distinto de `tagDeDominio("financiera")`; snapshot de las cadenas. |
| R13 | `tests/unit/analytics/ranges.test.ts`: forma del resultado (`desde`,`hasta`,`desdeFecha`,`hastaFecha`) y semiapertura (`hasta` NO pertenece al rango). |
| R14 | `tests/unit/analytics/ranges-reuso.guardia.test.ts`: `ranges.ts` importa de `@/lib/utils/fecha-cr`; censo de `6 * 60 * 60 * 1000`, `toISOString().slice`, `startOfDayCR` en `lib/analytics/**` = 0. |
| R15 | `ranges.test.ts`: el caso literal de R15 y su simétrico de borde `2026-07-15T05:59:59.999Z` → `"2026-07-14"`. |
| R16 | `ranges.test.ts`: tabla de casos por preset comprobando (a)–(e), incluidos cruces de mes y de año. |
| R17 | `ranges.test.ts`: llamada con `now` explícito, sin `vi.useFakeTimers()`. |
| R18 | `ranges.test.ts`: el mismo caso ejecutado con `process.env.TZ` reasignado a `UTC` / `Asia/Tokyo` da resultados idénticos. |
| R19 | `tests/unit/analytics/filters.test.ts`: `{ ...valido, foo: 1 }` → `success === false` con `unrecognized_keys`. |
| R20 | `filters.test.ts`: falta de rango → error; preset `"trimestre"` → error; cada preset aprobado → ok. |
| R21 | `filters.test.ts`: escalar `"z1"` → error; `[]` → error; `[""]` → error; `["z1","z2"]` → ok; ausencia → ok. |
| R22 | `filters.test.ts`: `"2026-07-15T10:00:00Z"`, `1752537600000` y `"2026-07-15T00:00:00-06:00"` en el campo temporal → error. |
| R23 | `filters.test.ts`: el error se mapea a `fieldErrors` con la clave del campo culpable; sin `throw`. |
| R24 | `filters.test.ts`: `{ ...valido, rol: "maestro" }` y `{ ...valido, usuario_id: "u1" }` → error por `.strict()`. |
| R25 | `tests/unit/analytics/frontera.guardia.test.ts`: `db/migrations` sin carpeta nueva; sin archivos nuevos en `app/**`, `components/**`, `lib/actions/**`, `lib/services/**`, `lib/repositories/**` (diff de la rama). |
| R26 | Salida de `./init.sh` y de la suite pegada en `progress/impl_135.md`. |

---

## Preguntas abiertas

> **Bloquean la implementación.** No las respondo yo. `tasks.md > T0` es la puerta.

1. **Q1 — ¿Cuáles son las métricas EXACTAS del catálogo v1?** `design.md §3` propone una lista
   candidata de 12 operativas + 8 financieras derivada de las descripciones de las features 126
   y 127, pero la ficha de la 135 no enumera ninguna. Necesito la lista cerrada (o el visto
   bueno a la propuesta), porque cada métrica que entre obliga a la 126/127 a implementarla y
   cada una que salga es trabajo que se descarta después.
2. **Q2 — ¿La semana empieza lunes o domingo?** No hay precedente en el repo (no existe ninguna
   métrica ni filtro semanal hoy). Cambia todos los bordes del preset `semana`.
3. **Q3 — ¿"Mes" es mes CALENDARIO o últimos 30 días?** Hay precedentes de las dos cosas:
   `periodoMensualCR` (feature 45) es calendario `YYYY-MM`; `CREATED_PRESETS` de la feature 144
   son ventanas móviles (`7d/15d/30d/90d`). Y, en la misma línea: ¿`dia`/`semana` son "el
   período en curso hasta ahora" o "el último período COMPLETO"?
4. **Q4 — ¿El filtro admite rango arbitrario además de día/semana/mes?** La ficha solo nombra
   los tres presets, pero la 134 (export CSV) y la 125 (backfill por rango de fechas) huelen a
   `desde`/`hasta` libres. Si la respuesta es sí: ¿con qué tope de ventana (p. ej. 366 días)
   para no dejar abierta una consulta que barra toda la historia? Si se aprueba, añado el R
   correspondiente antes de implementar.
5. **Q5 — ¿Qué se hace con las órdenes SIN MENSAJERO asignado?** Corrijo el enunciado de la
   consigna con el esquema en la mano: `orden.zona_id` y `orden.tienda_id` son **NOT NULL**, así
   que "órdenes sin zona/tienda" no existe; lo que sí existe es `mensajero_asignado_id NULL`
   (`db/schema.prisma:475`) y `distrito_id NULL`. ¿El grano `mensajero` (a) las agrupa en un
   cubo explícito `sin_asignar`, (b) las excluye del denominador, o (c) las excluye de toda
   métrica con grano de mensajero? Afecta al grano de `analytics_daily` (123), que necesita
   saber si `mensajero_id` es nullable en la PK del rollup.
6. **Q6 — ¿Cuál es el "día operativo" canónico?** El corte diario **no** tiene lógica de fecha
   (hecho 3), y las dos convenciones vivas del repo no coinciden: el ranking mide
   18:00–18:00 CR (`startOfDayCR`, `RankingService.ts:60-61`) y los filtros de órdenes miden
   00:00–24:00 CR (`inicioDelDiaCREnUtc`, feature 144). Mi propuesta es adoptar la **segunda**
   (día natural de Costa Rica) y abrir un ticket aparte para el ranking, pero eso hará que la
   analítica y el módulo de ranking reporten cifras distintas para "hoy" mientras el ticket no
   se resuelva. ¿Se acepta esa divergencia temporal, o la analítica debe replicar la convención
   del ranking?
7. **Q7 — ¿Qué ve cada rol del dinero?** ¿El `mensajero` ve sus propias métricas financieras
   (devengado/pagado desde `pago_mensajero_movimiento`) o solo operativas? ¿El `adminTienda` ve
   su COD recaudado y su cuenta por pagar, o solo el volumen operativo? ¿El `adminSatelite` ve
   dinero de su zona (los cierres de su bodega) o nada financiero? Sin esto no puedo llenar la
   columna `alcance` (R7) de las métricas financieras.
8. **Q8 — ¿El catálogo puede declarar métricas SIN productor todavía?** Es el patrón que ya usó
   la 154 (estados declarados y sin uso hasta la 157/158), y sería cómodo aquí. Si la respuesta
   es no, el catálogo v1 debe limitarse a lo que 126/127 van a implementar en este lote.
9. **Q9 — ¿Zona de la ORDEN o zona del MENSAJERO para atribuir?** `orden.zona_id` es el valor
   congelado al crear la orden; el `adminSatelite` tiene su propia `usuario.zona_id`
   (`resolve-actor.ts:33`). Si un mensajero de la zona A gestiona una orden de la zona B, ¿de
   qué zona es esa entrega? Afecta al grano `zona` y al alcance del `adminSatelite` (122).
10. **Q10 — ¿"Entregas" se cuenta por GESTIÓN o por ORDEN?** Una orden puede acumular varias
    gestiones (`db/schema.prisma:609-610`) y el ranking cuenta gestiones vigentes
    (`RankingRepository.ts:15-26`). Para el embudo lo natural es contar órdenes por estado
    actual; para productividad, gestiones. ¿Se declaran ambas familias en el catálogo, con `id`
    distintos y explícitos, o se elige una sola convención?
