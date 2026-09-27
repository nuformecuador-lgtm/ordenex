import type { RolValue } from "@prisma/client";

import type {
  MensajeAsistente,
  TrozoProveedor,
} from "@/lib/interfaces/external/IAsistenteProvider";
import type { DocumentoAnunciado } from "@/lib/asistente/protocolo";

/**
 * ⭑ FICHA 436 — contrato del servicio del asistente.
 *
 * ⚠️ NO CONOCE NEXT. Ni `Request`, ni `Response`, ni `cookies()`, ni `headers()`
 * (`docs/architecture.md`). Recibe un actor YA RESUELTO y devuelve un desenlace; traducirlo a
 * HTTP es trabajo del borde. Esa separación es lo que permite probar el acotamiento, el tope y
 * el streaming sin levantar un servidor.
 */

/** Quién pregunta. Sale de la SESIÓN (R7); el cuerpo de la petición no puede influir en esto. */
export interface ActorAsistente {
  usuarioId: string;
  rol: RolValue;
}

export interface ConsultaEntrante {
  actor: ActorAsistente;
  /** La conversación, que vive en el cliente (D10). El último turno es la pregunta de ahora. */
  mensajes: readonly MensajeAsistente[];
  /**
   * La ruta desde la que se abrió el asistente, para R27. **No amplía el conjunto**: se cruza
   * contra el contexto YA acotado y, si no casa, se ignora.
   */
  rutaActual?: string;
}

/**
 * El desenlace. Cada uno dice qué ve la persona:
 *
 *  - `ok`               — se atiende; los trozos llegan a medida que el proveedor escribe (R19).
 *  - `rol_no_admitido`  — `apiKey` o un rol fuera de `ROLES_AYUDA` (R13). El proveedor NO se llamó.
 *  - `tope_alcanzado`   — se agotaron las consultas de hoy (R15). El proveedor NO se llamó, y el
 *                         `mensaje` dice el número y cuándo vuelve: nunca «error».
 *  - `sin_credencial`   — el sistema no está configurado (R20). Ni 500 mudo ni llamada a nadie.
 *  - `proveedor_caido`  — el proveedor falló o agotó el tiempo. **Sin detalle** a propósito (R21):
 *                         lo que el proveedor dijo se queda en el servidor.
 */
export type RespuestaDelAsistente =
  | {
      status: "ok";
      /** El contexto de esa persona, SIN cuerpos: es lo que el cliente necesita para las citas. */
      documentos: DocumentoAnunciado[];
      /** El documento de la pantalla desde la que se abrió, si es de los suyos (R27). */
      partida: string | null;
      trozos: AsyncIterable<TrozoProveedor>;
    }
  | { status: "rol_no_admitido" }
  | { status: "tope_alcanzado"; mensaje: string }
  | { status: "sin_credencial" }
  | { status: "proveedor_caido" };

export interface IAsistenteService {
  responder(consulta: ConsultaEntrante): Promise<RespuestaDelAsistente>;
}
