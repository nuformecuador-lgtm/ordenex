# Ficha 429 — diseño técnico

> Base verificada: `progress/design_sf001_p2_sinpe_por_bodega.md`. Lo que aquí se añade son las
> decisiones que aquel documento dejaba abiertas, cada una con su argumento y con la alternativa
> descartada.

---

## 0. El criterio que ordena el resto

Un SINPE equivocado no rompe nada: sale el mensaje, el cliente transfiere, y se sabe días después.
Así que la pregunta con la que se eligió cada pieza no fue «¿funciona?» sino **«¿puede este estado
malo llegar a existir?»**. Ocho cosas pasan de «hay que acordarse» a «no es representable»:

| # | Estado malo | Qué lo hace imposible |
| --- | --- | --- |
| 1 | una bodega sin SINPE | columnas `NOT NULL` **sin `DEFAULT`** en `zona` (§1.1) |
| 2 | un número con formato imposible, venga de donde venga | `CHECK` en Postgres, no solo zod (§1.2) |
| 3 | un titular vacío o en blanco | `CHECK` sobre `btrim()` (§1.2) |
| 4 | una pantalla que pinta plantillas sin SINPE | los dos campos son **requeridos** en `MiAsignacionDTO`: no compila (§3.2) |
| 5 | un camino que «se olvida» y resuelve `""` | `negocioDesdeEnv()` desaparece; su sustituto recibe los dos valores **por parámetro obligatorio** (§3.1) |
| 6 | que la variable de entorno vuelva por la puerta de atrás | guardia estática sobre la cadena `NEXT_PUBLIC_SINPE` en todo el árbol (§3.4) |
| 7 | que el servidor y el móvil del mensajero rindan números distintos | **una sola** función pura resuelve el par, y la usan los dos (§3.3) |
| 8 | un cambio sin rastro, o un rastro sin cambio | la fila de `historial_accion` se escribe en la MISMA transacción (§4.3) |

Lo que **no** se puede hacer imposible, y queda dicho: que alguien teclee un número de ocho dígitos
válido pero **que no es el suyo**. Contra eso solo hay la revisión de §6 y el rastro de §4.

---

## 1. Modelo de datos

### 1.1 Dónde viven los dos campos: COLUMNAS EN `zona`

```prisma
model Zona {
  id            String  @id @default(uuid())
  nombre        String  @unique
  cobroVehiculo Boolean @default(false) @map("cobro_vehiculo")
  esCentral     Boolean @default(false) @map("es_central")

  /// FICHA 429 — el SINPE de ESTA bodega. NOT NULL y SIN default: una bodega sin SINPE no
  /// es un estado representable. Formato garantizado por CHECK en la base, no solo por zod.
  sinpeNumero String @map("sinpe_numero") @db.VarChar(8)
  sinpeNombre String @map("sinpe_nombre") @db.VarChar(60)

  /// FICHA 429 — NULL = «la semilla de la migración, y nadie lo ha mirado todavía». Es la
  /// TERCERA capa de D3: lo que dispara la revisión obligatoria del primer login.
  sinpeRevisadoAt DateTime? @map("sinpe_revisado_at")
  ...
}
```

**Por qué columnas y no una tabla aparte `zona_sinpe`.** Una tabla 1:0..1 introduce exactamente el
estado que esta ficha viene a eliminar: **una bodega sin fila**. Ese hueco no es teórico, es el modo
de fallo entero de la ficha — una zona sin fila resolvería `""` y el cliente leería un mensaje sin
número, o peor, el código pondría un fallback y nadie se enteraría. Con columnas `NOT NULL` en la
tabla que ya existe, «bodega sin SINPE» deja de ser una consulta que hay que acordarse de hacer y
pasa a ser un `INSERT` que Postgres rechaza. Además: `zona` ya se lee con `select { nombre }` en los
diez sitios que importan (`OrdenEnvioReader`, `OrdenRepository`, `UserRepository`…), así que dos
columnas más **no añaden ni una consulta**, mientras que una tabla aparte añade un `join` a cada uno
de esos caminos, incluido el del listado de asignaciones del mensajero.

