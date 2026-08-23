import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { MetodoPago } from "@/lib/types/metodo-pago";
import type { CausaDevolucion } from "@/lib/types/causa-devolucion";
import type { CausaIncidente } from "@/lib/types/causa-incidente";
import type { GestionUbicacionAusenciaValue } from "@/lib/types/gestion-orden";
import type { LineaPago } from "@/lib/utils/pagos-recaudo";

// Feature 36 — contrato del servicio del flujo del mensajero: listar mis
// asignaciones, recoger (una o varias), escoger una para gestionar (bloqueo
// 1-a-1) y gestionar (4 resultados). Logica de negocio pura (sin HTTP ni Prisma);
// el borde (Server Action) la traduce a resultado tipado.

// DTO de una asignacion con el detalle completo para la UI (R11). Los nombres ya
// resueltos (no IDs de catalogo); `montoCobrar` serializado a number|null.
export interface MiAsignacionDTO {
  id: string;
  numGuia: number | null;
  numRemision: string;
  estatusValue: string;
  destinatario: string;
  telefonoDest: string;
  direccion: string | null;
  producto: string;
  peso: number | null;
  montoCobrar: number | null;
  /** Feature 97: coordenadas geocodificadas de la parada (feature 91). `null` si aun no se geocodifico. Para dibujar el mapa de ruta. */
  latitud: number | null;
  longitud: number | null;
  notas: string | null;
  tiendaNombre: string;
  zonaNombre: string;
  provinciaNombre: string;
  cantonNombre: string;
  distritoNombre: string | null;
  /**
   * Feature 92 (R28): posicion 1-based de esta orden en la ruta optimizada del mensajero.
   * `null` = la orden entro a la ruta DESPUES de la ultima optimizacion y todavia no tiene
   * posicion (se muestra al final, marcada como pendiente de optimizar).
   *
   * Siempre `null` en las ordenes de "Por recoger": no estan en reparto, no son paradas.
   */
  secuenciaRuta: number | null;
  /**
   * Feature 115 (R17): marca PRIVADA "gestionar mas tarde" del mensajero actual sobre esta
   * orden. `true` si el propio actor la marco (`false` cuando no existe fila para la pareja,
   * R17). Solo informativa: no cambia el estatus ni la ruta de la orden (R15/R16).
   *
   * Opcional (`?`) por el patron aditivo ya usado por `OrdenDTO.mensajeroAsignadoId?`/
   * `prioridad?`: no rompe los fixtures que construyen `MiAsignacionDTO` sin el; `toDTO`
   * SIEMPRE lo envia (boolean, `false` por defecto). La UI del mensajero (feature 115/T8) lo
   * consume para el badge y el reordenado de presentacion.
   */
  marcarLuego?: boolean;
  // Feature 227 (R21): aqui vivia `notaPrivada?` (feature 116). El campo se RETIRO junto con la
  // columna `orden_mensajero_meta.nota`: el DTO ya no emite ninguna nota privada del mensajero y
  // ninguna card pinta indicador de ella. La conversacion sobre la orden vive ahora en
  // `orden_nota` y NO viaja en este DTO: se carga bajo demanda con su propia accion, porque
  // meterla en un listado paginado seria un N+1 (design §4/§5.2).
  /**
   * Feature 160 (R11/R14/R16/R24) + 215 (R6/R20): intentos de entrega de la orden, resueltos en
   * el MISMO lote de la lectura con el criterio UNICO de `OrdenHistorialService`. Desde la 215
   * ese criterio es el numero de CIERRES APROBADOS distintos en los que la orden tuvo un
   * resultado de gestion vigente `rechazada`/`devuelta`/`reprogramada`; ya no se deriva de los
   * destinos de las transiciones del historial.
   *
   * Opcional (`?`) por el mismo patron aditivo que `marcarLuego?`: no rompe los
   * fixtures que construyen `MiAsignacionDTO` sin el; el servicio SIEMPRE lo envia, `0`
   * incluido (R14). La UI del mensajero lo pinta con `?? 0` como un dato mas de la orden (R19).
   */
  intentosEntrega?: number;
  /**
   * Feature 157 (R15): telefono de la TIENDA dueña de la orden, para que el mensajero pueda
   * llamarla o escribirle antes de ir a recolectar. Distinto de `telefonoDest` (el del
   * destinatario final). El modelo no tiene direccion de la tienda, asi que el contacto es lo
   * unico que se puede ofrecer para llegar a ella (pregunta abierta 2 de requirements.md).
   *
   * Opcional (`?`) por el mismo patron aditivo que `marcarLuego?`: no rompe los
   * fixtures que construyen `MiAsignacionDTO` sin el; el repo SIEMPRE lo emite (`null` cuando
   * la tienda no tiene telefono registrado).
   *
   * DEUDA DECLARADA (feature 167, P1). Este campo entro con la 157 EXCLUSIVAMENTE para el panel
   * de recoleccion que vivia dentro de Entregas. La 167 retiro ese panel (R33), asi que hoy
   * NINGUN consumidor de Entregas lee este campo: el apartado de recoleccion usa su propio
   * `RecoleccionOrdenDTO`. No se retira porque `design.md §2.3` no lo lista entre las retiradas y
   * hacerlo tocaria fixtures de varios tests de Entregas, ampliando el alcance sin que nadie lo
   * pidiera (decision del leader, 2026-07-31). OJO: el campo homonimo de `MiAsignacionRow` SI
   * sigue siendo necesario — de ahi lo lee `listarRecoleccion` para construir su DTO.
   */
  tiendaTelefono?: string | null;
  /**
   * Feature 246 (T5.1, R22/R25/R26) — `true` si esta orden esta RESERVADA para un dia POSTERIOR
   * al dia de Costa Rica en curso. Es lo que la card pinta con palabras («Para mañana»).
   *
   * BOOLEAN DERIVADO EN EL SERVIDOR, NO LA FECHA CRUDA (R26). El cliente no vuelve a decidir que
   * dia es hoy: es el mismo criterio con el que este DTO saca `estatusValue` resuelto en vez de
   * dejar que el navegador interprete un id de catalogo. Un portatil con la hora corrida no puede
   * etiquetar mal una orden.
   *
   * R25 — CADUCA SOLA: al llegar el dia reservado, la MISMA fila pasa a `false` sin que nadie
   * ejecute ninguna accion y sin que se escriba nada en la base. No hay marca que apagar, que es
   * la misma propiedad que hace segura a la columna (D2).
   *
   * ⛔ DECISION D5 (246) — ADOPTADA el 2026-08-20, REVERTIDA el 2026-08-21. SUPERSEDIDA por
   * `specs/261-dia-reparto-protege`.
   *
   * Lo que aqui se afirmaba —y con autoridad— era R24: que la marca no bloqueaba nada, que la
   * orden se trabajaba igual y que la reserva era una defensa SOLO frente al corte nocturno. Ya
   * NO es cierto, asi que no se deja escrito como si lo fuera. El texto original de aquella
   * decision se conserva INTACTO donde le corresponde, en el spec que la firmo
   * (`specs/246-asignacion-por-dia/requirements.md`, §D5), con su apendice fechado al pie: un
   * spec es la foto de su momento; un contrato describe lo que el sistema hace HOY.
   *
   * MOTIVO DE LA REVERSION: D5 se apoyaba en la medicion **M3** («nadie carga la furgoneta
   * despues de las 18:00»), y M3 quedo REFUTADA por una prueba humana en PRODUCCION: la guia
   * **17496963** se gestiono `entregada` a las 22:10 CR del 21 estando reservada para el 22.
   * Deshacer esa misma gestion, ocho minutos despues, bajo `fecha_reparto` de 2026-08-22 a
   * 2026-08-21 en silencio. La etiqueta viajaba en este DTO y ninguna capa la consultaba para
   * decidir: era una ETIQUETA, no una puerta.
   *
   * LO QUE VALE HOY: la reserva protege del CRON **Y** del mensajero. Una orden reservada para
   * un dia posterior al de Costa Rica en curso NO se puede recoger (R1), NI escoger para gestion
   * (R3), NI gestionar (R2) — ni por el mensajero ni por la tienda desde la pestaña de ayuda
   * (R28). Lo que NO cambia es R23: la orden sigue **visible, en su grupo de siempre**; lo que se
   * restringe es la ACCION, no la visibilidad (R9).
   *
   * RIESGO CERRADO EL 2026-08-22 (261/R33 -> 262/R34). Sigue escrito aqui, y no borrado, porque
   * este es el sitio donde se decide el bloqueo: quien venga a entender por que una orden
   * reservada no se puede trabajar tiene que leer en el mismo sitio que hay una salida.
   *
   * LO QUE HOY ES CIERTO: YA EXISTE UNA SUPERFICIE para corregir el dia de reparto de una orden
   * ya asignada. Es una accion por lote en las DOS pantallas donde tambien se elige el dia al
   * asignar — `/ordenes` (maestro/admin, cualquier zona) y `/recepcion-satelite` (adminSatelite,
   * su zona) —, exige un motivo escrito y deja rastro de quien la hizo, cuando, desde que dia y
   * hasta que dia. Ficha: `specs/262-corregir-dia-reparto`. Si alguien retirara esa superficie
   * «porque no la usa nadie», el agujero que se describe justo abajo volveria entero.
   *
   * POR QUE EL RIESGO SE ACEPTO, Y NO SE BORRA DE AQUI. El humano lo acepto el 2026-08-22 a
   * sabiendas: la 261 (`specs/261-dia-reparto-protege`) cerro el bloqueo ANTES de que existiera
   * la salida, porque con D5 vigente el escape era el propio mensajero y dejar la puerta abierta
   * era peor que el hueco. Mientras duro, un lote marcado para el dia equivocado quedaba
   * inalcanzable para TODO EL MUNDO —ni bodega, ni el maestro, ni el admin, ni el mensajero, ni
   * la tienda— hasta que llegara ese dia, y la unica salida FUE un `UPDATE` a mano en produccion,
   * como el que hubo que hacer el 2026-08-21 con la guia 17496963. Se dice en PASADO porque ya no
   * es asi; se dice, y no se calla, porque paso.
   *
   * Opcional (`?`) por el patron aditivo de `marcarLuego?`/`intentosEntrega?`: no rompe los
   * fixtures que construyen `MiAsignacionDTO` sin el; el servicio SIEMPRE lo envia.
   */
  esParaManana?: boolean;
  /**
   * Feature 261 (B1/B4, R11/R14) — el DIA DE REPARTO como fecha calendario `YYYY-MM-DD`, YA
   * RESUELTA EN EL SERVIDOR con el dia de Costa Rica. `null` = la orden no tiene dia de reparto.
   *
   * Existe para que la card pueda decir QUE DIA sin construir un `Date` en el navegador: leer
   * `YYYY-MM-DD` con el reloj del cliente es exactamente la puerta que R14 cierra. Se pone en
   * palabras con `avisoReservaParaOtroDia` (`lib/utils/dia-reparto-textos.ts`), que no importa
   * `Date` ni `Intl`.
   *
   * `esParaManana` se conserva intacto y sigue siendo el booleano derivado (246/R26): este campo
   * NO lo sustituye, lo acompaña.
   */
  fechaRepartoISO?: string | null;
  // Feature 235 (T6.1, R40): aqui vivia `ayuda?: boolean`, la bandera de la ORDEN. Se retira con
  // la columna. Quien quiera saber si hay una solicitud de ayuda viva mira `estatusValue`, que ya
  // viaja mas arriba en este mismo DTO: es `ayuda_tienda` o no lo es. Una verdad, no dos.
}

