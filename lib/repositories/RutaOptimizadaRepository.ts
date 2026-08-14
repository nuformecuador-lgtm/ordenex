// Feature 92 (design §5.2, R23/R26/R27) — repositorio de la ruta optimizada. SOLO queries
// Prisma (docs/architecture.md §Repository): ninguna decision de negocio vive aqui.
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  IRutaOptimizadaRepository,
  OrigenFuente,
  OrigenUbicacion,
  ReemplazarSecuenciaMeta,
  RutaOptimizadaDTO,
  TrazadoPersistido,
  TramoPersistido,
} from "@/lib/interfaces/repositories/IRutaOptimizadaRepository";

// Cliente Prisma MINIMO consumido (patron `GestionOrdenRepository`): las dos tablas de la
// feature mas `$transaction` para el reemplazo atomico de la secuencia.
type RutaPrismaClient = Pick<
  PrismaClient,
  "rutaOptimizada" | "rutaOptimizadaParada" | "$transaction"
>;

/** Convierte un `Decimal` de Prisma a `number`, tolerando el null de la columna. */
function toNumber(value: Prisma.Decimal | null): number | null {
  return value !== null ? value.toNumber() : null;
}

/** Las cuatro columnas del trazado, tal y como salen de la fila. */
interface TrazadoColumnas {
  trazadoPolilinea: string | null;
  trazadoDistanciaM: number | null;
  trazadoDuracionS: number | null;
  trazadoFuente: string | null;
}

/**
 * Arma el trazado del DTO. La polilinea es la pieza IMPRESCINDIBLE: sin ella no hay nada que
 * pintar, asi que su ausencia (o una cadena vacia, que un dia pudo escribirse) anula el
 * trazado entero en vez de producir un objeto a medias que el mapa tendria que resolver.
 */
function toTrazado(row: TrazadoColumnas): TrazadoPersistido | null {
  if (row.trazadoPolilinea === null || row.trazadoPolilinea === "") return null;
  return {
    encodedPolyline: row.trazadoPolilinea,
    distanciaM: row.trazadoDistanciaM,
    duracionS: row.trazadoDuracionS,
    // Mismo criterio que `origen_fuente`: columna TEXT con vocabulario propio, se estrecha
    // sin validar. `local` es el default defensivo — si el valor fuera basura, tratarlo como
    // el trazado degradado hace que la UI lo pinte punteado en vez de prometer calles.
    fuente: row.trazadoFuente === "routes" ? "routes" : "local",
  };
}

export class RutaOptimizadaRepository implements IRutaOptimizadaRepository {
  constructor(private readonly prisma: RutaPrismaClient) {}

  async findByMensajero(mensajeroId: string): Promise<RutaOptimizadaDTO | null> {
    const row = await this.prisma.rutaOptimizada.findUnique({
      where: { mensajeroId },
      include: {
        paradas: {
          select: {
            ordenId: true,
            secuencia: true,
            tramoPolilinea: true,
            tramoDistanciaM: true,
            tramoDuracionS: true,
          },
        },
      },
    });
    if (row === null) return null;
    return {
      id: row.id,
      mensajeroId: row.mensajeroId,
      estado: row.estado,
      calculadaAt: row.calculadaAt,
      origenLat: toNumber(row.origenLat),
      origenLng: toNumber(row.origenLng),
      origenAt: row.origenAt,
      // La columna es TEXT (no enum) y el vocabulario es nuestro: se estrecha al tipo del
      // dominio sin validar, igual que `geocode_status` en la 91.
      origenFuente: row.origenFuente as OrigenFuente | null,
      huellaSet: row.huellaSet,
      ultimoError: row.ultimoError,
      trazado: toTrazado(row),
      secuenciaPorOrden: new Map(row.paradas.map((p) => [p.ordenId, p.secuencia])),
      // Solo las paradas que YA tienen tramo entran al mapa: una entrada con la polilinea
      // vacia obligaria a cada consumidor a distinguir «no hay tramo» de «hay uno invisible».
      tramoPorOrden: new Map(
        row.paradas
          .filter((p) => p.tramoPolilinea !== null && p.tramoPolilinea !== "")
          .map((p) => [
            p.ordenId,
            {
              encodedPolyline: p.tramoPolilinea as string,
              distanciaM: p.tramoDistanciaM,
              duracionS: p.tramoDuracionS,
            },
          ]),
      ),
    };
  }

  /**
   * R23: upsert de la CABECERA con el origen. NO toca `calculada_at`, `huella_set` ni las
   * paradas: capturar una posicion nueva no invalida el orden ya calculado, solo cambia el
   * punto desde el que se calculara el siguiente.
   */
  async upsertOrigen(mensajeroId: string, ubicacion: OrigenUbicacion): Promise<void> {
    const datos = {
      origenLat: new Prisma.Decimal(ubicacion.lat),
      origenLng: new Prisma.Decimal(ubicacion.lng),
      origenAt: ubicacion.capturadaAt,
      origenFuente: ubicacion.fuente,
    };
    await this.prisma.rutaOptimizada.upsert({
      where: { mensajeroId },
      // Fila nueva: `calculada_at` queda NULL (nunca se calculo) y el estado toma su
      // default `vigente`, que es correcto — no hay ningun orden previo que contradecir.
      create: { mensajeroId, ...datos },
      update: datos,
    });
  }

