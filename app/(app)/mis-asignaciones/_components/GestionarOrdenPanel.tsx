"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import useSWR from "swr";
import {
  Camera,
  ChevronUp,
  ImagePlus,
  LifeBuoy,
  MessageCircle,
  Navigation,
  PackageCheck,
  Phone,
  QrCode,
  RotateCcw,
  ShieldAlert,
  Truck,
  Undo2,
  X,
  XCircle,
} from "lucide-react";

import { HiloNotasOrden } from "@/components/shared/HiloNotasOrden";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/useToast";
import { useDeclararTrabajo } from "@/hooks/useDeclararTrabajo";
import { gestionar } from "@/lib/actions/mis-asignaciones";
import { solicitarAyudaOrden } from "@/lib/actions/orden-ayuda";
import {
  borrarNotaOrden,
  listarNotasOrden,
  publicarNotaOrden,
} from "@/lib/actions/orden-notas";
import { gestionarSchema } from "@/lib/types/gestion-orden";
// Feature 276 (T11, R8): el MISMO módulo puro que usa la guarda del servidor. No trae Prisma en
// runtime, ni servicios, ni nada de `next`, así que se puede importar desde este Client Component;
// y el UMBRAL no viaja con él (R10) — entra por parámetro donde hace falta, que aquí no hace falta
// porque la decisión llega ya tomada en `orden.enElTope`.
import { permitidoEnElTope } from "@/lib/types/tope-intentos";
import { GESTION_ALLOWED_MIME, gestionConfig } from "@/lib/config/gestion";
import { comprimirImagen } from "@/lib/utils/comprimir-imagen";
import {
  capturarUbicacion,
  type CapturaUbicacion,
} from "@/lib/utils/capturar-ubicacion";
import { mananaCalendarioCR } from "@/lib/utils/fecha-cr";
import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import type { CausaDevolucion } from "@/lib/types/causa-devolucion";
import type { CausaIncidente } from "@/lib/types/causa-incidente";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

import { AsignacionDetalle } from "./AsignacionDetalle";
import { SolicitarAyudaModal } from "./SolicitarAyudaModal";
import { EnviarPlantillaWhatsappButton } from "@/components/shared/EnviarPlantillaWhatsappButton";
import { CAUSA_DEVOLUCION_OPTIONS } from "./causa-devolucion-options";
import { CAUSA_INCIDENTE_OPTIONS } from "./causa-incidente-options";
import {
  ERRORES_LINEA,
  capturaCuadra,
  erroresDeLinea,
  lineasIniciales,
  lineasParaEnviar,
  type LineaEnEdicion,
} from "./desglose-captura";
// El EDITOR de líneas vive en `components/shared` desde que lo comparte la corrección del
// desglose que hace el admin en un cierre abierto (pedido humano 2026-08-19).
import {
  DesglosePagoField,
  mensajeDeCuadre,
} from "@/components/shared/DesglosePagoField";
import { VerificarGuiaGate } from "./VerificarGuiaGate";
import { UbicacionTrigger } from "./UbicacionTrigger";
import { useSeccionColapsable } from "@/hooks/useSeccionColapsable";

// Feature 193 (R19) — el permiso de ubicación está DENEGADO y por eso la gestión no sale.
//
// El mensaje dice DÓNDE se reactiva, no solo que falta. Es toda la diferencia entre un
// bloqueo con salida y una llamada a soporte: el mensajero está en la calle, la denegación la
// revierte él mismo, y nadie recuerda dónde vive ese ajuste sin que se lo digan.
const MSG_UBICACION_DENEGADA =
  "Para registrar la gestión hace falta tu ubicación. Activá el permiso desde el candado " +
  "de la barra de direcciones (Permisos del sitio → Ubicación) y volvé a intentarlo.";

// Feature 227 (T3.4) — textos del bloque del hilo, en un solo sitio y fuera del JSX
// (i18n-ready, mismo criterio que `DESGLOSE_TEXTOS`).
const HILO_TEXTOS = {
  titulo: "Notas con la tienda",
  cargando: "Cargando las notas…",
  sesion: "Tu sesión expiró. Iniciá sesión de nuevo para ver las notas.",
  fallo: "No se pudieron cargar las notas de esta orden.",
} as const;

// Pedido humano 2026-08-18 — los tres desenlaces de «Solicitar ayuda», dichos en el idioma del
// mensajero. El de `forbidden` NO enumera las causas (rol, orden ajena, orden fuera de reparto):
// el borde es opaco a propósito y repetir aquí la lista sería adivinar cuál de ellas fue.
const MSG_AYUDA_OK = "Se solicitó ayuda. Tu tienda lo verá en Novedades.";
const MSG_AYUDA_MOTIVO = "Escribí un motivo para poder solicitar ayuda.";
const MSG_AYUDA_FORBIDDEN =
  "No se pudo solicitar ayuda con esta orden. Revisá que siga en reparto y asignada a vos.";

/**
 * R2/R16: con qué líneas arranca —y a qué vuelve— el editor. Una entrega SIN cobro son CERO
 * líneas (nada que repartir); con cobro, UNA línea con el total ya pre-cargado, para que el
 * caso de un solo método siga costando un solo gesto [Q4].
 */
function lineasDeArranque(montoCobrar: number | null): LineaEnEdicion[] {
  return montoCobrar ? lineasIniciales(montoCobrar) : [];
}

/**
 * La captura, ya descartada la denegación: es el único desenlace que no llega a los
 * constructores del envío porque `handleConfirm` corta antes (R19).
 */
type CapturaConDesenlace = Exclude<CapturaUbicacion, { estado: "denegado" }>;

/** R17/R18: o las coordenadas, o el motivo por el que no las hay. Nunca ambas (R11). */
function ubicacionRaw(captura: CapturaConDesenlace): Record<string, unknown> {
  return captura.estado === "ok"
    ? { ubicacion: { lat: captura.lat, lng: captura.lng } }
    : { ubicacionAusencia: captura.motivo };
}

// Feature 36 / rediseño 63 (pedido humano): detalle GRANDE y centrado de UNA
// orden en reparto con gestión multi-paso, ahora como PANEL INLINE (no modal /
// overlay). Se renderiza en la página, debajo de la grilla de cards. Flujo:
// (1) detalle + botón "Gestionar pedido" (fija el puntero 1-a-1 vía
// `onGestionarPedido`); (2) botones de resultado —4 desenlaces normales + el reporte de
// incidente aparte (feature 158/R33)—; (3) campos CONDICIONALES por
// resultado. Valida en cliente con el MISMO schema que revalida el servidor
// (gestionarSchema, R24) y envía FormData a la Server Action `gestionar`. El
// resultado de dominio se refleja como errores por campo (validation_error) o
// Toast (conflict/forbidden). El contrato de backend NO cambia.
//
// Como ya NO hay modal que cerrar, cuando el puntero está fijado (pasos
// resultados/formulario) se ofrece "Cancelar gestión", que libera el puntero
// (vía `onCancelarGestion` del padre) y vuelve al paso "detalle" sin cambiar de
// orden. El reset del estado interno lo garantiza el padre remontando el panel
// con `key={orden.id}` al cambiar de orden.

// Feature 158 (R33): quinto resultado. NO es un desenlace de la entrega ("cómo terminó"),
// sino el reporte de que el paquete ya no existe o no sirve — por eso se ofrece APARTE de
// los cuatro botones normales (ver `RESULTADO_BOTONES.aparte`).
type Resultado =
  | "entregada"
  | "reprogramada"
  | "devuelta"
  | "rechazada"
  | "incidente";

/** Pasos del flujo de gestión dentro del panel. */
type Paso = "detalle" | "resultados" | "formulario";

const ACCEPT_MIME = GESTION_ALLOWED_MIME.join(",");

/**
 * Formatos admitidos, en la letra del usuario y DERIVADOS del mismo catálogo que valida el borde
 * (`GESTION_ALLOWED_MIME`). Escritos a mano se desincronizarían el día que entre —o salga— un
 * formato, y la zona de carga prometería algo que el servidor rechaza.
 */
