import { ORDER_STATUS_SEED, type OrderStatusValue } from "@/lib/types/order-status";
import type { OrdenHistorialOrigenTipo } from "@/lib/types/orden-historial";

// Feature 140 (design §1/§3) — FUENTE UNICA DE VERDAD de las transiciones legales de
// `order_status` (R1). Dominio PURO: sin Prisma, sin efectos secundarios, sin lecturas de
// entorno. Se indexa por `value` del catalogo (R4), NUNCA por los ids internos: quien valida
// (el choke point `appendCambioEstado`) resuelve `id -> value` antes de preguntar aqui.
//
// El mapa es el INVENTARIO CERRADO del apendice A del design, leido del codigo de `dev`:
// 52 aristas de flujo (numeracion #1-#58 con el #27 RETIRADO por la 139, #4/#6/#7c por la 156,
// #1/#2/#3/#7b por la 155, + #43/#44 de la 154 + #45/#46/#47 de la 149 + #53 y #48-#52/#54-#58
// de la 158) + 2 de creacion. Las 52 colapsan a 50 pares `(origen, destino)` unicos, porque dos
// pares estan declarados dos veces con familias distintas: #19/#23 y #20/#24 (SLA vs.
// recuperacion manual). El tercer duplicado historico (#3/#7b) se fue con el estado de
// fulfillment que retiro la 155.
//
// NUMERACION: la 158 llego en DOS PRs (decision Q-L del humano). El PR 1 (camino del MENSAJERO)
// tomo el #53 y dejo RESERVADOS los #48-#52 y #54-#58 sin declararlos, porque su productor no
// existia todavia: declarar una arista antes que su productor es exactamente el problema que la
// 154 dejo abierto con #43/#44 y que costo el tren 154+155+156. El PR 2 (camino del ADMIN) las
// declara JUNTO A SU PRODUCTOR (`IncidenteAdminRepository`), que es cuando toca.
//
// Aritmetica de la integracion, por si alguien la rehace: `dev` con la 155 dentro queda en 38
// aristas / 36 pares. La 149 suma TRES aristas y sus tres pares son NUEVOS, asi que 38+3=41 y
// 36+3=39. La cuenta vieja de esta rama (45/42) contaba las cuatro aristas del estado de
// fulfillment que la 155 ya retiro.
//
// FEATURE 154 — SOLO ADITIVA (decision Q2 del gate, 2026-07-29). Sumo #43, #44 y la creacion
// `null -> por_recolectar_en_tienda`, sin retirar NINGUNA arista: `GuiaAsignacionService` las
// ejecutaba todavia, y una arista solo puede morir en el mismo commit que su ultimo productor.
//
// FEATURE 156 — RETIRA #4, #6 y #7c, que es justo lo que su recableado deja sin productor:
// "Generar guia" pasa a numerar y mover a la bodega central, y nada mas (ya no asigna
// mensajero -> se va #4; ya no rutea a satelite -> se va #6), y "rutear a bodega satelite"
// pasa a admitir SOLO el origen `en_bodega_central` -> se va #7c. La superviviente es #5
// (`en_preparacion -> en_bodega_central`), destino UNICO de generar guia.
//
// FEATURE 155 — RETIRA la clave del estado de fulfillment con sus cuatro aristas
// (#1/#2/#3/#7b) y las dos entradas de creacion que sobraban (ese mismo estado y
// `en_ruta_bodega_central`). Es la mitad de codigo del retiro del estado; la otra mitad es la
// migracion que reasigna a `en_preparacion` las ordenes vivas. Ese backfill es la condicion que hace que retirar las aristas no atrape a
// nadie: la 156 no podia retirarlas justamente porque todavia habia ordenes ahi.
//
// Feature 149 (design §2, R27): el inventario suma TRES aristas (#45/#46/#47, familia
// `deshacer_asignacion`) y pasa a 41 aristas de flujo / 39 pares unicos. Las tres son pares
// NUEVOS (ninguna repite un par ya declarado), y `por_recoger -> en_bodega_satelite` (#47) deja
// de ser ilegal: era un caso del test de pares ilegales de la 140 y se actualizo a proposito.
// El spec numeraba estas aristas #43/#44/#45; se renumeraron a #45/#46/#47 al integrar `dev`,
// porque la 154 ya habia tomado #43/#44 mientras la 149 iba en su rama.
//
// FEATURE 158 — SOLO ADITIVA en aristas. PR 1 (mensajero): suma #53 (`incidente -> en_reparto`,
// deshacer) y REALINEA el `via` de #44 (`gestion` -> `incidente`) para que el metadato coincida
// con el `origen_tipo` que realmente se persiste (Q-G). PR 2 (admin): suma las CINCO entradas
// desde bodega y transito interno (#48-#52) y sus CINCO inversas de reversion (#54-#58), todas
// con la familia `incidente` que la 154 dio de alta para esto. No retira ninguna arista.
//
// FEATURE 239 (2026-08-19) — la unica de esta lista que RETIRA una arista de gestion. Suma TRES
// (#59 `en_reparto -> devolucion_por_confirmar`, #60 `devolucion_por_confirmar -> devuelta` con
// familia propia `anclaje_devolucion`, #61 `devolucion_por_confirmar -> en_reparto` por deshacer)
// y da de BAJA #14 (`en_reparto -> devuelta`), que pierde su unico productor en el mismo commit.
// Neto: 54 -> 56 aristas de flujo y 52 -> 54 pares unicos (las tres altas son pares NUEVOS y la
// baja era un par unico). Las dos aristas de `recuperacion_manual` desde el pre-estado que el
// spec dejaba condicionadas NO se declaran: P4 se firmo EN CONTRA de la recomendacion.
//
// FEATURE 235 (2026-08-19) — SOLO ADITIVA: suma TRES aristas (#62 `en_reparto -> ayuda_tienda`
// con familia propia `solicitud_ayuda_tienda`; #63 `ayuda_tienda -> en_reparto` con
// `rescate_ayuda_tienda`, el punto UNICO de rescate; #64 `ayuda_tienda -> sin_gestionar` por el
// corte de la noche) y NO da de baja ninguna: pedir ayuda no sustituye a ningun desenlace de
// `en_reparto`, lo anade. Las tres son pares NUEVOS, asi que 56 -> 59 aristas de flujo y 54 -> 57
// pares unicos. Las cifras se RE-DERIVAN en `tests/fixtures/inventario-transiciones-140.ts`, no se
// copian de aqui.
//
// ACTIVACION ESTRICTA (Q7, decision del gate): no hay modo shadow, ni modo solo-log, ni
// feature flag, ni variable de entorno que desactive la guardia. Tampoco existe override
// `ANY -> ANY` para maestro/admin (Q3): el ajuste administrativo generico
// (`OrdenService.actualizar`, `origen_tipo = ajuste_estado`) pasa por el MISMO mapa y sus
// aristas legitimas (#28, #40, #42) estan declaradas explicitamente abajo.

