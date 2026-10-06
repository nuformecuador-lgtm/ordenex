// Ficha 474 (design §2.2/§6.6, R14/R49/R50/R52) — CATALOGO DE EVENTOS de los envios por evento.
//
// Los eventos son los de los AVISOS INTERNOS de la app (la campana): un envio «por evento» manda un
// WhatsApp cuando la app crea un aviso de ese evento (D4). Este objeto declara, para CADA valor de
// `NotificacionEvento`, si se puede usar como disparo —con su nombre en español claro, sin siglas
// como «SLA»— o por que no.
//
// MISMO MECANISMO que `PUSH_ELEGIBLE` y `CATALOGO_AVISOS`: el `satisfies Record<NotificacionEvento,
// …>` hace que un valor nuevo del enum de la campana NO COMPILE hasta que alguien decida si es
// disparo (R49). Sin `default`, sin `Partial`.
//
// LA REGLA DE QUE FILA DISPARA, de la que salen casi todos los «no»: el puente solo mira filas
// dirigidas a un ROL SIN ALCANCE (sin tienda ni zona). Son las de la administracion central y su
// texto esta escrito en tercera persona para quien coordina. Una fila a un usuario dice «Tu
// cierre…»: reenviada a la lista de un envio le hablaria a quien no es su dueño. Una fila acotada a
// una tienda o zona no nombra su ambito en el texto.
//
// `ejemploTexto` (R52, «Probar ahora» de un envio por evento) es el TEXTO REAL del emisor importado
// de `emitir.ts`, no una copia: si el texto del aviso cambia, el ejemplo cambia con el.
import type { CrearNotificacionInput } from "@/lib/interfaces/repositories/INotificacionRepository";
import type { NotificacionEvento } from "@/lib/types/notificacion";
import {
  TEXTO_CIERRE_POR_APROBAR,
  TEXTO_CIERRE_VENCIDO_BODEGA,
  TEXTO_POSTULACION_PENDIENTE,
  TEXTO_POSTULACION_RECURSO_PENDIENTE,
  TEXTO_REPROGRAMADAS_ESPERAN_CIERRE,
  textoCobrosGastoFijoPendientes,
  textoDevolucionesRepresadas,
  textoGeocodificacionCaida,
  textoMensajeroBloqueadoBodega,
  textoWebhookSuscripcionPausada,
} from "@/lib/notificaciones/emitir";

export type PerfilEventoEnvio =
  | {
      readonly disponible: true;
      /** Lo que ve la pantalla en el desplegable «Cuando pase algo» y lo que vale `{{titulo}}`. */
      readonly nombre: string;
      readonly descripcion: string;
      /** Texto de ejemplo para «Probar ahora» (R52): el del emisor real. */
      readonly ejemploTexto: string;
    }
  | { readonly disponible: false; readonly porQue: string };

/** Instante FIJO del ejemplo del webhook: un ejemplo que cambia con el reloj no es un ejemplo. */
const INSTANTE_EJEMPLO_WEBHOOK = new Date("2026-10-05T14:00:00.000Z");

