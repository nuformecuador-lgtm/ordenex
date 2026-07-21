import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // La evidencia de gestion (mis-asignaciones) admite fotos de hasta 5 MB
    // (GESTION_MAX_FILE_BYTES, lib/config/gestion.ts). El default de Server
    // Actions es 1 MB y tumbaba la gestion con un 413 antes de llegar al action.
    // En el caso normal la foto se comprime en el cliente (~400 KB, ver
    // GestionarOrdenPanel); este limite es solo la red de seguridad, alineado
    // con MAX_FILE_BYTES (5 MB) + holgura para el overhead del multipart.
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
