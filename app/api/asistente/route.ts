import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AppError,
  ConflictError,
  ForbiddenError,
  UnauthenticatedError,
  ValidationError,
  MSG,
  appErrorToResponse,
} from "@/lib/errors";
import { resolveActorFromSession } from "@/lib/auth/resolve-actor";
import { leerCatalogoAyuda } from "@/lib/ayuda/catalogo";
import { AnthropicAsistenteClient } from "@/lib/clients/anthropic-asistente";
import { AsistenteUsoRepository } from "@/lib/repositories/AsistenteUsoRepository";
import { AsistenteService } from "@/lib/services/AsistenteService";
import { getPrismaClient } from "@/lib/db/prisma-client";
import {
  loadAsistenteConfig,
  ASISTENTE_IMAGENES_MAX_POR_MENSAJE,
  ASISTENTE_IMAGEN_MAX_BASE64,
  ASISTENTE_IMAGEN_MEDIOS,
  ASISTENTE_MENSAJES_MAX,
  ASISTENTE_TEXTO_MAX,
} from "@/lib/config/asistente";
import { CONTENT_TYPE_NDJSON, serializarEvento } from "@/lib/asistente/protocolo";
import type { EventoAsistente } from "@/lib/asistente/protocolo";
import type { ActorAsistente, IAsistenteService } from "@/lib/interfaces/services/IAsistenteService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

/**
 * ⭑ FICHA 436 (design §2, T11) — EL BORDE HTTP DEL ASISTENTE.
 *
 * ⚠️ RUNTIME **NODE**, y no es el reflejo de «streaming = edge». `edge` no tiene `fs` —el catálogo
 * lee los `.md` del disco— ni puede abrir la conexión a Postgres que necesita el contador: con
 * `edge` esta ficha no se puede construir. El streaming en Node funciona con `ReadableStream` sin
 * ninguna concesión. Es el mismo motivo por el que `middleware.ts` fija `runtime: "nodejs"`.
 *
 * ⚠️ ROUTE HANDLER Y NO SERVER ACTION, aunque `docs/architecture.md` mande Server Action para las
 * mutaciones internas: una Server Action **no puede devolver un stream incremental**, y R19 —la
 * respuesta llega por trozos, la pantalla no se queda quieta— es un requisito de producto. Es la
 * excepción, está dicha, y no se extiende a nada más de esta ficha.
 *
 * ⚠️ NO SE TOCA `middleware.ts` (design §2.1). `/api/asistente` no está en `PUBLIC_ROUTES` ni en
 * `SELF_AUTH_ROUTES`, así que cae en el camino por defecto: sesión validada contra la base y, por
 * ser ruta de API, rechazo **401 con JSON** en vez de redirect. R12 sale de infraestructura que ya
 * existe; lo que esta ficha añade es la guardia que lo EXIGE.
 *
 * ⚠️ NI UNA LÍNEA DE DOCUMENTACIÓN SE LEE AQUÍ. La única vía es `leerCatalogoAyuda`, que se inyecta
 * en el servicio. Es lo que ata R31: si alguien le pusiera otra fuente, tendría que hacerlo en este
 * archivo, que es donde la guardia mira.
 */
export const runtime = "nodejs";

const imagenSchema = z.object({
  // LISTA BLANCA de formatos, nunca `image/*`. Y `audio/*` no está ni puede estar: el modelo que
  // responde no transcribe voz, así que un audio aceptado aquí sería una promesa falsa (D12/R29).
  medio: z.enum(ASISTENTE_IMAGEN_MEDIOS),
  // Se mide la CADENA base64 y no los bytes: medir bytes exigiría decodificar primero, es decir,
  // aceptar antes de comprobar.
  datosBase64: z.string().min(1).max(ASISTENTE_IMAGEN_MAX_BASE64),
});

const mensajeSchema = z.object({
  autor: z.enum(["usuario", "asistente"]),
  texto: z.string().trim().min(1).max(ASISTENTE_TEXTO_MAX),
  imagenes: z.array(imagenSchema).max(ASISTENTE_IMAGENES_MAX_POR_MENSAJE).optional(),
});

