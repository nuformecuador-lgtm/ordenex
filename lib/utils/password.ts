import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

/** R6: nunca se persiste texto plano, solo el hash. */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
