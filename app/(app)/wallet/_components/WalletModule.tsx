"use client";

import { useMemo, useRef, useState } from "react";
import useSWR from "swr";

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
import { autoriaDelLibroCajaAction } from "@/lib/actions/libro-caja-autoria";
import type { ListarCompletoResult } from "@/lib/types/descarga-listado";
import type { AutoriaDeFilaDTO } from "@/lib/types/libro-caja-autoria";
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
import {
  CobrosRechazoTiendaPendientesPanel,
  type CobrosRechazoTiendaPendientes,
} from "./CobrosRechazoTiendaPendientesPanel";
import { WalletLedger, type AutoriaDelLibro } from "./WalletLedger";
import { filaDescargaMovimientoCaja } from "./wallet-ledger-descarga-columnas";
import {
  FILTROS_LIBRO_INICIALES,
  FILTROS_WALLET_VACIOS,
  filtrosDeWallet,
  hayFiltrosDeLibro,
  inputDeLibro,
  inputDeWallet,
  type FiltrosLibro,
  type FiltrosWallet,
} from "./WalletFiltros";
import { WalletFiltrosCaja, seleccionDePeriodo } from "./WalletFiltrosCaja";
import { LibroCajaBarra } from "./LibroCajaBarra";
import type { FilterSelection } from "@/components/shared/FilterComponent";
import { RegistrarMovimientoDialog } from "@/components/shared/wallet/RegistrarMovimientoDialog";
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
   * FICHA 337 (segunda mitad) -- la COLA de cobros por RECHAZO DESDE NOVEDADES, pre-obtenida en
   * el servidor. Misma forma que la de arriba y por el mismo motivo: `total` es el del SERVIDOR y
   * no el largo de `items`, que viene recortado por el tope del dominio.
   *
   * Es una prop APARTE y no una lista fundida con la de gasto fijo: son dos decisiones distintas
   * -- una autoriza un egreso de la caja, la otra cobra a una tienda-- con vocabulario, columnas y
   * acciones propias. Fundirlas obligaria a una fila polimorfica y a un «tipo de cobro» en
   * pantalla, que es exactamente lo que hace ilegible una cola de dinero.
   */
  cobrosRechazoTienda: CobrosRechazoTiendaPendientes;
  /**
   * Ficha 333 (G2, R40) — si el actor puede DECIDIR un cobro (`maestro`). Se resuelve en
   * `page.tsx` y baja por props: la pantalla no deduce roles. Es comodidad de interfaz; la
   * autorización real la hace el servicio (R24), que le responde `forbidden` al `admin`.
   */
  puedeDecidirCobros: boolean;
  /**
   * FICHA 337 (segunda mitad) -- si el actor puede DECIDIR un cobro por rechazo de tienda.
   *
   * PROP PROPIA y NO la de arriba, aunque hoy las dos las cumpla el maestro: los predicados son
   * distintos a proposito. `puedeDecidirCobros` es `maestro` y nadie mas (autoriza dinero que SALE
   * de Ordenex, ficha 333); este es ACCESO TOTAL -- maestro y admin-- porque cobrarle a una tienda
   * por un retorno ya prestado es operacion diaria. Reusar una sola prop ataria las dos reglas y
   * el dia que una cambie, cambiaria la otra sin que nadie lo decida.
   *
   * Es comodidad de interfaz; la autorizacion real la hace el servicio.
   */
  puedeDecidirCobrosRechazo: boolean;
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

/**
 * FICHA 463 (design §5.2) — los dos inputs de la caja, compuestos con la paginación.
 *
 * - `inputDeWallet` (resumen, composición, desglose): SOLO la zona de la wallet (R12). Sus bordes son
 *   `.strict()` y rechazan término y orden (R14), así que aquí no pueden colarse.
 * - `inputDeLibro` (libro paginado y descarga): la zona de la wallet + la del libro (R8/R9/R42).
 *
 * Feature 170 (T C.4, R10/R18) — la DESCARGA usa `inputDeLibro` A SECAS, sin paginación: su schema es
 * `.strict()` y una paginación colada devolvería `validation_error` en vez de un archivo.
 */
