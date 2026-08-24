// @vitest-environment jsdom
// =================================================================================================
// FEATURE 276 (T12 — R8/R9/R10) — LA VENTANA DE LA TIENDA CUANDO A LA ORDEN LE QUEDA EL ÚLTIMO
// INTENTO.
// =================================================================================================
//
// **Qué protege este archivo, y por qué no basta con el servidor.** `GestionDesdeAyudaService`
// ya rechaza `reprogramada` en el tope y lo hace ANTES de subir una sola evidencia (R1/R5,
// `gestion-desde-ayuda-tope-intentos.test.ts`). Lo que ese rechazo no puede devolver es el tiempo:
// esta ventana pide fecha, motivo y AL MENOS UNA FOTO —D2, la evidencia es obligatoria también al
// reprogramar—, así que sin esta puerta la tienda descubriría el límite después de buscar la
// captura de la conversación con el cliente y adjuntarla. Por eso el modo no se abre.
//
// ⚠️ **CADA AUSENCIA, CON SU PRESENCIA.** «El botón Reprogramar no está» pasa en verde también si
// el modal no renderizó nada. Todos los casos negativos de este archivo comprueban en el MISMO
// caso que la ventana se pintó (su título, su nota o el confirmar del otro modo).
//
// ⚠️ **LOS TEXTOS SE ESCRIBEN A MANO, NUNCA CONTRA LA CONSTANTE IMPORTADA** (misma regla que
// `GestionarDesdeAyudaModal.test.tsx`): compararlos contra `GESTION_AYUDA_TOPE_NOTA` estaría verde
// el día que alguien lo vacíe o le meta el número del umbral dentro.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  GestionarDesdeAyudaModal,
  type ModoGestionDesdeAyuda,
} from "@/app/(app)/novedades/_components/GestionarDesdeAyudaModal";
import { gestionarDesdeAyuda } from "@/lib/actions/gestion-desde-ayuda";
import { permitidoEnElTope } from "@/lib/types/tope-intentos";
import type { GestionResultado } from "@prisma/client";
import type { NovedadDTO } from "@/lib/types/novedad";

vi.mock("@/lib/actions/gestion-desde-ayuda", () => ({
  gestionarDesdeAyuda: vi.fn(),
}));

const gestionarMock = vi.mocked(gestionarDesdeAyuda);

// --- Los literales, escritos a mano. -------------------------------------------------------------

const TITULO = "Resolver la orden por tu cuenta";
const LABEL_FOTOS = "Fotos de evidencia";
const LABEL_MOTIVO = "Motivo";
const LABEL_FECHA = "Nueva fecha";
const BOTON_REPROGRAMAR = "Reprogramar";
const BOTON_RECHAZAR = "Rechazar";
const BOTON_CERRAR = "Entendido";

/** La nota de R9, palabra por palabra. */
const NOTA_TOPE =
  "A esta orden le queda el último intento de entrega, así que ya no se puede reprogramar: volver a mandarla a la calle sería un intento de más. Lo que sí podés registrar desde acá es el rechazo, y el mensajero todavía puede entregarla.";

/**
 * Los dos modos y el `resultado` del contrato que cada uno manda. Escrito a mano; el componente lo
 * deriva de `RESULTADOS_DESDE_AYUDA`, y que las dos formas coincidan ya lo fija el test literal de
 * `GestionarDesdeAyudaModal.test.tsx`.
 */
const MODOS: { modo: ModoGestionDesdeAyuda; resultado: GestionResultado; boton: string }[] = [
  { modo: "reprogramar", resultado: "reprogramada", boton: BOTON_REPROGRAMAR },
  { modo: "rechazar", resultado: "rechazada", boton: BOTON_RECHAZAR },
];

function novedad(over: Partial<NovedadDTO> = {}): NovedadDTO {
  return {
    id: "o1",
    numGuia: 12345,
    numRemision: "REM-001",
    estatusValue: "ayuda_tienda",
    intentosContacto: 1,
    destinatario: "Ana Cliente",
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
    causa: null,
    intentosEntrega: 1,
    ...over,
  };
}

function montar(modo: ModoGestionDesdeAyuda, over: Partial<NovedadDTO> = {}) {
  const onOpenChange = vi.fn();
  render(
    <GestionarDesdeAyudaModal
      orden={novedad(over)}
      modo={modo}
      onOpenChange={onOpenChange}
      onResuelto={vi.fn()}
    />,
  );
  return onOpenChange;
}

beforeEach(() => {
  vi.clearAllMocks();
  gestionarMock.mockResolvedValue({
    status: "ok",
    ordenId: "o1",
    resultado: "rechazada",
  });
});

afterEach(() => {
  cleanup();
});

// =================================================================================================
// R8 — el modo prohibido NO SE ABRE
// =================================================================================================

