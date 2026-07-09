export interface TrustedDeviceRecord {
  id: string;
  usuarioId: string;
  deviceHash: string;
  ipAddress: string;
  lastSeenAt: Date;
  createdAt: Date;
}

export interface ITrustedDeviceRepository {
  findByUsuarioAndDevice(
    usuarioId: string,
    deviceHash: string,
  ): Promise<TrustedDeviceRecord | null>;
  /** Alta si no existe, o actualiza `lastSeenAt`/`ipAddress` si ya existe. */
  upsert(params: {
    usuarioId: string;
    deviceHash: string;
    ipAddress: string;
  }): Promise<TrustedDeviceRecord>;
}
