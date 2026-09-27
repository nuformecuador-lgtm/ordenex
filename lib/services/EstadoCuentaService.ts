import { Prisma } from "@prisma/client";

import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { descargaConfig } from "@/lib/config/descarga";
import type {
  AnulacionLeida,
  FilaDeLibroRow,
  IEstadoCuentaRepository,
  MovimientoDelPeriodoRow,
  PagoDeDocumento,
  ParDeChip,
  TipoDeDocumentoDeLibro,
  TipoDeDocumentoDePago,
} from "@/lib/interfaces/repositories/IEstadoCuentaRepository";
import type { IRechazoTiendaCobroAnulacionRepository } from "@/lib/interfaces/repositories/IRechazoTiendaCobroAnulacionRepository";
import type {
  IEstadoCuentaService,
  VerEstadoCuentaCompletoServiceResult,
  VerEstadoCuentaServiceResult,
} from "@/lib/interfaces/services/IEstadoCuentaService";
import type { IOrigenLegibleService } from "@/lib/interfaces/services/IOrigenLegibleService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  AnulacionDeFilaDTO,
  EstadoCuentaCompletoInput,
  EstadoCuentaInput,
  FilaEstadoCuentaDTO,
  MiEstadoCuentaCompletoInput,
  MiEstadoCuentaInput,
  RegistroDTO,
  SentidoDelSaldo,
  TipoDeCuenta,
} from "@/lib/types/estado-cuenta";
import type { WalletOrigenTipo } from "@/lib/types/wallet";
import type { LibroWallet } from "@/lib/types/wallet-origen";
import type { PagoMensajeroMovimientoCategoria } from "@/lib/types/wallet-mensajero";
import type { DesgloseTiendaDTO, WalletTiendaMovimientoCategoria } from "@/lib/types/wallet-tienda";
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
import { derivarDesgloseTienda } from "@/lib/utils/desglose-tienda";
import { fechaDiaMovimientoCR } from "@/lib/utils/fecha-dia-iso";
import { horaCostaRica } from "@/lib/utils/hora-cr";

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
  return { motivo: a.motivo, por: a.anuladoPorNombre, fecha: fechaCalendarioCR(a.fecha), hora: horaCostaRica(a.fecha.toISOString()) };
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
    // FICHA 458-D (servidor, R6–R8) — el origen con entidad y enlace de cada fila, EN LOTE (458-A).
    private readonly origenes: Pick<IOrigenLegibleService, "resolver">,
  ) {}

  async leer(input: EstadoCuentaInput, actor: Actor): Promise<VerEstadoCuentaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R81: antes de leer
    return this.leerCuenta(input, actor, "oficina");
  }

  async leerCompleto(input: EstadoCuentaCompletoInput, actor: Actor): Promise<VerEstadoCuentaCompletoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R81: antes de leer
    return this.comoCompleto(await this.leerCuenta({ ...input, ...ventanaDeArchivo() }, actor, "oficina"));
  }

  async leerMiTienda(input: MiEstadoCuentaInput, actor: Actor): Promise<VerEstadoCuentaServiceResult> {
    if (actor.rol !== ROL_TIENDA) return { status: "forbidden" }; // R34/R36: antes de leer
    // R36: la cuenta sale de la SESION; la entrada no la puede nombrar (su schema no tiene la clave).
    return this.leerCuenta({ ...input, cuenta: { tipo: "tienda", id: actor.usuarioId } }, actor, "tienda");
  }

  async leerMiTiendaCompleto(
    input: MiEstadoCuentaCompletoInput,
    actor: Actor,
  ): Promise<VerEstadoCuentaCompletoServiceResult> {
    if (actor.rol !== ROL_TIENDA) return { status: "forbidden" };
    return this.comoCompleto(
      await this.leerCuenta(
        { ...input, ...ventanaDeArchivo(), cuenta: { tipo: "tienda", id: actor.usuarioId } },
        actor,
        "tienda",
      ),
    );
  }

  /**
   * TD.6/R32 — el periodo ENTERO o nada: se leyo `tope + 1`; si `total` supera el tope, SOLO los
   * conteos (nunca un archivo al que le falten filas).
   */
  private comoCompleto(r: VerEstadoCuentaServiceResult): VerEstadoCuentaCompletoServiceResult {
    if (r.status !== "ok") return r;
    const limite = descargaConfig.MAX_FILAS;
    if (r.estado.total > limite) return { status: "limite_excedido", total: r.estado.total, limite };
    return { status: "ok", estado: { ...r.estado, page: 1, pageSize: r.estado.total } };
  }

  /**
   * El extracto de UNA cuenta, sin mirar el rol (lo miro quien llama). `vista` decide lo que se
   * nombra: la tienda en `/mi-wallet` ve SU extracto sin los nombres de la gente de Ordenex (quien
   * registro o anulo; `/mi-wallet` nunca los enseño, 335/D2) y sin «Anular…» (R35).
   */
  private async leerCuenta(
    input: EstadoCuentaInput,
    actor: Actor,
    vista: "oficina" | "tienda",
  ): Promise<VerEstadoCuentaServiceResult> {
    const { tipo, id } = input.cuenta;
    const pares = this.paresDelChip(tipo, input.chip);
    if (pares === "chip_ajeno") {
      return { status: "validation_error", fieldErrors: { chip: ["Ese filtro no es de este tipo de cuenta."] } };
    }
    // R10: el cierre es de un mensajero; una bodega satelite no tiene filas de cierre que filtrar.
    if (input.cierreId !== undefined && tipo === "bodega") {
      return { status: "validation_error", fieldErrors: { cierreId: ["Ese filtro no es de este tipo de cuenta."] } };
    }

    const nombre = await this.repo.nombreDeCuenta(tipo, id);
    if (nombre === null) return { status: "no_encontrado" }; // R81: inexistente o de otro papel, igual

    const desdeUtc = input.desde === undefined ? undefined : inicioDelDiaCREnUtc(input.desde); // R16
    const hastaUtc = input.hasta === undefined ? undefined : inicioDelDiaSiguienteCREnUtc(input.hasta);
    const ventana = {
      desdeUtc,
      hastaUtc,
      pares,
      cierreId: input.cierreId,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      // 172 R55 (cierre de la 458-D) — el resumen de tres cifras solo lo lee la propia tienda.
      conResumen: vista === "tienda",
    };

    // FICHA 458-B (revision M2) — TODAS las lecturas del extracto en UNA transaccion REPEATABLE READ:
    // la pagina, el saldo actual, el inicial y el periodo ven la MISMA foto de los libros. Sin ella,
    // un cierre aprobado entre `totales…` y `periodo…` hacia que R22 no cuadrara (error de servidor
    // intermitente en la pantalla), aunque el dinero estuviera bien.
    const lectura = await this.repo.enLecturaConsistente((repo) =>
      tipo === "tienda"
        ? this.leerTienda(repo, id, ventana)
        : tipo === "mensajero"
          ? this.leerMensajero(repo, id, ventana)
          : this.leerBodega(repo, id, ventana),
    );

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
    // 172 R55 — las tres cifras TIENEN que cuadrar con la tarjeta: «A tu favor − Cargos − Ya pagado» es
    // el saldo actual (y por R21/R22, el corrido de la ultima fila). Si una fila tuviera una categoria que
    // no casa con su tipo, las dos derivaciones divergirian: se falla ruidoso, como R22.
    if (lectura.resumen !== null && lectura.resumen.saldo !== lectura.saldoActual) {
      throw new Error(
        `estado de cuenta (${tipo}): el resumen no cuadra — a favor ${lectura.resumen.aFavor}, cargos ${lectura.resumen.cargos}, pagado ${lectura.resumen.pagado}, saldo ${lectura.resumen.saldo}, actual ${lectura.saldoActual}`,
      );
    }

    // R6–R8 — el origen de cada fila, EN LOTE y FUERA de la transaccion (texto descriptivo, no dinero):
    // una consulta por tipo de origen presente en la pagina. El actor decide los enlaces y lo que se nombra.
    const origenes =
      lectura.libro === null
        ? null
        : await this.origenes.resolver(
            lectura.libro,
            lectura.crudas.map((f) => ({
              origenTipo: f.origenTipo as WalletOrigenTipo,
              origenId: f.origenId,
              categoria: f.categoria,
              descripcion: f.descripcion,
            })),
            actor,
          );
    const filas = lectura.filas.map((f, i) => {
      const conOrigen: FilaEstadoCuentaDTO = { ...f, origen: origenes === null ? null : origenes[i] };
      return vista === "tienda" ? paraLaTienda(conOrigen) : conOrigen;
    });

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
        resumen: lectura.resumen,
        filas,
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

  private async leerTienda(repo: IEstadoCuentaRepository, tiendaId: string, v: Ventana): Promise<Lectura> {
    const pagina = await repo.paginaDeTienda(tiendaId, v);
    const actual = await repo.totalesDeTienda(tiendaId);
    const antes = v.desdeUtc === undefined ? null : await repo.totalesDeTienda(tiendaId, v.desdeUtc);
    const periodo = await repo.periodoDeTienda(tiendaId, v.desdeUtc, v.hastaUtc);
    const totales = totalesNetos(periodo, claveDeParTienda, (m: MovimientoDelPeriodoRow) => m.tipo === "credito");
    const documentos = pagina.filas.map(documentoDeTienda);
    const estados = await this.estadosDeDocumentos(repo, documentos, null);
    const aprobadores = await repo.quienAproboLosCierres(cierresDe(pagina.filas));
    // 172 R55 — la cuenta ENTERA por concepto, en la MISMA foto que `actual`, clasificada por la MISMA
    // funcion que la cabecera del maestro (171): aqui no se decide en que importe cae nada.
    const resumen = v.conResumen ? derivarDesgloseTienda(await repo.desgloseDeTienda(tiendaId)) : null;
    return {
      libro: "tienda",
      crudas: pagina.filas,
      resumen,
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

  private async leerMensajero(repo: IEstadoCuentaRepository, mensajeroId: string, v: Ventana): Promise<Lectura> {
    const pagina = await repo.paginaDeMensajero(mensajeroId, v);
    const actual = await repo.totalesDeMensajero(mensajeroId);
    const antes = v.desdeUtc === undefined ? null : await repo.totalesDeMensajero(mensajeroId, v.desdeUtc);
    const periodo = await repo.periodoDeMensajero(mensajeroId, v.desdeUtc, v.hastaUtc);
    const totales = totalesNetos(periodo, claveDeParMensajero, (m: MovimientoDelPeriodoRow) => m.tipo === "devengo");
    const documentos = pagina.filas.map(documentoDeMensajero);
    const estados = await this.estadosDeDocumentos(repo, documentos, mensajeroId);
    const aprobadores = await repo.quienAproboLosCierres(cierresDe(pagina.filas));
    return {
      libro: "mensajero",
      crudas: pagina.filas,
      resumen: null,
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

  private async leerBodega(repo: IEstadoCuentaRepository, zonaId: string, v: Ventana): Promise<Lectura> {
    const pagina = await repo.paginaDeBodega(zonaId, v);
    const actual = await repo.totalesDeBodega(zonaId);
    const antes = v.desdeUtc === undefined ? null : await repo.totalesDeBodega(zonaId, v.desdeUtc);
    const periodo = await repo.periodoDeBodega(zonaId, v.desdeUtc, v.hastaUtc);
    // En la bodega el «abono» es lo RECIBIDO (baja lo que tiene por entregar); no hay pares anulados.
    const totales = totalesNetos(periodo, () => null, (m) => m.tipo === "recibido");
    const cero = new Prisma.Decimal(0);
    const pendiente = (t: { efectivo: string; recibido: string }) =>
      saldoDe(new Prisma.Decimal(t.efectivo), new Prisma.Decimal(t.recibido)).toFixed(2);
    return {
      libro: null,
      crudas: pagina.filas,
      resumen: null,
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
        origen: null,
        pago: null,
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
    repo: IEstadoCuentaRepository,
    documentos: (DocumentoDeFila | null)[],
    mensajeroId: string | null,
  ): Promise<Map<string, EstadoDeDocumento>> {
    const estados = new Map<string, EstadoDeDocumento>();
    const tipos: TipoDeDocumentoDeLibro[] = ["liquidacion_pago", "cobro_tienda", "pago_por_cuenta_tienda", "abono_tienda"];
    for (const tipo of tipos) {
      const ids = [
        ...new Set(
          documentos.flatMap((d) => (d !== null && d.tipo === tipo && "id" in d ? [d.id] : [])),
        ),
      ];
      if (ids.length === 0) continue;
      const anulaciones = new Map((await repo.anulacionesDe(tipo, ids)).map((a) => [a.documentoId, a]));
      const comprobantes = await repo.conComprobante(tipo, ids);
      // 458-D (servidor): el metodo y la referencia, solo de los documentos de PAGO.
      const pagos =
        tipo === "cobro_tienda"
          ? new Map<string, PagoDeDocumento>()
          : new Map((await repo.pagosDe(tipo as TipoDeDocumentoDePago, ids)).map((p) => [p.documentoId, p]));
      for (const id of ids) {
        const a = anulaciones.get(id);
        const p = pagos.get(id);
        estados.set(`${tipo}:${id}`, {
          anulacion: a === undefined ? null : aAnulacion(a),
          tieneComprobante: comprobantes.has(id),
          pago: p === undefined ? null : { metodo: p.metodo, referencia: p.referencia },
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
              : {
                  motivo: e.anulacion.motivo,
                  por: e.anulacion.anuladoPorNombre,
                  fecha: fechaCalendarioCR(e.anulacion.createdAt),
                  hora: horaCostaRica(e.anulacion.createdAt.toISOString()),
                },
          tieneComprobante: false,
          pago: null,
        });
      }
    }
    const dias = documentos.flatMap((d) => (d !== null && d.tipo === "premio" ? [d.dia] : []));
    if (mensajeroId !== null && dias.length > 0) {
      const reversos = new Map((await repo.reversosDePremio(mensajeroId, dias)).map((r) => [r.documentoId, r]));
      for (const dia of dias) {
        const r = reversos.get(dia.toISOString());
        estados.set(`premio:${dia.toISOString()}`, {
          anulacion: r === undefined ? null : aAnulacion(r),
          tieneComprobante: false,
          pago: null,
        });
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
      estados: Map<string, EstadoDeDocumento>;
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
      origen: null, // lo pone `leerCuenta` en lote, fuera de la transaccion
      pago: estado?.pago ?? null,
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
  /**
   * 458-D (R10/R12; en el mensajero, tambien 172 R52) — el cierre del filtro, que llega tal cual a
   * `VentanaDeLibro.cierreId`. Declarado aqui para que el compilador proteja la propagacion.
   */
  cierreId?: string;
  skip: number;
  take: number;
  /** 172 R55 — leer el resumen de tres cifras (solo la vista de la propia tienda). */
  conResumen: boolean;
};

type Lectura = {
  /** El diccionario de origen de las filas; `null` en la bodega (sin origen de la wallet). */
  libro: LibroWallet | null;
  /** Las filas tal como salieron del repositorio (con `origenId`), para resolver su origen en lote. */
  crudas: FilaDeLibroRow[];
  /** 172 R55 — el resumen de tres cifras de la cuenta entera, o `null` (no se pidio / no es tienda). */
  resumen: DesgloseTiendaDTO | null;
  saldoActual: string;
  saldoInicial: string;
  abonos: string;
  cargos: string;
  total: number;
  filas: FilaEstadoCuentaDTO[];
};

type EstadoDeDocumento = {
  anulacion: AnulacionDeFilaDTO | null;
  tieneComprobante: boolean;
  pago: FilaEstadoCuentaDTO["pago"];
};

/** `adminTienda` ES la tienda: su `usuarioId` es el `tienda_id` del libro (mismo predicado que 335/344). */
const ROL_TIENDA = "adminTienda";

/** TD.6 — la ventana del archivo: `tope + 1` filas desde la primera; `total` dice el numero real. */
function ventanaDeArchivo(): { page: number; pageSize: number } {
  return { page: 1, pageSize: descargaConfig.MAX_FILAS + 1 };
}

/**
 * R34/R35 — la fila tal como la ve la tienda en `/mi-wallet`: sin «Anular…», y sin los nombres de la
 * gente de Ordenex (quien la registro, quien aprobo el cierre, quien la anulo). Se conservan el motivo,
 * el dia y la hora de la anulacion (R25) y el destino (`ref`), que es por donde abre SU comprobante
 * (R78). R25 en la tienda (decision del leader, 2026-09-26, revision m3): la pantalla dice «Anulado
 * por Ordenex» con el dia y la hora de Costa Rica y el motivo; el NOMBRE de la persona no viaja.
 */
function paraLaTienda(f: FilaEstadoCuentaDTO): FilaEstadoCuentaDTO {
  return {
    ...f,
    registro: { nombre: null, automatico: null },
    anulacion: f.anulacion === null ? null : { ...f.anulacion, por: null },
    anulable: false,
  };
}

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
