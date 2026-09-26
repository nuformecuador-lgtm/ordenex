import { Prisma, type PrismaClient } from "@prisma/client";

import type { ISaldosSatelitesRepository } from "@/lib/interfaces/repositories/ISaldosSatelitesRepository";
import type {
  ConsolidacionSateliteDTO,
  ResumenSatelitesDTO,
  SaldoSateliteDTO,
  UltimaRecibidaDTO,
} from "@/lib/types/conciliacion-satelites";
import { saldoDe } from "@/lib/utils/conciliacion-satelite";
import { diasNaturalesCRDesde, inicioDelMesCREnUtc } from "@/lib/utils/fecha-cr";
import { CUENTA_USUARIO_SELECT, etiquetaDeCuenta } from "@/lib/utils/etiqueta-cuenta";
import type { PaginaRepositorio, RangoPagina } from "@/lib/utils/rango-pagina";

/**
 * ⭑ FICHA 431 — EL SALDO SIN CONCILIAR DE LAS BODEGAS SATELITE. Solo Prisma; cero logica de
 * negocio (el guard de rol lo aplica `ConciliacionSatelitesService` ANTES de llegar aqui).
 *
 * LA FORMULA VIVE EN UN SOLO SITIO DE ESTE ARCHIVO (`saldoDe`), y se aplica a las dos escalas: la
 * fila de una bodega y la fila de una consolidacion. Con dos copias, la suma de la columna de
 * detalle dejaria de cuadrar con el total de la tabla de arriba el dia que una de las dos cambie.
 *
 * ⚠️ SOBRE `total_efectivo` Y NO SOBRE `total_general`: decision del humano sobre Q2 (2026-09-16),
 * medida contra produccion. El SINPE —26,3 % del consolidado— entra directo a una cuenta y NO viaja
 * en el bulto; con `total_general` la pantalla ensenaria ₡1,1 M de deuda que nadie va a entregar en
 * mano. El general viaja igual en el DTO, como contexto.
 */

/** El estado retirado de la pantalla (D2). En produccion hay CERO; queda declarado como limite. */
const ESTADO_RECHAZADO = "rechazado";

/** Solo las bodegas SATELITE: la central no se consolida a si misma. */
const ZONA_SATELITE_WHERE = { esCentral: false } as const;

/**
 * El alcance del DINERO: todas las consolidaciones de la zona que no esten rechazadas — incluidas
 * las YA conciliadas, porque sin ellas la diferencia parcial de R18 desapareceria del saldo.
 */
const NO_RECHAZADAS = { estado: { not: ESTADO_RECHAZADO } } as const;

const CONSOLIDACION_SELECT = {
  id: true,
  solicitadoAt: true,
  totalEfectivo: true,
  totalSimpe: true,
  totalTransferencia: true,
  totalGeneral: true,
  montoRecibido: true,
  conciliadoAt: true,
  conciliadoNota: true,
  conciliadoPorUsuario: { select: CUENTA_USUARIO_SELECT },
  _count: { select: { cierresDia: true } },
} as const;

type ConsolidacionRow = Prisma.CierreBodegaGetPayload<{ select: typeof CONSOLIDACION_SELECT }>;

// LA FORMULA (R17/R18) vive en `lib/utils/conciliacion-satelite.ts` y se importa arriba.
//
// ⭑ FICHA 431 (pasada de frontend) — SALIO DE ESTE ARCHIVO al ganar su SEGUNDO lector en el
// servidor: `CierreBodegaRepository.toBodegaResumenRow`, que deriva el MISMO `faltaPorRecibir`
// para las superficies de `/cierres-admin` —las que ve la bodega satelite (R26)—. Copiarla habria
// dejado a la satelite y a la central capaces de leer la misma consolidacion con dos cifras
// distintas. Sigue siendo `Prisma.Decimal` -> `toFixed(2)` en el emisor; aqui no cambia nada mas.

