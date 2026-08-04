# Feature 131 — analítica: tablero operativo · design

> Frontend puro. **No** crea tablas, **no** crea migraciones, **no** crea endpoints, **no** escribe
> en `lib/`. Cablea una Server Action ya existente (126) a componentes ya existentes (130) dentro
> de una ruta ya existente (129).

## 1. Frontera de archivos — qué toca la 131, exactamente

Esto es **contrato**, no estilo: la **132** (tablero financiero) está viva en paralelo y las dos
features son de zona `frontend`.

### 1.1 Archivos NUEVOS (propiedad exclusiva de la 131)

```
app/(app)/analitica/_components/operativo/
  PanelesOperativos.tsx      "use client"  — orquesta los paneles, consulta y estados
  FiltrosOperativos.tsx      "use client"  — barra de filtros (rango, zona, tienda, mensajero)
  PanelOperativo.tsx         "use client"  — UN panel: consulta + mapeo a la gráfica de la 130
  catalogo-paneles.ts        puro          — qué métricas se pintan y con qué gráfica
  filtro-tablero.ts          puro          — estado de filtro <-> `raw` de la 135 <-> searchParams
  agregacion.ts              puro          — «otros», agregación temporal, totales, parcialidad
  textos.ts                  puro          — textos de UI (cobertura, parcial, prohibido, error)
```

```
tests/unit/analytics/tablero-agregacion.test.ts
tests/unit/analytics/tablero-filtro.test.ts
tests/unit/analytics/tablero-catalogo-paneles.test.ts
tests/unit/analytics/tablero-operativo-frontera.guardia.test.ts
tests/components/TableroOperativo.test.tsx
tests/components/FiltrosOperativos.test.tsx
```

### 1.2 Archivos MODIFICADOS (compartidos — se tocan al mínimo)

| Archivo | Qué cambia | Riesgo con la 132 |
|---|---|---|
| `app/(app)/analitica/page.tsx` | dos props de slot en el `<AnaliticaShell/>` + dos `import` de `./_components/operativo/*`. **Nada más**: ni `searchParams`, ni parámetros, ni `lib/actions` | **SÍ colisiona**: la 132 añadirá `financiero={…}`. **D5 (humano, 2026-08-03): la 131 aterriza PRIMERO**, la 132 rebasa sobre la página ya cableada y el conflicto debe quedar en ~3 líneas |
| `tests/components/AnaliticaPage.test.tsx` | añadir los mocks que el nuevo árbol de cliente necesita; **conservar intactas** las aserciones R5 (`length === 0`) y R24 (la página no importa `lib/actions`/`services`/`repositories`) | bajo |

### 1.3 Archivos que la 131 NO toca (y por qué)

- `app/(app)/analitica/_components/AnaliticaShell.tsx` — es lo único que la **132** necesita
  modificar de verdad (añadir el slot `financiero`, tres pasos ya escritos en su JSDoc). La 131 no
  tiene ninguna razón para tocarlo: sus slots ya existen. **D5 lo fija como regla, no como
  preferencia**: la 131 añade sus **dos** slots y el shell queda íntegro para la 132.
- `components/private/analytics/**` — paquete de la 130, cerrado. Si el tablero necesitara otra
  forma de props, es una conversación con el dueño de la 130, no una edición.
- `lib/analytics/**`, `lib/actions/**`, `lib/services/**`, `lib/repositories/**` — backend
  (126/127/128/135). **En particular `lib/analytics/metrics.ts` no se toca**: sus tres divergencias
  están declaradas y aplazadas a la ficha **175**.
- `lib/auth/menu-visibility.ts` — ampliar el acceso es de la **133**.

### 1.4 El guardia que hace cumplir esta frontera

`tests/unit/analytics/tablero-operativo-frontera.guardia.test.ts`, con **dos partes** claramente
separadas en el archivo, siguiendo el patrón ya establecido por
`tests/unit/analytics/operativa-frontera.guardia.test.ts` (126):

