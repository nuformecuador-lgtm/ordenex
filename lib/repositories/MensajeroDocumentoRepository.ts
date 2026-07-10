import type { PrismaClient } from "@prisma/client";
import type {
  IMensajeroDocumentoRepository,
  MensajeroDocumentoDTO,
} from "@/lib/interfaces/repositories/IMensajeroDocumentoRepository";

type DocPrismaClient = Pick<PrismaClient, "mensajeroDocumento">;

// Feature 21 — solo lectura de los documentos del mensajero (R17). La escritura
// va por PostulacionRepository dentro de la transaccion atomica (R24).
export class MensajeroDocumentoRepository implements IMensajeroDocumentoRepository {
  constructor(private readonly prisma: DocPrismaClient) {}

  async findByUsuario(usuarioId: string): Promise<MensajeroDocumentoDTO[]> {
    return this.prisma.mensajeroDocumento.findMany({
      where: { usuarioId },
      orderBy: { tipo: "asc" },
      select: {
        id: true,
        usuarioId: true,
        tipo: true,
        storagePath: true,
        contentType: true,
      },
    });
  }
}
