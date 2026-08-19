// @vitest-environment jsdom
// Feature 205 (T5.5) — PAGAR a un mensajero desde `/wallet/mensajeros`. Cubre R3, R15, R25,
// R27, R28, R31, R34 y R44.
//
// Las dos propiedades que este archivo protege, y ninguna de las dos es «el botón existe»:
//
//  1. **LA CLAVE DE IDEMPOTENCIA se acuña al ABRIR el formulario y sobrevive al reintento.**
//     El backend se gastó una tabla entera con un `UNIQUE` para que dos peticiones iguales no
//     cobren dos veces, y esa barrera solo se activa si el cliente reenvía la MISMA clave. Un
//     reintento con clave nueva es un segundo pago, y ningún test de servidor lo vería.
//  2. **Al terminar se enseña lo APLICADO, no lo previsualizado.** Entre mirar y confirmar,
//     otro pudo haber pagado: el servidor recalcula bajo bloqueo y puede repartir distinto. Por
//     eso los datos del reparto aplicado que devuelve la escritura NO coinciden a propósito con
//     los de la previsualización en estos casos: si la pantalla repitiera lo que enseñó antes,
//     estos asserts caerían.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

import {
  LLAMADAS_PROHIBIDAS_EN_DINERO,
  codigoSinComentarios,
} from "@/tests/fixtures/money-safe";
import type {
  PrevisualizacionRepartoDTO,
  RegistrarRepartoResult,
} from "@/lib/types/liquidacion-reparto";
import type { CuentaPorPagarResumenDTO } from "@/lib/types/wallet-mensajero";

const { previsualizarMock, registrarMock } = vi.hoisted(() => ({
  previsualizarMock: vi.fn(),
  registrarMock: vi.fn(),
}));

vi.mock("@/lib/actions/liquidacion", () => ({
  previsualizarRepartoMensajeroAction: (...args: unknown[]) => previsualizarMock(...args),
  registrarRepartoMensajeroAction: (...args: unknown[]) => registrarMock(...args),
}));

