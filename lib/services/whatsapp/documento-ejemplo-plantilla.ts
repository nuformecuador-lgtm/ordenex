// Ficha 474 (design §5.2, R5) — el `header_handle` del DOCUMENTO DE EJEMPLO que Meta exige para
// crear (o editar) un template con cabecera DOCUMENT.
//
// Dos piezas: el ID de la app (resuelto del token, `ResolutorAppIdMeta`, R48) y la subida
// reanudable (`WhatsappSubidaReanudableClient`). El PDF de ejemplo es FIJO («Documento de ejemplo»):
// Meta solo lo usa para revisar la plantilla, no lo ve ningun destinatario.
//
// Un fallo LANZA `WhatsappPlantillaError` con el codigo, nunca en silencio: lo captura el
// propagador (que encola el reintento) o el job de reintento (backoff), igual que cualquier otro
// fallo de Meta en el CRUD de plantillas.
import { jsPDF } from "jspdf";
import { WhatsappPlantillaError } from "@/lib/clients/whatsapp-cloud";
import { mensajeAppIdNoResuelto, type IResolutorAppIdMeta } from "@/lib/clients/whatsapp-app-id";
import type { IWhatsappSubidaReanudable } from "@/lib/clients/whatsapp-subida-reanudable";

export interface IProveedorHandleDocumento {
  obtenerHandle(): Promise<string>;
}

/** PDF de una pagina con el texto «Documento de ejemplo». */
export function pdfEjemploPlantilla(): Uint8Array {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setFontSize(16);
  doc.text("Documento de ejemplo", 20, 30);
  return new Uint8Array(doc.output("arraybuffer"));
}

export class ProveedorHandleDocumentoEjemplo implements IProveedorHandleDocumento {
  constructor(
    private readonly resolutor: IResolutorAppIdMeta,
    private readonly subidor: IWhatsappSubidaReanudable,
  ) {}

  async obtenerHandle(): Promise<string> {
    const app = await this.resolutor.resolver();
    if (!app.ok) throw new WhatsappPlantillaError(`documento de ejemplo: ${mensajeAppIdNoResuelto(app)}`);
    const r = await this.subidor.subir({
      appId: app.appId,
      bytes: pdfEjemploPlantilla(),
      nombreArchivo: "documento-de-ejemplo.pdf",
      mime: "application/pdf",
    });
    if (r.status !== "ok") throw new WhatsappPlantillaError(`documento de ejemplo: ${r.detalle}`);
    return r.handle;
  }
}
