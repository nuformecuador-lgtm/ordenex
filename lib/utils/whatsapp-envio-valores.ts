// Integracion WhatsApp — resolver PURO (cliente-safe) de los valores de las variables de una
// plantilla a partir de los datos de la orden. Lo usan el envio server-side (Graph API) y el
// flujo wa.me del panel del mensajero, para que ambos rendericen el MISMO texto.
import type { OrdenEnvioData } from "@/lib/types/whatsapp-envio";

/**
 * Mapea cada variable NOMBRADA de la plantilla a su valor desde la orden. Catalogo de claves
 * conocidas -> campo de la orden; una clave desconocida cae a cadena vacia. Acepta sinonimos
 * comunes (guia/num_guia, remision/num_remision).
 *
 * NOTA (assumption): al no haber binding explicito variable->campo en la feature 107, este es
 * el mapeo por convencion. Ampliar/ajustar aqui si el negocio define otras claves.
 */
export function resolverValoresOrden(
  variables: string[],
  orden: OrdenEnvioData,
): Record<string, string> {
  const montoCobrar = orden.montoCobrar === null ? "" : String(orden.montoCobrar);
  const catalogo: Record<string, string> = {
    nombre: orden.destinatario,
    destinatario: orden.destinatario,
    cliente: orden.destinatario,
    // Nombre del mensajero asignado (vacio si la orden no lo trae / flujo cliente).
    mensajero: orden.mensajeroNombre,
    telefono: orden.telefonoDest,
    direccion: orden.direccion ?? "",
    producto: orden.producto,
    guia: orden.numGuia === null ? "" : String(orden.numGuia),
    num_guia: orden.numGuia === null ? "" : String(orden.numGuia),
    remision: orden.numRemision,
    num_remision: orden.numRemision,
    monto: montoCobrar,
    // `total` = valor a cobrar (alias de montoCobrar); es lo que pide la plantilla del negocio.
    total: montoCobrar,
    // SINPE del negocio (numero y titular al que el cliente transfiere): datos de config, NO de
    // la orden. Vienen de env (`SINPE_NUMERO`/`SINPE_NOMBRE`) — sin `NEXT_PUBLIC_`: son
    // variables de SERVIDOR y no se inyectan en el bundle del navegador. Ausentes -> "".
    sinpe: process.env.SINPE_NUMERO ?? "",
    sinpe_nombre: process.env.SINPE_NOMBRE ?? "",
  };
  const valores: Record<string, string> = {};
  for (const clave of variables) {
    valores[clave] = catalogo[clave] ?? "";
  }
  return valores;
}
