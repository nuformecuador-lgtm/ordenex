// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import { TarjetasEstadoCuenta } from "@/components/shared/estado-cuenta/TarjetasEstadoCuenta";
import type { EstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import { estado } from "@/tests/fixtures/estado-cuenta";
import { LLAMADAS_PROHIBIDAS_EN_DINERO, codigoSinComentarios } from "@/tests/fixtures/money-safe";

// ⭑ FICHA 381 (T I.4, R29/R30) — EL SALDO NEGATIVO EN LA WALLET DE LA TIENDA.
//
// Desde la 381 el negativo lo produce una DECISIÓN HUMANA —«se le cobra a la tienda y, si no hay
// dinero pendiente, el disponible debe verse en negativo»— y se va a ver a menudo. La forma «amable»
// de romperlo (recortar a cero, quitar el signo, pintar el valor absoluto, tratarlo como un error) es
// la que le mentiría a la tienda sobre dinero que se le cobró. EL NEGATIVO NO ES UN ERROR.
//
// FICHA 458-D (T D.5, R34): la tarjeta del saldo de `/mi-wallet` es ahora la del ESTADO DE CUENTA
// (`TarjetasEstadoCuenta`, vista «tienda»). Los mismos casos sobre ella: el negativo entero y con sus
// céntimos, sin alerta; los TRES signos se distinguen con PALABRAS (la frase de quién le debe a quién,
// R18, en lugar de la insignia «A favor / En contra / En cero» de la tarjeta retirada); money-safe.
// La pista «Cargos de Ordenex» (381/R37) se fue con la tarjeta: el cobro se nombra en SU fila
// («Ordenex te cobró», `desglose-tienda-ledger.test.tsx`) y se filtra con el chip «Cobros».

const FUENTE = "components/shared/estado-cuenta/TarjetasEstadoCuenta.tsx";

function negativo(over: Partial<EstadoCuentaDTO> = {}): EstadoCuentaDTO {
  return estado({
    saldoActual: "-15000.00",
    signo: "negativo",
    sentido: "cuenta_debe",
    abonos: "0.00",
    cargos: "15000.00",
    saldoFinal: "-15000.00",
    ...over,
  });
}

function tarjetas() {
  return screen.getByRole("region", { name: "Saldo de Tania Tienda" });
}

/** La cifra grande del saldo actual (la primera tarjeta). */
function saldoActual(): HTMLElement {
  const rotulo = within(tarjetas()).getByText("Saldo actual");
  const bloque = rotulo.parentElement;
  if (!bloque) throw new Error("sin tarjeta del saldo actual");
  return bloque;
}

afterEach(() => {
  cleanup();
});

describe("/mi-wallet — el saldo NEGATIVO se ve entero (381/R29 → 458-D)", () => {
  it("pinta el importe con su signo y sin recortarlo a cero", () => {
    render(<TarjetasEstadoCuenta estado={negativo()} vista="tienda" />);
    // `getByText` compara el texto COMPLETO del nodo: `₡15.000` no casaría con `-₡15.000`.
    expect(within(saldoActual()).getByText("-₡15.000")).toBeInTheDocument();
    expect(within(saldoActual()).queryByText("₡0")).not.toBeInTheDocument();
  });

  it("conserva los CÉNTIMOS del negativo, que en un libro de dinero no son decoración", () => {
    render(<TarjetasEstadoCuenta estado={negativo({ saldoActual: "-15000.07", saldoFinal: "-15000.07" })} vista="tienda" />);
    expect(within(saldoActual()).getByText("-₡15.000,07")).toBeInTheDocument();
    expect(within(saldoActual()).getByText("Le debés ₡15.000,07 a Ordenex")).toBeInTheDocument();
  });

  it("el negativo NO se presenta como un fallo: ni alerta, ni «saldo insuficiente»", () => {
    const { container } = render(<TarjetasEstadoCuenta estado={negativo()} vista="tienda" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(container.textContent ?? "").not.toMatch(/insuficiente|no alcanza|sin saldo|error|deuda impaga/i);
  });
});

describe("/mi-wallet — los TRES signos se distinguen con palabras (381/R30 → 458 R18)", () => {
  it.each([
    ["negativo", "cuenta_debe", "-15000.00", "Le debés ₡15.000 a Ordenex", "-₡15.000"],
    ["positivo", "ordenex_debe", "9000.00", "Ordenex te debe ₡9.000", "₡9.000"],
    ["cero", "en_cero", "0.00", "Ordenex y vos no se deben nada", "₡0"],
  ] as const)("signo `%s` → «%s»", (signo, sentido, importe, frase, pintado) => {
    render(<TarjetasEstadoCuenta estado={estado({ saldoActual: importe, signo, sentido })} vista="tienda" />);
    expect(within(saldoActual()).getByText(frase)).toBeInTheDocument();
    expect(within(saldoActual()).getByText(pintado)).toBeInTheDocument();
  });

  it("las tres frases son distintas entre sí, y ninguna habla de la tienda en tercera persona", () => {
    const vistas = new Set<string>();
    for (const [signo, sentido, importe] of [
      ["negativo", "cuenta_debe", "-15000.00"],
      ["positivo", "ordenex_debe", "9000.00"],
      ["cero", "en_cero", "0.00"],
    ] as const) {
      cleanup();
      render(<TarjetasEstadoCuenta estado={estado({ saldoActual: importe, signo, sentido })} vista="tienda" />);
      const texto = saldoActual().querySelector("p")?.textContent ?? "";
      expect(texto).not.toContain("Tania Tienda");
      vistas.add(texto);
    }
    expect(vistas.size).toBe(3);
  });
});

describe("TarjetasEstadoCuenta — money-safe (381/R18)", () => {
  it("el componente no convierte ningún monto a número ni lo recorta con `Math`", () => {
    const fuente = codigoSinComentarios(FUENTE);
    expect(fuente.length, "el barrido leyó un archivo vacío").toBeGreaterThan(200);
    for (const prohibida of LLAMADAS_PROHIBIDAS_EN_DINERO) {
      expect(prohibida.test(fuente), `usa ${prohibida}`).toBe(false);
    }
    expect(/Math\.(abs|max|min)\s*\(/.test(fuente), "recorta el saldo con Math").toBe(false);
  });
});
