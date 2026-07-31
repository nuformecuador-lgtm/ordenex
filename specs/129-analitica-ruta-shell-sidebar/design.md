# Feature 129 — Analítica: ruta, shell y sidebar — Diseño técnico

> Cubre R1–R25 de `requirements.md`.
> **Puerta T0 cerrada el 2026-07-30**: las decisiones D1–D8 de `requirements.md`
> están aplicadas aquí. No queda ninguna pregunta abierta.

## 0. Modelo de datos

**Ninguno.** Esta feature no crea ni modifica tablas, columnas, enums, índices ni
políticas RLS, y **no añade migraciones Prisma**. En consecuencia, las casillas de
`CHECKPOINTS.md` sobre RLS, `down.sql` y `pnpm run db:rollback` son **inaplicables**
por ausencia de objeto de datos, no por omisión.

Tampoco toca `lib/services/`, `lib/repositories/`, `lib/interfaces/` ni
`lib/actions/`: no hay capa de negocio en juego, así que el patrón
Controller → Service → Repository no aplica aquí. El único "controller" es el
Server Component de la página, y su única llamada es la resolución de sesión ya
existente.

## 1. Archivos que toca

| Archivo | Acción | Requisitos |
| --- | --- | --- |
| `app/(app)/analitica/page.tsx` | nuevo (Server Component asíncrono) | R1–R6, R10, R24 |
| `app/(app)/analitica/_components/AnaliticaShell.tsx` | nuevo (presentación pura) | R18–R23 |
| `lib/auth/menu-visibility.ts` | editar: `chartColumn` en `IconKey` + un ítem en `SIDEBAR_ITEMS` | R7–R11, R15–R17 |
| `app/(app)/_components/Sidebar.tsx` | editar: import `ChartColumn` + entrada en `ICON_BY_KEY` (líneas 138-151) | R12, R13 |
| `tests/unit/auth/menu-visibility.test.ts` | extender | R7–R11, R15–R17 |
| `tests/components/Sidebar.test.tsx` | extender | R12–R14 |
| `tests/components/AnaliticaPage.test.tsx` | nuevo | R1–R6, R10, R24 |
| `tests/components/AnaliticaShell.test.tsx` | nuevo | R18–R23 |

No se toca `app/(app)/layout.tsx`: ya filtra con `itemsVisibles(SIDEBAR_ITEMS, actor)`
(líneas 20-21), así que el ítem nuevo aparece sin cambiar el layout. **No se toca
nada bajo `app/(app)/ranking/`** (hay otra sesión trabajando ahí en vivo).

## 2. La ruta y su gate (R1–R6, R10, R24)

Colocación: `app/(app)/analitica/page.tsx`, hermana de `incidentes`, `cierres-admin`,
`dashboard`. Hereda del layout del grupo `(app)` el `SidebarProvider`, el `Sidebar`
y el `SidebarInset`.

Forma, calcada del precedente `app/(app)/incidentes/page.tsx:25-33`:

```
export default async function AnaliticaPage() {
  const actor = await resolveActorFromSession();
  if (!actor || !ROLES_ANALITICA.includes(actor.rol)) notFound();   // R3, R4, R5, R6
  return <AnaliticaShell />;                                        // R2
}
```

Puntos de diseño:

- **`ROLES_ANALITICA = ["maestro", "admin"] as const` vive en un solo sitio** (D1,
  D2) y la usan TANTO el `roles:` del ítem de menú COMO el gate de la página, para
  que no puedan divergir (R10). Se declara y exporta desde
  `lib/auth/menu-visibility.ts`, que es el módulo server-safe que ya importan el
  layout y el Sidebar; la página lo importa desde ahí.
  Aun compartiendo la constante, **se testean por separado** (R8/R9 contra
  `itemsVisibles`, R2/R3/R4 contra la página): el requisito del repo es que existan
  las dos defensas, y un test por cada una es lo que impide que alguien "simplifique"
  una de ellas más adelante.
- **No se usa `esAccesoTotal(rol)`** aunque hoy devuelva justo `maestro`/`admin`:
  ese helper significa "acceso total de gestión" (`lib/auth/acceso-total.ts:3-4`),
  no "quién ve analítica". Son conceptos distintos que hoy coinciden y que la 133
  va a separar: acoplarlos obligaría a la 133 a desacoplarlos primero.
- **La página no recibe props del cliente.** Sin `searchParams` en la 129: los
  filtros son de la 131 y leerlos ahora sería contrato inventado.
