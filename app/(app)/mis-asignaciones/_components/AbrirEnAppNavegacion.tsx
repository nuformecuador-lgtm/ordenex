"use client";

import { useSyncExternalStore } from "react";
import { ExternalLink } from "lucide-react";

import {
  abreEnPestanaNueva,
  appsPara,
  detectarPlataforma,
  ETIQUETAS_APP,
  urlNavegacion,
  type AppNavegacion,
  type DestinoNavegacion,
  type Plataforma,
} from "@/lib/utils/navegacion-externa";
import {
  guardarAppPreferida,
  leerAppPreferida,
} from "@/lib/utils/preferencia-navegacion";

// Feature 289 — la fila "Abrir en:" del modal de navegación del mensajero.
//
// El minimapa interno responde a "¿dónde queda?"; esto responde a "llévame". No sustituye al
// mapa: va DEBAJO, y salir de la app sigue siendo un gesto deliberado del mensajero.
//
// Qué se ofrece depende de la plataforma (ver `appsPara`). En Android la primera opción es el
// selector del sistema, que muestra las apps de mapas realmente instaladas en ESE teléfono --
// la única forma honesta de "que elija la suya", porque la web no puede consultar qué tiene
// instalado.

export interface AbrirEnAppNavegacionProps {
  destino: DestinoNavegacion;
}

/** Preferida primero, si además está disponible en esta plataforma. */
function ordenarApps(
  disponibles: AppNavegacion[],
  preferida: AppNavegacion | null,
): AppNavegacion[] {
  if (preferida === null || !disponibles.includes(preferida)) return disponibles;
  return [preferida, ...disponibles.filter((app) => app !== preferida)];
}

/**
 * Ni `navigator` ni `localStorage` existen en el servidor, y este componente se renderiza
 * allí. `useSyncExternalStore` es el patrón que ya usa el repo para eso
 * (`hooks/usePreferenciaColumnasManifiesto.ts`): el servidor recibe una instantánea propia y
 * el cliente lee la real, sin discrepancia de hidratación y sin el `setState` dentro de un
 * efecto que prohíbe `react-hooks/set-state-in-effect`.
 *
 * Ambos snapshots son primitivos (un string y un string-o-null), que es lo que exige
 * `useSyncExternalStore`: compara por identidad, y devolver un objeto nuevo en cada lectura
 * realimentaría la suscripción en bucle.
 *
 * `suscribir` no escucha nada: la plataforma no cambia durante la vida de la página, y la
 * preferencia solo importa en la siguiente apertura del modal, no mientras está abierto.
 */
function suscribir(): () => void {
  return () => {};
}

function plataformaCliente(): Plataforma {
  return detectarPlataforma(navigator.userAgent, navigator.maxTouchPoints);
}

/** En servidor, la opción más conservadora: Google Maps, que funciona en las tres. */
function plataformaServidor(): Plataforma {
  return "escritorio";
}

function preferidaServidor(): AppNavegacion | null {
  return null;
}

export function AbrirEnAppNavegacion({
  destino,
}: Readonly<AbrirEnAppNavegacionProps>) {
  const plataforma = useSyncExternalStore(
    suscribir,
    plataformaCliente,
    plataformaServidor,
  );
  const preferida = useSyncExternalStore(
    suscribir,
    leerAppPreferida,
    preferidaServidor,
  );

  const apps = ordenarApps(appsPara(plataforma), preferida);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Abrir en:
      </p>
      <div className="flex flex-wrap gap-2">
        {apps.map((app) => {
          const pestanaNueva = abreEnPestanaNueva(app);
          return (
            <a
              key={app}
              href={urlNavegacion(app, destino)}
              // El `geo:` se lo queda el sistema operativo; abrirlo en pestaña nueva dejaría
              // una pestaña en blanco detrás.
              target={pestanaNueva ? "_blank" : undefined}
              rel={pestanaNueva ? "noopener noreferrer" : undefined}
              aria-label={`Abrir en ${ETIQUETAS_APP[app]}`}
              onClick={() => guardarAppPreferida(app)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-navy px-4 py-3 text-xs font-bold uppercase tracking-wide text-white transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              {ETIQUETAS_APP[app]}
            </a>
          );
        })}
      </div>
    </div>
  );
}
