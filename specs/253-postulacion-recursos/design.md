# Feature 253 — Diseño técnico

> Leer antes: `requirements.md` (R1-R44, P1-P5).
>
> **Todo lo que aquí se afirma del árbol se leyó el 2026-08-20**, con archivo y línea. Donde falta
> un número está declarado como **medición pendiente (§11)**, no rellenado.

---

## 0. El cambio, en una línea de causa y efecto

`handleSubmit` deja de hacer `setEnviado(true)` a ciegas y pasa a **llamar a una Server Action
pública** que escribe una fila en una **tabla nueva**; esa fila la lee un **panel en el dashboard
del maestro**, junto al de postulaciones de mensajero; y una **guardia** impide que la próxima
superficie de la landing vuelva a prometer sin producir.

---

## 1. Qué se REUSA y qué NO — dicho explícitamente

**La postulación de mensajero (feature 21) y el rastreo público (feature 229) ya resolvieron los
dos problemas duros de una escritura pública: cómo llega sin sesión y cómo se acota el abuso.** No
se inventa nada nuevo.

| Pieza | ¿Se reusa? | Cuál, y por qué |
| --- | --- | --- |
| **Transporte de la mutación** | **SÍ** | **Server Action**, no route handler. `docs/architecture.md`: mutación desde un componente propio → Server Action. Precedente vivo y **en la misma página**: `RastreoDialog.tsx:14` llama a `consultarRastreoPublico`, que se postea a `/`. |
| **Acceso sin sesión** | **SÍ, sin tocar nada** | `middleware.ts:56-59` deja pasar `/` por coincidencia **exacta**. La landing ya postea así. **Esta ficha NO toca `middleware.ts`** — y eso importa: tocarlo obliga a `./init.sh` completo (`docs/verification.md`). |
| **Ausencia de actor** | **SÍ** | La acción **no** llama a `resolveActorFromSession` y no lee cookies, igual que `rastreo-publico.ts:18-22` y `postulacion-mensajero.ts:21-24`. La ausencia se declara en el comentario para que nadie la lea como olvido. |
| **Límite de tasa** | **SÍ** | `ResetRateLimiter` (`lib/utils/reset-rate-limit.ts`), instancia a nivel de **módulo** para que la ventana sobreviva entre invocaciones. Molde: `postulacion-mensajero.ts:32`. |
| **Clave del límite** | **SÍ, la de la 21** | `ip|correo`, como `buildRateKey` de `postulacion-mensajero.ts:34-36`. **No** la de la 229 (sólo IP): allí la clave excluye la guía porque el atacante cambia de guía en cada intento; aquí el correo no es el objetivo del ataque, así que incluirlo no abre esa puerta y sí distingue a dos personas tras la misma IP corporativa. Ver **D4**. |
| **Lectura de la IP** | **SÍ** | `x-forwarded-for` → primer valor → `x-real-ip` → `"unknown"`, copiado literal de las dos anteriores. |
| **Validación de borde** | **SÍ (el patrón)** | zod, con el **mismo schema en cliente y servidor**, como `PostulacionForm.tsx:7` importa `postulacionSchema`. Aquí el schema sale a `lib/types/postulacion-recurso.ts` para que el modal y la acción lean el mismo. |
| **Capas** | **SÍ** | Controller (acción) → Service → Repository con interfaces, `docs/architecture.md`. |
| **Errores del borde admin** | **SÍ** | `withErrorHandler` + `isAppErrorShape` + `toActionError`, molde literal de `aprobacion-postulaciones.ts:42-49`. |
| **Panel: forma** | **SÍ** | SWR con fetcher que **lanza** si el status no es `ok` (`PostulacionesPendientesPanel.tsx:35-47`), `Modal` de confirmación, `Pagination`, `EmptyState`. |
| **Anti-carrera al atender** | **SÍ** | `UPDATE … WHERE id = ? AND atendida_at IS NULL` → `count`; si 0, reconsulta para distinguir `not_found` de `conflict`. Molde: `AprobacionPostulacionService.decidir` (`:68-85`). |
| **Tabla `usuario`** | **NO** | No hay cuenta que crear: sin login, sin contraseña, sin documentos, sin aprobación que conceda acceso. Ver §14-C. |
| **Tabla / panel de la 22-23** | **NO** | El sujeto es otro (un recurso, no una persona) y la forma también: aquel panel firma URLs de un bucket privado y transiciona `EstadoUsuario`. Ver §14-D. |
| **`EmailProvider`** | **NO** | `lib/services/EmailProvider.ts:10-16` es `StubEmailProvider`: su cuerpo entero es un `console.info`. Descartado por el humano (F2) y confirmado en el árbol. |
| **Campana de notificaciones (146)** | **NO en v1** | Costaría un valor de enum `NotificacionEvento` con su migración, y el panel vive **en la pantalla de aterrizaje** de `maestro`/`admin`. Ver **D6**. |
| **Subida de archivos / Storage** | **NO** | Esta postulación no lleva adjuntos. Y no es un olvido: es lo que la mantiene fuera del defecto de la ficha 252 (5 documentos contra un cuerpo de 5 MB). Ver **D8** si alguien pide fotos del vehículo. |

---

## 2. Modelo de datos

### 2.1 El enum y la tabla

