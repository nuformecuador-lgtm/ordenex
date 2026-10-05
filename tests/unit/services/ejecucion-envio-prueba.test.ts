import { describe, expect, it, vi } from "vitest";
import { EjecucionEnvioService, type MetaEnvios } from "@/lib/services/EjecucionEnvioService";
import { textoGeocodificacionCaida } from "@/lib/notificaciones/emitir";
import { MAESTRO, destinatario, ejecucionesRepo, envio, enviosRepo, plantilla } from "./_dobles-envios-474";

// Ficha 474 (T7.2, R39-R41/R52) — «Probar ahora».

const AHORA = new Date("2026-10-05T18:00:00.000Z"); // 12:00 CR

function montar(o: { envio?: ReturnType<typeof envio> | null; telefono?: string; ultima?: Date | null; plantilla?: ReturnType<typeof plantilla> } = {}) {
  const resolverDestinatarios = vi.fn(async () => [destinatario({ usuarioId: "otro" })]);
  const envios = enviosRepo({
    obtener: vi.fn(async () => (o.envio === undefined ? envio({ encendido: false }) : o.envio)),
    contactoDeUsuario: vi.fn(async () => ({ id: "m1", nombre: "Carlos", telefono: o.telefono ?? "88881111" })),
    resolverDestinatarios,
  });
  const ej = ejecucionesRepo();
  ej.repo.ultimaPruebaDe.mockResolvedValue(o.ultima ?? null);
  const enviarPlantilla = vi.fn(async (_d: string, _n: string, _i: string, _c?: unknown[]) => ({ status: "ok" as const, mensajeId: "wamid.p" }));
  const m: MetaEnvios = { enviador: { enviarPlantilla }, subidor: { subir: vi.fn() }, idioma: "es" };
  const s = new EjecucionEnvioService({
    envios,
    ejecuciones: ej.repo,
    plantillas: { findEnviableDeInformeById: vi.fn(async () => o.plantilla ?? plantilla()) },
    almacen: { guardar: vi.fn(async () => ({ ruta: "r" })), leer: vi.fn(), firmar: vi.fn(), borrar: vi.fn() },
    cola: { enqueue: vi.fn() },
    meta: () => m,
    now: () => AHORA,
  });
  return { s, envios, ej, enviarPlantilla, resolverDestinatarios };
}

describe("474/R39 — solo a quien pulsa, encendido o apagado, en la misma respuesta", () => {
  it("envio APAGADO: se prueba igual, solo hacia el maestro, y se registra como prueba", async () => {
    const { s, ej, enviarPlantilla, resolverDestinatarios } = montar();
    const r = await s.probar("env-1", MAESTRO);
    expect(r).toEqual({
      status: "ok",
      ejecucionId: "ej-prueba",
      estado: "completada",
      motivo: null,
      entrega: { estado: "aceptada", motivo: null },
    });
    expect(ej.repo.insertarPrueba).toHaveBeenCalledWith({ envioId: "env-1", solicitadaPor: "m1" });
    expect(resolverDestinatarios).not.toHaveBeenCalled(); // NO va a los destinatarios configurados
    expect(enviarPlantilla).toHaveBeenCalledTimes(1);
    expect(enviarPlantilla.mock.calls[0][0]).toBe("50688881111");
    // R53: en la prueba, el nombre es el de quien pulsa.
    const comps = enviarPlantilla.mock.calls[0][3] as unknown as { parameters: { text: string }[] }[];
    expect(comps[0].parameters[0].text).toBe("Carlos");
  });

  it("R1: no maestro -> forbidden sin leer nada", async () => {
    const { s, envios } = montar();
    expect(await s.probar("env-1", { usuarioId: "a", rol: "admin" })).toEqual({ status: "forbidden" });
    expect(envios.obtener).not.toHaveBeenCalled();
  });

  it("envio inexistente o borrado -> not_found", async () => {
    const { s } = montar({ envio: null });
    expect(await s.probar("env-x", MAESTRO)).toEqual({ status: "not_found" });
  });
});

describe("474/R40 — telefono de quien pulsa", () => {
  it("invalido -> telefono_invalido, sin crear ejecucion ni enviar", async () => {
    const { s, ej, enviarPlantilla } = montar({ telefono: "123" });
    const r = await s.probar("env-1", MAESTRO);
    expect(r.status).toBe("telefono_invalido");
    expect(ej.repo.insertarPrueba).not.toHaveBeenCalled();
    expect(enviarPlantilla).not.toHaveBeenCalled();
  });
});

describe("474/R41 — ventana de 30 s", () => {
  it("prueba anterior hace 10 s -> demasiado_pronto con los segundos restantes, sin enviar", async () => {
    const { s, ej, enviarPlantilla } = montar({ ultima: new Date(AHORA.getTime() - 10_000) });
    expect(await s.probar("env-1", MAESTRO)).toEqual({ status: "demasiado_pronto", segundosRestantes: 20 });
    expect(ej.repo.insertarPrueba).not.toHaveBeenCalled();
    expect(enviarPlantilla).not.toHaveBeenCalled();
  });

  it("hace 31 s -> se prueba", async () => {
    const { s } = montar({ ultima: new Date(AHORA.getTime() - 31_000) });
    expect((await s.probar("env-1", MAESTRO)).status).toBe("ok");
  });
});

describe("474/R52 — prueba de un envio POR EVENTO", () => {
  it("titulo y texto del ejemplo del catalogo; fecha y hora del momento", async () => {
    const { s, enviarPlantilla } = montar({
      envio: envio({ informeClave: "aviso_interno", parametros: {}, disparo: "evento", eventoClave: "geocodificacion_caida", diasSemana: [], hora: null }),
      plantilla: plantilla({ informeClave: "aviso_interno", variables: ["titulo", "texto", "fecha", "hora"] }),
    });
    await s.probar("env-1", MAESTRO);
    const comps = enviarPlantilla.mock.calls[0][3] as unknown as { parameters: { text: string }[] }[];
    expect(comps[0].parameters.map((p) => p.text)).toEqual([
      "El servicio de mapas rechaza las peticiones",
      textoGeocodificacionCaida(3),
      "05/10/2026",
      "12:00",
    ]);
  });
});
