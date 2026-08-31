import type {
  GestionResultado,
  OrdenHistorialOrigenTipo as PrismaOrdenHistorialOrigenTipo,
} from "@prisma/client";

// Feature 49 (design §1.2, R23) — fuente unica de verdad de los tipos de ORIGEN de una
// transicion de estado, respaldada por el enum Postgres nativo `orden_historial_origen_tipo`
// (patron METODO_PAGO_SEED / WALLET_*_SEED). Son los 12 call-sites de escritura de
// `orden.estatus_id` (design §2), un valor por familia de transicion.
//   - `satisfies readonly PrismaOrdenHistorialOrigenTipo[]` rompe el build si el SEED lista
//     un valor que el enum Prisma NO tiene.
//   - el chequeo `_EnsureExhaustive` rompe el build si el enum gana un valor que el SEED
//     NO lista (conjunto cerrado de los 12 tipos).
export const ORDEN_HISTORIAL_ORIGEN_TIPO_SEED = [
  "carga_masiva", // feature 15/27: estado inicial en createMany
  // feature 6. PRODUCTOR RETIRADO el 2026-08-07: lo producia `OrdenService.crear` ->
  // `OrdenRepository.create`, borrados por no tener superficie. El valor SE QUEDA porque hay
  // filas historicas que lo apuntan; lo que ya no se puede es generar filas NUEVAS con el.
  // Hoy todas las ordenes nacen por lote (`carga_masiva` / `carga_api`).
  "creacion_manual",
  "generacion_guia", // feature 17/30: generarGuiaLote
  "asignacion_bodega", // feature 17: asignarBodegaLote
  "ruteo_satelite", // feature 30: rutearBodegaSateliteLote
  "recepcion_satelite", // feature 33: recibirEnSatelite
  "asignacion_satelite", // feature 34: asignarSateliteLote
  "recoleccion", // feature 36: recogerLote
  "gestion", // feature 36: crearGestionYTransicionar
  "liberacion_reprogramada", // feature 46: liberarOrden (cron)
  "ajuste_estado", // feature 6: OrdenService.actualizar (CRUD generico)
  "deshacer_gestion", // feature 67 (F1.4-b): CierreDiaRepository.anularGestionYDevolverAGestion
  "carga_api", // feature 88 (D7): estado inicial en createManyOrdenesConGuia (canal integrador)
  "liberacion_devuelta_sla", // feature 99: cron SLA, devuelta -> en_bodega_central/en_bodega_satelite (reintento)
  "escalado_devuelta_sla", // feature 99: cron SLA, devuelta -> rechazada (escalado; enlaza gestion sintetica)
  "reprogramacion_tienda", // feature 100: adminTienda reprograma devuelta -> reprogramada (gestion sintetica reprogramada)
  "recuperacion_manual", // feature 100: bodega recupera devuelta -> en_bodega_central/en_bodega_satelite (accion manual del admin)
  "cancelacion_api", // feature 106: cancelacion por API key (OrdenRepository.cancelarViaApi), en_bodega_central/en_ruta_bodega_central -> devolviendo_a_tienda
  "corte_sin_gestionar", // feature 109: corte diario, en_reparto -> sin_gestionar (actor null/cron). NO enlaza gestion (ver la nota de ORIGEN_TIPOS_CON_GESTION)
  "liberacion_sin_gestionar", // feature 109: al APROBAR el cierre, sin_gestionar -> en_bodega_central/en_bodega_satelite (actor admin). NO enlaza gestion (ver la nota de ORIGEN_TIPOS_CON_GESTION)
  "recepcion_bodega_central", // feature 138: recepcion fisica en bodega central, en_ruta_bodega_central -> en_bodega_central (actor maestro/admin). NO enlaza gestion (ver la nota de ORIGEN_TIPOS_CON_GESTION)
  "devolucion_rechazada", // feature 139: al APROBAR el cierre, rechazada -> por_devolver/por_devolver_a_tienda (actor admin). NO enlaza gestion (ver la nota de ORIGEN_TIPOS_CON_GESTION)
  "recoleccion_tienda", // feature 154: el mensajero recolecta en la tienda, por_recolectar_en_tienda -> en_ruta_bodega_central (#43). SIN PRODUCTOR hasta la 157. NO enlaza gestion (ver la nota de ORIGEN_TIPOS_CON_GESTION)
  "incidente", // feature 154: familia propia del resultado `incidente`. SIN PRODUCTOR hasta la 158 (la arista #44 viaja via `gestion`, decision Q4). NO enlaza gestion (ver la nota de ORIGEN_TIPOS_CON_GESTION)
  "asignacion_recoleccion", // feature 157 (ampliacion): el maestro decide quien va a la tienda, por_recolectar_en_tienda -> recolectando (#45). NO enlaza gestion (ver la nota de ORIGEN_TIPOS_CON_GESTION)
  "deshacer_asignacion", // feature 149: reversion de la asignacion/ruteo ANTES de la recogida (por_recoger -> en_bodega_central/en_bodega_satelite; en_ruta_bodega_satelite -> en_bodega_central; actor maestro/admin/adminSatelite). NO enlaza gestion (ver la nota de ORIGEN_TIPOS_CON_GESTION)
  // Feature 239 (P8, R7): el ANCLAJE de la devolucion. Al APROBAR el cierre,
  // `devolucion_por_confirmar -> devuelta` (actor = el admin que aprueba). Es la transicion que
  // hace visible la devolucion para la tienda Y la que arranca su ventana de SLA: el cron la
  // busca POR ESTA FAMILIA (`DevolucionSlaRepository`), asi que no puede reusar ninguna otra.
  // SI enlaza la gestion ancla (`gestion_orden_id` poblado), y aun asi NO entra en
  // `ORIGEN_TIPOS_CON_GESTION` — mismo caso que `escalado_devuelta_sla`, ver la nota de esa lista.
  // NO entra en `ORIGEN_TIPOS_VISITA_REAL`: es una confirmacion administrativa en bodega, no una
  // visita de calle; contarla subiria los intentos y cobraria antes de tiempo (R16).
  "anclaje_devolucion",
  // Feature 235 (P2, R10) — LA IDA del viaje de la ayuda: `en_reparto -> ayuda_tienda`, disparada
  // por el MENSAJERO ASIGNADO (`SolicitudAyudaService.solicitar`). Familia propia, y no reuso de
  // `ajuste_estado`, porque el historial es la unica evidencia de que hubo una solicitud: sin ella
  // el sentido habria que deducirlo del par de estatus, que es la clase de derivacion que se
  // vuelve falsa en cuanto el grafo gana una arista.
  // NO entra en `ORIGEN_TIPOS_VISITA_REAL` (R11): pedir auxilio NO es una visita fallida — el
  // mensajero sigue en la calle con el paquete y no ha intentado entregar nada. Contarla subiria
  // los intentos, adelantaria el escalado del cron SLA (99) y cobraria el rechazo (56) antes de
  // tiempo. Tampoco en `ORIGEN_TIPOS_CON_GESTION`: su fila nace con `gestion_orden_id` NULO.
  "solicitud_ayuda_tienda",
  // Feature 235 (P2, R10) — LA VUELTA: `ayuda_tienda -> en_reparto`, el RESCATE. Una sola familia
  // aunque la disparen DOS actores (el mensajero con «Recuperar» y la tienda con «Habilitar»),
  // porque el hecho es el mismo y el punto de escritura es UNO (R8); quien lo hizo lo dice
  // `actor_usuario_id`, no la familia.
  // ⚠️ ESTA FAMILIA ES LA CLAVE DE LA EXCEPCION DE WEBHOOK (P4, firmada EN CONTRA de la
  // recomendacion del spec el 2026-08-19): el rescate NO emite evento publico, para que ningun
  // integrador reciba `en_reparto` dos veces sobre la misma orden. La excepcion se aplica por
  // FAMILIA y jamas por estado destino — si se hiciera por estado, se silenciarian los reingresos
  // legitimos (una reprogramada liberada dejaria de avisar) y ESO SI seria una regresion. Ver
  // `lib/types/webhook-eventos.ts`.
  // Mismas dos ausencias que la ida: ni visita real (R11) ni con gestion.
  "rescate_ayuda_tienda",
  // Feature 237 (T1.2, R5) — EL DESENLACE: `ayuda_tienda -> reprogramada | rechazada`, disparado
  // por el ADMINTIENDA DUEÑO de la orden desde la pestaña de ayuda de `/novedades`
  // (`GestionDesdeAyudaService.gestionar` -> `GestionOrdenRepository.crearGestionDesdeAyuda`).
  //
  // ⏳ 2026-08-20: aqui decia «`gestion_tienda_ayuda` NO se declara (P2, firmada): su productor es
  // la ficha 237». Esta es la ficha 237 y este es el commit de su productor, asi que la nota se
  // cumple y se sustituye por el valor. La convencion sigue viva: un valor de enum nace CON su
  // productor (precedente `incidente`, 154, que costo el tren 154+155+156).
  //
  // FAMILIA PROPIA Y NO `gestion` (R4/R5): quien registra es la tienda y quien queda atribuido es
  // el mensajero, asi que son dos hechos distintos. Con `gestion` el historial diria que el acto lo
  // hizo el mensajero, y ese historial es la UNICA evidencia de quien decidio el rechazo que se le
  // cobra a la tienda.
  //
  // ⚠️ SI ENTRA EN `ORIGEN_TIPOS_VISITA_REAL` (R6), al reves que las dos familias de la 235 que
  // tiene justo encima. El argumento completo vive en `specs/237-gestion-tienda-ayuda/design.md`
  // §7.3 y, en corto: `solicitud_ayuda_tienda` y `rescate_ayuda_tienda` son pedir auxilio y
  // retirarlo —el mensajero sigue en la calle y no ha intentado entregar nada—, mientras que esta
  // familia es EL DESENLACE de esa visita, sobre una orden en la que el mensajero no registro
  // ninguno. Contarla es contar UNA visita UNA vez. Y no contradice que `reprogramacion_tienda`
  // quede fuera: aquella se hace sobre una orden que YA tiene una `devuelta` real contada, asi que
  // sumarla produce el doble conteo que 160/R2 evitaba.
  //
  // NO entra en `ORIGEN_TIPOS_CON_GESTION` aunque su fila nazca CON `gestion_orden_id` poblado:
  // mismo caso que `escalado_devuelta_sla` y `anclaje_devolucion` (ver la nota de esa lista).
  "gestion_tienda_ayuda",
  // Feature 240 (T1.3, D8/R6) — EL RECHAZO MANUAL DE LA TIENDA: `devuelta -> rechazada`, decidido
  // por el ADMINTIENDA DUEÑO de la orden desde la card de devolucion de `/novedades`
  // (`RechazoTiendaService.rechazar` -> `GestionOrdenRepository.rechazarDesdeDevuelta`).
  //
  // FAMILIA PROPIA, y las dos alternativas eran mas baratas — por eso se dice que rompen:
  //   - `escalado_devuelta_sla` (99) es el MISMO par origen->destino, asi que la tentacion es
  //     obvia. Pero ese valor ES el predicado de la pestaña «Rechazadas por plazo vencido» (102,
  //     `OrdenRepository`) y de `esRechazoSla`: reusarlo listaria ahi rechazos que no vencieron
  //     ningun plazo y etiquetaria la decision de una persona como un vencimiento del reloj.
  //   - `gestion` atribuiria AL MENSAJERO la decision de la tienda —y esta fila es la unica
  //     evidencia de quien decidio un cobro— ademas de sumar un intento de mas (ver abajo).
  //
  // ⚠️ NO ENTRA EN `ORIGEN_TIPOS_VISITA_REAL` (R19), al reves que `gestion_tienda_ayuda` que tiene
  // justo encima. No es un olvido: el argumento es LITERALMENTE el que ya esta escrito para
  // `reprogramacion_tienda` unas lineas mas arriba — esta transicion se hace sobre una orden que
  // YA TIENE una gestion `devuelta` real contada, asi que sumarla da el DOBLE CONTEO que 160/R2
  // evitaba. Y no contradice a la 237: aquella se hace sobre una orden en la que el mensajero NO
  // registro ningun desenlace, asi que sin ella esa visita no la cuenta nadie; aqui ya esta
  // contada. Quien meta esta familia en esa lista hace que el rechazo manual sume +1 de mas,
  // adelante el escalado del cron (99) sobre OTRAS ordenes y cobre el `cobroRechazado` (56) antes
  // de tiempo, en silencio.
  //
  // NO entra en `ORIGEN_TIPOS_CON_GESTION` aunque su fila nazca CON `gestion_orden_id` poblado:
  // mismo caso que `escalado_devuelta_sla` y `anclaje_devolucion` (ver la nota de esa lista).
  //
  // NO entra en `ORIGENES_SIN_EVENTO_PUBLICO` (R44): el integrador recibe `rechazada` igual que
  // hoy. La unica excepcion por familia sigue siendo el rescate de la 235.
  "rechazo_tienda",
  // Feature 266 (T1.1, D5/R16) — LA HABILITACION POR API KEY: `ayuda_tienda -> en_reparto`, pedida
  // por el INTEGRADOR en un lote del canal por API key
  // (`POST /api/ordenes/api-key/habilitar` -> `ApiHabilitacionService` ->
  // `OrdenRepository.transicionarAyuda`, el punto UNICO de escritura de esa arista que 235/R8
  // exige). Solo la produce la RAMA A del endpoint: cuando la orden esta en `ayuda_tienda` y
  // conserva mensajero asignado, o sea cuando el paquete sigue en la calle. La rama B no
  // transiciona y por tanto no deja fila de historial (deja fila en `orden_habilitacion_api`).
  //
  // FAMILIA PROPIA Y NO REUSO DE `rescate_ayuda_tienda` (design §7, A3, y era la opcion barata: la
  // arista es la MISMA y ya hay una familia para ella). Reusarla borraria la unica distincion
  // entre «el mensajero pulso Recuperar / la tienda pulso Habilitar» y «el integrador habilito por
  // API». Y `actor_usuario_id` NO la recupera: el usuario dedicado de la key ES la tienda
  // (`tienda_id = ownerId`), el MISMO sujeto que el `adminTienda` del boton, asi que las dos vias
  // quedarian indistinguibles fila a fila. Precedente literal: `rechazo_tienda` (240) nacio como
  // familia propia frente a `escalado_devuelta_sla` por este mismo argumento.
  //
  // 💰 ⚠️ NO ENTRA EN `ORIGEN_TIPOS_VISITA_REAL` (R26), y esto NO se «corrige por simetria» con
  // `gestion_tienda_ayuda`, que si esta: habilitar NO es una visita — nadie fue a ninguna puerta,
  // el integrador pulso un endpoint desde su servidor. Esa lista es de INCLUSION justamente para
  // que una familia nueva no empiece a contar sola. Quien meta esta ahi sube el conteo de
  // intentos, adelanta el escalado del cron SLA (99) y dispara el `cobroRechazado` (56) —DINERO
  // REAL cobrado a la tienda— antes de tiempo y en silencio.
  //
  // NO entra en `ORIGEN_TIPOS_CON_GESTION`: su fila nace con `gestion_orden_id` NULO (esta
  // transicion no viene de ninguna gestion), igual que las dos familias de la 235.
  //
  // NO entra en `ORIGENES_SIN_EVENTO_PUBLICO` (R17/R27): esa lista esta VACIA desde la 268 y asi
  // se queda. Consecuencia buscada, afirmada con un test y no asumida: la rama A emite el evento
  // publico de `en_reparto`.
  //
  // Y la nota del integrador NO viaja en el `motivo` de esta fila (D6, firmada): vive SOLO en
  // `orden_habilitacion_api`, para que «todas las habilitaciones de una orden» sea UNA consulta.
  "habilitacion_api",
  // Feature 276 (T2/T9, R22 · Q5 firmada el 2026-08-24) — EL RECHAZO POR AGOTAMIENTO DE INTENTOS:
  // `sin_gestionar -> rechazada`, al APROBAR el cierre, sobre una orden que el corte de la noche
  // barrio y que ya alcanzo el umbral de intentos de entrega. Actor = el admin que aprueba.
  // Productor UNICO: `CierresAdminRepository.resolverCierre`, dentro del bloque
  // `liberacionSinGestionar`, en el MISMO commit que este valor. Absorbe la ficha 218.
  //
  // FAMILIA PROPIA, y las dos alternativas mas baratas se descartan por lo que ROMPEN:
  //   - `escalado_devuelta_sla` (99) es el mismo destino, pero ES el predicado de la pestaña
  //     «Rechazadas por plazo vencido» (102) y de `esRechazoSla`: reusarlo etiquetaria como
  //     vencimiento del reloj algo que es agotamiento de intentos, y lo listaria en esa pantalla.
  //   - `liberacion_sin_gestionar` (109) es la OTRA rama del MISMO bloque —la que si libera— y su
  //     nombre diria «liberacion» sobre la unica orden que precisamente no se libera.
  //
  // ⚠️ NO ENTRA EN `ORIGEN_TIPOS_VISITA_REAL`, y esa ausencia es DINERO. Si entrara, cada rechazo
  // por tope sumaria un intento a su propia orden, adelantaria el escalado del cron SLA (99) sobre
  // otras y cobraria el `cobroRechazado` (56) antes de tiempo. No es una visita: es una decision
  // administrativa sobre una orden que ese dia no visito nadie —ese es justo el hecho que la lleva
  // a `sin_gestionar`—. Mismo argumento que `anclaje_devolucion` (239) y `rechazo_tienda` (240).
  //
  // NO entra en `ORIGEN_TIPOS_CON_GESTION` aunque su fila nazca CON `gestion_orden_id` poblado (la
  // gestion sintetica de R23): esa lista solo desambigua la NULIDAD del enlace (67/R25-R26), mismo
  // caso que `escalado_devuelta_sla`, `anclaje_devolucion` y `rechazo_tienda`.
  //
  // NO entra en `ORIGENES_SIN_EVENTO_PUBLICO`: el integrador recibe `rechazada` igual que hoy.
  "rechazo_tope_intentos",
] as const satisfies readonly PrismaOrdenHistorialOrigenTipo[];