/** Familia de la transicion: reutiliza el enum de origen del historial (23 valores). */
export type FamiliaTransicion = OrdenHistorialOrigenTipo;

/**
 * Una arista del grafo. `via`/`rol` son METADATOS de trazabilidad (R2): documentan quien la
 * dispara y desde que familia, pero NO participan de la decision de legalidad — esta depende
 * SOLO del par `(origen, destino)`.
 */
export interface DestinoTransicion {
  readonly to: OrderStatusValue;
  readonly via: FamiliaTransicion;
  readonly rol: string;
}

/**
 * Mapa `origen -> destinos` (R1). El `satisfies Record<OrderStatusValue, ...>` es el chequeo
 * de EXHAUSTIVIDAD ESTATICA (R5): si el catalogo (`ORDER_STATUS_SEED`) gana un `value` que
 * aqui no queda clasificado, el build ROMPE. Un estado terminal se declara con lista vacia.
 *
 * El numero `#n` de cada arista es el del inventario (apendice A de design.md), para que el
 * diff sea auditable contra la tabla del spec.
 */
export const TRANSICIONES = {
  // --- Estados de entrada (creacion) --------------------------------------------------
  // Feature 156: SALIDA UNICA. `generarGuia` numera y mueve a la bodega central, y nada mas.
  // Se retiraron #4 (`-> por_recoger`: generar guia ya no asigna mensajero), #6 (`->
  // en_ruta_bodega_satelite` via `generacion_guia`: ya no rutea) y #7c (el mismo par via
  // `ruteo_satelite`: `rutearABodegaSatelite` solo admite `en_bodega_central`). Reintroducir
  // cualquiera de las tres reabre el atajo que el flujo v2 cierra: el paquete se asigna y se
  // rutea desde la bodega donde esta fisicamente, no al numerarlo.
  en_preparacion: [
    { to: "en_bodega_central", via: "generacion_guia", rol: "maestro/admin" }, // #5
  ],
  // FEATURE 155: la clave del estado de fulfillment y sus cuatro aristas (#1/#2/#3/#7b)
  // quedaron RETIRADAS junto con el value del catalogo. Las cuatro estaban SIN PRODUCTOR desde
  // la 156, y la 155 cierra el circulo: (i) ninguna orden nace ya ahi —la bifurcacion de
  // creacion manda a `en_preparacion` o a `por_recolectar_en_tienda`— y (ii) la migracion
  // `20260729140000_order_status_retiro_en_fulfillment` reasigna a `en_preparacion` TODAS las
  // ordenes vivas que quedaran en ese estado. Ese backfill es la razon por la que retirarlas
  // AHORA no atrapa a nadie: cuando el codigo nuevo corre, ese conjunto es vacio. Si el orden
  // se invirtiera (retirar aristas sin backfill), esas ordenes se quedarian sin salida legal.
  en_ruta_bodega_central: [
    { to: "devolviendo_a_tienda", via: "cancelacion_api", rol: "apiKey (tienda)" }, // #30
    { to: "en_bodega_central", via: "recepcion_bodega_central", rol: "maestro/admin" }, // #37 (138)
    // #50 (158, camino del ADMIN): el paquete se dana/pierde/roba EN TRANSITO hacia la central.
    // `rol` calcado de la vecina #37, que es quien lo recibiria ahi (`maestro/admin`).
    { to: "incidente", via: "incidente", rol: "maestro/admin" }, // #50 (158)
  ],
  // Feature 154: estado de ESPERA en la tienda. Nace por creacion (esta en ESTADOS_CREACION) y
  // sale hacia la central cuando el mensajero la recolecta. La arista queda DECLARADA y SIN USO
  // hasta la feature 157 (escaner de recoleccion en tienda).
  // Feature 157 (ampliacion 2026-07-31): el estado de ESPERA se parte en dos. Aqui nadie va
  // todavia a por el paquete; en cuanto el maestro decide quien va, la orden pasa a
  // `recolectando` y deja de estar disponible para asignar.
  por_recolectar_en_tienda: [
    { to: "recolectando", via: "asignacion_recoleccion", rol: "maestro/admin" }, // #45 (157)
  ],

  // Alguien va en camino a la tienda. Dos salidas: la recoleccion efectiva (#43, que la 154
  // declaro desde el estado anterior y esta ampliacion mueve aqui, porque solo puede
  // recolectar quien fue asignado) y la reversion, si ese mensajero no puede ir.
  recolectando: [
    { to: "en_ruta_bodega_central", via: "recoleccion_tienda", rol: "mensajero" }, // #43 (154/157)
    { to: "por_recolectar_en_tienda", via: "deshacer_asignacion", rol: "maestro/admin" }, // #46 (157)
  ],

  // --- Bodegas y reparto ---------------------------------------------------------------
  en_bodega_central: [
    { to: "en_ruta_bodega_satelite", via: "ruteo_satelite", rol: "maestro/admin" }, // #7
    { to: "por_recoger", via: "asignacion_bodega", rol: "maestro/admin" }, // #8
    { to: "devolviendo_a_tienda", via: "cancelacion_api", rol: "apiKey (tienda)" }, // #29
    { to: "en_reparto", via: "deshacer_gestion", rol: "mensajero" }, // #34
    // #48 (158, camino del ADMIN): el paquete se dana/pierde/roba EN LA BODEGA CENTRAL. `rol`
    // calcado de las vecinas del MISMO origen (#7 `ruteo_satelite` y #8 `asignacion_bodega`,
    // las dos `maestro/admin`), no inventado.
    { to: "incidente", via: "incidente", rol: "maestro/admin" }, // #48 (158)
  ],
  en_ruta_bodega_satelite: [
    { to: "en_bodega_satelite", via: "recepcion_satelite", rol: "adminSatelite" }, // #10
    // Feature 149 (caso b): deshacer el RUTEO antes de que la satelite reciba el paquete.
    // El paquete sigue bajo custodia de la central, por eso el destino es la central.
    { to: "en_bodega_central", via: "deshacer_asignacion", rol: "maestro/admin" }, // #45 (149)
    // #51 (158): incidente EN TRANSITO hacia la satelite. Forma compuesta del `rol` porque las
    // dos vecinas del origen se reparten el estado: #10 lo recibe el `adminSatelite` y #45 lo
    // deshace `maestro/admin`.
    {
      to: "incidente",
      via: "incidente",
      rol: "maestro/admin/adminSatelite (de la zona)",
    }, // #51 (158)
  ],
  en_bodega_satelite: [
    { to: "por_recoger", via: "asignacion_satelite", rol: "adminSatelite" }, // #9
    { to: "en_reparto", via: "deshacer_gestion", rol: "mensajero" }, // #35
    // #49 (158): incidente EN LA BODEGA SATELITE. La forma compuesta del `rol` es LITERAL de
    // #47 (149) y recoge que quien opera esa bodega es el `adminSatelite` de su zona (#9), sin
    // quitarle el acceso total a maestro/admin.
    {
      to: "incidente",
      via: "incidente",
      rol: "maestro/admin/adminSatelite (de la zona)",
    }, // #49 (158)
  ],
  por_recoger: [
    { to: "en_reparto", via: "recoleccion", rol: "mensajero" }, // #11
    // Feature 149 (caso a): deshacer la asignacion a un mensajero que aun no recogio. El
    // destino se DERIVA del historial (D3) y se normaliza a un estado de BODEGA (D3'): NO se
    // declara ninguna arista hacia `en_preparacion` (R28). El otro estado que esta nota citaba
    // era el de fulfillment, que la 155 RETIRO del catalogo: ya no hay nada que no-declarar.
    // NUMERACION: la 154 aterrizo en `dev` #43/#44 mientras la 149 iba en su rama, asi que las
    // dos aristas del caso (a) se renumeran a #46/#47 (la #45 del caso (b) no colisionaba).
    { to: "en_bodega_central", via: "deshacer_asignacion", rol: "maestro/admin" }, // #46 (149)
    {
      to: "en_bodega_satelite",
      via: "deshacer_asignacion",
      rol: "maestro/admin/adminSatelite (de la zona)",
    }, // #47 (149)
    // #52 (158): la orden ya esta asignada a un mensajero que aun NO la recogio, y el paquete
    // se dana/pierde/roba mientras espera en bodega. `rol` con EXACTAMENTE el mismo string que
    // #47, que es la otra accion administrativa sobre este mismo estado.
    //
    // Q-K (cerrada por el humano): el reporte NO toca `mensajero_asignado_id` ni `asignado_at`.
    // Consecuencia declarada: la orden queda en `incidente` con un mensajero asignado colgando
    // —inocuo, porque `incidente` no la hace elegible para nada— y a cambio la reversion (R60)
    // es trivialmente correcta: no hay asignacion que reponer porque nunca se quito.
    {
      to: "incidente",
      via: "incidente",
      rol: "maestro/admin/adminSatelite (de la zona)",
    }, // #52 (158)
  ],
  en_reparto: [
    { to: "entregada", via: "gestion", rol: "mensajero" }, // #12
    { to: "reprogramada", via: "gestion", rol: "mensajero" }, // #13
    // FEATURE 239 — BAJA de #14 (`en_reparto -> devuelta`) y ALTA de #59
    // (`en_reparto -> devolucion_por_confirmar`). Es la MISMA accion del mensajero con otro
    // destino: gestionar una devolucion ya no deja la orden en `devuelta`, la deja en el
    // pre-estado, y la aprobacion del cierre es la que la ancla (#60). La baja va en el MISMO
    // commit que su ultimo productor —el mapa `ESTATUS_POR_RESULTADO` de
    // `lib/types/gestion-destino.ts`, que ya apunta al pre-estado—, que es la convencion del
    // repo. Reintroducir #14 reabre el cobro prematuro que la 239 cierra.
    { to: "devolucion_por_confirmar", via: "gestion", rol: "mensajero" }, // #59 (239)
    { to: "rechazada", via: "gestion", rol: "mensajero" }, // #15
    { to: "sin_gestionar", via: "corte_sin_gestionar", rol: "sistema/cron" }, // #16
    // #44 (154, con el `via` REALINEADO por la 158/Q-G el 2026-07-30): resultado `incidente`
    // de la gestion. La 154 la declaro con `via: "gestion"` y dejo la familia `incidente` del
    // enum de historial «declarada SIN PRODUCTOR hasta la 158». La 158 ES ese productor: el
    // append de esta transicion escribe `origen_tipo = incidente`
    // (`GestionOrdenRepository.crearGestionYTransicionar`), asi que el metadato tenia que
    // decir lo mismo que la fila que se escribe. El `via` NO participa de la decision de
    // legalidad (:26-35), asi que el cambio es cosmetico — pero un metadato que miente sobre
    // lo que se persiste es peor que no tenerlo.
    { to: "incidente", via: "incidente", rol: "mensajero" }, // #44 (154 / via 158)
    // FEATURE 235 — ALTA de #62. Pedir ayuda a la tienda NO sustituye a ningun desenlace: se
    // AÑADE. `en_reparto` conserva sus seis salidas intactas (contraste con la 239, que si dio de
    // baja #14 porque su productor cambio de destino).
    //
    // El `rol` es `mensajero` y ademas el ASIGNADO, y eso NO se expresa aqui (los metadatos no
    // participan de la legalidad): se expresa ESTRECHANDO LA VENTANA del hilo
    // (`lib/types/ventana-hilo-notas.ts` + `autorizarSobreHilo`), que es la puerta unica de la
    // solicitud. P9, firmada el 2026-08-19: «no una segunda tabla de permisos».
    { to: "ayuda_tienda", via: "solicitud_ayuda_tienda", rol: "mensajero (asignado)" }, // #62 (235)
  ],

  // --- Resultados de gestion -----------------------------------------------------------
  entregada: [
    // TERMINAL (Q1). Conserva UNA salida legitima: deshacer la gestion del dia (#31).
    { to: "en_reparto", via: "deshacer_gestion", rol: "mensajero" }, // #31
  ],
  reprogramada: [
    { to: "en_bodega_central", via: "liberacion_reprogramada", rol: "sistema/cron" }, // #25
    { to: "en_bodega_satelite", via: "liberacion_reprogramada", rol: "sistema/cron" }, // #26
    { to: "en_reparto", via: "deshacer_gestion", rol: "mensajero" }, // #32
  ],
  // FEATURE 239 — el PRE-ESTADO de la devolucion. Tiene ENTRADA (#59, la gestion del mensajero)
  // y SALIDAS (#60/#61), asi que no es terminal ni vestigial (invariante 140/R14).
  //
  // Las DOS salidas declaradas son EXACTAMENTE las que tienen productor en el codigo (R29):
  //   #60 el anclaje al aprobar el cierre — el bloque de `CierresAdminRepository.resolverCierre`;
  //   #61 el deshacer del mensajero — `CierreDiaRepository.anularGestionYDevolverAGestion`, con
  //       su ventana de siempre (`cierre_id IS NULL`). Sin ella el mensajero no podria deshacer
  //       su propia devolucion del dia (R24): eso seria una REGRESION, no una arista opcional.
  //
  // NO tiene arista de `recuperacion_manual` (P4, FIRMADA EN CONTRA de la recomendacion del spec
  // el 2026-08-19, con el precio escrito en `requirements.md`): un satelite que tenga el paquete
  // fisicamente en su estante NO puede registrarlo hasta que el cierre del mensajero se apruebe.
  // Se prefiere que nada se mueva antes de la confirmacion fisica. Si duele en operacion, la via
  // es REABRIR P4, no anadir aqui una puerta trasera «por comodidad».
  devolucion_por_confirmar: [
    { to: "devuelta", via: "anclaje_devolucion", rol: "admin (aprobar cierre)" }, // #60 (239)
    { to: "en_reparto", via: "deshacer_gestion", rol: "mensajero" }, // #61 (239)
  ],
  // FEATURE 235 — el estatus de la SOLICITUD DE AYUDA viva. Tiene ENTRADA (#62) y SALIDAS
  // (#63/#64), asi que no es terminal ni vestigial (invariante 140/R14).
  //
  // Las DOS salidas declaradas son EXACTAMENTE las que tienen productor en el codigo (R12):
  //   #63 el RESCATE — el punto UNICO de escritura (`OrdenRepository.transicionarAyuda`), al que
  //       delegan los DOS llamadores: `SolicitudAyudaService.recuperar` («Recuperar», el
  //       mensajero) y `HabilitarNovedadService.habilitar` («Habilitar», la tienda). Un solo par,
  //       una sola familia, dos puertas.
  //   #64 el CORTE DE LA NOCHE — `CierreDiaRepository.crearCierre`, en su propio bloque guardado
  //       por este estatus de origen, para que el historial registre el origen REAL (R27) y no uno
  //       supuesto.
  //
  // FEATURE 237 (T3.1, R1/R45) — LAS DOS GESTIONES DE LA TIENDA, que llegan CON su productor
  // (`GestionDesdeAyudaService.gestionar` -> `GestionOrdenRepository.crearGestionDesdeAyuda`):
  //   #65 `-> reprogramada` y #66 `-> rechazada`, las dos con `via: "gestion_tienda_ayuda"` y
  //       actor = el adminTienda DUEÑO de la orden. La fila que producen se atribuye al MENSAJERO
  //       (`gestion_orden.mensajero_id`), que es lo que la mete en SU cierre y mueve el dinero
  //       igual; quien la registro lo dice `orden_historial_estado.actor_usuario_id`.
  //
  // ⏳ 2026-08-20 — AQUI DECIA, y ya no es cierto: «`ayuda_tienda -> entregada / reprogramada /
  // devolucion_por_confirmar / rechazada / incidente`: son LAS GESTIONES. Las trae la ficha 237
  // JUNTO A SU PRODUCTOR», y «consecuencia VIVA mientras la 237 no entre: desde aqui solo se sale
  // rescatando o por el corte de la noche». La 237 entro y trajo DOS de las cinco. La nota se
  // reescribe en vez de borrarse porque su razon sigue en pie para las OTRAS TRES.
  //
  // LO QUE **NO** SE DECLARA, y por que importa decirlo:
  //   - `ayuda_tienda -> entregada`, `-> devolucion_por_confirmar` y `-> incidente`: las tres
  //     SIGUEN SIN PRODUCTOR y siguen fuera (237/R1). El diseño firmado de la pila concede a la
  //     tienda EXACTAMENTE dos desenlaces desde ayuda —reprogramar y rechazar— y ninguno mas: la
  //     tienda no puede declarar entregado un paquete que no vio, ni devolver por su cuenta lo que
  //     sigue en la moto del mensajero, ni reportar un incidente que no presencio. Declarar una
  //     arista sin productor es el error que la 154 cometio con #43/#44 y que «costo el tren
  //     154+155+156».
  //   - `ayuda_tienda -> en_bodega_*`: no hay recuperacion manual desde aqui. El paquete esta en
  //     la moto, no en un estante.
  ayuda_tienda: [
    { to: "en_reparto", via: "rescate_ayuda_tienda", rol: "mensajero / adminTienda" }, // #63 (235)
    { to: "sin_gestionar", via: "corte_sin_gestionar", rol: "sistema/cron" }, // #64 (235)
    { to: "reprogramada", via: "gestion_tienda_ayuda", rol: "adminTienda (dueña)" }, // #65 (237)
    { to: "rechazada", via: "gestion_tienda_ayuda", rol: "adminTienda (dueña)" }, // #66 (237)
  ],
  devuelta: [
    { to: "en_bodega_central", via: "liberacion_devuelta_sla", rol: "sistema/cron" }, // #19
    { to: "en_bodega_satelite", via: "liberacion_devuelta_sla", rol: "sistema/cron" }, // #20
    { to: "rechazada", via: "escalado_devuelta_sla", rol: "sistema/cron" }, // #21
    { to: "reprogramada", via: "reprogramacion_tienda", rol: "adminTienda" }, // #22
    // #23/#24 comparten par con #19/#20 y difieren SOLO en familia (accion manual del admin).
    { to: "en_bodega_central", via: "recuperacion_manual", rol: "maestro/admin/adminSatelite" }, // #23
    { to: "en_bodega_satelite", via: "recuperacion_manual", rol: "adminSatelite" }, // #24
    { to: "en_reparto", via: "deshacer_gestion", rol: "mensajero" }, // #36 (defensa filas legadas)
    // FEATURE 239: las SIETE salidas de `devuelta` se conservan INTACTAS. `devuelta` pasa a
    // significar «devolucion ANCLADA» —confirmada en bodega, visible para la tienda y con el
    // reloj corriendo—, y esas siete siguen siendo el camino de las ordenes ya ancladas. Lo que
    // cambia es la ENTRADA: ya no se llega aqui gestionando (#14, retirada), se llega aprobando
    // el cierre (#60).
  ],
  rechazada: [
    { to: "en_reparto", via: "deshacer_gestion", rol: "mensajero" }, // #33
    { to: "por_devolver", via: "devolucion_rechazada", rol: "admin (aprobar cierre; zona satelite)" }, // #38 (139)
    {
      to: "por_devolver_a_tienda",
      via: "devolucion_rechazada",
      rol: "admin (aprobar cierre; zona central)",
    }, // #39 (139)
    // OJO: `rechazada -> devolviendo_a_tienda` (el viejo #27) NO se declara. La feature 139
    // la RETIRO a proposito (su R9): la unica salida de `rechazada` hacia la devolucion es
    // ahora la aprobacion del cierre (#38/#39). Reintroducirla reabre un camino cerrado.
  ],
  sin_gestionar: [
    { to: "en_bodega_central", via: "liberacion_sin_gestionar", rol: "admin (aprobar cierre)" }, // #17
    { to: "en_bodega_satelite", via: "liberacion_sin_gestionar", rol: "admin (aprobar cierre)" }, // #18
  ],

  // --- Flujo de devolucion (137 + 139) -------------------------------------------------
  por_devolver: [
    {
      to: "devolviendo_a_bodega_central",
      via: "ajuste_estado",
      rol: "adminSatelite (de la zona)",
    }, // #40 (139)
  ],
  devolviendo_a_bodega_central: [
    { to: "por_devolver_a_tienda", via: "recepcion_bodega_central", rol: "maestro/admin" }, // #41 (139)
  ],
  por_devolver_a_tienda: [
    { to: "devolviendo_a_tienda", via: "ajuste_estado", rol: "maestro/admin (central)" }, // #42 (139)
  ],
  devolviendo_a_tienda: [
    { to: "devuelta_a_tienda", via: "ajuste_estado", rol: "adminTienda" }, // #28
  ],
  // TERMINAL (Q1): la tienda de origen la recibio; sin salida esperada.
  devuelta_a_tienda: [],
  // TERMINAL (feature 154, decision del humano del 2026-07-29): `incidente` cierra el ciclo de
  // la orden. En el gate de la 154 se planteo un estado `indemnizada` que lo desterminara: se
  // DESCARTO, y la 158 NO lo reabre (no existe, no se declara, no se deja preparado).
  //
  // ⚠️ FEATURE 158 (Q-D, 2026-07-30) — REVERSION PARCIAL, EXPLICITA Y FECHADA de la decision
  // de la 154 de dejar `incidente: []`. Razon textual del humano: «como es una app usada por
  // seres humanos y nosotros solemos cometer errores, lo ideal es que cada accion se pueda
  // deshacer, obviamente dentro de un ambiente controlado». Lo que se revierte es SOLO la via
  // de REVERSION: `incidente` sigue siendo TERMINAL —ningun camino de negocio lo continua ni
  // lo devuelve a bodega— y conserva SOLO salidas de deshacer un error humano dentro de su
  // ventana controlada (la del mensajero, `cierre_id IS NULL`, en `CierreDiaService.
  // deshacerGestion`; la del admin, `estado = 'solicitado'`, en `IncidenteAdminService`).
  //
  // El destino es `en_reparto` porque ES el estado de origen: una gestion solo puede nacer
  // desde `en_reparto` (guardia `cargarOrdenGestionable` de `MisAsignacionesService`), asi que
  // para el camino del MENSAJERO destino = origen, no es un hardcode aproximado (design §13.1).
  //
  // Sigue en ESTADOS_TERMINALES y eso es COMPATIBLE: ese conjunto EXIME de tener salida, no la
  // prohibe (:236-237), y `entregada` es el precedente exacto (terminal Y con su #31).
  //
  // FEATURE 158 — camino del ADMIN (PR 2): a las cinco entradas #48-#52 les corresponden sus
  // CINCO inversas #54-#58, que son la reversion del REPORTE (retracto del autor o rechazo del
  // aprobador, R57-R59). El destino NO se hardcodea: se DERIVA del historial con
  // `findOrigenesReversion` (149) y se valida contra el conjunto CERRADO de los 5 origenes; si
  // no se puede determinar, o cae fuera del conjunto, la reversion se RECHAZA sin mover nada
  // (R58, fallo cerrado). Estas cinco aristas son el mapa de lo que esa derivacion puede
  // producir, no una lista de atajos.
  //
  // POR QUE #53 va con `deshacer_gestion` y #54-#58 con `incidente`: #53 deshace una GESTION
  // (literalmente: `anularGestionYDevolverAGestion` escribe `origen_tipo = deshacer_gestion`),
  // mientras que #54-#58 revierten un REPORTE de incidente, que no es una gestion. Que la
  // familia `incidente` sirva a las dos direcciones no crea ambiguedad: la direccion se lee de
  // `estatus_destino_id` (destino `incidente` = reporte; destino en los 5 origenes = reversion).
  // Precedente de un mismo par declarado dos veces con familias distintas: #19/#23 y #20/#24.
  //
  // `incidente` SIGUE SIENDO TERMINAL: ninguna de estas seis salidas continua el flujo de
  // negocio ni cobra nada — todas deshacen un error humano dentro de su ventana controlada.
  incidente: [
    { to: "en_reparto", via: "deshacer_gestion", rol: "mensajero" }, // #53 (158, Q-D)
    { to: "en_bodega_central", via: "incidente", rol: "maestro/admin" }, // #54 (158, inversa de #48)
    {
      to: "en_bodega_satelite",
      via: "incidente",
      rol: "maestro/admin/adminSatelite (de la zona)",
    }, // #55 (158, inversa de #49)
    { to: "en_ruta_bodega_central", via: "incidente", rol: "maestro/admin" }, // #56 (158, inversa de #50)
    {
      to: "en_ruta_bodega_satelite",
      via: "incidente",
      rol: "maestro/admin/adminSatelite (de la zona)",
    }, // #57 (158, inversa de #51)
    {
      to: "por_recoger",
      via: "incidente",
      rol: "maestro/admin/adminSatelite (de la zona)",
    }, // #58 (158, inversa de #52)
  ],
} as const satisfies Record<OrderStatusValue, readonly DestinoTransicion[]>;

