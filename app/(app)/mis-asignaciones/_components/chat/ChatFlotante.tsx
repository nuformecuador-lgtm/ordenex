"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageCircle } from "lucide-react";
import useSWR from "swr";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useTonoAlIncrementar } from "@/hooks/useTonoAlIncrementar";
import { marcarChatLeido, resumenNoLeidosChat } from "@/lib/actions/chat-whatsapp";
import type { ResumenNoLeidosChatResult } from "@/lib/types/chat-whatsapp";
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
//
// SIN LEER. El botón flotante lleva un distintivo numérico con los entrantes pendientes y la
// lista repite el número en cada conversación. El dato es del SERVIDOR
// (`resumenNoLeidosChat`, marca `mensajero_leido_at` por hilo), no del dispositivo: el
// mensajero cambia de teléfono o limpia el navegador y el pendiente sigue ahí. Se sondea cada
// 15 s porque el repo no tiene realtime (misma razón que el hilo, que va a 10 s).
//
// LA CONVERSACIÓN ABIERTA NO CUENTA. Se descuenta del mapa antes de nada: tenerla delante ES
// leerla, así que ni pinta distintivo ni suma al total ni dispara el tono — de eso ya se
// ocupa `ChatConversacion` con su propio contador de entrantes. Sin esa resta, un entrante
// del hilo abierto sonaría DOS veces y su fila parpadearía con un 1 hasta el siguiente sondeo.

/** Sondeo del resumen de no leídos. Más laxo que el del hilo: es un contador, no el hilo. */
const REFRESH_NO_LEIDOS_MS = 15_000;

/** Tope del distintivo: por encima se pinta `+9` (el ancho de la burbuja es fijo). */
const BADGE_MAX = 9;

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

  const {
    data: resumen,
    isLoading,
    mutate,
  } = useSWR<ResumenNoLeidosChatResult>("chat-no-leidos", () => resumenNoLeidosChat(), {
    refreshInterval: REFRESH_NO_LEIDOS_MS,
  });

  // Conversación que el mensajero tiene DELANTE ahora mismo: con el modal cerrado no hay
  // ninguna, por muy seleccionada que quedara.
  const ordenAbiertaId = abierto ? (seleccionada?.id ?? null) : null;

  const noLeidos = useMemo(() => {
    const mapa = new Map<string, number>();
    if (resumen?.status !== "ok") return mapa;
    // Solo las órdenes que el chat lista: un pendiente de una orden que ya salió de reparto
    // no tiene fila donde abrirse, y un distintivo que no se puede vaciar no se apaga nunca.
    const enChat = new Set(ordenes.map((o) => o.id));
    for (const c of resumen.conversaciones) {
      if (c.noLeidos <= 0) continue;
      if (!enChat.has(c.ordenId)) continue;
      if (c.ordenId === ordenAbiertaId) continue;
      mapa.set(c.ordenId, c.noLeidos);
    }
    return mapa;
  }, [resumen, ordenes, ordenAbiertaId]);

  let total = 0;
  for (const n of noLeidos.values()) total += n;

  // Tono al llegar un entrante con el chat CERRADO (o en otra conversación). `null` mientras
  // no hay dato real: la primera carga no puede leerse como un salto de 0 a N (R24 de la 161).
  useTonoAlIncrementar(isLoading || resumen?.status !== "ok" ? null : total);

  // Ver la conversación es leerla: se sella en el servidor y se revalida el resumen para que
  // el distintivo caiga sin esperar al sondeo. `pendientesAbierta` está en las dependencias
  // para volver a sellar cuando entra un mensaje con el hilo ya abierto.
  const pendientesAbierta =
    resumen?.status === "ok" && ordenAbiertaId !== null
      ? (resumen.conversaciones.find((c) => c.ordenId === ordenAbiertaId)?.noLeidos ?? 0)
      : 0;

  useEffect(() => {
    if (ordenAbiertaId === null || pendientesAbierta === 0) return;
    let vigente = true;
    void marcarChatLeido(ordenAbiertaId)
      .then(() => {
        if (vigente) void mutate();
      })
      // El sellado es best-effort: si falla, el distintivo sigue ahí y el próximo sondeo
      // vuelve a intentarlo. Nunca interrumpe al mensajero con un error.
      .catch(() => undefined);
    return () => {
      vigente = false;
    };
  }, [ordenAbiertaId, pendientesAbierta, mutate]);

  return (
    <>
      <button
        type="button"
        onClick={() => onAbiertoChange(true)}
        aria-label={
          total > 0
            ? `Abrir chat con clientes, ${total} sin leer`
            : "Abrir chat con clientes"
        }
        className="fixed bottom-5 right-5 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 active:scale-95"
      >
        <MessageCircle className="size-6" aria-hidden="true" />
        {total > 0 ? (
          // El distintivo es TEXTO, no un punto: el mensajero necesita saber CUÁNTOS. Mismos
          // tokens que la campana (`NotificationsBell`): `bg-danger` daba 3.76:1 con blanco en
          // los dos temas —por debajo del 4.5 de AA—, `-strong` + `text-background` es la
          // pareja contrast-safe. El borde del color del fondo lo despega del círculo naranja.
          <span
            data-testid="chat-no-leidos-total"
            className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-background bg-danger-strong px-1 text-[11px] font-semibold leading-none text-background"
          >
            {total > BADGE_MAX ? `+${BADGE_MAX}` : total}
          </span>
        ) : null}
      </button>

      <Dialog open={abierto} onOpenChange={handleAbiertoChange}>
        <DialogContent className="h-[85dvh] max-h-[46rem] w-[calc(100vw-1.5rem)] max-w-5xl gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">Chat con clientes</DialogTitle>
          <div className="flex min-h-0 flex-1 md:flex-row">
            <ChatOrdenesLista
              ordenes={ordenes}
              noLeidos={noLeidos}
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