- **Sin `export const dynamic`.** La página ya es dinámica de facto porque
  `resolveActorFromSession()` llama a `cookies()`. Declarar cacheo aquí sería
  invadir la 128.

## 3. El shell: contrato de extensión (R18–R23)

El shell es el **contrato que 130/131/132/133 rellenan**, y por eso se define como
componente con props nombradas, no como HTML suelto en la página. Disposición:
**pila vertical de regiones** (D5), no pestañas.

```ts
// app/(app)/analitica/_components/AnaliticaShell.tsx  (sin "use client")
export interface AnaliticaShellProps {
  /** Barra de filtros (rango, zona, tienda, mensajero). La enchufa la 131. */
  filtros?: ReactNode;
  /** Paneles del tablero operativo. Los enchufa la 131. */
  operativo?: ReactNode;
}
```

Reglas del contrato:

1. **Slots, no children sueltos.** Cada región es una prop con nombre semántico.
   La 131 hace `<AnaliticaShell operativo={<TableroOperativo datos={...} />} />`
   sin tocar el shell. La 133 recorta pasando `undefined` o no pasando la prop.
2. **La región financiera NO se declara aquí (D6).** El punto de extensión para la
   132 es explícito y está acotado a tres cambios mecánicos, que van escritos en el
   JSDoc del shell: (a) añadir `financiero?: ReactNode` a `AnaliticaShellProps`,
   (b) añadir una `<section aria-label="Tablero financiero">` bajo la operativa en
   la misma pila vertical, (c) su placeholder. No se deja prop muerta ni región
   vacía "por si acaso": una región financiera visible y vacía en un portal donde
   el dinero es sensible es peor que no tenerla.
3. **Componente de presentación pura.** Sin `"use client"` (no tiene estado ni
   handlers), sin fetch, sin cálculo (R23). Si la 131 necesita interactividad de
   filtros, esa interactividad vive en el componente que se le pasa por la prop
   `filtros`, no en el shell.
4. **Regiones accesibles y testables.** Cada región se renderiza como `<section>`
   con `aria-label` propio ("Filtros", "Tablero operativo"), de modo que un test
   las localice por `getByRole("region", { name })` sin depender de clases ni del
   orden del DOM (R20).
5. **Placeholder explícito, nunca dato falso.** Región sin contenido →
   `components/shared/EmptyState.tsx` con un texto que diga que el panel llega en
   una entrega posterior. **Prohibido** renderizar números, series, ejes o
   etiquetas de métrica de mentira (R22): un cero de placeholder es
   indistinguible de un cero real y contamina la lectura del negocio.
6. **Envoltorio único de página.** El shell usa `AppPage`
   (`components/shared/AppPage.tsx`), como todas las páginas del portal: nunca
   arma su propio `<section p-6>` ni su propio header (R19). Título: "Analítica".

## 4. Prefetch: fuera de alcance, con punto de extensión

La ficha dice "Server Component que valida rol y **prefetchea**". **Hoy no hay nada
que prefetchear**: las Server Actions de analítica son 126 (operativa) y 127
(financiera), ambas `pending`, y la 129 declara `depends_on: null`. Inventar una
fuente ahora significaría inventar su contrato de entrada/salida, que es
exactamente lo que `CLAUDE.md` §6 prohíbe.

Decisión: **el prefetch queda fuera del alcance de la 129** y se resuelve dejando
preparado el punto de extensión, no un stub:

- La página es `async` desde el día uno (R1). Ese `async` ES el punto de extensión:
  la 131 añade sus `await listar…()` entre el gate y el `return`, y baja los
  resultados por las props del shell. No hace falta ningún andamio adicional.
- El patrón que heredará ya está fijado por el repo y por `docs/architecture.md`
  ("datos privados: pre-fetch en Server Component, stream al cliente"): la página
  hace el fetch, el componente hijo recibe por props y no fetchea.
- **No se crea** ni módulo `lib/actions/analitica.ts` vacío, ni tipos de datos
  placeholder, ni `Suspense` con skeletons sobre un fetch inexistente. Código
  muerto que la 131 tendría que borrar o, peor, respetar.

## 5. Menú e icono (R7–R17)

- El ítem se añade a `SIDEBAR_ITEMS` con `label: "Analítica"` (D3),
  `href: "/analitica"`, `iconKey: "chartColumn"` (D4), `roles: ROLES_ANALITICA`
  (= `["maestro","admin"]`, D1) y **sin** `children` (R15).
