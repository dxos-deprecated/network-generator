//
// Copyright 2020 DxOS.
//

import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

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
      const peerFrom = this._graph.getNode(link.fromId);
      const peerTo = this._graph.getNode(link.toId);
      connections.push({ peerFrom, peerTo, stream: link.data });
    });
    return connections;
  }

  addPeer (nodeId) {
    const peer = this._createPeer(nodeId);

    if (peer.id === undefined || peer.id === null) {
      throw new Error('createPeer expect to return an object with an "id" prop.');
    }

    this._graph.addNode(nodeId, peer);
    return peer;
  }

  addConnection (from, to) {
    if (!this._graph.hasNode(from)) this.addPeer(from);
    if (!this._graph.hasNode(to)) this.addPeer(to);
    const peerFrom = this._graph.getNode(from);
    const peerTo = this._graph.getNode(to);

    const connection = this._createConnection(peerFrom.data, peerTo.data);

    if (!connection.pipe) {
      throw new Error('createConnection expect a stream');
    }

    const link = this._graph.addLink(from, to, connection);
    eos(connection, () => {
      this._graph.removeLink(link);
    });

    return { peerFrom, peerTo, stream: connection };
  }

  deletePeer (nodeId) {
    if (!this._graph.hasNode(nodeId)) {
      throw new Error(`Peer ${nodeId} not found`);
    }

    this._graph.removeNode(nodeId);
    this._graph.forEachLinkedNode(nodeId, (_, link) => {
      this._destroyLink(link);
    });
  }

  deleteConnection (from, to) {
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
          network.addPeer(nodeId);
        },
        addLink (from, to) {
          return network.addConnection(from, to).link;
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
