// Feature 41 — Route Handler del corte diario (R5/R11/R24). Capa Controller: solo HTTP
// + autorizacion por `CRON_SECRET`; delega TODA la logica de negocio en
// CorteDiarioService (docs/architecture.md, patron Controller -> Service -> Repo). Sin
// queries ni logica de negocio aqui. NUNCA loguea el secreto ni PII (R24).
import { NextResponse } from "next/server";
import { withErrorHandler, isAppErrorShape, appErrorToResponse } from "@/lib/errors";
import type { ICorteDiarioService } from "@/lib/interfaces/services/ICorteDiarioService";
import { CorteDiarioService } from "@/lib/services/CorteDiarioService";
import { CorteDiarioRepository } from "@/lib/repositories/CorteDiarioRepository";
import { CierreDiaRepository } from "@/lib/repositories/CierreDiaRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ZonaRepository } from "@/lib/repositories/ZonaRepository";
import { TarifaVigentePorTiendaRepository } from "@/lib/repositories/TarifaVigentePorTiendaRepository";
import { TarifaZonaMensajeroRepository } from "@/lib/repositories/TarifaZonaMensajeroRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { loadCronConfig } from "@/lib/config/cron";
import { notificarCierreDiaVencidoReal } from "@/lib/notificaciones/notificadores";

export interface CorteDiarioDeps {
  // Secreto esperado (inyectable en tests). Por defecto, `CRON_SECRET` del entorno.
  getSecret?: () => string | null;
  service?: ICorteDiarioService;
}

function buildService(): ICorteDiarioService {
  const prisma = getPrismaClient();
  return new CorteDiarioService(
    new CorteDiarioRepository(prisma),
    // Feature 69/T10 + decision (f): el corte diario usa el MISMO `crearCierre`, asi que
    // congela `cierre_detail` por construccion. Necesita el mismo resolver de tarifa.
    new CierreDiaRepository(prisma, new TarifaVigentePorTiendaRepository(prisma)),
    new ZonaRepository(prisma),
    new OrdenRepository(prisma),
    new TarifaZonaMensajeroRepository(prisma),
    // ⚠️ FEATURE 271 (R38/R39) — EL LOGGER VA EXPLICITO, Y ESA ES LA CORRECCION.
    //
    // `CorteDiarioService` recibe el logger en la posicion 6 y el notificador en la 7. Esta
    // llamada pasaba CINCO argumentos, asi que el notificador se quedaba con su default NO-OP y
    // el aviso de «tu cierre del dia vencio» —el que mas se emite de toda la ficha, y el unico que
    // se dispara solo, cada noche y sin nadie mirando— NO SE EMITIA NUNCA. Con la suite entera en
    // verde: el censo de `notificacion-notificadores-reales.test.ts` comprobaba que el DEFAULT del
    // service fuera el no-op, que es justo lo que seguia siendo verdad.
    //
    // Para llegar al septimo hay que nombrar al sexto. Se repite el default del service en vez de
    // exportarlo porque este es el composition root: decidir a donde va el aviso agregado de los
    // mensajeros sin zona (P2/R24, un conteo sin PII) es exactamente su trabajo.
    { warn: (m: string) => console.warn(m) },
    // FEATURE 271 (T6.4, R38/R39): COMPOSITION ROOT del aviso «tu cierre del dia vencio». Se
    // cablea AQUI y no como default del service (ver `lib/notificaciones/notificadores.ts`): el
    // default es el no-op para que ninguna suite escriba avisos en la base, que es COMPARTIDA.
    // Hay guardia que lo comprueba (`notificacion-notificadores-reales.test.ts`).
    notificarCierreDiaVencidoReal,
  );
}

// Extrae el token `Bearer <token>` del header Authorization; null si ausente/mal formado.
function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (header === null) return null;
  const match = header.match(/^Bearer\s+(.+)$/);
  return match ? match[1] : null;
}

/**
 * Logica del endpoint, extraida de `GET` para permitir inyeccion de dependencias en
 * tests (secreto + service fake) sin DB real ni entorno. R5: sin/incorrecto secreto ->
 * 401 sin efectos (ni siquiera se construye el service). R24: nunca se loguea el secreto.
 */
export async function handleCorteDiario(
  req: Request,
  deps: CorteDiarioDeps = {},
): Promise<NextResponse> {
  // R5: autorizacion ANTES de cualquier efecto. Secreto no configurado -> 401 (no se
  // ejecuta el corte con el endpoint abierto).
  const expected = (deps.getSecret ?? (() => loadCronConfig().CORTE_DIARIO_SECRET))();
  const provided = bearerToken(req);
  if (expected === null || provided === null || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await withErrorHandler(async () => {
    const service = deps.service ?? buildService();
    const resumen = await service.ejecutarCorte();
    // R24: resumen SIN PII (solo conteos).
    return {
      vencidosCreados: resumen.vencidosCreados,
      mensajerosEvaluados: resumen.mensajerosEvaluados,
    };
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result); // error notificado por el logger, sin secreto
  return NextResponse.json(result, { status: 200 });
}

export async function GET(req: Request): Promise<NextResponse> {
  return handleCorteDiario(req);
}
