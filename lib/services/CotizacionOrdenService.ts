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
  ITarifaVigenteRepository,
  TarifaVigenteResuelta,
} from "@/lib/interfaces/repositories/ITarifaVigenteRepository";
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
  type ResolvedGeo,
} from "@/lib/services/geo-resolucion";
import { MSG_FILA_SIN_TARIFA } from "@/lib/services/mensajes-tarifa";
import { clavePar, type ParTarifa } from "@/lib/utils/cascada-tarifa";
import {
  filaCotizacionSchema,
  type CostosDevuelto,
  type CostosEntregado,
  type FilaCotizacionResultado,
} from "@/lib/types/cotizacion";
import { derivarIngresoOrden, montoFulfillmentDeTarifa } from "@/lib/utils/ingreso-ordenex";
import { formatMontoCotizacion } from "@/lib/utils/monto-cotizacion";

/**
 * R29 — la cotizacion asume que la orden que se crearia COBRA comision, que es el `default
 * true` de la columna `orden.cobra_comision`. El supuesto se declara en la descripcion
 * OpenAPI del endpoint y no como campo del cuerpo: el sitio donde un integrador busca los
 * supuestos de un precio es la documentacion del contrato.
 */
const COBRA_COMISION = true;

/**
 * El resolver de tarifa que consume la cotizacion, y SOLO ese metodo (design.md §4.4).
 *
 * Feature 274/R37: `resolveTarifaCotizablePorTienda` ya no existe. Lo unico que lo separaba
 * del resolver de liquidacion era el filtro `status = 'activo'`, y esta feature soltó esa
 * columna: dos resolvers eran dos reglas que podian divergir. La cotizacion resuelve ahora con
 * el MISMO metodo batch que el cierre de dia, `resolveTarifas`, y por la misma cascada.
 */
type CotizacionTarifaRepository = Pick<ITarifaVigenteRepository, "resolveTarifas">;

/**
 * FULFILLMENT (2026-08-25) — la cotizacion resuelve por el batch, y el batch devuelve
 * `TarifaVigenteResuelta`, que ademas de los campos de la formula trae el monto FIJO de
 * fulfillment. Ese monto NO entra en `derivarIngresoOrden` (sigue fuera de la liquidacion,
 * ver `lib/utils/ingreso-ordenex.ts`): se suma APARTE, como sexto concepto del precio que se
 * publica, y es tambien el predicado de "esta tienda hace fulfillment".
 */
type TarifaCotizada = TarifaVigenteResuelta;

/**
 * Feature 274 (design §4.4) — el resultado de la PRIMERA pasada sobre una fila. La cotizacion
 * pasa a ser de dos pasadas porque la tarifa ya no es un atributo del lote: para pedirla hace
 * falta la zona, y la zona sale de la geografia de CADA fila.
 *
 * `"error"` es una fila que no llega siquiera a pedir tarifa (no valida o no tiene cobertura);
 * `"pendiente"` es una fila que SI llega a la resolucion de tarifa — el denominador `C` del
 * criterio de lote de design §3.6.
 */
type FilaPreparada =
  | { estado: "error"; resultado: FilaCotizacionResultado }
  | {
      estado: "pendiente";
      fila: number;
      numRemision: string | null;
      geo: ResolvedGeo;
      montoCobrar: string | null;
    };

/** La fila que SI llego a la resolucion de tarifa (un elemento de `C`, design §3.6). */
type FilaPendiente = Extract<FilaPreparada, { estado: "pendiente" }>;

/**
 * Los pares (tienda, zona) DISTINTOS del lote, en orden de primera aparicion. Distintos porque
 * la consulta es una sola y un lote de 200 filas de la misma zona no tiene por que pedir 200
 * veces el mismo par (R32/R7).
 */
function paresDistintos(tiendaId: string, pendientes: readonly FilaPendiente[]): ParTarifa[] {
  const vistos = new Set<string>();
  const pares: ParTarifa[] = [];
  for (const pendiente of pendientes) {
    const par: ParTarifa = { tiendaId, zonaId: pendiente.geo.zonaId };
    const clave = clavePar(par);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    pares.push(par);
  }
  return pares;
}

interface IndicesGeograficos {
  provinciaIndex: Map<string, ProvinciaRow[]>;
  cantonIndex: Map<string, CantonRow[]>;
  distritoIndex: Map<string, DistritoRow[]>;
}

/** Los seis conceptos del escenario ENTREGADO, todavia como decimales exactos (R55). */
interface MontosEntregado {
  flete: Prisma.Decimal;
  iva: Prisma.Decimal;
  comision: Prisma.Decimal;
  ivaComision: Prisma.Decimal;
  fulfillment: Prisma.Decimal;
  total: Prisma.Decimal;
}