**Alternativa descartada — tabla `zona_sinpe` con histórico de versiones.** Da gratis el «de qué
número a qué número» y permite fechar cada cambio. Se descarta por tres razones:
(a) reintroduce el hueco de la bodega sin fila, que es el riesgo principal;
(b) el «de qué número a qué número» ya lo da `historial_accion` en sus columnas `valor_anterior` /
`valor_nuevo` (§4.2), sin tabla nueva y con el actor congelado, que una tabla de versiones no trae;
(c) una tabla nueva obliga a RLS propia, a su política y a su test, mientras que las columnas heredan
la RLS que `zona` ya tiene habilitada desde `20260709130000_ordenes_catalogos_geografia`.

**Alternativa descartada — una fila por bodega en una tabla genérica de configuración
(clave/valor).** El precedente en contra está escrito en este mismo esquema, en el TSDoc de
`UsuarioPreferencia`: con clave/valor, **una clave mal escrita no falla — devuelve «no hay valor»**.
Es literalmente la familia de fallo mudo que esta ficha persigue.

### 1.2 Las restricciones, en la base

```sql
ALTER TABLE "zona" ADD CONSTRAINT "zona_sinpe_numero_check"
  CHECK ("sinpe_numero" ~ '^[678][0-9]{7}$');
ALTER TABLE "zona" ADD CONSTRAINT "zona_sinpe_nombre_check"
  CHECK (btrim("sinpe_nombre") <> '');
```

El `CHECK` del número **no es redundante con zod** y ésa es su gracia: zod protege el borde de la
aplicación, y el borde de la aplicación no es el único escritor. Los seeds, los scripts de `scripts/`
y cualquier `UPDATE` corrido a mano contra producción —vía MCP de Supabase, que es como se escribe en
prod en este repo— entran por debajo de zod. El `CHECK` los cubre a todos.

**El precio, declarado:** hay dos fuentes del mismo formato (el `CHECK` y `lib/utils/sinpe-cr.ts`) y
pueden divergir. Se cierra con un test que corre **la misma tabla de casos** contra Postgres real y
contra el validador (R7). Si alguien relaja uno de los dos, el test lo dice.

### 1.3 La migración

**Dos migraciones, no una**, porque Postgres prohíbe usar un valor de enum en la misma transacción
que lo añade (55P04) y Prisma corre cada `migration.sql` en su propia transacción. Precedente literal:
`20260908140000` + `20260908140100`.

**Migración A — `<ts>_historial_accion_zona_sinpe`**

```sql
ALTER TYPE "historial_accion_tipo" ADD VALUE IF NOT EXISTS 'zona_sinpe_cambiado';
```

`historial_accion_entidad` **no se toca**: `zona` ya está entre sus valores desde la 362.

Su `down.sql` recrea el tipo con la lista previa (Postgres no soporta `DROP VALUE`). **La lista hay
que MEDIRLA al escribirla**, no copiarla del down anterior: el catálogo creció después de la foto del
2026-09-08 (`cierre_dia_gestion_corregida`, `cobro_tienda_registrado`…). Consulta obligatoria antes de
escribir el archivo:

```sql
SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname = 'historial_accion_tipo' ORDER BY e.enumsortorder;
```

Ningún `down.sql` anterior se toca: son fotos históricas.

**Migración B — `<ts>_zona_sinpe`**

```sql
-- 1) columnas nullable, para poder sembrar
ALTER TABLE "zona" ADD COLUMN "sinpe_numero" VARCHAR(8);
ALTER TABLE "zona" ADD COLUMN "sinpe_nombre" VARCHAR(60);
ALTER TABLE "zona" ADD COLUMN "sinpe_revisado_at" TIMESTAMP(3);

-- 2) LA SIEMBRA (D3-a / R10): las 8 bodegas arrancan con el SINPE global de hoy.
--    `sinpe_revisado_at` se queda en NULL A PROPOSITO: nadie lo ha mirado.
UPDATE "zona" SET "sinpe_numero" = '<NUMERO_ACTUAL>', "sinpe_nombre" = '<TITULAR_ACTUAL>';

-- 3) el NOT NULL, DESPUES de sembrar, y SIN default: una bodega nueva tiene que traer el suyo
ALTER TABLE "zona" ALTER COLUMN "sinpe_numero" SET NOT NULL;
ALTER TABLE "zona" ALTER COLUMN "sinpe_nombre" SET NOT NULL;

-- 4) los CHECK, al final: validan las filas ya sembradas al aplicarse (sin NOT VALID)
ALTER TABLE "zona" ADD CONSTRAINT "zona_sinpe_numero_check" CHECK ("sinpe_numero" ~ '^[678][0-9]{7}$');
ALTER TABLE "zona" ADD CONSTRAINT "zona_sinpe_nombre_check" CHECK (btrim("sinpe_nombre") <> '');
```

