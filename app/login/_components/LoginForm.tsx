"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { login, verifyChallenge } from "@/lib/actions/auth";
import { OTP_CODE_LENGTH } from "@/lib/types/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

// Validación de cliente: email válido, password no vacía
const credentialsSchema = z.object({
  email: z.string().email("Correo electrónico inválido"),
  password: z.string().min(1, "La contraseña es requerida"),
});

// Validación de cliente: código de 6 dígitos
const codeSchema = z.object({
  code: z
    .string()
    .regex(/^\d{6}$/, "El código debe ser exactamente 6 dígitos numéricos"),
});

// Calcula el target de redirección validando el parámetro. El destino por
// defecto es `/dashboard` (feature 86, R14): la home autenticada se movió de `/`
// a `/dashboard`. Exportada para su prueba unitaria (R14, R15).
export function getRedirectTarget(redirectParam: string | null): string {
  if (!redirectParam) return "/dashboard";
  // Proteger contra open-redirect: debe empezar con / pero no con //
  if (typeof redirectParam === "string" && redirectParam.startsWith("/") && !redirectParam.startsWith("//")) {
    return redirectParam;
  }
  return "/dashboard";
}

export interface LoginFormProps {
  redirectParam: string | null;
}

export function LoginForm({ redirectParam }: LoginFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Estado del formulario de credenciales
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Estado de la fase actual
  const [phase, setPhase] = useState<"credentials" | "challenge">("credentials");

  // Estado de challenge OTP
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");

  // Estado de errores
  const [credentialsFieldErrors, setCredentialsFieldErrors] = useState<
    Record<string, string[]>
  >({});
  const [codeFieldErrors, setCodeFieldErrors] = useState<Record<string, string[]>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Referencias para gestionar el foco (R21, R22)
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  // Al montar, colocar el foco en el email (R21)
  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  // Mover el foco al primer campo con error (R22).
  // Recibe los errores recien calculados (variable local del handler que
  // llama a esta funcion), NUNCA el state, porque el state todavia no se
  // actualizo en el mismo render (closure obsoleto/"stale").
  const moveFocusToFirstError = (
    phase: "credentials" | "challenge",
    errors: Record<string, string[]>,
  ) => {
    if (phase === "credentials") {
      if (errors.email) {
        emailRef.current?.focus();
      } else if (errors.password) {
        passwordRef.current?.focus();
      }
    } else if (phase === "challenge") {
      if (errors.code) {
        codeRef.current?.focus();
      }
    }
  };

  // Manejar el envío del formulario de credenciales
  const handleSubmitCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setCredentialsFieldErrors({});

    // Validación de cliente (R3, R4)
    const result = credentialsSchema.safeParse({ email, password });
    if (!result.success) {
      const errors = result.error.flatten().fieldErrors as Record<string, string[]>;
      setCredentialsFieldErrors(errors);
      moveFocusToFirstError("credentials", errors);
      return;
    }

    // Invocar Server Action login (R5)
    startTransition(async () => {
      const loginResult = await login({ email, password });

      switch (loginResult.status) {
        case "ok":
          // R7: redirigir con lógica de redirect param
          router.push(getRedirectTarget(redirectParam));
          break;

        case "challenge_required":
          // R12: transicionar a fase challenge, guardar challengeId
          setChallengeId(loginResult.challengeId);
          setPhase("challenge");
          setCode("");
          setCodeFieldErrors({});
          // Mover el foco al campo de código tras la transición
          setTimeout(() => codeRef.current?.focus(), 0);
          break;

        case "invalid_credentials":
          // R8: mensaje de error genérico, permanecer en credenciales
          setGeneralError("Correo o contraseña inválidos");
          break;

        case "account_unavailable":
          // R9: error distinguible
          setGeneralError("Esta cuenta no está disponible para iniciar sesión");
          break;

        case "account_locked":
          // R10: incluir retryAfterMinutes
          setGeneralError(
            `Cuenta bloqueada. Intenta de nuevo en ${loginResult.retryAfterMinutes} minuto${loginResult.retryAfterMinutes > 1 ? "s" : ""}`
          );
          break;

        case "validation_error":
          // R11: mostrar errores por campo
          setCredentialsFieldErrors(loginResult.fieldErrors);
          moveFocusToFirstError("credentials", loginResult.fieldErrors);
          break;
      }
    });
  };

  // Manejar el envío del código de verificación
  const handleSubmitChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setCodeFieldErrors({});

    if (!challengeId) {
      setGeneralError("Sesión expirada. Intenta de nuevo");
      return;
    }

    // Validación de cliente (R14)
    const result = codeSchema.safeParse({ code });
    if (!result.success) {
      const errors = result.error.flatten().fieldErrors as Record<string, string[]>;
      setCodeFieldErrors(errors);
      moveFocusToFirstError("challenge", errors);
      return;
    }

    // Invocar Server Action verifyChallenge (R15)
    startTransition(async () => {
      const verifyChallengeResult = await verifyChallenge({ challengeId, code });

      switch (verifyChallengeResult.status) {
        case "ok":
          // R16: redirigir con la misma lógica que R7
          router.push(getRedirectTarget(redirectParam));
          break;

        case "otp_invalid":
          // R17: error, mantener fase y challengeId
          setGeneralError("El código es inválido o ha expirado");
          break;

        case "validation_error":
          // R18: errores por campo
          setCodeFieldErrors(verifyChallengeResult.fieldErrors);
          moveFocusToFirstError("challenge", verifyChallengeResult.fieldErrors);
          break;
      }
    });
  };

  if (phase === "credentials") {
    return (
      <Card className="w-full max-w-md border-t-4 border-t-brand p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-center text-navy dark:text-foreground">
            Iniciar sesión
          </h1>
        </div>

        {generalError && (
          <Alert variant="destructive" role="alert" aria-live="assertive">
            <AlertDescription>{generalError}</AlertDescription>
          </Alert>
        )}

        {/*
          noValidate: la validacion HTML5 nativa del navegador (p. ej. sobre
          type="email") interrumpe el envio antes de que se ejecute nuestro
          onSubmit y muestra un tooltip nativo en vez del error accesible
          (role="alert" + aria-describedby) que exigen R3/R4/R20. La
          validacion real es la de credentialsSchema (zod) + el servidor.
        */}
        <form onSubmit={handleSubmitCredentials} noValidate className="space-y-4">
          {/* Campo de email (R1, R19) */}
          <div className="space-y-2">
            <Label htmlFor="email">Correo electrónico</Label>
            <Input
              ref={emailRef}
              id="email"
              type="email"
              placeholder="tu@correo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isPending}
              aria-invalid={!!credentialsFieldErrors.email}
              aria-describedby={credentialsFieldErrors.email ? "email-error" : undefined}
            />
            {credentialsFieldErrors.email && (
              <div
                id="email-error"
                role="alert"
                className="text-sm text-destructive space-y-1"
              >
                {credentialsFieldErrors.email.map((msg, idx) => (
                  <div key={idx}>{msg}</div>
                ))}
              </div>
            )}
          </div>

          {/* Campo de password (R1, R19) */}
          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input
              ref={passwordRef}
              id="password"
              type="password"
              placeholder="Tu contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isPending}
              aria-invalid={!!credentialsFieldErrors.password}
              aria-describedby={credentialsFieldErrors.password ? "password-error" : undefined}
            />
            {credentialsFieldErrors.password && (
              <div
                id="password-error"
                role="alert"
                className="text-sm text-destructive space-y-1"
              >
                {credentialsFieldErrors.password.map((msg, idx) => (
                  <div key={idx}>{msg}</div>
                ))}
              </div>
            )}
          </div>

          {/* Botón de envío (R2, R6, R6a) */}
          <Button type="submit" loading={isPending} className="w-full">
            {isPending ? "Verificando..." : "Iniciar sesión"}
          </Button>
        </form>

        {/* Enlace al flujo de recuperación de contraseña (R18) */}
        <div className="text-center">
          <Link
            href="/recuperar-contrasena"
            className="text-sm text-muted-foreground hover:text-foreground underline"
          >
            ¿Olvidaste tu contraseña?
          </Link>
        </div>

        {/* Enlace a la postulación pública de mensajero (feature 21, afordancia) */}
        <div className="text-center">
          <Link
            href="/postulacion"
            className="text-sm text-muted-foreground hover:text-foreground underline"
          >
            ¿Quieres ser mensajero? Postúlate aquí
          </Link>
        </div>
      </Card>
    );
  }

  // Fase challenge (R12, R13)
  return (
    <Card className="w-full max-w-md border-t-4 border-t-brand p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-center text-navy dark:text-foreground">
          Verificar código
        </h1>
        <p className="text-sm text-muted-foreground text-center mt-2">
          Se ha enviado un código de 6 dígitos a tu correo electrónico
        </p>
      </div>

      {generalError && (
        <Alert variant="destructive" role="alert" aria-live="assertive">
          <AlertDescription>{generalError}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmitChallenge} noValidate className="space-y-4">
        {/* Campo de código (R13, R19) */}
        <div className="space-y-2">
          <Label htmlFor="code">Código de verificación</Label>
          <Input
            ref={codeRef}
            id="code"
            type="text"
            inputMode="numeric"
            placeholder="000000"
            maxLength={OTP_CODE_LENGTH}
            value={code}
            onChange={(e) => {
              // Solo permitir dígitos
              const filtered = e.target.value.replace(/\D/g, "");
              setCode(filtered);
            }}
            disabled={isPending}
            aria-invalid={!!codeFieldErrors.code}
            aria-describedby={codeFieldErrors.code ? "code-error" : undefined}
          />
          {codeFieldErrors.code && (
            <div
              id="code-error"
              role="alert"
              className="text-sm text-destructive space-y-1"
            >
              {codeFieldErrors.code.map((msg, idx) => (
                <div key={idx}>{msg}</div>
              ))}
            </div>
          )}
        </div>

        {/* Botón de envío del código (R6, R6a) */}
        <Button type="submit" loading={isPending} className="w-full">
          {isPending ? "Verificando..." : "Verificar código"}
        </Button>
      </form>

      {/* Link para volver a credenciales (afordancia UX, no es requisito) */}
      <button
        type="button"
        onClick={() => {
          setPhase("credentials");
          setChallengeId(null);
          setCode("");
          setGeneralError(null);
          setCodeFieldErrors({});
          emailRef.current?.focus();
        }}
        disabled={isPending}
        className="w-full text-sm text-muted-foreground hover:text-foreground underline disabled:opacity-50"
      >
        Volver a correo y contraseña
      </button>
    </Card>
  );
}
