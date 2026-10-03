// Ficha 470 (design §3.4, R5/R6/R10/R11/R15) — contrato del servicio que decide el TRANSPORTE del
// resultado de una accion de descarga: en la respuesta (pequeño) o por un objeto temporal con URL
// firmada (grande). No decide permisos: solo recibe resultados que la accion ya autorizo.
import type { ResultadoPreparado } from "@/lib/types/descarga-preparada";

export interface IEntregaDescargaService {
  /**
   * Serializa `resultado`; si no supera el umbral lo devuelve tal cual (`directo`, cero llamadas al
   * almacen); si lo supera lo comprime, lo guarda y devuelve la URL firmada (`almacen`). Los fallos
   * del almacen se PROPAGAN (R15).
   */
  entregar<R>(resultado: R): Promise<ResultadoPreparado<R>>;
}
