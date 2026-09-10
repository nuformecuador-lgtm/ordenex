import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { quitarComentarios } from "@/tests/fixtures/sin-comentarios";
import { WebhookEstadoService } from "@/lib/services/WebhookEstadoService";
import { WebhookOrdenReader } from "@/lib/repositories/WebhookOrdenReader";
import { cifrarSecreto } from "@/lib/crypto/webhook-secret-cipher";
import type { WebhookConfig } from "@/lib/config/webhook";
import type { IWebhookSuscripcionRepository } from "@/lib/interfaces/repositories/IWebhookSuscripcionRepository";
import type { IWebhookSender, WebhookOutcome } from "@/lib/interfaces/external/IWebhookSender";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import { OrdenRepository } from "@/lib/repositories/OrdenRepository";
import { ApiOrdenLecturaService } from "@/lib/services/ApiOrdenLecturaService";
import type { ISignedUrlProvider } from "@/lib/interfaces/external/ISignedUrlProvider";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// FEATURE 404 (R5) — LA GUARDIA DE QUE `mensajero` TIENE UNA SOLA FORMA EN LAS TRES SUPERFICIES.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// QUE PROTEGE. R5 dice que el campo tiene las MISMAS claves, los MISMOS tipos y la MISMA
// convencion de ausencia en el webhook, en el listado y en el detalle. El tipo compartido
// (`ApiMensajeroDTO`) hace que un cambio de forma rompa la compilacion en los tres sitios a la vez
// — pero solo mientras siga habiendo UN tipo. El dia que alguien declare un segundo (la feature
// 405 es la candidata natural: tiene su propio mensajero, el de la gestion), el candado del
// compilador desaparece EN SILENCIO y R5 se queda en una promesa.
//
// Por eso esta guardia mide DOS cosas distintas, y ninguna sustituye a la otra:
//
//   1. COMPORTAMIENTO: las tres superficies, ejercitadas de verdad sobre la MISMA fila de
//      `usuario`, producen el MISMO objeto y el MISMO fragmento serializado. Un mapeo que
//      compusiera el nombre de otra forma en una de las tres se pone rojo aqui aunque compile.
//   2. ESTRUCTURA: `ApiMensajeroDTO` se declara UNA sola vez en todo `lib/`. Esto NO lo puede
//      detectar el grafo de imports (nadie importa «el numero de declaraciones»), que es la razon
//      por la que vive en una guardia y no en un test normal.
//
// La contraprueba del punto 2 corre el mismo detector sobre un texto MUTADO en memoria: sin ella,
// un escaneo roto que devolviera cero coincidencias quedaria verde para siempre.
//
// La selecciona `pnpm exec vitest run guard` por el nombre del archivo.

const RAIZ = path.resolve(__dirname, "../../..");

// -----------------------------------------------------------------------------------------------
// 1. COMPORTAMIENTO — la misma fila de `usuario`, las tres superficies
// -----------------------------------------------------------------------------------------------

/** La UNICA fila de `usuario` de toda la guardia: si las tres superficies la leen igual, R5 vale. */
const USUARIO = {
  id: "018f2c31-0000-4000-8000-0000000000aa",
  nombre: "Carlos",
  primerApellido: "Jimenez",
  segundoApellido: "Mora",
};

/** El literal esperado, escrito A MANO. No se deriva de `nombreCompletoUsuario`. */
const NOMBRE_ESPERADO = "Carlos Jimenez Mora";
const FRAGMENTO_ESPERADO = `"mensajero":{"id":"${USUARIO.id}","nombre":"${NOMBRE_ESPERADO}"}`;

const CLAVE = randomBytes(32).toString("base64");
const SECRET_ENC = cifrarSecreto(CLAVE, "ordx_whsec_secreto-de-firma-de-prueba");
const ACTOR: Actor = { usuarioId: "store-1", rol: "apiKey" };

const configWebhook: WebhookConfig = {
  WEBHOOK_TIMEOUT_MS: 10_000,
  WEBHOOK_REPLAY_WINDOW_S: 300,
  WEBHOOK_SECRET_ENC_KEY: CLAVE,
  WEBHOOK_APP_ORIGIN: "https://app.ordenex.co",
  WEBHOOK_PAUSA_FALLOS_MINIMOS: 3,
  WEBHOOK_PAUSA_VENTANA_MS: 30 * 60_000,
  WEBHOOK_PAUSA_INTERVALO_MS: 3_600_000,
};

