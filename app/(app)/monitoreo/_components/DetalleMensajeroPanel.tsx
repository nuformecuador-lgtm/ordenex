"use client";

// Feature 192 (F6.1/F6.2/F6.5) + Feature 258 (F3.1) — EL DETALLE de un mensajero.
//
// ─── DE `Sheet` A `Modal` (R31–R34, pedido humano 3) ──────────────────────────────────────
//
// Ya no es un panel lateral: es el `Modal` de la casa (`components/shared/Modal`), que sobre
// el Dialog de Base UI ya trae focus-trap, `aria-modal`, overlay y restauracion del foco. Lo
// que NO cambia es donde vive: se monta como HERMANO del tablero, nunca encima de una ruta
// propia, para que abrirlo y cerrarlo no desmonte el modulo ni reinicie el ciclo de SWR (R33).
// Lo que hace la vista enlazable es el parametro de la URL, que gestiona el modulo padre.
//
// El archivo CONSERVA SU NOMBRE. Renombrarlo a `…Modal.tsx` obligaria a tocar tres tests
// —incluido el censo de fuente, que lee la ruta literal— sin mover un pixel.
//
// Tres decisiones del modal, con su porque:
//
//  - `hideConfirm` + `cancelLabel="Cerrar"` (R34): es una vista de LECTURA, no una decision.
//    `Modal` obliga a al menos una salida visible, y «Cerrar» es la honesta; `hideCancel`
//    ademas dejaria el dialogo sin ningun boton.
//  - `data-slot="detalle-mensajero-panel"` se mueve del `SheetContent` a un `div` dentro de
//    `children` (R62). `Modal` tiene props tipadas y no acepta `data-*` arbitrarios; y como
//    `Dialog.Portal` desmonta al cerrar, el ancla sigue apareciendo y desapareciendo igual
//    que antes. El selector de los tests NO cambia.
//  - El cierre por Escape y por el fondo lo da `Modal` con `dismissible` por defecto, y
//    desemboca en el mismo `onCerrar` de siempre (R32).
//
// ─── LO QUE SE REUTILIZA Y LO QUE NO (R19/R37 · FEATURE 260 R20/R21) ─────────────────────
//
// Se reutiliza el MODULO DE COLUMNAS del listado de ordenes entero (`./detalle-columnas`), y
// con el su vocabulario visual del estatus. **Aqui no se declara ni una definicion de columna,
// ni un mapa de estatus → etiqueta, ni un color de estatus**: una segunda declaracion
// divergiria en silencio y la misma orden se leeria distinta en dos pantallas.
//
// Y la tabla es `DataTable`, la unica del repo, sin `renderExpanded` (antepondria una columna
// de expansion, que es una accion), sin `descarga` y sin `filtros` (dos acciones mas que este
// tablero no debe ofrecer). Con 20 columnas la tabla desborda: lo resuelve la propia primitiva
// DENTRO de su caja (`overflow-x-auto` + flechas), y por eso el envoltorio de aqui lleva
// `min-w-0` — sin el, un contenedor flex se niega a encoger por debajo de su contenido y la
// tabla empujaria el dialogo en vez de desplazarse (R28).
//
// NO se monta `OrdenesListado`: es un contenedor de 11 props de negocio —acciones por lote,
// carga masiva, escaner QR, catalogos de filtros, historial— atado a `/ordenes`.
//
// ─── EL PARAMETRO DE LA URL NO ES UNA AUTORIZACION (R13) ─────────────────────────────────
//
// Un enlace compartido se abre con otra sesion. Por eso el detalle se le pide SIEMPRE a la
// Server Action, que vuelve a resolver el alcance del actor. Y por eso los tres casos malos
// —id inexistente, mensajero de otra zona, mensajero sin ordenes hoy— muestran el MISMO aviso
// generico y el mismo panel vacio: distinguirlos ("ese mensajero no es de tu zona")
// confirmaria la existencia de un usuario ajeno.

import { Inbox } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";

import { DataTable } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { Modal } from "@/components/shared/Modal";
import { Pagination } from "@/components/shared/Pagination";
import { leerDetalleMensajeroDia } from "@/lib/actions/tablero-dia";
import type { AlcanceTableroDia, OrdenDetalleDia } from "@/lib/types/tablero-dia";

import { columnasDetalle } from "./detalle-columnas";
import { iniciales } from "./filtrar-mensajeros";

