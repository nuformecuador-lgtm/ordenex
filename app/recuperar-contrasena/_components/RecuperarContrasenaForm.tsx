"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  solicitarRecuperacion,
  verificarCodigoRecuperacion,
  restablecerContrasena,
} from "@/lib/actions/password-reset";
import { OTP_CODE_LENGTH } from "@/lib/types/auth";
import { strongPasswordSchema } from "@/lib/types/password-policy";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FormField } from "@/components/shared/FormField";

// Fases del flujo (R16/R17): email -> code -> password -> done.
type Phase = "email" | "code" | "password" | "done";

// Validaciones de cliente: feedback temprano. La validacion fuerte real la hace
// el backend; aqui se reutilizan los mismos schemas para no duplicar reglas.
const emailSchema = z.object({
  email: z.string().email("Correo electrónico inválido"),
});

const codeSchema = z.object({
  code: z
    .string()
    .regex(
      new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`),
      `El código debe ser exactamente ${OTP_CODE_LENGTH} dígitos numéricos`,
    ),
});

// Mensaje generico para el paso 2/3: nunca distingue la causa ni revela
// existencia de la cuenta (R6/R11 + seguridad).
const GENERIC_INVALID_MESSAGE = "El código es inválido o ha expirado. Verifica e intenta de nuevo";

export function RecuperarContrasenaForm() {
  const [isPending, startTransition] = useTransition();

  const [phase, setPhase] = useState<Phase>("email");

  // Estado conservado entre fases (email + codigo).
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Errores por fase.
  const [emailFieldErrors, setEmailFieldErrors] = useState<Record<string, string[]>>({});
  const [codeFieldErrors, setCodeFieldErrors] = useState<Record<string, string[]>>({});
  const [passwordFieldErrors, setPasswordFieldErrors] = useState<Record<string, string[]>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Foco inicial en el email al montar.
  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  // Paso 1 (R1/R12): solicitar recuperacion. Respuesta siempre generica: se
  // avanza a la fase de codigo tanto si el email existe como si no.
  const handleSubmitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setEmailFieldErrors({});

    const result = emailSchema.safeParse({ email });
    if (!result.success) {
      const errors = result.error.flatten().fieldErrors as Record<string, string[]>;
      setEmailFieldErrors(errors);
      emailRef.current?.focus();
      return;
    }

    startTransition(async () => {
      const res = await solicitarRecuperacion({ email });

      switch (res.status) {
        case "ok":
          setPhase("code");
          setCode("");
          setCodeFieldErrors({});
          setTimeout(() => codeRef.current?.focus(), 0);
          break;
        case "validation_error":
          setEmailFieldErrors(res.fieldErrors);
          emailRef.current?.focus();
          break;
      }
    });
  };

  // Paso 2 (R5/R6): verificar codigo. Error generico ante cualquier fallo.
  const handleSubmitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setCodeFieldErrors({});

    const result = codeSchema.safeParse({ code });
    if (!result.success) {
      const errors = result.error.flatten().fieldErrors as Record<string, string[]>;
      setCodeFieldErrors(errors);
      codeRef.current?.focus();
      return;
    }

    startTransition(async () => {
      const res = await verificarCodigoRecuperacion({ email, code });

      switch (res.status) {
        case "ok":
          setPhase("password");
          setPassword("");
          setConfirmPassword("");
          setPasswordFieldErrors({});
          setTimeout(() => passwordRef.current?.focus(), 0);
          break;
        case "invalid_or_expired":
          setGeneralError(GENERIC_INVALID_MESSAGE);
          break;
        case "validation_error":
          setCodeFieldErrors(res.fieldErrors);
          codeRef.current?.focus();
          break;
      }
    });
  };

  // Paso 3 (R7/R8/R9/R10/R11): definir nueva contrasena + confirmacion.
  const handleSubmitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setPasswordFieldErrors({});

    // Feedback temprano reutilizando la politica fuerte (R8) y la coincidencia (R7).
    const clientErrors: Record<string, string[]> = {};
    const strong = strongPasswordSchema.safeParse(password);
    if (!strong.success) {
      clientErrors.password = strong.error.issues.map((i) => i.message);
    }
    if (password !== confirmPassword) {
      clientErrors.confirmPassword = ["Las contraseñas no coinciden"];
    }
    if (Object.keys(clientErrors).length > 0) {
      setPasswordFieldErrors(clientErrors);
      if (clientErrors.password) {
        passwordRef.current?.focus();
      }
      return;
    }

    startTransition(async () => {
      const res = await restablecerContrasena({
        email,
        code,
        password,
        confirmPassword,
      });

      switch (res.status) {
        case "ok":
          setPhase("done");
          break;
        case "invalid_or_expired":
          // El desafio dejo de estar activo: mensaje generico, sin tocar la contrasena.
          setGeneralError(GENERIC_INVALID_MESSAGE);
          break;
        case "validation_error":
          setPasswordFieldErrors(res.fieldErrors);
          passwordRef.current?.focus();
          break;
      }
    });
  };

  // Fase 4 (R17): confirmacion de exito + enlace de regreso al login.
  if (phase === "done") {
    return (
      <Card className="w-full max-w-md border-t-4 border-t-brand p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-center text-navy dark:text-foreground">
            Contraseña actualizada
          </h1>
          <p className="text-sm text-muted-foreground text-center mt-2">
            Tu contraseña se restableció correctamente. Ya puedes iniciar sesión con tu
            nueva contraseña.
          </p>
        </div>
        <Link href="/login" className={buttonVariants({ className: "w-full" })}>
          Ir a iniciar sesión
        </Link>
      </Card>
    );
  }

  // Fase 1: email.
  if (phase === "email") {
    return (
      <Card className="w-full max-w-md border-t-4 border-t-brand p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-center text-navy dark:text-foreground">
            Recuperar contraseña
          </h1>
          <p className="text-sm text-muted-foreground text-center mt-2">
            Ingresa tu correo y, si existe una cuenta, te enviaremos un código de
            verificación.
          </p>
        </div>

        {generalError && (
          <Alert variant="destructive" role="alert" aria-live="assertive">
            <AlertDescription>{generalError}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmitEmail} noValidate className="space-y-4">
          <FormField
            id="reset-email"
            label="Correo electrónico"
            error={emailFieldErrors.email}
          >
            {(control) => (
              <Input
                {...control}
                ref={emailRef}
                type="email"
                placeholder="tu@correo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isPending}
              />
            )}
          </FormField>

          <Button type="submit" loading={isPending} className="w-full">
            {isPending ? "Enviando..." : "Enviar código"}
          </Button>
        </form>

        <div className="text-center">
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground underline"
          >
            Volver a iniciar sesión
          </Link>
        </div>
      </Card>
    );
  }

  // Fase 2: codigo.
  if (phase === "code") {
    return (
      <Card className="w-full max-w-md border-t-4 border-t-brand p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-center text-navy dark:text-foreground">
            Verificar código
          </h1>
          <p className="text-sm text-muted-foreground text-center mt-2">
            Si el correo corresponde a una cuenta, recibirás un código de{" "}
            {OTP_CODE_LENGTH} dígitos.
          </p>
        </div>

        {generalError && (
          <Alert variant="destructive" role="alert" aria-live="assertive">
            <AlertDescription>{generalError}</AlertDescription>
          </Alert>
        )}

        <form onSubmit={handleSubmitCode} noValidate className="space-y-4">
          <FormField
            id="reset-code"
            label="Código de verificación"
            error={codeFieldErrors.code}
          >
            {(control) => (
              <Input
                {...control}
                ref={codeRef}
                type="text"
                inputMode="numeric"
                placeholder="000000"
                maxLength={OTP_CODE_LENGTH}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                disabled={isPending}
              />
            )}
          </FormField>

          <Button type="submit" loading={isPending} className="w-full">
            {isPending ? "Verificando..." : "Verificar código"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => {
            setPhase("email");
            setCode("");
            setGeneralError(null);
            setCodeFieldErrors({});
            setTimeout(() => emailRef.current?.focus(), 0);
          }}
          disabled={isPending}
          className="w-full text-sm text-muted-foreground hover:text-foreground underline disabled:opacity-50"
        >
          Volver a ingresar el correo
        </button>
      </Card>
    );
  }

  // Fase 3: nueva contrasena + confirmacion.
  return (
    <Card className="w-full max-w-md border-t-4 border-t-brand p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-center text-navy dark:text-foreground">
          Nueva contraseña
        </h1>
        <p className="text-sm text-muted-foreground text-center mt-2">
          Debe tener al menos 8 caracteres e incluir mayúscula, minúscula, dígito y
          símbolo.
        </p>
      </div>

      {generalError && (
        <Alert variant="destructive" role="alert" aria-live="assertive">
          <AlertDescription>{generalError}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmitPassword} noValidate className="space-y-4">
        <FormField
          id="reset-password"
          label="Nueva contraseña"
          error={passwordFieldErrors.password}
        >
          {(control) => (
            <Input
              {...control}
              ref={passwordRef}
              type="password"
              placeholder="Tu nueva contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isPending}
            />
          )}
        </FormField>

        <FormField
          id="reset-confirm-password"
          label="Confirmar contraseña"
          error={passwordFieldErrors.confirmPassword}
        >
          <Input
            type="password"
            placeholder="Repite la contraseña"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={isPending}
          />
        </FormField>

        <Button type="submit" loading={isPending} className="w-full">
          {isPending ? "Guardando..." : "Restablecer contraseña"}
        </Button>
      </form>
    </Card>
  );
}
