import { Prisma, type PrismaClient } from "@prisma/client";

import type {
  AbonoTiendaRegistro,
  AbonoTiendaTxClient,
  AnularAbonoTiendaRepoInput,
  AnularAbonoTiendaRepoResult,
  CrearAbonoTiendaInput,
  CrearAbonoTiendaResult,
  EstadoDeAbono,
  IAbonoTiendaRepository,
} from "@/lib/interfaces/repositories/IAbonoTiendaRepository";
import { esP2002, textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";
import { appendAccion, resolverActorCongelado } from "@/lib/repositories/registrar-accion";
import { etiquetaDeEntidad } from "@/lib/types/historial-accion-etiquetas";
import { CUENTA_USUARIO_SELECT, etiquetaDeCuenta } from "@/lib/utils/etiqueta-cuenta";

type AbonoTiendaPrismaClient = Pick<PrismaClient, "abonoTienda">;

/** Lo que el documento necesita para proyectarse: nombres, no ids (R48). */
const INCLUDE_REGISTRO = {
  tienda: { select: CUENTA_USUARIO_SELECT },
  registrador: { select: { nombre: true } },
  anulacion: { select: { id: true } },
} as const;

type RegistroRow = Prisma.AbonoTiendaGetPayload<{ include: typeof INCLUDE_REGISTRO }>;

/** Money-safe: `Decimal` -> STRING escala 2. La fecha `@db.Date` es su prefijo ISO. */
function aRegistro(r: RegistroRow): AbonoTiendaRegistro {
  return {
    id: r.id,
    tiendaId: r.tiendaId,
    tiendaNombre: etiquetaDeCuenta(r.tienda),
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
 * El P2002 del documento es el de `clave_idempotencia`: la tabla tiene SOLO dos restricciones unicas
 * —la PK sobre un uuid recien generado y la clave— (premisa escrita en el modelo). Un P2002 sin pista
 * se lee como choque de clave, igual que en `PagoPorCuentaTiendaRepository`.
 */
function esChoqueDeClave(error: unknown): boolean {
  if (!esP2002(error)) return false;
  const texto = textoConstraintP2002(error);
  return texto === null || texto.includes("clave_idempotencia");
}

/** El P2002 de la anulacion es el de `UNIQUE(abono_id)` (la unica otra unica es la PK). */
function esChoqueDeAnulacion(error: unknown): boolean {
  if (!esP2002(error)) return false;
  const texto = textoConstraintP2002(error);
  return texto === null || texto.includes("abono_id") || texto.includes("anulacion");
}

/**
 * FICHA 457 (design §6.2) — el documento del PAGO DE UNA TIENDA A ORDENEX. SOLO queries Prisma. Las
 * dos escrituras llevan su fila de historial en la MISMA transaccion que reciben (R17/R31).
 */
export class AbonoTiendaRepository implements IAbonoTiendaRepository {
  constructor(private readonly prisma: AbonoTiendaPrismaClient) {}

  /**
   * R1/R17/R61/R63 — el documento y `abono_tienda_registrado`. La fila del historial lleva el IMPORTE
   * y el NOMBRE de la tienda; NUNCA el motivo, la referencia ni la ruta del comprobante (texto libre
   * tecleado por una persona, o la ubicacion del archivo: R63).
   */
  async crear(tx: AbonoTiendaTxClient, input: CrearAbonoTiendaInput): Promise<CrearAbonoTiendaResult> {
    try {
      const row = await tx.abonoTienda.create({
        data: {
          id: input.id,
          claveIdempotencia: input.claveIdempotencia,
          tiendaId: input.tiendaId,
          monto: new Prisma.Decimal(input.monto), // STRING -> Decimal (money-safe, R5)
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
          accion: "abono_tienda_registrado",
          entidadTipo: "abono_tienda",
          entidadId: row.id,
          entidadEtiqueta: etiquetaDeEntidad("abono_tienda", {
            tiendaNombre: etiquetaDeCuenta(row.tienda),
          }),
          monto: row.monto,
          ...actor,
        },
      ]);
      return { status: "creado", abono: aRegistro(row) };
    } catch (error) {
      if (esChoqueDeClave(error)) return { status: "clave_repetida" };
      throw error;
    }
  }

  /**
   * R31/R36/R62/R63 — la fila de anulacion y `abono_tienda_anulado`. El motivo de la anulacion vive en
   * su tabla y NO viaja al historial. Si el `UNIQUE(abono_id)` rechaza la fila, se responde
   * `ya_anulado` y no queda rastro de una anulacion que no ocurrio.
   */
  async anular(
    tx: AbonoTiendaTxClient,
    input: AnularAbonoTiendaRepoInput,
  ): Promise<AnularAbonoTiendaRepoResult> {
    try {
      await tx.abonoTiendaAnulacion.create({
        data: { abonoId: input.abonoId, motivo: input.motivo, anuladoPor: input.anuladoPor },
      });
      const anulado = await tx.abonoTienda.findUnique({
        where: { id: input.abonoId },
        select: { monto: true, tienda: { select: CUENTA_USUARIO_SELECT } },
      });
      const actor = await resolverActorCongelado(tx, input.anuladoPor);
      await appendAccion(tx, [
        {
          accion: "abono_tienda_anulado",
          entidadTipo: "abono_tienda",
          entidadId: input.abonoId,
          entidadEtiqueta: etiquetaDeEntidad("abono_tienda", {
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

  async obtenerPorClave(claveIdempotencia: string): Promise<AbonoTiendaRegistro | null> {
    const row = await this.prisma.abonoTienda.findUnique({
      where: { claveIdempotencia },
      include: INCLUDE_REGISTRO,
    });
    return row === null ? null : aRegistro(row);
  }

  async obtenerPorId(id: string): Promise<AbonoTiendaRegistro | null> {
    const row = await this.prisma.abonoTienda.findUnique({
      where: { id },
      include: INCLUDE_REGISTRO,
    });
    return row === null ? null : aRegistro(row);
  }

  /** R41 — UNA consulta para todos los ids de la pagina. Lista vacia -> sin consulta. */
  async estadoDeDocumentos(ids: readonly string[]): Promise<EstadoDeAbono[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.abonoTienda.findMany({
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