const signedUrlsNoOp: ISignedUrlProvider = {
  createSignedUrl: vi.fn(async () => "https://signed/one"),
  createSignedUrls: vi.fn(async () => ({})),
};

/** El cuerpo del webhook, por la cadena real: `WebhookOrdenReader` -> `WebhookEstadoService`. */
async function cuerpoDelWebhook(
  mensajeroAsignado: typeof USUARIO | null,
): Promise<{ crudo: string; mensajero: unknown }> {
  const prisma = {
    orden: {
      findUnique: vi.fn(async () => ({
        tiendaId: ACTOR.usuarioId,
        numGuia: 100234,
        numRemision: "REM-1",
        deletedAt: null,
        gestiones: [],
        incidentesAdmin: [],
        mensajeroAsignado,
      })),
    },
    orderStatus: { findUnique: vi.fn(async () => ({ value: "en_reparto" })) },
  };
  const suscripciones = {
    findActivaByOwner: vi.fn(async () => ({ url: "https://a.example.com/hook", secret: SECRET_ENC })),
    registrarEntregaOk: vi.fn(async () => {}),
    incrementarFalloYLeer: vi.fn(async () => null),
  } as unknown as IWebhookSuscripcionRepository;
  const entregar = vi.fn(async () => ({ status: "ok" }) as WebhookOutcome);
  const sender: IWebhookSender = { entregar };
  const service = new WebhookEstadoService(
    new WebhookOrdenReader(prisma as unknown as PrismaClient),
    suscripciones,
    sender,
    configWebhook,
  );
  const job: JobDTO = {
    id: "job-1",
    tipo: "webhook_estado",
    payload: {
      ordenId: "orden-1",
      estatusDestinoId: "s-en-reparto",
      ocurridoAt: "2026-09-09T10:00:00.000Z",
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
  await service.ejecutar(job);
  const crudo = (entregar.mock.calls[0] as unknown as [string, string])[1];
  return { crudo, mensajero: JSON.parse(crudo).data.mensajero };
}

/** Fila de `orden` para `API_ORDEN_SELECT` / `API_ORDEN_DETALLE_SELECT`. */
function filaOrden(mensajeroAsignado: typeof USUARIO | null) {
  return {
    numGuia: 100234,
    numRemision: "REM-1",
    destinatario: "Ana",
    telefonoDest: "0999999999",
    producto: "Caja",
    direccion: "Calle 1",
    montoCobrar: new Prisma.Decimal(1500),
    createdAt: new Date("2026-09-09T10:00:00.000Z"),
    estatus: { value: "en_reparto" },
    gestiones: [],
    incidentesAdmin: [],
    mensajeroAsignado,
  };
}

/** El item del listado y el detalle, por la cadena real: `OrdenRepository` -> service. */
async function listadoYDetalle(mensajeroAsignado: typeof USUARIO | null) {
  const fila = filaOrden(mensajeroAsignado);
  const prisma = {
    orden: {
      findMany: vi.fn(async () => [fila]),
      count: vi.fn(async () => 1),
      findFirst: vi.fn(async () => fila),
    },
  };
  const svc = new ApiOrdenLecturaService(
    new OrdenRepository(prisma as unknown as PrismaClient),
    signedUrlsNoOp,
  );
  const listado = await svc.listar(ACTOR, { limit: 50, offset: 0 });
  const detalle = await svc.detallePorOrdenId(ACTOR, "orden-1");
  return {
    item: listado.items[0],
    detalle: detalle!,
  };
}

describe("404/R5 — comportamiento: las tres superficies producen la MISMA forma", () => {
  it("con mensajero asignado, webhook / listado / detalle dan el MISMO objeto y el MISMO JSON", async () => {
    const webhook = await cuerpoDelWebhook(USUARIO);
    const { item, detalle } = await listadoYDetalle(USUARIO);

    const esperado = { id: USUARIO.id, nombre: NOMBRE_ESPERADO };
    expect(webhook.mensajero).toEqual(esperado);
    expect(item.mensajero).toEqual(esperado);
    expect(detalle.mensajero).toEqual(esperado);

    // Y la MISMA serializacion, con el mismo orden de claves dentro del objeto: si una superficie
    // compusiera `{nombre, id}` el objeto seria igual y el string NO.
    expect(webhook.crudo).toContain(FRAGMENTO_ESPERADO);
    expect(JSON.stringify(item)).toContain(FRAGMENTO_ESPERADO);
    expect(JSON.stringify(detalle)).toContain(FRAGMENTO_ESPERADO);
  });

  it("sin mensajero asignado, las tres emiten la CLAVE con `null` (misma convencion de ausencia)", async () => {
    const webhook = await cuerpoDelWebhook(null);
    const { item, detalle } = await listadoYDetalle(null);

    expect(webhook.mensajero).toBeNull();
    expect(item.mensajero).toBeNull();
    expect(detalle.mensajero).toBeNull();
    // Presencia de clave en el JSON REAL: `undefined` no viaja y quedaria indistinguible de omitir.
    for (const json of [webhook.crudo, JSON.stringify(item), JSON.stringify(detalle)]) {
      expect(json).toContain('"mensajero":null');
    }
  });

  it("las tres exponen EXACTAMENTE `id` y `nombre`, y ninguna clave mas", async () => {
    const webhook = await cuerpoDelWebhook(USUARIO);
    const { item, detalle } = await listadoYDetalle(USUARIO);

    for (const valor of [webhook.mensajero, item.mensajero, detalle.mensajero]) {
      expect(Object.keys(valor as Record<string, unknown>)).toEqual(["id", "nombre"]);
    }
  });
});

// -----------------------------------------------------------------------------------------------
// 2. ESTRUCTURA — `ApiMensajeroDTO` se declara UNA sola vez
// -----------------------------------------------------------------------------------------------

/** Archivos `.ts`/`.tsx` de un directorio, recursivamente. */
function archivosDe(dir: string): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada);
    if (statSync(completo).isDirectory()) {
      salida.push(...archivosDe(completo));
    } else if (/\.tsx?$/.test(entrada)) {
      salida.push(completo);
    }
  }
  return salida;
}

