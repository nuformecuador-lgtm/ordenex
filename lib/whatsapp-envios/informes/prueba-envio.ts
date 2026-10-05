// Ficha 474 (design §2.1, R47) — informe «Prueba de envío».
//
// Sirve para verificar EN PRODUCCION la cadena completa (plantilla con documento aprobada → Probar
// ahora → mensaje con PDF en el telefono) antes de que existan los informes reales (475/476), y la
// rama «vacio» con «simular vacio».
import { jsPDF } from "jspdf";
import { z } from "zod";
import type { InformeWhatsapp } from "@/lib/whatsapp-envios/informes/tipos";
import { fechaCRLegible, horaCRLegible } from "@/lib/whatsapp-envios/informes/formato";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

const parametrosSchema = z
  .object({
    simularVacio: z.boolean().default(false),
  })
  .strict();

export type ParametrosPruebaEnvio = z.infer<typeof parametrosSchema>;

/** PDF de UNA pagina. `Uint8Array` porque es lo que guarda el almacen y sube el cliente de Meta. */
export function pdfDePrueba(fecha: string, hora: string): Uint8Array {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setFontSize(16);
  doc.text("Prueba de envío automático", 20, 30);
  doc.setFontSize(12);
  doc.text(`${fecha} ${hora} (hora de Costa Rica)`, 20, 42);
  doc.text("Si recibiste este documento, el envío automático funciona.", 20, 54);
  return new Uint8Array(doc.output("arraybuffer"));
}

export const informePruebaEnvio: InformeWhatsapp<ParametrosPruebaEnvio> = {
  clave: "prueba_envio",
  nombre: "Prueba de envío",
  descripcion:
    "Manda la fecha y la hora del momento y un PDF de una página. Sirve para comprobar que el envío automático funciona.",
  parametros: parametrosSchema,
  parametrosPorDefecto: { simularVacio: false },
  descriptores: [
    {
      campo: "simularVacio",
      etiqueta: "Simular que no hay nada que informar",
      tipo: "booleano",
      ayuda: "Activado, la ejecución queda como «Sin novedades» y no se manda nada.",
    },
  ],
  variables: [
    { clave: "fecha", nombre: "Fecha", descripcion: "Fecha del envío (hora de Costa Rica).", ejemplo: "05/10/2026" },
    { clave: "hora", nombre: "Hora", descripcion: "Hora del envío (hora de Costa Rica).", ejemplo: "05:00" },
  ],
  generaDocumento: true,
  // Solo fecha y hora: no lleva datos de ninguna tienda.
  aptoParaAdminTienda: true,
  eventos: [],
  soloPorEvento: false,
  async generar(ctx) {
    if (ctx.parametros.simularVacio) {
      return { tipo: "vacio", motivo: "Prueba con «simular vacío» activado." };
    }
    const fecha = fechaCRLegible(ctx.ahora);
    const hora = horaCRLegible(ctx.ahora);
    return {
      tipo: "contenido",
      valores: { fecha, hora },
      ...(ctx.conDocumento
        ? {
            documento: {
              bytes: pdfDePrueba(fecha, hora),
              nombreArchivo: `prueba-${fechaCalendarioCR(ctx.ahora)}.pdf`,
            },
          }
        : {}),
    };
  },
};