const FORMATOS_EVIDENCIA = GESTION_ALLOWED_MIME.map((mime) =>
  mime.replace("image/", "").toUpperCase(),
).join(" · ");

// Feature 119 (R16): tope de fotos por gestion. El schema (cliente y servidor) usa el
// mismo `gestionConfig.MAX_EVIDENCIAS_POR_GESTION`; en el navegador la env no es visible
// (no lleva `NEXT_PUBLIC_`), asi que cae al default 3, igual que el schema en cliente.
const MAX_EVIDENCIAS = gestionConfig.MAX_EVIDENCIAS_POR_GESTION;

// Pedido humano (2026-08-19): una entrega cuyo `montoCobrar` es 0/null no monta el editor de
// desglose. Ese hueco silencioso se lee como "falta algo", así que se dice en voz alta que no
// hay cobro que capturar. Fuera del JSX, mismo criterio que el resto de los avisos.
const SIN_COBRO_NOTA = "Esta orden no tiene cobro asociado: no hay nada que recaudar.";

// Feature 158 (R33/Q-B): textos del reporte de incidente (separados de la lógica, i18n-ready).
const INCIDENTE_APARTE_NOTA =
  "El paquete ya no se puede entregar ni devolver: está dañado, perdido o robado.";
/**
 * Copy de la evidencia del incidente. La foto es OBLIGATORIA en las TRES causas (decisión del
 * humano, Q-B), también cuando NO hay paquete que fotografiar: en vez de un "campo requerido"
 * seco, se le dice al mensajero —que está en la calle— QUÉ se espera que fotografíe.
 */
const INCIDENTE_EVIDENCIA_AYUDA =
  "La foto es obligatoria también si el paquete se perdió o se lo robaron. Si no tienes el paquete, fotografía lo que sí tienes delante: el compartimento o el vehículo vacío, la guía o la etiqueta, el lugar del hecho, o la denuncia.";

/**
 * Configuración visual de los botones de resultado (jerarquía + color). Los cuatro
 * desenlaces normales van en la grilla; el `incidente` va `aparte` (feature 158/R33): se
 * pinta bajo un separador, con su propio aviso, para que no se lea como una quinta forma
 * de terminar la entrega.
 */
const RESULTADO_BOTONES: {
  value: Resultado;
  label: string;
  Icon: typeof PackageCheck;
  className: string;
  /** `true` = se pinta FUERA de la grilla de desenlaces normales (feature 158/R33). */
  aparte?: boolean;
}[] = [
  {
    value: "entregada",
    label: "Entregar",
    Icon: PackageCheck,
    className:
      "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
  },
  {
    value: "rechazada",
    label: "Rechazar",
    Icon: XCircle,
    className:
      "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20",
  },
  {
    value: "reprogramada",
    label: "Reprogramar",
    Icon: RotateCcw,
    className:
      "border-warning/40 bg-warning/10 text-warning-strong hover:bg-warning/20",
  },
  {
    value: "devuelta",
    label: "Devolver",
    Icon: Undo2,
    className: "border-border bg-muted/40 text-foreground hover:bg-muted",
  },
  // Feature 158 (R33): tratamiento visual de EXCEPCIÓN (borde punteado + tono de alerta) y
  // fuera de la grilla. No compite con los cuatro desenlaces normales.
  {
    value: "incidente",
    label: "Reportar incidente",
    Icon: ShieldAlert,
    className:
      "border-dashed border-destructive/60 bg-transparent text-destructive hover:bg-destructive/10",
    aparte: true,
  },
];

// =================================================================================================
// FEATURE 276 (T11, R8/R9/R10) — LA ORDEN A LA QUE LE QUEDA EL ÚLTIMO INTENTO.
// =================================================================================================
//
// Con `orden.enElTope` en `true`, la gestión que se registre AHORA es la que alcanza el tope de
// intentos, y el servidor ya NO acepta `reprogramada` ni `devuelta`: las dos devuelven la orden a
// circulación, que es exactamente lo que el tope cierra.
//
// **La regla no se reescribe aquí**: se consume de `permitidoEnElTope`, el mismo módulo puro que
// usa la guarda del servidor. Si divergieran, la pantalla ofrecería un botón que el envío rechaza.
//
// **Y esto NO es la defensa** (R11): si llegara una petición con un resultado prohibido —un cliente
// que ignore la interfaz—, `MisAsignacionesService.gestionar` la rechaza igual, antes de subir
// ninguna foto. Ocultar el botón es cortesía con el mensajero, no seguridad.

/**
 * R9 — POR QUÉ FALTAN DOS BOTONES, DICHO CON PALABRAS. Un hueco donde antes había cuatro opciones
 * se lee como un fallo de la aplicación; y el aviso no puede depender del color ni de un tooltip,
 * porque quien lo necesita está en la calle, con sol y con una mano ocupada.
 *
 * ⚠️ NO NOMBRA EL NÚMERO (R10). El umbral es configuración del servidor y no cruza al navegador: a
 * esta pantalla solo le llega el booleano ya decidido. Decir «llevas 2 de 3» obligaría a mandarlo.
 * `tests/components/GestionarOrdenPanelTope.test.tsx` falla si aparece una cifra en esta frase.
 */
const TOPE_INTENTOS_NOTA =
  "A esta orden le queda el último intento de entrega: ya no se puede reprogramar ni devolver. Registra cómo terminó ahora — entregada o rechazada. Si el paquete se dañó, se perdió o te lo robaron, repórtalo como incidente.";

/**
 * Los desenlaces que se ofrecen, ya partidos en los dos bloques del paso 2 (la grilla de los
 * normales y el incidente aparte, feature 158/R33).
 *
 * En el tope se filtra el juego COMPLETO con `permitidoEnElTope` antes de partirlo, y no cada
 * bloque por su lado: así el día que un desenlace cambie de bloque —o entre uno nuevo— la regla del
 * tope lo alcanza igual. Hoy «Reportar incidente» sobrevive al filtro, y es la decisión 3 del
 * humano (2026-08-24): un paquete dañado, perdido o robado NO es un desenlace de entrega, así que
 * el tope no lo toca. Forzar `rechazada` en su lugar grabaría un hecho falso y cobraría un rechazo
 * que no ocurrió.
 */
function botonesDeResultado(enElTope: boolean) {
  const visibles = enElTope
    ? RESULTADO_BOTONES.filter((b) => permitidoEnElTope(b.value))
    : RESULTADO_BOTONES;
  return {
    /** Los desenlaces normales de la entrega (grilla principal del paso 2). */
    normales: visibles.filter((b) => !b.aparte),
    /** Los que se ofrecen APARTE, bajo el separador (feature 158/R33). */
    aparte: visibles.filter((b) => b.aparte),
  };
}

export interface GestionarOrdenPanelProps {
  /** Orden a mostrar/gestionar (la del panel de detalle). */
  orden: MiAsignacionDTO;
  /**
   * `true` si el puntero 1-a-1 ya está fijado en esta orden (gestión en curso):
   * el panel arranca directo en los 4 botones, saltando "Gestionar pedido".
   */
  yaActiva: boolean;
  /**
   * Fija el puntero 1-a-1 (escogerParaGestion) al pulsar "Gestionar pedido".
   * Devuelve `true` si quedó fijado (avanza a los 4 botones); `false` si hubo
   * conflicto/forbidden (el padre ya mostró el Toast; el paso no avanza).
   */
  onGestionarPedido: () => Promise<boolean>;
  /**
   * Libera el puntero 1-a-1 (liberarGestion) al pulsar "Cancelar gestión". Se
   * invoca solo cuando el puntero está fijado (pasos resultados/formulario).
   */
  onCancelarGestion: () => void | Promise<void>;
  /** Se invoca tras un "ok" para que el padre refresque el listado. */
  onSuccess: () => void;
  count: number;
  /**
   * Rediseño ux: abre el CHAT del módulo (modal del botón flotante) en la conversación de
   * esta orden. El hilo ya no se lee dentro del panel: la acción "Mensaje" lleva a él.
   */
  onAbrirChat: () => void;
}

