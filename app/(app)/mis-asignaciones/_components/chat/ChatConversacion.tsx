"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCheck,
  FileText,
  ImageUp,
  Mic,
  Package,
  Paperclip,
  Phone,
  Send,
  X,
} from "lucide-react";
import useSWR from "swr";

import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { useTonoAlIncrementar } from "@/hooks/useTonoAlIncrementar";
import {
  enviarMediaChat,
  enviarMensajeChat,
  enviarPlantillaChat,
  listarHiloChat,
} from "@/lib/actions/chat-whatsapp";
import {
  CALIDAD_JPEG_ENVIO,
  clasificarAdjunto,
  LIMITE_BYTES,
  MAX_CAPTION,
  MAX_LADO_LARGO_ENVIO,
  validarAdjunto,
  type TipoAdjuntoEnvio,
} from "@/lib/config/chat-media-envio";
import { comprimirImagen } from "@/lib/utils/comprimir-imagen";
import { normalizarTelefonoCR } from "@/lib/utils/telefono-cr";
import { listarPlantillasActivasParaEnvio } from "@/lib/actions/whatsapp-envio";
import { renderPlantilla } from "@/lib/utils/plantilla-mensaje";
import { datosPlantillaDesdeAsignacion } from "@/lib/utils/whatsapp-envio-valores";
import { resolverValoresPlantilla, type DatosPlantilla } from "@/lib/types/plantilla-datos";
import type {
  ChatMensajeVista,
  ListarHiloChatResult,
} from "@/lib/types/chat-whatsapp";
import type { PlantillaTextoDTO } from "@/lib/types/whatsapp-envio";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { useGrabadorVoz } from "./hooks/useGrabadorVoz";
import { UbicacionModal } from "../UbicacionModal";
import type { UbicacionPunto } from "../ubicacion-mapa-tipos";
import { BurbujaContenido } from "./BurbujaContenido";
import { BurbujaSistema } from "./BurbujaSistema";
import { Reacciones } from "./Reacciones";
import {
  ESTADO_CHIP,
  estadoDe,
  guiaVisible,
  horaCorta,
  iniciales,
  nombrePlantilla,
} from "./chat-format";
import { formatMonto } from "../pos-card/pos-format";

// Rediseño del chat (rama ux) — columna derecha del chat separado: hilo REAL de la orden,
// plantillas REALES y composer.
//
// Lee el hilo con `listarHiloChat` y polling SWR. Hasta el 2026-08-07 convivía con el chat
// del panel del detalle (`ChatWhatsappPanel`), que leía esa MISMA fuente; ese panel se borró
// por decisión humana tras quedarse sin montaje, así que ésta es hoy la ÚNICA superficie del
// hilo. Las plantillas son las de `listarPlantillasParaEnvio` (feature 87), las mismas que
// ofrece `EnviarPlantillaWhatsappButton` en el panel de gestión, renderizadas con los datos
// de esta orden.
//
// Regla del composer (la impone el BACKEND; aquí solo se refleja): mientras el cliente no
// haya respondido ni una vez, el texto libre está DESHABILITADO y la única vía es una
// plantilla aprobada — al elegirla se rellena el composer en solo-lectura y ya se puede
// enviar. Con un entrante en el hilo, el texto libre se habilita.

/** Refresco del hilo cada 10 s (mismo intervalo que el panel del detalle). */
const REFRESH_INTERVAL_MS = 10_000;

/** Alto máximo del composer antes de empezar a hacer scroll (~6 líneas). */
const COMPOSER_MAX_PX = 128;

// Feature 316 (design §6.1) — el composer gana un adjunto. Todo lo de aquí abajo es de esa
// feature; el camino del texto libre y el de la plantilla no cambian.

/** Tope de caracteres del composer SIN adjunto (el de un mensaje de texto de Meta). */
const MAX_TEXTO_LIBRE = 4096;

