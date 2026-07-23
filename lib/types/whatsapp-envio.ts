// Integracion WhatsApp — tipos del ENVIO de una plantilla a la orden de un mensajero.

/** Datos de la orden usados para resolver las variables de la plantilla y el destino. */
export interface OrdenEnvioData {
  destinatario: string;
  telefonoDest: string;
  numGuia: number | null;
  numRemision: string;
  producto: string;
  direccion: string | null;
  montoCobrar: number | null;
}

/** Fila del listado de plantillas enviables que consume la UI del mensajero. */
export interface PlantillaEnviableDTO {
  id: string;
  nombre: string;
}

/**
 * Fila del flujo wa.me: incluye el CUERPO y las variables para renderizar el texto en el
 * cliente y abrir WhatsApp con el mensaje ya escrito.
 */
export interface PlantillaTextoDTO {
  id: string;
  nombre: string;
  cuerpo: string;
  variables: string[];
}

/** Resultado del listado de plantillas para el flujo wa.me. */
export type ListarPlantillasTextoResult =
  | { status: "ok"; items: PlantillaTextoDTO[] }
  | { status: "unauthenticated" };

/** Resultado de dominio del envio (lo que la server action devuelve a la UI). */
export type EnviarPlantillaResult =
  | { status: "ok"; mensajeId: string }
  | { status: "unauthenticated" }
  | { status: "forbidden" } // la orden no esta asignada a este mensajero
  | { status: "not_found" } // orden o plantilla inexistente / no enviable
  | { status: "no_configurado" } // WhatsApp aun sin credenciales
  | { status: "envio_fallido"; detalle: string }; // Meta rechazo o no respondio

/** Resultado del listado de enviables. */
export type ListarEnviablesResult =
  | { status: "ok"; items: PlantillaEnviableDTO[] }
  | { status: "unauthenticated" }
  | { status: "forbidden" };