function toConsolidacionDTO(r: ConsolidacionRow): ConsolidacionSateliteDTO {
  return {
    cierreBodegaId: r.id,
    solicitadoAt: r.solicitadoAt.toISOString(),
    totales: {
      efectivo: r.totalEfectivo.toFixed(2),
      simpe: r.totalSimpe.toFixed(2),
      transferencia: r.totalTransferencia.toFixed(2),
      general: r.totalGeneral.toFixed(2),
    },
    montoRecibido: r.montoRecibido === null ? null : r.montoRecibido.toFixed(2),
    // R20: la resta se hace AQUI, con Decimal. La pantalla no resta dinero.
    faltaPorRecibir: saldoDe(r.totalEfectivo, r.montoRecibido).toFixed(2),
    conciliado: r.conciliadoAt !== null,
    conciliadoAt: r.conciliadoAt === null ? null : r.conciliadoAt.toISOString(),
    conciliadoPorNombre:
      r.conciliadoPorUsuario === null ? null : etiquetaDeCuenta(r.conciliadoPorUsuario),
    nota: r.conciliadoNota,
    cantidadCierres: r._count.cierresDia,
  };
}

type ClienteSaldosSatelites = Pick<PrismaClient, "cierreBodega" | "zona">;

export class SaldosSatelitesRepository implements ISaldosSatelitesRepository {
  constructor(private readonly prisma: ClienteSaldosSatelites) {}

  async findSaldosPaginado(rango: RangoPagina): Promise<PaginaRepositorio<SaldoSateliteDTO>> {
    const [zonas, total] = await Promise.all([
      this.prisma.zona.findMany({
        where: ZONA_SATELITE_WHERE,
        orderBy: { nombre: "asc" },
        skip: rango.skip,
        take: rango.take,
        select: { id: true, nombre: true },
      }),
      this.prisma.zona.count({ where: ZONA_SATELITE_WHERE }),
    ]);
    return { items: await this.componerSaldos(zonas), total };
  }

  async findSaldosCompleto(): Promise<SaldoSateliteDTO[]> {
    // MISMO `where` y MISMO `orderBy` que la pagina, a proposito: la pagina N tiene que ser el
    // segmento N de este conjunto o la descarga describiria otra cosa que la pantalla.
    const zonas = await this.prisma.zona.findMany({
      where: ZONA_SATELITE_WHERE,
      orderBy: { nombre: "asc" },
      select: { id: true, nombre: true },
    });
    return this.componerSaldos(zonas);
  }

