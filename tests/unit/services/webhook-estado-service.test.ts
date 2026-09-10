import { describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
// FICHA 403: el predicado del circuito (para medir que un exito SACA de la pausa) y el quitador de
// comentarios del repo (la guardia de vocabulario mide el CODIGO, no la prosa que lo explica).
import { estaPausada } from "@/lib/utils/webhook-suscripcion-pausa";
import type { WebhookSuscripcionPausadaContexto } from "@/lib/notificaciones/emitir";
import { codigoSinComentarios } from "@/tests/fixtures/sin-comentarios";
import { WebhookEstadoService, WebhookEntregaFallidaError } from "@/lib/services/WebhookEstadoService";
import { WebhookSecretKeyError, cifrarSecreto } from "@/lib/crypto/webhook-secret-cipher";
import { firmarWebhook } from "@/lib/crypto/webhook-firma";
import { loadWebhookConfig, type WebhookConfig } from "@/lib/config/webhook";
import type { IWebhookOrdenReader, DatosEntregaOrden } from "@/lib/interfaces/repositories/IWebhookOrdenReader";
import type { IWebhookSuscripcionRepository, WebhookSuscripcionActiva } from "@/lib/interfaces/repositories/IWebhookSuscripcionRepository";
import type { IWebhookSender, WebhookOutcome } from "@/lib/interfaces/external/IWebhookSender";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import { CAUSA_DEVOLUCION_SEED, type CausaDevolucion } from "@/lib/types/causa-devolucion";
import { CAUSA_INCIDENTE_SEED, type CausaIncidente } from "@/lib/types/causa-incidente";
import { gestionConfig } from "@/lib/config/gestion";
import { EVENTOS_PUBLICOS, ORIGENES_SIN_EVENTO_PUBLICO } from "@/lib/types/webhook-eventos";

// Feature 99 (R17/R19-R24/R29/R30/R31/R32) — handler de entrega. DI por interfaces; sin red
// ni DB. El secreto se cifra con una clave de prueba real para ejercitar el descifrado.
//
// Feature 256 — el cuerpo gana `data.motivo` (causa TIPIFICADA de la devolucion). Los `describe`
// de la 256 se prefijan con `256/` porque este archivo YA tiene requisitos R17-R32 que son de la
// feature 99: los numeros se repiten y no son lo mismo.

const CLAVE = randomBytes(32).toString("base64");
const SECRETO = "ordx_whsec_secreto-de-firma-de-prueba";
const SECRET_ENC = cifrarSecreto(CLAVE, SECRETO);
const NUM_REMISION = "REM-DEL-OWNER-A";
const DESTINATARIO = "Juan Perez"; // PII que NUNCA debe ir al payload/log

/**
 * ⏳ 2026-09-09 (feature 404) — el mensajero asignado del caso «hay alguien llevandola». Es PII de
 * un TERCERO y por eso vive aqui arriba junto a `DESTINATARIO`: los asertos de R13 lo buscan por
 * este mismo literal en todo lo que sale por el logger.
 */
const MENSAJERO_ID = "018f2c31-0000-4000-8000-0000000000aa";
const MENSAJERO_NOMBRE = "Carlos Jimenez Mora";

/** ⏳ 2026-08-22 (268/R24): origin con el que se construye `data.evidenciasUrl`. */
const ORIGIN = "https://app.ordenex.co";
const ORDEN_ID = "orden-1";

/**
 * FICHA 403: el umbral del circuito, con los valores por defecto de R8 (3 fallos / 30 min / 1 h).
 * Se escriben aqui —y no se leen de `loadWebhookConfig()`— para que este archivo no dependa del
 * entorno y para que los casos digan con que numeros se estan midiendo.
 */
const PAUSA_FALLOS = 3;
const PAUSA_VENTANA_MS = 30 * 60_000;
const PAUSA_INTERVALO_MS = 3_600_000;

const config: WebhookConfig = {
  WEBHOOK_TIMEOUT_MS: 10_000,
  WEBHOOK_REPLAY_WINDOW_S: 300,
  WEBHOOK_SECRET_ENC_KEY: CLAVE,
  WEBHOOK_APP_ORIGIN: ORIGIN,
  WEBHOOK_PAUSA_FALLOS_MINIMOS: PAUSA_FALLOS,
  WEBHOOK_PAUSA_VENTANA_MS: PAUSA_VENTANA_MS,
  WEBHOOK_PAUSA_INTERVALO_MS: PAUSA_INTERVALO_MS,
};

const DATOS_BASE: DatosEntregaOrden = {
  tiendaId: "owner-A",
  numGuia: 12345,
  numRemision: NUM_REMISION,
  deletedAt: null,
  estado: "en_reparto",
  // Feature 256: en el DTO INTERNO el campo se llama `causaDevolucion`; `motivo` es solo el
  // nombre de cable (design §2.3). El caso base es un `en_reparto` sin devolucion.
  causaDevolucion: null,
  // ⏳ 2026-08-22 (268): el hermano, tambien con su nombre propio en el DTO interno.
  causaIncidente: null,
  // ⏳ 2026-09-09 (404): el caso BASE de este archivo es una orden SIN mensajero asignado, para
  // que los congeladores de claves de la 256/268 midan la convencion de ausencia (`null`
  // presente). El caso CON mensajero vive en `webhook-estado-service.mensajero.test.ts`.
  mensajero: null,
};

/** Feature 256 — datos de una orden que transiciona a `devuelta` con su causa vigente. */
function datosDevuelta(causaDevolucion: CausaDevolucion | null): DatosEntregaOrden {
  return { ...DATOS_BASE, estado: "devuelta", causaDevolucion };
}

/** ⏳ 2026-08-22 (268) — datos de una orden que transiciona a `incidente` con su causa vigente. */
function datosIncidente(causaIncidente: CausaIncidente | null): DatosEntregaOrden {
  return { ...DATOS_BASE, estado: "incidente", causaIncidente };
}

/** El job de un evento cuyo estado destino es `incidente`. */
function jobIncidente(): JobDTO {
  return job({
    ordenId: ORDEN_ID,
    estatusDestinoId: "s-incidente",
    ocurridoAt: "2026-08-22T10:00:00.000Z",
  });
}

/** El job de un evento cuyo estado destino es `devuelta`. */
function jobDevuelta(): JobDTO {
  return job({
    ordenId: "orden-1",
    estatusDestinoId: "s-devuelta",
    ocurridoAt: "2026-07-21T10:00:00.000Z",
  });
}

/** El cuerpo (string crudo) de la n-esima entrega. */
function cuerpoDe(entregar: { mock: { calls: unknown[][] } }, i = 0): string {
  return (entregar.mock.calls[i] as unknown as [string, string])[1];
}

function job(payload: Record<string, unknown> = {
  ordenId: "orden-1",
  estatusDestinoId: "s-en-reparto",
  ocurridoAt: "2026-07-21T10:00:00.000Z",
}): JobDTO {
  return {
    id: "job-1",
    tipo: "webhook_estado",
    payload,
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

interface Fakes {
  datos: DatosEntregaOrden | null;
  subPorOwner: Record<string, WebhookSuscripcionActiva | null>;
  outcome: WebhookOutcome;
  /** FICHA 403: estado del circuito que devuelve `incrementarFalloYLeer` (ya incrementado). */
  estadoTrasFallo?: { fallosConsecutivos: number; sinExitoDesde: Date } | null;
  /** FICHA 403: reloj inyectado; por defecto el de siempre de este archivo. */
  now?: () => Date;
}

const AHORA = new Date("2026-07-21T10:00:05.000Z");

function buildService(f: Partial<Fakes> = {}) {
  const datos = f.datos === undefined ? DATOS_BASE : f.datos;
  const subPorOwner = f.subPorOwner ?? { "owner-A": { url: "https://a.example.com/hook", secret: SECRET_ENC } };
  const outcome = f.outcome ?? { status: "ok" };

  const ordenes: IWebhookOrdenReader = { findDatosEntrega: vi.fn(async () => datos) };
  // FICHA 403: el doble del repositorio expone los DOS metodos del circuito. `activa` NO aparece
  // por ningun lado en este doble, y eso es intencionado: R5 dice que la pausa no la toca, asi que
  // un service que intentara escribirla no tendria por donde.
  // Los dobles llevan sus parametros TIPADOS (aunque no los usen) para que `mock.calls[0][0]` sea
  // consultable: sin ellos vitest infiere una tupla vacia y las aserciones sobre los argumentos no
  // compilan — que es justo lo que hay que afirmar aqui.
  const registrarEntregaOk = vi.fn(async (_owner: string, _ahora: Date) => {});
  const incrementarFalloYLeer = vi.fn(async (_owner: string, _ahora: Date) =>
    f.estadoTrasFallo === undefined
      ? { fallosConsecutivos: 1, sinExitoDesde: AHORA }
      : f.estadoTrasFallo,
  );
  const suscripciones = {
    findActivaByOwner: vi.fn(async (owner: string) => subPorOwner[owner] ?? null),
    registrarEntregaOk,
    incrementarFalloYLeer,
  } as unknown as IWebhookSuscripcionRepository;
  const entregar = vi.fn(async () => outcome);
  const sender: IWebhookSender = { entregar };
  const logs: string[] = [];
  const logger = { warn: (m: string) => logs.push(m) };
  const now = f.now ?? (() => AHORA);
  // FICHA 403: notificador de pausa espia. El DEFAULT del service es el no-op; aqui se inyecta uno
  // que registra para poder afirmar CUANDO se llama y con QUE contexto (R9/R13).
  const notificarPausa = vi.fn(async (_ctx: WebhookSuscripcionPausadaContexto) => {});

  const service = new WebhookEstadoService(
    ordenes,
    suscripciones,
    sender,
    config,
    now,
    logger,
    notificarPausa,
  );
  return {
    service,
    entregar,
    logs,
    ordenes,
    suscripciones,
    registrarEntregaOk,
    incrementarFalloYLeer,
    notificarPausa,
  };
}

/** El estado que devolveria el repositorio tras un fallo, con la racha empezada hace `minutos`. */
function estadoTras(fallos: number, minutos: number) {
  return { fallosConsecutivos: fallos, sinExitoDesde: new Date(AHORA.getTime() - minutos * 60_000) };
}

/** Un desenlace transitorio corriente (sin sugerencia de espera). */
const FALLO: WebhookOutcome = { status: "transitorio", detalle: "entregar webhook: HTTP 500" };

describe("R17/R19 — entrega y complete", () => {
  it("con suscripcion activa hace POST a la URL del owner con el cuerpo del evento", async () => {
    const { service, entregar } = buildService();
    await service.ejecutar(job());

    expect(entregar).toHaveBeenCalledTimes(1);
    const [url, cuerpo, headers] = entregar.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, string>,
    ];
    expect(url).toBe("https://a.example.com/hook");
    const body = JSON.parse(cuerpo);
    // Feature 256 (R7/R19) — EL CONGELADOR DEL CUERPO. Antes era un `toEqual` de tres claves;
    // se ACTUALIZA (no se borra) al ganar `data` una cuarta. Se afirman las claves EXACTAS y su
    // ORDEN, porque la firma se calcula sobre el string serializado en orden de insercion, y
    // los valores uno a uno: ninguno de los tres viejos cambia de nombre, tipo ni valor.
    //
    // ⏳ 2026-09-09 (feature 404, R9/R10) — se ACTUALIZA otra vez, por quinta clave: `mensajero`
    // entra TRAS `motivo`, que es el final del bloque de claves siempre presentes. Se enmienda y
    // NO se relaja a `toContain` ni a un aserto de longitud: el literal ES el contrato, y lo que
    // protege es que las cuatro claves de la 256 sigan estando, con su nombre, su tipo y su
    // posicion. La posicion es load-bearing porque la firma se calcula sobre el string.
    expect(Object.keys(body.data)).toEqual([
      "numGuia",
      "numRemision",
      "estado",
      "motivo",
      "mensajero",
    ]);
    expect(body.data).toEqual({
      numGuia: 12345,
      numRemision: NUM_REMISION,
      estado: "en_reparto",
      motivo: null,
      mensajero: null, // 404/R2: la orden base no tiene asignado; la clave viaja igual
    });
    // R2: blindaje del breaking change — la clave vieja `orden` ya no existe en el cuerpo.
    expect(body.orden).toBeUndefined();
    expect(body.evento).toBe("orden.estado_actualizado");
    expect(body.eventoId).toContain("webhook_estado:orden-1:s-en-reparto:");
    // R18: firma valida sobre `${ts}.${cuerpo}` con el secreto descifrado.
    const ts = Number(headers["X-Ordenex-Timestamp"]);
    expect(headers["X-Ordenex-Signature"]).toBe(`sha256=${firmarWebhook(SECRETO, ts, cuerpo)}`);
  });

  it("una respuesta 2xx completa el job (no lanza)", async () => {
    const { service } = buildService({ outcome: { status: "ok" } });
    await expect(service.ejecutar(job())).resolves.toBeUndefined();
  });
});

describe("R20/R31 — transitorio -> lanza con el detalle para last_error", () => {
  it("un 5xx, un timeout y un fallo de red lanzan para reintento con el detalle en el mensaje", async () => {
    for (const detalle of ["entregar webhook: HTTP 500", "entregar webhook: fallo de red o timeout"]) {
      const { service } = buildService({ outcome: { status: "transitorio", detalle } });
      const err = await service.ejecutar(job()).catch((e) => e);
      expect(err).toBeInstanceOf(WebhookEntregaFallidaError);
      // R31: el detalle viaja en el mensaje (aterriza en jobs.last_error) sin secreto.
      expect((err as Error).message).toBe(detalle);
      expect((err as Error).message).not.toContain(SECRETO);
    }
  });
});

describe("R21 — sin suscripcion activa", () => {
  it("sin suscripcion activa el job se completa sin hacer POST", async () => {
    const { service, entregar } = buildService({ subPorOwner: { "owner-A": null } });
    await expect(service.ejecutar(job())).resolves.toBeUndefined();
    expect(entregar).not.toHaveBeenCalled();
  });
});

describe("R22 — orden inexistente o borrada", () => {
  it("un job de una orden inexistente se completa sin error ni POST", async () => {
    const { service, entregar } = buildService({ datos: null });
    await expect(service.ejecutar(job())).resolves.toBeUndefined();
    expect(entregar).not.toHaveBeenCalled();
  });

  it("un job de una orden borrada (deletedAt) se completa sin error ni POST", async () => {
    const { service, entregar } = buildService({ datos: { ...DATOS_BASE, deletedAt: new Date() } });
    await expect(service.ejecutar(job())).resolves.toBeUndefined();
    expect(entregar).not.toHaveBeenCalled();
  });
});

describe("R23 — idempotencia", () => {
  it("reejecutar el job produce el mismo eventoId y el mismo cuerpo", async () => {
    const { service, entregar } = buildService();
    await service.ejecutar(job());
    await service.ejecutar(job());
    const cuerpo1 = (entregar.mock.calls[0] as unknown as [string, string])[1];
    const cuerpo2 = (entregar.mock.calls[1] as unknown as [string, string])[1];
    expect(cuerpo1).toBe(cuerpo2);
    expect(JSON.parse(cuerpo1).eventoId).toBe(JSON.parse(cuerpo2).eventoId);
  });

  // Feature 256 (T7/R13) — AMPLIACION del test de arriba, no su sustitucion: el de arriba
  // compara un cuerpo con `motivo: null`, que pasaria igual si el campo no existiera. Este
  // compara byte a byte un cuerpo con el campo INFORMADO.
  it("256/R13: reejecutar con el mismo estado leido produce un cuerpo BYTE-IDENTICO con el motivo informado", async () => {
    const { service, entregar } = buildService({ datos: datosDevuelta("wrong_number") });
    await service.ejecutar(jobDevuelta());
    await service.ejecutar(jobDevuelta());

    const cuerpo1 = cuerpoDe(entregar, 0);
    const cuerpo2 = cuerpoDe(entregar, 1);
    expect(JSON.parse(cuerpo1).data.motivo).toBe("wrong_number"); // informado, no `null`
    expect(cuerpo1).toBe(cuerpo2); // byte a byte, campo nuevo incluido
    expect(JSON.parse(cuerpo1).eventoId).toBe(JSON.parse(cuerpo2).eventoId);
  });

  it("256/R14: con un reloj distinto en cada ejecucion, `data` es identico y el eventoId no cambia", async () => {
    // El cuerpo es funcion determinista de (payload del job, estado leido). Ni el reloj, ni el
    // numero de intento, ni el orden de llegada entran en `data`.
    const datos = datosDevuelta("wrong_address");
    const entregas: string[] = [];
    for (const instante of ["2026-07-21T10:00:05.000Z", "2026-07-21T18:44:31.000Z"]) {
      const ordenes: IWebhookOrdenReader = { findDatosEntrega: vi.fn(async () => datos) };
      const suscripciones = {
        findActivaByOwner: vi.fn(async () => ({ url: "https://a.example.com/hook", secret: SECRET_ENC })),
        // FICHA 403: el circuito se contabiliza en los dos desenlaces; sin estos dos, un doble
        // parcial rompe caminos que nada tienen que ver con la pausa.
        registrarEntregaOk: vi.fn(async () => {}),
        incrementarFalloYLeer: vi.fn(async () => null),
      } as unknown as IWebhookSuscripcionRepository;
      const entregar = vi.fn(async () => ({ status: "ok" }) as WebhookOutcome);
      const service = new WebhookEstadoService(
        ordenes,
        suscripciones,
        { entregar },
        config,
        () => new Date(instante),
      );
      await service.ejecutar(jobDevuelta());
      entregas.push(cuerpoDe(entregar, 0));
    }
    const [a, b] = entregas.map((c) => JSON.parse(c));
    expect(JSON.stringify(a.data)).toBe(JSON.stringify(b.data));
    expect(a.data.motivo).toBe("wrong_address");
    expect(a.eventoId).toBe(b.eventoId);
  });

  it("256/R16: la firma verifica contra `${ts}.${cuerpo}` con el cuerpo YA ampliado", async () => {
    const { service, entregar } = buildService({ datos: datosDevuelta("not_found") });
    await service.ejecutar(jobDevuelta());
    const [, cuerpo, headers] = entregar.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, string>,
    ];
    // El cuerpo firmado es EL QUE SE ENVIA: contiene el campo nuevo.
    expect(cuerpo).toContain('"motivo":"not_found"');
    const ts = Number(headers["X-Ordenex-Timestamp"]);
    expect(headers["X-Ordenex-Signature"]).toBe(`sha256=${firmarWebhook(SECRETO, ts, cuerpo)}`);
    // Y NO verifica contra el cuerpo viejo (sin el campo): si alguien firmara antes de ampliar,
    // esta linea lo delata.
    const cuerpoViejo = cuerpo.replace(',"motivo":"not_found"', "");
    expect(headers["X-Ordenex-Signature"]).not.toBe(`sha256=${firmarWebhook(SECRETO, ts, cuerpoViejo)}`);
  });
});

// ---------------------------------------------------------------------------------------------
// Feature 256 — `data.motivo`: la causa TIPIFICADA de la devolucion vigente.
// ---------------------------------------------------------------------------------------------

describe("256/R1-R3 — el valor: el enum CRUDO de la causa, y nada mas", () => {
  it.each(CAUSA_DEVOLUCION_SEED)(
    "256/R1+R2: un evento `devuelta` con causa %s la emite CRUDA, sin traducir ni normalizar",
    async (causa) => {
      const { service, entregar } = buildService({ datos: datosDevuelta(causa) });
      await service.ejecutar(jobDevuelta());
      const body = JSON.parse(cuerpoDe(entregar));
      expect(body.data.motivo).toBe(causa); // identidad exacta: sin acentos, sin mayusculas
      expect(body.data.motivo).toBe(body.data.motivo.toLowerCase());
    },
  );

  it("256/R2: no se emite ninguna etiqueta en espanol junto al enum (contrato de maquina)", async () => {
    const { service, entregar } = buildService({ datos: datosDevuelta("not_found") });
    await service.ejecutar(jobDevuelta());
    const cuerpo = cuerpoDe(entregar);
    for (const etiqueta of ["No se encontro", "Numero equivocado", "Direccion equivocada", "motivoLabel"]) {
      expect(cuerpo).not.toContain(etiqueta);
    }
  });

  it("256/R3: recorriendo el SEED como fuente de verdad, ningun valor fuera de los tres puede salir", async () => {
    const emitidos: unknown[] = [];
    for (const causa of CAUSA_DEVOLUCION_SEED) {
      const { service, entregar } = buildService({ datos: datosDevuelta(causa) });
      await service.ejecutar(jobDevuelta());
      emitidos.push(JSON.parse(cuerpoDe(entregar)).data.motivo);
    }
    // El SEED es la lista CERRADA de la 73 (doble candado de exhaustividad frente al enum
    // Prisma): si el enum ganara un cuarto valor, este recorrido lo veria.
    expect(emitidos).toEqual([...CAUSA_DEVOLUCION_SEED]);
    expect(new Set(emitidos).size).toBe(3);
  });

  it("256/R3: una causa de INCIDENTE (enum hermano de la 158) nunca aparece en data.motivo", async () => {
    // El reader solo proyecta `causaDevolucion`; el service solo publica eso. Aunque la orden
    // tuviera gestiones de incidente, `danado`/`perdido`/`robado` no tienen camino hasta aqui.
    const { service, entregar } = buildService({ datos: datosDevuelta("not_found") });
    await service.ejecutar(jobDevuelta());
    const cuerpo = cuerpoDe(entregar);
    for (const causaIncidente of ["danado", "perdido", "robado"]) {
      expect(cuerpo).not.toContain(causaIncidente);
    }
  });
});

describe("256/R6-R7 — la forma: UNA sola, el campo siempre presente", () => {
  it("256/R6: en un evento `en_reparto` el campo EXISTE y vale null (el consumidor no ramifica por estado)", async () => {
    const { service, entregar } = buildService();
    await service.ejecutar(job());
    const body = JSON.parse(cuerpoDe(entregar));
    expect("motivo" in body.data).toBe(true); // existe: no es un `undefined` omitido
    expect(body.data.motivo).toBeNull();
  });

  it("256/R6: una orden con devolucion vigente que hoy transiciona a OTRO estado emite null igualmente", async () => {
    // Orden que fue `devuelta`, se recupero y hoy vuelve a `en_bodega_central`: el reader sigue
    // respondiendo la causa vigente, y es el SERVICE quien decide no publicarla (design §2.3).
    const { service, entregar } = buildService({
      datos: { ...DATOS_BASE, estado: "en_bodega_central", causaDevolucion: "not_found" },
    });
    await service.ejecutar(job());
    const body = JSON.parse(cuerpoDe(entregar));
    expect(body.data.motivo).toBeNull();
    expect(cuerpoDe(entregar)).not.toContain("not_found");
  });

  // ⏳ 2026-09-09 (404/R9/R10): el titulo decia «las cuatro claves» y pasa a CINCO. Se enmienda
  // el literal con el orden nuevo; sigue siendo una igualdad exacta, no un `toContain`.
  it("256/R7 (+404): `data` tiene EXACTAMENTE las cinco claves, en orden, tambien en un evento de devolucion", async () => {
    const { service, entregar } = buildService({ datos: datosDevuelta("wrong_number") });
    await service.ejecutar(jobDevuelta());
    const body = JSON.parse(cuerpoDe(entregar));
    expect(Object.keys(body.data)).toEqual([
      "numGuia",
      "numRemision",
      "estado",
      "motivo",
      "mensajero",
    ]);
    // Plano dentro de `data`, no anidado bajo `devolucion` (A4, descartada).
    expect(body.data.devolucion).toBeUndefined();
  });

  it("256/R19: los tres campos viejos y la ausencia de `orden` se conservan en un evento de devolucion", async () => {
    const { service, entregar } = buildService({ datos: datosDevuelta("wrong_address") });
    await service.ejecutar(jobDevuelta());
    const body = JSON.parse(cuerpoDe(entregar));
    expect(body.data.numGuia).toBe(12345);
    expect(body.data.numRemision).toBe(NUM_REMISION);
    expect(body.data.estado).toBe("devuelta");
    expect(body.orden).toBeUndefined(); // la clave retirada por la 112 no vuelve
    expect(body.evento).toBe("orden.estado_actualizado");
  });
});

describe("256/R4-R5 — los DOS caminos legitimos del null", () => {
  it("256/R4: una devolucion VIGENTE sin causa registrada (historico previo a la 73, que no se backfilleo) emite null y entrega con normalidad", async () => {
    const { service, entregar } = buildService({ datos: datosDevuelta(null) });
    await expect(service.ejecutar(jobDevuelta())).resolves.toBeUndefined();
    const body = JSON.parse(cuerpoDe(entregar));
    expect("motivo" in body.data).toBe(true); // presente, no omitido
    expect(body.data.motivo).toBeNull(); // sin valor por defecto inventado
    expect(entregar).toHaveBeenCalledTimes(1); // la entrega NO falla por esto
  });

  it("256/R5: una orden sin ninguna gestion `devuelta` vigente (nunca la tuvo, o esta anulada) emite null y entrega con normalidad", async () => {
    // El reader ya colapso los dos casos en `null`: el contrato publico no distingue «no hubo»
    // de «no se registro» (design §2.2).
    const { service, entregar } = buildService({ datos: datosDevuelta(null) });
    await expect(service.ejecutar(jobDevuelta())).resolves.toBeUndefined();
    expect(JSON.parse(cuerpoDe(entregar)).data.motivo).toBeNull();
    expect(entregar).toHaveBeenCalledTimes(1);
  });
});

describe("256/R15 — la ventana DECLARADA: el motivo es el VIGENTE AL ENTREGAR", () => {
  it("256/R15: si la gestion se anula entre dos intentos, el motivo es el VIGENTE AL ENTREGAR: el 2.o cuerpo lleva null, con el MISMO eventoId, sin error y sin evento adicional", async () => {
    // Escenario 1 de design §4: `deshacer_gestion` (67/R11) entre el 1.er intento y el reintento.
    // No es una limitacion escondida: es la semantica elegida y contratada (R15/R24). El webhook
    // dice lo mismo que las pantallas y que el cron de SLA, que leen con este mismo criterio.
    const respuestas: DatosEntregaOrden[] = [datosDevuelta("not_found"), datosDevuelta(null)];
    let llamada = 0;
    const ordenes: IWebhookOrdenReader = {
      findDatosEntrega: vi.fn(async () => respuestas[llamada++] ?? datosDevuelta(null)),
    };
    const suscripciones = {
      findActivaByOwner: vi.fn(async () => ({ url: "https://a.example.com/hook", secret: SECRET_ENC })),
      // FICHA 403: el circuito se contabiliza en los dos desenlaces; sin estos dos, un doble
      // parcial rompe caminos que nada tienen que ver con la pausa.
      registrarEntregaOk: vi.fn(async () => {}),
      incrementarFalloYLeer: vi.fn(async () => null),
    } as unknown as IWebhookSuscripcionRepository;
    const entregar = vi.fn(async () => ({ status: "ok" }) as WebhookOutcome);
    const service = new WebhookEstadoService(
      ordenes,
      suscripciones,
      { entregar },
      config,
      () => new Date("2026-07-21T10:00:05.000Z"),
    );

    await expect(service.ejecutar(jobDevuelta())).resolves.toBeUndefined();
    await expect(service.ejecutar(jobDevuelta())).resolves.toBeUndefined(); // reintento: no lanza

    const primero = JSON.parse(cuerpoDe(entregar, 0));
    const segundo = JSON.parse(cuerpoDe(entregar, 1));
    expect(primero.data.motivo).toBe("not_found");
    expect(segundo.data.motivo).toBeNull();
    expect(segundo.eventoId).toBe(primero.eventoId); // el consumidor deduplica por eventoId
    expect(entregar).toHaveBeenCalledTimes(2); // dos INTENTOS del mismo evento, no dos eventos
  });
});

describe("256/R22 — LOS DOS `motivo`: el enum viaja, el texto libre del mensajero JAMAS", () => {
  // ⚠️ ADVERTENCIA, no trivia. `data.motivo` (256) es la causa TIPIFICADA de la devolucion
  // (`gestion_orden.causa_devolucion`, `db/schema.prisma:823`). `gestion_orden.motivo`
  // (`db/schema.prisma:814`, 36/R7) es TEXTO LIBRE que escribe el mensajero y puede contener
  // datos del destinatario. Comparten nombre y NO son el mismo dato. Si alguien «unifica» los
  // dos algun dia, este test se pone rojo — y esa es toda su razon de existir.
  const TEXTO_LIBRE_DEL_MENSAJERO = `Timbre roto, pregunte por ${DESTINATARIO}, cel 0999123456`;

  it("256/R22: con una gestion que tiene causa tipificada Y texto libre, el cuerpo lleva el enum y el texto libre no aparece por ningun lado", async () => {
    const { service, entregar } = buildService({ datos: datosDevuelta("not_found") });
    await service.ejecutar(jobDevuelta());

    const cuerpo = cuerpoDe(entregar); // el STRING COMPLETO que se envia, no solo `data`
    expect(JSON.parse(cuerpo).data.motivo).toBe("not_found");
    expect(cuerpo).not.toContain(TEXTO_LIBRE_DEL_MENSAJERO);
    expect(cuerpo).not.toContain(DESTINATARIO);
    expect(cuerpo).not.toContain("0999123456");
    expect(cuerpo).not.toContain("Timbre roto");
  });
});

describe("256/R20-R21 — los desenlaces y el aislamiento por owner, con el campo nuevo", () => {
  it("256/R20: los cinco desenlaces del job siguen siendo los mismos con una devolucion con causa", async () => {
    const datos = datosDevuelta("not_found");

    // 1. Orden inexistente -> completado sin POST.
    const a = buildService({ datos: null });
    await expect(a.service.ejecutar(jobDevuelta())).resolves.toBeUndefined();
    expect(a.entregar).not.toHaveBeenCalled();

    // 2. Orden borrada -> completado sin POST (aunque tenga causa).
    const b = buildService({ datos: { ...datos, deletedAt: new Date() } });
    await expect(b.service.ejecutar(jobDevuelta())).resolves.toBeUndefined();
    expect(b.entregar).not.toHaveBeenCalled();

    // 3. Sin suscripcion activa -> completado sin POST.
    const c = buildService({ datos, subPorOwner: { "owner-A": null } });
    await expect(c.service.ejecutar(jobDevuelta())).resolves.toBeUndefined();
    expect(c.entregar).not.toHaveBeenCalled();

    // 4. 2xx -> completado.
    const d = buildService({ datos, outcome: { status: "ok" } });
    await expect(d.service.ejecutar(jobDevuelta())).resolves.toBeUndefined();
    expect(d.entregar).toHaveBeenCalledTimes(1);

    // 5. Transitorio -> error recuperable con su detalle; y payload invalido -> integracion.
    const e = buildService({ datos, outcome: { status: "transitorio", detalle: "entregar webhook: HTTP 500" } });
    const err = await e.service.ejecutar(jobDevuelta()).catch((x) => x);
    expect(err).toBeInstanceOf(WebhookEntregaFallidaError);
    expect((err as Error).message).toBe("entregar webhook: HTTP 500");
    const f = buildService({ datos });
    const errPayload = await f.service.ejecutar(job({ foo: "bar" })).catch((x) => x);
    expect((errPayload as Error).message).toMatch(/payload invalido/i);
    expect((errPayload as Error).message).not.toContain("not_found");
  });

  it("256/R21: el destino sigue derivandose del tiendaId de la orden, tambien en un evento con motivo", async () => {
    const { service, entregar, suscripciones } = buildService({
      datos: datosDevuelta("wrong_address"),
      subPorOwner: {
        "owner-A": { url: "https://a.example.com/hook", secret: SECRET_ENC },
        "owner-B": { url: "https://b.example.com/hook", secret: SECRET_ENC },
      },
    });
    await service.ejecutar(jobDevuelta());
    expect(suscripciones.findActivaByOwner).toHaveBeenCalledWith("owner-A");
    expect((entregar.mock.calls[0] as unknown as [string])[0]).toBe("https://a.example.com/hook");
  });
});

describe("256/R17 — el conjunto de transiciones que emiten evento", () => {
  it("256/R17 + 268/R1-R5: el recuento de eventos publicos y de familias exceptuadas", async () => {
    // Congelado por TAMANO aqui (el congelador por IGUALDAD vive en
    // `tests/unit/types/webhook-eventos.test.ts`, que esta task NO edita).
    //
    // ⏳ 2026-08-22 (feature 268, T1) — ACTUALIZADO, no borrado: la 268 SI cambia la politica a
    // proposito (10 -> 12 con `ayuda_tienda` e `incidente`, R1-R3) y vacia la lista de exencion
    // (1 -> 0, R5, revirtiendo 235/P4). Lo que el test sigue protegiendo es que NADIE mueva esos
    // numeros sin querer: cualquier alta o baja futura lo pone rojo igual que antes.
    //
    // ⏳ 2026-08-31 — y eso es exactamente lo que hizo: 12 -> 13 al entrar `en_preparacion`, el
    // evento de NACIMIENTO de la rama de fulfillment. La lista de exencion NO se toca (sigue vacia).
    expect(EVENTOS_PUBLICOS.size).toBe(13);
    expect(ORIGENES_SIN_EVENTO_PUBLICO.length).toBe(0);
  });
});

// -----------------------------------------------------------------------------------------------
// ⏳ 2026-08-22 — Feature 268 (T6a/T6b): la causa del INCIDENTE en `data.motivo` y el enlace
// ESTABLE a las evidencias en `data.evidenciasUrl`. Todo lo que se afirma aqui se afirma sobre el
// STRING REAL que recibe el sender (o su `JSON.parse`), nunca sobre un objeto intermedio.
// -----------------------------------------------------------------------------------------------

describe("268/R20-R21 — `data.motivo` transporta tambien la causa del incidente", () => {
  it("268/R20 (1): incidente del MENSAJERO -> la causa viaja en `motivo`", async () => {
    // El DTO no dice de donde vino la causa: el reader ya resolvio las dos procedencias. Este
    // caso y el siguiente son el par que exige leer LAS DOS (design §7.3).
    const { service, entregar } = buildService({ datos: datosIncidente("danado") });
    await service.ejecutar(jobIncidente());
    const body = JSON.parse(cuerpoDe(entregar));
    expect(body.data.estado).toBe("incidente");
    expect(body.data.motivo).toBe("danado"); // espanol, sin traducir (158/Q-B)
  });

  it("268/R20 (2): incidente del ADMIN -> la causa viaja en `motivo`", async () => {
    const { service, entregar } = buildService({ datos: datosIncidente("robado") });
    await service.ejecutar(jobIncidente());
    expect(JSON.parse(cuerpoDe(entregar)).data.motivo).toBe("robado");
  });

  it("268/R20: los tres values del SEED salen CRUDOS, en espanol y sin etiqueta de UI", async () => {
    for (const causa of CAUSA_INCIDENTE_SEED) {
      const { service, entregar } = buildService({ datos: datosIncidente(causa) });
      await service.ejecutar(jobIncidente());
      const cuerpo = cuerpoDe(entregar);
      expect(JSON.parse(cuerpo).data.motivo).toBe(causa);
      for (const etiqueta of ["Dañado", "Danado", "Perdido", "Robado", "motivoLabel"]) {
        expect(cuerpo).not.toContain(etiqueta);
      }
    }
  });

  it("268/R21 (3): en un evento `entregada` el campo EXISTE y vale null (convencion de la 256)", async () => {
    // R21 pide «la misma convencion de ausencia que fije la 256», y la 256 fijo PRESENTE-CON-NULL,
    // no la omision: su OpenAPI documenta forma UNICA para las cuatro claves.
    const { service, entregar } = buildService({
      datos: { ...DATOS_BASE, estado: "entregada", causaIncidente: "perdido" },
    });
    await service.ejecutar(job());
    const body = JSON.parse(cuerpoDe(entregar));
    expect("motivo" in body.data).toBe(true);
    expect(body.data.motivo).toBeNull();
    expect(cuerpoDe(entregar)).not.toContain("perdido"); // la causa vigente NO se publica aqui
  });

  it("268/R21 (4): un `incidente` SIN causa resoluble emite null y entrega con normalidad", async () => {
    const { service, entregar } = buildService({ datos: datosIncidente(null) });
    await expect(service.ejecutar(jobIncidente())).resolves.toBeUndefined();
    const body = JSON.parse(cuerpoDe(entregar));
    expect("motivo" in body.data).toBe(true);
    expect(body.data.motivo).toBeNull(); // sin valor por defecto inventado
    expect(entregar).toHaveBeenCalledTimes(1); // la entrega NO falla por esto
  });

  it("268/R20: la causa de DEVOLUCION y la de INCIDENTE no se cruzan nunca", async () => {
    // Una orden que arrastra las dos causas vigentes: cada evento publica LA SUYA.
    const datos: DatosEntregaOrden = {
      ...DATOS_BASE,
      causaDevolucion: "not_found",
      causaIncidente: "robado",
    };
    const a = buildService({ datos: { ...datos, estado: "devuelta" } });
    await a.service.ejecutar(jobDevuelta());
    expect(JSON.parse(cuerpoDe(a.entregar)).data.motivo).toBe("not_found");
    expect(cuerpoDe(a.entregar)).not.toContain("robado");

    const b = buildService({ datos: { ...datos, estado: "incidente" } });
    await b.service.ejecutar(jobIncidente());
    expect(JSON.parse(cuerpoDe(b.entregar)).data.motivo).toBe("robado");
    expect(cuerpoDe(b.entregar)).not.toContain("not_found");
  });
});

describe("268/R22-R25 — `data.evidenciasUrl`: estable, determinista y sin credencial", () => {
  // ⏳ 2026-09-10 (feature 406) — AQUI DECIA `${ORIGIN}/api/ordenes/api-key/orden/${ORDEN_ID}`, y
  // ese enlace daba 404 SIEMPRE: el `{id}` del canal nunca significo `orden.id`. Ahora lleva el
  // identificador PUBLICO de la orden —la guia de `DATOS_BASE`, `12345`—, y el literal se escribe
  // ENTERO A MANO: derivarlo de `PATH_ORDEN_API_KEY` o de una funcion del service lo dejaria
  // verde contra su propia fuente.
  const ENLACE = "https://app.ordenex.co/api/ordenes/api-key/orden/12345";

  it("268/R24 (1): en `incidente` viaja el enlace EXACTO; en `entregada` la clave NO existe", async () => {
    const a = buildService({ datos: datosIncidente("danado") });
    await a.service.ejecutar(jobIncidente());
    const bodyIncidente = JSON.parse(cuerpoDe(a.entregar));
    expect(bodyIncidente.data.evidenciasUrl).toBe(ENLACE);
    // Orden de claves congelado: la firma se calcula sobre el string serializado.
    // ⏳ 2026-09-09 (404/R9/R10): pasa de 5 a 6 claves. `mensajero` entra ANTES de `evidenciasUrl`,
    // que sigue cerrando el objeto y sigue siendo la UNICA clave opcional.
    expect(Object.keys(bodyIncidente.data)).toEqual([
      "numGuia",
      "numRemision",
      "estado",
      "motivo",
      "mensajero",
      "evidenciasUrl",
    ]);

    const b = buildService({ datos: { ...DATOS_BASE, estado: "entregada" } });
    await b.service.ejecutar(job());
    const bodyEntregada = JSON.parse(cuerpoDe(b.entregar));
    // R24: no viaja. Se afirma por AUSENCIA DE CLAVE, no con `toBeUndefined()` a secas.
    expect(Object.keys(bodyEntregada.data)).not.toContain("evidenciasUrl");
    expect("evidenciasUrl" in bodyEntregada.data).toBe(false);
    expect(cuerpoDe(b.entregar)).not.toContain("evidenciasUrl");
  });

  it("268/R19: el cuerpo de un evento NO-incidente conserva EXACTAMENTE sus claves de siempre", async () => {
    const { service, entregar } = buildService();
    await service.ejecutar(job());
    const body = JSON.parse(cuerpoDe(entregar));
    expect(Object.keys(body)).toEqual(["evento", "eventoId", "ocurridoAt", "data"]);
    // ⏳ 2026-09-09 (404/R9/R10): cuatro -> cinco, con `mensajero` al final del bloque presente.
    expect(Object.keys(body.data)).toEqual([
      "numGuia",
      "numRemision",
      "estado",
      "motivo",
      "mensajero",
    ]);
    expect(body.evento).toBe("orden.estado_actualizado");
  });

  it("268/R24 (2): con el origin SIN resolver el campo se OMITE (y `loadWebhookConfig` no lanza)", async () => {
    // Ni ruta relativa ni `https://undefined/...`: no hay campo.
    const ordenes: IWebhookOrdenReader = { findDatosEntrega: vi.fn(async () => datosIncidente("danado")) };
    const suscripciones = {
      findActivaByOwner: vi.fn(async () => ({ url: "https://a.example.com/hook", secret: SECRET_ENC })),
      // FICHA 403: el circuito se contabiliza en los dos desenlaces; sin estos dos, un doble
      // parcial rompe caminos que nada tienen que ver con la pausa.
      registrarEntregaOk: vi.fn(async () => {}),
      incrementarFalloYLeer: vi.fn(async () => null),
    } as unknown as IWebhookSuscripcionRepository;
    const entregar = vi.fn(async () => ({ status: "ok" }) as WebhookOutcome);
    const service = new WebhookEstadoService(
      ordenes,
      suscripciones,
      { entregar },
      { ...config, WEBHOOK_APP_ORIGIN: null },
      () => new Date("2026-08-22T10:00:05.000Z"),
    );
    await expect(service.ejecutar(jobIncidente())).resolves.toBeUndefined();

    const cuerpo = cuerpoDe(entregar);
    expect(Object.keys(JSON.parse(cuerpo).data)).not.toContain("evidenciasUrl");
    expect(cuerpo).not.toContain("undefined");
    expect(cuerpo).not.toContain("/api/ordenes/api-key/orden");
    expect(JSON.parse(cuerpo).data.motivo).toBe("danado"); // la causa SI sigue viajando

    // El invariante del modulo de config: nunca lanza, tampoco sin `NEXT_PUBLIC_APP_URL`.
    const previo = process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(() => loadWebhookConfig()).not.toThrow();
    expect(loadWebhookConfig().WEBHOOK_APP_ORIGIN).toBeNull();
    if (previo !== undefined) process.env.NEXT_PUBLIC_APP_URL = previo;
  });

  it("268/R25 (3): el MISMO job con relojes distintos entrega un cuerpo BYTE-IDENTICO", async () => {
    // Este caso se pone ROJO si alguien sustituye el enlace por una URL FIRMADA de Storage: el
    // token y la expiracion cambiarian entre el intento 1 y el intento 5.
    const entregas: string[] = [];
    for (const instante of ["2026-08-22T10:00:05.000Z", "2026-08-22T19:31:47.000Z"]) {
      const ordenes: IWebhookOrdenReader = {
        findDatosEntrega: vi.fn(async () => datosIncidente("perdido")),
      };
      const suscripciones = {
        findActivaByOwner: vi.fn(async () => ({ url: "https://a.example.com/hook", secret: SECRET_ENC })),
        // FICHA 403: el circuito se contabiliza en los dos desenlaces; sin estos dos, un doble
        // parcial rompe caminos que nada tienen que ver con la pausa.
        registrarEntregaOk: vi.fn(async () => {}),
        incrementarFalloYLeer: vi.fn(async () => null),
      } as unknown as IWebhookSuscripcionRepository;
      const entregar = vi.fn(async () => ({ status: "ok" }) as WebhookOutcome);
      const service = new WebhookEstadoService(
        ordenes,
        suscripciones,
        { entregar },
        config,
        () => new Date(instante),
      );
      await service.ejecutar(jobIncidente());
      entregas.push(cuerpoDe(entregar, 0));
    }
    const [cuerpo1, cuerpo2] = entregas;
    expect(cuerpo1).toBe(cuerpo2); // byte a byte, sobre el string entregado al sender
    expect(JSON.parse(cuerpo1).data.evidenciasUrl).toBe(ENLACE);
    expect(JSON.parse(cuerpo1).eventoId).toBe(JSON.parse(cuerpo2).eventoId);
  });

  it("268/R22 (4): el cuerpo NO lleva bucket, token, firma de S3 ni storage_path", async () => {
    const { service, entregar } = buildService({ datos: datosIncidente("danado") });
    await service.ejecutar(jobIncidente());
    const cuerpo = cuerpoDe(entregar); // el STRING REAL que recibe el sender

    expect(cuerpo).not.toContain(gestionConfig.EVIDENCIA_BUCKET);
    for (const rastro of ["token=", "X-Amz", "storage_path", "storagePath", "sign/", "signed"]) {
      expect(cuerpo).not.toContain(rastro);
    }
    // Y lo que SI lleva: un enlace sin query string ninguna.
    const url = new URL(JSON.parse(cuerpo).data.evidenciasUrl);
    expect(url.search).toBe("");
    // ⏳ 2026-09-10 (406/R6): el segmento es la GUIA, no el uuid. Literal a mano.
    expect(url.pathname).toBe("/api/ordenes/api-key/orden/12345");
  });

  it("268/R25 + 406/R4: el enlace lo fija la ORDEN, no el `ordenId` del payload", async () => {
    // ⏳ 2026-09-10 — AQUI DECIA «el enlace no depende de la base, solo del origin y del ordenId
    // del payload», y la segunda mitad ya no es cierta: la 406 lo construye con el identificador
    // PUBLICO (guia, o remision si no hay guia), que sale de la lectura. La primera mitad se
    // CONSERVA intacta porque es la que sigue protegiendo lo que la 268 queria —el enlace no
    // consulta Storage ni cambia con la causa leida dentro de la ventana de la 256/R15— y se le
    // suma la afirmacion inversa, que es la que fija el cambio de esta ficha.
    const { service, entregar } = buildService({ datos: datosIncidente("danado") });
    await service.ejecutar(jobIncidente());
    const { service: s2, entregar: e2 } = buildService({ datos: datosIncidente(null) });
    await s2.ejecutar(jobIncidente());
    expect(JSON.parse(cuerpoDe(e2)).data.evidenciasUrl).toBe(
      JSON.parse(cuerpoDe(entregar)).data.evidenciasUrl,
    );
    expect(JSON.parse(cuerpoDe(e2)).data.motivo).toBeNull();

    // MISMA orden con OTRO `ordenId` de payload -> MISMO enlace (antes daba otro).
    const { service: s3, entregar: e3 } = buildService({ datos: datosIncidente("danado") });
    await s3.ejecutar(
      job({ ordenId: "orden-2", estatusDestinoId: "s-incidente", ocurridoAt: "2026-08-22T10:00:00.000Z" }),
    );
    expect(JSON.parse(cuerpoDe(e3)).data.evidenciasUrl).toBe(ENLACE);

    // OTRA orden (otra guia) -> OTRO enlace. Literal a mano, no derivado del service.
    const { service: s4, entregar: e4 } = buildService({
      datos: { ...datosIncidente("danado"), numGuia: 777001 },
    });
    await s4.ejecutar(jobIncidente());
    expect(JSON.parse(cuerpoDe(e4)).data.evidenciasUrl).toBe(
      "https://app.ordenex.co/api/ordenes/api-key/orden/777001",
    );
  });

  it("268/R18: la firma verifica contra el cuerpo YA ampliado con el enlace", async () => {
    const { service, entregar } = buildService({ datos: datosIncidente("robado") });
    await service.ejecutar(jobIncidente());
    const [, cuerpo, headers] = entregar.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, string>,
    ];
    expect(cuerpo).toContain(`"evidenciasUrl":"${ENLACE}"`);
    const ts = Number(headers["X-Ordenex-Timestamp"]);
    expect(headers["X-Ordenex-Signature"]).toBe(`sha256=${firmarWebhook(SECRETO, ts, cuerpo)}`);
  });
});

