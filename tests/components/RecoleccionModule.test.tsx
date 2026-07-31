// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RecoleccionModule } from "@/app/(app)/recoleccion/_components/RecoleccionModule";
import { recolectarEnTiendaPorQr } from "@/lib/actions/recoleccion-tienda";
import { TOPE_RECOLECTADAS_HOY } from "@/lib/constants/recoleccion-tienda";
import type {
  RecolectadaHoyDTO,
  RecoleccionOrdenDTO,
} from "@/lib/types/recoleccion-tienda";

// Feature 157 (R13-R24) + 167 — apartado propio del mensajero para lo que recoge EN LA
// TIENDA. Este archivo viene de `RecoleccionTiendaPanel.test.tsx` (renombrado con el
// componente) y protege tanto lo que el apartado MUESTRA —agrupado por tienda, con su
// contacto, más lo ya recolectado hoy— como lo que NO ofrece: aquí no hay gestión, ni cobro,
// ni evidencia, ni resultado que elegir. Un apartado que empiece a parecerse al de gestión es
// un apartado equivocado.
//
// DOS casos de la 157 quedaron INVALIDADOS por la 167 y están sustituidos (design §9):
//   · "sin nada que recolectar el apartado no se muestra"  ->  contradecía R7. Ahora:
//     "R7/R8: con la lista VACÍA el escáner sigue montado y el vacío se explica".
//   · "R21: una guía que NO es suya se rechaza en cliente" ->  contradecía R12. Ahora:
//     "R12: una guía que NO está en la lista cargada SÍ llega al servidor".
// Ningún otro assert de la 157 se perdió.

vi.mock("@/lib/actions/recoleccion-tienda", () => ({
  recolectarEnTiendaPorQr: vi.fn(),
}));

// El módulo ya no recibe `onRecolectada` por props: es el componente de cliente que la página
// (Server Component) monta, así que revalida por su cuenta con `router.refresh()`.
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn() }),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
const toastInfo = vi.fn();
vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    error: toastError,
    success: toastSuccess,
    info: toastInfo,
    warning: vi.fn(),
  }),
}));

