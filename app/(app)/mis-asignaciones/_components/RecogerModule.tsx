"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Input } from "@/components/ui/input";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
// Feature 111/R12 -> FEATURE 271 (T9.1/T9.2): el aviso del bloqueo dejó de ser una constante y
// pasó a ser un FORMATEADOR (texto separado, i18n-ready). El MISMO de Reparto, Recolección y
// Cierre del día: vive en `lib/constants/` para que las cuatro pantallas no puedan divergir en un
// mensaje que el humano declaró preciso, y ahora además CUENTA (cuántos cierres arrastra y cuál
// toca primero, R43). `conCta: true` porque desde aquí hay que decirle a dónde ir (R52).
import { avisoBloqueo } from "@/lib/constants/bloqueo-mensajero";
import type { MiAsignacionDTO } from "@/lib/interfaces/services/IMisAsignacionesService";
import type { BloqueoDetalle } from "@/lib/utils/bloqueo-cierre";
import {
  PESTANA_PARA_OTRO_DIA,
  PESTANA_PARA_RECOGER_HOY,
} from "@/lib/utils/dia-reparto-textos";
import { CarruselCards } from "@/components/shared/CarruselCards";

import { filtrarAsignaciones } from "./mis-asignaciones-buscador";
import {
  contadorNuevasAsignadas,
  punteroALaOtraPestana,
  separarPorDia,
  SIN_RESULTADOS_RECOGER,
  VACIO_GRUPO_HOY,
  VACIO_GRUPO_OTRO_DIA,
} from "./recoger-grupos";
import { RecogerPaqueteCard } from "./RecogerPaqueteCard";
import { PosOrderCardDetalle } from "./pos-card/PosOrderCardDetalle";
import { PosOrderCardMosaico } from "./pos-card/PosOrderCardMosaico";
import { VistaCardsToggle, type VistaCards } from "./VistaCardsToggle";
import { CLASE_FASE, useTransicionVista } from "./useTransicionVista";

// 2026-07-31 (decisión del humano) — pantalla POR RECOGER del mensajero. Es la mitad que
// se sacó de `MisAsignacionesModule` (hoy `RepartoModule`), donde el escáner quedaba
// enterrado bajo el mapa y el panel de gestión: aquí es lo primero que se ve.
//
// Qué se conserva, sin cambios de comportamiento:
//   - Las DOS vías de recogida en una sola tarjeta plegable (`RecogerPaqueteCard`, feature
//     96): input de número de guía y escáner de cámara. Ambas resuelven el num_guia contra
//     `porRecoger` (restricción "asignada a mí") y aceptan con la MISMA action.
//   - El listado de solo-visualización con su banner de contador.
//   - El buscador de guías (feature 114), ahora propio de esta pantalla.
//   - El aviso de BLOQUEO TOTAL (feature 111/R12/R14), que oculta los controles de
//     recogida y deja el listado en solo-visualización.
//
// Qué es NUEVO (pedido humano): el conmutador mosaico/detalle y el carrusel que Reparto
// ya tenía, replicados aquí sobre las MISMAS piezas (`VistaCardsToggle`,
// `useTransicionVista`, `CarruselCards`, cards POS) para que las dos pantallas del portal
// se manejen igual.
//
// Qué NO se trajo (decisión del humano): el filtro cantón/distrito y los KPIs, que siguen
// solo en Reparto. Tampoco el chat flotante: conversa sobre gestiones en curso, y aquí no
// hay ninguna.
//
// ⚠️ FEATURE 277 (2026-08-24, firmada por el humano) — DOS PESTAÑAS, Y EL CONTADOR DENTRO DE LA
// QUE CUENTA.
//
// Hasta hoy esta pantalla mezclaba en UNA sola lista lo que el mensajero puede recoger ahora con
// lo que el servidor le va a rechazar: desde el 2026-08-21 (feature 261) una orden marcada para un
// día posterior no se recoge hasta su día. Medido en producción el 2026-08-24: 2 órdenes por
// recoger, 1 de hoy y 1 para después, y la cabecera decía «2 Órdenes nuevas asignadas» con 1 sola
// recogible.
//
// Lo que cambia es DÓNDE vive cada orden, no si se ve. Las dos pestañas están siempre montadas y
// seleccionables, cada una dice cuántas tiene sin que nadie interactúe (R7/R8) y ninguna orden
// queda a más de una pulsación (R9). Nada sale de la pantalla: la 246/R23 sigue vigente, y la
// lección de la 167 —el bloque de escaneo que desaparecía justo cuando iban a buscarlo— también.
//
// Qué queda ARRIBA de las pestañas, y por qué:
//   - Los controles de recogida (R22): resuelven la guía contra el grupo COMPLETO, así que no
//     pertenecen a ninguna de las dos. Su presencia sigue dependiendo de lo de siempre
//     (`bloqueado || porRecoger.length === 0`), NO del tamaño del grupo de hoy.
//   - El buscador y el conmutador de vista (R18/R19): uno solo, compartido, con su estado por
//     encima de las pestañas, así el texto y la vista sobreviven al cambio de pestaña y no hay dos
//     campos que puedan decir cosas distintas.
//
// Y una sola regla para todo lo que cuenta: LOS CONTADORES CUENTAN LO QUE EL MENSAJERO TIENE; EL
// BUSCADOR SÓLO CAMBIA LO QUE SE VE (R16/R20).

