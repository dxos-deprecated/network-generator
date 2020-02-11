//
// Copyright 2020 DxOS.
//

import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import assert from 'assert';

import createGraph from 'ngraph.graph';
import graphGenerators from 'ngraph.generators';
import eos from 'end-of-stream';

const topologies = ['ladder', 'complete', 'completeBipartite', 'balancedBinTree', 'path', 'circularLadder', 'grid', 'grid3', 'noLinks', 'cliqueCircle', 'wattsStrogatz'];

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

    this._graph.addNode(id.toString(), peer);
    return peer;
  }

  addConnection (from, to) {
    assert(Buffer.isBuffer(from));
    assert(Buffer.isBuffer(to));

    if (!this._graph.hasNode(from.toString())) this.addPeer(from);
    if (!this._graph.hasNode(to.toString())) this.addPeer(to);
    const peerFrom = this._graph.getNode(from.toString());
    const peerTo = this._graph.getNode(to.toString());

    const connection = this._createConnection(peerFrom.data, peerTo.data);

    if (!connection.pipe) {
      throw new Error('createConnection expect a stream');
    }

    const link = this._graph.addLink(from.toString(), to.toString(), connection);
    eos(connection, () => {
      this._graph.removeLink(link);
    });

    return { peerFrom, peerTo, stream: connection };
  }

  deletePeer (id) {
    assert(Buffer.isBuffer(id));

    if (!this._graph.hasNode(id.toString())) {
      throw new Error(`Peer ${id.toString()} not found`);
    }

    this._graph.removeNode(id.toString());
    this._graph.forEachLinkedNode(id.toString(), (_, link) => {
      this._destroyLink(link);
    });
  }

  deleteConnection (from, to) {
    from = from.toString();
    to = to.toString();

    this._graph.forEachLinkedNode(from, (_, link) => {
      if (link.fromId === from && link.toId === to) this._destroyLink(link);
      if (link.toId === from && link.fromId === to) this._destroyLink(link);
    });
    this._graph.forEachLinkedNode(to, (_, link) => {
      if (link.fromId === from && link.toId === to) this._destroyLink(link);
      if (link.toId === from && link.fromId === to) this._destroyLink(link);
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
      const network = new Network(options);
      return {
        network,
        addNode (nodeId) {
          network.addPeer(Buffer.from(`${nodeId}`));
        },
        addLink (from, to) {
          return network.addConnection(Buffer.from(`${from}`), Buffer.from(`${to}`)).link;
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
