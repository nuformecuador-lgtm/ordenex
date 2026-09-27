"use client";

import { Badge } from "@/components/ui/badge";
import {
  segmentosDelMensaje,
  type SegmentoMensaje,
} from "@/components/shared/sinpe-preview-segmentos";
import { SINPE_PREVIEW } from "@/components/shared/sinpe-textos";

/**
 * ⭑ FICHA 429 (T21) — LA VISTA PREVIA DEL MENSAJE REAL. ES LA PIEZA CENTRAL DE LA PANTALLA.
 *
 * No es un adorno ni una ayuda visual: es lo unico que convierte un fallo mudo en uno visible. Un
 * numero de ocho digitos valido pero AJENO pasa todas las validaciones —el `CHECK` de Postgres,
 * el zod del borde, el formulario— y no produce ni un error; lo que lo delata es leer el numero y
 * el titular JUNTOS, en la frase que el cliente va a recibir. SINPE Movil le enseña al cliente el
 * titular al teclear el numero: si no coincide con lo que dice el mensaje, no transfiere.
 *
 * ⚠️ SE ACTUALIZA CON LO QUE SE ESCRIBE, y a proposito enseña lo TECLEADO sin normalizar: si
 * alguien escribe `8888 1111`, aqui se ve `8888 1111`. Normalizarlo en vivo escondería el unico
 * momento en que la persona puede notar que se equivocó de campo.
 *
 * ⚠️ EL CUERPO LO APORTA EL SERVIDOR y no se hornea aqui. Si no se pudo leer, se dice —no se
 * inventa una frase—: un mensaje de mentira en la pantalla que existe para comparar contra el
 * mensaje de verdad es peor que no tener pantalla.
 *
 * TOKENS: el resaltado usa `bg-accent` / `text-accent-foreground`, que GIRAN los dos con el tema
 * (DESIGN.md, «tokens que giran y tokens fijos»). Nada de hex sueltos ni de un `bg-orange-100`.
 */
export interface SinpeMensajePreviewProps {
  /** Cuerpo REAL de la plantilla que lleva el par. `null` = no se pudo leer. */
  cuerpoPlantilla: string | null;
  numero: string;
  nombre: string;
}

export function SinpeMensajePreview({
  cuerpoPlantilla,
  numero,
  nombre,
}: Readonly<SinpeMensajePreviewProps>) {
  const segmentos = segmentosDelMensaje(cuerpoPlantilla, numero, nombre);

  return (
    <section
      aria-labelledby="sinpe-preview-titulo"
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex items-center gap-2">
        <Badge variant="info">{SINPE_PREVIEW.chip}</Badge>
        <h3 id="sinpe-preview-titulo" className="text-sm font-semibold">
          {SINPE_PREVIEW.titulo}
        </h3>
      </div>

      {segmentos.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          {SINPE_PREVIEW.sinPlantilla}
        </p>
      ) : (
        // `aria-live="polite"`: el mensaje cambia mientras se teclea, y quien usa lector de
        // pantalla tiene el mismo derecho a enterarse de que cambió que quien lo ve.
        <p
          aria-live="polite"
          data-testid="sinpe-preview-mensaje"
          className="rounded-lg bg-muted/60 p-3 text-sm leading-relaxed whitespace-pre-wrap text-foreground"
        >
          {segmentos.map((segmento, indice) => (
            <Trozo key={indice} segmento={segmento} />
          ))}
        </p>
      )}

      {segmentos.length === 0 ? null : (
        <p className="text-xs text-muted-foreground">
          {SINPE_PREVIEW.leyendaMarcas}
        </p>
      )}

      <p className="max-w-prose text-xs text-muted-foreground">
        {SINPE_PREVIEW.pie}
      </p>
    </section>
  );
}

/**
 * Un trozo del mensaje. Los dos resaltados van en `<mark>`, que es la semantica HTML exacta de
 * «esto es lo relevante de esta frase» y tiene rol ARIA propio (`mark`): el resaltado no es solo
 * un color, existe tambien para quien no ve la pantalla.
 *
 * ⚠️ NO SE METE UN ROTULO `sr-only` DENTRO DE LA FRASE, y se probo: partia la oracion en dos
 * («…al numero NUMERO SINPE DENTRO DEL MENSAJE: 80000000 a nombre de…») y, como el parrafo es una
 * region `aria-live`, ese ripio se re-anunciaba ENTERO en cada tecla. Lo que hay que poder leer
 * aqui es la frase que recibe el cliente, tal cual; el rotulo de que es cada resaltado va fuera,
 * en el pie del panel.
 *
 * `min-w-6` cuando el valor esta vacio: el hueco tiene que VERSE. Un resaltado de ancho cero es
 * indistinguible de «no hay resaltado», y el hueco es exactamente lo que el cliente leeria.
 */
function Trozo({ segmento }: Readonly<{ segmento: SegmentoMensaje }>) {
  if (segmento.tipo === "texto") return <>{segmento.texto}</>;

  return (
    <mark
      data-campo={segmento.tipo === "numero" ? "sinpe-numero" : "sinpe-nombre"}
      className={`inline-block rounded-sm bg-accent px-1 font-medium text-accent-foreground ${
        segmento.texto === "" ? "min-w-6" : ""
      }`}
    >
      {segmento.texto}
    </mark>
  );
}
