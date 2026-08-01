# Feature 122 — analítica: resolutor de alcance por rol · design

> **Frontera de seguridad multi-tenant.** El objetivo de diseño no es «que el recorte se aplique»,
> sino que **olvidarlo no compile**. Todo lo demás de este documento está subordinado a eso.
>
> Depende de la **135** (mergeada). **Puerta F1.4 cerrada el 2026-07-31**: las diez decisiones
> D1–D10 están en `requirements.md > 2. Decisiones del humano` y ya están aplicadas aquí. No queda
> nada marcado `⧗Qn`.

## 1. Modelo de datos

**Ninguno.** Esta feature no crea tablas, columnas, índices, migraciones ni políticas RLS, y por
tanto **no lleva `migration.sql` ni `down.sql`**. Ni siquiera lee la base: es un módulo puro que
**declara** el recorte que otros aplicarán. Lo que sí hace es fijar, de una vez y para todo el
lote, **qué columna encarna cada recorte**:

| Alcance | Columna canónica | Verificado en |
|---|---|---|
| zona (`adminSatelite`) | `orden.zona_id` (NOT NULL) | `db/schema.prisma:469`; D9 de la 135 |
| tienda (`adminTienda`) | `orden.tienda_id` = `actor.usuarioId` (FK a `usuario`) | `db/schema.prisma:468,505` |
| mensajero (`mensajero`) | **`orden.mensajero_asignado_id`** (nullable), siempre y para toda métrica (D3). `gestion_orden.mensajero_id` **no se usa nunca** como columna de recorte | `db/schema.prisma:478`; D3 |
| rollup | columnas homónimas del grano de `analytics_daily` | tabla **aún inexistente**: la crea la 123 |

**Hechos de inventario que condicionan el diseño** (todos con `archivo:línea`):

1. **El `adminTienda` ES la tienda.** No hay tabla `tienda` ni `usuario.tienda_id`:
   `orden.tienda_id` es FK a `usuario` (`db/schema.prisma:505`). El repo ya resuelve así el
   alcance en otros dos sitios: `lib/notificaciones/emitir.ts:110` y `OrdenService.crear`
   (`lib/services/OrdenService.ts:122-127`). Por eso el alcance de tienda **no necesita** un campo
   nuevo en el actor.
2. **`usuario.zona_id` es nullable** (`db/schema.prisma:98`) y `resolveActorFromSession` la
   normaliza a `null` (`lib/auth/resolve-actor.ts:33`). Un `adminSatelite` sin zona es
   representable ⇒ R13 (fallo cerrado), no una hipótesis.
3. **`gestion_orden` no tiene zona ni tienda** (`db/schema.prisma:648-694`: solo `orden_id` y
   `mensajero_id`). Recortar gestiones por zona/tienda exige pasar por la relación `orden` ⇒ R24.
4. **`RolValue` tiene SEIS valores** (`db/schema.prisma:35-44`), `ROLES_ANALITICA` tiene **cinco**
   (`lib/analytics/types.ts:54-60`): `apiKey` queda fuera ⇒ R11.
5. **Ninguna métrica financiera es `acotada`**: `ALCANCE_FINANCIERA`
   (`lib/analytics/metrics.ts:63-69`) solo tiene `total` y `prohibido` ⇒ **no hay que recortar
   ningún ledger**, lo que reduce la superficie de esta feature a las tablas operativas (R25).
6. **El `Actor` del repo no puede importarse aquí**: vive en
   `lib/interfaces/services/IOrdenService.ts:13-24` y el segmento `services` está prohibido por el
   guardia de pureza (`tests/unit/analytics/modulo-puro.guardia.test.ts:110`) ⇒ tipo estructural
   propio + test de asignabilidad (R30).
7. **La 159 ya declaró una fuente de verdad para el mensajero de una orden.** El comentario de la
   propia columna lo dice: `mensajeroAsignadoId … // feature 17/R7: mensajero ASIGNADO (decision
   del maestro); feature 159: unica fuente de verdad del mensajero de una orden`
   (`db/schema.prisma:478`; reproducible con `git show origin/dev:db/schema.prisma`). **D3 se apoya
   en este precedente**: el recorte del mensajero es `orden.mensajero_asignado_id` para toda
   métrica, incluidas las cinco `unidadDeConteo: "gestion"` que cuentan el **actor** de la gestión.
   La consecuencia —el mensajero pierde el crédito de las gestiones de una orden que le reasignaron—
   está escrita en R28 y es comportamiento **esperado**, con test nombrado. Ver
   `requirements.md > D3`.

