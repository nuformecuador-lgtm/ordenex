import { Prisma } from "@prisma/client";

import { MSG, ValidationError } from "@/lib/errors";
import type { ITarifaVigentePorTiendaRepository } from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";
import type { ICoberturaService } from "@/lib/interfaces/services/ICoberturaService";
import type { ICotizadorService } from "@/lib/interfaces/services/ICotizadorService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CoberturaBloque,
  CotizacionApiEntrada,
  CotizacionRespuesta,
  ImportesDevuelta,
  ImportesEntregada,
  ResultadoCobertura,
} from "@/lib/types/cotizador";
import { aCoberturaPublica, textoSupuesto } from "@/lib/types/cotizador";
import {
  costosListadoOrden,
  derivarIngresoOrden,
  pagoTiendaOrdenex,
} from "@/lib/utils/ingreso-ordenex";

// Feature 248 (design §3 D5/D6/D7/D8/D9/D10/D11/D15, §4.2 — R15-R33) — COTIZADOR del canal
// por API key: cobertura + tarifa de la tienda + los dos escenarios (entregada y devuelta),
// unitario y por N.
//
// ⛔ AQUI NO HAY NI UNA FORMULA MONETARIA PROPIA, Y ESA ES LA REGLA DURA DE LA FEATURE (R23).
// Todo importe sale de `lib/utils/ingreso-ordenex.ts`:
//
//   · `derivarIngresoOrden({ resultado: "entregada" }, tarifa)` -> flete, IVA del flete y
//     (solo si la orden cobra comision) comision COD + su IVA;
//   · `derivarIngresoOrden({ resultado: "devuelta" }, tarifa)`  -> flete de devolucion + IVA;
//   · `costosListadoOrden(tarifa, orden)`                       -> los DOS bloques "con IVA"
//     que factura una entrega, sumados por el MISMO util que los deriva;
//   · `pagoTiendaOrdenex(monto, fleteConIva, comisionConIva)`   -> el neto de la tienda (R19).
//
// El porque esta MEDIDO, no opinado: `ingreso-ordenex.ts:121-146` documenta que la version que
// reimplementaba estas mismas formulas en el navegador desviaba un centimo en 14 de 66 ordenes
// reales, y que en el caso del monto 16 618,40 no era binario sino OTRA formula (le faltaba un
// redondeo intermedio). Este modulo enseña dinero que la tienda comparara contra su cierre.
//
// LAS UNICAS TRES OPERACIONES QUE ESTE ARCHIVO HACE SOBRE DINERO —y las tres se construyen
// SOBRE valores YA REDONDEADOS por `ingreso-ordenex`, nunca al lado de sus formulas— son
// `sumarImportes`, `negarImporte` y `porCantidad`, documentadas una por una mas abajo. Una
// guardia estatica (`tests/unit/guards/cotizador-sin-aritmetica-propia.guardia.test.ts`) lee
// este fuente sin comentarios y falla si aparece cualquier otra.
//
// Money-safe (R29): todo importe es `Prisma.Decimal` -> STRING escala 2 con `ROUND_HALF_UP`.
// Ni un `number`, ni un `parseFloat`, ni una operacion en punto flotante — tampoco en el neto
// negativo del escenario devuelta.

/** Un concepto derivado ausente vale cero (R30/D9); presente, su STRING escala 2. */
function importe(valor: Prisma.Decimal | undefined): string {
  return valor === undefined ? "0.00" : valor.toFixed(2);
}

/**
 * Suma de DOS importes YA REDONDEADOS a 2 decimales.
 *
 * No reproduce ninguna formula: es la misma composicion que el cierre hace con los valores que
 * `derivarIngresoOrden` ya redondeo por gestion (`agregarIngresosPorConcepto`,
 * `ingreso-ordenex.ts:285-308`) y que `costosListadoOrden` hace por fila. Aqui solo cierra los
 * dos `costoTotal` de la respuesta, que son sumas de conceptos, no derivaciones.
 */
function sumarImportes(a: string, b: string): string {
  return new Prisma.Decimal(a).plus(b).toFixed(2);
}

