import { money } from "@/lib/config/moneda";
import type { EstadoCuentaDTO } from "@/lib/types/estado-cuenta";
import { cn } from "@/lib/utils";

import { ESTADO_CUENTA_TEXTO, TARJETAS_TEXTO, fraseDelSaldo, sinSigno } from "./estado-cuenta-labels";

// FICHA 458-D (T D.1, design §5.1; R18, R20, R22) — las TARJETAS del estado de cuenta: el saldo actual
// con su signo y la frase de quién le debe a quién, los abonos y los cargos del periodo, y el saldo
// inicial y final del periodo. Todo STRING del servidor pintado con `money` (R90): aquí no se suma
// nada — R22 lo afirma el servicio antes de responder.

/** Color del saldo actual según quién le debe a quién (tokens semánticos, jamás hex). */
const COLOR_DEL_SALDO: Record<EstadoCuentaDTO["signo"], string> = {
  positivo: "text-success-strong",
  negativo: "text-danger-strong",
  cero: "text-muted-foreground",
};

function Tarjeta({ rotulo, valor, clase }: { rotulo: string; valor: string; clase?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
      <span className="text-sm text-muted-foreground">{rotulo}</span>
      <span className={cn("text-xl font-semibold tabular-nums", clase)}>{valor}</span>
    </div>
  );
}

export interface TarjetasEstadoCuentaProps {
  estado: EstadoCuentaDTO;
}

export function TarjetasEstadoCuenta({ estado }: Readonly<TarjetasEstadoCuentaProps>) {
  const { cuenta } = estado;
  const t = TARJETAS_TEXTO[cuenta.tipo];
  // La bodega: el saldo es lo que TIENE POR ENTREGAR; positivo no es «a favor» sino deuda con la central.
  const color =
    cuenta.tipo === "bodega"
      ? estado.signo === "positivo"
        ? "text-warning-strong"
        : COLOR_DEL_SALDO[estado.signo]
      : COLOR_DEL_SALDO[estado.signo];
  const frase = fraseDelSaldo(cuenta.tipo, estado.sentido, cuenta.nombre, money(sinSigno(estado.saldoActual)));

  return (
    <section aria-label={ESTADO_CUENTA_TEXTO.tarjetas(cuenta.nombre)} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
        <span className="text-sm text-muted-foreground">{t.saldo}</span>
        <span className={cn("text-3xl font-semibold tabular-nums", color)}>{money(estado.saldoActual)}</span>
        <p className="text-base font-medium text-foreground">{frase}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tarjeta rotulo={t.inicial} valor={money(estado.saldoInicial)} />
        <Tarjeta rotulo={t.abonos} valor={money(estado.abonos)} clase="text-success-strong" />
        <Tarjeta rotulo={t.cargos} valor={money(estado.cargos)} clase="text-danger-strong" />
        <Tarjeta rotulo={t.final} valor={money(estado.saldoFinal)} />
      </div>
    </section>
  );
}
