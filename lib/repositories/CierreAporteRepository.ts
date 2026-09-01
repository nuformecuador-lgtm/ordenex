import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  AlcanceDeCierre,
  CabeceraDeCierre,
  FiltroOrdenesQueAportan,
  ICierreAporteRepository,
  OrdenAporteRow,
} from "@/lib/interfaces/repositories/ICierreAporteRepository";
import type { CriterioDeAporte } from "@/lib/utils/aporte-por-orden";
import { DETALLE_SELECT, tarifaDe } from "@/lib/utils/cierre-detalle";
import { NOMBRE_USUARIO_SELECT, nombreCompletoUsuario } from "@/lib/utils/nombre-usuario";
import type { PaginaRepositorio } from "@/lib/utils/rango-pagina";

// Cliente Prisma acotado a lo que este repo necesita (patron WalletMovimientoRepository).
type CierreAportePrismaClient = Pick<PrismaClient, "cierreDetail" | "cierreDia">;

/**
 * Ficha 344 (T3.1, design §3.4) — el `WHERE` del detalle, TRADUCIDO del criterio.
 *
 * Aqui no se decide nada: los cinco hechos del criterio son columnas y esta funcion los escribe
 * en el lenguaje de Prisma. La otra forma del mismo criterio es `satisfaceCriterio`, y las dos
 * se atan con el test de equivalencia exhaustivo. NUNCA se anade aqui una condicion que el
 * criterio no declare: seria una segunda definicion, que es lo que R18 prohibe.
 *
 * DOS DECISIONES QUE HAY QUE LEER ANTES DE TOCAR ESTO:
 *
 * 1. **La subconsulta sobre `gestiones` lleva `{ cierreId, resultado }` y NADA MAS. Sin
 *    `anuladaAt: null`.** El feed que produjo el importe consulta
 *    `gestionOrden.findMany({ where: { cierreId } })`, sin esa clausula. Anadirla «por
 *    prudencia» seria un criterio que el PRODUCTOR no tiene: una gestion anulada despues de
 *    aprobar el cierre seguiria dentro del importe y desapareceria del detalle, y la suma
 *    dejaria de cuadrar. Se replica el `where` del feed, exactamente.
 *
 * 2. **`tiendaId` se escribe AL FINAL, despues de todo spread.** Es la convencion que este repo
 *    ya tiene escrita para el ledger de la tienda: aunque manana alguien anadiera un spread
 *    encima, esta linea lo pisa. Un fallo aqui no devuelve menos filas: devuelve las ordenes de
 *    OTRA tienda.
 */
function buildWhere(
  cierreId: string,
  criterio: CriterioDeAporte,
  tiendaId: string | undefined,
): Prisma.CierreDetailWhereInput {
  return {
    cierreId,
    ...(criterio.exigeTarifa ? { tarifaId: { not: null } } : {}),
    ...(criterio.exigeCobraComision ? { cobraComision: true } : {}),
    // Supresion de los aportes en cero (Q2): `monto_cobrar > 0` excluye tambien el NULL, que es
    // lo correcto —sin COD no hay comision que cobrar—. Va en el `WHERE`, no en memoria, para
    // que el `count` cuente EXACTAMENTE las filas que se muestran (R28).
    ...(criterio.exigeMontoCobrar ? { montoCobrar: { gt: 0 } } : {}),
    // EXISTS de SQL, no un filtro en memoria (R21): la orden entra si ALGUNA de sus gestiones
    // de ESTE cierre casa con el criterio.
    orden: {
      gestiones: {
        some: {
          cierreId,
          resultado: { in: [...criterio.resultados] },
          ...(criterio.exigeMontoRecibido ? { montoRecibido: { gt: 0 } } : {}),
        },
      },
    },
    ...(tiendaId !== undefined ? { tiendaId } : {}), // AL FINAL: nada lo puede pisar
  };
}

/**
 * Ficha 344 (T3.2, design §3.4, R30) — el orden es TOTAL.
 *
 * Se ordena por el numero de guia CONGELADO (que es lo que la pantalla ensena) y se desempata
 * por `id`, que es unico: sin ese desempate, dos filas con la misma guia congelada quedan en
 * orden indefinido y paginar repite u omite una orden. `nulls: "last"` porque `num_guia` es
 * nullable en el snapshot (una orden que nunca genero guia se identifica por su remision).
 *
 * NO se ordena por el aporte: el aporte es DERIVADO y no existe como columna.
 */