export type OrdenHistorialOrigenTipo = (typeof ORDEN_HISTORIAL_ORIGEN_TIPO_SEED)[number];

/**
 * Feature 215 (T2, R1/R2/R33) — los RESULTADOS de gestion que cuentan como INTENTO DE ENTREGA.
 *
 * Desde la 215 el intento ya NO se deriva de los destinos de las transiciones del historial: se
 * deriva de `gestion_orden` (resultado + cierre APROBADO + vigencia). El predicado que la
 * consume es `whereIntentosVigentes` (`lib/repositories/OrdenHistorialRepository.ts`), punto
 * UNICO del criterio.
 *
 * Es una lista de **INCLUSION**, y eso es un REQUISITO, no un gusto: con una lista negra
 * (`resultado NOT IN (...)`) cualquier `resultado` FUTURO del enum empezaria a contar SOLO,
 * subiria el conteo, adelantaria el escalado del cron SLA (99) y cobraria un `cobroRechazado`
 * (56) antes de tiempo — en silencio, contra la tienda. Con lista blanca, un resultado nuevo NO
 * cuenta hasta que alguien lo decida aqui explicitamente. Contar de menos retrasa el escalado
 * (inofensivo para la tienda); contar de mas es dinero mal cobrado.
 *
 * Que queda FUERA y por que:
 *   - `entregada` e `incidente` (R2): la entrega lograda no es un intento fallido, y el paquete
 *     danado/perdido/robado es un desenlace terminal propio, no una visita mas.
 *   - `sin_gestionar` NO PUEDE entrar (D6/R33) porque **no es un `resultado` de gestion**: una
 *     orden cortada por el cron no tiene fila de `gestion_orden` (el corte solo transiciona
 *     `en_reparto -> sin_gestionar`). Consecuencia DECLARADA y aceptada: el agujero que dio
 *     origen a la ficha —la orden que sale, la corta el cron, vuelve a bodega y sale otra vez
 *     con el mismo contador— **SIGUE ABIERTO** tras esta feature. Cerrarlo es ficha aparte.
 *
 * El `satisfies` rompe el build si un valor deja de existir en el enum `GestionResultado`.
 */
