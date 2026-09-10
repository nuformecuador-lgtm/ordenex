import { describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { WebhookEstadoService } from "@/lib/services/WebhookEstadoService";
import { cifrarSecreto } from "@/lib/crypto/webhook-secret-cipher";
import type { WebhookConfig } from "@/lib/config/webhook";
import type {
  IWebhookOrdenReader,
  DatosEntregaOrden,
} from "@/lib/interfaces/repositories/IWebhookOrdenReader";
import type { IWebhookSuscripcionRepository } from "@/lib/interfaces/repositories/IWebhookSuscripcionRepository";
import type { IWebhookSender, WebhookOutcome } from "@/lib/interfaces/external/IWebhookSender";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";

// ⏳ 2026-09-09 — Feature 404 (T3): `data.mensajero` en el evento `orden.estado_actualizado`.
//
// Archivo APARTE de `webhook-estado-service.test.ts` a proposito: alli viven los congeladores de
// la 99/256/268 —que esta ficha ENMIENDA, no reescribe— y aqui vive lo que la 404 anade. Todo lo
// que se afirma se afirma sobre el STRING REAL que recibe el sender (o su `JSON.parse`), nunca
// sobre un objeto intermedio: el cuerpo que se firma es ese string y no otro.

const CLAVE = randomBytes(32).toString("base64");
const SECRETO = "ordx_whsec_secreto-de-firma-de-prueba";
const SECRET_ENC = cifrarSecreto(CLAVE, SECRETO);
const URL_HOOK = "https://a.example.com/hook";
const ORIGIN = "https://app.ordenex.co";
const ORDEN_ID = "orden-1";

/** El mensajero del caso «alguien la lleva». Literales escritos A MANO, no derivados. */
const MENSAJERO_ID = "018f2c31-0000-4000-8000-0000000000aa";
const MENSAJERO_NOMBRE = "Carlos Jimenez Mora";
/** El SEGUNDO mensajero: el de la reasignacion entre dos entregas del mismo evento (R11). */
const OTRO_ID = "018f2c31-0000-4000-8000-0000000000bb";
const OTRO_NOMBRE = "Ana Solis Vega";

const config: WebhookConfig = {
  WEBHOOK_TIMEOUT_MS: 10_000,
  WEBHOOK_REPLAY_WINDOW_S: 300,
  WEBHOOK_SECRET_ENC_KEY: CLAVE,
  WEBHOOK_APP_ORIGIN: ORIGIN,
  WEBHOOK_PAUSA_FALLOS_MINIMOS: 3,
  WEBHOOK_PAUSA_VENTANA_MS: 30 * 60_000,
  WEBHOOK_PAUSA_INTERVALO_MS: 3_600_000,
};

const DATOS_BASE: DatosEntregaOrden = {
  tiendaId: "owner-A",
  numGuia: 12345,
  numRemision: "REM-DEL-OWNER-A",
  deletedAt: null,
  estado: "en_reparto",
  causaDevolucion: null,
  causaIncidente: null,
  mensajero: null,
};

const OK: WebhookOutcome = { status: "ok" };

function job(estatusDestinoId = "s-en-reparto"): JobDTO {
  return {
    id: "job-1",
    tipo: "webhook_estado",
    payload: {
      ordenId: ORDEN_ID,
      estatusDestinoId,
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
}

/**
 * Un service con el reader devolviendo `datos`. `findDatosEntrega` es una FUNCION y no un valor
 * congelado a proposito: R11 exige que la lectura ocurra en cada entrega, asi que la unica forma
 * de probarlo es que dos llamadas puedan devolver cosas distintas.
 */
function buildService(datos: DatosEntregaOrden | (() => DatosEntregaOrden)) {
  const leer = typeof datos === "function" ? datos : () => datos;
  const findDatosEntrega = vi.fn(async () => leer());
  const ordenes: IWebhookOrdenReader = { findDatosEntrega };
  const suscripciones = {
    findActivaByOwner: vi.fn(async () => ({ url: URL_HOOK, secret: SECRET_ENC })),
    registrarEntregaOk: vi.fn(async () => {}),
    incrementarFalloYLeer: vi.fn(async () => null),
  } as unknown as IWebhookSuscripcionRepository;
  const entregar = vi.fn(async () => OK);
  const sender: IWebhookSender = { entregar };
  const service = new WebhookEstadoService(ordenes, suscripciones, sender, config);
  return { service, entregar, findDatosEntrega };
}

/** El cuerpo (string CRUDO) de la n-esima entrega: lo que se firma y lo que viaja. */
function cuerpoDe(entregar: { mock: { calls: unknown[][] } }, i = 0): string {
  return (entregar.mock.calls[i] as unknown as [string, string])[1];
}

const conMensajero: DatosEntregaOrden = {
  ...DATOS_BASE,
  mensajero: { id: MENSAJERO_ID, nombre: MENSAJERO_NOMBRE },
};

describe("404/R8+R2 — `data.mensajero`: el objeto cuando lo hay, `null` cuando no", () => {
  it("404/R8: con mensajero asignado, `data.mensajero` es `{id, nombre}` con los valores exactos", async () => {
    const { service, entregar } = buildService(conMensajero);
    await service.ejecutar(job());

    const body = JSON.parse(cuerpoDe(entregar));
    expect(body.data.mensajero).toEqual({ id: MENSAJERO_ID, nombre: MENSAJERO_NOMBRE });
    // R1/R6: dos claves y ninguna mas, tambien despues de pasar por `JSON.stringify`.
    expect(Object.keys(body.data.mensajero)).toEqual(["id", "nombre"]);
  });

  it("404/R2: sin mensajero la clave VIAJA IGUALMENTE con `null` (no se omite)", async () => {
    const { service, entregar } = buildService(DATOS_BASE);
    await service.ejecutar(job());

    const cuerpo = cuerpoDe(entregar);
    const body = JSON.parse(cuerpo);
    // Se afirma por PRESENCIA DE CLAVE, no con `toBeUndefined()` a secas: `undefined` no viaja en
    // JSON y confundiria «omitido» con «null».
    expect("mensajero" in body.data).toBe(true);
    expect(body.data.mensajero).toBeNull();
    // Y el string crudo tambien lo lleva: `JSON.stringify` habria borrado un `undefined`.
    expect(cuerpo).toContain('"mensajero":null');
  });

  it("404/R2: `null` viaja tambien en un evento de `incidente`, junto a `evidenciasUrl`", async () => {
    const { service, entregar } = buildService({ ...DATOS_BASE, estado: "incidente" });
    await service.ejecutar(job("s-incidente"));

    const body = JSON.parse(cuerpoDe(entregar));
    expect("mensajero" in body.data).toBe(true);
    expect(body.data.mensajero).toBeNull();
    expect(body.data.evidenciasUrl).toBe(`${ORIGIN}/api/ordenes/api-key/orden/${ORDEN_ID}`);
  });
});

describe("404/R9+R10 — la posicion de la clave y el determinismo del cuerpo", () => {
  it("404/R10: el orden de `data` es EXACTAMENTE [numGuia, numRemision, estado, motivo, mensajero]", async () => {
    const { service, entregar } = buildService(conMensajero);
    await service.ejecutar(job());

    const body = JSON.parse(cuerpoDe(entregar));
    // Literal escrito a mano: la posicion es load-bearing porque la firma se calcula sobre el
    // string serializado en orden de insercion.
    expect(Object.keys(body.data)).toEqual([
      "numGuia",
      "numRemision",
      "estado",
      "motivo",
      "mensajero",
    ]);
  });

  it("404/R9: en un `incidente`, `evidenciasUrl` sigue siendo la ULTIMA y la unica opcional", async () => {
    const { service, entregar } = buildService({
      ...conMensajero,
      estado: "incidente",
      causaIncidente: "danado",
    });
    await service.ejecutar(job("s-incidente"));

    const body = JSON.parse(cuerpoDe(entregar));
    expect(Object.keys(body.data)).toEqual([
      "numGuia",
      "numRemision",
      "estado",
      "motivo",
      "mensajero",
      "evidenciasUrl",
    ]);
    // R9: las cuatro claves publicadas conservan su forma y su valor; el campo nuevo no las mueve.
    expect(body.data.numGuia).toBe(12345);
    expect(body.data.numRemision).toBe("REM-DEL-OWNER-A");
    expect(body.data.estado).toBe("incidente");
    expect(body.data.motivo).toBe("danado");
  });

  it("404/R10: dos serializaciones del mismo evento sobre el mismo estado dan el MISMO string", async () => {
    const a = buildService(conMensajero);
    await a.service.ejecutar(job());
    const b = buildService(conMensajero);
    await b.service.ejecutar(job());

    // Igualdad BYTE A BYTE del cuerpo crudo, que es sobre lo que se firma (99/R18, 99/R23).
    expect(cuerpoDe(a.entregar)).toBe(cuerpoDe(b.entregar));
    expect(cuerpoDe(a.entregar)).toContain(
      `"mensajero":{"id":"${MENSAJERO_ID}","nombre":"${MENSAJERO_NOMBRE}"}`,
    );
  });
});

describe("404/R11 — el mensajero VIGENTE en la entrega, no una foto del cambio de estado", () => {
  it("404/R11: dos entregas del MISMO eventoId con distinto asignado publican distinto mensajero", async () => {
    // La reasignacion ocurre ENTRE las dos entregas (un reintento de la cola). El `eventoId` es
    // determinista por (ordenId, estatusDestinoId, ocurridoAt), asi que el job es el MISMO.
    let entregasPrevias = 0;
    const { service, entregar } = buildService(() => {
      const mensajero =
        entregasPrevias++ === 0
          ? { id: MENSAJERO_ID, nombre: MENSAJERO_NOMBRE }
          : { id: OTRO_ID, nombre: OTRO_NOMBRE };
      return { ...DATOS_BASE, mensajero };
    });

    await service.ejecutar(job());
    await service.ejecutar(job());

    const primera = JSON.parse(cuerpoDe(entregar, 0));
    const segunda = JSON.parse(cuerpoDe(entregar, 1));
    expect(primera.eventoId).toBe(segunda.eventoId); // MISMO evento
    expect(primera.data.mensajero).toEqual({ id: MENSAJERO_ID, nombre: MENSAJERO_NOMBRE });
    expect(segunda.data.mensajero).toEqual({ id: OTRO_ID, nombre: OTRO_NOMBRE });
  });

  it("404/R11: una orden que PIERDE el asignado entre entregas publica `null` en la segunda", async () => {
    let entregasPrevias = 0;
    const { service, entregar } = buildService(() =>
      entregasPrevias++ === 0 ? conMensajero : DATOS_BASE,
    );

    await service.ejecutar(job());
    await service.ejecutar(job());

    expect(JSON.parse(cuerpoDe(entregar, 0)).data.mensajero).not.toBeNull();
    const segunda = JSON.parse(cuerpoDe(entregar, 1));
    expect("mensajero" in segunda.data).toBe(true);
    expect(segunda.data.mensajero).toBeNull(); // sin error y sin recordar al anterior
  });

  it("404/R12: el service no pide la orden mas de una vez por entrega", async () => {
    const { service, findDatosEntrega } = buildService(conMensajero);
    await service.ejecutar(job());
    expect(findDatosEntrega).toHaveBeenCalledTimes(1);
  });
});

describe("404/R7 — es el ASIGNADO, nunca el que gestiono", () => {
  it("404/R7: publica el ASIGNADO aunque la orden tenga una gestion de OTRO mensajero", async () => {
    // La gestion la hizo Ana (y por eso la orden tiene causa de devolucion vigente); quien la
    // lleva AHORA es Carlos. El cuerpo publica a Carlos y no menciona a Ana por ningun lado: el
    // gestor es `gestion_orden.mensajero_id` y es material de la feature 405.
    const { service, entregar } = buildService({
      ...conMensajero,
      estado: "devuelta",
      causaDevolucion: "not_found",
    });
    await service.ejecutar(job("s-devuelta"));

    const cuerpo = cuerpoDe(entregar);
    expect(JSON.parse(cuerpo).data.mensajero).toEqual({
      id: MENSAJERO_ID,
      nombre: MENSAJERO_NOMBRE,
    });
    expect(cuerpo).not.toContain(OTRO_NOMBRE);
    expect(cuerpo).not.toContain(OTRO_ID);
    // Y no aparece ninguna clave que sugiera un segundo mensajero en el contrato.
    expect(cuerpo).not.toContain("mensajeroGestion");
    expect(cuerpo).not.toContain("gestionadaPor");
  });
});

describe("404/R13 — el mensajero no se filtra por el payload del job", () => {
  it("404/R13: el payload del job sigue teniendo 3 claves y ninguna es del mensajero", async () => {
    // El cuerpo se arma leyendo la orden, no copiando el payload. Si alguien «optimizara»
    // metiendo el mensajero en el job, este aserto se pone rojo.
    const j = job();
    const { service } = buildService(conMensajero);
    await service.ejecutar(j);

    expect(Object.keys(j.payload as Record<string, unknown>).sort()).toEqual([
      "estatusDestinoId",
      "ocurridoAt",
      "ordenId",
    ]);
    const serializado = JSON.stringify(j.payload);
    expect(serializado).not.toContain(MENSAJERO_ID);
    expect(serializado).not.toContain(MENSAJERO_NOMBRE);
  });
});
