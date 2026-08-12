import { describe, it, expect, vi } from "vitest";
import { gestionar } from "@/lib/actions/mis-asignaciones";
import type { IMisAsignacionesService } from "@/lib/interfaces/services/IMisAsignacionesService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 208 (T6 · R11/R12) — el BORDE lee el DESGLOSE del FormData como campos REPETIDOS
// `pagoMetodo`/`pagoMonto` (mismo patron `getAll` que las evidencias de la 119) y los empareja
// por indice. Lo que este archivo protege de verdad es la VENTANA entre el merge de la 208 y el
// de la 209: el panel viejo sigue mandando un metodo escalar y NO puede dejar de funcionar.

const MENSAJERO: Actor = { usuarioId: "m1", rol: "mensajero" };
const actorMensajero = async () => MENSAJERO;

function buildService(): IMisAsignacionesService {
  return {
    listarMisAsignaciones: vi.fn(),
    recogerAsignaciones: vi.fn(),
    escogerParaGestion: vi.fn(),
    gestionar: vi.fn(async () => ({ status: "ok" as const, ordenId: "o1", estado: "entregada" })),
    liberarGestion: vi.fn(),
  } as unknown as IMisAsignacionesService;
}

function imagen(): File {
  return new File([new Uint8Array([1, 2, 3, 4])], "a.jpg", { type: "image/jpeg" });
}

/** FormData base de una entrega valida (con la ubicacion que exige la 193/R10). */
function fdEntrega(montoRecibido: string): FormData {
  const fd = new FormData();
  fd.set("ordenId", "o1");
  fd.set("ubicacionLat", "9.9281");
  fd.set("ubicacionLng", "-84.0907");
  fd.set("resultado", "entregada");
  fd.set("montoRecibido", montoRecibido);
  fd.append("evidencia", imagen());
  return fd;
}

function inputRecibido(service: IMisAsignacionesService) {
  return (service.gestionar as ReturnType<typeof vi.fn>).mock.calls[0][0];
}

describe("R12: el FormData VIEJO (solo `metodoPago`) sigue produciendo una gestion valida", () => {
  it("una linea con el total, y el escalar CONSERVADO para la columna deprecada", async () => {
    const service = buildService();
    const fd = fdEntrega("8000");
    fd.set("metodoPago", "efectivo");

    const r = await gestionar(fd, { service, getActor: actorMensajero });

    expect(r.status).toBe("ok");
    const input = inputRecibido(service);
    expect(input.pagos).toEqual([{ metodo: "efectivo", monto: 8000 }]);
    expect(input.metodoPago).toBe("efectivo");
  });

  it("R14: sin cobro con el escalar `efectivo` que fuerza el panel -> CERO lineas", async () => {
    const service = buildService();
    const fd = fdEntrega("0");
    fd.set("metodoPago", "efectivo");

    const r = await gestionar(fd, { service, getActor: actorMensajero });

    expect(r.status).toBe("ok");
    expect(inputRecibido(service).pagos).toEqual([]);
  });
});

describe("R11: el FormData NUEVO trae el desglose como campos repetidos", () => {
  it("dos pares pagoMetodo/pagoMonto -> dos lineas, emparejadas por indice y en orden", async () => {
    const service = buildService();
    const fd = fdEntrega("8000");
    fd.append("pagoMetodo", "efectivo");
    fd.append("pagoMonto", "5000");
    fd.append("pagoMetodo", "transferencia");
    fd.append("pagoMonto", "3000");

    const r = await gestionar(fd, { service, getActor: actorMensajero });

    expect(r.status).toBe("ok");
    const input = inputRecibido(service);
    expect(input.pagos).toEqual([
      { metodo: "efectivo", monto: 5000 },
      { metodo: "transferencia", monto: 3000 },
    ]);
    // Sin escalar: la columna deprecada la decide el service a partir del desglose (R19).
    expect(input.metodoPago).toBeNull();
  });

  it("longitudes desparejas (2 metodos, 1 monto) -> validation_error, service NO invocado", async () => {
    const service = buildService();
    const fd = fdEntrega("8000");
    fd.append("pagoMetodo", "efectivo");
    fd.append("pagoMonto", "5000");
    fd.append("pagoMetodo", "transferencia"); // sin su monto

    const r = await gestionar(fd, { service, getActor: actorMensajero });

    expect(r.status).toBe("validation_error");
    expect(service.gestionar).not.toHaveBeenCalled();
  });

  it("un desglose que NO suma el monto recibido -> validation_error en `pagos`, sin persistir", async () => {
    const service = buildService();
    const fd = fdEntrega("8000");
    fd.append("pagoMetodo", "efectivo");
    fd.append("pagoMonto", "5000");
    fd.append("pagoMetodo", "transferencia");
    fd.append("pagoMonto", "2000");

    const r = await gestionar(fd, { service, getActor: actorMensajero });

    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(Object.keys(r.fieldErrors)).toContain("pagos");
    expect(service.gestionar).not.toHaveBeenCalled();
  });

  it("R13: escalar + desglose en el mismo FormData -> validation_error, service NO invocado", async () => {
    const service = buildService();
    const fd = fdEntrega("5000");
    fd.set("metodoPago", "efectivo");
    fd.append("pagoMetodo", "efectivo");
    fd.append("pagoMonto", "5000");

    const r = await gestionar(fd, { service, getActor: actorMensajero });

    expect(r.status).toBe("validation_error");
    expect(service.gestionar).not.toHaveBeenCalled();
  });
});

describe("la clave `pagos` no se inventa cuando el FormData no la trae", () => {
  it("R15: sin desglose y sin escalar con cobro > 0 -> validation_error en `metodoPago`", async () => {
    const service = buildService();

    const r = await gestionar(fdEntrega("8000"), { service, getActor: actorMensajero });

    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") {
      expect(Object.keys(r.fieldErrors)).toEqual(["metodoPago"]);
    }
    expect(service.gestionar).not.toHaveBeenCalled();
  });

  it("R16: una rama sin recaudo (rechazada) no gana `pagos` aunque el FormData los traiga", async () => {
    const service = buildService();
    const fd = new FormData();
    fd.set("ordenId", "o1");
    fd.set("ubicacionLat", "9.9281");
    fd.set("ubicacionLng", "-84.0907");
    fd.set("resultado", "rechazada");
    fd.set("motivo", "cliente rechazo");
    fd.append("evidencia", imagen());
    fd.append("pagoMetodo", "efectivo");
    fd.append("pagoMonto", "5000");

    const r = await gestionar(fd, { service, getActor: actorMensajero });

    expect(r.status).toBe("ok");
    expect(inputRecibido(service)).not.toHaveProperty("pagos");
  });
});