/**
 * ⭑ `.strict()` ES LA MITAD DE R8, Y ES LA MITAD RUIDOSA.
 *
 * Un cuerpo que traiga `rol`, `slugs`, `documentos` o `consultasHoy` **no se ignora en silencio:
 * se rechaza con 422**. Ignorar en silencio también cumpliría la letra del requisito, pero deja al
 * cliente creyendo que su `rol: "maestro"` hizo algo — y sobre todo, no se puede probar: un test
 * de «lo ignoró» se parece demasiado a un test de «no lo leyó nadie».
 *
 * La otra mitad de R8 es que en este archivo NO EXISTE ninguna lectura de esos nombres: el rol sale
 * de `resolveActorFromSession` y de ningún otro sitio (R7).
 */
const cuerpoSchema = z
  .object({
    mensajes: z.array(mensajeSchema).min(1).max(ASISTENTE_MENSAJES_MAX),
    // Sólo para R27 (qué documento es el de partida). NO amplía el contexto: se cruza contra el
    // conjunto ya acotado y si no casa se ignora. Un `rutaActual` mentiroso no abre ninguna puerta.
    rutaActual: z.string().startsWith("/").max(200).optional(),
  })
  .strict();

export interface AsistenteRouteDeps {
  getActor?: () => Promise<Actor | null>;
  service?: IAsistenteService;
}

/** Compone el servicio real. Es el ÚNICO sitio donde se decide de dónde salen los documentos. */
function construirServicio(): IAsistenteService {
  const config = loadAsistenteConfig();
  return new AsistenteService({
    proveedor: new AnthropicAsistenteClient({
      apiKey: config.ANTHROPIC_API_KEY,
      modelo: config.ASISTENTE_MODELO,
      timeoutMs: config.ASISTENTE_TIMEOUT_MS,
    }),
    usoRepo: new AsistenteUsoRepository(getPrismaClient()),
    leerCatalogo: leerCatalogoAyuda,
    maxConsultasDia: config.ASISTENTE_MAX_CONSULTAS_DIA,
  });
}

/**
 * Mensajes propios de los dos fallos de sistema. **Ninguno cita la credencial, la URL del
 * proveedor ni su error crudo** (R21), y ninguno es un 500 mudo (R20): los dos dicen qué pasó y
 * qué puede hacer la persona.
 */
const MSG_SIN_CREDENCIAL =
  "El asistente todavía no está configurado en este entorno. Avisá a la oficina; mientras tanto podés abrir la ayuda de la pantalla.";
const MSG_PROVEEDOR_CAIDO =
  "El asistente no está disponible en este momento. Probá de nuevo en un minuto; la ayuda de la pantalla sigue abierta.";

