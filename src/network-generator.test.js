//
// Copyright 2020 DxOS.
//

import { PassThrough } from 'stream';
import { NetworkGenerator } from './network-generator';
import waitForExpect from 'wait-for-expect';

test('generate a grid topology', async () => {
  const generator = new NetworkGenerator({
    createPeer (id) {
      return { id, name: `peer${id}` };
    }
  });

  const network = await generator.grid(10, 10);
  expect(network.peers.length).toBe(100);
  expect(network.connections.length).toBe(180);
  expect(network.peers[0]).toHaveProperty('name');

  const conn1 = network.connections[0];
  expect(conn1.stream).toBeInstanceOf(PassThrough);

  let connectionLength = network.connections.length;
  network.deleteConnection(conn1.fromPeer.id, conn1.toPeer.id);
  await waitForExpect(async () => {
    expect(network.connections.length).toBeLessThan(connectionLength);
  });

  connectionLength = network.connections.length;
  network.deletePeer(network.connections[0].fromPeer.id);
  await waitForExpect(async () => {
    expect(network.connections.length).toBeLessThan(connectionLength);
  });

  await network.destroy();
  expect(network.peers.length).toBe(0);
  expect(network.connections.length).toBe(0);
});
