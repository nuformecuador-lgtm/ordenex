// Feature 170 (T0.2) — adaptadores compartidos entre el dato de un listado y el contrato
// de descarga del `DataTable`. Cubre R11, R26, R27, R28, R31 y R36.
//
// Es la pieza que las 25 tablas comparten: si el tope, el orden o el mensaje se rompen
// aquí, se rompen en las 25 a la vez. De ahí que se pruebe por su cuenta y no solo a
// través de una pantalla.
import { describe, it, expect } from "vitest";

import {
  filasDesdeResultado,
  filasLocales,
  mensajeLimite,
  SUFIJO_REINTENTO,
} from "@/components/shared/descarga-resultado";
import { descargaConfig } from "@/lib/config/descarga";
import type { DescargaFila } from "@/lib/types/descarga";
import type { ListarCompletoResult } from "@/lib/types/descarga-listado";

interface Item {
  nombre: string;
  monto: number;
}

/** Proyección de prueba: valores CRUDOS, como exige el contrato de export. */
function proyectar(item: Item): DescargaFila {
  return { nombre: item.nombre, monto: item.monto };
}

const ITEMS: Item[] = [
  { nombre: "Zulma", monto: 300 },
  { nombre: "Ana", monto: 100 },
  { nombre: "Beto", monto: 200 },
];

describe("adaptadores de descarga · Familia A (filasDesdeResultado)", () => {
  it("traduce el resultado ok a filas proyectadas, en el mismo orden", async () => {
    const resultado: ListarCompletoResult<Item> = {
      status: "ok",
      items: ITEMS,
      total: ITEMS.length,
    };

    const res = await filasDesdeResultado(resultado, proyectar);

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    // R11: el archivo respeta el orden con que el servidor devolvió el dataset; el
    // adaptador NO reordena (aquí el orden de entrada NO es alfabético a propósito).
    expect(res.filas).toEqual([
      { nombre: "Zulma", monto: 300 },
      { nombre: "Ana", monto: 100 },
      { nombre: "Beto", monto: 200 },
    ]);
  });

  it("traduce limite_excedido a un error accionable con total y tope, sin filas", async () => {
    const res = await filasDesdeResultado<Item>(
      Promise.resolve({ status: "limite_excedido", total: 12_480, limite: 5000 }),
      proyectar,
    );

    // R27: sin archivo. El resultado es un error, así que no hay `filas` que emitir.
    expect(res.status).toBe("error");
    if (res.status !== "error") return;
    expect(res).not.toHaveProperty("filas");
    // El mensaje dice el total encontrado, el tope vigente y qué hacer.
    expect(res.mensaje).toContain("12480");
    expect(res.mensaje).toContain("5000");
    expect(res.mensaje).toMatch(/acota los filtros/i);
    expect(res.mensaje).toBe(mensajeLimite(12_480, 5000));
  });

  it("traduce cualquier error de acción a un mensaje accionable sin datos personales", async () => {
    const errores: ListarCompletoResult<Item>[] = [
      { status: "unauthenticated" },
      { status: "forbidden" },
      { status: "not_found" },
      { status: "conflict" },
      { status: "validation_error", fieldErrors: { filter: ["clave no permitida"] } },
    ];

    for (const error of errores) {
      const res = await filasDesdeResultado<Item>(error, proyectar);

      expect(res.status).toBe("error");
      if (res.status !== "error") return;
      // R36: mensaje accionable (dice qué hacer a continuación)…
      expect(res.mensaje.endsWith(SUFIJO_REINTENTO)).toBe(true);
      expect(res.mensaje.length).toBeGreaterThan(SUFIJO_REINTENTO.length);
      // …y sin nada del dato: ni claves de campo, ni el código de estado crudo. El
      // `\b` evita el falso positivo de "conflicto", que sí es prosa legítima.
      expect(res.mensaje).not.toContain("filter");
      expect(res.mensaje).not.toContain("clave no permitida");
      expect(res.mensaje).not.toMatch(new RegExp(`\\b${error.status}\\b`));
      expect(res.mensaje).not.toContain("Zulma");
      expect(res).not.toHaveProperty("filas");
    }
  });

  it("devuelve el resultado vacío tal cual para que el control avise sin archivo", async () => {
    const res = await filasDesdeResultado<Item>(
      { status: "ok", items: [], total: 0 },
      proyectar,
    );

    // R31: cero filas NO es un error del adaptador; el control es quien avisa "no hay
    // datos que descargar" y no produce archivo (`DescargarDatasetButton`).
    expect(res).toEqual({ status: "ok", filas: [] });
  });
});

describe("adaptadores de descarga · Familia B (filasLocales)", () => {
  it("traduce el array que la pantalla ya tiene a filas proyectadas, en el mismo orden", async () => {
    const res = await filasLocales(ITEMS, proyectar);

    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    // R11: mismo orden que la tabla pinta.
    expect(res.filas.map((f) => f.nombre)).toEqual(["Zulma", "Ana", "Beto"]);
  });

  it("filasLocales rechaza y no produce archivo cuando el array supera el tope", async () => {
    const limite = descargaConfig.MAX_FILAS;
    const excedido = Array.from({ length: limite + 1 }, (_, i) => ({
      nombre: `n-${i}`,
      monto: i,
    }));

    const res = await filasLocales(excedido, proyectar);

    // R26/R27: el tope también rige para las tablas que ya tienen el dataset en memoria.
    expect(res.status).toBe("error");
    if (res.status !== "error") return;
    expect(res).not.toHaveProperty("filas");
    expect(res.mensaje).toBe(mensajeLimite(limite + 1, limite));
  });

  it("filasLocales no trunca: o devuelve todas las filas o el error", async () => {
    const limite = descargaConfig.MAX_FILAS;
    const alTope = Array.from({ length: limite }, (_, i) => ({
      nombre: `n-${i}`,
      monto: i,
    }));

    const enTope = await filasLocales(alTope, proyectar);
    const pasado = await filasLocales([...alTope, { nombre: "extra", monto: 1 }], proyectar);

    // R28: justo en el tope entrega el dataset ENTERO (ni una fila menos)…
    expect(enTope.status).toBe("ok");
    if (enTope.status !== "ok") return;
    expect(enTope.filas).toHaveLength(limite);
    expect(enTope.filas.at(-1)).toEqual({ nombre: `n-${limite - 1}`, monto: limite - 1 });
    // …y una fila por encima NO entrega un archivo recortado: entrega el error.
    expect(pasado.status).toBe("error");
  });

  it("devuelve el resultado vacío tal cual para que el control avise sin archivo", async () => {
    const res = await filasLocales([], proyectar);

    // R31: mismo criterio que en Familia A.
    expect(res).toEqual({ status: "ok", filas: [] });
  });
});

describe("mensajes canónicos de la descarga", () => {
  it("el mensaje del tope y el sufijo de reintento son únicos y viven en el módulo común", async () => {
    // Los textos se PROMOVIERON desde `OrdenesModule` sin editarse (T0.2). Este test los
    // fija: si alguien los reescribe "de paso", falla aquí y no en 25 pantallas.
    expect(mensajeLimite(7, 5)).toBe(
      "La descarga supera el máximo de 5 filas (hay 7). Acota los filtros —por ejemplo, el rango de fechas o el estado— y vuelve a intentarlo.",
    );
    expect(SUFIJO_REINTENTO).toBe("Vuelve a intentarlo; el listado no cambió.");
  });
});
