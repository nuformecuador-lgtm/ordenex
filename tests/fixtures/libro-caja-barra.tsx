import { useState } from "react";

import { LibroCajaBarra } from "@/app/(app)/wallet/_components/LibroCajaBarra";
import { aQuienDeValor } from "@/app/(app)/wallet/_components/a-quien-selector";
import { deSeleccion } from "@/app/(app)/wallet/_components/libro-caja-filtros";
import {
  FILTROS_LIBRO_INICIALES,
  FILTROS_WALLET_VACIOS,
  type FiltrosLibro,
  type FiltrosWallet,
} from "@/app/(app)/wallet/_components/wallet-filtros-input";

// FICHA 467 — la barra única del libro de la caja montada como la monta `WalletModule`, pero SIN
// servidor: CONTROLADA, con casillas, wallet y libro en estado, y cada cambio aplicado en el acto (lo
// pedido ES lo aplicado). Los tests de las opciones de Concepto, de los textos y de la guardia de uuid
// la montan para mirar la barra sola; `onCambiar` avisa del libro y `onWallet` de la wallet.

export function LibroCajaBarraControlada({
  filtrosWallet: walletInicial = FILTROS_WALLET_VACIOS,
  activosIniciales = [],
  onCambiar,
  onWallet,
}: {
  filtrosWallet?: FiltrosWallet;
  /** Las casillas con las que nace la barra (por defecto, ninguna: R11). */
  activosIniciales?: string[];
  onCambiar?: (siguiente: FiltrosLibro) => void;
  onWallet?: (siguiente: FiltrosWallet) => void;
}) {
  const [libro, setLibro] = useState<FiltrosLibro>(FILTROS_LIBRO_INICIALES);
  const [walletPropia, setWalletPropia] = useState<FiltrosWallet | null>(null);
  const [activos, setActivos] = useState<string[]>(activosIniciales);
  // Mientras nadie toque la wallet desde la barra, manda la de la prop (los tests la cambian con rerender).
  const wallet = walletPropia ?? walletInicial;

  function cambiarLibro(siguiente: FiltrosLibro) {
    setLibro(siguiente);
    onCambiar?.(siguiente);
  }
  function cambiarWallet(siguiente: FiltrosWallet) {
    setWalletPropia(siguiente);
    onWallet?.(siguiente);
  }

  return (
    <LibroCajaBarra
      filtrosWallet={wallet}
      libroAplicado={libro}
      pedido={{ wallet, libro }}
      activos={activos}
      onActivos={setActivos}
      onPeriodo={(sel) => {
        const { desde, hasta } = deSeleccion(sel);
        cambiarWallet({ ...wallet, desde, hasta });
      }}
      onLibro={(sel) => {
        const { tipo, categoria } = deSeleccion(sel);
        cambiarLibro({ ...libro, tipo, categoria });
      }}
      onAQuien={(valor) => {
        const aQuien = aQuienDeValor(valor);
        cambiarWallet({ desde: wallet.desde, hasta: wallet.hasta, ...(aQuien ? { aQuien } : {}) });
      }}
      onOrden={(sortDir) => cambiarLibro({ ...libro, sortDir })}
      onTermino={(termino) => cambiarLibro({ ...libro, termino })}
      onLimpiar={() => {
        setActivos([]);
        cambiarLibro({ ...libro, tipo: "", categoria: "", termino: "" });
      }}
      senalSiembra={0}
    />
  );
}