/**
 * Estados en los que una orden puede NACER (destinos validos de `null -> X`, R3/R10). Q5
 * RESUELTA: la creacion SI se valida. Nacer en cualquier otro estado del catalogo es ILEGAL
 * (endurecimiento deliberado de `OrdenService.crear`, que aceptaba un `estatusId` explicito
 * arbitrario; A.3-#8).
 *
 * FEATURE 155 (R22/R31): pasa de 4 a EXACTAMENTE DOS. Ya no hay tres constantes de
 * configuracion que decidan donde nace una orden: hay UNA funcion,
 * `resolverDestinoCreacion(fulfillmentDeLaTienda)` (`lib/services/destino-creacion.ts`), y estos
 * dos values son SUS DOS UNICAS SALIDAS —
 *   - `fulfillment = true`  -> `en_preparacion`            (el paquete ya esta en bodega)
 *   - `fulfillment = false` -> `por_recolectar_en_tienda`  (el paquete sigue en la tienda)
 * Se retiran el estado de fulfillment (que desaparece del catalogo) y `en_ruta_bodega_central`
 * (el estado fijo del canal de API key, `ESTATUS_INICIAL_API`: dejaba la orden viajando sin
 * haber sido recolectada). Ninguna orden puede volver a nacer en ninguno de los dos.
 *
 * `tests/unit/services/destino-creacion.test.ts` verifica la IGUALDAD entre esta lista y el
 * conjunto de estados que la funcion produce: si divergen, cae el test antes que produccion.
 */