/**
 * Feature 92 (R27/R28/R30) — estado de la ruta optimizada del mensajero, que acompana al
 * listado. Es el bloque que la UI (feature 93) necesita para decidir si muestra el aviso
 * de "el orden no esta actualizado" y desde que clase de punto se calculo la ruta.
 */
export interface RutaResumenDTO {
  /**
   * `desactualizada` = la ultima llamada al proveedor fallo y lo que se muestra es el
   * ULTIMO ORDEN VALIDO conservado (R27), no un orden recien calculado. NUNCA significa
   * "se cayo a createdAt desc": eso no ocurre jamas.
   */
  estado: "vigente" | "desactualizada";
  /** Instante de la ultima optimizacion exitosa. `null` = nunca se calculo. */
  calculadaAt: Date | null;
  /**
   * Desde que clase de punto se calculo (R24). `centroide` y `ultima_conocida` significan
   * que el punto de partida es aproximado y la UI debe poder decirlo.
   */
  origenFuente: "gps" | "ultima_conocida" | "centroide" | null;
  /**
   * Feature 265 (R35/R38/R45) — QUIEN ordeno las paradas: el proveedor o el calculo local.
   * Es una señal DISTINTA de `origenFuente` y no se puede fundir con ella: una dice DESDE
   * DONDE se calculo la ruta y esta dice QUIEN decidio el ORDEN. Pueden darse a la vez.
   *
   * `null` = NO CONSTA (ruta calculada antes de esta feature, o 0/1 parada). La pantalla no
   * muestra aviso NI afirma que el orden vino del proveedor: no consta es no consta.
   */
  secuenciaFuente: "proveedor" | "local" | null;
  /** R28: cuantas ordenes en reparto NO tienen posicion todavia. */
  paradasSinOptimizar: number;
  /**
   * Trazado PERSISTIDO de la ruta vigente, para que el mapa pinte la geometria real ya en
   * el primer render — sin esperar a que el mensajero pulse "Sincronizar". Antes de la
   * migracion `20260814120000_ruta_optimizada_trazado` esto no existia y cada F5 devolvia
   * el mapa a la linea recta.
   *
   * `null` si nunca se dibujo, si la secuencia se reemplazo despues (la DB lo limpia en la
   * misma transaccion) o si el ultimo dibujo salio del fallback local, que no se cachea.
   */
  trazado: {
    encodedPolyline: string;
    distanciaM: number | null;
    duracionS: number | null;
    fuente: "routes" | "local";
  } | null;
  /**
   * Tramo que lleva a la SIGUIENTE parada: la primera de `porGestionar`, que ya viene ordenado
   * por secuencia. Es el trozo del recorrido que el mensajero tiene delante ahora mismo, y la
   * UI lo resalta sobre el resto de la linea.
   *
   * NO CUESTA UNA LLAMADA APARTE: sale de los `legs` que Google devuelve en la misma respuesta
   * del trazado. `null` mientras no se haya dibujado la ruta, si el dibujo salio del fallback
   * local (que no produce tramos) o si no queda ninguna parada por gestionar.
   */
  tramoSiguiente: {
    encodedPolyline: string;
    distanciaM: number | null;
    duracionS: number | null;
  } | null;
}

