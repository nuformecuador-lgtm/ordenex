// FICHA 413 (T5.2, design §11) — Route Handler del cron del AVISO DEL REPARTO DE MAÑANA. Capa
// Controller: solo HTTP + autorizacion por `CRON_SECRET`; delega TODA la logica de negocio en
// `RepartoMananaAvisoService` (docs/architecture.md, patron Controller -> Service -> Repo). Sin
// queries ni reglas aqui. Clon del patron de `avisos-diarios` (409), con el MISMO secreto y otra
// hora. Auth ANTES de cualquier efecto: 401 sin construir el service y sin tocar la DB. NUNCA
// loguea el secreto ni PII.
//
// ⚠️ EL HORARIO VA EN `vercel.json` Y ES `0 1 * * *`, QUE NO SE «CORRIGE». Ese fichero va en
// **UTC**; Costa Rica es **UTC−6 fijo, sin horario de verano**; por tanto:
//
//     19:00 CR = 01:00 UTC DEL DIA SIGUIENTE  =>  "0 1 * * *"
//
// Escribir `0 19 * * *` aqui pondria el aviso a LA 1:00 DE LA MADRUGADA CR — justo la hora a la
// que la 410 no debe empujar una notificacion al telefono de nadie, y la franja que R11 prohibe
// explicitamente. Los crons vecinos usan `0 6 * * *`, que NO es «las seis de la mañana»: es
// MEDIANOCHE CR.
//
// La hora CR vive en `lib/config/aviso-reparto-manana.ts` (`HORA_CR: 19`, con su medicion al lado)
// y `tests/unit/guards/cron-hora-cr.guardia.test.ts` CONVIERTE la expresion de `vercel.json` a
// hora CR y la compara con esa constante. Dos sitios que dicen la misma hora en unidades distintas
// es justo como se acaba con dos verdades: aqui uno es la fuente y el otro se VERIFICA.
//
// LA CORRIDA DE `01:00Z` DEL DIA D+1 ES, EN HORA DE PARED, LAS 19:00 DEL DIA D:
// `fechaCalendarioCR(2026-09-12T01:00Z)` = `"2026-09-11"`, y su mañana es `"2026-09-12"`. El
// codigo no hace ninguna resta: usa `startOfDayCR(now)` y compara con `>`.
import { NextResponse } from "next/server";
import { withErrorHandler, isAppErrorShape, appErrorToResponse } from "@/lib/errors";
import type { IRepartoMananaAvisoService } from "@/lib/interfaces/services/IRepartoMananaAvisoService";
import { RepartoMananaAvisoService } from "@/lib/services/RepartoMananaAvisoService";
import { RepartoMananaRepository } from "@/lib/repositories/RepartoMananaRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import { loadCronConfig } from "@/lib/config/cron";
import { notificarRepartoMananaReal } from "@/lib/notificaciones/notificadores";

export interface AvisoRepartoMananaDeps {
  /** Secreto esperado (inyectable en tests). Por defecto, el `CRON_SECRET` del entorno. */
  getSecret?: () => string | null;
  service?: IRepartoMananaAvisoService;
  /** Reloj inyectable (tests): por defecto `new Date()`. Determina el dia CR de la corrida. */
  now?: () => Date;
}

function buildService(): IRepartoMananaAvisoService {
  const prisma = getPrismaClient();
  return new RepartoMananaAvisoService(
    new RepartoMananaRepository(prisma),
    // R42 — el predicado del bloqueo NO se reescribe: se reusa el que ya deriva de
    // `estaBloqueadoPorCierres`, la unica definicion de la regla (271/R10). Entra como `Pick` de
    // un solo metodo, asi que el resto de `OrdenRepository` no queda consultable por descuido.
    new OrdenRepository(prisma),
    // ⚠️ FICHA 413 (T5.3, R36) — COMPOSITION ROOT DEL AVISO. Se cablea AQUI y no como default del
    // service: el default es el NO-OP para que ninguna suite escriba avisos en la base, que es
    // COMPARTIDA entre worktrees.
    //
    // ESTA LINEA ES EL REQUISITO, NO EL `import` DE ARRIBA. En `corte-diario` la llamada pasaba
    // cinco argumentos y el notificador se quedaba con su default: el aviso nocturno no se emitio
    // JAMAS, con la suite entera en verde — dos de siete notificadores muertos. Borrar este
    // argumento DEJANDO EL IMPORT INTACTO reproduce ese fallo, y por eso la guardia de
    // `tests/unit/services/notificacion-notificadores-reales.test.ts` afirma sobre el USO EFECTIVO
    // (fuente sin imports ni comentarios) y no sobre el fichero entero.
    notificarRepartoMananaReal,
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
 * R33/R35 — logica del endpoint, extraida de `GET` para permitir inyeccion en tests (secreto +
 * service falso + reloj) sin DB real ni entorno.
 *
 * R33: sin secreto, con secreto incorrecto o con el secreto NO CONFIGURADO -> 401 SIN EFECTOS: ni
 * se construye el service, ni se toca la DB, ni se emite un aviso. El endpoint no queda abierto
 * por el hecho de que falte la variable.
 */
export async function handleAvisoRepartoManana(
  req: Request,
  deps: AvisoRepartoMananaDeps = {},
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
    // R35: SOLO conteos + las dos fechas. Se enumera CAMPO A CAMPO a proposito, en vez de devolver
    // `resumen` entero: asi, el dia que el servicio gane un campo con un identificador de persona,
    // de orden o de zona, NO CRUZA A LA RESPUESTA SOLO — y esta respuesta puede quedar en un log.
    return {
      fecha: resumen.fecha,
      diaAnunciado: resumen.diaAnunciado,
      mensajerosConReparto: resumen.mensajerosConReparto,
      mensajerosBloqueados: resumen.mensajerosBloqueados,
      avisosEmitidos: resumen.avisosEmitidos,
      fallos: resumen.fallos,
    };
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result); // ya notificado, sin secreto
  return NextResponse.json(result, { status: 200 });
}

export async function GET(req: Request): Promise<NextResponse> {
  return handleAvisoRepartoManana(req);
}
