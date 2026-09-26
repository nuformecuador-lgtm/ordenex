import type { PrismaClient } from "@prisma/client";

import type {
  AjusteCajaAnulacionTxClient,
  AnularAjusteCajaRepoInput,
  AnularAjusteCajaRepoResult,
  IAjusteCajaAnulacionRepository,
} from "@/lib/interfaces/repositories/IAjusteCajaAnulacionRepository";
import type { EstadoDocumentoCaja } from "@/lib/interfaces/services/IWalletService";
import { esP2002, textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";
import { appendAccion, resolverActorCongelado } from "@/lib/repositories/registrar-accion";
import { etiquetaDeEntidad } from "@/lib/types/historial-accion-etiquetas";

type AjusteCajaAnulacionPrismaClient = Pick<PrismaClient, "ajusteCajaAnulacion">;

/** El P2002 de la anulacion es el de `UNIQUE(movimiento_id)` (la unica otra unica es la PK sobre un uuid nuevo). */
function esChoqueDeAnulacion(error: unknown): boolean {
  if (!esP2002(error)) return false;
  const texto = textoConstraintP2002(error);
  return texto === null || texto.includes("movimiento_id") || texto.includes("anulacion");
}

/**
 * FICHA 461 (R69–R71, auditoria D3) — la ANULACION de una correccion de caja. SOLO queries Prisma.
 * Molde: `CobroTiendaAnulacionRepository`. La constancia y su fila de historial van en la MISMA
 * transaccion que recibe; el contra-asiento lo escribe `AjusteCajaService` en esa misma
 * transaccion, un instante despues.
 */
export class AjusteCajaAnulacionRepository implements IAjusteCajaAnulacionRepository {
  constructor(private readonly prisma: AjusteCajaAnulacionPrismaClient) {}

  /**
   * R69/R70 — la constancia (motivo, quien, cuando) y `wallet_movimiento_manual_anulado`. El motivo
   * vive en su tabla y NO viaja al historial (texto libre, R5 de la 362): la fila lleva el importe y
   * la CATEGORIA de la correccion, como la del registro (`crearMovimientoRegistrado`). Si el
   * `UNIQUE(movimiento_id)` rechaza la fila, se responde `ya_anulado` y no queda rastro.
   *
   * FORMA `recibe_tx`, la fuerte: el tipo del primer parametro no expone `$transaction`, asi que
   * este metodo no puede abrir la suya ni escribir fuera. La guardia del censo lo mide.
   */
  async anular(
    tx: AjusteCajaAnulacionTxClient,
    input: AnularAjusteCajaRepoInput,
  ): Promise<AnularAjusteCajaRepoResult> {
    try {
      await tx.ajusteCajaAnulacion.create({
        data: { movimientoId: input.movimientoId, motivo: input.motivo, anuladoPor: input.anuladoPor },
      });
      const correccion = await tx.walletMovimiento.findUnique({
        where: { id: input.movimientoId },
        select: { monto: true, categoria: true },
      });
      const actor = await resolverActorCongelado(tx, input.anuladoPor);
      await appendAccion(tx, [
        {
          accion: "wallet_movimiento_manual_anulado",
          entidadTipo: "wallet_movimiento",
          entidadId: input.movimientoId,
          // La MISMA etiqueta que la fila del registro: la categoria (un enum), nunca la descripcion.
          entidadEtiqueta: etiquetaDeEntidad("wallet_movimiento", {
            categoria: correccion?.categoria ?? "",
          }),
          monto: correccion?.monto ?? null,
          ...actor,
        },
      ]);
      return { status: "anulado" };
    } catch (error) {
      if (esChoqueDeAnulacion(error)) return { status: "ya_anulado" };
      throw error;
    }
  }

  /** R71 — UNA consulta para todos los ids de la pagina; cada id vuelve, anulado o no. */
  async estadoDeDocumentos(ids: readonly string[]): Promise<EstadoDocumentoCaja[]> {
    if (ids.length === 0) return [];
    const anuladas = await this.prisma.ajusteCajaAnulacion.findMany({
      where: { movimientoId: { in: [...ids] } },
      select: { movimientoId: true },
    });
    const anulados = new Set(anuladas.map((a) => a.movimientoId));
    return ids.map((id) => ({ id, anulado: anulados.has(id), tieneComprobante: false }));
  }
}
