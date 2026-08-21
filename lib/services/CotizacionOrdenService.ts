// Feature 255 — Cotizacion por API key: precio y cobertura ANTES de crear la orden.
//
// Toma la MISMA entrada que la carga por API key, no persiste nada y devuelve, por cada
// fila, su cobertura y cuanto cuesta en los DOS escenarios posibles (entregado y devuelto),
// mas un bloque de totales del LOTE (decision D2).
//
// Logica de negocio pura: sin HTTP, sin `next/*`, sin Prisma directo. La aritmetica de dinero
// va con `Prisma.Decimal` de punta a punta y el formateo es el ULTIMO paso (R33/R55).
import { Prisma } from "@prisma/client";
import { z } from "zod";

import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CantonRow,
  DistritoRow,
  ProvinciaRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type {
  ITarifaVigentePorTiendaRepository,
  TarifaVigente,
} from "@/lib/interfaces/repositories/ITarifaVigentePorTiendaRepository";
import type {
  CotizacionGeoRepository,
  CotizacionOrdenResult,
  ICotizacionOrdenService,
} from "@/lib/interfaces/services/ICotizacionOrdenService";
import type { RawRow } from "@/lib/parsers/spreadsheet";
import {
  distinct,
  geoInputDesdeColumnasSeparadas,
  indexBy,
  normalize,
  resolveGeo,
} from "@/lib/services/geo-resolucion";
import {
  filaCotizacionSchema,
  type CostosDevuelto,
  type CostosEntregado,
  type FilaCotizacionResultado,
} from "@/lib/types/cotizacion";
import { derivarIngresoOrden } from "@/lib/utils/ingreso-ordenex";
import { formatMontoCotizacion } from "@/lib/utils/monto-cotizacion";

/**
 * R29 — la cotizacion asume que la orden que se crearia COBRA comision, que es el `default
 * true` de la columna `orden.cobra_comision`. El supuesto se declara en la descripcion
 * OpenAPI del endpoint y no como campo del cuerpo: el sitio donde un integrador busca los
 * supuestos de un precio es la documentacion del contrato.
 */
const COBRA_COMISION = true;

/** El resolver de tarifa que consume la cotizacion, y SOLO ese metodo (design.md §4). */
type CotizacionTarifaRepository = Pick<
  ITarifaVigentePorTiendaRepository,
  "resolveTarifaCotizablePorTienda"
>;

interface IndicesGeograficos {
  provinciaIndex: Map<string, ProvinciaRow[]>;
  cantonIndex: Map<string, CantonRow[]>;
  distritoIndex: Map<string, DistritoRow[]>;
}

/** Los cinco conceptos del escenario ENTREGADO, todavia como decimales exactos (R55). */
interface MontosEntregado {
  flete: Prisma.Decimal;
  iva: Prisma.Decimal;
  comision: Prisma.Decimal;
  ivaComision: Prisma.Decimal;
  total: Prisma.Decimal;
}

/** Los cuatro conceptos del escenario DEVUELTO (sin `ivaComision`, R27). */
interface MontosDevuelto {
  flete: Prisma.Decimal;
  iva: Prisma.Decimal;
  comision: Prisma.Decimal;
  total: Prisma.Decimal;
}

function cero(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}

function acumuladorEntregado(): MontosEntregado {
  return { flete: cero(), iva: cero(), comision: cero(), ivaComision: cero(), total: cero() };
}

function acumuladorDevuelto(): MontosDevuelto {
  return { flete: cero(), iva: cero(), comision: cero(), total: cero() };
}

function formatearEntregado(montos: MontosEntregado): CostosEntregado {
  return {
    flete: formatMontoCotizacion(montos.flete),
    iva: formatMontoCotizacion(montos.iva),
    comision: formatMontoCotizacion(montos.comision),
    ivaComision: formatMontoCotizacion(montos.ivaComision),
    total: formatMontoCotizacion(montos.total),
  };
}

function formatearDevuelto(montos: MontosDevuelto): CostosDevuelto {
  return {
    flete: formatMontoCotizacion(montos.flete),
    iva: formatMontoCotizacion(montos.iva),
    // R28: el cero EXPLICITO. Una devolucion no cobra comision COD porque no hubo recaudo;
    // el campo AFIRMA ese cero y nunca falta ni vale `null`.
    comision: formatMontoCotizacion(montos.comision),
    total: formatMontoCotizacion(montos.total),
  };
}

export class CotizacionOrdenService implements ICotizacionOrdenService {
  constructor(
    private readonly repo: CotizacionGeoRepository,
    private readonly tarifaRepo: CotizacionTarifaRepository,
  ) {}

