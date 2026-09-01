import { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CabeceraDeCierre,
  ICierreAporteRepository,
} from "@/lib/interfaces/repositories/ICierreAporteRepository";
import type { IWalletMovimientoRepository } from "@/lib/interfaces/repositories/IWalletMovimientoRepository";
import type { IWalletTiendaMovimientoRepository } from "@/lib/interfaces/repositories/IWalletTiendaMovimientoRepository";
import type {
  IDetalleMovimientoService,
  VerDetalleMovimientoCompletoServiceResult,
  VerDetalleMovimientoServiceResult,
} from "@/lib/interfaces/services/IDetalleMovimientoService";
import type {
  MotivoSinReparto,
  OrdenAporteDTO,
  VerDetalleDeMovimientoCompletoInput,
  VerDetalleDeMovimientoInput,
} from "@/lib/types/detalle-movimiento";
import { descargaConfig } from "@/lib/config/descarga";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import {
  FUENTE_CAJA,
  FUENTE_TIENDA,
  aporteDeOrden,
  criterioDeFuente,
  type FuenteDeAporte,
} from "@/lib/utils/aporte-por-orden";
import { rangoDePagina } from "@/lib/utils/rango-pagina";

// El rol de la tienda. `adminTienda` ES la tienda: su `usuarioId` es el `tienda_id` del libro.
// Mismo predicado que usa `WalletTiendaService` para el listado (R43): esta ficha no cambia el
// alcance por rol de ninguna de las dos pantallas ni anade permisos nuevos.
const ROL_TIENDA = "adminTienda";

/** Lo minimo que el detalle necesita saber de la fila del libro que se abrio. */
interface MovimientoAbierto {
  monto: string;
  origenTipo: string;
  origenId: string | null;
}

/** El conjunto ya resuelto, antes de darle forma de pagina o de archivo. */
type ConjuntoResuelto =
  | {
      estado: "ok";
      monto: string;
      cabecera: CabeceraDeCierre;
      ordenes: OrdenAporteDTO[];
      total: number;
      ordenesDelCierre: number;
    }
  | { estado: "sin_reparto"; motivo: MotivoSinReparto }
  | { estado: "not_found" };

/**
 * Ficha 344 (design §3.3) — de que cierre sale el importe de una fila del libro y que ordenes lo
 * componen.
 *
 * SIRVE A LOS DOS LIBROS —la caja principal y el de la tienda— con UNA sola derivacion. Lo unico
 * que los distingue son dos lineas: el guard de rol y el `tiendaId` del acotamiento. Todo lo
 * demas (resolver la fuente, leer la cabecera del cierre, paginar y derivar el aporte) es
 * identico, y esta escrito una vez: dos copias derivarian el mismo dinero desde dos sitios, que
 * es el fallo que esta ficha existe para no cometer.
 *
 * EL ORDEN DE LOS PASOS ES PARTE DEL REQUISITO:
 *
 *  1. **El guard, ANTES de tocar la base** (R39). Mismo motivo escrito ya en `verResumenCaja`:
 *     un `forbidden` evaluado despues del `SELECT` ya habria leido el dinero para tirarlo.
 *  2. **Leer el movimiento por id.** En la tienda, con `tiendaId` en el `WHERE` (R41): sin fila,
 *     `not_found`. Un movimiento de otra tienda es INDISTINGUIBLE de uno que no existe, que es
 *     la respuesta correcta — un `forbidden` confirmaria su existencia.
 *  3. **Resolver la fuente** con el catalogo. Si el concepto no admite reparto, o el origen no
 *     es un cierre, se responde `sin_reparto` con su motivo (R48) SIN consultar ni una orden.
 *  4. **Cabecera del cierre**, y solo entonces el repositorio: pagina + `count` + el «de M».
 *  5. **Derivar** el aporte de cada orden con `aporteDeOrden`.
 *
 * Este servicio no escribe NI UNA operacion aritmetica propia (R46): la unica suma que ocurre
 * vive en `aporteDeOrden`, y es la particion por orden de la que ya hacia el feed.
 */
export class DetalleMovimientoService implements IDetalleMovimientoService {
  constructor(
    // Dependencias ESTRECHAS (`Pick`): se depende del metodo que se usa, no del repositorio
    // entero. Es lo que permite que un doble de test declare una funcion y no quince.
    private readonly movimientos: Pick<IWalletMovimientoRepository, "obtenerPorId">,
    private readonly movimientosDeTienda: Pick<
      IWalletTiendaMovimientoRepository,
      "obtenerPorIdDeTienda"
    >,
    private readonly aportes: ICierreAporteRepository,
  ) {}

