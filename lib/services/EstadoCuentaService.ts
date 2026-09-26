import { Prisma } from "@prisma/client";

import { esAccesoTotal } from "@/lib/auth/acceso-total";
import type {
  AnulacionLeida,
  FilaDeLibroRow,
  IEstadoCuentaRepository,
  MovimientoDelPeriodoRow,
  ParDeChip,
  TipoDeDocumentoDeLibro,
} from "@/lib/interfaces/repositories/IEstadoCuentaRepository";
import type { IRechazoTiendaCobroAnulacionRepository } from "@/lib/interfaces/repositories/IRechazoTiendaCobroAnulacionRepository";
import type { IEstadoCuentaService, VerEstadoCuentaServiceResult } from "@/lib/interfaces/services/IEstadoCuentaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AnulacionDeFilaDTO,
  EstadoCuentaInput,
  FilaEstadoCuentaDTO,
  RegistroDTO,
  SentidoDelSaldo,
  TipoDeCuenta,
} from "@/lib/types/estado-cuenta";
import type { WalletOrigenTipo } from "@/lib/types/wallet";
import type { PagoMensajeroMovimientoCategoria } from "@/lib/types/wallet-mensajero";
import type { WalletTiendaMovimientoCategoria } from "@/lib/types/wallet-tienda";
import { saldoDe } from "@/lib/utils/conciliacion-satelite";
import { derivarCuentaPorPagar } from "@/lib/utils/cuenta-por-pagar";
import {
  claveDeParMensajero,
  claveDeParTienda,
  paresDeChipBodega,
  paresDeChipMensajero,
  paresDeChipTienda,
  saldoAlFinal,
  totalesNetos,
} from "@/lib/utils/estado-cuenta";
import {
  CHIPS_BODEGA,
  CHIPS_MENSAJERO,
  CHIPS_TIENDA,
  chipDeMensajero,
  chipDeTienda,
  type ChipBodega,
  type ChipEstadoCuenta,
  type ChipMensajero,
  type ChipTienda,
} from "@/lib/utils/estado-cuenta-chips";
import { fechaCalendarioCR, inicioDelDiaCREnUtc, inicioDelDiaSiguienteCREnUtc } from "@/lib/utils/fecha-cr";
import { derivarSaldoTienda } from "@/lib/utils/saldo-tienda";
import { fechaDiaMovimientoCR } from "@/lib/utils/fecha-dia-iso";

/** El documento de una fila ORIGINAL de un libro de cuenta: por donde se anula y se lee su estado. */
type DocumentoDeFila =
  | { tipo: TipoDeDocumentoDeLibro; id: string }
  | { tipo: "rechazo_tienda_cobro"; gestionId: string }
  | { tipo: "premio"; dia: Date };

/** R71 — el documento de una fila ORIGINAL del libro de la tienda (los contra-asientos llevan `null`). */
function documentoDeTienda(f: FilaDeLibroRow): DocumentoDeFila | null {
  const c = f.categoria as WalletTiendaMovimientoCategoria;
  if (c === "cobro_manual") return { tipo: "cobro_tienda", id: f.id };
  if (f.origenId === null) return null;
  if (c === "pago_tienda" && f.origenTipo === "pago_tienda") return { tipo: "liquidacion_pago", id: f.origenId };
  if (c === "pago_por_cuenta" && f.origenTipo === "pago_por_cuenta_tienda") {
    return { tipo: "pago_por_cuenta_tienda", id: f.origenId };
  }
  if (c === "abono_tienda" && f.origenTipo === "abono_tienda") return { tipo: "abono_tienda", id: f.origenId };
  if ((c === "flete_devolucion" || c === "iva_flete_devolucion") && f.origenTipo === "gestion_orden") {
    return { tipo: "rechazo_tienda_cobro", gestionId: f.origenId };
  }
  return null;
}

/** R71 — el documento de una fila ORIGINAL del libro del mensajero. */
function documentoDeMensajero(f: FilaDeLibroRow): DocumentoDeFila | null {
  const c = f.categoria as PagoMensajeroMovimientoCategoria;
  if (c === "liquidacion" && f.origenTipo === "pago_mensajero" && f.origenId !== null) {
    return { tipo: "liquidacion_pago", id: f.origenId };
  }
  // El premio (293) se reconoce por `premio_dia`, que solo llevan el premio (devengo) y su reverso (pago).
  if (f.premioDia !== null && f.tipo === "devengo") return { tipo: "premio", dia: f.premioDia };
  return null;
}