/** Los cinco conceptos del escenario DEVUELTO (sin `ivaComision`, R27). */
interface MontosDevuelto {
  flete: Prisma.Decimal;
  iva: Prisma.Decimal;
  comision: Prisma.Decimal;
  fulfillment: Prisma.Decimal;
  total: Prisma.Decimal;
}

function cero(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}

function acumuladorEntregado(): MontosEntregado {
  return {
    flete: cero(),
    iva: cero(),
    comision: cero(),
    ivaComision: cero(),
    fulfillment: cero(),
    total: cero(),
  };
}

function acumuladorDevuelto(): MontosDevuelto {
  return { flete: cero(), iva: cero(), comision: cero(), fulfillment: cero(), total: cero() };
}

function formatearEntregado(montos: MontosEntregado): CostosEntregado {
  return {
    flete: formatMontoCotizacion(montos.flete),
    iva: formatMontoCotizacion(montos.iva),
    comision: formatMontoCotizacion(montos.comision),
    ivaComision: formatMontoCotizacion(montos.ivaComision),
    // El monto fijo de bodega. Cero explicito cuando la tienda no hace fulfillment: el
    // integrador lee un cero, no un campo que a veces esta y a veces no.
    fulfillment: formatMontoCotizacion(montos.fulfillment),
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
    // El fulfillment SI se cobra en la devolucion: el servicio de bodega ya se presto.
    fulfillment: formatMontoCotizacion(montos.fulfillment),
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
    // Feature 302: `actor.usuarioId` es el DUEÑO resuelto por `ApiKeyAuthService` — la tienda
    // real si la key apunta a una. Es lo que hace que la cotizacion salga con LA tarifa de esa
    // tienda y no con la de una cuenta recien creada que no tiene ninguna.
    const tiendaId = actor.usuarioId;

    // Feature 274/R32 (design §4.4) — EL ORDEN SE INVIRTIO. Hasta la 273 la tarifa se resolvia
    // ANTES que la geografia, y se podia: era una sola tarifa por tienda, asi que no necesitaba
    // saber a donde iba el paquete. Ahora la tarifa depende del par (tienda, zona) y la zona es
    // la del distrito de CADA fila, asi que la geografia va primero por necesidad.
    //
    // Paso 1: precarga geografica, una vez por lote (no cambia).
    const indices = await this.precargarGeografia();

    // Paso 2: validacion + cobertura de cada fila. Las que la superan quedan `pendiente`: son
    // el denominador `C` del criterio de lote (design §3.6).
    // R46: indice 1-based dentro del array recibido.
    const preparadas = rows.map((raw, idx) => this.prepararFila(raw, idx + 1, indices));
    const pendientes = preparadas.filter(
      (p): p is FilaPendiente => p.estado === "pendiente",
    );

    // Paso 3: UNA sola consulta de tarifas por peticion, con los pares DISTINTOS (R32/R7).
    // Con `C` vacio no se consulta nada: no hay ni un par que pedir.
    const pares = paresDistintos(tiendaId, pendientes);
    const tarifas =
      pares.length === 0
        ? new Map<string, TarifaCotizada | null>()
        : await this.tarifaRepo.resolveTarifas(pares);
    const tarifaDe = (geo: ResolvedGeo): TarifaCotizada | null =>
      tarifas.get(clavePar({ tiendaId, zonaId: geo.zonaId })) ?? null;

    // R35 (design §3.6): el `409` sobrevive SOLO cuando alguna fila llego a resolver y NINGUNA
    // resolvio. Se comprueba ANTES de calcular un solo importe, para que esa respuesta siga sin
    // emitir ni un numero.
    //
    // R36: `C` vacio NO es este caso. Un lote entero sin cobertura geografica no tiene nada que
    // ver con la tarifa, y un `409` ahi le daria al integrador un diagnostico falso: le diria
    // que su cuenta no puede cotizar cuando lo que fallaron fueron sus direcciones.
    const resuelven = pendientes.filter((p) => tarifaDe(p.geo) !== null).length;
    // El `status` conserva su nombre y su traduccion a `409` en el borde (`route.ts` no cambia
    // una linea), pero su significado se ESTRECHA: ya no es "la tienda no tiene tarifa" sino
    // "ninguna fila de este lote resolvio tarifa".
    if (pendientes.length > 0 && resuelven === 0) return { status: "sin_tarifa" };

    const filas: FilaCotizacionResultado[] = [];
    // R55/A7: acumuladores en decimales EXACTOS, alimentados con los valores de cada fila
    // ANTES de formatear. El bloque del lote se formatea UNA sola vez, al final.
    const accEntregado = acumuladorEntregado();
    const accDevuelto = acumuladorDevuelto();
    let filasSumadas = 0;

    // Paso 4: los escenarios de cada fila, con SU tarifa.
    for (const preparada of preparadas) {
      if (preparada.estado === "error") {
        filas.push(preparada.resultado);
        continue;
      }

      const tarifa = tarifaDe(preparada.geo);
      if (tarifa === null) {
        // R34/R38: la fila se degrada por el MISMO camino que una fila sin cobertura —
        // `resultado: "error"` con el canal de errores por campo que ya existe, sin bloque
        // `costos`— y cuenta en `conError` y en `totales.filasExcluidas`. Ni un `0,00`: un
        // cero aqui seria indistinguible de un envio gratis.
        filas.push({
          fila: preparada.fila,
          numRemision: preparada.numRemision,
          resultado: "error",
          errores: { tarifa: [MSG_FILA_SIN_TARIFA] },
        });
        continue;
      }

      // R25: la columna de flete la elige el `esCentral` de la zona DEL DISTRITO DE ESTA FILA
      // —y desde 2026-08-25, si ese distrito esta marcado como zona especial, manda el monto
      // pactado de la tarifa por encima de la columna—.
      const montos = calcularEscenarios(
        { esCentral: preparada.geo.esCentral, esZonaEspecial: preparada.geo.esZonaEspecial },
        preparada.montoCobrar,
        tarifa,
      );
      filas.push({
        fila: preparada.fila,
        numRemision: preparada.numRemision,
        resultado: "cotizada",
        costos: {
          entregado: formatearEntregado(montos.entregado),
          devuelto: formatearDevuelto(montos.devuelto),
        },
      });

      // R53: SOLO las filas cotizadas aportan al lote. Una fila sin cobertura —o sin tarifa—
      // no tiene precio, asi que no puede aportar ni un cero: aportarlo la haria
      // indistinguible de una fila gratis.
      filasSumadas += 1;
      sumarEntregado(accEntregado, montos.entregado);
      sumarDevuelto(accDevuelto, montos.devuelto);
    }

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
   * PRIMERA pasada de una fila: validacion propia -> cobertura. No calcula ni un importe:
   * cuando esta pasada termina todavia no se sabe que tarifa le toca, porque la tarifa se pide
   * en lote con la zona que esta misma pasada acaba de resolver (feature 274/R32).
   */
  private prepararFila(
    raw: RawRow,
    fila: number,
    indices: IndicesGeograficos,
  ): FilaPreparada {
    // R9/R10: dato de CORRELACION, tal cual si viene y `null` si no. No se deduplica contra
    // la base ni contra el propio lote: sin persistencia, "duplicada" no significaria nada.
    const numRemisionCrudo = (raw.num_remision ?? "").trim();
    const numRemision = numRemisionCrudo === "" ? null : numRemisionCrudo;

    const parsed = filaCotizacionSchema.safeParse(raw);
    if (!parsed.success) {
      // R21: una fila invalida se marca como error en SU resultado y no tumba el lote.
      const errores = z.flattenError(parsed.error).fieldErrors as Record<string, string[]>;
      return {
        estado: "error",
        resultado: { fila, numRemision, resultado: "error", errores },
      };
    }

    const geoInput = geoInputDesdeColumnasSeparadas(raw);
    const geoResult = geoInput.ok
      ? resolveGeo(geoInput, indices.provinciaIndex, indices.cantonIndex, indices.distritoIndex)
      : { ok: false as const, fieldErrors: geoInput.fieldErrors };

    if (!geoResult.ok) {
      // R18/R19/R20: los tres mensajes de no-cobertura salen del MISMO `resolveGeo` que usa
      // la carga (design.md §5.1), no de una copia. R22: una fila en error NO trae costos.
      return {
        estado: "error",
        resultado: { fila, numRemision, resultado: "error", errores: geoResult.fieldErrors },
      };
    }

    return {
      estado: "pendiente",
      fila,
      numRemision,
      geo: geoResult.geo,
      montoCobrar: parsed.data.monto_cobrar,
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
 * ausentes, es decir el cero mudo) sigue siendo INALCANZABLE desde aqui, aunque por otro
 * motivo desde la feature 274: ya no es que el lote entero se corte con `sin_tarifa`, es que
 * una fila cuyo par (tienda, zona) no resuelve se degrada a `error` ANTES de llegar a esta
 * funcion (R34). El cero mudo sigue sin poder emitirse (R15).
 *
 * ⚠️ FICHA 301 (2026-08-28) — EL ESCENARIO "DEVUELTO" SE DERIVA DE `rechazada`, NO DE
 * `devuelta`, Y NO ES UN DETALLE DE NOMBRES. Lo que esta funcion publica es una PROMESA de
 * precio al integrador, y una promesa solo vale si coincide con lo que se le acabara
 * cobrando. Ese dia se cambio la regla de negocio: un resultado de gestion `devuelta` dejo de
 * generar ingreso alguno, porque es un INTENTO FALLIDO que sigue vivo (se puede reprogramar,
 * liberar por SLA o recuperar a bodega) y el paquete no ha vuelto a la tienda. Quien devuelve
 * el paquete —y por tanto quien paga el retorno— es `rechazada` (`devolucion_rechazada` de la
 * 139: al aprobar el cierre la orden pasa a `por_devolver`/`por_devolver_a_tienda`).
 *
 * El escenario del contrato publico se llama "devuelto" y significa "cuanto cuesta si el
 * paquete SE DEVUELVE", que es exactamente ese cobro. Por eso apunta a `rechazada` y por eso
 * los importes publicados NO cambian con la 301: siguen siendo el flete de devolucion + su
 * IVA, alcanzables de verdad. La alternativa —seguir derivando de `devuelta` y publicar
 * ceros— habria dicho al integrador que un retorno es gratis, que es falso en cuanto la
 * tienda rechaza la orden; se descarto por eso.
 */
function calcularEscenarios(
  geo: { esCentral: boolean; esZonaEspecial: boolean },
  montoCobrar: string | null,
  tarifa: TarifaCotizada,
): { entregado: MontosEntregado; devuelto: MontosDevuelto } {
  const input = { ...geo, montoCobrar, cobraComision: COBRA_COMISION };

  const entregada = derivarIngresoOrden({ ...input, resultado: "entregada" }, tarifa);
  // Ficha 301: `rechazada` es el resultado que factura el retorno (ver el bloque de arriba).
  const devuelta = derivarIngresoOrden({ ...input, resultado: "rechazada" }, tarifa);

  const flete = entregada.ingreso_flete ?? cero();
  const iva = entregada.ingreso_iva_flete ?? cero();
  const comision = entregada.ingreso_comision_cod ?? cero();
  const ivaComision = entregada.ingreso_iva_comision_cod ?? cero();

  const fleteDevolucion = devuelta.ingreso_flete_devolucion ?? cero();
  const ivaDevolucion = devuelta.ingreso_iva_flete_devolucion ?? cero();

  // FULFILLMENT (2026-08-25): NO sale de `derivarIngresoOrden` —sigue fuera de la formula de
  // liquidacion— sino de la tarifa directamente, y entra igual en los DOS escenarios. Cero si
  // la tienda no hace fulfillment, que es el mismo total que se publicaba antes de hoy.
  const fulfillment = montoFulfillmentDeTarifa(tarifa);

  return {
    entregado: {
      flete,
      iva,
      comision,
      ivaComision,
      fulfillment,
      // R30/D1: lo que RECIBE la tienda = monto a cobrar menos los CINCO conceptos
      // facturados. R32: sin monto a cobrar la base es cero y el total sale NEGATIVO.
      total: new Prisma.Decimal(montoCobrar ?? 0)
        .minus(flete)
        .minus(iva)
        .minus(comision)
        .minus(ivaComision)
        .minus(fulfillment),
    },
    devuelto: {
      flete: fleteDevolucion,
      iva: ivaDevolucion,
      // R28: el cero de la comision se AFIRMA aqui. `derivarIngresoOrden` no emite comision
      // para una devolucion (no hubo recaudo), y esa ausencia se publica como cero explicito.
      comision: devuelta.ingreso_comision_cod ?? cero(),
      fulfillment,
      // R31/D1: la DEUDA de la tienda = el negativo de (flete + IVA + fulfillment) de la
      // devolucion. El fulfillment suma a la deuda porque el servicio ya se presto.
      total: fleteDevolucion.plus(ivaDevolucion).plus(fulfillment).negated(),
    },
  };
}

function sumarEntregado(acc: MontosEntregado, fila: MontosEntregado): void {
  acc.flete = acc.flete.plus(fila.flete);
  acc.iva = acc.iva.plus(fila.iva);
  acc.comision = acc.comision.plus(fila.comision);
  acc.ivaComision = acc.ivaComision.plus(fila.ivaComision);
  acc.fulfillment = acc.fulfillment.plus(fila.fulfillment);
  acc.total = acc.total.plus(fila.total);
}

function sumarDevuelto(acc: MontosDevuelto, fila: MontosDevuelto): void {
  acc.flete = acc.flete.plus(fila.flete);
  acc.iva = acc.iva.plus(fila.iva);
  acc.comision = acc.comision.plus(fila.comision);
  acc.fulfillment = acc.fulfillment.plus(fila.fulfillment);
  acc.total = acc.total.plus(fila.total);
}
