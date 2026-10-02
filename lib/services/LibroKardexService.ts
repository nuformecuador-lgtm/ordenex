import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { ISaldoCorridoCajaRepository } from "@/lib/interfaces/repositories/ISaldoCorridoCajaRepository";
import type { ICajaKardexService } from "@/lib/interfaces/services/ICajaKardexService";
import type { ICuentaKardexService } from "@/lib/interfaces/services/ICuentaKardexService";
import type { DetallarEnLoteInput, IDetalleEnLoteService } from "@/lib/interfaces/services/IDetalleEnLoteService";
import type { IEstadoCuentaService } from "@/lib/interfaces/services/IEstadoCuentaService";
import type { IWalletService } from "@/lib/interfaces/services/IWalletService";
import type { DetalleDeMovimientoLoteDTO, DetalleEnLoteServiceResult } from "@/lib/types/detalle-en-lote";
import type {
  EstadoCuentaCompletoInput,
  EstadoCuentaDTO,
  MiEstadoCuentaCompletoInput,
  VerEstadoCuentaCompletoResult,
} from "@/lib/types/estado-cuenta";
import type {
  CuentaKardexConDetalleServiceResult,
  CuentaKardexServiceResult,
  KardexDTO,
  LibroCajaKardexConDetalleServiceResult,
  LibroCajaKardexServiceResult,
  MontoEnColumna,
} from "@/lib/types/libro-kardex";
import type { ListarLibroCajaCompletoServicioInput, WalletMovimientoDTO } from "@/lib/types/wallet";
import { CATEGORIAS_EFECTIVO, columnaDeCaja } from "@/lib/utils/caja-kardex";
import { derivarCaja } from "@/lib/utils/caja-tesoreria";
import { agruparPorGuia } from "@/lib/utils/detalle-por-guia";
import { kardexDeCuenta } from "@/lib/utils/estado-cuenta-kardex";
import { afirmarCuadreDelKardex, KardexDescuadradoError, totalesDe } from "@/lib/utils/libro-kardex";

/**
 * Ficha 468 (design §3–§4, R5–R16, R26, R33–R46, R53–R57, R61) — el LIBRO DE LA WALLET EN EXCEL: la hoja
 * «Movimientos» como kardex y, si se pide, la hoja «Detalle por guía» agrupada, en UNA lectura.
 *
 * ORQUESTAN, NO DERIVAN. La hoja de movimientos la lee el servicio de SIEMPRE (`listarMovimientosCompleto`
 * / `leerCompleto` / `leerMiTiendaCompleto`, con su guard de rol antes de la base y su tope); el detalle lo
 * da el lote de la 464 (`DetalleEnLoteService`) con el catalogo de reparto unico. Lo propio de aqui:
 *
 *  - FORZAR el orden cronologico ascendente (R7): un saldo corrido solo se lee de la mas antigua a la mas
 *    reciente, asi que el archivo no hereda el «Más recientes» de la pantalla;
 *  - colocar cada importe en su columna y sumar las columnas (puras: `columnaDeCaja`, `kardexDeCuenta`);
 *  - en la caja, leer el saldo corrido (que antes no existia) y AFIRMAR que casa con la tarjeta;
 *  - pedir los conteos (sin detalle) o el detalle (con detalle) y agrupar por guia, que AFIRMA R45.
 *
 * La hoja «Movimientos» es la MISMA en los dos modos (R57): mismos movimientos, mismo kardex; el «N
 * guía(s)» sale de los conteos o de la hoja 2, que usan el MISMO `WHERE`.
 *
 * Desviacion del design §4.3, declarada: en vez de cambiar la forma de `listarMovimientosCompleto` y de
 * renombrar los orquestadores de la 464, estas son clases NUEVAS (los de la 464 siguen vivos hasta que el
 * cliente se cablee a estas y se retiren). Asi el arbol compila y la suite sigue verde entre el bloque de
 * servidor y el de pantalla.
 */

/** Las dos lecturas de la caja que el kardex necesita: las cifras agregadas y el saldo corrido. */
export type SaldosDeCaja = Pick<IWalletMovimientoRepository, "agregarPorCategoriaYTipo"> & ISaldoCorridoCajaRepository;

/**
 * Las lecturas de la caja (filas, cifras de la tarjeta y saldo corrido) no comparten transaccion: un
 * movimiento registrado ENTRE dos de ellas descuadra el kardex sin que el dinero este mal (es el mismo
 * fallo intermitente que la 458-B cerro en el estado de cuenta con REPEATABLE READ). Se repite la lectura
 * entera hasta este numero de veces; si sigue sin cuadrar, la divergencia es real y se lanza.
 */
