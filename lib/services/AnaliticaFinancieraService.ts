import { Prisma } from "@prisma/client";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import { UMBRAL_AVISO_DESCUADRE_CONCILIACION } from "@/lib/config/analitica-financiera";
import { monedaConfig } from "@/lib/config/moneda";
import { defaultLogger, type ErrorLogger } from "@/lib/errors/logger";
import type {
  AgregadoCategoriaCaja,
  IIngresosAnaliticaRepository,
} from "@/lib/interfaces/repositories/IIngresosAnaliticaRepository";
import type {
  IRecaudoAnaliticaRepository,
} from "@/lib/interfaces/repositories/IRecaudoAnaliticaRepository";
import type {
  ICuentasPorPagarAnaliticaRepository,
} from "@/lib/interfaces/repositories/ICuentasPorPagarAnaliticaRepository";
import type {
  IConciliacionCierresAnaliticaRepository,
  TotalLedgerPorOrigenCierre,
} from "@/lib/interfaces/repositories/IConciliacionCierresAnaliticaRepository";
import type {
  IAnaliticaFinancieraService,
  ResultadoConsultaFinanciera,
} from "@/lib/interfaces/services/IAnaliticaFinancieraService";
import {
  esMetricaAcumulada,
  VISTA_COD_RECAUDADO_POR_METODO,
  VISTA_COD_RECAUDADO_POR_TIENDA,
  type FilaFinanciera,
  type ImporteAnalitico,
  type ResultadoFinanciero,
  type VistaFinanciera,
} from "@/lib/types/analitica-financiera";
import { derivarBalance } from "@/lib/utils/wallet-balance";
import { derivarCuentaPorPagar } from "@/lib/utils/cuenta-por-pagar";
import { derivarSaldoTienda } from "@/lib/utils/saldo-tienda";

// Feature 127 (T D.1-D.9) — LA UNICA fachada de la analitica financiera.
//
// Que hace: valida el dominio, despacha por `metrica.id`, pide al repositorio que corresponda y
// DERIVA el DTO money-safe. Que NO hace: hablar Prisma, hablar HTTP, leer cookies, resolver
// alcance, parsear filtros y —sobre todo— reimplementar una resta de dinero.
//
// R20 / R27 — EL REUSO NO ES OPCIONAL, Y ES EL PUNTO MAS CARO DE LA FEATURE. El `neto` de las
// dos cuentas por pagar y de las cuatro metricas de caja sale de `derivarSaldoTienda`,
// `derivarCuentaPorPagar` y `derivarBalance`, que ya existen, ya son money-safe y ya tienen sus
// tests. Escribir aqui `creditos.sub(debitos)` crearia una SEGUNDA definicion de "saldo" al lado
// de la que la tienda ve en `/mi-wallet`, y las dos pueden divergir sin que nada falle: no da un
// error, da una discusion. Toda la aritmetica que si vive aqui es SUMA de agregados —nunca la
// resta con signo— y toda es `Prisma.Decimal`.
//
// R5 / R10 — `dominio_invalido` es un estado de PRIMERA CLASE y se decide ANTES de tocar ningun
// repositorio. Una rama por defecto que sirviera `entregas` con ceros seria peor que un fallo:
// un cero es indistinguible de "no hubo movimiento".
//
// R6 — el despacho es un MAPA y no un `switch`, y sus claves son `string` a proposito. Un
// `Record<MetricaFinancieraId, ...>` convertiria "sobra una metrica" o "falta una metrica" en un
// error de compilacion, y R6 pide un TEST que compare los ids servidos contra
// `listarMetricas({ dominio: "financiera" })` y falle por exceso y por defecto. Con el mapa
// abierto, las dos direcciones se miden de verdad en vez de depender de que alguien lea el error
// del compilador.
//
// R24 / ⟨D5⟩ — la conciliacion REPORTA y EMITE, pero NUNCA LANZA. Un tablero financiero que se
// cae por un descuadre historico es un tablero que alguien apaga, y con el se pierde justo la
// comprobacion que se queria ganar. El umbral entra por constructor (default: la constante de
// `lib/config/analitica-financiera.ts`, R40): aqui no hay ni un numero de dinero escrito.

