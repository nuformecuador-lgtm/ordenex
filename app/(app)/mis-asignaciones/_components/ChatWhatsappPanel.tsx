"use client";

import { useState, type FormEvent } from "react";
import { MapPin, Send } from "lucide-react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/useToast";
import { useUbicacionActual, type Coords } from "@/hooks/useUbicacionActual";
import {
  enviarMensajeChat,
  enviarPlantillaChat,
  listarHiloChat,
} from "@/lib/actions/chat-whatsapp";
import type {
  ChatMensajeVista,
  ListarHiloChatResult,
} from "@/lib/types/chat-whatsapp";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { EnviarPlantillaWhatsappButton } from "./EnviarPlantillaWhatsappButton";
import { UbicacionMapa } from "./UbicacionMapa";
import type { UbicacionPunto } from "./ubicacion-mapa-tipos";

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

/**
 * Feature 120: borrador CONTROLADO del composer del chat. `texto` es lo que se ve en el input;
 * `plantillaId` != null marca que ese texto provino de una plantilla (se eligio desde la
 * burbuja). Fuera de la ventana de 24 h ese `plantillaId` decide si se puede enviar (Meta solo
 * acepta plantillas fuera de ventana). Vive en el padre (`GestionarOrdenPanel`) para que la
 * burbuja "junto al telefono" y este panel compartan el mismo borrador.
 */
export interface BorradorChat {
  texto: string;
  plantillaId: string | null;
}

/** Borrador vacio: input limpio y sin plantilla asociada. */
export const BORRADOR_CHAT_VACIO: BorradorChat = { texto: "", plantillaId: null };

