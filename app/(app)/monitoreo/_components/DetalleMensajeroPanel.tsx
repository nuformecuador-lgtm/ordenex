"use client";

// Feature 192 (F6.1/F6.2/F6.5, design.md §7.3, R47–R52 y R62/R63) — EL DETALLE de un mensajero.
//
// Panel lateral sobre el tablero (`components/ui/sheet`), no una ruta propia: así el tablero no
// se desmonta al abrirlo, el ciclo de SWR y las tarjetas ya cargadas siguen vivos, y al cerrar
// no hay recarga (R50, alternativa 12). Lo que hace la vista enlazable es el parámetro de la
// URL, que lo gestiona el módulo padre.
//
// ─── LO QUE SE REUTILIZA Y LO QUE NO (R48, design.md §7.3) ────────────────────────────────
//
// Se reutiliza el VOCABULARIO VISUAL del estatus: `EstatusBadge` y `estatusLabel` del listado
// de órdenes. **Aquí no se declara ni un mapa de estatus → etiqueta ni un color de estatus**:
// una segunda declaración divergiría en silencio y la misma orden se leería distinta en dos
// pantallas.
//
// NO se monta `OrdenesListado` (alternativa 11): es un contenedor de 11 props de negocio
// —acciones por lote, carga masiva, escáner QR, catálogos de filtros, historial— atado a
// `/ordenes`. Traería acciones que el tablero no debe ofrecer. Lo que se copia es el LAYOUT:
// las mismas primitivas de tabla y la misma paginación.
//
// ─── EL PARÁMETRO DE LA URL NO ES UNA AUTORIZACIÓN (R62/R63) ─────────────────────────────
//
// Un enlace compartido se abre con otra sesión. Por eso el detalle se le pide SIEMPRE a la
// Server Action, que vuelve a resolver el alcance del actor (R40). Y por eso los tres casos
// malos —id inexistente, mensajero de otra zona, mensajero sin órdenes hoy— muestran el MISMO
// aviso genérico y el mismo panel vacío: distinguirlos ("ese mensajero no es de tu zona")
// confirmaría la existencia de un usuario ajeno.

import { useState } from "react";
import useSWR from "swr";

import { EstatusBadge } from "@/app/(app)/ordenes/_components/EstatusBadge";
import { estatusLabel } from "@/app/(app)/ordenes/_components/estatus-label";
import { Pagination } from "@/components/shared/Pagination";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { leerDetalleMensajeroDia } from "@/lib/actions/tablero-dia";
import type { OrdenDetalleDia } from "@/lib/types/tablero-dia";

const TITULO_GENERICO = "Órdenes del día";
const SIN_DATO = "—";

/**
 * R49 — las columnas del detalle, y NINGUNA más. La lista está aquí, en un sitio, para que
 * añadir una sea un cambio visible y no un `<td>` colado en el cuerpo de la tabla: el humano
 * cerró el alcance en estas cuatro (nada de hora de la última gestión, monto recaudado ni
 * motivo de reprogramación; ampliarlo después es aditivo).
 */
const COLUMNAS = [
  { id: "guia", etiqueta: "Nº Guía" },
  { id: "estatus", etiqueta: "Estado" },
  { id: "resultado", etiqueta: "Resultado del día" },
  { id: "cliente", etiqueta: "Cliente / destino" },
] as const;

/**
 * R63 — EL aviso. Uno solo, idéntico para los tres casos malos, y sin eco del id recibido: el
 * texto no puede depender de cuál ocurrió, porque saber cuál ocurrió es la fuga.
 */
const AVISO_SIN_ORDENES = "No hay órdenes que mostrar para esta selección de hoy.";

const CARGANDO = "Cargando el detalle del mensajero";