export const ESTADOS_CREACION = [
  "en_preparacion",
  "por_recolectar_en_tienda", // feature 154 (declarado) / 155 (producido)
] as const satisfies readonly OrderStatusValue[];

/**
 * Estados TERMINALES (Q1): sin salida esperada en el flujo normal. Exentos de necesitar
 * salida en el invariante de conectividad (R14), pero NO de tener entrada: un terminal
 * inalcanzable tambien es un bug. `entregada` conserva la salida #31 (deshacer gestion), y
 * eso es legal: el test exime, no prohibe.
 *
 * Feature 154 (R16): pasa de 2 a 3 con `incidente`. La 154 lo dejo SIN ninguna salida
 * (decision del humano del 2026-07-29; la idea de un estado `indemnizada` que lo desterminara
 * se descarto — y sigue descartada).
 *
 * Feature 158 (Q-D, 2026-07-30): esa parte se REVIERTE. `incidente` gana su arista de
 * DESHACER (#53, `-> en_reparto`) y por tanto queda igual que `entregada`: TERMINAL y con una
 * salida de reversion. El conjunto NO cambia — `incidente` se queda aqui — porque este test
 * exime de necesitar salida, no la prohibe. La decision de la 154 no se borra: se acota a lo
 * que sigue vigente (no hay continuacion de negocio desde `incidente`).
 *
 * Feature 158, PR 2 (camino del ADMIN): las salidas pasan de 1 a 6 con las cinco inversas
 * #54-#58. El conjunto SIGUE sin cambiar y la razon SIGUE siendo la misma: las seis son
 * reversiones (deshacer un reporte erroneo), ninguna continua el flujo ni mueve dinero. Un
 * `incidente` aprobado —con su egreso ya emitido— NO se revierte por ninguna de ellas (R59).
 */
