import { Prisma } from "@prisma/client";
import type {
  CrearMovimientoInput,
  DesgloseEgresosAgregado,
  IWalletMovimientoRepository,
  ListarMovimientosPage,
  WalletTxClient,
} from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type {
  CajaBackfillDeps,
  FilaRetroactiva,
  ICajaBackfillTesoreriaService,
  InformeBackfillCaja,
  ModoBackfillCaja,
  OrigenBackfillCaja,
  ResumenPorCategoria,
} from "@/lib/interfaces/services/ICajaBackfillTesoreriaService";
import type { ICajaPagoTiendaFeedService } from "@/lib/interfaces/services/ICajaPagoTiendaFeedService";
import type { AgregadoCajaRow, WalletMovimientoDTO } from "@/lib/types/wallet";
import {
  descripcionDeAnulacion,
  descripcionDePago,
  medianocheUtcDelDia,
} from "@/lib/utils/descripcion-pago";
import { fechaCalendarioCR } from "@/lib/utils/fecha-cr";

/**
 * Feature 173 / T E.1 (design §6, R36-R44) — el registro RETROACTIVO de la caja en modo
 * tesoreria.
 *
 * Lo unico que hace es **poner en la caja las filas que hoy ya nacerian solas** para documentos
 * escritos antes de las tandas B y C. Ni corrige, ni reinterpreta, ni compensa: el libro es
 * append-only y lo que falta es la fila entera, no un importe equivocado.
 *
 * **Las filas no se construyen aqui.** Las construyen los emisores del camino vivo:
 * `ICajaCodFeedService` para el contra-entrega del cierre (Tanda B) y `ICajaPagoTiendaFeedService`
 * para el pago a la tienda y su anulacion (Tanda C). Este servicio les da los datos del
 * documento y se queda con lo que emiten. Por eso su codigo **no nombra ni una categoria de la
 * caja ni un `origen_tipo`**: la clave de idempotencia `(origen_tipo, origen_id, categoria)` se
 * LEE de la fila emitida. Si aqui hubiera una segunda declaracion de a que categoria pertenece
 * cada dinero, el dia que las dos discreparan no habria forma de decir cual tiene razon.
 *
 * Lo unico que el backfill si decide —porque el camino vivo no tiene que decidirlo— es **la
 * fecha** (design §6.2, R41), y sale siempre del ORIGEN:
 *
 * | Origen | Fecha del movimiento |
 * | --- | --- |
 * | cierre aprobado | `MIN(fecha_movimiento)` de los movimientos de caja que ese cierre ya tiene; si no tiene ninguno, `resuelto_at`; y si tampoco, `solicitado_at` |
 * | pago a tienda | `liquidacion_pago.fecha_pago` |
 * | anulacion | el DIA (calendario CR) de `liquidacion_anulacion.created_at` |
 *
 * El tercer escalon de la cadena del cierre no esta en el design: esta porque `resuelto_at` es
 * NULLABLE en el esquema, y un NULL ahi no puede acabar en `now()`. `solicitado_at` es
 * obligatorio y es del propio documento, asi que la fecha sale siempre del origen.
 *
 * **Coste declarado:** le pregunta al feed del contra-entrega una vez por cierre aprobado (N
 * consultas indexadas por `(origen_tipo, origen_id)`) en lugar de agregar el ledger por su
 * cuenta. Una agregacion propia seria una SEGUNDA formula para el mismo dinero, que es justo lo
 * que la Tanda B decidio no tener (design §3.1). Un script que se corre a mano una vez por
 * entorno puede pagar ese coste; el libro de la caja no puede pagar dos fuentes.
 */
export class CajaBackfillTesoreriaService implements ICajaBackfillTesoreriaService {
  private readonly recolector: RecolectorDeFilasDeCaja;
  /** El puerto de la Tanda C montado sobre el recolector: emite sus filas SIN escribirlas. */
  private readonly puertoEnSeco: ICajaPagoTiendaFeedService;

  constructor(private readonly deps: CajaBackfillDeps) {
    this.recolector = new RecolectorDeFilasDeCaja();
    this.puertoEnSeco = deps.crearPuertoDePago(this.recolector);
  }