8. **El guardia de pureza de la 135 solo mira imports DIRECTOS**
   (`modulo-puro.guardia.test.ts:120-151`). `@/lib/auth/acceso-total` lo pasaría, pero ese archivo
   sí importa `@prisma/client` **como valor** (`lib/auth/acceso-total.ts:1`) ⇒ la reutilización que
   D7 de la 135 ordena introduce una dependencia transitiva que hoy nadie vigila. **D8 autoriza
   ampliar ese mismo archivo** a la clausura transitiva (R35/R36); ver §3.8.

9. **El canal de logging del repo existe y tiene nombre** (necesario para D10/R40): interfaz
   `ErrorLogger` (`lib/errors/logger.ts:6-8`), implementación por defecto `ConsoleErrorLogger`
   (`:13-21`), consumida por `normalizeError` (`lib/errors/normalize.ts:20`) y `withErrorHandler`
   (`lib/errors/with-error-handler.ts:10-19`), que es lo que usan los seis crons y el webhook de
   WhatsApp. **Trampa verificada:** `normalizeError` devuelve la shape de un `AppError` en su primera
   línea (`:22`) y solo llama a `logger.logError` en la rama del error **desconocido** (`:45`); un
   `ForbiddenError` **no se registra solo**. Ver §3.7.

## 2. Ubicación y archivos

```
lib/analytics/
  alcance.ts             # tipos del alcance + resolverAlcance() (puro)
  alcance-columnas.ts    # adaptadores alcance -> fragmento de where por tabla
  consulta.ts            # ÚNICO punto de entrada: parsear -> rango -> alcance -> valor opaco
  identidad.ts           # D5/R38-R39: política de identidad + seudonimización del mensajero
  auditoria.ts           # D10/R40: constructor PURO del registro de denegado (no loguea)
```

Los dos últimos nacen de la puerta F1.4. `identidad.ts` y `auditoria.ts` son **puros**: uno
transforma ids en etiquetas, el otro **construye** un registro; **ninguno escribe** en ningún canal
(R31/R34). Quien emite es el borde de 126/127/134.

Se queda **dentro de `lib/analytics/`** y no en un módulo aparte: las 13 features consumidoras ya
importan de ahí, y una segunda puerta (`lib/analytics-alcance/`) haría que «de dónde saco el
recorte» tuviera dos respuestas — el primer paso para que alguien elija la que no recorta. La
contrapartida es que hereda el guardia de pureza de la 135, que es exactamente lo que queremos.

Tres archivos y no uno, por la misma razón que la 135 (`design.md §2`): `alcance-columnas.ts` es el
único que necesita `import type { Prisma }` y el único que nombra columnas, así que un guardia
puede razonar por archivo («¿quién nombra `zonaId`?» tiene una sola respuesta).

## 3. Contrato

### 3.1 Entrada: el actor, en forma estructural

```ts
/** Forma MÍNIMA que el resolutor necesita. NO importa `Actor` (capa `services`, prohibida). */
export interface ActorAnalitica {
  readonly usuarioId: string;
  readonly rol: string;              // se valida contra RolValue/ROLES_ANALITICA, no se confía
  readonly zonaId?: string | null;   // nullable de verdad (db/schema.prisma:98)
}
```

`rol` se tipa `string` y **no** `RolValue` a propósito: si se tipara con el enum, TypeScript daría
por imposible el caso «rol desconocido» y R12 no tendría rama que probar. La sesión viene de la DB
y de una cookie; en la frontera de seguridad se **valida**, no se asume. Un test de tipos afirma
que `Actor` (`IOrdenService.ts:13-24`) es asignable a `ActorAnalitica`, de modo que un cambio de
forma en el actor del repo rompe aquí.

### 3.2 Salida: estructura neutral, no `where` de Prisma

```ts
export type AlcanceDatos =
  | { readonly tipo: "global" }
  | { readonly tipo: "zona";      readonly zonaId: string }
  | { readonly tipo: "tienda";    readonly tiendaId: string }
  | { readonly tipo: "mensajero"; readonly mensajeroId: string };

export type MotivoDenegacion =
  | "sin_sesion" | "rol_desconocido" | "rol_sin_analitica"
  | "sin_zona_asignada" | "metrica_desconocida" | "metrica_prohibida"
  | "filtro_fuera_de_alcance";

export type ResolucionAlcance =
  | { readonly estado: "ok";       readonly alcance: AlcanceDatos }
  | { readonly estado: "denegado"; readonly motivo: MotivoDenegacion };

export function resolverAlcance(
  actor: ActorAnalitica | null | undefined,
  metricaId: string,
): ResolucionAlcance;
```

`resolverAlcance` es **total**: no lanza y no tiene rama `default` permisiva. El orden de las
guardas es el de R10→R14 y termina en un `switch` exhaustivo sobre los cinco roles de analítica
cuyo caso imposible se cierra con `never`.

### 3.3 Adaptadores (`alcance-columnas.ts`)

