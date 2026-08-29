"use client";

import { useState } from "react";

import { DescargarDatasetButton } from "@/components/shared/DescargarDatasetButton";
import { filasDesdeResultado } from "@/components/shared/descarga-resultado";
import { Pagination } from "@/components/shared/Pagination";
import { Button } from "@/components/ui/button";
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
// FICHA 312 (F2) — la correccion de los datos del cliente. La ventana la COMPARTE con el
// modulo de ordenes (vive alli, donde nace y donde esta su consumidor principal) y esta
// pantalla la importa, igual que `/recepcion-satelite` importa `ReportarIncidenteAccion`.
// El CABLE, en cambio, se ve aqui: la ventana no importa la Server Action, se la pasa la
// pantalla que ofrece el boton.
import { corregirDatosCliente } from "@/lib/actions/corregir-datos-cliente";
import { CorregirDatosClienteModal } from "@/app/(app)/ordenes/_components/CorregirDatosClienteModal";

import {
  COLUMNAS_DESCARGA_AYUDA,
  filaDescargaAyuda,
  TITULO_DESCARGA_AYUDA,
} from "./ayuda-descarga-columnas";
import {
  GestionarDesdeAyudaModal,
  GESTION_AYUDA_ERROR_FORBIDDEN,
  GESTION_AYUDA_ERROR_SESION,
  GESTION_AYUDA_EXITO,
  type DesenlaceGestionDesdeAyuda,
  type ModoGestionDesdeAyuda,
} from "./GestionarDesdeAyudaModal";
import { HabilitarNovedadModal } from "./HabilitarNovedadModal";
import { HiloNotasNovedadModal } from "./HiloNotasNovedadModal";
import { NovedadAcciones } from "./NovedadAcciones";
import { NovedadesFiltrosBarra } from "./NovedadesFiltrosBarra";
import { useNovedadesFiltro } from "./useNovedadesFiltro";
import { novedadAOrdenCard, SECCIONES_NOVEDAD } from "./novedad-a-orden-card";
import { TEXTOS_POR_GRUPO } from "./novedad-grupo-textos";
import {
  COLUMNAS_DESCARGA_NOVEDADES,
  filaDescargaNovedad,
  TITULO_DESCARGA_NOVEDADES,
} from "./novedades-descarga-columnas";
import {
  RechazarNovedadModal,
  RECHAZO_CONFLICTO,
  RECHAZO_ERROR_CONFIG,
  RECHAZO_ERROR_FORBIDDEN,
  RECHAZO_ERROR_NOT_FOUND,
  RECHAZO_ERROR_SESION,
  RECHAZO_SIN_GESTION_ORIGEN,
  RECHAZO_EXITO,
  type DesenlaceRechazo,
} from "./RechazarNovedadModal";
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
//
// FICHA 296 (2026-08-27) — EL MENSAJERO, QUE NO CABÍA EN LA CARD COMPARTIDA. La tienda veía aquí
// una orden pidiendo ayuda y no sabía a quién preguntarle. El hueco no era de esta pantalla: la
// card se comparte con el portal del mensajero y su `orden` es un `MiAsignacionDTO`, el contrato
// de ESE portal, donde el mensajero es quien mira y su nombre no informa de nada. Por eso el dato
// es campo PROPIO de `NovedadDTO` y llega a la card por una PROP nueva (`mensajero`), la misma vía
// por la que esta pantalla ya baja `estado`, `acciones`, `mostrarRuta` y `secciones`.
//
// La prop es opcional y su AUSENCIA es la compuerta: quien no la pasa —las tres pantallas del
// portal del mensajero— no pinta nada y no cambia ni un píxel. Se descartó una compuerta de
// `PosSecciones` porque esas APAGAN secciones donde falta el dato y no transportan valor, y se
// descartó meterlo en `MiAsignacionDTO` porque obligaría a las listas del mensajero a emitir un
// nombre que nadie lee.
//
// FICHA 325 (2026-08-28) — EL BUSCADOR Y LOS FILTROS, MONTADOS A MANO. Esta pantalla no monta un
// `DataTable` (son cards), así que la barra no le llega heredada como a los consumidores de la
// tabla: se monta aquí, igual que el `DescargarDatasetButton` de más abajo y por el mismo motivo.
// Son los MISMOS componentes de la casa, sin variantes (`BuscadorFiltros` + `FilterComponent`); lo
// específico de esta pantalla vive en `novedades-filtros.ts` y su estado en `useNovedadesFiltro`.
//
// LAS TRES COSAS QUE HAY QUE SABER ANTES DE TOCAR ESTA PARTE:
//
//  1. **SE FILTRA SOBRE EL CONJUNTO COMPLETO, NO SOBRE `items`.** `items` son DIEZ de `total`
//     (`PAGE_SIZE = 10` en `lib/actions/novedades.ts`, y la página sólo pre-carga la 1): filtrar lo
//     que se ve habría dicho «ninguna coincide» con la orden buscada esperando en la página 3. La
//     barra pide el listado entero con la lectura que YA existe (`listarCompleto`, la de la
//     descarga), la PRIMERA vez que alguien la usa. Sin tocar la barra, esta pantalla cuesta
//     exactamente lo que costaba ayer.
//  2. **CADA PESTAÑA TIENE SU BARRA.** El módulo se monta dos veces y cada instancia tiene su
//     propio hook, así que cambiar de pestaña no arrastra el filtro de la otra — que es el fallo a
//     evitar, y no uno teórico: «Causa de devolución» no existe en el grupo de ayuda (ahí la causa
//     es SIEMPRE `null` por R26), así que un filtro compartido habría vaciado la otra lista sin que
//     nada lo explicara.
//  3. **HAY DOS ESTADOS VACÍOS Y NO SE PUEDEN CONFUNDIR.** «No tenés órdenes en devolución» (R16)
//     es una afirmación sobre los DATOS; con la barra puesta esa frase sería falsa, así que ahí se
//     dice «ninguna coincide» y se ofrece limpiar. Un vacío que miente sobre su causa es peor que
//     no tener buscador.
//
// LO QUE ESTA FICHA **NO** TOCA, dicho aquí para que no se lea como un olvido: la DESCARGA sigue
// bajando el listado entero aunque la barra esté acotando. Cambiarlo significaría mover esta
// pantalla de `filasDesdeResultado` (familia A: el tope lo evalúa el servidor) a la familia B, y
// eso está vigilado por `tests/unit/descarga/adaptador-conjunto.guardia.test.ts` con su censo: es
// una decisión de arquitectura de la descarga, no del buscador.

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