// Feature 61: KPIs del portal del mensajero, calculados SERVER-SIDE (autoritativos).
export interface MisAsignacionesKpis {
  /** # de ordenes en `en_reparto` (aceptadas/recogidas, en camino). */
  pendientes: number;
  /** # de ordenes `entregada` del mensajero. */
  entregadas: number;
  /** Suma de `montoCobrar` (COD) de las ordenes en `en_reparto`; null cuenta 0. */
  porCobrar: number;
  /**
   * Total a cobrar ACUMULADO: COD de las ordenes `en_reparto` + `entregada`. No baja al
   * ENTREGAR (la orden sale de reparto pero sigue sumando como entregada); se descuenta
   * cuando se gestiona como reprogramada/devuelta/rechazada (no entra en ningun set).
   */
  totalACobrar: number;
}

// R9/R10/R20: dos grupos separados (por recoger vs por gestionar) + el puntero de
// bloqueo del actor (para que la UI marque la orden activa y bloquee las demas).
// Feature 61: + `kpis` para la fila de indicadores del portal.
//
// Feature 167 (R34): la recoleccion en tienda tiene contrato propio (`ListarRecoleccionResult`) y
// service propio; este contrato NO transporta ordenes en estado de recoleccion. La ausencia es el
// requisito: lo que no viaja por aqui no puede reaparecer en los KPIs, en el mapa ni en el corte
// del dia.
//
// FEATURE 235 (T3.1, R18) - PASA DE DOS GRUPOS A TRES, y el corte SUBE AL SERVIDOR. Hasta el
// 2026-08-19 el portal recibia DOS listas y partia la de reparto EN EL CLIENTE, con un `useMemo`
// de `RepartoModule` sobre `orden.ayuda`: la orden con ayuda pedida seguia en `porGestionar`, o
// sea seguia siendo parada del mapa, contacto del chat, candidata de `TrayectoVivoButton` y
// gestionable. La separacion era MAQUETACION. R18 exige que llegue ya partida desde el servidor,
// y `conAyuda` es esa tercera lista.
//
// El ensanche del corte de la 167/R34 (de dos estatus leidos a tres) es DELIBERADO y entra por la
// puerta: `recolectando` SIGUE FUERA, que es lo que aquella feature aislo. Lo congela la guardia
// `hilo-ventana-alcanzable.guardia.test.ts` con un censo cerrado, actualizado con nota fechada.
export type ListarMisAsignacionesServiceResult =
  | {
      status: "ok";
      /**
       * R29: "Por recoger" CONSERVA su orden actual (`createdAt desc`). Esta feature NO lo
       * toca: esas ordenes aun no son paradas de ninguna ruta.
       */
      porRecoger: MiAsignacionDTO[];
      /**
       * R28: sale YA ORDENADO del service — primero las que tienen posicion, por
       * `secuencia` asc; despues las que no la tienen, conservando su `createdAt desc`.
       */
      porGestionar: MiAsignacionDTO[];
      /**
       * Feature 235 (R18/R19): las ordenes en `ayuda_tienda` del actor, YA SEPARADAS AQUI. No son
       * paradas de la ruta (R14/R15) ni gestionables (R16), pero SIGUEN VIENDOSE en su apartado
       * propio con su accion de rescate (R19) y SIGUEN CONTANDO en los KPIs del dia (R20): el
       * paquete sigue en la moto del mensajero y su COD sigue por cobrar.
       *
       * NO viene ordenada por secuencia de ruta ni la lleva: una orden detenida esperando a la
       * tienda no tiene posicion en ninguna ruta optimizada.
       */
      conAyuda: MiAsignacionDTO[];
      ordenEnGestionId: string | null;
      kpis: MisAsignacionesKpis;
      /** Feature 92 (R27/R28/R30): estado de la ruta que produjo ese orden. */
      ruta: RutaResumenDTO;
    }
  | { status: "forbidden" };

