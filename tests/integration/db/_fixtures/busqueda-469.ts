import type { PrismaClient } from "@prisma/client";

import { CierreAporteRepository } from "@/lib/repositories/CierreAporteRepository";
import { OrdenIdentificadaRepository } from "@/lib/repositories/OrdenIdentificadaRepository";
import { BusquedaPorGuiaService } from "@/lib/services/BusquedaPorGuiaService";

/**
 * FICHA 469 — el `BusquedaPorGuiaService` REAL sobre el cliente del test, cableado como
 * `buildBusquedaPorGuia` (`lib/actions/_shared/busqueda-por-guia.ts`).
 */
export function busquedaPorGuiaDe(cliente: unknown): BusquedaPorGuiaService {
  const c = cliente as PrismaClient;
  return new BusquedaPorGuiaService(new OrdenIdentificadaRepository(c), new CierreAporteRepository(c));
}