export const RESULTADOS_QUE_CUENTAN_COMO_INTENTO = [
  "rechazada",
  "devuelta",
  "reprogramada",
] as const satisfies readonly GestionResultado[];

export type ResultadoIntentoEntrega = (typeof RESULTADOS_QUE_CUENTAN_COMO_INTENTO)[number];

// Feature 67 (design §4.2, F1.4-a) — FAMILIAS de transicion que enlazan una gestion: una fila
// de historial con uno de estos `origen_tipo` SIEMPRE nace con `gestion_orden_id` poblado
// (`crearGestionYTransicionar` / `anularGestionYDevolverAGestion`, verificado). Fuente unica
// del predicado que desambigua la NULIDAD del enlace `gestion_orden_id`:
//   - `gestion_orden_id IS NULL` + origen FUERA de esta familia = la transicion nunca vino de
//     una gestion (p. ej. `ajuste_estado`) (67/R25).
//   - `gestion_orden_id IS NULL` + origen DENTRO de esta familia = imposible al escribir ->
//     fila HUERFANA: la gestion se borro (67/R26).
// El `satisfies` rompe el build si un valor deja de existir en el enum.
//
// ALCANCE DE ESTA LISTA (feature 215, R28) — leer antes de anadirle un valor:
//
// (a) `ORIGEN_TIPOS_CON_GESTION` existe HOY para UNA sola cosa: desambiguar la NULIDAD del
//     enlace `gestion_orden_id` en las filas del historial (67/R25-R26), como se explica arriba.
//     NO decide intentos de entrega, y no los ha decidido nunca por si sola.
//
// (b) Desde la feature 215, el INTENTO DE ENTREGA **no se deriva de destinos de transicion**.
//     Se deriva de `gestion_orden`: resultado ∈ `RESULTADOS_QUE_CUENTAN_COMO_INTENTO`
//     (en este mismo archivo, mas arriba) + gestion vigente + cierre APROBADO. El punto UNICO del
//     criterio es `whereIntentosVigentes`, en `lib/repositories/OrdenHistorialRepository.ts`.
//     Aqui se retiro el bloque de ~60 lineas que justificaba familia por familia por que cada
//     una quedaba "fuera del criterio de intento": ese razonamiento se apoyaba en el criterio
//     VIEJO (destino `devuelta`, o destino `reprogramada` de familia `gestion`) y ya no es
//     cierto. Quien agregue una familia nueva debe razonar solo sobre (a) —si sus filas nacen
//     con `gestion_orden_id` poblado o no—, no sobre el conteo de intentos.
export const ORIGEN_TIPOS_CON_GESTION = [
  "gestion",
  "deshacer_gestion",
] as const satisfies readonly OrdenHistorialOrigenTipo[];

