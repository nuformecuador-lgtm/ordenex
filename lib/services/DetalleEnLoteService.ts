import { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  CabeceraDeCierre,
  ICierreAporteRepository,
  OrdenAporteEnLoteRow,
} from "@/lib/interfaces/repositories/ICierreAporteRepository";
import type { IMovimientosTiendaEnLoteRepository } from "@/lib/interfaces/repositories/IMovimientosTiendaEnLoteRepository";
import type {
  DetallarEnLoteInput,
  IDetalleEnLoteService,
} from "@/lib/interfaces/services/IDetalleEnLoteService";
import type {
  DetalleDeMovimientoLoteDTO,
  DetalleEnLoteServiceResult,
  OrdenDelLoteDTO,
} from "@/lib/types/detalle-en-lote";
import { descargaConfig } from "@/lib/config/descarga";
import { detalleMovimientoConfig } from "@/lib/config/detalle-movimiento";
import { esAccesoTotal } from "@/lib/auth/acceso-total";
import {
  FUENTE_CAJA,
  FUENTE_TIENDA,
  aporteDeOrden,
  fuenteDeMovimiento,
  type CriterioDeAporte,
  type DecisionDeReparto,
  type FuenteDeAporte,
} from "@/lib/utils/aporte-por-orden";

// El rol de la tienda: `adminTienda` ES la tienda (su `usuarioId` es el `tienda_id` del ledger). Mismo
// predicado que el detalle de una fila de `/mi-wallet` (344) y que su estado de cuenta (458-D).
const ROL_TIENDA = "adminTienda";

/** Un movimiento ya resuelto: su importe y la decision de reparto (la MISMA que el detalle de una fila). */
interface MovimientoResuelto {
  id: string;
  monto: string;
  fuente: FuenteDeAporte;
  decision: DecisionDeReparto;
}

/** Un concepto con reparto y los cierres en que aparece: la unidad de consulta (R37). */
interface GrupoDeConcepto {
  criterio: CriterioDeAporte;
  cierreIds: Set<string>;
}

/**
 * Ficha 464 (design §4) — el DETALLE POR ORDEN de muchos movimientos a la vez, para la hoja «Detalle
 * por orden» de la descarga de la caja, del estado de cuenta de una tienda y de `/mi-wallet`.
 *
 * NO HAY UNA SEGUNDA DERIVACION. Cada pieza es la del detalle de UNA fila (344/458-D):
 *
 *  - la decision de fuente es `fuenteDeMovimiento` (la misma funcion que usa `DetalleMovimientoService`);
 *  - el `WHERE` es el `OR` de `buildWhere`, una rama por cierre (repositorio);
 *  - el aporte de cada orden es `aporteDeOrden`, la funcion que produjo el importe.
 *
 * Lo unico nuevo es AGRUPAR: los movimientos con reparto se agrupan por concepto y sus cierres se
 * consultan en tramos, de modo que el numero de consultas depende de los conceptos y de los tramos, no
 * del numero de movimientos (R37). Llamar al detalle de una fila por cada movimiento seria el N+1 que la
 * ficha descarta (design §8.5).
 *
 * EL ORDEN DE LOS PASOS ES PARTE DEL REQUISITO:
 *
 *  1. guard de rol ANTES de cualquier lectura (R32/R33);
 *  2. en la tienda, re-leer las filas del ledger CON la tienda en el `WHERE` (R34);
 *  3. decidir la fuente de cada movimiento (en memoria);
 *  4. CONTAR por concepto y tramo; si la suma pasa del tope, `limite_excedido` SIN leer ni una orden
 *     (R39/R40);
 *  5. leer las ordenes y las cabeceras; derivar cada aporte; `suma`/`cuadra` con Decimal (R22/R23).
 */
export class DetalleEnLoteService implements IDetalleEnLoteService {
  constructor(
    // Dependencias ESTRECHAS: los tres metodos del lote, no el repositorio entero.
    private readonly aportes: Pick<
      ICierreAporteRepository,
      "contarAportesPorCierre" | "listarAportesDeCierres" | "cabecerasDeCierres"
    >,
    private readonly movimientosDeTienda: IMovimientosTiendaEnLoteRepository,
  ) {}

