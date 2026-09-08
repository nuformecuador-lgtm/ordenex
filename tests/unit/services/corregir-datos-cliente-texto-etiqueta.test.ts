import { describe, expect, it, vi } from "vitest";

import { CorregirDatosClienteService } from "@/lib/services/CorregirDatosClienteService";
import type { CorregirDatosClienteInput } from "@/lib/interfaces/services/ICorregirDatosClienteService";
import type { Actor } from "@/lib/interfaces/services/IOrdenService";
import type {
  DistritoResueltoRow,
  OrdenParaCorreccionRow,
} from "@/lib/interfaces/repositories/IOrdenRepository";
import type { TarifaVigente } from "@/lib/interfaces/repositories/ITarifaVigenteRepository";

/**
 * FICHA 383 (T6) — LA CORRECCION DE DATOS DEL CLIENTE RECHAZA LO QUE NO SE PODRA IMPRIMIR.
 *
 * POR QUE ESTA SUPERFICIE Y NO OTRA: **el alta manual de ordenes no existe**. `IOrdenService`
 * declara desde el 2026-08-07 que es «SOLO LECTURAS» y `crear` se retiro «al quedarse sin
 * superficie». O sea, esta es LA UNICA superficie del sistema donde una persona teclea a mano el
 * destinatario, el telefono, el producto o la direccion de una orden. Sin este bloque, la puerta
 * que la 383 cierra se queda abierta por aqui, con un cartel encima.
 *
 * Y RECHAZA EN VEZ DE REPARAR, al reves que la carga masiva (A2). Mismo criterio que este repo ya
 * aplica al dinero en estas dos mismas superficies: la carga ajusta el monto y lo dice (299), la
 * correccion pregunta antes de escribir (327/R11). En la carga no hay nadie delante de 500 filas;
 * aqui hay una persona mirando ESTA orden.
 *
 * LO QUE ESTE ARCHIVO NO PUEDE PROBAR (heredado de `corregir-datos-cliente-service.test.ts`): el
 * `WHERE` de la ventana. Los dobles no ven el SQL. Eso vive en `tests/integration/db/`.
 */

const ORDEN_ID = "8b1a2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
const TIENDA_ID = "tienda-1";
const MAESTRO: Actor = { usuarioId: "u-maestro", rol: "maestro" };

/** El caracter medido en la orden de la guia 11081885 (2026-09-07). Reparable: `𝕠` -> `o`. */
const DOUBLE_STRUCK_O = "\u{1D560}";
/** Irreparable: ninguna normalizacion vuelve imprimible un emoji. */
const EMOJI = "\u{1F642}";

function orden(overrides: Partial<OrdenParaCorreccionRow> = {}): OrdenParaCorreccionRow {
  return {
    id: ORDEN_ID,
    tiendaId: TIENDA_ID,
    estatusValue: "en_reparto",
    numGuia: 8123,
    destinatario: "Ana Perez",
    telefonoDest: "8888-7777",
    producto: "caja de zapatos",
    notas: "dejar en porteria",
    direccion: "avenida siempre viva 742",
    peso: 1.5,
    montoCobrar: "15000.00",
    cobraComision: true,
    provinciaId: "p-1",
    cantonId: "c-1",
    distritoId: "d-1",
    distritoNombre: "Distrito Uno",
    zonaId: "z-1",
    zonaNombre: "Zona Uno",
    esCentral: false,
    esZonaEspecial: false,
    yaEnUnCierre: false,
    ...overrides,
  };
}

function distrito(): DistritoResueltoRow {
  return {
    id: "d-2",
    nombre: "Distrito Dos",
    cantonId: "c-1",
    provinciaId: "p-1",
    zonaId: "z-2",
    zonaNombre: "Zona Dos",
    esCentral: false,
    esZonaEspecial: false,
    disponible: true,
  };
}

function tarifa(): TarifaVigente {
  return {
    valorFlete: "2000.00",
    valorFleteGam: "1500.00",
    valorFleteDevuelto: "1000.00",
    valorFleteDevueltoGam: "800.00",
    comisionCod: "5.00",
    ivaFlete: "13.00",
    ivaComisionCod: "13.00",
    tarifaEspecial: null,
    tarifaEspecialDevuelta: null,
  };
}

function escenario(ordenFila: OrdenParaCorreccionRow = orden()) {
  const findParaCorreccion = vi.fn(async () => ordenFila);
  const findDistritoParaCorreccion = vi.fn(async () => distrito());
  const corregirDatosCliente = vi.fn(
    async (
      _ordenId: string,
      _data: Record<string, unknown>,
      _estadosBloqueados: readonly string[],
    ) => "ok" as const,
  );
  const resolveTarifa = vi.fn(async () => tarifa());
  const service = new CorregirDatosClienteService(
    { findParaCorreccion, findDistritoParaCorreccion, corregirDatosCliente },
    { resolveTarifa },
  );
  return { service, corregirDatosCliente, findDistritoParaCorreccion };
}

function entrada(extra: Partial<CorregirDatosClienteInput>): CorregirDatosClienteInput {
  return { ordenId: ORDEN_ID, ...extra };
}

