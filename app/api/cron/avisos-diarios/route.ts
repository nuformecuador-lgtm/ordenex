// FICHA 409 (T4.3, design §4.4) — Route Handler del cron DIARIO de AVISOS AGREGADOS. Capa
// Controller: solo HTTP + autorizacion por `CRON_SECRET`; delega TODA la logica de negocio en
// `AvisosDiariosService` (docs/architecture.md, patron Controller -> Service -> Repo). Sin queries
// ni reglas aqui. Clon del patron de `generar-gastos-fijos` (feature 45/84), con el MISMO secreto.
// Auth ANTES de cualquier efecto: 401 sin construir el service y sin tocar la DB. NUNCA loguea el
// secreto ni PII.
//
// ⚠️ EL HORARIO VA EN `vercel.json` Y ES `0 13 * * *`, QUE NO SE «CORRIGE». Ese fichero va en
// **UTC**; Costa Rica es **UTC−6 fijo, sin horario de verano**; por tanto 07:00 CR = 13:00 UTC.
// Los crons vecinos usan `0 6 * * *`, que NO es «las seis de la mañana»: es MEDIANOCHE CR.
// Escribir `0 7 * * *` aqui pondria el aviso a la 1:00 de la madrugada CR — justo la hora a la que
// la ficha 410 no debe empujar una notificacion al telefono de nadie.
import { NextResponse } from "next/server";
import { withErrorHandler, isAppErrorShape, appErrorToResponse } from "@/lib/errors";
import type { IAvisosDiariosService } from "@/lib/interfaces/services/IAvisosDiariosService";
import { AvisosDiariosService } from "@/lib/services/AvisosDiariosService";
import { AvisoAgregadoRepository } from "@/lib/repositories/AvisoAgregadoRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { OrdenHistorialRepository } from "@/lib/repositories/OrdenHistorialRepository";
import { OrdenDiaRepartoCambioRepository } from "@/lib/repositories/OrdenDiaRepartoCambioRepository";
import { OrdenHistorialService } from "@/lib/services/OrdenHistorialService";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { loadCronConfig } from "@/lib/config/cron";
import { avisosDiariosConfig } from "@/lib/config/avisos-diarios";
import {
  notificarDevolucionesRepresadasReal,
  notificarNovedadesSinGestionarReal,
} from "@/lib/notificaciones/notificadores";

export interface AvisosDiariosDeps {
  /** Secreto esperado (inyectable en tests). Por defecto, el `CRON_SECRET` del entorno. */
  getSecret?: () => string | null;
  service?: IAvisosDiariosService;
  /** Reloj inyectable (tests): por defecto `new Date()`. Determina el dia CR de la corrida. */
  now?: () => Date;
}

function buildService(): IAvisosDiariosService {
  const prisma = getPrismaClient();
  return new AvisosDiariosService(
    // El conteo VIVO de novedades DELEGA en el metodo que ya pinta `/novedades`, para que el
    // numero del aviso y el de la pantalla no puedan divergir.
    new AvisoAgregadoRepository(prisma, new OrdenRepository(prisma)),
    // De todo `OrdenHistorialService` este proceso usa UNA cosa: `contarIntentosEnLote`. Se
    // construye entero igualmente —con sus tres repositorios— porque es el mismo conteo que
    // aplica el cron del rechazo automatico, y tener dos formas de obtener ese numero es la clase
    // de divergencia que 215/R4 existe para impedir.
    new OrdenHistorialService(
      new OrdenRepository(prisma),
      new OrdenHistorialRepository(prisma),
      new OrdenDiaRepartoCambioRepository(prisma),
    ),
    // R53: el umbral entra por configuracion, con su medicion al lado. No es un literal del
    // servicio.
    avisosDiariosConfig.DIAS_REPRESAMIENTO,
    // ⚠️ FICHA 409 (T4.5, R62) — COMPOSITION ROOT DE LOS DOS AVISOS. Se cablea AQUI y no como
    // default del service: el default es el NO-OP para que ninguna suite escriba avisos en la
    // base, que es COMPARTIDA entre worktrees.
    //
    // ESTAS DOS LINEAS SON EL REQUISITO, NO LOS `import` DE ARRIBA. En `corte-diario` la llamada
    // pasaba cinco argumentos y el notificador se quedaba con su default: el aviso nocturno no se
    // emitio JAMAS, con la suite entera en verde — dos de siete notificadores muertos. Borrar
    // cualquiera de estos argumentos DEJANDO EL IMPORT INTACTO reproduce ese fallo, y por eso la
    // guardia de `tests/unit/services/notificacion-notificadores-reales.test.ts` afirma sobre el
    // USO EFECTIVO (fuente sin imports ni comentarios) y no sobre el fichero entero.
    notificarNovedadesSinGestionarReal,
    notificarDevolucionesRepresadasReal,
  );
}

/** Extrae el token `Bearer <token>` del header Authorization; `null` si ausente o mal formado. */
function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (header === null) return null;
  const match = header.match(/^Bearer\s+(.+)$/);
  return match ? match[1] : null;
}

/**
 * R59/R61 — logica del endpoint, extraida de `GET` para permitir inyeccion en tests (secreto +
 * service falso + reloj) sin DB real ni entorno.
 *
 * R59: sin secreto, con secreto incorrecto o con el secreto NO CONFIGURADO -> 401 SIN EFECTOS: ni
 * se construye el service, ni se toca la DB, ni se emite un aviso. El endpoint no queda abierto
 * por el hecho de que falte la variable.
 */
export async function handleAvisosDiarios(
  req: Request,
  deps: AvisosDiariosDeps = {},
): Promise<NextResponse> {
  const expected = (deps.getSecret ?? (() => loadCronConfig().CORTE_DIARIO_SECRET))();
  const provided = bearerToken(req);
  if (expected === null || provided === null || provided !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await withErrorHandler(async () => {
    const service = deps.service ?? buildService();
    const ahora = (deps.now ?? (() => new Date()))();
    const resumen = await service.ejecutar(ahora);
    // R61: SOLO conteos + la fecha CR. Se enumera CAMPO A CAMPO a proposito, en vez de devolver
    // `resumen` entero: asi, el dia que el servicio gane un campo con un identificador de tienda,
    // de zona o de persona, no cruza a la respuesta solo.
    return {
      fecha: resumen.fecha,
      tiendasConNovedades: resumen.tiendasConNovedades,
      avisosNovedadesEmitidos: resumen.avisosNovedadesEmitidos,
      ordenesRepresadas: resumen.ordenesRepresadas,
      zonasConRepresadas: resumen.zonasConRepresadas,
      avisosRepresadasEmitidos: resumen.avisosRepresadasEmitidos,
      fallos: resumen.fallos,
    };
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result); // ya notificado, sin secreto
  return NextResponse.json(result, { status: 200 });
}

export async function GET(req: Request): Promise<NextResponse> {
  return handleAvisosDiarios(req);
}
