'use strict';

const {
  HTTP_SERVER_PORT
} = require('../constants');

// TODO: investigate peerjs history, why .default now?  Node 10?
const Agent = require('peerjs').default;

const Service = require('@fabric/core/types/service');
const State = require('@fabric/core/types/state');
const Peer = require('./peer');

class Swarm extends Service {
  constructor (configuration = {}) {
    super(configuration);

    this.settings = this.config = Object.assign({
      port: HTTP_SERVER_PORT,
      secure: true,
      seeds: [
        "fabric.pub:9999",
        "api.roleplaygateway.com:9999",
        "hub.roleplaygateway.com:9999",
        "chat.roleplaygateway.com:9999",
        "hub.verse.pub:9999"
      ]
    }, configuration);

    this.agent = null;
    this.connections = {};
    this.peers = [];
  }

  identify (id) {
    this.name = id;
    this.agent = new Agent(id, {
      host: 'localhost',
      path: '/services/peering',
      port: this.config.port,
      secure: this.config.secure
    });

    this.agent.on('open', this._onOpen.bind(this));
    this.agent.on('connection', this._onInbound.bind(this));

    this.status = 'identified';

    return this;
  }

  connect (id) {
    if (this.connections[id]) return console.error(`Cannot connect to peer ${id} more than once.`);

    this.connections[id] = this.agent.connect(id, {
      label: this.agent.id,
      reliable: true
    });

    this.connections[id].on('open', this._handleConnectionOpen.bind(this));
    this.connections[id].on('data', this._onData.bind(this));

    return this.connections[id];
  }

  start () {
    this.status = 'starting';
    for (let i = 0; i < this.settings.seeds.length; i++) {
      let seed = this.settings.seeds[i];
    }
    this.status = 'started';
    this.emit('ready');
    return this;
  }

  _broadcast (msg) {
    if (!msg['@type']) return console.error(`Cannot broadcast untyped message:`, msg);
    if (msg['@data'] && !msg['@data'].path) return console.error(`No path.`);

    this._relayFrom(this.agent.id, msg);
  }

  _handleConnectionOpen (connection) {
    console.log('[SWARM:_handleConnectionOpen]', 'ready! agent:', this.agent.id);
    console.log('[SWARM:_handleConnectionOpen]', 'connection:', connection);
  }

  _onOpen (connection) {
    this.peers = [{
      address: this.agent.id
    }];
    console.log('[SWARM:_onOpen]', 'opened! agent:', this.agent.id);
    console.log('[SWARM:_onOpen]', 'connection id:', this.agent.id);
  }

  _onInbound (connection) {
    console.log(`incoming connection:`, connection);
    console.log(`context:`, this);
    this.connections[connection.label] = new Peer(connection);
    this.connections[connection.label].on('open', this._onOpen.bind(this));
    this.connections[connection.label].on('message', this._onMessage.bind(this));
    this.emit('connection', connection.label);
  }

  _onData (msg) {
    return this._onMessage({
      '@actor': this.agent.id,
      '@data': msg['@data'],
      '@type': msg['@type']
    });
  }

  _onMessage (msg) {
    console.log('[INBOUND]', 'message:', msg);

    let vector = new State({
      actor: `/actors/${msg['@actor']}`,
      target: `/messages`,
      object: msg['@data']
    });

    // TODO: validation
    this._relayFrom(msg['@actor'], msg);

    this.emit('message', {
      '@type': 'PeerMessage',
      '@data': vector['@data']
    });
  }

  _relayFrom (actor, msg) {
    let peers = Object.keys(this.connections).filter(key => {
      return key !== actor;
    });

    console.log('[SWARM]', `relaying message from ${actor} to peers:`, peers);

    for (let i = 0; i < peers.length; i++) {
      try {
        this.connections[peers[i]].send(msg);
      } catch (E) {
        console.error('Could not relay to peer:', E);
      }
    }
  }

  async _GET (path) {
    return this._broadcast({
      '@type': `GET`,
      '@data': {
        path: path
      }
    });
  }
}

module.exports = Swarm;