function claveDeDocumento(d: DocumentoDeFila): string {
  if (d.tipo === "rechazo_tienda_cobro") return `rechazo:${d.gestionId}`;
  if (d.tipo === "premio") return `premio:${d.dia.toISOString()}`;
  return `${d.tipo}:${d.id}`;
}

function signoDe(saldo: string): "positivo" | "negativo" | "cero" {
  const s = new Prisma.Decimal(saldo);
  return s.gt(0) ? "positivo" : s.lt(0) ? "negativo" : "cero";
}

function aAnulacion(a: AnulacionLeida): AnulacionDeFilaDTO {
  return { motivo: a.motivo, por: a.anuladoPorNombre, fecha: fechaCalendarioCR(a.fecha) };
}

/**
 * FICHA 458-B (design §3.2, R16–R25, R81) — el ESTADO DE CUENTA. No deriva dinero nuevo: el saldo
 * actual y el inicial salen de la MISMA funcion que hoy deriva el saldo de cada cuenta
 * (`derivarSaldoTienda`, `derivarCuentaPorPagar`, `saldoDe`), y el corrido lo calcula la base con una
 * ventana (`EstadoCuentaRepository`). Lo propio de este servicio es el orden de las lecturas, los
 * totales netos del periodo (D3, `totalesNetos`) y afirmar R22 antes de responder.
 */
export class EstadoCuentaService implements IEstadoCuentaService {
  constructor(
    private readonly repo: IEstadoCuentaRepository,
    private readonly rechazos: Pick<IRechazoTiendaCobroAnulacionRepository, "estadoPorGestion">,
  ) {}

  async leer(input: EstadoCuentaInput, actor: Actor): Promise<VerEstadoCuentaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R81: antes de leer

    const { tipo, id } = input.cuenta;
    const pares = this.paresDelChip(tipo, input.chip);
    if (pares === "chip_ajeno") {
      return { status: "validation_error", fieldErrors: { chip: ["Ese filtro no es de este tipo de cuenta."] } };
    }

    const nombre = await this.repo.nombreDeCuenta(tipo, id);
    if (nombre === null) return { status: "no_encontrado" }; // R81: inexistente o de otro papel, igual

    const desdeUtc = input.desde === undefined ? undefined : inicioDelDiaCREnUtc(input.desde); // R16
    const hastaUtc = input.hasta === undefined ? undefined : inicioDelDiaSiguienteCREnUtc(input.hasta);
    const ventana = {
      desdeUtc,
      hastaUtc,
      pares,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    };

    const lectura =
      tipo === "tienda"
        ? await this.leerTienda(id, ventana)
        : tipo === "mensajero"
          ? await this.leerMensajero(id, ventana)
          : await this.leerBodega(id, ventana);

    // R22 — lo que se enseña TIENE que cuadrar. Sin `hasta` el periodo termina hoy y el final es el
    // saldo actual de la cuenta, el mismo que el listado y la tarjeta.
    const saldoFinal = saldoAlFinal(
      lectura.saldoInicial,
      lectura.abonos,
      lectura.cargos,
      tipo === "bodega" ? "por_entregar" : "a_favor_del_titular",
    );
    if (hastaUtc === undefined && saldoFinal !== lectura.saldoActual) {
      throw new Error(
        `estado de cuenta (${tipo}): R22 no cuadra — inicial ${lectura.saldoInicial}, abonos ${lectura.abonos}, cargos ${lectura.cargos}, final ${saldoFinal}, actual ${lectura.saldoActual}`,
      );
    }

