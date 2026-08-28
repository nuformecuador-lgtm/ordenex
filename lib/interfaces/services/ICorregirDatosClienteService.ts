import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CampoCorregible } from "@/lib/types/correccion-datos-cliente";

// Ficha 312 (2026-08-28) — contrato de LA CORRECCION DE LOS DATOS DEL CLIENTE de una orden.
//
// SERVICIO PROPIO Y NO UN METODO MAS DE `IOrdenService`, por la misma razon que «eliminar orden»:
// aquel es SOLO LECTURAS desde el 2026-08-07 (ver su cabecera) y la escritura de ordenes vive, por
// convencion de este repo, en un servicio de dominio POR ACCION (`DeshacerAsignacionService`,
// `RecuperacionBodegaService`, `EliminarOrdenService`, ...). Esta es una accion mas de esa familia.
//
// QUE PROBLEMA CIERRA. La carga masiva entra con el destinatario o el telefono mal escritos y hoy
// la aplicacion no ofrece NINGUNA superficie para arreglarlo: la unica via es un `UPDATE` a mano
// contra produccion.
//
// ⚠️ SIN RASTRO (D4, decision humana del 2026-08-28). Corregir NO publica nota en el hilo, NO
// escribe fila de historial y NO crea ninguna tabla de auditoria: el unico rastro es el
// `updated_at` de la fila. Lo que eso cuesta esta escrito en `requirements.md` §D4 y la
// alternativa completa esta EVALUADA Y DESCARTADA en `design.md` §8/B. No es un olvido, y `cambios`
// (abajo) no lo contradice: es un valor de RESPUESTA, efimero, que no se persiste en ningun sitio.

export interface CorregirDatosClienteInput {
  ordenId: string;
  /** D1 — los CUATRO campos y nada mas. Ausente = «no lo toques»; `notas: null` = «vacialo». */
  destinatario?: string;
  telefonoDest?: string;
  producto?: string;
  notas?: string | null;
}

/**
 * Los cuatro desenlaces (design §4.2).
 *
 * `cambios` dice QUE CAMBIO EL SERVIDOR, no que mando la pantalla — mismo criterio que
 * `eliminadas` en `EliminarOrdenServiceResult`. Vacio significa «lo enviado ya era lo almacenado»
 * (R4): no se escribio nada y eso NO es un error.
 *
 * `forbidden` es OPACO A PROPOSITO (R12): rol no autorizado, orden inexistente, orden borrada y
 * orden de otra tienda devuelven EL MISMO objeto. Distinguirlos convertiria la respuesta en un
 * oraculo de que ordenes existen y de quien son.
 */
export type CorregirDatosClienteServiceResult =
  | { status: "ok"; cambios: readonly CampoCorregible[] } // R4
  | { status: "forbidden" } // R8/R9/R10/R11/R12
  | { status: "conflict" } // R13: el estado se movio entre la lectura y la escritura
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }; // R18

export interface ICorregirDatosClienteService {
  corregir(
    input: CorregirDatosClienteInput,
    actor: Actor,
  ): Promise<CorregirDatosClienteServiceResult>;
}