/** Firma de un manejador de metrica. Todos reciben la consulta entera (R7). */
type Manejador = (consulta: ConsultaAnalitica) => Promise<ResultadoFinanciero>;

/** Σ de una lista de importes STRING, con `Prisma.Decimal`. Nunca `number` (R27). */
function sumar(valores: readonly string[]): Prisma.Decimal {
  return valores.reduce((acc, v) => acc.plus(new Prisma.Decimal(v)), new Prisma.Decimal(0));
}

/**
 * Un importe del DTO. La moneda sale de `lib/config/moneda.ts` (S2/R29): ni el codigo ni el
 * simbolo se escriben aqui.
 */
function importe(bruto: Prisma.Decimal | string, neto: Prisma.Decimal | string): ImporteAnalitico {
  return {
    bruto: new Prisma.Decimal(bruto).toFixed(2),
    neto: new Prisma.Decimal(neto).toFixed(2),
    moneda: monedaConfig.currency,
  };
}

/** Agrupa filas `(cubo, tipo, suma)` por cubo, conservando el orden de llegada (R28). */
function porCubo<T>(
  filas: readonly T[],
  cubo: (f: T) => string,
): readonly { readonly cubo: string; readonly filas: readonly T[] }[] {
  const orden: string[] = [];
  const mapa = new Map<string, T[]>();
  for (const fila of filas) {
    const clave = cubo(fila);
    let grupo = mapa.get(clave);
    if (grupo === undefined) {
      grupo = [];
      mapa.set(clave, grupo);
      orden.push(clave);
    }
    grupo.push(fila);
  }
  return orden.map((clave) => ({ cubo: clave, filas: mapa.get(clave) ?? [] }));
}

/** Σ de las filas cuyo `tipo` es el pedido. */
function sumaDeTipo<T extends { readonly tipo: string; readonly suma: string }>(
  filas: readonly T[],
  tipo: string,
): Prisma.Decimal {
  return sumar(filas.filter((f) => f.tipo === tipo).map((f) => f.suma));
}

export class AnaliticaFinancieraService implements IAnaliticaFinancieraService {
  private readonly despacho: Readonly<Record<string, Manejador>>;

  constructor(
    private readonly ingresos: IIngresosAnaliticaRepository,
    private readonly recaudo: IRecaudoAnaliticaRepository,
    private readonly cuentasPorPagar: ICuentasPorPagarAnaliticaRepository,
    private readonly conciliacion: IConciliacionCierresAnaliticaRepository,
    private readonly logger: ErrorLogger = defaultLogger,
    /** ⟨D5⟩/R40 — se inyecta para poder medir los dos lados del umbral sin tocar la config. */
    private readonly umbralDescuadre: string = UMBRAL_AVISO_DESCUADRE_CONCILIACION,
  ) {
    const caja: Manejador = (c) => this.deCaja(c);
    this.despacho = {
      ingreso_flete: caja,
      ingreso_comision_cod: caja,
      ingreso_iva: caja,
      // ⟨D8(b)⟩ / R18 — `egresos` la produce ESTA feature, con el mismo repositorio y las OCHO
      // categorias `egreso_*` que el catalogo declara. No hay estado `no_producida`.
      egresos: caja,
      cod_recaudado: (c) => this.deRecaudo(c),
      cuenta_por_pagar_tienda: (c) => this.deSaldoDeTiendas(c),
      cuenta_por_pagar_mensajero: (c) => this.deCuentaDeMensajeros(c),
      conciliacion_cierres: (c) => this.deConciliacion(c),
    };
  }

  /** Los ids que este servicio despacha de verdad. R6 los compara contra el catalogo. */
  get idsServidos(): readonly string[] {
    return Object.keys(this.despacho);
  }

