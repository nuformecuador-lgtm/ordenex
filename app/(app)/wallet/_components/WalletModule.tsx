"use client";

import { useState } from "react";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Pagination } from "@/components/shared/Pagination";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import { useToast } from "@/hooks/useToast";
import {
  listarMovimientosAction,
  listarMovimientosCompletoAction,
  verResumenCajaAction,
} from "@/lib/actions/wallet";
import { verDesgloseEgresosAction } from "@/lib/actions/wallet-egresos";
import type {
  CajaResumenDTO,
  ComposicionGananciaDTO,
  DesgloseEgresosDTO,
  WalletMovimientoDTO,
} from "@/lib/types/wallet";

import { CajaResumenCard } from "./CajaResumenCard";
import {
  CobrosGastoFijoPendientesPanel,
  type CobrosGastoFijoPendientes,
} from "./CobrosGastoFijoPendientesPanel";
import { WalletLedger } from "./WalletLedger";
import { filaDescargaMovimientoCaja } from "./wallet-ledger-descarga-columnas";
import { WalletFiltros, FILTROS_VACIOS, type WalletFiltrosValue } from "./WalletFiltros";
import { RegistrarMovimientoCajaDialog } from "./RegistrarMovimientoCajaDialog";
import { ComposicionGananciaCard } from "./ComposicionGananciaCard";
import {
  GastosFijosPlantillasPanel,
  type GastosFijosPlantillasPagina,
} from "./GastosFijosPlantillasPanel";

// Feature 42 (T12, R18/R20/R21) — módulo cliente de la wallet. Recibe TODO por props
// desde el Server Component padre (que ya validó rol y pre-fetch, R21): el cliente NUNCA
// recibe Prisma.Decimal ni recalcula montos. Al cambiar filtros o página recarga libro +
// resumen + desglose por Server Action (lectura interna, NO fetch a /api); las cifras de la
// cabecera y el desglose reflejan el conjunto filtrado (R20/R11). Errores → toast.
//
// Feature 45 (T10, R11/R23) — se añaden: el diálogo de EGRESO administrativo manual, la
// tarjeta de DESGLOSE de egresos por tipo (recargada con los mismos filtros que el libro) y
// el panel CRUD de PLANTILLAS de gasto fijo. Registrar/reversar/editar plantilla refresca la
// vista sin recarga manual (R23). Money-safe: los montos viajan y se renderizan como STRING.
//
// Feature 173 (T G.3, R58/R59) — la cabecera pasa de UNA cifra a las DOS de `verResumenCaja`,
// y el módulo deja de hablar con el borde viejo. `T G.3` dejó `verBalanceAction` **sin un solo
// consumidor en `app/`**; la Tanda H la retiró de `lib/actions/wallet.ts`, así que ya no existe
// (el único borde de la caja es `verResumenCajaAction`). El DTO viaja entero hasta la tarjeta
// —incluida la bandera `periodoFiltrado` del rótulo condicional `[P7]`—, así que aquí no se
// decide ningún rótulo ni se toca ningún importe.

