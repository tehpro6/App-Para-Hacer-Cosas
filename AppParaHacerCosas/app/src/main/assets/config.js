// config.js - configuración de la app. Debe cargarse ANTES de bot.js:
//   <script src="config.js"></script>
//   <script src="bot.js"></script>
window.APP_CONFIG = {
  // URL del bot, sin "/" al final.
  //   Render:     "https://tu-bot.onrender.com"
  //   Tu PC/red:  "http://192.168.1.50:3000"  (o "http://localhost:3000")
  //   "" = mismo origen que la página
  API: "https://botparahacercosas-7a2b.onrender.com",

  // Clave que el bot espera en la cabecera x-api-key (la misma que tienes en el .env / variables de Render).
  // Ojo: al estar en el cliente, cualquiera que abra la app puede verla.
  API_KEY: "5e7cc85c78ed77013a2e40df3bd7d99e4ac030b9bbeac849",
};
