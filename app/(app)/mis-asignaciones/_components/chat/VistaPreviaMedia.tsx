"use client";

import Lightbox from "yet-another-react-lightbox";
import type { SlideImage, SlideVideo } from "yet-another-react-lightbox";
import Video from "yet-another-react-lightbox/plugins/video";
import Zoom from "yet-another-react-lightbox/plugins/zoom";

import "yet-another-react-lightbox/styles.css";

// Vista previa a pantalla completa de un adjunto del chat (imagen o video).
//
// POR QUE UNA LIBRERIA Y NO UN `<Dialog>` PROPIO: la miniatura de la burbuja se ve pequeña —una
// foto vertical de telefono, encajada en una burbuja del 80% del ancho, acaba en ~150 px— y lo
// que hace falta al abrirla no es "mas grande", es lo que el mensajero ya espera de WhatsApp:
// ABRIR A PANTALLA COMPLETA, HACER PINZA CON LOS DEDOS y CERRAR. Eso —gestos tactiles de
// pellizco y arrastre, con inercia y limites, en iOS y en Android— es justo lo que no se escribe
// a mano sin equivocarse. `yet-another-react-lightbox` lo trae hecho, sin dependencias propias.
//
// ZOOM CON LOS DEDOS, NO CON LUPITA (pedido explicito del humano): el plugin `Zoom` trae el
// gesto de pinza y el doble toque; los BOTONES de lupa del toolbar se quitan con
// `render.buttonZoom` -> `null`. En un movil ocupan sitio y no es como se hace zoom ahi.
//
// El binario NO se vuelve a pedir: se reusa el object URL (`blob:`) que la burbuja ya bajo por
// el proxy, asi que abrir la vista previa no gasta datos moviles otra vez.

/** Lo que se abre: la miniatura de la burbuja ya tiene el binario descargado. */
export type SlidePreviaMedia =
  | { tipo: "imagen"; url: string; descripcion: string }
  | { tipo: "video"; url: string; mime: string; descripcion: string };

export interface VistaPreviaMediaProps {
  /** `null` = cerrada. Se pasa el adjunto, no un indice: cada burbuja abre el suyo. */
  slide: SlidePreviaMedia | null;
  onCerrar: () => void;
}

const ETIQUETA_CERRAR = "Cerrar vista previa";

function aSlide(slide: SlidePreviaMedia): SlideImage | SlideVideo {
  if (slide.tipo === "imagen") {
    return { type: "image", src: slide.url, alt: slide.descripcion };
  }
  return {
    type: "video",
    sources: [{ src: slide.url, type: slide.mime }],
    // `playsInline`: sin el, iOS se lleva el video a SU reproductor a pantalla completa y se
    // pierde la vista previa (y el gesto de cerrar) que esta pieza existe para dar.
    playsInline: true,
    controls: true,
    autoPlay: false,
  };
}

export function VistaPreviaMedia({ slide, onCerrar }: Readonly<VistaPreviaMediaProps>) {
  // Sin adjunto no se monta nada: el lightbox no deja restos en el DOM del hilo.
  if (slide === null) return null;

  return (
    <Lightbox
      open
      close={onCerrar}
      slides={[aSlide(slide)]}
      plugins={[Zoom, Video]}
      // Un solo adjunto por vista previa: sin flechas ni contador que no llevan a ningun lado.
      carousel={{ finite: true }}
      render={{ buttonPrev: () => null, buttonNext: () => null, buttonZoom: () => null }}
      // Las tres formas de cerrar que un dedo intenta primero: la X, tocar fuera y arrastrar
      // hacia abajo. `closeOnPullDown` es el gesto de WhatsApp/Fotos.
      controller={{ closeOnBackdropClick: true, closeOnPullDown: true }}
      zoom={{
        // Hasta 5x del pixel real: una foto de guia o de fachada se lee de cerca.
        maxZoomPixelRatio: 5,
        // Rueda/trackpad para quien abra el chat en un escritorio; el movil usa la pinza.
        scrollToZoom: true,
      }}
      labels={{ Close: ETIQUETA_CERRAR }}
      styles={{ container: { backgroundColor: "rgba(0, 0, 0, 0.92)" } }}
    />
  );
}