**El orden importa y no es estético.** Con `DEFAULT` en el `ADD COLUMN` la siembra sería más corta —y
dejaría el default vivo para siempre, de modo que crear una bodega **sin** SINPE seguiría siendo
posible y produciría en silencio el número de la central. El `DEFAULT` es justamente lo que esta
ficha no puede permitirse.

**El `down.sql`** quita los dos `CHECK` y las tres columnas. Dato perdido al revertir, declarado: los
SINPE por bodega y las fechas de revisión. Es aceptable porque la siembra los puede reconstruir a un
estado equivalente al de hoy (uno solo para todos), que es exactamente lo que había antes.

**RLS:** no hay tabla nueva. `zona` tiene RLS habilitada sin policies desde el día uno (solo service
role) y esta ficha no la toca. El anti-patrón «tabla nueva sin RLS» no aplica, y así se declara para
que el reviewer no lo busque.

---

## 2. Cómo se resuelve el par: UNA función pura

`lib/utils/sinpe-bodega.ts`

```ts
export interface SinpeBodega { numero: string; nombre: string; }

/**
 * FICHA 429 (R13/R15) — DE QUE BODEGA ES EL SINPE QUE VE EL CLIENTE.
 *
 * Primero la del MENSAJERO, y no es una preferencia: `cierre_dia.destino_zona_id` es «la zona del
 * mensajero» y es donde ese dinero se liquida. Si el mensaje mandara a la bodega de la ORDEN, el
 * cliente transferiría a una bodega que no es la que va a cuadrar ese cobro.
 *
 * La de la ORDEN es el respaldo, y cubre el hueco entero: `orden.zona_id` es NOT NULL (R12 de la
 * feature 24), asi que SIEMPRE hay una. `usuario.zona_id` NO lo es —hay mensajeros sin zona, y el
 * corte diario ya los cuenta aparte (`CorteDiarioService`, `mensajerosSinZona`)—, y una orden puede
 * no tener mensajero asignado (es el caso normal en `/novedades`).
 *
 * No hay tercera rama. No hace falta: la segunda no puede faltar.
 */
export function resolverSinpeBodega(entrada: {
  zonaDelMensajero: SinpeBodega | null;
  zonaDeLaOrden: SinpeBodega;
}): SinpeBodega {
  return entrada.zonaDelMensajero ?? entrada.zonaDeLaOrden;
}
```

**Alternativa descartada — resolver SIEMPRE por la zona de la ORDEN.** Es tentadora: `orden.zona_id`
es `NOT NULL`, así que la regla no tendría ni una rama y no habría nada que probar. Se descarta
porque **contradice dónde acaba el dinero**: `cierre_dia.destino_zona_id` se deriva de la zona del
mensajero (`resolverDestinoCierre`), no de la de la orden, y las dos pueden diferir — la ficha 377
documenta órdenes que conservan su zona anterior porque su paquete ya está en el estante de otra
bodega. Con la regla «por la orden», ese cliente transferiría a una bodega que no va a cuadrar ese
cobro, y el descuadre sería tan mudo como el número equivocado. Además el documento verificado dice
literalmente «pasa a leer la bodega del mensajero».

**Alternativa descartada — la central como respaldo.** Mantiene el comportamiento de hoy (todos ven
el número de GAM) y por eso parece segura. Se descarta porque es **peor que el respaldo elegido sin
ser más simple**: la zona de la orden es, como mínimo, la bodega del territorio donde se está
entregando; la central es un número que no tiene nada que ver con esa entrega. Y exigiría leer la
zona central en cada resolución.

---

## 3. Cómo llega el valor al cliente

### 3.1 `negocioDesdeEnv()` desaparece

Hoy es el único punto que lee las dos variables y devuelve `""` cuando faltan. Su sustituto:

```ts
// lib/utils/whatsapp-envio-valores.ts
export function negocioConSinpe(sinpe: SinpeBodega): DatosPlantilla["negocio"] {
  return {
    sinpeNumero: sinpe.numero,
    sinpeNombre: sinpe.nombre,
    urlBase: process.env.NEXT_PUBLIC_SITE_URL ?? "",   // NO CAMBIA: fuera de alcance
  };
}
```

