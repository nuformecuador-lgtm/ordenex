// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import { SaldoTiendaCard } from "@/app/(app)/mi-wallet/_components/SaldoTiendaCard";
import { DESGLOSE_MI_WALLET_LABEL } from "@/app/(app)/mi-wallet/_components/mi-wallet-labels";
import type { DesgloseTiendaDTO, SaldoTiendaDTO } from "@/lib/types/wallet-tienda";
import {
  LLAMADAS_PROHIBIDAS_EN_DINERO,
  codigoSinComentarios,
} from "@/tests/fixtures/money-safe";

// ⭑ FICHA 381 (T I.4, R29/R30) — EL SALDO NEGATIVO EN LA WALLET DE LA TIENDA.
//
// **Por qué se escribe un test para algo que ya funciona.** Hasta esta ficha, el saldo de una
// tienda solo podía quedar negativo por fletes de devolución: un caso raro que nadie miraba.
// Desde la 381 lo produce una DECISIÓN HUMANA —«se le cobra a la tienda y, si no hay dinero
// pendiente, el disponible debe verse en negativo»— y se va a ver a menudo. Un comportamiento
// sin test es un comportamiento que la próxima ficha puede romper en silencio, y la forma
// «amable» de romperlo (recortar a cero, quitar el signo, pintar el valor absoluto, tratarlo
// como un error) es exactamente la que le mentiría a la tienda sobre dinero que se le cobró.
//
// EL NEGATIVO NO ES UN ERROR: es el estado correcto de una tienda a la que se le cobró más de
// lo que se le debía, y se cobra cuando la gestión le vuelva a generar dinero a favor (D3).

const FUENTE = "app/(app)/mi-wallet/_components/SaldoTiendaCard.tsx";

function saldo(over: Partial<SaldoTiendaDTO> = {}): SaldoTiendaDTO {
  return {
    creditos: "0.00",
    debitos: "15000.00",
    saldo: "-15000.00",
    signo: "negativo",
    ...over,
  };
}

function desglose(over: Partial<DesgloseTiendaDTO> = {}): DesgloseTiendaDTO {
  return {
    aFavor: "0.00",
    cargos: "15000.00",
    pagado: "0.00",
    saldo: "-15000.00",
    signo: "negativo",
    ...over,
  };
}

afterEach(() => {
  cleanup();
});

describe("SaldoTiendaCard — el saldo NEGATIVO se ve entero (381/R29)", () => {
  it("pinta el importe con su signo y sin recortarlo a cero", () => {
    render(<SaldoTiendaCard saldo={saldo()} desglose={desglose()} />);

    const seccion = screen.getByRole("region", { name: "Saldo a favor" });
    // El STRING viene del servidor con el signo delante (`-15000.00`) y se pinta tal cual.
    // `getByText` compara el texto COMPLETO del nodo: `₡15.000` no casaría con `-₡15.000`, así
    // que un valor absoluto pondría este caso rojo.
    expect(within(seccion).getByText("-₡15.000")).toBeInTheDocument();
    // Y las dos formas concretas de esconderlo: recortado a cero, o sin el signo.
    expect(within(seccion).queryByText("₡15.000")).not.toBeInTheDocument();
    expect(within(seccion).queryByText("₡0")).not.toBeInTheDocument();
  });

  it("conserva los CÉNTIMOS del negativo, que en un libro de dinero no son decoración", () => {
    render(
      <SaldoTiendaCard
        saldo={saldo({ saldo: "-15000.07", debitos: "15000.07" })}
        desglose={desglose({ saldo: "-15000.07", cargos: "15000.07" })}
      />,
    );
    const seccion = screen.getByRole("region", { name: "Saldo a favor" });
    expect(within(seccion).getByText("-₡15.000,07")).toBeInTheDocument();
  });

  it("el negativo NO se presenta como un fallo: ni alerta, ni «saldo insuficiente»", () => {
    const { container } = render(<SaldoTiendaCard saldo={saldo()} desglose={desglose()} />);

    // R27: un cobro no se compara contra ningún disponible, así que la pantalla no puede
    // anunciar un problema que el dominio no tiene.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(
      /insuficiente|no alcanza|sin saldo|error|deuda impaga/i,
    );
  });
});

describe("SaldoTiendaCard — la marca legible distingue los TRES signos (381/R30)", () => {
  it.each([
    ["negativo", "-15000.00", "En contra", "-₡15.000"],
    ["positivo", "9000.00", "A favor", "₡9.000"],
    ["cero", "0.00", "En cero", "₡0"],
  ])(
    "signo `%s` → insignia «%s» junto al importe %s",
    (signo, importe, insignia, pintado) => {
      const dto = saldo({
        saldo: importe,
        signo: signo as SaldoTiendaDTO["signo"],
      });
      render(<SaldoTiendaCard saldo={dto} desglose={desglose({ saldo: importe })} />);

      const seccion = screen.getByRole("region", { name: "Saldo a favor" });
      // La marca es LEGIBLE, no sólo el signo del número: quien no distinga un `-` a simple
      // vista tiene una palabra que se lo dice.
      expect(within(seccion).getByText(insignia)).toBeInTheDocument();
      expect(within(seccion).getByText(pintado)).toBeInTheDocument();
    },
  );

  it("las tres insignias son distintas entre sí", () => {
    // Sin esto, un mapa que devolviera siempre la misma palabra pasaría el caso de arriba.
    const vistas = new Set<string>();
    for (const [signo, importe] of [
      ["negativo", "-15000.00"],
      ["positivo", "9000.00"],
      ["cero", "0.00"],
    ] as const) {
      cleanup();
      render(
        <SaldoTiendaCard
          saldo={saldo({ saldo: importe, signo })}
          desglose={desglose({ saldo: importe })}
        />,
      );
      const seccion = screen.getByRole("region", { name: "Saldo a favor" });
      for (const texto of ["A favor", "En contra", "En cero"]) {
        if (within(seccion).queryByText(texto)) vistas.add(`${signo}:${texto}`);
      }
    }
    expect([...vistas].sort()).toEqual([
      "cero:En cero",
      "negativo:En contra",
      "positivo:A favor",
    ]);
  });
});

describe("SaldoTiendaCard — la aclaración de cargos nombra los cobros (381/R37 en pantalla)", () => {
  it("la tienda lee, bajo el importe de cargos, que ahí dentro puede haber un cobro", () => {
    render(<SaldoTiendaCard saldo={saldo()} desglose={desglose()} />);

    expect(screen.getByText(DESGLOSE_MI_WALLET_LABEL.cargos)).toBeInTheDocument();
    // El literal, no la constante: lo que se mide es lo que la tienda LEE.
    expect(screen.getByText("Fletes, comisión, IVA y cobros de Ordenex")).toBeInTheDocument();
  });
});

describe("SaldoTiendaCard — money-safe (381/R18)", () => {
  it("el componente no convierte ningún monto a número ni lo recorta con `Math`", () => {
    const fuente = codigoSinComentarios(FUENTE);
    expect(fuente.length, "el barrido leyó un archivo vacío").toBeGreaterThan(200);

    for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
      expect(prohibida.test(fuente), `usa ${prohibida}`).toBe(false);
    }
    // Y las tres formas de «arreglar» un negativo que esta ficha prohíbe explícitamente:
    // `Math.abs` le quita el signo y `Math.max` lo recorta a cero.
    expect(/Math\.(abs|max|min)\s*\(/.test(fuente), "recorta el saldo con Math").toBe(false);
  });
});