/**
 * 💰 Feature 240 (T5.3, R31) — QUÉ SE LE DICE A LA TIENDA CUANDO EL RECHAZO NO SE APLICA, por
 * estado. `ok` y `conflict` NO están aquí: los dos tienen su propio camino en `resolverRechazo`
 * —uno quita la fila, el otro relee la página— y meterlos en una tabla de errores los haría
 * parecer lo que no son.
 *
 * Es una tabla y no un `switch` por la misma razón que `ACCIONES_POR_GRUPO`: el día que el
 * resultado del servicio gane un estado, el typecheck reclama su mensaje en vez de dejarlo caer en
 * el `default` en silencio.
 */
const MENSAJE_POR_FALLO_DEL_RECHAZO: Record<
  Exclude<DesenlaceRechazo["status"], "ok" | "conflict">,
  string
> = {
  forbidden: RECHAZO_ERROR_FORBIDDEN,
  not_found: RECHAZO_ERROR_NOT_FOUND,
  config_error: RECHAZO_ERROR_CONFIG,
  unauthenticated: RECHAZO_ERROR_SESION,
  // 2026-08-20: esta entrada NO se anadio por gusto — sin ella este `Record` NO COMPILA, que es
  // justo lo que el comentario de arriba promete. El estado nacio de un recorrido en el que la
  // tienda pulso «Rechazar» y no vio nada: la accion salia por `INTERNAL` y el borde lanzaba.
  sin_gestion_origen: RECHAZO_SIN_GESTION_ORIGEN,
};