  async ejecutar(modo: ModoBackfillCaja): Promise<InformeBackfillCaja> {
    const deCierres = await this.deCierresAprobados();
    const dePagos = await this.dePagosATienda();
    const deAnulaciones = await this.deAnulacionesDePagoATienda();
    const candidatas = [...deCierres.filas, ...dePagos.filas, ...deAnulaciones.filas];

    // La caja se consulta DESPUES de tener las candidatas, y con las claves que ellas traen:
    // asi el backfill no tiene que saber ni que `origen_tipo` ni que categoria emite cada
    // emisor. Lo mismo sirve para las dos cosas: saber que claves estan ocupadas y saber cuando
    // cayo cada cierre (design §6.2).
    const { ocupadas, primerMovimiento } = await this.leerLoQueLaCajaYaTiene(candidatas);

    const pendientes = candidatas
      .map((c) => fechar(c, primerMovimiento))
      .filter((f) => !ocupadas.has(claveDeOrigen(f.movimiento)));

    // R40/R42: fuera de `aplicar` no se escribe NADA. No es un `if` que se salta el insert: es
    // que la unica llamada capaz de escribir solo existe dentro de esta rama.
    const insertadas =
      modo === "aplicar"
        ? await this.deps.cajaRepo.crearMovimientos(
            this.deps.cliente,
            pendientes.map((f) => f.movimiento),
          )
        : 0;

    return {
      modo,
      instante: this.deps.ahora().toISOString(),
      examinados: {
        cierre_aprobado: deCierres.examinados,
        pago_a_tienda: dePagos.examinados,
        anulacion_de_pago_a_tienda: deAnulaciones.examinados,
      },
      pendientes,
      porCategoria: agruparPorCategoria(pendientes),
      insertadas,
      alDia: pendientes.length === 0, // R44
    };
  }

  /**
   * Las claves de origen que la caja YA tiene, acotadas a las de las candidatas, y el
   * movimiento mas temprano de cada documento.
   *
   * Si este filtro se quedara corto no habria duplicado: la barrera de verdad es el indice
   * unico parcial `(origen_tipo, origen_id, categoria)` con `skipDuplicates` (R39/R48). Lo
   * unico que sufriria seria el CONTEO del informe, que reportaria de mas.
   */
  private async leerLoQueLaCajaYaTiene(candidatas: readonly Candidata[]): Promise<{
    ocupadas: ReadonlySet<string>;
    primerMovimiento: ReadonlyMap<string, Date>;
  }> {
    const origenTipos = [...new Set(candidatas.map((c) => c.movimiento.origenTipo))];
    const origenIds = [
      ...new Set(
        candidatas
          .map((c) => c.movimiento.origenId)
          .filter((id): id is string => id !== null && id !== ""),
      ),
    ];
    if (origenTipos.length === 0 || origenIds.length === 0) {
      return { ocupadas: new Set<string>(), primerMovimiento: new Map<string, Date>() };
    }

    const filas = await this.deps.cliente.walletMovimiento.findMany({
      where: { origenTipo: { in: origenTipos }, origenId: { in: origenIds } },
      select: { origenTipo: true, origenId: true, categoria: true, fechaMovimiento: true },
    });

    const ocupadas = new Set<string>();
    const primerMovimiento = new Map<string, Date>();
    for (const fila of filas) {
      if (fila.origenId === null) continue; // el WHERE ya lo excluye; el tipo no lo sabe
      ocupadas.add(claveDeOrigen(fila));
      const previa = primerMovimiento.get(fila.origenId);
      if (previa === undefined || fila.fechaMovimiento < previa) {
        primerMovimiento.set(fila.origenId, fila.fechaMovimiento);
      }
    }
    return { ocupadas, primerMovimiento };
  }

  /**
   * R36 — el contra-entrega de cada cierre YA APROBADO, derivado de los creditos que ese cierre
   * dejo en el ledger de la tienda. Lo suma el feed de la Tanda B, no este servicio.
   */
  private async deCierresAprobados(): Promise<Cosecha> {
    const cierres = await this.deps.cliente.cierreDia.findMany({
      where: { estado: "aprobado" },
      select: { id: true, resueltoAt: true, solicitadoAt: true },
      orderBy: { id: "asc" },
    });

    const filas: Candidata[] = [];
    for (const cierre of cierres) {
      const movimientos = await this.deps.codFeed.construirIngresoCod(cierre.id, this.deps.cliente);
      // Un cierre sin contra-entrega no emite fila, ni siquiera en 0.00: es R13, y hacia atras
      // vale exactamente igual que hacia delante.
      for (const movimiento of movimientos) {
        filas.push({
          origen: "cierre_aprobado",
          documentoId: cierre.id,
          movimiento,
          // Ultimo escalon de la cadena de §6.2. El emisor vivo NO fecha esta fila (R17: cae en
          // `CURRENT_TIMESTAMP` junto a los otros cuatro movimientos de esa aprobacion), asi que
          // es la unica que el backfill tiene que fechar.
          fechaDeRespaldo: cierre.resueltoAt ?? cierre.solicitadoAt,
        });
      }
    }
    return { filas, examinados: cierres.length };
  }

