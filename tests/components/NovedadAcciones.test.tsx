// @vitest-environment jsdom
// FEATURE 236 (T5.2 — R21/R22/R23) — LA FILA OFRECE LO QUE LA TABLA DICE, Y NADA MÁS.
//
// **Por qué este archivo existe aparte de `NovedadesModule.test.tsx`.** Aquel monta la card POS
// entera y mide la pantalla; éste ataca el panel de acciones DIRECTAMENTE, que es donde vive la
// decisión. La diferencia importa: hasta el 2026-08-19 esa decisión eran condiciones sueltas
// (`esDevuelta`, `esAyuda`, `puedeHabilitar = esDevuelta || esAyuda`) y bastaba con añadir una
// acción sin acordarse del otro grupo para que apareciera donde no debía — que es exactamente el
// defecto del punto 12. ⚠️ 2026-08-20: hasta hoy esa frase terminaba en «todavía vivo y con dueño
// (ficha 240)». La 240 lo cerró borrando la celda, así que el defecto ya no está vivo; lo que sigue
// vivo es la razón de medir el censo, que es lo que impide que vuelva.
//
// **Lo que se mide es un CENSO CERRADO de nombres accesibles**, ni uno más ni uno menos. Un censo
// abierto («están estos tres») pasaría igual con un cuarto botón de más, que es la forma que tiene
// esta pantalla de romperse.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { NovedadAcciones } from "@/app/(app)/novedades/_components/NovedadAcciones";
import type { NovedadDTO } from "@/lib/types/novedad";

