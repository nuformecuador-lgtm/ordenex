import { horaCostaRica } from "@/lib/utils/hora-cr";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { walletTiendaConfig } from "@/lib/config/wallet-tienda";
import { walletMovimientoConfig } from "@/lib/config/wallet-movimiento";
import type {
  BusquedaDeCierre,
  ConteoPorCategoria,
  IFiltrosWalletRepository,
} from "@/lib/interfaces/repositories/IFiltrosWalletRepository";
import type {
  CierresDeLaCuentaServiceResult,
  ConceptosConMovimientosServiceResult,
  IFiltrosWalletService,
  QuienesDelLibroCajaServiceResult,
} from "@/lib/interfaces/services/IFiltrosWalletService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { WALLET_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet";
import type {
  CierresDeLaCuentaInput,
  ConceptoConMovimientosDTO,
  ConceptosConMovimientosInput,
  QuienDelLibroCajaOpcionDTO,
  QuienesDelLibroCajaInput,
} from "@/lib/types/wallet-filtros";
import { WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet-tienda";
import { esFechaCalendarioValida, inicioDelDiaCREnUtc, inicioDelDiaSiguienteCREnUtc } from "@/lib/utils/fecha-cr";
import { fechaDiaMovimientoCR } from "@/lib/utils/fecha-dia-iso";

/** `/mi-wallet` es de la tienda de la sesion (`ROLES_MI_WALLET`); el alcance sale del actor. */
const ROL_TIENDA = "adminTienda";

/** Conteos en el ORDEN del catalogo del libro, y solo los que tienen filas (R13/R14). */
function enOrdenDelCatalogo(
  catalogo: readonly string[],
  conteos: readonly ConteoPorCategoria[],
): ConceptoConMovimientosDTO[] {
  const porCategoria = new Map(conteos.map((c) => [c.categoria, c.movimientos]));
  return catalogo
    .filter((c) => (porCategoria.get(c) ?? 0) > 0)
    .map((categoria) => ({ categoria, movimientos: porCategoria.get(categoria) ?? 0 }));
}

/**
 * Lo que se busca en el selector de cierres: un dia (`YYYY-MM-DD`, su franja de Costa Rica) o un
 * texto (el nombre del mensajero). Vacio = sin busqueda.
 */
function busquedaDe(texto: string | undefined): BusquedaDeCierre | undefined {
  const t = (texto ?? "").trim();
  if (t === "") return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t) && esFechaCalendarioValida(t)) {
    return { tipo: "dia", desde: inicioDelDiaCREnUtc(t), hasta: inicioDelDiaSiguienteCREnUtc(t) };
  }
  return { tipo: "mensajero", texto: t };
}

/**
 * Ficha 458-A (TA.3/TA.4, design §3.5, R10–R15) — los filtros de la wallet, calculados en el
 * servidor. El rol se comprueba ANTES de tocar el repositorio (R82 por analogia): `forbidden` no
 * lee nada. Ninguna salida lleva importes.
 */
export class FiltrosWalletService implements IFiltrosWalletService {
  constructor(
    private readonly repo: IFiltrosWalletRepository,
    /** Ficha 458-E (R59): el tope del selector «A quién» (configuracion; inyectable en los tests). */
    private readonly topes: { quienes: number } = { quienes: walletMovimientoConfig.MAX_QUIENES_FILTRO },
  ) {}

