import { describe, expect, it, vi } from "vitest";
import { WhatsappEnvioService, MSG } from "@/lib/services/WhatsappEnvioService";
import type { GuardarEnvioInput } from "@/lib/types/envios-whatsapp";
import type { Actor } from "@/lib/interfaces/services/IWhatsappEnvioService";
import { MAESTRO, destinatario, envio, enviosRepo, plantilla } from "./_dobles-envios-474";

// Ficha 474 (T7.1) — `WhatsappEnvioService`: R1, R11-R16 (R14 y R16 enmendados), R18, R15, R20,
// R21 y la proxima ejecucion de R25.

const AHORA = new Date("2026-10-05T10:00:00.000Z"); // lunes 04:00 CR

function input(o: Partial<GuardarEnvioInput> = {}): GuardarEnvioInput {
  return {
    nombre: "Informe 05:00",
    informeClave: "prueba_envio",
    plantillaId: "pl-1",
    parametros: { simularVacio: false },
    disparo: "hora_fija",
    diasSemana: [1, 2, 3, 4, 5],
    hora: "05:00",
    eventoClave: null,
    destinatarios: { roles: ["admin"], usuarioIds: [] },
    ...o,
  };
}

function montar(o: { envios?: ReturnType<typeof enviosRepo>; plantilla?: ReturnType<typeof plantilla> | null } = {}) {
  const envios = o.envios ?? enviosRepo();
  const plantillas = { findEnviableDeInformeById: vi.fn(async () => (o.plantilla === undefined ? plantilla() : o.plantilla)) };
  const cola = { enqueue: vi.fn(async () => null) };
  const ejecuciones = { ultimaPorEnvio: vi.fn(async () => new Map()) };
  const s = new WhatsappEnvioService({ envios, plantillas, cola, ejecuciones, now: () => AHORA });
  return { s, envios, plantillas, cola };
}

describe("474/R1 — solo maestro", () => {
  for (const actor of [
    { usuarioId: "a", rol: "admin" },
    { usuarioId: "b", rol: "mensajero" },
    { usuarioId: "c", rol: "adminTienda" },
  ] as Actor[]) {
    it(`${actor.rol}: forbidden en TODO sin tocar el repositorio`, async () => {
      const { s, envios, cola } = montar();
      const salidas = [
        await s.listar(actor),
        await s.obtener("env-1", actor),
        await s.crear(input(), actor),
        await s.actualizar("env-1", input(), actor),
        await s.encender("env-1", actor),
        await s.apagar("env-1", actor),
        await s.reprogramar("env-1", actor),
        await s.borrar("env-1", actor),
        await s.previsualizarDestinatarios({ roles: ["admin"], usuarioIds: [] }, actor),
        s.listarEventosDisponibles(actor),
        s.listarInformes(actor),
      ];
      for (const r of salidas) expect(r).toEqual({ status: "forbidden" });
      for (const fn of Object.values(envios)) {
        if (typeof fn === "function" && "mock" in fn) expect(fn).not.toHaveBeenCalled();
      }
      expect(cola.enqueue).not.toHaveBeenCalled();
    });
  }
});

describe("474/R11/R15 — crear", () => {
  it("valido: crea APAGADO (el repo no recibe `encendido`) y no encola nada", async () => {
    const { s, envios, cola } = montar();
    const r = await s.crear(input(), MAESTRO);
    expect(r.status).toBe("ok");
    const datos = envios.crear.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect("encendido" in datos).toBe(false);
    expect(datos.actorId).toBe("m1");
    expect(cola.enqueue).not.toHaveBeenCalled();
  });

  it("R13: precarga los defaults del informe si no llegan parametros", async () => {
    const { s, envios } = montar();
    await s.crear(input({ parametros: {} }), MAESTRO);
    expect((envios.crear.mock.calls[0][0] as unknown as { parametros: unknown }).parametros).toEqual({ simularVacio: false });
  });

  it("R11: nombre duplicado -> conflict nombre", async () => {
    const { EnvioNombreDuplicadoError } = await import("@/lib/interfaces/repositories/IWhatsappEnvioRepository");
    const envios = enviosRepo({ crear: vi.fn(async () => { throw new EnvioNombreDuplicadoError(); }) });
    const { s } = montar({ envios });
    expect(await s.crear(input(), MAESTRO)).toEqual({ status: "conflict", campo: "nombre" });
  });

  it("R11: hora fija sin dias ni hora -> un error por campo", async () => {
    const { s } = montar();
    const r = await s.crear(input({ diasSemana: [], hora: null }), MAESTRO);
    expect(r).toEqual({ status: "validation_error", fieldErrors: { diasSemana: [MSG.dias], hora: [MSG.hora] } });
  });
});

