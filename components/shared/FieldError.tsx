import type { ReactNode } from "react";

export interface FieldErrorProps {
  /**
   * Id del bloque de error. Permite enlazarlo con el control desde
   * `aria-describedby` para que los lectores de pantalla lo anuncien.
   */
  id?: string;
  /**
   * Mensaje de error (texto o nodo). Si es nulo, `false` o vacío no se
   * renderiza nada. Úsese para un único mensaje; para varios, ver `messages`.
   */
  children?: ReactNode;
  /**
   * Lista de mensajes de error; cada uno se muestra en su propia línea.
   * Alternativa a `children` para validaciones que emiten varios mensajes.
   */
  messages?: string[];
}

/**
 * Bloque de error de campo accesible: un único `<p role="alert">` con el color
 * destructivo del sistema de diseño (DESIGN.md, «Componentes → FormField»).
 * Devuelve `null` cuando no hay error, para que el consumidor no tenga que
 * condicionar su presencia. El `id` lo enlaza con el control por
 * `aria-describedby`. `text-destructive` es la variante destructive de shadcn
 * mandada por DESIGN.md.
 */
export function FieldError({ id, children, messages }: FieldErrorProps) {
  if (messages && messages.length > 0) {
    return (
      <p id={id} role="alert" className="text-sm text-destructive">
        {messages.map((message, index) => (
          <span key={index} className="block">
            {message}
          </span>
        ))}
      </p>
    );
  }

  if (children == null || children === false || children === "") return null;

  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
}