  async detallar(input: DetallarEnLoteInput, actor: Actor): Promise<DetalleEnLoteServiceResult> {
    // 1. R32/R33 — el rol, ANTES de la base. No se fia de que quien leyo los movimientos ya lo mirara.
    if (input.superficie === "mi_wallet") {
      if (actor.rol !== ROL_TIENDA) return { status: "forbidden" };
    } else if (!esAccesoTotal(actor.rol)) {
      return { status: "forbidden" };
    }

    // 2–3. Los movimientos con su fuente. En la tienda, el `tiendaId` sale del ACTOR (/mi-wallet) o de
    // la cuenta que la oficina ya leyo; nunca de una clave libre de la entrada (R35).
    const tiendaId =
      input.superficie === "mi_wallet"
        ? actor.usuarioId
        : input.superficie === "tienda_oficina"
          ? input.tiendaId
          : undefined;
    const movimientos = await this.resolverMovimientos(input, tiendaId);

    const grupos = agruparPorConcepto(movimientos);

    // 4. R39/R40 — contar ANTES de leer. Una consulta por concepto y tramo.
    const conteos = new Map<string, Map<string, number>>();
    for (const [clave, grupo] of grupos) {
      const porCierre = new Map<string, number>();
      for (const tramo of enTramos(grupo.cierreIds)) {
        const c = await this.aportes.contarAportesPorCierre({ criterio: grupo.criterio, cierreIds: tramo, tiendaId });
        for (const [cierreId, n] of c) porCierre.set(cierreId, n);
      }
      conteos.set(clave, porCierre);
    }
    let total = 0;
    for (const m of movimientos) {
      if (m.decision.tipo !== "reparto") continue;
      total += conteos.get(claveDeFuente(m.fuente))?.get(m.decision.cierreId) ?? 0;
    }
    const limite = descargaConfig.MAX_FILAS;
    if (total > limite) return { status: "limite_excedido", total, limite };

    // 5. Leer las ordenes (solo los tramos con algo que leer) y las cabeceras.
    const filas = new Map<string, Map<string, OrdenAporteEnLoteRow[]>>();
    for (const [clave, grupo] of grupos) {
      const porCierre = new Map<string, OrdenAporteEnLoteRow[]>();
      const contados = conteos.get(clave) ?? new Map<string, number>();
      for (const tramo of enTramos(grupo.cierreIds)) {
        if (!tramo.some((id) => (contados.get(id) ?? 0) > 0)) continue;
        const leidas = await this.aportes.listarAportesDeCierres({ criterio: grupo.criterio, cierreIds: tramo, tiendaId });
        for (const fila of leidas) {
          const lista = porCierre.get(fila.cierreId);
          if (lista === undefined) porCierre.set(fila.cierreId, [fila]);
          else lista.push(fila);
        }
      }
      filas.set(clave, porCierre);
    }

    const cierres = new Set<string>();
    for (const g of grupos.values()) for (const id of g.cierreIds) cierres.add(id);
    const cabeceras = new Map<string, CabeceraDeCierre>();
    for (const tramo of enTramos(cierres)) {
      for (const [id, cabecera] of await this.aportes.cabecerasDeCierres(tramo)) cabeceras.set(id, cabecera);
    }

    const conMensajero = input.superficie !== "mi_wallet"; // R5: a la tienda no se le nombra
    const conTienda = input.superficie === "caja"; // en las vistas de UNA tienda la columna no existe

    // Cada (concepto, cierre) se deriva UNA vez aunque dos movimientos lo compartan.
    const derivados = new Map<string, { ordenes: OrdenDelLoteDTO[]; suma: Prisma.Decimal }>();
    const detalle: DetalleDeMovimientoLoteDTO[] = movimientos.map((m) => {
      if (m.decision.tipo === "sin_reparto") {
        return { movimientoId: m.id, modo: "sin_reparto", motivo: m.decision.motivo };
      }
      const { cierreId } = m.decision;
      const cabecera = cabeceras.get(cierreId);
      if (cabecera === undefined) {
        // El origen apunta a un cierre que no esta. El detalle de una fila responde «no encontrado»;
        // aqui no hay fila que callar: se falla ruidoso y la descarga avisa (R43), sin archivo.
        throw new Error(`detalle en lote: el cierre de origen de un movimiento no existe`);
      }
      const clave = `${claveDeFuente(m.fuente)}|${cierreId}`;
      let d = derivados.get(clave);
      if (d === undefined) {
        const filasDelCierre = filas.get(claveDeFuente(m.fuente))?.get(cierreId) ?? [];
        let suma = new Prisma.Decimal(0);
        const ordenes = filasDelCierre.map((fila): OrdenDelLoteDTO => {
          // R21: la MISMA derivacion que el detalle de una fila. El `?? 0` es inalcanzable mientras el
          // test de equivalencia de la 344 este verde (el `WHERE` eligio justo las que derivan).
          const aporte = aporteDeOrden(m.fuente, fila.orden, fila.gestiones) ?? new Prisma.Decimal(0);
          suma = suma.plus(aporte);
          return {
            guia: fila.numGuia === null ? null : String(fila.numGuia),
            remision: fila.numRemision,
            destinatario: fila.destinatario,
            tiendaNombre: conTienda ? fila.tiendaNombre : null,
            resultados: fila.gestiones.map((g) => g.resultado),
            aporte: aporte.toFixed(2),
          };
        });
        d = { ordenes, suma };
        derivados.set(clave, d);
      }
      return {
        movimientoId: m.id,
        modo: "ordenes",
        cierre: { fecha: cabecera.fecha, mensajeroNombre: conMensajero ? cabecera.mensajeroNombre : null },
        ordenes: d.ordenes,
        suma: d.suma.toFixed(2),
        // R22/R23: lo decide el servidor, con Decimal. El navegador no suma.
        cuadra: d.suma.equals(new Prisma.Decimal(m.monto)),
      };
    });

    return { status: "ok", detalle };
  }