vi.mock("@/lib/actions/orden-ayuda", () => ({
  solicitarAyudaOrden: vi.fn(),
  recuperarOrdenAyuda: vi.fn(),
  registrarIntentoContactoOrden: vi.fn(),
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

const DESTINATARIO = "Ana Cliente";

function novedad(over: Partial<NovedadDTO> = {}): NovedadDTO {
  return {
    id: "o1",
    numGuia: 12345,
    numRemision: "REM-001",
    estatusValue: "devuelta",
    intentosContacto: 0,
    mensajeroNombre: "Marta Mensajera",
    destinatario: DESTINATARIO,
    telefonoDest: "88887777",
    direccion: "Av. Central 120",
    producto: "Zapatos",
    peso: 1.5,
    montoCobrar: 24500,
    latitud: 9.9281,
    longitud: -84.0907,
    notas: null,
    tiendaNombre: "Tienda Demo",
    zonaNombre: "GAM Oeste",
    provinciaNombre: "San José",
    cantonNombre: "Escazú",
    distritoNombre: "San Rafael",
    secuenciaRuta: null,
    causa: "not_found",
    intentosEntrega: 2,
    ...over,
  };
}

const handlers = {
  onReprogramar: vi.fn(),
  onHabilitar: vi.fn(),
  // 240 (T5.3): hasta el 2026-08-20 se llamaba `onDevolver` y su handler real era la MAQUETA (un
  // `toast.info`). Ahora abre la ventana del rechazo, que crea una gestión y cobra.
  onRechazar: vi.fn(),
  onConversacion: vi.fn(),
  // Feature 237 (T7.1): UN handler para los dos desenlaces, con el modo como segundo argumento.
  onGestionarDesdeAyuda: vi.fn(),
};

function renderAcciones(over: Partial<NovedadDTO> = {}) {
  return render(<NovedadAcciones novedad={novedad(over)} {...handlers} />);
}

/** Los nombres accesibles de TODOS los controles de la fila, en el orden en que se pintan. */
function censoDeBotones(): string[] {
  return screen
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("NovedadAcciones — censo por grupo (236/R22/R23)", () => {
  // ⚠️ FEATURE 237 (T7.1, 2026-08-20) — ESTE CASO CAMBIA DE SENTIDO A PROPÓSITO, y el que decía
  // «sobre una orden en ayuda NO se ofrecen Reprogramar ni Rechazar» está reescrito más abajo.
  // No es una aserción que se actualiza para que pase: es el PRODUCTO de la ficha. Hasta hoy la
  // tienda podía avisar y devolver la orden al mensajero, pero no resolverla; ahora tiene sus dos
  // desenlaces. El censo pasa de cinco controles a SIETE.
  it("R22/237: la fila de AYUDA ofrece exactamente siete controles, y son los suyos", () => {
    renderAcciones({ estatusValue: "ayuda_tienda" });

    expect(censoDeBotones()).toEqual([
      "Llamar a Ana Cliente",
      "WhatsApp a Ana Cliente",
      "Reprogramar la orden de Ana Cliente",
      "Rechazar la orden de Ana Cliente",
      "Habilitar la orden de Ana Cliente",
      "Abrir la conversación de la orden de Ana Cliente",
      "Registrar un intento de contacto con la orden de Ana Cliente",
    ]);
  });

  // ⚠️ FEATURE 240 (T5.5, 2026-08-20) — EL CENSO PASA DE CINCO CONTROLES A CUATRO, y es el
  // PRODUCTO de la ficha, no una aserción que se afloja para que pase.
  //
  // **Lo que decía este caso hasta hoy:** «la fila de DEVOLUCIÓN ofrece exactamente cinco
  // controles», con «Habilitar la orden de Ana Cliente» dentro y esta nota al lado: «⚠️ «Habilitar»
  // aparece aquí por TRADUCCIÓN LITERAL del estado de hoy (el punto 12 del pedido humano, al revés
  // de lo que pedía). Su dueño es la ficha 240; esta ficha lo trasladó a una celda de
  // `ACCIONES_POR_GRUPO` sin arreglarlo, y este literal es donde esa deuda se ve».
  //
  // **Qué cambió:** la 240 borró esa celda (R33). El literal se actualiza A MANO, una entrada
  // menos; jamás se deriva de `ACCIONES_POR_GRUPO`, que es su propia fuente y lo dejaría verde para
  // siempre.
  it("240/R33: la fila de DEVOLUCIÓN ofrece exactamente cuatro controles, sin «Habilitar»", () => {
    renderAcciones({ estatusValue: "devuelta" });

    // El espejo del caso de arriba. Es lo que convierte las ausencias de cada uno en afirmaciones:
    // «no hay Reprogramar en ayuda» sólo dice algo si hay un sitio donde SÍ lo hay.
    expect(censoDeBotones()).toEqual([
      "Llamar a Ana Cliente",
      "WhatsApp a Ana Cliente",
      "Reprogramar la orden de Ana Cliente",
      "Rechazar la orden de Ana Cliente",
    ]);
  });

  it("240/R33+R34: «Habilitar» NO está en la devolución, y SÍ en la ayuda", () => {
    // La ausencia, emparejada con su presencia EN EL MISMO CASO. Dicha sola, «no hay Habilitar en
    // la devolución» pasaría igual si el panel no renderizara nada — que es cómo se colaron casos
    // en la 235, la 236 y la 238.
    renderAcciones({ estatusValue: "devuelta" });
    expect(
      screen.queryByRole("button", { name: "Habilitar la orden de Ana Cliente" }),
      "el paquete de una orden en la devolución anclada YA volvió a la bodega y YA se escaneó al " +
        "aprobar el cierre (238): «Habilitar» ahí ofrecía deshacer algo que físicamente no se " +
        "puede deshacer. Es el punto 12, y la 240 lo cerró borrando la celda.",
    ).toBeNull();
    // CONTROL POSITIVO de que la card SÍ se renderizó: los otros cuatro controles están.
    expect(censoDeBotones()).toHaveLength(4);

    cleanup();
    renderAcciones({ estatusValue: "ayuda_tienda" });
    expect(
      screen.getByRole("button", { name: "Habilitar la orden de Ana Cliente" }),
      "R34: sobre una orden en ayuda el paquete SIGUE EN LA MOTO, así que devolverla a la ruta es " +
        "exactamente lo que «Habilitar» significa. Si esto cae, la ficha borró la celda equivocada.",
    ).toBeInTheDocument();
  });

  it("R21: un estatus que no es de ningún grupo se queda SÓLO con el contacto", () => {
    // `grupoDeEstatus` devuelve `null` y no se ofrece ninguna acción que RESUELVA la orden. No
    // puede ocurrir con los predicados del servidor —sólo lista esos dos estados— y por eso mismo
    // hay que escribirlo: el día que un tercer camino traiga una fila por otra vía, la pantalla no
    // se inventará botones para ella.
    renderAcciones({ estatusValue: "en_reparto" });

    expect(censoDeBotones()).toEqual([
      "Llamar a Ana Cliente",
      "WhatsApp a Ana Cliente",
    ]);
  });

  it("los tres censos son DISTINTOS entre sí (anti-vacuidad)", () => {
    // Si `censoDeBotones` estuviera roto —devolviendo siempre lo mismo, o siempre vacío— los tres
    // casos de arriba podrían pasar a la vez sin medir nada. Esto lo caza.
    const censos: string[][] = [];
    for (const estatus of ["ayuda_tienda", "devuelta", "en_reparto"]) {
      cleanup();
      renderAcciones({ estatusValue: estatus });
      censos.push(censoDeBotones());
    }
    expect(new Set(censos.map((c) => c.join("|"))).size).toBe(3);
    expect(censos.every((c) => c.length > 0)).toBe(true);
  });
});

describe("NovedadAcciones — cada control llama a SU handler (236/R27)", () => {
  it("«Conversación» abre el hilo de ESTA orden, y no toca ninguna otra acción", async () => {
    const user = userEvent.setup();
    renderAcciones({ id: "o-ayuda", estatusValue: "ayuda_tienda" });

    await user.click(
      screen.getByRole("button", {
        name: "Abrir la conversación de la orden de Ana Cliente",
      }),
    );

    expect(handlers.onConversacion).toHaveBeenCalledTimes(1);
    expect(handlers.onConversacion.mock.calls[0][0]).toMatchObject({ id: "o-ayuda" });
    expect(handlers.onHabilitar).not.toHaveBeenCalled();
    expect(handlers.onReprogramar).not.toHaveBeenCalled();
    expect(handlers.onRechazar).not.toHaveBeenCalled();
  });

  it("«Habilitar» desde la fila de ayuda llama a su handler con la orden", async () => {
    const user = userEvent.setup();
    renderAcciones({ id: "o-ayuda", estatusValue: "ayuda_tienda" });

    await user.click(
      screen.getByRole("button", { name: "Habilitar la orden de Ana Cliente" }),
    );

    expect(handlers.onHabilitar).toHaveBeenCalledTimes(1);
    expect(handlers.onHabilitar.mock.calls[0][0]).toMatchObject({ id: "o-ayuda" });
    expect(handlers.onConversacion).not.toHaveBeenCalled();
  });

  it("cada botón de icono es SOLO icono, con su nombre accesible en el propio control", () => {
    renderAcciones({ estatusValue: "ayuda_tienda" });

    // El tooltip NO es el nombre del botón: aparece al pasar el puntero o al enfocar, y quien
    // navega con lector de pantalla —o desde una pantalla táctil, donde no hay hover— necesita el
    // nombre EN el control. Si alguien borra el `aria-label` «porque ya está el tooltip», el
    // control se queda mudo y ningún test que busque por ese mismo label lo diría.
    for (const nombre of [
      "Habilitar la orden de Ana Cliente",
      "Abrir la conversación de la orden de Ana Cliente",
    ]) {
      const boton = screen.getByRole("button", { name: nombre });
      expect(boton.textContent).toBe("");
      expect(boton.querySelector("svg")).not.toBeNull();
      // El icono es decorativo: lo anuncia el `aria-label`, no el svg.
      expect(boton.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    }
  });
});

// =================================================================================================
// FEATURE 237 (T7.1 — R1, mitad de pantalla) — LOS DOS DESENLACES DE LA AYUDA VAN A OTRO SITIO.
// =================================================================================================
//
// Lo que estos casos protegen no es que los botones existan (eso ya lo dice el censo de arriba),
// sino que «Reprogramar» **de la ayuda** y «Reprogramar» **de la devolución** —mismo rótulo, mismo
// icono, misma gramática de nombre accesible— llamen a COSAS DISTINTAS. Reutilizar las claves de
// la devolución habría obligado a ramificar por grupo dentro del componente, y una ramificación
// mal hecha aquí manda la orden a `ReprogramacionTiendaService`, que la rechaza con `conflict`, o
// —peor— manda una devolución al camino que cobra un rechazo en el cierre de un mensajero.
describe("NovedadAcciones — 237: la ayuda resuelve por su propia puerta", () => {
  it("«Reprogramar» de la fila de AYUDA abre la ventana en modo reprogramar", async () => {
    const user = userEvent.setup();
    renderAcciones({ id: "o-ayuda", estatusValue: "ayuda_tienda" });

    await user.click(
      screen.getByRole("button", { name: "Reprogramar la orden de Ana Cliente" }),
    );

    expect(handlers.onGestionarDesdeAyuda).toHaveBeenCalledTimes(1);
    expect(handlers.onGestionarDesdeAyuda.mock.calls[0][0]).toMatchObject({
      id: "o-ayuda",
    });
    expect(handlers.onGestionarDesdeAyuda.mock.calls[0][1]).toBe("reprogramar");
    // Y NO el de la devolución, que es el que llama al servicio de la feature 100.
    expect(handlers.onReprogramar).not.toHaveBeenCalled();
  });

  it("«Rechazar» de la fila de AYUDA abre la ventana en modo rechazar", async () => {
    const user = userEvent.setup();
    renderAcciones({ id: "o-ayuda", estatusValue: "ayuda_tienda" });

    await user.click(
      screen.getByRole("button", { name: "Rechazar la orden de Ana Cliente" }),
    );

    expect(handlers.onGestionarDesdeAyuda).toHaveBeenCalledTimes(1);
    expect(handlers.onGestionarDesdeAyuda.mock.calls[0][1]).toBe("rechazar");
    // ⚠️ 2026-08-20: hasta la 240, esta línea decía «`onDevolver` es la MAQUETA de la 240 (avisa
    // por toast y no muta nada)». Ya no: las DOS acciones mueven dinero, y lo que este caso
    // protege es que van por PUERTAS DISTINTAS —el rechazo desde la ayuda crea una gestión que
    // cuenta como del mensajero; el de la devolución cierra una devolución ya anclada—. Cruzarlas
    // cobraría el importe equivocado sobre el cierre equivocado.
    expect(handlers.onRechazar).not.toHaveBeenCalled();
  });

  it("y los dos modos son DISTINTOS entre sí (anti-vacuidad del literal)", async () => {
    // Si `RESULTADO_POR_MODO` o los dos handlers se cablearan al mismo valor, los dos casos de
    // arriba podrían pasar por separado y la tienda estaría rechazando cuando pulsa reprogramar.
    const user = userEvent.setup();
    renderAcciones({ estatusValue: "ayuda_tienda" });

    await user.click(
      screen.getByRole("button", { name: "Reprogramar la orden de Ana Cliente" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Rechazar la orden de Ana Cliente" }),
    );

    const modos = handlers.onGestionarDesdeAyuda.mock.calls.map((c) => c[1]);
    expect(modos).toEqual(["reprogramar", "rechazar"]);
  });

  it("el ESPEJO: «Reprogramar» de la fila de DEVOLUCIÓN sigue yendo a la feature 100", async () => {
    // El par positivo/negativo. Sin él, «no se llamó a `onReprogramar`» del primer caso pasaría
    // igual si alguien borrara la acción de la devolución entera.
    const user = userEvent.setup();
    renderAcciones({ id: "o-devuelta", estatusValue: "devuelta" });

    await user.click(
      screen.getByRole("button", { name: "Reprogramar la orden de Ana Cliente" }),
    );

    expect(handlers.onReprogramar).toHaveBeenCalledTimes(1);
    expect(handlers.onReprogramar.mock.calls[0][0]).toMatchObject({ id: "o-devuelta" });
    expect(handlers.onGestionarDesdeAyuda).not.toHaveBeenCalled();
  });

  // ⚠️ FEATURE 240 (T5.3, 2026-08-20) — ESTE CASO CAMBIA DE SENTIDO A PROPÓSITO, y es el producto
  // de la ficha. Hasta hoy se llamaba «y «Rechazar» de la fila de DEVOLUCIÓN sigue siendo la maqueta
  // de la 240» y lo único que afirmaba era que se llamaba a `onDevolver`, cuyo handler real era un
  // `toast.info`. Se reescribe contra `onRechazar`, que abre la ventana que dispara la operación.
  it("240/R27: «Rechazar» de la fila de DEVOLUCIÓN abre SU ventana, con la orden", async () => {
    const user = userEvent.setup();
    renderAcciones({ id: "o-devuelta", estatusValue: "devuelta" });

    await user.click(
      screen.getByRole("button", { name: "Rechazar la orden de Ana Cliente" }),
    );

    expect(handlers.onRechazar).toHaveBeenCalledTimes(1);
    expect(handlers.onRechazar.mock.calls[0][0]).toMatchObject({ id: "o-devuelta" });
    // Y NO por la puerta de la ayuda, que cobra en el cierre del mensajero y suma un intento.
    expect(handlers.onGestionarDesdeAyuda).not.toHaveBeenCalled();
  });
});
