"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  MapPin,
  Package,
  Send,
} from "lucide-react";
import useSWR from "swr";

import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import {
  enviarMensajeChat,
  enviarPlantillaChat,
  listarHiloChat,
} from "@/lib/actions/chat-whatsapp";
import { listarPlantillasActivasParaEnvio } from "@/lib/actions/whatsapp-envio";
import { renderPlantilla } from "@/lib/utils/plantilla-mensaje";
import { resolverValoresOrden } from "@/lib/utils/whatsapp-envio-valores";
import type {
  ChatMensajeVista,
  ListarHiloChatResult,
} from "@/lib/types/chat-whatsapp";
import type { OrdenEnvioData, PlantillaTextoDTO } from "@/lib/types/whatsapp-envio";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { UbicacionModal } from "../UbicacionModal";
import type { UbicacionPunto } from "../ubicacion-mapa-tipos";
import {
  ESTADO_CHIP,
  estadoDe,
  guiaVisible,
  horaCorta,
  iniciales,
  nombrePlantilla,
} from "./chat-demo-data";
import { formatMonto } from "../pos-card/pos-format";

// Rediseño del chat (rama ux) — columna derecha del chat separado: hilo REAL de la orden,
// plantillas REALES y composer.
//
// Lee la MISMA fuente que el chat del detalle (`ChatWhatsappPanel`): `listarHiloChat` con
// polling SWR, así que los mensajes se ven en los dos sitios y ninguno queda desfasado.
// Las plantillas son las de `listarPlantillasParaEnvio` (feature 87), las mismas que
// ofrece la burbuja del detalle, renderizadas con los datos de esta orden.
//
// Regla del composer (la impone el BACKEND; aquí solo se refleja): mientras el cliente no
// haya respondido ni una vez, el texto libre está DESHABILITADO y la única vía es una
// plantilla aprobada — al elegirla se rellena el composer en solo-lectura y ya se puede
// enviar. Con un entrante en el hilo, el texto libre se habilita.

/** Refresco del hilo cada 10 s (mismo intervalo que el panel del detalle). */
const REFRESH_INTERVAL_MS = 10_000;

/** Alto máximo del composer antes de empezar a hacer scroll (~6 líneas). */
const COMPOSER_MAX_PX = 128;

function Acuses({ estado }: { estado: ChatMensajeVista["estado"] }) {
  if (estado === null) return null;
  if (estado === "queued" || estado === "sent")
    return <Check className="size-3.5 text-muted-foreground" aria-hidden="true" />;
  if (estado === "delivered")
    return <CheckCheck className="size-3.5 text-muted-foreground" aria-hidden="true" />;
  if (estado === "read")
    return <CheckCheck className="size-3.5 text-info-strong" aria-hidden="true" />;
  return (
    <span className="text-[10px] font-medium text-danger-strong">Falló</span>
  );
}

function Burbuja({
  mensaje,
  onAbrirUbicacion,
}: {
  mensaje: ChatMensajeVista;
  onAbrirUbicacion: (punto: UbicacionPunto) => void;
}) {
  const saliente = mensaje.direccion === "saliente";
  // Feature 121 (R9/R15): un mensaje de ubicación se pinta como botón con pin (nunca se
  // vuelcan las coordenadas al DOM visible); alimenta el minimapa del modal.
  const esUbicacion =
    mensaje.tipo === "ubicacion" &&
    mensaje.latitud !== null &&
    mensaje.longitud !== null;

  return (
    <li
      className={cn("flex", saliente ? "justify-end" : "justify-start")}
      data-direccion={mensaje.direccion}
    >
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm md:max-w-[65%]",
          saliente
            ? "rounded-br-sm bg-accent text-accent-foreground"
            : "rounded-bl-sm bg-card text-card-foreground",
        )}
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
            className="flex items-center gap-1.5 rounded-sm text-xs font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            Ubicación compartida
          </button>
        ) : (
          <p className="whitespace-pre-wrap break-words leading-relaxed">
            {mensaje.cuerpo ?? ""}
          </p>
        )}
        <div className="mt-1 flex items-center justify-end gap-1">
          <span className="text-[10px] text-muted-foreground">
            {horaCorta(mensaje.ocurridoAt)}
          </span>
          {saliente ? <Acuses estado={mensaje.estado} /> : null}
        </div>
      </div>
    </li>
  );
}

/** Borrador del composer: texto visible + plantilla de la que provino (si vino de una). */
interface Borrador {
  texto: string;
  plantillaId: string | null;
}

const BORRADOR_VACIO: Borrador = { texto: "", plantillaId: null };

export interface ChatConversacionProps {
  orden: MiAsignacionDTO | null;
  onVolver: () => void;
  className?: string;
}