/**
 * Declaraciones de un tipo de mensajero publico en un texto ya SIN COMENTARIOS: la prosa que
 * explica el tipo lo nombra muchas veces y no es una declaracion.
 */
function declaracionesDeTipoMensajero(codigo: string): string[] {
  const re = /(?:export\s+)?(?:interface|type)\s+(Api\w*Mensajero\w*DTO)\b/g;
  return [...codigo.matchAll(re)].map((m) => m[1]);
}

describe("404/R5 + design §D5 — estructura: un solo tipo de mensajero publico en `lib/`", () => {
  const declaraciones = archivosDe(path.join(RAIZ, "lib")).flatMap((archivo) => {
    const codigo = quitarComentarios(readFileSync(archivo, "utf8"));
    return declaracionesDeTipoMensajero(codigo).map((nombre) => ({
      nombre,
      archivo: path.relative(RAIZ, archivo).replace(/\\/g, "/"),
    }));
  });

  it("`ApiMensajeroDTO` se declara exactamente UNA vez, y en `lib/types/api-orden.ts`", () => {
    expect(declaraciones).toEqual([
      { nombre: "ApiMensajeroDTO", archivo: "lib/types/api-orden.ts" },
    ]);
  });

  it("no existe ningun SEGUNDO tipo de mensajero publico (la 405 reutiliza este, no inventa otro)", () => {
    // Si la 405 —o cualquier ficha futura— declarara `ApiMensajeroGestionDTO` o similar, el
    // candado del compilador que sostiene R5 dejaria de aplicar y esto se pondria rojo.
    expect(declaraciones.map((d) => d.nombre)).toEqual(["ApiMensajeroDTO"]);
  });

  it("CONTRAPRUEBA: el detector encuentra un segundo tipo cuando lo hay (no esta ciego)", () => {
    const mutado = `
      export interface ApiMensajeroDTO { id: string; nombre: string }
      export interface ApiMensajeroGestionDTO { id: string; nombre: string }
    `;
    expect(declaracionesDeTipoMensajero(quitarComentarios(mutado))).toEqual([
      "ApiMensajeroDTO",
      "ApiMensajeroGestionDTO",
    ]);
    // Y no confunde una MENCION con una declaracion.
    expect(
      declaracionesDeTipoMensajero(
        quitarComentarios("const x: ApiMensajeroDTO | null = null; // ApiMensajeroDTO"),
      ),
    ).toEqual([]);
  });
});
