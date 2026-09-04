// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ChangeEvent } from "react";

import {
  EvidenciasField,
  EVIDENCIAS_BOTON_CAMARA,
  EVIDENCIAS_BOTON_GALERIA,
  EVIDENCIA_MOTIVO_FORMATO,
  evidenciaMotivoTamano,
  evidenciasAriaLabelCamara,
  MAX_EVIDENCIAS,
  mensajeEvidenciasRechazadas,
  prepararEvidencias,
} from "@/components/shared/EvidenciasField";
import { GESTION_ALLOWED_MIME, gestionConfig } from "@/lib/config/gestion";

// `comprimirImagen` se MOCKEA a proposito: su propio comportamiento (canvas, EXIF, toBlob nulo)
// esta cubierto en `tests/unit/utils/comprimir-imagen.test.ts`, y en jsdom no hay canvas. Aqui lo
// que se prueba es CON QUE OPCIONES se le llama —que son las del chat (316/R29) y no los
// defaults— y que su resultado se valida foto a foto antes de aceptarla.
const comprimirImagenMock = vi.fn();
vi.mock("@/lib/utils/comprimir-imagen", () => ({
  comprimirImagen: (...a: unknown[]) => comprimirImagenMock(...a),
}));

// =================================================================================================
// El campo de fotos de evidencia, ahora COMPARTIDO por las tres superficies que suben evidencia
// (panel del mensajero, reporte de incidente del admin y gestión desde ayuda). Antes era el mismo
// componente escrito tres veces; este archivo es el test que gana al dejar de estarlo.
//
// Lo que protege y NINGÚN test de las tres pantallas protege por sí solo:
//   · que hay DOS vías —cámara y galería— y que cada botón dispara SU input. La trampa del
//     encargo es real: poner `capture` en el input único QUITA la galería, así que se afirma
//     tanto que el de cámara LO LLEVA como que el de galería NO;
//   · que las dos vías comparten `accept`, `multiple` y el MISMO `onChange`, o sea el mismo
//     tope, la misma validación y la misma previsualización;
//   · que el contrato accesible del input de galería (id + `aria-label`) NO cambió: es por donde
//     lo localizan las tres pantallas y sus tests.
//
// LÍMITE HONESTO: `capture` solo tiene efecto en un navegador móvil. Aquí se comprueba que el
// atributo está puesto en el input correcto y que el botón correcto lo dispara; que el sistema
// abra la cámara es cosa del dispositivo y no se puede afirmar desde jsdom.
// =================================================================================================

const ARIA_GALERIA = "Foto de evidencia de entrega";
const LABEL = "Fotos de evidencia";
const INPUT_ID = "evidencias-test";

function foto(nombre: string, type = "image/jpeg"): File {
  return new File(["x"], nombre, { type });
}

/** Los dos inputs, por su nombre accesible (que es lo único que los distingue en el DOM). */
function inputGaleria(): HTMLInputElement {
  return screen.getByLabelText(ARIA_GALERIA) as HTMLInputElement;
}
function inputCamara(): HTMLInputElement {
  return screen.getByLabelText(evidenciasAriaLabelCamara(ARIA_GALERIA)) as HTMLInputElement;
}
function botonCamara(): HTMLElement {
  return screen.getByRole("button", { name: EVIDENCIAS_BOTON_CAMARA });
}
function botonGaleria(): HTMLElement {
  return screen.getByRole("button", { name: EVIDENCIAS_BOTON_GALERIA });
}

/**
 * Arnés CONTROLADO: mantiene la lista igual que hacen las tres pantallas (concatena y recorta al
 * tope). Sin él no se podría afirmar lo que de verdad importa —que las dos vías alimentan LA
 * MISMA lista—, que es justo lo que un componente con dos inputs podría romper.
 */