const ORDEN_TOTAL = [
  { numGuia: { sort: "asc", nulls: "last" } },
  { id: "asc" },
] as const satisfies readonly Prisma.CierreDetailOrderByWithRelationInput[];

/**
 * Ficha 344 (design §3.4) — repositorio de las ordenes que componen el importe de un movimiento
 * de cierre. SOLO queries Prisma: ni permisos, ni formula, ni recorte en memoria.
 *
 * La proyeccion reutiliza `DETALLE_SELECT` —la MISMA que usan los dos feeds del cierre para
 * derivar— mas lo descriptivo congelado. Si un dia esa proyeccion gana una entrada de la
 * formula, este detalle la gana con ella y no puede quedarse atras.
 */
export class CierreAporteRepository implements ICierreAporteRepository {
  constructor(private readonly prisma: CierreAportePrismaClient) {}

  async listarOrdenesQueAportan(
    f: FiltroOrdenesQueAportan,
  ): Promise<PaginaRepositorio<OrdenAporteRow>> {
    const where = buildWhere(f.cierreId, f.criterio, f.tiendaId);

    // R28: la pagina y el TOTAL salen del MISMO `where`, en la misma llamada.
    const [filas, total] = await Promise.all([
      this.prisma.cierreDetail.findMany({
        where,
        select: {
          ...DETALLE_SELECT,
          id: true,
          numGuia: true,
          numRemision: true,
          destinatario: true,
          tiendaNombre: true,
          // TODAS las gestiones de esa orden en ESE cierre, no solo las que casan con el
          // criterio: el importe se produjo acumulandolas todas (las que no aportan devuelven
          // un concepto AUSENTE y no suman nada).
          orden: {
            select: {
              gestiones: {
                where: { cierreId: f.cierreId },
                // Orden estable: sin el, Postgres devuelve las gestiones de una orden en el
                // orden que le conviene y la columna «Resultado» de una orden con dos
                // gestiones cambiaria de sitio entre dos lecturas iguales.
                orderBy: { createdAt: "asc" },
                select: { resultado: true, montoRecibido: true },
              },
            },
          },
        },
        orderBy: [...ORDEN_TOTAL],
        skip: f.rango.skip,
        take: f.rango.take,
      }),
      this.prisma.cierreDetail.count({ where }),
    ]);

    return {
      items: filas.map((d) => ({
        ordenId: d.ordenId,
        numGuia: d.numGuia,
        numRemision: d.numRemision,
        destinatario: d.destinatario,
        tiendaNombre: d.tiendaNombre,
        orden: {
          esCentral: d.esCentral,
          esZonaEspecial: d.esZonaEspecial,
          // Money-safe: Decimal -> STRING escala 2, nunca number (igual que los dos feeds).
          montoCobrar: d.montoCobrar === null ? null : d.montoCobrar.toFixed(2),
          cobraComision: d.cobraComision,
          // La MISMA reconstruccion que usan los feeds; `null` = sin tarifa vigente al
          // solicitar (gap R9 preservado: esa orden no deriva ningun concepto).
          tarifa: tarifaDe(d),
        },
        gestiones: d.orden.gestiones.map((g) => ({
          resultado: g.resultado,
          montoRecibido: g.montoRecibido === null ? null : g.montoRecibido.toFixed(2),
        })),
      })),
      total,
    };
  }

  /** R12: el «de 23». Mismo acotamiento por tienda que la pagina, escrito AL FINAL. */
  async contarOrdenesDelCierre(f: AlcanceDeCierre): Promise<number> {
    return this.prisma.cierreDetail.count({
      where: {
        cierreId: f.cierreId,
        ...(f.tiendaId !== undefined ? { tiendaId: f.tiendaId } : {}),
      },
    });
  }

  /** R9/R15: la fecha del cierre y el nombre del mensajero (el servicio decide si viaja). */
  async obtenerCabeceraDeCierre(cierreId: string): Promise<CabeceraDeCierre | null> {
    const cierre = await this.prisma.cierreDia.findUnique({
      where: { id: cierreId },
      select: { solicitadoAt: true, mensajero: { select: NOMBRE_USUARIO_SELECT } },
    });
    if (cierre === null) return null;
    return {
      fecha: cierre.solicitadoAt.toISOString(),
      mensajeroNombre: nombreCompletoUsuario(cierre.mensajero),
    };
  }
}
