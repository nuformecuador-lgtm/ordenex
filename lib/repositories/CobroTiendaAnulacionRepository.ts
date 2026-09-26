import { Prisma, type PrismaClient } from "@prisma/client";

import type {
  AnularCobroTiendaRepoInput,
  AnularCobroTiendaRepoResult,
  CobroTiendaAnulacionTxClient,
  EstadoDelCobro,
  ICobroTiendaAnulacionRepository,
} from "@/lib/interfaces/repositories/ICobroTiendaAnulacionRepository";
import type { EstadoDocumentoCaja } from "@/lib/interfaces/services/IWalletService";
import { esP2002, textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";
import { appendAccion, resolverActorCongelado } from "@/lib/repositories/registrar-accion";
import { etiquetaDeEntidad } from "@/lib/types/historial-accion-etiquetas";
import { CUENTA_USUARIO_SELECT, etiquetaDeCuenta } from "@/lib/utils/etiqueta-cuenta";

type CobroTiendaAnulacionPrismaClient = Pick<PrismaClient, "cobroTiendaAnulacion" | "$queryRaw">;

/** El P2002 de la anulacion es el de `UNIQUE(cobro_id)` (la unica otra unica es la PK sobre un uuid nuevo). */
function esChoqueDeAnulacion(error: unknown): boolean {
  if (!esP2002(error)) return false;
  const texto = textoConstraintP2002(error);
  return texto === null || texto.includes("cobro_id") || texto.includes("anulacion");
}

/**
 * FICHA 461 (design §5.3) — la ANULACION de un cobro de Ordenex a una tienda. SOLO queries Prisma.
 * Molde: `PagoPorCuentaTiendaRepository.anular`. La constancia y su fila de historial van en la
 * MISMA transaccion que recibe; los dos contra-asientos (credito a la tienda y reverso en la caja)
 * los escribe `CobroTiendaService` en esa misma transaccion, un instante despues.
 */
export class CobroTiendaAnulacionRepository implements ICobroTiendaAnulacionRepository {
  constructor(private readonly prisma: CobroTiendaAnulacionPrismaClient) {}

  /**
   * R10/R14/R15/R55 — la constancia (motivo, quien, cuando) y `cobro_tienda_anulado`. El motivo vive
   * en su tabla y NO viaja al historial (texto libre, R5 de la 362): la fila lleva el importe del
   * cobro y el NOMBRE de la tienda, como la del registro (381). Si el `UNIQUE(cobro_id)` rechaza la
   * fila, se responde `ya_anulado` y no queda rastro de una anulacion que no ocurrio.
   *
   * FORMA `recibe_tx`, la fuerte: el tipo del primer parametro no expone `$transaction`, asi que
   * este metodo no puede abrir la suya ni escribir fuera. La guardia del censo lo mide.
   */
  async anular(
    tx: CobroTiendaAnulacionTxClient,
    input: AnularCobroTiendaRepoInput,
  ): Promise<AnularCobroTiendaRepoResult> {
    try {
      await tx.cobroTiendaAnulacion.create({
        data: { cobroId: input.cobroId, motivo: input.motivo, anuladoPor: input.anuladoPor },
      });
      const cobro = await tx.walletTiendaMovimiento.findUnique({
        where: { id: input.cobroId },
        select: { monto: true, tienda: { select: CUENTA_USUARIO_SELECT } },
      });
      const actor = await resolverActorCongelado(tx, input.anuladoPor);
      await appendAccion(tx, [
        {
          accion: "cobro_tienda_anulado",
          entidadTipo: "wallet_tienda_movimiento",
          entidadId: input.cobroId,
          // La MISMA etiqueta que la fila del registro del cobro (381): el nombre de la tienda con
          // `etiquetaDeCuenta`, como el registro (458-A, R33). Si la relectura no resuelve, `null`
          // y la fila sale «(sin identificar)», igual que el registro.
          entidadEtiqueta: etiquetaDeEntidad("wallet_tienda_movimiento", {
            tiendaNombre: cobro == null ? null : etiquetaDeCuenta(cobro.tienda),
          }),
          monto: cobro?.monto ?? null,
          ...actor,
        },
      ]);
      return { status: "anulado" };
    } catch (error) {
      if (esChoqueDeAnulacion(error)) return { status: "ya_anulado" };
      throw error;
    }
  }

  /** R15/R17 — tres `EXISTS` en UNA consulta. Los enums se comparan como texto (sin literal tipado). */
  async estadoDelCobro(cobroId: string): Promise<EstadoDelCobro> {
    const filas = await this.prisma.$queryRaw<
      { anulado: boolean; reclasificado: boolean; tiene_cargo: boolean }[]
    >(Prisma.sql`
      SELECT
        EXISTS (SELECT 1 FROM "cobro_tienda_anulacion" a WHERE a."cobro_id" = ${cobroId}) AS anulado,
        EXISTS (
          SELECT 1 FROM "wallet_movimiento" w
          WHERE w."origen_id" = ${cobroId} AND w."origen_tipo"::text = 'cobro_manual_reclasificado'
        ) AS reclasificado,
        EXISTS (
          SELECT 1 FROM "wallet_movimiento" w
          WHERE w."origen_id" = ${cobroId} AND w."categoria"::text = 'ingreso_cobro_tienda'
        ) AS tiene_cargo
    `);
    const fila = filas[0];
    return {
      anulado: fila?.anulado === true,
      reclasificado: fila?.reclasificado === true,
      tieneCargo: fila?.tiene_cargo === true,
    };
  }

  /** R20/R37 — UNA consulta para todos los ids de la pagina; cada id vuelve, anulado o no. */
  async estadoDeDocumentos(ids: readonly string[]): Promise<EstadoDocumentoCaja[]> {
    if (ids.length === 0) return [];
    const anuladas = await this.prisma.cobroTiendaAnulacion.findMany({
      where: { cobroId: { in: [...ids] } },
      select: { cobroId: true },
    });
    const anulados = new Set(anuladas.map((a) => a.cobroId));
    return ids.map((id) => ({ id, anulado: anulados.has(id), tieneComprobante: false }));
  }
}
