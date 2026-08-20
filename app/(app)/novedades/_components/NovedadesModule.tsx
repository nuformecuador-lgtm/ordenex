"use client";

import { useState } from "react";

import { DescargarDatasetButton } from "@/components/shared/DescargarDatasetButton";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import { Pagination } from "@/components/shared/Pagination";
import { useToast } from "@/hooks/useToast";
import {
  listarAyudaTiendaAction,
  listarAyudaTiendaCompletoAction,
  listarNovedadesAction,
  listarNovedadesCompletoAction,
  type ListarNovedadesActionResult,
  type ListarNovedadesCompletoActionResult,
} from "@/lib/actions/novedades";
import { CAUSA_DEVOLUCION_LABEL } from "@/app/(app)/mis-asignaciones/_components/causa-devolucion-options";
import { PosOrderCardDetalle } from "@/app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardDetalle";
import { PosOrderCardMosaico } from "@/app/(app)/mis-asignaciones/_components/pos-card/PosOrderCardMosaico";
import {
  VistaCardsToggle,
  type VistaCards,
} from "@/app/(app)/mis-asignaciones/_components/VistaCardsToggle";
import {
  CLASE_FASE,
  useTransicionVista,
} from "@/app/(app)/mis-asignaciones/_components/useTransicionVista";
import type { DescargaColumna, DescargaFila } from "@/lib/types/descarga";
import type { NovedadDTO } from "@/lib/types/novedad";
import { grupoDeEstatus, type GrupoNovedad } from "@/lib/types/novedad-grupo";

import { habilitarNovedad } from "@/lib/actions/habilitar-novedad";

import {
  COLUMNAS_DESCARGA_AYUDA,
  filaDescargaAyuda,
  TITULO_DESCARGA_AYUDA,
} from "./ayuda-descarga-columnas";
import { HabilitarNovedadModal } from "./HabilitarNovedadModal";
import { HiloNotasNovedadModal } from "./HiloNotasNovedadModal";
import { NovedadAcciones } from "./NovedadAcciones";
import { novedadAOrdenCard, SECCIONES_NOVEDAD } from "./novedad-a-orden-card";
import { TEXTOS_POR_GRUPO } from "./novedad-grupo-textos";
import {
  COLUMNAS_DESCARGA_NOVEDADES,
  filaDescargaNovedad,
  TITULO_DESCARGA_NOVEDADES,
} from "./novedades-descarga-columnas";
import { ReprogramarNovedadModal } from "./ReprogramarNovedadModal";