```sql
CREATE TYPE "postulacion_recurso_tipo" AS ENUM ('vehiculo', 'bodega');

CREATE TABLE "postulacion_recurso" (
  "id"              TEXT NOT NULL,
  "tipo"            "postulacion_recurso_tipo" NOT NULL,
  "nombre"          TEXT NOT NULL,
  "telefono"        TEXT NOT NULL,
  "correo"          TEXT NOT NULL,
  "mensaje"         TEXT NOT NULL,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- NULL = pendiente. Es lo UNICO que muta en una fila, una vez y en un solo sentido.
  "atendida_at"     TIMESTAMP(3),
  "atendida_por_id" TEXT,

  CONSTRAINT "postulacion_recurso_pkey" PRIMARY KEY ("id"),
  -- RESTRICT y no CASCADE: quien atendio es EVIDENCIA de la operacion y no se pierde al dar
  -- de baja a un usuario. Mismo criterio que `orden_nota.autor_id`.
  CONSTRAINT "postulacion_recurso_atendida_por_id_fkey" FOREIGN KEY ("atendida_por_id")
    REFERENCES "usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- Las dos columnas de la atencion van juntas o no van: una fila atendida por nadie, o un
  -- responsable sin instante, serian estados que ningun productor puede escribir. Prisma no
  -- expresa CHECK (precedente: `notificacion_destinatario_xor`), asi que va a mano aqui.
  CONSTRAINT "postulacion_recurso_atendida_completa"
    CHECK (("atendida_at" IS NULL) = ("atendida_por_id" IS NULL))
);

-- La consulta del panel: `WHERE atendida_at IS NULL ORDER BY created_at DESC`. Un btree
-- compuesto la sirve entera (Postgres usa el indice para `IS NULL`), y sirve tambien la
-- pestana de atendidas (`IS NOT NULL`). No hay indice por `tipo`: el panel no filtra por el
-- y anadir un indice sin consulta que lo use es coste sin beneficio.
CREATE INDEX "postulacion_recurso_atendida_at_created_at_idx"
  ON "postulacion_recurso"("atendida_at", "created_at");

-- Segunda FK indexada (patron `orden_nota`): sin el, un RESTRICT obliga a recorrer la tabla
-- cada vez que se intenta borrar un usuario.
CREATE INDEX "postulacion_recurso_atendida_por_id_idx"
  ON "postulacion_recurso"("atendida_por_id");

-- R22: RLS habilitada SIN policies (solo service role), patron `orden_nota` /
-- `plantilla_mensaje`. La autorizacion de negocio (rol maestro/admin) vive en el service.
ALTER TABLE "postulacion_recurso" ENABLE ROW LEVEL SECURITY;
```

Carpeta: `db/migrations/<ts>_postulacion_recurso/`, con `<ts>` **posterior a `20260820190000`**
(la última del árbol al escribir esto) y verificado contra `origin/dev` en el momento de crearla —
`dev` se mueve.

### 2.2 El `down.sql` (R23)

```sql
-- DOWN — revierte EXACTAMENTE migration.sql.
-- `DROP TABLE` arrastra la PK, los dos indices, la FK a `usuario`, el CHECK y la RLS.
-- El `DROP TYPE` VA DESPUES y SI corresponde aqui, al reves que en el down de `orden_nota`:
-- alli `rol_value` era un enum PREEXISTENTE que la migracion reutilizaba; este lo CREA ella,
-- y no soltarlo dejaria un tipo huerfano que impediria volver a aplicar el up.
-- DESTRUCTIVO Y SIN VUELTA: se lleva las postulaciones escritas. Es correcto para un down
-- —devuelve la base al estado de SU momento— y por eso se dice aqui, en voz alta.
DROP TABLE IF EXISTS "postulacion_recurso";
DROP TYPE IF EXISTS "postulacion_recurso_tipo";
```

⚠️ **El down se ejecuta, no se escribe.** `pnpm run db:rollback` en local y **dos veces** el up para
probar idempotencia. Un `down.sql` que nadie corrió es papel (lección de la ficha 249).

### 2.3 Prisma

```prisma
enum PostulacionRecursoTipo {
  vehiculo
  bodega

  @@map("postulacion_recurso_tipo")
}

model PostulacionRecurso {
  id            String                 @id @default(uuid())
  tipo          PostulacionRecursoTipo
  nombre        String
  telefono      String
  correo        String
  mensaje       String
  createdAt     DateTime               @default(now()) @map("created_at")
  atendidaAt    DateTime?              @map("atendida_at")
  atendidaPorId String?                @map("atendida_por_id")

  atendidaPor Usuario? @relation("PostulacionRecursoAtendidaPor", fields: [atendidaPorId], references: [id], onDelete: Restrict)

  @@index([atendidaAt, createdAt])
  @@index([atendidaPorId])
  @@map("postulacion_recurso")
}
```

`Usuario` gana la relación inversa `postulacionesRecursoAtendidas PostulacionRecurso[] @relation("PostulacionRecursoAtendidaPor")`.
Sin ella Prisma no valida el esquema. El `CHECK` no se declara (Prisma no lo expresa) y por eso su
existencia la afirma el test estático de la migración.

---

## 3. Estados: por qué `atendida_at` y no un enum — **y el productor de cada uno**

> El encargo lo dice mejor que yo: *un estado sin productor es deuda*.

Hay **dos** situaciones en la vida de una postulación de recurso, y **exactamente dos productores**:

| Situación | Cómo se representa | **Quién la produce** |
| --- | --- | --- |
| **pendiente** | `atendida_at IS NULL` | la Server Action pública, al insertar la fila. |
| **atendida** | `atendida_at` + `atendida_por_id` puestos | el botón «Marcar como atendida» del panel, un administrador con nombre y hora. |

**No se declara ningún tercer estado.** Los candidatos evaluados y por qué no entran hoy:

