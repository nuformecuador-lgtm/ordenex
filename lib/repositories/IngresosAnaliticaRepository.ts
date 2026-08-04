import { Prisma, type PrismaClient, type WalletMovimientoCategoria } from "@prisma/client";
import type { ConsultaAnalitica } from "@/lib/analytics/consulta";
import type {
  AgregadoCategoriaCaja,
  IIngresosAnaliticaRepository,
} from "@/lib/interfaces/repositories/IIngresosAnaliticaRepository";
import { WALLET_MOVIMIENTO_CATEGORIA_SEED } from "@/lib/types/wallet";

// Feature 127 (T C.1) — repositorio de la CAJA PRINCIPAL. Sirve las CUATRO metricas que salen
// de `wallet_movimiento`: `ingreso_flete`, `ingreso_comision_cod`, `ingreso_iva` y `egresos`.
//
// SOLO CONSULTAS (R30). Aqui no se resta, no se decide un signo y no se deriva un saldo: la
// fila sale desglosada por `(categoria, tipo)` y el `neto` con signo lo produce el servicio con
// `derivarBalance`. Tampoco hay `try/catch` (R32): un fallo de consulta se propaga tal cual, y
// eso es deliberado — un cero devuelto por un error de base es la peor mentira posible en
// dinero.
//
// UNA sola tabla (R4): `wallet_movimiento`, que es exactamente lo que las cuatro metricas
// declaran en `fuente.tablas`. Ni un `include`, ni una relacion, ni un `$queryRaw`.
//
// LAS CATEGORIAS LAS MANDA EL CATALOGO (R17). No hay ni un array de categorias escrito a mano
// en este archivo: la lista sale de `consulta.metrica.definicion.categorias`. Lo unico que se
// nombra aqui es el UNIVERSO del enum (`WALLET_MOVIMIENTO_CATEGORIA_SEED`, la fuente unica de
// la 42), y se usa para VALIDAR, no para filtrar: si la metrica declarase una categoria que la
// caja no tiene, la consulta no puede cumplirse y se lanza. Filtrarla en silencio serviria una
// cifra corta sin que nada fallara.
//
// LA VENTANA LA MANDA `resolverRango` (R26): `[rango.desde, rango.hasta)` sobre
// `fecha_movimiento`, semiabierta. Ninguna fecha se construye aqui — un `new Date(fecha)` en
// este archivo reintroduciria el off-by-one de seis horas de la frontera de dia CR.
//
// NO se usa `consulta.alcance` (R9): con el catalogo vigente toda financiera concedida tiene
// alcance global, asi que un `where` de recorte seria codigo muerto que anuncia una privacidad
// que nadie diseño.

/** Cliente Prisma MINIMO (patron `WalletMovimientoRepository`): una sola tabla. */
type IngresosPrismaClient = Pick<PrismaClient, "walletMovimiento">;

/** El universo del enum de la caja, para validar lo que el catalogo declara. */
const CATEGORIAS_DE_CAJA: ReadonlySet<string> = new Set(WALLET_MOVIMIENTO_CATEGORIA_SEED);

/**
 * Las categorias que la metrica declara, comprobadas contra el enum de la caja.
 *
 * Lanza en los dos casos en que la consulta no puede significar lo que la metrica promete:
 * sin categorias (agregaria el libro entero bajo el nombre de una metrica concreta) y con una
 * categoria ajena a `wallet_movimiento` (devolveria menos dinero del declarado). Las dos son
 * incoherencias del catalogo, no errores del usuario, y por eso se hacen ruidosas (R32).
 */
function categoriasDeclaradas(consulta: ConsultaAnalitica): readonly WalletMovimientoCategoria[] {
  const declaradas = consulta.metrica.definicion.categorias ?? [];
  if (declaradas.length === 0) {
    throw new Error(
      `analitica financiera: la metrica "${consulta.metrica.id}" no declara categorias y la caja principal no se agrega entera`,
    );
  }
  const ajenas = declaradas.filter((c) => !CATEGORIAS_DE_CAJA.has(c));
  if (ajenas.length > 0) {
    throw new Error(
      `analitica financiera: la metrica "${consulta.metrica.id}" declara categorias que la caja principal no tiene: ${ajenas.join(", ")}`,
    );
  }
  return declaradas as readonly WalletMovimientoCategoria[];
}

export class IngresosAnaliticaRepository implements IIngresosAnaliticaRepository {
  constructor(private readonly prisma: IngresosPrismaClient) {}

  /**
   * Σ `monto` agrupada por `(categoria, tipo)` sobre las categorias del catalogo y la ventana
   * `[desde, hasta)` de `fecha_movimiento`.
   *
   * El desglose por `tipo` NO es un capricho: de ahi sale el `neto` con signo `ingreso − egreso`
   * de ⟨D1⟩/R37, y quien lo aplica es el servicio. Desde ⟨D12⟩ (2026-08-04, feature 183) ese
   * neto lo publican `egresos` y las dos metricas de tesoreria de la 173, no las tres `ingreso_*`
   * —cuya lista es homogenea de prefijo, luego `Σ egreso = 0` siempre—; el desglose se sigue
   * devolviendo igual porque esta consulta no sabe —ni tiene por que saber— quien la pide.
   * El `orderBy` tampoco es defensivo (R28): sin el, el orden de los grupos lo decide el plan de
   * la base y el DTO dejaria de ser reproducible sin que nada fallara.
   *
   * `_sum.monto` viene `null` solo cuando el grupo no existe —y un grupo nace de sus filas—,
   * asi que el `?? 0` de abajo es inalcanzable por la via normal; se deja porque el tipo de
   * Prisma lo admite y porque un `!` seria peor. No es un cero de error: los errores se
   * propagan.
   */
  async sumarPorCategoria(consulta: ConsultaAnalitica): Promise<readonly AgregadoCategoriaCaja[]> {
    const grupos = await this.prisma.walletMovimiento.groupBy({
      by: ["categoria", "tipo"],
      where: {
        categoria: { in: [...categoriasDeclaradas(consulta)] },
        fechaMovimiento: { gte: consulta.rango.desde, lt: consulta.rango.hasta },
      },
      _sum: { monto: true },
      orderBy: [{ categoria: "asc" }, { tipo: "asc" }],
    });

    return grupos.map((g) => ({
      categoria: g.categoria,
      tipo: g.tipo,
      suma: (g._sum.monto ?? new Prisma.Decimal(0)).toFixed(2),
    }));
  }
}