describe("474/R12 — plantilla incompatible", () => {
  it("no vigente/activa/con template o de otro informe -> error en plantillaId", async () => {
    const { s, plantillas } = montar({ plantilla: null });
    const r = await s.crear(input(), MAESTRO);
    expect(r).toEqual({ status: "validation_error", fieldErrors: { plantillaId: [MSG.plantilla] } });
    expect(plantillas.findEnviableDeInformeById).toHaveBeenCalledWith("pl-1", "prueba_envio");
  });
});

describe("474/R13 — parametros contra el esquema del informe", () => {
  it("un error por campo invalido", async () => {
    const { s } = montar();
    const r = await s.crear(input({ parametros: { simularVacio: "si", extra: 1 } }), MAESTRO);
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error();
    expect(Object.keys(r.fieldErrors).sort()).toEqual(["parametros", "parametros.simularVacio"]);
  });
});

describe("474/R14 — evento", () => {
  const base = { informeClave: "aviso_interno", disparo: "evento" as const, diasSemana: [], hora: null, parametros: {} };
  it("evento NO disponible -> error en eventoClave", async () => {
    const { s } = montar({ plantilla: plantilla({ informeClave: "aviso_interno" }) });
    const r = await s.crear(input({ ...base, eventoClave: "orden_rechazada" }), MAESTRO);
    expect(r).toEqual({ status: "validation_error", fieldErrors: { eventoClave: [MSG.evento] } });
  });

  it("evento disponible pero que el informe NO ofrece -> error", async () => {
    const { s } = montar();
    const r = await s.crear(
      input({ informeClave: "prueba_envio", disparo: "evento", diasSemana: [], hora: null, eventoClave: "geocodificacion_caida" }),
      MAESTRO,
    );
    expect(r).toEqual({ status: "validation_error", fieldErrors: { eventoClave: [MSG.evento] } });
  });

  it("aviso_interno + evento disponible -> ok, sin dias ni hora guardados", async () => {
    const { s, envios } = montar({ plantilla: plantilla({ informeClave: "aviso_interno" }) });
    const r = await s.crear(input({ ...base, eventoClave: "geocodificacion_caida", parametros: {} }), MAESTRO);
    expect(r.status).toBe("ok");
    expect(envios.crear.mock.calls[0][0]).toMatchObject({ diasSemana: [], hora: null, eventoClave: "geocodificacion_caida" });
  });

  it("aviso_interno a hora fija -> error (solo funciona por evento)", async () => {
    const { s } = montar({ plantilla: plantilla({ informeClave: "aviso_interno" }) });
    const r = await s.crear(input({ informeClave: "aviso_interno", parametros: {} }), MAESTRO);
    expect(r).toEqual({ status: "validation_error", fieldErrors: { disparo: [MSG.soloPorEvento] } });
  });
});

