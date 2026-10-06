import {
  listarEventosDisponibles,
  listarInformesWhatsapp,
  previsualizarDestinatarios,
} from "@/lib/actions/envios-whatsapp";
import { listarPlantillasCompleto } from "@/lib/actions/plantillas";
import {
  ROLES_DESTINATARIO,
  type DestinatarioPreviewDTO,
  type EventoDisponibleDTO,
  type InformeDTO,
} from "@/lib/types/envios-whatsapp";

import type { PlantillaDeInformeOpcion } from "./EnvioForm";

export interface DatosFormularioEnvio {
  informes: InformeDTO[];
  eventos: EventoDisponibleDTO[];
  plantillas: PlantillaDeInformeOpcion[];
  personas: DestinatarioPreviewDTO[];
}

/**
 * Ficha 474 — lo que el formulario de un envío necesita, leído en el SERVIDOR (la página ya
 * verificó que es maestro). Todo sale de las actions del contrato (`progress/impl_474.md`): el
 * catálogo de informes NO se importa aquí ni en el cliente (arrastra jspdf), llega por
 * `listarInformesWhatsapp()`.
 *
 * - Plantillas: solo las DE INFORME aprobadas (activas y enlazadas con Meta), lo único que R12 deja
 *   guardar; la maqueta dice «Solo aparecen las plantillas aprobadas por WhatsApp».
 * - Personas: la lista resuelta de los cinco roles permitidos. Da a la vez el conteo por rol de la
 *   maqueta («Admin 3») y el catálogo de «Además, estas personas», sin una lectura de usuarios
 *   aparte: son exactamente las personas que un envío puede alcanzar (activas, rol permitido).
 */
export async function cargarDatosFormulario(): Promise<DatosFormularioEnvio> {
  const [inf, ev, pl, pre] = await Promise.all([
    listarInformesWhatsapp(),
    listarEventosDisponibles(),
    listarPlantillasCompleto({}),
    previsualizarDestinatarios({ roles: [...ROLES_DESTINATARIO], usuarioIds: [] }),
  ]);
  const plantillas: PlantillaDeInformeOpcion[] =
    pl.status === "ok"
      ? pl.items
          .filter((p) => p.informeClave && p.estado === "activo" && p.templateId !== null)
          .map((p) => ({
            id: p.id,
            nombre: p.nombre,
            cuerpo: p.cuerpo,
            informeClave: p.informeClave as string,
            llevaDocumento: p.llevaDocumento === true,
          }))
      : [];
  return {
    informes: inf.status === "ok" ? inf.informes : [],
    eventos: ev.status === "ok" ? ev.eventos : [],
    plantillas,
    personas: pre.status === "ok" ? pre.preview.destinatarios : [],
  };
}
