import { describe, expect, it, vi } from "vitest";
import type { JobDTO } from "@/lib/interfaces/repositories/IJobRepository";
import { crearWhatsappEnvioProgramadoHandler } from "@/lib/services/jobs/whatsapp-envio-programado-handler";
import { crearWhatsappEnvioEventoHandler } from "@/lib/services/jobs/whatsapp-envio-evento-handler";
import { crearWhatsappEnvioEjecucionHandler } from "@/lib/services/jobs/whatsapp-envio-ejecucion-handler";
import { crearWhatsappEnvioReintentoHandler } from "@/lib/services/jobs/whatsapp-envio-reintento-handler";
import { crearWhatsappEnvioMantenimientoHandler } from "@/lib/services/jobs/whatsapp-envio-mantenimiento-handler";
import { envio } from "../_dobles-envios-474";

// Ficha 474 (T8.1) — handlers de la cola: programado (R19-R22, R24), evento (R19/R27), ejecucion,
// reintento (R36) y mantenimiento (R25/R44).

function job(payload: Record<string, unknown>, o: Partial<JobDTO> = {}): JobDTO {
  return {
    id: "j1",
    tipo: "whatsapp_envio_programado",
    payload,
    estado: "processing",
    intentos: 1,
    maxIntentos: 3,
    runAfter: new Date(),
    lockedAt: null,
    lastError: null,
    dedupeKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...o,
  };
}

// lunes 2026-10-05, 05:00 CR = 11:00 UTC
const PAYLOAD = { envioId: "env-1", fechaCr: "2026-10-05", hora: "05:00" };

function programado(o: { envio?: ReturnType<typeof envio> | null; ahora?: Date } = {}) {
  const obtener = vi.fn(async () => (o.envio === undefined ? envio({ encendido: true }) : o.envio));
  const insertarProgramada = vi.fn(async () => ({ id: "ej-1", creada: true }));
  const enqueue = vi.fn(async () => null);
  const ejecutar = vi.fn(async () => ({ estado: "completada" as const, motivo: null, entregas: [] }));
  const h = crearWhatsappEnvioProgramadoHandler(() => ({
    envios: { obtener },
    ejecuciones: { insertarProgramada },
    cola: { enqueue },
    ejecutor: { ejecutar },
    now: () => o.ahora ?? new Date("2026-10-05T11:00:30.000Z"),
    ventanaMin: () => 60,
  }));
  return { h, obtener, insertarProgramada, enqueue, ejecutar };
}

