# T10 — Ver la app: el recorrido de la feature 253

> **Hecho el 2026-08-21 por el leader**, con Playwright y los dos lados —el público sin sesión y el
> `admin`—, y **comprobando cada propiedad contra Postgres**, no contra la pantalla. Es lo que se
> vio, no lo que se esperaba.

## Por qué este recorrido no era opcional

La 253 arregla una pantalla que **daba acuse de recibo de algo que no ocurría**. El riesgo obvio al
arreglarla es dejar exactamente lo mismo: un acuse bonito y nada detrás. **La única forma de
distinguir el arreglo de la maqueta es mirar la base**, y eso es lo que hace este recorrido.

## 1 · Las dos tarjetas públicas, sin sesión

Desde `/`, «Postular mi vehículo» y «Postular mi bodega». Las dos pintan:

```
Postulación enviada
Recibimos tu postulación. Queda registrada y nuestro equipo te contacta
al teléfono o al correo que dejaste.
```

**Ese texto es el firmado en D9**, y la palabra que importa es **«queda registrada»**: la maqueta
decía «recibimos tus datos», que era falso. Cero fallos de red en las dos.

## 2 · 💾 Y ESTA VEZ SÍ ESTÁN — medido contra Postgres

```
tipo       nombre                    correo                                 atendida
bodega     Carlos Prueba BODEGA      prueba.bodega.544517@ordenex.test      no
vehiculo   Carlos Prueba VEHICULO    prueba.vehiculo.544517@ordenex.test    no
```

**Dos filas en `postulacion_recurso`.** Es la diferencia entera entre esta ficha y lo que había: el
mismo acuse en pantalla, pero ahora con algo detrás.

## 3 · La campana (D6, firmado en contra de la recomendación)

```
postulacion_recurso_pendiente | entidad: postulacion_recurso   (×4)
postulacion_mensajero_pendiente | entidad: usuario             (las de antes, intactas)
```

**Cuatro notificaciones = 2 postulaciones × 2 destinatarios.** Y con `entidad_tipo` propio, no
reusando `usuario`: reusarlo habría sido un dato falso —una postulación de recurso **no crea
cuenta**— y habría roto la deduplicación por `(evento, entidad_id, destinatario)`. Por eso D6
necesitó **dos** valores de enum y no uno.

## 4 · El panel del admin

En `/dashboard`, bajo **«Vehículos y bodegas ofrecidos»**, con pestañas `Pendientes` / `Atendidas`,
paginación, y cada tarjeta con tipo, nombre, teléfono, correo, **«Lo que nos contó»** y **«Llegó»**
con la fecha en hora de Costa Rica.

## 5 · Marcar atendida — y que el segundo estado tenga dueño

La confirmación no pregunta «¿seguro?», pregunta lo que hay que preguntar:

```
¿Ya contactaron a Carlos Prueba BODEGA?
La postulación pasa a la pestaña «Atendidas».
```

Y en la base, después:

```
bodega    | atendida: SI  el 2026-08-21T05:37  por Ana
vehiculo  | atendida: no
```

**Quién y cuándo, no un booleano.** Ése es el modelo firmado: `atendida_at` + `atendida_por_id` en
vez de un enum, porque un tercer estado no tendría productor. La fila del vehículo, sin tocar,
demuestra que la acción afecta **a una** y no a todas.

## 6 · Lo que NO se recorrió, y se dice

- **El cron de purga a 6 meses** no se puede provocar a mano sin esperar o invocarlo. Está cubierto
  por el test de integración contra Postgres, incluido el caso que de verdad importa —una fila
  `pendiente` de hace dos años **sobrevive**—, pero **no se ha visto con los ojos**.
- **El límite de tasa** tampoco se ejerció: haría falta pasar de 3 envíos en 60 minutos desde la
  misma IP y correo.

## 7 · Estado de la base local

Base **local**; contra producción no se escribió nada. Quedan las **dos** postulaciones de prueba
—una atendida por Ana, la otra pendiente— y sus cuatro notificaciones.
