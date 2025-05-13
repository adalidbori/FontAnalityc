var Service = require('node-windows').Service;

var svc = new Service({
    name: 'FrontAnalytic',
    description: 'ACB account payable app',
    script: './server.js'
  });

svc.on('uninstall', function(){
  console.log('The service has been uninstalled.');
});

svc.uninstall();