  async consultar(consulta: ConsultaAnalitica): Promise<ResultadoConsultaFinanciera> {
    // R5 / R10 — PRIMERO el dominio, y sin consultar nada. `entregas` no llega al repositorio.
    if (consulta.metrica.dominio !== "financiera") {
      return { status: "dominio_invalido", metricaId: consulta.metrica.id };
    }

    const manejador = this.despacho[consulta.metrica.id];
    if (manejador === undefined) {
      // NO es una rama permisiva: es un fallo ruidoso. Solo se alcanza si el catalogo gana una
      // financiera sin productor, que es exactamente lo que R41 y el guardia B.5 vigilan.
      throw new Error(
        `analitica financiera: el catalogo declara la metrica "${consulta.metrica.id}" como financiera y esta feature no la produce`,
      );
    }

    return { status: "ok", datos: await manejador(consulta) };
  }

  /* ------------------------------------------------------------------ */
  /* Cabecera comun                                                      */
  /* ------------------------------------------------------------------ */

  private cabecera(consulta: ConsultaAnalitica) {
    return {
      metricaId: consulta.metrica.id,
      // Del catalogo, las dos: la 127 no escribe textos de UI ni decide unidades.
      etiqueta: consulta.metrica.etiqueta,
      unidad: consulta.metrica.unidad,
      rango: {
        desdeFecha: consulta.rango.desdeFecha,
        hastaFecha: consulta.rango.hastaFecha,
      },
      // ⟨D3⟩ / R43 — `true` EXACTAMENTE en las dos cuentas por pagar. Sale del registro del
      // contrato, no de un `if` escrito aqui.
      esAcumulado: esMetricaAcumulada(consulta.metrica.id),
    };
  }

  /* ------------------------------------------------------------------ */
  /* D.5 — la caja principal: ingresos e `egresos`                       */
  /* ------------------------------------------------------------------ */

  /**
   * `ingreso_flete`, `ingreso_comision_cod`, `ingreso_iva` y `egresos`.
   *
   * El repositorio devuelve `(categoria, tipo, suma)` y aqui se aplica el signo con
   * `derivarBalance` (R20): `neto = Σ ingreso − Σ egreso`. El `bruto` es la Σ de todo, sin signo
   * ⟨D1(c)⟩ — servir solo el neto esconderia el volumen y servir solo el bruto mentiria en cuanto
   * hubiera una anulacion.
   *
   * La vista no trae `filas` (S16): la unica dimension que estas cuatro metricas declaran es
   * `fecha`, y el repositorio agrega la ventana entera —es lo que `design.md §6` especifica—, asi
   * que no hay cubos que publicar. Inventar una fila con la fecha de inicio del rango afirmaria
   * que todo el dinero se movio ese dia.
   */
  private async deCaja(consulta: ConsultaAnalitica): Promise<ResultadoFinanciero> {
    const filas: readonly AgregadoCategoriaCaja[] = await this.ingresos.sumarPorCategoria(consulta);
    const balance = derivarBalance(sumaDeTipo(filas, "ingreso"), sumaDeTipo(filas, "egreso"));

    return {
      ...this.cabecera(consulta),
      tipo: "vistas",
      vistas: [
        {
          id: consulta.metrica.id,
          grano: "fecha",
          fuente: "wallet_movimiento",
          sumableCon: [],
          filas: [],
          total: importe(sumar(filas.map((f) => f.suma)), balance.balance),
        },
      ],
    };
  }

  /* ------------------------------------------------------------------ */
  /* D.4 — `cod_recaudado`: DOS vistas que no suman ⟨D6⟩                 */
  /* ------------------------------------------------------------------ */

