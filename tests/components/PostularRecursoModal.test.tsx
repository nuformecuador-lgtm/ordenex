// @vitest-environment jsdom
// Feature 253 (T6.1/T6.2) — el modal de «Postular mi vehículo» / «Postular mi bodega» de la
// landing pública. Cubre R1, R2, R3, R5, R6 y R17.
//
// ⚠️ POR QUÉ ESTE ARCHIVO NO EXISTÍA Y AHORA SÍ. Hasta esta ficha no había **ni un** test de
// `PostularRecursoModal` en el árbol: su `handleSubmit` validaba y hacía `setEnviado(true)` con un
// `// TODO`, y la suite entera estaba verde porque nadie miraba. El acuse se pintaba sin que nada
// se hubiera enviado, en producción.
//
// Lo que se mide aquí es la SUPERFICIE: la Server Action se dobla porque el servidor tiene sus
// propios tests (T4.1) y porque lo que esta ficha promete es que **el acuse depende del resultado**.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PostularRecursoModal } from "@/app/_landing/PostularRecursoModal";
import { LandingPostular } from "@/app/_landing/LandingPostular";
import { postularRecurso } from "@/lib/actions/postulacion-recurso";

vi.mock("@/lib/actions/postulacion-recurso", () => ({
  postularRecurso: vi.fn(),
}));

const postularMock = vi.mocked(postularRecurso);

/**
 * D9 FIRMADA — el texto del acuse, **como literal**.
 *
 * A propósito NO se importa la constante del componente: una aserción contra su propia fuente
 * siempre está verde y no diría nada si mañana alguien reescribe la frase. Este literal ES el
 * contrato con la persona que postula.
 */
const ACUSE =
  "Recibimos tu postulación. Queda registrada y nuestro equipo te contacta al teléfono o al correo que dejaste.";

/** El acuse de la maqueta, palabra por palabra. No puede volver. */
const ACUSE_VIEJO =
  "Recibimos tus datos. Nuestro equipo te contacta al teléfono o al correo que dejaste.";

const dialogo = () => screen.getByRole("dialog");
const campo = (etiqueta: RegExp) => within(dialogo()).getByLabelText(etiqueta);
const botonEnviar = () =>
  within(dialogo()).getByRole("button", { name: /Enviar postulación|Enviando/ });
/**
 * El aviso GENERAL del formulario. Se busca por `data-testid` y no por `role="alert"` porque
 * `FieldError` tambien emite `role="alert"`: en el caso de `validation_error` hay dos alertas
 * vivas a la vez —la del campo y la general— y eso es lo correcto, no un defecto que tapar.
 */
const avisoGeneral = () => within(dialogo()).findByTestId("postular-recurso-aviso");

/** Abre el modal desde su disparador y devuelve el `user` ya configurado. */
async function abrir(tipo: "vehiculo" | "bodega" = "vehiculo") {
  const user = userEvent.setup();
  render(
    <PostularRecursoModal
      tipo={tipo}
      cta={tipo === "vehiculo" ? "Postular mi vehículo" : "Postular mi bodega"}
    />,
  );
  await user.click(screen.getByRole("button", { name: /Postular mi/ }));
  await screen.findByRole("dialog");
  return user;
}

/** Rellena los cuatro campos con datos válidos. */
async function rellenar(
  user: ReturnType<typeof userEvent.setup>,
  etiquetaMensaje: RegExp = /^Contanos sobre tu vehículo/,
) {
  await user.type(campo(/^Nombre/), "  Ana Solís  ");
  await user.type(campo(/^Teléfono/), "+506 8888-8888");
  await user.type(campo(/^Correo/), "Ana.Solis@Example.COM");
  await user.type(campo(etiquetaMensaje), "Camión de 3 toneladas en Heredia.");
}

beforeEach(() => {
  vi.clearAllMocks();
  postularMock.mockResolvedValue({ status: "ok" });
});

afterEach(() => {
  cleanup();
});

// -------------------------------------------------------------------------------------------------

