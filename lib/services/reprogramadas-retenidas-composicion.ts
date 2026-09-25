import type { PrismaClient } from "@prisma/client";

import type { IReprogramadasRetenidasService } from "@/lib/interfaces/services/IReprogramadasRetenidasService";
import { LiberacionReprogramadaRepository } from "@/lib/repositories/LiberacionReprogramadaRepository";
import { ReprogramadaRetenidaRepository } from "@/lib/repositories/ReprogramadaRetenidaRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { ReprogramadasRetenidasService } from "@/lib/services/ReprogramadasRetenidasService";

/**
 * FICHA 462 (design §2, R7/R19) — EL UNICO ENSAMBLAJE del conteo de reprogramadas retenidas.
 *
 * Lo usan los CINCO composition roots que necesitan la cifra: el cron `avisos-diarios` (emision),
 * `lib/actions/notificaciones.ts` y `lib/services/jobs/push-web-handler.ts` (cifra viva de la
 * campana y del push), `lib/actions/cierres-admin.ts` (marca por cierre) y
 * `lib/actions/reprogramadas-retenidas.ts` (franja de `/ordenes`). Mismo argumento que
 * `buildLiberarReprogramadasService` (315/371): cinco cableados distintos del mismo servicio serian
 * cinco comportamientos que pueden divergir, y R7 exige que las cuatro superficies den LA MISMA
 * cifra. Aqui hay UN sitio.
 *
 * Recibe el `PrismaClient` en vez de resolverlo: asi los tests de integracion lo montan sobre la
 * transaccion revertida, y el composition root le pasa `getPrismaClient()`.
 *
 * La Forma A entra por el MISMO repositorio que usa el reloj (`LiberacionReprogramadaRepository`):
 * no hay una segunda seleccion de candidatas.
 */
export function buildReprogramadasRetenidasService(
  prisma: PrismaClient,
): IReprogramadasRetenidasService {
  return new ReprogramadasRetenidasService(
    new LiberacionReprogramadaRepository(prisma),
    new ReprogramadaRetenidaRepository(prisma),
    new ZonaRepository(prisma),
  );
}
