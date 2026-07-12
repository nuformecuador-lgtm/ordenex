import { Prisma, type PrismaClient } from "@prisma/client";
import { ConflictError } from "@/lib/errors";
import { normalizeName } from "@/lib/utils/normalize";
import type {
  ArbolCantonNode,
  ArbolZonas,
  TarifaZonaMensajeroDTO,
  ZonaDTO,
} from "@/lib/types/zona";
import type {
  CreateZonaData,
  DeleteZonaResult,
  IZonaRepository,
  ListZonasParams,
  ListZonasResult,
  UpdateZonaData,
} from "@/lib/interfaces/repositories/IZonaRepository";

// Delegates + $transaction necesarios (permite acotar/mocakear en tests).
type ZonaPrismaClient = Pick<
  PrismaClient,
  "zona" | "zonaDistrito" | "tarifaZonaMensajero" | "distrito" | "vehiculo" | "$transaction"
>;

type TarifaRow = {
  id: string;
  cobroEntregado: Prisma.Decimal;
  cobroRechazado: Prisma.Decimal;
  vehiculoId: string | null;
};

function tarifaToDTO(row: TarifaRow): TarifaZonaMensajeroDTO {
  return {
    id: row.id,
    cobroEntregado: row.cobroEntregado.toNumber(),
    cobroRechazado: row.cobroRechazado.toNumber(),
    vehiculoId: row.vehiculoId,
  };
}

function toDTO(
  zona: { id: string; nombre: string; cobroVehiculo: boolean; esCentral: boolean },
  distritosCount: number,
  tarifas: TarifaRow[] | undefined,
): ZonaDTO {
  const dto: ZonaDTO = {
    id: zona.id,
    nombre: zona.nombre,
    cobroVehiculo: zona.cobroVehiculo,
    distritosCount,
    esCentral: zona.esCentral,
  };
  if (tarifas !== undefined) dto.tarifas = tarifas.map(tarifaToDTO);
  return dto;
}

// Feature 55/R6: el indice unico parcial `zona_es_central_unico` garantiza <=1
// central a nivel DB. Si por una carrera se colara un segundo `es_central=true`,
// Prisma lanzaria P2002; lo traducimos a un ConflictError de dominio (no un 500)
// SOLO cuando el conflicto es sobre la constraint de es_central.
function isEsCentralUniqueViolation(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") {
    return false;
  }
  const target = e.meta?.target;
  const asText = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return asText.includes("es_central") || asText.includes("zona_es_central_unico");
}

function translateEsCentralConflict(e: unknown): never {
  if (isEsCentralUniqueViolation(e)) {
    throw new ConflictError("Ya existe una zona central");
  }
  throw e;
}

function tarifaCreateRows(zonaId: string, tarifas: CreateZonaData["tarifas"]) {
  return tarifas.map((t) => ({
    zonaId,
    cobroEntregado: new Prisma.Decimal(t.cobroEntregado),
    cobroRechazado: new Prisma.Decimal(t.cobroRechazado),
    vehiculoId: t.vehiculoId,
  }));
}

export class ZonaRepository implements IZonaRepository {
  constructor(private readonly prisma: ZonaPrismaClient) {}

