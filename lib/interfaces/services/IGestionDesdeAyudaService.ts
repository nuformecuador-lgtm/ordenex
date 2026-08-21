import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  GestionarDesdeAyudaActionInput,
  GestionarDesdeAyudaResult,
} from "@/lib/types/gestion-desde-ayuda";
import type { EvidenciaArchivo } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 237 (design §6, T5.3) — contrato del servicio que resuelve una orden desde la superficie
// de ayuda, con la tienda como actor y el mensajero como atribuido.

/**
 * Lo que llega del borde: los campos ya validados por `gestionarDesdeAyudaSchema` MENOS la lista
 * de archivos file-like, que la Server Action sustituye por su binario ya leido (`EvidenciaArchivo`,
 * el mismo tipo del camino del mensajero). El servicio no sabe nada de `FormData` ni de `File`.
 *
 * ⚠️ El `T extends` es lo que hace la sustitucion DISTRIBUTIVA sobre la union discriminada. Un
 * `Omit<Union, "evidencias">` la colapsa en un solo objeto y `fechaReprogramacion` deja de existir
 * en la rama que la exige: el discriminante se pierde y el servicio ya no puede estrechar por
 * `resultado`. No es un adorno de tipos — sin esto, el borde y el servicio dejan de hablar de lo
 * mismo.
 */
type ConEvidenciasLeidas<T> = T extends { evidencias: unknown }
  ? Omit<T, "evidencias"> & { evidencias: EvidenciaArchivo[] }
  : never;

export type GestionDesdeAyudaInput = ConEvidenciasLeidas<GestionarDesdeAyudaActionInput>;

export interface IGestionDesdeAyudaService {
  /**
   * R2-R26 — registra el desenlace y devuelve un resultado de DOMINIO (nunca lanza para expresar
   * un rechazo). Las ocho comprobaciones y su orden estan en `design.md` §6 y en el propio
   * servicio, con el porque de cada una.
   */
  gestionar(input: GestionDesdeAyudaInput, actor: Actor): Promise<GestionarDesdeAyudaResult>;
}
