// @vitest-environment jsdom
// Feature 262 — F5: la PANTALLA de la corrección del día de reparto. Cubre R10, R16, R17, R18,
// R19 y R21 sobre el componente REAL; lo único mockeado es el borde (la Server Action) y el toast.
//
// ⚠️ LOS LITERALES DE LO QUE SE LEE VAN ESCRITOS A MANO, nunca importados del módulo de textos que
// el componente usa. Un test que compara el texto contra la constante que lo produce está verde
// por construcción: afirma «la función devuelve lo que devuelve» y deja pasar cualquier cambio de
// lo que el operador lee. Si estas cadenas dejan de casar, es que alguien cambió la pantalla, y
// eso tiene que doler. (Es la misma regla que ya aplica `SelectorDiaReparto.test.tsx`.)
//
// Lo que sí se importa son las CONSTANTES DE PROTOCOLO —los motivos tipados del `conflict`— porque
// ésas no son texto de usuario: son el contrato entre el service y esta pantalla, y duplicarlas
// aquí como literales sería tener dos verdades.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CambiarDiaRepartoModal } from "@/app/(app)/ordenes/_components/CambiarDiaRepartoModal";
import { corregirDiaReparto } from "@/lib/actions/corregir-dia-reparto";
import {
  MSG_CARRERA,
  MSG_SIN_MENSAJERO,
  MSG_YA_ES_ESE_DIA,
  msgEstadoSinDiaVivo,
} from "@/lib/services/mensajes-correccion-dia-reparto";

vi.mock("@/lib/actions/corregir-dia-reparto", () => ({
  corregirDiaReparto: vi.fn(),
}));

const corregirMock = vi.mocked(corregirDiaReparto);