  async verDetalleDeMovimiento(
    input: VerDetalleDeMovimientoInput,
    actor: Actor,
  ): Promise<VerDetalleMovimientoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R38/R39: ANTES de la base

    const movimiento = await this.movimientos.obtenerPorId(input.movimientoId);
    if (movimiento === null) return { status: "not_found" };

    const resuelto = await this.resolverConjunto(
      movimiento,
      FUENTE_CAJA[movimiento.categoria],
      undefined, // la caja no se acota por tienda: la ven los roles de acceso total
      rangoDePagina(input),
    );
    return this.comoPagina(resuelto, input, true);
  }

  async verDetalleDeMovimientoCompleto(
    input: VerDetalleDeMovimientoCompletoInput,
    actor: Actor,
  ): Promise<VerDetalleMovimientoCompletoServiceResult> {
    if (!esAccesoTotal(actor.rol)) return { status: "forbidden" }; // R39

    const movimiento = await this.movimientos.obtenerPorId(input.movimientoId);
    if (movimiento === null) return { status: "not_found" };

    return this.comoArchivo(
      await this.resolverConjunto(
        movimiento,
        FUENTE_CAJA[movimiento.categoria],
        undefined,
        rangoDeArchivo(),
      ),
    );
  }

  async verDetalleDeMiMovimiento(
    input: VerDetalleDeMovimientoInput,
    actor: Actor,
  ): Promise<VerDetalleMovimientoServiceResult> {
    if (actor.rol !== ROL_TIENDA) return { status: "forbidden" }; // R39

    // R41: `tiendaId` en el WHERE de ESTA lectura. Un movimiento ajeno responde `not_found`.
    const movimiento = await this.movimientosDeTienda.obtenerPorIdDeTienda(
      input.movimientoId,
      actor.usuarioId,
    );
    if (movimiento === null) return { status: "not_found" };

    const resuelto = await this.resolverConjunto(
      movimiento,
      FUENTE_TIENDA[movimiento.categoria],
      // R40: y `tiendaId` en el WHERE de la SEGUNDA lectura, la de las ordenes. El cierre mezcla
      // varias tiendas: sin esta linea, la tienda A veria las ordenes de la B.
      actor.usuarioId,
      rangoDePagina(input),
    );
    // R15: sin nombre de mensajero. A la tienda no se le revela quien movio su dinero (335).
    return this.comoPagina(resuelto, input, false);
  }

  async verDetalleDeMiMovimientoCompleto(
    input: VerDetalleDeMovimientoCompletoInput,
    actor: Actor,
  ): Promise<VerDetalleMovimientoCompletoServiceResult> {
    if (actor.rol !== ROL_TIENDA) return { status: "forbidden" }; // R39

    const movimiento = await this.movimientosDeTienda.obtenerPorIdDeTienda(
      input.movimientoId,
      actor.usuarioId,
    );
    if (movimiento === null) return { status: "not_found" };

    return this.comoArchivo(
      await this.resolverConjunto(
        movimiento,
        FUENTE_TIENDA[movimiento.categoria],
        actor.usuarioId, // R40: tambien en el archivo
        rangoDeArchivo(),
      ),
    );
  }

  /**
   * Los pasos 3 a 5, compartidos por los dos libros y por los dos modos (pagina y archivo).
   *
   * `tiendaId` viene del ACTOR y nunca de la entrada (R42); llega hasta el `where` del
   * repositorio y hasta el conteo de «cuantas ordenes tiene el cierre», porque si no,
   * `/mi-wallet` diria «3 de 23» contando ordenes ajenas.
   */
  private async resolverConjunto(
    movimiento: MovimientoAbierto,
    fuente: FuenteDeAporte,
    tiendaId: string | undefined,
    rango: { skip: number; take: number },
  ): Promise<ConjuntoResuelto> {
    const criterio = criterioDeFuente(fuente);
    // R48: el concepto no se reparte por orden. La fila se abre igual y dice por que.
    if (criterio === null || fuente.tipo === "sin_reparto") {
      return {
        estado: "sin_reparto",
        motivo: fuente.tipo === "sin_reparto" ? fuente.motivo : "no_nace_de_un_cierre",
      };
    }
    // R6/R48: un ajuste manual o un gasto no cuelga de ningun cierre, aunque su categoria si
    // admita reparto. Aqui todavia no se ha consultado ni una orden.
    if (movimiento.origenTipo !== "cierre_dia" || movimiento.origenId === null) {
      return { estado: "sin_reparto", motivo: "no_nace_de_un_cierre" };
    }
    const cierreId = movimiento.origenId;

    const cabecera = await this.aportes.obtenerCabeceraDeCierre(cierreId);
    // El origen apunta a un cierre que no esta: no se inventa cabecera ni se sirven ordenes.
    if (cabecera === null) return { estado: "not_found" };

    const [pagina, ordenesDelCierre] = await Promise.all([
      this.aportes.listarOrdenesQueAportan({ cierreId, criterio, tiendaId, rango }),
      this.aportes.contarOrdenesDelCierre({ cierreId, tiendaId }),
    ]);

    return {
      estado: "ok",
      monto: movimiento.monto,
      cabecera,
      total: pagina.total, // R28: lo conto la base con el MISMO where, jamas `items.length`
      ordenesDelCierre,
      ordenes: pagina.items.map((fila) => ({
        ordenId: fila.ordenId,
        // El numero VISIBLE congelado: la guia si la orden llego a tenerla, si no la remision.
        guia: fila.numGuia === null ? fila.numRemision : String(fila.numGuia),
        destinatario: fila.destinatario,
        tiendaNombre: fila.tiendaNombre,
        // Los resultados de TODAS sus gestiones en ese cierre, sin agrupar: una orden con dos
        // gestiones lo dice ensenando dos resultados (R10/R20).
        resultados: fila.gestiones.map((g) => g.resultado),
        // R46: el aporte NO se calcula aqui. Se re-deriva con la funcion que produjo el importe.
        // El `?? 0` es inalcanzable mientras `aporte-por-orden-equivalencia.test.ts` este verde
        // (el `where` selecciono justamente las ordenes cuya derivacion define el concepto);
        // se escribe para no tener que afirmar un `!` sobre un camino de dinero.
        aporte: (
          aporteDeOrden(fuente, fila.orden, fila.gestiones) ?? new Prisma.Decimal(0)
        ).toFixed(2),
      })),
    };
  }

  /** Da forma de PAGINA al conjunto. `conMensajero` es la unica diferencia visible entre libros. */
  private comoPagina(
    resuelto: ConjuntoResuelto,
    input: VerDetalleDeMovimientoInput,
    conMensajero: boolean,
  ): VerDetalleMovimientoServiceResult {
    if (resuelto.estado === "sin_reparto") {
      return { status: "sin_reparto", motivo: resuelto.motivo };
    }
    if (resuelto.estado === "not_found") return { status: "not_found" };
    return {
      status: "ok",
      data: {
        monto: resuelto.monto,
        cierre: {
          fecha: resuelto.cabecera.fecha,
          mensajeroNombre: conMensajero ? resuelto.cabecera.mensajeroNombre : null,
        },
        ordenesDelCierre: resuelto.ordenesDelCierre,
        total: resuelto.total,
        page: input.page,
        pageSize: input.pageSize,
        ordenes: resuelto.ordenes,
      },
    };
  }

  /**
   * Da forma de ARCHIVO al conjunto (R32/R34): o van TODAS las ordenes, o van solo los conteos.
   * `limite_excedido` NUNCA lleva un dataset truncado, y ninguna rama de error lleva filas.
   */
  private comoArchivo(resuelto: ConjuntoResuelto): VerDetalleMovimientoCompletoServiceResult {
    if (resuelto.estado === "sin_reparto") {
      return { status: "sin_reparto", motivo: resuelto.motivo };
    }
    if (resuelto.estado === "not_found") return { status: "not_found" };
    const limite = descargaConfig.MAX_FILAS;
    if (resuelto.total > limite) return { status: "limite_excedido", total: resuelto.total, limite };
    return { status: "ok", items: resuelto.ordenes, total: resuelto.total };
  }
}

/**
 * La ventana del ARCHIVO: `page 1` + `pageSize = tope + 1`, o sea `skip 0, take N+1`.
 *
 * Acota la MEMORIA por construccion —nunca se materializan mas de N+1 ordenes— y deja al
 * `total` (que sale de un `count` independiente del `take`) decir el numero de verdad. Es el
 * patron ya establecido en `listarMovimientosCompleto`.
 */
function rangoDeArchivo(): { skip: number; take: number } {
  return rangoDePagina({ page: 1, pageSize: descargaConfig.MAX_FILAS + 1 });
}
