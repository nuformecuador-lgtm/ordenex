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
// ─── LO QUE SE REUTILIZA Y LO QUE NO (R19/R37) ───────────────────────────────────────────
//
// Se reutiliza el VOCABULARIO VISUAL del estatus: `EstatusBadge` y `estatusLabel` del listado
// de ordenes. **Aqui no se declara ni un mapa de estatus → etiqueta ni un color de estatus**:
// una segunda declaracion divergiria en silencio y la misma orden se leeria distinta en dos
// pantallas.
//
// Y la tabla es `DataTable`, la unica del repo, sin `renderExpanded` (antepondria una columna
// con su `<th>` y rompería las CUATRO exactas de R35), sin `descarga` y sin `filtros` (dos
// acciones que este tablero no debe ofrecer).
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

import { EstatusBadge } from "@/app/(app)/ordenes/_components/EstatusBadge";
import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { Modal } from "@/components/shared/Modal";
import { Pagination } from "@/components/shared/Pagination";
import { leerDetalleMensajeroDia } from "@/lib/actions/tablero-dia";
import type { OrdenDetalleDia } from "@/lib/types/tablero-dia";

import { iniciales } from "./filtrar-mensajeros";

const TITULO_GENERICO = "Órdenes del día";
const SIN_DATO = "—";
const CERRAR = "Cerrar";

/**
 * R35 — las columnas del detalle, y NINGUNA mas. La lista esta aqui, en un sitio, para que
 * añadir una sea un cambio visible y no un `<td>` colado en el cuerpo de la tabla: el humano
 * cerro el alcance en estas cuatro (nada de hora de la ultima gestion, monto recaudado ni
 * motivo de reprogramacion; ampliarlo despues es aditivo).
 */
const COLUMNAS: Column<OrdenDetalleDia>[] = [
  { id: "guia", value: "Nº Guía", render: (orden) => orden.numGuia ?? SIN_DATO },
  // R37 — el chip del listado, no uno nuevo.
  { id: "estatus", value: "Estado", render: (orden) => <EstatusBadge value={orden.estatus} /> },
  {
    id: "resultado",
    value: "Resultado del día",
    render: (orden) => resultadoLegible(orden.resultadoDelDia),
  },
  {
    id: "cliente",
    value: "Cliente / destino",
    render: (orden) => <ClienteDestino orden={orden} />,
  },
];

/**
 * R13 — EL aviso. Uno solo, identico para los tres casos malos, y sin eco del id recibido: el
 * texto no puede depender de cual ocurrio, porque saber cual ocurrio es la fuga.
 */
const AVISO_SIN_ORDENES = "No hay órdenes que mostrar para esta selección de hoy.";

const CARGANDO = "Cargando el detalle del mensajero";

/** R19 — la etiqueta del resultado del dia sale del MISMO mapa que el resto de la aplicacion. */
function resultadoLegible(resultado: OrdenDetalleDia["resultadoDelDia"]): string {
  // Los cinco valores de `gestion_resultado` existen tambien como values del catalogo de
  // estatus, asi que `estatusLabel` los traduce sin declarar un segundo mapa; y su fallback ya
  // resuelve el `null` como "—" y un valor desconocido como el value crudo.
  return estatusLabel(resultado);
}

/** El cliente y su destino en una celda, como en el listado: son una sola idea. */
function ClienteDestino({ orden }: Readonly<{ orden: OrdenDetalleDia }>) {
  return (
    <div className="flex flex-col">
      <span>{orden.cliente || SIN_DATO}</span>
      <span className="text-xs text-muted-foreground">{orden.destino || SIN_DATO}</span>
    </div>
  );
}

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
      <div data-slot="detalle-mensajero-panel" className="flex flex-col gap-3">
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
            <DataTable
              columns={COLUMNAS}
              data={[...ordenes]}
              rowKey="ordenId"
              isLoading={cargando}
              ariaLabel={cargando ? CARGANDO : TITULO_GENERICO}
            />

            {/*
              R12/R75 — el tamaño de pagina sale del DETALLE QUE DEVUELVE EL SERVIDOR, que a su
              vez lo toma de `ordenesConfig.DEFAULT_PAGE_SIZE`. Ni un literal numerico aqui:
              escribirlo seria una segunda fuente de verdad que se desincroniza el dia que
              alguien mueva `ORDENES_DEFAULT_PAGE_SIZE`.

              `sticky={false}`: dentro de un dialogo con caja propia, una barra pegada al
              viewport se saldria de su caja.
            */}
            {cargando ? null : (
              <Pagination
                page={detalle?.pagina ?? pagina}
                pageSize={detalle?.pageSize ?? ordenes.length}
                total={detalle?.total ?? ordenes.length}
                onPageChange={irAPagina}
                sticky={false}
              />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