describe("383/R17 (T6.1) — lo irreparable no se guarda, y NO se guarda NADA MAS", () => {
  it("un emoji en el destinatario: `validation_error` bajo SU clave", async () => {
    const { service, corregirDatosCliente } = escenario();

    const r = await service.corregir(entrada({ destinatario: `Ana ${EMOJI}` }), MAESTRO);

    expect(r).toEqual({
      status: "validation_error",
      fieldErrors: {
        destinatario: [
          `«destinatario» lleva un carácter que la etiqueta no puede imprimir: «\u2068${EMOJI}\u2069» (U+1F642). Reintentar no lo cambia: escríbelo con letras y números normales.`,
        ],
      },
    });
    // NO basta con mirar el status: lo que R17 exige es que NADA se escriba.
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });

  it("nombre roto + direccion buena: NI LA DIRECCION se escribe", async () => {
    const { service, corregirDatosCliente } = escenario();

    const r = await service.corregir(
      entrada({ destinatario: `Ana ${EMOJI}`, direccion: "calle nueva 100" }),
      MAESTRO,
    );

    expect(r.status).toBe("validation_error");
    // El doble del repositorio no recibio NINGUNA llamada de escritura. Guardar los campos
    // buenos y rechazar solo el malo dejaria la orden a medio corregir sin decirlo.
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });

  it("y lo mismo por los otros tres campos que llegan al papel", async () => {
    for (const [campo, valor] of [
      ["telefonoDest", `8888-${EMOJI}`],
      ["producto", `caja ${EMOJI}`],
      ["direccion", `calle ${EMOJI}`],
    ] as const) {
      const { service, corregirDatosCliente } = escenario();
      const r = await service.corregir(entrada({ [campo]: valor }), MAESTRO);
      expect(r.status, `${campo} deberia rechazarse`).toBe("validation_error");
      if (r.status !== "validation_error") throw new Error("caso mal montado");
      expect(Object.keys(r.fieldErrors)).toEqual([campo]);
      expect(corregirDatosCliente).not.toHaveBeenCalled();
    }
  });
});

describe("383/R18 (T6.2) — lo reparable se rechaza CON la sugerencia, no se aplica solo", () => {
  it("`𝕠rfirio` -> `validation_error` cuyo mensaje trae `orfirio`, y no se escribe nada", async () => {
    const { service, corregirDatosCliente } = escenario();

    const r = await service.corregir(
      entrada({ destinatario: `${DOUBLE_STRUCK_O}rfirio` }),
      MAESTRO,
    );

    expect(r).toEqual({
      status: "validation_error",
      fieldErrors: {
        destinatario: [
          `«destinatario» lleva un carácter que la etiqueta no puede imprimir: «\u2068${DOUBLE_STRUCK_O}\u2069» (U+1D560). Escríbelo así: «orfirio».`,
        ],
      },
    });
    // La mutacion que este caso mata: aplicar la reparacion y devolver `ok`. Ordenex NUNCA guarda
    // un nombre que el humano no haya tecleado.
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });
});

describe("383/R19 (T6.3) — `notas` queda FUERA", () => {
  it("corregir solo `notas` con un emoji: `ok`, y se guarda con el emoji intacto", async () => {
    const { service, corregirDatosCliente } = escenario();

    const r = await service.corregir(entrada({ notas: `dejar en porteria ${EMOJI}` }), MAESTRO);

    expect(r).toEqual({ status: "ok", cambios: ["notas"] });
    expect(corregirDatosCliente).toHaveBeenCalledTimes(1);
    expect(corregirDatosCliente.mock.calls[0][1]).toEqual({
      notas: `dejar en porteria ${EMOJI}`,
    });
  });
});

describe("383 — lo que NO cambia sigue funcionando igual", () => {
  it("una correccion normal se guarda como siempre", async () => {
    const { service, corregirDatosCliente } = escenario();

    const r = await service.corregir(entrada({ destinatario: "Ana Maria Perez" }), MAESTRO);

    expect(r).toEqual({ status: "ok", cambios: ["destinatario"] });
    expect(corregirDatosCliente.mock.calls[0][1]).toEqual({ destinatario: "Ana Maria Perez" });
  });

  it("solo se evalua lo que CAMBIA: un dato viejo con un caracter raro no bloquea al vecino", async () => {
    // La orden ya tiene el nombre roto (cargado antes de esta ficha). Se corrige el PRODUCTO.
    const { service, corregirDatosCliente } = escenario(
      orden({ destinatario: `Ana ${EMOJI}` }),
    );

    const r = await service.corregir(
      entrada({ destinatario: `Ana ${EMOJI}`, producto: "caja grande" }),
      MAESTRO,
    );

    // `destinatario` llega igual que estaba -> no es un cambio -> no se evalua.
    expect(r).toEqual({ status: "ok", cambios: ["producto"] });
    expect(corregirDatosCliente.mock.calls[0][1]).toEqual({ producto: "caja grande" });
  });

  it("y la `ñ` descompuesta se rechaza SIN repetirle a la persona el mismo texto", async () => {
    const { service, corregirDatosCliente } = escenario();

    const r = await service.corregir(entrada({ destinatario: "Nun\u0303ez" }), MAESTRO);

    expect(r.status).toBe("validation_error");
    if (r.status !== "validation_error") throw new Error("caso mal montado");
    // Revision del 2026-09-07 (menor 1). El texto reparado es la `ñ` COMPUESTA, que se pinta
    // igual que lo que la persona acaba de teclear: «Escribelo asi: «Nuñez»» era un mensaje
    // imposible de obedecer. Ahora se dice QUE cambia —los code points, no los pixeles— y se da
    // la unica instruccion que sirve.
    const motivo = r.fieldErrors.destinatario?.[0] ?? "";
    expect(motivo).toContain("U+0303");
    expect(motivo).toContain("está escrita en dos piezas");
    expect(motivo).toContain("Bórrala y vuelve a teclearla");
    expect(motivo).not.toContain("Escríbelo así");
    // Y lo que NO puede volver a aparecer: el texto compuesto enseñado como si fuera otro.
    expect(motivo).not.toContain(String.fromCodePoint(0x004e, 0x0075, 0x00f1, 0x0065, 0x007a));
    // A2 intacta: sigue siendo un rechazo y no se escribe nada.
    expect(corregirDatosCliente).not.toHaveBeenCalled();
  });
});