  /** R37 — el egreso de cada pago a tienda ya registrado, derivado del documento del pago. */
  private async dePagosATienda(): Promise<Cosecha> {
    const pagos = await this.deps.cliente.liquidacionPago.findMany({
      where: { tiendaId: { not: null } }, // los pagos a MENSAJERO no generan nada: `[P2]` = (a)
      select: {
        id: true,
        monto: true,
        metodo: true,
        referencia: true,
        fechaPago: true,
        registradoPor: true,
      },
      orderBy: { id: "asc" },
    });

    const filas: Candidata[] = [];
    for (const pago of pagos) {
      await this.puertoEnSeco.emitirEgresoDePago(this.deps.cliente, {
        pagoId: pago.id,
        monto: pago.monto.toFixed(2), // Decimal -> STRING escala 2; ni un `number` por el camino
        descripcion: descripcionDePago(pago.metodo, pago.referencia),
        registradoPor: pago.registradoPor,
        // R41: `fecha_pago` es `@db.Date` = medianoche UTC del dia, que es EXACTAMENTE lo que
        // el camino vivo escribe (`medianocheUtcDelDia(input.fechaPago)`).
        fechaMovimiento: pago.fechaPago,
      });
      filas.push(...this.recogerComo("pago_a_tienda", pago.id, pago.fechaPago));
    }
    return { filas, examinados: pagos.length };
  }

  /** R38 — el reverso de cada anulacion de un pago a TIENDA ya registrada. */
  private async deAnulacionesDePagoATienda(): Promise<Cosecha> {
    const anulaciones = await this.deps.cliente.liquidacionAnulacion.findMany({
      where: { pago: { tiendaId: { not: null } } }, // la de un pago a mensajero, tampoco
      select: {
        pagoId: true,
        createdAt: true,
        anuladoPor: true,
        pago: { select: { monto: true, metodo: true, referencia: true } },
      },
      orderBy: { pagoId: "asc" },
    });

    const filas: Candidata[] = [];
    for (const anulacion of anulaciones) {
      // R41 — el DIA de la anulacion, con las MISMAS dos funciones que usa el camino vivo
      // (`medianocheUtcDelDia(fechaCalendarioCR(...))`). Lo unico que cambia es de donde sale
      // el instante: alli del reloj, aqui del documento.
      const diaDeLaAnulacion = medianocheUtcDelDia(fechaCalendarioCR(anulacion.createdAt));
      await this.puertoEnSeco.emitirReversoDeAnulacion(this.deps.cliente, {
        pagoId: anulacion.pagoId,
        // R76 de la 172: se anula ENTERO, y el monto es el del PAGO, nunca uno recalculado.
        monto: anulacion.pago.monto.toFixed(2),
        descripcion: descripcionDeAnulacion(anulacion.pago.metodo, anulacion.pago.referencia),
        registradoPor: anulacion.anuladoPor,
        fechaMovimiento: diaDeLaAnulacion,
      });
      filas.push(...this.recogerComo("anulacion_de_pago_a_tienda", anulacion.pagoId, diaDeLaAnulacion));
    }
    return { filas, examinados: anulaciones.length };
  }

  /** Lo que el puerto acaba de emitir, etiquetado con el documento que lo justifica. */
  private recogerComo(
    origen: OrigenBackfillCaja,
    documentoId: string,
    fechaDeRespaldo: Date,
  ): Candidata[] {
    return this.recolector
      .vaciar()
      .map((movimiento) => ({ origen, documentoId, movimiento, fechaDeRespaldo }));
  }
}

/**
 * Un documento al que le puede faltar su fila, con la fila **ya emitida por el camino vivo** y
 * la fecha del origen a mano.
 */
interface Candidata {
  readonly origen: OrigenBackfillCaja;
  readonly documentoId: string;
  readonly movimiento: CrearMovimientoInput;
  /**
   * La fecha del ORIGEN, siempre presente. Para las filas que el emisor vivo ya fecha es la
   * misma que lleva la fila; para el contra-entrega del cierre —la unica que llega sin fecha—
   * es el ultimo escalon de la cadena de §6.2.
   */
  readonly fechaDeRespaldo: Date;
}

interface Cosecha {
  readonly filas: Candidata[];
  readonly examinados: number;
}

/**
 * R41 — pone la fecha del ORIGEN a la unica fila que llega sin ella. **Aqui no hay reloj**: si
 * lo hubiera, el dinero de julio caeria en el mes en que alguien corrio el script y ningun
 * informe por rango volveria a cuadrar — en silencio y para siempre, porque el libro es
 * inmutable.
 */
function fechar(candidata: Candidata, primerMovimiento: ReadonlyMap<string, Date>): FilaRetroactiva {
  const { origen, documentoId, movimiento } = candidata;
  if (movimiento.fechaMovimiento !== undefined) return { origen, documentoId, movimiento };
  return {
    origen,
    documentoId,
    movimiento: {
      ...movimiento,
      fechaMovimiento: primerMovimiento.get(documentoId) ?? candidata.fechaDeRespaldo,
    },
  };
}

