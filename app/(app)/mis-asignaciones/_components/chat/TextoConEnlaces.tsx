"use client";

import { cn } from "@/lib/utils";
import { linkificar } from "@/lib/utils/linkificar";

// Feature 299 (R33/R34) — texto de una burbuja con las URL convertidas en enlace.
//
// SOLO el tramo de la URL es enlace (D6): el resto de la frase sigue siendo texto plano dentro
// del mismo parrafo. NUNCA se usa `dangerouslySetInnerHTML`: los segmentos llegan como datos
// (`linkificar`) y React los escapa al pintarlos como hijos, de modo que un mensaje con
// `<img onerror=...>` se VE, no se EJECUTA.

export interface TextoConEnlacesProps {
  texto: string;
  className?: string;
}

export function TextoConEnlaces({ texto, className }: Readonly<TextoConEnlacesProps>) {
  const segmentos = linkificar(texto);

  return (
    <p className={cn("whitespace-pre-wrap break-words leading-relaxed", className)}>
      {segmentos.map((segmento, indice) =>
        segmento.tipo === "enlace" ? (
          <a
            key={`${indice}-${segmento.href}`}
            href={segmento.href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:opacity-80"
          >
            {segmento.valor}
          </a>
        ) : (
          <span key={`${indice}-texto`}>{segmento.valor}</span>
        ),
      )}
    </p>
  );
}