**Parte PERMANENTE** (sobrevive al merge; censa el árbol, no el diff):
1. ningún archivo bajo `app/(app)/analitica/` importa `AnaliticaOperativa*Service|Repository`,
   `@/lib/db`, `@prisma/client` como valor, ni define una ruta `app/api` de analítica (**R1**);
2. ningún archivo bajo `app/(app)/analitica/` importa `lib/analytics/alcance*`,
   `lib/analytics/identidad` ni `esAccesoTotal` (**R10**);
3. ningún archivo bajo `app/(app)/analitica/_components/operativo/` importa
   `lib/actions/analitica-financiera`, `lib/types/analitica-financiera` ni
   `lib/analytics/metrics` (**R25**; `metrics` es dato de servidor y arrastraría al navegador el
   censo de tablas — es la misma regla que `components/private/analytics/tipos.ts:1-9`);
4. `lib/actions/analitica.ts` no existe (**R25**; se reafirma aquí porque el guardia de la 126
   vigila el nombre desde el lado backend y esta feature es la primera consumidora frontend que
   podría sentir la tentación de crearlo);
5. **caso de discriminación**: el censo detecta un archivo infractor sintético y NO marca una
   mención en prosa. Sin este caso, el guardia podría ser verde por vacío.

**Parte BRANCH-SCOPED** (mide el diff contra `origin/dev`), con esta cabecera escrita **en el
archivo**:

> ⚠ **Este bloque CADUCA en el merge de la 131.** Mide el diff de la rama contra `origin/dev`: en
> cuanto se mergea, pasa a juzgar cualquier rama posterior y da verdes vacíos o rojos ajenos (la
> lección de `frontera.guardia.test.ts`, retirado por el chore del PR #232, y de la T13.1 de la
> 126). **Su retirada se decide en el PR de esta feature, no después.** Lo que sobrevive es la
> parte permanente de arriba, que censa el árbol y no el diff.

Lo que mide: que el diff de la rama no toca `AnaliticaShell.tsx`, ni `components/private/analytics/`,
ni `lib/**`, ni ningún archivo de la 132.

## 2. Lo que la 131 hace y lo que no

| Hace | No hace | Quién lo hace |
|---|---|---|
| Invocar `consultarAnaliticaOperativa` una vez por panel | Consultar la base, recortar por rol, seudonimizar | 126 / 122 |
| Agrupar en «otros», agregar por semana, totalizar | Dibujar ejes, colorear, formatear | 130 |
| Pintar `cobertura` y `parcial` | Estimar la penumbra, rellenar días ciegos | nadie: R20 de la 126 lo prohíbe |
| Ofrecer 4 filtros y validarlos por el esquema de la 135 | Declarar un esquema propio de filtros | 135 |
| Poner y quitar paneles | Decidir qué ve cada rol | 133 |
| — | Cachear / invalidar | 128 |

## 3. Contrato de entrada/salida que se consume (verificado, no supuesto)

```ts
// lib/actions/analitica-operativa.ts:43-48, 78-81
consultarAnaliticaOperativa(
  { metricaId: string; raw: unknown; desagregacion?: DimensionAnalitica },
): Promise<ResultadoOperativo>

// lib/types/analitica-operativa.ts:80-123
type ResultadoOperativo =
  | { status: "ok"; datos: SerieOperativa }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden" }
  | { status: "unauthenticated" }

interface SerieOperativa {
  metricaId; unidad: MetricaUnidad; unidadDeConteo; rango: RangoResuelto;
  puntos: readonly { fecha: string; dimension?: string; valor: number | null;
                     parcial?: true; corteAt?: string }[];
  cobertura: { fechasNoComparables: readonly string[]; penumbra: Penumbra };  // sin `?`
  nota?: NotaSinGestionar;                                                     // solo sin_gestionar
}
```

