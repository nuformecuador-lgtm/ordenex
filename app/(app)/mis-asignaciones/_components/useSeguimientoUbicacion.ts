"use client";

// Feature 92 (seguimiento) — posición EN VIVO del mensajero en el mapa de reparto.
//
// ═══ POR QUE ESTO NO CUESTA NADA ═══
// La posición la da el navegador, no Google: `watchPosition` no toca ninguna API facturada.
// Lo caro es RECALCULAR la ruta, y eso sigue exactamente donde estaba —detrás del botón de
// sincronización y de sus guardas R34/R36—. Mover el punto azul y reoptimizar son dos cosas
// distintas, y este hook solo hace la primera.
//
// ═══ R25: EL PERMISO NO SE FUERZA JAMAS ═══
// `watchPosition` dispara el diálogo del navegador si el permiso no está resuelto, así que
// llamarlo al montar sería exactamente lo que R25 prohíbe: pedirle el GPS a alguien que solo
// quería ver su lista. El seguimiento arranca únicamente cuando ya consta CONCEDIDO, y hay
// dos formas de que conste:
//
//   1. La Permissions API responde `granted` — sirve tras un F5, sin volver a preguntar nada.
//   2. El botón de sincronizar acaba de obtener una posición, lo que demuestra el permiso en
//      navegadores donde la Permissions API no existe (Safari lo tuvo ausente mucho tiempo).
//
// Ninguna de las dos abre un diálogo. Si el permiso está `prompt` o `denied`, este hook no
// hace absolutamente nada y el mapa se comporta como antes.
import { useEffect, useState } from "react";

import type { RutaMapaOrigen } from "./ruta-mapa-tipos";

/**
 * Precisión mínima aceptable, en metros. Una lectura de ±2 km —típica de la triangulación por
 * IP o por antena cuando el GPS todavía no fijó— movería el marcador a otro cantón y le haría
 * creer al mensajero que el mapa está roto. Se descarta en silencio: es mejor un punto viejo y
 * correcto que uno nuevo y falso.
 */
const PRECISION_MAXIMA_M = 200;

/**
 * Ventana mínima entre repintados, en ms. `watchPosition` puede emitir varias veces por
 * segundo con el GPS activo; a esa frecuencia el mapa re-renderiza sin que el ojo note
 * ninguna diferencia. Cinco segundos es fluido para alguien en moto y no calienta el móvil.
 */
const INTERVALO_MINIMO_MS = 5_000;

/** `true` si el permiso de geolocalización ya está CONCEDIDO, sin abrir ningún diálogo. */
function usePermisoConcedido(): boolean {
  const [concedido, setConcedido] = useState(false);

  useEffect(() => {
    // `navigator.permissions` no existe en todos los navegadores, y en algunos existe pero no
    // conoce el nombre `geolocation` y LANZA. Las dos ausencias son legítimas: sin respuesta,
    // se queda en `false` y el seguimiento espera a la vía 2 (el botón).
    if (typeof navigator === "undefined" || navigator.permissions === undefined) return;

    let vivo = true;
    let estado: PermissionStatus | null = null;
    const alCambiar = () => {
      if (vivo && estado !== null) setConcedido(estado.state === "granted");
    };

    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((resultado) => {
        if (!vivo) return;
        estado = resultado;
        setConcedido(resultado.state === "granted");
        // Si la persona revoca el permiso desde los ajustes del navegador con la pantalla
        // abierta, el seguimiento debe PARARSE solo. Sin esto seguiría intentándolo y el
        // navegador respondería con errores hasta que recargara.
        resultado.addEventListener("change", alCambiar);
      })
      .catch(() => {
        /* Sin Permissions API utilizable: se cae a la vía 2. */
      });

    return () => {
      vivo = false;
      estado?.removeEventListener("change", alCambiar);
    };
  }, []);

  return concedido;
}

/**
 * Sigue la posición del mensajero mientras el permiso conste concedido.
 *
 * @param permisoDemostrado `true` cuando el botón de sincronizar ya obtuvo una posición. Es la
 *   vía 2 de la cabecera: vale para navegadores sin Permissions API.
 * @returns la última posición válida, o `null` si no hay seguimiento o aún no llegó ninguna.
 */
export function useSeguimientoUbicacion(permisoDemostrado: boolean): RutaMapaOrigen | null {
  const permisoConcedido = usePermisoConcedido();
  const seguir = permisoConcedido || permisoDemostrado;
  const [posicion, setPosicion] = useState<RutaMapaOrigen | null>(null);

  useEffect(() => {
    if (!seguir) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    // Se captura la referencia AQUI y no se vuelve a leer el global en el cleanup: el efecto
    // se limpia al desmontar, y para entonces el `navigator` que se suscribio es el unico que
    // sabe de este `id`. Releerlo abre la puerta a soltar el watch sobre otro objeto — o
    // sobre ninguno, si ya no existe.
    const geo = navigator.geolocation;

    // El acumulador va fuera del estado a propósito: si el filtro de frecuencia dependiera de
    // `posicion`, el efecto se re-suscribiría en cada lectura y `watchPosition` se reiniciaría
    // constantemente — que es justo lo que encarece la batería.
    let ultimoPintadoMs = 0;

    const id = geo.watchPosition(
      (pos) => {
        if (pos.coords.accuracy > PRECISION_MAXIMA_M) return;
        const ahora = pos.timestamp;
        if (ahora - ultimoPintadoMs < INTERVALO_MINIMO_MS) return;
        ultimoPintadoMs = ahora;
        setPosicion({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        // Un error de seguimiento NO se muestra ni se propaga: esto es un adorno del mapa.
        // Si el GPS se pierde en un sótano, el marcador se queda en el último punto bueno,
        // que es exactamente el comportamiento anterior a este hook.
      },
      {
        // `enableHighAccuracy: true` para que el punto siga la calle por la que va y no salte
        // de antena en antena. Es el ajuste que gasta batería, y por eso el seguimiento solo
        // corre con el mapa montado (el acordeón desmonta) y nunca al cargar la página.
        enableHighAccuracy: true,
        // Sin tope de espera: `watchPosition` no "falla" por tardar, sigue esperando el fix.
        timeout: Number.POSITIVE_INFINITY,
        // Cada lectura, fresca. Cachear aquí no ahorra nada: el GPS ya está encendido.
        maximumAge: 0,
      },
    );

    return () => geo.clearWatch(id);
  }, [seguir]);

  return posicion;
}