- **`descartada` / spam.** No tiene productor todavía porque **no hay volumen medido de spam**: la
  tabla nace vacía. Añadirla ahora sería un valor de enum sin nadie que lo escriba, que es la deuda
  que la convención del repo prohíbe («un valor de enum nace en el commit de su productor», down.sql
  de la 235). Si el spam aparece, «atendida» ya sirve para quitarlo de en medio, y el día que haga
  falta distinguir *atendida* de *basura* será una columna nueva con su botón, no un rediseño.
- **`en_contacto` / `aprobada` / `rechazada`.** Describirían un proceso comercial que **no existe en
  el producto**: no hay ninguna pantalla, cobro ni permiso que dependa de que un vehículo esté
  «aprobado». Inventarlos aquí sería modelar una operación que nadie pidió.

**Y por qué un par de columnas en vez de un enum de dos valores:** un enum de dos valores obliga a
una segunda estructura para saber **quién** y **cuándo** —que es el dato que realmente sirve cuando
alguien pregunta «¿esto lo llamó alguien?»—, y crecer a un tercer valor cuesta una migración de
enum con su `down.sql` de recreación. `atendida_at` + `atendida_por_id` es el patrón que este repo
ya usa para una mutación **única y en un solo sentido** (`orden_nota.deleted_at`, con su comentario
puesto). Alternativa formal en §14-F.

---

## 4. El borde público — `lib/actions/postulacion-recurso.ts`

```ts
"use server";
// Feature 253 — Server Action PUBLICA de la postulacion de recurso.
// ⛔ NO resuelve actor ni comprueba rol, y es DELIBERADO: es publica, igual que
// `rastreo-publico.ts:18-22` y `postulacion-mensajero.ts:21-24`. NO lee ni escribe cookies
// y NO concede sesion (R4). Se postea a `/`, que el middleware deja pasar por coincidencia
// EXACTA (middleware.ts:56-59): esta feature no toca el middleware ni crea ruta.

const postulacionRecursoLimiter = new ResetRateLimiter(); // instancia de MODULO (R16)

export async function postularRecurso(
  entrada: unknown,
  deps: PostularRecursoDeps = {},
): Promise<PostularRecursoResult>;
```

**Orden de operaciones, y es parte del contrato (R18):**

1. **zod** sobre la entrada cruda → `validation_error` con `fieldErrors` (R14/R15). Nada tocado.
2. **IP** desde cabeceras.
3. **límite** → `rate_limited` **sin escribir** (R16).
4. **registrar el intento** — siempre, acierte o no lo que venga después (R18).
5. **servicio** → `ok` | `error`.

**Nunca lanza:** toda salida es un resultado discriminado, como `consultarRastreoPublico` (R32 de la
229). Un `throw` que cruce la Server Action deja la pantalla muda, que es el defecto de la 248 y de
`impl_240.md` §9.6 — y aquí, encima, sobre alguien que no es empleado y no va a reportar nada.

`deps` inyectables (`service`, `getContext`, `limiter`) para test, igual que las dos anteriores.

---

## 5. Servicio y repositorio

**`lib/services/PostulacionRecursoService.ts`** (`IPostulacionRecursoService`)

- `registrar(input): Promise<{ status: "ok" } | { status: "error" }>` — normaliza (R20), delega en
  el repositorio, envuelve el fallo. **No conoce HTTP ni Prisma.**
- `listar(input, actor)` y `atender(id, actor)` — autorizan por rol **antes** de tocar datos
  (R27/R28), molde `AprobacionPostulacionService:40,73`.

**`lib/repositories/PostulacionRecursoRepository.ts`** (`IPostulacionRecursoRepository`)

- `crear(row): Promise<{ id: string }>`
- `listar({ atendidas: boolean, skip, take }): Promise<{ items; total }>` — `orderBy createdAt desc`.
- `marcarAtendida(id, usuarioId): Promise<number>` — `updateMany` con
  `where: { id, atendidaAt: null }`, devuelve `count`. **Ésta es la anti-carrera** (R32).
- `findById(id)` — sólo para distinguir `not_found` de `conflict` cuando `count === 0`.

⚠️ **El `WHERE` se prueba donde vive.** Un test de servicio con dobles **no ve el SQL**: en este repo
se midió cuatro veces que una mutación del `WHERE` pasa en verde. `marcarAtendida` y `listar` llevan
test de repositorio **contra Postgres real** (R26/R32).

---

## 6. El borde del admin — `lib/actions/atencion-postulaciones-recurso.ts`

Dos Server Actions, molde literal de `aprobacion-postulaciones.ts`:

```ts
export async function listarPostulacionesRecurso(
  input: unknown, deps = {},
): Promise<ListarPostulacionesRecursoResult>;

export async function marcarPostulacionRecursoAtendida(
  id: unknown, deps = {},
): Promise<AtenderPostulacionRecursoResult>;
```

Cada una: `withErrorHandler` → `resolveActorFromSession` → `UnauthenticatedError` si no hay actor →
zod → servicio → `isAppErrorShape(r) ? toActionError(r) : r`.

**Nombre del módulo, dicho a propósito:** `atencion-postulaciones-recurso.ts` y no
`postulaciones-recurso.ts`, para que a un metro de distancia no se confunda con la acción **pública**
`postulacion-recurso.ts`. Dos módulos con nombres casi iguales y permisos opuestos es cómo se importa
el equivocado sin que el typecheck diga nada.

---

## 7. La pantalla del admin — dónde vive, y por qué al lado y no dentro

