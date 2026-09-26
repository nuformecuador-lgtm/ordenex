import { esAccesoTotal } from "@/lib/auth/acceso-total";
import {
  METODO_ORIGEN_LABEL,
  ORIGEN_ENLACE_LABEL,
  ORIGEN_ENTIDAD_LABEL,
  SEPARADOR_ORIGEN,
} from "@/lib/constants/origen-legible-rotulos";
import { ORIGEN_LABEL, ORIGEN_PAGO_LABEL, ORIGEN_TIENDA_LABEL } from "@/lib/constants/wallet-rotulos";
import { hrefDetalleCierre } from "@/lib/utils/cierre-enlace";
import type {
  AbonoDeOrigen,
  CierreDeOrigen,
  IOrigenLegibleRepository,
  MovimientoTiendaDeOrigen,
  OrdenDeOrigen,
  PagoDeOrigen,
  PagoPorCuentaDeOrigen,
  PodioDeOrigen,
} from "@/lib/interfaces/repositories/IOrigenLegibleRepository";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { IOrigenLegibleService } from "@/lib/interfaces/services/IOrigenLegibleService";
import type { WalletOrigenTipo } from "@/lib/types/wallet";
import type {
  ConOrigen,
  EnlaceOrigenDTO,
  FilaConOrigenTecnico,
  LibroWallet,
  OrigenLegibleDTO,
} from "@/lib/types/wallet-origen";
import { fechaDiaMovimientoCR } from "@/lib/utils/fecha-dia-iso";
import { PARAM_TERMINO_DEFAULT } from "@/lib/utils/filtros-url";

/**
 * El diccionario de rotulos de cada libro (461 §7.3). `Record` TOTAL sobre `WalletOrigenTipo` en los
 * tres (R9): un origen nuevo no compila sin su nombre en cada uno.
 */
export const DICCIONARIO_ORIGEN: Record<LibroWallet, Record<WalletOrigenTipo, string>> = {
  caja: ORIGEN_LABEL,
  tienda: ORIGEN_TIENDA_LABEL,
  mensajero: ORIGEN_PAGO_LABEL,
};

/**
 * `/ranking/historico?fecha=YYYY-MM-DD`: el parametro lo lee `app/(app)/ranking/historico/page.tsx`
 * (`PARAM_FECHA`, constante privada de la pagina). Un test lee esa fuente y afirma que sigue
 * llamandose asi: si alguien lo renombra, el enlace muerto sale en rojo.
 */
export const RUTA_RANKING_HISTORICO = "/ranking/historico";
export const PARAM_FECHA_RANKING = "fecha";

/** Que pantallas de entidad puede abrir el rol que mira (R7/R8). */
type Acceso = {
  cierres: boolean;
  ordenes: boolean;
  ranking: boolean;
  /** La tienda NO ve que mensajero movio su dinero (335 / D2 de la 458). */
  nombraMensajero: boolean;
};

function accesoDe(actor: Actor): Acceso {
  const total = esAccesoTotal(actor.rol);
  return {
    cierres: total,
    // `/ordenes` admite maestro, admin y adminTienda (esta acotada a sus ordenes).
    ordenes: total || actor.rol === "adminTienda",
    ranking: total,
    nombraMensajero: total,
  };
}

/** Las entidades resueltas de la pagina, por tipo y por id. */
type Entidades = {
  cierres: Map<string, CierreDeOrigen>;
  gestiones: Map<string, OrdenDeOrigen>;
  incidentes: Map<string, OrdenDeOrigen>;
  pagos: Map<string, PagoDeOrigen>;
  podios: Map<string, PodioDeOrigen>;
  pagosPorCuenta: Map<string, PagoPorCuentaDeOrigen>;
  abonos: Map<string, AbonoDeOrigen>;
  movimientosTienda: Map<string, MovimientoTiendaDeOrigen>;
};

/** Que lectura resuelve cada origen. `null` = no hay entidad que leer (se nombra por el rotulo). */
const LECTURA_POR_ORIGEN: Record<WalletOrigenTipo, keyof Entidades | null> = {
  cierre_dia: "cierres",
  gestion_orden: "gestiones",
  manual: null,
  pago_tienda: "pagos",
  pago_mensajero: "pagos",
  gasto: null,
  orden_incidente: "incidentes",
  ranking_snapshot_fila: "podios",
  pago_por_cuenta_tienda: "pagosPorCuenta",
  aporte_capital: null,
  cobro_manual_reclasificado: "movimientosTienda",
  cobro_tienda: "movimientosTienda",
  cobro_tienda_completado: "movimientosTienda",
  abono_tienda: "abonos",
};

