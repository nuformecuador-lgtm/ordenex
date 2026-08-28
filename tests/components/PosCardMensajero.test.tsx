// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { PosOrderCard } from "@/app/(app)/mis-asignaciones/_components/pos-card/PosOrderCard";
import { PosOrderCardMosaico } from "@/app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardMosaico";
import { PosOrderCardDetalle } from "@/app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardDetalle";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// FICHA 296 — EL MENSAJERO EN LA CARD COMPARTIDA, y sobre todo: SU AUSENCIA DONDE NO SE PIDIÓ.
//
// La card POS la montan DOS mundos: el portal del mensajero («En reparto», «Por recoger»,
// recolección) y la pantalla de la TIENDA (`/novedades`). Sólo la segunda necesita saber quién
// lleva la orden — en el portal el mensajero es quien mira y decirle su propio nombre no informa
// de nada. Por eso el dato NO entra en `MiAsignacionDTO` (el contrato de ese portal) y llega como
// PROP opcional, igual que `estado`, `acciones` o `mostrarRuta`.
//
// LO QUE ESTE ARCHIVO PROTEGE, en las tres direcciones:
//   1. con nombre  -> se lee el nombre;
//   2. con `null`  -> se lee la ausencia EN PALABRAS, nunca un «null» ni un hueco;
//   3. SIN LA PROP -> no se pinta nada. Éste es el caso que dice que el portal del mensajero no
//      cambia: sus pantallas no pasan la prop, así que su card es exactamente la de ayer.
//
// POR QUÉ LAS TRES VISTAS y no sólo las dos que `/novedades` monta hoy: `PosOrderCard`,
// `PosOrderCardMosaico` y `PosOrderCardDetalle` son PARALELAS, no variantes — comparten interfaz
// de props y son intercambiables por diseño. Es el mismo criterio con el que la 246 comprobó
// «Para mañana» en las tres (`PosCardParaManana.test.tsx`) y la 227 la ausencia de la nota
// privada (`PosOrderCardSinNotaPrivada.test.tsx`).
//
// Los textos se afirman con su literal ESCRITO A MANO, nunca contra `textoMensajero`, que es la
// función que los produce: comparar un texto con su propia fuente está siempre verde.
//
// Las cards refrescan desde el router al gestionar; se mockea para montarlas en jsdom.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

function makeOrden(over: Partial<MiAsignacionDTO> = {}): MiAsignacionDTO {
  return {
    id: "o1",
    numGuia: 1001,
    numRemision: "REM-1",
    estatusValue: "en_reparto",
    destinatario: "Ana",
    telefonoDest: "70001111",
    direccion: "200m sur de la iglesia",
    producto: "Caja",
    peso: 1.2,
    montoCobrar: 25000,
    latitud: 9.93,
    longitud: -84.08,
    notas: null,
    tiendaNombre: "Tienda Norte",
    zonaNombre: "GAM",
    provinciaNombre: "San José",
    cantonNombre: "Escazú",
    distritoNombre: "San Rafael",
    secuenciaRuta: 1,
    marcarLuego: false,
    intentosEntrega: 0,
    ...over,
  };
}

const CARDS = [
  ["completa", PosOrderCard],
  ["mosaico", PosOrderCardMosaico],
  ["detalle en fila", PosOrderCardDetalle],
] as const;

afterEach(() => {
  cleanup();
});

describe("pos-card — el mensajero de la orden (ficha 296)", () => {
  for (const [nombre, Card] of CARDS) {
    it(`la card ${nombre} DICE quién lleva la orden cuando la superficie lo pasa`, () => {
      render(<Card orden={makeOrden()} total={1} mensajero="Marta Mensajera" />);

      // Etiqueta y valor en UN solo nodo de texto: se lee como una idea y no queda partido
      // para un lector de pantalla (mismo criterio que el dato de intentos).
      expect(screen.getByText("Mensajero: Marta Mensajera")).toBeInTheDocument();
    });

    it(`la card ${nombre} dice la AUSENCIA en palabras cuando no hay mensajero asignado`, () => {
      render(<Card orden={makeOrden()} total={1} mensajero={null} />);

      expect(screen.getByText("Mensajero: sin asignar")).toBeInTheDocument();
      // Ni el valor crudo del contrato, ni la etiqueta sola colgando sin valor.
      expect(screen.queryByText(/null/i)).toBeNull();
      expect(screen.queryByText("Mensajero:")).toBeNull();
    });

    it(`la card ${nombre} NO pinta nada cuando la superficie no pasa la prop (el portal del mensajero)`, () => {
      render(<Card orden={makeOrden()} total={1} />);

      // La ausencia va EMPAREJADA con una presencia de la MISMA card: sin este control, las
      // dos negativas de abajo estarían verdes también si la card no se hubiera renderizado.
      expect(screen.getByText("REM-1")).toBeInTheDocument();
      expect(screen.queryByText(/^Mensajero/)).toBeNull();
      // `undefined` no es `null`: la ausencia de la prop NO cae al texto de "sin asignar".
      // Los dos estados significan cosas distintas (esta pantalla no tiene el concepto vs.
      // esta orden no tiene mensajero) y confundirlos pondría un dato inventado en el portal.
      expect(screen.queryByText("Mensajero: sin asignar")).toBeNull();
    });

    it(`la card ${nombre} no ofrece NINGUNA vía de contacto con el mensajero (sólo el nombre)`, () => {
      render(<Card orden={makeOrden()} total={1} mensajero="Marta Mensajera" />);

      // El teléfono del mensajero es PII de un tercero y la vía para hablar con él es el hilo
      // de notas de la orden. Nada que le apunte puede ser un enlace ni un botón.
      const dato = screen.getByText("Mensajero: Marta Mensajera");
      expect(dato.closest("a")).toBeNull();
      expect(dato.closest("button")).toBeNull();
      expect(screen.queryByRole("link", { name: /Marta Mensajera/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Marta Mensajera/ })).toBeNull();
    });
  }
});