  /** Los movimientos en el orden recibido, con su fuente y su decision de reparto. */
  private async resolverMovimientos(
    input: DetallarEnLoteInput,
    tiendaId: string | undefined,
  ): Promise<MovimientoResuelto[]> {
    if (input.superficie === "caja") {
      return input.movimientos.map((m) => {
        const fuente = FUENTE_CAJA[m.categoria];
        return { id: m.id, monto: m.monto, fuente, decision: fuenteDeMovimiento(m, fuente) };
      });
    }
    if (input.movimientoIds.length === 0 || tiendaId === undefined) return [];
    // R34: la tienda en el `WHERE` de ESTA lectura. Una fila que no sea de esa tienda no vuelve.
    const leidas = await this.movimientosDeTienda.listarPorIdsDeTienda(input.movimientoIds, tiendaId);
    const porId = new Map(leidas.map((f) => [f.id, f]));
    return input.movimientoIds.map((id) => {
      const fila = porId.get(id);
      if (fila === undefined) {
        // Los ids vienen de la lectura del MISMO servidor y de la MISMA cuenta: si uno no esta en el
        // libro de esa tienda, algo no cuadra y no se inventa un detalle vacio.
        throw new Error("detalle en lote: un movimiento de la hoja no pertenece al libro de la tienda");
      }
      const fuente = FUENTE_TIENDA[fila.categoria];
      return { id: fila.id, monto: fila.monto, fuente, decision: fuenteDeMovimiento(fila, fuente) };
    });
  }
}

/** La clave de un concepto con reparto: dos movimientos del mismo concepto comparten consultas. */
function claveDeFuente(fuente: FuenteDeAporte): string {
  return fuente.tipo === "concepto_ordenex" ? fuente.concepto : fuente.tipo;
}

function agruparPorConcepto(movimientos: readonly MovimientoResuelto[]): Map<string, GrupoDeConcepto> {
  const grupos = new Map<string, GrupoDeConcepto>();
  for (const m of movimientos) {
    if (m.decision.tipo !== "reparto") continue;
    const clave = claveDeFuente(m.fuente);
    const grupo = grupos.get(clave);
    if (grupo === undefined) grupos.set(clave, { criterio: m.decision.criterio, cierreIds: new Set([m.decision.cierreId]) });
    else grupo.cierreIds.add(m.decision.cierreId);
  }
  return grupos;
}

/** Los cierres en tramos de `TRAMO_CIERRES_LOTE`, en un orden estable (R37: acota cada consulta). */
function enTramos(ids: ReadonlySet<string>): string[][] {
  const ordenados = [...ids].sort();
  const tamano = detalleMovimientoConfig.TRAMO_CIERRES_LOTE;
  const tramos: string[][] = [];
  for (let i = 0; i < ordenados.length; i += tamano) tramos.push(ordenados.slice(i, i + tamano));
  return tramos;
}
