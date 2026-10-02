"use client";

import { SelectorBuscable } from "@/components/shared/SelectorBuscable";
import { CIERRE_SELECTOR_TEXTOS } from "@/components/shared/wallet/cierres-selector";
import { useCierresDeLaCuenta, type CuentaDelSelector } from "@/components/shared/wallet/use-cierres-de-la-cuenta";

import { ESTADO_CUENTA_TEXTO } from "./estado-cuenta-labels";

// FICHA 458-D (R10–R12) — el filtro por CIERRE del estado de cuenta de una tienda o de un mensajero, en
// la oficina. Es la composición de la 458-A (`SelectorBuscable` + `useCierresDeLaCuenta`): se lee al
// abrirlo, ofrece SOLO los cierres con movimientos en ESTA cuenta (R11), rotulados por su día CR y el
// mensajero (R10), y se busca por un día o por el nombre del mensajero. El valor elegido es el cierre:
// viaja a `verEstadoCuentaAction` como `cierreId` y nunca se pinta (R1). Ningún campo pide un id (R2).
//
// FICHA 467 (design §4.3; R22, R23) — vive en la barra única del libro (casilla «Cierre»): el nombre va
// DENTRO del disparador («Cierre: Todos los cierres») y tiene la altura y el ancho mínimo de los demás
// controles de la barra.

export interface SelectorCierreDeCuentaProps {
  /** La cuenta de la página, en la forma del borde de `cierresDeLaCuentaAction`. */
  cuenta: CuentaDelSelector;
  valor: string | null;
  onCambiar: (cierreId: string | null) => void;
}

export function SelectorCierreDeCuenta({ cuenta, valor, onCambiar }: Readonly<SelectorCierreDeCuentaProps>) {
  const cierres = useCierresDeLaCuenta(cuenta);
  return (
    <SelectorBuscable
      id={`estado-cuenta-cierre-${cuenta.cuenta}`}
      etiqueta={ESTADO_CUENTA_TEXTO.cierre}
      opciones={cierres.opciones}
      valor={valor}
      onCambiar={onCambiar}
      onBuscar={cierres.buscar}
      estado={cierres.estado}
      hayMas={cierres.hayMas}
      textos={CIERRE_SELECTOR_TEXTOS}
      rotuloVisible
      className="h-8 w-auto min-w-56"
    />
  );
}
