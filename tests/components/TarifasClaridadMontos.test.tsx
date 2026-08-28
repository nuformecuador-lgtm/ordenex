// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  CobroVehiculoTarifas,
  type CobroVehiculoValue,
} from "@/app/(app)/configuracion/tarifas/_components/CobroVehiculoTarifas";
import { CrearZonaForm } from "@/app/(app)/configuracion/tarifas/_components/CrearZonaForm";
import {
  TarifaCamposGrid,
  tarifaValoresVacios,
  type TarifaValores,
} from "@/app/(app)/configuracion/tarifas/_components/TarifaCampos";
import { AVISO_MONTO_CERO } from "@/app/(app)/configuracion/tarifas/_components/tarifas-labels";
import type { VehiculoDTO } from "@/lib/types/vehiculos";

/**
 * Feature 303 — la pantalla de «Costos por zona» tiene que DECIR lo que cobra y lo que paga.
 *
 * EL INCIDENTE QUE ESTOS TESTS CONGELAN. El cobro por rechazo de la zona GAM estaba en ₡0,00
 * en producción y la pantalla no distinguía «esta zona no paga por rechazo» de «a nadie se le
 * ocurrió ponerlo»: 44 rechazos sin pagar a la bodega y media hora de diagnóstico. Dos cosas
 * lo evitan y las dos se prueban aquí:
 *
 * 1. Los rótulos dicen CUÁNDO aplica cada monto y de QUIÉN es el dinero. «No entregado»
 *    abarcaba tres resultados (`rechazada`, `devuelta`, `reprogramada`) cuando la regla de
 *    `lib/utils/ingreso-bodega.ts` sólo paga por `rechazada`.
 * 2. Un monto en cero lo dice la propia pantalla. Es un AVISO, no un bloqueo: cero puede ser
 *    una decisión legítima; lo que no puede es ser indistinguible del olvido.
 *
 * NINGUNA regla de negocio entra aquí: estos tests miran texto y accesibilidad, nunca el
 * payload que se guarda (eso no lo tocó la 303).
 */

