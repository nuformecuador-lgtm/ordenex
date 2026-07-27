This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Despliegue

### Variables de entorno

El código lee exactamente estas (`GOOGLE_MAPS_API_KEY` es opcional: sin ella se
desactiva la geocodificación):

| Variable | Notas |
| --- | --- |
| `DATABASE_URL` | Pooler **transaccional** de Supabase (`:6543`) en serverless. Solo runtime. |
| `DIRECT_URL` | Pooler en modo **sesión** (`:5432`). Solo el CLI de Prisma (`migrate deploy` del build). Sin ella, `prisma.config.ts` cae a `DATABASE_URL`. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Solo servidor. Nunca exponer. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente. |
| `NEXT_PUBLIC_APP_URL` | Origin de los QR de etiqueta. Ver aviso abajo. |
| `NEXT_PUBLIC_SITE_URL` | Origin para metadatos (`app/layout.tsx`). |
| `CRON_SECRET` | Autoriza los endpoints de `/api/cron/*`. |
| `GOOGLE_MAPS_API_KEY` | Geocodificación. |
| `DB_POOL_MAX` | Opcional. Conexiones `pg` por instancia (default 3). |

> **`NEXT_PUBLIC_*` se inlinea en build time.** Cambiarlas exige un redeploy.
> `NEXT_PUBLIC_APP_URL` queda impresa en los QR de las etiquetas físicas: si el
> dominio cambia después, esas etiquetas apuntan a una URL muerta. Definí el
> dominio definitivo *antes* de imprimir en volumen.

### Base de datos

```bash
pnpm exec prisma migrate deploy   # esquema (usa DIRECT_URL: pooler en modo sesión, :5432)
pnpm db:seed                      # catálogos: tipos de id, roles, estados, vehículos
```

### Usuario maestro (bootstrap)

La operación arranca desde una cuenta con rol `maestro`. La credencial **no
vive en el repositorio**: se pasa por entorno.

```bash
MAESTRO_EMAIL=admin@ejemplo.com \
MAESTRO_PASSWORD='<contraseña fuerte, mínimo 12 caracteres>' \
pnpm db:seed:maestro
```

Es idempotente y sirve también para **rotar** la contraseña: si el email ya
existe, actualiza el hash y reactiva la cuenta sin tocar su `id` ni relaciones.
Opcionales: `MAESTRO_NOMBRE`, `MAESTRO_TELEFONO`, `MAESTRO_CEDULA`.

Requiere que los catálogos estén sembrados (`pnpm db:seed`); si faltan, el
script falla con un mensaje explícito en vez de un error de clave foránea.

> Contexto: hasta la migración `20260720150000_drop_default_maestro_user`, el
> maestro se sembraba desde una migración con un hash bcrypt hardcodeado —
> es decir, una credencial de privilegio total conocida por cualquiera con
> acceso al código. Esa migración la neutraliza y este script la reemplaza.
