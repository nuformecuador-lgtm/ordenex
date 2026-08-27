import { describe, it, expect } from "vitest";
import { resolverValoresOrden } from "@/lib/utils/whatsapp-envio-valores";
import type { OrdenEnvioData } from "@/lib/types/whatsapp-envio";

// Integracion WhatsApp — mapeo de las variables de la plantilla a los datos de la orden.
// Cubre el catalogo pedido por el negocio: cliente, mensajero, guia, producto, total (=
// montoCobrar), sinpe/sinpe_nombre a vacio y cualquier desconocida a vacio.

const ORDEN: OrdenEnvioData = {
  destinatario: "Ana Perez",
  telefonoDest: "573112195060",
  numGuia: 1234,
  numRemision: "REM-9",
  producto: "Caja de zapatos",
  direccion: "Calle 1",
  montoCobrar: 25000,
  mensajeroNombre: "Carlos Ruiz",
};

describe("resolverValoresOrden", () => {
  it("mapea el catalogo del negocio a los campos de la orden", () => {
    const v = resolverValoresOrden(
      ["cliente", "mensajero", "guia", "producto", "total"],
      ORDEN,
    );
    expect(v).toEqual({
      cliente: "Ana Perez",
      mensajero: "Carlos Ruiz",
      guia: "1234",
      producto: "Caja de zapatos",
      total: "₡25.000",
    });
  });

  it("`total` es alias de montoCobrar y `monto` se conserva, ya formateados", () => {
    const v = resolverValoresOrden(["total", "monto"], ORDEN);
    expect(v.total).toBe("₡25.000");
    expect(v.monto).toBe("₡25.000");
  });

  // 2026-08-26: el importe pasa por el `transform` del catalogo, que es el formateador UNICO
  // del repo (`lib/config/moneda.ts`). Quien necesite el numero pelado tiene `monto_crudo`.
  it("`monto_crudo` conserva el numero sin simbolo ni separadores", () => {
    const v = resolverValoresOrden(["monto_crudo"], ORDEN);
    expect(v.monto_crudo).toBe("25000");
  });

  it("`total`/`monto` -> vacio si la orden no tiene monto a cobrar", () => {
    const v = resolverValoresOrden(["total", "monto"], { ...ORDEN, montoCobrar: null });
    expect(v.total).toBe("");
    expect(v.monto).toBe("");
  });

  it("`sinpe` y `sinpe_nombre` resuelven a vacio de forma explicita", () => {
    const v = resolverValoresOrden(["sinpe", "sinpe_nombre"], ORDEN);
    expect(v).toEqual({ sinpe: "", sinpe_nombre: "" });
  });

  it("una variable desconocida cae a vacio", () => {
    const v = resolverValoresOrden(["no_existe"], ORDEN);
    expect(v.no_existe).toBe("");
  });

  it("`mensajero` es vacio cuando la orden no trae nombre del mensajero (flujo wa.me)", () => {
    const v = resolverValoresOrden(["mensajero"], { ...ORDEN, mensajeroNombre: "" });
    expect(v.mensajero).toBe("");
  });

  it("sinonimos guia/num_guia conservados", () => {
    const v = resolverValoresOrden(["guia", "num_guia"], ORDEN);
    expect(v).toEqual({ guia: "1234", num_guia: "1234" });
  });
});
