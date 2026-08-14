# Feature 215 — El reintento se cuenta en el CIERRE, no en cada gestión

Requisitos en notación EARS. Cada `R<n>` es verificable con un test. Feature
`backend`, complejidad **high**. `depends_on: 160`.

> **Esta feature MUEVE el punto donde una orden gana un reintento.** No añade una
> pantalla ni un estado: cambia la definición del número que gobierna el escalado
> automático del cron SLA (99) y, por esa vía, el `cobroRechazado` de la 56
> (dinero real). El mapa de estados NO cambia.
>
> **Estado de las 12 preguntas (2026-08-13, cuarta ronda):** **once CERRADAS**
> (Q1, Q2, Q3, Q5, Q6, Q7, Q8, Q9, Q10, Q11, Q12). **Queda UNA:** **Q4**, que no es
> una decisión sino una **MEDICIÓN pendiente de ejecutar** (la consulta está lista
> en `design.md §7.6`); bloquea R19 y nada más.
>
> **Estado de la implementación:** el commit **7d9471c3** ya implementa el criterio
> nuevo (30 requisitos; bitácora en `progress/impl_215.md`). De aquí en adelante
> este documento describe lo que **EXISTE**, no un plan. Lo que la tercera ronda
> añade —el **discriminador de las gestiones SINTÉTICAS** (R18, R12, R34)— **NO
> está implementado** y va marcado como tal en cada requisito.

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

## Segunda ronda de decisiones (2026-08-13) — ENTRADA, no sugerencia

Del **humano**, cerrando tres preguntas abiertas:

| # | Decisión | Cierra |
| --- | --- | --- |
| **D6** | **`sin_gestionar` NO cuenta.** La lista se mantiene tal cual: `rechazada`, `devuelta`, `reprogramada`. El humano ACEPTA, sabiéndolo, que el caso «sale, se corta, vuelve a bodega y sale otra vez con el mismo contador» **siga abierto** tras esta feature. → §Limitación declarada. | **Q6, Q9** |
| **D7** | **El conteo se deriva de `gestion_orden`** (`cierre_id` + `resultado` + `anulada_at`), con los índices que ya existen. **SIN migración.** `160/R7` se **CONSERVA** y no se deroga. Queda **PROHIBIDO** materializar el contador en esta feature; `db/schema.prisma` no se toca. | **Q1** |
| **D8** | **Suma al APROBAR el cierre.** Ancla = `CierresAdminService.aprobarCierre` (`lib/services/CierresAdminService.ts:421`) → `CierresAdminRepository.resolverCierre` (`:616`), condición observable `cierre_dia.estado = 'aprobado'`. **NO** al crear/solicitar (`CierreDiaRepository.crearCierre:395`) ni al vencer. | **Q2** |

Del **leader**, decisiones rutinarias derivadas de las anteriores (ninguna
contradice el código; se verificó abriendo los archivos):