El parámetro es **obligatorio y sin default**. Esa es toda la garantía: hoy un llamador nuevo que se
olvidara de la configuración obtenía `""` y un mensaje mudo; a partir de ahora **no compila**.
`urlBase` se queda leyendo el entorno porque es la única URL que el negocio publica de sí mismo y
esta ficha no la toca.

`datosPlantillaDesdeOrdenEnvio` / `resolverValoresOrden` reciben el par por parámetro. **Dato
medido:** hoy no tienen ningún consumidor de producción —solo `tests/unit/utils/whatsapp-envio-valores.test.ts`—
aunque su comentario diga que lo usa el botón wa.me. **Esta ficha no los borra** (arreglar lo
evidenciado, no rediseñar): les añade el parámetro y deja el hallazgo escrito.

### 3.2 El par viaja con los datos de la asignación

`MiAsignacionDTO` gana dos campos **requeridos**:

```ts
export interface MiAsignacionDTO {
  ...
  /** FICHA 429 (R13/R14) — el SINPE de la bodega que cobra ESTA orden, ya resuelto por el
   *  servidor. REQUERIDOS a proposito: una superficie que renderice plantillas sin tenerlos
   *  no compila. Nunca se rellenan desde el cliente (R18). */
  sinpeNumero: string;
  sinpeNombre: string;
}
```

No son opcionales, y eso rompe el «patrón aditivo» con el que crecieron `marcarLuego?`,
`intentosEntrega?` y `alUltimoIntento?`. Es deliberado: aquel patrón existe para que los fixtures no
se rompan, y aquí **que los fixtures se rompan es el objetivo** — el typecheck enumera, uno por uno y
sin que nadie tenga que acordarse, todos los productores del DTO. `NovedadDTO extends MiAsignacionDTO`
y `RecoleccionOrdenDTO extends MiAsignacionDTO`, así que la lista sale entera del compilador.

Coste real: cero consultas nuevas. Los repositorios que construyen esos DTO ya hacen
`zona: { select: { nombre: true } }`; se les añaden dos columnas al `select` que ya existe, y
`mensajeroAsignado: { zona: { select: ... } }` donde haga falta.

### 3.3 Las dos superficies, una sola regla

| Superficie | Qué hace hoy | Después |
| --- | --- | --- |
| **Envío por servidor** (`OrdenEnvioReader.findParaEnvio` → `ChatWhatsappService`, `whatsapp-bienvenida-handler`) | `negocio: negocioDesdeEnv()` | `negocio: negocioConSinpe(resolverSinpeBodega({ zonaDelMensajero: row.mensajeroAsignado?.zona ?? null, zonaDeLaOrden: row.zona }))` |
| **Composición en el dispositivo** (`EnviarPlantillaWhatsappButton` en `/mis-asignaciones` y `/novedades`, `ChatConversacion`) | `datosPlantillaDesdeAsignacion(orden)` → `negocioDesdeEnv()` | el mismo adaptador, leyendo `orden.sinpeNumero` / `orden.sinpeNombre` del DTO |

**Y esa segunda fila no es una vista previa.** En modo wa.me (`/novedades` y el panel del mensajero
sin callback de chat) el texto que compone el navegador **es el que recibe el cliente**: se abre
`wa.me/...?text=<texto>` y la persona solo pulsa enviar. Un SINPE mal resuelto ahí llega al cliente
igual que si lo mandara el servidor. Por eso R16 exige que los dos caminos rindan el mismo texto y hay
un test que lo compara carácter a carácter con el mismo fixture.

### 3.4 Qué pasa con las variables de entorno viejas: SE RETIRAN

Se borran de `.env.example`, del código y del `campo` documental del catálogo de plantillas
(`"env NEXT_PUBLIC_SINPE_NUMERO"` → `"zona.sinpe_numero (bodega del mensajero)"`), y una guardia
estática impide que la cadena `NEXT_PUBLIC_SINPE` vuelva a aparecer en el árbol.

