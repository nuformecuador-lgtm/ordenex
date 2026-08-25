# Feature 281 — Diseño

> Cierra `requirements.md` R1-R13. Feature `frontend`, complejidad **baja**.
> **Sin backend**: no hay tabla, ni migración, ni RLS, ni endpoint, ni contrato de
> entrada/salida que cambie. La sección §2 lo dice con nombre y apellido en vez de
> omitirlo, porque «no aplica» tiene que ser una decisión visible, no un hueco.

---

## §0 — Frontera: qué archivos pueden aparecer en el diff

| Archivo | Qué se le hace | Requisitos |
| --- | --- | --- |
| `app/(app)/_components/AdminMaestroDashboard.tsx` | quitar el montaje suelto de `:36`; ajustar el docblock para que no siga describiendo una pantalla que ya no es | R4, R5, R6, R12 |
| `tests/components/AdminMaestroDashboard.test.tsx` | **añadir** los casos de conteo; posible reexpresión declarada de `:120` | R4, R6, R7, R8, R9, R10, R13 |
| `specs/281-*/`, `progress/impl_281.md`, `progress/current.md`, `feature_list.json` | spec, bitácora y estado | — |

**Nada más.** `git diff --name-only` no debe contener `db/`, `lib/`, `app/api/`,
`components/ui/`, `components/shared/` ni ningún otro componente de `app/(app)/`.
Si aparece alguno, es una violación de R11/R12 y el arreglo se pasó de largo.

---

## §1 — Diagnóstico: qué pinta cada tarjeta hoy

Árbol renderizado por `/dashboard` para `maestro` y `admin`
(`app/(app)/dashboard/page.tsx:34-36`), con las dos listas vacías:

```
AppPage  «Panel maestro»                         ← PageHeader + Container (0 tarjetas)
├── PostulacionesPendientesPanel   (:36)         ← ❌ SUELTO, sin ContenedorSeccion
│    └── section aria-label="Postulaciones pendientes"
│         └── EmptyState «No hay postulaciones pendientes»   ← TARJETA 1 (sin título)
├── ContenedorSeccion «Postulaciones de mensajeros»  (:37)
│    └── Card                                                ← TARJETA 2 (con título)
│         └── section aria-label="Postulaciones pendientes"
│              └── EmptyState «No hay postulaciones pendientes»
└── ContenedorSeccion «Vehículos y bodegas ofrecidos» (:41)
     └── Card                                                ← TARJETA 3 (con título)
          └── section aria-label="Vehículos y bodegas ofrecidos"
               └── EmptyState «No hay vehículos ni bodegas por revisar»
```

Coincide punto por punto con la captura: **tres** tarjetas, la **de arriba sin título**,
y el texto que se **repite** es el de mensajeros. El panel de vehículos queda descartado
como duplicado —tiene su propio texto—, tal y como la ficha ya decía.

**Efectos del montaje suelto que no son «una tarjeta de más»**, y que justifican que la
prueba mida la estructura y no sólo el caso vacío:

1. **Con datos, la lista entera sale duplicada**: dos veces cada `PostulacionCard`, dos
   `Pagination`. → R8.
2. **Dos regiones con el mismo nombre accesible** («Postulaciones pendientes»), que para
   un lector de pantalla son dos secciones distintas con idéntico rótulo. → R6.
3. **Dos `Modal` montados** (`PostulacionesPendientesPanel.tsx:181`), aunque ambos
   cerrados.
4. **Posible doble llamada** a la Server Action de listado. *Posible*: depende de la
   deduplicación de SWR por clave, que **no se ha medido**. → R10, y T2 lo mide.

### Lo que falta medir antes de tocar código (R1, R2)

- La cuenta **en la app**, con su `innerText` citable.
- El **blob commiteado** y el commit culpable.
- El estado **actual** de `tests/components/AdminMaestroDashboard.test.tsx`.

Indicio, **no** prueba: las 16 copias en `.claude/worktrees/*/` tienen **una** aparición
del panel y el árbol principal tiene **dos**; ninguna copia contiene el párrafo del
docblock fechado 2026-08-20. Apunta a que la línea entró con la retirada del encabezado
«Entregas» de esa fecha. El historial lo confirma o lo desmiente; hasta entonces no se
escribe como causa.