  /**
   * Las dos proyecciones legales de `cod_recaudado`, con ids distintos y `sumableCon: []` en las
   * dos (R38). Una es lo que el mensajero entrego en cierres aprobados; la otra, lo acreditado a
   * tiendas. Un mismo cierre puede llevar ordenes de varias tiendas: sumarlas contaria el mismo
   * colon dos veces, y sin este campo la primera pantalla que las ponga juntas lo haria.
   */
  private async deRecaudo(consulta: ConsultaAnalitica): Promise<ResultadoFinanciero> {
    const [porMetodo, porTienda] = await Promise.all([
      this.recaudo.porMetodoDeCierresResueltos(consulta),
      this.recaudo.porTiendaDeLedger(consulta),
    ]);

    // Vista A — snapshot del cierre. `bruto === neto` y no es una copia perezosa: los tres
    // `total_*` son dinero RECAUDADO, un lado unico sin contrapartida en el snapshot. El neto con
    // signo de ⟨D1⟩ vive donde hay dos direcciones, que es el ledger (vista B).
    const vistaMetodo: VistaFinanciera = {
      id: VISTA_COD_RECAUDADO_POR_METODO,
      grano: "metodo_pago",
      fuente: "cierre_dia",
      sumableCon: [],
      filas: porMetodo.map((m) => ({ cubo: m.metodo, importe: importe(m.suma, m.suma) })),
      total: (() => {
        const t = sumar(porMetodo.map((m) => m.suma));
        return importe(t, t);
      })(),
    };

    // Vista B — ledger de tienda, con credito y debito: aqui el `neto` con signo si significa
    // algo, y lo produce `derivarSaldoTienda` (R20).
    const filasTienda: FilaFinanciera[] = porCubo(porTienda, (f) => f.tiendaId).map((g) => ({
      cubo: g.cubo,
      importe: importe(
        sumar(g.filas.map((f) => f.suma)),
        derivarSaldoTienda(sumaDeTipo(g.filas, "credito"), sumaDeTipo(g.filas, "debito")).saldo,
      ),
    }));

    const vistaTienda: VistaFinanciera = {
      id: VISTA_COD_RECAUDADO_POR_TIENDA,
      grano: "tienda",
      fuente: "wallet_tienda_movimiento",
      sumableCon: [],
      filas: filasTienda,
      total: importe(
        sumar(porTienda.map((f) => f.suma)),
        derivarSaldoTienda(sumaDeTipo(porTienda, "credito"), sumaDeTipo(porTienda, "debito")).saldo,
      ),
    };

    return { ...this.cabecera(consulta), tipo: "vistas", vistas: [vistaMetodo, vistaTienda] };
  }

  /* ------------------------------------------------------------------ */
  /* D.2 — las dos cuentas por pagar, con las funciones compartidas      */
  /* ------------------------------------------------------------------ */

  /** `cuenta_por_pagar_tienda`: saldo AL CORTE por tienda, con `derivarSaldoTienda` (R20/R21). */
  private async deSaldoDeTiendas(consulta: ConsultaAnalitica): Promise<ResultadoFinanciero> {
    const filas = await this.cuentasPorPagar.saldoPorTiendaAlCorte(consulta);

    return {
      ...this.cabecera(consulta),
      tipo: "vistas",
      vistas: [
        {
          id: consulta.metrica.id,
          grano: "tienda",
          fuente: "wallet_tienda_movimiento",
          sumableCon: [],
          filas: porCubo(filas, (f) => f.tiendaId).map((g) => ({
            cubo: g.cubo,
            importe: importe(
              sumar(g.filas.map((f) => f.suma)),
              derivarSaldoTienda(sumaDeTipo(g.filas, "credito"), sumaDeTipo(g.filas, "debito"))
                .saldo,
            ),
          })),
          total: importe(
            sumar(filas.map((f) => f.suma)),
            derivarSaldoTienda(sumaDeTipo(filas, "credito"), sumaDeTipo(filas, "debito")).saldo,
          ),
        },
      ],
    };
  }

  /**
   * `cuenta_por_pagar_mensajero`: UN total al corte, con `derivarCuentaPorPagar` (R20/R21).
   *
   * Sin `filas` y sin cubos, y eso es la proteccion, no una carencia (R14): el catalogo no
   * declara grano `mensajero`, asi que aqui no hay —ni puede haber— un id de persona.
   */
  private async deCuentaDeMensajeros(consulta: ConsultaAnalitica): Promise<ResultadoFinanciero> {
    const filas = await this.cuentasPorPagar.cuentaPorPagarMensajerosAlCorte(consulta);
    const cuenta = derivarCuentaPorPagar(sumaDeTipo(filas, "devengo"), sumaDeTipo(filas, "pago"));

    return {
      ...this.cabecera(consulta),
      tipo: "vistas",
      vistas: [
        {
          id: consulta.metrica.id,
          grano: "fecha",
          fuente: "pago_mensajero_movimiento",
          sumableCon: [],
          filas: [],
          total: importe(sumar(filas.map((f) => f.suma)), cuenta.cuentaPorPagar),
        },
      ],
    };
  }

