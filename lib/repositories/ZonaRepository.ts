import { Prisma, type PrismaClient } from "@prisma/client";
import { normalizeZonaKey } from "@/lib/geo/normalize";
import {
  DistritosInexistentesError,
  DistritosYaAsignadosError,
  type CreateZonaData,
  type IZonaRepository,
  type ListZonasParams,
  type ListZonasResult,
  type UpdateZonaData,
} from "@/lib/interfaces/repositories/IZonaRepository";
import type { ZonaDTO, ZonaLightDTO } from "@/lib/types/zona";

type ZonaPrismaClient = Pick<PrismaClient, "zona" | "distrito" | "$transaction">;

// Cliente que solo necesita zona/distrito (el propio PrismaClient o el tx interno).
type ZonaTxClient = Pick<Prisma.TransactionClient, "zona" | "distrito">;

// Proyeccion con el conteo de distritos asignados (R24).
const ZONA_SELECT = {
  id: true,
  nombre: true,
  pagoEntrega: true,
  pagoRechazo: true,
  esGam: true,
  _count: { select: { distritos: true } },
} as const;

type ZonaRow = Prisma.ZonaGetPayload<{ select: typeof ZONA_SELECT }>;

function toDTO(row: ZonaRow): ZonaDTO {
  return {
    id: row.id,
    nombre: row.nombre,
    pagoEntrega: row.pagoEntrega.toNumber(),
    pagoRechazo: row.pagoRechazo.toNumber(),
    esGam: row.esGam,
    distritosCount: row._count.distritos,
  };
}

export class ZonaRepository implements IZonaRepository {
  constructor(private readonly prisma: ZonaPrismaClient) {}

  async create(data: CreateZonaData): Promise<ZonaDTO> {
    return this.prisma.$transaction(async (tx) => {
      // R18/R19/R20: valida el conjunto ANTES de crear (todo-o-nada).
      await assertDistritosAsignables(tx, data.distritoIds, null);

      // R23: si esta zona sera GAM, desmarca cualquier otra en la misma tx antes
      // de crear (evita chocar con el indice unico parcial).
      if (data.esGam) {
        await tx.zona.updateMany({ where: { esGam: true }, data: { esGam: false } });
      }

      const created = await tx.zona.create({
        data: {
          nombre: data.nombre,
          pagoEntrega: new Prisma.Decimal(data.pagoEntrega),
          pagoRechazo: new Prisma.Decimal(data.pagoRechazo),
          esGam: data.esGam,
        },
        select: { id: true },
      });

      if (data.distritoIds.length > 0) {
        await tx.distrito.updateMany({
          where: { id: { in: data.distritoIds } },
          data: { zonaId: created.id }, // R17
        });
      }

      return loadDTO(tx, created.id);
    });
  }

  async findById(id: string): Promise<ZonaDTO | null> {
    const row = await this.prisma.zona.findUnique({ where: { id }, select: ZONA_SELECT });
    return row ? toDTO(row) : null;
  }

  async findByNombreKey(key: string, excludeId?: string): Promise<{ id: string } | null> {
    // R2/R21: no hay columna normalizada en DB; se comparan las claves en memoria
    // (las zonas son pocas). Excluye la propia zona en edicion.
    const rows = await this.prisma.zona.findMany({ select: { id: true, nombre: true } });
    for (const row of rows) {
      if (excludeId !== undefined && row.id === excludeId) continue;
      if (normalizeZonaKey(row.nombre) === key) return { id: row.id };
    }
    return null;
  }

  async list(params: ListZonasParams): Promise<ListZonasResult> {
    const [rows, total] = await Promise.all([
      this.prisma.zona.findMany({
        select: ZONA_SELECT,
        orderBy: { nombre: "asc" },
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.zona.count(),
    ]);
    return { items: rows.map(toDTO), total };
  }

  async update(id: string, data: UpdateZonaData): Promise<ZonaDTO | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.zona.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return null; // R22

      // R20/R18: valida el conjunto deseado antes de escribir (excluye la propia zona).
      if (data.distritoIds !== undefined) {
        await assertDistritosAsignables(tx, data.distritoIds, id);
      }

      // R23: si se marca GAM, desmarca cualquier otra en la misma tx.
      if (data.esGam === true) {
        await tx.zona.updateMany({
          where: { esGam: true, NOT: { id } },
          data: { esGam: false },
        });
      }

      await tx.zona.update({ where: { id }, data: buildZonaScalarUpdate(data) });

      if (data.distritoIds !== undefined) {
        // R22: libera los removidos (zonaId = NULL) y asigna el conjunto nuevo.
        await tx.distrito.updateMany({
          where: { zonaId: id, id: { notIn: data.distritoIds } },
          data: { zonaId: null },
        });
        if (data.distritoIds.length > 0) {
          await tx.distrito.updateMany({
            where: { id: { in: data.distritoIds } },
            data: { zonaId: id },
          });
        }
      }

      return loadDTO(tx, id);
    });
  }

  async setGam(id: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.zona.findUnique({ where: { id }, select: { id: true } });
      if (!existing) return false; // R22

      // R23: desmarca la GAM previa y marca esta, atomicamente.
      await tx.zona.updateMany({ where: { esGam: true, NOT: { id } }, data: { esGam: false } });
      await tx.zona.update({ where: { id }, data: { esGam: true } });
      return true;
    });
  }

  async listLight(): Promise<ZonaLightDTO[]> {
    return this.prisma.zona.findMany({
      select: { id: true, nombre: true, esGam: true },
      orderBy: { nombre: "asc" },
    });
  }
}

// R18/R19/R20: los distritos deben existir y no pertenecer a OTRA zona
// (`excludeZonaId` permite reasignarse a si misma de forma idempotente).
async function assertDistritosAsignables(
  tx: ZonaTxClient,
  distritoIds: string[],
  excludeZonaId: string | null,
): Promise<void> {
  if (distritoIds.length === 0) return;
  const rows = await tx.distrito.findMany({
    where: { id: { in: distritoIds } },
    select: { id: true, zonaId: true },
  });
  const encontrados = new Set(rows.map((r) => r.id));
  const inexistentes = distritoIds.filter((id) => !encontrados.has(id));
  if (inexistentes.length > 0) throw new DistritosInexistentesError(inexistentes); // R19

  const ajenos = rows
    .filter((r) => r.zonaId !== null && r.zonaId !== excludeZonaId)
    .map((r) => r.id);
  if (ajenos.length > 0) throw new DistritosYaAsignadosError(ajenos); // R20
}

function buildZonaScalarUpdate(data: UpdateZonaData): Prisma.ZonaUpdateInput {
  const out: Prisma.ZonaUpdateInput = {};
  if (data.nombre !== undefined) out.nombre = data.nombre;
  if (data.pagoEntrega !== undefined) out.pagoEntrega = new Prisma.Decimal(data.pagoEntrega);
  if (data.pagoRechazo !== undefined) out.pagoRechazo = new Prisma.Decimal(data.pagoRechazo);
  if (data.esGam !== undefined) out.esGam = data.esGam;
  return out;
}

async function loadDTO(tx: ZonaTxClient, id: string): Promise<ZonaDTO> {
  const row = await tx.zona.findUnique({ where: { id }, select: ZONA_SELECT });
  // Dentro de la misma tx la fila existe siempre (recien creada/actualizada).
  if (!row) throw new Error(`zona ${id} no encontrada tras escritura en la transaccion`);
  return toDTO(row);
}
