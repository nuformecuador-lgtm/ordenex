// FICHA 469 (design §3.3) — la pieza del composition root que comparten los bordes del libro (caja,
// estado de cuenta y detalle de una fila): el `BusquedaPorGuiaService` REAL sobre sus dos repositorios.
// Sin «use server»: no es una accion. Lo afirma `tests/unit/actions/busqueda-por-guia-469-roots.test.ts`.
import type { PrismaClient } from "@prisma/client";

import { CierreAporteRepository } from "@/lib/repositories/CierreAporteRepository";
import { OrdenIdentificadaRepository } from "@/lib/repositories/OrdenIdentificadaRepository";
import { BusquedaPorGuiaService } from "@/lib/services/BusquedaPorGuiaService";

export function buildBusquedaPorGuia(prisma: PrismaClient): BusquedaPorGuiaService {
  return new BusquedaPorGuiaService(new OrdenIdentificadaRepository(prisma), new CierreAporteRepository(prisma));
}