**Dónde:** `app/(app)/_components/PostulacionRecursoPanel.tsx`, montado por
`AdminMaestroDashboard.tsx` **debajo** de `PostulacionesPendientesPanel`, cada uno dentro de su
`ContenedorSeccion` con su título («Postulaciones de mensajeros» / «Vehículos y bodegas ofrecidos»).

**Ruta:** ninguna nueva. `/dashboard` ya es la home de `maestro` y `admin`
(`app/(app)/dashboard/page.tsx:34-36`, ítem «Inicio» de `menu-visibility.ts:169-179`), así que el
panel aparece **en la primera pantalla que ven al entrar**. Sin ítem de sidebar nuevo, sin
`notFound()` nuevo, sin `IconKey` nuevo.

**Al lado, NO dentro de `PostulacionesPendientesPanel`.** Componerlo dentro sería reutilizar un
componente que ya sabe demasiado de otra cosa: firma URLs de un bucket privado, tiene `EmptyState`
con copy de mensajeros, y su modal decide entre «Aprobar» y «Rechazar» un `EstadoUsuario`. Meter
aquí un tercer caso mezclaría dos dominios que sólo comparten la palabra «postulación». La regla del
repo es explícita (`docs/architecture.md`, «sin sobre-ingeniería»): sólo se promueve a compartido
cuando **dos** features lo necesitan **con la misma API**, y no es el caso.

**Lo que sí se comparte** es la **forma**: mismo fetcher SWR que lanza, misma `Pagination`, mismo
`Modal` de confirmación, mismo `EmptyState`. Se copia el patrón, no el componente.

**El texto que deja de ser cierto (R36):** `AdminMaestroDashboard` se describe hoy entero como
*«Postulaciones de mensajeros pendientes»* (`:26`). Con dos paneles, esa descripción miente en
pequeño. Se corrige en la misma tanda.

**Pestañas pendientes / atendidas (R33).** Un filtro de dos valores en el listado. Cuesta un
parámetro en la acción y un `where` en el repositorio, y es lo que impide que un clic equivocado
haga desaparecer una postulación para siempre — sin necesidad de un botón de «deshacer», que sería
una tercera operación con su propia autorización.

---

## 8. La pantalla pública — qué cambia en `PostularRecursoModal.tsx`

**Lo que NO cambia:** los campos, el copy por tipo, las clases del CTA, el `noValidate`, el portal
con `tema-claro`, el reset al cerrar. `LandingPostular.tsx` **no se toca** (R7).

**Lo que cambia, y sólo esto:**

1. La cabecera del archivo **deja de declararse maqueta** — si se queda, es literalmente falsa.
2. `formSchema` sale a `lib/types/postulacion-recurso.ts` y gana `tipo` + el tope del mensaje, para
   que **cliente y servidor validen el mismo objeto** (R14).
3. `handleSubmit` pasa a `useTransition` + `await postularRecurso({...})` con **`try/catch`**, y
   ramifica con un `switch` exhaustivo, molde de `PostulacionForm.tsx:274-296` — incluido su
   `try/catch`, que ese archivo tiene con la razón escrita: *«sin este try/catch la promesa
   rechazada se pierde dentro de la transición, la persona ve la pantalla rota y pierde todo lo que
   escribió»*.
4. Un mapa de textos **tipado** (R5):

```ts
const TEXTO_POR_FALLO: Record<Exclude<PostularRecursoResult["status"], "ok">, string> = { … };
```

   Añadir mañana un desenlace nuevo **rompe el typecheck** hasta que alguien le escriba su texto. Es
   el mecanismo que la 240 usó a propósito (`impl_240.md` §9.3) y la razón por la que allí el
   desenlace nuevo **no** se disfrazó de uno existente: un mensaje equivocado es peor que ninguno.
5. El botón muestra estado de envío y se deshabilita mientras `isPending` (R3).

---

## 9. La guardia de la landing (R37-R42)

### 9.1 Qué se declara, y **dónde**

El censo vive **en el árbol de tests**, no en `app/`:
`tests/fixtures/superficies-publicas.ts`.

```ts
export type SuperficiePublica = "rastreo" | "postularVehiculo" | "postularBodega";

export type ProductorSuperficie =
  | { readonly accionServidor: string; readonly modulo: string }
  | { readonly sinOperacion: string };   // motivo >= 20 caracteres, sin relleno

export const ARCHIVO_POR_SUPERFICIE: Record<SuperficiePublica, string> = {
  rastreo:           "app/_landing/RastreoDialog.tsx",
  postularVehiculo:  "app/_landing/PostularRecursoModal.tsx",
  postularBodega:    "app/_landing/PostularRecursoModal.tsx",
};

export const PRODUCTOR_POR_SUPERFICIE = {
  rastreo:          { accionServidor: "consultarRastreoPublico", modulo: "lib/actions/rastreo-publico" },
  postularVehiculo: { accionServidor: "postularRecurso",         modulo: "lib/actions/postulacion-recurso" },
  postularBodega:   { accionServidor: "postularRecurso",         modulo: "lib/actions/postulacion-recurso" },
} as const satisfies Record<SuperficiePublica, ProductorSuperficie>;
```

Dos superficies que comparten productor y archivo **no es un descuido**: son dos puertas a la misma
operación, con el `tipo` como dato del formulario. Precedente literal:
`reprogramarDesdeAyuda`/`rechazarDesdeAyuda` comparten `gestionarDesdeAyuda` en el catálogo de la
240.

