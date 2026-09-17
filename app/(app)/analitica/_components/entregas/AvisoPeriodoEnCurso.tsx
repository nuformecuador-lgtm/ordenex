"use client";

// FICHA 441 — EL AVISO DE QUE EL PERIODO TODAVIA SE ESTA CERRANDO.
//
// ─── POR QUE ESTA FICHA NO SE PODIA CERRAR SOLO CAMBIANDO LA CONSULTA ───────────────────
//
// Con la ventana puesta sobre la fecha de CARGA, el KPI por fin contesta «de las cargadas,
// cuantas ya se entregaron». Pero aparece la trampa de la direccion contraria, medida contra
// produccion el 2026-09-17:
//
//   cohorte de 1 dia → 14,7 %   ·   3 dias → 43,9 %   ·   7 dias → 54,3 %   ·   14 dias → 56,1 %
//
// **Una cohorte joven lee mal POR JOVEN, no por ir mal.** Sin este aviso, manana el tablero
// diria 14,7 % y pareceria que el negocio se hundio de un dia para otro. Lo que falta no es un
// numero mejor: es decir en voz alta que el periodo TODAVIA SE ESTA CERRANDO, y con cuantas.
//
// ─── POR QUE ES UN COMPONENTE APARTE Y NO UNA LINEA DENTRO DEL HEROE ────────────────────
//
// El diseno aprobado lo pone a ANCHO COMPLETO debajo de la fila de KPIs, y la fila es una
// rejilla que compone `page.tsx`: una linea dentro de la tarjeta heroe no puede salirse de su
// celda. Siendo un hermano, la pagina lo coloca donde el diseno dice.
//
// **No cuesta una peticion.** Usa la MISMA clave de SWR que `KpisEfectividad` y
// `ConteoPorStatusDona` (`[CLAVE_TABLERO, "conteo-por-status", filtro]`), asi que SWR deduplica:
// una peticion, una respuesta y —lo que de verdad importa— las mismas filas. Con una consulta
// propia bastaria una gestion registrada entre las dos para que el aviso hablara de 265 vivas
// mientras la barra de al lado pinta 264.
//
// ─── CUANDO NO SE PINTA ─────────────────────────────────────────────────────────────────
//
// Con la consulta en vuelo, con un aviso de permisos o de error, y —el caso normal de un periodo
// ya cerrado— cuando no queda ninguna orden viva. En esos tres casos no devuelve nada: un aviso
// de «el periodo se esta cerrando» sobre un periodo cerrado es ruido que ensena a ignorar los
// avisos de verdad.

import { Clock3 } from "lucide-react";
import useSWR from "swr";

import { serializarFiltroEntregas } from "@/app/(app)/_components/entregas-filtro-analitica";
import { useFiltroEntregas } from "@/app/(app)/_components/filtro-entregas";
import { consultarConteoPorStatus } from "@/lib/actions/conteo-por-status";
import { evaluarMadurezDeCohorte } from "@/lib/analytics/madurez-cohorte";
import type { ResultadoConteoPorStatus } from "@/lib/types/conteo-por-status";

import { CLAVE_TABLERO } from "../operativo/PanelOperativo";

import { calcularEfectividad } from "./efectividad";
import { avisoPeriodoEnCurso, TITULO_AVISO_EN_CURSO } from "./madurez-textos";

async function consultar(filtroSerializado: string): Promise<ResultadoConteoPorStatus> {
  return consultarConteoPorStatus(JSON.parse(filtroSerializado) as unknown);
}

export function AvisoPeriodoEnCurso() {
  const { filtro } = useFiltroEntregas();
  const filtroSerializado = serializarFiltroEntregas(filtro);

  // ⚠ MISMA CLAVE que `KpisEfectividad`. Ver la cabecera: de aqui sale que el aviso y la barra
  // de madurez hablen de las MISMAS filas y no puedan discrepar.
  const { data } = useSWR(
    [CLAVE_TABLERO, "conteo-por-status", filtroSerializado],
    () => consultar(filtroSerializado),
    { keepPreviousData: false, revalidateOnFocus: false },
  );

  // Sin respuesta util no hay aviso: ni mientras carga, ni con permisos denegados, ni con error.
  // El estado de esos casos ya lo dicen las tarjetas de arriba, con su propio texto.
  if (data?.status !== "ok") return null;

  const frase = avisoPeriodoEnCurso(evaluarMadurezDeCohorte(calcularEfectividad(data.datos.porStatus)));
  if (frase === null) return null;

  return (
    // `role="status"`: es informativo y no una alerta. Se anuncia con cortesia —cuando el lector
    // termine lo que esta diciendo— porque no pide ninguna accion al usuario.
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-xl bg-brand-soft p-3 text-sm text-foreground dark:bg-brand/15"
    >
      <Clock3 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-dark dark:text-brand-light" />
      <p className="leading-relaxed">
        <strong className="font-semibold">{TITULO_AVISO_EN_CURSO}.</strong> {frase}
      </p>
    </div>
  );
}
