import type { PrismaClient, Vehiculo } from "@prisma/client";
import type { VehiculoDTO } from "@/lib/types/vehiculos";
import type { IVehiculoRepository } from "@/lib/interfaces/repositories/IVehiculoRepository";
import { appendAccion, resolverActorCongelado } from "@/lib/repositories/registrar-accion";
import { etiquetaDeEntidad } from "@/lib/types/historial-accion-etiquetas";

// FICHA 362 (R9): el borrado registra su accion en la MISMA transaccion, asi que el `Pick` gana
// `$transaction` y `historialAccion`.
type VehiculoPrismaClient = Pick<
  PrismaClient,
  "vehiculo" | "usuario" | "tarifaZonaMensajero" | "$transaction" | "historialAccion"
>;

// Serializa la fila de Prisma a VehiculoDTO: solo id + name, sin campos internos.
function toDTO(row: Vehiculo): VehiculoDTO {
  return { id: row.id, name: row.name };
}

export class VehiculoRepository implements IVehiculoRepository {
  constructor(private readonly prisma: VehiculoPrismaClient) {}

  async findMany(): Promise<VehiculoDTO[]> {
    const rows = await this.prisma.vehiculo.findMany({ orderBy: { name: "asc" } });
    return rows.map(toDTO);
  }

  async findById(id: string): Promise<VehiculoDTO | null> {
    const row = await this.prisma.vehiculo.findUnique({ where: { id } });
    return row ? toDTO(row) : null;
  }

  async findByName(name: string): Promise<VehiculoDTO | null> {
    const row = await this.prisma.vehiculo.findUnique({ where: { name } });
    return row ? toDTO(row) : null;
  }

  async create(name: string): Promise<VehiculoDTO> {
    return toDTO(await this.prisma.vehiculo.create({ data: { name } }));
  }

  async update(id: string, name: string): Promise<VehiculoDTO | null> {
    // updateMany en vez de update: no lanza si la fila no existe, devuelve count 0.
    const res = await this.prisma.vehiculo.updateMany({ where: { id }, data: { name } });
    if (res.count === 0) return null;
    return this.findById(id);
  }

  /**
   * FICHA 362 (R4/R9/R11) — `vehiculo_borrado`. El metodo se envuelve en `$transaction` (forma 2
   * del design §2.3: era un `deleteMany` suelto).
   *
   * ⚠️ EL NOMBRE SE LEE ANTES DEL BORRADO y el registro se escribe DESPUES de comprobar
   * `count > 0`: si el `deleteMany` no alcanza ninguna fila —el vehiculo ya no estaba— NO se
   * escribe fila de registro. «Se pidio borrar» y «se borro» son cosas distintas (R11/R12).
   */
  async delete(id: string, actorUsuarioId: string | null): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const previo = await tx.vehiculo.findUnique({ where: { id }, select: { name: true } });
      const res = await tx.vehiculo.deleteMany({ where: { id } });
      if (res.count === 0) return false;

      const actor = await resolverActorCongelado(tx, actorUsuarioId);
      await appendAccion(tx, [
        {
          accion: "vehiculo_borrado",
          entidadTipo: "vehiculo",
          entidadId: id,
          entidadEtiqueta: etiquetaDeEntidad("vehiculo", { nombre: previo?.name ?? "" }),
          ...actor,
        },
      ]);
      return true;
    });
  }

  async contarUsos(id: string): Promise<number> {
    // Las DOS relaciones que declara el modelo: mensajeros que declararon este
    // vehiculo (feature 21) y tarifas de zona por tipo de vehiculo (feature 24).
    const [usuarios, tarifas] = await Promise.all([
      this.prisma.usuario.count({ where: { vehiculoId: id } }),
      this.prisma.tarifaZonaMensajero.count({ where: { vehiculoId: id } }),
    ]);
    return usuarios + tarifas;
  }
}