// `CrearZonaForm` (la sección que ENVUELVE el bloque de pagos) sólo se monta aquí para leer
// sus dos textos: nada de esto llega a llamarse.
vi.mock("@/lib/actions/zonas", () => ({
  crearZona: vi.fn(),
  actualizarZona: vi.fn(),
}));
vi.mock("@/lib/actions/tarifas", () => ({
  crearTarifa: vi.fn(),
  actualizarTarifa: vi.fn(),
}));
vi.mock("@/lib/actions/geografia", () => ({
  actualizarDistritosEspeciales: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

const VEHICULOS: VehiculoDTO[] = [
  { id: "v-moto", name: "Moto" },
  { id: "v-carro", name: "Carro" },
];

/** Valor precargado del bloque de pago, como llega al EDITAR una zona ya guardada. */
function cobroInicial(entregado: number, rechazado: number): CobroVehiculoValue {
  return {
    cobroVehiculo: false,
    tarifas: [{ cobroEntregado: entregado, cobroRechazado: rechazado }],
  };
}

/** Rejilla de tarifas con los valores dados; el resto, en blanco. */
function renderGrid(overrides: Partial<TarifaValores> = {}) {
  const valores: TarifaValores = { ...tarifaValoresVacios(), ...overrides };
  return render(
    <TarifaCamposGrid
      idPrefix="test"
      valores={valores}
      errors={{}}
      onChange={() => {}}
    />,
  );
}

/**
 * El campo de la rejilla por su NOMBRE ACCESIBLE. `getByLabelText` no sirve aquí:
 * `FormField` pinta el asterisco de obligatorio DENTRO del `<label>`, así que su texto es
 * «Valor flete*»; el asterisco va `aria-hidden`, de modo que el nombre accesible —lo que de
 * verdad anuncia un lector de pantalla— sí es «Valor flete». Un `<input type="number">` tiene
 * rol `spinbutton`.
 */
const campo = (nombre: string) => screen.getByRole("spinbutton", { name: nombre });
const sinCampo = (nombre: string) => screen.queryByRole("spinbutton", { name: nombre });

beforeEach(() => {
  // El componente escribe el payload en consola en cada cambio (comportamiento previo a la
  // 303, no se toca): se silencia para que el log de la suite siga siendo legible.
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Pago al mensajero por zona — rótulos (CobroVehiculoTarifas)", () => {
  it("no se titula a sí mismo: lo nombra la sección que lo envuelve (feature 310)", () => {
    render(<CobroVehiculoTarifas vehiculos={VEHICULOS} />);

    // El bloque tenía su propio título, y pegado al de la sección eran dos casi iguales
    // seguidos. Lo que aquél aportaba —de quién es cada dinero— no se pierde: lo dice la
    // ayuda de cada campo, que es donde hace falta.
    expect(screen.queryByText(/^Pagos por zona/)).not.toBeInTheDocument();
    // «Monto» no decía de qué dinero hablaba; «Pago al mensajero» atribuía a UNO los DOS
    // montos, y el del rechazo nunca se le paga a él.
    expect(screen.queryByText("Monto")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Pago al mensajero/)).not.toBeInTheDocument();
  });

  it("cada monto dice QUIÉN lo cobra, sin tener que leer el código", () => {
    render(<CobroVehiculoTarifas vehiculos={VEHICULOS} />);

    expect(screen.getByText("Se le paga al mensajero.")).toBeInTheDocument();
    expect(
      screen.getByText("Es ingreso de la bodega, no del mensajero."),
    ).toBeInTheDocument();
  });

  it("la atribución de cada monto cuelga de SU campo, no del vecino", () => {
    render(
      <CobroVehiculoTarifas
        vehiculos={VEHICULOS}
        initial={cobroInicial(1700, 1000)}
      />,
    );

    const ayudaDe = (nombre: string) => {
      const campo = screen.getByLabelText(nombre);
      const id = campo.getAttribute("aria-describedby");
      expect(id).toBeTruthy();
      return document.getElementById(id!.split(" ")[0]);
    };

    expect(ayudaDe("Entregado")).toHaveTextContent("Se le paga al mensajero.");
    expect(ayudaDe("Rechazado por el cliente")).toHaveTextContent(
      "Es ingreso de la bodega, no del mensajero.",
    );
  });

  it("nombra el resultado que REALMENTE paga: «Rechazado por el cliente»", () => {
    render(<CobroVehiculoTarifas vehiculos={VEHICULOS} />);

    // El nombre accesible viene del `<label for>`: antes el `Label` estaba suelto y este
    // `getByLabelText` no habría encontrado nada.
    expect(screen.getByLabelText("Rechazado por el cliente")).toBeInTheDocument();
    expect(screen.getByLabelText("Entregado")).toBeInTheDocument();
    // «No entregado» abarcaba `devuelta` y `reprogramada`, que no pagan nada.
    expect(screen.queryByText("No entregado")).not.toBeInTheDocument();
  });

  it("con cobro por vehículo, cada bloque lo titula SU vehículo", async () => {
    const user = userEvent.setup();
    render(<CobroVehiculoTarifas vehiculos={VEHICULOS} />);

    await user.click(screen.getByLabelText("Cobro por vehículo"));

    // El único título que queda por bloque es el que no se puede deducir mirando la pantalla:
    // de qué vehículo son estos dos montos (feature 310).
    expect(screen.getByText("Moto")).toBeInTheDocument();
    expect(screen.getByText("Carro")).toBeInTheDocument();
    expect(screen.queryByText(/^Pagos por zona/)).not.toBeInTheDocument();
    expect(screen.queryByText("Monto por vehículo")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Pago al mensajero/)).not.toBeInTheDocument();
    // Un par de montos por vehículo, cada uno con su rótulo ya asociado.
    expect(screen.getAllByLabelText("Rechazado por el cliente")).toHaveLength(2);
  });
});

describe("Aviso del cero — pago al mensajero (el caso GAM)", () => {
  it("un monto en cero lo dice la pantalla", () => {
    render(
      <CobroVehiculoTarifas
        vehiculos={VEHICULOS}
        initial={cobroInicial(1700, 0)}
      />,
    );

    // Exactamente UNO: el del rechazo, que es el que está en cero.
    expect(screen.getAllByText(AVISO_MONTO_CERO.pago)).toHaveLength(1);
  });

  it("el aviso cuelga del campo en cero por `aria-describedby`, no suelto en la página", () => {
    render(
      <CobroVehiculoTarifas
        vehiculos={VEHICULOS}
        initial={cobroInicial(1700, 0)}
      />,
    );

    const rechazado = screen.getByLabelText("Rechazado por el cliente");
    const describedBy = rechazado.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const aviso = document.getElementById(describedBy!.split(" ")[0]);
    expect(aviso).toHaveTextContent(AVISO_MONTO_CERO.pago);

    // Y el campo que SÍ tiene monto conserva su atribución pero NO arrastra el aviso del
    // vecino: los dos campos tienen ayuda siempre, y sólo uno está en cero.
    const entregado = screen.getByLabelText("Entregado");
    const ayudaEntregado = document.getElementById(
      entregado.getAttribute("aria-describedby")!.split(" ")[0],
    );
    expect(ayudaEntregado).toHaveTextContent("Se le paga al mensajero.");
    expect(ayudaEntregado).not.toHaveTextContent(AVISO_MONTO_CERO.pago);
  });

  it("con los dos montos mayores que cero NO avisa nada", () => {
    render(
      <CobroVehiculoTarifas
        vehiculos={VEHICULOS}
        initial={cobroInicial(1700, 1000)}
      />,
    );

    expect(screen.queryByText(AVISO_MONTO_CERO.pago)).not.toBeInTheDocument();
  });

  it("el aviso aparece y desaparece al teclear (no es una foto del montaje)", async () => {
    const user = userEvent.setup();
    render(
      <CobroVehiculoTarifas
        vehiculos={VEHICULOS}
        initial={cobroInicial(1700, 0)}
      />,
    );
    const rechazado = screen.getByLabelText("Rechazado por el cliente");

    await user.clear(rechazado);
    await user.type(rechazado, "1000");
    expect(screen.queryByText(AVISO_MONTO_CERO.pago)).not.toBeInTheDocument();

    await user.clear(rechazado);
    await user.type(rechazado, "0");
    expect(screen.getAllByText(AVISO_MONTO_CERO.pago)).toHaveLength(1);
  });

  it("el campo EN BLANCO también avisa: se guarda como 0 y no paga nada", () => {
    // Es el caso «a nadie se le ocurrió ponerlo»: aquí el vacío no es un error de
    // validación, el formulario lo manda como 0.
    render(<CobroVehiculoTarifas vehiculos={VEHICULOS} />);

    expect(screen.getAllByText(AVISO_MONTO_CERO.pago)).toHaveLength(2);
  });

  it("avisa por vehículo: sólo el que está en cero", () => {
    render(
      <CobroVehiculoTarifas
        vehiculos={VEHICULOS}
        initial={{
          cobroVehiculo: true,
          tarifas: [
            { cobroEntregado: 1700, cobroRechazado: 1000, vehiculoId: "v-moto" },
            { cobroEntregado: 2500, cobroRechazado: 0, vehiculoId: "v-carro" },
          ],
        }}
      />,
    );

    // El bloque del carro avisa; el de la moto, no.
    const carro = screen.getByText("Carro").parentElement!;
    expect(within(carro).getAllByText(AVISO_MONTO_CERO.pago)).toHaveLength(1);
    const moto = screen.getByText("Moto").parentElement!;
    expect(within(moto).queryByText(AVISO_MONTO_CERO.pago)).not.toBeInTheDocument();

    // Y no se cuela un aviso de más en el resto de la sección.
    expect(screen.getAllByText(AVISO_MONTO_CERO.pago)).toHaveLength(1);
  });
});

describe("La sección que envuelve el bloque (CrearZonaForm)", () => {
  function renderZona() {
    return render(
      <CrearZonaForm
        mode="crear"
        provincias={[]}
        vehiculos={VEHICULOS}
        zonas={[]}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
  }

  it("ya no le atribuye al mensajero los dos dineros", () => {
    renderZona();

    expect(
      screen.getByRole("heading", { name: "Pagos por zona" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Pago a mensajeros")).not.toBeInTheDocument();
  });

  it("titula la sección UNA sola vez, con y sin cobro por vehículo (feature 310)", async () => {
    const user = userEvent.setup();
    renderZona();

    // El humano lo reportó con captura: «Pagos por zona» y, justo debajo, «Pagos por zona
    // (mensajero y bodega)». Dos títulos casi iguales seguidos. Queda el encabezado.
    const titulos = () => screen.getAllByText(/^Pagos por zona/);
    expect(titulos()).toHaveLength(1);
    expect(titulos()[0]).toBe(screen.getByRole("heading", { name: "Pagos por zona" }));

    await user.click(screen.getByLabelText("Cobro por vehículo"));
    expect(titulos()).toHaveLength(1);
  });

  it("explica los dos destinatarios y no habla de «no entrega»", () => {
    renderZona();

    expect(
      screen.getByText(/la entrega se le paga al mensajero/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/el rechazo del cliente es ingreso de la bodega/i),
    ).toBeInTheDocument();
    // «no entrega» abarcaba `devuelta` y `reprogramada`, que no pagan nada.
    expect(screen.queryByText(/por no entrega/i)).not.toBeInTheDocument();
  });
});

describe("Tarifas de zona/tienda — rótulos (TarifaCampos)", () => {
  it("el flete de retorno dice que sólo aplica a los rechazos", () => {
    renderGrid();

    expect(campo("Flete de retorno (solo rechazos)")).toBeInTheDocument();
    expect(campo("Flete de retorno GAM (solo rechazos)")).toBeInTheDocument();
    // «Devuelto» nombraba justo el resultado que NO cobra desde la ficha 301.
    expect(sinCampo("Valor flete devuelto")).toBeNull();
    expect(sinCampo("Valor flete devuelto GAM")).toBeNull();
  });

  it("la comisión se llama por su nombre, sin la sigla COD", () => {
    renderGrid();

    expect(campo("Comisión por cobro contra entrega (%)")).toBeInTheDocument();
    expect(
      campo("IVA de la comisión por cobro contra entrega (%)"),
    ).toBeInTheDocument();
    expect(sinCampo("Comisión COD (%)")).toBeNull();
    expect(sinCampo("IVA comisión COD (%)")).toBeNull();
  });

  it("conserva los rótulos que el negocio pidió NO tocar", () => {
    renderGrid();

    // «Así es como lo conocen ellos»: decisión explícita, no un olvido de la 303.
    expect(campo("Fulfillment")).toBeInTheDocument();
    expect(campo("Tarifa especial")).toBeInTheDocument();
    expect(campo("Tarifa especial devuelta")).toBeInTheDocument();
    expect(campo("Valor flete")).toBeInTheDocument();
    expect(campo("IVA flete (%)")).toBeInTheDocument();
  });
});

describe("Aviso del cero — tarifas que se cobran", () => {
  it("un campo obligatorio en cero avisa", () => {
    renderGrid({ valorFlete: "0" });

    const aviso = screen.getAllByText(AVISO_MONTO_CERO.cobro);
    expect(aviso).toHaveLength(1);
    const flete = campo("Valor flete");
    expect(flete.getAttribute("aria-describedby")).toBe(
      aviso[0].getAttribute("id"),
    );
  });

  it("con monto mayor que cero NO avisa", () => {
    renderGrid({ valorFlete: "1500" });

    expect(screen.queryByText(AVISO_MONTO_CERO.cobro)).not.toBeInTheDocument();
  });

  it("un porcentaje en cero también avisa: 0 % es tan ambiguo como ₡0", () => {
    renderGrid({ comisionCod: "0" });

    expect(screen.getAllByText(AVISO_MONTO_CERO.cobro)).toHaveLength(1);
  });

  it("el campo EN BLANCO no avisa: ahí manda el mensaje de obligatorio", () => {
    renderGrid();

    expect(screen.queryByText(AVISO_MONTO_CERO.cobro)).not.toBeInTheDocument();
  });

  it("las tarifas especiales NO avisan: un 0 ahí es un pacto, no un olvido", () => {
    // El vacío ya significa «sin pacto especial» y se distingue solo, así que un cero
    // tecleado es deliberado: decirle «sin configurar» sería mentirle.
    renderGrid({ tarifaEspecial: "0", tarifaEspecialDevuelta: "0" });

    expect(screen.queryByText(AVISO_MONTO_CERO.cobro)).not.toBeInTheDocument();
  });
});
