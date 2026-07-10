import { describe, it, expect, vi } from "vitest";
import { postularMensajero } from "@/lib/actions/postulacion-mensajero";
import { ResetRateLimiter } from "@/lib/utils/reset-rate-limit";
import type { IPostulacionMensajeroService } from "@/lib/interfaces/services/IPostulacionMensajeroService";
import { DOCUMENTO_TIPOS } from "@/lib/types/postulacion-mensajero";
import { postulacionConfig } from "@/lib/config/postulacion";

// Feature 21 / R22 (no cookie, publica), A4 (rate-limiting), mapeo de resultados.

const CTX = { ipAddress: "1.2.3.4" };

function imagenFile() {
  return new File([new Uint8Array([1, 2, 3, 4])], "doc.jpg", { type: "image/jpeg" });
}

function formDataValido(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  const campos: Record<string, string> = {
    nombre: "Ana",
    primer_apellido: "Perez",
    segundo_apellido: "Gomez",
    email: "ana@example.com",
    telefono: "0991234567",
    tipo_identificacion_id: "tipo-1",
    cedula: "1710034065",
    vehiculo_id: "veh-1",
    placa: "abc123",
    password: "Abcdef1!",
    confirmacion_password: "Abcdef1!",
    ...overrides,
  };
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  for (const tipo of DOCUMENTO_TIPOS) fd.set(tipo, imagenFile());
  return fd;
}

function buildService(overrides: Partial<IPostulacionMensajeroService> = {}): IPostulacionMensajeroService {
  return {
    postular: vi.fn().mockResolvedValue({ status: "ok" }),
    ...overrides,
  };
}

describe("Server Action postularMensajero", () => {
  it("R22: no lee ni setea cookies; delega en el servicio con contexto inyectado", async () => {
    const service = buildService();
    // El modulo no importa `cookies`; si intentara leerlas sin request fallaria.
    const result = await postularMensajero(formDataValido(), {
      service,
      getContext: async () => CTX,
      limiter: new ResetRateLimiter(),
    });

    expect(result).toEqual({ status: "ok" });
    expect(service.postular).toHaveBeenCalledTimes(1);
  });

  it("mapea el command a camelCase y lee los 5 binarios del FormData", async () => {
    const service = buildService();
    await postularMensajero(formDataValido(), {
      service,
      getContext: async () => CTX,
      limiter: new ResetRateLimiter(),
    });
    const [command] = (service.postular as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(command.primerApellido).toBe("Perez");
    expect(command.vehiculoId).toBe("veh-1");
    expect(Object.keys(command.documentos)).toEqual(expect.arrayContaining([...DOCUMENTO_TIPOS]));
    for (const tipo of DOCUMENTO_TIPOS) {
      expect(command.documentos[tipo].bytes).toBeInstanceOf(Uint8Array);
    }
  });

  it("rechaza payload invalido con validation_error sin llamar al servicio", async () => {
    const service = buildService();
    const result = await postularMensajero(formDataValido({ email: "no-es-email" }), {
      service,
      getContext: async () => CTX,
      limiter: new ResetRateLimiter(),
    });
    expect(result.status).toBe("validation_error");
    expect(service.postular).not.toHaveBeenCalled();
  });

  it("propaga conflict del servicio", async () => {
    const service = buildService({
      postular: vi.fn().mockResolvedValue({ status: "conflict", field: "cedula" }),
    });
    const result = await postularMensajero(formDataValido(), {
      service,
      getContext: async () => CTX,
      limiter: new ResetRateLimiter(),
    });
    expect(result).toEqual({ status: "conflict", field: "cedula" });
  });

  it("A4: supera el limite de tasa por IP|email -> rate_limited sin llamar al servicio", async () => {
    const service = buildService();
    const limiter = new ResetRateLimiter();

    // Consume el cupo con envios validos previos (misma IP+email).
    for (let i = 0; i < postulacionConfig.RATE_MAX; i++) {
      await postularMensajero(formDataValido(), {
        service,
        getContext: async () => CTX,
        limiter,
      });
    }
    (service.postular as ReturnType<typeof vi.fn>).mockClear();

    const result = await postularMensajero(formDataValido(), {
      service,
      getContext: async () => CTX,
      limiter,
    });

    expect(result).toEqual({ status: "rate_limited" });
    expect(service.postular).not.toHaveBeenCalled();
  });
});
