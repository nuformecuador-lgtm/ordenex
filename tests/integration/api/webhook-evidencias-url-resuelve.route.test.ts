// ⏳ 2026-09-10 — Feature 406 (T2, R1/R2/R5): EL CIERRE DEL LAZO entre el EMISOR del enlace y el
// ENDPOINT que ese enlace nombra.
//
// El defecto que reproduce: `data.evidenciasUrl` viajaba con el `orden.id` (un uuid interno) y el
// `{id}` del canal solo resuelve por `num_guia` o por `num_remision` (177/R8-R15). El integrador
// recibia un enlace con 404 GARANTIZADO. Nada lo cazaba porque el emisor y el resolutor son dos
// modulos que no se importan: cada uno correcto por su cuenta.
//
// POR QUE ESTO NO ES TAUTOLOGICO —y es la razon de que el archivo exista—: el identificador
// atraviesa TRES modulos independientes que no comparten codigo,
//   1. `WebhookEstadoService` lo construye y lo mete en el string que recibe el sender,
//   2. el parser de URL del runtime (`new URL` + `decodeURIComponent`) lo extrae del path,
//   3. `ApiOrdenResolucionService` lo resuelve con su propia regex y su propia precedencia,
// y el aserto final NO es sobre la cadena: es que el `orden.id` RESUELTO es el `orden.id` del
// evento. Jamas se compara la URL contra la funcion que la construye (el modo de fallo
// «asercion contra su propia fuente», que en este repo ya dejo pasar un tope que la app rechazaba).
//
// Sin DB: el autenticador y el lector de detalle se inyectan por `deps`, y la resolucion usa el
// SERVICE REAL sobre el repo fake copiado de `ordenes-api-key-orden-consulta.route.test.ts`. El
// `WHERE` de verdad se mide en `tests/integration/db/webhook-evidencias-url-resuelve-sql-real.test.ts`
// (los dobles no ven el SQL).
import { describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
import {
  handleConsultaOrdenApi,
  type ConsultaOrdenApiDeps,
} from "@/app/api/ordenes/api-key/orden/[id]/route";
import { ApiOrdenResolucionService } from "@/lib/services/ApiOrdenResolucionService";
import { WebhookEstadoService } from "@/lib/services/WebhookEstadoService";
import { cifrarSecreto } from "@/lib/crypto/webhook-secret-cipher";
import type { WebhookConfig } from "@/lib/config/webhook";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type { ApiKeyAuthResult } from "@/lib/interfaces/services/IApiKeyAuthService";
import type { ApiOrdenDetalleDTO } from "@/lib/types/api-orden";
import type {
  DatosEntregaOrden,
  IWebhookOrdenReader,
} from "@/lib/interfaces/repositories/IWebhookOrdenReader";
import type { IWebhookSuscripcionRepository } from "@/lib/interfaces/repositories/IWebhookSuscripcionRepository";
import type { IWebhookSender, WebhookOutcome } from "@/lib/interfaces/external/IWebhookSender";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";

const OWNER = "store-1";
const ACTOR: Actor = { usuarioId: OWNER, rol: "apiKey" };
const OK_AUTH: ApiKeyAuthResult = { status: "ok", actor: ACTOR, apiKeyId: "k1" };
const SECRETO_KEY = "ordx_secretovivo1234567890";
const ORIGIN = "https://app.ordenex.co";

const CLAVE = randomBytes(32).toString("base64");
const SECRET_ENC = cifrarSecreto(CLAVE, "ordx_whsec_secreto-de-firma-de-prueba");

const config: WebhookConfig = {
  WEBHOOK_TIMEOUT_MS: 10_000,
  WEBHOOK_REPLAY_WINDOW_S: 300,
  WEBHOOK_SECRET_ENC_KEY: CLAVE,
  WEBHOOK_APP_ORIGIN: ORIGIN,
  WEBHOOK_PAUSA_FALLOS_MINIMOS: 3,
  WEBHOOK_PAUSA_VENTANA_MS: 30 * 60_000,
  WEBHOOK_PAUSA_INTERVALO_MS: 3_600_000,
};

/** Una orden tal como la ven LOS DOS lados: el reader del webhook y el repo de la resolucion. */
interface Orden {
  id: string;
  numGuia: number | null;
  numRemision: string;
}

/** La orden del evento. Su `id` es el uuid que hoy viaja —mal— en el enlace. */
const ORDEN_EVENTO: Orden = {
  id: "018f2c31-0000-4000-8000-000000000002",
  numGuia: 100235,
  numRemision: "REM-0002",
};

/** OTRA orden viva DEL MISMO OWNER: el enlace no puede acabar resolviendo esta. */
const ORDEN_VECINA: Orden = {
  id: "018f2c31-0000-4000-8000-000000000009",
  numGuia: 100236,
  numRemision: "REM-0009",
};

function datosDe(orden: Orden): DatosEntregaOrden {
  return {
    tiendaId: OWNER,
    numGuia: orden.numGuia,
    numRemision: orden.numRemision,
    deletedAt: null,
    estado: "incidente",
    causaDevolucion: null,
    causaIncidente: "robado",
    mensajero: null,
  };
}

function job(ordenId: string): JobDTO {
  return {
    id: "job-1",
    tipo: "webhook_estado",
    payload: {
      ordenId,
      estatusDestinoId: "s-incidente",
      ocurridoAt: "2026-08-22T14:30:00.000Z",
    },
    estado: "processing",
    intentos: 1,
    maxIntentos: 5,
    runAfter: new Date(),
    lockedAt: new Date(),
    lastError: null,
    dedupeKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** Emite el evento de `incidente` de `orden` y devuelve EL STRING que recibio el sender. */
async function cuerpoEntregado(orden: Orden): Promise<string> {
  const ordenes: IWebhookOrdenReader = { findDatosEntrega: vi.fn(async () => datosDe(orden)) };
  const suscripciones = {
    findActivaByOwner: vi.fn(async () => ({ url: "https://a.example.com/hook", secret: SECRET_ENC })),
    registrarEntregaOk: vi.fn(async () => {}),
    incrementarFalloYLeer: vi.fn(async () => null),
  } as unknown as IWebhookSuscripcionRepository;
  const entregar = vi.fn(async () => ({ status: "ok" }) as WebhookOutcome);
  const sender: IWebhookSender = { entregar };
  const service = new WebhookEstadoService(
    ordenes,
    suscripciones,
    sender,
    config,
    () => new Date("2026-08-22T14:30:05.000Z"),
  );
  await service.ejecutar(job(orden.id));
  expect(entregar).toHaveBeenCalledTimes(1);
  return (entregar.mock.calls[0] as unknown as [string, string])[1];
}

/**
 * El paso del INTEGRADOR: coge la URL que le llego, se queda con el ultimo segmento de ruta y lo
 * decodifica. Nada de esto conoce a `WebhookEstadoService`: es `new URL` del runtime.
 */
function identificadorDelEnlace(enlace: string): string {
  const url = new URL(enlace);
  const segmentos = url.pathname.split("/");
  return decodeURIComponent(segmentos[segmentos.length - 1]);
}

/** Repo fake de la resolucion: casa por igualdad exacta, como el `WHERE` real (177/R10). */
function repoCon(filas: Orden[]) {
  return {
    findByGuiaORemisionForOwner: vi.fn(
      async (ident: { numGuia: number | null; numRemision: string }, ownerId: string) => {
        expect(ownerId).toBe(ACTOR.usuarioId); // R4/R7 de la 177: el owner sale del actor
        return filas.filter(
          (f) =>
            (ident.numGuia !== null && f.numGuia === ident.numGuia) ||
            f.numRemision === ident.numRemision,
        );
      },
    ),
  };
}

function detalleDe(orden: Orden): ApiOrdenDetalleDTO {
  return {
    numGuia: orden.numGuia,
    numRemision: orden.numRemision,
    estado: "incidente",
    destinatario: "Ana",
    telefonoDest: "0999999999",
    producto: "Caja",
    direccion: "Calle 1",
    montoCobrar: 1500,
    createdAt: new Date("2026-08-20T15:04:00.000Z"),
    mensajero: null,
    gestiones: [],
    evidencias: [],
  };
}

function deps(filas: Orden[]) {
  const repo = repoCon(filas);
  const detallePorOrdenId = vi.fn(async (_actor: Actor, ordenId: string) => {
    const fila = filas.find((f) => f.id === ordenId);
    return fila ? detalleDe(fila) : null;
  });
  const d: ConsultaOrdenApiDeps = {
    autenticar: vi.fn(async () => OK_AUTH),
    resolucionService: new ApiOrdenResolucionService(repo),
    detallePorOrdenId,
  };
  return { deps: d, repo, detallePorOrdenId };
}

function peticion(identificador: string): Request {
  return new Request(
    `http://localhost/api/ordenes/api-key/orden/${encodeURIComponent(identificador)}`,
    { method: "GET", headers: { Authorization: `Bearer ${SECRETO_KEY}` } },
  );
}

/**
 * El lazo entero, de una tirada: emitir -> extraer -> consultar. Devuelve la respuesta del handler
 * REAL y a QUE `orden.id` acabo llegando la lectura del detalle.
 */
async function lazoCompleto(orden: Orden, vecinas: Orden[] = []) {
  const cuerpo = await cuerpoEntregado(orden);
  const body = JSON.parse(cuerpo) as { data: { evidenciasUrl?: string } };
  const enlace = body.data.evidenciasUrl;
  expect(enlace, "el evento de incidente tiene que traer el enlace").toBeDefined();
  const identificador = identificadorDelEnlace(enlace as string);

  const { deps: d, detallePorOrdenId } = deps([orden, ...vecinas]);
  const res = await handleConsultaOrdenApi(peticion(identificador), identificador, d);
  const resueltos = detallePorOrdenId.mock.calls.map((c) => c[1]);
  return { res, identificador, resueltos, cuerpo };
}

describe("406/R1+R2 — el identificador del enlace de evidencias RESUELVE a la MISMA orden", () => {
  it("406/R1: orden CON guia -> 200 y el detalle devuelto es el de ESA orden", async () => {
    const { res, resueltos } = await lazoCompleto(ORDEN_EVENTO);

    expect(res.status).toBe(200);
    // El aserto de fondo: el `orden.id` al que se llego es el del evento.
    expect(resueltos).toEqual([ORDEN_EVENTO.id]);
    const detalle = (await res.json()) as { numGuia: number | null; numRemision: string };
    expect(detalle.numGuia).toBe(ORDEN_EVENTO.numGuia);
    expect(detalle.numRemision).toBe(ORDEN_EVENTO.numRemision);
  });

  it("406/R1: orden SIN guia -> 200 resolviendo por remision, y es ESA orden", async () => {
    const sinGuia: Orden = { ...ORDEN_EVENTO, numGuia: null };
    const { res, identificador, resueltos } = await lazoCompleto(sinGuia);

    expect(res.status).toBe(200);
    expect(identificador).toBe(sinGuia.numRemision);
    expect(resueltos).toEqual([sinGuia.id]);
  });

  it("406/R5: una remision con `/` y espacio sobrevive al viaje y resuelve igual", async () => {
    // Los dos caracteres que ROMPERIAN el segmento de ruta si no se codificara: el `/` inventaria
    // un segmento nuevo y el espacio no es valido en un path.
    const rara: Orden = { id: "orden-rara", numGuia: null, numRemision: "A/B C" };
    const { res, identificador, resueltos, cuerpo } = await lazoCompleto(rara);

    expect(res.status).toBe(200);
    expect(identificador).toBe("A/B C"); // round-trip caracter a caracter
    expect(resueltos).toEqual([rara.id]);
    // Y en el cable viaja codificado: UN solo segmento tras `/orden/`.
    const url = new URL(JSON.parse(cuerpo).data.evidenciasUrl as string);
    expect(url.pathname.split("/").length).toBe(
      "/api/ordenes/api-key/orden/X".split("/").length,
    );
  });

  it("406/R1: con OTRA orden viva del mismo owner, se resuelve la del EVENTO y no la vecina", async () => {
    const { res, resueltos } = await lazoCompleto(ORDEN_EVENTO, [ORDEN_VECINA]);

    expect(res.status).toBe(200);
    expect(resueltos).toEqual([ORDEN_EVENTO.id]);
    expect(resueltos).not.toContain(ORDEN_VECINA.id);
    const detalle = (await res.json()) as { numRemision: string };
    expect(detalle.numRemision).toBe(ORDEN_EVENTO.numRemision);
    expect(detalle.numRemision).not.toBe(ORDEN_VECINA.numRemision);
  });
});

describe("406/R7 — la omision del enlace esta JUSTIFICADA, no es un capricho", () => {
  it("una remision con espacios de borde NO es alcanzable por el endpoint: da 404", async () => {
    // El schema del borde RECORTA (`z.string().trim()`) y el resolutor compara por igualdad
    // EXACTA contra la columna, asi que `" REM-1 "` almacenado tal cual es inalcanzable. Por eso
    // el emisor OMITE la clave en vez de publicar un enlace que responde 404 (R7).
    const conEspacios: Orden = { id: "orden-espacios", numGuia: null, numRemision: " REM-1 " };
    const { deps: d, detallePorOrdenId } = deps([conEspacios]);
    const res = await handleConsultaOrdenApi(
      peticion(conEspacios.numRemision),
      conEspacios.numRemision,
      d,
    );

    expect(res.status).toBe(404);
    expect(detallePorOrdenId).toHaveBeenCalledTimes(0);
  });
});
