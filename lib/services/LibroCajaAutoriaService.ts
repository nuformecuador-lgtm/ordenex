import { esAccesoTotal } from "@/lib/auth/acceso-total";
import type {
  CuentaNombrada,
  ILibroCajaAutoriaRepository,
  MovimientoDeCajaParaAutoria,
} from "@/lib/interfaces/repositories/ILibroCajaAutoriaRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { RegistroDTO } from "@/lib/types/estado-cuenta";
import type { AQuienDTO, AutoriaDeFilaDTO, AutoriaLibroCajaInput } from "@/lib/types/libro-caja-autoria";
import type {
  AutoriaLibroCajaServiceResult,
  ILibroCajaAutoriaService,
} from "@/lib/interfaces/services/ILibroCajaAutoriaService";

const NADIE: AQuienDTO = { nombre: null, beneficiario: null, cuenta: null, esOrdenex: false };

function aCuenta(c: CuentaNombrada | undefined): AQuienDTO {
  return c === undefined ? NADIE : { nombre: c.nombre, beneficiario: null, cuenta: { tipo: c.tipo, id: c.id }, esOrdenex: false };
}

/**
 * FICHA 458-B (design §3.4, R56/R57) — «A quien» y «Registro» de las filas del libro de la caja,
 * EN LOTE: una consulta por tipo de origen presente en la pagina.
 *
 *   origen                                A quien
 *   cierre_dia                            el mensajero del cierre
 *   pago_tienda / pago_mensajero          el beneficiario del pago (172)
 *   gestion_orden                         la tienda del cobro por rechazo
 *   ranking_snapshot_fila                 el mensajero del podio
 *   orden_incidente                       la tienda de la orden
 *   pago_por_cuenta_tienda                la tienda y el beneficiario del documento
 *   cobro_tienda(_completado), cobro_manual_reclasificado   la tienda del cobro (el debito)
 *   abono_tienda                          la tienda que pago
 *   aporte_capital                        «Ordenex»
 *   gasto / manual                        la anotacion (nombre libre); sin anotacion, «—»
 *
 * Registro: la persona (`registrado_por`) o, si es automatico, la ACCION que lo produjo y quien la
 * decidio (aprobacion del cierre, plantilla de gasto fijo, cobro por rechazo, incidente, premio).
 * El texto lo compone la pantalla con sus rotulos: aqui solo hay datos.
 */
export class LibroCajaAutoriaService implements ILibroCajaAutoriaService {
  constructor(private readonly repo: ILibroCajaAutoriaRepository) {}

  async resolver(input: AutoriaLibroCajaInput, actor: Actor): Promise<AutoriaLibroCajaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R82: antes de leer

    const movs = await this.repo.movimientos(input.movimientoIds);
    const ids = (origen: string) => [
      ...new Set(movs.flatMap((m) => (m.origenTipo === origen && m.origenId !== null ? [m.origenId] : []))),
    ];
    const deTipos = (...origenes: string[]) => [...new Set(origenes.flatMap(ids))];

    const nombres = await this.repo.nombres([...new Set(movs.flatMap((m) => (m.registradoPor === null ? [] : [m.registradoPor])))]);
    const cierres = await this.repo.cierres(ids("cierre_dia"));
    const pagos = await this.repo.pagos(deTipos("pago_tienda", "pago_mensajero"));
    const rechazos = await this.repo.rechazos(ids("gestion_orden"));
    const podios = await this.repo.podios(ids("ranking_snapshot_fila"));
    const incidentes = await this.repo.incidentes(ids("orden_incidente"));
    const pagosPorCuenta = await this.repo.pagosPorCuenta(ids("pago_por_cuenta_tienda"));
    const debitos = await this.repo.debitosDeTienda(deTipos("cobro_tienda", "cobro_tienda_completado", "cobro_manual_reclasificado"));
    const abonos = await this.repo.abonos(ids("abono_tienda"));
    const anotaciones = await this.repo.anotaciones(
      movs.filter((m) => m.origenTipo === "gasto" || m.origenTipo === "manual").map((m) => m.id),
    );

    const aQuien = (m: MovimientoDeCajaParaAutoria): AQuienDTO => {
      const o = m.origenId;
      switch (m.origenTipo) {
        case "cierre_dia":
          return aCuenta(o === null ? undefined : cierres.get(o)?.mensajero);
        case "pago_tienda":
        case "pago_mensajero":
          return aCuenta(o === null ? undefined : pagos.get(o));
        case "gestion_orden":
          return aCuenta(o === null ? undefined : rechazos.get(o)?.tienda);
        case "ranking_snapshot_fila":
          return aCuenta(o === null ? undefined : podios.get(o));
        case "orden_incidente":
          return aCuenta(o === null ? undefined : incidentes.get(o)?.tienda);
        case "pago_por_cuenta_tienda": {
          const p = o === null ? undefined : pagosPorCuenta.get(o);
          return p === undefined ? NADIE : { ...aCuenta(p.tienda), beneficiario: p.beneficiario };
        }
        case "cobro_tienda":
        case "cobro_tienda_completado":
        case "cobro_manual_reclasificado":
          return aCuenta(o === null ? undefined : debitos.get(o));
        case "abono_tienda":
          return aCuenta(o === null ? undefined : abonos.get(o));
        case "aporte_capital":
          return { ...NADIE, esOrdenex: true };
        default: {
          // gasto / manual: el nombre libre anotado; una fila anterior a la 458 no tiene («—»).
          const nombre = anotaciones.get(m.id) ?? null;
          return { ...NADIE, nombre };
        }
      }
    };

    const registro = (m: MovimientoDeCajaParaAutoria): RegistroDTO => {
      if (m.registradoPor !== null) return { nombre: nombres.get(m.registradoPor) ?? null, automatico: null };
      const o = m.origenId;
      switch (m.origenTipo) {
        case "cierre_dia":
          return { nombre: null, automatico: { accion: "aprobacion_cierre", por: o === null ? null : (cierres.get(o)?.aprobo ?? null) } };
        case "gasto":
          return { nombre: null, automatico: { accion: "plantilla_gasto_fijo", por: null } };
        case "gestion_orden":
          return { nombre: null, automatico: { accion: "cobro_por_rechazo", por: o === null ? null : (rechazos.get(o)?.aprobo ?? null) } };
        case "orden_incidente":
          return { nombre: null, automatico: { accion: "incidente", por: o === null ? null : (incidentes.get(o)?.resolvio ?? null) } };
        case "ranking_snapshot_fila":
          return { nombre: null, automatico: { accion: "premio_del_ranking", por: null } };
        default:
          return { nombre: null, automatico: { accion: "sistema", por: null } };
      }
    };

    const porId = new Map(movs.map((m) => [m.id, m]));
    const filas: AutoriaDeFilaDTO[] = input.movimientoIds.flatMap((id) => {
      const m = porId.get(id);
      return m === undefined ? [] : [{ movimientoId: id, aQuien: aQuien(m), registro: registro(m) }];
    });
    return { status: "ok", filas };
  }
}
