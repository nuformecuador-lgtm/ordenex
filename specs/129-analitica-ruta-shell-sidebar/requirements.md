# Feature 129 — Analítica: ruta, shell y sidebar — Requisitos (EARS)

> Zona: frontend. Complejidad: low. `depends_on: null`.
> Rama: `feature/129-analitica-ruta-shell-sidebar`.
> **Puerta T0 CERRADA el 2026-07-30.** Las decisiones están abajo y ya están
> propagadas a los requisitos, al `design.md` y al `tasks.md`. No quedan preguntas
> abiertas.

## Decisiones cerradas con el humano (contexto, no son requisitos)

- **D1 (Q1) — El ítem y la página son SOLO para `maestro` y `admin`.** No para los
  cinco roles. Razón: la 129 no trae métrica, así que hasta la 131 la página está
  vacía; dar la entrada a `mensajero`/`adminTienda`/`adminSatelite` sería publicar
  un control que no lleva a ninguna parte. **La ampliación a los otros tres roles es
  alcance explícito de la feature 133 ("analítica: recortes por rol").**
  Esto **se desvía a propósito** de la descripción de la ficha en
  `feature_list.json` ("item de sidebar visible por rol
  (maestro/admin/adminSatelite/adminTienda/mensajero)"); ver `design.md` §7.
- **D2 (Q1, corolario) — El gate de la PÁGINA y la visibilidad del ÍTEM declaran
  exactamente el mismo par de roles**, y cada uno lleva su propio test. Son dos
  capas distintas del mismo patrón, no una redundancia que se pueda recortar.
- **D3 (Q2) — Etiqueta visible: "Analítica"** (con tilde, como el resto de labels
  del menú).
- **D4 (Q3) — Clave de icono nueva: `chartColumn`**, resuelta al export
  `ChartColumn` de `lucide-react`. Verificado contra el paquete instalado
  (`package.json`: `"lucide-react": "^1.23.0"`;
  `node_modules/lucide-react/dist/lucide-react.d.ts:4138` lo declara y `:24763` lo
  exporta con ese nombre exacto).
- **D5 (Q4) — El shell es una pila vertical de regiones con slots nombrados**, no
  pestañas.
- **D6 (Q5) — La región "financiero" NO existe en la 129.** La añade la 132; la 129
  deja el punto de extensión (§3 de `design.md`), sin región que la renderice.
- **D7 (Q6, decisión del leader) — El ítem va justo DESPUÉS de "Inicio" y ANTES de
  "Órdenes"** en `SIDEBAR_ITEMS`. Razón: comparte exactamente los roles
  `["maestro","admin"]` con "Inicio" y es una vista de resumen, no una sección
  operativa. No hay regla de orden escrita en el repo; queda declarada aquí.
- **D8 (Q7) — Desfase de numeración confirmado, NO cambio de alcance.** Las
  descripciones de 130/131/132 en `feature_list.json` citan "las gráficas de 129" y
  "la ruta 128" por una renumeración previa (mismo desfase en 124/125/126). No se
  toca `feature_list.json` desde esta feature.

## Alcance

DENTRO del alcance (el andamio, nada más):

1. La ruta autenticada `/analitica` (`app/(app)/analitica/page.tsx`) como Server
   Component que resuelve el actor server-side y aplica el gate de rol (D1).
2. El **shell** del tablero: encabezado de página + regiones vacías con placeholder,
   con un contrato de props (slots) que las features 130/131/132/133 rellenarán.
3. El **ítem de sidebar** "Analítica" en el único punto de verdad del menú
   (`lib/auth/menu-visibility.ts`) y su icono en el mapa del Sidebar cliente.

FUERA del alcance, explícito:

- Cero lógica de métrica, cero agregaciones, cero cálculos. (130/131/132)
- Cero gráficas y cero componentes de visualización. (130)
- Cero fetch de datos analíticos y cero consumo de Server Actions de analítica:
  **no existen todavía** — 126/127 (servicios) están `pending` y esta feature no
  depende de ninguna backend.
- Cero ampliación de roles y cero recorte de paneles por rol. (133; ver D1)
- Cero región "financiero". (132; ver D6)
- Cero export, cero cache/`revalidateTag`. (134 / 128)
- **Cero prefetch de datos.** La descripción de la ficha dice "valida rol y
  prefetchea"; hoy no hay fuente que prefetchear. Ver `design.md` §4.

## Contexto verificado del repo (hechos, no supuestos)

- `lib/auth/menu-visibility.ts` es el ÚNICO punto de verdad del menú: exporta
  `IconKey` (unión cerrada de strings), `MenuItem`, `SIDEBAR_ITEMS`, `puedeVer`
  e `itemsVisibles`.
- El icono NO viaja como componente (cruza el borde RSC): viaja como `iconKey`
  string y el Sidebar cliente lo resuelve en el mapa `ICON_BY_KEY` de
  `app/(app)/_components/Sidebar.tsx:138-151`.
- Patrón de defensa del repo, escrito en los comentarios de
  `lib/auth/menu-visibility.ts:96-104` y `:161-172`: **el ítem del sidebar sólo
  decide qué se MUESTRA; la defensa real es el `notFound()` de la página, que
  resuelve el rol server-side.** Precedente más reciente:
  `app/(app)/incidentes/page.tsx:25-33` (feature 158).
- `app/(app)/layout.tsx:20-21` resuelve el actor con `resolveActorFromSession()`
  y filtra el menú con `itemsVisibles(SIDEBAR_ITEMS, actor)`.
- El ítem "Inicio" (`/dashboard`) ya declara `roles: ["maestro", "admin"]`
  (`lib/auth/menu-visibility.ts:59-69`): el par de roles de D1 no es nuevo en el
  menú, y "Analítica" queda inmediatamente después (D7).
- `RolValue` (`db/schema.prisma:35-44`) tiene **seis** valores:
  `maestro`, `admin`, `mensajero`, `adminTienda`, `adminSatelite` y `apiKey`.
- No existe hoy ningún directorio `app/(app)/analitica/`.

---

## 1. La ruta y su gate de rol

**R1.** El sistema DEBE exponer la ruta autenticada `/analitica`, renderizada por un
Server Component asíncrono dentro del grupo de rutas `(app)`.

**R2.** CUANDO un actor autenticado con rol `maestro` o `admin` solicita
`/analitica`, el sistema DEBE renderizar el shell del tablero de analítica
(encabezado y regiones) sin error.

**R3.** CUANDO un actor autenticado con cualquier otro rol —`mensajero`,
`adminTienda`, `adminSatelite` o `apiKey`— solicita `/analitica`, el sistema DEBE
invocar `notFound()` y NO DEBE renderizar el shell.

**R4.** SI no hay sesión válida (actor nulo), ENTONCES el sistema DEBE invocar
`notFound()` y NO DEBE renderizar el shell.

**R5.** El sistema DEBE resolver el rol del solicitante EXCLUSIVAMENTE en el
servidor a partir de la sesión, sin aceptar rol, query param, cabecera ni prop del
cliente como fuente de autorización.

**R6.** El sistema DEBE aplicar el gate de rol de R2–R4 ANTES de renderizar
cualquier contenido de la página (no basta con ocultar el ítem del menú).

## 2. El ítem de sidebar

**R7.** El sistema DEBE declarar en `SIDEBAR_ITEMS` exactamente UN ítem cuyo `href`
sea `/analitica`, con la etiqueta visible `"Analítica"` (D3).

**R8.** MIENTRAS el actor autenticado tenga rol `maestro` o `admin`,
`itemsVisibles` DEBE incluir el ítem de analítica en su resultado.

**R9.** SI el actor tiene rol `mensajero`, `adminTienda`, `adminSatelite` o
`apiKey`, o no hay actor (sesión ausente o inválida), ENTONCES `itemsVisibles`
NO DEBE incluir el ítem de analítica.

**R10.** El conjunto de roles que ve el ítem de analítica DEBE ser idéntico al
conjunto de roles que la página `/analitica` deja pasar (D2): ninguna de las dos
capas puede autorizar un rol que la otra rechace.

**R11.** El sistema DEBE declarar para el ítem de analítica la clave de icono nueva
`chartColumn`, añadida al tipo `IconKey` y distinta de todas las existentes
(`home`, `settings`, `user`, `package`, `clipboardCheck`, `truck`, `megaphone`,
`trophy`, `wallet`, `shieldAlert`).

**R12.** El sistema DEBE resolver TODA clave del tipo `IconKey` a un componente de
icono en el mapa del Sidebar: no puede existir una clave declarada sin icono
asociado.

**R13.** CUANDO el Sidebar recibe el ítem de analítica entre sus `items`, DEBE
renderizar un enlace de navegación hacia `/analitica` con su etiqueta visible y su
icono.

**R14.** MIENTRAS la ruta activa sea `/analitica`, el enlace del ítem de analítica
DEBE marcarse como activo (`aria-current="page"`).

**R15.** El ítem de analítica NO DEBE declarar subítems (`children`).

**R16.** El sistema DEBE ubicar el ítem de analítica inmediatamente después del
ítem "Inicio" (`/dashboard`) y antes del primer ítem "Órdenes" (`/ordenes`) dentro
de `SIDEBAR_ITEMS` (D7).

**R17.** El sistema NO DEBE modificar la visibilidad por rol, la etiqueta ni el
destino de ningún ítem de menú preexistente: el único cambio en el conjunto de
ítems visibles de cada rol DEBE ser la adición del ítem de analítica para
`maestro` y `admin`.

## 3. El shell del tablero (contrato para 130/131/132/133)

**R18.** El sistema DEBE renderizar el shell mediante un componente propio con
contrato de props tipado (punto de extensión), no como marcado suelto dentro de la
página.

**R19.** El shell DEBE renderizar un encabezado de página con el título de la
sección, usando el envoltorio único de página del repo (`AppPage`).

**R20.** El shell DEBE exponer, apiladas verticalmente (D5), exactamente dos
regiones nombradas y accesibles —"Filtros" y "Tablero operativo"—, cada una
identificable por su nombre accesible. NO DEBE renderizar una región financiera
(D6).

**R21.** DONDE una región reciba contenido por su prop correspondiente, el shell
DEBE renderizar ese contenido dentro de esa región.

**R22.** MIENTRAS una región NO reciba contenido, el shell DEBE mostrar en ella un
estado vacío que declare que el panel aún no está disponible, y NO DEBE mostrar
cifras, series, ejes ni etiquetas de métrica de ningún tipo.

**R23.** El shell NO DEBE ejecutar fetch de datos ni contener lógica de cálculo:
todo su contenido DEBE llegarle por props.

**R24.** La página `/analitica` NO DEBE invocar Server Actions, servicios ni
repositorios de analítica; su única lectura server-side DEBE ser la resolución del
actor desde la sesión.

**R25.** El sistema NO DEBE introducir dependencias nuevas de terceros (librerías
de gráficas u otras) para cumplir esta feature.

---

## Nota de traspaso a la feature 133

La 133 ("analítica: recortes por rol") es la que amplía el acceso a
`adminSatelite`, `adminTienda` y `mensajero`.

> **Corregida el 2026-07-30 (hallazgo M-5 del reviewer).** La versión anterior de
> esta nota mandaba "tocar DOS sitios: el `roles` del ítem y la constante
> `ROLES_ANALITICA`". **Eso era falso y además peligroso**: hoy los dos sitios son
> el mismo (el ítem escribe `roles: ROLES_ANALITICA`), así que un implementer que
> siguiera la nota al pie desengancharía el ítem escribiendo un literal — que es
> exactamente el anti-patrón que R10 existe para vigilar. La nota inducía el bug
> que la feature previene.

### Qué hay que hacer: editar UNA sola constante

Ampliar el acceso es **un único cambio, en un único sitio**:

```ts
// lib/auth/menu-visibility.ts
export const ROLES_ANALITICA = ["maestro", "admin", "adminSatelite", "adminTienda", "mensajero"] as const;
```

Y **nada más**. Esa constante alimenta ya las dos capas:

- el `roles` del ítem con `href: "/analitica"` en `SIDEBAR_ITEMS` (visibilidad del
  menú), y
- el guard `notFound()` de `app/(app)/analitica/page.tsx` (la defensa real), que la
  importa desde este mismo módulo.

### Qué NO hay que hacer

**NO escribas un literal de roles ni en el `roles` del ítem ni en el guard.** En
cuanto una de las dos capas deja de leer `ROLES_ANALITICA`, las dos pueden divergir
y se rompe **R10**: si sólo se amplía el menú, los roles nuevos ven la entrada y
reciben 404; si sólo se amplía el guard, entran por URL sin entrada de menú. El test
de R10 (`tests/unit/auth/menu-visibility.test.ts`) está puesto precisamente para
matar la primera variante, y los tests de página, que enumeran los seis roles del
enum uno a uno, matan la segunda.

### Tests que se pondrán rojos AL AMPLIAR, y que es CORRECTO actualizar

Ampliar la constante deja rojos, **por diseño**, los tests que hoy congelan el
alcance restringido de la 129. Son aserciones que describen la decisión D1, no
invariantes de seguridad: hay que **actualizarlas** para reflejar el alcance nuevo.

1. **R9** (`R9: puedeVer e itemsVisibles lo excluyen para el resto de roles y sin
   actor`): los roles ampliados dejan de estar excluidos. Quitar de la lista de
   exclusión los que pasen a tener acceso; **`apiKey` y el actor `null` deben seguir
   excluidos** (es cuenta de máquina y sesión ausente, no se amplían nunca).
2. **R17** (las listas de labels por rol comparadas por IGUALDAD): cada rol que gane
   el acceso tendrá "Analítica" en su lista de ítems visibles. Añadirlo en la
   posición que corresponda a cada lista.
3. **R3** en `tests/components/AnaliticaPage.test.tsx`: los roles ampliados dejan de
   recibir `notFound()` y pasan al caso de R2 (ven el shell).

**Regla al actualizarlos: se mueve el rol de una lista a la otra, nunca se relaja el
guard ni se borra el caso.** Si para poner un test en verde hace falta eliminar una
aserción de exclusión en vez de moverla, es señal de que el cambio está mal hecho.

### Cuándo

Sólo tiene sentido **después** de que 131/132 hayan cableado contenido: ampliar antes
reintroduce exactamente el problema que D1 evita (una entrada de menú que lleva a una
página vacía).
