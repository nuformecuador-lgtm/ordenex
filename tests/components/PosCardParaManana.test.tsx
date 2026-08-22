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
// ⏳ FEATURE 261 (2026-08-21) — LA REGLA CAMBIÓ. La decisión D5 de la 246 quedó REVERTIDA: la
// reserva ya no es sólo una etiqueta que protege del corte nocturno, también bloquea al mensajero.
// El badge sigue exactamente igual (R9: la orden no se esconde ni sale de su grupo), y debajo de él
// aparece el aviso que explica desde qué día se podrá trabajar — su bloque está al pie de este
// archivo. Ver `specs/261-dia-reparto-protege`.
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

    it(`R23: la card ${nombre} reservada conserva TODO lo demás — ni se oculta ni se recorta`, () => {
      render(<Card orden={makeOrden({ esParaManana: true })} total={1} />);

      // 261/R9: lo que se restringe es la ACCIÓN, no la visibilidad. La card conserva su
      // identificación, su destinatario y su ubicación, y sigue montada entera — igual que con el
      // mensajero bloqueado por un cierre pendiente, que es el patrón que el usuario ya conoce.
      // (`getAllByText`: las tres vistas repiten alguno de estos datos entre la cabecera y el
      // detalle desplegable, y lo que este caso afirma es que NO desaparecen.)
      expect(screen.getByText("REM-1")).toBeInTheDocument();
      expect(screen.getAllByText("Ana").length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Escazú/).length).toBeGreaterThan(0);
    });
  }
});

// =================================================================================================
// FEATURE 261 (F2/F5, R11) — EL AVISO EN PALABRAS, DEBAJO DEL BADGE.
// =================================================================================================
//
// El badge dice QUÉ es la orden; no dice por qué el botón de gestionar está gris ni desde cuándo
// dejará de estarlo. Desde la 261 la reserva BLOQUEA —recoger, escoger y gestionar—, así que la
// card tiene que explicarlo con palabras y nombrando el día: el mensajero está en la calle con el
// paquete en la mano y enterarse al intentarlo le cuesta un viaje.
//
// LOS LITERALES VAN ESCRITOS A MANO, nunca contra `avisoReservaParaOtroDia`: comparar un texto con
// la función que lo genera está siempre verde. Que la card lo IMPORTE en vez de copiarlo lo prueba
// el test de fuente única (`tests/unit/utils/dia-reparto-textos.test.ts`, R15).
describe("pos-card — el aviso de la reserva, con su día (feature 261/R11)", () => {
  const AVISO_22 =
    "Esta orden es para el reparto del 22 de agosto. Ese día podrás recogerla y gestionarla.";
  const AVISO_SIN_FECHA =
    "Esta orden es para un día de reparto posterior. Podrás recogerla y gestionarla ese día.";

  for (const [nombre, Card] of CARDS) {
    it(`R11: la card ${nombre} dice desde QUÉ DÍA se podrá, con la fecha en palabras`, () => {
      render(
        <Card
          orden={makeOrden({ esParaManana: true, fechaRepartoISO: "2026-08-22" })}
          total={1}
        />,
      );

      // La fecha la resolvió el SERVIDOR y viaja en el DTO (R14): la card no construye ningún
      // `Date` ni compara nada con el reloj del navegador.
      expect(screen.getByText(AVISO_22)).toBeInTheDocument();
      // Y el badge SIGUE (246/R22): son dos cosas distintas, no una sustituye a la otra.
      expect(screen.getByText("Para mañana")).toBeInTheDocument();
    });

    it(`R11: la card ${nombre} de HOY no dice nada de esto`, () => {
      render(
        <Card
          orden={makeOrden({ esParaManana: false, fechaRepartoISO: "2026-08-21" })}
          total={1}
        />,
      );

      // Ausencia EMPAREJADA con una presencia de la misma card: sin esto, el `toBeNull` estaría
      // verde también si la card no se hubiera renderizado.
      expect(screen.getByText("REM-1")).toBeInTheDocument();
      expect(screen.queryByText(AVISO_22)).toBeNull();
      expect(screen.queryByText(AVISO_SIN_FECHA)).toBeNull();
    });

    it(`R11: la card ${nombre} sin fecha en el DTO sigue diciendo algo CIERTO`, () => {
      // Una orden reservada cuya fecha no llegó (DTO viejo, o `null`): la frase pierde precisión
      // pero no deja de ser verdad. Lo que no puede pasar es que la card se quede muda con el
      // botón apagado, que es el misterio que este aviso existe para evitar.
      render(
        <Card orden={makeOrden({ esParaManana: true, fechaRepartoISO: null })} total={1} />,
      );

      expect(screen.getByText(AVISO_SIN_FECHA)).toBeInTheDocument();
    });

    it(`R9: la card ${nombre} con el aviso sigue montada ENTERA`, () => {
      render(
        <Card
          orden={makeOrden({ esParaManana: true, fechaRepartoISO: "2026-08-22" })}
          total={1}
        />,
      );

      // El aviso NO recorta la card: se restringe la acción, no la visibilidad. Si un día alguien
      // decidiera «simplificar» la card reservada, este caso se pone rojo.
      expect(screen.getByText(AVISO_22)).toBeInTheDocument();
      expect(screen.getByText("REM-1")).toBeInTheDocument();
      expect(screen.getAllByText("Ana").length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Escazú/).length).toBeGreaterThan(0);
    });

    it(`R7: la card ${nombre} deja de decirlo al llegar el día, sin que nadie escriba nada`, () => {
      // La MISMA fila: lo único que cambia es el booleano que el servidor deriva del paso del
      // tiempo. No hay marca que apagar ni aviso que retirar a mano.
      const { rerender } = render(
        <Card
          orden={makeOrden({ esParaManana: true, fechaRepartoISO: "2026-08-22" })}
          total={1}
        />,
      );
      expect(screen.getByText(AVISO_22)).toBeInTheDocument();

      rerender(
        <Card
          orden={makeOrden({ esParaManana: false, fechaRepartoISO: "2026-08-22" })}
          total={1}
        />,
      );

      expect(screen.queryByText(AVISO_22)).toBeNull();
      expect(screen.getByText("REM-1")).toBeInTheDocument();
    });
  }
});