**Alternativa descartada — dejarlas como red de seguridad** (`valorDeLaZona || valorDelEntorno`).
Es la opción que suena prudente y es la peor de las tres. Con las columnas `NOT NULL`, el lado
izquierdo **nunca** puede estar vacío, así que la red no se dispara jamás en el caso que pretende
cubrir; lo único que puede hacer es taparte un fallo distinto —una lectura que se olvidó de hacer el
`select`, un DTO a medio construir— devolviendo un número plausible y equivocado, en silencio, que es
el modo de fallo exacto de esta ficha. Y como llevan el prefijo `NEXT_PUBLIC_`, un valor rancio
horneado en el bundle sobreviviría a cualquier cambio en Vercel hasta el siguiente build.

**Alternativa descartada — dejarlas como semilla viva** (que la app las lea al crear una bodega
nueva). Convierte un dato de configuración en una preselección invisible: quien crea una bodega vería
un campo «ya relleno» sin saber de dónde salió, y aceptarlo sin leerlo es un gesto de un segundo. D3-b
dice «obligatorio al crear», y obligatorio significa teclearlo.

Su vida útil termina en la migración: **el valor sembrado en `migration.sql` ES la semilla**, escrito
una vez, versionado y auditable. Borrarlas del panel de Vercel es un paso manual posterior al
despliegue (ver `tasks.md` T16) — mientras sigan ahí no hacen daño, porque ya no las lee nadie.

---

## 4. Escritura y rastro

### 4.1 Superficie de escritura: una acción nueva y estrecha

`lib/actions/sinpe-bodega.ts` (`'use server'`):

| Acción | Entrada | Salida |
| --- | --- | --- |
| `listarSinpeBodegas()` | — | `{ status: "ok"; items: SinpeBodegaDTO[] }` \| `unauthenticated` \| `forbidden` |
| `guardarSinpeBodega(zonaId, input)` | `{ numero: string; nombre: string }` | `{ status: "ok"; bodega: SinpeBodegaDTO }` \| `validation_error` \| `unauthenticated` \| `forbidden` \| `not_found` |
| `confirmarSinpeBodega(zonaId)` | — | `{ status: "ok" }` \| los mismos errores |

```ts
export interface SinpeBodegaDTO {
  zonaId: string;
  zonaNombre: string;
  esCentral: boolean;
  numero: string;
  nombre: string;
  revisadoAt: string | null;   // ISO; null = nadie lo ha mirado
  editable: boolean;           // decidido en el SERVIDOR, no en la pantalla
}
```

Server Action y no route handler: es una mutación interna desde un componente propio
(`docs/architecture.md`, tabla «Server Actions vs Route Handlers»). Zod en el borde:
`z.object({ numero: sinpeNumeroSchema, nombre: z.string().trim().min(1).max(60) }).strict()`.

**Archivo propio y no `lib/actions/zonas.ts`.** Aquel es `maestro`-only de arriba abajo —las cinco
acciones empiezan por `esMaestro(actor)`— y su `actualizarZona` es un **reemplazo completo** que
arrastra distritos, tarifas del mensajero y la marca de zona central. Meter ahí una acción con OTRO
modelo de permisos invita a que la siguiente edición ensanche la equivocada: bastaría un
`adminSatelite` colado en el gate de `actualizarZona` para darle la reescritura de
`tarifa_zona_mensajero` de su zona. Separado, la superficie que gana el `adminSatelite` son
literalmente dos campos.

`crearZona` / `actualizarZona` sí ganan los dos campos en su esquema (R11), porque una bodega nueva
no puede nacer sin ellos y ese camino sigue siendo `maestro`-only.

### 4.2 La fila de historial

| Columna | Valor |
| --- | --- |
| `accion` | `zona_sinpe_cambiado` |
| `entidad_tipo` | `zona` (ya existe en el enum) |
| `entidad_id` | id de la zona |
| `entidad_etiqueta` | `etiquetaDeEntidad("zona", { nombre })` — nunca una interpolación a mano |
| `actor_*` | congelados (usuario, nombre, rol) |
| `monto` | `NULL` — no hay un importe único |
| `valor_anterior` / `valor_nuevo` | el **número** de antes y el de después |
| `lote_id` | propio de este acto |

**Por qué `mueve_dinero` y no otra categoría.** R17 de la 362 exige exactamente una. Estos dos campos
deciden **a qué cuenta va a parar el dinero del cliente**: es el sentido más directo de la categoría,
más directo todavía que `zona_pago_mensajero_cambiado`, que ya está ahí.