export interface WalletModuleProps {
  movimientos: WalletMovimientoDTO[];
  total: number;
  page: number;
  pageSize: number;
  /** Feature 173 (R58): las DOS cifras de la caja para el conjunto filtrado, ya derivadas. */
  resumen: CajaResumenDTO;
  desglose: DesgloseEgresosDTO;
  /**
   * Feature 231 (T6.3, R22/R24): la ganancia abierta concepto por concepto. Viaja HERMANA del
   * resumen y del MISMO agregado —una sola lectura de la base—, así que la tarjeta de la
   * ganancia y las cifras de la caja no pueden estar hablando de dos instantes distintos.
   */
  composicion: ComposicionGananciaDTO;
  /**
   * Feature 170 — FASE 2 (T I.2, R40/R41): PÁGINA 1 de las plantillas de gasto fijo, ya
   * resuelta server-side, más el `total` del conjunto. El panel pide las siguientes.
   */
  plantillas: GastosFijosPlantillasPagina;
  /**
   * Ficha 333 (G2, R37/R41/R44) — la COLA de cobros de gasto fijo por aprobar, pre-obtenida en
   * el servidor. `total` es el del SERVIDOR y no el largo de `items`, que viene recortado por el
   * tope del dominio: es lo que pinta la insignia de la sección.
   */
  cobrosPendientes: CobrosGastoFijoPendientes;
  /**
   * Ficha 333 (G2, R40) — si el actor puede DECIDIR un cobro (`maestro`). Se resuelve en
   * `page.tsx` y baja por props: la pantalla no deduce roles. Es comodidad de interfaz; la
   * autorización real la hace el servicio (R24), que le responde `forbidden` al `admin`.
   */
  puedeDecidirCobros: boolean;
  /**
   * Feature 85 (T F.4, R23): el instante con el que el panel de gastos fijos calcula la
   * columna «Próximo cobro», resuelto en el SERVIDOR (`page.tsx`) y pasado TAL CUAL. Este
   * módulo no lo interpreta ni lo sustituye: solo lo transporta.
   *
   * REQUERIDA, sin `?` y sin default, en los dos eslabones de la cadena: la inyección la
   * garantiza el compilador, no la buena voluntad de quien monte el módulo mañana.
   */
  ahoraIso: string;
}

/** Construye el input de las actions omitiendo los filtros vacíos (enum/fecha). */
function buildInput(filtros: WalletFiltrosValue, page: number, pageSize: number): Record<string, unknown> {
  const input: Record<string, unknown> = { page, pageSize };
  if (filtros.tipo) input.tipo = filtros.tipo;
  if (filtros.categoria) input.categoria = filtros.categoria;
  if (filtros.desde) input.desde = filtros.desde;
  if (filtros.hasta) input.hasta = filtros.hasta;
  return input;
}

/**
 * Feature 170 (T C.4, R10/R18) — input del modo COMPLETO: los MISMOS filtros vigentes que
 * el listado, SIN `page`/`pageSize`. No se reusa `buildInput` con un `delete` después: el
 * schema del modo completo es `.strict()` y una paginación colada devolvería
 * `validation_error` en vez de un archivo. Aquí no hay nada que quitar porque no se pone.
 */
function buildInputCompleto(filtros: WalletFiltrosValue): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (filtros.tipo) input.tipo = filtros.tipo;
  if (filtros.categoria) input.categoria = filtros.categoria;
  if (filtros.desde) input.desde = filtros.desde;
  if (filtros.hasta) input.hasta = filtros.hasta;
  return input;
}