`raw` es lo que valida `analiticaFiltroSchema` (`lib/analytics/filters.ts:66-116`): `rango`
obligatorio (`dia|semana|mes|personalizado`), `desde`/`hasta` **solo** con `personalizado`,
`zona_id`/`tienda_id`/`mensajero_id` como **listas no vacías** de ids no vacíos, y `.strict()` — una
clave de más es `validation_error`, no un silencio.

## 4. Arquitectura de la pantalla

### 4.1 Composición

```
app/(app)/analitica/page.tsx            Server Component  (129, sin cambios de fondo)
  └─ <AnaliticaShell                    Server Component  (129, NO se toca)
        filtros={<FiltrosOperativos/>}      "use client"   (131)
        operativo={<PanelesOperativos/>} />  "use client"  (131)
             └─ <PanelOperativo/> × N        "use client"  (131)
                   └─ GraficaBarras / GraficaLineas / GraficaDonut / KpiCard / TablaResumen  (130)
```

### 4.2 Dónde vive el estado del filtro, y por qué NO en el Server Component

Los dos slots del shell son **hermanos**: no hay envoltorio común donde poner un provider sin
editar `AnaliticaShell.tsx` (que es de la 132). El estado compartido va por tanto a la **URL**
(`useSearchParams` + `router.replace`): `FiltrosOperativos` escribe, `PanelesOperativos` lee. Con
eso los dos subárboles se sincronizan sin contexto, y el filtro queda además compartible y
recuperable al recargar (R13 se vuelve verificable: mismo URL, mismo filtro).

`filtro-tablero.ts` es el módulo **puro** que traduce en los dos sentidos
`URLSearchParams ⇄ FiltroTablero ⇄ raw`, y es donde viven R11, R13 y R14 — testeables sin render.

**Alternativa descartada nº1 — el `searchParams` del Server Component.** Sería lo idiomático de App
Router: la página lee `searchParams`, llama a la acción y baja los datos por props. Se descarta por
**tres** razones verificadas: (a) `tests/components/AnaliticaPage.test.tsx:102-104` afirma
`AnaliticaPage.length === 0`, y darle el parámetro `searchParams` lo rompe; (b)
`ibíd.:145-157` afirma que la página **no importa `lib/actions`**, y prefetchear ahí lo rompe
también; (c) cada cambio de filtro sería una navegación de servidor completa, con la pantalla entera
en suspenso, cuando lo que cambia son N gráficas. Que `specs/129-…/design.md:143-145` anticipara el
prefetch en la página es una expectativa de la 129 que **su propio test contradice**.

**D7 (humano, 2026-08-03): resolución aceptada — se conservan los tests y se contradice la prosa de
la 129 a propósito.** En este repo **el guardia manda sobre la prosa del diseño**. La expectativa de
prefetch de `specs/129-…/design.md:143-145` **queda deliberadamente sin cumplir**; el rastro está en
`requirements.md §5`, aquí, y en `progress/impl_131.md` (T7.3), para que quien lea la 129 después no
lo tome por un olvido de esta feature. Revivir el prefetch exige retirar o reescribir esas dos
aserciones de `AnaliticaPage.test.tsx` en su propio PR.

**Alternativa descartada nº2 — un único componente cliente en el slot `operativo` que pinte también
su propia barra de filtros.** Resuelve el estado compartido con un `useState` y cero URL. Se
descarta porque dejaría el slot `filtros` vacío, y el shell entonces pinta *«Los filtros llegan en
una entrega posterior»* (`AnaliticaShell.tsx:50-53`) **debajo de unos filtros que ya existen**: una
mentira en pantalla, que es justo lo que R22 de la 129 prohíbe.

**Alternativa descartada nº3 — mover el estado a un provider global en `providers/`.** El repo solo
tiene `ToastProvider`; añadir un provider global para el estado de UNA pantalla es sobre-ingeniería
explícitamente rechazada por `docs/architecture.md` («si un componente se usa en un solo lugar…»).