// Feature 87 (T12, design §3.2) — modulo cliente de `/novedades`. Recibe TODO por props
// desde el Server Component padre (que ya valido rol adminTienda y pre-fetch pagina 1, R18):
// componente PRIVADO (datos sensibles de la tienda por props, arquitectura §private). Al
// cambiar de pagina re-fetch por Server Action (lectura interna, NO fetch a /api; el telefono
// es PII), patron `MiWalletModule` (R22). Lista vacia -> estado vacio legible (R10).
//
// ⚠️ FEATURE 236 (T4.1/T4.2, design §5) — EL MISMO MODULO SIRVE A DOS PESTAÑAS, y por eso recibe
// `grupo`. Hasta el 2026-08-19 esta pantalla listaba DOS POBLACIONES bajo UNA sola pestaña, porque
// el predicado del servidor era un `OR` de dos igualdades de estado y aqui se pintaban seguidas:
// una orden sobre la que el mensajero pedia ayuda aparecia bajo «En devolución», bajo un subtitulo
// que no era cierto de ella. Ahora el corte lo hace el SERVIDOR (una accion por grupo) y este
// modulo se monta DOS VECES, una por pestaña.
//
//  - **No se duplico el componente**: lo que sabe hacer —conmutador de vista, paginacion, cards
//    POS, modales, descarga— es identico para los dos grupos. Lo unico que cambia son los ROTULOS
//    (`TEXTOS_POR_GRUPO`) y los RECURSOS de servidor (`RECURSOS_POR_GRUPO`), los dos indexados por
//    `GrupoNovedad` con `satisfies`: un grupo nuevo no compila hasta que alguien decida los suyos.
//  - **Este modulo NO PARTICIONA `items`** (R2/R8). Pinta lo que recibe, en el orden en que lo
//    recibe. La particion vive en el servidor o no vive: la 235 aprendio a la mala que un corte de
//    cliente deja la orden alcanzable por otras vias (era un `useMemo` y la orden seguia siendo
//    parada del optimizador, del mapa y del panel de gestion). Y el ORDEN tampoco se toca: la
//    pestaña de ayuda llega ya ascendente por fecha de solicitud (D7/R17), resuelta en el servicio.
//
// 2026-08-12 (pedido humano) — LA FILA YA NO SE PINTA AQUÍ. Cada novedad se muestra con las
// MISMAS cards que las órdenes del mensajero, y las acciones de esta pantalla bajan como un
// solo nodo por su prop `acciones` (`NovedadAcciones`). Lo que eso cambia y lo que no:
//
//  - NO cambia lo que se ve: guía (o su placeholder, R9), destinatario, el badge de la fila e
//    intentos (feature 160/R18/R19) siguen en pantalla, en los slots que la card ya tenía. El
//    badge viaja por la prop `estado` de la card, que acepta texto libre por diseño
//    (`pos-estado`: «cae a las clases de En reparto si es un texto libre»).
//  - NO cambia la estructura de la lista: sigue siendo `<ul>/<li>`, no un `DataTable`, que
//    es lo que la feature 160 (R26) verificó contra este componente. La card es un
//    `<article>` DENTRO de cada `<li>`.
//  - SÍ cambia de dónde sale el markup: de aquí a un componente compartido. Un cambio de
//    presentación en las cards del mensajero llega ahora también a esta pantalla, que es
//    exactamente lo que se pidió (una sola card, no dos que se parecen).
//
// 2026-08-13 (pedido humano) — LA VISTA LA ELIGE QUIEN MIRA. Entra el `VistaCardsToggle`, el
// MISMO conmutador de `RepartoModule`, `RecogerModule`, `RecoleccionModule` y
// `RecolectadasHoyLista`, con el mismo patrón de una línea (`Card = vista === "mosaico" ? …`)
// y la misma transición animada (`useTransicionVista`). Como en esas cuatro, la preferencia
// NO se persiste entre visitas: es estado de UI efímero de un solo consumidor, no sube a la
// URL ni a `localStorage`, y cada entrada a la pantalla arranca en "mosaico".
//
// 2026-08-13 (pedido humano) — LAS CUATRO SECCIONES, ENCENDIDAS. Lo pedido fue que estas
// cards muestren EXACTAMENTE lo mismo que las del mensajero en «En reparto»/«Entregas»: los
// datos del pedido, los de la entrega, los del cobro y el desplegable «Ver detalle completo».
// `NovedadDTO` pasó a EXTENDER `MiAsignacionDTO` (precedente literal de `RecoleccionOrdenDTO`)
// y con eso desaparecieron los diez rellenos del adaptador; `SECCIONES_NOVEDAD` quedó con las
// cuatro compuertas en `true`. Los dos cambios se hicieron JUNTOS a propósito: encender una
// sección sin su dato pinta relleno, y traer el dato sin encenderla no se ve.
//
//  ⚠️ LAS CARDS SON PARALELAS, NO VARIANTES. `PosOrderCard`, `PosOrderCardMosaico` y
//  `PosOrderCardDetalle` no se envuelven entre sí: sólo comparten `PosOrderCardProps`.
//  Conmutar de vista no es cambiar el tamaño de una card, es montar OTRO componente, y una
//  compuerta encendida en uno NO está encendida en el otro. Auditoría card por card, leída en
//  el código de las dos cards que esta pantalla monta (no supuesta):
//
//   · `navegacion: true` — MOSAICO: pinta el bloque de ubicación sobre navy
//     (`UbicacionTrigger`, "Ver en el mapa la ruta hasta …") con cantón · distrito y la
//     dirección debajo. DETALLE: pinta DOS cosas, el botón brand de navegar ("Ver en el mapa
//     la ubicación de …") Y la LÍNEA de ubicación "cantón · distrito — dirección"; esa línea
//     está dentro de la misma compuerta por decisión de la feature 199. Su fallback "Sin
//     dirección" —texto exclusivo de esa card— sigue sin ser alcanzable, pero ahora por el
//     motivo contrario que antes: no porque la línea esté apagada, sino porque `cantonNombre`
//     es NOT NULL y la línea nunca queda vacía. Y navegar FUNCIONA: con `latitud`/`longitud`
//     el trigger abre el minimapa, y sin ellas cae al enlace de Maps por texto (`mapsNavUrl`
//     con dirección + distrito + cantón + provincia). No hay botón que no lleve a ningún
//     sitio.
//   · `cobro: true` — las dos lo pintan ("Cobrar" + `formatMonto(montoCobrar)`). El monto es
//     el REAL de la orden: lo que se IBA a cobrar en la entrega que no se completó, que es
//     justo lo que la tienda necesita ver junto a la novedad. `montoCobrar` es
//     `number | null`: sin monto la card pinta la raya larga, no un "₡0" inventado.
//   · `detalle: true` — MOSAICO: monta el `Collapsible` "Ver detalle completo" con
//     `AsignacionDetalle` dentro (Pedido / Entrega / Cobro), hoy con dato real en las tres.
//     DETALLE: INERTE, y sigue siéndolo — se releyó `PosOrderCardDetalle` y ni siquiera
//     desestructura `detalle` de `seccionesVisibles()`; esa vista es una fila y nunca tuvo
//     desplegable. Así que esta compuerta es load-bearing en UNA sola de las dos cards, y el
//     test que la ejerce tiene que decir en cuál (la mosaico lo muestra, la de fila no).
//   · `intentos: true` — las dos lo pintan, con el dato real del DTO. En la mosaico aparece
//     además DENTRO del desplegable, como un campo más de "Entrega".
//
// El adaptador ya casi no adapta: `novedad-a-orden-card` es un spread más el identificador
// visible (la guía ocupa el slot de `numRemision`, R9). Ese archivo explica el porqué de las
// cuatro compuertas; no se apaga ni se enciende una sección sin leerlo.

