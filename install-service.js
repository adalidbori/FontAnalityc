// Importa la clase Service de node-windows
var Service = require('node-windows').Service;

// Crea un nuevo objeto Service
var svc = new Service({
    name: 'FrontAnalytic',
    description: 'Analytic App for Front Email Client',
    script: './server.js'
  });
  

// Evento que se dispara cuando el servicio se instala correctamente
svc.on('install', function() {
  svc.start();
  console.log('The service is installed');
});

// Opcional: puedes manejar otros eventos, como "alreadyinstalled" o "error"
// svc.on('error', function(err) {
//   console.error('Error: ', err);
// });

// Instala el servicio
svc.install();