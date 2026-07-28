import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  ManifiestoFilaDTO,
  ManifiestoInput,
  ManifiestoOmitidaDTO,
} from "@/lib/types/manifiesto";

// Feature 148 — contrato del SERVICIO UNICO del manifiesto (R1). Logica de negocio
// pura: no conoce HTTP (`next/headers`, Request/Response) ni Prisma; el borde
// (Server Action, `lib/actions/manifiesto.ts`) lo traduce al resultado tipado
// expuesto. Ningun flujo construye filas de manifiesto por su cuenta: los 6 puntos
// de enganche pasan por `armar`.

/**
 * Resultado de dominio del servicio (sin acoplarse a HTTP). `unauthenticated` (R28)
 * y `validation_error` (R30) los maneja el borde; aqui solo `ok` (filas + omitidas)
 * o `forbidden`. Una referencia invalida NO aborta el lote (R12): se reporta en
 * `omitidas`, no como error del resultado.
 *
 * `forbidden` existe en la union (paridad con `GenerarEtiquetasServiceResult`) para
 * que el borde pueda propagarlo sin cambiar de tipo el dia que se restrinja el
 * manifiesto por rol; HOY el servicio no lo devuelve: el manifiesto es un READ
 * derivado abierto a cualquier rol autenticado, con el aislamiento por dueño
 * aplicado fila a fila para el rol `apiKey` (R29).
 */
export type ManifiestoServiceResult =
  | { status: "ok"; filas: ManifiestoFilaDTO[]; omitidas: ManifiestoOmitidaDTO[] }
  | { status: "forbidden" };

export interface IManifiestoService {
  /**
   * R1/R3-R12/R24/R29: arma las filas del manifiesto del lote seleccionado (por ids
   * de orden o por `num_remision` en la carga masiva), leyendo los datos VIGENTES de
   * cada orden (R4) y aplicando la tabla `origen`/`destino`/`responsable` del flujo
   * (design.md §4). Una fila por orden valida, en el mismo orden en que se recibieron
   * (R3); las que no existen, estan borradas o son de otra tienda cuando el actor es
   * una API key salen en `omitidas` sin abortar el lote (R12/R29).
   *
   * SOLO LECTURA (R24): no invoca ningun metodo de escritura ni modifica dato alguno
   * de negocio.
   */
  armar(input: ManifiestoInput, actor: Actor): Promise<ManifiestoServiceResult>;
}
