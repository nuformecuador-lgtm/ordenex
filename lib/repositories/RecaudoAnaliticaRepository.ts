import {
  Prisma,
  type PrismaClient,
  type WalletTiendaMovimientoCategoria,
} from "@prisma/client";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type {
  AgregadoTiendaLedger,
  IRecaudoAnaliticaRepository,
  TotalPorMetodoCierre,
} from "@/lib/interfaces/repositories/IRecaudoAnaliticaRepository";
import { WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet-tienda";

// Feature 127 (T C.2) — repositorio del COD RECAUDADO. DOS METODOS QUE NO SE FUNDEN ⟨D6(a)⟩.
//
// La separacion es el contrato, no un detalle de implementacion (R19/R38). El catalogo declara
// `cod_recaudado` con granos fecha × tienda × metodo_pago, y ese cubo NO EXISTE en las fuentes
// permitidas: el metodo de pago solo vive en los tres `total_*` del cierre, y un cierre es de un
// MENSAJERO, no de una tienda; el ledger de tienda, por su parte, no tiene columna de metodo.
// Cruzarlos exigiria bajar a `orden`/`gestion_orden`, que es justo lo que esta feature tiene
// prohibido. Asi que se sirven DOS proyecciones legales, cada una de su tabla, y sumarlas
// contaria el mismo colon dos veces: un mismo cierre puede llevar ordenes de varias tiendas.
//
// Por eso este archivo NO tiene —ni puede tener— un metodo que devuelva "la cifra". Cada metodo
// consulta UNA tabla y ninguna suma cruza de una a la otra. La union de las dos vistas, con sus
// ids distintos y su `sumableCon: []`, la arma el servicio.
//
// LOS CIERRES NO RESUELTOS NO APORTAN IMPORTE (R25). `porMetodoDeCierresResueltos` filtra por
// `estado: "aprobado"`: el dinero de un cierre `solicitado` todavia no existe, y contarlo aqui
// lo haria aparecer OTRA VEZ el dia que se apruebe. Esos cierres se ven —con su estado y su
// conteo— en `conciliacion_cierres`, y solo ahi.
//
// LA COORDENADA TEMPORAL ⟨D2(b)⟩ R26: el cierre se fecha por `resuelto_at` (el mismo instante en
// que el feed escribe en los ledgers), el ledger por `fecha_movimiento`. Las dos ventanas son la
// `[rango.desde, rango.hasta)` que produjo `resolverRango`; aqui no se construye ninguna fecha.
//
// SOLO CONSULTAS (R30) y sin `try/catch` (R32). No se usa `consulta.alcance` (R9).

/** Cliente Prisma MINIMO: las dos tablas que `cod_recaudado` declara, y ninguna mas. */
type RecaudoPrismaClient = Pick<PrismaClient, "cierreDia" | "walletTiendaMovimiento">;

/** El universo del enum del ledger de tienda (fuente unica de la 43), para intersecar. */
const CATEGORIAS_DE_TIENDA: ReadonlySet<string> = new Set(WALLET_TIENDA_MOVIMIENTO_CATEGORIA_SEED);

/**
 * Las categorias del catalogo que EXISTEN en el ledger de tienda (R17).
 *
 * Aqui se INTERSECA y no se valida en estricto, al reves que en la caja principal, y es a
 * proposito: `cod_recaudado` es la unica metrica que declara vocabulario de DOS fuentes a la vez
 * (`efectivo`/`SINPE`/`transferencia` son los `total_*` del cierre; `cod_recaudado` es la
 * categoria del ledger). Exigir que todo lo declarado sea del ledger haria imposible servir la
 * metrica tal como el catalogo la define. Lo que si se exige es que la interseccion NO quede
 * vacia: una vista de dinero sin categorias que consultar no es "cero", es una consulta rota.
 */
function categoriasDeLedgerDeTienda(
  consulta: ConsultaAnalitica,
): readonly WalletTiendaMovimientoCategoria[] {
  const declaradas = consulta.metrica.definicion.categorias ?? [];
  const propias = declaradas.filter((c) => CATEGORIAS_DE_TIENDA.has(c));
  if (propias.length === 0) {
    throw new Error(
      `analitica financiera: la metrica "${consulta.metrica.id}" no declara ninguna categoria del ledger de tienda`,
    );
  }
  return propias as readonly WalletTiendaMovimientoCategoria[];
}

/** `Decimal | null` -> STRING escala 2. `null` = el agregado no encontro ni una fila. */
function importe(valor: Prisma.Decimal | null): string {
  return (valor ?? new Prisma.Decimal(0)).toFixed(2);
}

export class RecaudoAnaliticaRepository implements IRecaudoAnaliticaRepository {
  constructor(private readonly prisma: RecaudoPrismaClient) {}

  /**
   * Vista `cod_recaudado__por_metodo`: Σ de los tres `total_*` SNAPSHOT de los `cierre_dia`
   * **aprobados** cuyo `resuelto_at` cae en la ventana.
   *
   * Los tres metodos salen como una lista de longitud fija y en orden fijo: son COLUMNAS del
   * snapshot, no vocabulario del catalogo, asi que no hay `orderBy` que pedirle a la base ni
   * grupo que pueda faltar (R28). Un metodo sin dinero en el rango sale como `"0.00"`, que es
   * cierto; no se omite, para que la vista tenga siempre los mismos tres cubos.
   *
   * OJO con el vocabulario: la columna es `total_simpe` y el catalogo escribe "SINPE" en la
   * descripcion. Manda la columna; la etiqueta de presentacion es de la 132/134.
   */
  async porMetodoDeCierresResueltos(
    consulta: ConsultaAnalitica,
  ): Promise<readonly TotalPorMetodoCierre[]> {
    const agregado = await this.prisma.cierreDia.aggregate({
      where: {
        estado: "aprobado",
        resueltoAt: { gte: consulta.rango.desde, lt: consulta.rango.hasta },
      },
      _sum: { totalEfectivo: true, totalSimpe: true, totalTransferencia: true },
    });

    return [
      { metodo: "efectivo", suma: importe(agregado._sum.totalEfectivo) },
      { metodo: "simpe", suma: importe(agregado._sum.totalSimpe) },
      { metodo: "transferencia", suma: importe(agregado._sum.totalTransferencia) },
    ];
  }

  /**
   * Vista `cod_recaudado__por_tienda`: Σ `monto` del ledger de tienda por `(tienda_id, tipo)`,
   * con las categorias del catalogo y `fecha_movimiento ∈ [desde, hasta)`.
   *
   * El desglose por `tipo` alimenta el `neto` con signo de ⟨D1⟩/R37; el `orderBy` por
   * `(tienda_id, tipo)` hace la secuencia reproducible (R28). Esta consulta NO ve los cierres y
   * la de arriba NO ve el ledger: es lo que impide que las dos vistas se sumen sin querer.
   */
  async porTiendaDeLedger(consulta: ConsultaAnalitica): Promise<readonly AgregadoTiendaLedger[]> {
    const grupos = await this.prisma.walletTiendaMovimiento.groupBy({
      by: ["tiendaId", "tipo"],
      where: {
        categoria: { in: [...categoriasDeLedgerDeTienda(consulta)] },
        fechaMovimiento: { gte: consulta.rango.desde, lt: consulta.rango.hasta },
      },
      _sum: { monto: true },
      orderBy: [{ tiendaId: "asc" }, { tipo: "asc" }],
    });

    return grupos.map((g) => ({
      tiendaId: g.tiendaId,
      tipo: g.tipo,
      suma: importe(g._sum.monto),
    }));
  }
}
