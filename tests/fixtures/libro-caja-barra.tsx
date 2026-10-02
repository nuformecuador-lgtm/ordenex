import { useState } from "react";

import { LibroCajaBarra } from "@/app/(app)/wallet/_components/LibroCajaBarra";
import {
  FILTROS_LIBRO_INICIALES,
  FILTROS_WALLET_VACIOS,
  type FiltrosLibro,
  type FiltrosWallet,
} from "@/app/(app)/wallet/_components/WalletFiltros";

// FICHA 463 — la zona del libro de la caja montada como la monta `WalletModule`: CONTROLADA, con lo
// aplicado en estado. Los tests que antes montaban la barra de una sola banda (`WalletFiltros`, ya
// retirada) montan esto: cada cambio se aplica en el acto y se avisa por `onCambiar`.

export function LibroCajaBarraControlada({
  filtrosWallet = FILTROS_WALLET_VACIOS,
  onCambiar,
}: {
  filtrosWallet?: FiltrosWallet;
  onCambiar?: (siguiente: FiltrosLibro) => void;
}) {
  const [valor, setValor] = useState<FiltrosLibro>(FILTROS_LIBRO_INICIALES);
  return (
    <LibroCajaBarra
      filtrosWallet={filtrosWallet}
      valor={valor}
      onCambiar={(cambio) => {
        const siguiente = { ...valor, ...cambio };
        setValor(siguiente);
        onCambiar?.(siguiente);
      }}
      onLimpiar={() => {
        const siguiente = { ...valor, tipo: "", categoria: "", termino: "" };
        setValor(siguiente);
        onCambiar?.(siguiente);
      }}
    />
  );
}