- **Posición (D7, R16): inmediatamente después de "Inicio" (`/dashboard`) y antes
  del primer "Órdenes" (`/ordenes`)**, es decir como segundo elemento del array.
  Razón registrada por el leader: comparte exactamente los roles de "Inicio" y es
  una vista de resumen, no una sección operativa. No hay regla de orden escrita en
  `docs/`; esta decisión la crea para este caso, no para todo el menú.
- Comentario obligatorio junto al ítem, siguiendo el estilo del resto del archivo:
  qué feature lo introduce, por qué SOLO `maestro`/`admin` (D1: sin métrica hasta
  la 131), que la 133 amplía, y la frase del patrón — "este ítem sólo decide qué se
  MUESTRA; la defensa real es el `notFound()` de la página".
- **Aviso conservado (trampa real del repo): `ROLES_SEED` NO son "los roles
  humanos".** Es `Object.values(RolValue)` (`lib/types/roles.ts`) e incluye
  `apiKey` (`db/schema.prisma:41`), que es una cuenta de máquina y no navega. El
  ítem "Perfil" (`menu-visibility.ts:173-178`) lo usa y por eso "Perfil" es visible
  también para `apiKey`. Este ítem enumera sus roles literalmente y **nadie debe
  copiar el patrón de "Perfil"** pensando que `ROLES_SEED` filtra máquinas.
- `IconKey` gana la clave `chartColumn`; `ICON_BY_KEY` en
  `app/(app)/_components/Sidebar.tsx` (líneas 138-151) gana su entrada
  `chartColumn: ChartColumn` con el import desde `lucide-react`.
  **Verificado en el paquete instalado**: `package.json` declara
  `"lucide-react": "^1.23.0"` y `node_modules/lucide-react/dist/lucide-react.d.ts`
  declara `ChartColumn` en la línea 4138 y lo exporta con ese nombre exacto en la
  línea 24763. No hace falta nombre alternativo.
- Como `ICON_BY_KEY` está tipado `Record<IconKey, SidebarIcon>`, **el typecheck
  strict falla si se añade la clave sin el icono**: R12 tiene garantía de
  compilador además de test.
- R17 se verifica con un test que compara, rol por rol, el conjunto de etiquetas
  visibles contra el esperado; cualquier alteración colateral lo rompe.

## 6. Alternativas descartadas

**A1. Prefetchear contra un stub/mock para "cumplir" la palabra prefetch de la ficha.**
Descartada. Obliga a inventar la forma del dato analítico (nombres de KPI, shape
de series, filtros) sin backend que la valide; la 126/127 llegarían con otra forma
y el stub se convertiría en deuda o, peor, en un contrato de facto que arrastre a
las features de datos. Además contradice `CLAUDE.md` §6 ("no inventes"). Se elige
declarar el prefetch fuera de alcance y dejar el punto de extensión (§4).

**A2. Reutilizar una `iconKey` existente (p. ej. `trophy` o `clipboardCheck`) en vez de añadir `chartColumn`.**
Descartada. `IconKey` es una unión cerrada y compartir icono con otra sección
invita a leer analítica como parte de esa sección — exactamente el argumento que
el repo ya dejó escrito al crear `shieldAlert` para incidentes
(`lib/auth/menu-visibility.ts:21-24`). El coste de una clave nueva es una línea en
la unión y una en `ICON_BY_KEY`.

**A3. Gating sólo por el ítem del menú, sin `notFound()` en la página.**
Descartada. La visibilidad del menú es cosmética: `/analitica` es una URL tecleable
y el layout no bloquea nada. El patrón del repo (comentarios de `menu-visibility.ts`
y `app/(app)/incidentes/page.tsx:25-33`) exige las dos capas, y esta spec pide un
test por cada una (R2/R3/R4 y R8/R9), más R10 que las obliga a coincidir.

**A4. Publicar el ítem a los cinco roles de la ficha ya en la 129.**
Descartada por decisión del humano (D1). Habría publicado, para `mensajero`,
`adminTienda` y `adminSatelite`, una entrada de menú hacia una página sin contenido
útil hasta el merge de la 131 — un control que no lleva a ninguna parte. La
ampliación es alcance de la 133; ver §7 y la "Nota de traspaso" de
`requirements.md`.