/**
 * Lo que cada pestaña necesita DEL SERVIDOR, indexado por grupo.
 *
 * Son DOS Server Actions por grupo y no una con bandera, y esa es una decision del borde (design
 * §4): si el cliente eligiera el grupo, estaria eligiendo QUE ESTATUS SE CONSULTA. Aqui se elige a
 * que funcion se llama, no que filtra.
 *
 * La DESCARGA va en la misma tabla porque D3 la ata a la pestaña: «el archivo publica lo que la
 * pantalla enseña». El de ayuda tiene sus columnas propias —sin «Causa de devolución», que sobre
 * una orden que nunca se devolvio decia «Sin causa registrada» y eso es una afirmacion falsa con
 * formato de dato (R26/R39)—.
 */
interface RecursosGrupoNovedad {
  listarPagina: (input: { page: number }) => Promise<ListarNovedadesActionResult>;
  listarCompleto: () => Promise<ListarNovedadesCompletoActionResult>;
  tituloDescarga: string;
  columnasDescarga: DescargaColumna[];
  filaDescarga: (novedad: NovedadDTO) => DescargaFila;
}

const RECURSOS_POR_GRUPO = {
  ayuda: {
    listarPagina: listarAyudaTiendaAction,
    listarCompleto: listarAyudaTiendaCompletoAction,
    tituloDescarga: TITULO_DESCARGA_AYUDA,
    columnasDescarga: COLUMNAS_DESCARGA_AYUDA,
    filaDescarga: filaDescargaAyuda,
  },
  devolucion: {
    listarPagina: listarNovedadesAction,
    listarCompleto: listarNovedadesCompletoAction,
    tituloDescarga: TITULO_DESCARGA_NOVEDADES,
    columnasDescarga: COLUMNAS_DESCARGA_NOVEDADES,
    filaDescarga: filaDescargaNovedad,
  },
} as const satisfies Record<GrupoNovedad, RecursosGrupoNovedad>;