**Por qué en `tests/` y no junto a la pantalla, al revés que la 240.** Allí el catálogo vive en
`app/` porque **producción lo consume**: `ACCIONES_POR_GRUPO` decide qué botones se pintan. Aquí
nadie lo consumiría: sería un módulo en `app/` que sólo lee un test, es decir, exactamente la clase
de módulo que `superficie-de-uso.guardia.test.ts` vigila —y habría que averiguar si lo denuncia y,
en su caso, anotarlo: una anotación de excepción para un archivo que existe sólo por otra guardia—.
El censo escrito en el árbol de tests no tiene ese problema y **conserva la advertencia que sí
importa**: se escribe **en un archivo**, nunca por `node -e`, donde `\b` llega como backspace y el
censo miente en verde.

**Lo que se pierde y hay que compensar:** sin consumo en producción no hay `satisfies` que rompa el
typecheck al aparecer una superficie nueva. **Lo compensa el frente 5**, que censa el árbol de
archivos — y para este caso es más fuerte, porque la landing no tiene una unión cerrada de botones
que alguien tenga que tocar.

### 9.2 La guardia — `tests/unit/guards/landing-sin-maqueta.guardia.test.ts`

Cinco frentes, más el bloque 0:

| # | Qué pone rojo | Cubre |
| --- | --- | --- |
| **0** | los **detectores** fallan contra fuente sintético, en las dos direcciones | R41 |
| **1** | un productor citado que no existe, no lleva `"use server"` o no exporta ese símbolo | R38/R39 |
| **2** | un productor que **ningún archivo de la landing importa Y invoca** | R39 |
| **3** | un `sinOperacion` vacío, de relleno o de menos de 20 caracteres | R38 |
| **4** | **censo inverso:** la landing dispara una Server Action que el censo no declara | R40 |
| **5** | **censo del árbol:** un archivo de `app/_landing/` con formulario de envío (`<form` / `onSubmit=`) al que **ninguna** entrada de `ARCHIVO_POR_SUPERFICIE` apunta — y su recíproco, un archivo citado que ya no existe | R40 |

**Los detectores se comparten, no se copian.** `aristasDeImport`, `importaElSimbolo`,
`invocaElSimbolo`, `fuenteDelModulo`, `exportaLaAccion`, `esModuloDeServidor` y `faltaDelMotivo` hoy
viven **exportados desde el archivo de test de la 240** (`novedad-acciones-sin-maqueta.guardia.test.ts:156-275`).
Se proponen mover a `tests/fixtures/deteccion-maqueta.ts` y que **las dos guardias los importen**,
cada una **conservando su propio bloque 0** de autocomprobación. Razón: la corrección del 2026-08-20
—«el import en pie sin la llamada no cuenta»— fue un arreglo **medido** de esos detectores; con dos
copias, la segunda no lo habría recibido nunca. Es un movimiento de código de test, sin cambio de
conducta, y las dos guardias tienen que quedar verdes en la misma tanda. Alternativa en §14-H, y la
decisión es **D7**.

**Autocomprobación obligatoria (R41)**, con estos fuentes sintéticos como mínimo:

- `CABLEADO` — importa e invoca → los dos detectores dicen `true`.
- `SOLO_EL_TIPO` y `TIPO_EN_LINEA` — `import type` no cablea.
- **`LA_MAQUETA_253`** — el caso **literal** de esta ficha: `handleSubmit` valida con zod y hace
  `setEnviado(true)`, sin importar nada de `lib/actions/`. Debe salir **no cableado**.
- `IMPORT_SIN_LLAMADA` — la quinta maqueta: el import en pie, la invocación borrada.
- **`FORM_SIN_CENSO`** — un componente con `<form onSubmit=…>` que el censo no nombra: el frente 5
  debe verlo.
- **Anti-vacuidad:** el censo del árbol encuentra al menos los archivos que hoy hay bajo
  `app/_landing/` y ninguno está vacío. Una guardia que no encuentra nada denuncia cero infracciones
  y su verde es indistinguible del bueno.

### 9.3 Un frente que se evaluó y **se descarta**

Detectar el **acuse** por vocabulario —buscar «enviada», «Recibimos tus datos», «gracias»— y exigir
que el archivo que lo pinta invoque una Server Action. Se descarta: la lista de palabras es
gameable (se cambia el texto y la guardia calla) y su rojo hablaría de **redacción** en vez de
**conducta**. Los frentes 2 y 5 atacan la conducta, que es lo que falla.

---

## 10. Contratos I/O

```ts
// lib/types/postulacion-recurso.ts
export const RECURSO_TIPOS = ["vehiculo", "bodega"] as const;
export type RecursoTipo = (typeof RECURSO_TIPOS)[number];

export const postulacionRecursoSchema = z.object({
  tipo:     z.enum(RECURSO_TIPOS),
  nombre:   z.string().trim().min(1, "Escribí tu nombre").max(NOMBRE_MAX),
  telefono: z.string().trim().min(7, "Escribí un teléfono de contacto").max(TELEFONO_MAX),
  correo:   z.string().trim().toLowerCase().email("Escribí un correo válido").max(CORREO_MAX),
  mensaje:  z.string().trim().min(1, "Contanos brevemente qué tenés").max(MENSAJE_MAX),
});

export type PostularRecursoResult =
  | { status: "ok" }
  | { status: "validation_error"; fieldErrors: Record<string, string[]> }
  | { status: "rate_limited" }
  | { status: "error" };

export interface PostulacionRecursoDTO {
  id: string;
  tipo: RecursoTipo;
  nombre: string;
  telefono: string;
  correo: string;
  mensaje: string;
  createdAt: string;            // ISO
  atendidaAt: string | null;    // ISO
  atendidaPor: string | null;   // nombre de quien atendió, no su id
}

export type ListarPostulacionesRecursoResult =
  | { status: "ok"; items: PostulacionRecursoDTO[]; page: number; pageSize: number; total: number }
  | ActionError;

export type AtenderPostulacionRecursoResult =
  | { status: "ok"; id: string; atendidaAt: string }
  | ActionError;   // incluye forbidden | not_found | conflict | unauthenticated
```

