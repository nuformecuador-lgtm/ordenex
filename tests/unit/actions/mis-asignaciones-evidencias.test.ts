import { describe, it, expect, vi } from "vitest";
import { gestionar } from "@/lib/actions/mis-asignaciones";
import type { IMisAsignacionesService } from "@/lib/interfaces/services/IMisAsignacionesService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// ⚠️ Feature 193 (R10), decision humana del 2026-08-10: la gestion EXIGE la ubicacion del
// mensajero (o un motivo tecnico). Los FormData validos de abajo se AMPLIAN con las dos
// coordenadas —no se relajan—: lo que cada test AFIRMA sigue siendo lo mismo. La disyuncion
// ubicacion/motivo se cubre aparte, en `mis-asignaciones-ubicacion.test.ts`.

// Feature 119 (R5) — el BORDE lee las N fotos del FormData con `getAll("evidencia")` (el panel
// hace `append("evidencia", file)` por foto) y las mapea a `EvidenciaArchivo[]` en orden, que es
// el `indice` 0..N-1. El panel sin migrar (T11) manda UN solo `evidencia`: se lee como lista de 1.

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const actorMensajero = async () => MENSAJERO;

function buildService(overrides: Partial<IMisAsignacionesService> = {}): IMisAsignacionesService {
  return {
    listarMisAsignaciones: vi.fn(async () => ({
      status: "ok" as const,
      porRecoger: [],
      porGestionar: [],
    conAyuda: [], // feature 235 (R18): el tercer grupo, separado en el servidor
      ordenEnGestionId: null,
      kpis: { pendientes: 0, entregadas: 0, porCobrar: 0, totalACobrar: 0 },
      ruta: { estado: "vigente" as const, calculadaAt: null, origenFuente: null, paradasSinOptimizar: 0, trazado: null, tramoSiguiente: null },
    })),
    recogerAsignaciones: vi.fn(async () => ({ status: "ok" as const, recogidas: ["o1"] })),
    escogerParaGestion: vi.fn(async () => ({ status: "ok" as const, ordenId: "o1" })),
    gestionar: vi.fn(async () => ({ status: "ok" as const, ordenId: "o1", estado: "rechazada" })),
    liberarGestion: vi.fn(async () => ({ status: "ok" as const })),
    ...overrides,
  };
}

function imagenFile(nombre: string, tipo = "image/jpeg"): File {
  return new File([new Uint8Array([1, 2, 3, 4])], nombre, { type: tipo });
}

function inputRecibido(service: IMisAsignacionesService) {
  return (service.gestionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
}

describe("R5: getAll('evidencia') -> lista de N EvidenciaArchivo, en orden", () => {
  it("N fotos (mismo campo, N valores) -> input.evidencias con N elementos y sus bytes", async () => {
    const service = buildService();
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("ubicacionLat", "9.9281"); // feature 193/R17
    fd.set("ubicacionLng", "-84.0907");
    fd.set("resultado", "rechazada");
    fd.set("motivo", "cliente rechazo");
    fd.append("evidencia", imagenFile("a.jpg", "image/jpeg"));
    fd.append("evidencia", imagenFile("b.png", "image/png"));
    fd.append("evidencia", imagenFile("c.webp", "image/webp"));

    const r = await gestionar(fd, { service, getActor: actorMensajero });

    expect(r.status).toBe("ok");
    const input = inputRecibido(service);
    expect(input.resultado).toBe("rechazada");
    expect(input.evidencias).toHaveLength(3);
    // Cada elemento trae bytes leidos y su contentType (orden preservado -> indice 0..N-1).
    expect(input.evidencias[0].contentType).toBe("image/jpeg");
    expect(input.evidencias[1].contentType).toBe("image/png");
    expect(input.evidencias[2].contentType).toBe("image/webp");
    for (const ev of input.evidencias) expect(ev.bytes).toBeInstanceOf(Uint8Array);
  });

  it("una sola foto (panel sin migrar) -> lista de 1", async () => {
    const service = buildService();
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("ubicacionLat", "9.9281"); // feature 193/R17
    fd.set("ubicacionLng", "-84.0907");
    fd.set("resultado", "rechazada");
    fd.set("motivo", "cliente rechazo");
    fd.set("evidencia", imagenFile("a.jpg"));

    const r = await gestionar(fd, { service, getActor: actorMensajero });

    expect(r.status).toBe("ok");
    const input = inputRecibido(service);
    expect(input.evidencias).toHaveLength(1);
  });

  it("entrega con 2 fotos -> delega con montoRecibido number y las 2 evidencias", async () => {
    const service = buildService({
      gestionar: vi.fn(async () => ({ status: "ok" as const, ordenId: "o1", estado: "entregada" })),
    });
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("ubicacionLat", "9.9281"); // feature 193/R17
    fd.set("ubicacionLng", "-84.0907");
    fd.set("resultado", "entregada");
    fd.set("montoRecibido", "100");
    fd.set("metodoPago", "efectivo");
    fd.append("evidencia", imagenFile("a.jpg"));
    fd.append("evidencia", imagenFile("b.jpg"));

    const r = await gestionar(fd, { service, getActor: actorMensajero });

    expect(r.status).toBe("ok");
    const input = inputRecibido(service);
    expect(input.montoRecibido).toBe(100);
    expect(input.evidencias).toHaveLength(2);
  });
});

describe("R6/R7: el borde revalida el conteo (min 1 / max) sin invocar al service", () => {
  it("sin ninguna foto en rechazada -> validation_error, service NO invocado", async () => {
    const service = buildService();
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("ubicacionLat", "9.9281"); // feature 193/R17
    fd.set("ubicacionLng", "-84.0907");
    fd.set("resultado", "rechazada");
    fd.set("motivo", "cliente rechazo");

    const r = await gestionar(fd, { service, getActor: actorMensajero });

    expect(r.status).toBe("validation_error");
    expect(service.gestionar).not.toHaveBeenCalled();
  });

  it("mas fotos que el maximo (4) -> validation_error, service NO invocado", async () => {
    const service = buildService();
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("ubicacionLat", "9.9281"); // feature 193/R17
    fd.set("ubicacionLng", "-84.0907");
    fd.set("resultado", "rechazada");
    fd.set("motivo", "cliente rechazo");
    for (const nombre of ["a", "b", "c", "d"]) fd.append("evidencia", imagenFile(`${nombre}.jpg`));

    const r = await gestionar(fd, { service, getActor: actorMensajero });

    expect(r.status).toBe("validation_error");
    expect(service.gestionar).not.toHaveBeenCalled();
  });

  it("R8: una foto invalida (pdf) entre validas -> validation_error, service NO invocado", async () => {
    const service = buildService();
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("ubicacionLat", "9.9281"); // feature 193/R17
    fd.set("ubicacionLng", "-84.0907");
    fd.set("resultado", "rechazada");
    fd.set("motivo", "cliente rechazo");
    fd.append("evidencia", imagenFile("a.jpg"));
    fd.append("evidencia", new File([new Uint8Array([1])], "doc.pdf", { type: "application/pdf" }));

    const r = await gestionar(fd, { service, getActor: actorMensajero });

    expect(r.status).toBe("validation_error");
    expect(service.gestionar).not.toHaveBeenCalled();
  });
});
