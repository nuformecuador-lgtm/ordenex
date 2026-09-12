"use client";

import { useId } from "react";
import { BellRing, Share } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { usePushSuscripcion } from "@/hooks/usePushSuscripcion";

/**
 * FICHA 410 (tanda 5, T5.2 — R11-R15, R45, R46) — EL INTERRUPTOR DE «AVISARME EN ESTE DISPOSITIVO».
 *
 * Vive DENTRO del panel de la campana, que es el único sitio al que llega alguien que ya está
 * mirando sus avisos y por tanto el único donde pedir el permiso tiene contexto. No se pide nada al
 * cargar la app (R10): el permiso sale del gesto de tocar este interruptor y de ningún otro sitio.
 *
 * ## ⚠️ EL HUECO NUNCA SE QUEDA VACÍO, Y ESO ESTÁ MEDIDO (R45, D6)
 *
 * En iPhone el push web solo existe si la aplicación está **instalada en la pantalla de inicio**:
 * en una pestaña normal de Safari `PushManager` no existe y no hay interruptor que ofrecer. Medido
 * el 2026-09-10 sobre los ingresos reales: **8 personas entran desde iPhone o iPad y 3 usan SOLO
 * iOS — las tres, mensajeras**. Esas tres van a buscar el interruptor al mismo sitio que las otras
 * 36; si ahí no hay nada, la conclusión razonable es que la aplicación está rota.
 *
 * Por eso el caso «no soportado» NO devuelve `null`: devuelve **la instrucción de instalar, en el
 * hueco exacto del control**. Es la diferencia entre «esto está averiado» y «me falta un paso que
 * puedo dar».
 *
 * Lo único que sí desaparece del todo es el caso sin canal configurado (R13): sin claves no hay
 * push en ningún navegador, y mandar a alguien a instalar la app para nada sería peor que callar.
 */

/** Los textos del control, juntos y en un solo sitio: i18n-ready sin librería (patrón del repo). */
const TEXTOS = {
  /** R14 — el estado de ESTE dispositivo, dicho con palabras y no con un color. */
  sinActivar: "Avisarme en este dispositivo",
  activado: "Activado en este dispositivo",
  bloqueado: "Bloqueado por el navegador",
  /**
   * La explicación va ANTES del clic, no después: quien toca el interruptor ya sabe qué se le va a
   * avisar y cada cuánto. Sin siglas y sin jerga (regla vigente del repo).
   *
   * FICHA 422 (T5.3 — R25, R26) — LA TERCERA FRASE ES NUEVA, y cierra el hueco que el humano
   * reportó: el texto contaba cuándo te avisa y se callaba qué pasa al cerrar sesión. Dice las dos
   * mitades —qué pasa al salir y qué pasa al volver— **sin** pedirle a nadie que entienda qué es
   * una suscripción ni un permiso del navegador (R26). Y lo que promete es verdad exactamente en
   * el caso en que la reactivación funciona: el mismo dispositivo, con el permiso ya concedido.
   *
   * ⚠️ Escrita en TUTEO, como el resto de este archivo («Te avisamos», «tengas», «abre los
   * ajustes»). El diseño la proponía en voseo por el registro de los avisos del canal («Tenés un
   * aviso nuevo»), pero mezclar los dos registros DENTRO del mismo control se lee como un descuido.
   * La redacción sigue pendiente del visto bueno de P3: cambiarla es esta línea y el literal que la
   * fija en `PushOptIn.test.tsx`, y nada más.
   */
  ayuda:
    "Te avisamos en este teléfono o computadora cuando algo tenga una fecha límite o dinero de por medio, aunque tengas la aplicación cerrada. Como mucho un aviso al día de cada tipo. Si cierras sesión dejamos de avisarte aquí, y volvemos a hacerlo cuando entres de nuevo en este dispositivo.",
  /** R12 — cómo se revierte un «no». El navegador no deja volver a preguntar. */
  comoDesbloquear:
    "Bloqueaste los avisos para este sitio y el navegador no deja volver a pedírtelos. Para recibirlos, abre los ajustes del navegador, busca los permisos de este sitio y permite las notificaciones.",
  /** R45 — la instrucción que ven las tres personas que solo entran desde iPhone. */
  instalarTitulo: "Agrega Ordenex a tu pantalla de inicio",
  instalarPasos:
    "En este dispositivo los avisos solo llegan si la aplicación está instalada. Toca Compartir y luego «Agregar a inicio»; después vuelve aquí y actívalos.",
} as const;

export interface PushOptInProps {
  className?: string;
}

export function PushOptIn({ className }: PushOptInProps) {
  const { estado, ocupado, activar, desactivar } = usePushSuscripcion();
  const idControl = useId();
  const idAyuda = useId();

  // R13: mientras no se sepa, y cuando no hay canal, no se pinta NADA. Un control que aparece y
  // desaparece al segundo es peor que uno que tarda un instante en aparecer.
  if (estado === "cargando" || estado === "sin-canal") return null;

  if (estado === "no-soportado") {
    return (
      <div
        className={cn(
          "flex items-start gap-2.5 border-t border-border bg-muted/40 px-4 py-3",
          className,
        )}
      >
        <Share className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-xs font-semibold">{TEXTOS.instalarTitulo}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {TEXTOS.instalarPasos}
          </p>
        </div>
      </div>
    );
  }

  const bloqueado = estado === "bloqueado";
  const activado = estado === "activado";
  const etiqueta = bloqueado
    ? TEXTOS.bloqueado
    : activado
      ? TEXTOS.activado
      : TEXTOS.sinActivar;

  return (
    <div
      className={cn("flex flex-col gap-1.5 border-t border-border bg-muted/40 px-4 py-3", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={idControl} className="flex items-center gap-2 text-xs font-semibold">
          <BellRing className="size-4 text-muted-foreground" aria-hidden="true" />
          {etiqueta}
        </Label>
        <Switch
          id={idControl}
          // El nombre accesible es EL MISMO texto visible: quien navega por voz dice lo que lee.
          aria-label={etiqueta}
          aria-describedby={idAyuda}
          checked={activado}
          // R12: bloqueado por el navegador, el interruptor no se puede tocar. Volver a llamar a
          // `requestPermission` sería un no-op y dejaría la sensación de que el control no responde.
          disabled={bloqueado || ocupado}
          onCheckedChange={(siguiente) => {
            // R11: AQUÍ empieza el único camino que llega a `Notification.requestPermission()`.
            void (siguiente ? activar() : desactivar());
          }}
        />
      </div>
      <p id={idAyuda} className="text-xs leading-relaxed text-muted-foreground">
        {bloqueado ? TEXTOS.comoDesbloquear : TEXTOS.ayuda}
      </p>
    </div>
  );
}
