import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";

import {
  confirmarSinpeBodega,
  guardarSinpeBodega,
  listarSinpeBodegas,
} from "@/lib/actions/sinpe-bodega";
import type { ISinpeBodegaService } from "@/lib/interfaces/services/ISinpeBodegaService";
import type { Actor } from "@/lib/interfaces/services/IZonaService";
import type { SinpeBodegaDTO } from "@/lib/types/sinpe-bodega";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 429 / T10 — EL BORDE REAL: zod, permisos y el resultado discriminado.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// Lo que se mide aqui es el BORDE, no la regla: que un payload con un campo desconocido devuelve
// `validation_error` en vez de un descarte mudo, que el error del numero cae EN EL CAMPO DEL
// NUMERO (para que la pantalla lo pinte al lado y no como un toast generico), que sin sesion sale
// `unauthenticated` ANTES de tocar el servicio, y que el `forbidden` del servicio llega tal cual.
//
// ⚠️ NINGUN SINPE DE AQUI ES REAL. El repositorio es publico.

const DTO: SinpeBodegaDTO = {
  zonaId: "z-3",
  zonaNombre: "Bodega 3",
  esCentral: false,
  numero: "80000000",
  nombre: "Titular de Prueba",
  revisadoAt: null,
  editable: true,
};

function buildService(overrides: Partial<ISinpeBodegaService> = {}): ISinpeBodegaService {
  return {
    listar: vi.fn().mockResolvedValue({ status: "ok", items: [DTO] }),
    guardar: vi.fn().mockResolvedValue({ status: "ok", bodega: DTO }),
    confirmar: vi.fn().mockResolvedValue({ status: "ok" }),
    ...overrides,
  };
}

const actor = (rol: RolValue, usuarioId = "u-1"): Actor => ({ usuarioId, rol });

function deps(service: ISinpeBodegaService, a: Actor | null = actor("maestro")) {
  return { sinpeBodegaService: service, getActor: async () => a };
}

const VALIDO = { numero: "70000001", nombre: "Otro Titular de Prueba" };

describe("429/T10 — el borde: sesion", () => {
  it("sin sesion, las tres acciones devuelven `unauthenticated` SIN tocar el servicio", async () => {
    const service = buildService();
    expect((await listarSinpeBodegas(deps(service, null))).status).toBe("unauthenticated");
    expect((await guardarSinpeBodega("z-3", VALIDO, deps(service, null))).status).toBe(
      "unauthenticated",
    );
    expect((await confirmarSinpeBodega("z-3", deps(service, null))).status).toBe("unauthenticated");
    expect(service.listar).not.toHaveBeenCalled();
    expect(service.guardar).not.toHaveBeenCalled();
    expect(service.confirmar).not.toHaveBeenCalled();
  });
});

describe("429/T10 — el borde: zod", () => {
  it("⭑ un campo DESCONOCIDO es `validation_error`, no un descarte mudo", async () => {
    // `.strict()`. En una superficie de dinero, «te ignoré un campo» es la forma educada de perder
    // un dato: quien mande `titular` creyendo que es `nombre` tiene que enterarse.
    const service = buildService();
    const r = await guardarSinpeBodega("z-3", { ...VALIDO, titular: "X" }, deps(service));
    expect(r.status).toBe("validation_error");
    expect(service.guardar).not.toHaveBeenCalled();
  });

  it("⭑ un numero invalido pone el error EN EL CAMPO DEL NUMERO (R11)", async () => {
    // Que el error viaje colgado de `numero` es lo que permite pintarlo junto al campo. Un toast
    // generico obliga a adivinar cual de los dos esta mal.
    const service = buildService();
    const r = await guardarSinpeBodega("z-3", { ...VALIDO, numero: "12345678" }, deps(service));
    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") return;
    expect(Object.keys(r.fieldErrors)).toContain("numero");
    expect(r.fieldErrors.numero?.[0]).toMatch(/6, 7 u 8/);
    expect(service.guardar).not.toHaveBeenCalled();
  });

  it("⭑ un titular vacio o de solo espacios cae en el campo del nombre (R8)", async () => {
    const service = buildService();
    for (const nombre of ["", "   "]) {
      const r = await guardarSinpeBodega("z-3", { ...VALIDO, nombre }, deps(service));
      expect(r.status, JSON.stringify(nombre)).toBe("validation_error");
      if (r.status !== "validation_error") continue;
      expect(Object.keys(r.fieldErrors)).toContain("nombre");
    }
    expect(service.guardar).not.toHaveBeenCalled();
  });

  it("⭑ R9 — el numero se NORMALIZA en el borde: al servicio llegan los ocho digitos", async () => {
    // Lo que se guarda no puede llevar separadores. Se afirma sobre el argumento que recibe el
    // servicio, no sobre el resultado: es donde de verdad se decide lo que se escribe.
    const service = buildService();
    const r = await guardarSinpeBodega("z-3", { numero: "+506 7000 0001", nombre: "Titular" }, deps(service));
    expect(r.status).toBe("ok");
    expect(service.guardar).toHaveBeenCalledWith(
      "z-3",
      { numero: "70000001", nombre: "Titular" },
      expect.objectContaining({ usuarioId: "u-1" }),
    );
  });

  it("un `zonaId` vacio es `validation_error` colgado de `zonaId`", async () => {
    const service = buildService();
    const r = await guardarSinpeBodega("", VALIDO, deps(service));
    expect(r.status).toBe("validation_error");
    if (r.status === "validation_error") expect(Object.keys(r.fieldErrors)).toContain("zonaId");
    expect(service.guardar).not.toHaveBeenCalled();
  });

  it("`confirmarSinpeBodega` NO acepta valores: su firma solo lleva el id (R25)", async () => {
    // El contrato es el tipo. Se afirma que el servicio recibe EXACTAMENTE el id y el actor, sin
    // ningun hueco por el que pudiera colarse un numero.
    const service = buildService();
    const r = await confirmarSinpeBodega("z-3", deps(service));
    expect(r.status).toBe("ok");
    expect(service.confirmar).toHaveBeenCalledWith("z-3", expect.objectContaining({ rol: "maestro" }));
    expect(vi.mocked(service.confirmar).mock.calls[0]).toHaveLength(2);
  });
});

describe("429/T10 — el borde: los desenlaces del servicio llegan tal cual", () => {
  it("⭑ R19/R20 — un `forbidden` del servicio sale como `forbidden`, sin disfraz", async () => {
    const service = buildService({ guardar: vi.fn().mockResolvedValue({ status: "forbidden" }) });
    expect((await guardarSinpeBodega("z-9", VALIDO, deps(service, actor("adminSatelite")))).status)
      .toBe("forbidden");
  });

  it("un `not_found` del servicio sale como `not_found`", async () => {
    const service = buildService({ guardar: vi.fn().mockResolvedValue({ status: "not_found" }) });
    expect((await guardarSinpeBodega("z-99", VALIDO, deps(service))).status).toBe("not_found");
  });

  it("`listarSinpeBodegas` devuelve los items con su `editable` tal cual", async () => {
    const r = await listarSinpeBodegas(deps(buildService()));
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.items).toEqual([DTO]);
  });
});