const { successMock, errorMock } = vi.hoisted(() => ({
  successMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("@/hooks/useToast", () => ({
  useToast: () => ({
    success: successMock,
    error: errorMock,
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

/**
 * R17 — las dos fechas del selector bajan de la PÁGINA, resueltas en el servidor con el día de
 * Costa Rica. Aquí son literales fijos y deliberadamente lejanos al día en que corre la suite:
 * si el componente leyera el reloj del navegador, estas etiquetas no aparecerían.
 */
const FECHAS = { hoy: "2026-08-22", manana: "2026-08-23" };

const MOTIVO_OK = "la bodega marcó el lote para el día que no era";
const CONFIRMAR = "Cambiar día";

const ORDENES = [
  { id: "o1", numRemision: "REM-1", fechaRepartoISO: "2026-08-23" },
  { id: "o2", numRemision: "REM-2", fechaRepartoISO: "2026-08-22" },
];

function renderModal(
  ordenes: readonly { id: string; numRemision: string; fechaRepartoISO?: string | null }[] = ORDENES,
  onSuccess = vi.fn(),
  onOpenChange = vi.fn(),
) {
  render(
    <CambiarDiaRepartoModal
      open
      ordenes={ordenes}
      fechasDiaReparto={FECHAS}
      onOpenChange={onOpenChange}
      onSuccess={onSuccess}
    />,
  );
  return { onSuccess, onOpenChange };
}

/** El botón de confirmar del modal (el `Modal` lo pinta en un portal al final del body). */
function confirmar() {
  return screen.getByRole("button", { name: CONFIRMAR });
}

beforeEach(() => {
  vi.clearAllMocks();
  corregirMock.mockResolvedValue({ status: "ok", corregidas: 2, dia: "hoy" });
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// R16 — el día de CADA orden, antes de confirmar
// ---------------------------------------------------------------------------
describe("R16 — la lista del lote dice para qué día está marcada cada orden", () => {
  it("cada orden se lee con su nº de remisión y su día EN PALABRAS", () => {
    renderModal();

    // Las dos órdenes del lote están para días DISTINTOS a propósito: es el caso que R16
    // existe para cubrir —corregir a ciegas un lote mixto—, y si el componente pintara un solo
    // día para todas, este par de aserciones lo delataría.
    expect(screen.getByText("REM-1 · hoy está para el 23 de agosto")).toBeInTheDocument();
    expect(screen.getByText("REM-2 · hoy está para el 22 de agosto")).toBeInTheDocument();
  });

  it("una orden SIN día no deja el hueco en blanco: lo dice (R5 la rechazará, pero se ve)", () => {
    renderModal([{ id: "o3", numRemision: "REM-3", fechaRepartoISO: null }]);

    expect(screen.getByText("REM-3 · hoy no tiene día de reparto")).toBeInTheDocument();
  });

  it("R17: los días que muestra son los que RECIBE, no los de ningún reloj", () => {
    // Fecha lejana y fija: un componente que construyera la fecha con `new Date()` no la
    // pintaría nunca.
    renderModal([{ id: "o4", numRemision: "REM-4", fechaRepartoISO: "2027-01-01" }]);

    expect(screen.getByText("REM-4 · hoy está para el 1 de enero")).toBeInTheDocument();
    // Y NO se cuela un `YYYY-MM-DD` a la vista (la regla con la que este repo retiró «SLA»).
    expect(screen.queryByText(/2027-01-01/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §7.2 — SIN preselección, y el confirmar arranca apagado (mata M-u)
// ---------------------------------------------------------------------------
describe("el selector arranca SIN opción marcada (design §7.2)", () => {
  it("ninguna de las dos opciones está marcada al abrir", () => {
    renderModal();

    const hoy = screen.getByRole("radio", { name: "Hoy · 22 de agosto" });
    const manana = screen.getByRole("radio", { name: "Mañana · 23 de agosto" });

    // Las DOS, emparejadas: que «Hoy» no esté marcada no significaría nada si el radio no se
    // hubiera renderizado. Ésta es la aserción que mata M-u (preseleccionar «Hoy»).
    expect(hoy).not.toBeChecked();
    expect(manana).not.toBeChecked();
  });

  it("el grupo se lee con SU título de corrección, no con el de asignar", () => {
    renderModal();

    expect(
      screen.getByRole("radiogroup", { name: "Nuevo día de reparto" }),
    ).toBeInTheDocument();
    // El de asignar dice «Día de reparto» y su ayuda dice «antes de asignar», que aquí sería
    // falsa: ya está asignado.
    expect(screen.queryByRole("radiogroup", { name: "Día de reparto" })).toBeNull();
    expect(
      screen.getByText("Elige el día al que pasa todo el lote. No hay ninguna opción marcada de salida."),
    ).toBeInTheDocument();
  });

  it("con motivo válido pero SIN día elegido, el confirmar sigue deshabilitado", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText("Motivo"), MOTIVO_OK);

    expect(confirmar()).toBeDisabled();
    // Y ni siquiera se llama a la acción si alguien fuerza el click.
    await user.click(confirmar());
    expect(corregirMock).not.toHaveBeenCalled();
  });

  it("al elegir un día Y escribir el motivo, el confirmar se habilita", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("radio", { name: "Hoy · 22 de agosto" }));
    await user.type(screen.getByLabelText("Motivo"), MOTIVO_OK);

    expect(confirmar()).toBeEnabled();
  });
});

// ---------------------------------------------------------------------------
// R21 — el motivo es OBLIGATORIO
// ---------------------------------------------------------------------------
describe("R21 — sin motivo no se envía", () => {
  it("con día elegido pero sin motivo, el confirmar está deshabilitado y no se llama a la acción", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("radio", { name: "Mañana · 23 de agosto" }));

    expect(confirmar()).toBeDisabled();
    await user.click(confirmar());
    expect(corregirMock).not.toHaveBeenCalled();
  });

  it("un motivo demasiado corto no vale, y uno de 10 caracteres sí (la cota del borde)", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("radio", { name: "Hoy · 22 de agosto" }));
    const campo = screen.getByLabelText("Motivo");

    // 9 caracteres: el borde lo rechazaría con `min(10)`, así que la pantalla no lo ofrece.
    await user.type(campo, "123456789");
    expect(confirmar()).toBeDisabled();
    expect(campo).toHaveAttribute("aria-invalid", "true");

    // El décimo lo cruza. La cota es LITERAL a propósito: es el contrato del borde
    // (`trim().min(10)`), no un número que este test pueda derivar de sí mismo.
    await user.type(campo, "0");
    expect(confirmar()).toBeEnabled();
  });

  it("un motivo de sólo espacios NO vale (el `trim` corre antes que la cota)", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("radio", { name: "Hoy · 22 de agosto" }));

    await user.type(screen.getByLabelText("Motivo"), "              ");

    expect(confirmar()).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// R2/R3 — lo que VIAJA es el token, y una sola llamada por lote
// ---------------------------------------------------------------------------
describe("R2/R3 — viaja el TOKEN del día, nunca una fecha", () => {
  it("el día elegido VIAJA en la llamada, con el lote completo y el motivo recortado", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("radio", { name: "Mañana · 23 de agosto" }));
    await user.type(screen.getByLabelText("Motivo"), `  ${MOTIVO_OK}  `);
    await user.click(confirmar());

    // UNA sola llamada con el lote COMPLETO: el backend es todo-o-nada por lote (R8), así que
    // partirlo en N llamadas produciría exactamente el estado parcial que el diseño evita.
    await waitFor(() => expect(corregirMock).toHaveBeenCalledTimes(1));
    expect(corregirMock).toHaveBeenCalledWith({
      ordenIds: ["o1", "o2"],
      dia: "manana",
      motivo: MOTIVO_OK,
    });
  });

  it("elegir «Hoy» manda `hoy`: el token cambia con la elección y no está clavado", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("radio", { name: "Hoy · 22 de agosto" }));
    await user.type(screen.getByLabelText("Motivo"), MOTIVO_OK);
    await user.click(confirmar());

    await waitFor(() => expect(corregirMock).toHaveBeenCalledTimes(1));
    expect(corregirMock.mock.calls[0][0]).toMatchObject({ dia: "hoy" });
  });

  it("lo que viaja NO es una fecha calendario, en ninguna de las dos elecciones", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("radio", { name: "Mañana · 23 de agosto" }));
    await user.type(screen.getByLabelText("Motivo"), MOTIVO_OK);
    await user.click(confirmar());

    await waitFor(() => expect(corregirMock).toHaveBeenCalledTimes(1));
    // Si algún día esto mandara «2026-08-23», el día de reparto lo estaría decidiendo el
    // navegador — y con una fecha libre, mover al PASADO volvería a ser expresable (R3).
    expect(JSON.stringify(corregirMock.mock.calls[0][0])).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

// ---------------------------------------------------------------------------
// R10 — la confirmación, en palabras
// ---------------------------------------------------------------------------
describe("R10 — al terminar dice PARA QUÉ DÍA quedó el lote", () => {
  it("la frase va en palabras, con la fecha, sin siglas y sin `YYYY-MM-DD`", async () => {
    const user = userEvent.setup();
    const { onSuccess } = renderModal();

    await user.click(screen.getByRole("radio", { name: "Mañana · 23 de agosto" }));
    await user.type(screen.getByLabelText("Motivo"), MOTIVO_OK);
    await user.click(confirmar());

    await waitFor(() => expect(successMock).toHaveBeenCalled());
    // LITERAL a mano: es lo que la persona lee. Comparar contra `confirmacionDiaReparto(...)`
    // sería comparar el texto con la función que lo genera — verde para siempre.
    expect(successMock).toHaveBeenCalledWith(
      "El lote quedó para el reparto de mañana, 23 de agosto.",
    );
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("la frase habla del día ELEGIDO: con «Hoy» dice hoy y su fecha", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole("radio", { name: "Hoy · 22 de agosto" }));
    await user.type(screen.getByLabelText("Motivo"), MOTIVO_OK);
    await user.click(confirmar());

    await waitFor(() => expect(successMock).toHaveBeenCalled());
    expect(successMock).toHaveBeenCalledWith(
      "El lote quedó para el reparto de hoy, 22 de agosto.",
    );
  });
});

// ---------------------------------------------------------------------------
// R19 — el rechazo se lee POR ORDEN, con su motivo real (mata M-v)
// ---------------------------------------------------------------------------
describe("R19 — un `conflict` pinta el motivo REAL de cada orden, no un genérico", () => {
  async function confirmarCon(detalle: { ordenId: string; motivo: string }[]) {
    const user = userEvent.setup();
    corregirMock.mockResolvedValue({ status: "conflict", detalle });
    renderModal();
    await user.click(screen.getByRole("radio", { name: "Hoy · 22 de agosto" }));
    await user.type(screen.getByLabelText("Motivo"), MOTIVO_OK);
    await user.click(confirmar());
    return user;
  }

  it("cada orden rechazada se nombra por su remisión y con SU causa", async () => {
    await confirmarCon([
      { ordenId: "o1", motivo: MSG_YA_ES_ESE_DIA },
      { ordenId: "o2", motivo: msgEstadoSinDiaVivo("entregada") },
    ]);

    const aviso = await screen.findByRole("alert");
    // La causa de o1 y la de o2 son DISTINTAS y las dos se leen: eso es lo que M-v (pintar el
    // genérico) rompe.
    expect(aviso).toHaveTextContent(
      "REM-1 — Esta orden ya está marcada para el día que elegiste.",
    );
    expect(aviso).toHaveTextContent(
      "REM-2 — El día de reparto ya no decide nada para esta orden (Entregada).",
    );
  });

  it("NO invita a reintentar cuando reintentar no arregla nada", async () => {
    await confirmarCon([{ ordenId: "o1", motivo: MSG_SIN_MENSAJERO }]);

    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent(
      "REM-1 — Esta orden no tiene mensajero asignado. Primero asígnale uno",
    );
    // El mensaje falso «Actualiza la lista y vuelve a intentarlo» sobre una causa que no se
    // arregla reintentando es el que originó la investigación de la ficha 241.
    expect(aviso).not.toHaveTextContent("inténtalo de nuevo");
  });

  it("SÍ invita a reintentar en el ÚNICO caso en que sirve: la carrera", async () => {
    // La contraprueba del caso anterior. Sin ella, un componente que NUNCA dijera «inténtalo de
    // nuevo» pasaría los dos.
    await confirmarCon([{ ordenId: "o2", motivo: MSG_CARRERA }]);

    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent(
      "REM-2 — Esta orden cambió mientras confirmabas. Actualiza la lista e inténtalo de nuevo.",
    );
  });

  it("el rechazo dice que NO se cambió NINGUNA (todo-o-nada, R8) y el modal NO se cierra", async () => {
    const user = userEvent.setup();
    corregirMock.mockResolvedValue({
      status: "conflict",
      detalle: [{ ordenId: "o1", motivo: MSG_YA_ES_ESE_DIA }],
    });
    const onSuccess = vi.fn();
    const onOpenChange = vi.fn();
    renderModal(ORDENES, onSuccess, onOpenChange);

    await user.click(screen.getByRole("radio", { name: "Hoy · 22 de agosto" }));
    await user.type(screen.getByLabelText("Motivo"), MOTIVO_OK);
    await user.click(confirmar());

    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent("No se cambió el día de ninguna orden del lote");
    // No hay éxito, no se cierra y NO se pinta un toast de error genérico encima.
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("NUNCA aparece el identificador interno de la orden, sólo su remisión", async () => {
    await confirmarCon([{ ordenId: "o1", motivo: MSG_YA_ES_ESE_DIA }]);

    const aviso = await screen.findByRole("alert");
    expect(aviso.textContent ?? "").toContain("REM-1");
    expect(aviso.textContent ?? "").not.toContain("o1");
  });

  it("un fallo que NO es `conflict` sí va al toast, con su mensaje por causa", async () => {
    const user = userEvent.setup();
    corregirMock.mockResolvedValue({ status: "sin_zona" });
    renderModal();

    await user.click(screen.getByRole("radio", { name: "Hoy · 22 de agosto" }));
    await user.type(screen.getByLabelText("Motivo"), MOTIVO_OK);
    await user.click(confirmar());

    await waitFor(() => expect(errorMock).toHaveBeenCalled());
    expect(errorMock).toHaveBeenCalledWith(
      "No tienes una zona asignada. Pide a un administrador que te asigne una zona.",
    );
  });
});

// ---------------------------------------------------------------------------
// R18 — una sola fuente de texto: la pantalla lo IMPORTA, no lo escribe (mata M-x)
// ---------------------------------------------------------------------------
//
// Los casos de arriba prueban que el texto SE LEE; no pueden probar que no esté copiado dentro
// del componente —un literal idéntico los dejaría a todos verdes—. Esto lee el fuente y lo
// afirma directamente, con anti-vacuidad: si el archivo no se puede leer o llega vacío, revienta
// en vez de dar por buena una lectura de cero bytes.
const REPO_ROOT = path.join(__dirname, "..", "..");
const MODULO_TEXTOS = "lib/utils/dia-reparto-textos.ts";
const SUPERFICIES_DE_LA_CORRECCION = [
  "app/(app)/ordenes/_components/CambiarDiaRepartoModal.tsx",
  "app/(app)/recepcion-satelite/_components/CambiarDiaRepartoSateliteModal.tsx",
];

function leer(rel: string): string {
  const texto = readFileSync(path.join(REPO_ROOT, rel), "utf8");
  if (texto.trim().length === 0) {
    throw new Error(
      `262/F5: el censo leyó \`${rel}\` vacío. Se detiene en ROJO en vez de dar por buena una ` +
        `lectura de cero bytes: si el código se reorganizó, actualiza el censo — no borres la ` +
        `comprobación.`,
    );
  }
  return texto;
}

/** El código SIN comentarios: la prosa de estos archivos EXPLICA la regla nombrando el texto. */
function soloCodigo(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/**
 * Trozos que SÓLO pueden vivir en el módulo de textos. Si aparecen en el código de otro archivo
 * es que alguien devolvió el literal a la pantalla, que es la mutación M-x.
 */
const TROZOS_DEL_DIA: readonly string[] = [
  "hoy está para el",
  "El lote quedó para el reparto de",
  "Nuevo día de reparto",
  "No hay ninguna opción marcada de salida",
];

function trozosCopiados(fuente: string): string[] {
  return TROZOS_DEL_DIA.filter((trozo) => fuente.includes(trozo));
}

describe("R18 — el texto del día se importa; la pantalla no lo escribe", () => {
  it("el detector NO es vacío: los cuatro trozos están, verbatim, en el módulo de textos", () => {
    // La mitad que se olvida. Sin ella, un rename dejaría los `filter` de abajo buscando cadenas
    // que ya no existen y el censo pasaría por estar mirando al vacío.
    expect(trozosCopiados(leer(MODULO_TEXTOS)).sort()).toEqual([...TROZOS_DEL_DIA].sort());
  });

  for (const rel of SUPERFICIES_DE_LA_CORRECCION) {
    it(`${rel} saca el texto de la fuente única y no lo copia`, () => {
      const fuente = leer(rel);

      expect(
        fuente,
        `262/R18: ${rel} pinta el vocabulario del día, así que tiene que sacarlo de ` +
          `\`lib/utils/dia-reparto-textos\` — la misma fuente que ya usan la asignación y el ` +
          `portal del mensajero. Con dos redacciones, el día que alguien corrija una, esta ` +
          `pantalla dirá otra cosa que las demás.`,
      ).toContain("dia-reparto-textos");

      expect(
        trozosCopiados(soloCodigo(fuente)),
        `262/R18 (mutación M-x): ${rel} tiene el literal del día ESCRITO DENTRO.`,
      ).toEqual([]);
    });

    it(`${rel} no lee el reloj del navegador (R17)`, () => {
      const codigo = soloCodigo(leer(rel));
      for (const prohibido of [
        "new Date(",
        "Date.now(",
        "toLocaleDateString",
        "toLocaleString",
        "Intl.DateTimeFormat",
      ]) {
        expect(
          codigo.includes(prohibido),
          `«${prohibido}» aparece en ${rel}: el día de la pantalla dejaría de venir del servidor (R17)`,
        ).toBe(false);
      }
    });
  }

  it("autocomprobación: el detector caza una copia, deja pasar una importación y ve un `new Date()`", () => {
    expect(trozosCopiados('const t = `hoy está para el ${f}`;')).toEqual(["hoy está para el"]);
    expect(
      trozosCopiados('import { avisoDiaActualDeLaOrden } from "@/lib/utils/dia-reparto-textos";'),
    ).toEqual([]);
    expect(soloCodigo("// ni new Date()\nconst a = 1;").includes("new Date(")).toBe(false);
    expect(soloCodigo("const hoy = new Date();").includes("new Date(")).toBe(true);
  });
});