export interface RecogerModuleProps {
  /** Órdenes en `por_recoger`. */
  porRecoger: MiAsignacionDTO[];
  /**
   * Feature 111/R12/R14 -> FEATURE 271 (T9.1): el DETALLE del bloqueo, no un booleano. Trae el
   * veredicto y con qué se llega a él (cuántos cierres arrastra, cuántos espera que él reenvíe y
   * cuál toca primero), calculado por el MISMO predicado que aplica el servidor (R10).
   *
   * Con `bloqueado` se muestra el aviso y se ocultan los controles de recogida. Defensa SUAVE;
   * el backend (R25) es la defensa real.
   */
  bloqueo: BloqueoDetalle;
}

// Feature 114: textos del buscador (separados para i18n futura, lenguaje claro). La
// región y la etiqueta del campo son DISTINTAS a propósito: si coincidieran, el nombre
// accesible del `searchbox` (de su `<label>`) chocaría con el de la región.
const BUSCADOR_REGION = "Buscar guías por recoger";
const BUSCADOR_LABEL = "Buscar guías";
const BUSCADOR_PLACEHOLDER =
  "Filtra por número de guía, remisión, teléfono o nombre";

// Feature 277 (R28): los nombres accesibles de esta pantalla son los TRES distintos —la región
// sigue siendo «Por recoger», el buscador conserva el suyo y el grupo de pestañas estrena el de
// abajo—. Si coincidieran, el nombre accesible de uno chocaría con el de otro.
const TABLIST_LABEL = "Grupos de órdenes por recoger";
// Y los dos listados también se llaman distinto: sin esto, saber en qué grupo estás dependería de
// mirar cuál pestaña se ve resaltada. El del grupo de hoy CONSERVA su nombre de siempre.
const LISTADO_HOY_LABEL = "Órdenes por recoger";
const LISTADO_OTRO_DIA_LABEL = "Órdenes para otro día";

/** Cuál de los dos grupos tiene el mensajero a la vista. */
type Grupo = "hoy" | "otro-dia";

