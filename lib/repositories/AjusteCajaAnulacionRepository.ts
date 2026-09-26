import type { PrismaClient } from "@prisma/client";

import type {
  AjusteCajaAnulacionTxClient,
  AnularAjusteCajaRepoInput,
  AnularAjusteCajaRepoResult,
  AnularEgresoCajaRepoInput,
  ConstanciaDeAnulacion,
  IAjusteCajaAnulacionRepository,
} from "@/lib/interfaces/repositories/IAjusteCajaAnulacionRepository";
import { NOMBRE_USUARIO_SELECT, nombreCompletoUsuario } from "@/lib/utils/nombre-usuario";
import type { EstadoDocumentoCaja } from "@/lib/interfaces/services/IWalletService";
import { esP2002, textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";
import { appendAccion, resolverActorCongelado } from "@/lib/repositories/registrar-accion";
import { etiquetaDeEntidad } from "@/lib/types/historial-accion-etiquetas";

type AjusteCajaAnulacionPrismaClient = Pick<PrismaClient, "ajusteCajaAnulacion" | "walletComprobante">;

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

  /**
   * FICHA 458-B (D13, R64/R66/R67) — la constancia de la anulacion de un EGRESO (sueldo, gasto de
   * Ordenex, gasto fijo cobrado, indemnizacion) y `egreso_caja_anulado`, en la MISMA transaccion.
   *
   * `createMany({ skipDuplicates })` y NO `create` + P2002: un choque dentro de una transaccion de
   * Postgres la deja abortada, y leer el nombre de la restriccion en un P2002 es justo lo que la
   * ficha prohibe («no se interpreta un P2002 sin `meta.target`»). `count = 0` ES la respuesta: ya
   * habia constancia; no se escribe historial de una anulacion que no ocurrio.
   *
   * FORMA `recibe_tx`: el tipo del primer parametro no expone `$transaction`.
   */
  async anularEgreso(
    tx: AjusteCajaAnulacionTxClient,
    input: AnularEgresoCajaRepoInput,
  ): Promise<AnularAjusteCajaRepoResult> {
    const escritas = await tx.ajusteCajaAnulacion.createMany({
      data: [{ movimientoId: input.movimientoId, motivo: input.motivo, anuladoPor: input.anuladoPor }],
      skipDuplicates: true,
    });
    if (escritas.count === 0) return { status: "ya_anulado" };
    const egreso = await tx.walletMovimiento.findUnique({
      where: { id: input.movimientoId },
      select: { monto: true, categoria: true },
    });
    const actor = await resolverActorCongelado(tx, input.anuladoPor);
    await appendAccion(tx, [
      {
        accion: "egreso_caja_anulado",
        entidadTipo: "wallet_movimiento",
        entidadId: input.movimientoId,
        // La etiqueta es la CATEGORIA del egreso (un enum), nunca su descripcion ni el motivo.
        entidadEtiqueta: etiquetaDeEntidad("wallet_movimiento", { categoria: egreso?.categoria ?? "" }),
        monto: egreso?.monto ?? null,
        ...actor,
      },
    ]);
    return { status: "anulado" };
  }

  /** FICHA 458-B (R25/R71/R72) — las constancias de estos movimientos, con el nombre de quien anulo. */
  async constanciasDe(movimientoIds: readonly string[]): Promise<ConstanciaDeAnulacion[]> {
    if (movimientoIds.length === 0) return [];
    const filas = await this.prisma.ajusteCajaAnulacion.findMany({
      where: { movimientoId: { in: [...movimientoIds] } },
      select: {
        movimientoId: true,
        motivo: true,
        anuladoPor: true,
        createdAt: true,
        anulador: { select: NOMBRE_USUARIO_SELECT },
      },
    });
    return filas.map((f) => ({
      movimientoId: f.movimientoId,
      motivo: f.motivo,
      anuladoPor: f.anuladoPor,
      anuladoPorNombre: nombreCompletoUsuario(f.anulador),
      createdAt: f.createdAt,
    }));
  }

  /**
   * R71 — DOS consultas para todos los ids de la pagina; cada id vuelve, anulado o no.
   *
   * FICHA 458-B (revision M1): `tieneComprobante` lo decide la base. Desde TB.11 la correccion de
   * caja puede llevar comprobante en `wallet_comprobante.caja_movimiento_id` (la fila de la
   * correccion); un `false` fijo haria que la pantalla ofreciera «Adjuntar» y el servidor
   * respondiera `ya_tiene` (R79/R80: lo decide el servidor, no el cliente).
   */
  async estadoDeDocumentos(ids: readonly string[]): Promise<EstadoDocumentoCaja[]> {
    if (ids.length === 0) return [];
    const lista = [...ids];
    const anuladas = await this.prisma.ajusteCajaAnulacion.findMany({
      where: { movimientoId: { in: lista } },
      select: { movimientoId: true },
    });
    const comprobantes = await this.prisma.walletComprobante.findMany({
      where: { cajaMovimientoId: { in: lista } },
      select: { cajaMovimientoId: true },
    });
    const anulados = new Set(anuladas.map((a) => a.movimientoId));
    const conComprobante = new Set(comprobantes.map((c) => c.cajaMovimientoId));
    return lista.map((id) => ({ id, anulado: anulados.has(id), tieneComprobante: conComprobante.has(id) }));
  }
}
