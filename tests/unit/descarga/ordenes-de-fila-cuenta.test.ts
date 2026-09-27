import { describe, it, expect, vi, beforeEach } from "vitest";

// =================================================================================================
// FICHA 458-D (R19, 344/345) — la FUENTE del panel de órdenes para una fila de cierre del estado de
// cuenta de la oficina (`fuenteOrdenesDeFila`): lee con la cuenta de la página y el movimiento de la
// fila; `sin_reparto` es una respuesta (no un fallo); la descarga son TODAS las órdenes de la fila, con
// el tope único de la app y sin identificadores.
// =================================================================================================

const verOrdenesDeFilaMock = vi.fn();
vi.mock("@/lib/actions/estado-cuenta", () => ({
  verOrdenesDeFilaAction: (...a: unknown[]) => verOrdenesDeFilaMock(...a),
}));
vi.mock("@/lib/actions/wallet", () => ({
  verDetalleDeMovimientoAction: vi.fn(),
  verDetalleDeMovimientoCompletoAction: vi.fn(),
}));

import { fuenteOrdenesDeFila } from "@/app/(app)/wallet/_components/ordenes-de-fila-cuenta";
import { DETALLE_MOVIMIENTO_SIN_REPARTO } from "@/app/(app)/wallet/_components/detalle-movimiento-labels";
import { descargaConfig } from "@/lib/config/descarga";
import { detalleMovimientoConfig } from "@/lib/config/detalle-movimiento";
import type { OrdenAporteDTO } from "@/lib/types/detalle-movimiento";

const TIENDA = "3f1c2a9e-5b7d-4c21-9a0e-7d4b2c1e8f60";
const MOV = "00000001-aaaa-4bbb-8ccc-000000000001";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function orden(i: number): OrdenAporteDTO {
  return {
    ordenId: `9f8e7d6c-5b4a-4392-8170-${String(i).padStart(12, "0")}`,
    guia: `G${i}`,
    destinatario: `Cliente ${i}`,
    tiendaNombre: "Tania Tienda",
    resultados: ["entregado"],
    aporte: `${1000 + i}.00`,
  };
}

function pagina(ordenes: OrdenAporteDTO[], total: number, page: number, pageSize: number) {
  return {
    status: "ok" as const,
    data: {
      monto: "1000.00",
      cierre: { fecha: "2026-09-12T18:00:00.000Z", mensajeroNombre: "Juan Pérez Mora" },
      ordenesDelCierre: total,
      total,
      page,
      pageSize,
      ordenes,
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("R19 — leer una página de las órdenes de la fila", () => {
  it("con la cuenta de la página y el movimiento de la fila; sin `pageSize` (lo pone el servidor)", async () => {
    verOrdenesDeFilaMock.mockResolvedValue(pagina([orden(1)], 1, 2, 25));
    const vista = await fuenteOrdenesDeFila({ tipo: "tienda", id: TIENDA }).leer(MOV, 2);
    expect(verOrdenesDeFilaMock).toHaveBeenCalledWith({ cuenta: { tipo: "tienda", id: TIENDA }, movimientoId: MOV, page: 2 });
    expect(vista.modo).toBe("ok");
  });

  it("`sin_reparto` es una RESPUESTA con su motivo, no un fallo", async () => {
    verOrdenesDeFilaMock.mockResolvedValue({ status: "sin_reparto", motivo: "snapshot_del_cierre" });
    await expect(fuenteOrdenesDeFila({ tipo: "mensajero", id: TIENDA }).leer(MOV, 1)).resolves.toEqual({
      modo: "sin_reparto",
      motivo: "snapshot_del_cierre",
    });
  });

  it("`not_found` (un movimiento de otra cuenta) es un fallo que el panel cuenta dentro de la fila", async () => {
    verOrdenesDeFilaMock.mockResolvedValue({ status: "not_found" });
    await expect(fuenteOrdenesDeFila({ tipo: "tienda", id: TIENDA }).leer(MOV, 1)).rejects.toThrow("not_found");
  });

  it("cada cuenta tiene su propia caché: la clave no es la del libro de la caja", () => {
    expect(fuenteOrdenesDeFila({ tipo: "tienda", id: TIENDA }).clave).not.toBe(
      fuenteOrdenesDeFila({ tipo: "mensajero", id: TIENDA }).clave,
    );
  });
});

describe("R32 (344) — descargar TODAS las órdenes de la fila", () => {
  it("pide las páginas al mismo borde con el tope de página del servidor, hasta el total", async () => {
    const tam = detalleMovimientoConfig.MAX_PAGE_SIZE;
    const p1 = Array.from({ length: tam }, (_, i) => orden(i + 1));
    const p2 = [orden(tam + 1)];
    verOrdenesDeFilaMock.mockImplementation(async (i: { page: number }) =>
      i.page === 1 ? pagina(p1, tam + 1, 1, tam) : pagina(p2, tam + 1, 2, tam),
    );
    const r = await fuenteOrdenesDeFila({ tipo: "tienda", id: TIENDA }).descargar(MOV);
    expect(verOrdenesDeFilaMock).toHaveBeenCalledTimes(2);
    expect(verOrdenesDeFilaMock).toHaveBeenNthCalledWith(1, {
      cuenta: { tipo: "tienda", id: TIENDA },
      movimientoId: MOV,
      page: 1,
      pageSize: tam,
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.filas).toHaveLength(tam + 1);
    // Ni el id de la orden ni ningún otro uuid llega al archivo.
    for (const f of r.filas) expect(JSON.stringify(f)).not.toMatch(UUID);
  });

  it("por encima del tope de las descargas NO hay archivo y no se leen las demás páginas", async () => {
    verOrdenesDeFilaMock.mockResolvedValue(pagina([orden(1)], descargaConfig.MAX_FILAS + 1, 1, 100));
    const r = await fuenteOrdenesDeFila({ tipo: "tienda", id: TIENDA }).descargar(MOV);
    expect(r.status).toBe("error");
    expect(verOrdenesDeFilaMock).toHaveBeenCalledTimes(1);
    if (r.status === "error") expect(r.mensaje).toContain(String(descargaConfig.MAX_FILAS));
  });

  it("sin reparto: el archivo no existe y el motivo se dice en palabras", async () => {
    verOrdenesDeFilaMock.mockResolvedValue({ status: "sin_reparto", motivo: "snapshot_del_cierre" });
    const r = await fuenteOrdenesDeFila({ tipo: "mensajero", id: TIENDA }).descargar(MOV);
    expect(r).toEqual({ status: "error", mensaje: DETALLE_MOVIMIENTO_SIN_REPARTO.snapshot_del_cierre });
  });
});
