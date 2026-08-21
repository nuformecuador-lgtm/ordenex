import { describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { WebhookEstadoService, WebhookEntregaFallidaError } from "@/lib/services/WebhookEstadoService";
import { WebhookSecretKeyError, cifrarSecreto } from "@/lib/crypto/webhook-secret-cipher";
import { firmarWebhook } from "@/lib/crypto/webhook-firma";
import type { WebhookConfig } from "@/lib/config/webhook";
import type { IWebhookOrdenReader, DatosEntregaOrden } from "@/lib/interfaces/repositories/IWebhookOrdenReader";
import type { IWebhookSuscripcionRepository, WebhookSuscripcionActiva } from "@/lib/interfaces/repositories/IWebhookSuscripcionRepository";
import type { IWebhookSender, WebhookOutcome } from "@/lib/interfaces/external/IWebhookSender";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import { CAUSA_DEVOLUCION_SEED, type CausaDevolucion } from "@/lib/types/causa-devolucion";
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

const config: WebhookConfig = {
  WEBHOOK_TIMEOUT_MS: 10_000,
  WEBHOOK_REPLAY_WINDOW_S: 300,
  WEBHOOK_SECRET_ENC_KEY: CLAVE,
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
};

/** Feature 256 — datos de una orden que transiciona a `devuelta` con su causa vigente. */
function datosDevuelta(causaDevolucion: CausaDevolucion | null): DatosEntregaOrden {
  return { ...DATOS_BASE, estado: "devuelta", causaDevolucion };
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
}

function buildService(f: Partial<Fakes> = {}) {
  const datos = f.datos === undefined ? DATOS_BASE : f.datos;
  const subPorOwner = f.subPorOwner ?? { "owner-A": { url: "https://a.example.com/hook", secret: SECRET_ENC } };
  const outcome = f.outcome ?? { status: "ok" };

  const ordenes: IWebhookOrdenReader = { findDatosEntrega: vi.fn(async () => datos) };
  const suscripciones = {
    findActivaByOwner: vi.fn(async (owner: string) => subPorOwner[owner] ?? null),
  } as unknown as IWebhookSuscripcionRepository;
  const entregar = vi.fn(async () => outcome);
  const sender: IWebhookSender = { entregar };
  const logs: string[] = [];
  const logger = { warn: (m: string) => logs.push(m) };
  const now = () => new Date("2026-07-21T10:00:05.000Z");

  const service = new WebhookEstadoService(ordenes, suscripciones, sender, config, now, logger);
  return { service, entregar, logs, ordenes, suscripciones };
}

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
    expect(Object.keys(body.data)).toEqual(["numGuia", "numRemision", "estado", "motivo"]);
    expect(body.data).toEqual({
      numGuia: 12345,
      numRemision: NUM_REMISION,
      estado: "en_reparto",
      motivo: null,
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

  it("256/R7: `data` tiene EXACTAMENTE las cuatro claves, en orden, tambien en un evento de devolucion", async () => {
    const { service, entregar } = buildService({ datos: datosDevuelta("wrong_number") });
    await service.ejecutar(jobDevuelta());
    const body = JSON.parse(cuerpoDe(entregar));
    expect(Object.keys(body.data)).toEqual(["numGuia", "numRemision", "estado", "motivo"]);
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

describe("256/R17 — el conjunto de transiciones que emiten evento NO cambia", () => {
  it("256/R17: esta feature no anade ni quita eventos publicos ni familias exceptuadas", async () => {
    // Congelado por TAMANO aqui (el congelador por IGUALDAD vive en
    // `tests/unit/types/webhook-eventos.test.ts`, que esta feature NO edita). Anadir o quitar un
    // estado publico, o ensanchar la lista de exclusion, pone rojos los dos.
    expect(EVENTOS_PUBLICOS.size).toBe(10);
    expect(ORIGENES_SIN_EVENTO_PUBLICO.length).toBe(1);
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
