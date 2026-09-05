"use client";

import { useState } from "react";

import { Pagination } from "@/components/shared/Pagination";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/useToast";
import {
  listarMisMovimientosAction,
  listarMisMovimientosCompletoAction,
} from "@/lib/actions/wallet-tienda";
import type {
  DesgloseTiendaDTO,
  SaldoTiendaDTO,
  WalletTiendaMovimientoDTO,
} from "@/lib/types/wallet-tienda";

import { SaldoTiendaCard } from "./SaldoTiendaCard";
import { DesgloseTiendaLedger } from "./DesgloseTiendaLedger";
import { filaDescargaMiWallet } from "./mi-wallet-descarga-columnas";
import type { CierresDeLaTienda } from "./mi-wallet-cierres";
import {
  MiWalletFiltros,
  FILTROS_TIENDA_VACIOS,
  type MiWalletFiltrosValue,
} from "./MiWalletFiltros";

// Feature 43 (T15, R18/R21/R22) — modulo cliente del wallet POR TIENDA. Recibe TODO por
// props desde el Server Component padre (que ya valido rol adminTienda y pre-fetch, R21):
// el cliente NUNCA recibe Prisma.Decimal ni recalcula montos (sin fetch propio de datos
// sensibles). Al cambiar filtros o pagina recarga desglose + saldo por Server Action
// (lectura interna, NO fetch a /api); el saldo mostrado refleja el conjunto filtrado (R22).
// Errores (forbidden/unauthenticated/validation) se muestran con toast. Money-safe: los
// montos viajan y se renderizan como STRING. El saldo puede ser NEGATIVO.

export interface MiWalletModuleProps {
  movimientos: WalletTiendaMovimientoDTO[];
  total: number;
  page: number;
  pageSize: number;
  saldo: SaldoTiendaDTO;
  /**
   * Feature 172 (T G.2, R55) — los tres importes de la cabecera, ya clasificados y sumados en
   * el servidor sobre el MISMO conjunto filtrado que el listado (R22 de la 43). Se recarga con
   * los movimientos, no se recalcula aqui: en el cliente no se opera con dinero.
   */
  desglose: DesgloseTiendaDTO;
  /**
   * Ficha 335 (design §4.1) — el catalogo de cierres del selector, YA leido en el servidor.
   *
   * REQUERIDA Y SIN DEFAULT, a proposito: con un `= { opciones: [], ... }` de cortesia, quien
   * montara este modulo manana se olvidaria de inyectarlo y el selector saldria vacio en
   * silencio, sin que nada se pusiera rojo. Que la inyeccion la garantice el compilador.
   */
  cierres: CierresDeLaTienda;
}

/** Construye el input de la action omitiendo los filtros vacios (cierre/concepto/fecha). */
function buildInput(
  filtros: MiWalletFiltrosValue,
  page: number,
  pageSize: number,
): Record<string, unknown> {
  const input: Record<string, unknown> = { page, pageSize };
  if (filtros.cierreId) input.cierreId = filtros.cierreId;
  if (filtros.categoria) input.categoria = filtros.categoria;
  if (filtros.desde) input.desde = filtros.desde;
  if (filtros.hasta) input.hasta = filtros.hasta;
  return input;
}

/**
 * Feature 170 (T C.4, R10/R18) — input del modo COMPLETO: los MISMOS filtros vigentes, SIN
 * `page`/`pageSize`. El schema del modo completo es `.strict()`: una paginación colada
 * devolvería `validation_error` en vez de un archivo, así que no se pone (y no hay que
 * acordarse de quitarla).
 */
function buildInputCompleto(filtros: MiWalletFiltrosValue): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (filtros.cierreId) input.cierreId = filtros.cierreId;
  if (filtros.categoria) input.categoria = filtros.categoria;
  if (filtros.desde) input.desde = filtros.desde;
  if (filtros.hasta) input.hasta = filtros.hasta;
  return input;
}

