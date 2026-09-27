import type { PrismaClient } from "@prisma/client";

import type {
  AnularCobroRechazoRepoInput,
  AnularCobroRechazoRepoResult,
  CobroRechazoDeGestion,
  EstadoAnulacionDeCobroRechazo,
  IRechazoTiendaCobroAnulacionRepository,
  LineasDelCobro,
  RechazoTiendaCobroAnulacionTxClient,
} from "@/lib/interfaces/repositories/IRechazoTiendaCobroAnulacionRepository";
import type { EstadoDocumentoCaja } from "@/lib/interfaces/services/IWalletService";
import { appendAccion, resolverActorCongelado } from "@/lib/repositories/registrar-accion";
import { etiquetaDeEntidad } from "@/lib/types/historial-accion-etiquetas";
import { NOMBRE_USUARIO_SELECT, nombreCompletoUsuario } from "@/lib/utils/nombre-usuario";

type LecturaPrismaClient = Pick<PrismaClient, "rechazoTiendaCobro">;

/** El origen de las lineas del cobro por rechazo en los dos libros (337): la gestion. */
const ORIGEN = "gestion_orden" as const;

/**
 * FICHA 458-B (D7, R63–R68, R73) — la ANULACION de un cobro por rechazo aprobado. SOLO queries
 * Prisma. La constancia y su fila de historial van en la MISMA transaccion que recibe; los
 * contra-asientos de los dos libros los escribe `RechazoTiendaCobroService` en esa misma
 * transaccion, un instante despues.
 */
export class RechazoTiendaCobroAnulacionRepository implements IRechazoTiendaCobroAnulacionRepository {
  constructor(private readonly prisma: LecturaPrismaClient) {}

  /**
   * R64/R66/R67 — la constancia (motivo, quien, cuando) y `cobro_rechazo_tienda_anulado`.
   * `createMany({ skipDuplicates })`: `count = 0` ES «ya estaba anulado» (dos a la vez: la segunda
   * espera en `UNIQUE(cobro_id)` y tras el commit de la primera inserta 0). El motivo NO viaja al
   * historial (texto libre, R5 de la 362): la fila lleva el flete del cobro —como la de su
   * aprobacion— y la etiqueta del envio (guia/remision), la misma que puso la aprobacion.
   *
   * FORMA `recibe_tx`: el tipo del primer parametro no expone `$transaction`.
   */
  async anular(
    tx: RechazoTiendaCobroAnulacionTxClient,
    input: AnularCobroRechazoRepoInput,
  ): Promise<AnularCobroRechazoRepoResult> {
    const escritas = await tx.rechazoTiendaCobroAnulacion.createMany({
      data: [{ cobroId: input.cobroId, motivo: input.motivo, anuladoPor: input.anuladoPor }],
      skipDuplicates: true,
    });
    if (escritas.count === 0) return { status: "ya_anulado" };
    const cobro = await tx.rechazoTiendaCobro.findUnique({
      where: { id: input.cobroId },
      select: { montoFlete: true, orden: { select: { numGuia: true, numRemision: true } } },
    });
    const actor = await resolverActorCongelado(tx, input.anuladoPor);
    await appendAccion(tx, [
      {
        accion: "cobro_rechazo_tienda_anulado",
        entidadTipo: "rechazo_tienda_cobro",
        entidadId: input.cobroId,
        entidadEtiqueta: etiquetaDeEntidad("rechazo_tienda_cobro", {
          numGuia: cobro?.orden.numGuia ?? null,
          numRemision: cobro?.orden.numRemision ?? null,
        }),
        monto: cobro?.montoFlete ?? null,
        ...actor,
      },
    ]);
    return { status: "anulado" };
  }

  /**
   * R64/R68 — las lineas ORIGINALES del cobro: los dos ingresos de la caja y los dos debitos de la
   * tienda (si existen), con SU monto. Dentro de `tx`: el contra-asiento de cada una se escribe en
   * la misma transaccion, por el monto de la linea que anula.
   */
  async lineasDelCobro(
    tx: RechazoTiendaCobroAnulacionTxClient,
    cobro: { gestionId: string; tiendaId: string },
  ): Promise<LineasDelCobro> {
    // Una tras otra: una transaccion interactiva es UNA conexion.
    const caja = await tx.walletMovimiento.findMany({
      where: {
        origenTipo: ORIGEN,
        origenId: cobro.gestionId,
        categoria: { in: ["ingreso_flete_devolucion", "ingreso_iva_flete_devolucion"] },
      },
      select: { categoria: true, monto: true },
      orderBy: { categoria: "asc" },
    });
    const tienda = await tx.walletTiendaMovimiento.findMany({
      where: {
        origenTipo: ORIGEN,
        origenId: cobro.gestionId,
        tiendaId: cobro.tiendaId,
        categoria: { in: ["flete_devolucion", "iva_flete_devolucion"] },
      },
      select: { categoria: true, monto: true },
      orderBy: { categoria: "asc" },
    });
    return {
      caja: caja.map((f) => ({
        categoria: f.categoria as "ingreso_flete_devolucion" | "ingreso_iva_flete_devolucion",
        monto: f.monto.toFixed(2),
      })),
      tienda: tienda.map((f) => ({
        categoria: f.categoria as "flete_devolucion" | "iva_flete_devolucion",
        monto: f.monto.toFixed(2),
      })),
    };
  }

  /** R71/R73 — UNA consulta para todas las gestiones; una gestion sin cobro no vuelve. */
  async estadoPorGestion(gestionIds: readonly string[]): Promise<EstadoAnulacionDeCobroRechazo[]> {
    if (gestionIds.length === 0) return [];
    const filas = await this.prisma.rechazoTiendaCobro.findMany({
      where: { gestionId: { in: [...gestionIds] } },
      select: {
        id: true,
        gestionId: true,
        anulacion: {
          select: { motivo: true, createdAt: true, anulador: { select: NOMBRE_USUARIO_SELECT } },
        },
      },
    });
    return filas.map((f) => ({
      gestionId: f.gestionId,
      cobroId: f.id,
      anulacion:
        f.anulacion === null
          ? null
          : {
              motivo: f.anulacion.motivo,
              anuladoPorNombre: nombreCompletoUsuario(f.anulacion.anulador),
              createdAt: f.anulacion.createdAt,
            },
    }));
  }

  /**
   * R71 — el lector del libro de la caja: las DOS lineas de un cobro por rechazo (flete e IVA)
   * apuntan al MISMO documento, cuyo id es la GESTION (su `origen_id`). Una gestion sin cobro no
   * vuelve (la fila queda sin acciones). Un cobro por rechazo no lleva comprobante.
   */
  async estadoDeDocumentos(gestionIds: readonly string[]): Promise<EstadoDocumentoCaja[]> {
    const estados = await this.estadoPorGestion(gestionIds);
    return estados.map((e) => ({ id: e.gestionId, anulado: e.anulacion !== null, tieneComprobante: false }));
  }

  async cobroDeGestion(gestionId: string): Promise<CobroRechazoDeGestion | null> {
    return this.prisma.rechazoTiendaCobro.findUnique({
      where: { gestionId },
      select: { id: true, gestionId: true },
    });
  }
}