**Por qué el número entra en `valor_anterior`/`valor_nuevo` y el titular no.** La columna admite
«vocabulario CERRADO … nunca texto libre tecleado por una persona» (TSDoc de `HistorialAccion`). El
número **no es texto libre**: son ocho dígitos con un `CHECK` detrás, es el dato público que se le
manda a cada cliente en cada mensaje, y es lo único que contesta la pregunta que se hará el día del
reclamo —«¿a qué número transfirió el cliente el martes?»—. El titular sí es un nombre tecleado por
una persona, así que se queda fuera por la misma regla que dejó fuera el motivo de un rechazo.

**Límite declarado, con precedente:** si un guardado cambia SOLO el titular, la fila existe y sus dos
valores son el mismo número. El historial dirá que el SINPE de esa bodega cambió, cuál, quién y
cuándo — y no de qué titular a qué titular. Es el mismo alcance que el humano firmó para
`zona_pago_mensajero_cambiado` (Q2 de la ficha 380).

**Confirmar sin cambiar nada no deja fila (R25).** D6 dice «quién lo **cambió**»; una confirmación no
cambia nada y no mueve dinero. Meter un tipo «alguien lo miró» en la categoría del dinero la
convertiría en un registro de visitas. La fecha queda en `zona.sinpe_revisado_at`; el «quién» de una
confirmación sin cambio, no. Declarado.

### 4.3 Atomicidad

`ZonaRepository.guardarSinpe(zonaId, { numero, nombre }, actorUsuarioId)`, en **una** `$transaction`:

1. `SELECT ... FOR UPDATE` de la fila de zona → número y titular previos;
2. `UPDATE zona SET sinpe_numero, sinpe_nombre, sinpe_revisado_at = now()`;
3. si alguno de los dos cambió: `appendAccion(tx, [...], randomUUID())` — **con `tx`, jamás con
   `this.prisma`**: escribir por `this.prisma` aquí dentro compila, parece correcto y escribe fuera de
   la transacción (la mutación que sobrevivió en la ficha 373).

Y la entrada correspondiente en el censo de
`tests/unit/guards/historial-accion-escrituras-cubiertas.guardia.test.ts`, cuya mutación exigida
apunta al `update` de las dos columnas. Ojo al límite conocido de esa guardia: **mide por método, no
por escritura**. Aquí no muerde, porque el método tiene una sola escritura.

---

## 5. Quién puede editar qué

| Rol | Alcance | Argumento |
| --- | --- | --- |
| `maestro` | las 8 | ya es el dueño del CRUD de zonas entero |
| `admin` | las 8 | ver abajo |
| `adminSatelite` | **solo la suya** | es su bodega y su dinero |
| `mensajero`, `adminTienda`, cuentas de API | ninguna | no administran bodegas |

**Por qué `admin` edita cualquiera y no solo la central.** La central es suya por D4, así que la
pregunta real es si además puede tocar una satélite. Sí, por tres razones concretas:

1. **`admin` ya no está acotado por zona en ningún sitio.** Quien acota por zona es `adminSatelite`
   (`alcanceWhere` de `CierresAdminRepository`, el recorte de `/incidentes`, el de las
   notificaciones). Darle a `admin` un alcance por zona *solo aquí* sería la primera excepción de ese
   patrón, y las excepciones de una sola pantalla son las que nadie recuerda al añadir la siguiente.
2. **El hueco que se abriría es el de siempre.** Si el `adminSatelite` de Guanacaste está de baja y su
   número está mal, con `admin` acotado a la central la corrección vuelve a depender del `maestro` —
   o sea, vuelve a haber una persona sin la cual el dinero sigue yendo a la cuenta equivocada. Esta
   ficha existe para quitar esa dependencia, no para moverla un escalón.
3. **La rendición de cuentas no se pierde:** cada cambio deja fila con actor congelado (§4.2) y el
   `adminSatelite` ve el valor vigente de su bodega en su propia pantalla, así que un cambio ajeno es
   visible para el afectado.

**Alternativa descartada — `admin` solo en la central.** Es la de menor privilegio y por eso se
consideró en serio. Se descarta por (2): cambia un riesgo medible —bodega bloqueada esperando a una
persona— por uno hipotético —un `admin` que redirige a mala fe el cobro de una satélite—, y ese
segundo ya está cubierto por el rastro. Queda como **Q2** en `requirements.md`: es vetable con un
cambio de una línea.