function Harness({ ayuda, error }: { ayuda?: string; error?: string }) {
  const [files, setFiles] = useState<File[]>([]);
  function onSelect(e: ChangeEvent<HTMLInputElement>) {
    const elegidas = Array.from(e.target.files ?? []);
    e.target.value = "";
    setFiles((prev) => [...prev, ...elegidas].slice(0, MAX_EVIDENCIAS));
  }
  return (
    <EvidenciasField
      inputId={INPUT_ID}
      label={LABEL}
      ariaLabel={ARIA_GALERIA}
      files={files}
      error={error}
      onSelect={onSelect}
      onRemove={(i) => setFiles((prev) => prev.filter((_, j) => j !== i))}
      ayuda={ayuda}
    />
  );
}

let contadorBlob = 0;

beforeEach(() => {
  contadorBlob = 0;
  URL.createObjectURL = vi.fn(() => `blob:evidencia-${++contadorBlob}`);
  URL.revokeObjectURL = vi.fn();
  comprimirImagenMock.mockReset();
  // Peor caso honesto por defecto: el helper devuelve el archivo TAL CUAL (que es justo lo que
  // hace `comprimirImagen` cuando no puede decodificar).
  comprimirImagenMock.mockImplementation(async (f: File) => f);
});

afterEach(cleanup);