export interface NovedadesModuleProps {
  /**
   * Por que esta orden esta en la pantalla. **Obligatorio y sin default**: un olvido de cableado
   * tiene que romper el typecheck, no montar una pestaña con los rotulos y la descarga de la otra.
   * Mismo criterio que el `grupo` del servicio y del repositorio (design §9).
   */
  grupo: GrupoNovedad;
  items: NovedadDTO[];
  total: number;
  page: number;
  pageSize: number;
}

/** Etiqueta ES de la causa; NUNCA el slug crudo del enum (R11). `null` -> "Sin causa registrada" (R7). */
function causaLabel(causa: NovedadDTO["causa"]): string {
  return causa ? CAUSA_DEVOLUCION_LABEL[causa] : "Sin causa registrada";
}

/**
 * El badge de la card. Lo decide **el grupo de la FILA**, no el de la pestaña: este modulo pinta lo
 * que recibe y no filtra nada (R2), asi que el chip tiene que describir la orden que tiene delante.
 *
 * FEATURE 236 (T5.4, R26 — D6 firmada el 2026-08-19). Hasta hoy una orden en ayuda mostraba
 * «Ayuda solicitada» o, si arrastraba una causa, «Ayuda · \<causa\>». Las dos cosas cambian:
 *
 *  - el texto pasa a **«Esperando tu respuesta»**, porque dentro de una pestaña que ya se llama
 *    «Ayuda solicitada» repetirlo en cada card no informa;
 *  - y la CAUSA desaparece de esa rama. Era un ARRASTRE: venia de una devolucion ANTERIOR ya
 *    deshecha y no describe por que esa orden esta en la pantalla. R26 prohibe atribuirsela,
 *    mostrarla **y anunciar su ausencia**, asi que tampoco cae a «Sin causa registrada».
 *
 * Para la devolucion no cambia nada: su señal sigue siendo la causa, que es lo unico que distingue
 * una devolucion de otra en la lista (R7/R11 de la 87).
 */
function badgeNovedad(novedad: NovedadDTO): string {
  const grupo = grupoDeEstatus(novedad.estatusValue);
  const chipFijo = grupo ? TEXTOS_POR_GRUPO[grupo].chipFijo : null;
  return chipFijo ?? causaLabel(novedad.causa);
}

