import type { PrismaClient } from "@prisma/client";

import type { IOrdenTraspasoRepository } from "@/lib/interfaces/repositories/IOrdenTraspasoRepository";
import type { OrdenHistorialTraspasoDTO } from "@/lib/types/orden-historial";

// FICHA 427 (T20, design §9) — la LECTURA del rastro de traspasos entre mensajeros.
//
// Solo consultas: ninguna decision de negocio vive aqui. La fusion con las transiciones y las
// correcciones del dia, y el orden entre las TRES fuentes, son del SERVICIO
// (`fusionarLineaDeTiempo`), no de este repositorio. Molde literal de
// `OrdenDiaRepartoCambioRepository` (262), que es la hermana de esta misma familia.
//
// Cliente acotado a la tabla que necesita, patron `CambioDiaPrismaClient`: el `Pick` deja escrito
// que este repo no alcanza nada mas, y hace que un doble de test no tenga que fingir un
// `PrismaClient` entero.
type TraspasoPrismaClient = Pick<PrismaClient, "ordenTraspasoMensajero">;

// Los TRES nombres por `include`, igual que `CON_ACTOR` en el repo hermano: el DTO sale legible y el
// servicio recibe algo que solo tiene que MEZCLAR. Las tres columnas son NOT NULL y sus FK son
// `Restrict`, asi que las relaciones SIEMPRE resuelven: no hay `?? null` que escribir, y por eso los
// tres nombres son `string` en el DTO.
//
// ⚠️ `actorRol` SE SELECCIONA DE LA FILA Y NO SE RESUELVE POR EL `include` DEL ACTOR. Es R26 puesto
// en la consulta: `actor: { select: { nombre: true, rol: true } }` habria devuelto el rol VIVO de
// esa persona y habria re-etiquetado la historia el dia que a alguien lo asciendan. La fila guarda
// el rol DEL ACTO y es el que se lee.
const CON_NOMBRES = {
  select: {
    motivo: true,
    actorRol: true,
    createdAt: true,
    mensajeroAnterior: { select: { nombre: true } },
    mensajeroNuevo: { select: { nombre: true } },
    actor: { select: { nombre: true } },
  },
} as const;

export class OrdenTraspasoRepository implements IOrdenTraspasoRepository {
  constructor(private readonly prisma: TraspasoPrismaClient) {}

  /**
   * R29/R30 — el rastro de traspasos de esta orden, en orden y ya legible.
   *
   * EL `ORDER BY` LLEVA DOS COLUMNAS Y LAS DOS IMPORTAN. `created_at ASC` es el orden que la linea
   * de tiempo necesita; `id ASC` es el DESEMPATE, y sin el las N filas que un mismo acto escribe en
   * una sola transaccion —todas con el MISMO `CURRENT_TIMESTAMP`— saldrian en orden indefinido.
   *
   * SE RESUELVE POR EL INDICE `(orden_id, created_at)`, que el modelo declara como «la lectura
   * prevista» (design §4.1).
   */
  async findTraspasosByOrden(ordenId: string): Promise<OrdenHistorialTraspasoDTO[]> {
    const filas = await this.prisma.ordenTraspasoMensajero.findMany({
      where: { ordenId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      ...CON_NOMBRES,
    });

    return filas.map((fila) => ({
      clase: "traspaso_mensajero" as const,
      mensajeroAnteriorNombre: fila.mensajeroAnterior.nombre,
      mensajeroNuevoNombre: fila.mensajeroNuevo.nombre,
      actorNombre: fila.actor.nombre,
      actorRol: fila.actorRol, // R26: el CONGELADO de la fila
      motivo: fila.motivo,
      createdAt: fila.createdAt,
    }));
  }
}
