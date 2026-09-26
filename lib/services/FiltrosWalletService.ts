import { horaCostaRica } from "@/app/(app)/analitica/_components/operativo/textos";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import { walletTiendaConfig } from "@/lib/config/wallet-tienda";
import type {
  BusquedaDeCierre,
  ConteoPorCategoria,
  IFiltrosWalletRepository,
} from "@/lib/interfaces/repositories/IFiltrosWalletRepository";
import type {
  CierresDeLaCuentaServiceResult,
  ConceptosConMovimientosServiceResult,
  IFiltrosWalletService,
} from "@/lib/interfaces/services/IFiltrosWalletService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import { WALLET_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet";
import type {
  CierresDeLaCuentaInput,
  ConceptoConMovimientosDTO,
  ConceptosConMovimientosInput,
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
  constructor(private readonly repo: IFiltrosWalletRepository) {}

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
}
