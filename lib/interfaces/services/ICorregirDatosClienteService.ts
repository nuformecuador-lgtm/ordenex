import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CampoCorregible } from "@/lib/types/correccion-datos-cliente";
import type { OrigenFlete } from "@/lib/types/tarifa";

// Ficha 312 (2026-08-28) — contrato de LA CORRECCION DE LOS DATOS DEL CLIENTE de una orden.
//
// SERVICIO PROPIO Y NO UN METODO MAS DE `IOrdenService`, por la misma razon que «eliminar orden»:
// aquel es SOLO LECTURAS desde el 2026-08-07 (ver su cabecera) y la escritura de ordenes vive, por
// convencion de este repo, en un servicio de dominio POR ACCION (`DeshacerAsignacionService`,
// `RecuperacionBodegaService`, `EliminarOrdenService`, ...). Esta es una accion mas de esa familia.
//
// QUE PROBLEMA CIERRA. La carga masiva entra con el destinatario o el telefono mal escritos y hoy
// la aplicacion no ofrece NINGUNA superficie para arreglarlo: la unica via es un `UPDATE` a mano
// contra produccion.
//
// ⚠️ SIN RASTRO (D4, decision humana del 2026-08-28). Corregir NO publica nota en el hilo, NO
// escribe fila de historial y NO crea ninguna tabla de auditoria: el unico rastro es el
// `updated_at` de la fila. Lo que eso cuesta esta escrito en `requirements.md` §D4 y la
// alternativa completa esta EVALUADA Y DESCARTADA en `design.md` §8/B. No es un olvido, y `cambios`
// (abajo) no lo contradice: es un valor de RESPUESTA, efimero, que no se persiste en ningun sitio.

export interface CorregirDatosClienteInput {
  ordenId: string;
  /**
   * D1 — los NUEVE campos y nada mas. Ausente = «no lo toques»; `notas: null` = «vacialo».
   *
   * `zonaId` NO esta: la deriva el servidor a partir del distrito (327/R5). Tampoco `estatusId`,
   * `tiendaId`, `montoCobrar`, `cobraComision`, `numGuia`, `numRemision` ni
   * `mensajeroAsignadoId` (327/D2 y R24).
   */
  destinatario?: string;
  telefonoDest?: string;
  producto?: string;
  notas?: string | null;
  // ── Ficha 327 — la ubicacion ──
  direccion?: string;
  /** Los tres viajan JUNTOS o no viajan (327/R3); el borde ya lo exige. */
  provinciaId?: string;
  cantonId?: string;
  distritoId?: string;
  peso?: number;
  /**
   * FICHA 327 (design §4.1) — EL GATE DEL DINERO, en la MISMA peticion que escribe.
   *
   * `false`/ausente + cambio de DISTRITO ⇒ el servicio NO escribe nada y devuelve
   * `confirmacion_requerida` con los importes de las dos ubicaciones. `true` ⇒ aplica.
   *
   * POR QUE ASI Y NO CON UNA ACCION DE PREVISUALIZACION: porque asi es IMPOSIBLE guardar sin que
   * el servidor haya enseñado los importes. Una preview aparte seria un adorno de pantalla que un
   * cliente hecho a mano se salta, y volveria a dejar el dinero cambiando en silencio — que es
   * literalmente lo que D5 viene a impedir. Ademas evita la carrera «vi un importe, guarde otro»:
   * los numeros que el modal enseña son los de la misma llamada que se acaba de rechazar.
   */
  confirmaCambioDeUbicacion?: boolean;
}

/**
 * FICHA 327 (design §9.2) — UNA UBICACION Y LO QUE COSTARIA. Se emite DOS veces en cada aviso: la
 * ubicacion actual de la orden y la propuesta. Enseñar solo la nueva obligaria a quien mira a
 * recordar la vieja.
 *
 * ⚠️ LOS IMPORTES NO SE CALCULAN AQUI NI EN EL NAVEGADOR (R12). Salen de `resolveTarifa` (la
 * cascada de la feature 274) + `costosListadoOrden`, que NO reimplementa la formula: delega en
 * `derivarIngresoOrden(..., "entregada")`, la MISMA funcion que factura el cierre del dia. Si un
 * dia cambia la formula del cierre, este aviso cambia con ella; no pueden divergir.
 */
export interface UbicacionConCostos {
  zonaId: string;
  zonaNombre: string;
  distritoNombre: string | null;
  /** De la ZONA: elige la columna GAM del flete. */
  esCentral: boolean;
  /** Del DISTRITO: elige el pacto especial. Por eso el gate mira el distrito, no la zona. */
  esZonaEspecial: boolean;
  /**
   * R13 — «SIN TARIFA» NO ES «CERO», Y POR ESO ES UN DISCRIMINANTE Y NO UN `"0.00"`.
   *
   * Sin tarifa, `costosListadoOrden` devuelve `"0.00"`/`"0.00"`. Pintar eso seria mentir: no
   * significa «gratis», significa «nadie configuro la tarifa de ese par (tienda, zona)». La
   * pantalla ramifica por ESTE campo, nunca por el importe.
   */
  tarifa: "resuelta" | "sin_tarifa";
  /** STRING escala 2, money-safe. Nunca `number`: el navegador solo lo pinta. */
  fleteConIva: string;
  comisionConIva: string;
  /**
   * R14 — de donde salio el flete. `especial_sin_pacto` importa porque el importe es IDENTICO al
   * de una orden corriente: sin señalarlo no hay forma de distinguir «cobra la normal porque le
   * toca» de «cobra la normal porque falta configurar el pacto».
   */
  fleteOrigen: OrigenFlete;
}