  async conceptosConMovimientos(
    input: ConceptosConMovimientosInput,
    actor: Actor,
  ): Promise<ConceptosConMovimientosServiceResult> {
    switch (input.libro) {
      case "caja": {
        if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };
        const conteos = await this.repo.contarConceptosCaja({
          tipo: input.tipo,
          desde: input.desde,
          hasta: input.hasta,
          ...(input.aQuien !== undefined ? { aQuien: input.aQuien } : {}), // ficha 458-E (R59)
        });
        return { status: "ok", conceptos: enOrdenDelCatalogo(WALLET_MOVIMIENTO_CATEGORIA_SEED, conteos) };
      }
      case "tienda": {
        if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };
        const conteos = await this.repo.contarConceptosTienda(input.tiendaId, {
          cierreId: input.cierreId,
          desde: input.desde,
          hasta: input.hasta,
        });
        return {
          status: "ok",
          conceptos: enOrdenDelCatalogo(WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED, conteos),
        };
      }
      case "mi_tienda": {
        if (actor.rol !== ROL_TIENDA) return { status: "forbidden" };
        // R36: la tienda es la de la SESION; el borde no admite ninguna clave que nombre otra.
        const conteos = await this.repo.contarConceptosTienda(actor.usuarioId, {
          cierreId: input.cierreId,
          desde: input.desde,
          hasta: input.hasta,
        });
        return {
          status: "ok",
          conceptos: enOrdenDelCatalogo(WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED, conteos),
        };
      }
    }
  }

  async cierresDeLaCuenta(
    input: CierresDeLaCuentaInput,
    actor: Actor,
  ): Promise<CierresDeLaCuentaServiceResult> {
    // `/mi-wallet` conserva su selector de la 335 (D2): este es solo de las superficies de acceso total.
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };
    const limite = walletTiendaConfig.MAX_CIERRES_FILTRO;
    const busqueda = busquedaDe(input.busqueda);
    // `limite + 1`: el sobrante dice `hayMas` sin un `count` aparte (precedente 335).
    const filas =
      input.cuenta === "tienda"
        ? await this.repo.cierresDeTienda(input.tiendaId, busqueda, limite + 1)
        : await this.repo.cierresDeMensajero(input.mensajeroId, busqueda, limite + 1);
    return {
      status: "ok",
      hayMas: filas.length > limite,
      opciones: filas.slice(0, limite).map((f) => ({
        cierreId: f.cierreId,
        dia: fechaDiaMovimientoCR(f.solicitadoAt),
        hora: horaCostaRica(f.solicitadoAt),
        mensajero: f.mensajero,
        movimientos: f.movimientos,
      })),
    };
  }

  /**
   * Ficha 458-E (TE.2, R59) — a quien se le pago (o de quien vino) dinero de la caja en el periodo:
   * tiendas, mensajeros y nombres libres anotados, con el MISMO cruce por origen que el filtro del
   * libro (`libro-caja-a-quien-sql.ts`). Solo acceso total, comprobado ANTES de leer (R82).
   */
  async quienesDelLibroCaja(
    input: QuienesDelLibroCajaInput,
    actor: Actor,
  ): Promise<QuienesDelLibroCajaServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" };
    const filas = await this.repo.quienesDelLibroCaja({ tipo: input.tipo, desde: input.desde, hasta: input.hasta });
    return { status: "ok", ...opcionesDeQuienes(filas, input.busqueda, this.topes.quienes) };
  }
}

/** Para buscar y ordenar: sin mayusculas ni tildes («Ñ» se queda: `NFD` la separa en «N» + virgulilla). */
function claveDeBusqueda(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

const ORDEN_DE_CLASE: Record<QuienDelLibroCajaOpcionDTO["clase"], number> = { tienda: 0, mensajero: 1, nombre: 2 };

/**
 * Ficha 458-E (TE.2, R59) — las opciones del selector «A quién»: las cuentas (tiendas y mensajeros) y
 * los nombres libres con filas en la caja en el periodo, buscadas por nombre (sin mayusculas ni
 * tildes), en orden alfabetico y recortadas al tope con `hayMas`. Funcion aparte del servicio para
 * que la regla de orden y tope se lea entera en un sitio.
 */
export function opcionesDeQuienes(
  filas: {
    cuentas: readonly { tipo: "tienda" | "mensajero"; cuentaId: string; nombre: string; movimientos: number }[];
    nombres: readonly { nombre: string; movimientos: number }[];
  },
  busqueda: string | undefined,
  limite: number,
): { opciones: QuienDelLibroCajaOpcionDTO[]; hayMas: boolean } {
  const todas: QuienDelLibroCajaOpcionDTO[] = [
    ...filas.cuentas.map((c) => ({
      valor: { tipo: c.tipo, id: c.cuentaId },
      clase: c.tipo,
      nombre: c.nombre,
      movimientos: c.movimientos,
    })),
    ...filas.nombres.map((n) => ({
      valor: { nombre: n.nombre },
      clase: "nombre" as const,
      nombre: n.nombre,
      movimientos: n.movimientos,
    })),
  ];
  const buscado = claveDeBusqueda(busqueda ?? "");
  const casan = buscado === "" ? todas : todas.filter((o) => claveDeBusqueda(o.nombre).includes(buscado));
  const ordenadas = [...casan].sort(
    (a, b) =>
      claveDeBusqueda(a.nombre).localeCompare(claveDeBusqueda(b.nombre), "es") ||
      ORDEN_DE_CLASE[a.clase] - ORDEN_DE_CLASE[b.clase] ||
      a.nombre.localeCompare(b.nombre, "es"),
  );
  return { opciones: ordenadas.slice(0, limite), hayMas: ordenadas.length > limite };
}