### 4.3 Cómo se consulta

Patrón dominante del repo (`OrdenesModule.tsx:58-71`): **SWR con la Server Action como fetcher**.
La clave SWR de cada panel es `[metricaId, desagregacion, filtroSerializado]`, de modo que:

- cambiar un filtro cambia la clave → se vuelve a consultar (**R12**);
- el botón «Actualizar» hace `mutate` de todas las claves del tablero sin tocar el filtro (**R23**);
- dos paneles con la misma métrica no duplican petición.

**D4 (humano, 2026-08-03): una llamada por panel, con ≤6 paneles, y la latencia MEDIDA.** La Server
Action compuesta queda **descartada por el humano**: pondría a una feature de zona `frontend` a
escribir en `lib/actions/`, que es justo donde la **128** va a colgar su caché **en paralelo**. Y se
deja escrito, porque es la clase de cosa que se olvida: **el coste de las N invocaciones NO está
medido** —no sé si Next las serializa ni cuánto tardan— y **medirlo es parte de la entrega**, no un
extra opcional (T7.2, con el número pegado en `progress/impl_131.md`).

Cada `PanelOperativo` maneja **su** resultado: `ok`, `forbidden`, `validation_error`,
`unauthenticated` y excepción (R2, R3, R4, R24). Un panel roto no tumba a los demás porque cada uno
tiene su propio estado SWR y su propio render de error; no se usa un único `Promise.all` cuyo
rechazo se propague.

## 5. Filtros

### 5.1 Estado inicial (R13)

`{ rango: "semana" }`, sin zona, sin tienda, sin mensajero. Razones: (a) `semana` es borde de
**calendario** (lunes → hoy, `lib/analytics/ranges.ts`), así que produce entre 1 y 7 puntos —muy por
debajo del techo de 62— y no obliga a agregar nada en el arranque; (b) incluye el día en curso, con
lo que el marcador `parcial` es visible desde el primer render y no es una rama que solo se
ejercite en tests; (c) `dia` daría un único punto (una gráfica de un punto no es una gráfica) y
`mes` son 30 días móviles, más caros sin ganar lectura en la primera carga.
**Sujeto a Q… no**: esto no es pregunta abierta, es una decisión del design con su porqué; si el
humano prefiere `mes` es un cambio de una constante en `filtro-tablero.ts` y su test.

### 5.2 Origen de las opciones (R22)

| Filtro | Fuente ya existente | Verificado en |
|---|---|---|
| zona | `obtenerCatalogoFiltrosOrdenes()` → `catalogo.zonas` | `lib/actions/filtros-ordenes.ts:37`, `lib/types/filtros-ordenes.ts:38-46` |
| tienda | `obtenerCatalogoFiltrosOrdenes()` → `catalogo.tiendas` | ídem |
| mensajero | `listarUsuariosPorRol("mensajero")` | `lib/actions/usuarios-por-rol.ts:29` |
| rango | `RANGO_PRESETS` (`lib/analytics/types.ts:204`) + `DateRangeFilter` para `personalizado` | `components/shared/DateRangeFilter.tsx` |

Los dos servicios autorizan `maestro`/`admin`/`adminTienda`
(`FiltrosOrdenesService.ts:28`, `UsuariosPorRolService.ts:15`), que **cubre** el gate actual de
`/analitica` (`maestro`/`admin`). Cuando la **133** amplíe roles, esos dos catálogos responderán
`forbidden` a `adminSatelite`/`mensajero`: el degradado de R22 (selector deshabilitado, tablero
vivo) ya cubre ese caso sin cambios aquí.

Controles reutilizados, no reinventados: `MultiSelectFilter` (`components/shared/`) para las tres
dimensiones y `DateRangeFilter` para el rango personalizado.

### 5.3 Serialización (R11, R14)

