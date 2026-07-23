"use client";

import { useState, type FormEvent } from "react";
import { Send } from "lucide-react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/useToast";
import { enviarMensajeChat, listarHiloChat } from "@/lib/actions/chat-whatsapp";
import type {
  ChatMensajeVista,
  ListarHiloChatResult,
} from "@/lib/types/chat-whatsapp";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { EnviarPlantillaWhatsappButton } from "./EnviarPlantillaWhatsappButton";

// Feature 109 (design §5, R22-R24) — panel del chat del mensajero con el cliente de la
// orden en gestion. Co-ubicado en `mis-asignaciones/_components` (un solo consumidor:
// cuelga de `GestionarOrdenPanel`, regla anti-sobre-ingenieria de architecture.md).
//
// - R22: historial ordenado (el backend ya lo devuelve por `ocurrido_at`), burbujas
//   entrante (izquierda) / saliente (derecha) y badge del estado de entrega del saliente.
// - R23: dentro de la ventana de 24 h se habilita el input de texto libre; fuera de ella
//   se oculta y se ofrece `EnviarPlantillaWhatsappButton` (feature 107) como fallback.
// - R24 (D5): refresco por polling con SWR `refreshInterval` (~10 s), sin recarga manual.
//
// La AUTORIZACION la impone el backend (scope por `mensajeroAsignadoId` en las Server
// Actions); aqui solo se refleja el desenlace tipado.

/** Refresco del hilo cada 10 s (design.md D5). */
const REFRESH_INTERVAL_MS = 10_000;

export interface ChatWhatsappPanelProps {
  /** Orden en gestion: define el hilo (por su id) y el destino del fallback de plantilla. */
  orden: MiAsignacionDTO;
}

/** Etiqueta y variante del badge segun el estado de entrega del saliente (R22). */
const ESTADO_BADGE: Record<
  NonNullable<ChatMensajeVista["estado"]>,
  { label: string; variant: "secondary" | "info" | "success" | "danger" }
> = {
  queued: { label: "En cola", variant: "secondary" },
  sent: { label: "Enviado", variant: "info" },
  delivered: { label: "Entregado", variant: "info" },
  read: { label: "Leído", variant: "success" },
  failed: { label: "Falló", variant: "danger" },
};

/** Hora local (HH:MM) del evento, para acompañar cada burbuja. */
function horaCorta(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-CR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Una burbuja del hilo: alineacion y color segun la direccion (R22). */
function Burbuja({ mensaje }: { mensaje: ChatMensajeVista }) {
  const esSaliente = mensaje.direccion === "saliente";
  const estadoInfo = mensaje.estado ? ESTADO_BADGE[mensaje.estado] : null;

  return (
    <li
      className={`flex flex-col gap-0.5 ${esSaliente ? "items-end" : "items-start"}`}
      data-direccion={mensaje.direccion}
    >
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm break-words ${
          esSaliente
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm bg-muted text-foreground"
        }`}
      >
        {mensaje.cuerpo ?? ""}
      </div>
      <div className="flex items-center gap-1.5 px-1">
        <span className="text-[0.6875rem] text-muted-foreground">
          {horaCorta(mensaje.ocurridoAt)}
        </span>
        {/* Estado de entrega: solo salientes (R22). */}
        {estadoInfo ? (
          <Badge variant={estadoInfo.variant}>{estadoInfo.label}</Badge>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Panel del chat 1:1 mensajero <-> cliente de la orden. Lista el hilo con refresco
 * automatico y, dentro de la ventana de 24 h, permite responder con texto libre; fuera
 * de ella exige plantilla aprobada (feature 107).
 */
export function ChatWhatsappPanel({ orden }: Readonly<ChatWhatsappPanelProps>) {
  const toast = useToast();
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);

  // R24 / D5: polling con SWR. La Server Action `listarHiloChat` impone el scope del
  // mensajero (R16); aqui solo se consume su resultado tipado.
  const { data, isLoading, mutate } = useSWR<ListarHiloChatResult>(
    ["chat-hilo", orden.id],
    () => listarHiloChat(orden.id),
    { refreshInterval: REFRESH_INTERVAL_MS },
  );

  const hiloOk = data?.status === "ok" ? data : null;
  const mensajes = hiloOk?.mensajes ?? [];
  const ventanaAbierta = hiloOk?.ventanaAbierta ?? false;

  async function handleEnviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const limpio = texto.trim();
    if (!limpio || enviando) return;

    setEnviando(true);
    try {
      const res = await enviarMensajeChat(orden.id, limpio);
      switch (res.status) {
        case "ok":
          setTexto("");
          await mutate();
          break;
        case "transitorio":
          // R21: el mensaje quedo persistido (queued) y encolado para reintento.
          setTexto("");
          toast.info("Mensaje en cola; se reintentará el envío.");
          await mutate();
          break;
        case "fuera_ventana":
          // R19/R23: la ventana se cerró; refresca para revelar el fallback de plantilla.
          toast.error("La ventana de 24 h expiró. Envía una plantilla.");
          await mutate();
          break;
        case "no_configurado":
          toast.error("El envío por WhatsApp no está configurado.");
          break;
        case "forbidden":
          toast.error("No puedes responder este chat.");
          break;
        default:
          toast.error("Tu sesión expiró. Vuelve a entrar.");
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section
      aria-label="Chat con el cliente"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <h3 className="text-sm font-semibold">Chat con el cliente</h3>

      {/* Historial ordenado cronologicamente (R22). El backend ordena por ocurrido_at. */}
      {isLoading && !data ? (
        <p className="text-sm text-muted-foreground">Cargando conversación…</p>
      ) : data && data.status !== "ok" ? (
        <p role="alert" className="text-sm text-muted-foreground">
          No se pudo cargar la conversación.
        </p>
      ) : mensajes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aún no hay mensajes en esta conversación.
        </p>
      ) : (
        <ul
          aria-label="Historial de mensajes"
          className="flex max-h-72 flex-col gap-2 overflow-y-auto"
        >
          {mensajes.map((m) => (
            <Burbuja key={m.id} mensaje={m} />
          ))}
        </ul>
      )}

      {/* R23: dentro de la ventana -> texto libre; fuera -> fallback a plantilla (107). */}
      {ventanaAbierta ? (
        <form onSubmit={handleEnviar} className="flex items-center gap-2">
          <Input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Escribe un mensaje…"
            aria-label="Mensaje para el cliente"
            maxLength={4096}
            disabled={enviando}
          />
          <Button
            type="submit"
            size="icon"
            className="shrink-0"
            loading={enviando}
            disabled={enviando || texto.trim().length === 0}
            aria-label="Enviar mensaje"
          >
            <Send className="size-4" aria-hidden="true" />
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Fuera de la ventana de 24 h. Envía una plantilla aprobada para retomar
            la conversación.
          </p>
          <div>
            <EnviarPlantillaWhatsappButton orden={orden} size="sm" />
          </div>
        </div>
      )}
    </section>
  );
}
