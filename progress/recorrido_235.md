# T8.1 — Ver la app: el recorrido de la feature 235, anotado

> **Hecho el 2026-08-19 por el leader**, contra la base **local** (`localhost:5432`) y el servidor
> de dev, conduciendo Chromium con Playwright. Lo que sigue es **lo que se vio en pantalla**, con el
> texto leído del navegador; las capturas quedaron fuera del repo (scratchpad de la sesión).
>
> Rama `feature/235-ayuda-tienda-estatus`, sobre el commit del arreglo de m4.

---

## 0 · Lo que costó llegar a ver la primera pantalla

Dos muros, ninguno de la ficha, y los dos vale la pena dejar escritos:

1. **El servidor de dev corría con un cliente Prisma rancio.** `/mis-asignaciones/reparto` devolvía
   un **404** con el armazón pintado (sidebar, avatar, «Reparto») y el cuerpo vacío. No era la ruta:
   el log del servidor traía
   `PrismaClientValidationError: Unknown field 'tramoPolilinea' for select statement on model 'RutaOptimizadaParada'`
   desde `RutaOptimizadaRepository.findByMensajero`. El campo **sí** está en `db/schema.prisma:1915`;
   lo que faltaba era regenerar. Y `pnpm exec prisma generate` **no basta**: el proceso vivo tiene el
   cliente viejo cargado en memoria y hay que **reiniciar** el servidor.
   👉 Un 404 en una ruta que existe puede ser un error de servidor disfrazado. Mirar el log primero.
2. **El OTP de la tienda SÍ se puede leer desde un script**, al contrario de lo que decía la receta
   anterior — pero **solo si la salida del servidor va a un ARCHIVO**, no por una tubería. Con
   `pnpm dev > dev.log 2>&1` la línea `Codigo OTP generado: NNNNNN` aparece en el archivo en menos de
   un segundo y el guion la lee sin pelear. (También queda en `.next/dev/logs/next-development.log`.)

---

## 1 · Mensajero · el punto de partida

`/mis-asignaciones/reparto`, con 3 órdenes en reparto asignadas al mensajero QA.

```
Pendientes 3 · Entregadas 0 · Por cobrar ₡45.257 · Total a cobrar ₡45.257
En reparto / por gestionar
Guía 111117 — 3 órdenes en reparto
… LLAMAR  MENSAJE  NAVEGAR  AYUDA
```

El cuarto botón «AYUDA» está donde el spec dijo, junto a los otros tres gestos de la puerta. Su
nombre accesible es `Solicitar ayuda con la orden de Anabelle Vargas Castro` (el rótulo visible es
solo `AYUDA`).

## 2 · Mensajero · pedir ayuda

El modal, leído tal cual:

```
Solicitar ayuda
Contá qué está pasando con la orden de Anabelle Vargas Castro (sin guía asignada).
Tu tienda lo verá en Novedades.
Motivo (obligatorio)
Hasta 200 caracteres. Se publica en las notas de la orden.
[Cancelar] [Solicitar ayuda]
```

**Observación:** con el motivo vacío, «Solicitar ayuda» está **deshabilitado**. El campo obligatorio
se defiende apagando el botón, no con un mensaje: el usuario no lee por qué no puede continuar. Es
conducta heredada de `HabilitarNovedadModal`, del que este modal es copia deliberada, y **no la
cuento como defecto de esta ficha**; queda anotada.

Con motivo, el toast dice `Se solicitó ayuda. Tu tienda lo verá en Novedades.`

## 3 · Mensajero · dónde quedó la orden — lo que la ficha vino a hacer, y se ve

```
Pendientes 3 · Entregadas 0 · Por cobrar ₡45.257 · Total a cobrar ₡45.257   <- NO BAJAN
En reparto / por gestionar
Guía 111118 — 2 órdenes en reparto                                          <- 3 -> 2
…
CON AYUDA SOLICITADA
Tu tienda las está viendo en Novedades. Con «Recuperar» retirás la solicitud
y la orden vuelve arriba.
```

- La orden **sale** del listado principal (3 → 2) y **aparece una sola vez** abajo.
- Los cuatro KPI **se quedan quietos**: `Pendientes 3`, `Por cobrar ₡45.257`. Es exactamente lo que
  P7/R20 firmó a mano —el paquete sigue en la moto y su COD sigue por cobrar—, y es la decisión que
  el comportamiento por defecto habría invertido. **Verificado en pantalla, no solo en test.**
- La orden **desaparece del mapa de ruta**, no solo su card.

## 4 · Mensajero · la conversación

«Conversación» abre el hilo, y el motivo recién escrito está dentro:

```
Conversación de la orden
Conversación sobre la orden de Anabelle Vargas Castro.
Notas con la tienda
Marco · Vos · 19 ago 2026, 2:31 p. m.
La dirección no existe y el destinatario no contesta. ¿Me confirman otra dirección?
[Eliminar]   Escribí una nota 0/200  [Publicar nota]  [Cerrar]
```

