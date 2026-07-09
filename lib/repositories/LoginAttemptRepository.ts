import type { PrismaClient } from "@prisma/client";
import type {
  ILoginAttemptRepository,
  RegistrarIntentoInput,
} from "@/lib/interfaces/repositories/ILoginAttemptRepository";

type LoginAttemptPrismaClient = Pick<PrismaClient, "loginAttempt">;

export class LoginAttemptRepository implements ILoginAttemptRepository {
  constructor(private readonly prisma: LoginAttemptPrismaClient) {}

  async registrar(input: RegistrarIntentoInput): Promise<void> {
    await this.prisma.loginAttempt.create({
      data: {
        usuarioId: input.usuarioId,
        emailUsado: input.emailUsado,
        exitoso: input.exitoso,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        riskScore: input.riskScore,
        riskReason: input.riskReason,
      },
    });
  }

  async contarFallosConsecutivosRecientes(params: {
    usuarioId: string;
    ventanaMinutos: number;
  }): Promise<number> {
    const desde = new Date(Date.now() - params.ventanaMinutos * 60_000);
    const intentos = await this.prisma.loginAttempt.findMany({
      where: { usuarioId: params.usuarioId, createdAt: { gte: desde } },
      orderBy: { createdAt: "desc" },
      select: { exitoso: true },
    });

    let fallosConsecutivos = 0;
    for (const intento of intentos) {
      if (intento.exitoso) break;
      fallosConsecutivos += 1;
    }
    return fallosConsecutivos;
  }

  async ipReconocida(params: { usuarioId: string; ipAddress: string }): Promise<boolean> {
    const count = await this.prisma.loginAttempt.count({
      where: { usuarioId: params.usuarioId, ipAddress: params.ipAddress, exitoso: true },
    });
    return count > 0;
  }
}