function unir(...partes: (string | null | undefined)[]): string {
  return partes.filter((p): p is string => p != null && p.trim() !== "").join(SEPARADOR_ORIGEN);
}

function textoDeOrden(orden: OrdenDeOrigen | undefined): string | null {
  if (orden === undefined) return null;
  if (orden.guia !== null) return ORIGEN_ENTIDAD_LABEL.guia(orden.guia);
  if (orden.remision !== null) return ORIGEN_ENTIDAD_LABEL.remision(orden.remision);
  return null;
}

function enlaceAOrden(orden: OrdenDeOrigen | undefined, acceso: Acceso): EnlaceOrigenDTO | null {
  if (!acceso.ordenes || orden === undefined) return null;
  const termino = orden.guia ?? orden.remision;
  if (termino === null) return null;
  return {
    etiqueta: ORIGEN_ENLACE_LABEL.verOrden(termino),
    href: `/ordenes?${PARAM_TERMINO_DEFAULT}=${encodeURIComponent(termino)}`,
  };
}

/** El concepto de un egreso registrado a mano, por su categoria (design §3.3, fila `gasto`). */
function textoDeGasto(fila: FilaConOrigenTecnico): string | null {
  switch (fila.categoria) {
    case "egreso_sueldo":
      return ORIGEN_ENTIDAD_LABEL.sueldo;
    case "egreso_gasto_variable":
      return ORIGEN_ENTIDAD_LABEL.gastoDeOrdenex;
    case "egreso_gasto_fijo":
      return unir(ORIGEN_ENTIDAD_LABEL.gastoFijo, fila.descripcion);
    default:
      return null;
  }
}

/**
 * Compone el origen de UNA fila a partir de las entidades ya leidas. PURA: sin base, sin reloj.
 * Si la entidad no aparece (fila huerfana, `origen_id` nulo), el origen es el rotulo solo: legible
 * y nunca un identificador (R4).
 */
export function componerOrigen(
  libro: LibroWallet,
  fila: FilaConOrigenTecnico,
  e: Entidades,
  acceso: Acceso,
): OrigenLegibleDTO {
  const rotulo = DICCIONARIO_ORIGEN[libro][fila.origenTipo];
  const id = fila.origenId;
  const solo = (texto: string | null, enlace: EnlaceOrigenDTO | null = null): OrigenLegibleDTO => ({
    texto: texto ?? rotulo,
    enlace,
  });

  switch (fila.origenTipo) {
    case "cierre_dia": {
      const c = id === null ? undefined : e.cierres.get(id);
      if (c === undefined) return solo(null);
      const dia = fechaDiaMovimientoCR(c.solicitadoAt);
      const mensajero = acceso.nombraMensajero ? c.mensajero : null;
      return solo(
        unir(rotulo, dia, mensajero),
        acceso.cierres
          ? {
              etiqueta:
                mensajero === null
                  ? ORIGEN_ENLACE_LABEL.verCierre(dia)
                  : ORIGEN_ENLACE_LABEL.verCierreDe(dia, mensajero),
              href: hrefDetalleCierre(c.id),
            }
          : null,
      );
    }
    case "gestion_orden": {
      const g = id === null ? undefined : e.gestiones.get(id);
      const esRechazo = fila.categoria.includes("flete_devolucion");
      return solo(
        unir(rotulo, esRechazo ? ORIGEN_ENTIDAD_LABEL.cobroPorRechazo : null, textoDeOrden(g)),
        enlaceAOrden(g, acceso),
      );
    }
    case "orden_incidente": {
      const i = id === null ? undefined : e.incidentes.get(id);
      return solo(unir(rotulo, textoDeOrden(i)), enlaceAOrden(i, acceso));
    }
    case "pago_tienda":
    case "pago_mensajero": {
      const p = id === null ? undefined : e.pagos.get(id);
      if (p === undefined) return solo(null);
      return solo(unir(rotulo, p.beneficiario, p.fechaPago, METODO_ORIGEN_LABEL[p.metodo]));
    }
    case "ranking_snapshot_fila": {
      const p = id === null ? undefined : e.podios.get(id);
      if (p === undefined) return solo(null);
      return solo(
        unir(rotulo, ORIGEN_ENTIDAD_LABEL.podio(p.fecha)),
        acceso.ranking
          ? {
              etiqueta: ORIGEN_ENLACE_LABEL.verPodio(p.fecha),
              href: `${RUTA_RANKING_HISTORICO}?${PARAM_FECHA_RANKING}=${encodeURIComponent(p.fecha)}`,
            }
          : null,
      );
    }
    case "pago_por_cuenta_tienda": {
      const p = id === null ? undefined : e.pagosPorCuenta.get(id);
      if (p === undefined) return solo(null);
      return solo(unir(rotulo, p.tienda, ORIGEN_ENTIDAD_LABEL.aBeneficiario(p.beneficiario)));
    }
    case "abono_tienda": {
      const a = id === null ? undefined : e.abonos.get(id);
      if (a === undefined) return solo(null);
      return solo(unir(rotulo, a.tienda, a.fechaPago, METODO_ORIGEN_LABEL[a.metodo]));
    }
    case "cobro_manual_reclasificado":
    case "cobro_tienda":
    case "cobro_tienda_completado": {
      const m = id === null ? undefined : e.movimientosTienda.get(id);
      return solo(m === undefined ? null : unir(rotulo, m.tienda));
    }
    case "gasto":
      return solo(textoDeGasto(fila));
    case "manual":
    case "aporte_capital":
      return solo(null);
  }
}