export function RecogerModule({
  porRecoger,
  bloqueo,
}: Readonly<RecogerModuleProps>) {
  const router = useRouter();

  // FEATURE 271 (T9.1): el veredicto sale del detalle, no se re-deriva aquí.
  const bloqueado = bloqueo.bloqueado;

  // Presentación de las cards. Estado de UI EFÍMERO de un solo consumidor (no sube a URL
  // ni a contexto) y puramente visual: NO filtra ni reordena nada. Arranca en "mosaico"
  // (más órdenes visibles de un vistazo en la calle), igual que Reparto. El cambio va
  // ANIMADO en dos tramos encadenados; de eso se encarga `useTransicionVista`.
  const {
    vista: vistaCards,
    vistaPedida: vistaCardsPedida,
    fase: faseVista,
    cambiarVista,
  } = useTransicionVista<VistaCards>("mosaico");

  // Feature 114: texto del buscador. Estado de UI EFÍMERO, de un solo consumidor.
  // `buscando` distingue "hay búsqueda activa" de "grupo vacío".
  const [query, setQuery] = useState("");
  const buscarId = useId();
  const buscando = query.trim() !== "";

  // Feature 277 (R12/R13): la pestaña activa, tercer estado EFÍMERO de esta pantalla, con el
  // mismo criterio que los otros dos (no sube a la URL: nadie enlaza una pestaña, y un `?tab=`
  // obligaría a decidir qué pasa con un valor inválido). Arranca SIEMPRE en el grupo de hoy,
  // tenga o no órdenes: una pantalla que cambia de puerta según el día es una pantalla que no se
  // puede aprender. Y sólo la mueve el mensajero — nada la cambia por su cuenta, ni una búsqueda
  // sin coincidencias ni un grupo que se quede vacío tras recoger.
  const [grupoActivo, setGrupoActivo] = useState<Grupo>("hoy");

  // Feature 277 (R2-R5): la partición sale del booleano que YA viaja en el DTO, derivado en el
  // servidor (246/R26). Aquí no se lee ningún reloj ni se compara ninguna fecha.
  const grupos = useMemo(() => separarPorDia(porRecoger), [porRecoger]);

  // Feature 114/R2/R7 + 277/R18: el buscador filtra por guía, remisión, teléfono o nombre del
  // destinatario (parcial, insensible a mayúsculas/acentos) y se aplica a LOS DOS grupos, no sólo
  // al que esté a la vista. Si mirara sólo el activo, teclear la guía de una orden de otro día
  // respondería «ninguna coincide» — que es falso, y el mensajero la tiene en la mano.
  const hoyFiltrado = useMemo<MiAsignacionDTO[]>(
    () => filtrarAsignaciones(grupos.hoy, query),
    [grupos.hoy, query],
  );
  const otroDiaFiltrado = useMemo<MiAsignacionDTO[]>(
    () => filtrarAsignaciones(grupos.otroDia, query),
    [grupos.otroDia, query],
  );

  /**
   * Una card "por recoger". Extraída para que el CARRUSEL (mosaico) y la LISTA (detalle)
   * rendericen exactamente la misma card: el conmutador solo cambia el envoltorio y el
   * componente de presentación.
   *
   * Sin `onGestionar`: aquí no hay nada que gestionar, así que la card es de
   * solo-visualización (ni clickeable ni enfocable). `mostrarRuta={false}` porque estas
   * órdenes todavía no entraron en la ruta optimizada, y `estado` fijo porque no se deriva
   * de un puntero de gestión que en esta pantalla no existe.
   */
  function renderCardPorRecoger(
    orden: MiAsignacionDTO,
    vista: VistaCards,
    total: number,
  ) {
    const CardVista =
      vista === "mosaico" ? PosOrderCardMosaico : PosOrderCardDetalle;
    return (
      <CardVista
        orden={orden}
        total={total}
        estado="Por recoger"
        mostrarRuta={false}
      />
    );
  }

  /**
   * El contenido de un panel: su lista, o su vacío con el puntero a la otra pestaña.
   *
   * EL PUNTERO ES LA MITAD QUE NO SE PUEDE OMITIR (R11/R21). Un mensajero que busca una guía que
   * resulta estar en el otro grupo no puede leer sólo «ninguna coincide»: hay que decirle DÓNDE
   * está y cuántas hay allí. Cambiar de pestaña lo hace él, pulsando la que tiene a un centímetro
   * con su conteo al lado; la pantalla no salta sola.
   */
  function renderPanel(grupo: Grupo) {
    const esHoy = grupo === "hoy";
    const visibles = esHoy ? hoyFiltrado : otroDiaFiltrado;
    const enLaOtra = esHoy ? otroDiaFiltrado : hoyFiltrado;
    const listadoLabel = esHoy ? LISTADO_HOY_LABEL : LISTADO_OTRO_DIA_LABEL;

    if (visibles.length === 0) {
      const puntero = punteroALaOtraPestana(
        enLaOtra.length,
        esHoy ? PESTANA_PARA_OTRO_DIA : PESTANA_PARA_RECOGER_HOY,
        buscando,
      );
      return (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            {buscando
              ? SIN_RESULTADOS_RECOGER
              : esHoy
                ? VACIO_GRUPO_HOY
                : VACIO_GRUPO_OTRO_DIA}
          </p>
          {puntero ? (
            <p className="text-sm text-muted-foreground">{puntero}</p>
          ) : null}
        </div>
      );
    }

    if (vistaCards === "mosaico") {
      /* En MOSAICO las cards van en carrusel (`CarruselCards`), de 3 en 3 según el
         ancho —1 en móvil, 2 desde `sm`, 3 desde `lg`— con la etiqueta de posición
         debajo ("Órdenes 1-3 de 5"). Mismas piezas y mismos cortes que Reparto. */
      return (
        <div className={CLASE_FASE[faseVista]}>
          <CarruselCards
            items={visibles}
            getKey={(orden) => orden.id}
            ariaLabel={listadoLabel}
            singular="Orden"
            plural="Órdenes"
            renderItem={(orden) =>
              renderCardPorRecoger(orden, "mosaico", visibles.length)
            }
          />
        </div>
      );
    }

    /* La clase de fase anima la lista ENTERA como bloque (bajar+desvanecer /
       subir+aparecer). Sin transición (`estable`) no añade nada, así que la lista
       no queda con estilos de animación colgando. */
    return (
      <ul
        aria-label={listadoLabel}
        className={`flex flex-col gap-3 ${CLASE_FASE[faseVista]}`}
      >
        {visibles.map((orden) => (
          <li key={orden.id}>
            {renderCardPorRecoger(orden, "detalle", visibles.length)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/* ---------- Aviso de BLOQUEO TOTAL del mensajero (feature 111/R12) ---------- */}
      {bloqueado ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {avisoBloqueo(bloqueo, { conCta: true })}
        </p>
      ) : null}

      {/* ---------- Recogida: input de guía + escáner (feature 96) ---------- */}
      {/* Las DOS vías resuelven el num_guia contra `porRecoger` y aceptan con la MISMA
          action `recogerAsignaciones`, directo al confirmar (sin modal).
          Feature 111/R14: BLOQUEADO oculta ambos controles (defensa suave; el listado
          sigue visible, solo-visualización).
          Pedido humano: sin NADA por recoger la tarjeta tampoco se muestra — no hay guía
          que resolver, así que el input y el escáner solo estorbarían. Se mira
          `porRecoger` COMPLETO, no el filtrado: el buscador no debe quitarle al mensajero
          la forma de recoger lo que sigue pendiente.
          Feature 277 (R22): COMPLETO también quiere decir LAS DOS PESTAÑAS. Con sólo órdenes de
          otro día la tarjeta se queda, y el rechazo dice el motivo real con su fecha (261/R13);
          retirarla ahí sería repetir el fallo que abrió la 167 con otro disfraz. */}
      {bloqueado || porRecoger.length === 0 ? null : (
        <RecogerPaqueteCard
          porRecoger={porRecoger}
          onRecogida={() => router.refresh()}
        />
      )}

      {/* ---------- Listado de solo-visualización ---------- */}
      {/* `aria-label` y no un `<h2>` visible: el `<h1>` de la página ya dice "Por
          recoger" y repetirlo debajo sería ruido. El nombre accesible se conserva porque
          es por donde la región se identifica (y por donde la buscan los tests). */}
      <section aria-label="Por recoger" className="flex flex-col gap-3">
        {/* Buscador y conmutador de vista comparten fila: son los dos controles de la
            lista. En pantallas angostas se apilan (`flex-col`) para que el input no se
            estruje; desde `sm` van en la MISMA línea, el input ocupando el espacio libre
            y el conmutador alineado a su base. Es un filtro puro de cliente, así que
            permanece visible aunque el mensajero esté bloqueado. Y va ARRIBA de las pestañas
            porque es UNO SOLO para los dos grupos (277/R18/R19). */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
          <section
            aria-label={BUSCADOR_REGION}
            className="flex min-w-0 flex-1 flex-col gap-1"
          >
            <label htmlFor={buscarId} className="text-sm font-medium">
              {BUSCADOR_LABEL}
            </label>
            <Input
              id={buscarId}
              type="search"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={BUSCADOR_PLACEHOLDER}
            />
          </section>
          <VistaCardsToggle
            vista={vistaCardsPedida}
            onVistaChange={cambiarVista}
          />
        </div>

        {/* ---------- Los dos grupos, feature 277 ---------- */}
        {/* SIN `keepMounted` a propósito: no hay nada dentro de un panel que valga la pena
            conservar —la búsqueda, la vista y los conteos viven fuera— y mantener los dos
            montados dejaría DOS listados a la vez en el DOM, que es la puerta de los nombres
            accesibles duplicados. Es la decisión opuesta a la de `NovedadesTabs`, y por un motivo
            concreto: allí cada panel tiene paginación propia por Server Action que debe
            sobrevivir; aquí no hay estado por panel.
            EL CONTEO VA EN EL TEXTO DE LA PESTAÑA (R8/R27), incluido el cero, y no en un punto de
            otro tono: nada de esta pantalla puede depender del color. */}
        <Tabs
          value={grupoActivo}
          onValueChange={(siguiente) => setGrupoActivo(siguiente as Grupo)}
        >
          <TabsList aria-label={TABLIST_LABEL}>
            <TabsTrigger value="hoy">
              {`${PESTANA_PARA_RECOGER_HOY} (${grupos.hoy.length})`}
            </TabsTrigger>
            <TabsTrigger value="otro-dia">
              {`${PESTANA_PARA_OTRO_DIA} (${grupos.otroDia.length})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="hoy" className="flex flex-col gap-3">
            {/* Banner con el contador de nuevas, DENTRO del panel que cuenta (277/R15/R17). El
                sitio importa tanto como el número: estaba fuera del grupo que decía contar, y por
                eso pudo contar de más sin que chirriara. Cuenta el grupo COMPLETO de hoy, no lo
                que el buscador deja a la vista (R16). Con el grupo vacío no hay banner: el vacío
                lo explica su propio mensaje. */}
            {grupos.hoy.length > 0 ? (
              <p
                role="status"
                className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-primary"
              >
                {contadorNuevasAsignadas(grupos.hoy.length)}
              </p>
            ) : null}
            {renderPanel("hoy")}
          </TabsContent>

          {/* El panel de otro día no lleva contador propio ni línea de encabezado: su conteo está
              en el nombre de la pestaña, y cada card ya dice qué es («Para mañana») y desde qué
              día se podrá, con su fecha. Una línea de grupo repetiría por grupo lo que ya está
              una vez por orden — y la fecha por orden es más cierta, porque el grupo puede ser
              mixto. */}
          <TabsContent value="otro-dia" className="flex flex-col gap-3">
            {renderPanel("otro-dia")}
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}
