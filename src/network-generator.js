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

/**
 * @typedef {Object} Peer
 * @property {Buffer} id Required peer id.
 */

/**
 * @typedef {Object} Connection
 * @property {Peer} fromPeer
 * @property {Peer} toPeer
 * @property {Stream} stream
 */

/**
 *
 * @callback CreatePeerCallback
 * @param {Buffer} id Random buffer of 32 bytes to represent the id of the peer
 * @returns {Promise<Peer>}
 */

/**
 *
 * @callback CreateConnectionCallback
 * @param {Peer} fromPeer Peer initiator of the connection
 * @param {Peer} toPeer Peer target
 * @returns {Promise<(Stream|undefined)>}
 */

export const topologies = ['ladder', 'complete', 'completeBipartite', 'balancedBinTree', 'path', 'circularLadder', 'grid', 'grid3', 'noLinks', 'cliqueCircle', 'wattsStrogatz'];

/**
 * Class helper to generate random buffer ids based on a number.
 */
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
   * @param {CreatePeerCallback} options.createPeer
   * @param {CreateConnectionCallback} options.createConnection
   */
  constructor (options = {}) {
    super();

    const { createPeer = id => ({ id }), createConnection = () => new PassThrough() } = options;

    this._createPeer = async (...args) => createPeer(...args);
    this._createConnection = async (...args) => createConnection(...args);
    this._graph = createGraph();
    this._graph.on('changed', (changes) => {
      changes.forEach(async ({ changeType, node, link }) => {
        if (changeType === 'update') return;
        const type = changeType === 'add' ? 'added' : 'deleted';
        const ev = `${node ? 'peer' : 'connection'}-${type}`;
        this.emit(ev, node ? await node.data : await link.data);
      });
    });
  }

  /**
   * @type {Ngraph}
   */
  get graph () {
    return this._graph;
  }

  /**
   * @type {Peer[]}
   */
  get peers () {
    const peers = [];
    this._graph.forEachNode(node => {
      peers.push(node.data);
    });
    return peers;
  }

  /**
   * @type {Connection[]}
   */
  get connections () {
    const connections = [];
    this._graph.forEachLink(link => {
      const fromPeer = this._graph.getNode(link.fromId).data;
      const toPeer = this._graph.getNode(link.toId).data;
      connections.push({ fromPeer, toPeer, stream: link.data });
    });
    return connections;
  }

  /**
   * Add a new peer to the network
   *
   * @param {Buffer} id
   * @returns {Promise<Peer>}
   */
  async addPeer (id) {
    assert(Buffer.isBuffer(id));

    const peer = this._createPeer(id);

    const node = this._graph.addNode(id.toString('hex'), peer.then((peer) => {
      if (!Buffer.isBuffer(peer.id)) {
        throw new Error('createPeer expect to return an object with an "id" buffer prop');
      }

      node.data = peer;
      return peer;
    }));

    return peer;
  }

  /**
   * Add a new connection to the network
   *
   * @param {Buffer} from
   * @param {Buffer} to
   * @returns {Promise<Connection>}
   */
  async addConnection (from, to) {
    assert(Buffer.isBuffer(from));
    assert(Buffer.isBuffer(to));

    const fromHex = from.toString('hex');
    const toHex = to.toString('hex');

    if (this._graph.hasLink(fromHex, toHex)) {
      throw new Error(`Connection ${fromHex.slice(0, 6)} -> ${toHex.slice(0, 6)} exists`);
    }

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

  /**
   * Delete a peer
   *
   * @param {Buffer} id
   * @returns {Promise}
   */
  deletePeer (id) {
    assert(Buffer.isBuffer(id));

    const idHex = id.toString('hex');

    if (!this._graph.hasNode(idHex)) {
      throw new Error(`Peer ${idHex} not found`);
    }

    const promises = [];
    this._graph.forEachLinkedNode(idHex, (_, link) => {
      promises.push(this._destroyLink(link));
    });
    this._graph.removeNode(idHex);
    return Promise.all(promises);
  }

  /**
   * Delete a connection
   *
   * @param {Buffer} from
   * @param {Buffer} to
   * @returns {Promise}
   */
  deleteConnection (from, to) {
    const fromHex = from.toString('hex');
    const toHex = to.toString('hex');

    const promises = [];
    this._graph.forEachLinkedNode(fromHex, (_, link) => {
      if (link.fromId === fromHex && link.toId === toHex) {
        promises.push(this._destroyLink(link));
      }
    });

    return Promise.all(promises);
  }

  /**
   * Destroy all the peers and connections related
   *
   * @returns {Promise}
   */
  async destroy () {
    const promises = [];
    this.peers.forEach(peer => {
      promises.push(this.deletePeer(peer.id));
    });

    return Promise.all(promises);
  }

  async _destroyLink (link) {
    if (!link.data.destroyed) {
      const p = new Promise(resolve => eos(link.data, () => {
        resolve();
      }));
      link.data.destroy();
      return p;
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
   * @param {CreatePeerCallback} options.createPeer
   * @param {CreateConnectionCallback} options.createConnection
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
