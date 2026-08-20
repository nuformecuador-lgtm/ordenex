import { describe, expect, it, vi } from "vitest";

import { gestionarDesdeAyuda } from "@/lib/actions/gestion-desde-ayuda";
import type { IGestionDesdeAyudaService } from "@/lib/interfaces/services/IGestionDesdeAyudaService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";

// Feature 237 (T5.4, R1/R12/R13/R14) — el BORDE: la Server Action.
//
// Molde: `incidentes-action.test.ts`. Lo que se ejerce aqui y no en el servicio:
//   - sin sesion ⇒ `unauthenticated` SIN una sola llamada al servicio;
//   - `resultado` invalido ⇒ `validation_error`, con el servicio intacto;
//   - N archivos de la clave repetida `evidencia` ⇒ N evidencias con indices 0..N-1 EN ORDEN;
//   - el binario llega leido (el servicio no sabe nada de `File` ni de `FormData`).

const ORDEN_ID = "22222222-2222-4222-8222-222222222222";
const TIENDA: Actor = { usuarioId: "tienda-1", rol: "adminTienda" };

const noActor = async () => null;
const actorTienda = async () => TIENDA;

function fakeService(
  overrides: Partial<IGestionDesdeAyudaService> = {},
): IGestionDesdeAyudaService {
  return {
    gestionar: vi.fn(async () => ({
      status: "ok" as const,
      ordenId: ORDEN_ID,
      resultado: "rechazada" as const,
    })),
    ...overrides,
  };
}

/** `FormData` tal como lo manda la ventana: campos sueltos + N `append("evidencia", file)`. */
function formData(
  over: {
    resultado?: string;
    motivo?: string;
    fechaReprogramacion?: string;
    fotos?: number;
    ordenId?: string;
  } = {},
): FormData {
  const fd = new FormData();
  fd.set("ordenId", over.ordenId ?? ORDEN_ID);
  fd.set("resultado", over.resultado ?? "rechazada");
  if (over.motivo !== undefined) fd.set("motivo", over.motivo);
  else fd.set("motivo", "el cliente no la quiere");
  if (over.fechaReprogramacion !== undefined) {
    fd.set("fechaReprogramacion", over.fechaReprogramacion);
  }
  for (let i = 0; i < (over.fotos ?? 1); i++) {
    fd.append(
      "evidencia",
      // El byte `i` hace distinguible cada foto: asi se puede afirmar el ORDEN, no solo el numero.
      new File([new Uint8Array([i])], `f${i}.jpg`, { type: "image/jpeg" }),
    );
  }
  return fd;
}

/** Mañana en el calendario de CR, para la rama que exige fecha. */
function manana(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

describe("gestionarDesdeAyuda — el borde autentica ANTES de tocar nada", () => {
  it("sin sesion ⇒ `unauthenticated`, y el servicio NO recibe ni una llamada", async () => {
    const service = fakeService();
    const r = await gestionarDesdeAyuda(formData(), { service, getActor: noActor });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.gestionar).not.toHaveBeenCalled();
  });

  it("sin sesion tampoco parsea el `FormData`: un payload basura sigue dando `unauthenticated`", async () => {
    // El orden importa: si se parseara primero, un anonimo podria distinguir un payload valido de
    // uno invalido por el codigo de error, y eso es informacion que no le corresponde.
    const service = fakeService();
    const basura = new FormData();
    const r = await gestionarDesdeAyuda(basura, { service, getActor: noActor });
    expect(r).toEqual({ status: "unauthenticated" });
    expect(service.gestionar).not.toHaveBeenCalled();
  });
});

