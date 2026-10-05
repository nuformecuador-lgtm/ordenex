import { describe, it, expect, vi } from "vitest";
import {
  borrarEnvio,
  crearEnvio,
  firmarPdfEjecucion,
  listarEjecuciones,
  listarEventosDisponibles,
  obtenerEjecucion,
  probarEnvioWhatsapp,
} from "@/lib/actions/envios-whatsapp";
import type { IWhatsappEnvioService } from "@/lib/interfaces/services/IWhatsappEnvioService";
import { WhatsappEnvioService } from "@/lib/services/WhatsappEnvioService";
import { enviosRepo, MAESTRO } from "../services/_dobles-envios-474";

// Ficha 474 (T9.1) — el BORDE de las server actions: no autenticado antes de todo, zod en el borde,
// forbidden para no-maestro (R1) sin tocar nada, R43/R44 (PDF firmado o caducado), R49 (eventos).

const ADMIN = { usuarioId: "a", rol: "admin" as const };

function servicioReal() {
  const envios = enviosRepo();
  const configuracion: IWhatsappEnvioService = new WhatsappEnvioService({
    envios,
    plantillas: { findEnviableDeInformeById: vi.fn() },
    cola: { enqueue: vi.fn() },
    ejecuciones: { ultimaPorEnvio: vi.fn(async () => new Map()) },
  });
  return { configuracion, envios };
}

describe("474/R1 — el borde", () => {
  it("sin sesion -> unauthenticated antes de validar o tocar el service", async () => {
    const { configuracion, envios } = servicioReal();
    expect(await crearEnvio({ basura: true }, { getActor: async () => null, configuracion })).toEqual({ status: "unauthenticated" });
    expect(envios.crear).not.toHaveBeenCalled();
  });

  it("entrada invalida -> validation_error (zod)", async () => {
    const { configuracion } = servicioReal();
    const r = await crearEnvio({ nombre: "" }, { getActor: async () => MAESTRO, configuracion });
    expect(r.status).toBe("validation_error");
  });

  it("admin -> forbidden sin escribir", async () => {
    const { configuracion, envios } = servicioReal();
    const r = await borrarEnvio("env-1", { getActor: async () => ADMIN, configuracion });
    expect(r).toEqual({ status: "forbidden" });
    expect(envios.borrar).not.toHaveBeenCalled();
  });

  it("historial y detalle: admin -> forbidden sin leer", async () => {
    const historial = vi.fn();
    const detalle = vi.fn();
    const deps = { getActor: async () => ADMIN, ejecuciones: { historial, detalle, pdfDe: vi.fn() } };
    expect(await listarEjecuciones({}, deps)).toEqual({ status: "forbidden" });
    expect(await obtenerEjecucion("ej-1", deps)).toEqual({ status: "forbidden" });
    expect(historial).not.toHaveBeenCalled();
    expect(detalle).not.toHaveBeenCalled();
  });
});

describe("474/R49 — eventos disponibles", () => {
  it("devuelve los diez con su nombre", async () => {
    const { configuracion } = servicioReal();
    const r = await listarEventosDisponibles({ getActor: async () => MAESTRO, configuracion });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") throw new Error();
    expect(r.eventos).toHaveLength(10);
    expect(r.eventos.find((e) => e.clave === "geocodificacion_caida")?.nombre).toBe(
      "El servicio de mapas rechaza las peticiones",
    );
  });
});

describe("474/R39-R41 — probar por la action", () => {
  it("delega en el ejecutor con el actor de la sesion y devuelve su resultado", async () => {
    const probar = vi.fn(async () => ({ status: "demasiado_pronto" as const, segundosRestantes: 12 }));
    const r = await probarEnvioWhatsapp("env-1", { getActor: async () => MAESTRO, ejecutor: { probar } });
    expect(r).toEqual({ status: "demasiado_pronto", segundosRestantes: 12 });
    expect(probar).toHaveBeenCalledWith("env-1", MAESTRO);
  });

  it("id invalido -> validation_error sin llamar", async () => {
    const probar = vi.fn();
    const r = await probarEnvioWhatsapp("", { getActor: async () => MAESTRO, ejecutor: { probar } });
    expect(r.status).toBe("validation_error");
    expect(probar).not.toHaveBeenCalled();
  });
});

describe("474/R43/R44 — PDF de una ejecucion", () => {
  function deps(pdf: { ruta: string | null; purgado: boolean } | null) {
    const firmar = vi.fn(async () => "https://firmado/x?token=t");
    return {
      firmar,
      d: {
        getActor: async () => MAESTRO,
        ejecuciones: { historial: vi.fn(), detalle: vi.fn(), pdfDe: vi.fn(async () => pdf) },
        almacen: { firmar },
      },
    };
  }

  it("con PDF vigente: enlace firmado de 300 s", async () => {
    const { d, firmar } = deps({ ruta: "env/ej.pdf", purgado: false });
    expect(await firmarPdfEjecucion("ej-1", d)).toEqual({ status: "ok", url: "https://firmado/x?token=t" });
    expect(firmar).toHaveBeenCalledWith("env/ej.pdf", 300);
  });

  it("purgado -> caducado, sin firmar", async () => {
    const { d, firmar } = deps({ ruta: "env/ej.pdf", purgado: true });
    expect(await firmarPdfEjecucion("ej-1", d)).toEqual({ status: "caducado" });
    expect(firmar).not.toHaveBeenCalled();
  });

  it("sin PDF -> sin_pdf; inexistente -> not_found", async () => {
    expect(await firmarPdfEjecucion("ej-1", deps({ ruta: null, purgado: false }).d)).toEqual({ status: "sin_pdf" });
    expect(await firmarPdfEjecucion("ej-1", deps(null).d)).toEqual({ status: "not_found" });
  });

  it("R43: solo maestro", async () => {
    const { d, firmar } = deps({ ruta: "r", purgado: false });
    expect(await firmarPdfEjecucion("ej-1", { ...d, getActor: async () => ADMIN })).toEqual({ status: "forbidden" });
    expect(firmar).not.toHaveBeenCalled();
  });
});