/**
 * Feature 92 (R22/R23): ubicacion capturada por la geolocalizacion del navegador. SIEMPRE
 * OPCIONAL — R25 es explicito: la denegacion del permiso NUNCA bloquea la accion, solo
 * hace que el origen de la ruta caiga al siguiente escalon (R24).
 */
export interface UbicacionInput {
  lat: number;
  lng: number;
}

// R16: recoger recibe un conjunto de ids (soporta "recoger todas" y de a una).
export interface RecogerInput {
  ordenIds: string[];
  /** Feature 92/R22: opcional; ausente = el navegador no la dio o la denegaron. */
  ubicacion?: UbicacionInput;
}

// R17/R29: motivo por orden cuando una no puede recogerse (borrada, origen
// invalido). El service ABORTA sin efectos.
export interface DetalleConflicto {
  ordenId: string;
  motivo: string;
  /**
   * Feature 261 (B1/B4, design §4) — CODIGO DE MAQUINA del rechazo, para que la UI no tenga que
   * leer prosa. Hoy `motivo` mezcla texto humano («orden borrada») con jerga («estado de origen
   * no permitido: en_bodega_central»), asi que una pantalla que quisiera distinguir un caso
   * tendria que comparar cadenas.
   *
   * Aditivo y opcional a proposito: los rechazos que ya existian NO lo emiten y nadie tiene que
   * inventarles uno. Hoy el unico valor es el de la reserva.
   */
  codigo?: "reservada_para_otro_dia";
}