```ts
import type { Prisma } from "@prisma/client";   // SOLO tipo: permitido por el guardia (:138-147)

export function whereOrden(a: AlcanceDatos): Prisma.OrdenWhereInput;
export function whereGestionOrden(a: AlcanceDatos): Prisma.GestionOrdenWhereInput;
export function whereRollup(a: AlcanceDatos): Record<string, string>;  // hasta que exista la 123
```

- `global` ⇒ `{}` (fragmento vacío), y **eso solo se produce cuando la métrica declara `total`**.
- `zona` ⇒ `{ zonaId }` en `orden`; **`{ orden: { zonaId } }`** en `gestion_orden` (R24).
- `tienda` ⇒ `{ tiendaId }` / `{ orden: { tiendaId } }`.
- `mensajero` ⇒ **`{ mensajeroAsignadoId }`** en `orden` y **`{ orden: { mensajeroAsignadoId } }`**
  en `gestion_orden` (D3, R7/R24). `gestion_orden.mensajeroId` **no aparece** en ningún fragmento,
  aunque esté a mano y sea NOT NULL: es el error que el guardia de columnas vigila. Nótese que el
  recorte de gestiones pasa por la relación **aunque la tabla tenga columna propia de mensajero** —
  esa asimetría es intencional y es exactamente lo que D3 compró.
- `whereRollup` devuelve un objeto plano porque `analytics_daily` **no existe todavía** (la crea la
  123): tipar contra un modelo inexistente no compilaría. Cuando la 123 aterrice, su tarea es
  cambiar la firma a `Prisma.AnalyticsDailyWhereInput`; queda escrito aquí como aviso dirigido (§7).
- **No hay** `whereWalletMovimiento`, `whereCierreDia` ni ningún adaptador de dinero: por el hecho
  de inventario 5, el dinero es `total` o `prohibido` (R25).

`import type { Prisma }` es la única concesión al cliente generado, y el guardia de la 135 la
autoriza explícitamente (`modulo-puro.guardia.test.ts:37-43`, `:138-147`): desaparece en
compilación, no exige `DATABASE_URL` y a cambio **el nombre de cada columna lo verifica el
compilador**. Escribir `zona_id` en vez de `zonaId` deja de ser un recorte silenciosamente vacío
para ser un error de build.

### 3.4 El único punto de entrada (`consulta.ts`) — aquí vive la garantía

```ts
declare const marca: unique symbol;          // NO se exporta

export interface ConsultaAnalitica {
  readonly [marca]: true;                    // nadie fuera del módulo puede escribirlo
  readonly metrica: Metrica;
  readonly filtro: AnaliticaFiltroInput;     // ya parseado (135)
  readonly rango: RangoResuelto;             // ya resuelto (135)
  readonly alcance: AlcanceDatos;            // nunca "denegado": si lo fuera, no hay objeto
}

export type PreparacionAnalitica =
  | { status: "ok";               consulta: ConsultaAnalitica }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "forbidden";        motivo: MotivoDenegacion };

export function prepararConsultaAnalitica(
  raw: unknown,
  actor: ActorAnalitica | null,
  metricaId: string,
  now?: Date,
): PreparacionAnalitica;
```

Cómo esto hace que **olvidarlo sea imposible**, en cuatro piezas que se sostienen entre sí:

1. **El orden no se puede invertir** porque no hay dos llamadas que ordenar: hay **una**.
   `prepararConsultaAnalitica` parsea (R19: si falla, devuelve `validation_error` y **no** llega a
   preguntar por el alcance), resuelve el rango y resuelve el alcance, en ese orden, dentro de una
   sola función. R15 lo prueba con espías sobre las tres llamadas.
2. **El recorte no se puede omitir** porque el único valor que sale de ahí ya lo lleva dentro. No
   existe una función pública que devuelva «filtro parseado sin alcance».
3. **El valor no se puede falsificar**: `ConsultaAnalitica` lleva una propiedad cuyo nombre es un
   `unique symbol` no exportado. **CORRECCION (2026-08-01, verificada dos veces: implementer y reviewer con una sonda real).** La redaccion original de este parrafo era FALSA: decia que `{ metrica, filtro, rango, alcance } as ConsultaAnalitica` desde `lib/repositories/` no compila, y **si compila** — una asercion `as` solo exige comparabilidad en *alguna* direccion. Lo que NO compila es la **asignacion** de un literal (`const c: ConsultaAnalitica = {...}`), que es lo que R16 pide textualmente, y asi esta probado con `@ts-expect-error`. La garantia OPERATIVA (R17: omitir el recorte es error de compilacion, no omision silenciosa) se cumple. El hueco que queda es el **forjador deliberado**, no el olvido: quien escriba `as unknown as ConsultaAnalitica` tiene que teclear `alcance: {tipo:"global"}` a mano. Cerrarlo del todo exigiria cambiar el tipo opaco por una clase con campo privado: decision de diseno nueva, NO tomada aqui. **Deber heredado para la 126**: el guardia de R18 hoy solo hace grep de la palabra `ConsultaAnalitica` y NO atrapa al forjador; debe censar tambien `as ConsultaAnalitica` / `as unknown as ConsultaAnalitica`.
