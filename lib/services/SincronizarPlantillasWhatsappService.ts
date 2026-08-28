// Integracion WhatsApp — sincronizacion Meta -> local (cron 24h). LEE los templates de la WABA
// en Meta y REFRESCA el estado de revision de las plantillas LOCALES que ya existen, casadas
// por NOMBRE. Nada mas.
//
// QUE HACE Y QUE NO (pedido humano 2026-08-27):
//   - NO crea filas locales. Antes IMPORTABA todo template que no existiera aqui, y por esa
//     via entraron plantillas que nadie diseno en este modulo: `hello_world`, y una con las
//     variables `1`,`2`,`3` —numeradas por Meta, ausentes del catalogo, que resuelven a
//     cadena VACIA al enviar—. Dar de alta una plantilla es un acto del maestro.
//   - NO borra filas locales.
//   - NO toca el cuerpo ni las variables: lo que viaja de Meta a aqui es el ESTADO de
//     revision (mas el templateId/idioma, que son el enlace sin el cual la plantilla no es
//     enviable). El texto que el maestro escribio no lo pisa una sincronizacion.
//   - Solo ESCRIBE lo que de verdad cambio: una plantilla cuyo estado/enlace ya coincide se
//     cuenta como `sinCambios` y no se toca (ni su `updatedAt`).
//   - Un `inactivo` local NO se revierte desde Meta (lo garantiza el repo).
import type { PlantillaEstado } from "@prisma/client";
import type { WhatsappPlantillasClient } from "@/lib/clients/whatsapp-cloud";
import type { IPlantillaMensajeRepository } from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";

/** Conteos de una corrida (sin PII: solo agregados). */
export interface SincronizarPlantillasResult {
  /** Templates devueltos por Meta. */
  leidas: number;
  /** Plantillas locales que TENIAN algo distinto y se escribieron. */
  actualizadas: number;
  /** Plantillas locales que ya coincidian: se dejaron intactas. */
  sinCambios: number;
  /** Templates de Meta sin plantilla local con ese nombre: se ignoran (ya no se importan). */
  ignoradas: number;
}

// BORRADO 2026-08-27: `extraerCuerpoDeComponents` (y su schema zod) leian el texto del
// componente BODY de un template de Meta para IMPORTARLO como cuerpo local. Sin importacion no
// tienen a quien servir: el cuerpo local es el que escribio el maestro y el sync no lo pisa.

/**
 * Traduce el status de revision de un template de Meta al enum local. APPROVED habilita el
 * envio (`activo`); REJECTED lo marca `refused`; cualquier otro estado intermedio (PENDING,
 * IN_APPEAL, PENDING_DELETION, ...) queda `pending`.
 */
export function mapEstadoMeta(status: string): PlantillaEstado {
  switch (status.toUpperCase()) {
    case "APPROVED":
      return "activo";
    case "REJECTED":
      return "refused";
    default:
      return "pending";
  }
}

export class SincronizarPlantillasWhatsappService {
  constructor(
    private readonly client: WhatsappPlantillasClient,
    private readonly repo: IPlantillaMensajeRepository,
  ) {}

  async sincronizar(): Promise<SincronizarPlantillasResult> {
    const templates = await this.client.listar();
    let actualizadas = 0;
    let sinCambios = 0;
    let ignoradas = 0;
    for (const t of templates) {
      const outcome = await this.repo.sincronizarTemplatePorNombre(t.nombre, {
        templateId: t.id,
        idioma: t.idioma,
        estado: mapEstadoMeta(t.status),
      });
      if (outcome === "actualizada") actualizadas += 1;
      else if (outcome === "sin_cambios") sinCambios += 1;
      else ignoradas += 1; // "inexistente": solo vive en Meta, y de ahi no se importa
    }
    return { leidas: templates.length, actualizadas, sinCambios, ignoradas };
  }
}
