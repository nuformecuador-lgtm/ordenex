import { randomInt } from "node:crypto";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  strongPasswordSchema,
} from "@/lib/types/password-policy";

// Feature 25/R32/R34: genera una contrasena inicial que CUMPLE la politica
// fuerte de la feature 20 sin que el maestro la escriba. Aleatoriedad
// criptografica (crypto.randomInt). No loguea ni persiste el valor (R34): solo
// lo devuelve para que el service lo hashee y lo comunique una vez (R33).

// Conjuntos de caracteres alineados a `strongPasswordSchema`: mayuscula,
// minuscula, digito y simbolo (fuera de [A-Za-z0-9]).
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // sin I/O para legibilidad
const LOWER = "abcdefghijkmnpqrstuvwxyz"; // sin l/o
const DIGITS = "23456789"; // sin 0/1
const SYMBOLS = "!@#$%^&*-_+=?";
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

// Longitud objetivo dentro del rango valido [MIN, MAX]. 16 da margen de entropia
// sin acercarse al limite de bcrypt (72).
const TARGET_LENGTH = Math.min(16, PASSWORD_MAX_LENGTH);

/** Elige un caracter al azar (uniforme, cripto) del conjunto dado. */
function pick(chars: string): string {
  return chars[randomInt(chars.length)];
}

/** Baraja in-place con Fisher-Yates usando aleatoriedad criptografica. */
function shuffle(items: string[]): string[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * Genera una contrasena fuerte que pasa `strongPasswordSchema`. Garantiza al
 * menos una mayuscula, una minuscula, un digito y un simbolo, y valida su propia
 * salida antes de devolver (invariante auto-verificable). Sin efectos
 * secundarios ni logging (R34).
 */
export function generateStrongPassword(): string {
  const length = Math.max(TARGET_LENGTH, PASSWORD_MIN_LENGTH);

  // Garantiza una de cada clase requerida por la politica.
  const required = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  const rest: string[] = [];
  for (let i = required.length; i < length; i++) rest.push(pick(ALL));

  const password = shuffle([...required, ...rest]).join("");

  // Invariante: la salida DEBE cumplir la misma politica que valida el borde.
  const parsed = strongPasswordSchema.safeParse(password);
  if (!parsed.success) {
    // No incluye el valor en el mensaje para no filtrarlo (R34).
    throw new Error("generateStrongPassword produjo un valor que no cumple la politica");
  }
  return password;
}
