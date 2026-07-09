import { PrismaClient } from "@prisma/client";

const TIPOS_IDENTIFICACION = ["cedula", "ruc", "pasaporte"] as const;
const ROLES = ["admin", "usuario"] as const;

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    for (const value of TIPOS_IDENTIFICACION) {
      await prisma.tipoIdentificacion.upsert({
        where: { value },
        update: {},
        create: { value },
      });
    }

    for (const value of ROLES) {
      await prisma.rol.upsert({
        where: { value },
        update: {},
        create: { value },
      });
    }

    console.log("Seed de catalogos completado (tipo_identificacion, rol).");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("Fallo el seed de catalogos:", error);
  process.exit(1);
});
