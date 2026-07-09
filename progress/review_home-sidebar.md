# Review — home - sidebar (id 5)

Reviewer: verificación ejecutable e independiente (no se confió en la bitácora).
Antecedente atendido: en `login(home)` hubo tests falsos; aquí se abrieron TODOS
los tests nuevos y se confirmó que renderizan los componentes REALES y asertan
comportamiento concreto.

## Veredicto: APROBADO — 0 bloqueantes

## Checklist (CHECKPOINTS.md)

- [x] `specs/home-sidebar/requirements.md` con R1–R17 EARS numerados.
- [x] `design.md` con alternativas descartadas (shadcn sidebar completo, montar en
      RootLayout, startsWith) y su porqué.
- [x] `tasks.md` presente. T001–T009 `[x]`. **T010 y T011 quedan `[ ]`** (cierre
      del implementer/leader; ver hallazgo menor 1).
- [x] Trazabilidad: cada R1–R17 mapea a un test real (tabla abajo).
- [x] `progress/impl_home-sidebar.md` contiene el mapa `R<n> -> test`.
- [x] `pnpm typecheck` verde (tsc --noEmit, sin errores) — corrido por el reviewer.
- [x] `pnpm lint` verde (eslint, sin errores) — corrido por el reviewer.
- [x] `pnpm test` verde: 27 files / 153 tests passed — corrido por el reviewer.
- [x] `./init.sh` termina en verde (EXIT=0) — corrido por el reviewer.
- [x] No hay tabla nueva / migración / RLS / webhook / secreto (feature UI pura;
      N/A esos ítems de seguridad, confirmado por git status: sin cambios en
      `db/`, Prisma, `lib/`, `app/api/`, `middleware.ts`).
- [x] Login redirect intacto: `middleware.ts` sin cambios; redirect a `/` sigue
      válido porque el route group `(app)` no altera la URL y `(app)/page.tsx`
      sirve `/`. `HomePage.test.tsx` reapunta a `@/app/(app)/page` y pasa.
- [x] R15 estructural: ni `app/layout.tsx` ni `app/login/page.tsx` referencian
      `Sidebar` (verificado en código y por test).
- [ ] `progress/history.md`: aparece modificado en git; el leader debe confirmar
      la entrada final (T011).

## Verificación anti-tests-falsos

- `Sidebar.test.tsx`: importa y renderiza el `Sidebar` REAL. Solo mockea
  `next/navigation` (usePathname configurable) y `next/link` (→ `<a>` real), lo
  correcto para aislar el router sin stubear el componente bajo prueba. Asevera
  comportamiento observable: 3 links con href, nav landmark con nombre accesible,
  `aria-current` exacto por ruta y ruta ajena, `aria-expanded` false→true→false
  con click y con teclado Enter/Espacio, montaje/desmontaje del listado móvil,
  cierre al navegar, y orden de tabulación real (foco). No hay tautologías.
- `AppLayout.test.tsx`: renderiza el `AppLayout` REAL, verifica nav + children;
  R15 por lectura del fuente de root layout y login (aserción negativa válida).
- `PlaceholderPages.test.tsx`: renderiza las 3 páginas REALES y asevera el
  heading nivel 1 con el título correcto.

## Trazabilidad R<n> -> test (estado)

| Req | Test | Estado |
| --- | --- | --- |
| R1  | Sidebar.test :: render de items — 3 links exactos | OK |
| R2  | Sidebar.test :: render de items — href internos correctos | OK |
| R3  | Sidebar.test :: nav landmark aria-label | OK |
| R4  | Sidebar.test :: item activo — aria-current por ruta | OK |
| R5  | Sidebar.test :: item activo — ruta ajena sin aria-current | OK |
| R6  | Sidebar.test :: render/colapsado — listado desktop siempre montado | OK |
| R7  | Sidebar.test :: colapsado por defecto (aria-expanded=false) | OK |
| R8  | Sidebar.test :: toggle abre y cierra | OK |
| R9  | Sidebar.test :: toggle abre y cierra | OK |
| R10 | Sidebar.test :: cierra al navegar desde un item | OK |
| R11 | Sidebar.test :: aria-expanded (colapsado + toggle) | OK |
| R12 | Sidebar.test :: operable por teclado — tab order | OK |
| R13 | Sidebar.test :: operable por teclado — Enter/Espacio | OK |
| R14 | AppLayout.test :: monta sidebar y children | OK |
| R15 | AppLayout.test :: /login no incluye el sidebar | OK |
| R16 | Sidebar.tsx usa Button de components/ui + lucide; validado en render | OK |
| R17 | PlaceholderPages.test :: cada ruta renderiza su título | OK |

## Hallazgos

- **menor 1:** `tasks.md` T010 y T011 siguen `[ ]` aunque su sustancia está
  hecha (mapa de trazabilidad en la bitácora; init.sh verde). CHECKPOINTS exige
  todas las tasks `[x]`. El leader debe marcarlas y confirmar la entrada en
  `progress/history.md` antes de pasar la feature a `done`. No afecta la calidad
  del código ni la trazabilidad.
- **menor 2:** `.gitignore` fue modificado para ignorar `feature_list.json` (el
  archivo de estado del arnés). Es ajeno al alcance de esta feature de UI y
  podría ocultar el estado del arnés en git; recomendar revisar/revertir con el
  leader. No bloquea esta feature.

## Alcance respetado

git status confirma que solo se tocaron: `app/(app)/**` (nuevo), tests nuevos en
`tests/components/`, `HomePage.test.tsx` (reapunta import), specs/progress, y se
borró `app/page.tsx` (evita colisión de ruta `/`). Sin cambios en backend, DB,
Prisma, APIs ni middleware. Correcto para UI pura.