/**
 * FICHA 325 — LOS TRES TEXTOS DE LA BÚSQUEDA. Exportados para que un test pueda afirmarlos sin
 * reescribir la cadena a mano, y agrupados aquí para que el día que esta app se traduzca no haya
 * que ir a buscarlos dentro del JSX.
 *
 * NO se reusa `TEXTOS_POR_GRUPO` porque estos NO dependen del grupo: «ninguna coincide» dice lo
 * mismo de una devolución que de una ayuda. Los de R16 sí dependen, y por eso viven allí.
 */
export const BUSCANDO = "Buscando entre todas tus órdenes de esta pestaña…";
export const SIN_COINCIDENCIAS_TITULO = "Ninguna orden coincide con lo que buscaste";
export const SIN_COINCIDENCIAS_DETALLE =
  "Probá con menos palabras, o quitá alguno de los filtros que tenés puestos.";
export const LIMPIAR_BUSQUEDA = "Limpiar la búsqueda";

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
  // Feature 237 (T7.3): la orden que la tienda está a punto de RESOLVER, con el desenlace elegido
  // (null = ventana cerrada). Va como UN estado con el modo dentro y no como dos estados: las dos
  // acciones abren la MISMA ventana y no pueden estar abiertas a la vez, así que dos estados
  // obligarían a preguntar cuál manda en cada render y admitirían el estado imposible «las dos».
  const [ordenAGestionarDesdeAyuda, setOrdenAGestionarDesdeAyuda] = useState<{
    orden: NovedadDTO;
    modo: ModoGestionDesdeAyuda;
  } | null>(null);
  // 💰 Feature 240 (T5.3): la orden que la tienda está a punto de RECHAZAR (null = ventana cerrada).
  // Mismo patrón que sus tres hermanos de arriba y por el mismo motivo: son ventanas distintas y no
  // pueden estar abiertas a la vez, así que un estado con discriminante sólo añadiría una pregunta
  // en cada render.
  const [ordenARechazar, setOrdenARechazar] = useState<NovedadDTO | null>(null);
  // FICHA 312 (F2, R23): la orden cuyos datos de cliente se están corrigiendo (null = ventana
  // cerrada). Mismo patrón que sus cuatro hermanas de arriba y por el mismo motivo: son ventanas
  // distintas que no pueden estar abiertas a la vez.
  //
  // UN SOLO estado para LOS DOS grupos, igual que la celda es una sola clave: corregir es la misma
  // operación en «ayuda» y en «devolución» (design §9.2).
  const [ordenACorregir, setOrdenACorregir] = useState<NovedadDTO | null>(null);

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

  // FICHA 325 — la barra de esta pestaña. UNA POR INSTANCIA del módulo: es lo que hace que el
  // filtro de un grupo no siga puesto al pasar al otro. Se le pasa la lectura del CONJUNTO ENTERO
  // del grupo (la misma que alimenta la descarga), que el hook sólo dispara cuando alguien usa la
  // barra.
  const filtro = useNovedadesFiltro(grupo, recursos.listarCompleto);

  /**
   * 💰 FEATURE 240 (T5.3, design §10.2 — R30/R31/R32) — LO QUE LA PANTALLA HACE CON EL RECHAZO.
   *
   * **Lo que había aquí hasta el 2026-08-20, y por qué se cuenta en vez de borrarlo:** un handler
   * llamado `avisarNoDisponible` que hacía `toast.info("Esta acción todavía no está disponible.")`
   * y se pasaba como `onDevolver`. Su propio JSDoc lo declaraba MAQUETA desde el 2026-08-12 y
   * terminaba diciendo «el día que se cablee, este handler desaparece». Este es ese día: desapareció.
   *
   * **`ok` y `conflict` se dicen DISTINTO** (R31). Un `conflict` significa que la orden dejó de
   * estar en la devolución anclada entre que la tienda abrió la ventana y pulsó —el cron de plazo
   * vencido la escaló, o la bodega la recuperó—, así que **no se escribió nada** y la pantalla no
   * puede afirmar que rechazó.
   *
   * **`ok` quita la fila y baja el total** (R30) por el MISMO camino que su hermana «Reprogramar»
   * (`sacarDeLaLista`): el servidor ya confirmó que la orden salió de la devolución, así que no
   * hay optimismo que corregir. **`conflict` RELEE la página** en vez de quitar nada: ahí la fila
   * desaparece —o se queda— por el dato, que es literalmente la lección de 236/D8 sobre esta misma
   * card.
   *
   * `forbidden` no se traduce a un motivo concreto: el borde no dice si la orden existe, en qué
   * estado está ni de quién es, así que adivinarlo aquí sería inventarlo.
   */
  async function resolverRechazo(res: DesenlaceRechazo) {
    const orden = ordenARechazar;
    if (!orden) return;
    setOrdenARechazar(null);
    if (res.status === "ok") {
      sacarDeLaLista(orden.id);
      toast.success(RECHAZO_EXITO);
      return;
    }
    if (res.status === "conflict") {
      toast.warning(RECHAZO_CONFLICTO);
      await releerListado();
      return;
    }
    toast.error(MENSAJE_POR_FALLO_DEL_RECHAZO[res.status]);
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
        // FICHA 325: y del conjunto que filtra la barra, que es OTRA copia de la misma lista. Sin
        // esto la fila desaparecería de la lista sin filtro y seguiría apareciendo con filtro.
        filtro.quitar(orden.id);
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

  /**
   * ⚠️ FEATURE 237 (T7.3/T7.4, design §12.3 — R25/R27) — LO QUE LA PANTALLA HACE CON EL DESENLACE.
   *
   * **Los dos caminos RECARGAN, y ésa es la decisión.** Ni el éxito ni la carrera perdida quitan la
   * fila con un `filter` de cliente: se relee la página de la pestaña por Server Action y la fila
   * desaparece —o se queda— **por el dato**. Es literalmente la lección de 236/D8 sobre esta misma
   * card: «Habilitar» quitaba la fila por optimismo y al recargar volvía, sin que nada lo
   * explicara. Y con la relectura el TOTAL baja de verdad (R27), en vez de un contador que se
   * decrementa a mano y puede desviarse del servidor.
   *
   * **`ok` y `conflict` se dicen DISTINTO** (R25): un `conflict` significa que la orden dejó de
   * estar en ayuda entre que la tienda abrió la ventana y pulsó —el mensajero la recuperó, o la
   * cortó la noche—, así que **no se creó ninguna gestión** y la pantalla no puede afirmar que
   * resolvió. El texto lo redacta el SERVIDOR (`MENSAJES_GESTION_DESDE_AYUDA`) y se muestra tal
   * cual: reescribirlo aquí serían dos verdades sobre la misma carrera.
   *
   * `forbidden` es OPACO a propósito (hereda el del hilo): el borde no dice si la orden existe, en
   * qué estado está ni de quién es, así que adivinar un motivo concreto aquí sería inventarlo.
   *
   * ⚠️ FEATURE 261 (F7, R32) — POR ESTE MISMO CABLE VIAJA UN SEGUNDO RECHAZO, y conviene saberlo
   * antes de «simplificar» esta rama: la orden reservada para un día de reparto posterior. El
   * servidor la rechaza en dos capas (261/R28-R31) y devuelve `conflict` con la MISMA frase que
   * lee el mensajero en su portal, nombrando el día desde el que se podrá. Aquí no hay nada que
   * añadir: se pinta tal cual, como el resto.
   *
   * ⚠️ Y EL BOTÓN NO SE DESHABILITA — es una decisión firmada, no un olvido (261/design §5.4,
   * alternativa A13). La asimetría con el mensajero tiene un motivo concreto: él está en la calle
   * con el paquete en la mano y enterarse al intentarlo le cuesta un viaje, así que su control va
   * apagado de antemano; la tienda está en un escritorio y el rechazo es instantáneo y explicado.
   * Deshabilitarlo aquí exigiría meter el día en `NovedadDTO` y derivar el booleano con un reloj
   * en el servicio de novedades —tipo compartido, consulta, derivación y tests— para una
   * población que se midió en 2 órdenes. Si alguien siente la tentación de «ya que estamos», es
   * alcance nuevo y se pregunta.
   */
  async function resolverDesdeAyuda(res: DesenlaceGestionDesdeAyuda) {
    const pendiente = ordenAGestionarDesdeAyuda;
    if (!pendiente) return;
    setOrdenAGestionarDesdeAyuda(null);
    if (res.status === "ok") {
      toast.success(GESTION_AYUDA_EXITO[pendiente.modo]);
      await releerListado();
      return;
    }
    if (res.status === "conflict") {
      toast.warning(res.motivo);
      await releerListado();
      return;
    }
    toast.error(
      res.status === "forbidden"
        ? GESTION_AYUDA_ERROR_FORBIDDEN
        : GESTION_AYUDA_ERROR_SESION,
    );
  }

  /**
   * FICHA 312 (F2, R29) — LO QUE LA PANTALLA HACE CUANDO LA CORRECCIÓN SE GUARDA.
   *
   * **Relee del SERVIDOR, no pinta lo tecleado.** R29 lo pide con esas palabras: los valores
   * nuevos salen de la relectura, nunca de un estado local optimista. Es además la lección de
   * 236/D8 sobre esta misma card, aplicada al caso fácil: si el servidor no guardó lo que la
   * pantalla cree, la fila lo dirá por el dato.
   *
   * **La fila NO desaparece**, y ahí se separa de sus cuatro hermanas: corregir un nombre no
   * cambia el estado de la orden, así que la novedad sigue en su grupo y en la lista. Por eso no
   * hay `sacarDeLaLista` aquí.
   *
   * **Y no se avisa a nadie ni se publica nada** (D4, decisión humana del 2026-08-28): corregir no
   * deja rastro. El único rastro es el `updated_at` de la fila.
   */
  async function trasCorregirDatos() {
    setOrdenACorregir(null);
    await releerListado();
  }

  /**
   * FICHA 325 — LA RELECTURA TRAS UNA MUTACIÓN, en sus DOS copias.
   *
   * Desde que la barra existe hay dos listas en memoria y las dos vienen del mismo predicado: la
   * PÁGINA visible (`items`, diez de `total`) y el CONJUNTO ENTERO que la barra filtra. Releer sólo
   * una dejaría a la pantalla afirmando dos cosas distintas de la misma orden según si hay filtro
   * puesto o no, que es justo el modo de fallo que 236/D8 midió sobre esta card.
   *
   * `filtro.recargar()` NO es una lectura nueva por sistema: si nadie ha usado la barra, el
   * conjunto no está cargado y no hace nada. Sólo lo llaman las relecturas que confirma el
   * servidor, nunca el simple cambio de página.
   */
  async function releerListado() {
    await cambiarPagina(page);
    await filtro.recargar();
  }

  /**
   * La orden salió de la devolución anclada: se quita de la lista y el total baja.
   *
   * Lo usan LAS DOS salidas que el servidor confirma sobre esta card —«Reprogramar» (feature 100) y
   * «Rechazar» (feature 240/R30)—, y por eso el nombre dice lo que hace y no cuál de las dos lo
   * pidió: hasta el 2026-08-20 se llamaba `handleReprogramada`, que dejó de ser cierto en cuanto
   * tuvo un segundo llamador.
   *
   * ⚠️ Sólo se usa cuando el servidor devolvió `ok`. Ahí no hay optimismo que corregir: la
   * transición ya ocurrió. La carrera perdida tiene otro camino (relee la página), porque quitar una
   * fila que sigue estando es la mentira que 236/D8 midió sobre esta misma card.
   */
  function sacarDeLaLista(ordenId: string) {
    setItems((prev) => prev.filter((n) => n.id !== ordenId));
    setTotal((prev) => Math.max(0, prev - 1));
    // FICHA 325: la orden sale también del conjunto que filtra la barra. Son DOS copias de la misma
    // lista; quitarla de una sola dejaría la fila viva bajo un filtro y muerta sin él.
    filtro.quitar(ordenId);
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

  // R10/R16: estado vacio CON TEXTO en vez de una lista sin filas. No es un caso marginal: con
  // `ayuda_tienda` = 0 y `devuelta` = 0 medidos en produccion el 2026-08-19, es el PRIMER estado
  // que la tienda va a conocer, y durante un tiempo el unico. Dice que aparecera ahi y cuando.
  //
  // FICHA 325 — `!filtro.barraEnUso` es la mitad que faltaba. Sin esa condición, buscar algo que
  // no está diría «No tenés órdenes en devolución» sobre una tienda que SÍ las tiene, y encima se
  // llevaría por delante la barra: el usuario se quedaría sin campo que borrar y sin forma de
  // volver. Con la barra en uso el vacío se decide más abajo, junto a la lista, y dice otra cosa.
  const vacioDeVerdad = items.length === 0 && !filtro.barraEnUso;
  const estadoVacio = (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center"
      role="status"
    >
      <p className="text-base font-medium text-foreground">{textos.vacioTitulo}</p>
      <p className="text-sm text-muted-foreground">{textos.vacioDetalle}</p>
    </div>
  );

  if (vacioDeVerdad) return estadoVacio;

  // El patrón de una línea que ya está escrito cuatro veces en el repo (`RepartoModule`,
  // `RecogerModule`, `RecoleccionModule`, `RecolectadasHoyLista`): las dos cards comparten
  // `PosOrderCardProps`, así que la vista se elige con el COMPONENTE y nada más cambia — las
  // mismas props, el mismo adaptador, el mismo panel de `acciones`.
  const CardVista =
    vistaCards === "mosaico" ? PosOrderCardMosaico : PosOrderCardDetalle;

  // FICHA 325 — QUÉ LISTA SE PINTA, y de dónde sale su paginación.
  //
  // `modoFiltrado` exige las DOS cosas: que la barra esté acotando algo Y que el conjunto entero
  // esté en memoria. Mientras el conjunto viaja —o si no pudo venir— NO se pinta la página del
  // servidor como si estuviera filtrada: eso sería enseñar diez órdenes cualesquiera bajo un
  // término de búsqueda, que es exactamente la mentira que esta ficha evita.
  const modoFiltrado = filtro.filtrando && filtro.estado === "listo";
  const desde = (filtro.pagina - 1) * pageSize;
  // La paginación del resultado filtrado es de CLIENTE y usa el MISMO `pageSize` que el servidor:
  // que la lista cambie de largo al escribir sería un segundo cambio que nadie pidió.
  const visibles = modoFiltrado
    ? filtro.resultados.slice(desde, desde + pageSize)
    : items;
  const esperandoConjunto = filtro.filtrando && filtro.estado === "cargando";

  return (
    <div className="flex flex-col gap-4">
      {/* FICHA 325 — LA BARRA, en su propia línea y por encima de todo lo demás: es lo primero que
          se toca al llegar con un dato en la mano. Va aquí y no dentro de la fila de la derecha
          porque ocupa el ancho completo (el campo no baja de 250px y los filtros pedidos se montan
          delante de él), y estrujarla contra dos botones la partiría en dos líneas siempre. */}
      <NovedadesFiltrosBarra
        filtro={filtro}
        label={textos.buscadorAriaLabel}
        regionLabel={textos.filtrosAriaLabel}
      />

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
          filas. La clase de fase anima la lista entera como bloque.

          FICHA 325 — TRES SALIDAS Y NO UNA, porque un vacío que no dice su causa se lee como una
          pantalla rota:
            · el conjunto viaja  → se dice que se está buscando, y NO se pinta la página del
              servidor bajo un término que todavía no la acotó;
            · la barra acota y no queda nada → «ninguna coincide», con la forma de deshacerlo al
              lado. Nunca el texto de R16, que afirmaría algo falso de los datos;
            · lo de siempre → la lista. */}
      {esperandoConjunto ? (
        <p
          role="status"
          className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center text-sm text-muted-foreground"
        >
          {BUSCANDO}
        </p>
      ) : visibles.length === 0 ? (
        modoFiltrado ? (
          <div
            className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center"
            role="status"
          >
            <p className="text-base font-medium text-foreground">{SIN_COINCIDENCIAS_TITULO}</p>
            <p className="text-sm text-muted-foreground">{SIN_COINCIDENCIAS_DETALLE}</p>
            <Button type="button" variant="outline" size="sm" onClick={filtro.limpiar}>
              {LIMPIAR_BUSQUEDA}
            </Button>
          </div>
        ) : (
          estadoVacio
        )
      ) : (
      <ul
        aria-label={textos.listaAriaLabel}
        className={`${
          vistaCards === "mosaico"
            ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            : "flex flex-col gap-3"
        } ${CLASE_FASE[faseVista]}`}
      >
        {visibles.map((novedad) => (
          <li key={novedad.id}>
            <CardVista
              orden={novedadAOrdenCard(novedad)}
              // `total` alimenta el "parada N de total" de la cabecera, que aquí no se
              // pinta (`mostrarRuta={false}`). Se pasa el tamaño de la página porque es el
              // dato honesto que esta pantalla tiene, no un cero de relleno.
              total={visibles.length}
              // El badge lo decide el GRUPO DE LA FILA (ver `badgeNovedad`). No hay estado de
              // reparto que anunciar: lo que la tienda necesita saber de un vistazo es por qué
              // esa orden está en su pantalla.
              estado={badgeNovedad(novedad)}
              // FICHA 296 — A QUIÉN PREGUNTARLE. Hasta hoy la tienda veía una orden pidiendo
              // ayuda y la card no nombraba a nadie. El dato es campo PROPIO de `NovedadDTO`
              // (no de `MiAsignacionDTO`, que es el contrato del portal del mensajero), así que
              // no viaja dentro de `orden`: se baja por su prop, igual que `estado` y
              // `acciones`. El portal del mensajero no pasa esta prop y por eso no cambia.
              //
              // Va en LOS DOS grupos, no sólo en el de ayuda: en `devolucion` este nombre es
              // quien trae el paquete de vuelta. Por eso está aquí, en el JSX común, y no
              // dentro de `RECURSOS_POR_GRUPO`.
              //
              // `null` (orden sin mensajero asignado) NO se filtra aquí: la card lo pinta en
              // palabras con su fuente única (`pos-mensajero`). Decidir el texto en esta
              // pantalla lo dejaría fuera de sincronía con las otras dos vistas.
              mensajero={novedad.mensajeroNombre}
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
                  onRechazar={setOrdenARechazar}
                  onConversacion={setOrdenConHilo}
                  onGestionarDesdeAyuda={(orden, modo) =>
                    setOrdenAGestionarDesdeAyuda({ orden, modo })
                  }
                  onCorregirDatos={setOrdenACorregir}
                />
              }
            />
          </li>
        ))}
      </ul>
      )}

      {/* FICHA 325 — con la barra acotando, la paginación es la DEL RESULTADO: su total es el
          número de coincidencias y avanzar no vuelve al servidor (el conjunto ya está aquí). Sin
          barra es la de siempre, byte por byte. Lo que NO cambia nunca es el `pageSize`. */}
      <Pagination
        page={modoFiltrado ? filtro.pagina : page}
        pageSize={pageSize}
        total={modoFiltrado ? filtro.resultados.length : total}
        onPageChange={modoFiltrado ? filtro.irAPagina : cambiarPagina}
        disabled={loading || esperandoConjunto}
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
          onReprogramada={sacarDeLaLista}
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

      {/* Feature 237 (T7.3) — LA VENTANA CON LA QUE LA TIENDA RESUELVE. Mismo montaje condicional
          y misma `key` que los tres de arriba, y aquí el motivo pesa más que en ellos: con la
          ventana cerrada NO ESTÁ EN EL ÁRBOL, así que ni el selector de fotos ni la fecha de
          mañana existen mientras se navega la lista, y `key={orden.id}` hace que el formulario
          arranque vacío en cada apertura — una foto o un motivo heredados de la orden anterior
          acabarían en la evidencia de un cobro que no les corresponde.

          `modo` NO va en la `key`: cambiar de desenlace sobre la MISMA orden (abrir «Rechazar»
          tras cerrar «Reprogramar») remonta igual porque el estado pasa por `null` al cerrarse. */}
      {/* 💰 Feature 240 (T5.3) — LA VENTANA DEL RECHAZO. Mismo montaje condicional y misma `key`
          que los cuatro de arriba, y aquí el motivo es de dinero: con la ventana cerrada NO ESTÁ EN
          EL ÁRBOL, y `key={orden.id}` hace que el motivo arranque vacío en cada apertura — un motivo
          heredado de la orden anterior acabaría explicando un cobro que no le corresponde. */}
      {ordenARechazar ? (
        <RechazarNovedadModal
          key={ordenARechazar.id}
          orden={ordenARechazar}
          onOpenChange={(open) => {
            if (!open) setOrdenARechazar(null);
          }}
          onResuelto={(res) => void resolverRechazo(res)}
        />
      ) : null}

      {/* FICHA 312 (F2, R23/R26) — LA VENTANA DE LA CORRECCIÓN, la MISMA que el módulo de órdenes.
          Mismo montaje condicional y misma `key` que las cuatro de arriba: con la ventana cerrada
          NO ESTÁ EN EL ÁRBOL, y `key={orden.id}` hace que los cuatro campos arranquen precargados
          con los de ESTA orden en cada apertura, sin heredar el borrador de la anterior.

          `corregir` es el cable de esta pantalla: la ventana es compartida y no importa la Server
          Action, así que cada superficie enseña la suya (ver `EnviarCorreccion`). */}
      {ordenACorregir ? (
        <CorregirDatosClienteModal
          key={ordenACorregir.id}
          open
          orden={ordenACorregir}
          onOpenChange={(open) => {
            if (!open) setOrdenACorregir(null);
          }}
          corregir={(entrada) => corregirDatosCliente(entrada)}
          onSuccess={() => void trasCorregirDatos()}
        />
      ) : null}

      {ordenAGestionarDesdeAyuda ? (
        <GestionarDesdeAyudaModal
          key={ordenAGestionarDesdeAyuda.orden.id}
          orden={ordenAGestionarDesdeAyuda.orden}
          modo={ordenAGestionarDesdeAyuda.modo}
          onOpenChange={(open) => {
            if (!open) setOrdenAGestionarDesdeAyuda(null);
          }}
          onResuelto={(res) => void resolverDesdeAyuda(res)}
        />
      ) : null}
    </div>
  );
}
