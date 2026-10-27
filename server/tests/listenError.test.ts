import assert from 'node:assert/strict';
import net from 'node:net';
import { describe, it } from 'node:test';
import { describeListenError } from '../src/utils/listenError';

describe('listen error messages', () => {
  it('explains a port conflict without a stack trace or any configuration values', async () => {
    const holder = net.createServer(); await new Promise<void>((r) => holder.listen(0, '127.0.0.1', r));
    const port = (holder.address() as net.AddressInfo).port;
    const err = await new Promise<NodeJS.ErrnoException>((res) => { const s = net.createServer(); s.once('error', res); s.listen(port, '127.0.0.1'); });
    holder.close();
    const msg = describeListenError(err, port);
    assert.match(msg, new RegExp(`Port ${port} is already in use`)); assert.doesNotMatch(msg, /\bat \w+.*\(/);
  });
  it('handles permission and unknown errors', () => {
    assert.match(describeListenError(Object.assign(new Error('x'), { code: 'EACCES' }), 80), /Not allowed/);
    assert.match(describeListenError(new Error('x'), 4000), /could not start listening/);
  });
});