export function MiWalletModule({
  movimientos: initialMovimientos,
  total: initialTotal,
  page: initialPage,
  pageSize,
  saldo: initialSaldo,
  desglose: initialDesglose,
  cierres,
}: MiWalletModuleProps) {
  const toast = useToast();

  const [movimientos, setMovimientos] = useState(initialMovimientos);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [saldo, setSaldo] = useState(initialSaldo);
  const [desglose, setDesglose] = useState(initialDesglose);
  const [filtros, setFiltros] = useState<MiWalletFiltrosValue>(FILTROS_TIENDA_VACIOS);
  const [loading, setLoading] = useState(false);

  /** Traduce un status de error de dominio a un toast accionable. */
  function manejarError(status: "forbidden" | "unauthenticated" | "validation_error") {
    if (status === "forbidden") {
      toast.error("No tenés permiso para ver tu wallet.");
    } else if (status === "unauthenticated") {
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
    } else {
      toast.error("Los filtros no son válidos. Revisá el rango de fechas.");
    }
  }

  /** Recarga desglose + saldo (del conjunto filtrado) para los filtros/pagina dados (R22). */
  async function recargar(next: MiWalletFiltrosValue, nextPage: number) {
    const input = buildInput(next, nextPage, pageSize);
    setLoading(true);
    try {
      const res = await listarMisMovimientosAction(input);

      if (res.status !== "ok") {
        manejarError(res.status);
        return;
      }

      setMovimientos(res.data.movimientos);
      setTotal(res.data.total);
      setPage(res.data.page);
      setSaldo(res.data.saldo);
      // R55: los tres importes se refrescan CON el listado. Son cifras del mismo conjunto
      // filtrado y se leen juntas; dejar una vieja seria mezclar dos conjuntos en pantalla.
      setDesglose(res.data.desglose);
      setFiltros(next);
    } finally {
      setLoading(false);
    }
  }

  function aplicarFiltros(value: MiWalletFiltrosValue) {
    void recargar(value, 1); // nuevos filtros -> vuelve a la primera pagina
  }

  function limpiarFiltros() {
    void recargar(FILTROS_TIENDA_VACIOS, 1);
  }

  function cambiarPagina(nextPage: number) {
    void recargar(filtros, nextPage);
  }

  return (
    // Ficha 335 (B2, R12) — DOS tarjetas HERMANAS, nunca anidadas: la del saldo y la del libro
    // son hijas del mismo contenedor. `gap-6` es el ritmo por defecto de `DESIGN.md`; el `gap-8`
    // anterior abría un hueco que no separaba nada.
    <div className="flex flex-col gap-6">
      {/* El envoltorio `lg:max-w-md` se va: la tarjeta del saldo pasa a ancho completo, como la
          del libro. Por DENTRO `SaldoTiendaCard` no se toca ni un byte — ya es una tarjeta con
          cifra grande y tres importes, que es justo lo que esta ficha pide. */}
      <SaldoTiendaCard saldo={saldo} desglose={desglose} />

      {/* El libro deja de ser TRES hermanos sueltos —filtros, tabla y paginación flotando uno
          debajo del otro— y pasa a UNA tarjeta que los contiene, igual que en `/wallet`.

          La `<section>` sigue por FUERA y conserva su `aria-label`: quien navega por regiones
          llega igual que antes. El `CardTitle` le pone además el título VISIBLE que la sección
          nunca tuvo (R13: hasta ahora el nombre del bloque solo existía en el árbol de
          accesibilidad, o sea para nadie que mirara la pantalla). */}
      <section aria-label="Desglose de movimientos">
        <Card>
          <CardHeader>
            <CardTitle>Desglose de movimientos</CardTitle>
          </CardHeader>

          {/* R14 — la barra de filtros es una BANDA a lo ancho de la tarjeta: hija directa del
              `Card` (sin `CardContent`, que solo aporta padding lateral) para que el fondo y el
              `border-b` lleguen a los dos bordes. El padding horizontal se repone con
              `px-(--card-spacing)`, el mismo de la cabecera y el cuerpo, así que los controles
              quedan alineados con el título. */}
          <div className="border-b bg-muted/30 px-(--card-spacing) py-3">
            <MiWalletFiltros
              onAplicar={aplicarFiltros}
              onLimpiar={limpiarFiltros}
              disabled={loading}
              cierres={cierres}
            />
          </div>

          <CardContent>
            {/* Feature 170 (T C.4, R9/R10): el archivo trae el ledger ENTERO de la tienda con
                los filtros vigentes, no la página. El callback se construye en el render, así
                que cierra sobre los `filtros` de ESTE render. */}
            <DesgloseTiendaLedger
              movimientos={movimientos}
              isLoading={loading}
              obtenerFilasDescarga={() =>
                filasDesdeResultado(
                  listarMisMovimientosCompletoAction(buildInputCompleto(filtros)),
                  filaDescargaMiWallet,
                )
              }
            />
          </CardContent>

          {/* R15 — la paginación baja al PIE, que la primitiva ya pinta como banda apoyada en
              el borde inferior, y en FLUJO NORMAL.

              `compacta`: en el pie de una tarjeta la barra es una fila más, sin el aire del pie
              de un listado. Aquí decía `sticky={false}`, que además evitaba el fragmento de DOS
              elementos (envoltorio + centinela) que el modo pegajoso devolvía; ese modo ya no
              existe —flotaba sobre las filas y se comía su clic—, así que el control es un solo
              `<nav>` siempre. El `ariaLabel` NO cambia: es el nombre por el que ya se la
              encuentra. */}
          <CardFooter>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={cambiarPagina}
              disabled={loading}
              ariaLabel="Paginación del desglose"
              compacta
              className="w-full justify-between gap-3 py-0"
            />
          </CardFooter>
        </Card>
      </section>
    </div>
  );
}