Los mensajes de error de validación son **los que el modal ya muestra hoy**
(`PostularRecursoModal.tsx:72-77`), palabra por palabra: son texto probado en producción y cambiarlos
sería un cambio de producto colado dentro de un arreglo.

`lib/config/postulacion-recurso.ts`, patrón `lib/config/postulacion.ts` (sobreescribible por entorno,
sin hardcode): `MENSAJE_MAX_CHARS`, `NOMBRE_MAX_CHARS`, `TELEFONO_MAX_CHARS`, `CORREO_MAX_CHARS`,
`RATE_MAX`, `RATE_WINDOW_MINUTES`, `PAGE_SIZE_DEFAULT`, `PAGE_SIZE_MAX`.

---

## 11. T0 — lo que hay que medir **antes** de firmar

Todo por **MCP de Supabase, sólo lectura**, contra producción, con su fecha y su denominador.

| # | Qué | Consulta | Para qué decide |
| --- | --- | --- | --- |
| **M1** | postulaciones de mensajero vivas, por estado | `SELECT u.estado, count(*) FROM usuario u JOIN rol r ON r.id = u.rol_id WHERE r.value = 'mensajero' GROUP BY u.estado;` | dimensiona el panel hermano: si son unidades, la paginación es formalidad y el orden por fecha basta (**D5**) |
| **M2** | volumen total de la base de usuarios y su última alta | `SELECT count(*) AS usuarios, max(created_at) AS ultima FROM usuario;` | denominador de M1. La ficha 252 midió **11 usuarios** el 2026-08-20; **re-verificar**, no citar |
| **M3** | avisos de postulación pendiente emitidos y en qué ventana | `SELECT count(*), min(created_at), max(created_at) FROM notificacion WHERE evento = 'postulacion_mensajero_pendiente';` | **decide D6**: si el aviso del hermano se emite y nadie lo lee, replicarlo aquí es ruido |
| **M4** | postulaciones de recurso perdidas | **NO ES MEDIBLE, y hay que escribirlo así.** No hay tabla, ni log, ni correo: cero rastro. Lo único conocido son las **dos** del humano (un vehículo, una bodega) | alimenta **P1**: la decisión no es técnica |
| **M5** | desde cuándo vive la maqueta | `git log --follow --format='%ad %h %s' -- app/_landing/PostularRecursoModal.tsx` | dimensiona **cuánta gente pudo pasar por ahí** y cierra **P4** |

> ⏳ **La foto caduca.** M1-M3 se mueven solos. Se miden antes de firmar y **no** se vuelven a citar
> de memoria al desplegar.

---

## 12. Riesgos aceptados — para firmar, no para descubrir después

1. **El limitador vive en memoria del proceso.** En serverless cada instancia tiene su contador y
   cada despliegue los reinicia: **acota al torpe, no al decidido**. Es el mismo riesgo que la 229
   firmó explícitamente (`rastreo-publico.ts:32-35`) y que la 21 lleva en producción. Un límite
   persistido es **ficha aparte** (exige tabla o Redis). No es un bug pendiente: es una cota
   conocida, y aquí el daño de saltársela es **filas basura en una tabla**, no fuga de datos.
2. **Sin captcha.** Ver **D5**. Lo que hoy protege es: límite por `ip|correo`, topes de longitud en
   todos los campos, y que la escritura **no dispara ningún efecto externo** (ni correo, ni webhook,
   ni cobro). Un bot no consigue nada salvo ensuciar el panel.
3. **La tabla guarda datos personales del público** (nombre, teléfono, correo, texto libre). RLS sin
   políticas y lectura sólo `maestro`/`admin`. **Sin política de retención**, porque no existe
   ninguna en el repo: es **P2**.
4. **No se guarda la IP del postulante.** Deliberado (paridad con la 21, que tampoco la guarda):
   guardarla añade un dato personal más a una tabla nueva a cambio de una capacidad de triaje que
   nadie ha pedido. Si el spam llega, se reevalúa **con datos**.

---

## 13. Decisiones — **FIRMADAS por el humano el 2026-08-21**

> ✅ **Puerta humana pasada.** Las diez quedan cerradas. **DOS se firmaron EN CONTRA de la
> recomendación** y ambas AMPLÍAN el alcance; están marcadas abajo y hay que tratarlas como
> trabajo de la ficha, no como extras:
>
> | # | Firmado | ¿Coincide con la recomendación? |
> | --- | --- | --- |
> | **D1, D2, D3, D4, D8, D9** | como estaba recomendado | sí |
> | **D5 · captcha** | **NO** — sólo `ResetRateLimiter` con clave `ip\|correo` | sí |
> | **D7 · detectores** | **EXTRAER** al fixture compartido; se toca el archivo de la 240 | sí |
> | **D10 · alcance de la guardia** | **SÍ** cubre también `app/postulacion/` | sí |
> | **D6 · aviso en la campana** | **SÍ, avisa** | 🔴 **NO** — se recomendaba «no en v1» |
> | **P2 · retención** | **borrar las atendidas a los 6 meses** | 🔴 **NO** — se recomendaba «sin borrado automático» |
>
> **Lo que las dos discrepancias añaden, y que el `tasks.md` tiene que recoger:**
>
> - **D6** trae un valor nuevo de `NotificacionEvento` con su **migración y su `down.sql` de
>   recreación** — el mismo patrón que ya mordió a esta pila con los enums. Ojo con la memoria del
>   repo: al añadir un valor hay que mirar si el `down.sql` de ESE enum recrea con lista o sólo
>   dropea, y correr `tests/integration/db`.
> - **P2** trae un **cron de purga nuevo** y su prueba. Y una advertencia que no estaba en la
>   pregunta: **borrar es irreversible y lo ejecuta un job desatendido**. La purga tiene que
>   apoyarse en `atendida_at`, nunca en `created_at` —una postulación sin atender no se borra jamás—
>   y su test debe demostrar que **una fila `pendiente` de hace dos años SOBREVIVE**. Un cron de
>   borrado sin ese caso es un incidente esperando.
>
> **P1 queda sin acción**, y es honesto decir por qué: las postulaciones perdidas **no dejaron
> fila, ni log, ni correo**, así que no son recuperables ni contables. La única persona que se sabe
> que postuló es el propio humano. No hay a quién avisar.

