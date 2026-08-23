# 🎡 Ruleta de Juegos

## Cómo correrla

```bash
pip install flask requests
python3 app.py
```

Abrí `http://localhost:5000`. Para que tus amigos entren desde sus celus/PCs
(misma wifi), usá el botón **🔗 Compartir** de la app, o directamente
`http://<tu-ip-local>:5000` (la consola te la muestra al arrancar).

## Qué cambié en esta pasada

- **Portadas parejas para todos los juegos**: antes cada imagen se ajustaba
  con `object-fit: contain` dentro de una caja 2:3, así que las portadas
  horizontales (headers/capsules de Steam) quedaban chiquitas, flotando con
  bordes vacíos, y eso era lo que se veía "bugeado" o descentrado en la
  ruleta. Ahora **todas** las miniaturas (rueda, lista, buscador, modal,
  historial) pasan por un único `.poster-frame` con `object-fit: cover`, así
  que se recortan prolijas sin importar si la imagen original es vertical u
  horizontal.
- **Bug de posiciones en (0,0)**: si la rueda se medía antes de que el layout
  terminara de asentarse, todas las portadas caían apiladas en la esquina.
  Ahora `renderWheel`/`buildLights` reintentan en el próximo frame si el
  contenedor todavía mide 0.
- **Giro con suspenso real**: dejé de usar una transición CSS fija y ahora
  animo la rotación cuadro a cuadro. Eso me permite calcular la velocidad
  angular real y aplicar motion blur (fuerte al arrancar, nulo sobre el
  final para que se pueda leer el resultado), más un "zoom de cámara" que
  se acentúa en el último tramo antes de frenar. Respeta
  `prefers-reduced-motion`.
- **Ticks sincronizados**: el sonido de "clic" ahora se dispara exactamente
  cuando la rueda cruza cada límite de gajo, no en un timer aparte, así que
  se escucha realmente sincronizado con el movimiento.
- **Historial mejorado**: cada entrada ahora guarda y muestra quién agregó
  el juego ganador, hay un panel de **Ranking de la casa** (🥇🥈🥉) armado a
  partir de esas victorias, y un botón para limpiar el historial completo.
- **Mensaje del ganador**: "*(Nombre) ganó, los demás se la tienen que
  bancar* 😂" con el emoji rebotando, tipografía cómica (Luckiest Guy /
  Permanent Marker vía Google Fonts) y el nombre del jugador en foco.
- **Duelo de Piedra, Papel o Tijera**: si alguien no está de acuerdo con el
  resultado, puede desafiar al "campeón" desde el modal del ganador. Es
  local por teclado — Retador: A/S/D, Campeón: J/K/L —, una sola chance
  (sin mejor-de-3), con cuenta regresiva y resultado cómico. Aclara en la
  UI que es solo por el ego: no cambia lo que decidió la ruleta.
- **Estética con más profundidad**: paleta ampliada, textura de grano sutil,
  paneles con vidrio esmerilado (`backdrop-filter`), degradé en el título,
  y el placeholder del nombre ahora dice "Ingresá tu nombre, pibe 😎".

## Importante si pensás subirla a Netlify

Netlify sirve sitios **estáticos** (HTML/CSS/JS) y funciones serverless de
corta duración — no puede correr este `app.py` tal cual, porque necesita:

1. Un proceso Python persistente (Flask corriendo todo el tiempo), y
2. Escritura en disco local (`data/games.json`, `data/history.json`, y las
   portadas cacheadas en `static/covers/`) que en Netlify no persiste entre
   invocaciones de una función.

Si el objetivo es que tus amigos entren desde afuera de tu wifi (no solo en
la previa en tu casa), dos caminos:

- **Más simple — mantener este backend como está**: desplegarlo en un
  servicio que sí corra procesos Python persistentes, como **Render**,
  **Railway** o **Fly.io** (todos tienen planes gratuitos/chicos que
  alcanzan de sobra para esto).
- **Si querés Netlify sí o sí**: habría que reescribir el backend como
  funciones serverless y cambiar el almacenamiento de archivos JSON locales
  a algo como Supabase, Firebase o similar para que la lista de juegos e
  historial se compartan entre todos tus amigos en tiempo real. Es un
  cambio de arquitectura más grande — avisame si querés que lo encaremos.

Para el uso original que describiste (juntada en tu casa, todos en la misma
wifi), el modo actual — correrla en tu compu y compartir la IP local — es
en realidad la forma más simple y sin costo de que funcione.
