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

// Money-safe: Decimal -> STRING escala 2 (nunca number/parseFloat).
function toDTO(r: PlantillaRow): GastoFijoPlantillaDTO {
  return {
    id: r.id,
    concepto: r.concepto,
    monto: r.monto.toFixed(2),
    activa: r.activa,
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

  /** R24: crea la plantilla (activa=true por default de la columna). */
  async crear(input: CrearPlantillaInput): Promise<GastoFijoPlantillaDTO> {
    const row = await this.prisma.gastoFijoPlantilla.create({
      data: { concepto: input.concepto, monto: new Prisma.Decimal(input.monto) },
    });
    return toDTO(row);
  }

  /** R25: edita concepto/monto (el @updatedAt de Prisma refresca updated_at). */
  async actualizar(id: string, input: ActualizarPlantillaInput): Promise<GastoFijoPlantillaDTO> {
    const row = await this.prisma.gastoFijoPlantilla.update({
      where: { id },
      data: { concepto: input.concepto, monto: new Prisma.Decimal(input.monto) },
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
