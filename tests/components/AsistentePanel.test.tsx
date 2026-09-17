// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AsistentePanel, trozosConNegrita } from "@/components/shared/AsistentePanel";
import { AsistenteProvider, useAsistente } from "@/providers/AsistenteProvider";
import {
  CONTENT_TYPE_NDJSON,
  serializarEvento,
  type EventoAsistente,
} from "@/lib/asistente/protocolo";

// ═════════════════════════════════════════════════════════════════════════════════════════════
// ⭑ FICHA 436 (T15/T16) — EL PANEL DEL ASISTENTE: R22, R25, R27, R28, R29 y la mitad de R30.
// ═════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠️ LA SUITE NO TOCA LA RED, y aquí eso no es una promesa: el transporte se INYECTA
// (`fetchImpl`). Si alguna vez un caso de este archivo necesitara el proveedor de verdad, el caso
// estaría mal escrito — y la guardia de red lo diría.
//
// ⚠️ EL PANEL SE MONTA COMO EN LA APLICACIÓN: hermano del contenido de la página, no
// envolviéndolo. Montarlo alrededor pasaría estos tests igual y perdería justo lo que R22 mide.
// Que en el layout de verdad siga siendo hermano lo vigila
// `tests/unit/guards/asistente-panel-hermano.guardia.test.ts`, no este archivo.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SLUG = "mensajero/reparto";
const RUTA = "/mis-asignaciones/reparto";

const DOC_REPARTO = { slug: SLUG, titulo: "Reparto", href: `/ayuda/${SLUG}` };
const DOC_RECOGER = {
  slug: "mensajero/por-recoger",
  titulo: "Por recoger",
  href: "/ayuda/mensajero/por-recoger",
};

/** Una respuesta NDJSON de verdad: el panel la lee por `body.getReader()`, como en producción. */
function respuestaNdjson(...eventos: readonly EventoAsistente[]): Response {
  return new Response(eventos.map(serializarEvento).join(""), {
    status: 200,
    headers: { "content-type": CONTENT_TYPE_NDJSON },
  });
}

