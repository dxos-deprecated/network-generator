//
// Copyright 2020 DxOS.
//

import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import assert from 'assert';
import crypto from 'crypto';

import createGraph from 'ngraph.graph';
import graphGenerators from 'ngraph.generators';
import eos from 'end-of-stream';

export const topologies = ['ladder', 'complete', 'completeBipartite', 'balancedBinTree', 'path', 'circularLadder', 'grid', 'grid3', 'noLinks', 'cliqueCircle', 'wattsStrogatz'];

class IdGenerator {
  constructor () {
    this._ids = new Map();
  }

  get (id) {
    if (this._ids.has(id)) {
      return this._ids.get(id);
    }

    const newId = crypto.randomBytes(32);
    this._ids.set(id, newId);
    return newId;
  }
}

/**
 * Network.
 *
 */
export class Network extends EventEmitter {
  /**
   * @constructor
   * @param {Object} options
   * @param {Function} options.createPeer
   * @param {Function} options.createConnection
   */
  constructor (options = {}) {
    super();

    const { createPeer = (nodeId) => ({ id: nodeId }), createConnection = () => new PassThrough() } = options;

    this._createPeer = async (...args) => createPeer(...args);
    this._createConnection = async (...args) => createConnection(...args);
    this._graph = createGraph();
  }

  get graph () {
    return this._graph;
  }

  get peers () {
    const peers = [];
    this._graph.forEachNode(node => {
      peers.push(node.data);
    });
    return peers;
  }

  get connections () {
    const connections = [];
    this._graph.forEachLink(link => {
      const fromPeer = this._graph.getNode(link.fromId).data;
      const toPeer = this._graph.getNode(link.toId).data;
      connections.push({ fromPeer, toPeer, stream: link.data });
    });
    return connections;
  }

  async addPeer (id) {
    assert(Buffer.isBuffer(id));

    const peer = this._createPeer(id);

    const node = this._graph.addNode(id.toString('hex'), peer.then((peer) => {
      if (!Buffer.isBuffer(peer.id)) {
        throw new Error('createPeer expect to return an object with an "id" buffer prop.');
      }

      node.data = peer;
      return peer;
    }));

    return peer;
  }

  async addConnection (from, to) {
    assert(Buffer.isBuffer(from));
    assert(Buffer.isBuffer(to));

    const fromHex = from.toString('hex');
    const toHex = to.toString('hex');

    if (!this._graph.hasNode(fromHex)) this.addPeer(from);
    if (!this._graph.hasNode(toHex)) this.addPeer(to);
    const fromPeer = this._graph.getNode(fromHex);
    const toPeer = this._graph.getNode(toHex);

    const connection = (async () => (this._createConnection(await fromPeer.data, await toPeer.data) || new PassThrough()))();

    const link = this._graph.addLink(fromHex, toHex, connection.then(stream => {
      if (!(typeof stream === 'object' && typeof stream.pipe === 'function')) {
        throw new Error('createConnection expect to return a stream');
      }

      eos(stream, () => {
        this._graph.removeLink(link);
      });

      link.data = stream;
    }));

    const stream = await connection;

    return { fromPeer, toPeer, stream };
  }

  deletePeer (id) {
    assert(Buffer.isBuffer(id));

    const idHex = id.toString('hex');

    if (!this._graph.hasNode(idHex)) {
      throw new Error(`Peer ${idHex} not found`);
    }

    this._graph.forEachLinkedNode(idHex, (_, link) => {
      this._destroyLink(link);
    });
    this._graph.removeNode(idHex);
  }

  deleteConnection (from, to) {
    const fromHex = from.toString('hex');
    const toHex = to.toString('hex');

    this._graph.forEachLinkedNode(fromHex, (_, link) => {
      if (link.fromId === fromHex && link.toId === toHex) this._destroyLink(link);
      if (link.toId === fromHex && link.fromId === toHex) this._destroyLink(link);
    });
    this._graph.forEachLinkedNode(toHex, (_, link) => {
      if (link.fromId === fromHex && link.toId === toHex) this._destroyLink(link);
      if (link.toId === fromHex && link.fromId === toHex) this._destroyLink(link);
    });
  }

  async destroy () {
    const eosConnections = Promise.all(this.connections.map(({ stream }) => {
      return new Promise(resolve => {
        if (stream.destroyed) return resolve();
        eos(stream, () => resolve());
      });
    }));

    process.nextTick(() => {
      this.peers.forEach(peer => {
        this.deletePeer(peer.id);
      });
    });

    await eosConnections;
  }

  _destroyLink (link) {
    if (!link.data.destroyed) {
      link.data.destroy();
    }
  }
}

/**
 * Network generator.
 *
 */
export class NetworkGenerator {
  /**
   * @constructor
   * @param {Object} options
   * @param {Function} options.createPeer
   * @param {Function} options.createConnection
   */
  constructor (options = {}) {
    const generator = graphGenerators.factory(() => {
      const idGenerator = new IdGenerator();
      const network = new Network(options);
      return {
        network,
        addNode (id) {
          network.addPeer(idGenerator.get(id));
        },
        addLink (from, to) {
          network.addConnection(idGenerator.get(from), idGenerator.get(to));
        },
        getNodesCount () {
          return network.graph.getNodesCount();
        }
      };
    });

    topologies.forEach(topology => {
      this[topology] = async (...args) => {
        const { network } = generator[topology](...args);
        await Promise.all(network.peers);
        await Promise.all(network.connections.map(conn => conn.stream));
        return network;
      };
    });
  }
}