function paginado(input: Record<string, unknown>, page: number, pageSize: number): Record<string, unknown> {
  return { ...input, page, pageSize };
}

const CLAVES_LIBRO = ["tipo", "categoria", "termino", "sortDir"] as const satisfies readonly (keyof FiltrosLibro)[];

/** ¿Dos juegos de filtros del libro piden lo mismo? */
function mismoLibro(a: FiltrosLibro, b: FiltrosLibro): boolean {
  // Campo a campo por sus claves: los filtros del libro son cuatro cadenas y ninguna se interpreta aquí.
  return CLAVES_LIBRO.every((clave) => a[clave] === b[clave]);
}

/** El tope de ids por lectura de autoría: el del borde (`autoriaLibroCajaSchema`, = página máxima). */
const TOPE_IDS_AUTORIA = 100;

/**
 * FICHA 458-E (R56/R57) — «A quién» y «Registró» de unas filas del libro, leídos EN LOTE por el
 * servidor (`autoriaDelLibroCajaAction`) en tramos del tope del borde. Cualquier respuesta que no sea
 * `ok` es un error: la celda dirá que no se pudo leer, nunca un «—» que significaría «no hay dato».
 */
async function leerAutoria(ids: readonly string[]): Promise<Map<string, AutoriaDeFilaDTO>> {
  const porMovimiento = new Map<string, AutoriaDeFilaDTO>();
  for (let i = 0; i < ids.length; i += TOPE_IDS_AUTORIA) {
    const r = await autoriaDelLibroCajaAction({ movimientoIds: ids.slice(i, i + TOPE_IDS_AUTORIA) });
    if (r.status !== "ok") throw new Error(`autoria del libro de la caja: ${r.status}`);
    for (const fila of r.filas) porMovimiento.set(fila.movimientoId, fila);
  }
  return porMovimiento;
}

/** Una fila del libro con su autoría, tal como la proyecta la descarga. */
interface MovimientoConAutoria {
  movimiento: WalletMovimientoDTO;
  autoria: AutoriaDeFilaDTO | undefined;
}

/**
 * FICHA 458-E (T E.1, R3/R55–R57) — el libro ENTERO con los filtros vigentes y, para CADA fila, «A
 * quién» y «Registró» (la misma lectura que la tabla), en la forma de un listado completo para que
 * el adaptador común (`filasDesdeResultado`) siga siendo quien aplica el tope y redacta los errores.
 * Si la autoría no se puede leer, su error ES el resultado: sin archivo, porque una hoja con esas dos
 * columnas vacías diría «nadie» donde el dato existe.
 */