```
FiltroTablero  { rango; desde?; hasta?; zonaIds: string[]; tiendaIds: string[]; mensajeroIds: string[] }
      → raw    { rango, [desde, hasta], [zona_id], [tienda_id], [mensajero_id] }   // lista vacía = clave OMITIDA
```
Una lista vacía significa «sin filtro» y por tanto **se omite la clave**: el esquema exige lista no
vacía (`filters.ts:27`) y enviar `[]` sería un `validation_error` provocado por nosotros. `desde`/
`hasta` solo se emiten con `personalizado`, y con `personalizado` se emiten siempre (R14).

## 6. Paneles y presentación honesta

### 6.1 Catálogo de paneles (`catalogo-paneles.ts`, R21)

Lista **declarativa y explícita** de `{ metricaId, grafica, desagregacion? }`. No se deriva de
`listarMetricas()` porque:

- filtrar por `estadoProduccion` **borraría `incidentes` y `sin_gestionar`**, que están marcados
  `declarada` en el catálogo pero la 126 **sí sirve** (`specs/126-…/design.md:468-480`, divergencias
  1 y 3 heredadas a la 175);
- importar `lib/analytics/metrics` desde un componente cliente arrastraría al navegador el censo de
  tablas y fuentes, que es dato de servidor (misma regla que `components/private/analytics/tipos.ts`).

El vínculo con el catálogo real se mantiene **por test**, no por import de producción:
`tablero-catalogo-paneles.test.ts` comprueba contra `getMetrica()` que cada `metricaId` existe, que
su `dominio` es `operativa` y que la `desagregacion` declarada está en sus `granos`.

**D6 (humano, 2026-08-03):** el test de R21 **nombra `incidentes` y `sin_gestionar`** y afirma su
presencia. No cuenta paneles: este fallo es silencioso y ocurre **en pantalla** —dos KPI vivos
desaparecen sin excepción, sin log y sin hueco visible—, así que la mutación tiene que ser
inequívoca.

Paneles v1 (≤6 por **D4**): `ordenes_creadas` (líneas), `ordenes_por_estado` (donut,
desagregación `estatus`), `entregas`+`devoluciones`+`rechazos` (barras), `tasa_entrega` (líneas),
`motivos_devolucion` (barras, desagregación `causa_devolucion`), `tiempo_ciclo` (líneas).
La composición final es cosmética y no afecta a ningún requisito salvo R21.

### 6.2 «Otros» (R15)

`agregacion.ts` ordena las categorías por magnitud descendente, conserva las **5 primeras** y suma
la cola en una categoría «otros», devolviendo también cuántas se agruparon para el texto. Dirección
deliberada: es la que fijó el humano para el donut (`specs/130-…/tasks.md:56-62`); aplicarla también
a barras evita dos reglas distintas de recorte por categoría en la misma pantalla.

Solo es legítimo sumar la cola si la métrica es de `unidad: "conteo"`. Para `porcentaje`/`segundos`
desagregados no se agrupa: se aplica la política de §6.3.

### 6.3 Agregación temporal (R16, R17, R18)

- `unidad: "conteo"` → se agrega **sumando** por semana ISO cuando la serie pasa de 62 puntos. La
  suma de conteos diarios es exacta (misma `unidadDeConteo` en todos los puntos, `sonSumables` se
  cumple por construcción: es la misma métrica).
- `unidad: "porcentaje"` y `"segundos"` → **no se agregan** (**D3**, humano 2026-08-03). El servicio
  ya dividió por día y promediar cocientes es la media de medias que
  `AnaliticaOperativaService.ts:38-40` evita a propósito; publicarla en pantalla la reintroduciría
  por la puerta de la UI. El panel **no pinta serie** y muestra el aviso de reducir el rango.
- Cualquier cubo agregado que contenga un punto `parcial: true` **hereda** `parcial` y el `corteAt`
  mayor (**D2**, R18), y todo total que lo incluya se anuncia parcial (R9).