// ⏳ 2026-09-10 — FEATURE 406: el identificador con el que se construye `data.evidenciasUrl`.
//
// El defecto que cierra: el enlace llevaba el `orden.id` del payload (un uuid) y el `{id}` del
// canal solo resuelve por `num_guia` o `num_remision` (177/R8-R15) -> 404 GARANTIZADO. Aqui se
// fija QUE identificador viaja; que ese identificador RESUELVE de verdad se cierra en
// `tests/integration/api/webhook-evidencias-url-resuelve.route.test.ts` (el lazo entero) y contra
// el SQL real en `tests/integration/db/webhook-evidencias-url-resuelve-sql-real.test.ts`.
//
// LOS LITERALES DE ESTE BLOQUE ESTAN ESCRITOS A MANO A PROPOSITO: no se importa
// `PATH_ORDEN_API_KEY` ni ninguna funcion del service para construir el esperado. Compararlo
// contra su propia fuente estaria siempre verde.
describe("406/R4-R6 — `data.evidenciasUrl` lleva el identificador PUBLICO, nunca el uuid interno", () => {
  it("406/R4: con guia, el ultimo segmento es la guia en decimal", async () => {
    const { service, entregar } = buildService({
      datos: { ...datosIncidente("robado"), numGuia: 100235, numRemision: "REM-0002" },
    });
    await service.ejecutar(jobIncidente());
    const { data } = JSON.parse(cuerpoDe(entregar));

    expect(data.evidenciasUrl).toBe("https://app.ordenex.co/api/ordenes/api-key/orden/100235");
    expect(new URL(data.evidenciasUrl).pathname).toBe("/api/ordenes/api-key/orden/100235");
    // La guia gana a la remision: las DOS estan en el mismo `data` y solo una va en el enlace.
    expect(data.numGuia).toBe(100235);
    expect(data.numRemision).toBe("REM-0002");
    expect(data.evidenciasUrl).not.toContain("REM-0002");
  });

  it("406/R5: sin guia, el ultimo segmento es la remision tal cual", async () => {
    const { service, entregar } = buildService({
      datos: { ...datosIncidente("robado"), numGuia: null, numRemision: "REM-0002" },
    });
    await service.ejecutar(jobIncidente());
    const { data } = JSON.parse(cuerpoDe(entregar));

    expect(data.evidenciasUrl).toBe("https://app.ordenex.co/api/ordenes/api-key/orden/REM-0002");
    expect(data.numGuia).toBeNull();
  });

  it("406/R5: una remision con `/` y espacio viaja CODIFICADA y vuelve intacta", async () => {
    const { service, entregar } = buildService({
      datos: { ...datosIncidente("robado"), numGuia: null, numRemision: "A/B C" },
    });
    await service.ejecutar(jobIncidente());
    const { data } = JSON.parse(cuerpoDe(entregar));

    expect(data.evidenciasUrl).toBe("https://app.ordenex.co/api/ordenes/api-key/orden/A%2FB%20C");
    // UN solo segmento tras `/orden/`: el `/` de la remision NO inventa uno nuevo.
    const segmentos = new URL(data.evidenciasUrl).pathname.split("/");
    expect(segmentos).toHaveLength(6);
    expect(decodeURIComponent(segmentos[5])).toBe("A/B C");
  });

  it("406/R6: el `ordenId` del payload NO aparece en el enlace (aunque siga en el `eventoId`)", async () => {
    const { service, entregar } = buildService({
      datos: { ...datosIncidente("robado"), numGuia: 100235 },
    });
    await service.ejecutar(jobIncidente());
    const body = JSON.parse(cuerpoDe(entregar)); // el STRING REAL que recibe el sender

    // Aserto por AUSENCIA sobre el enlace, no sobre el cuerpo entero: el uuid SIGUE viajando en
    // el `eventoId`, que es la clave de deduplicacion y NO cambia (design §9).
    expect(body.data.evidenciasUrl).not.toContain(ORDEN_ID);
    expect(body.eventoId).toContain(ORDEN_ID);
    // Y no se cuela NINGUN uuid por la puerta de atras.
    expect(body.data.evidenciasUrl).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
  });
});