const { successMock, errorMock, infoMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
  infoMock: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    info: infoMock,
    warning: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { PagoMensajeroAcciones } from "@/app/(app)/wallet/mensajeros/_components/PagoMensajeroAcciones";

// --- Datos ---------------------------------------------------------------

const MENSAJERO = "1e2d3c4b-5a69-4788-9900-aabbccddeeff";
const CIERRE_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const CIERRE_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const CIERRE_C = "cccccccc-3333-4333-8333-cccccccccccc";

/** La fila del mensajero. Su cuenta por pagar es la MISMA que la de la previsualización (R37). */
const RESUMEN: CuentaPorPagarResumenDTO = {
  mensajeroId: MENSAJERO,
  mensajeroNombre: "Ana Mensajera",
  devengado: "96000.00",
  pagado: "74850.00",
  cuentaPorPagar: "21150.00",
  signo: "positivo",
};

/**
 * LOS TRES IMPUTABLES SON TRES COSAS DISTINTAS, y por eso valen tres cifras distintas. Cuando
 * los tres valían `"7000.00"`, proponer como monto el imputable TOTAL en vez del de la ventana
 * dejaba 43 tests en verde — y en producción habría propuesto un importe que el servidor
 * rechaza con `excede`. La historia de Ana, de fuera hacia dentro:
 *
 *  - **cuenta por pagar: ₡21.150** — lo que la fila enseña como deuda (R37);
 *  - **₡2.300 no cuelga de ningún cierre** (ajustes manuales): esta pantalla no los sabe pagar;
 *  - **imputable TOTAL: ₡18.850** — sus cinco cierres aprobados con saldo;
 *  - **el tope recorta**: entran los TRES más antiguos, quedan DOS fuera por ₡6.450 (R56);
 *  - **imputable: ₡12.400** — lo que UN pago puede saldar ahora, y por tanto lo que el
 *    formulario propone como monto (4.000 + 5.000 + 3.400).
 *
 * `21.150 = 18.850 + 2.300` y `18.850 = 12.400 + 6.450`. El `tope` va a 3 —es inyectable
 * justamente para esto— para que el recorte se pueda contar con cinco cierres y no con 51.
 */
function previsualizacion(
  parcial: Partial<PrevisualizacionRepartoDTO> = {},
): PrevisualizacionRepartoDTO {
  return {
    mensajeroNombre: "Ana Mensajera",
    imputable: "12400.00",
    imputableTotal: "18850.00",
    cuentaPorPagar: "21150.00",
    deudaNoImputable: { hay: true, monto: "2300.00" },
    recorte: { aplicado: true, tope: 3, enVentana: 3, fuera: 2, montoFuera: "6450.00" },
    imputaciones: [
      {
        cierreId: CIERRE_A,
        solicitadoAt: "2026-07-28T06:00:00.000Z",
        pendienteActual: "4000.00",
        monto: "4000.00",
        pendienteDespues: "0.00",
        parcial: false,
      },
      {
        cierreId: CIERRE_B,
        solicitadoAt: "2026-07-30T06:00:00.000Z",
        pendienteActual: "5000.00",
        monto: "5000.00",
        pendienteDespues: "0.00",
        parcial: false,
      },
      {
        cierreId: CIERRE_C,
        solicitadoAt: "2026-08-01T06:00:00.000Z",
        pendienteActual: "3400.00",
        monto: "3400.00",
        pendienteDespues: "0.00",
        parcial: false,
      },
    ],
    sobrante: "0.00",
    excede: false,
    excluidos: [],
    ...parcial,
  };
}

/**
 * El reparto REALMENTE aplicado, y **no coincide con la previsualización a propósito**: con el
 * formulario abierto se ANULÓ un pago de ₡3.400 sobre el cierre más antiguo, así que su
 * pendiente subió de ₡4.000 a ₡7.400 y los mismos ₡12.400 comprometidos se repartieron entre
 * DOS cierres en vez de tres.
 *
 * El total SÍ coincide con lo tecleado, y no por comodidad: un reparto que aplicara menos de lo
 * pedido no responde `ok`, responde `excede` (R14). Lo que cambia bajo bloqueo es a QUIÉN le
 * toca, que es lo que esta pantalla tiene que enseñar.
 *
 * `restanteImputable` = 18.850 + 3.400 (lo devuelto por la anulación) − 12.400 = ₡9.850: los dos
 * cierres que el tope dejó fuera más el que se quedó sin nada. Que sea > 0 no es un error, es lo
 * que dice que hace falta otro registro.
 */
const APLICADO: RegistrarRepartoResult = {
  status: "ok",
  reparto: {
    totalImputado: "12400.00",
    restanteImputable: "9850.00",
    imputaciones: [
      { cierreId: CIERRE_A, monto: "7400.00", pendienteDespues: "0.00" },
      { cierreId: CIERRE_B, monto: "5000.00", pendienteDespues: "0.00" },
    ],
  },
};

function montar(onRegistrado?: () => void | Promise<void>) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PagoMensajeroAcciones
        resumen={RESUMEN}
        onRegistrado={onRegistrado}
        esperaPrevisualizacionMs={0}
      />
    </SWRConfig>,
  );
}

const abrir = () => screen.getByRole("button", { name: "Registrar pago" });
const dialogo = () => screen.getByRole("dialog");
const confirmar = () => within(dialogo()).getByRole("button", { name: "Registrar pago" });
/** El bloque de lo APLICADO. Se busca acotado: el total repartido y el imputable coinciden. */
const resultado = () => screen.getByRole("region", { name: "Último pago registrado" });

/** Abre el formulario y espera a que la previsualización de dentro haya respondido. */
async function abrirFormulario() {
  await waitFor(() => expect(abrir()).toBeEnabled());
  fireEvent.click(abrir());
  await screen.findByRole("dialog");
  await within(dialogo()).findByText("Se aplica ₡4.000");
}

/** Las claves de idempotencia enviadas, en orden. */
function clavesEnviadas(): string[] {
  return registrarMock.mock.calls.map(([campos]) => campos.claveIdempotencia);
}

beforeEach(() => {
  vi.clearAllMocks();
  previsualizarMock.mockResolvedValue({ status: "ok", previsualizacion: previsualizacion() });
  registrarMock.mockResolvedValue(APLICADO);
});

afterEach(() => {
  cleanup();
});

// -------------------------------------------------------------------------