  /**
   * LAS DOS AGREGACIONES, Y POR QUE SON DOS. Preguntan cosas distintas sobre poblaciones distintas:
   *
   *  (a) EL DINERO — incluye lo ya conciliado. Sin ello, una consolidacion marcada por menos de lo
   *      declarado dejaria de aportar su diferencia y el saldo perderia exactamente el caso que
   *      R18 existe para cubrir.
   *  (b) LA COLA — solo lo que sigue SIN marcar, que es lo que se cuenta (R21) y de lo que se mide
   *      la antiguedad.
   *
   * Un `groupBy` de Prisma no hace agregados condicionales, y meterlo en un `$queryRaw` con
   * `FILTER (WHERE …)` cambiaria dos consultas legibles por una cadena de SQL a mano en un camino
   * de dinero.
   *
   * Los nombres de zona NO se resuelven en el cliente: llegan de la lectura de `zona` de arriba.
   */
  private async componerSaldos(
    zonas: { id: string; nombre: string }[],
  ): Promise<SaldoSateliteDTO[]> {
    if (zonas.length === 0) return [];
    const zonaIds = zonas.map((z) => z.id);
    const ahora = new Date();

    const [dinero, cola, ultimas] = await Promise.all([
      this.prisma.cierreBodega.groupBy({
        by: ["zonaId"],
        where: { zonaId: { in: zonaIds }, ...NO_RECHAZADAS },
        _sum: { totalEfectivo: true, totalGeneral: true, montoRecibido: true },
      }),
      this.prisma.cierreBodega.groupBy({
        by: ["zonaId"],
        where: { zonaId: { in: zonaIds }, conciliadoAt: null, ...NO_RECHAZADAS },
        _count: { _all: true },
        _min: { solicitadoAt: true },
      }),
      // (c) LA ULTIMA RECIBIDA — el INSTANTE de la mas reciente de cada zona. Solo la fecha: un
      // `groupBy` devuelve agregados, no la fila que los produjo, asi que el importe se busca
      // despues con esa fecha.
      this.prisma.cierreBodega.groupBy({
        by: ["zonaId"],
        where: { zonaId: { in: zonaIds }, conciliadoAt: { not: null }, ...NO_RECHAZADAS },
        _max: { conciliadoAt: true },
      }),
    ]);

    const dineroPorZona = new Map(dinero.map((d) => [d.zonaId, d]));
    const colaPorZona = new Map(cola.map((c) => [c.zonaId, c]));
    const ultimaPorZona = await this.leerUltimasRecibidas(ultimas);

    return zonas.map((zona) => {
      const d = dineroPorZona.get(zona.id);
      const c = colaPorZona.get(zona.id);
      // `_sum` de un conjunto vacio es `null`: una bodega sin consolidaciones vale CERO, no un
      // hueco que la pantalla tenga que interpretar.
      const efectivo = d?._sum.totalEfectivo ?? new Prisma.Decimal(0);
      const general = d?._sum.totalGeneral ?? new Prisma.Decimal(0);
      // `_sum.montoRecibido` ignora los NULL, que es justo lo que la formula quiere.
      const recibido = d?._sum.montoRecibido ?? new Prisma.Decimal(0);
      const masAntigua = c?._min.solicitadoAt ?? null;

      return {
        zonaId: zona.id,
        zonaNombre: etiquetaDeCuenta(zona),
        saldoSinConciliar: saldoDe(efectivo, recibido).toFixed(2),
        totalEfectivo: efectivo.toFixed(2),
        totalConsolidado: general.toFixed(2),
        totalRecibido: recibido.toFixed(2),
        consolidacionesSinConciliar: c?._count._all ?? 0,
        // R21: los dias se derivan EN EL SERVIDOR con el calendario de Costa Rica. `null` = no hay
        // cola, que NO es lo mismo que `0` («la mas vieja es de hoy»).
        diasDeLaMasAntigua: masAntigua === null ? null : diasNaturalesCRDesde(masAntigua, ahora),
        fechaDeLaMasAntigua: masAntigua === null ? null : masAntigua.toISOString(),
        // La ULTIMA que llego. `null` = a esta bodega nunca se le marco ninguna. NO es el
        // acumulado `totalRecibido` que va arriba: es UNA fila, con su fecha y su importe.
        ultimaRecibida: ultimaPorZona.get(zona.id) ?? null,
      };
    });
  }