describe("EvidenciasField · las DOS vías de adjuntar (cámara y galería)", () => {
  it("ofrece los dos botones, cada uno con su nombre accesible", () => {
    render(<Harness />);

    expect(botonCamara()).toBeInTheDocument();
    expect(botonGaleria()).toBeInTheDocument();
    // Un grupo con nombre propio: el lector de pantalla anuncia que las dos vías van juntas.
    expect(
      within(screen.getByRole("group", { name: "Añadir fotos de evidencia" })).getAllByRole(
        "button",
      ),
    ).toHaveLength(2);
  });

  it("⭑ el botón de cámara dispara el input CON `capture`, y el de galería el que NO lo lleva", async () => {
    // ⚠️ LA MUTACIÓN QUE ESTE CASO MATA: cablear los dos botones al mismo input, o cruzarlos.
    // Sería exactamente el fallo mudo del encargo — dos botones que hacen lo mismo.
    const user = userEvent.setup();
    render(<Harness />);

    const spyCamara = vi.spyOn(inputCamara(), "click");
    const spyGaleria = vi.spyOn(inputGaleria(), "click");

    await user.click(botonCamara());
    expect(spyCamara).toHaveBeenCalledTimes(1);
    expect(spyGaleria).not.toHaveBeenCalled();

    await user.click(botonGaleria());
    expect(spyGaleria).toHaveBeenCalledTimes(1);
    expect(spyCamara).toHaveBeenCalledTimes(1);
  });

  it("⭑ `capture` está SOLO en el input de cámara: la galería sigue existiendo", () => {
    // ⚠️ LA MUTACIÓN QUE ESTE CASO MATA: añadir `capture` al input de galería (o quitárselo al de
    // cámara). Lo primero cambia un problema por otro —el móvil abre la cámara y ya no se puede
    // elegir una foto ya hecha—; lo segundo deja la feature sin hacer.
    render(<Harness />);

    expect(inputCamara()).toHaveAttribute("capture", "environment");
    expect(inputGaleria()).not.toHaveAttribute("capture");
  });

  it("las dos vías comparten `accept` y `multiple`: el tope y los formatos no cambian por la vía", () => {
    render(<Harness />);

    for (const input of [inputCamara(), inputGaleria()]) {
      expect(input).toHaveAttribute("accept", GESTION_ALLOWED_MIME.join(","));
      expect(input).toHaveAttribute("multiple");
      expect(input).toHaveAttribute("type", "file");
    }
  });

  it("el contrato del input de galería no cambia: mismo id y mismo nombre accesible", () => {
    render(<Harness />);

    // Es por donde lo localizan las tres pantallas (y sus tests). El de cámara deriva su id del
    // mismo prefijo, así que dos campos en la misma página siguen sin colisionar.
    expect(inputGaleria()).toHaveAttribute("id", INPUT_ID);
    expect(inputCamara()).toHaveAttribute("id", `${INPUT_ID}-camara`);
    expect(screen.getByText(LABEL)).toHaveAttribute("for", INPUT_ID);
  });

  it("⭑ las dos vías alimentan LA MISMA lista de evidencias", async () => {
    // ⚠️ LA MUTACIÓN QUE ESTE CASO MATA: darle al input de cámara un manejador propio (o
    // ninguno). Las fotos tomadas se perderían en silencio y el usuario no vería su evidencia.
    const user = userEvent.setup();
    render(<Harness />);

    await user.upload(inputCamara(), foto("tomada.jpg"));
    await user.upload(inputGaleria(), foto("elegida.jpg"));

    const lista = screen.getByRole("list", { name: "Fotos de evidencia seleccionadas" });
    expect(within(lista).getAllByRole("img")).toHaveLength(2);
    expect(screen.getByText(`JPEG · PNG · WEBP · hasta 3 fotos (2/3)`)).toBeInTheDocument();
  });

  it("el tope se respeta venga la foto de donde venga", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.upload(inputCamara(), [foto("a.jpg"), foto("b.jpg"), foto("c.jpg")]);
    await user.upload(inputCamara(), foto("d.jpg"));

    const lista = screen.getByRole("list", { name: "Fotos de evidencia seleccionadas" });
    expect(within(lista).getAllByRole("img")).toHaveLength(MAX_EVIDENCIAS);
  });

  it("quitar una foto la saca de la lista y revoca su object URL", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.upload(inputGaleria(), [foto("a.jpg"), foto("b.jpg")]);
    await user.click(screen.getByRole("button", { name: "Quitar evidencia 1" }));

    const lista = screen.getByRole("list", { name: "Fotos de evidencia seleccionadas" });
    expect(within(lista).getAllByRole("img")).toHaveLength(1);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("el error se anuncia y marca LOS DOS inputs como inválidos", () => {
    render(<Harness error="Solo puedes adjuntar hasta 3 fotos." />);

    expect(screen.getByRole("alert")).toHaveTextContent("Solo puedes adjuntar hasta 3 fotos.");
    expect(inputCamara()).toHaveAttribute("aria-invalid", "true");
    expect(inputGaleria()).toHaveAttribute("aria-invalid", "true");
  });

  it("la ayuda y el límite describen las dos vías y los dos botones", () => {
    render(<Harness ayuda="Fotografiá la guía si no tenés el paquete." />);

    const esperado = `${INPUT_ID}-limite ${INPUT_ID}-ayuda`;
    for (const el of [inputCamara(), inputGaleria(), botonCamara(), botonGaleria()]) {
      expect(el).toHaveAttribute("aria-describedby", esperado);
    }
    // Se lee entero, como haría un lector de pantalla: los dos ids existen y tienen texto.
    const texto = esperado
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(texto).toContain("Fotografiá la guía");
    expect(texto).toContain("hasta 3 fotos");
  });

  it("sin `ayuda` no queda un id colgando en `aria-describedby`", () => {
    render(<Harness />);

    expect(inputGaleria()).toHaveAttribute("aria-describedby", `${INPUT_ID}-limite`);
    expect(document.getElementById(`${INPUT_ID}-ayuda`)).toBeNull();
  });
});

// =================================================================================================
// `prepararEvidencias` — convertir con las opciones del chat y avisar AL ELEGIR
// =================================================================================================
//
// El caso de uso de la cámara es un mensajero con un móvil, y la mitad de esos móviles son
// iPhone: si el HEIC no se convierte, el botón de cámara falla para ellos. Lo que sigue es la
// regresión que lo impide, y el aviso que dice CUÁL foto se quedó fuera.

const MB = 1024 * 1024;
function archivo(nombre: string, type: string, size: number): File {
  const f = new File(["x"], nombre, { type });
  Object.defineProperty(f, "size", { value: size, configurable: true });
  return f;
}

