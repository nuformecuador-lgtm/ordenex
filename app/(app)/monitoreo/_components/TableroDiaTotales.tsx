"use client";

// Feature 192 (F2.3, R30) + Feature 258 (F4.4/F5.2/F6.2) — la TIRA DE TOTALES y, debajo, la
// linea de entregas acumuladas del dia.
//
// Usa el MISMO desglose que una tarjeta (`ContadoresTablero`), a proposito: si el total se
// pintara con su propia lista de contadores, podria quedarse sin uno y nadie lo notaria.
//
// ─── CON FILTRO ACTIVO, LOS TOTALES SON LOS DE LO FILTRADO (R43) ─────────────────────────
// Decision humana del 2026-08-21 (`design.md` §12.3), tomada EN CONTRA de lo que el propio
// diseño recomendaba. El riesgo que trae —leer «26 asignadas» y creer que es el dia entero—
// se cierra con TRES señales a la vez (R64), no con una:
//
//   | señal            | sin filtro                    | con filtro                        |
//   | rotulo           | «Totales del día»             | «Totales de lo filtrado»          |
//   | subtitulo        | —                             | «3 de 9 mensajeros»               |
//   | DOM              | `data-slot=tablero-dia-totales` | el mismo + `data-filtrado=""`   |
//
// `data-filtrado` es lo que hace la distincion TESTEABLE SIN LEER TEXTO (R64.c): sin el, la
// unica forma de comprobarlo seria una asercion sobre una cadena de UI, que se rompe con
// cualquier retoque de copy y no dice nada del estado.
//
// ⛔ La SUMA no se escribe aqui (R65): la hace `sumarTotalesTablero`, que vive en
// `lib/types/tablero-dia.ts` y la comparte con el servicio. Dos implementaciones de esa suma
// serian dos identidades de ocho sumandos distintas, y podrian divergir sin que ningun test lo
// notara. Este componente RECIBE los totales ya sumados.
//
// ─── LA LINEA SE REUSA, NO SE DIBUJA (R76–R78) ────────────────────────────────────────────
// Se monta `GraficaLineas`, que ya trae marco, estados (error > carga > vacio > datos),
// alternativa textual accesible y color por token. No se importa `recharts` ni nada de
// `…/analytics/lienzo/`: el lienzo lo carga la propia grafica con `lazy(() => import(…))`, asi
// que sigue llegando diferido (R78) y no hay ninguna guardia que tocar.
//
// La linea va en su PROPIA `Card`, hermana de la de totales y no dentro de ella: la linea
// habla SIEMPRE del dia entero, y meterla bajo un encabezado que con filtro dice «Totales de
// lo filtrado» seria volver a abrir por la puerta de al lado la confusion que R64 cierra.

import { GraficaLineas } from "@/components/private/analytics/GraficaLineas";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PuntoRitmoEntregas, TotalesTableroDia } from "@/lib/types/tablero-dia";

import { ContadoresTablero } from "./ContadoresTablero";
import { DENSIDAD_INICIAL, type DensidadTablero } from "./densidad";
import { ETIQUETA_SERIE_RITMO, serieDeRitmo } from "./serie-ritmo";

const TITULO = "Totales del día";
/** R64.a — el rotulo CAMBIA con el filtro. No es un matiz: es una de las tres señales. */
const TITULO_FILTRADO = "Totales de lo filtrado";
const ETIQUETA_ASIGNADAS = "Asignadas";
const COMPOSICION_DEL_DIA = "Composición del día";
const COMPOSICION_DE_LO_FILTRADO = "Composición de lo filtrado";

/** R76/R6 del paquete — `titulo` es OBLIGATORIO y es el nombre accesible de la region. */
const TITULO_RITMO = ETIQUETA_SERIE_RITMO;
/**
 * R59 — el vacio del propio marco. Es el UNICO vacio de la pantalla sin icono: `TextoVacio`
 * del paquete no tiene campo para uno, y darselo obligaria a ampliar el contrato del paquete
 * de analitica, que es otra ficha. No afecta a R24: los cinco estados de la RUTA si llevan el
 * suyo.
 */
const VACIO_RITMO = {
  titulo: "Todavía no hay entregas hoy",
  descripcion: "En cuanto se registre la primera, la curva empieza aquí.",
} as const;