/**
 * T5.2 / R21 / D6 — el neto del escenario DEVUELTA.
 *
 * LA NEGACION ES LO UNICO NUEVO: se niega el importe que ya devolvio
 * `derivarIngresoOrden({ resultado: "devuelta" })` (`ingreso_flete_devolucion` +
 * `ingreso_iva_flete_devolucion`, ambos YA redondeados). Ningun importe se recalcula, ninguna
 * formula se reescribe.
 *
 * ⚠ ESTE NUMERO ES DEL COTIZADOR Y NO EXISTE EN EL CIERRE. `pagoTiendaOrdenex` documenta
 * explicitamente (`ingreso-ordenex.ts:239-251`) que NO DESCUENTA EL FLETE DE DEVOLUCION: una
 * devolucion no recauda COD, asi que no aporta al total general del cierre y no se le resta a
 * lo recibido. NADIE DEBE INTENTAR CUADRARLO CONTRA UNA LINEA DE CIERRE: es una lectura del
 * cotizador ("cuanto te cuesta si vuelve"), no un asiento.
 *
 * Se descarto llamar a `pagoTiendaOrdenex("0.00", fleteDevConIva, "0.00")`: daria EL MISMO
 * NUMERO reutilizando la funcion, pero FUERA DE SU SEMANTICA DOCUMENTADA, y ataria el cotizador
 * a que esa funcion nunca cambie de criterio sobre el flete de devolucion. Por eso en esta rama
 * NO se llama a `pagoTiendaOrdenex` (hay un test que lo espia y lo exige).
 */
function negarImporte(importeRedondeado: string): string {
  return new Prisma.Decimal(importeRedondeado).neg().toFixed(2);
}

/**
 * T5.3 / R26 / D7 — el total por N es el UNITARIO YA REDONDEADO multiplicado por N.
 *
 * NO se redondea al final de una multiplicacion de valores sin redondear, y la razon es del
 * codigo: `agregarIngresosPorConcepto` (`ingreso-ordenex.ts:285-308`) suma los `Decimal` que
 * `derivarIngresoOrden` ya redondeo POR GESTION. Redondear al final daria un total que NO
 * CUADRA con lo que se factura orden por orden (medido: comision 3,50 % sobre 16 618,40 ->
 * 581,644 -> 581,64 x 3 = 1744,92, mientras que 581,644 x 3 redondeado al final da 1744,93).
 *
 * Aplica igual al neto NEGATIVO del escenario devuelta.
 */
function porCantidad(unitario: string, cantidad: number): string {
  return new Prisma.Decimal(unitario).mul(cantidad).toFixed(2);
}

/**
 * El bloque de cobertura publico de un resultado de dominio que YA no es `validation_error`.
 *
 * Se proyecta con `aCoberturaPublica` (la unica proyeccion, R7) en vez de rearmar el DTO aqui:
 * quitar campos a mano es una operacion que se olvida.
 */
function bloqueCobertura(
  resultado: Exclude<ResultadoCobertura, { estado: "validation_error" }>,
): CoberturaBloque {
  const publico = aCoberturaPublica(resultado);
  if (publico.estado === "validation_error") {
    // Inalcanzable: el tipo de entrada ya excluye ese estado y `aCoberturaPublica` es total.
    throw new Error("cobertura: estado imposible");
  }
  return publico;
}

/** `fieldErrors` del shape uniforme (un mensaje por campo) desde el resultado de cobertura. */
function aFieldErrors(campos: Record<string, string>): Record<string, string[]> {
  const salida: Record<string, string[]> = {};
  for (const [campo, mensaje] of Object.entries(campos)) salida[campo] = [mensaje];
  return salida;
}

/** R26 — el escenario entregada por N, clave a clave (los ausentes siguen ausentes, R33). */
function entregadaPorCantidad(unitario: ImportesEntregada, cantidad: number): ImportesEntregada {
  return {
    flete: porCantidad(unitario.flete, cantidad),
    ivaFlete: porCantidad(unitario.ivaFlete, cantidad),
    ...(unitario.comisionCod === undefined
      ? {}
      : { comisionCod: porCantidad(unitario.comisionCod, cantidad) }),
    ...(unitario.ivaComisionCod === undefined
      ? {}
      : { ivaComisionCod: porCantidad(unitario.ivaComisionCod, cantidad) }),
    costoTotal: porCantidad(unitario.costoTotal, cantidad),
    netoTienda: porCantidad(unitario.netoTienda, cantidad),
  };
}

/** R26 — el escenario devuelta por N, incluido el neto negativo. */
function devueltaPorCantidad(unitario: ImportesDevuelta, cantidad: number): ImportesDevuelta {
  return {
    fleteDevolucion: porCantidad(unitario.fleteDevolucion, cantidad),
    ivaFleteDevolucion: porCantidad(unitario.ivaFleteDevolucion, cantidad),
    costoTotal: porCantidad(unitario.costoTotal, cantidad),
    netoTienda: porCantidad(unitario.netoTienda, cantidad),
  };
}

export class CotizadorService implements ICotizadorService {
  constructor(
    private readonly cobertura: ICoberturaService,
    private readonly tarifas: ITarifaVigentePorTiendaRepository,
  ) {}