// Feature 215 (T19, design §3.4, R34-a/R34-c) — familias de historial que nacen de una VISITA
// REAL de un mensajero sobre una orden en reparto. Es la SEXTA condicion del predicado unico de
// intentos (`whereIntentosVigentes`, `lib/repositories/OrdenHistorialRepository.ts`): una gestion
// solo cuenta si alguna de sus filas de `orden_historial_estado` pertenece a una de estas
// familias.
//
// Por que hace falta: el sistema crea gestiones SINTETICAS que no son visitas de nadie y que hoy
// entran al conteo por la puerta de atras, porque nacen con `cierre_id: null` y con el
// `mensajero_id` de la ultima `devuelta` vigente, asi que `CierreDiaRepository.crearCierre` las
// vincula al siguiente cierre de ese mensajero y al aprobarse suman +1:
//   - el escalado del cron SLA (`escalado_devuelta_sla`, `DevolucionSlaRepository`) — R18-b;
//   - la reprogramacion de escritorio de la tienda (`reprogramacion_tienda`,
//     `GestionOrdenRepository.reprogramarDesdeDevuelta`), que ademas, sumada a la `devuelta` real
//     de esa misma orden, produce el DOBLE CONTEO que `160/R2` evitaba — R12. ⏳ FICHA 337
//     (2026-08-31): ESTA YA NO ENTRA A NINGUN CIERRE (`ORIGENES_GESTION_FUERA_DEL_CIERRE`, mas
//     abajo en este archivo), asi que el ejemplo describe el mundo hasta esa fecha. La condicion
//     NO se retira: el escalado del cron sigue entrando, y una lista de inclusion no debe apoyarse
//     en que otro filtro exista.
//
// LISTA DE INCLUSION, jamas de exclusion (R34-c), y no es una preferencia de estilo: con lista
// negra (`none` / `notIn` sobre las sinteticas conocidas), una familia sintetica FUTURA empezaria
// a contar SOLA en cuanto alguien la declarara. Ese conteo de mas subiria el numero, adelantaria
// el escalado del cron SLA (99) a `rechazada` y cobraria un `cobroRechazado` (56, DINERO REAL)
// a la tienda antes de tiempo, en silencio y sin que ningun test rompiera. Con lista de
// inclusion, lo que una familia nueva hace por defecto es NO contar: la direccion segura del
// error (R34-d), porque contar de menos solo retrasa el escalado.
//
// El `satisfies` rompe el build si un valor deja de existir en el SEED (y por tanto en el enum).
export const ORIGEN_TIPOS_VISITA_REAL = [
  "gestion", // feature 36: `crearGestionYTransicionar` — el mensajero gestiono la orden en calle
  // Feature 237 (T2.1, R6) — 2026-08-20. LA TIENDA resuelve desde la pestaña de ayuda
  // (`crearGestionDesdeAyuda`) una orden que el mensajero se llevo a la calle y no supo cerrar.
  // El acto lo registra la tienda, pero LA VISITA LA HIZO EL MENSAJERO y esta fila es su
  // desenlace: por eso cuenta, y cuenta UNA vez (el grano de `contarIntentosVigentes` es el
  // cierre, `groupBy(["cierreId"])`).
  //
  // POR QUE ESTA Y `reprogramacion_tienda` NO — es la objecion obvia y se responde aqui para que
  // nadie la «corrija» en ninguna de las dos direcciones:
  //   - `reprogramacion_tienda` (100) se hace sobre una orden que YA TIENE una gestion `devuelta`
  //     real contada. Sumarla dara el DOBLE CONTEO que 160/R2 evitaba.
  //   - `gestion_tienda_ayuda` se hace sobre una orden en la que el mensajero NO registro ningun
  //     desenlace: pedir ayuda no cuenta (235/R11, y las dos familias de la ayuda estan fuera de
  //     esta lista). Sin ella, esa visita no la cuenta NADIE.
  //
  // Consecuencia BUSCADA, no un efecto lateral: sube el conteo de intentos, adelanta el escalado
  // del cron SLA (99) y con el el `cobroRechazado` (56). Aqui esa direccion es correcta porque es
  // la propia tienda quien decide el desenlace, sabiendo el precio (el aviso de D7 se lo dice).
  "gestion_tienda_ayuda",
] as const satisfies readonly OrdenHistorialOrigenTipo[];

