import { describe, it, expect } from "vitest";
import { crearInformeTransito } from "@/lib/whatsapp-envios/informes/transito/informe";
import { PARAMETROS_POR_DEFECTO } from "@/lib/whatsapp-envios/informes/transito/parametros";
import type { IInformeTransitoRepository } from "@/lib/interfaces/repositories/IInformeTransitoRepository";
import type { FilaTransito } from "@/lib/whatsapp-envios/informes/transito/tipos";

// Ficha 475 (T2.7, R40) — el numero de consultas por generacion no depende del numero de ordenes.

const AHORA = new Date("2026-10-05T11:00:00.000Z");
const UN_DIA = 24 * 60 * 60 * 1000;

function filas(n: number): FilaTransito[] {
  return Array.from({ length: n }, (_, i) => ({
    ordenId: `o-${i}`,
    numRemision: `R-${i}`,
    numGuia: i + 1,
    estado: "en_reparto",
    zonaId: i % 2 === 0 ? "z1" : "z2",
    destinatario: "Cliente",
    canton: "Cantón",
    distrito: null,
    montoCobrar: "1000.00",
    hitoAt: new Date(AHORA.getTime() - (16 + (i % 10)) * UN_DIA),
    ultimaTransicionAt: new Date(AHORA.getTime() - (i % 5) * UN_DIA),
  }));
}

async function llamadasCon(n: number): Promise<string[]> {
  const llamadas: string[] = [];
  const repo: IInformeTransitoRepository = {
    zonas: async () => {
      llamadas.push("zonas");
      return [
        { id: "z1", nombre: "GAM", esCentral: true },
        { id: "z2", nombre: "Fuera", esCentral: false },
      ];
    },
    filasEnAlerta: async () => {
      llamadas.push("filasEnAlerta");
      return filas(n);
    },
    contarSinHito: async () => {
      llamadas.push("contarSinHito");
      return 0;
    },
  };
  const r = await crearInformeTransito({ repo }).generar({
    parametros: PARAMETROS_POR_DEFECTO,
    ahora: AHORA,
    conDocumento: true,
  });
  expect(r.tipo).toBe("contenido");
  if (r.tipo === "contenido") expect(r.valores.total_en_alerta).toBe(String(n));
  return llamadas;
}

describe("475/R40 — tres consultas fijas por generacion", () => {
  it("con 1 orden en alerta", async () => {
    expect((await llamadasCon(1)).sort()).toEqual(["contarSinHito", "filasEnAlerta", "zonas"]);
  });

  it("con 500 ordenes en alerta (y el PDF de todas)", async () => {
    expect((await llamadasCon(500)).sort()).toEqual(["contarSinHito", "filasEnAlerta", "zonas"]);
  });
});