describe("474/R16 — destinatarios", () => {
  it("adminTienda ES un rol permitido (prueba_envio es apto)", async () => {
    const { s } = montar();
    expect((await s.crear(input({ destinatarios: { roles: ["adminTienda"], usuarioIds: [] } }), MAESTRO)).status).toBe("ok");
  });

  it("apiKey -> rechazo", async () => {
    const { s } = montar();
    const r = await s.crear(input({ destinatarios: { roles: ["apiKey"], usuarioIds: [] } }), MAESTRO);
    expect(r.status).toBe("validation_error");
  });

  it("un usuario con rol no permitido (o inexistente) -> rechazo", async () => {
    const envios = enviosRepo({ rolesDeUsuarios: vi.fn(async () => [{ id: "k", rol: "apiKey" }]) });
    const { s } = montar({ envios });
    const r = await s.crear(input({ destinatarios: { roles: [], usuarioIds: ["k", "fantasma"] } }), MAESTRO);
    expect(r).toEqual({
      status: "validation_error",
      fieldErrors: { destinatarios: [MSG.usuarioNoPermitido, MSG.usuarioNoPermitido] },
    });
  });

  it("mas de 50 resueltos -> rechazo", async () => {
    const muchos = Array.from({ length: 51 }, (_, i) => destinatario({ usuarioId: `u${i}` }));
    const envios = enviosRepo({ resolverDestinatariosDe: vi.fn(async () => muchos) });
    const { s } = montar({ envios });
    expect(await s.crear(input(), MAESTRO)).toEqual({ status: "validation_error", fieldErrors: { destinatarios: [MSG.tope] } });
  });

  it("⭑ enmienda del leader: informe NO apto (aviso_interno) + adminTienda -> rechazo", async () => {
    const { s } = montar({ plantilla: plantilla({ informeClave: "aviso_interno" }) });
    const r = await s.crear(
      input({
        informeClave: "aviso_interno",
        parametros: {},
        disparo: "evento",
        diasSemana: [],
        hora: null,
        eventoClave: "geocodificacion_caida",
        destinatarios: { roles: ["maestro", "adminTienda"], usuarioIds: [] },
      }),
      MAESTRO,
    );
    expect(r).toEqual({ status: "validation_error", fieldErrors: { destinatarios: [MSG.adminTienda] } });
  });

  it("enmienda: tambien si el adminTienda viene como USUARIO elegido", async () => {
    const envios = enviosRepo({ rolesDeUsuarios: vi.fn(async () => [{ id: "t1", rol: "adminTienda" }]) });
    const { s } = montar({ envios, plantilla: plantilla({ informeClave: "aviso_interno" }) });
    const r = await s.crear(
      input({
        informeClave: "aviso_interno",
        parametros: {},
        disparo: "evento",
        diasSemana: [],
        hora: null,
        eventoClave: "geocodificacion_caida",
        destinatarios: { roles: [], usuarioIds: ["t1"] },
      }),
      MAESTRO,
    );
    expect(r).toEqual({ status: "validation_error", fieldErrors: { destinatarios: [MSG.adminTienda] } });
  });

  it("sin ningun destinatario -> rechazo", async () => {
    const envios = enviosRepo({ resolverDestinatariosDe: vi.fn(async () => []) });
    const { s } = montar({ envios });
    const r = await s.crear(input({ destinatarios: { roles: [], usuarioIds: [] } }), MAESTRO);
    expect(r).toEqual({ status: "validation_error", fieldErrors: { destinatarios: [MSG.sinDestinatarios] } });
  });
});

describe("474/R18 — encender", () => {
  it("ok: enciende y encola la proxima ocurrencia (R22) con su dedupe", async () => {
    const { s, envios, cola } = montar();
    const r = await s.encender("env-1", MAESTRO);
    expect(r.status).toBe("ok");
    expect(envios.cambiarEncendido).toHaveBeenCalledWith("env-1", true, "m1");
    expect(cola.enqueue).toHaveBeenCalledWith(
      "whatsapp_envio_programado",
      { envioId: "env-1", fechaCr: "2026-10-05", hora: "05:00" },
      { runAfter: new Date("2026-10-05T11:00:00.000Z"), dedupeKey: "wa_envio:env-1:2026-10-05:05:00", maxIntentos: 3 },
    );
  });

  it("plantilla ya no compatible -> no_encendible con motivo y SIN encender", async () => {
    const { s, envios } = montar({ plantilla: null });
    const r = await s.encender("env-1", MAESTRO);
    expect(r).toEqual({ status: "no_encendible", motivos: [`plantillaId: ${MSG.plantilla}`] });
    expect(envios.cambiarEncendido).not.toHaveBeenCalled();
  });

  it("parametros guardados invalidos -> no_encendible", async () => {
    const envios = enviosRepo({ obtener: vi.fn(async () => envio({ parametros: { simularVacio: 3 } })) });
    const { s } = montar({ envios });
    const r = await s.encender("env-1", MAESTRO);
    expect(r.status).toBe("no_encendible");
  });

  it("ningun destinatario activo con telefono valido -> no_encendible", async () => {
    const envios = enviosRepo({ resolverDestinatarios: vi.fn(async () => [destinatario({ telefono: "123" })]) });
    const { s } = montar({ envios });
    expect(await s.encender("env-1", MAESTRO)).toEqual({ status: "no_encendible", motivos: [MSG.noEncendibleSinTelefono] });
  });
});