// ⏳ 2026-09-10 — FEATURE 406 (R7/R8): cuando NO hay identificador publicable, se OMITE la clave
// en vez de emitir un enlace que el endpoint rechazaria o de tumbar la entrega entera.
describe("406/R7-R8 — sin identificador resoluble, la clave se OMITE y el job completa", () => {
  /** Las CINCO claves siempre presentes: lo que tiene que seguir viajando cuando falta el enlace. */
  const CINCO = ["numGuia", "numRemision", "estado", "motivo", "mensajero"];

  it("406/R7a: remision de 129 caracteres -> clave AUSENTE, cuerpo normal y job completado", async () => {
    const larga = "R".repeat(129);
    const { service, entregar } = buildService({
      datos: { ...datosIncidente("robado"), numGuia: null, numRemision: larga },
    });
    await expect(service.ejecutar(jobIncidente())).resolves.toBeUndefined();

    const cuerpo = cuerpoDe(entregar);
    const { data } = JSON.parse(cuerpo);
    expect("evidenciasUrl" in data).toBe(false);
    expect(Object.keys(data)).toEqual(CINCO);
    expect(cuerpo).not.toContain("evidenciasUrl");
    // El resto del cuerpo va como siempre: la remision larga SI viaja en su propio campo.
    expect(data.numRemision).toBe(larga);
    expect(data.motivo).toBe("robado");
  });

  it("406/R7b: remision con espacios de borde -> clave AUSENTE (el borde la recortaria)", async () => {
    // El complemento de este caso —que ` REM-1 ` da 404 en el endpoint real, o sea que la omision
    // esta JUSTIFICADA— vive en `tests/integration/api/webhook-evidencias-url-resuelve.route.test.ts`.
    const { service, entregar } = buildService({
      datos: { ...datosIncidente("robado"), numGuia: null, numRemision: " REM-1 " },
    });
    await expect(service.ejecutar(jobIncidente())).resolves.toBeUndefined();

    const { data } = JSON.parse(cuerpoDe(entregar));
    expect("evidenciasUrl" in data).toBe(false);
    expect(data.numRemision).toBe(" REM-1 ");
  });

  it("406/R7c: remision de 128 caracteres EXACTOS -> la clave SI viaja (la cota no se pasa de frenada)", async () => {
    const justa = "R".repeat(128);
    const { service, entregar } = buildService({
      datos: { ...datosIncidente("robado"), numGuia: null, numRemision: justa },
    });
    await service.ejecutar(jobIncidente());

    const { data } = JSON.parse(cuerpoDe(entregar));
    expect("evidenciasUrl" in data).toBe(true);
    expect(data.evidenciasUrl).toBe(`https://app.ordenex.co/api/ordenes/api-key/orden/${justa}`);
  });

  it("406/R8: remision con un sustituto UTF-16 desemparejado -> clave AUSENTE y el job NO falla", async () => {
    // `encodeURIComponent("\uD800")` LANZA `URIError`. Si escapara, saldria por el `throw` de
    // `ejecutar`: cinco reintentos y dead-letter de una entrega por lo demas perfecta.
    const rota = "REM-\uD800";
    const { service, entregar } = buildService({
      datos: { ...datosIncidente("robado"), numGuia: null, numRemision: rota },
    });
    await expect(service.ejecutar(jobIncidente())).resolves.toBeUndefined();

    expect(entregar).toHaveBeenCalledTimes(1); // la entrega SE HIZO, no se aborto
    const { data } = JSON.parse(cuerpoDe(entregar));
    expect("evidenciasUrl" in data).toBe(false);
    expect(Object.keys(data)).toEqual(CINCO);
  });
});

