"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Feature 286 — el campo de contraseña con su ojito, y LA única maqueta de contraseña
 * del repo.
 *
 * Los seis campos de contraseña de la app (login, postulación ×2, recuperación ×2 y alta
 * de usuario) pasan por aquí. NINGÚN otro archivo de `app/` ni de `components/` declara
 * `type="password"`, y hay una guardia que lo vigila
 * (`tests/unit/guards/contrasena-maqueta-unica.guardia.test.ts`) porque seis toggles
 * copiados divergen: el repo ya pagó esa factura con los dos generadores de etiquetas PDF
 * que se declaraban «espejo EXACTO» y llevaban una feature entera sin serlo.
 *
 * ## Decisiones que no son de gusto
 *
 * - **El estado es POR CAMPO, y vive aquí dentro.** En postulación y en recuperación hay
 *   dos campos en la misma pantalla: revelar «Contraseña» NO revela «Confirmar
 *   contraseña». Se expone menos (sólo se destapa el campo que se está comprobando), es
 *   lo que hace el revelar nativo del navegador, y —lo que manda— con el estado aquí
 *   dentro los seis usos son una sustitución directa y ningún formulario gana estado
 *   nuevo.
 * - **`type="button"`, y es el requisito más barato de romper.** Un `<button>` sin él,
 *   dentro de un `<form>`, ENVÍA el formulario: pulsar el ojito dispararía la Server
 *   Action. Se verifica con un espía en `onSubmit` y `not.toHaveBeenCalled()`.
 * - **El botón va DESPUÉS del input en el DOM.** Así `Tab` recorre `campo → su ojito →
 *   siguiente` sin un solo `tabindex`. Esto CAMBIA el orden de tabulación del login
 *   (`correo → contraseña → ojito → «Iniciar sesión»`) y ese test se amplió, no se
 *   relajó: la alternativa era `tabIndex={-1}`, que deja el control fuera del teclado —lo
 *   contrario de lo que se pidió y de lo que exige WCAG 2.1.1—.
 * - **`type` está FUERA del tipo de props** (`Omit<…, "type">`): lo decide el componente y
 *   un consumidor no puede volver a fijarlo. Es la mitad de la guardia de maqueta única,
 *   hecha por el compilador.
 * - **Todo lo demás viaja al `<input>` tal cual** —`id`, `value`, `onChange`, `disabled`,
 *   `placeholder`, `ref`, `aria-invalid`, `aria-describedby`, `aria-required`—, así que
 *   sirve en los DOS modos de `FormField`: como hijo-elemento (le clona esas props) y
 *   como render-prop. En React 19 `ref` es una prop normal y viaja con el resto del
 *   spread; de eso dependen los dos formularios que mueven el foco al campo con error.
 *
 * ## Accesibilidad
 *
 * - **`<Button>` de la casa**, no un `<button>` a mano (`DESIGN.md`): trae el anillo de
 *   foco estándar y el `disabled`. Renderiza un `<button>` nativo.
 * - **Nombre accesible con estado Y acción, distinto por campo**: «Contraseña: oculta.
 *   Mostrar.». Dos ojitos en la misma pantalla no pueden llamarse igual, o hay que
 *   adivinar cuál es cuál. Sigue el precedente de `TemaToggle`.
 * - **Región viva que anuncia el estado YA aplicado**: cambiar el `aria-label` de un botón
 *   que está enfocado no se re-anuncia de forma fiable en todos los lectores. Es el mismo
 *   razonamiento, ya medido, de `TemaToggle`.
 * - **SIN `role`, a propósito.** Un `role="status"` permanente volvió ambiguo el
 *   `getByRole("status")` de otras suites (medido: rompió dos), y `role="alert"` sería
 *   peor: `LoginForm.test.tsx` hace `findByRole("alert")` EN SINGULAR y `FieldError` ya
 *   emite uno por campo con error. `aria-live` es el mecanismo real; el `role` sólo lo
 *   implica.
 * - **Vacía en el primer render**: una región viva con texto desde el montaje puede
 *   anunciarse sola en algunos lectores, y no hay nada que anunciar antes de que la
 *   persona actúe.
 *
 * ## Color, medido y no supuesto
 *
 * El icono es un indicador NO textual: WCAG 1.4.11 pide 3:1 contra su fondo.
 * `text-muted-foreground` medido con `tests/fixtures/contraste.ts` sobre las dos
 * superficies donde vive y en los dos temas: **7,25** (claro/`--background`), **7,70**
 * (claro/`--card`), **8,11** (oscuro/`--background`) y **7,21** (oscuro/`--card`). Las
 * cuatro por encima de 3, con margen. El test que lo sostiene está en
 * `tests/components/PasswordInput.test.tsx`.
 *
 * ## Límite conocido, dicho antes y no después
 *
 * `[&::-ms-reveal]:hidden` neutraliza el ojito NATIVO que Edge pinta sobre los
 * `input[type=password]`; sin él esa pantalla mostraría DOS ojitos pegados. jsdom no tiene
 * ese pseudo-elemento, así que **ningún test lo prueba**: se comprueba mirando la app o
 * queda declarado como pendiente. No se afirma como verificado.
 */
export interface PasswordInputProps
  extends Omit<React.ComponentProps<"input">, "type"> {
  /**
   * Etiqueta VISIBLE del campo («Contraseña», «Confirmar contraseña», «Nueva
   * contraseña»). Entra en el nombre accesible del botón y en el anuncio, para que dos
   * ojitos de la misma pantalla no se llamen igual. Obligatoria a propósito: si fuera
   * opcional con valor por defecto, un consumidor nuevo enviaría en silencio dos botones
   * indistinguibles.
   */
  etiqueta: string;
}

export function PasswordInput({
  etiqueta,
  className,
  disabled,
  id,
  ...resto
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  // Guarda si ya hubo una pulsación: la región viva arranca vacía (nada que anunciar
  // antes de que la persona actúe).
  const [tocado, setTocado] = useState(false);

  const nombreAccesible = visible
    ? `${etiqueta}: visible. Ocultar.`
    : `${etiqueta}: oculta. Mostrar.`;

  return (
    <div className="relative">
      <Input
        {...resto}
        id={id}
        disabled={disabled}
        type={visible ? "text" : "password"}
        className={cn("pr-8 [&::-ms-reveal]:hidden", className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        aria-label={nombreAccesible}
        aria-controls={id}
        onClick={() => {
          setVisible((v) => !v);
          setTocado(true);
        }}
        className="absolute top-1/2 right-0.5 -translate-y-1/2 text-muted-foreground"
      >
        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
      <span
        aria-live="polite"
        aria-atomic="true"
        data-contrasena-anuncio=""
        className="sr-only"
      >
        {tocado ? (visible ? `${etiqueta} visible` : `${etiqueta} oculta`) : ""}
      </span>
    </div>
  );
}