**Dónde se decide.** En `SinpeBodegaService`, con la zona del actor **leída de la base** por su
`usuarioId`, nunca tomada del payload (R20). El `Actor` de `IZonaService` solo lleva
`{ usuarioId, rol }`; esta ficha añade una lectura explícita en el servicio, no un campo nuevo en el
actor de sesión (un `zonaId` en la cookie sería un permiso viajando por el cliente).

---

## 6. La revisión obligatoria del primer inicio de sesión

### 6.1 Qué la dispara

Una consulta en `app/(app)/layout.tsx`, que **ya resuelve al actor y ya hace un `Promise.all` de dos
lecturas** (ficha 422). Se le añade una tercera, y **solo para los tres roles que pueden editar**:
`mensajero` y `adminTienda` no pagan ni una consulta.

```ts
// null = nada que pedir. Sale del SERVIDOR, con la zona que la base le asigna a esa persona.
const revision = await resolverRevisionSinpePendiente(actor);
```

- `adminSatelite` → su zona, si `sinpe_revisado_at IS NULL`.
- `admin` / `maestro` → la zona central (`es_central = true`), si `sinpe_revisado_at IS NULL`.
  Esto cierra el hueco que el documento verificado nombra: en la central nadie tiene un login que se
  lo exija, «depende de que un admin entre a configuración».
- `adminSatelite` sin zona (estado representable: `usuario.zona_id` es nullable) → `null`. No se pide
  nada y no se rompe nada.

El componente se monta como **hermano** del contenido, igual que `PushReactivacion`
(`{actor && revision && <RevisionSinpeBodega ... />}`), nunca envolviéndolo. Eso es lo que hace R28
estructural en vez de una promesa: no hay sitio donde pueda impedir que el contenido se pinte.

### 6.2 Qué hace el aviso (el QUÉ; el cómo se ve, a `/design`)

1. **Enseña el número y el titular vigentes de esa bodega**, legibles, sin que haya que ir a buscarlos.
2. Ofrece **dos salidas equivalentes**: «está bien» (confirma) y **corregirlo ahí mismo** (R27).
   Mandarlo a otra pantalla es un paso donde la gente se cae; y quien acaba de ver que el número está
   mal es exactamente quien puede arreglarlo en ese segundo.
3. **Se puede cerrar.** Cerrarlo NO confirma nada: la bodega sigue sin revisar y el aviso vuelve **en
   el siguiente inicio de sesión**, no en la siguiente navegación (R29). La diferencia importa: un
   aviso que reaparece cada vez que cambias de pantalla se cierra por reflejo a los tres minutos y
   deja de decir nada.
4. **No bloquea nada, nunca** (R28). Que el aviso esté pendiente no cambia el acceso a ninguna ruta.
   Y no puede dejar a un mensajero sin poder trabajar por construcción: los mensajeros no lo ven, y su
   mensaje lleva número desde el minuto uno gracias a la siembra.
5. Una vez confirmado, **no vuelve para nadie de esa bodega** (R30), porque la marca es de la bodega y
   no de la persona (D2).

**Por qué «reaparece al siguiente login» y no un bloqueo duro.** Un bloqueo garantiza la revisión y
garantiza también que un fallo de esa pantalla deja a una bodega entera sin poder trabajar. La
condición D8 —«no dañar lo que ya funciona»— manda: la insistencia se paga con volver a preguntar, no
con cerrar la puerta. Y la siembra hace que el coste de una revisión aplazada sea, en el peor caso,
exactamente lo que el cliente ve hoy.

**Alternativa descartada — mostrarlo una sola vez y confiar.** «Una sola vez» en el sentido de «se
enseña una vez y si la cierras no vuelve» convierte el tercer nivel de D3 en un adorno: basta cerrar
un modal sin leerlo, y quedan ocho bodegas con el número de la central para siempre sin que nada lo
diga. «Una sola vez» se interpreta como «una vez confirmada, no se vuelve a pedir», que es R30.

### 6.3 La pantalla completa

Ruta nueva bajo `/configuracion/sinpe` (la etiqueta final es de `/design`), con su propio gate
server-side leyendo la MISMA constante de roles que usa el ítem de menú — el precedente es la ficha
335, y el motivo es que dos listas de roles escritas a mano divergen sin que nada se ponga rojo.

- `adminSatelite` → una sola ficha: la suya.
- `admin` / `maestro` → las 8, cada una con su valor y una marca visible de «nunca revisada».

