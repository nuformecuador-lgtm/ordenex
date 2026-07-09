import type { PrismaClient } from "@prisma/client";
import type {
  ITrustedDeviceRepository,
  TrustedDeviceRecord,
} from "@/lib/interfaces/repositories/ITrustedDeviceRepository";

type TrustedDevicePrismaClient = Pick<PrismaClient, "trustedDevice">;

export class TrustedDeviceRepository implements ITrustedDeviceRepository {
  constructor(private readonly prisma: TrustedDevicePrismaClient) {}

  async findByUsuarioAndDevice(
    usuarioId: string,
    deviceHash: string,
  ): Promise<TrustedDeviceRecord | null> {
    return this.prisma.trustedDevice.findUnique({
      where: { usuarioId_deviceHash: { usuarioId, deviceHash } },
    });
  }

  async upsert(params: {
    usuarioId: string;
    deviceHash: string;
    ipAddress: string;
  }): Promise<TrustedDeviceRecord> {
    const { usuarioId, deviceHash, ipAddress } = params;
    return this.prisma.trustedDevice.upsert({
      where: { usuarioId_deviceHash: { usuarioId, deviceHash } },
      update: { ipAddress, lastSeenAt: new Date() },
      create: { usuarioId, deviceHash, ipAddress },
    });
  }
}
