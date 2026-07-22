import type { PlantillaEstado, PrismaClient } from "@prisma/client";
import { textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";
import {
  PlantillaDuplicadaError,
  type CreatePlantillaData,
  type IPlantillaMensajeRepository,
  type ListPlantillasParams,
  type ListPlantillasResult,
  type PlantillaListItem,
  type PlantillaPublica,
  type UpdatePlantillaData,
} from "@/lib/interfaces/repositories/IPlantillaMensajeRepository";

type PlantillaPrismaClient = Pick<PrismaClient, "plantillaMensaje">;

const PUBLIC_SELECT = {
  id: true,
  nombre: true,
  cuerpo: true,
  variables: true,
  estado: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

const LIST_SELECT = {
  id: true,
  nombre: true,
  cuerpo: true,
  estado: true,
  variables: true,
  createdAt: true,
} as const;

// R28: filtro base de vigentes; TODAS las lecturas y mutaciones lo aplican.
const VIGENTE = { deletedAt: null } as const;

export class PlantillaMensajeRepository implements IPlantillaMensajeRepository {
  constructor(private readonly prisma: PlantillaPrismaClient) {}

  async create(data: CreatePlantillaData): Promise<PlantillaPublica> {
    try {
      return await this.prisma.plantillaMensaje.create({
        data: {
          nombre: data.nombre,
          cuerpo: data.cuerpo,
          variables: data.variables,
          createdBy: data.createdBy,
          // R12: `estado` nace `pending` por el default del schema; no se fija aqui.
        },
        select: PUBLIC_SELECT,
      });
    } catch (error) {
      throw mapDuplicadoError(error);
    }
  }

  async list(params: ListPlantillasParams): Promise<ListPlantillasResult> {
    const [rows, total] = await Promise.all([
      this.prisma.plantillaMensaje.findMany({
        where: VIGENTE, // R28
        select: LIST_SELECT,
        orderBy: { createdAt: "desc" }, // R6: orden determinista
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.plantillaMensaje.count({ where: VIGENTE }),
    ]);
    const items: PlantillaListItem[] = rows.map((row) => ({ ...row }));
    return { items, total };
  }

  async count(): Promise<number> {
    return this.prisma.plantillaMensaje.count({ where: VIGENTE }); // R28
  }

  async findById(id: string): Promise<PlantillaPublica | null> {
    return this.prisma.plantillaMensaje.findFirst({
      where: { id, ...VIGENTE }, // R28
      select: PUBLIC_SELECT,
    });
  }

  async findByNombre(nombre: string): Promise<PlantillaPublica | null> {
    return this.prisma.plantillaMensaje.findFirst({
      where: { nombre, ...VIGENTE }, // R28
      select: PUBLIC_SELECT,
    });
  }

  async update(id: string, data: UpdatePlantillaData): Promise<PlantillaPublica | null> {
    try {
      const result = await this.prisma.plantillaMensaje.updateMany({
        where: { id, ...VIGENTE }, // R28: no toca borradas
        data: {
          ...(data.nombre !== undefined ? { nombre: data.nombre } : {}),
          ...(data.cuerpo !== undefined ? { cuerpo: data.cuerpo } : {}),
          ...(data.variables !== undefined ? { variables: data.variables } : {}),
        },
      });
      if (result.count === 0) return null; // R21
    } catch (error) {
      throw mapDuplicadoError(error);
    }
    return this.prisma.plantillaMensaje.findFirst({ where: { id, ...VIGENTE }, select: PUBLIC_SELECT });
  }

  async updateEstado(id: string, estado: PlantillaEstado): Promise<PlantillaPublica | null> {
    const result = await this.prisma.plantillaMensaje.updateMany({
      where: { id, ...VIGENTE }, // R26/R28
      data: { estado },
    });
    if (result.count === 0) return null; // R26
    return this.prisma.plantillaMensaje.findFirst({ where: { id, ...VIGENTE }, select: PUBLIC_SELECT });
  }

  async softDelete(id: string): Promise<boolean> {
    const result = await this.prisma.plantillaMensaje.updateMany({
      where: { id, ...VIGENTE }, // R29: ya borrada -> count 0
      data: { deletedAt: new Date() }, // R27: soft delete, no borra la fila
    });
    return result.count > 0;
  }
}

/**
 * R10: traduce la violacion de unicidad de Postgres a un error de dominio. La constraint
 * real `plantilla_mensaje_nombre_key` contiene el substring "nombre".
 */
function mapDuplicadoError(error: unknown): unknown {
  const texto = textoConstraintP2002(error);
  if (texto && texto.includes("nombre")) return new PlantillaDuplicadaError("nombre");
  return error;
}