const INTENTOS_DE_LECTURA_CAJA = 3;

/** El orden del kardex: cronologico ascendente, el orden total de siempre (fecha, creacion, id). */
const CRONOLOGICO = { sortBy: "fecha", sortDir: "asc" } as const;

type LecturaDeCaja =
  | { status: "ok"; items: WalletMovimientoDTO[]; total: number; montos: MontoEnColumna[]; kardex: Omit<KardexDTO, "filas"> & { filas: Array<Omit<KardexDTO["filas"][number], "ordenes">> } }
  | { status: "limite_excedido"; hoja: "movimientos"; total: number; limite: number }
  | { status: "forbidden" };

export class CajaKardexService implements ICajaKardexService {
  constructor(
    private readonly caja: Pick<IWalletService, "listarMovimientosCompleto">,
    // Sin opcionales (memoria «el composition root que no inyecta»): sin el saldo corrido no hay kardex.
    private readonly saldos: SaldosDeCaja,
    private readonly detalleEnLote: IDetalleEnLoteService,
  ) {}

  async kardex(input: ListarLibroCajaCompletoServicioInput, actor: Actor): Promise<LibroCajaKardexServiceResult> {
    const r = await this.leer(input, actor);
    if (r.status !== "ok") return r;
    // R61: SOLO los conteos; ninguna fila de ordenes.
    const c = await this.detalleEnLote.contar(entradaDelLote(r.items), actor);
    if (c.status !== "ok") return c;
    return { status: "ok", items: r.items, total: r.total, kardex: conOrdenes(r.kardex, c.ordenes) };
  }

  async kardexConDetalle(
    input: ListarLibroCajaCompletoServicioInput,
    actor: Actor,
  ): Promise<LibroCajaKardexConDetalleServiceResult> {
    const r = await this.leer(input, actor);
    if (r.status !== "ok") return r;
    const d = await this.detalleEnLote.detallar(entradaDelLote(r.items), actor);
    if (d.status !== "ok") return conHojaDetalle(d);
    const kardex = conOrdenes(r.kardex, ordenesDelDetalle(r.items.map((m) => m.id), d.detalle));
    const porGuia = agruparPorGuia({
      movimientos: r.items.map((m, i) => ({ id: m.id, monto: r.montos[i] })),
      detalle: d.detalle,
      totalesHoja1: kardex.totales,
    });
    return { status: "ok", items: r.items, total: r.total, kardex, porGuia };
  }

  /**
   * La hoja de movimientos (orden forzado) y su kardex sin conteos. El guard y el tope son los de
   * `listarMovimientosCompleto`, que corre ANTES de leer ninguna cifra.
   */
  private async leer(input: ListarLibroCajaCompletoServicioInput, actor: Actor): Promise<LecturaDeCaja> {
    for (let intento = 1; ; intento += 1) {
      try {
        return await this.leerUnaVez(input, actor);
      } catch (e) {
        if (!(e instanceof KardexDescuadradoError) || intento >= INTENTOS_DE_LECTURA_CAJA) throw e;
      }
    }
  }

  private async leerUnaVez(input: ListarLibroCajaCompletoServicioInput, actor: Actor): Promise<LecturaDeCaja> {
    const r = await this.caja.listarMovimientosCompleto({ ...input, ...CRONOLOGICO }, actor);
    if (r.status === "limite_excedido") return { ...r, hoja: "movimientos" };
    if (r.status !== "ok") return r;

    // R14 — el saldo de la caja con todo lo anterior al periodo, y con todo hasta su final. La MISMA
    // funcion y la MISMA lectura que la tarjeta (`derivarCaja(...).enCaja`); `hasta` es exclusivo.
    const saldoInicial =
      input.desde === undefined ? "0.00" : derivarCaja(await this.saldos.agregarPorCategoriaYTipo({ hasta: input.desde })).enCaja;
    const saldoFinal = derivarCaja(
      await this.saldos.agregarPorCategoriaYTipo(input.hasta === undefined ? {} : { hasta: input.hasta }),
    ).enCaja;
    // R12 — el saldo de la caja ENTERA tras cada fila, con la clasificacion de liquidez de la tarjeta.
    const saldos = await this.saldos.saldosTrasMovimientos(
      r.items.map((m) => m.id),
      CATEGORIAS_EFECTIVO,
      input.hasta,
    );
    const montos = r.items.map((m) => columnaDeCaja(m));
    const filas = r.items.map((m, i) => {
      const saldo = saldos.get(m.id);
      if (saldo === undefined) throw new Error("libro de caja: un movimiento de la hoja no tiene saldo corrido");
      return { monto: montos[i], saldo };
    });
    const conOtrosFiltros =
      input.tipo !== undefined || input.categoria !== undefined || input.aQuien !== undefined || input.q !== undefined;
    const kardex = { saldoInicial, saldoFinal, totales: totalesDe(montos, true), conOtrosFiltros, filas };
    // R12/R15 — atadura con la tarjeta en tiempo de ejecucion: si la ventana y `derivarCaja` divergieran
    // (una categoria clasificada distinto), la descarga falla ruidosa en vez de entregar otro saldo.
    if (!conOtrosFiltros) afirmarCuadreDelKardex(kardex, "libro de caja");
    return { status: "ok", items: r.items, total: r.total, montos, kardex };
  }
}

