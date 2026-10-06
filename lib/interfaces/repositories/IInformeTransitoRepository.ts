// Ficha 475 (design §4) — lectura del informe de transito. SOLO LECTURA: ningun metodo escribe
// (R39). Tres consultas fijas por generacion, sin N+1 (R40).
import type {
  ConsultaTransito,
  FilaTransito,
  ZonaInforme,
} from "@/lib/whatsapp-envios/informes/transito/tipos";

export interface IInformeTransitoRepository {
  /** Todas las zonas (id, nombre, es_central), ordenadas por nombre. */
  zonas(): Promise<ZonaInforme[]>;
  /** Solo las ordenes EN ALERTA: el filtro de dias va en el `WHERE` (corte por zona). */
  filasEnAlerta(consulta: ConsultaTransito): Promise<FilaTransito[]>;
  /** Ordenes vivas en un estado incluido, de una zona de `cortes`, SIN el hito elegido (R14). */
  contarSinHito(consulta: ConsultaTransito): Promise<number>;
}