describe("R24 — aislamiento por owner", () => {
  it("el evento de la orden de un owner nunca se envia al callback de otro owner", async () => {
    // La orden pertenece a owner-A; existe tambien owner-B con OTRA url. El destino se deriva
    // SIEMPRE de orden.tiendaId, nunca del payload.
    const { service, entregar, suscripciones } = buildService({
      subPorOwner: {
        "owner-A": { url: "https://a.example.com/hook", secret: SECRET_ENC },
        "owner-B": { url: "https://b.example.com/hook", secret: SECRET_ENC },
      },
    });
    await service.ejecutar(job());
    expect(suscripciones.findActivaByOwner).toHaveBeenCalledWith("owner-A");
    expect((entregar.mock.calls[0] as unknown as [string])[0]).toBe("https://a.example.com/hook");
    expect((entregar.mock.calls[0] as unknown as [string])[0]).not.toContain("b.example.com");
  });
});

describe("R29 — logs sin secreto/URL/PII", () => {
  it("ningun log emitido contiene secreto, URL ni datos del destinatario", async () => {
    const { service, logs } = buildService({
      // Feature 256 (R23): la orden del caso es una DEVOLUCION CON CAUSA, para que el log tenga
      // de verdad algo que filtrar. El fallo es transitorio, que es el unico camino que loguea.
      datos: { ...datosDevuelta("not_found"), numRemision: NUM_REMISION },
      subPorOwner: { "owner-A": { url: "https://secreta.example.com/hook", secret: SECRET_ENC } },
      outcome: { status: "transitorio", detalle: "entregar webhook: HTTP 503" },
    });
    await service.ejecutar(jobDevuelta()).catch(() => {});
    const todo = logs.join("\n");
    expect(todo).not.toContain(SECRETO);
    expect(todo).not.toContain("secreta.example.com");
    expect(todo).not.toContain(NUM_REMISION);
    expect(todo).not.toContain(DESTINATARIO);
    // 256/R23: la causa tampoco viaja al logger, ni sola ni pegada a la URL o al secreto. Los
    // mensajes siguen siendo agregados (99/R29).
    for (const causa of CAUSA_DEVOLUCION_SEED) expect(todo).not.toContain(causa);
    expect(todo).not.toContain("motivo");
  });

  // ⏳ 2026-09-09 (feature 404, R13) — se AMPLIA este bloque en vez de abrir uno paralelo: el
  // mensajero es PII de un tercero y cae bajo la misma regla que el destinatario y la causa.
  it("404/R13: con un mensajero asignado, ni su nombre ni su id llegan al logger", async () => {
    const { service, logs } = buildService({
      datos: {
        ...datosDevuelta("not_found"),
        mensajero: { id: MENSAJERO_ID, nombre: MENSAJERO_NOMBRE },
      },
      subPorOwner: { "owner-A": { url: "https://secreta.example.com/hook", secret: SECRET_ENC } },
      outcome: { status: "transitorio", detalle: "entregar webhook: HTTP 503" },
    });
    await service.ejecutar(jobDevuelta()).catch(() => {});
    const todo = logs.join("\n");
    expect(logs.length).toBeGreaterThan(0); // el camino que loguea SI se recorrio
    expect(todo).not.toContain(MENSAJERO_NOMBRE);
    expect(todo).not.toContain(MENSAJERO_ID);
    // Tampoco el apellido suelto ni el nombre de la clave: el mensaje sigue siendo agregado.
    expect(todo).not.toContain("Jimenez");
    expect(todo).not.toContain("mensajero");
  });
});