**El «KPI total» que pedía D3 no existe todavía, y no se rellena (R27).** D3 pedía que esos paneles
mostrasen el total; con lo que la 126 expone hoy **no hay forma honesta de calcularlo**:

| Vía | Por qué no |
|---|---|
| media de los puntos diarios | es la media de medias que la propia D3 prohíbe |
| recomponer la razón desde los conteos (`entregas / Σ DENOMINADOR_GESTIONES`) | sería exacto, pero duplica en la UI una fórmula de negocio del catálogo y del servicio, y obliga a importar `lib/analytics/metrics` en cliente — prohibido por R25 |
| para `tiempo_ciclo` | **imposible**: `seg_ciclo_acum`/`seg_ciclo_n` no se exponen como métricas; no hay nada que sumar antes de dividir |

Por eso el panel muestra el aviso y **ninguna cifra** hasta que aterrice la ficha de
`requirements.md §7` (el modo agregado de verdad, que es la parte (C) de D3). Es el mismo criterio
que gobierna la ventana ciega: el hueco se declara, no se rellena. Cambiar esto (p. ej. aceptar la
recomposición desde los conteos) es tocar R27 y este párrafo, nada más.

### 6.4 Cobertura y parcialidad en pantalla (R5–R9) — **D1 y D2**

**D1 (humano, 2026-08-03): aviso ÚNICO** con recuento y extremos, más la marca en la alternativa
textual. Descartadas: recortar el rango efectivo *(altera lo que el usuario pidió y tapa el
agujero)* y la nota al pie por gráfica *(repite el mismo aviso hasta volverlo invisible)*.
**D2 (humano, 2026-08-03): el día en curso se pinta EN la serie**, marcado por texto con su
`corteAt`, y **todo agregado que lo incluya se anuncia parcial**.

- **Aviso de cobertura**: un `Alert` (`components/ui/alert.tsx`) sobre la rejilla de paneles —**uno
  para todo el tablero, no uno por gráfica** (D1)—, que
  aparece si y solo si `cobertura.fechasNoComparables.length > 0`, con el recuento y los extremos
  (`[0]` y `[n-1]`, ya vienen en orden ascendente porque el servicio las deriva de
  `fechasDelRango`), y con la frase de penumbra.
- **El horizonte no se escribe**: el texto se construye a partir de las fechas del payload. Escribir
  la fecha literal pondría rojo el censo existente `operativa-cobertura.test.ts:62-93`, que exige
  que aparezca en **un solo archivo** del árbol (**R7**). Ese censo es la red de esta feature: no se
  toca y no hace falta uno nuevo.
- **Punto parcial**: la categoría del punto se compone con un sufijo textual con su hora de corte en
  Costa Rica, y la alternativa textual de la 130 (`SerieTextual`) lo lleva por tanto sin cambios en
  el paquete. Se usa `fechaCalendarioCR`/utilidades de `lib/utils/fecha-cr` para el formato: cero
  aritmética horaria propia.

### 6.5 Valores (R19, R20)

`porcentaje` se pasa **crudo** (`0,842` → «84,2 %» lo hace `formato.ts:27`) y `null` se pasa como
`null` (la 130 lo pinta como hueco/`SIN_MONTO`; sustituirlo por `0` sería afirmar un dato que no
existe, que es el mismo pecado que la ventana ciega).

## 7. Accesibilidad y estados

Se hereda todo del paquete de la 130 (`GraficaMarco`: `role="region"` con nombre, `role="alert"` en
error, `role="status"` en carga, precedencia error > carga > vacío). Lo que aporta la 131 es que
**cada estado del `ResultadoOperativo` cae en el estado visual correcto**, y que `forbidden` **no**
cae en «vacío» (R2): el vacío de una gráfica habla de la métrica sin datos en el rango
(`tipos.ts:51-57`), y usarlo para un denegado convertiría un problema de permisos en un problema de
negocio inexistente.