export function ChatConversacion({
  orden,
  onVolver,
  className,
}: Readonly<ChatConversacionProps>) {
  const toast = useToast();
  const [borrador, setBorrador] = useState<Borrador>(BORRADOR_VACIO);
  const [enviando, setEnviando] = useState(false);
  const [ubicacionCliente, setUbicacionCliente] = useState<UbicacionPunto | null>(
    null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const ordenId = orden?.id ?? null;

  // Hilo REAL con polling. La Server Action impone el scope del mensajero (R16); aquí solo
  // se consume su resultado tipado. Misma clave que usa el panel del detalle, así que SWR
  // comparte caché entre los dos y ambos ven lo mismo.
  const { data, isLoading, mutate } = useSWR<ListarHiloChatResult>(
    ordenId === null ? null : ["chat-hilo", ordenId],
    () => listarHiloChat(ordenId as string),
    { refreshInterval: REFRESH_INTERVAL_MS },
  );

  // Catálogo de plantillas: solo las ACTIVAS (vigentes, `estado: activo` y enlazadas con
  // Meta), que son las que el chat puede enviar de verdad. Clave estática ⇒ se pide una vez
  // y se reutiliza al cambiar de conversación.
  const { data: plantillasRes } = useSWR(
    "chat-plantillas-activas",
    listarPlantillasActivasParaEnvio,
    { revalidateOnFocus: false },
  );
  const plantillas: PlantillaTextoDTO[] =
    plantillasRes?.status === "ok" ? plantillasRes.items : [];

  const hiloOk = data?.status === "ok" ? data : null;
  const mensajes = hiloOk?.mensajes ?? [];
  // El cliente respondió al menos una vez ⇒ se habilita el texto libre. Ya enviamos una
  // plantilla y sigue sin responder ⇒ no se ofrece otra (misma regla que el detalle).
  const hayEntrante = mensajes.some((m) => m.direccion === "entrante");
  const haySaliente = mensajes.some((m) => m.direccion === "saliente");
  const plantillasBloqueadas = !hayEntrante && haySaliente;

  // Datos de la orden para resolver las variables de cada plantilla.
  const ordenEnvio = useMemo<OrdenEnvioData | null>(
    () =>
      orden === null
        ? null
        : {
            destinatario: orden.destinatario,
            telefonoDest: orden.telefonoDest,
            numGuia: orden.numGuia,
            numRemision: orden.numRemision,
            producto: orden.producto,
            direccion: orden.direccion,
            montoCobrar: orden.montoCobrar,
            // El envío real lo hace el backend, que resuelve el nombre del mensajero.
            mensajeroNombre: "",
          },
    [orden],
  );

  /** Cuerpo de una plantilla ya renderizado con los datos de esta orden. */
  function renderizar(plantilla: PlantillaTextoDTO): string {
    if (ordenEnvio === null) return plantilla.cuerpo;
    return renderPlantilla(
      plantilla.cuerpo,
      resolverValoresOrden(plantilla.variables, ordenEnvio),
    );
  }

  // Ancla el hilo abajo al cambiar de orden o al llegar/enviar un mensaje.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [ordenId, mensajes.length]);

  // El borrador NO se limpia aquí al cambiar de orden: el padre remonta este componente
  // con `key={orden.id}`, así que arranca vacío por construcción (una plantilla se elige
  // POR orden y nunca se arrastra a otra conversación).

  // El textarea crece con el texto (auto-size) hasta el tope, y ahí hace scroll. Se mide
  // tras cada cambio del borrador, así también se ajusta al pegar una plantilla larga.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_PX)}px`;
  }, [borrador.texto, ordenId]);

  if (!orden) {
    return (
      <section
        className={cn(
          "flex-col items-center justify-center gap-3 bg-muted p-8 text-center",
          className,
        )}
      >
        <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
          <Package className="size-7 text-primary" aria-hidden="true" />
        </div>
        <div>
          <p className="text-base font-semibold text-foreground">
            Selecciona una orden
          </p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            Elige una conversación de la lista para escribirle al destinatario.
          </p>
        </div>
      </section>
    );
  }

  const chip = ESTADO_CHIP[estadoDe(orden.estatusValue)];
  const puedeEnviar =
    !enviando &&
    borrador.texto.trim().length > 0 &&
    (hayEntrante || borrador.plantillaId !== null);
  // Sin respuesta del cliente el composer no acepta tecleo; con plantilla elegida muestra
  // su texto en solo-lectura (se enviará tal cual, como exige Meta fuera de ventana).
  const composerDeshabilitado =
    enviando || (!hayEntrante && borrador.plantillaId === null);
  const composerSoloLectura = !hayEntrante;

  /** Elegir una plantilla rellena el composer y habilita el envío. */
  function elegirPlantilla(plantilla: PlantillaTextoDTO) {
    if (plantillasBloqueadas) return;
    setBorrador({ texto: renderizar(plantilla), plantillaId: plantilla.id });
    composerRef.current?.focus();
  }

  /** Envío DENTRO de la ventana: texto libre. El backend revalida la ventana. */
  async function enviarTextoLibre(texto: string) {
    const res = await enviarMensajeChat(orden!.id, texto);
    switch (res.status) {
      case "ok":
        setBorrador(BORRADOR_VACIO);
        await mutate();
        break;
      case "transitorio":
        setBorrador(BORRADOR_VACIO);
        toast.info("Mensaje en cola; se reintentará el envío.");
        await mutate();
        break;
      case "fuera_ventana":
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

  /** Envío FUERA de la ventana: solo plantilla aprobada (nunca texto libre). */
  async function enviarComoPlantilla(plantillaId: string) {
    const res = await enviarPlantillaChat(orden!.id, plantillaId);
    switch (res.status) {
      case "ok":
        setBorrador(BORRADOR_VACIO);
        await mutate();
        break;
      case "transitorio":
        setBorrador(BORRADOR_VACIO);
        toast.info("Plantilla en cola; se reintentará el envío.");
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

  async function enviar() {
    const texto = borrador.texto.trim();
    if (texto === "" || enviando) return;
    setEnviando(true);
    try {
      if (hayEntrante) {
        await enviarTextoLibre(texto);
      } else if (borrador.plantillaId !== null) {
        await enviarComoPlantilla(borrador.plantillaId);
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className={cn("h-full min-h-0 flex-col bg-muted", className)}>
      {/* `pr-12` deja libre la esquina donde el Dialog pinta su botón de cerrar. */}
      <header className="flex items-center gap-3 border-b border-border bg-card px-3 py-2.5 pr-12 md:px-4 md:pr-14">
        <button
          type="button"
          onClick={onVolver}
          className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground md:hidden"
          aria-label="Volver a la lista"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </button>

        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground"
          aria-hidden="true"
        >
          {iniciales(orden.destinatario)}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {orden.destinatario}
          </p>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] text-muted-foreground">
              {guiaVisible(orden)}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium leading-none",
                chip.className,
              )}
            >
              {chip.label}
            </span>
          </div>
        </div>

        <div className="hidden text-right sm:block">
          <p className="text-sm font-semibold text-foreground">
            {formatMonto(orden.montoCobrar)}
          </p>
          <p className="text-[11px] text-muted-foreground">A cobrar</p>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6"
      >
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
          <ul aria-label="Historial de mensajes" className="flex flex-col gap-1.5">
            {mensajes.map((m) => (
              <Burbuja
                key={m.id}
                mensaje={m}
                onAbrirUbicacion={setUbicacionCliente}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Plantillas disponibles (las mismas del detalle): elegirlas rellena el composer;
          no envían solas, el mensajero confirma con el botón de enviar. */}
      {plantillas.length > 0 ? (
        <div
          role="group"
          aria-label="Plantillas disponibles"
          className="flex gap-2 overflow-x-auto border-t border-border bg-card/60 px-3 py-2 md:px-4"
        >
          {plantillas.map((plantilla) => {
            const elegida = borrador.plantillaId === plantilla.id;
            return (
              <button
                key={plantilla.id}
                type="button"
                onClick={() => elegirPlantilla(plantilla)}
                disabled={plantillasBloqueadas}
                aria-pressed={elegida}
                title={renderizar(plantilla)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  elegida
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {nombrePlantilla(plantilla.nombre)}
              </button>
            );
          })}
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
        className="flex flex-col gap-1.5 border-t border-border bg-card px-3 py-3 md:px-4"
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={composerRef}
            value={borrador.texto}
            onChange={(e) =>
              // Teclear texto libre desmarca la plantilla: pasa a ser un mensaje propio.
              setBorrador({ texto: e.target.value, plantillaId: null })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void enviar();
              }
            }}
            rows={1}
            maxLength={4096}
            disabled={composerDeshabilitado}
            readOnly={composerSoloLectura && !composerDeshabilitado}
            placeholder={
              hayEntrante
                ? "Escribe un mensaje…"
                : "Elige una plantilla para iniciar la conversación"
            }
            aria-label="Mensaje para el destinatario"
            className="min-h-10 flex-1 resize-none overflow-y-auto rounded-2xl bg-muted px-4 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
          />

          <button
            type="submit"
            disabled={!puedeEnviar}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            aria-label="Enviar mensaje"
          >
            <Send className="size-[18px]" aria-hidden="true" />
          </button>
        </div>

        {/* Por qué está bloqueado el texto libre / qué se va a enviar. */}
        {!hayEntrante ? (
          <p className="px-1 text-[11px] text-muted-foreground">
            {plantillasBloqueadas
              ? "Ya enviaste una plantilla. Espera la respuesta del cliente para continuar."
              : borrador.plantillaId === null
                ? "El cliente aún no ha respondido: solo puedes enviar una plantilla aprobada."
                : "Se enviará la plantilla tal cual; no es editable hasta que el cliente responda."}
          </p>
        ) : null}
      </form>

      {/* Feature 121 (R10-R13): minimapa de una ubicación compartida, dentro de la misma
          ventana y sin recargar. */}
      <UbicacionModal
        punto={ubicacionCliente}
        onOpenChange={(abierto) => {
          if (!abierto) setUbicacionCliente(null);
        }}
      />
    </section>
  );
}
