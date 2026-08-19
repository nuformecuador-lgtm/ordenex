"use client";

import { useState } from "react";

import { Pagination } from "@/components/shared/Pagination";
import { useToast } from "@/hooks/useToast";
import { listarNovedadesAction } from "@/lib/actions/novedades";
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
import type { NovedadDTO } from "@/lib/types/novedad";

import { HabilitarNovedadModal } from "./HabilitarNovedadModal";
import { HiloNotasNovedadModal } from "./HiloNotasNovedadModal";
import { NovedadAcciones } from "./NovedadAcciones";
import { novedadAOrdenCard, SECCIONES_NOVEDAD } from "./novedad-a-orden-card";
import { ReprogramarNovedadModal } from "./ReprogramarNovedadModal";

// Feature 87 (T12, design §3.2) — modulo cliente de `/novedades`. Recibe TODO por props
// desde el Server Component padre (que ya valido rol adminTienda y pre-fetch pagina 1, R18):
// componente PRIVADO (datos sensibles de la tienda por props, arquitectura §private). Por
// cada orden `devuelta` muestra la guia (o placeholder si `null`, R9), el destinatario, la
// causa con etiqueta ES (`CAUSA_DEVOLUCION_LABEL`, R7/R9/R11) y los `ContactoButtons`. Al
// cambiar de pagina re-fetch por Server Action `listarNovedadesAction({ page })` (lectura
// interna, NO fetch a /api; el telefono es PII), patron `MiWalletModule` (R22). Lista vacia
// -> estado vacio legible (R10).
//
// 2026-08-12 (pedido humano) — LA FILA YA NO SE PINTA AQUÍ. Cada novedad se muestra con las
// MISMAS cards que las órdenes del mensajero, y las acciones de esta pantalla —WhatsApp,
// Llamar, Reprogramar, y las dos de MAQUETA "Habilitar" y "Devolver"— bajan como un solo
// nodo por su prop `acciones` (`NovedadAcciones`). Lo que eso cambia y lo que no:
//
//  - NO cambia lo que se ve: guía (o su placeholder, R9), destinatario, causa en etiqueta ES
//    (R7/R11) e intentos (feature 160/R18/R19) siguen en pantalla, en los slots que la card
//    ya tenía. La CAUSA viaja por la prop `estado` —el badge de la card—, que acepta texto
//    libre por diseño (`pos-estado`: «cae a las clases de En reparto si es un texto libre»).
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
//     justo lo que la tienda necesita ver junto a la devolución. `montoCobrar` es
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

export interface NovedadesModuleProps {
  items: NovedadDTO[];
  total: number;
  page: number;
  pageSize: number;
}

/** Etiqueta ES de la causa; NUNCA el slug crudo del enum (R11). `null` -> "Sin causa registrada" (R7). */
function causaLabel(causa: NovedadDTO["causa"]): string {
  return causa ? CAUSA_DEVOLUCION_LABEL[causa] : "Sin causa registrada";
}

export function NovedadesModule({
  items: initialItems,
  total: initialTotal,
  page: initialPage,
  pageSize,
}: NovedadesModuleProps) {
  const toast = useToast();

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
  // Feature 227 (T3.3): orden con el HILO de notas abierto (null = cerrado). Mismo patrón
  // que los dos modales de arriba, por el mismo motivo: el hilo se pide al abrir UNA orden y
  // nunca para la lista (design §4/A6, N+1).
  const [ordenConNotas, setOrdenConNotas] = useState<NovedadDTO | null>(null);

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
   * MAQUETA (2026-08-12): "Devolver" está en la fila pero todavía no hace nada — su
   * comportamiento no está decidido y no existe en el backend (ver la cabecera de
   * `NovedadAcciones`). Avisa por toast en vez de callar: un botón que no responde se lee
   * como una app rota, y el usuario de esta pantalla es una tienda, no quien pidió la
   * maqueta. El día que se cablee, este handler desaparece.
   */
  function avisarNoDisponible() {
    toast.info("Esta acción todavía no está disponible.");
  }

  /**
   * MAQUETA (2026-08-12): "Habilitar" SÍ abre su modal y SÍ exige la nota —esa parte es
   * real y está probada—, pero al confirmar no hay transición que ejecutar todavía. La nota
   * ya validada llega hasta aquí y muere en el toast.
   *
   * Se deja el parámetro `nota` a la vista, y no una firma sin argumentos, porque es el
   * dato que la Server Action va a necesitar: cuando exista, el cuerpo de esta función es
   * lo único que cambia.
   */
  function habilitarPendiente(nota: string) {
    void nota;
    setOrdenAHabilitar(null);
    toast.info("Esta acción todavía no está disponible.");
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
      const res = await listarNovedadesAction({ page: nextPage });
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
    // R10: estado vacio legible en vez de una lista sin filas.
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center"
        role="status"
      >
        <p className="text-base font-medium text-foreground">
          No tenés órdenes en devolución
        </p>
        <p className="text-sm text-muted-foreground">
          Cuando una de tus órdenes vuelva a la tienda, aparecerá acá con su causa y los
          botones de contacto.
        </p>
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
        aria-label="Órdenes en devolución"
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
              // El badge de la card lleva la CAUSA de devolución, que es la señal de esta
              // pantalla (R7/R11). No hay estado de reparto que anunciar: todas las órdenes
              // de la lista están devueltas, así que repetirlo por fila no diría nada.
              estado={causaLabel(novedad.causa)}
              // Sin `onGestionar`: de aquí no se gestiona nada, así que la card es de
              // solo-visualización — no clickeable ni enfocable (ver `pos-seleccion`).
              mostrarRuta={false}
              secciones={SECCIONES_NOVEDAD}
              // Las cinco acciones de esta pantalla, como UN nodo (pedido humano). Las dos
              // cards les hacen sitio al pie —la de detalle tras un borde punteado, la de
              // mosaico a hueso— y ninguna sabe qué son, así que el panel no cambia al
              // conmutar de vista.
              acciones={
                <NovedadAcciones
                  novedad={novedad}
                  onReprogramar={setOrdenAReprogramar}
                  onHabilitar={setOrdenAHabilitar}
                  onDevolver={avisarNoDisponible}
                  onNotas={setOrdenConNotas}
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
        ariaLabel="Paginación de novedades"
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
          onConfirmar={habilitarPendiente}
        />
      ) : null}

      {/* Feature 227 (T3.3, design §5.1): el HILO de la orden abierta. Montaje condicional y
          `key` como los dos de arriba — con eso la lectura del hilo ocurre una vez por
          apertura y jamás por fila del listado paginado. */}
      {ordenConNotas ? (
        <HiloNotasNovedadModal
          key={ordenConNotas.id}
          orden={ordenConNotas}
          onOpenChange={(open) => {
            if (!open) setOrdenConNotas(null);
          }}
        />
      ) : null}
    </div>
  );
}