/** Primer mensaje de error de un campo (o undefined). */
function firstError(
  errors: Record<string, string[]>,
  field: string,
): string | undefined {
  return errors[field]?.[0];
}

/**
 * Default y mínimo del campo "Nueva fecha": MAÑANA en el calendario de Costa Rica.
 * Se delega en `fecha-cr` (UTC-6 fijo, la misma convención que usa el backend para
 * `fecha_reprogramacion`): calcularlo con `toISOString()` daba el día siguiente a
 * partir de las 18:00 CR, porque emite la fecha en UTC.
 */
function mananaISO(): string {
  return mananaCalendarioCR();
}

export function GestionarOrdenPanel({
  orden,
  yaActiva,
  onGestionarPedido,
  onCancelarGestion,
  onSuccess,
  count,
  onAbrirChat,
}: Readonly<GestionarOrdenPanelProps>) {
  const toast = useToast();
  // Ancla del bloque "Gestionar esta orden": el CTA fijo de abajo lo ABRE y lleva hasta él
  // (no lo sustituye — la guía se sigue verificando antes de habilitar la gestión, feature 98).
  const guiaRef = useRef<HTMLDivElement>(null);
  // Pedido humano (ux): la sección arranca CERRADA y se abre desde el CTA "Gestionar esta
  // orden"; ahí aparece el escáner QR. Sin guía asignada arranca ABIERTA: el bloque no trae
  // escáner sino el aviso de que la orden no se puede gestionar, y eso hay que verlo.
  const gestion = useSeccionColapsable(orden.numGuia === null);

  // Feature 227 (T3.4, design §5.2) — HILO de notas con la tienda, montado JUSTO donde
  // estaba el editor de la nota privada de la 116 (retirada por esta misma feature).
  //
  // CARGA BAJO DEMANDA: el hilo NO viaja dentro de `listarMisAsignaciones` (alternativa A6
  // descartada: sería N+1 sobre la pantalla más caliente del portal) y esta feature NO toca
  // el conjunto de estatus que esa lectura hace —sigue siendo exactamente `por_recoger` y
  // `en_reparto`, corte de la feature 167/R34 (R36)—. El panel se monta para UNA orden, la
  // abierta, y con `key={orden.id}`: una lectura por orden abierta, ninguna por fila de la
  // lista.
  //
  // `puedeEscribir` llega del servidor (R19): el mensajero escribe con la orden `en_reparto`
  // y asignada a él, y solo lee en el resto. Aquí no se mira `orden.estatusValue` para
  // decidirlo — la ventana es asimétrica por rol (D1) y el cliente no la re-deriva.
  // Se lee con SWR y la Server Action como fetcher, igual que el hilo del chat
  // (`ChatConversacion`): la clave lleva el `ordenId`, así que cambiar de orden cambia de
  // clave y `mutate()` es el refresco DESDE EL SERVIDOR tras publicar o borrar (R17). Sin
  // `refreshInterval`: esto no es el chat con el cliente, no hay nada que sondear.
  const {
    data: hilo,
    isLoading: cargandoHilo,
    mutate: refrescarHilo,
  } = useSWR(["orden-notas", orden.id], () =>
    listarNotasOrden({ ordenId: orden.id }),
  );

  const hiloOk = hilo?.status === "ok" ? hilo : null;

  // Contador de "llévame al bloque": sube en cada pulsación del CTA. El scroll y el foco se
  // hacen en un efecto, DESPUÉS del render que monta la sección (en el handler el nodo aún
  // no existe la primera vez).
  const [irAGestion, setIrAGestion] = useState(0);
  useEffect(() => {
    if (irAGestion === 0) return;
    const bloque = guiaRef.current;
    if (!bloque) return;
    // `scrollIntoView` no existe en jsdom (y en un navegador viejo tampoco es seguro):
    // el foco es lo que de verdad importa, el scroll es cortesía.
    bloque.scrollIntoView?.({ block: "center" });
    bloque.querySelector("input")?.focus();
  }, [irAGestion]);

  // El padre remonta este panel (`key={orden.id}`) al cambiar de orden, por lo
  // que el estado interno arranca limpio: si la orden ya está activa, directo en
  // los 4 botones; si no, en el detalle.
  const [paso, setPaso] = useState<Paso>(yaActiva ? "resultados" : "detalle");
  const [resultado, setResultado] = useState<Resultado>("entregada");
  // Feature 213 (R1/R2): el método ÚNICO del recaudo pasa a ser un DESGLOSE de líneas
  // (método + monto). El estado es la lista EN EDICIÓN; lo que viaja al servidor lo derivan
  // `lineasParaEnviar` (R12) y `buildFormData` (R15).
  const [lineas, setLineas] = useState<LineaEnEdicion[]>(() =>
    lineasDeArranque(orden.montoCobrar),
  );
  // R13: los errores POR LÍNEA solo se pintan tras un intento de envío. Mostrarlos mientras se
  // teclea marcaría en rojo la línea recién nacida (que aún no tiene método) en cada gestión.
  const [erroresLineas, setErroresLineas] = useState<(string | undefined)[]>([]);
  const [fechaReprogramacion, setFechaReprogramacion] = useState(mananaISO());
  const [motivo, setMotivo] = useState("");
  // Feature 73 (R4): causa TIPIFICADA de la rama `devuelta`. `""` = sin elegir; el mensajero
  // DEBE escoger una (R6). Es un campo APARTE del `motivo`, que sigue obligatorio (R7).
  const [causaDevolucion, setCausaDevolucion] = useState<CausaDevolucion | "">("");
  // Feature 158 (R9/R33): causa TIPIFICADA de la rama `incidente`. `""` = sin elegir; el
  // mensajero DEBE escoger una de las 3. Campo APARTE del `motivo`, que sigue obligatorio (R11).
  const [causaIncidente, setCausaIncidente] = useState<CausaIncidente | "">("");
  // Feature 119 (R14): la evidencia UNICA pasa a una LISTA de 1..N fotos (tope MAX_EVIDENCIAS).
  const [evidencias, setEvidencias] = useState<File[]>([]);
  const [comprimiendo, setComprimiendo] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [enviando, setEnviando] = useState(false);
  // Feature 193/R21: la captura tarda (hasta 10 s). Sin este estado el CTA parecería muerto y
  // el mensajero volvería a pulsarlo, disparando dos gestiones de la misma orden.
  const [ubicando, setUbicando] = useState(false);
  const [cancelando, setCancelando] = useState(false);

  // Feature 284 (B1 de la revisión, 2026-08-25) — MIENTRAS HAYA GESTIÓN A MEDIAS, EL AVISO DE
  // "hay una versión nueva" NO SE PINTA. Una recarga aquí se lleva el desglose del recaudo y las
  // fotos ya elegidas, y el aviso es un botón `fixed` que caía justo encima de "Guardar gestión".
  //
  // Esta pantalla lo DECLARA en vez de dejar que se adivine desde el DOM, porque desde fuera NO
  // SE VE: el campo del monto es un input CONTROLADO y React 19 mantiene su `defaultValue`
  // sincronizado con `value` (medido), y las fotos no viven en ningún input —`handleEvidenciaChange`
  // limpia `input.value` a propósito para poder volver a elegir la misma—.
  //
  // Basta con haber entrado a los desenlaces: desde ahí el mensajero está capturando —el monto
  // arranca YA PUESTO con lo que hay que cobrar (`lineasIniciales`)— y cualquier recarga es
  // destructiva. La clave lleva el id de la orden porque puede haber más de un panel montado.
  useDeclararTrabajo(
    `gestion:${orden.id}`,
    // Los tres pasos son "detalle" -> "resultados" (los botones de desenlace) -> "formulario"
    // (la captura: monto, motivo, fotos). Cuenta como trabajo desde que se sale del detalle:
    // en "resultados" el mensajero YA decidio gestionar. Escribir aqui `=== "resultados"` fue
    // un error de verdad, y lo cazó el caso REAL de la guardia: al pulsar "Entregar" el paso
    // pasa a "formulario" y la declaracion se habria retirado justo al empezar a capturar.
    paso !== "detalle" ||
      comprimiendo ||
      enviando ||
      ubicando ||
      cancelando ||
      evidencias.length > 0 ||
      motivo.trim() !== "",
  );

  // Feature 119 (R14/R16): agrega las fotos SELECCIONADAS a la lista. Cada foto se comprime
  // en el cliente antes de guardarla (una foto de celular sin comprimir revienta el limite de
  // body del Server Action, 413); `comprimirImagen` cae al archivo original ante cualquier
  // fallo, asi que nunca bloquea la gestion. Mientras comprime, "Guardar gestion" se deshabilita.
  // La seleccion se CONCATENA a lo ya elegido (permite ir sumando en varias tandas). Si el
  // total supera el tope, se RECORTA a MAX_EVIDENCIAS y se marca el error del campo (R16).
  async function handleEvidenciaChange(e: ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const seleccion = Array.from(input.files ?? []);
    // Limpia el valor del input para permitir volver a elegir la MISMA foto tras quitarla.
    input.value = "";
    if (seleccion.length === 0) return;
    setComprimiendo(true);
    try {
      const comprimidas = await Promise.all(seleccion.map((f) => comprimirImagen(f)));
      // Updater funcional: concatena sobre el estado MAS reciente (a prueba de tandas
      // solapadas). El error de tope se deriva del MISMO `prev` para que array y error nunca
      // se contradigan; setear el error aqui es idempotente (mismo mensaje ante re-invocacion).
      setEvidencias((prev) => {
        const combinadas = [...prev, ...comprimidas];
        setFieldErrors((errs) => {
          const rest = { ...errs };
          delete rest.evidencias;
          return combinadas.length > MAX_EVIDENCIAS
            ? {
                ...rest,
                evidencias: [`Solo puedes adjuntar hasta ${MAX_EVIDENCIAS} fotos.`],
              }
            : rest;
        });
        return combinadas.slice(0, MAX_EVIDENCIAS);
      });
    } finally {
      setComprimiendo(false);
    }
  }

  /** Quita la foto en `index` de la lista (R15) y limpia el error de evidencia. */
  function quitarEvidencia(index: number) {
    setEvidencias((prev) => prev.filter((_, i) => i !== index));
    setFieldErrors((errs) => {
      if (!errs.evidencias) return errs;
      const rest = { ...errs };
      delete rest.evidencias;
      return rest;
    });
  }

  // Orden SIN cobro (montoCobrar 0 o null): no hay COD que recaudar, así que no se monta el
  // editor de líneas. Feature 213/R16: la entrega se envía con recaudo 0 y CERO líneas —el
  // `"efectivo"` que este panel forzaba se ha borrado—; el borde ya acepta esa forma
  // (`validarRecaudoEntrega`, reglas 3 y 4: con `montoRecibido === 0` ninguna dispara).
  const sinCobro = !orden.montoCobrar;
  const montoACobrar = orden.montoCobrar ?? 0;

  /** R13: cambiar una línea invalida los errores del intento anterior. */
  function actualizarLineas(next: LineaEnEdicion[]) {
    setLineas(next);
    setErroresLineas([]);
  }

  /** Construye el objeto crudo para validar en cliente con gestionarSchema. */
  function buildRaw(captura: CapturaConDesenlace): Record<string, unknown> {
    const base = { ordenId: orden.id, resultado, ...ubicacionRaw(captura) };
    switch (resultado) {
      case "entregada":
        // Feature 119 (R5/R6): la evidencia es una LISTA; una lista vacía dispara `min(1)`.
        // Feature 213 (R15/R17): se envía el DESGLOSE puro y NINGÚN `metodoPago` escalar. El
        // borde acepta las dos formas pero no juntas (regla 1 de `validarRecaudoEntrega`).
        return {
          ...base,
          montoRecibido: montoACobrar,
          pagos: lineasParaEnviar(lineas),
          evidencias,
        };
      case "reprogramada":
        return { ...base, fechaReprogramacion, motivo };
      case "devuelta":
        // Feature 73/R6: `|| undefined` reproduce el patrón de `metodoPago` (:159) para que zod
        // diga "requerido" y no "valor inválido" cuando no se eligió ninguna causa.
        // Feature 75/119: la evidencia (lista de fotos) es OBLIGATORIA en `devuelta`, igual que
        // en `rechazada`.
        return {
          ...base,
          causaDevolucion: causaDevolucion || undefined,
          motivo,
          evidencias,
        };
      case "rechazada":
        return { ...base, motivo, evidencias };
      case "incidente":
        // Feature 158 (R9/R10/R11): causa tipificada + motivo libre + 1..N fotos, obligatorias
        // en las TRES causas. `|| undefined` (patrón de `causaDevolucion`) para que zod diga
        // "causa requerida" y no "valor inválido" cuando no se eligió ninguna.
        return {
          ...base,
          causaIncidente: causaIncidente || undefined,
          motivo,
          evidencias,
        };
    }
  }

  /**
   * Empaqueta los campos + Files en FormData para la Server Action. Feature 119: cada foto va
   * como un valor MÁS de la misma clave `evidencia` (`append`, no `set`); el borde las lee con
   * `getAll("evidencia")` y las reconstruye como lista en el ORDEN en que se enviaron (índice 0..N).
   */
  function buildFormData(captura: CapturaConDesenlace): FormData {
    const fd = new FormData();
    fd.set("ordenId", orden.id);
    fd.set("resultado", resultado);
    // Feature 193 (R17/R18): la ubicación viaja como DOS escalares (el borde los recompone) o,
    // si la captura falló por una causa técnica, el motivo tipificado en su lugar. Nunca las
    // dos cosas: el borde rechaza esa combinación (R11).
    if (captura.estado === "ok") {
      fd.set("ubicacionLat", String(captura.lat));
      fd.set("ubicacionLng", String(captura.lng));
    } else {
      fd.set("ubicacionAusencia", captura.motivo);
    }
    const anexarEvidencias = () => {
      for (const foto of evidencias) fd.append("evidencia", foto);
    };
    if (resultado === "entregada") {
      fd.set("montoRecibido", String(montoACobrar));
      // Feature 213 (R15): el desglose viaja como pares REPETIDOS emparejados por índice, en el
      // orden en que se capturaron (mismo patrón `append` que las evidencias de la 119, y
      // exactamente lo que lee `rawFromFormData`). Sin líneas no se crea ninguna clave, que es
      // la forma de una entrega sin cobro (R16). El escalar `metodoPago` YA NO SE ENVÍA.
      for (const linea of lineasParaEnviar(lineas)) {
        fd.append("pagoMetodo", linea.metodo);
        fd.append("pagoMonto", String(linea.monto));
      }
      anexarEvidencias();
    } else if (resultado === "reprogramada") {
      fd.set("fechaReprogramacion", fechaReprogramacion);
      fd.set("motivo", motivo);
    } else if (resultado === "devuelta") {
      fd.set("causaDevolucion", causaDevolucion); // feature 73 (R9)
      fd.set("motivo", motivo);
      anexarEvidencias(); // feature 75/119: evidencia obligatoria
    } else if (resultado === "incidente") {
      fd.set("causaIncidente", causaIncidente); // feature 158 (R9)
      fd.set("motivo", motivo); // feature 158 (R11)
      anexarEvidencias(); // feature 158 (R10/Q-B): obligatoria en las TRES causas
    } else {
      fd.set("motivo", motivo);
      anexarEvidencias();
    }
    return fd;
  }

  /** Paso 1: fija el puntero 1-a-1 y, si ok, revela los 4 botones. */
  async function handleGestionarPedido() {
    const ok = await onGestionarPedido();
    if (ok) setPaso("resultados");
  }

  /** Cancela la gestión en curso: libera el puntero y vuelve al detalle. */
  async function handleCancelarGestion() {
    if (cancelando) return;
    setCancelando(true);
    setPaso("detalle");
    setFieldErrors({});
    try {
      await onCancelarGestion();
    } finally {
      setCancelando(false);
    }
  }

  /** Paso 2: elige un resultado y muestra sus campos condicionales. */
  function elegirResultado(next: Resultado) {
    setResultado(next);
    setFieldErrors({});
    setLineas(lineasDeArranque(orden.montoCobrar)); // feature 213/R10
    setErroresLineas([]);
    setFechaReprogramacion(mananaISO());
    setMotivo("");
    setCausaDevolucion(""); // feature 73/R4: cambiar de resultado no arrastra la causa anterior
    setCausaIncidente(""); // feature 158/R9: ídem para la causa del incidente
    setEvidencias([]); // feature 119: cambiar de resultado limpia las fotos elegidas
    setPaso("formulario");
  }

  /**
   * Feature 213 — la barrera PREVENTIVA del desglose. `true` = se puede seguir.
   *
   * R13: una línea a medias se señala EN SU LÍNEA y no se descarta en silencio ([Q6]).
   * R14: sin ninguna línea y con cobro, el error cuelga de `metodoPago`, que es donde la regla 3
   * del borde pone el suyo (así el mismo mensaje sirva venga de donde venga).
   * R9: el descuadre lo pinta el resumen de forma continua; aquí solo corta el envío.
   */
  function revisarDesglose(): boolean {
    const errores = erroresDeLinea(lineas);
    if (errores.some((e) => e !== undefined)) {
      setErroresLineas(errores);
      return false;
    }
    setErroresLineas([]);
    if (lineasParaEnviar(lineas).length === 0) {
      setFieldErrors({ metodoPago: [ERRORES_LINEA.metodoRequerido] });
      return false;
    }
    if (!capturaCuadra(lineas, montoACobrar)) return false;
    return true;
  }

  // Pedido humano 2026-08-18 — SOLICITAR AYUDA. El motivo se publica como una nota MÁS del hilo
  // de esta orden (el mismo que se lee unos bloques más abajo) y la orden queda marcada, que es
  // lo que la hace aparecer en `/novedades` para la tienda. Por eso al terminar se refresca el
  // hilo: el motivo recién escrito tiene que aparecer ahí, o parecería que se perdió.
  const [ayudaAbierta, setAyudaAbierta] = useState(false);
  const [pidiendoAyuda, setPidiendoAyuda] = useState(false);

  async function handleSolicitarAyuda(motivo: string) {
    if (pidiendoAyuda) return;
    setPidiendoAyuda(true);
    try {
      const result = await solicitarAyudaOrden({ ordenId: orden.id, motivo });
      if (result.status === "ok") {
        setAyudaAbierta(false);
        toast.success(MSG_AYUDA_OK);
        await refrescarHilo();
        // El listado de arriba reparte las órdenes con ayuda a su propia sección, así que
        // tiene que volver a leerse: si no, ésta se quedaría donde ya no va.
        onSuccess();
        return;
      }
      if (result.status === "validation_error") {
        toast.error(MSG_AYUDA_MOTIVO);
        return;
      }
      toast.error(
        result.status === "unauthenticated"
          ? HILO_TEXTOS.sesion
          : MSG_AYUDA_FORBIDDEN,
      );
    } finally {
      setPidiendoAyuda(false);
    }
  }

  async function handleConfirm() {
    if (enviando || comprimiendo || ubicando) return; // feature 193/R21

    // Feature 213 (R9/R13/R14): el desglose se comprueba ANTES incluso de pedir la ubicación.
    // Pedir el permiso para una gestión que ya se sabe que no sale sería gastar el único gesto
    // que el mensajero concede de buena gana. El `gestionarSchema` de más abajo sigue siendo la
    // segunda barrera (R17) y el borde del servidor la tercera: aquí no se duplica la REGLA
    // —la suma la decide el mismo `sumaCuadra` de la 212—, solo el MOMENTO en que se dice.
    if (resultado === "entregada" && !sinCobro && !revisarDesglose()) return;

    // Feature 193 (R16/R22): la ubicación se pide AQUÍ, al confirmar, y no al abrir el panel
    // ni al navegar. Pedir el permiso sin una acción que lo justifique es como se consigue
    // que la persona lo deniegue para siempre — y aquí denegarlo tiene consecuencias (R19).
    setUbicando(true);
    let captura: CapturaUbicacion;
    try {
      captura = await capturarUbicacion();
    } finally {
      setUbicando(false);
    }

    // R19: el ÚNICO desenlace que bloquea. Es una decisión de la persona y ella misma puede
    // revertirla, por eso el aviso dice DÓNDE se reactiva y no solo que falta. Un fallo
    // técnico, en cambio, sigue adelante (R18): en una bodega sin señal no hay nada que el
    // mensajero pueda hacer, y trabarlo ahí le impediría cerrar el día.
    if (captura.estado === "denegado") {
      toast.error(MSG_UBICACION_DENEGADA);
      return;
    }

    // R22/R24/R25/R27/R29: validación de borde en cliente (mismo schema que el
    // servidor revalida). Errores → por campo, sin enviar.
    const parsed = gestionarSchema.safeParse(buildRaw(captura));
    if (!parsed.success) {
      setFieldErrors(
        parsed.error.flatten().fieldErrors as Record<string, string[]>,
      );
      return;
    }
    setFieldErrors({});

    setEnviando(true);
    try {
      const result = await gestionar(buildFormData(captura));
      if (result.status === "ok") {
        toast.success(
          `Orden ${orden.numRemision}: ${estatusLabel(result.estado)}.`,
        );
        onSuccess();
        return;
      }
      if (result.status === "validation_error") {
        // R22/R24 (p. ej. monto != montoCobrar): el servidor devuelve los campos.
        setFieldErrors(result.fieldErrors);
        return;
      }
      // R18/R21 (conflict) / R12 (forbidden) / unauthenticated: Toast de dominio.
      toast.error(
        result.status === "conflict"
          ? "La orden ya no puede gestionarse (estado cambiado o hay otra activa)."
          : "No tienes permiso para gestionar esta orden.",
      );
    } finally {
      setEnviando(false);
    }
  }

  // R14: la regla 3 del borde cuelga «método de pago requerido» de `metodoPago`, así que el
  // editor sigue pintando ese campo aunque ya no exista el selector único.
  const metodoError = firstError(fieldErrors, "metodoPago");
  // R18: un `validation_error` del servidor con errores en `pagos` se pinta EN el editor, no se
  // pierde en silencio (es el camino por el que llegan las reglas 1, 2, 4 y 5 del borde).
  const pagosError = firstError(fieldErrors, "pagos");
  // R9: la diferencia se calcula y se dice de forma CONTINUA, no al pulsar.
  // Feature 300: QUÉ se dice lo decide `mensajeDeCuadre`, que vive con el editor y es el mismo
  // para los dos consumidores. Con un monto a cobrar con céntimos el desglose no puede cuadrar
  // —aquí solo se teclean enteros—, y entonces el aviso lo DICE con el número real delante en
  // vez de repetir «debe sumar exactamente», que pide algo imposible junto a una diferencia
  // pintada como cero.
  const cuadreError = sinCobro ? undefined : mensajeDeCuadre(lineas, montoACobrar);
  // El desglose que no cuadra no llega ni a intentarlo: «Guardar gestión» se deshabilita mientras
  // la suma no iguale el monto a cobrar. `revisarDesglose` (:538) sigue siendo la barrera de
  // verdad —el botón puede habilitarse con las líneas a medias—; esto solo evita el pulso inútil.
  const desgloseBloquea = resultado === "entregada" && cuadreError !== undefined;
  // Feature 119: la evidencia es una LISTA -> tanto el cliente (`safeParse`) como el servidor
  // cuelgan sus errores del campo `evidencias`.
  const evidenciaError = firstError(fieldErrors, "evidencias");
  const fechaError = firstError(fieldErrors, "fechaReprogramacion");
  const motivoError = firstError(fieldErrors, "motivo");
  const causaError = firstError(fieldErrors, "causaDevolucion");
  const causaIncidenteError = firstError(fieldErrors, "causaIncidente"); // feature 158/R9

  const resultadoLabel =
    RESULTADO_BOTONES.find((b) => b.value === resultado)?.label ?? "";

  // Feature 276 (T11, R8/R10): el juego de desenlaces que esta orden admite. `enElTope` llega YA
  // DECIDIDO del servidor —la pantalla no compara intentos con ningún umbral—, y su ausencia (un
  // fixture viejo; el DTO lo declara opcional por el patrón aditivo) se lee como `false`, que es
  // el comportamiento de siempre.
  const enElTope = orden.enElTope === true;
  const botonesResultado = useMemo(() => botonesDeResultado(enElTope), [enElTope]);

  return (
    <section
      aria-label="Detalle de la orden"
      className="relative mx-auto flex w-full max-w-md flex-col overflow-x-hidden rounded-2xl border border-border bg-background shadow-xs"
    >
      {/* Cabecera: guía, posición en la ruta y estado. Pegada arriba mientras se hace
          scroll por el detalle (el mensajero siempre sabe qué orden tiene abierta). */}
      <header className="sticky top-0 z-10 flex items-center gap-3 rounded-t-2xl border-b border-border bg-card/90 px-4 py-3 backdrop-blur-md">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm font-bold text-foreground">
            Guía {orden.numGuia ?? orden.numRemision}
          </p>
          <p className="text-xs text-muted-foreground">
            {orden.secuenciaRuta === null
              ? `${count} ${count === 1 ? "orden" : "órdenes"} en reparto`
              : `Parada ${orden.secuenciaRuta} de ${count}`}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-warning/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-warning-strong">
          {estatusLabel(orden.estatusValue)}
        </span>
      </header>

      <div className="flex flex-col gap-4 px-4 py-4">
        {/* Detalle completo en 3 cards: Pedido / Entrega / Cobro. */}
        <AsignacionDetalle orden={orden} />

        {/* Acciones de contacto y navegación, los tres gestos de la puerta. "Llamar" y
            "Navegar" salen de la app (tel: y Maps); "Mensaje" abre el CHAT del módulo en
            la conversación de esta orden (ahí se leen y envían los mensajes). */}
        <div className="flex gap-2">
          {/* Feature 87 (R17): marcar con el teléfono CRUDO del destinatario, como hacía
              `ContactoButtons` (que aquí se sustituye por la fila de tres acciones del
              rediseño, no por un comportamiento distinto). */}
          <a
            href={`tel:${orden.telefonoDest}`}
            aria-label={`Llamar a ${orden.destinatario}`}
            className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl bg-primary py-3.5 text-xs font-bold uppercase tracking-wide text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Phone className="size-5" aria-hidden="true" />
            Llamar
          </a>
          <button
            type="button"
            onClick={onAbrirChat}
            aria-label={`Abrir el chat con ${orden.destinatario}`}
            className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl bg-success-strong py-3.5 text-xs font-bold uppercase tracking-wide text-white transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <MessageCircle className="size-5" aria-hidden="true" />
            Mensaje
          </button>
          <UbicacionTrigger
            orden={orden}
            ariaLabel={`Ver en el mapa la ruta hasta ${orden.destinatario}`}
            className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl bg-navy py-3.5 text-xs font-bold uppercase tracking-wide text-white transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Navigation className="size-5" aria-hidden="true" />
            Navegar
          </UbicacionTrigger>
          {/* Pedido humano 2026-08-18 — CUARTO gesto de la puerta: pedir ayuda sobre ESTA orden.
              Va con los otros tres y no en el bloque de gestión porque no es un desenlace: no
              cierra la orden ni cambia su estatus, es una llamada de auxilio mientras se está
              delante del cliente, igual que llamar o navegar.

              Ya marcada, el botón NO desaparece ni se deshabilita: se rotula «Ayuda pedida» y
              sigue abriendo el modal, porque lo que el mensajero suele necesitar la segunda vez
              es AÑADIR contexto, no enterarse de que ya no puede decir nada. Cada envío suma un
              motivo al hilo y la marca sigue encendida (el efecto es idempotente). */}
          <button
            type="button"
            onClick={() => setAyudaAbierta(true)}
            aria-label={`Solicitar ayuda con la orden de ${orden.destinatario}`}
            className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl bg-destructive py-3.5 text-xs font-bold uppercase tracking-wide text-white transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <LifeBuoy className="size-5" aria-hidden="true" />
            {/* Feature 235 (T3.3): el rotulo pasa a ser FIJO. Antes alternaba «Ayuda» / «Ayuda
                pedida» segun la bandera `orden.ayuda`, y podia hacerlo porque la orden marcada
                seguia en el panel. Ya no: este panel solo se abre sobre ordenes `en_reparto`
                (`cargarOrdenGestionable`), asi que una orden con ayuda pedida NUNCA llega aqui —
                esta abajo, en su seccion propia, que es donde el mensajero mira ese estado. */}
            Ayuda
          </button>
        </div>

        {/* Montado sólo al abrir y con `key` de la orden: el motivo arranca fresco en cada
            apertura, sin efecto de reinicio. */}
        {ayudaAbierta ? (
          <SolicitarAyudaModal
            key={orden.id}
            orden={orden}
            onOpenChange={setAyudaAbierta}
            onConfirmar={handleSolicitarAyuda}
            enviando={pidiendoAyuda}
          />
        ) : null}

        {/* Feature 87 (R17): plantilla -> wa.me. Sigue disponible como salida a WhatsApp
            del propio mensajero (sirve con plantillas `pending`, que el chat no admite). */}
        {/* <div className="flex items-center gap-2">
          <EnviarPlantillaWhatsappButton orden={orden} size="sm" />
          <span className="text-xs text-muted-foreground">
            Abrir WhatsApp con una plantilla
          </span>
        </div> */}

        {/* Feature 227 (T3.4, design §5.2): el HILO con la tienda, hermano de
            `AsignacionDetalle` y en el hueco que dejó el editor de la nota privada. Es
            conversación de ESTA orden y no se confunde con la "Notas" de la tienda (dentro
            del detalle, R25) ni con el chat de WhatsApp con el cliente (botón "Mensaje").
            Sin pantalla nueva (P6). */}
        {cargandoHilo ? (
          <p role="status" className="text-xs text-muted-foreground">
            {HILO_TEXTOS.cargando}
          </p>
        ) : hiloOk ? (
          <HiloNotasOrden
            ordenId={orden.id}
            notas={hiloOk.notas}
            puedeEscribir={hiloOk.puedeEscribir}
            onPublicar={publicarNotaOrden}
            onBorrar={borrarNotaOrden}
            onRefrescar={async () => {
              await refrescarHilo();
            }}
            titulo={HILO_TEXTOS.titulo}
            // Pedido humano del 2026-08-19: acá el hilo se LEE. Escribir es la excepción, y
            // un área de texto siempre desplegada empujaba las notas —y el resto de la
            // gestión— fuera de la pantalla del teléfono.
            compositorColapsado
          />
        ) : (
          /* Rechazo tipado (o fallo de transporte, que SWR ya capturó): se dice, y el resto
             de la gestión sigue en pie — este panel se usa en la calle y con mala cobertura. */
          <p role="alert" className="text-xs text-danger-strong">
            {hilo?.status === "unauthenticated"
              ? HILO_TEXTOS.sesion
              : HILO_TEXTOS.fallo}
          </p>
        )}

        {/* Paso 1: verificar la guía antes de gestionar. La sección se revela al pulsar
            "Gestionar esta orden" (CTA fijo abajo); cerrada, el detalle se lee de un tirón. */}
        {paso === "detalle" && gestion.montada ? (
          <div
            ref={guiaRef}
            className={`scroll-mt-20 rounded-2xl border border-border bg-card p-4 ${gestion.clase}`}
          >
            <div className="mb-3 flex items-center gap-2">
              <QrCode className="size-5 shrink-0 text-brand" aria-hidden="true" />
              <h3 className="flex-1 text-sm font-bold text-foreground">
                Gestionar esta orden
              </h3>
              {/* Se puede volver a ocultar: abrirla no deja al
                  mensajero atrapado con el escáner ocupando la pantalla. Sin guía asignada no
                  hay nada que ocultar —el bloque es solo el aviso—, así que no se ofrece. */}
              {orden.numGuia !== null ? (
                <button
                  type="button"
                  onClick={gestion.cerrar}
                  aria-expanded
                  aria-label="Ocultar gestión de la orden"
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <ChevronUp className="size-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {/* Feature 98: gate de verificación. Antes de fijar el puntero y avanzar
                a los 4 botones, el mensajero DEBE confirmar la guía del paquete
                (escaneo o tecleo) y esta debe COINCIDIR con `orden.numGuia`. Solo
                entonces se dispara `handleGestionarPedido` (escogerParaGestion). */}
            <VerificarGuiaGate
              numGuiaEsperado={orden.numGuia}
              onVerificado={handleGestionarPedido}
            />
          </div>
        ) : null}

      {/* Paso 2: botones GRANDES de resultado (entrada suave). Los 4 desenlaces normales en
          la grilla; el reporte de incidente aparte, bajo el separador (feature 158/R33). */}
      {paso === "resultados" ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 duration-300 animate-in fade-in slide-in-from-bottom-2">
          <p className="text-sm font-medium text-muted-foreground">
            ¿Cómo terminó la gestión?
          </p>
          {/* Feature 276 (R9): POR QUÉ faltan «Reprogramar» y «Devolver». Va ARRIBA de la grilla,
              antes de que el mensajero busque el botón que ya no está, y con `role="note"` y no
              `alert`: no es la consecuencia de un error suyo, es la condición de esta orden. */}
          {enElTope ? (
            <p
              role="note"
              className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-strong"
            >
              {TOPE_INTENTOS_NOTA}
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {botonesResultado.normales.map(({ value, label, Icon, className }) => (
              <Button
                key={value}
                type="button"
                onClick={() => elegirResultado(value)}
                className={`h-16 w-full flex-col gap-1 text-base font-semibold ${className}`}
              >
                <Icon className="size-5" aria-hidden="true" />
                {label}
              </Button>
            ))}
          </div>

          {/* Feature 158 (R33): el incidente NO es un desenlace más de la entrega, así que se
              ofrece en su propio bloque, bajo un separador y con el aviso que explica cuándo
              aplica. Diferenciado visualmente Y con texto (no solo por color).

              Feature 276: el bloque entero cuelga de que quede algo que ofrecer. Hoy el incidente
              sobrevive siempre al filtro del tope (decisión 3 del humano), así que la condición no
              se cumple nunca; está para que el día que deje de sobrevivir no quede un separador con
              un aviso y ningún botón debajo. */}
          {botonesResultado.aparte.length > 0 ? (
            <div
              aria-label="Reportar un incidente con el paquete"
              role="group"
              className="flex flex-col gap-2 border-t border-border pt-3"
            >
              <p className="text-sm text-muted-foreground">{INCIDENTE_APARTE_NOTA}</p>
              {botonesResultado.aparte.map(({ value, label, Icon, className }) => (
                <Button
                  key={value}
                  type="button"
                  variant="outline"
                  onClick={() => elegirResultado(value)}
                  className={`h-14 w-full gap-2 text-base font-semibold ${className}`}
                >
                  <Icon className="size-5" aria-hidden="true" />
                  {label}
                </Button>
              ))}
            </div>
          ) : null}

          <Button
            type="button"
            variant="outline"
            onClick={handleCancelarGestion}
            disabled={cancelando}
            className="w-full"
          >
            Cancelar gestión
          </Button>
        </div>
      ) : null}

      {/* Paso 3: campos condicionales del resultado elegido. */}
      {paso === "formulario" ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 duration-300 animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold">{resultadoLabel}</h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setFieldErrors({});
                setPaso("resultados");
              }}
            >
              Atrás
            </Button>
          </div>

          {resultado === "entregada" ? (
            <>
              {/* Sin cobro (montoCobrar 0/null): no hay nada que repartir, así que no se monta
                  el editor y la entrega se registra con recaudo 0 y CERO líneas (213/R16). En su
                  sitio va la nota: el hueco vacío se lee como un campo que falta. */}
              {sinCobro ? (
                <p role="note" className="text-sm text-muted-foreground">
                  {SIN_COBRO_NOTA}
                </p>
              ) : (
                <DesglosePagoField
                  lineas={lineas}
                  montoACobrar={montoACobrar}
                  errores={erroresLineas}
                  errorCuadre={cuadreError}
                  errorMetodo={metodoError}
                  errorServidor={pagosError}
                  onChange={actualizarLineas}
                />
              )}
              <EvidenciasField
                inputId="gestion-evidencia"
                label="Fotos de evidencia"
                ariaLabel="Foto de evidencia de entrega"
                files={evidencias}
                error={evidenciaError}
                onSelect={handleEvidenciaChange}
                onRemove={quitarEvidencia}
              />
            </>
          ) : null}

          {resultado === "reprogramada" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gestion-fecha">Nueva fecha</Label>
                <Input
                  id="gestion-fecha"
                  type="date"
                  // R25: la reprogramación más temprana posible es mañana. El
                  // `min` lo impide en el date picker; `gestionarSchema` lo
                  // revalida en cliente y el servidor otra vez (no es la defensa).
                  min={mananaISO()}
                  value={fechaReprogramacion}
                  onChange={(e) => setFechaReprogramacion(e.target.value)}
                  aria-invalid={fechaError ? true : undefined}
                  aria-label="Nueva fecha de reprogramación"
                />
                {fechaError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {fechaError}
                  </p>
                ) : null}
              </div>
              <MotivoField value={motivo} onChange={setMotivo} error={motivoError} />
            </>
          ) : null}

          {resultado === "devuelta" ? (
            <>
              <CausaField
                value={causaDevolucion}
                onChange={setCausaDevolucion}
                error={causaError}
              />
              {/* Feature 75/119: evidencia OBLIGATORIA (lista), espejo de la rama `rechazada`. */}
              <EvidenciasField
                inputId="gestion-evidencia-devolucion"
                label="Fotos de evidencia"
                ariaLabel="Foto de evidencia de la devolución"
                files={evidencias}
                error={evidenciaError}
                onSelect={handleEvidenciaChange}
                onRemove={quitarEvidencia}
              />
              <MotivoField value={motivo} onChange={setMotivo} error={motivoError} />
            </>
          ) : null}

          {resultado === "rechazada" ? (
            <>
              <EvidenciasField
                inputId="gestion-evidencia-rechazo"
                label="Fotos de evidencia"
                ariaLabel="Foto de evidencia del rechazo"
                files={evidencias}
                error={evidenciaError}
                onSelect={handleEvidenciaChange}
                onRemove={quitarEvidencia}
              />
              <MotivoField value={motivo} onChange={setMotivo} error={motivoError} />
            </>
          ) : null}

          {/* Feature 158 (R9/R10/R11): causa tipificada + fotos obligatorias en las TRES
              causas + motivo libre. El orden es el mismo que en `devuelta` (causa → fotos →
              motivo) para que el flujo se sienta conocido. */}
          {resultado === "incidente" ? (
            <>
              <p role="note" className="text-sm text-muted-foreground">
                {INCIDENTE_APARTE_NOTA}
              </p>
              <CausaIncidenteField
                value={causaIncidente}
                onChange={setCausaIncidente}
                error={causaIncidenteError}
              />
              <EvidenciasField
                inputId="gestion-evidencia-incidente"
                label="Fotos de evidencia"
                ariaLabel="Foto de evidencia del incidente"
                files={evidencias}
                error={evidenciaError}
                onSelect={handleEvidenciaChange}
                onRemove={quitarEvidencia}
                ayuda={INCIDENTE_EVIDENCIA_AYUDA}
              />
              <MotivoField value={motivo} onChange={setMotivo} error={motivoError} />
            </>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancelarGestion}
              disabled={cancelando || enviando}
            >
              Cancelar gestión
            </Button>
            {/* Feature 193/R21: `ubicando` cuenta como ocupado igual que `enviando`. La
                captura puede tardar hasta 10 s y sin esto el botón se vería inerte: el
                mensajero volvería a pulsarlo y saldrían dos gestiones de la misma orden. */}
            <Button
              type="button"
              onClick={handleConfirm}
              loading={enviando || ubicando}
              disabled={comprimiendo || desgloseBloquea}
            >
              {comprimiendo
                ? "Procesando foto…"
                : ubicando
                  ? "Obteniendo ubicación…"
                  : "Guardar gestión"}
            </Button>
          </div>
        </div>
      ) : null}
      </div>

      {/* CTA fijo abajo mientras se lee el detalle. NO salta el gate de la feature 98: ABRE
          el bloque "Gestionar esta orden" (escáner QR + número de guía) y pone el foco en su
          input, que es donde arranca la gestión de verdad. Con la gestión ya en curso
          (resultados/formulario) desaparece: el CTA de ese paso es "Guardar gestión". */}
      {paso === "detalle" && orden.numGuia !== null ? (
        <div className="sticky bottom-0 z-10 rounded-b-2xl border-t border-border bg-card/90 p-4 backdrop-blur-md">
          <button
            type="button"
            aria-expanded={gestion.abierta}
            onClick={() => {
              // Acordeón: el mismo control abre y cierra.
              if (gestion.abierta) {
                gestion.cerrar();
                return;
              }
              gestion.abrir();
              setIrAGestion((n) => n + 1);
            }}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-4 text-base font-bold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <Truck className="size-5" aria-hidden="true" />
            Gestionar esta orden
          </button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Feature 73 (R3/R4): selector de la causa TIPIFICADA, sólo en la rama `devuelta`. Radios
 * (decisión F1.4-f): las 3 opciones visibles de una, móvil-first, sin dropdown que abrir en la
 * calle. Las etiquetas salen SIEMPRE de `CAUSA_DEVOLUCION_OPTIONS` (derivadas del SEED) → aquí
 * no se duplica ninguna cadena ni se pinta el slug crudo del enum. Vive en este archivo, como
 * `MotivoField`: un solo consumidor (docs/architecture.md "sin sobre-ingeniería").
 */
function CausaField({
  value,
  onChange,
  error,
}: {
  value: CausaDevolucion | "";
  onChange: (value: CausaDevolucion | "") => void;
  error: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {/* Título visible del grupo; el nombre accesible del `radiogroup` lo da su `aria-label`
          (mismo contrato que el `Select` de "Método de pago", :372-379). */}
      <Label>Causa de la devolución</Label>
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as CausaDevolucion | "")}
        options={CAUSA_DEVOLUCION_OPTIONS}
        aria-label="Causa de la devolución"
        aria-invalid={error ? true : undefined}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Feature 158 (R9/R33): selector de la causa TIPIFICADA del incidente, sólo en la rama
 * `incidente`. Espejo exacto de `CausaField` (73): radios, las 3 opciones visibles de una,
 * móvil-first, sin dropdown que abrir en la calle. Las etiquetas salen SIEMPRE de
 * `CAUSA_INCIDENTE_OPTIONS` (derivadas del SEED) → aquí no se duplica ninguna cadena ni se
 * pinta el slug crudo del enum (`danado` se muestra como "Paquete dañado").
 */
function CausaIncidenteField({
  value,
  onChange,
  error,
}: {
  value: CausaIncidente | "";
  onChange: (value: CausaIncidente | "") => void;
  error: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Causa del incidente</Label>
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as CausaIncidente | "")}
        options={CAUSA_INCIDENTE_OPTIONS}
        aria-label="Causa del incidente"
        aria-invalid={error ? true : undefined}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Feature 119 (R14/R15/R16): campo de evidencias MÚLTIPLES, reusado en las 3 ramas con foto
 * (entregada/devuelta/rechazada). Vive en este archivo, como `MotivoField`/`CausaField`: un solo
 * consumidor (docs/architecture.md "sin sobre-ingeniería"). Ofrece selección múltiple, una
 * previsualización por foto y un botón para quitarla individualmente antes de enviar. El nombre
 * accesible del input lo da `ariaLabel` (mismo contrato que el input único anterior, para no
 * romper a quien lo localiza por ese nombre). El tope y la concatenación los aplica el padre en
 * `onSelect`; aquí sólo se pinta el estado (`files`) y se avisa del límite.
 */
function EvidenciasField({
  inputId,
  label,
  ariaLabel,
  files,
  error,
  onSelect,
  onRemove,
  ayuda,
}: {
  inputId: string;
  label: string;
  ariaLabel: string;
  files: File[];
  error: string | undefined;
  onSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  onRemove: (index: number) => void;
  /**
   * Feature 158 (Q-B): texto de ayuda de la rama que lo necesite, ENCIMA del selector. Existe
   * porque el incidente exige foto también cuando no hay paquete que fotografiar y el
   * mensajero necesita saber qué se espera de él, no solo que el campo es obligatorio.
   * Omitido en las otras ramas → se comportan exactamente igual que antes.
   */
  ayuda?: string;
}) {
  // Una object URL por foto para la previsualización (R15). Se derivan con `useMemo` (sin
  // `setState` en efecto) y sólo se recalculan cuando cambia `files` —que sólo cambia de
  // referencia cuando el padre agrega/quita una foto, no en cada re-render—. El efecto de
  // limpieza REVOCA el lote anterior al cambiar la lista (quitar una foto) y al desmontar, para
  // no fugar memoria.
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => {
    return () => previews.forEach((u) => URL.revokeObjectURL(u));
  }, [previews]);

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      {ayuda ? (
        <p id={`${inputId}-ayuda`} className="text-xs text-muted-foreground">
          {ayuda}
        </p>
      ) : null}
      {previews.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Fotos de evidencia seleccionadas">
          {previews.map((url, i) => (
            <li key={url} className="relative">
              {/* Vista previa local de un object URL: next/image no aplica a un blob del cliente. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Evidencia ${i + 1}`}
                className="size-20 rounded-md border border-border object-cover"
              />
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label={`Quitar evidencia ${i + 1}`}
                className="absolute -right-1.5 -top-1.5 rounded-full border border-background bg-destructive p-0.5 text-destructive-foreground shadow-xs hover:bg-destructive/90"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {/* Zona de carga: el `input[type=file]` crudo pintaba un botón gris de sistema que en el
          móvil no se lee como «aquí van las fotos». El input sigue existiendo y sigue siendo el
          control (mismo id, mismo `aria-label`, misma validez): sólo se oculta VISUALMENTE con
          `sr-only` —nunca con `hidden`/`display:none`, que lo sacaría del foco y del teclado— y
          la superficie visible es su `<label>`, que le traslada el clic y el tap.

          El foco vive en el input, así que el anillo se pinta con `has-[:focus-visible]` sobre
          la zona: quien navega con teclado ve resaltado el área, no un input invisible. */}
      <input
        id={inputId}
        type="file"
        accept={ACCEPT_MIME}
        multiple
        onChange={onSelect}
        aria-invalid={error ? true : undefined}
        aria-label={ariaLabel}
        aria-describedby={`${inputId}-limite${ayuda ? ` ${inputId}-ayuda` : ""}`}
        className="sr-only"
      />
      <label
        htmlFor={inputId}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 ${
          error
            ? "border-destructive/60 bg-destructive/5"
            : "border-input bg-muted/30 hover:border-ring hover:bg-muted/60"
        }`}
      >
        <span
          aria-hidden="true"
          className="flex size-10 items-center justify-center rounded-full bg-background text-muted-foreground shadow-xs"
        >
          {files.length > 0 ? (
            <ImagePlus className="size-5" />
          ) : (
            <Camera className="size-5" />
          )}
        </span>
        <span className="text-sm font-medium text-foreground">
          {files.length > 0 ? "Añadir otra foto" : "Toca para tomar o subir fotos"}
        </span>
        <span id={`${inputId}-limite`} className="text-xs text-muted-foreground">
          {`${FORMATOS_EVIDENCIA} · hasta ${MAX_EVIDENCIAS} fotos (${files.length}/${MAX_EVIDENCIAS})`}
        </span>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function MotivoField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="gestion-motivo">Motivo</Label>
      <textarea
        id="gestion-motivo"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-label="Motivo"
        rows={3}
        className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30"
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