const TITULO_GENERICO = "Órdenes del día";
const CERRAR = "Cerrar";

/**
 * ⛔ REVERSION DE R49 DE LA FEATURE 192 — 2026-08-21.
 *
 * Aqui vivia `COLUMNAS`, y con ella la decision que R49 tomo: «las columnas del detalle, y
 * NINGUNA mas», cerrada por el humano en cuatro (Nº Guia, Estado, Resultado del dia, Cliente /
 * destino). Esa decision QUEDA REVERTIDA, con fecha y motivo, y no se borra: sigue escrita
 * junto a R49 en `specs/192-tablero-dia-mensajeros/requirements.md`.
 *
 *   Motivo: pedido humano —el detalle debe mostrar TODOS los datos de la orden—, sustituido por
 *   la feature 260, que monta `ordenesColumns` (`app/(app)/ordenes/_components/ordenes-columns`)
 *   a traves de `./detalle-columnas` en vez de declarar columnas propias. Con la unica columna
 *   que el listado no tiene —«Resultado del dia»— son 20 en alcance `global` y 17 en `zona`.
 *
 * Este comentario sustituye al de R49 en vez de suprimirlo: si el criterio cambia y el
 * comentario se queda, el codigo miente.
 *
 * MIENTRAS NO SE SABE EL ALCANCE se monta el MAS RESTRICTIVO. Es una decision de fallo cerrado:
 * durante la carga el detalle todavia no llego, y estrenar las columnas de dinero para
 * retirarlas medio segundo despues las enseñaria —vacias, pero enseñadas— a quien no puede
 * verlas. Sale del servidor (R12) y no se deduce aqui: un componente de cliente no puede leer
 * el papel del actor, y tampoco debe.
 */
const ALCANCE_MIENTRAS_CARGA: AlcanceTableroDia = "zona";

/**
 * R13 — EL aviso. Uno solo, identico para los tres casos malos, y sin eco del id recibido: el
 * texto no puede depender de cual ocurrio, porque saber cual ocurrio es la fuga.
 */
const AVISO_SIN_ORDENES = "No hay órdenes que mostrar para esta selección de hoy.";

const CARGANDO = "Cargando el detalle del mensajero";

/** R71 — avatar de iniciales en la cabecera. Decorativo; el nombre completo va al lado. */
function TituloConAvatar({ nombre }: Readonly<{ nombre: string }>) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[0.7rem] font-semibold text-muted-foreground"
      >
        {iniciales(nombre)}
      </span>
      {nombre}
    </span>
  );
}

export interface DetalleMensajeroPanelProps {
  /** `null` = panel cerrado. R11: sin id NO se consulta nada. */
  readonly mensajeroId: string | null;
  /** Nombre de la tarjeta desde la que se abrio; ausente cuando el id llego por la URL. */
  readonly mensajeroNombre?: string;
  readonly onCerrar: () => void;
}