    return {
      status: "ok",
      estado: {
        cuenta: { tipo, id, nombre },
        saldoActual: lectura.saldoActual,
        signo: signoDe(lectura.saldoActual),
        sentido: sentidoDe(tipo, lectura.saldoActual),
        saldoInicial: lectura.saldoInicial,
        abonos: lectura.abonos,
        cargos: lectura.cargos,
        saldoFinal,
        filas: lectura.filas,
        total: lectura.total,
        page: input.page,
        pageSize: input.pageSize,
      },
    };
  }

  /** El filtro del chip (`null` = «Todo»), o `chip_ajeno` si no es de ese tipo de cuenta. */
  private paresDelChip(tipo: TipoDeCuenta, chip?: ChipEstadoCuenta): ParDeChip[] | null | "chip_ajeno" {
    if (chip === undefined) return null;
    if (tipo === "tienda") {
      return (CHIPS_TIENDA as readonly string[]).includes(chip) ? paresDeChipTienda(chip as ChipTienda) : "chip_ajeno";
    }
    if (tipo === "mensajero") {
      return (CHIPS_MENSAJERO as readonly string[]).includes(chip)
        ? paresDeChipMensajero(chip as ChipMensajero)
        : "chip_ajeno";
    }
    return (CHIPS_BODEGA as readonly string[]).includes(chip) ? paresDeChipBodega(chip as ChipBodega) : "chip_ajeno";
  }

  // ── Tienda ──────────────────────────────────────────────────────────────────────────────────

  private async leerTienda(tiendaId: string, v: Ventana): Promise<Lectura> {
    const pagina = await this.repo.paginaDeTienda(tiendaId, v);
    const actual = await this.repo.totalesDeTienda(tiendaId);
    const antes = v.desdeUtc === undefined ? null : await this.repo.totalesDeTienda(tiendaId, v.desdeUtc);
    const periodo = await this.repo.periodoDeTienda(tiendaId, v.desdeUtc, v.hastaUtc);
    const totales = totalesNetos(periodo, claveDeParTienda, (m: MovimientoDelPeriodoRow) => m.tipo === "credito");
    const documentos = pagina.filas.map(documentoDeTienda);
    const estados = await this.estadosDeDocumentos(documentos, null);
    const aprobadores = await this.repo.quienAproboLosCierres(cierresDe(pagina.filas));
    return {
      saldoActual: derivarSaldoTienda(actual.creditos, actual.debitos).saldo,
      saldoInicial: antes === null ? "0.00" : derivarSaldoTienda(antes.creditos, antes.debitos).saldo,
      ...totales,
      total: pagina.total,
      filas: pagina.filas.map((f, i) =>
        this.fila(f, {
          libro: "tienda",
          esAbono: f.tipo === "credito",
          chip: chipDeTienda(f.categoria as WalletTiendaMovimientoCategoria, f.origenTipo as WalletOrigenTipo),
          esContra: claveDeParTienda(f)?.esContra ?? false,
          documento: documentos[i],
          estados,
          aprobadores,
        }),
      ),
    };
  }

  // ── Mensajero ───────────────────────────────────────────────────────────────────────────────

  private async leerMensajero(mensajeroId: string, v: Ventana): Promise<Lectura> {
    const pagina = await this.repo.paginaDeMensajero(mensajeroId, v);
    const actual = await this.repo.totalesDeMensajero(mensajeroId);
    const antes = v.desdeUtc === undefined ? null : await this.repo.totalesDeMensajero(mensajeroId, v.desdeUtc);
    const periodo = await this.repo.periodoDeMensajero(mensajeroId, v.desdeUtc, v.hastaUtc);
    const totales = totalesNetos(periodo, claveDeParMensajero, (m: MovimientoDelPeriodoRow) => m.tipo === "devengo");
    const documentos = pagina.filas.map(documentoDeMensajero);
    const estados = await this.estadosDeDocumentos(documentos, mensajeroId);
    const aprobadores = await this.repo.quienAproboLosCierres(cierresDe(pagina.filas));
    return {
      saldoActual: derivarCuentaPorPagar(actual.devengado, actual.pagado).cuentaPorPagar,
      saldoInicial: antes === null ? "0.00" : derivarCuentaPorPagar(antes.devengado, antes.pagado).cuentaPorPagar,
      ...totales,
      total: pagina.total,
      filas: pagina.filas.map((f, i) =>
        this.fila(f, {
          libro: "mensajero",
          esAbono: f.tipo === "devengo",
          chip: chipDeMensajero(
            f.categoria as PagoMensajeroMovimientoCategoria,
            f.origenTipo as WalletOrigenTipo,
            f.premioDia !== null,
          ),
          esContra: claveDeParMensajero(f)?.esContra ?? false,
          documento: documentos[i],
          estados,
          aprobadores,
        }),
      ),
    };
  }

  // ── Bodega ──────────────────────────────────────────────────────────────────────────────────

  private async leerBodega(zonaId: string, v: Ventana): Promise<Lectura> {
    const pagina = await this.repo.paginaDeBodega(zonaId, v);
    const actual = await this.repo.totalesDeBodega(zonaId);
    const antes = v.desdeUtc === undefined ? null : await this.repo.totalesDeBodega(zonaId, v.desdeUtc);
    const periodo = await this.repo.periodoDeBodega(zonaId, v.desdeUtc, v.hastaUtc);
    // En la bodega el «abono» es lo RECIBIDO (baja lo que tiene por entregar); no hay pares anulados.
    const totales = totalesNetos(periodo, () => null, (m) => m.tipo === "recibido");
    const cero = new Prisma.Decimal(0);
    const pendiente = (t: { efectivo: string; recibido: string }) =>
      saldoDe(new Prisma.Decimal(t.efectivo), new Prisma.Decimal(t.recibido)).toFixed(2);
    return {
      saldoActual: pendiente(actual),
      saldoInicial: antes === null ? cero.toFixed(2) : pendiente(antes),
      ...totales,
      total: pagina.total,
      filas: pagina.filas.map((f) => ({
        ref: null,
        consolidacionId: f.origenId,
        fecha: fechaDiaMovimientoCR(f.fechaMovimiento.toISOString()),
        categoria: f.categoria,
        origenTipo: f.origenTipo,
        descripcion: f.descripcion,
        registro: { nombre: f.registradoPorNombre, automatico: null },
        cargo: f.tipo === "declarado" ? f.monto : null,
        abono: f.tipo === "recibido" ? f.monto : null,
        saldoCorrido: f.saldoCorrido,
        chip: f.tipo as ChipBodega,
        anulacion: null,
        esContraAsiento: false,
        tieneComprobante: false,
        anulable: false,
        naceDeUnCierre: false,
      })),
    };
  }

  // ── Comun ───────────────────────────────────────────────────────────────────────────────────

  /**
   * R25/R71 — el estado de anulacion y el comprobante de los documentos de la pagina, EN LOTE: una
   * consulta por tipo de documento presente. Clave: `claveDeDocumento`.
   */
  private async estadosDeDocumentos(
    documentos: (DocumentoDeFila | null)[],
    mensajeroId: string | null,
  ): Promise<Map<string, { anulacion: AnulacionDeFilaDTO | null; tieneComprobante: boolean }>> {
    const estados = new Map<string, { anulacion: AnulacionDeFilaDTO | null; tieneComprobante: boolean }>();
    const tipos: TipoDeDocumentoDeLibro[] = ["liquidacion_pago", "cobro_tienda", "pago_por_cuenta_tienda", "abono_tienda"];
    for (const tipo of tipos) {
      const ids = [
        ...new Set(
          documentos.flatMap((d) => (d !== null && d.tipo === tipo && "id" in d ? [d.id] : [])),
        ),
      ];
      if (ids.length === 0) continue;
      const anulaciones = new Map((await this.repo.anulacionesDe(tipo, ids)).map((a) => [a.documentoId, a]));
      const comprobantes = await this.repo.conComprobante(tipo, ids);
      for (const id of ids) {
        const a = anulaciones.get(id);
        estados.set(`${tipo}:${id}`, {
          anulacion: a === undefined ? null : aAnulacion(a),
          tieneComprobante: comprobantes.has(id),
        });
      }
    }
    const gestiones = [
      ...new Set(documentos.flatMap((d) => (d !== null && d.tipo === "rechazo_tienda_cobro" ? [d.gestionId] : []))),
    ];
    if (gestiones.length > 0) {
      for (const e of await this.rechazos.estadoPorGestion(gestiones)) {
        estados.set(`rechazo:${e.gestionId}`, {
          anulacion:
            e.anulacion === null
              ? null
              : { motivo: e.anulacion.motivo, por: e.anulacion.anuladoPorNombre, fecha: fechaCalendarioCR(e.anulacion.createdAt) },
          tieneComprobante: false,
        });
      }
    }
    const dias = documentos.flatMap((d) => (d !== null && d.tipo === "premio" ? [d.dia] : []));
    if (mensajeroId !== null && dias.length > 0) {
      const reversos = new Map((await this.repo.reversosDePremio(mensajeroId, dias)).map((r) => [r.documentoId, r]));
      for (const dia of dias) {
        const r = reversos.get(dia.toISOString());
        estados.set(`premio:${dia.toISOString()}`, { anulacion: r === undefined ? null : aAnulacion(r), tieneComprobante: false });
      }
    }
    return estados;
  }

  private fila(
    f: FilaDeLibroRow,
    c: {
      libro: "tienda" | "mensajero";
      esAbono: boolean;
      chip: ChipEstadoCuenta;
      esContra: boolean;
      documento: DocumentoDeFila | null;
      estados: Map<string, { anulacion: AnulacionDeFilaDTO | null; tieneComprobante: boolean }>;
      aprobadores: Map<string, string | null>;
    },
  ): FilaEstadoCuentaDTO {
    const naceDeUnCierre = f.origenTipo === "cierre_dia" && !(c.libro === "mensajero" && f.premioDia !== null);
    const estado = c.documento === null ? undefined : c.estados.get(claveDeDocumento(c.documento));
    const anulacion = estado?.anulacion ?? null;
    return {
      ref: { libro: c.libro, movimientoId: f.id },
      consolidacionId: null,
      fecha: fechaDiaMovimientoCR(f.fechaMovimiento.toISOString()),
      categoria: f.categoria,
      origenTipo: f.origenTipo,
      descripcion: f.descripcion,
      registro: registroDe(f, c.aprobadores),
      cargo: c.esAbono ? null : f.monto,
      abono: c.esAbono ? f.monto : null,
      saldoCorrido: f.saldoCorrido,
      chip: c.chip,
      anulacion,
      esContraAsiento: c.esContra,
      tieneComprobante: estado?.tieneComprobante ?? false,
      // R65: original con documento, vigente, y no producido por un cierre.
      anulable: c.documento !== null && anulacion === null && !naceDeUnCierre,
      naceDeUnCierre,
    };
  }
}