export function WalletModule({
  movimientos: initialMovimientos,
  total: initialTotal,
  page: initialPage,
  pageSize,
  resumen: initialResumen,
  desglose: initialDesglose,
  composicion: initialComposicion,
  plantillas,
  cobrosPendientes,
  puedeDecidirCobros,
  ahoraIso,
}: WalletModuleProps) {
  const toast = useToast();

  const [movimientos, setMovimientos] = useState(initialMovimientos);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [resumen, setResumen] = useState(initialResumen);
  const [desglose, setDesglose] = useState(initialDesglose);
  const [composicion, setComposicion] = useState(initialComposicion);
  const [filtros, setFiltros] = useState<WalletFiltrosValue>(FILTROS_VACIOS);
  const [loading, setLoading] = useState(false);

  /** Traduce un status de error de dominio a un toast accionable. */
  function manejarError(status: "forbidden" | "unauthenticated" | "validation_error") {
    if (status === "forbidden") {
      toast.error("No tenés permiso para ver la wallet.");
    } else if (status === "unauthenticated") {
      toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
    } else {
      toast.error("Los filtros no son válidos. Revisá el rango de fechas.");
    }
  }

  /**
   * Recarga libro + las dos cifras + desglose + composición para los filtros/página dados
   * (R20/R11 de la 45/173; T6.3 de la 231). La composición NO viaja en una acción propia: llega
   * en la MISMA respuesta que el resumen, así que un cambio de filtro refresca las dos a la vez
   * y por construcción no pueden discrepar.
   */
  async function recargar(next: WalletFiltrosValue, nextPage: number) {
    const input = buildInput(next, nextPage, pageSize);
    setLoading(true);
    try {
      const [movRes, resRes, desRes] = await Promise.all([
        listarMovimientosAction(input),
        verResumenCajaAction(input),
        verDesgloseEgresosAction(input),
      ]);

      if (movRes.status !== "ok") {
        manejarError(movRes.status);
        return;
      }
      if (resRes.status !== "ok") {
        manejarError(resRes.status);
        return;
      }
      if (desRes.status !== "ok") {
        manejarError(desRes.status);
        return;
      }

      setMovimientos(movRes.data.movimientos);
      setTotal(movRes.data.total);
      setPage(movRes.data.page);
      setResumen(resRes.resumen);
      setComposicion(resRes.composicion);
      setDesglose(desRes.desglose);
      setFiltros(next);
    } finally {
      setLoading(false);
    }
  }

  function aplicarFiltros(value: WalletFiltrosValue) {
    void recargar(value, 1); // nuevos filtros → vuelve a la primera página
  }

  function limpiarFiltros() {
    void recargar(FILTROS_VACIOS, 1);
  }

  function cambiarPagina(nextPage: number) {
    void recargar(filtros, nextPage);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* R59: el nombre accesible de la sección también cambia — la palabra que mentía no se
          queda escondida en el árbol de accesibilidad, que para quien usa lector de pantalla
          ES la pantalla.

          Feature 200 (tanda 1): las acciones suben a una barra propia arriba a la derecha y la
          cabecera pasa a ocupar el ancho entero. Antes competían por el espacio en la misma
          fila, y la tarjeta —que es lo que se viene a leer— quedaba encajonada a media
          pantalla. El conteo del conjunto que se está mirando (`total`, el del SERVIDOR, no el
          largo de la página pintada) se le pasa a la tarjeta como tercer tile. */}
      <section aria-label="Resumen de la caja y acciones" className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          {/* Ficha 334 (T D4, R1/R2): UN solo control para mover dinero a mano. Antes eran dos
              botones casi iguales —«Registrar movimiento» y «Registrar egreso»— con dos
              vocabularios que no se explicaban entre si, y habia que adivinar cual abrir. El
              enrutado por concepto vive dentro del dialogo, no aqui. */}
          <RegistrarMovimientoCajaDialog
            onRegistrado={() => void recargar(filtros, page)}
          />
        </div>

        <CajaResumenCard resumen={resumen} movimientos={total} />
      </section>

      {/* Ficha 333 (G2, design §7 · R37/R38/R42) — LA COLA DE COBROS DE GASTO FIJO POR APROBAR,
          entre la tarjeta de la caja y la de la ganancia: es lo primero que se lee después del
          dinero y antes de la composición y del libro. No se mueve nada más de esta página.

          R38: con el `total` del SERVIDOR en cero la sección NO se monta —una tarjeta vacía
          permanente en la pantalla del dinero sería ruido, y lo que se pide es que se note
          cuando hay algo—. La sección tiene además su propia guarda para el caso de decidir el
          último cobro sin recargar la ruta.

          R42: tras aprobar o rechazar, la sección relee LO SUYO (su `mutate`) y por este
          `onCambio` se recargan libro, cifras, composición y desglose con los filtros vigentes.
          Es el mismo ciclo que ya hace el panel de plantillas. */}
      {cobrosPendientes.total > 0 ? (
        <CobrosGastoFijoPendientesPanel
          initialData={cobrosPendientes}
          puedeDecidir={puedeDecidirCobros}
          onCambio={() => void recargar(filtros, page)}
        />
      ) : null}

      {/* Feature 231 (T6.3, D2) — la tarjeta de la ganancia entra BAJO la de la caja, que es
          donde se hace la pregunta que responde («¿y de dónde sale ese número?»).

          Con ella, la tarjeta «Egresos» de la 45/158 SALE de la página: enseñaba los mismos
          cuatro conceptos y su total, y verlos dos veces en la misma pantalla es lo que hace
          dudar de cuál de los dos números es el bueno. No se borra su contenido: su lista es
          ahora la columna derecha de ésta (`DesgloseEgresosLista`), con una fila más para que
          el total cuadre con `egresosPropios`.

          Efecto colateral declarado en D2: al salir el desglose de la fila que compartía, el
          panel de gastos fijos pasa a ancho completo — que es lo que su tabla paginada con
          descarga necesitaba desde el principio. */}
      <ComposicionGananciaCard
        composicion={composicion}
        desglose={desglose}
        resumen={resumen}
      />

      <section aria-label="Gastos fijos">
        {/* Feature 170 — FASE 2 (T I.2): el panel pagina su propio listado y relee su página
            tras cada cambio del CRUD (R23); la wallet ya no guarda la lista en su estado. */}
        <GastosFijosPlantillasPanel initialData={plantillas} ahoraIso={ahoraIso} />
      </section>

      {/* Feature 200 (tanda 3): el libro deja de ser TRES hermanos sueltos —filtros, tabla y
          paginación flotando uno debajo del otro— y pasa a UNA tarjeta que los contiene, como
          ya lo son el desglose y los gastos fijos de la fila de arriba. Cards HERMANAS, nunca
          anidadas: esta es la tercera de la página, no vive dentro de ninguna.

          La `<section>` sigue por fuera y conserva su `aria-label`: quien navega por regiones
          llega igual que antes, y el `CardTitle` le pone además el título VISIBLE que la
          sección nunca tuvo (hasta ahora el nombre del bloque solo existía en el árbol de
          accesibilidad). */}
      <section aria-label="Libro de movimientos">
        <Card>
          <CardHeader>
            <CardTitle>Libro de movimientos</CardTitle>
          </CardHeader>

          {/* La barra de filtros es una BANDA a lo ancho de la tarjeta: hija directa del
              `Card` (sin `CardContent`, que solo aporta el padding lateral) para que el fondo
              y el `border-b` lleguen a los dos bordes. El padding horizontal se repone con
              `px-(--card-spacing)`, que es el mismo que usan la cabecera y el cuerpo, así que
              los controles quedan alineados con el título. */}
          <div className="border-b bg-muted/30 px-(--card-spacing) py-3">
            <WalletFiltros
              onAplicar={aplicarFiltros}
              onLimpiar={limpiarFiltros}
              disabled={loading}
            />
          </div>

          <CardContent>
            {/* Feature 170 (T C.4, R9/R10): la descarga trae el libro ENTERO con los filtros
                VIGENTES, no la página pintada. El callback se construye EN EL RENDER (design
                §5), así que cierra sobre los `filtros` de ESTE render: aplicar un filtro y
                descargar sin más no puede entregar el conjunto anterior. */}
            <WalletLedger
              movimientos={movimientos}
              isLoading={loading}
              onReversado={() => void recargar(filtros, page)}
              obtenerFilasDescarga={() =>
                filasDesdeResultado(
                  listarMovimientosCompletoAction(buildInputCompleto(filtros)),
                  filaDescargaMovimientoCaja,
                )
              }
            />
          </CardContent>

          {/* La paginación baja al PIE, que la primitiva ya pinta como banda (`border-t
              bg-muted/50`) apoyada en el borde inferior — el mismo cierre que la tanda 2 le
              dio al panel de gastos fijos.

              `sticky={false}`: en modo pegajoso el control devuelve un fragmento de DOS
              elementos (envoltorio + centinela de 1px) y el `display:flex` del pie los
              colocaría como dos columnas, con el centinela `w-full` empujando la barra.
              Además el `Card` tiene `overflow-hidden`, así que ya era el contenedor contra el
              que se pegaba: flotar sobre el viewport nunca ocurrió aquí. */}
          <CardFooter>
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={cambiarPagina}
              disabled={loading}
              ariaLabel="Paginación del libro"
              sticky={false}
              className="w-full justify-between gap-3 py-0"
            />
          </CardFooter>
        </Card>
      </section>
    </div>
  );
}