/** Un rechazo PREVIO al stream, con la forma `AppErrorShape` que devuelve el borde. */
function respuestaDeRechazo(status: number, message: string): Response {
  return new Response(JSON.stringify({ status: "error", code: "CONFLICT", message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** La respuesta normal: un documento entregado y una cita válida. */
function respuestaConCita(): Response {
  return respuestaNdjson(
    { tipo: "inicio", documentos: [DOC_REPARTO, DOC_RECOGER], partida: SLUG },
    { tipo: "texto", texto: "Está reservada para otro día. " },
    { tipo: "texto", texto: "Lo tenés en [[doc:mensajero/reparto]]." },
    { tipo: "fin" },
  );
}

/**
 * La PÁGINA de debajo, con su encabezado y su contenido. Existe para que R22 se pueda medir: sin
 * una página real, «el panel no rompe la pantalla» no tiene nada que afirmar.
 */
function PaginaDePrueba({ slug = SLUG }: { slug?: string | null }) {
  const { abrir } = useAsistente();
  return (
    <>
      <header>
        <h1>Órdenes</h1>
        <button type="button" onClick={() => abrir({ slug, ruta: RUTA })}>
          Ayuda de esta pantalla
        </button>
      </header>
      <main>
        <p>La tabla de órdenes de esta pantalla</p>
      </main>
    </>
  );
}

function montar(fetchImpl: typeof fetch, slug: string | null = SLUG) {
  return render(
    <AsistenteProvider fetchImpl={fetchImpl}>
      <PaginaDePrueba slug={slug} />
      <AsistentePanel />
    </AsistenteProvider>,
  );
}

/** Abre el panel como lo abre la aplicación: por el control del encabezado. */
async function abrirPanel(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.click(screen.getByRole("button", { name: "Ayuda de esta pantalla" }));
  return await screen.findByRole("dialog");
}

async function preguntar(usuario: ReturnType<typeof userEvent.setup>, texto: string) {
  await usuario.type(screen.getByLabelText("Escribí tu pregunta"), texto);
  await usuario.click(screen.getByRole("button", { name: "Enviar la pregunta" }));
}

/** El último turno del asistente, para acotar las consultas de citas a ESA respuesta. */
function turnoDelAsistente(): HTMLElement {
  const turnos = within(
    screen.getByRole("log", { name: "Conversación con el asistente" }),
  ).getAllByRole("listitem");
  return turnos[turnos.length - 1];
}

describe("436/R22 — un fallo del asistente NO rompe la pantalla en la que está montado", () => {
  it("⭑ con la RUTA CAÍDA, el panel pinta su error y la página sigue entera", async () => {
    const usuario = userEvent.setup();
    const caida: typeof fetch = () => Promise.reject(new Error("ECONNREFUSED"));
    montar(caida);

    await abrirPanel(usuario);
    await preguntar(usuario, "¿por qué no puedo recoger?");

    // El panel dice lo suyo, con un mensaje propio y no el error crudo (R21).
    const aviso = await screen.findByRole("alert");
    expect(aviso).toHaveTextContent(/No se pudo hablar con el asistente/);
    expect(aviso.textContent).not.toMatch(/ECONNREFUSED/);

    // ⭑ Y LA PANTALLA SIGUE AHÍ. Es lo único que R22 pide, y es lo que un panel que envolviera
    // el contenido podría haberse llevado por delante con un `return null`.
    expect(screen.getByRole("heading", { level: 1, name: "Órdenes" })).toBeInTheDocument();
    expect(screen.getByText("La tabla de órdenes de esta pantalla")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ayuda de esta pantalla" })).toBeInTheDocument();
  });

  it("con un rechazo del servidor (el tope del día) pasa lo mismo, y se ve SU mensaje", async () => {
    const usuario = userEvent.setup();
    // El literal que redacta el servidor (`mensajeTopeAlcanzado`). Se escribe a mano: compararlo
    // contra la función que lo genera estaría verde aunque el mensaje dejara de llegar.
    const tope = "Llegaste a las 30 preguntas de hoy. Mañana volvés a tener.";
    montar(() => Promise.resolve(respuestaDeRechazo(409, tope)));

    await abrirPanel(usuario);
    await preguntar(usuario, "otra más");

    expect(await screen.findByText(tope)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Órdenes" })).toBeInTheDocument();
    expect(screen.getByText("La tabla de órdenes de esta pantalla")).toBeInTheDocument();
  });

  it("y con el panel ABIERTO y respondiendo bien, la página tampoco desaparece", async () => {
    // El control negativo de los dos de arriba: si la página se hubiera perdido por el simple
    // hecho de abrir el panel, aquellos seguirían en verde por el motivo equivocado.
    const usuario = userEvent.setup();
    montar(() => Promise.resolve(respuestaConCita()));

    await abrirPanel(usuario);
    await preguntar(usuario, "¿por qué?");
    await screen.findByText(/Está reservada para otro día/);

    expect(screen.getByRole("heading", { level: 1, name: "Órdenes" })).toBeInTheDocument();
    expect(screen.getByText("La tabla de órdenes de esta pantalla")).toBeInTheDocument();
  });
});

describe("436/R27 — la conversación arranca con el documento de ESTA pantalla", () => {
  it("⭑ la PRIMERA acción visible del panel es «Leer la ayuda de esta pantalla», a ESE slug", async () => {
    const usuario = userEvent.setup();
    montar(() => Promise.resolve(respuestaConCita()));
    const panel = await abrirPanel(usuario);

    const ayuda = within(panel).getByRole("link", { name: /Leer la ayuda de esta pantalla/ });
    expect(ayuda).toHaveAttribute("href", `/ayuda/${SLUG}`);

    // ⭑ «PRIMERA» ES UNA POSICIÓN, NO UNA OPINIÓN: va antes de la conversación y antes de la
    // barra de entrada. Si alguien la bajara al pie del panel, esto se pone rojo.
    const conversacion = within(panel).getByRole("log");
    const entrada = within(panel).getByLabelText("Escribí tu pregunta");
    expect(ayuda.compareDocumentPosition(conversacion)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(ayuda.compareDocumentPosition(entrada)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("⭑ la ruta de apertura viaja como `rutaActual`, que es con lo que el servidor resuelve R27", async () => {
    const usuario = userEvent.setup();
    const espia = vi.fn<typeof fetch>(() => Promise.resolve(respuestaConCita()));
    montar(espia);

    await abrirPanel(usuario);
    await preguntar(usuario, "¿por qué no puedo recoger?");
    await screen.findByText(/Está reservada para otro día/);

    const [url, init] = espia.mock.calls[0];
    expect(url).toBe("/api/asistente");
    const cuerpo = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(cuerpo.rutaActual).toBe(RUTA);
    expect(cuerpo.mensajes).toEqual([
      { autor: "usuario", texto: "¿por qué no puedo recoger?" },
    ]);
    // ⚠️ El schema del borde es `.strict()`: una clave de más es un 422. Estas DOS son todas.
    expect(Object.keys(cuerpo).sort()).toEqual(["mensajes", "rutaActual"]);
  });

  it("el título del documento de partida lo dice el SERVIDOR, no el panel", async () => {
    const usuario = userEvent.setup();
    montar(() => Promise.resolve(respuestaConCita()));
    const panel = await abrirPanel(usuario);

    // Antes de preguntar, el panel sabe el slug (se lo dio el «?») pero no el título.
    expect(within(panel).queryByText("Reparto")).toBeNull();

    await preguntar(usuario, "¿por qué?");

    // Tras el `inicio`, con `partida: "mensajero/reparto"`, el título aparece junto al enlace.
    const ayuda = await within(panel).findByRole("link", {
      name: /Leer la ayuda de esta pantalla/,
    });
    await waitFor(() => expect(ayuda).toHaveTextContent("Reparto"));
  });

  it("en una pantalla SIN documento no se pinta el enlace (nunca uno a un vacío)", async () => {
    const usuario = userEvent.setup();
    montar(() => Promise.resolve(respuestaConCita()), null);
    const panel = await abrirPanel(usuario);

    expect(
      within(panel).queryByRole("link", { name: /Leer la ayuda de esta pantalla/ }),
    ).toBeNull();
    // Y el panel sigue siendo usable: preguntar no depende de que la pantalla tenga documento.
    expect(within(panel).getByLabelText("Escribí tu pregunta")).toBeInTheDocument();
  });
});

describe("436/R25 — sin documentos señalados no hay sección de fuentes ni enlaces", () => {
  it("⭑ una respuesta SIN marcadores no pinta ningún enlace en su turno", async () => {
    const usuario = userEvent.setup();
    montar(() =>
      Promise.resolve(
        respuestaNdjson(
          { tipo: "inicio", documentos: [DOC_REPARTO, DOC_RECOGER], partida: SLUG },
          { tipo: "texto", texto: "No lo sé, y no puedo consultarlo." },
          { tipo: "fin" },
        ),
      ),
    );

    await abrirPanel(usuario);
    await preguntar(usuario, "¿cuánto me pagan?");
    await screen.findByText("No lo sé, y no puedo consultarlo.");

    // Acotado al TURNO: el enlace de «Leer la ayuda de esta pantalla» vive fuera de la
    // conversación y no es una cita.
    expect(within(turnoDelAsistente()).queryAllByRole("link")).toEqual([]);
  });

  it("⭑ CONTRAPRUEBA — con un marcador válido SÍ se pinta el documento citado", async () => {
    // Sin esto, el caso de arriba podría estar verde porque el panel no pinte citas NUNCA.
    const usuario = userEvent.setup();
    montar(() => Promise.resolve(respuestaConCita()));

    await abrirPanel(usuario);
    await preguntar(usuario, "¿por qué?");
    await screen.findByText(/Está reservada para otro día/);

    const cita = await within(turnoDelAsistente()).findByRole("link", { name: "Reparto" });
    expect(cita).toHaveAttribute("href", `/ayuda/${SLUG}`);
    // Y el marcador NO se ve: es protocolo entre el modelo y nosotros, no prosa.
    expect(turnoDelAsistente().textContent).not.toContain("[[doc:");
  });

  it("un documento que NO estaba en lo entregado se descarta y no deja enlace (R24 en pantalla)", async () => {
    const usuario = userEvent.setup();
    montar(() =>
      Promise.resolve(
        respuestaNdjson(
          // Sólo se entregó el de reparto...
          { tipo: "inicio", documentos: [DOC_REPARTO], partida: SLUG },
          // ...y el modelo cita uno de OFICINA, que este rol no puede abrir.
          { tipo: "texto", texto: "Mirá [[doc:oficina/wallet-caja]] para eso." },
          { tipo: "fin" },
        ),
      ),
    );

    await abrirPanel(usuario);
    await preguntar(usuario, "¿y la caja?");
    // El matcher de testing-library normaliza espacios, y quitar el marcador deja dos: por eso
    // se busca por el trozo estable y no por la frase entera.
    await screen.findByText(/para eso\./);

    expect(within(turnoDelAsistente()).queryAllByRole("link")).toEqual([]);
    // Y ni siquiera se ve el NOMBRE del documento que no puede leer.
    expect(turnoDelAsistente().textContent).not.toContain("oficina/wallet-caja");
  });
});

describe("436/R28 — el aviso de datos, siempre a la vista y sin abrir nada", () => {
  // ⭑ EL LITERAL VA ESCRITO A MANO, no importado de la constante. Compararlo contra su propia
  // fuente estaría verde aunque el aviso cambiara a «enviamos cosas a sitios» — y este aviso es
  // lo ÚNICO que le dice a la persona que lo que escribe sale de la empresa.
  const AVISO =
    "Si mandás una captura, su contenido se procesa con un proveedor externo de inteligencia artificial. Evitá enviar datos de clientes si no hace falta.";

  it("⭑ con el panel recién abierto, el aviso se lee TAL CUAL, sin tocar nada más", async () => {
    const usuario = userEvent.setup();
    montar(() => Promise.resolve(respuestaConCita()));
    const panel = await abrirPanel(usuario);

    // Un solo gesto: abrir. Ningún `click` en un desplegable, ningún `hover`.
    expect(within(panel).getByText(AVISO)).toBeVisible();
  });

  it("⭑ y NO cuelga de ningún desplegable: ni `<details>` ni nada oculto", async () => {
    const usuario = userEvent.setup();
    montar(() => Promise.resolve(respuestaConCita()));
    const panel = await abrirPanel(usuario);

    const aviso = within(panel).getByText(AVISO);
    // La forma exacta en la que este aviso se perdería: alguien lo mete en un acordeón «para que
    // no moleste». `getByText` ya fallaría con un Collapsible que desmonta; esto caza el
    // `<details>`, que sí deja el texto en el DOM.
    expect(aviso.closest("details")).toBeNull();
    expect(aviso.closest("[hidden]")).toBeNull();
    expect(aviso.closest('[aria-hidden="true"]')).toBeNull();

    // Y vive BAJO LA BARRA DE ENTRADA, que es donde la maqueta lo pone: pegado al gesto que
    // manda los datos, no perdido arriba del todo.
    const entrada = within(panel).getByLabelText("Escribí tu pregunta");
    const barra = entrada.closest("form");
    expect(barra).not.toBeNull();
    expect(barra!.contains(aviso)).toBe(true);
    expect(entrada.compareDocumentPosition(aviso)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("sigue estando después de conversar: no es un cartel de bienvenida que se va", async () => {
    const usuario = userEvent.setup();
    montar(() => Promise.resolve(respuestaConCita()));
    const panel = await abrirPanel(usuario);

    await preguntar(usuario, "¿por qué?");
    await screen.findByText(/Está reservada para otro día/);

    expect(within(panel).getByText(AVISO)).toBeVisible();
  });
});

describe("436/R29 — imágenes sí, audio no", () => {
  it("⭑ hay un control de imagen, con la LISTA BLANCA de formatos", async () => {
    const usuario = userEvent.setup();
    montar(() => Promise.resolve(respuestaConCita()));
    const panel = await abrirPanel(usuario);

    const adjunto = within(panel).getByLabelText("Adjuntar una captura");
    expect(adjunto).toHaveAttribute("type", "file");
    // Literal a mano: `image/*` pasaría un test escrito contra la constante y aquí no pasa.
    expect(adjunto).toHaveAttribute("accept", "image/png,image/jpeg,image/webp");
  });

  it("⭑ NINGÚN control acepta audio, y no existe ninguno de grabación", async () => {
    const usuario = userEvent.setup();
    const { container } = montar(() => Promise.resolve(respuestaConCita()));
    const panel = await abrirPanel(usuario);

    // 1. Ningún `accept` del árbol del panel nombra audio (ni `audio/*`, ni `image/*` a secas).
    for (const campo of panel.querySelectorAll<HTMLInputElement>("input[type=file]")) {
      expect(campo.accept).not.toMatch(/audio/i);
      expect(campo.accept).not.toBe("image/*");
      // Una por mensaje (Q6): sin `multiple`.
      expect(campo.multiple).toBe(false);
    }

    // 2. Ningún control se ofrece a grabar. No es «no implementado»: el modelo que responde no
    //    transcribe voz, así que un micrófono aquí sería una promesa falsa.
    for (const control of within(panel).getAllByRole("button")) {
      expect(control.getAttribute("aria-label") ?? control.textContent ?? "").not.toMatch(
        /grabar|micr[oó]fono|audio|nota de voz/i,
      );
    }
    expect(container.querySelector("[data-grabar], [data-audio]")).toBeNull();
  });

  it("una imagen elegida se muestra adjunta y se puede quitar antes de enviar", async () => {
    const usuario = userEvent.setup();
    montar(() => Promise.resolve(respuestaConCita()));
    const panel = await abrirPanel(usuario);

    // Un PNG diminuto: por debajo del tope, así que no se recodifica y `comprimirImagen` —que
    // necesita `canvas`, y jsdom no lo tiene— ni se llama. Ese camino es el de producción para
    // una captura de pantalla normal.
    const archivo = new File([new Uint8Array([1, 2, 3, 4])], "captura.png", {
      type: "image/png",
    });
    await usuario.upload(within(panel).getByLabelText("Adjuntar una captura"), archivo);

    expect(await within(panel).findByAltText(/captura\.png/)).toBeInTheDocument();
    await usuario.click(within(panel).getByRole("button", { name: "Quitar la imagen adjunta" }));
    expect(within(panel).queryByAltText(/captura\.png/)).toBeNull();
  });

  it("⭑ la imagen viaja en el cuerpo, en base64 y con su tipo de medio", async () => {
    const usuario = userEvent.setup();
    const espia = vi.fn<typeof fetch>(() => Promise.resolve(respuestaConCita()));
    montar(espia);
    const panel = await abrirPanel(usuario);

    const archivo = new File([new Uint8Array([1, 2, 3, 4])], "captura.png", {
      type: "image/png",
    });
    await usuario.upload(within(panel).getByLabelText("Adjuntar una captura"), archivo);
    await within(panel).findByAltText(/captura\.png/);

    await preguntar(usuario, "¿qué significa esto?");
    await waitFor(() => expect(espia).toHaveBeenCalled());

    const cuerpo = JSON.parse(String(espia.mock.calls[0][1]?.body)) as {
      mensajes: Array<{ imagenes?: Array<{ medio: string; datosBase64: string }> }>;
    };
    expect(cuerpo.mensajes[0].imagenes).toHaveLength(1);
    expect(cuerpo.mensajes[0].imagenes![0].medio).toBe("image/png");
    // Base64 SIN el prefijo `data:`, que es como lo espera el borde.
    expect(cuerpo.mensajes[0].imagenes![0].datosBase64).toBe("AQIDBA==");
  });
});

// ⭑ HALLAZGO DEL NAVEGADOR (2026-09-17), no de la suite: el modelo responde en Markdown y la
// pantalla enseñaba los `**` en crudo, seis u ocho por respuesta. Ningún test lo veía porque
// todos afirman el TEXTO, y `toHaveTextContent` normaliza. Estos casos son el ancla.
describe("436 — la negrita del modelo se pinta, no se enseña en crudo", () => {
  it("⭑ `**así**` sale como <strong>, y sin asteriscos a la vista", async () => {
    const usuario = userEvent.setup();
    montar(() =>
      Promise.resolve(
        respuestaNdjson(
          { tipo: "inicio", documentos: [DOC_REPARTO], partida: SLUG },
          { tipo: "texto", texto: "Primero **asigná el mensajero** y después confirmá." },
          { tipo: "fin" },
        ),
      ),
    );

    await abrirPanel(usuario);
    await preguntar(usuario, "¿cómo asigno?");
    await screen.findByText(/Primero/);

    const turno = turnoDelAsistente();
    expect(turno.querySelector("strong")).toHaveTextContent("asigná el mensajero");
    expect(turno.textContent).not.toContain("**");
  });

  it("la función es pura y no se come nada: sin marcas, un `**` suelto, y varias negritas", () => {
    expect(trozosConNegrita("sin marcas")).toEqual([{ texto: "sin marcas", fuerte: false }]);
    // Un `**` sin cerrar se queda como texto: comerse media respuesta buscando el cierre sería peor.
    expect(trozosConNegrita("a ** b")).toEqual([{ texto: "a ** b", fuerte: false }]);
    expect(trozosConNegrita("**uno** y **dos**")).toEqual([
      { texto: "uno", fuerte: true },
      { texto: " y ", fuerte: false },
      { texto: "dos", fuerte: true },
    ]);
  });

  it("⭑ y NO se interpreta HTML que venga del proveedor", () => {
    // El otro extremo de no meter un intérprete de Markdown: aquí nada se inyecta como HTML.
    expect(trozosConNegrita("<img src=x onerror=alert(1)>")).toEqual([
      { texto: "<img src=x onerror=alert(1)>", fuerte: false },
    ]);
  });
});

describe("436/R30 — la conversación vive en el cliente y se pierde al recargar", () => {
  it("⭑ recargar la pestaña la pierde: no hay nada guardado de dónde recuperarla", async () => {
    const usuario = userEvent.setup();
    const { unmount } = montar(() => Promise.resolve(respuestaConCita()));

    await abrirPanel(usuario);
    await preguntar(usuario, "una pregunta con el nombre de doña Marta");
    await screen.findByText(/Está reservada para otro día/);
    expect(screen.getByText("una pregunta con el nombre de doña Marta")).toBeInTheDocument();

    // Desmontar y volver a montar el árbol ES lo que hace una recarga con el estado en memoria.
    unmount();
    montar(() => Promise.resolve(respuestaConCita()));
    const panel = await abrirPanel(usuario);

    expect(within(panel).queryByText("una pregunta con el nombre de doña Marta")).toBeNull();
    expect(within(panel).getByRole("log")).toHaveTextContent(/Pregunt[aá] lo que no te cuadre/);
  });

  it("⭑ y no se escribe NADA en el navegador: ni almacenamiento ni cookie", async () => {
    const usuario = userEvent.setup();
    const local = vi.spyOn(Storage.prototype, "setItem");
    const cookie = vi.spyOn(document, "cookie", "set");
    montar(() => Promise.resolve(respuestaConCita()));

    await abrirPanel(usuario);
    await preguntar(usuario, "el nombre de un cliente y un número de guía");
    await screen.findByText(/Está reservada para otro día/);

    // Mientras nada de esto se persista no hay retención que decidir ni dato que custodiar.
    expect(local).not.toHaveBeenCalled();
    expect(cookie).not.toHaveBeenCalled();
  });

  it("⭑ la SEGUNDA pregunta viaja con el hilo entero, no sola", async () => {
    // El servidor no guarda nada (D10): el hilo es responsabilidad del cliente, así que si el
    // cuerpo de la segunda consulta saliera con un solo mensaje, el asistente habría perdido el
    // contexto y nadie se enteraría — la respuesta seguiría llegando, sólo que peor.
    const usuario = userEvent.setup();
    const espia = vi.fn<typeof fetch>(() => Promise.resolve(respuestaConCita()));
    montar(espia);

    await abrirPanel(usuario);
    await preguntar(usuario, "la primera");
    await screen.findByText(/Está reservada para otro día/);
    await preguntar(usuario, "la segunda");
    await waitFor(() => expect(espia).toHaveBeenCalledTimes(2));

    const segunda = JSON.parse(String(espia.mock.calls[1][1]?.body)) as {
      mensajes: Array<{ autor: string; texto: string }>;
    };
    expect(segunda.mensajes.map((m) => m.autor)).toEqual(["usuario", "asistente", "usuario"]);
    expect(segunda.mensajes[0].texto).toBe("la primera");
    expect(segunda.mensajes[2].texto).toBe("la segunda");
  });

  it("cerrar el panel NO borra la conversación (eso sería otra cosa, y molesta)", async () => {
    const usuario = userEvent.setup();
    montar(() => Promise.resolve(respuestaConCita()));

    await abrirPanel(usuario);
    await preguntar(usuario, "¿por qué?");
    await screen.findByText(/Está reservada para otro día/);

    await usuario.click(screen.getByRole("button", { name: "Cerrar el asistente" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    const panel = await abrirPanel(usuario);
    expect(within(panel).getByText("¿por qué?")).toBeInTheDocument();
  });
});
