# Feature 135 — analítica: catálogo de KPIs + rangos temporales · requirements

> Zona: backend · Complexity: medium · depends_on: null · **Feature FUNDACIONAL** del lote de
> analítica (135 + 122–134). Sin DB, sin UI, sin Server Actions: solo tipos, datos y validación
> puros en `lib/analytics/`.

## Alcance en una frase

Declarar, en un único módulo puro, **(a)** el catálogo de KPIs de analítica (una fila por
métrica: id, etiqueta, dominio, clase, unidad, granos, fuente y alcance por rol), **(b)** la
resolución de los rangos temporales día/semana/mes **y del rango arbitrario** (D4) en hora de
Costa Rica y **(c)** el esquema
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
   devuelta | rechazada | incidente` (:563), `GestionCausaDevolucion` (**3** valores en inglés — corregido el 2026-07-30 contra
   `db/schema.prisma:634` y contra `origin/dev`: son `not_found`, `wrong_number`,
   `wrong_address`; este hecho decía «5» y era falso,
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

- **R3 (Ubicuo — forma completa de una métrica).** *(reescrito por D8 y D10.)* El sistema DEBE
  exigir, por tipos, que cada entrada del catálogo declare **todos** estos campos y ninguno más:
  `id`, `etiqueta`, `descripcion`, `dominio`, `clase`, `unidad`, `unidadDeConteo`,
  `estadoProduccion`, `granos`, `fuente`, `alcance` y `definicion` (los estados/categorías/
  columnas del catálogo del repo que la determinan) — **12 campos exactos**. Una entrada a la
  que le falte un campo, o que declare uno extra, NO DEBE compilar.

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

- **R7 (Ubicuo — alcance por rol declarado y exhaustivo).** *(reescrito por D7 —
  rectificación «admin y maestro pueden».)* El sistema DEBE exigir que cada métrica declare su
  alcance para los **cinco** roles lectores reales (`maestro`, `admin`, `adminSatelite`,
  `adminTienda`, `mensajero`) con un valor de un dominio cerrado (`total | acotado | prohibido`);
  NO DEBE declarar alcance para `apiKey`; y toda métrica —operativa o financiera— DEBE declarar
  `total` para `maestro` y `total` para `admin`, que son exactamente los roles que
  `esAccesoTotal(rol)` (`lib/auth/acceso-total.ts`) trata como equivalentes. Omitir un rol NO
  DEBE compilar.

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

- **R11 (Ubicuo — intentos de entrega no se redefine).** *(reescrito por D1: `primer_intento_ok`
  entra en el catálogo v1, así que el condicional deja de serlo.)* El sistema DEBE hacer que la
  `definicion` de la métrica `primer_intento_ok` —y de cualquier otra basada en intentos de
  entrega— se remita al criterio único ya existente (`criterio:
  "intentos_vigentes_historial"`: transiciones **vigentes** con destino `devuelta`, o destino
  `reprogramada` con familia de origen `gestion`, excluyendo gestiones anuladas) y NO DEBE
  introducir un criterio propio, un umbral propio ni una columna materializada.

- **R12 (Ubicuo — etiquetas de invalidación).** El sistema DEBE exportar una etiqueta de caché
  estable **por dominio** (`operativa`, `financiera`), derivable desde cualquier métrica, para
  que la 128 invalide sin inventar cadenas y sin que dos módulos escriban la misma etiqueta a
  mano.

### Rangos temporales

- **R13 (Por evento — resolución de un rango).** *(reescrito por D4: la entrada ya no es solo un
  preset.)* CUANDO se resuelva un rango —sea a partir de uno de los tres presets
  (`dia | semana | mes`) y de un instante `now`, sea a partir de un par de fechas calendario
  `desde`/`hasta`— el sistema DEBE devolver una ventana **semiabierta** `[desde, hasta)` de
  instantes UTC más las fechas calendario de Costa Rica correspondientes
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

- **R16 (Ubicuo — invariantes de toda ventana).** *(reescrito por D4: el invariante (a) solo
  puede exigirse a los presets, no al rango arbitrario, que puede ser íntegramente pasado.)*
  Para **cualquier** ventana devuelta —preset o rango arbitrario— el sistema DEBE cumplir:
  (b) empezar y terminar exactamente en una frontera de día de Costa Rica (`T06:00:00.000Z`);
  (c) durar un número entero de días; (d) cumplir `desde < hasta`; y (e) ser idéntica para la
  misma entrada en llamadas sucesivas. Además, MIENTRAS la entrada sea uno de los tres presets,
  la ventana DEBE (a) contener a `now` (`desde <= now < hasta`).

- **R17 (Ubicuo — `now` inyectable).** El sistema DEBE aceptar el instante de referencia como
  parámetro con valor por defecto el instante actual, de modo que todo test pueda fijarlo sin
  falsear relojes globales.

- **R18 (Ubicuo — independiente del huso del proceso).** MIENTRAS el proceso corra con
  cualquier `TZ` (p. ej. `UTC`, `America/Costa_Rica`, `Asia/Tokyo`), el sistema DEBE devolver
  para el mismo `now` **exactamente los mismos** límites.

### Filtros (zod)

- **R19 (Ubicuo — borde cerrado).** El sistema DEBE validar los filtros de analítica con un
  esquema zod `.strict()` que **rechace** cualquier clave desconocida.

- **R20 (Ubicuo — rango obligatorio y cerrado).** *(reescrito por D4.)* El sistema DEBE exigir el
  campo `rango` y restringirlo al dominio cerrado **`dia | semana | mes | personalizado`**; un
  valor fuera de ese dominio DEBE ser rechazado, y la ausencia del campo también.

- **R21 (Ubicuo — filtros dimensionales).** El sistema DEBE aceptar `zona_id`, `tienda_id` y
  `mensajero_id` como **opcionales** y, cuando estén presentes, como **listas no vacías de ids
  no vacíos** (patrón feature 144/R32): NO DEBE aceptar el escalar ni la lista vacía (una lista
  vacía significaría "ningún valor" y degradaría silenciosamente a "sin filtro").

- **R22 (NEGATIVO — el cliente no manda instantes).** *(reescrito por D4: Q4 se aprobó.)* El
  sistema NO DEBE aceptar en el filtro instantes ISO con hora, offsets, husos horarios ni
  epochs: los bordes temporales se calculan **server-side** a partir del preset o de las fechas
  calendario `YYYY-MM-DD` de `desde`/`hasta`, cuyo formato DEBE validarse con un patrón de ancho
  fijo `^\d{4}-\d{2}-\d{2}$`.

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

### Requisitos añadidos por las decisiones del 2026-07-30

> Se apenda a partir de R27. **Ningún id anterior se reutiliza ni se desplaza.**

- **R27 (Por evento — la semana empieza LUNES).** *(añadido por D2 + D3-supuesto.)* CUANDO el
  preset sea `semana`, el sistema DEBE devolver una ventana que empiece en el **lunes** de la
  semana calendario de Costa Rica que contiene a `now` (`desde =
  inicioDelDiaCREnUtc(lunes)`) y termine en el **inicio del día CR siguiente al de `now`**
  (período **en curso hasta ahora**, no la semana completa de 7 días): para
  `now = 2026-07-15T02:00:00Z` (**martes** 14 en CR ⇒ semana del lunes 13; decía «miércoles», corregido el 2026-07-30 — los valores exigidos no cambian), el sistema DEBE
  devolver `desdeFecha = "2026-07-13"`, `hastaFecha = "2026-07-14"`,
  `desde = 2026-07-13T06:00:00.000Z`, `hasta = 2026-07-15T06:00:00.000Z`.

- **R28 (Por evento — `mes` es ventana MÓVIL de 30 días).** *(añadido por D3.)* CUANDO el preset
  sea `mes`, el sistema DEBE devolver una ventana móvil de **exactamente 30 días calendario de
  Costa Rica** que termina en el día CR de `now` inclusive (`hastaFecha` = fecha CR de `now`;
  `desdeFecha` = esa fecha menos 29 días), y NO DEBE alinear ningún borde con el primer día del
  mes calendario: para `now = 2026-07-15T02:00:00Z` (14 de julio en CR), el sistema DEBE
  devolver `desdeFecha = "2026-06-15"`, `hastaFecha = "2026-07-14"` y una duración de
  `30 * 24 h`.

- **R29 (Por evento — rango arbitrario con tope).** *(añadido por D4.)* CUANDO el filtro declare
  `rango: "personalizado"`, el sistema DEBE exigir `desde` y `hasta` como fechas calendario
  `YYYY-MM-DD`, DEBE rechazar el rango invertido (`desde > hasta`) y DEBE rechazar toda ventana
  cuya duración supere **366 días** contando ambos extremos; y MIENTRAS el `rango` sea uno de
  los tres presets, el sistema NO DEBE aceptar `desde` ni `hasta` (conflicto cerrado con
  `.refine`, patrón `ordenFilterSchema`). Los tres casos de rechazo DEBEN salir como
  `validation_error` con `fieldErrors`, nunca como excepción.

- **R30 (Ubicuo — cubo `sin_asignar` en el grano de mensajero).** *(añadido por D5.)* MIENTRAS
  una métrica declare el grano `mensajero`, el sistema DEBE declarar que las órdenes con
  `mensajero_asignado_id IS NULL` se agrupan en un cubo explícito **`sin_asignar`** —ni se
  excluyen del numerador ni del denominador— y DEBE exponer ese literal como constante única
  (`MENSAJERO_SIN_ASIGNAR`), de modo que ninguna feature consumidora lo escriba a mano.

- **R31 (Ubicuo — día operativo canónico y divergencia declarada).** *(añadido por D6.)* El
  sistema DEBE definir el día operativo de analítica como el **día natural de Costa Rica
  00:00–24:00**, resuelto con `inicioDelDiaCREnUtc` / `inicioDelDiaSiguienteCREnUtc`
  (convención de la feature 144), y NO DEBE usar la convención 18:00–18:00 de
  `RankingService` (`startOfDayCR` + 24 h); la divergencia de cifras con el ranking mientras el
  ticket de saneamiento no se resuelva DEBE quedar escrita en el propio módulo y en
  `progress/impl_135.md`.

- **R32 (Ubicuo — frontera de rol del dominio financiera).** *(añadido por D7, rectificado.)*
  MIENTRAS una métrica tenga `dominio: "financiera"`, el sistema DEBE declarar
  `alcance.maestro === "total"` y `alcance.admin === "total"` —los dos roles que
  `esAccesoTotal(rol)` reconoce— y `alcance.adminSatelite === alcance.adminTienda ===
  alcance.mensajero === "prohibido"`; NO DEBE existir ninguna métrica financiera con alcance
  `acotado`, y `listarMetricas({ rol })` NO DEBE devolver métrica financiera alguna para
  `adminSatelite`, `adminTienda` ni `mensajero`.

- **R33 (Ubicuo — métricas declaradas sin productor).** *(añadido por D8.)* El sistema DEBE
  permitir que una métrica se declare con `estadoProduccion: "declarada"` (sin productor
  todavía, patrón de la feature 154) o `"producida"`, DEBE restringir ese campo a esos dos
  valores y DEBE exponer el subconjunto producido de forma consultable
  (`listarMetricas({ estadoProduccion })`), para que la 126/127 no interpreten una métrica
  declarada como trabajo pendiente suyo por descarte.

- **R34 (Ubicuo — atribución por la zona de la ORDEN).** *(añadido por D9.)* MIENTRAS una métrica
  declare el grano `zona`, su `definicion` DEBE atribuir por `orden.zona_id` —el valor
  **congelado** en la orden— y NO DEBE atribuir por la zona del mensajero que la gestionó
  (`usuario.zona_id`), aunque difieran.

- **R35 (Ubicuo — convención única: se cuenta por GESTIÓN).** *(añadido por D10.)* El sistema
  DEBE definir `entregas`, `devoluciones`, `rechazos`, `reprogramaciones` e `incidentes` como
  conteos de **gestiones vigentes** (`gestion_orden.anulada_at IS NULL`), NO de órdenes, y NO
  DEBE declarar una segunda familia paralela de las mismas métricas contadas por orden. En
  consecuencia, `tasa_entrega`, `tasa_devolucion` y `tasa_rechazo` DEBEN declararse como tasas
  **sobre gestiones**, con denominador `entregas + devoluciones + rechazos + incidentes`, y su
  `descripcion` DEBE decir explícitamente que ese denominador **no** equivale al número de
  órdenes (una orden reprogramada y luego entregada aporta dos gestiones).

- **R36 (Ubicuo — la unidad de conteo es evidente en la propia métrica).** *(añadido por D10.)*
  El sistema DEBE exigir en cada métrica el campo `unidadDeConteo` con dominio cerrado
  `gestion | orden | moneda | tiempo`, DEBE declarar `orden` en `ordenes_creadas` y
  `ordenes_por_estado` y `gestion` en las cinco métricas de R35, y DEBE exponer una
  comprobación reutilizable (`sonSumables(a, b)`) que devuelva `false` para dos métricas de
  `unidadDeConteo` distinta, de modo que la 126 y los tableros no puedan sumarlas entre sí por
  error.

---

## Trazabilidad requisito → prueba (el mapa fino lo cierra el implementer)

| R | Verificación (test unitario concreto) |
|---|---|
| R1 | `tests/unit/analytics/modulo-puro.guardia.test.ts`: importa `lib/analytics/*` con el entorno vacío (sin `DATABASE_URL`) y afirma que no lanza; censo AST/regex de `'use server'`, `next/headers`, `@/lib/db`, `@/lib/repositories`, `@/lib/services` en esos archivos = 0. |
| R2 | Mismo guard: censo de declaraciones de métricas (`dominio: "operativa"|"financiera"`) fuera de `lib/analytics/metrics.ts` = 0. |
| R3 | `tests/unit/analytics/metrics.test.ts`: `declara las 12 claves exactas y ninguna extra` (`Object.keys` ordenado) + caso de tipos negativo con `@ts-expect-error` al omitir `unidadDeConteo`. |
| R4 | `metrics.test.ts`: `new Set(ids).size === METRICAS.length`; cada id matchea `/^[a-z][a-z0-9_]*$/`; `getMetrica("no_existe") === undefined`. |
| R5 | `metrics.test.ts`: para cada métrica, `clase === "snapshot"` ⇔ `fuente.tipo === "rollup"`. |
| R6 | `metrics.test.ts`: para cada métrica financiera, sus tablas ⊆ {3 ledgers, 2 cierres}; y ∩ {`orden`,`gestion_orden`,`orden_historial_estado`,`analytics_daily`} = ∅. |
| R7 | `metrics.test.ts`: `declara los 5 roles exactos sin apiKey` (`Object.keys(m.alcance)`) + `da acceso total a maestro y admin en toda metrica` (`alcance.maestro === alcance.admin === "total"`, contrastado contra `esAccesoTotal`). |
| R8 | `tests/unit/analytics/definiciones-catalogo.guardia.test.ts`: todo estado citado ∈ `ORDER_STATUS_SEED`; caso explícito que falla si aparece `en_fulfillment`. |
| R9 | Mismo guard: toda categoría citada ∈ el enum correspondiente importado como **tipo/valor** desde el esquema vigente. |
| R10 | `metrics.test.ts`: `granos ⊆ DIMENSIONES` y `granos` incluye `"fecha"`; `@ts-expect-error` con una dimensión inventada. |
| R11 | `metrics.test.ts`: `primer_intento_ok remite al criterio de intentos vigentes del historial` — `getMetrica("primer_intento_ok")!.definicion.criterio === "intentos_vigentes_historial"` y no declara umbral propio (sin `it.skip`: D1 la metió en v1). |
| R12 | `metrics.test.ts`: `tagDeDominio("operativa")` estable y distinto de `tagDeDominio("financiera")`; snapshot de las cadenas. |
| R13 | `tests/unit/analytics/ranges.test.ts`: `devuelve una ventana semiabierta para cada preset` y `devuelve una ventana semiabierta para un rango arbitrario` — forma del resultado (`desde`,`hasta`,`desdeFecha`,`hastaFecha`) y `hasta` NO pertenece al rango. |
| R14 | `tests/unit/analytics/ranges-reuso.guardia.test.ts`: `ranges.ts` importa de `@/lib/utils/fecha-cr`; censo de `6 * 60 * 60 * 1000`, `toISOString().slice`, `startOfDayCR` en `lib/analytics/**` = 0. |
| R15 | `ranges.test.ts`: el caso literal de R15 y su simétrico de borde `2026-07-15T05:59:59.999Z` → `"2026-07-14"`. |
| R16 | `ranges.test.ts`: `cumple los invariantes (b)-(e) para toda entrada` (tabla de casos: 3 presets + rangos arbitrarios, con cruces de mes y de año) y `contiene a now solo para los tres presets`. |
| R17 | `ranges.test.ts`: llamada con `now` explícito, sin `vi.useFakeTimers()`. |
| R18 | `ranges.test.ts`: el mismo caso ejecutado con `process.env.TZ` reasignado a `UTC` / `Asia/Tokyo` da resultados idénticos. |
| R19 | `tests/unit/analytics/filters.test.ts`: `{ ...valido, foo: 1 }` → `success === false` con `unrecognized_keys`. |
| R20 | `filters.test.ts`: `rechaza el filtro sin rango`; `rechaza el preset trimestre`; `acepta dia, semana, mes y personalizado`. |
| R21 | `filters.test.ts`: escalar `"z1"` → error; `[]` → error; `[""]` → error; `["z1","z2"]` → ok; ausencia → ok. |
| R22 | `filters.test.ts`: `rechaza instantes, epochs y offsets en desde/hasta` — `"2026-07-15T10:00:00Z"`, `1752537600000`, `"2026-07-15T00:00:00-06:00"` y `"2026-7-5"` → error. |
| R23 | `filters.test.ts`: el error se mapea a `fieldErrors` con la clave del campo culpable; sin `throw`. |
| R24 | `filters.test.ts`: `{ ...valido, rol: "maestro" }` y `{ ...valido, usuario_id: "u1" }` → error por `.strict()`. |
| R25 | `tests/unit/analytics/frontera.guardia.test.ts`: `db/migrations` sin carpeta nueva; sin archivos nuevos en `app/**`, `components/**`, `lib/actions/**`, `lib/services/**`, `lib/repositories/**` (diff de la rama). |
| R26 | Salida de `./init.sh` y de la suite pegada en `progress/impl_135.md`. |
| R27 | `ranges.test.ts`: `la semana empieza el lunes CR y llega hasta hoy` — caso literal de R27 + un `now` en domingo (la semana es la que empezó el lunes anterior, 7 días) + cruce de mes. |
| R28 | `ranges.test.ts`: `el preset mes es una ventana movil de 30 dias, no el mes calendario` — caso literal de R28; `hasta - desde === 30 * 24 * 3600_000`; caso con `now` el día 1 del mes (el rango arranca en el mes anterior). |
| R29 | `filters.test.ts`: `exige desde y hasta cuando el rango es personalizado`; `rechaza el rango invertido`; `rechaza una ventana de 367 dias y acepta la de 366`; `rechaza desde/hasta junto a un preset`; todos con `fieldErrors`. |
| R30 | `metrics.test.ts`: `agrupa las ordenes sin mensajero en el cubo sin_asignar` — toda métrica con grano `mensajero` declara `definicion.sinAsignar === "incluir"` y `MENSAJERO_SIN_ASIGNAR === "sin_asignar"` (constante única, censada fuera del módulo = 0). |
| R31 | `ranges.test.ts`: `usa el dia natural de Costa Rica 00:00-24:00` — todo borde termina en `T06:00:00.000Z` y NUNCA en `T00:00:00.000Z`; complementado por el censo de `startOfDayCR` de `ranges-reuso.guardia.test.ts`. |
| R32 | `tests/unit/analytics/metrics-dinero.guardia.test.ts`: `solo los roles de acceso total ven metricas financieras` — para toda financiera, `maestro`/`admin` = `total` y los otros tres = `prohibido`, ninguna `acotado`; `listarMetricas({ rol: "adminTienda" })` no contiene dominio financiera (ídem `adminSatelite`, `mensajero`). |
| R33 | `metrics.test.ts`: `admite metricas declaradas sin productor` — `estadoProduccion ∈ {"declarada","producida"}` en toda entrada, `@ts-expect-error` con un tercer valor, y `listarMetricas({ estadoProduccion: "producida" })` filtra. |
| R34 | `definiciones-catalogo.guardia.test.ts`: `atribuye por la zona congelada de la orden` — toda métrica con grano `zona` declara `definicion.atribucionZona === "orden"`; censo de `usuario.zona_id` en `lib/analytics/**` = 0. |
| R35 | `metrics.test.ts`: `cuenta gestiones vigentes, no ordenes` — las cinco métricas tienen `unidadDeConteo === "gestion"` y su `definicion.excluye` cita `anulada_at`; `no declara una familia paralela por orden` (no existe ningún id `*_por_orden`); `las tasas se declaran sobre gestiones` (denominador = los 4 ids y `descripcion` contiene la advertencia). |
| R36 | `metrics.test.ts`: `expone la unidad de conteo de cada metrica` (dominio cerrado, `orden` en `ordenes_creadas`/`ordenes_por_estado`) y `sonSumables devuelve false entre entregas y ordenes_creadas` / `true entre entregas y devoluciones`. |

---

## Decisiones del humano (2026-07-30)

> Las 10 preguntas abiertas quedaron **respondidas el 2026-07-30** por el **humano responsable
> del producto** (única autoridad reconocida por el arnés para esta puerta). Se conserva el
> enunciado íntegro de cada pregunta —el rastro no se borra— y debajo, la respuesta **textual**,
> quién la tomó y la consecuencia aceptada. **`tasks.md > T0` queda CERRADO.**
>
> Lo que aquí se decide manda sobre cualquier redacción anterior de `design.md`.

### D1 ← Q1 · catálogo v1

- **Respuesta textual:** «todas».
- **Quién:** humano responsable del producto, 2026-07-30.
- **Qué significa:** se aprueba **entero** el catálogo v1 propuesto en `design.md §3.3`. Deja de
  ser propuesta: **es el contrato**. Ninguna métrica se retira y ninguna se añade sin una nueva
  decisión fechada.
- **Consecuencia aceptada:** la 126 y la 127 quedan obligadas a implementar todas las métricas
  cuyo `estadoProduccion` sea `producida`; ninguna es especulativa a partir de ahora.
- **Nota de reconciliación (no reabre la puerta):** el enunciado de la respuesta cita «las 13
  operativas y las 6 financieras», el enunciado original de Q1 hablaba de «12 operativas + 8
  financieras», y la tabla real de `design.md §3.3` tiene **14 filas operativas → 15 ids**
  (la fila `tasa_devolucion` / `tasa_rechazo` declara dos) y **6 filas financieras → 8 ids**
  (la fila `ingreso_flete` / `ingreso_comision_cod` / `ingreso_iva` declara tres). Como la
  respuesta es «todas / ENTERO», gobierna la **tabla completa**: **15 ids operativos + 8 ids
  financieros = 23 métricas**. Los conteos citados de memoria no recortan nada.

### D2 ← Q2 · primer día de la semana

- **Respuesta textual:** «lunes».
- **Quién:** humano responsable del producto, 2026-07-30.
- **Consecuencia aceptada:** el preset `semana` tiene **borde de calendario** (R27).

### D3 ← Q3 · qué es «mes»

- **Respuesta textual:** «últimos 30».
- **Quién:** humano responsable del producto, 2026-07-30.
- **Qué significa:** `mes` es una **ventana móvil de 30 días**, NO el mes calendario (R28).
- **Tensión declarada A PROPÓSITO (no es un bug que arreglar):** conviven **dos convenciones
  distintas** en el mismo enum de presets — `semana` se ancla a un **borde de calendario**
  (lunes, D2) mientras `mes` es una **ventana móvil** sin anclaje de calendario (D3). Está
  escrito aquí y en `design.md §4.3` precisamente para que nadie "homogenice" ambos presets más
  adelante creyendo que corrige una inconsistencia.
- **⚠ SUPUESTO DEL SPEC_AUTHOR, NO DECISIÓN DEL HUMANO:** la segunda mitad de Q3 (*¿período en
  curso o último período completo?*) **no se respondió**. Se asume **período EN CURSO hasta
  ahora** para los tres presets (`dia`, `semana`, `mes`), es decir `hasta = inicio del día CR
  siguiente al de now`. Queda marcado como supuesto: si el humano lo contradice, cambian R15,
  R27 y R28 y sus tests, y nada más.

### D4 ← Q4 · rango arbitrario

- **Respuesta textual:** «abierto y presets».
- **Quién:** humano responsable del producto, 2026-07-30.
- **Qué significa:** el filtro admite **los tres presets Y** un rango arbitrario `desde`/`hasta`.
- **Tope:** **366 días**, tomado de la recomendación **no objetada** del spec_author (no es una
  cifra que el humano haya pronunciado; se declara como tal y se puede revisar sin tocar el
  resto del contrato).
- **R añadidos:** R29; **R reescritos:** R13, R16, R20, R22.

### D5 ← Q5 · órdenes sin mensajero

- **Respuesta textual:** «sin asignar».
- **Quién:** humano responsable del producto, 2026-07-30.
- **Qué significa:** opción (a) — cubo explícito **`sin_asignar`** para las órdenes con
  `mensajero_asignado_id IS NULL`. No se excluyen ni del numerador ni del denominador (R30).
- **Consecuencia aceptada, escrita como contrato hacia la 123 (no se esconde):** `mensajero_id`
  es **NULLABLE en el grano del rollup `analytics_daily`**. Como Postgres no considera dos
  `NULL` iguales en un índice único, la 123 **está obligada a elegir** entre (i) un **índice
  único parcial** por cada combinación de nulidad, o (ii) un **valor centinela** no nulo
  (`'sin_asignar'`) en la columna del grano. La 135 no elige por ella, pero deja el problema
  enunciado para que no lo descubra en producción.

### D6 ← Q6 · día operativo canónico

- **Respuesta textual:** «sí» (a la propuesta del spec_author).
- **Quién:** humano responsable del producto, 2026-07-30.
- **Qué significa:** analítica adopta el **día natural de Costa Rica 00:00–24:00** vía
  `inicioDelDiaCREnUtc` (convención de la feature 144), y se **abre un ticket aparte** para
  sanear `RankingService` (`lib/services/RankingService.ts:60-61`, hoy 18:00–18:00 CR).
- **Consecuencia aceptada y declarada:** hasta que ese ticket se resuelva, **la analítica y el
  ranking reportarán cifras distintas para "hoy"**. Es una divergencia conocida y aceptada, no
  un defecto a reportar (R31).

### D7 ← Q7 · qué ve cada rol del dinero

- **Historia real de la respuesta (se conserva el rastro, como con las preguntas):**
  1. Primera respuesta, 2026-07-30: **«el maestro solamente»**.
  2. **Rectificación del mismo día, 2026-07-30 — la que vale: «admin y maestro pueden».**
- **Quién:** humano responsable del producto, ambas.
- **Qué significa (versión vigente):** las métricas de dominio **financiera** tienen alcance
  `total` para **`maestro` Y `admin`** — exactamente el par que `esAccesoTotal(rol)`
  (`lib/auth/acceso-total.ts`) ya trata como equivalente. **La equivalencia `maestro ≈ admin`
  NO se rompe:** el catálogo se **apoya** en ella y el test usa ese helper como criterio en vez
  de enumerar roles a mano. `adminSatelite`, `adminTienda` y `mensajero` → `prohibido` (R32).
- **Consecuencias aceptadas, con todas las letras:**
  - **(a)** El `adminTienda` **NO** ve su propia cuenta por pagar ni su COD recaudado, y el
    `mensajero` **NO** ve su devengado, **aunque la 127 los calcule**. El cálculo existe; la
    exposición a esos roles, no.
  - **(b)** **Aviso dirigido a la 132 y a la 133:** el tablero financiero de la **132** y los
    recortes de presentación de la **133** quedan limitados a los **dos roles de acceso total**.
    Ninguna de las dos debe diseñar una vista financiera "recortada" para tienda, satélite o
    mensajero: no existe tal vista.
  - **(c)** Queda **obsoleta** la lectura anterior según la cual «ni el admin ve dinero». Todo
    texto que dijera eso está corregido en los tres archivos del spec.

### D8 ← Q8 · métricas sin productor

- **Respuesta textual:** «sí».
- **Quién:** humano responsable del producto, 2026-07-30.
- **Qué significa:** el catálogo **puede** declarar métricas que todavía no tienen productor
  (patrón de la feature 154). Se materializa como campo obligatorio `estadoProduccion`
  (`declarada` | `producida`), R33.
- **Consecuencia aceptada:** una métrica `declarada` no es deuda de la 126/127; el que no esté
  producida es información del catálogo, no un olvido.

### D9 ← Q9 · zona de atribución

- **Respuesta textual:** «orden».
- **Quién:** humano responsable del producto, 2026-07-30.
- **Qué significa:** se atribuye por **`orden.zona_id`** (el valor congelado en la orden), nunca
  por la zona del mensajero que la gestionó (R34).
- **Consecuencia aceptada:** si un mensajero de la zona A gestiona una orden de la zona B, la
  entrega cuenta en **B**; el `adminSatelite` de A no la ve, aunque la haya hecho su gente.

### D10 ← Q10 · gestión vs orden

- **Respuesta textual:** «por gestión».
- **Quién:** humano responsable del producto, 2026-07-30.
- **Qué significa:** **UNA sola convención**, no las dos familias que el spec_author había
  recomendado. `entregas`, `devoluciones`, `rechazos`, `reprogramaciones` e `incidentes` cuentan
  **gestiones vigentes** (`gestion_orden.anulada_at IS NULL`), R35.
- **Consecuencias aceptadas, con todas las letras:**
  - **(a)** `entregas + devoluciones + rechazos + incidentes` **NO suma el número de órdenes**:
    una orden reprogramada y luego entregada cuenta **dos veces**. Por tanto `tasa_entrega`
    (y `tasa_devolucion`, `tasa_rechazo`) es una tasa **sobre gestiones**, no sobre órdenes.
  - **(b)** `ordenes_creadas` y `ordenes_por_estado` **siguen contando ÓRDENES** porque miden
    otra cosa. Para que la 126 y los tableros no las sumen con las de gestión por error, la
    diferencia DEBE ser **evidente en la propia métrica**: campo `unidadDeConteo`
    (`gestion | orden | moneda | tiempo`) + el helper `sonSumables()` (R36).

---

## Enunciado original de las preguntas (rastro, ya cerradas)

> **Bloquean la implementación.** No las respondo yo. `tasks.md > T0` es la puerta.
> *(Bloque conservado tal cual se escribió; todas resueltas arriba el 2026-07-30.)*

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