export type RecogerServiceResult =
  | { status: "ok"; recogidas: string[] }
  | { status: "forbidden" } // R12 (rol) / R17 (orden ajena o inexistente)
  | { status: "conflict"; detalle: DetalleConflicto[] }; // R17 (origen invalido)

export type EscogerServiceResult =
  | { status: "ok"; ordenId: string }
  | { status: "forbidden" } // R12 / orden ajena
  | { status: "conflict"; motivo: string }; // R21: ya hay otra orden activa / origen invalido

// Evidencia ya leida del borde (binario + metadatos), lista para subir a Storage.
export interface EvidenciaArchivo {
  contentType: string;
  bytes: Uint8Array;
}

// Entrada discriminada por `resultado` (R22/R25/R27/R29). La validacion de
// obligatoriedad/MIME/tamano/fecha ya paso en el borde (zod); el service revalida
// propiedad/origen/bloqueo y la regla (h) monto == montoCobrar.
// Feature 92 (R22): `ubicacion` opcional en las CUATRO ramas. Va como interseccion para no
// repetirla en cada variante ni tocar el discriminante.
// Feature 119 (R5): la evidencia UNICA (`evidencia`) pasa a una LISTA `evidencias`
// (1..N, tope R7) en las 3 ramas con foto. `reprogramada` sigue sin evidencia.
// Feature 193 (R14): `ubicacionAusencia` viaja por la MISMA interseccion, por el mismo motivo.
// Sigue siendo opcional AQUI —el tipo no puede expresar «una u otra»— porque esa regla ya la
// impuso el borde (`gestionarSchema`, R8-R12) y duplicarla en el tipo no la haria mas cierta:
// al service solo le llegan entradas que ya pasaron por zod.
export type GestionarInput = {
  ubicacion?: UbicacionInput;
  ubicacionAusencia?: GestionUbicacionAusenciaValue;
} & (
  | {
      ordenId: string;
      resultado: "entregada";
      montoRecibido: number;
      /**
       * Feature 212 (R12/R19): metodo ESCALAR de compatibilidad. `null` cuando el cliente ya
       * manda desglose. NO es la fuente del reparto por metodo —eso es `pagos`—: sobrevive solo
       * para la columna DEPRECADA `gestion_orden.metodo_pago`, que se retira en su propia ficha.
       */
      metodoPago: MetodoPago | null;
      /**
       * Feature 212 (R11/R12/R14): desglose YA NORMALIZADO por el borde (`normalizarPagos`).
       * OBLIGATORIO y sin fallback al escalar: una entrega sin cobro llega como `[]`, y una
       * cobrada con un solo metodo como UNA linea. El service revalida en `Prisma.Decimal` que
       * la suma iguale `montoRecibido` (R18) antes de persistir.
       */
      pagos: LineaPago[];
      evidencias: EvidenciaArchivo[];
    }
  | { ordenId: string; resultado: "reprogramada"; fechaReprogramacion: string; motivo: string }
  // Feature 73/R10: la causa tipificada es un campo de la rama `devuelta` y SOLO de ella.
  // Feature 75: la evidencia pasa a ser obligatoria tambien en `devuelta` (espejo de rechazada).
  | {
      ordenId: string;
      resultado: "devuelta";
      causaDevolucion: CausaDevolucion;
      motivo: string;
      evidencias: EvidenciaArchivo[];
    }
  | { ordenId: string; resultado: "rechazada"; motivo: string; evidencias: EvidenciaArchivo[] }
  // Feature 158 (R9/R10/R11): el INCIDENTE. Causa tipificada + motivo libre + 1..N fotos
  // OBLIGATORIAS en las TRES causas (Q-B). Sin `montoRecibido`/`metodoPago`: no hay recaudo.
  | {
      ordenId: string;
      resultado: "incidente";
      causaIncidente: CausaIncidente;
      motivo: string;
      evidencias: EvidenciaArchivo[];
    }
);

