// Feature 255 — Cotizacion por API key: precio y cobertura ANTES de crear la orden.
//
// `POST /api/ordenes/api-key/cotizacion`. Toma la MISMA entrada que
// `POST /api/ordenes/api-key/carga` (feature 88) y NO persiste NADA: devuelve, por cada fila,
// su cobertura y cuanto costaria en los DOS escenarios posibles (entregado y devuelto).
//
// SIN TOTALES DEL LOTE (retirados el 2026-08-31): el bloque `totales` de la 255 sumaba todas
// las filas cotizadas en el escenario entregado Y en el devuelto, o sea bajo las premisas de
// "100% entregas" y "100% rechazos" a la vez. La cotizacion que este canal publica es POR
// ORDEN; agregar con una premisa de entrega real es del lado que consume.
//
// CONVIVENCIA DE RUTAS: el segmento estatico gana al dinamico en el App Router, asi que este
// hermano de `[numGuia]/` no necesita nada especial — mismo precedente que `carga/` y `orden/`.
//
// MIDDLEWARE: NADA que tocar (R48). `middleware.ts` declara `/api/ordenes/api-key` en
// `SELF_AUTH_ROUTES` y compara por prefijo, asi que un subpath nuevo pasa sin darse de alta en
// `PUBLIC_ROUTES`. Eso es lo que mantiene VERDE la guardia de la feature 229; escrito aqui para
// que nadie lo re-descubra ni "arregle" el middleware de paso.
//
// SEGURIDAD (R49): la key viaja en cada peticion. NUNCA se loguea (ni la key, ni su hash, ni el
// header `Authorization`), ni entra al cuerpo de ninguna respuesta: `appErrorToResponse` no
// incluye headers y este handler no escribe ni una linea de log.
//
// ESTE ARCHIVO NO CALCULA DINERO. No fija decimales a mano —lo prohibe el diente 2 de la
// guardia 230, que barre el arbol `app` entero— ni hace aritmetica de importes: el service
// entrega el resumen con los importes YA SERIALIZADOS y aqui solo se emiten tal cual. Tampoco hay ni una
// query Prisma: eso vive en los repositorios.
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  withErrorHandler,
  isAppErrorShape,
  appErrorToResponse,
  UnauthenticatedError,
  ForbiddenError,
  ConflictError,
  ValidationError,
  MSG,
} from "@/lib/errors";
import type {
  ApiKeyAuthResult,
  IApiKeyAuthService,
} from "@/lib/interfaces/services/IApiKeyAuthService";
import type { ICotizacionOrdenService } from "@/lib/interfaces/services/ICotizacionOrdenService";
import { ApiKeyAuthService } from "@/lib/services/ApiKeyAuthService";
import { CotizacionOrdenService } from "@/lib/services/CotizacionOrdenService";
import { MSG_COTIZACION_SIN_TARIFA } from "@/lib/services/mensajes-cotizacion";
import { ApiKeyRepository } from "@/lib/repositories/ApiKeyRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { TarifaVigenteRepository } from "@/lib/repositories/TarifaVigenteRepository";
import { getPrismaClient } from "@/lib/db/prisma-client";
import type { RawRow } from "@/lib/parsers/spreadsheet";
import { cotizacionBodySchema } from "@/lib/types/cotizacion";

// El runtime de Node es OBLIGATORIO: Prisma y el hash de la API key no corren en edge.
export const runtime = "nodejs";

// Mismo presupuesto de tiempo que la carga para un lote del mismo tamaño (menos el render del
// PDF, que aqui no existe). Explicito para no depender del default de plataforma (10 s).
export const maxDuration = 60;

export interface CotizacionApiDeps {
  autenticar?: (rawKey: string | null) => Promise<ApiKeyAuthResult>;
  cotizacionService?: ICotizacionOrdenService;
}

function buildAutenticar(): (rawKey: string | null) => Promise<ApiKeyAuthResult> {
  const prisma = getPrismaClient();
  const auth: IApiKeyAuthService = new ApiKeyAuthService(new ApiKeyRepository(prisma));
  return (rawKey) => auth.autenticar(rawKey);
}