describe("R30 — payload invalido", () => {
  it("un payload con forma inesperada produce error de integracion sin secreto", async () => {
    const { service, ordenes } = buildService();
    const err = await service.ejecutar(job({ foo: "bar" })).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/payload invalido/i);
    expect((err as Error).message).not.toContain(SECRETO);
    // No llego a leer la orden.
    expect(ordenes.findDatosEntrega).not.toHaveBeenCalled();
  });
});

describe("R32 — clave de cifrado ausente", () => {
  it("sin clave configurada el descifrado lanza error recuperable sin filtrar el secreto", async () => {
    const ordenes: IWebhookOrdenReader = { findDatosEntrega: vi.fn(async () => DATOS_BASE) };
    const suscripciones = {
      findActivaByOwner: vi.fn(async () => ({ url: "https://a.example.com/hook", secret: SECRET_ENC })),
      // FICHA 403: el circuito se contabiliza en los dos desenlaces; sin estos dos, un doble
      // parcial rompe caminos que nada tienen que ver con la pausa.
      registrarEntregaOk: vi.fn(async () => {}),
      incrementarFalloYLeer: vi.fn(async () => null),
    } as unknown as IWebhookSuscripcionRepository;
    const entregar = vi.fn(async () => ({ status: "ok" }) as WebhookOutcome);
    const service = new WebhookEstadoService(
      ordenes,
      suscripciones,
      { entregar },
      { ...config, WEBHOOK_SECRET_ENC_KEY: null }, // clave ausente
      () => new Date(),
    );
    const err = await service.ejecutar(job()).catch((e) => e);
    expect(err).toBeInstanceOf(WebhookSecretKeyError);
    expect((err as Error).message).not.toContain(SECRETO);
    expect(entregar).not.toHaveBeenCalled(); // no se entrega sin poder firmar
  });
});

