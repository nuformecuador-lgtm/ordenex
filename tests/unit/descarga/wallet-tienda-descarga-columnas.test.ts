import { describe, it, expect, vi } from "vitest";

// FICHA 458-D: los estados de cuenta se importan con sus rótulos; sus actions no se usan aquí.
vi.mock("@/lib/actions/estado-cuenta", () => ({
  verEstadoCuentaAction: vi.fn(),
  verEstadoCuentaCompletoAction: vi.fn(),
  verMiEstadoCuentaAction: vi.fn(),
  verMiEstadoCuentaCompletoAction: vi.fn(),
  verOrdenesDeFilaAction: vi.fn(),
}));
vi.mock("@/lib/actions/como-quedo", () => ({ comoQuedoAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-comprobante", () => ({ verComprobanteAction: vi.fn(), adjuntarComprobanteAction: vi.fn() }));
vi.mock("@/lib/actions/wallet-anulacion", () => ({ anularMovimientoAction: vi.fn() }));
vi.mock("@/lib/actions/usuarios-por-rol", () => ({ listarAdminTiendas: vi.fn(), listarMensajerosActivos: vi.fn() }));
vi.mock("@/lib/actions/wallet-tienda", () => ({
  verDetalleDeMiMovimientoAction: vi.fn(),
  verDetalleDeMiMovimientoCompletoAction: vi.fn(),
}));
import {
  COLUMNAS_DESCARGA_MI_ESTADO_CUENTA,
  filaDescargaEstadoCuenta,
} from "@/components/shared/estado-cuenta/estado-cuenta-descarga-columnas";
import { lineaDeFila } from "@/components/shared/estado-cuenta/estado-cuenta-lineas";
import { ROTULOS_MI_WALLET } from "@/app/(app)/mi-wallet/_components/MiEstadoCuenta";
import type { FilaEstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import { fila as filaEstado } from "@/tests/fixtures/estado-cuenta";

// Feature 170 / T C.3 (R5/R7/R8/R23) — columnas de export del libro de la tienda en `/mi-wallet`.
//
// FICHA 458-D (T D.5): la descarga de `/mi-wallet` es la del ESTADO DE CUENTA de la tienda (vista
// tienda: sin «Registró»), con el saldo corrido y el saldo inicial (R32). Los mismos requisitos de la
// 170 —columnas enumeradas en el orden de la pantalla, monto TAL CUAL, etiquetas legibles, valores
// crudos, ningún identificador— sobre la proyección nueva (`lineaDeFila` + `filaDescargaEstadoCuenta`).

/** La fila del estado de cuenta de la tienda, en la vista de la tienda (sin nombres de Ordenex). */
function filaTienda(parcial: Partial<FilaEstadoCuentaDTO>): FilaEstadoCuentaDTO {
  return filaEstado({ registro: { nombre: null, automatico: null }, ...parcial });
}

const MOV = filaTienda({
  ref: { libro: "tienda", movimientoId: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f" },
  fecha: "2026-07-12",
  categoria: "cod_recaudado",
  origen: { texto: "Cierre del día · 2026-07-12", enlace: null },
  descripcion: "Cierre del 12 de julio",
  abono: "98765432109.87",
  saldoCorrido: "98765432109.87",
});

function descarga(f: FilaEstadoCuentaDTO) {
  return filaDescargaEstadoCuenta(lineaDeFila(f, ROTULOS_MI_WALLET));
}

describe("columnas de descarga del estado de cuenta de la tienda", () => {
  it("declara sus columnas ENUMERADAS, en el orden de la pantalla (R5)", () => {
    expect(COLUMNAS_DESCARGA_MI_ESTADO_CUENTA.map((c) => c.clave)).toEqual([
      "fecha",
      "movimiento",
      "motivo",
      "origen",
      "pago",
      "cargo",
      "abono",
      "saldo",
      "estado",
    ]);
  });

  it("emite el monto TAL CUAL, sin recalcularlo ni adornarlo (R7)", () => {
    const fila = descarga(MOV);
    expect(fila.abono).toBe("98765432109.87");
    expect(typeof fila.abono).toBe("string");
    expect(String(fila.abono)).not.toContain("₡");
    expect(descarga({ ...MOV, abono: "1000.10" }).abono).toBe("1000.10");
    expect(String(Number("1000.10"))).toBe("1000.1"); // lo que habría pasado al parsear
  });

  it("emite el concepto como ETIQUETA LEGIBLE desde la tienda, no como valor interno (R8, 461 R44)", () => {
    const fila = descarga(MOV);
    expect(fila.movimiento).toBe("Cobrado a tus clientes en contra-entrega");
    expect(fila.movimiento).not.toBe("cod_recaudado");
  });

  it("el origen con su entidad y el motivo, cada uno en su columna, como en la tabla (R8/R24)", () => {
    expect(descarga(MOV).origen).toBe("Cierre del día · 2026-07-12");
    expect(descarga(MOV).motivo).toBe("Cierre del 12 de julio");
    expect(descarga({ ...MOV, descripcion: null }).motivo).toBeNull();
  });

  it("emite la fecha como día calendario, igual que la tabla (R11/R24)", () => {
    expect(descarga(MOV).fecha).toBe("2026-07-12");
  });

  it("emite valores CRUDOS: texto, número o celda vacía, nunca objetos (R7)", () => {
    for (const [clave, celda] of Object.entries(descarga(MOV))) {
      const tipo = celda === null ? "null" : typeof celda;
      expect(["string", "number", "null"], `columna ${clave}`).toContain(tipo);
    }
  });

  it("no expone identificadores internos: ni el del movimiento, ni la tienda, ni el origen (R23)", () => {
    const fila = descarga(MOV);
    expect(fila).not.toHaveProperty("id");
    expect(fila).not.toHaveProperty("ref");
    expect(fila).not.toHaveProperty("tiendaId");
    for (const celda of Object.values(fila)) {
      if (typeof celda === "string") {
        expect(celda).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      }
    }
  });
});

// ⭑ FICHA 381 (T I.2, R39) — EL COBRO EN LA DESCARGA DEL LIBRO DE LA TIENDA, con el LITERAL que la
// tienda lee en la tabla (no contra el diccionario: sería una aserción contra su propia fuente).
//
// ⭑ FICHA 461 (R44, P4) — la tienda descarga «Ordenex te cobró» y la oficina «Ordenex le cobra a la
// tienda»; el resto de la fila (fecha, monto, motivo) es el mismo, y se afirma cruzado.
describe("⭑ FICHA 381/461 (R39/R44) — el cobro sale en el archivo con el nombre de SU pantalla", () => {
  const COBRO = filaTienda({
    ref: { libro: "tienda", movimientoId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    fecha: "2026-09-08",
    categoria: "cobro_manual",
    origenTipo: "manual",
    origen: { texto: "Registrado a mano", enlace: null },
    descripcion: "Material de despacho entregado en bodega",
    chip: "cobros",
    naceDeUnCierre: false,
    abono: null,
    cargo: "15000.00",
  });

  it("la columna «Movimiento» dice «Ordenex te cobró», no el valor del enum; el importe es un cargo", () => {
    const fila = descarga(COBRO);
    expect(fila.movimiento).toBe("Ordenex te cobró");
    expect(fila.movimiento).not.toBe("cobro_manual");
    expect(fila.cargo).toBe("15000.00");
    expect(fila.abono).toBeNull();
  });

  it("emite el importe TAL CUAL y arrastra el motivo tecleado", () => {
    const fila = descarga(COBRO);
    expect(typeof fila.cargo).toBe("string");
    expect(fila.origen).toBe("Registrado a mano");
    expect(fila.motivo).toBe("Material de despacho entregado en bodega");
    expect(fila.fecha).toBe("2026-09-08");
  });

  it("⭑ 461 R44: la tienda y la oficina descargan el MISMO movimiento con DOS lecturas del concepto", async () => {
    const { ROTULOS_TIENDA } = await import("@/app/(app)/wallet/tiendas/_components/EstadoCuentaTienda");
    const tienda = lineaDeFila(COBRO, ROTULOS_MI_WALLET);
    const oficina = lineaDeFila(COBRO, ROTULOS_TIENDA);
    expect(tienda.movimiento).toBe("Ordenex te cobró");
    expect(oficina.movimiento).toBe("Ordenex le cobra a la tienda");
    expect(tienda.movimiento).not.toBe(oficina.movimiento);
    expect(tienda.fecha).toBe(oficina.fecha);
    expect(tienda.cargo).toBe(oficina.cargo);
    expect(tienda.motivo).toBe(oficina.motivo);
  });

  it("un cobro y una corrección NO se confunden en el archivo (R33/D2)", () => {
    const ajuste = { ...COBRO, categoria: "ajuste_debito" };
    expect(descarga(ajuste).movimiento).toBe("Corrección en tu contra");
    expect(descarga(COBRO).movimiento).not.toBe(descarga(ajuste).movimiento);
  });
});