export class CuentaKardexService implements ICuentaKardexService {
  constructor(
    private readonly estadoCuenta: Pick<IEstadoCuentaService, "leerCompleto" | "leerMiTiendaCompleto">,
    private readonly detalleEnLote: IDetalleEnLoteService,
  ) {}

  async kardex(input: EstadoCuentaCompletoInput, actor: Actor): Promise<CuentaKardexServiceResult> {
    const r = comoHoja(await this.estadoCuenta.leerCompleto({ ...input, ...CRONOLOGICO }, actor));
    if (r.status !== "ok") return r;
    return this.conConteos(r.estado, conOtrosFiltrosDeCuenta(input), entradaDeCuenta(r.estado, "oficina"), actor);
  }

  async kardexConDetalle(input: EstadoCuentaCompletoInput, actor: Actor): Promise<CuentaKardexConDetalleServiceResult> {
    // R25 — la bodega satelite no tiene detalle por guia (su libro son consolidaciones). El borde ya lo
    // rechaza; se repite aqui, sin leer nada.
    if (input.cuenta.tipo === "bodega") {
      return {
        status: "validation_error",
        fieldErrors: { cuenta: ["El detalle por guía no existe en el estado de cuenta de una bodega satélite."] },
      };
    }
    const r = comoHoja(await this.estadoCuenta.leerCompleto({ ...input, ...CRONOLOGICO }, actor));
    if (r.status !== "ok") return r;
    return this.conDetalle(r.estado, conOtrosFiltrosDeCuenta(input), entradaDeCuenta(r.estado, "oficina"), actor);
  }

  async miKardex(input: MiEstadoCuentaCompletoInput, actor: Actor): Promise<CuentaKardexServiceResult> {
    const r = comoHoja(await this.estadoCuenta.leerMiTiendaCompleto({ ...input, ...CRONOLOGICO }, actor));
    if (r.status !== "ok") return r;
    return this.conConteos(r.estado, conOtrosFiltrosDeCuenta(input), entradaDeCuenta(r.estado, "mi_wallet"), actor);
  }

  async miKardexConDetalle(
    input: MiEstadoCuentaCompletoInput,
    actor: Actor,
  ): Promise<CuentaKardexConDetalleServiceResult> {
    const r = comoHoja(await this.estadoCuenta.leerMiTiendaCompleto({ ...input, ...CRONOLOGICO }, actor));
    if (r.status !== "ok") return r;
    return this.conDetalle(r.estado, conOtrosFiltrosDeCuenta(input), entradaDeCuenta(r.estado, "mi_wallet"), actor);
  }

  private async conConteos(
    estado: EstadoCuentaDTO,
    conOtrosFiltros: boolean,
    lote: DetallarEnLoteInput | null,
    actor: Actor,
  ): Promise<CuentaKardexServiceResult> {
    // La bodega no tiene repartibles: no se pide ningun conteo.
    if (lote === null) return { status: "ok", estado, kardex: kardexDeCuenta(estado, conOtrosFiltros, estado.filas.map(() => null)) };
    const c = await this.detalleEnLote.contar(lote, actor);
    if (c.status !== "ok") return c;
    return { status: "ok", estado, kardex: kardexDeCuenta(estado, conOtrosFiltros, c.ordenes) };
  }

  private async conDetalle(
    estado: EstadoCuentaDTO,
    conOtrosFiltros: boolean,
    lote: DetallarEnLoteInput | null,
    actor: Actor,
  ): Promise<CuentaKardexConDetalleServiceResult> {
    if (lote === null) throw new Error("estado de cuenta: el detalle por guia no existe en una bodega");
    const d = await this.detalleEnLote.detallar(lote, actor);
    if (d.status !== "ok") return conHojaDetalle(d);
    const ids = idsDelLibro(estado);
    const kardex = kardexDeCuenta(estado, conOtrosFiltros, ordenesDelDetalle(ids, d.detalle));
    const porGuia = agruparPorGuia({
      movimientos: ids.map((id, i) => ({ id, monto: kardex.filas[i].monto })),
      detalle: d.detalle,
      totalesHoja1: kardex.totales,
    });
    return { status: "ok", estado, kardex, porGuia };
  }
}