export function DetalleMensajeroPanel({
  mensajeroId,
  mensajeroNombre,
  onCerrar,
}: DetalleMensajeroPanelProps) {
  // Cambiar de mensajero vuelve a la primera pagina: heredar la pagina 3 del anterior dejaria
  // el panel en blanco sobre un mensajero con dos ordenes, y eso se lee como un vacio.
  //
  // La pagina se guarda JUNTO al mensajero al que pertenece y se DERIVA en el render, en vez de
  // reiniciarse desde un efecto: un `setState` dentro de un efecto encadena un render de mas y,
  // durante ese render intermedio, el panel pediria la pagina vieja del mensajero nuevo.
  const [seleccion, setSeleccion] = useState<{ id: string | null; pagina: number }>({
    id: mensajeroId,
    pagina: 1,
  });
  const pagina = seleccion.id === mensajeroId ? seleccion.pagina : 1;
  const irAPagina = (siguiente: number) => setSeleccion({ id: mensajeroId, pagina: siguiente });

  // ⛔ R11 — clave `null` mientras no hay seleccion: SWR no dispara NADA. El tablero carga solo
  // los conteos, y el detalle se pide cuando el usuario abre una tarjeta, ni un instante antes.
  const { data, isLoading } = useSWR(
    mensajeroId ? (["tablero-dia:detalle", mensajeroId, pagina] as const) : null,
    () => leerDetalleMensajeroDia({ mensajeroId, pagina }),
  );

  // R13 — un `denegado` se pinta EXACTAMENTE igual que un detalle vacio. No es dejadez: el
  // servidor ya devuelve lo mismo en los tres casos malos, y una rama distinta aqui volveria a
  // abrir por la UI el canal que el borde cerro.
  const detalle = data?.estado === "ok" ? data.detalle : undefined;
  const ordenes: readonly OrdenDetalleDia[] = detalle?.ordenes ?? [];
  const cargando = mensajeroId !== null && isLoading;

  return (
    <Modal
      open={mensajeroId !== null}
      onOpenChange={(abierto: boolean) => {
        if (!abierto) onCerrar();
      }}
      title={
        mensajeroNombre ? <TituloConAvatar nombre={mensajeroNombre} /> : TITULO_GENERICO
      }
      description={
        // FEATURE 259 (T7.2) — R24/R25: «asignadas hoy» → «asignadas PARA hoy», con la misma
        // frase que el nombre accesible de la tarjeta desde la que se abre este panel. Las dos
        // cifras son la misma (R14) y no pueden describirse con criterios distintos.
        detalle
          ? `${detalle.total} ${detalle.total === 1 ? "orden asignada" : "órdenes asignadas"} para hoy`
          : TITULO_GENERICO
      }
      // R34 — es lectura, no una decision: no hay «Confirmar». La unica salida visible es
      // «Cerrar», que es la honesta.
      hideConfirm
      cancelLabel={CERRAR}
      size="xl"
    >
      {/*
        `min-w-0`: el envoltorio del PANEL, que es la caja que contiene a la tabla. Sin el, un
        contenedor flex se niega a encoger por debajo del ancho de su contenido (`min-width:
        auto`) y las 20 columnas empujarian el dialogo en vez de desplazarse dentro de su caja
        (R28). Va aqui y NUNCA en `Modal` ni en `DataTable`: una primitiva compartida no puede
        saber de esta pantalla.
      */}
      <div data-slot="detalle-mensajero-panel" className="flex min-w-0 flex-col gap-3">
        {/*
          R36 — con cero ordenes y sin carga en curso NO se monta `DataTable`: renderiza
          siempre un `<table>`, tambien vacio, y enseñar el esqueleto de una tabla que no
          existe es contar algo que no hay. El vacio es EXPLICITO y GENERICO: no dice cual de
          los tres casos malos ocurrio (R13).

          Mientras CARGA si se monta, con el `isLoading` de la propia primitiva: es UNA sola
          instancia de `DataTable` en este archivo y no dos, para que el estado de carga y el
          de datos no puedan divergir en columnas.
        */}
        {!cargando && ordenes.length === 0 ? (
          <div data-slot="detalle-mensajero-vacio">
            <EmptyState icon={Inbox} title={AVISO_SIN_ORDENES} />
          </div>
        ) : (
          <>
            {/*
              FEATURE 260 (R20/R29) — las columnas del listado de ordenes, montadas con el
              alcance QUE VINO DEL SERVIDOR, y la fila identificada por el id de la orden.
              Ni `renderExpanded`, ni `descarga`, ni `filtros`: las tres son acciones y esta
              es una vista de lectura (R21/R30).
            */}
            <DataTable
              columns={columnasDetalle(detalle?.alcance ?? ALCANCE_MIENTRAS_CARGA)}
              data={[...ordenes]}
              rowKey="id"
              isLoading={cargando}
              ariaLabel={cargando ? CARGANDO : TITULO_GENERICO}
            />

            {/*
              R12/R75 — el tamaño de pagina sale del DETALLE QUE DEVUELVE EL SERVIDOR, que a su
              vez lo toma de `ordenesConfig.DEFAULT_PAGE_SIZE`. Ni un literal numerico aqui:
              escribirlo seria una segunda fuente de verdad que se desincroniza el dia que
              alguien mueva `ORDENES_DEFAULT_PAGE_SIZE`.

              `compacta`: dentro de un dialogo con caja propia la barra es una fila mas. Aqui
              decia `sticky={false}` porque el modo pegajoso la sacaba de su caja; ese modo ya
              no existe (flotaba sobre las filas y se comia su clic).
            */}
            {cargando ? null : (
              <Pagination
                page={detalle?.pagina ?? pagina}
                pageSize={detalle?.pageSize ?? ordenes.length}
                total={detalle?.total ?? ordenes.length}
                onPageChange={irAPagina}
                compacta
              />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