/**
 * FICHA 327 (R11/R16) — el aviso que el servidor emite ANTES de escribir, cuando la correccion
 * cambia el distrito y no trae la confirmacion.
 */
export interface AvisoCambioUbicacion {
  actual: UbicacionConCostos;
  propuesta: UbicacionConCostos;
  /**
   * R16 — la orden ya tiene al menos una fila congelada en un cierre. NO bloquea: lo ya facturado
   * no cambia (la fila de `cierre_detail` es inmutable, y hay una guardia estructural que lo
   * impone), y el importe nuevo rige de la proxima gestion en adelante. Bloquear condenaria a
   * re-intentarse con la ubicacion equivocada justo a la orden que esta ficha existe para
   * arreglar.
   */
  yaEnUnCierre: boolean;
}

/**
 * FICHA 327 (R31, design §9.3) — la PRECARGA de la superficie: los nueve valores actuales mas los
 * nombres que la pantalla pinta.
 *
 * POR QUE UNA LECTURA PROPIA Y NO AMPLIAR LOS DTO DE LISTADO. `/ordenes` tiene los ids de
 * geografia pero `/novedades` solo tiene los NOMBRES, y ese DTO lo comparte el portal del
 * mensajero: ampliarlo obligaria a emitir tres ids en dos listas donde nadie los lee. Una lectura
 * bajo demanda sirve IGUAL a las dos superficies y de paso resuelve `yaEnUnCierre`.
 *
 * NO LLEVA DINERO DE LA ORDEN: `montoCobrar` no viaja. No se edita aqui y no hace falta para
 * pintar; entra en el calculo del aviso, que ocurre entero en el servidor.
 */
export interface OrdenParaCorreccionDTO {
  ordenId: string;
  destinatario: string;
  telefonoDest: string;
  producto: string;
  notas: string | null;
  direccion: string | null;
  peso: number | null;
  provinciaId: string;
  cantonId: string;
  distritoId: string | null;
  zonaNombre: string;
  distritoNombre: string | null;
  /** R36: con guia, la superficie advierte que la etiqueta impresa conserva los datos viejos. */
  numGuia: number | null;
  /** R16: la superficie lo puede anticipar antes incluso de intentar guardar. */
  yaEnUnCierre: boolean;
}

/**
 * R18/R30 — la precarga pasa por LA MISMA PUERTA que la escritura (mismo rol, misma pertenencia,
 * misma ventana) y devuelve el MISMO resultado opaco a quien no la cruza. Una lectura mas
 * permisiva que la escritura convertiria el modal en un oraculo de que ordenes existen y de quien
 * son.
 */
export type ObtenerUbicacionServiceResult =
  | { status: "ok"; orden: OrdenParaCorreccionDTO }
  | { status: "forbidden" };

/**
 * Los cuatro desenlaces (design §4.2).
 *
 * `cambios` dice QUE CAMBIO EL SERVIDOR, no que mando la pantalla — mismo criterio que
 * `eliminadas` en `EliminarOrdenServiceResult`. Vacio significa «lo enviado ya era lo almacenado»
 * (R4): no se escribio nada y eso NO es un error.
 *
 * `forbidden` es OPACO A PROPOSITO (R12): rol no autorizado, orden inexistente, orden borrada y
 * orden de otra tienda devuelven EL MISMO objeto. Distinguirlos convertiria la respuesta en un
 * oraculo de que ordenes existen y de quien son.
 */
export type CorregirDatosClienteServiceResult =
  | { status: "ok"; cambios: readonly CampoCorregible[] } // 312/R4, 327/R10
  | { status: "forbidden" } // 312/R8-R12, 327/R30
  | { status: "conflict" } // 312/R13, 327/R29: el estado se movio entre la lectura y la escritura
  // 312/R18 y 327/R6-R7-R8-R9. `geografia_incoherente` y `zona_no_resoluble` NO son estados
  // propios: son `validation_error` con `fieldErrors.distritoId`, que es la forma que la familia
  // ya usa y que el modal ya sabe pintar junto al campo. Un estado por motivo de rechazo es
  // superficie sin ganancia.
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  /**
   * FICHA 327 (R11) — EL GATE DEL DINERO. **No es un error: es el aviso, con sus cifras.**
   *
   * Se devuelve cuando la correccion cambia el DISTRITO de la orden y la peticion no trae la
   * confirmacion. En ese caso NO SE ESCRIBE NADA, y el aviso trae la zona actual, la que
   * resultaria, y para cada una el flete + IVA y la comision + IVA que se cobrarian.
   *
   * El gate mira el DISTRITO y no la zona a proposito: la marca `zona_especial` es del distrito,
   * asi que cambiar de distrito dentro de la MISMA zona tambien puede mover el flete.
   */
  | { status: "confirmacion_requerida"; aviso: AvisoCambioUbicacion };

export interface ICorregirDatosClienteService {
  corregir(
    input: CorregirDatosClienteInput,
    actor: Actor,
  ): Promise<CorregirDatosClienteServiceResult>;
  /**
   * FICHA 327 (R31) — la precarga del editor. Misma puerta que `corregir` (R18): rol, pertenencia
   * y ventana revalidados en ESTA peticion, y el mismo `forbidden` opaco para todos los motivos.
   */
  obtenerUbicacion(ordenId: string, actor: Actor): Promise<ObtenerUbicacionServiceResult>;
}