export interface ChatWhatsappPanelProps {
  /** Orden en gestion: define el hilo (por su id) y el destino del fallback de plantilla. */
  orden: MiAsignacionDTO;
  /** Borrador controlado del composer (texto del input + plantilla asociada). */
  borrador: BorradorChat;
  /** Actualiza el borrador (al teclear, al elegir plantilla o al limpiar tras enviar). */
  onBorradorChange: (borrador: BorradorChat) => void;
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
function Burbuja({
  mensaje,
  onAbrirUbicacion,
}: {
  mensaje: ChatMensajeVista;
  /** Feature 121: abre el minimapa con las coordenadas de una burbuja de ubicacion (R10). */
  onAbrirUbicacion: (punto: UbicacionPunto) => void;
}) {
  const esSaliente = mensaje.direccion === "saliente";
  const estadoInfo = mensaje.estado ? ESTADO_BADGE[mensaje.estado] : null;
  // Feature 121 (R9): un entrante de tipo `ubicacion` con coordenadas se pinta como un boton
  // con pin en lugar de un cuerpo de texto vacio. Las coordenadas NUNCA se vuelcan al DOM
  // visible (R15): solo alimentan el `onClick` que abre el minimapa.
  const esUbicacion =
    mensaje.tipo === "ubicacion" &&
    mensaje.latitud !== null &&
    mensaje.longitud !== null;

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
        {esUbicacion ? (
          <button
            type="button"
            onClick={() =>
              onAbrirUbicacion({
                lat: mensaje.latitud as number,
                lng: mensaje.longitud as number,
              })
            }
            aria-label="Ver ubicación compartida"
            className="flex items-center gap-1.5 text-xs font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-sm"
          >
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            Ubicación compartida
          </button>
        ) : (
          (mensaje.cuerpo ?? "")
        )}
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
export function ChatWhatsappPanel({
  orden,
  borrador,
  onBorradorChange,
}: Readonly<ChatWhatsappPanelProps>) {
  const toast = useToast();
  const [enviando, setEnviando] = useState(false);

  // Feature 121 (R10-R13): una sola ubicacion seleccionada a la vez. `ubicacionCliente != null`
  // = modal abierto con ese punto. El GPS del repartidor se pide LAZY al abrir (P3), nunca al
  // montar el panel; `gpsPedido` distingue "aun capturando" de "ya se intento y fallo" (R12).
  const { pedirUbicacion, denegado } = useUbicacionActual();
  const [ubicacionCliente, setUbicacionCliente] = useState<UbicacionPunto | null>(
    null,
  );
  const [gpsRepartidor, setGpsRepartidor] = useState<Coords | null>(null);
  const [gpsPedido, setGpsPedido] = useState(false);

  /**
   * Feature 121 (R10/R11): abre el modal con el punto del cliente y, en el acto, pide el GPS
   * EN VIVO del repartidor (lazy, P3). `pedirUbicacion` nunca lanza: resuelve `Coords` o `null`.
   */
  async function abrirUbicacion(punto: UbicacionPunto) {
    setUbicacionCliente(punto);
    setGpsRepartidor(null);
    setGpsPedido(false);
    const coords = await pedirUbicacion();
    setGpsRepartidor(coords);
    setGpsPedido(true);
  }

  /** Cierra el modal sin recargar (R13); el hilo y su refresco siguen vivos. */
  function cerrarUbicacion(abierto: boolean) {
    if (!abierto) setUbicacionCliente(null);
  }

  // R24 / D5: polling con SWR. La Server Action `listarHiloChat` impone el scope del
  // mensajero (R16); aqui solo se consume su resultado tipado.
  const { data, isLoading, mutate } = useSWR<ListarHiloChatResult>(
    ["chat-hilo", orden.id],
    () => listarHiloChat(orden.id),
    { refreshInterval: REFRESH_INTERVAL_MS },
  );

  const hiloOk = data?.status === "ok" ? data : null;
  const mensajes = hiloOk?.mensajes ?? [];
  // Feature 120 (pedido humano): en cuanto el cliente respondio AL MENOS UNA vez (hay un
  // mensaje entrante en el hilo) se habilita el input de texto libre y se OCULTA la burbuja de
  // plantillas: ya se puede conversar. El backend sigue siendo la defensa de la ventana de 24 h.
  const hayEntrante = mensajes.some((m) => m.direccion === "entrante");
  // Feature 120 (pedido humano): si YA se envio una plantilla (hay un saliente) y el cliente
  // AUN NO respondio (no hay entrante), se BLOQUEA la burbuja para no reenviar otra plantilla
  // hasta que conteste. Como este bloque solo se pinta cuando `!hayEntrante`, basta con mirar
  // si existe algun saliente en el hilo.
  const haySaliente = mensajes.some((m) => m.direccion === "saliente");
  const burbujaBloqueada = !hayEntrante && haySaliente;

  /** Feature 120: al elegir una plantilla desde la burbuja, se pega su texto en el input. */
  function pegarPlantilla(plantilla: { id: string; textoRenderizado: string }) {
    onBorradorChange({ texto: plantilla.textoRenderizado, plantillaId: plantilla.id });
  }

  /** Feature 120: teclear texto libre desmarca la plantilla (pasa a ser un texto propio). */
  function editarTexto(texto: string) {
    onBorradorChange({ texto, plantillaId: null });
  }

  function limpiarBorrador() {
    onBorradorChange(BORRADOR_CHAT_VACIO);
  }

  /**
   * Feature 120 — envio DENTRO de la ventana: texto libre (`enviarMensajeChat`). El backend
   * sigue siendo la defensa (revalida la ventana); aqui solo el flujo feliz + `transitorio`.
   */
  async function enviarTextoLibre() {
    const limpio = borrador.texto.trim();
    if (!limpio) return;
    const res = await enviarMensajeChat(orden.id, limpio);
    switch (res.status) {
      case "ok":
        limpiarBorrador();
        await mutate();
        break;
      case "transitorio":
        // R21: el mensaje quedo persistido (queued) y encolado para reintento.
        limpiarBorrador();
        toast.info("Mensaje en cola; se reintentará el envío.");
        await mutate();
        break;
      case "permanente":
        // WhatsApp rechazó la petición y NO se reintenta: el motivo es accionable, así que se
        // muestra tal cual en vez del genérico (antes caía en `default`, "sesión expiró").
        toast.error(`WhatsApp rechazó el mensaje: ${res.detalle}`);
        await mutate();
        break;
      case "fuera_ventana":
        // R19/R23: la ventana se cerró; refresca para revelar el envío por plantilla.
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
  }

  /**
   * Feature 120 — envio FUERA de la ventana: solo plantilla aprobada (`enviarPlantillaChat`).
   * Requiere que el borrador provenga de una plantilla (`plantillaId`); nunca envia texto libre.
   */
  async function enviarComoPlantilla(plantillaId: string) {
    const res = await enviarPlantillaChat(orden.id, plantillaId);
    switch (res.status) {
      case "ok":
        limpiarBorrador();
        await mutate();
        break;
      case "transitorio":
        limpiarBorrador();
        toast.info("Plantilla en cola; se reintentará el envío.");
        await mutate();
        break;
      case "permanente":
        toast.error(`WhatsApp rechazó la plantilla: ${res.detalle}`);
        await mutate();
        break;
      case "not_found":
        toast.error("Esa plantilla ya no está disponible.");
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
  }

  async function handleEnviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true);
    try {
      if (hayEntrante) {
        await enviarTextoLibre();
      } else if (borrador.plantillaId !== null) {
        await enviarComoPlantilla(borrador.plantillaId);
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
            <Burbuja key={m.id} mensaje={m} onAbrirUbicacion={abrirUbicacion} />
          ))}
        </ul>
      )}

