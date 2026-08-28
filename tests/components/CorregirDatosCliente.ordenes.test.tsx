// @vitest-environment jsdom
// =================================================================================================
// FICHA 312 (E3 — R6/R22/R24/R26/R27/R28/R29/R30) — LA SUPERFICIE DEL MODULO DE ORDENES.
// =================================================================================================
//
// **Que protege este archivo, en una linea:** que la pantalla no ofrezca lo que el servidor va a
// rechazar, y que lo que avisa antes de confirmar sea cierto.
//
// Los tres frentes, y por que cada uno:
//
//  · **El disparador no aparece** en los cuatro estados de la ventana cerrada (D3) ni cuando el
//    estado no se conoce (R22/R24). Un boton visible que el servidor rechaza es una invitacion al
//    error; y la AUSENCIA DE DATO no habilita nada, que es lo contrario de lo que hace un
//    `!ESTADOS.includes(x)` ingenuo —con `undefined` diria «adelante»—.
//  · **Los dos avisos son CONDICIONALES** (R27/R28). Un aviso que sale siempre no es un aviso: es
//    ruido que se aprende a ignorar, y el dia que importe nadie lo leera. Por eso cada uno se mide
//    con su par presencia/ausencia en el MISMO archivo.
//  · **Un rechazo conserva lo tecleado** (R30) y no filtra ni un identificador. El `forbidden` del
//    servidor es OPACO a proposito (R12): cuatro causas distintas devuelven el mismo objeto.
//
// ⚠️ **La Server Action va MOCKEADA** (es un modulo `"use server"`: importarlo de verdad arrastraria
// Prisma a jsdom). Lo que se mide aqui es el contrato de PANTALLA; que la accion autorice de verdad
// lo miden `corregir-datos-cliente-service.test.ts` y `corregir-datos-cliente.repo.test.ts`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  CorregirDatosClienteAccion,
  CORREGIR_DATOS_ACCION_LABEL,
} from "@/app/(app)/ordenes/_components/CorregirDatosClienteAccion";
import {
  CORREGIR_TITULO,
  CORREGIR_CONFIRMAR,
} from "@/app/(app)/ordenes/_components/CorregirDatosClienteModal";
import { ESTADOS_SIN_CORRECCION } from "@/lib/types/correccion-datos-cliente";
import type { OrdenListItemDTO } from "@/lib/types/orden";

const corregirDatosClienteMock = vi.fn();
vi.mock("@/lib/actions/corregir-datos-cliente", () => ({
  corregirDatosCliente: (...args: unknown[]) => corregirDatosClienteMock(...args),
}));

const mutateMock = vi.fn();
vi.mock("swr", () => ({
  useSWRConfig: () => ({ mutate: mutateMock }),
}));

const toastMock = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  show: vi.fn(),
  dismiss: vi.fn(),
};
vi.mock("@/hooks/useToast", () => ({ useToast: () => toastMock }));

const ORDEN_ID = "0f1e2d3c-4b5a-4c7d-8e9f-0a1b2c3d4e5f";
const DISPARADOR = `${CORREGIR_DATOS_ACCION_LABEL} de la orden REM-001`;

function orden(over: Partial<OrdenListItemDTO> = {}): OrdenListItemDTO {
  return {
    id: ORDEN_ID,
    numRemision: "REM-001",
    numGuia: null,
    estatusValue: "en_reparto",
    destinatario: "Ana Pérez",
    telefonoDest: "8888-7777",
    producto: "Zapatos negros",
    notas: "Dejar con el guarda",
    tiendaNombre: "Tienda X",
    ...over,
  } as unknown as OrdenListItemDTO;
}

/** Abre la ventana sobre esa orden y devuelve el `user` para seguir tecleando. */
async function abrir(over: Partial<OrdenListItemDTO> = {}, onSuccess?: () => void) {
  const user = userEvent.setup();
  render(<CorregirDatosClienteAccion orden={orden(over)} onSuccess={onSuccess} />);
  await user.click(screen.getByRole("button", { name: DISPARADOR }));
  expect(await screen.findByText(CORREGIR_TITULO)).toBeInTheDocument();
  return user;
}