  async cotizar(actor: Actor, entrada: CotizacionApiEntrada): Promise<CotizacionRespuesta> {
    const resultado = await this.cobertura.consultar({
      provincia: entrada.provincia,
      canton: entrada.canton,
      distrito: entrada.distrito,
    });

    // R5/R14 — trio no resoluble: 422 por campo, SIN haber tocado `tarifas`.
    if (resultado.estado === "validation_error") {
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: aFieldErrors(resultado.campos),
      });
    }

    const cobertura = bloqueCobertura(resultado);

    // R16/D2 — 0 o >1 zonas: 200 con la cobertura y SIN bloque de costos. No se elige una zona
    // arbitraria y no se resuelve tarifa: `this.tarifas` no se llama en esta rama.
    if (resultado.estado !== "cubierto") return { cobertura, costos: null };

    // R15 — la tienda es el usuario dedicado de la API key. R31/D10 — el resolver se usa TAL
    // CUAL, sin añadir ningun filtro sobre `tarifas.status`: esa deuda es de la feature 69, con
    // test propio que exige que el `where` no lo mencione, y se declara en el contrato.
    const tarifa = await this.tarifas.resolveTarifaPorTienda(actor.usuarioId);

    // Normalizacion money-safe del monto (el borde ya garantizo el formato): escala 2 sin
    // aritmetica. Es tambien el eco que viaja en la respuesta.
    const montoCobrar = new Prisma.Decimal(entrada.monto_cobrar).toFixed(2);
    const orden = {
      // La zona SOLO elige la COLUMNA del flete (variante GAM), nunca la formula: quien lo
      // aplica es `derivarIngresoOrden`; aqui solo se le pasa `esCentral`.
      esCentral: resultado.esCentral,
      montoCobrar,
      // R33/D15 — se propaga TAL CUAL, sin interpretarlo.
      cobraComision: entrada.cobra_comision,
    };
    const cantidad = entrada.cantidad;

    // R18 — los cuatro conceptos por separado. Con `cobraComision: false`, `derivarIngresoOrden`
    // deja comision e IVA de comision AUSENTES (`ingreso-ordenex.ts:73-82`), no en "0.00".
    const entregada = derivarIngresoOrden({ resultado: "entregada", ...orden }, tarifa);
    // R20 — el mismo derivador, otro resultado: flete de devolucion y su IVA. Sin comision COD,
    // sin IVA de comision y sin monto COD a recibir (una devolucion no recauda).
    const devuelta = derivarIngresoOrden({ resultado: "devuelta", ...orden }, tarifa);
    // Los dos bloques "con IVA" que factura una entrega, sumados por el propio util.
    const bloques = costosListadoOrden(tarifa, orden);

    const unitarioEntregada: ImportesEntregada = {
      flete: importe(entregada.ingreso_flete),
      ivaFlete: importe(entregada.ingreso_iva_flete),
      // R33 — la PRESENCIA la manda el parametro; el VALOR, el derivado (cero sin tarifa, R30).
      ...(entrada.cobra_comision
        ? {
            comisionCod: importe(entregada.ingreso_comision_cod),
            ivaComisionCod: importe(entregada.ingreso_iva_comision_cod),
          }
        : {}),
      costoTotal: sumarImportes(bloques.fleteConIva, bloques.comisionConIva),
      // R19 — el neto de la tienda: lo recibido menos los DOS bloques facturados.
      netoTienda: pagoTiendaOrdenex(montoCobrar, bloques.fleteConIva, bloques.comisionConIva),
    };

    const costoTotalDevuelta = sumarImportes(
      importe(devuelta.ingreso_flete_devolucion),
      importe(devuelta.ingreso_iva_flete_devolucion),
    );
    const unitarioDevuelta: ImportesDevuelta = {
      fleteDevolucion: importe(devuelta.ingreso_flete_devolucion),
      ivaFleteDevolucion: importe(devuelta.ingreso_iva_flete_devolucion),
      costoTotal: costoTotalDevuelta,
      // R21/D6 — negativo, y ver el aviso de `negarImporte`: no existe en el cierre.
      netoTienda: negarImporte(costoTotalDevuelta),
    };

    return {
      cobertura,
      // R30/D9 — un "0.00" sin contexto se lee como "gratis"; esta marca lo desmiente.
      tarifaVigente: tarifa !== null,
      cantidad,
      montoCobrar,
      cobraComision: entrada.cobra_comision,
      // R28/D8 — el supuesto viaja EN la respuesta: sin el, un integrador multiplicaria una
      // canasta heterogenea y la comision COD (un % del monto) saldria mal.
      supuesto: textoSupuesto(cantidad),
      escenarios: {
        entregada: {
          unitario: unitarioEntregada,
          total: entregadaPorCantidad(unitarioEntregada, cantidad),
        },
        devuelta: {
          unitario: unitarioDevuelta,
          total: devueltaPorCantidad(unitarioDevuelta, cantidad),
        },
      },
    };
  }
}
