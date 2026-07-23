// Integracion WhatsApp — Route Handler del cron que sincroniza las plantillas de Meta hacia
// las locales (cada 24 h). Capa Controller: solo HTTP + autorizacion por `CRON_SECRET` (el
// MISMO que corte-diario / liberar-reprogramadas / procesar-jobs); delega TODA la logica en
// `SincronizarPlantillasWhatsappService`. NUNCA loguea el secreto ni el token (R19). Clon
// estructural de `liberar-reprogramadas/route.ts`.
import { NextResponse } from "next/server";
import { withErrorHandler, isAppErrorShape, appErrorToResponse } from "@/lib/errors";
import { SincronizarPlantillasWhatsappService } from "@/lib/services/SincronizarPlantillasWhatsappService";
import { PlantillaMensajeRepository } from "@/lib/repositories/PlantillaMensajeRepository";
import { WhatsappPlantillasClient } from "@/lib/clients/whatsapp-cloud";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { loadCronConfig } from "@/lib/config/cron";
import { loadWhatsappConfig } from "@/lib/config/whatsapp";

export interface SyncPlantillasDeps {
  getSecret?: () => string | null;
  service?: SincronizarPlantillasWhatsappService | null;
}

/**
 * Construye el service real. Devuelve `null` si WhatsApp NO esta configurado (faltan envs): en
 * ese caso el cron responde 200 "skipped" en vez de fallar, para no alarmar antes de que se
 * llenen las credenciales.
 */
function buildService(): SincronizarPlantillasWhatsappService | null {
  let config;
  try {
    config = loadWhatsappConfig();
  } catch {
    return null;
  }
  const prisma = getPrismaClient();
  return new SincronizarPlantillasWhatsappService(
    new WhatsappPlantillasClient({ config }),
    new PlantillaMensajeRepository(prisma),
  );
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (header === null) return null;
  const match = header.match(/^Bearer\s+(.+)$/);
  return match ? match[1] : null;
}

export async function handleSyncPlantillas(
  req: Request,
  deps: SyncPlantillasDeps = {},
): Promise<NextResponse> {
  // Autorizacion ANTES de cualquier efecto. Secreto no configurado -> 401.
  const expected = (deps.getSecret ?? (() => loadCronConfig().CORTE_DIARIO_SECRET))();
  const provided = bearerToken(req);
  if (expected === null || provided === null || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const service = deps.service !== undefined ? deps.service : buildService();
  if (service === null) {
    // WhatsApp no configurado: nada que sincronizar todavia.
    return NextResponse.json({ skipped: "whatsapp no configurado" }, { status: 200 });
  }

  const result = await withErrorHandler(async () => service.sincronizar());
  if (isAppErrorShape(result)) return appErrorToResponse(result);
  return NextResponse.json(result, { status: 200 });
}

export async function GET(req: Request): Promise<NextResponse> {
  return handleSyncPlantillas(req);
}