/** Los movimientos de la caja tal como los necesita el lote (lo minimo para decidir su fuente). */
function entradaDelLote(items: readonly WalletMovimientoDTO[]): DetallarEnLoteInput {
  return {
    superficie: "caja",
    movimientos: items.map((m) => ({
      id: m.id,
      categoria: m.categoria,
      monto: m.monto,
      origenTipo: m.origenTipo,
      origenId: m.origenId,
    })),
  };
}

/**
 * El lote de un estado de cuenta: la cuenta sale de lo que el servidor YA leyo (nunca de la entrada). La
 * bodega no tiene lote (`null`).
 */
function entradaDeCuenta(estado: EstadoCuentaDTO, vista: "oficina" | "mi_wallet"): DetallarEnLoteInput | null {
  if (estado.cuenta.tipo === "bodega") return null; // sus filas son consolidaciones, sin libro ni guias
  const movimientoIds = idsDelLibro(estado);
  if (vista === "mi_wallet") return { superficie: "mi_wallet", movimientoIds };
  if (estado.cuenta.tipo === "tienda") return { superficie: "tienda_oficina", tiendaId: estado.cuenta.id, movimientoIds };
  if (estado.cuenta.tipo === "mensajero") {
    return { superficie: "mensajero_oficina", mensajeroId: estado.cuenta.id, movimientoIds };
  }
  return null;
}

/**
 * Los ids del libro (tienda o mensajero) de cada fila, en su orden. Todas las filas de una tienda o de un
 * mensajero llevan `ref` de libro; si una no lo llevara, la alineacion con el kardex se romperia y se
 * lanza.
 */
function idsDelLibro(estado: EstadoCuentaDTO): string[] {
  return estado.filas.map((fila) => {
    if (fila.ref === null || !("libro" in fila.ref)) {
      throw new Error("estado de cuenta: una fila sin movimiento de libro no puede ir al detalle");
    }
    return fila.ref.movimientoId;
  });
}

/** R18 — cuantas ordenes de cada movimiento, sacadas de la hoja 2 (mismo `WHERE` que los conteos). */
function ordenesDelDetalle(ids: readonly string[], detalle: readonly DetalleDeMovimientoLoteDTO[]): (number | null)[] {
  const porId = new Map(detalle.map((d) => [d.movimientoId, d]));
  return ids.map((id) => {
    const d = porId.get(id);
    if (d === undefined) throw new Error("libro kardex: un movimiento de la hoja no tiene detalle");
    return d.modo === "ordenes" ? d.ordenes.length : null;
  });
}

function conOrdenes(
  kardex: Omit<KardexDTO, "filas"> & { filas: Array<Omit<KardexDTO["filas"][number], "ordenes">> },
  ordenes: readonly (number | null)[],
): KardexDTO {
  if (ordenes.length !== kardex.filas.length) throw new Error("libro kardex: conteos no alineados con las filas");
  return { ...kardex, filas: kardex.filas.map((f, i) => ({ ...f, ordenes: ordenes[i] })) };
}

/** R16 — otros filtros ademas del periodo en un estado de cuenta: chip, cierre o termino. */
function conOtrosFiltrosDeCuenta(input: { chip?: unknown; cierreId?: unknown; q?: unknown }): boolean {
  return input.chip !== undefined || input.cierreId !== undefined || input.q !== undefined;
}

/** El completo de un estado de cuenta, con `hoja` en el tope (el aviso del cliente lo necesita). */
function comoHoja(
  r: Exclude<VerEstadoCuentaCompletoResult, { status: "unauthenticated" }>,
):
  | Exclude<VerEstadoCuentaCompletoResult, { status: "unauthenticated" } | { status: "limite_excedido" }>
  | { status: "limite_excedido"; hoja: "movimientos"; total: number; limite: number } {
  return r.status === "limite_excedido" ? { ...r, hoja: "movimientos" } : r;
}

/** `limite_excedido` del DETALLE gana `hoja: "detalle"`; `forbidden` pasa tal cual. */
function conHojaDetalle(
  d: Exclude<DetalleEnLoteServiceResult, { status: "ok" }>,
): { status: "limite_excedido"; hoja: "detalle"; total: number; limite: number } | { status: "forbidden" } {
  return d.status === "limite_excedido" ? { ...d, hoja: "detalle" } : d;
}