  /* ------------------------------------------------------------------ */
  /* D.7 — la conciliacion: reporta, emite y NUNCA lanza ⟨D5⟩            */
  /* ------------------------------------------------------------------ */

  /**
   * `conciliacion_cierres`: conteos por `(nivel, estado)` con su coordenada temporal, mas el
   * cuadre entre el snapshot aprobado y el ledger.
   *
   * CONTRA QUE SE CONCILIA (S15/S17, `progress/impl_127_D.md`): el `total_general` de un cierre
   * es el COD que el mensajero entrego, y su contrapartida en el libro es el CREDITO que
   * `wallet_tienda_movimiento` registra con origen en ese cierre. Los debitos del mismo origen
   * (flete, comision, IVA) miden otra cosa, y los otros dos libros tambien —la caja recibe el
   * ingreso de Ordenex; el de mensajeros, el devengo—. Por eso se compara un lado concreto y no
   * la Σ de los tres: comparar todo contra todo declararia un descuadre permanente, y un aviso
   * que suena siempre es un aviso que se apaga.
   */
  private async deConciliacion(consulta: ConsultaAnalitica): Promise<ResultadoFinanciero> {
    const [porEstado, snapshots] = await Promise.all([
      this.conciliacion.contarCierresPorEstado(consulta),
      this.conciliacion.totalesDeCierresAprobados(consulta),
    ]);

    const cierreIds = snapshots.map((s) => s.cierreId);
    const ledger = await this.conciliacion.sumarLedgerPorOrigenDeCierre(consulta, cierreIds);

    const acreditado = new Map<string, Prisma.Decimal>();
    for (const fila of ledger.filter(esCreditoDeTienda)) {
      const previo = acreditado.get(fila.cierreId) ?? new Prisma.Decimal(0);
      acreditado.set(fila.cierreId, previo.plus(new Prisma.Decimal(fila.suma)));
    }

    const totalSnapshot = sumar(snapshots.map((s) => s.totalGeneral));
    const totalLedger = snapshots.reduce(
      (acc, s) => acc.plus(acreditado.get(s.cierreId) ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0),
    );
    const diferencia = totalSnapshot.sub(totalLedger);

    const cierresDescuadrados = snapshots
      .filter(
        (s) =>
          !new Prisma.Decimal(s.totalGeneral).eq(acreditado.get(s.cierreId) ?? new Prisma.Decimal(0)),
      )
      .map((s) => s.cierreId);

    const cuadra = diferencia.isZero() && cierresDescuadrados.length === 0;

    // R24 — se EMITE por encima del umbral y se devuelve el DTO igual. Nunca `throw`.
    if (diferencia.abs().gte(new Prisma.Decimal(this.umbralDescuadre))) {
      this.logger.logError(
        new Error(
          `analitica financiera: descuadre de conciliacion_cierres en [${consulta.rango.desdeFecha}, ${consulta.rango.hastaFecha}]: snapshot ${totalSnapshot.toFixed(2)} vs ledger ${totalLedger.toFixed(2)} (diferencia ${diferencia.toFixed(2)}); cierres: ${cierresDescuadrados.join(", ")}`,
        ),
      );
    }

    return {
      ...this.cabecera(consulta),
      tipo: "conciliacion",
      conciliacion: {
        porEstado,
        cuadre: {
          cuadra,
          totalSnapshot: totalSnapshot.toFixed(2),
          totalLedger: totalLedger.toFixed(2),
          diferencia: diferencia.toFixed(2),
          cierresDescuadrados,
        },
      },
    };
  }
}

/** El lado del ledger que mide lo mismo que `total_general`: el credito del libro de tienda. */
function esCreditoDeTienda(fila: TotalLedgerPorOrigenCierre): boolean {
  return fila.ledger === "wallet_tienda_movimiento" && fila.tipo === "credito";
}