/** `accept` de cámara y archivo. Se deja `image/*` A PROPÓSITO (design §6.1): con la
 * normalización de R29 el HEIC del iPhone SÍ se puede elegir, y cerrar el `accept` a
 * `image/jpeg,image/png` le escondería al usuario de iOS sus propias fotos en el selector. La
 * lista blanca se aplica DESPUÉS de normalizar, que es donde tiene sentido. */
const ACCEPT_MEDIA = "image/*,video/mp4,video/3gpp";

/** `accept` de la vía de documentos: los cinco MIME de la política más sus extensiones. */
const ACCEPT_DOCUMENTO =
  "application/pdf,application/msword," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.ms-excel," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  ".pdf,.doc,.docx,.xls,.xlsx";

/**
 * R9: el archivo no se puede enviar por su TIPO. Texto deliberadamente DISTINTO del de R31: uno
 * dice "esto no se manda por WhatsApp" y el otro "tu foto no se pudo preparar"; confundirlos
 * haría que el mensajero tirara una foto válida creyendo que el formato no vale.
 */
const AVISO_TIPO_NO_PERMITIDO = "Ese tipo de archivo no se puede enviar por WhatsApp.";

/** R31: la conversión a JPEG no se pudo completar (el navegador no supo decodificar la foto). */
const AVISO_NO_CONVERTIBLE =
  "No se pudo preparar la foto. Vuelve a tomarla o elige otra imagen.";

/** Aviso previo del tope del vídeo, ANTES de abrir la cámara (D8/R10). */
const AVISO_LIMITE_VIDEO = "El vídeo no puede pasar de 16 MB.";

const AVISO_ADJUNTO_BLOQUEADO =
  "Tampoco puedes enviar fotos, vídeos, notas de voz ni documentos hasta que el cliente responda.";

/** Adjunto ya normalizado y validado, esperando en el composer (R4). */
interface AdjuntoComposer {
  archivo: File;
  /** `URL.createObjectURL` de la previsualización; `null` en documento. Se revoca al quitarlo. */
  previewUrl: string | null;
  tipo: TipoAdjuntoEnvio;
}