describe("253/R1 — el acuse SÓLO aparece cuando la postulación quedó registrada", () => {
  it("con `ok` del servidor se pinta el acuse, y el envío llevó los cinco campos normalizados", async () => {
    const user = await abrir();
    await rellenar(user);
    await user.click(botonEnviar());

    expect(await screen.findByText(ACUSE)).toBeInTheDocument();
    // R20/R14: el mismo schema que revalida el servidor recorta y baja el correo a minúsculas
    // ANTES de que el objeto salga del navegador. Y `tipo` viaja: hasta esta ficha se quedaba en
    // la prop que elegía el copy.
    expect(postularMock).toHaveBeenCalledTimes(1);
    expect(postularMock).toHaveBeenCalledWith({
      tipo: "vehiculo",
      nombre: "Ana Solís",
      telefono: "+506 8888-8888",
      correo: "ana.solis@example.com",
      mensaje: "Camión de 3 toneladas en Heredia.",
    });
  });

  it("💀 MIENTRAS la acción no ha resuelto, el acuse NO está: es la maqueta que esta ficha mató", async () => {
    // El caso literal del defecto. Antes, `setEnviado(true)` se ejecutaba en el mismo tick del
    // submit y el acuse aparecía sin que nada hubiera salido del navegador.
    let resolver!: (r: { status: "ok" }) => void;
    postularMock.mockReturnValue(new Promise((res) => (resolver = res)));

    const user = await abrir();
    await rellenar(user);
    await user.click(botonEnviar());

    await waitFor(() => expect(postularMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(ACUSE)).toBeNull();
    expect(screen.queryByText("Postulación enviada")).toBeNull();

    resolver({ status: "ok" });
    expect(await screen.findByText(ACUSE)).toBeInTheDocument();
  });

  it("la validación del cliente corta antes: con los campos vacíos NO se llama a la acción", async () => {
    const user = await abrir();
    await user.click(botonEnviar());

    expect(await within(dialogo()).findByText("Escribí tu nombre")).toBeInTheDocument();
    expect(within(dialogo()).getByText("Escribí un teléfono de contacto")).toBeInTheDocument();
    expect(within(dialogo()).getByText("Escribí un correo válido")).toBeInTheDocument();
    expect(within(dialogo()).getByText("Contanos brevemente qué tenés")).toBeInTheDocument();
    expect(postularMock).not.toHaveBeenCalled();
    expect(screen.queryByText(ACUSE)).toBeNull();
  });

  it("las DOS tarjetas de la landing disparan la MISMA operación, con su `tipo`", async () => {
    // Vehículo y bodega no son dos operaciones: son dos puertas a la misma, con el `tipo` como
    // dato del formulario (P5). Se monta la sección REAL de la landing para comprobarlo.
    const user = userEvent.setup();
    render(LandingPostular());

    await user.click(screen.getByRole("button", { name: /Postular mi bodega/ }));
    await screen.findByRole("dialog");
    await rellenar(user, /^Contanos sobre tu bodega/);
    await user.click(botonEnviar());

    await waitFor(() => expect(postularMock).toHaveBeenCalledTimes(1));
    expect(postularMock.mock.calls[0][0]).toMatchObject({ tipo: "bodega" });
  });
});

// -------------------------------------------------------------------------------------------------

describe("253/R2 + R5 + R17 — ningún desenlace queda mudo, y ninguno pinta el acuse", () => {
  /** Lo que la persona escribió tiene que seguir en los campos tras cualquier fallo. */
  function valoresIntactos() {
    expect(campo(/^Nombre/)).toHaveValue("  Ana Solís  ");
    expect(campo(/^Teléfono/)).toHaveValue("+506 8888-8888");
    expect(campo(/^Correo/)).toHaveValue("Ana.Solis@Example.COM");
    expect(campo(/^Contanos sobre tu vehículo/)).toHaveValue(
      "Camión de 3 toneladas en Heredia.",
    );
  }

  it("`validation_error`: señala el campo culpable, avisa, y NO pinta el acuse", async () => {
    postularMock.mockResolvedValue({
      status: "validation_error",
      fieldErrors: { correo: ["Escribí un correo válido"] },
    });

    const user = await abrir();
    await rellenar(user);
    await user.click(botonEnviar());

    const aviso = await avisoGeneral();
    expect(aviso).toHaveTextContent(
      "Revisá los campos marcados: hay algo que todavía no podemos aceptar. Lo que escribiste sigue acá.",
    );
    expect(within(dialogo()).getByText("Escribí un correo válido")).toBeInTheDocument();
    expect(screen.queryByText(ACUSE)).toBeNull();
    valoresIntactos();
  });

  it("R17 — `rate_limited` tiene texto PROPIO, distinto del error genérico", async () => {
    postularMock.mockResolvedValue({ status: "rate_limited" });

    const user = await abrir();
    await rellenar(user);
    await user.click(botonEnviar());

    const aviso = await avisoGeneral();
    expect(aviso).toHaveTextContent(
      "Ya recibimos varias postulaciones desde este dispositivo. Esperá unos minutos y volvé a intentarlo.",
    );
    expect(screen.queryByText(ACUSE)).toBeNull();
    valoresIntactos();
  });

  it("`error`: lo dice en pantalla y conserva lo escrito", async () => {
    postularMock.mockResolvedValue({ status: "error" });

    const user = await abrir();
    await rellenar(user);
    await user.click(botonEnviar());

    const aviso = await avisoGeneral();
    expect(aviso).toHaveTextContent(
      "No pudimos registrar tu postulación. Volvé a intentarlo en unos minutos; lo que escribiste sigue acá.",
    );
    expect(screen.queryByText(ACUSE)).toBeNull();
    valoresIntactos();
  });

  it("💀 PROMESA RECHAZADA: sin el `try/catch` la pantalla se quedaría muda y perdería lo escrito", async () => {
    // El modo de fallo de la ficha 248 y de `impl_240.md` §9.6: la promesa rechazada se pierde
    // dentro de la transición y la persona ve un formulario que no responde.
    postularMock.mockRejectedValue(new Error("network down"));

    const user = await abrir();
    await rellenar(user);
    await user.click(botonEnviar());

    const aviso = await avisoGeneral();
    expect(aviso).toHaveTextContent(
      "No se pudo enviar la postulación. Revisá tu conexión y volvé a intentarlo; lo que escribiste sigue acá.",
    );
    expect(screen.queryByText(ACUSE)).toBeNull();
    valoresIntactos();
  });

  it("R5 — los tres desenlaces de fallo tienen texto propio, no vacío y DISTINTO entre sí", async () => {
    // El tipo ya obliga a que exista un texto por desenlace (`Record<Exclude<…, "ok">, string>`);
    // esto comprueba lo que el tipo no puede: que ninguno esté vacío y que no se repitan. Un
    // desenlace disfrazado de otro es peor que ninguno (lección de la 248).
    const textos: string[] = [];
    for (const status of ["validation_error", "rate_limited", "error"] as const) {
      postularMock.mockResolvedValue(
        status === "validation_error"
          ? { status, fieldErrors: {} }
          : ({ status } as { status: "rate_limited" | "error" }),
      );

      const user = await abrir();
      await rellenar(user);
      await user.click(botonEnviar());
      const aviso = await avisoGeneral();
      textos.push((aviso.textContent ?? "").trim());
      cleanup();
      vi.clearAllMocks();
    }

    expect(textos.every((t) => t.length > 0)).toBe(true);
    expect(new Set(textos).size).toBe(3);
  });
});

// -------------------------------------------------------------------------------------------------

describe("253/R3 — mientras un envío está en curso no entra un segundo", () => {
  it("dos clicks seguidos producen UNA sola invocación, y el botón dice que está enviando", async () => {
    postularMock.mockReturnValue(new Promise(() => {}));

    const user = await abrir();
    await rellenar(user);
    await user.click(botonEnviar());

    // El botón lo DICE (R3) y además está deshabilitado.
    await waitFor(() => expect(botonEnviar()).toHaveTextContent("Enviando…"));
    expect(botonEnviar()).toBeDisabled();
    expect(botonEnviar()).toHaveAttribute("aria-busy", "true");

    await user.click(botonEnviar());
    expect(postularMock).toHaveBeenCalledTimes(1);
  });
});

// -------------------------------------------------------------------------------------------------

describe("253/R6 — el acuse no promete nada que no haya ocurrido", () => {
  it("dice que la postulación QUEDÓ REGISTRADA, y el texto de la maqueta no vuelve", async () => {
    const user = await abrir();
    await rellenar(user);
    await user.click(botonEnviar());

    const acuse = await screen.findByText(ACUSE);
    expect(acuse).toBeInTheDocument();
    expect(acuse.textContent).toContain("Queda registrada");
    // El texto viejo pasó a ser cierto con esta ficha; se cambió igualmente para que el commit
    // muestre que la frase se revisó (D9). Que no vuelva es parte del trato.
    expect(screen.queryByText(ACUSE_VIEJO)).toBeNull();
  });
});
