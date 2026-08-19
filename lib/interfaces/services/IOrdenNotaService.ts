import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  BorrarNotaInput,
  BorrarNotaServiceResult,
  ListarNotasInput,
  ListarNotasServiceResult,
  PublicarNotaInput,
  PublicarNotaServiceResult,
} from "@/lib/types/orden-nota";

// Feature 227 (T2.1, design §2.2) — contrato del servicio del HILO de notas por orden. Logica de
// negocio pura: no conoce HTTP, ni Next, ni Prisma; se construye con un doble del repositorio.
//
// Las TRES operaciones comparten EXACTAMENTE la misma secuencia de comprobaciones:
//   1. `actor.rol` ∈ { adminTienda, mensajero }        -> si no, `forbidden` (R12)
//   2. cargar la orden; inexistente o borrada          -> `forbidden` (R10: no se filtra existencia)
//   3. pertenencia (tienda propia / asignacion)        -> `forbidden` (R9/R11)
//   4. ventana de escritura ASIMETRICA por rol         -> SOLO en `publicar` y `borrar` (R14/R35)
//   5. ejecutar y proyectar
//
// El paso 4 es el que mas facil se implementa mal: `listar` NO lo aplica (R15, leer siempre) y la
// ventana de cada rol es distinta (`devuelta` para la tienda, `en_reparto` para el mensajero,
// decision D1). La tabla unica vive en `lib/types/ventana-hilo-notas.ts`.
export interface IOrdenNotaService {
  /**
   * R15/R19/R28/R34: el hilo COMPLETO de la orden, en cualquier estatus, con las borradas
   * marcadas y sin su cuerpo, mas `puedeEscribir` = «el actor esta dentro de SU ventana».
   * Una sola lectura del hilo (nunca una consulta por nota).
   */
  listar(input: ListarNotasInput, actor: Actor): Promise<ListarNotasServiceResult>;

  /**
   * R1/R5/R6/R14: crea una nota NUEVA sin tocar ninguna previa. El autor y el rol salen SIEMPRE
   * del actor, nunca del input. Rechaza con `validation_error` el cuerpo que queda vacio al
   * recortar (R6) y con `forbidden` todo lo que caiga fuera de la ventana del rol (R14).
   */
  publicar(input: PublicarNotaInput, actor: Actor): Promise<PublicarNotaServiceResult>;

  /**
   * R31/R32/R33/R35: borrado LOGICO de una nota PROPIA, y solo dentro de la ventana del rol
   * (fuera de ella las notas quedan congeladas, tambien las propias). Nota inexistente, ajena,
   * de otra orden o ya borrada devuelven el MISMO `forbidden`, sin revelar cual es el caso.
   */
  borrar(input: BorrarNotaInput, actor: Actor): Promise<BorrarNotaServiceResult>;
}