---

## §2 — Modelo de datos, rutas, contratos e integraciones

| Dimensión | Decisión |
| --- | --- |
| Tablas / columnas | **Ninguna.** Cero migraciones, cero cambios en `db/schema.prisma`. |
| RLS | **Ninguna.** No se estrena tabla ni se toca política existente. |
| Migraciones up/down | **Ninguna** → el gate `--rapido` **no** se niega por esta ficha (`docs/verification.md`). |
| Rutas / endpoints | **Ninguno nuevo.** La ruta afectada existe: `/dashboard` (`app/(app)/dashboard/page.tsx`), servida a `maestro` y `admin`. No cambia su resolución de rol ni sus redirecciones. |
| Server Actions | `listarPostulacionesPendientes`, `listarPostulacionesRecurso` y las de decisión **no se tocan**: ni firma, ni parámetros, ni resultado. |
| Contratos I/O | **Ninguno.** `PostulacionPendienteDTO` y el DTO de recurso quedan igual; `lib/types/` no aparece en el diff (otro motivo por el que el gate rápido basta). |
| Integraciones (Supabase, Meta, WhatsApp, Telegram) | **Ninguna.** |
| Configuración / env | **Ninguna.** |

El cambio vive **entero** en la capa de composición de una pantalla.

---

## §3 — El arreglo

Quitar el montaje suelto de `AdminMaestroDashboard.tsx:36`. Queda:

```tsx
<AppPage title="Panel maestro" description="…">
  <ContenedorSeccion titulo="Postulaciones de mensajeros">
    <PostulacionesPendientesPanel />
  </ContenedorSeccion>

  <ContenedorSeccion titulo="Vehículos y bodegas ofrecidos">
    <PostulacionRecursoPanel />
  </ContenedorSeccion>
</AppPage>
```

- **Se borra el montaje de arriba, no el de abajo.** El de abajo es el que tiene
  título, el que la feature 253 diseñó (§7 de su design) y el que los tests existentes
  localizan por su rótulo. Borrar el titulado dejaría la pantalla sin el rótulo que R13
  exige conservar.
- **Textos, títulos, orden y jerarquía: intactos** (R12). Ni una cadena visible cambia.
- **El docblock se ajusta** en la parte que describe la pantalla, sin reescribir su
  historia. Hoy afirma «este dashboard no pinta más que los dos paneles de
  postulaciones» — que era falso mientras hubiera tres montajes — y conviene que quede
  además dicho **por qué** el orden es ese y que no debe volver a colarse un montaje
  fuera de sección. La prosa de `progress/` **no se edita**: son fotos históricas.

**Si T1 desmiente este diagnóstico** (R3), este §3 se reescribe antes de implementar. El
requisito que manda es R4/R5/R6, que hablan del efecto, no de la línea 36.

---

## §4 — Verificación: cómo se cuenta, y por qué así

Todo vive en `tests/components/AdminMaestroDashboard.test.tsx`, que ya monta la pantalla
real con los dobles de las dos Server Actions y el `SWRConfig` aislado. **Se añaden
casos; no se reescribe el archivo.**

### §4.1 La aserción de cardinalidad, en su forma bilateral

El riesgo declarado por el humano: `queryAllByText` con la aserción mal puesta pasa en
verde tanto si sobra como si falta. La forma que se exige:

```ts
expect(screen.getAllByText("No hay postulaciones pendientes")).toHaveLength(1);
```

- `getAllByText` **lanza si hay cero** → cubre el «de menos».
- `toHaveLength(1)` **falla si hay dos** → cubre el «de más».

Queda **prohibido** en esta feature: `queryAllByText(...)` sin comparar longitud,
`toBeTruthy()`, `toBeInTheDocument()` como única aserción de conteo, y cualquier
`length >= 1`. (R9)

### §4.2 Las cuatro medidas, y qué cubre cada una