  async create(data: CreateZonaData): Promise<ZonaDTO> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Feature 55/R5/R6 (F1.4-A = reasignar): si esta zona sera central, desmarca
        // cualquier central previa ANTES de crear, para no violar el indice unico parcial.
        if (data.esCentral === true) {
          await tx.zona.updateMany({ where: { esCentral: true }, data: { esCentral: false } });
        }
        const zona = await tx.zona.create({
          data: { nombre: data.nombre, cobroVehiculo: data.cobroVehiculo, esCentral: data.esCentral },
        });
        if (data.distritoIds.length > 0) {
          await tx.zonaDistrito.createMany({
            data: data.distritoIds.map((distritoId) => ({ zonaId: zona.id, distritoId })),
          });
        }
        if (data.tarifas.length > 0) {
          await tx.tarifaZonaMensajero.createMany({ data: tarifaCreateRows(zona.id, data.tarifas) });
        }
        const tarifas = await tx.tarifaZonaMensajero.findMany({ where: { zonaId: zona.id } });
        return toDTO(zona, data.distritoIds.length, tarifas);
      });
    } catch (e) {
      translateEsCentralConflict(e);
    }
  }

  async findById(id: string, includeTarifas: boolean): Promise<ZonaDTO | null> {
    const zona = await this.prisma.zona.findUnique({
      where: { id },
      include: { _count: { select: { distritos: true } } },
    });
    if (!zona) return null;
    const tarifas = includeTarifas
      ? await this.prisma.tarifaZonaMensajero.findMany({ where: { zonaId: id } })
      : undefined;
    return toDTO(zona, zona._count.distritos, tarifas);
  }

  async list(params: ListZonasParams): Promise<ListZonasResult> {
    const [rows, total] = await Promise.all([
      this.prisma.zona.findMany({
        orderBy: { nombre: "asc" },
        skip: params.skip,
        take: params.take,
        include: { _count: { select: { distritos: true } } },
      }),
      this.prisma.zona.count(),
    ]);

    // include tarifas: una sola consulta agrupada por zona (evita N+1).
    const tarifasByZona = new Map<string, TarifaRow[]>();
    if (params.includeTarifas && rows.length > 0) {
      const tarifas = await this.prisma.tarifaZonaMensajero.findMany({
        where: { zonaId: { in: rows.map((r) => r.id) } },
      });
      for (const t of tarifas) {
        const bucket = tarifasByZona.get(t.zonaId);
        if (bucket) bucket.push(t);
        else tarifasByZona.set(t.zonaId, [t]);
      }
    }

    const items = rows.map((r) =>
      toDTO(
        r,
        r._count.distritos,
        params.includeTarifas ? (tarifasByZona.get(r.id) ?? []) : undefined,
      ),
    );
    return { items, total };
  }

  async update(id: string, data: UpdateZonaData): Promise<ZonaDTO | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const exists = await tx.zona.findUnique({ where: { id }, select: { id: true } });
        if (!exists) return null;

        // Feature 55/R5/R6 (F1.4-A = reasignar): si esta zona pasa a central, desmarca
        // cualquier OTRA central antes de actualizar, para no violar el indice unico parcial.
        if (data.esCentral === true) {
          await tx.zona.updateMany({
            where: { esCentral: true, NOT: { id } },
            data: { esCentral: false },
          });
        }

        const zona = await tx.zona.update({
          where: { id },
          data: { nombre: data.nombre, cobroVehiculo: data.cobroVehiculo, esCentral: data.esCentral },
        });
        // Reemplazo completo del N:M y de las tarifas.
        await tx.zonaDistrito.deleteMany({ where: { zonaId: id } });
        if (data.distritoIds.length > 0) {
          await tx.zonaDistrito.createMany({
            data: data.distritoIds.map((distritoId) => ({ zonaId: id, distritoId })),
          });
        }
        await tx.tarifaZonaMensajero.deleteMany({ where: { zonaId: id } });
        if (data.tarifas.length > 0) {
          await tx.tarifaZonaMensajero.createMany({ data: tarifaCreateRows(id, data.tarifas) });
        }
        const tarifas = await tx.tarifaZonaMensajero.findMany({ where: { zonaId: id } });
        return toDTO(zona, data.distritoIds.length, tarifas);
      });
    } catch (e) {
      translateEsCentralConflict(e);
    }
  }

  async hardDelete(id: string): Promise<DeleteZonaResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const exists = await tx.zona.findUnique({ where: { id }, select: { id: true } });
        if (!exists) return "not_found" as const;
        // tarifa_zona_mensajero -> zona es FK RESTRICT: hay que borrarlas antes.
        await tx.tarifaZonaMensajero.deleteMany({ where: { zonaId: id } });
        // zona_distrito es CASCADE; lo borramos explicito por claridad/simetria.
        await tx.zonaDistrito.deleteMany({ where: { zonaId: id } });
        await tx.zona.delete({ where: { id } });
        return "ok" as const;
      });
    } catch (e) {
      // FK RESTRICT desde provincia/orden/tarifas -> la zona esta en uso.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        return "referenced";
      }
      throw e;
    }
  }

  async arbol(): Promise<ArbolZonas> {
    const zonas = await this.prisma.zona.findMany({
      orderBy: { nombre: "asc" },
      include: { distritos: { include: { distrito: { include: { canton: true } } } } },
    });

    const arbol: ArbolZonas = {};
    for (const zona of zonas) {
      const cantones: Record<string, ArbolCantonNode> = {};
      for (const zd of zona.distritos) {
        const distrito = zd.distrito;
        const canton = distrito.canton;
        const ck = normalizeName(canton.nombre);
        if (!cantones[ck]) {
          cantones[ck] = { id: canton.id, value: canton.nombre, distritos: {} };
        }
        cantones[ck].distritos[normalizeName(distrito.nombre)] = {
          id: distrito.id,
          value: distrito.nombre,
        };
      }
      arbol[normalizeName(zona.nombre)] = { id: zona.id, value: zona.nombre, cantones };
    }
    return arbol;
  }

  async countExistingDistritos(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.prisma.distrito.count({ where: { id: { in: ids } } });
  }

  async countExistingVehiculos(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return this.prisma.vehiculo.count({ where: { id: { in: ids } } });
  }

  async findCentralZonaId(): Promise<string | null> {
    const z = await this.prisma.zona.findFirst({
      where: { esCentral: true },
      select: { id: true },
    });
    return z?.id ?? null;
  }
}