// ---------------------------------------------------------------------------
// FICHA 403 (T8) — EL CIRCUITO DENTRO DEL SERVICE.
//
// Cubre R2 (el 2xx cierra la racha y saca de la pausa), R3 (que cuenta y que NO), R4 (cruzar el
// umbral espacia y avisa), R5 (`activa` no se toca en ninguna rama), R6 (lo que NO debe pausar) y
// R13 (ni el aviso ni el log llevan URL o secreto).
//
// ⚠️ EL RIESGO REAL DE ESTA FICHA ES EL FALSO POSITIVO. Hay un integrador de verdad conectado: si
// una caida corta acabara en pausa, le espaciariamos las entregas una hora sin motivo. Por eso los
// casos de R6 son tan importantes como los de R4.
// ---------------------------------------------------------------------------

describe("403/R2 — un 2xx cierra la racha y saca de la pausa, sin intervencion manual", () => {
  it("⭑ la entrega aceptada llama a `registrarEntregaOk` con el owner y el `now` del service", async () => {
    const { service, registrarEntregaOk, incrementarFalloYLeer } = buildService({
      outcome: { status: "ok" },
    });

    await service.ejecutar(job());

    expect(registrarEntregaOk).toHaveBeenCalledTimes(1);
    expect(registrarEntregaOk).toHaveBeenCalledWith("owner-A", AHORA);
    // Y no cuenta ningun fallo: el exito no es un intento fallido.
    expect(incrementarFalloYLeer).not.toHaveBeenCalled();
  });

  it("⭑ SALE DE LA PAUSA: tras el reset, el mismo estado ya no cumple el umbral", async () => {
    // Es R2 medido donde de verdad ocurre. `registrarEntregaOk` pone el contador a 0 y el ancla a
    // `ahora`; con esos dos valores, `estaPausada` —la MISMA funcion que usa el drenador— devuelve
    // `false` sin que nadie toque nada mas. La suscripcion se recupera sola.
    const pausadaAntes = estaPausada(9, new Date(AHORA.getTime() - 5 * 60 * 60_000), AHORA, {
      fallosMinimos: PAUSA_FALLOS,
      ventanaMs: PAUSA_VENTANA_MS,
    });
    expect(pausadaAntes).toBe(true);

    const { service, registrarEntregaOk } = buildService({ outcome: { status: "ok" } });
    await service.ejecutar(job());
    const [, anclaNueva] = registrarEntregaOk.mock.calls[0] as unknown as [string, Date];

    // El estado que deja el reset: contador 0, ancla = el instante del exito.
    expect(
      estaPausada(0, anclaNueva, AHORA, {
        fallosMinimos: PAUSA_FALLOS,
        ventanaMs: PAUSA_VENTANA_MS,
      }),
    ).toBe(false);
  });

  it("no notifica nada en un exito", async () => {
    const { service, notificarPausa } = buildService({ outcome: { status: "ok" } });
    await service.ejecutar(job());
    expect(notificarPausa).not.toHaveBeenCalled();
  });
});