type Ventana = {
  desdeUtc?: Date;
  hastaUtc?: Date;
  pares: ParDeChip[] | null;
  skip: number;
  take: number;
};

type Lectura = {
  saldoActual: string;
  saldoInicial: string;
  abonos: string;
  cargos: string;
  total: number;
  filas: FilaEstadoCuentaDTO[];
};

function cierresDe(filas: readonly FilaDeLibroRow[]): string[] {
  return [
    ...new Set(
      filas.flatMap((f) => (f.origenTipo === "cierre_dia" && f.registradoPor === null && f.origenId !== null ? [f.origenId] : [])),
    ),
  ];
}

/** R57 — una persona, o la accion automatica que produjo la fila (con quien la decidio, si se sabe). */
function registroDe(f: FilaDeLibroRow, aprobadores: Map<string, string | null>): RegistroDTO {
  if (f.registradoPor !== null) return { nombre: f.registradoPorNombre, automatico: null };
  if (f.origenTipo === "cierre_dia") {
    return {
      nombre: null,
      automatico: { accion: "aprobacion_cierre", por: f.origenId === null ? null : (aprobadores.get(f.origenId) ?? null) },
    };
  }
  return { nombre: null, automatico: { accion: "sistema", por: null } };
}

/** R18 — quien le debe a quien, segun el tipo de cuenta y el signo del saldo. */
function sentidoDe(tipo: TipoDeCuenta, saldo: string): SentidoDelSaldo {
  const s = new Prisma.Decimal(saldo);
  if (s.isZero()) return "en_cero";
  if (tipo === "bodega") return s.gt(0) ? "por_entregar" : "ordenex_debe";
  return s.gt(0) ? "ordenex_debe" : "cuenta_debe";
}
