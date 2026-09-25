import { Prisma, type PrismaClient } from "@prisma/client";

import type {
  AnularAporteCapitalInput,
  AnularAporteCapitalResult,
  AporteCapitalRegistro,
  AporteCapitalTxClient,
  CrearAporteCapitalInput,
  CrearAporteCapitalResult,
  IAporteCapitalRepository,
} from "@/lib/interfaces/repositories/IAporteCapitalRepository";
import type { EstadoDeDocumento } from "@/lib/interfaces/repositories/IPagoPorCuentaTiendaRepository";
import { esP2002, textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";
import { appendAccion, resolverActorCongelado } from "@/lib/repositories/registrar-accion";
import type { ClaseAporteCapital } from "@/lib/types/aporte-capital";
import { etiquetaDeEntidad } from "@/lib/types/historial-accion-etiquetas";

type AporteCapitalPrismaClient = Pick<PrismaClient, "aporteCapital">;

/**
 * R70 — la clave del advisory lock del saldo inicial. Un `hashtext` de un literal FIJO: todos los
 * registros de un saldo inicial compiten por el MISMO candado, y ningun otro modulo lo usa.
 */
const CLAVE_CANDADO_SALDO_INICIAL = "aporte_capital:saldo_inicial";

/** «Vigente» = sin fila de anulacion. Declarado una vez (patron `VIGENTE` de la 172). */
const VIGENTE = { anulacion: { is: null } } as const;

const INCLUDE_REGISTRO = {
  registrador: { select: { nombre: true } },
  anulacion: { select: { id: true } },
} as const;

type RegistroRow = Prisma.AporteCapitalGetPayload<{ include: typeof INCLUDE_REGISTRO }>;

function aRegistro(r: RegistroRow): AporteCapitalRegistro {
  return {
    id: r.id,
    // El CHECK de la base solo admite estas dos: la conversion no puede fallar.
    clase: r.clase as ClaseAporteCapital,
    monto: r.monto.toFixed(2),
    motivo: r.motivo,
    fecha: r.fecha.toISOString().slice(0, 10),
    comprobantePath: r.comprobantePath,
    comprobanteContentType: r.comprobanteContentType,
    registradoPorNombre: r.registrador.nombre,
    registradoAt: r.createdAt.toISOString(),
    anulado: r.anulacion !== null,
  };
}

/** Dos unicas por documento (PK y clave): un P2002 sin pista es el de la clave. */
function esChoqueDeClave(error: unknown): boolean {
  if (!esP2002(error)) return false;
  const texto = textoConstraintP2002(error);
  return texto === null || texto.includes("clave_idempotencia");
}

function esChoqueDeAnulacion(error: unknown): boolean {
  if (!esP2002(error)) return false;
  const texto = textoConstraintP2002(error);
  return texto === null || texto.includes("aporte_id") || texto.includes("anulacion");
}

/**
 * FICHA 459 (design §6.4) — el documento del SALDO INICIAL o APORTE DE CAPITAL. SOLO queries.
 * Las dos escrituras llevan su historial en la MISMA transaccion que reciben; la fila del
 * historial lleva el importe y la CLASE, nunca el motivo (R78).
 */
export class AporteCapitalRepository implements IAporteCapitalRepository {
  constructor(private readonly prisma: AporteCapitalPrismaClient) {}

  async bloquearSaldoInicial(tx: AporteCapitalTxClient): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${CLAVE_CANDADO_SALDO_INICIAL}))`;
  }

  async haySaldoInicialVigente(tx?: AporteCapitalTxClient): Promise<boolean> {
    const cliente = tx ?? this.prisma;
    const n = await cliente.aporteCapital.count({
      where: { clase: "saldo_inicial", ...VIGENTE },
    });
    return n > 0;
  }

  async crear(
    tx: AporteCapitalTxClient,
    input: CrearAporteCapitalInput,
  ): Promise<CrearAporteCapitalResult> {
    try {
      const row = await tx.aporteCapital.create({
        data: {
          id: input.id,
          claveIdempotencia: input.claveIdempotencia,
          clase: input.clase,
          monto: new Prisma.Decimal(input.monto),
          motivo: input.motivo,
          fecha: input.fecha,
          comprobantePath: input.comprobantePath,
          comprobanteContentType: input.comprobanteContentType,
          registradoPor: input.registradoPor,
        },
        include: INCLUDE_REGISTRO,
      });
      const actor = await resolverActorCongelado(tx, input.registradoPor);
      await appendAccion(tx, [
        {
          accion: "aporte_capital_registrado",
          entidadTipo: "aporte_capital",
          entidadId: row.id,
          entidadEtiqueta: etiquetaDeEntidad("aporte_capital", { clase: input.clase }),
          monto: row.monto,
          ...actor,
        },
      ]);
      return { status: "creado", aporte: aRegistro(row) };
    } catch (error) {
      if (esChoqueDeClave(error)) return { status: "clave_repetida" };
      throw error;
    }
  }

  async anular(
    tx: AporteCapitalTxClient,
    input: AnularAporteCapitalInput,
  ): Promise<AnularAporteCapitalResult> {
    try {
      await tx.aporteCapitalAnulacion.create({
        data: { aporteId: input.aporteId, motivo: input.motivo, anuladoPor: input.anuladoPor },
      });
      const anulado = await tx.aporteCapital.findUnique({
        where: { id: input.aporteId },
        select: { monto: true, clase: true },
      });
      const actor = await resolverActorCongelado(tx, input.anuladoPor);
      await appendAccion(tx, [
        {
          accion: "aporte_capital_anulado",
          entidadTipo: "aporte_capital",
          entidadId: input.aporteId,
          entidadEtiqueta: etiquetaDeEntidad("aporte_capital", {
            clase: (anulado?.clase ?? "aporte") as ClaseAporteCapital,
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

  async obtenerPorClave(claveIdempotencia: string): Promise<AporteCapitalRegistro | null> {
    const row = await this.prisma.aporteCapital.findUnique({
      where: { claveIdempotencia },
      include: INCLUDE_REGISTRO,
    });
    return row === null ? null : aRegistro(row);
  }

  async obtenerPorId(id: string): Promise<AporteCapitalRegistro | null> {
    const row = await this.prisma.aporteCapital.findUnique({
      where: { id },
      include: INCLUDE_REGISTRO,
    });
    return row === null ? null : aRegistro(row);
  }

  async estadoDeDocumentos(ids: readonly string[]): Promise<EstadoDeDocumento[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.aporteCapital.findMany({
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