describe("403/R3 — que cuenta como fallo de entrega, y que NO", () => {
  it("⭑ un no-2xx cuenta: se incrementa una vez, con el owner de la orden", async () => {
    const { service, incrementarFalloYLeer } = buildService({ outcome: FALLO });
    await service.ejecutar(job()).catch(() => {});
    expect(incrementarFalloYLeer).toHaveBeenCalledTimes(1);
    expect(incrementarFalloYLeer.mock.calls[0][0]).toBe("owner-A");
  });

  it("⭑ un timeout o un fallo de red tambien cuentan", async () => {
    for (const detalle of [
      "entregar webhook: fallo de red o timeout",
      "entregar webhook: HTTP 429",
    ]) {
      const { service, incrementarFalloYLeer } = buildService({
        outcome: { status: "transitorio", detalle },
      });
      await service.ejecutar(job()).catch(() => {});
      expect(incrementarFalloYLeer, detalle).toHaveBeenCalledTimes(1);
    }
  });

  it("⭑ un PAYLOAD INVALIDO no cuenta: nunca intento la peticion HTTP", async () => {
    // R3, ultima frase. Es un problema NUESTRO de integracion; contarlo penalizaria con reintentos
    // espaciados a un destino perfectamente sano.
    const { service, incrementarFalloYLeer, entregar } = buildService();
    await service.ejecutar(job({ foo: "bar" })).catch(() => {});
    expect(entregar).not.toHaveBeenCalled();
    expect(incrementarFalloYLeer).not.toHaveBeenCalled();
  });

  it("⭑ un `WebhookSecretKeyError` (clave de cifrado ausente) TAMPOCO cuenta", async () => {
    // El otro caso de R3, ultima frase, y el mas peligroso: si un despliegue se queda sin
    // `WEBHOOK_SECRET_ENC_KEY`, TODAS las suscripciones fallarian a la vez. Contarlo pausaria a
    // todos los integradores del sistema por un fallo de configuracion propio.
    const ordenes: IWebhookOrdenReader = { findDatosEntrega: vi.fn(async () => DATOS_BASE) };
    const incrementarFalloYLeer = vi.fn(async () => null);
    const registrarEntregaOk = vi.fn(async () => {});
    const suscripciones = {
      findActivaByOwner: vi.fn(async () => ({
        url: "https://a.example.com/hook",
        secret: SECRET_ENC,
      })),
      incrementarFalloYLeer,
      registrarEntregaOk,
    } as unknown as IWebhookSuscripcionRepository;
    const entregar = vi.fn(async () => ({ status: "ok" }) as WebhookOutcome);
    const service = new WebhookEstadoService(
      ordenes,
      suscripciones,
      { entregar },
      { ...config, WEBHOOK_SECRET_ENC_KEY: null },
      () => AHORA,
    );

    const err = await service.ejecutar(job()).catch((e) => e);

    expect(err).toBeInstanceOf(WebhookSecretKeyError);
    expect(entregar).not.toHaveBeenCalled();
    expect(incrementarFalloYLeer).not.toHaveBeenCalled();
    expect(registrarEntregaOk).not.toHaveBeenCalled();
  });

  it("una orden sin suscripcion activa no cuenta ningun fallo", async () => {
    const { service, incrementarFalloYLeer } = buildService({ subPorOwner: { "owner-A": null } });
    await service.ejecutar(job());
    expect(incrementarFalloYLeer).not.toHaveBeenCalled();
  });
});

describe("403/R4 — cruzar umbral Y ventana espacia el reintento y avisa", () => {
  it("⭑ 3 fallos y 30 minutos: el error lleva el INTERVALO DE PAUSA como sugerencia", async () => {
    const { service } = buildService({
      outcome: FALLO,
      estadoTrasFallo: estadoTras(PAUSA_FALLOS, 30),
    });

    const err = await service.ejecutar(job()).catch((e) => e);

    expect(err).toBeInstanceOf(WebhookEntregaFallidaError);
    expect((err as WebhookEntregaFallidaError).retryAfterMs).toBe(PAUSA_INTERVALO_MS);
    // El detalle NO cambia: la cola sigue viendo el mismo fallo de siempre (R16).
    expect((err as Error).message).toBe(FALLO.detalle);
  });

  it("⭑ y avisa al maestro con el ancla de la RACHA, no con `ahora`", async () => {
    // El `sinExitoDesde` que viaja al aviso es lo que hace que la deduplicacion sea POR RACHA
    // (R12). Si aqui se colara `ahora`, el `entidadId` cambiaria en cada intento y saldria un
    // aviso por fallo — 1.958 avisos en el incidente medido.
    const estado = estadoTras(PAUSA_FALLOS, 45);
    const { service, notificarPausa } = buildService({ outcome: FALLO, estadoTrasFallo: estado });

    await service.ejecutar(job()).catch(() => {});

    expect(notificarPausa).toHaveBeenCalledTimes(1);
    expect(notificarPausa).toHaveBeenCalledWith({
      ownerUsuarioId: "owner-A",
      sinExitoDesde: estado.sinExitoDesde,
    });
  });

  it("⭑ intenta notificar en CADA fallo de la racha: no hay deteccion de transicion aqui", async () => {
    // design §4. El service no recuerda si ya notifico —eso lo resuelve el `entidadId` contra el
    // indice unico—, asi que llama siempre que `estaPausada()` sea cierto. Reconstruir el estado
    // previo restando uno al contador NO funciona: no distingue el caso en que el conteo ya
    // superaba el umbral y es el TIEMPO el que acaba de cumplirse.
    const estado = estadoTras(50, 300);
    const { service, notificarPausa } = buildService({ outcome: FALLO, estadoTrasFallo: estado });

    await service.ejecutar(job()).catch(() => {});
    await service.ejecutar(job()).catch(() => {});

    expect(notificarPausa).toHaveBeenCalledTimes(2);
    // Y las dos veces con el MISMO contexto: misma racha, misma entidad, un solo aviso al final.
    expect(notificarPausa.mock.calls[0][0]).toEqual(notificarPausa.mock.calls[1][0]);
  });

  it("⭑ R11: el aviso es lo ULTIMO que puede pasar, y el job falla igual", async () => {
    // LA CORRIDA MANDA, EL AVISO ES CORTESIA. Quien ABSORBE el fallo del aviso es el notificador
    // real (`notificarWebhookSuscripcionPausadaCon` → `emitirBestEffort`), y eso se mide en
    // `notificacion-notificadores-reales.test.ts`. Lo que se fija AQUI es la mitad que corresponde
    // al service: que el aviso no se interponga entre el fallo y su reintento —el contador ya se
    // incremento antes de notificar, y el error que sale es el de la ENTREGA—.
    const { service, incrementarFalloYLeer, notificarPausa } = buildService({
      outcome: FALLO,
      estadoTrasFallo: estadoTras(PAUSA_FALLOS, 60),
    });

    const err = await service.ejecutar(job()).catch((e) => e);

    expect(incrementarFalloYLeer).toHaveBeenCalledTimes(1);
    expect(notificarPausa).toHaveBeenCalledTimes(1);
    // El `last_error` que vera la cola es el de la entrega, no el del aviso.
    expect(err).toBeInstanceOf(WebhookEntregaFallidaError);
    expect((err as Error).message).toBe(FALLO.detalle);
  });
});

