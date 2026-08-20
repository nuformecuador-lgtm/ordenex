// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { PosOrderCard } from "@/app/(app)/mis-asignaciones/_components/pos-card/PosOrderCard";
import { PosOrderCardMosaico } from "@/app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardMosaico";
import { PosOrderCardDetalle } from "@/app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardDetalle";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";

// Feature 246 (T5.2, R22) — «Para mañana» EN LAS TRES CARDS DEL PORTAL.
//
// POR QUÉ LAS TRES, y no sólo las dos que el portal monta hoy. `PosOrderCard`,
// `PosOrderCardMosaico` y `PosOrderCardDetalle` son PARALELAS, no variantes: comparten
// interfaz de props y son intercambiables por diseño. Una card que no dijera «Para mañana»
// dejaría de distinguir la orden reservada en cuanto alguien la montara, y ese día nadie
// buscaría la causa aquí. Es el mismo criterio con el que la 227 comprobó en las tres a la vez
// que la nota privada había desaparecido (`PosOrderCardSinNotaPrivada.test.tsx`).
//
// El texto se afirma con su literal ESCRITO A MANO, nunca contra la constante que lo produce:
// comparar un texto con su propia fuente está siempre verde.
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

describe("pos-card — «Para mañana» en las tres vistas (feature 246/R22)", () => {
  for (const [nombre, Card] of CARDS) {
    it(`R22: la card ${nombre} DICE «Para mañana» cuando la orden está reservada`, () => {
      render(<Card orden={makeOrden({ esParaManana: true })} total={1} />);

      // `esParaManana` lo derivó el SERVIDOR (R26). La card no compara fechas ni lee reloj:
      // pinta lo que recibe.
      expect(screen.getByText("Para mañana")).toBeInTheDocument();
    });

    it(`R22: la card ${nombre} NO lo dice cuando la orden es de hoy`, () => {
      render(<Card orden={makeOrden({ esParaManana: false })} total={1} />);

      // La ausencia va EMPAREJADA con una presencia de la misma card: sin esto, el `toBeNull`
      // estaría verde también si la card no se hubiera renderizado.
      expect(screen.getByText("REM-1")).toBeInTheDocument();
      expect(screen.queryByText("Para mañana")).toBeNull();
    });

    it(`R25: la card ${nombre} deja de decirlo SIN QUE NADIE ESCRIBA NADA al llegar el día`, () => {
      // La MISMA fila, con el mismo id y el mismo estado: lo único que cambia es el booleano
      // que el servidor deriva del paso del tiempo. No hay marca que apagar (decisión D2).
      const { rerender } = render(
        <Card orden={makeOrden({ esParaManana: true })} total={1} />,
      );
      expect(screen.getByText("Para mañana")).toBeInTheDocument();

      rerender(<Card orden={makeOrden({ esParaManana: false })} total={1} />);

      expect(screen.queryByText("Para mañana")).toBeNull();
      expect(screen.getByText("REM-1")).toBeInTheDocument();
    });

    it(`R23/R24: la card ${nombre} reservada conserva TODO lo demás — ni se oculta ni se recorta`, () => {
      render(<Card orden={makeOrden({ esParaManana: true })} total={1} />);

      // La reserva protege del corte de la noche, NO del mensajero (decisión D5): la card
      // conserva su identificación, su destinatario y su ubicación, así que la orden se puede
      // trabajar igual. (`getAllByText`: las tres vistas repiten alguno de estos datos entre la
      // cabecera y el detalle desplegable, y lo que este caso afirma es que NO desaparecen.)
      expect(screen.getByText("REM-1")).toBeInTheDocument();
      expect(screen.getAllByText("Ana").length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Escazú/).length).toBeGreaterThan(0);
    });
  }
});