  /**
   * R26: reemplazo ATOMICO. Los tres pasos —crear/actualizar cabecera, borrar paradas
   * viejas, insertar las nuevas— van en UNA transaccion: nunca existe un instante visible
   * con la secuencia a medias. Si algo falla, la ruta anterior sigue entera.
   */
  async reemplazarSecuencia(
    mensajeroId: string,
    secuencia: string[],
    meta: ReemplazarSecuenciaMeta,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const cabecera = {
        estado: "vigente" as const,
        calculadaAt: meta.calculadaAt,
        origenLat: meta.origen !== null ? new Prisma.Decimal(meta.origen.lat) : null,
        origenLng: meta.origen !== null ? new Prisma.Decimal(meta.origen.lng) : null,
        origenFuente: meta.origen?.fuente ?? null,
        huellaSet: meta.huellaSet,
        // R27 a la inversa: una optimizacion exitosa LIMPIA el error anterior; si no, un
        // fallo viejo seguiria alimentando el aviso de la UI para siempre.
        ultimoError: null,
        // El trazado viejo describe el orden VIEJO. Se limpia AQUI, dentro de la misma
        // transaccion que reemplaza las paradas, para que no exista ningun instante visible
        // en el que la polilinea y la secuencia se contradigan. `guardarTrazado` lo repone
        // despues, ya condicionado a esta `huellaSet`.
        trazadoPolilinea: null,
        trazadoDistanciaM: null,
        trazadoDuracionS: null,
        trazadoFuente: null,
      };
      const ruta = await tx.rutaOptimizada.upsert({
        where: { mensajeroId },
        create: { mensajeroId, ...cabecera },
        update: cabecera,
        select: { id: true },
      });
      // DELETE + createMany en vez de un diff posicion a posicion: la secuencia es
      // pequena y se recalcula entera, y el borrado previo es lo que evita chocar con el
      // indice unico `(ruta_id, secuencia)` al reordenar.
      await tx.rutaOptimizadaParada.deleteMany({ where: { rutaId: ruta.id } });
      if (secuencia.length > 0) {
        await tx.rutaOptimizadaParada.createMany({
          data: secuencia.map((ordenId, idx) => ({
            rutaId: ruta.id,
            ordenId,
            secuencia: idx + 1, // 1-based: la primera parada es la posicion 1
          })),
        });
      }
    });
  }

  /**
   * Escritura CONDICIONADA a la huella. `updateMany` y no `update` a proposito: admite un
   * `where` compuesto y no lanza cuando no encaja ninguna fila, que es justo la semantica
   * que se busca — si la ruta se recalculo mientras Routes respondia, este trazado ya no le
   * corresponde a nadie y se descarta en silencio.
   */
  async guardarTrazado(
    mensajeroId: string,
    huellaSet: string,
    trazado: TrazadoPersistido,
    tramos: TramoPersistido[] = [],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const actualizadas = await tx.rutaOptimizada.updateMany({
        where: { mensajeroId, huellaSet },
        data: {
          trazadoPolilinea: trazado.encodedPolyline,
          // Las columnas son INTEGER: la distancia viene en metros enteros de Routes, pero el
          // trazado local la calcula en coma flotante. Se redondea aqui, que es la frontera
          // con la DB, en vez de dejar que Prisma reviente con un decimal.
          trazadoDistanciaM: trazado.distanciaM !== null ? Math.round(trazado.distanciaM) : null,
          trazadoDuracionS: trazado.duracionS !== null ? Math.round(trazado.duracionS) : null,
          trazadoFuente: trazado.fuente,
        },
      });
      // La huella ya no encaja: la ruta se recalculo mientras Routes respondia. Ni la cabecera
      // ni los tramos son suyos. Se sale sin tocar nada mas — escribir los tramos aqui seria
      // pegarlos sobre una secuencia ajena, que es justo lo que la condicion evita.
      if (actualizadas.count === 0 || tramos.length === 0) return;

      const ruta = await tx.rutaOptimizada.findUnique({
        where: { mensajeroId },
        select: { id: true },
      });
      if (ruta === null) return;

      // Un UPDATE por tramo. Son <= RUTA_MAX_PARADAS filas dentro de una transaccion que ya
      // esta abierta, y `updateMany` no admite un valor distinto por fila. La alternativa
      // —un CASE gigante en SQL crudo— cambiaria varias lineas legibles por una ilegible.
      for (const [i, tramo] of tramos.entries()) {
        await tx.rutaOptimizadaParada.updateMany({
          where: { rutaId: ruta.id, secuencia: i + 1 }, // 1-based, como la escribe reemplazar
          data: {
            tramoPolilinea: tramo.encodedPolyline,
            tramoDistanciaM: tramo.distanciaM !== null ? Math.round(tramo.distanciaM) : null,
            tramoDuracionS: tramo.duracionS !== null ? Math.round(tramo.duracionS) : null,
          },
        });
      }
    });
  }

  /**
   * R27: SOLO la cabecera. Las paradas NO se tocan — el ultimo orden optimizado valido se
   * conserva intacto y el sistema jamas cae en silencio a `createdAt desc`.
   */
  async marcarDesactualizada(mensajeroId: string, ultimoError: string): Promise<void> {
    await this.prisma.rutaOptimizada.upsert({
      where: { mensajeroId },
      create: { mensajeroId, estado: "desactualizada", ultimoError },
      update: { estado: "desactualizada", ultimoError },
    });
  }
}