describe("474/R19/R20/R21", () => {
  it("R20: editar un envio ENCENDIDO encola la nueva hora desde ahora (lo pasado no se recupera)", async () => {
    const envios = enviosRepo({
      obtener: vi.fn(async () => envio({ encendido: true })),
      actualizar: vi.fn(async () => envio({ encendido: true, hora: "03:00" })),
    });
    const { s, cola } = montar({ envios });
    await s.actualizar("env-1", input({ hora: "03:00" }), MAESTRO);
    // lunes 04:00 CR: las 03:00 de hoy ya pasaron -> martes 6
    expect(cola.enqueue).toHaveBeenCalledWith(
      "whatsapp_envio_programado",
      { envioId: "env-1", fechaCr: "2026-10-06", hora: "03:00" },
      expect.objectContaining({ dedupeKey: "wa_envio:env-1:2026-10-06:03:00" }),
    );
  });

  it("editar uno APAGADO no encola", async () => {
    const { s, cola } = montar();
    await s.actualizar("env-1", input(), MAESTRO);
    expect(cola.enqueue).not.toHaveBeenCalled();
  });

  it("R19: apagar llama al repo con false", async () => {
    const { s, envios } = montar();
    await s.apagar("env-1", MAESTRO);
    expect(envios.cambiarEncendido).toHaveBeenCalledWith("env-1", false, "m1");
  });

  it("R21: borrar delega en el soft delete", async () => {
    const { s, envios } = montar();
    expect(await s.borrar("env-1", MAESTRO)).toEqual({ status: "ok" });
    expect(envios.borrar).toHaveBeenCalledWith("env-1", "m1");
  });
});

describe("474/R25 — proxima ejecucion en la lista", () => {
  it("encendido con job vigente -> proxima; job obsoleto (otra hora) no cuenta -> aviso", async () => {
    const vigente = { envioId: "env-1", fechaCr: "2026-10-06", hora: "05:00", runAfter: new Date("2026-10-06T11:00:00Z") };
    const obsoleto = { envioId: "env-1", fechaCr: "2026-10-05", hora: "04:30", runAfter: new Date("2026-10-05T10:30:00Z") };
    const conVigente = enviosRepo({
      listar: vi.fn(async () => [envio({ encendido: true })]),
      jobsProgramadosPendientes: vi.fn(async () => [obsoleto, vigente]),
    });
    const r1 = await montar({ envios: conVigente }).s.listar(MAESTRO);
    expect(r1.status === "ok" && r1.items[0]).toMatchObject({ proximaEjecucion: vigente.runAfter, avisoSinProxima: false });

    const soloObsoleto = enviosRepo({
      listar: vi.fn(async () => [envio({ encendido: true })]),
      jobsProgramadosPendientes: vi.fn(async () => [obsoleto]),
    });
    const r2 = await montar({ envios: soloObsoleto }).s.listar(MAESTRO);
    expect(r2.status === "ok" && r2.items[0]).toMatchObject({ proximaEjecucion: null, avisoSinProxima: true });
  });

  it("apagado: sin aviso", async () => {
    const r = await montar().s.listar(MAESTRO);
    expect(r.status === "ok" && r.items[0].avisoSinProxima).toBe(false);
  });

  it("R49: los eventos de la lista llevan su nombre", async () => {
    const envios = enviosRepo({
      listar: vi.fn(async () => [envio({ disparo: "evento", eventoClave: "cierre_dia_por_aprobar", diasSemana: [], hora: null })]),
    });
    const r = await montar({ envios }).s.listar(MAESTRO);
    expect(r.status === "ok" && r.items[0].eventoNombre).toBe("Cierre del día por aprobar");
  });
});
