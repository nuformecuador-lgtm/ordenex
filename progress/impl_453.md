# Ficha 453 — Bitácora de implementación (BACKEND)

> Alcance de este informe: **las tandas de backend** de `specs/453-vistas-de-filtros-guardadas/tasks.md`
> (T0.1, T1.1–T1.5, T2.1, T2.2) más **T4.1** (módulo puro de aplicabilidad, sin React) y **T6.2**
> (guardia de formato propio). Las tandas 3, 4.2, 4.3, 5 y 6.1 son de frontend y **no** se tocan aquí.

## T0.1 — Pre-vuelo medido (2026-09-21)

| Qué | Valor |
| --- | --- |
| Rama | `feat/453-vistas-de-filtros-guardadas` |
| SHA de `origin/dev` del que sale la rama | `09bb639bd1e3d1e20b1bc4cac4b8a80edeeb6759` (= `git merge-base HEAD origin/dev`) |
| HEAD al empezar | `ab8485ff6a6939217785a141c569a957dc78adfe` (el spec) |
| `DATABASE_URL` resoluble | **Sí** — `prisma migrate status` responde `PostgreSQL database "ordenex" ... at "localhost:5432"`, 205 migraciones aplicadas, «Database schema is up to date!» |
| Archivos de test que se saltarían sin base | **210** archivos de `tests/` referencian `tests/integration/db/_postgres-real.ts` (el gate imprime su propia cifra en cada corrida; la buena es esa) |

Sin `DATABASE_URL`, esos 210 archivos se dan por **saltados, no fallan**: un verde de la capa de
datos no significaría nada. Aquí sí hay base, así que los dos archivos de integración de esta ficha
**se ejecutan** (se comprueba abajo, en la salida real).

### Un hallazgo del pre-vuelo que hay que saber antes de tocar migraciones

`pnpm run db:migrate:create` (`prisma migrate dev --create-only`) **no funciona en este repo**:
Prisma levanta una *shadow database* vacía y ahí la migración `20260918120200_zona_sinpe_no_nulo`
aborta a propósito (`P0001`: «FICHA 429: hay bodegas sin SINPE…»), así que el comando muere con
`P3006` antes de escribir nada. La vía que sí funciona, y la que se usó:

1. `prisma migrate diff --from-config-datasource --to-schema db/schema.prisma --script` para obtener
   el DDL canónico que Prisma espera (esto **no** usa shadow db);
2. escribir `migration.sql` y `down.sql` a mano sobre ese DDL;
3. `prisma migrate deploy` para aplicar, `pnpm run db:rollback` para revertir, `deploy` otra vez;
4. `migrate diff` de nuevo: `-- This is an empty migration.` (cero deriva).