export const EVENTOS_ENVIO_WHATSAPP = {
  // ---------------------------------------------------------------------------------------------
  // DISPONIBLES — los diez con fila a un rol de administracion central sin alcance.
  // ---------------------------------------------------------------------------------------------
  postulacion_mensajero_pendiente: {
    disponible: true,
    nombre: "Postulación de mensajero pendiente",
    descripcion: "Alguien se postuló como mensajero y espera aprobación.",
    ejemploTexto: TEXTO_POSTULACION_PENDIENTE,
  },
  postulacion_recurso_pendiente: {
    disponible: true,
    nombre: "Ofrecieron un vehículo o una bodega",
    descripcion: "Alguien ofreció un vehículo o una bodega desde la web.",
    ejemploTexto: TEXTO_POSTULACION_RECURSO_PENDIENTE,
  },
  cierre_dia_por_aprobar: {
    disponible: true,
    nombre: "Cierre del día por aprobar",
    descripcion: "Un mensajero envió su cierre del día. Uno por cierre.",
    ejemploTexto: TEXTO_CIERRE_POR_APROBAR,
  },
  cierre_dia_vencido: {
    disponible: true,
    nombre: "Cierre del día vencido sin enviar",
    descripcion: "El cierre de un mensajero venció sin enviarse a aprobación.",
    ejemploTexto: TEXTO_CIERRE_VENCIDO_BODEGA,
  },
  mensajero_bloqueado_por_cierres: {
    disponible: true,
    nombre: "Mensajero bloqueado por cierres sin aprobar",
    descripcion: "Un mensajero quedó bloqueado por acumular cierres pendientes.",
    ejemploTexto: textoMensajeroBloqueadoBodega(null),
  },
  gasto_fijo_cobro_pendiente: {
    disponible: true,
    nombre: "Cobros de gasto fijo por aprobar",
    descripcion: "Quedan cobros de gasto fijo esperando decisión. Uno por día.",
    ejemploTexto: textoCobrosGastoFijoPendientes(3),
  },
  webhook_suscripcion_pausada: {
    disponible: true,
    nombre: "Un webhook lleva fallando",
    descripcion: "Un webhook de un integrador lleva fallando seguido. Uno por racha.",
    ejemploTexto: textoWebhookSuscripcionPausada(INSTANTE_EJEMPLO_WEBHOOK),
  },
  geocodificacion_caida: {
    disponible: true,
    nombre: "El servicio de mapas rechaza las peticiones",
    descripcion: "El proveedor de mapas rechaza las peticiones por la configuración de la cuenta. Uno por día.",
    ejemploTexto: textoGeocodificacionCaida(3),
  },
  devoluciones_represadas: {
    disponible: true,
    nombre: "Devoluciones represadas en bodega",
    descripcion: "Hay devoluciones que llevan días esperando en bodega. Uno por día.",
    ejemploTexto: textoDevolucionesRepresadas(4),
  },
  reprogramadas_esperan_cierre: {
    disponible: true,
    nombre: "Paquetes reprogramados para hoy retenidos por un cierre",
    descripcion: "Hay paquetes reprogramados para hoy que no se pueden asignar hasta aprobar un cierre. Uno por día.",
    ejemploTexto: TEXTO_REPROGRAMADAS_ESPERAN_CIERRE,
  },

  // ---------------------------------------------------------------------------------------------
  // NO DISPONIBLES — con su motivo (design §2.2).
  // ---------------------------------------------------------------------------------------------
  orden_rechazada: {
    disponible: false,
    porQue:
      "Se crea DENTRO de la transaccion del registro de la gestion con un repositorio propio que no pasa por repoReal(): puentearlo ahi ataria la gestion al puente (R50). Ademas es uno por orden.",
  },
  carga_masiva_terminada: {
    disponible: false,
    porQue: "Aviso personal al que lanzo la carga; no tiene fila de rol.",
  },
  dia_reparto_corregido: {
    disponible: false,
    porQue: "Aviso personal en segunda persona al mensajero; no tiene fila de rol.",
  },
  cierre_dia_rechazado: {
    disponible: false,
    porQue: "Aviso personal en segunda persona al mensajero; no tiene fila de rol.",
  },
  reparto_manana: {
    disponible: false,
    porQue: "Aviso personal al mensajero; no tiene fila de rol y su cifra solo existe al leer.",
  },
  traspaso_ordenes_recibido: {
    disponible: false,
    porQue: "Aviso personal al mensajero; no tiene fila de rol.",
  },
  traspaso_ordenes_cedido: {
    disponible: false,
    porQue: "Aviso personal al mensajero; no tiene fila de rol.",
  },
  novedades_sin_gestionar: {
    disponible: false,
    porQue:
      "Solo existe acotado a una tienda (adminTienda + tiendaId) y su texto no la nombra: seria un mensaje por tienda y por dia sin decir de cual.",
  },
} as const satisfies Record<NotificacionEvento, PerfilEventoEnvio>;

/** Un evento declarado DISPONIBLE como disparo. */
export type EventoDisponible = {
  [K in keyof typeof EVENTOS_ENVIO_WHATSAPP]: (typeof EVENTOS_ENVIO_WHATSAPP)[K] extends {
    disponible: true;
  }
    ? K
    : never;
}[keyof typeof EVENTOS_ENVIO_WHATSAPP];

/** Perfil de un evento por clave arbitraria (texto de la base); `null` si no es un evento conocido. */
export function perfilDeEvento(clave: string): PerfilEventoEnvio | null {
  return Object.prototype.hasOwnProperty.call(EVENTOS_ENVIO_WHATSAPP, clave)
    ? (EVENTOS_ENVIO_WHATSAPP as Record<string, PerfilEventoEnvio>)[clave]
    : null;
}

/** `true` si `clave` es un evento declarado disponible (R14/R49). */
export function esEventoDisponible(clave: string): clave is EventoDisponible {
  return perfilDeEvento(clave)?.disponible === true;
}

/** Los eventos disponibles, en el orden del catalogo, con su nombre (lo que ofrece la pantalla). */
export function eventosDisponibles(): { clave: EventoDisponible; nombre: string; descripcion: string }[] {
  const salida: { clave: EventoDisponible; nombre: string; descripcion: string }[] = [];
  for (const [clave, perfil] of Object.entries(EVENTOS_ENVIO_WHATSAPP) as [
    string,
    PerfilEventoEnvio,
  ][]) {
    if (perfil.disponible) {
      salida.push({ clave: clave as EventoDisponible, nombre: perfil.nombre, descripcion: perfil.descripcion });
    }
  }
  return salida;
}

/**
 * Design §6.6 (R50) — PUERTA del puente, PURA y sin consultas: evento disponible ∧ fila dirigida a
 * un rol ∧ sin tienda ∧ sin zona ∧ con entidad. Cualquier otra fila sale sin tocar la base.
 */
export function filaPuenteable(input: CrearNotificacionInput): boolean {
  if (!esEventoDisponible(input.evento)) return false;
  if (input.entidadId === null) return false;
  const d = input.destinatario;
  if (d.tipo !== "rol") return false;
  if (d.tiendaId !== undefined && d.tiendaId !== null) return false;
  if (d.zonaId !== undefined && d.zonaId !== null) return false;
  return true;
}
