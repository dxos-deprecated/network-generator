//
// Copyright 2020 DxOS.
//

import { PassThrough } from 'stream';
import { NetworkGenerator } from './network-generator';
import waitForExpect from 'wait-for-expect';

const genericTest = async network => {
  expect(network.peers[0]).toHaveProperty('name');

  const conn1 = network.connections[0];
  expect(conn1.stream).toBeInstanceOf(PassThrough);
  expect(conn1.fromPeer).toHaveProperty('name');
  expect(conn1.toPeer).toHaveProperty('name');

  let connectionLength = network.connections.length;
  await network.deleteConnection(conn1.fromPeer.id, conn1.toPeer.id);
  await waitForExpect(async () => {
    expect(network.connections.length).toBeLessThan(connectionLength);
  });

  connectionLength = network.connections.length;
  await network.deletePeer(network.connections[0].fromPeer.id);
  await waitForExpect(async () => {
    expect(network.connections.length).toBeLessThan(connectionLength);
  });

  await network.destroy();
  expect(network.peers.length).toBe(0);
  expect(network.connections.length).toBe(0);
};

test('generate a grid topology', async () => {
  const generator = new NetworkGenerator({
    createPeer (id) {
      return { id, name: `peer${id}` };
    }
  });

  generator.on('error', err => console.log(err));

  const network = await generator.grid(10, 10);
  expect(network.peers.length).toBe(100);
  expect(network.connections.length).toBe(180);
  await genericTest(network);
});

test('generate a balancedBinTree of 2 n', async () => {
  const generator = new NetworkGenerator({
    createPeer (id) {
      return { id, name: `peer${id}` };
    },
    createConnection (fromPeer, toPeer) {
      return new PassThrough();
    }
  });

  generator.on('error', err => console.log(err));

  const network = await generator.balancedBinTree(2);
  expect(network.peers.length).toBe(7);
  expect(network.connections.length).toBe(6);
  await genericTest(network);
});
