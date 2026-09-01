import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ListarCompletoServiceResult } from "@/lib/types/descarga-listado";
import type {
  DetalleMovimientoPayload,
  MotivoSinReparto,
  OrdenAporteDTO,
  VerDetalleDeMovimientoCompletoInput,
  VerDetalleDeMovimientoInput,
} from "@/lib/types/detalle-movimiento";

/**
 * Ficha 344 (design §3.3) — contrato del servicio que abre una fila del libro de movimientos:
 * de que cierre sale su importe y que ordenes lo componen.
 *
 * POR QUE UN SERVICIO PROPIO Y NO DOS METODOS EN `WalletService`/`WalletTiendaService`
 * (desviacion consciente de `design.md § 3.3`, con su motivo medido):
 *
 *  1. **Los dos libros comparten TODO menos dos lineas.** El guard de rol y el acotamiento por
 *     tienda son lo unico que cambia; la resolucion de la fuente, la cabecera del cierre, la
 *     paginacion y la derivacion del aporte son identicas. Repartidas en dos clases, esa
 *     derivacion se escribiria DOS veces — y que la caja y el libro de la tienda deriven el
 *     mismo dinero de dos sitios distintos es exactamente el fallo que esta ficha existe para
 *     no cometer.
 *  2. **El coste medido de la alternativa**: `WalletService` y `WalletTiendaService` se
 *     construyen en 12 archivos (70 llamadas). Anadirles una dependencia obligatoria obligaba a
 *     tocar los tests de seis features ajenas para pasarles un doble que no usan.
 *
 * Lo que NO cambia respecto al diseno: el guard sigue siendo el MISMO predicado de rol que ya
 * usan las dos pantallas (`esAccesoTotal` y el rol de tienda), evaluado ANTES de la base (R39),
 * y esta ficha no anade ningun permiso nuevo (R43).
 */

/**
 * Los CUATRO estados del detalle, y ni uno mas.
 *
 *  - `ok`           — el payload con la pagina de ordenes.
 *  - `sin_reparto`  — el movimiento existe y es de un cierre, pero su concepto NO admite reparto
 *                     por orden. La fila SE ABRE IGUAL y dice de donde sale su importe (R48).
 *  - `not_found`    — no hay tal movimiento en el libro del actor. En `/mi-wallet`, el
 *                     movimiento de OTRA tienda es indistinguible de uno que no existe (R41):
 *                     un `forbidden` confirmaria que existe.
 *  - `forbidden`    — el rol no puede leer ese libro (R38).
 *
 * NINGUNA rama distinta de `ok` viaja con ordenes.
 */
export type VerDetalleMovimientoServiceResult =
  | { status: "ok"; data: DetalleMovimientoPayload }
  | { status: "sin_reparto"; motivo: MotivoSinReparto }
  | { status: "not_found" }
  | { status: "forbidden" };

/**
 * El MISMO detalle sin recorte por pagina, para la descarga (R32/R33/R34).
 *
 * `ListarCompletoServiceResult` aporta las tres formas comunes a todas las descargas del repo
 * (`ok` / `limite_excedido` con SOLO conteos / `forbidden`); a ellas se suman las dos propias de
 * este detalle. Ninguna rama de error viaja con filas.
 */
export type VerDetalleMovimientoCompletoServiceResult =
  | ListarCompletoServiceResult<OrdenAporteDTO>
  | { status: "sin_reparto"; motivo: MotivoSinReparto }
  | { status: "not_found" };

export interface IDetalleMovimientoService {
  /** R38/R39/R48: el detalle de un movimiento de la CAJA PRINCIPAL (roles de acceso total). */
  verDetalleDeMovimiento(
    input: VerDetalleDeMovimientoInput,
    actor: Actor,
  ): Promise<VerDetalleMovimientoServiceResult>;
  /** R32/R34: el mismo conjunto sin paginar, para el archivo de la caja. */
  verDetalleDeMovimientoCompleto(
    input: VerDetalleDeMovimientoCompletoInput,
    actor: Actor,
  ): Promise<VerDetalleMovimientoCompletoServiceResult>;
  /**
   * R40/R41/R15: el detalle de un movimiento del libro de la PROPIA tienda. `tiendaId` sale del
   * ACTOR y va en el `WHERE` de las DOS lecturas —la del movimiento y la de las ordenes—, y el
   * nombre del mensajero NO viaja.
   */
  verDetalleDeMiMovimiento(
    input: VerDetalleDeMovimientoInput,
    actor: Actor,
  ): Promise<VerDetalleMovimientoServiceResult>;
  /** R32/R34: el mismo conjunto sin paginar, para el archivo de la tienda. */
  verDetalleDeMiMovimientoCompleto(
    input: VerDetalleDeMovimientoCompletoInput,
    actor: Actor,
  ): Promise<VerDetalleMovimientoCompletoServiceResult>;
}
