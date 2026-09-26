import { Prisma, type PrismaClient } from "@prisma/client";

import type {
  AnularPagoPorCuentaInput,
  AnularPagoPorCuentaResult,
  CrearPagoPorCuentaInput,
  CrearPagoPorCuentaResult,
  EstadoDeDocumento,
  IPagoPorCuentaTiendaRepository,
  PagoPorCuentaRegistro,
  PagoPorCuentaTxClient,
} from "@/lib/interfaces/repositories/IPagoPorCuentaTiendaRepository";
import { esP2002, textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";
import { appendAccion, resolverActorCongelado } from "@/lib/repositories/registrar-accion";
import { etiquetaDeEntidad } from "@/lib/types/historial-accion-etiquetas";
import { CUENTA_USUARIO_SELECT, etiquetaDeCuenta } from "@/lib/utils/etiqueta-cuenta";

type PagoPorCuentaPrismaClient = Pick<PrismaClient, "pagoPorCuentaTienda">;

/** Lo que el documento necesita para proyectarse: nombres, no ids (R100). */
const INCLUDE_REGISTRO = {
  tienda: { select: CUENTA_USUARIO_SELECT },
  registrador: { select: { nombre: true } },
  anulacion: { select: { id: true } },
} as const;

type RegistroRow = Prisma.PagoPorCuentaTiendaGetPayload<{ include: typeof INCLUDE_REGISTRO }>;

/** Money-safe: `Decimal` -> STRING escala 2. La fecha `@db.Date` es su prefijo ISO. */
function aRegistro(r: RegistroRow): PagoPorCuentaRegistro {
  return {
    id: r.id,
    tiendaId: r.tiendaId,
    tiendaNombre: etiquetaDeCuenta(r.tienda),
    beneficiario: r.beneficiario,
    monto: r.monto.toFixed(2),
    metodo: r.metodo,
    referencia: r.referencia,
    motivo: r.motivo,
    fechaPago: r.fechaPago.toISOString().slice(0, 10),
    comprobantePath: r.comprobantePath,
    comprobanteContentType: r.comprobanteContentType,
    registradoPorNombre: r.registrador.nombre,
    registradoAt: r.createdAt.toISOString(),
    anulado: r.anulacion !== null,
  };
}

/**
 * El P2002 del documento es el de `clave_idempotencia`: la tabla tiene SOLO dos restricciones
 * unicas —la PK sobre un uuid recien generado y la clave— (premisa escrita en el modelo). Un P2002
 * sin pista se lee como choque de clave, igual que en `LiquidacionPagoRepository`.
 */
function esChoqueDeClave(error: unknown): boolean {
  if (!esP2002(error)) return false;
  const texto = textoConstraintP2002(error);
  return texto === null || texto.includes("clave_idempotencia");
}

/** El P2002 de la anulacion es el de `UNIQUE(pago_id)` (la unica otra unica es la PK). */
function esChoqueDeAnulacion(error: unknown): boolean {
  if (!esP2002(error)) return false;
  const texto = textoConstraintP2002(error);
  return texto === null || texto.includes("pago_id") || texto.includes("anulacion");
}

/**
 * FICHA 459 (design §6.4) — el documento del PAGO POR CUENTA de una tienda. SOLO queries Prisma.
 * Las dos escrituras llevan su fila de historial en la MISMA transaccion que reciben.
 */
export class PagoPorCuentaTiendaRepository implements IPagoPorCuentaTiendaRepository {
  constructor(private readonly prisma: PagoPorCuentaPrismaClient) {}

  /**
   * R29/R30/R53 — el documento y `pago_por_cuenta_tienda_registrado`. La fila del historial lleva
   * el IMPORTE y el NOMBRE de la tienda; NUNCA el beneficiario, el motivo ni la referencia (texto
   * libre tecleado por una persona, R53).
   */
  async crear(
    tx: PagoPorCuentaTxClient,
    input: CrearPagoPorCuentaInput,
  ): Promise<CrearPagoPorCuentaResult> {
    try {
      const row = await tx.pagoPorCuentaTienda.create({
        data: {
          id: input.id,
          claveIdempotencia: input.claveIdempotencia,
          tiendaId: input.tiendaId,
          beneficiario: input.beneficiario,
          monto: new Prisma.Decimal(input.monto), // STRING -> Decimal (money-safe)
          metodo: input.metodo,
          referencia: input.referencia,
          motivo: input.motivo,
          fechaPago: input.fechaPago,
          comprobantePath: input.comprobantePath,
          comprobanteContentType: input.comprobanteContentType,
          registradoPor: input.registradoPor,
        },
        include: INCLUDE_REGISTRO,
      });
      const actor = await resolverActorCongelado(tx, input.registradoPor);
      await appendAccion(tx, [
        {
          accion: "pago_por_cuenta_tienda_registrado",
          entidadTipo: "pago_por_cuenta_tienda",
          entidadId: row.id,
          entidadEtiqueta: etiquetaDeEntidad("pago_por_cuenta_tienda", {
            tiendaNombre: etiquetaDeCuenta(row.tienda),
          }),
          monto: row.monto,
          ...actor,
        },
      ]);
      return { status: "creado", pago: aRegistro(row) };
    } catch (error) {
      if (esChoqueDeClave(error)) return { status: "clave_repetida" };
      throw error;
    }
  }

  /**
   * R46/R50/R53 — la fila de anulacion y `pago_por_cuenta_tienda_anulado`. El motivo de la
   * anulacion vive en su tabla y NO viaja al historial. Si el `UNIQUE(pago_id)` rechaza la fila, se
   * responde `ya_anulado` y no queda rastro de una anulacion que no ocurrio.
   */
  async anular(
    tx: PagoPorCuentaTxClient,
    input: AnularPagoPorCuentaInput,
  ): Promise<AnularPagoPorCuentaResult> {
    try {
      await tx.pagoPorCuentaTiendaAnulacion.create({
        data: { pagoId: input.pagoId, motivo: input.motivo, anuladoPor: input.anuladoPor },
      });
      const anulado = await tx.pagoPorCuentaTienda.findUnique({
        where: { id: input.pagoId },
        select: { monto: true, tienda: { select: CUENTA_USUARIO_SELECT } },
      });
      const actor = await resolverActorCongelado(tx, input.anuladoPor);
      await appendAccion(tx, [
        {
          accion: "pago_por_cuenta_tienda_anulado",
          entidadTipo: "pago_por_cuenta_tienda",
          entidadId: input.pagoId,
          entidadEtiqueta: etiquetaDeEntidad("pago_por_cuenta_tienda", {
            tiendaNombre: etiquetaDeCuenta(anulado?.tienda),
          }),
          monto: anulado?.monto ?? null,
          ...actor,
        },
      ]);
      return { status: "anulado" };
    } catch (error) {
      if (esChoqueDeAnulacion(error)) return { status: "ya_anulado" };
      throw error;
    }
  }

  async obtenerPorClave(claveIdempotencia: string): Promise<PagoPorCuentaRegistro | null> {
    const row = await this.prisma.pagoPorCuentaTienda.findUnique({
      where: { claveIdempotencia },
      include: INCLUDE_REGISTRO,
    });
    return row === null ? null : aRegistro(row);
  }

  async obtenerPorId(id: string): Promise<PagoPorCuentaRegistro | null> {
    const row = await this.prisma.pagoPorCuentaTienda.findUnique({
      where: { id },
      include: INCLUDE_REGISTRO,
    });
    return row === null ? null : aRegistro(row);
  }

  /** R66/R67 — UNA consulta para todos los ids de la pagina. Lista vacia -> sin consulta. */
  async estadoDeDocumentos(ids: readonly string[]): Promise<EstadoDeDocumento[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.pagoPorCuentaTienda.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, comprobantePath: true, anulacion: { select: { id: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      anulado: r.anulacion !== null,
      tieneComprobante: r.comprobantePath !== null,
    }));
  }
}