  async cotizar(rows: RawRow[], actor: Actor): Promise<CotizacionOrdenResult> {
    // R14 (paso 1): SOLO el rol `apiKey` (el usuario dedicado de la key), igual que
    // `cargarViaApi`. Sin leer tarifa ni geografia para ningun otro rol.
    if (actor.rol !== "apiKey") return { status: "forbidden" };

    // R4: el dueño de la cotizacion sale SIEMPRE del actor de la key; ningun identificador
    // del cuerpo o de la query participa.
    const tiendaId = actor.usuarioId;

    // R11/R14 (paso 2): UNA sola resolucion de tarifa por peticion, nunca una por fila, y
    // ANTES de precargar la geografia. Sin tarifa cotizable se termina aqui: ni una lectura
    // geografica, ni un solo importe emitido (R13/R15). Esa es la inversion deliberada del
    // gap D1/R8 de la feature 98 — en una carga el cero es tolerable, en una cotizacion es
    // una mentira sobre dinero servida como precio.
    const tarifa = await this.tarifaRepo.resolveTarifaCotizablePorTienda(tiendaId);
    if (tarifa === null) return { status: "sin_tarifa" };

    // R14 (paso 3): precarga geografica, una vez por lote.
    const indices = await this.precargarGeografia();

    const filas: FilaCotizacionResultado[] = [];
    // R55/A7: acumuladores en decimales EXACTOS, alimentados con los valores de cada fila
    // ANTES de formatear. El bloque del lote se formatea UNA sola vez, al final.
    const accEntregado = acumuladorEntregado();
    const accDevuelto = acumuladorDevuelto();
    let filasSumadas = 0;

    rows.forEach((raw, idx) => {
      // R46: indice 1-based dentro del array recibido.
      const fila = this.cotizarFila(raw, idx + 1, indices, tarifa);
      filas.push(fila.resultado);
      // R53: SOLO las filas cotizadas aportan al lote. Una fila sin cobertura no tiene
      // precio, asi que no puede aportar ni un cero: aportarlo la haria indistinguible de
      // una fila gratis.
      if (fila.montos === null) return;
      filasSumadas += 1;
      sumarEntregado(accEntregado, fila.montos.entregado);
      sumarDevuelto(accDevuelto, fila.montos.devuelto);
    });

    const total = rows.length;
    return {
      status: "ok",
      resumen: {
        total,
        cotizadas: filasSumadas,
        conError: total - filasSumadas,
        // R54/R56: los dos contadores SIEMPRE presentes, su suma siempre igual al total, y
        // el bloque emitido tambien cuando ninguna fila cotiza (entonces, todo en cero).
        totales: {
          filasSumadas,
          filasExcluidas: total - filasSumadas,
          entregado: formatearEntregado(accEntregado),
          devuelto: formatearDevuelto(accDevuelto),
        },
        filas,
      },
    };
  }

  /**
   * Una fila: validacion propia -> cobertura -> los dos escenarios. Devuelve el resultado
   * publicable Y —solo si cotizo— sus montos en decimales exactos, para que el lote sume
   * sobre ellos y no sobre los strings ya formateados (R55).
   */
  private cotizarFila(
    raw: RawRow,
    fila: number,
    indices: IndicesGeograficos,
    tarifa: TarifaVigente,
  ): {
    resultado: FilaCotizacionResultado;
    montos: { entregado: MontosEntregado; devuelto: MontosDevuelto } | null;
  } {
    // R9/R10: dato de CORRELACION, tal cual si viene y `null` si no. No se deduplica contra
    // la base ni contra el propio lote: sin persistencia, "duplicada" no significaria nada.
    const numRemisionCrudo = (raw.num_remision ?? "").trim();
    const numRemision = numRemisionCrudo === "" ? null : numRemisionCrudo;

    const parsed = filaCotizacionSchema.safeParse(raw);
    if (!parsed.success) {
      // R21: una fila invalida se marca como error en SU resultado y no tumba el lote.
      const errores = z.flattenError(parsed.error).fieldErrors as Record<string, string[]>;
      return { resultado: { fila, numRemision, resultado: "error", errores }, montos: null };
    }

    const geoInput = geoInputDesdeColumnasSeparadas(raw);
    const geoResult = geoInput.ok
      ? resolveGeo(geoInput, indices.provinciaIndex, indices.cantonIndex, indices.distritoIndex)
      : { ok: false as const, fieldErrors: geoInput.fieldErrors };

    if (!geoResult.ok) {
      // R18/R19/R20: los tres mensajes de no-cobertura salen del MISMO `resolveGeo` que usa
      // la carga (design.md §5.1), no de una copia. R22: una fila en error NO trae costos.
      return {
        resultado: { fila, numRemision, resultado: "error", errores: geoResult.fieldErrors },
        montos: null,
      };
    }

    // R25: la columna de flete la elige el `esCentral` de la zona DEL DISTRITO DE ESTA FILA,
    // que llega en el MISMO paso que la cobertura. No hay dos pasadas ni un atributo del lote.
    const montos = calcularEscenarios(geoResult.geo.esCentral, parsed.data.monto_cobrar, tarifa);
    return {
      resultado: {
        fila,
        numRemision,
        resultado: "cotizada",
        costos: {
          entregado: formatearEntregado(montos.entregado),
          devuelto: formatearDevuelto(montos.devuelto),
        },
      },
      montos,
    };
  }