### La tabla original, con la firma al lado

| # | La pregunta | Recomendación | Por qué |
| --- | --- | --- | --- |
| **D1** | ¿El panel muestra las dos clases (vehículo y bodega) mezcladas con su etiqueta, o separadas en dos bloques? | **Mezcladas**, con la etiqueta del tipo bien visible en cada tarjeta | El volumen esperado es de unidades (M1/M2). Dos bloques duplican paginación y estado vacío para repartir tres filas. |
| **D2** | ¿`telefono` se endurece a **sólo dígitos** (como `numericIdentifierSchema` de la 21) o se queda como hoy (≥7 caracteres)? | **Se queda como hoy** | Es un teléfono de contacto que un humano va a marcar, no un identificador con el que se hace una búsqueda; hoy la landing acepta `+506 8888-8888` y rechazarlo sería un cambio de producto colado en un arreglo. Se recorta y se topa la longitud. |
| **D3** | Tope de `mensaje` | **1.000 caracteres** | Cabe de sobra la descripción que el placeholder pide («tipo, año, capacidad, ciudad, disponibilidad») y corta el texto pegado. Referencia interna: `orden_nota` topa en 200, pero eso es una nota de hilo, no una descripción. |
| **D4** | Clave del límite: `ip\|correo` (la 21) o sólo `ip` (la 229) | **`ip\|correo`** | La 229 excluye la guía porque el atacante la cambia en cada intento; aquí el correo no es el objetivo, así que incluirlo no estrena cubo por intento y sí evita que una IP compartida (oficina, café) bloquee a la segunda persona. Con `RATE_MAX = 3` en 60 min, los defaults de la 21. |
| **D5** | ¿Captcha / Turnstile en la landing? | **NO en esta ficha** | Es una dependencia externa nueva, con claves por entorno y riesgo de romper la landing entera si se configura mal en un solo entorno (memoria: variables en Production+Preview a la vez). El daño de no tenerlo es basura en un panel. **Se reevalúa con datos.** |
| **D6** | ¿Aviso en la campana (146) al llegar una postulación? | **NO en v1** | Cuesta un valor de enum `NotificacionEvento` con su migración y su `down.sql` de recreación, y **el panel ya vive en la pantalla de aterrizaje de `maestro`/`admin`**: lo ven al entrar. **M3 puede cambiar esta recomendación**: si el aviso del hermano se lee y se usa, replicarlo es barato. |
| **D7** | Detectores de la guardia: ¿extraer a `tests/fixtures/deteccion-maqueta.ts` (dos guardias, una implementación) o duplicarlos? | **Extraer** | La corrección medida del 2026-08-20 no habría llegado nunca a una copia. Implica **tocar el archivo de la 240**: movimiento mecánico, sin cambio de conducta, con las dos guardias verdes en la misma tanda. Ver §14-H. |
| **D8** | ¿Se permitirá adjuntar fotos del vehículo o la bodega? | **NO** | Meter subida de archivos aquí abre exactamente el defecto de la ficha 252 (peso del cuerpo de la Server Action) en la superficie **pública** y multiplica el alcance. Si se quiere, es ficha propia **después** de que la 252 arregle el transporte. |
| **D9** | El texto del acuse | **«Recibimos tu postulación. Queda registrada y nuestro equipo te contacta al teléfono o al correo que dejaste.»** | Dice lo que de verdad pasó (*queda registrada*) sin prometer plazo. El texto de hoy —«Recibimos tus datos»— pasa a ser cierto por primera vez; se cambia igualmente para que **el commit muestre que la frase se revisó**. |
| **D10** | ¿La guardia cubre también `app/postulacion/` (la otra pantalla pública)? | **Sí, en esta ficha** | Cuesta una raíz más en el censo y una entrada (`postulacionMensajero → postularMensajero`, ya cableada y verde desde el primer minuto), y deja **cerrada toda la superficie pública** en vez de la mitad. Si se firma, el fixture se llama `superficies-publicas.ts` (ya está así nombrado arriba) y la constante de raíces es `["app/_landing", "app/postulacion"]`. |

---

## 14. Alternativas descartadas

### A · Correo al equipo cuando llega una postulación *(la más rápida de escribir)*
Descartada por el humano (F2) y confirmada en el árbol: `StubEmailProvider.sendOtpCode` es un
`console.info`. **Repetiría el defecto exacto** —acuse sin envío— con la agravante de que esta vez
lo creeríamos arreglado. La memoria del repo ya lo tiene escrito para el OTP.