R35 del lado mensajero, ejercido de verdad: ventana de escritura abierta **y** un sitio donde
ejercerla.

## 5 · Mensajero · «Recuperar», la vuelta

Toast `se retiró la solicitud de ayuda.` y, tras releer:

```
¿queda sección de ayuda?: false
3 órdenes en reparto
Pendientes=3 · Por cobrar=₡45.257
```

La sección desaparece entera cuando se vacía (no queda un encabezado huérfano) y la orden vuelve
arriba.

## 6 · Tienda · lo que ve en `/novedades`

Con otra orden puesta en ayuda (guía **990001**, de la tienda QA), entrando como `adminTienda`
—con su OTP—:

```
Guía 990001 — Ayuda solicitada
Karla Vargas · Audifonos bluetooth · Intentos: 1
Alajuela · Alajuela
COBRAR ₡12.500
Intentos de contacto: 0
```

Acciones que la tienda tiene sobre ESA card, censadas por su nombre accesible:

| acción | ¿está? |
| --- | --- |
| Llamar a Karla Vargas | sí |
| WhatsApp a Karla Vargas | sí |
| **Habilitar** la orden de Karla Vargas | sí |
| Registrar un intento de contacto | sí |
| Reprogramar | **no** (correcto: esa es de la card de devolución) |
| Devolver | **no** (ídem) |
| **leer el hilo / las notas** | **NO EXISTE** |

Lo último es la consecuencia ya firmada y diferida a la **236**: la tienda ve que le piden ayuda y
**no puede leer el motivo que el mensajero escribió**. Visto en pantalla, no deducido.

## 7 · Tienda · «Habilitar», el rescate del otro lado

```
Habilitar orden
Contá por qué se habilita la orden de Karla Vargas (guía 990001).
Nota (obligatoria)
[Cancelar] [Habilitar]
```

Toast `Orden habilitada.`; la orden **sale de Novedades** (`1-3 de 3` → `1-2 de 2`) y, comprobado
contra la base, vuelve a `en_reparto`. El punto único de rescate funciona por sus **dos** puertas.

---

## 8 · Los DOS defectos que solo se ven mirando

Ninguno lo veía la suite. Los dos viven en la card de la sección de ayuda
(`RepartoModule.renderCardConAyuda`) y son una prop cada uno.

### D1 — el chip de la card dice «En reparto»

Texto leído: `Sin posición en la ruta · 111117  [En reparto]  [Pendiente de optimizar]`.

`PosOrderCardDetalle` hace `estado = estadoProp ?? estadoPorDefecto(esActiva, esDetalle)`, y con los
dos flags en `false` eso devuelve literalmente `"En reparto"`. Ese chip **no es decorativo**: para
los otros tres valores («En gestión», «En detalle», «Por recoger») describe la situación real de la
orden. Aquí afirma lo único que la ficha convirtió en falso.

### D2 — la card lleva las marcas de ruta, y R15 las prohíbe por su nombre

En la misma línea se ven **«Sin posición en la ruta»** y el badge **«Pendiente de optimizar»**.
R15 dice, literal: «NO DEBE pintarla como parada en el mapa de ruta del mensajero **ni contarla
entre las paradas pendientes de optimizar**». El servicio ya la deja fuera del **número**
(`paradasSinOptimizar`, con test), pero **la card sigue con la marca puesta**. Es la tercera vez en
esta ficha que la lógica migra y una superficie se queda atrás.

El repo ya tenía la prop exacta: `mostrarRuta={false}`, la que usa «Por recoger».

**Los dos se arreglaron en esta misma tanda**, con su test y su mutación → ver
`progress/impl_235_t81.md`.

## 9 · Lo que se ve HOY y no es defecto de esta ficha

- **La orden en ayuda aparece bajo la pestaña «En devolución»**, y bajo un subtítulo que dice
  *«Tus órdenes en devolución y las que llegaron a rechazo por vencerse el plazo»*. Ninguna de las
  dos cosas es cierta de una orden en ayuda. **Es justo lo que la 236 viene a arreglar** (pestaña
  propia y card propia). Se anota aquí medido: es lo que la tienda verá si la 235 sale sola.
- **La cabecera de la card rotula «Guía NNN» lo que es el nº de remisión**, y a la vez el modal dice
  «(sin guía asignada)» de esa misma orden. Preexistente y fuera del alcance de esta ficha.

## 10 · Estado de la base local al terminar

Se movieron órdenes de la base **local** para poder recorrerlo (poner en `en_reparto`, pedir ayuda,
rescatar). Al cerrar quedó **1 orden en `en_reparto`** y **ninguna** en `ayuda_tienda`. También se
**rotó la contraseña de los usuarios QA locales** con `scripts/seed-usuarios-qa.ts`. Nada de esto
tocó producción ni preview.
