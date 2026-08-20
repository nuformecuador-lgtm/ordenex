import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { CotizacionApiEntrada, CotizacionRespuesta } from "@/lib/types/cotizador";

// Feature 248 (design §1/§4.2, bloque C) — contrato del COTIZADOR del canal por API key.
//
// Es el unico modulo de la feature que ve dinero, y lo ve COMPONIENDO, no calculando:
//
//   · `ICoberturaService`                  -> que zona cubre el distrito (y su `esCentral`);
//   · `ITarifaVigentePorTiendaRepository`  -> la tarifa vigente de la tienda de la API key;
//   · `lib/utils/ingreso-ordenex.ts`       -> TODA la aritmetica (R23/D5).
//
// ⛔ NI UNA FORMULA MONETARIA PROPIA. `lib/utils/ingreso-ordenex.ts:121-146` documenta con
// casos MEDIDOS que reimplementar esas mismas formulas desviaba un centimo en 14 de 66 ordenes
// reales, y que en el caso del monto 16 618,40 no era un problema de binario sino OTRA formula
// (faltaba un redondeo intermedio). El cotizador enseña dinero que la tienda comparara contra
// su cierre: si divergiera un centimo, la misma plata se leeria distinta segun donde se mire.
// Una guardia estatica (`tests/unit/guards/cotizador-sin-aritmetica-propia.guardia.test.ts`)
// mide esa propiedad sobre el fuente.

export interface ICotizadorService {
  /**
   * Cotiza N ordenes que comparten distrito y monto COD (R28: el supuesto viaja EN la
   * respuesta) para la tienda del actor.
   *
   * `actor` es SIEMPRE el usuario dedicado de la API key: la tienda de la cotizacion es
   * `actor.usuarioId` y NO se lee ningun identificador de tienda del cuerpo (R15). El schema
   * del borde ni siquiera declara una clave asi, de modo que la ausencia es por construccion.
   *
   * Resultado:
   *  - cobertura con EXACTAMENTE una zona -> `CotizacionConCostos` (los dos escenarios,
   *    unitario y total);
   *  - 0 o >1 zonas -> `CotizacionSinCostos` (`costos: null`) **sin tocar `tarifas`** (R16);
   *  - trio geografico no resoluble -> lanza `ValidationError` con `fieldErrors` -> 422 (R14),
   *    igualmente sin tocar `tarifas` (R5).
   *
   * La tienda sin tarifa vigente NO es un error: 200 con `tarifaVigente: false` y los
   * conceptos en `"0.00"` (R30/D9), heredando tal cual el gap de la feature 42.
   */
  cotizar(actor: Actor, entrada: CotizacionApiEntrada): Promise<CotizacionRespuesta>;
}