// Composition root del service. Los dos parametros son `Pick<...>` de las interfaces de
// repositorio, asi que los repositorios concretos encajan sin cast: el service solo alcanza
// las TRES lecturas geograficas y el resolver de tarifa cotizable (lectura pura, R43-R45).
function buildCotizacionService(): ICotizacionOrdenService {
  const prisma = getPrismaClient();
  return new CotizacionOrdenService(
    new OrdenRepository(prisma),
    new TarifaVigenteRepository(prisma),
  );
}

// R1: extrae el secreto del header `Authorization: Bearer <key>`. `null` si el header esta
// ausente o no usa el esquema `Bearer` (-> el autenticador lo trata como sin key, R2). Misma
// funcion que la carga, palabra por palabra: un borde que extrajera la key de otra forma seria
// una segunda semantica de autenticacion en el mismo canal.
function extraerBearer(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim() === "" ? null : token;
}

/**
 * Logica del endpoint, extraida para inyeccion de dependencias en tests (autenticar +
 * service fake), sin DB ni cookies reales — mismo patron que `handleCargaApi`.
 *
 * ORDEN NORMATIVO (design.md §2.3, R14):
 * `auth (401/403)` -> `cuerpo (422)` -> `tarifa (409)` -> `geo + costos por fila (200)`.
 * Los dos ultimos pasos son del service; aqui se traduce su resultado discriminado.
 */
export async function handleCotizacionApi(
  req: Request,
  deps: CotizacionApiDeps = {},
): Promise<NextResponse> {
  const result = await withErrorHandler(async () => {
    // 1. R1-R3: autenticacion por API key ANTES de tocar el cuerpo. Una key ausente y una key
    // inexistente producen el MISMO 401 (R2): ambas llegan aqui como `unauthenticated`, asi
    // que desde fuera son indistinguibles. NO hay ningun `if` sobre "la tienda tiene API key"
    // (R5): despues de autenticar seria codigo muerto e inalcanzable.
    const rawKey = extraerBearer(req);
    const auth = await (deps.autenticar ?? buildAutenticar())(rawKey);
    if (auth.status === "unauthenticated") throw new UnauthenticatedError(); // R1/R2 -> 401
    if (auth.status === "forbidden") throw new ForbiddenError(); // R3 -> 403

    // 2. R6: cuerpo valido (JSON + schema). El schema es GRUESO a proposito —lote no vacio y
    // por debajo del tope (R8)—; la validacion FINA de cada fila la hace el service, porque
    // una fila mala se marca como error en su propio resultado y no tumba el lote (R21).
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: { ordenes: ["cuerpo JSON inválido"] },
      });
    }
    const parsed = cotizacionBodySchema.safeParse(json);
    if (!parsed.success) {
      const fieldErrors = z.flattenError(parsed.error).fieldErrors as Record<string, string[]>;
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors });
    }

    // 3. R4: el dueño de la cotizacion sale SIEMPRE del actor de la key. Ningun identificador
    // de tienda, dueño o tarifa del cuerpo llega al service: solo viajan las filas.
    const service = deps.cotizacionService ?? buildCotizacionService();
    const cotizacion = await service.cotizar(parsed.data.ordenes as RawRow[], auth.actor);

    // R13/R15: sin tarifa cotizable NO se emite ningun importe — ni siquiera un cero. Es la
    // inversion deliberada del gap D1/R8 de la feature 98: en una carga el `0.00` es tolerable
    // porque el paquete se mueve igual; en una cotizacion el precio ES la respuesta, y un cero
    // seria una mentira sobre dinero servida como precio.
    if (cotizacion.status === "sin_tarifa") throw new ConflictError(MSG_COTIZACION_SIN_TARIFA);
    // Defensa en profundidad: el rol ya se comprobo al autenticar.
    if (cotizacion.status === "forbidden") throw new ForbiddenError();

    // R34/R46: el resumen viaja TAL CUAL. Ya trae `total`, `cotizadas`, `conError` y las DOS
    // listas por fila con su indice 1-based —`filas` con lo cotizado (incluido el
    // `montoCobrar` sobre el que se cotizo) y `errores` con lo que no se pudo cotizar—, con
    // cada importe UNA sola vez y SOLO crudo. Este borde no reescribe ni un campo.
    return cotizacion.resumen;
  });

  if (isAppErrorShape(result)) return appErrorToResponse(result);
  return NextResponse.json(result, { status: 200 });
}

export async function POST(req: Request): Promise<NextResponse> {
  return handleCotizacionApi(req);
}
