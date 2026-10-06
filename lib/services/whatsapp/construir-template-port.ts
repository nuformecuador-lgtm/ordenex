// Ficha 474 — UNA sola fabrica del puerto de templates de produccion, para que la propagacion en
// linea (`lib/actions/plantillas.ts`) y el job de reintento (`whatsapp-template-sync-handler.ts`)
// creen los templates IGUAL. Si cada uno construyera el suyo, el reintento de una plantilla con
// documento podria crear el template SIN la cabecera (el proveedor del handle se olvida en uno de
// los dos y nada falla): es el fallo de «el composition root que no inyecta».
import type { WhatsappConfig } from "@/lib/config/whatsapp";
import { WhatsappPlantillasClient } from "@/lib/clients/whatsapp-cloud";
import { ResolutorAppIdMeta } from "@/lib/clients/whatsapp-app-id";
import { WhatsappSubidaReanudableClient } from "@/lib/clients/whatsapp-subida-reanudable";
import { WhatsappTemplatePort } from "@/lib/services/whatsapp/WhatsappTemplatePort";
import { ProveedorHandleDocumentoEjemplo } from "@/lib/services/whatsapp/documento-ejemplo-plantilla";

export function construirWhatsappTemplatePort(config: WhatsappConfig): WhatsappTemplatePort {
  return new WhatsappTemplatePort(
    new WhatsappPlantillasClient({ config }),
    config,
    new ProveedorHandleDocumentoEjemplo(
      new ResolutorAppIdMeta(),
      new WhatsappSubidaReanudableClient({ config }),
    ),
  );
}