// 💰 FICHA 337 (2026-08-31) — LAS FAMILIAS QUE **NO ENTRAN** AL CIERRE DE NINGUN MENSAJERO.
//
// ESTA LISTA REVOCA UNA DECISION ANTERIOR, y se dice con todas las letras porque el `cierre_id
// NULL` de esas dos vias era DELIBERADO, no un descuido:
//
//   - `100/R10` (`GestionOrdenRepository.reprogramarDesdeDevuelta`): «cierre_id NULL -> entra al
//     proximo cierre pero aporta $0.00».
//   - `240/R18` (`GestionOrdenRepository.rechazarDesdeDevuelta`): «ese NULL es lo que deja que la
//     recoja el SIGUIENTE cierre del mensajero por el mismo mecanismo que vincula las suyas».
//
// **La ficha 337 REVOCA `100/R10` y `240/R18` en su parte de PERTENENCIA AL CIERRE**, con el OK
// explicito del humano fechado el 2026-08-31, tras medirlo contra produccion: **41 gestiones de
// escritorio** (22 `rechazo_tienda` + 19 `reprogramacion_tienda`) dentro de los 6 cierres aun no
// aprobados, y un cierre entero de un mensajero —Andy Cortes— con **5 filas, ninguna suya**. La
// premisa de aquellas dos decisiones era «aporta 0,00, asi que no molesta»; lo medido dice que el
// dano no es de pago sino de ATRIBUCION y de CONTEO: el mensajero firma un documento de trabajo
// que no hizo. Patron de revocacion: `specs/332-eliminar-plantilla-gasto-fijo/design.md` §0.
//
// ⚠️ CONSECUENCIA DE DINERO — SON DOS CONCEPTOS Y HOY VAN POR CAMINOS DISTINTOS. La nota original
// de esta ficha los nombraba como uno solo, y no lo son:
//
//   · **Flete de devolucion + su IVA**, lo que paga la TIENDA (`ingreso_flete_devolucion` y su IVA,
//     de `derivarIngresoOrden`): **YA TIENE VIA PROPIA** desde la segunda mitad de la 337. El
//     rechazo crea un COBRO PENDIENTE (`rechazo_tienda_cobro`) con el importe CONGELADO de la
//     tarifa de ese instante, y un administrador lo aprueba en `/wallet`; solo entonces nacen los
//     apuntes, que son los MISMOS que emitia la aprobacion del cierre.
//   · **`cobroRechazado` / `ingreso_bodega_rechazo`** (56), que es INGRESO DE LA BODEGA y sale de la
//     tarifa zona+vehiculo del mensajero: **SIGUE EN PAUSA**. Se congelaba al crear el cierre del
//     mensajero y lo consume el cierre de BODEGA (40/56); sin cierre no hay congelado que sumar.
//     NO SE PIERDE —la gestion y su `resultado = rechazada` siguen enteros— pero hoy nadie lo
//     emite. Es alcance de otra ficha.
//
// Quien lea esto buscando «dónde se perdio la plata»: no se perdio. La de la tienda tiene ya su
// documento; la de la bodega esta aqui, sin documento que la emita todavia.
//
// ⚠️ `gestion_tienda_ayuda` **SE QUEDA DENTRO** y su ausencia de esta lista es la decision, no un
// olvido (pedido humano textual: «lo que no es ayuda»). La ayuda es trabajo que el mensajero SI
// hizo en la calle —fue a la puerta, no supo cerrar— y la tienda solo lo cerro por el; su gestion
// le pertenece. Quien anada esa familia aqui vacia de trabajo real los cierres de la 237.
//
// ⚠️ TAMPOCO ENTRAN NI `escalado_devuelta_sla` (99) NI `rechazo_tope_intentos` (276), que tambien
// nacen con `cierre_id NULL` sin que el mensajero decida nada. Quedan FUERA DE ESTA FICHA a
// proposito: mueven dinero VIVO por el cierre (el `cobroRechazado` de la 56) y sacarlas sin su via
// de cobro propia pausaria un ingreso que hoy si se emite. Es alcance ajeno, y esta MEDIDO y
// DICHO, no en silencio. El guardia de `tests/unit/guards/origenes-admitidos-en-cierre.guardia.test.ts`
// las mantiene visibles como ADMITIDAS, para que la proxima decision se tome mirandolas.
//
// LISTA DE EXCLUSION, y aqui SI es lo correcto —al reves que `ORIGEN_TIPOS_VISITA_REAL`, que es de
// inclusion por una razon de dinero explicada arriba—. El motivo: la pertenencia al cierre es hoy
// UNIVERSAL (toda gestion con `cierre_id IS NULL` del mensajero entra), y una lista blanca aqui
// dejaria fuera EN SILENCIO a `escalado_devuelta_sla`, `rechazo_tope_intentos` y a cualquier
// familia futura de calle —gestiones que el mensajero SI trabajo y que dejarian de pagarse—. La
// direccion segura del error en ESTE predicado es «ante la duda, entra». Lo que impide que una
// familia nueva se cuele sin decidirlo NO es la polaridad de la lista: es el guardia del conjunto
// CERRADO citado arriba, que enrojece en cuanto el enum gana un valor.
export const ORIGENES_GESTION_FUERA_DEL_CIERRE = [
  // Feature 240: la tienda rechaza a mano una devolucion ya anclada (`devuelta -> rechazada`).
  // 22 de las 41 filas medidas. Es la que deja el cobro EN PAUSA (ver arriba).
  "rechazo_tienda",
  // Feature 100: la tienda reprograma desde novedades una orden ya devuelta
  // (`devuelta -> reprogramada`). 19 de las 41 filas medidas. Money-neutral: una `reprogramada`
  // no emite ningun concepto, asi que sacarla no pausa ningun cobro.
  "reprogramacion_tienda",
] as const satisfies readonly OrdenHistorialOrigenTipo[];

