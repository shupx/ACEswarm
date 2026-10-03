const { createControlServer } = require('./control-api');

const config = JSON.parse(process.env.ACESWARM_CONTROL_CONFIG || '{}');
const port = Number(process.env.ACESWARM_CONTROL_PORT || 0);
const server = createControlServer(config);
server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  process.stdout.write(`ACESWARM_CONTROL_READY ${JSON.stringify({ host: address.address, port: address.port })}\n`);
});
function stop() { server.close(() => process.exit(0)); }
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