## 8. Datos, RLS y migraciones

**Ninguno.** Esta feature no crea ni altera tablas, columnas, índices, políticas RLS ni
migraciones; no hay `down.sql` que escribir. Toda lectura pasa por la Server Action de la 126, que
ya aplica alcance y auditoría de denegados. Los checkpoints de «datos y seguridad» se cumplen por
no-aplicabilidad, y así se declarará en la review.

## 9. Frontera con la 128 (caché) — lo que el tablero asume

La 128 (`pending`) pondrá `cacheTag` en las lecturas e invalidación por el job diario y por la
aprobación de cierres. **La 131 no diseña nada de eso** y asume exactamente esto, ni más ni menos:

1. Cada invocación de `consultarAnaliticaOperativa` devuelve lo que el servidor considere vigente en
   ese momento. El tablero **no** afirma en pantalla ninguna «hora de última actualización» que no
   venga en el payload (el único instante que el payload trae es `corteAt`, y solo del día en
   curso).
2. El control «Actualizar» (R23) **re-invoca la acción**; no llama a `revalidateTag` ni conoce
   ninguna etiqueta. Si la 128 introduce caché, ese botón seguirá siendo correcto (devolverá lo que
   la caché sirva) y será la 128 quien decida si además invalida.
3. Si la 128 cambia la **firma** de la acción, esta feature se rompe en el typecheck, que es la
   forma correcta de enterarse. No hay adaptador defensivo.

## 10. Riesgos declarados

1. **Coste de las N invocaciones: NO MEDIDO, y medirlo es parte de la entrega (D4).** N paneles = N
   invocaciones por cambio de filtro. No he medido la latencia ni si Next las serializa; no lo
   afirmo en ninguna dirección. **T7.2 lo mide y pega el número en `progress/impl_131.md`.** Si sale
   mal, la respuesta es ficha propia con la 128 ya aterrizada, no un parche aquí ni una Server
   Action compuesta (descartada por D4).
2. **`useSearchParams` y Suspense**: en App Router, un componente cliente que llama a
   `useSearchParams()` puede exigir una frontera `<Suspense>`. La página es dinámica (resuelve
   sesión por cookies), así que no debería bloquear, pero **no está verificado en build** (y
   `pnpm build` no se corre: encadena `migrate deploy`). Si `pnpm exec next build` protesta, la
   respuesta es envolver cada slot en `<Suspense>` **dentro de `page.tsx`**, sin tocar el shell.
3. **Colisión con la 132 en `page.tsx`.** Acotada por **D5**: la 131 aterriza primero y la 132
   rebasa. Riesgo residual: si la 132 aterrizara antes por cualquier motivo, el implementer rebasa
   **antes** de T6 y conserva los tres slots. Sigue siendo un conflicto de ~3 líneas.
4. **El techo de 5 series aplicado a `ordenes_por_estado` (19 estados)** hace que «otros» sea, en la
   práctica, un cubo grande. Es la consecuencia asumida de la decisión Q3 de la 130; se anuncia por
   texto (R15) para que nadie lea el donut como si tuviera 5 estados.
5. **Divergencia 2 de la 175** (`ordenes_por_estado` declara los 19 estados del seed mientras la
   columna contiene el universo B2) **se vuelve visible al usuario final en esta pantalla**
   (`specs/126-…/design.md:475-478`). La 131 **no la corrige**; la declara en la review para que el
   panel del embudo no se lea como «faltan estados».
6. **Hueco funcional consciente (R27):** por encima del techo de puntos, los paneles de tasas y
   tiempos se quedan **sin serie y sin cifra**. Es la consecuencia aceptada de D3 y se cierra cuando
   aterrice la ficha del modo agregado (`requirements.md §7`). Está escrito para que no se lea como
   un panel roto.