// Feature 215 (T4, R13/R28): aqui vivia `ORIGEN_TIPOS_REPROGRAMADA_INTENTO`, la lista blanca de
// familias que, con destino `reprogramada`, contaban como intento. Se RETIRA: su unica funcion
// era el criterio viejo, que la 215 sustituye. Dejarla habria sido un segundo derivador legado
// —un incumplimiento de R6 ("no admitir una segunda definicion de intento"), no una
// compatibilidad—. La lista de INCLUSION vigente es `RESULTADOS_QUE_CUENTAN_COMO_INTENTO`
// (en este mismo archivo, mas arriba).

// Exhaustividad frente al enum Prisma: si `OrdenHistorialOrigenTipo` gana un valor que no
// esta en el SEED, `Exclude<...>` deja de ser `never` y el build rompe.
type _EnsureExhaustive = Exclude<
  PrismaOrdenHistorialOrigenTipo,
  OrdenHistorialOrigenTipo
> extends never
  ? true
  : never;
const _exhaustive: _EnsureExhaustive = true;
void _exhaustive;

// Feature 49 (design §4.4) — DTO de UNA TRANSICION de la linea de tiempo, ya resuelta a
// valores legibles (no UUIDs internos): `estatusOrigenValue` NULL = creacion (R1/R20);
// `actorNombre` NULL = sistema/cron (R21); `motivo` NULL cuando la transicion no viene de
// una gestion con motivo (R22). Ordenadas cronologicamente por el service (R26).
//
// FEATURE 262 (B24, design §14.1): gana el discriminante `clase: "transicion"`. Los seis campos
// de siempre NO cambian, y `estatusDestinoValue` SIGUE SIENDO `string` NOT NULL: una transicion
// siempre tiene destino.
export interface OrdenHistorialTransicionDTO {
  clase: "transicion";
  estatusOrigenValue: string | null;
  estatusDestinoValue: string;
  origenTipo: OrdenHistorialOrigenTipo;
  actorNombre: string | null;
  motivo: string | null;
  createdAt: Date;
}