  /**
   * ⭑ LA ULTIMA CONSOLIDACION RECIBIDA de cada zona, en DOS pasos y no en uno.
   *
   * POR QUE DOS: el `groupBy` de arriba sabe CUANDO fue la ultima (`_max.conciliado_at`) pero no
   * devuelve la fila que lo produjo, y el importe vive en esa fila. Aqui se piden exactamente
   * esas N filas —una por zona con alguna recibida— por su par (zona, instante).
   *
   * POR QUE NO UN `findMany` + `distinct`: el recorte a una fila por zona lo haria Prisma, pero
   * si la version de turno no empuja el `DISTINCT ON` a Postgres, la consulta se trae TODAS las
   * consolidaciones conciliadas de la operacion para quedarse con cinco. Este par de consultas
   * esta acotado por construccion —como mucho una fila por zona— y no depende de esa semantica.
   *
   * EL EMPATE, dicho: dos consolidaciones de la MISMA zona marcadas en el MISMO microsegundo
   * traerian dos filas. Se queda la primera y es DETERMINISTA por el `orderBy`: entre dos bultos
   * marcados a la vez, cualquiera de los dos responde igual de bien a «cuando llego el ultimo»,
   * pero alternar entre ellos en dos recargas si seria un defecto.
   */
  private async leerUltimasRecibidas(
    ultimas: { zonaId: string; _max: { conciliadoAt: Date | null } }[],
  ): Promise<Map<string, UltimaRecibidaDTO>> {
    const pares = ultimas.flatMap((u) =>
      u._max.conciliadoAt === null ? [] : [{ zonaId: u.zonaId, conciliadoAt: u._max.conciliadoAt }],
    );
    if (pares.length === 0) return new Map();

    const filas = await this.prisma.cierreBodega.findMany({
      where: { OR: pares },
      orderBy: [{ conciliadoAt: "desc" }, { id: "asc" }], // el desempate, ver arriba
      select: { zonaId: true, conciliadoAt: true, montoRecibido: true, totalEfectivo: true },
    });

    const porZona = new Map<string, UltimaRecibidaDTO>();
    for (const f of filas) {
      // `conciliadoAt` no puede ser nulo aqui —se busco por su valor— pero el tipo lo admite y
      // un `!` seria la afirmacion que un dia deja de ser cierta sin avisar.
      if (f.conciliadoAt === null || porZona.has(f.zonaId)) continue;
      porZona.set(f.zonaId, {
        fecha: f.conciliadoAt.toISOString(),
        // Una fila con `conciliado_at` SIEMPRE tiene `monto_recibido`: lo impone el `CHECK`
        // `cierre_bodega_conciliacion_coherente`. El `?? 0` es la lectura defensiva del tipo
        // nulable, no una suposicion sobre el dato.
        monto: (f.montoRecibido ?? new Prisma.Decimal(0)).toFixed(2),
        declarado: f.totalEfectivo.toFixed(2),
        // R20: la resta de ESA fila, hecha AQUI con la MISMA formula que el saldo de la bodega.
        // La pantalla pregunta si falta algo; no lo calcula.
        faltaPorRecibir: saldoDe(f.totalEfectivo, f.montoRecibido).toFixed(2),
      });
    }
    return porZona;
  }

  async findConsolidacionesPaginado(
    zonaId: string,
    rango: RangoPagina,
    soloSinConciliar?: boolean,
  ): Promise<PaginaRepositorio<ConsolidacionSateliteDTO>> {
    // El `where` se construye UNA vez y lo comparten `findMany` y `count`. Que el `zonaId` sea el
    // MISMO objeto en las dos consultas no es cosmetico: es lo que impide que el total cuente las
    // consolidaciones de toda la operacion mientras la pagina muestra las de una bodega.
    const where = this.consolidacionesWhere(zonaId, soloSinConciliar);
    const [rows, total] = await Promise.all([
      this.prisma.cierreBodega.findMany({
        where,
        orderBy: { solicitadoAt: "desc" },
        skip: rango.skip,
        take: rango.take,
        select: CONSOLIDACION_SELECT,
      }),
      this.prisma.cierreBodega.count({ where }),
    ]);
    return { items: rows.map(toConsolidacionDTO), total };
  }

  async findConsolidacionesCompleto(
    zonaId: string,
    soloSinConciliar?: boolean,
  ): Promise<ConsolidacionSateliteDTO[]> {
    const rows = await this.prisma.cierreBodega.findMany({
      where: this.consolidacionesWhere(zonaId, soloSinConciliar),
      orderBy: { solicitadoAt: "desc" }, // el MISMO orden que la pagina (R29)
      select: CONSOLIDACION_SELECT,
    });
    return rows.map(toConsolidacionDTO);
  }

  /** UN solo `where` para las cuatro lecturas del desglose, por el motivo de arriba. */
  private consolidacionesWhere(zonaId: string, soloSinConciliar?: boolean) {
    return {
      zonaId,
      ...NO_RECHAZADAS,
      ...(soloSinConciliar === true ? { conciliadoAt: null } : {}),
    };
  }