describe("403/R6 — lo que NO debe pausar (el falso positivo es el riesgo real)", () => {
  it("⭑ CAIDA CORTA: 5 fallos en 4 minutos NO pausa ni avisa", async () => {
    // Un despliegue del integrador, un reinicio, un pico de latencia. Sin la ventana, esto
    // convertiria una caida de 4 minutos en una interrupcion de una hora.
    const { service, notificarPausa } = buildService({
      outcome: FALLO,
      estadoTrasFallo: estadoTras(5, 4),
    });

    const err = await service.ejecutar(job()).catch((e) => e);

    expect(notificarPausa).not.toHaveBeenCalled();
    expect((err as WebhookEntregaFallidaError).retryAfterMs).toBeUndefined();
  });

  it("⭑ FALLOS INSUFICIENTES: 2 fallos con 3 horas sin exito NO pausa ni avisa", async () => {
    const { service, notificarPausa } = buildService({
      outcome: FALLO,
      estadoTrasFallo: estadoTras(PAUSA_FALLOS - 1, 180),
    });

    const err = await service.ejecutar(job()).catch((e) => e);

    expect(notificarPausa).not.toHaveBeenCalled();
    expect((err as WebhookEntregaFallidaError).retryAfterMs).toBeUndefined();
  });

  it("⭑ sin pausa, un 429 conserva SU `Retry-After`: el circuito no lo pisa (R14)", async () => {
    const { service } = buildService({
      outcome: { status: "transitorio", detalle: "entregar webhook: HTTP 429", retryAfterMs: 90_000 },
      estadoTrasFallo: estadoTras(1, 1),
    });

    const err = await service.ejecutar(job()).catch((e) => e);

    expect((err as WebhookEntregaFallidaError).retryAfterMs).toBe(90_000);
  });

  it("⭑ CON pausa, el intervalo de pausa GANA al `Retry-After` del 429", async () => {
    // Un destino saturado que ademas lleva media hora sin aceptar nada: la pausa es la señal mas
    // fuerte de las dos, y ademas la cola se queda con el mayor de los dos por su propia regla.
    const { service } = buildService({
      outcome: { status: "transitorio", detalle: "entregar webhook: HTTP 429", retryAfterMs: 5_000 },
      estadoTrasFallo: estadoTras(PAUSA_FALLOS, 31),
    });

    const err = await service.ejecutar(job()).catch((e) => e);

    expect((err as WebhookEntregaFallidaError).retryAfterMs).toBe(PAUSA_INTERVALO_MS);
  });

  it("una suscripcion borrada entre el encolado y la entrega no pausa nada", async () => {
    const { service, notificarPausa } = buildService({ outcome: FALLO, estadoTrasFallo: null });
    const err = await service.ejecutar(job()).catch((e) => e);
    expect(err).toBeInstanceOf(WebhookEntregaFallidaError);
    expect(notificarPausa).not.toHaveBeenCalled();
  });
});

describe("403/R5 — PAUSAR NO ES DESACTIVAR: `activa` no se toca en ningun camino", () => {
  it("⭑ ni en un exito, ni en un fallo, ni al cruzar el umbral se llama a `desactivarByOwner`", async () => {
    // R5 medido donde puede romperse. El doble expone `desactivarByOwner` como espia: si algun dia
    // alguien "arregla" esto desactivando la suscripcion, este caso lo nombra.
    const desactivarByOwner = vi.fn(async () => {});
    for (const escenario of [
      { outcome: { status: "ok" } as WebhookOutcome, estado: undefined },
      { outcome: FALLO, estado: estadoTras(1, 1) },
      { outcome: FALLO, estado: estadoTras(99, 600) }, // pausada de sobra
    ]) {
      const suscripciones = {
        findActivaByOwner: vi.fn(async () => ({
          url: "https://a.example.com/hook",
          secret: SECRET_ENC,
        })),
        registrarEntregaOk: vi.fn(async () => {}),
        incrementarFalloYLeer: vi.fn(async () => escenario.estado ?? null),
        desactivarByOwner,
        upsertByOwner: vi.fn(async () => {}),
        actualizarUrlByOwner: vi.fn(async () => {}),
        actualizarSecretoByOwner: vi.fn(async () => {}),
      } as unknown as IWebhookSuscripcionRepository;
      const service = new WebhookEstadoService(
        { findDatosEntrega: vi.fn(async () => DATOS_BASE) },
        suscripciones,
        { entregar: vi.fn(async () => escenario.outcome) },
        config,
        () => AHORA,
        { warn: () => {} },
        vi.fn(async () => {}),
      );
      await service.ejecutar(job()).catch(() => {});
    }
    expect(desactivarByOwner).not.toHaveBeenCalled();
  });

  it("⭑ y el codigo de este service no menciona `activa` ni `desactiv` en ninguna forma", () => {
    // Guardia de texto sobre el archivo REAL. El vocabulario de esta ficha es «pausa»: la
    // suscripcion sigue viva. Un `activa: false` colado aqui reproduciria exactamente la
    // enfermedad —dejar al integrador desconectado hasta que alguien lo reactive a mano—.
    // Se mide sobre el CODIGO, con el quitador de comentarios del repo: la prosa de este archivo
    // nombra a proposito lo que el codigo tiene prohibido, y un barrido sobre el texto crudo
    // denunciaria la explicacion en vez del error.
    const codigo = codigoSinComentarios("lib/services/WebhookEstadoService.ts");
    expect(codigo).not.toMatch(/desactiv/i);
    expect(codigo).not.toMatch(/\bactiva\s*[:=]/);
  });
});

describe("403/R13 — ni el aviso ni el log llevan la URL o el secreto", () => {
  it("⭑ el contexto del notificador solo tiene un id de owner y una fecha", async () => {
    const { service, notificarPausa } = buildService({
      subPorOwner: {
        "owner-A": { url: "https://secreta.example.com/hook?token=SECRETO-EN-URL", secret: SECRET_ENC },
      },
      outcome: FALLO,
      estadoTrasFallo: estadoTras(PAUSA_FALLOS, 60),
    });

    await service.ejecutar(job()).catch(() => {});

    expect(notificarPausa).toHaveBeenCalledTimes(1);
    const ctx = notificarPausa.mock.calls[0][0] as unknown as Record<string, unknown>;
    // La forma EXACTA: dos claves y ninguna mas. Un campo de mas es por donde se cuela la URL.
    expect(Object.keys(ctx).sort()).toEqual(["ownerUsuarioId", "sinExitoDesde"]);
    const serializado = JSON.stringify(ctx);
    expect(serializado).not.toContain("secreta.example.com");
    expect(serializado).not.toContain("SECRETO-EN-URL");
    expect(serializado).not.toContain(SECRETO);
    expect(serializado).not.toContain(SECRET_ENC);
    expect(serializado).not.toContain(NUM_REMISION);
    expect(serializado).not.toContain(DESTINATARIO);
  });

  it("⭑ el log de una entrega fallida ESTANDO PAUSADA sigue sin filtrar nada", async () => {
    const { service, logs } = buildService({
      subPorOwner: {
        "owner-A": { url: "https://secreta.example.com/hook", secret: SECRET_ENC },
      },
      outcome: FALLO,
      estadoTrasFallo: estadoTras(99, 600),
    });

    await service.ejecutar(job()).catch(() => {});

    const todo = logs.join("\n");
    expect(todo).not.toContain("secreta.example.com");
    expect(todo).not.toContain(SECRETO);
    expect(todo).not.toContain(SECRET_ENC);
    expect(todo).not.toContain(NUM_REMISION);
    expect(todo).not.toContain(DESTINATARIO);
    expect(todo).not.toMatch(/desactiv/i);
  });
});

describe("403 — el DEFAULT del notificador es el no-op, no el real", () => {
  it("⭑ un service construido SIN notificador no escribe nada y no revienta al pausar", async () => {
    // Es lo que impide que cualquiera de las suites que instancian este service escriba avisos
    // contra la base local, que en este repo es COMPARTIDA. Se construye con SEIS argumentos —el
    // septimo se omite— y se le hace cruzar el umbral.
    const suscripciones = {
      findActivaByOwner: vi.fn(async () => ({
        url: "https://a.example.com/hook",
        secret: SECRET_ENC,
      })),
      registrarEntregaOk: vi.fn(async () => {}),
      incrementarFalloYLeer: vi.fn(async () => estadoTras(99, 600)),
    } as unknown as IWebhookSuscripcionRepository;
    const service = new WebhookEstadoService(
      { findDatosEntrega: vi.fn(async () => DATOS_BASE) },
      suscripciones,
      { entregar: vi.fn(async () => FALLO) },
      config,
      () => AHORA,
    );

    const err = await service.ejecutar(job()).catch((e) => e);

    expect(err).toBeInstanceOf(WebhookEntregaFallidaError);
    expect((err as WebhookEntregaFallidaError).retryAfterMs).toBe(PAUSA_INTERVALO_MS);
  });
});