/**
 * FEATURE 262 (B24, design §14.1) — una CORRECCION DEL DIA DE REPARTO
 * (`orden_dia_reparto_cambio`). NO TIENE ESTADO DE ORIGEN NI DE DESTINO, porque no es una
 * transicion: la corrección tiene PROHIBIDO escribir en `orden_historial_estado` (R25) y el choke
 * point de estados ni siquiera aceptaria un `por_recoger -> por_recoger`.
 *
 * LAS DOS FECHAS VIAJAN COMO `YYYY-MM-DD` YA SERIALIZADO, JAMAS COMO `Date`. Precedente literal:
 * `MisAsignacionesService.ts` hace `fechaRepartoComoTexto(row.fechaReparto)` por esto mismo
 * (261/R14). Un `@db.Date` leido por Prisma es la medianoche UTC de esa fecha; formatearlo en el
 * navegador con la hora local devuelve el dia ANTERIOR en media America.
 *
 * `actorNombre` y `motivo` son NOT NULL, al reves que en la transicion: aqui nunca escribe un cron
 * (§5.1: la columna `actor_usuario_id` es NOT NULL) y el motivo es obligatorio (R21).
 *
 * NO TIENE `origenTipo` A PROPOSITO: `OrdenHistorialOrigenTipo` es el censo cerrado de las familias
 * de ESCRITURA DE `orden.estatus_id`, respaldado por un enum de Postgres. Añadirle un valor para
 * algo que no escribe ningun estado seria una migracion mas y una mentira sobre la maquina de
 * estados. La `clase` ya dice lo que hace falta saber.
 */