  /**
   * ⭑ R20/R23 — LAS TRES CIFRAS DE CABECERA, derivadas en el servidor.
   *
   * ── UNA SOLA LECTURA, Y POR QUE ES UN BARRIDO Y NO CUATRO `groupBy`
   * Las tres tarjetas preguntan sobre TRES POBLACIONES distintas de la misma tabla, y dos de
   * ellas —«con diferencia» y «bodegas con pendiente»— comparan DOS COLUMNAS entre si
   * (`monto_recibido` contra `total_efectivo`), que es justo lo que un `groupBy` de Prisma no
   * sabe hacer. Las alternativas eran una referencia de campo o un `$queryRaw` con
   * `FILTER (WHERE …)`: SQL a mano en un camino de dinero, para ahorrar un escaneo de 32 filas.
   *
   * VOLUMEN MEDIDO, que es lo que hace correcta esta decision: 32 consolidaciones en dos semanas
   * de operacion real, ~800 al ano entre 5 satelites. El conjunto entero cabe de sobra, y el
   * indice `cierre_bodega_zona_estado_idx` lo sirve. Si un dia fueran cientos de miles, la
   * respuesta seria un agregado en la base — no repartir la formula en cuatro consultas.
   *
   * ── Y LA FORMULA SIGUE SIENDO UNA (`saldoDe`)
   * Las tres cifras salen de la MISMA resta que la tabla y que el desglose. Escribir aqui una
   * suma propia habria hecho que la cabecera y la columna de abajo pudieran decir cosas distintas
   * sobre el mismo dinero, que es el defecto que la ficha 359 censo en 13 pantallas.
   */
  async findResumen(ahora: Date = new Date()): Promise<ResumenSatelitesDTO> {
    const filas = await this.prisma.cierreBodega.findMany({
      where: { ...NO_RECHAZADAS, zona: ZONA_SATELITE_WHERE },
      select: {
        zonaId: true,
        totalEfectivo: true,
        montoRecibido: true,
        conciliadoAt: true,
      },
    });

    // El corte del mes, en el calendario de COSTA RICA y resuelto en el SERVIDOR: con el mes del
    // navegador, quien mirara la pantalla desde otro huso veria otra cifra de la misma caja.
    const inicioDelMes = inicioDelMesCREnUtc(ahora);

    let pendiente = new Prisma.Decimal(0);
    let recibidoMes = new Prisma.Decimal(0);
    let diferencia = new Prisma.Decimal(0);
    let sinConciliar = 0;
    let recibidasMes = 0;
    let conDiferencia = 0;
    /** El saldo acumulado POR ZONA: una bodega cuenta como «con pendiente» una sola vez. */
    const saldoPorZona = new Map<string, Prisma.Decimal>();

    for (const f of filas) {
      const falta = saldoDe(f.totalEfectivo, f.montoRecibido);
      pendiente = pendiente.plus(falta);
      saldoPorZona.set(f.zonaId, (saldoPorZona.get(f.zonaId) ?? new Prisma.Decimal(0)).plus(falta));

      if (f.conciliadoAt === null) {
        sinConciliar += 1;
        continue;
      }
      if (f.conciliadoAt >= inicioDelMes) {
        recibidasMes += 1;
        recibidoMes = recibidoMes.plus(f.montoRecibido ?? new Prisma.Decimal(0));
      }
      // «Con diferencia» cuenta SOLO el faltante positivo: una que llego de mas no compensa a
      // otra que llego de menos. Son dos bultos y dos conversaciones distintas, y sumarlas con
      // signo dejaria la tarjeta en cero justo cuando hay dos problemas, no ninguno.
      if (falta.greaterThan(0)) {
        conDiferencia += 1;
        diferencia = diferencia.plus(falta);
      }
    }

    let bodegasConPendiente = 0;
    for (const saldo of saldoPorZona.values()) {
      if (!saldo.isZero()) bodegasConPendiente += 1;
    }

    return {
      pendienteTotal: pendiente.toFixed(2),
      consolidacionesSinConciliar: sinConciliar,
      bodegasConPendiente,
      recibidoEsteMes: recibidoMes.toFixed(2),
      consolidacionesRecibidasEsteMes: recibidasMes,
      diferenciaTotal: diferencia.toFixed(2),
      consolidacionesConDiferencia: conDiferencia,
    };
  }
}