export async function handleAsistente(
  req: Request,
  deps: AsistenteRouteDeps = {},
): Promise<Response> {
  try {
    const actor = await (deps.getActor ?? resolveActorFromSession)();
    // R12 — sin sesión, 401 con cuerpo JSON y sin `Location`. El middleware ya lo responde antes
    // de llegar aquí; esto es el cinturón para cuando se invoque el handler directamente.
    if (!actor) throw new UnauthenticatedError();

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      throw new ValidationError(MSG.VALIDATION_ERROR, {
        fieldErrors: { mensajes: ["cuerpo JSON inválido"] },
      });
    }

    const leido = cuerpoSchema.safeParse(json);
    if (!leido.success) {
      const fieldErrors = z.flattenError(leido.error).fieldErrors as Record<string, string[]>;
      throw new ValidationError(MSG.VALIDATION_ERROR, { fieldErrors });
    }

    // ⭑ R7 — EL ROL SALE DE LA SESIÓN. `actor.rol` viene de `resolveActorFromSession`, que lee la
    // cookie y resuelve el rol contra la base. En este archivo no hay ninguna otra asignación de
    // `rol`, y no puede haberla: el cuerpo ya se rechazó si traía uno.
    const quien: ActorAsistente = { usuarioId: actor.usuarioId, rol: actor.rol };
    const servicio = deps.service ?? construirServicio();
    const resultado = await servicio.responder({
      actor: quien,
      mensajes: leido.data.mensajes,
      rutaActual: leido.data.rutaActual,
    });

    switch (resultado.status) {
      case "rol_no_admitido":
        // R13 — `apiKey` o rol fuera de `ROLES_AYUDA`. El proveedor no se llamó.
        throw new ForbiddenError();
      case "tope_alcanzado":
        // R15 — 409 y no 429. `lib/errors/codes.ts` es un contrato transversal de seis códigos
        // consumido por las 24 rutas de `app/api`; ampliarlo por una sola ficha obliga a tocar
        // `HTTP_STATUS_BY_CODE`, `MSG` y cada `switch` exhaustivo que hoy cierra sobre seis
        // valores. `CONFLICT` dice la verdad —la operación entra en conflicto con el estado
        // actual, y el estado es «ya usaste tus consultas de hoy»— y la persona no lee números:
        // lee el mensaje, que sí es específico.
        throw new ConflictError(resultado.mensaje);
      case "sin_credencial":
        return respuestaDeError("INTERNAL", MSG_SIN_CREDENCIAL);
      case "proveedor_caido":
        return respuestaDeError("INTERNAL", MSG_PROVEEDOR_CAIDO);
      case "ok":
        return respuestaEnTrozos(resultado);
    }
  } catch (error) {
    if (error instanceof AppError) return appErrorToResponse(error.toShape());
    console.error("asistente: fallo no previsto en el borde", error);
    return respuestaDeError("INTERNAL", MSG.INTERNAL);
  }
}

function respuestaDeError(code: "INTERNAL", message: string): NextResponse {
  return appErrorToResponse({ status: "error", code, message });
}

/**
 * ⭑ R19 — LA RESPUESTA SALE POR TROZOS, A MEDIDA QUE LLEGAN.
 *
 * El `inicio` se encola ANTES de pedirle nada al proveedor: el cliente recibe de inmediato el
 * conjunto de documentos con el que va a validar las citas (R24) y cuál es el de partida (R27),
 * así que la pantalla tiene algo que pintar desde el primer instante.
 *
 * Un fallo a mitad NO puede cambiar el status HTTP —ya se envió— así que viaja como una línea
 * `{"tipo":"error"}` con un mensaje propio (R21). Cerrar el stream a secas dejaría al cliente
 * esperando un `fin` que no llega.
 */
function respuestaEnTrozos(resultado: {
  documentos: { slug: string; titulo: string; href: string }[];
  partida: string | null;
  trozos: AsyncIterable<{ tipo: string; texto?: string }>;
}): Response {
  const codificador = new TextEncoder();
  const cuerpo = new ReadableStream<Uint8Array>({
    async start(controlador) {
      const emitir = (evento: EventoAsistente) =>
        controlador.enqueue(codificador.encode(serializarEvento(evento)));
      emitir({
        tipo: "inicio",
        documentos: resultado.documentos,
        partida: resultado.partida,
      });
      try {
        for await (const trozo of resultado.trozos) {
          if (trozo.tipo === "texto" && typeof trozo.texto === "string") {
            emitir({ tipo: "texto", texto: trozo.texto });
          }
        }
        emitir({ tipo: "fin" });
      } catch (error) {
        console.error("asistente: el stream se cortó a mitad", error);
        emitir({ tipo: "error", code: "INTERNAL", message: MSG_PROVEEDOR_CAIDO });
      } finally {
        controlador.close();
      }
    },
  });

  return new Response(cuerpo, {
    status: 200,
    headers: {
      "content-type": CONTENT_TYPE_NDJSON,
      // Sin esto, un proxy intermedio puede acumular la respuesta entera y entregarla de golpe:
      // el streaming seguiría siendo cierto en el servidor y falso en la pantalla.
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  return handleAsistente(req);
}