**A5. Rutas separadas `/analitica/operativo` y `/analitica/financiero`, o pestañas, desde ya.**
Descartada para la 129 (D5). Multiplicaría gates y shells sin que exista todavía el
contenido que justificaría la separación, y prejuzgaría la navegación que la
131/132/133 aún no han diseñado. La pila vertical con regiones nombradas permite
pasar a pestañas o sub-rutas después sin romper el contrato de props (§3).

**A6. Poner el shell en `components/private/analytics/` desde el inicio.**
Descartada. `docs/architecture.md` §"sin sobre-ingeniería": un componente usado en
UN solo sitio vive junto a la página. Vive en `app/(app)/analitica/_components/`.
Además el shell **no** es `private/`: no transporta datos sensibles, sólo los
enmarca; los componentes con datos sensibles son los de la 130/132.

**A7. Añadir un test E2E de la ruta.**
Descartada por decisión vigente del humano (2026-07-30: "no más e2e, pruebas
básicas nada más"). La casilla de `CHECKPOINTS.md` que pide E2E aplica a "flujos
críticos (auth, pagos, recaudo, ingesta de órdenes, webhooks)"; un shell vacío no
es ninguno de ellos, aunque su gate de rol roza auth. **Cobertura sustitutiva del
riesgo**: los tests de página (R2/R3/R4) ejercitan el `notFound()` con render real
del Server Component —el mismo mecanismo que usa
`tests/components/IncidentesPage.test.tsx`— y los de menú (R8/R9) cubren la capa
cosmética; entre ambos queda cubierto el único riesgo real de la feature (que un
rol no autorizado vea la página).

## 7. Desviación deliberada respecto a la ficha de `feature_list.json`

La descripción de la feature 129 dice: *"item de sidebar visible por rol
(maestro/admin/adminSatelite/adminTienda/mensajero)"*. **Esta spec se desvía a
propósito y publica el ítem SOLO para `maestro` y `admin`** (D1, decisión del humano
del 2026-07-30).

Razón: la 129 no trae ninguna métrica. Hasta que la 131 cablee datos, la página está
vacía; darle la entrada a `mensajero`, `adminTienda` y `adminSatelite` sería publicar
un control que no lleva a ninguna parte, para justo los tres roles cuyos recortes de
presentación son alcance de la 133.

**Quién lo cierra:** la feature 133 ("analítica: recortes por rol"), que amplía a los
tres roles restantes tocando los DOS sitios listados en la "Nota de traspaso" de
`requirements.md` (`SIDEBAR_ITEMS` y la constante `ROLES_ANALITICA` del guard). Con
eso, la letra de la ficha queda cumplida al final de la cadena 129 → 131/132 → 133,
no en la 129.

No se modifica `feature_list.json` desde esta feature: ese registro lo lleva el
leader.

## 8. Observación de numeración en `feature_list.json` (D8) — para quien implemente la 131

Las descripciones de la cadena de analítica arrastran una renumeración previa y sus
referencias cruzadas están desfasadas en uno:

- La 131 dice "cablea las Server Actions de **125** a las gráficas de **129** dentro
  de la ruta **128**", pero declara `depends_on: 126`. Léase: servicios **126**,
  gráficas **130**, ruta **129** (esta feature).
- La 132 dice "cablea **126** a las gráficas de **129** en la ruta **128**" con
  `depends_on: 127`. Léase: servicios **127**, gráficas **130**, ruta **129**.
- Mismo desfase en 124/125/126 (citan 122/123/125 y dependen de 123/124/125).

Es desfase de numeración, **no** un cambio de alcance (confirmado por el humano).
Los `depends_on` son la referencia fiable; las descripciones, no.

## 9. Riesgos

- **R-1. Colisión de merge en dos archivos compartidos.** `menu-visibility.ts` y
  `Sidebar.tsx` los toca cualquier feature que añada una sección. Mitigación:
  cambios mínimos y aditivos (una clave en la unión, una entrada en el mapa, un
  objeto insertado en el array); nada de reordenar los ítems existentes.
- **R-2. Que la 133 amplíe sólo el menú y olvide el guard**, dejando tres roles con
  entrada visible y 404. Mitigación: R10 + la "Nota de traspaso" de
  `requirements.md` + la constante única `ROLES_ANALITICA`.
- **R-3. Que el shell se congele como contrato equivocado.** Mitigación: superficie
  de props mínima (dos slots opcionales), nada de props de datos, y el punto de
  extensión de la 132 escrito en el JSDoc (§3.2).