4. **El tipo se propaga hacia abajo**: las firmas de 126/127 reciben `ConsultaAnalitica`, no
   `AnaliticaFiltroInput`. Un repositorio que «se olvide» del recorte no tiene de dónde sacar el
   filtro: **falla el build**, no los datos (R17).

La quinta pieza, para lo que los tipos no alcanzan (SQL crudo, `$queryRaw`, un servicio que
reconstruya el filtro a mano): el **guardia estructural** de R18, siguiendo el único patrón que
sigue vivo en el repo, `modulo-puro.guardia.test.ts` (`frontera.guardia.test.ts` fue retirado por el
PR #232 y no se resucita, ver §8) — censo por fichero, con
**autocomprobación** por fixtures para que no quede verde por vacío mientras 126/127 no existan
(exactamente la trampa que `modulo-puro.guardia.test.ts:436-448` ya se pone a sí mismo).

### 3.5 Precedencia sobre el filtro del cliente

El filtro de la 135 admite `zona_id`, `tienda_id` y `mensajero_id` como listas no vacías
(`lib/analytics/filters.ts:77-79`). Regla: el alcance **interseca**, nunca amplía (R20). El
resultado de la intersección se escribe en `ConsultaAnalitica.filtro`, de modo que el consumidor
recibe el filtro **ya recortado** y el `where` del alcance como cinturón y tirantes: aunque un
servicio ignorara `alcance`, el filtro que lleva dentro ya está intersecado. Si la intersección
queda vacía ⇒ `forbidden/filtro_fuera_de_alcance` (D1), que el borde traduce a 403 (R41) y audita
(R40).

### 3.6 Identidad del mensajero para el `adminTienda` (D5 · `identidad.ts`)

D5 autoriza el grano `mensajero` al `adminTienda` **sin identidad**. El contrato:

```ts
export type PoliticaIdentidad = "real" | "seudonima";

/** Deriva la política del rol. Puro, total, sin rama permisiva por defecto. */
export function politicaIdentidadMensajero(rol: RolAnalitica): PoliticaIdentidad;

/**
 * Sustituye ids reales por etiquetas ordinales ESTABLES dentro de la respuesta.
 * Devuelve solo la proyección: el mapa inverso NO se devuelve ni se guarda.
 */
export function seudonimizarMensajeros<T extends { mensajeroId: string }>(
  filas: readonly T[],
  politica: PoliticaIdentidad,
): readonly (Omit<T, "mensajeroId"> & { mensajero: string })[];
```

Tabla de política (R38). `adminTienda` ⇒ `seudonima`. `maestro`/`admin` ⇒ `real` (acceso total).
`mensajero` ⇒ `real`, porque el único mensajero que alcanza es **él mismo**. `adminSatelite` ⇒
`real`: **derivación**, no decisión preguntada — la razón que dio el humano para el `adminTienda`
(«no es empleador de esos mensajeros») no aplica al `adminSatelite`, que sí opera a los mensajeros de
su zona. Queda señalado en `requirements.md > Preguntas abiertas` para confirmación.

**Asignación del ordinal.** El ordinal se asigna por **orden de primera aparición** en el conjunto
de filas ya ordenado por el criterio propio de la métrica. Es determinista para una misma entrada
(R32) y no requiere ninguna semilla ni `Date.now()`. **No** se deriva del `uuid` (ni hash, ni
prefijo, ni truncado): un hash es un identificador estable **entre** consultas y permitiría
correlacionar y, con suficientes consultas, desanonimizar por intersección. La estabilidad se promete
**dentro de la respuesta**, y solo ahí; el precio asumido es que las etiquetas pueden bailar entre
dos consultas distintas, y eso hay que decírselo a la 130/133 en la leyenda del gráfico.

**Dónde se aplica y por qué NO puede aplicarse en el cliente.** La sustitución ocurre en el
**servidor**, en la proyección del resultado, **antes de serializar** — es decir, dentro de 126
(repositorio/servicio) llamando a este módulo, nunca en el componente. Motivo, no estilístico: en
Next App Router lo que un Server Component «no pinta» **igualmente viaja**; el payload RSC y la
respuesta de cualquier Server Action son inspeccionables en la pestaña Network y en el HTML
serializado. Un `mensajeroId` real que llegue al navegador ya está filtrado aunque ningún píxel lo
muestre. Ocultar en el cliente es maquillaje; por eso R39 se prueba **sobre la cadena serializada
completa** y no sobre los campos que la UI usa.

**Interacción con el recorte de filas.** La seudonimización **no sustituye** al recorte: el
`adminTienda` solo alcanza sus propias órdenes (R26), y **encima** no ve quién las llevó. Si alguien
elimina el recorte creyendo que «total, va anonimizado», el fallo es de tenant, no de privacidad: son
dos capas independientes y los tests van por separado.

### 3.7 Auditoría del denegado (D10 · `auditoria.ts` + borde)

El módulo puro **no loguea** (R31/R34). Lo que aporta es el **registro construido**, para que el
borde no lo redacte a mano y no meta PII por descuido:

```ts
export interface RegistroDenegado {
  readonly evento: "analitica_denegado";
  readonly motivo: MotivoDenegacion;
  readonly rol: string;
  readonly usuarioId: string;          // el del propio actor
  readonly metricaId: string;
  readonly alcancePedido?: { readonly zonaId?: string; readonly tiendaId?: string };
  readonly filtroRechazado?: Record<string, readonly string[]>;  // ids que envió el actor
}

export function describirDenegado(...): RegistroDenegado;   // puro: construye, no emite
```

El borde hace **una llamada explícita** `logger.logError(describirDenegado(...))` con el
`ErrorLogger` de `lib/errors/logger.ts:6-8` (el canal de crons y webhooks, hecho de inventario 9) y
**después** responde 403.

> **No delegar en `withErrorHandler`.** `normalizeError` devuelve la shape del `AppError` en su
> primera línea (`lib/errors/normalize.ts:22`) y solo llama a `logger.logError` en la rama del error
> desconocido (`:45`). Lanzar `ForbiddenError` y confiar en el wrapper produce un 403 **mudo**. El
> test de R40 espía el logger, no el status.

Por qué no se toca `normalizeError` para que registre también los `AppError`: cambiaría el
comportamiento de **todos** los bordes del repo (cada 404 y cada validación pasaría a escribir en
consola), y eso es una decisión de otra ficha, no un daño colateral de la 122.

Sobre R34: el registro contiene el rol y el `usuarioId` **del propio actor** y los ids **que el
propio actor envió**. No hay dato ajeno —ningún nombre, teléfono, correo ni contenido de sesión— y
por tanto no contradice la prohibición de PII: se registra quién llamó y qué pidió, no a quién
pertenecía lo pedido.

### 3.8 Guardia de pureza transitivo (D8)

Se **amplía** `tests/unit/analytics/modulo-puro.guardia.test.ts` —el de la 135, autorizado por D8—
y **no** se crea uno nuevo: dos guardias de pureza es la forma más rápida de que uno se quede atrás
y de que nadie sepa cuál manda.

Qué cambia, en concreto:

1. `violacionesDeImports` (`:120-151`) deja de leer un archivo suelto y pasa a recorrer una
   **clausura**: partiendo de los `.ts` de `lib/analytics/`, se resuelven los especificadores
   locales (`@/…` y relativos) y se repite hasta punto fijo, con conjunto de visitados (los ciclos
   no cuelgan). Los paquetes de `node_modules` no se recorren: se juzgan por su especificador, que
   es justo lo que hoy ya hace la regla de `@prisma/client`.
2. Las reglas existentes (capas prohibidas, módulos de petición, `@prisma/client` solo como tipo)
   se aplican **a cada arista de la clausura**, no solo a las de primer nivel.
3. Se añade la **allowlist nominal de aristas** (R36), que es el corazón de la convivencia con
   `acceso-total.ts`:

```ts
const ARISTAS_PERMITIDAS = [
  {
    desde: "lib/auth/acceso-total.ts",
    especificador: "@prisma/client",
    nombres: ["RolValue"],          // exactamente estos; PrismaClient => rojo
    motivo:
      "D7 de la 135 obliga a reutilizar esAccesoTotal(); RolValue es un enum generado, " +
      "objeto congelado sin efectos ni conexion. La prueba real es el import sin DATABASE_URL.",
  },
] as const;   // R36: length === 1
```

**Por qué no es un agujero**, en tres candados que hay que romper a la vez para que lo sea:

- Es una excepción de **arista y nombre**, no de archivo ni de paquete: `acceso-total.ts` puede
  importar `RolValue` y nada más. Un `import { PrismaClient }` en ese mismo archivo la rompe.
- Es **finita y vigilada**: la lista tiene una entrada y el guardia afirma su longitud. Crecerla es
  un diff visible en un archivo llamado «guardia de pureza», no un `import` cualquiera.
- La lista **no sustituye a la prueba empírica**: la clausura completa se importa en un proceso sin
  `DATABASE_URL`. Si algún día el cliente generado adquiere efectos al importarse, la allowlist
  seguirá diciendo «permitido» y el import **fallará igual**, que es el orden correcto de
  prioridades. La lista solo evita un falso rojo estático; la verdad la dice la ejecución.

Alternativa descartada aquí: **cambiar `acceso-total.ts`** para importar `RolValue` como tipo y
declarar los dos roles como literales (la opción (c) que el humano no eligió). Habría eliminado la
arista, pero a cambio crea una **segunda lista de roles literal** fuera del esquema —exactamente el
bug que D7 quiere evitar— y toca un archivo de `lib/auth/` usado por medio repo desde una feature de
analítica. Se descarta por eso, no por pereza.

## 4. Rutas, endpoints y contratos de I/O

**Ninguno.** Esta feature no expone ruta, Server Action ni route handler: es contrato consumido por
126 (operativa), 127 (financiera) y 134 (CSV). El borde de esas features obtiene el actor con
`resolveActorFromSession()` (`lib/auth/resolve-actor.ts:15-34`) y llama a
`prepararConsultaAnalitica`. R30 prohíbe leer la cookie por otro camino.

**Contrato que la puerta F1.4 impone a esos bordes** (los tres pasos, en este orden):

1. `status: "forbidden"` ⇒ **auditar** con una llamada explícita al `ErrorLogger` (§3.7, R40).
2. ⇒ responder **403** / estado equivalente de Server Action; nunca 200 con lista vacía (R41).
3. `status: "ok"` con política de identidad `seudonima` ⇒ **seudonimizar antes de serializar**
   (§3.6, R38/R39).

`validation_error` sigue siendo 400 y **no** se audita: una entrada malformada no es un intento de
acceso cruzado, y auditarla convertiría el canal en ruido (R19 ya impide que revele nada).

Relación con el gating de ruta de la **129**: son capas distintas y ambas deben existir. La 129
decide **quién entra** a `/analitica` con `ROLES_ANALITICA` y dice explícitamente que **no** usa
`esAccesoTotal` (`specs/129-analitica-ruta-shell-sidebar/design.md:64-67`); la 122 decide **qué
filas** ve el que ya entró, y ahí sí `esAccesoTotal` es el criterio (D7). No es contradicción: son
dos preguntas distintas que hoy dan respuestas parecidas.

## 5. Integraciones

Ninguna externa. Dependencias internas, todas ya existentes:
`lib/analytics/{types,metrics,ranges,filters}.ts` (135) y `lib/auth/acceso-total.ts:7-9`.

## 6. Alternativas descartadas

1. **Devolver un `Prisma.OrdenWhereInput` como salida del resolutor.** Es lo que hace el precedente
   más cercano del repo, `predicadoVisibilidad` de la 146
   (`lib/repositories/NotificacionRepository.ts:19-40`), y funciona ahí porque hay **una** tabla.
   Aquí hay cinco familias (`orden`, `gestion_orden`, `analytics_daily`, ledgers, cierres) con
   nombres de columna distintos y una de ellas **todavía no existe**. Un `where` tipado a un modelo
   obligaría a resolver el alcance **una vez por tabla**, o sea a repetir la decisión de seguridad
   en cada sitio. Se conserva el patrón (`where` de Prisma) pero **detrás** del resolutor, en
   adaptadores tontos y sin decisiones (§3.3).

2. **Devolver un predicado `(fila) => boolean`.** Componible y trivial de testear, pero ilegal en
   la práctica: obliga a traer las filas a memoria antes de filtrarlas. En una tabla de órdenes de
   producción eso es o un `findMany` sin `where` (fuga si alguien serializa antes de filtrar) o un
   escaneo completo por request. Además, un `GROUP BY` agregado en Postgres no puede filtrarse
   después: la agregación ya mezcló tenants. Descartada por seguridad y por rendimiento, no por
   estilo.

3. **Aplicar el recorte en el repositorio** (cada `*AnaliticaRepository` llama al resolutor). Es lo
   más cercano a la arquitectura del repo, pero deja la garantía en manos de **cada** autor de
   repositorio: la 126 y la 127 tienen ~10 métodos entre ambas y basta que uno se olvide. Y el
   repositorio no debería decidir permisos (`docs/architecture.md:61`). Descartada: convierte la
   frontera en disciplina.

4. **Aplicar el recorte en un decorador/proxy sobre el repositorio.** Elegante y centralizado, pero
   la garantía se pierde en el **cableado**: instanciar el repo sin envolver compila y funciona, y
   el fallo es invisible (devuelve *más* datos, nunca menos, así que ningún test funcional lo nota).
   Descartada por el mismo motivo que la 3, agravado: el olvido no deja rastro.

5. **La elegida: el recorte viaja en el tipo (`ConsultaAnalitica` opaco) + guardia estructural.**
   El servicio no puede llamar al repositorio sin haber pasado por el resolutor porque **no tiene el
   valor que la firma pide**. El coste asumido es la ergonomía: 126/127 no pueden testear un
   repositorio con un filtro literal, tienen que construir la consulta por el punto de entrada
   (que es precisamente lo que queremos que practiquen). Se mitiga exportando un helper **de test**
   (`tests/`), nunca de producción.

6. **Que el resolutor lea la sesión por su cuenta** (`cookies()` dentro del módulo). Descartada por
   dos motivos: rompería la pureza que la 135 protege con guardia
   (`modulo-puro.guardia.test.ts:224-231`) y ataría la analítica al runtime de request, impidiendo
   que el job de la 124 o el backfill de la 125 reutilicen nada. El actor entra **por parámetro**.

7. **Duplicar la regla `maestro|admin` dentro del módulo** en vez de llamar a `esAccesoTotal`.
   Descartada por D7 (explícito: la 135 **no** duplica ese criterio) y porque una segunda lista de
   roles totales es exactamente el bug que produce que un rol nuevo se conceda en un sitio y se
   niegue en otro. El coste asumido es la dependencia transitiva a `@prisma/client` del punto 8 de
   §1, que se paga ampliando el guardia de pureza a la clausura transitiva (D8, §3.8) y no
   ignorándola.

8. **Reimplementar las reglas por rol en el resolutor** (un `switch` que decida qué ve cada rol de
   cada métrica). Descartada: `ALCANCE_OPERATIVA`/`ALCANCE_FINANCIERA`
   (`lib/analytics/metrics.ts:50-69`) ya son la fuente única, con `Record` exhaustiva sobre los
   cinco roles verificada por la 135 (R7). Una segunda lista significaría que añadir una métrica
   exige acordarse de dos sitios; el resolutor **lee** `metrica.alcance[rol]` y no opina.

9. **Un flag booleano `aplicarAlcance` en las firmas de 126/127.** Descartada de plano: un
   parámetro que se puede poner en `false` es una puerta trasera con nombre amable, y el valor por
   defecto acabaría siendo el conveniente para el test que estorbe.

10. **Meter el alcance como RLS de Postgres** (políticas por `zona_id`/`tienda_id`). Es la defensa
    en profundidad ideal, pero incompatible con cómo este repo habla con la base: Prisma se conecta
    con credenciales de servicio y las tablas sensibles llevan «RLS habilitada **sin policies**»
    (patrón declarado en `db/schema.prisma:537-542` para `carga`, y en la ficha de la 123 para
    `analytics_daily`). Añadir policies exigiría propagar la identidad del usuario a la conexión —
    un cambio de infraestructura que desborda esta feature. Queda anotado como **deuda de defensa
    en profundidad**, no como alternativa viable ahora.

## 7. Avisos dirigidos a las features consumidoras

- **→ 123 (`analytics_daily`).** El grano debe incluir columnas para las tres dimensiones de
  recorte (zona, tienda, mensajero) o el rollup no será consultable por `adminSatelite`,
  `adminTienda` ni `mensajero`: quedarían obligados a leer tablas vivas. Al aterrizar, cambiar
  `whereRollup` a `Prisma.AnalyticsDailyWhereInput` (§3.3) y añadir su test.
- **→ 126 (operativa) y 127 (financiera).** Sus repositorios reciben `ConsultaAnalitica`, nunca
  `AnaliticaFiltroInput`. Si una firma necesita el filtro suelto, es señal de que el recorte se
  está perdiendo: el guardia de R18 lo marcará.
- **→ 127.** No hay adaptador de alcance para ledgers ni cierres, y no es un olvido (R25): sus ocho
  métricas son `total` o `prohibido`. Si alguna vez una financiera pasa a `acotado`, el guardia se
  pone rojo y hay que diseñar el recorte del dinero **antes** de tocar la métrica.
- **→ 133 (recortes por rol).** El recorte de **presentación** consulta `listarMetricas({ rol })`;
  el de **datos** es este. Un panel que no se pinta no es un dato que no se filtra: no sustituyas
  uno por el otro.
- **→ 134 (CSV).** El export es el consumidor más peligroso (una fila filtrada se descarga en un
  archivo). Debe construir su dataset por el mismo punto de entrada, no reconstruir el filtro. Y
  **el CSV de un `adminTienda` con grano `mensajero` va seudonimizado** (D5/R39): una columna
  `mensajero_id` en un archivo descargable es la fuga más difícil de retirar.
- **→ 126 y 130/133 (presentación).** La leyenda del grano `mensajero` para un `adminTienda` dice
  `Mensajero 1..N`; esas etiquetas **no son estables entre consultas** (§3.6) y la UI no debe
  prometer que lo sean (nada de «guardar el filtro por Mensajero 3»).
- **→ 126/127/134 (bordes).** Los tres pasos del §4 (auditar → 403 → seudonimizar) no son
  recomendación: R40, R41 y R39 los exigen y sus guardias los censan.

## 8. Riesgos

- **Los guardias nacen vacíos.** 126 y 127 no existen, así que el censo de R18 no tiene a quién
  vigilar el día del merge. Mitigación: autocomprobación con fixtures sintéticos (patrón
  `modulo-puro.guardia.test.ts:376-448`), obligatoria en T4.2. Sin ella, el guardia sería un verde
  gratuito durante semanas.
- **D3 afecta a las cifras, no solo al recorte (riesgo aceptado).** Con
  `orden.mensajero_asignado_id`, un mensajero **deja de ver** las gestiones que él mismo ejecutó
  sobre órdenes que luego le reasignaron: sus cinco métricas de gestión no cuadran con su trabajo
  real cuando hay reasignaciones. No es un bug que corregir en implementación: es D3, está en R28 y
  tiene test nombrado. Si el negocio se queja de esto, la respuesta es **volver a la puerta**, no
  parchear el adaptador.
- **La seudonimización es una capa nueva que otro tiene que aplicar (D5).** La 122 la **declara**;
  quien la aplica es 126 (payload) y 134 (CSV). El riesgo real es que llegue un `mensajeroId` al
  cliente por un camino que nadie pensó (un tooltip, un `key` de React, un campo de depuración). Por
  eso R39 se prueba sobre la **cadena serializada completa** y no sobre campos concretos, y por eso
  el guardia de R39 se autocomprueba con fixtures aunque 126/134 no existan todavía.
- **La auditoría puede nacer muda (D10).** El canal existe y funciona, pero el 403 lo emite un borde
  que hoy no está escrito. Si 126 se limita a `throw new ForbiddenError()`, el registro **no ocurre**
  (§3.7). Mitigación: el test de R40 espía el logger, y el guardia se autocomprueba con un fixture
  de borde que delega en `withErrorHandler` (debe salir rojo).
- **Dependencia transitiva a `@prisma/client`** vía `esAccesoTotal` (§1 punto 8). Cubierta por D8:
  el guardia pasa a mirar la clausura y la arista queda en una allowlist de una entrada (§3.8). El
  riesgo residual es que alguien **añada** entradas a esa lista para «arreglar» un rojo en vez de
  quitar el import; por eso el guardia afirma `length === 1`.
- **La defensa es única.** Sin RLS (alternativa 10), esta capa es la **única** que separa tenants en
  analítica. Un bug aquí no tiene red debajo. Es la razón de que R22 exija matriz exhaustiva y no
  casos de ejemplo.
- **La frontera de rama se queda sin guardia ejecutable (hueco real, declarado).** El chore de
  saneamiento retiró `tests/unit/analytics/frontera.guardia.test.ts` (PR #232, 2026-07-31) porque
  medía el diff de la rama actual y uno de sus casos prohibía crear páginas. Lo que ese archivo
  cubría se reparte así: la parte **permanente** (todo `lib/analytics/**` es puro y ningún módulo
  nuevo escapa al censo) la absorbe R35 sin cambios —`modulo-puro.guardia.test.ts` lee el
  directorio, no una lista fija (`:199-207`), así que `alcance.ts`, `identidad.ts` y `auditoria.ts`
  quedan vigilados el día que existan—; la parte **de rama** (que este diff no cree migraciones,
  páginas ni componentes) **no la absorbe nadie** y no se inventa un requisito nuevo para taparla:
  un guardia que mide el diff caduca en el siguiente merge y da verdes vacíos, que es exactamente
  por lo que lo retiraron. R33 lo dice explícito y T5.5 pasa a ser una comprobación de cierre con
  comando y salida pegada, no un test.

## 9. Verificación

Solo tests unitarios en `tests/unit/analytics/**`: no hay DB, HTTP ni UI que ejercitar. Cuatro
familias: comportamiento (`alcance.test.ts`, `consulta.test.ts`, `alcance-adaptadores.test.ts`,
`alcance-granos.test.ts`, `identidad.test.ts`, `auditoria.test.ts`),
**matriz exhaustiva** 5 roles × 23 métricas × 4 formas de filtro (`alcance-matriz.test.ts`),
**guardias estructurales** (fuente única, columnas, alcance obligatorio, dinero, aislamiento,
pureza transitiva) y **tests de tipos** (`@ts-expect-error`) para R16/R17/R30. La frontera de rama
**no** es un guardia: es la comprobación de cierre de T5.5 (R33). Cierre con `./init.sh`.

> Nota de medición (actualizada 2026-07-31, tras sincronizar con `origin/dev`): **`dev` está
> verde** — `./init.sh` termina en `== init OK ==` con 665 archivos / 8052 tests, 0 rojos y 0
> errores de lint (PR #232). Se acabó la excusa heredada de la 135 («dev arrastra ~20 rojos de
> `ux`»): **la 122 nace sobre base limpia y su delta se mide contra cero**. Un solo rojo al cerrar
> es un rojo de la 122.
