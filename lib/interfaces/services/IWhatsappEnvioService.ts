import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  EnvioDetalleDTO,
  EnvioListItemDTO,
  EventoDisponibleDTO,
  GuardarEnvioInput,
  PreviewDestinatariosDTO,
  SeleccionDestinatariosInput,
} from "@/lib/types/envios-whatsapp";
import type { InformeResumen } from "@/lib/whatsapp-envios/informes/catalogo";

// Ficha 474 (design §7, T7.1) — contrato del service de ENVIOS configurados. SOLO `maestro` (R1).

export type { Actor };

type Prohibido = { status: "forbidden" };

export type ListarEnviosServiceResult = { status: "ok"; items: EnvioListItemDTO[] } | Prohibido;
export type ObtenerEnvioServiceResult = { status: "ok"; envio: EnvioDetalleDTO } | { status: "not_found" } | Prohibido;
export type GuardarEnvioServiceResult =
  | { status: "ok"; envio: EnvioDetalleDTO }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; campo: "nombre" }
  | { status: "not_found" }
  | Prohibido;
export type EncenderEnvioServiceResult =
  | { status: "ok"; envio: EnvioDetalleDTO }
  | { status: "no_encendible"; motivos: string[] }
  | { status: "not_found" }
  | Prohibido;
export type CambioSimpleServiceResult = { status: "ok"; envio: EnvioDetalleDTO } | { status: "not_found" } | Prohibido;
export type BorrarEnvioServiceResult = { status: "ok" } | { status: "not_found" } | Prohibido;
export type PreviewServiceResult = { status: "ok"; preview: PreviewDestinatariosDTO } | Prohibido;

export interface IWhatsappEnvioService {
  listar(actor: Actor): Promise<ListarEnviosServiceResult>;
  obtener(id: string, actor: Actor): Promise<ObtenerEnvioServiceResult>;
  /** R11-R16: nace APAGADO (R15) con los defaults del informe si no llegan parametros (R13). */
  crear(input: GuardarEnvioInput, actor: Actor): Promise<GuardarEnvioServiceResult>;
  /** R11-R16 + R20: si esta encendido y es a hora fija, encola la nueva programacion. */
  actualizar(id: string, input: GuardarEnvioInput, actor: Actor): Promise<GuardarEnvioServiceResult>;
  /** R18: rechaza con el motivo y deja apagado. R22: encola la proxima ocurrencia. */
  encender(id: string, actor: Actor): Promise<EncenderEnvioServiceResult>;
  /** R19. */
  apagar(id: string, actor: Actor): Promise<CambioSimpleServiceResult>;
  /** R25: «Reprogramar» = volver a encolar la proxima ocurrencia. */
  reprogramar(id: string, actor: Actor): Promise<CambioSimpleServiceResult>;
  /** R21: soft delete; el historial se conserva. */
  borrar(id: string, actor: Actor): Promise<BorrarEnvioServiceResult>;
  /** R17: lista resuelta y deduplicada, con avisos de telefono. NO escribe. */
  previsualizarDestinatarios(sel: SeleccionDestinatariosInput, actor: Actor): Promise<PreviewServiceResult>;
  /** R49: los eventos disponibles con su nombre. */
  listarEventosDisponibles(actor: Actor): { status: "ok"; eventos: EventoDisponibleDTO[] } | Prohibido;
  /** El catalogo de informes para el formulario (R13: defaults; R14: eventos). */
  listarInformes(actor: Actor): { status: "ok"; informes: InformeResumen[] } | Prohibido;
}