export const ESTADOS_TERMINALES = [
  "entregada",
  "devuelta_a_tienda",
  "incidente", // feature 154
] as const satisfies readonly OrderStatusValue[];

/**
 * Estados VESTIGIALES declarados (design §8): mecanismo conservado para un estado futuro que
 * naciera sin flujo. Hoy el conjunto esta VACIO (Q2 RESUELTA) y ningun `value` del catalogo
 * queda exento de la cobertura (R16) ni del invariante entrada/salida (R14).
 */
export const ESTADOS_VESTIGIALES = [] as const satisfies readonly OrderStatusValue[];

// Exhaustividad EXPLICITA en la otra direccion (patron `_EnsureExhaustive` de
// `orden-historial.ts`): si el catalogo gana un `value` que el mapa no clasifica,
// `Exclude<...>` deja de ser `never` y el build rompe (R5).
type _EnsureExhaustive = Exclude<OrderStatusValue, keyof typeof TRANSICIONES> extends never
  ? true
  : never;
const _exhaustive: _EnsureExhaustive = true;
void _exhaustive;

/** Error de dominio de transicion ilegal (R12): distinguible por `instanceof`. */
export class TransicionIlegalError extends Error {
  constructor(
    readonly origen: OrderStatusValue | null,
    readonly destino: OrderStatusValue,
  ) {
    // R12: el mensaje SOLO menciona los dos `value` del catalogo. Nunca ids, ordenes,
    // actores, guias ni ningun dato del cliente: no filtra PII ni secretos.
    super(
      origen === null
        ? `transicion ilegal: creacion -> ${destino}`
        : `transicion ilegal: ${origen} -> ${destino}`,
    );
    this.name = "TransicionIlegalError";
  }
}