describe("276/R8 — con la orden en el tope, el modo «reprogramar» no se abre", () => {
  it("no hay confirmar «Reprogramar», y la ventana SÍ se pintó (control positivo)", () => {
    montar("reprogramar", { enElTope: true });
    // La presencia que sostiene la ausencia: el modal está montado y titulado.
    expect(screen.getByText(TITULO)).toBeInTheDocument();
    expect(screen.getByRole("note")).toBeInTheDocument();
    // Y el desenlace prohibido no se ofrece por ningún lado.
    expect(screen.queryByRole("button", { name: BOTON_REPROGRAMAR })).toBeNull();
  });

  it("tampoco monta el formulario: ni fecha, ni motivo, ni selector de fotos", () => {
    montar("reprogramar", { enElTope: true });
    expect(screen.getByRole("note")).toBeInTheDocument(); // el modal está ahí…
    expect(screen.queryByLabelText(LABEL_FECHA)).toBeNull();
    expect(screen.queryByLabelText(LABEL_MOTIVO)).toBeNull();
    expect(screen.queryByLabelText(LABEL_FOTOS)).toBeNull();
  });

  it("no queda NINGÚN control que pueda disparar la gestión: se pulsan todos y la action no se llama", async () => {
    const user = userEvent.setup();
    const onOpenChange = montar("reprogramar", { enElTope: true });
    const botones = screen.getAllByRole("button");
    // Hay algo que pulsar (si no, este caso no probaría nada) y ninguno es el desenlace.
    expect(botones.length).toBeGreaterThan(0);
    for (const boton of botones) {
      expect(boton).not.toHaveTextContent(BOTON_REPROGRAMAR);
      await user.click(boton);
    }
    expect(gestionarMock).not.toHaveBeenCalled();
    // Lo único que hacen es cerrar: la tienda no queda atrapada dentro de la ventana.
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("la salida se llama «Entendido»: es un aviso que se acepta, no una operación que se cancela", () => {
    montar("reprogramar", { enElTope: true });
    expect(screen.getByRole("button", { name: BOTON_CERRAR })).toBeInTheDocument();
  });
});

describe("276/R8 — «Rechazar» SIGUE ABRIÉNDOSE en el tope: es el desenlace que la orden necesita", () => {
  it("con `enElTope: true` el modo rechazar monta su formulario entero y su confirmar", () => {
    montar("rechazar", { enElTope: true });
    expect(screen.getByRole("button", { name: BOTON_RECHAZAR })).toBeInTheDocument();
    expect(screen.getByLabelText(LABEL_MOTIVO)).toBeInTheDocument();
    expect(screen.getByLabelText(LABEL_FOTOS)).toBeInTheDocument();
    // Y el aviso del tope NO se pinta donde no bloquea nada.
    expect(screen.queryByText(NOTA_TOPE)).toBeNull();
  });
});

describe("276/R8 — la decisión sale de la lista compartida, no de una copia", () => {
  it.each(MODOS)(
    "el modo $modo se abre en el tope si y sólo si su resultado está en la lista de inclusión",
    ({ modo, resultado, boton }) => {
      montar(modo, { enElTope: true });
      const confirmar = screen.queryByRole("button", { name: boton });
      // La expectativa NO está escrita a mano: se deriva del MISMO símbolo que usa la guarda del
      // servidor. Si alguien ensanchara la lista, este caso exigiría que la ventana se abriera.
      if (permitidoEnElTope(resultado)) {
        expect(confirmar).not.toBeNull();
      } else {
        expect(confirmar).toBeNull();
        expect(screen.getByRole("note")).toBeInTheDocument();
      }
    },
  );
});

// =================================================================================================
// NO-REGRESIÓN — fuera del tope, la ventana es la de siempre
// =================================================================================================

describe("276 — fuera del tope no cambia nada", () => {
  it("con `enElTope: false`, «Reprogramar» abre su formulario con fecha, motivo y fotos", () => {
    montar("reprogramar", { enElTope: false });
    expect(screen.getByRole("button", { name: BOTON_REPROGRAMAR })).toBeInTheDocument();
    expect(screen.getByLabelText(LABEL_FECHA)).toBeInTheDocument();
    expect(screen.getByLabelText(LABEL_MOTIVO)).toBeInTheDocument();
    expect(screen.getByLabelText(LABEL_FOTOS)).toBeInTheDocument();
    expect(screen.queryByText(NOTA_TOPE)).toBeNull();
  });

  it("con el campo AUSENTE (fixture viejo) tampoco: el DTO lo declara opcional", () => {
    // Ausente NO puede leerse como «en el tope»: dejaría a la tienda sin reprogramar el día que
    // un fixture se olvide del campo.
    montar("reprogramar", {});
    expect(screen.getByRole("button", { name: BOTON_REPROGRAMAR })).toBeInTheDocument();
    expect(screen.getByLabelText(LABEL_FECHA)).toBeInTheDocument();
  });
});

// =================================================================================================
// R9 / R10 — se dice por qué, y sin el número
// =================================================================================================

describe("276/R9 — la ventana explica el porqué con palabras", () => {
  it("la nota se lee TAL CUAL", () => {
    montar("reprogramar", { enElTope: true });
    expect(screen.getByRole("note")).toHaveTextContent(NOTA_TOPE);
  });

  it("dice qué ya no se puede Y qué sí queda: no es un «no disponible» seco", () => {
    montar("reprogramar", { enElTope: true });
    const nota = screen.getByRole("note");
    expect(nota).toHaveTextContent("ya no se puede reprogramar");
    expect(nota).toHaveTextContent("podés registrar desde acá es el rechazo");
  });

  it("R10: la nota no contiene NINGUNA cifra", () => {
    montar("reprogramar", { enElTope: true });
    expect(screen.getByRole("note").textContent ?? "").not.toMatch(/\d/);
  });
});
