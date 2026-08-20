import type { PrismaClient } from "@prisma/client";
import type { IRankingRepository } from "@/lib/interfaces/repositories/IRankingRepository";
import type { ConteoPorMensajero } from "@/lib/types/ranking";

// Feature 76 (design §3) — repositorio de agregacion del ranking DIARIO. SOLO queries Prisma
// (dos groupBy); sin logica de negocio ni `Date.now()`: el rango del dia (CR) llega ya
// calculado por el service (`desde`/`hasta`, half-open [desde, hasta)). Cliente acotado a lo
// que necesita (patron GastoFijoPlantillaRepository).
//
// ⚠️ FEATURE 246 (T6.2/T8.1, D7 firmada el 2026-08-20) — LA CABECERA DE ANTES YA NO ES CIERTA.
// Decia que el denominador eran «las ordenes asignadas HOY(CR) por mensajero actualmente
// asignado», es decir por `asignado_at`. Desde D7 el denominador cuenta por DIA DE REPARTO, con
// DOS RAMAS:
//
//   (a) `fecha_reparto = diaReparto` — la orden que bodega reservo para ESE dia (R36/R38);
//   (b) `fecha_reparto IS NULL` Y `asignado_at ∈ [desde, hasta)` — el RESPALDO (R37/R43).
//
// POR QUE LA RAMA (b) NO ES OPCIONAL, Y ES EL PUNTO DE DINERO DE ESTA FICHA. Las ordenes
// anteriores al despliegue tienen `fecha_reparto = NULL` para siempre (no hay backfill y no lo
// habra). Si el denominador contase SOLO la rama (a), esas ordenes DESAPARECERIAN del denominador:
// con el numerador intacto, TODOS los porcentajes subirian de golpe, el umbral de podio
// (`RANKING_MIN_ASIGNADAS`) dejaria fuera a quien no tuviera ordenes nuevas, y EL PODIO DE ESE DIA
// SERIA FALSO PARA TODOS A LA VEZ — con su `premio_ranking` detras. La rama (b) hace que esas
// ordenes sigan contando POR DONDE CONTABAN ANTES.
//
// POR QUE LAS DOS RAMAS SON DISJUNTAS, Y POR QUE ESO ES LO MAS BARATO DE ROMPER AQUI. La rama (b)
// lleva `fechaReparto: null` ADEMAS del rango. Sin esa clausula, una orden asignada hoy para
// mañana entraria por LAS DOS —en el denominador de hoy por `asignado_at` y en el de mañana por
// `fecha_reparto`— y quedaria contada dos veces en dias distintos. Con ella, cada orden aporta
// exactamente 1 a exactamente un dia, por construccion.
//
// POR QUE UN `OR` Y NO UN `COALESCE(fecha_reparto, dia(asignado_at)) = X`: el `COALESCE` mezcla
// las dos convenciones dentro de una expresion, NO es indexable por ningun indice —ni el nuevo ni
// los que ya hay— y obligaria a meter `- interval '6 hours'` en el SQL, que es la segunda
// definicion del dia que design §3 prohibe. El `OR` tiene las dos ramas indexables por separado y
// Postgres las combina con un `BitmapOr` (medido: ver el `EXPLAIN` en `progress/impl_246.md`).
//
// EL RESPALDO NO SE RETIRA CUANDO ENVEJEZCA. Pasados unos dias no quedara ninguna orden viva sin
// `fecha_reparto`, pero la rama (b) se queda: es tambien la respuesta correcta para cualquier orden
// que llegue a tener mensajero por una via que no estampe la columna.
type RankingPrismaClient = Pick<PrismaClient, "gestionOrden" | "orden">;

export class RankingRepository implements IRankingRepository {
  constructor(private readonly prisma: RankingPrismaClient) {}

  /** R1: entregas exitosas VIGENTES de HOY(CR) por mensajero (numerador). */
  async contarEntregadasPorMensajero(desde: Date, hasta: Date): Promise<ConteoPorMensajero[]> {
    const rows = await this.prisma.gestionOrden.groupBy({
      by: ["mensajeroId"],
      where: {
        resultado: "entregada", // solo entregas exitosas
        anuladaAt: null, // feature 67: solo gestiones VIGENTES (no intentos deshechos)
        createdAt: { gte: desde, lt: hasta }, // HOY(CR), half-open
      },
      _count: { _all: true },
    });
    return rows.map((r) => ({ mensajeroId: r.mensajeroId, total: r._count._all }));
  }

  /**
   * R36/R37/R38/R43: denominador = ordenes cuyo DIA DE REPARTO es ese dia, por mensajero
   * actualmente asignado. Las dos ramas y su porque estan en la cabecera del archivo.
   *
   * Los TRES valores llegan calculados por el llamador y con SU convencion: `diaReparto` es un
   * `DATE` (medianoche UTC de la fecha CR) y `desde`/`hasta` son cotas `timestamp`
   * (`...T06:00:00.000Z`). Aqui no se deriva ninguno de otro: hacerlo seria reintroducir el
   * desfase de seis horas que cerro la ficha 166.
   */
  async contarAsignadasPorMensajero(
    desde: Date,
    hasta: Date,
    diaReparto: Date,
  ): Promise<ConteoPorMensajero[]> {
    const rows = await this.prisma.orden.groupBy({
      by: ["mensajeroAsignadoId"],
      where: {
        mensajeroAsignadoId: { not: null },
        OR: [
          // (a) R36/R38: la orden RESERVADA para ese dia. Es la rama que hace que una orden
          // asignada hoy para mañana cuente en el denominador de mañana y NO en el de hoy.
          { fechaReparto: diaReparto },
          // (b) R37/R43: RESPALDO para las ordenes sin dia de reparto — las anteriores al
          // despliegue. `fechaReparto: null` NO sobra: es lo que hace las dos ramas DISJUNTAS y
          // lo que impide que una misma orden se cuente en dos dias distintos.
          { fechaReparto: null, asignadoAt: { gte: desde, lt: hasta } },
        ],
      },
      _count: { _all: true },
    });
    // El `where` garantiza `mensajeroAsignadoId` no nulo; el filtro descarta el caso null
    // residual sin afectar el conteo y satisface al tipado.
    return rows.flatMap((r) =>
      r.mensajeroAsignadoId === null
        ? []
        : [{ mensajeroId: r.mensajeroAsignadoId, total: r._count._all }],
    );
  }
}
