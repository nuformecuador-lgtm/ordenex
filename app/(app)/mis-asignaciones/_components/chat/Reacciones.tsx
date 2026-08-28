import { cn } from "@/lib/utils";
import type { ReaccionAgregada } from "@/lib/utils/chat-reacciones";

// Feature 308 (R30, D4) — chips de reaccion ANCLADOS a la burbuja del mensaje reaccionado.
//
// En WhatsApp una reaccion pertenece al mensaje al que reacciona: un "👍" suelto cinco burbujas
// mas abajo no dice a que reacciono el cliente. Por eso este componente se renderiza DENTRO del
// mismo `<li>` que la burbuja objetivo y el hilo NO trae ninguna burbuja de tipo `reaccion`
// (`listarHiloChat` ya las agrega aqui, R19).

export interface ReaccionesProps {
  reacciones: readonly ReaccionAgregada[];
  /** La burbuja saliente va a la derecha: sus chips tambien. */
  saliente: boolean;
}

export function Reacciones({ reacciones, saliente }: Readonly<ReaccionesProps>) {
  if (reacciones.length === 0) return null;

  return (
    <div
      className={cn(
        "-mt-1 flex gap-0.5",
        saliente ? "justify-end pr-2" : "justify-start pl-2",
      )}
    >
      {reacciones.map((reaccion) => (
        <span
          key={reaccion.emoji}
          // `role="img"` + `aria-label`: en un `<span>` pelado el `aria-label` se ignora, y el
          // lector de pantalla leeria el emoji crudo.
          role="img"
          aria-label={`Reaccionó con ${reaccion.emoji}`}
          className="z-10 flex items-center gap-0.5 rounded-full border border-border bg-card px-1.5 py-0.5 text-xs leading-none shadow-sm"
        >
          {reaccion.emoji}
          {reaccion.conteo > 1 ? (
            <span className="text-[10px] text-muted-foreground">{reaccion.conteo}</span>
          ) : null}
        </span>
      ))}
    </div>
  );
}
