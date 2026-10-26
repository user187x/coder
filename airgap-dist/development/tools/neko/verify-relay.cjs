const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const client = process.argv[2];
const ts = require(path.join(client, 'node_modules/typescript'));
const file = ts.createSourceFile('base.ts', fs.readFileSync(path.join(client, 'src/neko/base.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
let constructors = 0;
let branch;
function visit(node) {
  if (ts.isNewExpression(node) && node.expression.getText(file) === 'RTCPeerConnection') {
    constructors++;
    assert.equal(node.arguments?.length, 1);
    const argument = node.arguments[0];
    assert(ts.isObjectLiteralExpression(argument));
    assert.equal(argument.properties.length, 2);
    const values = Object.fromEntries(argument.properties.map((item) => {
      assert(ts.isPropertyAssignment(item));
      return [item.name.getText(file), item.initializer.getText(file)];
    }));
    assert.deepEqual(values, { iceServers: 'servers', iceTransportPolicy: "'relay'" });
  }
  if (ts.isIfStatement(node) && node.expression.getText(file) === 'lite !== true') branch = node;
  ts.forEachChild(node, visit);
}
visit(file);
assert.equal(constructors, 2);
assert(branch);
const source = ts.transpileModule(branch.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const configurations = [];
function Peer(configuration) { configurations.push(configuration); }
const construct = new Function('RTCPeerConnection', 'lite', 'servers', source);
const servers = [{ urls: 'turn:relay.invalid:3478', username: 'test', credential: 'test' }];
for (const lite of [false, true]) construct.call({}, Peer, lite, servers);
assert.equal(configurations.length, 2);
for (const configuration of configurations) {
  assert.equal(configuration.iceServers, servers);
  assert.equal(configuration.iceTransportPolicy, 'relay');
}
const js = fs.readdirSync(process.argv[3], { recursive: true }).filter((name) => name.endsWith('.js')).map((name) => fs.readFileSync(path.join(process.argv[3], name), 'utf8')).join('\n');
assert(js.includes('iceTransportPolicy'));
assert(!/stuns?:\/\//i.test(js) && !/stuns?:[a-z0-9.-]+:[0-9]+/i.test(js));
console.log('Both browser peer branches use supplied TURN servers and relay-only policy; no compiled STUN fallback.');
