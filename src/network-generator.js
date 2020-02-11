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

const topologies = ['ladder', 'complete', 'completeBipartite', 'balancedBinTree', 'path', 'circularLadder', 'grid', 'grid3', 'noLinks', 'cliqueCircle', 'wattsStrogatz'];

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

    this._createPeer = createPeer;
    this._createConnection = createConnection;
    this._graph = createGraph();

    this._graph.on('changed', (changes) => {
      changes.forEach(({ changeType, node, link }) => {
        process.nextTick(() => {
          if (changeType === 'update') return;
          const type = changeType === 'add' ? 'added' : 'deleted';
          const ev = `${node ? 'peer' : 'connection'}:${type}`;
          this.emit(ev, node ? node.data : link.data);
        });
      });
    });
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
      const peerFrom = this._graph.getNode(link.fromId).data;
      const peerTo = this._graph.getNode(link.toId).data;
      connections.push({ peerFrom, peerTo, stream: link.data });
    });
    return connections;
  }

  addPeer (id) {
    assert(Buffer.isBuffer(id));

    const peer = this._createPeer(id);
    if (!Buffer.isBuffer(peer.id)) {
      throw new Error('createPeer expect to return an object with an "id" buffer prop.');
    }

    this._graph.addNode(id.toString('hex'), peer);
    return peer;
  }

  addConnection (from, to) {
    assert(Buffer.isBuffer(from));
    assert(Buffer.isBuffer(to));

    const fromHex = from.toString('hex');
    const toHex = to.toString('hex');

    if (!this._graph.hasNode(fromHex)) this.addPeer(from);
    if (!this._graph.hasNode(toHex)) this.addPeer(to);
    const peerFrom = this._graph.getNode(fromHex);
    const peerTo = this._graph.getNode(toHex);

    const connection = this._createConnection(peerFrom.data, peerTo.data) || new PassThrough();

    if (!(typeof connection === 'object' && typeof connection.pipe === 'function')) {
      throw new Error('createConnection expect to return a stream');
    }

    const link = this._graph.addLink(fromHex, toHex, connection);
    eos(connection, () => {
      this._graph.removeLink(link);
    });

    return { peerFrom, peerTo, stream: connection };
  }

  deletePeer (id) {
    assert(Buffer.isBuffer(id));

    const idHex = id.toString('hex');

    if (!this._graph.hasNode(idHex)) {
      throw new Error(`Peer ${idHex} not found`);
    }

    this._graph.removeNode(idHex);
    this._graph.forEachLinkedNode(idHex, (_, link) => {
      this._destroyLink(link);
    });
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
          return network.addConnection(idGenerator.get(from), idGenerator.get(to)).link;
        },
        getNodesCount () {
          return network.graph.getNodesCount();
        }
      };
    });

    topologies.forEach(topology => {
      this[topology] = (...args) => {
        const { network } = generator[topology](...args);
        return network;
      };
    });
  }
}