async function listarConAutoria(
  input: Record<string, unknown>,
): Promise<ListarCompletoResult<MovimientoConAutoria>> {
  const res = await listarMovimientosCompletoAction(input);
  if (res.status !== "ok") return res;
  const porMovimiento = new Map<string, AutoriaDeFilaDTO>();
  for (let i = 0; i < res.items.length; i += TOPE_IDS_AUTORIA) {
    const tramo = res.items.slice(i, i + TOPE_IDS_AUTORIA).map((m) => m.id);
    const r = await autoriaDelLibroCajaAction({ movimientoIds: tramo });
    if (r.status !== "ok") return r;
    for (const fila of r.filas) porMovimiento.set(fila.movimientoId, fila);
  }
  return {
    ...res,
    items: res.items.map((m) => ({ movimiento: m, autoria: porMovimiento.get(m.id) })),
  };
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
  cobrosRechazoTienda,
  puedeDecidirCobros,
  puedeDecidirCobrosRechazo,
  ahoraIso,
}: WalletModuleProps) {
  const toast = useToast();

  const [movimientos, setMovimientos] = useState(initialMovimientos);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [resumen, setResumen] = useState(initialResumen);
  const [desglose, setDesglose] = useState(initialDesglose);
  const [composicion, setComposicion] = useState(initialComposicion);
  // FICHA 463 (design §5.2) — los filtros APLICADOS, partidos en sus dos zonas. Solo cambian cuando la
  // lectura llegó bien (R49): si falla, la pantalla sigue diciendo lo que de verdad está pintado.
  const [filtrosWallet, setFiltrosWallet] = useState<FiltrosWallet>(FILTROS_WALLET_VACIOS);
  const [filtrosLibro, setFiltrosLibro] = useState<FiltrosLibro>(FILTROS_LIBRO_INICIALES);
  // R9 — el conteo de la tarjeta es de la WALLET: no lo mueven el término ni los filtros del libro.
  const [totalWallet, setTotalWallet] = useState(initialTotal);
  const [cargandoWallet, setCargandoWallet] = useState(false);
  const [cargandoLibro, setCargandoLibro] = useState(false);
  // R49 — si una lectura falla, el control del periodo vuelve a decir el periodo APLICADO.
  const [siembraPeriodo, setSiembraPeriodo] = useState<{ senal: number; seleccion: FilterSelection } | undefined>(
    undefined,
  );

  /**
   * Lo último PEDIDO en cada zona (no lo aplicado): el buscador avisa con su propia espera y los
   * conmutadores pueden pulsarse mientras viaja una lectura, así que el siguiente cambio se compone
   * sobre lo pedido y no sobre un estado que aún no llegó. Si la lectura falla vuelven a lo aplicado.
   */
  const pedidoWallet = useRef<FiltrosWallet>(FILTROS_WALLET_VACIOS);
  const pedidoLibro = useRef<FiltrosLibro>(FILTROS_LIBRO_INICIALES);
  /**
   * Turnos de lectura: solo pinta la ÚLTIMA pedida. Una respuesta lenta de un término viejo no puede
   * pisar la del término nuevo. El libro tiene su turno y la wallet el suyo: releer la wallet entera
   * también relee el libro, así que toma turno en los dos.
   */
  const turnoLibro = useRef(0);
  const turnoWallet = useRef(0);

  // FICHA 458-E (R56/R57) — la autoría de la página que se está viendo. La clave son los ids de la
  // página: cambiar de filtro, de página o releer tras registrar/anular trae filas nuevas y la
  // lectura se repite sola; volver a una página ya vista la sirve la caché de SWR.
  //
  // FICHA 458-E (cierre) — el panel «Ver» ya no relee la autoría de su fila: usa ESTA. Por eso, tras
  // registrar, anular o adjuntar (`recargarTrasCambio`), la clave lleva además una VERSIÓN: la misma
  // página con los mismos ids tiene que volver a leerse, porque quién anuló, cuándo y cómo acaban de
  // cambiar y la caché diría lo de antes.
  const [versionAutoria, setVersionAutoria] = useState(0);
  const ids = movimientos.map((m) => m.id);
  const { data: autoriaData, error: autoriaError } = useSWR(
    ids.length === 0 ? null : (["wallet:autoria-libro", versionAutoria, ...ids] as const),
    ([, , ...clave]) => leerAutoria(clave),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const autoria = useMemo<AutoriaDelLibro>(() => {
    if (ids.length === 0) return { estado: "ok", porMovimiento: new Map() };
    if (autoriaError !== undefined) return { estado: "error" };
    if (autoriaData === undefined) return { estado: "cargando" };
    return { estado: "ok", porMovimiento: autoriaData };
  }, [ids.length, autoriaData, autoriaError]);

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

  /** R49 — la lectura falló: lo pedido vuelve a lo aplicado y el periodo del control también. */
  function deshacerPedido() {
    pedidoWallet.current = filtrosWallet;
    pedidoLibro.current = filtrosLibro;
    setSiembraPeriodo((s) => ({
      senal: (s?.senal ?? 0) + 1,
      seleccion: seleccionDePeriodo(filtrosWallet.desde, filtrosWallet.hasta),
    }));
  }

  /**
   * FICHA 463 (R8/R20) — relee TODA la wallet: libro + las dos cifras + desglose + composición (R20/R11
   * de la 45/173; T6.3 de la 231). La composición llega en la MISMA respuesta que el resumen, así que
   * por construcción no pueden discrepar. Las cifras se piden SOLO con la zona de la wallet (R12).
   *
   * El conteo de la tarjeta (R9) es el del libro sin filtros del libro: si hay alguno puesto, se pide
   * aparte una página de una fila con la zona de la wallet, que trae el `total` del conjunto.
   */
  async function recargarTodo(fw: FiltrosWallet, fl: FiltrosLibro, nextPage: number) {
    const miLibro = ++turnoLibro.current;
    const miWallet = ++turnoWallet.current;
    const entradaWallet = paginado(inputDeWallet(fw), nextPage, pageSize);
    const conFiltrosDeLibro = hayFiltrosDeLibro(fl);
    setCargandoWallet(true);
    try {
      const [movRes, resRes, desRes, totRes] = await Promise.all([
        listarMovimientosAction(paginado(inputDeLibro(fw, fl), nextPage, pageSize)),
        verResumenCajaAction(entradaWallet),
        verDesgloseEgresosAction(entradaWallet),
        conFiltrosDeLibro ? listarMovimientosAction(paginado(inputDeWallet(fw), 1, 1)) : Promise.resolve(null),
      ]);
      if (miWallet !== turnoWallet.current) return; // llegó otra lectura de la wallet después

      for (const r of [movRes, resRes, desRes, totRes]) {
        if (r !== null && r.status !== "ok") {
          manejarError(r.status);
          deshacerPedido();
          return;
        }
      }
      if (movRes.status !== "ok" || resRes.status !== "ok" || desRes.status !== "ok") return;

      setResumen(resRes.resumen);
      setComposicion(resRes.composicion);
      setDesglose(desRes.desglose);
      setTotalWallet(totRes !== null && totRes.status === "ok" ? totRes.data.total : movRes.data.total);
      setFiltrosWallet(fw);
      // El libro de esta respuesta solo se pinta si nadie pidió otro libro mientras tanto.
      if (miLibro === turnoLibro.current) {
        setMovimientos(movRes.data.movimientos);
        setTotal(movRes.data.total);
        setPage(movRes.data.page);
        setFiltrosLibro(fl);
      }
    } finally {
      if (miWallet === turnoWallet.current) setCargandoWallet(false);
    }
  }

  /**
   * FICHA 463 (R9/R29/R35) — relee SOLO el libro: término, Entra/Sale, categoría, orden o página. Las
   * cifras de la wallet ni se piden ni se tocan.
   */
  async function recargarLibro(fl: FiltrosLibro, nextPage: number) {
    const miLibro = ++turnoLibro.current;
    setCargandoLibro(true);
    try {
      const movRes = await listarMovimientosAction(paginado(inputDeLibro(pedidoWallet.current, fl), nextPage, pageSize));
      if (miLibro !== turnoLibro.current) return;
      if (movRes.status !== "ok") {
        manejarError(movRes.status);
        pedidoLibro.current = filtrosLibro;
        return;
      }
      setMovimientos(movRes.data.movimientos);
      setTotal(movRes.data.total);
      setPage(movRes.data.page);
      setFiltrosLibro(fl);
    } finally {
      if (miLibro === turnoLibro.current) setCargandoLibro(false);
    }
  }

  /** R8/R19/R20 — la zona de la wallet: periodo aplicado o quitado, «A quién» elegido o quitado. */
  function cambiarWallet(fw: FiltrosWallet) {
    pedidoWallet.current = fw;
    void recargarTodo(fw, pedidoLibro.current, 1); // R8: vuelve a la primera página
  }

  /** R9/R29 — un control de la zona del libro: se compone con lo PEDIDO y vuelve a la página 1. */
  function cambiarLibro(cambio: Partial<FiltrosLibro>) {
    const siguiente = { ...pedidoLibro.current, ...cambio };
    if (mismoLibro(siguiente, pedidoLibro.current)) return;
    pedidoLibro.current = siguiente;
    void recargarLibro(siguiente, 1);
  }

  /** R30 — «Limpiar todo» del libro: fuera término, dirección y categoría; el orden se queda. */
  function limpiarLibro() {
    cambiarLibro({ tipo: "", categoria: "", termino: "" });
  }

  function cambiarPagina(nextPage: number) {
    void recargarLibro(filtrosLibro, nextPage);
  }

  /** R60 — tras registrar, anular o adjuntar: relee todo con los filtros vigentes Y la autoría. */
  async function recargarTrasCambio() {
    await recargarTodo(filtrosWallet, filtrosLibro, page);
    setVersionAutoria((v) => v + 1);
  }

  const loading = cargandoWallet || cargandoLibro;

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
          <RegistrarMovimientoDialog
            onRegistrado={() => void recargarTrasCambio()}
          />
        </div>

        {/* FICHA 463 (R1–R3) — la ZONA DE LA WALLET, antes de las cifras: el periodo y «A quién». */}
        <WalletFiltrosCaja
          aplicado={filtrosWallet}
          onCambiar={cambiarWallet}
          siembra={siembraPeriodo}
          disabled={cargandoWallet}
        />

        <CajaResumenCard resumen={resumen} movimientos={totalWallet} />
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
          onCambio={() => void recargarTrasCambio()}
        />
      ) : null}

      {/* FICHA 337 (segunda mitad) -- LA COLA DE COBROS POR RECHAZO DESDE NOVEDADES, justo debajo
          de la de gasto fijo: las dos son «dinero esperando una decision» y se leen juntas, antes
          de la composicion y del libro.

          Con el `total` del SERVIDOR en cero la seccion NO se monta, mismo criterio que su
          hermana: una tarjeta vacia permanente en la pantalla del dinero seria ruido. La seccion
          tiene ademas su propia guarda para el caso de decidir el ultimo cobro sin recargar.

          `onCambio` recarga libro, cifras, composicion y desglose: aprobar aqui escribe DOS
          ingresos en la caja, asi que las cifras de arriba cambian de verdad.

          ⚠️ QUIEN DECIDE NO ES EL MISMO PREDICADO que el de la cola de arriba, y por eso NO se
          reusa `puedeDecidirCobros`: aquel es `maestro` y solo el (dinero que SALE de Ordenex);
          este es ACCESO TOTAL (cobrar por un servicio prestado, operacion diaria). */}
      {cobrosRechazoTienda.total > 0 ? (
        <CobrosRechazoTiendaPendientesPanel
          initialData={cobrosRechazoTienda}
          puedeDecidir={puedeDecidirCobrosRechazo}
          onCambio={() => void recargarTrasCambio()}
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
      {/* Ficha 339 (T5.6, R20): la tarjeta recibe los filtros VIGENTES y los baja hasta el
          desplegable de cada fila, para que el detalle y el importe de esa fila hablen siempre
          del mismo conjunto. El estado ya vivía aquí; lo único nuevo es que viaja. */}
      <ComposicionGananciaCard
        composicion={composicion}
        desglose={desglose}
        resumen={resumen}
        filtros={filtrosDeWallet(filtrosWallet)}
      />

      <section id="gastos-fijos" aria-label="Gastos fijos" className="scroll-mt-4">
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

          <CardContent>
            {/* Feature 170 (T C.4, R9/R10): la descarga trae el libro ENTERO con los filtros
                VIGENTES, no la página pintada. El callback se construye EN EL RENDER (design
                §5), así que cierra sobre los `filtros` de ESTE render: aplicar un filtro y
                descargar sin más no puede entregar el conjunto anterior. */}
            <WalletLedger
              movimientos={movimientos}
              isLoading={loading}
              // Ficha 459 (R65) / 458-C (R60): anular o adjuntar desde el panel «Ver» relee libro, tarjetas, composición y desglose.
              onCambio={() => void recargarTrasCambio()}
              autoria={autoria}
              // FICHA 463 (R42): las dos zonas, el término y el orden vigentes.
              obtenerFilasDescarga={() =>
                filasDesdeResultado(listarConAutoria(inputDeLibro(filtrosWallet, filtrosLibro)), (f) =>
                  filaDescargaMovimientoCaja(f.movimiento, f.autoria),
                )
              }
              // FICHA 463 (R1/R5) — la ZONA DEL LIBRO, encima de la tabla y junto a la descarga.
              filtros={
                <LibroCajaBarra
                  filtrosWallet={filtrosWallet}
                  valor={filtrosLibro}
                  onCambiar={cambiarLibro}
                  onLimpiar={limpiarLibro}
                  disabled={loading}
                />
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