export type GestionarServiceResult =
  // Feature 119 (R13): URLs firmadas de las N evidencias (TTL acotado), NUNCA el path crudo.
  | { status: "ok"; ordenId: string; estado: string; evidenciaUrls?: string[] }
  | { status: "forbidden" } // R12 / orden ajena
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R22/R24 (monto != montoCobrar, etc.)
  | { status: "conflict"; motivo: string }; // R18/R21 origen invalido / otra orden activa

// R35: liberar el puntero de bloqueo. Idempotente: `ok` aunque no hubiera nada
// que limpiar; `forbidden` si el actor no es mensajero.
export type LiberarServiceResult = { status: "ok" } | { status: "forbidden" };

export interface IMisAsignacionesService {
  /**
   * R9-R13: dos grupos + puntero de bloqueo; solo `mensajero` (sobre sus ordenes).
   * Feature 246 (T5.1, R25/R26): `now` es el reloj inyectable del que sale `esParaManana`.
   */
  listarMisAsignaciones(actor: Actor, now?: Date): Promise<ListarMisAsignacionesServiceResult>;
  /**
   * R14-R17: transiciona por_recoger -> en_reparto (lote o de a una).
   *
   * Feature 261 (R1/R6): `now` es el reloj INYECTABLE del que sale el dia de Costa Rica en curso
   * con el que se decide si una orden esta reservada. Espejo exacto de `listarMisAsignaciones`,
   * que la 246 ya dejo asi para poder probar que la etiqueta caduca sola. Sin esto, R6 y R7 no
   * son testeables sin falsear el reloj global del proceso.
   */
  recogerAsignaciones(
    input: RecogerInput,
    actor: Actor,
    now?: Date,
  ): Promise<RecogerServiceResult>;
  /** R19-R21: fija la orden activa 1-a-1; conflict si ya hay otra activa. Feature 261 (R3/R6): `now` inyectable. */
  escogerParaGestion(ordenId: string, actor: Actor, now?: Date): Promise<EscogerServiceResult>;
  /** R18/R22-R32: registra la gestion (4 resultados) con atomicidad storage<->DB. Feature 261 (R2/R6): `now` inyectable. */
  gestionar(input: GestionarInput, actor: Actor, now?: Date): Promise<GestionarServiceResult>;
  /** R35: libera el puntero de bloqueo del propio actor si apunta a esa orden. */
  liberarGestion(ordenId: string, actor: Actor): Promise<LiberarServiceResult>;
}