/**
 * Un `IWalletMovimientoRepository` que **no toca la base**: se queda las filas que le mandan
 * escribir y las entrega.
 *
 * Existe para una sola cosa, y no es un atajo de test: la simulacion (R40) tiene que poder
 * decir cuantas filas insertaria, **de que categoria** y por que monto, y el puerto de la Tanda
 * C solo sabe escribir. Montarlo sobre esto es lo que permite obtener sus filas exactas sin
 * escribir ni una — y sin copiar aqui la categoria, el tipo ni la clave de origen que el puerto
 * fija (R23: los fija el, no quien lo llama).
 *
 * Los otros CINCO metodos del contrato LANZAN. Devolver algo plausible seria peor: este
 * repositorio no tiene datos que devolver, y un `[]` silencioso convertiria un error de
 * cableado en un informe vacio que parece correcto.
 */
export class RecolectorDeFilasDeCaja implements IWalletMovimientoRepository {
  private readonly filas: CrearMovimientoInput[] = [];

  async crearMovimientos(tx: WalletTxClient, movs: CrearMovimientoInput[]): Promise<number> {
    void tx; // no escribe: el cliente que le pasen da igual, y decirlo aqui es la mitad del punto
    this.filas.push(...movs);
    return movs.length;
  }

  /** Devuelve lo recogido y se vacia, para que la siguiente emision empiece limpia. */
  vaciar(): CrearMovimientoInput[] {
    return this.filas.splice(0, this.filas.length);
  }

  listar(): Promise<ListarMovimientosPage> {
    throw new ErrorDeRecolector("listar");
  }

  agregarPorCategoriaYTipo(): Promise<readonly AgregadoCajaRow[]> {
    throw new ErrorDeRecolector("agregarPorCategoriaYTipo");
  }

  obtenerPorId(): Promise<WalletMovimientoDTO | null> {
    throw new ErrorDeRecolector("obtenerPorId");
  }

  agregarPorCategoria(): Promise<DesgloseEgresosAgregado> {
    throw new ErrorDeRecolector("agregarPorCategoria");
  }

  /** Ficha 333: quinto metodo que LANZA, por el mismo motivo que los otros cuatro. */
  obtenerPorOrigen(): Promise<WalletMovimientoDTO | null> {
    throw new ErrorDeRecolector("obtenerPorOrigen");
  }
}

class ErrorDeRecolector extends Error {
  constructor(metodo: string) {
    super(
      `RecolectorDeFilasDeCaja no lee la base: \`${metodo}\` no tiene nada que devolver. ` +
        "Si alguien llego aqui, es un error de cableado del backfill, no un caso de negocio.",
    );
    this.name = "ErrorDeRecolector";
  }
}

/**
 * La clave del indice unico parcial de la caja: `(origen_tipo, origen_id, categoria)`. Se lee
 * de la fila —la que emitio el camino vivo— y no se escribe a mano en ningun sitio.
 */
function claveDeOrigen(fila: {
  origenTipo: string;
  origenId: string | null;
  categoria: string;
}): string {
  return `${fila.origenTipo} ${fila.origenId ?? ""} ${fila.categoria}`;
}

interface AcumuladoDeCategoria {
  tipo: ResumenPorCategoria["tipo"];
  categoria: ResumenPorCategoria["categoria"];
  filas: number;
  total: Prisma.Decimal;
}

/**
 * R40 — el desglose del informe: filas y monto total por `(tipo, categoria)`.
 *
 * Money-safe: la suma va con `Prisma.Decimal` y sale como STRING escala 2. El `tipo` y la
 * `categoria` se leen de la fila que emitio el camino vivo; aqui no se declara ninguna.
 */
function agruparPorCategoria(pendientes: readonly FilaRetroactiva[]): ResumenPorCategoria[] {
  const acumulado = new Map<string, AcumuladoDeCategoria>();
  for (const { movimiento } of pendientes) {
    const clave = `${movimiento.tipo} ${movimiento.categoria}`;
    const previo = acumulado.get(clave) ?? {
      tipo: movimiento.tipo,
      categoria: movimiento.categoria,
      filas: 0,
      total: new Prisma.Decimal(0),
    };
    acumulado.set(clave, {
      ...previo,
      filas: previo.filas + 1,
      total: previo.total.plus(movimiento.monto),
    });
  }
  return [...acumulado.values()]
    .map((v) => ({
      tipo: v.tipo,
      categoria: v.categoria,
      filas: v.filas,
      montoTotal: v.total.toFixed(2),
    }))
    .sort((a, b) => a.categoria.localeCompare(b.categoria));
}
