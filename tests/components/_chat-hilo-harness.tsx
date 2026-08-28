// @vitest-environment jsdom
// Feature 311 — arnes compartido de los tests de burbuja del hilo del mensajero.
//
// Los tres archivos de la feature (reacciones, burbuja de sistema, contenido por tipo) montan
// la MISMA superficie viva —`ChatConversacion` dentro de `ChatFlotante`— con el hilo mockeado.
// Se centraliza aqui para que cada test hable de lo suyo y no de fixtures.
import { render } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactElement } from "react";

import { ToastProvider } from "@/providers/ToastProvider";
import type {
  ChatMensajeVista,
  ListarHiloChatResult,
} from "@/lib/types/chat-whatsapp";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

export const ORDEN: MiAsignacionDTO = {
  id: "orden-1",
  numGuia: 12345,
  numRemision: "R-001",
  estatusValue: "en_reparto",
  destinatario: "María López",
  telefonoDest: "88887777",
  direccion: "Calle 1",
  producto: "Caja",
  peso: 1,
  montoCobrar: 5000,
  latitud: null,
  longitud: null,
  notas: null,
  tiendaNombre: "Tienda",
  zonaNombre: "Zona",
  provinciaNombre: "San José",
  cantonNombre: "Central",
  distritoNombre: "Carmen",
  secuenciaRuta: 1,
};

/** Una burbuja entrante de texto; cada test sobreescribe lo suyo. */
export function burbuja(extra: Partial<ChatMensajeVista> = {}): ChatMensajeVista {
  return {
    id: "m1",
    direccion: "entrante",
    tipo: "texto",
    cuerpo: "Hola",
    estado: null,
    latitud: null,
    longitud: null,
    media: null,
    contactos: null,
    sistema: null,
    reacciones: [],
    ocurridoAt: "2026-08-27T15:00:00.000Z",
    ...extra,
  };
}

export function okHilo(mensajes: ChatMensajeVista[]): ListarHiloChatResult {
  return {
    status: "ok",
    ventanaAbierta: true,
    ultimoEntranteAt: "2026-08-27T15:00:00.000Z",
    plantillaBloqueada: false,
    textoLibreHabilitado: true,
    mensajes,
  };
}

// jsdom no implementa `Element.scrollTo` y el hilo se ancla abajo en cada mensaje nuevo.
if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = function scrollToStub() {};
}

export function renderChat(ui: ReactElement) {
  return render(
    <SWRConfig
      value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}
    >
      <ToastProvider>{ui}</ToastProvider>
    </SWRConfig>,
  );
}
