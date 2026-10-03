import { describe, it, expect, vi } from "vitest";

// FICHA 458-D: los estados de cuenta se importan con sus rótulos; sus actions no se usan aquí.
vi.mock("@/lib/actions/estado-cuenta", () => ({
  verEstadoCuentaAction: vi.fn(),
  estadoCuentaKardexAction: vi.fn(),
  estadoCuentaKardexConDetalleAction: vi.fn(),
  verMiEstadoCuentaAction: vi.fn(),
  miEstadoCuentaKardexAction: vi.fn(),
  miEstadoCuentaKardexConDetalleAction: vi.fn(),
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
import { COLUMNAS_DESCARGA_MI_ESTADO_CUENTA } from "@/components/shared/estado-cuenta/estado-cuenta-descarga-columnas";
import { lineaDeFila } from "@/components/shared/estado-cuenta/estado-cuenta-lineas";
import { filaDeLibroCuenta } from "@/tests/fixtures/libro-kardex";
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

/** Ficha 468: la fila de la hoja «Movimientos» (kardex) que coloca la descarga real. */
function descarga(f: FilaEstadoCuentaDTO) {
  return filaDeLibroCuenta(f, ROTULOS_MI_WALLET);
}

describe("columnas de descarga del estado de cuenta de la tienda", () => {
  it("declara sus columnas ENUMERADAS (468 R3: el kardex de /mi-wallet, sin «Registró»)", () => {
    expect(COLUMNAS_DESCARGA_MI_ESTADO_CUENTA.map((c) => c.clave)).toEqual([
      "fecha",
      "concepto",
      "detalle",
      "entra",
      "sale",
      "saldo",
    ]);
  });

  it("emite el monto TAL CUAL, sin recalcularlo ni adornarlo (R7; 468: en su columna)", () => {
    const fila = descarga(MOV);
    expect(fila.entra).toBe("98765432109.87");
    expect(typeof fila.entra).toBe("string");
    expect(String(fila.entra)).not.toContain("₡");
    expect(descarga({ ...MOV, abono: "1000.10" }).entra).toBe("1000.10");
    expect(String(Number("1000.10"))).toBe("1000.1"); // lo que habría pasado al parsear
  });

  it("emite el concepto como ETIQUETA LEGIBLE desde la tienda, no como valor interno (R8, 461 R44; 468 R17)", () => {
    const fila = descarga(MOV);
    expect(fila.concepto).toBe("Cobrado a tus clientes en contra-entrega");
    expect(fila.concepto).not.toBe("cod_recaudado");
  });

  it("el origen con su entidad y el motivo, juntos en «Detalle» como en la tabla (R8/R24; 468 R18)", () => {
    expect(descarga(MOV).detalle).toBe("Cierre del día · 2026-07-12 · Cierre del 12 de julio");
    expect(descarga({ ...MOV, descripcion: null }).detalle).toBe("Cierre del día · 2026-07-12");
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

  it("la columna «Concepto» dice «Ordenex te cobró», no el valor del enum; el importe sale (468 R9)", () => {
    const fila = descarga(COBRO);
    expect(fila.concepto).toBe("Ordenex te cobró");
    expect(fila.concepto).not.toBe("cobro_manual");
    expect(fila.sale).toBe("15000.00");
    expect(fila.entra).toBeNull();
  });

  it("emite el importe TAL CUAL y arrastra el motivo tecleado", () => {
    const fila = descarga(COBRO);
    expect(typeof fila.sale).toBe("string");
    expect(fila.detalle).toBe("Registrado a mano · Material de despacho entregado en bodega");
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
    expect(descarga(ajuste).concepto).toBe("Corrección en tu contra");
    expect(descarga(COBRO).concepto).not.toBe(descarga(ajuste).concepto);
  });
});
