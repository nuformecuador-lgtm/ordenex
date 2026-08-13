# Feature 213 — El reintento se cuenta en el CIERRE, no en cada gestión

Requisitos en notación EARS. Cada `R<n>` es verificable con un test. Feature
`backend`, complejidad **high**. `depends_on: 160`.

> **Esta feature MUEVE el punto donde una orden gana un reintento.** No añade una
> pantalla ni un estado: cambia la definición del número que gobierna el escalado
> automático del cron SLA (99) y, por esa vía, el `cobroRechazado` de la 56
> (dinero real). El mapa de estados NO cambia.
>
> **Hay requisitos BLOQUEADOS.** Seis preguntas de la ficha y seis descubiertas al
> medir el código siguen abiertas (§Preguntas abiertas). Los requisitos que
> dependen de ellas están marcados `⛔ BLOQUEADO POR Qn` y NO deben implementarse
> hasta que el humano decida. Ninguna de esas decisiones se toma en este documento.

## La decisión del humano, textual (2026-08-13)

> «debemos delegar ese aumento al cron y al cierre manual, el flujo continua igual
> pero las rechazadas, devueltas y reprogramadas suman un reintento y las acciones
> que aumentan en 1 el contador remueven ese comportamiento»

Interpretación que la ficha fija y que este spec asume como ENTRADA, no como
sugerencia:

| # | Decisión |
| --- | --- |
| **D1** | El corte automático del cron y el cierre manual son los que incrementan el contador. (¿Qué instante exacto del cierre manual? → **Q2**.) |
| **D2** | Suma **1** por cada orden del cierre cuyo resultado sea `rechazada`, `devuelta` o `reprogramada`. |
| **D3** | Las dos aristas que hoy suman (#14 `→ devuelta` y #13 `→ reprogramada`, familia `gestion`) dejan de sumar por sí solas. |
| **D4** | El mapa cerrado de transiciones NO cambia: ninguna arista se agrega, se quita ni se redirige. |
| **D5** | Consecuencias declaradas y aceptadas por la ficha: (a) `rechazada` **empieza** a contar (hoy no cuenta por ninguna vía); (b) el contador de una orden **deja de existir** hasta que su cierre se procese. |

---

## Contexto VERIFICADO contra el código de `C:/w213` (rama `feature/213`, desde `origin/dev`)

Todo anclaje de esta sección se comprobó abriendo el archivo. Donde el número de
línea de la ficha no coincidía, se corrigió aquí.

### El conteo de hoy

- **Predicado único:** `whereIntentosVigentes`
  (`lib/repositories/OrdenHistorialRepository.ts:105`). Dos condiciones en AND:
  (1) destino `devuelta` con CUALQUIER `origen_tipo` (rama A, `:112`) **OR**
  destino `reprogramada` con `origen_tipo ∈ ORIGEN_TIPOS_REPROGRAMADA_INTENTO`
  (rama B, `:115-118`, omitida entera si `reprogramadaId === null`); (2) vigencia:
  la fila no vino de una gestión (`gestionOrdenId: null` + `origenTipo notIn
  ORIGEN_TIPOS_CON_GESTION`) **OR** su gestión no está anulada
  (`gestion: { anuladaAt: null }`), `:124-134`.
- **Los dos métodos del repo que lo consumen:** `contarIntentosVigentes`
  (`:188`) y `contarIntentosVigentesEnLote` (`:203`, `groupBy` con el MISMO
  `where`).
- **Los dos métodos del servicio:** `OrdenHistorialService.contarIntentos`
  (`lib/services/OrdenHistorialService.ts:64`) y `contarIntentosEnLote` (`:77`);
  el criterio se traduce de `value` a id en `resolverCriterio` (`:95`), único
  dueño de esa traducción. Los `value` están declarados en `:17-18`.
- **Contrato:** `CriterioIntento` (`lib/interfaces/repositories/IOrdenHistorialRepository.ts:65`)
  = `{ devueltaId, reprogramadaId }`; los dos métodos del repo, `:123` y `:135`;
  los dos del servicio, `lib/interfaces/services/IOrdenHistorialService.ts:34` y `:43`.
- **Listas y prosa:** `ORIGEN_TIPOS_CON_GESTION` (`lib/types/orden-historial.ts:117`)
  y `ORIGEN_TIPOS_REPROGRAMADA_INTENTO` (`:147`, un solo valor: `gestion`). El
  bloque `:56-116` es prosa que justifica, familia por familia, por qué cada una
  de las 26 del enum queda fuera del criterio: es documentación que este cambio
  invalida en masa.

### Quién consume ese número (inventario CERRADO, 11 call-sites)

| Consumidor | Ancla | Qué hace con el número |
| --- | --- | --- |
| `DevolucionSlaService` | `lib/services/DevolucionSlaService.ts:117` | **DINERO.** `intentos >= umbral` → escala a `rechazada` (`:118-122`) → gestión sintética `resultado: rechazada` (`lib/repositories/DevolucionSlaRepository.ts:145-155`) → `cobroRechazado` (56) en el próximo cierre. |
| `OrdenHistorialService.obtenerHistorial` | `:59` | Drawer de historial: `intentos` + `umbral`. |
| `OrdenService` | `:303`, `:355` | Columna «Intentos» del listado y variantes. |
| `MisAsignacionesService` | `:168` | Portal del mensajero. |
| `RecepcionSateliteService` | `:136`, `:209`, `:281` | Recepción satélite (3 lecturas). |
| `NovedadesService` | `:66` | Novedades de la tienda. |
| `RechazosSlaTiendaService` | `:56` | Rechazadas por plazo vencido. |
| `ManifiestoService` | `:183` | **Columna del archivo descargable** (160/R28). |
| `liberacion-reprogramada` (action) | `lib/actions/liberacion-reprogramada.ts:93` | Aviso «Liberadas hoy». |
| `AnaliticaRollupService` | `lib/services/AnaliticaRollupService.ts:238` | **KPI `primer_intento_ok` PERSISTIDO** en `analytics_daily`. |
| `AnaliticaOperativaService` | `lib/services/AnaliticaOperativaService.ts:462` | El mismo KPI en su versión VIVA. |

### El mapa cerrado (`lib/types/order-status-transiciones.ts`)

- Aristas que HOY cuentan: **#13** `en_reparto → reprogramada` (`gestion`, `:196`)
  y **#14** `en_reparto → devuelta` (`gestion`, `:197`).
- La tercera arista hacia esos destinos, **#22** `devuelta → reprogramada`
  (`reprogramacion_tienda`, `:225`), NO cuenta hoy (160/R2).
- Corte automático: **#16** `en_reparto → sin_gestionar` (`corte_sin_gestionar`,
  `rol: sistema/cron`, `:199`).