// El escáner monta la cámara vía html5-qrcode, que jsdom no puede abrir. Se sustituye por un
// disparador manual del MISMO callback (`onDecoded`) para poder ejercer la vía cámara (R10):
// lo que se prueba es el camino del componente, no la librería (que tiene su propio test).
const TEXTO_QR = (numGuia: number) => `https://ordenex.test/paquete/${numGuia}`;
let textoEscaneado = TEXTO_QR(1001);
vi.mock("@/components/shared/QrScanner", () => ({
  QrScanner: ({
    onDecoded,
    disabled,
  }: {
    onDecoded: (texto: string) => void;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={() => onDecoded(textoEscaneado)}>
      Simular escaneo
    </button>
  ),
}));

const recolectarMock = vi.mocked(recolectarEnTiendaPorQr);

function makeOrden(over: Partial<RecoleccionOrdenDTO> = {}): RecoleccionOrdenDTO {
  return {
    id: "o1",
    numGuia: 1001,
    numRemision: "REM-1",
    producto: "Caja",
    destinatario: "Ana",
    tiendaNombre: "Tienda Norte",
    tiendaTelefono: "88880000",
    ...over,
  };
}

function makeRecolectada(over: Partial<RecolectadaHoyDTO> = {}): RecolectadaHoyDTO {
  return {
    ordenId: "h1",
    numGuia: 5001,
    numRemision: "REM-H1",
    tiendaNombre: "Tienda Norte",
    recolectadaAt: new Date("2026-07-31T15:30:00.000Z"), // 09:30 hora CR
    ...over,
  };
}

/** Monta el módulo con lo mínimo: las dos listas vacías salvo lo que el caso declare. */
function renderModule(props: Partial<Parameters<typeof RecoleccionModule>[0]> = {}) {
  return render(
    <RecoleccionModule
      porRecolectar={props.porRecolectar ?? []}
      recolectadasHoy={props.recolectadasHoy ?? []}
      recolectadasHoyRecortada={props.recolectadasHoyRecortada ?? false}
      bloqueado={props.bloqueado ?? false}
    />,
  );
}

const escaner = () =>
  screen.queryByRole("region", { name: "Recolectar por número de guía o escaneo" });

/**
 * R31 — el aviso de recorte NOMBRA el tope, y el tope tiene UNA sola fuente
 * (`lib/constants/recoleccion-tienda.ts`, la misma que el service usa para recortar). El patrón
 * se DERIVA de esa constante: si el humano cambia el tope y la UI se queda con el número
 * escrito a mano, el caso falla aquí en vez de dejar un aviso que miente en la calle.
 */
const avisoRecorte = new RegExp(
  `se muestran las ${TOPE_RECOLECTADAS_HOY} más recientes de hoy`,
  "i",
);

beforeEach(() => {
  vi.clearAllMocks();
  textoEscaneado = TEXTO_QR(1001);
  recolectarMock.mockResolvedValue({
    status: "ok",
    ordenId: "o1",
    estado: "en_ruta_bodega_central",
  });
});

afterEach(() => cleanup());

describe("RecoleccionModule — qué muestra (R17/R18/R19/R20/R22)", () => {
  it("R17: agrupa por tienda, con una tarjeta por orden", () => {
    renderModule({
      porRecolectar: [
        makeOrden({ id: "a", numGuia: 1, numRemision: "REM-A", tiendaNombre: "Tienda Norte" }),
        makeOrden({ id: "b", numGuia: 2, numRemision: "REM-B", tiendaNombre: "Tienda Norte" }),
        makeOrden({ id: "c", numGuia: 3, numRemision: "REM-C", tiendaNombre: "Tienda Sur" }),
      ],
    });

    expect(screen.getByRole("heading", { name: "Tienda Norte" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tienda Sur" })).toBeInTheDocument();
    expect(screen.getByText("REM-A")).toBeInTheDocument();
    expect(screen.getByText("REM-C")).toBeInTheDocument();
  });

  it("R19: llama a la TIENDA, no al destinatario", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    vi.stubGlobal("open", open);
    renderModule({ porRecolectar: [makeOrden({ tiendaTelefono: "88880000" })] });

    // El interlocutor de una recolección es la tienda: el nombre del control lo dice y el
    // número marcado es el suyo, no el del destinatario final (que aquí no pinta nada).
    await user.click(screen.getByRole("button", { name: "Llamar a Tienda Norte" }));

    expect(open).toHaveBeenCalledWith("tel:88880000", "_self");
    vi.unstubAllGlobals();
  });

  it("R20: una tienda sin teléfono no pinta botones de contacto muertos", () => {
    renderModule({ porRecolectar: [makeOrden({ tiendaTelefono: null })] });

    expect(screen.queryByRole("button", { name: /^Llamar a/ })).toBeNull();
  });

  it("R22: NO ofrece ningún control de gestión (ni cobro, ni evidencia, ni resultados)", () => {
    renderModule({ porRecolectar: [makeOrden()] });

    // Los 4 resultados de la gestión, el método de pago y la evidencia son de OTRO flujo.
    for (const nombre of [/entregada/i, /reprogramar/i, /devolver/i, /rechazar/i]) {
      expect(screen.queryByRole("button", { name: nombre })).toBeNull();
    }
    expect(screen.queryByText(/método de pago/i)).toBeNull();
    expect(screen.queryByText(/valor a cobrar/i)).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("R18: no muestra monto a cobrar — el DTO ni siquiera lo transporta (R38)", () => {
    renderModule({ porRecolectar: [makeOrden()] });

    // Lo que se ve por orden: guía, remisión, producto y destinatario. Nada de dinero.
    expect(screen.getByText("REM-1")).toBeInTheDocument();
    expect(screen.getByText(/Caja · Ana/)).toBeInTheDocument();
    expect(screen.queryByText(/₡/)).toBeNull();
    // Contrato: el DTO de esta superficie no tiene por dónde filtrar cobro ni ruta.
    const orden = makeOrden();
    expect(Object.keys(orden).sort()).toEqual([
      "destinatario",
      "id",
      "numGuia",
      "numRemision",
      "producto",
      "tiendaNombre",
      "tiendaTelefono",
    ]);
  });
});

// ---------------------------------------------------------------------------------------
// Feature 167 (R7/R8) — LA CAUSA RAÍZ. El panel de la 157 hacía `if (porRecolectar.length
// === 0) return null`, así que el bloque de escaneo desaparecía justo cuando el mensajero
// lo buscaba. Estos casos son la razón de existir de la feature entera.
// ---------------------------------------------------------------------------------------
describe("RecoleccionModule — el escáner está SIEMPRE (R7/R8)", () => {
  it("R7/R8: con la lista VACÍA el escáner sigue montado y el vacío se explica", () => {
    renderModule({ porRecolectar: [] });

    // SUSTITUYE al caso de la 157 "sin nada que recolectar el apartado no se muestra".
    expect(escaner()).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirmar recolección" }),
    ).toBeInTheDocument();
    // El vacío se DICE (R8): una pantalla muda es lo que hacía que el mensajero se perdiera.
    expect(
      screen.getByText(/no tienes órdenes por recolectar en tienda ahora mismo/i),
    ).toBeInTheDocument();
  });

  it("R7: con lista vacía el escaneo SÍ se puede confirmar (el escáner no es decorativo)", async () => {
    const user = userEvent.setup();
    renderModule({ porRecolectar: [] });

    await user.type(screen.getByRole("textbox"), "1001");
    await user.click(screen.getByRole("button", { name: "Confirmar recolección" }));

    await waitFor(() => expect(recolectarMock).toHaveBeenCalledWith({ numGuia: 1001 }));
  });

  it("R7: con órdenes asignadas el escáner sigue igual de montado", () => {
    renderModule({ porRecolectar: [makeOrden()] });

    expect(escaner()).toBeInTheDocument();
    expect(screen.queryByText(/no tienes órdenes por recolectar/i)).toBeNull();
  });
});

describe("RecoleccionModule — confirmar la recolección (R10/R11/R12/R13/R14/R15)", () => {
  it("R10: la vía manual confirma la guía y revalida el apartado", async () => {
    const user = userEvent.setup();
    renderModule({ porRecolectar: [makeOrden({ numGuia: 1001 })] });

    await user.type(screen.getByRole("textbox"), "1001");
    await user.click(screen.getByRole("button", { name: "Confirmar recolección" }));

    await waitFor(() => expect(recolectarMock).toHaveBeenCalledWith({ numGuia: 1001 }));
    // R14: la orden deja de estar pendiente y pasa a "Recolectadas hoy"; las dos listas las
    // resuelve el servidor, así que la verdad se relee de allí.
    expect(refreshMock).toHaveBeenCalled();
  });

  it("R10: la vía CÁMARA confirma exactamente igual (mismo action, mismo resultado)", async () => {
    const user = userEvent.setup();
    textoEscaneado = TEXTO_QR(1001);
    renderModule({ porRecolectar: [makeOrden({ numGuia: 1001 })] });

    await user.click(screen.getByRole("button", { name: "Simular escaneo" }));

    await waitFor(() => expect(recolectarMock).toHaveBeenCalledWith({ numGuia: 1001 }));
    expect(toastSuccess).toHaveBeenCalled();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("R11: un código que no son dígitos no llega a la action (vía manual)", async () => {
    const user = userEvent.setup();
    renderModule({ porRecolectar: [makeOrden({ numGuia: 1001 })] });

    await user.type(screen.getByRole("textbox"), "abc");
    await user.click(screen.getByRole("button", { name: "Confirmar recolección" }));

    expect(recolectarMock).not.toHaveBeenCalled();
  });

  it("R11: un QR que no es la URL del paquete tampoco llega a la action (vía cámara)", async () => {
    const user = userEvent.setup();
    textoEscaneado = "esto-no-es-una-url";
    renderModule({ porRecolectar: [makeOrden({ numGuia: 1001 })] });

    await user.click(screen.getByRole("button", { name: "Simular escaneo" }));

    expect(recolectarMock).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("Código inválido.");
  });

  it("R12: una guía que NO está en la lista cargada SÍ llega al servidor", async () => {
    const user = userEvent.setup();
    // SUSTITUYE al caso de la 157 "una guía que NO es suya se rechaza en cliente". El
    // servidor es la autoridad: con la lista vacía o desactualizada, el corte local
    // convertía el escáner en un botón que no funciona nunca.
    recolectarMock.mockResolvedValue({ status: "no_encontrada" });
    renderModule({ porRecolectar: [makeOrden({ numGuia: 1001 })] });

    await user.type(screen.getByRole("textbox"), "9999");
    await user.click(screen.getByRole("button", { name: "Confirmar recolección" }));

    await waitFor(() => expect(recolectarMock).toHaveBeenCalledWith({ numGuia: 9999 }));
    // R13: el mensaje sale del resultado del SERVIDOR, y dice lo mismo que decía el corte
    // local — el mensajero no pierde información por el cambio.
    expect(toastError).toHaveBeenCalledWith(
      "La guía 9999 no está entre tus órdenes por recolectar.",
    );
    // No hubo transición: no hay nada que revalidar.
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("R13: escanear dos veces la misma etiqueta informa, no dice que sea un error", async () => {
    const user = userEvent.setup();
    recolectarMock.mockResolvedValue({ status: "ya_recolectada" });
    renderModule({ porRecolectar: [makeOrden({ numGuia: 1001 })] });

    await user.type(screen.getByRole("textbox"), "1001");
    await user.click(screen.getByRole("button", { name: "Confirmar recolección" }));

    await waitFor(() => expect(toastInfo).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
    // R14: idempotente, la lista se revalida igual porque esa orden ya no va aquí.
    expect(refreshMock).toHaveBeenCalled();
  });

  it("R13: un estado inválido dice EN QUÉ estado está, no un error genérico", async () => {
    const user = userEvent.setup();
    recolectarMock.mockResolvedValue({
      status: "estado_invalido",
      estado: "en_bodega_central",
    });
    renderModule({ porRecolectar: [makeOrden({ numGuia: 1001 })] });

    await user.type(screen.getByRole("textbox"), "1001");
    await user.click(screen.getByRole("button", { name: "Confirmar recolección" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'La guía 1001 ya no está por recolectar (está en "en_bodega_central").',
      ),
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("R13: un conflicto (bloqueo o carrera) traslada el MOTIVO que da el servidor", async () => {
    const user = userEvent.setup();
    recolectarMock.mockResolvedValue({
      status: "conflict",
      motivo: "Tienes un cierre pendiente.",
    });
    renderModule({ porRecolectar: [makeOrden({ numGuia: 1001 })] });

    await user.type(screen.getByRole("textbox"), "1001");
    await user.click(screen.getByRole("button", { name: "Confirmar recolección" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Tienes un cierre pendiente."),
    );
  });

  // Los TRES resultados que faltaban (hallazgo m1 del review). Son inalcanzables desde la
  // pantalla en la práctica —la página hace `notFound` antes de montar nada para un rol ajeno o
  // sin sesión (R3), y el código mal formado se corta en cliente (R11)—, pero R13 exige un
  // mensaje propio para CADA resultado, y lo que el mensajero lee no lo prueba el test de la
  // action: aquel verifica el `status` que devuelve el servidor, no el texto del toast.
  it("R13: `forbidden` dice que no tiene permiso, no un error genérico", async () => {
    const user = userEvent.setup();
    recolectarMock.mockResolvedValue({ status: "forbidden" });
    renderModule({ porRecolectar: [makeOrden({ numGuia: 1001 })] });

    await user.type(screen.getByRole("textbox"), "1001");
    await user.click(screen.getByRole("button", { name: "Confirmar recolección" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("No tienes permiso para recolectar órdenes."),
    );
    // No hubo transición: nada que revalidar y nada que confirmar en pantalla.
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/recolectada correctamente/i)).toBeNull();
  });

  it("R13: `unauthenticated` manda a iniciar sesión de nuevo (no dice que la guía esté mal)", async () => {
    const user = userEvent.setup();
    recolectarMock.mockResolvedValue({ status: "unauthenticated" });
    renderModule({ porRecolectar: [makeOrden({ numGuia: 1001 })] });

    await user.type(screen.getByRole("textbox"), "1001");
    await user.click(screen.getByRole("button", { name: "Confirmar recolección" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Tu sesión expiró. Inicia sesión de nuevo."),
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("R13: `validation_error` del SERVIDOR también dice que el código es inválido", async () => {
    const user = userEvent.setup();
    recolectarMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { numGuia: ["Número de guía inválido"] },
    });
    renderModule({ porRecolectar: [makeOrden({ numGuia: 1001 })] });

    await user.type(screen.getByRole("textbox"), "1001");
    await user.click(screen.getByRole("button", { name: "Confirmar recolección" }));

    // A diferencia del corte de R11, aquí el viaje al servidor SÍ ocurrió: el rechazo lo dio el
    // borde (zod) y el mensajero lee el mismo texto, sin jerga de validación.
    await waitFor(() => expect(recolectarMock).toHaveBeenCalledWith({ numGuia: 1001 }));
    expect(toastError).toHaveBeenCalledWith("Código inválido.");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("R15: la confirmación de la última guía PERMANECE tras el toast", async () => {
    const user = userEvent.setup();
    renderModule({ porRecolectar: [makeOrden({ numGuia: 1001 })] });

    expect(screen.queryByText(/recolectada correctamente/i)).toBeNull();

    await user.type(screen.getByRole("textbox"), "1001");
    await user.click(screen.getByRole("button", { name: "Confirmar recolección" }));

    // En una tanda de decenas de paquetes el toast se va solo y el mensajero necesita ver
    // que la anterior sí entró.
    const exito = await screen.findByText(/recolectada correctamente/i);
    expect(exito).toHaveTextContent("1001");
  });
});

describe("RecoleccionModule — bloqueado por cierre pendiente (R9/R23)", () => {
  it("R9: sin bloque de captura y CON un aviso que dice el motivo y qué hacer", () => {
    renderModule({ porRecolectar: [makeOrden()], bloqueado: true });

    expect(escaner()).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar recolección" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Simular escaneo" })).toBeNull();

    // El apartado dice por sí mismo por qué no hay escáner: cuando vivía dentro de Entregas
    // el aviso lo ponía el módulo de al lado y aquí no quedaría ninguno.
    const aviso = screen.getByRole("alert");
    expect(aviso).toHaveTextContent(
      /no puedes gestionar ni recibir nuevas asignaciones hasta resolver tu cierre pendiente/i,
    );
    // Accionable: dice adónde ir a resolverlo.
    expect(aviso).toHaveTextContent(/cierre del día/i);
  });

  it("R23: bloqueado, las dos listas se siguen viendo en solo-lectura", () => {
    renderModule({
      porRecolectar: [makeOrden({ numRemision: "REM-A" })],
      recolectadasHoy: [makeRecolectada({ numRemision: "REM-H1" })],
      bloqueado: true,
    });

    expect(screen.getByText("REM-A")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tienda Norte" })).toBeInTheDocument();
    // El historial del día es historial, no una acción: sigue visible.
    expect(screen.getByText("REM-H1")).toBeInTheDocument();
  });

  it("R8/R9: bloqueado y sin nada asignado, el vacío se explica igual (sin escáner)", () => {
    renderModule({ porRecolectar: [], bloqueado: true });

    expect(escaner()).toBeNull();
    expect(
      screen.getByText(/no tienes órdenes por recolectar en tienda ahora mismo/i),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------
// Feature 167 (R24/R28/R30/R31) — «Recolectadas hoy». Sale del HISTORIAL, así que sobrevive
// a que la bodega central ya haya recibido el paquete (R26, probado en el service).
// ---------------------------------------------------------------------------------------
describe("RecoleccionModule — «Recolectadas hoy» (R24/R28/R30/R31)", () => {
  const lista = () => screen.getByRole("region", { name: "Recolectadas hoy" });

  it("R24/R28: muestra guía, remisión, tienda y hora de cada recolección del día", () => {
    renderModule({
      recolectadasHoy: [
        makeRecolectada({
          ordenId: "h1",
          numGuia: 5001,
          numRemision: "REM-H1",
          tiendaNombre: "Tienda Sur",
          recolectadaAt: new Date("2026-07-31T15:30:00.000Z"), // 09:30 CR
        }),
      ],
    });

    const region = lista();
    expect(within(region).getByText(/Guía 5001/)).toBeInTheDocument();
    expect(within(region).getByText("REM-H1")).toBeInTheDocument();
    expect(within(region).getByText(/Tienda Sur/)).toBeInTheDocument();
    // Hora FIJA en zona de Costa Rica: no depende de la zona del dispositivo, que es la
    // misma convención con la que el servidor decidió qué es "hoy" (R27).
    expect(within(region).getByText(/9:30/)).toBeInTheDocument();
  });

  it("R28: respeta el orden recibido (más reciente primero) sin reordenar", () => {
    renderModule({
      recolectadasHoy: [
        makeRecolectada({ ordenId: "h1", numRemision: "REM-NUEVA", numGuia: 5003 }),
        makeRecolectada({ ordenId: "h2", numRemision: "REM-MEDIA", numGuia: 5002 }),
        makeRecolectada({ ordenId: "h3", numRemision: "REM-VIEJA", numGuia: 5001 }),
      ],
    });

    const filas = within(lista()).getAllByRole("listitem");
    expect(filas).toHaveLength(3);
    expect(filas[0]).toHaveTextContent("REM-NUEVA");
    expect(filas[1]).toHaveTextContent("REM-MEDIA");
    expect(filas[2]).toHaveTextContent("REM-VIEJA");
  });

  it("R30: sin recolecciones hoy lo DICE, en lugar de omitir la lista", () => {
    renderModule({ recolectadasHoy: [] });

    expect(lista()).toBeInTheDocument();
    expect(
      within(lista()).getByText(/todavía no has recolectado ninguna orden hoy/i),
    ).toBeInTheDocument();
  });

  it("R31: con la lista recortada avisa de que no está todo, con el TOPE REAL", () => {
    renderModule({
      recolectadasHoy: [makeRecolectada()],
      recolectadasHoyRecortada: true,
    });

    // El número del aviso se DERIVA de la misma constante con la que el servidor recorta: si
    // alguien cambia el tope y la UI se queda con el 100 escrito a mano, este caso falla en vez
    // de dejar al mensajero leyendo un aviso que miente (hallazgo m5 del review).
    expect(within(lista()).getByText(avisoRecorte)).toBeInTheDocument();
    expect(avisoRecorte.source).toContain(String(TOPE_RECOLECTADAS_HOY));
  });

  it("R31: sin recorte NO aparece el aviso (no se alarma de gratis)", () => {
    renderModule({
      recolectadasHoy: [makeRecolectada()],
      recolectadasHoyRecortada: false,
    });

    expect(within(lista()).queryByText(avisoRecorte)).toBeNull();
    // Ni el aviso derivado ni ningún otro recuento de "más recientes" se cuela sin recorte.
    expect(within(lista()).queryByText(/más recientes de hoy/i)).toBeNull();
  });

  it("R24: una guía sin número se muestra igual, sin romper la fila", () => {
    renderModule({ recolectadasHoy: [makeRecolectada({ numGuia: null })] });

    expect(within(lista()).getByText(/Guía —/)).toBeInTheDocument();
  });
});