describe("R3/R15 — el control vive en el desglose y dice cuándo no hay nada que pagar", () => {
  it("ofrece registrar el pago con lo que el servidor dice que se puede pagar", async () => {
    montar();

    // El importe es el STRING del servidor, con formato y nada más: no se deriva del resumen.
    // Y es el de la VENTANA (₡12.400), no el imputable total (₡18.850) ni la cuenta por pagar
    // (₡21.150): las otras dos cifras son deuda que este pago NO puede saldar.
    expect(await screen.findByText("₡12.400")).toBeInTheDocument();
    await waitFor(() => expect(abrir()).toBeEnabled());
  });

  it("sin nada imputable el control queda deshabilitado y se explica por qué", async () => {
    // Le siguen debiendo ₡2.300, pero no cuelgan de ningún cierre: hay deuda y aun así no hay
    // nada que pagar desde acá, que es lo que el texto tiene que explicar.
    previsualizarMock.mockResolvedValue({
      status: "ok",
      previsualizacion: previsualizacion({
        imputable: "0.00",
        imputableTotal: "0.00",
        cuentaPorPagar: "2300.00",
        recorte: { aplicado: false, tope: 3, enVentana: 0, fuera: 0, montoFuera: "0.00" },
        imputaciones: [],
      }),
    });
    montar();

    await waitFor(() => expect(abrir()).toBeDisabled());
    expect(
      screen.getByText(
        "Este mensajero no tiene cierres aprobados con saldo pendiente: no hay nada que pagar desde acá.",
      ),
    ).toBeInTheDocument();
    // Y el formulario ni se monta: acuñar una clave para una solicitud imposible no tendría
    // ningún sentido.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("si la lectura falla, lo dice y no ofrece pagar", async () => {
    previsualizarMock.mockResolvedValue({ status: "forbidden" });
    montar();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo calcular lo que se puede pagar.",
    );
    expect(abrir()).toBeDisabled();
  });
});

describe("R9/R34 — qué se manda al servidor", () => {
  it("la petición lleva el mensajero y NUNCA un cierre: contra cuáles se imputa lo decide el servidor", async () => {
    montar();
    await abrirFormulario();

    fireEvent.click(confirmar());
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));

    const campos = registrarMock.mock.calls[0][0];
    expect(campos).toMatchObject({
      mensajeroId: MENSAJERO,
      // El monto se propone con el imputable DE LA VENTANA y viaja como STRING, tal cual.
      // Proponer el imputable total (₡18.850) sería proponer un importe que el servidor
      // rechaza con `excede`: el tope recortó la ventana a ₡12.400.
      monto: "12400.00",
      metodo: "efectivo",
    });
    expect(campos).not.toHaveProperty("cierreId");
    expect(typeof campos.claveIdempotencia).toBe("string");
  });
});

describe("R27/R31 — la clave de idempotencia", () => {
  it("el reintento tras un fallo viaja con la MISMA clave", async () => {
    // Ésta es la que impide el doble cobro: un fallo de red puede haber dejado el pago escrito
    // igualmente. Con la misma clave el servidor responde `ya_registrado`; con otra, cobra dos
    // veces.
    registrarMock.mockRejectedValueOnce(new Error("se cayó la red"));
    montar();
    await abrirFormulario();

    fireEvent.click(confirmar());
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));
    // El formulario sigue abierto con lo escrito.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(errorMock).toHaveBeenCalledWith(
      "No se registró el pago. Revisá el aviso del formulario e intentá de nuevo.",
    );

    fireEvent.click(confirmar());
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(2));

    const [primera, segunda] = clavesEnviadas();
    expect(segunda).toBe(primera);
  });

  it("un rechazo del servidor tampoco renueva la clave", async () => {
    registrarMock.mockResolvedValueOnce({ status: "excede", disponible: "6500.00" });
    montar();
    await abrirFormulario();

    fireEvent.click(confirmar());
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));
    // El aviso lo da el propio formulario, con el disponible que mandó el servidor.
    expect(
      await within(dialogo()).findByText(/Disponible: ₡6\.500/),
    ).toBeInTheDocument();

    fireEvent.click(confirmar());
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(2));
    expect(clavesEnviadas()[1]).toBe(clavesEnviadas()[0]);
  });

  it("abrir el formulario DE NUEVO tras registrar acuña una clave nueva: es otro pago (R30)", async () => {
    montar();
    await abrirFormulario();

    fireEvent.click(confirmar());
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    fireEvent.click(abrir());
    await screen.findByRole("dialog");
    fireEvent.click(confirmar());
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(2));

    expect(clavesEnviadas()[1]).not.toBe(clavesEnviadas()[0]);
  });
});

