"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Feature 44 (T14, R22) — filtro POR MENSAJERO de la tabla-resumen del maestro. La tabla
// muestra el AGREGADO por mensajero (`listarCuentasPorPagarAction`); este filtro es puramente
// de presentacion (busqueda por nombre sobre la lista ya pre-obtenida: string, sin fetch ni
// aritmetica sobre montos): money-safe.
//
// Los filtros server-side por rango de fecha y por cierre (R22) NO viven aqui: operan sobre el
// DESGLOSE POR CIERRE de cada mensajero, que se carga al EXPANDIR su fila
// (`DesglosePagosMensajero`, via `listarPagosDeMensajeroAction`), donde el saldo mostrado
// refleja el conjunto filtrado.

export interface CuentasPorPagarFiltrosProps {
  /** Texto de busqueda por nombre de mensajero (controlado por el padre). */
  value: string;
  /** Emite el nuevo texto de busqueda. */
  onChange: (value: string) => void;
  /** Deshabilita el control. */
  disabled?: boolean;
}

export function CuentasPorPagarFiltros({
  value,
  onChange,
  disabled = false,
}: CuentasPorPagarFiltrosProps) {
  return (
    <form
      aria-label="Filtros de cuentas por pagar"
      className="flex flex-wrap items-end gap-4"
      onSubmit={(e) => e.preventDefault()}
    >
      <div className="flex min-w-64 flex-col gap-1.5">
        <Label htmlFor="cuentas-filtro-mensajero">Mensajero</Label>
        <Input
          id="cuentas-filtro-mensajero"
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder="Buscar por nombre"
          aria-label="Buscar por mensajero"
          className="w-64"
        />
      </div>
    </form>
  );
}