/** Megabytes enteros del límite, para que el aviso diga CUÁL era (R10). */
function limiteLegible(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

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
  // Feature 311 (R32): el cambio de numero del cliente es una fila de SISTEMA, centrada y sin
  // `data-direccion`: no la escribio ninguno de los dos.
  if (mensaje.tipo === "sistema") {
    return <BurbujaSistema sistema={mensaje.sistema} ocurridoAt={mensaje.ocurridoAt} />;
  }

  const saliente = mensaje.direccion === "saliente";

  return (
    <li
      className={cn("flex flex-col", saliente ? "items-end" : "items-start")}
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
        {/* Feature 311 (R14/R27): QUE se pinta lo decide un switch EXHAUSTIVO por tipo. Aqui
            ya no se ramifica a mano ni queda un `<p>` vacio para lo desconocido. */}
        <BurbujaContenido mensaje={mensaje} onAbrirUbicacion={onAbrirUbicacion} />
        <div className="mt-1 flex items-center justify-end gap-1">
          <span className="text-[10px] text-muted-foreground">
            {horaCorta(mensaje.ocurridoAt)}
          </span>
          {saliente ? <Acuses estado={mensaje.estado} /> : null}
        </div>
      </div>
      {/* Feature 311 (R30/D4): las reacciones van DENTRO del `<li>` de su mensaje objetivo; el
          hilo no trae ninguna burbuja suelta de tipo `reaccion`. */}
      <Reacciones reacciones={mensaje.reacciones} saliente={saliente} />
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

  // Feature 316 (design §6.1): estado del adjunto del composer.
  const [adjunto, setAdjunto] = useState<AdjuntoComposer | null>(null);
  const [menuAdjuntar, setMenuAdjuntar] = useState(false);
  const [preparando, setPreparando] = useState(false);
  const [avisoAdjunto, setAvisoAdjunto] = useState<string | null>(null);
  const inputCamaraRef = useRef<HTMLInputElement>(null);
  const inputArchivoRef = useRef<HTMLInputElement>(null);
  const inputDocumentoRef = useRef<HTMLInputElement>(null);
  // El object URL vive en una ref ADEMÁS de en el estado: al desmontar hay que revocarlo y el
  // cleanup no puede leer el estado de un componente que ya se fue.
  const previewRef = useRef<string | null>(null);
  // R7: el candado del doble envío es una REF, no el `enviando` del estado. Dos clicks (o click
  // + Enter) dentro del mismo tick verían el estado viejo y dispararían dos envíos.
  const enviandoRef = useRef(false);

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
  // QUÉ SE PUEDE ENVIAR lo decide el SERVIDOR, y lo decide POR DÍA. Aquí vivían dos
  // predicados sobre el hilo entero (`!hayEntrante && haySaliente`) que ignoraban la fecha:
  // como el hilo sobrevive a las reasignaciones, un saliente de ayer dejaba el chat mudo
  // para siempre y el mensajero que recibía el paquete al día siguiente no podía ni mandar
  // plantilla ni escribir. `listarHiloChat` ahora mide contra el día calendario de CR.
  //
  // MIENTRAS EL HILO CARGA las dos van en `false`, que es el estado de arranque del día:
  // se puede elegir plantilla y no se puede teclear. Es también lo que se ve si la acción
  // responde `forbidden`, y es el lado conservador (nunca ofrece un envío que el servidor
  // vaya a rechazar).
  const plantillaBloqueada = hiloOk?.plantillaBloqueada ?? false;
  const textoLibreHabilitado = hiloOk?.textoLibreHabilitado ?? false;

  // Feature 161 (R21-R23): tono cuando el refresco de 10 s trae un mensaje NUEVO del
  // cliente. Se cuentan SOLO los entrantes, de modo que un saliente propio no suene (R22).
  //
  // Este enganche vivía en `ChatWhatsappPanel` (el chat del detalle de la asignación) y se
  // fue con él al borrarlo el 2026-08-07: la feature 161 quedó con una sola superficie —la
  // campana— y el mensajero dejó de oír los mensajes del cliente. Vuelve aquí, que es hoy
  // la única superficie viva del hilo.
  //
  // `null` MIENTRAS el hilo no ha cargado (R24): sin eso, la primera carga se leería como un
  // salto de cero a N y sonaría al abrir un hilo con entrantes previos (R23). Sin orden
  // seleccionada la clave de SWR es `null`, no hay `data` y el contador también es `null`.
  //
  // Este contador cubre SOLO el hilo abierto, que es cuando este componente está montado.
  // El aviso con el chat cerrado —o con otra conversación delante— lo da `ChatFlotante` desde
  // el resumen de no leídos del servidor, y por eso descuenta de su total la conversación
  // abierta: si no, un entrante de este hilo sonaría dos veces.
  useTonoAlIncrementar(
    hiloOk ? mensajes.filter((m) => m.direccion === "entrante").length : null,
  );

  // Datos de la orden para resolver las variables de cada plantilla. Es una APROXIMACIÓN
  // declarada: el DTO de la asignación no trae fechas, banderas internas ni nada del
  // mensajero, así que esas claves se ven vacías en el composer y llegan rellenas en el
  // mensaje real (el envío lo hace el backend, que las lee de la base).
  const datos = useMemo<DatosPlantilla | null>(
    () => (orden === null ? null : datosPlantillaDesdeAsignacion(orden)),
    [orden],
  );

  /** Cuerpo de una plantilla ya renderizado con los datos de esta orden. */
  function renderizar(plantilla: PlantillaTextoDTO): string {
    if (datos === null) return plantilla.cuerpo;
    return renderPlantilla(plantilla.cuerpo, resolverValoresPlantilla(plantilla.variables, datos));
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

  // Feature 316 (R13-R16): la nota de voz. El hook MIDE el dispositivo y entrega el `File` por
  // callback; ese `File` entra por el MISMO camino de validación que un archivo elegido a mano.
  const grabador = useGrabadorVoz({
    onGrabacion: (archivoGrabado) => {
      void aceptarArchivo(archivoGrabado);
    },
  });

  // Un object URL que no se revoca es memoria retenida hasta recargar la pestaña.
  useEffect(
    () => () => {
      if (previewRef.current !== null) URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
    },
    [],
  );

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
    !preparando &&
    (adjunto !== null ||
      (borrador.texto.trim().length > 0 &&
        (textoLibreHabilitado || borrador.plantillaId !== null)));
  // Sin respuesta del cliente el composer no acepta tecleo; con plantilla elegida muestra
  // su texto en solo-lectura (se enviará tal cual, como exige Meta fuera de ventana).
  const composerDeshabilitado =
    enviando || (!textoLibreHabilitado && borrador.plantillaId === null);
  const composerSoloLectura = !textoLibreHabilitado;

  /** Quita el adjunto del composer y revoca su previsualización (R4). */
  function quitarAdjunto() {
    if (previewRef.current !== null) URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
    setAdjunto(null);
  }

  /**
   * Normalizar → clasificar → validar → dejar listo en el composer (design §2.1).
   *
   * EL ORDEN IMPORTA y es lo contrario de lo intuitivo: el límite de 5 MB de la imagen se
   * comprueba DESPUÉS de convertir (R30/R32), que es por lo que una foto de 8 MB se puede
   * enviar. `comprimirImagen` NUNCA lanza: si no pudo, devuelve el original, y por eso el MIME
   * se vuelve a mirar DESPUÉS — es lo que convierte "no pudo" en el aviso propio de R31 en vez
   * de en un "tipo no permitido" que le mentiría al mensajero.
   */
  async function aceptarArchivo(elegido: File) {
    setMenuAdjuntar(false);
    setAvisoAdjunto(null);
    quitarAdjunto();

    const esImagen = elegido.type.startsWith("image/");
    const fueraDeListaBlanca = clasificarAdjunto(elegido.type) === null;
    const excedeLimite = elegido.size > LIMITE_BYTES.imagen;

    setPreparando(true);
    try {
      const preparada =
        esImagen && (fueraDeListaBlanca || excedeLimite)
          ? await comprimirImagen(elegido, {
              // R29: sin atajo por tamaño. Un HEIC de 200 KB TAMBIÉN hay que convertirlo.
              saltarSiMenorA: 0,
              // Aquí la conversión es obligatoria: un JPEG más grande sigue siendo mejor que un
              // formato que Meta rechaza.
              devolverOriginalSiMayor: false,
              maxLadoLargo: MAX_LADO_LARGO_ENVIO,
              calidad: CALIDAD_JPEG_ENVIO,
            })
          : elegido;

      const tipo = clasificarAdjunto(preparada.type);
      if (tipo === null) {
        setAvisoAdjunto(esImagen ? AVISO_NO_CONVERTIBLE : AVISO_TIPO_NO_PERMITIDO);
        return;
      }

      // R11: la MISMA función pura que corre en el servidor. La de aquí es cortesía de red.
      const validacion = validarAdjunto(preparada.type, preparada.size);
      if (!validacion.ok) {
        setAvisoAdjunto(
          validacion.motivo === "tipo_no_permitido"
            ? AVISO_TIPO_NO_PERMITIDO
            : `Ese archivo supera el límite de ${limiteLegible(validacion.limiteBytes)} para este tipo.`,
        );
        return;
      }

      const previewUrl = tipo === "documento" ? null : URL.createObjectURL(preparada);
      previewRef.current = previewUrl;
      setAdjunto({ archivo: preparada, previewUrl, tipo });
    } finally {
      setPreparando(false);
    }
  }

  /** `onChange` común de las tres vías de `<input type="file">`. */
  function alElegirArchivo(evento: React.ChangeEvent<HTMLInputElement>) {
    const elegido = evento.target.files?.[0] ?? null;
    // Se limpia el input para que elegir DOS VECES el mismo archivo vuelva a disparar `change`.
    evento.target.value = "";
    if (elegido !== null) void aceptarArchivo(elegido);
  }

  /**
   * Envío CON adjunto: un solo mensaje (R5). Tras `ok` se limpia y se revalida el hilo, que es
   * lo que hace aparecer la burbuja (R22); tras un fallo el adjunto SE CONSERVA (R19) para que
   * el mensajero pueda reintentar sin volver a buscarlo.
   */
  async function enviarAdjunto(elegido: AdjuntoComposer, texto: string) {
    const formData = new FormData();
    formData.set("ordenId", orden!.id);
    formData.set("archivo", elegido.archivo);
    // R6: Meta NO admite pie en audio. El texto no se manda... y tampoco se borra.
    if (elegido.tipo !== "audio" && texto !== "") formData.set("caption", texto);

    const res = await enviarMediaChat(formData);
    switch (res.status) {
      case "ok":
        quitarAdjunto();
        // R6: tras una nota de voz, lo escrito sigue en el composer.
        if (elegido.tipo !== "audio") setBorrador(BORRADOR_VACIO);
        await mutate();
        break;
      case "fuera_ventana":
        toast.error("La ventana de 24 h expiró. Envía una plantilla.");
        await mutate();
        break;
      case "tipo_no_permitido":
        toast.error(AVISO_TIPO_NO_PERMITIDO);
        break;
      case "demasiado_grande":
        toast.error(
          `Ese archivo supera el límite de ${limiteLegible(res.limiteBytes)} para este tipo.`,
        );
        break;
      case "caption_largo":
        toast.error(`El pie no puede pasar de ${res.maximo} caracteres.`);
        break;
      case "fallo_subida":
        toast.error("No se pudo subir el archivo. Inténtalo de nuevo.");
        break;
      case "permanente":
        toast.error(`WhatsApp rechazó el envío: ${res.detalle}`);
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

  /** Elegir una plantilla rellena el composer y habilita el envío. */
  function elegirPlantilla(plantilla: PlantillaTextoDTO) {
    if (plantillaBloqueada) return;
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

  /**
   * UN SOLO envío (R5): con adjunto va por `enviarMediaChat` con el texto como pie; sin
   * adjunto, por el camino de siempre. Nunca los dos.
   */
  async function enviar() {
    // R7: el candado es la ref, que ya está puesta cuando llega el segundo click o el Enter.
    if (enviandoRef.current || preparando) return;
    const texto = borrador.texto.trim();
    const conAdjunto = adjunto;
    if (conAdjunto === null && texto === "") return;

    enviandoRef.current = true;
    setEnviando(true);
    try {
      if (conAdjunto !== null) {
        await enviarAdjunto(conAdjunto, texto);
      } else if (textoLibreHabilitado) {
        await enviarTextoLibre(texto);
      } else if (borrador.plantillaId !== null) {
        await enviarComoPlantilla(borrador.plantillaId);
      }
    } finally {
      enviandoRef.current = false;
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

        {/* Pedido humano 2026-08-31 — LLAMAR AL CLIENTE desde la propia conversación, sin
            volver al panel. Sale de la app hacia WhatsApp (`wa.me/<normalizado>`, el mismo
            enlace y el mismo normalizador que usa `ContactoButtons`), que es donde el
            mensajero tiene el botón de llamada de voz: WhatsApp no publica ningún esquema
            de URL que INICIE la llamada, así que lo que se puede abrir es la conversación
            con ese número ya seleccionado. Por eso el rótulo accesible dice «por WhatsApp»
            y no promete un timbre.

            No se pinta si la orden no trae teléfono: un `wa.me/` vacío abre WhatsApp en la
            nada y parece que la app se rompió. */}
        {orden.telefonoDest.trim() !== "" ? (
          <a
            href={`https://wa.me/${normalizarTelefonoCR(orden.telefonoDest)}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Llamar por WhatsApp a ${orden.destinatario}`}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Phone className="size-5" aria-hidden="true" />
          </a>
        ) : null}

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
                disabled={plantillaBloqueada}
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
        {/* Feature 316 (R4): el adjunto elegido se VE antes de enviarse y se puede quitar. */}
        {adjunto !== null ? (
          <div className="flex items-center gap-2 rounded-2xl bg-muted px-3 py-2">
            {adjunto.tipo === "imagen" && adjunto.previewUrl !== null ? (
              // eslint-disable-next-line @next/next/no-img-element -- object URL local
              <img
                src={adjunto.previewUrl}
                alt={`Adjunto listo para enviar: ${adjunto.archivo.name}`}
                className="size-12 shrink-0 rounded-lg object-cover"
              />
            ) : null}
            {adjunto.tipo === "video" && adjunto.previewUrl !== null ? (
              <video
                src={adjunto.previewUrl}
                aria-label={`Vídeo listo para enviar: ${adjunto.archivo.name}`}
                className="size-12 shrink-0 rounded-lg object-cover"
              />
            ) : null}
            {adjunto.tipo === "audio" && adjunto.previewUrl !== null ? (
              // R13: se puede ESCUCHAR la nota antes de mandarla.
              <audio
                controls
                src={adjunto.previewUrl}
                aria-label="Nota de voz grabada"
                className="h-9 min-w-0 flex-1"
              />
            ) : null}
            {adjunto.tipo === "documento" ? (
              <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : null}
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">
              {adjunto.archivo.name}
            </span>
            <button
              type="button"
              onClick={quitarAdjunto}
              aria-label={adjunto.tipo === "audio" ? "Descartar nota de voz" : "Quitar adjunto"}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {/* Una foto de 12 MP tarda un momento en convertirse en un movil de gama baja; sin este
            estado pareceria que la app se colgo (design 6.1). */}
        {preparando ? (
          <p role="status" className="px-1 text-[11px] text-muted-foreground">
            Preparando la foto…
          </p>
        ) : null}

        {avisoAdjunto !== null ? (
          <p role="alert" className="px-1 text-[11px] text-danger-strong">
            {avisoAdjunto}
          </p>
        ) : null}

        {/* R13: mientras graba, la unica salida no es esperar: se detiene o se cancela. */}
        {grabador.estado === "grabando" ? (
          <div className="flex items-center gap-2 rounded-2xl bg-muted px-3 py-2">
            <Mic className="size-4 shrink-0 text-danger-strong" aria-hidden="true" />
            <span className="flex-1 text-xs text-foreground">Grabando nota de voz…</span>
            <button
              type="button"
              onClick={grabador.detener}
              className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
            >
              Detener
            </button>
            <button
              type="button"
              onClick={grabador.cancelar}
              className="rounded-full border border-border px-3 py-1 text-xs font-medium"
            >
              Cancelar
            </button>
          </div>
        ) : null}

        {/* R16: permiso denegado o microfono inaccesible. Se dice y se vuelve al composer. */}
        {grabador.estado === "sin_permiso" || grabador.estado === "fallo" ? (
          <p role="alert" className="px-1 text-[11px] text-danger-strong">
            {grabador.aviso}
          </p>
        ) : null}

        <div className="flex items-end gap-2">
          {/* Feature 316 (R1): las CUATRO vias de adjuntar. */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuAdjuntar((abierto) => !abierto)}
              // R2/D2: EL MISMO booleano del servidor que gobierna el textarea. No se recalcula
              // aqui: el criterio de la ventana vive en `listarHiloChat`.
              disabled={!textoLibreHabilitado || enviando}
              aria-haspopup="menu"
              aria-expanded={menuAdjuntar}
              aria-label="Adjuntar"
              className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Paperclip className="size-[18px]" aria-hidden="true" />
            </button>

            {menuAdjuntar ? (
              <div
                role="menu"
                aria-label="Formas de adjuntar"
                className="absolute bottom-12 left-0 z-10 w-64 rounded-xl border border-border bg-card p-1 shadow-lg"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => inputCamaraRef.current?.click()}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <Camera className="size-4 shrink-0" aria-hidden="true" />
                  Cámara (foto o vídeo)
                </button>
                {/* D8/R10: el tope se dice ANTES de abrir la camara, no cuando el video ya
                    esta grabado y no se puede recomprimir. */}
                <p className="px-3 pb-1 text-[11px] text-muted-foreground">
                  {AVISO_LIMITE_VIDEO}
                </p>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => inputArchivoRef.current?.click()}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <ImageUp className="size-4 shrink-0" aria-hidden="true" />
                  Archivo del dispositivo
                </button>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => inputDocumentoRef.current?.click()}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                >
                  <FileText className="size-4 shrink-0" aria-hidden="true" />
                  Documento (PDF, Word o Excel)
                </button>

                <button
                  type="button"
                  role="menuitem"
                  // R15: sin un formato que Meta acepte, esta via NO se ofrece. Las otras tres
                  // siguen; no se manda como documento algo que el cliente no podra escuchar.
                  disabled={!grabador.soportado}
                  onClick={() => {
                    setMenuAdjuntar(false);
                    grabador.iniciar();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Mic className="size-4 shrink-0" aria-hidden="true" />
                  Nota de voz
                </button>
                {!grabador.soportado ? (
                  <p className="px-3 pb-1 text-[11px] text-muted-foreground">
                    {grabador.aviso}
                  </p>
                ) : null}
              </div>
            ) : null}

            <input
              ref={inputCamaraRef}
              type="file"
              accept={ACCEPT_MEDIA}
              capture="environment"
              onChange={alElegirArchivo}
              aria-label="Tomar foto o vídeo con la cámara"
              className="hidden"
            />
            <input
              ref={inputArchivoRef}
              type="file"
              accept={ACCEPT_MEDIA}
              onChange={alElegirArchivo}
              aria-label="Elegir un archivo del dispositivo"
              className="hidden"
            />
            <input
              ref={inputDocumentoRef}
              type="file"
              accept={ACCEPT_DOCUMENTO}
              onChange={alElegirArchivo}
              aria-label="Elegir un documento"
              className="hidden"
            />
          </div>

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
            // R12: con adjunto el texto viaja como PIE, y el pie de Meta es mucho mas corto que
            // un mensaje de texto. Se impide escribir de mas en vez de rechazarlo al enviar.
            maxLength={adjunto !== null ? MAX_CAPTION : MAX_TEXTO_LIBRE}
            disabled={composerDeshabilitado}
            readOnly={composerSoloLectura && !composerDeshabilitado}
            placeholder={
              adjunto !== null && adjunto.tipo !== "audio"
                ? "Añade un pie de foto…"
                : textoLibreHabilitado
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
        {!textoLibreHabilitado ? (
          <p className="px-1 text-[11px] text-muted-foreground">
            {plantillaBloqueada
              ? "Ya escribiste hoy a este cliente. Espera su respuesta para continuar."
              : borrador.plantillaId === null
                ? "El cliente aún no ha respondido: solo puedes enviar una plantilla aprobada."
                : "Se enviará la plantilla tal cual; no es editable hasta que el cliente responda."}
          </p>
        ) : null}

        {/* R2: por que el clip esta bloqueado, en texto visible y ANTES de intentarlo. */}
        {!textoLibreHabilitado ? (
          <p className="px-1 text-[11px] text-muted-foreground">{AVISO_ADJUNTO_BLOQUEADO}</p>
        ) : null}
      </form>

      {/* Feature 121 (R10-R13): minimapa de una ubicación compartida, dentro de la misma
          ventana y sin recargar. El modal es EL MISMO que abre "Navegar" en el detalle de la
          orden, así que desde aquí también se puede saltar a la app de mapas propia (fila
          "Abrir en:", derivada del punto compartido; pedido humano 2026-08-27). */}
      <UbicacionModal
        punto={ubicacionCliente}
        onOpenChange={(abierto) => {
          if (!abierto) setUbicacionCliente(null);
        }}
      />
    </section>
  );
}
