import { describe, it, expect, vi } from "vitest";
import type { RolValue } from "@prisma/client";
import { previsualizarInformeTransito } from "@/lib/actions/informe-transito";
import { crearInformeTransito } from "@/lib/whatsapp-envios/informes/transito/informe";
import { PARAMETROS_POR_DEFECTO } from "@/lib/whatsapp-envios/informes/transito/parametros";
import type { IInformeTransitoRepository } from "@/lib/interfaces/repositories/IInformeTransitoRepository";
import type { FilaTransito } from "@/lib/whatsapp-envios/informes/transito/tipos";

// Ficha 475 (T5.4) — R38/R39: la vista previa del panel. Solo maestro, solo lectura, y LA MISMA
// seleccion que `generar`.

const AHORA = new Date("2026-10-05T11:00:00.000Z");
const UN_DIA = 24 * 60 * 60 * 1000;
const ZONAS = [
  { id: "z1", nombre: "GAM", esCentral: true },
  { id: "z2", nombre: "FGAM Zona Sur", esCentral: false },
];

function fila(dias: number, estado: string, diasEnEstado: number | null, zonaId = "z1"): FilaTransito {
  return {
    ordenId: `o-${dias}-${estado}`,
    numRemision: "R",
    numGuia: 1,
    estado,
    zonaId,
    destinatario: "C",
    canton: "K",
    distrito: null,
    montoCobrar: null,
    hitoAt: new Date(AHORA.getTime() - dias * UN_DIA),
    ultimaTransicionAt: diasEnEstado === null ? null : new Date(AHORA.getTime() - diasEnEstado * UN_DIA),
  };
}

/** Doble de SOLO LECTURA: la interfaz no tiene escrituras y el doble no expone ninguna. */
function repo(): IInformeTransitoRepository & { [k: string]: unknown } {
  return {
    zonas: vi.fn(async () => ZONAS),
    filasEnAlerta: vi.fn(async () => [
      fila(12, "en_reparto", 0),
      fila(9, "en_bodega_central", 5),
      fila(16, "novedad", 2, "z2"),
    ]),
    contarSinHito: vi.fn(async () => 4),
  };
}

const actor = (rol: RolValue) => async () => ({ usuarioId: "u", rol });

describe("475/R39 — solo maestro", () => {
  it("sin sesion -> unauthenticated sin tocar el repo", async () => {
    const r = repo();
    expect(await previsualizarInformeTransito(PARAMETROS_POR_DEFECTO, { getActor: async () => null, repo: r })).toEqual({
      status: "unauthenticated",
    });
    expect(r.zonas).not.toHaveBeenCalled();
  });

  for (const rol of ["admin", "adminSatelite", "adminTienda", "mensajero", "apiKey"] as const) {
    it(`${rol} -> forbidden sin tocar el repo`, async () => {
      const r = repo();
      expect(await previsualizarInformeTransito(PARAMETROS_POR_DEFECTO, { getActor: actor(rol), repo: r })).toEqual({
        status: "forbidden",
      });
      expect(r.zonas).not.toHaveBeenCalled();
      expect(r.filasEnAlerta).not.toHaveBeenCalled();
      expect(r.contarSinHito).not.toHaveBeenCalled();
    });
  }

  it("el doble del repositorio solo tiene las tres lecturas (no hay escritura que llamar)", () => {
    expect(Object.keys(repo()).sort()).toEqual(["contarSinHito", "filasEnAlerta", "zonas"]);
  });
});

describe("475/R38 — conteo o errores por campo", () => {
  it("invalido -> validation_error por campo, con zonas y sin conteo ni seleccion", async () => {
    const r = repo();
    const res = await previsualizarInformeTransito(
      { ...PARAMETROS_POR_DEFECTO, zonas: [{ zonaId: "z1", plazoDias: 5, avisoDias: 5 }] },
      { getActor: actor("maestro"), repo: r, now: () => AHORA },
    );
    expect(res).toEqual({
      status: "validation_error",
      fieldErrors: { "parametros.zonas.0.avisoDias": [expect.stringContaining("avisoDias")] },
      zonas: ZONAS,
    });
    expect(r.filasEnAlerta).not.toHaveBeenCalled();
    expect(r.contarSinHito).not.toHaveBeenCalled();
  });

  it("valido -> zonas, paquetes en alerta, parados y sin hito iguales a los de generar con el mismo doble", async () => {
    const res = await previsualizarInformeTransito(PARAMETROS_POR_DEFECTO, {
      getActor: actor("maestro"),
      repo: repo(),
      now: () => AHORA,
    });
    expect(res).toEqual({ status: "ok", zonas: ZONAS, totalEnAlerta: 3, parados: 2, sinHito: 4 });

    const g = await crearInformeTransito({ repo: repo() }).generar({
      parametros: PARAMETROS_POR_DEFECTO,
      ahora: AHORA,
      conDocumento: false,
    });
    expect(g.tipo).toBe("contenido");
    if (g.tipo === "contenido" && res.status === "ok") {
      expect(g.valores.total_en_alerta).toBe(String(res.totalEnAlerta));
      expect(g.valores.parados).toBe(String(res.parados));
    }
  });

  it("pasa a la seleccion el mismo `ahora` y los estados incluidos", async () => {
    const r = repo();
    await previsualizarInformeTransito(PARAMETROS_POR_DEFECTO, { getActor: actor("maestro"), repo: r, now: () => AHORA });
    const consulta = (r.filasEnAlerta as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(consulta.hito).toBe("entrada_bodega_central");
    expect(consulta.estados).not.toContain("en_preparacion");
    expect(consulta.cortes).toEqual([
      { zonaId: "z1", corte: new Date("2026-09-28T06:00:00.000Z") },
      { zonaId: "z2", corte: new Date("2026-09-21T06:00:00.000Z") },
    ]);
    expect((r.contarSinHito as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(consulta);
  });
});