function campo(nombre: RegExp): HTMLInputElement | HTMLTextAreaElement {
  return screen.getByLabelText(nombre) as HTMLInputElement | HTMLTextAreaElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  corregirDatosClienteMock.mockResolvedValue({ status: "ok", cambios: ["destinatario"] });
});
afterEach(cleanup);

// =================================================================================================
// R22 / R24 — LA VENTANA DE ESTADO, EN LA PANTALLA
// =================================================================================================

describe("312/R22 — el disparador sólo aparece donde el servidor aceptaría", () => {
  it.each([...ESTADOS_SIN_CORRECCION])(
    "en `%s` NO renderiza NADA (ni un botón deshabilitado)",
    (estado) => {
      const { container } = render(
        <CorregirDatosClienteAccion orden={orden({ estatusValue: estado })} />,
      );
      expect(screen.queryByRole("button")).toBeNull();
      expect(container).toBeEmptyDOMElement();
    },
  );

  it("R24 — FALLO CERRADO: sin `estatusValue` tampoco renderiza nada", () => {
    // La ausencia de dato NO habilita. Es el caso que un `!ESTADOS.includes(x)` ingenuo dejaría
    // pasar: con `undefined` diría «adelante» sobre una orden de la que no se sabe el estado.
    const { container } = render(
      <CorregirDatosClienteAccion orden={orden({ estatusValue: undefined })} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("y el CONTROL POSITIVO: en `en_reparto` sí se ofrece", () => {
    // Sin esto, las cinco ausencias de arriba pasarían igual con el componente devolviendo `null`
    // siempre — que es exactamente cómo se cuela un disparador muerto.
    render(<CorregirDatosClienteAccion orden={orden({ estatusValue: "en_reparto" })} />);
    expect(screen.getByRole("button", { name: DISPARADOR })).toBeInTheDocument();
  });

  it("la superficie puede negarla aunque el estado la admita (rol sin acceso)", () => {
    // `disponible={false}` es el criterio de ROL, que vive en la página. Se combina con `&&`: el
    // estado se consulta SIEMPRE, y ninguno de los dos puede saltarse al otro.
    const { container } = render(
      <CorregirDatosClienteAccion orden={orden({ estatusValue: "en_reparto" })} disponible={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

// =================================================================================================
// R26 / R6 — LO QUE LA VENTANA TRAE DENTRO
// =================================================================================================

describe("312/R26 — la ventana abre con los cuatro valores actuales", () => {
  it("precarga destinatario, teléfono, producto y notas de ESA orden", async () => {
    await abrir();
    expect(campo(/^Destinatario$/).value).toBe("Ana Pérez");
    expect(campo(/Teléfono/).value).toBe("8888-7777");
    expect(campo(/^Producto$/).value).toBe("Zapatos negros");
    expect(campo(/^Notas$/).value).toBe("Dejar con el guarda");
  });

  it("R6: un producto de 5.000 caracteres NO produce error de cliente", async () => {
    // P3, cerrada el 2026-08-28: sin tope propio, igual que la carga masiva. Un tope que la carga
    // no tiene produciría el caso absurdo «se pudo cargar pero no se puede corregir».
    const user = await abrir();
    const largo = "x".repeat(5000);
    fireEvent.change(campo(/^Producto$/), { target: { value: largo } });
    expect(campo(/^Producto$/).value).toHaveLength(5000);

    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));

    await waitFor(() => expect(corregirDatosClienteMock).toHaveBeenCalledTimes(1));
    // Llegó ENTERO al servidor: ni recortado por la pantalla ni rechazado antes de salir.
    expect(corregirDatosClienteMock.mock.calls[0][0].producto).toHaveLength(5000);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("el campo obligatorio vacío bloquea el envío CON TEXTO, no sólo con el botón apagado", async () => {
    const user = await abrir();
    await user.clear(campo(/^Destinatario$/));

    expect(screen.getByRole("button", { name: CORREGIR_CONFIRMAR })).toBeDisabled();
    expect(screen.getByText(/Falta completar: el destinatario\./)).toBeInTheDocument();
    // Y no se llama a la acción: el handler no depende del bloqueo visual.
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));
    expect(corregirDatosClienteMock).not.toHaveBeenCalled();
  });
});

// =================================================================================================
// R27 / R28 — LOS DOS AVISOS, CADA UNO CON SU PAR PRESENCIA/AUSENCIA
// =================================================================================================

describe("312/R27 — el aviso de la etiqueta ya impresa", () => {
  it("con guía asignada avisa, y NOMBRA la guía", async () => {
    await abrir({ numGuia: 8123 });
    expect(
      screen.getByText(/la etiqueta pegada al paquete seguirá mostrando los datos anteriores/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/guía 8123/)).toBeInTheDocument();
  });

  it("SIN guía NO avisa: no hay ningún papel impreso que pueda quedarse viejo", async () => {
    // El par de la presencia de arriba. Sin este caso, pintar el aviso SIEMPRE pasaría en verde.
    await abrir({ numGuia: null });
    expect(screen.queryByText(/etiqueta/i)).toBeNull();
  });

  it("P4: la ventana NO ofrece reimprimir, ni con guía", async () => {
    // Respuesta del humano el 2026-08-28: R27 avisa y nada más. Reimprimir ya es un gesto propio
    // de la fila del listado (`EtiquetaOrdenAccion`) y esta ficha no lo duplica aquí dentro.
    await abrir({ numGuia: 8123 });
    expect(screen.queryByRole("button", { name: /reimprimir|imprimir|etiqueta/i })).toBeNull();
  });
});

describe("312/R28 — el aviso de la conversación de WhatsApp", () => {
  it("aparece en cuanto el teléfono cambia respecto del precargado", async () => {
    const user = await abrir();
    await user.clear(campo(/Teléfono/));
    await user.type(campo(/Teléfono/), "8888-9999");

    expect(
      screen.getByText(/La conversación anterior se conserva, pero no se traslada/i),
    ).toBeInTheDocument();
    // Y dice lo que SÍ pasa, no sólo lo que no: los mensajes nuevos van al número corregido.
    expect(screen.getByText(/Los mensajes nuevos irán al número corregido/i)).toBeInTheDocument();
  });

  it("sin tocar el teléfono NO aparece", async () => {
    const user = await abrir();
    // Se toca OTRO campo: así el caso mide «el teléfono no cambió» y no «no se escribió nada».
    await user.type(campo(/^Destinatario$/), " Mora");
    expect(screen.queryByText(/La conversación anterior/i)).toBeNull();
  });
});

// =================================================================================================
// R29 / R30 — EL DESENLACE
// =================================================================================================

describe("312/R29 — el éxito relee del SERVIDOR", () => {
  it("cierra la ventana y revalida el listado por su prefijo de key SWR", async () => {
    const user = await abrir({ numGuia: 8123 });
    await user.clear(campo(/^Destinatario$/));
    await user.type(campo(/^Destinatario$/), "Ana Mora");
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));

    await waitFor(() => expect(mutateMock).toHaveBeenCalledTimes(1));
    // El predicado de la key se ejerce de verdad: revalida el listado de órdenes y NADA más. Si
    // alguien lo cambiara por `mutate()` a secas —que revalida el mundo— o por otra key, esto cae.
    const predicado = mutateMock.mock.calls[0][0] as (key: unknown) => boolean;
    expect(predicado(["ordenes:list", 1, 10])).toBe(true);
    expect(predicado(["novedades:list", 1])).toBe(false);
    expect(mutateMock.mock.calls[0][2]).toMatchObject({ revalidate: true });
    // La ventana se cierra: el dato que se verá viene de la relectura, no de lo tecleado.
    await waitFor(() => expect(screen.queryByText(CORREGIR_TITULO)).toBeNull());
  });

  it("el `onSuccess` de la superficie sustituye a la revalidación por defecto", async () => {
    const onSuccess = vi.fn();
    const user = await abrir({}, onSuccess);
    await user.type(campo(/^Destinatario$/), " Mora");
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("R4: «no había nada que cambiar» también es un éxito, y se dice distinto", async () => {
    corregirDatosClienteMock.mockResolvedValue({ status: "ok", cambios: [] });
    const user = await abrir();
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
    expect(toastMock.success.mock.calls[0][0]).toMatch(/nada que cambiar/i);
  });
});

describe("312/R30 — el rechazo conserva lo tecleado y no filtra nada", () => {
  it("`forbidden`: la ventana sigue abierta, con el borrador intacto y un motivo accionable", async () => {
    corregirDatosClienteMock.mockResolvedValue({ status: "forbidden" });
    const user = await abrir();
    await user.clear(campo(/^Destinatario$/));
    await user.type(campo(/^Destinatario$/), "Ana Mora");
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));

    const motivo = await screen.findByRole("alert");
    // ACCIONABLE: dice qué hacer, no sólo que no se pudo.
    expect(motivo.textContent).toMatch(/actualiza la lista/i);
    // OPACO (R12): no dice cuál de las cuatro causas fue —ni permiso, ni inexistente, ni ajena—.
    expect(motivo.textContent).not.toMatch(/permiso|no existe|otra tienda|borrada/i);
    // Y NO expone identificadores internos.
    expect(motivo.textContent).not.toContain(ORDEN_ID);
    expect(document.body.textContent).not.toContain(ORDEN_ID);
    // El borrador sigue ahí: volver a escribirlo es justo el coste que R30 evita.
    expect(campo(/^Destinatario$/).value).toBe("Ana Mora");
    expect(screen.getByText(CORREGIR_TITULO)).toBeInTheDocument();
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("`validation_error`: el motivo se pinta JUNTO al campo que lo tiene", async () => {
    corregirDatosClienteMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { telefonoDest: ["Numero de telefono no utilizable"] },
    });
    const user = await abrir();
    await user.clear(campo(/Teléfono/));
    await user.type(campo(/Teléfono/), "abc");
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));

    expect(await screen.findByText("Numero de telefono no utilizable")).toBeInTheDocument();
    expect(campo(/Teléfono/)).toHaveAttribute("aria-invalid", "true");
    expect(campo(/Teléfono/).value).toBe("abc");
  });

  it("`conflict`: dice que NO se guardó nada, sin afirmar un cambio a medias", async () => {
    corregirDatosClienteMock.mockResolvedValue({ status: "conflict" });
    const user = await abrir();
    await user.type(campo(/^Destinatario$/), " Mora");
    await user.click(screen.getByRole("button", { name: CORREGIR_CONFIRMAR }));

    const motivo = await screen.findByRole("alert");
    expect(motivo.textContent).toMatch(/no se guardó nada/i);
  });
});

// =================================================================================================
// D4 — LA VENTANA NO PROMETE NINGUN RASTRO
// =================================================================================================

describe("312/D4 — ningún texto anuncia un registro que no existe", () => {
  it("no dice que se registre quién corrigió, ni qué cambió", async () => {
    // Decisión humana del 2026-08-28: corregir no deja rastro. El único es el `updated_at` de la
    // fila. Una promesa falsa en la pantalla es peor que el silencio, y este caso es lo que impide
    // que alguien la escriba «para tranquilizar» a quien corrige.
    await abrir({ numGuia: 8123 });
    const texto = document.body.textContent ?? "";
    expect(texto).not.toMatch(/quedará registrado|se registrará|queda registrado|auditoría/i);
    expect(texto).not.toMatch(/historial de cambios|quién lo cambió/i);
    // CONTROL POSITIVO de que había texto que mirar (si no, las cuatro ausencias no dirían nada).
    expect(texto).toContain(CORREGIR_TITULO);
  });
});