describe("gestionarDesdeAyuda — el borde REVALIDA (R1/R12/R13/R14)", () => {
  it.each(["entregada", "devuelta", "incidente", "cualquier-cosa"])(
    "R1: `resultado = %s` ⇒ `validation_error`, sin llegar al servicio",
    async (resultado) => {
      const service = fakeService();
      const r = await gestionarDesdeAyuda(formData({ resultado }), {
        service,
        getActor: actorTienda,
      });
      expect(r.status).toBe("validation_error");
      expect(service.gestionar).not.toHaveBeenCalled();
    },
  );

  it("R12: sin foto ⇒ `validation_error` con el error en `evidencias`", async () => {
    const service = fakeService();
    const r = await gestionarDesdeAyuda(formData({ fotos: 0 }), {
      service,
      getActor: actorTienda,
    });
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(Object.keys(r.fieldErrors)).toContain("evidencias");
    expect(service.gestionar).not.toHaveBeenCalled();
  });

  it("R12: sin motivo ⇒ `validation_error` con el error en `motivo`", async () => {
    const fd = formData();
    fd.delete("motivo");
    const service = fakeService();
    const r = await gestionarDesdeAyuda(fd, { service, getActor: actorTienda });
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(Object.keys(r.fieldErrors)).toContain("motivo");
  });

  it("R13: un MIME no permitido ⇒ `validation_error` aunque la ventana lo dejara pasar", async () => {
    const fd = formData({ fotos: 0 });
    fd.append("evidencia", new File([new Uint8Array([1])], "x.pdf", { type: "application/pdf" }));
    const service = fakeService();
    const r = await gestionarDesdeAyuda(fd, { service, getActor: actorTienda });
    expect(r.status).toBe("validation_error");
    expect(service.gestionar).not.toHaveBeenCalled();
  });

  it("R14: reprogramar con la fecha de HOY ⇒ `validation_error`", async () => {
    const hoy = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Costa_Rica",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const service = fakeService();
    const r = await gestionarDesdeAyuda(
      formData({ resultado: "reprogramada", fechaReprogramacion: hoy }),
      { service, getActor: actorTienda },
    );
    expect(r.status).toBe("validation_error");
    expect(service.gestionar).not.toHaveBeenCalled();
  });

  it("R14: reprogramar SIN fecha ⇒ `validation_error`", async () => {
    const service = fakeService();
    const r = await gestionarDesdeAyuda(formData({ resultado: "reprogramada" }), {
      service,
      getActor: actorTienda,
    });
    expect(r.status).toBe("validation_error");
  });
});

describe("gestionarDesdeAyuda — lo que llega al servicio", () => {
  it("N archivos de la clave `evidencia` ⇒ N evidencias, con su binario y EN ORDEN", async () => {
    const service = fakeService();
    await gestionarDesdeAyuda(formData({ fotos: 3 }), { service, getActor: actorTienda });

    expect(service.gestionar).toHaveBeenCalledTimes(1);
    const input = (service.gestionar as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      evidencias: { contentType: string; bytes: Uint8Array }[];
    };
    expect(input.evidencias).toHaveLength(3);
    // El ORDEN es de donde sale el indice 0..N-1 (y con el, la portada de la 119/R12): cada foto
    // lleva su propio byte, asi que una reordenacion se veria.
    expect(input.evidencias.map((e) => e.bytes[0])).toEqual([0, 1, 2]);
    expect(input.evidencias.every((e) => e.contentType === "image/jpeg")).toBe(true);
  });

  it("el actor de la SESION llega al servicio (no un id del `FormData`)", async () => {
    const service = fakeService();
    await gestionarDesdeAyuda(formData(), { service, getActor: actorTienda });
    const actor = (service.gestionar as ReturnType<typeof vi.fn>).mock.calls[0][1] as Actor;
    expect(actor).toEqual(TIENDA);
  });

  it("reprogramar con fecha valida llega al servicio con su fecha y su resultado", async () => {
    const service = fakeService({
      gestionar: vi.fn(async () => ({
        status: "ok" as const,
        ordenId: ORDEN_ID,
        resultado: "reprogramada" as const,
      })),
    });
    const r = await gestionarDesdeAyuda(
      formData({ resultado: "reprogramada", fechaReprogramacion: manana() }),
      { service, getActor: actorTienda },
    );
    expect(r).toEqual({ status: "ok", ordenId: ORDEN_ID, resultado: "reprogramada" });
    const input = (service.gestionar as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      resultado: string;
      fechaReprogramacion: string;
    };
    expect(input.resultado).toBe("reprogramada");
    expect(input.fechaReprogramacion).toBe(manana());
  });

  it("el resultado de DOMINIO del servicio se devuelve tal cual (no se traduce a excepcion)", async () => {
    // `forbidden` y `conflict` NO son AppError: son respuestas normales que la pantalla pinta.
    for (const dominio of [
      { status: "forbidden" as const },
      { status: "conflict" as const, motivo: "Esta orden ya no está esperando tu respuesta." },
    ]) {
      const service = fakeService({ gestionar: vi.fn(async () => dominio) });
      const r = await gestionarDesdeAyuda(formData(), { service, getActor: actorTienda });
      expect(r).toEqual(dominio);
    }
  });
});