  /**
   * Las TRES lecturas geograficas del lote, con los indices que `resolveGeo` espera. Espeja
   * `BulkOrdenService.precargar` MENOS lo que la cotizacion no hace: no lee remisiones
   * existentes (no deduplica, R10) ni el estatus inicial (no persiste, R43).
   */
  private async precargarGeografia(): Promise<IndicesGeograficos> {
    const provincias = await this.repo.findAllProvincias();
    const provinciaIndex = indexBy(provincias, (p) => normalize(p.nombre));

    const cantones = await this.repo.findCantonesByProvinciaIds(
      distinct(provincias.map((p) => p.id)),
    );
    const cantonIndex = indexBy(cantones, (c) => `${c.provinciaId}::${normalize(c.nombre)}`);

    const distritos = await this.repo.findDistritosByCantonIds(distinct(cantones.map((c) => c.id)));
    const distritoIndex = indexBy(distritos, (d) => `${d.cantonId}::${normalize(d.nombre)}`);

    return { provinciaIndex, cantonIndex, distritoIndex };
  }
}

/**
 * Los DOS escenarios de una fila cubierta (R23/R24), con DOS llamadas a la derivacion de
 * ingreso ya existente y CERO formulas propias de flete, IVA o comision.
 *
 * El precedente esta medido: en la feature 204 el navegador recalculaba flete e IVA por su
 * cuenta y 14 de 66 ordenes salian con un centimo de diferencia contra el cierre, por dos
 * causas distintas (el binario y un redondeo intermedio ausente). Los unicos calculos propios
 * de esta feature son las dos sumas/restas de `total` (R30/R31), y van con `Prisma.Decimal`.
 *
 * La rama `tarifa === null` de `derivarIngresoOrden` (la que devolveria todos los conceptos
 * ausentes, es decir el cero mudo) es INALCANZABLE desde aqui: `cotizar` ya corto con
 * `sin_tarifa` antes de llegar (R15).
 */
function calcularEscenarios(
  esCentral: boolean,
  montoCobrar: string | null,
  tarifa: TarifaVigente,
): { entregado: MontosEntregado; devuelto: MontosDevuelto } {
  const input = { esCentral, montoCobrar, cobraComision: COBRA_COMISION };

  const entregada = derivarIngresoOrden({ ...input, resultado: "entregada" }, tarifa);
  const devuelta = derivarIngresoOrden({ ...input, resultado: "devuelta" }, tarifa);

  const flete = entregada.ingreso_flete ?? cero();
  const iva = entregada.ingreso_iva_flete ?? cero();
  const comision = entregada.ingreso_comision_cod ?? cero();
  const ivaComision = entregada.ingreso_iva_comision_cod ?? cero();

  const fleteDevolucion = devuelta.ingreso_flete_devolucion ?? cero();
  const ivaDevolucion = devuelta.ingreso_iva_flete_devolucion ?? cero();

  return {
    entregado: {
      flete,
      iva,
      comision,
      ivaComision,
      // R30/D1: lo que RECIBE la tienda = monto a cobrar menos los cuatro conceptos
      // facturados. R32: sin monto a cobrar la base es cero y el total sale NEGATIVO.
      total: new Prisma.Decimal(montoCobrar ?? 0)
        .minus(flete)
        .minus(iva)
        .minus(comision)
        .minus(ivaComision),
    },
    devuelto: {
      flete: fleteDevolucion,
      iva: ivaDevolucion,
      // R28: el cero de la comision se AFIRMA aqui. `derivarIngresoOrden` no emite comision
      // para una devolucion (no hubo recaudo), y esa ausencia se publica como cero explicito.
      comision: devuelta.ingreso_comision_cod ?? cero(),
      // R31/D1: la DEUDA de la tienda = el negativo de (flete + IVA) de la devolucion.
      total: fleteDevolucion.plus(ivaDevolucion).negated(),
    },
  };
}

function sumarEntregado(acc: MontosEntregado, fila: MontosEntregado): void {
  acc.flete = acc.flete.plus(fila.flete);
  acc.iva = acc.iva.plus(fila.iva);
  acc.comision = acc.comision.plus(fila.comision);
  acc.ivaComision = acc.ivaComision.plus(fila.ivaComision);
  acc.total = acc.total.plus(fila.total);
}

function sumarDevuelto(acc: MontosDevuelto, fila: MontosDevuelto): void {
  acc.flete = acc.flete.plus(fila.flete);
  acc.iva = acc.iva.plus(fila.iva);
  acc.comision = acc.comision.plus(fila.comision);
  acc.total = acc.total.plus(fila.total);
}
