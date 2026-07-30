"use client";

import { useEffect, useRef } from "react";

import { leerPreferenciaSonido } from "@/lib/audio/preferencia-sonido";
import { prepararAudio, reproducirTono } from "@/lib/audio/tono-notificacion";

// Feature 161 (design §2.2) — disparo del tono de aviso in-app. Hook UNICO para las dos
// superficies (campana y chat): la logica de "subio el contador" es identica, y asi
// R10-R14 se testean una sola vez.
//
// No hay realtime en el repo (R47 de la feature 146): el contador lo mueve el polling de
// SWR, cada 60 s en la campana y cada 10 s en el hilo del chat. El hook solo mira el delta.

/**
 * Emite el tono cuando `contador` CRECE respecto de la evaluacion anterior.
 *
 * `contador` es `null` MIENTRAS el dato no esta disponible (primer render antes de que el
 * fetch resuelva, o lectura fallida). Ese caso se IGNORA por completo: no suena y no fija
 * referencia (R24). Sin esto, la primera carga se leeria como un salto de 0 a N y sonaria
 * al abrir un hilo con mensajes previos o al recargar la pagina con avisos pendientes.
 *
 * - La primera evaluacion con dato CARGADO nunca suena (R11): solo fija la referencia.
 * - Bajadas y repeticiones no suenan (R12): marcar todas como leidas deja el contador en
 *   cero y no dispara nada.
 * - Un salto de varias unidades suena UNA vez, no una por unidad (R13).
 */
export function useTonoAlIncrementar(contador: number | null): void {
  const previo = useRef<number | null>(null);

  // R7: el contexto de audio se prepara con el primer gesto del usuario. `prepararAudio`
  // es idempotente, asi que varias superficies montadas no acumulan listeners.
  useEffect(() => {
    prepararAudio();
  }, []);

  useEffect(() => {
    // R24: dato aun no disponible. Se sale ANTES de tocar la referencia, para no perderla
    // por una lectura fallida transitoria: si se sobrescribiera con `null`, la subida real
    // que llegue justo despues se leeria como "primera evaluacion" y no sonaria.
    if (contador === null) return;

    const anterior = previo.current;
    previo.current = contador;

    if (anterior === null) return; // R11
    if (contador <= anterior) return; // R12

    // La preferencia se consulta AL EMITIR, no al montar: apagar el sonido tiene efecto
    // inmediato sin remontar el componente (R14).
    if (!leerPreferenciaSonido()) return;

    reproducirTono();
  }, [contador]);
}
