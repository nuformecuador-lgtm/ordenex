import type { PrismaClient } from "@prisma/client";

import type {
  CuentaNombrada,
  ILibroCajaAutoriaRepository,
  MovimientoDeCajaParaAutoria,
} from "@/lib/interfaces/repositories/ILibroCajaAutoriaRepository";
import { NOMBRE_USUARIO_SELECT, nombreCompletoUsuario, type NombreUsuarioFuente } from "@/lib/utils/nombre-usuario";

type Cliente = Pick<
  PrismaClient,
  | "walletMovimiento"
  | "usuario"
  | "cierreDia"
  | "liquidacionPago"
  | "rechazoTiendaCobro"
  | "rankingSnapshotFila"
  | "ordenIncidente"
  | "pagoPorCuentaTienda"
  | "walletTiendaMovimiento"
  | "abonoTienda"
  | "walletAnotacion"
>;

const PERSONA = { select: { id: true, ...NOMBRE_USUARIO_SELECT } } as const;

function cuenta(tipo: "tienda" | "mensajero", u: { id: string } & NombreUsuarioFuente): CuentaNombrada {
  return { tipo, id: u.id, nombre: nombreCompletoUsuario(u) };
}

function nombreONulo(u: NombreUsuarioFuente | null): string | null {
  return u === null ? null : nombreCompletoUsuario(u);
}

/**
 * FICHA 458-B (design §3.4, R56/R57) — las lecturas en lote de «A quien» y «Registro». SOLO queries,
 * por clave primaria o unica; una lista vacia no consulta.
 */
export class LibroCajaAutoriaRepository implements ILibroCajaAutoriaRepository {
  constructor(private readonly prisma: Cliente) {}

  async movimientos(ids: readonly string[]): Promise<MovimientoDeCajaParaAutoria[]> {
    if (ids.length === 0) return [];
    return this.prisma.walletMovimiento.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, origenTipo: true, origenId: true, registradoPor: true },
    });
  }

  async nombres(usuarioIds: readonly string[]): Promise<Map<string, string>> {
    if (usuarioIds.length === 0) return new Map();
    const us = await this.prisma.usuario.findMany({ where: { id: { in: [...usuarioIds] } }, ...PERSONA });
    return new Map(us.map((u) => [u.id, nombreCompletoUsuario(u)]));
  }

  async cierres(ids: readonly string[]) {
    if (ids.length === 0) return new Map();
    const cs = await this.prisma.cierreDia.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, mensajero: PERSONA, resueltoPorUsuario: PERSONA },
    });
    return new Map(cs.map((c) => [c.id, { mensajero: cuenta("mensajero", c.mensajero), aprobo: nombreONulo(c.resueltoPorUsuario) }]));
  }

  async pagos(ids: readonly string[]) {
    if (ids.length === 0) return new Map<string, CuentaNombrada>();
    const ps = await this.prisma.liquidacionPago.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, tienda: PERSONA, mensajero: PERSONA },
    });
    const salida = new Map<string, CuentaNombrada>();
    for (const p of ps) {
      if (p.tienda !== null) salida.set(p.id, cuenta("tienda", p.tienda));
      else if (p.mensajero !== null) salida.set(p.id, cuenta("mensajero", p.mensajero));
    }
    return salida;
  }

  async rechazos(gestionIds: readonly string[]) {
    if (gestionIds.length === 0) return new Map();
    const rs = await this.prisma.rechazoTiendaCobro.findMany({
      where: { gestionId: { in: [...gestionIds] } },
      select: { gestionId: true, tienda: PERSONA, decisor: PERSONA },
    });
    return new Map(rs.map((r) => [r.gestionId, { tienda: cuenta("tienda", r.tienda), aprobo: nombreONulo(r.decisor) }]));
  }

  async podios(ids: readonly string[]) {
    if (ids.length === 0) return new Map<string, CuentaNombrada>();
    const fs = await this.prisma.rankingSnapshotFila.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, mensajero: PERSONA },
    });
    return new Map(fs.map((f) => [f.id, cuenta("mensajero", f.mensajero)]));
  }

  async incidentes(ids: readonly string[]) {
    if (ids.length === 0) return new Map();
    const is = await this.prisma.ordenIncidente.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, orden: { select: { tienda: PERSONA } }, resueltoPorUsuario: PERSONA },
    });
    return new Map(
      is.map((i) => [i.id, { tienda: cuenta("tienda", i.orden.tienda), resolvio: nombreONulo(i.resueltoPorUsuario) }]),
    );
  }

  async pagosPorCuenta(ids: readonly string[]) {
    if (ids.length === 0) return new Map();
    const ps = await this.prisma.pagoPorCuentaTienda.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, beneficiario: true, tienda: PERSONA },
    });
    return new Map(ps.map((p) => [p.id, { tienda: cuenta("tienda", p.tienda), beneficiario: p.beneficiario }]));
  }

  async debitosDeTienda(ids: readonly string[]) {
    if (ids.length === 0) return new Map<string, CuentaNombrada>();
    const ds = await this.prisma.walletTiendaMovimiento.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, tienda: PERSONA },
    });
    return new Map(ds.map((d) => [d.id, cuenta("tienda", d.tienda)]));
  }

  async abonos(ids: readonly string[]) {
    if (ids.length === 0) return new Map<string, CuentaNombrada>();
    const as = await this.prisma.abonoTienda.findMany({ where: { id: { in: [...ids] } }, select: { id: true, tienda: PERSONA } });
    return new Map(as.map((a) => [a.id, cuenta("tienda", a.tienda)]));
  }

  async anotaciones(movimientoIds: readonly string[]) {
    if (movimientoIds.length === 0) return new Map<string, string | null>();
    const as = await this.prisma.walletAnotacion.findMany({
      where: { movimientoId: { in: [...movimientoIds] } },
      select: { movimientoId: true, contraparteNombre: true },
    });
    return new Map(as.map((a) => [a.movimientoId, a.contraparteNombre]));
  }
}
