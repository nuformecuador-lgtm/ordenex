import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { DiaReparto } from "@/lib/types/dia-reparto";

// Feature 34 — contrato del servicio de asignacion de la bodega satelite: el
// adminSatelite asigna un lote de ordenes `en_bodega_satelite` de SU zona a un
// mensajero de SU zona, transicionando cada orden a `por_recoger`
// (mismo destino del flujo del maestro, feature 17). Logica de negocio pura (sin
// HTTP ni Prisma); el borde (Server Action) la traduce a resultado tipado. Solo
// el rol `adminSatelite`, SIEMPRE acotado a su `usuario.zonaId` (server-side).
// Servicio PARALELO al `GuiaAsignacionService` del maestro (decision F1.4-a): NO
// generaliza `asignarDesdeBodega`, reusa las primitivas de repo por zona.

// R7/R15/R19: entrada del borde (validada con zod en la action). Lote de ordenes +
// UN mensajero para todo el lote (patron AsignarBodegaModal de la 17, F1.4-d).
export interface AsignarSateliteInput {
  ordenIds: string[];
  mensajeroId: string;
  /**
   * Feature 246 (T3.1/T3.2, R2/R3/R4/R6, decision D4) — espejo EXACTO de `AsignarBodegaInput.dia`.
   * Mismo token, mismo default, mismo significado: la regla no puede depender de desde que bodega
   * te asignaron. El servicio lo traduce a fecha con `resolverFechaReparto`; el cliente nunca
   * manda una fecha (R6).
   */
  dia?: DiaReparto;
}

// R7/R3/R9/R10/R13: maquina de resultados de la asignacion. Todos los rechazos son
// SIN efectos en datos (todo-o-nada, R10/R14). `ok` transiciona todas a
// `por_recoger`. `forbidden` = rol != adminSatelite (R13). `sin_zona` =
// adminSatelite sin zona (R3). `validation_error` cubre `mensajero_invalido` (R9)
// y el catalogo de estados incompleto (seed pendiente). `conflict` cubre las
// guardias por orden (R10-R12) y la carrera de escritura (R14); el motivo por
// orden usa los literales `no_encontrada` / `zona_ajena` / `estado_invalido: <estado>`.
// Feature 41/R18: causa del bloqueo de la bodega satelite (regla estricta R17). Al menos
// una de las dos es `true`. El borde (Server Action feature 34) la traduce al mensaje
// accionable de R22: (i) "resuelve los cierres de tus mensajeros" / (ii) "tu cierre de
// bodega hacia la central esta pendiente de aprobacion".
export interface BodegaBloqueadaCausa {
  porMensajeros: boolean;
  porCierreBodega: boolean;
}

export type AsignarSateliteServiceResult =
  | { status: "ok"; resultados: { ordenId: string; estado: "por_recoger" }[] } // R7
  | { status: "forbidden" } // R13
  | { status: "sin_zona" } // R3
  | { status: "bodega_bloqueada"; causa: BodegaBloqueadaCausa } // feature 41/R18: bodega bloqueada (i)||(ii)
  | { status: "validation_error"; fieldErrors: Record<string, string[]> } // R9 / catalogo / feature 41 mensajero bloqueado
  | { status: "conflict"; detalle: { ordenId: string; motivo: string }[] }; // R10-R12 / R14

export interface IAsignacionSateliteService {
  /**
   * R7/R3/R9/R10-R14: asigna el lote a un mensajero de la zona del actor. Guardias
   * en orden (sin efectos ante cualquier rechazo): rol adminSatelite (R13) → zona
   * del actor (R3) → mensajero de la zona (R9) → precarga y valida cada orden
   * (R10-R12) → escritura guardada por estado+zona con deteccion de carrera (R14).
   */
  asignar(
    input: AsignarSateliteInput,
    actor: Actor,
    /** Feature 246 (T3.2, R5): reloj inyectable del que sale el dia de reparto. Server-side. */
    now?: Date,
  ): Promise<AsignarSateliteServiceResult>;
}