      {/* R23 + feature 120: dentro de la ventana -> texto libre (editable, con la burbuja para
          pegar una plantilla); fuera -> solo plantilla. Si ya se eligió una (plantillaId), se
          muestra su texto pegado con un aviso y el botón envía como plantilla; si no, se invita
          a elegir una. Nunca se envía texto libre fuera de la ventana (R19). */}
      {hayEntrante ? (
        <form onSubmit={handleEnviar} className="flex items-center gap-2">
          <Input
            value={borrador.texto}
            onChange={(e) => editarTexto(e.target.value)}
            placeholder="Escribe un mensaje…"
            aria-label="Mensaje para el cliente"
            maxLength={4096}
            disabled={enviando}
          />
          {/* Feature 120 (pedido humano): con el cliente ya respondiendo, la burbuja de
              plantillas se oculta; se conversa con texto libre. */}
          <Button
            type="submit"
            size="icon"
            className="shrink-0"
            loading={enviando}
            disabled={enviando || borrador.texto.trim().length === 0}
            aria-label="Enviar mensaje"
          >
            <Send className="size-4" aria-hidden="true" />
          </Button>
        </form>
      ) : borrador.plantillaId !== null ? (
        <form onSubmit={handleEnviar} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {/* Fuera de ventana el texto no es editable: se enviará la plantilla tal cual. */}
            <Input
              value={borrador.texto}
              readOnly
              aria-label="Mensaje para el cliente"
            />
            <EnviarPlantillaWhatsappButton
              orden={orden}
              size="sm"
              onElegirPlantilla={pegarPlantilla}
              disabled={burbujaBloqueada}
            />
            <Button
              type="submit"
              size="icon"
              className="shrink-0"
              loading={enviando}
              disabled={enviando}
              aria-label="Enviar plantilla"
            >
              <Send className="size-4" aria-hidden="true" />
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Badge variant="secondary">Se enviará como plantilla</Badge>
            <button
              type="button"
              onClick={limpiarBorrador}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              Quitar
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            {burbujaBloqueada
              ? "Ya enviaste una plantilla. Espera la respuesta del cliente para continuar."
              : "El cliente aún no ha respondido. Elige una plantilla aprobada para iniciar la conversación."}
          </p>
          <div>
            <EnviarPlantillaWhatsappButton
              orden={orden}
              size="sm"
              onElegirPlantilla={pegarPlantilla}
              disabled={burbujaBloqueada}
            />
          </div>
          {/* Hint corto mientras se espera al cliente (burbuja deshabilitada). */}
          {burbujaBloqueada ? (
            <p className="text-xs text-muted-foreground">
              Esperando la respuesta del cliente…
            </p>
          ) : null}
        </div>
      )}

      {/* Feature 121 (R10-R13): modal con el minimapa de una ubicacion compartida. Se abre
          DENTRO de la misma ventana (Dialog) y se cierra sin recargar. El minimapa (Leaflet) se
          monta via `next/dynamic({ ssr:false })` en `UbicacionMapa` (R14). */}
      <Dialog open={ubicacionCliente !== null} onOpenChange={cerrarUbicacion}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Ubicación compartida</DialogTitle>
            <DialogDescription>
              El punto compartido por el cliente y tu ubicación actual.
            </DialogDescription>
          </DialogHeader>
          {ubicacionCliente ? (
            <UbicacionMapa
              cliente={ubicacionCliente}
              repartidor={gpsRepartidor}
            />
          ) : null}
          {/* R12: sin GPS del repartidor (denegado/timeout) el mapa pinta solo el punto del
              cliente y se avisa, sin bloquear apertura ni cierre. */}
          {gpsPedido && gpsRepartidor === null ? (
            <p role="status" className="text-xs text-muted-foreground">
              {denegado
                ? "No se pudo obtener tu ubicación actual: el permiso de ubicación está denegado."
                : "No se pudo obtener tu ubicación actual."}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
