import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * AVISO QUE SUSTITUYE AL FORMULARIO DE RECUPERACIÓN — desactivación del 2026-09-04.
 *
 * ── POR QUÉ EXISTE ESTA PANTALLA (la causa real, medida, no una sospecha)
 * El paso 1 de `/recuperar-contrasena` emite un OTP por correo y ese envío **falla siempre**:
 * el SMTP de Gmail rechaza la credencial con `535-5.7.8 Username and Password not accepted`
 * (`EAUTH`, `responseCode: 535`, comando `AUTH PLAIN`). Y falla EN SILENCIO, que es lo grave:
 * ese paso responde SIEMPRE un `ok` genérico —por diseño, para no revelar si la cuenta
 * existe—, así que la persona pide el código, no le llega nada, y vuelve a pedirlo.
 * Medido en producción el 2026-09-04: **12 intentos de 2 personas reales** (8 de una cuenta
 * en menos de dos horas, 4 de otra el 31 de agosto) y ninguna se enteró de nada.
 *
 * ── QUÉ DICE, Y POR QUÉ ESO
 * Da la salida que SÍ funciona hoy: un administrador restablece la contraseña desde
 * Configuración → Usuarios (ficha 287, `UsuarioService.restablecerContrasena`, que existe
 * precisamente porque el correo está caído y no toca el proveedor ni para fallar).
 * No dice «vuelve más tarde» ni enseña un error técnico: quien llega aquí necesita saber
 * A QUIÉN ACUDIR, no de qué murió el SMTP.
 *
 * ── ESTO ES UNA DESACTIVACIÓN, NO UN BORRADO
 * El backend del flujo (`lib/actions/password-reset.ts`, `lib/services/PasswordResetService.ts`,
 * `lib/services/OtpChallengeIssuer.ts`, `lib/types/password-reset.ts`) y el propio
 * `RecuperarContrasenaForm.tsx` siguen en el repo, intactos y con sus tests en verde.
 * La ruta sigue siendo pública en `middleware.ts`: si se cerrara, quien tenga el enlace
 * guardado acabaría en `/login` sin explicación, que es el callejón que esto evita.
 *
 * ── CÓMO SE VUELVE A ENCENDER (dos líneas, cuando el correo funcione)
 * El arreglo de fondo es del correo, no del código: generar una contraseña de aplicación en
 * Google y ponerla en la credencial SMTP. Hecho eso:
 *   1. `app/recuperar-contrasena/page.tsx` → montar `<RecuperarContrasenaForm />` en lugar de
 *      `<RecuperacionDesactivadaAviso />` (y devolver el subtítulo del panel de marca).
 *   2. `app/login/_components/LoginForm.tsx` → devolver el enlace «¿Olvidaste tu contraseña?»
 *      hacia `/recuperar-contrasena` (el bloque comentado indica el sitio exacto).
 * Los tests que hay que revertir con ello están señalados en
 * `tests/integration/login-form-reset-link.test.tsx` y
 * `tests/integration/recuperar-contrasena-page.test.tsx`.
 */
export function RecuperacionDesactivadaAviso() {
  return (
    <Card className="w-full max-w-md border-t-4 border-t-brand p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-center text-foreground">
          ¿Olvidaste tu contraseña?
        </h1>
        <p className="text-sm text-muted-foreground text-center mt-2">
          Para recuperar tu contraseña, pídele a un administrador que te la restablezca.
        </p>
      </div>

      <Link href="/login" className={buttonVariants({ className: "w-full" })}>
        Volver a iniciar sesión
      </Link>
    </Card>
  );
}
