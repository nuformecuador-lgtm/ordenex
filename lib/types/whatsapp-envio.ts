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
  /**
   * Nombre para mostrar del mensajero ASIGNADO a la orden (variable `mensajero` de las
   * plantillas). Cadena vacia si la orden no tiene mensajero asignado o el flujo no lo aporta
   * (p. ej. el camino wa.me del boton del cliente, donde no viaja el nombre del mensajero).
   */
  mensajeroNombre: string;
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

// Aqui vivian `EnviarPlantillaResult`, `ListarEnviablesResult` y `PlantillaEnviableDTO`, los
// tipos del envio server-side por Meta. Se borraron el 2026-08-07 con el resto de esa isla
// (`EnvioPlantillaWhatsappService` y sus dos Server Actions): el camino que los usaba nunca
// tuvo boton. Lo que SI sigue vivo y se le parece es `PlantillaEnviable` (el tipo del
// repositorio, en `IPlantillaMensajeRepository`), que alimenta a `listarEnviables()` y
// `findEnviableById()` — ambos con llamador vivo. No confundir DTO con tipo de repositorio.