| # | Qué se mide | Cómo | Cubre |
| --- | --- | --- | --- |
| M1 | tarjetas de vacío con las dos listas vacías | `getAllByText("No hay postulaciones pendientes")` → **1**; `getAllByText("No hay vehículos ni bodegas por revisar")` → **1** | R4 |
| M2 | montajes de cada panel, con y sin datos | `getAllByRole("region", { name: "Postulaciones pendientes" })` → **1**; ídem «Vehículos y bodegas ofrecidos» → **1** | R6 |
| M3 | ninguna tarjeta huérfana | para cada región de M2: `region.closest('[data-slot="card"]')` **no es null** y dentro de esa tarjeta está su rótulo de sección | R5 |
| M4 | el caso con datos | con items en ambos listados: `queryAllByText("No hay postulaciones pendientes")` → **0**, `getAllByText("Nombre-u1 Ap")` → **1**, y los dos rótulos presentes | R7, R8 |

**M2 es la medida principal**, no M1: es independiente del estado de los datos y ataca
la causa (el doble montaje) en vez del síntoma (la tarjeta repetida). M1 es la que el
humano puede leer en la captura, y por eso también está.

**Límite declarado de M3:** localiza la tarjeta por `[data-slot="card"]`, es decir por
un detalle de implementación de la primitiva shadcn, no por un rol accesible. Se hace
así porque `ContenedorSeccion` **no emite `role="region"` a propósito**
(`ContenedorSeccion.tsx:55-60`: los landmarks los declaran los shells, y hay guardias de
analítica que congelan cuántas regiones hay). La alternativa —añadir un landmark al
contenedor— rompería esas guardias y sería rediseñar (R12). El límite se escribe **en el
propio test**, no sólo aquí.

### §4.3 El control positivo: las mutaciones que hay que ver morder

Ningún caso nuevo se da por bueno sin verse rojo (R9). Bitácora obligatoria, secuencial
—**nunca en paralelo con el gate**, que leería un árbol mutado—:

| # | Mutación | Qué debe ponerse rojo |
| --- | --- | --- |
| MUT-1 | **restaurar** `<PostulacionesPendientesPanel />` suelto en `:36` | M1 (2≠1) **y** M2 (2≠1) |
| MUT-2 | duplicar el `<ContenedorSeccion>` de vehículos | M2 del panel de recursos |
| MUT-3 | quitar el `<ContenedorSeccion>` de mensajeros dejando el panel suelto | M3 (ancestro `card` null) |
| MUT-4 | cambiar el texto del `EmptyState` de mensajeros | M1 (0 → `getAllByText` lanza) |
| MUT-5 | con datos, restaurar el montaje suelto | M4 (`Nombre-u1 Ap` sale 2 veces) |

MUT-1 es **la mutación obligatoria de esta ficha**: es literalmente el defecto que se
está arreglando. Si sale verde, el test no prueba nada y hay que rehacerlo antes de
seguir.

### §4.4 La aserción heredada de la que hay que desconfiar

`tests/components/AdminMaestroDashboard.test.tsx:120` afirma
`toHaveBeenCalledTimes(1)`. Con **dos** montajes del mismo panel y la misma clave SWR
(`["postulaciones:pendientes", page, pageSize]`, `PostulacionesPendientesPanel.tsx:83`),
esa aserción o está roja hoy, o es insensible al doble montaje. **No se supone cuál**:
T2 lo mide antes de tocar nada, y el resultado se escribe.

- Si hoy está **roja** → la suite de `dev` estaba rota y nadie lo vio; se dice.
- Si hoy está **verde** con dos montajes → es una aserción que no mide lo que su nombre
  promete; se declara su límite junto a la línea y **la prueba de R6 no se apoya en
  ella** (M2 sí lo hace). No se borra ni se debilita (R13).

### §4.5 Gate

`./init.sh --rapido` en cada tanda y para abrir el PR. El diff **no** toca migraciones,
`db/schema.prisma`, `lib/types/`, configuración de build ni archivos con nombre de
dinero, así que el modo rápido **no se niega** (`docs/verification.md`). `./init.sh`
completo lo corre el leader tras el merge a `dev`.

### §4.6 E2E

**No se escribe ningún spec de Playwright.** El harness existe (`playwright.config.ts`,
21 specs en `e2e/`) y **nadie lo ejecuta**: `init.sh` no lo invoca en ninguno de sus dos
modos. Escribir uno produciría un archivo que nadie corre y que
`docs/verification.md` no cuenta como evidencia. El riesgo que un E2E cubriría —«en la
app de verdad se ven dos tarjetas»— se cubre por otra vía y **antes**: la conducción
manual de T1, cuyo `innerText` queda pegado en `progress/impl_281.md`.

