// @vitest-environment jsdom
// Ficha 458-A (TA.2 pantalla, R5–R8, R1, R3) — la celda «Origen» y la columna de la descarga pintan el
// origen que compone el servidor (entidad incluida), con enlace SOLO si el rol accede, y el
// identificador SOLO en `href`.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { OrigenMovimiento } from "@/components/shared/wallet/OrigenMovimiento";
import { textoDeOrigen } from "@/components/shared/wallet/origen-movimiento";
import { ORIGEN_LABEL } from "@/app/(app)/wallet/_components/wallet-labels";
import { filaDescargaMovimientoCaja } from "@/app/(app)/wallet/_components/wallet-ledger-descarga-columnas";
import { filaDescargaDesgloseTienda } from "@/app/(app)/wallet/tiendas/_components/desglose-tienda-descarga-columnas";
import { filaDescargaMiWallet } from "@/app/(app)/mi-wallet/_components/mi-wallet-descarga-columnas";
import { filaDescargaDesgloseMensajero } from "@/app/(app)/wallet/mensajeros/_components/desglose-mensajero-descarga-columnas";
import type { WalletMovimientoDTO } from "@/lib/types/wallet";
import type { WalletTiendaMovimientoDTO } from "@/lib/types/wallet-tienda";
import type { PagoMensajeroMovimientoDTO } from "@/lib/types/wallet-mensajero";
import type { OrigenLegibleDTO } from "@/lib/types/wallet-origen";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CIERRE = "c1e2e3e4-1111-4111-8111-aaaaaaaaaaaa";
const CON_ENLACE: OrigenLegibleDTO = {
  texto: "Cierre del día · 2026-09-12 · Juan Pérez Mora",
  enlace: { etiqueta: "Ver el cierre del 2026-09-12 de Juan Pérez Mora", href: `/cierres-admin?cierre=${CIERRE}` },
};

afterEach(cleanup);

describe("OrigenMovimiento — la celda", () => {
  it("R6/R7: el texto con su entidad y, con acceso, el enlace nombrado sin id (id solo en href)", () => {
    render(
      <OrigenMovimiento
        fila={{ origenTipo: "cierre_dia", descripcion: null, origen: CON_ENLACE }}
        rotulos={ORIGEN_LABEL}
      />,
    );
    expect(screen.getByText("Cierre del día · 2026-09-12 · Juan Pérez Mora")).toBeInTheDocument();
    const enlace = screen.getByRole("link", { name: "Ver el cierre del 2026-09-12 de Juan Pérez Mora" });
    expect(enlace).toHaveAttribute("href", `/cierres-admin?cierre=${CIERRE}`);
    // Label in Name: lo visible («Ver») está al principio del nombre accesible.
    expect(enlace).toHaveTextContent(/^Ver$/);
    expect(document.body.textContent ?? "").not.toMatch(UUID);
  });

  it("R8: sin acceso (enlace null) solo el texto, sin enlace; la descripción va detrás", () => {
    render(
      <OrigenMovimiento
        fila={{
          origenTipo: "gestion_orden",
          descripcion: "Rechazo del 12",
          origen: { texto: "Gestión de orden · cobro por rechazo · guía 4321", enlace: null },
        }}
        rotulos={ORIGEN_LABEL}
      />,
    );
    expect(screen.getByText("Gestión de orden · cobro por rechazo · guía 4321 · Rechazo del 12")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("R4/R5: una fila sin `origen` cae al rótulo del diccionario total, nunca al valor técnico", () => {
    expect(textoDeOrigen({ origenTipo: "pago_por_cuenta_tienda", descripcion: null }, ORIGEN_LABEL)).toBe(
      "Pago de un gasto de una tienda",
    );
  });
});

describe("R3 — las cuatro descargas llevan el MISMO texto de origen, sin id", () => {
  const origen = { texto: "Premio del ranking · podio del 2026-09-10", enlace: { etiqueta: "Ver el ranking del 2026-09-10", href: `/ranking/historico?fecha=2026-09-10&x=${CIERRE}` } };
  const base = { origenId: CIERRE, descripcion: null, fechaMovimiento: "2026-09-10T18:00:00.000Z", monto: "5000.00" };

  it.each([
    [
      "caja",
      () =>
        filaDescargaMovimientoCaja({
          ...base,
          id: CIERRE,
          tipo: "egreso",
          categoria: "egreso_pago_mensajero",
          origenTipo: "ranking_snapshot_fila",
          registradoPor: null,
          dueno: "propio",
          documento: null,
          origen,
        } as WalletMovimientoDTO & { origen: OrigenLegibleDTO }),
    ],
    [
      "tienda",
      () =>
        filaDescargaDesgloseTienda({
          ...base,
          id: CIERRE,
          tiendaId: CIERRE,
          tipo: "credito",
          categoria: "cod_recaudado",
          origenTipo: "ranking_snapshot_fila",
          origen,
        } as WalletTiendaMovimientoDTO & { origen: OrigenLegibleDTO }),
    ],
    [
      "mi-wallet",
      () =>
        filaDescargaMiWallet({
          ...base,
          id: CIERRE,
          tiendaId: CIERRE,
          tipo: "credito",
          categoria: "cod_recaudado",
          origenTipo: "ranking_snapshot_fila",
          origen,
        } as WalletTiendaMovimientoDTO & { origen: OrigenLegibleDTO }),
    ],
    [
      "mensajero",
      () =>
        filaDescargaDesgloseMensajero({
          ...base,
          id: CIERRE,
          mensajeroId: CIERRE,
          tipo: "devengo",
          categoria: "premio_ranking",
          origenTipo: "ranking_snapshot_fila",
          cierreId: CIERRE,
          origen,
        } as PagoMensajeroMovimientoDTO & { origen: OrigenLegibleDTO }),
    ],
  ])("%s", (_n, fila) => {
    const f = fila();
    expect(f.origen).toBe("Premio del ranking · podio del 2026-09-10");
    expect(Object.values(f).join(" | ")).not.toMatch(UUID);
  });
});