/**
 * Motivo por el que la guardia NO PUDO decidir la legalidad de una transicion.
 *   - `catalogo_no_disponible`: no se pudo leer `order_status` en la transaccion en curso.
 *   - `estatus_desconocido`: un `id` de la entrada no corresponde a ningun `value` del
 *     catalogo CONOCIDO por este build (drift DB->codigo: la tabla tiene un value que
 *     `ORDER_STATUS_SEED` todavia no lista).
 */
export type MotivoNoValidable = "catalogo_no_disponible" | "estatus_desconocido";

/**
 * Feature 140 (Q7, activacion estricta) — FALLO CERRADO. Si la guardia no puede DEMOSTRAR que
 * una transicion es legal, la RECHAZA: no existe ninguna ruta por la que una entrada llegue al
 * `createMany` sin haber pasado por `assertTransicionValida`.
 *
 * Es un error distinto de `TransicionIlegalError` a proposito: "no pude validar" no es lo
 * mismo que "es ilegal", y separarlos deja el diagnostico claro en la bitacora del incidente
 * (drift catalogo/codigo vs. flujo que intenta una arista inexistente). Mensaje SIN PII: ni
 * ids, ni ordenes, ni actores (R12).
 */
export class TransicionNoValidableError extends Error {
  constructor(
    readonly motivo: MotivoNoValidable,
    /** Lado de la transicion que no resolvio (solo para `estatus_desconocido`). */
    readonly lado: "origen" | "destino" | null = null,
  ) {
    super(
      motivo === "catalogo_no_disponible"
        ? "transicion no validable: el catalogo de estados no esta disponible"
        : `transicion no validable: el catalogo no reconoce el estatus de ${lado ?? "la transicion"}`,
    );
    this.name = "TransicionNoValidableError";
  }
}