---

## §5 — Alternativas descartadas

### §5.A — Darle título a la tarjeta de arriba en vez de eliminarla *(la principal)*

Envolver el montaje suelto en un tercer `ContenedorSeccion` para que deje de ser la
tarjeta «sin título».

**Descartada.** Deja **el mismo listado dos veces** en la misma pantalla: con datos, las
mismas postulaciones aparecerían bajo dos rótulos, con dos paginadores que se mueven por
separado. Arregla el aspecto y conserva el defecto. Y contradice el pedido explícito
—«sobrando una, debemos eliminarla»—. Se deja escrita porque es exactamente la lectura
alternativa de la captura: si el humano quisiera **tres** secciones, esta sería la vía,
y entonces R4 pasaría a exigir tres tarjetas y haría falta decir **qué** lista distinta
va en la tercera (hoy no existe tal lista). Q3 de `requirements.md`.

### §5.B — Borrar el montaje titulado y dejar el suelto

Habría un solo panel de mensajeros, sí, pero **sin rótulo**, rompiendo la simetría con
el bloque de vehículos y el caso
`tests/components/AdminMaestroDashboard.test.tsx:114`. **Descartada:** viola R13 y
convierte un arreglo de una línea en un cambio de diseño.

### §5.C — Deduplicar en `ContenedorSeccion` o en `EmptyState`

Que el contenedor o el estado vacío detecten que ya hay otro igual y no se pinten.
**Descartada:** es la capa equivocada. `ContenedorSeccion` es puro y lo consumen
analítica y los paneles operativos; `EmptyState` lo usa hasta el `DataTable`. Un arreglo
ahí cambiaría el comportamiento de pantallas que no tienen ningún defecto, para tapar un
montaje de más en una. Es lo contrario de «arregla lo evidenciado».

### §5.D — Una guardia repo-wide contra el doble montaje

Un test que recorra los componentes de página y falle si un mismo componente aparece dos
veces en el mismo JSX. **Descartada para esta ficha:** (a) el análisis de JSX por texto
da falsos positivos legítimos —un componente repetido a propósito en una rejilla es
normal—; (b) M2 ya deja el caso cerrado **por el DOM**, que es donde se ve el efecto; y
(c) es rediseñar el arnés a cuenta de un defecto de una línea. Queda **propuesta como
ficha aparte** si el humano quiere red para toda la familia de «fallos mudos», y se
menciona en §6.

### §5.E — Arreglarlo en el componente de página (`dashboard/page.tsx`)

**Descartada:** `page.tsx` sólo resuelve rol y devuelve `<AdminMaestroDashboard />`
(`:34-36`). El defecto no está ahí y tocarlo mezclaría el enrutado por rol con un
problema de composición visual.

---

## §6 — Lo que esta feature NO cubre

- **No hay red genérica** contra futuros montajes duplicados en otras pantallas (§5.D).
  Si se quiere, es ficha aparte.
- **No se audita** si hay otras pantallas con el mismo defecto. La ficha es sobre
  `/dashboard` del maestro, que es lo evidenciado.
- **No se toca la deduplicación de SWR** ni la clave del listado: se **declara** su
  efecto sobre una aserción heredada (§4.4), no se cambia.
- **No se comprueba producción.** Si se quiere confirmación post-despliegue, es tarea
  del cierre y hay que pedirla (Q5).

---

## §7 — Riesgos

| Riesgo | Mitigación |
| --- | --- |
| El diagnóstico leído en el árbol de trabajo no es el de `dev` | R2 + T1.4: `git show` del blob commiteado antes de tocar nada |
| La suite de esa pantalla ya está roja y se atribuye a esta ficha | T2 la corre **antes** de cambiar una línea y pega la salida |
| Otro agente muta el árbol en paralelo y el gate mide otra cosa | gate y mutaciones **secuenciales**, nunca en paralelo |
| El seed de QA rota las cuatro cuentas y tumba el login de otra sesión | no correrlo salvo autorización (Q4), y avisar si se corre |
| El test nuevo pasa sin medir nada | MUT-1 es obligatoria y su rojo se pega en la bitácora |
