import { Prisma, type PrismaClient } from "@prisma/client";
import { ConflictError } from "@/lib/errors";
import { textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";
import { normalizeName } from "@/lib/utils/normalize";
import { appendAccion, resolverActorCongelado } from "@/lib/repositories/registrar-accion";
import { etiquetaDeEntidad } from "@/lib/types/historial-accion-etiquetas";
import type { TarifaZonaMensajeroDTO, ZonaDTO } from "@/lib/types/zona";
import type {
  CreateZonaData,
  DeleteZonaResult,
  IZonaRepository,
  ListZonasParams,
  ListZonasResult,
  UpdateZonaData,
} from "@/lib/interfaces/repositories/IZonaRepository";
import type { OpcionCatalogo } from "@/lib/types/filtros-ordenes";

// Delegates + $transaction necesarios (permite acotar/mocakear en tests).
type ZonaPrismaClient = Pick<
  PrismaClient,
  | "zona"
  | "zonaDistrito"
  | "tarifaZonaMensajero"
  | "distrito"
  | "vehiculo"
  | "$transaction"
  // FICHA 362 (R9): el borrado registra su accion en la MISMA transaccion que el `delete`.
  | "historialAccion"
  | "usuario"
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
// `textoConstraintP2002` disambigua de forma robusta tanto en el motor nativo
// (`meta.target`) como bajo el driver adapter
// (`meta.driverAdapterError.cause.originalMessage`, donde vive el nombre real del
// indice `zona_es_central_unico`).
function isEsCentralUniqueViolation(e: unknown): boolean {
  const texto = textoConstraintP2002(e);
  if (!texto) return false;
  return texto.includes("es_central") || texto.includes("zona_es_central_unico");
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

  /** Feature 144/B2 (R48/R49): `{id, nombre}` de TODAS las zonas, por nombre asc. */
  async listLite(): Promise<OpcionCatalogo[]> {
    return this.prisma.zona.findMany({
      select: { id: true, nombre: true },
      orderBy: { nombre: "asc" }, // R49: orden determinista
    });
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

  /**
   * FICHA 362 (R4/R9) — `zona_borrada`. Esta escritura YA corria en `$transaction`, asi que la
   * instrumentacion es literalmente la llamada dentro del callback que ya existia.
   *
   * ⚠️ LA ETIQUETA SE CONGELA CON EL `findUnique` DE ARRIBA, ANTES DEL `delete`, y esa lectura ya
   * estaba: solo se le pide ademas el `nombre`. Despues del borrado no habria a quien preguntar
   * —el borrado es FISICO y ademas ARRASTRA SUS TARIFAS EN CASCADA—, asi que un join al leer
   * dejaria la fila del registro diciendo la nada sobre lo unico que documenta.
   */
  async hardDelete(id: string, actorUsuarioId: string | null): Promise<DeleteZonaResult> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const exists = await tx.zona.findUnique({
          where: { id },
          select: { id: true, nombre: true },
        });
        if (!exists) return "not_found" as const;
        // 362/R4: congelada ANTES de que la fila desaparezca.
        const etiqueta = etiquetaDeEntidad("zona", { nombre: exists.nombre });
        // tarifa_zona_mensajero -> zona es FK RESTRICT: hay que borrarlas antes.
        await tx.tarifaZonaMensajero.deleteMany({ where: { zonaId: id } });
        // zona_distrito es CASCADE; lo borramos explicito por claridad/simetria.
        await tx.zonaDistrito.deleteMany({ where: { zonaId: id } });
        await tx.zona.delete({ where: { id } });

        // 362/R9: DESPUES del `delete` y DENTRO del mismo callback. Si el borrado falla por la FK
        // RESTRICT de `orden`, el error sale de la transaccion y aqui no se llega: no queda fila
        // de un borrado que no ocurrio (R11).
        const actor = await resolverActorCongelado(tx, actorUsuarioId);
        await appendAccion(tx, [
          {
            accion: "zona_borrada",
            entidadTipo: "zona",
            entidadId: id,
            entidadEtiqueta: etiqueta,
            ...actor,
          },
        ]);
        return "ok" as const;
      });
    } catch (e) {
      // FK RESTRICT desde orden (y desde cierre_detail.tarifa_id, que bloquea la cascada
      // de `tarifas` cuando alguna ya se liquido) -> la zona esta en uso.
      // `tarifas` ya NO llega hasta aqui por si sola: su FK es CASCADE desde la migracion
      // 20260826160000_tarifa_fk_cascade.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        return "referenced";
      }
      throw e;
    }
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
