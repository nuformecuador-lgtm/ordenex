"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { ChatConversacion } from "./ChatConversacion";
import { ChatOrdenesLista } from "./ChatOrdenesLista";

// Rediseño del chat (rama ux) — botón flotante del chat del mensajero. Vive fijo en la
// esquina inferior derecha del módulo "Mis asignaciones" y abre el chat como MODAL (Dialog
// centrado, misma ventana, sin navegar).
//
// Contactos = las órdenes EN REPARTO (una por destinatario). Abrir el chat entra por la
// conversación de la orden en DETALLE. El hilo y las plantillas son los REALES
// (`listarHiloChat`). Convivió con el chat del panel del detalle (`ChatWhatsappPanel`), que
// leía la misma fuente; ese panel se borró el 2026-08-07 por decisión humana al quedarse sin
// montaje, y esta ruta flotante es desde entonces la única entrada al hilo.
//
// Layout del modal: dos columnas en ≥md (lista | conversación). En móvil solo se ve una a
// la vez y el header de la conversación trae la flecha de "volver a la lista".

export interface ChatFlotanteProps {
  /**
   * Órdenes EN REPARTO del mensajero: cada una aporta un contacto (su destinatario).
   * Las de "Por recoger" quedan fuera: todavía no hay gestión que conversar.
   */
  ordenes: MiAsignacionDTO[];
  /**
   * Orden EN GESTIÓN = la que el módulo muestra en detalle ahora mismo, de entre las
   * que están en reparto. `null` si no hay ninguna en detalle.
   */
  ordenEnDetalleId: string | null;
  /**
   * Estado CONTROLADO de apertura: lo dueña el módulo para que el panel del detalle pueda
   * abrir el chat desde su acción "Mensaje", no solo el botón flotante.
   */
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
}

export function ChatFlotante({
  ordenes,
  ordenEnDetalleId,
  abierto,
  onAbiertoChange,
}: Readonly<ChatFlotanteProps>) {
  const [seleccionadaId, setSeleccionadaId] = useState<string | null>(null);
  // En móvil solo cabe una columna: con una orden en detalle se entra directo a su
  // conversación; sin ninguna, a la lista. Se resincroniza al cerrar el modal.
  const [vistaMovil, setVistaMovil] = useState<"lista" | "chat">(
    ordenEnDetalleId === null ? "lista" : "chat",
  );

  // Conversación mostrada: la elegida dentro del modal si sigue existiendo y, si no, la de
  // la orden en detalle (o la primera en reparto).
  const seleccionada =
    ordenes.find((o) => o.id === seleccionadaId) ??
    ordenes.find((o) => o.id === ordenEnDetalleId) ??
    ordenes[0] ??
    null;

  /**
   * Abrir el chat SIEMPRE entra por la conversación de la orden en DETALLE: es la que el
   * mensajero está gestionando. Al CERRAR se olvida la conversación elegida (y la columna
   * del móvil), así que la próxima apertura —venga del botón flotante o de la acción
   * "Mensaje" del detalle— vuelve a entrar por la del detalle. Se resuelve en el handler
   * del cierre, no en un efecto sobre `abierto`.
   */
  function handleAbiertoChange(siguiente: boolean) {
    if (!siguiente) {
      setSeleccionadaId(null);
      setVistaMovil(ordenEnDetalleId === null ? "lista" : "chat");
    }
    onAbiertoChange(siguiente);
  }

  function seleccionar(id: string) {
    setSeleccionadaId(id);
    setVistaMovil("chat");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => onAbiertoChange(true)}
        aria-label="Abrir chat con clientes"
        className="fixed bottom-5 right-5 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 active:scale-95"
      >
        <MessageCircle className="size-6" aria-hidden="true" />
      </button>

      <Dialog open={abierto} onOpenChange={handleAbiertoChange}>
        <DialogContent className="h-[85dvh] max-h-[46rem] w-[calc(100vw-1.5rem)] max-w-5xl gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">Chat con clientes</DialogTitle>
          <div className="flex min-h-0 flex-1 md:flex-row">
            <ChatOrdenesLista
              ordenes={ordenes}
              seleccionadaId={seleccionada?.id ?? null}
              ordenEnDetalleId={ordenEnDetalleId}
              onSeleccionar={seleccionar}
              className={
                vistaMovil === "chat"
                  ? "hidden w-full md:flex md:w-[19rem] md:shrink-0 lg:w-[22rem]"
                  : "flex w-full md:w-[19rem] md:shrink-0 lg:w-[22rem]"
              }
            />
            {/* El chat se REMONTA al cambiar de orden (`key`): borrador, hilo y plantilla
                elegida arrancan limpios, sin arrastrar estado de la conversación anterior. */}
            <ChatConversacion
              key={seleccionada?.id ?? "vacio"}
              orden={seleccionada}
              onVolver={() => setVistaMovil("lista")}
              className={
                vistaMovil === "chat"
                  ? "flex w-full min-w-0"
                  : "hidden w-full min-w-0 md:flex"
              }
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