| # | Decisión | Motivo | Cierra |
| --- | --- | --- | --- |
| **D9** | **Grano por ORDEN, no por gestión.** Dos gestiones vigentes de la misma orden en el mismo cierre aprobado suman **1**, con el mismo dedupe que ya usa `cierre_detail` (`@@unique([cierreId, ordenId])`, `db/schema.prisma:1633`). | El texto del humano dice «1 por cada orden del cierre». | **Q7** |
| **D10** | **El conteo ACUMULA sobre todos los cierres aprobados de la orden**, no solo el último. | Sin acumulación ninguna orden alcanzaría el umbral (default 3) y la feature dejaría el escalado muerto. | **Q8** |
| **D11** | **Cuenta el RESULTADO ya ocurrido, no dónde está la orden ahora.** SI entre la gestión y la aprobación la orden se reprogramó por la tienda (#22), se liberó por SLA (#19/#20) o se recuperó a mano (#23/#24), el resultado sigue contando. | El conteo mide lo que pasó, no el estado actual. El predicado no mira `orden.estatus_id`. | **Q11** |
| **D12** | **El contador es MONÓTONO CRECIENTE: se declara como propiedad.** | Verificado: `aprobado` no está en `ESTADOS_RESOLUBLES` (`CierresAdminRepository.ts:39`) ni en `ESTADOS_REABRIBLES` (`:44`) ⇒ un cierre aprobado no puede salir de ese estado; y la anulación de una gestión está guardada por `cierre_id: null` (`CierreDiaRepository.ts:728`) ⇒ una gestión ya contada no puede anularse. **Es un cambio de comportamiento observable**: hoy el número BAJA al deshacer una gestión (`160/R5`). | **Q12** |

## Tercera ronda de decisiones (2026-08-13) — ENTRADA, no sugerencia

| # | Decisión del humano, textual | Lectura | Cierra |
| --- | --- | --- | --- |
| **D13** | «el cron debe validar y si ya esta en 3 actualizar el estado sin aumentar el conteo» | El escalado del cron SLA transiciona a `rechazada` **sin incrementar el contador**: la **gestión sintética** que crea ese escalado **NO cuenta como intento**. El cron valida el conteo contra el umbral y, si ya lo alcanzó, cambia el estado y nada más. | **Q3** → R18 |
| **D14** | «el cierre se cerrara en algun momento por un usuario» | **Se ACEPTA el riesgo de Q5.** NO se implementa ninguna de las tres mitigaciones (M1 contar también al vencer/solicitar, M2 tope de liberaciones, M3 alerta). Se asume que toda cierre acaba resolviéndose por acción de una persona, y por tanto el conteo anclado en `aprobado` termina ocurriendo. → §Supuesto operativo declarado. | **Q5** |

## Cuarta ronda (2026-08-13)

| # | Decisión del humano, textual | Lectura | Cierra |
| --- | --- | --- | --- |
| **D15** | «declara la deriva con fecha de corte» | `primer_intento_ok` cambia de definición y **se ASUME el escalón en la serie**. NO se re-backfillea el histórico de `analytics_daily` y NO se redefine la métrica para dejar de depender del contador. Lo anterior al corte queda con el criterio viejo, lo posterior con el nuevo, y **eso se DECLARA por escrito** donde lo encuentre quien lea la serie. → R24. | **Q10** |

---

## ⚠️ SUPUESTO OPERATIVO DECLARADO (D14) — de qué depende que esta feature funcione

**El conteo solo avanza si alguien resuelve el cierre.** Esta feature no tiene
ningún mecanismo propio que garantice que un cierre llegue a `aprobado`: depende de
que una persona lo apruebe, o de que el mensajero lo re-solicite y luego un admin lo
apruebe. El humano **acepta ese supuesto explícitamente** («el cierre se cerrará en
algún momento por un usuario») y por eso **no se implementa ninguna mitigación**.

**Qué pasa si el supuesto NO se cumple:** la orden queda con conteo **0**
indefinidamente; el cron SLA lee 0 < umbral y la **libera a bodega una y otra vez,
sin escalar jamás** a `rechazada`. Consecuencia de negocio: esa orden gira
indefinidamente y **el rechazo nunca se cobra** (el `cobroRechazado` de la 56 no
llega a emitirse por esa vía).

**Agravante ya medido:** un cierre `vencido` **no es aprobable directamente**
(`ESTADOS_RESOLUBLES = ["solicitado"]`, `lib/repositories/CierresAdminRepository.ts:39`;
la feature 111/R15 retiró `vencido` a propósito). Igual un `rechazado`. Los dos
necesitan un **paso humano previo**: que el mensajero lo re-solicite
(`CierreDiaService.ts:401-407` y `:414-419`) o que un admin use la válvula de escape
`forzarSolicitudVencido` (`CierresAdminRepository.ts:879`). Es decir: el supuesto no
pide «que alguien apruebe», pide **hasta dos acciones humanas** en los casos
`vencido` y `rechazado`.

Las tres mitigaciones descartadas **se conservan escritas** en `design.md §7bis`
con su coste, para que quien vuelva a esto no tenga que redescubrirlas. Si el
supuesto se rompe en producción, ahí está el menú.

---

## ⚠️ LIMITACIÓN DECLARADA — esta feature NO cierra el agujero que la originó (D6)

La pregunta que dio origen a la ficha fue *«¿el cron que hace el cierre automático
no suma un reintento, o el cierre manual al aprobar?»*, y el problema detrás era
que **una orden puede salir a reparto, ser cortada por el cron, volver a bodega y
salir otra vez con el mismo contador**. Con las decisiones D2 + D6, ese caso
**SIGUE ABIERTO** después de esta feature.

El motivo, medido: **el corte automático no aporta resultados nuevos.** Un cierre
`vencido` creado por el corte puede vincular **0 gestiones** y limitarse a
transicionar órdenes `en_reparto → sin_gestionar`
(`lib/repositories/CierreDiaRepository.ts:484-491`), y **una orden `sin_gestionar`
no tiene gestión y por tanto no tiene `resultado`**
(`gestion_orden.resultado` es NOT NULL y solo existe si hubo gestión,
`db/schema.prisma:727`). Como `sin_gestionar` no está en la lista que cuenta (D6),
el corte automático **no suma nada que el cierre del mensajero no sumara igual**.

Quien lea esta feature esperando que el conteo empiece a castigar las órdenes
cortadas por el cron se va a llevar una sorpresa: **no lo hace, y es deliberado.**
Cerrar ese agujero es **candidato a ficha aparte** (haría falta contar
`sin_gestionar`, o contar la transición #16, o contar las liberaciones
`liberacion_sin_gestionar` del historial). Requisito que lo fija: **R33**.

---

## Contexto VERIFICADO contra el código de `C:/w213` (rama `feature/215`, desde `origin/dev`)

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

Consecuencias medidas de esa tabla:

1. **`gestion_orden.cierre_id` se puebla en `crearCierre`, no al aprobar.** El
   corte automático y la SOLICITUD del mensajero son el mismo código; la
   APROBACIÓN es otro momento y otro repositorio. Con **D8**, el vínculo
   `cierre_id` es condición NECESARIA pero NO SUFICIENTE: hace falta además
   `cierre_dia.estado = 'aprobado'`.
2. **La contraparte simétrica del corte automático es `solicitarCierre`, no
   `aprobarCierre`.** El humano lo sabe y elige la aprobación igualmente (D8).
   Consecuencia: el corte automático **no es** un instante que sume; lo que suma
   es la aprobación posterior del cierre que el corte creó.
3. **Solo `solicitado` es aprobable.** `ESTADOS_RESOLUBLES = ["solicitado"]`
   (`CierresAdminRepository.ts:39`, feature 111/R15 retiró `vencido`). Un cierre
   `vencido` **no se puede aprobar directamente**: tiene que pasar antes por
   `solicitado`, sea porque el mensajero lo re-solicita
   (`CierreDiaService.ts:401-407`) o porque el admin usa la válvula de escape
   `forzarSolicitudVencido` (`CierresAdminRepository.ts:879`). Igual para un
   `rechazado` (`CierreDiaService.ts:414-419`, `ESTADOS_REABRIBLES`, `:44`).
   **Esto multiplica los caminos por los que un cierre nunca llega a `aprobado`
   ⇒ agrava Q5.**
   *(Aviso: el JSDoc de `resolverCierre` en `CierresAdminRepository.ts:630-631`
   dice «`solicitado` o `vencido`» — prosa DESACTUALIZADA respecto de la constante
   de `:39`. No es el criterio.)*
4. **Una orden `sin_gestionar` del corte no tiene gestión y por tanto no tiene
   `resultado`.** Un `vencido` money-neutral puede vincular 0 gestiones y solo
   transicionar órdenes a `sin_gestionar` (`CierreDiaRepository.ts:484-491`). Es
   el fundamento de la **§Limitación declarada** y de **D6**.
5. **La ventana de deshacer muere cuando `cierre_id` se puebla**
   (`CierreDiaService.ts:519-521`, `MSG_YA_EN_CIERRE`; guarda en el repo,
   `CierreDiaRepository.ts:728`): a partir de ese instante la gestión ya no puede
   anularse. Como contar exige además la aprobación (posterior), **toda gestión
   que llega a contar es ya inmutable ⇒ D12 (monotonía) se sostiene sin código
   nuevo.** No hay ningún borrado físico de `gestion_orden` en producción
   (verificado: los únicos escritores son `updateMany` en
   `CierreDiaRepository.ts:480,502,518,727` y `CierresAdminRepository.ts:654`).

### De dónde se deriva el conteo (Q1 CERRADA por D7: `gestion_orden`, sin migración)

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
- **Estado del cierre:** `cierre_dia.estado` (`db/schema.prisma:928`) con
  `@@index([estado])` (`:956`) y `@@index([mensajeroId, estado])` (`:959`).
- Por tanto se deriva **sin columna nueva y sin migración** (D7) y **`160/R7` se
  CONSERVA**. El predicado resultante está en `design.md §3`.
- **El grano importa y está decidido:** una orden puede acumular VARIAS gestiones
  vigentes en el mismo cierre (declarado en `db/schema.prisma:1562-1563` y
  `:721-722`, y por eso `cierre_detail` deduplica). **D9** fija el grano en la
  ORDEN: dos gestiones vigentes de la misma orden en el mismo cierre aprobado
  suman 1. Requisito: **R29**.

---

## Grupo A — El criterio NUEVO de «intento de entrega»

**R1 — El intento se gana en el cierre.** El sistema DEBE contar como UN intento
de entrega de una orden cada resultado de gestión VIGENTE de esa orden que (a)
pertenezca a un cierre del día procesado según R3, y (b) sea `rechazada`,
`devuelta` o `reprogramada`. Ninguna otra condición DEBE sumar un intento.

**R2 — `entregada` e `incidente` no cuentan.** SI el resultado de la gestión de
una orden en un cierre es `entregada` o `incidente`, ENTONCES el sistema NO DEBE
contarlo como intento.

**R3 — El instante que suma es la APROBACIÓN del cierre.** *(DESBLOQUEADO por D8.)*
CUANDO un cierre del día pasa a estado `aprobado`, el sistema DEBE contar un
intento por cada orden de ese cierre que cumpla R1. MIENTRAS un cierre no esté
`aprobado` —esté `solicitado`, `vencido` o `rechazado`— el sistema NO DEBE contar
ningún intento por las gestiones vinculadas a él.

**R4 — Se cuenta UNA vez.** CUANDO un cierre se aprueba, se re-aprueba, se
reintenta su aprobación, o cuando una orden recorre corte automático →
re-solicitud → aprobación, el sistema NO DEBE sumar más de un intento por ese
cierre a esa orden.

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
sistema NO DEBE sumar un intento por esa reprogramación, **ni siquiera cuando la
gestión sintética que crea quede vinculada a un cierre aprobado**.

> ⚠️ **INCUMPLIDO en 7d9471c3.** `GestionOrdenRepository.reprogramarDesdeDevuelta`
> (`:525-535`) crea una gestión sintética con `resultado: reprogramada`,
> `cierre_id: null` y `mensajero_id` = el de la última `devuelta` vigente (`:509-513`).
> `CierreDiaRepository.crearCierre` vincula por `{ mensajeroId, cierreId: null,
> anuladaAt: null }` (`:480-483`), así que esa gestión **entra al siguiente cierre
> de ese mensajero** y, al aprobarse, el predicado vigente la cuenta: la orden
> sumaría 2 (su `devuelta` + la reprogramación de escritorio de la tienda), que es
> exactamente el doble conteo que `160/R2` evitaba. El test que hoy cubre R12
> (`criterio-intento-entrega.test.ts` · «R12/R14: ninguna arista del mapa decide por
> sí sola un intento») afirma algo cierto pero **distinto** de lo que R12 exige: mide
> el mapa, no el predicado. Se corrige con el mismo discriminador de R18 → **R34**.

*(El motivo cambia respecto de `160/R2`: ya no es «para no contar doble con la fila
`devuelta` vigente», sino que **una reprogramación de escritorio no es una visita**.
La conclusión sobrevive; el razonamiento se reescribe.)*

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

**R18 — El escalado del cron NO incrementa el contador.** *(DESBLOQUEADO por D13.
**NO implementado en 7d9471c3** — ver R34.)*

- (a) CUANDO el cron SLA escala una orden a `rechazada`, el sistema DEBE cambiar el
  estado **sin** que el conteo de intentos de esa orden aumente por causa de ese
  escalado, ni en ese momento ni más tarde.
- (b) SI la gestión sintética creada por el escalado
  (`DevolucionSlaRepository.escalarDevueltaSla`) queda vinculada a un cierre y ese
  cierre se aprueba, ENTONCES el sistema NO DEBE contarla como intento de entrega.
- (c) El sistema DEBE seguir comparando el conteo contra el umbral ANTES de escalar
  (validar y, si ya lo alcanzó, transicionar), sin cambiar la condición de escalado.
- (d) El sistema NO DEBE alterar por esto el ingreso de bodega por rechazo que esa
  gestión sintética genera (R17): **deja de contar como INTENTO, sigue cobrando como
  RECHAZO**. Son dos cosas distintas y solo cambia la primera.

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

**R24 — La deriva de `primer_intento_ok` se DECLARA con fecha de corte.**
*(DESBLOQUEADO por D15. **NO implementado**.)*

- (a) **Sin re-backfill.** El sistema NO DEBE recalcular las filas de
  `analytics_daily` ya escritas con el criterio viejo, y NO DEBE redefinir la
  métrica para que deje de depender del conteo de intentos. El escalón en la serie
  se ASUME.
- (b) **La deriva DEBE quedar declarada por escrito** en la definición de la métrica
  y en los dos servicios que la calculan, de modo que quien lea la serie tropiece
  con el aviso **sin abrir esta especificación**.
- (c) **El corte NO es una fecha de la serie: es el instante del DESPLIEGUE**, y el
  sistema DEBE poder decir, fila a fila, con qué criterio se calculó cada una, sin
  que nadie tenga que recordar ni adivinar esa fecha. SI una fila de una fecha
  anterior al corte se recalcula después del corte, ENTONCES pasa a estar calculada
  con el criterio nuevo, y la declaración DEBE decirlo con esas palabras.
- (d) **La declaración DEBE incluir el efecto INTRADÍA**, ya medido: una entrega
  cuya orden tiene cierres sin aprobar reporta 0 intentos previos, así que el KPI
  **sube durante el día y baja al aprobarse los cierres**. Es una propiedad NUEVA de
  la métrica, no un artefacto de la migración de criterio, y **no desaparece con la
  deriva declarada**.
- (e) **El invariante se mantiene** (R23): el KPI sigue remitiendo al punto único de
  conteo, sin `COUNT` propio, sin umbral propio, sin columna materializada, y
  `primer_intento_ok <= entregas` sigue siendo cierto.

**R35 — La declaración del corte no exige adivinar una fecha.** El sistema DEBE
sostener la trazabilidad del corte sobre un dato que YA se persiste por fila
(`analytics_daily.updated_at`, que la escritura refresca en cada recálculo), y NO
DEBE introducir para ello ninguna columna, tabla ni migración (R27). DONDE haga
falta una etiqueta legible por humanos, el sistema DEBE admitir que se anote **una
sola vez y después del hecho** (el instante real del despliegue), y SI esa anotación
no llega a hacerse, ENTONCES la serie DEBE seguir siendo interpretable fila a fila.

---

## Grupo E — Derogaciones sobre la feature 160

**R25 — `160/R1` queda DEROGADO y reemplazado.** La definición exhaustiva del
intento por destinos de transición («y solo esas») deja de ser cierta. Este
documento la sustituye por R1. No se matiza: se reescribe.

**R26 — `160/R2` queda REFORMULADO.** La conclusión (la reprogramación de la
tienda no cuenta) sobrevive en R12; el razonamiento del doble conteo desaparece
con el criterio viejo y NO DEBE conservarse como justificación en código ni en
tests.

**R27 — `160/R7` se CONSERVA: sin estado persistido nuevo y sin migración.**
*(DESBLOQUEADO por D7.)* El sistema NO DEBE introducir columnas de base de datos,
tablas, enums, índices ni migraciones para sostener este conteo: DEBE seguir
derivándolo en tiempo de lectura de datos que ya existen. Materializar el contador
queda PROHIBIDO en esta feature.

**R28 — La prosa que justifica el criterio se actualiza.** CUANDO el criterio
cambie, el sistema NO DEBE dejar en el código comentarios, listas o descripciones
de métrica que afirmen el criterio viejo. Una lista de familias de origen cuya
única función era decidir intentos NO DEBE sobrevivir sin dueño.

---

## Grupo F — Las decisiones de la segunda ronda, como requisitos

**R29 — Grano por ORDEN (D9).** SI una orden tiene DOS o más gestiones vigentes
que cumplen R1 dentro del MISMO cierre aprobado, ENTONCES el sistema DEBE contar
**un solo** intento por ese cierre, no uno por gestión.

**R30 — Acumulación sobre todos los cierres aprobados (D10).** El sistema DEBE
sumar los intentos de una orden a lo largo de TODOS los cierres `aprobado` en los
que esa orden aparece con un resultado de R1, no solo del más reciente. SI una
orden aparece con resultado contable en N cierres aprobados distintos, ENTONCES su
conteo DEBE ser N.

**R31 — Cuenta el resultado, no el estado actual (D11).** SI entre la gestión y la
aprobación del cierre la orden cambió de estado —reprogramada por la tienda,
liberada por el cron SLA, recuperada a mano por bodega o cualquier otra
transición— ENTONCES el sistema DEBE contar igual ese resultado. El sistema NO DEBE
condicionar el conteo al estado actual de la orden.

**R32 — El contador es MONÓTONO CRECIENTE (D12).** El sistema NO DEBE reportar
para una orden un conteo menor que el que reportó antes. Esto es un CAMBIO
observable respecto del comportamiento vigente, donde deshacer una gestión hacía
BAJAR el número (`160/R5`): tras esta feature, una gestión solo puede contar
cuando ya no es anulable.

**R34 — Solo las gestiones de una VISITA REAL cuentan; las SINTÉTICAS no.**
*(Generaliza R12 y R18-b. **NO implementado en 7d9471c3**.)*

- (a) El sistema DEBE contar como intento únicamente el resultado de una gestión
  originada por la **gestión de un mensajero sobre una orden en reparto**, y NO DEBE
  contar las gestiones sintéticas que otros flujos crean para mover dinero o estado
  —hoy: la del escalado SLA (`escalado_devuelta_sla`) y la de la reprogramación de
  la tienda (`reprogramacion_tienda`)—.
- (b) La distinción DEBE apoyarse en un dato ya persistido, **sin columna nueva y
  sin migración** (R27).
- (c) La distinción DEBE expresarse como lista de **INCLUSIÓN**: una familia futura
  de gestión sintética NO DEBE empezar a contar sola. SI aparece una familia nueva,
  ENTONCES no cuenta hasta que alguien lo decida explícitamente.
- (d) SI el dato que distingue no existiera para una gestión antigua, ENTONCES el
  sistema DEBE optar por NO contarla: contar de menos retrasa el escalado
  (inofensivo); contar de más cobra un rechazo antes de tiempo.

**R33 — `sin_gestionar` NO cuenta, y la limitación queda declarada (D6).** El
sistema NO DEBE contar como intento el corte automático (`en_reparto →
sin_gestionar`) ni su liberación al aprobar (`sin_gestionar → en_bodega_*`), y NO
DEBE contar ninguna orden de un cierre que no tenga un resultado de gestión de los
de R1. **Consecuencia declarada y aceptada:** una orden que sale a reparto, es
cortada por el cron y vuelve a bodega conserva el mismo conteo, y esta feature no
lo cambia (§Limitación declarada).

---

## Trazabilidad R → test

Se completa con rutas reales en `progress/impl_215.md §2` durante la
implementación (T14 de `tasks.md`). El mapa propuesto está en `tasks.md §3`.
Ningún requisito puede quedar sin dueño; el reviewer rechaza si falta uno.

---

## PREGUNTAS CERRADAS (2026-08-13)

Diez de las doce. Cada una con quién la cerró y dónde vive ahora la decisión.

| Q | Respuesta | Quién | Dónde |
| --- | --- | --- | --- |
| **Q3** | El escalado del cron **no incrementa** el contador: la gestión sintética del escalado no cuenta como intento. Sigue cobrando como rechazo. | Humano | **D13**, R18, R34 |
| **Q5** | **Riesgo ACEPTADO**, sin mitigación: «el cierre se cerrará en algún momento por un usuario». | Humano | **D14**, §Supuesto operativo declarado |
| **Q10** | **Deriva DECLARADA con fecha de corte.** Sin re-backfill, sin redefinir la métrica; el escalón de la serie se asume y se escribe donde se lee la métrica. | Humano | **D15**, R24, R35 |
| **Q1** | Se deriva de `gestion_orden` (`cierre_id` + `resultado` + `anulada_at`), SIN migración. `160/R7` se conserva; materializar queda prohibido. | Humano | **D7**, R27 |
| **Q2** | Suma al **APROBAR** el cierre (`cierre_dia.estado = 'aprobado'`). No al crear/solicitar, no al vencer. | Humano | **D8**, R3 |
| **Q6** | `sin_gestionar` NO cuenta. La lista se queda en `rechazada`/`devuelta`/`reprogramada`. | Humano | **D6**, R33 |
| **Q7** | Grano por **ORDEN**: dos gestiones vigentes de la misma orden en el mismo cierre suman 1. | Leader | **D9**, R29 |
| **Q8** | **SÍ acumula** sobre todos los cierres aprobados de la orden. | Leader | **D10**, R30 |
| **Q9** | Aceptado: el corte automático no aporta resultados nuevos y el agujero original **sigue abierto**. Candidato a ficha aparte. | Humano | **D6**, §Limitación declarada, R33 |
| **Q11** | Cuenta el **resultado** ya ocurrido, no dónde está la orden ahora. | Leader | **D11**, R31 |
| **Q12** | **Monotonía creciente declarada** como propiedad, con test. | Leader | **D12**, R32 |

---

## PREGUNTA ABIERTA (1)

**No queda ninguna decisión pendiente.** Lo único que falta es una **medición sin
ejecutar**: la consulta está escrita y lista en `design.md §7.6`.

- **Q4 — Efecto retroactivo.** ⛔ bloquea **R19**. Al ser derivado, cambiar el
  criterio cambia el conteo de TODAS las órdenes históricas de golpe, incluidas las
  que hoy reposan en `devuelta` esperando el SLA. Con D8 el conteo de casi toda
  orden **BAJA** (solo cuentan cierres aprobados) ⇒ el escalado se RETRASA, no se
  adelanta. ¿Se acepta? **La consulta de medición, lista para pegar en una consola
  contra la base real, está escrita en `design.md §7.6`** (solo lectura); falta
  EJECUTARLA y pegar el resultado con fecha.

---

### Nota de proceso

Q11 y Q12 se cerraron como llamadas de juicio del leader (D11/D12) y se
verificaron contra el código antes de escribirlas: ninguna contradice lo medido.
Si al implementar aparece un camino que haga BAJAR el conteo de una orden
—anulación administrativa fuera de la ventana, borrado físico de `gestion_orden`,
o un cierre que salga de `aprobado`— **R32 se rompe y hay que volver a la puerta**,
no parchear el test.

**Tensión declarada de la cuarta ronda (R24-b).** El aviso de la deriva se escribe
donde vive la métrica: el catálogo (`lib/analytics/metrics.ts`) y los dos servicios
que la calculan. **NO llega a la pantalla de analítica**, y es medido, no un olvido:
el texto que se ve sale de `app/(app)/analitica/_components/operativo/catalogo-paneles.ts`
y `textos.ts` —los `descripcion:` del catálogo «no llegan a pantalla»
(`tests/unit/analytics/etiquetas-visibles.guardia.test.ts:32-34`)—, y tocar `app/`
chocaría con R20 y con la guardia de la feature («cero archivos de `app/` o
`components/` en el diff»). Tampoco cabe un `COMMENT ON COLUMN` en
`analytics_daily`: sería una migración y R27 la prohíbe. **Poner el aviso en la
pantalla es candidato a ficha aparte**, no un pendiente de esta.

**Hallazgo de la tercera ronda, del que sale R34.** Al buscar el discriminador que
D13 exige para la gestión sintética del escalado, se encontró que **la misma laguna
afecta a la reprogramación de la tienda** (R12): las DOS gestiones sintéticas del
sistema entran hoy al conteo por la puerta de atrás. Q3 no era un caso aislado; era
la primera mitad de un agujero. El discriminador que resuelve las dos existe y está
en `design.md §3.4`.
