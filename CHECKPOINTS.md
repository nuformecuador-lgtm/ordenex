# CHECKPOINTS.md — Criterios de "estado final correcto"

Una feature solo pasa a `done` si TODO esto se cumple. El reviewer valida contra
esta lista.

## Especificacion
- [ ] Existe `specs/<feature>/requirements.md` con requisitos EARS numerados `R1`, `R2`…
- [ ] Existe `specs/<feature>/design.md` con al menos una alternativa descartada y su porqué.
- [ ] Existe `specs/<feature>/tasks.md` y todas las tasks estan marcadas `[x]`.

## Trazabilidad
- [ ] Cada `R<n>` de requirements.md mapea a al menos un test concreto.
- [ ] `progress/impl_<feature>.md` contiene el mapa `R<n> -> test`.

## Calidad de codigo
- [ ] `pnpm run typecheck` pasa sin errores (TypeScript strict).
- [ ] `pnpm run lint` pasa sin errores.
- [ ] `pnpm test` pasa (unit/integracion).
- [ ] Si la feature toca flujos criticos (auth, pagos, recaudo, ingesta de
      ordenes, webhooks), hay al menos un test E2E (Playwright) que lo cubre.

## Datos y seguridad (Supabase)
- [ ] Toda tabla nueva con datos de usuario/operacion tiene RLS activado.
- [ ] Las migraciones son versionadas y reversibles: toda migracion nueva tiene
      su `down.sql` y el script `pnpm run db:rollback` funciona.
- [ ] Ningun secreto quedo hardcodeado; todo va por variables de entorno.
- [ ] Webhooks nuevos validan firma/token y son idempotentes.

## Patron de capas
- [ ] Controller no contiene queries de DB ni logica de negocio.
- [ ] Service no conoce HTTP (Request/Response/headers).
- [ ] Repository solo ejecuta queries Prisma, sin logica de negocio.
- [ ] Las interfaces estan en `lib/interfaces/`, separadas por categoria.

## Permisos
- [ ] Paginas protegidas validan permisos en el servidor via `cookies()`.
- [ ] Componentes `private/` reciben datos por props; no fetchean datos sensibles.
- [ ] Mutaciones internas usan Server Actions, no fetch a API routes.

## Multi-pais / configuracion
- [ ] No se hardcodeo pais, moneda ni cuenta; todo se resuelve por configuracion.

## Verificacion final
- [ ] `./init.sh` termina en verde.
- [ ] `progress/review_<feature>.md` existe y su veredicto es OK.
- [ ] Se añadio una entrada a `progress/history.md`.
