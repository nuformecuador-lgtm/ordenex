import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { DetalleConflicto } from "@/lib/interfaces/services/IGuiaAsignacionService";
import type { DiaReparto } from "@/lib/types/dia-reparto";

// Feature 262 (design §3/§4) — contrato del servicio que CORRIGE el dia de reparto de un lote de
// ordenes YA ASIGNADAS.
//
// POR QUE UN SERVICIO PROPIO Y NO UN METODO MAS DE `GuiaAsignacionService` (design §3). El mismo
// argumento que el repo ya escribio para `DeshacerAsignacionService` (149, design §7-C), y aqui es
// aun mas directo: `asignarDesdeBodega` es SOLO acceso total y SOLO zona GAM, y
// `AsignacionSateliteService` es SOLO `adminSatelite` y SOLO su zona. La correccion cruza las dos
// (D1), asi que meterla en cualquiera de ellos obligaria a abrir su autorizacion con un `if` — y
// los dos son servicios que deciden a quien se le asigna trabajo.
//
// Logica de negocio PURA: sin HTTP, sin Prisma, sin `next/`. El borde (Server Action,
// `lib/actions/corregir-dia-reparto.ts`) resuelve la sesion, valida con zod y traduce el resultado.
// `DetalleConflicto` se REUTILIZA de `IGuiaAsignacionService`: es el mismo contrato por-orden que
// ya consumen las acciones por lote de los dos listados.

/**
 * Un lote: N ordenes, UN dia elegido y UN motivo comun.
 *
 * `dia` es el TOKEN de la 246 (`"hoy" | "manana"`), NO una fecha. Es la decision D3 y no es
 * higiene: con dos opciones que significan «el dia en curso» y «el siguiente», MOVER AL PASADO NO
 * ES EXPRESABLE. R3 no depende de ningun `if` que alguien pueda relajar «para un caso puntual»:
 * depende del contrato, y cambiarlo se veria en el diff. El `motivo` llega ya recortado por el
 * borde (R21).
 */
export interface CorregirDiaRepartoInput {
  ordenIds: string[];
  dia: DiaReparto;
  motivo: string;
}

/** Lo que quedo corregido, para que la pantalla pueda decir PARA QUE DIA quedo el lote (R10). */
export interface CorregirDiaRepartoResultado {
  /** Cuantas ordenes quedaron corregidas. Por el todo-o-nada, o son todas o es un `conflict`. */
  corregidas: number;
  /** El token que se aplico: la pantalla lo pasa a `confirmacionDiaReparto` (R10/R18). */
  dia: DiaReparto;
}

/**
 * Mismo patron de resultado que `IDeshacerAsignacionService` —que la UI de los dos listados ya sabe
 * pintar—:
 *   - `forbidden`        rol no autorizado (R11/R15) o zona ajena para el `adminSatelite` (R12);
 *   - `sin_zona`         `adminSatelite` sin zona asignada (R12);
 *   - `validation_error` guardas de configuracion (catalogo de estados incompleto);
 *   - `conflict`         rechazo POR ORDEN con motivo tipado (R5-R7, R9), todo-o-nada (R8).
 */
export type CorregirDiaRepartoServiceResult =
  | ({ status: "ok" } & CorregirDiaRepartoResultado)
  | { status: "forbidden" }
  | { status: "sin_zona" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "conflict"; detalle: DetalleConflicto[] };

export interface ICorreccionDiaRepartoService {
  /**
   * R1-R15: fija el dia de reparto del lote COMPLETO o de ninguna orden, sin cambiar el estado, el
   * mensajero, la guia ni el instante de asignacion.
   *
   * `now` es un PARAMETRO INYECTABLE con default: «hoy» y «mañana» solo se pueden probar moviendo
   * el reloj, y este servicio lo lee UNA vez para todo el lote (`resolverFechaReparto`). Si lo
   * leyera el repositorio, dos capas de la misma peticion podrian caer a distinto lado de la
   * medianoche.
   *
   * Un cierre de dia pendiente del mensajero NO bloquea esta operacion (R14): es la regla 2 de la
   * 241, firmada el 2026-08-20, y el mismo criterio con el que la 149 cerro su Q1.
   */
  corregir(
    input: CorregirDiaRepartoInput,
    actor: Actor,
    now?: Date,
  ): Promise<CorregirDiaRepartoServiceResult>;
}
