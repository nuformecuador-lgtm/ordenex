import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

// `node:crypto` (HMAC) exige el runtime Node, no Edge. Explicito para que un
// cambio de default o config no mueva esta ruta a Edge y rompa la verificacion.
export const runtime = "nodejs";

// ============================================================================
// TODO(revisar): endpoint SIN AUTENTICACION DE SESION — webhook de WhatsApp
// Cloud API (Meta). Portado de la base Express que se pidio.
//
// Queda EXPUESTO A PROPOSITO al guard de sesion: Meta llama sin cookies ni
// Bearer. El GET se valida con el `hub.verify_token`; el POST de eventos se
// valida con la FIRMA `X-Hub-Signature-256` (ver `firmaValida`). El middleware
// no aplica porque vive bajo `/api/*` (cada handler se autoriza solo).
//
// PENDIENTE de revisar antes de dar por cerrado:
//   - Faltan `WHATSAPP_VERIFY_TOKEN` y `WHATSAPP_APP_SECRET` en el entorno
//     (Vercel + .env.example).
//   - GET: comparacion del verify_token NO constant-time (timing side-channel
//     de bajo riesgo; el token no es secreto de firma pero conviene igualarlo).
//   - Sin rate limiting.
//   - El POST YA valida firma, pero NO procesa el payload: solo acusa recibo.
// ============================================================================

export function GET(request: NextRequest): NextResponse {
  const params = request.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  // `verifyToken` explicito en el AND: si la env var no esta seteada, ninguna
  // peticion debe validar (evita que `undefined === undefined` deje pasar).
  if (mode === "subscribe" && Boolean(verifyToken) && token === verifyToken) {
    return new NextResponse(challenge ?? "", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  return new NextResponse(null, { status: 403 });
}

/**
 * Verifica la firma `X-Hub-Signature-256` que Meta envia en cada POST de evento.
 *
 * El header trae `sha256=<hex>`, donde `<hex>` es el HMAC-SHA256 del cuerpo CRUDO
 * de la peticion usando el App Secret como clave. Se recomputa sobre los bytes
 * exactos recibidos (por eso `body` es un Buffer, no texto reparseado) y se
 * compara en tiempo constante para no filtrar informacion por timing.
 */
function firmaValida(
  body: Buffer,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  const prefijo = "sha256=";
  if (!signatureHeader?.startsWith(prefijo)) return false;

  const recibidoHex = signatureHeader.slice(prefijo.length);
  const esperadoHex = createHmac("sha256", appSecret).update(body).digest("hex");

  // Comparacion constant-time sobre los digest en bytes. `timingSafeEqual` lanza
  // si difieren en largo, asi que se iguala primero (un largo distinto ya es
  // firma invalida). Se parsea el hex a bytes; si el header trae hex malformado,
  // el buffer resultante no coincidira en largo/contenido y da false.
  const recibido = Buffer.from(recibidoHex, "hex");
  const esperado = Buffer.from(esperadoHex, "hex");
  if (recibido.length !== esperado.length || esperado.length === 0) return false;

  return timingSafeEqual(recibido, esperado);
}

// ============================================================================
// POST de eventos entrantes de WhatsApp (mensajes, estados, etc.).
//
// TODO(revisar): la firma ya se valida, pero el payload NO se procesa todavia:
// solo se acusa recibo con 200 (Meta reintenta ante cualquier no-2xx). Al
// implementar el procesamiento, hacerlo idealmente fuera del request (cola/job)
// para responder el 200 rapido.
// ============================================================================
export async function POST(request: NextRequest): Promise<NextResponse> {
  const appSecret = process.env.WHATSAPP_APP_SECRET;

  // Sin App Secret no es posible verificar la firma: se rechaza en vez de
  // procesar a ciegas. 500 = mala configuracion del servidor (no del cliente).
  if (!appSecret) {
    return new NextResponse(null, { status: 500 });
  }

  // Bytes exactos del cuerpo: la firma se calcula sobre ellos. `arrayBuffer()`
  // (no `.json()`/`.text()` reparseados) preserva el payload tal cual llego.
  const body = Buffer.from(await request.arrayBuffer());
  const signature = request.headers.get("x-hub-signature-256");

  if (!firmaValida(body, signature, appSecret)) {
    // Firma ausente o incorrecta: el POST no proviene (comprobadamente) de Meta.
    return new NextResponse(null, { status: 401 });
  }

  // TODO(revisar): parsear `body` (JSON) y procesar/encolar los eventos.

  return new NextResponse(null, { status: 200 });
}