export function NovedadesModule({
  grupo,
  items: initialItems,
  total: initialTotal,
  page: initialPage,
  pageSize,
}: NovedadesModuleProps) {
  const toast = useToast();
  const textos = TEXTOS_POR_GRUPO[grupo];
  const recursos = RECURSOS_POR_GRUPO[grupo];

  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [loading, setLoading] = useState(false);
  // Feature 100 (T3.1): orden con el modal de reprogramación abierto (null = cerrado).
  const [ordenAReprogramar, setOrdenAReprogramar] = useState<NovedadDTO | null>(
    null,
  );
  // 2026-08-12: lo mismo para "Habilitar", que pide una nota antes de confirmar. Dos
  // estados y no uno con discriminante: son dos modales distintos, y fundirlos obligaría a
  // preguntar cuál está abierto en cada render para nada.
  const [ordenAHabilitar, setOrdenAHabilitar] = useState<NovedadDTO | null>(null);
  // Feature 227 (T3.3) / feature 236 (T6.1, R27/R29): orden con el HILO de notas abierto
  // (null = cerrado). Mismo patrón que los dos modales de arriba, por el mismo motivo: el hilo se
  // pide al abrir UNA orden y NUNCA para la lista — seria una consulta por orden de la pagina
  // (N+1), y el contrato de `lib/types/novedad.ts` lo prohibe con esas palabras.
  const [ordenConHilo, setOrdenConHilo] = useState<NovedadDTO | null>(null);

  // 2026-08-13: mismo conmutador y misma transición que las cuatro pantallas del portal del
  // mensajero, sobre las MISMAS piezas. `vista` es la que toca RENDERIZAR (el hook sostiene
  // la vieja durante el tramo de salida) y `vistaPedida` la que el control refleja al
  // instante, para que pulsarlo no parezca que no respondió.
  const {
    vista: vistaCards,
    vistaPedida: vistaCardsPedida,
    fase: faseVista,
    cambiarVista,
  } = useTransicionVista<VistaCards>("mosaico");

  /**
   * MAQUETA (2026-08-12): "Rechazar" (rotulado "Devolver" hasta 2026-08-19) está en la fila
   * pero todavía no hace nada — su comportamiento no está decidido y no existe en el backend;
   * lo cablea la ficha 240. Avisa por toast en vez de callar: un botón que no responde se lee
   * como una app rota, y el usuario de esta pantalla es una tienda, no quien pidió la
   * maqueta. El día que se cablee, este handler desaparece.
   */
  function avisarNoDisponible() {
    toast.info("Esta acción todavía no está disponible.");
  }

  /**
   * «Habilitar»: publica la nota obligatoria en el hilo de la orden y **devuelve la orden a la
   * ruta** por el punto único de rescate de la 235 (`ayuda_tienda → en_reparto`).
   *
   * ⚠️ FEATURE 236 (T5.5, D8 firmada por el humano el 2026-08-19 — R24/R25) — LA PANTALLA DEJA DE
   * AFIRMAR QUE HABILITÓ CUANDO NO MOVIÓ NADA.
   *
   * **Qué pasaba.** El resultado que se leía aquí es el de la NOTA, no el del rescate. Si el
   * mensajero recuperaba la orden un segundo antes, la tienda publicaba su nota, la fila
   * **desaparecía** de la pantalla y el aviso decía «Orden habilitada» — sobre una orden que nadie
   * movió. Al recargar, volvía, y nada lo explicaba. Es la carrera poco frecuente, sí, pero la
   * pantalla afirmaba algo falso, que es justo lo que esta ficha corrige en los otros dos sitios
   * (el subtítulo y la pestaña).
   *
   * **Qué se hace ahora.** El resultado trae `rescatada`, y los dos desenlaces se dicen distinto:
   *
   *  - `rescatada: true` → la orden volvió a la ruta: sale de la lista y el total baja (R24).
   *  - `rescatada: false` → la nota SÍ se publicó (quedó en el hilo, no se perdió) pero la orden no
   *    se movió, así que **la fila se queda donde está** y el aviso lo dice. Quitarla mientras se
   *    afirma que no se movió sería sustituir una mentira por otra.
   *
   * El modal se cierra al confirmar y no al resolver: la acción ya validó la nota, y dejarlo
   * abierto invitaría a un segundo clic que publicaría una segunda nota.
   */
  async function habilitar(nota: string) {
    const orden = ordenAHabilitar;
    if (!orden) return;
    setOrdenAHabilitar(null);
    const res = await habilitarNovedad({ ordenId: orden.id, nota });
    if (res.status === "ok") {
      if (res.rescatada) {
        setItems((prev) => prev.filter((n) => n.id !== orden.id));
        setTotal((prev) => Math.max(0, prev - 1));
        toast.success("La orden volvió a la ruta.");
        return;
      }
      toast.warning(
        "Tu nota se publicó, pero la orden no volvió a la ruta: puede que el mensajero ya la haya recuperado. Actualizá la pantalla.",
      );
      return;
    }
    // `forbidden` es opaco a propósito (hereda el del hilo): no se traduce a un motivo
    // concreto porque el servidor no dice cuál es, y adivinarlo aquí sería inventarlo.
    toast.error("No se pudo habilitar la orden.");
  }

  /** T3.1: tras reprogramar con éxito la orden sale de `devuelta` -> se quita de la lista. */
  function handleReprogramada(ordenId: string) {
    setItems((prev) => prev.filter((n) => n.id !== ordenId));
    setTotal((prev) => Math.max(0, prev - 1));
  }

  /** Re-fetch de la pagina pedida por Server Action (R22). Errores -> toast, sin romper. */
  async function cambiarPagina(nextPage: number) {
    setLoading(true);
    try {
      const res = await recursos.listarPagina({ page: nextPage });
      if (res.status !== "ok") {
        if (res.status === "forbidden") {
          toast.error("No tenés permiso para ver las novedades.");
        } else if (res.status === "unauthenticated") {
          toast.error("Tu sesión expiró. Iniciá sesión de nuevo.");
        } else {
          toast.error("No se pudo cargar la página. Intentá de nuevo.");
        }
        return;
      }
      setItems(res.items);
      setTotal(res.total);
      setPage(res.page);
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    // R10/R16: estado vacio CON TEXTO en vez de una lista sin filas. No es un caso marginal: con
    // `ayuda_tienda` = 0 y `devuelta` = 0 medidos en produccion el 2026-08-19, es el PRIMER estado
    // que la tienda va a conocer, y durante un tiempo el unico. Dice que aparecera ahi y cuando.
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center"
        role="status"
      >
        <p className="text-base font-medium text-foreground">{textos.vacioTitulo}</p>
        <p className="text-sm text-muted-foreground">{textos.vacioDetalle}</p>
      </div>
    );
  }

  // El patrón de una línea que ya está escrito cuatro veces en el repo (`RepartoModule`,
  // `RecogerModule`, `RecoleccionModule`, `RecolectadasHoyLista`): las dos cards comparten
  // `PosOrderCardProps`, así que la vista se elige con el COMPONENTE y nada más cambia — las
  // mismas props, el mismo adaptador, el mismo panel de `acciones`.
  const CardVista =
    vistaCards === "mosaico" ? PosOrderCardMosaico : PosOrderCardDetalle;

  return (
    <div className="flex flex-col gap-4">
      {/* Conmutador en la cabecera de la lista, alineado a la derecha como en las cuatro
          pantallas hermanas. NO lleva al lado el conteo `role="status"` que ellas ponen:
          aquí ese dato ya lo dice la `Pagination` del pie ("11-20 de 25"), y repetirlo
          serían dos cifras que pueden contradecirse (la página vs. el total). */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* 2026-08-14 (pedido humano) — LA DESCARGA, COMO EN LOS DEMÁS LISTADOS. Esta pantalla
            no monta un `DataTable` (son cards), así que el control no llega heredado: se monta
            aquí el MISMO `DescargarDatasetButton` que la tabla antepone, con el MISMO adaptador
            (`filasDesdeResultado`) y el mismo contrato. Lo que descarga es el LISTADO ENTERO, no
            la página visible: por eso llama a una lectura dedicada y no proyecta `items`, que
            son las diez de la página. El tope de filas lo evalúa el SERVIDOR y el mensaje del
            límite —con total y tope— lo redacta el adaptador común, no esta pantalla.

            Feature 236 (D3/R37): UNA DESCARGA POR PESTAÑA. El título, las columnas y la lectura
            salen de `RECURSOS_POR_GRUPO`, así que el archivo publica exactamente lo que su
            pestaña enseña — el de ayuda sin la columna de causa (R39). */}
        <DescargarDatasetButton
          titulo={recursos.tituloDescarga}
          columnas={recursos.columnasDescarga}
          obtenerFilas={() =>
            filasDesdeResultado(recursos.listarCompleto(), recursos.filaDescarga)
          }
          // Sin `formatos`: descarga DIRECTA en xlsx, como las ~27 tablas de la app. El menú de
          // elección lo montan solo los dos exports de analítica, que sí declaran varios.
        />
        <VistaCardsToggle vista={vistaCardsPedida} onVistaChange={cambiarVista} />
      </div>

      {/* La lista es `<ul>/<li>` en LAS DOS vistas, y ahí esta pantalla se aparta a
          propósito de las hermanas: ellas envuelven el mosaico en un `CarruselCards`, que
          pinta `CarouselItem` (divs) en vez de `<li>`. Aquí eso rompería dos cosas a la vez
          —la estructura de lista que la feature 160 (R26) verificó contra este componente, y
          la convivencia con la `Pagination`, que ya parte los datos en páginas: un carrusel
          dentro de una página paginada son dos mandos para el mismo avance—. Lo que cambia
          entre vistas es la DISPOSICIÓN: grilla para las cards compactas, columna para las
          filas. La clase de fase anima la lista entera como bloque. */}
      <ul
        aria-label={textos.listaAriaLabel}
        className={`${
          vistaCards === "mosaico"
            ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            : "flex flex-col gap-3"
        } ${CLASE_FASE[faseVista]}`}
      >
        {items.map((novedad) => (
          <li key={novedad.id}>
            <CardVista
              orden={novedadAOrdenCard(novedad)}
              // `total` alimenta el "parada N de total" de la cabecera, que aquí no se
              // pinta (`mostrarRuta={false}`). Se pasa el tamaño de la página porque es el
              // dato honesto que esta pantalla tiene, no un cero de relleno.
              total={items.length}
              // El badge lo decide el GRUPO DE LA FILA (ver `badgeNovedad`). No hay estado de
              // reparto que anunciar: lo que la tienda necesita saber de un vistazo es por qué
              // esa orden está en su pantalla.
              estado={badgeNovedad(novedad)}
              // Sin `onGestionar`: de aquí no se gestiona nada, así que la card es de
              // solo-visualización — no clickeable ni enfocable (ver `pos-seleccion`).
              mostrarRuta={false}
              secciones={SECCIONES_NOVEDAD}
              // Las acciones de esta pantalla, como UN nodo (pedido humano). Las dos cards les
              // hacen sitio al pie —la de detalle tras un borde punteado, la de mosaico a
              // hueso— y ninguna sabe qué son, así que el panel no cambia al conmutar de vista.
              // CUÁLES son lo decide `ACCIONES_POR_GRUPO`, no este JSX.
              acciones={
                <NovedadAcciones
                  novedad={novedad}
                  onReprogramar={setOrdenAReprogramar}
                  onHabilitar={setOrdenAHabilitar}
                  onDevolver={avisarNoDisponible}
                  onConversacion={setOrdenConHilo}
                />
              }
            />
          </li>
        ))}
      </ul>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={cambiarPagina}
        disabled={loading}
        ariaLabel={textos.paginacionAriaLabel}
      />

      {/* T3.1/T3.2: modal de reprogramación (fecha + motivo opcional). Montado SOLO
          con orden activa y con `key`, para arrancar fresco en cada apertura. */}
      {ordenAReprogramar ? (
        <ReprogramarNovedadModal
          key={ordenAReprogramar.id}
          orden={ordenAReprogramar}
          onOpenChange={(open) => {
            if (!open) setOrdenAReprogramar(null);
          }}
          onReprogramada={handleReprogramada}
        />
      ) : null}

      {/* 2026-08-12: modal de "Habilitar" (nota obligatoria). Mismo montaje condicional y
          misma `key` que el de reprogramar: la nota arranca vacía en cada apertura sin que
          nadie tenga que limpiarla. */}
      {ordenAHabilitar ? (
        <HabilitarNovedadModal
          key={ordenAHabilitar.id}
          orden={ordenAHabilitar}
          onOpenChange={(open) => {
            if (!open) setOrdenAHabilitar(null);
          }}
          onConfirmar={(nota) => void habilitar(nota)}
        />
      ) : null}

      {/* Feature 236 (T6.1, R27/R29) — EL HILO DE LA ORDEN, repuesto. Mismo montaje condicional y
          misma `key` que los dos de arriba, y por el mismo motivo elevado a requisito: con el modal
          cerrado el hilo NO ESTÁ EN EL ÁRBOL, así que listar una página no lo lee ni una vez
          (R29), y `key={orden.id}` hace que la lectura arranque fresca en cada apertura.

          Es el MISMO gesto que el lado mensajero (`RepartoModule` monta `HiloNotasAyudaModal`
          desde su card), y es deliberado: las dos pantallas dicen lo mismo con el mismo gesto
          (R36). No se escribió ningún hilo nuevo — el modal estaba entero en disco desde que el
          2026-08-18 se retiró el botón «Notas» y con él su único montaje. */}
      {ordenConHilo ? (
        <HiloNotasNovedadModal
          key={ordenConHilo.id}
          orden={ordenConHilo}
          onOpenChange={(open) => {
            if (!open) setOrdenConHilo(null);
          }}
        />
      ) : null}
    </div>
  );
}