// Indices O(1) del camino caliente (R13), construidos UNA vez al cargar el modulo: no hay
// recorridos de arrays ni round-trips por transicion validada.
const DESTINOS_POR_ORIGEN: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Object.entries(TRANSICIONES).map(([origen, destinos]) => [
    origen,
    new Set<string>(destinos.map((d) => d.to)),
  ]),
);
const SET_CREACION: ReadonlySet<string> = new Set<string>(ESTADOS_CREACION);
const SET_CATALOGO: ReadonlySet<string> = new Set<string>(ORDER_STATUS_SEED);

/** `true` si `value` pertenece al catalogo (`ORDER_STATUS_SEED`), estrechando el tipo. */
export function esOrderStatusValue(value: string): value is OrderStatusValue {
  return SET_CATALOGO.has(value);
}

/**
 * R6/R10/R12/R13 — GUARDIA de legalidad. Funcion PURA: no lee DB, no escribe, no registra.
 * Lanza `TransicionIlegalError` si la arista no existe en el mapa.
 *   - `origen === null` (creacion): valida contra `ESTADOS_CREACION` (R10).
 *   - `origen !== null`: valida que exista un destino con ese `to` en `TRANSICIONES[origen]`.
 * `via`/`rol` NO participan de la decision (R2). Comprobacion O(1) por transicion (R13).
 */
export function assertTransicionValida(
  origen: OrderStatusValue | null,
  destino: OrderStatusValue,
): void {
  if (origen === null) {
    if (!SET_CREACION.has(destino)) throw new TransicionIlegalError(null, destino);
    return;
  }
  const destinos = DESTINOS_POR_ORIGEN.get(origen);
  if (destinos === undefined || !destinos.has(destino)) {
    throw new TransicionIlegalError(origen, destino);
  }
}
