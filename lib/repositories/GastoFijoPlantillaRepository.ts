import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  ActualizarPlantillaInput,
  CrearPlantillaInput,
  IGastoFijoPlantillaRepository,
} from "@/lib/interfaces/repositories/IGastoFijoPlantillaRepository";
import type { GastoFijoPlantillaDTO } from "@/lib/types/gasto-fijo-plantilla";

// Cliente Prisma acotado a lo que este repo necesita (patron WalletMovimientoRepository).
type PlantillaPrismaClient = Pick<PrismaClient, "gastoFijoPlantilla">;

type PlantillaRow = Prisma.GastoFijoPlantillaGetPayload<Record<string, never>>;

// Feature 84 — la columna `fecha_cobro` es DATE: Prisma la entrega como Date a medianoche UTC.
// El DTO la expone como `YYYY-MM-DD` (misma convencion que `lib/utils/periodicidad.ts`), asi que
// alcanza con recortar el ISO. NO uses la hora local: la fila YA es medianoche UTC.
function fechaCobroADTO(fechaCobro: Date): string {
  return fechaCobro.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` -> Date a medianoche UTC, la convencion con que se persiste la columna DATE. */
function fechaCobroAColumna(fechaCobro: string): Date {
  return new Date(`${fechaCobro}T00:00:00.000Z`);
}

// Money-safe: Decimal -> STRING escala 2 (nunca number/parseFloat).
function toDTO(r: PlantillaRow): GastoFijoPlantillaDTO {
  return {
    id: r.id,
    concepto: r.concepto,
    monto: r.monto.toFixed(2),
    activa: r.activa,
    periodicidadUnidad: r.periodicidadUnidad,
    periodicidadCantidad: r.periodicidadCantidad,
    fechaCobro: fechaCobroADTO(r.fechaCobro),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/**
 * Feature 45 — repositorio de PLANTILLAS de gasto fijo. SOLO queries Prisma. CRUD sin borrado
 * (R25): crear, actualizar (concepto/monto), setActiva (activar/desactivar), listar (todas),
 * listarActivas (cron), obtenerPorId. Montos SIEMPRE STRING en el DTO (money-safe, R12).
 */
export class GastoFijoPlantillaRepository implements IGastoFijoPlantillaRepository {
  constructor(private readonly prisma: PlantillaPrismaClient) {}

  /** R24: crea la plantilla (activa=true por default de la columna). Feature 84: + periodicidad. */
  async crear(input: CrearPlantillaInput): Promise<GastoFijoPlantillaDTO> {
    const row = await this.prisma.gastoFijoPlantilla.create({
      data: {
        concepto: input.concepto,
        monto: new Prisma.Decimal(input.monto),
        periodicidadUnidad: input.periodicidadUnidad,
        periodicidadCantidad: input.periodicidadCantidad,
        fechaCobro: fechaCobroAColumna(input.fechaCobro),
      },
    });
    return toDTO(row);
  }

  /**
   * R25: edita concepto/monto (el @updatedAt de Prisma refresca updated_at). Feature 84: tambien
   * la periodicidad. Mover `fechaCobro` mueve el ancla del ciclo, no reescribe egresos pasados.
   */
  async actualizar(id: string, input: ActualizarPlantillaInput): Promise<GastoFijoPlantillaDTO> {
    const row = await this.prisma.gastoFijoPlantilla.update({
      where: { id },
      data: {
        concepto: input.concepto,
        monto: new Prisma.Decimal(input.monto),
        periodicidadUnidad: input.periodicidadUnidad,
        periodicidadCantidad: input.periodicidadCantidad,
        fechaCobro: fechaCobroAColumna(input.fechaCobro),
      },
    });
    return toDTO(row);
  }

  /** R25: activa/desactiva (sin borrado). */
  async setActiva(id: string, activa: boolean): Promise<GastoFijoPlantillaDTO> {
    const row = await this.prisma.gastoFijoPlantilla.update({ where: { id }, data: { activa } });
    return toDTO(row);
  }

  /** R26: todas las plantillas, mas recientes primero. */
  async listar(): Promise<GastoFijoPlantillaDTO[]> {
    const rows = await this.prisma.gastoFijoPlantilla.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map(toDTO);
  }

  /** R27: solo las activas (consumo del cron). */
  async listarActivas(): Promise<GastoFijoPlantillaDTO[]> {
    const rows = await this.prisma.gastoFijoPlantilla.findMany({
      where: { activa: true },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toDTO);
  }

  async obtenerPorId(id: string): Promise<GastoFijoPlantillaDTO | null> {
    const row = await this.prisma.gastoFijoPlantilla.findUnique({ where: { id } });
    return row === null ? null : toDTO(row);
  }
}