describe("474 — handler programado", () => {
  it("R22/R23: encola la SIGUIENTE ocurrencia antes, inserta la ejecucion del dia y la ejecuta", async () => {
    const m = programado();
    await m.h(job(PAYLOAD));
    expect(m.enqueue).toHaveBeenCalledWith(
      "whatsapp_envio_programado",
      { envioId: "env-1", fechaCr: "2026-10-06", hora: "05:00" },
      expect.objectContaining({ dedupeKey: "wa_envio:env-1:2026-10-06:05:00" }),
    );
    expect(m.insertarProgramada).toHaveBeenCalledWith({
      envioId: "env-1",
      fechaCr: "2026-10-05",
      instanteProgramado: new Date("2026-10-05T11:00:00.000Z"),
    });
    expect(m.ejecutar).toHaveBeenCalledWith("ej-1");
    expect(m.enqueue.mock.invocationCallOrder[0]).toBeLessThan(m.ejecutar.mock.invocationCallOrder[0]);
  });

  it("R19: envio APAGADO -> nada (ni ejecucion ni cadena)", async () => {
    const m = programado({ envio: envio({ encendido: false }) });
    await m.h(job(PAYLOAD));
    expect(m.insertarProgramada).not.toHaveBeenCalled();
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it("R21: envio BORRADO o inexistente -> nada", async () => {
    for (const e of [envio({ encendido: true, deletedAt: new Date() }), null]) {
      const m = programado({ envio: e });
      await m.h(job(PAYLOAD));
      expect(m.ejecutar).not.toHaveBeenCalled();
    }
  });

  it("R20: job OBSOLETO (la hora se edito a 06:00) -> no ejecuta; la cadena sigue con la hora nueva", async () => {
    const m = programado({ envio: envio({ encendido: true, hora: "06:00" }) });
    await m.h(job(PAYLOAD));
    expect(m.ejecutar).not.toHaveBeenCalled();
    expect(m.enqueue).toHaveBeenCalledWith(
      "whatsapp_envio_programado",
      { envioId: "env-1", fechaCr: "2026-10-05", hora: "06:00" }, // hoy 06:00 aun no paso
      expect.anything(),
    );
  });

  it("R20: dia quitado de la programacion -> obsoleto", async () => {
    const m = programado({ envio: envio({ encendido: true, diasSemana: [2, 3] }) });
    await m.h(job(PAYLOAD));
    expect(m.ejecutar).not.toHaveBeenCalled();
  });

  it("⭑ R24: arranca 61 min tarde -> ejecucion OMITIDA con el retraso, sin ejecutar", async () => {
    const m = programado({ ahora: new Date("2026-10-05T12:01:00.000Z") });
    await m.h(job(PAYLOAD));
    expect(m.insertarProgramada).toHaveBeenCalledWith({
      envioId: "env-1",
      fechaCr: "2026-10-05",
      instanteProgramado: new Date("2026-10-05T11:00:00.000Z"),
      estado: "omitida",
      motivo: "La cola arrancó 61 min tarde (tolerancia 60 min).",
    });
    expect(m.ejecutar).not.toHaveBeenCalled();
    expect(m.enqueue).toHaveBeenCalled(); // la cadena no se rompe
  });

  it("R24: 59 min tarde todavia se ejecuta", async () => {
    const m = programado({ ahora: new Date("2026-10-05T11:59:00.000Z") });
    await m.h(job(PAYLOAD));
    expect(m.ejecutar).toHaveBeenCalled();
  });

  it("payload invalido -> lanza (no se traga en silencio)", async () => {
    await expect(programado().h(job({ envioId: "x" }))).rejects.toThrow();
  });
});

describe("474 — handler evento", () => {
  function evento(ids: string[], creadas: boolean[]) {
    const insertarEvento = vi.fn();
    creadas.forEach((c, i) => insertarEvento.mockResolvedValueOnce({ id: `ej-${i}`, creada: c }));
    const enqueue = vi.fn(async () => null);
    const encendidosConEvento = vi.fn(async () => ids);
    const h = crearWhatsappEnvioEventoHandler(() => ({ envios: { encendidosConEvento }, ejecuciones: { insertarEvento }, cola: { enqueue } }));
    return { h, insertarEvento, enqueue, encendidosConEvento };
  }
  const payload = {
    evento: "geocodificacion_caida",
    referencia: "2026-10-05",
    notificacionId: "n1",
    datos: { texto: "t", rolFila: "maestro", creadoAt: "2026-10-05T11:00:00.000Z" },
  };

  it("R27: una ejecucion por envio encendido; encola SOLO las recien creadas", async () => {
    const m = evento(["e1", "e2"], [true, false]);
    await m.h(job(payload, { tipo: "whatsapp_envio_evento" }));
    expect(m.encendidosConEvento).toHaveBeenCalledWith("geocodificacion_caida");
    expect(m.insertarEvento).toHaveBeenCalledTimes(2);
    expect(m.enqueue).toHaveBeenCalledTimes(1);
    expect(m.enqueue).toHaveBeenCalledWith("whatsapp_envio_ejecucion", { ejecucionId: "ej-0" }, {
      dedupeKey: "wa_envio_ejecucion:ej-0",
      maxIntentos: 3,
    });
  });

  it("R19: apagado entre el aviso y el drenado -> no aparece en encendidos -> ninguna ejecucion", async () => {
    const m = evento([], []);
    await m.h(job(payload, { tipo: "whatsapp_envio_evento" }));
    expect(m.insertarEvento).not.toHaveBeenCalled();
  });
});

describe("474 — handlers delgados", () => {
  it("ejecucion delega en ejecutar(ejecucionId)", async () => {
    const ejecutar = vi.fn(async () => ({ estado: "completada" as const, motivo: null, entregas: [] }));
    await crearWhatsappEnvioEjecucionHandler(() => ({ ejecutar }))(job({ ejecucionId: "ej-9" }));
    expect(ejecutar).toHaveBeenCalledWith("ej-9");
  });

  it("R36: reintento pasa intentos y maxIntentos del job", async () => {
    const reintentar = vi.fn(async () => {});
    await crearWhatsappEnvioReintentoHandler(() => ({ reintentar }))(job({ entregaId: "ent-1" }, { intentos: 4, maxIntentos: 5 }));
    expect(reintentar).toHaveBeenCalledWith("ent-1", { intentos: 4, maxIntentos: 5 });
  });
});

describe("474/R25/R44 — mantenimiento", () => {
  function mant(o: { rotos?: { id: string; diasSemana: number[]; hora: string }[]; caducados?: { id: string; pdfRuta: string }[]; borrarLanza?: boolean } = {}) {
    const enqueue = vi.fn(async () => null);
    const borrar = vi.fn(async () => {
      if (o.borrarLanza) throw new Error("storage");
    });
    const marcarPurgadas = vi.fn(async () => {});
    const h = crearWhatsappEnvioMantenimientoHandler(() => ({
      envios: { encendidosHoraFijaSinJobPendiente: vi.fn(async () => o.rotos ?? []) },
      ejecuciones: { seleccionarPurga: vi.fn(async () => o.caducados ?? []), marcarPurgadas },
      almacen: { borrar },
      cola: { enqueue },
      now: () => new Date("2026-10-05T09:30:00.000Z"),
      logger: { info: () => {} },
    }));
    return { h, enqueue, borrar, marcarPurgadas };
  }

  it("R25: re-siembra la proxima ocurrencia de cada envio con la cadena rota", async () => {
    const m = mant({ rotos: [{ id: "e1", diasSemana: [1], hora: "05:00" }] });
    await m.h(job({}, { tipo: "whatsapp_envio_mantenimiento" }));
    expect(m.enqueue).toHaveBeenCalledWith(
      "whatsapp_envio_programado",
      { envioId: "e1", fechaCr: "2026-10-05", hora: "05:00" },
      expect.objectContaining({ dedupeKey: "wa_envio:e1:2026-10-05:05:00" }),
    );
  });

  it("R44: borra los objetos y marca purgadas", async () => {
    const m = mant({ caducados: [{ id: "x1", pdfRuta: "e/x1.pdf" }, { id: "x2", pdfRuta: "e/x2.pdf" }] });
    await m.h(job({}, { tipo: "whatsapp_envio_mantenimiento" }));
    expect(m.borrar).toHaveBeenCalledWith(["e/x1.pdf", "e/x2.pdf"]);
    expect(m.marcarPurgadas).toHaveBeenCalledWith(["x1", "x2"], new Date("2026-10-05T09:30:00.000Z"));
  });

  it("R44: si Storage falla, NO marca como purgadas y lanza (la cola lo registra)", async () => {
    const m = mant({ caducados: [{ id: "x1", pdfRuta: "e/x1.pdf" }], borrarLanza: true });
    await expect(m.h(job({}, { tipo: "whatsapp_envio_mantenimiento" }))).rejects.toThrow("storage");
    expect(m.marcarPurgadas).not.toHaveBeenCalled();
  });
});