### B · Retirar las tarjetas de la landing
Descartada por el humano (F3). Además, retirarlas cierra un canal de captación por un defecto de
implementación; el problema no es la oferta, es que no llega a ningún sitio.

### C · Crear un `usuario` en estado `pendiente`, como la postulación de mensajero
Descartada. No hay cuenta que crear: no hay contraseña, ni documentos, ni cédula, ni rol que otorgar,
y `usuario.email`/`usuario.cedula` son **únicos** — dos personas que ofrecen una bodega sin cédula no
caben. Además ensancharía con filas sin login la tabla de la que dependen sesión, permisos y dinero.

### D · Meter las postulaciones de recurso en la tabla/panel de la 22-23
Descartada. Comparten la palabra «postulación» y nada más: aquélla proyecta documentos con URLs
firmadas de un bucket privado y transiciona `EstadoUsuario` (`pendiente → activo | inactivo`).
Mezclarlas obligaría a que cada campo de aquella tabla fuese nullable «según el caso», que es cómo se
construye un modelo que no se puede leer.

### E · Route handler en `app/api/postulacion-recurso/route.ts`
Descartada por `docs/architecture.md`: los route handlers son para webhooks, API de terceros y
crons; una mutación desde un componente propio va por Server Action. Además obligaría a añadir la
ruta a `PUBLIC_ROUTES` del middleware —tocar `middleware.ts` **fuerza `./init.sh` completo**— y a
inventar su propia protección CSRF, que la Server Action ya trae.

### F · Un enum `postulacion_recurso_estado` (`nueva` | `atendida`)
Descartada frente a `atendida_at` + `atendida_por_id` (§3): un enum de dos valores no guarda **quién
ni cuándo**, que es el dato que se busca cuando alguien pregunta si a esa persona la llamaron, y
crecer a un tercer valor cuesta migración de enum con `down.sql` de recreación. La contrapartida
honesta: el día que existan **tres** desenlaces reales con productor, el enum será mejor y habrá que
migrar. Hoy no existen.

### G · Formulario embebido de un proveedor externo (Google Forms, Typeform)
Descartada. Resolvería el destino en una tarde y rompería la landing como pieza de producto: otro
dominio, otro tema visual, datos personales fuera de la base y ninguna forma de que el panel del
admin los vea. Y el problema volvería a aparecer el día que alguien quiera cruzarlos con nada.

### H · Duplicar los detectores de la guardia en vez de extraerlos (D7)
Descartada, con evidencia: el frente 2 de la 240 **medía el `import` aunque su mensaje dijera
«llama»**, y se corrigió el 2026-08-20 tras encontrar la quinta forma de replantar la maqueta. Una
copia hecha antes de esa fecha seguiría siendo vulnerable, en verde, y nadie lo sabría. La objeción
legítima —un fallo en el módulo compartido rompe las dos— se cubre con el bloque 0 de
autocomprobación **en cada guardia**.

### I · Guardia por vocabulario del acuse
Ver §9.3.

---

## 15. Rojos esperados (y cuál sería una regresión)

| Rojo | ¿Esperado? |
| --- | --- |
| La guardia nueva, **roja mientras `postularRecurso` no exista o el modal no la invoque** | **Sí, y es el punto.** Por eso la acción, el modal y la guardia van en el **mismo PR** (`tasks.md`). |
| `tests/components/LandingPage.test.tsx` rojo | **NO.** Es regresión: esta ficha no mueve la estructura de la landing (R7). |
| Suites de las features 21/22/23 rojas | **NO.** Es regresión (R43). |
| `superficie-de-uso.guardia.test.ts` roja por las acciones nuevas | **Sí, transitoriamente**, si el backend entra antes que la pantalla. La salida correcta es **cablear**, nunca anotar `@sin-superficie`: anotarlo sería volver a declarar la maqueta. |
| `./init.sh --rapido` **negándose** a correr | **Sí, esperado:** el diff toca `db/migrations/**`, `db/schema.prisma` y `lib/types/**`. La salida es `./init.sh` completo. |

---

## 16. Trazabilidad — R → artefacto

| R | Dónde vive |
| --- | --- |
| R1-R3, R5-R7 | `PostularRecursoModal.tsx` + `tests/components/PostularRecursoModal.test.tsx` (NUEVO) |
| R4, R14-R20 | `lib/actions/postulacion-recurso.ts` + `tests/unit/actions/postulacion-recurso-action.test.ts` (NUEVO) |
| R8-R13 | `lib/types/postulacion-recurso.ts` + `tests/unit/types/postulacion-recurso-schema.test.ts` (NUEVO) |
| R21-R23 | migración + `tests/integration/db/postulacion-recurso-migration.test.ts` (NUEVO) |
| R24, R27-R28, R31-R33 | `lib/services/PostulacionRecursoService.ts` + su test unitario (NUEVO) |
| R25-R26, R32 | `lib/repositories/PostulacionRecursoRepository.ts` + test **contra Postgres real** (NUEVO) |
| R29-R30, R34-R36 | `PostulacionRecursoPanel.tsx`, `AdminMaestroDashboard.tsx` + tests de componente (NUEVOS) |
| R37-R42 | `tests/unit/guards/landing-sin-maqueta.guardia.test.ts` + `tests/fixtures/superficies-publicas.ts` (NUEVOS) |
| R43-R44 | suites existentes, verdes **sin modificarse** |

El mapa `R<n> → test` con nombre de caso lo cierra el implementer en
`progress/impl_253.md`; el reviewer rechaza si falta alguno (`docs/specs.md` § Trazabilidad).