describe("prepararEvidencias · conversión y aviso por foto", () => {
  it("⭑ llama a `comprimirImagen` con las MISMAS opciones que el chat, no con los defaults", async () => {
    // ⚠️ LA MUTACIÓN QUE ESTE CASO MATA: volver a `comprimirImagen(f)` a secas (o quitar uno de
    // los dos flags). Con `saltarSiMenorA` en su default de 1 MB, un HEIC de iPhone POR DEBAJO
    // de 1 MB pasaría sin convertir y el borde lo rechazaría por MIME — la cámara entregada
    // rota justo para quien más la necesita.
    await prepararEvidencias([archivo("IMG_0045.heic", "image/heic", 200 * 1024)]);

    expect(comprimirImagenMock).toHaveBeenCalledTimes(1);
    const opciones = comprimirImagenMock.mock.calls[0][1] as Record<string, unknown>;
    expect(opciones.saltarSiMenorA).toBe(0);
    expect(opciones.devolverOriginalSiMayor).toBe(false);
  });

  it("un HEIC pequeño convertido a JPEG SÍ se acepta (el atajo por tamaño está apagado)", async () => {
    comprimirImagenMock.mockResolvedValue(archivo("IMG_0045.jpg", "image/jpeg", 180 * 1024));

    const { aceptadas, rechazadas } = await prepararEvidencias([
      archivo("IMG_0045.heic", "image/heic", 200 * 1024),
    ]);

    expect(rechazadas).toHaveLength(0);
    expect(aceptadas.map((f) => f.type)).toEqual(["image/jpeg"]);
  });

  it("⭑ un HEIC que NO se pudo convertir se rechaza NOMBRÁNDOLO, no en silencio", async () => {
    // ⚠️ LA MUTACIÓN QUE ESTE CASO MATA: aceptar lo que devuelva el helper sin validarlo. La
    // foto entraría en la lista, se vería su previsualización, y el rechazo llegaría al pulsar
    // «Guardar gestión» sin decir cuál de las tres sobra.
    const { aceptadas, rechazadas } = await prepararEvidencias([
      archivo("IMG_0045.heic", "image/heic", 200 * 1024),
    ]);

    expect(aceptadas).toHaveLength(0);
    expect(rechazadas).toEqual([
      { nombre: "IMG_0045.heic", motivo: EVIDENCIA_MOTIVO_FORMATO },
    ]);
    expect(mensajeEvidenciasRechazadas(rechazadas)).toBe(
      "No se adjuntó «IMG_0045.heic»: debe ser JPEG, PNG o WEBP.",
    );
  });

  it("⭑ una foto que pasa del límite de tamaño se rechaza AL ELEGIRLA, con su nombre", async () => {
    const limiteMb = Math.floor(gestionConfig.MAX_FILE_BYTES / MB);
    const { aceptadas, rechazadas } = await prepararEvidencias([
      archivo("cabe.jpg", "image/jpeg", 400 * 1024),
      archivo("enorme.jpg", "image/jpeg", gestionConfig.MAX_FILE_BYTES + 1),
    ]);

    expect(aceptadas.map((f) => f.name)).toEqual(["cabe.jpg"]);
    expect(mensajeEvidenciasRechazadas(rechazadas)).toBe(
      `No se adjuntó «enorme.jpg»: supera los ${limiteMb} MB.`,
    );
    expect(evidenciaMotivoTamano()).toBe(`supera los ${limiteMb} MB`);
  });

  it("con varias descartadas se nombran TODAS, no solo la primera", async () => {
    const { rechazadas } = await prepararEvidencias([
      archivo("a.heic", "image/heic", 200 * 1024),
      archivo("b.jpg", "image/jpeg", 9 * MB),
    ]);

    const mensaje = mensajeEvidenciasRechazadas(rechazadas) ?? "";
    expect(mensaje).toContain("«a.heic»");
    expect(mensaje).toContain("«b.jpg»");
    expect(mensaje).toMatch(/^No se adjuntaron 2 fotos:/);
  });

  it("sin descartadas no hay aviso que dar", async () => {
    const { aceptadas, rechazadas } = await prepararEvidencias([
      archivo("a.jpg", "image/jpeg", 300 * 1024),
    ]);

    expect(aceptadas).toHaveLength(1);
    expect(mensajeEvidenciasRechazadas(rechazadas)).toBeNull();
  });
});