- Aprobación del cierre: **#17/#18** `sin_gestionar → en_bodega_*`
  (`liberacion_sin_gestionar`, `:244-245`) y **#38/#39** `rechazada →
  por_devolver{,_a_tienda}` (`devolucion_rechazada`, `:233-238`).
- Ninguno de esos destinos entra en las dos ramas del criterio actual: de ahí el
  agujero que abre esta ficha.

### Los productores del cierre (medidos, con archivo:línea)

| Instante | Quién lo ejecuta | Qué escribe |
| --- | --- | --- |
| **Corte automático (cron)** | `CorteDiarioService.ejecutarCorte` (`lib/services/CorteDiarioService.ts:51`) → `CierreDiaRepository.crearCierre` (`lib/repositories/CierreDiaRepository.ts:395`) | Crea `cierre_dia` con `estado='vencido'` (`:410-424`), transiciona `en_reparto → sin_gestionar` (`:436-466`) y **vincula las gestiones pendientes poniendo `gestion_orden.cierre_id`** (`:480-483`, guardado por `cierreId: null, anuladaAt: null`). |
| **Solicitud del mensajero** | `CierreDiaService.solicitarCierre` (`lib/services/CierreDiaService.ts:391`) → el MISMO `crearCierre` (`:475`) | `estado='solicitado'` y **el mismo `cierre_id` sobre las gestiones** (`CierreDiaRepository.ts:480`). |
| **Aprobación del admin** | `CierresAdminService.aprobarCierre` (`lib/services/CierresAdminService.ts:421`) → `CierresAdminRepository.resolverCierre` (`lib/repositories/CierresAdminRepository.ts:616`) | **Solo cambia `cierre_dia.estado` a `aprobado`** (`:632-640`) + wallets + libera `sin_gestionar` (`:733-793`) + dispara la devolución de `rechazada` (`:805-858`). **NO toca `gestion_orden.cierre_id`.** |

Consecuencias medidas de esa tabla, que las preguntas abiertas necesitan:

1. **`gestion_orden.cierre_id` se puebla en `crearCierre`, no al aprobar.** El
   corte automático y la SOLICITUD del mensajero son el mismo código; la
   APROBACIÓN es otro momento y otro repositorio.
2. **La contraparte simétrica del corte automático es `solicitarCierre`, no
   `aprobarCierre`** (los dos crean el cierre y vinculan; la aprobación resuelve
   uno ya creado). La ficha interpreta «cierre manual» como la aprobación: eso es
   exactamente **Q2**.
3. **Una orden `sin_gestionar` del corte no tiene gestión y por tanto no tiene
   `resultado`.** Un `vencido` money-neutral puede vincular 0 gestiones y solo
   transicionar órdenes a `sin_gestionar` (`CierreDiaRepository.ts:484-491`). Con
   D2 tal cual, ese cierre no suma nada: el corte automático solo «suma» por las
   gestiones que el mensajero ya había registrado. Ver **Q6** y **Q9**.
4. **La ventana de deshacer muere cuando `cierre_id` se puebla**
   (`CierreDiaService.ts:519-521`, `MSG_YA_EN_CIERRE`): a partir de ese instante
   la gestión ya no puede anularse. Es el primer instante en que el resultado de
   una orden es INMUTABLE.

### ¿El detalle del cierre basta para derivar el conteo? (respuesta a Q1, medida)

- **`cierre_detail` NO guarda el resultado.** El modelo (`db/schema.prisma:1583`)
  congela las entradas de la fórmula del dinero (`montoCobrar`, `cobraComision`,
  zona/tienda, tarifa) y descriptivos (guía, remisión, destinatario…). No hay
  columna `resultado`, y su grano es `(cierre_id, orden_id)` con dedupe explícito
  (`@@unique`, `:1633`; dedupe en `CierreDiaRepository.ts:540-545`).
- **`gestion_orden` SÍ lo guarda, con vigencia:** `resultado`
  (`db/schema.prisma:727`, enum `GestionResultado` = `entregada`, `reprogramada`,
  `devuelta`, `rechazada`, `incidente`, `:654-662`), `cierreId` (`:752`),
  `anuladaAt` (`:776`), e índices `@@index([ordenId])` (`:791`) y
  `@@index([cierreId])` (`:793`).
- Por tanto **hay de dónde derivar el conteo sin columna nueva y sin migración**,
  y `160/R7` puede sobrevivir. El diseño lo desarrolla en `design.md §4`; la
  elección del ancla sigue siendo **Q2**.
- **OJO con el grano:** una orden puede acumular VARIAS gestiones vigentes en el
  mismo cierre (declarado en `db/schema.prisma:1562-1563` y `:721-722`, y por eso
  el detalle deduplica). «1 por cada ORDEN» y «1 por cada GESTIÓN» no son lo
  mismo. Ver **Q7**.

---

## Grupo A — El criterio NUEVO de «intento de entrega»

**R1 — El intento se gana en el cierre.** El sistema DEBE contar como UN intento
de entrega de una orden cada resultado de gestión VIGENTE de esa orden que (a)
pertenezca a un cierre del día procesado según R3, y (b) sea `rechazada`,
`devuelta` o `reprogramada`. Ninguna otra condición DEBE sumar un intento.

**R2 — `entregada` e `incidente` no cuentan.** SI el resultado de la gestión de
una orden en un cierre es `entregada` o `incidente`, ENTONCES el sistema NO DEBE
contarlo como intento.

**R3 — El instante que suma.** ⛔ **BLOQUEADO POR Q2.** El sistema DEBE contar el
intento a partir de UN único instante declarado del ciclo del cierre, y el mismo
para el corte automático y para el cierre manual. MIENTRAS ese instante no se haya
producido para una orden, el sistema DEBE reportar para ella el conteo que tenía
antes de ese cierre.

**R4 — Se cuenta UNA vez.** CUANDO una misma orden pasa por el corte automático y
después por el cierre manual (o cuando cualquiera de los dos caminos se reintenta,
reejecuta o se resuelve dos veces), el sistema NO DEBE sumar más de un intento por
el mismo resultado de gestión.

**R5 — Vigencia conservada.** El sistema NO DEBE contar el resultado de una
gestión ANULADA (deshecha), y NO DEBE modificar ningún registro para excluirla: la
exclusión DEBE ser un filtro de LECTURA. El historial de estados sigue siendo
append-only e inmutable.

**R6 — Criterio ÚNICO y compartido.** El sistema DEBE producir, para una misma
orden, EXACTAMENTE el mismo número de intentos en todas las lecturas que lo
consumen (regla de reintento-vs-escalado del cron SLA, drawer de historial, dato
de cualquier superficie, archivo descargable y KPI de analítica). El sistema NO
DEBE admitir una segunda definición de «intento».

**R7 — Resolución EN LOTE conservada.** CUANDO el sistema resuelve el conteo para
un conjunto de N órdenes, DEBE obtenerlo con UNA sola consulta, sea cual sea N; SI
el conjunto está vacío, ENTONCES NO DEBE emitir consulta alguna y DEBE devolver un
resultado vacío.

**R8 — Órdenes sin intentos.** SI una orden no cumple R1 por ninguna vía,
ENTONCES el sistema DEBE reportar `0` para esa orden, no ausencia de dato ni error.

**R9 — Degradación segura.** SI los datos que el criterio necesita no están
disponibles (catálogo o enum incompletos por seed pendiente), ENTONCES el sistema
DEBE reportar `0` para toda orden y NO DEBE fallar la lectura.

---

## Grupo B — Lo que DEJA de contar

**R10 — La devolución del mensajero ya no suma por sí sola.** CUANDO un mensajero
registra una gestión con resultado `devuelta` (arista #14), el sistema NO DEBE
incrementar el conteo de intentos de esa orden por el solo hecho de la transición;
el incremento DEBE ocurrir según R1/R3.

**R11 — La reprogramación del mensajero ya no suma por sí sola.** CUANDO un
mensajero registra una gestión con resultado `reprogramada` (arista #13), el
sistema NO DEBE incrementar el conteo por el solo hecho de la transición; el
incremento DEBE ocurrir según R1/R3.

**R12 — La reprogramación de la tienda sigue sin sumar.** SI una orden `devuelta`
se reprograma desde la tienda (arista #22, `reprogramacion_tienda`), ENTONCES el
sistema NO DEBE sumar un intento por esa reprogramación. *(El motivo cambia: ya no
es «para no contar doble con la fila `devuelta` vigente», sino que esa
reprogramación no es un resultado de gestión de un cierre. La conclusión de
`160/R2` sobrevive; su razonamiento se reescribe.)*

**R13 — Sin criterio residual por transición.** El sistema NO DEBE conservar
ningún camino de lectura, activo o inactivo, que derive el conteo de intentos de
los destinos de las transiciones del historial. Un segundo derivador «legado» es
un incumplimiento de R6, no una compatibilidad.

**R14 — El mapa de estados no se toca.** El sistema NO DEBE agregar, retirar ni
redirigir ninguna arista de las transiciones legales, NO DEBE añadir valores al
enum de familias de origen y NO DEBE cambiar el estado destino de ninguna acción
existente.

---

## Grupo C — El escalado y el dinero

**R15 — El escalado usa el criterio nuevo.** CUANDO el cron SLA evalúa una orden
que reposa en `devuelta` con causa `not_found` y su ventana vencida, el sistema
DEBE comparar contra el umbral configurable el conteo definido en R1.

**R16 — El resto del cron no cambia.** El sistema NO DEBE alterar, respecto del
comportamiento vigente: qué órdenes son candidatas, las ventanas por causa, el
escalado directo de `wrong_number`/`wrong_address`, la idempotencia por guarda de
estado, la resiliencia por orden, el destino de la liberación, ni la atribución
del mensajero en la gestión sintética del escalado.

**R17 — El cobro por rechazo no gana ni pierde disparadores.** El sistema NO DEBE
cambiar qué gestiones generan el ingreso de bodega por rechazo, ni su monto, ni el
instante en que se snapshotea. Esta feature solo puede cambiar CUÁNDO una orden
alcanza el umbral, nunca cuánto se cobra por alcanzarlo.

**R18 — El lazo del escalado se declara.** ⛔ **BLOQUEADO POR Q3.** El sistema
DEBE declarar explícitamente si el resultado `rechazada` producido por el propio
escalado del cron SLA suma un intento a la orden que lo causó, y DEBE comportarse
de forma idéntica en cada corrida (sin depender de cuántas veces corra el cron).

**R19 — Efecto retroactivo declarado y medido.** ⛔ **BLOQUEADO POR Q4.** ANTES
de activar el criterio nuevo, el sistema DEBE poder informar cuántas órdenes en
vuelo cambian de lado del umbral al cambiar el criterio, y esa medición DEBE
quedar fechada en la especificación. No se activa un criterio de dinero sin saber
a cuántas órdenes mueve.

---

## Grupo D — Superficies, contratos y analítica

**R20 — Sin cambios en superficies.** El sistema DEBE seguir exponiendo el número
de intentos en las mismas lecturas y con la misma forma que hoy (columna
«Intentos» en tablas, dato etiquetado fuera de tablas, columna del manifiesto,
`0` explícito), y NO DEBE añadir ni retirar superficies. Lo único que cambia es el
VALOR.

**R21 — Sin regla de permisos nueva.** El sistema DEBE derivar la visibilidad del
conteo del alcance que cada lectura YA aplica y NO DEBE exponer el conteo de una
orden que el actor no puede leer por esa vía.

**R22 — Sin ordenar ni filtrar por el dato.** El sistema NO DEBE aceptar el
número de intentos como criterio de ordenamiento ni como filtro en las lecturas
paginadas, y NO DEBE agregarlo al contrato público de integradores ni a la vista
del paquete ni a la etiqueta imprimible.

**R23 — El KPI de analítica no redefine el criterio.** El sistema DEBE seguir
resolviendo `primer_intento_ok` con el punto único de conteo, sin `COUNT` propio,
sin umbral propio y sin columna materializada nueva para el KPI, y DEBE mantener
el invariante `primer_intento_ok <= entregas`.

**R24 — Deriva declarada del rollup histórico.** ⛔ **BLOQUEADO POR Q10.** El
sistema DEBE declarar qué ocurre con las filas de `analytics_daily` ya escritas
con el criterio viejo (se dejan, se re-backfillean o se marcan), y NO DEBE dejar
que la versión VIVA y la PERSISTIDA del mismo KPI se contradigan en silencio.

---

## Grupo E — Derogaciones sobre la feature 160

**R25 — `160/R1` queda DEROGADO y reemplazado.** La definición exhaustiva del
intento por destinos de transición («y solo esas») deja de ser cierta. Este
documento la sustituye por R1. No se matiza: se reescribe.

**R26 — `160/R2` queda REFORMULADO.** La conclusión (la reprogramación de la
tienda no cuenta) sobrevive en R12; el razonamiento del doble conteo desaparece
con el criterio viejo y NO DEBE conservarse como justificación en código ni en
tests.

**R27 — `160/R7` se conserva o se deroga explícitamente.** ⛔ **BLOQUEADO POR
Q1.** El sistema DEBE sostener el conteo sin columna, tabla, enum, índice ni
migración nuevos; SI el diseño aprobado exige persistirlo, ENTONCES `160/R7` DEBE
declararse DEROGADO en este documento, con su coste (migración up/down, backfill,
riesgo de drift) escrito antes de escribir código.

**R28 — La prosa que justifica el criterio se actualiza.** CUANDO el criterio
cambie, el sistema NO DEBE dejar en el código comentarios, listas o descripciones
de métrica que afirmen el criterio viejo. Una lista de familias de origen cuya
única función era decidir intentos NO DEBE sobrevivir sin dueño.

---

## Trazabilidad R → test

Se completa con rutas reales en `progress/impl_213.md §2` durante la
implementación (T14 de `tasks.md`). El mapa propuesto está en `tasks.md §3`.
Ningún requisito puede quedar sin dueño; el reviewer rechaza si falta uno.

---

## PREGUNTAS ABIERTAS

Ninguna está decidida aquí. **Q1–Q6 vienen de la ficha** (`feature_list.json`,
id 213); **Q7–Q12 se descubrieron midiendo el código** y son igual de
bloqueantes. Las respuestas hay que llevarlas a la puerta de aprobación.

### De la ficha

- **Q1 — ¿De dónde se deriva el conteo?** Medido: `cierre_detail` NO guarda el
  `resultado` (`db/schema.prisma:1583-1636`); `gestion_orden` sí, con `cierre_id`,
  `resultado` y `anuladaAt` e índices ya existentes. ¿Se acepta derivar de
  `gestion_orden` (sin migración, `160/R7` intacto) o se quiere una columna
  materializada (y entonces `160/R7` queda derogado con su coste)?
- **Q2 — ¿Qué instante suma, y cuál de los dos caminos cuando ambos aplican?**
  Los tres candidatos medidos son: (i) `gestion_orden.cierre_id` poblado (corte
  automático Y solicitud del mensajero, mismo código, `CierreDiaRepository.ts:480`);
  (ii) `cierre_dia.estado='vencido'` (solo el corte); (iii)
  `cierre_dia.estado='aprobado'` (solo la aprobación del admin,
  `CierresAdminRepository.ts:632`). La ficha dice «aprobación manual», pero la
  contraparte simétrica del corte automático es `solicitarCierre`, no
  `aprobarCierre`. ¿Cuál es el instante?
- **Q3 — El lazo de `rechazada`.** El cron escala a `rechazada` cuando el conteo
  alcanza el umbral y crea una gestión sintética `resultado: rechazada` con
  `cierre_id NULL` (`DevolucionSlaRepository.ts:145-155`), que el PRÓXIMO cierre
  vinculará. Con el criterio nuevo, ese resultado sumaría +1 a la orden que lo
  causó. ¿El escalado incrementa lo que lo causó?
- **Q4 — Efecto retroactivo.** Al ser derivado, cambiar el criterio cambia el
  conteo de TODAS las órdenes históricas de golpe, incluidas las que hoy reposan
  en `devuelta` esperando el SLA. ¿Se acepta? ¿Se mide antes a cuántas órdenes en
  vuelo les mueve el escalado (patrón `160/D7`: consulta contra producción, solo
  lectura, con fecha)?
- **Q5 — `devuelta` sin cierre.** Una orden gestionada como `devuelta` cuya
  gestión se deshace, o cuyo cierre nunca se aprueba (rechazado, o vencido nunca
  resuelto), no llegaría a contar nunca; hoy contaba en el acto. Con el ancla
  (iii) de Q2 esa orden queda con conteo 0 indefinidamente y el cron SLA la
  liberaría en bucle sin escalar jamás. ¿Se acepta? ¿Hay tope?
- **Q6 — `sin_gestionar` sigue sin contar.** El humano listó
  `rechazada`/`devuelta`/`reprogramada` y no lo incluyó. Queda así salvo decisión
  nueva. Ver también Q9.

### Descubiertas al medir

- **Q7 — Grano: ¿por ORDEN o por GESTIÓN?** El texto dice «1 por cada orden del
  cierre», pero una orden puede tener VARIAS gestiones vigentes en el mismo
  cierre (`db/schema.prisma:721-722` y `:1562-1563`; el detalle deduplica por eso).
  ¿Dos gestiones vigentes `reprogramada` + `devuelta` de la misma orden en el
  mismo cierre suman 1 o 2?
- **Q8 — ¿Y las gestiones de cierres ANTERIORES?** Con el criterio nuevo el
  conteo pasa a ser acumulativo sobre TODOS los cierres procesados de la orden, no
  solo el último. Se asume que sí (si no, ninguna orden llegaría nunca al umbral
  de 3), pero no está escrito en la decisión. ¿Confirmado?
- **Q9 — El corte automático no aporta resultados nuevos.** Medido: un `vencido`
  puede vincular 0 gestiones y solo transicionar órdenes a `sin_gestionar`
  (`CierreDiaRepository.ts:484-491`); esas órdenes no tienen `resultado`. Con D2 +
  Q6 tal cual, el corte automático **no suma nada que la solicitud del mensajero
  no sumara igual**, y el agujero que abrió esta ficha (salir, cortarse, volver a
  bodega y salir otra vez con el mismo contador) **sigue abierto**. ¿Es esto lo
  que se quiere, o `sin_gestionar` debía contar (Q6) precisamente para taparlo?
- **Q10 — Analítica: KPI persistido.** `primer_intento_ok` se calcula con este
  conteo (`AnaliticaRollupService.ts:238`) y se PERSISTE en `analytics_daily`
  (CHECK `primer_intento_ok <= entregas`,
  `db/migrations/20260731120000_analytics_daily/migration.sql:90`). Cambiar el
  criterio hace que las filas viejas y las nuevas midan cosas distintas, y que la
  versión VIVA (`AnaliticaOperativaService.ts:462`) discrepe del rollup histórico
  (hay un test de equivalencia: `tests/integration/db/analitica-operativa-equivalencia.test.ts`).
  ¿Se deja la deriva declarada, se re-backfillea o se acota la métrica?
- **Q11 — ¿Cuenta un resultado cuya orden ya salió de ese estado?** Con el ancla
  (iii) de Q2 pasan horas o días entre la gestión y la aprobación; en ese intervalo
  la orden puede haber sido reprogramada por la tienda (#22), liberada por el cron
  (#19/#20) o recuperada a mano (#23/#24). ¿El intento se cuenta igual (es un
  hecho pasado) o se condiciona al estado actual?
- **Q12 — ¿El conteo se «congela» al aprobar?** Hoy el número puede BAJAR si se
  deshace una gestión (`160/R5`). Con el criterio nuevo, la ventana de deshacer
  muere justo cuando `cierre_id` se puebla (`CierreDiaService.ts:519-521`), así
  que el conteo pasaría a ser monótono creciente por construcción. ¿Se declara esa
  monotonía como propiedad (y se testea), o hay algún camino que aún pueda bajarlo
  (anulaciones administrativas, borrado de gestiones) que haya que enumerar?