/**
 * ⚠️ EL TECHO DE ALTURA DE LA LINEA, Y POR QUE SE PONE ASI
 *
 * Medido en la app con datos reales (2026-08-21, viewport 1440): la grafica salia a **371 px**
 * de alto, mas que la tira de totales (251) y mas que cualquier tarjeta de mensajero (239). En
 * la direccion aprobada era una franja de APOYO, no el protagonista.
 *
 * `proporcion="bajo"` no basta y no es un fallo suyo: el paquete fija el alto por PROPORCION y
 * no por pixeles (su R24 lo dice, y con razon: un `h-[300px]` se rompe dentro de una columna
 * flex). Con 32:9, el alto es el ancho / 3,56 — a ancho completo de la tarjeta (~1.100 px) eso
 * son ~310 px de lienzo, hagas lo que hagas.
 *
 * Asi que el techo se pone donde el paquete SI deja ponerlo: acotando el ANCHO por su prop
 * `className`. Con `max-w-2xl` (672 px) el lienzo mide 672 x 9/32 = 189 px, y la tarjeta entera
 * se queda en ~220 px — por debajo de una tarjeta de mensajero. En `xl`, ademas, la columna
 * mide ~545 px y el techo ni siquiera llega a morder: el lienzo baja a ~153 px.
 *
 * ⛔ NO se le mete un alto en pixeles ni se pisa el `aspect-[32/9]` del lienzo con una variante
 * arbitraria: eso seria alcanzar dentro del DOM del paquete, y el dia que cambie su estructura
 * dejaria de aplicarse EN SILENCIO. Si hiciera falta una franja mas baja a ancho completo, lo
 * correcto es una `proporcion` nueva en el paquete, que es otra ficha.
 */
const CLASE_RITMO = "mx-auto w-full max-w-2xl";

export interface TableroDiaTotalesProps {
  /**
   * Los totales YA sumados: los del dia cuando no hay filtro, los de las tarjetas visibles
   * cuando lo hay. Quien los suma es `sumarTotalesTablero`, nunca este componente (R65).
   */
  readonly totales: TotalesTableroDia;
  /** La serie del dia, tal cual viaja en el tablero. Se adapta con `serieDeRitmo` (R77). */
  readonly ritmoEntregas: readonly PuntoRitmoEntregas[];
  /** R64 — `true` mientras el filtro por nombre recorta algo. */
  readonly filtrado?: boolean;
  /** R64.b — cuantos mensajeros se pintan (`N`) de cuantos hay en el dia (`M`). */
  readonly visibles?: number;
  readonly total?: number;
  readonly densidad?: DensidadTablero;
}

export function TableroDiaTotales({
  totales,
  ritmoEntregas,
  filtrado = false,
  visibles,
  total,
  densidad = DENSIDAD_INICIAL,
}: TableroDiaTotalesProps) {
  const hayConteoDeCoincidencias = visibles !== undefined && total !== undefined;

  return (
    // La linea va AL LADO de la tira en pantallas anchas, no debajo: es la mitad de lo que
    // la baja de altura (ver `CLASE_RITMO`), y de paso deja de empujar las tarjetas fuera
    // de la primera pantalla. Debajo de `xl` se apilan, como estaban.
    <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
      <Card
        data-slot="tablero-dia-totales"
        // R64.c — el estado se lee del DOM, sin depender de ninguna cadena de UI.
        data-filtrado={filtrado ? "" : undefined}
      >
        <CardHeader>
          <CardTitle>{filtrado ? TITULO_FILTRADO : TITULO}</CardTitle>
          <CardAction>
            <div className="flex flex-col items-end" data-contador="asignadas">
              <span className="text-2xl leading-none font-semibold tabular-nums">
                {totales.asignadas}
              </span>
              <span className="text-xs text-muted-foreground">{ETIQUETA_ASIGNADAS}</span>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {/*
            R43/R64.b — cuantos coinciden de cuantos. Va en una region viva para que quien
            navega con lector de pantalla se entere de que lo que suena a continuacion esta
            RECORTADO; sin filtro la region existe pero no dice nada, que es lo que hace que
            el anuncio se dispare al empezar a filtrar.
          */}
          <p
            role="status"
            aria-live="polite"
            data-slot="tablero-dia-coincidencias"
            className="text-xs text-muted-foreground"
          >
            {filtrado && hayConteoDeCoincidencias
              ? `${visibles} de ${total} ${total === 1 ? "mensajero" : "mensajeros"}`
              : ""}
          </p>

          {/* R66/R70 — la barra de la tira la monta el MISMO `ContadoresTablero` que la de
              cada tarjeta, con el mismo dato que sus ocho chips: si los totales son de lo
              filtrado, su composicion tambien, y ninguna de las dos puede divergir de la
              otra porque no hay dos sitios donde armarla. */}
          <ContadoresTablero
            contadores={totales}
            densidad={densidad}
            etiquetaComposicion={filtrado ? COMPOSICION_DE_LO_FILTRADO : COMPOSICION_DEL_DIA}
          />
        </CardContent>
      </Card>

      <Card data-slot="tablero-dia-ritmo">
        <CardContent>
          <GraficaLineas
            titulo={TITULO_RITMO}
            series={serieDeRitmo(ritmoEntregas)}
            unidad="conteo"
            // 32:9 — la franja baja de la maqueta. A ancho completo un 16:9 se come la
            // pantalla y empuja las tarjetas fuera de vista.
            proporcion="bajo"
            className={CLASE_RITMO}
            vacio={VACIO_RITMO}
          />
        </CardContent>
      </Card>
    </div>
  );
}
