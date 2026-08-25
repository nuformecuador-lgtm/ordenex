import { Prisma, type Tarifa, type PrismaClient } from "@prisma/client";
import { ConflictError } from "@/lib/errors";
import { textoConstraintP2002 } from "@/lib/repositories/_shared/prisma-unique";
import { ROLES_TARIFABLES, type TarifaDTO } from "@/lib/types/tarifa";
import type {
  CreateTarifaData,
  DeleteTarifaResult,
  ITarifaRepository,
  ListTarifasParams,
  ListTarifasResult,
  UpdateTarifaData,
} from "@/lib/interfaces/repositories/ITarifaRepository";

type TarifaPrismaClient = Pick<PrismaClient, "tarifa" | "usuario" | "zona">;

type TarifaRow = Tarifa;

// Serializa la fila de Prisma a TarifaDTO: las 8 columnas Decimal -> number
// (R27), incluye tiendaId. Ya no hay `deletedAt` que ocultar: la tabla borra en
// fisico (ver la migracion tarifa_zona_is_default), ni `status` que proyectar
// (274/R12: la columna se fue con `20260825120000_drop_tarifa_status`).
function toDTO(row: TarifaRow): TarifaDTO {
  return {
    id: row.id,
    tiendaId: row.tiendaId ?? null,
    valorFlete: row.valorFlete.toNumber(),
    valorFleteDevuelto: row.valorFleteDevuelto.toNumber(),
    valorFleteGam: row.valorFleteGam.toNumber(),
    valorFleteDevueltoGam: row.valorFleteDevueltoGam.toNumber(),
    fulfillment: row.fulfillment.toNumber(),
    comisionCod: row.comisionCod.toNumber(),
    ivaFlete: row.ivaFlete.toNumber(),
    ivaComisionCod: row.ivaComisionCod.toNumber(),
    // Opcional: se conserva la ausencia como `null`, no se degrada a 0 (0 seria
    // un cobro especial de cero colones, que no es lo mismo que no tener pacto).
    tarifaEspecial: row.tarifaEspecial == null ? null : row.tarifaEspecial.toNumber(),
    tarifaEspecialDevuelta:
      row.tarifaEspecialDevuelta == null ? null : row.tarifaEspecialDevuelta.toNumber(),
    zonaId: row.zonaId ?? null,
    isDefault: row.isDefault,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// El unico `(zona_id, tienda_id)` (NULLS NOT DISTINCT, ver la migracion
// tarifa_zona_is_default) hace que un par repetido llegue aqui como P2002 crudo. Sin
// traducirlo saldria como error 500 en vez de como el conflicto que es. Se reconoce
// por el texto del constraint -robusto en motor nativo y bajo el driver adapter-,
// mismo helper y mismo patron que `ZonaRepository` con `zona_es_central_unico`.
function translateParDuplicado(e: unknown): never {
  const texto = textoConstraintP2002(e);
  if (texto && (texto.includes("tarifas_zona_id_tienda_id_key") || texto.includes("zona_id,tienda_id"))) {
    throw new ConflictError("Ya existe una tarifa para esa combinacion de zona y tienda");
  }
  throw e;
}

export class TarifaRepository implements ITarifaRepository {
  constructor(private readonly prisma: TarifaPrismaClient) {}

  async create(data: CreateTarifaData): Promise<TarifaDTO> {
    try {
      return await this.createUnsafe(data);
    } catch (e) {
      translateParDuplicado(e);
    }
  }

  private async createUnsafe(data: CreateTarifaData): Promise<TarifaDTO> {
    const row = await this.prisma.tarifa.create({
      data: {
        tiendaId: data.tiendaId ?? null,
        valorFlete: new Prisma.Decimal(data.valorFlete),
        valorFleteDevuelto: new Prisma.Decimal(data.valorFleteDevuelto),
        valorFleteGam: new Prisma.Decimal(data.valorFleteGam),
        valorFleteDevueltoGam: new Prisma.Decimal(data.valorFleteDevueltoGam),
        fulfillment: new Prisma.Decimal(data.fulfillment),
        comisionCod: new Prisma.Decimal(data.comisionCod),
        ivaFlete: new Prisma.Decimal(data.ivaFlete),
        ivaComisionCod: new Prisma.Decimal(data.ivaComisionCod),
        tarifaEspecial:
          data.tarifaEspecial == null ? null : new Prisma.Decimal(data.tarifaEspecial),
        tarifaEspecialDevuelta:
          data.tarifaEspecialDevuelta == null
            ? null
            : new Prisma.Decimal(data.tarifaEspecialDevuelta),
        zonaId: data.zonaId ?? null,
        // Sin `?? false` explicito quedaria en manos del default de la columna;
        // se escribe para que el valor persistido no dependa de dos sitios.
        isDefault: data.isDefault ?? false,
      },
    });
    return toDTO(row);
  }

  async findById(id: string): Promise<TarifaDTO | null> {
    const row = await this.prisma.tarifa.findFirst({
      where: { id },
    });
    return row ? toDTO(row) : null;
  }

  async list(params: ListTarifasParams): Promise<ListTarifasResult> {
    // Sin filtro de borrados: la tabla no los tiene. Se deja el `where` explicito
    // porque `count` y `findMany` DEBEN compartirlo para que `total` case con `items`.
    const where: Prisma.TarifaWhereInput = {};

    const [items, total] = await Promise.all([
      this.prisma.tarifa.findMany({
        where,
        orderBy: { createdAt: "desc" }, // R18: orden por defecto
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.tarifa.count({ where }),
    ]);

    return { items: items.map(toDTO), total };
  }

  async update(id: string, data: UpdateTarifaData): Promise<TarifaDTO | null> {
    // Solo aplica si existe (R21); updateMany no lanza si 0 filas.
    // El try envuelve SOLO el UPDATE: reasignar zona o tienda puede chocar con el
    // unico y eso es un conflicto, no un fallo del repositorio.
    let result;
    try {
      result = await this.prisma.tarifa.updateMany({
        where: { id },
        data: this.toUpdateData(data),
      });
    } catch (e) {
      translateParDuplicado(e);
    }
    if (result.count === 0) return null;
    const row = await this.prisma.tarifa.findFirst({ where: { id } });
    return row ? toDTO(row) : null;
  }

  // Borrado FISICO: la tabla ya no tiene `deleted_at`. Es lo que permite que el
  // unico `(zona_id, tienda_id)` sea total -una tarifa borrada deja de ocupar su
  // par y se puede volver a crear-.
  async hardDelete(id: string): Promise<DeleteTarifaResult> {
    try {
      await this.prisma.tarifa.delete({ where: { id } });
      return "ok";
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        // P2025: la fila no existe (o se borro en la carrera).
        if (e.code === "P2025") return "not_found";
        // P2003: FK RESTRICT desde `cierre_detail.tarifa_id`. La tarifa quedo
        // congelada en un cierre y sacarla romperia la auditoria de esa deuda;
        // NO se fuerza aqui. El service lo traduce a `conflict`.
        if (e.code === "P2003") return "referenced";
      }
      throw e;
    }
  }

  async esTiendaAsignable(tiendaId: string): Promise<boolean> {
    const row = await this.prisma.usuario.findFirst({
      where: { id: tiendaId, rol: { value: { in: [...ROLES_TARIFABLES] } } },
      select: { id: true },
    });
    return row !== null;
  }

  async existeZona(zonaId: string): Promise<boolean> {
    const row = await this.prisma.zona.findFirst({
      where: { id: zonaId },
      select: { id: true },
    });
    return row !== null;
  }

  // 274/R13: aqui vivia `inactivarPorTienda(tiendaId)` (updateMany a
  // `status: "inactivo"`). Se fue con la columna `tarifas.status`.
  // HUECO ACEPTADO Y DECLARADO (design 274 §2.2, decision del humano 2026-08-24):
  // el caso «la tienda deja de ser adminTienda» queda SIN cobertura —como ya
  // estaba de hecho, porque ningun llamador invocaba este metodo— y NO se abre
  // ficha. No lo reintroduzcas sin decidir antes cual es el sustituto real.

  private toUpdateData(data: UpdateTarifaData): Prisma.TarifaUncheckedUpdateManyInput {
    const out: Prisma.TarifaUncheckedUpdateManyInput = {};
    if (data.tiendaId !== undefined) out.tiendaId = data.tiendaId;
    if (data.valorFlete !== undefined) out.valorFlete = new Prisma.Decimal(data.valorFlete);
    if (data.valorFleteDevuelto !== undefined) {
      out.valorFleteDevuelto = new Prisma.Decimal(data.valorFleteDevuelto);
    }
    if (data.valorFleteGam !== undefined) {
      out.valorFleteGam = new Prisma.Decimal(data.valorFleteGam);
    }
    if (data.valorFleteDevueltoGam !== undefined) {
      out.valorFleteDevueltoGam = new Prisma.Decimal(data.valorFleteDevueltoGam);
    }
    if (data.fulfillment !== undefined) out.fulfillment = new Prisma.Decimal(data.fulfillment);
    if (data.comisionCod !== undefined) out.comisionCod = new Prisma.Decimal(data.comisionCod);
    if (data.ivaFlete !== undefined) out.ivaFlete = new Prisma.Decimal(data.ivaFlete);
    if (data.ivaComisionCod !== undefined) {
      out.ivaComisionCod = new Prisma.Decimal(data.ivaComisionCod);
    }
    // `null` es un valor CON significado aqui (limpiar el pacto especial), asi
    // que solo se omite cuando el campo no viaja (`undefined`).
    if (data.tarifaEspecial !== undefined) {
      out.tarifaEspecial =
        data.tarifaEspecial === null ? null : new Prisma.Decimal(data.tarifaEspecial);
    }
    if (data.tarifaEspecialDevuelta !== undefined) {
      out.tarifaEspecialDevuelta =
        data.tarifaEspecialDevuelta === null
          ? null
          : new Prisma.Decimal(data.tarifaEspecialDevuelta);
    }
    // `null` tiene significado (desacotar de la zona); solo se omite `undefined`.
    if (data.zonaId !== undefined) out.zonaId = data.zonaId;
    if (data.isDefault !== undefined) out.isDefault = data.isDefault;
    return out;
  }
}
