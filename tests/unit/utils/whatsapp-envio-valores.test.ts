import { describe, it, expect } from "vitest";
import { resolverValoresOrden } from "@/lib/utils/whatsapp-envio-valores";
import type { SinpeBodega } from "@/lib/utils/sinpe-bodega";

/**
 * ⭑ FICHA 429 (T12) — EL PAR DEL SINPE ES AHORA UN PARAMETRO OBLIGATORIO.
 *
 * Antes salia de `negocioDesdeEnv()`, que leia dos variables de entorno y devolvia `""` cuando
 * faltaban. Esa es justamente la razon de que ahora sea un parametro: un llamador que se lo olvide
 * NO COMPILA, en vez de emitir un mensaje mudo. Valores FICTICIOS: el repositorio es publico.
 */
const SINPE: SinpeBodega = { numero: "80000000", nombre: "Titular de Prueba" };
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
      SINPE,
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
    const v = resolverValoresOrden(["total", "monto"], ORDEN, SINPE);
    expect(v.total).toBe("₡25.000");
    expect(v.monto).toBe("₡25.000");
  });

  // 2026-08-26: el importe pasa por el `transform` del catalogo, que es el formateador UNICO
  // del repo (`lib/config/moneda.ts`). Quien necesite el numero pelado tiene `monto_crudo`.
  it("`monto_crudo` conserva el numero sin simbolo ni separadores", () => {
    const v = resolverValoresOrden(["monto_crudo"], ORDEN, SINPE);
    expect(v.monto_crudo).toBe("25000");
  });

  it("`total`/`monto` -> vacio si la orden no tiene monto a cobrar", () => {
    const v = resolverValoresOrden(["total", "monto"], { ...ORDEN, montoCobrar: null }, SINPE);
    expect(v.total).toBe("");
    expect(v.monto).toBe("");
  });

  // ⭑ FICHA 429 (R17) — ESTE CASO CAMBIA DE SENTIDO, Y ES EL PUNTO DE LA FICHA.
  // Antes afirmaba que las dos claves salian VACIAS «de forma explicita», porque su origen eran
  // dos variables de entorno que en un test no estan puestas. Ese vacio era EXACTAMENTE el fallo
  // mudo que la ficha cierra: el mensaje salia sin numero y nada lo avisaba. Ahora el par entra
  // por parametro obligatorio, asi que lo que se afirma es que llega ENTERO hasta el texto.
  it("`sinpe` y `sinpe_nombre` salen del par que el servidor resolvio, nunca del entorno", () => {
    const v = resolverValoresOrden(["sinpe", "sinpe_nombre"], ORDEN, SINPE);
    expect(v).toEqual({ sinpe: SINPE.numero, sinpe_nombre: SINPE.nombre });
    expect(v.sinpe).not.toBe("");
  });

  it("una variable desconocida cae a vacio", () => {
    const v = resolverValoresOrden(["no_existe"], ORDEN, SINPE);
    expect(v.no_existe).toBe("");
  });

  it("`mensajero` es vacio cuando la orden no trae nombre del mensajero (flujo wa.me)", () => {
    const v = resolverValoresOrden(["mensajero"], { ...ORDEN, mensajeroNombre: "" }, SINPE);
    expect(v.mensajero).toBe("");
  });

  it("sinonimos guia/num_guia conservados", () => {
    const v = resolverValoresOrden(["guia", "num_guia"], ORDEN, SINPE);
    expect(v).toEqual({ guia: "1234", num_guia: "1234" });
  });
});