/**
 * Ficha 458-A (TA.2, design §3.3, R5–R9) — el origen legible de una pagina, EN LOTE.
 *
 * Agrupa los `origen_id` por la lectura que los resuelve y hace UNA consulta por lectura PRESENTE
 * (ninguna si la pagina no tiene filas de ese tipo; molde: `WalletService.conDocumentos`). Nunca una
 * consulta por fila.
 */
export class OrigenLegibleService implements IOrigenLegibleService {
  constructor(private readonly repo: IOrigenLegibleRepository) {}

  async resolver(
    libro: LibroWallet,
    filas: readonly FilaConOrigenTecnico[],
    actor: Actor,
  ): Promise<OrigenLegibleDTO[]> {
    const ids: Record<keyof Entidades, Set<string>> = {
      cierres: new Set(),
      gestiones: new Set(),
      incidentes: new Set(),
      pagos: new Set(),
      podios: new Set(),
      pagosPorCuenta: new Set(),
      abonos: new Set(),
      movimientosTienda: new Set(),
    };
    for (const f of filas) {
      const lectura = LECTURA_POR_ORIGEN[f.origenTipo];
      if (lectura !== null && f.origenId !== null) ids[lectura].add(f.origenId);
    }

    const leer = async <T extends { id: string }>(
      clave: keyof Entidades,
      fn: (ids: readonly string[]) => Promise<T[]>,
    ): Promise<Map<string, T>> => {
      const lista = [...ids[clave]];
      if (lista.length === 0) return new Map();
      const filasLeidas = await fn(lista);
      return new Map(filasLeidas.map((x) => [x.id, x]));
    };

    const [cierres, gestiones, incidentes, pagos, podios, pagosPorCuenta, abonos, movimientosTienda] =
      await Promise.all([
        leer("cierres", (x) => this.repo.cierres(x)),
        leer("gestiones", (x) => this.repo.gestiones(x)),
        leer("incidentes", (x) => this.repo.incidentes(x)),
        leer("pagos", (x) => this.repo.pagos(x)),
        leer("podios", (x) => this.repo.podios(x)),
        leer("pagosPorCuenta", (x) => this.repo.pagosPorCuenta(x)),
        leer("abonos", (x) => this.repo.abonos(x)),
        leer("movimientosTienda", (x) => this.repo.movimientosTienda(x)),
      ]);
    const entidades: Entidades = {
      cierres,
      gestiones,
      incidentes,
      pagos,
      podios,
      pagosPorCuenta,
      abonos,
      movimientosTienda,
    };
    const acceso = accesoDe(actor);
    return filas.map((f) => componerOrigen(libro, f, entidades, acceso));
  }

  async adjuntar<T extends FilaConOrigenTecnico>(
    libro: LibroWallet,
    filas: readonly T[],
    actor: Actor,
  ): Promise<ConOrigen<T>[]> {
    const origenes = await this.resolver(libro, filas, actor);
    return filas.map((f, i) => ({ ...f, origen: origenes[i] }));
  }
}