export interface OrdenHistorialCorreccionDiaDTO {
  clase: "correccion_dia";
  /** `YYYY-MM-DD` — el dia que la orden TENIA. */
  fechaAnteriorISO: string;
  /** `YYYY-MM-DD` — el dia con el que QUEDO. */
  fechaNuevaISO: string;
  actorNombre: string;
  motivo: string;
  createdAt: Date;
}

/**
 * UNA entrada de la linea de tiempo: o una transicion de estado, o una correccion del dia de
 * reparto. UNION DISCRIMINADA por `clase`, y el discriminante es EXPLICITO y no derivado por
 * presencia de campo: con `clase` el `switch` es exhaustivo y TypeScript lo demuestra; con
 * `"fechaNuevaISO" in entrada` una tercera clase futura caeria en el `else` en silencio.
 *
 * EL NOMBRE SE CONSERVA a proposito (design §14.1, punto 1): `ObtenerHistorialServiceResult` lo
 * nombra y `tests/unit/guards/rastreo-frontera.guardia.test.ts` lo tiene en su lista de simbolos
 * PROHIBIDOS en el borde publico. Renombrarlo dejaria esa guardia vigilando un simbolo muerto —
 * verde para siempre y sin decir nada.
 */
export type OrdenHistorialEntradaDTO =
  | OrdenHistorialTransicionDTO
  | OrdenHistorialCorreccionDiaDTO;