describe("R25 — al terminar se enseña lo APLICADO, no lo previsualizado", () => {
  it("pinta el reparto que devolvió la escritura, aunque difiera de lo que se vio", async () => {
    montar();
    await abrirFormulario();

    fireEvent.click(confirmar());
    await waitFor(() => expect(registrarMock).toHaveBeenCalledTimes(1));

    // Todo acotado al bloque de lo aplicado: la cabecera pinta el imputable (₡12.400) y el
    // total repartido vale lo mismo, así que sin acotar «₡12.400» sale dos veces.
    const bloque = await screen.findByRole("region", { name: "Último pago registrado" });
    // El total APLICADO, y el reparto por cierre que devolvió la ESCRITURA (₡7.400), no el
    // que se previsualizó.
    expect(within(bloque).getByText("₡12.400")).toBeInTheDocument();
    expect(within(bloque).getByText("₡7.400")).toBeInTheDocument();
    // Y lo que SIGUE debiéndose por cierres tras el pago, que es lo que dice que hace falta
    // otro registro. Es el imputable TOTAL restante, no el de la ventana.
    expect(within(bloque).getByText("₡9.850")).toBeInTheDocument();
    // La cifra que la previsualización daba a ese cierre NO se repite: se aplicó otra.
    expect(within(bloque).queryByText("₡4.000")).not.toBeInTheDocument();
  });

  it("cada cierre del resultado lleva su enlace al detalle (R44)", async () => {
    montar();
    await abrirFormulario();
    fireEvent.click(confirmar());
    await screen.findByRole("region", { name: "Último pago registrado" });

    // DOS enlaces, uno por imputación APLICADA: la previsualización enseñaba tres cierres y el
    // tercero se quedó sin nada, así que no tiene detalle que abrir desde acá.
    const enlaces = within(resultado()).getAllByRole("link", { name: /^Ver el cierre/ });
    expect(enlaces).toHaveLength(2);
    expect(enlaces[0]).toHaveAttribute("href", `/cierres-admin?cierre=${CIERRE_A}`);
    expect(enlaces[1]).toHaveAttribute("href", `/cierres-admin?cierre=${CIERRE_B}`);
  });

  it("avisa del pago con el total del SERVIDOR y refresca lo de ESTE mensajero", async () => {
    const refrescado = vi.fn();
    montar(refrescado);
    await abrirFormulario();

    previsualizarMock.mockClear();
    fireEvent.click(confirmar());

    await waitFor(() =>
      expect(successMock).toHaveBeenCalledWith("Pago de ₡12.400 registrado."),
    );
    // El padre es quien refresca el desglose: acá se le avisa.
    await waitFor(() => expect(refrescado).toHaveBeenCalledTimes(1));
    // Y la previsualización de este mensajero se vuelve a leer: el imputable cambió.
    await waitFor(() => expect(previsualizarMock).toHaveBeenCalled());
  });

  it("la respuesta idempotente enseña el reparto ORIGINAL y lo dice sin alarmar", async () => {
    registrarMock.mockResolvedValueOnce({
      status: "ya_registrado",
      reparto: APLICADO.status === "ok" ? APLICADO.reparto : undefined,
    });
    montar();
    await abrirFormulario();

    fireEvent.click(confirmar());
    await waitFor(() =>
      expect(infoMock).toHaveBeenCalledWith(
        "Este pago ya estaba registrado: se conservó el reparto original y no se cobró dos veces.",
      ),
    );
    // El reparto ORIGINAL, el mismo que devolvió la primera escritura: ₡7.400 al cierre más
    // antiguo, que no es lo que la previsualización enseñaba.
    const bloque = await screen.findByRole("region", { name: "Último pago registrado" });
    expect(within(bloque).getByText("₡7.400")).toBeInTheDocument();
    expect(within(bloque).getByText("₡12.400")).toBeInTheDocument();
    expect(successMock).not.toHaveBeenCalled();
  });
});

describe("money-safe", () => {
  it("el cableado no convierte ningún importe a número", () => {
    const fuente = codigoSinComentarios(
      "app/(app)/wallet/mensajeros/_components/PagoMensajeroAcciones.tsx",
    );
    for (const patron of LLAMADAS_PROHIBIDAS_EN_DINERO) {
      expect(fuente, `patrón ${patron}`).not.toMatch(patron);
    }
    expect(fuente).not.toMatch(/from\s+"(@prisma\/client|decimal\.js[^"]*)"/);
  });
});
