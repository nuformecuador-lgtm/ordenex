import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { DetalleConflicto } from "@/lib/interfaces/services/IGuiaAsignacionService";

// FICHA 427 (T15, design §5/§7) — contrato del servicio que TRASPASA a otro mensajero un lote de
// ordenes que un mismo mensajero YA LLEVA ENCIMA (`en_reparto` o `ayuda_tienda`).
//
// Logica de negocio PURA: sin HTTP, sin Prisma, sin `next/`. El borde (Server Action,
// `lib/actions/traspasar-mensajero.ts`) resuelve la sesion, valida con zod, inyecta los dos
// notificadores REALES y traduce el resultado. `DetalleConflicto` se REUTILIZA de
// `IGuiaAsignacionService`: es el mismo contrato por-orden que ya consumen las acciones por lote
// del listado.

/**
 * Un lote: N ordenes, UN mensajero destino y UN motivo comun. El `motivo` llega ya recortado por el
 * borde (R28).
 *
 * ⚠️ NO HAY CAMPO DE MENSAJERO DE ORIGEN, Y ES R8 PUESTO EN EL TIPO. El origen se DERIVA de las
 * ordenes dentro del servicio, nunca se acepta del cliente: aceptarlo permitiria pedir «mueve estas
 * ordenes COMO SI fueran de X» y la guarda del `WHERE` compararia contra un valor elegido por quien
 * llama. Que el campo no exista lo hace inexpresable, en vez de depender de que nadie lo mande.
 */
export interface TraspasarMensajeroInput {
  ordenIds: string[];
  mensajeroDestinoId: string;
  motivo: string;
}

/** Los dos extremos, con nombre, para que la pantalla pueda decir «de quien a quien» (R35/R36). */
export interface TraspasoMensajeroExtremo {
  id: string;
  nombre: string;
}

/**
 * Mismo patron de resultado que `DeshacerAsignacionServiceResult`:
 *   - `forbidden`        rol no autorizado (R1/R2/D1). Se devuelve ANTES de leer nada;
 *   - `validation_error` guardas del mensajero DESTINO que se arreglan en otra pantalla (rol/zona,
 *                        vehiculo, estado de cuenta) y guardas de configuracion (catalogo de
 *                        estados incompleto);
 *   - `conflict`         rechazo POR ORDEN con motivo tipado (R5/R6/R7/R11/R13/R24), todo-o-nada:
 *                        NINGUNA orden se mueve.
 *
 * `movidas` y `conversaciones` son CIFRAS, no listas: alimentan R36 («se movieron 31 ordenes y 31
 * conversaciones») sin devolver identificadores al navegador.
 */
export type TraspasoMensajeroServiceResult =
  | {
      status: "ok";
      movidas: number;
      conversaciones: number;
      origen: TraspasoMensajeroExtremo;
      destino: TraspasoMensajeroExtremo;
    }
  | { status: "forbidden" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; detalle: DetalleConflicto[] };

export interface ITraspasoMensajeroService {
  /**
   * R1-R32: mueve el lote COMPLETO al mensajero destino —con sus conversaciones de chat, su rastro
   * y el recalculo de ruta de los DOS mensajeros— o no mueve ninguna orden.
   *
   * NO cambia el estado de las ordenes, ni su dia de reparto, ni su guia, ni su prioridad (R16), y
   * NO toca ninguna gestion ya registrada: `gestion_orden.mensajero_id` es EL ACTOR que la registro
   * y sigue siendo el mismo (R20), asi que el cierre del mensajero que ya trabajo esas ordenes
   * queda exactamente igual.
   *
   * Los DOS avisos (R38/R39) se emiten FUERA de la transaccion y best-effort: un aviso caido NO
   * cambia el desenlace (R41).
   */
  traspasar(
    input: TraspasarMensajeroInput,
    actor: Actor,
  ): Promise<TraspasoMensajeroServiceResult>;
}
