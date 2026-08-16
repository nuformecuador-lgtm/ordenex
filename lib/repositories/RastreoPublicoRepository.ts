import type { PrismaClient } from "@prisma/client";

import type {
  IRastreoPublicoRepository,
  OrdenRastreoFila,
  TransicionRastreoFila,
} from "@/lib/interfaces/repositories/IRastreoPublicoRepository";

// Feature 229 (design §1) — las DOS lecturas del rastreo publico contra Postgres.
//
// Solo consultas: ninguna decision de negocio vive aqui (R33). No filtra por `deletedAt`
// (eso lo decide el service, que necesita que los cuatro casos malos cuesten lo mismo,
// R8) y no traduce estatus a hitos (eso es proyeccion, R33).
//
// Los dos `select` son EXPLICITOS y esa es la mitad del diseño (R25): enumeran lo que se
// lee para que la ausencia de `direccion`, `montoCobrar`, `producto`, `notas`,
// `destinatario`, `mensajeroAsignadoId`, `actorUsuarioId`, `origenTipo`, `motivo` y
// `gestionOrdenId` sea VERIFICABLE por una guardia, no una promesa. Un `include` o una
// fila completa proyectada despues volveria la fuga cuestion de memoria.

type RastreoPrismaClient = Pick<PrismaClient, "orden" | "ordenHistorialEstado">;

export class RastreoPublicoRepository implements IRastreoPublicoRepository {
  constructor(private readonly prisma: RastreoPrismaClient) {}

  async buscarPorGuia(numGuia: number): Promise<OrdenRastreoFila | null> {
    const fila = await this.prisma.orden.findUnique({
      where: { numGuia },
      select: { id: true, numGuia: true, telefonoDest: true, deletedAt: true },
    });
    if (fila === null) return null;
    return {
      id: fila.id,
      numGuia: fila.numGuia,
      telefonoDest: fila.telefonoDest,
      deletedAt: fila.deletedAt,
    };
  }

  async listarTransiciones(ordenId: string): Promise<readonly TransicionRastreoFila[]> {
    // R21 — UNA sola consulta, ordenada ascendente por el indice existente
    // `@@index([ordenId, createdAt])` (`db/schema.prisma:1573`). Nada de una consulta por
    // transicion ni de resolver el catalogo aparte.
    const filas = await this.prisma.ordenHistorialEstado.findMany({
      where: { ordenId },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, estatusDestino: { select: { value: true } } },
    });
    return filas.map((fila) => ({
      createdAt: fila.createdAt,
      estatusValue: fila.estatusDestino.value,
    }));
  }
}