**Un aviso que no es decorativo.** El ítem nuevo de menú va **al final** de `SIDEBAR_ITEMS`.
`primerDestino(itemsVisibles(...))` devuelve el `href` del primer ítem visible no marcado, y
`/dashboard` redirige ahí: un ítem colocado antes cambiaría **en silencio** dónde aterriza
`adminSatelite` o `admin` después de entrar. Ya pasó dos veces en este repo (Analítica/133,
Monitoreo/192) y hay un `toEqual` literal en `tests/unit/auth/destino-post-login.test.ts`. Un test de
esta ficha afirma que el aterrizaje de los cinco roles es el mismo antes y después.

---

## 7. Contratos de entrada/salida, en una tabla

| Punto | Entra | Sale | Validación |
| --- | --- | --- | --- |
| `guardarSinpeBodega` | `zonaId: string`, `{ numero, nombre }` | `SinpeBodegaDTO` o error discriminado | zod `.strict()` + permiso por rol y zona **del servidor** |
| `confirmarSinpeBodega` | `zonaId: string` | `ok` | mismo permiso; no acepta valores |
| `listarSinpeBodegas` | — | `SinpeBodegaDTO[]` con `editable` ya decidido | solo lectura |
| `crearZona` / `actualizarZona` | `+ sinpeNumero`, `+ sinpeNombre` | sin cambios en el resto | `maestro`-only, como hoy |
| `MiAsignacionDTO` (y sus dos herederos) | — | `+ sinpeNumero`, `+ sinpeNombre` requeridos | resueltos en el servidor; nunca leídos del cliente |
| `findParaEnvio` | igual que hoy | `negocio` resuelto por bodega | — |

Integraciones: **ninguna nueva**. WhatsApp Cloud API sigue recibiendo el mismo `template` con las
mismas variables; lo único que cambia es el valor de dos de ellas. Meta aprueba la forma, no el valor
(V3 del documento verificado).

---

## 8. Estrategia de verificación (condición D8)

«No daña lo que ya funciona» no es una intención: son cinco pruebas concretas.

1. **La prueba de equivalencia.** Con una zona cuyo SINPE sea **igual** a los valores de entorno de
   hoy, el texto renderizado de `listo_para_entrega_mensajero` tiene que salir **idéntico carácter a
   carácter** al de antes del cambio, por los dos caminos (servidor y dispositivo). Si algo se
   desplazó, ahí se ve.
2. **El gate completo.** La migración y `lib/types/**` hacen que `--rapido` se niegue solo; el
   veredicto sale de `./init.sh` entero, con el baseline de rojos decidiendo. Y **con `DATABASE_URL`
   exportada**: sin ella los ~147 archivos de `tests/integration/db` se SALTAN y la suite termina
   verde sin haber tocado la capa de datos — que es justo donde viven los `CHECK` de esta ficha. Se
   mira el número de `skipped`, no solo el `INIT_EXIT`.
3. **La migración se aplica Y se revierte** contra Postgres real, y se comprueba que el `down` deja
   el enum exactamente en la lista previa, valor a valor y en orden.
4. **Mutación deliberada antes de creerse los verdes.** Tres mutaciones mínimas, cada una tiene que
   poner algo rojo: (a) cambiar el `CHECK` a `^[0-9]{8}$`; (b) hacer que el resolvedor devuelva
   siempre la zona de la orden; (c) quitar el `tx` del `appendAccion` y pasar `this.prisma`. Un
   arnés de mutaciones que reporta supervivientes sin haber ejecutado un test ya mintió en este repo:
   la evidencia es la salida del test rojo, pegada.
5. **Medición en producción, en solo lectura y ANTES de dar por buena la release.** Con el MCP de
   Supabase, justo después de aplicar la migración:
   ```sql
   SELECT nombre, es_central, sinpe_numero, sinpe_nombre, sinpe_revisado_at FROM zona ORDER BY nombre;
   SELECT count(*) FROM zona WHERE sinpe_numero <> '<NUMERO_ACTUAL>';   -- tiene que dar 0
   ```
   Ocho filas, todas con el número de hoy, todas con `sinpe_revisado_at` en `NULL`. Si sale otra
   cosa, la release se para.

**Producción arrancó vacía el 2026-08-25**, así que un cero en cualquier conteo de órdenes significa
«todavía no ha pasado», no «está roto». Las ocho zonas sí existen y sí se cuentan.
