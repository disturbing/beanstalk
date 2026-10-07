// An SSH ProxyCommand over the beanstalk-ssh Worker's test tunnel (GET /tunnel, a WebSocket):
// stdin goes out as binary messages, messages come back on stdout. For a staging stack that has
// no Spectrum app yet; the bytes are exactly the SSH connection Spectrum would deliver.
//
//   ssh -o ProxyCommand='node ssh_tunnel_client.mjs wss://<ssh worker>/tunnel' git@<any name>
const url = process.argv[2];
if (url === undefined) {
  process.stderr.write('usage: ssh_tunnel_client.mjs wss://<ssh worker>/tunnel\n');
  process.exit(2);
}
const socket = new WebSocket(url);
socket.binaryType = 'arraybuffer';
const pending = [];
socket.addEventListener('open', () => {
  for (const chunk of pending.splice(0)) socket.send(chunk);
});
socket.addEventListener('message', (event) => {
  process.stdout.write(Buffer.from(event.data));
});
socket.addEventListener('close', () => process.exit(0));
socket.addEventListener('error', () => {
  process.stderr.write('tunnel: websocket error\n');
  process.exit(1);
});
process.stdin.on('data', (chunk) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(chunk);
  else pending.push(chunk);
});
process.stdin.on('end', () => socket.close(1000, 'done'));
