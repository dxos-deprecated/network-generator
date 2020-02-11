# Network generator
> Simulate a network graph of connection streams.

[![Build Status](https://travis-ci.com/dxos/broadcast.svg?branch=master)](https://travis-ci.com/dxos/network-generator)
[![Coverage Status](https://coveralls.io/repos/github/dxos/network-generator/badge.svg?branch=master)](https://coveralls.io/github/dxos/network-generator?branch=master)
![npm (scoped)](https://img.shields.io/npm/v/@dxos/network-generator)
[![Greenkeeper badge](https://badges.greenkeeper.io/dxos/network-generator.svg)](https://greenkeeper.io/)
[![js-semistandard-style](https://img.shields.io/badge/code%20style-semistandard-brightgreen.svg?style=flat-square)](https://github.com/standard/semistandard)
[![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)

## Install

```
$ npm install @dxos/network-generator
```

## Usage

```javascript
import { NetworkGenerator } from '@dxos/network-generator';

const generator = new NetworkGenerator({
  createPeer(id) {
    // defines the peer object for the network. An "id" is required.
    return { id, name: `peer${nodeId}` };
  }
  createConnection(peerFrom, peerTo) {
    // do something to connect peerFrom <--> peerTo
  }
});

const network = generator.balancedBinTree(5);

console.log(network.peers)
console.log(network.connections)
```

## API

#### `const generator = new NetworkGenerator([options])`

Creates a network generator instance.

- `options`:
  - `createPeer: (id: Buffer) => Object`: Defines how to create the peer object.
  - `createConnection: (peerFrom, peerTo) => Object`: Defines how to create a connection between peerFrom and peerTo. **It can return an optional stream.**

#### `const network = generator.balancedBinTree(n)`

Creates a network using a balanced binary tree topology n levels

- `n: number`: Number of levels for the binary tree.

> NetworkGenerator uses ngraph.generator, you can generate any topology supported by them [topologies](https://github.com/anvaka/ngraph.generators#ladder)

#### `network.peers -> Peer[]`

Returns an array of peers.

#### `network.connections -> Connection[]`

Returns an array of connections.

#### `network.graph -> ngraph`

Returns the ngraph instance.

#### `network.addPeer(id) -> Peer`

Adds a new peer to the network.

#### `network.deletePeer(id)`

Deletes a peer from the network.

#### `network.addConnection(fromId, toId) -> Connection`

Adds a new connection to the network.

- `Connection: { peerFrom, peerTo, stream }`

#### `network.deleteConnection(fromId, toId)`

Deletes a connection from the network.

## Contributing

PRs accepted.

## License

GPL-3.0 © dxos