/** R48 — la etiqueta del resultado del día sale del MISMO mapa que el resto de la aplicación. */
function resultadoLegible(resultado: OrdenDetalleDia["resultadoDelDia"]): string {
  // Los cinco valores de `gestion_resultado` existen también como values del catálogo de
  // estatus (`entregada`, `reprogramada`, `devuelta`, `rechazada`, `incidente`), así que
  // `estatusLabel` los traduce sin declarar un segundo mapa; y su fallback ya resuelve el
  // `null` como "—" y un valor desconocido como el value crudo.
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

export interface DetalleMensajeroPanelProps {
  /** `null` = panel cerrado. R56: sin id NO se consulta nada. */
  readonly mensajeroId: string | null;
  /** Nombre de la tarjeta desde la que se abrió; ausente cuando el id llegó por la URL. */
  readonly mensajeroNombre?: string;
  readonly onCerrar: () => void;
}

export function DetalleMensajeroPanel({
  mensajeroId,
  mensajeroNombre,
  onCerrar,
}: DetalleMensajeroPanelProps) {
  // Cambiar de mensajero vuelve a la primera página: heredar la página 3 del anterior dejaría
  // el panel en blanco sobre un mensajero con dos órdenes, y eso se lee como un vacío.
  //
  // La página se guarda JUNTO al mensajero al que pertenece y se DERIVA en el render, en vez de
  // reiniciarse desde un efecto: un `setState` dentro de un efecto encadena un render de más y,
  // durante ese render intermedio, el panel pediría la página vieja del mensajero nuevo.
  const [seleccion, setSeleccion] = useState<{ id: string | null; pagina: number }>({
    id: mensajeroId,
    pagina: 1,
  });
  const pagina = seleccion.id === mensajeroId ? seleccion.pagina : 1;
  const irAPagina = (siguiente: number) => setSeleccion({ id: mensajeroId, pagina: siguiente });

  // ⛔ R56 — clave `null` mientras no hay selección: SWR no dispara NADA. El tablero carga sólo
  // los conteos, y el detalle se pide cuando el usuario abre una tarjeta, ni un instante antes.
  const { data, isLoading } = useSWR(
    mensajeroId ? (["tablero-dia:detalle", mensajeroId, pagina] as const) : null,
    () => leerDetalleMensajeroDia({ mensajeroId, pagina }),
  );

  // R63 — un `denegado` se pinta EXACTAMENTE igual que un detalle vacío. No es dejadez: el
  // servidor ya devuelve lo mismo en los tres casos malos, y una rama distinta aquí volvería a
  // abrir por la UI el canal que el borde cerró.
  const detalle = data?.estado === "ok" ? data.detalle : undefined;
  const ordenes: readonly OrdenDetalleDia[] = detalle?.ordenes ?? [];
  const cargando = mensajeroId !== null && isLoading;

  return (
    <Sheet
      open={mensajeroId !== null}
      onOpenChange={(abierto: boolean) => {
        if (!abierto) onCerrar();
      }}
    >
      <SheetContent
        data-slot="detalle-mensajero-panel"
        side="right"
        className="w-full sm:max-w-2xl"
        aria-label={TITULO_GENERICO}
      >
        <SheetHeader className="pr-12">
          <SheetTitle>{mensajeroNombre ?? TITULO_GENERICO}</SheetTitle>
          <SheetDescription>
            {detalle
              ? `${detalle.total} ${detalle.total === 1 ? "orden asignada" : "órdenes asignadas"} hoy`
              : TITULO_GENERICO}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
          {cargando ? (
            <div role="status" aria-busy="true" aria-label={CARGANDO} className="flex flex-col gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : ordenes.length === 0 ? (
            /* R33/R63 — vacío EXPLÍCITO y genérico. No es un error, y no dice cuál de los tres
               casos ocurrió. */
            <p data-slot="detalle-mensajero-vacio" className="text-sm text-muted-foreground">
              {AVISO_SIN_ORDENES}
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    {COLUMNAS.map((columna) => (
                      <TableHead key={columna.id} scope="col">
                        {columna.etiqueta}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ordenes.map((orden) => (
                    <TableRow key={orden.ordenId} data-orden={orden.ordenId}>
                      <TableCell>{orden.numGuia ?? SIN_DATO}</TableCell>
                      <TableCell>
                        {/* R48 — el chip del listado, no uno nuevo. */}
                        <EstatusBadge value={orden.estatus} />
                      </TableCell>
                      <TableCell>{resultadoLegible(orden.resultadoDelDia)}</TableCell>
                      <TableCell className="whitespace-normal">
                        <ClienteDestino orden={orden} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Paginación como la del listado (R55). `sticky={false}`: dentro de un panel con
                  scroll propio, una barra pegada al viewport se saldría de su caja. */}
              <Pagination
                page={detalle?.pagina ?? pagina}
                pageSize={detalle?.pageSize ?? ordenes.length}
                total={detalle?.total ?? ordenes.length}
                onPageChange={irAPagina}
                sticky={false}
              />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
